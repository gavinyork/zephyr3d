import type { Immutable, Nullable, RequireOptionals, TypedArray } from '@zephyr3d/base';
import { isPowerOf2 } from '@zephyr3d/base';
import type {
  SamplerOptions,
  BaseTexture,
  TextureType,
  TextureFormat,
  GPUDataBuffer,
  FrameBuffer
} from '@zephyr3d/device';
import {
  isCompressedTextureFormat,
  hasDepthChannel,
  isFloatTextureFormat,
  isIntegerTextureFormat,
  isSignedTextureFormat,
  GPUResourceUsageFlags,
  isSRGBTextureFormat,
  getTextureFormatBlockWidth,
  getTextureFormatBlockHeight,
  getTextureFormatBlockSize
} from '@zephyr3d/device';
import { WebGLGPUObject } from './gpuobject_webgl';
import { cubeMapFaceMap, textureTargetMap } from './constants_webgl';
import { isWebGL2 } from './utils';
import { WebGLEnum } from './webgl_enum';
import type { WebGLTextureCaps, TextureFormatInfoWebGL } from './capabilities_webgl';
import type { WebGLDevice } from './device_webgl';

export abstract class WebGLBaseTexture extends WebGLGPUObject<WebGLTexture> {
  protected _target: TextureType;
  protected _memCost: number;
  protected _flags: number;
  protected _width: number;
  protected _height: number;
  protected _depth: number;
  protected _format: Nullable<TextureFormat>;
  protected _mipLevelCount: number;
  protected _samplerOptions: Nullable<RequireOptionals<SamplerOptions>>;
  protected _webgl1fallback: boolean;
  protected _readFrameBuffers: FrameBuffer[][];
  constructor(device: WebGLDevice, target?: TextureType) {
    super(device);
    this._target = target || '2d';
    this._memCost = 0;
    this._flags = 0;
    this._width = 0;
    this._height = 0;
    this._depth = 1;
    this._format = null;
    this._mipLevelCount = 0;
    this._samplerOptions = null;
    this._webgl1fallback = false;
    this._readFrameBuffers = [];
  }
  get target() {
    return this._target;
  }
  get width() {
    return this._width;
  }
  get height() {
    return this._height;
  }
  get depth() {
    return this._depth;
  }
  get memCost() {
    return this._memCost;
  }
  get format() {
    return this._format!;
  }
  get mipLevelCount() {
    return this._mipLevelCount;
  }
  get samplerOptions(): Nullable<Immutable<SamplerOptions>> {
    return this._samplerOptions;
  }
  set samplerOptions(options: Nullable<Immutable<SamplerOptions>>) {
    if (this._format) {
      const params = (this.getTextureCaps() as WebGLTextureCaps).getTextureFormatInfo(this._format);
      this._samplerOptions = options
        ? Object.assign({}, this._getSamplerOptions(params, !!options.compare), options)
        : null;
    } else {
      console.log('Set sampler options failed: Texture not initialized');
    }
  }
  get isWebGL1Fallback() {
    return this._webgl1fallback;
  }
  isFilterable() {
    if (!this._format || !this.getTextureCaps().getTextureFormatInfo(this._format)?.filterable) {
      return false;
    }
    if (!(this.device as WebGLDevice).isWebGL2 && !isPowerOf2(this._width) && !isPowerOf2(this._height)) {
      return false;
    }
    return true;
  }
  destroy() {
    if (this._object) {
      this._device.context.deleteTexture(this._object);
      this._device.invalidateBindingTextures();
      this._object = null;
      this._device.updateVideoMemoryCost(-this._memCost);
      for (const x of this._readFrameBuffers) {
        if (x) {
          for (const fb of x) {
            if (fb) {
              fb.dispose();
            }
          }
        }
      }
      this._readFrameBuffers = [];
      this._memCost = 0;
    }
  }
  restore() {
    if (!this._object && !this._device.isContextLost()) {
      this.init();
    }
  }
  isTexture(): this is BaseTexture {
    return true;
  }
  getTextureCaps() {
    return this._device.getDeviceCaps().textureCaps;
  }
  isSRGBFormat() {
    return !!this._format && isSRGBTextureFormat(this._format);
  }
  isFloatFormat() {
    return !!this._format && isFloatTextureFormat(this._format);
  }
  isIntegerFormat() {
    return !!this._format && isIntegerTextureFormat(this._format);
  }
  isSignedFormat() {
    return !!this._format && isSignedTextureFormat(this._format);
  }
  isCompressedFormat() {
    return !!this._format && isCompressedTextureFormat(this._format);
  }
  isDepth() {
    return !!this._format && hasDepthChannel(this._format);
  }
  getDefaultSampler(shadow: boolean) {
    if (this._format) {
      const params = (this.getTextureCaps() as WebGLTextureCaps).getTextureFormatInfo(this._format);
      return this._device.createSampler(
        !this._samplerOptions || !this._samplerOptions.compare !== !shadow
          ? this._getSamplerOptions(params, shadow)
          : this._samplerOptions
      );
    } else {
      throw new Error('Get default sampler failed: texture not initialized');
    }
  }
  protected _getFramebufferForRead(faceOrLevel: number, mipLevel: number) {
    let faceFramebuffers = this._readFrameBuffers[faceOrLevel];
    if (!faceFramebuffers) {
      faceFramebuffers = [];
      this._readFrameBuffers[faceOrLevel] = faceFramebuffers;
    }
    let framebuffer = faceFramebuffers[mipLevel];
    if (!framebuffer) {
      framebuffer = this._device.createFrameBuffer([this], null);
      if (this.isTextureCube()) {
        framebuffer.setColorAttachmentCubeFace(0, faceOrLevel);
      } else if (this.isTexture2DArray() || this.isTexture3D()) {
        framebuffer.setColorAttachmentLayer(0, faceOrLevel);
      }
      framebuffer.setColorAttachmentMipLevel(0, mipLevel);
      framebuffer.setColorAttachmentGenerateMipmaps(0, false);
      faceFramebuffers[mipLevel] = framebuffer;
    }
    return framebuffer;
  }
  abstract generateMipmaps(): void;
  abstract init(): void;
  abstract readPixels(
    x: number,
    y: number,
    w: number,
    h: number,
    faceOrLayer: number,
    mipLevel: number,
    buffer: TypedArray
  ): Promise<void>;
  abstract readPixelsToBuffer(
    x: number,
    y: number,
    w: number,
    h: number,
    faceOrLayer: number,
    mipLevel: number,
    buffer: GPUDataBuffer
  ): void;
  /** @internal */
  protected allocInternal(
    format: TextureFormat,
    width: number,
    height: number,
    depth: number,
    numMipLevels: number
  ) {
    if (!this._device.isWebGL2 && (!isPowerOf2(width) || !isPowerOf2(height))) {
      numMipLevels = 1;
      this._webgl1fallback = true;
    } else {
      this._webgl1fallback = false;
    }
    this._device.setCurrentSamplerForTexture(this, null);
    if (numMipLevels === 0) {
      numMipLevels = this._calcMipLevelCount(format, width, height, depth);
    } else if (numMipLevels !== 1) {
      let size = Math.max(width, height);
      if (this.isTexture3D()) {
        size = Math.max(size, depth);
      }
      const autoMipLevelCount = Math.floor(Math.log2(size)) + 1; //this._calcMipLevelCount(format, width, height, depth);
      if (!Number.isInteger(numMipLevels) || numMipLevels < 0 || numMipLevels > autoMipLevelCount) {
        numMipLevels = autoMipLevelCount;
      }
    }
    if (
      this._object &&
      (this._format !== format || this._width !== width || this._height !== height || this._depth !== depth,
      this._mipLevelCount !== numMipLevels)
    ) {
      const obj = this._object;
      this._device.runNextFrame(() => {
        this._device.context.deleteTexture(obj);
        this._device.invalidateBindingTextures();
      });
      this._object = null;
    }
    if (!this._object) {
      this._format = format;
      this._width = width;
      this._height = height;
      this._depth = depth;
      this._mipLevelCount = numMipLevels;
      if (!this._device.isContextLost()) {
        this._object = this._device.context.createTexture();
        const gl = this._device.context;
        this._device.bindTexture(textureTargetMap[this._target], 0, this);
        //gl.bindTexture(textureTargetMap[this._target], this._object);
        const params = (this.getTextureCaps() as WebGLTextureCaps).getTextureFormatInfo(this._format);
        if (isWebGL2(gl) && !this.isTextureVideo()) {
          if (!this.isTexture3D() && !this.isTexture2DArray()) {
            gl.texStorage2D(
              textureTargetMap[this._target],
              this._mipLevelCount,
              params.glInternalFormat,
              this._width,
              this._height
            );
          } else {
            gl.texStorage3D(
              textureTargetMap[this._target],
              this._mipLevelCount,
              params.glInternalFormat,
              this._width,
              this._height,
              this._depth
            );
          }
          this._device.context.texParameteri(textureTargetMap[this._target], WebGLEnum.TEXTURE_BASE_LEVEL, 0);
          this._device.context.texParameteri(
            textureTargetMap[this._target],
            WebGLEnum.TEXTURE_MAX_LEVEL,
            this._mipLevelCount - 1
          );
        } else {
          let w = this._width;
          let h = this._height;
          const isCompressed = isCompressedTextureFormat(this._format);
          const blockWidth = getTextureFormatBlockWidth(this._format);
          const blockHeight = getTextureFormatBlockHeight(this._format);
          const blockSize = getTextureFormatBlockSize(this._format);
          for (let mip = 0; mip < numMipLevels; mip++) {
            const data = isCompressed
              ? new Uint8Array(Math.ceil(w / blockWidth) * Math.ceil(h / blockHeight) * blockSize)
              : null;
            data?.fill(0xff);
            if (this.isTextureCube()) {
              for (let face = 0; face < 6; face++) {
                const faceTarget = cubeMapFaceMap[face as keyof typeof cubeMapFaceMap];
                if (isCompressed) {
                  this._device.context.compressedTexImage2D(
                    faceTarget,
                    mip,
                    params.glInternalFormat,
                    w,
                    h,
                    0,
                    data!
                  );
                } else {
                  this._device.context.texImage2D(
                    faceTarget,
                    mip,
                    params.glInternalFormat,
                    w,
                    h,
                    0,
                    params.glFormat,
                    params.glType[0],
                    null
                  );
                }
              }
            } else {
              if (isCompressed) {
                this._device.context.compressedTexImage2D(
                  textureTargetMap[this._target],
                  mip,
                  params.glInternalFormat,
                  w,
                  h,
                  0,
                  data!
                );
              } else {
                this._device.context.texImage2D(
                  textureTargetMap[this._target],
                  mip,
                  params.glInternalFormat,
                  w,
                  h,
                  0,
                  params.glFormat,
                  params.glType[0],
                  null
                );
              }
            }
            w = Math.max(w >> 1, 1);
            h = Math.max(h >> 1, 1);
          }
        }
        const k = this.isTextureCube() ? 6 : 1;
        const memCost = (this.getTextureCaps() as WebGLTextureCaps).calcMemoryUsage(
          this._format,
          params.glType[0],
          this._width * this._height * this._depth * k
        );
        this._device.updateVideoMemoryCost(memCost - this._memCost);
        this._memCost = memCost;
      }
    }
  }
  /** @internal */
  protected _calcMipLevelCount(format: TextureFormat, width: number, height: number, depth: number) {
    if (hasDepthChannel(format) || this.isTextureVideo()) {
      return 1;
    }
    if (this._flags & GPUResourceUsageFlags.TF_NO_MIPMAP) {
      return 1;
    }
    if (!this._device.isWebGL2 && (!isPowerOf2(width) || !isPowerOf2(height))) {
      return 1;
    }
    const params = (this.getTextureCaps() as WebGLTextureCaps).getTextureFormatInfo(format);
    if (!params || !params.renderable) {
      return 1;
    }
    let size = Math.max(width, height);
    if (this.isTexture3D()) {
      size = Math.max(size, depth);
    }
    return Math.floor(Math.log2(size)) + 1;
  }
  /** @internal */
  protected _getSamplerOptions(params: Immutable<TextureFormatInfoWebGL>, shadow: boolean) {
    const comparison = this.isDepth() && shadow;
    const filterable = params.filterable || comparison;
    const magFilter = filterable ? 'linear' : 'nearest';
    const minFilter = filterable ? 'linear' : 'nearest';
    const mipFilter = this._mipLevelCount > 1 ? (filterable ? 'linear' : 'nearest') : 'none';
    return {
      addressU: 'clamp',
      addressV: 'clamp',
      addressW: 'clamp',
      magFilter,
      minFilter,
      mipFilter,
      lodMin: 0,
      lodMax: 32,
      maxAnisotropy: 1,
      compare: comparison ? 'lt' : null
    } as const;
  }
}
