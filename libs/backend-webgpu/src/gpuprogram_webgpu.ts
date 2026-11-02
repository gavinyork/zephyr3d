import type {
  GPUProgramConstructParams,
  RenderProgramConstructParams,
  ComputeProgramConstructParams,
  GPUProgram,
  BindGroupLayout,
  PBStructTypeInfo,
  ShaderKind
} from '@zephyr3d/device';
import { WebGPUObject } from './gpuobject_webgpu';
import type { WebGPUDevice } from './device';
import type { Immutable, Nullable } from '@zephyr3d/base';
import { BindGroupCache } from './bindgroup_cache';
import { hashString } from './content_hash';

/**
 * What a program is made of, identified the same way in every session
 * @internal
 */
export type WebGPUProgramContent = {
  /** Hash of everything below */
  hash: string;
  /** Source hashes of the stages, empty for stages the program does not have */
  vs: string;
  fs: string;
  cs: string;
  /** Content of the bind group layouts */
  layouts: string[];
};

export class WebGPUProgram extends WebGPUObject<unknown> implements GPUProgram {
  private static _hashCounter = 0;
  private readonly _type: 'render' | 'compute';
  private readonly _vs!: string;
  private readonly _fs!: string;
  private readonly _cs!: string;
  private readonly _label: string;
  private readonly _hash: string;
  private readonly _content: WebGPUProgramContent;
  private readonly _fragmentOutputCount: number;
  private _error: string;
  private readonly _bindGroupLayouts: BindGroupLayout[];
  private readonly _vertexAttributes!: string;
  private _csModule!: GPUShaderModule;
  private _vsModule!: GPUShaderModule;
  private _fsModule!: GPUShaderModule;
  private _pipelineLayout!: GPUPipelineLayout;
  constructor(device: WebGPUDevice, params: GPUProgramConstructParams) {
    super(device);
    this._type = params.type;
    this._label = params.label ?? `Program ${this.uid}`;
    this._bindGroupLayouts = [...params.params.bindGroupLayouts];
    this._error = '';
    if (params.type === 'render') {
      const renderParams = params.params as RenderProgramConstructParams;
      this._vs = renderParams.vs;
      this._fs = renderParams.fs;
      this._fragmentOutputCount =
        renderParams.fragmentOutputCount ?? WebGPUProgram.countFragmentOutputs(this._fs);
      this._vertexAttributes = renderParams.vertexAttributes ? renderParams.vertexAttributes.join(':') : '';
    } else {
      const computeParams = params.params as ComputeProgramConstructParams;
      this._cs = computeParams.source;
      this._fragmentOutputCount = 0;
    }
    this._content = this.computeContent();
    this._load();
    this._hash = String(++WebGPUProgram._hashCounter);
  }
  get type() {
    return this._type;
  }
  get label() {
    return this._label;
  }
  getCompileError() {
    return this._error;
  }
  getShaderSource(kin: ShaderKind) {
    switch (kin) {
      case 'vertex':
        return this._vs;
      case 'fragment':
        return this._fs;
      case 'compute':
        return this._cs;
      default:
        return null;
    }
  }
  getBindingInfo(name: string) {
    for (let group = 0; group < this._bindGroupLayouts.length; group++) {
      const layout = this._bindGroupLayouts[group];
      const bindName = layout.nameMap?.[name] ?? name;
      for (let binding = 0; binding < layout.entries.length; binding++) {
        const bindingPoint = layout.entries[binding];
        if (bindingPoint.name === bindName) {
          return {
            group: group,
            binding: binding,
            type: bindingPoint.type
          };
        }
      }
    }
    return null;
  }
  get bindGroupLayouts(): Immutable<BindGroupLayout[]> {
    return this._bindGroupLayouts;
  }
  get vertexAttributes() {
    return this._vertexAttributes;
  }
  get fragmentOutputCount() {
    return this._fragmentOutputCount;
  }
  get hash() {
    return this._hash;
  }
  /**
   * Content of the program: unlike hash, which numbers programs in the order they are
   * made, it is the same in every session, so pipelines can be matched across sessions
   * @internal
   */
  getContent(): WebGPUProgramContent {
    return this._content;
  }
  getPipelineLayout() {
    return this._pipelineLayout;
  }
  getShaderModule() {
    return {
      vsModule: this._vsModule,
      fsModule: this._fsModule,
      csModule: this._csModule,
      pipelineLayout: this._pipelineLayout
    };
  }
  get fsModule() {
    return this._fsModule;
  }
  destroy() {
    this._object = null;
  }
  restore() {
    if (!this._object) {
      this._load();
    }
  }
  isProgram(): this is GPUProgram {
    return true;
  }
  createUniformBuffer(uniform: string) {
    const type = this.getBindingInfo(uniform)?.type as PBStructTypeInfo;
    return type ? this.device.createStructuredBuffer(type, { usage: 'uniform' }) : null;
  }
  private computeContent(): WebGPUProgramContent {
    const vs = this._type === 'render' ? hashString(this._vs) : '';
    const fs = this._type === 'render' ? hashString(this._fs) : '';
    const cs = this._type === 'compute' ? hashString(this._cs) : '';
    const layouts = this._bindGroupLayouts.map((layout) => BindGroupCache.getLayoutHash(layout));
    return {
      hash: hashString(`${this._type}|${vs}|${fs}|${cs}|${layouts.join('|')}`),
      vs,
      fs,
      cs,
      layouts
    };
  }
  private _load() {
    // Modules and layouts are shared by content with other programs and with
    // pipelines compiled ahead of time
    if (this._type === 'render') {
      this._vsModule = this.fetchShaderModule(this._vs, this._content.vs);
      this._fsModule = this.fetchShaderModule(this._fs, this._content.fs);
    } else {
      this._csModule = this.fetchShaderModule(this._cs, this._content.cs);
    }
    this._pipelineLayout = this._device.fetchPipelineLayout(this._content.layouts, () =>
      this._bindGroupLayouts.map((val) => this._device.fetchBindGroupLayout(val)[1])
    );
    this._object = {};
  }
  private fetchShaderModule(code: string, hash: string) {
    const entry = this._device.fetchShaderModule(code, hash, this._label);
    entry.messages.then((messages) => {
      this._error += messages;
    });
    return entry.module;
  }
  private static countFragmentOutputs(source: string) {
    const outputStruct = /struct\s+zFSOutput\s*\{([\s\S]*?)\};/.exec(source);
    if (!outputStruct) {
      return 0;
    }
    let count = 0;
    const re = /@location\((\d+)\)/g;
    let match: Nullable<RegExpExecArray>;
    while ((match = re.exec(outputStruct[1]))) {
      count = Math.max(count, Number(match[1]) + 1);
    }
    return count;
  }
  use() {
    this._device.setProgram(this);
  }
}
