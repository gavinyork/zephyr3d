import type {
  BindGroup,
  FrameBuffer,
  GPUDataBuffer,
  GPUProgram,
  RenderStateSet,
  Texture2D
} from '@zephyr3d/device';
import type { Nullable, Vector3 } from '@zephyr3d/base';
import { PRNG, Vector4 } from '@zephyr3d/base';
import { getDevice } from '../../app/api';
import type { Scene } from '../../scene/scene';
import type { Camera } from '../../camera/camera';
import type { DrawContext } from '../drawable';
import type { SceneSDF } from '../sdf/scene_sdf';
import type { VoxelScene } from './voxel_scene';
import { buildSDFProgram } from '../sdf/sdf_programs';
import { drawFullscreenQuad } from '../fullscreenquad';
import { fetchSampler } from '../../utility/misc';
import { PHYSICAL_BAKE_EXPOSURE } from '../../utility/physical';
import { RENDER_PASS_TYPE_LIGHT } from '../../values';
import { declareDynamicSDFUniforms, declareGlobalSDFUniforms, sampleSceneSDF } from '../../shaders/sdf';
import {
  declareVoxelSceneUniforms,
  loadVoxelSceneRadiance,
  VOXEL_SCENE_ALBEDO,
  VOXEL_SCENE_EMISSIVE,
  VOXEL_SCENE_RADIANCE,
  voxelSceneTexel
} from '../../shaders/gi';
import {
  octDecode,
  PROBE_DATA,
  PROBE_IRRADIANCE,
  PROBE_PARAM_VEC4S,
  PROBE_PARAMS,
  PROBE_VISIBILITY,
  probePosition,
  probeTexelFromIndex,
  probeTileOrigin,
  probeWorldFromTexel,
  quatRotate,
  sphericalFibonacci
} from '../../shaders/probes';

/** Texels of an irradiance tile, border included. */
const IRRADIANCE_TEXELS = 8;
/** Texels of a visibility tile, border included. */
const VISIBILITY_TEXELS = 16;
/** Sphere tracing steps of a probe ray. */
const TRACE_STEPS = 48;
/** Frames between relocations of an updated probe. */
const RELOCATE_EVERY = 8;

/**
 * Settings of the probe volume, on {@link SceneGI}.
 * @public
 */
export interface ProbeVolumeOptions {
  /** Probes along x, y and z. */
  grid: [number, number, number];
  /** Distance between probes in world units. */
  spacing: number;
  /** Rays traced per probe per update. */
  raysPerProbe: number;
  /** Probes updated per frame. */
  budget: number;
  /** Share of the previous value kept per update, 0 to 1. */
  hysteresis: number;
  /** Surface offset along the normal when sampling, in world units. */
  normalBias: number;
  /** Surface offset towards the viewer when sampling, in world units. */
  viewBias: number;
  /** Multiplier on the irradiance the probes give. */
  intensity: number;
  /** Distance a probe ray gives up at, in world units. */
  maxRayDistance: number;
}

/**
 * Counters of a {@link ProbeVolume}.
 * @public
 */
export interface ProbeVolumeStats {
  probes: number;
  /** Probes never updated since entering the window. */
  uninitialized: number;
  /** Probes updated by the last frame. */
  lastUpdated: number;
  updates: number;
  /** World index of the window's first probe. */
  origin: [number, number, number];
}

/**
 * The probe volume for the draw, or null when the draw does not read it: not
 * the light pass, the environment light off, global illumination disabled or
 * not yet built.
 * @internal
 */
export function getProbeVolumeForDraw(ctx?: DrawContext): Nullable<ProbeVolume> {
  if (
    !ctx ||
    ctx.renderPass?.type !== RENDER_PASS_TYPE_LIGHT ||
    !ctx.drawEnvLight ||
    !ctx.scene?.gi.enabled
  ) {
    return null;
  }
  const probes = ctx.scene.gi.probes;
  return probes?.ready ? probes : null;
}

/**
 * A grid of light probes around the camera holding the diffuse irradiance and
 * the distance to the nearest surface per direction, as octahedral maps:
 * dynamic diffuse global illumination after Majercik et al. (JCGT 2019; the
 * scrolling window, relocation and classification of JCGT 2021). Each frame a
 * budget of probes traces a set of rays through the scene field, reads the
 * voxel scene's radiance where they hit and the sky where they miss, and
 * blends the result into its maps with hysteresis. Surfaces in the light pass
 * read the volume through the environment light's irradiance
 * ({@link sampleProbeIrradiance}).
 *
 * The window follows the camera a spacing at a time, probes addressed
 * toroidally by world index; a probe entering the window starts over.
 * Probes inside geometry or too near it are pushed out along the field's
 * gradient.
 *
 * WebGPU only.
 *
 * @public
 */
export class ProbeVolume {
  private readonly _scene: Scene;
  private readonly _options: ProbeVolumeOptions;
  private readonly _grid: [number, number, number];
  private readonly _count: number;
  private readonly _tileCols: number;
  private readonly _rays: number;
  private readonly _budget: number;
  private _irradiance: Nullable<Texture2D>;
  private _irradianceNext: Nullable<Texture2D>;
  private _visibility: Nullable<Texture2D>;
  private _visibilityNext: Nullable<Texture2D>;
  private _rayTexture: Nullable<Texture2D>;
  private _rayFramebuffer: Nullable<FrameBuffer>;
  private _data: Nullable<GPUDataBuffer>;
  private _selected: Nullable<GPUDataBuffer>;
  private readonly _state: Uint8Array;
  private readonly _lastRelocated: Int32Array;
  private readonly _selection: Uint32Array<ArrayBuffer>;
  private readonly _dataReset: Float32Array<ArrayBuffer>;
  private _origin: Nullable<[number, number, number]>;
  private _cursor: number;
  private _frame: number;
  private _updates: number;
  private _lastUpdated: number;
  private readonly _params: Float32Array<ArrayBuffer>;
  private readonly _rotation: Vector4;
  private readonly _prng: PRNG;
  private _relocateProgram: Nullable<GPUProgram>;
  private _relocateBindGroup: Nullable<BindGroup>;
  private _traceProgram: Nullable<GPUProgram>;
  private _traceBindGroup: Nullable<BindGroup>;
  private _traceKey: string;
  private _blendIrrProgram: Nullable<GPUProgram>;
  private _blendIrrBindGroup: Nullable<BindGroup>;
  private _blendVisProgram: Nullable<GPUProgram>;
  private _blendVisBindGroup: Nullable<BindGroup>;
  private _renderStates: Nullable<RenderStateSet>;
  constructor(scene: Scene, options: ProbeVolumeOptions) {
    this._scene = scene;
    this._options = options;
    this._grid = options.grid.map((v) => Math.max(2, Math.floor(v))) as [number, number, number];
    this._count = this._grid[0] * this._grid[1] * this._grid[2];
    this._tileCols = Math.ceil(Math.sqrt(this._count));
    this._rays = Math.max(16, Math.min(1024, Math.floor(options.raysPerProbe)));
    this._budget = Math.max(1, Math.min(this._count, Math.floor(options.budget)));
    this._irradiance = null;
    this._irradianceNext = null;
    this._visibility = null;
    this._visibilityNext = null;
    this._rayTexture = null;
    this._rayFramebuffer = null;
    this._data = null;
    this._selected = null;
    this._state = new Uint8Array(this._count);
    this._lastRelocated = new Int32Array(this._count).fill(-1000);
    this._selection = new Uint32Array(this._budget);
    this._dataReset = new Float32Array(4);
    this._origin = null;
    this._cursor = 0;
    this._frame = 0;
    this._updates = 0;
    this._lastUpdated = 0;
    this._params = new Float32Array(PROBE_PARAM_VEC4S * 4);
    this._rotation = new Vector4(0, 0, 0, 1);
    this._prng = new PRNG(1234);
    this._relocateProgram = null;
    this._relocateBindGroup = null;
    this._traceProgram = null;
    this._traceBindGroup = null;
    this._traceKey = '';
    this._blendIrrProgram = null;
    this._blendIrrBindGroup = null;
    this._blendVisProgram = null;
    this._blendVisBindGroup = null;
    this._renderStates = null;
  }
  get grid(): [number, number, number] {
    return this._grid;
  }
  get spacing() {
    return this._options.spacing;
  }
  /** True once the volume has been placed and updated. */
  get ready() {
    return !!this._origin && this._updates > 0;
  }
  getStats(): ProbeVolumeStats {
    let uninitialized = 0;
    for (let i = 0; i < this._count; i++) {
      uninitialized += this._state[i] ? 0 : 1;
    }
    return {
      probes: this._count,
      uninitialized,
      lastUpdated: this._lastUpdated,
      updates: this._updates,
      origin: this._origin ? [...this._origin] : [0, 0, 0]
    };
  }
  /** Binds the volume for {@link sampleProbeIrradiance} in a program that declared it. */
  applyBindGroup(bg: BindGroup) {
    if (!this._irradiance || !this._visibility || !this._data) {
      return;
    }
    bg.setTexture(PROBE_IRRADIANCE, this._irradiance, fetchSampler('clamp_linear_nomip'));
    bg.setTexture(PROBE_VISIBILITY, this._visibility, fetchSampler('clamp_linear_nomip'));
    bg.setBuffer(PROBE_DATA, this._data);
    bg.setValue(PROBE_PARAMS, this._params);
  }
  /**
   * Follows the camera and updates a budget of probes. Called by the scene
   * once a frame after the voxel scene is lit, which the rays read.
   */
  update(sdf: SceneSDF, voxels: VoxelScene, camera: Camera) {
    const global = sdf.enabled ? sdf.global : null;
    if (!global || !voxels.lit) {
      return;
    }
    const device = getDevice();
    this.ensureResources();
    this.moveWindow(camera.getWorldPosition());
    this._frame++;
    const selected = this.select();
    if (selected === 0) {
      return;
    }
    this._selected!.bufferSubData(0, this._selection);
    // A fresh random rotation of the ray set each update
    this.randomRotation();
    this.updateParams();
    this.runRelocate(global, selected);
    this.runTrace(global, voxels, camera, selected);
    this.runBlend(selected);
    device.copyTexture2D(this._irradianceNext!, 0, this._irradiance!, 0);
    device.copyTexture2D(this._visibilityNext!, 0, this._visibility!, 0);
    this._updates++;
    this._lastUpdated = selected;
  }
  dispose() {
    for (const tex of [
      this._irradiance,
      this._irradianceNext,
      this._visibility,
      this._visibilityNext,
      this._rayTexture
    ]) {
      tex?.dispose();
    }
    this._irradiance =
      this._irradianceNext =
      this._visibility =
      this._visibilityNext =
      this._rayTexture =
        null;
    this._rayFramebuffer?.dispose();
    this._rayFramebuffer = null;
    this._data?.dispose();
    this._selected?.dispose();
    this._data = this._selected = null;
    for (const bg of [
      this._relocateBindGroup,
      this._traceBindGroup,
      this._blendIrrBindGroup,
      this._blendVisBindGroup
    ]) {
      bg?.dispose();
    }
    for (const prog of [
      this._relocateProgram,
      this._traceProgram,
      this._blendIrrProgram,
      this._blendVisProgram
    ]) {
      prog?.dispose();
    }
    this._relocateBindGroup = this._traceBindGroup = this._blendIrrBindGroup = this._blendVisBindGroup = null;
    this._relocateProgram = this._traceProgram = this._blendIrrProgram = this._blendVisProgram = null;
    this._origin = null;
    this._updates = 0;
  }
  /** @internal */
  private ensureResources() {
    if (this._irradiance) {
      return;
    }
    const device = getDevice();
    const rows = Math.ceil(this._count / this._tileCols);
    const make = (texels: number, name: string) => {
      const tex = device.createTexture2D('rgba16f', this._tileCols * texels, rows * texels, {
        mipmapping: false,
        writable: true
      })!;
      tex.name = name;
      return tex;
    };
    this._irradiance = make(IRRADIANCE_TEXELS, '@ProbeIrradiance');
    this._irradianceNext = make(IRRADIANCE_TEXELS, '@ProbeIrradianceNext');
    this._visibility = make(VISIBILITY_TEXELS, '@ProbeVisibility');
    this._visibilityNext = make(VISIBILITY_TEXELS, '@ProbeVisibilityNext');
    this._rayTexture = device.createTexture2D('rgba16f', this._rays, this._budget, { mipmapping: false })!;
    this._rayTexture.name = '@ProbeRays';
    this._rayFramebuffer = device.createFrameBuffer([this._rayTexture], null)!;
    this._data = device.createBuffer(this._count * 16, { usage: 'uniform', storage: true })!;
    this._data.bufferSubData(0, new Float32Array(this._count * 4));
    this._selected = device.createBuffer(this._budget * 4, { usage: 'uniform', storage: true })!;
    this._state.fill(0);
  }
  /** Re-centres the window on the camera, a spacing at a time; probes that entered start over. @internal */
  private moveWindow(cameraPos: Vector3) {
    const s = this._options.spacing;
    const n = this._grid;
    const next: [number, number, number] = [
      Math.floor(cameraPos.x / s) - (n[0] >> 1),
      Math.floor(cameraPos.y / s) - (n[1] >> 1),
      Math.floor(cameraPos.z / s) - (n[2] >> 1)
    ];
    const prev = this._origin;
    if (prev && prev[0] === next[0] && prev[1] === next[1] && prev[2] === next[2]) {
      return;
    }
    this._origin = next;
    const wrap = (v: number, m: number) => ((v % m) + m) % m;
    for (let z = 0; z < n[2]; z++) {
      for (let y = 0; y < n[1]; y++) {
        for (let x = 0; x < n[0]; x++) {
          const wx = next[0] + x;
          const wy = next[1] + y;
          const wz = next[2] + z;
          const inPrev =
            !!prev &&
            wx >= prev[0] &&
            wy >= prev[1] &&
            wz >= prev[2] &&
            wx < prev[0] + n[0] &&
            wy < prev[1] + n[1] &&
            wz < prev[2] + n[2];
          if (!inPrev) {
            const index = wrap(wx, n[0]) + n[0] * (wrap(wy, n[1]) + n[1] * wrap(wz, n[2]));
            this._state[index] = 0;
            this._lastRelocated[index] = -1000;
            this._data!.bufferSubData(index * 16, this._dataReset);
          }
        }
      }
    }
  }
  /** Picks the probes to update: those never updated first, then in turn. @internal */
  private select() {
    let count = 0;
    const budget = this._budget;
    const n = this._count;
    for (let i = 0; i < n && count < budget; i++) {
      if (!this._state[i]) {
        this._selection[count++] = i | 0x80000000;
        this._state[i] = 1;
      }
    }
    let scanned = 0;
    while (count < budget && scanned < n) {
      const i = this._cursor;
      this._cursor = (this._cursor + 1) % n;
      scanned++;
      if (this._state[i]) {
        this._selection[count++] = i;
      }
    }
    for (let i = count; i < budget; i++) {
      this._selection[i] = 0xffffffff;
    }
    return count;
  }
  /** @internal */
  private randomRotation() {
    // Uniform random unit quaternion (Shoemake)
    const u1 = this._prng.get();
    const u2 = this._prng.get() * 2 * Math.PI;
    const u3 = this._prng.get() * 2 * Math.PI;
    const a = Math.sqrt(1 - u1);
    const b = Math.sqrt(u1);
    this._rotation.setXYZW(a * Math.sin(u2), a * Math.cos(u2), b * Math.sin(u3), b * Math.cos(u3));
  }
  /** @internal */
  private updateParams() {
    const o = this._options;
    const p = this._params;
    const n = this._grid;
    p.set([this._origin![0], this._origin![1], this._origin![2], o.spacing], 0);
    p.set([n[0], n[1], n[2], this._tileCols], 4);
    p.set([IRRADIANCE_TEXELS, VISIBILITY_TEXELS, o.normalBias, o.viewBias], 8);
    p.set(
      [this._irradiance!.width, this._irradiance!.height, this._visibility!.width, this._visibility!.height],
      12
    );
    p.set([o.intensity, o.maxRayDistance, 0, 0], 16);
  }
  /** @internal */
  private bindCommon(bg: BindGroup, global: NonNullable<SceneSDF['global']>) {
    global.applyBindGroup(bg);
    bg.setBuffer(PROBE_DATA, this._data!);
    bg.setValue(PROBE_PARAMS, this._params);
    bg.setBuffer('selected', this._selected!);
    bg.setValue('rotation', this._rotation);
    bg.setValue('rayInfo', new Vector4(this._rays, this._budget, this._frame, this._options.hysteresis));
  }
  /**
   * Pushes a selected probe out of nearby geometry along the field's gradient,
   * on its first update and every few frames after.
   * @internal
   */
  private runRelocate(global: NonNullable<SceneSDF['global']>, selected: number) {
    const device = getDevice();
    const levels = global.levels;
    if (!this._relocateProgram) {
      this._relocateProgram = buildSDFProgram({
        label: 'ProbeRelocate',
        workgroupSize: [64, 1, 1],
        compute(pb) {
          declareGlobalSDFUniforms(this, 0, levels);
          declareDynamicSDFUniforms(this, 0);
          this[PROBE_DATA] = pb.vec4[0]().storageBuffer(0);
          this[PROBE_PARAMS] = pb.vec4[PROBE_PARAM_VEC4S]().uniform(0);
          this.selected = pb.uint[0]().storageBufferReadonly(0);
          this.rotation = pb.vec4().uniform(0);
          // (rays per probe, probes selected, frame, hysteresis)
          this.rayInfo = pb.vec4().uniform(0);
          this.relocate = pb.uint[0]().storageBufferReadonly(0);
          pb.main(function () {
            this.$l.slot = this.$builtins.globalInvocationId.x;
            this.$if(pb.greaterThanEqual(this.slot, pb.uint(this.rayInfo.y)), function () {
              this.$return();
            });
            this.$if(pb.equal(this.relocate.at(this.slot), 0), function () {
              this.$return();
            });
            this.$l.sel = this.selected.at(this.slot);
            this.$l.index = pb.int(pb.compAnd(this.sel, pb.uint(0x7fffffff)));
            this.$l.first = pb.greaterThan(pb.compAnd(this.sel, pb.uint(0x80000000)), pb.uint(0));
            this.$l.texel = probeTexelFromIndex(this, this.index);
            this.$l.world = probeWorldFromTexel(this, this.texel);
            this.$l.data = this[PROBE_DATA].at(this.index);
            this.$l.offset = this.$choice(this.first, pb.vec3(0), this.data.xyz);
            this.$l.spacing = this[PROBE_PARAMS].at(0).w;
            this.$l.pos = pb.add(pb.mul(pb.vec3(this.world), this.spacing), this.offset);
            // Keep at least this far from surfaces, moving at most this far from the grid point
            this.$l.keep = pb.mul(this.spacing, 0.3);
            this.$l.limit = pb.mul(this.spacing, 0.45);
            this.$l.d = sampleSceneSDF(this, this.pos, levels);
            this.$if(pb.lessThan(this.d, this.keep), function () {
              this.$l.h = pb.mul(this.spacing, 0.05);
              this.$l.g = pb.vec3(
                pb.sub(sampleSceneSDF(this, pb.add(this.pos, pb.vec3(this.h, 0, 0)), levels), this.d),
                pb.sub(sampleSceneSDF(this, pb.add(this.pos, pb.vec3(0, this.h, 0)), levels), this.d),
                pb.sub(sampleSceneSDF(this, pb.add(this.pos, pb.vec3(0, 0, this.h)), levels), this.d)
              );
              this.$l.n = pb.div(this.g, pb.max(pb.length(this.g), 1e-6));
              this.offset = pb.add(this.offset, pb.mul(this.n, pb.sub(this.keep, this.d)));
              this.$l.len = pb.length(this.offset);
              this.$if(pb.greaterThan(this.len, this.limit), function () {
                this.offset = pb.mul(this.offset, pb.div(this.limit, this.len));
              });
            });
            this[PROBE_DATA].setAt(this.index, pb.vec4(this.offset, this.data.w));
          });
        }
      });
      this._relocateBindGroup = device.createBindGroup(this._relocateProgram.bindGroupLayouts[0]);
    }
    // Which selected probes relocate this frame
    const flags = new Uint32Array(new ArrayBuffer(this._budget * 4));
    for (let i = 0; i < selected; i++) {
      const index = this._selection[i] & 0x7fffffff;
      if (this._frame - this._lastRelocated[index] >= RELOCATE_EVERY) {
        flags[i] = 1;
        this._lastRelocated[index] = this._frame;
      }
    }
    const relocateBuffer = this.scratchBuffer('relocate', flags.byteLength);
    relocateBuffer.bufferSubData(0, flags);
    const bg = this._relocateBindGroup!;
    this.bindCommon(bg, global);
    bg.setBuffer('relocate', relocateBuffer);
    device.setProgram(this._relocateProgram);
    device.setBindGroup(0, bg);
    device.compute(Math.ceil(selected / 64), 1, 1);
  }
  private readonly _scratch: Map<string, GPUDataBuffer> = new Map();
  /** @internal */
  private scratchBuffer(name: string, bytes: number) {
    let buffer = this._scratch.get(name);
    if (!buffer || buffer.byteLength < bytes) {
      buffer?.dispose();
      buffer = getDevice().createBuffer(Math.max(16, bytes), { usage: 'uniform', storage: true })!;
      this._scratch.set(name, buffer);
    }
    return buffer;
  }
  /**
   * Traces the rays of the selected probes: one fragment per ray, the hit's
   * voxel radiance or the sky, and the hit distance (negative when the ray
   * started inside geometry), into the ray texture.
   * @internal
   */
  private runTrace(
    global: NonNullable<SceneSDF['global']>,
    voxels: VoxelScene,
    camera: Camera,
    selected: number
  ) {
    const device = getDevice();
    const scene = this._scene;
    const envLight = scene.env.light.envLight;
    const physical = scene.lightingMode === 'physical';
    const preExposure = physical ? camera.exposure : 1;
    const envStrength = physical
      ? (preExposure / PHYSICAL_BAKE_EXPOSURE) * (scene.env.light.strength ?? 0)
      : (scene.env.light.strength ?? 0);
    const skyMode = !envLight
      ? 'none'
      : envLight.hasRadiance()
        ? 'radiance'
        : envLight.hasIrradiance()
          ? 'irradiance'
          : 'none';
    const envVariant = envLight
      ? `${envLight.getType()}:${
          (envLight as unknown as { irradianceSHFB?: unknown }).irradianceSHFB
            ? 'fb'
            : (envLight as unknown as { irradianceSH?: unknown }).irradianceSH
              ? 'buf'
              : ''
        }`
      : '';
    const key = `${global.levels}:${skyMode}:${envVariant}`;
    if (!this._traceProgram || this._traceKey !== key) {
      this._traceBindGroup?.dispose();
      this._traceProgram?.dispose();
      const levels = global.levels;
      this._traceProgram = buildSDFProgram({
        label: 'ProbeTrace',
        vertex(pb) {
          this.$inputs.pos = pb.vec2().attrib('position');
          pb.main(function () {
            this.$builtins.position = pb.vec4(this.$inputs.pos, 0, 1);
          });
        },
        fragment(pb) {
          this.$outputs.color = pb.vec4();
          declareGlobalSDFUniforms(this, 0, levels);
          declareDynamicSDFUniforms(this, 0);
          declareVoxelSceneUniforms(this, 0);
          this[PROBE_DATA] = pb.vec4[0]().storageBufferReadonly(0);
          this[PROBE_PARAMS] = pb.vec4[PROBE_PARAM_VEC4S]().uniform(0);
          this.selected = pb.uint[0]().storageBufferReadonly(0);
          this.rotation = pb.vec4().uniform(0);
          this.rayInfo = pb.vec4().uniform(0);
          // (environment strength, 0, 0, 0)
          this.skyInfo = pb.vec4().uniform(0);
          if (skyMode !== 'none') {
            envLight.initShaderBindings(pb);
          }
          pb.main(function () {
            this.$l.fc = pb.ivec2(pb.floor(this.$builtins.fragCoord.xy));
            this.$l.slot = pb.uint(this.fc.y);
            this.$l.sel = this.selected.at(this.slot);
            this.$l.index = pb.int(pb.compAnd(this.sel, pb.uint(0x7fffffff)));
            this.$l.texel = probeTexelFromIndex(this, this.index);
            this.$l.world = probeWorldFromTexel(this, this.texel);
            this.$l.data = this[PROBE_DATA].at(this.index);
            this.$l.pos = probePosition(this, this.world, this.data);
            this.$l.dir = quatRotate(
              this,
              this.rotation,
              sphericalFibonacci(this, pb.float(this.fc.x), this.rayInfo.x)
            );
            this.$l.maxDist = this[PROBE_PARAMS].at(4).y;
            this.$l.radiance = pb.vec3(0);
            this.$l.dist = this.maxDist;
            this.$l.d0 = sampleSceneSDF(this, this.pos, levels);
            this.$if(pb.lessThan(this.d0, 0), function () {
              // Started inside geometry: a backface hit at no distance
              this.dist = pb.float(-0.01);
            }).$else(function () {
              this.$l.t = pb.float(0);
              this.$l.hit = false;
              this.$for(pb.int('i'), 0, TRACE_STEPS, function () {
                this.$l.d = sampleSceneSDF(this, pb.add(this.pos, pb.mul(this.dir, this.t)), levels);
                this.$if(pb.lessThan(this.d, pb.add(0.01, pb.mul(this.t, 0.004))), function () {
                  this.hit = true;
                  this.$break();
                });
                this.t = pb.add(this.t, pb.max(this.d, 0.02));
                this.$if(pb.greaterThan(this.t, this.maxDist), function () {
                  this.$break();
                });
              });
              this.$if(this.hit, function () {
                this.dist = this.t;
                this.$l.hp = pb.add(this.pos, pb.mul(this.dir, this.t));
                this.radiance = loadVoxelSceneRadiance(this, voxelSceneTexel(this, this.hp, levels));
              }).$else(function () {
                if (skyMode === 'radiance') {
                  this.radiance = pb.mul(
                    envLight.getRadiance(this, this.dir, pb.float(0))!.rgb,
                    this.skyInfo.x
                  );
                } else if (skyMode === 'irradiance') {
                  this.radiance = pb.mul(envLight.getIrradiance(this, this.dir).rgb, this.skyInfo.x);
                }
              });
            });
            this.$outputs.color = pb.vec4(this.radiance, this.dist);
          });
        }
      });
      this._traceKey = key;
      this._traceBindGroup = device.createBindGroup(this._traceProgram.bindGroupLayouts[0]);
    }
    const bg = this._traceBindGroup!;
    this.bindCommon(bg, global);
    bg.setTexture(VOXEL_SCENE_ALBEDO, voxels.albedo, fetchSampler('clamp_nearest_nomip'));
    bg.setTexture(VOXEL_SCENE_EMISSIVE, voxels.emissive, fetchSampler('clamp_nearest_nomip'));
    bg.setTexture(VOXEL_SCENE_RADIANCE, voxels.radiance, fetchSampler('clamp_nearest_nomip'));
    bg.setValue('skyInfo', new Vector4(envStrength, 0, 0, 0));
    if (skyMode !== 'none') {
      envLight.updateBindGroup(bg);
    }
    if (!this._renderStates) {
      this._renderStates = device.createRenderStateSet();
      this._renderStates.useDepthState().enableTest(false).enableWrite(false);
      this._renderStates.useRasterizerState().setCullMode('none');
    }
    device.pushDeviceStates();
    try {
      device.setFramebuffer(this._rayFramebuffer!);
      device.setViewport([0, 0, this._rays, selected]);
      device.setScissor([0, 0, this._rays, selected]);
      device.setProgram(this._traceProgram);
      device.setBindGroup(0, bg);
      drawFullscreenQuad(this._renderStates);
    } finally {
      device.popDeviceStates();
    }
  }
  /**
   * Blends the traced rays into the selected probes' maps: one thread per
   * texel, each integrating every ray of its probe for its direction, border
   * texels taking the direction of the interior texel they mirror.
   * @internal
   */
  private runBlend(selected: number) {
    const device = getDevice();
    if (!this._blendIrrProgram) {
      this._blendIrrProgram = this.createBlendProgram(IRRADIANCE_TEXELS, false);
      this._blendIrrBindGroup = device.createBindGroup(this._blendIrrProgram.bindGroupLayouts[0]);
      this._blendVisProgram = this.createBlendProgram(VISIBILITY_TEXELS, true);
      this._blendVisBindGroup = device.createBindGroup(this._blendVisProgram.bindGroupLayouts[0]);
    }
    const passes: [GPUProgram, BindGroup, Texture2D, Texture2D][] = [
      [this._blendIrrProgram, this._blendIrrBindGroup!, this._irradiance!, this._irradianceNext!],
      [this._blendVisProgram!, this._blendVisBindGroup!, this._visibility!, this._visibilityNext!]
    ];
    for (const [program, bg, current, next] of passes) {
      bg.setBuffer(PROBE_DATA, this._data!);
      bg.setValue(PROBE_PARAMS, this._params);
      bg.setBuffer('selected', this._selected!);
      bg.setValue('rotation', this._rotation);
      bg.setValue('rayInfo', new Vector4(this._rays, this._budget, this._frame, this._options.hysteresis));
      bg.setTexture('rays', this._rayTexture!, fetchSampler('clamp_nearest_nomip'));
      bg.setTexture('current', current, fetchSampler('clamp_nearest_nomip'));
      bg.setTexture('next', next);
      device.setProgram(program);
      device.setBindGroup(0, bg);
      device.compute(selected, 1, 1);
    }
  }
  /** @internal */
  private createBlendProgram(texels: number, visibility: boolean) {
    const rays = this._rays;
    return buildSDFProgram({
      label: visibility ? 'ProbeBlendVisibility' : 'ProbeBlendIrradiance',
      workgroupSize: [texels, texels, 1],
      compute(pb) {
        this[PROBE_DATA] = pb.vec4[0]().storageBuffer(0);
        this[PROBE_PARAMS] = pb.vec4[PROBE_PARAM_VEC4S]().uniform(0);
        this.selected = pb.uint[0]().storageBufferReadonly(0);
        this.rotation = pb.vec4().uniform(0);
        this.rayInfo = pb.vec4().uniform(0);
        this.rays = pb.tex2D().sampleType('unfilterable-float').uniform(0);
        this.current = pb.tex2D().sampleType('unfilterable-float').uniform(0);
        this.next = pb.texStorage2D.rgba16float().storage(0);
        pb.main(function () {
          this.$l.slot = this.$builtins.workGroupId.x;
          this.$l.sel = this.selected.at(this.slot);
          this.$l.index = pb.int(pb.compAnd(this.sel, pb.uint(0x7fffffff)));
          this.$l.first = pb.greaterThan(pb.compAnd(this.sel, pb.uint(0x80000000)), pb.uint(0));
          this.$l.uv = pb.ivec2(this.$builtins.localInvocationId.xy);
          // Border texels mirror the interior: take the direction of the texel they copy
          const s = texels;
          this.$l.src = this.uv;
          this.$l.onX = pb.or(pb.equal(this.uv.x, 0), pb.equal(this.uv.x, s - 1));
          this.$l.onY = pb.or(pb.equal(this.uv.y, 0), pb.equal(this.uv.y, s - 1));
          this.$if(pb.and(this.onX, this.onY), function () {
            this.src = pb.ivec2(
              this.$choice(pb.equal(this.uv.x, 0), pb.int(s - 2), pb.int(1)),
              this.$choice(pb.equal(this.uv.y, 0), pb.int(s - 2), pb.int(1))
            );
          })
            .$elseif(this.onX, function () {
              this.src = pb.ivec2(
                this.$choice(pb.equal(this.uv.x, 0), pb.int(1), pb.int(s - 2)),
                pb.sub(s - 1, this.uv.y)
              );
            })
            .$elseif(this.onY, function () {
              this.src = pb.ivec2(
                pb.sub(s - 1, this.uv.x),
                this.$choice(pb.equal(this.uv.y, 0), pb.int(1), pb.int(s - 2))
              );
            });
          this.$l.oct = pb.sub(
            pb.mul(pb.div(pb.add(pb.vec2(this.src), pb.vec2(-1 + 0.5)), s - 2), 2),
            pb.vec2(1)
          );
          this.$l.dir = octDecode(this, this.oct);
          this.$l.sum = pb.vec4(0);
          this.$l.wsum = pb.float(0);
          this.$l.maxDist = this[PROBE_PARAMS].at(4).y;
          this.$for(pb.int('r'), 0, rays, function () {
            this.$l.ray = pb.textureLoad(this.rays, pb.ivec2(this.r, pb.int(this.slot)), 0);
            this.$l.rd = quatRotate(
              this,
              this.rotation,
              sphericalFibonacci(this, pb.float(this.r), pb.float(rays))
            );
            this.$l.c = pb.max(pb.dot(this.dir, this.rd), 0);
            if (visibility) {
              // Sharpened so a texel only sees rays near its direction
              this.$l.w = pb.pow(this.c, 50);
              this.$l.hd = pb.abs(this.ray.a);
              this.$if(pb.lessThan(this.ray.a, 0), function () {
                this.hd = pb.mul(this.hd, 0.2);
              });
              this.hd = pb.min(this.hd, this.maxDist);
              this.sum = pb.add(this.sum, pb.mul(pb.vec4(this.hd, pb.mul(this.hd, this.hd), 0, 0), this.w));
              this.wsum = pb.add(this.wsum, this.w);
            } else {
              this.$if(pb.greaterThanEqual(this.ray.a, 0), function () {
                this.sum = pb.add(this.sum, pb.mul(pb.vec4(this.ray.rgb, 0), this.c));
                this.wsum = pb.add(this.wsum, this.c);
              });
            }
          });
          this.$l.result = this.$choice(
            pb.greaterThan(this.wsum, 1e-5),
            pb.div(this.sum, this.wsum),
            visibility ? pb.vec4(this.maxDist, pb.mul(this.maxDist, this.maxDist), 0, 0) : pb.vec4(0)
          );
          this.$l.origin = probeTileOrigin(this, this.index, pb.float(s));
          this.$l.texel = pb.add(this.origin, this.uv);
          this.$l.old = pb.textureLoad(this.current, this.texel, 0);
          this.$l.h = this.$choice(this.first, pb.float(0), this.rayInfo.w);
          this.$l.value = pb.mix(this.result, this.old, this.h);
          pb.textureStore(this.next, pb.uvec2(this.texel), pb.vec4(this.value.xyz, 1));
          if (!visibility) {
            // The probe counts as updated once its maps hold something
            this.$if(pb.equal(this.$builtins.localInvocationId.xy, pb.uvec2(0)), function () {
              this.$l.data = this[PROBE_DATA].at(this.index);
              this[PROBE_DATA].setAt(this.index, pb.vec4(this.data.xyz, 1));
            });
          }
        });
      }
    });
  }
}
