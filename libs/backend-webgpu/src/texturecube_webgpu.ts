import type { CubeFace, TypedArray } from '@zephyr3d/base';
import type {
  TextureMipmapData,
  TextureCube,
  TextureImageElement,
  GPUDataBuffer,
  TextureFormat
} from '@zephyr3d/device';
import { linearTextureFormatToSRGB, GPUResourceUsageFlags } from '@zephyr3d/device';
import { WebGPUBaseTexture } from './basetexture_webgpu';
import type { WebGPUDevice } from './device';

export class WebGPUTextureCube extends WebGPUBaseTexture implements TextureCube<GPUTexture> {
  constructor(device: WebGPUDevice) {
    super(device, 'cube');
  }
  init(): void {
    this.loadEmpty(this._format, this._width, this._mipLevelCount);
  }
  update(
    data: TypedArray,
    xOffset: number,
    yOffset: number,
    width: number,
    height: number,
    face: CubeFace
  ): void {
    if (this._device.isContextLost()) {
      return;
    }
    if (!this._object) {
      this.allocInternal(this._format, this._width, this._height, 1, this._mipLevelCount);
    }
    this.uploadRaw(data, width, height, 1, xOffset, yOffset, face, 0);
    if (this._mipLevelCount > 1) {
      this.generateMipmaps();
    }
  }
  updateFromElement(
    data: TextureImageElement,
    destX: number,
    destY: number,
    face: number,
    srcX: number,
    srcY: number,
    width: number,
    height: number
  ): void {
    if (this._device.isContextLost()) {
      return;
    }
    if (!this._object) {
      this.allocInternal(this._format, this._width, this._height, 1, this._mipLevelCount);
    }
    if (data instanceof HTMLCanvasElement || this._device.isTextureUploading(this)) {
      // Copy the pixel values out in case the canvas content may be changed later
      const cvs = document.createElement('canvas');
      cvs.width = width;
      cvs.height = height;
      const ctx = cvs.getContext('2d');
      ctx.drawImage(data, srcX, srcY, width, height, 0, 0, width, height);
      const imageData = ctx.getImageData(0, 0, width, height);
      this.update(imageData.data, destX, destY, width, height, face);
      cvs.width = 0;
      cvs.height = 0;
    } else {
      this.uploadImageData(data, srcX, srcY, width, height, destX, destY, 0, face);
    }
  }
  createEmpty(format: TextureFormat, size: number, creationFlags?: number): void {
    this._flags = Number(creationFlags) || 0;
    if (this._flags & GPUResourceUsageFlags.TF_WRITABLE) {
      console.error(new Error('storage texture can not be cube texture'));
    } else {
      this.loadEmpty(format, size, 0);
    }
  }
  isTextureCube(): this is TextureCube {
    return true;
  }
  createView(level?: number, face?: number, mipCount?: number): GPUTextureView {
    return this._object
      ? this._device.gpuCreateTextureView(this._object, {
          format: this._gpuFormat,
          dimension: '2d',
          baseMipLevel: level ?? 0,
          mipLevelCount: mipCount || this._mipLevelCount - (level ?? 0),
          baseArrayLayer: face ?? 0,
          arrayLayerCount: 1,
          aspect: 'all'
        })
      : null;
  }
  async readPixels(
    x: number,
    y: number,
    w: number,
    h: number,
    face: number,
    mipLevel: number,
    buffer: TypedArray
  ): Promise<void> {
    if (mipLevel < 0 || mipLevel >= this.mipLevelCount) {
      throw new Error(`TextureCube.readPixels(): invalid miplevel: ${mipLevel}`);
    }
    const { size } = WebGPUBaseTexture.calculateBufferSizeForCopy(w, h, this.format);
    if (buffer.byteLength < size) {
      throw new Error(
        `Texture2D.readPixels() failed: destination buffer size is ${buffer.byteLength}, should be at least ${size}`
      );
    }
    const tmpBuffer = this._device.createBuffer(size, { usage: 'read' });
    await this.copyPixelDataToBuffer(x, y, w, h, face, mipLevel, tmpBuffer);
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
    face: number,
    mipLevel: number,
    buffer: GPUDataBuffer
  ): void {
    if (mipLevel < 0 || mipLevel >= this.mipLevelCount) {
      throw new Error(`TextureCube.readPixelsToBuffer(): invalid miplevel: ${mipLevel}`);
    }
    this.copyPixelDataToBuffer(x, y, w, h, face, mipLevel, buffer);
  }
  createWithMipmapData(data: TextureMipmapData, sRGB: boolean, creationFlags?: number): void {
    if (!data.isCubemap) {
      console.error('loading cubmap with mipmap data failed: data is not cubemap');
    } else {
      this._flags = Number(creationFlags) || 0;
      if (this._flags & GPUResourceUsageFlags.TF_WRITABLE) {
        console.error('webgl device does not support storage texture');
      } else {
        this.loadLevels(data, sRGB);
      }
    }
  }
  /** @internal */
  private loadEmpty(format: TextureFormat, size: number, mipLevelCount: number): void {
    this.allocInternal(format, size, size, 1, mipLevelCount);
    if (this._mipLevelCount > 1 && !this._device.isContextLost()) {
      this.generateMipmaps();
    }
  }
  /** @internal */
  /*
  private loadImages(images: HTMLImageElement[], format: TextureFormat): void {
    const width = images[0].width;
    const height = images[0].height;
    if (images.length !== 6) {
      console.error(new Error('cubemap face list must have 6 images'));
      return;
    }
    for (let i = 1; i < 6; i++) {
      if (images[i].width !== width || images[i].height !== height) {
        console.error(new Error('cubemap face images must have identical sizes'));
        return;
      }
    }
    if (width === 0 || height === 0) {
      return;
    }
    this.allocInternal(format, width, height, 1, 0);
    if (!this._device.isContextLost()) {
      const w = this._width;
      const h = this._height;
      for (let face = 0; face < 6; face++) {
        createImageBitmap(images[face], {
          premultiplyAlpha: 'none'
        }).then((bmData) => {
          this.updateFromElement(bmData, 0, 0, face, 0, 0, w, h);
        });
      }
      if (this._mipLevelCount > 1) {
        this.generateMipmaps();
      }
    }
  }
  */
  /** @internal */
  private loadLevels(levels: TextureMipmapData, sRGB: boolean): void {
    const format = sRGB ? linearTextureFormatToSRGB(levels.format) : levels.format;
    const width = levels.width;
    const height = levels.height;
    //const mipLevelCount = levels.mipLevels;
    const mipLevelCount =
      levels.mipLevels === 1 && !(this._flags & GPUResourceUsageFlags.TF_NO_MIPMAP)
        ? this._calcMipLevelCount(levels.format, width, height, 1)
        : levels.mipLevels;
    if (levels.isCompressed) {
      if (!this.getTextureCaps().supportS3TCSRGB || !this.getTextureCaps().supportS3TC) {
        console.error('TextureCube.loadLevels(): No s3tc compression format support');
        return;
      }
    }
    this.allocInternal(format, width, height, 1, mipLevelCount);
    if (!this._device.isContextLost()) {
      for (let face = 0; face < 6; face++) {
        if (levels.mipDatas[face].length !== levels.mipLevels) {
          console.error(`TextureCube.loadLevels() failed: Invalid texture data`);
          return;
        }
        for (let i = 0; i < levels.mipLevels; i++) {
          this.uploadRaw(
            levels.mipDatas[face][i].data,
            levels.mipDatas[face][i].width,
            levels.mipDatas[face][i].height,
            1,
            0,
            0,
            face,
            i
          );
        }
      }
    }
    if (levels.mipLevels !== this.mipLevelCount) {
      this.generateMipmaps();
    }
  }
}
