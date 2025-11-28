import type { Font } from './font';
import { FontCanvas } from './font';
import type { AtlasInfo } from './textureatlas';
import { TextureAtlasManager } from './textureatlas';
import type { AbstractDevice } from '../base_types';

/**
 * Manager of texture glyphs
 * @public
 */
export class GlyphManager extends TextureAtlasManager {
  /**
   * Creates a new glyph manager instance
   * @param device - The render device
   * @param binWidth - Width of an atlas bin
   * @param binHeight - Height of an atlas bin
   * @param border - Border width of an atlas
   */
  constructor(device: AbstractDevice, binWidth: number, binHeight: number, border: number) {
    super(device, binWidth, binHeight, border, true);
    this.atlasTextureRestoreHandler = async () => {
      if (!this.isEmpty()) {
        this.clear();
      }
    };
  }
  /**
   * Gets the size for given character
   * @param char - The character
   * @param font - Font of the character
   * @returns [width, height]
   */
  getGlyphSize(char: string, font: Font): [number, number] {
    return this._getGlyphSize(char, font);
  }
  getGlyphInfo(char: string, font: Font): AtlasInfo {
    if (!char || !font) {
      return null;
    }
    let glyphInfo = this.getAtlasInfo(this._hash(char, font));
    if (!glyphInfo) {
      glyphInfo = this._cacheGlyph(char, font);
      glyphInfo.width = Math.round(glyphInfo.width * (font.maxHeight / font.maxHeightScaled));
      glyphInfo.height = font.maxHeight;
    }
    return glyphInfo;
  }
  /**
   * Measuring the width of a string
   * @param str - The string to be measured
   * @param charMargin - margin size between characters
   * @param font - Font of the string
   * @returns Width of the string
   */
  measureStringWidth(str: string, charMargin: number, font: Font): number {
    let w = 0;
    for (const ch of str) {
      w += charMargin + this.getCharWidth(ch, font);
    }
    return w;
  }
  /**
   * Clips a string so that it's width is not larger than the given value
   * @param str - The string to be clipped
   * @param width - The desired maximum width
   * @param charMargin - Margin size between characters
   * @param start - Start index of the string to be clipped
   * @param font - Font of the string
   * @returns
   */
  clipStringToWidth(str: string, width: number, charMargin: number, start: number, font: Font): number {
    let sum = 0;
    let i = start;
    for (; i < str.length; i++) {
      sum += charMargin + this.getCharWidth(str[i], font);
      if (sum > width) {
        break;
      }
    }
    return i - start;
  }
  /**
   * Measuring width of a character
   * @param char - The character to be measured
   * @param font - Font of the character
   * @returns Width of the character
   */
  getCharWidth(char: string, font: Font): number {
    if (!font) {
      return 0;
    }
    FontCanvas.font = font.fontNameScaled;
    const metric = FontCanvas.context.measureText(char);
    let w = metric.width;
    if (w === 0) {
      return 0;
    }
    if (typeof metric.actualBoundingBoxRight === 'number') {
      w = Math.floor(Math.max(w, metric.actualBoundingBoxRight) + 0.8);
    }
    w = Math.round(w * (font.maxHeight / font.maxHeightScaled));
    return w;
  }
  /** @internal */
  private _getGlyphSize(char: string, font: Font): [number, number] {
    if (!font) {
      return null;
    }
    FontCanvas.font = font.fontNameScaled;
    const metric = FontCanvas.context.measureText(char);
    let w = metric.width;
    if (w === 0) {
      return null;
    }
    if (typeof metric.actualBoundingBoxRight === 'number') {
      w = Math.floor(Math.max(w, metric.actualBoundingBoxRight) + 0.8);
    }
    const h = font.maxHeightScaled;
    return [w, h];
  }
  /** @internal */
  private _getGlyphBitmap(
    char: string,
    font: Font
  ): ImageData | { x: number; y: number; w: number; h: number } {
    if (!font) {
      return null;
    }
    FontCanvas.font = font.fontNameScaled;
    const metric = FontCanvas.context.measureText(char);
    let w = metric.width;
    if (w === 0) {
      return null;
    }
    if (typeof metric.actualBoundingBoxRight === 'number') {
      w = Math.floor(Math.max(w, metric.actualBoundingBoxRight) + 0.8);
    }
    const h = font.maxHeightScaled;
    FontCanvas.context.fillStyle = '#fff';
    FontCanvas.context.clearRect(0, 0, w + 2, h);
    FontCanvas.context.fillText(char, 0, -font.topScaled);
    return FontCanvas.context.getImageData(0, 0, w, h);
  }
  /** @internal */
  private _hash(char: string, font: Font): string {
    return `${font.family}@${font.size}&${char}`;
  }
  /** @internal */
  private _cacheGlyph(char: string, font: Font): AtlasInfo {
    const bitmap = this._getGlyphBitmap(char, font) as ImageData;
    return this.pushBitmap(this._hash(char, font), bitmap);
  }
}
