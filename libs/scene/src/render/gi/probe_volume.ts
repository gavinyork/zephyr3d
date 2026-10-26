import type {
  BindGroup,
  FrameBuffer,
  GPUDataBuffer,
  GPUProgram,
  PBInsideFunctionScope,
  PBShaderExp,
  RenderStateSet,
  Texture2D
} from '@zephyr3d/device';
import type { Nullable, Vector3 } from '@zephyr3d/base';
import { half2float, PRNG, Vector4 } from '@zephyr3d/base';
import { getDevice } from '../../app/api';
import type { Scene } from '../../scene/scene';
import type { Camera } from '../../camera/camera';
import type { DrawContext } from '../drawable';
import type { SceneSDF } from '../sdf/scene_sdf';
import type { VoxelScene } from './voxel_scene';
import { buildSDFProgram } from '../sdf/sdf_programs';
import { drawFullscreenQuad } from '../fullscreenquad';
import { fetchSampler } from '../../utility/misc';
import { getGICacheExposure } from '../../utility/physical';
import { RENDER_PASS_TYPE_LIGHT } from '../../values';
import {
  declareDynamicSDFUniforms,
  declareGlobalSDFUniforms,
  GLOBAL_SDF_LEVELS,
  sampleSceneSDF,
  sampleSceneSDFHinted,
  sdfTraceTolerance
} from '../../shaders/sdf';
import {
  declareVoxelSceneUniforms,
  sampleVoxelSceneRadiance,
  VOXEL_SCENE_ALBEDO,
  VOXEL_SCENE_EMISSIVE,
  VOXEL_SCENE_RADIANCE,
  VOXEL_SCENE_ANISO0,
  VOXEL_SCENE_ANISO1
} from '../../shaders/gi';
import {
  octDecode,
  PROBE_DATA,
  PROBE_IRRADIANCE,
  PROBE_MAX_LEVELS,
  PROBE_PARAM_VEC4S,
  PROBE_PARAMS,
  PROBE_VISIBILITY,
  probeLevelOrigin,
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
/** Tiles per row of the blend outputs, which hold the tiles of one update by selection slot. */
const STAGING_COLS = 64;
/** Rays a blend workgroup stages in shared memory at a time. */
const BLEND_BATCH = 128;
/** Sphere tracing steps of a probe ray. */
const TRACE_STEPS = 48;
/** Frames between relocations of an updated probe. */
const RELOCATE_EVERY = 8;
/** Bits of a selection entry: tile index, level, first-update flag. */
const SELECT_INDEX_MASK = 0x00ffffff;
const SELECT_LEVEL_SHIFT = 24;
const SELECT_FIRST_BIT = 0x80000000;
/** Magic and version of a saved probe state. */
const STATE_MAGIC = 0x50494a5a; // 'ZJIP'
/**
 * 2: irradiance stored at the fixed cache exposure (see getGICacheExposure).
 * 3: sky visibility in the irradiance alpha.
 * 4: irradiance from voxel radiance kept per face (light anisotropy).
 */
const STATE_VERSION = 4;
/**
 * Hit distance a ray that escaped to the sky writes: beyond any trace length,
 * so the irradiance blend can count escapes, within half float range. The
 * visibility blend clamps distances well below it, so it reads as far.
 */
const SKY_ESCAPE_DISTANCE = 16384;

/**
 * Settings of the probe volume, on {@link SceneGI}.
 * @public
 */
export interface ProbeVolumeOptions {
  /** Probes along x, y and z of the finest level; the coarsest level has half as many per axis. */
  grid: [number, number, number];
  /** Distance between probes of the finest level in world units. */
  spacing: number;
  /** Clipmap levels, each `levelScale` times the spacing of the one inside it; 1 to {@link PROBE_MAX_LEVELS}. */
  levels: number;
  /** Spacing ratio between consecutive levels. */
  levelScale: number;
  /** Rays traced per probe per update. */
  raysPerProbe: number;
  /** Probes updated per frame, all levels together. */
  budget: number;
  /** Share of the previous value kept per update, 0 to 1. */
  hysteresis: number;
  /** Surface offset along the normal when sampling, in world units. */
  normalBias: number;
  /** Surface offset towards the viewer when sampling, in world units. */
  viewBias: number;
  /** Multiplier on the irradiance the probes give. */
  intensity: number;
  /** Distance a ray of the finest level gives up at, in world units; coarser levels go proportionally farther. */
  maxRayDistance: number;
}

/**
 * Counters of a {@link ProbeVolume}.
 * @public
 */
export interface ProbeVolumeStats {
  levels: number;
  probes: number;
  /** Probes never updated since entering their window. */
  uninitialized: number;
  /** Probes updated by the last frame. */
  lastUpdated: number;
  updates: number;
  /** Per level: probes per axis, spacing and the world index of the window's first probe. */
  levelInfo: { grid: [number, number, number]; spacing: number; origin: [number, number, number] }[];
}

interface ProbeLevel {
  grid: [number, number, number];
  spacing: number;
  count: number;
  /** First tile of the level in the atlases and the data buffer. */
  tileBase: number;
  origin: Nullable<[number, number, number]>;
  /** 0 until a probe's first update since entering the window. */
  state: Uint8Array;
  lastRelocated: Int32Array;
  cursor: number;
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
 * The scene's probe volume when the global illumination is on and it has
 * been built, for passes other than the light pass (SSGI, the voxel lighting).
 * @internal
 */
export function getActiveProbeVolume(scene: Scene): Nullable<ProbeVolume> {
  if (!scene.gi.enabled) {
    return null;
  }
  const probes = scene.gi.probes;
  return probes?.ready ? probes : null;
}

/**
 * A clipmap of light probes around the camera holding the diffuse irradiance
 * and the distance to the nearest surface per direction, as octahedral maps:
 * dynamic diffuse global illumination after Majercik et al. (JCGT 2019; the
 * scrolling window, relocation and classification of JCGT 2021), in levels
 * of growing spacing like Lumen's radiance cache. Each frame a budget of
 * probes traces a set of rays through the scene field, reads the voxel
 * scene's radiance where they hit and the sky where they miss, and blends the
 * result into its maps with hysteresis. Surfaces in the light pass read the
 * volume through the environment light's irradiance
 * ({@link sampleProbeIrradiance}).
 *
 * Every level's window follows the camera a spacing at a time, probes
 * addressed toroidally by world index; a probe entering a window starts
 * over. Probes inside geometry or too near it are pushed out along the
 * field's gradient.
 *
 * The state can be saved ({@link ProbeVolume.exportState}) and restored, for
 * a scene whose lighting is then frozen.
 *
 * WebGPU only.
 *
 * @public
 */
export class ProbeVolume {
  private readonly _scene: Scene;
  private readonly _options: ProbeVolumeOptions;
  private readonly _levels: ProbeLevel[];
  private readonly _count: number;
  private readonly _tileCols: number;
  private readonly _rays: number;
  private readonly _budget: number;
  private _irradiance: Nullable<Texture2D>;
  private _irradianceNext: Nullable<Texture2D>;
  private _visibility: Nullable<Texture2D>;
  private _visibilityNext: Nullable<Texture2D>;
  /**
   * The visibility maps keep two moments of the distance: rg16f where the
   * device can write it from a compute shader (texture-formats-tier1), half
   * the memory of rgba16f.
   */
  private readonly _visibilityFormat: 'rg16f' | 'rgba16f';
  private _rayTexture: Nullable<Texture2D>;
  private _rayFramebuffer: Nullable<FrameBuffer>;
  private _data: Nullable<GPUDataBuffer>;
  private _selected: Nullable<GPUDataBuffer>;
  private readonly _selection: Uint32Array<ArrayBuffer>;
  private readonly _dataReset: Float32Array<ArrayBuffer>;
  private _frame: number;
  private _updates: number;
  private _lastUpdated: number;
  private readonly _params: Float32Array<ArrayBuffer>;
  /** Live camera exposure over the cache exposure, see {@link ProbeVolume.setReadExposure}. */
  private _exposureScale: number;
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
  private _commitProgram: Nullable<GPUProgram>;
  private _commitBindGroup: Nullable<BindGroup>;
  private _renderStates: Nullable<RenderStateSet>;
  private readonly _scratch: Map<string, GPUDataBuffer>;
  constructor(scene: Scene, options: ProbeVolumeOptions) {
    this._scene = scene;
    this._options = options;
    const levels = Math.max(1, Math.min(PROBE_MAX_LEVELS, Math.floor(options.levels)));
    const scale = Math.max(1.5, options.levelScale);
    const grid = options.grid.map((v) => Math.max(2, Math.floor(v))) as [number, number, number];
    this._levels = [];
    let tileBase = 0;
    for (let l = 0; l < levels; l++) {
      // The coarsest level covers the most ground with the fewest probes
      const g = (l === levels - 1 && levels > 1 ? grid.map((v) => Math.max(2, v >> 1)) : grid) as [
        number,
        number,
        number
      ];
      const count = g[0] * g[1] * g[2];
      this._levels.push({
        grid: g,
        spacing: options.spacing * scale ** l,
        count,
        tileBase,
        origin: null,
        state: new Uint8Array(count),
        lastRelocated: new Int32Array(count).fill(-1000),
        cursor: 0
      });
      tileBase += count;
    }
    this._count = tileBase;
    this._tileCols = Math.ceil(Math.sqrt(this._count));
    this._rays = Math.max(16, Math.min(1024, Math.floor(options.raysPerProbe)));
    this._budget = Math.max(1, Math.min(this._count, Math.floor(options.budget)));
    this._irradiance = null;
    this._irradianceNext = null;
    this._visibility = null;
    this._visibilityNext = null;
    this._visibilityFormat = getDevice().getDeviceCaps().textureCaps.getTextureFormatInfo('rg16f')?.writable
      ? 'rg16f'
      : 'rgba16f';
    this._rayTexture = null;
    this._rayFramebuffer = null;
    this._data = null;
    this._selected = null;
    this._selection = new Uint32Array(new ArrayBuffer(this._budget * 4));
    this._dataReset = new Float32Array(new ArrayBuffer(16));
    this._frame = 0;
    this._updates = 0;
    this._lastUpdated = 0;
    this._params = new Float32Array(new ArrayBuffer(PROBE_PARAM_VEC4S * 16));
    this._exposureScale = 1;
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
    this._commitProgram = null;
    this._commitBindGroup = null;
    this._renderStates = null;
    this._scratch = new Map();
  }
  /** Clipmap levels. */
  get levels() {
    return this._levels.length;
  }
  /** Probes of every level together. */
  get count() {
    return this._count;
  }
  /** Spacing of the finest level. */
  get spacing() {
    return this._options.spacing;
  }
  /** True once the volume has been placed and updated, or a state restored. */
  get ready() {
    return !!this._levels[0].origin && this._updates > 0;
  }
  getStats(): ProbeVolumeStats {
    let uninitialized = 0;
    for (const level of this._levels) {
      for (let i = 0; i < level.count; i++) {
        uninitialized += level.state[i] ? 0 : 1;
      }
    }
    return {
      levels: this._levels.length,
      probes: this._count,
      uninitialized,
      lastUpdated: this._lastUpdated,
      updates: this._updates,
      levelInfo: this._levels.map((level) => ({
        grid: [...level.grid] as [number, number, number],
        spacing: level.spacing,
        origin: (level.origin ? [...level.origin] : [0, 0, 0]) as [number, number, number]
      }))
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
   * Converts what surfaces read from the probes to a camera's exposure: the
   * irradiance is kept at the fixed cache exposure (see getGICacheExposure),
   * the image at the camera's. Called once a frame, also while the volume is
   * frozen, so a frozen or restored volume follows exposure changes.
   */
  setReadExposure(camera: Camera) {
    const scene = this._scene;
    const live = scene.lightingMode === 'physical' ? camera.exposure : 1;
    const scale = live / getGICacheExposure(scene.lightingMode);
    if (scale !== this._exposureScale) {
      this._exposureScale = scale;
      // Before the first update there are no maps to describe; that update writes the params
      if (this._irradiance && this._visibility) {
        this.updateParams();
      }
    }
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
    this.ensureResources();
    const cameraPos = camera.getWorldPosition();
    for (const level of this._levels) {
      this.moveWindow(level, cameraPos);
    }
    this._frame++;
    const selected = this.select();
    this.updateParams();
    if (selected === 0) {
      return;
    }
    this._selected!.bufferSubData(0, this._selection);
    // A fresh random rotation of the ray set each update
    this.randomRotation();
    this.runRelocate(global, selected);
    this.runTrace(global, voxels, camera, selected);
    this.runBlend(selected);
    this.runCommit(selected);
    this._updates++;
    this._lastUpdated = selected;
  }
  /**
   * Saves the volume: its maps, probe data and windows, to restore with
   * {@link ProbeVolume.importState} on a volume built with the same settings.
   * Resolves once the GPU has handed the maps back.
   */
  async exportState(): Promise<ArrayBuffer> {
    if (!this.ready || !this._irradiance || !this._visibility || !this._data) {
      throw new Error('ProbeVolume.exportState(): nothing to save yet');
    }
    const irr = new Uint16Array(new ArrayBuffer(this._irradiance.width * this._irradiance.height * 8));
    const visTexels = this._visibility.width * this._visibility.height;
    const visChannels = this._visibilityFormat === 'rg16f' ? 2 : 4;
    const visRead = new Uint16Array(new ArrayBuffer(visTexels * visChannels * 2));
    const data = new Float32Array(new ArrayBuffer(this._count * 16));
    // Issued together so the three readbacks wait for the GPU once, not three times
    await Promise.all([
      this._irradiance.readPixels(0, 0, this._irradiance.width, this._irradiance.height, 0, 0, irr),
      this._visibility.readPixels(0, 0, this._visibility.width, this._visibility.height, 0, 0, visRead),
      this._data.getBufferSubData(new Uint8Array(data.buffer), 0, data.byteLength)
    ]);
    // Saved as rgba16f whatever the device keeps, so a state moves between devices
    const vis = visChannels === 4 ? visRead : expandVisibility(visRead, visTexels);
    const header = JSON.stringify({
      grid: this._options.grid,
      spacing: this._options.spacing,
      levels: this._levels.length,
      levelScale: this._options.levelScale,
      origins: this._levels.map((l) => l.origin),
      irradiance: [this._irradiance.width, this._irradiance.height],
      visibility: [this._visibility.width, this._visibility.height]
    });
    const headerBytes = new TextEncoder().encode(header);
    const headerLength = (headerBytes.byteLength + 3) & ~3;
    const out = new Uint8Array(12 + headerLength + irr.byteLength + vis.byteLength + data.byteLength);
    const view = new DataView(out.buffer);
    view.setUint32(0, STATE_MAGIC, true);
    view.setUint32(4, STATE_VERSION, true);
    view.setUint32(8, headerLength, true);
    out.fill(0x20, 12, 12 + headerLength);
    out.set(headerBytes, 12);
    let offset = 12 + headerLength;
    out.set(new Uint8Array(irr.buffer), offset);
    offset += irr.byteLength;
    out.set(new Uint8Array(vis.buffer), offset);
    offset += vis.byteLength;
    out.set(new Uint8Array(data.buffer), offset);
    return out.buffer;
  }
  /**
   * Reads back the probes of a level whose grid points lie in a world box,
   * for inspection: where each one is (grid point plus relocation offset),
   * whether it has been updated, the mean irradiance and sky visibility over
   * its tile, and the nearest and mean of the hit distances its visibility
   * map holds (near 0 for a probe buried in geometry). At most `limit`
   * probes, nearest the box centre first.
   */
  async queryProbes(level: number, min: Vector3, max: Vector3, limit = 512) {
    const l = this._levels[level];
    if (!l || !l.origin || !this._irradiance || !this._visibility || !this._data) {
      return null;
    }
    const s = l.spacing;
    const lo = [Math.ceil(min.x / s), Math.ceil(min.y / s), Math.ceil(min.z / s)];
    const hi = [Math.floor(max.x / s), Math.floor(max.y / s), Math.floor(max.z / s)];
    const centre = [(min.x + max.x) / 2, (min.y + max.y) / 2, (min.z + max.z) / 2];
    const wrap = (v: number, m: number) => ((v % m) + m) % m;
    const picked: { world: number[]; index: number }[] = [];
    for (let z = lo[2]; z <= hi[2]; z++) {
      for (let y = lo[1]; y <= hi[1]; y++) {
        for (let x = lo[0]; x <= hi[0]; x++) {
          const w = [x, y, z];
          if (w.some((v, a) => v < l.origin![a] || v >= l.origin![a] + l.grid[a])) {
            continue;
          }
          const local =
            wrap(x, l.grid[0]) + l.grid[0] * (wrap(y, l.grid[1]) + l.grid[1] * wrap(z, l.grid[2]));
          picked.push({ world: w, index: local });
        }
      }
    }
    const dist2 = (w: number[]) => w.reduce((acc, v, a) => acc + (v * s - centre[a]) ** 2, 0);
    picked.sort((a, b) => dist2(a.world) - dist2(b.world));
    picked.length = Math.min(picked.length, limit);
    const irr = new Uint16Array(new ArrayBuffer(this._irradiance.width * this._irradiance.height * 8));
    const visChannels = this._visibilityFormat === 'rg16f' ? 2 : 4;
    const vis = new Uint16Array(
      new ArrayBuffer(this._visibility.width * this._visibility.height * visChannels * 2)
    );
    const data = new Float32Array(new ArrayBuffer(this._count * 16));
    await Promise.all([
      this._irradiance.readPixels(0, 0, this._irradiance.width, this._irradiance.height, 0, 0, irr),
      this._visibility.readPixels(0, 0, this._visibility.width, this._visibility.height, 0, 0, vis),
      this._data.getBufferSubData(new Uint8Array(data.buffer), 0, data.byteLength)
    ]);
    const tileMean = (
      texels: number,
      width: number,
      channels: number,
      raw: Uint16Array,
      index: number,
      reduce: (texel: number[]) => void
    ) => {
      const ox = (index % this._tileCols) * texels;
      const oy = Math.floor(index / this._tileCols) * texels;
      // Interior texels only; the border repeats them
      for (let y = 1; y < texels - 1; y++) {
        for (let x = 1; x < texels - 1; x++) {
          const o = ((oy + y) * width + ox + x) * channels;
          const t: number[] = [];
          for (let c = 0; c < channels; c++) {
            t.push(half2float(raw[o + c]));
          }
          reduce(t);
        }
      }
    };
    const probes = picked.map(({ world, index }) => {
      const tile = l.tileBase + index;
      const d = data.subarray(tile * 4, tile * 4 + 4);
      const irrSum = [0, 0, 0, 0];
      let n = 0;
      tileMean(IRRADIANCE_TEXELS, this._irradiance!.width, 4, irr, tile, (t) => {
        for (let c = 0; c < 4; c++) {
          irrSum[c] += t[c];
        }
        n++;
      });
      let visMin = Infinity;
      let visSum = 0;
      let m = 0;
      tileMean(VISIBILITY_TEXELS, this._visibility!.width, visChannels, vis, tile, (t) => {
        visMin = Math.min(visMin, t[0]);
        visSum += t[0];
        m++;
      });
      const r = (v: number) => Math.round(v * 1000) / 1000;
      return {
        world,
        position: [world[0] * s + d[0], world[1] * s + d[1], world[2] * s + d[2]].map(r),
        offset: [d[0], d[1], d[2]].map(r),
        updated: d[3] > 0.5,
        irradiance: irrSum.slice(0, 3).map((v) => r(v / n)),
        sky: r(irrSum[3] / n),
        hitMin: r(visMin),
        hitMean: r(visSum / m)
      };
    });
    return { level, spacing: s, origin: [...l.origin], grid: [...l.grid], probes };
  }
  /**
   * Restores a state saved by {@link ProbeVolume.exportState}. The settings
   * must match; the windows come back where they were, so freeze the
   * lighting afterwards or they move on with the camera.
   */
  importState(buffer: ArrayBuffer) {
    const view = new DataView(buffer);
    if (view.getUint32(0, true) !== STATE_MAGIC || view.getUint32(4, true) !== STATE_VERSION) {
      throw new Error('ProbeVolume.importState(): not a probe state');
    }
    const headerLength = view.getUint32(8, true);
    const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 12, headerLength)));
    if (
      header.levels !== this._levels.length ||
      header.spacing !== this._options.spacing ||
      header.levelScale !== this._options.levelScale ||
      header.grid.some((v: number, i: number) => v !== this._options.grid[i])
    ) {
      throw new Error('ProbeVolume.importState(): the state was saved with other settings');
    }
    this.ensureResources();
    const irrSize = this._irradiance!.width * this._irradiance!.height * 4;
    const visSize = this._visibility!.width * this._visibility!.height * 4;
    let offset = 12 + headerLength;
    const irr = new Uint16Array(buffer, offset, irrSize);
    offset += irr.byteLength;
    const vis = new Uint16Array(buffer, offset, visSize);
    offset += vis.byteLength;
    const visTexels = this._visibility!.width * this._visibility!.height;
    const data = new Float32Array(buffer, offset, this._count * 4);
    this._irradiance!.update(irr, 0, 0, this._irradiance!.width, this._irradiance!.height);
    this._visibility!.update(
      this._visibilityFormat === 'rg16f' ? compactVisibility(vis, visTexels) : vis,
      0,
      0,
      this._visibility!.width,
      this._visibility!.height
    );
    this._data!.bufferSubData(0, data);
    this._levels.forEach((level, l) => {
      level.origin = header.origins[l];
      for (let i = 0; i < level.count; i++) {
        level.state[i] = data[(level.tileBase + i) * 4 + 3] > 0.5 ? 1 : 0;
      }
    });
    this.updateParams();
    this._updates = Math.max(this._updates, 1);
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
    for (const buffer of this._scratch.values()) {
      buffer.dispose();
    }
    this._scratch.clear();
    for (const bg of [
      this._relocateBindGroup,
      this._traceBindGroup,
      this._blendIrrBindGroup,
      this._blendVisBindGroup,
      this._commitBindGroup
    ]) {
      bg?.dispose();
    }
    for (const prog of [
      this._relocateProgram,
      this._traceProgram,
      this._blendIrrProgram,
      this._blendVisProgram,
      this._commitProgram
    ]) {
      prog?.dispose();
    }
    this._relocateBindGroup = this._traceBindGroup = this._blendIrrBindGroup = this._blendVisBindGroup = null;
    this._relocateProgram = this._traceProgram = this._blendIrrProgram = this._blendVisProgram = null;
    this._commitProgram = this._commitBindGroup = null;
    for (const level of this._levels) {
      level.origin = null;
    }
    this._updates = 0;
  }
  /** @internal */
  private ensureResources() {
    if (this._irradiance) {
      return;
    }
    const device = getDevice();
    const rows = Math.ceil(this._count / this._tileCols);
    const make = (
      texels: number,
      name: string,
      cols = this._tileCols,
      r = rows,
      format: 'rgba16f' | 'rg16f' = 'rgba16f'
    ) => {
      const tex = device.createTexture2D(format, cols * texels, r * texels, {
        mipmapping: false,
        writable: true
      })!;
      tex.name = name;
      return tex;
    };
    this._irradiance = make(IRRADIANCE_TEXELS, '@ProbeIrradiance');
    // The blend outputs hold one update's tiles, committed to the maps after
    const stagingRows = Math.ceil(this._budget / STAGING_COLS);
    this._irradianceNext = make(IRRADIANCE_TEXELS, '@ProbeIrradianceNext', STAGING_COLS, stagingRows);
    this._visibility = make(
      VISIBILITY_TEXELS,
      '@ProbeVisibility',
      this._tileCols,
      rows,
      this._visibilityFormat
    );
    this._visibilityNext = make(
      VISIBILITY_TEXELS,
      '@ProbeVisibilityNext',
      STAGING_COLS,
      stagingRows,
      this._visibilityFormat
    );
    this._rayTexture = device.createTexture2D('rgba16f', this._rays, this._budget, { mipmapping: false })!;
    this._rayTexture.name = '@ProbeRays';
    this._rayFramebuffer = device.createFrameBuffer([this._rayTexture], null)!;
    this._data = device.createBuffer(this._count * 16, { usage: 'uniform', storage: true })!;
    this._data.bufferSubData(0, new Float32Array(new ArrayBuffer(this._count * 16)));
    this._selected = device.createBuffer(this._budget * 4, { usage: 'uniform', storage: true })!;
    for (const level of this._levels) {
      level.state.fill(0);
    }
  }
  /** Re-centres a level's window on the camera, a spacing at a time; probes that entered start over. @internal */
  private moveWindow(level: ProbeLevel, cameraPos: Vector3) {
    const s = level.spacing;
    const n = level.grid;
    const next: [number, number, number] = [
      Math.floor(cameraPos.x / s) - (n[0] >> 1),
      Math.floor(cameraPos.y / s) - (n[1] >> 1),
      Math.floor(cameraPos.z / s) - (n[2] >> 1)
    ];
    const prev = level.origin;
    if (prev && prev[0] === next[0] && prev[1] === next[1] && prev[2] === next[2]) {
      return;
    }
    level.origin = next;
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
            level.state[index] = 0;
            level.lastRelocated[index] = -1000;
            this._data!.bufferSubData((level.tileBase + index) * 16, this._dataReset);
          }
        }
      }
    }
  }
  /**
   * Picks the probes to update: those never updated first, a quarter of the
   * budget going to the coarsest level so something covers the whole scene
   * at once and the rest finest level first; then every level in turn by its
   * share of the budget.
   * @internal
   */
  private select() {
    let count = 0;
    const budget = this._budget;
    const takeNew = (l: number, limit: number) => {
      const level = this._levels[l];
      for (let i = 0; i < level.count && count < limit; i++) {
        if (!level.state[i]) {
          this._selection[count++] =
            ((level.tileBase + i) | (l << SELECT_LEVEL_SHIFT) | SELECT_FIRST_BIT) >>> 0;
          level.state[i] = 1;
        }
      }
    };
    if (this._levels.length > 1) {
      takeNew(this._levels.length - 1, budget >> 2);
    }
    for (let l = 0; l < this._levels.length && count < budget; l++) {
      takeNew(l, budget);
    }
    const remaining = budget - count;
    for (let l = 0; l < this._levels.length && count < budget; l++) {
      const level = this._levels[l];
      let share = Math.max(1, Math.round((remaining * level.count) / this._count));
      let scanned = 0;
      while (share > 0 && count < budget && scanned < level.count) {
        const i = level.cursor;
        level.cursor = (level.cursor + 1) % level.count;
        scanned++;
        if (level.state[i]) {
          this._selection[count++] = ((level.tileBase + i) | (l << SELECT_LEVEL_SHIFT)) >>> 0;
          share--;
        }
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
    p.set([this._levels.length, this._tileCols, IRRADIANCE_TEXELS, VISIBILITY_TEXELS], 0);
    p.set(
      [this._irradiance!.width, this._irradiance!.height, this._visibility!.width, this._visibility!.height],
      4
    );
    p.set([o.intensity * this._exposureScale, o.normalBias, o.viewBias, o.maxRayDistance], 8);
    this._levels.forEach((level, l) => {
      const origin = level.origin ?? [0, 0, 0];
      p.set([origin[0], origin[1], origin[2], level.spacing], 12 + l * 8);
      p.set([level.grid[0], level.grid[1], level.grid[2], level.tileBase], 16 + l * 8);
    });
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
   * Pushes a selected probe out of nearby geometry along the field's gradient,
   * from its grid point on its first update and every few frames after, never
   * through a surface.
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
            this.$l.index = pb.int(pb.compAnd(this.sel, pb.uint(SELECT_INDEX_MASK)));
            this.$l.level = pb.int(pb.compAnd(pb.sar(this.sel, SELECT_LEVEL_SHIFT), pb.uint(0x7f)));
            this.$l.texel = probeTexelFromIndex(this, this.level, this.index);
            this.$l.world = probeWorldFromTexel(this, this.level, this.texel);
            this.$l.data = this[PROBE_DATA].at(this.index);
            this.$l.spacing = probeLevelOrigin(this, this.level).w;
            this.$l.grid = pb.mul(pb.vec3(this.world), this.spacing);
            // Keep at least this far from surfaces, moving at most this far from the grid point
            this.$l.keep = pb.mul(this.spacing, 0.3);
            this.$l.limit = pb.mul(this.spacing, 0.45);
            // Central differences at least a finest field voxel apart: a wall or
            // floor thinner than a voxel never reads negative, and differences
            // inside it point either way
            this.$l.h = pb.max(pb.mul(this.spacing, 0.05), this[GLOBAL_SDF_LEVELS].at(0).w);
            // Crossing check every quarter voxel: the inside of such a wall dips
            // only a few centimetres below the distance at its face
            this.$l.probeStep = pb.mul(this[GLOBAL_SDF_LEVELS].at(0).w, 0.25);
            // From the grid point every time, never from where the probe was:
            // the result depends on the field alone, so a probe misplaced while
            // the field was still being built returns, and none drifts away
            // over successive relocations to where it never comes back from
            this.$l.pos = this.grid;
            this.$for(pb.int('iter'), 0, 3, function () {
              this.$l.d = sampleSceneSDF(this, this.pos, levels);
              this.$if(pb.greaterThanEqual(this.d, this.keep), function () {
                this.$break();
              });
              this.$l.g = pb.vec3(
                pb.sub(
                  sampleSceneSDF(this, pb.add(this.pos, pb.vec3(this.h, 0, 0)), levels),
                  sampleSceneSDF(this, pb.sub(this.pos, pb.vec3(this.h, 0, 0)), levels)
                ),
                pb.sub(
                  sampleSceneSDF(this, pb.add(this.pos, pb.vec3(0, this.h, 0)), levels),
                  sampleSceneSDF(this, pb.sub(this.pos, pb.vec3(0, this.h, 0)), levels)
                ),
                pb.sub(
                  sampleSceneSDF(this, pb.add(this.pos, pb.vec3(0, 0, this.h)), levels),
                  sampleSceneSDF(this, pb.sub(this.pos, pb.vec3(0, 0, this.h)), levels)
                )
              );
              this.$l.n = pb.div(this.g, pb.max(pb.length(this.g), 1e-6));
              this.$l.next = pb.sub(pb.add(this.pos, pb.mul(this.n, pb.sub(this.keep, this.d))), this.grid);
              this.$l.len = pb.length(this.next);
              this.$if(pb.greaterThan(this.len, this.limit), function () {
                this.next = pb.mul(this.next, pb.div(this.limit, this.len));
              });
              this.next = pb.add(this.grid, this.next);
              // Moving away from a surface the distance only grows; a dip on
              // the way means the move passes through geometry, so stop here
              this.$l.moveLen = pb.length(pb.sub(this.next, this.pos));
              this.$l.samples = pb.int(pb.min(pb.ceil(pb.div(this.moveLen, this.probeStep)), 64));
              this.$l.through = false;
              this.$for(pb.int('k'), 1, this.samples, function () {
                this.$l.q = pb.mix(this.pos, this.next, pb.div(pb.float(this.k), pb.float(this.samples)));
                this.$if(
                  pb.lessThan(sampleSceneSDF(this, this.q, levels), pb.sub(this.d, this.probeStep)),
                  function () {
                    this.through = true;
                    this.$break();
                  }
                );
              });
              this.$if(this.through, function () {
                this.$break();
              });
              this.pos = this.next;
            });
            this.$l.offset = pb.sub(this.pos, this.grid);
            this[PROBE_DATA].setAt(this.index, pb.vec4(this.offset, this.data.w));
          });
        }
      });
      this._relocateBindGroup = device.createBindGroup(this._relocateProgram.bindGroupLayouts[0]);
    }
    // Which selected probes relocate this frame
    const flags = new Uint32Array(new ArrayBuffer(this._budget * 4));
    for (let i = 0; i < selected; i++) {
      const sel = this._selection[i];
      const level = this._levels[(sel >>> SELECT_LEVEL_SHIFT) & 0x7f];
      const index = (sel & SELECT_INDEX_MASK) - level.tileBase;
      if (this._frame - level.lastRelocated[index] >= RELOCATE_EVERY) {
        flags[i] = 1;
        level.lastRelocated[index] = this._frame;
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
  /**
   * Traces the rays of the selected probes: one fragment per ray, the hit's
   * voxel radiance or the sky, and the hit distance (negative when the ray
   * started inside geometry, {@link SKY_ESCAPE_DISTANCE} when it escaped to
   * the sky), into the ray texture.
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
    // Rays read the voxel radiance, kept at the fixed cache exposure, and the
    // sky bake, stored at the same exposure: the sky takes the strength alone
    const envStrength = scene.env.light.strength ?? 0;
    // No sky without an environment light (its stand-in carries only the probes)
    const skyMode =
      scene.env.light.type === 'none'
        ? 'none'
        : envLight.hasRadiance()
          ? 'radiance'
          : envLight.hasIrradiance()
            ? 'irradiance'
            : 'none';
    const envVariant =
      skyMode !== 'none'
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
            this.$l.index = pb.int(pb.compAnd(this.sel, pb.uint(SELECT_INDEX_MASK)));
            this.$l.level = pb.int(pb.compAnd(pb.sar(this.sel, SELECT_LEVEL_SHIFT), pb.uint(0x7f)));
            this.$l.texel = probeTexelFromIndex(this, this.level, this.index);
            this.$l.world = probeWorldFromTexel(this, this.level, this.texel);
            this.$l.data = this[PROBE_DATA].at(this.index);
            this.$l.pos = probePosition(this, this.level, this.world, this.data);
            this.$l.dir = quatRotate(
              this,
              this.rotation,
              sphericalFibonacci(this, pb.float(this.fc.x), this.rayInfo.x)
            );
            // Coarser levels look proportionally farther
            this.$l.spacing = probeLevelOrigin(this, this.level).w;
            this.$l.maxDist = pb.mul(
              this[PROBE_PARAMS].at(2).w,
              pb.div(this.spacing, probeLevelOrigin(this, 0).w)
            );
            this.$l.radiance = pb.vec3(0);
            this.$l.dist = this.maxDist;
            this.$l.d0 = sampleSceneSDF(this, this.pos, levels);
            this.$if(pb.lessThan(this.d0, 0), function () {
              // Started inside geometry: a backface hit at no distance
              this.dist = pb.float(-0.01);
            }).$else(function () {
              this.$l.t = pb.float(0);
              this.$l.hit = false;
              this.$l.prevD = pb.float(0);
              this.$for(pb.int('i'), 0, TRACE_STEPS, function () {
                this.$l.s = sampleSceneSDFHinted(
                  this,
                  pb.add(this.pos, pb.mul(this.dir, this.t)),
                  this.prevD,
                  levels
                );
                this.$l.d = this.s.x;
                this.prevD = this.d;
                this.$if(
                  pb.lessThan(
                    this.d,
                    sdfTraceTolerance(this, this.s, pb.add(0.01, pb.mul(this.t, 0.004)), this.t)
                  ),
                  function () {
                    this.hit = true;
                    this.$break();
                  }
                );
                this.t = pb.add(this.t, pb.max(this.d, 0.02));
                this.$if(pb.greaterThan(this.t, this.maxDist), function () {
                  this.$break();
                });
              });
              this.$if(this.hit, function () {
                this.dist = this.t;
                this.$l.hp = pb.add(this.pos, pb.mul(this.dir, this.t));
                // The side of the surface the ray came from: the field's gradient
                // at the hit, by forward differences over the finest voxel
                this.$l.he = this[GLOBAL_SDF_LEVELS].at(0).w;
                this.$l.hd = sampleSceneSDF(this, this.hp, levels);
                this.$l.hg = pb.vec3(
                  pb.sub(sampleSceneSDF(this, pb.add(this.hp, pb.vec3(this.he, 0, 0)), levels), this.hd),
                  pb.sub(sampleSceneSDF(this, pb.add(this.hp, pb.vec3(0, this.he, 0)), levels), this.hd),
                  pb.sub(sampleSceneSDF(this, pb.add(this.hp, pb.vec3(0, 0, this.he)), levels), this.hd)
                );
                this.$l.hn = this.$choice(
                  pb.greaterThan(pb.dot(this.hg, this.hg), 1e-12),
                  pb.normalize(this.hg),
                  pb.neg(this.dir)
                );
                this.radiance = sampleVoxelSceneRadiance(this, this.hp, this.hn, levels);
              }).$else(function () {
                this.dist = pb.float(SKY_ESCAPE_DISTANCE);
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
    bg.setTexture(VOXEL_SCENE_ANISO0, voxels.radianceAniso0, fetchSampler('clamp_nearest_nomip'));
    bg.setTexture(VOXEL_SCENE_ANISO1, voxels.radianceAniso1, fetchSampler('clamp_nearest_nomip'));
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
  /**
   * Copies the tiles staged by {@link ProbeVolume.runBlend} into the maps, one
   * workgroup per updated probe: the rest of the maps stays as it was, where
   * copying the whole staging maps would move every probe's tiles each frame.
   * @internal
   */
  private runCommit(selected: number) {
    const device = getDevice();
    const twoChannel = this._visibilityFormat === 'rg16f';
    if (!this._commitProgram) {
      this._commitProgram = buildSDFProgram({
        label: 'ProbeCommit',
        workgroupSize: [VISIBILITY_TEXELS, VISIBILITY_TEXELS, 1],
        compute(pb) {
          this[PROBE_PARAMS] = pb.vec4[PROBE_PARAM_VEC4S]().uniform(0);
          this.selected = pb.uint[0]().storageBufferReadonly(0);
          this.stagedIrradiance = pb.tex2D().sampleType('unfilterable-float').uniform(0);
          this.stagedVisibility = pb.tex2D().sampleType('unfilterable-float').uniform(0);
          this.irradiance = pb.texStorage2D.rgba16float().storage(0);
          this.visibility = twoChannel
            ? pb.texStorage2D.rg16float().storage(0)
            : pb.texStorage2D.rgba16float().storage(0);
          pb.main(function () {
            this.$l.slot = this.$builtins.workGroupId.x;
            this.$l.index = pb.int(pb.compAnd(this.selected.at(this.slot), pb.uint(SELECT_INDEX_MASK)));
            this.$l.uv = pb.ivec2(this.$builtins.localInvocationId.xy);
            pb.textureStore(
              this.visibility,
              pb.uvec2(pb.add(probeTileOrigin(this, this.index, pb.float(VISIBILITY_TEXELS)), this.uv)),
              pb.textureLoad(
                this.stagedVisibility,
                pb.add(stagingOrigin(this, this.slot, VISIBILITY_TEXELS), this.uv),
                0
              )
            );
            this.$if(pb.all(pb.lessThan(this.uv, pb.ivec2(IRRADIANCE_TEXELS))), function () {
              pb.textureStore(
                this.irradiance,
                pb.uvec2(pb.add(probeTileOrigin(this, this.index, pb.float(IRRADIANCE_TEXELS)), this.uv)),
                pb.textureLoad(
                  this.stagedIrradiance,
                  pb.add(stagingOrigin(this, this.slot, IRRADIANCE_TEXELS), this.uv),
                  0
                )
              );
            });
          });
        }
      })!;
      this._commitBindGroup = device.createBindGroup(this._commitProgram.bindGroupLayouts[0]);
    }
    const bg = this._commitBindGroup!;
    bg.setValue(PROBE_PARAMS, this._params);
    bg.setBuffer('selected', this._selected!);
    bg.setTexture('stagedIrradiance', this._irradianceNext!, fetchSampler('clamp_nearest_nomip'));
    bg.setTexture('stagedVisibility', this._visibilityNext!, fetchSampler('clamp_nearest_nomip'));
    bg.setTexture('irradiance', this._irradiance!);
    bg.setTexture('visibility', this._visibility!);
    device.setProgram(this._commitProgram);
    device.setBindGroup(0, bg);
    device.compute(selected, 1, 1);
  }
  /** @internal */
  private createBlendProgram(texels: number, visibility: boolean) {
    const rays = this._rays;
    const twoChannel = this._visibilityFormat === 'rg16f';
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
        this.next =
          visibility && twoChannel
            ? pb.texStorage2D.rg16float().storage(0)
            : pb.texStorage2D.rgba16float().storage(0);
        // A batch of the probe's rays, direction and traced result, read once per workgroup
        this.batchDir = pb.vec4[BLEND_BATCH]().workgroup();
        this.batchRay = pb.vec4[BLEND_BATCH]().workgroup();
        pb.main(function () {
          this.$l.slot = this.$builtins.workGroupId.x;
          this.$l.sel = this.selected.at(this.slot);
          this.$l.index = pb.int(pb.compAnd(this.sel, pb.uint(SELECT_INDEX_MASK)));
          this.$l.level = pb.int(pb.compAnd(pb.sar(this.sel, SELECT_LEVEL_SHIFT), pb.uint(0x7f)));
          this.$l.first = pb.greaterThan(pb.compAnd(this.sel, pb.uint(SELECT_FIRST_BIT)), pb.uint(0));
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
          // Distances are clamped a little beyond the probe spacing: the
          // moments only have to tell blockers between neighbouring probes apart
          this.$l.maxDist = pb.mul(probeLevelOrigin(this, this.level).w, 2.6);
          // One ray, `ray` its traced result and `c` the cosine to the texel's direction
          const accumulate = (scope: PBInsideFunctionScope) => {
            if (visibility) {
              // Sharpened so a texel only sees rays near its direction; below
              // cos 0.8 the weight is under 2e-5, nothing next to the rays near it
              scope.$if(pb.greaterThan(scope.c, 0.8), function (this: PBInsideFunctionScope) {
                this.$l.w = pb.pow(this.c, 50);
                this.$l.hd = pb.abs(this.ray.a);
                this.$if(pb.lessThan(this.ray.a, 0), function () {
                  this.hd = pb.mul(this.hd, 0.2);
                });
                this.hd = pb.min(this.hd, this.maxDist);
                this.sum = pb.add(this.sum, pb.mul(pb.vec4(this.hd, pb.mul(this.hd, this.hd), 0, 0), this.w));
                this.wsum = pb.add(this.wsum, this.w);
              });
            } else {
              // Cosine-weighted share of the rays that escaped to the sky: the
              // sky visibility, in alpha, as DDGI keeps it beside the irradiance
              // ([Majercik19] stores the escape mask with every ray)
              scope.$if(pb.greaterThanEqual(scope.ray.a, 0), function (this: PBInsideFunctionScope) {
                this.$l.escaped = pb.float(pb.greaterThanEqual(this.ray.a, SKY_ESCAPE_DISTANCE * 0.5));
                this.sum = pb.add(this.sum, pb.mul(pb.vec4(this.ray.rgb, this.escaped), this.c));
                this.wsum = pb.add(this.wsum, this.c);
              });
            }
          };
          this.$l.thread = pb.int(
            pb.add(pb.mul(this.$builtins.localInvocationId.y, texels), this.$builtins.localInvocationId.x)
          );
          for (let b = 0; b < rays; b += BLEND_BATCH) {
            const count = Math.min(BLEND_BATCH, rays - b);
            // Each thread stages every (texels²)-th ray of the batch
            this.$for(pb.int('stageRound'), 0, Math.ceil(count / (texels * texels)), function () {
              this.$l.j = pb.add(this.thread, pb.mul(this.stageRound, texels * texels));
              this.$if(pb.greaterThanEqual(this.j, count), function () {
                this.$break();
              });
              this.$l.r = pb.add(this.j, b);
              this.batchRay.setAt(this.j, pb.textureLoad(this.rays, pb.ivec2(this.r, pb.int(this.slot)), 0));
              this.batchDir.setAt(
                this.j,
                pb.vec4(
                  quatRotate(this, this.rotation, sphericalFibonacci(this, pb.float(this.r), pb.float(rays))),
                  0
                )
              );
            });
            pb.workgroupBarrier();
            this.$for(pb.int('k'), 0, count, function () {
              this.$l.ray = this.batchRay.at(this.k);
              this.$l.c = pb.max(pb.dot(this.dir, this.batchDir.at(this.k).xyz), 0);
              accumulate(this);
            });
            // The next batch overwrites the one still being read
            pb.workgroupBarrier();
          }
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
          // Staged by selection slot; runCommit copies the tile into the map
          pb.textureStore(
            this.next,
            pb.uvec2(pb.add(stagingOrigin(this, this.slot, s), this.uv)),
            visibility ? pb.vec4(this.value.xyz, 1) : this.value
          );
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

/** First texel of a selection slot's tile in a blend output, {@link STAGING_COLS} tiles a row. */
function stagingOrigin(scope: PBInsideFunctionScope, slot: PBShaderExp, texels: number) {
  const pb = scope.$builder;
  const s = pb.int(slot);
  return pb.mul(pb.ivec2(pb.mod(s, STAGING_COLS), pb.div(s, STAGING_COLS)), texels) as PBShaderExp;
}

/** Visibility texels as saved, rgba16f: the two moments, then 0 and 1. */
function expandVisibility(rg: Uint16Array<ArrayBuffer>, texels: number) {
  const out = new Uint16Array(new ArrayBuffer(texels * 8));
  for (let i = 0; i < texels; i++) {
    out[i * 4] = rg[i * 2];
    out[i * 4 + 1] = rg[i * 2 + 1];
    // Half 1.0, which the blend writes to alpha
    out[i * 4 + 3] = 0x3c00;
  }
  return out;
}

/** The two moments of saved rgba16f visibility texels, for an rg16f map. */
function compactVisibility(rgba: Uint16Array, texels: number) {
  const out = new Uint16Array(new ArrayBuffer(texels * 4));
  for (let i = 0; i < texels; i++) {
    out[i * 2] = rgba[i * 4];
    out[i * 2 + 1] = rgba[i * 4 + 1];
  }
  return out;
}
