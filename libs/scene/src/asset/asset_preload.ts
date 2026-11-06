import type { Nullable, VFS } from '@zephyr3d/base';
import { DRef } from '@zephyr3d/base';
import type { IDisposable } from '@zephyr3d/base';
import type { AssetManager } from './assetmanager';

/**
 * Kind of an asset request, named after the fetch method of {@link AssetManager} it replays
 * @public
 */
export type AssetRequestType =
  | 'texture'
  | 'model'
  | 'material'
  | 'primitive'
  | 'blueprint'
  | 'font'
  | 'binary'
  | 'text'
  | 'json';

/**
 * One fetch of {@link AssetManager}, recorded so it can be made again ahead of time
 * @public
 */
export interface AssetRequest {
  /** Fetch method */
  type: AssetRequestType;
  /** URL or VFS path as it was fetched */
  url: string;
  /** Options of the fetch that can be stored (no VFS, callbacks or decoder modules) */
  options?: Record<string, unknown>;
  /** Size of the file, when known; progress is weighted by it */
  bytes?: number;
}

/**
 * Asset requests of a scene, stored to preload its assets before it is loaded
 * @public
 */
export interface AssetPreloadData {
  /** Always `'zephyr3d-preload'` */
  format: 'zephyr3d-preload';
  /** Format version */
  version: number;
  /** Requests in named groups; preloading takes them all */
  groups: Record<string, AssetRequest[]>;
}

/**
 * Progress of preloading assets
 * @public
 */
export interface AssetPreloadProgress {
  /** Requests in the task */
  total: number;
  /** Requests loaded */
  completed: number;
  /** Requests that failed to load */
  failed: number;
  /** Fraction done in [0, 1], weighted by file size when every request knows its size */
  fraction: number;
}

/**
 * State of an {@link AssetPreloadTask}
 * @public
 */
export type AssetPreloadTaskState = 'idle' | 'loading' | 'done' | 'cancelled';

const PRELOAD_VERSION = 1;

/** Requests that load the same cached asset */
function getRequestKey(request: AssetRequest) {
  return request.type === 'texture'
    ? `texture:${request.url}:${!request.options?.linearColorSpace}`
    : request.type === 'model' && request.options?.generateLods
      ? `model:${request.url}#lod:${JSON.stringify(request.options.generateLods)}`
      : `${request.type}:${request.url}`;
}

/**
 * Options of a fetch that can be stored, or null if the fetch cannot be made again
 * from a recording
 * @internal
 */
export function getRecordableOptions(options: Nullable<Record<string, unknown>> | undefined) {
  if (!options) {
    return {};
  }
  const out: Record<string, unknown> = {};
  for (const key in options) {
    const value = options[key];
    if (value === undefined) {
      continue;
    }
    if (
      key === 'overrideVFS' ||
      key === 'texture' ||
      key === 'dracoDecoderModule' ||
      typeof value === 'function'
    ) {
      // Loads from elsewhere, into something else, or through code: not replayable
      return null;
    }
    if (value !== null && typeof value === 'object') {
      try {
        out[key] = JSON.parse(JSON.stringify(value));
      } catch {
        return null;
      }
    } else {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Assets loaded ahead of time from recorded requests.
 *
 * @remarks
 * Running fetches every request through the {@link AssetManager}, so the assets land
 * in its cache and later fetches of them, such as those of a scene being loaded, find
 * them there. The task holds what it loaded until {@link AssetPreloadTask.release} is
 * called: call it once what needed them (the scene) is loaded. Assets nothing else
 * took are then released, so a recording listing assets no longer used costs only
 * the loading.
 * @public
 */
export class AssetPreloadTask {
  private readonly _sources: (string | AssetPreloadData | AssetRequest[])[];
  private readonly _vfs: VFS;
  private readonly _assetManager: AssetManager;
  private _state: AssetPreloadTaskState;
  private _running: Nullable<Promise<AssetPreloadProgress>>;
  private _cancelled: boolean;
  private readonly _held: DRef<IDisposable>[];
  private readonly _missing: string[];
  private _progress: AssetPreloadProgress;
  /** @internal */
  constructor(vfs: VFS, assetManager: AssetManager, sources: (string | AssetPreloadData | AssetRequest[])[]) {
    this._vfs = vfs;
    this._assetManager = assetManager;
    this._sources = [...sources];
    this._state = 'idle';
    this._running = null;
    this._cancelled = false;
    this._held = [];
    this._missing = [];
    this._progress = { total: 0, completed: 0, failed: 0, fraction: 0 };
  }
  /** What the task is doing */
  get state() {
    return this._state;
  }
  /** Progress so far; `total` is 0 until the recordings are read */
  get progress(): Readonly<AssetPreloadProgress> {
    return this._progress;
  }
  /** Recording files that could not be read */
  get missing(): readonly string[] {
    return this._missing;
  }
  /**
   * Reads the recordings and loads their assets.
   *
   * @remarks
   * Calling it again returns the same promise; the options of later calls are ignored.
   *
   * @param options - Progress callback, and how many assets load at once (default 6)
   * @returns Resolves with the final progress when every request is accounted for or the task is cancelled
   */
  run(options?: {
    onProgress?: (progress: Readonly<AssetPreloadProgress>) => void;
    concurrency?: number;
  }): Promise<AssetPreloadProgress> {
    if (!this._running) {
      this._running = this.execute(options?.onProgress, Math.max(1, options?.concurrency ?? 6));
    }
    return this._running;
  }
  /** Loads nothing more; assets already loading still finish */
  cancel() {
    this._cancelled = true;
    if (this._state === 'idle') {
      this._state = 'cancelled';
    }
  }
  /** Lets go of the assets the task loaded; those nothing else took are released */
  release() {
    for (const ref of this._held.splice(0)) {
      ref.dispose();
    }
  }
  private async execute(
    onProgress: ((progress: Readonly<AssetPreloadProgress>) => void) | undefined,
    concurrency: number
  ): Promise<AssetPreloadProgress> {
    if (this._state === 'cancelled') {
      return this._progress;
    }
    this._state = 'loading';
    const requests = this.dedupe(
      (await Promise.all(this._sources.map((source) => this.load(source)))).flat()
    );
    const sized = requests.length > 0 && requests.every((request) => (request.bytes ?? 0) > 0);
    const weights = requests.map((request) => (sized ? request.bytes! : 1));
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    let doneWeight = 0;
    this._progress = { total: requests.length, completed: 0, failed: 0, fraction: requests.length ? 0 : 1 };
    const report = () => {
      try {
        onProgress?.({ ...this._progress });
      } catch (err) {
        console.error(err);
      }
    };
    report();
    let next = 0;
    const worker = async () => {
      while (next < requests.length && !this._cancelled) {
        const index = next++;
        try {
          const asset = await this.fetch(requests[index]);
          if (asset && typeof (asset as IDisposable).dispose === 'function') {
            this._held.push(new DRef(asset as IDisposable));
          }
          this._progress.completed++;
        } catch {
          // A request of a stale recording: the asset loads, or fails, when it is needed
          this._progress.failed++;
        }
        doneWeight += weights[index];
        this._progress.fraction = totalWeight > 0 ? doneWeight / totalWeight : 1;
        report();
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, requests.length) }, worker));
    this._state = this._cancelled ? 'cancelled' : 'done';
    return { ...this._progress };
  }
  private dedupe(requests: AssetRequest[]) {
    const seen = new Set<string>();
    return requests.filter((request) => {
      const key = getRequestKey(request);
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }
  private async fetch(request: AssetRequest): Promise<unknown> {
    const manager = this._assetManager;
    const options = request.options as any;
    switch (request.type) {
      case 'texture':
        return manager.fetchTexture(request.url, options);
      case 'model':
        return manager.fetchModelData(request.url, options);
      case 'material':
        return manager.fetchMaterial(request.url, options);
      case 'primitive':
        return manager.fetchPrimitive(request.url, options);
      case 'blueprint':
        return manager.fetchBluePrint(request.url, options);
      case 'font':
        return manager.fetchFontAsset(request.url, options);
      case 'binary':
        return manager.fetchBinaryData(request.url, null, null, options);
      case 'text':
        return manager.fetchTextData(request.url, undefined, undefined, options);
      case 'json':
        return manager.fetchJsonData(request.url, undefined, null, options);
      default:
        throw new Error(`Unknown asset request type ${request.type}`);
    }
  }
  private async load(source: string | AssetPreloadData | AssetRequest[]): Promise<AssetRequest[]> {
    if (Array.isArray(source)) {
      return source;
    }
    if (typeof source !== 'string') {
      return Object.values(source.groups ?? {}).flat();
    }
    try {
      if (await this._vfs.exists(source)) {
        const text = (await this._vfs.readFile(source, { encoding: 'utf8' })) as string;
        if (text.trimStart().startsWith('{')) {
          const data = JSON.parse(text) as AssetPreloadData;
          if (data?.format === 'zephyr3d-preload' && data.version === PRELOAD_VERSION) {
            return Object.values(data.groups ?? {}).flat();
          }
        }
      }
    } catch (err) {
      console.warn(`Asset preload list ${source} unreadable: ${err}`);
    }
    this._missing.push(source);
    return [];
  }
}

/**
 * Loads assets ahead of time from requests recorded while scenes were loaded.
 *
 * @remarks
 * Loading the assets of a scene before the scene itself gives a loading screen a
 * progress with a known total, and later fetches of the scene find the assets in the
 * cache. The engine never calls it by itself.
 *
 * @example
 * ```ts
 * const task = getEngine().assetPreloader.createTask(['/assets/main.zscn.zpreload']);
 * await task.run({ onProgress: (p) => showProgress(p.fraction) });
 * const scene = await getEngine().loadSceneFromFile('/assets/main.zscn');
 * task.release();
 * ```
 * @public
 */
export class AssetPreloader {
  private readonly _getVFS: () => VFS;
  private readonly _getAssetManager: () => AssetManager;
  /** @internal */
  constructor(getVFS: () => VFS, getAssetManager: () => AssetManager) {
    this._getVFS = getVFS;
    this._getAssetManager = getAssetManager;
  }
  /**
   * Makes a task preloading assets. It does nothing until it is run.
   * @param sources - VFS paths of preload files, preload data, or request lists
   */
  createTask(sources: (string | AssetPreloadData | AssetRequest[])[]) {
    return new AssetPreloadTask(this._getVFS(), this._getAssetManager(), sources);
  }
}
