import type { Texture3D, GPUDataBuffer, TextureFormat, TextureMipmapData } from '@zephyr3d/device';
import { GPUResourceUsageFlags } from '@zephyr3d/device';
import { WebGPUBaseTexture } from './basetexture_webgpu';
import type { Nullable, TypedArray } from '@zephyr3d/base';
import type { WebGPUDevice } from './device';

export class WebGPUTexture3D extends WebGPUBaseTexture implements Texture3D<GPUTexture> {
  constructor(device: WebGPUDevice) {
    super(device, '3d');
  }
  isTexture3D(): this is Texture3D {
    return true;
  }
  init(): void {
    this.loadEmpty(this._format!, this._width, this._height, this._depth, this._mipLevelCount);
  }
  update(
    data: TypedArray,
    xOffset: number,
    yOffset: number,
    zOffset: number,
    width: number,
    height: number,
    depth: number
  ): void {
    if (this._device.isContextLost()) {
      return;
    }
    if (!this._object) {
      this.allocInternal(this._format!, this._width, this._height, this._depth, this._mipLevelCount);
    }
    this.uploadRaw(data, width, height, depth, xOffset, yOffset, zOffset, 0);
  }
  createEmpty(
    format: TextureFormat,
    width: number,
    height: number,
    depth: number,
    creationFlags?: number
  ): void {
    this._flags = Number(creationFlags) || 0;
    this.loadEmpty(format, width, height, depth, 0);
  }
  createView(_level?: number, face?: number, _mipCount?: number): Nullable<GPUTextureView> {
    return this._object
      ? this._device.gpuCreateTextureView(this._object, {
          dimension: '2d',
          baseMipLevel: 0,
          mipLevelCount: 1,
          baseArrayLayer: face,
          arrayLayerCount: 1
        })
      : null;
  }
  async readPixels(
    x: number,
    y: number,
    w: number,
    h: number,
    layer: number,
    mipLevel: number,
    buffer: TypedArray
  ): Promise<void> {
    if (mipLevel !== 0) {
      throw new Error(`Texture3D.readPixels(): parameter mipLevel must be 0`);
    }
    const { size } = WebGPUBaseTexture.calculateBufferSizeForCopy(w, h, this.format);
    if (buffer.byteLength < size) {
      throw new Error(
        `Texture2D.readPixels() failed: destination buffer size is ${buffer.byteLength}, should be at least ${size}`
      );
    }
    const tmpBuffer = this._device.createBuffer(size, { usage: 'read' });
    await this.copyPixelDataToBuffer(x, y, w, h, layer, 0, tmpBuffer);
    await tmpBuffer.getBufferSubData(
      new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength),
      0,
      size
    );
    tmpBuffer.dispose();
  }
  readPixelsToBuffer(
    x: number,
    y: number,
    w: number,
    h: number,
    layer: number,
    mipLevel: number,
    buffer: GPUDataBuffer
  ): void {
    if (mipLevel !== 0) {
      throw new Error(`Texture3D.readPixelsToBuffer(): parameter mipLevel must be 0`);
    }
    this.copyPixelDataToBuffer(x, y, w, h, layer, 0, buffer);
  }
  createWithMipmapData(data: TextureMipmapData, creationFlags?: number): void {
    if (!data.arraySize) {
      console.error('Texture2DArray.createWithMipmapData() failed: Data is not texture array');
    } else {
      this._flags = Number(creationFlags) || 0;
      if (this._flags & GPUResourceUsageFlags.TF_WRITABLE) {
        console.error(
          'Texture2DArray.createWithMipmapData() failed: Webgl device does not support storage texture'
        );
      } else {
        this.loadLevels(data);
      }
    }
  }
  private loadLevels(levels: TextureMipmapData): void {
    const format = levels.format;
    const width = levels.width;
    const height = levels.height;
    const depth = levels.depth;
    const mipLevelCount =
      levels.mipLevels === 1 && !(this._flags & GPUResourceUsageFlags.TF_NO_MIPMAP)
        ? this._calcMipLevelCount(levels.format, width, height, depth)
        : levels.mipLevels;
    if (levels.isCompressed) {
      if (!this.getTextureCaps().supportS3TCSRGB || !this.getTextureCaps().supportS3TC) {
        console.error('Texture3D.loadLevels(): No s3tc compression format support');
        return;
      }
    }
    this.allocInternal(format, width, height, depth, mipLevelCount);
    if (!this._device.isContextLost()) {
      for (let layer = 0; layer < depth; layer++) {
        if (levels.mipDatas[layer].length !== levels.mipLevels) {
          console.error(`Texture3D.loadLevels() failed: Invalid texture data`);
          return;
        }
        for (let i = 0; i < levels.mipLevels; i++) {
          this.uploadRaw(
            levels.mipDatas[layer][i].data,
            levels.mipDatas[layer][i].width,
            levels.mipDatas[layer][i].height,
            1,
            0,
            0,
            layer,
            i
          );
        }
      }
      if (levels.mipLevels !== this.mipLevelCount) {
        this.generateMipmaps();
      }
    }
  }
  private loadEmpty(
    format: TextureFormat,
    width: number,
    height: number,
    depth: number,
    numMipLevels: number
  ): void {
    this.allocInternal(format, width, height, depth, numMipLevels);
    if (this._mipLevelCount > 1 && !this._device.isContextLost()) {
      this.generateMipmaps();
    }
  }
}
