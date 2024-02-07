import type { CubeFace, TypedArray } from '@zephyr3d/base';
import type { TextureMipmapData, TextureCube, TextureImageElement, GPUDataBuffer, TextureFormat } from '@zephyr3d/device';
import { linearTextureFormatToSRGB, GPUResourceUsageFlags } from '@zephyr3d/device';
import { WebGLBaseTexture } from './basetexture_webgl';
import { textureTargetMap, cubeMapFaceMap } from './constants_webgl';
import type { WebGLDevice } from './device_webgl';
import type { WebGLTextureCaps } from './capabilities_webgl';

export class WebGLTextureCube extends WebGLBaseTexture implements TextureCube<WebGLTexture> {
  constructor(device: WebGLDevice) {
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
    const params = (this.getTextureCaps() as WebGLTextureCaps).getTextureFormatInfo(this._format);
    this._device.context.bindTexture(textureTargetMap[this._target], this._object);
    this._device.context.pixelStorei(this._device.context.UNPACK_ALIGNMENT, 1);
    this._device.context.texSubImage2D(
      cubeMapFaceMap[face],
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
    face: number,
    x: number,
    y: number,
    width: number,
    height: number
  ): void {
    if (this._device.isContextLost()) {
      return;
    }
    if (!this._object) {
      this.allocInternal(this._format, this._width, this._height, 1, this._mipLevelCount);
    }
    const params = (this.getTextureCaps() as WebGLTextureCaps).getTextureFormatInfo(this._format);
    this._device.context.bindTexture(textureTargetMap[this._target], this._object);
    this._device.context.pixelStorei(this._device.context.UNPACK_ALIGNMENT, 1);
    if (x === 0 && y === 0 && width === data.width && height === data.height) {
      this._device.context.texSubImage2D(
        cubeMapFaceMap[face],
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
      const ctx = cvs.getContext('2d');
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
  createEmpty(format: TextureFormat, size: number, creationFlags?: number): void {
    this._flags = Number(creationFlags) || 0;
    if (this._flags & GPUResourceUsageFlags.TF_WRITABLE) {
      console.error(new Error('webgl device does not support storage texture'));
    } else {
      this.loadEmpty(format, size, 0);
    }
  }
  readPixels(x: number, y: number, w: number, h: number, face: number, mipLevel: number, buffer: TypedArray): Promise<void> {
    if (mipLevel < 0 || mipLevel >= this.mipLevelCount) {
      throw new Error(`TextureCube.readPixels(): invalid miplevel: ${mipLevel}`);
    }
    return new Promise<void>(resolve => {
      const fb =this._device.createFrameBuffer([this], null);
      fb.setColorAttachmentCubeFace(0, face);
      fb.setColorAttachmentMipLevel(0, mipLevel);
      fb.setColorAttachmentGenerateMipmaps(0, false);
      this._device.pushDeviceStates();
      this._device.setFramebuffer(fb);
      this._device.readPixels(0, x, y, w, h, buffer).then(() => {
        fb.dispose();
        resolve();
      });
      this._device.popDeviceStates();
    });
  }
  readPixelsToBuffer(x: number, y: number, w: number, h: number, face: number, mipLevel: number, buffer: GPUDataBuffer): void {
    if (mipLevel < 0 || mipLevel >= this.mipLevelCount) {
      throw new Error(`TextureCube.readPixels(): invalid miplevel: ${mipLevel}`);
    }
    const fb =this._device.createFrameBuffer([this], null);
    fb.setColorAttachmentCubeFace(0, face);
    fb.setColorAttachmentMipLevel(0, mipLevel);
    fb.setColorAttachmentGenerateMipmaps(0, false);
    this._device.pushDeviceStates();
    this._device.setFramebuffer(fb);
    this._device.readPixelsToBuffer(0, x, y, w, h, buffer);
    this._device.popDeviceStates();
    fb.dispose();
  }
  isTextureCube(): this is TextureCube {
    return true;
  }
  generateMipmaps() {
    if (this._object && this._mipLevelCount > 1) {
      const target = textureTargetMap[this._target];
      this._device.context.bindTexture(target, this._object);
      this._device.context.generateMipmap(target);
    }
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
      (this.device as WebGLDevice).clearErrors();
      this._device.context.bindTexture(textureTargetMap[this._target], this._object);
      const params = (this.getTextureCaps() as WebGLTextureCaps).getTextureFormatInfo(this._format);
      for (let face = 0; face < 6; face++) {
        this._device.context.texSubImage2D(
          cubeMapFaceMap[face],
          0,
          0,
          0,
          params.glFormat,
          params.glType[0],
          images[face]
        );
        const err = (this.device as WebGLDevice).getError();
        if (err) {
          console.error(err);
          return;
        }
      }
      if (this._mipLevelCount > 1) {
        this.generateMipmaps();
      }
    }
  }
  private loadLevels(levels: TextureMipmapData, sRGB: boolean): void {
    const format = sRGB ? linearTextureFormatToSRGB(levels.format) : levels.format;
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
      const params = (this.getTextureCaps() as WebGLTextureCaps).getTextureFormatInfo(this._format);
      this._device.context.bindTexture(textureTargetMap[this._target], this._object);
      (this.device as WebGLDevice).clearErrors();
      for (let face = 0; face < 6; face++) {
        const faceTarget = cubeMapFaceMap[face];
        if (this._mipLevelCount > 1 && levels.mipDatas[face].length !== this._mipLevelCount) {
          console.log(`invalid texture data`);
          return;
        }
        for (let i = 0; i < this._mipLevelCount; i++) {
          if (levels.isCompressed) {
            this._device.context.compressedTexSubImage2D(
              faceTarget,
              i,
              0,
              0,
              levels.mipDatas[face][i].width,
              levels.mipDatas[face][i].height,
              params.glInternalFormat,
              levels.mipDatas[face][i].data
            );
          } else {
            this._device.context.texSubImage2D(
              faceTarget,
              i,
              0,
              0,
              levels.mipDatas[face][i].width,
              levels.mipDatas[face][i].height,
              params.glFormat,
              params.glType[0],
              levels.mipDatas[face][i].data
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
  }
}
