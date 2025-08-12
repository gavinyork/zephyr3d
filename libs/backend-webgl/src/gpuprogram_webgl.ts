/* eslint-disable @typescript-eslint/no-explicit-any */
import { WebGLGPUObject } from './gpuobject_webgl';
import { isWebGL2 } from './utils';
import { WebGLEnum } from './webgl_enum';
import type {
  PBStructTypeInfo,
  GPUProgram,
  BindGroupLayout,
  BindPointInfo,
  StructuredBuffer,
  ShaderKind
} from '@zephyr3d/device';
import { semanticList } from '@zephyr3d/device';
import type { WebGLTextureSampler } from './sampler_webgl';
import type { WebGLBaseTexture } from './basetexture_webgl';
import type { WebGLGPUBuffer } from './buffer_webgl';
import type { WebGLDevice } from './device_webgl';
import type { TypedArrayConstructor } from '@zephyr3d/base';

type UniformBlockArray = Int32Array<ArrayBuffer> | Uint32Array<ArrayBuffer> | Float32Array<ArrayBuffer>;
export interface AttributeSetter {
  (value: WebGLGPUBuffer | number | Iterable<number>, offset?: number, stride?: number): void;
  location: number;
}

export type IUniformValue = number | Iterable<number> | [WebGLBaseTexture, WebGLSampler];
export interface UniformSetter {
  (value: IUniformValue): unknown;
}

interface ProgramUniformInfo {
  index: number;
  name: string;
  type: number;
  size: number;
  blockIndex: number;
  offset: number;
  isArray: boolean;
  viewCtor: TypedArrayConstructor<UniformBlockArray>;
  viewElementSize: number;
  view: UniformBlockArray;
  location: WebGLUniformLocation;
}

interface ProgramBlockInfo {
  index: number;
  used: boolean;
  size: number;
  uniformIndices: Uint32Array<ArrayBuffer>;
}

export class WebGLGPUProgram extends WebGLGPUObject<WebGLProgram> implements GPUProgram<WebGLProgram> {
  private readonly _vs: string;
  private readonly _fs: string;
  private _unitCounter: number;
  private _uniformSetters: Record<string, UniformSetter>;
  private _uniformInfo: ProgramUniformInfo[];
  private _blockInfo: Record<string, ProgramBlockInfo>;
  private readonly _bindGroupLayouts: BindGroupLayout[];
  private readonly _vertexAttributes: number[];
  private _error: string;
  private _vertexShader: WebGLShader;
  private _fragmentShader: WebGLShader;
  constructor(
    device: WebGLDevice,
    vertexShader: string,
    fragmentShader: string,
    bindGroupLayouts: BindGroupLayout[],
    vertexAttributes: number[]
  ) {
    super(device);
    this._object = this._device.context.createProgram();
    this._unitCounter = 0;
    this._uniformSetters = null;
    this._uniformInfo = null;
    this._blockInfo = null;
    this._error = '';
    this._vertexShader = null;
    this._fragmentShader = null;
    this._vs = vertexShader;
    this._fs = fragmentShader;
    this._bindGroupLayouts = [...bindGroupLayouts];
    this._vertexAttributes = [...vertexAttributes];
    this.load();
  }
  get type(): 'render' | 'compute' {
    return 'render';
  }
  getCompileError(): string {
    return this._error;
  }
  getShaderSource(kind: ShaderKind): string {
    switch (kind) {
      case 'vertex':
        return this._vs;
      case 'fragment':
        return this._fs;
      case 'compute':
        return null;
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
  get vertexAttributes(): number[] {
    return this._vertexAttributes;
  }
  setUniform(name: string, value: IUniformValue | Record<string, IUniformValue> | IUniformValue[]) {
    const setter = this._uniformSetters[name];
    if (setter) {
      setter(value as IUniformValue);
    } else {
      const proto = Object.getPrototypeOf(value);
      if (proto === Object.getPrototypeOf({})) {
        this._setUniformStruct(name, value as Record<string, IUniformValue>);
      } else if (proto == Object.getPrototypeOf([])) {
        this._setUniformArray(name, value as IUniformValue[]);
      }
    }
  }
  setBlock(name: string, value: WebGLGPUBuffer, offset: number) {
    const info = this._blockInfo[name];
    if (info) {
      this._device.bindUniformBuffer(info.index, value, offset);
      /*
      if (offset) {
        (this._device.context as WebGL2RenderingContext).bindBufferRange(
          WebGLEnum.UNIFORM_BUFFER,
          info.index,
          value.object,
          offset,
          value.byteLength - offset
        );
      } else {
        (this._device.context as WebGL2RenderingContext).bindBufferBase(
          WebGLEnum.UNIFORM_BUFFER,
          info.index,
          value.object
        );
      }
      */
    } else {
      console.error(`Block not found: ${name}`);
    }
  }
  destroy() {
    if (this._object) {
      this._device.context.deleteProgram(this._object);
      this._object = null;
      this._unitCounter = 0;
      this._uniformSetters = null;
      this._uniformInfo = null;
      this._blockInfo = null;
      this._error = '';
      this._vertexShader = null;
      this._fragmentShader = null;
    }
  }
  restore() {
    if (!this._object && !this._device.isContextLost()) {
      this.load();
    }
  }
  isProgram(): this is GPUProgram {
    return true;
  }
  use(): boolean {
    if (this !== this._device.context._currentProgram) {
      if (!this.checkLoad()) {
        return false;
      }
      /*
      this._device.context._currentProgram = this;
      this._device.context.useProgram(this._object);
      */
    }
    return true;
  }
  createUniformBuffer(uniform: string): StructuredBuffer<unknown> {
    const type = this.getBindingInfo(uniform)?.type as PBStructTypeInfo;
    return type ? this.device.createStructuredBuffer(type, { usage: 'uniform' }) : null;
  }
  private _setUniformStruct(name: string, value: Record<string, IUniformValue>) {
    for (const k in value) {
      this.setUniform(`${name}.${k}`, value[k]);
    }
  }
  private _setUniformArray(name: string, value: IUniformValue[]) {
    for (let i = 0; i < value.length; i++) {
      this.setUniform(`${name}[${i}]`, value[i]);
    }
  }
  private load(): void {
    if (this._device.isContextLost()) {
      return;
    }
    const gl = this._device.context;
    this._error = null;
    this._uniformSetters = {};
    if (!this._object) {
      this._object = this._device.context.createProgram();
    }
    this._vertexShader = gl.createShader(WebGLEnum.VERTEX_SHADER);
    gl.attachShader(this._object, this._vertexShader);
    gl.shaderSource(this._vertexShader, this._vs);
    gl.compileShader(this._vertexShader);
    this._fragmentShader = gl.createShader(WebGLEnum.FRAGMENT_SHADER);
    gl.attachShader(this._object, this._fragmentShader);
    gl.shaderSource(this._fragmentShader, this._fs);
    gl.compileShader(this._fragmentShader);
    for (let loc = 0; loc < semanticList.length; loc++) {
      gl.bindAttribLocation(this._object, loc, semanticList[loc]);
    }
    gl.linkProgram(this._object);
  }
  private checkLoad(): boolean {
    if (!this._object) {
      return false;
    }
    if (this._vertexShader) {
      const gl = this._device.context;
      if (!this._device.isContextLost()) {
        if (!gl.getProgramParameter(this._object, WebGLEnum.LINK_STATUS)) {
          if (!gl.getShaderParameter(this._vertexShader, WebGLEnum.COMPILE_STATUS)) {
            this._error = gl.getShaderInfoLog(this._vertexShader);
            console.error(new Error(`Compile shader failed: ${this._error}`));
          } else if (!gl.getShaderParameter(this._fragmentShader, WebGLEnum.COMPILE_STATUS)) {
            this._error = gl.getShaderInfoLog(this._fragmentShader);
            console.error(new Error(`Compile shader failed: ${this._error}`));
          } else {
            this._error = gl.getProgramInfoLog(this._object);
            console.error(new Error(`Load program failed: \n${this._error}`));
          }
        }
      }
      gl.deleteShader(this._vertexShader);
      this._vertexShader = null;
      gl.deleteShader(this._fragmentShader);
      this._fragmentShader = null;
      if (this._error) {
        gl.deleteProgram(this._object);
        this._object = null;
        return false;
      }
      this._device.context._currentProgram = this;
      this._device.context.useProgram(this._object);
      this._uniformSetters = this.createUniformSetters();
    } else {
      this._device.context._currentProgram = this;
      this._device.context.useProgram(this._object);
    }
    return true;
  }
  private createUniformSetter(info: ProgramUniformInfo) {
    const loc = info.location;
    const isArray = info.isArray;
    const gl = this._device.context;
    switch (info.type) {
      case WebGLEnum.FLOAT:
        return this.getUniformSetterfv(loc);
      case WebGLEnum.FLOAT_VEC2:
        return this.getUniformSetter2fv(loc);
      case WebGLEnum.FLOAT_VEC3:
        return this.getUniformSetter3fv(loc);
      case WebGLEnum.FLOAT_VEC4:
        return this.getUniformSetter4fv(loc);
      case WebGLEnum.INT:
        return this.getUniformSetteriv(loc);
      case WebGLEnum.INT_VEC2:
        return this.getUniformSetter2iv(loc);
      case WebGLEnum.INT_VEC3:
        return this.getUniformSetter3iv(loc);
      case WebGLEnum.INT_VEC4:
        return this.getUniformSetter4iv(loc);
      case WebGLEnum.UNSIGNED_INT:
        return this.getUniformSetteruiv(loc);
      case WebGLEnum.UNSIGNED_INT_VEC2:
        return this.getUniformSetter2uiv(loc);
      case WebGLEnum.UNSIGNED_INT_VEC3:
        return this.getUniformSetter3uiv(loc);
      case WebGLEnum.UNSIGNED_INT_VEC4:
        return this.getUniformSetter4uiv(loc);
      case WebGLEnum.BOOL:
        return this.getUniformSetteriv(loc);
      case WebGLEnum.BOOL_VEC2:
        return this.getUniformSetter2iv(loc);
      case WebGLEnum.BOOL_VEC3:
        return this.getUniformSetter3iv(loc);
      case WebGLEnum.BOOL_VEC4:
        return this.getUniformSetter4iv(loc);
      case WebGLEnum.FLOAT_MAT2:
        return this.getUniformSetterMatrix2(loc);
      case WebGLEnum.FLOAT_MAT2x3:
        return this.getUniformSetterMatrix23(loc);
      case WebGLEnum.FLOAT_MAT2x4:
        return this.getUniformSetterMatrix24(loc);
      case WebGLEnum.FLOAT_MAT3:
        return this.getUniformSetterMatrix3(loc);
      case WebGLEnum.FLOAT_MAT3x2:
        return this.getUniformSetterMatrix32(loc);
      case WebGLEnum.FLOAT_MAT3x4:
        return this.getUniformSetterMatrix34(loc);
      case WebGLEnum.FLOAT_MAT4:
        return this.getUniformSetterMatrix4(loc);
      case WebGLEnum.FLOAT_MAT4x2:
        return this.getUniformSetterMatrix42(loc);
      case WebGLEnum.FLOAT_MAT4x3:
        return this.getUniformSetterMatrix43(loc);
      case WebGLEnum.SAMPLER_2D:
      case WebGLEnum.SAMPLER_2D_SHADOW:
      case WebGLEnum.INT_SAMPLER_2D:
      case WebGLEnum.UNSIGNED_INT_SAMPLER_2D: {
        const unit = this._unitCounter;
        this._unitCounter += info.size;
        if (!isArray) {
          gl.uniform1i(loc, unit);
          return this.getSamplerSetter(loc, WebGLEnum.TEXTURE_2D, unit);
        }
      }
      case WebGLEnum.SAMPLER_2D_ARRAY:
      case WebGLEnum.SAMPLER_2D_ARRAY_SHADOW:
      case WebGLEnum.INT_SAMPLER_2D_ARRAY:
      case WebGLEnum.UNSIGNED_INT_SAMPLER_2D_ARRAY: {
        const unit = this._unitCounter;
        this._unitCounter += info.size;
        if (!isArray) {
          gl.uniform1i(loc, unit);
          return this.getSamplerSetter(loc, WebGLEnum.TEXTURE_2D_ARRAY, unit);
        }
      }
      case WebGLEnum.SAMPLER_CUBE:
      case WebGLEnum.SAMPLER_CUBE_SHADOW:
      case WebGLEnum.INT_SAMPLER_CUBE:
      case WebGLEnum.UNSIGNED_INT_SAMPLER_CUBE: {
        const unit = this._unitCounter;
        this._unitCounter += info.size;
        if (!isArray) {
          gl.uniform1i(loc, unit);
          return this.getSamplerSetter(loc, WebGLEnum.TEXTURE_CUBE_MAP, unit);
        }
      }
      case WebGLEnum.SAMPLER_3D:
      case WebGLEnum.INT_SAMPLER_3D:
      case WebGLEnum.UNSIGNED_INT_SAMPLER_3D: {
        const unit = this._unitCounter;
        this._unitCounter += info.size;
        if (!isArray) {
          gl.uniform1i(loc, unit);
          return this.getSamplerSetter(loc, WebGLEnum.TEXTURE_3D, unit);
        }
      }
    }
    console.error(`Error: unsupported uniform type: ${info.name}`);
    return null;
  }
  private createUniformSetters() {
    const uniformSetters = {};
    const gl = this._device.context;
    const numUniforms = gl.getProgramParameter(this._object, WebGLEnum.ACTIVE_UNIFORMS) as number;

    this._uniformInfo = [];
    for (let index = 0; index < numUniforms; index++) {
      const info = gl.getActiveUniform(this._object, index);
      let name = info.name;
      let isArray = false;
      if (name.startsWith('gl_') || name.startsWith('webgl_')) {
        this._uniformInfo.push(null);
      } else {
        if (name.substr(-3) === '[0]') {
          // is array
          name = name.substr(0, name.length - 3);
          isArray = true;
        }
        const size = info.size;
        const type = info.type;
        const blockIndex = -1;
        const offset = 0;
        const location = gl.getUniformLocation(this._object, info.name);
        const view = null;
        const { ctor: viewCtor, elementSize: viewElementSize } = this.getTypedArrayInfo(info.type);
        const uniformInfo = {
          index,
          name,
          size,
          type,
          blockIndex,
          offset,
          isArray,
          location,
          view,
          viewCtor,
          viewElementSize
        };
        this._uniformInfo.push(uniformInfo);
        if (location) {
          uniformSetters[name] = this.createUniformSetter(uniformInfo);
        }
      }
    }
    if (isWebGL2(gl)) {
      this._blockInfo = {};
      const numBlocks = gl.getProgramParameter(this._object, WebGLEnum.ACTIVE_UNIFORM_BLOCKS) as number;
      for (let i = 0; i < numBlocks; i++) {
        const name = gl.getActiveUniformBlockName(this._object, i);
        const index = gl.getUniformBlockIndex(this._object, name);
        const usedInVS = !!gl.getActiveUniformBlockParameter(
          this._object,
          i,
          WebGLEnum.UNIFORM_BLOCK_REFERENCED_BY_VERTEX_SHADER
        );
        const usedInFS = !!gl.getActiveUniformBlockParameter(
          this._object,
          i,
          WebGLEnum.UNIFORM_BLOCK_REFERENCED_BY_FRAGMENT_SHADER
        );
        const used = usedInVS || usedInFS;
        const size = gl.getActiveUniformBlockParameter(
          this._object,
          i,
          WebGLEnum.UNIFORM_BLOCK_DATA_SIZE
        ) as number;
        const uniformIndices = gl.getActiveUniformBlockParameter(
          this._object,
          i,
          WebGLEnum.UNIFORM_BLOCK_ACTIVE_UNIFORM_INDICES
        ) as Uint32Array<ArrayBuffer>;
        this._blockInfo[name] = { index, used, size, uniformIndices };
        gl.uniformBlockBinding(this._object, index, index);
      }
      /*
      const indices: number[] = this._uniformInfo.map(val => val.index);
      const types = gl.getActiveUniforms(this._object, indices, WebGLEnum.UNIFORM_TYPE);
      const sizes = gl.getActiveUniforms(this._object, indices, WebGLEnum.UNIFORM_SIZE);
      const blockIndices = gl.getActiveUniforms(this._object, indices, WebGLEnum.UNIFORM_BLOCK_INDEX);
      const offsets = gl.getActiveUniforms(this._object, indices, WebGLEnum.UNIFORM_OFFSET);
      this._uniformInfo.forEach((val, index) => {
        val.type = types[index];
        val.size = sizes[index];
        val.blockIndex = blockIndices[index];
        val.offset = offsets[index];
      });
      */
    }
    return uniformSetters;
  }
  private getUniformSetterfv(location: WebGLUniformLocation) {
    return (value: any) => {
      this._device.context.uniform1fv(location, value);
    };
  }
  private getUniformSetter2fv(location: WebGLUniformLocation) {
    return (value: any) => {
      this._device.context.uniform2fv(location, value);
    };
  }
  private getUniformSetter3fv(location: WebGLUniformLocation) {
    return (value: any) => {
      this._device.context.uniform3fv(location, value);
    };
  }
  private getUniformSetter4fv(location: WebGLUniformLocation) {
    return (value: any) => {
      this._device.context.uniform4fv(location, value);
    };
  }
  private getUniformSetteriv(location: WebGLUniformLocation) {
    return (value: any) => {
      this._device.context.uniform1iv(location, value);
    };
  }
  private getUniformSetter2iv(location: WebGLUniformLocation) {
    return (value: any) => {
      this._device.context.uniform2iv(location, value);
    };
  }
  private getUniformSetter3iv(location: WebGLUniformLocation) {
    return (value: any) => {
      this._device.context.uniform3iv(location, value);
    };
  }
  private getUniformSetter4iv(location: WebGLUniformLocation) {
    return (value: any) => {
      this._device.context.uniform4iv(location, value);
    };
  }
  private getUniformSetteruiv(location: WebGLUniformLocation) {
    return (value: any) => {
      (this._device.context as WebGL2RenderingContext).uniform1uiv(location, value);
    };
  }
  private getUniformSetter2uiv(location: WebGLUniformLocation) {
    return (value: any) => {
      (this._device.context as WebGL2RenderingContext).uniform2uiv(location, value);
    };
  }
  private getUniformSetter3uiv(location: WebGLUniformLocation) {
    return (value: any) => {
      (this._device.context as WebGL2RenderingContext).uniform3uiv(location, value);
    };
  }
  private getUniformSetter4uiv(location: WebGLUniformLocation) {
    return (value: any) => {
      (this._device.context as WebGL2RenderingContext).uniform4uiv(location, value);
    };
  }
  private getUniformSetterMatrix2(location: WebGLUniformLocation) {
    return (value: any) => {
      this._device.context.uniformMatrix2fv(location, false, value);
    };
  }
  private getUniformSetterMatrix23(location: WebGLUniformLocation) {
    return (value: any) => {
      (this._device.context as WebGL2RenderingContext).uniformMatrix2x3fv(location, false, value);
    };
  }
  private getUniformSetterMatrix24(location: WebGLUniformLocation) {
    return (value: any) => {
      (this._device.context as WebGL2RenderingContext).uniformMatrix2x4fv(location, false, value);
    };
  }
  private getUniformSetterMatrix32(location: WebGLUniformLocation) {
    return (value: any) => {
      (this._device.context as WebGL2RenderingContext).uniformMatrix3x2fv(location, false, value);
    };
  }
  private getUniformSetterMatrix3(location: WebGLUniformLocation) {
    return (value: any) => {
      (this._device.context as WebGL2RenderingContext).uniformMatrix3fv(location, false, value);
    };
  }
  private getUniformSetterMatrix34(location: WebGLUniformLocation) {
    return (value: any) => {
      (this._device.context as WebGL2RenderingContext).uniformMatrix3x4fv(location, false, value);
    };
  }
  private getUniformSetterMatrix42(location: WebGLUniformLocation) {
    return (value: any) => {
      (this._device.context as WebGL2RenderingContext).uniformMatrix4x2fv(location, false, value);
    };
  }
  private getUniformSetterMatrix43(location: WebGLUniformLocation) {
    return (value: any) => {
      (this._device.context as WebGL2RenderingContext).uniformMatrix4x3fv(location, false, value);
    };
  }
  private getUniformSetterMatrix4(location: WebGLUniformLocation) {
    return (value: any) => {
      this._device.context.uniformMatrix4fv(location, false, value);
    };
  }
  private getSamplerSetter(location: WebGLUniformLocation, target: number, unit: number) {
    return (texture: [WebGLBaseTexture, WebGLTextureSampler]) =>
      this._device.bindTexture(target, unit, texture[0], texture[1]);
    /*
    const gl = this._device.context;
    return isWebGL2(gl)
      ? (texture: [WebGLBaseTexture, WebGLTextureSampler]) => {
          const tex = texture?.[0].object ?? null;
          const sampler = texture?.[1].object ?? null;
          //gl.uniform1i(location, unit);
          gl.activeTexture(this._device.context.TEXTURE0 + unit);
          gl.bindTexture(target, tex);
          gl.bindSampler(unit, sampler);
        }
      : (texture: [WebGLBaseTexture, WebGLTextureSampler]) => {
          const tex = texture?.[0] ?? null;
          const sampler = texture?.[1] ?? null;
          //gl.uniform1i(location, unit);
          gl.activeTexture(this._device.context.TEXTURE0 + unit);
          gl.bindTexture(target, tex?.object ?? null);
          if (tex && sampler && this._device.getCurrentSamplerForTexture(tex) !== sampler) {
            const fallback = tex.isWebGL1Fallback;
            this._device.setCurrentSamplerForTexture(tex, sampler);
            gl.texParameteri(
              target,
              WebGLEnum.TEXTURE_WRAP_S,
              textureWrappingMap[false && fallback ? 'clamp' : sampler.addressModeU]
            );
            gl.texParameteri(
              target,
              WebGLEnum.TEXTURE_WRAP_T,
              textureWrappingMap[false && fallback ? 'clamp' : sampler.addressModeV]
            );
            gl.texParameteri(
              target,
              WebGLEnum.TEXTURE_MAG_FILTER,
              textureMagFilterToWebGL(sampler.magFilter)
            );
            gl.texParameteri(
              target,
              WebGLEnum.TEXTURE_MIN_FILTER,
              textureMinFilterToWebGL(sampler.minFilter, tex.isWebGL1Fallback ? 'none' : sampler.mipFilter)
            );
            if (this._device.getDeviceCaps().textureCaps.supportAnisotropicFiltering) {
              gl.texParameterf(target, WebGLEnum.TEXTURE_MAX_ANISOTROPY, sampler.maxAnisotropy);
            }
          }
        };
    */
  }
  private getTypedArrayInfo(type: number): {
    ctor: TypedArrayConstructor<UniformBlockArray>;
    elementSize: number;
  } {
    let ctor: TypedArrayConstructor<UniformBlockArray> = null;
    let elementSize = 0;
    switch (type) {
      case WebGLEnum.INT:
        ctor = Int32Array;
        elementSize = 4;
        break;
      case WebGLEnum.INT_VEC2:
        ctor = Int32Array;
        elementSize = 8;
        break;
      case WebGLEnum.INT_VEC3:
        ctor = Int32Array;
        elementSize = 12;
        break;
      case WebGLEnum.INT_VEC4:
        ctor = Int32Array;
        elementSize = 16;
        break;
      case WebGLEnum.UNSIGNED_INT:
      case WebGLEnum.BOOL:
        ctor = Uint32Array;
        elementSize = 4;
        break;
      case WebGLEnum.UNSIGNED_INT_VEC2:
      case WebGLEnum.BOOL_VEC2:
        ctor = Uint32Array;
        elementSize = 8;
        break;
      case WebGLEnum.UNSIGNED_INT_VEC3:
      case WebGLEnum.BOOL_VEC3:
        ctor = Uint32Array;
        elementSize = 12;
        break;
      case WebGLEnum.UNSIGNED_INT_VEC4:
      case WebGLEnum.BOOL_VEC4:
        ctor = Uint32Array;
        elementSize = 16;
        break;
      case WebGLEnum.FLOAT:
        ctor = Float32Array;
        elementSize = 4;
        break;
      case WebGLEnum.FLOAT_VEC2:
        ctor = Float32Array;
        elementSize = 8;
        break;
      case WebGLEnum.FLOAT_VEC3:
        ctor = Float32Array;
        elementSize = 12;
        break;
      case WebGLEnum.FLOAT_VEC4:
      case WebGLEnum.FLOAT_MAT2:
        ctor = Float32Array;
        elementSize = 16;
        break;
      case WebGLEnum.FLOAT_MAT2x3:
      case WebGLEnum.FLOAT_MAT3x2:
        ctor = Float32Array;
        elementSize = 24;
        break;
      case WebGLEnum.FLOAT_MAT2x4:
      case WebGLEnum.FLOAT_MAT4x2:
        ctor = Float32Array;
        elementSize = 32;
        break;
      case WebGLEnum.FLOAT_MAT3:
        ctor = Float32Array;
        elementSize = 36;
        break;
      case WebGLEnum.FLOAT_MAT3x4:
      case WebGLEnum.FLOAT_MAT4x3:
        ctor = Float32Array;
        elementSize = 48;
        break;
      case WebGLEnum.FLOAT_MAT4:
        ctor = Float32Array;
        elementSize = 64;
        break;
    }
    return { ctor, elementSize };
  }
}
