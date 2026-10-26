import type {
  BindGroup,
  FrameBuffer,
  GPUDataBuffer,
  GPUProgram,
  RenderStateSet,
  Texture3D
} from '@zephyr3d/device';
import type { Nullable } from '@zephyr3d/base';
import { Vector4 } from '@zephyr3d/base';
import { getDevice } from '../../app/api';
import type { Scene } from '../../scene/scene';
import type { Camera } from '../../camera/camera';
import type { DirectionalLight, PunctualLight } from '../../scene/light';
import type { GlobalSDF } from '../sdf/global_sdf';
import { buildSDFProgram } from '../sdf/sdf_programs';
import { drawFullscreenQuad } from '../fullscreenquad';
import { fetchSampler } from '../../utility/misc';
import { getGICacheExposure } from '../../utility/physical';
import { LIGHT_TYPE_DIRECTIONAL, LIGHT_TYPE_SPOT } from '../../values';
import {
  declareDynamicSDFUniforms,
  declareGlobalSDFUniforms,
  GLOBAL_SDF_LEVELS,
  GLOBAL_SDF_PARAMS,
  sampleGlobalSDF
} from '../../shaders/sdf';
import { sdfConeShadow } from '../../shaders/gi';
import { declareProbeUniforms, sampleProbeIrradiance } from '../../shaders/probes';
import { getActiveProbeVolume } from './probe_volume';

/** Most lights the voxels are lit by, the sun aside. */
export const MAX_VOXEL_LIGHTS = 64;
/** vec4s per packed light: (position, range), (direction, cutoff), (colour, intensity), extra. */
const LIGHT_VEC4S = 4;
/** Material voxels along a brick edge of the global field, whose bricks are 8³ field voxels. */
const BRICK_VOXELS = 4;
/**
 * Format of the second aniso texture, two faces (-y, -z): rg8unorm where the
 * device can write it from a shader (texture-formats-tier1), else rgba8unorm.
 */
function aniso1Format(): 'rg8unorm' | 'rgba8unorm' {
  return getDevice().getDeviceCaps().textureCaps.getTextureFormatInfo('rg8unorm')?.writable
    ? 'rg8unorm'
    : 'rgba8unorm';
}
/** Cone tracing steps of the sun shadow. */
const SHADOW_STEPS = 24;
/** The axis faces of a voxel, in the order of the aniso textures (Godot's aniso_dir). */
const ANISO_DIRS: [number, number, number][] = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
  [-1, 0, 0],
  [0, -1, 0],
  [0, 0, -1]
];

/**
 * Settings of the voxel lighting, on {@link SceneGI}.
 * @public
 */
export interface VoxelLightingOptions {
  /** Half angle of the sun shadow cone in degrees; wider is softer. Default 5. */
  sunShadowConeAngle: number;
  /** Z slices of every clipmap level lit per frame; a level is refreshed every `resolution / slices` frames. Default 8. */
  slicesPerFrame: number;
}

/**
 * Lights the voxel scene: for every material voxel, the sun (shadowed by cone
 * tracing the global field, see {@link sdfConeShadow}), the punctual lights
 * in range (unshadowed), the sky irradiance of the environment light, times
 * the albedo, plus the emissive; written to the radiance clipmap. The radiance
 * a ray of the global illumination picks up where it hits. Kept at the fixed
 * cache exposure (getGICacheExposure) rather than the camera's, so the probes
 * accumulating it over many frames do not drift when the exposure changes.
 *
 * After the surface cache direct lighting of Lumen (Wright, "Radiance Caching
 * for Real-Time Global Illumination", SIGGRAPH 2021 Advances), on voxels.
 *
 * Runs as a fragment pass, one fragment per voxel of a slab of z slices
 * rotating through every level, so the whole scene is refreshed over a few
 * frames and a moving sun or light follows with that latency. Voxels without
 * material write zero. Normals come from the field's gradient.
 *
 * @internal
 */
export class VoxelLighting {
  private readonly _scene: Scene;
  private _radiance: Nullable<Texture3D>;
  private _aniso0: Nullable<Texture3D>;
  private _aniso1: Nullable<Texture3D>;
  private _resolution: number;
  private _levels: number;
  private _program: Nullable<GPUProgram>;
  private _programKey: string;
  private _bindGroup: Nullable<BindGroup>;
  private _brickProgram: Nullable<GPUProgram>;
  private _brickBindGroup: Nullable<BindGroup>;
  private _brickBuffer: Nullable<GPUDataBuffer>;
  private _renderStates: Nullable<RenderStateSet>;
  private readonly _lightData: Float32Array<ArrayBuffer>;
  private _zStart: number;
  private _passes: number;
  private readonly _sunDir: Vector4;
  private readonly _sunColor: Vector4;
  private readonly _params: Vector4;
  private readonly _slab: Vector4;
  constructor(scene: Scene) {
    this._scene = scene;
    this._radiance = null;
    this._aniso0 = null;
    this._aniso1 = null;
    this._resolution = 0;
    this._levels = 0;
    this._program = null;
    this._programKey = '';
    this._bindGroup = null;
    this._brickProgram = null;
    this._brickBindGroup = null;
    this._brickBuffer = null;
    this._renderStates = null;
    this._lightData = new Float32Array(MAX_VOXEL_LIGHTS * LIGHT_VEC4S * 4);
    this._zStart = 0;
    this._passes = 0;
    this._sunDir = new Vector4();
    this._sunColor = new Vector4();
    this._params = new Vector4();
    this._slab = new Vector4();
  }
  /** Outgoing radiance clipmap, rgba16f, laid out like the albedo. */
  get radiance() {
    if (!this._radiance) {
      throw new Error('VoxelLighting: no radiance before the first update');
    }
    return this._radiance;
  }
  /** Share of the radiance each voxel face carries, (+x, +y, +z, -x); see declareVoxelSceneUniforms. */
  get aniso0() {
    if (!this._aniso0) {
      throw new Error('VoxelLighting: no radiance before the first update');
    }
    return this._aniso0;
  }
  /** Share of the radiance each voxel face carries, (-y, -z) in rg. */
  get aniso1() {
    if (!this._aniso1) {
      throw new Error('VoxelLighting: no radiance before the first update');
    }
    return this._aniso1;
  }
  get ready() {
    return !!this._radiance;
  }
  /** Lighting passes run so far. */
  get passes() {
    return this._passes;
  }
  /**
   * Lights the next slab of every level.
   * @param albedo - The albedo clipmap, `resolution`³ per level.
   * @param emissive - The emissive clipmap.
   */
  update(
    global: GlobalSDF,
    albedo: Texture3D,
    emissive: Texture3D,
    resolution: number,
    camera: Camera,
    options: VoxelLightingOptions
  ) {
    const device = getDevice();
    const scene = this._scene;
    if (!this._radiance || this._resolution !== resolution || this._levels !== global.levels) {
      this._radiance?.dispose();
      this._aniso0?.dispose();
      this._aniso1?.dispose();
      this._resolution = resolution;
      this._levels = global.levels;
      const depth = resolution * global.levels;
      this._radiance = device.createTexture3D('rgba16f', resolution, resolution, depth, {
        mipmapping: false,
        writable: true
      })!;
      this._radiance.name = '@VoxelSceneRadiance';
      this._aniso0 = device.createTexture3D('rgba8unorm', resolution, resolution, depth, {
        mipmapping: false,
        writable: true
      })!;
      this._aniso0.name = '@VoxelSceneAniso0';
      // Two faces: rg8 where the device can write it (texture-formats-tier1)
      this._aniso1 = device.createTexture3D(aniso1Format(), resolution, resolution, depth, {
        mipmapping: false,
        writable: true
      })!;
      this._aniso1.name = '@VoxelSceneAniso1';
      this._zStart = 0;
    }
    const envLight = scene.env.light.envLight;
    const physical = scene.lightingMode === 'physical';
    // Radiance is kept at the fixed cache exposure, whatever the camera's; the
    // sky bake is stored at the same exposure, so it takes the strength alone
    const cacheExposure = getGICacheExposure(scene.lightingMode);
    const envStrength = scene.env.light.strength ?? 0;
    // No sky without an environment light (its stand-in carries only the probes)
    const skyIrradiance = scene.env.light.type !== 'none' && envLight.hasIrradiance();
    const probes = getActiveProbeVolume(scene);
    const key = `${global.levels}:${scene.lightingMode}:${skyIrradiance ? envLight.getType() : 'none'}:${
      skyIrradiance ? this.envVariant() : ''
    }:probes${probes ? 1 : 0}`;
    if (!this._program || this._programKey !== key) {
      this.disposePrograms();
      this._program = this.createProgram(global.levels, physical, skyIrradiance, !!probes, false);
      this._programKey = key;
      this._bindGroup = device.createBindGroup(this._program.bindGroupLayouts[0]);
    }
    const numLights = this.collectLights(camera, cacheExposure);
    const slices = Math.max(1, Math.min(resolution, Math.floor(options.slicesPerFrame)));
    const tanHalf = Math.tan((Math.max(0.1, options.sunShadowConeAngle) * Math.PI) / 180);
    this._params.setXYZW(numLights, envStrength, tanHalf, 0);
    this._slab.setXYZW(resolution, global.levels, slices, this._zStart);
    const bind = (bg: BindGroup) => {
      global.applyBindGroup(bg);
      bg.setTexture('albedoTex', albedo, fetchSampler('clamp_nearest_nomip'));
      bg.setTexture('emissiveTex', emissive, fetchSampler('clamp_nearest_nomip'));
      bg.setTexture('radianceOut', this._radiance!);
      bg.setTexture('aniso0Out', this._aniso0!);
      bg.setTexture('aniso1Out', this._aniso1!);
      bg.setValue('lights', this._lightData);
      bg.setValue('sunDir', this._sunDir);
      bg.setValue('sunColor', this._sunColor);
      bg.setValue('params', this._params);
      bg.setValue('slab', this._slab);
      if (skyIrradiance) {
        envLight.updateBindGroup(bg);
      }
      probes?.applyBindGroup(bg);
    };
    if (!this._renderStates) {
      this._renderStates = device.createRenderStateSet();
      this._renderStates.useDepthState().enableTest(false).enableWrite(false);
      this._renderStates.useRasterizerState().setCullMode('none');
      this._renderStates.useColorState().setColorMask(false, false, false, false);
    }
    const draw = (program: GPUProgram, bg: BindGroup, width: number, height: number) => {
      let fb: Nullable<FrameBuffer> = null;
      device.pushDeviceStates();
      try {
        fb = device.pool.fetchTemporalFramebuffer(false, width, height, 'rgba8unorm');
        device.setFramebuffer(fb);
        device.setViewport([0, 0, width, height]);
        device.setScissor([0, 0, width, height]);
        device.setProgram(program);
        device.setBindGroup(0, bg);
        drawFullscreenQuad(this._renderStates!);
      } finally {
        device.popDeviceStates();
        if (fb) {
          device.pool.releaseFrameBuffer(fb);
        }
      }
    };
    bind(this._bindGroup!);
    draw(this._program, this._bindGroup!, resolution, resolution * slices * global.levels);
    // The bricks the field composited this frame came into a window holding
    // the radiance of the region that left it; light them now rather than when
    // the slab comes round, up to resolution / slices frames later
    const fresh = global.freshMaterialBricks;
    if (fresh.count > 0) {
      if (!this._brickProgram) {
        this._brickProgram = this.createProgram(global.levels, physical, skyIrradiance, !!probes, true);
        this._brickBindGroup = device.createBindGroup(this._brickProgram.bindGroupLayouts[0]);
      }
      const bytes = fresh.data.byteLength;
      if (!this._brickBuffer || this._brickBuffer.byteLength < bytes) {
        this._brickBuffer?.dispose();
        this._brickBuffer = device.createBuffer(bytes, { usage: 'uniform', storage: true })!;
      }
      this._brickBuffer.bufferSubData(0, fresh.data, 0, fresh.count * 4);
      const bg = this._brickBindGroup!;
      bind(bg);
      bg.setBuffer('bricks', this._brickBuffer);
      draw(this._brickProgram, bg, BRICK_VOXELS ** 3, fresh.count);
    }
    this._zStart = (this._zStart + slices) % resolution;
    this._passes++;
  }
  dispose() {
    this._radiance?.dispose();
    this._radiance = null;
    this._aniso0?.dispose();
    this._aniso0 = null;
    this._aniso1?.dispose();
    this._aniso1 = null;
    this.disposePrograms();
    this._brickBuffer?.dispose();
    this._brickBuffer = null;
  }
  /** @internal */
  private disposePrograms() {
    this._bindGroup?.dispose();
    this._bindGroup = null;
    this._program?.dispose();
    this._program = null;
    this._brickBindGroup?.dispose();
    this._brickBindGroup = null;
    this._brickProgram?.dispose();
    this._brickProgram = null;
    this._programKey = '';
  }
  /** What of the environment light's bindings the program depends on. @internal */
  private envVariant() {
    const envLight = this._scene.env.light.envLight as unknown as {
      irradianceSHFB?: unknown;
      irradianceSH?: unknown;
    };
    return `${envLight.irradianceSHFB ? 'fb' : envLight.irradianceSH ? 'buf' : ''}`;
  }
  /**
   * Packs the visible punctual lights: the sun apart (first directional light,
   * the scene's sun light where one is marked), the rest nearest the camera
   * first, up to {@link MAX_VOXEL_LIGHTS}. Only the intensity carries the
   * exposure (the cache exposure), as the clustered light buffer does.
   * @internal
   */
  private collectLights(camera: Camera, exposure: number) {
    const scene = this._scene;
    const cameraPos = camera.getWorldPosition();
    const found: { sun: Nullable<DirectionalLight> } = { sun: null };
    const others: { light: PunctualLight; d: number }[] = [];
    scene.rootNode.iterate((node) => {
      if (node.isPunctualLight() && !node.hidden) {
        if (node.isDirectionLight()) {
          // The marked sun light wins; else the first directional light
          if (!found.sun || node.sunLight) {
            if (found.sun) {
              others.push({ light: found.sun, d: 0 });
            }
            found.sun = node;
          } else {
            others.push({ light: node, d: 0 });
          }
        } else {
          const p = node.positionAndRange;
          others.push({
            light: node,
            d: Math.hypot(p.x - cameraPos.x, p.y - cameraPos.y, p.z - cameraPos.z)
          });
        }
      }
      return false;
    });
    const sunLight: Nullable<PunctualLight> = found.sun;
    if (sunLight) {
      const dir = sunLight.directionAndCutoff;
      const c = sunLight.diffuseAndIntensity;
      this._sunDir.setXYZW(dir.x, dir.y, dir.z, 1);
      this._sunColor.setXYZW(c.x * c.w * exposure, c.y * c.w * exposure, c.z * c.w * exposure, 0);
    } else {
      this._sunDir.setXYZW(0, -1, 0, 0);
      this._sunColor.setXYZW(0, 0, 0, 0);
    }
    others.sort((a, b) => a.d - b.d);
    const count = Math.min(others.length, MAX_VOXEL_LIGHTS);
    const data = this._lightData;
    for (let i = 0; i < count; i++) {
      const light = others[i].light;
      const o = i * LIGHT_VEC4S * 4;
      data.set(light.positionAndRange, o);
      data.set(light.directionAndCutoff, o + 4);
      const c = light.diffuseAndIntensity;
      data[o + 8] = c.x;
      data[o + 9] = c.y;
      data[o + 10] = c.z;
      data[o + 11] = c.w * exposure;
      data.set(light.extraParams, o + 12);
    }
    return count;
  }
  /** @internal */
  /**
   * The lighting program: one fragment per voxel of the slab, or with
   * `bricks` per voxel of a list of bricks, a row of
   * {@link BRICK_VOXELS}³ fragments each.
   * @internal
   */
  private createProgram(
    levels: number,
    physical: boolean,
    skyIrradiance: boolean,
    useProbes: boolean,
    bricks: boolean
  ) {
    const scene = this._scene;
    const envLight = scene.env.light.envLight;
    return buildSDFProgram({
      label: bricks ? 'VoxelLightingBricks' : 'VoxelLighting',
      vertex(pb) {
        this.$inputs.pos = pb.vec2().attrib('position');
        pb.main(function () {
          this.$builtins.position = pb.vec4(this.$inputs.pos, 0, 1);
        });
      },
      fragment(pb) {
        this.$outputs.color = pb.vec4();
        declareGlobalSDFUniforms(this, 0, levels);
        // Bound by the field alongside the global uniforms, unused here
        declareDynamicSDFUniforms(this, 0);
        this.albedoTex = pb.tex3D().sampleType('unfilterable-float').uniform(0);
        this.emissiveTex = pb.tex3D().sampleType('unfilterable-float').uniform(0);
        this.radianceOut = pb.texStorage3D.rgba16float().storage(0);
        this.aniso0Out = pb.texStorage3D.rgba8unorm().storage(0);
        this.aniso1Out =
          aniso1Format() === 'rg8unorm'
            ? pb.texStorage3D.rg8unorm().storage(0)
            : pb.texStorage3D.rgba8unorm().storage(0);
        this.lights = pb.vec4[MAX_VOXEL_LIGHTS * LIGHT_VEC4S]().uniform(0);
        // (direction the light travels, 1 when there is a sun)
        this.sunDir = pb.vec4().uniform(0);
        this.sunColor = pb.vec4().uniform(0);
        // (light count, environment strength, tan of the shadow cone half angle, 0)
        this.params = pb.vec4().uniform(0);
        // (resolution, levels, slices per pass, first slice)
        this.slab = pb.vec4().uniform(0);
        if (bricks) {
          // Per brick: (first material voxel within its level, level)
          this.bricks = pb.vec4[0]().storageBufferReadonly(0);
        }
        if (skyIrradiance) {
          envLight.initShaderBindings(pb);
        }
        if (useProbes) {
          declareProbeUniforms(this, 0);
        }
        pb.func('Z_pointAttenuation', [pb.vec3('p'), pb.vec4('posRange')], function () {
          this.$l.d = pb.sub(this.p, this.posRange.xyz);
          this.$l.dist2 = pb.dot(this.d, this.d);
          this.$l.atten = pb.div(1, pb.max(this.dist2, 0.0001));
          this.$l.range2 = pb.mul(this.posRange.w, this.posRange.w);
          this.$l.f = pb.div(this.dist2, pb.max(this.range2, 0.0001));
          this.$l.f2 = pb.clamp(pb.sub(1, pb.mul(this.f, this.f)), 0, 1);
          this.$return(pb.mul(this.atten, this.f2, this.f2));
        });
        pb.func(
          'Z_spotAttenuation',
          [pb.vec3('p'), pb.vec4('posRange'), pb.vec4('dirCutoff'), pb.vec2('angleScaleOffset')],
          function () {
            this.$l.dist = pb.distance(this.posRange.xyz, this.p);
            if (physical) {
              this.$l.dist2 = pb.mul(this.dist, this.dist);
              this.$l.range2 = pb.mul(this.posRange.w, this.posRange.w);
              this.$l.f = pb.div(this.dist2, pb.max(this.range2, 0.0001));
              this.$l.f2 = pb.clamp(pb.sub(1, pb.mul(this.f, this.f)), 0, 1);
              this.$l.falloff = pb.mul(pb.div(1, pb.max(this.dist2, 0.0001)), this.f2, this.f2);
            } else {
              this.$l.falloff = pb.max(0, pb.sub(1, pb.div(this.dist, this.posRange.w)));
              this.falloff = pb.mul(this.falloff, this.falloff);
            }
            this.$l.cd = pb.dot(pb.normalize(pb.sub(this.p, this.posRange.xyz)), this.dirCutoff.xyz);
            if (physical) {
              this.$l.spot = pb.clamp(
                pb.add(pb.mul(this.cd, this.angleScaleOffset.x), this.angleScaleOffset.y),
                0,
                1
              );
              this.spot = pb.mul(this.spot, this.spot);
            } else {
              this.$l.spot = pb.smoothStep(this.dirCutoff.w, pb.mix(this.dirCutoff.w, 1, 0.5), this.cd);
            }
            this.$return(pb.mul(this.spot, this.falloff));
          }
        );
        pb.main(function () {
          this.$l.res = pb.int(this.slab.x);
          this.$l.fc = pb.ivec2(pb.floor(this.$builtins.fragCoord.xy));
          if (bricks) {
            this.$l.brick = this.bricks.at(this.fc.y);
            this.$l.level = pb.int(this.brick.w);
            this.$l.t = pb.add(
              pb.ivec3(this.brick.xyz),
              pb.ivec3(
                pb.mod(this.fc.x, BRICK_VOXELS),
                pb.mod(pb.div(this.fc.x, BRICK_VOXELS), BRICK_VOXELS),
                pb.div(this.fc.x, BRICK_VOXELS * BRICK_VOXELS)
              )
            );
          } else {
            this.$l.slices = pb.int(this.slab.z);
            this.$l.rowsPerLevel = pb.mul(this.res, this.slices);
            this.$l.level = pb.div(this.fc.y, this.rowsPerLevel);
            this.$l.rem = pb.sub(this.fc.y, pb.mul(this.level, this.rowsPerLevel));
            this.$l.z = pb.add(pb.int(this.slab.w), pb.div(this.rem, this.res));
            this.$l.t = pb.ivec3(
              this.fc.x,
              pb.sub(this.rem, pb.mul(pb.div(this.rem, this.res), this.res)),
              this.z
            );
          }
          this.$l.tz = pb.add(this.t.z, pb.mul(this.level, this.res));
          this.$l.texel = pb.ivec3(this.t.x, this.t.y, this.tz);
          this.$l.radiance = pb.vec3(0);
          this.$l.aniso0 = pb.vec4(0);
          this.$l.aniso1 = pb.vec4(0);
          this.$l.a = pb.textureLoad(this.albedoTex, this.texel, 0);
          this.$if(pb.greaterThan(this.a.a, 0), function () {
            // World voxel of the texel: the one in the level's window with this toroidal address
            this.$l.info = pb.vec4(0);
            this.$l.fineVs = pb.float(0);
            for (let i = 0; i < levels; i++) {
              this.$if(pb.equal(this.level, i), function () {
                this.info = this[GLOBAL_SDF_LEVELS].at(i);
              });
            }
            this.$l.originC = pb.ivec3(pb.floor(pb.div(this.info.xyz, 2)));
            this.$l.resV = pb.ivec3(this.res);
            this.$l.w = pb.add(
              this.originC,
              pb.mod(pb.add(pb.mod(pb.sub(this.t, this.originC), this.resV), this.resV), this.resV)
            );
            this.$l.vs = pb.mul(this.info.w, 2);
            this.$l.p = pb.mul(pb.add(pb.vec3(this.w), pb.vec3(0.5)), this.vs);
            // Light per axis face of the voxel, as Godot's SDFGI keeps it
            // (sdfgi_direct_light.glsl): a voxel holding a floor thinner than
            // itself is lit on top and dark below, which one normal from the
            // field's gradient at its centre cannot tell apart; pointing down,
            // it left sunlit floors black. Godot marks the faces with geometry
            // from the triangle normals at voxelization; the material atlas is
            // in the meshes' own spaces, so here a face counts where the field
            // is outside the solid at its centre, open space lying that way.
            this.$l.half = pb.mul(this.vs, 0.5);
            for (let k = 0; k < 6; k++) {
              this.$l[`open${k}`] = pb.greaterThan(
                sampleGlobalSDF(this, pb.add(this.p, pb.mul(pb.vec3(...ANISO_DIRS[k]), this.half)), levels),
                0
              );
              this.$l[`acc${k}`] = pb.vec3(0);
            }
            this.$l.albedo = this.a.rgb;
            // Sun: one shadow ray for every face, started almost at the corner
            // of the voxel toward the light and a little along it (Godot's bias
            // of outgoing rays), so a thin floor is left from the lit side
            this.$if(pb.greaterThan(this.sunDir.w, 0.5), function () {
              this.$l.L = pb.neg(this.sunDir.xyz);
              this.$l.ps = pb.add(
                this.p,
                pb.mul(pb.sign(this.L), this.vs, 0.48),
                pb.mul(this.L, this.vs, 0.4)
              );
              this.$l.shadow = sdfConeShadow(
                this,
                this.ps,
                this.L,
                this.params.z,
                this.vs,
                pb.mul(this[GLOBAL_SDF_PARAMS].x, this[GLOBAL_SDF_LEVELS].at(levels - 1).w, 0.5),
                levels,
                SHADOW_STEPS
              );
              this.$if(pb.greaterThan(this.shadow, 0), function () {
                this.$l.sun = pb.mul(this.albedo, this.sunColor.rgb, this.shadow, 1 / Math.PI);
                for (let k = 0; k < 6; k++) {
                  this.$if(this[`open${k}`], function () {
                    this[`acc${k}`] = pb.add(
                      this[`acc${k}`],
                      pb.mul(this.sun, pb.max(pb.dot(pb.vec3(...ANISO_DIRS[k]), this.L), 0))
                    );
                  });
                }
              });
            });
            this.$l.count = pb.int(this.params.x);
            this.$for(pb.int('li'), 0, MAX_VOXEL_LIGHTS, function () {
              this.$if(pb.greaterThanEqual(this.li, this.count), function () {
                this.$break();
              });
              this.$l.base = pb.mul(this.li, LIGHT_VEC4S);
              this.$l.posRange = this.lights.at(this.base);
              this.$l.dirCutoff = this.lights.at(pb.add(this.base, 1));
              this.$l.colorIntensity = this.lights.at(pb.add(this.base, 2));
              this.$l.extra = this.lights.at(pb.add(this.base, 3));
              this.$l.ltype = pb.int(this.extra.w);
              this.$l.atten = pb.float(0);
              this.$l.Ld = pb.vec3(0, 1, 0);
              this.$if(pb.equal(this.ltype, LIGHT_TYPE_DIRECTIONAL), function () {
                this.atten = 1;
                this.Ld = pb.neg(this.dirCutoff.xyz);
              })
                .$elseif(pb.equal(this.ltype, LIGHT_TYPE_SPOT), function () {
                  this.atten = this.Z_spotAttenuation(this.p, this.posRange, this.dirCutoff, this.extra.xy);
                  this.Ld = pb.normalize(pb.sub(this.posRange.xyz, this.p));
                })
                .$else(function () {
                  // Point, and a rect light reduced to its centre
                  this.atten = this.Z_pointAttenuation(this.p, this.posRange);
                  this.Ld = pb.normalize(pb.sub(this.posRange.xyz, this.p));
                });
              this.$l.lc = pb.mul(
                this.albedo,
                this.colorIntensity.rgb,
                pb.mul(this.colorIntensity.w, this.atten, 1 / Math.PI)
              );
              for (let k = 0; k < 6; k++) {
                this.$if(this[`open${k}`], function () {
                  this[`acc${k}`] = pb.add(
                    this[`acc${k}`],
                    pb.mul(this.lc, pb.max(pb.dot(pb.vec3(...ANISO_DIRS[k]), this.Ld), 0))
                  );
                });
              }
            });
            // Ambient per open face: the sky, or where the probes cover the face
            // their irradiance, which carries the sky and every earlier bounce
            // (the recursion of Majercik et al. 2019, section 3.2; Godot reads
            // its probes per face the same way). An albedo short of 1 keeps the
            // loop convergent whatever the material claims. The emissive leaves
            // every open face.
            this.$l.feedback = pb.min(this.albedo, pb.vec3(0.9));
            this.$l.emissive = pb.textureLoad(this.emissiveTex, this.texel, 0).rgb;
            for (let k = 0; k < 6; k++) {
              this.$if(this[`open${k}`], function () {
                this.$l.faceDir = pb.vec3(...ANISO_DIRS[k]);
                this.$l.ambient = pb.vec3(0);
                if (skyIrradiance) {
                  this.ambient = pb.mul(envLight.getIrradiance(this, this.faceDir).rgb, this.params.y);
                }
                if (useProbes) {
                  this.$l.bounce = sampleProbeIrradiance(
                    this,
                    pb.add(this.p, pb.mul(this.faceDir, this.half)),
                    this.faceDir,
                    this.faceDir,
                    'feedback'
                  );
                  this.ambient = pb.mix(this.ambient, this.bounce.rgb, this.bounce.a);
                }
                this[`acc${k}`] = pb.add(this[`acc${k}`], pb.mul(this.feedback, this.ambient), this.emissive);
              });
            }
            // Stored as the sum, with the share of each face by luminance
            this.radiance = pb.add(this.acc0, this.acc1, this.acc2, this.acc3, this.acc4, this.acc5);
            this.$l.lumaTotal = pb.max(pb.max(this.radiance.r, this.radiance.g), this.radiance.b);
            this.$l.invLuma = this.$choice(
              pb.greaterThan(this.lumaTotal, 0),
              pb.div(1, pb.max(this.lumaTotal, 1e-8)),
              pb.float(0)
            );
            for (let k = 0; k < 6; k++) {
              this.$l[`luma${k}`] = pb.mul(
                pb.max(pb.max(this[`acc${k}`].r, this[`acc${k}`].g), this[`acc${k}`].b),
                this.invLuma
              );
            }
            this.aniso0 = pb.vec4(this.luma0, this.luma1, this.luma2, this.luma3);
            this.aniso1 = pb.vec4(this.luma4, this.luma5, 0, 0);
          });
          pb.textureStore(this.radianceOut, pb.uvec3(this.texel), pb.vec4(this.radiance, 1));
          pb.textureStore(this.aniso0Out, pb.uvec3(this.texel), this.aniso0);
          pb.textureStore(this.aniso1Out, pb.uvec3(this.texel), this.aniso1);
          this.$outputs.color = pb.vec4(0);
        });
      }
    });
  }
}
