import type {
  PipelineCacheData,
  PipelineCacheStats,
  PipelinePrecompileJob,
  PipelinePrecompileOptions,
  PipelinePrecompilePriority,
  PipelinePrecompileProgress,
  PipelinePrecompileResult
} from '@zephyr3d/device';
import { semanticList } from '@zephyr3d/device';
import type { WebGLDevice } from './device_webgl';
import type { WebGLGPUProgram } from './gpuprogram_webgl';
import type { WebGLProgramRecord } from './pipeline_recorder';
import { getProgramRecordKey, PIPELINE_CACHE_BACKEND, PIPELINE_CACHE_VERSION } from './pipeline_recorder';
import { WebGLEnum } from './webgl_enum';

/** Programs compiling at once */
const FOREGROUND_CONCURRENCY = 8;
const BACKGROUND_CONCURRENCY = 2;
/** Main thread time (ms) spent starting compiles before yielding; without parallel compiling, compiles block */
const FOREGROUND_SLICE_MS = 8;
const BACKGROUND_SLICE_MS = 2;
/** Delay before the background goes on after using up its slice, about a frame */
const BACKGROUND_RESUME_MS = 16;
/** How often programs compiling in parallel are asked whether they are done */
const FOREGROUND_POLL_MS = 4;
const BACKGROUND_POLL_MS = 16;
/** Failed programs logged one by one, the rest only counted */
const MAX_LOGGED_FAILURES = 8;
/** Programs compiled on demand kept in the statistics */
const MAX_ON_DEMAND_PROGRAMS = 32;
/** `COMPLETION_STATUS_KHR` of `KHR_parallel_shader_compile` */
const COMPLETION_STATUS_KHR = 0x91b1;

type WorkItem = { key: string; vs: string; fs: string };

type Compiling = {
  job: WebGLPipelinePrecompileJob;
  item: WorkItem;
  program: WebGLProgram;
  vertexShader: WebGLShader;
  fragmentShader: WebGLShader;
};

class WebGLPipelinePrecompileJob implements PipelinePrecompileJob {
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
  private readonly _precompiler: WebGLPipelinePrecompiler;
  constructor(
    precompiler: WebGLPipelinePrecompiler,
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
 * Compiles recorded programs ahead of time.
 *
 * @remarks
 * WebGL has no pipeline objects to keep: each program is compiled, linked and deleted
 * again, which leaves its binary in the browser's shader cache, so the program a draw
 * creates later with the same sources links from the cache. With `KHR_parallel_shader_compile`
 * the compiles run off the main thread; without it each one blocks, within a time slice.
 * @internal
 */
export class WebGLPipelinePrecompiler {
  private readonly _device: WebGLDevice;
  private readonly _jobs: WebGLPipelinePrecompileJob[];
  private readonly _compiling: Map<string, Compiling>;
  /** Programs precompiled, and whether a program the device created has used them */
  private readonly _precompiled: Map<string, boolean>;
  /** Programs the device created */
  private readonly _created: Set<string>;
  private readonly _stats: PipelineCacheStats;
  private _parallel: boolean | null;
  private _resumeTimer: ReturnType<typeof setTimeout> | null;
  private _pollTimer: ReturnType<typeof setTimeout> | null;
  private _failures: number;
  constructor(device: WebGLDevice) {
    this._device = device;
    this._jobs = [];
    this._compiling = new Map();
    this._precompiled = new Map();
    this._created = new Set();
    this._stats = { precompiled: 0, precompiledUsed: 0, onDemand: 0, onDemandPrograms: [] };
    this._parallel = null;
    this._resumeTimer = null;
    this._pollTimer = null;
    this._failures = 0;
  }
  getStats(): PipelineCacheStats {
    return { ...this._stats, onDemandPrograms: [...this._stats.onDemandPrograms] };
  }
  /** Counts a program the device creates, compiled ahead of time or on demand */
  programCreated(program: WebGLGPUProgram) {
    const key = program.contentKey;
    const used = this._precompiled.get(key);
    if (used !== undefined) {
      if (!used) {
        this._precompiled.set(key, true);
        this._stats.precompiledUsed++;
      }
    } else if (!this._created.has(key)) {
      this._stats.onDemand++;
      const programs = this._stats.onDemandPrograms;
      programs.push(program.name);
      if (programs.length > MAX_ON_DEMAND_PROGRAMS) {
        programs.shift();
      }
    }
    this._created.add(key);
  }
  submit(dataList: PipelineCacheData[], options?: PipelinePrecompileOptions): PipelinePrecompileJob {
    const items: WorkItem[] = [];
    const queued = new Set<string>();
    let skipped = 0;
    for (const data of dataList) {
      if (!this.isReadable(data)) {
        skipped += (data?.render?.length ?? 0) + (data?.compute?.length ?? 0);
        continue;
      }
      for (const record of data.render as WebGLProgramRecord[]) {
        const key = getProgramRecordKey(record);
        const vs = data.sources[record.vs];
        const fs = data.sources[record.fs];
        if (typeof vs !== 'string' || typeof fs !== 'string' || queued.has(key) || this.isCompiled(key)) {
          skipped++;
        } else {
          queued.add(key);
          items.push({ key, vs, fs });
        }
      }
      skipped += data.compute?.length ?? 0;
    }
    const job = new WebGLPipelinePrecompileJob(this, items, skipped, options);
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
      if (this._compiling.size >= (foreground ? FOREGROUND_CONCURRENCY : BACKGROUND_CONCURRENCY)) {
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
  remove(job: WebGLPipelinePrecompileJob) {
    const index = this._jobs.indexOf(job);
    if (index >= 0) {
      this._jobs.splice(index, 1);
    }
  }
  private isCompiled(key: string) {
    return this._compiling.has(key) || this._precompiled.has(key) || this._created.has(key);
  }
  private get parallel() {
    if (this._parallel === null) {
      this._parallel = !!this._device.context.getExtension('KHR_parallel_shader_compile');
    }
    return this._parallel;
  }
  private resume(delay: number) {
    if (this._resumeTimer === null) {
      this._resumeTimer = setTimeout(() => {
        this._resumeTimer = null;
        this.pump();
      }, delay);
    }
  }
  private start(job: WebGLPipelinePrecompileJob, item: WorkItem) {
    if (this.isCompiled(item.key) || this._device.isContextLost()) {
      // A draw or another job compiled it since the job was made
      job.account('skipped');
      job.checkDone();
      return;
    }
    // Compiled the way programs are, so the shader cache knows it: see WebGLGPUProgram
    const gl = this._device.context;
    const program = gl.createProgram();
    const vertexShader = gl.createShader(WebGLEnum.VERTEX_SHADER)!;
    gl.attachShader(program, vertexShader);
    gl.shaderSource(vertexShader, item.vs);
    gl.compileShader(vertexShader);
    const fragmentShader = gl.createShader(WebGLEnum.FRAGMENT_SHADER)!;
    gl.attachShader(program, fragmentShader);
    gl.shaderSource(fragmentShader, item.fs);
    gl.compileShader(fragmentShader);
    for (let loc = 0; loc < semanticList.length; loc++) {
      gl.bindAttribLocation(program, loc, semanticList[loc]);
    }
    gl.linkProgram(program);
    const compiling: Compiling = { job, item, program, vertexShader, fragmentShader };
    job.inflight++;
    this._compiling.set(item.key, compiling);
    if (this.parallel) {
      this.poll();
    } else {
      // The status query waits for the link
      this.finish(compiling);
    }
  }
  /** Finishes the programs done compiling in parallel, and asks again later about the rest */
  private poll() {
    if (this._pollTimer !== null) {
      return;
    }
    const foreground = this._jobs.some((job) => job.priority === 'foreground');
    this._pollTimer = setTimeout(
      () => {
        this._pollTimer = null;
        const gl = this._device.context;
        let finished = false;
        for (const compiling of [...this._compiling.values()]) {
          if (
            this._device.isContextLost() ||
            gl.getProgramParameter(compiling.program, COMPLETION_STATUS_KHR)
          ) {
            this.finish(compiling);
            finished = true;
          }
        }
        if (this._compiling.size > 0) {
          this.poll();
        }
        if (finished) {
          this.pump();
        }
      },
      foreground ? FOREGROUND_POLL_MS : BACKGROUND_POLL_MS
    );
  }
  private finish(compiling: Compiling) {
    const { job, item, program, vertexShader, fragmentShader } = compiling;
    const gl = this._device.context;
    let error: string | null = null;
    if (this._device.isContextLost()) {
      error = 'context lost';
    } else if (!gl.getProgramParameter(program, WebGLEnum.LINK_STATUS)) {
      error = !gl.getShaderParameter(vertexShader, WebGLEnum.COMPILE_STATUS)
        ? gl.getShaderInfoLog(vertexShader)
        : !gl.getShaderParameter(fragmentShader, WebGLEnum.COMPILE_STATUS)
          ? gl.getShaderInfoLog(fragmentShader)
          : gl.getProgramInfoLog(program);
    }
    // The browser's shader cache keeps the binary for the program a draw creates later
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    gl.deleteProgram(program);
    this._compiling.delete(item.key);
    job.inflight--;
    if (error === null) {
      this._precompiled.set(item.key, false);
      this._stats.precompiled++;
      job.account('completed');
    } else {
      this.logFailure(item, error);
      job.account('failed');
    }
    job.checkDone();
  }
  private isReadable(data: PipelineCacheData) {
    if (
      data?.format !== 'zephyr3d-pso' ||
      data.backend !== PIPELINE_CACHE_BACKEND ||
      data.version !== PIPELINE_CACHE_VERSION
    ) {
      console.warn(
        `Pipeline cache of ${data?.backend} version ${data?.version} skipped: this device reads ${PIPELINE_CACHE_BACKEND} version ${PIPELINE_CACHE_VERSION}`
      );
      return false;
    }
    return true;
  }
  private logFailure(item: WorkItem, err: unknown) {
    this._failures++;
    if (this._failures <= MAX_LOGGED_FAILURES) {
      console.error(`Precompiling program ${item.key} failed: ${err}`);
    } else if (this._failures === MAX_LOGGED_FAILURES + 1) {
      console.error('More programs failed to precompile, no longer logged one by one');
    }
  }
}
