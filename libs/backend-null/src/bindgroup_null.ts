import type { Immutable, Nullable, TypedArray } from '@zephyr3d/base';
import type {
  BaseTexture,
  BindGroup,
  BindGroupLayout,
  BindGroupLayoutEntry,
  GPUDataBuffer,
  PBStructTypeInfo,
  StructuredValue,
  TextureSampler
} from '@zephyr3d/device';
import { NullGPUObject } from './gpuobject_null';
import type { NullGPUBuffer } from './buffer_null';
import { NullStructuredBuffer } from './structuredbuffer_null';
import type { NullDevice } from './device_null';

/**
 * A texture binding of a null device bind group
 * @public
 */
export type NullTextureBinding = {
  texture: BaseTexture;
  sampler: Nullable<TextureSampler>;
  level?: number;
  face?: number;
  mipCount?: number;
};

/**
 * A buffer binding of a null device bind group
 * @public
 */
export type NullBufferBinding = {
  buffer: GPUDataBuffer;
  bindOffset: number;
  bindSize: number;
};

/**
 * Bind group of a null device
 *
 * @remarks
 * The bind group keeps the resources it was given so tests can assert what a
 * material or render pass actually bound.
 *
 * @public
 */
export class NullBindGroup extends NullGPUObject<unknown> implements BindGroup {
  /** @internal */
  private readonly _layout: Immutable<BindGroupLayout>;
  /** @internal */
  private _dynamicOffsets: Nullable<number[]>;
  /** @internal */
  private readonly _buffers: Record<string, NullBufferBinding>;
  /** @internal */
  private readonly _textures: Record<string, NullTextureBinding>;
  /** @internal */
  private readonly _samplers: Record<string, TextureSampler>;
  /** @internal */
  private readonly _createdBuffers: NullGPUBuffer[];
  /** @internal */
  private _version: number;
  constructor(device: NullDevice, layout: Immutable<BindGroupLayout>) {
    super(device);
    this._layout = layout;
    this._dynamicOffsets = null;
    this._buffers = {};
    this._textures = {};
    this._samplers = {};
    this._createdBuffers = [];
    this._version = 0;
    this._object = this._createFakeObject();
    for (const entry of this._layout.entries) {
      if (entry.buffer && entry.buffer.hasDynamicOffset) {
        if (!this._dynamicOffsets) {
          this._dynamicOffsets = [];
        }
        this._dynamicOffsets[entry.buffer.dynamicOffsetIndex] = 0;
      }
    }
  }
  getLayout(): Immutable<BindGroupLayout> {
    return this._layout;
  }
  getDynamicOffsets(): Nullable<Immutable<number[]>> {
    return this._dynamicOffsets;
  }
  getVersion() {
    return `${this._uid}:${this._version}`;
  }
  getGPUId() {
    return String(this._uid);
  }
  /** Invalidates the bind group, bumping its version */
  invalidate() {
    this._version++;
  }
  getBuffer(name: string, nocreate = true) {
    return this._getBuffer(name, nocreate);
  }
  setBuffer(name: string, buffer: GPUDataBuffer, offset?: number, bindOffset?: number, bindSize?: number) {
    const bindName = this._layout.nameMap?.[name] ?? name;
    for (const entry of this._layout.entries) {
      if (entry.name === bindName) {
        if (!entry.buffer) {
          console.error(`setBuffer() failed: resource '${name}' is not buffer`);
        } else if (!buffer) {
          console.error(`setBuffer() failed: buffer resource '${name}' is null`);
        } else {
          bindOffset = bindOffset ?? 0;
          bindSize = bindSize ?? Math.max(0, buffer.byteLength - bindOffset);
          const info = this._buffers[entry.name];
          if (info?.buffer !== buffer || info?.bindOffset !== bindOffset || info?.bindSize !== bindSize) {
            this._buffers[entry.name] = { buffer, bindOffset, bindSize };
            this.invalidate();
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
  setValue(name: string, value: StructuredValue) {
    const mappedName = this._layout.nameMap?.[name];
    if (mappedName) {
      this.setValue(mappedName, { [name]: value });
    } else {
      const buffer = this._getBuffer(name, false);
      if (buffer) {
        if (!(buffer instanceof NullStructuredBuffer)) {
          throw new Error(`BindGroup.setValue() failed: '${name}' is not structured buffer`);
        }
        if (typeof value === 'number') {
          throw new Error(`BindGroup.setValue() failed: cannot set ${value} to '${name}'`);
        }
        if ('BYTES_PER_ELEMENT' in value) {
          buffer.bufferSubData(0, value as TypedArray);
        } else {
          for (const k in value) {
            buffer.set(k, (value as Record<string, StructuredValue>)[k]);
          }
        }
      } else {
        console.error(`setValue(): no uniform buffer named '${name}'`);
      }
    }
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
        console.error(`setRawData(): no uniform buffer named '${name}'`);
      }
    }
  }
  getTexture(name: string): Nullable<BaseTexture> {
    const entry = this._findTextureLayout(name);
    if (entry) {
      return this._textures[name]?.texture ?? null;
    }
    throw new Error(`getTexture() failed: ${name} is not a texture`);
  }
  setTexture(name: string, texture: BaseTexture, sampler?: Nullable<TextureSampler>) {
    const entry = this._findTextureLayout(name);
    if (entry) {
      this._textures[name] = {
        texture,
        sampler: sampler ?? texture?.getDefaultSampler(!!entry.texture?.autoBindSamplerComparison) ?? null
      };
      this.invalidate();
    } else {
      console.error(`setTexture() failed: no texture uniform named '${name}'`);
    }
  }
  setTextureView(
    name: string,
    value: BaseTexture,
    level?: number,
    face?: number,
    mipCount?: number,
    sampler?: Nullable<TextureSampler>
  ) {
    const entry = this._findTextureLayout(name);
    if (entry) {
      this._textures[name] = {
        texture: value,
        sampler: sampler ?? value?.getDefaultSampler(!!entry.texture?.autoBindSamplerComparison) ?? null,
        level: level ?? 0,
        face: face ?? 0,
        mipCount: mipCount ?? 1
      };
      this.invalidate();
    } else {
      console.error(`setTextureView() failed: no texture uniform named '${name}'`);
    }
  }
  setSampler(name: string, sampler: TextureSampler) {
    for (const entry of this._layout.entries) {
      if (entry.sampler && entry.name === name) {
        this._samplers[name] = sampler;
        this.invalidate();
        return;
      }
    }
    console.error(`setSampler() failed: no sampler uniform named '${name}'`);
  }
  /** Gets the sampler bound to a sampler uniform */
  getSampler(name: string): Nullable<TextureSampler> {
    return this._samplers[name] ?? null;
  }
  /** Gets the full texture binding, including view parameters and sampler */
  getTextureBinding(name: string): Nullable<NullTextureBinding> {
    return this._textures[name] ?? null;
  }
  /** Gets the full buffer binding, including bind offset and size */
  getBufferBinding(name: string): Nullable<NullBufferBinding> {
    const bindName = this._layout.nameMap?.[name] ?? name;
    return this._buffers[bindName] ?? null;
  }
  isBindGroup(): this is BindGroup {
    return true;
  }
  destroy() {
    for (const buffer of this._createdBuffers) {
      buffer.dispose();
    }
    this._createdBuffers.length = 0;
    this._object = null;
  }
  restore() {
    this._object = this._createFakeObject();
  }
  /** @internal */
  private _getBuffer(name: string, nocreate = false): Nullable<GPUDataBuffer> {
    const bindName = this._layout.nameMap?.[name] ?? name;
    for (const entry of this._layout.entries) {
      if (entry.buffer && entry.name === bindName) {
        let info = this._buffers[entry.name];
        if (!info && !nocreate) {
          const buffer = this._device.createStructuredBuffer(entry.type as PBStructTypeInfo, {
            usage: entry.buffer.type === 'uniform' ? 'uniform' : undefined,
            storage: entry.buffer.type !== 'uniform'
          }) as NullStructuredBuffer;
          info = { buffer, bindOffset: 0, bindSize: buffer.byteLength };
          this._buffers[entry.name] = info;
          this._createdBuffers.push(buffer);
          this.invalidate();
        }
        return info?.buffer ?? null;
      }
    }
    return null;
  }
  /** @internal */
  private _findTextureLayout(name: string): Nullable<Immutable<BindGroupLayoutEntry>> {
    for (const entry of this._layout.entries) {
      if ((entry.texture || entry.storageTexture || entry.externalTexture) && entry.name === name) {
        return entry;
      }
    }
    return null;
  }
}
