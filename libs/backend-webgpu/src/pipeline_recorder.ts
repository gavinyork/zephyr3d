import type { Nullable } from '@zephyr3d/base';
import type { PipelineCacheData, PipelineRecorder } from '@zephyr3d/device';
import type { WebGPUDevice } from './device';
import type { WebGPUProgram } from './gpuprogram_webgpu';
import type { WebGPUComputePipelineRecord, WebGPURenderPipelineRecord } from './pipeline_cache';
import { getFrameBufferContentHash, getRenderPipelineContentHash } from './pipeline_cache';
import { hashString } from './content_hash';

/** Version of the pipeline cache files this backend writes and reads */
const PIPELINE_CACHE_VERSION = 1;

/**
 * A bind group layout as stored in a pipeline cache file
 * @internal
 */
export type WebGPUPipelineLayoutRecord = {
  /** Content of the layout, the key the bind group layout cache shares it by */
  key: string;
  desc: GPUBindGroupLayoutDescriptor;
};

type TagRecords = {
  render: Map<string, WebGPURenderPipelineRecord>;
  compute: Map<string, WebGPUComputePipelineRecord>;
};

/**
 * Key of a recorded render pipeline on a device: pipelines drawn to the canvas take
 * the canvas formats of that device
 * @internal
 */
export function getRenderRecordKey(record: WebGPURenderPipelineRecord, device: WebGPUDevice) {
  const frameBuffer = record.backbuffer
    ? getFrameBufferContentHash([device.backbufferFormat], device.backbufferDepthFormat, device.sampleCount)
    : getFrameBufferContentHash(record.colors, record.depth, record.samples);
  return getRenderPipelineContentHash(
    record.program,
    record.vertex,
    frameBuffer,
    record.primitiveType,
    record.primitive.stripIndexFormat,
    record.state,
    record.winding
  );
}

/** @internal */
export class WebGPUPipelineRecorder implements PipelineRecorder {
  private readonly _device: WebGPUDevice;
  private _depth: number;
  private readonly _tagStack: string[];
  private _records: Map<Nullable<string>, TagRecords>;
  private _renderKeys: Set<string>;
  private _computeKeys: Set<string>;
  private _sources: Map<string, string>;
  private _layouts: Map<string, WebGPUPipelineLayoutRecord>;
  /** Programs whose sources and layouts are stored */
  private _programs: Set<string>;
  constructor(device: WebGPUDevice) {
    this._device = device;
    this._depth = 0;
    this._tagStack = [];
    this._records = new Map();
    this._renderKeys = new Set();
    this._computeKeys = new Set();
    this._sources = new Map();
    this._layouts = new Map();
    this._programs = new Set();
  }
  get recording() {
    return this._depth > 0;
  }
  get count() {
    return this._renderKeys.size + this._computeKeys.size;
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
      if (records.render.size + records.compute.size > 0) {
        tags.push(tag);
      }
    }
    return tags;
  }
  recordRender(key: string, record: WebGPURenderPipelineRecord, program: WebGPUProgram) {
    const records = this.getRecords(this.currentTag());
    if (!records.render.has(key)) {
      records.render.set(key, record);
      this._renderKeys.add(key);
      this.addProgram(program);
    }
  }
  recordCompute(key: string, record: WebGPUComputePipelineRecord, program: WebGPUProgram) {
    const records = this.getRecords(this.currentTag());
    if (!records.compute.has(key)) {
      records.compute.set(key, record);
      this._computeKeys.add(key);
      this.addProgram(program);
    }
  }
  export(tag: Nullable<string>): PipelineCacheData {
    const records = this._records.get(tag);
    const render = records ? [...records.render.values()] : [];
    const compute = records ? [...records.compute.values()] : [];
    const sources: Record<string, string> = {};
    const layouts: Record<string, WebGPUPipelineLayoutRecord> = {};
    const addSource = (hash: string) => {
      if (hash) {
        sources[hash] = this._sources.get(hash)!;
      }
    };
    const addLayouts = (hashes: string[]) => {
      for (const hash of hashes) {
        layouts[hash] = this._layouts.get(hash)!;
      }
    };
    for (const record of render) {
      addSource(record.vs);
      addSource(record.fs);
      addLayouts(record.layouts);
    }
    for (const record of compute) {
      addSource(record.cs);
      addLayouts(record.layouts);
    }
    return {
      format: 'zephyr3d-pso',
      version: PIPELINE_CACHE_VERSION,
      backend: 'webgpu',
      tag,
      profile: {
        backbufferFormat: this._device.backbufferFormat,
        backbufferDepthFormat: this._device.backbufferDepthFormat,
        sampleCount: this._device.sampleCount,
        features: [...this._device.device.features].sort()
      },
      sources,
      layouts,
      render,
      compute
    };
  }
  merge(data: PipelineCacheData) {
    if (
      data?.format !== 'zephyr3d-pso' ||
      data.backend !== 'webgpu' ||
      data.version !== PIPELINE_CACHE_VERSION
    ) {
      console.warn(
        `Pipeline cache of ${data?.backend} version ${data?.version} skipped: this device reads webgpu version ${PIPELINE_CACHE_VERSION}`
      );
      return;
    }
    for (const hash in data.sources) {
      if (!this._sources.has(hash)) {
        this._sources.set(hash, data.sources[hash]);
      }
    }
    for (const hash in data.layouts) {
      if (!this._layouts.has(hash)) {
        this._layouts.set(hash, data.layouts[hash] as WebGPUPipelineLayoutRecord);
      }
    }
    const records = this.getRecords(data.tag ?? null);
    for (const record of data.render as WebGPURenderPipelineRecord[]) {
      const key = getRenderRecordKey(record, this._device);
      if (!records.render.has(key)) {
        records.render.set(key, record);
        this._renderKeys.add(key);
      }
    }
    for (const record of data.compute as WebGPUComputePipelineRecord[]) {
      if (!records.compute.has(record.program)) {
        records.compute.set(record.program, record);
        this._computeKeys.add(record.program);
      }
    }
  }
  clear() {
    this._records = new Map();
    this._renderKeys = new Set();
    this._computeKeys = new Set();
    this._sources = new Map();
    this._layouts = new Map();
    this._programs = new Set();
  }
  private currentTag() {
    return this._tagStack.length > 0 ? this._tagStack[this._tagStack.length - 1] : null;
  }
  private getRecords(tag: Nullable<string>) {
    let records = this._records.get(tag);
    if (!records) {
      records = { render: new Map(), compute: new Map() };
      this._records.set(tag, records);
    }
    return records;
  }
  private addProgram(program: WebGPUProgram) {
    const content = program.getContent();
    if (this._programs.has(content.hash)) {
      return;
    }
    this._programs.add(content.hash);
    if (content.vs) {
      this._sources.set(content.vs, program.getShaderSource('vertex')!);
    }
    if (content.fs) {
      this._sources.set(content.fs, program.getShaderSource('fragment')!);
    }
    if (content.cs) {
      this._sources.set(content.cs, program.getShaderSource('compute')!);
    }
    program.bindGroupLayouts.forEach((layout, index) => {
      const key = content.layouts[index];
      const hash = hashString(key);
      if (!this._layouts.has(hash)) {
        this._layouts.set(hash, { key, desc: this._device.fetchBindGroupLayout(layout)[0] });
      }
    });
  }
}
