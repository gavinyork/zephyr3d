import type { BindGroupLayout } from '@zephyr3d/device';
import { ShaderType } from '@zephyr3d/device';
import { textureFormatMap } from './constants_webgpu';
import type { WebGPUDevice } from './device';
import type { Immutable, Nullable } from '@zephyr3d/base';

export class BindGroupCache {
  private readonly _device: WebGPUDevice;
  private _bindGroupLayoutCache: Record<string, [GPUBindGroupLayoutDescriptor, GPUBindGroupLayout]>;
  private readonly _pipelineLayoutCache: Map<string, GPUPipelineLayout>;
  constructor(device: WebGPUDevice) {
    this._device = device;
    this._bindGroupLayoutCache = {};
    this._pipelineLayoutCache = new Map();
  }
  fetchBindGroupLayout(desc: Immutable<BindGroupLayout>): [GPUBindGroupLayoutDescriptor, GPUBindGroupLayout] {
    const hash = BindGroupCache.getLayoutHash(desc);
    let bgl = this._bindGroupLayoutCache[hash];
    if (!bgl) {
      bgl = this.createBindGroupLayout(desc);
      if (bgl) {
        this._bindGroupLayoutCache[hash] = bgl;
      } else {
        throw new Error(`fetchBindGroupLayout() failed: hash: ${hash}`);
      }
    }
    return bgl;
  }
  /**
   * Gets the layout of a content key, creating it from a recorded descriptor if no
   * program has made it yet
   */
  fetchRecordedBindGroupLayout(
    hash: string,
    desc: GPUBindGroupLayoutDescriptor
  ): [GPUBindGroupLayoutDescriptor, GPUBindGroupLayout] {
    let bgl = this._bindGroupLayoutCache[hash];
    if (!bgl) {
      bgl = [desc, this._device.device.createBindGroupLayout(desc)];
      this._bindGroupLayoutCache[hash] = bgl;
    }
    return bgl;
  }
  /** Gets the pipeline layout of bind group layouts given by their content keys */
  fetchPipelineLayout(hashes: string[], getLayouts: () => GPUBindGroupLayout[]) {
    const key = hashes.join('|');
    let layout = this._pipelineLayoutCache.get(key);
    if (!layout) {
      layout = this._device.device.createPipelineLayout({ bindGroupLayouts: getLayouts() });
      this._pipelineLayoutCache.set(key, layout);
    }
    return layout;
  }
  /** Content of a layout, the key layouts are shared by */
  static getLayoutHash(desc: Nullable<Immutable<BindGroupLayout>>) {
    if (!desc) {
      return '';
    }
    let hash = '';
    for (const entry of desc.entries) {
      let s = `${entry.binding}:${entry.visibility}:`;
      if (entry.buffer) {
        s += `b:${entry.buffer.type}:${entry.buffer.hasDynamicOffset}:${entry.buffer.minBindingSize}`;
      } else if (entry.sampler) {
        s += `s${entry.sampler.type}:`;
      } else if (entry.texture) {
        s += `t${entry.texture.sampleType}-${entry.texture.viewDimension}-${Number(
          !!entry.texture.multisampled
        )}:`;
      } else if (entry.storageTexture) {
        s += `k${entry.storageTexture.access}-${entry.storageTexture.format}-${entry.storageTexture.viewDimension}:`;
      } else if (entry.externalTexture) {
        s += `v:`;
      }
      hash = `${hash} ${s}`;
    }
    return hash;
  }
  private createBindGroupLayout(
    desc: Immutable<BindGroupLayout>
  ): [GPUBindGroupLayoutDescriptor, GPUBindGroupLayout] {
    const layoutDescriptor: GPUBindGroupLayoutDescriptor = {
      entries:
        desc?.entries.map((entry) => {
          const binding = entry.binding;
          const visibility =
            (entry.visibility & ShaderType.Vertex ? GPUShaderStage.VERTEX : 0) |
            (entry.visibility & ShaderType.Fragment ? GPUShaderStage.FRAGMENT : 0) |
            (entry.visibility & ShaderType.Compute ? GPUShaderStage.COMPUTE : 0);
          const buffer: GPUBufferBindingLayout | undefined = entry.buffer
            ? {
                type: entry.buffer.type,
                hasDynamicOffset: entry.buffer.hasDynamicOffset,
                // minBindingSize: entry.buffer.uniformLayout.byteSize
                minBindingSize: Number(entry.buffer.minBindingSize) || 0
              }
            : undefined;
          const sampler: GPUSamplerBindingLayout | undefined = entry.sampler
            ? {
                type: entry.sampler.type
              }
            : undefined;
          const texture: GPUTextureBindingLayout | undefined = entry.texture
            ? {
                sampleType: entry.texture.sampleType,
                viewDimension: entry.texture.viewDimension
              }
            : undefined;
          const storageTexture: GPUStorageTextureBindingLayout | undefined = entry.storageTexture
            ? {
                access: entry.storageTexture.access,
                viewDimension: entry.storageTexture.viewDimension,
                format: textureFormatMap[entry.storageTexture.format]
              }
            : undefined;
          const externalTexture: GPUExternalTextureBindingLayout | undefined = entry.externalTexture
            ? {}
            : undefined;
          const t: GPUBindGroupLayoutEntry = {
            binding,
            visibility
          };
          if (buffer) {
            t.buffer = buffer;
          } else if (sampler) {
            t.sampler = sampler;
          } else if (texture) {
            t.texture = texture;
          } else if (storageTexture) {
            t.storageTexture = storageTexture;
          } else if (externalTexture) {
            t.externalTexture = externalTexture;
          }
          return t;
        }) || []
    };
    if (desc?.label) {
      layoutDescriptor.label = desc.label;
    }
    return [layoutDescriptor, this._device.device.createBindGroupLayout(layoutDescriptor)];
  }
}
