import type { Immutable, Nullable } from '@zephyr3d/base';
import type {
  BindGroupLayout,
  ComputeProgramConstructParams,
  GPUProgram,
  GPUProgramConstructParams,
  PBStructTypeInfo,
  RenderProgramConstructParams,
  ShaderKind
} from '@zephyr3d/device';
import { NullGPUObject } from './gpuobject_null';
import type { NullDevice } from './device_null';

/**
 * GPU program of a null device
 *
 * @remarks
 * Shader sources are stored verbatim, so tests can assert on generated shader
 * code without a real compiler. Programs never fail to compile.
 *
 * @public
 */
export class NullGPUProgram extends NullGPUObject<unknown> implements GPUProgram<unknown> {
  /** @internal */
  private readonly _type: 'render' | 'compute';
  /** @internal */
  private readonly _vs: Nullable<string>;
  /** @internal */
  private readonly _fs: Nullable<string>;
  /** @internal */
  private readonly _cs: Nullable<string>;
  /** @internal */
  private readonly _bindGroupLayouts: BindGroupLayout[];
  /** @internal */
  private readonly _vertexAttributes: number[];
  /** @internal */
  private _useCount: number;
  constructor(device: NullDevice, params: GPUProgramConstructParams) {
    super(device);
    this._type = params.type;
    this._useCount = 0;
    if (params.type === 'render') {
      const renderParams = params.params as RenderProgramConstructParams;
      this._vs = renderParams.vs;
      this._fs = renderParams.fs;
      this._cs = null;
      this._bindGroupLayouts = [...renderParams.bindGroupLayouts];
      this._vertexAttributes = [...renderParams.vertexAttributes];
    } else {
      const computeParams = params.params as ComputeProgramConstructParams;
      this._vs = null;
      this._fs = null;
      this._cs = computeParams.source;
      this._bindGroupLayouts = [...computeParams.bindGroupLayouts];
      this._vertexAttributes = [];
    }
    if (params.label) {
      this._name = params.label;
    }
    this._object = this._createFakeObject();
  }
  get type() {
    return this._type;
  }
  get bindGroupLayouts(): Immutable<BindGroupLayout[]> {
    return this._bindGroupLayouts;
  }
  get vertexAttributes(): Immutable<number[]> {
    return this._vertexAttributes;
  }
  /** How many times this program was used for drawing or computing */
  get useCount() {
    return this._useCount;
  }
  getShaderSource(kind: ShaderKind) {
    switch (kind) {
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
  getCompileError() {
    return null;
  }
  getBindingInfo(name: string) {
    for (let group = 0; group < this._bindGroupLayouts.length; group++) {
      const layout = this._bindGroupLayouts[group];
      const bindName = layout.nameMap?.[name] ?? name;
      for (let binding = 0; binding < layout.entries.length; binding++) {
        const entry = layout.entries[binding];
        if (entry.name === bindName) {
          return {
            group,
            binding,
            type: entry.type
          };
        }
      }
    }
    return null;
  }
  createUniformBuffer(uniform: string) {
    const type = this.getBindingInfo(uniform)?.type as PBStructTypeInfo;
    return type ? this._device.createStructuredBuffer(type, { usage: 'uniform' }) : null;
  }
  use() {
    this._useCount++;
  }
  isProgram(): this is GPUProgram {
    return true;
  }
}
