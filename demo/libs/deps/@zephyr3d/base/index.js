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
 * Object.entries with typed return value
 * @param obj - The object to extract entries from.
 * @returns An array of key-value pairs from the object.
 */ function objectEntries(obj) {
    return Object.entries(obj);
}
/**
 * Object.keys with typed return value
 * @param obj - The object to extract keys from.
 * @returns An array of keys from the object.
 */ function objectKeys(obj) {
    return Object.keys(obj);
}
/**
 * Wrapper of a http get request
 * @public
 */ class HttpRequest {
    /** @internal */ static _tempElement = null;
    /** @internal */ _urlResolver;
    /** @internal */ _crossOrigin;
    /** @internal */ _headers;
    constructor(urlResolver){
        this._urlResolver = urlResolver ?? null;
        this._crossOrigin = '';
        this._headers = {};
    }
    /** Get the custom URL resolver */ get urlResolver() {
        return this._urlResolver;
    }
    set urlResolver(resolver) {
        this._urlResolver = resolver;
    }
    /** Get the cross origin property */ get crossOrigin() {
        return this._crossOrigin;
    }
    set crossOrigin(val) {
        this._crossOrigin = val;
    }
    /** Get the request headers */ get headers() {
        return this._headers;
    }
    set headers(val) {
        this._headers = val;
    }
    /**
   * Resolves a URL string.
   * @param url - The input url string,
   * @returns The resolved URL string.
   */ resolveURL(url) {
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
   */ async request(url) {
        url = this._urlResolver ? this._urlResolver(url) : this.resolveURL(url);
        return url ? fetch(url, {
            credentials: this._crossOrigin === 'anonymous' ? 'same-origin' : 'include',
            headers: this._headers || {}
        }) : null;
    }
    /**
   * Fetch a text string from remote.
   * @param url - The remote URL to fetch.
   * @returns The fetch result.
   */ async requestText(url) {
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
   */ async requestJson(url) {
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
   */ async requestArrayBuffer(url) {
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
   */ async requestBlob(url) {
        const arrayBuffer = await this.requestArrayBuffer(url);
        return new Blob([
            arrayBuffer
        ]);
    }
}
/**
 * Simple assertion which throws an error if the !!condition is false.
 * @param condition - The condition to check.
 * @public
 */ function ASSERT(condition, message) {
    if (!condition) {
        throw new Error(message || 'Assertion failed');
    }
}
/**
 * Converts a Uint8Array to Base64 (Supports emoji character)
 * @param array - Uint8Array to convert
 * @returns Base64 string
 * @public
 */ function uint8ArrayToBase64(array) {
    let binaryString = '';
    for(let i = 0; i < array.length; i++){
        binaryString += String.fromCharCode(array[i]);
    }
    return btoa(binaryString);
}
/**
 * Converts a string to Base64 (Supports emoji character)
 * @param text - String to convert
 * @returns Base64 string
 * @public
 */ function textToBase64(text) {
    const encoder = new TextEncoder();
    const uint8Array = encoder.encode(text);
    return uint8ArrayToBase64(uint8Array);
}
/**
 * Converts a base64 string to text (Supports emoji character)
 * @param base64 - Base64 string to convert
 * @returns Original text
 * @public
 */ function base64ToText(base64) {
    const bytes = base64ToUint8Array(base64);
    return new TextDecoder('utf-8').decode(bytes);
}
/**
 * Converts a base64 string to Uint8Array (Supports emoji character)
 * @param base64 - Base64 string to convert
 * @returns Uint8Array
 * @public
 */ function base64ToUint8Array(base64) {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for(let i = 0; i < binaryString.length; i++){
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
}
/**
 * Generate 128bit random UUID
 * @returns random UUID
 * @public
 */ function randomUUID() {
    if (crypto.randomUUID) {
        return crypto.randomUUID();
    } else {
        const rnds = new Uint8Array(16);
        crypto.getRandomValues(rnds);
        // Per RFC 4122 v4
        rnds[6] = rnds[6] & 0x0f | 0x40;
        rnds[8] = rnds[8] & 0x3f | 0x80;
        const hex = [
            ...rnds
        ].map((b)=>b.toString(16).padStart(2, '0'));
        return [
            hex.slice(0, 4).join(''),
            hex.slice(4, 6).join(''),
            hex.slice(6, 8).join(''),
            hex.slice(8, 10).join(''),
            hex.slice(10, 16).join('')
        ].join('-');
    }
}
/**
 * Check if a value is an instance of a specific constructor.
 * @param value - The value to check.
 * @param constructor - The constructor to check against.
 * @returns True if the value is an instance of the constructor, false otherwise.
 * @public
 */ function IS_INSTANCE_OF(value, constructor) {
    return value instanceof constructor;
}
/**
 * Check if a constructor is a subclass of another constructor.
 * @param derived - The derived constructor.
 * @param base - The base constructor.
 * @returns True if the derived is a subclass of the base, false otherwise.
 * @public
 */ function IS_SUBCLASS_OF(derived, base) {
    return !!(base && derived && (derived === base || base.prototype.isPrototypeOf(derived.prototype)));
}
/**
 * parse a css color value to RGBA color type.
 * @param input - The css color value.
 * @returns The RGBA color value.
 * @public
 */ function parseColor(input) {
    input = input.trim().toLowerCase();
    input = colorNames[input] || input;
    let v = null;
    if (input[0] === '#') {
        const collen = (input.length - 1) / 3;
        const fact = [
            17,
            1,
            0.062272
        ][collen - 1];
        v = {
            r: parseInt(input.substring(1, 1 + collen), 16) * fact / 255,
            g: parseInt(input.substring(1 + collen, 1 + 2 * collen), 16) * fact / 255,
            b: parseInt(input.substring(1 + 2 * collen, 1 + 3 * collen), 16) * fact / 255,
            a: 1
        };
    } else {
        let m;
        if (m = input.match(/^\s*rgb\s*\(\s*(\d*\.?\d*)\s*,\s*(\d*\.?\d*)\s*,\s*(\d\.?\d*)\s*\)\s*$/i)) {
            v = {
                r: Number(m[1]) / 255,
                g: Number(m[2]) / 255,
                b: Number(m[3]) / 255,
                a: 1
            };
        } else if (m = input.match(/^\s*rgba\s*\(\s*(\d*\.?\d*)\s*,\s*(\d*\.?\d*)\s*,\s*([\d*.?\d*]+)\s*,\s*(\d*\.?\d*)\s*\)\s*$/i)) {
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
 * Applies mixins to a constructor function.
 *
 * @param target - The constructor function of the class that will receive the mixins.
 * @param mixins - mixins
 * @returns Mixed class
 *
 * @public
 */ function applyMixins(target, ...mixins) {
    let r = target;
    for (const m of mixins){
        r = m(r);
    }
    return r;
}
// 说明：
//  1: i$           -> 显式索引（整个转换的值索引）
//  2: flagsStr
//  3: starWidth    -> '*'（有星号宽度）
//  4: widthIndex$  -> 星号宽度的显式索引，如 *3$ 里的 3
//  5: widthNum     -> 数字宽度，如 10
//  6: starPrec     -> '*'（有星号精度）
//  7: precIndex$   -> 星号精度的显式索引，如 *4$ 里的 4
//  8: precNum      -> 数字精度，如 .2
//  9: type
const formatRegex = /%(?:(\d+)\$)?([-+ 0#]*)(?:(\*)(?:(\d+)\$)?|(\d+))?(?:\.(?:(\*)(?:(\d+)\$)?|(\d+)))?([%sdifuoxXc])/g;
/**
 * Simple sprintf implementation:
 *
 * @param format - The format string
 * @param args - The format arguments
 * @returns The formatted string
 *
 * Supported format:
 * %%
 * %s
 * %c
 * %d, %i, %u
 * %f
 * %x, %X, %o
 *
 * Supported flags:
 * - (left align)
 * + (always show sign for number)
 *   (space if no sign for number)
 * 0 (zero pad)
 * # (alternate form, for x/X/o adds 0x/0X/0o prefix if value is non-zero)
 * * (width or precision from argument)
 * n$ (explicit argument index, 1-based)
 * .precision for s (max length)
 * .precision for d/i/u/x/X/o (min digits)
 * .precision for f (number of digits after decimal point, default 6)
 *
 * @example
 * ```ts
 * formatString('Hello %s', 'World'); // 'Hello World'
 * formatString('Hex: %#x', 255); // 'Hex: 0xff'
 * formatString('Width: %*d', 5, 42); // 'Width:    42'
 * formatString('Pi: %.2f', Math.PI); // 'Pi: 3.14'
 * formatString('Index: %2$s %1$s', 'first', 'second'); // 'Index: second first'
 * ```
 *
 * @public
 */ function formatString(format, ...args) {
    let out = '';
    let lastIndex = 0;
    let argIndex = 0;
    const readArg = (explicit)=>{
        if (explicit != null) {
            const idx = explicit - 1;
            if (idx < 0 || idx >= args.length) {
                throw new Error(`Argument index ${explicit}$ out of range`);
            }
            return args[idx];
        }
        if (argIndex >= args.length) {
            throw new Error('Too few arguments for format string');
        }
        return args[argIndex++];
    };
    const parseNumber = (val, name)=>{
        const n = typeof val === 'string' ? parseInt(val, 10) : Number(val);
        if (!Number.isFinite(n)) {
            throw new Error(`Invalid ${name}: ${val}`);
        }
        return n;
    };
    format.replace(formatRegex, (match, i$, flagsStr, starWidth, widthIndex$, widthNum, starPrec, precIndex$, precNum, type, offset)=>{
        out += format.slice(lastIndex, offset);
        lastIndex = offset + match.length;
        const token = {
            flags: {
                leftAlign: false,
                sign: false,
                space: false,
                zeroPad: false,
                alt: false
            },
            type
        };
        if (i$) {
            token.explicitIndex = parseInt(i$, 10);
        }
        // flags
        for (const ch of flagsStr || ''){
            switch(ch){
                case '-':
                    token.flags.leftAlign = true;
                    break;
                case '+':
                    token.flags.sign = true;
                    break;
                case ' ':
                    token.flags.space = true;
                    break;
                case '0':
                    token.flags.zeroPad = true;
                    break;
                case '#':
                    token.flags.alt = true;
                    break;
            }
        }
        // width
        if (starWidth) {
            token.widthFromArg = true;
            if (widthIndex$) {
                token.widthIndex = parseInt(widthIndex$, 10);
            }
        } else if (widthNum) {
            token.width = parseInt(widthNum, 10);
        }
        // precision
        if (starPrec) {
            token.precisionFromArg = true;
            if (precIndex$) {
                token.precisionIndex = parseInt(precIndex$, 10);
            }
        } else if (precNum) {
            token.precision = parseInt(precNum, 10);
        }
        const render = ()=>{
            const readIndex = (idx)=>readArg(idx);
            // read * parameter of width/precision
            if (token.widthFromArg) {
                const wArg = readIndex(token.widthIndex ?? token.explicitIndex);
                token.width = parseNumber(wArg, 'width');
            }
            if (token.precisionFromArg) {
                const pArg = readIndex(token.precisionIndex ?? token.explicitIndex);
                token.precision = parseNumber(pArg, 'precision');
                if (token.precision < 0) {
                    token.precision = undefined;
                }
            }
            const t = token.type;
            if (t === '%') {
                // literal %
                return '%';
            }
            const raw = readArg(token.explicitIndex);
            let body = '';
            let signStr = '';
            const asNumber = (v)=>{
                const n = typeof v === 'boolean' ? v ? 1 : 0 : v == null ? NaN : typeof v === 'string' && v.trim() === '' ? 0 : Number(v);
                return n;
            };
            const pad = (s, width, leftAlign, padChar = ' ')=>{
                if (!width || s.length >= width) {
                    return s;
                }
                const fill = padChar.repeat(width - s.length);
                return leftAlign ? s + fill : fill + s;
            };
            const prefixForAlt = (t)=>{
                if (t === 'x') {
                    return '0x';
                }
                if (t === 'X') {
                    return '0X';
                }
                if (t === 'o') {
                    return '0o';
                }
                return '';
            };
            switch(t){
                case 's':
                    {
                        body = String(raw ?? '');
                        if (token.precision != null) {
                            // precision: max length
                            body = body.slice(0, token.precision);
                        }
                        break;
                    }
                case 'c':
                    {
                        if (typeof raw === 'number') {
                            body = String.fromCharCode(raw);
                        } else {
                            const s = String(raw ?? '');
                            body = s.length ? s[0] : '\u0000';
                        }
                        break;
                    }
                case 'd':
                case 'i':
                    {
                        const n = asNumber(raw);
                        const isNeg = n < 0 || Object.is(n, -0);
                        const abs = Math.abs(n);
                        body = Math.trunc(abs).toString(10);
                        if (token.precision != null) {
                            body = '0'.repeat(Math.max(0, token.precision - body.length)) + body;
                        }
                        if (isNeg) {
                            signStr = '-';
                        } else if (token.flags.sign) {
                            signStr = '+';
                        } else if (token.flags.space) {
                            signStr = ' ';
                        }
                        body = signStr + body;
                        break;
                    }
                case 'u':
                    {
                        const n = asNumber(raw);
                        const u = n >>> 0; // unsigned 32-bit
                        body = u.toString(10);
                        if (token.precision != null) {
                            body = '0'.repeat(Math.max(0, token.precision - body.length)) + body;
                        }
                        break;
                    }
                case 'f':
                    {
                        const n = asNumber(raw);
                        const prec = token.precision ?? 6;
                        if (!Number.isFinite(n)) {
                            body = String(n);
                        } else {
                            body = n.toFixed(Math.max(0, Math.min(100, prec)));
                        }
                        if (n >= 0) {
                            if (token.flags.sign) {
                                body = '+' + body;
                            } else if (token.flags.space) {
                                body = ' ' + body;
                            }
                        }
                        break;
                    }
                case 'x':
                case 'X':
                case 'o':
                    {
                        const n = asNumber(raw);
                        const isUpper = t === 'X';
                        const abs = Math.trunc(Math.abs(n));
                        let str = t === 'o' ? abs.toString(8) : abs.toString(16);
                        if (isUpper) {
                            str = str.toUpperCase();
                        }
                        if (token.precision != null) {
                            str = '0'.repeat(Math.max(0, token.precision - str.length)) + str;
                        }
                        const pre = token.flags.alt && abs !== 0 ? prefixForAlt(t) : '';
                        body = pre + str;
                        break;
                    }
                default:
                    throw new Error(`Unsupported format type: ${t}`);
            }
            const useZeroPad = token.flags.zeroPad && !token.flags.leftAlign && token.type !== 's' && token.precision == null && token.type !== '%';
            if (useZeroPad) {
                const prefixMatch = body.match(/^([+\- ]|0x|0X|0o)/);
                const prefix = prefixMatch ? prefixMatch[0] : '';
                const rest = body.slice(prefix.length);
                body = prefix + pad(rest, token.width ? token.width - prefix.length : undefined, false, '0');
            } else {
                body = pad(body, token.width, token.flags.leftAlign, ' ');
            }
            return body;
        };
        out += render();
        return match;
    });
    out += format.slice(lastIndex);
    return out;
}

/**
 * A JSON-like value that can be diffed/patched.
 *
 * Includes primitives (`null`, `boolean`, `number`, `string`), objects, and arrays.
 *
 * @public
 */ // ---------- Utils ----------
function isObject(x) {
    return x !== null && typeof x === 'object' && !Array.isArray(x);
}
function isArray(x) {
    return Array.isArray(x);
}
function isPrimitive(x) {
    return x === null || typeof x === 'boolean' || typeof x === 'number' || typeof x === 'string';
}
function shallowEqual(a, b) {
    return a === b;
}
function cloneDeep(v) {
    if (isArray(v)) {
        return v.map(cloneDeep);
    }
    if (isObject(v)) {
        const out = {};
        for (const k of Object.keys(v)){
            out[k] = cloneDeep(v[k]);
        }
        return out;
    }
    return v;
}
// ---------- Diff ----------
/**
 * Compute a patch that transforms `base` into `target`.
 *
 * This function emits a sequence of operations needed to convert the input value
 * `base` into `target`. The resulting {@link DiffPatch} can be applied with
 * {@link applyPatch}.
 *
 * Semantics:
 * - Primitives: emits a single `set` if values differ.
 * - Objects: recurses into keys; emits `set` for additions/updates and `del` for removals.
 * - Arrays: emits an `arr` operation containing element-wise `set`, `ins`, and `del`.
 *
 * Notes:
 * - Comparison for primitives uses strict equality (`===`) via `shallowEqual`.
 * - Complex nested changes within arrays are represented either as:
 *   - element-wise `set` when types differ or primitives differ, or
 *   - nested operations pushed to the top-level with extended paths when elements are arrays/objects.
 * - This is not a minimum-edit-distance diff; it's a straightforward positional diff.
 *
 * @param base - The source value.
 * @param target - The desired target value.
 * @returns A {@link DiffPatch} that converts `base` into `target`.
 *
 * @public
 */ function diff(base, target) {
    const patch = [];
    diffInto(base, target, [], patch);
    return patch;
}
function diffInto(base, target, path, out) {
    if (isPrimitive(base) && isPrimitive(target)) {
        if (!shallowEqual(base, target)) {
            out.push({
                kind: 'set',
                path,
                value: cloneDeep(target)
            });
        }
        return;
    }
    if (isArray(base) && isArray(target)) {
        diffArray(base, target, path, out);
        return;
    }
    if (isObject(base) && isObject(target)) {
        diffObject(base, target, path, out);
        return;
    }
    out.push({
        kind: 'set',
        path,
        value: cloneDeep(target)
    });
}
function diffObject(baseObj, targetObj, path, out) {
    const keys = new Set([
        ...Object.keys(baseObj),
        ...Object.keys(targetObj)
    ]);
    for (const k of keys){
        const p = [
            ...path,
            k
        ];
        const hasB = Object.prototype.hasOwnProperty.call(baseObj, k);
        const hasT = Object.prototype.hasOwnProperty.call(targetObj, k);
        if (!hasB && hasT) {
            out.push({
                kind: 'set',
                path: p,
                value: cloneDeep(targetObj[k])
            });
        } else if (hasB && !hasT) {
            out.push({
                kind: 'del',
                path: p
            });
        } else {
            diffInto(baseObj[k], targetObj[k], p, out);
        }
    }
}
function diffArray(baseArr, targetArr, path, out) {
    const ops = [];
    const minLen = Math.min(baseArr.length, targetArr.length);
    // sort prefix
    for(let i = 0; i < minLen; i++){
        const b = baseArr[i];
        const t = targetArr[i];
        if (isPrimitive(b) && isPrimitive(t)) {
            if (!shallowEqual(b, t)) {
                ops.push({
                    op: 'set',
                    index: i,
                    value: cloneDeep(t)
                });
            }
            continue;
        }
        if (isArray(b) && isArray(t) || isObject(b) && isObject(t)) {
            const sub = [];
            diffInto(b, t, [], sub);
            if (sub.length > 0) {
                for (const sop of sub){
                    if (sop.kind === 'arr' || sop.kind === 'set' || sop.kind === 'del') {
                        const newPath = [
                            ...path,
                            i,
                            ...sop.path
                        ];
                        if (sop.kind === 'arr') {
                            out.push({
                                kind: 'arr',
                                path: newPath,
                                ops: sop.ops
                            });
                        } else if (sop.kind === 'set') {
                            out.push({
                                kind: 'set',
                                path: newPath,
                                value: sop.value
                            });
                        } else if (sop.kind === 'del') {
                            out.push({
                                kind: 'del',
                                path: newPath
                            });
                        }
                    }
                }
            }
            continue;
        }
        ops.push({
            op: 'set',
            index: i,
            value: cloneDeep(t)
        });
    }
    for(let i = minLen; i < targetArr.length; i++){
        ops.push({
            op: 'ins',
            index: i,
            value: cloneDeep(targetArr[i])
        });
    }
    for(let i = baseArr.length - 1; i >= targetArr.length; i--){
        ops.push({
            op: 'del',
            index: i
        });
    }
    if (ops.length > 0) {
        out.push({
            kind: 'arr',
            path,
            ops
        });
    }
}
// ---------- Apply ----------
function getAt(root, path) {
    let cur = root;
    for (const k of path){
        cur = cur?.[k];
    }
    return cur;
}
function ensurePath(root, path) {
    let cur = root;
    for(let i = 0; i < path.length; i++){
        const k = path[i];
        const next = path[i + 1];
        if (!(k in cur) || cur[k] === undefined || cur[k] === null) {
            cur[k] = typeof next === 'number' ? [] : {};
        }
        cur = cur[k];
    }
    return cur;
}
function setAt(root, path, value) {
    if (path.length === 0) {
        return cloneDeep(value);
    }
    const parent = ensurePath(root, path.slice(0, -1));
    const key = path[path.length - 1];
    parent[key] = cloneDeep(value);
    return root;
}
function delAt(root, path) {
    if (path.length === 0) {
        return undefined;
    }
    const parent = getAt(root, path.slice(0, -1));
    if (parent == null) {
        return root;
    }
    const key = path[path.length - 1];
    if (isArray(parent) && typeof key === 'number') {
        if (key >= 0 && key < parent.length) {
            parent.splice(key, 1);
        }
    } else if (isObject(parent)) {
        delete parent[key];
    }
    return root;
}
function applyArrayOps(arr, ops) {
    for (const op of ops){
        if (op.op === 'set') {
            arr[op.index] = cloneDeep(op.value);
        }
    }
    for (const op of ops){
        if (op.op === 'ins') {
            arr.splice(op.index, 0, cloneDeep(op.value));
        }
    }
    const dels = ops.filter((o)=>o.op === 'del').sort((a, b)=>b.index - a.index);
    for (const op of dels){
        if (op.index >= 0 && op.index < arr.length) {
            arr.splice(op.index, 1);
        }
    }
}
/**
 * Apply a {@link DiffPatch} to a given `base` value to produce a new value.
 *
 * Behavior:
 * - `set`: sets/replaces the value at path (deep-cloned).
 * - `del`: deletes the value at path; deleting the root yields `undefined`.
 * - `arr`: applies array element `set`s first, then `ins`, then `del` (descending indices),
 *   minimizing index-shift side-effects during mutation.
 *
 * Structural handling:
 * - Intermediate containers are created as needed: arrays for numeric next keys,
 *   objects otherwise.
 * - If an `arr` operation targets a non-array location, the array result is
 *   reconstructed by replaying the sub-ops against an empty array and then
 *   placed at the path.
 *
 * Immutability:
 * - The function starts by deep-cloning `base` to avoid mutating the input.
 *
 * @param base - The source value onto which the patch is applied.
 * @param patch - The patch to apply (produced by {@link diff}).
 * @returns The result of applying `patch` to `base`.
 *
 * @public
 */ function applyPatch(base, patch) {
    let root = cloneDeep(base);
    for (const op of patch){
        if (op.kind === 'set') {
            root = setAt(root, op.path, op.value);
        } else if (op.kind === 'del') {
            root = delAt(root, op.path);
        } else if (op.kind === 'arr') {
            const arr = getAt(root, op.path);
            if (!isArray(arr)) {
                const replaced = replayArrayOps([], op.ops);
                root = setAt(root, op.path, replaced);
            } else {
                applyArrayOps(arr, op.ops);
            }
        }
    }
    return root;
}
function replayArrayOps(start, ops) {
    const arr = start.slice();
    applyArrayOps(arr, ops);
    return arr;
}

/**
 * Observable event emitter implementation.
 *
 * Provides subscription, one-time subscription, unsubscription, and synchronous dispatch
 * for events defined by an {@link EventMap}.
 *
 * @typeParam X - The event map describing event names and payload tuples
 * @public
 */ class Observable {
    /** @internal */ _listeners;
    /**
   * Creates an {@link Observable}.
   */ constructor(){
        this._listeners = null;
    }
    /**
   * {@inheritDoc IEventTarget.on}
   */ on(type, listener, context) {
        if (listener) {
            this._listeners = this._internalAddEventListener(this._listeners, type, listener, {
                context: context ?? null,
                once: false
            });
        } else {
            console.error('Cannot set NULL listener');
        }
    }
    /**
   * {@inheritDoc IEventTarget.once}
   */ once(type, listener, context) {
        if (listener) {
            this._listeners = this._internalAddEventListener(this._listeners, type, listener, {
                context: context ?? null,
                once: true
            });
        } else {
            console.error('Cannot set NULL listener');
        }
    }
    /**
   * {@inheritDoc IEventTarget.off}
   */ off(type, listener, context) {
        if (listener) {
            this._internalRemoveEventListener(this._listeners, type, listener, context ?? null);
        }
    }
    /**
   * {@inheritDoc IEventTarget.dispatchEvent}
   */ dispatchEvent(type, ...args) {
        this._invokeLocalListeners(type, ...args);
    }
    /**
   * Adds an event listener to the given map.
   *
   * If the map is `null`, a new one will be created.
   *
   * @typeParam K - The event key within the event map
   * @param listenerMap - The current listener map
   * @param type - The event type to listen for
   * @param listener - The listener callback
   * @param options - Additional listener options
   * @returns The updated listener map
   * @internal
   */ _internalAddEventListener(listenerMap, type, listener, options) {
        if (typeof type !== 'string') {
            return listenerMap;
        }
        if (!listenerMap) {
            listenerMap = {};
        }
        const l = listener;
        const o = {
            ...options
        };
        let handlers = listenerMap[type];
        if (!handlers) {
            listenerMap[type] = handlers = [];
        }
        handlers.push({
            handler: l,
            options: o,
            removed: false
        });
        return listenerMap;
    }
    /**
   * Removes an event listener from the given map.
   *
   * A listener is removed only if both the function reference and the context match.
   *
   * @typeParam K - The event key within the event map
   * @param listenerMap - The current listener map
   * @param type - The event type to remove from
   * @param listener - The listener callback to remove
   * @param context - The context object that must match the one used when adding
   * @internal
   */ _internalRemoveEventListener(listenerMap, type, listener, context) {
        if (typeof type !== 'string' || !listenerMap) {
            return;
        }
        const l = listener;
        const handlers = listenerMap[type];
        if (handlers) {
            for(let i = 0; i < handlers.length; i++){
                const handler = handlers[i];
                if (handler.handler === l && handler.options.context === context) {
                    handlers.splice(i, 1);
                    break;
                }
            }
            if (handlers.length === 0) {
                listenerMap[type] = undefined;
            }
        }
    }
    /**
   * Invokes local listeners for a given event type with the provided arguments.
   *
   * Listeners added with `once: true` are marked and pruned after invocation.
   *
   * @typeParam K - The event key within the event map
   * @param type - The event type to invoke
   * @param args - The payload to pass to each listener
   * @internal
   */ _invokeLocalListeners(type, ...args) {
        if (!this._listeners) {
            return;
        }
        const handlers = this._listeners[type];
        if (handlers && handlers.length > 0) {
            const handlersCopy = handlers.slice();
            for (const handler of handlersCopy){
                handler.handler.call(handler.options?.context || this, ...args);
                if (handler.options.once) {
                    handler.removed = true;
                }
            }
            for(let i = handlers.length - 1; i >= 0; i--){
                if (handlers[i].removed) {
                    handlers.splice(i, 1);
                }
            }
        }
    }
}
/**
 * Mixin that augments a class with {@link IEventTarget} capabilities.
 *
 * It returns a higher-order factory that, when instantiated with an event map `X`,
 * produces a subclass adding `on/once/off/dispatchEvent` and the internal listener management.
 *
 * Usage:
 * ```ts
 * class Base {}
 * const Eventful = makeObservable(Base)<{ 'ready': []; 'data': [number] }>();
 * const obj = new Eventful();
 * obj.on('data', (n) => console.log(n));
 * obj.dispatchEvent('data', 42);
 * ```
 *
 * @typeParam C - A constructor type to be extended (plain `ObjectConstructor` or a generic class)
 * @param cls - The base class to extend
 * @returns A generic factory that accepts an event map and returns an extended class
 * @public
 */ function makeObservable(cls) {
    return function _() {
        return class E extends cls {
            /** @internal */ _listeners;
            constructor(...args){
                super(...args);
                this._listeners = null;
            }
            /**
       * {@inheritDoc IEventTarget.on}
       */ on(type, listener, context) {
                if (listener) {
                    this._listeners = this._internalAddEventListener(this._listeners, type, listener, {
                        context: context ?? null,
                        once: false
                    });
                } else {
                    console.error('Cannot set NULL listener');
                }
            }
            /**
       * {@inheritDoc IEventTarget.once}
       */ once(type, listener, context) {
                if (listener) {
                    this._listeners = this._internalAddEventListener(this._listeners, type, listener, {
                        context: context ?? null,
                        once: true
                    });
                } else {
                    console.error('Cannot set NULL listener');
                }
            }
            /**
       * {@inheritDoc IEventTarget.off}
       */ off(type, listener, context) {
                this._internalRemoveEventListener(this._listeners, type, listener, context ?? null);
            }
            /**
       * {@inheritDoc IEventTarget.dispatchEvent}
       */ dispatchEvent(type, ...args) {
                this._invokeLocalListeners(type, ...args);
            }
            /**
       * Adds an event listener to the given map.
       *
       * If the map is `null`, a new one will be created.
       *
       * @typeParam K - The event key within the event map
       * @param listenerMap - The current listener map
       * @param type - The event type to listen for
       * @param listener - The listener callback
       * @param options - Additional listener options
       * @returns The updated listener map
       * @internal
       */ _internalAddEventListener(listenerMap, type, listener, options) {
                if (typeof type !== 'string') {
                    return listenerMap;
                }
                if (!listenerMap) {
                    listenerMap = {};
                }
                const l = listener;
                const o = {
                    ...options
                };
                let handlers = listenerMap[type];
                if (!handlers) {
                    listenerMap[type] = handlers = [];
                }
                handlers.push({
                    handler: l,
                    options: o,
                    removed: false
                });
                return listenerMap;
            }
            /**
       * Removes an event listener from the given map.
       *
       * A listener is removed only if both the function reference and the context match.
       *
       * @typeParam K - The event key within the event map
       * @param listenerMap - The current listener map
       * @param type - The event type to remove from
       * @param listener - The listener callback to remove
       * @param context - The context object that must match the one used when adding
       * @internal
       */ _internalRemoveEventListener(listenerMap, type, listener, context) {
                if (typeof type !== 'string' || !listenerMap) {
                    return;
                }
                const l = listener;
                const handlers = listenerMap[type];
                if (handlers) {
                    for(let i = 0; i < handlers.length; i++){
                        const handler = handlers[i];
                        if (handler.handler === l && handler.options.context === context) {
                            handlers.splice(i, 1);
                            break;
                        }
                    }
                    if (handlers.length === 0) {
                        listenerMap[type] = undefined;
                    }
                }
            }
            /**
       * Invokes local listeners for a given event type with the provided arguments.
       *
       * Listeners added with `once: true` are marked and pruned after invocation.
       *
       * @typeParam K - The event key within the event map
       * @param type - The event type to invoke
       * @param args - The payload to pass to each listener
       * @internal
       */ _invokeLocalListeners(type, ...args) {
                if (!this._listeners) {
                    return;
                }
                const handlers = this._listeners[type];
                if (handlers && handlers.length > 0) {
                    const handlersCopy = handlers.slice();
                    for (const handler of handlersCopy){
                        handler.handler.call(handler.options?.context || this, ...args);
                        if (handler.options.once) {
                            handler.removed = true;
                        }
                    }
                    for(let i = handlers.length - 1; i >= 0; i--){
                        if (handlers[i].removed) {
                            handlers.splice(i, 1);
                        }
                    }
                }
            }
        };
    };
}

/**
 * The list iterator class
 * @public
 */ class ListIterator {
    /** @internal */ _node;
    /** @internal */ _reverse;
    /** @internal */ _dl;
    /** @internal */ constructor(dl, node, reverse){
        this._dl = dl;
        this._node = node;
        this._reverse = reverse;
    }
    /**
   * Check that the iterator points to a valid list node
   *
   * @returns true if the iterator points to a valid list node, otherwise false
   *
   * @public
   */ valid() {
        return this._node !== this._dl.head;
    }
    /**
   * Let the iterator point to the next list node
   *
   * @returns self
   *
   * The exception is thrown if the iterator is not valid
   *
   * @public
   */ next() {
        if (!this.valid()) {
            throw new Error('ListIterator.next(): iterator is invalid');
        }
        this._node = this._reverse ? this._node.prev : this._node.next;
        return this;
    }
    /**
   * Get a new iterator pointing to the next list node
   *
   * @returns the new iterator
   *
   * The exception is thrown if the iterator is not valid
   *
   * @public
   */ getNext() {
        if (!this.valid()) {
            throw new Error('ListIterator.getNext(): iterator is invalid');
        }
        return new ListIterator(this._dl, this._reverse ? this._node.prev : this._node.next, this._reverse);
    }
    /**
   * Let the iterator point to the previous list node
   *
   * @returns self
   *
   * The exception is thrown if the iterator is not valid
   *
   * @public
   */ prev() {
        if (!this.valid()) {
            throw new Error('ListIterator.prev(): iterator is invalid');
        }
        this._node = this._reverse ? this._node.next : this._node.prev;
        return this;
    }
    /**
   * Get a new iterator pointing to the previous list node
   *
   * @returns the new iterator
   *
   * The exception is thrown if the iterator is not valid
   *
   * @public
   */ getPrev() {
        if (!this.valid()) {
            throw new Error('ListIterator.getPrev(): iterator is invalid');
        }
        return new ListIterator(this._dl, this._reverse ? this._node.next : this._node.prev, this._reverse);
    }
    /** @internal */ get node() {
        return this._node;
    }
    /** @internal */ set node(n) {
        this._node = n;
    }
    /**
   * Returns whether the iterator is reversed.
   *
   * @returns true if the iterator is reversed, otherwise false
   *
   * @public
   */ get reversed() {
        return this._reverse;
    }
    /**
   * Returns the list object to which the iterator belongs.
   *
   * @returns The list object to which the iterator belongs.
   *
   * @public
   */ get list() {
        return this._dl;
    }
    /**
   * Gets the data associated with the iterator
   *
   * The exception is thrown if the iterator is invalid
   *
   * @public
   */ get data() {
        if (!this.valid()) {
            throw new Error('ListIterator.data: iterator is invalid');
        }
        return this._node.data;
    }
    set data(val) {
        if (this.valid()) {
            this._node.data = val;
        }
    }
}
/**
 * The double list class
 *
 * @typeParam T - The data type associated with the linked list class
 *
 * @public
 */ class List {
    /** @internal */ _head;
    /** @internal */ _length;
    constructor(){
        this._head = new ListNodeImpl();
        this._length = 0;
    }
    /** @internal */ get head() {
        return this._head;
    }
    /**
   * Get the number of elements in the linked list
   *
   * @returns The number of elements in the linked list
   */ get length() {
        return this._length;
    }
    /**
   * Remove all elements in the linked list
   */ clear() {
        while(this._length > 0){
            this.remove(this.begin());
        }
    }
    /**
   * Append an element to the end of the linked list
   *
   * @param data - The data associated to the element
   * @returns An iterator pointing to the newly added element
   *
   * @public
   */ append(data) {
        return this._insertAt(data, this._head);
    }
    /**
   * Add a new element to the linked list header
   *
   * @param data - The data associated to the element
   * @returns An iterator pointing to the newly added element
   *
   * @public
   */ prepend(data) {
        return this._insertAt(data, this._head.next);
    }
    /**
   * Deletes an element from the linked list
   *
   * @param it - An iterator pointing to the element that needs to be removed
   *
   * @public
   */ remove(it) {
        if (it.valid() && it.list === this) {
            const node = it.node;
            it.next();
            this._remove(node);
        }
    }
    /**
   * Inserts an element into the linked list
   * @param data - The data to be inserted to the list
   * @param at - An iterator pointing to the element at the insert position
   * @returns An iterator pointing to the element that was inserted
   *
   * @public
   */ insert(data, at) {
        if (at.list === this) {
            if (at.valid()) {
                if (at.reversed) {
                    return this._insertAt(data, at.node.next);
                } else {
                    return this._insertAt(data, at.node);
                }
            } else {
                return this.append(data);
            }
        }
        return null;
    }
    /**
   * Execute the callback function sequentially for each element of the linked list
   * @param callback - The function to be executed
   *
   * @public
   */ forEach(callback) {
        if (callback) {
            for(let it = this.begin(); it.valid(); it.next()){
                callback(it.data);
            }
        }
    }
    /**
   * Execute the callback function sequentially for each element of the linked list in the reversed order
   * @param callback - The function to be executed
   *
   * @public
   */ forEachReverse(callback) {
        if (callback) {
            for(let it = this.rbegin(); it.valid(); it.next()){
                callback(it.data);
            }
        }
    }
    /**
   * Gets the data associated to the first element in the linked list
   * @returns The data associated to the first element in the linked list
   *
   * The exception is thrown if the list is empty
   *
   * @public
   */ front() {
        if (this.length === 0) {
            throw new Error('List.front(): list is empty');
        }
        return this.begin().data;
    }
    /**
   * Gets the data associated to the last element in the linked list
   * @returns The data associated to the last element in the linked list
   *
   * The exception is thrown if the list is empty
   *
   * @public
   */ back() {
        if (this.length === 0) {
            throw new Error('List.back(): list is empty');
        }
        return this.rbegin().data;
    }
    /**
   * Returns an iterator pointing to the first element in the list.
   * @returns An iterator to the beginning of the list.
   *
   * @public
   */ begin() {
        return new ListIterator(this, this._length > 0 ? this._head.next : this._head, false);
    }
    /**
   * Returns an iterator referring to the past-the-end element in the list.
   * @returns An iterator to the element past the end of the list.
   *
   * @public
   */ end() {
        return new ListIterator(this, this._head, false);
    }
    /**
   * Returns a reverse iterator pointing to the last element in the list (i.e., its reverse beginning).
   * @returns A reverse iterator to the reverse beginning of the list.
   *
   * @public
   */ rbegin() {
        return new ListIterator(this, this._length > 0 ? this._head.prev : this._head, true);
    }
    /**
   * Returns a reverse iterator pointing to the theoretical element preceding the first element in the list (which is considered its reverse end).
   * @returns A reverse iterator to the reverse end of the list.
   *
   * @public
   */ rend() {
        return new ListIterator(this, this._head, true);
    }
    /** @internal */ _remove(node) {
        node.prev.next = node.next;
        node.next.prev = node.prev;
        this._length--;
    }
    /** @internal */ _insertAt(data, node) {
        const newNode = new ListNode(data);
        newNode.next = node;
        newNode.prev = node.prev;
        node.prev.next = newNode;
        node.prev = newNode;
        this._length++;
        return new ListIterator(this, newNode, false);
    }
}
class ListNodeImpl {
    next;
    prev;
    constructor(){
        this.next = this;
        this.prev = this;
    }
}
class ListNode extends ListNodeImpl {
    data;
    constructor(data){
        super();
        this.data = data;
    }
}

/**
 * The OrderedStringSet class is used to create and manage an ordered set of strings.
 * It can be configured to allow or disallow duplicate strings based on a parameter passed to the constructor.
 *
 * @public
 */ class OrderedStringSet {
    _items;
    _allowDuplicates;
    /**
   * Creates a new instance of the OrderedStringSet class.
   *
   * @param allowDuplicates - A boolean value indicating whether the set should allow duplicate strings.
   */ constructor(allowDuplicates = false){
        this._items = [];
        this._allowDuplicates = allowDuplicates;
    }
    /**
   * An array of all strings in the set.
   */ get items() {
        return [
            ...this._items
        ];
    }
    /**
   * Adds a new string to the set. If duplicates are not allowed and the string already exists, it is not added.
   *
   * @param str The string to add to the set.
   */ add(str) {
        const position = this.findInsertPosition(str);
        if (position !== null) {
            this._items.splice(position, 0, str);
        }
    }
    /**
   * Removes the first occurrence of a specified string from the set using binary search.
   * If the string does not exist, no action is taken.
   *
   * @param str The string to remove from the set.
   */ remove(str) {
        const position = this.findStringPosition(str);
        if (position !== -1) {
            // Only attempt to remove if the element exists.
            this._items.splice(position, 1);
        }
    }
    /**
   * Removes all elements that match a specified string from the collection.
   * This method first locates the first matching element, then continues to search
   * forward until it finds the first non-matching element, thereby determining the
   * range of all consecutive matching elements. Finally, it removes these elements
   * in a single operation.
   * If the collection does not contain any matching elements, no action is taken.
   *
   * @param str - The string to be removed from the collection.
   */ removeAll(str) {
        const index = this.findStringPosition(str);
        // Return immediately if no matching element is found
        if (index === -1) {
            return;
        }
        // After finding the first matching element, continue to search for all
        // consecutive matching elements
        let endIndex = index + 1;
        while(endIndex < this._items.length && this._items[endIndex] === str){
            endIndex++;
        }
        // Remove all matching elements in a single operation
        this._items.splice(index, endIndex - index);
    }
    /**
   * Checks if the specified string exists in the collection.
   *
   * @param str - The string to search for in the collection.
   * @returns true if the string is found in the collection; otherwise, false.
   */ has(str) {
        return this.findStringPosition(str) >= 0;
    }
    /**
   * Uses binary search to find the index of a string in the set.
   * If the string exists, returns its index. Otherwise, returns -1.
   *
   * @param str The string to find in the set.
   * @returns The index of the string, or -1 if not found.
   */ findStringPosition(str) {
        let low = 0;
        let high = this._items.length - 1;
        while(low <= high){
            const mid = Math.floor((low + high) / 2);
            if (this._items[mid] < str) {
                low = mid + 1;
            } else if (this._items[mid] > str) {
                high = mid - 1;
            } else {
                // Found the element, now make sure it's the first occurrence
                // by checking the preceding elements.
                let firstOccurrence = mid;
                while(firstOccurrence > 0 && this._items[firstOccurrence - 1] === str){
                    firstOccurrence--;
                }
                return firstOccurrence;
            }
        }
        return -1; // Element not found
    }
    /**
   * Uses binary search to find the correct insertion position for a string.
   * If duplicates are not allowed, it returns null for existing strings.
   *
   * @param str The string for which to find the insertion position.
   * @returns The position to insert the string, or null if the string exists and duplicates are not allowed.
   */ findInsertPosition(str) {
        let low = 0;
        let high = this._items.length - 1;
        while(low <= high){
            const mid = Math.floor((low + high) / 2);
            if (this._items[mid] < str) {
                low = mid + 1;
            } else if (this._allowDuplicates || this._items[mid] > str) {
                high = mid - 1;
            } else {
                return this._allowDuplicates ? mid : null;
            }
        }
        return low; // The position where the element should be inserted.
    }
}

const tmpArrayBuffer$1 = new ArrayBuffer(4);
const tmpFloatArray$1 = new Float32Array(tmpArrayBuffer$1);
const tmpUint32Array$1 = new Uint32Array(tmpArrayBuffer$1);
/**
 * Convert a degree value to radian value.
 * @param degree - The degree value to be converted.
 * @returns The radian value.
 *
 * @public
 */ function degree2radian(degree) {
    return degree * Math.PI / 180;
}
/**
 * Convert a radian value to degree value.
 * @param radian - The radian value to be converted.
 * @returns The degree value.
 *
 * @public
 */ function radian2degree(radian) {
    return radian * 180 / Math.PI;
}
/**
 * Convert a number to 32 bit float value
 * @param val - The number to be converted
 * @returns 32bit float value
 *
 * @public
 */ function toFloat(val) {
    tmpFloatArray$1[0] = val;
    return tmpFloatArray$1[0];
}
/**
 * Check if a number is a power of 2.
 *
 * @param value - The number to be checked.
 * @returns true if the number is a power of 2, otherwise false.
 *
 * @public
 */ function isPowerOf2(value) {
    return value % 1 === 0 && value >= 0 && (value & value - 1) === 0;
}
/**
 * Given a number, find the next number power of 2.
 *
 * @param value - The given number.
 * @returns The next number power of 2.
 *
 * @public
 */ function nextPowerOf2(value) {
    if (value <= 0) {
        return 1;
    }
    value--;
    value |= value >> 1;
    value |= value >> 2;
    value |= value >> 4;
    value |= value >> 8;
    value |= value >> 16;
    value |= value >> 32;
    return value + 1;
}
/**
 * Converts half float value to float
 *
 * @param val - A 16-bits integer presents the half float value to be converted.
 * @returns The converted float value
 *
 * @public
 */ function halfToFloat(val) {
    /*
  const s = (val & 0x8000) >> 15;
  const e = (val & 0x7c00) >> 10;
  const f = val & 0x03ff;
  if (e === 0) {
    return (s ? -1 : 1) * Math.pow(2, -14) * (f / Math.pow(2, 10));
  } else if (e === 0x1f) {
    return f ? NaN : (s ? -1 : 1) * Infinity;
  }
  return (s ? -1 : 1) * Math.pow(2, e - 15) * (1 + f / Math.pow(2, 10));
  */ let mantissa = val & 0x3ff;
    let exponent = val & 0x7c00;
    if (exponent === 0x7c00) {
        exponent = 0x8f;
    } else if (exponent !== 0) {
        exponent = val >>> 10 & 0x1f;
    } else if (mantissa !== 0) {
        exponent = 1;
        do {
            exponent--;
            mantissa <<= 1;
        }while ((mantissa & 0x0400) === 0)
        mantissa &= 0x3ff;
    } else {
        exponent = -112;
    }
    tmpUint32Array$1[0] = (val & 0x8000) << 16 | (exponent + 112 << 23 | mantissa << 13);
    return tmpFloatArray$1[0];
}
/**
 * Compresses three floats to R11F_G11F_B10F format
 *
 * @remarks
 * The implementation is adopt from https://github.com/microsoft/DirectXMath
 *
 * @param a - first of the three floats
 * @param b - second of the three floats
 * @param c - third of the tree floats
 * @returns The compressed result
 *
 * @public
 */ function packFloat3(a, b, c) {
    const ivalues = [];
    const result = [];
    tmpFloatArray$1[0] = a;
    ivalues[0] = tmpUint32Array$1[0];
    tmpFloatArray$1[0] = b;
    ivalues[1] = tmpUint32Array$1[0];
    tmpFloatArray$1[0] = c;
    ivalues[2] = tmpUint32Array$1[0];
    for(let j = 0; j < 2; j++){
        const sign = ivalues[j] & 0x80000000;
        let I = ivalues[j] & 0x7fffffff;
        if ((I & 0x7f800000) === 0x7f800000) {
            // INF or NAN
            result[j] = 0x7c0;
            if ((I & 0x7fffff) !== 0) {
                result[j] = 0x7ff;
            } else if (sign) {
                // -INF, clamp to 0
                result[j] = 0;
            }
        } else if (sign || I < 0x35800000) {
            // clamp to 0
            result[j] = 0;
        } else if (I > 0x477e0000) {
            // too large, clamp to max
            result[j] = 0x7bf;
        } else {
            if (I < 0x38800000) {
                const shift = 113 - (I >>> 23);
                I = (0x800000 | I & 0x7fffff) >>> shift;
            } else {
                I += 0xc8000000;
            }
            result[j] = I + 0xffff + (I >>> 17 & 1) >>> 17 & 0x7ff;
        }
    }
    const sign = ivalues[2] & 0x80000000;
    let I = ivalues[2] & 0x7fffffff;
    if ((I & 0x7f800000) === 0x7f800000) {
        // INF or NAN
        result[2] = 0x3e0;
        if (I & 0x7fffff) {
            result[2] = 0x3ff;
        } else if (sign || I < 0x36000000) {
            result[2] = 0;
        }
    } else if (sign) {
        result[2] = 0;
    } else if (I > 0x477c0000) {
        result[2] = 0x3df;
    } else {
        if (I < 0x38800000) {
            const shift = 113 - (I >>> 23);
            I = (0x800000 | I & 0x7fffff) >>> shift;
        } else {
            I += 0xc8000000;
        }
        result[2] = I + 0x1ffff + (I >>> 18 & 1) >>> 18 & 0x3ff;
    }
    return result[0] & 0x7ff | (result[1] & 0x7ff) << 11 | (result[2] & 0x3ff) << 22;
}
/**
 * Decompresses the three floats that was compressed to R11F_G11F_B10F format
 *
 * @param pk - The compressed value
 * @param result - A float array that will store the decompressed floats
 *
 * @public
 */ function unpackFloat3(pk, result) {
    /*
  result[0] = halfToFloat((pk & 0x7ff) << 4);
  result[1] = halfToFloat((pk & 0x3ff800) >> 7);
  result[2] = halfToFloat(((pk & 0xffc00000) >> 17) & 0x00007FFF);
  */ let mantissa;
    let exponent;
    const ret = [];
    const xm = pk & 0x3f;
    const xe = pk >>> 6 & 0x1f;
    const ym = pk >>> 11 & 0x3f;
    const ye = pk >>> 17 & 0x1f;
    const zm = pk >>> 22 & 0x1f;
    const ze = pk >>> 27;
    mantissa = xm;
    if (xe === 0x1f) {
        // INF or NAN
        ret[0] = 0x7f800000 | xm << 17;
    } else {
        if (xe !== 0) {
            exponent = xe;
        } else if (mantissa !== 0) {
            exponent = 1;
            do {
                exponent--;
                mantissa <<= 1;
            }while ((mantissa & 0x40) === 0)
            mantissa &= 0x3f;
        } else {
            exponent = -112;
        }
        ret[0] = exponent + 112 << 23 | mantissa << 17;
    }
    mantissa = ym;
    if (ye === 0x1f) {
        ret[1] = 0x7f800000 | ym << 17;
    } else {
        if (ye !== 0) {
            exponent = ye;
        } else if (mantissa !== 0) {
            exponent = 1;
            do {
                exponent--;
                mantissa <<= 1;
            }while ((mantissa & 0x40) === 0)
            mantissa &= 0x3f;
        } else {
            exponent = -112;
        }
        ret[1] = exponent + 112 << 23 | mantissa << 17;
    }
    mantissa = zm;
    if (ze === 0x1f) {
        ret[2] = 0x7f800000 | zm << 17;
    } else {
        if (ze !== 0) {
            exponent = ze;
        } else if (mantissa !== 0) {
            exponent = 1;
            do {
                exponent--;
                mantissa <<= 1;
            }while ((mantissa & 0x20) === 0)
            mantissa &= 0x1f;
        } else {
            exponent = -112;
        }
        ret[2] = exponent + 112 << 23 | mantissa << 18;
    }
    tmpUint32Array$1[0] = ret[0];
    result[0] = tmpFloatArray$1[0];
    tmpUint32Array$1[0] = ret[1];
    result[1] = tmpFloatArray$1[0];
    tmpUint32Array$1[0] = ret[2];
    result[2] = tmpFloatArray$1[0];
}
/**
 * Calculates the weighted average of a set of values.
 *
 * @param weights - An array of weights for each value.
 * @param values - An array of values to be averaged.
 * @param funcLerp - A function that performs linear interpolation between two values of type T.
 * @returns The weighted average of the values.
 *
 * @public
 */ function weightedAverage(weights, values, funcLerp) {
    let totalWeight = weights[0];
    let t = values[0];
    for(let i = 1; i < weights.length; i++){
        totalWeight += weights[i];
        t = funcLerp(t, values[i], weights[i] / totalWeight);
    }
    return t;
}

const tmpArrayBuffer = new ArrayBuffer(4);
const tmpFloatArray = new Float32Array(tmpArrayBuffer);
const tmpUint32Array = new Uint32Array(tmpArrayBuffer);
/**
 * Convert float16 to float32
 * @param f16 - float16 value
 * @returns float32 value
 * @public
 */ function half2float(f16) {
    let mantissa = f16 & 0x3ff;
    let exponent = f16 & 0x7c00;
    if (exponent === 0x7c00) {
        exponent = 0x8f;
    } else if (exponent !== 0) {
        exponent = f16 >>> 10 & 0x1f;
    } else if (mantissa !== 0) {
        exponent = 1;
        do {
            exponent--;
            mantissa <<= 1;
        }while ((mantissa & 0x0400) === 0)
        mantissa &= 0x3ff;
    } else {
        exponent = -112;
    }
    tmpUint32Array[0] = (f16 & 0x8000) << 16 | (exponent + 112 << 23 | mantissa << 13);
    return tmpFloatArray[0];
}
/**
 * Convert float32 to float16
 * @param f32 - float32 value
 * @returns float16 value
 * @public
 */ function float2half(f32) {
    tmpFloatArray[0] = f32;
    let ivalue = tmpUint32Array[0];
    let result;
    const sign = (ivalue & 0x80000000) >>> 16;
    ivalue = ivalue & 0x7fffffff;
    if (ivalue >= 0x47800000) {
        // number is too large
        result = 0x7c00 | (ivalue > 0x7f800000 ? 0x200 | ivalue >>> 13 & 0x3ff : 0);
    } else if (ivalue <= 0x33000000) {
        result = 0;
    } else if (ivalue < 0x38800000) {
        const shift = 125 - (ivalue >>> 23);
        ivalue = 0x800000 | ivalue & 0x7fffff;
        result = ivalue >>> shift + 1;
        const s = (ivalue & (1 << shift) - 1) !== 0 ? 1 : 0;
        result += (result | s) & (ivalue >>> shift & 1);
    } else {
        ivalue += 0xc8000000;
        result = ivalue + 0x0fff + (ivalue >>> 13 & 1) >>> 13 & 0x7fff;
    }
    return result | sign;
}

/**
 * Enumerator used to refer to a box side
 * @public
 */ var BoxSide = /*#__PURE__*/ function(BoxSide) {
    /** Left side (-x) */ BoxSide[BoxSide["LEFT"] = 0] = "LEFT";
    /** Right side (+x) */ BoxSide[BoxSide["RIGHT"] = 1] = "RIGHT";
    /** Bottom side (-y) */ BoxSide[BoxSide["BOTTOM"] = 2] = "BOTTOM";
    /** Top side (+y) */ BoxSide[BoxSide["TOP"] = 3] = "TOP";
    /** Front side (+z) */ BoxSide[BoxSide["FRONT"] = 4] = "FRONT";
    /** Back side (-z) */ BoxSide[BoxSide["BACK"] = 5] = "BACK";
    return BoxSide;
}({});
/**
 * The intersection test result of two object A and B
 * @public
 */ var ClipState = /*#__PURE__*/ function(ClipState) {
    /** A does not intersect with B */ ClipState[ClipState["NOT_CLIPPED"] = 0] = "NOT_CLIPPED";
    /** A is inside B */ ClipState[ClipState["A_INSIDE_B"] = 1] = "A_INSIDE_B";
    /** B is inside A */ ClipState[ClipState["B_INSIDE_A"] = 2] = "B_INSIDE_A";
    /** A and B partially overlap */ ClipState[ClipState["CLIPPED"] = 3] = "CLIPPED";
    return ClipState;
}({});
/**
 * Enumerator used to refer to the cube face
 * @public
 */ var CubeFace = /*#__PURE__*/ function(CubeFace) {
    /** Positive X Axis */ CubeFace[CubeFace["PX"] = 0] = "PX";
    /** Negative X Axis */ CubeFace[CubeFace["NX"] = 1] = "NX";
    /** Positive Y Axis */ CubeFace[CubeFace["PY"] = 2] = "PY";
    /** Negative Y Axis */ CubeFace[CubeFace["NY"] = 3] = "NY";
    /** Positive Z Axis */ CubeFace[CubeFace["PZ"] = 4] = "PZ";
    /** Negative Z Axis */ CubeFace[CubeFace["NZ"] = 5] = "NZ";
    return CubeFace;
}({});

const IDENT_MATRIX3x3 = new Float32Array([
    1,
    0,
    0,
    0,
    1,
    0,
    0,
    0,
    1
]);
const IDENT_MATRIX4x4 = new Float32Array([
    1,
    0,
    0,
    0,
    0,
    1,
    0,
    0,
    0,
    0,
    1,
    0,
    0,
    0,
    0,
    1
]);
/**
 * Base class for vector and matrix types.
 *
 * @public
 */ class VectorBase extends Float32Array {
    /**
   * Check if all data is close enough to another
   * @param other - The data to be compared with.
   * @param epsilon - The minimal error allowd.
   * @returns true if close enough, otherwise false.
   */ equalsTo(other, epsl) {
        if (!other || this.length !== other.length) {
            return false;
        }
        if (this === other) {
            return true;
        }
        for(let i = 0; i < this.length; i++){
            const a = this[i];
            const b = other[i];
            const e = epsl ?? 0.0001 * Math.max(1, Math.abs(a), Math.abs(b));
            if (Math.abs(a - b) > e) {
                return false;
            }
        }
        return true;
    }
    /**
   * Convert this to string object.
   */ toString() {
        const elements = [
            ...this
        ].map((val)=>val.toFixed(3));
        return `${this.constructor.name}{${elements.join(',')}}`;
    }
    /**
   * Check the data for the presence of NaN.
   *
   * @returns true if NaN is present, otherwise false.
   */ isNaN() {
        for(let i = 0; i < this.length; i++){
            if (Number.isNaN(this[i])) {
                return true;
            }
        }
        return false;
    }
    /**
   * Generate random vector
   *
   * @param minValue - Minimum value of any component of the vector
   * @param maxValue - Maximum value of any component of the vector
   */ setRandom(minValue, maxValue) {
        for(let i = 0; i < this.length; i++){
            this[i] = minValue + (maxValue - minValue) * Math.random();
        }
    }
}
/**
 * 2 dimentional vector
 * @public
 */ class Vector2 extends VectorBase {
    constructor(arg0, arg1){
        if (arg0 instanceof ArrayBuffer && typeof arg1 === 'number') {
            super(arg0, arg1, 2);
        } else {
            super(2);
            if (typeof arg0 === 'number' && typeof arg1 === 'number') {
                this[0] = arg0;
                this[1] = arg1;
            } else if ((arg0 instanceof Float32Array || Array.isArray(arg0)) && arg0.length >= 2) {
                this[0] = arg0[0];
                this[1] = arg0[1];
            } else if (arg0 !== undefined) {
                throw new Error(`Vector2.constructor(): invalid arguments`);
            }
        }
    }
    /**
   * Creates a new Vector2 initialized with values from this vector.
   * @returns The new Vector2.
   */ clone() {
        return new Vector2(this);
    }
    /** Get the x component value. */ get x() {
        return this[0];
    }
    set x(v) {
        this[0] = v;
    }
    /** Get the y component value. */ get y() {
        return this[1];
    }
    set y(v) {
        this[1] = v;
    }
    /** Get the length of the vector. */ get magnitude() {
        return Math.hypot(this[0], this[1]);
    }
    /** Get the squared length of the vector. */ get magnitudeSq() {
        return this[0] * this[0] + this[1] * this[1];
    }
    /**
   * Set component values.
   * @param x - The x component value.
   * @param y - The y component value.
   * @returns self
   */ setXY(x, y) {
        this[0] = x;
        this[1] = y;
        return this;
    }
    /**
   * Set component values and then normalize the vector.
   * @param x - The x component value.
   * @param y - The y component value.
   * @returns self
   */ setAndNormalize(x, y) {
        const mag = Math.hypot(x, y);
        return this.setXY(x / mag, y / mag);
    }
    /**
   * Subtract a vector from this vector.
   * @param other - The vector that will be subtract.
   * @returns self
   */ subBy(other) {
        Vector2.sub(this, other, this);
        return this;
    }
    /**
   * Add a vector to this vector.
   * @param other - The vector that will be added.
   * @returns self
   */ addBy(other) {
        Vector2.add(this, other, this);
        return this;
    }
    /**
   * Combine a vector to this vector.
   * @param other - The vector that will be added.
   * @param t0 - Scale factor for this vector
   * @param t1 - Scale factor for other vector
   * @returns self
   */ combineBy(other, t0, t1) {
        Vector2.combine(this, other, t0, t1, this);
        return this;
    }
    /**
   * Multiply this vector by a vector.
   * @param other - The vector that will be multiplied by.
   * @returns self
   */ mulBy(other) {
        Vector2.mul(this, other, this);
        return this;
    }
    /**
   * Divide this vector by a vector.
   * @param other - The vector that will be divide by.
   * @returns self
   */ divBy(other) {
        Vector2.div(this, other, this);
        return this;
    }
    /**
   * Scale this vector by a scalar number.
   * @param f - amount to scale this vector by.
   * @returns self
   */ scaleBy(f) {
        Vector2.scale(this, f, this);
        return this;
    }
    /**
   * Normalize this vector inplace.
   * @returns self
   */ inplaceNormalize() {
        Vector2.normalize(this, this);
        return this;
    }
    /**
   * Inverse this vector inplace.
   * @returns self
   */ inplaceInverse() {
        Vector2.inverse(this, this);
        return this;
    }
    /**
   * Set the component values to the minimum of this vector and another vector.
   * @param other - The vector that to be compared with.
   * @returns self
   */ inplaceMin(other) {
        Vector2.min(this, other, this);
        return this;
    }
    /**
   * Set the component values to the maximum of this vector and another vector.
   * @param other - The vector that to be compared with.
   * @returns self
   */ inplaceMax(other) {
        Vector2.max(this, other, this);
        return this;
    }
    /**
   * Creates a new Vector2 initialized with zero values.
   * @returns The new vector
   */ static zero() {
        return new Vector2(0, 0);
    }
    /**
   * Creates a new Vector2 initialized with one.
   * @returns The new vector
   */ static one() {
        return new Vector2(1, 1);
    }
    /**
   * Creates a new Vector2 pointing in the positive direction of the X axis, i.e. vec2(1, 0)
   * @returns The new vector
   */ static axisPX() {
        return new Vector2(1, 0);
    }
    /**
   * Creates a new Vector2 pointing in the negative direction of the X axis, i.e. vec2(-1, 0)
   * @returns The new vector
   */ static axisNX() {
        return new Vector2(-1, 0);
    }
    /**
   * Creates a new Vector2 pointing in the positive direction of the Y axis, i.e. vec2(0, 1)
   * @returns The new vector
   */ static axisPY() {
        return new Vector2(0, 1);
    }
    /**
   * Creates a new Vector2 pointing in the negative direction of the Y axis, i.e. vec2(0, -1)
   * @returns The new vector
   */ static axisNY() {
        return new Vector2(0, -1);
    }
    /**
   * Calculates the distance between two Vector2's.
   * @param v1 - The first vector.
   * @param v2 - The second vector.
   * @returns distance between v1 and v2
   */ static distance(v1, v2) {
        return Math.hypot(v1.x - v2.x, v1.y - v2.y);
    }
    /**
   * Calculates the squared distance between two Vector2's.
   * @param v1 - The first vector.
   * @param v2 - The second vector.
   * @returns squared distance between v1 and v2
   */ static distanceSq(v1, v2) {
        const dx = v1.x - v2.x;
        const dy = v1.y - v2.y;
        return dx * dx + dy * dy;
    }
    /**
   * Normalize a Vector2
   * @param v - The input vector
   * @param result - The output vector (can be the same vector as v). if not specified, a new vector will be created.
   * @returns The output vector
   */ static normalize(v, result) {
        const len = v.magnitude;
        const x = v.x / len;
        const y = v.y / len;
        return (result || new Vector2()).setXY(x, y);
    }
    /**
   * Inverse a Vector2
   * @param v - The input vector
   * @param result - The output vector (can be the same vector as v). if not specified, a new vector will be created.
   * @returns The output vector
   */ static inverse(v, result) {
        const x = 1 / v.x;
        const y = 1 / v.y;
        return (result || new Vector2()).setXY(x, y);
    }
    /**
   * Subtract two Vector2's.
   * @param a - The first operand.
   * @param b - The second operand.
   * @param result - The output vector (can be the same vector as a or b). if not specified, a new vector will be created.
   * @returns The output vector
   */ static sub(a, b, result) {
        const x = a.x - b.x;
        const y = a.y - b.y;
        return (result || new Vector2()).setXY(x, y);
    }
    /**
   * Add two Vector2's.
   * @param a - The first operand.
   * @param b - The second operand.
   * @param result - The output vector (can be the same vector as a or b). if not specified, a new vector will be created.
   * @returns The output vector
   */ static add(a, b, result) {
        const x = a.x + b.x;
        const y = a.y + b.y;
        return (result || new Vector2()).setXY(x, y);
    }
    /**
   * Combine two Vector2's.
   * @param a - The first operand.
   * @param b - The second operand.
   * @param t0 - Scale factor for the first operand
   * @param t1 - Scale factor for the second operand
   * @param result - The output vector (can be the same vector as a or b). if not specified, a new vector will be created.
   * @returns The output vector
   */ static combine(a, b, t0, t1, result) {
        const x = a.x * t0 + b.x * t1;
        const y = a.y * t0 + b.y * t1;
        return (result || new Vector2()).setXY(x, y);
    }
    /**
   * Multiply two Vector2's.
   * @param a - The first operand.
   * @param b - The second operand.
   * @param result - The output vector (can be the same vector as a or b). if not specified, a new vector will be created.
   * @returns The output vector
   */ static mul(a, b, result) {
        const x = a.x * b.x;
        const y = a.y * b.y;
        return (result || new Vector2()).setXY(x, y);
    }
    /**
   * Divide two Vector2's.
   * @param a - The first operand.
   * @param b - The second operand.
   * @param result - The output vector (can be the same vector as a or b). if not specified, a new vector will be created.
   * @returns The output vector
   */ static div(a, b, result) {
        const x = a.x / b.x;
        const y = a.y / b.y;
        return (result || new Vector2()).setXY(x, y);
    }
    /**
   * Scale a Vector2 by a scalar number.
   * @param a - The vector to be scaled.
   * @param b - The scalar number.
   * @param result - The output vector (can be the same vector as a). if not specified, a new vector will be created.
   * @returns The output vector
   */ static scale(a, b, result) {
        const x = a.x * b;
        const y = a.y * b;
        return (result || new Vector2()).setXY(x, y);
    }
    /**
   * Calculates the minimum of two Vector2's.
   * @param a - The first operand.
   * @param b - The second operand.
   * @param result - The output vector (can be the same vector as a or b). if not specified, a new vector will be created.
   * @returns The output vector
   */ static min(a, b, result) {
        const x = a.x < b.x ? a.x : b.x;
        const y = a.y < b.y ? a.y : b.y;
        return (result || new Vector2()).setXY(x, y);
    }
    /**
   * Calculates the maximum of two Vector2's.
   * @param a - The first operand.
   * @param b - The second operand.
   * @param result - The output vector (can be the same vector as a or b). if not specified, a new vector will be created.
   * @returns The output vector
   */ static max(a, b, result) {
        const x = a.x > b.x ? a.x : b.x;
        const y = a.y > b.y ? a.y : b.y;
        return (result || new Vector2()).setXY(x, y);
    }
    /**
   * Calculates the absolute values of a Vector2.
   * @param a - The input vector.
   * @param result - The output vector (can be the same vector as a or b). if not specified, a new vector will be created.
   * @returns The output vector
   */ static abs(a, result) {
        const x = a.x < 0 ? -a.x : a.x;
        const y = a.y < 0 ? -a.y : a.y;
        return (result || new Vector2()).setXY(x, y);
    }
    /**
   * Calculates the dot product of two Vector2's.
   * @param a - The first operand.
   * @param b - The second operand.
   * @returns dot product of a and b
   */ static dot(a, b) {
        return a.x * b.x + a.y * b.y;
    }
    /**
   * Calculates the cross product of two Vector2's.
   * @param a - The first operand.
   * @param b - The second operand.
   * @returns z component of the cross product of the two vectors.
   */ static cross(a, b) {
        return a.x * b.y - a.y * b.x;
    }
}
/**
 * Observable 2 dimentional vector
 *
 * @public
 */ class ObservableVector2 extends Vector2 {
    /** @internal */ _callback = null;
    /** The callback function which will be executed when the value changed */ get callback() {
        return this._callback;
    }
    set callback(cb) {
        this._callback = cb;
    }
    /** Set callback */ setCallback(cb) {
        this._callback = cb;
        return this;
    }
    /**
   * {@inheritDoc Vector2.x}
   */ get x() {
        return super.x;
    }
    set x(val) {
        val = toFloat(val);
        if (val !== super.x) {
            super.x = val;
            this._callback?.();
        }
    }
    /**
   * {@inheritDoc Vector2.y}
   */ get y() {
        return super.y;
    }
    set y(val) {
        val = toFloat(val);
        if (val !== super.y) {
            super.y = val;
            this._callback?.();
        }
    }
    /**
   * {@inheritDoc Vector2.setXY}
   */ setXY(x, y) {
        x = toFloat(x);
        y = toFloat(y);
        if (x !== super.x || y !== super.y) {
            super.setXY(x, y);
            this._callback?.();
        }
        return this;
    }
    /**
   * Inherited from Float32Array.copyWithin
   */ copyWithin(target, start, end) {
        super.copyWithin(target, start, end);
        this._callback?.();
        return this;
    }
    /**
   * Inherited from Float32Array.fill
   */ fill(value, start, end) {
        super.fill(value, start, end);
        this._callback?.();
        return this;
    }
    /**
   * Inherited from Float32Array.reverse
   */ reverse() {
        super.reverse();
        this._callback?.();
        return this;
    }
    /**
   * Inherited from Float32Array.set
   */ set(array, offset) {
        super.set(array, offset);
        this._callback?.();
    }
    /**
   * Inherited from Float32Array.sort
   */ sort(compareFn) {
        super.sort(compareFn);
        this._callback?.();
        return this;
    }
}
/**
 * 3 dimentional vector
 * @public
 */ class Vector3 extends VectorBase {
    constructor(arg0, arg1, arg2){
        if (arg0 instanceof ArrayBuffer && typeof arg1 === 'number') {
            super(arg0, arg1, 3);
        } else {
            super(3);
            if (typeof arg0 === 'number' && typeof arg1 === 'number' && typeof arg2 === 'number') {
                this[0] = arg0;
                this[1] = arg1;
                this[2] = arg2;
            } else if ((arg0 instanceof Float32Array || Array.isArray(arg0)) && arg0.length >= 3) {
                this[0] = arg0[0];
                this[1] = arg0[1];
                this[2] = arg0[2];
            } else if (arg0 !== undefined) {
                throw new Error('Vector3.constructor(): invalid arguments');
            }
        }
    }
    /**
   * Creates a new Vector3 initialized with values from this vector.
   * @returns The new vector.
   */ clone() {
        return new Vector3(this);
    }
    /** Get the x component value. */ get x() {
        return this[0];
    }
    set x(v) {
        this[0] = v;
    }
    /** Get the y component value. */ get y() {
        return this[1];
    }
    set y(v) {
        this[1] = v;
    }
    /** Get the z component value. */ get z() {
        return this[2];
    }
    set z(v) {
        this[2] = v;
    }
    /** Get the length of the vector. */ get magnitude() {
        return Math.hypot(this[0], this[1], this[2]);
    }
    /** Get the squared length of the vector. */ get magnitudeSq() {
        return this[0] * this[0] + this[1] * this[1] + this[2] * this[2];
    }
    /**
   * Creates a new Vector2 initialized with x, y component of this vector.
   * @returns The new vector
   */ xy() {
        return new Vector2(this.x, this.y);
    }
    /**
   * Set component values.
   * @param x - The x component value.
   * @param y - The y component value.
   * @param z - The z component value.
   * @returns self
   */ setXYZ(x, y, z) {
        this[0] = x;
        this[1] = y;
        this[2] = z;
        return this;
    }
    /**
   * Set component values and then normalize the vector.
   * @param x - The x component value.
   * @param y - The y component value.
   * @param z - The z component value.
   * @returns self
   */ setAndNormalize(x, y, z) {
        const mag = Math.hypot(x, y, z);
        return this.setXYZ(x / mag, y / mag, z / mag);
    }
    /**
   * Subtract a vector from this vector.
   * @param other - The vector that will be subtract.
   * @returns self
   */ subBy(other) {
        Vector3.sub(this, other, this);
        return this;
    }
    /**
   * Add a vector to this vector.
   * @param other - The vector that will be added.
   * @returns self
   */ addBy(other) {
        Vector3.add(this, other, this);
        return this;
    }
    /**
   * Combine a vector to this vector.
   * @param other - The vector that will be added.
   * @param t0 - Scale factor for this vector
   * @param t1 - Scale factor for other vector
   * @returns self
   */ combineBy(other, t0, t1) {
        Vector3.combine(this, other, t0, t1, this);
        return this;
    }
    /**
   * Multiply this vector by a vector.
   * @param other - The vector that will be multiplied by.
   * @returns self
   */ mulBy(other) {
        Vector3.mul(this, other, this);
        return this;
    }
    /**
   * Divide this vector by a vector.
   * @param other - The vector that will be divide by.
   * @returns self
   */ divBy(other) {
        Vector3.div(this, other, this);
        return this;
    }
    /**
   * Scale this vector by a scalar number.
   * @param f - amount to scale this vector by.
   * @returns self
   */ scaleBy(f) {
        Vector3.scale(this, f, this);
        return this;
    }
    /**
   * Normalize this vector inplace.
   * @returns self
   */ inplaceNormalize() {
        Vector3.normalize(this, this);
        return this;
    }
    /**
   * Inverse this vector inplace.
   * @returns self
   */ inplaceInverse() {
        Vector3.inverse(this, this);
        return this;
    }
    /**
   * Set the component values to the minimum of this vector and another vector.
   * @param other - The vector that to be compared with.
   * @returns self
   */ inplaceMin(other) {
        Vector3.min(this, other, this);
        return this;
    }
    /**
   * Set the component values to the maximum of this vector and another vector.
   * @param other - The vector that to be compared with.
   * @returns self
   */ inplaceMax(other) {
        Vector3.max(this, other, this);
        return this;
    }
    /**
   * Creates a new Vector3 initialized with zero values.
   * @returns The new vector
   */ static zero() {
        return new Vector3(0, 0, 0);
    }
    /**
   * Creates a new Vector3 initialized with one.
   * @returns The new vector
   */ static one() {
        return new Vector3(1, 1, 1);
    }
    /**
   * Creates a new Vector3 pointing in the positive direction of the X axis, i.e. vec3(1, 0, 0)
   * @returns The new vector
   */ static axisPX() {
        return new Vector3(1, 0, 0);
    }
    /**
   * Creates a new Vector3 pointing in the negative direction of the X axis, i.e. vec3(-1, 0, 0)
   * @returns The new vector
   */ static axisNX() {
        return new Vector3(-1, 0, 0);
    }
    /**
   * Creates a new Vector3 pointing in the positive direction of the Y axis, i.e. vec3(0, 1, 0)
   * @returns The new vector
   */ static axisPY() {
        return new Vector3(0, 1, 0);
    }
    /**
   * Creates a new Vector3 pointing in the negative direction of the Y axis, i.e. vec3(0, -1, 0)
   * @returns The new vector
   */ static axisNY() {
        return new Vector3(0, -1, 0);
    }
    /**
   * Creates a new Vector3 pointing in the positive direction of the Z axis, i.e. vec3(0, 0, 1)
   * @returns The new vector
   */ static axisPZ() {
        return new Vector3(0, 0, 1);
    }
    /**
   * Creates a new Vector2 pointing in the negative direction of the Z axis, i.e. vec3(0, 0, -1)
   * @returns The new vector
   */ static axisNZ() {
        return new Vector3(0, 0, -1);
    }
    /**
   * Calculates the distance between two Vector3's.
   * @param v1 - The first vector.
   * @param v2 - The second vector.
   * @returns distance between v1 and v2
   */ static distance(v1, v2) {
        return Math.hypot(v1.x - v2.x, v1.y - v2.y, v1.z - v2.z);
    }
    /**
   * Calculates the squared distance between two Vector3's.
   * @param v1 - The first vector.
   * @param v2 - The second vector.
   * @returns squared distance between v1 and v2
   */ static distanceSq(v1, v2) {
        const dx = v1.x - v2.x;
        const dy = v1.y - v2.y;
        const dz = v1.z - v2.z;
        return dx * dx + dy * dy + dz * dz;
    }
    /**
   * Normalize a Vector3
   * @param v - The input vector
   * @param result - The output vector (can be the same vector as v). if not specified, a new vector will be created.
   * @returns The output vector
   */ static normalize(v, result) {
        const len = v.magnitude;
        const x = v.x / len;
        const y = v.y / len;
        const z = v.z / len;
        return (result || new Vector3()).setXYZ(x, y, z);
    }
    /**
   * Inverse a Vector3
   * @param v - The input vector
   * @param result - The output vector (can be the same vector as v). if not specified, a new vector will be created.
   * @returns The output vector
   */ static inverse(v, result) {
        const x = 1 / v.x;
        const y = 1 / v.y;
        const z = 1 / v.z;
        return (result || new Vector3()).setXYZ(x, y, z);
    }
    /**
   * Subtract two Vector3's.
   * @param a - The first operand.
   * @param b - The second operand.
   * @param result - The output vector (can be the same vector as a or b). if not specified, a new vector will be created.
   * @returns The output vector
   */ static sub(a, b, result) {
        const x = a.x - b.x;
        const y = a.y - b.y;
        const z = a.z - b.z;
        return (result || new Vector3()).setXYZ(x, y, z);
    }
    /**
   * Add two Vector3's.
   * @param a - The first operand.
   * @param b - The second operand.
   * @param result - The output vector (can be the same vector as a or b). if not specified, a new vector will be created.
   * @returns The output vector
   */ static add(a, b, result) {
        const x = a.x + b.x;
        const y = a.y + b.y;
        const z = a.z + b.z;
        return (result || new Vector3()).setXYZ(x, y, z);
    }
    /**
   * Combine two Vector3's.
   * @param a - The first operand.
   * @param b - The second operand.
   * @param t0 - Scale factor for the first operand
   * @param t1 - Scale factor for the second operand
   * @param result - The output vector (can be the same vector as a or b). if not specified, a new vector will be created.
   * @returns The output vector
   */ static combine(a, b, t0, t1, result) {
        const x = a.x * t0 + b.x * t1;
        const y = a.y * t0 + b.y * t1;
        const z = a.z * t0 + b.z * t1;
        return (result || new Vector3()).setXYZ(x, y, z);
    }
    /**
   * Multiply two Vector3's.
   * @param a - The first operand.
   * @param b - The second operand.
   * @param result - The output vector (can be the same vector as a or b). if not specified, a new vector will be created.
   * @returns The output vector
   */ static mul(a, b, result) {
        const x = a.x * b.x;
        const y = a.y * b.y;
        const z = a.z * b.z;
        return (result || new Vector3()).setXYZ(x, y, z);
    }
    /**
   * Divide two Vector3's.
   * @param a - The first operand.
   * @param b - The second operand.
   * @param result - The output vector (can be the same vector as a or b). if not specified, a new vector will be created.
   * @returns The output vector
   */ static div(a, b, result) {
        const x = a.x / b.x;
        const y = a.y / b.y;
        const z = a.z / b.z;
        return (result || new Vector3()).setXYZ(x, y, z);
    }
    /**
   * Scale a Vector3 by a scalar number.
   * @param a - The vector to be scaled.
   * @param b - The scalar number.
   * @param result - The output vector (can be the same vector as a). if not specified, a new vector will be created.
   * @returns The output vector
   */ static scale(a, b, result) {
        const x = a.x * b;
        const y = a.y * b;
        const z = a.z * b;
        return (result || new Vector3()).setXYZ(x, y, z);
    }
    /**
   * Calculates the minimum of two Vector3's.
   * @param a - The first operand.
   * @param b - The second operand.
   * @param result - The output vector (can be the same vector as a or b). if not specified, a new vector will be created.
   * @returns The output vector
   */ static min(a, b, result) {
        const x = a.x < b.x ? a.x : b.x;
        const y = a.y < b.y ? a.y : b.y;
        const z = a.z < b.z ? a.z : b.z;
        return (result || new Vector3()).setXYZ(x, y, z);
    }
    /**
   * Calculates the maximum of two Vector3's.
   * @param a - The first operand.
   * @param b - The second operand.
   * @param result - The output vector (can be the same vector as a or b). if not specified, a new vector will be created.
   * @returns The output vector
   */ static max(a, b, result) {
        const x = a.x > b.x ? a.x : b.x;
        const y = a.y > b.y ? a.y : b.y;
        const z = a.z > b.z ? a.z : b.z;
        return (result || new Vector3()).setXYZ(x, y, z);
    }
    /**
   * Calculates the absolute values of a Vector3.
   * @param a - The input vector.
   * @param result - The output vector (can be the same vector as a or b). if not specified, a new vector will be created.
   * @returns The output vector
   */ static abs(a, result) {
        const x = a.x < 0 ? -a.x : a.x;
        const y = a.y < 0 ? -a.y : a.y;
        const z = a.z < 0 ? -a.z : a.z;
        return (result || new Vector3()).setXYZ(x, y, z);
    }
    /**
   * Calculates the dot product of two Vector3's.
   * @param a - The first operand.
   * @param b - The second operand.
   * @returns dot product of a and b
   */ static dot(a, b) {
        return a.x * b.x + a.y * b.y + a.z * b.z;
    }
    /**
   * Calculates the cross product of two Vector3's.
   * @param a - The first operand.
   * @param b - The second operand.
   * @returns the cross product of the two vectors.
   */ static cross(a, b, result) {
        const x = a.y * b.z - a.z * b.y;
        const y = a.z * b.x - a.x * b.z;
        const z = a.x * b.y - a.y * b.x;
        return (result || new Vector3()).setXYZ(x, y, z);
    }
}
/**
 * Observable 3 dimentional vector
 *
 * @public
 */ class ObservableVector3 extends Vector3 {
    /** @internal */ _callback = null;
    /** The callback function which will be executed when the value changed */ get callback() {
        return this._callback;
    }
    set callback(cb) {
        this._callback = cb;
    }
    /** Set callback */ setCallback(cb) {
        this._callback = cb;
        return this;
    }
    /**
   * {@inheritDoc Vector3.x}
   */ get x() {
        return super.x;
    }
    set x(val) {
        val = toFloat(val);
        if (val !== super.x) {
            super.x = val;
            this._callback?.();
        }
    }
    /**
   * {@inheritDoc Vector3.y}
   */ get y() {
        return super.y;
    }
    set y(val) {
        val = toFloat(val);
        if (val !== super.y) {
            super.y = val;
            this._callback?.();
        }
    }
    /**
   * {@inheritDoc Vector3.z}
   */ get z() {
        return super.z;
    }
    set z(val) {
        val = toFloat(val);
        if (val !== super.z) {
            super.z = val;
            this._callback?.();
        }
    }
    /**
   * {@inheritDoc Vector3.setXYZ}
   */ setXYZ(x, y, z) {
        x = toFloat(x);
        y = toFloat(y);
        z = toFloat(z);
        if (x !== super.x || y !== super.y || z !== super.z) {
            super.setXYZ(x, y, z);
            this._callback?.();
        }
        return this;
    }
    /**
   * Inherited from Float32Array.copyWithin
   */ copyWithin(target, start, end) {
        super.copyWithin(target, start, end);
        this._callback?.();
        return this;
    }
    /**
   * Inherited from Float32Array.fill
   */ fill(value, start, end) {
        super.fill(value, start, end);
        this._callback?.();
        return this;
    }
    /**
   * Inherited from Float32Array.reverse
   */ reverse() {
        super.reverse();
        this._callback?.();
        return this;
    }
    /**
   * Inherited from Float32Array.set
   */ set(array, offset) {
        super.set(array, offset);
        this._callback?.();
    }
    /**
   * Inherited from Float32Array.sort
   */ sort(compareFn) {
        super.sort(compareFn);
        this._callback?.();
        return this;
    }
}
/**
 * 4 dimentional vector
 * @public
 */ class Vector4 extends VectorBase {
    constructor(arg0, arg1, arg2, arg3){
        if (arg0 instanceof ArrayBuffer && typeof arg1 === 'number') {
            super(arg0, arg1, 4);
        } else {
            super(4);
            if (typeof arg0 === 'number' && typeof arg1 === 'number' && typeof arg2 === 'number' && typeof arg3 === 'number') {
                this[0] = arg0;
                this[1] = arg1;
                this[2] = arg2;
                this[3] = arg3;
            } else if ((arg0 instanceof Float32Array || Array.isArray(arg0)) && arg0.length >= 4) {
                this[0] = arg0[0];
                this[1] = arg0[1];
                this[2] = arg0[2];
                this[3] = arg0[3];
            } else if (arg0 !== undefined) {
                throw new Error('Vector4.constructor(): invalid arguments');
            }
        }
    }
    /**
   * Creates a new Vector4 initialized with values from this vector.
   * @returns The new vector.
   */ clone() {
        return new Vector4(this);
    }
    /** Get the x component value. */ get x() {
        return this[0];
    }
    set x(v) {
        this[0] = v;
    }
    /** Get the y component value. */ get y() {
        return this[1];
    }
    set y(v) {
        this[1] = v;
    }
    /** Get the z component value. */ get z() {
        return this[2];
    }
    set z(v) {
        this[2] = v;
    }
    /** Get the w component value. */ get w() {
        return this[3];
    }
    set w(v) {
        this[3] = v;
    }
    /** Get the length of the vector. */ get magnitude() {
        return Math.hypot(this[0], this[1], this[2], this[3]);
    }
    /** Get the squared length of the vector. */ get magnitudeSq() {
        return this[0] * this[0] + this[1] * this[1] + this[2] * this[2] + this[3] * this[3];
    }
    /**
   * Creates a new Vector2 initialized with x, y component of this vector.
   * @returns The new vector
   */ xy() {
        return new Vector2(this.x, this.y);
    }
    /**
   * Creates a new Vector3 initialized with x, y, z component of this vector.
   * @returns The new vector
   */ xyz() {
        return new Vector3(this.x, this.y, this.z);
    }
    /**
   * Set component values.
   * @param x - The x component value.
   * @param y - The y component value.
   * @param z - The z component value.
   * @param w - The w component value.
   * @returns self
   */ setXYZW(x, y, z, w) {
        this[0] = x;
        this[1] = y;
        this[2] = z;
        this[3] = w;
        return this;
    }
    /**
   * Set component values and then normalize the vector.
   * @param x - The x component value.
   * @param y - The y component value.
   * @param z - The z component value.
   * @param w - The w component value.
   * @returns self
   */ setAndNormalize(x, y, z, w) {
        const mag = Math.hypot(x, y, z, w);
        return this.setXYZW(x / mag, y / mag, z / mag, w / mag);
    }
    /**
   * Subtract a vector from this vector.
   * @param other - The vector that will be subtract.
   * @returns self
   */ subBy(other) {
        Vector4.sub(this, other, this);
        return this;
    }
    /**
   * Add a vector to this vector.
   * @param other - The vector that will be added.
   * @returns self
   */ addBy(other) {
        Vector4.add(this, other, this);
        return this;
    }
    /**
   * Combine a vector to this vector.
   * @param other - The vector that will be added.
   * @param t0 - Scale factor for this vector
   * @param t1 - Scale factor for other vector
   * @returns self
   */ combineBy(other, t0, t1) {
        Vector4.combine(this, other, t0, t1, this);
        return this;
    }
    /**
   * Multiply this vector by a vector.
   * @param other - The vector that will be multiplied by.
   * @returns self
   */ mulBy(other) {
        Vector4.mul(this, other, this);
        return this;
    }
    /**
   * Divide this vector by a vector.
   * @param other - The vector that will be divide by.
   * @returns self
   */ divBy(other) {
        Vector4.div(this, other, this);
        return this;
    }
    /**
   * Scale this vector by a scalar number.
   * @param f - amount to scale this vector by.
   * @returns self
   */ scaleBy(f) {
        Vector4.scale(this, f, this);
        return this;
    }
    /**
   * Normalize this vector inplace.
   * @returns self
   */ inplaceNormalize() {
        Vector4.normalize(this, this);
        return this;
    }
    /**
   * Inverse this vector inplace.
   * @returns self
   */ inplaceInverse() {
        Vector4.inverse(this, this);
        return this;
    }
    /**
   * Set the component values to the minimum of this vector and another vector.
   * @param other - The vector that to be compared with.
   * @returns self
   */ inplaceMin(other) {
        Vector4.min(this, other, this);
        return this;
    }
    /**
   * Set the component values to the maximum of this vector and another vector.
   * @param other - The vector that to be compared with.
   * @returns self
   */ inplaceMax(other) {
        Vector4.max(this, other, this);
        return this;
    }
    /**
   * Creates a new Vector4 initialized with zero values.
   * @returns The new vector
   */ static zero() {
        return new Vector4(0, 0, 0, 0);
    }
    /**
   * Creates a new Vector4 initialized with one.
   * @returns The new vector
   */ static one() {
        return new Vector4(1, 1, 1, 1);
    }
    /**
   * Creates a new Vector4 pointing in the positive direction of the X axis, i.e. vec4(1, 0, 0, 0)
   * @returns The new vector
   */ static axisPX() {
        return new Vector4(1, 0, 0, 0);
    }
    /**
   * Creates a new Vector4 pointing in the negative direction of the X axis, i.e. vec4(-1, 0, 0, 0)
   * @returns The new vector
   */ static axisNX() {
        return new Vector4(-1, 0, 0, 0);
    }
    /**
   * Creates a new Vector4 pointing in the positive direction of the Y axis, i.e. vec4(0, 1, 0, 0)
   * @returns The new vector
   */ static axisPY() {
        return new Vector4(0, 1, 0, 0);
    }
    /**
   * Creates a new Vector4 pointing in the negative direction of the Y axis, i.e. vec4(0, -1, 0, 0)
   * @returns The new vector
   */ static axisNY() {
        return new Vector4(0, -1, 0, 0);
    }
    /**
   * Creates a new Vector4 pointing in the positive direction of the Z axis, i.e. vec4(0, 0, 1, 0)
   * @returns The new vector
   */ static axisPZ() {
        return new Vector4(0, 0, 1, 0);
    }
    /**
   * Creates a new Vector4 pointing in the negative direction of the Z axis, i.e. vec4(0, 0, -1, 0)
   * @returns The new vector
   */ static axisNZ() {
        return new Vector4(0, 0, -1, 0);
    }
    /**
   * Creates a new Vector4 pointing in the positive direction of the W axis, i.e. vec4(0, 0, 0, 1)
   * @returns The new vector
   */ static axisPW() {
        return new Vector4(0, 0, 0, 1);
    }
    /**
   * Creates a new Vector4 pointing in the negative direction of the W axis, i.e. vec4(0, 0, 0, -1)
   * @returns The new vector
   */ static axisNW() {
        return new Vector4(0, 0, 0, -1);
    }
    /**
   * Normalize a Vector4
   * @param v - The input vector
   * @param result - The output vector (can be the same as v). if not specified, a new vector will be created.
   * @returns The output vector
   */ static normalize(v, result) {
        const len = v.magnitude;
        const x = v.x / len;
        const y = v.y / len;
        const z = v.z / len;
        const w = v.w / len;
        return (result || new Vector4()).setXYZW(x, y, z, w);
    }
    /**
   * Inverse a Vector4
   * @param v - The input vector
   * @param result - The output vector (can be the same vector as v). if not specified, a new vector will be created.
   * @returns The output vector
   */ static inverse(v, result) {
        const x = 1 / v.x;
        const y = 1 / v.y;
        const z = 1 / v.z;
        const w = 1 / v.w;
        return (result || new Vector4()).setXYZW(x, y, z, w);
    }
    /**
   * Subtract two Vector4's.
   * @param a - The first operand.
   * @param b - The second operand.
   * @param result - The output vector (can be the same vector as a or b). if not specified, a new vector will be created.
   * @returns The output vector
   */ static sub(a, b, result) {
        const x = a.x - b.x;
        const y = a.y - b.y;
        const z = a.z - b.z;
        const w = a.w - b.w;
        return (result || new Vector4()).setXYZW(x, y, z, w);
    }
    /**
   * Add two Vector4's.
   * @param a - The first operand.
   * @param b - The second operand.
   * @param result - The output vector (can be the same vector as a or b). if not specified, a new vector will be created.
   * @returns The output vector
   */ static add(a, b, result) {
        const x = a.x + b.x;
        const y = a.y + b.y;
        const z = a.z + b.z;
        const w = a.w + b.w;
        return (result || new Vector4()).setXYZW(x, y, z, w);
    }
    /**
   * Combine two Vector4's.
   * @param a - The first operand.
   * @param b - The second operand.
   * @param t0 - Scale factor for the first operand
   * @param t1 - Scale factor for the second operand
   * @param result - The output vector (can be the same vector as a or b). if not specified, a new vector will be created.
   * @returns The output vector
   */ static combine(a, b, t0, t1, result) {
        const x = a.x * t0 + b.x * t1;
        const y = a.y * t0 + b.y * t1;
        const z = a.z * t0 + b.z * t1;
        const w = a.w * t0 + b.w * t1;
        return (result || new Vector4()).setXYZW(x, y, z, w);
    }
    /**
   * Multiply two Vector4's.
   * @param a - The first operand.
   * @param b - The second operand.
   * @param result - The output vector (can be the same vector as a or b). if not specified, a new vector will be created.
   * @returns The output vector
   */ static mul(a, b, result) {
        const x = a.x * b.x;
        const y = a.y * b.y;
        const z = a.z * b.z;
        const w = a.w * b.w;
        return (result || new Vector4()).setXYZW(x, y, z, w);
    }
    /**
   * Divide two Vector4's.
   * @param a - The first operand.
   * @param b - The second operand.
   * @param result - The output vector (can be the same vector as a or b). if not specified, a new vector will be created.
   * @returns The output vector
   */ static div(a, b, result) {
        const x = a.x / b.x;
        const y = a.y / b.y;
        const z = a.z / b.z;
        const w = a.w / b.w;
        return (result || new Vector4()).setXYZW(x, y, z, w);
    }
    /**
   * Scale a Vector4 by a scalar number.
   * @param a - The vector to be scaled.
   * @param b - The scalar number.
   * @param result - The output vector (can be the same vector as a). if not specified, a new vector will be created.
   * @returns The output vector
   */ static scale(a, b, result) {
        const x = a.x * b;
        const y = a.y * b;
        const z = a.z * b;
        const w = a.w * b;
        return (result || new Vector4()).setXYZW(x, y, z, w);
    }
    /**
   * Calculates the minimum of two Vector4's.
   * @param a - The first operand.
   * @param b - The second operand.
   * @param result - The output vector (can be the same vector as a or b). if not specified, a new vector will be created.
   * @returns The output vector
   */ static min(a, b, result) {
        const x = a.x < b.x ? a.x : b.x;
        const y = a.y < b.y ? a.y : b.y;
        const z = a.z < b.z ? a.z : b.z;
        const w = a.w < b.w ? a.w : b.w;
        return (result || new Vector4()).setXYZW(x, y, z, w);
    }
    /**
   * Calculates the maximum of two Vector4's.
   * @param a - The first operand.
   * @param b - The second operand.
   * @param result - The output vector (can be the same vector as a or b). if not specified, a new vector will be created.
   * @returns The output vector
   */ static max(a, b, result) {
        const x = a.x > b.x ? a.x : b.x;
        const y = a.y > b.y ? a.y : b.y;
        const z = a.z > b.z ? a.z : b.z;
        const w = a.w > b.w ? a.w : b.w;
        return (result || new Vector4()).setXYZW(x, y, z, w);
    }
    /**
   * Calculates the absolute values of a Vector4.
   * @param a - The input vector.
   * @param result - The output vector (can be the same vector as a or b). if not specified, a new vector will be created.
   * @returns The output vector
   */ static abs(a, result) {
        const x = a.x < 0 ? -a.x : a.x;
        const y = a.y < 0 ? -a.y : a.y;
        const z = a.z < 0 ? -a.z : a.z;
        const w = a.w < 0 ? -a.w : a.w;
        return (result || new Vector4()).setXYZW(x, y, z, w);
    }
    /**
   * Calculates the dot product of two Vector4's.
   * @param a - The first operand.
   * @param b - The second operand.
   * @returns dot product of a and b
   */ static dot(a, b) {
        return a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
    }
}
/**
 * Observable 4 dimentional vector
 *
 * @public
 */ class ObservableVector4 extends Vector4 {
    /** @internal */ _callback = null;
    /** The callback function which will be executed when the value changed */ get callback() {
        return this._callback;
    }
    set callback(cb) {
        this._callback = cb;
    }
    /** Set callback */ setCallback(cb) {
        this._callback = cb;
        return this;
    }
    /**
   * {@inheritDoc Vector4.x}
   */ get x() {
        return super.x;
    }
    set x(val) {
        val = toFloat(val);
        if (val !== super.x) {
            super.x = val;
            this._callback?.();
        }
    }
    /**
   * {@inheritDoc Vector4.y}
   */ get y() {
        return super.y;
    }
    set y(val) {
        val = toFloat(val);
        if (val !== super.y) {
            super.y = val;
            this._callback?.();
        }
    }
    /**
   * {@inheritDoc Vector4.z}
   */ get z() {
        return super.z;
    }
    set z(val) {
        val = toFloat(val);
        if (val !== super.z) {
            super.z = val;
            this._callback?.();
        }
    }
    /**
   * {@inheritDoc Vector4.w}
   */ get w() {
        return super.w;
    }
    set w(val) {
        val = toFloat(val);
        if (val !== super.w) {
            super.w = val;
            this._callback?.();
        }
    }
    /**
   * {@inheritDoc Vector4.setXYZW}
   */ setXYZW(x, y, z, w) {
        x = toFloat(x);
        y = toFloat(y);
        z = toFloat(z);
        w = toFloat(w);
        if (x !== super.x || y !== super.y || z !== super.z || w !== super.w) {
            super.setXYZW(x, y, z, w);
            this._callback?.();
        }
        return this;
    }
    /**
   * Inherited from Float32Array.copyWithin
   */ copyWithin(target, start, end) {
        super.copyWithin(target, start, end);
        this._callback?.();
        return this;
    }
    /**
   * Inherited from Float32Array.fill
   */ fill(value, start, end) {
        super.fill(value, start, end);
        this._callback?.();
        return this;
    }
    /**
   * Inherited from Float32Array.reverse
   */ reverse() {
        super.reverse();
        this._callback?.();
        return this;
    }
    /**
   * Inherited from Float32Array.set
   */ set(array, offset) {
        super.set(array, offset);
        this._callback?.();
    }
    /**
   * Inherited from Float32Array.sort
   */ sort(compareFn) {
        super.sort(compareFn);
        this._callback?.();
        return this;
    }
}
/**
 * Quaternion
 * @public
 */ class Quaternion extends VectorBase {
    constructor(arg0, arg1, arg2, arg3){
        if (arg0 instanceof ArrayBuffer && typeof arg1 === 'number') {
            super(arg0, arg1, 4);
        } else {
            super(4);
            if (typeof arg0 === 'number' && typeof arg1 === 'number' && typeof arg2 === 'number' && typeof arg3 === 'number') {
                this[0] = arg0;
                this[1] = arg1;
                this[2] = arg2;
                this[3] = arg3;
            } else if (arg0 instanceof Matrix3x3 || arg0 instanceof Matrix4x4) {
                this.fromRotationMatrix(arg0);
            } else if ((arg0 instanceof Float32Array || Array.isArray(arg0)) && arg0.length >= 4) {
                this[0] = arg0[0];
                this[1] = arg0[1];
                this[2] = arg0[2];
                this[3] = arg0[3];
            } else if (arg0 === undefined) {
                this[0] = 0;
                this[1] = 0;
                this[2] = 0;
                this[3] = 1;
            } else {
                throw new Error('Quaternion.constructor(): invalid arguments');
            }
        }
    }
    /**
   * Creates a new Quaternion initialized with values from this quaternion.
   * @returns The new quaternion.
   */ clone() {
        return new Quaternion(this);
    }
    /** Get the x component value. */ get x() {
        return this[0];
    }
    set x(v) {
        this[0] = v;
    }
    /** Get the y component value. */ get y() {
        return this[1];
    }
    set y(v) {
        this[1] = v;
    }
    /** Get the z component value. */ get z() {
        return this[2];
    }
    set z(v) {
        this[2] = v;
    }
    /** Get the w component value. */ get w() {
        return this[3];
    }
    set w(v) {
        this[3] = v;
    }
    /**
   * Set component values.
   * @param x - The x component value.
   * @param y - The y component value.
   * @param z - The z component value.
   * @param w - The w component value.
   * @returns self
   */ setXYZW(x, y, z, w) {
        this[0] = x;
        this[1] = y;
        this[2] = z;
        this[3] = w;
        return this;
    }
    /**
   * Scale this quaternion by a scalar number.
   * @param f - amount to scale this quaternion by.
   * @returns self
   */ scaleBy(f) {
        Quaternion.scale(this, f, this);
        return this;
    }
    /**
   * Set component values and then normalize the quaternion.
   * @param x - The x component value.
   * @param y - The y component value.
   * @param z - The z component value.
   * @param w - The w component value.
   * @returns self
   */ setAndNormalize(x, y, z, w) {
        const mag = Math.hypot(x, y, z, w);
        return this.setXYZW(x / mag, y / mag, z / mag, w / mag);
    }
    /** Get the length of the quaternion. */ get magnitude() {
        return Math.hypot(this[0], this[1], this[2], this[3]);
    }
    /** Get the squared length of the quaternion. */ get magnitudeSq() {
        return this[0] * this[0] + this[1] * this[1] + this[2] * this[2] + this[3] * this[3];
    }
    /** Make this quaternion an identity quaternion */ identity() {
        Quaternion.identity(this);
        return this;
    }
    /**
   * Normalize this quaternion inplace.
   * @returns self
   */ inplaceNormalize() {
        Quaternion.normalize(this, this);
        return this;
    }
    /**
   * Calculates the conjugate of this quaternion inplace.
   * @returns self
   */ inplaceConjugate() {
        Quaternion.conjugate(this, this);
        return this;
    }
    /**
   * Multiply this quaternion by another quaternion at the right side inplace.
   * @param other - The quaternion that to be multiplied by.
   * @returns self
   */ multiplyRight(other) {
        Quaternion.multiply(this, other, this);
        return this;
    }
    /**
   * Multiply this quaternion by another quaternion at the left side inplace.
   * @param other - The quaternion that to be multiplied by.
   * @returns self
   */ multiplyLeft(other) {
        Quaternion.multiply(other, this, this);
        return this;
    }
    /**
   * Make a quaternion used to rotate a unit vector to another inplace.
   * @param from - The unit vector to be rotated.
   * @param to - The destination unit vector.
   * @returns self
   */ unitVectorToUnitVector(from, to) {
        Quaternion.unitVectorToUnitVector(from, to, this);
        return this;
    }
    /**
   * Calculates the quaternion from an euler angle in specific order inplace.
   * @param x - Angle to rotate around X axis in radians.
   * @param y - Angle to rotate around Y axis in radians.
   * @param z - Angle to rotate around Z axis in radians.
   * @param order - Intrinsic order for conversion.
   * @returns self
   */ fromEulerAngle(x, y, z, order = 'ZYX') {
        Quaternion.fromEulerAngle(x, y, z, order, this);
        return this;
    }
    /**
   * Calculates the quaternion from the given angle and rotation axis inplace.
   * @param axis - The rotation axis.
   * @param angle - The rotate angle.
   * @returns self
   */ fromAxisAngle(axis, angle) {
        Quaternion.fromAxisAngle(axis, angle, this);
        return this;
    }
    /**
   * Calculates the rotation axis and angle for this quaternion
   * @param axis - A vector that receives the rotation axis.
   * @returns - The rotation angle
   */ toAxisAngle(axis) {
        const rad = Math.acos(this[3]) * 2;
        const s = Math.sin(rad / 2);
        if (s > 0.000001) {
            axis.setXYZ(this[0] / s, this[1] / 2, this[2] / s);
        } else {
            axis.setXYZ(1, 0, 0);
        }
        return rad;
    }
    /**
   * Convert this rotation to euler angles in ZYX order
   * @param angles - A vector that receives the euler angles. If not given, a new vector will be created.
   * @returns The vector that holds the euler angles.
   */ toEulerAngles(angles) {
        angles = angles ?? new Vector3();
        const t0 = 2 * (this.w * this.x + this.y * this.z);
        const t1 = 1 - 2 * (this.x * this.x + this.y * this.y);
        const pitch = Math.atan2(t0, t1);
        const t2 = Math.max(-1, Math.min(1, 2 * (this.w * this.y - this.z * this.x)));
        const yaw = Math.asin(t2);
        const t3 = 2 * (this.w * this.z + this.x * this.y);
        const t4 = 1 - 2 * (this.y * this.y + this.z * this.z);
        const roll = Math.atan2(t3, t4);
        return angles.setXYZ(pitch, yaw, roll);
    }
    /**
   * Calculates the quaternion from a rotation matrix inplace.
   * @param matrix - The rotation matrix.
   * @returns self
   */ fromRotationMatrix(matrix) {
        Quaternion.fromRotationMatrix(matrix, this);
        return this;
    }
    /**
   * Decompose the quaternion into swing and twist components around a given axis.
   *
   * @remarks
   * Given a rotation Q and an axis A, decompose Q into:
   * - Twist: rotation around A
   * - Swing: rotation perpendicular to A
   * Such that Q = Twist * Swing
   *
   * @param axis - The twist axis (must be normalized)
   * @param outSwing - Output swing rotation
   * @param outTwist - Output twist rotation
   */ decomposeSwingTwist(axis, outSwing, outTwist) {
        const dot = this.x * axis.x + this.y * axis.y + this.z * axis.z;
        let twistX = axis.x * dot;
        let twistY = axis.y * dot;
        let twistZ = axis.z * dot;
        let twistW = this.w;
        const twistLen = Math.hypot(twistX, twistY, twistZ, twistW);
        if (twistLen < 0.000001) {
            outTwist?.identity();
            outSwing?.set(this);
            return;
        }
        twistX /= twistLen;
        twistY /= twistLen;
        twistZ /= twistLen;
        twistW /= twistLen;
        if (dot < 0) {
            twistX = -twistX;
            twistY = -twistY;
            twistZ = -twistZ;
            twistW = -twistW;
        }
        if (outTwist) {
            outTwist.setXYZW(twistX, twistY, twistZ, twistW);
        }
        if (outSwing) {
            outSwing.setXYZW(-twistX, -twistY, -twistZ, twistW);
            Quaternion.multiply(outSwing, this, outSwing);
        }
    }
    /**
   * Get the twist angle (in radians) around an axis.
   *
   * @param axis - The twist axis (must be normalized)
   * @returns Twist angle in radians, range [-PI, PI]
   */ getTwistAngle(axis) {
        const len = Math.hypot(this.x, this.y, this.z, this.w);
        if (len < 0.000001) {
            return 0;
        }
        const w = this.w / len;
        const halfAngle = Math.acos(Math.max(-1, Math.min(1, w)));
        const dot = this.x * axis.x + this.y * axis.y + this.z * axis.z;
        const sign = dot >= 0 ? 1 : -1;
        return sign * 2 * halfAngle;
    }
    /**
   * Convert this quaternion to a 3x3 rotation matrix.
   * @param matrix - The output matrix, if not specified, a new matrix will be created.
   * @returns The output matrix.
   */ toMatrix3x3(matrix) {
        const m = matrix || new Matrix3x3();
        this.toMatrix(m);
        return m;
    }
    /**
   * Convert this quaternion to a 4x4 rotation matrix.
   *
   * @remarks
   * Only left top 3x3 part of the matrix will be changed.
   *
   * @param matrix - The output matrix, if not specified, a new matrix will be created.
   * @returns The output matrix.
   */ toMatrix4x4(matrix) {
        const m = matrix || Matrix4x4.identity();
        this.toMatrix(m);
        m.m03 = 0;
        m.m13 = 0;
        m.m23 = 0;
        m.m30 = 0;
        m.m31 = 0;
        m.m32 = 0;
        m.m33 = 1;
        return m;
    }
    /**
   * Get the direction of axis x
   * @param result - The output vector, if not specified, a new vector will be created.
   * @returns The direction of axis x
   */ getDirectionX(result) {
        result = result ?? new Vector3();
        return result.setXYZ(1 - 2 * (this.y * this.y + this.z * this.z), 2 * (this.x * this.y + this.z * this.w), 2 * (this.z * this.x - this.y * this.w));
    }
    /**
   * Get the direction of axis y
   * @param result - The output vector, if not specified, a new vector will be created.
   * @returns The direction of axis y
   */ getDirectionY(result) {
        result = result ?? new Vector3();
        return result.setXYZ(2 * (this.x * this.y - this.z * this.w), 1 - 2 * (this.z * this.z + this.x * this.x), 2 * (this.y * this.z + this.x * this.w));
    }
    /**
   * Get the direction of axis z
   * @param result - The output vector, if not specified, a new vector will be created.
   * @returns The direction of axis z
   */ getDirectionZ(result) {
        result = result ?? new Vector3();
        return result.setXYZ(2 * (this.z * this.x + this.y * this.w), 2 * (this.y * this.z - this.x * this.w), 1 - 2 * (this.y * this.y + this.x * this.x));
    }
    /**
   * Get the rotate angle and the rotation axis for this quaternion.
   * @param result - The output vector, if not specified, a new vector will be created.
   * @returns An vector4 that the x, y, z component presents the axis and the w component presents the angle.
   */ getAxisAngle(result) {
        result = result ?? new Vector4();
        const sign = this.w < 0 ? -1 : 1;
        const x = this.x * sign;
        const y = this.y * sign;
        const z = this.z * sign;
        const w = this.w * sign;
        const halfAngle = Math.acos(w);
        const sinHalf = Math.sin(halfAngle);
        return result.setXYZW(x / sinHalf, y / sinHalf, z / sinHalf, 2 * halfAngle);
    }
    /**
   * Rotate a vector
   * @param v - The vector to be rotated.
   * @param result - The output vector, if not specified, a new vector will be created.
   * @returns The rotation result.
   */ transform(v, result) {
        result = result || new Vector3();
        const x = this.x * 2;
        const y = this.y * 2;
        const z = this.z * 2;
        const xx = this.x * x;
        const yy = this.y * y;
        const zz = this.z * z;
        const xy = this.x * y;
        const xz = this.x * z;
        const yz = this.y * z;
        const wx = this.w * x;
        const wy = this.w * y;
        const wz = this.w * z;
        return result.setXYZ((1 - yy - zz) * v.x + (xy - wz) * v.y + (xz + wy) * v.z, (xy + wz) * v.x + (1 - xx - zz) * v.y + (yz - wx) * v.z, (xz - wy) * v.x + (yz + wx) * v.y + (1 - xx - yy) * v.z);
    }
    /**
   * Scale a Quaternion by a scalar number.
   * @param a - The quaternion to be scaled.
   * @param b - The scalar number.
   * @param result - The output quaternion (can be the same quaternion as a). if not specified, a new quaternion will be created.
   * @returns The output quaternion
   */ static scale(q, t, result) {
        result = result || q;
        return result.setXYZW(q.x * t, q.y * t, q.z * t, q.w * t);
    }
    /**
   * Calculates the dot product of two Quaternion's.
   * @param a - The first operand.
   * @param b - The second operand.
   * @returns dot product of a and b
   */ static dot(a, b) {
        return a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
    }
    /**
   * Create an identity quaternion
   * @param q - The output quaternion, if not specified, a new quaternion will be created.
   * @returns The output quaternion
   */ static identity(q) {
        return (q || new Quaternion()).setXYZW(0, 0, 0, 1);
    }
    /**
   * Normalize a quaternion
   * @param q - The input quaternion
   * @param result - The output quaternion (can be the same as q), if not specified, a new quaternion will be created.
   * @returns The output quaternion
   */ static normalize(q, result) {
        const mag = q.magnitude;
        return (result || new Quaternion()).setXYZW(q.x / mag, q.y / mag, q.z / mag, q.w / mag);
    }
    /**
   * Gets the conjugate of a quaternion
   * @param q - The input quaternion
   * @param result - The output quaternion (can be the same as q), if not specified, a new quaternion will be created.
   * @returns The output quaternion
   */ static conjugate(q, result) {
        return (result || new Quaternion()).setXYZW(-q.x, -q.y, -q.z, q.w);
    }
    /**
   * Multiply two Quaternion's.
   * @param a - The first operand.
   * @param b - The second operand.
   * @param result - The output quaternion (can be the same as a or b). if not specified, a new quaternion will be created.
   * @returns The output quaternion
   */ static multiply(a, b, result) {
        result = result || new Quaternion();
        const x = a.x * b.w + a.w * b.x + a.y * b.z - a.z * b.y;
        const y = a.y * b.w + a.w * b.y + a.z * b.x - a.x * b.z;
        const z = a.z * b.w + a.w * b.z + a.x * b.y - a.y * b.x;
        const w = a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z;
        return result.setXYZW(x, y, z, w);
    }
    /**
   * Performs a spherical linear interpolation between two quat.
   * @param a - The first operand.
   * @param b - The second operand.
   * @param t - The interpolation amount, in the range [0-1].
   * @param result - The output quaternion (can be the same as a or b), if not specified, a new quaternion will be created.
   * @returns The output quaternion
   */ static slerp(a, b, t, result) {
        result = result || new Quaternion();
        if (t <= 0) {
            return result.setXYZW(a.x, a.y, a.z, a.w);
        }
        if (t >= 1) {
            return result.setXYZW(b.x, b.y, b.z, b.w);
        }
        const halfCos1 = this.dot(a, b);
        const inv = halfCos1 < 0 ? -1 : 1;
        const ax = a.x;
        const ay = a.y;
        const az = a.z;
        const aw = a.w;
        const bx = b.x * inv;
        const by = b.y * inv;
        const bz = b.z * inv;
        const bw = b.w * inv;
        const halfCos = halfCos1 * inv;
        if (halfCos >= 1) {
            return result.setXYZW(ax, ay, az, aw);
        }
        const halfSinSqr = 1 - halfCos * halfCos;
        if (halfSinSqr <= Number.EPSILON) {
            const s = 1 - t;
            return result.setAndNormalize(a.x * s + b.x * t, a.y * s + b.y * t, a.z * s + b.z * t, a.w * s + b.w * t);
        }
        const halfSin = Math.sqrt(halfSinSqr);
        const halfTheta = Math.atan2(halfSin, halfCos);
        const ratioA = Math.sin((1 - t) * halfTheta) / halfSin;
        const ratioB = Math.sin(t * halfTheta) / halfSin;
        return result.setXYZW(ax * ratioA + bx * ratioB, ay * ratioA + by * ratioB, az * ratioA + bz * ratioB, aw * ratioA + bw * ratioB);
    }
    /**
   * Gets the angular distance between two unit quaternions.
   * @param a - The origin quaternion
   * @param b - The destination quaternion
   * @returns - The angle in radians
   */ static angleBetween(a, b) {
        const x = this.dot(a, b);
        const clamped = x < -1 ? -1 : x > 1 ? 1 : x;
        return 2 * Math.acos(Math.abs(clamped));
    }
    /**
   * Creates a quaternion used to rotate a unit vector to another.
   * @param from - The unit vector to be rotated.
   * @param to - The destination unit vector.
   * @param result - The output quaternion, if not specified, a new quaternion will be created.
   * @returns The output quaternion
   */ static unitVectorToUnitVector(from, to, result) {
        // assume from and to are unit vectors
        result = result || new Quaternion();
        let r = Vector3.dot(from, to) + 1;
        if (r < 0.000001) {
            r = 0;
            if (Math.abs(from.x) > Math.abs(from.z)) {
                return result.setAndNormalize(-from.y, from.x, 0, r);
            } else {
                return result.setAndNormalize(0, -from.z, from.y, r);
            }
        } else {
            return result.setAndNormalize(from.y * to.z - from.z * to.y, from.z * to.x - from.x * to.z, from.x * to.y - from.y * to.x, r);
        }
    }
    /**
   * Creates a quaternion from an euler angle in specific order.
   * @param x - Angle to rotate around X axis in radians.
   * @param y - Angle to rotate around Y axis in radians.
   * @param z - Angle to rotate around Z axis in radians.
   * @param order - Intrinsic order for conversion.
   * @param result - The output quaternion, if not specified, a new quaternion will be created.
   * @returns The output quaternion
   */ static fromEulerAngle(a, b, c, order = 'ZYX', result) {
        result = result || new Quaternion();
        const c1 = Math.cos(a / 2);
        const c2 = Math.cos(b / 2);
        const c3 = Math.cos(c / 2);
        const s1 = Math.sin(a / 2);
        const s2 = Math.sin(b / 2);
        const s3 = Math.sin(c / 2);
        switch(order){
            case 'XYZ':
                return result.setXYZW(s1 * c2 * c3 + c1 * s2 * s3, c1 * s2 * c3 - s1 * c2 * s3, c1 * c2 * s3 + s1 * s2 * c3, c1 * c2 * c3 - s1 * s2 * s3);
            case 'YXZ':
                return result.setXYZW(s1 * c2 * c3 + c1 * s2 * s3, c1 * s2 * c3 - s1 * c2 * s3, c1 * c2 * s3 - s1 * s2 * c3, c1 * c2 * c3 + s1 * s2 * s3);
            case 'ZXY':
                return result.setXYZW(s1 * c2 * c3 - c1 * s2 * s3, c1 * s2 * c3 + s1 * c2 * s3, c1 * c2 * s3 + s1 * s2 * c3, c1 * c2 * c3 - s1 * s2 * s3);
            case 'ZYX':
                return result.setXYZW(s1 * c2 * c3 - c1 * s2 * s3, c1 * s2 * c3 + s1 * c2 * s3, c1 * c2 * s3 - s1 * s2 * c3, c1 * c2 * c3 + s1 * s2 * s3);
            case 'YZX':
                return result.setXYZW(s1 * c2 * c3 + c1 * s2 * s3, c1 * s2 * c3 + s1 * c2 * s3, c1 * c2 * s3 - s1 * s2 * c3, c1 * c2 * c3 - s1 * s2 * s3);
            case 'XZY':
                return result.setXYZW(s1 * c2 * c3 - c1 * s2 * s3, c1 * s2 * c3 - s1 * c2 * s3, c1 * c2 * s3 + s1 * s2 * c3, c1 * c2 * c3 + s1 * s2 * s3);
        }
    }
    /**
   * Creates a quaternion from the given angle and rotation axis.
   * @param axis - The rotation axis.
   * @param angle - The rotate angle.
   * @param result - The output quaternion, if not specified, a new quaternion will be created.
   * @returns The output quaternion
   */ static fromAxisAngle(axis, angle, result) {
        // assume axis is normalized
        result = result || new Quaternion();
        const halfAngle = angle / 2;
        const s = Math.sin(halfAngle);
        return result.setXYZW(axis.x * s, axis.y * s, axis.z * s, Math.cos(halfAngle));
    }
    /**
   * Creates a quaternion from a rotation matrix.
   * @param matrix - The rotation matrix.
   * @param result - The output quaternion, if not specified, a new quaternion will be created.
   * @returns self
   */ static fromRotationMatrix(matrix, result) {
        // assume matrix contains rotation without scaling
        result = result || new Quaternion();
        const trace = matrix.m00 + matrix.m11 + matrix.m22;
        let s;
        if (trace > 0) {
            s = 0.5 / Math.sqrt(trace + 1);
            result.setXYZW((matrix.m21 - matrix.m12) * s, (matrix.m02 - matrix.m20) * s, (matrix.m10 - matrix.m01) * s, 0.25 / s);
        } else if (matrix.m00 > matrix.m11 && matrix.m00 > matrix.m22) {
            s = 2 * Math.sqrt(1 + matrix.m00 - matrix.m11 - matrix.m22);
            result.setXYZW(0.25 * s, (matrix.m01 + matrix.m10) / s, (matrix.m02 + matrix.m20) / s, (matrix.m21 - matrix.m12) / s);
        } else if (matrix.m11 > matrix.m22) {
            s = 2 * Math.sqrt(1 - matrix.m00 + matrix.m11 - matrix.m22);
            result.setXYZW((matrix.m10 + matrix.m01) / s, 0.25 * s, (matrix.m21 + matrix.m12) / s, (matrix.m02 - matrix.m20) / s);
        } else {
            s = 2 * Math.sqrt(1 - matrix.m00 - matrix.m11 + matrix.m22);
            result.setXYZW((matrix.m02 + matrix.m20) / s, (matrix.m12 + matrix.m21) / s, 0.25 * s, (matrix.m10 - matrix.m01) / s);
        }
        return result;
    }
    /** @internal */ toMatrix(matrix) {
        const xx = this.x * this.x;
        const yy = this.y * this.y;
        const zz = this.z * this.z;
        const xy = this.x * this.y;
        const zw = this.z * this.w;
        const zx = this.z * this.x;
        const yw = this.y * this.w;
        const yz = this.y * this.z;
        const xw = this.x * this.w;
        matrix.m00 = 1 - 2 * (yy + zz);
        matrix.m10 = 2 * (xy + zw);
        matrix.m20 = 2 * (zx - yw);
        matrix.m01 = 2 * (xy - zw);
        matrix.m11 = 1 - 2 * (zz + xx);
        matrix.m21 = 2 * (yz + xw);
        matrix.m02 = 2 * (zx + yw);
        matrix.m12 = 2 * (yz - xw);
        matrix.m22 = 1 - 2 * (yy + xx);
    }
}
/**
 * Observable 4 dimentional vector
 *
 * @public
 */ class ObservableQuaternion extends Quaternion {
    /** @internal */ _callback = null;
    /** The callback function which will be executed when the value changed */ get callback() {
        return this._callback;
    }
    set callback(cb) {
        this._callback = cb;
    }
    /** Set callback */ setCallback(cb) {
        this._callback = cb;
        return this;
    }
    /**
   * {@inheritDoc Quaternion.x}
   */ get x() {
        return super.x;
    }
    set x(val) {
        val = toFloat(val);
        if (val !== super.x) {
            super.x = val;
            this._callback?.();
        }
    }
    /**
   * {@inheritDoc Quaternion.y}
   */ get y() {
        return super.y;
    }
    set y(val) {
        val = toFloat(val);
        if (val !== super.y) {
            super.y = val;
            this._callback?.();
        }
    }
    /**
   * {@inheritDoc Quaternion.z}
   */ get z() {
        return super.z;
    }
    set z(val) {
        val = toFloat(val);
        if (val !== super.z) {
            super.z = val;
            this._callback?.();
        }
    }
    /**
   * {@inheritDoc Quaternion.w}
   */ get w() {
        return super.w;
    }
    set w(val) {
        val = toFloat(val);
        if (val !== super.w) {
            super.w = val;
            this._callback?.();
        }
    }
    /**
   * {@inheritDoc Quaternion.setXYZW}
   */ setXYZW(x, y, z, w) {
        x = toFloat(x);
        y = toFloat(y);
        z = toFloat(z);
        w = toFloat(w);
        if (x !== super.x || y !== super.y || z !== super.z || w !== super.w) {
            super.setXYZW(x, y, z, w);
            this._callback?.();
        }
        return this;
    }
    /**
   * Inherited from Float32Array.copyWithin
   */ copyWithin(target, start, end) {
        super.copyWithin(target, start, end);
        this._callback?.();
        return this;
    }
    /**
   * Inherited from Float32Array.fill
   */ fill(value, start, end) {
        super.fill(value, start, end);
        this._callback?.();
        return this;
    }
    /**
   * Inherited from Float32Array.reverse
   */ reverse() {
        super.reverse();
        this._callback?.();
        return this;
    }
    /**
   * Inherited from Float32Array.set
   */ set(array, offset) {
        super.set(array, offset);
        this._callback?.();
    }
    /**
   * Inherited from Float32Array.sort
   */ sort(compareFn) {
        super.sort(compareFn);
        this._callback?.();
        return this;
    }
}
/**
 * 3x3 Matrix
 *
 * @remarks
 * The matrix is column-major:
 * | m00, m10, m20 |
 * | m01, m11, m21 |
 * | m02, m12, m22 |
 *
 * @public
 */ class Matrix3x3 extends VectorBase {
    constructor(arg0, arg1, arg2, arg3, arg4, arg5, arg6, arg7, arg8){
        if (arg0 instanceof ArrayBuffer && typeof arg1 === 'number') {
            super(arg0, arg1, 9);
        } else {
            super(9);
            if (typeof arg0 === 'number') {
                this[0] = arg0;
                this[1] = arg1;
                this[2] = arg2;
                this[3] = arg3;
                this[4] = arg4;
                this[5] = arg5;
                this[6] = arg6;
                this[7] = arg7;
                this[8] = arg8;
            } else if (arg0 instanceof Quaternion) {
                arg0.toMatrix3x3(this);
            } else if (arg0 instanceof Matrix4x4) {
                this[0] = arg0[0];
                this[1] = arg0[1];
                this[2] = arg0[2];
                this[3] = arg0[4];
                this[4] = arg0[5];
                this[5] = arg0[6];
                this[6] = arg0[8];
                this[7] = arg0[9];
                this[8] = arg0[10];
            } else if ((arg0 instanceof Float32Array || Array.isArray(arg0)) && arg0.length >= 9) {
                this.set(arg0);
            } else if (arg0 === undefined) {
                this.identity();
            } else {
                throw new Error('Matrix3x4.constructor(): invalid arguments');
            }
        }
    }
    /**
   * Creates a new Matrix3x3 initialized with values from this matrix.
   * @returns The new matrix.
   */ clone() {
        return new Matrix3x3(this);
    }
    /** Get the element at row 0, column 0 */ get m00() {
        return this[0];
    }
    set m00(v) {
        this[0] = v;
    }
    /** Get the element at row 0, column 1 */ get m10() {
        return this[1];
    }
    set m10(v) {
        this[1] = v;
    }
    /** Get the element at row 0, column 2 */ get m20() {
        return this[2];
    }
    set m20(v) {
        this[2] = v;
    }
    /** Get the element at row 1, column 0 */ get m01() {
        return this[3];
    }
    set m01(v) {
        this[3] = v;
    }
    /** Get the element at row 1, column 1 */ get m11() {
        return this[4];
    }
    set m11(v) {
        this[4] = v;
    }
    /** Get the element at row 1, column 2 */ get m21() {
        return this[5];
    }
    set m21(v) {
        this[5] = v;
    }
    /** Get the element at row 2, column 0 */ get m02() {
        return this[6];
    }
    set m02(v) {
        this[6] = v;
    }
    /** Get the element at row 2, column 1 */ get m12() {
        return this[7];
    }
    set m12(v) {
        this[7] = v;
    }
    /** Get the element at row 2, column 2 */ get m22() {
        return this[8];
    }
    set m22(v) {
        this[8] = v;
    }
    /**
   * Get the values in a row as a Vector3
   * @param row - The row index
   * @param result - The output vector, if not specified, a new vector will be created.
   * @returns The output vector
   */ getRow(row, result) {
        return (result || new Vector3()).setXYZ(this[row * 3], this[row * 3 + 1], this[row * 3 + 2]);
    }
    /**
   * Set values to a row in the matrix.
   * @param row - The row index
   * @param v - The values to be set
   * @returns - self
   */ setRow(row, v) {
        this[row * 3] = v.x;
        this[row * 3 + 1] = v.y;
        this[row * 3 + 2] = v.z;
        return this;
    }
    /**
   * Set values to a row in the matrix.
   * @param row - The row index
   * @param x - The first value of the row to be set
   * @param y - The second value of the row to be set
   * @param z - The third value of the row to be set
   * @returns - self
   */ setRowXYZ(row, x, y, z) {
        this[row * 3] = x;
        this[row * 3 + 1] = y;
        this[row * 3 + 2] = z;
        return this;
    }
    /**
   * Get the values in a column as a Vector3
   * @param col - The column index
   * @param result - The output vector, if not specified, a new vector will be created.
   * @returns The output vector
   */ getCol(col, result) {
        return (result || new Vector3()).setXYZ(this[col], this[3 + col], this[6 + col]);
    }
    /**
   * Set values to a column in the matrix.
   * @param col - The column index.
   * @param v - The values to be set.
   * @returns self
   */ setCol(col, v) {
        this[col] = v.x;
        this[3 + col] = v.y;
        this[6 + col] = v.z;
        return this;
    }
    /**
   * Set values to a column in the matrix.
   * @param col - The column index.
   * @param x - The first value of the column to be set.
   * @param y - The second value of the column to be set.
   * @param z - The third value of the column to be set.
   * @returns self
   */ setColXYZ(col, x, y, z) {
        this[col] = x;
        this[3 + col] = y;
        this[6 + col] = z;
        return this;
    }
    /**
   * Adds two Matrix3x3's component-wise.
   * @param a - The first operand.
   * @param b - The second operand.
   * @param result - The output matrix (can be the same as a or b), if not specified, a new matrix will be created.
   * @returns The result matrix
   */ static add(a, b, result) {
        result = result || new Matrix3x3();
        for(let i = 0; i < 9; i++){
            result[i] = a[i] + b[i];
        }
        return result;
    }
    /**
   * Subtracts two Matrix3x3's component-wise.
   * @param a - The first operand.
   * @param b - The second operand.
   * @param result - The output matrix (can be the same as a or b), if not specified, a new matrix will be created.
   * @returns The result matrix
   */ static sub(a, b, result) {
        result = result || new Matrix3x3();
        for(let i = 0; i < 9; i++){
            result[i] = a[i] - b[i];
        }
        return result;
    }
    /**
   * Multiplys two Matrix3x3's component-wise.
   * @param a - The first operand.
   * @param b - The second operand.
   * @param result - The output matrix (can be the same as a or b), if not specified, a new matrix will be created.
   * @returns The output matrix
   */ static mul(a, b, result) {
        result = result || new Matrix3x3();
        for(let i = 0; i < 9; i++){
            result[i] = a[i] * b[i];
        }
        return result;
    }
    /**
   * Divides two Matrix3x3's component-wise.
   * @param a - The first operand.
   * @param b - The second operand.
   * @param result - The output matrix (can be the same as a or b), if not specified, a new matrix will be created.
   * @returns The result matrix
   */ static div(a, b, result) {
        result = result || new Matrix3x3();
        for(let i = 0; i < 9; i++){
            result[i] = a[i] / b[i];
        }
        return result;
    }
    /**
   * Scales a Matrix3x3 by a scalar number component-wise.
   * @param a - The matrix to be scaled.
   * @param f - The scalar number.
   * @param result - The output matrix (can be the same as a), if not specified, a new matrix will be created.
   * @returns The result matrix
   */ static scale(a, f, result) {
        result = result || new Matrix3x3();
        for(let i = 0; i < 9; i++){
            result[i] = a[i] * f;
        }
        return result;
    }
    /**
   * Creates an identity Matrix3x3.
   * @param result - The output matrix, if not specified, a new matrix will be created.
   * @returns The output matrix
   */ static identity(result) {
        result = result || new Matrix3x3();
        result.set(IDENT_MATRIX3x3);
        return result;
    }
    /**
   * Transpose a Matrix3x3.
   * @param matrix - The matrix to be transposed.
   * @param result - The output matrix (can be the same as matrix), if not specified, a new matrix will be created.
   * @returns The output matrix
   */ static transpose(matrix, result) {
        result = result || new Matrix3x3();
        if (matrix === result) {
            [result[1], result[3]] = [
                result[3],
                result[1]
            ];
            [result[2], result[6]] = [
                result[6],
                result[2]
            ];
            [result[5], result[7]] = [
                result[7],
                result[5]
            ];
        } else {
            result[0] = matrix[0];
            result[1] = matrix[3];
            result[2] = matrix[6];
            result[3] = matrix[1];
            result[4] = matrix[4];
            result[5] = matrix[7];
            result[6] = matrix[2];
            result[7] = matrix[5];
            result[8] = matrix[8];
        }
        return result;
    }
    /**
   * Inverts a Matrix3x3
   * @param matrix - The matrix to be inverted.
   * @param result - The output matrix (can be the same as matrix). if not specified, a new matrix will be created.
   * @returns The output matrix
   */ static invert(matrix, result) {
        result = result || new Matrix3x3();
        const m00 = matrix[0];
        const m01 = matrix[1];
        const m02 = matrix[2];
        const m10 = matrix[3];
        const m11 = matrix[4];
        const m12 = matrix[5];
        const m20 = matrix[6];
        const m21 = matrix[7];
        const m22 = matrix[8];
        const tmp_0 = m22 * m11 - m12 * m21;
        const tmp_1 = m12 * m20 - m22 * m10;
        const tmp_2 = m21 * m10 - m20 * m11;
        const d = 1 / (m00 * tmp_0 + m01 * tmp_1 + m02 * tmp_2);
        result[0] = tmp_0 * d;
        result[1] = (m02 * m21 - m22 * m01) * d;
        result[2] = (m12 * m01 - m02 * m11) * d;
        result[3] = tmp_1 * d;
        result[4] = (m22 * m00 - m02 * m20) * d;
        result[5] = (m02 * m10 - m12 * m00) * d;
        result[6] = tmp_2 * d;
        result[7] = (m01 * m20 - m21 * m00) * d;
        result[8] = (m11 * m00 - m01 * m10) * d;
        return result;
    }
    /**
   * Creates a Matrix3x3 that presents a rotation around x axis.
   * @param angle - The rotate angle in radians.
   * @param result - The output matrix, if not specified, a new matrix will be created.
   * @returns The output matrix
   */ static rotationX(angle, result) {
        result = result || new Matrix3x3();
        const c = Math.cos(angle);
        const s = Math.sin(angle);
        result[0] = 1;
        result[1] = 0;
        result[2] = 0;
        result[3] = 0;
        result[4] = c;
        result[5] = s;
        result[6] = 0;
        result[7] = -s;
        result[8] = c;
        return result;
    }
    /**
   * Creates a Matrix3x3 that presents a rotation around y axis.
   * @param angle - The rotate angle in radians.
   * @param result - The output matrix, if not specified, a new matrix will be created.
   * @returns The output matrix
   */ static rotationY(angle, result) {
        result = result || new Matrix3x3();
        const c = Math.cos(angle);
        const s = Math.sin(angle);
        result[0] = c;
        result[1] = 0;
        result[2] = -s;
        result[3] = 0;
        result[4] = 1;
        result[5] = 0;
        result[6] = s;
        result[7] = 0;
        result[8] = c;
        return result;
    }
    /**
   * Creates a Matrix3x3 that presents a rotation around z axis.
   * @param angle - The rotate angle in radians.
   * @param result - The output matrix, if not specified, a new matrix will be created.
   * @returns The output matrix
   */ static rotationZ(angle, result) {
        result = result || new Matrix3x3();
        const c = Math.cos(angle);
        const s = Math.sin(angle);
        result[0] = c;
        result[1] = s;
        result[2] = 0;
        result[3] = -s;
        result[4] = c;
        result[5] = 0;
        result[6] = 0;
        result[7] = 0;
        result[8] = 1;
        return result;
    }
    /**
   * Creates a Matrix3x3 that presents a rotation around a given axis.
   * @param axis - The rotation axis.
   * @param angle - The rotate angle in radians.
   * @param result - The output matrix, if not specified, a new matrix will be created.
   * @returns The output matrix
   */ static rotation(axis, angle, result) {
        result = result || new Matrix3x3();
        let x = axis.x;
        let y = axis.y;
        let z = axis.z;
        const n = Math.hypot(x, y, z);
        x /= n;
        y /= n;
        z /= n;
        const xx = x * x;
        const yy = y * y;
        const zz = z * z;
        const c = Math.cos(angle);
        const s = Math.sin(angle);
        const oneMinusCosine = 1 - c;
        result[0] = xx + (1 - xx) * c;
        result[1] = x * y * oneMinusCosine + z * s;
        result[2] = x * z * oneMinusCosine - y * s;
        result[3] = x * y * oneMinusCosine - z * s;
        result[4] = yy + (1 - yy) * c;
        result[5] = y * z * oneMinusCosine + x * s;
        result[6] = x * z * oneMinusCosine + y * s;
        result[7] = y * z * oneMinusCosine - x * s;
        result[8] = zz + (1 - zz) * c;
        return result;
    }
    /**
   * Multiplies two Matrix3x3's
   * @param m1 - The first operand.
   * @param m2 - The second operand.
   * @param result - The output matrix (can be the same as m1 or m2), if not specified, a new matrix will be created.
   * @returns The output matrix
   */ static multiply(m1, m2, result) {
        result = result || new Matrix3x3();
        const a00 = m1[0];
        const a01 = m1[1];
        const a02 = m1[2];
        const a10 = m1[3];
        const a11 = m1[4];
        const a12 = m1[5];
        const a20 = m1[6];
        const a21 = m1[7];
        const a22 = m1[8];
        const b00 = m2[0];
        const b01 = m2[1];
        const b02 = m2[2];
        const b10 = m2[3];
        const b11 = m2[4];
        const b12 = m2[5];
        const b20 = m2[6];
        const b21 = m2[7];
        const b22 = m2[8];
        result[0] = a00 * b00 + a10 * b01 + a20 * b02;
        result[1] = a01 * b00 + a11 * b01 + a21 * b02;
        result[2] = a02 * b00 + a12 * b01 + a22 * b02;
        result[3] = a00 * b10 + a10 * b11 + a20 * b12;
        result[4] = a01 * b10 + a11 * b11 + a21 * b12;
        result[5] = a02 * b10 + a12 * b11 + a22 * b12;
        result[6] = a00 * b20 + a10 * b21 + a20 * b22;
        result[7] = a01 * b20 + a11 * b21 + a21 * b22;
        result[8] = a02 * b20 + a12 * b21 + a22 * b22;
        return result;
    }
    /**
   * Subtract a matrix from this matrix component-wise.
   * @param other - The matrix that will be subtract.
   * @returns self
   */ subBy(other) {
        Matrix3x3.sub(this, other, this);
        return this;
    }
    /**
   * Add a matrix to this matrix component-wise.
   * @param other - The matrix that will be added.
   * @returns self
   */ addBy(other) {
        Matrix3x3.add(this, other, this);
        return this;
    }
    /**
   * Multiplies this matrix by a matrix component-wise.
   * @param other - The matrix that will be multiplied by.
   * @returns self
   */ mulBy(other) {
        Matrix3x3.mul(this, other, this);
        return this;
    }
    /**
   * Divide this matrix by a matrix component-wise.
   * @param other - The matrix that will be divide by.
   * @returns self
   */ divBy(other) {
        Matrix3x3.div(this, other, this);
        return this;
    }
    /**
   * Scale this matrix by a scalar number component-wise.
   * @param f - amount to scale this matrix by.
   * @returns self
   */ scaleBy(f) {
        Matrix3x3.scale(this, f, this);
        return this;
    }
    /**
   * Make this matrix identity.
   * @returns self
   */ identity() {
        Matrix3x3.identity(this);
        return this;
    }
    /**
   * Calculate the inverse of this matrix inplace.
   * @returns self
   */ inplaceInvert() {
        Matrix3x3.invert(this, this);
        return this;
    }
    /**
   * Calculate the transpose of this matrix inplace.
   * @returns self
   */ transpose() {
        Matrix3x3.transpose(this, this);
        return this;
    }
    /**
   * Post-multiply by a matrix inplace.
   *
   * @remarks
   * this = this * other
   *
   * @param other - The matrix that will be multiplied by.
   * @returns self
   */ multiplyRight(other) {
        Matrix3x3.multiply(this, other, this);
        return this;
    }
    /**
   * Pre-multiply by a matrix inplace.
   *
   * @remarks
   * this = other * this
   *
   * @param other - The matrix that will be multiplied by.
   * @returns self
   */ multiplyLeft(other) {
        Matrix3x3.multiply(other, this, this);
        return this;
    }
    /**
   * Calculates a rotation around x axis inplace.
   * @param angle - The rotate angle in radians.
   * @returns self
   */ rotationX(angle) {
        Matrix3x3.rotationX(angle, this);
        return this;
    }
    /**
   * Calculates a rotation around y axis inplace.
   * @param angle - The rotate angle in radians.
   * @returns self
   */ rotationY(angle) {
        Matrix3x3.rotationY(angle, this);
        return this;
    }
    /**
   * Calculates a rotation around z axis inplace.
   * @param angle - The rotate angle in radians.
   * @returns self
   */ rotationZ(angle) {
        Matrix3x3.rotationZ(angle, this);
        return this;
    }
    /**
   * Calculates a rotation around a given axis.
   * @param axis - The rotation axis.
   * @param angle - The rotate angle in radians.
   * @returns self
   */ rotation(axis, angle) {
        Matrix3x3.rotation(axis, angle, this);
        return this;
    }
    /**
   * Transform a vector by this matrix.
   * @param vec - The vector to be transformed.
   * @param result - The output vector (can be the same as vec), if not specified, a new vector will be created.
   * @returns The output vector
   */ transform(vec, result) {
        result = result || new Vector3();
        return result.setXYZ(this[0] * vec[0] + this[3] * vec[1] + this[6] * vec[2], this[1] * vec[0] + this[4] * vec[1] + this[7] * vec[2], this[2] * vec[0] + this[5] * vec[1] + this[8] * vec[2]);
    }
    /**
   * {@inheritDoc Matrix3x3.transform}
   */ transformPoint(vec, result) {
        return this.transform(vec, result);
    }
    /**
   * {@inheritDoc Matrix3x3.transform}
   */ transformVector(vec, result) {
        return this.transform(vec, result);
    }
}
/**
 * 4x4 Matrix
 *
 * @remarks
 * The matrix is column-major:
 * | m00, m10, m20, m30 |
 * | m01, m11, m21, m31 |
 * | m02, m12, m22, m32 |
 * | m03, m13, m23, m33 |
 *
 * @public
 */ class Matrix4x4 extends VectorBase {
    constructor(arg0, arg1, arg2, arg3, arg4, arg5, arg6, arg7, arg8, arg9, arg10, arg11, arg12, arg13, arg14, arg15){
        if (arg0 instanceof ArrayBuffer && typeof arg1 === 'number') {
            super(arg0, arg1, 16);
        } else {
            super(16);
            if (typeof arg0 === 'number') {
                this[0] = arg0;
                this[1] = arg1;
                this[2] = arg2;
                this[3] = arg3;
                this[4] = arg4;
                this[5] = arg5;
                this[6] = arg6;
                this[7] = arg7;
                this[8] = arg8;
                this[9] = arg9;
                this[10] = arg10;
                this[11] = arg11;
                this[12] = arg12;
                this[13] = arg13;
                this[14] = arg14;
                this[15] = arg15;
            } else if (arg0 instanceof Quaternion) {
                arg0.toMatrix4x4(this);
            } else if (arg0 instanceof Matrix3x3) {
                this.m00 = arg0.m00;
                this.m01 = arg0.m01;
                this.m02 = arg0.m02;
                this.m03 = 0;
                this.m10 = arg0.m10;
                this.m11 = arg0.m11;
                this.m12 = arg0.m12;
                this.m13 = 0;
                this.m20 = arg0.m20;
                this.m21 = arg0.m21;
                this.m22 = arg0.m22;
                this.m23 = 0;
                this.m30 = 0;
                this.m31 = 0;
                this.m32 = 0;
                this.m33 = 1;
            } else if ((arg0 instanceof Float32Array || Array.isArray(arg0)) && arg0.length >= 16) {
                this.set(arg0);
            } else if (arg0 === undefined) {
                this.identity();
            } else {
                throw new Error('Matrix4x4.constructor(): invalid arguments');
            }
        }
    }
    /**
   * Creates a new Matrix4x4 initialized with values from this matrix.
   * @returns The new matrix.
   */ clone() {
        return new Matrix4x4(this);
    }
    /** Get the element at row 0, column 0 */ get m00() {
        return this[0];
    }
    set m00(v) {
        this[0] = v;
    }
    /** Get the element at row 0, column 1 */ get m10() {
        return this[1];
    }
    set m10(v) {
        this[1] = v;
    }
    /** Get the element at row 0, column 2 */ get m20() {
        return this[2];
    }
    set m20(v) {
        this[2] = v;
    }
    /** Get the element at row 0, column 3 */ get m30() {
        return this[3];
    }
    set m30(v) {
        this[3] = v;
    }
    /** Get the element at row 1, column 0 */ get m01() {
        return this[4];
    }
    set m01(v) {
        this[4] = v;
    }
    /** Get the element at row 1, column 1 */ get m11() {
        return this[5];
    }
    set m11(v) {
        this[5] = v;
    }
    /** Get the element at row 1, column 2 */ get m21() {
        return this[6];
    }
    set m21(v) {
        this[6] = v;
    }
    /** Get the element at row 1, column 3 */ get m31() {
        return this[7];
    }
    set m31(v) {
        this[7] = v;
    }
    /** Get the element at row 2, column 0 */ get m02() {
        return this[8];
    }
    set m02(v) {
        this[8] = v;
    }
    /** Get the element at row 2, column 1 */ get m12() {
        return this[9];
    }
    set m12(v) {
        this[9] = v;
    }
    /** Get the element at row 2, column 2 */ get m22() {
        return this[10];
    }
    set m22(v) {
        this[10] = v;
    }
    /** Get the element at row 2, column 3 */ get m32() {
        return this[11];
    }
    set m32(v) {
        this[11] = v;
    }
    /** Get the element at row 3, column 0 */ get m03() {
        return this[12];
    }
    set m03(v) {
        this[12] = v;
    }
    /** Get the element at row 3, column 1 */ get m13() {
        return this[13];
    }
    set m13(v) {
        this[13] = v;
    }
    /** Get the element at row 3, column 2 */ get m23() {
        return this[14];
    }
    set m23(v) {
        this[14] = v;
    }
    /** Get the element at row 3, column 3 */ get m33() {
        return this[15];
    }
    set m33(v) {
        this[15] = v;
    }
    /**
   * Get the values in a row as a Vector4
   * @param row - The row index
   * @param result - The output vector, if not specified, a new vector will be created.
   * @returns The output vector
   */ getRow(row, result) {
        return (result || new Vector4()).setXYZW(this[row * 4], this[row * 4 + 1], this[row * 4 + 2], this[row * 4 + 3]);
    }
    /**
   * Set values to a row in the matrix.
   * @param row - The row index
   * @param v - The values to be set
   * @returns - self
   */ setRow(row, v) {
        this[row * 4] = v.x;
        this[row * 4 + 1] = v.y;
        this[row * 4 + 2] = v.z;
        this[row * 4 + 3] = v.w;
        return this;
    }
    /**
   * Set values to a row in the matrix.
   * @param row - The row index
   * @param x - The first value of the row to be set
   * @param y - The second value of the row to be set
   * @param z - The third value of the row to be set
   * @param w - The fourth value of the row to be set
   * @returns - self
   */ setRowXYZW(row, x, y, z, w) {
        this[row * 4] = x;
        this[row * 4 + 1] = y;
        this[row * 4 + 2] = z;
        this[row * 4 + 3] = w;
        return this;
    }
    /**
   * Get the values in a column as a Vector4
   * @param col - The column index
   * @param result - The output vector, if not specified, a new vector will be created.
   * @returns The output vector
   */ getCol(col, result) {
        return (result || new Vector4()).setXYZW(this[col], this[4 + col], this[8 + col], this[12 + col]);
    }
    /**
   * Set values to a column in the matrix.
   * @param col - The column index.
   * @param v - The values to be set.
   * @returns self
   */ setCol(col, v) {
        this[col] = v.x;
        this[4 + col] = v.y;
        this[8 + col] = v.z;
        this[12 + col] = v.w;
        return this;
    }
    /**
   * Set values to a column in the matrix.
   * @param col - The column index.
   * @param x - The first value of the column to be set.
   * @param y - The second value of the column to be set.
   * @param z - The third value of the column to be set.
   * @param w - The fourth value of the column to be set.
   * @returns self
   */ setColXYZW(col, x, y, z, w) {
        this[col] = x;
        this[4 + col] = y;
        this[8 + col] = z;
        this[12 + col] = w;
        return this;
    }
    /**
   * Adds two Matrix4x4's component-wise.
   * @param a - The first operand.
   * @param b - The second operand.
   * @param result - The output matrix (can be the same as a or b), if not specified, a new matrix will be created.
   * @returns The output matrix
   */ static add(a, b, result) {
        result = result || new Matrix4x4();
        for(let i = 0; i < 16; i++){
            result[i] = a[i] + b[i];
        }
        return result;
    }
    /**
   * Subtracts two Matrix4x4's component-wise.
   * @param a - The first operand.
   * @param b - The second operand.
   * @param result - The output matrix (can be the same as a or b), if not specified, a new matrix will be created.
   * @returns
   */ static sub(a, b, result) {
        result = result || new Matrix4x4();
        for(let i = 0; i < 16; i++){
            result[i] = a[i] - b[i];
        }
        return result;
    }
    /**
   * Multiplys two Matrix4x4's component-wise.
   * @param a - The first operand.
   * @param b - The second operand.
   * @param result - The output matrix (can be the same as a or b), if not specified, a new matrix will be created.
   * @returns The output matrix
   */ static mul(a, b, result) {
        result = result || new Matrix4x4();
        for(let i = 0; i < 16; i++){
            result[i] = a[i] * b[i];
        }
        return result;
    }
    /**
   * Divides two Matrix4x4's component-wise.
   * @param a - The first operand.
   * @param b - The second operand.
   * @param result - The output matrix (can be the same as a or b), if not specified, a new matrix will be created.
   * @returns The output matrix
   */ static div(a, b, result) {
        result = result || new Matrix4x4();
        for(let i = 0; i < 16; i++){
            result[i] = a[i] / b[i];
        }
        return result;
    }
    /**
   * Scales a Matrix4x4 by a scalar number component-wise.
   * @param a - The matrix to be scaled.
   * @param f - The scalar number.
   * @param result - The output matrix (can be the same as a), if not specified, a new matrix will be created.
   * @returns The output matrix
   */ static scale(a, f, result) {
        result = result || new Matrix4x4();
        for(let i = 0; i < 16; i++){
            result[i] = a[i] * f;
        }
        return result;
    }
    /**
   * Creates an identity Matrix4x4.
   * @param result - The output matrix, if not specified, a new matrix will be created.
   * @returns The output matrix
   */ static identity(result) {
        result = result || new Matrix4x4();
        result.set(IDENT_MATRIX4x4);
        return result;
    }
    /**
   * Creates an orthogonal projection matrix from a given frustum.
   * @param left - Left bound of the frustum.
   * @param right - Right bound of the frustum.
   * @param bottom - Bottom bound of the frustum.
   * @param top - Top bound of the frustum.
   * @param near - Near bound of the frustum.
   * @param far - Far bound of the frustum.
   * @param result - The output matrix, if not specified, a new matrix will be created.
   * @returns The output matrix
   */ static ortho(left, right, bottom, top, near, far, result) {
        result = result || new Matrix4x4();
        result[0] = 2 / (right - left);
        result[1] = 0;
        result[2] = 0;
        result[3] = 0;
        result[4] = 0;
        result[5] = 2 / (top - bottom);
        result[6] = 0;
        result[7] = 0;
        result[8] = 0;
        result[9] = 0;
        result[10] = 2 / (near - far);
        result[11] = 0;
        result[12] = (left + right) / (left - right);
        result[13] = (bottom + top) / (bottom - top);
        result[14] = (near + far) / (near - far);
        result[15] = 1;
        return result;
    }
    /**
   * Creates a reflection matrix from a plane.
   * @param nx - The x component of the plane normal.
   * @param ny - The y component of the plane normal.
   * @param nz - The z component of the plane normal.
   * @param d - The plane distance.
   * @param result - The output matrix, if not specified, a new matrix will be created.
   * @returns The output matrix
   */ static reflection(nx, ny, nz, d, result) {
        result = result || new Matrix4x4();
        result.m00 = 1 - 2 * nx * nx;
        result.m01 = -2 * nx * ny;
        result.m02 = -2 * nx * nz;
        result.m03 = -2 * nx * d;
        result.m10 = -2 * nx * ny;
        result.m11 = 1 - 2 * ny * ny;
        result.m12 = -2 * ny * nz;
        result.m13 = -2 * ny * d;
        result.m20 = -2 * nx * nz;
        result.m21 = -2 * ny * nz;
        result.m22 = 1 - 2 * nz * nz;
        result.m23 = -2 * nz * d;
        result.m30 = 0;
        result.m31 = 0;
        result.m32 = 0;
        result.m33 = 1;
        return result;
    }
    /**
   * Creates a right-handed perspective projection matrix.
   * @param fovY - The vertical field of view in radians.
   * @param aspect - The aspect ratio.
   * @param znear - The near clip plane.
   * @param zfar - The far clip plane.
   * @param result - The output matrix, if not specified, a new matrix will be created.
   * @returns The output matrix
   */ static perspective(fovY, aspect, znear, zfar, result) {
        const h = znear * Math.tan(fovY * 0.5);
        const w = h * aspect;
        return this.frustum(-w, w, -h, h, znear, zfar, result);
    }
    static obliqueProjection(projectionMatrix, clipPlane) {
        const result = new Matrix4x4(projectionMatrix);
        const q = Matrix4x4.invert(projectionMatrix).transform(new Vector4(clipPlane.a > 0 ? 1 : -1, clipPlane.b > 0 ? 1 : -1, 1, 1));
        const s = 2 / (q.x * clipPlane.a + q.y * clipPlane.b + q.z * clipPlane.c + q.w * clipPlane.d);
        result[2] = clipPlane.a * s - result[3];
        result[6] = clipPlane.b * s - result[7];
        result[10] = clipPlane.c * s - result[11];
        result[14] = clipPlane.d * s - result[15];
        return result;
    }
    static obliquePerspective(perspectiveMatrix, nearPlane) {
        const result = new Matrix4x4(perspectiveMatrix);
        const q = new Vector4(((nearPlane.x > 0 ? 1 : nearPlane.x < 0 ? -1 : 0) + perspectiveMatrix.m02) / perspectiveMatrix.m00, ((nearPlane.y > 0 ? 1 : nearPlane.y < 0 ? -1 : 0) + perspectiveMatrix.m12) / perspectiveMatrix.m11, -1, (1 + perspectiveMatrix.m22) / perspectiveMatrix.m23);
        const c = Vector4.scale(nearPlane, 2 / Vector4.dot(nearPlane, q));
        result.m20 = c.x;
        result.m21 = c.y;
        result.m22 = c.z + 1;
        result.m23 = c.w;
        return result;
    /*
        float       matrix[16];
        Vector4D    q;

        // Grab the current projection matrix from OpenGL
        glGetFloatv(GL_PROJECTION_MATRIX, matrix);

        // Calculate the clip-space corner point opposite the clipping plane
        // as (sgn(clipPlane.x), sgn(clipPlane.y), 1, 1) and
        // transform it into camera space by multiplying it
        // by the inverse of the projection matrix

        q.x = (sgn(clipPlane.x) + matrix[8]) / matrix[0];
        q.y = (sgn(clipPlane.y) + matrix[9]) / matrix[5];
        q.z = -1.0F;
        q.w = (1.0F + matrix[10]) / matrix[14];

        // Calculate the scaled plane vector
        Vector4D c = clipPlane * (2.0F / Dot(clipPlane, q));

        // Replace the third row of the projection matrix
        matrix[2] = c.x;
        matrix[6] = c.y;
        matrix[10] = c.z + 1.0F;
        matrix[14] = c.w;

        // Load it back into OpenGL
        glMatrixMode(GL_PROJECTION);
        glLoadMatrix(matrix);
    }
    */ }
    /**
   * Creates a perspective projection matrix from a frustum.
   * @param left - Left bound of the frustum.
   * @param right - Right bound of the frustum.
   * @param bottom - Bottom bound of the frustum.
   * @param top - Top bound of the frustum.
   * @param znear - Near bound of the frustum.
   * @param zfar - Far bound of the frustum.
   * @param result - The output matrix, if not specified, a new matrix will be created.
   * @returns The output matrix
   */ static frustum(left, right, bottom, top, znear, zfar, result) {
        result = result || new Matrix4x4();
        const dx = right - left;
        const dy = top - bottom;
        const dz = znear - zfar;
        result[0] = 2 * znear / dx;
        result[1] = 0;
        result[2] = 0;
        result[3] = 0;
        result[4] = 0;
        result[5] = 2 * znear / dy;
        result[6] = 0;
        result[7] = 0;
        result[8] = (left + right) / dx;
        result[9] = (top + bottom) / dy;
        result[10] = (znear + zfar) / dz;
        result[11] = -1;
        result[12] = 0;
        result[13] = 0;
        result[14] = 2 * znear * zfar / dz;
        result[15] = 0;
        return result;
    }
    /**
   * Transpose a Matrix4x4.
   * @param matrix - The matrix to be transposed.
   * @param result - The output matrix (can be the same as matrix), if not specified, a new matrix will be created.
   * @returns The output matrix
   */ static transpose(matrix, result) {
        result = result || new Matrix4x4();
        if (matrix === result) {
            [result[1], result[4]] = [
                result[4],
                result[1]
            ];
            [result[2], result[8]] = [
                result[8],
                result[2]
            ];
            [result[3], result[12]] = [
                result[12],
                result[3]
            ];
            [result[6], result[9]] = [
                result[9],
                result[6]
            ];
            [result[7], result[13]] = [
                result[13],
                result[7]
            ];
            [result[11], result[14]] = [
                result[14],
                result[11]
            ];
        } else {
            result[0] = matrix[0];
            result[1] = matrix[4];
            result[2] = matrix[8];
            result[3] = matrix[12];
            result[4] = matrix[1];
            result[5] = matrix[5];
            result[6] = matrix[9];
            result[7] = matrix[13];
            result[8] = matrix[2];
            result[9] = matrix[6];
            result[10] = matrix[10];
            result[11] = matrix[14];
            result[12] = matrix[3];
            result[13] = matrix[7];
            result[14] = matrix[11];
            result[15] = matrix[15];
        }
        return result;
    }
    /**
   * Inverts a Matrix4x4
   * @param matrix - The matrix to be inverted.
   * @param result - The output matrix (can be the same as matrix). if not specified, a new matrix will be created.
   * @returns The output matrix
   */ static invert(matrix, result) {
        result = result || new Matrix4x4();
        const m00 = matrix[0 * 4 + 0];
        const m01 = matrix[0 * 4 + 1];
        const m02 = matrix[0 * 4 + 2];
        const m03 = matrix[0 * 4 + 3];
        const m10 = matrix[1 * 4 + 0];
        const m11 = matrix[1 * 4 + 1];
        const m12 = matrix[1 * 4 + 2];
        const m13 = matrix[1 * 4 + 3];
        const m20 = matrix[2 * 4 + 0];
        const m21 = matrix[2 * 4 + 1];
        const m22 = matrix[2 * 4 + 2];
        const m23 = matrix[2 * 4 + 3];
        const m30 = matrix[3 * 4 + 0];
        const m31 = matrix[3 * 4 + 1];
        const m32 = matrix[3 * 4 + 2];
        const m33 = matrix[3 * 4 + 3];
        const tmp_0 = m22 * m33;
        const tmp_1 = m32 * m23;
        const tmp_2 = m12 * m33;
        const tmp_3 = m32 * m13;
        const tmp_4 = m12 * m23;
        const tmp_5 = m22 * m13;
        const tmp_6 = m02 * m33;
        const tmp_7 = m32 * m03;
        const tmp_8 = m02 * m23;
        const tmp_9 = m22 * m03;
        const tmp_10 = m02 * m13;
        const tmp_11 = m12 * m03;
        const tmp_12 = m20 * m31;
        const tmp_13 = m30 * m21;
        const tmp_14 = m10 * m31;
        const tmp_15 = m30 * m11;
        const tmp_16 = m10 * m21;
        const tmp_17 = m20 * m11;
        const tmp_18 = m00 * m31;
        const tmp_19 = m30 * m01;
        const tmp_20 = m00 * m21;
        const tmp_21 = m20 * m01;
        const tmp_22 = m00 * m11;
        const tmp_23 = m10 * m01;
        const t0 = tmp_0 * m11 + tmp_3 * m21 + tmp_4 * m31 - (tmp_1 * m11 + tmp_2 * m21 + tmp_5 * m31);
        const t1 = tmp_1 * m01 + tmp_6 * m21 + tmp_9 * m31 - (tmp_0 * m01 + tmp_7 * m21 + tmp_8 * m31);
        const t2 = tmp_2 * m01 + tmp_7 * m11 + tmp_10 * m31 - (tmp_3 * m01 + tmp_6 * m11 + tmp_11 * m31);
        const t3 = tmp_5 * m01 + tmp_8 * m11 + tmp_11 * m21 - (tmp_4 * m01 + tmp_9 * m11 + tmp_10 * m21);
        const d = 1.0 / (m00 * t0 + m10 * t1 + m20 * t2 + m30 * t3);
        result[0] = d * t0;
        result[1] = d * t1;
        result[2] = d * t2;
        result[3] = d * t3;
        result[4] = d * (tmp_1 * m10 + tmp_2 * m20 + tmp_5 * m30 - (tmp_0 * m10 + tmp_3 * m20 + tmp_4 * m30));
        result[5] = d * (tmp_0 * m00 + tmp_7 * m20 + tmp_8 * m30 - (tmp_1 * m00 + tmp_6 * m20 + tmp_9 * m30));
        result[6] = d * (tmp_3 * m00 + tmp_6 * m10 + tmp_11 * m30 - (tmp_2 * m00 + tmp_7 * m10 + tmp_10 * m30));
        result[7] = d * (tmp_4 * m00 + tmp_9 * m10 + tmp_10 * m20 - (tmp_5 * m00 + tmp_8 * m10 + tmp_11 * m20));
        result[8] = d * (tmp_12 * m13 + tmp_15 * m23 + tmp_16 * m33 - (tmp_13 * m13 + tmp_14 * m23 + tmp_17 * m33));
        result[9] = d * (tmp_13 * m03 + tmp_18 * m23 + tmp_21 * m33 - (tmp_12 * m03 + tmp_19 * m23 + tmp_20 * m33));
        result[10] = d * (tmp_14 * m03 + tmp_19 * m13 + tmp_22 * m33 - (tmp_15 * m03 + tmp_18 * m13 + tmp_23 * m33));
        result[11] = d * (tmp_17 * m03 + tmp_20 * m13 + tmp_23 * m23 - (tmp_16 * m03 + tmp_21 * m13 + tmp_22 * m23));
        result[12] = d * (tmp_14 * m22 + tmp_17 * m32 + tmp_13 * m12 - (tmp_16 * m32 + tmp_12 * m12 + tmp_15 * m22));
        result[13] = d * (tmp_20 * m32 + tmp_12 * m02 + tmp_19 * m22 - (tmp_18 * m22 + tmp_21 * m32 + tmp_13 * m02));
        result[14] = d * (tmp_18 * m12 + tmp_23 * m32 + tmp_15 * m02 - (tmp_22 * m32 + tmp_14 * m02 + tmp_19 * m12));
        result[15] = d * (tmp_22 * m22 + tmp_16 * m02 + tmp_21 * m12 - (tmp_20 * m12 + tmp_23 * m22 + tmp_17 * m02));
        return result;
    }
    /**
   * Inverts a Matrix4x4 which presents an affine transformation.
   * @param matrix - The matrix to be inverted.
   * @param result - The output matrix (can be the same as matrix). if not specified, a new matrix will be created.
   * @returns The output matrix
   */ static invertAffine(matrix, result) {
        result = result || new Matrix4x4();
        const m00 = matrix[0 * 4 + 0];
        const m01 = matrix[0 * 4 + 1];
        const m02 = matrix[0 * 4 + 2];
        const m10 = matrix[1 * 4 + 0];
        const m11 = matrix[1 * 4 + 1];
        const m12 = matrix[1 * 4 + 2];
        const m20 = matrix[2 * 4 + 0];
        const m21 = matrix[2 * 4 + 1];
        const m22 = matrix[2 * 4 + 2];
        const m30 = matrix[3 * 4 + 0];
        const m31 = matrix[3 * 4 + 1];
        const m32 = matrix[3 * 4 + 2];
        const t0 = m22 * m11 - m12 * m21;
        const t1 = m02 * m21 - m22 * m01;
        const t2 = m12 * m01 - m02 * m11;
        const d = 1.0 / (m00 * t0 + m10 * t1 + m20 * t2);
        result[0] = d * t0;
        result[1] = d * t1;
        result[2] = d * t2;
        result[3] = 0;
        result[4] = d * (m12 * m20 - m22 * m10);
        result[5] = d * (m22 * m00 - m02 * m20);
        result[6] = d * (m02 * m10 - m12 * m00);
        result[7] = 0;
        result[8] = d * (m10 * m21 - m20 * m11);
        result[9] = d * (m20 * m01 - m00 * m21);
        result[10] = d * (m00 * m11 - m10 * m01);
        result[11] = 0;
        result[12] = d * (m10 * m31 * m22 + m20 * m11 * m32 + m30 * m21 * m12 - (m10 * m21 * m32 + m20 * m31 * m12 + m30 * m11 * m22));
        result[13] = d * (m00 * m21 * m32 + m20 * m31 * m02 + m30 * m01 * m22 - (m00 * m31 * m22 + m20 * m01 * m32 + m30 * m21 * m02));
        result[14] = d * (m00 * m31 * m12 + m10 * m01 * m32 + m30 * m11 * m02 - (m00 * m11 * m32 + m10 * m31 * m02 + m30 * m01 * m12));
        result[15] = 1;
        return result;
    }
    /**
   * Creates a Matrix4x4 which presents a translation.
   * @param t - The translate vector.
   * @param result - The output matrix. if not specified, a new matrix will be created.
   * @returns The output matrix
   */ static translation(t, result) {
        result = result || new Matrix4x4();
        result[0] = 1;
        result[1] = 0;
        result[2] = 0;
        result[3] = 0;
        result[4] = 0;
        result[5] = 1;
        result[6] = 0;
        result[7] = 0;
        result[8] = 0;
        result[9] = 0;
        result[10] = 1;
        result[11] = 0;
        result[12] = t.x;
        result[13] = t.y;
        result[14] = t.z;
        result[15] = 1;
        return result;
    }
    /**
   * Creates a Matrix4x4 which presents a translation.
   * @param tx - The translate of x axis.
   * @param ty - The translate of y axis.
   * @param tz - The translate of z axis.
   * @param result - The output matrix. if not specified, a new matrix will be created.
   * @returns The output matrix
   */ static translationXYZ(tx, ty, tz, result) {
        result = result || new Matrix4x4();
        result[0] = 1;
        result[1] = 0;
        result[2] = 0;
        result[3] = 0;
        result[4] = 0;
        result[5] = 1;
        result[6] = 0;
        result[7] = 0;
        result[8] = 0;
        result[9] = 0;
        result[10] = 1;
        result[11] = 0;
        result[12] = tx;
        result[13] = ty;
        result[14] = tz;
        result[15] = 1;
        return result;
    }
    /**
   * Creates a Matrix4x4 which presents a scaling.
   * @param s - The scale vector.
   * @param result - The output matrix. if not specified, a new matrix will be created.
   * @returns The output matrix
   */ static scaling(s, result) {
        result = result || new Matrix4x4();
        result[0] = s.x;
        result[1] = 0;
        result[2] = 0;
        result[3] = 0;
        result[4] = 0;
        result[5] = s.y;
        result[6] = 0;
        result[7] = 0;
        result[8] = 0;
        result[9] = 0;
        result[10] = s.z;
        result[11] = 0;
        result[12] = 0;
        result[13] = 0;
        result[14] = 0;
        result[15] = 1;
        return result;
    }
    /**
   * Creates a Matrix4x4 which presents a scaling.
   * @param sx - The scale of x axis.
   * @param sy - The scale of y axis.
   * @param sz - The scale of z axis.
   * @param result - The output matrix. if not specified, a new matrix will be created.
   * @returns The output matrix
   */ static scalingXYZ(sx, sy, sz, result) {
        result = result || new Matrix4x4();
        result[0] = sx;
        result[1] = 0;
        result[2] = 0;
        result[3] = 0;
        result[4] = 0;
        result[5] = sy;
        result[6] = 0;
        result[7] = 0;
        result[8] = 0;
        result[9] = 0;
        result[10] = sz;
        result[11] = 0;
        result[12] = 0;
        result[13] = 0;
        result[14] = 0;
        result[15] = 1;
        return result;
    }
    /**
   * Creates a Matrix4x4 which presents a rotation around the x axis.
   * @param angle - The rotate angle in radians.
   * @param result - The output matrix. if not specified, a new matrix will be created.
   * @returns The output matrix
   */ static rotationX(angle, result) {
        result = result || new Matrix4x4();
        const c = Math.cos(angle);
        const s = Math.sin(angle);
        result[0] = 1;
        result[1] = 0;
        result[2] = 0;
        result[3] = 0;
        result[4] = 0;
        result[5] = c;
        result[6] = s;
        result[7] = 0;
        result[8] = 0;
        result[9] = -s;
        result[10] = c;
        result[11] = 0;
        result[12] = 0;
        result[13] = 0;
        result[14] = 0;
        result[15] = 1;
        return result;
    }
    /**
   * Creates a Matrix4x4 which presents a rotation around the y axis.
   * @param angle - The rotate angle in radians.
   * @param result - The output matrix. if not specified, a new matrix will be created.
   * @returns The output matrix
   */ static rotationY(angle, result) {
        result = result || new Matrix4x4();
        const c = Math.cos(angle);
        const s = Math.sin(angle);
        result[0] = c;
        result[1] = 0;
        result[2] = -s;
        result[3] = 0;
        result[4] = 0;
        result[5] = 1;
        result[6] = 0;
        result[7] = 0;
        result[8] = s;
        result[9] = 0;
        result[10] = c;
        result[11] = 0;
        result[12] = 0;
        result[13] = 0;
        result[14] = 0;
        result[15] = 1;
        return result;
    }
    /**
   * Creates a Matrix4x4 which presents a rotation around the z axis.
   * @param angle - The rotate angle in radians.
   * @param result - The output matrix. if not specified, a new matrix will be created.
   * @returns The output matrix
   */ static rotationZ(angle, result) {
        result = result || new Matrix4x4();
        const c = Math.cos(angle);
        const s = Math.sin(angle);
        result[0] = c;
        result[1] = s;
        result[2] = 0;
        result[3] = 0;
        result[4] = -s;
        result[5] = c;
        result[6] = 0;
        result[7] = 0;
        result[8] = 0;
        result[9] = 0;
        result[10] = 1;
        result[11] = 0;
        result[12] = 0;
        result[13] = 0;
        result[14] = 0;
        result[15] = 1;
        return result;
    }
    /**
   * Creates a Matrix4x4 which presents a rotation around a given axis.
   * @param axis - The axis vector.
   * @param angle - The rotate angle in radians.
   * @param result - The output matrix. if not specified, a new matrix will be created.
   * @returns The output matrix
   */ static rotation(axis, angle, result) {
        result = result || new Matrix4x4();
        let x = axis.x;
        let y = axis.y;
        let z = axis.z;
        const n = Math.hypot(x, y, z);
        x /= n;
        y /= n;
        z /= n;
        const xx = x * x;
        const yy = y * y;
        const zz = z * z;
        const c = Math.cos(angle);
        const s = Math.sin(angle);
        const oneMinusCosine = 1 - c;
        result[0] = xx + (1 - xx) * c;
        result[1] = x * y * oneMinusCosine + z * s;
        result[2] = x * z * oneMinusCosine - y * s;
        result[3] = 0;
        result[4] = x * y * oneMinusCosine - z * s;
        result[5] = yy + (1 - yy) * c;
        result[6] = y * z * oneMinusCosine + x * s;
        result[7] = 0;
        result[8] = x * z * oneMinusCosine + y * s;
        result[9] = y * z * oneMinusCosine - x * s;
        result[10] = zz + (1 - zz) * c;
        result[11] = 0;
        result[12] = 0;
        result[13] = 0;
        result[14] = 0;
        result[15] = 1;
        return result;
    }
    /**
   * Compose matrix from rotation, translation and scale components.
   * @param scale - The input scale vector.
   * @param rotation - The input rotation matrix or quaternion.
   * @param translation - The input translation vector.
   * @returns The composed matrix
   */ static compose(scale, rotation, translation, result) {
        result = result ?? new Matrix4x4();
        return result.scaling(scale).rotateLeft(rotation).translateLeft(translation);
    }
    /**
   * Creates a look-at matrix.
   * @param eye - Position of the eye.
   * @param target - The point that the eye is looking at.
   * @param up - The up vector.
   * @param result - The output matrix, if not specified, a new matrix will be created.
   * @returns The output matrix
   */ static lookAt(eye, target, up, result) {
        result = result || new Matrix4x4();
        const zAxis = Vector3.normalize(Vector3.sub(eye, target));
        const xAxis = Vector3.normalize(Vector3.cross(up, zAxis));
        const yAxis = Vector3.normalize(Vector3.cross(zAxis, xAxis));
        result[0] = xAxis.x;
        result[1] = xAxis.y;
        result[2] = xAxis.z;
        result[3] = 0;
        result[4] = yAxis.x;
        result[5] = yAxis.y;
        result[6] = yAxis.z;
        result[7] = 0;
        result[8] = zAxis.x;
        result[9] = zAxis.y;
        result[10] = zAxis.z;
        result[11] = 0;
        result[12] = eye.x;
        result[13] = eye.y;
        result[14] = eye.z;
        result[15] = 1;
        return result;
    }
    /**
   * Creates a matrix, which presents a transform of looking at given cube face.
   * @param face - The cube face to be looked at.
   * @param result - The output matrix, if not specified, a new matrix will be created.
   * @returns The output matrix
   */ static lookAtCubeFace(face, pos, result) {
        switch(face){
            case CubeFace.PX:
                return this.lookAt(pos, new Vector3(pos.x + 1, pos.y, pos.z), new Vector3(0, -1, 0), result);
            case CubeFace.NX:
                return this.lookAt(pos, new Vector3(pos.x - 1, pos.y, pos.z), new Vector3(0, -1, 0), result);
            case CubeFace.PY:
                return this.lookAt(pos, new Vector3(pos.x, pos.y + 1, pos.z), new Vector3(0, 0, 1), result);
            case CubeFace.NY:
                return this.lookAt(pos, new Vector3(pos.x, pos.y - 1, pos.z), new Vector3(0, 0, -1), result);
            case CubeFace.PZ:
                return this.lookAt(pos, new Vector3(pos.x, pos.y, pos.z + 1), new Vector3(0, -1, 0), result);
            case CubeFace.NZ:
                return this.lookAt(pos, new Vector3(pos.x, pos.y, pos.z - 1), new Vector3(0, -1, 0), result);
            default:
                throw new Error(`Invalid cube face: ${face}`);
        }
    }
    /**
   * Multiplies two Matrix4x4's
   * @param m1 - The first operand.
   * @param m2 - The second operand.
   * @param result - The output matrix (can be the same as m1 or m2), if not specified, a new matrix will be created.
   * @returns The output matrix
   */ static multiply(m1, m2, result) {
        result = result || new Matrix4x4();
        const a00 = m1[0];
        const a01 = m1[1];
        const a02 = m1[2];
        const a03 = m1[3];
        const a10 = m1[4];
        const a11 = m1[5];
        const a12 = m1[6];
        const a13 = m1[7];
        const a20 = m1[8];
        const a21 = m1[9];
        const a22 = m1[10];
        const a23 = m1[11];
        const a30 = m1[12];
        const a31 = m1[13];
        const a32 = m1[14];
        const a33 = m1[15];
        const b00 = m2[0];
        const b01 = m2[1];
        const b02 = m2[2];
        const b03 = m2[3];
        const b10 = m2[4];
        const b11 = m2[5];
        const b12 = m2[6];
        const b13 = m2[7];
        const b20 = m2[8];
        const b21 = m2[9];
        const b22 = m2[10];
        const b23 = m2[11];
        const b30 = m2[12];
        const b31 = m2[13];
        const b32 = m2[14];
        const b33 = m2[15];
        result[0] = a00 * b00 + a10 * b01 + a20 * b02 + a30 * b03;
        result[1] = a01 * b00 + a11 * b01 + a21 * b02 + a31 * b03;
        result[2] = a02 * b00 + a12 * b01 + a22 * b02 + a32 * b03;
        result[3] = a03 * b00 + a13 * b01 + a23 * b02 + a33 * b03;
        result[4] = a00 * b10 + a10 * b11 + a20 * b12 + a30 * b13;
        result[5] = a01 * b10 + a11 * b11 + a21 * b12 + a31 * b13;
        result[6] = a02 * b10 + a12 * b11 + a22 * b12 + a32 * b13;
        result[7] = a03 * b10 + a13 * b11 + a23 * b12 + a33 * b13;
        result[8] = a00 * b20 + a10 * b21 + a20 * b22 + a30 * b23;
        result[9] = a01 * b20 + a11 * b21 + a21 * b22 + a31 * b23;
        result[10] = a02 * b20 + a12 * b21 + a22 * b22 + a32 * b23;
        result[11] = a03 * b20 + a13 * b21 + a23 * b22 + a33 * b23;
        result[12] = a00 * b30 + a10 * b31 + a20 * b32 + a30 * b33;
        result[13] = a01 * b30 + a11 * b31 + a21 * b32 + a31 * b33;
        result[14] = a02 * b30 + a12 * b31 + a22 * b32 + a32 * b33;
        result[15] = a03 * b30 + a13 * b31 + a23 * b32 + a33 * b33;
        return result;
    }
    /**
   * Multiplies two Matrix4x4's which present affine transformations.
   * @param m1 - The first operand.
   * @param m2 - The second operand.
   * @param result - The output matrix (can be the same as m1 or m2), if not specified, a new matrix will be created.
   * @returns The output matrix
   */ static multiplyAffine(m1, m2, result) {
        result = result || new Matrix4x4();
        const a00 = m1[0];
        const a01 = m1[1];
        const a02 = m1[2];
        const a10 = m1[4];
        const a11 = m1[5];
        const a12 = m1[6];
        const a20 = m1[8];
        const a21 = m1[9];
        const a22 = m1[10];
        const a30 = m1[12];
        const a31 = m1[13];
        const a32 = m1[14];
        const b00 = m2[0];
        const b01 = m2[1];
        const b02 = m2[2];
        const b10 = m2[4];
        const b11 = m2[5];
        const b12 = m2[6];
        const b20 = m2[8];
        const b21 = m2[9];
        const b22 = m2[10];
        const b30 = m2[12];
        const b31 = m2[13];
        const b32 = m2[14];
        result[0] = a00 * b00 + a10 * b01 + a20 * b02;
        result[1] = a01 * b00 + a11 * b01 + a21 * b02;
        result[2] = a02 * b00 + a12 * b01 + a22 * b02;
        result[3] = 0;
        result[4] = a00 * b10 + a10 * b11 + a20 * b12;
        result[5] = a01 * b10 + a11 * b11 + a21 * b12;
        result[6] = a02 * b10 + a12 * b11 + a22 * b12;
        result[7] = 0;
        result[8] = a00 * b20 + a10 * b21 + a20 * b22;
        result[9] = a01 * b20 + a11 * b21 + a21 * b22;
        result[10] = a02 * b20 + a12 * b21 + a22 * b22;
        result[11] = 0;
        result[12] = a00 * b30 + a10 * b31 + a20 * b32 + a30;
        result[13] = a01 * b30 + a11 * b31 + a21 * b32 + a31;
        result[14] = a02 * b30 + a12 * b31 + a22 * b32 + a32;
        result[15] = 1;
        return result;
    }
    /**
   * Post-translate a Matrix4x4 by a vector.
   *
   * @remarks
   * result = m * (translate matrix for t)
   *
   * @param m - The matrix that will be translated.
   * @param t - The translate vector.
   * @param result - The output matrix (can be the same as m), if not specified, a new matrix will be created.
   * @returns The output matrix
   */ static translateRight(m, t, result) {
        result = result || new Matrix4x4();
        if (result !== m) {
            result[0] = m[0];
            result[1] = m[1];
            result[2] = m[2];
            result[3] = m[3];
            result[4] = m[4];
            result[5] = m[5];
            result[6] = m[6];
            result[7] = m[7];
            result[8] = m[8];
            result[9] = m[9];
            result[10] = m[10];
            result[11] = m[11];
            result[12] = m[0] * t.x + m[4] * t.y + m[8] * t.z + m[12];
            result[13] = m[1] * t.x + m[5] * t.y + m[9] * t.z + m[13];
            result[14] = m[2] * t.x + m[6] * t.y + m[10] * t.z + m[14];
            result[15] = m[15];
        } else {
            const x = m[0] * t.x + m[4] * t.y + m[8] * t.z + m[12];
            const y = m[1] * t.x + m[5] * t.y + m[9] * t.z + m[13];
            const z = m[2] * t.x + m[6] * t.y + m[10] * t.z + m[14];
            result[12] = x;
            result[13] = y;
            result[14] = z;
        }
        return result;
    }
    /**
   * Pre-translate a Matrix4x4 by a vector.
   *
   * @remarks
   * result = (translate matrix for t) * m
   *
   * @param m - The matrix that will be translated.
   * @param t - The translate vector.
   * @param result - The output matrix (can be the same as m), if not specified, a new matrix will be created.
   * @returns The output matrix
   */ static translateLeft(m, t, result) {
        result = result || new Matrix4x4();
        if (result !== m) {
            result[0] = m[0];
            result[1] = m[1];
            result[2] = m[2];
            result[3] = m[3];
            result[4] = m[4];
            result[5] = m[5];
            result[6] = m[6];
            result[7] = m[7];
            result[8] = m[8];
            result[9] = m[9];
            result[10] = m[10];
            result[11] = m[11];
            result[12] = m[12] + t.x;
            result[13] = m[13] + t.y;
            result[14] = m[14] + t.z;
            result[15] = m[15];
        } else {
            result[12] += t.x;
            result[13] += t.y;
            result[14] += t.z;
        }
        return result;
    }
    /**
   * Post-scale a Matrix4x4 by a vector.
   *
   * @remarks
   * result = m * (scale matrix for s)
   *
   * @param m - The matrix that will be scaled.
   * @param s - The scale vector.
   * @param result - The output matrix (can be the same as m), if not specified, a new matrix will be created.
   * @returns The output matrix
   */ static scaleRight(m, s, result) {
        result = result || new Matrix4x4();
        if (result !== m) {
            result[0] = m[0] * s.x;
            result[1] = m[1] * s.x;
            result[2] = m[2] * s.x;
            result[3] = m[3] * s.x;
            result[4] = m[4] * s.y;
            result[5] = m[5] * s.y;
            result[6] = m[6] * s.y;
            result[7] = m[7] * s.y;
            result[8] = m[8] * s.z;
            result[9] = m[9] * s.z;
            result[10] = m[10] * s.z;
            result[11] = m[11] * s.z;
            result[12] = m[12];
            result[13] = m[13];
            result[14] = m[14];
            result[15] = m[15];
        } else {
            result[0] *= s.x;
            result[1] *= s.x;
            result[2] *= s.x;
            result[3] *= s.x;
            result[4] *= s.y;
            result[5] *= s.y;
            result[6] *= s.y;
            result[7] *= s.y;
            result[8] *= s.z;
            result[9] *= s.z;
            result[10] *= s.z;
            result[11] *= s.z;
        }
        return result;
    }
    /**
   * Pre-scale a Matrix4x4 by a vector.
   *
   * @remarks
   * result = (scale matrix for s) * m
   *
   * @param m - The matrix that will be translated.
   * @param s - The scale vector.
   * @param result - The output matrix (can be the same as m), if not specified, a new matrix will be created.
   * @returns The output matrix
   */ static scaleLeft(m, s, result) {
        result = result || new Matrix4x4();
        result[0] = m[0] * s.x;
        result[1] = m[1] * s.y;
        result[2] = m[2] * s.z;
        result[3] = m[3];
        result[4] = m[4] * s.x;
        result[5] = m[5] * s.y;
        result[6] = m[6] * s.z;
        result[7] = m[7];
        result[8] = m[8] * s.x;
        result[9] = m[9] * s.y;
        result[10] = m[10] * s.z;
        result[11] = m[11];
        result[12] = m[12] * s.x;
        result[13] = m[13] * s.y;
        result[14] = m[14] * s.z;
        result[15] = m[15];
        return result;
    }
    /**
   * Post-rotate a Matrix4x4 by a rotation matrix or quaternion.
   *
   * @remarks
   * result = m * r
   *
   * @param m - The matrix that will be translated.
   * @param r - The rotate matrix or quaternion.
   * @param result - The output matrix (can be the same as m), if not specified, a new matrix will be created.
   * @returns The output matrix
   */ static rotateRight(m, r, result) {
        result = result || new Matrix4x4();
        const b = r instanceof Quaternion ? new Matrix3x3(r) : r;
        const a00 = m[0];
        const a01 = m[1];
        const a02 = m[2];
        const a03 = m[3];
        const a10 = m[4];
        const a11 = m[5];
        const a12 = m[6];
        const a13 = m[7];
        const a20 = m[8];
        const a21 = m[9];
        const a22 = m[10];
        const a23 = m[11];
        const a30 = m[12];
        const a31 = m[13];
        const a32 = m[14];
        const a33 = m[15];
        const b00 = b.m00;
        const b01 = b.m10;
        const b02 = b.m20;
        const b10 = b.m01;
        const b11 = b.m11;
        const b12 = b.m21;
        const b20 = b.m02;
        const b21 = b.m12;
        const b22 = b.m22;
        result[0] = a00 * b00 + a10 * b01 + a20 * b02;
        result[1] = a01 * b00 + a11 * b01 + a21 * b02;
        result[2] = a02 * b00 + a12 * b01 + a22 * b02;
        result[3] = a03 * b00 + a13 * b01 + a23 * b02;
        result[4] = a00 * b10 + a10 * b11 + a20 * b12;
        result[5] = a01 * b10 + a11 * b11 + a21 * b12;
        result[6] = a02 * b10 + a12 * b11 + a22 * b12;
        result[7] = a03 * b10 + a13 * b11 + a23 * b12;
        result[8] = a00 * b20 + a10 * b21 + a20 * b22;
        result[9] = a01 * b20 + a11 * b21 + a21 * b22;
        result[10] = a02 * b20 + a12 * b21 + a22 * b22;
        result[11] = a03 * b20 + a13 * b21 + a23 * b22;
        result[12] = a30;
        result[13] = a31;
        result[14] = a32;
        result[15] = a33;
        return result;
    }
    /**
   * Pre-rotate a Matrix4x4 by a rotation matrix or quaternion.
   *
   * @remarks
   * result = r * m
   *
   * @param m - The matrix that will be translated.
   * @param r - The rotate matrix or quaternion.
   * @param result - The output matrix (can be the same as m), if not specified, a new matrix will be created.
   * @returns The output matrix
   */ static rotateLeft(m, r, result) {
        result = result || new Matrix4x4();
        const a = r instanceof Quaternion ? new Matrix3x3(r) : r;
        const a00 = a.m00;
        const a01 = a.m10;
        const a02 = a.m20;
        const a10 = a.m01;
        const a11 = a.m11;
        const a12 = a.m21;
        const a20 = a.m02;
        const a21 = a.m12;
        const a22 = a.m22;
        const b00 = m[0];
        const b01 = m[1];
        const b02 = m[2];
        const b03 = m[3];
        const b10 = m[4];
        const b11 = m[5];
        const b12 = m[6];
        const b13 = m[7];
        const b20 = m[8];
        const b21 = m[9];
        const b22 = m[10];
        const b23 = m[11];
        const b30 = m[12];
        const b31 = m[13];
        const b32 = m[14];
        const b33 = m[15];
        result[0] = a00 * b00 + a10 * b01 + a20 * b02;
        result[1] = a01 * b00 + a11 * b01 + a21 * b02;
        result[2] = a02 * b00 + a12 * b01 + a22 * b02;
        result[3] = b03;
        result[4] = a00 * b10 + a10 * b11 + a20 * b12;
        result[5] = a01 * b10 + a11 * b11 + a21 * b12;
        result[6] = a02 * b10 + a12 * b11 + a22 * b12;
        result[7] = b13;
        result[8] = a00 * b20 + a10 * b21 + a20 * b22;
        result[9] = a01 * b20 + a11 * b21 + a21 * b22;
        result[10] = a02 * b20 + a12 * b21 + a22 * b22;
        result[11] = b23;
        result[12] = a00 * b30 + a10 * b31 + a20 * b32;
        result[13] = a01 * b30 + a11 * b31 + a21 * b32;
        result[14] = a02 * b30 + a12 * b31 + a22 * b32;
        result[15] = b33;
        return result;
    }
    /**
   * Subtract a matrix from this matrix component-wise.
   * @param other - The matrix that will be subtract.
   * @returns self
   */ subBy(other) {
        Matrix4x4.sub(this, other, this);
        return this;
    }
    /**
   * Add a matrix to this matrix component-wise.
   * @param other - The matrix that will be added.
   * @returns self
   */ addBy(other) {
        Matrix4x4.add(this, other, this);
        return this;
    }
    /**
   * Multiplies this matrix by a matrix component-wise.
   * @param other - The matrix that will be multiplied by.
   * @returns self
   */ mulBy(other) {
        Matrix4x4.mul(this, other, this);
        return this;
    }
    /**
   * Divide this matrix by a matrix component-wise.
   * @param other - The matrix that will be divide by.
   * @returns self
   */ divBy(other) {
        Matrix4x4.div(this, other, this);
        return this;
    }
    /**
   * Scale this matrix by a scalar number component-wise.
   * @param f - amount to scale this matrix by.
   * @returns self
   */ scaleBy(f) {
        Matrix4x4.scale(this, f, this);
        return this;
    }
    /**
   * Make this matrix identity.
   * @returns self
   */ identity() {
        Matrix4x4.identity(this);
        return this;
    }
    /**
   * Calculates a right-handed perspective projection matrix inplace.
   * @param fovY - The vertical field of view in radians.
   * @param aspect - The aspect ratio.
   * @param znear - The near clip plane.
   * @param zfar - The far clip plane.
   * @returns self
   */ perspective(fovY, aspect, znear, zfar) {
        Matrix4x4.perspective(fovY, aspect, znear, zfar, this);
        return this;
    }
    /**
   * Calculates a perspective projection matrix from a frustum inplace.
   * @param left - Left bound of the frustum.
   * @param right - Right bound of the frustum.
   * @param bottom - Bottom bound of the frustum.
   * @param top - Top bound of the frustum.
   * @param znear - Near bound of the frustum.
   * @param zfar - Far bound of the frustum.
   * @returns self
   */ frustum(left, right, bottom, top, znear, zfar) {
        Matrix4x4.frustum(left, right, bottom, top, znear, zfar, this);
        return this;
    }
    /**
   * Calculates an orthogonal projection matrix inplace.
   * @param left - Left bound of the frustum.
   * @param right - Right bound of the frustum.
   * @param bottom - Bottom bound of the frustum.
   * @param top - Top bound of the frustum.
   * @param near - Near bound of the frustum.
   * @param far - Far bound of the frustum.
   * @returns self
   */ ortho(left, right, bottom, top, near, far) {
        Matrix4x4.ortho(left, right, bottom, top, near, far, this);
        return this;
    }
    /**
   * Check if this matrix is orthogonal projection matrix.
   *
   * @remarks
   * This method assumes that this is an affine transform matrix or a projection matrix (perspective or orthogonal).
   *
   * @returns true if this is an orthogonal projection matrix, otherwise false
   */ isOrtho() {
        // assum this is a projection matrix
        return this[15] === 1;
    }
    /**
   * Check if this matrix is perspective projection matrix.
   *
   * @remarks
   * This method assumes that this is an affine transform matrix or a projection matrix (perspective or orthogonal).
   *
   * @returns true if this is a perspective projection matrix, otherwise false
   */ isPerspective() {
        // assum this is a projection matrix
        return this[15] === 0;
    }
    /**
   * Get width of the near clip plane.
   *
   * @remarks
   * This method assumes that this is a projection matrix (perspective or orthogonal).
   *
   * @returns Width of the near clip plane
   */ getNearPlaneWidth() {
        if (this.isPerspective()) {
            return 2 * this.getNearPlane() / this[0];
        } else {
            return 2 / this[0];
        }
    }
    /**
   * Get height of the near clip plane.
   *
   * @remarks
   * This method assumes that this is a projection matrix (perspective or orthogonal).
   *
   * @returns Height of the near clip plane
   */ getNearPlaneHeight() {
        if (this.isPerspective()) {
            return 2 * this.getNearPlane() / this[5];
        } else {
            return 2 / this[5];
        }
    }
    /**
   * Get near clip plane.
   *
   * @remarks
   * This method assumes that this is a projection matrix (perspective or orthogonal).
   *
   * @returns The near clip plane
   */ getNearPlane() {
        if (this.isPerspective()) {
            return this[14] / (this[10] - 1);
        } else {
            return (this[14] + 1) / this[10];
        }
    }
    /**
   * Get width of the far clip plane.
   *
   * @remarks
   * This method assumes that this is a projection matrix (perspective or orthogonal).
   *
   * @returns Width of the far clip plane
   */ getFarPlaneWidth() {
        if (this.isPerspective()) {
            return this.getNearPlaneWidth() * this.getFarPlane() / this.getNearPlane();
        } else {
            return this.getNearPlaneWidth();
        }
    }
    /**
   * Get height of the far clip plane.
   *
   * @remarks
   * This method assumes that this is a projection matrix (perspective or orthogonal).
   *
   * @returns Height of the far clip plane
   */ getFarPlaneHeight() {
        if (this.isPerspective()) {
            return this.getNearPlaneHeight() * this.getFarPlane() / this.getNearPlane();
        } else {
            return this.getNearPlaneHeight();
        }
    }
    /**
   * Get far clip plane.
   *
   * @remarks
   * This method assumes that this is a projection matrix (perspective or orthogonal).
   *
   * @returns The far clip plane
   */ getFarPlane() {
        if (this.isPerspective()) {
            return this[14] / (this[10] + 1);
        } else {
            return (this[14] - 1) / this[10];
        }
    }
    /**
   * Get the vertical field of view in radians.
   *
   * @remarks
   * This method assumes that this is a projection matrix (perspective or orthogonal).
   *
   * @returns 0 if this is an orthogonal projection matrix, otherwise the vertical field of view
   */ getFov() {
        // assum this is a projection matrix
        return this.isOrtho() ? 0 : Math.atan(1 / this[5]) * 2;
    }
    /**
   * Get tangent value of half of the vertical field of view.
   *
   * @remarks
   * This method assumes that this is a projection matrix (perspective or orthogonal).
   * If the matrix is orthogonal, 0 is returned.
   *
   * @returns 0 if this is an orthogonal projection matrix, otherwise the tangent value of half of the vertical field of view
   */ getTanHalfFov() {
        // assum this is a projection matrix
        return this.isOrtho() ? 0 : 1 / this[5];
    }
    /**
   * Get the aspect ratio.
   *
   * @remarks
   * This method assumes that the matrix is a perspective projection matrix.
   *
   * @returns The aspect ratio
   */ getAspect() {
        // assum this is a projection matrix
        return this[5] / this[0];
    }
    /**
   * Get the left clip plane.
   *
   * @remarks
   * This method assumes that the matrix is an orthogonal projection matrix.
   *
   * @returns The left clip plane
   */ getLeftPlane() {
        if (this.isPerspective()) {
            return (this[8] - 1) * this.getNearPlane() / this[0];
        } else {
            return (-1 - this[12]) / this[0];
        }
    }
    /**
   * Get the right clip plane.
   *
   * @remarks
   * This method assumes that the matrix is an orthogonal projection matrix.
   *
   * @returns The right clip plane
   */ getRightPlane() {
        if (this.isPerspective()) {
            return (this[8] + 1) * this.getNearPlane() / this[0];
        } else {
            return (1 - this[12]) / this[0];
        }
    }
    /**
   * Get the top clip plane.
   *
   * @remarks
   * This method assumes that the matrix is an orthogonal projection matrix.
   *
   * @returns The top clip plane
   */ getTopPlane() {
        if (this.isPerspective()) {
            return (this[9] + 1) * this.getNearPlane() / this[5];
        } else {
            return (1 - this[13]) / this[5];
        }
    }
    /**
   * Get the bottom clip plane.
   *
   * @remarks
   * This method assumes that the matrix is an orthogonal projection matrix.
   *
   * @returns The bottom clip plane
   */ getBottomPlane() {
        if (this.isPerspective()) {
            return (this[9] - 1) * this.getNearPlane() / this[5];
        } else {
            return (-1 - this[13]) / this[5];
        }
    }
    /**
   * Set the near clip plane and far clip plane.
   *
   * @remarks
   * This method assumes that the matrix is a projection matrix (perspective or orthogonal).
   *
   * @param znear - The near clip plane.
   * @param zfar - The far clip plane.
   * @returns self
   */ setNearFar(znear, zfar) {
        if (this.isPerspective()) {
            this.perspective(this.getFov(), this.getAspect(), znear, zfar);
        } else {
            this[10] = 2 / (znear - zfar);
            this[14] = (znear + zfar) / (znear - zfar);
        }
        return this;
    }
    /**
   * Calculate a translation matrix inplace.
   * @param t - The translate vector.
   * @returns self
   */ translation(t) {
        Matrix4x4.translation(t, this);
        return this;
    }
    /**
   * Calculates a translation matrix inplace with individual translation factors.
   * @param tx - The translation of x axis.
   * @param ty - The translation of y axis.
   * @param tz - The translation of z axis.
   * @returns self
   */ translationXYZ(tx, ty, tz) {
        Matrix4x4.translationXYZ(tx, ty, tz, this);
        return this;
    }
    /**
   * Calculates a scale matrix inplace.
   * @param s - The scale vector.
   * @returns self
   */ scaling(s) {
        Matrix4x4.scaling(s, this);
        return this;
    }
    /**
   * Calculates a scale matrix inplace with individual scale factors.
   * @param sx - The scale of x axis.
   * @param sy - The scale of y axis.
   * @param sz - The scale of z axis.
   * @returns self
   */ scalingXYZ(sx, sy, sz) {
        Matrix4x4.scalingXYZ(sx, sy, sz, this);
        return this;
    }
    /**
   * Invert this matrix inplace.
   * @returns self
   */ inplaceInvert() {
        Matrix4x4.invert(this, this);
        return this;
    }
    /**
   * Invert this matrix inplace, assuming this matrix presents an affine transformation.
   * @returns self
   */ inplaceInvertAffine() {
        Matrix4x4.invertAffine(this, this);
        return this;
    }
    /**
   * Calculates the transpose of this matrix inplace.
   * @returns self
   */ transpose() {
        Matrix4x4.transpose(this, this);
        return this;
    }
    /**
   * Post-multiply by a matrix inplace.
   *
   * @remarks
   * this = this * other
   *
   * @param other - The matrix that will be multiplied by.
   * @returns self
   */ multiplyRight(other) {
        Matrix4x4.multiply(this, other, this);
        return this;
    }
    /**
   * Post-multiply by a matrix inplace, assuming both matrices present affine transformations.
   *
   * @remarks
   * this = this * other
   *
   * @param other - The matrix that will be multiplied by.
   * @returns self
   */ multiplyRightAffine(other) {
        Matrix4x4.multiplyAffine(this, other, this);
        return this;
    }
    /**
   * Pre-multiply by a matrix inplace.
   *
   * @remarks
   * this = other * this
   *
   * @param other - The matrix that will be multiplied by.
   * @returns self
   */ multiplyLeft(other) {
        Matrix4x4.multiply(other, this, this);
        return this;
    }
    /**
   * Pre-multiply by a matrix inplace, assuming both matrices present affine transformations.
   *
   * @remarks
   * this = other * this
   *
   * @param other - The matrix that will be multiplied by.
   * @returns self
   */ multiplyLeftAffine(other) {
        Matrix4x4.multiplyAffine(other, this, this);
        return this;
    }
    /**
   * Calculates a rotation around x axis inplace.
   * @param angle - The rotate angle in radians.
   * @returns self
   */ rotationX(angle) {
        Matrix4x4.rotationX(angle, this);
        return this;
    }
    /**
   * Calculates a rotation around y axis inplace.
   * @param angle - The rotate angle in radians.
   * @returns self
   */ rotationY(angle) {
        Matrix4x4.rotationY(angle, this);
        return this;
    }
    /**
   * Calculates a rotation around z axis inplace.
   * @param angle - The rotate angle in radians.
   * @returns self
   */ rotationZ(angle) {
        Matrix4x4.rotationZ(angle, this);
        return this;
    }
    /**
   * Calculates a rotation around a given axis inplace.
   * @param axis - The rotation axis.
   * @param angle - The rotate angle in radians.
   * @returns self
   */ rotation(axis, angle) {
        Matrix4x4.rotation(axis, angle, this);
        return this;
    }
    /**
   * Post-translate by a vector inplace.
   *
   * @remarks
   * this = this * (translate matrix for t)
   *
   * @param t - The translate vector.
   * @returns self
   */ translateRight(t) {
        Matrix4x4.translateRight(this, t, this);
        return this;
    }
    /**
   * Pre-translate by a vector inplace.
   *
   * @remarks
   * this = (translate matrix for t) * this
   *
   * @param t - The translate vector.
   * @returns self
   */ translateLeft(t) {
        Matrix4x4.translateLeft(this, t, this);
        return this;
    }
    /**
   * Post-scale by a vector inplace.
   *
   * @remarks
   * this = this * (scale matrix for s)
   *
   * @param s - The scale vector.
   * @returns self
   */ scaleRight(s) {
        Matrix4x4.scaleRight(this, s, this);
        return this;
    }
    /**
   * Pre-scale by a vector inplace.
   *
   * @remarks
   * this = (scale matrix for s) * this
   *
   * @param s - The scale vector.
   * @returns self
   */ scaleLeft(s) {
        Matrix4x4.scaleLeft(this, s, this);
        return this;
    }
    /**
   * Post-rotate by a rotation matrix or quaternion inplace.
   *
   * @remarks
   * this = this * r
   *
   * @param r - The rotation matrix or quaternion.
   * @returns self
   */ rotateRight(r) {
        Matrix4x4.rotateRight(this, r, this);
        return this;
    }
    /**
   * Pre-rotate by a rotation matrix or quaternion inplace.
   *
   * @remarks
   * this = r * this
   *
   * @param r - The rotation matrix or quaternion.
   * @returns self
   */ rotateLeft(r) {
        Matrix4x4.rotateLeft(this, r, this);
        return this;
    }
    /**
   * Calculates a look-at matrix inplace.
   * @param eye - Position of the eye.
   * @param target - The point that the eye is looking at.
   * @param up - The up vector.
   * @returns self
   */ lookAt(eye, target, up) {
        Matrix4x4.lookAt(eye, target, up, this);
        return this;
    }
    /**
   * Transform a point by this matrix.
   * @param point - The point to be transformed.
   * @param result - The output vector, if not specified, a new vector will be created.
   * @returns The output vector
   */ transformPoint(point, result) {
        result = result || new Vector4();
        return result.setXYZW(this[0] * point[0] + this[4] * point[1] + this[8] * point[2] + this[12], this[1] * point[0] + this[5] * point[1] + this[9] * point[2] + this[13], this[2] * point[0] + this[6] * point[1] + this[10] * point[2] + this[14], this[3] * point[0] + this[7] * point[1] + this[11] * point[2] + this[15]);
    }
    /**
   * Transform a point by this matrix and then do a perspective divide.
   * @param point - The point to be transformed.
   * @param result - The output vector, if not specified, a new vector will be created.
   * @returns The output vector
   */ transformPointP(point, result) {
        result = result || new Vector3();
        const x = this[0] * point[0] + this[4] * point[1] + this[8] * point[2] + this[12];
        const y = this[1] * point[0] + this[5] * point[1] + this[9] * point[2] + this[13];
        const z = this[2] * point[0] + this[6] * point[1] + this[10] * point[2] + this[14];
        const w = this[3] * point[0] + this[7] * point[1] + this[11] * point[2] + this[15];
        return result.setXYZ(x / w, y / w, z / w);
    }
    /**
   * Transform a point by this matrix, assuming this matrix presents an affine transformation.
   * @param point - The point to be transformed.
   * @param result - The output vector (can be the same as point), if not specified, a new vector will be created.
   * @returns The output vector
   */ transformPointAffine(point, result) {
        result = result || new Vector3();
        return result.setXYZ(this[0] * point[0] + this[4] * point[1] + this[8] * point[2] + this[12], this[1] * point[0] + this[5] * point[1] + this[9] * point[2] + this[13], this[2] * point[0] + this[6] * point[1] + this[10] * point[2] + this[14]);
    }
    /**
   * Transform a vector by this matrix.
   * @param vec - The vector to be transformed.
   * @param result - The output vector, if not specified, a new vector will be created.
   * @returns The output vector
   */ transformVector(vec, result) {
        result = result || new Vector4();
        return result.setXYZW(this[0] * vec[0] + this[4] * vec[1] + this[8] * vec[2], this[1] * vec[0] + this[5] * vec[1] + this[9] * vec[2], this[2] * vec[0] + this[6] * vec[1] + this[10] * vec[2], this[3] * vec[0] + this[7] * vec[1] + this[11] * vec[2]);
    }
    /**
   * Transform a vector by this matrix assuming this matrix presents an affine transformation.
   * @param vec - The vector to be transformed.
   * @param result - The output vector (can be the same as vec), if not specified, a new vector will be created.
   * @returns The output vector
   */ transformVectorAffine(vec, result) {
        result = result || new Vector3();
        return result.setXYZ(this[0] * vec[0] + this[4] * vec[1] + this[8] * vec[2], this[1] * vec[0] + this[5] * vec[1] + this[9] * vec[2], this[2] * vec[0] + this[6] * vec[1] + this[10] * vec[2]);
    }
    /**
   * Transform a vector by this matrix and then do a perspective divide.
   * @param vec - The vector to be transformed.
   * @param result - The output vector (can be the same as vec), if not specified, a new vector will be created.
   * @returns The output vector
   */ transformP(vec, result) {
        result = result || new Vector4();
        const x = this[0] * vec[0] + this[4] * vec[1] + this[8] * vec[2] + this[12] * vec[3];
        const y = this[1] * vec[0] + this[5] * vec[1] + this[9] * vec[2] + this[13] * vec[3];
        const z = this[2] * vec[0] + this[6] * vec[1] + this[10] * vec[2] + this[14] * vec[3];
        const w = this[3] * vec[0] + this[7] * vec[1] + this[11] * vec[2] + this[15] * vec[3];
        return result.setXYZW(x / w, y / w, z / w, w);
    }
    /**
   * Transform a vector by this matrix.
   * @param vec - The vector to be transformed.
   * @param result - The output vector (can be the same as vec), if not specified, a new vector will be created.
   * @returns The output vector
   */ transform(vec, result) {
        result = result || new Vector4();
        return result.setXYZW(this[0] * vec[0] + this[4] * vec[1] + this[8] * vec[2] + this[12] * vec[3], this[1] * vec[0] + this[5] * vec[1] + this[9] * vec[2] + this[13] * vec[3], this[2] * vec[0] + this[6] * vec[1] + this[10] * vec[2] + this[14] * vec[3], this[3] * vec[0] + this[7] * vec[1] + this[11] * vec[2] + this[15] * vec[3]);
    }
    /**
   * Transform a vector by this matrix, assuming this matrix presents an affine transformation.
   * @param vec - The vector to be transformed.
   * @param result - The output vector (can be the same as vec), if not specified, a new vector will be created.
   * @returns The output vector
   */ transformAffine(vec, result) {
        result = result || new Vector4();
        return result.setXYZW(this[0] * vec[0] + this[4] * vec[1] + this[8] * vec[2] + this[12] * vec[3], this[1] * vec[0] + this[5] * vec[1] + this[9] * vec[2] + this[13] * vec[3], this[2] * vec[0] + this[6] * vec[1] + this[10] * vec[2] + this[14] * vec[3], vec.w);
    }
    /**
   * Calculates the determinant of this matrix.
   * @returns The determinant
   */ det() {
        const m00 = this[0], m01 = this[1], m02 = this[2], m03 = this[3];
        const m10 = this[4], m11 = this[5], m12 = this[6], m13 = this[7];
        const m20 = this[8], m21 = this[9], m22 = this[10], m23 = this[11];
        const m30 = this[12], m31 = this[13], m32 = this[14], m33 = this[15];
        const det_22_33 = m22 * m33 - m32 * m23;
        const det_21_33 = m21 * m33 - m31 * m23;
        const det_21_32 = m21 * m32 - m31 * m22;
        const det_20_33 = m20 * m33 - m30 * m23;
        const det_20_32 = m20 * m32 - m22 * m30;
        const det_20_31 = m20 * m31 - m30 * m21;
        const cofact_00 = +(m11 * det_22_33 - m12 * det_21_33 + m13 * det_21_32);
        const cofact_01 = -(m10 * det_22_33 - m12 * det_20_33 + m13 * det_20_32);
        const cofact_02 = +(m10 * det_21_33 - m11 * det_20_33 + m13 * det_20_31);
        const cofact_03 = -(m10 * det_21_32 - m11 * det_20_32 + m12 * det_20_31);
        return m00 * cofact_00 + m01 * cofact_01 + m02 * cofact_02 + m03 * cofact_03;
    }
    /**
   * Compose matrix from rotation, translation and scale components.
   * @param scale - The input scale vector.
   * @param rotation - The input rotation matrix or quaternion.
   * @param translation - The input translation vector.
   * @returns self
   */ compose(scale, rotation, translation) {
        Matrix4x4.compose(scale, rotation, translation, this);
        return this;
    }
    /**
   * Decompose this matrix into its rotation, translation and scale components.
   * @param scale - The output scale vector.
   * @param rotation - The output rotation matrix or quaternion.
   * @param translation - The output translation vector.
   * @returns self
   */ decompose(scale, rotation, translation) {
        // translation (last column)
        if (translation) {
            translation.setXYZ(this[12], this[13], this[14]);
        }
        // basis in columns (linear part)
        const c0x = this[0], c0y = this[1], c0z = this[2];
        const c1x = this[4], c1y = this[5], c1z = this[6];
        const c2x = this[8], c2y = this[9], c2z = this[10];
        let sx = Math.hypot(c0x, c0y, c0z);
        let sy = Math.hypot(c1x, c1y, c1z);
        let sz = Math.hypot(c2x, c2y, c2z);
        const eps = 1e-8;
        if (sx < eps || sy < eps || sz < eps) {
            // Degenerate: rotation not well-defined
            if (scale) {
                scale.setXYZ(sx, sy, sz);
            }
            if (rotation instanceof Quaternion) {
                rotation.setXYZW(0, 0, 0, 1);
            } else if (rotation instanceof Matrix3x3) {
                rotation[0] = 1;
                rotation[1] = 0;
                rotation[2] = 0;
                rotation[3] = 0;
                rotation[4] = 1;
                rotation[5] = 0;
                rotation[6] = 0;
                rotation[7] = 0;
                rotation[8] = 1;
            } else if (rotation instanceof Matrix4x4) {
                rotation[0] = 1;
                rotation[1] = 0;
                rotation[2] = 0;
                rotation[3] = 0;
                rotation[4] = 0;
                rotation[5] = 1;
                rotation[6] = 0;
                rotation[7] = 0;
                rotation[8] = 0;
                rotation[9] = 0;
                rotation[10] = 1;
                rotation[11] = 0;
                rotation[12] = 0;
                rotation[13] = 0;
                rotation[14] = 0;
                rotation[15] = 1;
            }
            return this;
        }
        // Build R from normalized columns
        let r0x = c0x / sx, r0y = c0y / sx, r0z = c0z / sx;
        let r1x = c1x / sy, r1y = c1y / sy, r1z = c1z / sy;
        let r2x = c2x / sz, r2y = c2y / sz, r2z = c2z / sz;
        // det(R) = dot(r0, cross(r1, r2))
        const cx = r1y * r2z - r1z * r2y;
        const cy = r1z * r2x - r1x * r2z;
        const cz = r1x * r2y - r1y * r2x;
        const detR = r0x * cx + r0y * cy + r0z * cz;
        if (detR < 0) {
            // Stable normalization: put the minus sign on the largest-magnitude scale axis
            if (sx >= sy && sx >= sz) {
                sx = -sx;
                r0x = -r0x;
                r0y = -r0y;
                r0z = -r0z;
            } else if (sy >= sx && sy >= sz) {
                sy = -sy;
                r1x = -r1x;
                r1y = -r1y;
                r1z = -r1z;
            } else {
                sz = -sz;
                r2x = -r2x;
                r2y = -r2y;
                r2z = -r2z;
            }
        }
        if (scale) {
            scale.setXYZ(sx, sy, sz);
        }
        if (rotation instanceof Quaternion) {
            const rm = new Matrix3x3();
            // columns packed into 3x3
            rm[0] = r0x;
            rm[1] = r0y;
            rm[2] = r0z;
            rm[3] = r1x;
            rm[4] = r1y;
            rm[5] = r1z;
            rm[6] = r2x;
            rm[7] = r2y;
            rm[8] = r2z;
            rotation.fromRotationMatrix(rm);
        } else if (rotation instanceof Matrix3x3) {
            rotation[0] = r0x;
            rotation[1] = r0y;
            rotation[2] = r0z;
            rotation[3] = r1x;
            rotation[4] = r1y;
            rotation[5] = r1z;
            rotation[6] = r2x;
            rotation[7] = r2y;
            rotation[8] = r2z;
        } else if (rotation instanceof Matrix4x4) {
            rotation[0] = r0x;
            rotation[1] = r0y;
            rotation[2] = r0z;
            rotation[3] = 0;
            rotation[4] = r1x;
            rotation[5] = r1y;
            rotation[6] = r1z;
            rotation[7] = 0;
            rotation[8] = r2x;
            rotation[9] = r2y;
            rotation[10] = r2z;
            rotation[11] = 0;
            rotation[12] = 0;
            rotation[13] = 0;
            rotation[14] = 0;
            rotation[15] = 1;
        }
        return this;
    }
    /**
   * Decompose this matrix into a look-at form.
   * @param eye - The output eye vector.
   * @param target - The output target vector.
   * @param up - The output up vector.
   * @returns self
   */ decomposeLookAt(eye, target, up) {
        eye?.setXYZ(this[12], this[13], this[14]);
        up?.setXYZ(this[4], this[5], this[6]);
        target?.setXYZ(this[12] - this[8], this[13] - this[9], this[14] - this[10]);
        return this;
    }
    /** @internal */ toDualQuaternion() {
        const t = new Vector3();
        const r = new Quaternion();
        const s = new Vector3();
        this.decompose(s, r, t);
        const translation = new Quaternion(this.m03 * 0.5, this.m13 * 0.5, this.m23 * 0.5, 0);
        const dual = Quaternion.multiply(translation, r);
        return {
            real: r,
            dual: dual,
            scale: s
        };
    }
}

/**
 * The plane class
 * @public
 */ class Plane extends VectorBase {
    /** @internal */ _px = 0;
    /** @internal */ _py = 0;
    /** @internal */ _pz = 0;
    /** @internal */ _nx = 0;
    /** @internal */ _ny = 0;
    /** @internal */ _nz = 0;
    /** @internal */ _npDirty = false;
    constructor(arg0, arg1, arg2, arg3){
        super(4);
        switch(arguments.length){
            case 0:
                {
                    this[0] = 0;
                    this[1] = 1;
                    this[2] = 0;
                    this[3] = 0;
                    this._npDirty = true;
                    break;
                }
            case 1:
                {
                    this.set(arg0);
                    break;
                }
            case 2:
                {
                    this.initWithOriginNormal(arg0, arg1);
                    break;
                }
            case 3:
                {
                    this.initWithPoints(arg0, arg1, arg2);
                    break;
                }
            case 4:
                {
                    this.setEquation(arg0, arg1, arg2, arg3);
                    break;
                }
            default:
                {
                    console.error('Plane constructor must have 0/2/3/4 arguments');
                }
        }
    }
    /** Get the coefficient A of the plane equation */ get a() {
        return this[0];
    }
    set a(val) {
        this[0] = val;
        this._npDirty = true;
    }
    /** Get the coefficient B of the plane equation */ get b() {
        return this[1];
    }
    set b(val) {
        this[1] = val;
        this._npDirty = true;
    }
    /** Get the coefficient C of the plane equation */ get c() {
        return this[2];
    }
    set c(val) {
        this[2] = val;
        this._npDirty = true;
    }
    /** Get the coefficient D of the plane equation */ get d() {
        return this[3];
    }
    set d(val) {
        this[3] = val;
        this._npDirty = true;
    }
    /** @internal */ get px() {
        if (this._npDirty) {
            this._npDirty = false;
            this._calcNP();
        }
        return this._px;
    }
    /** @internal */ get py() {
        if (this._npDirty) {
            this._npDirty = false;
            this._calcNP();
        }
        return this._py;
    }
    /** @internal */ get pz() {
        if (this._npDirty) {
            this._npDirty = false;
            this._calcNP();
        }
        return this._pz;
    }
    /** @internal */ get nx() {
        if (this._npDirty) {
            this._npDirty = false;
            this._calcNP();
        }
        return this._nx;
    }
    /** @internal */ get ny() {
        if (this._npDirty) {
            this._npDirty = false;
            this._calcNP();
        }
        return this._ny;
    }
    /** @internal */ get nz() {
        if (this._npDirty) {
            this._npDirty = false;
            this._calcNP();
        }
        return this._nz;
    }
    /**
   * Set coefficients of the plane equation.
   * @param other - An array holding the coefficients.
   * @returns self
   */ assign(other) {
        this._npDirty = true;
        super.set(other);
        return this;
    }
    /**
   * Set coefficients of the plane equation.
   * @param a - The coefficient A of the equation
   * @param b - The coefficient B of the equation
   * @param c - The coefficient C of the equation
   * @param d - The coefficient D of the equation
   * @returns self
   */ setEquation(a, b, c, d) {
        this[0] = a;
        this[1] = b;
        this[2] = c;
        this[3] = d;
        this._npDirty = true;
        return this;
    }
    /**
   * Initialize the plane by normal vector and a point on the plane.
   * @param origin - A point on the plane.
   * @param normal - Normal of the plane.
   * @returns self
   */ initWithOriginNormal(origin, normal) {
        // assume normal is normalized
        return this.setEquation(normal.x, normal.y, normal.z, -Vector3.dot(origin, normal));
    }
    /**
   * Initialize the plane by three points on the plane.
   * @param p0 - The first point.
   * @param p1 - The second point.
   * @param p2 - The third point.
   * @returns self
   */ initWithPoints(p0, p1, p2) {
        const normal = Vector3.cross(Vector3.sub(p1, p0), Vector3.sub(p2, p0)).inplaceNormalize();
        return this.initWithOriginNormal(p0, normal);
    }
    /**
   * Calculate the distance from a point to the plane.
   * @param p - The point
   * @returns The distance value.
   */ distanceToPoint(p) {
        return p.x * this[0] + p.y * this[1] + p.z * this[2] + this[3];
    }
    /**
   * Given a point, calucate the closest point on the plane to that point.
   * @param p - The given point.
   * @param result - A point object to which the result will be written, if not specified, a new point object will be returned.
   * @returns The result value.
   */ nearestPointToPoint(p, result) {
        const d = this.distanceToPoint(p);
        return (result || new Vector3()).setXYZ(p.x - this[0] * d, p.y - this[1] * d, p.z - this[2] * d);
    }
    /**
   * Get normal vector of the plane.
   * @param result - A vector object to which the result will be written, if not specified, a new vector will be returned.
   * @returns The result vector.
   */ getNormal(result) {
        return (result || new Vector3()).setXYZ(this[0], this[1], this[2]);
    }
    /** Inplace flip the normal vector . */ inplaceFlip() {
        return Plane.flip(this, this);
    }
    /** Inplace normalize the plane equation. */ inplaceNormalize() {
        return Plane.normalize(this, this);
    }
    /**
   * Create a new plane object by flipping another plane's normal.
   * @param plane - The plane to which the normal will be flipped.
   * @param result - A plane object to which the result will be written, if not specified, a new plane object will be returned.
   * @returns The result plane.
   */ static flip(plane, result) {
        return (result || new Plane()).setEquation(-plane[0], -plane[1], -plane[2], -plane[3]);
    }
    /**
   * Create a new plane object by normalizing another plane.
   * @param plane - The plane that will be normalized.
   * @param result - A plane object to which the result will be written, if not specified, a new plane object will be returned.
   * @returns The result plane.
   */ static normalize(plane, result) {
        const len = Math.hypot(plane[0], plane[1], plane[2]);
        return (result || new Plane()).setEquation(plane[0] / len, plane[1] / len, plane[2] / len, plane[3] / len);
    }
    /**
   * Create a new plane object by transforming another plane.
   * @param plane - The plane that will be transformed.
   * @param matrix - The transform matrix.
   * @param result - A plane object to which the result will be written, if not specified, a new plane object will be returned.
   * @returns The result plane.
   */ static transform(plane, matrix, result) {
        const adjMatrix = Matrix4x4.transpose(Matrix4x4.invertAffine(matrix));
        const p = adjMatrix.transform(new Vector4(plane[0], plane[1], plane[2], plane[3]));
        const ret = result || plane;
        ret.setEquation(p.x, p.y, p.z, p.w);
        return ret.inplaceNormalize();
    }
    /** @internal */ _calcNP() {
        this._px = this[0] > 0 ? 1 : -1;
        this._py = this[1] > 0 ? 1 : -1;
        this._pz = this[2] > 0 ? 1 : -1;
        this._nx = -this._px;
        this._ny = -this._py;
        this._nz = -this._pz;
    }
}

const nnn = [
    -1,
    -1,
    -1
];
const nnp = [
    -1,
    -1,
    1
];
const npn = [
    -1,
    1,
    -1
];
const npp = [
    -1,
    1,
    1
];
const pnn = [
    1,
    -1,
    -1
];
const pnp = [
    1,
    -1,
    1
];
const ppn = [
    1,
    1,
    -1
];
const ppp = [
    1,
    1,
    1
];
const ndcVertices = [
    nnn,
    nnp,
    npn,
    npp,
    pnn,
    pnp,
    ppn,
    ppp
];
/**
 * The frustum class
 *
 * @public
 */ class Frustum {
    static CORNER_LEFT_TOP_NEAR = 0b000;
    static CORNER_LEFT_TOP_FAR = 0b001;
    static CORNER_LEFT_BOTTOM_NEAR = 0b010;
    static CORNER_LEFT_BOTTOM_FAR = 0b011;
    static CORNER_RIGHT_TOP_NEAR = 0b100;
    static CORNER_RIGHT_TOP_FAR = 0b101;
    static CORNER_RIGHT_BOTTOM_NEAR = 0b110;
    static CORNER_RIGHT_BOTTOM_FAR = 0b111;
    /** @internal */ _planes;
    /** @internal */ _corners;
    constructor(arg0){
        if (arg0 instanceof Frustum) {
            this._planes = arg0._planes.map((plane)=>new Plane(plane));
            this._corners = arg0._corners.map((vec)=>new Vector3(vec));
        } else {
            this.initWithMatrix(arg0);
        }
    }
    /**
   * Get the frustum planes.
   */ get planes() {
        return this._planes;
    }
    /**
   * Get the corner points.
   */ get corners() {
        return this._corners;
    }
    /**
   * Get the point of a given corner.
   *
   * @remarks
   * The possible values of argument 'pos' are:
   * <ul>
   * <li>{@link Frustum.CORNER_LEFT_TOP_NEAR}</li>
   * <li>{@link Frustum.CORNER_LEFT_TOP_FAR}</li>
   * <li>{@link Frustum.CORNER_RIGHT_BOTTOM_FAR}</li>
   * <li>{@link Frustum.CORNER_RIGHT_BOTTOM_NEAR}</li>
   * <li>{@link Frustum.CORNER_LEFT_BOTTOM_NEAR}</li>
   * <li>{@link Frustum.CORNER_LEFT_BOTTOM_FAR}</li>
   * <li>{@link Frustum.CORNER_RIGHT_BOTTOM_FAR}</li>
   * <li>{@link Frustum.CORNER_RIGHT_BOTTOM_NEAR}</li>
   * </ul>
   *
   * @param pos - The corner index.
   *
   * @returns The point of given corner
   */ getCorner(pos) {
        return this.corners[pos];
    }
    /**
   * Tests if a point is inside the frustum.
   *
   * @param pt - The point to test.
   * @returns true if the point is inside the frustum, otherwise false
   */ containsPoint(pt, epsl = 1e-6) {
        for (const p of this.planes){
            if (p.distanceToPoint(pt) < -epsl) {
                return false;
            }
        }
        return true;
    }
    /**
   * Initialize the frustum by given model-view matrix
   * @param transform - Model-view matrix used to initialize the frustum
   * @returns self
   */ initWithMatrix(transform) {
        this._planes = this._planes || Array.from({
            length: 6
        }).map(()=>new Plane());
        this._planes[BoxSide.LEFT].setEquation(transform.m30 + transform.m00, transform.m31 + transform.m01, transform.m32 + transform.m02, transform.m33 + transform.m03).inplaceNormalize();
        this._planes[BoxSide.RIGHT].setEquation(transform.m30 - transform.m00, transform.m31 - transform.m01, transform.m32 - transform.m02, transform.m33 - transform.m03).inplaceNormalize();
        this._planes[BoxSide.BOTTOM].setEquation(transform.m30 + transform.m10, transform.m31 + transform.m11, transform.m32 + transform.m12, transform.m33 + transform.m13).inplaceNormalize();
        this._planes[BoxSide.TOP].setEquation(transform.m30 - transform.m10, transform.m31 - transform.m11, transform.m32 - transform.m12, transform.m33 - transform.m13).inplaceNormalize();
        this._planes[BoxSide.FRONT].setEquation(transform.m30 + transform.m20, transform.m31 + transform.m21, transform.m32 + transform.m22, transform.m33 + transform.m23).inplaceNormalize();
        this._planes[BoxSide.BACK].setEquation(transform.m30 - transform.m20, transform.m31 - transform.m21, transform.m32 - transform.m22, transform.m33 - transform.m23).inplaceNormalize();
        const invMatrix = Matrix4x4.invert(transform);
        const vertices = ndcVertices.map((v)=>new Vector3(v[0], v[1], v[2]));
        this._corners = this._corners || [];
        for(let i = 0; i < 8; i++){
            const v = invMatrix.transformPoint(vertices[i]);
            this._corners[i] = v.scaleBy(1 / v.w).xyz();
        }
        return this;
    }
}

/**
 * Axis aligned bounding box
 * @public
 */ class AABB {
    /** Clip to the left side */ static ClipLeft = 1 << BoxSide.LEFT;
    /** Clip to the right side */ static ClipRight = 1 << BoxSide.RIGHT;
    /** Clip to the bottom side */ static ClipBottom = 1 << BoxSide.BOTTOM;
    /** Clip to the top side */ static ClipTop = 1 << BoxSide.TOP;
    /** Clip to the front side */ static ClipFront = 1 << BoxSide.FRONT;
    /** Clip to the back side */ static ClipBack = 1 << BoxSide.BACK;
    /** @internal */ _minPoint;
    /** @internal */ _maxPoint;
    constructor(arg0, arg1){
        if (arg0 instanceof AABB) {
            this._minPoint = new Vector3(arg0.minPoint);
            this._maxPoint = new Vector3(arg0.maxPoint);
        } else if (arg0 instanceof Vector3) {
            this._minPoint = new Vector3(arg0);
            this._maxPoint = new Vector3(arg1);
        } else {
            this._minPoint = new Vector3(-1, -1, -1);
            this._maxPoint = new Vector3(1, 1, 1);
        }
    }
    /** Get the min point of the AABB. */ get minPoint() {
        return this._minPoint;
    }
    set minPoint(p) {
        this._minPoint.set(p);
    }
    /** Get the max point of the AABB. */ get maxPoint() {
        return this._maxPoint;
    }
    set maxPoint(p) {
        this._maxPoint.set(p);
    }
    /** Get half size of the AABB. */ get extents() {
        return Vector3.sub(this._maxPoint, this._minPoint).scaleBy(0.5);
    }
    /** Get center point of the AABB. */ get center() {
        return Vector3.add(this._maxPoint, this._minPoint).scaleBy(0.5);
    }
    /** Get size of the AABB. */ get size() {
        return Vector3.sub(this._maxPoint, this._minPoint);
    }
    /** Get the diagonal length of the AABB. */ get diagonalLength() {
        return Vector3.sub(this._maxPoint, this._minPoint).magnitude;
    }
    /**
   * Calculate the coordinates of the eight corners of the AABB.
   * @returns the coordinates of the eight corners of the AABB.
   */ computePoints() {
        const { x: minx, y: miny, z: minz } = this._minPoint;
        const { x: maxx, y: maxy, z: maxz } = this._maxPoint;
        return [
            new Vector3(minx, miny, minz),
            new Vector3(minx, maxy, minz),
            new Vector3(maxx, miny, minz),
            new Vector3(maxx, maxy, minz),
            new Vector3(minx, miny, maxz),
            new Vector3(minx, maxy, maxz),
            new Vector3(maxx, miny, maxz),
            new Vector3(maxx, maxy, maxz)
        ];
    }
    /**
   * Inplace transform the AABB.
   * @param matrix - The transform matrix.
   * @returns self
   */ inplaceTransform(matrix) {
        AABB.transform(this, matrix, this);
        return this;
    }
    /**
   * Invalidate the min/max point so that we can start extending the AABB.
   * @returns self
   **/ beginExtend() {
        this._minPoint.setXYZ(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
        this._maxPoint.setXYZ(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY);
        return this;
    }
    /**
   * Extend the AABB so that it can contain specified point.
   * @param v - The point used to extend the AABB.
   * @returns self
   */ extend(v) {
        this._minPoint.inplaceMin(v);
        this._maxPoint.inplaceMax(v);
        return this;
    }
    /**
   * Extend the AABB so that it can contain specified point.
   * @param x - The x coordinate of the point.
   * @param y - The y coordinate of the point.
   * @param z - The z coordinate of the point.
   * @returns self
   */ extend3(x, y, z) {
        if (x < this._minPoint.x) {
            this._minPoint.x = x;
        }
        if (x > this._maxPoint.x) {
            this._maxPoint.x = x;
        }
        if (y < this._minPoint.y) {
            this._minPoint.y = y;
        }
        if (y > this._maxPoint.y) {
            this._maxPoint.y = y;
        }
        if (z < this._minPoint.z) {
            this._minPoint.z = z;
        }
        if (z > this._maxPoint.z) {
            this._maxPoint.z = z;
        }
        return this;
    }
    /**
   * Merge the AABB with another AABB.
   * @param other - The AABB to be merged with.
   * @returns self
   */ union(other) {
        if (other && other.isValid()) {
            this.extend(other._minPoint);
            this.extend(other._maxPoint);
        }
        return this;
    }
    /**
   * Check if the AABB is valid.
   * @returns true if the AABB is valid, otherwise false.
   */ isValid() {
        return this._minPoint.x <= this._maxPoint.x && this._minPoint.y <= this._maxPoint.y && this._minPoint.z <= this._maxPoint.z;
    }
    /**
   * Check if the AABB is close enough to another AABB.
   * @param other - The AABB to be compared with.
   * @param epsl - The epsilon for comparison.
   * @returns true if the comparison error is less than epsl, otherwise false.
   */ equalsTo(other, epsl) {
        return this._minPoint.equalsTo(other._minPoint, epsl) && this._maxPoint.equalsTo(other._maxPoint, epsl);
    }
    /**
   * Check if the AABB intersects with another AABB.
   * @param other - The destination AABB.
   * @returns true if the AABB intersects with other, otherwise false.
   */ intersectedWithBox(other) {
        return !(this._maxPoint.x <= other._minPoint.x || this._minPoint.x >= other._maxPoint.x || this._maxPoint.y <= other._minPoint.y || this._minPoint.y >= other._maxPoint.y || this._maxPoint.z <= other._minPoint.z || this._minPoint.z >= other._maxPoint.z);
    }
    /**
   * Check if the box contains specified point.
   * @param pt - The point to be checked.
   * @returns true if the box contains the point, otherwise false.s
   */ containsPoint(pt) {
        return this._minPoint.x <= pt.x && this._maxPoint.x >= pt.x && this._minPoint.y <= pt.y && this._maxPoint.y >= pt.y && this._minPoint.z <= pt.z && this._maxPoint.z >= pt.z;
    }
    /**
   * Check if the AABB contains all of the eight corner point of another AABB
   * @param other - The AABB to be checked.
   * @returns true if all contains, otherwise false.
   */ containsBox(other) {
        return this._minPoint.x <= other._minPoint.x && this._maxPoint.x >= other._maxPoint.x && this._minPoint.y <= other._minPoint.y && this._maxPoint.y >= other._maxPoint.y && this._minPoint.z <= other._minPoint.z && this._maxPoint.z >= other._maxPoint.z;
    }
    /**
   * Do a clip test at the AABB and a frustum.
   * @param viewProjMatrix - The view projection matrix of the frustum.
   * @param mask - The frustum planes that needs to be tested.
   * @returns The clip test result.
   */ getClipStateMask(viewProjMatrix, mask) {
        let andFlags = 0xffff;
        let orFlags = 0;
        const v0 = new Vector3();
        const v1 = new Vector4();
        const clipLeft = mask & AABB.ClipLeft;
        const clipRight = mask & AABB.ClipRight;
        const clipTop = mask & AABB.ClipTop;
        const clipBottom = mask & AABB.ClipBottom;
        const clipNear = mask & AABB.ClipFront;
        const clipFar = mask & AABB.ClipBack;
        const minPoint = this._minPoint;
        const maxPoint = this._maxPoint;
        for(let i = 0; i < 8; i++){
            let clip = 0;
            v0.setXYZ(i & 1 ? minPoint.x : maxPoint.x, i & 2 ? minPoint.y : maxPoint.y, i & 3 ? minPoint.z : maxPoint.z);
            viewProjMatrix.transformPoint(v0, v1);
            if (clipLeft && v1.x < -v1.w) {
                clip |= AABB.ClipLeft;
            } else if (clipRight && v1.x > v1.w) {
                clip |= AABB.ClipRight;
            }
            if (clipBottom && v1.y < -v1.w) {
                clip |= AABB.ClipBottom;
            } else if (clipTop && v1.y > v1.w) {
                clip |= AABB.ClipTop;
            }
            if (clipFar && v1.z < -v1.w) {
                clip |= AABB.ClipBack;
            } else if (clipNear && v1.z > v1.w) {
                clip |= AABB.ClipFront;
            }
            andFlags &= clip;
            orFlags |= clip;
        }
        if (orFlags === 0) {
            return ClipState.A_INSIDE_B;
        } else if (andFlags !== 0) {
            return ClipState.NOT_CLIPPED;
        } else {
            return ClipState.CLIPPED;
        }
    }
    /**
   * Do a clip test at the AABB and a frustum.
   * @param viewProjMatrix - The view projection matrix of the frustum.
   * @returns The clip test result.
   */ getClipState(viewProjMatrix) {
        let andFlags = 0xffff;
        let orFlags = 0;
        const v0 = new Vector3();
        const v1 = new Vector4();
        const minPoint = this._minPoint;
        const maxPoint = this._maxPoint;
        for(let i = 0; i < 8; i++){
            let clip = 0;
            v0.setXYZ(i & 1 ? minPoint.x : maxPoint.x, i & 2 ? minPoint.y : maxPoint.y, i & 3 ? minPoint.z : maxPoint.z);
            viewProjMatrix.transformPoint(v0, v1);
            if (v1.x < -v1.w) {
                clip |= AABB.ClipLeft;
            } else if (v1.x > v1.w) {
                clip |= AABB.ClipRight;
            }
            if (v1.y < -v1.w) {
                clip |= AABB.ClipBottom;
            } else if (v1.y > v1.w) {
                clip |= AABB.ClipTop;
            }
            if (v1.z < -v1.w) {
                clip |= AABB.ClipBack;
            } else if (v1.z > v1.w) {
                clip |= AABB.ClipFront;
            }
            andFlags &= clip;
            orFlags |= clip;
        }
        if (orFlags === 0) {
            return ClipState.A_INSIDE_B;
        } else if (andFlags !== 0) {
            return ClipState.NOT_CLIPPED;
        } else {
            return ClipState.CLIPPED;
        }
    }
    /**
   * Check if the box is behind a plane.
   * @param p - The plane to be tested.
   * @returns true if the box is behind the plane, otherwise false.
   */ behindPlane(p) {
        const cx = (this._maxPoint.x + this._minPoint.x) * 0.5;
        const cy = (this._maxPoint.y + this._minPoint.y) * 0.5;
        const cz = (this._maxPoint.z + this._minPoint.z) * 0.5;
        const ex = this._maxPoint.x - cx;
        const ey = this._maxPoint.y - cy;
        const ez = this._maxPoint.z - cz;
        return p.a * (cx + p.px * ex) + p.b * (cy + p.py * ey) + p.c * (cz + p.pz * ez) + p.d < 0;
    }
    /**
   * Do a clip test at the AABB and a frustum.
   * @param frustum - The frustum object.
   * @returns The clip test result.
   */ getClipStateWithFrustum(frustum) {
        let badIntersect = false;
        const cx = (this._maxPoint.x + this._minPoint.x) * 0.5;
        const cy = (this._maxPoint.y + this._minPoint.y) * 0.5;
        const cz = (this._maxPoint.z + this._minPoint.z) * 0.5;
        const ex = this._maxPoint.x - cx;
        const ey = this._maxPoint.y - cy;
        const ez = this._maxPoint.z - cz;
        for(let i = 0; i < 6; i++){
            const p = frustum.planes[i];
            if (p.a * (cx + p.px * ex) + p.b * (cy + p.py * ey) + p.c * (cz + p.pz * ez) + p.d < 0) {
                return ClipState.NOT_CLIPPED;
            }
            if (p.a * (cx + p.nx * ex) + p.b * (cy + p.ny * ey) + p.c * (cz + p.nz * ez) + p.d < 0) {
                badIntersect = true;
            }
        }
        return badIntersect ? ClipState.CLIPPED : ClipState.A_INSIDE_B;
    }
    /**
   * Do a clip test at the AABB and a frustum.
   * @param frustum - The frustum object.
   * @param mask - The frustum planes that needs to be tested.
   * @returns The clip test result.
   */ getClipStateWithFrustumMask(frustum, mask) {
        let badIntersect = false;
        const cx = (this._maxPoint.x + this._minPoint.x) * 0.5;
        const cy = (this._maxPoint.y + this._minPoint.y) * 0.5;
        const cz = (this._maxPoint.z + this._minPoint.z) * 0.5;
        const ex = this._maxPoint.x - cx;
        const ey = this._maxPoint.y - cy;
        const ez = this._maxPoint.z - cz;
        for(let i = 0; i < 6; i++){
            if (mask & 1 << i) {
                const p = frustum.planes[i];
                if (p.a * (cx + p.px * ex) + p.b * (cy + p.py * ey) + p.c * (cz + p.pz * ez) + p.d < 0) {
                    return ClipState.NOT_CLIPPED;
                }
                if (p.a * (cx + p.nx * ex) + p.b * (cy + p.ny * ey) + p.c * (cz + p.nz * ez) + p.d < 0) {
                    badIntersect = true;
                }
            }
        }
        return badIntersect ? ClipState.CLIPPED : ClipState.A_INSIDE_B;
    }
    /**
   * Get an AABB by transforming another AABB
   * @param bbox - The AABB to be transformed.
   * @param matrix - The transform matrix.
   * @param result - The out AABB to be write to.
   * @returns The out AABB.
   */ static transform(bbox, matrix, result) {
        const ret = result || new AABB();
        const minp = [
            0,
            0,
            0
        ];
        const maxp = [
            0,
            0,
            0
        ];
        const v1 = bbox.minPoint;
        const v2 = bbox.maxPoint;
        let r;
        for(let col = 0; col < 3; ++col){
            r = col;
            minp[col] = maxp[col] = matrix[12 + col];
            for(let row = 0; row < 3; ++row){
                const e = matrix[r] * v1[row];
                const f = matrix[r] * v2[row];
                if (e < f) {
                    minp[col] += e;
                    maxp[col] += f;
                } else {
                    minp[col] += f;
                    maxp[col] += e;
                }
                r += 4;
            }
        }
        ret.minPoint.set(minp);
        ret.maxPoint.set(maxp);
        return ret;
    }
}

// reduce GC
const tmpV0 = new Vector3();
const tmpV1 = new Vector3();
const tmpV2 = new Vector3();
const tmpV3 = new Vector3();
const tmpV4 = new Vector3();
/**
 * The ray class
 * @public
 */ class Ray {
    /** @internal */ _origin;
    /** @internal */ _direction;
    /** @internal */ _ii = 0;
    /** @internal */ _ij = 0;
    /** @internal */ _ik = 0;
    /** @internal */ _ibyj = 0;
    /** @internal */ _jbyi = 0;
    /** @internal */ _kbyj = 0;
    /** @internal */ _jbyk = 0;
    /** @internal */ _ibyk = 0;
    /** @internal */ _kbyi = 0;
    /** @internal */ _c_xy = 0;
    /** @internal */ _c_xz = 0;
    /** @internal */ _c_yx = 0;
    /** @internal */ _c_yz = 0;
    /** @internal */ _c_zx = 0;
    /** @internal */ _c_zy = 0;
    /**
   * Do a intersection test with an AABB.
   * @param bbox - The box to be test.
   * @returns true if the ray intersect with the box, otherwise false.
   */ bboxIntersectionTest;
    /**
   * Do a intersection test with an AABB.
   * @param bbox - The box to be test.
   * @returns The distance from the origin to intersected point if the ray intersect with the box, otherwise null.
   */ bboxIntersectionTestEx;
    /**
   * Construct a ray from origin and normalized direction vector.
   * @param origin - The ray origin if not specified, zero vector will be used.
   * @param directionNormalized - The normalized direction vector. if not specified, (0, 0, 1) will be used.
   */ constructor(origin, directionNormalized){
        this._origin = origin ? new Vector3(origin) : Vector3.zero();
        this._direction = directionNormalized ? new Vector3(directionNormalized) : Vector3.axisPZ();
        this.prepare();
    }
    /** Get the ray origin point */ get origin() {
        return this._origin;
    }
    /** Get the ray direction vector */ get direction() {
        return this._direction;
    }
    /**
   * Set the ray origin and normalized direction vector.
   * @param origin - The ray origin point.
   * @param directionNormalized - The normalized direction vector.
   */ set(origin, directionNormalized) {
        this._origin.set(origin);
        this._direction.set(directionNormalized);
        this.prepare();
    }
    /**
   * Transform the ray.
   * @param matrix - The transform matrix.
   * @param other - A ray object to which the result will be written, if not specified, a new ray object will be returned.
   * @returns The transform result.
   */ transform(matrix, other) {
        if (other) {
            matrix.transformPointAffine(Vector3.add(this._origin, this._direction), other._direction);
            matrix.transformPointAffine(this._origin, other._origin);
            other._direction.subBy(other._origin).inplaceNormalize();
            /*
      matrix.transformPointAffine(this._origin, other._origin);
      matrix
        .transformPointAffine(Vector3.add(this._origin, this._direction), other._direction)
        .subBy(other._origin)
        .inplaceNormalize();
      */ other.prepare();
        } else {
            const origin = matrix.transformPointAffine(this._origin);
            const direction = matrix.transformPointAffine(Vector3.add(this._origin, this._direction)).subBy(origin).inplaceNormalize();
            other = new Ray(origin, direction);
        }
        return other;
    }
    intersectionTestCircle(center, normal, radius, epsl) {
        const deltaParallel = 1e-1; // 接近平行阈值
        const deltaZero = 1e-12;
        const O = this.origin;
        const D = this.direction;
        const C = center;
        const N = normal;
        const R = radius;
        const w = Vector3.sub(O, C);
        const a = Vector3.dot(D, N);
        const b = Vector3.dot(w, N);
        const closestOnCircleInPlane = (Q)=>{
            const u = Vector3.sub(Q, C);
            const d = u.magnitude;
            if (d < deltaZero) {
                return R;
            } else {
                return Math.abs(d - R);
            }
        };
        if (Math.abs(a) < deltaParallel) {
            const distance = this.intersectionTestSphere(center, radius + Math.abs(epsl));
            if (!distance) {
                return null;
            }
            let t = epsl;
            let d = -1;
            for (const dist of distance){
                const distPlane = Vector3.dot(Vector3.sub(Vector3.add(O, Vector3.scale(D, dist)), center), N);
                if (Math.abs(distPlane) < t) {
                    d = dist;
                    t = Math.abs(distPlane);
                }
            }
            if (d >= 0) {
                return {
                    dist: d,
                    epsl: t
                };
            }
        }
        const tp = -b / a;
        if (tp >= 0) {
            const P = Vector3.add(O, Vector3.scale(D, tp));
            const dCircle = closestOnCircleInPlane(P);
            return dCircle <= epsl ? {
                dist: tp,
                epsl: dCircle
            } : null;
        }
        return null;
    }
    /**
   * Do a ray sphere intersection test
   * @param radius - Sphere radius
   * @returns Distance from origin to the intersected point if the ray intersects with the sphere, otherwise null
   */ intersectionTestSphere(center, radius) {
        const O = Vector3.sub(this._origin, center);
        const a = Vector3.dot(this._direction, this._direction);
        const b = 2 * Vector3.dot(O, this._direction);
        const c = Vector3.dot(O, O) - radius * radius;
        const discriminant = b * b - 4 * a * c;
        if (discriminant < 0) {
            return null;
        }
        const s = Math.sqrt(discriminant);
        let t1 = (-b - s) / (2 * a);
        let t2 = (-b + s) / (2 * a);
        if (t1 > t2) {
            const t = t1;
            t1 = t2;
            t2 = t;
        }
        if (t1 >= 0 || t2 >= 0) {
            const result = [];
            if (t1 >= 0) {
                result.push(t1);
            }
            if (t2 >= 0) {
                result.push(t2);
            }
            return result;
        }
        return null;
    }
    /**
   * Do a ray triangle intersection test.
   * @param v1 - The first triangle vertex.
   * @param v2 - The second triangle vertex.
   * @param v3 - The third triangle vertex.
   * @param cull - Allow back side intersection if true.
   * @returns Distance from origin to the intersected point if the ray intersects with the triangle, otherwise null.
   */ intersectionTestTriangle(v1, v2, v3, cull) {
        const start = this._origin;
        const normal = this._direction;
        const edge1 = Vector3.sub(v2, v1, tmpV0);
        const edge2 = Vector3.sub(v3, v1, tmpV1);
        const pvec = Vector3.cross(normal, edge2, tmpV2);
        const det = Vector3.dot(edge1, pvec);
        if (!cull) {
            if (det > -1e-4 && det < 0.0001) {
                return null;
            }
            const inv_det = 1.0 / det;
            const tvec = Vector3.sub(start, v1, tmpV3);
            const u = inv_det * Vector3.dot(tvec, pvec);
            if (u < 0 || u > 1) {
                return null;
            }
            const qvec = Vector3.cross(tvec, edge1, tmpV4);
            const v = inv_det * Vector3.dot(normal, qvec);
            if (v < 0 || u + v > 1) {
                return null;
            }
            return Vector3.dot(edge2, qvec) * inv_det;
        } else {
            if (det < 0) {
                return null;
            }
            const tvec = Vector3.sub(start, v1, tmpV3);
            const u = Vector3.dot(tvec, pvec);
            if (u < 0 || u > det) {
                return null;
            }
            const qvec = Vector3.cross(tvec, edge1, tmpV4);
            const v = Vector3.dot(normal, qvec);
            if (v < 0 || u + v > det) {
                return null;
            }
            return Vector3.dot(edge2, qvec) / det;
        }
    }
    /** @internal */ qtestMMM(bbox) {
        const x0 = bbox.minPoint.x;
        const y0 = bbox.minPoint.y;
        const z0 = bbox.minPoint.z;
        const x1 = bbox.maxPoint.x;
        const y1 = bbox.maxPoint.y;
        const z1 = bbox.maxPoint.z;
        if (this._origin.x < x0 || this._origin.y < y0 || this._origin.z < z0 || this._jbyi * x0 - y1 + this._c_xy > 0 || this._ibyj * y0 - x1 + this._c_yx > 0 || this._jbyk * z0 - y1 + this._c_zy > 0 || this._kbyj * y0 - z1 + this._c_yz > 0 || this._kbyi * x0 - z1 + this._c_xz > 0 || this._ibyk * z0 - x1 + this._c_zx > 0) {
            return false;
        }
        return true;
    }
    /** @internal */ qtestMMMEx(bbox, axisInfo) {
        if (!this.qtestMMM(bbox)) {
            return null;
        }
        let t = (bbox.maxPoint.x - this._origin.x) * this._ii;
        let axis = CubeFace.PX;
        const t1 = (bbox.maxPoint.y - this._origin.y) * this._ij;
        if (t1 > t) {
            t = t1;
            axis = CubeFace.PY;
        }
        const t2 = (bbox.maxPoint.z - this._origin.z) * this._ik;
        if (t2 > t) {
            t = t2;
            axis = CubeFace.PZ;
        }
        if (axisInfo) {
            axisInfo.axis = axis;
        }
        return t;
    }
    /** @internal */ qtestMMP(bbox) {
        const x0 = bbox.minPoint.x;
        const y0 = bbox.minPoint.y;
        const z0 = bbox.minPoint.z;
        const x1 = bbox.maxPoint.x;
        const y1 = bbox.maxPoint.y;
        const z1 = bbox.maxPoint.z;
        if (this._origin.x < x0 || this._origin.y < y0 || this._origin.z > z1 || this._jbyi * x0 - y1 + this._c_xy > 0 || this._ibyj * y0 - x1 + this._c_yx > 0 || this._jbyk * z1 - y1 + this._c_zy > 0 || this._kbyj * y0 - z0 + this._c_yz < 0 || this._kbyi * x0 - z0 + this._c_xz < 0 || this._ibyk * z1 - x1 + this._c_zx > 0) {
            return false;
        }
        return true;
    }
    /** @internal */ qtestMMPEx(bbox, axisInfo) {
        if (!this.qtestMMP(bbox)) {
            return null;
        }
        let t = (bbox.maxPoint.x - this._origin.x) * this._ii;
        let axis = CubeFace.PX;
        const t1 = (bbox.maxPoint.y - this._origin.y) * this._ij;
        if (t1 > t) {
            t = t1;
            axis = CubeFace.PY;
        }
        const t2 = (bbox.minPoint.z - this._origin.z) * this._ik;
        if (t2 > t) {
            t = t2;
            axis = CubeFace.NZ;
        }
        if (axisInfo) {
            axisInfo.axis = axis;
        }
        return t;
    }
    /** @internal */ qtestMPM(bbox) {
        const x0 = bbox.minPoint.x;
        const y0 = bbox.minPoint.y;
        const z0 = bbox.minPoint.z;
        const x1 = bbox.maxPoint.x;
        const y1 = bbox.maxPoint.y;
        const z1 = bbox.maxPoint.z;
        if (this._origin.x < x0 || this._origin.y > y1 || this._origin.z < z0 || this._jbyi * x0 - y0 + this._c_xy < 0 || this._ibyj * y1 - x1 + this._c_yx > 0 || this._jbyk * z0 - y0 + this._c_zy < 0 || this._kbyj * y1 - z1 + this._c_yz > 0 || this._kbyi * x0 - z1 + this._c_xz > 0 || this._ibyk * z0 - x1 + this._c_zx > 0) {
            return false;
        }
        return true;
    }
    /** @internal */ qtestMPMEx(bbox, axisInfo) {
        if (!this.qtestMPM(bbox)) {
            return null;
        }
        let t = (bbox.maxPoint.x - this._origin.x) * this._ii;
        let axis = CubeFace.PX;
        const t1 = (bbox.minPoint.y - this._origin.y) * this._ij;
        if (t1 > t) {
            t = t1;
            axis = CubeFace.NY;
        }
        const t2 = (bbox.maxPoint.z - this._origin.z) * this._ik;
        if (t2 > t) {
            t = t2;
            axis = CubeFace.PZ;
        }
        if (axisInfo) {
            axisInfo.axis = axis;
        }
        return t;
    }
    /** @internal */ qtestMPP(bbox) {
        const x0 = bbox.minPoint.x;
        const y0 = bbox.minPoint.y;
        const z0 = bbox.minPoint.z;
        const x1 = bbox.maxPoint.x;
        const y1 = bbox.maxPoint.y;
        const z1 = bbox.maxPoint.z;
        if (this._origin.x < x0 || this._origin.y > y1 || this._origin.z > z1 || this._jbyi * x0 - y0 + this._c_xy < 0 || this._ibyj * y1 - x1 + this._c_yx > 0 || this._jbyk * z1 - y0 + this._c_zy < 0 || this._kbyj * y1 - z0 + this._c_yz < 0 || this._kbyi * x0 - z0 + this._c_xz < 0 || this._ibyk * z1 - x1 + this._c_zx > 0) {
            return false;
        }
        return true;
    }
    /** @internal */ qtestMPPEx(bbox, axisInfo) {
        if (!this.qtestMPP(bbox)) {
            return null;
        }
        let t = (bbox.maxPoint.x - this._origin.x) * this._ii;
        let axis = CubeFace.PX;
        const t1 = (bbox.minPoint.y - this._origin.y) * this._ij;
        if (t1 > t) {
            t = t1;
            axis = CubeFace.NY;
        }
        const t2 = (bbox.minPoint.z - this._origin.z) * this._ik;
        if (t2 > t) {
            t = t2;
            axis = CubeFace.NZ;
        }
        if (axisInfo) {
            axisInfo.axis = axis;
        }
        return t;
    }
    /** @internal */ qtestPMM(bbox) {
        const x0 = bbox.minPoint.x;
        const y0 = bbox.minPoint.y;
        const z0 = bbox.minPoint.z;
        const x1 = bbox.maxPoint.x;
        const y1 = bbox.maxPoint.y;
        const z1 = bbox.maxPoint.z;
        if (this._origin.x > x1 || this._origin.y < y0 || this._origin.z < z0 || this._jbyi * x1 - y1 + this._c_xy > 0 || this._ibyj * y0 - x0 + this._c_yx < 0 || this._jbyk * z0 - y1 + this._c_zy > 0 || this._kbyj * y0 - z1 + this._c_yz > 0 || this._kbyi * x1 - z1 + this._c_xz > 0 || this._ibyk * z0 - x0 + this._c_zx < 0) {
            return false;
        }
        return true;
    }
    /** @internal */ qtestPMMEx(bbox, axisInfo) {
        if (!this.qtestPMM(bbox)) {
            return null;
        }
        let t = (bbox.minPoint.x - this._origin.x) * this._ii;
        let axis = CubeFace.NX;
        const t1 = (bbox.maxPoint.y - this._origin.y) * this._ij;
        if (t1 > t) {
            t = t1;
            axis = CubeFace.PY;
        }
        const t2 = (bbox.maxPoint.z - this._origin.z) * this._ik;
        if (t2 > t) {
            t = t2;
            axis = CubeFace.PZ;
        }
        if (axisInfo) {
            axisInfo.axis = axis;
        }
        return t;
    }
    /** @internal */ qtestPMP(bbox) {
        const x0 = bbox.minPoint.x;
        const y0 = bbox.minPoint.y;
        const z0 = bbox.minPoint.z;
        const x1 = bbox.maxPoint.x;
        const y1 = bbox.maxPoint.y;
        const z1 = bbox.maxPoint.z;
        if (this._origin.x > x1 || this._origin.y < y0 || this._origin.z > z1 || this._jbyi * x1 - y1 + this._c_xy > 0 || this._ibyj * y0 - x0 + this._c_yx < 0 || this._jbyk * z1 - y1 + this._c_zy > 0 || this._kbyj * y0 - z0 + this._c_yz < 0 || this._kbyi * x1 - z0 + this._c_xz < 0 || this._ibyk * z1 - x0 + this._c_zx < 0) {
            return false;
        }
        return true;
    }
    /** @internal */ qtestPMPEx(bbox, axisInfo) {
        if (!this.qtestPMP(bbox)) {
            return null;
        }
        let t = (bbox.minPoint.x - this._origin.x) * this._ii;
        let axis = CubeFace.NX;
        const t1 = (bbox.maxPoint.y - this._origin.y) * this._ij;
        if (t1 > t) {
            t = t1;
            axis = CubeFace.PY;
        }
        const t2 = (bbox.minPoint.z - this._origin.z) * this._ik;
        if (t2 > t) {
            t = t2;
            axis = CubeFace.NZ;
        }
        if (axisInfo) {
            axisInfo.axis = axis;
        }
        return t;
    }
    /** @internal */ qtestPPM(bbox) {
        const x0 = bbox.minPoint.x;
        const y0 = bbox.minPoint.y;
        const z0 = bbox.minPoint.z;
        const x1 = bbox.maxPoint.x;
        const y1 = bbox.maxPoint.y;
        const z1 = bbox.maxPoint.z;
        if (this._origin.x > x1 || this._origin.y > y1 || this._origin.z < z0 || this._jbyi * x1 - y0 + this._c_xy < 0 || this._ibyj * y1 - x0 + this._c_yx < 0 || this._jbyk * z0 - y0 + this._c_zy < 0 || this._kbyj * y1 - z1 + this._c_yz > 0 || this._kbyi * x1 - z1 + this._c_xz > 0 || this._ibyk * z0 - x0 + this._c_zx < 0) {
            return false;
        }
        return true;
    }
    /** @internal */ qtestPPMEx(bbox, axisInfo) {
        if (!this.qtestPPM(bbox)) {
            return null;
        }
        let t = (bbox.minPoint.x - this._origin.x) * this._ii;
        let axis = CubeFace.NX;
        const t1 = (bbox.minPoint.y - this._origin.y) * this._ij;
        if (t1 > t) {
            t = t1;
            axis = CubeFace.NY;
        }
        const t2 = (bbox.maxPoint.z - this._origin.z) * this._ik;
        if (t2 > t) {
            t = t2;
            axis = CubeFace.PZ;
        }
        if (axisInfo) {
            axisInfo.axis = axis;
        }
        return t;
    }
    /** @internal */ qtestPPP(bbox) {
        const x0 = bbox.minPoint.x;
        const y0 = bbox.minPoint.y;
        const z0 = bbox.minPoint.z;
        const x1 = bbox.maxPoint.x;
        const y1 = bbox.maxPoint.y;
        const z1 = bbox.maxPoint.z;
        if (this._origin.x > x1 || this._origin.y > y1 || this._origin.z > z1 || this._jbyi * x1 - y0 + this._c_xy < 0 || this._ibyj * y1 - x0 + this._c_yx < 0 || this._jbyk * z1 - y0 + this._c_zy < 0 || this._kbyj * y1 - z0 + this._c_yz < 0 || this._kbyi * x1 - z0 + this._c_xz < 0 || this._ibyk * z1 - x0 + this._c_zx < 0) {
            return false;
        }
        return true;
    }
    /** @internal */ qtestPPPEx(bbox, axisInfo) {
        if (!this.qtestPPP(bbox)) {
            return null;
        }
        let t = (bbox.minPoint.x - this._origin.x) * this._ii;
        let axis = CubeFace.NX;
        const t1 = (bbox.minPoint.y - this._origin.y) * this._ij;
        if (t1 > t) {
            t = t1;
            axis = CubeFace.NY;
        }
        const t2 = (bbox.minPoint.z - this._origin.z) * this._ik;
        if (t2 > t) {
            t = t2;
            axis = CubeFace.NZ;
        }
        if (axisInfo) {
            axisInfo.axis = axis;
        }
        return t;
    }
    /** @internal */ qtestOMM(bbox) {
        const x0 = bbox.minPoint.x;
        const y0 = bbox.minPoint.y;
        const z0 = bbox.minPoint.z;
        const x1 = bbox.maxPoint.x;
        const y1 = bbox.maxPoint.y;
        const z1 = bbox.maxPoint.z;
        if (this._origin.x < x0 || this._origin.x > x1 || this._origin.y < y0 || this._origin.z < z0 || this._jbyk * z0 - y1 + this._c_zy > 0 || this._kbyj * y0 - z1 + this._c_yz > 0) {
            return false;
        }
        return true;
    }
    /** @internal */ qtestOMMEx(bbox, axisInfo) {
        if (!this.qtestOMM(bbox)) {
            return null;
        }
        let t = (bbox.maxPoint.y - this._origin.y) * this._ij;
        let axis = CubeFace.PY;
        const t2 = (bbox.maxPoint.z - this._origin.z) * this._ik;
        if (t2 > t) {
            t = t2;
            axis = CubeFace.PZ;
        }
        if (axisInfo) {
            axisInfo.axis = axis;
        }
        return t;
    }
    /** @internal */ qtestOMP(bbox) {
        const x0 = bbox.minPoint.x;
        const y0 = bbox.minPoint.y;
        const z0 = bbox.minPoint.z;
        const x1 = bbox.maxPoint.x;
        const y1 = bbox.maxPoint.y;
        const z1 = bbox.maxPoint.z;
        if (this._origin.x < x0 || this._origin.x > x1 || this._origin.y < y0 || this._origin.z > z1 || this._jbyk * z1 - y1 + this._c_zy > 0 || this._kbyj * y0 - z0 + this._c_yz < 0) {
            return false;
        }
        return true;
    }
    /** @internal */ qtestOMPEx(bbox, axisInfo) {
        if (!this.qtestOMP(bbox)) {
            return null;
        }
        let t = (bbox.maxPoint.y - this._origin.y) * this._ij;
        let axis = CubeFace.PY;
        const t2 = (bbox.minPoint.z - this._origin.z) * this._ik;
        if (t2 > t) {
            t = t2;
            axis = CubeFace.NZ;
        }
        if (axisInfo) {
            axisInfo.axis = axis;
        }
        return t;
    }
    /** @internal */ qtestOPM(bbox) {
        const x0 = bbox.minPoint.x;
        const y0 = bbox.minPoint.y;
        const z0 = bbox.minPoint.z;
        const x1 = bbox.maxPoint.x;
        const y1 = bbox.maxPoint.y;
        const z1 = bbox.maxPoint.z;
        if (this._origin.x < x0 || this._origin.x > x1 || this._origin.y > y1 || this._origin.z < z0 || this._jbyk * z0 - y0 + this._c_zy < 0 || this._kbyj * y1 - z1 + this._c_yz > 0) {
            return false;
        }
        return true;
    }
    /** @internal */ qtestOPMEx(bbox, axisInfo) {
        if (!this.qtestOPM(bbox)) {
            return null;
        }
        let t = (bbox.minPoint.y - this._origin.y) * this._ij;
        let axis = CubeFace.NY;
        const t2 = (bbox.maxPoint.z - this._origin.z) * this._ik;
        if (t2 > t) {
            t = t2;
            axis = CubeFace.PZ;
        }
        if (axisInfo) {
            axisInfo.axis = axis;
        }
        return t;
    }
    /** @internal */ qtestOPP(bbox) {
        const x0 = bbox.minPoint.x;
        const y0 = bbox.minPoint.y;
        const z0 = bbox.minPoint.z;
        const x1 = bbox.maxPoint.x;
        const y1 = bbox.maxPoint.y;
        const z1 = bbox.maxPoint.z;
        if (this._origin.x < x0 || this._origin.x > x1 || this._origin.y > y1 || this._origin.z > z1 || this._jbyk * z1 - y0 + this._c_zy < 0 || this._kbyj * y1 - z0 + this._c_yz < 0) {
            return false;
        }
        return true;
    }
    /** @internal */ qtestOPPEx(bbox, axisInfo) {
        if (!this.qtestOPP(bbox)) {
            return null;
        }
        let t = (bbox.minPoint.y - this._origin.y) * this._ij;
        let axis = CubeFace.NY;
        const t2 = (bbox.minPoint.z - this._origin.z) * this._ik;
        if (t2 > t) {
            t = t2;
            axis = CubeFace.NZ;
        }
        if (axisInfo) {
            axisInfo.axis = axis;
        }
        return t;
    }
    /** @internal */ qtestMOM(bbox) {
        const x0 = bbox.minPoint.x;
        const y0 = bbox.minPoint.y;
        const z0 = bbox.minPoint.z;
        const x1 = bbox.maxPoint.x;
        const y1 = bbox.maxPoint.y;
        const z1 = bbox.maxPoint.z;
        if (this._origin.y < y0 || this._origin.y > y1 || this._origin.x < x0 || this._origin.z < z0 || this._kbyi * x0 - z1 + this._c_xz > 0 || this._ibyk * z0 - x1 + this._c_zx > 0) {
            return false;
        }
        return true;
    }
    /** @internal */ qtestMOMEx(bbox, axisInfo) {
        if (!this.qtestMOM(bbox)) {
            return null;
        }
        let t = (bbox.maxPoint.x - this._origin.x) * this._ii;
        let axis = CubeFace.PX;
        const t2 = (bbox.maxPoint.z - this._origin.z) * this._ik;
        if (t2 > t) {
            t = t2;
            axis = CubeFace.PZ;
        }
        if (axisInfo) {
            axisInfo.axis = axis;
        }
        return t;
    }
    /** @internal */ qtestMOP(bbox) {
        const x0 = bbox.minPoint.x;
        const y0 = bbox.minPoint.y;
        const z0 = bbox.minPoint.z;
        const x1 = bbox.maxPoint.x;
        const y1 = bbox.maxPoint.y;
        const z1 = bbox.maxPoint.z;
        if (this._origin.y < y0 || this._origin.y > y1 || this._origin.x < x0 || this._origin.z > z1 || this._kbyi * x0 - z0 + this._c_xz < 0 || this._ibyk * z1 - x1 + this._c_zx > 0) {
            return false;
        }
        return true;
    }
    /** @internal */ qtestMOPEx(bbox, axisInfo) {
        if (!this.qtestMOP(bbox)) {
            return null;
        }
        let t = (bbox.maxPoint.x - this._origin.x) * this._ii;
        let axis = CubeFace.PX;
        const t2 = (bbox.minPoint.z - this._origin.z) * this._ik;
        if (t2 > t) {
            t = t2;
            axis = CubeFace.NZ;
        }
        if (axisInfo) {
            axisInfo.axis = axis;
        }
        return t;
    }
    /** @internal */ qtestPOM(bbox) {
        const x0 = bbox.minPoint.x;
        const y0 = bbox.minPoint.y;
        const z0 = bbox.minPoint.z;
        const x1 = bbox.maxPoint.x;
        const y1 = bbox.maxPoint.y;
        const z1 = bbox.maxPoint.z;
        if (this._origin.y < y0 || this._origin.y > y1 || this._origin.x > x1 || this._origin.z < z0 || this._kbyi * x1 - z1 + this._c_xz > 0 || this._ibyk * z0 - x0 + this._c_zx < 0) {
            return false;
        }
        return true;
    }
    /** @internal */ qtestPOMEx(bbox, axisInfo) {
        if (!this.qtestPOM(bbox)) {
            return null;
        }
        let t = (bbox.minPoint.x - this._origin.x) * this._ii;
        let axis = CubeFace.NX;
        const t2 = (bbox.maxPoint.z - this._origin.z) * this._ik;
        if (t2 > t) {
            t = t2;
            axis = CubeFace.PZ;
        }
        if (axisInfo) {
            axisInfo.axis = axis;
        }
        return t;
    }
    /** @internal */ qtestPOP(bbox) {
        const x0 = bbox.minPoint.x;
        const y0 = bbox.minPoint.y;
        const z0 = bbox.minPoint.z;
        const x1 = bbox.maxPoint.x;
        const y1 = bbox.maxPoint.y;
        const z1 = bbox.maxPoint.z;
        if (this._origin.y < y0 || this._origin.y > y1 || this._origin.x > x1 || this._origin.z > z1 || this._kbyi * x1 - z0 + this._c_xz < 0 || this._ibyk * z1 - x0 + this._c_zx < 0) {
            return false;
        }
        return true;
    }
    /** @internal */ qtestPOPEx(bbox, axisInfo) {
        if (!this.qtestPOP(bbox)) {
            return null;
        }
        let t = (bbox.minPoint.x - this._origin.x) * this._ii;
        let axis = CubeFace.NX;
        const t2 = (bbox.minPoint.z - this._origin.z) * this._ik;
        if (t2 > t) {
            t = t2;
            axis = CubeFace.NZ;
        }
        if (axisInfo) {
            axisInfo.axis = axis;
        }
        return t;
    }
    /** @internal */ qtestMMO(bbox) {
        const x0 = bbox.minPoint.x;
        const y0 = bbox.minPoint.y;
        const z0 = bbox.minPoint.z;
        const x1 = bbox.maxPoint.x;
        const y1 = bbox.maxPoint.y;
        const z1 = bbox.maxPoint.z;
        if (this._origin.z < z0 || this._origin.z > z1 || this._origin.x < x0 || this._origin.y < y0 || this._jbyi * x0 - y1 + this._c_xy > 0 || this._ibyj * y0 - x1 + this._c_yx > 0) {
            return false;
        }
        return true;
    }
    /** @internal */ qtestMMOEx(bbox, axisInfo) {
        if (!this.qtestMMO(bbox)) {
            return null;
        }
        let t = (bbox.maxPoint.x - this._origin.x) * this._ii;
        let axis = CubeFace.PX;
        const t2 = (bbox.maxPoint.y - this._origin.y) * this._ij;
        if (t2 > t) {
            t = t2;
            axis = CubeFace.PY;
        }
        if (axisInfo) {
            axisInfo.axis = axis;
        }
        return t;
    }
    /** @internal */ qtestMPO(bbox) {
        const x0 = bbox.minPoint.x;
        const y0 = bbox.minPoint.y;
        const z0 = bbox.minPoint.z;
        const x1 = bbox.maxPoint.x;
        const y1 = bbox.maxPoint.y;
        const z1 = bbox.maxPoint.z;
        if (this._origin.z < z0 || this._origin.z > z1 || this._origin.x < x0 || this._origin.y > y1 || this._jbyi * x0 - y0 + this._c_xy < 0 || this._ibyj * y1 - x1 + this._c_yx > 0) {
            return false;
        }
        return true;
    }
    /** @internal */ qtestMPOEx(bbox, axisInfo) {
        if (!this.qtestMPO(bbox)) {
            return null;
        }
        let t = (bbox.maxPoint.x - this._origin.x) * this._ii;
        let axis = CubeFace.PX;
        const t2 = (bbox.minPoint.y - this._origin.y) * this._ij;
        if (t2 > t) {
            t = t2;
            axis = CubeFace.NY;
        }
        if (axisInfo) {
            axisInfo.axis = axis;
        }
        return t;
    }
    /** @internal */ qtestPMO(bbox) {
        const x0 = bbox.minPoint.x;
        const y0 = bbox.minPoint.y;
        const z0 = bbox.minPoint.z;
        const x1 = bbox.maxPoint.x;
        const y1 = bbox.maxPoint.y;
        const z1 = bbox.maxPoint.z;
        if (this._origin.z < z0 || this._origin.z > z1 || this._origin.x > x1 || this._origin.y < y0 || this._jbyi * x1 - y1 + this._c_xy > 0 || this._ibyj * y0 - x0 + this._c_yx < 0) {
            return false;
        }
        return true;
    }
    /** @internal */ qtestPMOEx(bbox, axisInfo) {
        if (!this.qtestPMO(bbox)) {
            return null;
        }
        let t = (bbox.minPoint.x - this._origin.x) * this._ii;
        let axis = CubeFace.NX;
        const t2 = (bbox.maxPoint.y - this._origin.y) * this._ij;
        if (t2 > t) {
            t = t2;
            axis = CubeFace.PY;
        }
        if (axisInfo) {
            axisInfo.axis = axis;
        }
        return t;
    }
    /** @internal */ qtestPPO(bbox) {
        const x0 = bbox.minPoint.x;
        const y0 = bbox.minPoint.y;
        const z0 = bbox.minPoint.z;
        const x1 = bbox.maxPoint.x;
        const y1 = bbox.maxPoint.y;
        const z1 = bbox.maxPoint.z;
        if (this._origin.z < z0 || this._origin.z > z1 || this._origin.x > x1 || this._origin.y > y1 || this._jbyi * x1 - y0 + this._c_xy < 0 || this._ibyj * y1 - x0 + this._c_yx < 0) {
            return false;
        }
        return true;
    }
    /** @internal */ qtestPPOEx(bbox, axisInfo) {
        if (!this.qtestPPO(bbox)) {
            return null;
        }
        let t = (bbox.minPoint.x - this._origin.x) * this._ii;
        let axis = CubeFace.NX;
        const t2 = (bbox.minPoint.y - this._origin.y) * this._ij;
        if (t2 > t) {
            t = t2;
            axis = CubeFace.NY;
        }
        if (axisInfo) {
            axisInfo.axis = axis;
        }
        return t;
    }
    /** @internal */ qtestMOO(bbox) {
        const x0 = bbox.minPoint.x;
        const y0 = bbox.minPoint.y;
        const z0 = bbox.minPoint.z;
        const y1 = bbox.maxPoint.y;
        const z1 = bbox.maxPoint.z;
        if (this._origin.x < x0 || this._origin.y < y0 || this._origin.y > y1 || this._origin.z < z0 || this._origin.z > z1) {
            return false;
        }
        return true;
    }
    /** @internal */ qtestMOOEx(bbox, axisInfo) {
        if (!this.qtestMOO(bbox)) {
            return null;
        }
        const t = (bbox.maxPoint.x - this._origin.x) * this._ii;
        if (axisInfo) {
            axisInfo.axis = CubeFace.PX;
        }
        return t;
    }
    /** @internal */ qtestPOO(bbox) {
        const y0 = bbox.minPoint.y;
        const z0 = bbox.minPoint.z;
        const x1 = bbox.maxPoint.x;
        const y1 = bbox.maxPoint.y;
        const z1 = bbox.maxPoint.z;
        if (this._origin.x > x1 || this._origin.y < y0 || this._origin.y > y1 || this._origin.z < z0 || this._origin.z > z1) {
            return false;
        }
        return true;
    }
    /** @internal */ qtestPOOEx(bbox, axisInfo) {
        if (!this.qtestPOO(bbox)) {
            return null;
        }
        const t = (bbox.minPoint.x - this._origin.x) * this._ii;
        if (axisInfo) {
            axisInfo.axis = CubeFace.NX;
        }
        return t;
    }
    /** @internal */ qtestOMO(bbox) {
        const x0 = bbox.minPoint.x;
        const y0 = bbox.minPoint.y;
        const z0 = bbox.minPoint.z;
        const x1 = bbox.maxPoint.x;
        const z1 = bbox.maxPoint.z;
        if (this._origin.y < y0 || this._origin.x < x0 || this._origin.x > x1 || this._origin.z < z0 || this._origin.z > z1) {
            return false;
        }
        return true;
    }
    /** @internal */ qtestOMOEx(bbox, axisInfo) {
        if (!this.qtestOMO(bbox)) {
            return null;
        }
        const t = (bbox.maxPoint.y - this._origin.y) * this._ij;
        if (axisInfo) {
            axisInfo.axis = CubeFace.PY;
        }
        return t;
    }
    /** @internal */ qtestOPO(bbox) {
        const x0 = bbox.minPoint.x;
        const z0 = bbox.minPoint.z;
        const x1 = bbox.maxPoint.x;
        const y1 = bbox.maxPoint.y;
        const z1 = bbox.maxPoint.z;
        if (this._origin.y > y1 || this._origin.x < x0 || this._origin.x > x1 || this._origin.z < z0 || this._origin.z > z1) {
            return false;
        }
        return true;
    }
    /** @internal */ qtestOPOEx(bbox, axisInfo) {
        if (!this.qtestOPO(bbox)) {
            return null;
        }
        const t = (bbox.minPoint.y - this._origin.y) * this._ij;
        if (axisInfo) {
            axisInfo.axis = CubeFace.NY;
        }
        return t;
    }
    /** @internal */ qtestOOM(bbox) {
        const x0 = bbox.minPoint.x;
        const y0 = bbox.minPoint.y;
        const z0 = bbox.minPoint.z;
        const x1 = bbox.maxPoint.x;
        const y1 = bbox.maxPoint.y;
        if (this._origin.z < z0 || this._origin.x < x0 || this._origin.x > x1 || this._origin.y < y0 || this._origin.y > y1) {
            return false;
        }
        return true;
    }
    /** @internal */ qtestOOMEx(bbox, axisInfo) {
        if (!this.qtestOOM(bbox)) {
            return null;
        }
        const t = (bbox.maxPoint.z - this._origin.z) * this._ik;
        if (axisInfo) {
            axisInfo.axis = CubeFace.PZ;
        }
        return t;
    }
    /** @internal */ qtestOOP(bbox) {
        const x0 = bbox.minPoint.x;
        const y0 = bbox.minPoint.y;
        const x1 = bbox.maxPoint.x;
        const y1 = bbox.maxPoint.y;
        const z1 = bbox.maxPoint.z;
        if (this._origin.z > z1 || this._origin.x < x0 || this._origin.x > x1 || this._origin.y < y0 || this._origin.y > y1) {
            return false;
        }
        return true;
    }
    /** @internal */ qtestOOPEx(bbox, axisInfo) {
        if (!this.qtestOOP(bbox)) {
            return null;
        }
        const t = (bbox.minPoint.z - this._origin.z) * this._ik;
        if (axisInfo) {
            axisInfo.axis = CubeFace.NZ;
        }
        return t;
    }
    /** @internal */ prepare() {
        const x = this._origin.x;
        const y = this._origin.y;
        const z = this._origin.z;
        const i = this._direction.x;
        const j = this._direction.y;
        const k = this._direction.z;
        this._ii = 1.0 / i;
        this._ij = 1.0 / j;
        this._ik = 1.0 / k;
        this._ibyj = i * this._ij;
        this._jbyi = j * this._ii;
        this._jbyk = j * this._ik;
        this._kbyj = k * this._ij;
        this._ibyk = i * this._ik;
        this._kbyi = k * this._ii;
        this._c_xy = y - this._jbyi * x;
        this._c_xz = z - this._kbyi * x;
        this._c_yx = x - this._ibyj * y;
        this._c_yz = z - this._kbyj * y;
        this._c_zx = x - this._ibyk * z;
        this._c_zy = y - this._jbyk * z;
        if (i < 0) {
            if (j < 0) {
                if (k < 0) {
                    this.bboxIntersectionTest = this.qtestMMM;
                    this.bboxIntersectionTestEx = this.qtestMMMEx;
                } else if (k > 0) {
                    this.bboxIntersectionTest = this.qtestMMP;
                    this.bboxIntersectionTestEx = this.qtestMMPEx;
                } else {
                    this.bboxIntersectionTest = this.qtestMMO;
                    this.bboxIntersectionTestEx = this.qtestMMOEx;
                }
            } else {
                if (k < 0) {
                    this.bboxIntersectionTest = j > 0 ? this.qtestMPM : this.qtestMOM;
                    this.bboxIntersectionTestEx = j > 0 ? this.qtestMPMEx : this.qtestMOMEx;
                } else {
                    if (j === 0 && k === 0) {
                        this.bboxIntersectionTest = this.qtestMOO;
                        this.bboxIntersectionTestEx = this.qtestMOOEx;
                    } else if (k === 0) {
                        this.bboxIntersectionTest = this.qtestMPO;
                        this.bboxIntersectionTestEx = this.qtestMPOEx;
                    } else if (j === 0) {
                        this.bboxIntersectionTest = this.qtestMOP;
                        this.bboxIntersectionTestEx = this.qtestMOPEx;
                    } else {
                        this.bboxIntersectionTest = this.qtestMPP;
                        this.bboxIntersectionTestEx = this.qtestMPPEx;
                    }
                }
            }
        } else {
            if (j < 0) {
                if (k < 0) {
                    this.bboxIntersectionTest = i > 0 ? this.qtestPMM : this.qtestOMM;
                    this.bboxIntersectionTestEx = i > 0 ? this.qtestPMMEx : this.qtestOMMEx;
                } else {
                    if (i === 0 && k === 0) {
                        this.bboxIntersectionTest = this.qtestOMO;
                        this.bboxIntersectionTestEx = this.qtestOMOEx;
                    } else if (k === 0) {
                        this.bboxIntersectionTest = this.qtestPMO;
                        this.bboxIntersectionTestEx = this.qtestPMOEx;
                    } else if (i === 0) {
                        this.bboxIntersectionTest = this.qtestOMP;
                        this.bboxIntersectionTestEx = this.qtestOMPEx;
                    } else {
                        this.bboxIntersectionTest = this.qtestPMP;
                        this.bboxIntersectionTestEx = this.qtestPMPEx;
                    }
                }
            } else {
                if (k < 0) {
                    if (i === 0 && j === 0) {
                        this.bboxIntersectionTest = this.qtestOOM;
                        this.bboxIntersectionTestEx = this.qtestOOMEx;
                    } else if (i === 0) {
                        this.bboxIntersectionTest = this.qtestOPM;
                        this.bboxIntersectionTestEx = this.qtestOPMEx;
                    } else if (j === 0) {
                        this.bboxIntersectionTest = this.qtestPOM;
                        this.bboxIntersectionTestEx = this.qtestPOMEx;
                    } else {
                        this.bboxIntersectionTest = this.qtestPPM;
                        this.bboxIntersectionTestEx = this.qtestPPMEx;
                    }
                } else {
                    if (i === 0) {
                        if (j === 0) {
                            this.bboxIntersectionTest = this.qtestOOP;
                            this.bboxIntersectionTestEx = this.qtestOOPEx;
                        } else if (k === 0) {
                            this.bboxIntersectionTest = this.qtestOPO;
                            this.bboxIntersectionTestEx = this.qtestOPOEx;
                        } else {
                            this.bboxIntersectionTest = this.qtestOPP;
                            this.bboxIntersectionTestEx = this.qtestOPPEx;
                        }
                    } else {
                        if (j === 0 && k === 0) {
                            this.bboxIntersectionTest = this.qtestPOO;
                            this.bboxIntersectionTestEx = this.qtestPOOEx;
                        } else if (j === 0) {
                            this.bboxIntersectionTest = this.qtestPOP;
                            this.bboxIntersectionTestEx = this.qtestPOPEx;
                        } else if (k === 0) {
                            this.bboxIntersectionTest = this.qtestPPO;
                            this.bboxIntersectionTestEx = this.qtestPPOEx;
                        } else {
                            this.bboxIntersectionTest = this.qtestPPP;
                            this.bboxIntersectionTestEx = this.qtestPPPEx;
                        }
                    }
                }
            }
        }
    }
}

/**
 * Height field class for height sampling and ray intersection
 * @public
 */ class HeightField {
    _region;
    _scale;
    _baseHeight;
    _width;
    _height;
    _heightData;
    _v00;
    _v01;
    _v11;
    _v10;
    /**
   * Create a height field
   *
   * @param width - number of height samples in x direction
   * @param height - number of height samples in z direction
   * @param scaleY - height scale factor
   * @param baseHeight - base height offset
   * @param region - region in xz plane covered by the height field
   */ constructor(width, height, scaleY, baseHeight, region){
        this._width = width;
        this._height = height;
        this._region = region?.clone() ?? new Vector4(0, 0, 1, 1);
        this._scale = new Vector3();
        this._scale.x = (this._region.z - this._region.x) / (this._width - 1);
        this._scale.y = scaleY ?? 1;
        this._scale.z = (this._region.w - this._region.y) / (this._height - 1);
        this._baseHeight = baseHeight ?? 0;
        this._heightData = new Float32Array(width * height);
        this._v00 = new Vector3();
        this._v01 = new Vector3();
        this._v11 = new Vector3();
        this._v10 = new Vector3();
    }
    /**
   * Region in xz plane covered by the height field
   */ get region() {
        return this._region;
    }
    set region(v) {
        this._region.set(v);
        this._scale.x = (this._region.z - this._region.x) / (this._width - 1);
        this._scale.z = (this._region.w - this._region.y) / (this._height - 1);
    }
    /**
   * Base height offset
   */ get baseHeight() {
        return this._baseHeight;
    }
    set baseHeight(v) {
        this._baseHeight = v;
    }
    /**
   * Height scale factor
   */ get scaleY() {
        return this._scale.y;
    }
    set scaleY(v) {
        this._scale.y = v;
    }
    /**
   * Number of height samples in x direction
   */ get width() {
        return this._width;
    }
    set width(v) {
        if (v !== this._width) {
            this._width = v;
            this._heightData = new Float32Array(this._width * this._height);
            this._scale.x = (this._region.z - this._region.x) / (this._width - 1);
        }
    }
    /**
   * Number of height samples in z direction
   */ get height() {
        return this._height;
    }
    set height(v) {
        if (v !== this._height) {
            this._height = v;
            this._heightData = new Float32Array(this._width * this._height);
            this._scale.z = (this._region.w - this._region.y) / (this._height - 1);
        }
    }
    /**
   * Height data array (row major)
   */ get heightData() {
        return this._heightData;
    }
    /**
   * Sample height at grid point (x, y)
   * @param x - x index
   * @param y - y index
   * @returns height value
   */ sampleHeight(x, y) {
        return this._heightData[y * this._width + x] * this._scale.y + this._baseHeight;
    }
    /**
   * Calculate height at given world position (worldX, worldZ) by bilinear interpolation
   * @param worldX - world x position
   * @param worldZ - world z position
   * @returns height value
   */ calculateHeight(worldX, worldZ) {
        const u = Math.max(0.5 / this._width, Math.min(1 - 0.5 / this._width, (worldX - this._region.x) / (this._region.z - this._region.x)));
        const v = Math.max(0.5 / this._height, Math.min(1 - 0.5 / this._height, (worldZ - this._region.y) / (this._region.w - this._region.y)));
        const pu = u * this._width;
        const pv = v * this._height;
        const l = Math.floor(pu);
        const t = Math.floor(pv);
        const r = l + 1;
        const b = t + 1;
        if (l === r) {
            if (t === b) {
                return this.sampleHeight(l, t);
            } else {
                const ht = this.sampleHeight(l, t);
                const hb = this.sampleHeight(l, b);
                return ht + (hb - ht) * (pv - t);
            }
        } else {
            const hlt = this.sampleHeight(l, t);
            const hrt = this.sampleHeight(r, t);
            const ht = hlt + (hrt - hlt) * (pu - l);
            if (t === b) {
                return ht;
            } else {
                const hlb = this.sampleHeight(l, b);
                const hrb = this.sampleHeight(r, b);
                const hb = hlb + (hrb - hlb) * (pu - l);
                return ht + (hb - ht) * (pv - t);
            }
        }
    }
    /**
   * Ray intersection test with the height field
   * @param rayWorld - ray in world space
   * @returns distance to intersection point, or null if no intersection
   */ rayIntersect(rayWorld) {
        let x0 = rayWorld.origin.x;
        let y0 = rayWorld.origin.z;
        let dx = rayWorld.direction.x;
        let dy = rayWorld.direction.z;
        const scaleX = this._scale.x;
        const scaleY = this._scale.z;
        const epsl = 0.001;
        let tx = 0;
        let ty = 0;
        const xmin = this._region.x;
        const xmax = this._region.z;
        const ymin = this._region.y;
        const ymax = this._region.w;
        const xcenter = (xmin + xmax) / 2;
        const ycenter = (ymin + ymax) / 2;
        let mirrorx = false;
        let mirrory = false;
        if (dx < 0) {
            dx = -dx;
            x0 += 2 * (xcenter - x0);
            mirrorx = true;
        }
        if (dy < 0) {
            dy = -dy;
            y0 += 2 * (ycenter - y0);
            mirrory = true;
        }
        if (x0 < xmin) {
            tx = (xmin - x0) / dx;
        } else if (x0 > xmax) {
            return null;
        }
        if (y0 < ymin) {
            ty = (ymin - y0) / dy;
        } else if (y0 > ymax) {
            return null;
        }
        const t = tx > ty ? tx : ty;
        x0 += t * dx;
        y0 += t * dy;
        let u = Math.floor((x0 - xmin + epsl) / scaleX);
        let v = Math.floor((y0 - ymin + epsl) / scaleY);
        while(u >= 0 && u < this._width && v >= 0 && v < this._height){
            if (u < this._width - 1 && v < this._height - 1) {
                const m = mirrorx ? this._width - 1 - u - 1 : u;
                const n = mirrory ? this._height - 1 - v - 1 : v;
                this._v00.setXYZ(xmin + m * scaleX, this.sampleHeight(m, n), ymin + n * scaleY);
                this._v01.setXYZ(xmin + (m + 1) * scaleX, this.sampleHeight(m + 1, n), ymin + n * scaleY);
                this._v11.setXYZ(xmin + (m + 1) * scaleX, this.sampleHeight(m + 1, n + 1), ymin + (n + 1) * scaleY);
                this._v10.setXYZ(xmin + m * scaleX, this.sampleHeight(m, n + 1), ymin + (n + 1) * scaleY);
                let intersected = false;
                let dist1 = rayWorld.intersectionTestTriangle(this._v00, this._v01, this._v10, false);
                if (dist1 !== null && dist1 > 0) {
                    intersected = true;
                } else {
                    dist1 = Number.MAX_VALUE;
                }
                let dist2 = rayWorld.intersectionTestTriangle(this._v10, this._v01, this._v11, false);
                if (dist2 !== null && dist2 > 0) {
                    intersected = true;
                } else {
                    dist2 = Number.MAX_VALUE;
                }
                if (intersected) {
                    return dist1 < dist2 ? dist1 : dist2;
                }
            }
            let d = Infinity;
            if (dx > 0) {
                const x1 = xmin + (u + 1) * scaleX;
                d = Math.min(d, (x1 - x0) / dx);
            }
            if (dy !== 0) {
                const y1 = ymin + (v + 1) * scaleY;
                d = Math.min(d, (y1 - y0) / dy);
            }
            x0 += d * dx;
            y0 += d * dy;
            u = Math.floor((x0 - xmin + epsl) / scaleX);
            v = Math.floor((y0 - ymin + epsl) / scaleY);
        }
        return null;
    }
}

/**
 * Spherical harmonics utilities
 *
 * @public
 */ class SH {
    /** Minimum supported harmonics order */ static MIN_ORDER = 2;
    /** Maximum supported harmonics order */ static MAX_ORDER = 3;
    /**
   * Evaluate SH basis for specific order
   *
   * @param direction - Direction to evaluate, must be normalized
   * @param order - SH order
   *
   * @returns The SH basis evaluate at given direction
   */ static evalBasis(direction, order) {
        if (order < this.MIN_ORDER || order > this.MAX_ORDER) {
            throw new Error(`SH.evalBasis(): order must between ${this.MIN_ORDER} and ${this.MAX_ORDER}`);
        }
        const x = direction.x;
        const y = direction.y;
        const z = direction.z;
        const out = [];
        // L=0, M=0
        out[0] = 0.28209479177387814;
        if (order >= 2) {
            // L=1, M=-1
            out[1] = -0.4886025119029199 * y;
            // L=1, M=0
            out[2] = 0.4886025119 * z;
            // L=1, M=1
            out[3] = -0.4886025119 * x;
        }
        if (order >= 3) {
            // L=2, M=-2
            out[4] = 1.0925484306 * x * y;
            // L=2, M=-1
            out[5] = -1.0925484306 * y * z;
            // L=2, M=0
            out[6] = 0.9461746956 * z * z + -0.3153915652;
            // L=2, M=1
            out[7] = -1.0925484306 * x * z;
            // L=2, M=2
            out[8] = 0.5462742153 * (x * x - y * y);
        }
        return out;
    }
    /**
   * Evaluates a directional light and returns spectral SH data
   *
   * @param direction - Direction of the light
   * @param color - Light color
   * @param order - SH order
   *
   * @returns Evaluated SH data
   */ static evalDirectionLight(direction, color, order) {
        if (order < this.MIN_ORDER || order > this.MAX_ORDER) {
            throw new Error(`SH.evalBasis(): order must between ${this.MIN_ORDER} and ${this.MAX_ORDER}`);
        }
        const tmp = this.evalBasis(direction, order);
        let cosWtInt = 0.75;
        if (order > 2) {
            cosWtInt += 5.0 / 16.0;
        }
        const fNorm = Math.PI / cosWtInt;
        const colorScale = Vector3.scale(color, fNorm);
        const result = [];
        for(let i = 0; i < order * order; i++){
            result[i] = Vector3.scale(colorScale, tmp[i]);
        }
        return result;
    }
}

const primes = [
    15731,
    789221,
    1376312589
];
function noise1(x) {
    x = x << 13 ^ x;
    return 1 - (x * (x * x * primes[0] + primes[1]) + primes[2] & 0x7fffffff) / 1073741824;
}
function noise2(x, y) {
    let n = x + y * 57;
    n = n << 13 ^ n;
    return 1 - (n * (n * n * primes[0] + primes[1]) + primes[2] & 0x7fffffff) / 1073741824;
}
function noise3(x, y, z) {
    const l = x + y * 57;
    const m = y + z * 57;
    let n = l + m * 57;
    n = n << 13 ^ n;
    return 1 - (n * (n * n * primes[0] + primes[1]) + primes[2] & 0x7fffffff) / 1073741824;
}
function interpolate(a, b, x) {
    return a + (b - a) * x;
}
function smoothNoise1(x) {
    return noise1(x) / 2 + noise1(x - 1) / 4 + noise1(x + 1) / 4;
}
function smoothNoise2(x, y) {
    const corners = (noise2(x - 1, y - 1) + noise2(x + 1, y - 1) + noise2(x - 1, y + 1) + noise2(x + 1, y + 1)) / 16;
    const sides = (noise2(x - 1, y) + noise2(x + 1, y) + noise2(x, y - 1) + noise2(x, y + 1)) / 8;
    const center = noise2(x, y) / 4;
    return corners + sides + center;
}
function smoothNoise3(x, y, z) {
    let corners, sides, center;
    corners = (noise3(x - 1, y - 1, z - 1) + noise3(x + 1, y - 1, z - 1) + noise3(x - 1, y + 1, z - 1) + noise3(x + 1, y + 1, z - 1)) / 16;
    sides = (noise3(x - 1, y, z - 1) + noise3(x + 1, y, z - 1) + noise3(x, y - 1, z - 1) + noise3(x, y + 1, z - 1)) / 8;
    center = noise3(x, y, z - 1) / 4;
    const zm1 = corners + sides + center;
    corners = (noise3(x - 1, y - 1, z) + noise3(x + 1, y - 1, z) + noise3(x - 1, y + 1, z) + noise3(x + 1, y + 1, z)) / 16;
    sides = (noise3(x - 1, y, z) + noise3(x + 1, y, z) + noise3(x, y - 1, z) + noise3(x, y + 1, z)) / 8;
    center = noise3(x, y, z) / 4;
    const zo = corners + sides + center;
    corners = (noise3(x - 1, y - 1, z + 1) + noise3(x + 1, y - 1, z + 1) + noise3(x - 1, y + 1, z + 1) + noise3(x + 1, y + 1, z + 1)) / 16;
    sides = (noise3(x - 1, y, z + 1) + noise3(x + 1, y, z + 1) + noise3(x, y - 1, z + 1) + noise3(x, y + 1, z + 1)) / 8;
    center = noise3(x, y, z + 1) / 4;
    const zp1 = corners + sides + center;
    return zm1 / 4 + zo / 2 + zp1 / 4;
}
function interpolateNoise1(x) {
    const ix = Math.floor(x);
    const fract = x - ix;
    const v1 = smoothNoise1(ix);
    const v2 = smoothNoise1(ix + 1);
    return interpolate(v1, v2, fract);
}
function interpolateNoise2(x, y) {
    const ix = Math.floor(x);
    const fractX = x - ix;
    const iy = Math.floor(y);
    const fractY = y - iy;
    const v1 = smoothNoise2(ix, iy);
    const v2 = smoothNoise2(ix + 1, iy);
    const v3 = smoothNoise2(ix, iy + 1);
    const v4 = smoothNoise2(ix + 1, iy + 1);
    const i1 = interpolate(v1, v2, fractX);
    const i2 = interpolate(v3, v4, fractX);
    return interpolate(i1, i2, fractY);
}
function interpolateNoise3(x, y, z) {
    const ix = Math.floor(x);
    const fractX = x - ix;
    const iy = Math.floor(y);
    const fractY = y - iy;
    const iz = Math.floor(z);
    const fractZ = z - iz;
    const v1 = smoothNoise3(ix, iy, iz);
    const v2 = smoothNoise3(ix + 1, iy, iz);
    const v3 = smoothNoise3(ix, iy + 1, iz);
    const v4 = smoothNoise3(ix + 1, iy + 1, iz);
    const v5 = smoothNoise3(ix, iy, iz + 1);
    const v6 = smoothNoise3(ix + 1, iy, iz + 1);
    const v7 = smoothNoise3(ix, iy + 1, iz + 1);
    const v8 = smoothNoise3(ix + 1, iy + 1, iz + 1);
    const i1 = interpolate(v1, v2, fractX);
    const i2 = interpolate(v3, v4, fractX);
    const i3 = interpolate(v5, v6, fractX);
    const i4 = interpolate(v7, v8, fractX);
    const i5 = interpolate(i1, i2, fractY);
    const i6 = interpolate(i3, i4, fractY);
    return interpolate(i5, i6, fractZ);
}
/** @internal */ function perlinNoise1D(x, amp, freq) {
    return interpolateNoise1(x * freq) * amp;
}
/** @internal */ function perlinNoise2D(x, y, amp, freqX, freqY) {
    return interpolateNoise2(x * freqX, y * freqY) * amp;
}
/** @internal */ function perlinNoise3D(x, y, z, amp, freqX, freqY, freqZ) {
    return interpolateNoise3(x * freqX, y * freqY, z * freqZ) * amp;
}
/**
 * Generates an array of jitters using the Halton sequence.
 * @param length - The length of the array to generate.
 * @returns An array of jitters, range [-0.5, 0.5].
 * @public
 */ function halton23(length) {
    function halton(base, index) {
        let result = 0;
        let f = 1;
        while(index > 0){
            f /= base;
            result += f * (index % base);
            index = Math.floor(index / base);
        }
        return result;
    }
    const jitters = [];
    for(let i = 1; i <= length; i++){
        jitters.push([
            halton(2, i) - 0.5,
            halton(3, i) - 0.5
        ]);
    }
    return jitters;
}

const tmpQuat1 = new Quaternion();
const tmpQuat2 = new Quaternion();
const tmpQuat3 = new Quaternion();
const strideMap = {
    number: 1,
    vec2: 2,
    vec3: 3,
    vec4: 4,
    quat: 4
};
function numberClamp(x, min, max) {
    return x < min ? min : x > max ? max : x;
}
/**
 * The interpolator class
 * @public
 */ class Interpolator {
    /** @internal */ _prevKey;
    /** @internal */ _prevT;
    /** @internal */ _inputs;
    /** @internal */ _outputs;
    /** @internal */ _mode;
    /** @internal */ _target;
    /** @internal */ _stride;
    /** @internal */ _maxTime;
    /** @internal */ _a;
    /** @internal */ _h;
    /**
   * Interpolation target to stride
   * @param target - The interpolation target
   * @returns Stride of the target
   */ static getTargetStride(target) {
        return strideMap[target] ?? 0;
    }
    /**
   * Creates a interpolator instance
   * @param mode - The interpolation mode
   * @param target - The interpolation target
   * @param inputs - Linear time in seconds
   * @param outputs - Vector or scalars representing the properties to be interpolated
   * @param stride - Stride of outputs
   */ constructor(mode, target, inputs, outputs){
        this._prevKey = 0;
        this._prevT = 0;
        this._inputs = inputs;
        this._outputs = outputs;
        this._mode = mode;
        this._target = target;
        this._stride = target ? strideMap[target] : Math.floor(outputs.length / inputs.length);
        this._maxTime = inputs[inputs.length - 1];
        this._a = null;
        this._h = null;
    }
    /** Gets the interpolation mode */ get mode() {
        return this._mode;
    }
    set mode(val) {
        if (val !== this._mode) {
            this._mode = val;
            this._stride = this._target ? strideMap[this._target] : Math.floor(this._outputs.length / this._inputs.length);
        }
    }
    /** Gets the interpolation target */ get target() {
        return this._target;
    }
    set target(val) {
        if (val !== this._target) {
            this._target = val;
            this._stride = this._target ? strideMap[this._target] : Math.floor(this._outputs.length / this._inputs.length);
        }
    }
    /** stride */ get stride() {
        return this._stride;
    }
    get maxTime() {
        return this._maxTime;
    }
    /** inputs */ get inputs() {
        return this._inputs;
    }
    set inputs(val) {
        if (val !== this._inputs) {
            this._inputs = val;
            this._a = null;
            this._h = null;
        }
    }
    /** outputs */ get outputs() {
        return this._outputs;
    }
    set outputs(val) {
        if (val !== this._outputs) {
            this._outputs = val;
            this._a = null;
            this._h = null;
        }
    }
    /**
   * Calculates the interpolated value at a given time
   * @param t - The time to calcuate interpolation
   * @param maxTime - The maxmium time duration
   * @param result - The calculated interpolation value
   * @returns The calcuated interpolation value
   */ interpolate(t, result) {
        const ot = t;
        const input = this._inputs;
        const output = this._outputs;
        if (output.length === this._stride) {
            for(let i = 0; i < this._stride; i++){
                result[i] = output[i];
            }
            return result;
        }
        t = numberClamp(t, input[0], input[input.length - 1]);
        if (this._prevT > t) {
            this._prevKey = 0;
        }
        this._prevT = t;
        let nextKey = 0;
        for(let i = this._prevKey; i < input.length; ++i){
            if (t <= input[i]) {
                nextKey = numberClamp(i, 1, input.length - 1);
                break;
            }
        }
        this._prevKey = numberClamp(nextKey - 1, 0, nextKey);
        const keyDelta = input[nextKey] - input[this._prevKey];
        const tn = (t - input[this._prevKey]) / keyDelta;
        if (this._target === 'quat') {
            if (this._mode === 'cubicspline') {
                this.cubicSpline(this._prevKey, nextKey, keyDelta, tn, result);
                return result;
            } else if (this._mode === 'cubicspline-natural') {
                this.cubicSplineNatural(this._prevKey, nextKey, ot, tn, result);
            } else if (this._mode === 'linear') {
                this.getQuat(this._prevKey, tmpQuat1);
                this.getQuat(nextKey, tmpQuat2);
                this.slerpQuat(tmpQuat1, tmpQuat2, tn, tmpQuat3);
                result[0] = tmpQuat3.x;
                result[1] = tmpQuat3.y;
                result[2] = tmpQuat3.z;
                result[3] = tmpQuat3.w;
                return result;
            } else {
                return this.getQuat(this._prevKey, result);
            }
        }
        switch(this._mode){
            case 'step':
                return this.step(this._prevKey, result);
            case 'cubicspline':
                return this.cubicSpline(this._prevKey, nextKey, keyDelta, tn, result);
            case 'cubicspline-natural':
                return this.cubicSplineNatural(this._prevKey, nextKey, ot, tn, result);
            case 'linear':
            default:
                return this.linear(this._prevKey, nextKey, tn, result);
        }
    }
    /** @internal */ getQuat(index, result) {
        result[0] = this._outputs[4 * index];
        result[1] = this._outputs[4 * index + 1];
        result[2] = this._outputs[4 * index + 2];
        result[3] = this._outputs[4 * index + 3];
        return result;
    }
    /** @internal */ step(prevKey, result) {
        for(let i = 0; i < this._stride; i++){
            result[i] = this._outputs[prevKey * this._stride + i];
        }
        return result;
    }
    /** @internal */ linear(prevKey, nextKey, t, result) {
        for(let i = 0; i < this._stride; i++){
            result[i] = this._outputs[prevKey * this._stride + i] * (1 - t) + this._outputs[nextKey * this._stride + i] * t;
        }
        return result;
    }
    /** @internal */ cubicSpline(prevKey, nextKey, keyDelta, t, result) {
        const prevIndex = prevKey * this._stride * 3;
        const nextIndex = nextKey * this._stride * 3;
        const A = 0;
        const V = this._stride;
        const B = 2 * this._stride;
        const tSq = t * t;
        const tCub = tSq * t;
        for(let i = 0; i < this._stride; i++){
            const v0 = this._outputs[prevIndex + i + V];
            const a = keyDelta * this._outputs[nextIndex + i + A];
            const b = keyDelta * this._outputs[prevIndex + i + B];
            const v1 = this._outputs[nextIndex + i + V];
            result[i] = (2 * tCub - 3 * tSq + 1) * v0 + (tCub - 2 * tSq + t) * b + (-2 * tCub + 3 * tSq) * v1 + (tCub - tSq) * a;
        }
        return result;
    }
    /** @internal */ cubicSplineNatural(prevKey, nextKey, t, tn, result) {
        if (this._inputs.length === 2) {
            return this.linear(prevKey, nextKey, tn, result);
        }
        if (!this._a) {
            this._prepareCubicSplineNatural();
        }
        const seg = Math.min(Math.max(this._getSegment(t), 0), this._inputs.length - 2) + 1;
        const t1 = t - this._inputs[seg - 1];
        const t2 = this._h[seg] - t1;
        for(let i = 0; i < this._stride; i++){
            result[i] = ((-this._a[(seg - 1) * this._stride + i] / 6 * (t2 + this._h[seg]) * t1 + this._outputs[(seg - 1) * this._stride + i]) * t2 + (-this._a[seg * this._stride + i] / 6 * (t1 + this._h[seg]) * t2 + this._outputs[seg * this._stride + i]) * t1) / this._h[seg];
        }
        return result;
    }
    _prepareCubicSplineNatural() {
        const nk = this._inputs.length;
        const sub = new Array(nk - 1);
        const diag = new Array(nk - 1);
        const sup = new Array(nk - 1);
        this._h = new Array(nk);
        this._a = new Array(nk * this._stride);
        for(let i = 0; i < this._stride; i++){
            this._a[i] = 0;
            this._a[nk * this._stride - 1 - i] = 0;
        }
        for(let i = 1; i < nk; ++i){
            this._h[i] = this._inputs[i] - this._inputs[i - 1];
        }
        for(let i = 1; i < nk - 1; ++i){
            diag[i] = (this._h[i] + this._h[i + 1]) / 3;
            sup[i] = this._h[i + 1] / 6.0;
            sub[i] = this._h[i] / 6;
            for(let j = 0; j < this._stride; j++){
                const k = i * this._stride + j;
                this._a[k] = (this._outputs[k + this._stride] - this._outputs[k]) / this._h[i + 1] - (this._outputs[k] - this._outputs[k - this._stride]) / this._h[i];
            }
        }
        this.solveTridiag(sub, diag, sup);
    }
    solveTridiag(sub, diag, sup) {
        const n = this._inputs.length - 2;
        for(let i = 2; i <= n; ++i){
            sub[i] /= diag[i - 1];
            diag[i] -= sub[i] * sup[i - 1];
            this._a[i] -= this._a[i - 1] * sub[i];
        }
        for(let i = 0; i < this._stride; i++){
            this._a[n * this._stride + i] /= diag[n];
        }
        for(let i = n - 1; i >= 1; --i){
            for(let j = 0; j < this._stride; j++){
                const k = i * this._stride + j;
                this._a[k] = (this._a[k] - this._a[k + this._stride] * sup[i]) / diag[i];
            }
        }
    }
    _getSegment(x) {
        if (x < this._inputs[0]) {
            return -1;
        }
        if (x >= this._inputs[this._inputs.length - 1]) {
            return this._inputs.length;
        }
        let result = 0;
        for(; result < this._inputs.length - 1; ++result){
            if (x < this._inputs[result + 1]) {
                break;
            }
        }
        if (result == this._inputs.length) {
            result = this._inputs.length - 1;
        }
        return result;
    }
    /** @internal */ slerpQuat(q1, q2, t, result) {
        return Quaternion.slerp(q1, q2, t, result).inplaceNormalize();
    }
}

/**
 * The rectangle packer class
 * @public
 */ class RectsPacker {
    /** @internal */ _bins;
    /** @internal */ _maxBins;
    /** @internal */ _width;
    /** @internal */ _height;
    /**
   * @param width - width of image bin
   * @param height - height of image bin
   * @param maxBins - max count of image bins
   */ constructor(width, height, maxBins = 0){
        this._width = width;
        this._height = height;
        this._maxBins = maxBins;
        this._bins = [
            new Bin(this._width, this._height)
        ];
    }
    /** Clear all image bins of the packer */ clear() {
        this._bins = [
            new Bin(this._width, this._height)
        ];
    }
    /**
   * Inserts a new rectangle
   * @param width - Width of the rectangle.
   * @param height - Height of the rectangle.
   * @returns The pack result.
   */ insert(width, height) {
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
    freeRects;
    constructor(width, height){
        this.freeRects = [
            {
                x: 0,
                y: 0,
                width,
                height
            }
        ];
    }
    insert(width, height) {
        const newRect = this.findBestFit(width, height);
        if (!newRect) {
            return null;
        }
        let numRectsToProcess = this.freeRects.length;
        let i = 0;
        while(i < numRectsToProcess){
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
    findBestFit(width, height) {
        let score = Number.MAX_VALUE;
        let rect = null;
        for (const freeRect of this.freeRects){
            if (freeRect.width >= width && freeRect.height >= height) {
                const areaFit = freeRect.width * freeRect.height - width * height;
                if (areaFit < score) {
                    if (!rect) {
                        rect = {
                            width,
                            height
                        };
                    }
                    rect.x = freeRect.x;
                    rect.y = freeRect.y;
                    score = areaFit;
                }
            }
        }
        return rect;
    }
    splitFreeRect(free, used) {
        if (used.x >= free.x + free.width || used.x + used.width <= free.x || used.y >= free.y + free.height || used.y + used.height <= free.y) {
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
    pruneFreeRects() {
        let i = 0;
        let j = 0;
        let len = this.freeRects.length;
        while(i < len){
            j = i + 1;
            const rect1 = this.freeRects[i];
            while(j < len){
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
    isRectInRect(test, container) {
        return test.x >= container.x && test.y >= container.y && test.x + test.width <= container.x + container.width && test.y + test.height <= container.y + container.height;
    }
}

/**
 * Pseudorandom number generator
 * @public
 */ class PRNG {
    /** @internal */ _generator;
    /**
   * Creates an instance of PRNG
   * @param seed - The random seed
   */ constructor(seed = 0){
        // mulberry32 algorithm
        this._generator = ()=>{
            let t = seed += 0x6d2b79f5;
            t = Math.imul(t ^ t >>> 15, t | 1);
            t ^= t + Math.imul(t ^ t >>> 7, t | 61);
            return ((t ^ t >>> 14) >>> 0) / 4294967296;
        };
    }
    /** Gets next random value between 0 and 1 */ get() {
        return this._generator();
    }
}

/**
 * Path utilities.
 *
 * Provides POSIX-like path manipulation helpers (pure string operations),
 * including normalization, joining, dirname/basename/extname extraction,
 * absolute-path detection, and relative path computation.
 *
 * Notes:
 * - Uses "/" as the separator (web/URL or POSIX-like paths).
 * - All methods are pure and do not touch a real filesystem.
 * - `normalize` collapses ".", "..", and redundant slashes.
 *
 * @public
 */ class PathUtils {
    /**
   * Normalizes a path by collapsing redundant slashes, removing "." segments,
   * and resolving ".." segments.
   *
   * Rules:
   * - Multiple consecutive "/" are collapsed into a single "/".
   * - "." segments are removed.
   * - ".." removes the previous segment (no-op at root).
   * - The result always starts with "/" (absolute form).
   *
   * Example:
   * - normalize('/a//b/./c/../d') -\> '/a/b/d'
   *
   * @param path - Input path (relative or absolute).
   * @returns The normalized absolute path (always starting with "/").
   */ static normalize(path) {
        const parts = path.split('/').filter((p)=>p && p !== '.');
        const result = [];
        for (const part of parts){
            if (part === '..') {
                result.pop();
            } else {
                result.push(part);
            }
        }
        return '/' + result.join('/');
    }
    /**
   * Joins multiple path segments and normalizes the result.
   *
   * Behavior:
   * - Concatenates segments with "/" and then runs `normalize`.
   * - The returned path is always absolute.
   *
   * Example:
   * - join('/a', 'b', '../c') -\> '/a/c'
   *
   * @param paths - Path segments in order.
   * @returns Normalized absolute path.
   */ static join(...paths) {
        return this.normalize(paths.join('/'));
    }
    /**
   * Returns the directory name (parent directory) of a path.
   *
   * Behavior:
   * - Applies `normalize` first.
   * - If the path is root "/" or has no parent, returns "/".
   *
   * Examples:
   * - dirname('/a/b/c') -\> '/a/b'
   * - dirname('/a') -\> '/'
   * - dirname('/') -\> '/'
   *
   * @param path - Input path.
   * @returns Directory path of the input.
   */ static dirname(path) {
        const normalized = this.normalize(path);
        const lastSlash = normalized.lastIndexOf('/');
        return lastSlash <= 0 ? '/' : normalized.slice(0, lastSlash);
    }
    /**
   * Returns the last portion of a path (file name).
   *
   * Behavior:
   * - Applies `normalize` first.
   * - If `ext` is provided and the name ends with it, the extension is stripped.
   *
   * Examples:
   * - basename('/a/b/c.txt') -\> 'c.txt'
   * - basename('/a/b/c.txt', '.txt') -\> 'c'
   * - basename('/') -\> ''
   *
   * @param path - Input path.
   * @param ext - Optional extension to strip (exact suffix match).
   * @returns The base name of the path.
   */ static basename(path, ext) {
        const normalized = this.normalize(path);
        const lastSlash = normalized.lastIndexOf('/');
        let name = normalized.slice(lastSlash + 1);
        if (ext && name.endsWith(ext)) {
            name = name.slice(0, -ext.length);
        }
        return name;
    }
    /**
   * Returns the extension of the path, including the leading dot.
   *
   * Behavior:
   * - Based on the result of `basename`.
   * - If there is no dot, returns an empty string.
   *
   * Examples:
   * - extname('/a/b/c.txt') -\> '.txt'
   * - extname('/a/b/c') -\> ''
   *
   * @param path - Input path.
   * @returns The extension (e.g., ".txt") or an empty string if none.
   */ static extname(path) {
        const basename = this.basename(path);
        const lastDot = basename.lastIndexOf('.');
        return lastDot === -1 ? '' : basename.slice(lastDot);
    }
    /**
   * Sanitizes a file or directory name by replacing or removing invalid characters.
   *
   * Behavior:
   * - Removes or replaces characters that are invalid in common filesystems.
   * - Trims leading/trailing spaces and dots.
   * - Collapses multiple spaces into single spaces.
   * - Replaces reserved names with safe alternatives.
   * - Optionally limits the length of the result.
   *
   * Examples:
   * - sanitizeFilename('my file.txt') -\> 'my file.txt'
   * - sanitizeFilename('file:name*.txt') -\> 'file_name_.txt'
   * - sanitizeFilename('  .hidden  ') -\> 'hidden'
   * - sanitizeFilename('CON') -\> '_CON'
   * - sanitizeFilename('a'.repeat(300)) -\> (truncated to maxLength)
   *
   * @param filename - Input filename to sanitize.
   * @param options - Optional configuration.
   * @returns Sanitized filename safe for use across platforms.
   */ static sanitizeFilename(filename, options) {
        const { replacement = '_', maxLength = 255, asciiOnly = false } = options ?? {};
        const reserved = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;
        // Replace reserved special characters
        let sanitized = filename.replace(/[<>:"/\\|?*]/g, replacement);
        // Replace control characters and optionally non-ASCII
        sanitized = Array.from(sanitized).map((char)=>{
            const code = char.charCodeAt(0);
            if (code <= 0x1f || code === 0x7f) {
                return replacement;
            }
            if (asciiOnly && (code < 0x20 || code > 0x7e)) {
                return replacement;
            }
            return char;
        }).join('');
        // Normalize whitespace and trim invalid edges
        sanitized = sanitized.replace(/\s+/g, ' ').replace(/^[\s.]+|[\s.]+$/g, '');
        // Empty fallback
        if (!sanitized) {
            sanitized = 'unnamed';
        }
        // Handle reserved names (Windows)
        const baseName = sanitized.split('.')[0];
        if (reserved.test(baseName)) {
            sanitized = replacement + sanitized;
        }
        // Truncate (preserve extension if possible)
        if (sanitized.length > maxLength) {
            const dotIndex = sanitized.lastIndexOf('.');
            if (dotIndex > 0 && sanitized.length - dotIndex <= 10) {
                const ext = sanitized.slice(dotIndex);
                const base = sanitized.slice(0, maxLength - ext.length);
                sanitized = base + ext;
            } else {
                sanitized = sanitized.slice(0, maxLength);
            }
        }
        return sanitized;
    }
    /**
   * Determines whether the path is absolute.
   *
   * Definition here: absolute paths start with "/".
   *
   * @param path - Input path.
   * @returns True if the path starts with "/", otherwise false.
   */ static isAbsolute(path) {
        return path.startsWith('/');
    }
    /**
   * Computes a relative path from one path to another.
   *
   * Behavior:
   * - Both `from` and `to` are normalized first.
   * - The returned path does not start with "/" (relative form).
   * - If both resolve to the same path, returns ".".
   *
   * Examples:
   * - relative('/a/b/c', '/a/d/e') -\> '../../d/e'
   * - relative('/a/b', '/a/b/c') -\> 'c'
   * - relative('/a/b', '/a/b') -\> '.'
   *
   * @param from - Base path to start from.
   * @param to - Target path to reach.
   * @returns Relative path from `from` to `to`.
   */ static relative(from, to) {
        const fromParts = this.normalize(from).split('/').filter(Boolean);
        const toParts = this.normalize(to).split('/').filter(Boolean);
        let i = 0;
        while(i < fromParts.length && i < toParts.length && fromParts[i] === toParts[i]){
            i++;
        }
        const up = '../'.repeat(fromParts.length - i);
        const down = toParts.slice(i).join('/');
        return up + down || '.';
    }
}
/**
 * Guesses the MIME type based on a file path or file name.
 *
 * Behavior:
 * - Uses `PathUtils.extname` to extract the extension (case-insensitive).
 * - Falls back to `application/octet-stream` if unknown.
 *
 * Notes:
 * - The mapping is intentionally minimal and web-oriented.
 * - Extend the `mimeTypes` table if you need additional types.
 *
 * Examples:
 * - guessMimeType('image.png') -\> 'image/png'
 * - guessMimeType('/a/b/model.glb') -\> 'model/gltf-binary'
 * - guessMimeType('unknown.ext') -\> 'application/octet-stream'
 *
 * @param path - File path or name used to infer the MIME type.
 * @returns The guessed MIME type string.
 *
 * @public
 */ function guessMimeType(path) {
    const ext = PathUtils.extname(path).toLowerCase();
    const mimeTypes = {
        '.txt': 'text/plain',
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.mjs': 'text/javascript',
        '.ts': 'text/x-typescript',
        '.wasm': 'application/wasm',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.webp': 'image/webp',
        '.gif': 'image/gif',
        '.tga': 'image/tga',
        '.ico': 'image/x-icon',
        '.dds': 'image/x-dds',
        '.svg': 'image/svg+xml',
        '.hdr': 'image/vnd.radiance',
        '.exr': 'image/x-exr',
        '.tiff': 'image/tiff',
        '.wav': 'audio/wav',
        '.mp3': 'audio/mpeg',
        '.mp4': 'video/mp4',
        '.zip': 'application/zip',
        '.fbx': 'model/fbx',
        '.obj': 'model/obj',
        '.gltf': 'model/gltf+json',
        '.glb': 'model/gltf-binary',
        '.ktx': 'image/ktx',
        '.ktx2': 'image/ktx2',
        // zephyr3d specific
        '.zbpt': 'application/vnd.zephyr3d.blueprint+json',
        '.zmsh': 'application/vnd.zephyr3d.mesh+json',
        '.zmtl': 'application/vnd.zephyr3d.material+json',
        '.zmf': 'application/vnd.zephyr3d.blueprint.mf+json',
        '.zscn': 'application/vnd.zephyr3d.scene+json',
        '.zprefab': 'application/vnd.zephyr3d.prefab+json',
        '.zabc': 'application/vnd.zephyr3d.alembic-cache+json'
    };
    return mimeTypes[ext] || 'application/octet-stream';
}

/**
 * Represents an error that occurred during a VFS operation.
 *
 * @public
 */ class VFSError extends Error {
    code;
    path;
    constructor(message, code, path){
        super(message), this.code = code, this.path = path;
        this.name = 'VFSError';
    }
}
/**
 * A matcher for glob patterns that converts wildcard patterns to regular expressions.
 *
 * @public
 */ class GlobMatcher {
    pattern;
    regex;
    /**
   * Creates a new glob pattern matcher.
   *
   * @param pattern - The glob pattern to match
   * @param caseSensitive - Whether matching should be case sensitive
   */ constructor(pattern, caseSensitive = true){
        this.pattern = pattern;
        this.regex = this.compilePattern(pattern, caseSensitive);
    }
    /**
   * Test if a path is a match pattern
   */ test(path) {
        return this.regex.test(path);
    }
    /**
   * Get original match pattern
   */ getPattern() {
        return this.pattern;
    }
    /**
   * Compile the match pattern to RegExp
   */ compilePattern(str, caseSensitive) {
        // The regexp we are building, as a string.
        let reStr = '';
        // If we are doing extended matching, this boolean is true when we are inside
        // a group (eg {*.html,*.js}), and false otherwise.
        let inGroup = false;
        // RegExp flags (eg "i" ) to pass in to RegExp constructor.
        const flags = caseSensitive ? '' : 'i';
        let c;
        for(let i = 0, len = str.length; i < len; i++){
            c = str[i];
            switch(c){
                case '/':
                case '$':
                case '^':
                case '+':
                case '.':
                case '(':
                case ')':
                case '=':
                case '!':
                case '|':
                    reStr += '\\' + c;
                    break;
                case '?':
                    {
                        reStr += '.';
                        break;
                    }
                /* falls through */ case '[':
                case ']':
                    {
                        reStr += c;
                        break;
                    }
                /* falls through */ case '{':
                    {
                        inGroup = true;
                        reStr += '(';
                        break;
                    }
                /* falls through */ case '}':
                    {
                        inGroup = false;
                        reStr += ')';
                        break;
                    }
                /* falls through */ case ',':
                    if (inGroup) {
                        reStr += '|';
                        break;
                    }
                    reStr += '\\' + c;
                    break;
                case '*':
                    {
                        // Move over all consecutive "*"'s.
                        // Also store the previous and next characters
                        const prevChar = str[i - 1];
                        let starCount = 1;
                        while(str[i + 1] === '*'){
                            starCount++;
                            i++;
                        }
                        const nextChar = str[i + 1];
                        {
                            // globstar is enabled, so determine if this is a globstar segment
                            const isGlobstar = starCount > 1 && // multiple "*"'s
                            (prevChar === '/' || prevChar === undefined) && // from the start of the segment
                            (nextChar === '/' || nextChar === undefined); // to the end of the segment
                            if (isGlobstar) {
                                // it's a globstar, so match zero or more path segments
                                reStr += '((?:[^/]*(?:/|$))*)';
                                i++; // move over the "/"
                            } else {
                                // it's not a globstar, so only match one path segment
                                reStr += '([^/]*)';
                            }
                        }
                        break;
                    }
                default:
                    reStr += c;
            }
        }
        // When regexp 'g' flag is specified don't
        // constrain the regular expression with ^ & $
        if (!flags || !~flags.indexOf('g')) {
            reStr = '^' + reStr + '$';
        }
        return new RegExp(reStr, flags);
    }
}
/**
 * Abstract base class for virtual file systems.
 *
 * Provides a standardized interface for file system operations and supports
 * mounting other VFS instances at specific paths for composition.
 *
 * @public
 *
 */ class VFS extends Observable {
    /** Whether this file system is read-only */ _readOnly;
    // CWD support
    _cwd = '/';
    _dirStack;
    // Simple mounting support
    simpleMounts;
    sortedMountPaths;
    mountChangeCallbacks;
    /**
   * Creates a new VFS instance.
   *
   * @param readOnly - Whether this file system should be read-only
   */ constructor(readOnly = false){
        super();
        this._readOnly = readOnly;
        this._dirStack = [];
        this.simpleMounts = new Map();
        this._cwd = '/';
        this.sortedMountPaths = [];
        this.mountChangeCallbacks = new Map();
    }
    /** Toggle readonly */ get readOnly() {
        return this._readOnly;
    }
    set readOnly(val) {
        this.setReadonly(val);
    }
    /**
   * Gets all simple mount points.
   *
   * @returns Array of mount point paths
   */ getSimpleMountPoints() {
        return Array.from(this.simpleMounts.keys());
    }
    /**
   * Checks if this VFS has any mount points.
   *
   * @returns True if there are mounted VFS instances, false otherwise
   */ hasMounts() {
        return this.simpleMounts.size > 0;
    }
    /**
   * Parse DataURL
   * @param uri - URL to parse
   * @returns parts of data URL
   */ parseDataURI(uri) {
        return uri?.match(/^data:([^;]+)/) ?? null;
    }
    /**
   * Checks wether a URL is object url created by URL.createObjectURL()
   * @param url - URL to check
   * @returns true if the URL is object url, otherwise false
   */ isObjectURL(url) {
        return typeof url === 'string' && url.startsWith('blob:');
    }
    /**
   * Checks wether a URL is absolute URL
   * @param url - URL to check
   * @returns true if the URL is absolute URL, otherwise false
   */ isAbsoluteURL(url) {
        return typeof url === 'string' && (url.startsWith('http://') || url.startsWith('https://'));
    }
    /**
   * Disposes of this file system and cleans up resources. (for IndexedDB only).
   */ async deleteFileSystem() {
        await this._deleteFileSystem();
    }
    /**
   * Delete entire database (for IndexedDB only).
   */ async wipe() {
        await this._wipe();
    }
    /**
   * Gets the current working directory.
   *
   * @returns The current working directory path
   *
   * @example
   * ```typescript
   * const cwd = fs.getCwd();
   * console.log(`Current directory: ${cwd}`);
   * ```
   */ getCwd() {
        return this._cwd;
    }
    /**
   * Changes the current working directory.
   *
   * @param path - The new working directory path (absolute or relative)
   * @returns Promise that resolves when directory is changed
   *
   * @example
   * ```typescript
   * await fs.chdir('/home/user');
   * await fs.chdir('../documents'); // Relative path
   * ```
   */ async chdir(path) {
        const normalizedPath = this.normalizePath(path);
        // Test directory existence
        if (!await this.exists(normalizedPath)) {
            throw new VFSError(`Directory does not exist: ${normalizedPath}`, 'ENOENT', normalizedPath);
        }
        // Test wether it is a directory
        const stat = await this.stat(normalizedPath);
        if (!stat.isDirectory) {
            throw new VFSError(`Not a directory: ${normalizedPath}`, 'ENOTDIR', normalizedPath);
        }
        this._cwd = normalizedPath;
    }
    /**
   * Pushes the current directory onto the directory stack and changes to the specified directory.
   *
   * @param path - The directory to change to (absolute or relative)
   * @returns Promise that resolves when directory is changed
   *
   * @example
   * ```typescript
   * await fs.pushd('/tmp');        // Push current dir and go to /tmp
   * await fs.pushd('../other');    // Push /tmp and go to /other
   * ```
   */ async pushd(path) {
        this._dirStack.push(this._cwd);
        await this.chdir(path);
    }
    /**
   * Pops a directory from the directory stack and changes to it.
   *
   * @returns Promise that resolves when directory is changed
   * @throws VFSError if the directory stack is empty
   *
   * @example
   * ```typescript
   * await fs.popd(); // Return to previously pushed directory
   * ```
   */ async popd() {
        if (this._dirStack.length === 0) {
            throw new VFSError('Directory stack is empty', 'ENOENT');
        }
        const previousDir = this._dirStack.pop();
        this._cwd = previousDir;
    }
    /**
   * Normalizes a path, resolving . and .. components and making it absolute.
   * Supports both absolute and relative paths.
   *
   * @param path - The path to normalize
   * @returns The normalized absolute path
   *
   * @example
   * ```typescript
   * // Assuming CWD is /home/user
   * fs.normalizePath('.');           // -> /home/user
   * fs.normalizePath('..');          // -> /home
   * fs.normalizePath('../docs');     // -> /home/docs
   * fs.normalizePath('/tmp');        // -> /tmp
   * fs.normalizePath('sub/dir');     // -> /home/user/sub/dir
   * ```
   */ normalizePath(path) {
        if (!path) {
            return this._cwd;
        }
        // Use PathUtils.normalize if it is an absolute path
        if (path.startsWith('/')) {
            return PathUtils.normalize(path);
        }
        if (this.isAbsoluteURL(path) || this.isObjectURL(path) || this.parseDataURI(path)) {
            // Normalize URL
            return encodeURI(path);
        }
        // Relative path: merged with CWD and then do normalization
        const absolutePath = PathUtils.join(this._cwd, path);
        return PathUtils.normalize(absolutePath);
    }
    /**
   * Join paths together, making the result relative to CWD if not absolute.
   *
   * @param paths - Paths to join
   * @returns Complete normalized path
   *
   * @example
   * ```typescript
   * // Assuming CWD is /home/user
   * fs.join('docs', 'file.txt');     // -> /home/user/docs/file.txt
   * fs.join('/tmp', 'file.txt');     // -> /tmp/file.txt
   * ```
   */ join(...paths) {
        if (paths.length === 0) {
            return this._cwd;
        }
        // Use PathUtils.join if the first path is an absolute path
        if (paths[0].startsWith('/')) {
            return PathUtils.normalize(PathUtils.join(...paths));
        }
        // Relative path, merged with CWD first, and join with rest
        const allPaths = [
            this._cwd,
            ...paths
        ];
        return PathUtils.normalize(PathUtils.join(...allPaths));
    }
    /**
   * Extract directory part for a path
   * @param path - path
   * @returns Directory part of the path
   */ dirname(path) {
        return PathUtils.dirname(path);
    }
    /**
   * Returns whether a path is absolute or not
   * @param path - path to check
   * @returns true if the path is an absolute path
   */ isAbsolute(path) {
        return PathUtils.isAbsolute(path);
    }
    /**
   * Extract base file name part for a path
   * @param path - path
   * @param ext - Optional extension to strip (exact suffix match).
   * @returns The base name of the path.
   */ basename(path, ext) {
        return PathUtils.basename(path, ext);
    }
    /**
   * Extract extension file name part for a path
   * @param path - path
   * @returns extension file name part of the path
   */ extname(path) {
        return PathUtils.extname(path);
    }
    /**
   * Converts an absolute path to a path relative to the current working directory.
   *
   * @param path - The absolute path to convert
   * @returns The relative path from CWD
   *
   * @example
   * ```typescript
   * // Assuming CWD is /home/user
   * fs.relative('/home/user/docs');  // -> docs
   * fs.relative('/home');            // -> ..
   * fs.relative('/tmp');             // -> ../../tmp
   * ```
   */ relative(path, parent) {
        if (this.isObjectURL(path) || this.parseDataURI(path)) {
            // No relative support for ObjectURL and DataURL
            return path;
        }
        const absolutePath = this.normalizePath(path);
        return PathUtils.relative(parent ?? this._cwd, absolutePath);
    }
    /**
   * Determine whether parentPath is parent directory of path (includes the case where parentPath is same as path)
   *
   * @param parentPath - The possible parent path
   * @param path - The possible child path
   * @returns true if parentPath is parent directory of path or parent directory is same as path
   *
   */ isParentOf(parentPath, path) {
        let normalizedParentPath = this.normalizePath(parentPath);
        if (normalizedParentPath !== '/' && !normalizedParentPath.endsWith('/')) {
            normalizedParentPath += '/';
        }
        let normalizedPath = this.normalizePath(path);
        if (path !== '/' && !normalizedPath.endsWith('/')) {
            normalizedPath += '/';
        }
        return normalizedPath.startsWith(normalizedParentPath);
    }
    /**
   * Moves/renames a file or directory.
   *
   * @param sourcePath - Source path
   * @param targetPath - Target path
   * @param options - Move options
   *
   * @example
   * ```typescript
   * // Rename file
   * await fs.move('/old_name.txt', '/new_name.txt');
   *
   * // Move file to directory
   * await fs.move('/file.txt', '/subdir/file.txt');
   *
   * // Rename directory
   * await fs.move('/old_dir', '/new_dir');
   * ```
   */ async move(sourcePath, targetPath, options) {
        const normalizedSource = this.normalizePath(sourcePath);
        const normalizedTarget = this.normalizePath(targetPath);
        // Test for root directory restrictions
        this._validateRootRestrictions(normalizedSource, normalizedTarget);
        // 2. Test for crossing VFS boundary
        const sourceMount = this.getMountedVFS(normalizedSource);
        const targetMount = this.getMountedVFS(normalizedTarget);
        if (sourceMount || targetMount) {
            const sourceVFS = sourceMount ? sourceMount.vfs : this;
            const targetVFS = targetMount ? targetMount.vfs : this;
            if (sourceVFS !== targetVFS) {
                throw new VFSError('Cross-VFS move is not supported', 'EXDEV', normalizedSource);
            }
            if (sourceMount && targetMount && sourceMount.vfs === targetMount.vfs) {
                sourceMount.vfs.move(sourceMount.relativePath, targetMount.relativePath, options);
            }
        }
        // Check for type compatibility
        await this._validateTypeCompatibility(normalizedSource, normalizedTarget, options);
        if (this._readOnly) {
            throw new VFSError('File system is read-only', 'EROFS', normalizedSource);
        }
        const sourceStat = await this.stat(normalizedSource);
        const itemType = sourceStat.isDirectory ? 'directory' : 'file';
        // Do moving operation
        await this._move(normalizedSource, normalizedTarget, options);
        this.onChange('moved', normalizedTarget, itemType);
    }
    /**
   * Makes new directory
   * @param path - Directory path
   * @param recursive - If true, create parent directory if not exists
   */ async makeDirectory(path, recursive) {
        const normalizedPath = this.normalizePath(path);
        if (this.simpleMounts.has(normalizedPath)) {
            throw new VFSError('Is a directory', 'EISDIR', normalizedPath);
        }
        const mounted = this.getMountedVFS(normalizedPath);
        if (mounted) {
            mounted.vfs.makeDirectory(mounted.relativePath, recursive);
        }
        if (this._readOnly) {
            throw new VFSError('File system is read-only', 'EROFS', normalizedPath);
        }
        await this._makeDirectory(normalizedPath, recursive ?? false);
        this.onChange('created', normalizedPath, 'directory');
    }
    async readDirectory(path, options) {
        const normalizedPath = this.normalizePath(path);
        if (this.simpleMounts.has(normalizedPath)) {
            const v = this.simpleMounts.get(normalizedPath);
            const childEntries = await v.readDirectory('/', options).catch(()=>[]);
            return childEntries.map((e)=>({
                    ...e,
                    path: PathUtils.normalize(PathUtils.join(normalizedPath, e.path === '/' ? '' : e.path))
                }));
        }
        const mounted = this.getMountedVFS(normalizedPath);
        if (mounted) {
            const childEntries = await mounted.vfs.readDirectory(mounted.relativePath, options);
            // Rewrite child paths back to host namespace: <mountPath>/<childPath>
            return childEntries.map((e)=>({
                    ...e,
                    path: PathUtils.normalize(PathUtils.join(mounted.mountPath, e.path === '/' ? '' : e.path))
                }));
        }
        const entries = await this._readDirectory(normalizedPath, options);
        return this.injectDirectMountDirs(normalizedPath, entries, options);
    }
    async deleteDirectory(path, recursive) {
        const normalizedPath = this.normalizePath(path);
        const exists = await this.exists(normalizedPath);
        if (!exists) {
            return;
        }
        const stat = await this.stat(normalizedPath);
        if (!stat.isDirectory) {
            throw new VFSError('Target path is not a directory', 'ENOTDIR', normalizedPath);
        }
        for (const mountPath of this.sortedMountPaths){
            if ((mountPath.endsWith('/') ? mountPath : `${mountPath}/`).startsWith(normalizedPath.endsWith('/') ? normalizedPath : normalizedPath + '/')) {
                // Attempt to delete a mounted path or it's parent
                throw new VFSError('Cannot delete a directory that contains mounted subdirectories. Unmount them first.', 'EBUSY', normalizedPath);
            }
        }
        const mounted = this.getMountedVFS(normalizedPath);
        if (mounted) {
            mounted.vfs.deleteDirectory(mounted.relativePath, recursive);
        }
        if (this._readOnly) {
            throw new VFSError('File system is read-only', 'EROFS', normalizedPath);
        }
        await this._deleteDirectory(normalizedPath, recursive ?? false);
        this.onChange('deleted', normalizedPath, 'directory');
    }
    /**
   * Read from a VFS file
   * @param path - File path to read
   * @param options - Read options
   * @returns The file contents
   */ async readFile(path, options) {
        // Special case for Object URL and Data URL
        if (this.isObjectURL(path) || this.parseDataURI(path)) {
            try {
                const response = await fetch(path);
                if (!response.ok) {
                    throw new VFSError('Failed to fetch', 'ENOENT', path);
                }
                let data;
                if (options?.encoding === 'utf8') {
                    data = await response.text();
                } else if (options?.encoding === 'base64') {
                    const arrayBuffer = await response.arrayBuffer();
                    const bytes = new Uint8Array(arrayBuffer);
                    data = btoa(String.fromCodePoint(...bytes));
                } else {
                    data = await response.arrayBuffer();
                }
                return data;
            } catch (err) {
                throw new VFSError(`Failed to fetch: ${err}`, 'EIO', path);
            }
        }
        const normalizedPath = this.normalizePath(path);
        if (this.simpleMounts.has(normalizedPath)) {
            throw new VFSError('Is a directory', 'EISDIR', normalizedPath);
        }
        const mounted = this.getMountedVFS(normalizedPath);
        if (mounted) {
            return mounted.vfs.readFile(mounted.relativePath, options);
        }
        return this._readFile(normalizedPath, options);
    }
    /**
   * Write to a VFS file
   * @param path - File path to write
   * @param data - Data to be written
   * @param options - Write options
   */ async writeFile(path, data, options) {
        const normalizedPath = this.normalizePath(path);
        if (this.simpleMounts.has(normalizedPath)) {
            throw new VFSError('Is a directory', 'EISDIR', normalizedPath);
        }
        const mounted = this.getMountedVFS(normalizedPath);
        if (mounted) {
            mounted.vfs.writeFile(mounted.relativePath, data, options);
        }
        if (this._readOnly) {
            throw new VFSError('File system is read-only', 'EROFS', normalizedPath);
        }
        const existed = await this._exists(normalizedPath);
        if (existed) {
            const stat = await this._stat(normalizedPath);
            if (stat.isDirectory) {
                throw new VFSError('Is a directory', 'EISDIR', normalizedPath);
            }
        }
        await this._writeFile(normalizedPath, data, options);
        this.onChange(existed ? 'modified' : 'created', normalizedPath, 'file');
    }
    /**
   * Deletes a VFS file
   * @param path - File path to delete
   */ async deleteFile(path) {
        const normalizedPath = this.normalizePath(path);
        if (this.simpleMounts.has(normalizedPath)) {
            throw new VFSError('Is a directory', 'EISDIR', normalizedPath);
        }
        const mounted = this.getMountedVFS(normalizedPath);
        if (mounted) {
            mounted.vfs.deleteFile(mounted.relativePath);
        }
        if (this._readOnly) {
            throw new VFSError('File system is read-only', 'EROFS', normalizedPath);
        }
        await this._deleteFile(normalizedPath);
        this.onChange('deleted', normalizedPath, 'file');
    }
    /**
   * Test whether a VFS file or directory exists for given path
   * @param path - Path to test
   * @returns true if exists
   */ async exists(path) {
        const normalizedPath = this.normalizePath(path);
        if (this.simpleMounts.has(normalizedPath)) {
            return true;
        }
        const mounted = this.getMountedVFS(normalizedPath);
        if (mounted) {
            return mounted.vfs.exists(mounted.relativePath);
        }
        return this._exists(normalizedPath);
    }
    /**
   * Gets the statistics about a given path
   * @param path - path
   * @returns Statistics about the path
   */ async stat(path) {
        const normalizedPath = this.normalizePath(path);
        if (this.simpleMounts.has(normalizedPath)) {
            return {
                size: 0,
                isFile: false,
                isDirectory: true,
                created: new Date(0),
                modified: new Date(0)
            };
        }
        const mounted = this.getMountedVFS(normalizedPath);
        if (mounted) {
            return mounted.vfs.stat(mounted.relativePath);
        }
        return this._stat(normalizedPath);
    }
    /**
   * Copies a VFS file
   * @param src - Source file path
   * @param dest - Destination file path
   * @param options - Copy options
   */ async copyFile(src, dest, options) {
        // Detect if we are copying to a mounted VFS
        const destMount = this.getMountedVFS(dest);
        const targetVFS = options?.targetVFS ?? (destMount ? destMount.vfs : this);
        const overwrite = !!options?.overwrite;
        // Check if target VFS is writable
        if (targetVFS._readOnly) {
            throw new VFSError('Target VFS is read-only', 'EROFS', dest);
        }
        const normalizedSrc = this.normalizePath(src);
        const normalizedDest = targetVFS.normalizePath(destMount ? destMount.relativePath : dest);
        // Check source file
        if (!await this.exists(normalizedSrc)) {
            throw new VFSError(`Source file does not exist: ${normalizedSrc}`, 'ENOENT', normalizedSrc);
        }
        const sourceStat = await this.stat(normalizedSrc);
        if (!sourceStat.isFile) {
            throw new VFSError('Source path is not a file', 'EISDIR', normalizedSrc);
        }
        // Check target file
        const targetExists = await targetVFS.exists(normalizedDest);
        if (targetExists && !overwrite) {
            throw new VFSError('Target file already exists', 'EEXIST', normalizedDest);
        }
        if (targetExists) {
            const tStat = await targetVFS.stat(normalizedDest);
            if (tStat.isDirectory) {
                throw new VFSError('Target path is a directory', 'EISDIR', normalizedDest);
            }
        }
        // Make sure target directory exists
        const parentDir = targetVFS.dirname(normalizedDest);
        if (!await targetVFS.exists(parentDir)) {
            await targetVFS.makeDirectory(parentDir, true);
        }
        // Copy file
        const data = await this.readFile(normalizedSrc, {
            encoding: 'binary'
        });
        await targetVFS.writeFile(normalizedDest, data, {
            create: true,
            encoding: 'binary'
        });
    }
    /**
   * Copy multiple files matching a pattern to a target directory
   *
   * @param sourcePattern - Source pattern (glob pattern, file path, or array of file paths)
   * @param targetDirectory - Target directory path
   * @param options - Copy options (can include targetVFS for cross-VFS copy)
   * @returns Copy operation result
   *
   * @example
   * ```typescript
   * // Copy all .txt files to backup directory
   * const result = await vfs.copyFileEx('/data/*.txt', '/backup');
   *
   * // Copy directory to different VFS
   * const result = await vfsA.copyFileEx('DirToCopy/**\/*', 'Foo/DirToCopy', {
   *   overwrite: true,
   *   targetVFS: vfsB
   * });
   *
   * // Copy specific files
   * const result = await vfs.copyFileEx(['/file1.txt', '/file2.txt'], '/backup');
   * ```
   */ async copyFileEx(sourcePattern, targetDirectory, options) {
        // Detect if we are copying to mounted VFS
        const targetMount = this.getMountedVFS(targetDirectory);
        const targetVFS = options?.targetVFS ?? (targetMount ? targetMount.vfs : this);
        const overwrite = !!options?.overwrite;
        if (targetVFS._readOnly) {
            throw new VFSError('Target VFS is read-only', 'EROFS', targetDirectory);
        }
        try {
            const normalizedTargetDir = targetVFS.normalizePath(targetMount ? targetMount.relativePath : targetDirectory);
            // Make sure that target directory exists
            if (!await targetVFS.exists(normalizedTargetDir)) {
                await targetVFS.makeDirectory(normalizedTargetDir, true);
            } else {
                const targetStat = await targetVFS.stat(normalizedTargetDir);
                if (!targetStat.isDirectory) {
                    throw new VFSError('Target path is not a directory', 'ENOTDIR', normalizedTargetDir);
                }
            }
            // Calculate source file list
            let filesToCopy = [];
            if (Array.isArray(sourcePattern)) {
                filesToCopy = sourcePattern;
            } else {
                filesToCopy = await this.expandGlobPattern(sourcePattern, options?.cwd);
            }
            // Copy files
            let copied = 0;
            options?.onProgress?.(copied, filesToCopy.length);
            for (const sourcePath of filesToCopy){
                try {
                    if (!await this.exists(sourcePath)) {
                        console.warn(`Source file missing: ${sourcePath}`);
                        continue;
                    }
                    const sourceStat = await this.stat(sourcePath);
                    const targetFilePath = this.calculateTargetPath(sourcePattern, sourcePath, normalizedTargetDir);
                    // Get relative mounted paths of target files
                    const targetRel = targetMount?.vfs === targetVFS ? targetVFS.normalizePath(PathUtils.relative(targetMount.mountPath, targetFilePath)) : targetFilePath;
                    if (sourceStat.isDirectory) {
                        await targetVFS.makeDirectory(targetRel, true);
                        continue;
                    }
                    const exists = await targetVFS.exists(targetRel);
                    if (exists && !overwrite) {
                        continue;
                    }
                    const parent = targetVFS.dirname(targetRel);
                    if (!await targetVFS.exists(parent)) {
                        await targetVFS.makeDirectory(parent, true);
                    }
                    const data = await this.readFile(sourcePath, {
                        encoding: 'binary'
                    });
                    await targetVFS.writeFile(targetRel, data, {
                        create: true,
                        encoding: 'binary'
                    });
                    options?.onProgress?.(++copied, filesToCopy.length);
                } catch (err) {
                    console.error(String(err));
                }
            }
        } catch (err) {
            console.error(String(err));
        }
    }
    /**
   * Query file list by matching pattern(s)
   * @param pattern - Matching pattern(s)
   * @param options - Matching options
   * @returns Informations of matching files
   */ async glob(pattern, options = {}) {
        const { recursive = true, includeHidden = false, includeDirs = false, includeFiles = true, caseSensitive = true, cwd = this._cwd, ignore = [], limit } = options;
        const patterns = (Array.isArray(pattern) ? pattern : [
            pattern
        ]).filter((pattern)=>!!pattern);
        if (patterns.length === 0) {
            return [];
        }
        const ignorePatterns = Array.isArray(ignore) ? ignore : [
            ignore
        ];
        const matchers = patterns.map((p)=>new GlobMatcher(p, caseSensitive));
        const ignoreMatchers = ignorePatterns.map((p)=>new GlobMatcher(p, caseSensitive));
        const results = [];
        const normalizedCwd = this.normalizePath(cwd);
        const searchDirectory = async (dirPath, depth = 0)=>{
            if (limit && results.length >= limit) {
                return;
            }
            try {
                const entries = await this.readDirectory(dirPath, {
                    includeHidden: true
                });
                for (const entry of entries){
                    if (limit && results.length >= limit) {
                        break;
                    }
                    const fullPath = entry.path;
                    // Calculates the relative path about the search directory
                    let relativePath;
                    if (fullPath === normalizedCwd) {
                        relativePath = '.';
                    } else if (fullPath.startsWith(normalizedCwd + '/')) {
                        relativePath = fullPath.substring(normalizedCwd.length + 1);
                    } else if (normalizedCwd === '/' && fullPath.startsWith('/')) {
                        relativePath = fullPath.substring(1);
                    } else {
                        continue;
                    }
                    // Filter hidden files
                    if (!includeHidden && entry.name.startsWith('.')) {
                        if (recursive && entry.type === 'directory') {
                            await searchDirectory(fullPath, depth + 1);
                        }
                        continue;
                    }
                    // Test for ignore patterns
                    const shouldIgnore = ignoreMatchers.some((matcher)=>matcher.test(relativePath) || matcher.test(fullPath));
                    if (shouldIgnore) {
                        if (recursive && entry.type === 'directory') {
                            await searchDirectory(fullPath, depth + 1);
                        }
                        continue;
                    }
                    let matched = false;
                    let matchedPattern = '';
                    for (const matcher of matchers){
                        if (matcher.test(relativePath) || matcher.test(fullPath)) {
                            matched = true;
                            matchedPattern = matcher.getPattern();
                            break;
                        }
                    }
                    if (entry.type === 'directory') {
                        if (includeDirs) {
                            const result = {
                                ...entry,
                                relativePath,
                                matchedPattern: matched ? matchedPattern : null
                            };
                            results.push(result);
                        }
                    } else if (matched && includeFiles) {
                        const result = {
                            ...entry,
                            relativePath,
                            matchedPattern
                        };
                        results.push(result);
                    }
                    // Search sub-directorys recursively
                    if (recursive && entry.type === 'directory') {
                        await searchDirectory(fullPath, depth + 1);
                    }
                }
            } catch (error) {
                if (depth === 0) {
                    console.warn(`Cannot access directory: ${dirPath}`, error);
                }
            }
        };
        await searchDirectory(normalizedCwd);
        return results;
    }
    guessMIMEType(path) {
        const dataUriMatchResult = this.parseDataURI(path);
        if (dataUriMatchResult) {
            return dataUriMatchResult[1];
        } else {
            return guessMimeType(path);
        }
    }
    /**
   * Mounts another VFS at the specified path.
   *
   * Constraints/Behavior:
   * - Mount path can be an existing directory or non existing directory.
   * - Changes from child VFS will bubble to host namespace (path is rewritten with mount prefix)
   *
   * @param path - The path where to mount the VFS
   * @param vfs - The VFS instance to mount
   */ async mount(path, vfs) {
        const normalizedPath = PathUtils.normalize(path);
        // Register mount
        this.simpleMounts.set(normalizedPath, vfs);
        this.sortedMountPaths = Array.from(this.simpleMounts.keys()).sort((a, b)=>b.length - a.length);
        // Bubble child's events with host mount prefix
        const callback = (type, subPath, itemType)=>{
            const rel = subPath === '/' ? '' : subPath;
            const hostPath = PathUtils.normalize(PathUtils.join(normalizedPath, rel));
            this.onChange(type, hostPath, itemType);
        };
        this.mountChangeCallbacks.set(normalizedPath, callback);
        vfs.on('changed', callback, this);
    }
    /**
   * Unmounts a VFS from the specified path.
   *
   * Behavior:
   * - Removes the mount record.
   * - If the mount directory was auto-created by this VFS and `cleanupOnUnmount` is true,
   *   it will be removed only if it is still empty.
   *
   * @param path - The path to unmount
   * @returns True if a VFS was unmounted, false otherwise
   */ async unmount(path) {
        const normalizedPath = PathUtils.normalize(path);
        const vfs = this.simpleMounts.get(normalizedPath);
        if (!vfs) {
            return false;
        }
        vfs.off('changed', this.mountChangeCallbacks.get(normalizedPath));
        this.simpleMounts.delete(normalizedPath);
        this.mountChangeCallbacks.delete(normalizedPath);
        // Rebuild sorted mount paths
        this.sortedMountPaths = Array.from(this.simpleMounts.keys()).sort((a, b)=>b.length - a.length);
        return true;
    }
    /**
   * Closes file system and release resources
   */ async close() {
        for (const path of this.simpleMounts.keys()){
            await this.unmount(path);
        }
        await this.onClose();
    }
    /** @internal */ setReadonly(readonly) {
        this._readOnly = !!readonly;
    }
    /** @internal */ onClose() {}
    /**
   * Gets the mounted VFS for a given path, if any.
   *
   * Uses improved path matching to ensure the longest matching mount path is selected.
   *
   * @param path - The path to check for mounts
   * @returns Mount information if found, null otherwise
   *
   * @internal
   */ getMountedVFS(path) {
        const normalizedPath = PathUtils.normalize(path);
        // Use sorted mount path so we can matching the longest path
        for (const mountPath of this.sortedMountPaths){
            if (normalizedPath === mountPath || normalizedPath.startsWith(mountPath + '/')) {
                const relativePath = normalizedPath === mountPath ? '/' : normalizedPath.slice(mountPath.length);
                return {
                    mountPath,
                    vfs: this.simpleMounts.get(mountPath),
                    relativePath
                };
            }
        }
        return null;
    }
    /**
   * VFS file changing event
   * @param type - Change type
   * @param path - File path that causes changing
   * @param itemType - File type
   */ onChange(type, path, itemType) {
        this.dispatchEvent('changed', type, path, itemType);
    }
    /**
   * Calculate target file path preserving relative directory structure
   */ calculateTargetPath(sourcePattern, sourcePath, targetDirectory) {
        if (Array.isArray(sourcePattern)) {
            // For explicit file list, just use filename
            const fileName = this.basename(sourcePath);
            return PathUtils.join(targetDirectory, fileName);
        }
        // For glob patterns, preserve relative structure
        const patternDir = this.extractPatternDirectory(sourcePattern);
        const normalizedPatternDir = this.normalizePath(patternDir);
        const normalizedSourcePath = this.normalizePath(sourcePath);
        if (normalizedSourcePath.startsWith(normalizedPatternDir)) {
            const relativePath = PathUtils.relative(normalizedPatternDir, normalizedSourcePath);
            return PathUtils.join(targetDirectory, relativePath);
        } else {
            // Fallback to just filename
            const fileName = this.basename(sourcePath);
            return PathUtils.join(targetDirectory, fileName);
        }
    }
    /**
   * Expand a glob pattern to a list of matching file paths
   */ async expandGlobPattern(pattern, cwd) {
        const matchedFiles = [];
        if (pattern.includes('*') || pattern.includes('?')) {
            // It's a glob pattern - use existing glob method
            const globResults = await this.glob(pattern, {
                includeFiles: true,
                includeDirs: true,
                includeHidden: true,
                recursive: pattern.includes('**'),
                cwd: cwd ?? this._cwd
            });
            matchedFiles.push(...globResults.map((result)=>result.path));
        } else {
            // It's a regular path
            const normalizedPattern = this.normalizePath(pattern);
            if (await this.exists(normalizedPattern)) {
                const stat = await this.stat(normalizedPattern);
                if (stat.isFile) {
                    matchedFiles.push(normalizedPattern);
                }
            }
        }
        return matchedFiles;
    }
    /**
   * Extract the directory part from a glob pattern
   */ extractPatternDirectory(pattern) {
        // Process absolute path
        if (pattern.startsWith('/')) {
            const parts = pattern.substring(1).split('/'); // 移除开头的 /
            const dirParts = [];
            for (const part of parts){
                if (part.includes('*') || part.includes('?')) {
                    break;
                }
                dirParts.push(part);
            }
            if (dirParts.length === 0) {
                return '/';
            }
            return '/' + dirParts.join('/');
        } else {
            // Relative path
            const parts = pattern.split('/');
            const dirParts = [];
            for (const part of parts){
                if (part.includes('*') || part.includes('?')) {
                    break;
                }
                dirParts.push(part);
            }
            return dirParts.length > 0 ? dirParts.join('/') : '.';
        }
    }
    _validateRootRestrictions(sourcePath, targetPath) {
        // Can not move root directory
        if (sourcePath === '/') {
            throw new VFSError('Cannot move root directory', 'EINVAL', sourcePath);
        }
        // Can not move to root directory
        if (targetPath === '/') {
            throw new VFSError('Cannot move to root directory', 'EINVAL', targetPath);
        }
        // Can not move to sub-directory of source path
        if (targetPath.startsWith(sourcePath + '/')) {
            throw new VFSError('Cannot move directory to its subdirectory', 'EINVAL', sourcePath);
        }
        const cwd = this.getCwd();
        // Moving CWD is not allowed
        if (sourcePath === cwd) {
            throw new VFSError('Cannot move current working directory', 'EBUSY', sourcePath);
        }
        // Moving parent directory of CWD is not allowed
        if (cwd.startsWith(sourcePath + '/')) {
            throw new VFSError('Cannot move parent directory of current working directory', 'EBUSY', sourcePath);
        }
    }
    injectDirectMountDirs(dirPath, entries, options) {
        const existing = new Set(entries.map((e)=>e.name));
        const parentPrefix = dirPath === '/' ? '/' : dirPath + '/';
        for (const mountPath of this.simpleMounts.keys()){
            if (!mountPath.startsWith(parentPrefix)) {
                continue;
            }
            if (mountPath === dirPath) {
                continue;
            }
            const remainder = mountPath.slice(parentPrefix.length);
            if (remainder.length === 0) {
                continue;
            }
            if (remainder.includes('/')) {
                continue;
            }
            const name = remainder;
            if (existing.has(name)) {
                continue;
            }
            if (options?.includeHidden === false && name.startsWith('.')) {
                continue;
            }
            const meta = {
                name,
                path: PathUtils.normalize(PathUtils.join(dirPath, name)),
                size: 0,
                type: 'directory',
                created: new Date(0),
                modified: new Date(0)
            };
            entries.push(meta);
            existing.add(name);
        }
        return entries;
    }
    async _validateTypeCompatibility(sourcePath, targetPath, options) {
        const sourceExists = await this.exists(sourcePath);
        if (!sourceExists) {
            throw new VFSError('Source path does not exist', 'ENOENT', sourcePath);
        }
        const sourceStat = await this.stat(sourcePath);
        // Test existence of target path
        const targetExists = await this.exists(targetPath);
        if (targetExists) {
            if (!options?.overwrite) {
                throw new VFSError('Target already exists', 'EEXIST', targetPath);
            }
            const targetStat = await this.stat(targetPath);
            // Must be same type
            if (sourceStat.isFile !== targetStat.isFile || sourceStat.isDirectory !== targetStat.isDirectory) {
                throw new VFSError('Cannot move file to directory or directory to file', 'EISDIR', sourcePath);
            }
        }
    }
}

/**
 * HTTP-backed virtual file system.
 *
 * Provides a read-only VFS implementation that resolves files via HTTP(S).
 * Supports:
 * - File reads via `GET`
 * - Existence/stat probing via `HEAD`
 * - Optional directory listing via pluggable {@link HttpDirectoryReader}s
 *
 * Limitations:
 * - This FS is read-only; mutating operations throw `VFSError` with code `"EROFS"`.
 * - Partial reads (HTTP range) are not implemented yet.
 *
 * @public
 */ class HttpFS extends VFS {
    baseOrigin;
    basePath;
    options;
    dirReaders;
    /**
   * Creates an HTTP file system rooted at `baseURL`.
   *
   * All relative VFS paths are resolved against `baseURL` and fetched using
   * the configured options.
   *
   * @param baseURL - Base URL of the HTTP root. Can be absolute or relative to `window.location`.
   * @param options - Optional HTTP and directory-reading configuration.
   */ constructor(baseURL, options = {}){
        super(true); // Readonly
        baseURL = baseURL || './';
        const url = new URL(baseURL, window.location.href);
        this.basePath = url.pathname;
        if (this.basePath.endsWith('/')) {
            this.basePath = this.basePath.slice(0, -1);
        }
        this.baseOrigin = url.origin;
        this.options = {
            timeout: 30000,
            ...options
        };
        this.dirReaders = Array.isArray(options.directoryReader) ? options.directoryReader : options.directoryReader ? [
            options.directoryReader
        ] : [];
    }
    /**
   * Optional URL resolver hook that transforms VFS paths into concrete URLs.
   *
   * If present, it is applied by {@link VFS.normalizePath} before other checks.
   */ get urlResolver() {
        return this.options.urlResolver ?? null;
    }
    set urlResolver(resolver) {
        this.options.urlResolver = resolver;
    }
    /**
   * Normalizes a VFS path for HTTP use.
   *
   * Behavior:
   * - Applies `urlResolver` if provided.
   * - If the result is a data URI or an object URL, it is returned as-is.
   * - Otherwise falls back to the base VFS `normalizePath` logic.
   *
   * @param path - Input VFS path or URL-like string.
   * @returns Normalized path or URL.
   */ normalizePath(path) {
        if (this.options.urlResolver) {
            path = this.options.urlResolver(path);
        }
        path = path.trim();
        if (this.parseDataURI(path) || this.isObjectURL(path) || this.isAbsoluteURL(path)) {
            return path;
        }
        return super.normalizePath(path);
    }
    setReadonly(readonly) {
        if (!readonly) {
            console.error('Http VFS is always read-only');
        }
    }
    /** {@inheritDoc VFS._makeDirectory} */ async _makeDirectory(path) {
        throw new VFSError('HTTP file system is read-only', 'EROFS', path);
    }
    /** {@inheritDoc VFS._readDirectory} */ async _readDirectory(path, options) {
        const normalized = this.normalizePath(path);
        const dirPath = normalized.endsWith('/') ? normalized : normalized + '/';
        if (!this.dirReaders.length) {
            throw new VFSError('No HttpDirectoryReader configured for HttpFS', 'ENOTSUP', dirPath);
        }
        const ctx = {
            fetch: (url, init)=>this.fetchWithTimeout(url, init),
            toURL: (p)=>this.toAbsoluteURL(p),
            normalizePath: (p)=>super.normalizePath(p),
            joinPath: (...parts)=>PathUtils.join(...parts),
            guessMimeType: (name)=>this.guessMIMEType(name)
        };
        const reader = await this.selectReader(dirPath, ctx);
        if (!reader) {
            console.warn('No directory reader can handle this directory');
            return [];
        }
        let layer = await reader.readOnce(dirPath, ctx);
        const includeHidden = options?.includeHidden ?? false;
        layer = layer.filter((e)=>includeHidden || !e.name.startsWith('.'));
        if (options?.pattern) {
            const pattern = options.pattern;
            if (typeof pattern === 'string') {
                const matcher = new GlobMatcher(pattern, true);
                layer = layer.filter((e)=>matcher.test(e.name) || matcher.test(e.path));
            } else {
                layer = layer.filter((e)=>pattern.test(e.name) || pattern.test(e.path));
            }
        }
        if (!options?.recursive) {
            return layer;
        }
        const out = [
            ...layer
        ];
        for (const e of layer){
            if (e.type === 'directory') {
                try {
                    const sub = await this._readDirectory(e.path, options);
                    out.push(...sub);
                } catch  {
                // ignore
                }
            }
        }
        return out;
    }
    /** {@inheritDoc VFS._deleteDirectory} */ async _deleteDirectory(path) {
        throw new VFSError('HTTP file system is read-only', 'EROFS', path);
    }
    /** {@inheritDoc VFS._readFile} */ async _readFile(path, options) {
        try {
            const response = await this.fetchWithTimeout(path);
            if (!response.ok) {
                if (response.status === 404) {
                    throw new VFSError('File not found', 'ENOENT', path);
                } else if (response.status === 403) {
                    throw new VFSError('Access denied', 'EACCES', path);
                } else if (response.status >= 500) {
                    throw new VFSError('Server error', 'EIO', path);
                } else {
                    throw new VFSError(`HTTP error ${response.status}: ${response.statusText}`, 'EIO', path);
                }
            }
            if (options?.offset !== undefined || options?.length !== undefined) {
            // TODO: HTTP Range request
            }
            let data;
            if (options?.encoding === 'utf8') {
                data = await response.text();
            } else if (options?.encoding === 'base64') {
                const arrayBuffer = await response.arrayBuffer();
                const bytes = new Uint8Array(arrayBuffer);
                data = uint8ArrayToBase64(bytes);
            } else {
                data = await response.arrayBuffer();
            }
            return data;
        } catch (error) {
            if (error instanceof VFSError) {
                throw error;
            }
            throw new VFSError(`Failed to read file: ${error}`, 'EIO', path);
        }
    }
    /** {@inheritDoc VFS._writeFile} */ async _writeFile(path, _data, _options) {
        throw new VFSError('HTTP file system is read-only', 'EROFS', path);
    }
    /** {@inheritDoc VFS._deleteFile} */ async _deleteFile(path) {
        throw new VFSError('HTTP file system is read-only', 'EROFS', path);
    }
    /** {@inheritDoc VFS._exists} */ async _exists(path) {
        const normalizedPath = this.normalizePath(path);
        try {
            const response = await this.fetchWithTimeout(normalizedPath, {
                method: 'HEAD'
            });
            return response.ok;
        } catch  {
            return false;
        }
    }
    /** {@inheritDoc VFS._stat} */ async _stat(path) {
        try {
            const response = await this.fetchWithTimeout(path, {
                method: 'HEAD'
            });
            if (!response.ok) {
                if (response.status === 404) {
                    throw new VFSError('File not found', 'ENOENT', path);
                } else {
                    throw new VFSError(`HTTP error ${response.status}`, 'EIO', path);
                }
            }
            const size = parseInt(response.headers.get('content-length') || '0');
            const lastModified = response.headers.get('last-modified');
            const contentType = response.headers.get('content-type');
            const isDirectory = !!contentType && contentType.includes('text/html') && path.endsWith('/');
            const modifiedDate = lastModified ? new Date(lastModified) : new Date();
            return {
                size,
                isFile: !isDirectory,
                isDirectory,
                created: modifiedDate,
                modified: modifiedDate,
                accessed: modifiedDate
            };
        } catch (error) {
            if (error instanceof VFSError) {
                throw error;
            }
            throw new VFSError(`Failed to stat file: ${error}`, 'EIO', path);
        }
    }
    /** {@inheritDoc VFS._deleteFileSystem} */ async _deleteFileSystem() {
        return;
    }
    /** {@inheritDoc VFS._wipe} */ async _wipe() {
        return;
    }
    /** {@inheritDoc VFS._move} */ async _move() {
        throw new VFSError('HTTP file system is read-only', 'EROFS');
    }
    toAbsoluteURL(url) {
        // Specical URL case, just return
        if (this.isObjectURL(url) || this.parseDataURI(url) || this.isAbsoluteURL(url)) {
            return url;
        }
        // Split path, search parameters and hash
        const [pathPart, ...rest] = url.split('?');
        const queryAndHash = rest.join('?'); // Merge multiple '?'s
        const [query, hash] = queryAndHash ? queryAndHash.split('#') : [
            '',
            ''
        ];
        // Encode path
        const joinedPath = this.join(this.basePath, pathPart);
        const encodedPath = joinedPath.split('/').map((segment)=>{
            if (!segment || segment === '.' || segment === '..') {
                return segment;
            }
            // Avoid duplicated encoding
            try {
                return decodeURIComponent(segment) === segment ? encodeURIComponent(segment) : segment;
            } catch  {
                return encodeURIComponent(segment);
            }
        }).join('/');
        // Construct base URL
        const baseUrl = new URL(encodedPath, this.baseOrigin);
        // Add search parameters
        if (query) {
            baseUrl.search = query.includes('%') ? query : new URLSearchParams(query).toString();
        }
        // Add hash
        if (hash) {
            baseUrl.hash = hash;
        }
        return baseUrl.href;
    }
    async fetchWithTimeout(url, init) {
        const controller = new AbortController();
        const timeoutId = setTimeout(()=>controller.abort(), this.options.timeout);
        url = this.toAbsoluteURL(url);
        try {
            const response = await fetch(url, {
                ...init,
                signal: controller.signal,
                headers: {
                    ...this.options.headers,
                    ...init?.headers
                },
                credentials: this.options.credentials
            });
            return response;
        } finally{
            clearTimeout(timeoutId);
        }
    }
    async selectReader(dirPath, ctx) {
        if (this.dirReaders.length === 1) {
            return this.dirReaders[0];
        }
        for (const r of this.dirReaders){
            if (!r.canHandle) {
                continue;
            }
            try {
                if (await r.canHandle(dirPath, ctx)) {
                    return r;
                }
            } catch  {
            // ignore
            }
        }
        return null;
    }
}

/**
 * IndexedDB-based file system implementation.
 *
 * Provides a virtual file system interface using IndexedDB as the underlying storage.
 * Supports standard file operations like create, read, write, delete, and directory listing.
 *
 * @example
 * ```typescript
 * const fs = new IndexedDBFS('my-app-fs');
 * await fs.writeFile('/hello.txt', 'Hello World!');
 * const content = await fs.readFile('/hello.txt', { encoding: 'utf8' });
 * ```
 *
 * @public
 */ class IndexedDBFS extends VFS {
    db = null;
    dbName;
    storeName;
    /**
   * Creates a new IndexedDB file system.
   *
   * @param dbName - The name of the IndexedDB database to use
   * @param readonly - Whether the file system should be read-only
   */ constructor(dbName, storeName, readonly = false){
        super(readonly);
        this.dbName = dbName;
        this.storeName = storeName;
    }
    async _makeDirectory(path, recursive) {
        const parent = PathUtils.dirname(path);
        // Ensure parent directories outside the transaction
        if (parent !== '/' && parent !== path) {
            const parentExists = await this._exists(parent);
            if (!parentExists) {
                if (recursive) {
                    await this._makeDirectory(parent, true);
                } else {
                    throw new VFSError('Parent directory does not exist', 'ENOENT', parent);
                }
            }
        }
        // Making directory in a transaction
        const db = await this.ensureDB();
        return new Promise((resolve, reject)=>{
            const transaction = db.transaction([
                this.storeName
            ], 'readwrite');
            const store = transaction.objectStore(this.storeName);
            // Test existence
            const existsRequest = store.get(path);
            existsRequest.onsuccess = ()=>{
                const existing = existsRequest.result;
                if (existing) {
                    if (existing.type === 'directory') {
                        resolve();
                        return;
                    } else {
                        reject(new VFSError('File exists with same name', 'EEXIST', path));
                        return;
                    }
                }
                // Create directory
                const now = new Date();
                const metadata = {
                    name: PathUtils.basename(path),
                    path: path,
                    size: 0,
                    type: 'directory',
                    created: now,
                    modified: now,
                    parent: PathUtils.dirname(path),
                    data: null
                };
                const addRequest = store.add(metadata);
                addRequest.onsuccess = ()=>resolve();
                addRequest.onerror = ()=>reject(new VFSError('Failed to create directory', 'EIO', path));
            };
            existsRequest.onerror = ()=>reject(new VFSError('Failed to check directory existence', 'EIO', path));
        });
    }
    async _readDirectory(path, options) {
        return this.dbOperation('readonly', (store)=>{
            return new Promise((resolve, reject)=>{
                // Test directory existence
                const dirCheck = store.get(path);
                dirCheck.onsuccess = ()=>{
                    const dirRecord = dirCheck.result;
                    if (!dirRecord || dirRecord.type !== 'directory') {
                        reject(new VFSError('Directory does not exist', 'ENOENT', path));
                        return;
                    }
                    const results = [];
                    const index = store.index('parent');
                    if (options?.recursive) {
                        const request = store.openCursor();
                        request.onsuccess = (event)=>{
                            const cursor = event.target.result;
                            if (cursor) {
                                const record = cursor.value;
                                const recordPath = record.path;
                                if (recordPath !== path && (recordPath.startsWith(path + '/') || record.parent === path)) {
                                    const metadata = {
                                        name: record.name,
                                        path: recordPath,
                                        size: record.size,
                                        type: record.type,
                                        created: new Date(record.created),
                                        modified: new Date(record.modified)
                                    };
                                    if (this.matchesFilter(metadata, options)) {
                                        results.push(metadata);
                                    }
                                }
                                cursor.continue();
                            } else {
                                resolve(results);
                            }
                        };
                        request.onerror = ()=>reject(request.error);
                    } else {
                        const request = index.openCursor(IDBKeyRange.only(path));
                        request.onsuccess = (event)=>{
                            const cursor = event.target.result;
                            if (cursor) {
                                const record = cursor.value;
                                const metadata = {
                                    name: record.name,
                                    path: record.path,
                                    size: record.size,
                                    type: record.type,
                                    created: new Date(record.created),
                                    modified: new Date(record.modified)
                                };
                                if (this.matchesFilter(metadata, options)) {
                                    results.push(metadata);
                                }
                                cursor.continue();
                            } else {
                                resolve(results);
                            }
                        };
                        request.onerror = ()=>reject(request.error);
                    }
                };
                dirCheck.onerror = ()=>reject(dirCheck.error);
            });
        });
    }
    async _deleteDirectory(path, recursive) {
        const children = await this._readDirectory(path);
        if (children.length > 0 && !recursive) {
            throw new VFSError('Directory is not empty', 'ENOTEMPTY', path);
        }
        if (recursive && children.length > 0) {
            for (const child of children){
                if (child.type === 'directory') {
                    await this._deleteDirectory(child.path, true);
                } else {
                    await this._deleteFile(child.path);
                }
            }
        }
        return this.dbOperation('readwrite', (store)=>{
            return new Promise((resolve, reject)=>{
                const dirCheck = store.get(path);
                dirCheck.onsuccess = ()=>{
                    const dirRecord = dirCheck.result;
                    if (!dirRecord || dirRecord.type !== 'directory') {
                        reject(new VFSError('Directory does not exist', 'ENOENT', path));
                        return;
                    }
                    const deleteRequest = store.delete(path);
                    deleteRequest.onsuccess = ()=>resolve();
                    deleteRequest.onerror = ()=>reject(new VFSError('Failed to delete directory', 'EIO', path));
                };
                dirCheck.onerror = ()=>reject(dirCheck.error);
            });
        });
    }
    async _readFile(path, options) {
        return this.dbOperation('readonly', (store)=>{
            return new Promise((resolve, reject)=>{
                const request = store.get(path);
                request.onsuccess = ()=>{
                    const record = request.result;
                    if (!record || record.type !== 'file') {
                        reject(new VFSError(`File does not exist: ${path}`, 'ENOENT', path));
                        return;
                    }
                    let data = record.data;
                    const requestedEncoding = options?.encoding;
                    // Encoding conversion
                    if (requestedEncoding === 'utf8') {
                        if (data instanceof ArrayBuffer) {
                            data = new TextDecoder().decode(data);
                        }
                    } else if (requestedEncoding === 'base64') {
                        if (data instanceof ArrayBuffer) {
                            const bytes = new Uint8Array(data);
                            data = uint8ArrayToBase64(bytes);
                        } else if (typeof data === 'string') {
                            const bytes = new TextEncoder().encode(data);
                            data = uint8ArrayToBase64(bytes);
                        }
                    } else if (requestedEncoding === 'binary' || !requestedEncoding) {
                        if (typeof data === 'string') {
                            data = new TextEncoder().encode(data).buffer;
                        }
                    }
                    // Range read
                    if (options?.offset !== undefined || options?.length !== undefined) {
                        const offset = options.offset || 0;
                        const length = options.length;
                        if (data instanceof ArrayBuffer) {
                            const end = length !== undefined ? offset + length : data.byteLength;
                            data = data.slice(offset, end);
                        } else if (typeof data === 'string') {
                            const end = length !== undefined ? offset + length : data.length;
                            data = data.slice(offset, end);
                        }
                    }
                    resolve(data);
                };
                request.onerror = ()=>reject(new VFSError('Failed to read file', 'EIO', path));
            });
        });
    }
    async _writeFile(path, data, options) {
        const parent = PathUtils.dirname(path);
        if (parent !== '/') {
            const parentExists = await this._exists(parent);
            if (!parentExists) {
                if (options?.create) {
                    await this._makeDirectory(parent, true);
                } else {
                    throw new VFSError('Parent directory does not exist', 'ENOENT', parent);
                }
            }
        }
        return this.dbOperation('readwrite', (store)=>{
            return new Promise((resolve, reject)=>{
                const existingRequest = store.get(path);
                existingRequest.onsuccess = ()=>{
                    const existingRecord = existingRequest.result;
                    let fileData = data;
                    if (options?.append && existingRecord && existingRecord.type === 'file') {
                        const existingData = existingRecord.data;
                        if (typeof data === 'string' && typeof existingData === 'string') {
                            fileData = existingData + data;
                        } else if (data instanceof ArrayBuffer && existingData instanceof ArrayBuffer) {
                            const combined = new Uint8Array(existingData.byteLength + data.byteLength);
                            combined.set(new Uint8Array(existingData), 0);
                            combined.set(new Uint8Array(data), existingData.byteLength);
                            fileData = combined.buffer;
                        } else {
                            const existingStr = existingData instanceof ArrayBuffer ? new TextDecoder().decode(existingData) : existingData;
                            const newStr = data instanceof ArrayBuffer ? new TextDecoder().decode(data) : data;
                            fileData = existingStr + newStr;
                        }
                    }
                    if (options?.encoding === 'base64' && typeof fileData === 'string') {
                        try {
                            const bytes = base64ToUint8Array(fileData);
                            fileData = bytes.buffer;
                        } catch  {
                            reject(new VFSError('Invalid base64 data', 'EINVAL', path));
                            return;
                        }
                    }
                    const size = typeof fileData === 'string' ? new TextEncoder().encode(fileData).length : fileData.byteLength;
                    const now = new Date();
                    const created = existingRecord ? new Date(existingRecord.created) : now;
                    const record = {
                        name: PathUtils.basename(path),
                        path: path,
                        size: size,
                        type: 'file',
                        created: created,
                        modified: now,
                        parent: parent,
                        data: fileData
                    };
                    const saveRequest = existingRecord ? store.put(record) : store.add(record);
                    saveRequest.onsuccess = ()=>resolve();
                    saveRequest.onerror = ()=>reject(new VFSError(`Failed to ${existingRecord ? 'update' : 'create'} file`, 'EIO', path));
                };
                existingRequest.onerror = ()=>reject(new VFSError('Failed to check existing file', 'EIO', path));
            });
        });
    }
    async _deleteFile(path) {
        return this.dbOperation('readwrite', (store)=>{
            return new Promise((resolve, reject)=>{
                // Test file existence
                const checkRequest = store.get(path);
                checkRequest.onsuccess = ()=>{
                    const record = checkRequest.result;
                    if (!record || record.type !== 'file') {
                        reject(new VFSError(`File does not exist: ${path}`, 'ENOENT', path));
                        return;
                    }
                    const deleteRequest = store.delete(path);
                    deleteRequest.onsuccess = ()=>resolve();
                    deleteRequest.onerror = ()=>reject(new VFSError('Failed to delete file', 'EIO', path));
                };
                checkRequest.onerror = ()=>reject(new VFSError('Failed to check file existence', 'EIO', path));
            });
        });
    }
    async _exists(path) {
        return this.dbOperation('readonly', (store)=>{
            return new Promise((resolve, reject)=>{
                const request = store.get(path);
                request.onsuccess = ()=>{
                    resolve(!!request.result);
                };
                request.onerror = ()=>reject(new VFSError('Failed to check existence', 'EIO', path));
            });
        });
    }
    async _stat(path) {
        return this.dbOperation('readonly', (store)=>{
            return new Promise((resolve, reject)=>{
                const request = store.get(path);
                request.onsuccess = ()=>{
                    const record = request.result;
                    if (!record) {
                        reject(new VFSError('Path does not exist', 'ENOENT', path));
                        return;
                    }
                    resolve({
                        size: record.size,
                        isFile: record.type === 'file',
                        isDirectory: record.type === 'directory',
                        created: new Date(record.created),
                        modified: new Date(record.modified),
                        accessed: new Date(record.modified) // IndexedDB 不跟踪访问时间，使用修改时间
                    });
                };
                request.onerror = ()=>reject(new VFSError('Failed to get file stats', 'EIO', path));
            });
        });
    }
    async onClose() {
        if (this.db) {
            this.db.close();
            this.db = null;
        }
    }
    static async deleteDatabase(name) {
        return new Promise((resolve, reject)=>{
            const deleteRequest = indexedDB.deleteDatabase(name);
            deleteRequest.onsuccess = ()=>{
                resolve();
            };
            deleteRequest.onerror = ()=>{
                console.error(`Delete database "${name}" failed:`, deleteRequest.error);
                reject(deleteRequest.error);
            };
            deleteRequest.onblocked = ()=>{
                console.warn(`Delete database "${name}" blocked`);
            };
        });
    }
    async _wipe() {
        await this.close();
        await IndexedDBFS.deleteDatabase(this.dbName);
    }
    async _deleteFileSystem() {
        await this.close();
        const currentVersion = await this.getCurrentDatabaseVersion();
        return new Promise((resolve, reject)=>{
            const newVersion = currentVersion + 1;
            const request = indexedDB.open(this.dbName, newVersion);
            request.onupgradeneeded = (event)=>{
                const db = event.target.result;
                if (db.objectStoreNames.contains(this.storeName)) {
                    try {
                        db.deleteObjectStore(this.storeName);
                    } catch (error) {
                        console.error(`Failed to delete Object Store '${this.storeName}':`, error);
                        reject(new VFSError('Failed to delete object store', 'EIO', error?.toString()));
                        return;
                    }
                } else {
                    console.warn(`Object Store '${this.storeName}' does not exist`);
                }
            };
            request.onsuccess = (event)=>{
                const db = event.target.result;
                db.close();
                resolve();
            };
            request.onerror = ()=>{
                reject(new VFSError('Failed to upgrade database for store deletion', 'EIO', request.error?.message));
            };
            request.onblocked = ()=>{
                reject(new VFSError('Database upgrade blocked - close other connections first', 'EBUSY'));
            };
        });
    }
    async _move(sourcePath, targetPath, options) {
        return this.dbOperation('readwrite', (store)=>{
            return new Promise((resolve, reject)=>{
                const sourceRequest = store.get(sourcePath);
                sourceRequest.onsuccess = ()=>{
                    const sourceRecord = sourceRequest.result;
                    if (!sourceRecord) {
                        reject(new VFSError('Source path does not exist', 'ENOENT', sourcePath));
                        return;
                    }
                    const targetRequest = store.get(targetPath);
                    targetRequest.onsuccess = ()=>{
                        const targetRecord = targetRequest.result;
                        if (targetRecord && !options?.overwrite) {
                            reject(new VFSError('Target already exists', 'EEXIST', targetPath));
                            return;
                        }
                        const targetParent = PathUtils.dirname(targetPath);
                        const parentRequest = store.get(targetParent);
                        parentRequest.onsuccess = ()=>{
                            const parentRecord = parentRequest.result;
                            if (!parentRecord || parentRecord.type !== 'directory') {
                                reject(new VFSError('Target parent directory does not exist', 'ENOENT', targetParent));
                                return;
                            }
                            if (sourceRecord.type === 'file') {
                                this.moveFile(store, sourceRecord, targetPath, targetRecord, options, resolve, reject);
                            } else if (sourceRecord.type === 'directory') {
                                this.moveDirectory(store, sourcePath, targetPath, sourceRecord, targetRecord, options, resolve, reject);
                            }
                        };
                        parentRequest.onerror = ()=>{
                            reject(new VFSError('Failed to check target parent directory', 'EIO', targetParent));
                        };
                    };
                    targetRequest.onerror = ()=>{
                        reject(new VFSError('Failed to check target existence', 'EIO', targetPath));
                    };
                };
                sourceRequest.onerror = ()=>{
                    reject(new VFSError('Failed to check source existence', 'EIO', sourcePath));
                };
            });
        });
    }
    moveFile(store, sourceRecord, targetPath, targetRecord, options, resolve, reject) {
        const now = new Date();
        const newRecord = {
            ...sourceRecord,
            name: PathUtils.basename(targetPath),
            path: targetPath,
            parent: PathUtils.dirname(targetPath),
            modified: now
        };
        const handleUpdate = ()=>{
            const addRequest = store.put(newRecord);
            addRequest.onsuccess = ()=>{
                const deleteRequest = store.delete(sourceRecord.path);
                deleteRequest.onsuccess = ()=>resolve();
                deleteRequest.onerror = ()=>{
                    reject(new VFSError('Failed to delete source file', 'EIO', sourceRecord.path));
                };
            };
            addRequest.onerror = ()=>{
                reject(new VFSError('Failed to create target file', 'EIO', targetPath));
            };
        };
        if (targetRecord && options?.overwrite) {
            const deleteTargetRequest = store.delete(targetPath);
            deleteTargetRequest.onsuccess = handleUpdate;
            deleteTargetRequest.onerror = ()=>{
                reject(new VFSError('Failed to delete target file', 'EIO', targetPath));
            };
        } else {
            handleUpdate();
        }
    }
    moveDirectory(store, sourcePath, targetPath, sourceRecord, targetRecord, options, resolve, reject) {
        const itemsToMove = [];
        const sourcePrefix = sourcePath === '/' ? '/' : sourcePath + '/';
        const cursorRequest = store.openCursor();
        cursorRequest.onsuccess = (event)=>{
            const cursor = event.target.result;
            if (cursor) {
                const record = cursor.value;
                const recordPath = record.path;
                if (recordPath === sourcePath || recordPath.startsWith(sourcePrefix)) {
                    itemsToMove.push(record);
                }
                cursor.continue();
            } else {
                this.performDirectoryMove(store, itemsToMove, sourcePath, targetPath, targetRecord, options, resolve, reject);
            }
        };
        cursorRequest.onerror = ()=>{
            reject(new VFSError('Failed to scan directory contents', 'EIO', sourcePath));
        };
    }
    performDirectoryMove(store, itemsToMove, sourcePath, targetPath, targetRecord, options, resolve, reject) {
        if (itemsToMove.length === 0) {
            resolve();
            return;
        }
        const now = new Date();
        const sourcePrefix = sourcePath === '/' ? '/' : sourcePath + '/';
        const targetPrefix = targetPath === '/' ? '/' : targetPath + '/';
        let processed = 0;
        let hasError = false;
        const processMove = ()=>{
            for (const item of itemsToMove){
                if (hasError) {
                    break;
                }
                const oldPath = item.path;
                let newPath;
                if (oldPath === sourcePath) {
                    newPath = targetPath;
                } else {
                    newPath = oldPath.replace(sourcePrefix, targetPrefix);
                }
                const newRecord = {
                    ...item,
                    name: PathUtils.basename(newPath),
                    path: newPath,
                    parent: PathUtils.dirname(newPath),
                    modified: now
                };
                const addRequest = store.put(newRecord);
                addRequest.onsuccess = ()=>{
                    const deleteRequest = store.delete(oldPath);
                    deleteRequest.onsuccess = ()=>{
                        processed++;
                        if (processed === itemsToMove.length) {
                            resolve();
                        }
                    };
                    deleteRequest.onerror = ()=>{
                        if (!hasError) {
                            hasError = true;
                            reject(new VFSError(`Failed to delete source item: ${oldPath}`, 'EIO', oldPath));
                        }
                    };
                };
                addRequest.onerror = ()=>{
                    if (!hasError) {
                        hasError = true;
                        reject(new VFSError(`Failed to create target item: ${newPath}`, 'EIO', newPath));
                    }
                };
            }
        };
        if (targetRecord && options?.overwrite) {
            this.deleteDirectoryContents(store, targetPath, ()=>{
                processMove();
            }, reject);
        } else {
            processMove();
        }
    }
    deleteDirectoryContents(store, dirPath, onSuccess, onError) {
        const itemsToDelete = [];
        const dirPrefix = dirPath === '/' ? '/' : dirPath + '/';
        const cursorRequest = store.openCursor();
        cursorRequest.onsuccess = (event)=>{
            const cursor = event.target.result;
            if (cursor) {
                const record = cursor.value;
                const recordPath = record.path;
                if (recordPath === dirPath || recordPath.startsWith(dirPrefix)) {
                    itemsToDelete.push(recordPath);
                }
                cursor.continue();
            } else {
                if (itemsToDelete.length === 0) {
                    onSuccess();
                    return;
                }
                let deleted = 0;
                let hasError = false;
                for (const pathToDelete of itemsToDelete){
                    if (hasError) {
                        break;
                    }
                    const deleteRequest = store.delete(pathToDelete);
                    deleteRequest.onsuccess = ()=>{
                        deleted++;
                        if (deleted === itemsToDelete.length) {
                            onSuccess();
                        }
                    };
                    deleteRequest.onerror = ()=>{
                        if (!hasError) {
                            hasError = true;
                            onError(new VFSError(`Failed to delete existing item: ${pathToDelete}`, 'EIO', pathToDelete));
                        }
                    };
                }
            }
        };
        cursorRequest.onerror = ()=>{
            onError(new VFSError('Failed to scan existing directory contents', 'EIO', dirPath));
        };
    }
    async getCurrentDatabaseVersion() {
        return new Promise((resolve, reject)=>{
            const request = indexedDB.open(this.dbName);
            request.onsuccess = (event)=>{
                const db = event.target.result;
                const version = db.version;
                db.close();
                resolve(version);
            };
            request.onerror = ()=>{
                reject(new VFSError('Failed to get database version', 'EIO', request.error?.message));
            };
        });
    }
    async ensureDB() {
        if (this.db) {
            return this.db;
        }
        const { version, storeExists } = await this.getDatabaseInfo();
        if (storeExists) {
            this.db = await this.openDatabase(version);
            await this.ensureRootDirectoryAsync();
            return this.db;
        } else {
            this.db = await this.createObjectStoreAsync(version + 1);
            return this.db;
        }
    }
    async getDatabaseInfo() {
        return new Promise((resolve)=>{
            const request = indexedDB.open(this.dbName);
            request.onsuccess = (event)=>{
                const tempDb = event.target.result;
                const version = tempDb.version;
                const storeExists = tempDb.objectStoreNames.contains(this.storeName);
                tempDb.close();
                resolve({
                    version,
                    storeExists
                });
            };
            request.onerror = ()=>{
                resolve({
                    version: 0,
                    storeExists: false
                });
            };
            request.onupgradeneeded = (event)=>{
                const tempDb = event.target.result;
                const version = tempDb.version;
                const storeExists = tempDb.objectStoreNames.contains(this.storeName);
                tempDb.close();
                resolve({
                    version,
                    storeExists
                });
            };
        });
    }
    async openDatabase(version) {
        return new Promise((resolve, reject)=>{
            const request = indexedDB.open(this.dbName, version);
            request.onsuccess = ()=>{
                resolve(request.result);
            };
            request.onerror = ()=>{
                reject(new VFSError('Failed to open existing database', 'ENOENT'));
            };
            request.onblocked = ()=>{
                reject(new VFSError('Database open blocked', 'EBUSY'));
            };
        });
    }
    async createObjectStoreAsync(newVersion) {
        return new Promise((resolve, reject)=>{
            const request = indexedDB.open(this.dbName, newVersion);
            request.onupgradeneeded = (event)=>{
                const db = event.target.result;
                try {
                    if (!db.objectStoreNames.contains(this.storeName)) {
                        const store = db.createObjectStore(this.storeName, {
                            keyPath: 'path'
                        });
                        store.createIndex('type', 'type', {
                            unique: false
                        });
                        store.createIndex('parent', 'parent', {
                            unique: false
                        });
                        store.createIndex('name', 'name', {
                            unique: false
                        });
                        const now = new Date();
                        const rootDir = {
                            name: '',
                            path: '/',
                            size: 0,
                            type: 'directory',
                            created: now,
                            modified: now,
                            parent: '',
                            data: null
                        };
                        store.add(rootDir);
                    }
                } catch (error) {
                    console.error(`Failed to create Object Store '${this.storeName}':`, error);
                    reject(new VFSError('Failed to create object store', 'EIO', error?.toString()));
                }
            };
            request.onsuccess = ()=>{
                resolve(request.result);
            };
            request.onerror = ()=>{
                reject(new VFSError('Failed to create database/object store', 'EIO', request.error?.message));
            };
            request.onblocked = ()=>{
                reject(new VFSError('Database creation blocked - close other connections first', 'EBUSY'));
            };
        });
    }
    async ensureRootDirectoryAsync() {
        if (!this.db) {
            throw new VFSError('Database not available', 'EIO');
        }
        return new Promise((resolve, reject)=>{
            const transaction = this.db.transaction([
                this.storeName
            ], 'readwrite');
            const store = transaction.objectStore(this.storeName);
            const checkRequest = store.get('/');
            checkRequest.onsuccess = ()=>{
                if (!checkRequest.result) {
                    const now = new Date();
                    const rootDir = {
                        name: '',
                        path: '/',
                        size: 0,
                        type: 'directory',
                        created: now,
                        modified: now,
                        parent: '',
                        data: null
                    };
                    const addRequest = store.add(rootDir);
                    addRequest.onsuccess = ()=>{
                        resolve();
                    };
                    addRequest.onerror = ()=>{
                        reject(new VFSError('Failed to create root directory', 'EIO'));
                    };
                } else {
                    resolve();
                }
            };
            checkRequest.onerror = ()=>{
                reject(new VFSError('Failed to check root directory', 'EIO'));
            };
            transaction.onerror = ()=>{
                reject(new VFSError('Failed to check/create root directory', 'EIO', transaction.error?.message));
            };
            transaction.onabort = ()=>{
                reject(new VFSError('Transaction aborted while checking root directory', 'EIO'));
            };
        });
    }
    async dbOperation(mode, operation) {
        const db = await this.ensureDB();
        return new Promise((resolve, reject)=>{
            const transaction = db.transaction([
                this.storeName
            ], mode);
            const store = transaction.objectStore(this.storeName);
            transaction.onerror = ()=>reject(new VFSError('Transaction failed', 'EACCES', transaction.error?.message));
            transaction.onabort = ()=>reject(new VFSError('Transaction aborted', 'EABORT'));
            transaction.oncomplete = ()=>{};
            const result = operation(store);
            if (result instanceof Promise) {
                result.then(resolve).catch(reject);
            } else if (result instanceof IDBRequest) {
                result.onsuccess = ()=>{
                    resolve(result.result);
                };
                result.onerror = ()=>reject(new VFSError('Operation failed', 'EIO', result.error?.message));
            } else {
                resolve(result);
            }
        });
    }
    matchesFilter(metadata, options) {
        if (!options) {
            return true;
        }
        if (!options.includeHidden && metadata.name.startsWith('.')) {
            return false;
        }
        if (options.pattern) {
            if (typeof options.pattern === 'string') {
                return metadata.name.includes(options.pattern);
            } else if (options.pattern instanceof RegExp) {
                return options.pattern.test(metadata.name);
            }
        }
        return true;
    }
}

/**
 * Memory file system.
 *
 * @public
 */ class MemoryFS extends VFS {
    files;
    directories;
    metadata;
    constructor(readonly = false){
        super(readonly);
        this.files = new Map();
        this.directories = new Set([
            '/'
        ]);
        this.metadata = new Map();
        const now = new Date();
        this.metadata.set('/', {
            created: now,
            modified: now,
            name: '',
            path: '/',
            size: 0,
            type: 'directory'
        });
    }
    async _makeDirectory(path, recursive) {
        if (this.directories.has(path)) {
            throw new VFSError('Directory already exists', 'EEXIST', path);
        }
        const parent = PathUtils.dirname(path);
        if (!this.directories.has(parent)) {
            if (recursive) {
                await this._makeDirectory(parent, true);
            } else {
                throw new VFSError('Parent directory does not exist', 'ENOENT', parent);
            }
        }
        this.directories.add(path);
        this.metadata.set(path, {
            name: PathUtils.basename(path),
            path: path,
            size: 0,
            type: 'directory',
            created: new Date(),
            modified: new Date()
        });
    }
    async _readDirectory(path, options) {
        if (!this.directories.has(path)) {
            throw new VFSError('Directory does not exist', 'ENOENT', path);
        }
        const results = [];
        const pathPrefix = path === '/' ? '/' : path + '/';
        for (const dir of this.directories){
            if (dir !== path && dir.startsWith(pathPrefix)) {
                const relativePath = dir.slice(pathPrefix.length);
                if (!options?.recursive && relativePath.includes('/')) {
                    continue;
                }
                const metadata = this.metadata.get(dir);
                if (metadata) {
                    results.push(metadata);
                }
            }
        }
        for (const [filePath] of this.files){
            if (filePath.startsWith(pathPrefix)) {
                const relativePath = filePath.slice(pathPrefix.length);
                if (!options?.recursive && relativePath.includes('/')) {
                    continue;
                }
                const metadata = this.metadata.get(filePath);
                if (metadata) {
                    results.push(metadata);
                }
            }
        }
        return results;
    }
    async _deleteDirectory(path, recursive) {
        if (!this.directories.has(path)) {
            throw new VFSError('Directory does not exist', 'ENOENT', path);
        }
        const children = await this._readDirectory(path);
        if (children.length > 0 && !recursive) {
            throw new VFSError('Directory is not empty', 'ENOTEMPTY', path);
        }
        if (recursive) {
            const pathPrefix = path + '/';
            for (const [filePath] of this.files){
                if (filePath.startsWith(pathPrefix)) {
                    this.files.delete(filePath);
                    this.metadata.delete(filePath);
                }
            }
            for (const dir of this.directories){
                if (dir.startsWith(pathPrefix)) {
                    this.directories.delete(dir);
                    this.metadata.delete(dir);
                }
            }
        }
        this.directories.delete(path);
        this.metadata.delete(path);
    }
    async _readFile(path, options) {
        if (!this.files.has(path)) {
            throw new VFSError(`File does not exist: ${path}`, 'ENOENT', path);
        }
        let data = this.files.get(path);
        const requestedEncoding = options?.encoding;
        // Encoding conversions
        if (requestedEncoding === 'utf8') {
            if (data instanceof ArrayBuffer) {
                data = new TextDecoder().decode(data);
            }
        } else if (requestedEncoding === 'base64') {
            if (data instanceof ArrayBuffer) {
                const bytes = new Uint8Array(data);
                data = uint8ArrayToBase64(bytes);
            } else if (typeof data === 'string') {
                const bytes = new TextEncoder().encode(data);
                data = uint8ArrayToBase64(bytes);
            }
        } else if (requestedEncoding === 'binary' || !requestedEncoding) {
            if (typeof data === 'string') {
                data = new TextEncoder().encode(data).buffer;
            }
        }
        // Range read
        if (options?.offset !== undefined || options?.length !== undefined) {
            const offset = options.offset || 0;
            const length = options.length;
            if (data instanceof ArrayBuffer) {
                const end = length !== undefined ? offset + length : data.byteLength;
                data = data.slice(offset, end);
            } else if (typeof data === 'string') {
                const end = length !== undefined ? offset + length : data.length;
                data = data.slice(offset, end);
            }
        }
        return data;
    }
    async _writeFile(path, data, options) {
        const parent = PathUtils.dirname(path);
        if (!this.directories.has(parent)) {
            if (options?.create) {
                await this._makeDirectory(parent, true);
            } else {
                throw new VFSError('Parent directory does not exist', 'ENOENT', parent);
            }
        }
        let fileData = data;
        if (options?.encoding === 'base64' && typeof data === 'string') {
            try {
                const bytes = base64ToUint8Array(data);
                fileData = bytes.buffer;
            } catch  {
                throw new VFSError('Invalid base64 data', 'EINVAL', path);
            }
        } else if (options?.encoding === 'utf8') {
            if (data instanceof ArrayBuffer) {
                fileData = new TextDecoder().decode(data);
            }
        } else if (options?.encoding === 'binary' || !options?.encoding) {
            if (typeof data === 'string') {
                fileData = new TextEncoder().encode(data).buffer;
            }
        }
        if (options?.append && this.files.has(path)) {
            const existingData = this.files.get(path);
            if (typeof existingData === 'string' && typeof fileData === 'string') {
                fileData = existingData + fileData;
            } else if (existingData instanceof ArrayBuffer && fileData instanceof ArrayBuffer) {
                const combined = new Uint8Array(existingData.byteLength + fileData.byteLength);
                combined.set(new Uint8Array(existingData), 0);
                combined.set(new Uint8Array(fileData), existingData.byteLength);
                fileData = combined.buffer;
            } else {
                const existingStr = typeof existingData === 'string' ? existingData : new TextDecoder().decode(existingData);
                const newStr = typeof fileData === 'string' ? fileData : new TextDecoder().decode(fileData);
                fileData = existingStr + newStr;
            }
        }
        this.files.set(path, fileData);
        const size = typeof fileData === 'string' ? new TextEncoder().encode(fileData).length : fileData.byteLength;
        this.metadata.set(path, {
            name: PathUtils.basename(path),
            path: path,
            size,
            type: 'file',
            created: this.metadata.get(path)?.created || new Date(),
            modified: new Date()
        });
    }
    async _deleteFile(path) {
        if (!this.files.has(path)) {
            throw new VFSError(`File does not exist: ${path}`, 'ENOENT', path);
        }
        this.files.delete(path);
        this.metadata.delete(path);
    }
    async _exists(path) {
        return this.files.has(path) || this.directories.has(path);
    }
    async _stat(path) {
        const metadata = this.metadata.get(path);
        if (!metadata) {
            throw new VFSError('Path does not exist', 'ENOENT', path);
        }
        return {
            size: metadata.size,
            isFile: metadata.type === 'file',
            isDirectory: metadata.type === 'directory',
            created: metadata.created,
            modified: metadata.modified
        };
    }
    async _deleteFileSystem() {
        return;
    }
    async _wipe() {
        return;
    }
    async _move(sourcePath, targetPath, options) {
        if (!this.files.has(sourcePath) && !this.directories.has(sourcePath)) {
            throw new VFSError('Source path does not exist', 'ENOENT', sourcePath);
        }
        const targetExists = this.files.has(targetPath) || this.directories.has(targetPath);
        if (targetExists && !options?.overwrite) {
            throw new VFSError('Target already exists', 'EEXIST', targetPath);
        }
        const targetParent = PathUtils.dirname(targetPath);
        if (!this.directories.has(targetParent)) {
            throw new VFSError('Target parent directory does not exist', 'ENOENT', targetParent);
        }
        const now = new Date();
        if (this.files.has(sourcePath)) {
            const fileData = this.files.get(sourcePath);
            const sourceMetadata = this.metadata.get(sourcePath);
            if (targetExists && options?.overwrite) {
                this.files.delete(targetPath);
                this.directories.delete(targetPath);
                this.metadata.delete(targetPath);
            }
            this.files.set(targetPath, fileData);
            this.metadata.set(targetPath, {
                ...sourceMetadata,
                name: PathUtils.basename(targetPath),
                path: targetPath,
                modified: now
            });
            this.files.delete(sourcePath);
            this.metadata.delete(sourcePath);
        } else if (this.directories.has(sourcePath)) {
            const sourceMetadata = this.metadata.get(sourcePath);
            if (targetExists && options?.overwrite) {
                if (this.directories.has(targetPath)) {
                    await this._deleteDirectory(targetPath, true);
                } else {
                    this.files.delete(targetPath);
                    this.metadata.delete(targetPath);
                }
            }
            const sourcePrefix = sourcePath === '/' ? '/' : sourcePath + '/';
            const targetPrefix = targetPath === '/' ? '/' : targetPath + '/';
            const filesToMove = [];
            const dirsToMove = [];
            for (const [filePath] of this.files){
                if (filePath.startsWith(sourcePrefix)) {
                    filesToMove.push(filePath);
                }
            }
            for (const dirPath of this.directories){
                if (dirPath !== sourcePath && dirPath.startsWith(sourcePrefix)) {
                    dirsToMove.push(dirPath);
                }
            }
            dirsToMove.sort();
            for (const oldFilePath of filesToMove){
                const newFilePath = oldFilePath.replace(sourcePrefix, targetPrefix);
                const fileData = this.files.get(oldFilePath);
                const fileMetadata = this.metadata.get(oldFilePath);
                this.files.set(newFilePath, fileData);
                this.metadata.set(newFilePath, {
                    ...fileMetadata,
                    name: PathUtils.basename(newFilePath),
                    path: newFilePath,
                    modified: now
                });
                this.files.delete(oldFilePath);
                this.metadata.delete(oldFilePath);
            }
            for (const oldDirPath of dirsToMove){
                const newDirPath = oldDirPath.replace(sourcePrefix, targetPrefix);
                const dirMetadata = this.metadata.get(oldDirPath);
                this.directories.add(newDirPath);
                this.metadata.set(newDirPath, {
                    ...dirMetadata,
                    name: PathUtils.basename(newDirPath),
                    path: newDirPath,
                    modified: now
                });
                this.directories.delete(oldDirPath);
                this.metadata.delete(oldDirPath);
            }
            this.directories.add(targetPath);
            this.metadata.set(targetPath, {
                ...sourceMetadata,
                name: PathUtils.basename(targetPath),
                path: targetPath,
                modified: now
            });
            this.directories.delete(sourcePath);
            this.metadata.delete(sourcePath);
        }
    }
}

/**
 * ZIP file system implementation using zip.js.
 *
 * Supports reading, writing, and manipulating ZIP archives as a virtual file system.
 * Can be mounted onto other file systems and used in combination with other VFS implementations.
 *
 * @remarks
 * - The class requires zip.js dependencies to be provided.
 * - Virtual files (staged but not saved/written to ZIP yet) are supported for fast file operations and batch updates.
 * - All paths are normalized to ensure consistency.
 *
 * @example
 * ```typescript
 * import { ZipFS } from './zipfs';
 * import { zipjs } from 'zip.js'; // or custom zipjs build
 *
 * const zipFS = new ZipFS('test.zip', zipjs, false);
 * await zipFS.initializeFromData(arrayBufferOrBlob);
 * const fileList = await zipFS.readDirectory('/');
 * await zipFS.writeFile('/new.txt', 'Hello!');
 * const outBlob = await zipFS.getZipBlob();
 * ```
 *
 * @public
 */ class ZipFS extends VFS {
    zipReader;
    zipWriter;
    entries;
    virtualFiles;
    zipData;
    isModified;
    zipJS;
    /**
   * Constructs a ZIP file system instance.
   *
   * @param zipJS - Dependency injection of zip.js constructors/readers/writers
   * @param readonly - Whether the file system should operate in read-only mode
   */ constructor(zipJS, readonly = false){
        super(readonly);
        this.zipJS = zipJS;
        this.zipReader = null;
        this.zipWriter = null;
        this.entries = new Map();
        this.virtualFiles = new Map();
        this.zipData = null;
        this.isModified = false;
        if (!readonly) {
            this.initializeEmpty();
        }
    }
    /**
   * Initializes the ZIP file system from given binary data.
   * Reads the structure and caches all entries.
   *
   * @param data - ZIP file as Blob, ArrayBuffer, or Uint8Array
   */ async initializeFromData(data) {
        try {
            let reader;
            if (data instanceof ArrayBuffer) {
                this.zipData = new Uint8Array(data);
                reader = new this.zipJS.Uint8ArrayReader(this.zipData);
            } else if (data instanceof Uint8Array) {
                this.zipData = data;
                reader = new this.zipJS.Uint8ArrayReader(data);
            } else {
                this.zipData = data;
                reader = new this.zipJS.BlobReader(data);
            }
            this.zipReader = new this.zipJS.ZipReader(reader);
            const entries = await this.zipReader.getEntries();
            this.entries.clear();
            for (const entry of entries){
                const normalizedPath = this.normalizePath('/' + entry.filename);
                this.entries.set(normalizedPath, entry);
            }
        } catch (error) {
            throw new VFSError('Failed to initialize ZIP file', 'EINVAL', String(error));
        }
    }
    /**
   * Returns ZIP archive data as a Uint8Array, saving any in-memory changes first.
   *
   * @returns ZIP file contents as a Uint8Array
   */ async getZipData() {
        await this.applyVirtualFiles();
        if (this.zipWriter && this.isModified) {
            const data = await this.zipWriter.close();
            this.zipData = data;
            this.isModified = false;
            await this.initializeFromData(data);
        }
        if (this.zipData instanceof Uint8Array) {
            return this.zipData;
        } else if (this.zipData instanceof Blob) {
            return new Uint8Array(await this.zipData.arrayBuffer());
        } else if (this.zipData instanceof ArrayBuffer) {
            return new Uint8Array(this.zipData);
        }
        return new Uint8Array(0);
    }
    /**
   * Returns ZIP archive data as a Blob, saving any in-memory changes first.
   *
   * @returns ZIP file contents as a Blob
   */ async getZipBlob() {
        const data = await this.getZipData();
        return new Blob([
            data
        ], {
            type: 'application/zip'
        });
    }
    /**
   * Saves the ZIP archive to a target VFS at the given path.
   *
   * @param targetVFS - The file system where to save the ZIP archive
   * @param path - The destination path (including file name)
   */ async saveToVFS(targetVFS, path) {
        const data = await this.getZipData();
        await targetVFS.writeFile(path, data.buffer);
    }
    /**
   * Returns metadata for all entries in the ZIP archive.
   * Includes in-memory (virtual) files.
   *
   * @returns List of all ZIP entries/directories/files
   */ async getEntries() {
        const entries = [];
        for (const [path, entry] of this.entries){
            entries.push({
                path,
                isDirectory: entry.directory,
                size: entry.uncompressedSize || 0,
                lastModified: entry.lastModDate || new Date(),
                comment: entry.comment
            });
        }
        for (const [path, virtualFile] of this.virtualFiles){
            const size = virtualFile.data instanceof ArrayBuffer ? virtualFile.data.byteLength : new TextEncoder().encode(virtualFile.data).length;
            entries.push({
                path,
                isDirectory: false,
                size,
                lastModified: virtualFile.modified
            });
        }
        return entries;
    }
    /**
   * Close zip archive and release resources
   */ async onClose() {
        if (this.zipReader && this.zipReader.close) {
            await this.zipReader.close();
        }
        if (this.zipWriter) {
            if (this.isModified || this.virtualFiles.size > 0) {
                await this.getZipData();
            }
        }
        this.zipReader = null;
        this.zipWriter = null;
        this.entries.clear();
        this.virtualFiles.clear();
        this.zipData = null;
    }
    /**
   * Check whether we have unsaved changes
   */ hasUnsavedChanges() {
        return this.isModified || this.virtualFiles.size > 0;
    }
    /**
   * Force all data to be saved
   */ async flush() {
        if (this.hasUnsavedChanges()) {
            await this.getZipData();
        }
    }
    /**
   * Get compression state
   */ async getCompressionStats() {
        let totalEntries = 0;
        let totalUncompressedSize = 0;
        for (const entry of this.entries.values()){
            if (!entry.directory) {
                totalEntries++;
                totalUncompressedSize += entry.uncompressedSize || 0;
            }
        }
        for (const virtualFile of this.virtualFiles.values()){
            totalEntries++;
            const size = virtualFile.data instanceof ArrayBuffer ? virtualFile.data.byteLength : new TextEncoder().encode(virtualFile.data).length;
            totalUncompressedSize += size;
        }
        const zipData = await this.getZipData();
        const totalCompressedSize = zipData.length;
        const compressionRatio = totalUncompressedSize > 0 ? totalCompressedSize / totalUncompressedSize : 0;
        return {
            totalEntries,
            totalUncompressedSize,
            totalCompressedSize,
            compressionRatio
        };
    }
    /**
   * Extract all content of the zip archive to another VFS
   */ async extractTo(targetVFS, targetPath = '/', options) {
        const entries = await this.getEntries();
        const filteredEntries = options?.filter ? entries.filter((entry)=>options.filter(entry.path)) : entries;
        let current = 0;
        const total = filteredEntries.length;
        for (const entry of filteredEntries){
            const targetFilePath = PathUtils.join(targetPath, entry.path);
            if (options?.progress) {
                options.progress(current, total, entry.path);
            }
            if (entry.isDirectory) {
                if (!await targetVFS.exists(targetFilePath)) {
                    await targetVFS.makeDirectory(targetFilePath, true);
                }
            } else {
                if (!options?.overwrite && await targetVFS.exists(targetFilePath)) {
                    current++;
                    continue;
                }
                const fileData = await this.readFile(entry.path);
                await targetVFS.writeFile(targetFilePath, fileData, {
                    create: true
                });
            }
            current++;
        }
        if (options?.progress) {
            options.progress(total, total, '');
        }
    }
    /**
   * Add file to the zip archive from another VFS
   */ async addFromVFS(sourceVFS, sourcePath, targetPath, options) {
        if (this._readOnly) {
            throw new VFSError('ZIP file system is read-only', 'EROFS');
        }
        const actualTargetPath = targetPath || sourcePath;
        if (!await sourceVFS.exists(sourcePath)) {
            throw new VFSError('Source path does not exist', 'ENOENT', sourcePath);
        }
        const stat = await sourceVFS.stat(sourcePath);
        if (stat.isFile) {
            if (!options?.filter || options.filter(sourcePath)) {
                if (options?.progress) {
                    options.progress(0, 1, sourcePath);
                }
                const data = await sourceVFS.readFile(sourcePath);
                await this.writeFile(actualTargetPath, data);
                if (options?.progress) {
                    options.progress(1, 1, sourcePath);
                }
            }
        } else if (stat.isDirectory) {
            const entries = await sourceVFS.readDirectory(sourcePath, {
                recursive: options?.recursive
            });
            const filteredEntries = options?.filter ? entries.filter((entry)=>options.filter(entry.path)) : entries;
            let current = 0;
            const total = filteredEntries.length;
            if (!options?.filter || options.filter(sourcePath)) {
                await this.makeDirectory(actualTargetPath, true);
            }
            for (const entry of filteredEntries){
                if (options?.progress) {
                    options.progress(current, total, entry.path);
                }
                const relativePath = PathUtils.relative(sourcePath, entry.path);
                const targetFilePath = PathUtils.join(actualTargetPath, relativePath);
                if (entry.type === 'directory') {
                    await this.makeDirectory(targetFilePath, true);
                } else {
                    const data = await sourceVFS.readFile(entry.path);
                    await this.writeFile(targetFilePath, data);
                }
                current++;
            }
            if (options?.progress) {
                options.progress(total, total, '');
            }
        }
    }
    /**
   * Verify ZIP archive
   */ async verify() {
        const errors = [];
        const warnings = [];
        try {
            const entries = await this.getEntries();
            for (const entry of entries){
                if (!entry.isDirectory) {
                    try {
                        await this.readFile(entry.path);
                    } catch (error) {
                        errors.push(`Failed to read file: ${entry.path} - ${error}`);
                    }
                }
            }
            for (const entry of entries){
                if (entry.path.includes('..')) {
                    warnings.push(`Potentially unsafe path: ${entry.path}`);
                }
                if (entry.path.includes('//')) {
                    warnings.push(`Path contains double slashes: ${entry.path}`);
                }
            }
        } catch (error) {
            errors.push(`ZIP structure error: ${error}`);
        }
        return {
            isValid: errors.length === 0,
            errors,
            warnings
        };
    }
    /** {@inheritDoc VFS._makeDirectory} */ async _makeDirectory(path, recursive) {
        if (await this._exists(path)) {
            return;
        }
        const parent = PathUtils.dirname(path);
        if (parent !== '/' && parent !== path) {
            const parentExists = await this._exists(parent);
            if (!parentExists) {
                if (recursive) {
                    await this._makeDirectory(parent, true);
                } else {
                    throw new VFSError('Parent directory does not exist', 'ENOENT', parent);
                }
            }
        }
        const writer = await this.ensureWriter();
        const dirPath = path.endsWith('/') ? path.slice(1) : path.slice(1) + '/';
        try {
            await writer.add(dirPath, undefined, {
                directory: true,
                lastModDate: new Date()
            });
        } catch  {
        // zip.js will throw an error if directory already exists
        }
        this.isModified = true;
        this.entries.set(path, {
            filename: dirPath,
            directory: true,
            uncompressedSize: 0,
            lastModDate: new Date(),
            comment: ''
        });
    }
    /** {@inheritDoc VFS._readDirectory} */ async _readDirectory(path, options) {
        if (path === '/' && this.entries.size === 0 && this.virtualFiles.size === 0) {
            return [];
        }
        const results = [];
        const searchPath = path === '/' ? '' : path.slice(1) + '/';
        const foundEntries = new Set();
        for (const [_entryPath, entry] of this.entries){
            const relativePath = entry.filename;
            if (path === '/') {
                const parts = relativePath.split('/').filter((p)=>p);
                if (parts.length === 0) {
                    continue;
                }
                const firstPart = parts[0];
                const isDir = relativePath.endsWith('/') || parts.length > 1;
                if (!foundEntries.has(firstPart)) {
                    foundEntries.add(firstPart);
                    const metadata = {
                        name: firstPart,
                        path: '/' + firstPart,
                        size: isDir ? 0 : entry.uncompressedSize || 0,
                        type: isDir ? 'directory' : 'file',
                        created: entry.lastModDate || new Date(),
                        modified: entry.lastModDate || new Date()
                    };
                    if (this.matchesFilter(metadata, options)) {
                        results.push(metadata);
                    }
                }
            } else if (relativePath.startsWith(searchPath)) {
                const remainingPath = relativePath.slice(searchPath.length);
                if (!remainingPath) {
                    continue;
                }
                if (options?.recursive) {
                    const fullPath = '/' + relativePath.replace(/\/$/, '');
                    if (!foundEntries.has(fullPath)) {
                        foundEntries.add(fullPath);
                        const metadata = {
                            name: PathUtils.basename(fullPath),
                            path: fullPath,
                            size: entry.directory ? 0 : entry.uncompressedSize || 0,
                            type: entry.directory ? 'directory' : 'file',
                            created: entry.lastModDate || new Date(),
                            modified: entry.lastModDate || new Date()
                        };
                        if (this.matchesFilter(metadata, options)) {
                            results.push(metadata);
                        }
                    }
                } else {
                    const parts = remainingPath.split('/').filter((p)=>p);
                    if (parts.length > 0) {
                        const firstPart = parts[0];
                        const isDir = remainingPath.includes('/') || relativePath.endsWith('/');
                        const childPath = PathUtils.join(path, firstPart);
                        if (!foundEntries.has(firstPart)) {
                            foundEntries.add(firstPart);
                            const metadata = {
                                name: firstPart,
                                path: childPath,
                                size: isDir ? 0 : entry.uncompressedSize || 0,
                                type: isDir ? 'directory' : 'file',
                                created: entry.lastModDate || new Date(),
                                modified: entry.lastModDate || new Date()
                            };
                            if (this.matchesFilter(metadata, options)) {
                                results.push(metadata);
                            }
                        }
                    }
                }
            }
        }
        for (const [virtualPath, virtualFile] of this.virtualFiles){
            const parent = PathUtils.dirname(virtualPath);
            if (parent === path || options?.recursive && virtualPath.startsWith(path + '/')) {
                const name = PathUtils.basename(virtualPath);
                if (!foundEntries.has(name)) {
                    foundEntries.add(name);
                    const size = virtualFile.data instanceof ArrayBuffer ? virtualFile.data.byteLength : new TextEncoder().encode(virtualFile.data).length;
                    const metadata = {
                        name,
                        path: virtualPath,
                        size,
                        type: 'file',
                        created: virtualFile.modified,
                        modified: virtualFile.modified
                    };
                    if (this.matchesFilter(metadata, options)) {
                        results.push(metadata);
                    }
                }
            }
        }
        return results;
    }
    /** {@inheritDoc VFS._deleteDirectory} */ async _deleteDirectory(path, recursive) {
        const dirExists = await this._exists(path);
        if (!dirExists) {
            throw new VFSError('Directory does not exist', 'ENOENT', path);
        }
        const children = await this._readDirectory(path);
        if (children.length > 0 && !recursive) {
            throw new VFSError('Directory is not empty', 'ENOTEMPTY', path);
        }
        if (recursive) {
            for (const child of children){
                if (child.type === 'directory') {
                    await this._deleteDirectory(child.path, true);
                } else {
                    await this._deleteFile(child.path);
                }
            }
        }
        const searchPath = path.slice(1);
        const toDelete = [];
        for (const [entryPath, entry] of this.entries){
            if (entry.filename === searchPath || entry.filename === searchPath + '/') {
                toDelete.push(entryPath);
            }
        }
        for (const path of toDelete){
            this.entries.delete(path);
        }
        this.virtualFiles.delete(path);
        this.isModified = true;
    }
    /** {@inheritDoc VFS._readFile} */ async _readFile(path, options) {
        if (this.virtualFiles.has(path)) {
            const virtualFile = this.virtualFiles.get(path);
            return this.processFileData(virtualFile.data, options);
        }
        const searchPath = path.slice(1);
        const entry = Array.from(this.entries.values()).find((e)=>e.filename === searchPath);
        if (!entry || entry.directory) {
            throw new VFSError(`File does not exist: ${path}`, 'ENOENT', path);
        }
        if (!entry.getData) {
            throw new VFSError('Cannot read file data', 'EIO', path);
        }
        const arrayWriter = new this.zipJS.Uint8ArrayWriter();
        const uint8Array = await entry.getData(arrayWriter);
        const arrayBuffer = uint8Array.buffer;
        return this.processFileData(arrayBuffer, options);
    }
    /** {@inheritDoc VFS._writeFile} */ async _writeFile(path, data, options) {
        const parent = PathUtils.dirname(path);
        if (parent !== '/' && !await this._exists(parent)) {
            if (options?.create) {
                await this._makeDirectory(parent, true);
            } else {
                throw new VFSError('Parent directory does not exist', 'ENOENT', parent);
            }
        }
        const fileExists = await this._exists(path);
        if (fileExists) {
            const stat = await this._stat(path);
            if (stat.isDirectory) {
                throw new VFSError('Path is a directory', 'EISDIR', path);
            }
            if (options?.create === false) {
                throw new VFSError('File already exists', 'EEXIST', path);
            }
        }
        let fileData = data;
        if (options?.encoding === 'base64' && typeof fileData === 'string') {
            try {
                const bytes = base64ToUint8Array(fileData);
                fileData = bytes.buffer;
            } catch  {
                throw new VFSError('Invalid base64 data', 'EINVAL', path);
            }
        } else if (options?.encoding === 'utf8') {
            if (fileData instanceof ArrayBuffer) {
                fileData = new TextDecoder().decode(fileData);
            }
        } else if (options?.encoding === 'binary' || !options?.encoding) {
            if (typeof fileData === 'string') {
                fileData = new TextEncoder().encode(fileData).buffer;
            }
        }
        let createdTime = new Date();
        let isExistingFile = false;
        if (fileExists) {
            try {
                const existingStat = await this._stat(path);
                createdTime = existingStat.created;
                isExistingFile = true;
            } catch  {
            // intentionally ignore
            }
        }
        if (options?.append && isExistingFile) {
            let existingData = null;
            try {
                existingData = await this._readFile(path);
            } catch  {
            // intentionally ignore
            }
            if (existingData) {
                if (typeof fileData === 'string' && typeof existingData === 'string') {
                    fileData = existingData + fileData;
                } else if (fileData instanceof ArrayBuffer && existingData instanceof ArrayBuffer) {
                    const combined = new Uint8Array(existingData.byteLength + fileData.byteLength);
                    combined.set(new Uint8Array(existingData), 0);
                    combined.set(new Uint8Array(fileData), existingData.byteLength);
                    fileData = combined.buffer;
                } else {
                    const existingStr = existingData instanceof ArrayBuffer ? new TextDecoder().decode(existingData) : existingData;
                    const newStr = fileData instanceof ArrayBuffer ? new TextDecoder().decode(fileData) : fileData;
                    fileData = existingStr + newStr;
                }
            }
        }
        this.virtualFiles.set(path, {
            data: fileData,
            modified: new Date()
        });
        if (isExistingFile) {
            const searchPath = path.slice(1);
            this.entries.set(path, {
                filename: searchPath,
                directory: false,
                uncompressedSize: typeof fileData === 'string' ? new TextEncoder().encode(fileData).length : fileData.byteLength,
                lastModDate: createdTime,
                comment: '',
                getData: undefined
            });
        }
        this.isModified = true;
    }
    /** {@inheritDoc VFS._deleteFile} */ async _deleteFile(path) {
        if (!await this._exists(path)) {
            throw new VFSError(`File does not exist: ${path}`, 'ENOENT', path);
        }
        this.virtualFiles.delete(path);
        const searchPath = path.slice(1);
        const toDelete = [];
        for (const [entryPath, entry] of this.entries){
            if (entry.filename === searchPath && !entry.directory) {
                toDelete.push(entryPath);
            }
        }
        for (const path of toDelete){
            this.entries.delete(path);
        }
        this.isModified = true;
    }
    /** {@inheritDoc VFS._exists} */ async _exists(path) {
        if (path === '/') {
            return true;
        }
        if (this.virtualFiles.has(path)) {
            return true;
        }
        const searchPath = path.slice(1);
        for (const entry of this.entries.values()){
            if (entry.filename === searchPath || entry.filename === searchPath + '/') {
                return true;
            }
        }
        const searchPrefix = searchPath + '/';
        for (const entry of this.entries.values()){
            if (entry.filename.startsWith(searchPrefix)) {
                return true;
            }
        }
        for (const virtualPath of this.virtualFiles.keys()){
            if (virtualPath.startsWith(path + '/')) {
                return true;
            }
        }
        return false;
    }
    /**
   * No support for deleting filesystem
   */ async _deleteFileSystem() {
        return;
    }
    /**
   * No support for deleting database
   */ async _wipe() {
        return;
    }
    async _move(sourcePath, targetPath, options) {
        if (this._readOnly) {
            throw new VFSError('ZIP file system is read-only', 'EROFS');
        }
        if (!await this._exists(sourcePath)) {
            throw new VFSError('Source path does not exist', 'ENOENT', sourcePath);
        }
        const targetExists = await this._exists(targetPath);
        if (targetExists && !options?.overwrite) {
            throw new VFSError('Target already exists', 'EEXIST', targetPath);
        }
        const targetParent = PathUtils.dirname(targetPath);
        if (targetParent !== '/' && !await this._exists(targetParent)) {
            throw new VFSError('Target parent directory does not exist', 'ENOENT', targetParent);
        }
        const sourceStat = await this._stat(sourcePath);
        if (sourceStat.isFile) {
            await this.moveFile(sourcePath, targetPath, sourceStat, options);
        } else if (sourceStat.isDirectory) {
            await this.moveDirectory(sourcePath, targetPath, sourceStat, options);
        }
        this.isModified = true;
    }
    /** {@inheritDoc VFS._stat} */ async _stat(path) {
        if (path === '/') {
            return {
                size: 0,
                isFile: false,
                isDirectory: true,
                created: new Date(),
                modified: new Date(),
                accessed: new Date()
            };
        }
        if (this.virtualFiles.has(path)) {
            const virtualFile = this.virtualFiles.get(path);
            const size = virtualFile.data instanceof ArrayBuffer ? virtualFile.data.byteLength : new TextEncoder().encode(virtualFile.data).length;
            let createdTime = virtualFile.modified;
            const searchPath = path.slice(1);
            const entry = Array.from(this.entries.values()).find((e)=>e.filename === searchPath);
            if (entry && entry.lastModDate) {
                createdTime = entry.lastModDate;
            }
            return {
                size,
                isFile: true,
                isDirectory: false,
                created: createdTime,
                modified: virtualFile.modified,
                accessed: virtualFile.modified
            };
        }
        const searchPath = path.slice(1);
        for (const entry of this.entries.values()){
            if (entry.filename === searchPath || entry.filename === searchPath + '/') {
                const timestamp = entry.lastModDate || new Date();
                return {
                    size: entry.directory ? 0 : entry.uncompressedSize || 0,
                    isFile: !entry.directory,
                    isDirectory: entry.directory,
                    created: timestamp,
                    modified: timestamp,
                    accessed: timestamp
                };
            }
        }
        const searchPrefix = searchPath + '/';
        for (const entry of this.entries.values()){
            if (entry.filename.startsWith(searchPrefix)) {
                return {
                    size: 0,
                    isFile: false,
                    isDirectory: true,
                    created: new Date(),
                    modified: new Date(),
                    accessed: new Date()
                };
            }
        }
        for (const virtualPath of this.virtualFiles.keys()){
            if (virtualPath.startsWith(path + '/')) {
                return {
                    size: 0,
                    isFile: false,
                    isDirectory: true,
                    created: new Date(),
                    modified: new Date(),
                    accessed: new Date()
                };
            }
        }
        throw new VFSError('Path does not exist', 'ENOENT', path);
    }
    initializeEmpty() {
        this.zipData = new Uint8Array(0);
        const writer = new this.zipJS.Uint8ArrayWriter();
        this.zipWriter = new this.zipJS.ZipWriter(writer);
        this.entries.clear();
        this.virtualFiles.clear();
    }
    async ensureWriter() {
        if (this._readOnly) {
            throw new VFSError('ZIP file system is read-only', 'EROFS');
        }
        if (!this.zipWriter) {
            const writer = new this.zipJS.Uint8ArrayWriter();
            this.zipWriter = new this.zipJS.ZipWriter(writer);
            if (this.zipReader) {
                const entries = await this.zipReader.getEntries();
                for (const entry of entries){
                    if (!entry.directory) {
                        const dataWriter = new this.zipJS.Uint8ArrayWriter();
                        const data = await entry.getData(dataWriter);
                        const dataReader = new this.zipJS.Uint8ArrayReader(data);
                        await this.zipWriter.add(entry.filename, dataReader, {
                            lastModDate: entry.lastModDate,
                            comment: entry.comment
                        });
                    } else {
                        await this.zipWriter.add(entry.filename, undefined, {
                            directory: true,
                            lastModDate: entry.lastModDate,
                            comment: entry.comment
                        });
                    }
                }
            }
        }
        return this.zipWriter;
    }
    async applyVirtualFiles() {
        if (this.virtualFiles.size === 0) {
            return;
        }
        const writer = await this.ensureWriter();
        for (const [path, virtualFile] of this.virtualFiles){
            const filename = path.slice(1);
            if (virtualFile.data instanceof ArrayBuffer) {
                const reader = new this.zipJS.Uint8ArrayReader(new Uint8Array(virtualFile.data));
                await writer.add(filename, reader, {
                    lastModDate: virtualFile.modified
                });
            } else {
                const reader = new this.zipJS.TextReader(virtualFile.data);
                await writer.add(filename, reader, {
                    lastModDate: virtualFile.modified
                });
            }
        }
        this.virtualFiles.clear();
        this.isModified = true;
    }
    matchesFilter(metadata, options) {
        if (!options) {
            return true;
        }
        if (!options.includeHidden && metadata.name.startsWith('.')) {
            return false;
        }
        if (options.pattern) {
            if (typeof options.pattern === 'string') {
                return metadata.name.includes(options.pattern);
            } else if (options.pattern instanceof RegExp) {
                return options.pattern.test(metadata.name);
            }
        }
        return true;
    }
    processFileData(data, options) {
        let processedData = data;
        const requestedEncoding = options?.encoding;
        if (requestedEncoding === 'utf8') {
            if (processedData instanceof ArrayBuffer) {
                processedData = new TextDecoder().decode(processedData);
            }
        } else if (requestedEncoding === 'base64') {
            if (processedData instanceof ArrayBuffer) {
                const bytes = new Uint8Array(processedData);
                processedData = uint8ArrayToBase64(bytes);
            } else if (typeof processedData === 'string') {
                const bytes = new TextEncoder().encode(processedData);
                processedData = uint8ArrayToBase64(bytes);
            }
        } else if (requestedEncoding === 'binary' || !requestedEncoding) {
            if (typeof processedData === 'string') {
                processedData = new TextEncoder().encode(processedData).buffer;
            }
        }
        if (options?.offset !== undefined || options?.length !== undefined) {
            const offset = options.offset || 0;
            const length = options.length;
            if (processedData instanceof ArrayBuffer) {
                const end = length !== undefined ? offset + length : processedData.byteLength;
                processedData = processedData.slice(offset, end);
            } else if (typeof processedData === 'string') {
                const end = length !== undefined ? offset + length : processedData.length;
                processedData = processedData.slice(offset, end);
            }
        }
        return processedData;
    }
    async moveFile(sourcePath, targetPath, sourceStat, options) {
        const fileData = await this._readFile(sourcePath);
        let originalCreated = sourceStat.created;
        if (!this.virtualFiles.has(sourcePath)) {
            const searchPath = sourcePath.slice(1);
            const entry = Array.from(this.entries.values()).find((e)=>e.filename === searchPath);
            if (entry && entry.lastModDate) {
                originalCreated = entry.lastModDate;
            }
        }
        if (options?.overwrite && await this._exists(targetPath)) {
            await this._deleteFile(targetPath);
        }
        await this._deleteFile(sourcePath);
        const moveTime = new Date();
        this.virtualFiles.set(targetPath, {
            data: fileData,
            modified: moveTime
        });
        const targetSearchPath = targetPath.slice(1);
        this.entries.set(targetPath, {
            filename: targetSearchPath,
            directory: false,
            uncompressedSize: typeof fileData === 'string' ? new TextEncoder().encode(fileData).length : fileData.byteLength,
            lastModDate: originalCreated,
            comment: '',
            getData: undefined
        });
    }
    async moveDirectory(sourcePath, targetPath, sourceStat, options) {
        let originalCreated = sourceStat.created;
        const searchPath = sourcePath.slice(1);
        const entry = Array.from(this.entries.values()).find((e)=>e.filename === searchPath || e.filename === searchPath + '/');
        if (entry && entry.lastModDate) {
            originalCreated = entry.lastModDate;
        }
        if (options?.overwrite && await this._exists(targetPath)) {
            await this._deleteDirectory(targetPath, true);
        }
        const children = await this._readDirectory(sourcePath, {
            recursive: true
        });
        const fileDataBackup = new Map();
        for (const child of children){
            if (child.type === 'file') {
                try {
                    const data = await this._readFile(child.path);
                    fileDataBackup.set(child.path, data);
                } catch (error) {
                    console.warn(`Failed to backup file ${child.path}:`, error);
                }
            }
        }
        const moveTime = new Date();
        await this._deleteDirectory(sourcePath, true);
        await this.createDirectoryWithMetadata(targetPath, originalCreated);
        const sourcePrefix = sourcePath === '/' ? '/' : sourcePath + '/';
        const targetPrefix = targetPath === '/' ? '/' : targetPath + '/';
        const sortedChildren = children.sort((a, b)=>a.path.length - b.path.length);
        for (const child of sortedChildren){
            const relativePath = child.path.slice(sourcePrefix.length);
            const newPath = targetPrefix + relativePath;
            if (child.type === 'directory') {
                await this.createDirectoryWithMetadata(newPath, child.created);
            } else {
                const fileData = fileDataBackup.get(child.path);
                if (!fileData) {
                    throw new VFSError('Failed to recover file data', 'EIO', child.path);
                }
                this.virtualFiles.set(newPath, {
                    data: fileData,
                    modified: moveTime
                });
                const newSearchPath = newPath.slice(1);
                this.entries.set(newPath, {
                    filename: newSearchPath,
                    directory: false,
                    uncompressedSize: typeof fileData === 'string' ? new TextEncoder().encode(fileData).length : fileData.byteLength,
                    lastModDate: child.created,
                    comment: '',
                    getData: undefined
                });
            }
        }
    }
    async createDirectoryWithMetadata(path, createdTime) {
        if (await this._exists(path)) {
            return;
        }
        const parent = PathUtils.dirname(path);
        if (parent !== '/' && parent !== path) {
            const parentExists = await this._exists(parent);
            if (!parentExists) {
                await this._makeDirectory(parent, true);
            }
        }
        const dirPath = path.endsWith('/') ? path.slice(1) : path.slice(1) + '/';
        this.entries.set(path, {
            filename: dirPath,
            directory: true,
            uncompressedSize: 0,
            lastModDate: createdTime,
            comment: ''
        });
        this.isModified = true;
    }
}

/**
 * Null file system.
 *
 * @public
 */ class NullVFS extends VFS {
    _dt;
    constructor(readonly = false){
        super(readonly);
        this._dt = new Date();
    }
    async _makeDirectory() {}
    async _readDirectory() {
        return [];
    }
    async _deleteDirectory() {}
    async _readFile(path) {
        throw new VFSError(`File does not exist: ${path}`, 'ENOENT', path);
    }
    async _writeFile() {}
    async _deleteFile() {}
    async _exists(path) {
        return path === '/';
    }
    async _stat(path) {
        if (path === '/') {
            return {
                size: 0,
                isFile: false,
                isDirectory: true,
                created: this._dt,
                modified: this._dt
            };
        }
        throw new VFSError('Path does not exist', 'ENOENT', path);
    }
    async _deleteFileSystem() {
        return;
    }
    async _wipe() {
        return;
    }
    async _move() {}
}

/**
 * DataTransfer-based virtual file system for handling dropped files and directories.
 *
 * Read-only VFS populated from a `DataTransfer` (drag-and-drop) or a `FileList`
 * (e.g., from `<input type="file" webkitdirectory>`).
 *
 * Notes:
 * - This VFS is read-only; mutating operations throw `VFSError` with code `"EROFS"`.
 * - For directory support via drag-and-drop, relies on non-standard WebKit APIs
 *   (`webkitGetAsEntry`, `FileSystemDirectoryEntry`, etc.) where available.
 *
 * @public
 */ class DataTransferVFS extends VFS {
    entries = new Map();
    directoryStructure = new Map();
    initialized = false;
    initPromise;
    /**
   * Constructs a read-only VFS from `DataTransfer` or `FileList`.
   *
   * Initialization is asynchronous. Public operations wait for completion via
   * an internal gate (`ensureInitialized`).
   *
   * @param data - The source of files/directories (drag-and-drop `DataTransfer` or `FileList`).
   */ constructor(data){
        super(true); // Always read-only
        this.initialized = false;
        this.initPromise = data instanceof DataTransfer ? this.initializeFromDataTransfer(data) : this.initializeFromFileList(data);
    }
    setReadonly(readonly) {
        if (!readonly) {
            console.error('DataTransfer VFS is always read-only');
        }
    }
    /**
   * {@inheritDoc VFS._readDirectory}
   */ async _readDirectory(path, options) {
        await this.ensureInitialized();
        const normalizedPath = this.normalizePath(path);
        if (!this.directoryStructure.has(normalizedPath)) {
            throw new VFSError('Directory does not exist', 'ENOENT', path);
        }
        const children = this.directoryStructure.get(normalizedPath);
        const results = [];
        for (const childName of children){
            const childPath = PathUtils.join(normalizedPath, childName);
            const entry = this.entries.get(childPath);
            let metadata;
            if (entry) {
                metadata = {
                    name: childName,
                    path: childPath,
                    size: entry.size,
                    type: 'file',
                    created: entry.lastModified,
                    modified: entry.lastModified
                };
            } else {
                metadata = {
                    name: childName,
                    path: childPath,
                    size: 0,
                    type: 'directory',
                    created: new Date(),
                    modified: new Date()
                };
            }
            if (this.matchesFilter(metadata, options)) {
                results.push(metadata);
            }
            if (options?.recursive && metadata.type === 'directory') {
                const subResults = await this._readDirectory(childPath, options);
                results.push(...subResults);
            }
        }
        return results;
    }
    /**
   * {@inheritDoc VFS._readFile}
   */ async _readFile(path, options) {
        await this.ensureInitialized();
        const normalizedPath = this.normalizePath(path);
        const entry = this.entries.get(normalizedPath);
        if (!entry || entry.isDirectory) {
            throw new VFSError(`File does not exist: ${path}`, 'ENOENT', path);
        }
        let arrayBuffer;
        if (options?.offset !== undefined || options?.length !== undefined) {
            const offset = options.offset ?? 0;
            const length = options.length ?? entry.file.size - offset;
            const blob = entry.file.slice(offset, offset + length);
            arrayBuffer = await blob.arrayBuffer();
        } else {
            arrayBuffer = await entry.file.arrayBuffer();
        }
        if (options?.encoding === 'utf8') {
            return new TextDecoder().decode(arrayBuffer);
        } else if (options?.encoding === 'base64') {
            const bytes = new Uint8Array(arrayBuffer);
            return uint8ArrayToBase64(bytes);
        } else {
            return arrayBuffer;
        }
    }
    /**
   * {@inheritDoc VFS._exists}
   */ async _exists(path) {
        await this.ensureInitialized();
        const normalizedPath = this.normalizePath(path);
        if (normalizedPath === '/') {
            return true;
        }
        return this.entries.has(normalizedPath) || this.directoryStructure.has(normalizedPath);
    }
    /**
   * {@inheritDoc VFS._stat}
   */ async _stat(path) {
        await this.ensureInitialized();
        const normalizedPath = this.normalizePath(path);
        if (normalizedPath === '/') {
            const now = new Date();
            return {
                size: 0,
                isFile: false,
                isDirectory: true,
                created: now,
                modified: now,
                accessed: now
            };
        }
        const entry = this.entries.get(normalizedPath);
        if (entry) {
            return {
                size: entry.size,
                isFile: true,
                isDirectory: false,
                created: entry.lastModified,
                modified: entry.lastModified,
                accessed: entry.lastModified
            };
        }
        if (this.directoryStructure.has(normalizedPath)) {
            const now = new Date();
            return {
                size: 0,
                isFile: false,
                isDirectory: true,
                created: now,
                modified: now,
                accessed: now
            };
        }
        throw new VFSError('Path does not exist', 'ENOENT', path);
    }
    // Read-only file system - throw errors for write operations
    /**
   * Not supported. DataTransfer VFS is read-only.
   * @throws {@link VFSError} with code `"EROFS"`.
   */ async _writeFile() {
        throw new VFSError('DataTransfer VFS is read-only', 'EROFS');
    }
    /**
   * Not supported. DataTransfer VFS is read-only.
   * @throws {@link VFSError} with code `"EROFS"`.
   */ async _makeDirectory() {
        throw new VFSError('DataTransfer VFS is read-only', 'EROFS');
    }
    /**
   * Not supported. DataTransfer VFS is read-only.
   * @throws {@link VFSError} with code `"EROFS"`.
   */ async _deleteFile() {
        throw new VFSError('DataTransfer VFS is read-only', 'EROFS');
    }
    /**
   * Not supported. DataTransfer VFS is read-only.
   * @throws {@link VFSError} with code `"EROFS"`.
   */ async _deleteDirectory() {
        throw new VFSError('DataTransfer VFS is read-only', 'EROFS');
    }
    /**
   * No-op for read-only VFS.
   */ async _wipe() {
        return;
    }
    /**
   * No-op for read-only VFS.
   */ _deleteFileSystem() {
        return Promise.resolve();
    }
    /**
   * No-op for read-only VFS.
   */ _move() {
        return Promise.resolve();
    }
    async ensureInitialized() {
        if (this.initialized) {
            return;
        }
        await this.initPromise;
        this.initialized = true;
    }
    async initializeFromDataTransfer(dataTransfer) {
        this.entries.clear();
        this.directoryStructure.clear();
        if (!dataTransfer || !dataTransfer.items) {
            return;
        }
        const filePromises = [];
        for(let i = 0; i < dataTransfer.items.length; i++){
            const item = dataTransfer.items[i];
            if (item.kind !== 'file') {
                continue;
            }
            const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null;
            if (entry) {
                const rootPath = this.normalizePath(`/${entry.name}`);
                if (entry.isFile) {
                    filePromises.push(this.collectFileOperation(entry, rootPath.slice(1)));
                } else if (entry.isDirectory) {
                    filePromises.push(this.collectDirectoryOperation(entry, rootPath));
                }
                continue;
            }
            const file = item.getAsFile && item.getAsFile();
            if (file) {
                filePromises.push(Promise.resolve({
                    file,
                    path: file.name
                }));
            }
        }
        const results = await Promise.all(filePromises);
        const flattened = results.flat();
        const fileEntries = [];
        for (const { file, path } of flattened){
            await this.processFile(file, path, fileEntries);
        }
        for (const e of fileEntries){
            this.entries.set(e.path, e);
            this.updateDirectoryStructure(e.path);
        }
        if (!this.directoryStructure.has('/')) {
            this.directoryStructure.set('/', new Set());
        }
    }
    async initializeFromFileList(fileList) {
        this.entries.clear();
        this.directoryStructure.clear();
        const fileEntries = [];
        for(let i = 0; i < fileList.length; i++){
            const file = fileList[i];
            const relativePath = file.webkitRelativePath || file.name;
            await this.processFile(file, relativePath, fileEntries);
        }
        for (const entry of fileEntries){
            this.entries.set(entry.path, entry);
            this.updateDirectoryStructure(entry.path);
        }
        if (!this.directoryStructure.has('/')) {
            this.directoryStructure.set('/', new Set());
        }
    }
    collectFileOperation(fileEntry, relativePath) {
        return new Promise((resolve, reject)=>{
            try {
                fileEntry.file((file)=>resolve({
                        file,
                        path: relativePath
                    }), (err)=>{
                    console.warn('collectFileOperation error:', err);
                    reject(err);
                });
            } catch (e) {
                console.warn('collectFileOperation exception:', e);
                reject(e);
            }
        });
    }
    collectDirectoryOperation(dirEntry, basePath) {
        return new Promise((resolve, reject)=>{
            const reader = dirEntry.createReader();
            const batchEntries = [];
            const readBatch = ()=>{
                try {
                    reader.readEntries((entries)=>{
                        if (entries.length === 0) {
                            const promises = [];
                            for (const child of batchEntries){
                                const childFullPath = this.normalizePath(`${basePath}/${child.name}`);
                                if (child.isFile) {
                                    promises.push(this.collectFileOperation(child, childFullPath.slice(1)));
                                } else if (child.isDirectory) {
                                    promises.push(this.collectDirectoryOperation(child, childFullPath));
                                }
                            }
                            Promise.all(promises).then((res)=>resolve(res.flat())).catch((err)=>{
                                console.warn('collectDirectoryOperation child error:', err);
                                reject(err);
                            });
                            return;
                        }
                        batchEntries.push(...entries);
                        readBatch();
                    }, (err)=>{
                        console.warn('collectDirectoryOperation readEntries error:', err);
                        reject(err);
                    });
                } catch (e) {
                    console.warn('collectDirectoryOperation exception:', e);
                    reject(e);
                }
            };
            readBatch();
        });
    }
    async processFile(file, relativePath, fileEntries) {
        const normalizedPath = this.normalizePath('/' + relativePath);
        const entry = {
            path: normalizedPath,
            file,
            isDirectory: false,
            size: file.size,
            lastModified: new Date(file.lastModified)
        };
        fileEntries.push(entry);
    }
    updateDirectoryStructure(filePath) {
        const parts = filePath.split('/').filter((p)=>p);
        let currentPath = '';
        // Create all parent directories
        for(let i = 0; i < parts.length - 1; i++){
            const parentPath = currentPath || '/';
            currentPath = currentPath + '/' + parts[i];
            const normalizedPath = this.normalizePath(currentPath);
            if (!this.directoryStructure.has(parentPath)) {
                this.directoryStructure.set(parentPath, new Set());
            }
            this.directoryStructure.get(parentPath).add(parts[i]);
            if (!this.directoryStructure.has(normalizedPath)) {
                this.directoryStructure.set(normalizedPath, new Set());
            }
        }
        // Add file to its parent directory
        const parentPath = PathUtils.dirname(filePath);
        const fileName = PathUtils.basename(filePath);
        if (!this.directoryStructure.has(parentPath)) {
            this.directoryStructure.set(parentPath, new Set());
        }
        this.directoryStructure.get(parentPath).add(fileName);
    }
    matchesFilter(metadata, options) {
        if (!options) {
            return true;
        }
        if (options.pattern) {
            if (typeof options.pattern === 'string') {
                return metadata.name.includes(options.pattern);
            } else if (options.pattern instanceof RegExp) {
                return options.pattern.test(metadata.name);
            }
        }
        return true;
    }
}

/**
 * A generic HTML directory reader that parses index-style HTML pages
 * to list directory entries (files and subdirectories).
 *
 * @remarks
 * - Targets simple directory listings produced by common HTTP servers (e.g., Apache, Nginx).
 * - Extracts entries from `<a>` elements and attempts to infer size and modified time
 *   from surrounding table rows or text content.
 * - Skips external links, parent-directory links, and anchors.
 * - Normalizes and resolves paths using the provided `HttpDirectoryReaderContext`.
 *
 * Limitations:
 * - Parsing depends on the server’s HTML structure; non-standard listings may yield incomplete metadata.
 * - Size/mtime extraction uses best-effort heuristics and may be unavailable for some servers.
 *
 * @public
 */ class GenericHtmlDirectoryReader {
    name = 'generic-html';
    async readOnce(dirPath, ctx) {
        const res = await ctx.fetch(dirPath, {
            method: 'GET',
            headers: {
                Accept: 'text/html,*/*'
            }
        });
        if (!res.ok) {
            throw new Error(`HTTP ${res.status} for ${dirPath}`);
        }
        const html = await res.text();
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const links = Array.from(doc.querySelectorAll('a'));
        const now = new Date();
        const items = [];
        const seen = new Set();
        for (const a of links){
            const hrefRaw = (a.getAttribute('href') || '').trim();
            const text = (a.textContent || '').trim();
            if (!hrefRaw || hrefRaw.startsWith('../') || hrefRaw.includes('/../') || text === '..' || hrefRaw === '#') {
                continue;
            }
            if (/^(?:https?:|mailto:|javascript:)/i.test(hrefRaw)) {
                continue;
            }
            // Remove query/hash
            let href = hrefRaw.split('#')[0].split('?')[0];
            if (href.startsWith('./')) {
                href = href.slice(2);
            }
            const isDir = href.endsWith('/');
            const cleanName = decodeURIComponent(isDir ? href.slice(0, -1) : href).split('/').filter(Boolean).pop() || '';
            if (!cleanName) {
                continue;
            }
            const fullPath = ctx.normalizePath(ctx.joinPath(dirPath, cleanName + (isDir ? '/' : '')));
            if (seen.has(fullPath)) {
                continue;
            }
            seen.add(fullPath);
            // resolve size/mtime
            let size = 0;
            let modified = now;
            const row = a.closest('tr');
            if (row) {
                const cells = Array.from(row.querySelectorAll('td,th')).map((td)=>(td.textContent || '').trim());
                for (const c of cells){
                    const d = tryParseDate(c);
                    if (d) {
                        modified = d;
                    }
                    const s = tryParseSize(c);
                    if (s != null) {
                        size = s;
                    }
                }
            } else {
                const line = (a.parentElement?.textContent || '').trim();
                const d = tryParseDate(line);
                if (d) {
                    modified = d;
                }
                const s = tryParseSize(line);
                if (s != null) {
                    size = s;
                }
            }
            items.push({
                name: cleanName,
                path: fullPath,
                size: isDir ? 0 : size,
                type: isDir ? 'directory' : 'file',
                created: modified,
                modified
            });
        }
        items.sort((a, b)=>a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'directory' ? -1 : 1);
        return items;
    }
}
function tryParseSize(s) {
    // Recoganize 123, 1.2K, 34KB, 5.6M, 7G, etc
    const m = s.match(/(\d+(?:\.\d+)?)\s*([KMGTP]?B?)\b/i);
    if (!m) {
        return null;
    }
    const n = parseFloat(m[1]);
    const unit = (m[2] || '').toUpperCase();
    const map = {
        '': 1,
        B: 1,
        K: 1024,
        KB: 1024,
        M: 1024 ** 2,
        MB: 1024 ** 2,
        G: 1024 ** 3,
        GB: 1024 ** 3,
        T: 1024 ** 4,
        TB: 1024 ** 4,
        P: 1024 ** 5,
        PB: 1024 ** 5
    };
    return Math.round(n * (map[unit] ?? 1));
}
function tryParseDate(s) {
    const cands = [
        s,
        s.replace(/\s+/g, ' ')
    ];
    for (const c of cands){
        const d = new Date(c);
        if (!isNaN(d.getTime())) {
            return d;
        }
    }
    // Apache format 01-May-2024 10:20
    const m = s.match(/(\d{1,2})-([A-Za-z]{3})-(\d{4})\s+(\d{2}:\d{2}(?::\d{2})?)/);
    if (m) {
        const months = {
            Jan: 0,
            Feb: 1,
            Mar: 2,
            Apr: 3,
            May: 4,
            Jun: 5,
            Jul: 6,
            Aug: 7,
            Sep: 8,
            Oct: 9,
            Nov: 10,
            Dec: 11
        };
        const day = parseInt(m[1], 10);
        const mon = months[m[2]];
        const year = parseInt(m[3], 10);
        const [hh, mm, ss] = m[4].split(':').map((x)=>parseInt(x, 10));
        const d = new Date(Date.UTC(year, mon, day, hh || 0, mm || 0, ss || 0));
        if (!isNaN(d.getTime())) {
            return d;
        }
    }
    return null;
}

// readers/PythonHttpServerReader.ts
/**
 * Directory reader for Python's built-in `http.server` (and similar)
 * HTML directory listings.
 *
 * @remarks
 * - Detects pages served by Python's `http.server` by scanning the `<title>` or `<h1>` tags.
 * - Parses `<ul><li><a>` (default Python layout) and falls back to plain `<a>` links.
 * - Skips parent directory entries (`../`), external links, and anchors.
 * - Attempts to extract file size and modification date from the link's surrounding text.
 * - Normalizes resolved paths via the provided `HttpDirectoryReaderContext`.
 *
 * Limitations:
 * - Parsing depends on the server's HTML structure; non-standard variants may not be fully parsed.
 * - Size and date extraction are best-effort and may be unavailable in some cases.
 *
 * @public
 */ class PythonHttpServerReader {
    name = 'python-http-server';
    async canHandle(dirPath, ctx) {
        try {
            const res = await ctx.fetch(dirPath, {
                method: 'GET',
                headers: {
                    Accept: 'text/html'
                }
            });
            if (!res.ok) {
                return false;
            }
            const html = await res.text();
            // Default title for Python http.server
            return /<title>\s*Directory listing for /i.test(html) || /<h1>\s*Directory listing for /i.test(html);
        } catch  {
            return false;
        }
    }
    async readOnce(dirPath, ctx) {
        const res = await ctx.fetch(dirPath, {
            method: 'GET',
            headers: {
                Accept: 'text/html,*/*'
            }
        });
        if (!res.ok) {
            throw new Error(`HTTP ${res.status} for ${dirPath}`);
        }
        const html = await res.text();
        const doc = new DOMParser().parseFromString(html, 'text/html');
        // Python uses <ul><li><a>... by default
        const links = Array.from(doc.querySelectorAll('ul li a, a'));
        const now = new Date();
        const out = [];
        const seen = new Set();
        for (const a of links){
            const hrefRaw = (a.getAttribute('href') || '').trim();
            const label = (a.textContent || '').trim();
            if (!hrefRaw || hrefRaw === '../' || label === '..') {
                continue;
            }
            if (/^(?:https?:|mailto:|javascript:)/i.test(hrefRaw)) {
                continue;
            }
            let href = hrefRaw.split('#')[0].split('?')[0];
            if (href.startsWith('./')) {
                href = href.slice(2);
            }
            const isDir = href.endsWith('/');
            const cleanName = decodeURIComponent(isDir ? href.slice(0, -1) : href).split('/').filter(Boolean).pop() || '';
            if (!cleanName) {
                continue;
            }
            const fullPath = ctx.normalizePath(ctx.joinPath(dirPath, cleanName + (isDir ? '/' : '')));
            if (seen.has(fullPath)) {
                continue;
            }
            seen.add(fullPath);
            let size = 0;
            let modified = now;
            const line = (a.parentElement?.textContent || '').trim();
            const d = tryParsePythonDate(line);
            if (d) {
                modified = d;
            }
            const s = tryParsePythonSize(line);
            if (s != null) {
                size = s;
            }
            out.push({
                name: cleanName,
                path: fullPath,
                size: isDir ? 0 : size,
                type: isDir ? 'directory' : 'file',
                created: modified,
                modified
            });
        }
        out.sort((a, b)=>a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'directory' ? -1 : 1);
        return out;
    }
}
function tryParsePythonSize(s) {
    const m1 = s.match(/\b(\d+(?:\.\d+)?)\s*(K|KB|M|MB|G|GB|T|TB|P|PB)\b/i);
    if (m1) {
        const n = parseFloat(m1[1]);
        const unit = m1[2].toUpperCase();
        const map = {
            K: 1024,
            KB: 1024,
            M: 1024 ** 2,
            MB: 1024 ** 2,
            G: 1024 ** 3,
            GB: 1024 ** 3,
            T: 1024 ** 4,
            TB: 1024 ** 4,
            P: 1024 ** 5,
            PB: 1024 ** 5
        };
        return Math.round(n * (map[unit] ?? 1));
    }
    const m2 = s.match(/\b(\d{1,12})\b/); // 防止匹配年份时间等超长数字
    if (m2) {
        const n = parseInt(m2[1], 10);
        if (Number.isFinite(n)) {
            return n;
        }
    }
    return null;
}
function tryParsePythonDate(s) {
    // Default date format of Python output "YYYY-MM-DD HH:MM" 或 "YYYY-MM-DD HH:MM:SS"
    const m = s.match(/\b(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?\b/);
    if (m) {
        const year = parseInt(m[1], 10);
        const mon = parseInt(m[2], 10) - 1;
        const day = parseInt(m[3], 10);
        const hh = parseInt(m[4], 10);
        const mm = parseInt(m[5], 10);
        const ss = m[6] ? parseInt(m[6], 10) : 0;
        const d = new Date(year, mon, day, hh, mm, ss);
        if (!isNaN(d.getTime())) {
            return d;
        }
    }
    const d2 = new Date(s);
    return isNaN(d2.getTime()) ? null : d2;
}

/**
 * Base class for any Disposable class
 * @public
 */ class Disposable extends Observable {
    _disposed;
    constructor(){
        super();
        this._disposed = false;
    }
    get disposed() {
        return this._disposed;
    }
    dispose() {
        if (!this._disposed) {
            this.dispatchEvent('dispose');
            this.onDispose();
            this._disposed = true;
        }
    }
    onDispose() {}
}
/**
 * Maps disposable objects to their reference counts.
 * @internal
 */ const objectReferenceMap = new WeakMap();
/**
 * Maps disposable objects to their weak references.
 * @internal
 */ const weakRefMap = new WeakMap();
/**
 * Holds objects that are pending disposal.
 * @internal
 */ const disposalQueue = new Set();
/**
 * Processes all pending disposals from the previous frame.
 * This should be called at the beginning of each frame
 * @public
 */ function flushPendingDisposals() {
    for (const obj of disposalQueue){
        obj.dispose();
        weakRefMap.get(obj)?.forEach((weakRef)=>{
            weakRef.dispose();
        });
    }
    disposalQueue.clear();
}
/**
 * Retains a disposable object
 * @param obj - Object to retain
 * @public
 *
 * @remarks
 * Retains an object will increase the reference counter for this object
 */ function retainObject(obj) {
    if (obj) {
        const ref = objectReferenceMap.get(obj) ?? 0;
        objectReferenceMap.set(obj, ref + 1);
        if (ref === 0) {
            disposalQueue.delete(obj);
        }
    }
}
/**
 * Releases a disposable object
 * @param obj - Object to release
 * @public
 *
 * @remarks
 * Releases an object will decrease the reference counter for this object.
 * If reference counter become zero, the object will be disposed at next frame.
 */ function releaseObject(obj) {
    if (obj) {
        let refcount = objectReferenceMap.get(obj) ?? 0;
        if (refcount > 0) {
            refcount--;
            if (refcount > 0) {
                objectReferenceMap.set(obj, refcount);
            } else {
                objectReferenceMap.delete(obj);
                disposalQueue.add(obj);
            }
        }
    }
}
/**
 * A reference-counting wrapper for disposable objects.
 *
 * @public
 */ class DRef {
    /** @internal */ _object;
    /**
   * Creates a new reference to a disposable object.
   * @param obj - The disposable object to reference
   */ constructor(obj){
        this._object = obj ?? null;
        retainObject(this._object);
    }
    /**
   * Gets the currently referenced object.
   * @returns The referenced object, or null if none is set
   */ get() {
        return this._object;
    }
    /**
   * Sets a new object reference, releasing the previous one if it exists.
   * @param obj - The new object to reference
   */ set(obj) {
        if (obj !== this._object) {
            releaseObject(this._object);
            this._object = obj;
            retainObject(this._object);
        }
    }
    /**
   * Releases the reference and cleans up resources.
   */ dispose() {
        releaseObject(this._object);
        this._object = null;
    }
}
/**
 * A weak-reference-counting wrapper for disposable objects.
 *
 * @public
 */ class DWeakRef {
    /** @internal */ _object;
    /**
   * Creates a new reference to a disposable object.
   * @param obj - The disposable object to reference
   */ constructor(obj){
        this._object = obj ?? null;
        this.retain();
    }
    /**
   * Gets the currently referenced object.
   * @returns The referenced object, or null if none is set
   */ get() {
        if (this._object?.disposed) {
            this.dispose();
        }
        return this._object;
    }
    /**
   * Sets a new object reference, releasing the previous one if it exists.
   * @param obj - The new object to reference
   */ set(obj) {
        if (obj !== this._object) {
            this.release();
            this._object = obj;
            this.retain();
        }
    }
    /**
   * Releases the reference and cleans up resources.
   */ dispose() {
        this.release();
    }
    /** @internal */ retain() {
        if (this._object) {
            const weakRefList = weakRefMap.get(this._object);
            if (weakRefList) {
                weakRefList.add(this);
            } else {
                weakRefMap.set(this._object, new Set([
                    this
                ]));
            }
        }
    }
    /** @internal */ release() {
        if (this._object) {
            weakRefMap.get(this._object)?.delete(this);
            this._object = null;
        }
    }
}

export { AABB, ASSERT, BoxSide, ClipState, CubeFace, DRef, DWeakRef, DataTransferVFS, Disposable, Frustum, GenericHtmlDirectoryReader, GlobMatcher, HeightField, HttpFS, HttpRequest, IS_INSTANCE_OF, IS_SUBCLASS_OF, IndexedDBFS, Interpolator, List, ListIterator, Matrix3x3, Matrix4x4, MemoryFS, NullVFS, Observable, ObservableQuaternion, ObservableVector2, ObservableVector3, ObservableVector4, OrderedStringSet, PRNG, PathUtils, Plane, PythonHttpServerReader, Quaternion, Ray, RectsPacker, SH, VFS, VFSError, Vector2, Vector3, Vector4, VectorBase, ZipFS, applyMixins, applyPatch, base64ToText, base64ToUint8Array, degree2radian, diff, float2half, flushPendingDisposals, formatString, guessMimeType, half2float, halfToFloat, halton23, isPowerOf2, makeObservable, nextPowerOf2, objectEntries, objectKeys, packFloat3, parseColor, perlinNoise1D, perlinNoise2D, perlinNoise3D, radian2degree, randomUUID, releaseObject, retainObject, textToBase64, toFloat, uint8ArrayToBase64, unpackFloat3, weightedAverage };
//# sourceMappingURL=zephyr3d_base.js.map
