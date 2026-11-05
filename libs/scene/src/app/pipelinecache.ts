import type { Nullable, VFS } from '@zephyr3d/base';
import type {
  PipelineCacheData,
  PipelineCacheStats,
  PipelinePrecompileJob,
  PipelinePrecompilePriority,
  PipelinePrecompileProgress,
  PipelinePrecompileResult
} from '@zephyr3d/device';
import { getDevice } from './api';

/** Default VFS path of the pipeline cache manifest */
export const PIPELINE_CACHE_MANIFEST_FILE = 'pipeline-cache.json';

/**
 * One recording file listed by a pipeline cache manifest
 * @public
 */
export interface PipelineCacheManifestEntry {
  /** Tag the pipelines were recorded under: a scene path, or `null` for pipelines no scene claimed */
  tag: Nullable<string>;
  /** VFS path of the recording file; {@link PipelineCacheManager.loadManifest} makes it absolute */
  file: string;
  /** Render pipelines in the file */
  render: number;
  /** Compute pipelines in the file */
  compute: number;
}

/**
 * Lists the recording files of a pipeline cache and the scenes they belong to
 * @public
 */
export interface PipelineCacheManifest {
  /** Always `'zephyr3d-pso-manifest'` */
  format: 'zephyr3d-pso-manifest';
  /** Format version */
  version: number;
  /** Recording files */
  entries: PipelineCacheManifestEntry[];
}

/**
 * State of a {@link PipelineCompileTask}
 * @public
 */
export type PipelineCompileTaskState = 'idle' | 'loading' | 'compiling' | 'done' | 'cancelled';

/**
 * Outcome of a {@link PipelineCompileTask}
 * @public
 */
export interface PipelineCompileResult extends PipelinePrecompileResult {
  /** Recording files that could not be read, or were not pipeline cache files */
  missing: string[];
}

/**
 * Options of running a {@link PipelineCompileTask}
 * @public
 */
export interface PipelineCompileRunOptions {
  /** How eagerly to compile, defaults to the priority of the task (`foreground` unless set) */
  priority?: PipelinePrecompilePriority;
  /** Called whenever a pipeline of the task is accounted for */
  onProgress?: (progress: Readonly<PipelinePrecompileProgress>) => void;
}

/**
 * Source of the pipelines of a {@link PipelineCompileTask}: the VFS path of a recording
 * file, an entry of a manifest, or a recording already read.
 *
 * @remarks
 * A recording file holds one {@link @zephyr3d/device#PipelineCacheData}, or an array of
 * them, one per backend that recorded the pipelines; only those of the device are compiled.
 * @public
 */
export type PipelineCompileSource = string | PipelineCacheManifestEntry | PipelineCacheData;

const MANIFEST_VERSION = 1;

/**
 * Recorded pipelines to compile ahead of time.
 *
 * @remarks
 * Made by {@link PipelineCacheManager.createTask}; nothing happens until {@link PipelineCompileTask.run}.
 * Files that cannot be read are listed in {@link PipelineCompileTask.missing}; their pipelines
 * are compiled on demand when draws need them.
 * @public
 */
export class PipelineCompileTask {
  private readonly _name: string;
  private readonly _sources: PipelineCompileSource[];
  private readonly _vfs: VFS;
  private _state: PipelineCompileTaskState;
  private _priority: PipelinePrecompilePriority;
  private _job: Nullable<PipelinePrecompileJob>;
  private _running: Nullable<Promise<PipelineCompileResult>>;
  private _cancelRequested: boolean;
  private readonly _missing: string[];
  private _progress: PipelinePrecompileProgress;
  /** @internal */
  constructor(vfs: VFS, sources: PipelineCompileSource[], name: string) {
    this._vfs = vfs;
    this._sources = [...sources];
    this._name = name;
    this._state = 'idle';
    this._priority = 'foreground';
    this._job = null;
    this._running = null;
    this._cancelRequested = false;
    this._missing = [];
    this._progress = { total: 0, completed: 0, failed: 0, skipped: 0 };
  }
  /** Name of the task, for messages */
  get name() {
    return this._name;
  }
  /** What the task is doing */
  get state() {
    return this._state;
  }
  /** Progress so far; `total` is 0 until the recording files are read */
  get progress(): Readonly<PipelinePrecompileProgress> {
    return this._job ? this._job.progress : this._progress;
  }
  /** Recording files that could not be read */
  get missing(): readonly string[] {
    return this._missing;
  }
  /** How eagerly the task compiles; can be changed while it runs */
  get priority() {
    return this._priority;
  }
  set priority(priority: PipelinePrecompilePriority) {
    this._priority = priority;
    if (this._job) {
      this._job.priority = priority;
    }
  }
  /**
   * Reads the recording files and compiles their pipelines.
   *
   * @remarks
   * Calling it again returns the same promise; the options of later calls are ignored.
   *
   * @param options - Priority and progress callback
   * @returns Resolves when every pipeline is accounted for or the task is cancelled
   */
  run(options?: PipelineCompileRunOptions): Promise<PipelineCompileResult> {
    if (!this._running) {
      if (options?.priority) {
        this._priority = options.priority;
      }
      this._running = this.execute(options?.onProgress);
    }
    return this._running;
  }
  /** Compiles nothing more; pipelines already compiling are still kept */
  cancel() {
    this._cancelRequested = true;
    this._job?.cancel();
    if (this._state === 'idle') {
      this._state = 'cancelled';
    }
  }
  private async execute(onProgress: PipelineCompileRunOptions['onProgress']): Promise<PipelineCompileResult> {
    const start = performance.now();
    if (this._state === 'cancelled') {
      return this.finish({ ...this._progress, cancelled: true, elapsedMs: 0 });
    }
    this._state = 'loading';
    const backend = getDevice().type;
    const dataList = (await Promise.all(this._sources.map((source) => this.load(source))))
      .flat()
      .filter((data) => data.backend === backend);
    if (this._cancelRequested) {
      this._state = 'cancelled';
      return this.finish({ ...this._progress, cancelled: true, elapsedMs: performance.now() - start });
    }
    this._state = 'compiling';
    this._job = getDevice().precompilePipelines(dataList, { priority: this._priority, onProgress });
    const result = await this._job.result;
    this._state = result.cancelled ? 'cancelled' : 'done';
    return this.finish({ ...result, elapsedMs: performance.now() - start });
  }
  private finish(result: PipelinePrecompileResult): PipelineCompileResult {
    if (!this._job) {
      this._progress = {
        total: result.total,
        completed: result.completed,
        failed: result.failed,
        skipped: result.skipped
      };
    }
    return { ...result, missing: [...this._missing] };
  }
  private async load(source: PipelineCompileSource): Promise<PipelineCacheData[]> {
    if (typeof source !== 'string' && 'format' in source) {
      return [source];
    }
    const path = typeof source === 'string' ? source : source.file;
    try {
      if (await this._vfs.exists(path)) {
        const text = (await this._vfs.readFile(path, { encoding: 'utf8' })) as string;
        // Hosts that answer missing files with an HTML page are not pipeline caches
        const trimmed = text.trimStart();
        if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
          const parsed = JSON.parse(text) as PipelineCacheData | PipelineCacheData[];
          const dataList = (Array.isArray(parsed) ? parsed : [parsed]).filter(
            (data) => data?.format === 'zephyr3d-pso'
          );
          if (dataList.length > 0) {
            return dataList;
          }
        }
      }
    } catch (err) {
      console.warn(`Pipeline cache ${path} unreadable: ${err}`);
    }
    this._missing.push(path);
    return [];
  }
}

/**
 * Reads pipeline cache files and compiles the pipelines they record ahead of time.
 *
 * @remarks
 * Pipelines recorded by the editor (or through the device's {@link @zephyr3d/device#PipelineRecorder})
 * are compiled before the draws that need them, so those draws do not stall. The engine never
 * calls this by itself. WebGPU and WebGL 2 compile the pipelines (on WebGL, the programs) recorded
 * on the same device type; recordings of other device types are skipped.
 *
 * @example
 * ```ts
 * const cache = getEngine().pipelineCache;
 * const manifest = await cache.loadManifest();
 * if (manifest) {
 *   const task = cache.createTask(cache.findEntries(manifest, { scenes: ['/assets/main.zscn'] }));
 *   await task.run({ onProgress: (p) => showProgress(p.completed + p.failed + p.skipped, p.total) });
 * }
 * ```
 * @public
 */
export class PipelineCacheManager {
  private readonly _getVFS: () => VFS;
  private _taskCounter: number;
  /** @internal */
  constructor(getVFS: () => VFS) {
    this._getVFS = getVFS;
    this._taskCounter = 0;
  }
  /**
   * Reads a pipeline cache manifest from the engine's VFS.
   *
   * @param path - VFS path of the manifest, defaults to `/pipeline-cache.json`
   * @returns The manifest with absolute file paths, or null if there is none or it cannot be read
   */
  async loadManifest(path = `/${PIPELINE_CACHE_MANIFEST_FILE}`): Promise<Nullable<PipelineCacheManifest>> {
    const vfs = this._getVFS();
    try {
      if (!(await vfs.exists(path))) {
        return null;
      }
      const text = (await vfs.readFile(path, { encoding: 'utf8' })) as string;
      if (!text.trimStart().startsWith('{')) {
        return null;
      }
      const manifest = JSON.parse(text) as PipelineCacheManifest;
      if (
        manifest?.format !== 'zephyr3d-pso-manifest' ||
        manifest.version !== MANIFEST_VERSION ||
        !Array.isArray(manifest.entries)
      ) {
        console.warn(`Pipeline cache manifest ${path} skipped: not a version ${MANIFEST_VERSION} manifest`);
        return null;
      }
      const dir = vfs.dirname(vfs.normalizePath(path));
      return {
        ...manifest,
        entries: manifest.entries.map((entry) => ({
          ...entry,
          file: vfs.normalizePath(entry.file.startsWith('/') ? entry.file : vfs.join(dir, entry.file))
        }))
      };
    } catch (err) {
      console.warn(`Pipeline cache manifest ${path} unreadable: ${err}`);
      return null;
    }
  }
  /**
   * Picks the entries of a manifest.
   *
   * @param manifest - Manifest to pick from
   * @param query - Scene paths and tags to pick; the entry no scene claimed is included
   * unless `includeCommon` is false. Without scenes and tags, every entry is picked
   * @returns The entries picked
   */
  findEntries(
    manifest: PipelineCacheManifest,
    query?: { scenes?: string[]; tags?: Nullable<string>[]; includeCommon?: boolean }
  ): PipelineCacheManifestEntry[] {
    const vfs = this._getVFS();
    if (!query?.scenes && !query?.tags) {
      return query?.includeCommon === false
        ? manifest.entries.filter((entry) => entry.tag !== null)
        : [...manifest.entries];
    }
    const wanted = new Set<Nullable<string>>();
    for (const scene of query.scenes ?? []) {
      wanted.add(vfs.normalizePath(scene));
    }
    for (const tag of query.tags ?? []) {
      wanted.add(tag);
    }
    if (query.includeCommon !== false) {
      wanted.add(null);
    }
    return manifest.entries.filter(
      (entry) => wanted.has(entry.tag) || (entry.tag !== null && wanted.has(vfs.normalizePath(entry.tag)))
    );
  }
  /**
   * Makes a task compiling the pipelines of recording files. It does nothing until it is run.
   *
   * @param sources - VFS paths of recording files, manifest entries, or recordings already read
   * @param options - Name of the task, for messages
   * @returns The task
   */
  createTask(sources: PipelineCompileSource[], options?: { name?: string }) {
    return new PipelineCompileTask(
      this._getVFS(),
      sources,
      options?.name ?? `pipeline-cache-${++this._taskCounter}`
    );
  }
  /** Gets how the pipelines of the device were made: precompiled, used, compiled on demand */
  getStats(): PipelineCacheStats {
    return getDevice().getPipelineCacheStats();
  }
}
