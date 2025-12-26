import type { Nullable } from '@zephyr3d/base';
import { RectsPacker } from '@zephyr3d/base';
import type { AbstractDevice, TextureFormat } from '../base_types';
import type { BaseTexture, Texture2D } from '../gpuobject';

/**
 * Information of a texture atlas
 * @public
 */
export interface AtlasInfo {
  atlasIndex: number;
  width: number;
  height: number;
  uMin: number;
  vMin: number;
  uMax: number;
  vMax: number;
}

/**
 * Texture atlas manager
 * @public
 */
export class TextureAtlasManager {
  /** @internal */
  protected static readonly ATLAS_WIDTH = 1024;
  /** @internal */
  protected static readonly ATLAS_HEIGHT = 1024;
  /** @internal */
  protected _packer: RectsPacker;
  /** @internal */
  protected _device: AbstractDevice;
  /** @internal */
  protected _binWidth: number;
  /** @internal */
  protected _binHeight: number;
  /** @internal */
  protected _rectBorderWidth: number;
  /** @internal */
  protected _linearSpace: boolean;
  /** @internal */
  protected _atlasList: Texture2D[];
  /** @internal */
  protected _atlasInfoMap: Record<string, AtlasInfo>;
  /** @internal */
  protected _atlasRestoreHandler: Nullable<(tex: BaseTexture) => void>;
  /**
   * Creates a new texture atlas manager instance
   * @param device - The render device
   * @param binWidth - Width of an atlas bin
   * @param binHeight - Height of an atlas bin
   * @param rectBorderWidth - Border width of an atlas
   * @param linearSpace - true if the texture space is linear
   */
  constructor(
    device: AbstractDevice,
    binWidth: number,
    binHeight: number,
    rectBorderWidth: number,
    linearSpace?: boolean
  ) {
    this._device = device;
    this._binWidth = binWidth;
    this._binHeight = binHeight;
    this._rectBorderWidth = rectBorderWidth;
    this._linearSpace = !!linearSpace;
    this._packer = new RectsPacker(this._binWidth, this._binHeight);
    this._atlasList = [];
    this._atlasInfoMap = {};
    this._atlasRestoreHandler = null;
  }
  /**
   * The texture restore handler callback function
   * This callback function will be called whenever the device has been restored
   */
  get atlasTextureRestoreHandler(): Nullable<(tex: BaseTexture) => void> {
    return this._atlasRestoreHandler;
  }
  set atlasTextureRestoreHandler(f: Nullable<(tex: BaseTexture) => void>) {
    this._atlasRestoreHandler = f;
  }
  /**
   * Gets the atlas texture of a given index
   * @param index - Index of the atlas bin
   * @returns Atlas texture for given index
   */
  getAtlasTexture(index: number): Texture2D {
    return this._atlasList[index];
  }
  /**
   * Gets the information about specified atlas
   * @param key - Key of the atlas
   * @returns Information of the atlas
   */
  getAtlasInfo(key: string): Nullable<AtlasInfo> {
    return this._atlasInfoMap[key] || null;
  }
  /**
   * Check if no atlas has been created
   * @returns true if no atlas has been created
   */
  isEmpty(): boolean {
    return this._atlasList.length === 0;
  }
  /**
   * Removes all created atlases
   */
  clear(): void {
    this._packer.clear();
    for (const tex of this._atlasList) {
      tex.dispose();
    }
    this._atlasList = [];
    this._atlasInfoMap = {};
  }
  /**
   * Inserts a rectangle of a canvas to the atlas texture
   * @param key - Key of the atlas
   * @param ctx - The canvas context
   * @param x - x offset of the rectangle
   * @param y - y offset of the rectangle
   * @param w - width of the rectangle
   * @param h - height of the rectangle
   * @returns The atals info or null if insert failed
   */
  pushCanvas(
    key: string,
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number
  ): Nullable<AtlasInfo> {
    const rc = this._packer.insert(w + 2 * this._rectBorderWidth, h + 2 * this._rectBorderWidth);
    if (rc) {
      const atlasX = rc.x + this._rectBorderWidth;
      const atlasY = rc.y + this._rectBorderWidth;
      this._updateAtlasTextureCanvas(rc.binIndex, ctx, atlasX, atlasY, w, h, x, y);
      const info: AtlasInfo = {
        atlasIndex: rc.binIndex,
        uMin: atlasX / this._binWidth,
        vMin: atlasY / this._binHeight,
        uMax: (atlasX + w) / this._binWidth,
        vMax: (atlasY + h) / this._binHeight,
        width: w,
        height: h
      };
      this._atlasInfoMap[key] = info;
      return info;
    }
    return null;
  }
  /**
   * Inserts a bitmap to the atlas texture
   * @param key - Key of the atlas
   * @param bitmap - The bitmap object
   * @returns The atals info or null if insert failed
   */
  pushBitmap(key: string, bitmap: ImageData | ImageBitmap): Nullable<AtlasInfo> {
    const rc = this._packer.insert(
      bitmap.width + 2 * this._rectBorderWidth,
      bitmap.height + 2 * this._rectBorderWidth
    );
    if (rc) {
      const atlasX = rc.x + this._rectBorderWidth;
      const atlasY = rc.y + this._rectBorderWidth;
      this._updateAtlasTexture(rc.binIndex, bitmap, atlasX, atlasY);
      const info: AtlasInfo = {
        atlasIndex: rc.binIndex,
        uMin: atlasX / this._binWidth,
        vMin: atlasY / this._binHeight,
        uMax: (atlasX + bitmap.width) / this._binWidth,
        vMax: (atlasY + bitmap.height) / this._binHeight,
        width: bitmap.width,
        height: bitmap.height
      };
      this._atlasInfoMap[key] = info;
      return info;
    }
    return null;
  }
  /** @internal */
  protected _createAtlasTexture(): Texture2D {
    const format: TextureFormat = 'rgba8unorm';
    const tex = this._device.createTexture2D(format, this._binWidth, this._binHeight, {
      mipmapping: false
    });
    if (!tex) {
      throw new Error(`Create 2D texture failed: ${format}-${this._binWidth}x${this._binHeight}`);
    }
    tex.update(new Uint8Array(tex.width * tex.height * 4), 0, 0, tex.width, tex.height);
    tex.restoreHandler = () => {
      tex.update(new Uint8Array(tex.width * tex.height * 4), 0, 0, tex.width, tex.height);
      this._atlasRestoreHandler?.(tex);
    };
    return tex;
  }
  /** @internal */
  private _updateAtlasTextureCanvas(
    atlasIndex: number,
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    xOffset: number,
    yOffset: number
  ): void {
    let textureAtlas: Texture2D;
    if (atlasIndex === this._atlasList.length) {
      textureAtlas = this._createAtlasTexture();
      this._atlasList.push(textureAtlas);
    } else {
      textureAtlas = this._atlasList[atlasIndex];
    }
    textureAtlas.updateFromElement(ctx.canvas, x, y, xOffset, yOffset, w, h);
  }
  /** @internal */
  private _updateAtlasTexture(
    atlasIndex: number,
    bitmap: ImageData | ImageBitmap,
    x: number,
    y: number
  ): void {
    let textureAtlas: Texture2D;
    if (atlasIndex === this._atlasList.length) {
      textureAtlas = this._createAtlasTexture();
      this._atlasList.push(textureAtlas);
    } else {
      textureAtlas = this._atlasList[atlasIndex];
    }
    if (bitmap instanceof ImageBitmap) {
      textureAtlas.updateFromElement(bitmap, x, y, 0, 0, bitmap.width, bitmap.height);
    } else {
      const originValues = new Uint8Array(bitmap.data.buffer);
      textureAtlas.update(originValues, x, y, bitmap.width, bitmap.height);
    }
  }
}
