import type {
  TextureImageElement,
  Texture2DArray,
  GPUDataBuffer,
  TextureFormat,
  TextureMipmapData
} from '@zephyr3d/device';
import { GPUResourceUsageFlags } from '@zephyr3d/device';
import { WebGPUBaseTexture } from './basetexture_webgpu';
import type { TypedArray } from '@zephyr3d/base';
import type { WebGPUDevice } from './device';

export class WebGPUTexture2DArray extends WebGPUBaseTexture implements Texture2DArray<GPUTexture> {
  constructor(device: WebGPUDevice) {
    super(device, '2darray');
  }
  isTexture2DArray(): this is Texture2DArray {
    return true;
  }
  init(): void {
    this.loadEmpty(this._format, this._width, this._height, this._depth, this._mipLevelCount);
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
      this.allocInternal(this._format, this._width, this._height, this._depth, this._mipLevelCount);
    }
    this.uploadRaw(data, width, height, depth, xOffset, yOffset, zOffset, 0);
    if (this._mipLevelCount > 1) {
      this.generateMipmaps();
    }
  }
  updateFromElement(
    data: TextureImageElement,
    destX: number,
    destY: number,
    destZ: number,
    srcX: number,
    srcY: number,
    width: number,
    height: number
  ): void {
    if (this._device.isContextLost()) {
      return;
    }
    if (!this._object) {
      this.allocInternal(this._format, this._width, this._height, this._depth, this._mipLevelCount);
    }
    if (data instanceof HTMLCanvasElement || this._device.isTextureUploading(this)) {
      // Copy the pixel values out in case the canvas content may be changed later
      const cvs = document.createElement('canvas');
      cvs.width = width;
      cvs.height = height;
      const ctx = cvs.getContext('2d');
      ctx.drawImage(data, srcX, srcY, width, height, 0, 0, width, height);
      const imageData = ctx.getImageData(0, 0, width, height);
      this.update(imageData.data, destX, destY, destZ, width, height, 1);
      cvs.width = 0;
      cvs.height = 0;
    } else {
      this.uploadImageData(data, srcX, srcY, width, height, destX, destY, 0, destZ);
    }
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
  createView(level?: number, face?: number, mipCount?: number): GPUTextureView {
    return this._object
      ? this._device.gpuCreateTextureView(this._object, {
          dimension: '2d',
          baseMipLevel: level ?? 0,
          mipLevelCount: mipCount || this._mipLevelCount - (level ?? 0),
          baseArrayLayer: face ?? 0,
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
    if (layer < 0 || layer >= this._depth) {
      throw new Error(`Texture2DArray.readPixels(): invalid layer: ${layer}`);
    }
    if (mipLevel < 0 || mipLevel >= this.mipLevelCount) {
      throw new Error(`Texture2DArray.readPixels(): invalid miplevel: ${mipLevel}`);
    }
    const { size } = WebGPUBaseTexture.calculateBufferSizeForCopy(w, h, this.format);
    if (buffer.byteLength < size) {
      throw new Error(
        `Texture2D.readPixels() failed: destination buffer size is ${buffer.byteLength}, should be at least ${size}`
      );
    }
    const tmpBuffer = this._device.createBuffer(size, { usage: 'read' });
    await this.copyPixelDataToBuffer(x, y, w, h, layer, mipLevel, tmpBuffer);
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
    if (layer < 0 || layer >= this._depth) {
      throw new Error(`Texture2DArray.readPixelsToBuffer(): invalid layer: ${layer}`);
    }
    if (mipLevel < 0 || mipLevel >= this.mipLevelCount) {
      throw new Error(`Texture2DArray.readPixelsToBuffer(): invalid miplevel: ${mipLevel}`);
    }
    this.copyPixelDataToBuffer(x, y, w, h, layer, mipLevel, buffer);
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
  private loadLevels(levels: TextureMipmapData): void {
    const format = levels.format;
    const width = levels.width;
    const height = levels.height;
    const depth = levels.arraySize;
    const mipLevelCount =
      levels.mipLevels === 1 && !(this._flags & GPUResourceUsageFlags.TF_NO_MIPMAP)
        ? this._calcMipLevelCount(levels.format, width, height, depth)
        : levels.mipLevels;
    if (levels.isCompressed) {
      if (!this.getTextureCaps().supportS3TCSRGB || !this.getTextureCaps().supportS3TC) {
        console.error('Texture2DArray.loadLevels(): No s3tc compression format support');
        return;
      }
    }
    this.allocInternal(format, width, height, levels.arraySize, mipLevelCount);
    if (!this._device.isContextLost()) {
      for (let layer = 0; layer < levels.arraySize; layer++) {
        if (levels.mipDatas[layer].length !== levels.mipLevels) {
          console.error(`Texture2DArray.loadLevels() failed: Invalid texture data`);
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
}
