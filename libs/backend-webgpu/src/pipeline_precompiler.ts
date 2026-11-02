import type {
  PipelineCacheData,
  PipelinePrecompileJob,
  PipelinePrecompileOptions,
  PipelinePrecompilePriority,
  PipelinePrecompileProgress,
  PipelinePrecompileResult
} from '@zephyr3d/device';
import type { WebGPUDevice } from './device';
import type { WebGPUComputePipelineRecord, WebGPURenderPipelineRecord } from './pipeline_cache';
import type { WebGPUPipelineLayoutRecord } from './pipeline_recorder';
import { getRenderRecordKey, PIPELINE_CACHE_VERSION } from './pipeline_recorder';

/** Pipelines compiling at once */
const FOREGROUND_CONCURRENCY = 8;
const BACKGROUND_CONCURRENCY = 2;
/**
 * Main thread time spent starting compiles before yielding: shader modules are parsed
 * when they are created, which blocks. In the foreground yielding lets a loading screen
 * update; in the background it keeps the frames of the application short
 */
const FOREGROUND_SLICE_MS = 8;
const BACKGROUND_SLICE_MS = 2;
/** Delay before the background goes on after using up its slice, about a frame */
const BACKGROUND_RESUME_MS = 16;
/** Failed pipelines logged one by one, the rest only counted */
const MAX_LOGGED_FAILURES = 8;

type WorkItem =
  | { kind: 'render'; key: string; record: WebGPURenderPipelineRecord; data: PipelineCacheData }
  | { kind: 'compute'; key: string; record: WebGPUComputePipelineRecord; data: PipelineCacheData };

class WebGPUPipelinePrecompileJob implements PipelinePrecompileJob {
  readonly progress: PipelinePrecompileProgress;
  readonly result: Promise<PipelinePrecompileResult>;
  /** @internal */
  readonly items: WorkItem[];
  /** @internal Next item to start */
  next: number;
  /** @internal Items compiling */
  inflight: number;
  private _priority: PipelinePrecompilePriority;
  private _done: boolean;
  private _cancelled: boolean;
  private readonly _start: number;
  private _resolve!: (result: PipelinePrecompileResult) => void;
  private readonly _onProgress: PipelinePrecompileOptions['onProgress'];
  private readonly _precompiler: WebGPUPipelinePrecompiler;
  constructor(
    precompiler: WebGPUPipelinePrecompiler,
    items: WorkItem[],
    skipped: number,
    options?: PipelinePrecompileOptions
  ) {
    this._precompiler = precompiler;
    this.items = items;
    this.next = 0;
    this.inflight = 0;
    this.progress = { total: items.length + skipped, completed: 0, failed: 0, skipped };
    this._priority = options?.priority ?? 'foreground';
    this._onProgress = options?.onProgress;
    this._done = false;
    this._cancelled = false;
    this._start = performance.now();
    this.result = new Promise((resolve) => {
      this._resolve = resolve;
    });
  }
  get done() {
    return this._done;
  }
  get priority() {
    return this._priority;
  }
  set priority(priority: PipelinePrecompilePriority) {
    if (priority !== this._priority) {
      this._priority = priority;
      this._precompiler.pump();
    }
  }
  /** @internal */
  hasWork() {
    return this.next < this.items.length;
  }
  cancel() {
    if (!this._done && this.hasWork()) {
      this._cancelled = true;
      this.progress.skipped += this.items.length - this.next;
      this.next = this.items.length;
      this.report();
      this.checkDone();
    }
  }
  /** @internal */
  account(outcome: 'completed' | 'failed' | 'skipped') {
    this.progress[outcome]++;
    this.report();
  }
  /** @internal */
  checkDone() {
    if (!this._done && this.inflight === 0 && !this.hasWork()) {
      this._done = true;
      this._precompiler.remove(this);
      this._resolve({
        ...this.progress,
        cancelled: this._cancelled,
        elapsedMs: performance.now() - this._start
      });
    }
  }
  private report() {
    try {
      this._onProgress?.({ ...this.progress });
    } catch (err) {
      console.error(err);
    }
  }
}

/**
 * Compiles recorded pipelines ahead of time with the asynchronous pipeline creation of
 * WebGPU, into the pipeline cache of the device
 * @internal
 */
export class WebGPUPipelinePrecompiler {
  private readonly _device: WebGPUDevice;
  private readonly _jobs: WebGPUPipelinePrecompileJob[];
  /** Content keys of the pipelines compiling */
  private readonly _compiling: Set<string>;
  private _inflight: number;
  private _resumeTimer: ReturnType<typeof setTimeout> | null;
  private _failures: number;
  constructor(device: WebGPUDevice) {
    this._device = device;
    this._jobs = [];
    this._compiling = new Set();
    this._inflight = 0;
    this._resumeTimer = null;
    this._failures = 0;
  }
  submit(dataList: PipelineCacheData[], options?: PipelinePrecompileOptions): PipelinePrecompileJob {
    const cache = this._device.pipelineCache;
    const items: WorkItem[] = [];
    const queued = new Set<string>();
    let skipped = 0;
    for (const data of dataList) {
      if (!this.isReadable(data)) {
        skipped += (data?.render?.length ?? 0) + (data?.compute?.length ?? 0);
        continue;
      }
      for (const record of data.render as WebGPURenderPipelineRecord[]) {
        const key = getRenderRecordKey(record, this._device);
        if (queued.has(key) || this._compiling.has(key) || cache.hasRenderPipeline(key)) {
          skipped++;
        } else {
          queued.add(key);
          items.push({ kind: 'render', key, record, data });
        }
      }
      for (const record of data.compute as WebGPUComputePipelineRecord[]) {
        const key = record.program;
        if (
          queued.has(`compute:${key}`) ||
          this._compiling.has(`compute:${key}`) ||
          cache.hasComputePipeline(key)
        ) {
          skipped++;
        } else {
          queued.add(`compute:${key}`);
          items.push({ kind: 'compute', key, record, data });
        }
      }
    }
    const job = new WebGPUPipelinePrecompileJob(this, items, skipped, options);
    this._jobs.push(job);
    job.checkDone();
    this.pump();
    return job;
  }
  /** Starts compiles while the concurrency and the time slice of the most urgent job allow */
  pump() {
    const sliceStart = performance.now();
    for (;;) {
      const job =
        this._jobs.find((job) => job.priority === 'foreground' && job.hasWork()) ??
        this._jobs.find((job) => job.hasWork());
      if (!job) {
        return;
      }
      const foreground = job.priority === 'foreground';
      if (this._inflight >= (foreground ? FOREGROUND_CONCURRENCY : BACKGROUND_CONCURRENCY)) {
        // A compile finishing pumps again
        return;
      }
      if (performance.now() - sliceStart >= (foreground ? FOREGROUND_SLICE_MS : BACKGROUND_SLICE_MS)) {
        this.resume(foreground ? 0 : BACKGROUND_RESUME_MS);
        return;
      }
      this.start(job, job.items[job.next++]);
    }
  }
  /** @internal */
  remove(job: WebGPUPipelinePrecompileJob) {
    const index = this._jobs.indexOf(job);
    if (index >= 0) {
      this._jobs.splice(index, 1);
    }
  }
  private resume(delay: number) {
    if (this._resumeTimer === null) {
      this._resumeTimer = setTimeout(() => {
        this._resumeTimer = null;
        this.pump();
      }, delay);
    }
  }
  private start(job: WebGPUPipelinePrecompileJob, item: WorkItem) {
    const cache = this._device.pipelineCache;
    const compilingKey = item.kind === 'render' ? item.key : `compute:${item.key}`;
    if (
      this._compiling.has(compilingKey) ||
      (item.kind === 'render' ? cache.hasRenderPipeline(item.key) : cache.hasComputePipeline(item.key))
    ) {
      // A draw or another job compiled it since the job was made
      job.account('skipped');
      job.checkDone();
      return;
    }
    let compiling: Promise<void>;
    try {
      compiling =
        item.kind === 'render'
          ? this._device.device
              .createRenderPipelineAsync(this.getRenderPipelineDescriptor(item.key, item.record, item.data))
              .then((pipeline) => cache.addPrecompiledRenderPipeline(item.key, pipeline, item.record))
          : this._device.device
              .createComputePipelineAsync(this.getComputePipelineDescriptor(item.record, item.data))
              .then((pipeline) => cache.addPrecompiledComputePipeline(item.key, pipeline, item.record));
    } catch (err) {
      this.logFailure(item, err);
      job.account('failed');
      job.checkDone();
      return;
    }
    job.inflight++;
    this._inflight++;
    this._compiling.add(compilingKey);
    compiling
      .then(
        () => job.account('completed'),
        (err) => {
          this.logFailure(item, err);
          job.account('failed');
        }
      )
      .finally(() => {
        job.inflight--;
        this._inflight--;
        this._compiling.delete(compilingKey);
        job.checkDone();
        this.pump();
      });
  }
  private isReadable(data: PipelineCacheData) {
    if (
      data?.format !== 'zephyr3d-pso' ||
      data.backend !== 'webgpu' ||
      data.version !== PIPELINE_CACHE_VERSION
    ) {
      console.warn(
        `Pipeline cache of ${data?.backend} version ${data?.version} skipped: this device reads webgpu version ${PIPELINE_CACHE_VERSION}`
      );
      return false;
    }
    const features = (data.profile?.features as string[]) ?? [];
    const missing = features.filter(
      (feature) => !this._device.device.features.has(feature as GPUFeatureName)
    );
    if (missing.length > 0) {
      console.warn(
        `Pipeline cache of tag ${data.tag} was recorded on a device with features this one lacks (${missing.join(
          ', '
        )}): pipelines relying on them fail to compile, or are compiled for nothing`
      );
    }
    return true;
  }
  private getShaderModule(hash: string, data: PipelineCacheData) {
    const code = data.sources[hash];
    if (typeof code !== 'string') {
      throw new Error(`Shader source ${hash} missing`);
    }
    return this._device.fetchShaderModule(code, hash).module;
  }
  private getPipelineLayout(hashes: string[], data: PipelineCacheData) {
    const layouts = hashes.map((hash) => {
      const layout = data.layouts[hash] as WebGPUPipelineLayoutRecord;
      if (!layout) {
        throw new Error(`Bind group layout ${hash} missing`);
      }
      return layout;
    });
    return this._device.fetchPipelineLayout(
      layouts.map((layout) => layout.key),
      () =>
        layouts.map(
          (layout) => this._device.bindGroupCache.fetchRecordedBindGroupLayout(layout.key, layout.desc)[1]
        )
    );
  }
  private getRenderPipelineDescriptor(
    key: string,
    record: WebGPURenderPipelineRecord,
    data: PipelineCacheData
  ): GPURenderPipelineDescriptor {
    let targets = record.targets;
    let depthStencil = record.depthStencil;
    if (record.backbuffer) {
      // The canvas formats are those of this device
      targets = targets.map((target, index) =>
        index === 0 ? { ...target, format: this._device.backbufferFormat } : target
      );
      depthStencil = depthStencil
        ? { ...depthStencil, format: this._device.backbufferDepthFormat }
        : undefined;
    }
    let primitive = record.primitive;
    if (primitive.unclippedDepth !== undefined && !this._device.device.features.has('depth-clip-control')) {
      // Left out on such a device by the pipelines draws make too
      primitive = { ...primitive };
      delete primitive.unclippedDepth;
    }
    return {
      label: key,
      layout: this.getPipelineLayout(record.layouts, data),
      vertex: {
        module: this.getShaderModule(record.vs, data),
        entryPoint: 'main',
        ...(record.vertexBuffers ? { buffers: record.vertexBuffers } : {})
      },
      primitive,
      depthStencil,
      multisample: record.multisample,
      fragment: {
        module: this.getShaderModule(record.fs, data),
        entryPoint: 'main',
        targets
      }
    };
  }
  private getComputePipelineDescriptor(
    record: WebGPUComputePipelineRecord,
    data: PipelineCacheData
  ): GPUComputePipelineDescriptor {
    return {
      layout: this.getPipelineLayout(record.layouts, data),
      compute: {
        module: this.getShaderModule(record.cs, data),
        entryPoint: 'main'
      }
    };
  }
  private logFailure(item: WorkItem, err: unknown) {
    this._failures++;
    if (this._failures <= MAX_LOGGED_FAILURES) {
      console.error(
        `Precompiling ${item.kind} pipeline ${item.key} failed: ${err instanceof Error ? err.message : err}`
      );
    } else if (this._failures === MAX_LOGGED_FAILURES + 1) {
      console.error('More pipelines failed to precompile, no longer logged one by one');
    }
  }
}
