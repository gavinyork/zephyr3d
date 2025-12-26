import type {
  TextureImageElement,
  TextureMipmapData,
  Texture2D,
  GPUDataBuffer,
  TextureFormat
} from '@zephyr3d/device';
import { linearTextureFormatToSRGB, GPUResourceUsageFlags } from '@zephyr3d/device';
import { textureTargetMap } from './constants_webgl';
import { WebGLBaseTexture } from './basetexture_webgl';
import type { TypedArray } from '@zephyr3d/base';
import type { WebGLDevice } from './device_webgl';
import type { WebGLTextureCaps } from './capabilities_webgl';

export class WebGLTexture2D extends WebGLBaseTexture implements Texture2D<WebGLTexture> {
  constructor(device: WebGLDevice) {
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
    const params = (this.getTextureCaps() as WebGLTextureCaps).getTextureFormatInfo(this._format!);
    this._device.bindTexture(textureTargetMap[this._target], 0, this);
    //this._device.context.bindTexture(textureTargetMap[this._target], this._object);
    this._device.context.pixelStorei(this._device.context.UNPACK_ALIGNMENT, 1);
    this._device.context.texSubImage2D(
      textureTargetMap[this._target],
      0,
      xOffset,
      yOffset,
      width,
      height,
      params.glFormat,
      params.glType[0],
      data
    );
    if (this._mipLevelCount > 1) {
      this.generateMipmaps();
    }
  }
  updateFromElement(
    data: TextureImageElement,
    xOffset: number,
    yOffset: number,
    x: number,
    y: number,
    width: number,
    height: number
  ): void {
    if (this._device.isContextLost()) {
      return;
    }
    if (!this._object) {
      this.allocInternal(this._format!, this._width, this._height, 1, this._mipLevelCount);
    }
    const params = (this.getTextureCaps() as WebGLTextureCaps).getTextureFormatInfo(this._format!);
    this._device.bindTexture(textureTargetMap[this._target], 0, this);
    //this._device.context.bindTexture(textureTargetMap[this._target], this._object);
    this._device.context.pixelStorei(this._device.context.UNPACK_ALIGNMENT, 1);
    if (x === 0 && y === 0 && width === data.width && height === data.height) {
      this._device.context.texSubImage2D(
        textureTargetMap[this._target],
        0,
        xOffset,
        yOffset,
        params.glFormat,
        params.glType[0],
        data
      );
    } else {
      const cvs = document.createElement('canvas');
      cvs.width = width;
      cvs.height = height;
      const ctx = cvs.getContext('2d')!;
      ctx.drawImage(data, x, y, width, height, 0, 0, width, height);
      this._device.context.texSubImage2D(
        textureTargetMap[this._target],
        0,
        xOffset,
        yOffset,
        params.glFormat,
        params.glType[0],
        cvs
      );
      cvs.width = 0;
      cvs.height = 0;
    }
    if (this._mipLevelCount > 1) {
      this.generateMipmaps();
    }
  }
  async readPixels(
    x: number,
    y: number,
    w: number,
    h: number,
    faceOrLevel: number,
    mipLevel: number,
    buffer: TypedArray
  ) {
    if (faceOrLevel !== 0) {
      throw new Error(`Texture2D.readPixels(): parameter 'faceOrLayer' must be 0`);
    }
    if (mipLevel >= this.mipLevelCount || mipLevel < 0) {
      throw new Error(`Texture2D.readPixels(): invalid miplevel: ${mipLevel}`);
    }
    if (!this.device.isContextLost() && !this.disposed) {
      const fb = this._getFramebufferForRead(0, mipLevel);
      this._device.pushDeviceStates();
      this._device.setFramebuffer(fb);
      const result = this._device.readPixels(0, x, y, w, h, buffer);
      this._device.popDeviceStates();
      return result;
    }
  }
  readPixelsToBuffer(
    x: number,
    y: number,
    w: number,
    h: number,
    faceOrLevel: number,
    mipLevel: number,
    buffer: GPUDataBuffer
  ): void {
    if (faceOrLevel !== 0) {
      throw new Error(`Texture2D.readPixelsToBuffer(): parameter 'faceOrLayer' must be 0`);
    }
    if (mipLevel >= this.mipLevelCount || mipLevel < 0) {
      throw new Error(`Texture2D.readPixelsToBuffer(): invalid miplevel: ${mipLevel}`);
    }
    if (!this.device.isContextLost() && !this.disposed) {
      const fb = this._device.createFrameBuffer([this], null);
      fb.setColorAttachmentMipLevel(0, mipLevel);
      fb.setColorAttachmentGenerateMipmaps(0, false);
      this._device.pushDeviceStates();
      this._device.setFramebuffer(fb);
      this._device.readPixelsToBuffer(0, x, y, w, h, buffer);
      this._device.popDeviceStates();
      fb.dispose();
    }
  }
  loadFromElement(element: TextureImageElement, sRGB: boolean, creationFlags?: number) {
    this._flags = Number(creationFlags) || 0;
    if (this._flags & GPUResourceUsageFlags.TF_WRITABLE) {
      console.error(new Error('webgl device does not support storage texture'));
    } else {
      const format = sRGB ? 'rgba8unorm-srgb' : 'rgba8unorm';
      this.loadImage(element, format);
    }
  }
  createEmpty(format: TextureFormat, width: number, height: number, creationFlags?: number): void {
    this._flags = Number(creationFlags) || 0;
    if (this._flags & GPUResourceUsageFlags.TF_WRITABLE) {
      console.error(new Error('webgl device does not support storage texture'));
    } else {
      this.loadEmpty(format, width, height, 0);
    }
  }
  generateMipmaps() {
    if (this._object && this._mipLevelCount > 1) {
      const target = textureTargetMap[this._target];
      this._device.bindTexture(target, 0, this);
      //this._device.context.bindTexture(target, this._object);
      this._device.context.generateMipmap(target);
    }
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
    } else if (format === 'bgra8unorm-srgb') {
      format = 'rgba8unorm-srgb';
      swizzle = true;
    }
    const width = levels.width;
    const height = levels.height;
    const mipLevelCount = levels.mipLevels;
    if (levels.isCompressed) {
      if (!this.getTextureCaps().supportS3TCSRGB || !this.getTextureCaps().supportS3TC) {
        console.warn('No s3tc compression format support');
        return;
      }
    }
    this.allocInternal(format, width, height, 1, mipLevelCount);
    if (!this._device.isContextLost()) {
      const params = (this.getTextureCaps() as WebGLTextureCaps).getTextureFormatInfo(this._format!);
      const target = textureTargetMap[this._target];
      this._device.bindTexture(target, 0, this);
      //this._device.context.bindTexture(target, this._object);
      (this.device as WebGLDevice).clearErrors();
      for (let i = 0; i < this._mipLevelCount; i++) {
        if (levels.isCompressed) {
          this._device.context.compressedTexSubImage2D(
            target,
            i,
            0,
            0,
            levels.mipDatas[0][i].width,
            levels.mipDatas[0][i].height,
            params.glInternalFormat,
            levels.mipDatas[0][i].data
          );
        } else {
          if (swizzle) {
            // convert bgra to rgba
            for (let j = 0; j < levels.mipDatas[0][i].width * levels.mipDatas[0][i].height; j++) {
              const t = levels.mipDatas[0][i].data[j * 4];
              levels.mipDatas[0][i].data[j * 4] = levels.mipDatas[0][i].data[j * 4 + 2];
              levels.mipDatas[0][i].data[j * 4 + 2] = t;
            }
          }
          this._device.context.texSubImage2D(
            target,
            i,
            0,
            0,
            levels.mipDatas[0][i].width,
            levels.mipDatas[0][i].height,
            params.glFormat,
            params.glType[0],
            levels.mipDatas[0][i].data
          );
        }
        const err = (this.device as WebGLDevice).getError();
        if (err) {
          console.error(err);
          return;
        }
      }
    }
  }
  /** @internal */
  private loadImage(element: TextureImageElement, format: TextureFormat): void {
    this.allocInternal(format, Number(element.width), Number(element.height), 1, 0);
    if (!this._device.isContextLost()) {
      const params = (this.getTextureCaps() as WebGLTextureCaps).getTextureFormatInfo(this._format!);
      (this.device as WebGLDevice).clearErrors();
      const target = textureTargetMap[this._target];
      this._device.bindTexture(target, 0, this);
      this._device.context.pixelStorei(this._device.context.UNPACK_ALIGNMENT, 4);
      this._device.context.texSubImage2D(target, 0, 0, 0, params.glFormat, params.glType[0], element);
      if (this._mipLevelCount > 1) {
        this.generateMipmaps();
      }
    }
  }
}
