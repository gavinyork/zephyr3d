import type { Nullable } from './utils';

type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/**
 * The type of packed result.
 * @public
 */
export type PackRect = {
  /** x position of the rect */
  x: number;
  /** y position of the rect */
  y: number;
  /** width of the rect */
  width: number;
  /** height of the rect */
  height: number;
  /** the image index */
  binIndex: number;
};

/**
 * The rectangle packer class
 * @public
 */
export class RectsPacker {
  /** @internal */
  private _bins: Bin[];
  /** @internal */
  private readonly _maxBins: number;
  /** @internal */
  private readonly _width: number;
  /** @internal */
  private readonly _height: number;
  /**
   * @param width - width of image bin
   * @param height - height of image bin
   * @param maxBins - max count of image bins
   */
  constructor(width: number, height: number, maxBins = 0) {
    this._width = width;
    this._height = height;
    this._maxBins = maxBins;
    this._bins = [new Bin(this._width, this._height)];
  }
  /** Clear all image bins of the packer */
  clear(): void {
    this._bins = [new Bin(this._width, this._height)];
  }
  /**
   * Inserts a new rectangle
   * @param width - Width of the rectangle.
   * @param height - Height of the rectangle.
   * @returns The pack result.
   */
  insert(width: number, height: number): Nullable<PackRect> {
    if (width > this._width || height > this._height) {
      return null;
    }
    const rect = this._bins[this._bins.length - 1].insert(width, height);
    if (rect) {
      return {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        binIndex: this._bins.length - 1
      };
    }
    if (this._maxBins === 0 || this._bins.length < this._maxBins) {
      this._bins.push(new Bin(this._width, this._height));
      const rect = this._bins[this._bins.length - 1].insert(width, height);
      if (rect) {
        return {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          binIndex: this._bins.length - 1
        };
      }
    }
    return null;
  }
}

class Bin {
  private readonly freeRects: Rect[];
  constructor(width: number, height: number) {
    this.freeRects = [{ x: 0, y: 0, width, height }];
  }
  insert(width: number, height: number): Nullable<Rect> {
    const newRect = this.findBestFit(width, height);
    if (!newRect) {
      return null;
    }
    let numRectsToProcess = this.freeRects.length;
    let i = 0;
    while (i < numRectsToProcess) {
      if (this.splitFreeRect(this.freeRects[i], newRect)) {
        this.freeRects.splice(i, 1);
        --numRectsToProcess;
        --i;
      }
      ++i;
    }
    this.pruneFreeRects();
    return newRect;
  }
  private findBestFit(width: number, height: number): Nullable<Rect> {
    let score = Number.MAX_VALUE;
    let rect: Nullable<Rect> = null;
    for (const freeRect of this.freeRects) {
      if (freeRect.width >= width && freeRect.height >= height) {
        const areaFit = freeRect.width * freeRect.height - width * height;
        if (areaFit < score) {
          if (!rect) {
            rect = { width, height } as Rect;
          }
          rect.x = freeRect.x;
          rect.y = freeRect.y;
          score = areaFit;
        }
      }
    }
    return rect;
  }
  private splitFreeRect(free: Rect, used: Rect): boolean {
    if (
      used.x >= free.x + free.width ||
      used.x + used.width <= free.x ||
      used.y >= free.y + free.height ||
      used.y + used.height <= free.y
    ) {
      return false;
    }
    if (used.x < free.x + free.width && used.x + used.width > free.x) {
      if (used.y > free.y && used.y < free.y + free.height) {
        this.freeRects.push({
          x: free.x,
          y: free.y,
          width: free.width,
          height: used.y - free.y
        });
      }
      if (used.y + used.height < free.y + free.height) {
        this.freeRects.push({
          x: free.x,
          y: used.y + used.height,
          width: free.width,
          height: free.y + free.height - used.y - used.height
        });
      }
    }
    if (used.y < free.y + free.height && used.y + used.height > free.y) {
      if (used.x > free.x && used.x < free.x + free.width) {
        this.freeRects.push({
          x: free.x,
          y: free.y,
          width: used.x - free.x,
          height: free.height
        });
      }
      if (used.x + used.width < free.x + free.width) {
        this.freeRects.push({
          x: used.x + used.width,
          y: free.y,
          width: free.x + free.width - used.x - used.width,
          height: free.height
        });
      }
    }
    return true;
  }
  private pruneFreeRects(): void {
    let i = 0;
    let j = 0;
    let len = this.freeRects.length;
    while (i < len) {
      j = i + 1;
      const rect1 = this.freeRects[i];
      while (j < len) {
        const rect2 = this.freeRects[j];
        if (this.isRectInRect(rect1, rect2)) {
          this.freeRects.splice(i, 1);
          --i;
          --len;
          break;
        }
        if (this.isRectInRect(rect2, rect1)) {
          this.freeRects.splice(j, 1);
          --j;
          --len;
        }
        j++;
      }
      i++;
    }
  }
  private isRectInRect(test: Rect, container: Rect): boolean {
    return (
      test.x >= container.x &&
      test.y >= container.y &&
      test.x + test.width <= container.x + container.width &&
      test.y + test.height <= container.y + container.height
    );
  }
}
