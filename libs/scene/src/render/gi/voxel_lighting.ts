import type { BindGroup, FrameBuffer, GPUProgram, RenderStateSet, Texture3D } from '@zephyr3d/device';
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
import { PHYSICAL_BAKE_EXPOSURE } from '../../utility/physical';
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
/** Cone tracing steps of the sun shadow. */
const SHADOW_STEPS = 24;

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
 * a ray of the global illumination picks up where it hits.
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
  private _resolution: number;
  private _levels: number;
  private _program: Nullable<GPUProgram>;
  private _programKey: string;
  private _bindGroup: Nullable<BindGroup>;
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
    this._resolution = 0;
    this._levels = 0;
    this._program = null;
    this._programKey = '';
    this._bindGroup = null;
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
      this._resolution = resolution;
      this._levels = global.levels;
      this._radiance = device.createTexture3D('rgba16f', resolution, resolution, resolution * global.levels, {
        mipmapping: false,
        writable: true
      })!;
      this._radiance.name = '@VoxelSceneRadiance';
      this._zStart = 0;
    }
    const envLight = scene.env.light.envLight;
    const physical = scene.lightingMode === 'physical';
    const preExposure = physical ? camera.exposure : 1;
    const envStrength = physical
      ? (preExposure / PHYSICAL_BAKE_EXPOSURE) * (scene.env.light.strength ?? 0)
      : (scene.env.light.strength ?? 0);
    const skyIrradiance = !!envLight && envLight.hasIrradiance();
    const probes = getActiveProbeVolume(scene);
    const key = `${global.levels}:${scene.lightingMode}:${skyIrradiance ? envLight.getType() : 'none'}:${
      skyIrradiance ? this.envVariant() : ''
    }:probes${probes ? 1 : 0}`;
    if (!this._program || this._programKey !== key) {
      this._bindGroup?.dispose();
      this._program?.dispose();
      this._program = this.createProgram(global.levels, physical, skyIrradiance, !!probes);
      this._programKey = key;
      this._bindGroup = device.createBindGroup(this._program.bindGroupLayouts[0]);
    }
    const numLights = this.collectLights(camera, preExposure);
    const slices = Math.max(1, Math.min(resolution, Math.floor(options.slicesPerFrame)));
    const bg = this._bindGroup!;
    global.applyBindGroup(bg);
    bg.setTexture('albedoTex', albedo, fetchSampler('clamp_nearest_nomip'));
    bg.setTexture('emissiveTex', emissive, fetchSampler('clamp_nearest_nomip'));
    bg.setTexture('radianceOut', this._radiance);
    bg.setValue('lights', this._lightData);
    bg.setValue('sunDir', this._sunDir);
    bg.setValue('sunColor', this._sunColor);
    const tanHalf = Math.tan((Math.max(0.1, options.sunShadowConeAngle) * Math.PI) / 180);
    this._params.setXYZW(numLights, envStrength, tanHalf, 0);
    bg.setValue('params', this._params);
    this._slab.setXYZW(resolution, global.levels, slices, this._zStart);
    bg.setValue('slab', this._slab);
    if (skyIrradiance) {
      envLight.updateBindGroup(bg);
    }
    probes?.applyBindGroup(bg);
    if (!this._renderStates) {
      this._renderStates = device.createRenderStateSet();
      this._renderStates.useDepthState().enableTest(false).enableWrite(false);
      this._renderStates.useRasterizerState().setCullMode('none');
      this._renderStates.useColorState().setColorMask(false, false, false, false);
    }
    const width = resolution;
    const height = resolution * slices * global.levels;
    let fb: Nullable<FrameBuffer> = null;
    device.pushDeviceStates();
    try {
      fb = device.pool.fetchTemporalFramebuffer(false, width, height, 'rgba8unorm');
      device.setFramebuffer(fb);
      device.setViewport([0, 0, width, height]);
      device.setScissor([0, 0, width, height]);
      device.setProgram(this._program);
      device.setBindGroup(0, bg);
      drawFullscreenQuad(this._renderStates);
    } finally {
      device.popDeviceStates();
      if (fb) {
        device.pool.releaseFrameBuffer(fb);
      }
    }
    this._zStart = (this._zStart + slices) % resolution;
    this._passes++;
  }
  dispose() {
    this._radiance?.dispose();
    this._radiance = null;
    this._bindGroup?.dispose();
    this._bindGroup = null;
    this._program?.dispose();
    this._program = null;
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
   * pre-exposure, as the clustered light buffer does.
   * @internal
   */
  private collectLights(camera: Camera, preExposure: number) {
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
      this._sunColor.setXYZW(c.x * c.w * preExposure, c.y * c.w * preExposure, c.z * c.w * preExposure, 0);
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
      data[o + 11] = c.w * preExposure;
      data.set(light.extraParams, o + 12);
    }
    return count;
  }
  /** @internal */
  private createProgram(levels: number, physical: boolean, skyIrradiance: boolean, useProbes: boolean) {
    const scene = this._scene;
    const envLight = scene.env.light.envLight;
    return buildSDFProgram({
      label: 'VoxelLighting',
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
        this.lights = pb.vec4[MAX_VOXEL_LIGHTS * LIGHT_VEC4S]().uniform(0);
        // (direction the light travels, 1 when there is a sun)
        this.sunDir = pb.vec4().uniform(0);
        this.sunColor = pb.vec4().uniform(0);
        // (light count, environment strength, tan of the shadow cone half angle, 0)
        this.params = pb.vec4().uniform(0);
        // (resolution, levels, slices per pass, first slice)
        this.slab = pb.vec4().uniform(0);
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
          this.$l.slices = pb.int(this.slab.z);
          this.$l.fc = pb.ivec2(pb.floor(this.$builtins.fragCoord.xy));
          this.$l.rowsPerLevel = pb.mul(this.res, this.slices);
          this.$l.level = pb.div(this.fc.y, this.rowsPerLevel);
          this.$l.rem = pb.sub(this.fc.y, pb.mul(this.level, this.rowsPerLevel));
          this.$l.z = pb.add(pb.int(this.slab.w), pb.div(this.rem, this.res));
          this.$l.t = pb.ivec3(
            this.fc.x,
            pb.sub(this.rem, pb.mul(pb.div(this.rem, this.res), this.res)),
            this.z
          );
          this.$l.tz = pb.add(this.t.z, pb.mul(this.level, this.res));
          this.$l.texel = pb.ivec3(this.t.x, this.t.y, this.tz);
          this.$l.radiance = pb.vec3(0);
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
            // Normal from the field's gradient at the voxel
            this.$l.h = this.info.w;
            this.$l.d0 = sampleGlobalSDF(this, this.p, levels);
            this.$l.g = pb.vec3(
              pb.sub(sampleGlobalSDF(this, pb.add(this.p, pb.vec3(this.h, 0, 0)), levels), this.d0),
              pb.sub(sampleGlobalSDF(this, pb.add(this.p, pb.vec3(0, this.h, 0)), levels), this.d0),
              pb.sub(sampleGlobalSDF(this, pb.add(this.p, pb.vec3(0, 0, this.h)), levels), this.d0)
            );
            this.$l.n = pb.div(this.g, pb.max(pb.length(this.g), 1e-6));
            // Lit from just off the surface along the normal
            this.$l.surf = pb.sub(this.p, pb.mul(this.n, this.d0));
            this.$l.ps = pb.add(this.surf, pb.mul(this.n, this.vs));
            // Ambient: the sky, or where the probes cover the voxel their
            // irradiance, which carries the sky and every earlier bounce
            // (the recursion of Majercik et al. 2019, section 3.2)
            this.$l.ambient = pb.vec3(0);
            if (skyIrradiance) {
              this.ambient = pb.mul(envLight.getIrradiance(this, this.n).rgb, this.params.y);
            }
            if (useProbes) {
              this.$l.bounce = sampleProbeIrradiance(this, this.ps, this.n, this.n);
              this.ambient = pb.mix(this.ambient, this.bounce.rgb, this.bounce.a);
            }
            this.$l.light = pb.vec3(0);
            this.$if(pb.greaterThan(this.sunDir.w, 0.5), function () {
              this.$l.L = pb.neg(this.sunDir.xyz);
              this.$l.NoL = pb.dot(this.n, this.L);
              this.$if(pb.greaterThan(this.NoL, 0), function () {
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
                this.light = pb.add(
                  this.light,
                  pb.mul(this.sunColor.rgb, this.NoL, this.shadow, 1 / Math.PI)
                );
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
                  this.atten = this.Z_spotAttenuation(this.ps, this.posRange, this.dirCutoff, this.extra.xy);
                  this.Ld = pb.normalize(pb.sub(this.posRange.xyz, this.ps));
                })
                .$else(function () {
                  // Point, and a rect light reduced to its centre
                  this.atten = this.Z_pointAttenuation(this.ps, this.posRange);
                  this.Ld = pb.normalize(pb.sub(this.posRange.xyz, this.ps));
                });
              this.$l.NoL2 = pb.max(pb.dot(this.n, this.Ld), 0);
              this.light = pb.add(
                this.light,
                pb.mul(
                  this.colorIntensity.rgb,
                  pb.mul(this.colorIntensity.w, this.NoL2, this.atten, 1 / Math.PI)
                )
              );
            });
            this.$l.emissive = pb.textureLoad(this.emissiveTex, this.texel, 0).rgb;
            // The ambient feeds back through the probes; an albedo short of 1
            // keeps the loop convergent whatever the material claims
            this.radiance = pb.add(
              pb.mul(this.a.rgb, this.light),
              pb.mul(pb.min(this.a.rgb, pb.vec3(0.9)), this.ambient),
              this.emissive
            );
          });
          pb.textureStore(this.radianceOut, pb.uvec3(this.texel), pb.vec4(this.radiance, 1));
          this.$outputs.color = pb.vec4(0);
        });
      }
    });
  }
}
