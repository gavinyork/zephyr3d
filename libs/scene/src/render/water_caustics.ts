import type { Nullable } from '@zephyr3d/base';
import { Vector3, Vector4 } from '@zephyr3d/base';
import type {
  AbstractDevice,
  BindGroup,
  FrameBuffer,
  GPUProgram,
  PBGlobalScope,
  PBRenderOptions,
  ProgramBuilder,
  RenderStateSet,
  Texture2D,
  TextureFormat,
  VertexLayout
} from '@zephyr3d/device';
import type { DrawContext } from './drawable';
import type { WaveGenerator } from './wavegenerator';
import type { Water } from '../scene/water';
import type { PunctualLight } from '../scene/light';
import { drawFullscreenQuad } from './fullscreenquad';
import { fetchSampler } from '../utility/misc';
import { ShaderHelper } from '../material/shader/helper';

/** Index of refraction of water relative to air. */
const WATER_IOR = 1.333;
/** Air-to-water eta used when refracting the sun ray at the surface. */
const WATER_ETA = 1 / WATER_IOR;
/**
 * Minimum |sin(sun elevation)| for caustics to be generated.
 *
 * The photon grid is swept along the light direction onto the water plane, which
 * degenerates as the sun approaches the horizon. Real caustics vanish there too
 * (the surface turns into a mirror), so the pass simply switches off.
 */
const MIN_SUN_ELEVATION = 0.15;

/**
 * CPU-side parameters describing the caustic map, uploaded to the light pass.
 *
 * The map is a single orthographic slice of light space centred on the camera.
 * `frameX`/`frameY` are the two axes perpendicular to the light direction, so a
 * world position projects into the map with two dot products and no matrix.
 *
 * @public
 */
export interface WaterCausticUniforms {
  /** (right.xyz, 1 / coverage radius) */
  frameX: Vector4;
  /**
   * (up.xyz, clip-space y sign for the splat).
   *
   * The engine flips y when it renders into an offscreen target on WebGPU
   * (see `RenderPass.isAutoFlip`), so that every texture it produces samples
   * the same way regardless of backend. The splat writes clip positions
   * directly and has to apply that flip itself: -1 on WebGPU, 1 elsewhere.
   * Receivers sample the map with the plain `ndc * 0.5 + 0.5` the shadow maps
   * use and never read this component.
   */
  frameY: Vector4;
  /** (center.xyz, water surface level) */
  center: Vector4;
  /** (lightDir.xyz, 1 / max(-lightDir.y, MIN_SUN_ELEVATION)) */
  lightDir: Vector4;
  /** (intensity, focal depth, defocus rate, 0) */
  params: Vector4;
  /** (sigma_t.xyz, 0) */
  extinction: Vector4;
  /** Water region in world XZ: (minX, minZ, maxX, maxZ) */
  region: Vector4;
}

/** @internal */
type SplatProgramInfo = {
  program: GPUProgram;
  bindGroup: BindGroup;
};

/**
 * Shader for the photon splat pass.
 *
 * Everything happens in the vertex stage: one vertex is one photon, and the
 * position it emits is where that photon lands. The fragment stage only deposits
 * the weight, which additive blending accumulates.
 *
 * Returned as a descriptor rather than a built program so it can be compiled
 * against a bare {@link ProgramBuilder} in tests, without a device.
 *
 * @param waveGenerator - Supplies the surface displacement and normal.
 * @internal
 */
export function createCausticSplatShader(waveGenerator: WaveGenerator): PBRenderOptions {
  const setupUniforms = (scope: PBGlobalScope) => {
    const pb = scope.$builder;
    scope.causticFrameX = pb.vec4().uniform(0);
    scope.causticFrameY = pb.vec4().uniform(0);
    scope.causticCenter = pb.vec4().uniform(0);
    scope.causticLightDir = pb.vec4().uniform(0);
    scope.causticRegion = pb.vec4().uniform(0);
    scope.causticSplatParams = pb.vec4().uniform(0);
    // FBM and Gerstner animate from camera.elapsedTime, which this pass has to
    // supply itself - it is not one of the engine's camera passes.
    ShaderHelper.declareStandaloneCameraTime(scope, 0);
    waveGenerator.setupUniforms(scope, 0);
  };
  return {
    vertex(this: PBGlobalScope, pb: ProgramBuilder) {
      // Photon grid coordinate in [0, 1], one vertex per photon.
      this.$inputs.photonUV = pb.vec2().attrib('position');
      this.$outputs.photonWeight = pb.float();
      setupUniforms(this);
      pb.main(function () {
        this.$l.invRadius = this.causticSplatParams.x;
        this.$l.radius = pb.div(1, this.invRadius);
        this.$l.focalDepth = this.causticSplatParams.y;
        this.$l.eta = this.causticSplatParams.z;
        this.$l.L = this.causticLightDir.xyz;
        this.$l.waterLevel = this.causticCenter.w;
        // Grid position on the orthographic slice through the map centre.
        this.$l.ndc = pb.sub(pb.mul(this.$inputs.photonUV, 2), pb.vec2(1));
        this.$l.planePos = pb.add(
          this.causticCenter.xyz,
          pb.mul(this.causticFrameX.xyz, pb.mul(this.ndc.x, this.radius)),
          pb.mul(this.causticFrameY.xyz, pb.mul(this.ndc.y, this.radius))
        );
        // Sweep along the light direction onto the undisturbed water plane.
        this.$l.sweep = pb.div(pb.sub(this.waterLevel, this.planePos.y), this.L.y);
        this.$l.surfaceXZ = pb.add(this.planePos, pb.mul(this.L, this.sweep));
        this.$l.outside = pb.or(
          pb.any(pb.lessThan(this.surfaceXZ.xz, this.causticRegion.xy)),
          pb.any(pb.greaterThan(this.surfaceXZ.xz, this.causticRegion.zw))
        );
        // Displaced surface point and the detail normal that bends the ray. Both
        // wave generators sample with an explicit LOD, which is what makes this
        // legal in a vertex shader.
        this.$l.surfacePos = pb.vec3();
        this.$l.coarseNormal = pb.vec3();
        waveGenerator.calcVertexPositionAndNormal(this, this.surfaceXZ, this.surfacePos, this.coarseNormal);
        this.$l.normal = waveGenerator.calcFragmentNormal(this, this.surfaceXZ.xz, this.coarseNormal);
        // Refract, then subtract the deflection a flat surface would have
        // produced. Calm water then leaves the ray parallel to L, which lands
        // photon (i,j) back on texel (i,j) and normalises the map to 1.
        this.$l.refracted = pb.refract(this.L, this.normal, this.eta);
        this.$l.refractedFlat = pb.refract(this.L, pb.vec3(0, 1, 0), this.eta);
        this.$l.dir = pb.normalize(pb.add(pb.sub(this.refracted, this.refractedFlat), this.L));
        // Intersect the horizontal focal plane below the surface. The ray always
        // travels downwards here, but clamp anyway so a grazing ray cannot
        // produce an enormous or negative step.
        this.$l.targetY = pb.sub(this.waterLevel, this.focalDepth);
        this.$l.hitT = pb.div(pb.sub(this.targetY, this.surfacePos.y), pb.min(this.dir.y, -1e-4));
        this.$l.hitPos = pb.add(this.surfacePos, pb.mul(this.dir, pb.max(this.hitT, 0)));
        // Project the hit back into the map. frameX/frameY are perpendicular to
        // L and to each other, so this is just two dot products.
        this.$l.rel = pb.sub(this.hitPos, this.causticCenter.xyz);
        this.$l.hitNDC = pb.mul(
          pb.vec2(pb.dot(this.rel, this.causticFrameX.xyz), pb.dot(this.rel, this.causticFrameY.xyz)),
          this.invRadius
        );
        this.$outputs.photonWeight = this.causticSplatParams.w;
        // frameY.w carries the backend's offscreen y flip; without it the map
        // comes out upside down on WebGPU relative to how receivers sample it.
        this.$builtins.position = pb.vec4(this.hitNDC.x, pb.mul(this.hitNDC.y, this.causticFrameY.w), 0, 1);
        if (pb.getDevice().type !== 'webgpu') {
          // GLSL leaves gl_PointSize undefined unless it is written, and an
          // undefined size rasterises nothing at all - the map comes back empty.
          // WebGPU has no equivalent; its points are always one pixel.
          this.$builtins.pointSize = 1;
        }
        this.$if(this.outside, function () {
          // Park the photon outside the clip volume so it is discarded. Keep
          // w at 1: a zero w would divide to NaN instead of clipping.
          this.$builtins.position = pb.vec4(-2, -2, 0, 1);
        });
      });
    },
    fragment(this: PBGlobalScope, pb: ProgramBuilder) {
      this.$outputs.outColor = pb.vec4();
      pb.main(function () {
        this.$outputs.outColor = pb.vec4(this.$inputs.photonWeight, 0, 0, 1);
      });
    }
  };
}

/**
 * Shader for the caustic map blur.
 *
 * Four bilinear taps at the texel corners average a 2x2 neighbourhood. The
 * weights sum to one, so the "calm water reads 1.0" normalisation established by
 * the accumulation pass survives any number of iterations.
 *
 * @internal
 */
export function createCausticBlurShader(): PBRenderOptions {
  return {
    vertex(this: PBGlobalScope, pb: ProgramBuilder) {
      this.$inputs.pos = pb.vec2().attrib('position');
      this.$outputs.uv = pb.vec2();
      pb.main(function () {
        this.$builtins.position = pb.vec4(this.$inputs.pos, 0, 1);
        this.$outputs.uv = pb.add(pb.mul(this.$inputs.pos, 0.5), pb.vec2(0.5));
      });
    },
    fragment(this: PBGlobalScope, pb: ProgramBuilder) {
      this.causticSrc = pb.tex2D().uniform(0);
      this.causticTexelSize = pb.vec4().uniform(0);
      this.$outputs.outColor = pb.vec4();
      pb.main(function () {
        this.$l.o = pb.mul(this.causticTexelSize.xy, 0.5);
        this.$l.sum = pb.add(
          pb.textureSampleLevel(this.causticSrc, pb.add(this.$inputs.uv, pb.vec2(this.o.x, this.o.y)), 0),
          pb.textureSampleLevel(
            this.causticSrc,
            pb.add(this.$inputs.uv, pb.vec2(pb.neg(this.o.x), this.o.y)),
            0
          ),
          pb.textureSampleLevel(
            this.causticSrc,
            pb.add(this.$inputs.uv, pb.vec2(this.o.x, pb.neg(this.o.y))),
            0
          ),
          pb.textureSampleLevel(
            this.causticSrc,
            pb.add(this.$inputs.uv, pb.vec2(pb.neg(this.o.x), pb.neg(this.o.y))),
            0
          )
        );
        this.$outputs.outColor = pb.vec4(pb.mul(this.sum.x, 0.25), 0, 0, 1);
      });
    }
  };
}

/**
 * Renders the water caustic map.
 *
 * One photon is emitted per texel of a uniform grid laid out on the same
 * orthographic light-space slice the map covers. Each photon is refracted at the
 * water surface, intersected with a horizontal focal plane below it, and splatted
 * additively at the hit position. Because the grid and the map share a
 * parameterisation, and the mean deflection of a flat surface is removed from the
 * refracted direction, calm water maps photon `(i,j)` onto texel `(i,j)` and the
 * map converges to a uniform 1.0 - which the receiver treats as "no caustics".
 *
 * @internal
 */
export class WaterCausticsRenderer {
  /** Splat programs keyed by the wave generator's shader hash. */
  private readonly _splatPrograms: Map<string, SplatProgramInfo>;
  private _blurProgram: Nullable<GPUProgram>;
  private _blurBindGroup: Nullable<BindGroup>;
  private _photonLayout: Nullable<VertexLayout>;
  private _photonGridSize: number;
  private _photonCount: number;
  private _splatStates: Nullable<RenderStateSet>;
  private _blurStates: Nullable<RenderStateSet>;
  private readonly _uniforms: WaterCausticUniforms;
  private readonly _tmpRight: Vector3;
  private readonly _tmpUp: Vector3;
  private readonly _tmpDir: Vector3;
  private readonly _tmpCenter: Vector3;
  private readonly _splatParams: Vector4;
  private readonly _blurTexelSize: Vector4;
  constructor() {
    this._splatPrograms = new Map();
    this._blurProgram = null;
    this._blurBindGroup = null;
    this._photonLayout = null;
    this._photonGridSize = 0;
    this._photonCount = 0;
    this._splatStates = null;
    this._blurStates = null;
    this._uniforms = {
      frameX: new Vector4(),
      frameY: new Vector4(),
      center: new Vector4(),
      lightDir: new Vector4(),
      params: new Vector4(),
      extinction: new Vector4(),
      region: new Vector4()
    };
    this._tmpRight = new Vector3();
    this._tmpUp = new Vector3();
    this._tmpDir = new Vector3();
    this._tmpCenter = new Vector3();
    this._splatParams = new Vector4();
    this._blurTexelSize = new Vector4();
  }
  /** Parameters of the map produced by the last successful {@link render}. */
  get uniforms(): WaterCausticUniforms {
    return this._uniforms;
  }
  /**
   * Storage format for the caustic map.
   *
   * Single channel when the device can both render to and filter it; the map is
   * accumulated with additive blending and sampled bilinearly, so it needs both.
   */
  static getMapFormat(device: AbstractDevice): TextureFormat {
    const info = device.getDeviceCaps().textureCaps.getTextureFormatInfo('r16f');
    return info.renderable && info.filterable ? 'r16f' : 'rgba16f';
  }
  /**
   * Whether caustics can be produced for this water surface and light.
   *
   * @param water - Water surface the photons are refracted through.
   * @param light - Directional light the photons come from.
   * @returns True when {@link render} would produce a usable map.
   */
  static canRender(water: Water, light: PunctualLight): boolean {
    const material = water.material;
    if (!material?.causticsEnabled || !material.waveGenerator || !light.isDirectionLight()) {
      return false;
    }
    // Sun too close to the horizon: the swept photon grid degenerates.
    return -light.directionAndCutoff.y >= MIN_SUN_ELEVATION;
  }
  /**
   * Builds the caustic map for one water surface.
   *
   * @param ctx - Draw context; supplies the device and the camera the map is centred on.
   * @param water - Water surface to refract through.
   * @param light - Directional light acting as the photon source.
   * @param map - Accumulation target, also the final result.
   * @param scratch - Ping-pong target for the blur; same size and format as `map`.
   * @param createFramebuffer - Wraps a target texture into a framebuffer.
   */
  render(
    ctx: DrawContext,
    water: Water,
    light: PunctualLight,
    map: Texture2D,
    scratch: Texture2D,
    createFramebuffer: (texture: Texture2D) => FrameBuffer
  ): void {
    const device = ctx.device;
    const material = water.material;
    const waveGenerator = material.waveGenerator!;
    this._updateUniforms(ctx, water, light, map.width);
    const photonGrid = Math.max(8, Math.min(material.causticsPhotonResolution, 4096));
    this._updatePhotonLayout(device, photonGrid);
    const splat = this._getSplatProgram(device, waveGenerator);
    const bindGroup = splat.bindGroup;
    bindGroup.setValue('causticFrameX', this._uniforms.frameX);
    bindGroup.setValue('causticFrameY', this._uniforms.frameY);
    bindGroup.setValue('causticCenter', this._uniforms.center);
    bindGroup.setValue('causticLightDir', this._uniforms.lightDir);
    bindGroup.setValue('causticRegion', this._uniforms.region);
    // A photon grid denser than the map deposits more than one photon per texel;
    // scale the deposit so a flat surface still integrates to exactly 1.
    const photonWeight = (map.width * map.height) / (photonGrid * photonGrid);
    this._splatParams.setXYZW(this._uniforms.frameX.w, material.causticsDepth, WATER_ETA, photonWeight);
    bindGroup.setValue('causticSplatParams', this._splatParams);
    ShaderHelper.setStandaloneCameraTime(bindGroup, ctx);
    waveGenerator.applyWaterBindGroup(bindGroup);

    device.pushDeviceStates();
    const mapFramebuffer = createFramebuffer(map);
    device.setFramebuffer(mapFramebuffer);
    // The viewport and scissor survive a framebuffer change, and this pass runs
    // straight after the shadow maps, whose targets are a different size. Without
    // this reset the photons rasterise against the shadow map's viewport and
    // almost all of them land outside the caustic map.
    device.setViewport(null);
    device.setScissor(null);
    device.clearFrameBuffer(Vector4.zero(), null, null);
    device.setProgram(splat.program);
    device.setBindGroup(0, bindGroup);
    device.setRenderStates(this._getSplatStates(device));
    device.setVertexLayout(this._photonLayout);
    device.draw('point-list', 0, this._photonCount);
    device.popDeviceStates();

    // Ping-pong between the two targets. The count is rounded up to an even
    // number by the material so the last pass always lands back in `map`.
    const blurPasses = Math.max(0, Math.min(material.causticsBlurPasses, 4));
    for (let i = 0; i < blurPasses; i++) {
      const src = i % 2 === 0 ? map : scratch;
      const dst = i % 2 === 0 ? scratch : map;
      this._blur(device, src, createFramebuffer(dst));
    }
  }
  /** Releases the GPU objects owned by this renderer. */
  dispose(): void {
    for (const info of this._splatPrograms.values()) {
      info.bindGroup.dispose();
      info.program.dispose();
    }
    this._splatPrograms.clear();
    this._blurBindGroup?.dispose();
    this._blurBindGroup = null;
    this._blurProgram?.dispose();
    this._blurProgram = null;
    this._photonLayout?.dispose();
    this._photonLayout = null;
    this._photonGridSize = 0;
    this._photonCount = 0;
    this._splatStates = null;
    this._blurStates = null;
  }
  /** @internal */
  private _blur(device: AbstractDevice, src: Texture2D, dst: FrameBuffer): void {
    const program = this._getBlurProgram(device);
    device.pushDeviceStates();
    device.setFramebuffer(dst);
    device.setProgram(program);
    this._blurBindGroup!.setTexture('causticSrc', src, fetchSampler('clamp_linear_nomip'));
    this._blurTexelSize.setXYZW(1 / src.width, 1 / src.height, 0, 0);
    this._blurBindGroup!.setValue('causticTexelSize', this._blurTexelSize);
    device.setBindGroup(0, this._blurBindGroup!);
    drawFullscreenQuad(this._getBlurStates(device));
    device.popDeviceStates();
  }
  /**
   * Recomputes the orthographic light-space slice the map covers.
   * @internal
   */
  private _updateUniforms(ctx: DrawContext, water: Water, light: PunctualLight, mapSize: number): void {
    const material = water.material;
    const dir = this._tmpDir;
    dir.set(light.directionAndCutoff.xyz());
    dir.inplaceNormalize();
    // Two axes perpendicular to the light direction. Any pair will do; picking a
    // world axis that is not parallel to the light keeps the cross products stable.
    const seed = Math.abs(dir.y) > 0.99 ? Vector3.axisPZ() : Vector3.axisPY();
    Vector3.cross(seed, dir, this._tmpRight);
    this._tmpRight.inplaceNormalize();
    Vector3.cross(dir, this._tmpRight, this._tmpUp);
    this._tmpUp.inplaceNormalize();
    const right = this._tmpRight;
    const up = this._tmpUp;
    const waterLevel = water.worldMatrix.m13;
    const radius = Math.max(1, material.causticsRange);
    const camera = ctx.camera.getWorldPosition();
    // Centre the slice on the camera, projected onto the water plane.
    const center = this._tmpCenter.setXYZ(camera.x, waterLevel, camera.z);
    // Snap the two in-plane components to whole texels so the map does not crawl
    // as the camera moves; the component along the light direction is irrelevant
    // because both projection and the photon sweep are invariant along it.
    const texelSize = (2 * radius) / mapSize;
    const alongRight = Math.round(Vector3.dot(center, right) / texelSize) * texelSize;
    const alongUp = Math.round(Vector3.dot(center, up) / texelSize) * texelSize;
    const alongDir = Vector3.dot(center, dir);
    center.setXYZ(
      right.x * alongRight + up.x * alongUp + dir.x * alongDir,
      right.y * alongRight + up.y * alongUp + dir.y * alongDir,
      right.z * alongRight + up.z * alongUp + dir.z * alongDir
    );
    const u = this._uniforms;
    u.frameX.setXYZW(right.x, right.y, right.z, 1 / radius);
    // Same rule as RenderPass.isAutoFlip: this pass always has a framebuffer
    // bound, so only the backend decides.
    u.frameY.setXYZW(up.x, up.y, up.z, ctx.device.type === 'webgpu' ? -1 : 1);
    u.center.setXYZW(center.x, center.y, center.z, waterLevel);
    u.lightDir.setXYZW(dir.x, dir.y, dir.z, 1 / Math.max(-dir.y, MIN_SUN_ELEVATION));
    u.params.setXYZW(material.causticsIntensity, material.causticsDepth, material.causticsDefocus, 0);
    const extinction = material.extinction;
    u.extinction.setXYZW(extinction.x, extinction.y, extinction.z, 0);
    u.region.set(material.region);
  }
  /** @internal */
  private _updatePhotonLayout(device: AbstractDevice, gridSize: number): void {
    if (this._photonLayout && this._photonGridSize === gridSize) {
      return;
    }
    this._photonLayout?.dispose();
    // One vertex per photon carrying its grid coordinate. WebGL2 refuses to draw
    // without a bound vertex layout, so the grid is materialised rather than
    // derived from the vertex index.
    const coords = new Float32Array(gridSize * gridSize * 2);
    const inv = 1 / gridSize;
    for (let j = 0; j < gridSize; j++) {
      for (let i = 0; i < gridSize; i++) {
        const k = (j * gridSize + i) * 2;
        coords[k] = (i + 0.5) * inv;
        coords[k + 1] = (j + 0.5) * inv;
      }
    }
    this._photonLayout = device.createVertexLayout({
      vertexBuffers: [{ buffer: device.createVertexBuffer('position_f32x2', coords)! }]
    });
    this._photonGridSize = gridSize;
    this._photonCount = gridSize * gridSize;
  }
  /** @internal */
  private _getSplatStates(device: AbstractDevice): RenderStateSet {
    if (!this._splatStates) {
      this._splatStates = device.createRenderStateSet();
      this._splatStates.useRasterizerState().setCullMode('none');
      this._splatStates.useDepthState().enableTest(false).enableWrite(false);
      // Photon accumulation: every splat adds to whatever is already there.
      this._splatStates
        .useBlendingState()
        .enable(true)
        .setBlendFunc('one', 'one')
        .setBlendEquation('add', 'add');
    }
    return this._splatStates;
  }
  /** @internal */
  private _getBlurStates(device: AbstractDevice): RenderStateSet {
    if (!this._blurStates) {
      this._blurStates = device.createRenderStateSet();
      this._blurStates.useRasterizerState().setCullMode('none');
      this._blurStates.useDepthState().enableTest(false).enableWrite(false);
    }
    return this._blurStates;
  }
  /** @internal */
  private _getSplatProgram(device: AbstractDevice, waveGenerator: WaveGenerator): SplatProgramInfo {
    const key = waveGenerator.getHash();
    let info = this._splatPrograms.get(key);
    if (info) {
      return info;
    }
    const program = device.buildRenderProgram(createCausticSplatShader(waveGenerator))!;
    program.name = '@Water_CausticSplat';
    info = { program, bindGroup: device.createBindGroup(program.bindGroupLayouts[0])! };
    this._splatPrograms.set(key, info);
    return info;
  }
  /** @internal */
  private _getBlurProgram(device: AbstractDevice): GPUProgram {
    if (!this._blurProgram) {
      this._blurProgram = device.buildRenderProgram(createCausticBlurShader())!;
      this._blurProgram.name = '@Water_CausticBlur';
      this._blurBindGroup = device.createBindGroup(this._blurProgram.bindGroupLayouts[0])!;
    }
    return this._blurProgram;
  }
}
