/** @internal */
export class FontCanvas {
    private static _canvas: HTMLCanvasElement = null;
    private static _context: CanvasRenderingContext2D = null;
    private static _currentFont: string = null;
    static get canvas() {
      this._realize();
      return this._canvas;
    }
    static get context() {
      this._realize();
      return this._context;
    }
    static get font() {
      return this.context.font;
    }
    static set font(font: string) {
      this.context.font = font;
    }
    private static _realize() {
      if (!this._canvas) {
        this._canvas = document.createElement('canvas');
        this._canvas.width = 512;
        this._canvas.height = 512;
        this._canvas.style.left = '-10000px';
        this._canvas.style.position = 'absolute';
        //document.body.appendChild(this._canvas);
        this._context = this._canvas.getContext('2d', {
          willReadFrequently: true
        });
        this._context.textBaseline = 'top';
        this._context.textAlign = 'left';
        this._context.fillStyle = 'transparent';
        this._context.fillRect(0, 0, this._canvas.width, this._canvas.height);
        this._context.fillStyle = '#ffffff';
        this._context.imageSmoothingEnabled = true;
      }
    }
  }

  /**
   * The font class
   * @public
   */
  export class Font {
    /** @internal */
    private static fontCache: {
      [name: string]: {
        [scale: number]: Font;
      };
    } = {};
    /** @internal */
    private _name: string;
    /** @internal */
    private _nameScaled: string;
    /** @internal */
    private _scale: number;
    /** @internal */
    private _size: number;
    /** @internal */
    private _family: string;
    /** @internal */
    private _top: number;
    /** @internal */
    private _bottom: number;
    /** @internal */
    private _topScaled: number;
    /** @internal */
    private _bottomScaled: number;
    /** @internal */
    private _div: HTMLDivElement;
    /**
     * Creates a instance of font class from font name and the scale value
     * @param name - The font name
     * @param scale - The scale value
     */
    constructor(name: string, scale: number) {
      this._top = 0;
      this._bottom = 0;
      this._size = 0;
      this._topScaled = 0;
      this._bottomScaled = 0;
      this._family = '';
      this._scale = scale;
      this._name = name;
      this._nameScaled = null;
      this._div = document.createElement('div');
      if (this._name) {
        this._normalizeFont();
      }
    }
    /**
     * Fetch a font from cache
     * @param name - The font name
     * @param scale - The scale value
     * @returns The font object
     */
    static fetchFont(name: string, scale: number): Font {
      let fontlist = this.fontCache[name];
      if (!fontlist) {
        fontlist = {};
        this.fontCache[name] = fontlist;
      }
      let font = fontlist[scale];
      if (!font) {
        font = new Font(name, scale);
        fontlist[scale] = font;
      }
      return font;
    }
    /** Gets the font name */
    get fontName(): string {
      return this._name;
    }
    set fontName(name: string) {
      this._name = name;
      this._normalizeFont();
    }
    /** Gets the scaled font name */
    get fontNameScaled(): string {
      return this._nameScaled;
    }
    /** Gets the font size */
    get size(): number {
      return this._size;
    }
    /** Gets the font family */
    get family(): string {
      return this._family;
    }
    /** Gets top position of the font */
    get top(): number {
      return this._top;
    }
    /** Gets the bottom position of the font */
    get bottom(): number {
      return this._bottom;
    }
    /** Gets the scaled top position of the font */
    get topScaled(): number {
      return this._topScaled;
    }
    /** Gets the scaled bottom position of the font */
    get bottomScaled(): number {
      return this._bottomScaled;
    }
    /** Gets the maximum height of the font */
    get maxHeight(): number {
      return this._bottom - this._top + 1;
    }
    /** Gets the scaled maximum height of the font */
    get maxHeightScaled(): number {
      return this._bottomScaled - this._topScaled + 1;
    }
    /** Tests if two fonts are the same */
    equalTo(other: Font): boolean {
      return this._size === other._size && this._family === other._family;
    }
    /** @internal */
    private _measureFontHeight(fontName: string): {
      size: number;
      family: string;
      top: number;
      bottom: number;
    } {
      const oldFont = FontCanvas.context.font;
      const oldTextBaseline = FontCanvas.context.textBaseline;
      const oldFillStyle = FontCanvas.context.fillStyle;

      FontCanvas.context.font = fontName;
      this._div.style.font = FontCanvas.context.font;
      const fontSize = this._div.style.fontSize;
      const size = parseInt(fontSize.substring(0, fontSize.length - 2));
      const family = this._div.style.fontFamily;

      const testString = 'bdfghijklpq国美|_~';
      const metric = FontCanvas.context.measureText(testString);
      let top: number, bottom: number;
      top = 0;
      bottom = size - 1;
      const extra = 10;
      const halfExtra = extra >> 1;
      const maxWidth = Math.ceil(metric.width) + extra;
      const maxHeight = size + extra;
      FontCanvas.context.clearRect(0, 0, maxWidth, maxHeight);
      FontCanvas.context.textBaseline = 'top';
      FontCanvas.context.fillStyle = '#ffffff';
      FontCanvas.context.fillText(testString, halfExtra, halfExtra);
      const bitmap = FontCanvas.context.getImageData(0, 0, maxWidth, maxHeight);
      const pixels = bitmap.data;
      for (let i = 0; i < maxWidth * maxHeight; i++) {
        if (pixels[i * 4 + 3] > 0) {
          top = Math.floor(i / maxWidth);
          break;
        }
      }
      for (let i = maxWidth * maxHeight - 1; i >= 0; i--) {
        if (pixels[i * 4 + 3] > 0) {
          bottom = Math.floor(i / maxWidth);
          break;
        }
      }
      top -= halfExtra;
      bottom -= halfExtra;
      FontCanvas.context.font = oldFont;
      FontCanvas.context.textBaseline = oldTextBaseline;
      FontCanvas.context.fillStyle = oldFillStyle;

      return { size, family, top, bottom };
    }
    /** @internal */
    private _normalizeFont(): void {
      const info = this._measureFontHeight(this._name);
      this._nameScaled = `${Math.round(info.size * this._scale)}px ${info.family}`;
      const infoScaled = this._measureFontHeight(this._nameScaled);
      this._size = info.size;
      this._family = info.family;
      this._top = info.top;
      this._bottom = info.bottom;
      this._topScaled = infoScaled.top;
      this._bottomScaled = infoScaled.bottom;
    }
  }
