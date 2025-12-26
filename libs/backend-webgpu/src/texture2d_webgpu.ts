import type {
  TextureImageElement,
  TextureMipmapData,
  Texture2D,
  GPUDataBuffer,
  TextureFormat
} from '@zephyr3d/device';
import { linearTextureFormatToSRGB, GPUResourceUsageFlags } from '@zephyr3d/device';
import { WebGPUBaseTexture } from './basetexture_webgpu';
import type { Nullable, TypedArray } from '@zephyr3d/base';
import type { WebGPUDevice } from './device';

export class WebGPUTexture2D extends WebGPUBaseTexture implements Texture2D<GPUTexture> {
  constructor(device: WebGPUDevice) {
    super(device, '2d');
  }
  isTexture2D(): this is Texture2D {
    return true;
  }
  init(): void {
    this.loadEmpty(this._format!, this._width, this._height, this._mipLevelCount);
  }
  update(data: TypedArray, xOffset: number, yOffset: number, width: number, height: number): void {
    if (this._device.isContextLost()) {
      return;
    }
    if (!this._object) {
      this.allocInternal(this._format!, this._width, this._height, 1, this._mipLevelCount);
    }
    this.uploadRaw(data, width, height, 1, xOffset, yOffset, 0, 0);
    if (this._mipLevelCount > 1) {
      this.generateMipmaps();
    }
  }
  updateFromElement(
    data: TextureImageElement,
    destX: number,
    destY: number,
    srcX: number,
    srcY: number,
    width: number,
    height: number
  ): void {
    if (this._device.isContextLost()) {
      return;
    }
    if (!this._object) {
      this.allocInternal(this._format!, this._width, this._height, 1, this._mipLevelCount);
    }
    if (data instanceof HTMLCanvasElement || this._device.isTextureUploading(this)) {
      // Copy the pixel values out in case the canvas content may be changed later
      const cvs = document.createElement('canvas');
      cvs.width = width;
      cvs.height = height;
      const ctx = cvs.getContext('2d')!;
      ctx.drawImage(data, srcX, srcY, width, height, 0, 0, width, height);
      const imageData = ctx.getImageData(0, 0, width, height);
      this.update(imageData.data, destX, destY, width, height);
      cvs.width = 0;
      cvs.height = 0;
    } else {
      this.uploadImageData(data, srcX, srcY, width, height, destX, destY, 0, 0);
    }
  }
  async readPixels(
    x: number,
    y: number,
    w: number,
    h: number,
    faceOrLayer: number,
    mipLevel: number,
    buffer: TypedArray
  ): Promise<void> {
    if (faceOrLayer !== 0) {
      throw new Error(`Texture2D.readPixels(): parameter faceOrLayer must be 0`);
    }
    if (mipLevel >= this.mipLevelCount || mipLevel < 0) {
      throw new Error(`Texture2D.readPixels(): invalid miplevel: ${mipLevel}`);
    }
    const { size } = WebGPUBaseTexture.calculateBufferSizeForCopy(w, h, this.format);
    if (buffer.byteLength < size) {
      throw new Error(
        `Texture2D.readPixels() failed: destination buffer size is ${buffer.byteLength}, should be at least ${size}`
      );
    }
    const tmpBuffer = this._device.createBuffer(size, { usage: 'read' });
    await this.copyPixelDataToBuffer(x, y, w, h, 0, mipLevel, tmpBuffer);
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
    faceOrLayer: number,
    mipLevel: number,
    buffer: GPUDataBuffer
  ) {
    if (faceOrLayer !== 0) {
      throw new Error(`Texture2D.readPixels(): parameter faceOrLayer must be 0`);
    }
    if (mipLevel >= this.mipLevelCount || mipLevel < 0) {
      throw new Error(`Texture2D.readPixels(): invalid miplevel: ${mipLevel}`);
    }
    this.copyPixelDataToBuffer(x, y, w, h, 0, mipLevel, buffer);
  }
  loadFromElement(element: TextureImageElement, sRGB: boolean, creationFlags?: number): void {
    this._flags = Number(creationFlags) || 0;
    const format = sRGB ? 'rgba8unorm-srgb' : 'rgba8unorm';
    this.loadImage(element, format);
  }
  createEmpty(format: TextureFormat, width: number, height: number, creationFlags?: number): void {
    this._flags = Number(creationFlags) || 0;
    this.loadEmpty(format, width, height, 0);
  }
  createView(level?: number, face?: number, mipCount?: number): Nullable<GPUTextureView> {
    return this._object
      ? this._device.gpuCreateTextureView(this._object, {
          dimension: '2d',
          baseMipLevel: level ?? 0,
          mipLevelCount: mipCount || this._mipLevelCount - (level ?? 0),
          baseArrayLayer: 0,
          arrayLayerCount: 1
        })
      : null;
  }
  createWithMipmapData(data: TextureMipmapData, sRGB: boolean, creationFlags?: number): void {
    if (data.isCubemap || data.isVolume) {
      console.error('loading 2d texture with mipmap data failed: data is not 2d texture');
    } else {
      this._flags = Number(creationFlags) || 0;
      if (this._flags & GPUResourceUsageFlags.TF_WRITABLE) {
        console.error(new Error('webgl device does not support storage texture'));
      } else {
        this.loadLevels(data, sRGB);
      }
    }
  }
  /** @internal */
  private loadEmpty(format: TextureFormat, width: number, height: number, numMipLevels: number): void {
    this.allocInternal(format, width, height, 1, numMipLevels);
    if (this._mipLevelCount > 1 && !this._device.isContextLost()) {
      this.generateMipmaps();
    }
  }
  /** @internal */
  private loadLevels(levels: TextureMipmapData, sRGB: boolean): void {
    let format = sRGB ? linearTextureFormatToSRGB(levels.format) : levels.format;
    let swizzle = false;
    if (format === 'bgra8unorm') {
      format = 'rgba8unorm';
      swizzle = true;
    } else if (this._format === 'bgra8unorm-srgb') {
      format = 'rgba8unorm-srgb';
      swizzle = true;
    }
    const width = levels.width;
    const height = levels.height;
    const mipLevelCount = levels.mipLevels;
    if (levels.isCompressed) {
      if (!this.getTextureCaps().supportS3TCSRGB || !this.getTextureCaps().supportS3TC) {
        console.error('No s3tc compression format support');
        return;
      }
    }
    this.allocInternal(format, width, height, 1, mipLevelCount);
    if (!this._device.isContextLost()) {
      for (let i = 0; i < levels.mipDatas[0].length; i++) {
        if (swizzle) {
          // convert bgra to rgba
          for (let j = 0; j < levels.mipDatas[0][i].width * levels.mipDatas[0][i].height; j++) {
            const t = levels.mipDatas[0][i].data[j * 4];
            levels.mipDatas[0][i].data[j * 4] = levels.mipDatas[0][i].data[j * 4 + 2];
            levels.mipDatas[0][i].data[j * 4 + 2] = t;
          }
        }
        this.uploadRaw(
          levels.mipDatas[0][i].data,
          levels.mipDatas[0][i].width,
          levels.mipDatas[0][i].height,
          1,
          0,
          0,
          0,
          i
        );
      }
    }
  }
  /** @internal */
  private loadImage(element: TextureImageElement, format: TextureFormat): void {
    this.allocInternal(format, Number(element.width), Number(element.height), 1, 0);
    if (!this._device.isContextLost()) {
      this.updateFromElement(element, 0, 0, 0, 0, this._width, this._height);
      if (this._mipLevelCount > 1) {
        this.generateMipmaps();
      }
    }
  }
}
