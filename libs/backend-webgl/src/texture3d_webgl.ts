import type { Texture3D, GPUDataBuffer, TextureFormat, TextureMipmapData } from '@zephyr3d/device';
import { GPUResourceUsageFlags } from '@zephyr3d/device';
import { textureTargetMap } from './constants_webgl';
import { WebGLBaseTexture } from './basetexture_webgl';
import type { TypedArray } from '@zephyr3d/base';
import type { WebGLDevice } from './device_webgl';
import type { WebGLTextureCaps } from './capabilities_webgl';

export class WebGLTexture3D extends WebGLBaseTexture implements Texture3D<WebGLTexture> {
  constructor(device: WebGLDevice) {
    if (!device.isWebGL2) {
      throw new Error('device does not support 3D texture');
    }
    super(device, '3d');
  }
  get depth(): number {
    return this._depth;
  }
  isTexture3D(): this is Texture3D {
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
    this._device.bindTexture(textureTargetMap[this._target], 0, this);
    //gl.bindTexture(textureTargetMap[this._target], this._object);
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
      this._device.bindTexture(target, 0, this);
      //this._device.context.bindTexture(target, this._object);
      this._device.context.generateMipmap(target);
    }
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
    if (!this.device.isContextLost() && !this.disposed) {
      const fb = this._getFramebufferForRead(layer, mipLevel);
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
    layer: number,
    mipLevel: number,
    buffer: GPUDataBuffer
  ): void {
    if (mipLevel !== 0) {
      throw new Error(`Texture3D.readPixelsToBuffer(): parameter mipLevel must be 0`);
    }
    const fb = this._device.createFrameBuffer([this], null);
    fb.setColorAttachmentLayer(0, layer);
    fb.setColorAttachmentGenerateMipmaps(0, false);
    this._device.pushDeviceStates();
    this._device.setFramebuffer(fb);
    this._device.readPixelsToBuffer(0, x, y, w, h, buffer);
    this._device.popDeviceStates();
    fb.dispose();
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
        console.error('Texture2DArray.loadLevels(): No s3tc compression format support');
        return;
      }
    }
    this.allocInternal(format, width, height, levels.arraySize, mipLevelCount);
    if (!this._device.isContextLost()) {
      const params = (this.getTextureCaps() as WebGLTextureCaps).getTextureFormatInfo(this._format);
      const gl = this._device.context as WebGL2RenderingContext;
      this._device.bindTexture(textureTargetMap[this._target], 0, this);
      //gl.bindTexture(textureTargetMap[this._target], this._object);
      (this.device as WebGLDevice).clearErrors();
      for (let layer = 0; layer < depth; layer++) {
        if (levels.mipDatas[layer].length !== levels.mipLevels) {
          console.error(`Texture2DArray.loadLevels() failed: Invalid texture data`);
          return;
        }
        for (let i = 0; i < levels.mipLevels; i++) {
          if (levels.isCompressed) {
            gl.compressedTexSubImage3D(
              gl.TEXTURE_3D,
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
              gl.TEXTURE_3D,
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
  /** @internal */
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
