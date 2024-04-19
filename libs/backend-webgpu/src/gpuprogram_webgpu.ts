/* eslint-disable @typescript-eslint/no-explicit-any */
import type {
  GPUProgramConstructParams,
  RenderProgramConstructParams,
  ComputeProgramConstructParams,
  GPUProgram,
  BindGroupLayout,
  BindPointInfo,
  StructuredBuffer,
  PBStructTypeInfo,
  ShaderKind
} from '@zephyr3d/device';
import { WebGPUObject } from './gpuobject_webgpu';
import type { WebGPUDevice } from './device';

export class WebGPUProgram extends WebGPUObject<unknown> implements GPUProgram {
  private static _hashCounter = 0;
  private _type: 'render' | 'compute';
  private _vs: string;
  private _fs: string;
  private _cs: string;
  private _label: string;
  private _hash: string;
  private _error: string;
  private _bindGroupLayouts: BindGroupLayout[];
  private _vertexAttributes: string;
  private _csModule: GPUShaderModule;
  private _vsModule: GPUShaderModule;
  private _fsModule: GPUShaderModule;
  private _pipelineLayout: GPUPipelineLayout;
  constructor(device: WebGPUDevice, params: GPUProgramConstructParams) {
    super(device);
    this._type = params.type;
    this._label = params.label;
    this._bindGroupLayouts = [...params.params.bindGroupLayouts];
    this._error = '';
    if (params.type === 'render') {
      const renderParams = params.params as RenderProgramConstructParams;
      this._vs = renderParams.vs;
      this._fs = renderParams.fs;
      this._vertexAttributes = renderParams.vertexAttributes ? renderParams.vertexAttributes.join(':') : '';
    } else {
      const computeParams = params.params as ComputeProgramConstructParams;
      this._cs = computeParams.source;
    }
    this._load();
    this._hash = String(++WebGPUProgram._hashCounter);
  }
  get type(): 'render' | 'compute' {
    return this._type;
  }
  get label(): string {
    return this._label;
  }
  getCompileError(): string {
    return this._error;
  }
  getShaderSource(kin: ShaderKind): string {
    switch (kin) {
      case 'vertex':
        return this._vs;
      case 'fragment':
        return this._fs;
      case 'compute':
        return this._cs;
    }
  }
  getBindingInfo(name: string): BindPointInfo {
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
  get bindGroupLayouts(): BindGroupLayout[] {
    return this._bindGroupLayouts;
  }
  get vertexAttributes(): string {
    return this._vertexAttributes;
  }
  get hash(): string {
    return this._hash;
  }
  getPipelineLayout(): GPUPipelineLayout {
    return this._pipelineLayout;
  }
  getShaderModule(): {
    vsModule: GPUShaderModule;
    fsModule: GPUShaderModule;
    csModule: GPUShaderModule;
    pipelineLayout: GPUPipelineLayout;
  } {
    return {
      vsModule: this._vsModule,
      fsModule: this._fsModule,
      csModule: this._csModule,
      pipelineLayout: this._pipelineLayout
    };
  }
  get fsModule(): GPUShaderModule {
    return this._fsModule;
  }
  destroy() {
    this._vsModule = null;
    this._fsModule = null;
    this._pipelineLayout = null;
    this._object = null;
  }
  async restore() {
    if (!this._object) {
      this._load();
    }
  }
  isProgram(): boolean {
    return true;
  }
  createUniformBuffer(uniform: string): StructuredBuffer<unknown> {
    const type = this.getBindingInfo(uniform)?.type as PBStructTypeInfo;
    return type ? this.device.createStructuredBuffer(type, { usage: 'uniform' }) : null;
  }
  private _load() {
    if (this._type === 'render') {
      this._vsModule = this.createShaderModule(this._vs);
      this._fsModule = this.createShaderModule(this._fs);
    } else {
      this._csModule = this.createShaderModule(this._cs);
    }
    this._pipelineLayout = this.createPipelineLayout(this._bindGroupLayouts);
    this._object = {};
  }
  private createPipelineLayout(bindGroupLayouts: BindGroupLayout[]): GPUPipelineLayout {
    const layouts: GPUBindGroupLayout[] = [];
    bindGroupLayouts.forEach((val) => {
      layouts.push(this._device.fetchBindGroupLayout(val)[1]);
    });
    return this._device.device.createPipelineLayout({
      bindGroupLayouts: layouts
    });
  }
  private createShaderModule(code: string): GPUShaderModule {
    const t0 = Date.now();
    let sm = this._device.device.createShaderModule({ code });
    if (sm) {
      const func: (this: GPUShaderModule) => Promise<GPUCompilationInfo> =
        (sm as any).compilationInfo || (sm as any).getCompilationInfo;
      if (!func) {
        return sm;
      }
      func.call(sm).then((compilationInfo) => {
        const elapsed = Date.now() - t0;
        if (false && elapsed > 1000) {
          console.log(`compile shader took ${elapsed}ms: \n${code}`);
        }
        let err = false;
        if (compilationInfo?.messages?.length > 0) {
          let msg = '';
          for (const message of compilationInfo.messages) {
            if (message.type === 'error') {
              err = true;
            }
            msg += `Line ${message.lineNum}:${message.linePos} - ${code.slice(
              message.offset,
              message.offset + message.length
            )}\n`;
            msg += `${message.message}\n`;
            if (message.type === 'error') {
              err = true;
              console.error(msg);
            } else if (message.type === 'warning') {
              console.warn(msg);
            } else {
              console.log(msg);
            }
            this._error += msg;
          }
        }
        if (err) {
          sm = null;
        }
      });
    }
    return sm;
  }
  use(): void {
    this._device.setProgram(this);
  }
}
