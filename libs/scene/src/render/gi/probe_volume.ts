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
import type { Nullable } from '@zephyr3d/base';
import { half2float, PRNG, Vector3, Vector4 } from '@zephyr3d/base';
import { getDevice } from '../../app/api';
import type { Scene } from '../../scene/scene';
import type { Camera } from '../../camera/camera';
import type { Drawable, DrawContext } from '../drawable';
import type { SceneNode } from '../../scene/scene_node';
import type { BatchGroup } from '../../scene/batchgroup';
import type { CullDrawnCallback } from '../cull_visitor';
import type { SceneSDF } from '../sdf/scene_sdf';
import type { VoxelScene } from './voxel_scene';
import { buildSDFProgram } from '../sdf/sdf_programs';
import { drawFullscreenQuad } from '../fullscreenquad';
import { fetchSampler } from '../../utility/misc';
import { getGICacheExposure } from '../../utility/physical';
import { RENDER_PASS_TYPE_LIGHT } from '../../values';
import { RenderGraphExecutor } from '../rendergraph/executor';
import {
  declareDynamicSDFUniforms,
  declareGlobalSDFUniforms,
  GLOBAL_SDF_LEVELS,
  GLOBAL_SDF_PARAMS,
  sampleGlobalSDF,
  sampleGlobalSDFLevel,
  sampleSceneSDF,
  sampleSceneSDFHinted,
  sdfRefineHit,
  sdfSurfaceExpand
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
  PROBE_STATE_INACTIVE,
  PROBE_VISIBILITY,
  probeActive,
  probeLevelGrid,
  probeLevelOrigin,
  probePosition,
  probeTexelFromIndex,
  probeTexelFromWorld,
  probeTileIndex,
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
/** Visibility distance clamp, in probe spacings: just enough to separate blockers between neighbouring probes. */
const VISIBILITY_RANGE = 2.6;
/** Frames between relocations of an updated probe. */
const RELOCATE_EVERY = 8;
/**
 * Frames between updates of a probe no surface reads. Such a probe only looks out for something
 * coming within its reach that neither the scene field nor a draw reported.
 */
const IDLE_PROBE_PERIOD = 240;
/** Frames between readbacks of the probes' nearest geometry, see {@link ProbeVolume.classify}. */
const CLASSIFY_EVERY = 30;
/** Frames a probe stays read after a drawn object marked it, so frames drawn without an update lose none. */
const DRAWN_FRAMES = 3;
/** Nearest geometry, in probe spacings, of a probe with none known within reach. */
const PROBE_FAR = 1e6;
/** No update classifies the probe until the scene field has settled, see {@link ProbeVolume.settle}. */
const UNSETTLED = 0x7fffffff;
/** Bits of a selection entry: tile index, level, first-update flag. */
const SELECT_INDEX_MASK = 0x00ffffff;
const SELECT_LEVEL_SHIFT = 24;
const SELECT_FIRST_BIT = 0x80000000;
/** Magic and version of a saved probe state. */
const STATE_MAGIC = 0x50494a5a; // 'ZJIP'
/** Bump when the saved layout or meaning changes. */
const STATE_VERSION = 5;
/** Hit distance written by a sky-escaping ray: beyond any trace length, within half float range. */
const SKY_ESCAPE_DISTANCE = 16384;

/**
 * Settings of the probe volume, on {@link SceneGI}.
 * @public
 */
export interface ProbeVolumeOptions {
  /** Probes along x, y and z of every level. */
  grid: [number, number, number];
  /** Distance between probes of the finest level in world units. */
  spacing: number;
  /** Clipmap levels, each `levelScale` times the spacing of the one inside it; 1 to {@link PROBE_MAX_LEVELS}. */
  levels: number;
  /** Spacing ratio between consecutive levels, typically 2. */
  levelScale: number;
  /** Rays traced per probe per update. */
  raysPerProbe: number;
  /** Probes updated per frame, all levels together. */
  budget: number;
  /** Share of the previous value kept per update, 0 to 1. */
  hysteresis: number;
  /** Surface offset along the normal when sampling, in probe spacings of the level read. */
  normalBias: number;
  /** Surface offset towards the viewer when sampling, in probe spacings of the level read. */
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
  /**
   * Probes some surface may read: near geometry, by a drawn object the scene field does not
   * hold, or not classified yet. The others are updated only every few seconds.
   */
  wanted: number;
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
  /** Frame a probe was last selected in, so no frame updates one twice. */
  lastSelected: Int32Array;
  cursor: number;
  /** Whether geometry lay within a probe's reach at its last classification; 1 until classified. */
  near: Uint8Array;
  /** Frame from which an update classifies a probe, {@link UNSETTLED} until the scene field settles. */
  classifyAfter: Int32Array;
  /** Frame a drawn object the scene field does not hold last came within a probe's reach. */
  drawn: Int32Array;
  /** Probes some surface may read, this frame; see {@link ProbeVolume.computeWanted}. */
  wanted: Uint8Array;
  wantedCount: number;
  /** Cursor of the probes no surface reads. */
  idleCursor: number;
}

/** Per-axis tables of a level's window, see {@link ProbeVolume.computeWanted}. */
interface ProbeAxis {
  /** Slot of the k-th probe of the window. */
  slot: Int32Array;
  /** Within the full-weight region of the finer level, a cell to spare. */
  inner: Uint8Array;
}

/**
 * The probe volume read by the draw, or null outside the light pass, with the
 * environment light off, or with GI disabled or not yet built.
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
 * The scene's built probe volume when GI is on, for passes other than the light pass.
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
 * A camera-centred clipmap of DDGI light probes (Majercik et al. JCGT 2019/2021)
 * holding octahedral irradiance and visibility maps. Each frame a budget of probes
 * traces rays through the scene SDF, shading hits from the voxel scene and misses
 * from the sky. Windows scroll toroidally; entering probes are seeded from the level
 * above.
 * Read via {@link sampleProbeIrradiance}; state can be saved with
 * {@link ProbeVolume.exportState}. WebGPU only.
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
  /** Irradiance seeds of one update's probes starting over, by selection slot like the blend outputs. */
  private _irradianceSeed: Nullable<Texture2D>;
  private _visibility: Nullable<Texture2D>;
  private _visibilityNext: Nullable<Texture2D>;
  /** Two distance moments; rg16f where storage-writable (texture-formats-tier1), else rgba16f. */
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
  /**
   * Per probe, in its level's spacings: the nearest hit of its last update's rays, and its
   * distance to the static scene field at its last relocation. {@link PROBE_FAR} for none.
   */
  private _hits: Nullable<GPUDataBuffer>;
  private readonly _hitsRead: Float32Array<ArrayBuffer>;
  private _hitsPending: boolean;
  private _hitsFrame: number;
  private _hitsFailed: boolean;
  /** Some probes wait for the scene field to settle before an update may classify them. */
  private _awaitSettle: boolean;
  private _listenedSDF: Nullable<SceneSDF>;
  /** Whether a batch group holds meshes the scene field does not, by its contents and the field's. */
  private readonly _groupMarks: WeakMap<BatchGroup, { tag: number; version: number; marks: boolean }>;
  private readonly _scanned: Int32Array;
  private readonly _idleScanned: Int32Array;
  private readonly _axes: ProbeAxis[];
  /** The scene field's window this frame, beyond which the probes' rays see nothing it holds. */
  private _hasField: boolean;
  private readonly _fieldMin: Vector3;
  private readonly _fieldMax: Vector3;
  private _relocateProgram: Nullable<GPUProgram>;
  private _relocateBindGroup: Nullable<BindGroup>;
  private _seedProgram: Nullable<GPUProgram>;
  private _seedBindGroup: Nullable<BindGroup>;
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
  /**
   * Given to the culls of the light pass: marks the probes around each lit object drawn that the
   * scene field does not hold, which the probes' rays and classification cannot see.
   * @internal
   */
  readonly drawnCallback: CullDrawnCallback;
  constructor(scene: Scene, options: ProbeVolumeOptions) {
    this._scene = scene;
    this._options = options;
    const levels = Math.max(1, Math.min(PROBE_MAX_LEVELS, Math.floor(options.levels)));
    const scale = Math.max(1.5, options.levelScale);
    const grid = options.grid.map((v) => Math.max(2, Math.floor(v))) as [number, number, number];
    this._levels = [];
    let tileBase = 0;
    for (let l = 0; l < levels; l++) {
      const count = grid[0] * grid[1] * grid[2];
      this._levels.push({
        grid: [...grid],
        spacing: options.spacing * scale ** l,
        count,
        tileBase,
        origin: null,
        state: new Uint8Array(count),
        lastRelocated: new Int32Array(count).fill(-1000),
        lastSelected: new Int32Array(count).fill(-1),
        cursor: 0,
        near: new Uint8Array(count).fill(1),
        classifyAfter: new Int32Array(count).fill(UNSETTLED),
        drawn: new Int32Array(count).fill(-UNSETTLED),
        wanted: new Uint8Array(count),
        wantedCount: 0,
        idleCursor: 0
      });
      tileBase += count;
    }
    this._count = tileBase;
    this._tileCols = Math.ceil(Math.sqrt(this._count));
    this._rays = Math.max(16, Math.min(1024, Math.floor(options.raysPerProbe)));
    this._budget = Math.max(1, Math.min(this._count, Math.floor(options.budget)));
    this._irradiance = null;
    this._irradianceNext = null;
    this._irradianceSeed = null;
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
    this._hits = null;
    this._hitsRead = new Float32Array(new ArrayBuffer(this._count * 8));
    this._hitsPending = false;
    this._hitsFrame = -CLASSIFY_EVERY;
    this._hitsFailed = false;
    this._awaitSettle = true;
    this._listenedSDF = null;
    this._groupMarks = new WeakMap();
    this._scanned = new Int32Array(levels);
    this._idleScanned = new Int32Array(levels);
    const axisLength = Math.max(...grid);
    this._axes = [0, 1, 2].map(() => ({
      slot: new Int32Array(axisLength),
      inner: new Uint8Array(axisLength)
    }));
    this._hasField = false;
    this._fieldMin = new Vector3();
    this._fieldMax = new Vector3();
    this._relocateProgram = null;
    this._relocateBindGroup = null;
    this._seedProgram = null;
    this._seedBindGroup = null;
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
    this.drawnCallback = (node, drawable) => this.markDrawn(node, drawable);
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
    let wanted = 0;
    for (const level of this._levels) {
      for (let i = 0; i < level.count; i++) {
        uninitialized += level.state[i] ? 0 : 1;
      }
      wanted += level.wantedCount;
    }
    return {
      levels: this._levels.length,
      probes: this._count,
      uninitialized,
      lastUpdated: this._lastUpdated,
      wanted,
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
   * Rescales probe reads from the fixed cache exposure to the camera's. Call
   * every frame, also while frozen, so params follow exposure and SDF windows.
   */
  setReadExposure(camera: Camera) {
    const scene = this._scene;
    const live = scene.lightingMode === 'physical' ? camera.exposure : 1;
    this._exposureScale = live / getGICacheExposure(scene.lightingMode);
    // Before the first update there are no maps; that update writes the params
    if (this._irradiance && this._visibility) {
      this.updateParams();
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
    if (this._listenedSDF !== sdf) {
      this._listenedSDF?.off('dirty', this.onFieldDirty, this);
      sdf.on('dirty', this.onFieldDirty, this);
      this._listenedSDF = sdf;
    }
    const cameraPos = camera.getWorldPosition();
    for (const level of this._levels) {
      this.moveWindow(level, cameraPos);
    }
    this._frame++;
    if (this._awaitSettle && global.settled) {
      this.settle();
    }
    const selected = this.select(global);
    this.updateParams();
    if (selected === 0) {
      return;
    }
    this._selected!.bufferSubData(0, this._selection);
    // A fresh random rotation of the ray set each update
    this.randomRotation();
    RenderGraphExecutor.profileScope('ProbeRelocate', () => this.runRelocate(global, selected));
    // After the relocation, which decides which probes start over, and before
    // the blend, which reads the seeds
    RenderGraphExecutor.profileScope('ProbeSeed', () => this.runSeed(selected));
    RenderGraphExecutor.profileScope('ProbeTrace', () => this.runTrace(global, voxels, camera, selected));
    this.runBlend(selected);
    RenderGraphExecutor.profileScope('ProbeCommit', () => this.runCommit(selected));
    this._updates++;
    this._lastUpdated = selected;
    // After this frame's updates, which the copy follows
    this.readHits();
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
   * Reads back up to `limit` probes of a level inside a world box, nearest the
   * centre first, for inspection: position, update/inactive state, mean
   * irradiance and sky visibility, and min/mean visibility hit distance.
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
    const picked: { world: number[]; index: number }[] = [];
    for (let z = lo[2]; z <= hi[2]; z++) {
      for (let y = lo[1]; y <= hi[1]; y++) {
        for (let x = lo[0]; x <= hi[0]; x++) {
          const w = [x, y, z];
          if (w.some((v, a) => v < l.origin![a] || v >= l.origin![a] + l.grid[a])) {
            continue;
          }
          const local =
            wrapIndex(x, l.grid[0]) +
            l.grid[0] * (wrapIndex(y, l.grid[1]) + l.grid[1] * wrapIndex(z, l.grid[2]));
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
        inactive: d[3] > PROBE_STATE_INACTIVE - 0.5,
        irradiance: irrSum.slice(0, 3).map((v) => r(v / n)),
        sky: r(irrSum[3] / n),
        hitMin: r(visMin),
        hitMean: r(visSum / m)
      };
    });
    return { level, spacing: s, origin: [...l.origin], grid: [...l.grid], probes };
  }
  /**
   * Restores a state saved by {@link ProbeVolume.exportState} with matching
   * settings; freeze the lighting afterwards or the windows follow the camera.
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
    this.resetClassification();
    this.updateParams();
    this._updates = Math.max(this._updates, 1);
  }
  dispose() {
    for (const tex of [
      this._irradiance,
      this._irradianceNext,
      this._irradianceSeed,
      this._visibility,
      this._visibilityNext,
      this._rayTexture
    ]) {
      tex?.dispose();
    }
    this._irradiance =
      this._irradianceNext =
      this._irradianceSeed =
      this._visibility =
      this._visibilityNext =
      this._rayTexture =
        null;
    this._rayFramebuffer?.dispose();
    this._rayFramebuffer = null;
    this._data?.dispose();
    this._selected?.dispose();
    this._hits?.dispose();
    this._data = this._selected = this._hits = null;
    this._hitsPending = false;
    this._listenedSDF?.off('dirty', this.onFieldDirty, this);
    this._listenedSDF = null;
    for (const buffer of this._scratch.values()) {
      buffer.dispose();
    }
    this._scratch.clear();
    for (const bg of [
      this._relocateBindGroup,
      this._seedBindGroup,
      this._traceBindGroup,
      this._blendIrrBindGroup,
      this._blendVisBindGroup,
      this._commitBindGroup
    ]) {
      bg?.dispose();
    }
    for (const prog of [
      this._relocateProgram,
      this._seedProgram,
      this._traceProgram,
      this._blendIrrProgram,
      this._blendVisProgram,
      this._commitProgram
    ]) {
      prog?.dispose();
    }
    this._relocateBindGroup = this._traceBindGroup = this._blendIrrBindGroup = this._blendVisBindGroup = null;
    this._relocateProgram = this._traceProgram = this._blendIrrProgram = this._blendVisProgram = null;
    this._seedProgram = this._seedBindGroup = null;
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
    this._irradianceSeed = make(IRRADIANCE_TEXELS, '@ProbeIrradianceSeed', STAGING_COLS, stagingRows);
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
    this._hits = device.createBuffer(this._count * 8, { usage: 'uniform', storage: true })!;
    this._hitsPending = false;
    for (const level of this._levels) {
      level.state.fill(0);
    }
    this.resetClassification();
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
    // The probes entering are classified once the field there is known
    this._awaitSettle = true;
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
            const index = wrapIndex(wx, n[0]) + n[0] * (wrapIndex(wy, n[1]) + n[1] * wrapIndex(wz, n[2]));
            level.state[index] = 0;
            level.lastRelocated[index] = -1000;
            level.near[index] = 1;
            level.classifyAfter[index] = UNSETTLED;
            level.drawn[index] = -UNSETTLED;
            this._data!.bufferSubData((level.tileBase + index) * 16, this._dataReset);
          }
        }
      }
    }
  }
  /**
   * Picks the probes to update: never-updated ones first (a quarter of the budget to the
   * coarsest level, the rest finest first); then a trickle of the probes no surface reads, each
   * about once per {@link IDLE_PROBE_PERIOD} frames; then the probes surfaces may read, each level
   * by its share of them and what is left finest first; then, with budget to spare, more of the
   * probes no surface reads. At most once per frame per probe, since two updates would race on
   * the same staged tile.
   * @internal
   */
  private select(global: NonNullable<SceneSDF['global']>) {
    let count = 0;
    const budget = this._budget;
    const frame = this._frame;
    const takeNew = (l: number, limit: number) => {
      const level = this._levels[l];
      for (let i = 0; i < level.count && count < limit; i++) {
        if (!level.state[i]) {
          this._selection[count++] =
            ((level.tileBase + i) | (l << SELECT_LEVEL_SHIFT) | SELECT_FIRST_BIT) >>> 0;
          level.state[i] = 1;
          level.lastSelected[i] = frame;
        }
      }
    };
    if (this._levels.length > 1) {
      takeNew(this._levels.length - 1, budget >> 2);
    }
    for (let l = 0; l < this._levels.length && count < budget; l++) {
      takeNew(l, budget);
    }
    const wantedTotal = this.computeWanted(global);
    this._scanned.fill(0);
    this._idleScanned.fill(0);
    // Probes no surface reads, along their own cursor, scanning at most `scans` of them
    const takeIdle = (l: number, scans: number) => {
      const level = this._levels[l];
      for (let n = 0; n < scans && count < budget && this._idleScanned[l] < level.count; n++) {
        const i = level.idleCursor;
        level.idleCursor = (i + 1) % level.count;
        this._idleScanned[l]++;
        if (level.state[i] && !level.wanted[i] && level.lastSelected[i] !== frame) {
          this._selection[count++] = ((level.tileBase + i) | (l << SELECT_LEVEL_SHIFT)) >>> 0;
          level.lastSelected[i] = frame;
        }
      }
    };
    // Probes some surface may read, at most `limit` of them
    const takeWanted = (l: number, limit: number) => {
      const level = this._levels[l];
      let taken = 0;
      while (taken < limit && count < budget && this._scanned[l] < level.count) {
        const i = level.cursor;
        level.cursor = (i + 1) % level.count;
        this._scanned[l]++;
        if (level.state[i] && level.wanted[i] && level.lastSelected[i] !== frame) {
          this._selection[count++] = ((level.tileBase + i) | (l << SELECT_LEVEL_SHIFT)) >>> 0;
          level.lastSelected[i] = frame;
          taken++;
        }
      }
    };
    for (let l = 0; l < this._levels.length; l++) {
      takeIdle(l, Math.ceil(this._levels[l].count / IDLE_PROBE_PERIOD));
    }
    if (wantedTotal > 0) {
      const remaining = budget - count;
      for (let l = 0; l < this._levels.length; l++) {
        takeWanted(l, Math.ceil((remaining * this._levels[l].wantedCount) / wantedTotal));
      }
      for (let l = 0; l < this._levels.length; l++) {
        takeWanted(l, budget);
      }
    }
    for (let l = 0; l < this._levels.length; l++) {
      takeIdle(l, this._levels[l].count);
    }
    for (let i = count; i < budget; i++) {
      this._selection[i] = 0xffffffff;
    }
    return count;
  }
  /**
   * Reach of a probe in its level's spacings: a surface reads the eight probes around the point
   * it samples, which the normal and view biases displace from the surface.
   * @internal
   */
  private reach() {
    return Math.sqrt(3) + this._options.normalBias + this._options.viewBias;
  }
  /**
   * Finds the probes some surface may read this frame: any not covered by the finer level's
   * full-weight region that has geometry within reach by its classification, is not classified
   * yet, or had a drawn object the probes' rays cannot see come within reach.
   * @returns How many, all levels together.
   * @internal
   */
  private computeWanted(global: NonNullable<SceneSDF['global']>) {
    const drawnFrom = this._frame - DRAWN_FRAMES;
    // For the draws of this frame, see markDrawn
    this._hasField = global.getCoverage(this._fieldMin, this._fieldMax);
    let total = 0;
    for (let l = 0; l < this._levels.length; l++) {
      const level = this._levels[l];
      const origin = level.origin!;
      const n = level.grid;
      const s = level.spacing;
      const finer = l > 0 ? this._levels[l - 1] : null;
      for (let a = 0; a < 3; a++) {
        const axis = this._axes[a];
        for (let k = 0; k < n[a]; k++) {
          const w = origin[a] + k;
          const p = w * s;
          axis.slot[k] = wrapIndex(w, n[a]);
          // A finer level is fully weighted 2.5 probes in from its window edge, see sampleProbeIrradiance
          axis.inner[k] =
            finer?.origin &&
            p - s >= (finer.origin[a] + 2.5) * finer.spacing &&
            p + s <= (finer.origin[a] + finer.grid[a] - 3.5) * finer.spacing
              ? 1
              : 0;
        }
      }
      const [ax, ay, az] = this._axes;
      const near = level.near;
      const drawn = level.drawn;
      const wanted = level.wanted;
      let count = 0;
      for (let kz = 0; kz < n[2]; kz++) {
        const sz = az.slot[kz];
        for (let ky = 0; ky < n[1]; ky++) {
          const base = n[0] * (ay.slot[ky] + n[1] * sz);
          const inner = ay.inner[ky] & az.inner[kz];
          for (let kx = 0; kx < n[0]; kx++) {
            const i = base + ax.slot[kx];
            const want = (inner & ax.inner[kx]) === 0 && (near[i] === 1 || drawn[i] >= drawnFrom) ? 1 : 0;
            wanted[i] = want;
            count += want;
          }
        }
      }
      level.wantedCount = count;
      total += count;
    }
    return total;
  }
  /** Every probe unclassified, so wanted, until the scene field has settled and updates classify it. @internal */
  private resetClassification() {
    for (const level of this._levels) {
      level.near.fill(1);
      level.classifyAfter.fill(UNSETTLED);
      level.drawn.fill(-UNSETTLED);
    }
    this._awaitSettle = true;
  }
  /**
   * The scene field holds the scene now: updates from this frame on classify the probes waiting
   * for it, relocating first, since their distance to the field comes from the relocation.
   * @internal
   */
  private settle() {
    this._awaitSettle = false;
    for (const level of this._levels) {
      for (let i = 0; i < level.count; i++) {
        if (level.classifyAfter[i] === UNSETTLED) {
          level.classifyAfter[i] = this._frame;
          level.lastRelocated[i] = -1000;
        }
      }
    }
  }
  /** Geometry changed in a box: the probes within reach of it wait for the field and reclassify. @internal */
  private onFieldDirty(min: Vector3, max: Vector3) {
    const reach = this.reach();
    for (const level of this._levels) {
      const o = level.origin;
      if (!o) {
        continue;
      }
      const s = level.spacing;
      const r = reach * s;
      const n = level.grid;
      const x0 = Math.max(o[0], Math.ceil((min.x - r) / s));
      const y0 = Math.max(o[1], Math.ceil((min.y - r) / s));
      const z0 = Math.max(o[2], Math.ceil((min.z - r) / s));
      const x1 = Math.min(o[0] + n[0] - 1, Math.floor((max.x + r) / s));
      const y1 = Math.min(o[1] + n[1] - 1, Math.floor((max.y + r) / s));
      const z1 = Math.min(o[2] + n[2] - 1, Math.floor((max.z + r) / s));
      if (!(x0 <= x1 && y0 <= y1 && z0 <= z1)) {
        continue;
      }
      for (let z = z0; z <= z1; z++) {
        for (let y = y0; y <= y1; y++) {
          const base = n[0] * (wrapIndex(y, n[1]) + n[1] * wrapIndex(z, n[2]));
          for (let x = x0; x <= x1; x++) {
            const i = base + wrapIndex(x, n[0]);
            level.near[i] = 1;
            level.classifyAfter[i] = UNSETTLED;
            level.lastRelocated[i] = -1000;
          }
        }
      }
      this._awaitSettle = true;
    }
  }
  /**
   * Marks the probes within reach of a lit object drawn that the probes' rays cannot see, see
   * {@link ProbeVolume.drawnCallback}: all of them for an object the scene field does not hold,
   * those whose reach leaves the field's window for one it does. A batch group taken whole is
   * marked by its bounds, as one object the field holds unless it holds a lit mesh it does not.
   * @internal
   */
  private markDrawn(node: SceneNode, drawable: Nullable<Drawable>) {
    let held: boolean;
    if (drawable) {
      if (drawable.isUnlit()) {
        return;
      }
      held = this._scene.sdf.holdsStatic(node);
    } else if (node.isBatchGroup()) {
      held = !this.groupMarks(node);
    } else {
      return;
    }
    const bv = node.getWorldBoundingVolume();
    if (!bv) {
      return;
    }
    const box = bv.toAABB();
    const min = box.minPoint;
    const max = box.maxPoint;
    const fmin = this._fieldMin;
    const fmax = this._fieldMax;
    // Wholly inside the field's window, the rays see it
    if (
      held &&
      this._hasField &&
      min.x >= fmin.x &&
      min.y >= fmin.y &&
      min.z >= fmin.z &&
      max.x <= fmax.x &&
      max.y <= fmax.y &&
      max.z <= fmax.z
    ) {
      return;
    }
    const outsideOnly = held && this._hasField;
    const frame = this._frame;
    const reach = this.reach();
    for (const level of this._levels) {
      const o = level.origin;
      if (!o) {
        continue;
      }
      const s = level.spacing;
      const r = reach * s;
      const n = level.grid;
      // Infinite bounds clamp to the window
      const x0 = Math.max(o[0], Math.ceil((min.x - r) / s));
      const y0 = Math.max(o[1], Math.ceil((min.y - r) / s));
      const z0 = Math.max(o[2], Math.ceil((min.z - r) / s));
      const x1 = Math.min(o[0] + n[0] - 1, Math.floor((max.x + r) / s));
      const y1 = Math.min(o[1] + n[1] - 1, Math.floor((max.y + r) / s));
      const z1 = Math.min(o[2] + n[2] - 1, Math.floor((max.z + r) / s));
      if (!(x0 <= x1 && y0 <= y1 && z0 <= z1)) {
        continue;
      }
      const drawn = level.drawn;
      for (let z = z0; z <= z1; z++) {
        const sz = wrapIndex(z, n[2]);
        const inZ = z * s - r >= fmin.z && z * s + r <= fmax.z;
        for (let y = y0; y <= y1; y++) {
          const base = n[0] * (wrapIndex(y, n[1]) + n[1] * sz);
          const inZY = inZ && y * s - r >= fmin.y && y * s + r <= fmax.y;
          for (let x = x0; x <= x1; x++) {
            if (!outsideOnly || !inZY || x * s - r < fmin.x || x * s + r > fmax.x) {
              drawn[base + wrapIndex(x, n[0])] = frame;
            }
          }
        }
      }
    }
  }
  /** Whether a batch group holds a lit mesh the scene field does not, kept until either changes. @internal */
  private groupMarks(group: BatchGroup) {
    const sdf = this._scene.sdf;
    const version = sdf.layoutVersion;
    let entry = this._groupMarks.get(group);
    if (!entry || entry.tag !== group.changeTag || entry.version !== version) {
      let marks = false;
      group.iterate((node) => {
        marks = node.isMesh() && !node.isUnlit() && !sdf.holdsStatic(node);
        return marks;
      });
      entry = { tag: group.changeTag, version, marks };
      this._groupMarks.set(group, entry);
    }
    return entry.marks;
  }
  /** Reads the probes' nearest geometry back every {@link CLASSIFY_EVERY} frames, one read at a time. @internal */
  private readHits() {
    const buffer = this._hits;
    if (!buffer || this._hitsPending || this._hitsFailed || this._frame - this._hitsFrame < CLASSIFY_EVERY) {
      return;
    }
    const requested = this._frame;
    this._hitsPending = true;
    this._hitsFrame = requested;
    buffer
      .getBufferSubData(new Uint8Array(this._hitsRead.buffer), 0, this._hitsRead.byteLength)
      .then(() => {
        if (buffer === this._hits) {
          this.classify(requested);
        }
      })
      .catch((err) => {
        // Without readback the probes stay unclassified, all of them updated as before
        this._hitsFailed = true;
        console.warn('ProbeVolume: probe classification readback failed', err);
      })
      .finally(() => {
        if (buffer === this._hits) {
          this._hitsPending = false;
        }
      });
  }
  /**
   * Classifies the probes from a readback requested in frame `requested`: geometry within reach
   * by either the nearest hit of the rays or the distance to the static field. Only probes both
   * updated and relocated since they started waiting (entering the window, or the field changing
   * around them) and by that frame, so that both values are of this place and this field.
   * @internal
   */
  private classify(requested: number) {
    const hits = this._hitsRead;
    const reach = this.reach();
    for (const level of this._levels) {
      for (let i = 0; i < level.count; i++) {
        const after = level.classifyAfter[i];
        const updated = level.lastSelected[i];
        const relocated = level.lastRelocated[i];
        if (updated >= after && updated <= requested && relocated >= after && relocated <= requested) {
          const k = (level.tileBase + i) * 2;
          level.near[i] = Math.min(hits[k], hits[k + 1]) < reach ? 1 : 0;
        }
      }
    }
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
   * Pushes selected probes out of nearby geometry along the SDF gradient,
   * never through a surface; on first update and every few frames after.
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
          this.hits = pb.vec2[0]().storageBuffer(0);
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
            // Central differences at least a finest field voxel apart, so sub-voxel walls give a gradient
            this.$l.h = pb.max(pb.mul(this.spacing, 0.05), this[GLOBAL_SDF_LEVELS].at(0).w);
            // Crossing check every quarter voxel: thin walls dip only slightly below their face distance
            this.$l.probeStep = pb.mul(this[GLOBAL_SDF_LEVELS].at(0).w, 0.25);
            // Always from the grid point, so the result depends on the field alone and never drifts
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
              // A distance dip along the move means it passes through geometry: stop here
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
            // Classification (Majercik et al. 2021, §5): a probe inside geometry is
            // inactive; one out again starts over. Static field only, so dynamic instances turn none off
            this.$l.probeState = this.data.w;
            this.$l.fieldDist = sampleGlobalSDF(this, this.pos, levels);
            this.$if(pb.lessThan(this.fieldDist, 0), function () {
              this.probeState = pb.float(PROBE_STATE_INACTIVE);
            }).$elseif(pb.greaterThan(this.probeState, PROBE_STATE_INACTIVE - 0.5), function () {
              this.probeState = pb.float(0);
            });
            this[PROBE_DATA].setAt(this.index, pb.vec4(this.offset, this.probeState));
            // Distance to the static field in spacings for ProbeVolume.classify. A read saturated
            // at the band of the coarsest level only bounds it from below, so says nothing
            this.$l.fieldBound = pb.mul(
              this[GLOBAL_SDF_PARAMS].z,
              this[GLOBAL_SDF_LEVELS].at(levels - 1).w,
              0.99
            );
            this.$l.prevHits = this.hits.at(this.index);
            this.hits.setAt(
              this.index,
              pb.vec2(
                this.prevHits.x,
                this.$choice(
                  pb.and(
                    pb.greaterThanEqual(this.fieldDist, 0),
                    pb.lessThan(this.fieldDist, this.fieldBound)
                  ),
                  pb.div(this.fieldDist, this.spacing),
                  pb.float(PROBE_FAR)
                )
              )
            );
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
    bg.setBuffer('hits', this._hits!);
    device.setProgram(this._relocateProgram);
    device.setBindGroup(0, bg);
    device.compute(Math.ceil(selected / 64), 1, 1);
  }
  /**
   * Seeds the irradiance of probes starting over by trilinearly blending the
   * eight surrounding active probes of the level above; the first update then
   * blends into the seed with hysteresis. Without a seed, alpha is -1. One
   * workgroup per selected probe, written by selection slot.
   * @internal
   */
  private runSeed(selected: number) {
    const device = getDevice();
    if (!this._seedProgram) {
      this._seedProgram = buildSDFProgram({
        label: 'ProbeSeed',
        workgroupSize: [IRRADIANCE_TEXELS, IRRADIANCE_TEXELS, 1],
        compute(pb) {
          this[PROBE_DATA] = pb.vec4[0]().storageBufferReadonly(0);
          this[PROBE_PARAMS] = pb.vec4[PROBE_PARAM_VEC4S]().uniform(0);
          this.selected = pb.uint[0]().storageBufferReadonly(0);
          this.irradiance = pb.tex2D().sampleType('unfilterable-float').uniform(0);
          this.seedOut = pb.texStorage2D.rgba16float().storage(0);
          pb.main(function () {
            this.$l.slot = this.$builtins.workGroupId.x;
            this.$l.sel = this.selected.at(this.slot);
            this.$l.index = pb.int(pb.compAnd(this.sel, pb.uint(SELECT_INDEX_MASK)));
            this.$l.level = pb.int(pb.compAnd(pb.sar(this.sel, SELECT_LEVEL_SHIFT), pb.uint(0x7f)));
            this.$l.uv = pb.ivec2(this.$builtins.localInvocationId.xy);
            this.$l.data = this[PROBE_DATA].at(this.index);
            // Starting over as the blend tells it
            this.$l.first = pb.or(
              pb.greaterThan(pb.compAnd(this.sel, pb.uint(SELECT_FIRST_BIT)), pb.uint(0)),
              pb.lessThan(this.data.w, 0.5)
            );
            this.$l.parent = pb.add(this.level, 1);
            this.$l.sum = pb.vec4(0);
            this.$l.wsum = pb.float(0);
            this.$if(
              pb.and(this.first, pb.lessThan(this.parent, pb.int(this[PROBE_PARAMS].at(0).x))),
              function () {
                this.$l.texel = probeTexelFromIndex(this, this.level, this.index);
                this.$l.pos = probePosition(
                  this,
                  this.level,
                  probeWorldFromTexel(this, this.level, this.texel),
                  this.data
                );
                this.$l.lo = probeLevelOrigin(this, this.parent);
                this.$l.n3 = pb.vec3(probeLevelGrid(this, this.parent).xyz);
                // In probes of the level above, its grid points at integers
                this.$l.g = pb.sub(pb.div(this.pos, this.lo.w), this.lo.xyz);
                this.$if(
                  pb.and(
                    pb.all(pb.greaterThanEqual(this.g, pb.vec3(0))),
                    pb.all(pb.lessThanEqual(this.g, pb.sub(this.n3, pb.vec3(1))))
                  ),
                  function () {
                    this.$l.base = pb.clamp(pb.floor(this.g), pb.vec3(0), pb.sub(this.n3, pb.vec3(2)));
                    this.$l.alpha = pb.clamp(pb.sub(this.g, this.base), pb.vec3(0), pb.vec3(1));
                    for (let i = 0; i < 8; i++) {
                      const off = [i & 1, (i >> 1) & 1, (i >> 2) & 1];
                      this.$l[`pw${i}`] = pb.add(
                        pb.ivec3(this.lo.xyz),
                        pb.ivec3(this.base),
                        pb.ivec3(off[0], off[1], off[2])
                      );
                      this.$l[`pi${i}`] = probeTileIndex(
                        this,
                        this.parent,
                        probeTexelFromWorld(this, this.parent, this[`pw${i}`])
                      );
                      this.$if(probeActive(this, this[PROBE_DATA].at(this[`pi${i}`])), function () {
                        this.$l.tri = pb.mul(
                          off[0] ? this.alpha.x : pb.sub(1, this.alpha.x),
                          off[1] ? this.alpha.y : pb.sub(1, this.alpha.y),
                          off[2] ? this.alpha.z : pb.sub(1, this.alpha.z)
                        );
                        this.sum = pb.add(
                          this.sum,
                          pb.mul(
                            pb.textureLoad(
                              this.irradiance,
                              pb.add(
                                probeTileOrigin(this, this[`pi${i}`], pb.float(IRRADIANCE_TEXELS)),
                                this.uv
                              ),
                              0
                            ),
                            this.tri
                          )
                        );
                        this.wsum = pb.add(this.wsum, this.tri);
                      });
                    }
                  }
                );
              }
            );
            pb.textureStore(
              this.seedOut,
              pb.uvec2(pb.add(stagingOrigin(this, this.slot, IRRADIANCE_TEXELS), this.uv)),
              this.$choice(
                pb.greaterThan(this.wsum, 1e-4),
                pb.div(this.sum, pb.max(this.wsum, 1e-4)),
                pb.vec4(0, 0, 0, -1)
              )
            );
          });
        }
      })!;
      this._seedBindGroup = device.createBindGroup(this._seedProgram.bindGroupLayouts[0]);
    }
    const bg = this._seedBindGroup!;
    bg.setBuffer(PROBE_DATA, this._data!);
    bg.setValue(PROBE_PARAMS, this._params);
    bg.setBuffer('selected', this._selected!);
    bg.setTexture('irradiance', this._irradiance!, fetchSampler('clamp_nearest_nomip'));
    bg.setTexture('seedOut', this._irradianceSeed!);
    device.setProgram(this._seedProgram);
    device.setBindGroup(0, bg);
    device.compute(selected, 1, 1);
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
    // Voxel radiance and sky bake share the cache exposure; the sky takes the strength alone
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
            // Past the visibility range, start at the field level matching the probe level;
            // within it read every level, since coarse
            // levels close thin gaps and would shut probes in
            this.$l.fieldScale = pb.div(this[GLOBAL_SDF_LEVELS].at(0).w, probeLevelOrigin(this, 0).w);
            this.$l.farLevel = pb.int(0);
            for (let i = 1; i < levels; i++) {
              this.$if(
                pb.lessThanEqual(
                  this[GLOBAL_SDF_LEVELS].at(i).w,
                  pb.mul(this.spacing, this.fieldScale, 1.01)
                ),
                function () {
                  this.farLevel = pb.int(i);
                }
              );
            }
            this.$l.fineRange = pb.mul(this.spacing, VISIBILITY_RANGE);
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
              // Distance read at the hit
              this.$l.hitD = pb.float(0);
              // Voxel size of the level that answered at the hit, 0 for a dynamic instance
              this.$l.hitVoxel = pb.float(0);
              // Finest field level the step that hit could read
              this.$l.hitMin = pb.int(0);
              this.$for(pb.int('i'), 0, TRACE_STEPS, function () {
                this.$l.sp = pb.add(this.pos, pb.mul(this.dir, this.t));
                this.$l.stepMin = this.$choice(pb.lessThan(this.t, this.fineRange), pb.int(0), this.farLevel);
                this.$l.s = sampleSceneSDFHinted(this, this.sp, this.prevD, levels, this.stepMin);
                this.$l.d = this.s.x;
                this.prevD = this.d;
                this.$l.expand = sdfSurfaceExpand(this, this.sp, this.s, this.t, levels);
                this.$if(pb.lessThan(this.d, this.expand), function () {
                  // Swollen surface decides the hit so sub-voxel walls stop the ray
                  this.hitD = this.d;
                  this.hit = true;
                  this.hitVoxel = this.s.y;
                  this.hitMin = this.stepMin;
                  this.$break();
                });
                this.t = pb.add(this.t, pb.max(this.d, 0.02));
                this.$if(pb.greaterThan(this.t, this.maxDist), function () {
                  this.$break();
                });
              });
              this.$if(this.hit, function () {
                // Keep the distance to the unswollen surface, else concave corners read as hidden
                this.dist = sdfRefineHit(
                  this,
                  this.pos,
                  this.dir,
                  this.t,
                  this.hitD,
                  this.hitVoxel,
                  this.hitMin,
                  levels
                );
                this.$l.hp = pb.add(this.pos, pb.mul(this.dir, this.t));
                // Hit normal from the SDF gradient
                this.$l.hg = pb.vec3(0);
                this.$if(pb.greaterThan(this.hitVoxel, 0), function () {
                  // Central differences over half a voxel of the answering level
                  // (ComputeGlobalDistanceFieldNormal); level blends take the nearer level
                  this.$l.hl = this.hitMin;
                  for (let i = 1; i < levels; i++) {
                    this.$if(
                      pb.and(
                        pb.greaterThanEqual(pb.int(i), this.hitMin),
                        pb.greaterThan(this.hitVoxel, pb.mul(this[GLOBAL_SDF_LEVELS].at(i - 1).w, Math.SQRT2))
                      ),
                      function () {
                        this.hl = pb.int(i);
                      }
                    );
                  }
                  this.$l.he = pb.mul(this[GLOBAL_SDF_LEVELS].at(this.hl).w, 0.5);
                  this.hg = pb.vec3(
                    pb.sub(
                      sampleGlobalSDFLevel(this, pb.add(this.hp, pb.vec3(this.he, 0, 0)), this.hl, levels),
                      sampleGlobalSDFLevel(this, pb.sub(this.hp, pb.vec3(this.he, 0, 0)), this.hl, levels)
                    ),
                    pb.sub(
                      sampleGlobalSDFLevel(this, pb.add(this.hp, pb.vec3(0, this.he, 0)), this.hl, levels),
                      sampleGlobalSDFLevel(this, pb.sub(this.hp, pb.vec3(0, this.he, 0)), this.hl, levels)
                    ),
                    pb.sub(
                      sampleGlobalSDFLevel(this, pb.add(this.hp, pb.vec3(0, 0, this.he)), this.hl, levels),
                      sampleGlobalSDFLevel(this, pb.sub(this.hp, pb.vec3(0, 0, this.he)), this.hl, levels)
                    )
                  );
                }).$else(function () {
                  // Dynamic instance: forward differences of the merged field over the finest voxel
                  this.$l.he = this[GLOBAL_SDF_LEVELS].at(0).w;
                  this.$l.hd = sampleSceneSDF(this, this.hp, levels);
                  this.hg = pb.vec3(
                    pb.sub(sampleSceneSDF(this, pb.add(this.hp, pb.vec3(this.he, 0, 0)), levels), this.hd),
                    pb.sub(sampleSceneSDF(this, pb.add(this.hp, pb.vec3(0, this.he, 0)), levels), this.hd),
                    pb.sub(sampleSceneSDF(this, pb.add(this.hp, pb.vec3(0, 0, this.he)), levels), this.hd)
                  );
                });
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
   * Integrates the traced rays into the selected probes' maps, one thread per
   * texel; border texels use the direction of the interior texel they mirror.
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
    // Irradiance last: it marks probes updated, and both passes read the prior state
    const passes: [string, GPUProgram, BindGroup, Texture2D, Texture2D, Nullable<Texture2D>][] = [
      [
        'ProbeBlendVisibility',
        this._blendVisProgram!,
        this._blendVisBindGroup!,
        this._visibility!,
        this._visibilityNext!,
        null
      ],
      [
        'ProbeBlendIrradiance',
        this._blendIrrProgram,
        this._blendIrrBindGroup!,
        this._irradiance!,
        this._irradianceNext!,
        this._irradianceSeed!
      ]
    ];
    for (const [scope, program, bg, current, next, seed] of passes) {
      if (seed) {
        bg.setTexture('seedTex', seed, fetchSampler('clamp_nearest_nomip'));
        bg.setBuffer('hits', this._hits!);
      }
      bg.setBuffer(PROBE_DATA, this._data!);
      bg.setValue(PROBE_PARAMS, this._params);
      bg.setBuffer('selected', this._selected!);
      bg.setValue('rotation', this._rotation);
      bg.setValue('rayInfo', new Vector4(this._rays, this._budget, this._frame, this._options.hysteresis));
      bg.setTexture('rays', this._rayTexture!, fetchSampler('clamp_nearest_nomip'));
      bg.setTexture('current', current, fetchSampler('clamp_nearest_nomip'));
      bg.setTexture('next', next);
      RenderGraphExecutor.profileScope(scope, () => {
        device.setProgram(program);
        device.setBindGroup(0, bg);
        device.compute(selected, 1, 1);
      });
    }
  }
  /**
   * Copies the staged tiles of {@link ProbeVolume.runBlend} into the maps, one
   * workgroup per updated probe, leaving other tiles untouched.
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
        if (!visibility) {
          // Seeds of the probes starting over, by selection slot (runSeed)
          this.seedTex = pb.tex2D().sampleType('unfilterable-float').uniform(0);
          // (nearest ray hit, distance to the field) per probe, see ProbeVolume.classify
          this.hits = pb.vec2[0]().storageBuffer(0);
        }
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
          // First update: new to its window, or state 0 (e.g. reactivated by relocation)
          this.$l.probeState = this[PROBE_DATA].at(this.index).w;
          this.$l.first = pb.or(
            pb.greaterThan(pb.compAnd(this.sel, pb.uint(SELECT_FIRST_BIT)), pb.uint(0)),
            pb.lessThan(this.probeState, 0.5)
          );
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
          this.$l.maxDist = pb.mul(probeLevelOrigin(this, this.level).w, VISIBILITY_RANGE);
          // One ray, `ray` its traced result and `c` the cosine to the texel's direction
          const accumulate = (scope: PBInsideFunctionScope) => {
            if (visibility) {
              // Sharpened (cos^50); below cos 0.8 the weight is under 2e-5, so skip
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
              // Cosine-weighted sky escape share in alpha: sky visibility, as DDGI [Majercik19]
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
          if (!visibility) {
            // Every thread reads every ray, so each finds the same nearest hit
            this.$l.nearestHit = pb.float(PROBE_FAR);
          }
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
              if (!visibility) {
                this.nearestHit = pb.min(this.nearestHit, pb.abs(this.ray.a));
              }
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
          if (!visibility) {
            // A probe starting over blends into its seed, if any (alpha -1 = none)
            this.$if(this.first, function () {
              this.$l.seedValue = pb.textureLoad(
                this.seedTex,
                pb.add(stagingOrigin(this, this.slot, s), this.uv),
                0
              );
              this.$if(pb.greaterThanEqual(this.seedValue.a, 0), function () {
                this.old = this.seedValue;
                this.h = this.rayInfo.w;
              });
            });
          }
          this.$l.value = pb.mix(this.result, this.old, this.h);
          // Staged by selection slot; runCommit copies the tile into the map
          pb.textureStore(
            this.next,
            pb.uvec2(pb.add(stagingOrigin(this, this.slot, s), this.uv)),
            visibility ? pb.vec4(this.value.xyz, 1) : this.value
          );
          if (!visibility) {
            // Mark the probe updated; an inactive one stays inactive
            this.$if(pb.equal(this.$builtins.localInvocationId.xy, pb.uvec2(0)), function () {
              this.$l.data = this[PROBE_DATA].at(this.index);
              this.$l.inactive = pb.greaterThan(this.data.w, PROBE_STATE_INACTIVE - 0.5);
              this[PROBE_DATA].setAt(
                this.index,
                pb.vec4(
                  this.data.xyz,
                  this.$choice(this.inactive, pb.float(PROBE_STATE_INACTIVE), pb.float(1))
                )
              );
              // An inactive probe starts inside geometry: no surface reads it, whatever its rays hit
              this.$l.prevHits = this.hits.at(this.index);
              this.hits.setAt(
                this.index,
                pb.vec2(
                  this.$choice(
                    this.inactive,
                    pb.float(PROBE_FAR),
                    pb.div(this.nearestHit, probeLevelOrigin(this, this.level).w)
                  ),
                  this.prevHits.y
                )
              );
            });
          }
        });
      }
    });
  }
}

/** Slot of a world probe index in a toroidal window of `m` probes along an axis. */
function wrapIndex(v: number, m: number) {
  return ((v % m) + m) % m;
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
