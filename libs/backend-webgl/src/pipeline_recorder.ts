import type { Nullable } from '@zephyr3d/base';
import type { PipelineCacheData, PipelineRecorder } from '@zephyr3d/device';
import type { WebGLGPUProgram } from './gpuprogram_webgl';

/** Version of the pipeline cache files this backend writes and reads */
export const PIPELINE_CACHE_VERSION = 1;
/** Backend named in the pipeline cache files of this backend */
export const PIPELINE_CACHE_BACKEND = 'webgl2';

/**
 * A program as stored in a pipeline cache file: the content hashes of its sources.
 * Attribute locations are bound the same way for every program, so the sources are all
 * a program is made of.
 * @internal
 */
export type WebGLProgramRecord = {
  vs: string;
  fs: string;
};

/** Key of a recorded program */
export function getProgramRecordKey(record: WebGLProgramRecord) {
  return `${record.vs}:${record.fs}`;
}

/**
 * Records the programs draws use, so their shaders can be compiled ahead of time
 * @internal
 */
export class WebGLPipelineRecorder implements PipelineRecorder {
  private _depth: number;
  private readonly _tagStack: string[];
  private _records: Map<Nullable<string>, Map<string, WebGLProgramRecord>>;
  private _keys: Set<string>;
  private _sources: Map<string, string>;
  constructor() {
    this._depth = 0;
    this._tagStack = [];
    this._records = new Map();
    this._keys = new Set();
    this._sources = new Map();
  }
  get recording() {
    return this._depth > 0;
  }
  get count() {
    return this._keys.size;
  }
  begin() {
    this._depth++;
  }
  end() {
    if (this._depth > 0) {
      this._depth--;
    }
  }
  pushTag(tag: string) {
    this._tagStack.push(tag);
  }
  popTag() {
    this._tagStack.pop();
  }
  tags() {
    const tags: Nullable<string>[] = [];
    for (const [tag, records] of this._records) {
      if (records.size > 0) {
        tags.push(tag);
      }
    }
    return tags;
  }
  recordProgram(program: WebGLGPUProgram) {
    const records = this.getRecords(this.currentTag());
    const key = program.contentKey;
    if (!records.has(key)) {
      const record = { vs: program.vsHash, fs: program.fsHash };
      records.set(key, record);
      this._keys.add(key);
      this._sources.set(record.vs, program.getShaderSource('vertex')!);
      this._sources.set(record.fs, program.getShaderSource('fragment')!);
    }
  }
  export(tag: Nullable<string>): PipelineCacheData {
    const records = this._records.get(tag);
    const render = records ? [...records.values()] : [];
    const sources: Record<string, string> = {};
    for (const record of render) {
      sources[record.vs] = this._sources.get(record.vs)!;
      sources[record.fs] = this._sources.get(record.fs)!;
    }
    return {
      format: 'zephyr3d-pso',
      version: PIPELINE_CACHE_VERSION,
      backend: PIPELINE_CACHE_BACKEND,
      tag,
      profile: {},
      sources,
      layouts: {},
      render,
      compute: []
    };
  }
  merge(data: PipelineCacheData) {
    if (
      data?.format !== 'zephyr3d-pso' ||
      data.backend !== PIPELINE_CACHE_BACKEND ||
      data.version !== PIPELINE_CACHE_VERSION
    ) {
      console.warn(
        `Pipeline cache of ${data?.backend} version ${data?.version} skipped: this device reads ${PIPELINE_CACHE_BACKEND} version ${PIPELINE_CACHE_VERSION}`
      );
      return;
    }
    const records = this.getRecords(data.tag);
    for (const record of data.render as WebGLProgramRecord[]) {
      const vs = data.sources[record.vs];
      const fs = data.sources[record.fs];
      if (typeof vs !== 'string' || typeof fs !== 'string') {
        continue;
      }
      const key = getProgramRecordKey(record);
      if (!records.has(key)) {
        records.set(key, record);
        this._keys.add(key);
        this._sources.set(record.vs, vs);
        this._sources.set(record.fs, fs);
      }
    }
  }
  clear() {
    this._records = new Map();
    this._keys = new Set();
    this._sources = new Map();
  }
  private currentTag(): Nullable<string> {
    return this._tagStack.length > 0 ? this._tagStack[this._tagStack.length - 1] : null;
  }
  private getRecords(tag: Nullable<string>) {
    let records = this._records.get(tag);
    if (!records) {
      records = new Map();
      this._records.set(tag, records);
    }
    return records;
  }
}
