const colorNames = {
  aliceblue: '#f0f8ff',
  antiquewhite: '#faebd7',
  aqua: '#00ffff',
  aquamarine: '#7fffd4',
  azure: '#f0ffff',
  beige: '#f5f5dc',
  bisque: '#ffe4c4',
  black: '#000000',
  blanchedalmond: '#ffebcd',
  blue: '#0000ff',
  blueviolet: '#8a2be2',
  brown: '#a52a2a',
  burlywood: '#deb887',
  cadetblue: '#5f9ea0',
  chartreuse: '#7fff00',
  chocolate: '#d2691e',
  coral: '#ff7f50',
  cornflowerblue: '#6495ed',
  cornsilk: '#fff8dc',
  crimson: '#dc143c',
  cyan: '#00ffff',
  darkblue: '#00008b',
  darkcyan: '#008b8b',
  darkgoldenrod: '#b8860b',
  darkgray: '#a9a9a9',
  darkgreen: '#006400',
  darkkhaki: '#bdb76b',
  darkmagenta: '#8b008b',
  darkolivegreen: '#556b2f',
  darkorange: '#ff8c00',
  darkorchid: '#9932cc',
  darkred: '#8b0000',
  darksalmon: '#e9967a',
  darkseagreen: '#8fbc8f',
  darkslateblue: '#483d8b',
  darkslategray: '#2f4f4f',
  darkturquoise: '#00ced1',
  darkviolet: '#9400d3',
  deeppink: '#ff1493',
  deepskyblue: '#00bfff',
  dimgray: '#696969',
  dodgerblue: '#1e90ff',
  firebrick: '#b22222',
  floralwhite: '#fffaf0',
  forestgreen: '#228b22',
  fuchsia: '#ff00ff',
  gainsboro: '#dcdcdc',
  ghostwhite: '#f8f8ff',
  gold: '#ffd700',
  goldenrod: '#daa520',
  gray: '#808080',
  green: '#008000',
  greenyellow: '#adff2f',
  honeydew: '#f0fff0',
  hotpink: '#ff69b4',
  indianred: '#cd5c5c',
  indigo: '#4b0082',
  ivory: '#fffff0',
  khaki: '#f0e68c',
  lavender: '#e6e6fa',
  lavenderblush: '#fff0f5',
  lawngreen: '#7cfc00',
  lemonchiffon: '#fffacd',
  lightblue: '#add8e6',
  lightcoral: '#f08080',
  lightcyan: '#e0ffff',
  lightgoldenrodyellow: '#fafad2',
  lightgray: '#d3d3d3',
  lightgreen: '#90ee90',
  lightpink: '#ffb6c1',
  lightsalmon: '#ffa07a',
  lightseagreen: '#20b2aa',
  lightskyblue: '#87cefa',
  lightslategray: '#778899',
  lightsteelblue: '#b0c4de',
  lightyellow: '#ffffe0',
  lime: '#00ff00',
  limegreen: '#32cd32',
  linen: '#faf0e6',
  magenta: '#ff00ff',
  maroon: '#800000',
  mediumaquamarine: '#66cdaa',
  mediumblue: '#0000cd',
  mediumorchid: '#ba55d3',
  mediumpurple: '#9370db',
  mediumseagreen: '#3cb371',
  mediumslateblue: '#7b68ee',
  mediumspringgreen: '#00fa9a',
  mediumturquoise: '#48d1cc',
  mediumvioletred: '#c71585',
  midnightblue: '#191970',
  mintcream: '#f5fffa',
  mistyrose: '#ffe4e1',
  moccasin: '#ffe4b5',
  navajowhite: '#ffdead',
  navy: '#000080',
  oldlace: '#fdf5e6',
  olive: '#808000',
  olivedrab: '#6b8e23',
  orange: '#ffa500',
  orangered: '#ff4500',
  orchid: '#da70d6',
  palegoldenrod: '#eee8aa',
  palegreen: '#98fb98',
  paleturquoise: '#afeeee',
  palevioletred: '#db7093',
  papayawhip: '#ffefd5',
  peachpuff: '#ffdab9',
  peru: '#cd853f',
  pink: '#ffc0cb',
  plum: '#dda0dd',
  powderblue: '#b0e0e6',
  purple: '#800080',
  red: '#ff0000',
  rosybrown: '#bc8f8f',
  royalblue: '#4169e1',
  saddlebrown: '#8b4513',
  salmon: '#fa8072',
  sandybrown: '#f4a460',
  seagreen: '#2e8b57',
  seashell: '#fff5ee',
  sienna: '#a0522d',
  silver: '#c0c0c0',
  skyblue: '#87ceeb',
  slateblue: '#6a5acd',
  slategray: '#708090',
  snow: '#fffafa',
  springgreen: '#00ff7f',
  steelblue: '#4682b4',
  tan: '#d2b48c',
  teal: '#008080',
  thistle: '#d8bfd8',
  tomato: '#ff6347',
  turquoise: '#40e0d0',
  violet: '#ee82ee',
  wheat: '#f5deb3',
  white: '#ffffff',
  whitesmoke: '#f5f5f5',
  yellow: '#ffff00',
  yellowgreen: '#9acd32',
  transparent: 'rgba(0,0,0,0)'
};

/**
 * A generic constructor type
 * @public
 */
export type GenericConstructor<T = object> = {
  new (...args: any[]): T;
  isPrototypeOf(v: object): boolean;
};

/**
 * Clonable interface
 * @public
 */
export interface Clonable<T> {
  clone(): T;
}

/**
 * Typed array
 * @public
 */
export type TypedArray =
  | Int8Array
  | Uint8Array
  | Uint8ClampedArray
  | Int16Array
  | Uint16Array
  | Int32Array
  | Uint32Array
  | Float32Array;

/**
 * Type of a typed array constructor
 * @public
 */
export type TypedArrayConstructor<T extends TypedArray = any> = {
  new (): T;
  new (size: number): T;
  new (elements: number[]): T;
  new (buffer: ArrayBuffer): T;
  new (buffer: ArrayBuffer, byteOffset: number): T;
  new (buffer: ArrayBuffer, byteOffset: number, length: number): T;
  BYTES_PER_ELEMENT: number;
};

/**
 * Wrapper of a http get request
 * @public
 */
export class HttpRequest {
  /** @internal */
  static _tempElement: HTMLAnchorElement = null;
  /** @internal */
  private _urlResolver: (url: string) => string;
  /** @internal */
  private _crossOrigin: string;
  /** @internal */
  private _headers: Record<string, string>;
  constructor(urlResolver?: (url: string) => string) {
    this._urlResolver = urlResolver;
    this._crossOrigin = '';
    this._headers = {};
  }
  /** Get the custom URL resolver */
  get urlResolver(): (url: string) => string {
    return this._urlResolver;
  }
  set urlResolver(resolver: (url: string) => string) {
    this._urlResolver = resolver;
  }
  /** Get the cross origin property */
  get crossOrigin(): string {
    return this._crossOrigin;
  }
  set crossOrigin(val: string) {
    this._crossOrigin = val;
  }
  /** Get the request headers */
  get headers(): Record<string, string> {
    return this._headers;
  }
  set headers(val: Record<string, string>) {
    this._headers = val;
  }
  /**
   * Resolves a URL string.
   * @param url - The input url string,
   * @returns The resolved URL string.
   */
  resolveURL(url: string): string {
    if (!HttpRequest._tempElement) {
      HttpRequest._tempElement = document.createElement('a');
    }
    HttpRequest._tempElement.href = url;
    return HttpRequest._tempElement.href;
  }
  /**
   * Send a GET request.
   * @param url - The remote URL to fetch.
   * @returns The fetch result.
   */
  async request(url: string): Promise<Response> {
    url = this._urlResolver ? this._urlResolver(url) : this.resolveURL(url);
    return url
      ? fetch(url, {
          credentials: this._crossOrigin === 'anonymous' ? 'same-origin' : 'include',
          headers: this._headers || {}
        })
      : null;
  }
  /**
   * Fetch a text string from remote.
   * @param url - The remote URL to fetch.
   * @returns The fetch result.
   */
  async requestText(url: string): Promise<string> {
    const response = await this.request(url);
    if (!response?.ok) {
      throw new Error(`Asset download failed: ${url}`);
    }
    return response.text();
  }
  /**
   * Fetch a json object from remote.
   * @param url - The remote URL to fetch.
   * @returns The fetch result.
   */
  async requestJson(url: string): Promise<string> {
    const response = await this.request(url);
    if (!response?.ok) {
      throw new Error(`Asset download failed: ${url}`);
    }
    return response.json();
  }
  /**
   * Fetch an array buffer from remote.
   * @param url - The remote URL to fetch.
   * @returns The fetch result.
   */
  async requestArrayBuffer(url: string): Promise<ArrayBuffer> {
    const response = await this.request(url);
    if (!response?.ok) {
      throw new Error(`Asset download failed: ${url}`);
    }
    return response.arrayBuffer();
  }
  /**
   * Fetch a blob object from remote.
   * @param url - The remote URL to fetch.
   * @returns The fetch result.
   */
  async requestBlob(url: string): Promise<Blob> {
    const arrayBuffer = await this.requestArrayBuffer(url);
    return new Blob([arrayBuffer]);
  }
}

/**
 * two elements tuple type
 * @public
 */
export interface Tuple2 {
  x: number;
  y: number;
}

/**
 * three elements tuple type
 * @public
 */
export interface Tuple3 {
  x: number;
  y: number;
  z: number;
}
/**
 * four elements tuple type
 * @public
 */
export interface Tuple4 {
  x: number;
  y: number;
  z: number;
  w: number;
}
/**
 * RGBA color type
 * @public
 */
export interface ColorRGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

/**
 * Generic Truthy type
 * @public
 */
export type Truthy<T> = T extends false | 0 | '' | null | undefined | 0n ? never : T;

/**
 * Simple assertion which throws an error if the !!condition is false.
 * @param condition - The condition to check.
 * @public
 */
export function ASSERT(condition: boolean, message?: string): asserts condition {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}

/**
 * Converts a string to Base64 (Supports emoji character)
 * @param text - String to convert
 * @returns Base64 string
 * @public
 */
export function textToBase64(text: string): string {
  const encoder = new TextEncoder();
  const uint8Array = encoder.encode(text);

  let binaryString = '';
  for (let i = 0; i < uint8Array.length; i++) {
    binaryString += String.fromCharCode(uint8Array[i]);
  }
  return btoa(binaryString);
}

/**
 * Converts a base64 string to text (Supports emoji character)
 * @param base64 - Base64 string to convert
 * @returns Original text
 * @public
 */
export function base64ToText(base64: string): string {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);

  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  return new TextDecoder('utf-8').decode(bytes);
}

/**
 * Check if a value is an instance of a specific constructor.
 * @param value - The value to check.
 * @param constructor - The constructor to check against.
 * @returns True if the value is an instance of the constructor, false otherwise.
 * @public
 */
export function IS_INSTANCE_OF<T extends GenericConstructor>(
  value: unknown,
  constructor: T
): value is InstanceType<T> {
  return value instanceof constructor;
}

/**
 * parse a css color value to RGBA color type.
 * @param input - The css color value.
 * @returns The RGBA color value.
 * @public
 */
export function parseColor(input: string): ColorRGBA {
  input = input.trim().toLowerCase();
  input = colorNames[input] || input;
  let v: ColorRGBA = null;
  if (input[0] === '#') {
    const collen = (input.length - 1) / 3;
    const fact = [17, 1, 0.062272][collen - 1];
    v = {
      r: (parseInt(input.substring(1, 1 + collen), 16) * fact) / 255,
      g: (parseInt(input.substring(1 + collen, 1 + 2 * collen), 16) * fact) / 255,
      b: (parseInt(input.substring(1 + 2 * collen, 1 + 3 * collen), 16) * fact) / 255,
      a: 1
    };
  } else {
    let m: RegExpMatchArray;
    if ((m = input.match(/^\s*rgb\s*\(\s*(\d*\.?\d*)\s*,\s*(\d*\.?\d*)\s*,\s*(\d\.?\d*)\s*\)\s*$/i))) {
      v = {
        r: Number(m[1]) / 255,
        g: Number(m[2]) / 255,
        b: Number(m[3]) / 255,
        a: 1
      };
    } else if (
      (m = input.match(
        /^\s*rgba\s*\(\s*(\d*\.?\d*)\s*,\s*(\d*\.?\d*)\s*,\s*([\d*.?\d*]+)\s*,\s*(\d*\.?\d*)\s*\)\s*$/i
      ))
    ) {
      v = {
        r: Number(m[1]) / 255,
        g: Number(m[2]) / 255,
        b: Number(m[3]) / 255,
        a: Number(m[4])
      };
    }
  }
  if (!v || Number.isNaN(v.r) || Number.isNaN(v.g) || Number.isNaN(v.b) || Number.isNaN(v.a)) {
    throw new Error(`parseColor(): invalid color '${input}'`);
  }
  // the RGB color values in CSS are in sRGB color space, convert them to linear color space
  v.r = Math.pow(Math.min(1, v.r), 2.2);
  v.g = Math.pow(Math.min(1, v.g), 2.2);
  v.b = Math.pow(Math.min(1, v.b), 2.2);
  v.a = Math.min(1, v.a);
  return v;
}
/**
 * Extract mixin return type
 * @public
 */
export type ExtractMixinReturnType<M> = M extends (target: infer A) => infer R ? R : never;

/**
 * Extract mixin type
 * @public
 */
export type ExtractMixinType<M> = M extends [infer First]
  ? ExtractMixinReturnType<First>
  : M extends [infer First, ...infer Rest]
  ? ExtractMixinReturnType<First> & ExtractMixinType<[...Rest]>
  : never;

/**
 * Applies mixins to a constructor function.
 *
 * @param target - The constructor function of the class that will receive the mixins.
 * @param mixins - mixins
 * @returns Mixed class
 *
 * @public
 */
export function applyMixins<M extends ((target: any) => any)[], T>(
  target: T,
  ...mixins: M
): T & ExtractMixinType<M> {
  let r: any = target;
  for (const m of mixins) {
    r = m(r);
  }
  return r;
}

/**
 * Convert union type to intersection
 * @public
 */
export type UnionToIntersection<U> = (U extends any ? (k: U) => void : never) extends (k: infer I) => void
  ? I
  : never;

/**
 * @public
 */
export type MaybeArray<T> = T[] | T;
