import type {
  BufferCreationOptions,
  StructuredValue,
  TextureVideo,
  PBStructTypeInfo,
  BindGroupLayout,
  BaseTexture,
  TextureSampler,
  BindGroup,
  BindGroupLayoutEntry,
  GPUDataBuffer
} from '@zephyr3d/device';
import { GPUResourceUsageFlags } from '@zephyr3d/device';
import { WebGPUStructuredBuffer } from './structuredbuffer_webgpu';
import type { WebGPUBaseTexture } from './basetexture_webgpu';
import type { WebGPUTextureVideo } from './texturevideo_webgpu';
import type { WebGPUTextureSampler } from './sampler_webgpu';
import { WebGPUObject } from './gpuobject_webgpu';
import type { TypedArray } from '@zephyr3d/base';
import type { WebGPUDevice } from './device';
import type { WebGPUBuffer } from './buffer_webgpu';

export class WebGPUBindGroup extends WebGPUObject<unknown> implements BindGroup {
  private _layout: BindGroupLayout;
  private _layoutDesc: GPUBindGroupLayoutDescriptor;
  private _entries: GPUBindGroupEntry[];
  private _bindGroup: GPUBindGroup;
  private _buffers: WebGPUBuffer[];
  private _textures: WebGPUBaseTexture[];
  private _gpuId: number;
  private _videoTextures: WebGPUTextureVideo[];
  private _dynamicOffsets: number[];
  private _resources: {
    [name: string]:
      | [WebGPUBuffer, number, number]
      | WebGPUTextureVideo
      | [WebGPUBaseTexture, GPUTextureView]
      | GPUSampler;
  };
  constructor(device: WebGPUDevice, layout: BindGroupLayout) {
    super(device);
    this._device = device;
    this._layout = layout;
    this._layoutDesc = null;
    this._entries = null;
    this._bindGroup = null;
    this._dynamicOffsets = null;
    this._gpuId = 0;
    this._resources = {};
    this._buffers = [];
    this._textures = [];
    this._videoTextures = null;
    for (const entry of this._layout.entries) {
      if (entry.buffer && entry.buffer.hasDynamicOffset) {
        if (!this._dynamicOffsets) {
          this._dynamicOffsets = [];
        }
        this._dynamicOffsets[entry.buffer.dynamicOffsetIndex] = 0;
      }
    }
  }
  get bindGroup() {
    if (!this._bindGroup) {
      this._bindGroup = this._create();
    }
    return this._bindGroup;
  }
  get layoutDescriptor(): GPUBindGroupLayoutDescriptor {
    if (!this._bindGroup) {
      this._bindGroup = this._create();
    }
    return this._layoutDesc;
  }
  get entries(): GPUBindGroupEntry[] {
    if (!this._bindGroup) {
      this._bindGroup = this._create();
    }
    return this._entries;
  }
  getGPUId(): string {
    return `${this._uid}:${this._gpuId}`;
  }
  get bufferList(): WebGPUBuffer[] {
    return this._buffers;
  }
  get textureList(): WebGPUBaseTexture[] {
    return this._textures;
  }
  invalidate() {
    this._bindGroup = null;
    this._gpuId++;
  }
  getLayout(): BindGroupLayout {
    return this._layout;
  }
  getDynamicOffsets(): number[] {
    return this._dynamicOffsets;
  }
  getBuffer(name: string): GPUDataBuffer {
    return this._getBuffer(name, GPUResourceUsageFlags.BF_UNIFORM | GPUResourceUsageFlags.BF_STORAGE, true);
  }
  setBuffer(name: string, buffer: GPUDataBuffer, offset?: number, bindOffset?: number, bindSize?: number) {
    const bindName = this._layout.nameMap?.[name] ?? name;
    for (const entry of this._layout.entries) {
      if (entry.name === bindName) {
        if (!entry.buffer) {
          console.log(`setBuffer() failed: resource '${name}' is not buffer`);
        } else {
          bindOffset = bindOffset ?? 0;
          bindSize = bindSize ?? (buffer ? Math.max(0, buffer.byteLength - bindOffset) : 0);
          const info = this._resources[entry.name] as [WebGPUBuffer, number, number];
          const bufferUsage =
            entry.buffer.type === 'uniform'
              ? GPUResourceUsageFlags.BF_UNIFORM
              : GPUResourceUsageFlags.BF_STORAGE;
          if (!buffer || !(buffer.usage & bufferUsage)) {
            console.log(`setBuffer() failed: buffer resource '${name}' must be type '${entry.buffer.type}'`);
          } else if (buffer !== info?.[0] || bindOffset !== info?.[1] || bindSize !== info?.[2]) {
            this._resources[entry.name] = [buffer as WebGPUBuffer, bindOffset, bindSize];
            this.invalidate();
          }
          if (entry.buffer.hasDynamicOffset) {
            this._dynamicOffsets[entry.buffer.dynamicOffsetIndex] = offset ?? 0;
          }
        }
        return;
      }
    }
    console.log(`setBuffer() failed: no buffer resource named '${name}'`);
  }
  setValue(name: string, value: StructuredValue) {
    const mappedName = this._layout.nameMap?.[name];
    if (mappedName) {
      this.setValue(mappedName, { [name]: value });
    } else {
      const buffer = this._getBuffer(
        name,
        GPUResourceUsageFlags.BF_UNIFORM | GPUResourceUsageFlags.BF_STORAGE,
        false
      );
      if (buffer) {
        if (!(buffer instanceof WebGPUStructuredBuffer)) {
          throw new Error(`BindGroup.setValue() failed: '${name}' is not structured buffer`);
        }
        if ((value as any)?.BYTES_PER_ELEMENT) {
          buffer.bufferSubData(0, value as TypedArray);
        } else {
          for (const k in value as any) {
            buffer.set(k, value[k]);
          }
        }
      } else {
        console.log(`setValue() failed: no uniform buffer named '${name}'`);
      }
    }
  }
  setRawData(name: string, byteOffset: number, data: TypedArray, srcPos?: number, srcLength?: number) {
    const mappedName = this._layout.nameMap?.[name];
    if (mappedName) {
      this.setRawData(mappedName, byteOffset, data, srcPos, srcLength);
    } else {
      const buffer = this._getBuffer(
        name,
        GPUResourceUsageFlags.BF_UNIFORM | GPUResourceUsageFlags.BF_STORAGE,
        false
      );
      if (buffer) {
        buffer.bufferSubData(byteOffset, data, srcPos, srcLength);
      } else {
        console.log(`set(): no uniform buffer named '${name}'`);
      }
    }
  }
  getTexture(name: string): BaseTexture {
    const entry = this._findTextureLayout(name);
    if (entry) {
      const t = this._resources[name] as [WebGPUBaseTexture, GPUTextureView];
      return t ? t[0] : null;
    } else {
      throw new Error(`getTexture() failed:${name} is not a texture`);
    }
  }
  setTextureView(
    name: string,
    value: BaseTexture,
    level?: number,
    face?: number,
    mipCount?: number,
    sampler?: TextureSampler
  ) {
    if (!value) {
      throw new Error(`WebGPUBindGroup.setTextureView() failed: invalid texture uniform value: ${value}`);
    } else {
      const entry = this._findTextureLayout(name);
      if (entry) {
        if (entry.externalTexture) {
          throw new Error(`WebGPUBindGroup.setTextureView() failed: video texture does not have view`);
        } else if (value.isTextureVideo()) {
          throw new Error(`WebGPUBindGroup.setTextureView() failed: invalid texture type`);
        }
        const t = this._resources[name] as [WebGPUBaseTexture, GPUTextureView];
        const view = (value as WebGPUBaseTexture).getView(level, face, mipCount);
        if (!t || t[1] !== view) {
          this._resources[name] = [value as WebGPUBaseTexture, view];
          this.invalidate();
        }
        if (entry.texture?.autoBindSampler) {
          const samplerEntry = this._findSamplerLayout(entry.texture.autoBindSampler);
          if (!samplerEntry || !samplerEntry.sampler) {
            throw new Error(
              `WebGPUBindGroup.setTextureView() failed: sampler entry not found: ${entry.texture.autoBindSampler}`
            );
          }
          const s = (
            !sampler || sampler.compare ? value.getDefaultSampler(false) : sampler
          ) as WebGPUTextureSampler;
          if (s.object !== this._resources[entry.texture.autoBindSampler]) {
            this._resources[entry.texture.autoBindSampler] = s.object;
            this.invalidate();
          }
        }
        if (entry.texture?.autoBindSamplerComparison) {
          const samplerEntry = this._findSamplerLayout(entry.texture.autoBindSamplerComparison);
          if (!samplerEntry || !samplerEntry.sampler) {
            throw new Error(
              `WebGPUBindGroup.setTextureView() failed: sampler entry not found: ${entry.texture.autoBindSamplerComparison}`
            );
          }
          const s = (
            !sampler || !sampler.compare ? value.getDefaultSampler(true) : sampler
          ) as WebGPUTextureSampler;
          if (s.object !== this._resources[entry.texture.autoBindSamplerComparison]) {
            this._resources[entry.texture.autoBindSamplerComparison] = s.object;
            this.invalidate();
          }
        }
      } else {
        throw new Error(`WebGPUBindGroup.setView() failed: no texture uniform named '${name}'`);
      }
    }
  }
  setTexture(name: string, value: BaseTexture | TextureVideo, sampler?: TextureSampler) {
    if (!value) {
      throw new Error(`WebGPUBindGroup.setTexture() failed: invalid texture uniform value: ${value}`);
    } else {
      const entry = this._findTextureLayout(name);
      if (entry) {
        const t = this._resources[name];
        if (entry.externalTexture) {
          if (!value.isTextureVideo()) {
            throw new Error(
              `WebGPUBindGroup.setTexture() failed: invalid texture type of resource '${name}'`
            );
          }
          if (!t || t !== value) {
            if (t) {
              (t as WebGPUTextureVideo).removeBindGroupReference(this);
            }
            if (value) {
              (value as WebGPUTextureVideo).addBindGroupReference(this);
            }
            this._resources[name] = value as WebGPUTextureVideo;
            this.invalidate();
            this._videoTextures = [];
            for (const entry of this._layout.entries) {
              if (entry.externalTexture) {
                const tex = this._resources[entry.name] as WebGPUTextureVideo;
                if (tex && this._videoTextures.indexOf(tex) < 0) {
                  this._videoTextures.push(tex);
                }
              }
            }
          }
        } else {
          if (value.isTextureVideo()) {
            throw new Error(
              `WebGPUBindGroup.setTexture() failed: invalid texture type of resource '${name}'`
            );
          }
          const view = (value as WebGPUBaseTexture).getDefaultView();
          if (!entry.externalTexture && !view) {
            throw new Error('WebGPUBindGroup.setTexture() failed: create texture view failed');
          }
          if (!t || t[0] !== value) {
            this._resources[name] = [value as WebGPUBaseTexture, view];
            this.invalidate();
          }
        }
        const autoBindSampler = entry.texture?.autoBindSampler || entry.externalTexture?.autoBindSampler;
        if (autoBindSampler) {
          const samplerEntry = this._findSamplerLayout(autoBindSampler);
          if (!samplerEntry || !samplerEntry.sampler) {
            throw new Error(
              `WebGPUBindGroup.setTexture() failed: sampler entry not found: ${autoBindSampler}`
            );
          }
          const s = (
            !sampler || sampler.compare ? value.getDefaultSampler(false) : sampler
          ) as WebGPUTextureSampler;
          if (s.object !== this._resources[autoBindSampler]) {
            this._resources[autoBindSampler] = s.object;
            this.invalidate();
          }
        }
        const autoBindSamplerComparison = entry.texture?.autoBindSamplerComparison;
        if (autoBindSamplerComparison) {
          const samplerEntry = this._findSamplerLayout(autoBindSamplerComparison);
          if (!samplerEntry || !samplerEntry.sampler) {
            throw new Error(
              `WebGPUBindGroup.setTexture() failed: sampler entry not found: ${autoBindSamplerComparison}`
            );
          }
          const s = (
            !sampler || !sampler.compare ? value.getDefaultSampler(true) : sampler
          ) as WebGPUTextureSampler;
          if (s.object !== this._resources[autoBindSamplerComparison]) {
            this._resources[autoBindSamplerComparison] = s.object;
            this.invalidate();
          }
        }
      } else {
        throw new Error(`WebGPUBindGroup.setTexture() failed: no texture uniform named '${name}'`);
      }
    }
  }
  setSampler(name: string, value: TextureSampler) {
    const sampler = (value as WebGPUTextureSampler)?.object;
    if (!sampler) {
      console.log(`WebGPUBindGroup.setSampler() failed: invalid sampler uniform value: ${value}`);
    } else if (this._resources[name] !== sampler) {
      if (!this._findSamplerLayout(name)) {
        console.log(`WebGPUBindGroup.setSampler() failed: no sampler uniform named '${name}'`);
      } else {
        this._resources[name] = sampler;
        this.invalidate();
      }
    }
  }
  destroy() {
    this.invalidate();
    this._resources = {};
    this._buffers = [];
    this._textures = [];
    this._videoTextures = null;
    this._object = null;
  }
  async restore() {
    this.invalidate();
    this._object = {};
  }
  isBindGroup(): this is BindGroup {
    return true;
  }
  /** @internal */
  updateVideoTextures() {
    this._videoTextures?.forEach((t) => {
      if (t.updateVideoFrame()) {
        this.invalidate();
      }
    });
  }
  /** @internal */
  private _findTextureLayout(name: string): BindGroupLayoutEntry {
    for (const entry of this._layout.entries) {
      if ((entry.texture || entry.storageTexture || entry.externalTexture) && entry.name === name) {
        return entry;
      }
    }
    return null;
  }
  /** @internal */
  private _findSamplerLayout(name: string): BindGroupLayoutEntry {
    for (const entry of this._layout.entries) {
      if (entry.sampler && entry.name === name) {
        return entry;
      }
    }
    return null;
  }
  /** @internal */
  private _getBuffer(name: string, usage: number, nocreate = false): GPUDataBuffer {
    const info = this._getBufferInfo(name, usage, nocreate);
    return info?.[0] ?? null;
  }
  /** @internal */
  private _getBufferInfo(name: string, usage: number, nocreate = false): [WebGPUBuffer, number, number] {
    const bindName = this._layout.nameMap?.[name] ?? name;
    for (const entry of this._layout.entries) {
      if (entry.buffer && entry.name === bindName) {
        const bufferUsage =
          entry.buffer.type === 'uniform'
            ? GPUResourceUsageFlags.BF_UNIFORM
            : GPUResourceUsageFlags.BF_STORAGE;
        if (!(usage & bufferUsage)) {
          return null;
        }
        let buffer = this._resources[entry.name] as [WebGPUBuffer, number, number];
        if ((!buffer || !buffer[0]) && !nocreate) {
          const options: BufferCreationOptions = {
            usage: bufferUsage === GPUResourceUsageFlags.BF_UNIFORM ? 'uniform' : null,
            storage: bufferUsage === GPUResourceUsageFlags.BF_STORAGE,
            dynamic: true
          };
          const gpuBuffer = this._device.createStructuredBuffer(
            entry.type as PBStructTypeInfo,
            options
          ) as WebGPUStructuredBuffer;
          buffer = [gpuBuffer, 0, gpuBuffer.byteLength];
          this._resources[entry.name] = buffer;
        }
        return buffer;
      }
    }
    return null;
  }
  /** @internal */
  private _create(): GPUBindGroup {
    let bindGroup = null;
    this._layoutDesc = null;
    this._entries = null;
    this._textures = [];
    this._buffers = [];
    const entries = [] as GPUBindGroupEntry[];
    let resourceOk = true;
    for (const entry of this._layout.entries) {
      const ge = { binding: entry.binding } as GPUBindGroupEntry;
      if (entry.buffer) {
        const buffer = this._getBufferInfo(
          entry.name,
          entry.buffer.type === 'uniform'
            ? GPUResourceUsageFlags.BF_UNIFORM
            : GPUResourceUsageFlags.BF_STORAGE,
          true
        );
        if (!buffer) {
          throw new Error(
            `Uniform buffer '${entry.name}' not exists, maybe you forgot settings some uniform values`
          );
        }
        if (this._buffers.indexOf(buffer[0]) < 0) {
          this._buffers.push(buffer[0]);
        }
        ge.resource = {
          buffer: buffer[0].object,
          offset: buffer[1],
          size: buffer[2]
        };
        resourceOk = resourceOk && !!buffer[0].object;
      } else if (entry.texture || entry.storageTexture) {
        const t = this._resources[entry.name] as [WebGPUBaseTexture, GPUTextureView];
        if (!t) {
          console.error(`Missing texture in bind group: ${entry.name}`);
          resourceOk = false;
        } else {
          if (this._textures.indexOf(t[0]) < 0) {
            this._textures.push(t[0]);
          }
          ge.resource = t[1];
          resourceOk = resourceOk && !!t[1];
        }
      } else if (entry.externalTexture) {
        const t = this._resources[entry.name] as WebGPUTextureVideo;
        ge.resource = t.object;
        resourceOk = resourceOk && !!t.object;
      } else if (entry.sampler) {
        const sampler = this._resources[entry.name] as GPUSampler;
        ge.resource = sampler;
        resourceOk = resourceOk && !!sampler;
      }
      entries.push(ge);
    }
    if (!resourceOk) {
      return null;
    }
    const [desc, layout] = this._device.fetchBindGroupLayout(this._layout);
    const descriptor: GPUBindGroupDescriptor = {
      layout: layout,
      entries
    };
    if (layout.label) {
      descriptor.label = `${layout.label}.bindgroup`;
    }
    bindGroup = this._device.gpuCreateBindGroup(descriptor);
    if (!bindGroup) {
      console.log('Create bindgroup failed');
    }
    this._layoutDesc = desc;
    this._entries = entries;
    return bindGroup;
  }
}
