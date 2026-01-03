import type {
  StructuredValue,
  PBStructTypeInfo,
  BindGroupLayout,
  BaseTexture,
  TextureSampler,
  BindGroup,
  BindGroupLayoutEntry,
  GPUDataBuffer
} from '@zephyr3d/device';
import { GPUResourceUsageFlags } from '@zephyr3d/device';
import { WebGLStructuredBuffer } from './structuredbuffer_webgl';
import { WebGLGPUObject } from './gpuobject_webgl';
import type { WebGLBaseTexture } from './basetexture_webgl';
import type { WebGLGPUProgram } from './gpuprogram_webgl';
import type { WebGLTextureSampler } from './sampler_webgl';
import type { Immutable, Nullable, TypedArray } from '@zephyr3d/base';
import type { WebGLDevice } from './device_webgl';
import { WebGLGPUBuffer } from './buffer_webgl';

export class WebGLBindGroup extends WebGLGPUObject<unknown> implements BindGroup {
  private readonly _layout: Immutable<BindGroupLayout>;
  private _dynamicOffsets: Nullable<number[]>;
  private _resources: Record<string, WebGLGPUBuffer | [WebGLBaseTexture, WebGLTextureSampler]>;
  private _createdBuffers: WebGLGPUBuffer[];
  constructor(device: WebGLDevice, layout: Immutable<BindGroupLayout>) {
    super(device);
    this._device = device;
    this._layout = layout;
    this._dynamicOffsets = null;
    this._resources = {};
    this._object = {};
    this._createdBuffers = [];
    for (const entry of this._layout.entries) {
      if (entry.buffer && entry.buffer.hasDynamicOffset) {
        if (!this._dynamicOffsets) {
          this._dynamicOffsets = [];
        }
        this._dynamicOffsets[entry.buffer.dynamicOffsetIndex] = 0;
      }
    }
  }
  getGPUId() {
    return String(this._uid);
  }
  getLayout(): Immutable<BindGroupLayout> {
    return this._layout;
  }
  getBuffer(name: string, nocreate = true) {
    return this._getBuffer(name, nocreate);
  }
  getDynamicOffsets(): Nullable<Immutable<number[]>> {
    return this._dynamicOffsets;
  }
  setBuffer(name: string, buffer: GPUDataBuffer, offset?: number, _bindOffset?: number, _bindSize?: number) {
    const bindName = this._layout.nameMap?.[name] ?? name;
    for (const entry of this._layout.entries) {
      if (entry.name === bindName) {
        if (!entry.buffer) {
          console.error(`setBuffer() failed: resource '${name}' is not buffer`);
        } else {
          if (buffer && !(buffer.usage & GPUResourceUsageFlags.BF_UNIFORM)) {
            console.error(
              `setBuffer() failed: buffer resource '${name}' must be type '${entry.buffer.type}'`
            );
          } else if (buffer !== this._resources[entry.name]) {
            this._resources[entry.name] = buffer as WebGLGPUBuffer;
          }
          if (entry.buffer.hasDynamicOffset) {
            this._dynamicOffsets![entry.buffer.dynamicOffsetIndex] = offset ?? 0;
          }
        }
        return;
      }
    }
    console.error(`setBuffer() failed: no buffer resource named '${name}'`);
  }
  setRawData(name: string, byteOffset: number, data: TypedArray, srcPos?: number, srcLength?: number) {
    const mappedName = this._layout.nameMap?.[name];
    if (mappedName) {
      this.setRawData(mappedName, byteOffset, data, srcPos, srcLength);
    } else {
      const buffer = this._getBuffer(name, false);
      if (buffer) {
        buffer.bufferSubData(byteOffset, data, srcPos, srcLength);
      } else {
        console.error(`set(): no uniform buffer named '${name}'`);
      }
    }
  }
  setValue(name: string, value: StructuredValue) {
    const mappedName = this._layout.nameMap?.[name];
    if (mappedName) {
      this.setValue(mappedName, { [name]: value });
    } else {
      const buffer = this._getBuffer(name, false);
      if (buffer) {
        if (!(buffer instanceof WebGLStructuredBuffer)) {
          throw new Error(`BindGroup.setValue() failed: '${name}' is not structured buffer`);
        }
        if ((value as TypedArray)?.BYTES_PER_ELEMENT) {
          buffer.bufferSubData(0, value as TypedArray);
        } else {
          for (const k in value as any) {
            buffer.set(k, value[k]);
          }
        }
      } else {
        console.error(`set(): no uniform buffer named '${name}'`);
      }
    }
  }
  setTextureView(
    _name: string,
    _value: BaseTexture,
    _level?: number,
    _face?: number,
    _mipCount?: number,
    _sampler?: Nullable<TextureSampler>
  ) {
    throw new Error('setTextureView() not supported for webgl device');
  }
  getTexture(name: string): Nullable<BaseTexture> {
    const entry = this._findTextureLayout(name);
    if (entry) {
      return (this._resources[name]?.[0] as BaseTexture) || null;
    } else {
      throw new Error(`getTexture() failed:${name} is not a texture`);
    }
  }
  setTexture(name: string, texture: BaseTexture, sampler?: Nullable<TextureSampler>) {
    const entry = this._findTextureLayout(name);
    if (entry) {
      this._resources[name] = [
        texture as unknown as WebGLBaseTexture,
        (sampler ||
          texture.getDefaultSampler(!!entry.texture?.autoBindSamplerComparison)) as WebGLTextureSampler
      ];
    } else {
      console.error(`setTexture() failed: no texture uniform named '${name}'`);
    }
  }
  setSampler(_name: string, _value: TextureSampler) {
    // no sampler uniform support for webgl
  }
  apply(program: WebGLGPUProgram, offsets?: Nullable<Iterable<number>>) {
    const webgl2 = this._device.isWebGL2;
    const dynamicOffsets = offsets ?? this.getDynamicOffsets();
    for (let i = 0; i < this._layout.entries.length; i++) {
      const entry = this._layout.entries[i];
      const res = this._resources[entry.name];
      if (res instanceof WebGLGPUBuffer) {
        if (webgl2) {
          if (entry.buffer!.hasDynamicOffset) {
            program.setBlock(
              (entry.type as PBStructTypeInfo).structName!,
              res,
              dynamicOffsets![entry.buffer!.dynamicOffsetIndex]
            );
          } else {
            program.setBlock((entry.type as PBStructTypeInfo).structName!, res, 0);
          }
        } else if (res instanceof WebGLStructuredBuffer) {
          program.setUniform(entry.name, res.getUniformData().uniforms);
        }
      } else if (Array.isArray(res)) {
        if (res[0].isTextureVideo()) {
          res[0].updateVideoFrame();
        }
        // res[0].sampler = res[1];
        program.setUniform(entry.name, res);
      }
    }
  }
  destroy() {
    this._resources = {};
    this._object = null;
    for (const buffer of this._createdBuffers) {
      buffer.dispose();
    }
    this._createdBuffers = [];
  }
  restore() {
    this._object = {};
  }
  isBindGroup(): this is BindGroup {
    return true;
  }
  private _getBuffer(name: string, nocreate = false) {
    const bindName = this._layout.nameMap?.[name] ?? name;
    for (const entry of this._layout.entries) {
      if (entry.buffer && entry.name === bindName) {
        let buffer = this._resources[entry.name];
        if (!buffer && !nocreate) {
          buffer = this._device.createStructuredBuffer(entry.type as PBStructTypeInfo, {
            usage: 'uniform'
          }) as WebGLStructuredBuffer;
          this._resources[entry.name] = buffer;
          this._createdBuffers.push(buffer);
        }
        return buffer as GPUDataBuffer;
      }
    }
    return null;
  }
  private _findTextureLayout(name: string): Nullable<Immutable<BindGroupLayoutEntry>> {
    for (const entry of this._layout.entries) {
      if ((entry.texture || entry.storageTexture || entry.externalTexture) && entry.name === name) {
        return entry;
      }
    }
    return null;
  }
}
