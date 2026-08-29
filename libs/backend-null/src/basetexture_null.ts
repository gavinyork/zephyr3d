import type { Immutable, Nullable, RequireOptionals, TypedArray } from '@zephyr3d/base';
import { DEPTH_COMPARE_CLOSER, isPowerOf2 } from '@zephyr3d/base';
import type {
  BaseTexture,
  GPUDataBuffer,
  SamplerOptions,
  TextureFormat,
  TextureFormatInfo,
  TextureType
} from '@zephyr3d/device';
import {
  GPUResourceUsageFlags,
  getTextureFormatBlockHeight,
  getTextureFormatBlockSize,
  getTextureFormatBlockWidth,
  hasDepthChannel,
  isCompressedTextureFormat,
  isFloatTextureFormat,
  isIntegerTextureFormat,
  isSRGBTextureFormat,
  isSignedTextureFormat
} from '@zephyr3d/device';
import { NullGPUObject } from './gpuobject_null';
import type { NullDevice } from './device_null';

/**
 * Base class of all textures created by a null device
 *
 * @remarks
 * Texture contents are kept in system memory, so data written by the update
 * methods can be read back with {@link NullBaseTexture.readPixels}. Level
 * storage is allocated lazily: a level that was never written reads back as
 * zeros.
 *
 * @public
 */
export abstract class NullBaseTexture extends NullGPUObject<unknown> {
  protected _target: TextureType;
  protected _memCost: number;
  protected _flags: number;
  protected _width: number;
  protected _height: number;
  protected _depth: number;
  protected _format: Nullable<TextureFormat>;
  protected _mipLevelCount: number;
  protected _samplerOptions: Nullable<RequireOptionals<SamplerOptions>>;
  protected _levelData: Map<string, Uint8Array<ArrayBuffer>>;
  protected _mipmapsGenerated: number;
  constructor(device: NullDevice, target?: TextureType) {
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
    this._levelData = new Map();
    this._mipmapsGenerated = 0;
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
  /** How many times mipmaps have been generated for this texture */
  get mipmapsGenerated() {
    return this._mipmapsGenerated;
  }
  get samplerOptions(): Nullable<Immutable<SamplerOptions>> {
    return this._samplerOptions;
  }
  set samplerOptions(options: Nullable<Immutable<SamplerOptions>>) {
    if (this._format) {
      const params = this.getTextureCaps().getTextureFormatInfo(this._format);
      this._samplerOptions = options
        ? Object.assign({}, this._getSamplerOptions(params, !!options.compare), options)
        : null;
    } else {
      console.error('Set sampler options failed: texture not initialized');
    }
  }
  isTexture(): this is BaseTexture {
    return true;
  }
  getTextureCaps() {
    return this._device.getDeviceCaps().textureCaps;
  }
  isFilterable() {
    if (!this._format || !this.getTextureCaps().getTextureFormatInfo(this._format)?.filterable) {
      return false;
    }
    if (this._device.type === 'webgl' && !isPowerOf2(this._width) && !isPowerOf2(this._height)) {
      return false;
    }
    return true;
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
  getDefaultSampler(comparison: boolean) {
    if (this._format) {
      const params = this.getTextureCaps().getTextureFormatInfo(this._format);
      return this._device.createSampler(
        !this._samplerOptions || !this._samplerOptions.compare !== !comparison
          ? this._getSamplerOptions(params, comparison)
          : this._samplerOptions
      );
    } else {
      throw new Error('Get default sampler failed: texture not initialized');
    }
  }
  generateMipmaps() {
    if (this._object && this._mipLevelCount > 1) {
      this._mipmapsGenerated++;
      this._device.recordGenerateMipmaps(this as unknown as BaseTexture);
    }
  }
  init() {
    this._alloc(this._format!, this._width, this._height, this._depth, this._mipLevelCount);
  }
  destroy() {
    if (this._object) {
      this._object = null;
      this._device.updateVideoMemoryCost(-this._memCost);
      this._memCost = 0;
      this._levelData.clear();
    }
  }
  restore() {
    if (!this._object) {
      this.init();
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
  ) {
    if (mipLevel >= this._mipLevelCount || mipLevel < 0) {
      throw new Error(`Texture.readPixels(): invalid miplevel: ${mipLevel}`);
    }
    this._device.recordReadPixels(faceOrLayer, x, y, w, h);
    this.readRegion(x, y, w, h, faceOrLayer, mipLevel, buffer);
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
    if (mipLevel >= this._mipLevelCount || mipLevel < 0) {
      throw new Error(`Texture.readPixelsToBuffer(): invalid miplevel: ${mipLevel}`);
    }
    this._device.recordReadPixels(faceOrLayer, x, y, w, h);
    const dest = new Uint8Array(buffer.byteLength);
    this.readRegion(x, y, w, h, faceOrLayer, mipLevel, dest);
    buffer.bufferSubData(0, dest);
  }
  /**
   * Reads back a texture region into a typed array.
   *
   * @param x - Left of the region in pixels
   * @param y - Top of the region in pixels
   * @param w - Width of the region in pixels
   * @param h - Height of the region in pixels
   * @param faceOrLayer - Cube face or array layer
   * @param mipLevel - The mipmap level
   * @param buffer - Destination buffer
   */
  readRegion(
    x: number,
    y: number,
    w: number,
    h: number,
    faceOrLayer: number,
    mipLevel: number,
    buffer: TypedArray
  ) {
    const format = this._format!;
    const blockWidth = getTextureFormatBlockWidth(format);
    const blockHeight = getTextureFormatBlockHeight(format);
    const blockSize = getTextureFormatBlockSize(format);
    const bytesPerRow = Math.ceil(w / blockWidth) * blockSize;
    const rows = Math.ceil(h / blockHeight);
    if (buffer.byteLength < bytesPerRow * rows) {
      throw new Error(
        `Texture.readPixels() failed: destination buffer must have at least ${bytesPerRow * rows} bytes`
      );
    }
    const dest = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    dest.fill(0, 0, bytesPerRow * rows);
    const level = this._levelData.get(this.levelKey(faceOrLayer, mipLevel));
    if (!level) {
      return;
    }
    const levelWidth = Math.max(this._width >> mipLevel, 1);
    const levelBytesPerRow = Math.ceil(levelWidth / blockWidth) * blockSize;
    const srcBlockX = Math.floor(x / blockWidth) * blockSize;
    const srcBlockY = Math.floor(y / blockHeight);
    for (let row = 0; row < rows; row++) {
      const srcOffset = (srcBlockY + row) * levelBytesPerRow + srcBlockX;
      if (srcOffset + bytesPerRow > level.byteLength) {
        break;
      }
      dest.set(level.subarray(srcOffset, srcOffset + bytesPerRow), row * bytesPerRow);
    }
  }
  /**
   * Gets the system memory copy of a texture level, or null if the level was
   * never written.
   *
   * @param faceOrLayer - Cube face or array layer
   * @param mipLevel - The mipmap level
   */
  getLevelData(faceOrLayer: number, mipLevel: number): Nullable<Uint8Array<ArrayBuffer>> {
    return this._levelData.get(this.levelKey(faceOrLayer, mipLevel)) ?? null;
  }
  /**
   * Replaces the system memory copy of a texture level.
   *
   * @param faceOrLayer - Cube face or array layer
   * @param mipLevel - The mipmap level
   * @param data - Level content, tightly packed
   */
  setLevelData(faceOrLayer: number, mipLevel: number, data: Uint8Array<ArrayBuffer>) {
    this._levelData.set(this.levelKey(faceOrLayer, mipLevel), data);
  }
  /** @internal */
  protected levelKey(faceOrLayer: number, mipLevel: number) {
    return `${faceOrLayer}:${mipLevel}`;
  }
  /**
   * Writes a pixel region into the system memory copy of a texture level.
   *
   * @param data - Source pixel data, tightly packed
   * @param xOffset - Left of the destination region in pixels
   * @param yOffset - Top of the destination region in pixels
   * @param width - Width of the region in pixels
   * @param height - Height of the region in pixels
   * @param faceOrLayer - Cube face or array layer
   * @param mipLevel - The mipmap level
   * @internal
   */
  protected writeRegion(
    data: TypedArray,
    xOffset: number,
    yOffset: number,
    width: number,
    height: number,
    faceOrLayer: number,
    mipLevel: number
  ) {
    if (!this._format) {
      throw new Error('Texture.update() failed: texture not initialized');
    }
    if (mipLevel < 0 || mipLevel >= Math.max(this._mipLevelCount, 1)) {
      throw new Error(`Texture.update() failed: invalid miplevel: ${mipLevel}`);
    }
    const format = this._format;
    const blockWidth = getTextureFormatBlockWidth(format);
    const blockHeight = getTextureFormatBlockHeight(format);
    const blockSize = getTextureFormatBlockSize(format);
    const levelWidth = Math.max(this._width >> mipLevel, 1);
    const levelHeight = Math.max(this._height >> mipLevel, 1);
    if (xOffset + width > levelWidth || yOffset + height > levelHeight) {
      throw new Error('Texture.update() failed: region out of bounds');
    }
    const levelBytesPerRow = Math.ceil(levelWidth / blockWidth) * blockSize;
    const levelRows = Math.ceil(levelHeight / blockHeight);
    const key = this.levelKey(faceOrLayer, mipLevel);
    let level = this._levelData.get(key);
    if (!level) {
      level = new Uint8Array(levelBytesPerRow * levelRows);
      this._levelData.set(key, level);
    }
    const srcBytesPerRow = Math.ceil(width / blockWidth) * blockSize;
    const srcRows = Math.ceil(height / blockHeight);
    const src = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    if (src.byteLength < srcBytesPerRow * srcRows) {
      throw new Error(
        `Texture.update() failed: source data must have at least ${srcBytesPerRow * srcRows} bytes`
      );
    }
    const dstBlockX = Math.floor(xOffset / blockWidth) * blockSize;
    const dstBlockY = Math.floor(yOffset / blockHeight);
    for (let row = 0; row < srcRows; row++) {
      level.set(
        src.subarray(row * srcBytesPerRow, (row + 1) * srcBytesPerRow),
        (dstBlockY + row) * levelBytesPerRow + dstBlockX
      );
    }
  }
  /**
   * Allocates the texture storage.
   *
   * @param format - The texture format
   * @param width - Texture width in pixels
   * @param height - Texture height in pixels
   * @param depth - Texture depth or array length
   * @param numMipLevels - Requested mipmap level count, 0 to derive a full chain
   * @internal
   */
  protected _alloc(
    format: TextureFormat,
    width: number,
    height: number,
    depth: number,
    numMipLevels: number
  ) {
    if (numMipLevels === 0) {
      numMipLevels = this._calcMipLevelCount(format, width, height, depth);
    } else if (numMipLevels !== 1) {
      const autoMipLevelCount = this._calcMaxMipLevelCount(width, height, depth);
      if (!Number.isInteger(numMipLevels) || numMipLevels < 0 || numMipLevels > autoMipLevelCount) {
        numMipLevels = autoMipLevelCount;
      }
    }
    if (
      this._object &&
      (this._format !== format ||
        this._width !== width ||
        this._height !== height ||
        this._depth !== depth ||
        this._mipLevelCount !== numMipLevels)
    ) {
      this._object = null;
      this._levelData.clear();
    }
    if (!this._object) {
      this._format = format;
      this._width = width;
      this._height = height;
      this._depth = depth;
      this._mipLevelCount = numMipLevels;
      this._object = this._createFakeObject();
      const memCost = this._calcMemoryUsage();
      this._device.updateVideoMemoryCost(memCost - this._memCost);
      this._memCost = memCost;
    }
  }
  /** @internal */
  protected _calcMemoryUsage() {
    const format = this._format!;
    const blockWidth = getTextureFormatBlockWidth(format);
    const blockHeight = getTextureFormatBlockHeight(format);
    const blockSize = getTextureFormatBlockSize(format);
    const faces = this.isTextureCube() ? 6 : 1;
    const layers = this._target === '2darray' ? this._depth : 1;
    let cost = 0;
    for (let level = 0; level < Math.max(this._mipLevelCount, 1); level++) {
      const w = Math.max(this._width >> level, 1);
      const h = Math.max(this._height >> level, 1);
      const d = this._target === '3d' ? Math.max(this._depth >> level, 1) : 1;
      cost += Math.ceil(w / blockWidth) * Math.ceil(h / blockHeight) * blockSize * d;
    }
    return cost * faces * layers;
  }
  /** @internal */
  protected _calcMaxMipLevelCount(width: number, height: number, depth: number) {
    let size = Math.max(width, height);
    if (this._target === '3d') {
      size = Math.max(size, depth);
    }
    return Math.floor(Math.log2(Math.max(size, 1))) + 1;
  }
  /** @internal */
  protected _calcMipLevelCount(format: TextureFormat, width: number, height: number, depth: number) {
    if (hasDepthChannel(format) || this.isTextureVideo()) {
      return 1;
    }
    if (this._flags & GPUResourceUsageFlags.TF_NO_MIPMAP) {
      return 1;
    }
    if (this._device.type === 'webgl' && (!isPowerOf2(width) || !isPowerOf2(height))) {
      return 1;
    }
    if (!this.getTextureCaps().getTextureFormatInfo(format)?.renderable) {
      return 1;
    }
    return this._calcMaxMipLevelCount(width, height, depth);
  }
  /** @internal */
  protected _getSamplerOptions(params: Immutable<TextureFormatInfo>, comparison: boolean) {
    const compare = this.isDepth() && comparison;
    const filterable = params.filterable || compare;
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
      compare: compare ? DEPTH_COMPARE_CLOSER : null
    } as RequireOptionals<SamplerOptions>;
  }
}
