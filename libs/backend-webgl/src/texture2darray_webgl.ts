import { linearTextureFormatToSRGB, GPUResourceUsageFlags, TextureImageElement, Texture2DArray, GPUDataBuffer, TextureFormat, TextureMipmapData } from '@zephyr3d/device';
import { textureTargetMap } from './constants_webgl';
import { WebGLBaseTexture } from './basetexture_webgl';
import type { TypedArray } from '@zephyr3d/base';
import type { WebGLDevice } from './device_webgl';
import type { WebGLTextureCaps } from './capabilities_webgl';

export class WebGLTexture2DArray extends WebGLBaseTexture implements Texture2DArray<WebGLTexture> {
  constructor(device: WebGLDevice) {
    if (!device.isWebGL2) {
      throw new Error('device does not support 2d texture array');
    }
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
    const params = (this.getTextureCaps() as WebGLTextureCaps).getTextureFormatInfo(this._format);
    const gl = this._device.context as WebGL2RenderingContext;
    gl.bindTexture(textureTargetMap[this._target], this._object);
    gl.pixelStorei(this._device.context.UNPACK_ALIGNMENT, 1);
    gl.texSubImage3D(
      textureTargetMap[this._target],
      0,
      xOffset,
      yOffset,
      zOffset,
      width,
      height,
      depth,
      params.glFormat,
      params.glType[0],
      data
    );
    if (this._mipLevelCount > 1) {
      this.generateMipmaps();
    }
  }
  createWithMipmapData(data: TextureMipmapData, creationFlags?: number): void {
    if (!data.arraySize) {
      console.error('Texture2DArray.createWithMipmapData() failed: Data is not texture array');
    } else {
      this._flags = Number(creationFlags) || 0;
      if (this._flags & GPUResourceUsageFlags.TF_WRITABLE) {
        console.error('Texture2DArray.createWithMipmapData() failed: Webgl device does not support storage texture');
      } else {
        this.loadLevels(data);
      }
    }
  }
  private loadLevels(levels: TextureMipmapData): void {
    const format = levels.format;
    const width = levels.width;
    const height = levels.height;
    const mipLevelCount = levels.mipLevels === 1 && !(this._flags & GPUResourceUsageFlags.TF_NO_MIPMAP) ? this._calcMipLevelCount(levels.format, width, height, 1) : levels.mipLevels;
    if (levels.isCompressed) {
      if (!this.getTextureCaps().supportS3TCSRGB || !this.getTextureCaps().supportS3TC) {
        console.error('Texture2DArray.loadLevels(): No s3tc compression format support');
        return;
      }
    }
    this.allocInternal(format, width, height, levels.arraySize, mipLevelCount);
    if (!this._device.isContextLost()) {
      const params = (this.getTextureCaps() as WebGLTextureCaps).getTextureFormatInfo(this._format);
      const gl = this._device.context as WebGL2RenderingContext;
      gl.bindTexture(textureTargetMap[this._target], this._object);
      (this.device as WebGLDevice).clearErrors();
      for (let layer = 0; layer < levels.arraySize; layer++) {
        if (levels.mipDatas[layer].length !== levels.mipLevels) {
          console.log(`Texture2DArray.loadLevels() failed: Invalid texture data`);
          return;
        }
        for (let i = 0; i < levels.mipLevels; i++) {
          if (levels.isCompressed) {
            gl.compressedTexSubImage3D(
              gl.TEXTURE_2D_ARRAY,
              i,
              0,
              0,
              layer,
              levels.mipDatas[layer][i].width,
              levels.mipDatas[layer][i].height,
              1,
              params.glInternalFormat,
              levels.mipDatas[layer][i].data
            );
          } else {
            gl.texSubImage3D(
              gl.TEXTURE_2D_ARRAY,
              i,
              0,
              0,
              layer,
              levels.mipDatas[layer][i].width,
              levels.mipDatas[layer][i].height,
              1,
              params.glFormat,
              params.glType[0],
              levels.mipDatas[layer][i].data
            );
          }
          const err = (this.device as WebGLDevice).getError();
          if (err) {
            console.error(err);
            return;
          }
        }
      }
      if (levels.mipLevels !== this.mipLevelCount) {
        this.generateMipmaps();
      }
    }
  }
  updateFromElement(
    data: TextureImageElement,
    xOffset: number,
    yOffset: number,
    layerIndex: number,
    x: number,
    y: number,
    width: number,
    height: number
  ): void {
    if (this._device.isContextLost()) {
      return;
    }
    if (!this._object) {
      this.allocInternal(this._format, this._width, this._height, this._depth, this._mipLevelCount);
    }
    const params = (this.getTextureCaps() as WebGLTextureCaps).getTextureFormatInfo(this._format);
    const gl = this._device.context as WebGL2RenderingContext;
    gl.bindTexture(textureTargetMap[this._target], this._object);
    gl.pixelStorei(this._device.context.UNPACK_ALIGNMENT, 1);
    if (x === 0 && y === 0 && width === data.width && height === data.height) {
      gl.texSubImage3D(
        textureTargetMap[this._target],
        0,
        xOffset,
        yOffset,
        layerIndex,
        width,
        height,
        1,
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
      gl.texSubImage3D(
        textureTargetMap[this._target],
        0,
        xOffset,
        yOffset,
        layerIndex,
        width,
        height,
        1,
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
  createEmpty(
    format: TextureFormat,
    width: number,
    height: number,
    depth: number,
    creationFlags?: number
  ): void {
    this._flags = Number(creationFlags) || 0;
    if (this._flags & GPUResourceUsageFlags.TF_WRITABLE) {
      console.error(new Error('webgl device does not support storage texture'));
    } else {
      this.loadEmpty(format, width, height, depth, 0);
    }
  }
  generateMipmaps() {
    if (this._object && this._mipLevelCount > 1) {
      const target = textureTargetMap[this._target];
      this._device.context.bindTexture(target, this._object);
      this._device.context.generateMipmap(target);
    }
  }
  readPixels(x: number, y: number, w: number, h: number, layer: number, mipLevel: number, buffer: TypedArray): Promise<void> {
    if (layer < 0 || layer >= this._depth) {
      throw new Error(`Texture2DArray.readPixels(): invalid layer: ${layer}`);
    }
    if (mipLevel < 0 || mipLevel >= this.mipLevelCount) {
      throw new Error(`Texture2DArray.readPixels(): invalid miplevel: ${mipLevel}`);
    }
    return new Promise<void>(resolve => {
      const fb =this._device.createFrameBuffer([this], null);
      fb.setColorAttachmentLayer(0, layer);
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
  readPixelsToBuffer(x: number, y: number, w: number, h: number, layer: number, mipLevel: number, buffer: GPUDataBuffer): void {
    if (layer < 0 || layer >= this._depth) {
      throw new Error(`Texture2DArray.readPixelsToBuffer(): invalid layer: ${layer}`);
    }
    if (mipLevel < 0 || mipLevel >= this.mipLevelCount) {
      throw new Error(`Texture2DArray.readPixelsToBuffer(): invalid miplevel: ${mipLevel}`);
    }
    const fb =this._device.createFrameBuffer([this], null);
    fb.setColorAttachmentLayer(0, layer);
    fb.setColorAttachmentMipLevel(0, mipLevel);
    fb.setColorAttachmentGenerateMipmaps(0, false);
    this._device.pushDeviceStates();
    this._device.setFramebuffer(fb);
    this._device.readPixelsToBuffer(0, x, y, w, h, buffer);
    this._device.popDeviceStates();
    fb.dispose();
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
