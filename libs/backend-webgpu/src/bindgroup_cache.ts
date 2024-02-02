import { ShaderType, BindGroupLayout } from '@zephyr3d/device';
import { textureFormatMap } from './constants_webgpu';
import type { WebGPUDevice } from './device';

export class BindGroupCache {
  private _device: WebGPUDevice;
  private _bindGroupLayoutCache: Record<string, GPUBindGroupLayout>;
  constructor(device: WebGPUDevice) {
    this._device = device;
    this._bindGroupLayoutCache = {};
  }
  fetchBindGroupLayout(desc: BindGroupLayout): GPUBindGroupLayout {
    const hash = desc ? this.getLayoutHash(desc) : '';
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
  private getLayoutHash(desc: BindGroupLayout): string {
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
  private createBindGroupLayout(desc: BindGroupLayout): GPUBindGroupLayout {
    const layoutDescriptor: GPUBindGroupLayoutDescriptor = {
      entries:
        desc?.entries.map((entry) => {
          const binding = entry.binding;
          const visibility =
            (entry.visibility & ShaderType.Vertex ? GPUShaderStage.VERTEX : 0) |
            (entry.visibility & ShaderType.Fragment ? GPUShaderStage.FRAGMENT : 0) |
            (entry.visibility & ShaderType.Compute ? GPUShaderStage.COMPUTE : 0);
          const buffer: GPUBufferBindingLayout = entry.buffer
            ? {
                type: entry.buffer.type,
                hasDynamicOffset: entry.buffer.hasDynamicOffset,
                // minBindingSize: entry.buffer.uniformLayout.byteSize
                minBindingSize: Number(entry.buffer.minBindingSize) || 0
              }
            : undefined;
          const sampler: GPUSamplerBindingLayout = entry.sampler
            ? {
                type: entry.sampler.type
              }
            : undefined;
          const texture: GPUTextureBindingLayout = entry.texture
            ? {
                sampleType: entry.texture.sampleType,
                viewDimension: entry.texture.viewDimension
              }
            : undefined;
          const storageTexture: GPUStorageTextureBindingLayout = entry.storageTexture
            ? {
                access: 'write-only',
                viewDimension: '2d',
                format: textureFormatMap[entry.storageTexture.format]
              }
            : undefined;
          const externalTexture: GPUExternalTextureBindingLayout = entry.externalTexture ? {} : undefined;
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
    return this._device.device.createBindGroupLayout(layoutDescriptor);
  }
}
