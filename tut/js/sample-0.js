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
 * This mixin make a class an event target
 * @param cls - the class to make
 * @returns - The event target class
 * @public
 */ function makeEventTarget(cls) {
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
                this._listeners = this._internalAddEventListener(this._listeners, type, listener, {
                    context
                });
            }
            /**
       * {@inheritDoc IEventTarget.once}
       */ once(type, listener, context) {
                this._listeners = this._internalAddEventListener(this._listeners, type, listener, {
                    context,
                    once: true
                });
            }
            /**
       * {@inheritDoc IEventTarget.off}
       */ off(type, listener) {
                this._internalRemoveEventListener(this._listeners, type, listener);
            }
            /**
       * {@inheritDoc IEventTarget.dispatchEvent}
       */ dispatchEvent(evt, type) {
                this._invokeLocalListeners(evt, type);
            }
            /** @internal */ _internalAddEventListener(listenerMap, type, listener, options) {
                if (typeof type !== 'string') {
                    return;
                }
                if (!listenerMap) {
                    listenerMap = {};
                }
                const l = listener;
                const o = {
                    once: !!options?.once,
                    context: options?.context
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
            /** @internal */ _internalRemoveEventListener(listenerMap, type, listener) {
                if (typeof type !== 'string' || !listenerMap) {
                    return;
                }
                const l = listener;
                const handlers = listenerMap[type];
                if (handlers) {
                    for(let i = 0; i < handlers.length; i++){
                        const handler = handlers[i];
                        if (handler.handler === l) {
                            handlers.splice(i, 1);
                            break;
                        }
                    }
                }
                if (handlers.length === 0) {
                    delete listenerMap[type];
                }
            }
            /** @internal */ _invokeLocalListeners(evt, type) {
                if (!this._listeners) {
                    return;
                }
                const handlers = this._listeners[type ?? evt?.type];
                if (handlers && handlers.length > 0) {
                    const handlersCopy = handlers.slice();
                    for (const handler of handlersCopy){
                        handler.handler.call(handler.options?.context || this, evt);
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
 * Enumerator used to refer to a box side
 * @public
 */ var BoxSide;
(function(BoxSide) {
    BoxSide[BoxSide[/** Left side (-x) */ "LEFT"] = 0] = "LEFT";
    BoxSide[BoxSide[/** Right side (+x) */ "RIGHT"] = 1] = "RIGHT";
    BoxSide[BoxSide[/** Bottom side (-y) */ "BOTTOM"] = 2] = "BOTTOM";
    BoxSide[BoxSide[/** Top side (+y) */ "TOP"] = 3] = "TOP";
    BoxSide[BoxSide[/** Front side (+z) */ "FRONT"] = 4] = "FRONT";
    BoxSide[BoxSide[/** Back side (-z) */ "BACK"] = 5] = "BACK";
})(BoxSide || (BoxSide = {}));
var ClipState;
(function(ClipState) {
    ClipState[ClipState[/** A does not intersect with B */ "NOT_CLIPPED"] = 0] = "NOT_CLIPPED";
    ClipState[ClipState[/** A is inside B */ "A_INSIDE_B"] = 1] = "A_INSIDE_B";
    ClipState[ClipState[/** B is inside A */ "B_INSIDE_A"] = 2] = "B_INSIDE_A";
    ClipState[ClipState[/** A and B partially overlap */ "CLIPPED"] = 2] = "CLIPPED";
})(ClipState || (ClipState = {}));
var CubeFace;
(function(CubeFace) {
    CubeFace[CubeFace["PX"] = 0] = "PX";
    CubeFace[CubeFace["NX"] = 1] = "NX";
    CubeFace[CubeFace["PY"] = 2] = "PY";
    CubeFace[CubeFace["NY"] = 3] = "NY";
    CubeFace[CubeFace["PZ"] = 4] = "PZ";
    CubeFace[CubeFace["NZ"] = 5] = "NZ";
})(CubeFace || (CubeFace = {}));

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
            } else if (arg0 !== void 0) {
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
        return Math.sqrt(this[0] * this[0] + this[1] * this[1]);
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
        const mag = Math.sqrt(x * x + y * y);
        return this.setXY(x / mag, y / mag);
    }
    /**
   * Subtract a vector from this vector.
   * @param other - The vector that will be subtract.
   * @returns self
   */ subBy(other) {
        return Vector2.sub(this, other, this);
    }
    /**
   * Add a vector to this vector.
   * @param other - The vector that will be added.
   * @returns self
   */ addBy(other) {
        return Vector2.add(this, other, this);
    }
    /**
   * Multiply this vector by a vector.
   * @param other - The vector that will be multiplied by.
   * @returns self
   */ mulBy(other) {
        return Vector2.mul(this, other, this);
    }
    /**
   * Divide this vector by a vector.
   * @param other - The vector that will be divide by.
   * @returns self
   */ divBy(other) {
        return Vector2.div(this, other, this);
    }
    /**
   * Scale this vector by a scalar number.
   * @param f - amount to scale this vector by.
   * @returns self
   */ scaleBy(f) {
        return Vector2.scale(this, f, this);
    }
    /**
   * Normalize this vector inplace.
   * @returns self
   */ inplaceNormalize() {
        return Vector2.normalize(this, this);
    }
    /**
   * Inverse this vector inplace.
   * @returns self
   */ inplaceInverse() {
        return Vector2.inverse(this, this);
    }
    /**
   * Set the component values to the minimum of this vector and another vector.
   * @param other - The vector that to be compared with.
   * @returns self
   */ inplaceMin(other) {
        return Vector2.min(this, other, this);
    }
    /**
   * Set the component values to the maximum of this vector and another vector.
   * @param other - The vector that to be compared with.
   * @returns self
   */ inplaceMax(other) {
        return Vector2.max(this, other, this);
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
        return Math.sqrt(this.distanceSq(v1, v2));
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
            } else if (arg0 !== void 0) {
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
        return Math.sqrt(this[0] * this[0] + this[1] * this[1] + this[2] * this[2]);
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
        const mag = Math.sqrt(x * x + y * y + z * z);
        return this.setXYZ(x / mag, y / mag, z / mag);
    }
    /**
   * Subtract a vector from this vector.
   * @param other - The vector that will be subtract.
   * @returns self
   */ subBy(other) {
        return Vector3.sub(this, other, this);
    }
    /**
   * Add a vector to this vector.
   * @param other - The vector that will be added.
   * @returns self
   */ addBy(other) {
        return Vector3.add(this, other, this);
    }
    /**
   * Multiply this vector by a vector.
   * @param other - The vector that will be multiplied by.
   * @returns self
   */ mulBy(other) {
        return Vector3.mul(this, other, this);
    }
    /**
   * Divide this vector by a vector.
   * @param other - The vector that will be divide by.
   * @returns self
   */ divBy(other) {
        return Vector3.div(this, other, this);
    }
    /**
   * Scale this vector by a scalar number.
   * @param f - amount to scale this vector by.
   * @returns self
   */ scaleBy(f) {
        return Vector3.scale(this, f, this);
    }
    /**
   * Normalize this vector inplace.
   * @returns self
   */ inplaceNormalize() {
        return Vector3.normalize(this, this);
    }
    /**
   * Inverse this vector inplace.
   * @returns self
   */ inplaceInverse() {
        return Vector3.inverse(this, this);
    }
    /**
   * Set the component values to the minimum of this vector and another vector.
   * @param other - The vector that to be compared with.
   * @returns self
   */ inplaceMin(other) {
        return Vector3.min(this, other, this);
    }
    /**
   * Set the component values to the maximum of this vector and another vector.
   * @param other - The vector that to be compared with.
   * @returns self
   */ inplaceMax(other) {
        return Vector3.max(this, other, this);
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
        return Math.sqrt(this.distanceSq(v1, v2));
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
            } else if (arg0 !== void 0) {
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
        return Math.sqrt(this[0] * this[0] + this[1] * this[1] + this[2] * this[2] + this[3] * this[3]);
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
        const mag = Math.sqrt(x * x + y * y + z * z + w * w);
        return this.setXYZW(x / mag, y / mag, z / mag, w / mag);
    }
    /**
   * Subtract a vector from this vector.
   * @param other - The vector that will be subtract.
   * @returns self
   */ subBy(other) {
        return Vector4.sub(this, other, this);
    }
    /**
   * Add a vector to this vector.
   * @param other - The vector that will be added.
   * @returns self
   */ addBy(other) {
        return Vector4.add(this, other, this);
    }
    /**
   * Multiply this vector by a vector.
   * @param other - The vector that will be multiplied by.
   * @returns self
   */ mulBy(other) {
        return Vector4.mul(this, other, this);
    }
    /**
   * Divide this vector by a vector.
   * @param other - The vector that will be divide by.
   * @returns self
   */ divBy(other) {
        return Vector4.div(this, other, this);
    }
    /**
   * Scale this vector by a scalar number.
   * @param f - amount to scale this vector by.
   * @returns self
   */ scaleBy(f) {
        return Vector4.scale(this, f, this);
    }
    /**
   * Normalize this vector inplace.
   * @returns self
   */ inplaceNormalize() {
        return Vector4.normalize(this, this);
    }
    /**
   * Inverse this vector inplace.
   * @returns self
   */ inplaceInverse() {
        return Vector4.inverse(this, this);
    }
    /**
   * Set the component values to the minimum of this vector and another vector.
   * @param other - The vector that to be compared with.
   * @returns self
   */ inplaceMin(other) {
        return Vector4.min(this, other, this);
    }
    /**
   * Set the component values to the maximum of this vector and another vector.
   * @param other - The vector that to be compared with.
   * @returns self
   */ inplaceMax(other) {
        return Vector4.max(this, other, this);
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
            } else if (arg0 === void 0) {
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
        return Quaternion.scale(this, f, this);
    }
    /**
   * Set component values and then normalize the quaternion.
   * @param x - The x component value.
   * @param y - The y component value.
   * @param z - The z component value.
   * @param w - The w component value.
   * @returns self
   */ setAndNormalize(x, y, z, w) {
        const mag = Math.sqrt(x * x + y * y + z * z + w * w);
        return this.setXYZW(x / mag, y / mag, z / mag, w / mag);
    }
    /** Get the length of the quaternion. */ get magnitude() {
        return Math.sqrt(this[0] * this[0] + this[1] * this[1] + this[2] * this[2] + this[3] * this[3]);
    }
    /** Get the squared length of the quaternion. */ get magnitudeSq() {
        return this[0] * this[0] + this[1] * this[1] + this[2] * this[2] + this[3] * this[3];
    }
    /** Make this quaternion an identity quaternion */ identity() {
        return Quaternion.identity(this);
    }
    /**
   * Normalize this quaternion inplace.
   * @returns self
   */ inplaceNormalize() {
        return Quaternion.normalize(this, this);
    }
    /**
   * Calculates the conjugate of this quaternion inplace.
   * @returns self
   */ inplaceConjugate() {
        return Quaternion.conjugate(this, this);
    }
    /**
   * Multiply this quaternion by another quaternion at the right side inplace.
   * @param other - The quaternion that to be multiplied by.
   * @returns self
   */ multiplyRight(other) {
        return Quaternion.multiply(this, other, this);
    }
    /**
   * Multiply this quaternion by another quaternion at the left side inplace.
   * @param other - The quaternion that to be multiplied by.
   * @returns self
   */ multiplyLeft(other) {
        return Quaternion.multiply(other, this, this);
    }
    /**
   * Make a quaternion used to rotate a unit vector to another inplace.
   * @param from - The unit vector to be rotated.
   * @param to - The destination unit vector.
   * @returns self
   */ unitVectorToUnitVector(from, to) {
        return Quaternion.unitVectorToUnitVector(from, to, this);
    }
    /**
   * Calculates the quaternion from an euler angle in specific order inplace.
   * @param x - Angle to rotate around X axis in radians.
   * @param y - Angle to rotate around Y axis in radians.
   * @param z - Angle to rotate around Z axis in radians.
   * @param order - Intrinsic order for conversion.
   * @returns self
   */ fromEulerAngle(x, y, z, order) {
        return Quaternion.fromEulerAngle(x, y, z, order, this);
    }
    /**
   * Calculates the quaternion from the given angle and rotation axis inplace.
   * @param axis - The rotation axis.
   * @param angle - The rotate angle.
   * @returns self
   */ fromAxisAngle(axis, angle) {
        return Quaternion.fromAxisAngle(axis, angle, this);
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
        const roll = Math.atan2(t0, t1);
        const t2 = Math.max(-1, Math.min(1, 2 * (this.w * this.y - this.z * this.x)));
        const pitch = Math.asin(t2);
        const t3 = 2 * (this.w * this.z + this.x * this.y);
        const t4 = 1 - 2 * (this.y * this.y + this.z * this.z);
        const yaw = Math.atan2(t3, t4);
        return angles.setXYZ(roll, pitch, yaw);
    }
    /**
   * Calculates the quaternion from a rotation matrix inplace.
   * @param matrix - The rotation matrix.
   * @returns self
   */ fromRotationMatrix(matrix) {
        return Quaternion.fromRotationMatrix(matrix, this);
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
   */ static fromEulerAngle(a, b, c, order, result) {
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
            } else if (arg0 === void 0) {
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
   * @returns The output matrix
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
   * @returns
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
   * @returns The output matrix
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
   * @returns The output matrix
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
        const n = Math.sqrt(x * x + y * y + z * z);
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
        return Matrix3x3.sub(this, other, this);
    }
    /**
   * Add a matrix to this matrix component-wise.
   * @param other - The matrix that will be added.
   * @returns self
   */ addBy(other) {
        return Matrix3x3.add(this, other, this);
    }
    /**
   * Multiplies this matrix by a matrix component-wise.
   * @param other - The matrix that will be multiplied by.
   * @returns self
   */ mulBy(other) {
        return Matrix3x3.mul(this, other, this);
    }
    /**
   * Divide this matrix by a matrix component-wise.
   * @param other - The matrix that will be divide by.
   * @returns self
   */ divBy(other) {
        return Matrix3x3.div(this, other, this);
    }
    /**
   * Scale this matrix by a scalar number component-wise.
   * @param f - amount to scale this matrix by.
   * @returns self
   */ scaleBy(f) {
        return Matrix3x3.scale(this, f, this);
    }
    /**
   * Make this matrix identity.
   * @returns self
   */ identity() {
        return Matrix3x3.identity(this);
    }
    /**
   * Calculate the inverse of this matrix inplace.
   * @returns self
   */ inplaceInvert() {
        return Matrix3x3.invert(this, this);
    }
    /**
   * Calculate the transpose of this matrix inplace.
   * @returns self
   */ transpose() {
        return Matrix3x3.transpose(this, this);
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
        return Matrix3x3.multiply(this, other, this);
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
        return Matrix3x3.multiply(other, this, this);
    }
    /**
   * Calculates a rotation around x axis inplace.
   * @param angle - The rotate angle in radians.
   * @returns self
   */ rotationX(angle) {
        return Matrix3x3.rotationX(angle, this);
    }
    /**
   * Calculates a rotation around y axis inplace.
   * @param angle - The rotate angle in radians.
   * @returns self
   */ rotationY(angle) {
        return Matrix3x3.rotationY(angle, this);
    }
    /**
   * Calculates a rotation around z axis inplace.
   * @param angle - The rotate angle in radians.
   * @returns self
   */ rotationZ(angle) {
        return Matrix3x3.rotationZ(angle, this);
    }
    /**
   * Calculates a rotation around a given axis.
   * @param axis - The rotation axis.
   * @param angle - The rotate angle in radians.
   * @returns self
   */ rotation(axis, angle) {
        return Matrix3x3.rotation(axis, angle, this);
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
                this.m03 = 0;
                this.m13 = 0;
                this.m23 = 0;
                this.m30 = 0;
                this.m31 = 0;
                this.m32 = 0;
                this.m33 = 1;
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
            } else if (arg0 === void 0) {
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
        const n = Math.sqrt(x * x + y * y + z * z);
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
                return null;
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
        if (result !== m) {
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
        } else {
            result[0] *= s.x;
            result[1] *= s.y;
            result[2] *= s.z;
            result[4] *= s.x;
            result[5] *= s.y;
            result[6] *= s.z;
            result[8] *= s.x;
            result[9] *= s.y;
            result[10] *= s.z;
            result[12] *= s.x;
            result[13] *= s.y;
            result[14] *= s.z;
        }
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
        return Matrix4x4.sub(this, other, this);
    }
    /**
   * Add a matrix to this matrix component-wise.
   * @param other - The matrix that will be added.
   * @returns self
   */ addBy(other) {
        return Matrix4x4.add(this, other, this);
    }
    /**
   * Multiplies this matrix by a matrix component-wise.
   * @param other - The matrix that will be multiplied by.
   * @returns self
   */ mulBy(other) {
        return Matrix4x4.mul(this, other, this);
    }
    /**
   * Divide this matrix by a matrix component-wise.
   * @param other - The matrix that will be divide by.
   * @returns self
   */ divBy(other) {
        return Matrix4x4.div(this, other, this);
    }
    /**
   * Scale this matrix by a scalar number component-wise.
   * @param f - amount to scale this matrix by.
   * @returns self
   */ scaleBy(f) {
        return Matrix4x4.scale(this, f, this);
    }
    /**
   * Make this matrix identity.
   * @returns self
   */ identity() {
        return Matrix4x4.identity(this);
    }
    /**
   * Calculates a right-handed perspective projection matrix inplace.
   * @param fovY - The vertical field of view in radians.
   * @param aspect - The aspect ratio.
   * @param znear - The near clip plane.
   * @param zfar - The far clip plane.
   * @returns self
   */ perspective(fovY, aspect, znear, zfar) {
        return Matrix4x4.perspective(fovY, aspect, znear, zfar, this);
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
        return Matrix4x4.frustum(left, right, bottom, top, znear, zfar, this);
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
        return Matrix4x4.ortho(left, right, bottom, top, near, far, this);
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
        // assum this is an orthogonal projection matrix
        return (-1 - this[12]) / this[0];
    }
    /**
   * Get the right clip plane.
   *
   * @remarks
   * This method assumes that the matrix is an orthogonal projection matrix.
   *
   * @returns The right clip plane
   */ getRightPlane() {
        // assum this is an orthogonal projection matrix
        return (1 - this[12]) / this[0];
    }
    /**
   * Get the top clip plane.
   *
   * @remarks
   * This method assumes that the matrix is an orthogonal projection matrix.
   *
   * @returns The top clip plane
   */ getTopPlane() {
        // assum this is an orthogonal projection matrix
        return (1 - this[13]) / this[5];
    }
    /**
   * Get the bottom clip plane.
   *
   * @remarks
   * This method assumes that the matrix is an orthogonal projection matrix.
   *
   * @returns The bottom clip plane
   */ getBottomPlane() {
        // assum this is an orthogonal projection matrix
        return (-1 - this[13]) / this[5];
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
        return Matrix4x4.translation(t, this);
    }
    /**
   * Calculates a scale matrix inplace.
   * @param s - The scale vector.
   * @returns self
   */ scaling(s) {
        return Matrix4x4.scaling(s, this);
    }
    /**
   * Invert this matrix inplace.
   * @returns self
   */ inplaceInvert() {
        return Matrix4x4.invert(this, this);
    }
    /**
   * Invert this matrix inplace, assuming this matrix presents an affine transformation.
   * @returns self
   */ inplaceInvertAffine() {
        return Matrix4x4.invertAffine(this, this);
    }
    /**
   * Calculates the transpose of this matrix inplace.
   * @returns self
   */ transpose() {
        return Matrix4x4.transpose(this, this);
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
        return Matrix4x4.multiply(this, other, this);
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
        return Matrix4x4.multiplyAffine(this, other, this);
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
        return Matrix4x4.multiply(other, this, this);
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
        return Matrix4x4.multiplyAffine(other, this, this);
    }
    /**
   * Calculates a rotation around x axis inplace.
   * @param angle - The rotate angle in radians.
   * @returns self
   */ rotationX(angle) {
        return Matrix4x4.rotationX(angle, this);
    }
    /**
   * Calculates a rotation around y axis inplace.
   * @param angle - The rotate angle in radians.
   * @returns self
   */ rotationY(angle) {
        return Matrix4x4.rotationY(angle, this);
    }
    /**
   * Calculates a rotation around z axis inplace.
   * @param angle - The rotate angle in radians.
   * @returns self
   */ rotationZ(angle) {
        return Matrix4x4.rotationZ(angle, this);
    }
    /**
   * Calculates a rotation around a given axis inplace.
   * @param axis - The rotation axis.
   * @param angle - The rotate angle in radians.
   * @returns self
   */ rotation(axis, angle) {
        return Matrix4x4.rotation(axis, angle, this);
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
        return Matrix4x4.translateRight(this, t, this);
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
        return Matrix4x4.translateLeft(this, t, this);
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
        return Matrix4x4.scaleRight(this, s, this);
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
        return Matrix4x4.scaleLeft(this, s, this);
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
        return Matrix4x4.rotateRight(this, r, this);
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
        return Matrix4x4.rotateLeft(this, r, this);
    }
    /**
   * Calculates a look-at matrix inplace.
   * @param eye - Position of the eye.
   * @param target - The point that the eye is looking at.
   * @param up - The up vector.
   * @returns self
   */ lookAt(eye, target, up) {
        return Matrix4x4.lookAt(eye, target, up, this);
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
   * Decompose this matrix into its rotation, translation and scale components.
   * @param scale - The output scale vector.
   * @param rotation - The output rotation matrix or quaternion.
   * @param translation - The output translation vector.
   * @returns self
   */ decompose(scale, rotation, translation) {
        if (translation) {
            translation.setXYZ(this[12], this[13], this[14]);
        }
        const sign = this.det() <= 0 ? -1 : 1;
        const sx = Math.sqrt(this[0] * this[0] + this[1] * this[1] + this[2] * this[2]);
        const sy = Math.sqrt(this[4] * this[4] + this[5] * this[5] + this[6] * this[6]) * sign;
        const sz = Math.sqrt(this[8] * this[8] + this[9] * this[9] + this[10] * this[10]);
        if (scale) {
            scale.setXYZ(sx, sy, sz);
        }
        if (rotation instanceof Quaternion) {
            const rotationMatrix = new Matrix3x3(this);
            rotationMatrix[0] /= sx;
            rotationMatrix[1] /= sx;
            rotationMatrix[2] /= sx;
            rotationMatrix[3] /= sy;
            rotationMatrix[4] /= sy;
            rotationMatrix[5] /= sy;
            rotationMatrix[6] /= sz;
            rotationMatrix[7] /= sz;
            rotationMatrix[8] /= sz;
            rotation.fromRotationMatrix(rotationMatrix);
        } else if (rotation instanceof Matrix3x3) {
            rotation[0] = this[0] / sx;
            rotation[1] = this[1] / sx;
            rotation[2] = this[2] / sx;
            rotation[3] = this[4] / sy;
            rotation[4] = this[5] / sy;
            rotation[5] = this[6] / sy;
            rotation[6] = this[8] / sz;
            rotation[7] = this[9] / sz;
            rotation[8] = this[10] / sz;
        } else if (rotation instanceof Matrix4x4) {
            rotation[0] = this[0] / sx;
            rotation[1] = this[1] / sx;
            rotation[2] = this[2] / sx;
            rotation[3] = 0;
            rotation[4] = this[4] / sy;
            rotation[5] = this[5] / sy;
            rotation[6] = this[6] / sy;
            rotation[7] = 0;
            rotation[8] = this[8] / sz;
            rotation[9] = this[9] / sz;
            rotation[10] = this[10] / sz;
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
        eye && eye.setXYZ(this[12], this[13], this[14]);
        up && up.setXYZ(this[4], this[5], this[6]);
        target && target.setXYZ(this[12] - this[8], this[13] - this[9], this[14] - this[10]);
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
            return {
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height,
                binIndex: this._bins.length - 1
            };
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

const RED_SHIFT = 0;
const GREEN_SHIFT = 1;
const BLUE_SHIFT = 2;
const ALPHA_SHIFT = 3;
const DEPTH_SHIFT = 4;
const STENCIL_SHIFT = 5;
const FLOAT_SHIFT = 6;
const INTEGER_SHIFT = 7;
const SIGNED_SHIFT = 8;
const SRGB_SHIFT = 9;
const BGR_SHIFT = 10;
const BLOCK_SIZE_SHIFT = 11;
const BLOCK_SIZE_MASK = 0x1f << BLOCK_SIZE_SHIFT;
const BLOCK_WIDTH_SHIFT = 16;
const BLOCK_WIDTH_MASK = 0xf << BLOCK_WIDTH_SHIFT;
const BLOCK_HEIGHT_SHIFT = 20;
const BLOCK_HEIGHT_MASK = 0xf << BLOCK_HEIGHT_SHIFT;
const COMPRESSED_FORMAT_SHIFT = 24;
const COMPRESSION_FORMAT_BC1 = 1 << COMPRESSED_FORMAT_SHIFT;
const COMPRESSION_FORMAT_BC2 = 2 << COMPRESSED_FORMAT_SHIFT;
const COMPRESSION_FORMAT_BC3 = 3 << COMPRESSED_FORMAT_SHIFT;
/*
const COMPRESSION_FORMAT_BC4 = 4 << COMPRESSED_FORMAT_SHIFT;
const COMPRESSION_FORMAT_BC5 = 5 << COMPRESSED_FORMAT_SHIFT;
const COMPRESSION_FORMAT_BC6 = 6 << COMPRESSED_FORMAT_SHIFT;
const COMPRESSION_FORMAT_BC7 = 7 << COMPRESSED_FORMAT_SHIFT;
const COMPRESSION_FORMAT_ETC2_RGB8 = 8 << COMPRESSED_FORMAT_SHIFT;
const COMPRESSION_FORMAT_ETC2_RGB8_A1 = 9 << COMPRESSED_FORMAT_SHIFT;
const COMPRESSION_FORMAT_ETC2_RGBA8 = 10 << COMPRESSED_FORMAT_SHIFT;
const COMPRESSION_FORMAT_ASTC_4x4 = 11 << COMPRESSED_FORMAT_SHIFT;
const COMPRESSION_FORMAT_ASTC_5x4 = 12 << COMPRESSED_FORMAT_SHIFT;
const COMPRESSION_FORMAT_ASTC_5x5 = 13 << COMPRESSED_FORMAT_SHIFT;
const COMPRESSION_FORMAT_ASTC_6x5 = 14 << COMPRESSED_FORMAT_SHIFT;
const COMPRESSION_FORMAT_ASTC_6x6 = 15 << COMPRESSED_FORMAT_SHIFT;
const COMPRESSION_FORMAT_ASTC_8x5 = 16 << COMPRESSED_FORMAT_SHIFT;
const COMPRESSION_FORMAT_ASTC_8x6 = 17 << COMPRESSED_FORMAT_SHIFT;
const COMPRESSION_FORMAT_ASTC_8x8 = 18 << COMPRESSED_FORMAT_SHIFT;
const COMPRESSION_FORMAT_ASTC_10x5 = 19 << COMPRESSED_FORMAT_SHIFT;
const COMPRESSION_FORMAT_ASTC_10x6 = 20 << COMPRESSED_FORMAT_SHIFT;
const COMPRESSION_FORMAT_ASTC_10x8 = 21 << COMPRESSED_FORMAT_SHIFT;
const COMPRESSION_FORMAT_ASTC_10x10 = 22 << COMPRESSED_FORMAT_SHIFT;
const COMPRESSION_FORMAT_ASTC_12x10 = 23 << COMPRESSED_FORMAT_SHIFT;
const COMPRESSION_FORMAT_ASTC_12x12 = 24 << COMPRESSED_FORMAT_SHIFT;
*/ const COMPRESSION_FORMAT_BITMASK = 0x1f << COMPRESSED_FORMAT_SHIFT;
const RED_BITMASK = 1 << RED_SHIFT;
const GREEN_BITMASK = 1 << GREEN_SHIFT;
const BLUE_BITMASK = 1 << BLUE_SHIFT;
const ALPHA_BITMASK = 1 << ALPHA_SHIFT;
const DEPTH_BITMASK = 1 << DEPTH_SHIFT;
const STENCIL_BITMASK = 1 << STENCIL_SHIFT;
const FLOAT_BITMASK = 1 << FLOAT_SHIFT;
const INTEGER_BITMASK = 1 << INTEGER_SHIFT;
const SIGNED_BITMASK = 1 << SIGNED_SHIFT;
const SRGB_BITMASK = 1 << SRGB_SHIFT;
const BGR_BITMASK = 1 << BGR_SHIFT;
function makeTextureFormat(compression, r, g, b, a, depth, stencil, float, integer, signed, srgb, bgr, blockWidth, blockHeight, blockSize) {
    const compressionBits = compression;
    const colorBits = (r ? RED_BITMASK : 0) | (g ? GREEN_BITMASK : 0) | (b ? BLUE_BITMASK : 0) | (a ? ALPHA_BITMASK : 0);
    const depthStencilBits = (depth ? DEPTH_BITMASK : 0) | (stencil ? STENCIL_BITMASK : 0);
    const floatBits = float ? FLOAT_BITMASK : 0;
    const integerBits = integer ? INTEGER_BITMASK : 0;
    const signedBits = signed ? SIGNED_BITMASK : 0;
    const srgbBits = srgb ? SRGB_BITMASK : 0;
    const bgrBits = bgr ? BGR_BITMASK : 0;
    const blockBits = blockWidth << BLOCK_WIDTH_SHIFT | blockHeight << BLOCK_HEIGHT_SHIFT | blockSize << BLOCK_SIZE_SHIFT;
    return compressionBits | colorBits | depthStencilBits | floatBits | integerBits | signedBits | srgbBits | bgrBits | blockBits;
}
const textureFormatMap = {
    unknown: 0,
    r8unorm: makeTextureFormat(0, true, false, false, false, false, false, false, false, false, false, false, 1, 1, 1),
    r8snorm: makeTextureFormat(0, true, false, false, false, false, false, false, false, true, false, false, 1, 1, 1),
    r16f: makeTextureFormat(0, true, false, false, false, false, false, true, false, true, false, false, 1, 1, 2),
    r32f: makeTextureFormat(0, true, false, false, false, false, false, true, false, true, false, false, 1, 1, 4),
    r8ui: makeTextureFormat(0, true, false, false, false, false, false, false, true, false, false, false, 1, 1, 1),
    r8i: makeTextureFormat(0, true, false, false, false, false, false, false, true, true, false, false, 1, 1, 1),
    r16ui: makeTextureFormat(0, true, false, false, false, false, false, false, true, false, false, false, 1, 1, 2),
    r16i: makeTextureFormat(0, true, false, false, false, false, false, false, true, true, false, false, 1, 1, 2),
    r32ui: makeTextureFormat(0, true, false, false, false, false, false, false, true, false, false, false, 1, 1, 4),
    r32i: makeTextureFormat(0, true, false, false, false, false, false, false, true, true, false, false, 1, 1, 4),
    rg8unorm: makeTextureFormat(0, true, true, false, false, false, false, false, false, false, false, false, 1, 1, 2),
    rg8snorm: makeTextureFormat(0, true, true, false, false, false, false, false, false, true, false, false, 1, 1, 2),
    rg16f: makeTextureFormat(0, true, true, false, false, false, false, true, false, true, false, false, 1, 1, 4),
    rg32f: makeTextureFormat(0, true, true, false, false, false, false, true, false, true, false, false, 1, 1, 8),
    rg8ui: makeTextureFormat(0, true, true, false, false, false, false, false, true, false, false, false, 1, 1, 2),
    rg8i: makeTextureFormat(0, true, true, false, false, false, false, false, true, true, false, false, 1, 1, 2),
    rg16ui: makeTextureFormat(0, true, true, false, false, false, false, false, true, false, false, false, 1, 1, 4),
    rg16i: makeTextureFormat(0, true, true, false, false, false, false, false, true, true, false, false, 1, 1, 4),
    rg32ui: makeTextureFormat(0, true, true, false, false, false, false, false, true, false, false, false, 1, 1, 8),
    rg32i: makeTextureFormat(0, true, true, false, false, false, false, false, true, true, false, false, 1, 1, 8),
    rgba8unorm: makeTextureFormat(0, true, true, true, true, false, false, false, false, false, false, false, 1, 1, 4),
    'rgba8unorm-srgb': makeTextureFormat(0, true, true, true, true, false, false, false, false, false, true, false, 1, 1, 4),
    rgba8snorm: makeTextureFormat(0, true, true, true, true, false, false, false, false, true, false, false, 1, 1, 4),
    bgra8unorm: makeTextureFormat(0, true, true, true, true, false, false, false, false, false, false, true, 1, 1, 4),
    'bgra8unorm-srgb': makeTextureFormat(0, true, true, true, true, false, false, false, false, false, true, true, 1, 1, 4),
    rgba16f: makeTextureFormat(0, true, true, true, true, false, false, true, false, true, false, false, 1, 1, 8),
    rgba32f: makeTextureFormat(0, true, true, true, true, false, false, true, false, true, false, false, 1, 1, 16),
    rgba8ui: makeTextureFormat(0, true, true, true, true, false, false, false, true, false, false, false, 1, 1, 4),
    rgba8i: makeTextureFormat(0, true, true, true, true, false, false, false, true, true, false, false, 1, 1, 4),
    rgba16ui: makeTextureFormat(0, true, true, true, true, false, false, false, true, false, false, false, 1, 1, 8),
    rgba16i: makeTextureFormat(0, true, true, true, true, false, false, false, true, true, false, false, 1, 1, 8),
    rgba32ui: makeTextureFormat(0, true, true, true, true, false, false, false, true, false, false, false, 1, 1, 16),
    rgba32i: makeTextureFormat(0, true, true, true, true, false, false, false, true, true, false, false, 1, 1, 16),
    rg11b10uf: makeTextureFormat(0, true, true, true, false, false, false, true, false, false, false, false, 1, 1, 4),
    d16: makeTextureFormat(0, false, false, false, false, true, false, false, false, false, false, false, 1, 1, 2),
    d24: makeTextureFormat(0, false, false, false, false, true, false, false, false, false, false, false, 0, 0, 0),
    d32f: makeTextureFormat(0, false, false, false, false, true, false, true, false, true, false, false, 1, 1, 4),
    d24s8: makeTextureFormat(0, false, false, false, false, true, true, false, false, false, false, false, 1, 1, 4),
    d32fs8: makeTextureFormat(0, false, false, false, false, true, true, true, false, true, false, false, 1, 1, 5),
    // compressed texture formats
    dxt1: makeTextureFormat(COMPRESSION_FORMAT_BC1, true, true, true, true, false, false, false, false, false, false, false, 4, 4, 8),
    'dxt1-srgb': makeTextureFormat(COMPRESSION_FORMAT_BC1, true, true, true, true, false, false, false, false, false, true, false, 4, 4, 8),
    dxt3: makeTextureFormat(COMPRESSION_FORMAT_BC2, true, true, true, true, false, false, false, false, false, false, false, 4, 4, 16),
    'dxt3-srgb': makeTextureFormat(COMPRESSION_FORMAT_BC2, true, true, true, true, false, false, false, false, false, true, false, 4, 4, 16),
    dxt5: makeTextureFormat(COMPRESSION_FORMAT_BC3, true, true, true, true, false, false, false, false, false, false, false, 4, 4, 16),
    'dxt5-srgb': makeTextureFormat(COMPRESSION_FORMAT_BC3, true, true, true, true, false, false, false, false, false, true, false, 4, 4, 16)
};
/**
 * Converts a non-sRGB texture format to the corresponding sRGB texture format
 * @param format - The texture format to be converted
 * @returns The sRGB texture format
 * @public
 */ function linearTextureFormatToSRGB(format) {
    switch(format){
        case 'rgba8unorm':
            return 'rgba8unorm-srgb';
        case 'bgra8unorm':
            return 'bgra8unorm-srgb';
        case 'dxt1':
            return 'dxt1-srgb';
        case 'dxt3':
            return 'dxt3-srgb';
        case 'dxt5':
            return 'dxt5-srgb';
        default:
            return format;
    }
}
/**
 * Check if a given texture format contains an alpha channel.
 * @param format - The texture format to be checked.
 * @returns true if the texture format contains an alpha channel, otherwise false
 * @public
 */ function hasAlphaChannel(format) {
    return !!(textureFormatMap[format] & ALPHA_BITMASK);
}
/**
 * Check if a given texture format contains a red channel.
 * @param format - The texture format to be checked.
 * @returns true if the texture format contains a red channel, otherwise false
 * @public
 */ function hasRedChannel(format) {
    return !!(textureFormatMap[format] & RED_BITMASK);
}
/**
 * Check if a given texture format contains a green channel.
 * @param format - The texture format to be checked.
 * @returns true if the texture format contains a green channel, otherwise false
 * @public
 */ function hasGreenChannel(format) {
    return !!(textureFormatMap[format] & GREEN_BITMASK);
}
/**
 * Check if a given texture format contains a blue channel.
 * @param format - The texture format to be checked.
 * @returns true if the texture format contains a blue channel, otherwise false
 * @public
 */ function hasBlueChannel(format) {
    return !!(textureFormatMap[format] & BLUE_BITMASK);
}
/**
 * Check if a given texture format contains a depth channel.
 * @param format - The texture format to be checked.
 * @returns true if the texture format contains a depth channel, otherwise false
 * @public
 */ function hasDepthChannel(format) {
    return !!(textureFormatMap[format] & DEPTH_BITMASK);
}
/**
 * Check if a given texture format contains a stencil channel.
 * @param format - The texture format to be checked.
 * @returns true if the texture format contains a stencil channel, otherwise false
 * @public
 */ function hasStencilChannel(format) {
    return !!(textureFormatMap[format] & STENCIL_BITMASK);
}
/**
 * Check whether a given texture format is floating-point.
 * @param format - The texture format to be checked.
 * @returns true if the texture format is floating-point, otherwise false
 * @public
 */ function isFloatTextureFormat(format) {
    return !!(textureFormatMap[format] & FLOAT_BITMASK);
}
/**
 * Check whether a given texture format is integer.
 * @param format - The texture format to be checked.
 * @returns true if the texture format is integer, otherwise false
 * @public
 */ function isIntegerTextureFormat(format) {
    return !!(textureFormatMap[format] & INTEGER_BITMASK);
}
/**
 * Check whether a given texture format is signed.
 * @param format - The texture format to be checked.
 * @returns true if the texture format is signed, otherwise false
 * @public
 */ function isSignedTextureFormat(format) {
    return !!(textureFormatMap[format] & SIGNED_BITMASK);
}
/**
 * Check whether a given texture format is a compressed format.
 * @param format - The texture format to be checked.
 * @returns true if the texture format is a compressed format, otherwise false
 * @public
 */ function isCompressedTextureFormat(format) {
    return !!(textureFormatMap[format] & COMPRESSION_FORMAT_BITMASK);
}
/**
 * Check whether a given texture format is sRGB format.
 * @param format - The texture format to be checked.
 * @returns true if the texture format is sRGB format, otherwise false
 * @public
 */ function isSRGBTextureFormat(format) {
    return !!(textureFormatMap[format] & SRGB_BITMASK);
}
/**
 * Get block size of given texture format
 * @param format - The texture format
 * @returns The block size
 * @public
 */ function getTextureFormatBlockSize(format) {
    return (textureFormatMap[format] & BLOCK_SIZE_MASK) >> BLOCK_SIZE_SHIFT;
}
/**
 * Get block width of given texture format
 * @param format - The texture format
 * @returns The block width
 * @public
 */ function getTextureFormatBlockWidth(format) {
    return (textureFormatMap[format] & BLOCK_WIDTH_MASK) >> BLOCK_WIDTH_SHIFT;
}
/**
 * Get block height of given texture format
 * @param format - The texture format
 * @returns The block height
 * @public
 */ function getTextureFormatBlockHeight(format) {
    return (textureFormatMap[format] & BLOCK_HEIGHT_MASK) >> BLOCK_HEIGHT_SHIFT;
}
var ShaderType;
(function(ShaderType) {
    ShaderType[ShaderType["Vertex"] = 1] = "Vertex";
    ShaderType[ShaderType["Fragment"] = 2] = "Fragment";
    ShaderType[ShaderType["Compute"] = 4] = "Compute";
})(ShaderType || (ShaderType = {}));
/**
 * Event that will be fired when device is lost
 * @public
 */ class DeviceLostEvent {
    /** The event name */ static NAME = 'devicelost';
    type = DeviceLostEvent.NAME;
}
/**
 * Event that will be fired when device has just been restored
 * @public
 */ class DeviceRestoreEvent {
    /** The event name */ static NAME = 'devicerestored';
    type = DeviceRestoreEvent.NAME;
}
/**
 * Event that will be fired when size of back buffer has changed
 * @public
 */ class DeviceResizeEvent {
    /** The event name */ static NAME = 'resize';
    width;
    height;
    type = DeviceResizeEvent.NAME;
    constructor(width, height){
        this.width = width;
        this.height = height;
    }
}
/**
 * Event that will be fired when any gpu object is created
 * @public
 */ class DeviceGPUObjectAddedEvent {
    /** the event name */ static NAME = 'gpuobject_added';
    object;
    type = DeviceGPUObjectAddedEvent.NAME;
    constructor(obj){
        this.object = obj;
    }
}
/**
 * Event that will be fired when any gpu object is disposed
 * @public
 */ class DeviceGPUObjectRemovedEvent {
    /** The event name */ static NAME = 'gpuobject_removed';
    object;
    type = DeviceGPUObjectRemovedEvent.NAME;
    constructor(obj){
        this.object = obj;
    }
}
/**
 * Event that will be fired when any gpu object name is changed
 * @public
 */ class DeviceGPUObjectRenameEvent {
    /** The event name */ static NAME = 'gpuobject_rename';
    object;
    lastName;
    type = DeviceGPUObjectRenameEvent.NAME;
    constructor(obj, lastName){
        this.object = obj;
        this.lastName = lastName;
    }
}

const F16_BITMASK = 1;
const F32_BITMASK = 2;
const BOOL_BITMASK = 3;
const I8_BITMASK = 4;
const I16_BITMASK = 5;
const I32_BITMASK = 6;
const U8_BITMASK = 7;
const U16_BITMASK = 8;
const U32_BITMASK = 9;
const SCALAR_TYPE_BITMASK = 15;
const ROWS_BITMASK = 7;
const ROWS_BITSHIFT = 4;
const COLS_BITMASK = 7;
const COLS_BITSHIFT = 7;
const NORM_BITMASK = 1;
const NORM_BITSHIFT = 10;
function align(n, alignment) {
    return n + alignment - 1 & ~(alignment - 1);
}
function getAlignment(type) {
    if (type.isPrimitiveType()) {
        return type.isScalarType() ? 4 : 1 << Math.min(4, type.cols + 1);
    } else if (type.isAtomicI32() || type.isAtomicU32()) {
        return 4;
    } else if (type.isArrayType()) {
        return type.elementType.isAnyType() ? 1 : getAlignment(type.elementType);
    } else {
        let alignment = 0;
        for (const member of type.structMembers){
            alignment = Math.max(alignment, getAlignment(member.type));
        }
        return Math.max(alignment, 16);
    }
}
function getAlignmentPacked(type) {
    return 1;
}
function getSize(type) {
    if (type.isPrimitiveType()) {
        return type.isMatrixType() ? type.rows * getAlignment(PBPrimitiveTypeInfo.getCachedTypeInfo(type.resizeType(1, type.cols))) : 4 * type.cols;
    } else if (type.isArrayType()) {
        return type.elementType.isAnyType() ? 0 : type.dimension * align(getSize(type.elementType), getAlignment(type.elementType));
    } else if (type.isAtomicI32() || type.isAtomicU32()) {
        return 4;
    } else {
        let size = 0;
        let structAlignment = 0;
        for (const member of type.structMembers){
            const memberAlignment = getAlignment(member.type);
            size = align(size, memberAlignment);
            size += getSize(member.type);
            structAlignment = Math.max(structAlignment, memberAlignment);
        }
        return align(size, structAlignment);
    }
}
function getSizePacked(type) {
    if (type.isPrimitiveType()) {
        let scalarSize;
        switch(type.scalarType){
            case PBPrimitiveType.U8:
            case PBPrimitiveType.U8_NORM:
            case PBPrimitiveType.I8:
            case PBPrimitiveType.I8_NORM:
                scalarSize = 1;
                break;
            case PBPrimitiveType.F16:
            case PBPrimitiveType.I16:
            case PBPrimitiveType.I16_NORM:
            case PBPrimitiveType.U16:
            case PBPrimitiveType.U16_NORM:
                scalarSize = 2;
                break;
            default:
                scalarSize = 4;
                break;
        }
        return type.rows * type.cols * scalarSize;
    } else if (type.isArrayType()) {
        return type.elementType.isAnyType() ? 0 : type.dimension * getSizePacked(type.elementType);
    } else if (type.isAtomicI32() || type.isAtomicU32()) {
        return 4;
    } else {
        let size = 0;
        for (const member of type.structMembers){
            size += getSizePacked(member.type);
        }
        return size;
    }
}
function makePrimitiveType(scalarTypeMask, rows, cols, norm) {
    return scalarTypeMask | rows << ROWS_BITSHIFT | cols << COLS_BITSHIFT | norm << NORM_BITSHIFT;
}
function typeToTypedArray(type) {
    if (type.isPrimitiveType()) {
        return type.scalarType;
    } else if (type.isArrayType()) {
        return type.elementType.isAnyType() ? null : typeToTypedArray(type.elementType);
    } else {
        return PBPrimitiveType.U8;
    }
}
var PBPrimitiveType;
(function(PBPrimitiveType) {
    PBPrimitiveType[PBPrimitiveType["NONE"] = 0] = "NONE";
    PBPrimitiveType[PBPrimitiveType["F16"] = makePrimitiveType(F16_BITMASK, 1, 1, 0)] = "F16";
    PBPrimitiveType[PBPrimitiveType["F16VEC2"] = makePrimitiveType(F16_BITMASK, 1, 2, 0)] = "F16VEC2";
    PBPrimitiveType[PBPrimitiveType["F16VEC3"] = makePrimitiveType(F16_BITMASK, 1, 3, 0)] = "F16VEC3";
    PBPrimitiveType[PBPrimitiveType["F16VEC4"] = makePrimitiveType(F16_BITMASK, 1, 4, 0)] = "F16VEC4";
    PBPrimitiveType[PBPrimitiveType["F32"] = makePrimitiveType(F32_BITMASK, 1, 1, 0)] = "F32";
    PBPrimitiveType[PBPrimitiveType["F32VEC2"] = makePrimitiveType(F32_BITMASK, 1, 2, 0)] = "F32VEC2";
    PBPrimitiveType[PBPrimitiveType["F32VEC3"] = makePrimitiveType(F32_BITMASK, 1, 3, 0)] = "F32VEC3";
    PBPrimitiveType[PBPrimitiveType["F32VEC4"] = makePrimitiveType(F32_BITMASK, 1, 4, 0)] = "F32VEC4";
    PBPrimitiveType[PBPrimitiveType["BOOL"] = makePrimitiveType(BOOL_BITMASK, 1, 1, 0)] = "BOOL";
    PBPrimitiveType[PBPrimitiveType["BVEC2"] = makePrimitiveType(BOOL_BITMASK, 1, 2, 0)] = "BVEC2";
    PBPrimitiveType[PBPrimitiveType["BVEC3"] = makePrimitiveType(BOOL_BITMASK, 1, 3, 0)] = "BVEC3";
    PBPrimitiveType[PBPrimitiveType["BVEC4"] = makePrimitiveType(BOOL_BITMASK, 1, 4, 0)] = "BVEC4";
    PBPrimitiveType[PBPrimitiveType["I8"] = makePrimitiveType(I8_BITMASK, 1, 1, 0)] = "I8";
    PBPrimitiveType[PBPrimitiveType["I8VEC2"] = makePrimitiveType(I8_BITMASK, 1, 2, 0)] = "I8VEC2";
    PBPrimitiveType[PBPrimitiveType["I8VEC3"] = makePrimitiveType(I8_BITMASK, 1, 3, 0)] = "I8VEC3";
    PBPrimitiveType[PBPrimitiveType["I8VEC4"] = makePrimitiveType(I8_BITMASK, 1, 4, 0)] = "I8VEC4";
    PBPrimitiveType[PBPrimitiveType["I8_NORM"] = makePrimitiveType(I8_BITMASK, 1, 1, 1)] = "I8_NORM";
    PBPrimitiveType[PBPrimitiveType["I8VEC2_NORM"] = makePrimitiveType(I8_BITMASK, 1, 2, 1)] = "I8VEC2_NORM";
    PBPrimitiveType[PBPrimitiveType["I8VEC3_NORM"] = makePrimitiveType(I8_BITMASK, 1, 3, 1)] = "I8VEC3_NORM";
    PBPrimitiveType[PBPrimitiveType["I8VEC4_NORM"] = makePrimitiveType(I8_BITMASK, 1, 4, 1)] = "I8VEC4_NORM";
    PBPrimitiveType[PBPrimitiveType["I16"] = makePrimitiveType(I16_BITMASK, 1, 1, 0)] = "I16";
    PBPrimitiveType[PBPrimitiveType["I16VEC2"] = makePrimitiveType(I16_BITMASK, 1, 2, 0)] = "I16VEC2";
    PBPrimitiveType[PBPrimitiveType["I16VEC3"] = makePrimitiveType(I16_BITMASK, 1, 3, 0)] = "I16VEC3";
    PBPrimitiveType[PBPrimitiveType["I16VEC4"] = makePrimitiveType(I16_BITMASK, 1, 4, 0)] = "I16VEC4";
    PBPrimitiveType[PBPrimitiveType["I16_NORM"] = makePrimitiveType(I16_BITMASK, 1, 1, 1)] = "I16_NORM";
    PBPrimitiveType[PBPrimitiveType["I16VEC2_NORM"] = makePrimitiveType(I16_BITMASK, 1, 2, 1)] = "I16VEC2_NORM";
    PBPrimitiveType[PBPrimitiveType["I16VEC3_NORM"] = makePrimitiveType(I16_BITMASK, 1, 3, 1)] = "I16VEC3_NORM";
    PBPrimitiveType[PBPrimitiveType["I16VEC4_NORM"] = makePrimitiveType(I16_BITMASK, 1, 4, 1)] = "I16VEC4_NORM";
    PBPrimitiveType[PBPrimitiveType["I32"] = makePrimitiveType(I32_BITMASK, 1, 1, 0)] = "I32";
    PBPrimitiveType[PBPrimitiveType["I32VEC2"] = makePrimitiveType(I32_BITMASK, 1, 2, 0)] = "I32VEC2";
    PBPrimitiveType[PBPrimitiveType["I32VEC3"] = makePrimitiveType(I32_BITMASK, 1, 3, 0)] = "I32VEC3";
    PBPrimitiveType[PBPrimitiveType["I32VEC4"] = makePrimitiveType(I32_BITMASK, 1, 4, 0)] = "I32VEC4";
    PBPrimitiveType[PBPrimitiveType["I32_NORM"] = makePrimitiveType(I32_BITMASK, 1, 1, 1)] = "I32_NORM";
    PBPrimitiveType[PBPrimitiveType["I32VEC2_NORM"] = makePrimitiveType(I32_BITMASK, 1, 2, 1)] = "I32VEC2_NORM";
    PBPrimitiveType[PBPrimitiveType["I32VEC3_NORM"] = makePrimitiveType(I32_BITMASK, 1, 3, 1)] = "I32VEC3_NORM";
    PBPrimitiveType[PBPrimitiveType["I32VEC4_NORM"] = makePrimitiveType(I32_BITMASK, 1, 4, 1)] = "I32VEC4_NORM";
    PBPrimitiveType[PBPrimitiveType["U8"] = makePrimitiveType(U8_BITMASK, 1, 1, 0)] = "U8";
    PBPrimitiveType[PBPrimitiveType["U8VEC2"] = makePrimitiveType(U8_BITMASK, 1, 2, 0)] = "U8VEC2";
    PBPrimitiveType[PBPrimitiveType["U8VEC3"] = makePrimitiveType(U8_BITMASK, 1, 3, 0)] = "U8VEC3";
    PBPrimitiveType[PBPrimitiveType["U8VEC4"] = makePrimitiveType(U8_BITMASK, 1, 4, 0)] = "U8VEC4";
    PBPrimitiveType[PBPrimitiveType["U8_NORM"] = makePrimitiveType(U8_BITMASK, 1, 1, 1)] = "U8_NORM";
    PBPrimitiveType[PBPrimitiveType["U8VEC2_NORM"] = makePrimitiveType(U8_BITMASK, 1, 2, 1)] = "U8VEC2_NORM";
    PBPrimitiveType[PBPrimitiveType["U8VEC3_NORM"] = makePrimitiveType(U8_BITMASK, 1, 3, 1)] = "U8VEC3_NORM";
    PBPrimitiveType[PBPrimitiveType["U8VEC4_NORM"] = makePrimitiveType(U8_BITMASK, 1, 4, 1)] = "U8VEC4_NORM";
    PBPrimitiveType[PBPrimitiveType["U16"] = makePrimitiveType(U16_BITMASK, 1, 1, 0)] = "U16";
    PBPrimitiveType[PBPrimitiveType["U16VEC2"] = makePrimitiveType(U16_BITMASK, 1, 2, 0)] = "U16VEC2";
    PBPrimitiveType[PBPrimitiveType["U16VEC3"] = makePrimitiveType(U16_BITMASK, 1, 3, 0)] = "U16VEC3";
    PBPrimitiveType[PBPrimitiveType["U16VEC4"] = makePrimitiveType(U16_BITMASK, 1, 4, 0)] = "U16VEC4";
    PBPrimitiveType[PBPrimitiveType["U16_NORM"] = makePrimitiveType(U16_BITMASK, 1, 1, 1)] = "U16_NORM";
    PBPrimitiveType[PBPrimitiveType["U16VEC2_NORM"] = makePrimitiveType(U16_BITMASK, 1, 2, 1)] = "U16VEC2_NORM";
    PBPrimitiveType[PBPrimitiveType["U16VEC3_NORM"] = makePrimitiveType(U16_BITMASK, 1, 3, 1)] = "U16VEC3_NORM";
    PBPrimitiveType[PBPrimitiveType["U16VEC4_NORM"] = makePrimitiveType(U16_BITMASK, 1, 4, 1)] = "U16VEC4_NORM";
    PBPrimitiveType[PBPrimitiveType["U32"] = makePrimitiveType(U32_BITMASK, 1, 1, 0)] = "U32";
    PBPrimitiveType[PBPrimitiveType["U32VEC2"] = makePrimitiveType(U32_BITMASK, 1, 2, 0)] = "U32VEC2";
    PBPrimitiveType[PBPrimitiveType["U32VEC3"] = makePrimitiveType(U32_BITMASK, 1, 3, 0)] = "U32VEC3";
    PBPrimitiveType[PBPrimitiveType["U32VEC4"] = makePrimitiveType(U32_BITMASK, 1, 4, 0)] = "U32VEC4";
    PBPrimitiveType[PBPrimitiveType["U32_NORM"] = makePrimitiveType(U32_BITMASK, 1, 1, 1)] = "U32_NORM";
    PBPrimitiveType[PBPrimitiveType["U32VEC2_NORM"] = makePrimitiveType(U32_BITMASK, 1, 2, 1)] = "U32VEC2_NORM";
    PBPrimitiveType[PBPrimitiveType["U32VEC3_NORM"] = makePrimitiveType(U32_BITMASK, 1, 3, 1)] = "U32VEC3_NORM";
    PBPrimitiveType[PBPrimitiveType["U32VEC4_NORM"] = makePrimitiveType(U32_BITMASK, 1, 4, 1)] = "U32VEC4_NORM";
    PBPrimitiveType[PBPrimitiveType["MAT2"] = makePrimitiveType(F32_BITMASK, 2, 2, 0)] = "MAT2";
    PBPrimitiveType[PBPrimitiveType["MAT2x3"] = makePrimitiveType(F32_BITMASK, 2, 3, 0)] = "MAT2x3";
    PBPrimitiveType[PBPrimitiveType["MAT2x4"] = makePrimitiveType(F32_BITMASK, 2, 4, 0)] = "MAT2x4";
    PBPrimitiveType[PBPrimitiveType["MAT3x2"] = makePrimitiveType(F32_BITMASK, 3, 2, 0)] = "MAT3x2";
    PBPrimitiveType[PBPrimitiveType["MAT3"] = makePrimitiveType(F32_BITMASK, 3, 3, 0)] = "MAT3";
    PBPrimitiveType[PBPrimitiveType["MAT3x4"] = makePrimitiveType(F32_BITMASK, 3, 4, 0)] = "MAT3x4";
    PBPrimitiveType[PBPrimitiveType["MAT4x2"] = makePrimitiveType(F32_BITMASK, 4, 2, 0)] = "MAT4x2";
    PBPrimitiveType[PBPrimitiveType["MAT4x3"] = makePrimitiveType(F32_BITMASK, 4, 3, 0)] = "MAT4x3";
    PBPrimitiveType[PBPrimitiveType["MAT4"] = makePrimitiveType(F32_BITMASK, 4, 4, 0)] = "MAT4";
})(PBPrimitiveType || (PBPrimitiveType = {}));
const primitiveTypeMapWebGL = {
    [PBPrimitiveType.F32]: 'float',
    [PBPrimitiveType.F32VEC2]: 'vec2',
    [PBPrimitiveType.F32VEC3]: 'vec3',
    [PBPrimitiveType.F32VEC4]: 'vec4',
    [PBPrimitiveType.BOOL]: 'bool',
    [PBPrimitiveType.BVEC2]: 'bvec2',
    [PBPrimitiveType.BVEC3]: 'bvec3',
    [PBPrimitiveType.BVEC4]: 'bvec4',
    [PBPrimitiveType.I32]: 'int',
    [PBPrimitiveType.I32VEC2]: 'ivec2',
    [PBPrimitiveType.I32VEC3]: 'ivec3',
    [PBPrimitiveType.I32VEC4]: 'ivec4',
    [PBPrimitiveType.U32]: 'uint',
    [PBPrimitiveType.U32VEC2]: 'uvec2',
    [PBPrimitiveType.U32VEC3]: 'uvec3',
    [PBPrimitiveType.U32VEC4]: 'uvec4',
    [PBPrimitiveType.MAT2]: 'mat2',
    [PBPrimitiveType.MAT2x3]: 'mat2x3',
    [PBPrimitiveType.MAT2x4]: 'mat2x4',
    [PBPrimitiveType.MAT3x2]: 'mat3x2',
    [PBPrimitiveType.MAT3]: 'mat3',
    [PBPrimitiveType.MAT3x4]: 'mat3x4',
    [PBPrimitiveType.MAT4x2]: 'mat4x2',
    [PBPrimitiveType.MAT4x3]: 'mat4x3',
    [PBPrimitiveType.MAT4]: 'mat4'
};
const primitiveTypeMapWGSL = {
    [PBPrimitiveType.F32]: 'f32',
    [PBPrimitiveType.F32VEC2]: 'vec2<f32>',
    [PBPrimitiveType.F32VEC3]: 'vec3<f32>',
    [PBPrimitiveType.F32VEC4]: 'vec4<f32>',
    [PBPrimitiveType.BOOL]: 'bool',
    [PBPrimitiveType.BVEC2]: 'vec2<bool>',
    [PBPrimitiveType.BVEC3]: 'vec3<bool>',
    [PBPrimitiveType.BVEC4]: 'vec4<bool>',
    [PBPrimitiveType.I32]: 'i32',
    [PBPrimitiveType.I32VEC2]: 'vec2<i32>',
    [PBPrimitiveType.I32VEC3]: 'vec3<i32>',
    [PBPrimitiveType.I32VEC4]: 'vec4<i32>',
    [PBPrimitiveType.U32]: 'u32',
    [PBPrimitiveType.U32VEC2]: 'vec2<u32>',
    [PBPrimitiveType.U32VEC3]: 'vec3<u32>',
    [PBPrimitiveType.U32VEC4]: 'vec4<u32>',
    [PBPrimitiveType.MAT2]: 'mat2x2<f32>',
    [PBPrimitiveType.MAT2x3]: 'mat2x3<f32>',
    [PBPrimitiveType.MAT2x4]: 'mat2x4<f32>',
    [PBPrimitiveType.MAT3x2]: 'mat3x2<f32>',
    [PBPrimitiveType.MAT3]: 'mat3x3<f32>',
    [PBPrimitiveType.MAT3x4]: 'mat3x4<f32>',
    [PBPrimitiveType.MAT4x2]: 'mat4x2<f32>',
    [PBPrimitiveType.MAT4x3]: 'mat4x3<f32>',
    [PBPrimitiveType.MAT4]: 'mat4x4<f32>'
};
const BITFLAG_1D = 1 << 0;
const BITFLAG_2D = 1 << 1;
const BITFLAG_3D = 1 << 2;
const BITFLAG_CUBE = 1 << 3;
const BITFLAG_ARRAY = 1 << 4;
const BITFLAG_MULTISAMPLED = 1 << 5;
const BITFLAG_STORAGE = 1 << 6;
const BITFLAG_DEPTH = 1 << 7;
const BITFLAG_FLOAT = 1 << 8;
const BITFLAG_INT = 1 << 9;
const BITFLAG_UINT = 1 << 10;
const BITFLAG_EXTERNAL = 1 << 11;
var PBTextureType;
(function(PBTextureType) {
    PBTextureType[PBTextureType["TEX_1D"] = BITFLAG_1D | BITFLAG_FLOAT] = "TEX_1D";
    PBTextureType[PBTextureType["ITEX_1D"] = BITFLAG_1D | BITFLAG_INT] = "ITEX_1D";
    PBTextureType[PBTextureType["UTEX_1D"] = BITFLAG_1D | BITFLAG_UINT] = "UTEX_1D";
    PBTextureType[PBTextureType["TEX_2D"] = BITFLAG_2D | BITFLAG_FLOAT] = "TEX_2D";
    PBTextureType[PBTextureType["ITEX_2D"] = BITFLAG_2D | BITFLAG_INT] = "ITEX_2D";
    PBTextureType[PBTextureType["UTEX_2D"] = BITFLAG_2D | BITFLAG_UINT] = "UTEX_2D";
    PBTextureType[PBTextureType["TEX_2D_ARRAY"] = BITFLAG_2D | BITFLAG_FLOAT | BITFLAG_ARRAY] = "TEX_2D_ARRAY";
    PBTextureType[PBTextureType["ITEX_2D_ARRAY"] = BITFLAG_2D | BITFLAG_INT | BITFLAG_ARRAY] = "ITEX_2D_ARRAY";
    PBTextureType[PBTextureType["UTEX_2D_ARRAY"] = BITFLAG_2D | BITFLAG_UINT | BITFLAG_ARRAY] = "UTEX_2D_ARRAY";
    PBTextureType[PBTextureType["TEX_3D"] = BITFLAG_3D | BITFLAG_FLOAT] = "TEX_3D";
    PBTextureType[PBTextureType["ITEX_3D"] = BITFLAG_3D | BITFLAG_INT] = "ITEX_3D";
    PBTextureType[PBTextureType["UTEX_3D"] = BITFLAG_3D | BITFLAG_UINT] = "UTEX_3D";
    PBTextureType[PBTextureType["TEX_CUBE"] = BITFLAG_CUBE | BITFLAG_FLOAT] = "TEX_CUBE";
    PBTextureType[PBTextureType["ITEX_CUBE"] = BITFLAG_CUBE | BITFLAG_INT] = "ITEX_CUBE";
    PBTextureType[PBTextureType["UTEX_CUBE"] = BITFLAG_CUBE | BITFLAG_UINT] = "UTEX_CUBE";
    PBTextureType[PBTextureType["TEX_CUBE_ARRAY"] = BITFLAG_CUBE | BITFLAG_FLOAT | BITFLAG_ARRAY] = "TEX_CUBE_ARRAY";
    PBTextureType[PBTextureType["ITEX_CUBE_ARRAY"] = BITFLAG_CUBE | BITFLAG_INT | BITFLAG_ARRAY] = "ITEX_CUBE_ARRAY";
    PBTextureType[PBTextureType["UTEX_CUBE_ARRAY"] = BITFLAG_CUBE | BITFLAG_UINT | BITFLAG_ARRAY] = "UTEX_CUBE_ARRAY";
    PBTextureType[PBTextureType["TEX_MULTISAMPLED_2D"] = BITFLAG_2D | BITFLAG_FLOAT | BITFLAG_MULTISAMPLED] = "TEX_MULTISAMPLED_2D";
    PBTextureType[PBTextureType["ITEX_MULTISAMPLED_2D"] = BITFLAG_2D | BITFLAG_INT | BITFLAG_MULTISAMPLED] = "ITEX_MULTISAMPLED_2D";
    PBTextureType[PBTextureType["UTEX_MULTISAMPLED_2D"] = BITFLAG_2D | BITFLAG_UINT | BITFLAG_MULTISAMPLED] = "UTEX_MULTISAMPLED_2D";
    PBTextureType[PBTextureType["TEX_STORAGE_1D"] = BITFLAG_1D | BITFLAG_STORAGE] = "TEX_STORAGE_1D";
    PBTextureType[PBTextureType["TEX_STORAGE_2D"] = BITFLAG_2D | BITFLAG_STORAGE] = "TEX_STORAGE_2D";
    PBTextureType[PBTextureType["TEX_STORAGE_2D_ARRAY"] = BITFLAG_2D | BITFLAG_ARRAY | BITFLAG_STORAGE] = "TEX_STORAGE_2D_ARRAY";
    PBTextureType[PBTextureType["TEX_STORAGE_3D"] = BITFLAG_3D | BITFLAG_STORAGE] = "TEX_STORAGE_3D";
    PBTextureType[PBTextureType["TEX_DEPTH_2D"] = BITFLAG_2D | BITFLAG_DEPTH] = "TEX_DEPTH_2D";
    PBTextureType[PBTextureType["TEX_DEPTH_2D_ARRAY"] = BITFLAG_2D | BITFLAG_ARRAY | BITFLAG_DEPTH] = "TEX_DEPTH_2D_ARRAY";
    PBTextureType[PBTextureType["TEX_DEPTH_CUBE"] = BITFLAG_CUBE | BITFLAG_DEPTH] = "TEX_DEPTH_CUBE";
    PBTextureType[PBTextureType["TEX_DEPTH_CUBE_ARRAY"] = BITFLAG_CUBE | BITFLAG_ARRAY | BITFLAG_DEPTH] = "TEX_DEPTH_CUBE_ARRAY";
    PBTextureType[PBTextureType["TEX_DEPTH_MULTISAMPLED_2D"] = BITFLAG_2D | BITFLAG_MULTISAMPLED | BITFLAG_DEPTH] = "TEX_DEPTH_MULTISAMPLED_2D";
    PBTextureType[PBTextureType["TEX_EXTERNAL"] = BITFLAG_EXTERNAL] = "TEX_EXTERNAL";
})(PBTextureType || (PBTextureType = {}));
const textureTypeMapWebGL = {
    [PBTextureType.TEX_1D]: 'highp sampler2D',
    [PBTextureType.TEX_2D]: 'highp sampler2D',
    [PBTextureType.TEX_CUBE]: 'highp samplerCube',
    [PBTextureType.TEX_EXTERNAL]: 'highp sampler2D'
};
const textureTypeMapWebGL2 = {
    [PBTextureType.TEX_1D]: 'highp sampler2D',
    [PBTextureType.TEX_2D]: 'highp sampler2D',
    [PBTextureType.ITEX_1D]: 'highp isampler2D',
    [PBTextureType.ITEX_2D]: 'highp isampler2D',
    [PBTextureType.UTEX_1D]: 'highp usampler2D',
    [PBTextureType.UTEX_2D]: 'highp usampler2D',
    [PBTextureType.TEX_2D_ARRAY]: 'highp sampler2DArray',
    [PBTextureType.ITEX_2D_ARRAY]: 'highp isampler2DArray',
    [PBTextureType.UTEX_2D_ARRAY]: 'highp usampler2DArray',
    [PBTextureType.TEX_3D]: 'highp sampler3D',
    [PBTextureType.ITEX_3D]: 'highp isampler3D',
    [PBTextureType.UTEX_3D]: 'highp usampler3D',
    [PBTextureType.TEX_CUBE]: 'highp samplerCube',
    [PBTextureType.ITEX_CUBE]: 'highp isamplerCube',
    [PBTextureType.UTEX_CUBE]: 'highp usamplerCube',
    [PBTextureType.TEX_DEPTH_2D]: 'highp sampler2DShadow',
    [PBTextureType.TEX_DEPTH_2D_ARRAY]: 'highp sampler2DArrayShadow',
    [PBTextureType.TEX_DEPTH_CUBE]: 'highp samplerCubeShadow',
    [PBTextureType.TEX_EXTERNAL]: 'highp sampler2D'
};
const textureTypeMapWGSL = {
    [PBTextureType.TEX_1D]: 'texture_1d<f32>',
    [PBTextureType.ITEX_1D]: 'texture_1d<i32>',
    [PBTextureType.UTEX_1D]: 'texture_1d<u32>',
    [PBTextureType.TEX_2D]: 'texture_2d<f32>',
    [PBTextureType.ITEX_2D]: 'texture_2d<i32>',
    [PBTextureType.UTEX_2D]: 'texture_2d<u32>',
    [PBTextureType.TEX_2D_ARRAY]: 'texture_2d_array<f32>',
    [PBTextureType.ITEX_2D_ARRAY]: 'texture_2d_array<i32>',
    [PBTextureType.UTEX_2D_ARRAY]: 'texture_2d_array<u32>',
    [PBTextureType.TEX_3D]: 'texture_3d<f32>',
    [PBTextureType.ITEX_3D]: 'texture_3d<i32>',
    [PBTextureType.UTEX_3D]: 'texture_3d<u32>',
    [PBTextureType.TEX_CUBE]: 'texture_cube<f32>',
    [PBTextureType.ITEX_CUBE]: 'texture_cube<i32>',
    [PBTextureType.UTEX_CUBE]: 'texture_cube<u32>',
    [PBTextureType.TEX_CUBE_ARRAY]: 'texture_cube_array<f32>',
    [PBTextureType.ITEX_CUBE_ARRAY]: 'texture_cube_array<i32>',
    [PBTextureType.UTEX_CUBE_ARRAY]: 'texture_cube_array<u32>',
    [PBTextureType.TEX_MULTISAMPLED_2D]: 'texture_multisampled_2d<f32>',
    [PBTextureType.ITEX_MULTISAMPLED_2D]: 'texture_multisampled_2d<i32>',
    [PBTextureType.UTEX_MULTISAMPLED_2D]: 'texture_multisampled_2d<u32>',
    [PBTextureType.TEX_STORAGE_1D]: 'texture_storage_1d',
    [PBTextureType.TEX_STORAGE_2D]: 'texture_storage_2d',
    [PBTextureType.TEX_STORAGE_2D_ARRAY]: 'texture_storage_2d_array',
    [PBTextureType.TEX_STORAGE_3D]: 'texture_storage_3d',
    [PBTextureType.TEX_DEPTH_2D]: 'texture_depth_2d',
    [PBTextureType.TEX_DEPTH_2D_ARRAY]: 'texture_depth_2d_array',
    [PBTextureType.TEX_DEPTH_CUBE]: 'texture_depth_cube',
    [PBTextureType.TEX_DEPTH_CUBE_ARRAY]: 'texture_depth_cube_array',
    [PBTextureType.TEX_DEPTH_MULTISAMPLED_2D]: 'texture_depth_multisampled_2d',
    [PBTextureType.TEX_EXTERNAL]: 'texture_external'
};
const storageTexelFormatMap = {
    rgba8unorm: 'rgba8unorm',
    rgba8snorm: 'rgba8snorm',
    bgra8unorm: 'bgra8unorm',
    rgba8ui: 'rgba8uint',
    rgba8i: 'rgba8sint',
    rgba16ui: 'rgba16uint',
    rgba16i: 'rgba16sint',
    rgba16f: 'rgba16float',
    r32f: 'r32float',
    r32ui: 'r32uint',
    r32i: 'r32sint',
    rg32f: 'rg32float',
    rg32ui: 'rg32uint',
    rg32i: 'rg32sint',
    rgba32f: 'rgba32float',
    rgba32ui: 'rgba32uint',
    rgba32i: 'rgba32sint'
};
var PBSamplerAccessMode;
(function(PBSamplerAccessMode) {
    PBSamplerAccessMode[PBSamplerAccessMode["UNKNOWN"] = 0] = "UNKNOWN";
    PBSamplerAccessMode[PBSamplerAccessMode["SAMPLE"] = 1] = "SAMPLE";
    PBSamplerAccessMode[PBSamplerAccessMode["COMPARISON"] = 2] = "COMPARISON";
})(PBSamplerAccessMode || (PBSamplerAccessMode = {}));
var PBAddressSpace;
(function(PBAddressSpace) {
    PBAddressSpace["UNKNOWN"] = 'unknown';
    PBAddressSpace["FUNCTION"] = 'function';
    PBAddressSpace["PRIVATE"] = 'private';
    PBAddressSpace["WORKGROUP"] = 'workgroup';
    PBAddressSpace["UNIFORM"] = 'uniform';
    PBAddressSpace["STORAGE"] = 'storage';
})(PBAddressSpace || (PBAddressSpace = {}));
var PBTypeClass;
(function(PBTypeClass) {
    PBTypeClass[PBTypeClass["UNKNOWN"] = 0] = "UNKNOWN";
    PBTypeClass[PBTypeClass["PLAIN"] = 1] = "PLAIN";
    PBTypeClass[PBTypeClass["ARRAY"] = 2] = "ARRAY";
    PBTypeClass[PBTypeClass["POINTER"] = 3] = "POINTER";
    PBTypeClass[PBTypeClass["ATOMIC_I32"] = 4] = "ATOMIC_I32";
    PBTypeClass[PBTypeClass["ATOMIC_U32"] = 5] = "ATOMIC_U32";
    PBTypeClass[PBTypeClass["TEXTURE"] = 6] = "TEXTURE";
    PBTypeClass[PBTypeClass["SAMPLER"] = 7] = "SAMPLER";
    PBTypeClass[PBTypeClass["FUNCTION"] = 8] = "FUNCTION";
    PBTypeClass[PBTypeClass["VOID"] = 9] = "VOID";
    PBTypeClass[PBTypeClass["ANY"] = 10] = "ANY";
})(PBTypeClass || (PBTypeClass = {}));
/**
 * Abstract base class for any type
 * @public
 */ class PBTypeInfo {
    /** @internal */ cls;
    /** @internal */ detail;
    /** @internal */ id;
    /** @internal */ constructor(cls, detail){
        this.cls = cls;
        this.detail = detail;
        this.id = null;
    }
    /** Get unique id for this type */ get typeId() {
        if (!this.id) {
            this.id = this.genTypeId();
        }
        return this.id;
    }
    /** returns true if this is a void type */ isVoidType() {
        return false;
    }
    /** returns true if this is an any type */ isAnyType() {
        return false;
    }
    /** returns true if this is a primitive type */ isPrimitiveType() {
        return false;
    }
    /** Wether this type have atomic members */ haveAtomicMembers() {
        return false;
    }
    /** returns true if this is a struct type */ isStructType() {
        return false;
    }
    /** returns true if this is an array type */ isArrayType() {
        return false;
    }
    /** returns true if this is a pointer type */ isPointerType() {
        return false;
    }
    /** returns true if this is an atomic int type */ isAtomicI32() {
        return false;
    }
    /** returns true if this is an atomic uint type */ isAtomicU32() {
        return false;
    }
    /** returns true if this is a sampler type */ isSamplerType() {
        return false;
    }
    /** returns true if this is a texture type */ isTextureType() {
        return false;
    }
    /** @internal */ isHostSharable() {
        return false;
    }
    /** @internal */ isConstructible() {
        return false;
    }
    /** @internal */ isStorable() {
        return false;
    }
    /** @internal */ getConstructorOverloads(deviceType) {
        return [];
    }
    /**
   * Check whether a given type is compatible with this type
   * @param other - The type to be checked
   * @returns true if the given type is compatible with this type, othewise false
   */ isCompatibleType(other) {
        return other.typeId === this.typeId;
    }
}
/**
 * The void type info
 * @public
 */ class PBVoidTypeInfo extends PBTypeInfo {
    constructor(){
        super(PBTypeClass.VOID, null);
    }
    /** {@inheritDoc PBTypeInfo.isVoidType} */ isVoidType() {
        return true;
    }
    /** @internal */ toTypeName(deviceType, varName) {
        return 'void';
    }
    /** @internal */ genTypeId() {
        return 'void';
    }
    /** {@inheritDoc PBTypeInfo.toBufferLayout} */ toBufferLayout(offset) {
        return null;
    }
}
/**
 * The void type info
 * @public
 */ class PBAnyTypeInfo extends PBTypeInfo {
    constructor(){
        super(PBTypeClass.ANY, null);
    }
    /** {@inheritDoc PBTypeInfo.isAnyType} */ isAnyType() {
        return true;
    }
    /** @internal */ toTypeName(deviceType, varName) {
        return 'any';
    }
    /** @internal */ genTypeId() {
        return 'any';
    }
    /** {@inheritDoc PBTypeInfo.toBufferLayout} */ toBufferLayout(offset) {
        return null;
    }
    /** {@inheritDoc PBTypeInfo.isCompatibleType} */ isCompatibleType(other) {
        return true;
    }
}
/**
 * The primitive type info
 * @public
 */ class PBPrimitiveTypeInfo extends PBTypeInfo {
    /** @internal */ static cachedTypes = {};
    /** @internal */ static cachedCtorOverloads = {};
    constructor(type){
        super(PBTypeClass.PLAIN, {
            primitiveType: type
        });
    }
    /** Get or create a PBPrimitiveTypeInfo instance for a given prmitive type */ static getCachedTypeInfo(primitiveType) {
        let typeinfo = this.cachedTypes[primitiveType];
        if (!typeinfo) {
            typeinfo = new PBPrimitiveTypeInfo(primitiveType);
            this.cachedTypes[primitiveType] = typeinfo;
        }
        return typeinfo;
    }
    /** @internal */ static getCachedOverloads(deviceType, primitiveType) {
        let deviceOverloads = this.cachedCtorOverloads[deviceType];
        if (!deviceOverloads) {
            deviceOverloads = {};
            this.cachedCtorOverloads[deviceType] = deviceOverloads;
        }
        let result = deviceOverloads[primitiveType];
        if (!result) {
            const typeinfo = this.getCachedTypeInfo(primitiveType);
            const name = typeinfo.toTypeName(deviceType);
            result = [
                new PBFunctionTypeInfo(name, typeinfo, [])
            ];
            if (typeinfo.isScalarType()) {
                result.push(new PBFunctionTypeInfo(name, typeinfo, [
                    {
                        type: this.getCachedTypeInfo(PBPrimitiveType.F32)
                    }
                ]));
                result.push(new PBFunctionTypeInfo(name, typeinfo, [
                    {
                        type: this.getCachedTypeInfo(PBPrimitiveType.I32)
                    }
                ]));
                result.push(new PBFunctionTypeInfo(name, typeinfo, [
                    {
                        type: this.getCachedTypeInfo(PBPrimitiveType.U32)
                    }
                ]));
                result.push(new PBFunctionTypeInfo(name, typeinfo, [
                    {
                        type: this.getCachedTypeInfo(PBPrimitiveType.BOOL)
                    }
                ]));
            } else if (typeinfo.isVectorType()) {
                const scalarTypeInfo = {
                    type: this.getCachedTypeInfo(typeinfo.scalarType)
                };
                const vec2TypeInfo = {
                    type: this.getCachedTypeInfo(typeinfo.resizeType(1, 2))
                };
                const vec3TypeInfo = {
                    type: this.getCachedTypeInfo(typeinfo.resizeType(1, 3))
                };
                result.push(new PBFunctionTypeInfo(name, typeinfo, [
                    scalarTypeInfo
                ]));
                switch(typeinfo.cols){
                    case 2:
                        result.push(new PBFunctionTypeInfo(name, typeinfo, [
                            scalarTypeInfo,
                            scalarTypeInfo
                        ]));
                        result.push(new PBFunctionTypeInfo(name, typeinfo, [
                            {
                                type: typeF32Vec2
                            }
                        ]));
                        result.push(new PBFunctionTypeInfo(name, typeinfo, [
                            {
                                type: typeI32Vec2
                            }
                        ]));
                        result.push(new PBFunctionTypeInfo(name, typeinfo, [
                            {
                                type: typeU32Vec2
                            }
                        ]));
                        result.push(new PBFunctionTypeInfo(name, typeinfo, [
                            {
                                type: typeBVec2
                            }
                        ]));
                        break;
                    case 3:
                        result.push(new PBFunctionTypeInfo(name, typeinfo, [
                            scalarTypeInfo,
                            scalarTypeInfo,
                            scalarTypeInfo
                        ]));
                        result.push(new PBFunctionTypeInfo(name, typeinfo, [
                            scalarTypeInfo,
                            vec2TypeInfo
                        ]));
                        result.push(new PBFunctionTypeInfo(name, typeinfo, [
                            vec2TypeInfo,
                            scalarTypeInfo
                        ]));
                        result.push(new PBFunctionTypeInfo(name, typeinfo, [
                            {
                                type: typeF32Vec3
                            }
                        ]));
                        result.push(new PBFunctionTypeInfo(name, typeinfo, [
                            {
                                type: typeI32Vec3
                            }
                        ]));
                        result.push(new PBFunctionTypeInfo(name, typeinfo, [
                            {
                                type: typeU32Vec3
                            }
                        ]));
                        result.push(new PBFunctionTypeInfo(name, typeinfo, [
                            {
                                type: typeBVec3
                            }
                        ]));
                        break;
                    case 4:
                        result.push(new PBFunctionTypeInfo(name, typeinfo, [
                            scalarTypeInfo,
                            scalarTypeInfo,
                            scalarTypeInfo,
                            scalarTypeInfo
                        ]));
                        result.push(new PBFunctionTypeInfo(name, typeinfo, [
                            scalarTypeInfo,
                            scalarTypeInfo,
                            vec2TypeInfo
                        ]));
                        result.push(new PBFunctionTypeInfo(name, typeinfo, [
                            scalarTypeInfo,
                            vec2TypeInfo,
                            scalarTypeInfo
                        ]));
                        result.push(new PBFunctionTypeInfo(name, typeinfo, [
                            vec2TypeInfo,
                            scalarTypeInfo,
                            scalarTypeInfo
                        ]));
                        result.push(new PBFunctionTypeInfo(name, typeinfo, [
                            vec2TypeInfo,
                            vec2TypeInfo
                        ]));
                        result.push(new PBFunctionTypeInfo(name, typeinfo, [
                            scalarTypeInfo,
                            vec3TypeInfo
                        ]));
                        result.push(new PBFunctionTypeInfo(name, typeinfo, [
                            vec3TypeInfo,
                            scalarTypeInfo
                        ]));
                        result.push(new PBFunctionTypeInfo(name, typeinfo, [
                            {
                                type: typeF32Vec4
                            }
                        ]));
                        result.push(new PBFunctionTypeInfo(name, typeinfo, [
                            {
                                type: typeI32Vec4
                            }
                        ]));
                        result.push(new PBFunctionTypeInfo(name, typeinfo, [
                            {
                                type: typeU32Vec4
                            }
                        ]));
                        result.push(new PBFunctionTypeInfo(name, typeinfo, [
                            {
                                type: typeBVec4
                            }
                        ]));
                }
            } else if (typeinfo.isMatrixType()) {
                const colType = this.getCachedTypeInfo(typeinfo.resizeType(1, typeinfo.cols));
                result.push(new PBFunctionTypeInfo(name, typeinfo, Array.from({
                    length: typeinfo.rows
                }).map(()=>({
                        type: colType
                    }))));
                result.push(new PBFunctionTypeInfo(name, typeinfo, Array.from({
                    length: typeinfo.rows * typeinfo.cols
                }).map(()=>({
                        type: typeF32
                    }))));
            }
            deviceOverloads[primitiveType] = result;
        }
        return result;
    }
    /** Get the primitive type */ get primitiveType() {
        return this.detail.primitiveType;
    }
    /** Whether the type is signed or unsigned integer scalar or vector */ isInteger() {
        const st = this.primitiveType & SCALAR_TYPE_BITMASK;
        return st === I8_BITMASK || st === U8_BITMASK || st === I16_BITMASK || st === U16_BITMASK || st === I32_BITMASK || st === U32_BITMASK;
    }
    /** Get the scalar type */ get scalarType() {
        return this.resizeType(1, 1);
    }
    /** Get number of rows */ get rows() {
        return this.primitiveType >> ROWS_BITSHIFT & ROWS_BITMASK;
    }
    /** Get number of columns */ get cols() {
        return this.primitiveType >> COLS_BITSHIFT & COLS_BITMASK;
    }
    /** Get if this is a normalized primitive type */ get normalized() {
        return !!(this.primitiveType >> NORM_BITSHIFT & NORM_BITMASK);
    }
    /** @internal */ getLayoutAlignment(layout) {
        return layout === 'packed' ? 1 : this.isScalarType() ? 4 : 1 << Math.min(4, this.cols + 1);
    }
    /** @internal */ getLayoutSize() {
        return this.getSize();
    }
    /** @internal */ getSize() {
        let scalarSize;
        switch(this.scalarType){
            case PBPrimitiveType.BOOL:
            case PBPrimitiveType.I32:
            case PBPrimitiveType.I32_NORM:
            case PBPrimitiveType.U32:
            case PBPrimitiveType.U32_NORM:
            case PBPrimitiveType.F32:
                scalarSize = 4;
                break;
            case PBPrimitiveType.F16:
            case PBPrimitiveType.I16:
            case PBPrimitiveType.I16_NORM:
            case PBPrimitiveType.U16:
            case PBPrimitiveType.U16_NORM:
                scalarSize = 2;
                break;
            default:
                scalarSize = 1;
                break;
        }
        return scalarSize * this.cols * this.rows;
    }
    /**
   * Creates a new primitive type info by changing row and column of this type
   * @param rows - The new value of row
   * @param cols - The new value of column
   * @returns The new primitive type
   */ resizeType(rows, cols) {
        return makePrimitiveType(this.primitiveType & SCALAR_TYPE_BITMASK, rows, cols, this.normalized ? 1 : 0);
    }
    /** Returns true if this is a scalar type */ isScalarType() {
        return this.rows === 1 && this.cols === 1;
    }
    /** Returns true if this is a vector type */ isVectorType() {
        return this.rows === 1 && this.cols > 1;
    }
    /** Returns true if this is a matrix type */ isMatrixType() {
        return this.rows > 1 && this.cols > 1;
    }
    /** {@inheritDoc PBTypeInfo.isPrimitiveType} */ isPrimitiveType() {
        return true;
    }
    /** @internal */ isHostSharable() {
        return this.scalarType !== PBPrimitiveType.BOOL;
    }
    /** @internal */ isConstructible() {
        return true;
    }
    /** @internal */ isStorable() {
        return true;
    }
    /** @internal */ getConstructorOverloads(deviceType) {
        return PBPrimitiveTypeInfo.getCachedOverloads(deviceType, this.primitiveType);
    }
    /** @internal */ toTypeName(deviceType, varName) {
        if (deviceType === 'webgpu') {
            const typename = primitiveTypeMapWGSL[this.primitiveType];
            return varName ? `${varName}: ${typename}` : typename;
        } else {
            const typename = primitiveTypeMapWebGL[this.primitiveType];
            return varName ? `${typename} ${varName}` : typename;
        }
    }
    /** {@inheritDoc PBTypeInfo.toBufferLayout} */ toBufferLayout(offset) {
        return null;
    }
    /** @internal */ genTypeId() {
        return `PRIM:${this.primitiveType}`;
    }
}
/**
 * The struct type info
 * @public
 */ class PBStructTypeInfo extends PBTypeInfo {
    constructor(name, layout, members){
        super(PBTypeClass.PLAIN, {
            layout: layout || 'default',
            structName: name,
            structMembers: members.map((val)=>{
                const defaultAlignment = getAlignment(val.type);
                const defaultSize = getSize(val.type);
                return {
                    name: val.name,
                    type: val.type,
                    alignment: defaultAlignment,
                    size: defaultSize,
                    defaultAlignment: defaultAlignment,
                    defaultSize: defaultSize
                };
            })
        });
        if (this.layout === 'std140') {
            this.calcAlignmentAndSizeSTD140();
        } else if (this.layout === 'std430') {
            this.calcAlignmentAndSizePacked();
        }
    }
    /** Get the layout type */ get layout() {
        return this.detail.layout;
    }
    /** Get name of the struct type */ get structName() {
        return this.detail.structName;
    }
    set structName(val) {
        this.detail.structName = val;
    }
    /** Get member types of the struct type */ get structMembers() {
        return this.detail.structMembers;
    }
    /** Whether this struct has atomic members */ haveAtomicMembers() {
        for (const member of this.structMembers){
            if (member.type.isStructType() && member.type.haveAtomicMembers()) {
                return true;
            } else if (member.type.isArrayType() && member.type.haveAtomicMembers()) {
                return true;
            } else {
                return member.type.isAtomicI32() || member.type.isAtomicU32();
            }
        }
    }
    /**
   * Creates a new struct type by extending this type
   * @param name - Name of the new struct type
   * @param members - additional struct members
   * @returns The new struct type
   */ extends(name, members) {
        const oldMembers = this.structMembers.map((member)=>({
                name: member.name,
                type: member.type
            }));
        return new PBStructTypeInfo(name, this.layout, [
            ...oldMembers,
            ...members
        ]);
    }
    /** {@inheritDoc PBTypeInfo.isStructType} */ isStructType() {
        return true;
    }
    /** @internal */ isHostSharable() {
        return this.detail.structMembers.every((val)=>val.type.isHostSharable());
    }
    /** @internal */ isConstructible() {
        return this.detail.structMembers.every((val)=>val.type.isConstructible());
    }
    /** @internal */ isStorable() {
        return true;
    }
    /** @internal */ getConstructorOverloads() {
        const result = [
            new PBFunctionTypeInfo(this.structName, this, [])
        ];
        if (this.isConstructible()) {
            result.push(new PBFunctionTypeInfo(this.structName, this, this.structMembers.map((val)=>({
                    type: val.type
                }))));
        }
        return result;
    }
    /** @internal */ toTypeName(deviceType, varName) {
        if (deviceType === 'webgpu') {
            return varName ? `${varName}: ${this.structName}` : this.structName;
        } else {
            return varName ? `${this.structName} ${varName}` : this.structName;
        }
    }
    /** @internal */ getLayoutAlignment(layout) {
        if (layout === 'packed') {
            return 1;
        }
        let alignment = 0;
        for (const member of this.structMembers){
            alignment = Math.max(alignment, member.type.getLayoutAlignment(layout));
        }
        if (layout === 'std140') {
            alignment = align(alignment, 16);
        }
        return alignment;
    }
    /** @internal */ getLayoutSize(layout) {
        let size = 0;
        let structAlignment = 0;
        for (const member of this.structMembers){
            const memberAlignment = member.type.getLayoutAlignment(layout);
            size = align(size, memberAlignment);
            size += member.type.getLayoutSize(layout);
            structAlignment = Math.max(structAlignment, memberAlignment);
        }
        return align(size, structAlignment);
    }
    /** {@inheritDoc PBTypeInfo.toBufferLayout} */ toBufferLayout(offset, layout) {
        const bufferLayout = {
            byteSize: 0,
            entries: []
        };
        const start = offset;
        for (const member of this.structMembers){
            offset = align(offset, member.type.getLayoutAlignment(layout));
            const size = member.type.getLayoutSize(layout);
            bufferLayout.entries.push({
                name: member.name,
                offset: offset,
                byteSize: size,
                type: typeToTypedArray(member.type),
                subLayout: member.type.isStructType() ? member.type.toBufferLayout(offset, layout) : null,
                arraySize: member.type.isArrayType() ? member.type.dimension : 0
            });
            offset += size;
        }
        bufferLayout.byteSize = layout === 'std140' ? align(offset - start, 16) : offset - start;
        return bufferLayout;
    }
    /** @internal */ clone(newName) {
        return new PBStructTypeInfo(newName || this.structName, this.layout, this.structMembers);
    }
    /** @internal */ reset(name, layout, members) {
        this.detail = {
            layout: layout || 'default',
            structName: name,
            structMembers: members.map((val)=>{
                const defaultAlignment = getAlignment(val.type);
                const defaultSize = getSize(val.type);
                return {
                    name: val.name,
                    type: val.type,
                    alignment: defaultAlignment,
                    size: defaultSize,
                    defaultAlignment: defaultAlignment,
                    defaultSize: defaultSize
                };
            })
        };
        if (this.layout === 'std140') {
            this.calcAlignmentAndSizeSTD140();
        } else if (this.layout === 'std430') {
            this.calcAlignmentAndSizePacked();
        }
        this.id = null;
    }
    /** @internal */ genTypeId() {
        return `STRUCT:${this.structName}:${this.layout}:${this.structMembers.map((val)=>`${val.name}(${val.type.typeId})`).join(':')}`;
    }
    /** @internal */ calcAlignmentAndSizeSTD140() {
        for (const member of this.structMembers){
            if (member.type.isPrimitiveType()) {
                if (member.type.isMatrixType() && member.type.cols === 2) {
                    throw new Error(`matrix${member.type.rows}x${member.type.cols} can not be used in std140 layout`);
                }
            } else if (member.type.isArrayType() && (member.type.elementType.isAnyType() || getAlignment(member.type.elementType) !== 16)) {
                throw new Error('array element must be 16 bytes aligned in std140 layout');
            } else if (member.type.isStructType()) {
                member.alignment = 16;
                member.size = align(member.defaultSize, 16);
            }
        }
    }
    /** @internal */ calcAlignmentAndSizePacked() {
        for (const member of this.structMembers){
            member.alignment = getAlignmentPacked(member.type);
            member.size = getSizePacked(member.type);
        }
    }
}
/**
 * The array type info
 * @public
 */ class PBArrayTypeInfo extends PBTypeInfo {
    constructor(elementType, dimension){
        super(PBTypeClass.ARRAY, {
            elementType: elementType,
            dimension: Number(dimension) || 0
        });
    }
    /** Get the element type */ get elementType() {
        return this.detail.elementType;
    }
    /** Get dimension of the array type */ get dimension() {
        return this.detail.dimension;
    }
    /** Wether array have atomic members */ haveAtomicMembers() {
        if (this.elementType.isStructType() || this.elementType.isArrayType()) {
            return this.elementType.haveAtomicMembers();
        } else {
            return this.elementType.isAtomicI32() || this.elementType.isAtomicU32();
        }
    }
    /** {@inheritDoc PBTypeInfo.isArrayType} */ isArrayType() {
        return true;
    }
    /** @internal */ isHostSharable() {
        return this.detail.elementType.isHostSharable();
    }
    /** @internal */ isConstructible() {
        return this.dimension && this.detail.elementType.isConstructible();
    }
    /** @internal */ isStorable() {
        return true;
    }
    /** @internal */ getConstructorOverloads(deviceType) {
        const name = this.toTypeName(deviceType);
        const result = [
            new PBFunctionTypeInfo(name, this, [])
        ];
        if (deviceType !== 'webgl' && this.isConstructible()) {
            result.push(new PBFunctionTypeInfo(name, this, Array.from({
                length: this.dimension
            }).map(()=>({
                    type: this.elementType
                }))));
        }
        return result;
    }
    /** @internal */ toTypeName(deviceType, varName) {
        if (deviceType === 'webgpu') {
            const elementTypeName = this.elementType.toTypeName(deviceType);
            const typename = `array<${elementTypeName}${this.dimension ? ', ' + this.dimension : ''}>`;
            return varName ? `${varName}: ${typename}` : typename;
        } else {
            console.assert(!!this.dimension, 'runtime-sized array not supported for webgl');
            console.assert(!this.elementType.isArrayType(), 'multi-dimensional arrays not supported for webgl');
            const elementTypeName = this.elementType.toTypeName(deviceType, varName);
            return `${elementTypeName}[${this.dimension}]`;
        }
    }
    /** @internal */ getLayoutAlignment(layout) {
        return layout === 'packed' || this.elementType.isAnyType() ? 1 : layout === 'std430' ? this.elementType.getLayoutAlignment(layout) : align(this.elementType.getLayoutAlignment(layout), 16);
    }
    /** @internal */ getLayoutSize(layout) {
        const elementAlignment = this.elementType.isAnyType() ? 1 : this.elementType.getLayoutAlignment(layout);
        if (layout === 'std140' && !!(elementAlignment & 15)) {
            // array element stride of std140 layout must be multiple of 16
            throw new Error('Error: array element stride of std140 must be multiple of 16');
        }
        return this.elementType.isAnyType() ? 0 : this.dimension * align(this.elementType.getLayoutSize(layout), elementAlignment);
    }
    /** {@inheritDoc PBTypeInfo.toBufferLayout} */ toBufferLayout(offset) {
        return null;
    }
    isCompatibleType(other) {
        if (!other.isArrayType()) {
            return false;
        }
        if (this.dimension !== 0 && other.dimension !== this.dimension) {
            return false;
        }
        return this.elementType.isCompatibleType(other.elementType);
    }
    /** @internal */ genTypeId() {
        return `ARRAY:(${this.elementType.typeId})[${this.dimension}]`;
    }
}
/**
 * The pointer type info
 * @public
 */ class PBPointerTypeInfo extends PBTypeInfo {
    /** @internal */ writable;
    constructor(pointerType, addressSpace){
        super(PBTypeClass.POINTER, {
            pointerType,
            addressSpace
        });
        console.assert(pointerType.isStorable(), 'the pointee type must be storable');
        this.writable = false;
    }
    /** Get type of the pointer */ get pointerType() {
        return this.detail.pointerType;
    }
    /** Get address space of the pointer */ get addressSpace() {
        return this.detail.addressSpace;
    }
    set addressSpace(val) {
        if (this.detail.addressSpace !== val) {
            this.detail.addressSpace = val;
            this.id = null;
        }
    }
    /** {@inheritDoc PBTypeInfo.haveAtomicMembers} */ haveAtomicMembers() {
        return this.pointerType.haveAtomicMembers();
    }
    /** {@inheritDoc PBTypeInfo.isPointerType} */ isPointerType() {
        return true;
    }
    /** @internal */ toTypeName(device, varName) {
        if (device === 'webgpu') {
            const addressSpace = this.addressSpace === PBAddressSpace.UNKNOWN ? PBAddressSpace.FUNCTION : this.addressSpace;
            /*
      const mode = addressSpace === PBAddressSpace.UNIFORM || (addressSpace === PBAddressSpace.STORAGE && !this.writable) ? 'read' : 'read_write'
      const typename = `ptr<${addressSpace}, ${this.pointerType.toTypeName(device)}, ${mode}>`;
      */ /* WGSL spec:
        When writing a variable declaration or a pointer type in WGSL source:
        For the storage address space, the access mode is optional, and defaults to read.
        For other address spaces, the access mode must not be written.
      */ const mode = addressSpace === PBAddressSpace.STORAGE && this.writable ? ', read_write' : '';
            const typename = `ptr<${addressSpace}, ${this.pointerType.toTypeName(device)} ${mode}>`;
            return varName ? `${varName}: ${typename}` : typename;
        } else {
            throw new Error('pointer type not supported for webgl');
        }
    }
    /** {@inheritDoc PBTypeInfo.toBufferLayout} */ toBufferLayout(offset) {
        return null;
    }
    /** @internal */ genTypeId() {
        return `PTR:(${this.pointerType.typeId})`;
    }
}
/**
 * The atomic int type info
 * @public
 */ class PBAtomicI32TypeInfo extends PBTypeInfo {
    constructor(){
        super(PBTypeClass.ATOMIC_I32, null);
    }
    /** {@inheritDoc PBTypeInfo.isPointerType} */ haveAtomicMembers() {
        return true;
    }
    /** @internal */ isAtomicI32() {
        return true;
    }
    /** @internal */ isHostSharable() {
        return true;
    }
    /** @internal */ isStorable() {
        return true;
    }
    /** @internal */ toTypeName(deviceType, varName) {
        if (deviceType === 'webgpu') {
            const typename = 'atomic<i32>';
            return varName ? `${varName}: ${typename}` : typename;
        } else {
            throw new Error('atomic type not supported for webgl');
        }
    }
    /** {@inheritDoc PBTypeInfo.toBufferLayout} */ toBufferLayout(offset) {
        return null;
    }
    /** @internal */ getLayoutAlignment(layout) {
        return 4;
    }
    /** @internal */ getLayoutSize() {
        return this.getSize();
    }
    /** @internal */ getSize() {
        return 4;
    }
    /** @internal */ genTypeId() {
        return `ATOMICI32`;
    }
}
/**
 * The atomic int type info
 * @public
 */ class PBAtomicU32TypeInfo extends PBTypeInfo {
    constructor(){
        super(PBTypeClass.ATOMIC_U32, null);
    }
    /** {@inheritDoc PBTypeInfo.isPointerType} */ haveAtomicMembers() {
        return true;
    }
    /** @internal */ isAtomicU32() {
        return true;
    }
    /** @internal */ isHostSharable() {
        return true;
    }
    /** @internal */ isStorable() {
        return true;
    }
    /** @internal */ toTypeName(deviceType, varName) {
        if (deviceType === 'webgpu') {
            const typename = 'atomic<u32>';
            return varName ? `${varName}: ${typename}` : typename;
        } else {
            throw new Error('atomic type not supported for webgl');
        }
    }
    /** {@inheritDoc PBTypeInfo.toBufferLayout} */ toBufferLayout(offset) {
        return null;
    }
    /** @internal */ getLayoutAlignment(layout) {
        return 4;
    }
    /** @internal */ getLayoutSize() {
        return this.getSize();
    }
    /** @internal */ getSize() {
        return 4;
    }
    /** @internal */ genTypeId() {
        return `ATOMICU32`;
    }
}
/**
 * The sampler type info
 * @public
 */ class PBSamplerTypeInfo extends PBTypeInfo {
    constructor(accessMode){
        super(PBTypeClass.SAMPLER, {
            accessMode: accessMode
        });
    }
    /** Get the access mode */ get accessMode() {
        return this.detail.accessMode;
    }
    /** @internal */ isSamplerType() {
        return true;
    }
    /** @internal */ isStorable() {
        return true;
    }
    /** @internal */ toTypeName(deviceType, varName) {
        if (deviceType === 'webgpu') {
            const typename = this.accessMode === PBSamplerAccessMode.SAMPLE ? 'sampler' : 'sampler_comparison';
            return varName ? `${varName}: ${typename}` : typename;
        } else {
            throw new Error('sampler type not supported for webgl');
        }
    }
    /** {@inheritDoc PBTypeInfo.toBufferLayout} */ toBufferLayout(offset) {
        return null;
    }
    /** @internal */ genTypeId() {
        return `SAMPLER:${this.accessMode}`;
    }
}
/**
 * The texture type info
 * @public
 */ class PBTextureTypeInfo extends PBTypeInfo {
    constructor(textureType, texelFormat, readable, writable){
        super(PBTypeClass.TEXTURE, {
            textureType: textureType,
            readable,
            writable,
            storageTexelFormat: texelFormat || null
        });
        console.assert(!!textureTypeMapWGSL[textureType], 'unsupported texture type');
        console.assert(!(textureType & BITFLAG_STORAGE) || !!storageTexelFormatMap[texelFormat], 'invalid texel format for storage texture');
    }
    /** Get the texture type */ get textureType() {
        return this.detail.textureType;
    }
    /** Get texture format if this is a storage texture */ get storageTexelFormat() {
        return this.detail.storageTexelFormat;
    }
    /** Returns true if this is a readable storage texture type */ get readable() {
        return this.detail.readable;
    }
    set readable(val) {
        this.detail.readable = !!val;
    }
    /** Returns true if this is a writable storage texture type */ get writable() {
        return this.detail.writable;
    }
    set writable(val) {
        this.detail.writable = !!val;
    }
    /** @internal */ isStorable() {
        return true;
    }
    /** @internal */ is1DTexture() {
        return !!(this.detail.textureType & BITFLAG_1D);
    }
    /** Returns true if this is a 2D texture type */ is2DTexture() {
        return !!(this.detail.textureType & BITFLAG_2D);
    }
    /** Returns true if this is a 3D texture type */ is3DTexture() {
        return !!(this.detail.textureType & BITFLAG_3D);
    }
    /** Returns true if this is a cube texture type */ isCubeTexture() {
        return !!(this.detail.textureType & BITFLAG_CUBE);
    }
    /** Returns true if this is an array texture type */ isArrayTexture() {
        return !!(this.detail.textureType & BITFLAG_ARRAY);
    }
    /** Returns true if this is a storage texture type */ isStorageTexture() {
        return !!(this.detail.textureType & BITFLAG_STORAGE);
    }
    /** Return s true if this is a depth texture type */ isDepthTexture() {
        return !!(this.detail.textureType & BITFLAG_DEPTH);
    }
    /** Returns true if this is a multisampled texture type */ isMultisampledTexture() {
        return !!(this.detail.textureType & BITFLAG_MULTISAMPLED);
    }
    /** Returns true if this is an external texture type */ isExternalTexture() {
        return !!(this.detail.textureType & BITFLAG_EXTERNAL);
    }
    /** Returns true if the texture format is of type integer  */ isIntTexture() {
        return !!(this.detail.textureType & BITFLAG_INT);
    }
    /** Returns true if the texture format is of type unsigned integer  */ isUIntTexture() {
        return !!(this.detail.textureType & BITFLAG_UINT);
    }
    /** @internal */ isTextureType() {
        return true;
    }
    /** @internal */ toTypeName(deviceType, varName) {
        if (deviceType === 'webgpu') {
            let typename = textureTypeMapWGSL[this.textureType];
            if (this.isStorageTexture()) {
                const storageTexelFormat = storageTexelFormatMap[this.storageTexelFormat];
                // storage textures currently only support 'write' access control
                const accessMode = this.writable ? this.readable ? 'read_write' : 'write' : 'read'; // this.readable ? (this.writable ? 'read_write' : 'read') : 'write';
                typename = `${typename}<${storageTexelFormat}, ${accessMode}>`;
            }
            return varName ? `${varName}: ${typename}` : typename;
        } else {
            const typename = (deviceType === 'webgl' ? textureTypeMapWebGL : textureTypeMapWebGL2)[this.textureType];
            console.assert(!!typename, 'unsupported texture type');
            return varName ? `${typename} ${varName}` : typename;
        }
    }
    /** {@inheritDoc PBTypeInfo.toBufferLayout} */ toBufferLayout(offset) {
        return null;
    }
    /** @internal */ genTypeId() {
        return `TEXTURE:${this.textureType}`;
    }
}
/**
 * The function type info
 * @public
 */ class PBFunctionTypeInfo extends PBTypeInfo {
    constructor(name, returnType, argTypes){
        super(PBTypeClass.FUNCTION, {
            name,
            returnType,
            argTypes
        });
    }
    /** Get name of the function */ get name() {
        return this.detail.name;
    }
    /** Get return type of the function */ get returnType() {
        return this.detail.returnType;
    }
    /** Get all the argument types for this function */ get argTypes() {
        return this.detail.argTypes;
    }
    /** Get hash for parameter types */ get argHash() {
        return this.argTypes.map((val)=>val.type.typeId).join(',');
    }
    /** @internal */ genTypeId() {
        return `fn(${this.argHash}):${this.returnType.typeId}`;
    }
    /** {@inheritDoc PBTypeInfo.toBufferLayout} */ toBufferLayout(offset) {
        return null;
    }
    /** @internal */ toTypeName(deviceType, varName) {
        throw new Error('not supported');
    }
}
/** @internal */ PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.F16);
/** @internal */ PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.F16VEC2);
/** @internal */ PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.F16VEC3);
/** @internal */ PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.F16VEC4);
/** @internal */ const typeF32 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.F32);
/** @internal */ const typeF32Vec2 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.F32VEC2);
/** @internal */ const typeF32Vec3 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.F32VEC3);
/** @internal */ const typeF32Vec4 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.F32VEC4);
/** @internal */ PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.I8);
/** @internal */ PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.I8VEC2);
/** @internal */ PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.I8VEC3);
/** @internal */ PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.I8VEC4);
/** @internal */ PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.I8_NORM);
/** @internal */ PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.I8VEC2_NORM);
/** @internal */ PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.I8VEC3_NORM);
/** @internal */ PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.I8VEC4_NORM);
/** @internal */ PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.I16);
/** @internal */ PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.I16VEC2);
/** @internal */ PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.I16VEC3);
/** @internal */ PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.I16VEC4);
/** @internal */ PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.I16_NORM);
/** @internal */ PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.I16VEC2_NORM);
/** @internal */ PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.I16VEC3_NORM);
/** @internal */ PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.I16VEC4_NORM);
/** @internal */ const typeAtomicI32 = new PBAtomicI32TypeInfo();
/** @internal */ const typeAtomicU32 = new PBAtomicU32TypeInfo();
/** @internal */ const typeI32 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.I32);
/** @internal */ const typeI32Vec2 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.I32VEC2);
/** @internal */ const typeI32Vec3 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.I32VEC3);
/** @internal */ const typeI32Vec4 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.I32VEC4);
/** @internal */ PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.I32);
/** @internal */ PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.I32VEC2_NORM);
/** @internal */ PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.I32VEC3_NORM);
/** @internal */ PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.I32VEC4_NORM);
/** @internal */ PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.U8);
/** @internal */ PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.U8VEC2);
/** @internal */ PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.U8VEC3);
/** @internal */ PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.U8VEC4);
/** @internal */ PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.U8_NORM);
/** @internal */ PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.U8VEC2_NORM);
/** @internal */ PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.U8VEC3_NORM);
/** @internal */ PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.U8VEC4_NORM);
/** @internal */ PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.U16);
/** @internal */ PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.U16VEC2);
/** @internal */ PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.U16VEC3);
/** @internal */ PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.U16VEC4);
/** @internal */ PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.U16_NORM);
/** @internal */ PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.U16VEC2_NORM);
/** @internal */ PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.U16VEC3_NORM);
/** @internal */ PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.U16VEC4_NORM);
/** @internal */ const typeU32$1 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.U32);
/** @internal */ const typeU32Vec2 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.U32VEC2);
/** @internal */ const typeU32Vec3 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.U32VEC3);
/** @internal */ const typeU32Vec4 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.U32VEC4);
/** @internal */ PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.U32_NORM);
/** @internal */ PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.U32VEC2_NORM);
/** @internal */ PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.U32VEC3_NORM);
/** @internal */ PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.U32VEC4_NORM);
/** @internal */ const typeBool = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.BOOL);
/** @internal */ const typeBVec2 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.BVEC2);
/** @internal */ const typeBVec3 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.BVEC3);
/** @internal */ const typeBVec4 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.BVEC4);
/** @internal */ const typeMat2 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.MAT2);
/** @internal */ const typeMat2x3 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.MAT2x3);
/** @internal */ const typeMat2x4 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.MAT2x4);
/** @internal */ const typeMat3x2 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.MAT3x2);
/** @internal */ const typeMat3 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.MAT3);
/** @internal */ const typeMat3x4 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.MAT3x4);
/** @internal */ const typeMat4x2 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.MAT4x2);
/** @internal */ const typeMat4x3 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.MAT4x3);
/** @internal */ const typeMat4 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.MAT4);
/** @internal */ const typeTex1D = new PBTextureTypeInfo(PBTextureType.TEX_1D);
/** @internal */ const typeITex1D = new PBTextureTypeInfo(PBTextureType.ITEX_1D);
/** @internal */ const typeUTex1D = new PBTextureTypeInfo(PBTextureType.UTEX_1D);
/** @internal */ const typeTex2D = new PBTextureTypeInfo(PBTextureType.TEX_2D);
/** @internal */ const typeITex2D = new PBTextureTypeInfo(PBTextureType.ITEX_2D);
/** @internal */ const typeUTex2D = new PBTextureTypeInfo(PBTextureType.UTEX_2D);
/** @internal */ const typeTex2DArray = new PBTextureTypeInfo(PBTextureType.TEX_2D_ARRAY);
/** @internal */ const typeITex2DArray = new PBTextureTypeInfo(PBTextureType.ITEX_2D_ARRAY);
/** @internal */ const typeUTex2DArray = new PBTextureTypeInfo(PBTextureType.UTEX_2D_ARRAY);
/** @internal */ const typeTex3D = new PBTextureTypeInfo(PBTextureType.TEX_3D);
/** @internal */ const typeITex3D = new PBTextureTypeInfo(PBTextureType.ITEX_3D);
/** @internal */ const typeUTex3D = new PBTextureTypeInfo(PBTextureType.UTEX_3D);
/** @internal */ const typeTexCube = new PBTextureTypeInfo(PBTextureType.TEX_CUBE);
/** @internal */ const typeITexCube = new PBTextureTypeInfo(PBTextureType.ITEX_CUBE);
/** @internal */ const typeUTexCube = new PBTextureTypeInfo(PBTextureType.UTEX_CUBE);
/** @internal */ const typeTexExternal = new PBTextureTypeInfo(PBTextureType.TEX_EXTERNAL);
/** @internal */ const typeTexCubeArray = new PBTextureTypeInfo(PBTextureType.TEX_CUBE_ARRAY);
/** @internal */ const typeITexCubeArray = new PBTextureTypeInfo(PBTextureType.ITEX_CUBE_ARRAY);
/** @internal */ const typeUTexCubeArray = new PBTextureTypeInfo(PBTextureType.UTEX_CUBE_ARRAY);
/** @internal */ const typeTexMultisampled2D = new PBTextureTypeInfo(PBTextureType.TEX_MULTISAMPLED_2D);
/** @internal */ const typeITexMultisampled2D = new PBTextureTypeInfo(PBTextureType.ITEX_MULTISAMPLED_2D);
/** @internal */ const typeUTexMultisampled2D = new PBTextureTypeInfo(PBTextureType.UTEX_MULTISAMPLED_2D);
/** @internal */ const typeTexStorage1D_rgba8unorm = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_1D, 'rgba8unorm');
/** @internal */ const typeTexStorage1D_rgba8snorm = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_1D, 'rgba8snorm');
/** @internal */ const typeTexStorage1D_bgra8unorm = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_1D, 'rgba8unorm');
/** @internal */ const typeTexStorage1D_rgba8uint = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_1D, 'rgba8ui');
/** @internal */ const typeTexStorage1D_rgba8sint = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_1D, 'rgba8i');
/** @internal */ const typeTexStorage1D_rgba16uint = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_1D, 'rgba16ui');
/** @internal */ const typeTexStorage1D_rgba16sint = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_1D, 'rgba16i');
/** @internal */ const typeTexStorage1D_rgba16float = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_1D, 'rgba16f');
/** @internal */ const typeTexStorage1D_rgba32uint = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_1D, 'rgba32ui');
/** @internal */ const typeTexStorage1D_rgba32sint = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_1D, 'rgba32i');
/** @internal */ const typeTexStorage1D_rgba32float = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_1D, 'rgba32f');
/** @internal */ const typeTexStorage1D_rg32uint = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_1D, 'rg32ui');
/** @internal */ const typeTexStorage1D_rg32sint = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_1D, 'rg32i');
/** @internal */ const typeTexStorage1D_rg32float = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_1D, 'rg32f');
/** @internal */ const typeTexStorage1D_r32uint = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_1D, 'r32ui');
/** @internal */ const typeTexStorage1D_r32sint = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_1D, 'r32i');
/** @internal */ const typeTexStorage1D_r32float = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_1D, 'r32f');
/** @internal */ const typeTexStorage2D_rgba8unorm = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_2D, 'rgba8unorm');
/** @internal */ const typeTexStorage2D_rgba8snorm = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_2D, 'rgba8snorm');
/** @internal */ const typeTexStorage2D_bgra8unorm = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_2D, 'bgra8unorm');
/** @internal */ const typeTexStorage2D_rgba8uint = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_2D, 'rgba8ui');
/** @internal */ const typeTexStorage2D_rgba8sint = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_2D, 'rgba8i');
/** @internal */ const typeTexStorage2D_rgba16uint = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_2D, 'rgba16ui');
/** @internal */ const typeTexStorage2D_rgba16sint = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_2D, 'rgba16i');
/** @internal */ const typeTexStorage2D_rgba16float = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_2D, 'rgba16f');
/** @internal */ const typeTexStorage2D_rgba32uint = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_2D, 'rgba32ui');
/** @internal */ const typeTexStorage2D_rgba32sint = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_2D, 'rgba32i');
/** @internal */ const typeTexStorage2D_rgba32float = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_2D, 'rgba32f');
/** @internal */ const typeTexStorage2D_rg32uint = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_2D, 'rg32ui');
/** @internal */ const typeTexStorage2D_rg32sint = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_2D, 'rg32i');
/** @internal */ const typeTexStorage2D_rg32float = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_2D, 'rg32f');
/** @internal */ const typeTexStorage2D_r32uint = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_2D, 'r32ui');
/** @internal */ const typeTexStorage2D_r32sint = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_2D, 'r32i');
/** @internal */ const typeTexStorage2D_r32float = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_2D, 'r32f');
/** @internal */ const typeTexStorage2DArray_rgba8unorm = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_2D_ARRAY, 'rgba8unorm');
/** @internal */ const typeTexStorage2DArray_rgba8snorm = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_2D_ARRAY, 'rgba8snorm');
/** @internal */ new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_2D_ARRAY, 'bgra8unorm');
/** @internal */ const typeTexStorage2DArray_rgba8uint = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_2D_ARRAY, 'rgba8ui');
/** @internal */ const typeTexStorage2DArray_rgba8sint = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_2D_ARRAY, 'rgba8i');
/** @internal */ const typeTexStorage2DArray_rgba16uint = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_2D_ARRAY, 'rgba16ui');
/** @internal */ const typeTexStorage2DArray_rgba16sint = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_2D_ARRAY, 'rgba16i');
/** @internal */ const typeTexStorage2DArray_rgba16float = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_2D_ARRAY, 'rgba16f');
/** @internal */ const typeTexStorage2DArray_rgba32uint = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_2D_ARRAY, 'rgba32ui');
/** @internal */ const typeTexStorage2DArray_rgba32sint = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_2D_ARRAY, 'rgba32i');
/** @internal */ const typeTexStorage2DArray_rgba32float = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_2D_ARRAY, 'rgba32f');
/** @internal */ const typeTexStorage2DArray_rg32uint = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_2D_ARRAY, 'rg32ui');
/** @internal */ const typeTexStorage2DArray_rg32sint = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_2D_ARRAY, 'rg32i');
/** @internal */ const typeTexStorage2DArray_rg32float = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_2D_ARRAY, 'rg32f');
/** @internal */ const typeTexStorage2DArray_r32uint = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_2D_ARRAY, 'r32ui');
/** @internal */ const typeTexStorage2DArray_r32sint = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_2D_ARRAY, 'r32i');
/** @internal */ const typeTexStorage2DArray_r32float = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_2D_ARRAY, 'r32f');
/** @internal */ const typeTexStorage3D_rgba8unorm = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_3D, 'rgba8unorm');
/** @internal */ const typeTexStorage3D_rgba8snorm = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_3D, 'rgba8snorm');
/** @internal */ const typeTexStorage3D_bgra8unorm = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_3D, 'bgra8unorm');
/** @internal */ const typeTexStorage3D_rgba8uint = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_3D, 'rgba8ui');
/** @internal */ const typeTexStorage3D_rgba8sint = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_3D, 'rgba8i');
/** @internal */ const typeTexStorage3D_rgba16uint = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_3D, 'rgba16ui');
/** @internal */ const typeTexStorage3D_rgba16sint = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_3D, 'rgba16i');
/** @internal */ const typeTexStorage3D_rgba16float = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_3D, 'rgba16f');
/** @internal */ const typeTexStorage3D_rgba32uint = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_3D, 'rgba32ui');
/** @internal */ const typeTexStorage3D_rgba32sint = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_3D, 'rgba32i');
/** @internal */ const typeTexStorage3D_rgba32float = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_3D, 'rgba32f');
/** @internal */ const typeTexStorage3D_rg32uint = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_3D, 'rg32ui');
/** @internal */ const typeTexStorage3D_rg32sint = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_3D, 'rg32i');
/** @internal */ const typeTexStorage3D_rg32float = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_3D, 'rg32f');
/** @internal */ const typeTexStorage3D_r32uint = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_3D, 'r32ui');
/** @internal */ const typeTexStorage3D_r32sint = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_3D, 'r32i');
/** @internal */ const typeTexStorage3D_r32float = new PBTextureTypeInfo(PBTextureType.TEX_STORAGE_3D, 'r32f');
/** @internal */ const typeTexDepth2D = new PBTextureTypeInfo(PBTextureType.TEX_DEPTH_2D);
/** @internal */ const typeTexDepth2DArray = new PBTextureTypeInfo(PBTextureType.TEX_DEPTH_2D_ARRAY);
/** @internal */ const typeTexDepthCube = new PBTextureTypeInfo(PBTextureType.TEX_DEPTH_CUBE);
/** @internal */ const typeTexDepthCubeArray = new PBTextureTypeInfo(PBTextureType.TEX_DEPTH_CUBE_ARRAY);
/** @internal */ const typeTexDepthMultisampled2D = new PBTextureTypeInfo(PBTextureType.TEX_DEPTH_MULTISAMPLED_2D);
/** @internal */ const typeSampler = new PBSamplerTypeInfo(PBSamplerAccessMode.SAMPLE);
/** @internal */ const typeSamplerComparison = new PBSamplerTypeInfo(PBSamplerAccessMode.COMPARISON);
/** @internal */ const typeVoid = new PBVoidTypeInfo();
/** @internal */ new PBAnyTypeInfo();
/** @internal */ const typeFrexpResult = new PBStructTypeInfo('FrexpResult', 'default', [
    {
        name: 'sig',
        type: typeF32
    },
    {
        name: 'exp',
        type: typeI32
    }
]);
/** @internal */ const typeFrexpResultVec2 = new PBStructTypeInfo('FrexpResultVec2', 'default', [
    {
        name: 'sig',
        type: typeF32Vec2
    },
    {
        name: 'exp',
        type: typeI32Vec2
    }
]);
/** @internal */ const typeFrexpResultVec3 = new PBStructTypeInfo('FrexpResultVec3', 'default', [
    {
        name: 'sig',
        type: typeF32Vec3
    },
    {
        name: 'exp',
        type: typeI32Vec3
    }
]);
/** @internal */ const typeFrexpResultVec4 = new PBStructTypeInfo('FrexpResultVec4', 'default', [
    {
        name: 'sig',
        type: typeF32Vec4
    },
    {
        name: 'exp',
        type: typeI32Vec4
    }
]);

/** @internal */ const MAX_VERTEX_ATTRIBUTES = 16;
/** @internal */ const MAX_BINDING_GROUPS = 4;
/** @internal */ const VERTEX_ATTRIB_POSITION = 0;
/** @internal */ const VERTEX_ATTRIB_NORMAL = 1;
/** @internal */ const VERTEX_ATTRIB_DIFFUSE = 2;
/** @internal */ const VERTEX_ATTRIB_TANGENT = 3;
/** @internal */ const VERTEX_ATTRIB_TEXCOORD0 = 4;
/** @internal */ const VERTEX_ATTRIB_TEXCOORD1 = 5;
/** @internal */ const VERTEX_ATTRIB_TEXCOORD2 = 6;
/** @internal */ const VERTEX_ATTRIB_TEXCOORD3 = 7;
/** @internal */ const VERTEX_ATTRIB_TEXCOORD4 = 8;
/** @internal */ const VERTEX_ATTRIB_TEXCOORD5 = 9;
/** @internal */ const VERTEX_ATTRIB_TEXCOORD6 = 10;
/** @internal */ const VERTEX_ATTRIB_TEXCOORD7 = 11;
/** @internal */ const VERTEX_ATTRIB_BLEND_WEIGHT = 12;
/** @internal */ const VERTEX_ATTRIB_BLEND_INDICES = 13;
const vertexAttribFormatMap = {
    position_u8normx2: [
        VERTEX_ATTRIB_POSITION,
        PBPrimitiveType.U8VEC2_NORM,
        2,
        'u8norm',
        2
    ],
    position_u8normx4: [
        VERTEX_ATTRIB_POSITION,
        PBPrimitiveType.U8VEC4_NORM,
        4,
        'u8norm',
        4
    ],
    position_i8normx2: [
        VERTEX_ATTRIB_POSITION,
        PBPrimitiveType.I8VEC2_NORM,
        2,
        'i8norm',
        2
    ],
    position_i8normx4: [
        VERTEX_ATTRIB_POSITION,
        PBPrimitiveType.I8VEC4_NORM,
        4,
        'i8norm',
        4
    ],
    position_u16x2: [
        VERTEX_ATTRIB_POSITION,
        PBPrimitiveType.U16VEC2,
        4,
        'u16',
        2
    ],
    position_u16x4: [
        VERTEX_ATTRIB_POSITION,
        PBPrimitiveType.U16VEC4,
        8,
        'u16',
        4
    ],
    position_i16x2: [
        VERTEX_ATTRIB_POSITION,
        PBPrimitiveType.I16VEC2,
        4,
        'i16',
        2
    ],
    position_i16x4: [
        VERTEX_ATTRIB_POSITION,
        PBPrimitiveType.I16VEC4,
        8,
        'i16',
        4
    ],
    position_u16normx2: [
        VERTEX_ATTRIB_POSITION,
        PBPrimitiveType.U16VEC2_NORM,
        4,
        'u16norm',
        2
    ],
    position_u16normx4: [
        VERTEX_ATTRIB_POSITION,
        PBPrimitiveType.U16VEC4_NORM,
        8,
        'u16norm',
        4
    ],
    position_i16normx2: [
        VERTEX_ATTRIB_POSITION,
        PBPrimitiveType.I16VEC2_NORM,
        4,
        'i16norm',
        2
    ],
    position_i16normx4: [
        VERTEX_ATTRIB_POSITION,
        PBPrimitiveType.I16VEC4_NORM,
        8,
        'i16norm',
        4
    ],
    position_f16x2: [
        VERTEX_ATTRIB_POSITION,
        PBPrimitiveType.F16VEC2,
        4,
        'f16',
        2
    ],
    position_f16x4: [
        VERTEX_ATTRIB_POSITION,
        PBPrimitiveType.F16VEC4,
        8,
        'f16',
        4
    ],
    position_f32: [
        VERTEX_ATTRIB_POSITION,
        PBPrimitiveType.F32,
        4,
        'f32',
        1
    ],
    position_f32x2: [
        VERTEX_ATTRIB_POSITION,
        PBPrimitiveType.F32VEC2,
        8,
        'f32',
        2
    ],
    position_f32x3: [
        VERTEX_ATTRIB_POSITION,
        PBPrimitiveType.F32VEC3,
        12,
        'f32',
        3
    ],
    position_f32x4: [
        VERTEX_ATTRIB_POSITION,
        PBPrimitiveType.F32VEC4,
        16,
        'f32',
        4
    ],
    position_i32: [
        VERTEX_ATTRIB_POSITION,
        PBPrimitiveType.I32,
        4,
        'i32',
        1
    ],
    position_i32x2: [
        VERTEX_ATTRIB_POSITION,
        PBPrimitiveType.I32VEC2,
        8,
        'i32',
        2
    ],
    position_i32x3: [
        VERTEX_ATTRIB_POSITION,
        PBPrimitiveType.I32VEC3,
        12,
        'i32',
        3
    ],
    position_i32x4: [
        VERTEX_ATTRIB_POSITION,
        PBPrimitiveType.I32VEC4,
        16,
        'i32',
        4
    ],
    position_u32: [
        VERTEX_ATTRIB_POSITION,
        PBPrimitiveType.U32,
        4,
        'u32',
        1
    ],
    position_u32x2: [
        VERTEX_ATTRIB_POSITION,
        PBPrimitiveType.U32VEC2,
        8,
        'u32',
        2
    ],
    position_u32x3: [
        VERTEX_ATTRIB_POSITION,
        PBPrimitiveType.U32VEC3,
        12,
        'u32',
        3
    ],
    position_u32x4: [
        VERTEX_ATTRIB_POSITION,
        PBPrimitiveType.U32VEC4,
        16,
        'u32',
        4
    ],
    normal_f16x4: [
        VERTEX_ATTRIB_NORMAL,
        PBPrimitiveType.F16VEC4,
        8,
        'f16',
        4
    ],
    normal_f32x3: [
        VERTEX_ATTRIB_NORMAL,
        PBPrimitiveType.F32VEC3,
        12,
        'f32',
        3
    ],
    normal_f32x4: [
        VERTEX_ATTRIB_NORMAL,
        PBPrimitiveType.F32VEC4,
        16,
        'f32',
        4
    ],
    diffuse_u8normx4: [
        VERTEX_ATTRIB_DIFFUSE,
        PBPrimitiveType.U8VEC4_NORM,
        4,
        'u8norm',
        4
    ],
    diffuse_u16x4: [
        VERTEX_ATTRIB_DIFFUSE,
        PBPrimitiveType.U16VEC4,
        8,
        'u16',
        4
    ],
    diffuse_u16normx4: [
        VERTEX_ATTRIB_DIFFUSE,
        PBPrimitiveType.U16VEC4_NORM,
        8,
        'u16norm',
        4
    ],
    diffuse_f16x4: [
        VERTEX_ATTRIB_DIFFUSE,
        PBPrimitiveType.F16VEC4,
        8,
        'f16',
        4
    ],
    diffuse_f32x3: [
        VERTEX_ATTRIB_DIFFUSE,
        PBPrimitiveType.F32VEC3,
        12,
        'f32',
        3
    ],
    diffuse_f32x4: [
        VERTEX_ATTRIB_DIFFUSE,
        PBPrimitiveType.F32VEC4,
        16,
        'f32',
        4
    ],
    diffuse_u32x3: [
        VERTEX_ATTRIB_DIFFUSE,
        PBPrimitiveType.U32VEC3,
        12,
        'u32',
        3
    ],
    diffuse_u32x4: [
        VERTEX_ATTRIB_DIFFUSE,
        PBPrimitiveType.U32VEC4,
        16,
        'u32',
        4
    ],
    tangent_f16x4: [
        VERTEX_ATTRIB_TANGENT,
        PBPrimitiveType.F16VEC4,
        8,
        'f16',
        4
    ],
    tangent_f32x3: [
        VERTEX_ATTRIB_TANGENT,
        PBPrimitiveType.F32VEC3,
        12,
        'f32',
        3
    ],
    tangent_f32x4: [
        VERTEX_ATTRIB_TANGENT,
        PBPrimitiveType.F32VEC4,
        16,
        'f32',
        4
    ],
    tex0_u8normx2: [
        VERTEX_ATTRIB_TEXCOORD0,
        PBPrimitiveType.U8VEC2_NORM,
        2,
        'u8norm',
        2
    ],
    tex0_u8normx4: [
        VERTEX_ATTRIB_TEXCOORD0,
        PBPrimitiveType.U8VEC4_NORM,
        4,
        'u8norm',
        4
    ],
    tex0_i8normx2: [
        VERTEX_ATTRIB_TEXCOORD0,
        PBPrimitiveType.I8VEC2_NORM,
        2,
        'i8norm',
        2
    ],
    tex0_i8normx4: [
        VERTEX_ATTRIB_TEXCOORD0,
        PBPrimitiveType.I8VEC4_NORM,
        4,
        'i8norm',
        4
    ],
    tex0_u16x2: [
        VERTEX_ATTRIB_TEXCOORD0,
        PBPrimitiveType.U16VEC2,
        4,
        'u16',
        2
    ],
    tex0_u16x4: [
        VERTEX_ATTRIB_TEXCOORD0,
        PBPrimitiveType.U16VEC4,
        8,
        'u16',
        4
    ],
    tex0_i16x2: [
        VERTEX_ATTRIB_TEXCOORD0,
        PBPrimitiveType.I16VEC2,
        4,
        'i16',
        2
    ],
    tex0_i16x4: [
        VERTEX_ATTRIB_TEXCOORD0,
        PBPrimitiveType.I16VEC4,
        8,
        'i16',
        4
    ],
    tex0_u16normx2: [
        VERTEX_ATTRIB_TEXCOORD0,
        PBPrimitiveType.U16VEC2_NORM,
        4,
        'u16norm',
        2
    ],
    tex0_u16normx4: [
        VERTEX_ATTRIB_TEXCOORD0,
        PBPrimitiveType.U16VEC4_NORM,
        8,
        'u16norm',
        4
    ],
    tex0_i16normx2: [
        VERTEX_ATTRIB_TEXCOORD0,
        PBPrimitiveType.I16VEC2_NORM,
        4,
        'i16norm',
        2
    ],
    tex0_i16normx4: [
        VERTEX_ATTRIB_TEXCOORD0,
        PBPrimitiveType.I16VEC4_NORM,
        8,
        'i16norm',
        4
    ],
    tex0_f16x2: [
        VERTEX_ATTRIB_TEXCOORD0,
        PBPrimitiveType.F16VEC2,
        4,
        'f16',
        2
    ],
    tex0_f16x4: [
        VERTEX_ATTRIB_TEXCOORD0,
        PBPrimitiveType.F16VEC4,
        8,
        'f16',
        4
    ],
    tex0_f32: [
        VERTEX_ATTRIB_TEXCOORD0,
        PBPrimitiveType.F32,
        4,
        'f32',
        1
    ],
    tex0_f32x2: [
        VERTEX_ATTRIB_TEXCOORD0,
        PBPrimitiveType.F32VEC2,
        8,
        'f32',
        2
    ],
    tex0_f32x3: [
        VERTEX_ATTRIB_TEXCOORD0,
        PBPrimitiveType.F32VEC3,
        12,
        'f32',
        3
    ],
    tex0_f32x4: [
        VERTEX_ATTRIB_TEXCOORD0,
        PBPrimitiveType.F32VEC4,
        16,
        'f32',
        4
    ],
    tex0_i32: [
        VERTEX_ATTRIB_TEXCOORD0,
        PBPrimitiveType.I32,
        4,
        'i32',
        1
    ],
    tex0_i32x2: [
        VERTEX_ATTRIB_TEXCOORD0,
        PBPrimitiveType.I32VEC2,
        8,
        'i32',
        2
    ],
    tex0_i32x3: [
        VERTEX_ATTRIB_TEXCOORD0,
        PBPrimitiveType.I32VEC3,
        12,
        'i32',
        3
    ],
    tex0_i32x4: [
        VERTEX_ATTRIB_TEXCOORD0,
        PBPrimitiveType.I32VEC4,
        16,
        'i32',
        4
    ],
    tex0_u32: [
        VERTEX_ATTRIB_TEXCOORD0,
        PBPrimitiveType.U32,
        4,
        'u32',
        1
    ],
    tex0_u32x2: [
        VERTEX_ATTRIB_TEXCOORD0,
        PBPrimitiveType.U32VEC2,
        8,
        'u32',
        2
    ],
    tex0_u32x3: [
        VERTEX_ATTRIB_TEXCOORD0,
        PBPrimitiveType.U32VEC3,
        12,
        'u32',
        3
    ],
    tex0_u32x4: [
        VERTEX_ATTRIB_TEXCOORD0,
        PBPrimitiveType.U32VEC4,
        16,
        'u32',
        4
    ],
    tex1_u8normx2: [
        VERTEX_ATTRIB_TEXCOORD1,
        PBPrimitiveType.U8VEC2_NORM,
        2,
        'u8norm',
        2
    ],
    tex1_u8normx4: [
        VERTEX_ATTRIB_TEXCOORD1,
        PBPrimitiveType.U8VEC4_NORM,
        4,
        'u8norm',
        4
    ],
    tex1_i8normx2: [
        VERTEX_ATTRIB_TEXCOORD1,
        PBPrimitiveType.I8VEC2_NORM,
        2,
        'i8norm',
        2
    ],
    tex1_i8normx4: [
        VERTEX_ATTRIB_TEXCOORD1,
        PBPrimitiveType.I8VEC4_NORM,
        4,
        'i8norm',
        4
    ],
    tex1_u16x2: [
        VERTEX_ATTRIB_TEXCOORD1,
        PBPrimitiveType.U16VEC2,
        4,
        'u16',
        2
    ],
    tex1_u16x4: [
        VERTEX_ATTRIB_TEXCOORD1,
        PBPrimitiveType.U16VEC4,
        8,
        'u16',
        4
    ],
    tex1_i16x2: [
        VERTEX_ATTRIB_TEXCOORD1,
        PBPrimitiveType.I16VEC2,
        4,
        'i16',
        2
    ],
    tex1_i16x4: [
        VERTEX_ATTRIB_TEXCOORD1,
        PBPrimitiveType.I16VEC4,
        8,
        'i16',
        4
    ],
    tex1_u16normx2: [
        VERTEX_ATTRIB_TEXCOORD1,
        PBPrimitiveType.U16VEC2_NORM,
        4,
        'u16norm',
        2
    ],
    tex1_u16normx4: [
        VERTEX_ATTRIB_TEXCOORD1,
        PBPrimitiveType.U16VEC4_NORM,
        8,
        'u16norm',
        4
    ],
    tex1_i16normx2: [
        VERTEX_ATTRIB_TEXCOORD1,
        PBPrimitiveType.I16VEC2_NORM,
        4,
        'i16norm',
        2
    ],
    tex1_i16normx4: [
        VERTEX_ATTRIB_TEXCOORD1,
        PBPrimitiveType.I16VEC4_NORM,
        8,
        'i16norm',
        4
    ],
    tex1_f16x2: [
        VERTEX_ATTRIB_TEXCOORD1,
        PBPrimitiveType.F16VEC2,
        4,
        'f16',
        2
    ],
    tex1_f16x4: [
        VERTEX_ATTRIB_TEXCOORD1,
        PBPrimitiveType.F16VEC4,
        8,
        'f16',
        4
    ],
    tex1_f32: [
        VERTEX_ATTRIB_TEXCOORD1,
        PBPrimitiveType.F32,
        4,
        'f32',
        1
    ],
    tex1_f32x2: [
        VERTEX_ATTRIB_TEXCOORD1,
        PBPrimitiveType.F32VEC2,
        8,
        'f32',
        2
    ],
    tex1_f32x3: [
        VERTEX_ATTRIB_TEXCOORD1,
        PBPrimitiveType.F32VEC3,
        12,
        'f32',
        3
    ],
    tex1_f32x4: [
        VERTEX_ATTRIB_TEXCOORD1,
        PBPrimitiveType.F32VEC4,
        16,
        'f32',
        4
    ],
    tex1_i32: [
        VERTEX_ATTRIB_TEXCOORD1,
        PBPrimitiveType.I32,
        4,
        'i32',
        1
    ],
    tex1_i32x2: [
        VERTEX_ATTRIB_TEXCOORD1,
        PBPrimitiveType.I32VEC2,
        8,
        'i32',
        2
    ],
    tex1_i32x3: [
        VERTEX_ATTRIB_TEXCOORD1,
        PBPrimitiveType.I32VEC3,
        12,
        'i32',
        3
    ],
    tex1_i32x4: [
        VERTEX_ATTRIB_TEXCOORD1,
        PBPrimitiveType.I32VEC4,
        16,
        'i32',
        4
    ],
    tex1_u32: [
        VERTEX_ATTRIB_TEXCOORD1,
        PBPrimitiveType.U32,
        4,
        'u32',
        1
    ],
    tex1_u32x2: [
        VERTEX_ATTRIB_TEXCOORD1,
        PBPrimitiveType.U32VEC2,
        8,
        'u32',
        2
    ],
    tex1_u32x3: [
        VERTEX_ATTRIB_TEXCOORD1,
        PBPrimitiveType.U32VEC3,
        12,
        'u32',
        3
    ],
    tex1_u32x4: [
        VERTEX_ATTRIB_TEXCOORD1,
        PBPrimitiveType.U32VEC4,
        16,
        'u32',
        4
    ],
    tex2_u8normx2: [
        VERTEX_ATTRIB_TEXCOORD2,
        PBPrimitiveType.U8VEC2_NORM,
        2,
        'u8norm',
        2
    ],
    tex2_u8normx4: [
        VERTEX_ATTRIB_TEXCOORD2,
        PBPrimitiveType.U8VEC4_NORM,
        4,
        'u8norm',
        4
    ],
    tex2_i8normx2: [
        VERTEX_ATTRIB_TEXCOORD2,
        PBPrimitiveType.I8VEC2_NORM,
        2,
        'i8norm',
        2
    ],
    tex2_i8normx4: [
        VERTEX_ATTRIB_TEXCOORD2,
        PBPrimitiveType.I8VEC4_NORM,
        4,
        'i8norm',
        4
    ],
    tex2_u16x2: [
        VERTEX_ATTRIB_TEXCOORD2,
        PBPrimitiveType.U16VEC2,
        4,
        'u16',
        2
    ],
    tex2_u16x4: [
        VERTEX_ATTRIB_TEXCOORD2,
        PBPrimitiveType.U16VEC4,
        8,
        'u16',
        4
    ],
    tex2_i16x2: [
        VERTEX_ATTRIB_TEXCOORD2,
        PBPrimitiveType.I16VEC2,
        4,
        'i16',
        2
    ],
    tex2_i16x4: [
        VERTEX_ATTRIB_TEXCOORD2,
        PBPrimitiveType.I16VEC4,
        8,
        'i16',
        4
    ],
    tex2_u16normx2: [
        VERTEX_ATTRIB_TEXCOORD2,
        PBPrimitiveType.U16VEC2_NORM,
        4,
        'u16norm',
        2
    ],
    tex2_u16normx4: [
        VERTEX_ATTRIB_TEXCOORD2,
        PBPrimitiveType.U16VEC4_NORM,
        8,
        'u16norm',
        4
    ],
    tex2_i16normx2: [
        VERTEX_ATTRIB_TEXCOORD2,
        PBPrimitiveType.I16VEC2_NORM,
        4,
        'i16norm',
        2
    ],
    tex2_i16normx4: [
        VERTEX_ATTRIB_TEXCOORD2,
        PBPrimitiveType.I16VEC4_NORM,
        8,
        'i16norm',
        4
    ],
    tex2_f16x2: [
        VERTEX_ATTRIB_TEXCOORD2,
        PBPrimitiveType.F16VEC2,
        4,
        'f16',
        2
    ],
    tex2_f16x4: [
        VERTEX_ATTRIB_TEXCOORD2,
        PBPrimitiveType.F16VEC4,
        8,
        'f16',
        4
    ],
    tex2_f32: [
        VERTEX_ATTRIB_TEXCOORD2,
        PBPrimitiveType.F32,
        4,
        'f32',
        1
    ],
    tex2_f32x2: [
        VERTEX_ATTRIB_TEXCOORD2,
        PBPrimitiveType.F32VEC2,
        8,
        'f32',
        2
    ],
    tex2_f32x3: [
        VERTEX_ATTRIB_TEXCOORD2,
        PBPrimitiveType.F32VEC3,
        12,
        'f32',
        3
    ],
    tex2_f32x4: [
        VERTEX_ATTRIB_TEXCOORD2,
        PBPrimitiveType.F32VEC4,
        16,
        'f32',
        4
    ],
    tex2_i32: [
        VERTEX_ATTRIB_TEXCOORD2,
        PBPrimitiveType.I32,
        4,
        'i32',
        1
    ],
    tex2_i32x2: [
        VERTEX_ATTRIB_TEXCOORD2,
        PBPrimitiveType.I32VEC2,
        8,
        'i32',
        2
    ],
    tex2_i32x3: [
        VERTEX_ATTRIB_TEXCOORD2,
        PBPrimitiveType.I32VEC3,
        12,
        'i32',
        3
    ],
    tex2_i32x4: [
        VERTEX_ATTRIB_TEXCOORD2,
        PBPrimitiveType.I32VEC4,
        16,
        'i32',
        4
    ],
    tex2_u32: [
        VERTEX_ATTRIB_TEXCOORD2,
        PBPrimitiveType.U32,
        4,
        'u32',
        1
    ],
    tex2_u32x2: [
        VERTEX_ATTRIB_TEXCOORD2,
        PBPrimitiveType.U32VEC2,
        8,
        'u32',
        2
    ],
    tex2_u32x3: [
        VERTEX_ATTRIB_TEXCOORD2,
        PBPrimitiveType.U32VEC3,
        12,
        'u32',
        3
    ],
    tex2_u32x4: [
        VERTEX_ATTRIB_TEXCOORD2,
        PBPrimitiveType.U32VEC4,
        16,
        'u32',
        4
    ],
    tex3_u8normx2: [
        VERTEX_ATTRIB_TEXCOORD3,
        PBPrimitiveType.U8VEC2_NORM,
        2,
        'u8norm',
        2
    ],
    tex3_u8normx4: [
        VERTEX_ATTRIB_TEXCOORD3,
        PBPrimitiveType.U8VEC4_NORM,
        4,
        'u8norm',
        4
    ],
    tex3_i8normx2: [
        VERTEX_ATTRIB_TEXCOORD3,
        PBPrimitiveType.I8VEC2_NORM,
        2,
        'i8norm',
        2
    ],
    tex3_i8normx4: [
        VERTEX_ATTRIB_TEXCOORD3,
        PBPrimitiveType.I8VEC4_NORM,
        4,
        'i8norm',
        4
    ],
    tex3_u16x2: [
        VERTEX_ATTRIB_TEXCOORD3,
        PBPrimitiveType.U16VEC2,
        4,
        'u16',
        2
    ],
    tex3_u16x4: [
        VERTEX_ATTRIB_TEXCOORD3,
        PBPrimitiveType.U16VEC4,
        8,
        'u16',
        4
    ],
    tex3_i16x2: [
        VERTEX_ATTRIB_TEXCOORD3,
        PBPrimitiveType.I16VEC2,
        4,
        'i16',
        2
    ],
    tex3_i16x4: [
        VERTEX_ATTRIB_TEXCOORD3,
        PBPrimitiveType.I16VEC4,
        8,
        'i16',
        4
    ],
    tex3_u16normx2: [
        VERTEX_ATTRIB_TEXCOORD3,
        PBPrimitiveType.U16VEC2_NORM,
        4,
        'u16norm',
        2
    ],
    tex3_u16normx4: [
        VERTEX_ATTRIB_TEXCOORD3,
        PBPrimitiveType.U16VEC4_NORM,
        8,
        'u16norm',
        4
    ],
    tex3_i16normx2: [
        VERTEX_ATTRIB_TEXCOORD3,
        PBPrimitiveType.I16VEC2_NORM,
        4,
        'i16norm',
        2
    ],
    tex3_i16normx4: [
        VERTEX_ATTRIB_TEXCOORD3,
        PBPrimitiveType.I16VEC4_NORM,
        8,
        'i16norm',
        4
    ],
    tex3_f16x2: [
        VERTEX_ATTRIB_TEXCOORD3,
        PBPrimitiveType.F16VEC2,
        4,
        'f16',
        2
    ],
    tex3_f16x4: [
        VERTEX_ATTRIB_TEXCOORD3,
        PBPrimitiveType.F16VEC4,
        8,
        'f16',
        4
    ],
    tex3_f32: [
        VERTEX_ATTRIB_TEXCOORD3,
        PBPrimitiveType.F32,
        4,
        'f32',
        1
    ],
    tex3_f32x2: [
        VERTEX_ATTRIB_TEXCOORD3,
        PBPrimitiveType.F32VEC2,
        8,
        'f32',
        2
    ],
    tex3_f32x3: [
        VERTEX_ATTRIB_TEXCOORD3,
        PBPrimitiveType.F32VEC3,
        12,
        'f32',
        3
    ],
    tex3_f32x4: [
        VERTEX_ATTRIB_TEXCOORD3,
        PBPrimitiveType.F32VEC4,
        16,
        'f32',
        4
    ],
    tex3_i32: [
        VERTEX_ATTRIB_TEXCOORD3,
        PBPrimitiveType.I32,
        4,
        'i32',
        1
    ],
    tex3_i32x2: [
        VERTEX_ATTRIB_TEXCOORD3,
        PBPrimitiveType.I32VEC2,
        8,
        'i32',
        2
    ],
    tex3_i32x3: [
        VERTEX_ATTRIB_TEXCOORD3,
        PBPrimitiveType.I32VEC3,
        12,
        'i32',
        3
    ],
    tex3_i32x4: [
        VERTEX_ATTRIB_TEXCOORD3,
        PBPrimitiveType.I32VEC4,
        16,
        'i32',
        4
    ],
    tex3_u32: [
        VERTEX_ATTRIB_TEXCOORD3,
        PBPrimitiveType.U32,
        4,
        'u32',
        1
    ],
    tex3_u32x2: [
        VERTEX_ATTRIB_TEXCOORD3,
        PBPrimitiveType.U32VEC2,
        8,
        'u32',
        2
    ],
    tex3_u32x3: [
        VERTEX_ATTRIB_TEXCOORD3,
        PBPrimitiveType.U32VEC3,
        12,
        'u32',
        3
    ],
    tex3_u32x4: [
        VERTEX_ATTRIB_TEXCOORD3,
        PBPrimitiveType.U32VEC4,
        16,
        'u32',
        4
    ],
    tex4_u8normx2: [
        VERTEX_ATTRIB_TEXCOORD4,
        PBPrimitiveType.U8VEC2_NORM,
        2,
        'u8norm',
        2
    ],
    tex4_u8normx4: [
        VERTEX_ATTRIB_TEXCOORD4,
        PBPrimitiveType.U8VEC4_NORM,
        4,
        'u8norm',
        4
    ],
    tex4_i8normx2: [
        VERTEX_ATTRIB_TEXCOORD4,
        PBPrimitiveType.I8VEC2_NORM,
        2,
        'i8norm',
        2
    ],
    tex4_i8normx4: [
        VERTEX_ATTRIB_TEXCOORD4,
        PBPrimitiveType.I8VEC4_NORM,
        4,
        'i8norm',
        4
    ],
    tex4_u16x2: [
        VERTEX_ATTRIB_TEXCOORD4,
        PBPrimitiveType.U16VEC2,
        4,
        'u16',
        2
    ],
    tex4_u16x4: [
        VERTEX_ATTRIB_TEXCOORD4,
        PBPrimitiveType.U16VEC4,
        8,
        'u16',
        4
    ],
    tex4_i16x2: [
        VERTEX_ATTRIB_TEXCOORD4,
        PBPrimitiveType.I16VEC2,
        4,
        'i16',
        2
    ],
    tex4_i16x4: [
        VERTEX_ATTRIB_TEXCOORD4,
        PBPrimitiveType.I16VEC4,
        8,
        'i16',
        4
    ],
    tex4_u16normx2: [
        VERTEX_ATTRIB_TEXCOORD4,
        PBPrimitiveType.U16VEC2_NORM,
        4,
        'u16norm',
        2
    ],
    tex4_u16normx4: [
        VERTEX_ATTRIB_TEXCOORD4,
        PBPrimitiveType.U16VEC4_NORM,
        8,
        'u16norm',
        4
    ],
    tex4_i16normx2: [
        VERTEX_ATTRIB_TEXCOORD4,
        PBPrimitiveType.I16VEC2_NORM,
        4,
        'i16norm',
        2
    ],
    tex4_i16normx4: [
        VERTEX_ATTRIB_TEXCOORD4,
        PBPrimitiveType.I16VEC4_NORM,
        8,
        'i16norm',
        4
    ],
    tex4_f16x2: [
        VERTEX_ATTRIB_TEXCOORD4,
        PBPrimitiveType.F16VEC2,
        4,
        'f16',
        2
    ],
    tex4_f16x4: [
        VERTEX_ATTRIB_TEXCOORD4,
        PBPrimitiveType.F16VEC4,
        8,
        'f16',
        4
    ],
    tex4_f32: [
        VERTEX_ATTRIB_TEXCOORD4,
        PBPrimitiveType.F32,
        4,
        'f32',
        1
    ],
    tex4_f32x2: [
        VERTEX_ATTRIB_TEXCOORD4,
        PBPrimitiveType.F32VEC2,
        8,
        'f32',
        2
    ],
    tex4_f32x3: [
        VERTEX_ATTRIB_TEXCOORD4,
        PBPrimitiveType.F32VEC3,
        12,
        'f32',
        3
    ],
    tex4_f32x4: [
        VERTEX_ATTRIB_TEXCOORD4,
        PBPrimitiveType.F32VEC4,
        16,
        'f32',
        4
    ],
    tex4_i32: [
        VERTEX_ATTRIB_TEXCOORD4,
        PBPrimitiveType.I32,
        4,
        'i32',
        1
    ],
    tex4_i32x2: [
        VERTEX_ATTRIB_TEXCOORD4,
        PBPrimitiveType.I32VEC2,
        8,
        'i32',
        2
    ],
    tex4_i32x3: [
        VERTEX_ATTRIB_TEXCOORD4,
        PBPrimitiveType.I32VEC3,
        12,
        'i32',
        3
    ],
    tex4_i32x4: [
        VERTEX_ATTRIB_TEXCOORD4,
        PBPrimitiveType.I32VEC4,
        16,
        'i32',
        4
    ],
    tex4_u32: [
        VERTEX_ATTRIB_TEXCOORD4,
        PBPrimitiveType.U32,
        4,
        'u32',
        1
    ],
    tex4_u32x2: [
        VERTEX_ATTRIB_TEXCOORD4,
        PBPrimitiveType.U32VEC2,
        8,
        'u32',
        2
    ],
    tex4_u32x3: [
        VERTEX_ATTRIB_TEXCOORD4,
        PBPrimitiveType.U32VEC3,
        12,
        'u32',
        3
    ],
    tex4_u32x4: [
        VERTEX_ATTRIB_TEXCOORD4,
        PBPrimitiveType.U32VEC4,
        16,
        'u32',
        4
    ],
    tex5_u8normx2: [
        VERTEX_ATTRIB_TEXCOORD5,
        PBPrimitiveType.U8VEC2_NORM,
        2,
        'u8norm',
        2
    ],
    tex5_u8normx4: [
        VERTEX_ATTRIB_TEXCOORD5,
        PBPrimitiveType.U8VEC4_NORM,
        4,
        'u8norm',
        4
    ],
    tex5_i8normx2: [
        VERTEX_ATTRIB_TEXCOORD5,
        PBPrimitiveType.I8VEC2_NORM,
        2,
        'i8norm',
        2
    ],
    tex5_i8normx4: [
        VERTEX_ATTRIB_TEXCOORD5,
        PBPrimitiveType.I8VEC4_NORM,
        4,
        'i8norm',
        4
    ],
    tex5_u16x2: [
        VERTEX_ATTRIB_TEXCOORD5,
        PBPrimitiveType.U16VEC2,
        4,
        'u16',
        2
    ],
    tex5_u16x4: [
        VERTEX_ATTRIB_TEXCOORD5,
        PBPrimitiveType.U16VEC4,
        8,
        'u16',
        4
    ],
    tex5_i16x2: [
        VERTEX_ATTRIB_TEXCOORD5,
        PBPrimitiveType.I16VEC2,
        4,
        'i16',
        2
    ],
    tex5_i16x4: [
        VERTEX_ATTRIB_TEXCOORD5,
        PBPrimitiveType.I16VEC4,
        8,
        'i16',
        4
    ],
    tex5_u16normx2: [
        VERTEX_ATTRIB_TEXCOORD5,
        PBPrimitiveType.U16VEC2_NORM,
        4,
        'u16norm',
        2
    ],
    tex5_u16normx4: [
        VERTEX_ATTRIB_TEXCOORD5,
        PBPrimitiveType.U16VEC4_NORM,
        8,
        'u16norm',
        4
    ],
    tex5_i16normx2: [
        VERTEX_ATTRIB_TEXCOORD5,
        PBPrimitiveType.I16VEC2_NORM,
        4,
        'i16norm',
        2
    ],
    tex5_i16normx4: [
        VERTEX_ATTRIB_TEXCOORD5,
        PBPrimitiveType.I16VEC4_NORM,
        8,
        'i16norm',
        4
    ],
    tex5_f16x2: [
        VERTEX_ATTRIB_TEXCOORD5,
        PBPrimitiveType.F16VEC2,
        4,
        'f16',
        2
    ],
    tex5_f16x4: [
        VERTEX_ATTRIB_TEXCOORD5,
        PBPrimitiveType.F16VEC4,
        8,
        'f16',
        4
    ],
    tex5_f32: [
        VERTEX_ATTRIB_TEXCOORD5,
        PBPrimitiveType.F32,
        4,
        'f32',
        1
    ],
    tex5_f32x2: [
        VERTEX_ATTRIB_TEXCOORD5,
        PBPrimitiveType.F32VEC2,
        8,
        'f32',
        2
    ],
    tex5_f32x3: [
        VERTEX_ATTRIB_TEXCOORD5,
        PBPrimitiveType.F32VEC3,
        12,
        'f32',
        3
    ],
    tex5_f32x4: [
        VERTEX_ATTRIB_TEXCOORD5,
        PBPrimitiveType.F32VEC4,
        16,
        'f32',
        4
    ],
    tex5_i32: [
        VERTEX_ATTRIB_TEXCOORD5,
        PBPrimitiveType.I32,
        4,
        'i32',
        1
    ],
    tex5_i32x2: [
        VERTEX_ATTRIB_TEXCOORD5,
        PBPrimitiveType.I32VEC2,
        8,
        'i32',
        2
    ],
    tex5_i32x3: [
        VERTEX_ATTRIB_TEXCOORD5,
        PBPrimitiveType.I32VEC3,
        12,
        'i32',
        3
    ],
    tex5_i32x4: [
        VERTEX_ATTRIB_TEXCOORD5,
        PBPrimitiveType.I32VEC4,
        16,
        'i32',
        4
    ],
    tex5_u32: [
        VERTEX_ATTRIB_TEXCOORD5,
        PBPrimitiveType.U32,
        4,
        'u32',
        1
    ],
    tex5_u32x2: [
        VERTEX_ATTRIB_TEXCOORD5,
        PBPrimitiveType.U32VEC2,
        8,
        'u32',
        2
    ],
    tex5_u32x3: [
        VERTEX_ATTRIB_TEXCOORD5,
        PBPrimitiveType.U32VEC3,
        12,
        'u32',
        3
    ],
    tex5_u32x4: [
        VERTEX_ATTRIB_TEXCOORD5,
        PBPrimitiveType.U32VEC4,
        16,
        'u32',
        4
    ],
    tex6_u8normx2: [
        VERTEX_ATTRIB_TEXCOORD6,
        PBPrimitiveType.U8VEC2_NORM,
        2,
        'u8norm',
        2
    ],
    tex6_u8normx4: [
        VERTEX_ATTRIB_TEXCOORD6,
        PBPrimitiveType.U8VEC4_NORM,
        4,
        'u8norm',
        4
    ],
    tex6_i8normx2: [
        VERTEX_ATTRIB_TEXCOORD6,
        PBPrimitiveType.I8VEC2_NORM,
        2,
        'i8norm',
        2
    ],
    tex6_i8normx4: [
        VERTEX_ATTRIB_TEXCOORD6,
        PBPrimitiveType.I8VEC4_NORM,
        4,
        'i8norm',
        4
    ],
    tex6_u16x2: [
        VERTEX_ATTRIB_TEXCOORD6,
        PBPrimitiveType.U16VEC2,
        4,
        'u16',
        2
    ],
    tex6_u16x4: [
        VERTEX_ATTRIB_TEXCOORD6,
        PBPrimitiveType.U16VEC4,
        8,
        'u16',
        4
    ],
    tex6_i16x2: [
        VERTEX_ATTRIB_TEXCOORD6,
        PBPrimitiveType.I16VEC2,
        4,
        'i16',
        2
    ],
    tex6_i16x4: [
        VERTEX_ATTRIB_TEXCOORD6,
        PBPrimitiveType.I16VEC4,
        8,
        'i16',
        4
    ],
    tex6_u16normx2: [
        VERTEX_ATTRIB_TEXCOORD6,
        PBPrimitiveType.U16VEC2_NORM,
        4,
        'u16norm',
        2
    ],
    tex6_u16normx4: [
        VERTEX_ATTRIB_TEXCOORD6,
        PBPrimitiveType.U16VEC4_NORM,
        8,
        'u16norm',
        4
    ],
    tex6_i16normx2: [
        VERTEX_ATTRIB_TEXCOORD6,
        PBPrimitiveType.I16VEC2_NORM,
        4,
        'i16norm',
        2
    ],
    tex6_i16normx4: [
        VERTEX_ATTRIB_TEXCOORD6,
        PBPrimitiveType.I16VEC4_NORM,
        8,
        'i16norm',
        4
    ],
    tex6_f16x2: [
        VERTEX_ATTRIB_TEXCOORD6,
        PBPrimitiveType.F16VEC2,
        4,
        'f16',
        2
    ],
    tex6_f16x4: [
        VERTEX_ATTRIB_TEXCOORD6,
        PBPrimitiveType.F16VEC4,
        8,
        'f16',
        4
    ],
    tex6_f32: [
        VERTEX_ATTRIB_TEXCOORD6,
        PBPrimitiveType.F32,
        4,
        'f32',
        1
    ],
    tex6_f32x2: [
        VERTEX_ATTRIB_TEXCOORD6,
        PBPrimitiveType.F32VEC2,
        8,
        'f32',
        2
    ],
    tex6_f32x3: [
        VERTEX_ATTRIB_TEXCOORD6,
        PBPrimitiveType.F32VEC3,
        12,
        'f32',
        3
    ],
    tex6_f32x4: [
        VERTEX_ATTRIB_TEXCOORD6,
        PBPrimitiveType.F32VEC4,
        16,
        'f32',
        4
    ],
    tex6_i32: [
        VERTEX_ATTRIB_TEXCOORD6,
        PBPrimitiveType.I32,
        4,
        'i32',
        1
    ],
    tex6_i32x2: [
        VERTEX_ATTRIB_TEXCOORD6,
        PBPrimitiveType.I32VEC2,
        8,
        'i32',
        2
    ],
    tex6_i32x3: [
        VERTEX_ATTRIB_TEXCOORD6,
        PBPrimitiveType.I32VEC3,
        12,
        'i32',
        3
    ],
    tex6_i32x4: [
        VERTEX_ATTRIB_TEXCOORD6,
        PBPrimitiveType.I32VEC4,
        16,
        'i32',
        4
    ],
    tex6_u32: [
        VERTEX_ATTRIB_TEXCOORD6,
        PBPrimitiveType.U32,
        4,
        'u32',
        1
    ],
    tex6_u32x2: [
        VERTEX_ATTRIB_TEXCOORD6,
        PBPrimitiveType.U32VEC2,
        8,
        'u32',
        2
    ],
    tex6_u32x3: [
        VERTEX_ATTRIB_TEXCOORD6,
        PBPrimitiveType.U32VEC3,
        12,
        'u32',
        3
    ],
    tex6_u32x4: [
        VERTEX_ATTRIB_TEXCOORD6,
        PBPrimitiveType.U32VEC4,
        16,
        'u32',
        4
    ],
    tex7_u8normx2: [
        VERTEX_ATTRIB_TEXCOORD7,
        PBPrimitiveType.U8VEC2_NORM,
        2,
        'u8norm',
        2
    ],
    tex7_u8normx4: [
        VERTEX_ATTRIB_TEXCOORD7,
        PBPrimitiveType.U8VEC4_NORM,
        4,
        'u8norm',
        4
    ],
    tex7_i8normx2: [
        VERTEX_ATTRIB_TEXCOORD7,
        PBPrimitiveType.I8VEC2_NORM,
        2,
        'i8norm',
        2
    ],
    tex7_i8normx4: [
        VERTEX_ATTRIB_TEXCOORD7,
        PBPrimitiveType.I8VEC4_NORM,
        4,
        'i8norm',
        4
    ],
    tex7_u16x2: [
        VERTEX_ATTRIB_TEXCOORD7,
        PBPrimitiveType.U16VEC2,
        4,
        'u16',
        2
    ],
    tex7_u16x4: [
        VERTEX_ATTRIB_TEXCOORD7,
        PBPrimitiveType.U16VEC4,
        8,
        'u16',
        4
    ],
    tex7_i16x2: [
        VERTEX_ATTRIB_TEXCOORD7,
        PBPrimitiveType.I16VEC2,
        4,
        'i16',
        2
    ],
    tex7_i16x4: [
        VERTEX_ATTRIB_TEXCOORD7,
        PBPrimitiveType.I16VEC4,
        8,
        'i16',
        4
    ],
    tex7_u16normx2: [
        VERTEX_ATTRIB_TEXCOORD7,
        PBPrimitiveType.U16VEC2_NORM,
        4,
        'u16norm',
        2
    ],
    tex7_u16normx4: [
        VERTEX_ATTRIB_TEXCOORD7,
        PBPrimitiveType.U16VEC4_NORM,
        8,
        'u16norm',
        4
    ],
    tex7_i16normx2: [
        VERTEX_ATTRIB_TEXCOORD7,
        PBPrimitiveType.I16VEC2_NORM,
        4,
        'i16norm',
        2
    ],
    tex7_i16normx4: [
        VERTEX_ATTRIB_TEXCOORD7,
        PBPrimitiveType.I16VEC4_NORM,
        8,
        'i16norm',
        4
    ],
    tex7_f16x2: [
        VERTEX_ATTRIB_TEXCOORD7,
        PBPrimitiveType.F16VEC2,
        4,
        'f16',
        2
    ],
    tex7_f16x4: [
        VERTEX_ATTRIB_TEXCOORD7,
        PBPrimitiveType.F16VEC4,
        8,
        'f16',
        4
    ],
    tex7_f32: [
        VERTEX_ATTRIB_TEXCOORD7,
        PBPrimitiveType.F32,
        4,
        'f32',
        1
    ],
    tex7_f32x2: [
        VERTEX_ATTRIB_TEXCOORD7,
        PBPrimitiveType.F32VEC2,
        8,
        'f32',
        2
    ],
    tex7_f32x3: [
        VERTEX_ATTRIB_TEXCOORD7,
        PBPrimitiveType.F32VEC3,
        12,
        'f32',
        3
    ],
    tex7_f32x4: [
        VERTEX_ATTRIB_TEXCOORD7,
        PBPrimitiveType.F32VEC4,
        16,
        'f32',
        4
    ],
    tex7_i32: [
        VERTEX_ATTRIB_TEXCOORD7,
        PBPrimitiveType.I32,
        4,
        'i32',
        1
    ],
    tex7_i32x2: [
        VERTEX_ATTRIB_TEXCOORD7,
        PBPrimitiveType.I32VEC2,
        8,
        'i32',
        2
    ],
    tex7_i32x3: [
        VERTEX_ATTRIB_TEXCOORD7,
        PBPrimitiveType.I32VEC3,
        12,
        'i32',
        3
    ],
    tex7_i32x4: [
        VERTEX_ATTRIB_TEXCOORD7,
        PBPrimitiveType.I32VEC4,
        16,
        'i32',
        4
    ],
    tex7_u32: [
        VERTEX_ATTRIB_TEXCOORD7,
        PBPrimitiveType.U32,
        4,
        'u32',
        1
    ],
    tex7_u32x2: [
        VERTEX_ATTRIB_TEXCOORD7,
        PBPrimitiveType.U32VEC2,
        8,
        'u32',
        2
    ],
    tex7_u32x3: [
        VERTEX_ATTRIB_TEXCOORD7,
        PBPrimitiveType.U32VEC3,
        12,
        'u32',
        3
    ],
    tex7_u32x4: [
        VERTEX_ATTRIB_TEXCOORD7,
        PBPrimitiveType.U32VEC4,
        16,
        'u32',
        4
    ],
    blendweights_f16x4: [
        VERTEX_ATTRIB_BLEND_WEIGHT,
        PBPrimitiveType.F16VEC4,
        8,
        'f16',
        4
    ],
    blendweights_f32x4: [
        VERTEX_ATTRIB_BLEND_WEIGHT,
        PBPrimitiveType.F32VEC4,
        16,
        'f32',
        4
    ],
    blendindices_u16x4: [
        VERTEX_ATTRIB_BLEND_INDICES,
        PBPrimitiveType.U16VEC4,
        8,
        'u16',
        4
    ],
    blendindices_f16x4: [
        VERTEX_ATTRIB_BLEND_INDICES,
        PBPrimitiveType.F16VEC4,
        8,
        'f16',
        4
    ],
    blendindices_f32x4: [
        VERTEX_ATTRIB_BLEND_INDICES,
        PBPrimitiveType.F32VEC4,
        16,
        'f32',
        4
    ],
    blendindices_u32x4: [
        VERTEX_ATTRIB_BLEND_INDICES,
        PBPrimitiveType.U32VEC4,
        16,
        'u32',
        4
    ]
};
const vertexAttribNameMap = {
    position: VERTEX_ATTRIB_POSITION,
    normal: VERTEX_ATTRIB_NORMAL,
    diffuse: VERTEX_ATTRIB_DIFFUSE,
    tangent: VERTEX_ATTRIB_TANGENT,
    blendIndices: VERTEX_ATTRIB_BLEND_INDICES,
    blendWeights: VERTEX_ATTRIB_BLEND_WEIGHT,
    texCoord0: VERTEX_ATTRIB_TEXCOORD0,
    texCoord1: VERTEX_ATTRIB_TEXCOORD1,
    texCoord2: VERTEX_ATTRIB_TEXCOORD2,
    texCoord3: VERTEX_ATTRIB_TEXCOORD3,
    texCoord4: VERTEX_ATTRIB_TEXCOORD4,
    texCoord5: VERTEX_ATTRIB_TEXCOORD5,
    texCoord6: VERTEX_ATTRIB_TEXCOORD6,
    texCoord7: VERTEX_ATTRIB_TEXCOORD7
};
const vertexAttribNameRevMap = {
    [VERTEX_ATTRIB_POSITION]: 'position',
    [VERTEX_ATTRIB_NORMAL]: 'normal',
    [VERTEX_ATTRIB_DIFFUSE]: 'diffuse',
    [VERTEX_ATTRIB_TANGENT]: 'tangent',
    [VERTEX_ATTRIB_BLEND_INDICES]: 'blendIndices',
    [VERTEX_ATTRIB_BLEND_WEIGHT]: 'blendWeights',
    [VERTEX_ATTRIB_TEXCOORD0]: 'texCoord0',
    [VERTEX_ATTRIB_TEXCOORD1]: 'texCoord1',
    [VERTEX_ATTRIB_TEXCOORD2]: 'texCoord2',
    [VERTEX_ATTRIB_TEXCOORD3]: 'texCoord3',
    [VERTEX_ATTRIB_TEXCOORD4]: 'texCoord4',
    [VERTEX_ATTRIB_TEXCOORD5]: 'texCoord5',
    [VERTEX_ATTRIB_TEXCOORD6]: 'texCoord6',
    [VERTEX_ATTRIB_TEXCOORD7]: 'texCoord7'
};
var GPUResourceUsageFlags;
(function(GPUResourceUsageFlags) {
    GPUResourceUsageFlags[GPUResourceUsageFlags["TF_LINEAR_COLOR_SPACE"] = 2] = "TF_LINEAR_COLOR_SPACE";
    GPUResourceUsageFlags[GPUResourceUsageFlags["TF_NO_MIPMAP"] = 4] = "TF_NO_MIPMAP";
    GPUResourceUsageFlags[GPUResourceUsageFlags["TF_WRITABLE"] = 8] = "TF_WRITABLE";
    GPUResourceUsageFlags[GPUResourceUsageFlags["TF_NO_GC"] = 16] = "TF_NO_GC";
    GPUResourceUsageFlags[GPUResourceUsageFlags["BF_VERTEX"] = 32] = "BF_VERTEX";
    GPUResourceUsageFlags[GPUResourceUsageFlags["BF_INDEX"] = 64] = "BF_INDEX";
    GPUResourceUsageFlags[GPUResourceUsageFlags["BF_READ"] = 128] = "BF_READ";
    GPUResourceUsageFlags[GPUResourceUsageFlags["BF_WRITE"] = 256] = "BF_WRITE";
    GPUResourceUsageFlags[GPUResourceUsageFlags["BF_UNIFORM"] = 512] = "BF_UNIFORM";
    GPUResourceUsageFlags[GPUResourceUsageFlags["BF_STORAGE"] = 1024] = "BF_STORAGE";
    GPUResourceUsageFlags[GPUResourceUsageFlags["DYNAMIC"] = 2048] = "DYNAMIC";
    GPUResourceUsageFlags[GPUResourceUsageFlags["MANAGED"] = 4096] = "MANAGED";
})(GPUResourceUsageFlags || (GPUResourceUsageFlags = {}));
/**
 * Get vertex attribute index by semantic
 * @internal
 */ function getVertexAttribByName(name) {
    return vertexAttribNameMap[name];
}
/**
 * Get vertex semantic by attribute index
 * @internal
 */ function getVertexAttribName(attrib) {
    return vertexAttribNameRevMap[attrib];
}
/**
 * Get byte size of specified vertex format
 * @internal
 */ function getVertexFormatSize(fmt) {
    return vertexAttribFormatMap[fmt][2];
}
/**
 * Get vertex format by semantic and component type and component count
 * @param semantic - The vertex semantic
 * @param type - Data type of vertex component
 * @param count - The count of vertex components
 * @returns Vertex format
 * @public
 */ function getVertexAttribFormat(semantic, type, count) {
    const loc = getVertexAttribByName(semantic);
    for(const k in vertexAttribFormatMap){
        const v = vertexAttribFormatMap[k];
        if (v[0] === loc && v[3] === type && v[4] === count) {
            return k;
        }
    }
    return null;
}
/**
 * Get byte stride of a vertex buffer by specified structure type of the vertex buffer
 * @param vertexBufferType - The structure type of the vertex buffer
 * @returns The byte stride of the vertex buffer
 * @public
 */ function getVertexBufferStride(vertexBufferType) {
    const vertexType = vertexBufferType.structMembers[0].type.elementType;
    if (vertexType.isStructType()) {
        let stride = 0;
        for (const member of vertexType.structMembers){
            stride += member.type.getSize();
        }
        return stride;
    } else {
        return vertexType.getSize();
    }
}
/**
 * Get primitive type of a vertex attribute by specified vertex semantic
 * @param vertexBufferType - The structure type of the vertex buffer
 * @param semantic - The vertex semantic
 * @returns - The primitive type of the vertex attribute
 * @public
 */ function getVertexBufferAttribTypeBySemantic(vertexBufferType, semantic) {
    const k = vertexBufferType.structMembers[0];
    const vertexType = k.type.elementType;
    if (vertexType.isStructType()) {
        for (const member of vertexType.structMembers){
            if (member.name === semantic) {
                return member.type;
            }
        }
        return null;
    } else {
        return k.name === semantic ? vertexType : null;
    }
}
/**
 * Get primitive type of a vertex attribute by specified vertex attribute index
 * @param vertexBufferType - The structure type of the vertex buffer
 * @param semantic - The vertex attribute index
 * @returns - The primitive type of the vertex attribute
 * @public
 */ function getVertexBufferAttribType(vertexBufferType, attrib) {
    const attribName = getVertexAttribName(attrib);
    if (!attribName) {
        return null;
    }
    return getVertexBufferAttribTypeBySemantic(vertexBufferType, attribName);
}
/**
 * Get the structure type of a vertex buffer by specified vertex attribute formats and the length of the vertex buffer
 * @param length - The length of the vertex buffer
 * @param attributes - The vertex attributes
 * @returns The structure type of the vertex buffer
 * @public
 */ function makeVertexBufferType(length, ...attributes) {
    if (attributes.length === 0) {
        return null;
    }
    if (attributes.length === 1) {
        const format = vertexAttribFormatMap[attributes[0]];
        return new PBStructTypeInfo(null, 'packed', [
            {
                name: getVertexAttribName(format[0]),
                type: new PBArrayTypeInfo(PBPrimitiveTypeInfo.getCachedTypeInfo(format[1]), length)
            }
        ]);
    } else {
        const vertexType = new PBStructTypeInfo(null, 'packed', attributes.map((attrib)=>({
                name: getVertexAttribName(vertexAttribFormatMap[attrib][0]),
                type: PBPrimitiveTypeInfo.getCachedTypeInfo(vertexAttribFormatMap[attrib][1])
            })));
        return new PBStructTypeInfo(null, 'packed', [
            {
                name: 'value',
                type: new PBArrayTypeInfo(vertexType, length)
            }
        ]);
    }
}
/**
 * Vertex semantic list
 * @public
 */ const semanticList = function() {
    const list = [];
    for(let i = 0; i < MAX_VERTEX_ATTRIBUTES; i++){
        list.push(semanticToAttrib(i));
    }
    return list;
}();
/** @internal */ function semanticToAttrib(semantic) {
    switch(semantic){
        case VERTEX_ATTRIB_POSITION:
            return 'a_position';
        case VERTEX_ATTRIB_NORMAL:
            return 'a_normal';
        case VERTEX_ATTRIB_DIFFUSE:
            return 'a_diffuse';
        case VERTEX_ATTRIB_TANGENT:
            return 'a_tangent';
        case VERTEX_ATTRIB_TEXCOORD0:
            return 'a_texcoord0';
        case VERTEX_ATTRIB_TEXCOORD1:
            return 'a_texcoord1';
        case VERTEX_ATTRIB_TEXCOORD2:
            return 'a_texcoord2';
        case VERTEX_ATTRIB_TEXCOORD3:
            return 'a_texcoord3';
        case VERTEX_ATTRIB_TEXCOORD4:
            return 'a_texcoord4';
        case VERTEX_ATTRIB_TEXCOORD5:
            return 'a_texcoord5';
        case VERTEX_ATTRIB_TEXCOORD6:
            return 'a_texcoord6';
        case VERTEX_ATTRIB_TEXCOORD7:
            return 'a_texcoord7';
        case VERTEX_ATTRIB_BLEND_INDICES:
            return 'a_indices';
        case VERTEX_ATTRIB_BLEND_WEIGHT:
            return 'a_weight';
        default:
            return null;
    }
}
/**
 * Creates the default name for the type of given gpu object
 * @param obj - The gpu object
 * @returns The default name
 * @public
 */ function genDefaultName(obj) {
    if (obj.isTexture2D()) {
        return 'texture_2d';
    } else if (obj.isTexture2DArray()) {
        return 'texture_2darray';
    } else if (obj.isTexture3D()) {
        return 'texture_3d';
    } else if (obj.isTextureCube()) {
        return 'texture_cube';
    } else if (obj.isTextureVideo()) {
        return 'texture_video';
    } else if (obj.isBuffer()) {
        return 'buffer';
    } else if (obj.isFramebuffer()) {
        return 'framebuffer';
    } else if (obj.isProgram()) {
        return 'program';
    } else if (obj.isSampler()) {
        return 'sampler';
    } else if (obj.isVertexLayout()) {
        return 'vbo';
    } else {
        return 'unknown';
    }
}

/**
 * The vertex data class
 * @public
 */ class VertexData {
    /** @internal */ _vertexBuffers;
    /** @internal */ _indexBuffer;
    /** @internal */ _drawOffset;
    constructor(){
        this._vertexBuffers = [];
        for(let i = 0; i < MAX_VERTEX_ATTRIBUTES; i++){
            this._vertexBuffers.push(null);
        }
        this._indexBuffer = null;
        this._drawOffset = 0;
    }
    /**
   * Creates a new instance of VertexData by copying from this object
   * @returns New instance of VertexData
   */ clone() {
        const newVertexData = new VertexData();
        newVertexData._vertexBuffers = this._vertexBuffers.slice();
        newVertexData._indexBuffer = this._indexBuffer;
        newVertexData._drawOffset = this._drawOffset;
        return newVertexData;
    }
    /** Vertex buffer information list */ get vertexBuffers() {
        return this._vertexBuffers;
    }
    /** Index buffer */ get indexBuffer() {
        return this._indexBuffer;
    }
    /** Draw offset */ getDrawOffset() {
        return this._drawOffset;
    }
    setDrawOffset(offset) {
        if (offset !== this._drawOffset) {
            this._drawOffset = offset;
        }
    }
    /**
   * Gets the vertex buffer by specific vertex semantic
   * @param semantic - The vertex semantic
   * @returns Vertex buffer of the given semantic
   */ getVertexBuffer(semantic) {
        return this._vertexBuffers[getVertexAttribByName(semantic)]?.buffer ?? null;
    }
    /**
   * Gets the vertex buffer information by specific vertex semantic
   * @param semantic - The vertex semantic
   * @returns Vertex buffer information of the given semantic
   */ getVertexBufferInfo(semantic) {
        return this._vertexBuffers[getVertexAttribByName(semantic)] ?? null;
    }
    /**
   * Gets the index buffer
   * @returns The index buffer
   */ getIndexBuffer() {
        return this._indexBuffer || null;
    }
    /**
   * Sets a vertex buffer
   * @param buffer - The vertex buffer object
   * @param stepMode - Step mode of the buffer
   * @returns The buffer that was set
   */ setVertexBuffer(buffer, stepMode) {
        if (!buffer || !(buffer.usage & GPUResourceUsageFlags.BF_VERTEX)) {
            throw new Error('setVertexBuffer() failed: buffer is null or buffer has not Vertex usage flag');
        }
        stepMode = stepMode || 'vertex';
        const vertexType = buffer.structure.structMembers[0].type.elementType;
        if (vertexType.isStructType()) {
            let offset = 0;
            for (const attrib of vertexType.structMembers){
                const loc = getVertexAttribByName(attrib.name);
                this.internalSetVertexBuffer(loc, buffer, offset, stepMode);
                offset += attrib.size;
            }
        } else {
            const loc = getVertexAttribByName(buffer.structure.structMembers[0].name);
            this.internalSetVertexBuffer(loc, buffer, 0, stepMode);
        }
        return buffer;
    }
    /**
   * Removes a vertex buffer
   * @param buffer - Vertex buffer to be removed
   * @returns true if the buffer was successfully removed, otherwise false
   */ removeVertexBuffer(buffer) {
        let removed = false;
        for(let loc = 0; loc < this._vertexBuffers.length; loc++){
            const info = this._vertexBuffers[loc];
            const remove = info?.buffer === buffer;
            if (remove) {
                this._vertexBuffers[loc] = null;
                removed = true;
            }
        }
        return removed;
    }
    /**
   * Sets the index buffer
   * @param buffer - Index buffer to be set
   * @returns The index buffer that was set
   */ setIndexBuffer(buffer) {
        if (buffer !== this._indexBuffer) {
            this._indexBuffer = buffer || null;
        }
        return buffer;
    }
    /** @internal */ internalSetVertexBuffer(loc, buffer, offset, stepMode) {
        if (loc < 0 || loc >= MAX_VERTEX_ATTRIBUTES) {
            throw new Error(`setVertexBuffer() failed: location out of bounds: ${loc}`);
        }
        offset = Number(offset) || 0;
        stepMode = stepMode || 'vertex';
        const old = this._vertexBuffers[loc];
        if (!old || old.buffer !== buffer || old.offset !== offset || old.stepMode !== stepMode) {
            this._vertexBuffers[loc] = {
                buffer: buffer,
                offset: offset,
                type: getVertexBufferAttribType(buffer.structure, loc),
                stride: getVertexBufferStride(buffer.structure),
                drawOffset: 0,
                stepMode: stepMode
            };
            return buffer;
        }
        return null;
    }
}

/**
 * Abstract timer interface
 * @public
 */ /**
 * CPU timer class
 * @public
 */ class CPUTimer {
    /** @internal */ _cpuTimer;
    /** @internal */ _cpuStart;
    /** @internal */ _cpuTime;
    /** @internal */ _ended;
    constructor(){
        this._cpuTimer = window.performance || window.Date;
        this._cpuTime = null;
        this._ended = false;
    }
    now() {
        return this._cpuTimer.now();
    }
    begin() {
        this._cpuStart = this.now();
        this._cpuTime = null;
        this._ended = false;
    }
    end() {
        this._cpuTime = this.now() - this._cpuStart;
        this._ended = true;
    }
    ended() {
        return this._ended;
    }
    elapsed() {
        return this._cpuTime;
    }
}

/** @internal */ function expValueToString(deviceType, value) {
    if (typeof value === 'number' || typeof value === 'boolean' || Array.isArray(value)) {
        return `${value}`;
    } else {
        return value.$ast?.toString(deviceType);
    }
}
/** @internal */ function expValueTypeToString(deviceType, type) {
    return type?.toTypeName(deviceType);
}
/** @internal */ class PBError extends Error {
}
/** @internal */ class PBValueOutOfRange extends PBError {
    value;
    constructor(value){
        super();
        this.value = value;
    }
    getMessage(deviceType) {
        return `value out of range: ${this.value}`;
    }
}
/** @internal */ class PBTypeCastError extends PBError {
    value;
    valueType;
    expectedType;
    constructor(value, valueType, expectedType){
        super();
        this.value = value;
        this.valueType = valueType;
        this.expectedType = expectedType;
    }
    getMessage(deviceType) {
        const valueStr = typeof this.value === 'string' ? this.value : expValueToString(deviceType, this.value);
        const valueTypeStr = typeof this.valueType === 'string' ? this.valueType : expValueTypeToString(deviceType, this.valueType);
        const expectedTypeStr = typeof this.expectedType === 'string' ? this.expectedType : expValueTypeToString(deviceType, this.expectedType);
        return `cannot convert '${valueStr}' of type '${valueTypeStr}' to type ${expectedTypeStr}`;
    }
}
/** @internal */ class PBParamLengthError extends PBError {
    func;
    constructor(func){
        super();
        this.func = func;
    }
    getMessage(deviceType) {
        return `wrong argument count for function '${this.func}'`;
    }
}
/** @internal */ class PBParamTypeError extends PBError {
    func;
    param;
    constructor(func, param){
        super();
        this.func = func;
        this.param = param || null;
    }
    getMessage(deviceType) {
        return `parameter type error for function '${this.func}': ${this.param}`;
    }
}
/** @internal */ class PBParamValueError extends PBError {
    func;
    param;
    reason;
    constructor(func, param, reason){
        super();
        this.func = func;
        this.param = param || null;
        this.reason = reason || null;
    }
    getMessage(deviceType) {
        return `invalid parameter value for function '${this.func}'${this.param ? ': ' + this.param : ''}${this.reason ? ': ' + this.reason : ''}}`;
    }
}
/** @internal */ class PBOverloadingMatchError extends PBError {
    func;
    constructor(func){
        super();
        this.func = func;
    }
    getMessage(deviceType) {
        return `No matched overloading found for function '${this.func}'`;
    }
}
/** @internal */ class PBReferenceValueRequired extends PBError {
    value;
    constructor(value){
        super();
        this.value = value;
    }
    getMessage(deviceType) {
        return `'${expValueToString(deviceType, this.value)}' is not a reference type`;
    }
}
/** @internal */ class PBPointerValueRequired extends PBError {
    value;
    constructor(value){
        super();
        this.value = value;
    }
    getMessage(deviceType) {
        return `'${expValueToString(deviceType, this.value)}' is not a pointer type`;
    }
}
/** @internal */ class PBDeviceNotSupport extends PBError {
    feature;
    constructor(feature){
        super();
        this.feature = feature;
    }
    getMessage(deviceType) {
        return `feature not support for ${deviceType} device: ${this.feature}`;
    }
}
/** @internal */ class PBNonScopedFunctionCall extends PBError {
    funcName;
    constructor(funcName){
        super();
        this.funcName = funcName;
    }
    getMessage(deviceType) {
        return `function call must be made inside a function scope: ${this.funcName}()`;
    }
}
/** @internal */ class PBASTError extends PBError {
    ast;
    text;
    constructor(ast, text){
        super();
        this.ast = ast;
        this.text = text;
    }
    getMessage(deviceType) {
        return `${this.text}: ${this.ast.toString(deviceType)}`;
    }
}
/** @internal */ class PBInternalError extends PBError {
    constructor(desc){
        super(desc);
    }
    getMessage(deviceType) {
        return `Internal error: ${this.message}`;
    }
}

const BuiltinInputStructNameVS = 'zVSInput';
const BuiltinOutputStructNameVS = 'zVSOutput';
const BuiltinInputStructNameFS = 'zFSInput';
const BuiltinOutputStructNameFS = 'zFSOutput';
const BuiltinInputStructNameCS = 'zCSInput';
const BuiltinOutputStructNameCS = 'zCSOutput';
const BuiltinParamNameVS = 'zVertexInput';
const BuiltinParamNameFS = 'zVertexOutput';
const BuiltinParamNameCS = 'zComputeInput';
const BuiltinInputStructInstanceNameVS = 'zVSInputCpy';
const BuiltinOutputStructInstanceNameVS = 'zVSOutputCpy';
const BuiltinInputStructInstanceNameFS = 'zFSInputCpy';
const BuiltinOutputStructInstanceNameFS = 'zFSOutputCpy';
const BuiltinInputStructInstanceNameCS = 'zCSInputCpy';
const BuiltinOutputStructInstanceNameCS = 'zCSOutputCpy';
var DeclareType;
(function(DeclareType) {
    DeclareType[DeclareType["DECLARE_TYPE_NONE"] = 0] = "DECLARE_TYPE_NONE";
    DeclareType[DeclareType["DECLARE_TYPE_IN"] = 1] = "DECLARE_TYPE_IN";
    DeclareType[DeclareType["DECLARE_TYPE_OUT"] = 2] = "DECLARE_TYPE_OUT";
    DeclareType[DeclareType["DECLARE_TYPE_WORKGROUP"] = 3] = "DECLARE_TYPE_WORKGROUP";
    DeclareType[DeclareType["DECLARE_TYPE_UNIFORM"] = 4] = "DECLARE_TYPE_UNIFORM";
    DeclareType[DeclareType["DECLARE_TYPE_STORAGE"] = 5] = "DECLARE_TYPE_STORAGE";
})(DeclareType || (DeclareType = {}));
var ShaderPrecisionType;
(function(ShaderPrecisionType) {
    ShaderPrecisionType[ShaderPrecisionType["NONE"] = 0] = "NONE";
    ShaderPrecisionType[ShaderPrecisionType["HIGH"] = 1] = "HIGH";
    ShaderPrecisionType[ShaderPrecisionType["MEDIUM"] = 2] = "MEDIUM";
    ShaderPrecisionType[ShaderPrecisionType["LOW"] = 3] = "LOW";
})(ShaderPrecisionType || (ShaderPrecisionType = {}));
/** @internal */ function getBuiltinParamName(shaderType) {
    switch(shaderType){
        case ShaderType.Vertex:
            return BuiltinParamNameVS;
        case ShaderType.Fragment:
            return BuiltinParamNameFS;
        case ShaderType.Compute:
            return BuiltinParamNameCS;
        default:
            return null;
    }
}
/** @internal */ function getBuiltinInputStructInstanceName(shaderType) {
    switch(shaderType){
        case ShaderType.Vertex:
            return BuiltinInputStructInstanceNameVS;
        case ShaderType.Fragment:
            return BuiltinInputStructInstanceNameFS;
        case ShaderType.Compute:
            return BuiltinInputStructInstanceNameCS;
        default:
            return null;
    }
}
/** @internal */ function getBuiltinOutputStructInstanceName(shaderType) {
    switch(shaderType){
        case ShaderType.Vertex:
            return BuiltinOutputStructInstanceNameVS;
        case ShaderType.Fragment:
            return BuiltinOutputStructInstanceNameFS;
        case ShaderType.Compute:
            return BuiltinOutputStructInstanceNameCS;
        default:
            return null;
    }
}
/** @internal */ function getBuiltinInputStructName(shaderType) {
    switch(shaderType){
        case ShaderType.Vertex:
            return BuiltinInputStructNameVS;
        case ShaderType.Fragment:
            return BuiltinInputStructNameFS;
        case ShaderType.Compute:
            return BuiltinInputStructNameCS;
        default:
            return null;
    }
}
/** @internal */ function getBuiltinOutputStructName(shaderType) {
    switch(shaderType){
        case ShaderType.Vertex:
            return BuiltinOutputStructNameVS;
        case ShaderType.Fragment:
            return BuiltinOutputStructNameFS;
        case ShaderType.Compute:
            return BuiltinOutputStructNameCS;
        default:
            return null;
    }
}
/** @internal */ function getTextureSampleType(type) {
    switch(type.textureType){
        case PBTextureType.TEX_1D:
        case PBTextureType.TEX_STORAGE_1D:
        case PBTextureType.TEX_2D:
        case PBTextureType.TEX_STORAGE_2D:
        case PBTextureType.TEX_2D_ARRAY:
        case PBTextureType.TEX_STORAGE_2D_ARRAY:
        case PBTextureType.TEX_3D:
        case PBTextureType.TEX_STORAGE_3D:
        case PBTextureType.TEX_CUBE:
        case PBTextureType.TEX_EXTERNAL:
            return new PBPrimitiveTypeInfo(PBPrimitiveType.F32VEC4);
        case PBTextureType.TEX_DEPTH_2D_ARRAY:
        case PBTextureType.TEX_DEPTH_2D:
        case PBTextureType.TEX_DEPTH_CUBE:
            return new PBPrimitiveTypeInfo(PBPrimitiveType.F32);
        case PBTextureType.ITEX_2D_ARRAY:
        case PBTextureType.ITEX_1D:
        case PBTextureType.ITEX_2D:
        case PBTextureType.ITEX_3D:
        case PBTextureType.ITEX_CUBE:
            return new PBPrimitiveTypeInfo(PBPrimitiveType.I32);
        case PBTextureType.UTEX_2D_ARRAY:
        case PBTextureType.UTEX_1D:
        case PBTextureType.UTEX_2D:
        case PBTextureType.UTEX_3D:
        case PBTextureType.UTEX_CUBE:
            return new PBPrimitiveTypeInfo(PBPrimitiveType.U32);
        default:
            return null;
    }
}
/** @internal */ function genSamplerName(textureName, comparison) {
    return `ch_auto_sampler_${textureName}${comparison ? '_comparison' : ''}`;
}
/** @internal */ const builtinVariables = {
    webgl: {
        position: {
            name: 'gl_Position',
            type: new PBPrimitiveTypeInfo(PBPrimitiveType.F32VEC4),
            stage: 'vertex'
        },
        pointSize: {
            name: 'gl_PointSize',
            type: new PBPrimitiveTypeInfo(PBPrimitiveType.F32),
            stage: 'vertex'
        },
        fragCoord: {
            name: 'gl_FragCoord',
            type: new PBPrimitiveTypeInfo(PBPrimitiveType.F32VEC4),
            stage: 'fragment'
        },
        frontFacing: {
            name: 'gl_FrontFacing',
            type: new PBPrimitiveTypeInfo(PBPrimitiveType.BOOL),
            stage: 'fragment'
        },
        fragDepth: {
            name: 'gl_FragDepthEXT',
            type: new PBPrimitiveTypeInfo(PBPrimitiveType.F32),
            inOrOut: 'out',
            extension: 'GL_EXT_frag_depth',
            stage: 'fragment'
        }
    },
    webgl2: {
        vertexIndex: {
            name: 'gl_VertexID',
            semantic: 'vertex_index',
            type: new PBPrimitiveTypeInfo(PBPrimitiveType.U32),
            inOrOut: 'in',
            stage: 'vertex'
        },
        instanceIndex: {
            name: 'gl_InstanceID',
            semantic: 'instance_index',
            type: new PBPrimitiveTypeInfo(PBPrimitiveType.U32),
            inOrOut: 'in',
            stage: 'vertex'
        },
        position: {
            name: 'gl_Position',
            type: new PBPrimitiveTypeInfo(PBPrimitiveType.F32VEC4),
            stage: 'vertex'
        },
        pointSize: {
            name: 'gl_PointSize',
            type: new PBPrimitiveTypeInfo(PBPrimitiveType.F32),
            stage: 'vertex'
        },
        fragCoord: {
            name: 'gl_FragCoord',
            type: new PBPrimitiveTypeInfo(PBPrimitiveType.F32VEC4),
            stage: 'fragment'
        },
        frontFacing: {
            name: 'gl_FrontFacing',
            type: new PBPrimitiveTypeInfo(PBPrimitiveType.BOOL),
            stage: 'fragment'
        },
        fragDepth: {
            name: 'gl_FragDepth',
            type: new PBPrimitiveTypeInfo(PBPrimitiveType.F32),
            stage: 'fragment'
        }
    },
    webgpu: {
        vertexIndex: {
            name: 'zVertexId',
            semantic: 'vertex_index',
            type: new PBPrimitiveTypeInfo(PBPrimitiveType.U32),
            inOrOut: 'in',
            stage: 'vertex'
        },
        instanceIndex: {
            name: 'zInstanceId',
            semantic: 'instance_index',
            type: new PBPrimitiveTypeInfo(PBPrimitiveType.U32),
            inOrOut: 'in',
            stage: 'vertex'
        },
        position: {
            name: 'zPosition',
            semantic: 'position',
            type: new PBPrimitiveTypeInfo(PBPrimitiveType.F32VEC4),
            inOrOut: 'out',
            stage: 'vertex'
        },
        fragCoord: {
            name: 'zFragCoord',
            semantic: 'position',
            type: new PBPrimitiveTypeInfo(PBPrimitiveType.F32VEC4),
            inOrOut: 'in',
            stage: 'fragment'
        },
        frontFacing: {
            name: 'zFrontFacing',
            semantic: 'front_facing',
            type: new PBPrimitiveTypeInfo(PBPrimitiveType.BOOL),
            inOrOut: 'in',
            stage: 'fragment'
        },
        fragDepth: {
            name: 'zFragDepth',
            semantic: 'frag_depth',
            type: new PBPrimitiveTypeInfo(PBPrimitiveType.F32),
            inOrOut: 'out',
            stage: 'fragment'
        },
        localInvocationId: {
            name: 'zLocalInvocationId',
            semantic: 'local_invocation_id',
            type: new PBPrimitiveTypeInfo(PBPrimitiveType.U32VEC3),
            inOrOut: 'in',
            stage: 'compute'
        },
        globalInvocationId: {
            name: 'zGlobalInvocationId',
            semantic: 'global_invocation_id',
            type: new PBPrimitiveTypeInfo(PBPrimitiveType.U32VEC3),
            inOrOut: 'in',
            stage: 'compute'
        },
        workGroupId: {
            name: 'zWorkGroupId',
            semantic: 'workgroup_id',
            type: new PBPrimitiveTypeInfo(PBPrimitiveType.U32VEC3),
            inOrOut: 'in',
            stage: 'compute'
        },
        numWorkGroups: {
            name: 'zNumWorkGroups',
            semantic: 'num_workgroups',
            type: new PBPrimitiveTypeInfo(PBPrimitiveType.U32VEC3),
            inOrOut: 'in',
            stage: 'compute'
        },
        sampleMaskIn: {
            name: 'zSampleMaskIn',
            semantic: 'sample_mask_in',
            type: new PBPrimitiveTypeInfo(PBPrimitiveType.U32),
            inOrOut: 'in',
            stage: 'fragment'
        },
        sampleMaskOut: {
            name: 'zSampleMaskOut',
            semantic: 'sample_mask_out',
            type: new PBPrimitiveTypeInfo(PBPrimitiveType.U32),
            inOrOut: 'out',
            stage: 'fragment'
        },
        sampleIndex: {
            name: 'zSampleIndex',
            semantic: 'sample_index',
            type: new PBPrimitiveTypeInfo(PBPrimitiveType.U32),
            inOrOut: 'in',
            stage: 'fragment'
        }
    }
};
function toFixed(n) {
    return n % 1 === 0 ? n.toFixed(1) : String(n);
}
function toInt(n) {
    return String(n | 0);
}
function toUint(n) {
    return String(n >>> 0);
}
function unbracket(e) {
    e = e.trim();
    if (e[0] === '(' && e[e.length - 1] === ')') {
        let match = 0;
        for(let i = 1; i < e.length - 1; i++){
            if (e[i] === '(') {
                match++;
            } else if (e[i] === ')') {
                match--;
                if (match < 0) {
                    break;
                }
            }
        }
        if (match > 0) {
            throw new PBInternalError(`Invalid expression: ${e}`);
        } else if (match === 0) {
            return e.substring(1, e.length - 1);
        }
    }
    return e;
}
/** @internal */ class ShaderAST {
    isReference() {
        return false;
    }
    isPointer() {
        return !!this.getType()?.isPointerType();
    }
    getType() {
        return null;
    }
    toWebGL(indent, ctx) {
        return '';
    }
    toWebGL2(indent, ctx) {
        return '';
    }
    toWGSL(indent, ctx) {
        return '';
    }
    toString(deviceType) {
        return this.constructor.name;
    }
}
/** @internal */ class ASTExpression extends ShaderAST {
}
/** @internal */ class ASTFunctionParameter extends ASTExpression {
    /** @internal */ paramAST;
    /** @internal */ writable;
    constructor(init){
        super();
        this.paramAST = init;
        this.writable = false;
    }
    getType() {
        return this.paramAST.getType();
    }
    markWritable() {
        if (this.paramAST instanceof ASTPrimitive) {
            console.warn(`Write to non-output parameter ${this.paramAST.value.$str}`);
        }
        this.writable = true;
    }
    isWritable() {
        return this.writable;
    }
    getAddressSpace() {
        return this.paramAST.getAddressSpace();
    }
    isConstExp() {
        return this.paramAST.isConstExp();
    }
    isReference() {
        return this.paramAST.isReference();
    }
    toWebGL(indent, ctx) {
        return this.paramAST.toWebGL(indent, ctx);
    }
    toWebGL2(indent, ctx) {
        return this.paramAST.toWebGL2(indent, ctx);
    }
    toWGSL(indent, ctx) {
        return this.paramAST.toWGSL(indent, ctx);
    }
}
/** @internal */ class ASTScope extends ShaderAST {
    statements;
    constructor(){
        super();
        this.statements = [];
    }
    toWebGL(indent, ctx) {
        return this.statements.filter((stmt)=>!(stmt instanceof ASTCallFunction) || stmt.isStatement).map((stmt)=>stmt.toWebGL(indent, ctx)).join('');
    }
    toWebGL2(indent, ctx) {
        return this.statements.filter((stmt)=>!(stmt instanceof ASTCallFunction) || stmt.isStatement).map((stmt)=>stmt.toWebGL2(indent, ctx)).join('');
    }
    toWGSL(indent, ctx) {
        return this.statements.filter((stmt)=>!(stmt instanceof ASTCallFunction) || stmt.isStatement).map((stmt)=>{
            if (stmt instanceof ASTCallFunction) {
                if (!stmt.getType().isVoidType()) {
                    return `${indent}_ = ${stmt.toWGSL('', ctx)}`;
                }
            }
            return stmt.toWGSL(indent, ctx);
        }).join('');
    }
}
/** @internal */ class ASTNakedScope extends ASTScope {
    toWebGL(indent, ctx) {
        return `${indent}{\n${super.toWebGL(indent + ' ', ctx)}${indent}}\n`;
    }
    toWebGL2(indent, ctx) {
        return `${indent}{\n${super.toWebGL2(indent + ' ', ctx)}${indent}}\n`;
    }
    toWGSL(indent, ctx) {
        return `${indent}{\n${super.toWGSL(indent + ' ', ctx)}${indent}}\n`;
    }
}
/** @internal */ class ASTGlobalScope extends ASTScope {
    /** @internal */ uniforms;
    constructor(){
        super();
        this.uniforms = [];
    }
    findFunctions(name) {
        const result = [];
        for (const stmt of this.statements){
            if (stmt instanceof ASTFunction && stmt.name === name) {
                result.push(stmt);
            }
        }
        return result;
    }
    toWebGL(indent, ctx) {
        // TODO: precision
        const precisions = `${indent}precision highp float;\n${indent}precision highp int;\n`;
        const version = `${indent}#version 100\n`;
        const body = ctx.types.map((val)=>val.toWebGL(indent, ctx)).join('') + this.uniforms.map((uniform)=>uniform.toWebGL(indent, ctx)).join('') + ctx.inputs.map((input)=>input.toWebGL(indent, ctx)).join('') + ctx.outputs.map((output)=>output.toWebGL(indent, ctx)).join('') + super.toWebGL(indent, ctx);
        for (const k of ctx.builtins){
            const info = builtinVariables.webgl[k];
            if (info.extension) {
                ctx.extensions.add(info.extension);
            }
        }
        const extensions = [
            ...ctx.extensions
        ].map((s)=>`${indent}#extension ${s}: enable\n`).join('');
        const defines = ctx.defines.join('');
        return version + extensions + precisions + defines + body;
    }
    toWebGL2(indent, ctx) {
        const precisions = `${indent}precision highp float;\n${indent}precision highp int;\n`;
        const version = `${indent}#version 300 es\n`;
        const body = ctx.types.map((val)=>val.toWebGL2(indent, ctx)).join('') + this.uniforms.map((uniform)=>uniform.toWebGL2(indent, ctx)).join('') + ctx.inputs.map((input)=>input.toWebGL2(indent, ctx)).join('') + ctx.outputs.map((output)=>output.toWebGL2(indent, ctx)).join('') + super.toWebGL2(indent, ctx);
        for (const k of ctx.builtins){
            const info = builtinVariables.webgl2[k];
            if (info.extension) {
                ctx.extensions.add(info.extension);
            }
        }
        const extensions = [
            ...ctx.extensions
        ].map((s)=>`${indent}#extension ${s}: enable\n`).join('');
        const defines = ctx.defines.join('');
        return version + extensions + precisions + defines + body;
    }
    toWGSL(indent, ctx) {
        const structNames = ctx.type === ShaderType.Vertex ? [
            BuiltinInputStructNameVS,
            BuiltinOutputStructNameVS
        ] : ctx.type === ShaderType.Fragment ? [
            BuiltinInputStructNameFS,
            BuiltinOutputStructNameFS
        ] : [
            BuiltinInputStructNameCS
        ];
        const usedBuiltins = [];
        for (const k of ctx.builtins){
            usedBuiltins.push(builtinVariables.webgpu[k].name);
        }
        const allBuiltins = Object.keys(builtinVariables.webgpu).map((val)=>builtinVariables.webgpu[val].name);
        for (const type of ctx.types){
            if (type instanceof ASTStructDefine && structNames.indexOf(type.type.structName) >= 0) {
                for(let i = type.type.structMembers.length - 1; i >= 0; i--){
                    const member = type.type.structMembers[i];
                    if (allBuiltins.indexOf(member.name) >= 0 && usedBuiltins.indexOf(member.name) < 0) {
                        type.type.structMembers.splice(i, 1);
                        type.prefix.splice(i, 1);
                    }
                }
            }
        }
        ctx.types = ctx.types.filter((val)=>!(val instanceof ASTStructDefine) || val.type.structMembers.length > 0);
        return ctx.types.map((val)=>val.toWGSL(indent, ctx)).join('') + this.uniforms.map((uniform)=>uniform.toWGSL(indent, ctx)).join('') + super.toWGSL(indent, ctx);
    }
}
/** @internal */ class ASTPrimitive extends ASTExpression {
    /** @internal */ value;
    /** @internal */ ref;
    /** @internal */ writable;
    /** @internal */ constExp;
    constructor(value){
        super();
        this.value = value;
        this.ref = null;
        this.writable = false;
        this.constExp = false;
    }
    get name() {
        return this.value.$str;
    }
    isReference() {
        return true;
    }
    isConstExp() {
        return this.constExp;
    }
    markWritable() {
        this.writable = true;
        this.constExp = false;
        if (this.ref) {
            this.ref.markWritable();
        }
    }
    isWritable() {
        const type = this.getType();
        return this.writable || type.isAtomicI32() || type.isAtomicU32() || type.isStructType() && type.haveAtomicMembers();
    }
    getAddressSpace() {
        switch(this.value.$declareType){
            case DeclareType.DECLARE_TYPE_UNIFORM:
                return PBAddressSpace.UNIFORM;
            case DeclareType.DECLARE_TYPE_STORAGE:
                return PBAddressSpace.STORAGE;
            case DeclareType.DECLARE_TYPE_IN:
            case DeclareType.DECLARE_TYPE_OUT:
                return null;
            default:
                return this.value.$global ? PBAddressSpace.PRIVATE : PBAddressSpace.FUNCTION;
        }
    }
    getType() {
        return this.value.$typeinfo;
    }
    toWebGL(indent, ctx) {
        return this.name;
    }
    toWebGL2(indent, ctx) {
        return this.name;
    }
    toWGSL(indent, ctx) {
        if (this.value.$declareType === DeclareType.DECLARE_TYPE_IN) {
            const structName = getBuiltinInputStructInstanceName(ctx.type);
            return ctx.global[structName][this.name].$ast.toWGSL(indent, ctx);
        } else if (this.value.$declareType === DeclareType.DECLARE_TYPE_OUT) {
            const structName = getBuiltinOutputStructInstanceName(ctx.type);
            return ctx.global[structName][this.name].$ast.toWGSL(indent, ctx);
        } else {
            return this.name;
        }
    }
    toString(deviceType) {
        return this.name;
    }
}
/** @internal */ class ASTLValue extends ShaderAST {
}
/** @internal */ class ASTLValueScalar extends ASTLValue {
    /** @internal */ value;
    constructor(value){
        super();
        if (value.getAddressSpace() === PBAddressSpace.UNIFORM) {
            throw new PBASTError(value, 'cannot assign to uniform variable');
        }
        this.value = value;
        if (this.value instanceof ASTCallFunction) {
            this.value.isStatement = false;
        }
    }
    getType() {
        return this.value.getType();
    }
    markWritable() {
        this.value.markWritable();
    }
    isWritable() {
        return this.value.isWritable();
    }
    isReference() {
        return this.value.isReference();
    }
    toWebGL(indent, ctx) {
        return this.value.toWebGL(indent, ctx);
    }
    toWebGL2(indent, ctx) {
        return this.value.toWebGL2(indent, ctx);
    }
    toWGSL(indent, ctx) {
        return this.value.toWGSL(indent, ctx);
    }
    toString(deviceType) {
        return this.value.toString(deviceType);
    }
}
/** @internal */ class ASTLValueHash extends ASTLValue {
    /** @internal */ scope;
    /** @internal */ field;
    /** @internal */ type;
    constructor(scope, field, type){
        super();
        this.scope = scope;
        this.field = field;
        this.type = type;
    }
    getType() {
        return this.type;
    }
    markWritable() {
        this.scope.markWritable();
    }
    isWritable() {
        return this.scope.isWritable();
    }
    isReference() {
        return this.scope.isReference();
    }
    toWebGL(indent, ctx) {
        return `${this.scope.toWebGL(indent, ctx)}.${this.field}`;
    }
    toWebGL2(indent, ctx) {
        return `${this.scope.toWebGL2(indent, ctx)}.${this.field}`;
    }
    toWGSL(indent, ctx) {
        const scope = this.scope.isPointer() ? new ASTReferenceOf(this.scope) : this.scope;
        return `${scope.toWGSL(indent, ctx)}.${this.field}`;
    }
    toString(deviceType) {
        const scope = this.scope.isPointer() ? new ASTReferenceOf(this.scope) : this.scope;
        return `${scope.toString(deviceType)}.${this.field}`;
    }
}
/** @internal */ class ASTLValueArray extends ASTLValue {
    /** @internal */ value;
    /** @internal */ index;
    /** @internal */ type;
    constructor(value, index, type){
        super();
        this.value = value;
        this.index = index;
        this.type = type;
        if (this.index instanceof ASTCallFunction) {
            this.index.isStatement = false;
        }
    }
    getType() {
        return this.type;
    }
    markWritable() {
        this.value.markWritable();
    }
    isWritable() {
        return this.value.isWritable();
    }
    isReference() {
        return this.value.isReference();
    }
    toWebGL(indent, ctx) {
        return `${this.value.toWebGL(indent, ctx)}[${this.index.toWebGL(indent, ctx)}]`;
    }
    toWebGL2(indent, ctx) {
        return `${this.value.toWebGL2(indent, ctx)}[${this.index.toWebGL2(indent, ctx)}]`;
    }
    toWGSL(indent, ctx) {
        const value = this.value.isPointer() ? new ASTReferenceOf(this.value) : this.value;
        return `${value.toWGSL(indent, ctx)}[${this.index.toWGSL(indent, ctx)}]`;
    }
    toString(deviceType) {
        const value = this.value.isPointer() ? new ASTReferenceOf(this.value) : this.value;
        return `${value.toString(deviceType)}[${this.index.toString(deviceType)}]`;
    }
}
/** @internal */ class ASTLValueDeclare extends ASTLValue {
    /** @internal */ value;
    constructor(value){
        super();
        this.value = value;
        this.value.constExp = true;
    }
    getType() {
        return this.value.getType();
    }
    markWritable() {}
    isWritable() {
        return false;
    }
    isReference() {
        return true;
    }
    toWebGL(indent, ctx) {
        let prefix = '';
        switch(this.value.value.$declareType){
            case DeclareType.DECLARE_TYPE_IN:
            case DeclareType.DECLARE_TYPE_OUT:
            case DeclareType.DECLARE_TYPE_UNIFORM:
            case DeclareType.DECLARE_TYPE_STORAGE:
                throw new Error('invalid declare type');
            default:
                prefix = this.value.constExp && !this.value.isWritable() && !this.getType().isStructType() ? 'const ' : '';
                break;
        }
        {
            return `${prefix}${this.getType().toTypeName('webgl', this.value.name)}`;
        }
    }
    toWebGL2(indent, ctx) {
        let prefix = '';
        switch(this.value.value.$declareType){
            case DeclareType.DECLARE_TYPE_IN:
            case DeclareType.DECLARE_TYPE_OUT:
            case DeclareType.DECLARE_TYPE_UNIFORM:
            case DeclareType.DECLARE_TYPE_STORAGE:
                throw new Error('invalid declare type');
            default:
                prefix = this.value.constExp && !this.value.isWritable() && !this.getType().isStructType() ? 'const ' : '';
                break;
        }
        {
            return `${prefix}${this.getType().toTypeName('webgl2', this.value.name)}`;
        }
    }
    toWGSL(indent, ctx) {
        let prefix;
        switch(this.value.value.$declareType){
            case DeclareType.DECLARE_TYPE_IN:
            case DeclareType.DECLARE_TYPE_OUT:
            case DeclareType.DECLARE_TYPE_UNIFORM:
            case DeclareType.DECLARE_TYPE_STORAGE:
                throw new Error('invalid declare type');
            default:
                {
                    const addressSpace = this.value.getAddressSpace();
                    const readonly = this.getType().isPointerType() || !this.value.isWritable() && (addressSpace === PBAddressSpace.PRIVATE || addressSpace === PBAddressSpace.FUNCTION);
                    const moduleScope = addressSpace === PBAddressSpace.PRIVATE;
                    const storageAccessMode = addressSpace === PBAddressSpace.STORAGE && this.value.isWritable() ? ', read_write' : '';
                    const decorator = addressSpace !== PBAddressSpace.FUNCTION ? `<${addressSpace}${storageAccessMode}>` : '';
                    prefix = readonly ? moduleScope ? 'const ' : 'let ' : `var${decorator} `;
                    break;
                }
        }
        {
            // const decl = this.value.value.$global ? this.getType().toTypeName('webgpu', this.value.name) : this.value.name;
            const type = this.getType();
            if (type.isPointerType() && (this.value.isWritable() || this.value.ref.isWritable())) {
                type.writable = true;
            }
            const decl = type.toTypeName('webgpu', this.value.name);
            return `${prefix}${decl}`;
        }
    }
    toString(deviceType) {
        return this.value.toString(deviceType);
    }
}
/** @internal */ class ASTShaderExpConstructor extends ASTExpression {
    /** @internal */ type;
    /** @internal */ args;
    /** @internal */ constExp;
    constructor(type, args){
        super();
        this.type = type;
        this.args = args;
        this.constExp = true;
        for (const arg of args){
            if (arg === null || arg === undefined) {
                throw new Error('invalid constructor argument');
            }
            if (arg instanceof ASTCallFunction) {
                arg.isStatement = false;
            }
            this.constExp &&= !(arg instanceof ASTExpression) || arg.isConstExp();
        }
    }
    getType() {
        return this.type;
    }
    markWritable() {}
    isWritable() {
        return false;
    }
    isConstExp() {
        return this.constExp;
    }
    getAddressSpace() {
        return null;
    }
    toWebGL(indent, ctx) {
        console.assert(!this.type.isArrayType(), 'array constructor not supported in webgl1 device');
        console.assert(this.type.isConstructible(), `type '${this.type.toTypeName('webgl')}' is not constructible`);
        const overloads = this.type.getConstructorOverloads('webgl');
        for (const overload of overloads){
            const convertedArgs = convertArgs(this.args, overload);
            if (convertedArgs) {
                const c = convertedArgs.args.map((arg)=>unbracket(arg.toWebGL(indent, ctx))).join(',');
                return `${convertedArgs.name}(${c})`;
            }
        }
        throw new Error(`no matching overload function found for type ${this.type.toTypeName('webgl')}`);
    }
    toWebGL2(indent, ctx) {
        console.assert(this.type.isConstructible(), `type '${this.type.toTypeName('webgl2')}' is not constructible`, true);
        const overloads = this.type.getConstructorOverloads('webgl2');
        for (const overload of overloads){
            const convertedArgs = convertArgs(this.args, overload);
            if (convertedArgs) {
                const c = convertedArgs.args.map((arg)=>unbracket(arg.toWebGL2(indent, ctx))).join(',');
                return `${convertedArgs.name}(${c})`;
            }
        }
        throw new Error(`no matching overload function found for type ${this.type.toTypeName('webgl2')}`);
    }
    toWGSL(indent, ctx) {
        /*
    console.assert(
      this.type.isConstructible(),
      `type '${this.type.toTypeName('webgpu')}' is not constructible`,
      true
    );
    */ const overloads = this.type.getConstructorOverloads('webgpu');
        for (const overload of overloads){
            const convertedArgs = convertArgs(this.args, overload);
            if (convertedArgs) {
                const c = convertedArgs.args.map((arg)=>unbracket(arg.toWGSL(indent, ctx))).join(',');
                return `${convertedArgs.name}(${c})`;
            }
        }
        throw new Error(`no matching overload function found for type ${this.type.toTypeName('webgpu')}`);
    }
    toString(deviceType) {
        return 'constructor';
    }
}
/** @internal */ class ASTScalar extends ASTExpression {
    /** @internal */ value;
    /** @internal */ type;
    constructor(value, type){
        super();
        this.value = value;
        this.type = type;
        if (typeof value === 'number') {
            if (type.primitiveType === PBPrimitiveType.BOOL) {
                throw new PBTypeCastError(value, typeof value, type);
            }
            if (type.primitiveType === PBPrimitiveType.I32 && (!Number.isInteger(value) || value < 0x80000000 >> 0 || value > 0xffffffff)) {
                throw new PBTypeCastError(value, typeof value, type);
            }
            if (value < 0 && type.primitiveType === PBPrimitiveType.U32 && (!Number.isInteger(value) || value < 0 || value > 0xffffffff)) {
                throw new PBTypeCastError(value, typeof value, type);
            }
        } else if (type.primitiveType !== PBPrimitiveType.BOOL) {
            throw new PBTypeCastError(value, typeof value, type);
        }
    }
    getType() {
        return this.type;
    }
    markWritable() {}
    isWritable() {
        return false;
    }
    isConstExp() {
        return true;
    }
    getAddressSpace() {
        return null;
    }
    toWebGL(indent, ctx) {
        switch(this.type.primitiveType){
            case PBPrimitiveType.F32:
                return toFixed(this.value);
            case PBPrimitiveType.I32:
                return toInt(this.value);
            case PBPrimitiveType.U32:
                return toUint(this.value);
            case PBPrimitiveType.BOOL:
                return String(!!this.value);
            default:
                throw new Error('Invalid scalar type');
        }
    }
    toWebGL2(indent, ctx) {
        switch(this.type.primitiveType){
            case PBPrimitiveType.F32:
                return toFixed(this.value);
            case PBPrimitiveType.I32:
                return toInt(this.value);
            case PBPrimitiveType.U32:
                return `${toUint(this.value)}u`;
            case PBPrimitiveType.BOOL:
                return String(!!this.value);
            default:
                throw new Error('Invalid scalar type');
        }
    }
    toWGSL(indent, ctx) {
        switch(this.type.primitiveType){
            case PBPrimitiveType.F32:
                return toFixed(this.value);
            case PBPrimitiveType.I32:
                return toInt(this.value);
            case PBPrimitiveType.U32:
                return `${toUint(this.value)}u`;
            case PBPrimitiveType.BOOL:
                return String(!!this.value);
            default:
                throw new Error('Invalid scalar type');
        }
    }
    toString(deviceType) {
        return `${this.value}`;
    }
}
/** @internal */ class ASTHash extends ASTExpression {
    /** @internal */ source;
    /** @internal */ field;
    /** @internal */ type;
    constructor(source, field, type){
        super();
        this.source = source;
        this.field = field;
        this.type = type;
        if (this.source instanceof ASTCallFunction) {
            this.source.isStatement = false;
        }
    }
    getType() {
        return this.type;
    }
    isReference() {
        return this.source.isReference();
    }
    isConstExp() {
        return this.source.isConstExp();
    }
    markWritable() {
        this.source.markWritable();
    }
    isWritable() {
        return this.source.isWritable();
    }
    getAddressSpace() {
        return this.source.getAddressSpace();
    }
    toWebGL(indent, ctx) {
        return `${this.source.toWebGL(indent, ctx)}.${this.field}`;
    }
    toWebGL2(indent, ctx) {
        return `${this.source.toWebGL2(indent, ctx)}.${this.field}`;
    }
    toWGSL(indent, ctx) {
        const source = this.source.isPointer() ? new ASTReferenceOf(this.source) : this.source;
        return `${source.toWGSL(indent, ctx)}.${this.field}`;
    }
    toString(deviceType) {
        const source = this.source.isPointer() ? new ASTReferenceOf(this.source) : this.source;
        return `${source.toString(deviceType)}.${this.field}`;
    }
}
/** @internal */ class ASTCast extends ASTExpression {
    /** @internal */ sourceValue;
    /** @internal */ castType;
    constructor(source, type){
        super();
        this.sourceValue = source;
        this.castType = type;
        if (this.sourceValue instanceof ASTCallFunction) {
            this.sourceValue.isStatement = false;
        }
    }
    getType() {
        return this.castType;
    }
    markWritable() {}
    isWritable() {
        return false;
    }
    isConstExp() {
        return this.sourceValue.isConstExp();
    }
    getAddressSpace() {
        return null;
    }
    toWebGL(indent, ctx) {
        if (!this.castType.isCompatibleType(this.sourceValue.getType())) {
            return `${this.castType.toTypeName('webgl')}(${unbracket(this.sourceValue.toWebGL(indent, ctx))})`;
        } else {
            return this.sourceValue.toWebGL(indent, ctx);
        }
    }
    toWebGL2(indent, ctx) {
        if (!this.castType.isCompatibleType(this.sourceValue.getType())) {
            return `${this.castType.toTypeName('webgl2')}(${unbracket(this.sourceValue.toWebGL2(indent, ctx))})`;
        } else {
            return this.sourceValue.toWebGL2(indent, ctx);
        }
    }
    toWGSL(indent, ctx) {
        if (!this.castType.isCompatibleType(this.sourceValue.getType())) {
            return `${this.castType.toTypeName('webgpu')}(${unbracket(this.sourceValue.toWGSL(indent, ctx))})`;
        } else {
            return this.sourceValue.toWGSL(indent, ctx);
        }
    }
    toString(deviceType) {
        return `${this.castType.toTypeName(deviceType)}(${unbracket(this.sourceValue.toString(deviceType))})`;
    }
}
/** @internal */ class ASTAddressOf extends ASTExpression {
    /** @internal */ value;
    /** @internal */ type;
    constructor(value){
        super();
        console.assert(value.isReference(), 'no pointer type for non-reference values', true);
        this.value = value;
        this.type = new PBPointerTypeInfo(value.getType(), value.getAddressSpace());
    }
    getType() {
        return this.type;
    }
    isConstExp() {
        return false;
    }
    markWritable() {
        const addressSpace = this.value.getAddressSpace();
        if (addressSpace === PBAddressSpace.UNIFORM) {
            throw new PBASTError(this.value, 'uniforms are not writable');
        }
        this.value.markWritable();
    }
    isWritable() {
        return this.value.isWritable();
    }
    getAddressSpace() {
        return this.value.getAddressSpace();
    }
    toWebGL(indent, ctx) {
        throw new Error('GLSL does not support pointer type');
    }
    toWebGL2(indent, ctx) {
        throw new Error('GLSL does not support pointer type');
    }
    toWGSL(indent, ctx) {
        const ast = this.value instanceof ASTFunctionParameter ? this.value.paramAST : this.value;
        return ast instanceof ASTReferenceOf ? ast.value.toWGSL(indent, ctx) : `(&${ast.toWGSL(indent, ctx)})`;
    }
    toString(deviceType) {
        const ast = this.value instanceof ASTFunctionParameter ? this.value.paramAST : this.value;
        return ast instanceof ASTReferenceOf ? ast.value.toString(deviceType) : `(&${ast.toString(deviceType)})`;
    }
}
/** @internal */ class ASTReferenceOf extends ASTExpression {
    /** @internal */ value;
    constructor(value){
        super();
        this.value = value;
        if (this.value instanceof ASTCallFunction) {
            this.value.isStatement = false;
        }
    }
    getType() {
        const type = this.value.getType();
        return type.isPointerType() ? type.pointerType : type;
    }
    isReference() {
        return true;
    }
    markWritable() {
        this.value.markWritable();
    }
    isWritable() {
        return this.value.isWritable();
    }
    isConstExp() {
        return false;
    }
    getAddressSpace() {
        return this.value instanceof ASTExpression ? this.value.getAddressSpace() : null;
    }
    toWebGL(indent, ctx) {
        return this.value.toWebGL(indent, ctx);
    }
    toWebGL2(indent, ctx) {
        return this.value.toWebGL2(indent, ctx);
    }
    toWGSL(indent, ctx) {
        return this.value.getType().isPointerType() ? `(*${this.value.toWGSL(indent, ctx)})` : this.value.toWGSL(indent, ctx);
    }
    toString(deviceType) {
        return `*${this.value.toString(deviceType)}`;
    }
}
/** @internal */ class ASTUnaryFunc extends ASTExpression {
    /** @internal */ value;
    /** @internal */ op;
    /** @internal */ type;
    constructor(value, op, type){
        super();
        this.value = value;
        this.op = op;
        this.type = type;
        if (this.value instanceof ASTCallFunction) {
            this.value.isStatement = false;
        }
    }
    getType() {
        return this.type;
    }
    markWritable() {}
    isWritable() {
        return false;
    }
    isConstExp() {
        return this.value.isConstExp();
    }
    getAddressSpace() {
        return null;
    }
    toWebGL(indent, ctx) {
        return `${this.op}${this.value.toWebGL(indent, ctx)}`;
    }
    toWebGL2(indent, ctx) {
        return `${this.op}${this.value.toWebGL2(indent, ctx)}`;
    }
    toWGSL(indent, ctx) {
        const value = this.value.isPointer() ? new ASTReferenceOf(this.value) : this.value;
        return `${this.op}${value.toWGSL(indent, ctx)}`;
    }
    toString(deviceType) {
        const value = this.value.isPointer() ? new ASTReferenceOf(this.value) : this.value;
        return `${this.op}${value.toString(deviceType)}`;
    }
}
/** @internal */ class ASTBinaryFunc extends ASTExpression {
    /** @internal */ left;
    /** @internal */ right;
    /** @internal */ type;
    /** @internal */ op;
    constructor(left, right, op, type){
        super();
        this.left = left;
        this.right = right;
        this.op = op;
        this.type = type;
        if (this.left instanceof ASTCallFunction) {
            this.left.isStatement = false;
        }
        if (this.right instanceof ASTCallFunction) {
            this.right.isStatement = false;
        }
    }
    getType() {
        return this.type;
    }
    markWritable() {}
    isWritable() {
        return false;
    }
    isConstExp() {
        return this.left.isConstExp() && this.right.isConstExp();
    }
    getAddressSpace() {
        return null;
    }
    toWebGL(indent, ctx) {
        return `(${this.left.toWebGL(indent, ctx)} ${this.op} ${this.right.toWebGL(indent, ctx)})`;
    }
    toWebGL2(indent, ctx) {
        return `(${this.left.toWebGL2(indent, ctx)} ${this.op} ${this.right.toWebGL2(indent, ctx)})`;
    }
    toWGSL(indent, ctx) {
        const left = this.left.isPointer() ? new ASTReferenceOf(this.left) : this.left;
        const right = this.right.isPointer() ? new ASTReferenceOf(this.right) : this.right;
        return `(${left.toWGSL(indent, ctx)} ${this.op} ${right.toWGSL(indent, ctx)})`;
    }
    toString(deviceType) {
        const left = this.left.isPointer() ? new ASTReferenceOf(this.left) : this.left;
        const right = this.right.isPointer() ? new ASTReferenceOf(this.right) : this.right;
        return `(${left.toString(deviceType)} ${this.op} ${right.toString(deviceType)})`;
    }
}
/** @internal */ class ASTArrayIndex extends ASTExpression {
    /** @internal */ source;
    /** @internal */ index;
    /** @internal */ type;
    constructor(source, index, type){
        super();
        this.source = source;
        this.index = index;
        this.type = type;
        if (this.source instanceof ASTCallFunction) {
            this.source.isStatement = false;
        }
        if (this.index instanceof ASTCallFunction) {
            this.index.isStatement = false;
        }
    }
    getType() {
        return this.type;
    }
    isReference() {
        return this.source.isReference();
    }
    markWritable() {
        this.source.markWritable();
    }
    isWritable() {
        return this.source.isWritable();
    }
    isConstExp() {
        return this.source.isConstExp() && this.index.isConstExp();
    }
    getAddressSpace() {
        return this.source.getAddressSpace();
    }
    toWebGL(indent, ctx) {
        return `${this.source.toWebGL(indent, ctx)}[${unbracket(this.index.toWebGL(indent, ctx))}]`;
    }
    toWebGL2(indent, ctx) {
        return `${this.source.toWebGL2(indent, ctx)}[${unbracket(this.index.toWebGL2(indent, ctx))}]`;
    }
    toWGSL(indent, ctx) {
        return `${this.source.toWGSL(indent, ctx)}[${unbracket(this.index.toWGSL(indent, ctx))}]`;
    }
    toString(deviceType) {
        return `${this.source.toString(deviceType)}[${unbracket(this.index.toString(deviceType))}]`;
    }
}
/** @internal */ class ASTTouch extends ShaderAST {
    /** @internal */ value;
    constructor(value){
        super();
        if (value.getType().isVoidType()) {
            throw new Error('can not touch void type');
        }
        if (value instanceof ASTCallFunction) {
            value.isStatement = false;
        }
        this.value = value;
    }
    toWebGL(indent, ctx) {
        return `${indent}${this.value.toWebGL('', ctx)};\n`;
    }
    toWebGL2(indent, ctx) {
        return `${indent}${this.value.toWebGL2('', ctx)};\n`;
    }
    toWGSL(indent, ctx) {
        if (!this.value.getType().isVoidType()) {
            return `${indent}_ = ${this.value.toWGSL('', ctx)};\n`;
        } else {
            return `${indent}${this.value.toWGSL('', ctx)};\n`;
        }
    }
}
/** @internal */ class ASTSelect extends ASTExpression {
    /** @internal */ condition;
    /** @internal */ first;
    /** @internal */ second;
    /** @internal */ type;
    constructor(condition, first, second){
        super();
        this.condition = condition instanceof ASTExpression ? condition : new ASTScalar(condition, typeBool);
        let firstType = null;
        let secondType = null;
        if (first instanceof ASTExpression) {
            firstType = first.getType();
            this.first = first;
            if (first instanceof ASTCallFunction) {
                first.isStatement = false;
            }
        } else if (typeof first === 'number') {
            if (!Number.isInteger(first)) {
                this.first = new ASTScalar(first, typeF32);
                firstType = typeF32;
            }
        } else if (typeof first === 'boolean') {
            this.first = new ASTScalar(first, typeBool);
            firstType = typeBool;
        } else {
            throw new Error('select: invalid first value');
        }
        if (second instanceof ASTExpression) {
            secondType = second.getType();
            this.second = second;
            if (second instanceof ASTCallFunction) {
                second.isStatement = false;
            }
        } else if (typeof second === 'number') {
            if (!Number.isInteger(second)) {
                this.second = new ASTScalar(second, typeF32);
                secondType = typeF32;
            }
        } else if (typeof second === 'boolean') {
            this.second = new ASTScalar(second, typeBool);
            secondType = typeBool;
        } else {
            throw new Error('select: invalid second value');
        }
        if (!firstType && !secondType) {
            throw new Error('select: cannot determine the value types');
        }
        if (firstType && secondType) {
            if (!firstType.isCompatibleType(secondType)) {
                throw new Error('select: first value and second value must be the same type');
            } else {
                this.type = firstType;
            }
        } else if (!firstType) {
            if (secondType.typeId === typeF32.typeId) {
                this.first = new ASTScalar(first, typeF32);
            } else if (secondType.typeId === typeI32.typeId) {
                this.first = new ASTScalar(first, typeI32);
            } else if (secondType.typeId === typeU32$1.typeId) {
                this.first = new ASTScalar(first, typeU32$1);
            } else {
                throw new Error('select: invalid type of the first value');
            }
            this.type = secondType;
        } else {
            if (firstType.typeId === typeF32.typeId) {
                this.second = new ASTScalar(second, typeF32);
            } else if (firstType.typeId === typeI32.typeId) {
                this.second = new ASTScalar(second, typeI32);
            } else if (firstType.typeId === typeU32$1.typeId) {
                this.second = new ASTScalar(second, typeU32$1);
            } else {
                throw new Error('select: invalid type of the second value');
            }
            this.type = firstType;
        }
    }
    getType() {
        return this.type;
    }
    isConstExp() {
        return false;
    }
    markWritable() {}
    isWritable() {
        return false;
    }
    getAddressSpace() {
        return null;
    }
    toWebGL(indent, ctx) {
        return `${indent}(${this.condition.toWebGL('', ctx)} ? ${this.first.toWebGL('', ctx)} : ${this.second.toWebGL('', ctx)})`;
    }
    toWebGL2(indent, ctx) {
        return `${indent}(${this.condition.toWebGL2('', ctx)} ? ${this.first.toWebGL2('', ctx)} : ${this.second.toWebGL2('', ctx)})`;
    }
    toWGSL(indent, ctx) {
        return `${indent}select(${this.second.toWGSL('', ctx)}, ${this.first.toWGSL('', ctx)}, ${this.condition.toWGSL('', ctx)})`;
    //return `${indent}${this.condition.toWGSL('', ctx)} ? ${this.first.toWGSL('', ctx)} : ${this.second.toWGSL('', ctx)}`;
    }
}
/** @internal */ class ASTAssignment extends ShaderAST {
    /** @internal */ lvalue;
    /** @internal */ rvalue;
    constructor(lvalue, rvalue){
        super();
        if (!lvalue.isReference()) {
            throw new Error('assignment: l-value required');
        }
        this.lvalue = lvalue;
        this.rvalue = rvalue;
        if (!(this.lvalue instanceof ASTLValueDeclare)) {
            if (this.lvalue.getType().isPointerType()) {
                throw new PBASTError(this.lvalue, 'cannot assign to read-only variable');
            }
            this.lvalue.markWritable();
        } else if (this.lvalue.getType().isPointerType()) {
            if (this.rvalue instanceof ASTPrimitive) {
                this.lvalue.value.ref = this.rvalue.ref;
            } else if (this.rvalue instanceof ASTAddressOf) {
                this.lvalue.value.ref = this.rvalue.value;
            } else {
                throw new PBASTError(this.lvalue, 'invalid pointer assignment');
            }
        } else if (this.rvalue instanceof ASTExpression) {
            this.lvalue.value.constExp = this.rvalue.isConstExp();
        }
        if (this.rvalue instanceof ASTCallFunction) {
            this.rvalue.isStatement = false;
        }
    }
    getType() {
        return null;
    }
    toWebGL(indent, ctx) {
        let rhs = null;
        const ltype = this.lvalue.getType();
        const rtype = this.checkScalarType(this.rvalue, ltype);
        if (!ltype.isCompatibleType(rtype)) {
            throw new PBTypeCastError(this.rvalue instanceof ASTExpression ? this.rvalue.toString('webgl') : `${this.rvalue}`, rtype, ltype);
        }
        if (typeof this.rvalue === 'number' || typeof this.rvalue === 'boolean') {
            rhs = rtype.primitiveType === PBPrimitiveType.F32 ? toFixed(this.rvalue) : String(this.rvalue);
        } else {
            rhs = unbracket(this.rvalue.toWebGL(indent, ctx));
        }
        if (this.lvalue instanceof ASTLValueDeclare) {
            this.lvalue.value.constExp &&= !(this.rvalue instanceof ASTExpression) || this.rvalue.isConstExp();
        }
        return `${indent}${this.lvalue.toWebGL(indent, ctx)} = ${rhs};\n`;
    }
    toWebGL2(indent, ctx) {
        let rhs = null;
        const ltype = this.lvalue.getType();
        const rtype = this.checkScalarType(this.rvalue, ltype);
        if (!ltype.isCompatibleType(rtype)) {
            throw new PBTypeCastError(this.rvalue instanceof ASTExpression ? this.rvalue.toString('webgl2') : `${this.rvalue}`, rtype, ltype);
        }
        if (typeof this.rvalue === 'number' || typeof this.rvalue === 'boolean') {
            rhs = rtype.primitiveType === PBPrimitiveType.F32 ? toFixed(this.rvalue) : String(this.rvalue);
        } else {
            rhs = unbracket(this.rvalue.toWebGL2(indent, ctx));
        }
        if (this.lvalue instanceof ASTLValueDeclare) {
            this.lvalue.value.constExp &&= !(this.rvalue instanceof ASTExpression) || this.rvalue.isConstExp();
        }
        return `${indent}${this.lvalue.toWebGL2(indent, ctx)} = ${rhs};\n`;
    }
    toWGSL(indent, ctx) {
        const ltype = this.lvalue.getType();
        const [valueTypeLeft, lvalueIsPtr] = ltype.isPointerType() ? [
            ltype.pointerType,
            true
        ] : [
            ltype,
            false
        ];
        const rtype = this.checkScalarType(this.rvalue, valueTypeLeft);
        const rvalueIsPtr = rtype && rtype.isPointerType();
        const valueTypeRight = rvalueIsPtr ? rtype.pointerType : rtype;
        if (!valueTypeLeft.isCompatibleType(valueTypeRight)) {
            throw new PBTypeCastError(this.rvalue instanceof ASTExpression ? this.rvalue.toString('webgpu') : `${this.rvalue}`, rtype, ltype);
        }
        if (this.lvalue instanceof ASTLValueScalar || this.lvalue instanceof ASTLValueDeclare) {
            const structName = valueTypeLeft.isStructType() ? valueTypeLeft.structName : null;
            if (structName && ctx.types.findIndex((val)=>val instanceof ASTStructDefine && val.type.structName === structName) < 0) {
                return '';
            }
        }
        let rhs;
        if (typeof this.rvalue === 'number' || typeof this.rvalue === 'boolean') {
            rhs = rtype.primitiveType === PBPrimitiveType.F32 ? toFixed(this.rvalue) : String(this.rvalue);
        } else {
            rhs = unbracket(this.rvalue.toWGSL(indent, ctx));
        }
        const name = this.lvalue.toWGSL(indent, ctx);
        if (lvalueIsPtr && !rvalueIsPtr) {
            if (this.lvalue instanceof ASTLValueDeclare) {
                throw new Error(`rvalue must be pointer type: ${rhs}`);
            } else {
                return `${indent}*(${name}) = ${rhs};\n`;
            }
        } else if (rvalueIsPtr && !lvalueIsPtr) {
            return `${indent}${name} = *(${rhs});\n`;
        } else {
            return `${indent}${name} = ${rhs};\n`;
        }
    }
    checkScalarType(value, targetType) {
        if (value instanceof ASTExpression) {
            return value.getType();
        }
        const isBool = typeof value === 'boolean';
        const isInt = typeof value === 'number' && Number.isInteger(value) && value >= 0x80000000 >> 0 && value <= 0x7fffffff;
        const isUint = typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
        const isFloat = typeof value === 'number';
        if (targetType.isPrimitiveType()) {
            switch(targetType.primitiveType){
                case PBPrimitiveType.BOOL:
                    return isBool ? targetType : isInt ? typeI32 : isUint ? typeU32$1 : typeF32;
                case PBPrimitiveType.F32:
                    return isFloat ? targetType : typeBool;
                case PBPrimitiveType.I32:
                    return isInt ? targetType : isBool ? typeBool : isUint ? typeU32$1 : typeF32;
                case PBPrimitiveType.U32:
                    return isUint ? targetType : isBool ? typeBool : isInt ? typeI32 : typeF32;
                default:
                    return null;
            }
        } else {
            return isBool ? typeBool : isInt ? typeI32 : isUint ? typeU32$1 : typeF32;
        }
    }
}
/** @internal */ class ASTDiscard extends ShaderAST {
    toWebGL(indent, ctx) {
        return `${indent}discard;\n`;
    }
    toWebGL2(indent, ctx) {
        return `${indent}discard;\n`;
    }
    toWGSL(indent, ctx) {
        return `${indent}discard;\n`;
    }
}
/** @internal */ class ASTBreak extends ShaderAST {
    toWebGL(indent, ctx) {
        return `${indent}break;\n`;
    }
    toWebGL2(indent, ctx) {
        return `${indent}break;\n`;
    }
    toWGSL(indent, ctx) {
        return `${indent}break;\n`;
    }
}
/** @internal */ class ASTContinue extends ShaderAST {
    toWebGL(indent, ctx) {
        return `${indent}continue;\n`;
    }
    toWebGL2(indent, ctx) {
        return `${indent}continue;\n`;
    }
    toWGSL(indent, ctx) {
        return `${indent}continue;\n`;
    }
}
/** @internal */ class ASTReturn extends ShaderAST {
    /** @internal */ value;
    constructor(value){
        super();
        this.value = value;
        if (this.value instanceof ASTCallFunction) {
            this.value.isStatement = false;
        }
    }
    toWebGL(indent, ctx) {
        return this.value ? `${indent}return ${unbracket(this.value.toWebGL(indent, ctx))};\n` : `${indent}return;\n`;
    }
    toWebGL2(indent, ctx) {
        return this.value ? `${indent}return ${unbracket(this.value.toWebGL2(indent, ctx))};\n` : `${indent}return;\n`;
    }
    toWGSL(indent, ctx) {
        return this.value ? `${indent}return ${unbracket(this.value.toWGSL(indent, ctx))};\n` : `${indent}return;\n`;
    }
}
/** @internal */ class ASTCallFunction extends ASTExpression {
    /** @internal */ name;
    /** @internal */ args;
    /** @internal */ retType;
    /** @internal */ func;
    /** @internal */ isStatement;
    constructor(name, args, func, deviceType, retType){
        super();
        this.name = name;
        this.args = args;
        this.retType = func?.returnType ?? retType ?? typeVoid;
        this.func = func;
        this.isStatement = true;
        if (func) {
            if (func.funcType.argTypes.length !== this.args.length) {
                throw new PBInternalError(`ASTCallFunction(): number of parameters mismatch`);
            }
            for(let i = 0; i < this.args.length; i++){
                const funcArg = func.funcType.argTypes[i];
                if (funcArg.byRef) {
                    if (deviceType === 'webgpu') {
                        const argAddressSpace = args[i].getAddressSpace();
                        if (argAddressSpace !== PBAddressSpace.FUNCTION && argAddressSpace !== PBAddressSpace.PRIVATE) {
                            throw new PBParamTypeError(name, 'pointer type of function parameter must be function or private');
                        }
                        const argType = funcArg.type;
                        if (!argType.isPointerType()) {
                            throw new PBInternalError(`ASTCallFunction(): invalid reference type`);
                        }
                        if (argType.addressSpace === PBAddressSpace.UNKNOWN) {
                            argType.addressSpace = argAddressSpace;
                        } else if (argType.addressSpace !== argAddressSpace) {
                            throw new PBParamTypeError(name, `invalid pointer parameter address space '${argAddressSpace}', should be '${argType.addressSpace}`);
                        }
                    }
                    this.args[i].markWritable();
                }
            }
        }
        for (const arg of this.args){
            if (arg instanceof ASTCallFunction) {
                arg.isStatement = false;
            }
        }
    }
    getType() {
        return this.retType;
    }
    isConstExp() {
        return false;
    }
    markWritable() {}
    isWritable() {
        return false;
    }
    getAddressSpace() {
        return null;
    }
    toWebGL(indent, ctx) {
        if (this.name === 'dFdx' || this.name === 'dFdy' || this.name === 'fwidth') {
            ctx.extensions.add('GL_OES_standard_derivatives');
        } else if (this.name === 'texture2DLodEXT' || this.name === 'texture2DProjLodEXT' || this.name === 'textureCubeLodEXT' || this.name === 'texture2DGradEXT' || this.name === 'texture2DProjGradEXT' || this.name === 'textureCubeGradEXT') {
            ctx.extensions.add('GL_EXT_shader_texture_lod');
        }
        const args = this.args.map((arg)=>unbracket(arg.toWebGL(indent, ctx)));
        return `${this.isStatement ? indent : ''}${this.name}(${args.join(',')})${this.isStatement ? ';\n' : ''}`;
    }
    toWebGL2(indent, ctx) {
        const args = this.args.map((arg)=>unbracket(arg.toWebGL2(indent, ctx)));
        return `${this.isStatement ? indent : ''}${this.name}(${args.join(',')})${this.isStatement ? ';\n' : ''}`;
    }
    toWGSL(indent, ctx) {
        let thisArgs = this.args;
        if (this.func) {
            let argsNew;
            const convertedArgs = convertArgs(thisArgs, this.func.funcType);
            if (convertedArgs) {
                argsNew = convertedArgs.args;
            }
            if (!argsNew) {
                throw new Error(`no matching overloading found for function '${this.name}'`);
            }
            thisArgs = argsNew.filter((val)=>{
                const type = val.getType();
                if (type.isStructType() && ctx.types.findIndex((t)=>t instanceof ASTStructDefine && t.type.structName === type.structName) < 0) {
                    return false;
                }
                return true;
            });
        }
        const args = thisArgs.map((arg)=>unbracket(arg.toWGSL(indent, ctx)));
        return `${this.isStatement ? indent : ''}${this.name}(${args.join(',')})${this.isStatement ? ';\n' : ''}`;
    }
    toString(deviceType) {
        return `${this.name}(...)`;
    }
}
/** @internal */ class ASTDeclareVar extends ShaderAST {
    /** @internal */ value;
    /** @internal */ group;
    /** @internal */ binding;
    /** @internal */ blockName;
    constructor(exp){
        super();
        this.value = exp;
        this.group = 0;
        this.binding = 0;
    }
    isReference() {
        return true;
    }
    isPointer() {
        return this.value.getType().isPointerType();
    }
    toWebGL(indent, ctx) {
        let prefix = '';
        let builtin = false;
        let valueType = this.value.getType();
        switch(this.value.value.$declareType){
            case DeclareType.DECLARE_TYPE_IN:
                if (ctx.type === ShaderType.Vertex) {
                    prefix = 'attribute ';
                    ctx.defines.push(`#define ${this.value.name} ${semanticToAttrib(ctx.vertexAttributes[this.value.value.$location])}\n`);
                } else {
                    prefix = 'varying ';
                // ctx.defines.push(`#define ${this.value.$str} ch_varying_${this.value.$location}\n`);
                }
                break;
            case DeclareType.DECLARE_TYPE_OUT:
                if (ctx.type === ShaderType.Vertex) {
                    prefix = 'varying ';
                // ctx.defines.push(`#define ${this.value.$str} ch_varying_${this.value.$location}\n`);
                } else {
                    builtin = true;
                    if (ctx.mrt) {
                        ctx.defines.push(`#define ${this.value.name} gl_FragData[${this.value.value.$location}]\n`);
                        ctx.extensions.add('GL_EXT_draw_buffers');
                    } else {
                        ctx.defines.push(`#define ${this.value.name} gl_FragColor\n`);
                    }
                }
                break;
            case DeclareType.DECLARE_TYPE_UNIFORM:
                prefix = 'uniform ';
                valueType = ctx.typeReplacement?.get(this.value.value) || valueType;
                break;
            case DeclareType.DECLARE_TYPE_STORAGE:
                throw new Error(`invalid variable declare type: ${this.value.name}`);
        }
        if (!builtin) {
            return `${indent}${prefix}${valueType.toTypeName('webgl', this.value.name)};\n`;
        }
    }
    toWebGL2(indent, ctx) {
        let prefix = '';
        let valueType = this.value.getType();
        switch(this.value.value.$declareType){
            case DeclareType.DECLARE_TYPE_IN:
                if (ctx.type === ShaderType.Fragment && valueType.isPrimitiveType() && valueType.isInteger()) {
                    prefix = 'flat in ';
                } else {
                    prefix = 'in ';
                }
                if (ctx.type === ShaderType.Vertex) {
                    ctx.defines.push(`#define ${this.value.name} ${semanticToAttrib(ctx.vertexAttributes[this.value.value.$location])}\n`);
                }
                break;
            case DeclareType.DECLARE_TYPE_OUT:
                if (ctx.type === ShaderType.Vertex) {
                    if (valueType.isPrimitiveType() && valueType.isInteger()) {
                        prefix = 'flat out ';
                    } else {
                        prefix = 'out ';
                    }
                } else {
                    prefix = `layout(location = ${this.value.value.$location}) out `;
                }
                break;
            case DeclareType.DECLARE_TYPE_UNIFORM:
                if (valueType.isStructType()) {
                    /*
          if (valueType.layout !== 'std140') {
            throw new errors.PBASTError(this, 'uniform buffer layout must be std140');
          }
          */ return `${indent}layout(std140) uniform ${this.blockName} { ${valueType.structName} ${this.value.name}; };\n`;
                } else {
                    valueType = ctx.typeReplacement?.get(this.value.value) || valueType;
                    return `${indent}uniform ${valueType.toTypeName('webgl2', this.value.name)};\n`;
                }
            case DeclareType.DECLARE_TYPE_STORAGE:
                throw new Error(`invalid variable declare type: ${this.value.name}`);
        }
        {
            return `${indent}${prefix}${this.value.getType().toTypeName('webgl2', this.value.name)};\n`;
        }
    }
    toWGSL(indent, ctx) {
        let prefix;
        const isBlock = this.value.getType().isPrimitiveType() || this.value.getType().isStructType() || this.value.getType().isArrayType();
        switch(this.value.value.$declareType){
            case DeclareType.DECLARE_TYPE_IN:
            case DeclareType.DECLARE_TYPE_OUT:
                // prefix = `@location(${this.value.value.$location}) var<out> `;
                throw new Error(`Internal error`);
            case DeclareType.DECLARE_TYPE_UNIFORM:
                prefix = `@group(${this.group}) @binding(${this.binding}) var${isBlock ? '<uniform>' : ''} `;
                break;
            case DeclareType.DECLARE_TYPE_STORAGE:
                prefix = `@group(${this.group}) @binding(${this.binding}) var<storage, ${this.value.value.$readonly ? 'read' : 'read_write' //this.value.isWritable() || this.value.getType().haveAtomicMembers() ? 'read_write' : 'read'
                }> `;
                break;
            case DeclareType.DECLARE_TYPE_WORKGROUP:
                prefix = `var<workgroup> `;
                break;
            default:
                prefix = `${this.value.getType().isPointerType() ? 'let' : 'var'}${this.value.value.$global && !this.value.getType().isPointerType() ? '<private>' : ''} `;
        }
        {
            const type = this.value.getType();
            const structName = type.isStructType() ? type.structName : null;
            if (structName && ctx.types.findIndex((val)=>val instanceof ASTStructDefine && val.type.structName === structName) < 0) {
                return '';
            } else {
                return `${indent}${prefix}${type.toTypeName('webgpu', this.value.name)};\n`;
            }
        }
    }
    toString(deviceType) {
        return this.value.toString(deviceType);
    }
}
/** @internal */ class ASTFunction extends ASTScope {
    /** @internal */ name;
    /** @internal */ args;
    /** @internal */ isBuiltin;
    /** @internal */ isMainFunc;
    /** @internal */ funcType;
    /** @internal */ builtins;
    /** @internal */ returnType;
    constructor(name, args, isMainFunc, type, isBuiltin = false){
        super();
        this.name = name;
        this.args = args;
        this.funcType = type;
        this.builtins = [];
        this.isBuiltin = isBuiltin;
        this.isMainFunc = isMainFunc;
        this.returnType = type ? type.returnType : null;
    }
    toWebGL(indent, ctx) {
        if (!this.isBuiltin) {
            let str = '';
            const p = [];
            for (const param of this.args){
                let exp;
                let name;
                let qualifier;
                if (param.paramAST instanceof ASTPrimitive) {
                    exp = param.paramAST.value;
                    name = param.paramAST.name;
                    qualifier = '';
                } else {
                    exp = param.paramAST.value.value;
                    name = param.paramAST.value.name;
                    qualifier = `${exp.$inout} `;
                }
                p.push(`${qualifier}${param.getType().toTypeName('webgl', name)}`);
            }
            str += `${indent}${this.returnType.toTypeName('webgl')} ${this.name}(${p.join(',')}) {\n`;
            str += super.toWebGL(indent + '  ', ctx);
            str += `${indent}}\n`;
            return str;
        } else {
            return '';
        }
    }
    toWebGL2(indent, ctx) {
        if (!this.isBuiltin) {
            let str = '';
            const p = [];
            for (const param of this.args){
                let exp;
                let name;
                let qualifier;
                if (param.paramAST instanceof ASTPrimitive) {
                    exp = param.paramAST.value;
                    name = param.paramAST.name;
                    qualifier = '';
                } else {
                    exp = param.paramAST.value.value;
                    name = param.paramAST.value.name;
                    qualifier = `${exp.$inout} `;
                }
                p.push(`${qualifier}${param.getType().toTypeName('webgl2', name)}`);
            }
            str += `${indent}${this.returnType.toTypeName('webgl2')} ${this.name}(${p.join(',')}) {\n`;
            str += super.toWebGL2(indent + '  ', ctx);
            str += `${indent}}\n`;
            return str;
        } else {
            return '';
        }
    }
    toWGSL(indent, ctx) {
        if (!this.isBuiltin) {
            let str = '';
            const p = [
                ...this.builtins
            ];
            for (const param of this.args){
                const name = param.paramAST instanceof ASTPrimitive ? param.paramAST.name : param.paramAST.value.name;
                const paramType = param.paramAST instanceof ASTPrimitive ? param.paramAST.getType() : param.paramAST.value.getType();
                const dataType = paramType.isPointerType() ? paramType.pointerType : paramType;
                if (dataType.isStructType() && ctx.types.findIndex((t)=>t instanceof ASTStructDefine && t.type.structName === dataType.structName) < 0) {
                    continue;
                }
                p.push(`${paramType.toTypeName('webgpu', name)}`);
            }
            let t = '';
            if (this.isMainFunc) {
                switch(ctx.type){
                    case ShaderType.Vertex:
                        t = '@vertex ';
                        break;
                    case ShaderType.Fragment:
                        t = '@fragment ';
                        break;
                    case ShaderType.Compute:
                        t = `@compute @workgroup_size(${ctx.workgroupSize[0]}, ${ctx.workgroupSize[1]}, ${ctx.workgroupSize[2]}) `;
                        break;
                }
            }
            const retName = this.returnType.isVoidType() ? null : this.returnType.toTypeName('webgpu');
            const retStr = retName ? ` -> ${retName}` : '';
            str += `${indent}${t}fn ${this.name}(${p.join(',')})${retStr} {\n`;
            str += super.toWGSL(indent + '  ', ctx);
            str += `${indent}}\n`;
            return str;
        } else {
            return '';
        }
    }
}
/** @internal */ class ASTIf extends ASTScope {
    /** @internal */ keyword;
    /** @internal */ condition;
    /** @internal */ nextElse;
    constructor(keyword, condition){
        super();
        this.keyword = keyword;
        this.condition = condition;
        this.nextElse = null;
        if (this.condition instanceof ASTCallFunction) {
            this.condition.isStatement = false;
        }
    }
    toWebGL(indent, ctx) {
        let str = `${indent}${this.keyword} ${this.condition ? '(' + unbracket(this.condition.toWebGL(indent, ctx)) + ')' : ''} {\n`;
        str += super.toWebGL(indent + '  ', ctx);
        str += `${indent}}\n`;
        if (this.nextElse) {
            str += this.nextElse.toWebGL(indent, ctx);
        }
        return str;
    }
    toWebGL2(indent, ctx) {
        let str = `${indent}${this.keyword} ${this.condition ? '(' + unbracket(this.condition.toWebGL2(indent, ctx)) + ')' : ''} {\n`;
        str += super.toWebGL2(indent + '  ', ctx);
        str += `${indent}}\n`;
        if (this.nextElse) {
            str += this.nextElse.toWebGL2(indent, ctx);
        }
        return str;
    }
    toWGSL(indent, ctx) {
        let str = `${indent}${this.keyword} ${this.condition ? '(' + unbracket(this.condition.toWGSL(indent, ctx)) + ')' : ''} {\n`;
        str += super.toWGSL(indent + '  ', ctx);
        str += `${indent}}\n`;
        if (this.nextElse) {
            str += this.nextElse.toWGSL(indent, ctx);
        }
        return str;
    }
}
/** @internal */ class ASTRange extends ASTScope {
    /** @internal */ init;
    /** @internal */ start;
    /** @internal */ end;
    /** @internal */ open;
    constructor(init, start, end, open){
        super();
        this.init = init;
        this.start = start;
        this.end = end;
        this.open = open;
        this.statements = [];
        if (this.start instanceof ASTCallFunction) {
            this.start.isStatement = false;
        }
        if (this.end instanceof ASTCallFunction) {
            this.end.isStatement = false;
        }
    }
    toWebGL(indent, ctx) {
        const init = this.init.getType().toTypeName('webgl', this.init.name);
        const start = unbracket(this.start.toWebGL(indent, ctx));
        const end = unbracket(this.end.toWebGL(indent, ctx));
        const comp = this.open ? '<' : '<=';
        let str = `${indent}for (${init} = ${start}; ${this.init.name} ${comp} ${end}; ${this.init.name}++) {\n`;
        str += super.toWebGL(indent + '  ', ctx);
        str += `${indent}}\n`;
        return str;
    }
    toWebGL2(indent, ctx) {
        const init = this.init.getType().toTypeName('webgl2', this.init.name);
        const start = unbracket(this.start.toWebGL2(indent, ctx));
        const end = unbracket(this.end.toWebGL2(indent, ctx));
        const comp = this.open ? '<' : '<=';
        let str = `${indent}for (${init} = ${start}; ${this.init.name} ${comp} ${end}; ${this.init.name}++) {\n`;
        str += super.toWebGL2(indent + '  ', ctx);
        str += `${indent}}\n`;
        return str;
    }
    toWGSL(indent, ctx) {
        const init = `var ${this.init.getType().toTypeName('webgpu', this.init.name)}`;
        const start = unbracket(this.start.toWGSL(indent, ctx));
        const end = unbracket(this.end.toWGSL(indent, ctx));
        const incr = new ASTScalar(1, this.init.getType()).toWGSL(indent, ctx);
        const comp = this.open ? '<' : '<=';
        let str = `${indent}for (${init} = ${start}; ${this.init.name} ${comp} ${end}; ${this.init.name} = ${this.init.name} + ${incr}) {\n`;
        str += super.toWGSL(indent + '  ', ctx);
        str += `${indent}}\n`;
        return str;
    }
}
/** @internal */ class ASTDoWhile extends ASTScope {
    /** @internal */ condition;
    constructor(condition){
        super();
        this.condition = condition;
        if (this.condition instanceof ASTCallFunction) {
            this.condition.isStatement = false;
        }
    }
    toWebGL(indent, ctx) {
        throw new Error(`No do-while() loop support for WebGL1.0 device`);
    }
    toWebGL2(indent, ctx) {
        let str = `${indent}do {\n`;
        str += super.toWebGL2(indent + ' ', ctx);
        str += `${indent}} while(${unbracket(this.condition.toWebGL2(indent, ctx))});\n`;
        return str;
    }
    toWGSL(indent, ctx) {
        let str = `${indent}loop {\n`;
        str += super.toWGSL(indent + ' ', ctx);
        str += `${indent}  if (!(${unbracket(this.condition.toWGSL(indent, ctx))})) { break; }\n`;
        str += `${indent}}\n`;
        return str;
    }
}
/** @internal */ class ASTWhile extends ASTScope {
    /** @internal */ condition;
    constructor(condition){
        super();
        this.condition = condition;
        if (this.condition instanceof ASTCallFunction) {
            this.condition.isStatement = false;
        }
    }
    toWebGL(indent, ctx) {
        let str = `${indent}for(int z_tmp_counter = 0; z_tmp_counter == 0; z_tmp_counter += 0) {\n`;
        const indent2 = indent + '  ';
        str += `${indent2}if(!(${unbracket(this.condition.toWebGL(indent, ctx))})){ break; }\n`;
        str += super.toWebGL(indent2, ctx);
        str += `${indent}}\n`;
        return str;
    }
    toWebGL2(indent, ctx) {
        let str = `${indent}while(${unbracket(this.condition.toWebGL2(indent, ctx))}) {\n`;
        str += super.toWebGL2(indent + '  ', ctx);
        str += `${indent}}\n`;
        return str;
    }
    toWGSL(indent, ctx) {
        let str = `${indent}for(;${unbracket(this.condition.toWGSL(indent, ctx))};) {\n`;
        str += super.toWGSL(indent + '  ', ctx);
        str += `${indent}}\n`;
        return str;
    /*
    let str = `${indent}loop {\n`;
    const newIndent = indent + '  ';
    str += `${newIndent}if (!(${unbracket(this.condition.toWGSL(indent, ctx))})) { break; }\n`;
    str += super.toWGSL(newIndent, ctx);
    str += `${indent}}\n`;
    return str;
    */ }
}
/** @internal */ class ASTStructDefine extends ShaderAST {
    /** @internal */ type;
    /** @internal */ prefix;
    /** @internal */ builtin;
    constructor(type, builtin){
        super();
        this.prefix = null;
        this.builtin = builtin;
        this.type = type;
    }
    getType() {
        return this.type;
    }
    toWebGL(indent, ctx) {
        if (!this.builtin) {
            let str = `${indent}struct ${this.type.structName} {\n`;
            for (const arg of this.type.structMembers){
                str += `${indent}  ${arg.type.toTypeName('webgl', arg.name)};\n`;
            }
            str += `${indent}};\n`;
            return str;
        } else {
            return '';
        }
    }
    toWebGL2(indent, ctx) {
        if (!this.builtin) {
            let str = `${indent}struct ${this.type.structName} {\n`;
            for (const arg of this.type.structMembers){
                str += `${indent}  ${arg.type.toTypeName('webgl2', arg.name)};\n`;
            }
            str += `${indent}};\n`;
            return str;
        } else {
            return '';
        }
    }
    toWGSL(indent, ctx) {
        if (!this.builtin) {
            let str = `${indent}struct ${this.type.structName} {\n`;
            str += this.type.structMembers.map((arg, i)=>{
                const prefix = this.prefix ? this.prefix[i] : '';
                const sizePrefix = arg.type.getLayoutSize(this.type.layout) !== arg.type.getLayoutSize('default') ? `@size(${arg.type.getLayoutSize(this.type.layout)}) ` : '';
                const alignPrefix = i > 0 && arg.type.getLayoutAlignment(this.type.layout) !== arg.type.getLayoutAlignment('default') ? `@align(${arg.type.getLayoutAlignment(this.type.layout)}) ` : '';
                return `${indent}  ${prefix}${alignPrefix}${sizePrefix}${arg.type.toTypeName('webgpu', arg.name)}`;
            }).join(',\n');
            str += `\n${indent}};\n`;
            return str;
        } else {
            return '';
        }
    }
}
function convertArgs(args, overload) {
    if (args.length !== overload.argTypes.length) {
        return null;
    }
    const result = [];
    for(let i = 0; i < args.length; i++){
        const isRef = !!overload.argTypes[i].byRef;
        const argType = isRef ? overload.argTypes[i].type.pointerType : overload.argTypes[i].type;
        const arg = args[i];
        if (typeof arg === 'number') {
            if (!isRef && argType.isPrimitiveType() && argType.isScalarType() && argType.primitiveType !== PBPrimitiveType.BOOL) {
                result.push(new ASTScalar(arg, argType));
            } else {
                return null;
            }
        } else if (typeof arg === 'boolean') {
            if (!isRef && argType.isPrimitiveType() && argType.primitiveType === PBPrimitiveType.BOOL) {
                result.push(new ASTScalar(arg, argType));
            } else {
                return null;
            }
        } else if (argType.isCompatibleType(arg.getType())) {
            if (isRef) {
                arg.markWritable();
                result.push(new ASTAddressOf(arg));
            } else {
                result.push(arg);
            }
        } else {
            return null;
        }
    }
    return {
        name: overload.name,
        args: result
    };
}

/**
 * Reflection interface for program builder
 * @public
 */ class PBReflection {
    /** @internal */ _builder;
    /** @internal */ _tagList;
    /** @internal */ _attribList;
    constructor(builder){
        this._builder = builder;
        this._tagList = {};
        this._attribList = {};
    }
    /** Gets all the vertex attributes that was used by the program */ get vertexAttributes() {
        return this._builder.getVertexAttributes();
    }
    /**
   * Check if specified vertex attribute was used by the program
   * @param attrib - The vertex attribute to check
   */ hasVertexAttribute(attrib) {
        return this.vertexAttributes.indexOf(attrib) >= 0;
    }
    /**
   * Clear all contents
   */ clear() {
        this._tagList = {};
        this._attribList = {};
    }
    tag(arg0, arg1) {
        if (typeof arg0 === 'string') {
            if (arg1 === undefined) {
                return this.getTag(arg0);
            } else {
                this.addTag(arg0, arg1);
            }
        } else {
            for (const k of Object.keys(arg0)){
                this.addTag(k, arg0[k]);
            }
        }
    }
    /**
   * Gets the variable which is the vertex attribute of specified semantic
   * @param attrib - The vertex semantic
   */ attribute(attrib) {
        return this._attribList[attrib] || null;
    }
    /** @internal */ setAttrib(attrib, exp) {
        this._attribList[attrib] = exp;
    }
    /** @internal */ addTag(name, exp) {
        this._tagList[name] = exp;
    }
    /** @internal */ getTag(name) {
        const getter = this._tagList[name];
        return getter ? getter(this._builder.getGlobalScope()) : null;
    }
}

let currentProgramBuilder = null;
const constructorCache = new Map();
/** @internal */ function setCurrentProgramBuilder(pb) {
    currentProgramBuilder = pb;
}
/** @internal */ function getCurrentProgramBuilder() {
    return currentProgramBuilder;
}
/** @internal */ function makeConstructor(typeFunc, elementType) {
    const wrappedTypeFunc = new Proxy(typeFunc, {
        get: function(target, prop) {
            if (typeof prop === 'symbol' || prop in target) {
                return target[prop];
            }
            let entries = constructorCache.get(typeFunc);
            if (!entries) {
                entries = {};
                constructorCache.set(typeFunc, entries);
            }
            let ctor = entries[prop];
            if (!ctor) {
                if (elementType.isPrimitiveType() || elementType.isStructType() || elementType.isArrayType() || elementType.isAtomicI32() || elementType.isAtomicU32()) {
                    if (prop === 'ptr') {
                        const pointerType = new PBPointerTypeInfo(elementType, PBAddressSpace.FUNCTION);
                        ctor = function pointerCtor(...args) {
                            if (args.length === 1 && typeof args[0] === 'string') {
                                return new PBShaderExp(args[0], pointerType);
                            } else {
                                throw new Error(`Invalid pointer type constructor`);
                            }
                        };
                    } else {
                        const dim = Number(prop);
                        if (Number.isInteger(dim) && dim >= 0) {
                            const arrayType = new PBArrayTypeInfo(elementType, dim);
                            const arrayTypeFunc = function arrayCtor(...args) {
                                if (args.length === 1 && typeof args[0] === 'string') {
                                    return new PBShaderExp(args[0], arrayType);
                                } else {
                                    const exp = new PBShaderExp('', arrayType);
                                    exp.$ast = new ASTShaderExpConstructor(exp.$typeinfo, args.map((arg)=>arg instanceof PBShaderExp ? arg.$ast : arg));
                                    return exp;
                                }
                            };
                            ctor = makeConstructor(arrayTypeFunc, arrayType);
                        }
                    }
                }
            }
            if (ctor) {
                entries[prop] = ctor;
            }
            return ctor;
        }
    });
    return wrappedTypeFunc;
}
/**
 * Base class for proxiable object
 * @public
 */ class Proxiable {
    /** @internal */ proxy;
    constructor(){
        this.proxy = new Proxy(this, {
            get: function(target, prop) {
                return typeof prop === 'string' ? target.$get(prop) : undefined;
            },
            set: function(target, prop, value) {
                return typeof prop === 'string' ? target.$set(prop, value) : false;
            }
        });
        return this.proxy;
    }
    get $thisProxy() {
        return this.proxy;
    }
}
let uidExp = 0;
/**
 * Base class for a expression in the shader
 * @public
 */ class PBShaderExp extends Proxiable {
    /** @internal */ $uid;
    /** @internal */ $str;
    /** @internal */ $location;
    /** @internal */ $typeinfo;
    /** @internal */ $global;
    /** @internal */ $sampleType;
    /** @internal */ $precision;
    /** @internal */ $ast;
    /** @internal */ $inout;
    /** @internal */ $memberCache;
    /** @internal */ $attrib;
    /** @internal */ $tags;
    /** @internal */ $_group;
    /** @internal */ $declareType;
    /** @internal */ $isBuffer;
    /** @internal */ $readonly;
    /** @internal */ $bindingSize;
    /** @internal */ constructor(str, typeInfo){
        super();
        if (!str && typeInfo.isPointerType()) {
            throw new Error('no default constructor for pointer type');
        }
        this.$uid = uidExp++;
        this.$str = str || '';
        this.$location = 0;
        this.$global = false;
        this.$typeinfo = typeInfo;
        this.$qualifier = null;
        this.$precision = ShaderPrecisionType.NONE;
        this.$ast = new ASTPrimitive(this);
        this.$inout = null;
        this.$memberCache = {};
        this.$attrib = null;
        this.$tags = [];
        this.$_group = null;
        this.$declareType = DeclareType.DECLARE_TYPE_NONE;
        this.$isBuffer = false;
        this.$bindingSize = 0;
        this.$readonly = false;
        if (typeInfo.isTextureType()) {
            if (typeInfo.isDepthTexture()) {
                this.$sampleType = 'depth';
            } else {
                const t = getTextureSampleType(typeInfo);
                if (t.primitiveType === PBPrimitiveType.I32) {
                    this.$sampleType = 'sint';
                } else if (t.primitiveType === PBPrimitiveType.U32) {
                    this.$sampleType = 'uint';
                } else {
                    this.$sampleType = 'float';
                }
            }
        }
    }
    get $group() {
        return this.$_group;
    }
    set $group(val) {
        this.$_group = val;
        if (this.$_group === undefined) {
            debugger;
        }
    }
    /**
   * Point out that the variable should be in uniform address space
   * @param group - The bind group index
   * @returns self
   */ uniform(group) {
        this.$declareType = DeclareType.DECLARE_TYPE_UNIFORM;
        this.$group = group;
        this.$isBuffer = false;
        return this;
    }
    /**
   * Point out that the variable should be an uniform buffer
   * @param group - The bind group index
   * @returns self
   */ uniformBuffer(group, bindingSize = 0) {
        if (!this.$typeinfo.isPrimitiveType() && !this.$typeinfo.isArrayType() && !this.$typeinfo.isStructType()) {
            throw new PBASTError(this.$ast, 'only primitive type, array type or structure type can be set as uniform buffer');
        }
        this.$declareType = DeclareType.DECLARE_TYPE_UNIFORM;
        this.$group = group;
        this.$isBuffer = true;
        this.$bindingSize = bindingSize;
        return this;
    }
    /**
   * Point out that the variable should be in workgroup address space
   *
   * @remarks
   * WebGPU device only
   *
   * @returns self
   */ workgroup() {
        this.$declareType = DeclareType.DECLARE_TYPE_WORKGROUP;
        return this;
    }
    /**
   * Point out that the variable should be in storage address space
   * @param group - The bind group index
   * @returns self
   */ storage(group) {
        if (!this.$typeinfo.isHostSharable()) {
            throw new PBASTError(this.$ast, 'type cannot be declared in storage address space');
        }
        this.$declareType = DeclareType.DECLARE_TYPE_STORAGE;
        this.$group = group;
        this.$isBuffer = false;
        this.$readonly = false;
        return this;
    }
    /**
   * Point out that the variable is read-only and should be in storage address space
   * @param group - The bind group index
   * @returns self
   */ storageReadonly(group) {
        this.storage(group);
        this.$readonly = true;
        return this;
    }
    /**
   * Point out that the variable should be a storage buffer
   * @param group - The bind group index
   * @returns self
   */ storageBuffer(group, bindingSize = 0) {
        if (!this.$typeinfo.isPrimitiveType() && !this.$typeinfo.isArrayType() && !this.$typeinfo.isStructType() && !this.$typeinfo.isAtomicI32() && !this.$typeinfo.isAtomicU32()) {
            throw new PBASTError(this.$ast, 'only primitive type, array type or structure type can be set as storage buffer');
        }
        this.$declareType = DeclareType.DECLARE_TYPE_STORAGE;
        this.$group = group;
        this.$isBuffer = true;
        this.$bindingSize = bindingSize;
        this.$readonly = false;
        return this;
    }
    /**
   * Point out that the variable is read-only and should be a storage buffer
   * @param group - The bind group index
   * @returns self
   */ storageBufferReadonly(group, bindingSize = 0) {
        this.storageBuffer(group, bindingSize);
        this.$readonly = true;
        return this;
    }
    inout() {
        this.$inout = 'inout';
        return this;
    }
    out() {
        this.$inout = 'out';
        return this;
    }
    /**
   * Point out that the variable is a input vertex attribute
   * @param attr - The vertex semantic
   * @returns self
   */ attrib(attr) {
        this.$declareType = DeclareType.DECLARE_TYPE_IN;
        this.$attrib = attr;
        return this;
    }
    /**
   * Create tags for the variable
   * @param args - tags
   * @returns self
   */ tag(...args) {
        args.forEach((val)=>{
            if (this.$tags.indexOf(val) < 0) {
                this.$tags.push(val);
            }
        });
        return this;
    }
    /**
   * Set sample type for the variable if the variable is of type texture
   * @param type - sample type
   * @returns self
   */ sampleType(type) {
        if (type) {
            this.$sampleType = type;
        }
        return this;
    }
    /**
   * Get element in the array by index
   * @param index - index of the element
   * @returns the element variable
   */ at(index) {
        const varType = this.$ast.getType();
        if (!varType.isArrayType() && (!varType.isPrimitiveType() || !varType.isVectorType() && !varType.isMatrixType())) {
            throw new Error('at() function must be used with array types');
        }
        let elementType = null;
        let dimension;
        if (varType.isArrayType()) {
            elementType = varType.elementType;
            dimension = varType.dimension;
        } else if (varType.isVectorType()) {
            elementType = PBPrimitiveTypeInfo.getCachedTypeInfo(varType.resizeType(1, 1));
            dimension = varType.cols;
        } else if (varType.isMatrixType()) {
            elementType = PBPrimitiveTypeInfo.getCachedTypeInfo(varType.resizeType(1, varType.cols));
            dimension = varType.rows;
        }
        const result = new PBShaderExp('', elementType);
        if (typeof index === 'number') {
            if (!Number.isInteger(index)) {
                throw new Error('at() array index must be integer type');
            }
            if (index < 0 || dimension > 0 && index >= dimension) {
                throw new Error('at() array index out of bounds');
            }
            result.$ast = new ASTArrayIndex(this.$ast, new ASTScalar(index, typeI32), elementType);
        } else {
            const type = index.$ast.getType();
            if (!type.isPrimitiveType() || !type.isScalarType()) {
                throw new Error('at() array index must be scalar type');
            }
            let ast = index.$ast;
            if (type.scalarType !== PBPrimitiveType.I32 && type.scalarType !== PBPrimitiveType.U32) {
                ast = new ASTCast(ast, typeI32);
            }
            result.$ast = new ASTArrayIndex(this.$ast, ast, elementType);
        }
        return result;
    }
    /**
   * Set element in the array by index
   * @param index - index of the element
   * @param val - value to set
   */ setAt(index, val) {
        const varType = this.$ast.getType();
        if (!varType.isArrayType()) {
            throw new Error('setAt() function must be used with array types');
        }
        if (typeof index === 'number') {
            if (!Number.isInteger(index)) {
                throw new Error('setAt() array index must be integer type');
            }
            if (index < 0 || varType.dimension > 0 && index >= varType.dimension) {
                throw new Error('setAt() array index out of bounds');
            }
        }
        currentProgramBuilder.getCurrentScope().$ast.statements.push(new ASTAssignment(new ASTLValueArray(new ASTLValueScalar(this.$ast), typeof index === 'number' ? new ASTScalar(index, typeI32) : index.$ast, varType.elementType), val instanceof PBShaderExp ? val.$ast : val));
    }
    /**
   * Point out that the variable should be in high precision
   * @returns self
   */ highp() {
        this.$precision = ShaderPrecisionType.HIGH;
        return this;
    }
    /**
   * Points out that the variable should be in medium precision
   * @returns self
   */ mediump() {
        this.$precision = ShaderPrecisionType.MEDIUM;
        return this;
    }
    /**
   * Points out that the variable should be in low precision
   * @returns self
   */ lowp() {
        this.$precision = ShaderPrecisionType.LOW;
        return this;
    }
    /**
   * Whether this is a constructor
   * @returns true if this is a constructor
   */ isConstructor() {
        return this.$ast instanceof ASTShaderExpConstructor && this.$ast.args.length === 0;
    }
    /**
   * Determine if this variable is of vector type
   * @returns true if the variable is of vector type, otherwise false
   */ isVector() {
        const varType = this.$ast.getType();
        return varType.isPrimitiveType() && varType.isVectorType();
    }
    /**
   * Get vector component count of the variable if this variable is of vector type
   * @returns the vector component count
   */ numComponents() {
        const varType = this.$ast.getType();
        return varType.isPrimitiveType() ? varType.cols : 0;
    }
    /**
   * Get type name of this variable
   * @returns The type name of this variable
   */ getTypeName() {
        return this.$ast.getType().toTypeName(currentProgramBuilder.getDevice().type);
    }
    /** @internal */ $get(prop) {
        if (typeof prop === 'string') {
            if (prop[0] === '$' || prop in this) {
                return this[prop];
            } else {
                let exp = this.$memberCache[prop];
                if (!exp) {
                    const varType = this.$ast?.getType() || this.$typeinfo;
                    const num = Number(prop);
                    if (Number.isNaN(num)) {
                        if (varType.isStructType()) {
                            const elementIndex = varType.structMembers.findIndex((val)=>val.name === prop);
                            if (elementIndex < 0) {
                                throw new Error(`unknown struct member '${prop}'`);
                            }
                            const element = varType.structMembers[elementIndex];
                            if (element.type.isStructType()) {
                                const ctor = currentProgramBuilder.structInfo.structs[element.type.structName];
                                exp = ctor.call(currentProgramBuilder, `${this.$str}.${prop}`);
                            } else {
                                exp = new PBShaderExp(`${this.$str}.${prop}`, element.type);
                            }
                            exp.$ast = new ASTHash(this.$ast, prop, element.type);
                        } else {
                            if (!varType.isPrimitiveType() || !varType.isVectorType()) {
                                throw new Error(`invalid index operation: ${this.$ast.toString(currentProgramBuilder.getDevice().type)}[${prop}]`);
                            }
                            if (prop.length === 0 || prop.length > 4 || [
                                ...prop
                            ].some((val)=>'xyzw'.slice(0, varType.cols).indexOf(val) < 0) && [
                                ...prop
                            ].some((val)=>'rgba'.slice(0, varType.cols).indexOf(val) < 0)) {
                                throw new Error(`unknown swizzle target: ${this.$ast.toString(currentProgramBuilder.getDevice().type)}[${prop}]`);
                            }
                            const type = PBPrimitiveTypeInfo.getCachedTypeInfo(varType.resizeType(1, prop.length));
                            exp = new PBShaderExp('', type);
                            exp.$ast = new ASTHash(this.$ast, prop, type);
                        }
                    } else {
                        if (varType.isArrayType()) {
                            exp = this.at(num);
                        } else if (varType.isPrimitiveType() && varType.isVectorType()) {
                            if (num >= varType.cols) {
                                throw new Error(`component index out of bounds: ${this.$str}[${num}]`);
                            }
                            exp = this.$get('xyzw'[num]);
                        } else if (varType.isPrimitiveType() && varType.isMatrixType()) {
                            const type = PBPrimitiveTypeInfo.getCachedTypeInfo(varType.resizeType(1, varType.cols));
                            exp = new PBShaderExp('', type);
                            exp.$ast = new ASTArrayIndex(this.$ast, new ASTScalar(num, typeI32), type);
                        } else {
                            throw new Error(`invalid index operation: ${this.$str}[${num}]`);
                        }
                    }
                    this.$memberCache[prop] = exp;
                }
                return exp;
            }
        } else {
            return undefined;
        }
    }
    /** @internal */ $set(prop, value) {
        if (typeof prop === 'string') {
            if (prop[0] === '$' || prop in this) {
                this[prop] = value;
            } else {
                if (typeof value !== 'number' && typeof value !== 'boolean' && !(value instanceof PBShaderExp)) {
                    throw new Error(`Invalid output value assignment`);
                }
                const varType = this.$ast?.getType() || this.$typeinfo;
                const num = Number(prop);
                if (Number.isNaN(num)) {
                    if (varType.isStructType()) {
                        const elementIndex = varType.structMembers.findIndex((val)=>val.name === prop);
                        if (elementIndex < 0) {
                            throw new Error(`unknown struct member '${prop}`);
                        }
                        const element = varType.structMembers[elementIndex];
                        let dstAST;
                        if (typeof value === 'number' || typeof value === 'boolean') {
                            if (!element.type.isPrimitiveType() || !element.type.isScalarType()) {
                                throw new Error(`can not set struct member '${prop}: invalid value type`);
                            }
                            dstAST = new ASTScalar(value, element.type);
                        } else if (value instanceof PBShaderExp) {
                            dstAST = value.$ast;
                        }
                        if (!dstAST) {
                            throw new Error(`can not set struct member '${prop}: invalid value type`);
                        }
                        currentProgramBuilder.getCurrentScope().$ast.statements.push(new ASTAssignment(new ASTLValueHash(new ASTLValueScalar(this.$ast), prop, element.type), dstAST));
                    } else {
                        // FIXME: WGSL does not support l-value swizzling
                        if (prop.length > 1 || 'xyzw'.indexOf(prop) < 0 && 'rgba'.indexOf(prop) < 0) {
                            throw new Error(`invalid index operation: ${this.$str}[${num}]`);
                        }
                        if (!varType.isPrimitiveType() || !varType.isVectorType()) {
                            throw new Error(`invalid index operation: ${this.$str}[${num}]`);
                        }
                        const type = PBPrimitiveTypeInfo.getCachedTypeInfo(varType.scalarType);
                        currentProgramBuilder.getCurrentScope().$ast.statements.push(new ASTAssignment(new ASTLValueHash(new ASTLValueScalar(this.$ast), prop, type), value instanceof PBShaderExp ? value.$ast : value));
                    }
                } else {
                    if (varType.isArrayType()) {
                        this.setAt(num, value);
                    } else if (varType.isPrimitiveType() && varType.isVectorType()) {
                        if (num >= varType.cols) {
                            throw new Error(`component index out of bounds: ${this.$str}[${num}]`);
                        }
                        this.$set('xyzw'[num], value);
                    } else if (varType.isPrimitiveType() && varType.isMatrixType()) {
                        if (!(value instanceof PBShaderExp)) {
                            throw new Error(`invalid matrix column vector assignment: ${this.$str}[${num}]`);
                        }
                        const type = PBPrimitiveTypeInfo.getCachedTypeInfo(varType.resizeType(1, varType.cols));
                        currentProgramBuilder.getCurrentScope().$ast.statements.push(new ASTAssignment(new ASTLValueArray(new ASTLValueScalar(this.$ast), new ASTScalar(num, typeI32), type), value.$ast));
                    } else {
                        throw new Error(`invalid index operation: ${this.$str}[${num}]`);
                    }
                }
            }
            return true;
        }
        return false;
    }
}

const genTypeList = [
    [
        typeF32,
        typeF32Vec2,
        typeF32Vec3,
        typeF32Vec4
    ],
    [
        typeI32,
        typeI32Vec2,
        typeI32Vec3,
        typeI32Vec4
    ],
    [
        typeU32$1,
        typeU32Vec2,
        typeU32Vec3,
        typeU32Vec4
    ],
    [
        typeBool,
        typeBVec2,
        typeBVec3,
        typeBVec4
    ]
];
const genMatrixTypeList = [
    typeMat2,
    typeMat2x3,
    typeMat2x4,
    typeMat3x2,
    typeMat3,
    typeMat3x4,
    typeMat4x2,
    typeMat4x3,
    typeMat4
];
function matchFunctionOverloadings(pb, name, ...args) {
    const bit = pb.getDevice().type === 'webgl' ? MASK_WEBGL1 : pb.getDevice().type === 'webgl2' ? MASK_WEBGL2 : MASK_WEBGPU;
    const overloadings = builtinFunctionsAll?.[name].overloads.filter((val)=>!!(val[1] & bit)).map((val)=>val[0]);
    if (!overloadings || overloadings.length === 0) {
        throw new PBDeviceNotSupport(`builtin shader function '${name}'`);
    }
    const argsNonArray = args.map((val)=>pb.normalizeExpValue(val));
    const matchResult = pb._matchFunctionOverloading(overloadings, argsNonArray);
    if (!matchResult) {
        throw new PBOverloadingMatchError(name);
    }
    return matchResult;
}
function callBuiltinChecked(pb, matchResult) {
    return pb.$callFunction(matchResult[0].name, matchResult[1], matchResult[0]);
}
function callBuiltin(pb, name, ...args) {
    return callBuiltinChecked(pb, matchFunctionOverloadings(pb, name, ...args));
}
function genMatrixType(name, shaderTypeMask, r, args) {
    const result = [];
    for(let i = 0; i < genMatrixTypeList.length; i++){
        const returnType = r || genMatrixTypeList[i];
        const argTypes = args.map((arg)=>{
            return {
                type: arg || genMatrixTypeList[i]
            };
        });
        result.push([
            new ASTFunction(name, null, false, new PBFunctionTypeInfo(name, returnType, argTypes), true),
            shaderTypeMask
        ]);
    }
    return result;
}
function genType(name, shaderTypeMask, r, args, vecOnly) {
    if (args.findIndex((val)=>typeof val === 'number') < 0) {
        return [
            [
                new ASTFunction(name, null, false, new PBFunctionTypeInfo(name, r, args.map((arg)=>({
                        type: arg
                    }))), true),
                shaderTypeMask
            ]
        ];
    } else {
        const result = [];
        let i = vecOnly ? 1 : 0;
        for(; i < 4; i++){
            const returnType = typeof r === 'number' ? genTypeList[r][i] : r;
            const argTypes = args.map((arg)=>{
                if (typeof arg === 'number') {
                    return {
                        type: genTypeList[arg][i]
                    };
                } else {
                    return {
                        type: arg
                    };
                }
            });
            result.push([
                new ASTFunction(name, null, false, new PBFunctionTypeInfo(name, returnType, argTypes), true),
                shaderTypeMask
            ]);
        }
        return result;
    }
}
function unaryFunc(a, op, type) {
    const exp = new PBShaderExp('', type);
    exp.$ast = new ASTUnaryFunc(a, op, type);
    return exp;
}
function binaryFunc(a, b, op, type) {
    const exp = new PBShaderExp('', type);
    exp.$ast = new ASTBinaryFunc(a, b, op, type);
    return exp;
}
const MASK_WEBGL1 = 1 << 0;
const MASK_WEBGL2 = 1 << 1;
const MASK_WEBGPU = 1 << 2;
const MASK_WEBGL = MASK_WEBGL1 | MASK_WEBGL2;
const MASK_ALL = MASK_WEBGL | MASK_WEBGPU;
const builtinFunctionsAll = {
    add_2: {
        overloads: [
            ...genType('', MASK_ALL, 0, [
                0,
                0
            ]),
            ...genType('', MASK_ALL, 1, [
                1,
                1
            ]),
            ...genType('', MASK_ALL, 2, [
                2,
                2
            ]),
            ...genType('', MASK_ALL, 3, [
                3,
                3
            ]),
            ...genType('', MASK_ALL, typeF32Vec2, [
                typeF32,
                typeF32Vec2
            ]),
            ...genType('', MASK_ALL, typeF32Vec2, [
                typeF32Vec2,
                typeF32
            ]),
            ...genType('', MASK_ALL, typeF32Vec3, [
                typeF32,
                typeF32Vec3
            ]),
            ...genType('', MASK_ALL, typeF32Vec3, [
                typeF32Vec3,
                typeF32
            ]),
            ...genType('', MASK_ALL, typeF32Vec4, [
                typeF32,
                typeF32Vec4
            ]),
            ...genType('', MASK_ALL, typeF32Vec4, [
                typeF32Vec4,
                typeF32
            ]),
            ...genType('', MASK_ALL, typeI32Vec2, [
                typeI32,
                typeI32Vec2
            ]),
            ...genType('', MASK_ALL, typeI32Vec2, [
                typeI32Vec2,
                typeI32
            ]),
            ...genType('', MASK_ALL, typeI32Vec3, [
                typeI32,
                typeI32Vec3
            ]),
            ...genType('', MASK_ALL, typeI32Vec3, [
                typeI32Vec3,
                typeI32
            ]),
            ...genType('', MASK_ALL, typeI32Vec4, [
                typeI32,
                typeI32Vec4
            ]),
            ...genType('', MASK_ALL, typeI32Vec4, [
                typeI32Vec4,
                typeI32
            ]),
            ...genType('', MASK_ALL, typeU32Vec2, [
                typeU32$1,
                typeU32Vec2
            ]),
            ...genType('', MASK_ALL, typeU32Vec2, [
                typeU32Vec2,
                typeU32$1
            ]),
            ...genType('', MASK_ALL, typeU32Vec3, [
                typeU32$1,
                typeU32Vec3
            ]),
            ...genType('', MASK_ALL, typeU32Vec3, [
                typeU32Vec3,
                typeU32$1
            ]),
            ...genType('', MASK_ALL, typeU32Vec4, [
                typeU32$1,
                typeU32Vec4
            ]),
            ...genType('', MASK_ALL, typeU32Vec4, [
                typeU32Vec4,
                typeU32$1
            ]),
            ...genMatrixType('', MASK_ALL, null, [
                null,
                null
            ])
        ],
        normalizeFunc (pb, name, ...args) {
            if (args.length === 2 && typeof args[0] === 'number' && typeof args[1] === 'number') {
                return args[0] + args[1];
            }
            const matchResult = matchFunctionOverloadings(pb, name, ...args);
            return binaryFunc(matchResult[1][0], matchResult[1][1], '+', matchResult[0].returnType);
        }
    },
    add: {
        overloads: [],
        normalizeFunc (pb, name, ...args) {
            if (args.length < 2) {
                throw new PBParamLengthError('add');
            }
            let result = args[0];
            for(let i = 1; i < args.length; i++){
                result = pb.add_2(result, args[i]);
            }
            return result;
        }
    },
    sub: {
        overloads: [
            ...genType('', MASK_ALL, 0, [
                0,
                0
            ]),
            ...genType('', MASK_ALL, 1, [
                1,
                1
            ]),
            ...genType('', MASK_ALL, 2, [
                2,
                2
            ]),
            ...genType('', MASK_ALL, 3, [
                3,
                3
            ]),
            ...genType('', MASK_ALL, typeF32Vec2, [
                typeF32,
                typeF32Vec2
            ]),
            ...genType('', MASK_ALL, typeF32Vec2, [
                typeF32Vec2,
                typeF32
            ]),
            ...genType('', MASK_ALL, typeF32Vec3, [
                typeF32,
                typeF32Vec3
            ]),
            ...genType('', MASK_ALL, typeF32Vec3, [
                typeF32Vec3,
                typeF32
            ]),
            ...genType('', MASK_ALL, typeF32Vec4, [
                typeF32,
                typeF32Vec4
            ]),
            ...genType('', MASK_ALL, typeF32Vec4, [
                typeF32Vec4,
                typeF32
            ]),
            ...genType('', MASK_ALL, typeI32Vec2, [
                typeI32,
                typeI32Vec2
            ]),
            ...genType('', MASK_ALL, typeI32Vec2, [
                typeI32Vec2,
                typeI32
            ]),
            ...genType('', MASK_ALL, typeI32Vec3, [
                typeI32,
                typeI32Vec3
            ]),
            ...genType('', MASK_ALL, typeI32Vec3, [
                typeI32Vec3,
                typeI32
            ]),
            ...genType('', MASK_ALL, typeI32Vec4, [
                typeI32,
                typeI32Vec4
            ]),
            ...genType('', MASK_ALL, typeI32Vec4, [
                typeI32Vec4,
                typeI32
            ]),
            ...genType('', MASK_ALL, typeU32Vec2, [
                typeU32$1,
                typeU32Vec2
            ]),
            ...genType('', MASK_ALL, typeU32Vec2, [
                typeU32Vec2,
                typeU32$1
            ]),
            ...genType('', MASK_ALL, typeU32Vec3, [
                typeU32$1,
                typeU32Vec3
            ]),
            ...genType('', MASK_ALL, typeU32Vec3, [
                typeU32Vec3,
                typeU32$1
            ]),
            ...genType('', MASK_ALL, typeU32Vec4, [
                typeU32$1,
                typeU32Vec4
            ]),
            ...genType('', MASK_ALL, typeU32Vec4, [
                typeU32Vec4,
                typeU32$1
            ]),
            ...genMatrixType('', MASK_ALL, null, [
                null,
                null
            ])
        ],
        normalizeFunc (pb, name, ...args) {
            const matchResult = matchFunctionOverloadings(pb, name, ...args);
            return binaryFunc(matchResult[1][0], matchResult[1][1], '-', matchResult[0].returnType);
        }
    },
    div: {
        overloads: [
            ...genType('', MASK_ALL, 0, [
                0,
                0
            ]),
            ...genType('', MASK_ALL, 1, [
                1,
                1
            ]),
            ...genType('', MASK_ALL, 2, [
                2,
                2
            ]),
            ...genType('', MASK_ALL, 3, [
                3,
                3
            ]),
            ...genType('', MASK_ALL, typeF32Vec2, [
                typeF32,
                typeF32Vec2
            ]),
            ...genType('', MASK_ALL, typeF32Vec2, [
                typeF32Vec2,
                typeF32
            ]),
            ...genType('', MASK_ALL, typeF32Vec3, [
                typeF32,
                typeF32Vec3
            ]),
            ...genType('', MASK_ALL, typeF32Vec3, [
                typeF32Vec3,
                typeF32
            ]),
            ...genType('', MASK_ALL, typeF32Vec4, [
                typeF32,
                typeF32Vec4
            ]),
            ...genType('', MASK_ALL, typeF32Vec4, [
                typeF32Vec4,
                typeF32
            ]),
            ...genType('', MASK_ALL, typeI32Vec2, [
                typeI32,
                typeI32Vec2
            ]),
            ...genType('', MASK_ALL, typeI32Vec2, [
                typeI32Vec2,
                typeI32
            ]),
            ...genType('', MASK_ALL, typeI32Vec3, [
                typeI32,
                typeI32Vec3
            ]),
            ...genType('', MASK_ALL, typeI32Vec3, [
                typeI32Vec3,
                typeI32
            ]),
            ...genType('', MASK_ALL, typeI32Vec4, [
                typeI32,
                typeI32Vec4
            ]),
            ...genType('', MASK_ALL, typeI32Vec4, [
                typeI32Vec4,
                typeI32
            ]),
            ...genType('', MASK_ALL, typeU32Vec2, [
                typeU32$1,
                typeU32Vec2
            ]),
            ...genType('', MASK_ALL, typeU32Vec2, [
                typeU32Vec2,
                typeU32$1
            ]),
            ...genType('', MASK_ALL, typeU32Vec3, [
                typeU32$1,
                typeU32Vec3
            ]),
            ...genType('', MASK_ALL, typeU32Vec3, [
                typeU32Vec3,
                typeU32$1
            ]),
            ...genType('', MASK_ALL, typeU32Vec4, [
                typeU32$1,
                typeU32Vec4
            ]),
            ...genType('', MASK_ALL, typeU32Vec4, [
                typeU32Vec4,
                typeU32$1
            ])
        ],
        normalizeFunc (pb, name, ...args) {
            const matchResult = matchFunctionOverloadings(pb, name, ...args);
            return binaryFunc(matchResult[1][0], matchResult[1][1], '/', matchResult[0].returnType);
        }
    },
    mul_2: {
        overloads: [
            ...genType('', MASK_ALL, 0, [
                0,
                0
            ]),
            ...genType('', MASK_ALL, 1, [
                1,
                1
            ]),
            ...genType('', MASK_ALL, 2, [
                2,
                2
            ]),
            ...genType('', MASK_ALL, 3, [
                3,
                3
            ]),
            ...genType('', MASK_ALL, typeF32Vec2, [
                typeF32,
                typeF32Vec2
            ]),
            ...genType('', MASK_ALL, typeF32Vec2, [
                typeF32Vec2,
                typeF32
            ]),
            ...genType('', MASK_ALL, typeF32Vec3, [
                typeF32,
                typeF32Vec3
            ]),
            ...genType('', MASK_ALL, typeF32Vec3, [
                typeF32Vec3,
                typeF32
            ]),
            ...genType('', MASK_ALL, typeF32Vec4, [
                typeF32,
                typeF32Vec4
            ]),
            ...genType('', MASK_ALL, typeF32Vec4, [
                typeF32Vec4,
                typeF32
            ]),
            ...genType('', MASK_ALL, typeI32Vec2, [
                typeI32,
                typeI32Vec2
            ]),
            ...genType('', MASK_ALL, typeI32Vec2, [
                typeI32Vec2,
                typeI32
            ]),
            ...genType('', MASK_ALL, typeI32Vec3, [
                typeI32,
                typeI32Vec3
            ]),
            ...genType('', MASK_ALL, typeI32Vec3, [
                typeI32Vec3,
                typeI32
            ]),
            ...genType('', MASK_ALL, typeI32Vec4, [
                typeI32,
                typeI32Vec4
            ]),
            ...genType('', MASK_ALL, typeI32Vec4, [
                typeI32Vec4,
                typeI32
            ]),
            ...genType('', MASK_ALL, typeU32Vec2, [
                typeU32$1,
                typeU32Vec2
            ]),
            ...genType('', MASK_ALL, typeU32Vec2, [
                typeU32Vec2,
                typeU32$1
            ]),
            ...genType('', MASK_ALL, typeU32Vec3, [
                typeU32$1,
                typeU32Vec3
            ]),
            ...genType('', MASK_ALL, typeU32Vec3, [
                typeU32Vec3,
                typeU32$1
            ]),
            ...genType('', MASK_ALL, typeU32Vec4, [
                typeU32$1,
                typeU32Vec4
            ]),
            ...genType('', MASK_ALL, typeU32Vec4, [
                typeU32Vec4,
                typeU32$1
            ]),
            ...genMatrixType('', MASK_ALL, null, [
                typeF32,
                null
            ]),
            ...genMatrixType('', MASK_ALL, null, [
                null,
                typeF32
            ]),
            ...genType('', MASK_ALL, typeMat2, [
                typeMat2,
                typeMat2
            ]),
            ...genType('', MASK_ALL, typeMat3x2, [
                typeMat2,
                typeMat3x2
            ]),
            ...genType('', MASK_ALL, typeMat4x2, [
                typeMat2,
                typeMat4x2
            ]),
            ...genType('', MASK_ALL, typeF32Vec2, [
                typeMat2,
                typeF32Vec2
            ]),
            ...genType('', MASK_ALL, typeF32Vec2, [
                typeF32Vec2,
                typeMat2
            ]),
            ...genType('', MASK_ALL, typeMat2x3, [
                typeMat2x3,
                typeMat2
            ]),
            ...genType('', MASK_ALL, typeMat3, [
                typeMat2x3,
                typeMat3x2
            ]),
            ...genType('', MASK_ALL, typeMat4x3, [
                typeMat2x3,
                typeMat4x2
            ]),
            ...genType('', MASK_ALL, typeF32Vec3, [
                typeMat2x3,
                typeF32Vec2
            ]),
            ...genType('', MASK_ALL, typeF32Vec2, [
                typeF32Vec3,
                typeMat2x3
            ]),
            ...genType('', MASK_ALL, typeMat2x4, [
                typeMat2x4,
                typeMat2
            ]),
            ...genType('', MASK_ALL, typeMat3x4, [
                typeMat2x4,
                typeMat3x2
            ]),
            ...genType('', MASK_ALL, typeMat4, [
                typeMat2x4,
                typeMat4x2
            ]),
            ...genType('', MASK_ALL, typeF32Vec4, [
                typeMat2x4,
                typeF32Vec2
            ]),
            ...genType('', MASK_ALL, typeF32Vec2, [
                typeF32Vec4,
                typeMat2x4
            ]),
            ...genType('', MASK_ALL, typeMat2, [
                typeMat3x2,
                typeMat2x3
            ]),
            ...genType('', MASK_ALL, typeMat3x2, [
                typeMat3x2,
                typeMat3
            ]),
            ...genType('', MASK_ALL, typeMat4x2, [
                typeMat3x2,
                typeMat4x3
            ]),
            ...genType('', MASK_ALL, typeF32Vec2, [
                typeMat3x2,
                typeF32Vec3
            ]),
            ...genType('', MASK_ALL, typeF32Vec3, [
                typeF32Vec2,
                typeMat3x2
            ]),
            ...genType('', MASK_ALL, typeMat2x3, [
                typeMat3,
                typeMat2x3
            ]),
            ...genType('', MASK_ALL, typeMat3, [
                typeMat3,
                typeMat3
            ]),
            ...genType('', MASK_ALL, typeMat4x3, [
                typeMat3,
                typeMat4x3
            ]),
            ...genType('', MASK_ALL, typeF32Vec3, [
                typeMat3,
                typeF32Vec3
            ]),
            ...genType('', MASK_ALL, typeF32Vec3, [
                typeF32Vec3,
                typeMat3
            ]),
            ...genType('', MASK_ALL, typeMat2x4, [
                typeMat3x4,
                typeMat2x3
            ]),
            ...genType('', MASK_ALL, typeMat3x4, [
                typeMat3x4,
                typeMat3
            ]),
            ...genType('', MASK_ALL, typeMat4, [
                typeMat3x4,
                typeMat4x3
            ]),
            ...genType('', MASK_ALL, typeF32Vec4, [
                typeMat3x4,
                typeF32Vec3
            ]),
            ...genType('', MASK_ALL, typeF32Vec3, [
                typeF32Vec4,
                typeMat3x4
            ]),
            ...genType('', MASK_ALL, typeMat2, [
                typeMat4x2,
                typeMat2x4
            ]),
            ...genType('', MASK_ALL, typeMat3x2, [
                typeMat4x2,
                typeMat3x4
            ]),
            ...genType('', MASK_ALL, typeMat4x2, [
                typeMat4x2,
                typeMat4
            ]),
            ...genType('', MASK_ALL, typeF32Vec2, [
                typeMat4x2,
                typeF32Vec4
            ]),
            ...genType('', MASK_ALL, typeF32Vec4, [
                typeF32Vec2,
                typeMat4x2
            ]),
            ...genType('', MASK_ALL, typeMat2x3, [
                typeMat4x3,
                typeMat2x4
            ]),
            ...genType('', MASK_ALL, typeMat3, [
                typeMat4x3,
                typeMat3x4
            ]),
            ...genType('', MASK_ALL, typeMat4x3, [
                typeMat4x3,
                typeMat4
            ]),
            ...genType('', MASK_ALL, typeF32Vec3, [
                typeMat4x3,
                typeF32Vec4
            ]),
            ...genType('', MASK_ALL, typeF32Vec4, [
                typeF32Vec3,
                typeMat4x3
            ]),
            ...genType('', MASK_ALL, typeMat2x4, [
                typeMat4,
                typeMat2x4
            ]),
            ...genType('', MASK_ALL, typeMat3x4, [
                typeMat4,
                typeMat3x4
            ]),
            ...genType('', MASK_ALL, typeMat4, [
                typeMat4,
                typeMat4
            ]),
            ...genType('', MASK_ALL, typeF32Vec4, [
                typeMat4,
                typeF32Vec4
            ]),
            ...genType('', MASK_ALL, typeF32Vec4, [
                typeF32Vec4,
                typeMat4
            ])
        ],
        normalizeFunc (pb, name, ...args) {
            const matchResult = matchFunctionOverloadings(pb, name, ...args);
            return binaryFunc(matchResult[1][0], matchResult[1][1], '*', matchResult[0].returnType);
        }
    },
    mul: {
        overloads: [],
        normalizeFunc (pb, name, ...args) {
            if (args.length < 2) {
                throw new PBParamLengthError('mul');
            }
            let result = args[0];
            for(let i = 1; i < args.length; i++){
                result = pb.mul_2(result, args[i]);
            }
            return result;
        }
    },
    mod: {
        overloads: [
            ...genType('mod', MASK_ALL, 0, [
                0,
                0
            ]),
            ...genType('mod', MASK_ALL, 1, [
                1,
                1
            ]),
            ...genType('mod', MASK_ALL, 2, [
                2,
                2
            ]),
            ...genType('mod', MASK_ALL, 3, [
                3,
                3
            ])
        ],
        normalizeFunc (pb, name, ...args) {
            const matchResult = matchFunctionOverloadings(pb, name, ...args);
            const argType = matchResult[1][0].getType();
            const isIntegerType = argType.isPrimitiveType() && (argType.scalarType === PBPrimitiveType.I32 || argType.scalarType === PBPrimitiveType.U32);
            if (pb.getDevice().type === 'webgl' && isIntegerType) {
                throw new PBDeviceNotSupport('integer modulus');
            }
            if (pb.getDevice().type === 'webgpu' || isIntegerType) {
                return binaryFunc(matchResult[1][0], matchResult[1][1], '%', matchResult[0].returnType);
            } else {
                return callBuiltinChecked(pb, matchResult);
            }
        }
    },
    radians: {
        overloads: genType('radians', MASK_ALL, 0, [
            0
        ])
    },
    degrees: {
        overloads: genType('degrees', MASK_ALL, 0, [
            0
        ])
    },
    sin: {
        overloads: genType('sin', MASK_ALL, 0, [
            0
        ])
    },
    cos: {
        overloads: genType('cos', MASK_ALL, 0, [
            0
        ])
    },
    tan: {
        overloads: genType('tan', MASK_ALL, 0, [
            0
        ])
    },
    asin: {
        overloads: genType('asin', MASK_ALL, 0, [
            0
        ])
    },
    acos: {
        overloads: genType('acos', MASK_ALL, 0, [
            0
        ])
    },
    atan: {
        overloads: genType('atan', MASK_ALL, 0, [
            0
        ])
    },
    atan2: {
        overloads: [
            ...genType('atan', MASK_WEBGL, 0, [
                0,
                0
            ]),
            ...genType('atan2', MASK_WEBGPU, 0, [
                0,
                0
            ])
        ]
    },
    sinh: {
        overloads: genType('sinh', MASK_WEBGL2 | MASK_WEBGPU, 0, [
            0
        ])
    },
    cosh: {
        overloads: genType('cosh', MASK_WEBGL2 | MASK_WEBGPU, 0, [
            0
        ])
    },
    tanh: {
        overloads: genType('tanh', MASK_WEBGL2 | MASK_WEBGPU, 0, [
            0
        ])
    },
    asinh: {
        overloads: genType('asinh', MASK_WEBGL2, 0, [
            0
        ])
    },
    acosh: {
        overloads: genType('acosh', MASK_WEBGL2, 0, [
            0
        ])
    },
    atanh: {
        overloads: genType('atanh', MASK_WEBGL2, 0, [
            0
        ])
    },
    pow: {
        overloads: genType('pow', MASK_ALL, 0, [
            0,
            0
        ])
    },
    exp: {
        overloads: genType('exp', MASK_ALL, 0, [
            0
        ])
    },
    exp2: {
        overloads: genType('exp2', MASK_ALL, 0, [
            0
        ])
    },
    log: {
        overloads: genType('log', MASK_ALL, 0, [
            0
        ])
    },
    log2: {
        overloads: genType('log2', MASK_ALL, 0, [
            0
        ])
    },
    sqrt: {
        overloads: genType('sqrt', MASK_ALL, 0, [
            0
        ])
    },
    inverseSqrt: {
        overloads: [
            ...genType('inversesqrt', MASK_WEBGL, 0, [
                0
            ]),
            ...genType('inverseSqrt', MASK_WEBGPU, 0, [
                0
            ])
        ]
    },
    abs: {
        overloads: [
            ...genType('abs', MASK_ALL, 0, [
                0
            ]),
            ...genType('abs', MASK_WEBGL2 | MASK_WEBGPU, 1, [
                1
            ]),
            ...genType('abs', MASK_WEBGPU, 2, [
                2
            ])
        ]
    },
    sign: {
        overloads: [
            ...genType('sign', MASK_ALL, 0, [
                0
            ]),
            ...genType('sign', MASK_WEBGL2, 1, [
                1
            ])
        ]
    },
    floor: {
        overloads: genType('floor', MASK_ALL, 0, [
            0
        ])
    },
    ceil: {
        overloads: genType('ceil', MASK_ALL, 0, [
            0
        ])
    },
    fract: {
        overloads: genType('fract', MASK_ALL, 0, [
            0
        ])
    },
    fma: {
        overloads: genType('fma', MASK_ALL, 0, [
            0,
            0,
            0
        ]),
        normalizeFunc (pb, name, ...args) {
            const matchResult = matchFunctionOverloadings(pb, name, ...args);
            if (pb.getDevice().type === 'webgpu') {
                return callBuiltinChecked(pb, matchResult);
            } else {
                return pb.add(pb.mul(args[0], args[1]), args[2]);
            }
        }
    },
    round: {
        overloads: genType('round', MASK_WEBGPU, 0, [
            0
        ])
    },
    trunc: {
        overloads: genType('trunc', MASK_WEBGPU, 0, [
            0
        ])
    },
    // TODO: modf
    min: {
        overloads: [
            ...genType('min', MASK_ALL, 0, [
                0,
                0
            ]),
            ...genType('min', MASK_WEBGL2 | MASK_WEBGPU, 1, [
                1,
                1
            ]),
            ...genType('min', MASK_WEBGL2 | MASK_WEBGPU, 2, [
                2,
                2
            ])
        ]
    },
    max: {
        overloads: [
            ...genType('max', MASK_ALL, 0, [
                0,
                0
            ]),
            ...genType('max', MASK_WEBGL2 | MASK_WEBGPU, 1, [
                1,
                1
            ]),
            ...genType('max', MASK_WEBGL2 | MASK_WEBGPU, 2, [
                2,
                2
            ])
        ]
    },
    clamp: {
        overloads: [
            ...genType('clamp', MASK_ALL, 0, [
                0,
                0,
                0
            ]),
            ...genType('clamp', MASK_WEBGL2 | MASK_WEBGPU, 1, [
                1,
                1,
                1
            ]),
            ...genType('clamp', MASK_WEBGL2 | MASK_WEBGPU, 2, [
                2,
                2,
                2
            ])
        ]
    },
    mix: {
        overloads: [
            ...genType('mix', MASK_ALL, 0, [
                0,
                0,
                0
            ]),
            ...genType('mix', MASK_ALL, 0, [
                0,
                0,
                typeF32
            ])
        ]
    },
    step: {
        overloads: genType('step', MASK_ALL, 0, [
            0,
            0
        ])
    },
    smoothStep: {
        overloads: genType('smoothstep', MASK_ALL, 0, [
            0,
            0,
            0
        ])
    },
    isnan: {
        overloads: genType('isnan', MASK_WEBGL2, 3, [
            0
        ])
    },
    isinf: {
        overloads: genType('isinf', MASK_WEBGL2, 3, [
            0
        ])
    },
    length: {
        overloads: genType('length', MASK_ALL, typeF32, [
            0
        ])
    },
    distance: {
        overloads: genType('distance', MASK_ALL, typeF32, [
            0,
            0
        ])
    },
    dot: {
        overloads: [
            ...genType('dot', MASK_ALL, typeF32, [
                0,
                0
            ], true),
            ...genType('dot', MASK_WEBGPU, typeI32, [
                1,
                1
            ], true),
            ...genType('dot', MASK_WEBGPU, typeU32$1, [
                2,
                2
            ], true)
        ]
    },
    cross: {
        overloads: genType('cross', MASK_ALL, typeF32Vec3, [
            typeF32Vec3,
            typeF32Vec3
        ])
    },
    normalize: {
        overloads: genType('normalize', MASK_ALL, 0, [
            0
        ], true)
    },
    faceForward: {
        overloads: [
            ...genType('faceforward', MASK_WEBGL, 0, [
                0,
                0,
                0
            ], true),
            ...genType('faceForward', MASK_WEBGPU, 0, [
                0,
                0,
                0
            ], true)
        ]
    },
    reflect: {
        overloads: genType('reflect', MASK_ALL, 0, [
            0,
            0
        ], true)
    },
    refract: {
        overloads: genType('refract', MASK_ALL, 0, [
            0,
            0,
            typeF32
        ], true)
    },
    frexp: {
        overloads: [
            ...genType('frexp', MASK_WEBGPU, typeFrexpResult, [
                typeF32
            ]),
            ...genType('frexp', MASK_WEBGPU, typeFrexpResultVec2, [
                typeF32Vec2
            ]),
            ...genType('frexp', MASK_WEBGPU, typeFrexpResultVec3, [
                typeF32Vec3
            ]),
            ...genType('frexp', MASK_WEBGPU, typeFrexpResultVec4, [
                typeF32Vec4
            ])
        ]
    },
    outerProduct: {
        overloads: [
            ...genType('outerProduct', MASK_WEBGL2, typeMat2, [
                typeF32Vec2,
                typeF32Vec2
            ]),
            ...genType('outerProduct', MASK_WEBGL2, typeMat3, [
                typeF32Vec3,
                typeF32Vec3
            ]),
            ...genType('outerProduct', MASK_WEBGL2, typeMat4, [
                typeF32Vec4,
                typeF32Vec4
            ]),
            ...genType('outerProduct', MASK_WEBGL2, typeMat2x3, [
                typeF32Vec3,
                typeF32Vec2
            ]),
            ...genType('outerProduct', MASK_WEBGL2, typeMat3x2, [
                typeF32Vec2,
                typeF32Vec3
            ]),
            ...genType('outerProduct', MASK_WEBGL2, typeMat2x4, [
                typeF32Vec4,
                typeF32Vec2
            ]),
            ...genType('outerProduct', MASK_WEBGL2, typeMat4x2, [
                typeF32Vec2,
                typeF32Vec4
            ]),
            ...genType('outerProduct', MASK_WEBGL2, typeMat3x4, [
                typeF32Vec4,
                typeF32Vec3
            ]),
            ...genType('outerProduct', MASK_WEBGL2, typeMat4x3, [
                typeF32Vec3,
                typeF32Vec4
            ])
        ]
    },
    transpose: {
        overloads: [
            ...genType('transpose', MASK_WEBGL2 | MASK_WEBGPU, typeMat2, [
                typeMat2
            ]),
            ...genType('transpose', MASK_WEBGL2 | MASK_WEBGPU, typeMat3, [
                typeMat3
            ]),
            ...genType('transpose', MASK_WEBGL2 | MASK_WEBGPU, typeMat4, [
                typeMat4
            ]),
            ...genType('transpose', MASK_WEBGL2 | MASK_WEBGPU, typeMat2x3, [
                typeMat3x2
            ]),
            ...genType('transpose', MASK_WEBGL2 | MASK_WEBGPU, typeMat3x2, [
                typeMat2x3
            ]),
            ...genType('transpose', MASK_WEBGL2 | MASK_WEBGPU, typeMat2x4, [
                typeMat4x2
            ]),
            ...genType('transpose', MASK_WEBGL2 | MASK_WEBGPU, typeMat4x2, [
                typeMat2x4
            ]),
            ...genType('transpose', MASK_WEBGL2 | MASK_WEBGPU, typeMat3x4, [
                typeMat4x3
            ]),
            ...genType('transpose', MASK_WEBGL2 | MASK_WEBGPU, typeMat4x3, [
                typeMat3x4
            ])
        ]
    },
    determinant: {
        overloads: [
            ...genType('determinant', MASK_WEBGL2 | MASK_WEBGPU, typeF32, [
                typeMat2
            ]),
            ...genType('determinant', MASK_WEBGL2 | MASK_WEBGPU, typeF32, [
                typeMat3
            ]),
            ...genType('determinant', MASK_WEBGL2 | MASK_WEBGPU, typeF32, [
                typeMat4
            ])
        ]
    },
    inverse: {
        overloads: [
            ...genType('inverse', MASK_WEBGL2, typeMat2, [
                typeMat2
            ]),
            ...genType('inverse', MASK_WEBGL2, typeMat3, [
                typeMat3
            ]),
            ...genType('inverse', MASK_WEBGL2, typeMat4, [
                typeMat4
            ])
        ]
    },
    lessThan: {
        overloads: [
            ...genType('lessThan', MASK_ALL, 3, [
                0,
                0
            ]),
            ...genType('lessThan', MASK_ALL, 3, [
                1,
                1
            ]),
            ...genType('lessThan', MASK_ALL, 3, [
                2,
                2
            ])
        ],
        normalizeFunc (pb, name, ...args) {
            const matchResult = matchFunctionOverloadings(pb, name, ...args);
            const argType = matchResult[1][0].getType();
            if (pb.getDevice().type === 'webgpu' || argType.isPrimitiveType() && argType.isScalarType()) {
                return binaryFunc(matchResult[1][0], matchResult[1][1], '<', matchResult[0].returnType);
            } else {
                return callBuiltinChecked(pb, matchResult);
            }
        }
    },
    lessThanEqual: {
        overloads: [
            ...genType('lessThanEqual', MASK_ALL, 3, [
                0,
                0
            ]),
            ...genType('lessThanEqual', MASK_ALL, 3, [
                1,
                1
            ]),
            ...genType('lessThanEqual', MASK_ALL, 3, [
                2,
                2
            ])
        ],
        normalizeFunc (pb, name, ...args) {
            const matchResult = matchFunctionOverloadings(pb, name, ...args);
            const argType = matchResult[1][0].getType();
            if (pb.getDevice().type === 'webgpu' || argType.isPrimitiveType() && argType.isScalarType()) {
                return binaryFunc(matchResult[1][0], matchResult[1][1], '<=', matchResult[0].returnType);
            } else {
                return callBuiltinChecked(pb, matchResult);
            }
        }
    },
    greaterThan: {
        overloads: [
            ...genType('greaterThan', MASK_ALL, 3, [
                0,
                0
            ]),
            ...genType('greaterThan', MASK_ALL, 3, [
                1,
                1
            ]),
            ...genType('greaterThan', MASK_ALL, 3, [
                2,
                2
            ])
        ],
        normalizeFunc (pb, name, ...args) {
            const matchResult = matchFunctionOverloadings(pb, name, ...args);
            const argType = matchResult[1][0].getType();
            if (pb.getDevice().type === 'webgpu' || argType.isPrimitiveType() && argType.isScalarType()) {
                return binaryFunc(matchResult[1][0], matchResult[1][1], '>', matchResult[0].returnType);
            } else {
                return callBuiltinChecked(pb, matchResult);
            }
        }
    },
    greaterThanEqual: {
        overloads: [
            ...genType('greaterThanEqual', MASK_ALL, 3, [
                0,
                0
            ]),
            ...genType('greaterThanEqual', MASK_ALL, 3, [
                1,
                1
            ]),
            ...genType('greaterThanEqual', MASK_ALL, 3, [
                2,
                2
            ])
        ],
        normalizeFunc (pb, name, ...args) {
            const matchResult = matchFunctionOverloadings(pb, name, ...args);
            const argType = matchResult[1][0].getType();
            if (pb.getDevice().type === 'webgpu' || argType.isPrimitiveType() && argType.isScalarType()) {
                return binaryFunc(matchResult[1][0], matchResult[1][1], '>=', matchResult[0].returnType);
            } else {
                return callBuiltinChecked(pb, matchResult);
            }
        }
    },
    compEqual: {
        overloads: [
            ...genType('equal', MASK_ALL, 3, [
                0,
                0
            ]),
            ...genType('equal', MASK_ALL, 3, [
                1,
                1
            ]),
            ...genType('equal', MASK_ALL, 3, [
                2,
                2
            ]),
            ...genType('equal', MASK_ALL, 3, [
                3,
                3
            ])
        ],
        normalizeFunc (pb, name, ...args) {
            const matchResult = matchFunctionOverloadings(pb, name, ...args);
            const argType = matchResult[1][0].getType();
            if (pb.getDevice().type === 'webgpu' || argType.isPrimitiveType() && argType.isScalarType()) {
                return binaryFunc(matchResult[1][0], matchResult[1][1], '==', matchResult[0].returnType);
            } else {
                return callBuiltinChecked(pb, matchResult);
            }
        }
    },
    compNotEqual: {
        overloads: [
            ...genType('notEqual', MASK_ALL, 3, [
                0,
                0
            ]),
            ...genType('notEqual', MASK_ALL, 3, [
                1,
                1
            ]),
            ...genType('notEqual', MASK_ALL, 3, [
                2,
                2
            ]),
            ...genType('notEqual', MASK_ALL, 3, [
                3,
                3
            ])
        ],
        normalizeFunc (pb, name, ...args) {
            const matchResult = matchFunctionOverloadings(pb, name, ...args);
            const argType = matchResult[1][0].getType();
            if (pb.getDevice().type === 'webgpu' || argType.isPrimitiveType() && argType.isScalarType()) {
                return binaryFunc(matchResult[1][0], matchResult[1][1], '!=', matchResult[0].returnType);
            } else {
                return callBuiltinChecked(pb, matchResult);
            }
        }
    },
    equal: {
        overloads: [
            ...genType('equal', MASK_ALL, typeBool, [
                0,
                0
            ]),
            ...genType('equal', MASK_ALL, typeBool, [
                1,
                1
            ]),
            ...genType('equal', MASK_ALL, typeBool, [
                2,
                2
            ]),
            ...genType('equal', MASK_ALL, typeBool, [
                3,
                3
            ])
        ],
        normalizeFunc (pb, name, ...args) {
            const matchResult = matchFunctionOverloadings(pb, name, ...args);
            const argType = matchResult[1][0].getType();
            if (pb.getDevice().type === 'webgpu' && argType.isPrimitiveType() && !argType.isScalarType()) {
                return pb.all(pb.compEqual(args[0], args[1]));
            } else {
                return binaryFunc(matchResult[1][0], matchResult[1][1], '==', matchResult[0].returnType);
            }
        }
    },
    notEqual: {
        overloads: [
            ...genType('notEqual', MASK_ALL, typeBool, [
                0,
                0
            ]),
            ...genType('notEqual', MASK_ALL, typeBool, [
                1,
                1
            ]),
            ...genType('notEqual', MASK_ALL, typeBool, [
                2,
                2
            ]),
            ...genType('notEqual', MASK_ALL, typeBool, [
                3,
                3
            ])
        ],
        normalizeFunc (pb, name, ...args) {
            const matchResult = matchFunctionOverloadings(pb, name, ...args);
            const argType = matchResult[1][0].getType();
            if (pb.getDevice().type === 'webgpu' && argType.isPrimitiveType() && !argType.isScalarType()) {
                return pb.any(pb.compNotEqual(args[0], args[1]));
            } else {
                return binaryFunc(matchResult[1][0], matchResult[1][1], '!=', matchResult[0].returnType);
            }
        }
    },
    any: {
        overloads: genType('any', MASK_ALL, typeBool, [
            3
        ], true)
    },
    all: {
        overloads: genType('all', MASK_ALL, typeBool, [
            3
        ], true)
    },
    not: {
        overloads: genType('not', MASK_ALL, 3, [
            3
        ]),
        normalizeFunc (pb, name, ...args) {
            const matchResult = matchFunctionOverloadings(pb, name, ...args);
            const argType = matchResult[1][0].getType();
            if (pb.getDevice().type === 'webgpu' || argType.isPrimitiveType() && argType.isScalarType()) {
                return unaryFunc(matchResult[1][0], '!', matchResult[0].returnType);
            } else {
                return callBuiltinChecked(pb, matchResult);
            }
        }
    },
    neg: {
        overloads: [
            ...genType('neg', MASK_ALL, 0, [
                0
            ]),
            ...genType('neg', MASK_ALL, 1, [
                1
            ])
        ],
        normalizeFunc (pb, name, ...args) {
            const matchResult = matchFunctionOverloadings(pb, name, ...args);
            return unaryFunc(matchResult[1][0], '-', matchResult[0].returnType);
        }
    },
    or_2: {
        overloads: genType('or', MASK_ALL, typeBool, [
            3,
            3
        ]),
        normalizeFunc (pb, name, ...args) {
            const matchResult = matchFunctionOverloadings(pb, name, ...args);
            return binaryFunc(matchResult[1][0], matchResult[1][1], '||', matchResult[0].returnType);
        }
    },
    or: {
        overloads: [],
        normalizeFunc (pb, name, ...args) {
            if (args.length < 2) {
                throw new PBParamLengthError('or');
            }
            let result = args[0];
            for(let i = 1; i < args.length; i++){
                result = pb.or_2(result, args[i]);
            }
            return result;
        }
    },
    compOr: {
        overloads: [
            ...genType('compOr', MASK_WEBGL2 | MASK_WEBGPU, 1, [
                1,
                1
            ]),
            ...genType('compOr', MASK_WEBGL2 | MASK_WEBGPU, 2, [
                2,
                2
            ])
        ],
        normalizeFunc (pb, name, ...args) {
            const matchResult = matchFunctionOverloadings(pb, name, ...args);
            return binaryFunc(matchResult[1][0], matchResult[1][1], '|', matchResult[0].returnType);
        }
    },
    and_2: {
        overloads: genType('and', MASK_ALL, typeBool, [
            3,
            3
        ]),
        normalizeFunc (pb, name, ...args) {
            const matchResult = matchFunctionOverloadings(pb, name, ...args);
            return binaryFunc(matchResult[1][0], matchResult[1][1], '&&', matchResult[0].returnType);
        }
    },
    and: {
        overloads: [],
        normalizeFunc (pb, name, ...args) {
            if (args.length < 2) {
                throw new PBParamLengthError('and');
            }
            let result = args[0];
            for(let i = 1; i < args.length; i++){
                result = pb.and_2(result, args[i]);
            }
            return result;
        }
    },
    compAnd: {
        overloads: [
            ...genType('compAnd', MASK_WEBGL2 | MASK_WEBGPU, 1, [
                1,
                1
            ]),
            ...genType('compAnd', MASK_WEBGL2 | MASK_WEBGPU, 2, [
                2,
                2
            ])
        ],
        normalizeFunc (pb, name, ...args) {
            const matchResult = matchFunctionOverloadings(pb, name, ...args);
            return binaryFunc(matchResult[1][0], matchResult[1][1], '&', matchResult[0].returnType);
        }
    },
    compXor: {
        overloads: [
            ...genType('compXor', MASK_WEBGL2 | MASK_WEBGPU, 1, [
                1,
                1
            ]),
            ...genType('compXor', MASK_WEBGL2 | MASK_WEBGPU, 2, [
                2,
                2
            ])
        ],
        normalizeFunc (pb, name, ...args) {
            const matchResult = matchFunctionOverloadings(pb, name, ...args);
            return binaryFunc(matchResult[1][0], matchResult[1][1], '^', matchResult[0].returnType);
        }
    },
    sal: {
        overloads: [
            ...genType('sal', MASK_WEBGL2 | MASK_WEBGPU, 1, [
                1,
                2
            ]),
            ...genType('sal', MASK_WEBGL2 | MASK_WEBGPU, 2, [
                2,
                2
            ])
        ],
        normalizeFunc (pb, name, ...args) {
            const matchResult = matchFunctionOverloadings(pb, name, ...args);
            return binaryFunc(matchResult[1][0], matchResult[1][1], '<<', matchResult[0].returnType);
        }
    },
    sar: {
        overloads: [
            ...genType('sar', MASK_WEBGL2 | MASK_WEBGPU, 1, [
                1,
                2
            ]),
            ...genType('sar', MASK_WEBGL2 | MASK_WEBGPU, 2, [
                2,
                2
            ])
        ],
        normalizeFunc (pb, name, ...args) {
            const matchResult = matchFunctionOverloadings(pb, name, ...args);
            return binaryFunc(matchResult[1][0], matchResult[1][1], '>>', matchResult[0].returnType);
        }
    },
    arrayLength: {
        overloads: [],
        normalizeFunc (pb, name, ...args) {
            if (args.length !== 1) {
                throw new PBParamLengthError('arrayLength');
            }
            if (!(args[0] instanceof PBShaderExp)) {
                throw new PBParamValueError('arrayLength', 'array');
            }
            const type = args[0].$ast.getType();
            const arrayType = type.isPointerType() ? type.pointerType : type;
            if (!arrayType.isArrayType() || arrayType.dimension !== 0) {
                throw new PBParamTypeError('arrayLength', 'array');
            }
            const arg = type.isArrayType() ? pb.addressOf(args[0]).$ast : args[0].$ast;
            return pb.$callFunctionNoCheck(name, [
                arg
            ], typeU32$1);
        }
    },
    select: {
        overloads: [
            ...genType('select', MASK_WEBGPU, 0, [
                0,
                0,
                typeBool
            ]),
            ...genType('select', MASK_WEBGPU, 1, [
                1,
                1,
                typeBool
            ]),
            ...genType('select', MASK_WEBGPU, 2, [
                2,
                2,
                typeBool
            ]),
            ...genType('select', MASK_WEBGPU, 3, [
                3,
                3,
                typeBool
            ]),
            ...genType('select', MASK_WEBGPU, 0, [
                0,
                0,
                3
            ], true),
            ...genType('select', MASK_WEBGPU, 1, [
                1,
                1,
                3
            ], true),
            ...genType('select', MASK_WEBGPU, 2, [
                2,
                2,
                3
            ], true),
            ...genType('select', MASK_WEBGPU, 3, [
                3,
                3,
                3
            ], true),
            ...genType('mix', MASK_WEBGL2, 0, [
                0,
                0,
                3
            ]),
            ...genType('mix', MASK_WEBGL2, 1, [
                1,
                1,
                3
            ]),
            ...genType('mix', MASK_WEBGL2, 2, [
                2,
                2,
                3
            ])
        ]
    },
    floatBitsToInt: {
        overloads: genType('floatBitsToInt', MASK_WEBGL2, 1, [
            0
        ]),
        normalizeFunc (pb, name, ...args) {
            if (args.length !== 1) {
                throw new PBParamLengthError('floatBitsToInt');
            }
            if (!(args[0] instanceof PBShaderExp)) {
                if (typeof args[0] !== 'number') {
                    throw new PBParamValueError('floatBitsToInt', 'x');
                }
            } else {
                const type = args[0].$ast.getType();
                if (type.typeId !== typeF32.typeId) {
                    throw new PBParamTypeError('floatBitsToInt', 'x');
                }
            }
            if (pb.getDevice().type === 'webgpu') {
                return pb.$callFunctionNoCheck('bitcast<i32>', [
                    args[0] instanceof PBShaderExp ? args[0].$ast : new ASTScalar(args[0], typeF32)
                ], typeI32);
            } else {
                return callBuiltin(pb, name, ...args);
            }
        }
    },
    floatBitsToUint: {
        overloads: genType('floatBitsToUint', MASK_WEBGL2, 2, [
            0
        ]),
        normalizeFunc (pb, name, ...args) {
            if (args.length !== 1) {
                throw new PBParamLengthError('floatBitsToUint');
            }
            if (!(args[0] instanceof PBShaderExp)) {
                if (typeof args[0] !== 'number') {
                    throw new PBParamValueError('floatBitsToUint', 'x');
                }
            } else {
                const type = args[0].$ast.getType();
                if (type.typeId !== typeF32.typeId) {
                    throw new PBParamTypeError('floatBitsToUint', 'x');
                }
            }
            if (pb.getDevice().type === 'webgpu') {
                return pb.$callFunctionNoCheck('bitcast<u32>', [
                    args[0] instanceof PBShaderExp ? args[0].$ast : new ASTScalar(args[0], typeF32)
                ], typeU32$1);
            } else {
                return callBuiltin(pb, name, ...args);
            }
        }
    },
    intBitsToFloat: {
        overloads: genType('intBitsToFloat', MASK_WEBGL2, 0, [
            1
        ]),
        normalizeFunc (pb, name, ...args) {
            if (args.length !== 1) {
                throw new PBParamLengthError('intBitsToFloat');
            }
            if (!(args[0] instanceof PBShaderExp)) {
                if (typeof args[0] !== 'number') {
                    throw new PBParamValueError('intBitsToFloat', 'x');
                }
            } else {
                const type = args[0].$ast.getType();
                if (type.typeId !== typeI32.typeId) {
                    throw new PBParamTypeError('intBitsToFloat', 'x');
                }
            }
            if (pb.getDevice().type === 'webgpu') {
                return pb.$callFunctionNoCheck('bitcast<f32>', [
                    args[0] instanceof PBShaderExp ? args[0].$ast : new ASTScalar(args[0], typeI32)
                ], typeF32);
            } else {
                return callBuiltin(pb, name, ...args);
            }
        }
    },
    uintBitsToFloat: {
        overloads: genType('uintBitsToFloat', MASK_WEBGL2, 0, [
            2
        ]),
        normalizeFunc (pb, name, ...args) {
            if (args.length !== 1) {
                throw new PBParamLengthError('uintBitsToFloat');
            }
            if (!(args[0] instanceof PBShaderExp)) {
                if (typeof args[0] !== 'number') {
                    throw new PBParamValueError('uintBitsToFloat', 'x');
                }
            } else {
                const type = args[0].$ast.getType();
                if (type.typeId !== typeU32$1.typeId) {
                    throw new PBParamTypeError('uintBitsToFloat', 'x');
                }
            }
            if (pb.getDevice().type === 'webgpu') {
                return pb.$callFunctionNoCheck('bitcast<f32>', [
                    args[0] instanceof PBShaderExp ? args[0].$ast : new ASTScalar(args[0], typeU32$1)
                ], typeF32);
            } else {
                return callBuiltin(pb, name, ...args);
            }
        }
    },
    pack4x8snorm: {
        overloads: genType('pack4x8snorm', MASK_WEBGPU, typeU32$1, [
            typeF32Vec4
        ])
    },
    unpack4x8snorm: {
        overloads: genType('unpack4x8snorm', MASK_WEBGPU, typeF32Vec4, [
            typeU32$1
        ])
    },
    pack4x8unorm: {
        overloads: genType('pack4x8unorm', MASK_WEBGPU, typeU32$1, [
            typeF32Vec4
        ])
    },
    unpack4x8unorm: {
        overloads: genType('unpack4x8unorm', MASK_WEBGPU, typeF32Vec4, [
            typeU32$1
        ])
    },
    pack2x16snorm: {
        overloads: [
            ...genType('pack2x16snorm', MASK_WEBGPU, typeU32$1, [
                typeF32Vec2
            ]),
            ...genType('packSnorm2x16', MASK_WEBGL2, typeU32$1, [
                typeF32Vec2
            ])
        ]
    },
    unpack2x16snorm: {
        overloads: [
            ...genType('unpack2x16snorm', MASK_WEBGPU, typeF32Vec2, [
                typeU32$1
            ]),
            ...genType('unpackSnorm2x16', MASK_WEBGL2, typeF32Vec2, [
                typeU32$1
            ])
        ]
    },
    pack2x16unorm: {
        overloads: [
            ...genType('pack2x16unorm', MASK_WEBGPU, typeU32$1, [
                typeF32Vec2
            ]),
            ...genType('packUnorm2x16', MASK_WEBGL2, typeU32$1, [
                typeF32Vec2
            ])
        ]
    },
    unpack2x16unorm: {
        overloads: [
            ...genType('unpack2x16unorm', MASK_WEBGPU, typeF32Vec2, [
                typeU32$1
            ]),
            ...genType('unpackUnorm2x16', MASK_WEBGL2, typeF32Vec2, [
                typeU32$1
            ])
        ]
    },
    pack2x16float: {
        overloads: [
            ...genType('pack2x16float', MASK_WEBGPU, typeU32$1, [
                typeF32Vec2
            ]),
            ...genType('packHalf2x16', MASK_WEBGL2, typeU32$1, [
                typeF32Vec2
            ])
        ]
    },
    unpack2x16float: {
        overloads: [
            ...genType('unpack2x16float', MASK_WEBGPU, typeF32Vec2, [
                typeU32$1
            ]),
            ...genType('unpackHalf2x16', MASK_WEBGL2, typeF32Vec2, [
                typeU32$1
            ])
        ]
    },
    matrixCompMult: {
        overloads: genMatrixType('matrixCompMult', MASK_WEBGL, null, [
            null,
            null
        ])
    },
    dpdx: {
        overloads: [
            ...genType('dFdx', MASK_WEBGL, 0, [
                0
            ]),
            ...genType('dpdx', MASK_WEBGPU, 0, [
                0
            ])
        ]
    },
    dpdy: {
        overloads: [
            ...genType('dFdy', MASK_WEBGL, 0, [
                0
            ]),
            ...genType('dpdy', MASK_WEBGPU, 0, [
                0
            ])
        ]
    },
    fwidth: {
        overloads: genType('fwidth', MASK_ALL, 0, [
            0
        ])
    },
    dpdxCoarse: {
        overloads: [
            ...genType('dpdxCoarse', MASK_WEBGPU, 0, [
                0
            ]),
            ...genType('dFdx', MASK_WEBGL, 0, [
                0
            ])
        ]
    },
    dpdxFine: {
        overloads: [
            ...genType('dpdxFine', MASK_WEBGPU, 0, [
                0
            ]),
            ...genType('dFdx', MASK_WEBGL, 0, [
                0
            ])
        ]
    },
    dpdyCoarse: {
        overloads: [
            ...genType('dpdyCoarse', MASK_WEBGPU, 0, [
                0
            ]),
            ...genType('dFdy', MASK_WEBGL, 0, [
                0
            ])
        ]
    },
    dpdyFine: {
        overloads: [
            ...genType('dpdyFine', MASK_WEBGPU, 0, [
                0
            ]),
            ...genType('dFdy', MASK_WEBGL, 0, [
                0
            ])
        ]
    },
    // textureDimensions(tex: PBShaderExp, level?: number|PBShaderExp);
    textureDimensions: {
        overloads: [
            ...genType('textureDimensions', MASK_WEBGPU, typeU32$1, [
                typeTex1D,
                typeI32
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32$1, [
                typeITex1D,
                typeI32
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32$1, [
                typeUTex1D,
                typeI32
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec2, [
                typeTex2D,
                typeI32
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec2, [
                typeITex2D,
                typeI32
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec2, [
                typeUTex2D,
                typeI32
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec2, [
                typeTex2DArray,
                typeI32
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec2, [
                typeITex2DArray,
                typeI32
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec2, [
                typeUTex2DArray,
                typeI32
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec3, [
                typeTex3D,
                typeI32
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec3, [
                typeITex3D,
                typeI32
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec3, [
                typeUTex3D,
                typeI32
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec2, [
                typeTexCube,
                typeI32
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec2, [
                typeITexCube,
                typeI32
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec2, [
                typeUTexCube,
                typeI32
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec2, [
                typeTexCubeArray,
                typeI32
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec2, [
                typeITexCubeArray,
                typeI32
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec2, [
                typeUTexCubeArray,
                typeI32
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec2, [
                typeTexMultisampled2D
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec2, [
                typeITexMultisampled2D
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec2, [
                typeUTexMultisampled2D
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec2, [
                typeTexDepth2D,
                typeI32
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec2, [
                typeTexDepth2DArray,
                typeI32
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec2, [
                typeTexDepthCube,
                typeI32
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec2, [
                typeTexDepthCubeArray,
                typeI32
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec2, [
                typeTexDepthMultisampled2D
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32$1, [
                typeTexStorage1D_rgba8unorm
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32$1, [
                typeTexStorage1D_rgba8snorm
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32$1, [
                typeTexStorage1D_rgba8uint
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32$1, [
                typeTexStorage1D_rgba8sint
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32$1, [
                typeTexStorage1D_rgba16uint
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32$1, [
                typeTexStorage1D_rgba16sint
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32$1, [
                typeTexStorage1D_rgba16float
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32$1, [
                typeTexStorage1D_rgba32uint
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32$1, [
                typeTexStorage1D_rgba32sint
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32$1, [
                typeTexStorage1D_rgba32float
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32$1, [
                typeTexStorage1D_rg32uint
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32$1, [
                typeTexStorage1D_rg32sint
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32$1, [
                typeTexStorage1D_rg32float
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32$1, [
                typeTexStorage1D_r32uint
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32$1, [
                typeTexStorage1D_r32sint
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32$1, [
                typeTexStorage1D_r32float
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec2, [
                typeTexStorage2D_rgba8unorm
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec2, [
                typeTexStorage2D_rgba8snorm
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec2, [
                typeTexStorage2D_rgba8uint
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec2, [
                typeTexStorage2D_rgba8sint
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec2, [
                typeTexStorage2D_rgba16uint
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec2, [
                typeTexStorage2D_rgba16sint
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec2, [
                typeTexStorage2D_rgba16float
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec2, [
                typeTexStorage2D_rgba32uint
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec2, [
                typeTexStorage2D_rgba32sint
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec2, [
                typeTexStorage2D_rgba32float
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec2, [
                typeTexStorage2D_rg32uint
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec2, [
                typeTexStorage2D_rg32sint
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec2, [
                typeTexStorage2D_rg32float
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec2, [
                typeTexStorage2D_r32uint
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec2, [
                typeTexStorage2D_r32sint
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec2, [
                typeTexStorage2D_r32float
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec2, [
                typeTexStorage2DArray_rgba8unorm
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec2, [
                typeTexStorage2DArray_rgba8snorm
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec2, [
                typeTexStorage2DArray_rgba8uint
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec2, [
                typeTexStorage2DArray_rgba8sint
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec2, [
                typeTexStorage2DArray_rgba16uint
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec2, [
                typeTexStorage2DArray_rgba16sint
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec2, [
                typeTexStorage2DArray_rgba16float
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec2, [
                typeTexStorage2DArray_rgba32uint
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec2, [
                typeTexStorage2DArray_rgba32sint
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec2, [
                typeTexStorage2DArray_rgba32float
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec2, [
                typeTexStorage2DArray_rg32uint
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec2, [
                typeTexStorage2DArray_rg32sint
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec2, [
                typeTexStorage2DArray_rg32float
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec2, [
                typeTexStorage2DArray_r32uint
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec2, [
                typeTexStorage2DArray_r32sint
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec2, [
                typeTexStorage2DArray_r32float
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec3, [
                typeTexStorage3D_rgba8unorm
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec3, [
                typeTexStorage3D_rgba8snorm
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec3, [
                typeTexStorage3D_rgba8uint
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec3, [
                typeTexStorage3D_rgba8sint
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec3, [
                typeTexStorage3D_rgba16uint
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec3, [
                typeTexStorage3D_rgba16sint
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec3, [
                typeTexStorage3D_rgba16float
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec3, [
                typeTexStorage3D_rgba32uint
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec3, [
                typeTexStorage3D_rgba32sint
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec3, [
                typeTexStorage3D_rgba32float
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec3, [
                typeTexStorage3D_rg32uint
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec3, [
                typeTexStorage3D_rg32sint
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec3, [
                typeTexStorage3D_rg32float
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec3, [
                typeTexStorage3D_r32uint
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec3, [
                typeTexStorage3D_r32sint
            ]),
            ...genType('textureDimensions', MASK_WEBGPU, typeU32Vec3, [
                typeTexStorage3D_r32float
            ]),
            ...genType('textureSize', MASK_WEBGL2, typeI32Vec2, [
                typeTex1D,
                typeI32
            ]),
            ...genType('textureSize', MASK_WEBGL2, typeI32Vec2, [
                typeTex2D,
                typeI32
            ]),
            ...genType('textureSize', MASK_WEBGL2, typeI32Vec2, [
                typeITex1D,
                typeI32
            ]),
            ...genType('textureSize', MASK_WEBGL2, typeI32Vec2, [
                typeITex2D,
                typeI32
            ]),
            ...genType('textureSize', MASK_WEBGL2, typeI32Vec2, [
                typeUTex1D,
                typeI32
            ]),
            ...genType('textureSize', MASK_WEBGL2, typeI32Vec2, [
                typeUTex2D,
                typeI32
            ]),
            ...genType('textureSize', MASK_WEBGL2, typeI32Vec2, [
                typeTex2DArray,
                typeI32
            ]),
            ...genType('textureSize', MASK_WEBGL2, typeI32Vec2, [
                typeITex2DArray,
                typeI32
            ]),
            ...genType('textureSize', MASK_WEBGL2, typeI32Vec2, [
                typeUTex2DArray,
                typeI32
            ]),
            ...genType('textureSize', MASK_WEBGL2, typeI32Vec2, [
                typeTexCube,
                typeI32
            ]),
            ...genType('textureSize', MASK_WEBGL2, typeI32Vec2, [
                typeITexCube,
                typeI32
            ]),
            ...genType('textureSize', MASK_WEBGL2, typeI32Vec2, [
                typeUTexCube,
                typeI32
            ]),
            ...genType('textureSize', MASK_WEBGL2, typeI32Vec3, [
                typeTex3D,
                typeI32
            ]),
            ...genType('textureSize', MASK_WEBGL2, typeI32Vec3, [
                typeITex3D,
                typeI32
            ]),
            ...genType('textureSize', MASK_WEBGL2, typeI32Vec3, [
                typeUTex3D,
                typeI32
            ]),
            ...genType('textureSize', MASK_WEBGL2, typeI32Vec2, [
                typeTexDepth2D,
                typeI32
            ]),
            ...genType('textureSize', MASK_WEBGL2, typeI32Vec2, [
                typeTexDepthCube,
                typeI32
            ]),
            ...genType('textureSize', MASK_WEBGL2, typeI32Vec2, [
                typeTexDepth2DArray,
                typeI32
            ])
        ],
        normalizeFunc (pb, name, ...args) {
            if (args.length < 1 || args.length > 2) {
                throw new PBParamLengthError('textureDimensions');
            }
            if (!(args[0] instanceof PBShaderExp)) {
                throw new PBParamValueError('textureDimensions', 'tex');
            }
            const texType = args[0].$ast.getType();
            if (!texType.isTextureType()) {
                throw new PBParamTypeError('textureDimensions', 'tex');
            }
            if (pb.getDevice().type === 'webgpu') {
                if (texType.isMultisampledTexture() || texType.isStorageTexture()) {
                    if (args[1] !== undefined) {
                        throw new PBParamValueError('textureDimensions', 'level');
                    }
                }
                return callBuiltin(pb, name, ...args);
            } else if (pb.getDevice().type === 'webgl2') {
                const tex = args[0];
                const level = args[1] || 0;
                return texType.is1DTexture() ? callBuiltin(pb, name, tex, level).x : callBuiltin(pb, name, tex, level);
            }
        }
    },
    // textureGather(tex: PBShaderExp, sampler: PBShaderExp, coords: PBShaderExp);
    // textureGather(component: number|PBShaderExp, tex: PBShaderExp, sampler: PBShaderExp, coords: PBShaderExp);
    textureGather: {
        overloads: [
            ...genType('textureGather', MASK_WEBGPU, typeF32Vec4, [
                typeI32,
                typeTex2D,
                typeSampler,
                typeF32Vec2
            ]),
            ...genType('textureGather', MASK_WEBGPU, typeI32Vec4, [
                typeI32,
                typeITex2D,
                typeSampler,
                typeF32Vec2
            ]),
            ...genType('textureGather', MASK_WEBGPU, typeU32Vec4, [
                typeI32,
                typeUTex2D,
                typeSampler,
                typeF32Vec2
            ]),
            ...genType('textureGather', MASK_WEBGPU, typeF32Vec4, [
                typeI32,
                typeTexCube,
                typeSampler,
                typeF32Vec3
            ]),
            ...genType('textureGather', MASK_WEBGPU, typeI32Vec4, [
                typeI32,
                typeITexCube,
                typeSampler,
                typeF32Vec3
            ]),
            ...genType('textureGather', MASK_WEBGPU, typeU32Vec4, [
                typeI32,
                typeUTexCube,
                typeSampler,
                typeF32Vec3
            ]),
            ...genType('textureGather', MASK_WEBGPU, typeF32Vec4, [
                typeTexDepth2D,
                typeSampler,
                typeF32Vec2
            ]),
            ...genType('textureGather', MASK_WEBGPU, typeF32Vec4, [
                typeTexDepthCube,
                typeSampler,
                typeF32Vec3
            ])
        ]
    },
    // textureArrayGather(tex: PBShaderExp, sampler: PBShaderExp, coords: PBShaderExp, arrayIndex: number|PBShaderExp);
    // textureArrayGather(component: number|PBShaderExp, tex: PBShaderExp, sampler: PBShaderExp, coords: PBShaderExp, arrayIndex: number|PBShaderExp);
    textureArrayGather: {
        overloads: [
            ...genType('textureGather', MASK_WEBGPU, typeF32Vec4, [
                typeI32,
                typeTex2DArray,
                typeSampler,
                typeF32Vec2,
                typeI32
            ]),
            ...genType('textureGather', MASK_WEBGPU, typeI32Vec4, [
                typeI32,
                typeITex2DArray,
                typeSampler,
                typeF32Vec2,
                typeI32
            ]),
            ...genType('textureGather', MASK_WEBGPU, typeU32Vec4, [
                typeI32,
                typeUTex2DArray,
                typeSampler,
                typeF32Vec2,
                typeI32
            ]),
            ...genType('textureGather', MASK_WEBGPU, typeF32Vec4, [
                typeI32,
                typeTexCubeArray,
                typeSampler,
                typeF32Vec3,
                typeI32
            ]),
            ...genType('textureGather', MASK_WEBGPU, typeI32Vec4, [
                typeI32,
                typeITexCubeArray,
                typeSampler,
                typeF32Vec3,
                typeI32
            ]),
            ...genType('textureGather', MASK_WEBGPU, typeU32Vec4, [
                typeI32,
                typeUTexCubeArray,
                typeSampler,
                typeF32Vec3,
                typeI32
            ]),
            ...genType('textureGather', MASK_WEBGPU, typeF32Vec4, [
                typeTexDepth2DArray,
                typeSampler,
                typeF32Vec2,
                typeI32
            ]),
            ...genType('textureGather', MASK_WEBGPU, typeF32Vec4, [
                typeTexDepthCubeArray,
                typeSampler,
                typeF32Vec3,
                typeI32
            ])
        ]
    },
    // textureGatherCompare(tex: PBShaderExp, samplerCompare: PBShaderExp, coords: PBShaderExp, depthRef: number|PBShaderExp);
    textureGatherCompare: {
        overloads: [
            ...genType('textureGatherCompare', MASK_WEBGPU, typeF32Vec4, [
                typeTexDepth2D,
                typeSamplerComparison,
                typeF32Vec2,
                typeF32
            ]),
            ...genType('textureGatherCompare', MASK_WEBGPU, typeF32Vec4, [
                typeTexDepthCube,
                typeSamplerComparison,
                typeF32Vec3,
                typeF32
            ])
        ]
    },
    // textureArrayGatherCompare(tex: PBShaderExp, samplerCompare: PBShaderExp, coords: PBShaderExp, arrayIndex: number|PBShaderExp, depthRef: number|PBShaderExp);
    textureArrayGatherCompare: {
        overloads: [
            ...genType('textureGatherCompare', MASK_WEBGPU, typeF32Vec4, [
                typeTexDepth2DArray,
                typeSamplerComparison,
                typeF32Vec2,
                typeI32,
                typeF32
            ]),
            ...genType('textureGatherCompare', MASK_WEBGPU, typeF32Vec4, [
                typeTexDepthCubeArray,
                typeSamplerComparison,
                typeF32Vec3,
                typeI32,
                typeF32
            ])
        ]
    },
    // textureLoad(tex: PBShaderExp, coords: number|PBShaderExp, levelOrSampleIndex: number|PBShaderExp);
    textureLoad: {
        overloads: [
            ...genType('textureLoad', MASK_WEBGPU, typeF32Vec4, [
                typeTex1D,
                typeI32,
                typeI32
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeI32Vec4, [
                typeITex1D,
                typeI32,
                typeI32
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeU32Vec4, [
                typeUTex1D,
                typeI32,
                typeI32
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeF32Vec4, [
                typeTexStorage1D_bgra8unorm,
                typeI32
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeF32Vec4, [
                typeTexStorage1D_r32float,
                typeI32
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeI32Vec4, [
                typeTexStorage1D_r32sint,
                typeI32
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeU32Vec4, [
                typeTexStorage1D_r32uint,
                typeI32
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeF32Vec4, [
                typeTexStorage1D_rg32float,
                typeI32
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeI32Vec4, [
                typeTexStorage1D_rg32sint,
                typeI32
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeU32Vec4, [
                typeTexStorage1D_rg32uint,
                typeI32
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeF32Vec4, [
                typeTexStorage1D_rgba16float,
                typeI32
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeI32Vec4, [
                typeTexStorage1D_rgba16sint,
                typeI32
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeU32Vec4, [
                typeTexStorage1D_rgba16uint,
                typeI32
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeF32Vec4, [
                typeTexStorage1D_rgba32float,
                typeI32
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeI32Vec4, [
                typeTexStorage1D_rgba32sint,
                typeI32
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeU32Vec4, [
                typeTexStorage1D_rgba32uint,
                typeI32
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeI32Vec4, [
                typeTexStorage1D_rgba8sint,
                typeI32
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeU32Vec4, [
                typeTexStorage1D_rgba8uint,
                typeI32
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeF32Vec4, [
                typeTexStorage1D_rgba8snorm,
                typeI32
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeF32Vec4, [
                typeTexStorage1D_rgba8unorm,
                typeI32
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeF32Vec4, [
                typeTex2D,
                typeI32Vec2,
                typeI32
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeI32Vec4, [
                typeITex2D,
                typeI32Vec2,
                typeI32
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeU32Vec4, [
                typeUTex2D,
                typeI32Vec2,
                typeI32
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeF32Vec4, [
                typeTexStorage2D_bgra8unorm,
                typeI32Vec2
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeF32Vec4, [
                typeTexStorage2D_r32float,
                typeI32Vec2
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeI32Vec4, [
                typeTexStorage2D_r32sint,
                typeI32Vec2
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeU32Vec4, [
                typeTexStorage2D_r32uint,
                typeI32Vec2
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeF32Vec4, [
                typeTexStorage2D_rg32float,
                typeI32Vec2
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeI32Vec4, [
                typeTexStorage2D_rg32sint,
                typeI32Vec2
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeU32Vec4, [
                typeTexStorage2D_rg32uint,
                typeI32Vec2
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeF32Vec4, [
                typeTexStorage2D_rgba16float,
                typeI32Vec2
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeI32Vec4, [
                typeTexStorage2D_rgba16sint,
                typeI32Vec2
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeU32Vec4, [
                typeTexStorage2D_rgba16uint,
                typeI32Vec2
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeF32Vec4, [
                typeTexStorage2D_rgba32float,
                typeI32Vec2
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeI32Vec4, [
                typeTexStorage2D_rgba32sint,
                typeI32Vec2
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeU32Vec4, [
                typeTexStorage2D_rgba32uint,
                typeI32Vec2
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeI32Vec4, [
                typeTexStorage2D_rgba8sint,
                typeI32Vec2
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeU32Vec4, [
                typeTexStorage2D_rgba8uint,
                typeI32Vec2
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeF32Vec4, [
                typeTexStorage2D_rgba8snorm,
                typeI32Vec2
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeF32Vec4, [
                typeTexStorage2D_rgba8unorm,
                typeI32Vec2
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeF32Vec4, [
                typeTex3D,
                typeI32Vec3,
                typeI32
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeI32Vec4, [
                typeITex3D,
                typeI32Vec3,
                typeI32
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeU32Vec4, [
                typeUTex3D,
                typeI32Vec3,
                typeI32
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeF32Vec4, [
                typeTexStorage3D_bgra8unorm,
                typeI32Vec3
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeF32Vec4, [
                typeTexStorage3D_r32float,
                typeI32Vec3
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeI32Vec4, [
                typeTexStorage3D_r32sint,
                typeI32Vec3
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeU32Vec4, [
                typeTexStorage3D_r32uint,
                typeI32Vec3
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeF32Vec4, [
                typeTexStorage3D_rg32float,
                typeI32Vec3
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeI32Vec4, [
                typeTexStorage3D_rg32sint,
                typeI32Vec3
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeU32Vec4, [
                typeTexStorage3D_rg32uint,
                typeI32Vec3
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeF32Vec4, [
                typeTexStorage3D_rgba16float,
                typeI32Vec3
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeI32Vec4, [
                typeTexStorage3D_rgba16sint,
                typeI32Vec3
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeU32Vec4, [
                typeTexStorage3D_rgba16uint,
                typeI32Vec3
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeF32Vec4, [
                typeTexStorage3D_rgba32float,
                typeI32Vec3
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeI32Vec4, [
                typeTexStorage3D_rgba32sint,
                typeI32Vec3
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeU32Vec4, [
                typeTexStorage3D_rgba32uint,
                typeI32Vec3
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeI32Vec4, [
                typeTexStorage3D_rgba8sint,
                typeI32Vec3
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeU32Vec4, [
                typeTexStorage3D_rgba8uint,
                typeI32Vec3
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeF32Vec4, [
                typeTexStorage3D_rgba8snorm,
                typeI32Vec3
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeF32Vec4, [
                typeTexStorage3D_rgba8unorm,
                typeI32Vec3
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeF32Vec4, [
                typeTexMultisampled2D,
                typeI32Vec2,
                typeI32
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeI32Vec4, [
                typeITexMultisampled2D,
                typeI32Vec2,
                typeI32
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeU32Vec4, [
                typeUTexMultisampled2D,
                typeI32Vec2,
                typeI32
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeF32Vec4, [
                typeTexExternal,
                typeI32Vec2
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeF32, [
                typeTexDepth2D,
                typeI32Vec2,
                typeI32
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeF32, [
                typeTexDepthMultisampled2D,
                typeI32Vec2,
                typeI32
            ]),
            ...genType('texelFetch', MASK_WEBGL2, typeF32Vec4, [
                typeTex1D,
                typeI32Vec2,
                typeI32
            ]),
            ...genType('texelFetch', MASK_WEBGL2, typeF32Vec4, [
                typeTex2D,
                typeI32Vec2,
                typeI32
            ]),
            ...genType('texelFetch', MASK_WEBGL2, typeF32Vec4, [
                typeTex3D,
                typeI32Vec3,
                typeI32
            ]),
            ...genType('texelFetch', MASK_WEBGL2, typeU32Vec4, [
                typeTexExternal,
                typeI32Vec2,
                typeI32
            ]),
            ...genType('texelFetch', MASK_WEBGL2, typeF32Vec4, [
                typeITex1D,
                typeI32Vec2,
                typeI32
            ]),
            ...genType('texelFetch', MASK_WEBGL2, typeI32Vec4, [
                typeITex2D,
                typeI32Vec2,
                typeI32
            ]),
            ...genType('texelFetch', MASK_WEBGL2, typeI32Vec4, [
                typeITex3D,
                typeI32Vec3,
                typeI32
            ]),
            ...genType('texelFetch', MASK_WEBGL2, typeF32Vec4, [
                typeUTex1D,
                typeI32Vec2,
                typeI32
            ]),
            ...genType('texelFetch', MASK_WEBGL2, typeU32Vec4, [
                typeUTex2D,
                typeI32Vec2,
                typeI32
            ]),
            ...genType('texelFetch', MASK_WEBGL2, typeU32Vec4, [
                typeUTex3D,
                typeI32Vec3,
                typeI32
            ])
        ],
        normalizeFunc (pb, name, ...args) {
            if (args.length === 0) {
                throw new PBParamLengthError('textureLoad');
            }
            if (!(args[0] instanceof PBShaderExp)) {
                throw new PBParamValueError('textureLoad', 'tex');
            }
            const texType = args[0].$ast.getType();
            if (!texType.isTextureType()) {
                throw new PBParamTypeError('textureLoad', 'tex');
            }
            if (pb.getDevice().type === 'webgl2') {
                if (args.length !== 3) {
                    throw new PBParamLengthError('textureLoad');
                }
                if (texType.is1DTexture()) {
                    if (typeof args[1] === 'number') {
                        if (!Number.isInteger(args[1])) {
                            throw new PBParamTypeError('textureLoad', 'coord');
                        }
                    } else if (args[1] instanceof PBShaderExp) {
                        const coordType = args[1].$ast.getType();
                        if (!coordType.isPrimitiveType() || !coordType.isScalarType() || coordType.scalarType !== PBPrimitiveType.I32) {
                            throw new PBParamTypeError('textureLoad', 'coord');
                        }
                    } else {
                        throw new PBParamTypeError('textureLoad', 'coord');
                    }
                    args[1] = pb.ivec2(args[1], 0);
                }
            } else if (pb.getDevice().type === 'webgpu') {
                if (texType.isExternalTexture()) {
                    args = args.slice(0, 2);
                }
                if (texType.isStorageTexture()) {
                    texType.readable = true;
                }
            }
            return callBuiltin(pb, name, ...args);
        }
    },
    // textureArrayLoad(tex: PBShaderExp, coords: number|PBShaderExp, arrayIndex: number|PBShaderExp, level: number|PBShaderExp);
    textureArrayLoad: {
        overloads: [
            ...genType('textureLoad', MASK_WEBGPU, typeF32Vec4, [
                typeTex2DArray,
                typeI32Vec2,
                typeI32,
                typeI32
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeI32Vec4, [
                typeITex2DArray,
                typeI32Vec2,
                typeI32,
                typeI32
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeU32Vec4, [
                typeUTex2DArray,
                typeI32Vec2,
                typeI32,
                typeI32
            ]),
            ...genType('textureLoad', MASK_WEBGPU, typeF32, [
                typeTexDepth2DArray,
                typeI32Vec2,
                typeI32,
                typeI32
            ]),
            ...genType('texelFetch', MASK_WEBGL2, typeF32Vec4, [
                typeTex2DArray,
                typeI32Vec3,
                typeI32
            ]),
            ...genType('texelFetch', MASK_WEBGL2, typeI32Vec4, [
                typeITex2DArray,
                typeI32Vec3,
                typeI32
            ]),
            ...genType('texelFetch', MASK_WEBGL2, typeU32Vec4, [
                typeUTex2DArray,
                typeI32Vec3,
                typeI32
            ])
        ],
        normalizeFunc (pb, name, ...args) {
            if (pb.getDevice().type === 'webgl2') {
                if (args.length !== 4) {
                    throw new PBParamLengthError('textureArrayLoad');
                }
                const tex = args[0];
                const coords = pb.ivec3(args[1], args[2]);
                const level = args[3];
                return callBuiltin(pb, name, tex, coords, level);
            } else {
                return callBuiltin(pb, name, ...args);
            }
        }
    },
    // textureStore(tex: PBShaderExp, coords: number|PBShaderExp, value: PBShaderExp);
    textureStore: {
        overloads: [
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage1D_rgba8unorm,
                typeU32$1,
                typeF32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage1D_rgba8snorm,
                typeU32$1,
                typeF32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage1D_rgba8uint,
                typeU32$1,
                typeU32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage1D_rgba8sint,
                typeU32$1,
                typeI32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage1D_rgba16uint,
                typeU32$1,
                typeU32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage1D_rgba16sint,
                typeU32$1,
                typeI32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage1D_rgba16float,
                typeU32$1,
                typeF32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage1D_rgba32uint,
                typeU32$1,
                typeU32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage1D_rgba32sint,
                typeU32$1,
                typeI32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage1D_rgba32float,
                typeU32$1,
                typeF32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage1D_rg32uint,
                typeU32$1,
                typeU32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage1D_rg32sint,
                typeU32$1,
                typeI32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage1D_rg32float,
                typeU32$1,
                typeF32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage1D_r32uint,
                typeU32$1,
                typeU32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage1D_r32sint,
                typeU32$1,
                typeI32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage1D_r32float,
                typeU32$1,
                typeF32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage2D_rgba8unorm,
                typeU32Vec2,
                typeF32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage2D_rgba8snorm,
                typeU32Vec2,
                typeF32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage2D_rgba8uint,
                typeU32Vec2,
                typeU32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage2D_rgba8sint,
                typeU32Vec2,
                typeI32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage2D_rgba16uint,
                typeU32Vec2,
                typeU32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage2D_rgba16sint,
                typeU32Vec2,
                typeI32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage2D_rgba16float,
                typeU32Vec2,
                typeF32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage2D_rgba32uint,
                typeU32Vec2,
                typeU32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage2D_rgba32sint,
                typeU32Vec2,
                typeI32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage2D_rgba32float,
                typeU32Vec2,
                typeF32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage2D_rg32uint,
                typeU32Vec2,
                typeU32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage2D_rg32sint,
                typeU32Vec2,
                typeI32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage2D_rg32float,
                typeU32Vec2,
                typeF32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage2D_r32uint,
                typeU32Vec2,
                typeU32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage2D_r32uint,
                typeI32Vec2,
                typeU32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage2D_r32sint,
                typeU32Vec2,
                typeI32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage2D_r32float,
                typeU32Vec2,
                typeF32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage3D_rgba8unorm,
                typeU32Vec3,
                typeF32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage3D_rgba8snorm,
                typeU32Vec3,
                typeF32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage3D_rgba8uint,
                typeU32Vec3,
                typeU32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage3D_rgba8sint,
                typeU32Vec3,
                typeI32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage3D_rgba16uint,
                typeU32Vec3,
                typeU32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage3D_rgba16sint,
                typeU32Vec3,
                typeI32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage3D_rgba16float,
                typeU32Vec3,
                typeF32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage3D_rgba32uint,
                typeU32Vec3,
                typeU32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage3D_rgba32sint,
                typeU32Vec3,
                typeI32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage3D_rgba32float,
                typeU32Vec3,
                typeF32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage3D_rg32uint,
                typeU32Vec3,
                typeU32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage3D_rg32sint,
                typeU32Vec3,
                typeI32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage3D_rg32float,
                typeU32Vec3,
                typeF32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage3D_r32uint,
                typeU32Vec3,
                typeU32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage3D_r32sint,
                typeU32Vec3,
                typeI32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage3D_r32float,
                typeU32Vec3,
                typeF32Vec4
            ])
        ],
        normalizeFunc (pb, name, ...args) {
            if (pb.getDevice().type === 'webgpu') {
                const tex = args[0];
                if (tex instanceof PBShaderExp) {
                    const texType = tex.$ast.getType();
                    if (texType?.isTextureType() && texType.isStorageTexture()) {
                        texType.writable = true;
                    }
                }
            }
            return callBuiltin(pb, name, ...args);
        }
    },
    // textureArrayStore(tex: PBShaderExp, coords: PBShaderExp, arrayIndex: number|PBShaderExp, value: PBShaderExp);
    textureArrayStore: {
        overloads: [
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage2DArray_rgba8unorm,
                typeI32Vec2,
                typeI32,
                typeF32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage2DArray_rgba8snorm,
                typeI32Vec2,
                typeI32,
                typeF32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage2DArray_rgba8uint,
                typeI32Vec2,
                typeI32,
                typeU32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage2DArray_rgba8sint,
                typeI32Vec2,
                typeI32,
                typeI32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage2DArray_rgba16uint,
                typeI32Vec2,
                typeI32,
                typeU32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage2DArray_rgba16sint,
                typeI32Vec2,
                typeI32,
                typeI32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage2DArray_rgba16float,
                typeI32Vec2,
                typeI32,
                typeF32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage2DArray_rgba32uint,
                typeI32Vec2,
                typeI32,
                typeU32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage2DArray_rgba32sint,
                typeI32Vec2,
                typeI32,
                typeI32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage2DArray_rgba32float,
                typeI32Vec2,
                typeI32,
                typeF32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage2DArray_rg32uint,
                typeI32Vec2,
                typeI32,
                typeU32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage2DArray_rg32sint,
                typeI32Vec2,
                typeI32,
                typeI32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage2DArray_rg32float,
                typeI32Vec2,
                typeI32,
                typeF32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage2DArray_r32uint,
                typeI32Vec2,
                typeI32,
                typeU32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage2DArray_r32sint,
                typeI32Vec2,
                typeI32,
                typeI32Vec4
            ]),
            ...genType('textureStore', MASK_WEBGPU, typeVoid, [
                typeTexStorage2DArray_r32float,
                typeI32Vec2,
                typeI32,
                typeF32Vec4
            ])
        ]
    },
    // textureNumLayers(tex: PBShaderExp);
    textureNumLayers: {
        overloads: [
            ...genType('textureNumLayers', MASK_WEBGPU, typeI32, [
                typeTex2DArray
            ]),
            ...genType('textureNumLayers', MASK_WEBGPU, typeI32, [
                typeITex2DArray
            ]),
            ...genType('textureNumLayers', MASK_WEBGPU, typeI32, [
                typeUTex2DArray
            ]),
            ...genType('textureNumLayers', MASK_WEBGPU, typeI32, [
                typeTexCubeArray
            ]),
            ...genType('textureNumLayers', MASK_WEBGPU, typeI32, [
                typeITexCubeArray
            ]),
            ...genType('textureNumLayers', MASK_WEBGPU, typeI32, [
                typeUTexCubeArray
            ]),
            ...genType('textureNumLayers', MASK_WEBGPU, typeI32, [
                typeTexDepth2DArray
            ]),
            ...genType('textureNumLayers', MASK_WEBGPU, typeI32, [
                typeTexDepthCubeArray
            ]),
            ...genType('textureNumLayers', MASK_WEBGPU, typeI32, [
                typeTexStorage2DArray_r32float
            ]),
            ...genType('textureNumLayers', MASK_WEBGPU, typeI32, [
                typeTexStorage2DArray_r32sint
            ]),
            ...genType('textureNumLayers', MASK_WEBGPU, typeI32, [
                typeTexStorage2DArray_r32uint
            ]),
            ...genType('textureNumLayers', MASK_WEBGPU, typeI32, [
                typeTexStorage2DArray_rg32float
            ]),
            ...genType('textureNumLayers', MASK_WEBGPU, typeI32, [
                typeTexStorage2DArray_rg32sint
            ]),
            ...genType('textureNumLayers', MASK_WEBGPU, typeI32, [
                typeTexStorage2DArray_rg32uint
            ]),
            ...genType('textureNumLayers', MASK_WEBGPU, typeI32, [
                typeTexStorage2DArray_rgba16float
            ]),
            ...genType('textureNumLayers', MASK_WEBGPU, typeI32, [
                typeTexStorage2DArray_rgba16sint
            ]),
            ...genType('textureNumLayers', MASK_WEBGPU, typeI32, [
                typeTexStorage2DArray_rgba16uint
            ]),
            ...genType('textureNumLayers', MASK_WEBGPU, typeI32, [
                typeTexStorage2DArray_rgba32float
            ]),
            ...genType('textureNumLayers', MASK_WEBGPU, typeI32, [
                typeTexStorage2DArray_rgba32sint
            ]),
            ...genType('textureNumLayers', MASK_WEBGPU, typeI32, [
                typeTexStorage2DArray_rgba32uint
            ]),
            ...genType('textureNumLayers', MASK_WEBGPU, typeI32, [
                typeTexStorage2DArray_rgba8sint
            ]),
            ...genType('textureNumLayers', MASK_WEBGPU, typeI32, [
                typeTexStorage2DArray_rgba8snorm
            ]),
            ...genType('textureNumLayers', MASK_WEBGPU, typeI32, [
                typeTexStorage2DArray_rgba8uint
            ]),
            ...genType('textureNumLayers', MASK_WEBGPU, typeI32, [
                typeTexStorage2DArray_rgba8unorm
            ])
        ]
    },
    // textureNumLevels(tex: PBShaderExp);
    textureNumLevels: {
        overloads: [
            ...genType('textureNumLevels', MASK_WEBGPU, typeI32, [
                typeTex1D
            ]),
            ...genType('textureNumLevels', MASK_WEBGPU, typeI32, [
                typeITex1D
            ]),
            ...genType('textureNumLevels', MASK_WEBGPU, typeI32, [
                typeUTex1D
            ]),
            ...genType('textureNumLevels', MASK_WEBGPU, typeI32, [
                typeTex2D
            ]),
            ...genType('textureNumLevels', MASK_WEBGPU, typeI32, [
                typeITex2D
            ]),
            ...genType('textureNumLevels', MASK_WEBGPU, typeI32, [
                typeUTex2D
            ]),
            ...genType('textureNumLevels', MASK_WEBGPU, typeI32, [
                typeTex2DArray
            ]),
            ...genType('textureNumLevels', MASK_WEBGPU, typeI32, [
                typeITex2DArray
            ]),
            ...genType('textureNumLevels', MASK_WEBGPU, typeI32, [
                typeUTex2DArray
            ]),
            ...genType('textureNumLevels', MASK_WEBGPU, typeI32, [
                typeTex3D
            ]),
            ...genType('textureNumLevels', MASK_WEBGPU, typeI32, [
                typeITex3D
            ]),
            ...genType('textureNumLevels', MASK_WEBGPU, typeI32, [
                typeUTex3D
            ]),
            ...genType('textureNumLevels', MASK_WEBGPU, typeI32, [
                typeTexCube
            ]),
            ...genType('textureNumLevels', MASK_WEBGPU, typeI32, [
                typeITexCube
            ]),
            ...genType('textureNumLevels', MASK_WEBGPU, typeI32, [
                typeUTexCube
            ]),
            ...genType('textureNumLevels', MASK_WEBGPU, typeI32, [
                typeTexCubeArray
            ]),
            ...genType('textureNumLevels', MASK_WEBGPU, typeI32, [
                typeITexCubeArray
            ]),
            ...genType('textureNumLevels', MASK_WEBGPU, typeI32, [
                typeUTexCubeArray
            ]),
            ...genType('textureNumLevels', MASK_WEBGPU, typeI32, [
                typeTexDepth2D
            ]),
            ...genType('textureNumLevels', MASK_WEBGPU, typeI32, [
                typeTexDepth2DArray
            ]),
            ...genType('textureNumLevels', MASK_WEBGPU, typeI32, [
                typeTexDepthCube
            ]),
            ...genType('textureNumLevels', MASK_WEBGPU, typeI32, [
                typeTexDepthCubeArray
            ])
        ]
    },
    // textureNumSamples(tex: PBShaderExp);
    textureNumSamples: {
        overloads: [
            ...genType('textureNumSamples', MASK_WEBGPU, typeI32, [
                typeTexMultisampled2D
            ]),
            ...genType('textureNumSamples', MASK_WEBGPU, typeI32, [
                typeITexMultisampled2D
            ]),
            ...genType('textureNumSamples', MASK_WEBGPU, typeI32, [
                typeUTexMultisampled2D
            ]),
            ...genType('textureNumSamples', MASK_WEBGPU, typeI32, [
                typeTexDepthMultisampled2D
            ])
        ]
    },
    // textureSample(tex: texture, coords: number|PBShaderExp);
    textureSample: {
        overloads: [
            ...genType('textureSample', MASK_WEBGPU, typeF32Vec4, [
                typeTex1D,
                typeSampler,
                typeF32
            ]),
            ...genType('textureSample', MASK_WEBGPU, typeF32Vec4, [
                typeTex2D,
                typeSampler,
                typeF32Vec2
            ]),
            ...genType('textureSample', MASK_WEBGPU, typeF32Vec4, [
                typeTex3D,
                typeSampler,
                typeF32Vec3
            ]),
            ...genType('textureSample', MASK_WEBGPU, typeF32Vec4, [
                typeTexCube,
                typeSampler,
                typeF32Vec3
            ]),
            ...genType('textureSample', MASK_WEBGPU, typeF32, [
                typeTexDepth2D,
                typeSampler,
                typeF32Vec2
            ]),
            ...genType('textureSample', MASK_WEBGPU, typeF32, [
                typeTexDepthCube,
                typeSampler,
                typeF32Vec3
            ]),
            ...genType('textureSampleBaseClampToEdge', MASK_WEBGPU, typeF32Vec4, [
                typeTexExternal,
                typeSampler,
                typeF32Vec2
            ]),
            ...genType('texture', MASK_WEBGL2, typeF32Vec4, [
                typeTex1D,
                typeF32Vec2
            ]),
            ...genType('texture', MASK_WEBGL2, typeF32Vec4, [
                typeTex2D,
                typeF32Vec2
            ]),
            ...genType('texture', MASK_WEBGL2, typeF32Vec4, [
                typeTexExternal,
                typeF32Vec2
            ]),
            ...genType('texture', MASK_WEBGL2, typeF32Vec4, [
                typeTexDepth2D,
                typeF32Vec2
            ]),
            ...genType('texture', MASK_WEBGL2, typeF32Vec4, [
                typeTex3D,
                typeF32Vec3
            ]),
            ...genType('texture', MASK_WEBGL2, typeF32Vec4, [
                typeTexCube,
                typeF32Vec3
            ]),
            ...genType('texture', MASK_WEBGL2, typeF32Vec4, [
                typeTexDepthCube,
                typeF32Vec3
            ]),
            ...genType('texture2D', MASK_WEBGL1, typeF32Vec4, [
                typeTex1D,
                typeF32Vec2
            ]),
            ...genType('texture2D', MASK_WEBGL1, typeF32Vec4, [
                typeTex2D,
                typeF32Vec2
            ]),
            ...genType('texture2D', MASK_WEBGL1, typeF32Vec4, [
                typeTexExternal,
                typeF32Vec2
            ]),
            ...genType('texture2D', MASK_WEBGL1, typeF32Vec4, [
                typeTexDepth2D,
                typeF32Vec2
            ]),
            ...genType('textureCube', MASK_WEBGL1, typeF32Vec4, [
                typeTexCube,
                typeF32Vec3
            ]),
            ...genType('textureCube', MASK_WEBGL1, typeF32Vec4, [
                typeTexDepthCube,
                typeF32Vec3
            ])
        ],
        normalizeFunc (pb, name, ...args) {
            if (args.length !== 2) {
                throw new PBParamLengthError('textureSample');
            }
            const tex = args[0];
            if (!(tex instanceof PBShaderExp)) {
                throw new PBParamTypeError('textureSample', 'texture');
            }
            const texType = tex.$ast.getType();
            if (!texType.isTextureType()) {
                throw new PBParamTypeError('textureSample', 'texture');
            }
            if (pb.getDevice().type === 'webgpu') {
                if (texType.isStorageTexture()) {
                    throw new PBParamTypeError('textureSample', 'texture');
                }
                const sampler = pb.getDefaultSampler(tex, false);
                const coords = args[1];
                const ret = callBuiltin(pb, name, tex, sampler, coords);
                if (ret.$ast.getType().isCompatibleType(typeF32)) {
                    return pb.vec4(ret);
                } else {
                    return ret;
                }
            } else {
                pb.getDefaultSampler(tex, false);
                if (texType.is1DTexture()) {
                    if (args[1] instanceof PBShaderExp) {
                        const coordType = args[1].$ast.getType();
                        if (!coordType.isPrimitiveType() || !coordType.isScalarType() || coordType.scalarType !== PBPrimitiveType.F32) {
                            throw new PBParamTypeError('textureSample', 'coord');
                        }
                    } else if (typeof args[1] !== 'number') {
                        throw new PBParamTypeError('textureSample', 'coord');
                    }
                    args[1] = pb.vec2(args[1], 0);
                }
                return callBuiltin(pb, name, ...args);
            }
        }
    },
    // textureArraySample(tex: PBShaderExp, coords: PBShaderExp, arrayIndex: number|PBShaderExp)
    textureArraySample: {
        overloads: [
            ...genType('textureSample', MASK_WEBGPU, typeF32Vec4, [
                typeTex2DArray,
                typeSampler,
                typeF32Vec2,
                typeI32
            ]),
            ...genType('textureSample', MASK_WEBGPU, typeF32Vec4, [
                typeTexCubeArray,
                typeSampler,
                typeF32Vec3,
                typeI32
            ]),
            ...genType('textureSample', MASK_WEBGPU, typeF32, [
                typeTexDepth2DArray,
                typeSampler,
                typeF32Vec2,
                typeI32
            ]),
            ...genType('textureSample', MASK_WEBGPU, typeF32, [
                typeTexDepthCubeArray,
                typeSampler,
                typeF32Vec3,
                typeI32
            ]),
            ...genType('texture', MASK_WEBGL2, typeF32Vec4, [
                typeTex2DArray,
                typeF32Vec3
            ]),
            ...genType('texture', MASK_WEBGL2, typeF32Vec4, [
                typeTexDepth2DArray,
                typeF32Vec3
            ])
        ],
        normalizeFunc (pb, name, ...args) {
            if (args.length !== 3) {
                throw new PBParamLengthError('textureArraySample');
            }
            const tex = args[0];
            if (!(tex instanceof PBShaderExp)) {
                throw new PBParamTypeError('textureArraySample', 'texture');
            }
            const texType = tex.$ast.getType();
            if (!texType.isTextureType()) {
                throw new PBParamTypeError('textureArraySample', 'texture');
            }
            if (pb.getDevice().type === 'webgpu') {
                const sampler = pb.getDefaultSampler(tex, false);
                const coords = args[1];
                const arrayIndex = args[2];
                const ret = callBuiltin(pb, name, tex, sampler, coords, arrayIndex);
                if (ret.$ast.getType().isCompatibleType(typeF32)) {
                    return pb.vec4(ret);
                } else {
                    return ret;
                }
            } else {
                pb.getDefaultSampler(tex, false);
                const coords = args[1];
                const arrayIndex = args[2];
                const coordsComposit = pb.vec3(coords, pb.float(arrayIndex));
                return callBuiltin(pb, name, tex, coordsComposit);
            }
        }
    },
    // textureSampleBias(tex: PBShaderExp, coords: PBShaderExp, bias: number|PBShaderExp)
    textureSampleBias: {
        overloads: [
            ...genType('textureSampleBias', MASK_WEBGPU, typeF32Vec4, [
                typeTex2D,
                typeSampler,
                typeF32Vec2,
                typeF32
            ]),
            ...genType('textureSampleBias', MASK_WEBGPU, typeF32Vec4, [
                typeTex3D,
                typeSampler,
                typeF32Vec3,
                typeF32
            ]),
            ...genType('textureSampleBias', MASK_WEBGPU, typeF32Vec4, [
                typeTexCube,
                typeSampler,
                typeF32Vec3,
                typeF32
            ]),
            ...genType('texture', MASK_WEBGL2, typeF32Vec4, [
                typeTex2D,
                typeF32Vec2,
                typeF32
            ]),
            ...genType('texture', MASK_WEBGL2, typeF32Vec4, [
                typeTex3D,
                typeF32Vec3,
                typeF32
            ]),
            ...genType('texture', MASK_WEBGL2, typeF32Vec4, [
                typeTexCube,
                typeF32Vec3,
                typeF32
            ]),
            ...genType('texture2D', MASK_WEBGL1, typeF32Vec4, [
                typeTex2D,
                typeF32Vec2,
                typeF32
            ]),
            ...genType('textureCube', MASK_WEBGL1, typeF32Vec4, [
                typeTexCube,
                typeF32Vec3,
                typeF32
            ])
        ],
        normalizeFunc (pb, name, ...args) {
            if (args.length !== 3) {
                throw new PBParamLengthError('textureSampleBias');
            }
            const tex = args[0];
            if (!(tex instanceof PBShaderExp)) {
                throw new PBParamTypeError('textureSampleBias', 'texture');
            }
            const texType = tex.$ast.getType();
            if (!texType.isTextureType()) {
                throw new PBParamTypeError('textureSampleBias', 'texture');
            }
            if (pb.getDevice().type === 'webgpu') {
                const sampler = pb.getDefaultSampler(tex, false);
                return callBuiltin(pb, name, tex, sampler, args[1], args[2]);
            } else {
                pb.getDefaultSampler(tex, false);
                return callBuiltin(pb, name, ...args);
            }
        }
    },
    // textureArraySampleBias(tex: PBShaderExp, coords: PBShaderExp, arrayIndex: number|PBShaderExp, bias: number|PBShaderExp)
    textureArraySampleBias: {
        overloads: [
            ...genType('textureSampleBias', MASK_WEBGPU, typeF32Vec4, [
                typeTex2DArray,
                typeSampler,
                typeF32Vec2,
                typeI32,
                typeF32
            ]),
            ...genType('textureSampleBias', MASK_WEBGPU, typeF32Vec4, [
                typeTexCubeArray,
                typeSampler,
                typeF32Vec3,
                typeI32,
                typeF32
            ]),
            ...genType('texture', MASK_WEBGL2, typeF32Vec4, [
                typeTex2DArray,
                typeF32Vec3,
                typeF32
            ])
        ],
        normalizeFunc (pb, name, ...args) {
            if (args.length !== 4) {
                throw new PBParamLengthError('textureArraySampleBias');
            }
            const tex = args[0];
            if (!(tex instanceof PBShaderExp)) {
                throw new PBParamTypeError('textureArraySampleBias', 'texture');
            }
            const texType = tex.$ast.getType();
            if (!texType.isTextureType()) {
                throw new PBParamTypeError('textureArraySampleBias', 'texture');
            }
            if (pb.getDevice().type === 'webgpu') {
                const sampler = pb.getDefaultSampler(tex, false);
                return callBuiltin(pb, name, tex, sampler, args[1], args[2], args[3]);
            } else if (pb.getDevice().type === 'webgl2') {
                pb.getDefaultSampler(tex, false);
                const coords = args[1];
                const arrayIndex = args[2];
                const coordsComposit = pb.vec3(coords, pb.float(arrayIndex));
                return callBuiltin(pb, name, tex, coordsComposit, args[3]);
            }
        }
    },
    // textureSampleCompare(tex: PBShaderExp, coords: PBShaderExp, depthRef: number|PBShaderExp)
    textureSampleCompare: {
        overloads: [
            ...genType('textureSampleCompare', MASK_WEBGPU, typeF32, [
                typeTexDepth2D,
                typeSamplerComparison,
                typeF32Vec2,
                typeF32
            ]),
            ...genType('textureSampleCompare', MASK_WEBGPU, typeF32, [
                typeTexDepthCube,
                typeSamplerComparison,
                typeF32Vec3,
                typeF32
            ]),
            ...genType('texture', MASK_WEBGL2, typeF32, [
                typeTexDepth2D,
                typeF32Vec3
            ]),
            ...genType('texture', MASK_WEBGL2, typeF32, [
                typeTexDepthCube,
                typeF32Vec4
            ])
        ],
        normalizeFunc (pb, name, ...args) {
            if (args.length !== 3) {
                throw new PBParamLengthError('textureSampleCompare');
            }
            const tex = args[0];
            if (!(tex instanceof PBShaderExp)) {
                throw new PBParamTypeError('textureSampleCompare', 'texture');
            }
            const texType = tex.$ast.getType();
            if (!texType.isTextureType() || !texType.isDepthTexture()) {
                throw new PBParamTypeError('textureSampleCompare', 'texture');
            }
            if (pb.getDevice().type === 'webgpu') {
                const sampler = pb.getDefaultSampler(args[0], true);
                return callBuiltin(pb, name, tex, sampler, args[1], args[2]);
            } else {
                pb.getDefaultSampler(args[0], true);
                let coordsComposite;
                if (texType.isCubeTexture() || texType.isArrayTexture()) {
                    coordsComposite = pb.vec4(args[1], args[2]);
                } else {
                    coordsComposite = pb.vec3(args[1], args[2]);
                }
                return callBuiltin(pb, name, tex, coordsComposite);
            }
        }
    },
    // textureArraySampleCompare(tex: PBShaderExp, coords: PBShaderExp, arrayIndex: number|PBShaderExp, depthRef: number|PBShaderExp)
    textureArraySampleCompare: {
        overloads: [
            ...genType('textureSampleCompare', MASK_WEBGPU, typeF32, [
                typeTexDepth2DArray,
                typeSamplerComparison,
                typeF32Vec2,
                typeI32,
                typeF32
            ]),
            ...genType('textureSampleCompare', MASK_WEBGPU, typeF32, [
                typeTexDepthCubeArray,
                typeSamplerComparison,
                typeF32Vec3,
                typeI32,
                typeF32
            ]),
            ...genType('texture', MASK_WEBGL2, typeF32, [
                typeTexDepth2DArray,
                typeF32Vec4
            ])
        ],
        normalizeFunc (pb, name, ...args) {
            if (args.length !== 4) {
                throw new PBParamLengthError('textureArraySampleCompare');
            }
            const tex = args[0];
            if (!(tex instanceof PBShaderExp)) {
                throw new PBParamTypeError('textureArraySampleCompare', 'texture');
            }
            const texType = tex.$ast.getType();
            if (!texType.isTextureType() || !texType.isDepthTexture()) {
                throw new PBParamTypeError('textureArraySampleCompare', 'texture');
            }
            if (pb.getDevice().type === 'webgpu') {
                const sampler = pb.getDefaultSampler(args[0], true);
                return callBuiltin(pb, name, tex, sampler, args[1], args[2], args[3]);
            } else {
                pb.getDefaultSampler(args[0], true);
                const coordsComposite = pb.vec4(args[1], pb.float(args[2]), args[3]);
                return callBuiltin(pb, name, tex, coordsComposite);
            }
        }
    },
    // textureSampleLevel(tex: PBShaderExp, coords: PBShaderExp, level: number|PBShaderExp)
    textureSampleLevel: {
        overloads: [
            ...genType('textureSampleLevel', MASK_WEBGPU, typeF32Vec4, [
                typeTex2D,
                typeSampler,
                typeF32Vec2,
                typeF32
            ]),
            ...genType('textureSampleLevel', MASK_WEBGPU, typeF32Vec4, [
                typeTex3D,
                typeSampler,
                typeF32Vec3,
                typeF32
            ]),
            ...genType('textureSampleLevel', MASK_WEBGPU, typeF32Vec4, [
                typeTexCube,
                typeSampler,
                typeF32Vec3,
                typeF32
            ]),
            ...genType('textureSampleLevel', MASK_WEBGPU, typeF32Vec4, [
                typeTexExternal,
                typeSampler,
                typeF32Vec2
            ]),
            ...genType('textureSampleLevel', MASK_WEBGPU, typeF32, [
                typeTexDepth2D,
                typeSampler,
                typeF32Vec2,
                typeI32
            ]),
            ...genType('textureSampleLevel', MASK_WEBGPU, typeF32, [
                typeTexDepthCube,
                typeSampler,
                typeF32Vec3,
                typeI32
            ]),
            ...genType('textureLod', MASK_WEBGL2, typeF32Vec4, [
                typeTex2D,
                typeF32Vec2,
                typeF32
            ]),
            ...genType('textureLod', MASK_WEBGL2, typeF32Vec4, [
                typeTexDepth2D,
                typeF32Vec2,
                typeF32
            ]),
            ...genType('textureLod', MASK_WEBGL2, typeF32Vec4, [
                typeTexExternal,
                typeF32Vec2,
                typeF32
            ]),
            ...genType('textureLod', MASK_WEBGL2, typeF32Vec4, [
                typeTex3D,
                typeF32Vec3,
                typeF32
            ]),
            ...genType('textureLod', MASK_WEBGL2, typeF32Vec4, [
                typeTexCube,
                typeF32Vec3,
                typeF32
            ]),
            ...genType('textureLod', MASK_WEBGL2, typeF32Vec4, [
                typeTexDepthCube,
                typeF32Vec3,
                typeF32
            ]),
            ...genType('texture2DLodEXT', MASK_WEBGL1, typeF32Vec4, [
                typeTex2D,
                typeF32Vec2,
                typeF32
            ]),
            ...genType('texture2DLodEXT', MASK_WEBGL1, typeF32Vec4, [
                typeTexDepth2D,
                typeF32Vec2,
                typeF32
            ]),
            ...genType('texture2DLodEXT', MASK_WEBGL1, typeF32Vec4, [
                typeTexExternal,
                typeF32Vec2,
                typeF32
            ]),
            ...genType('textureCubeLodEXT', MASK_WEBGL1, typeF32Vec4, [
                typeTexCube,
                typeF32Vec3,
                typeF32
            ]),
            ...genType('textureCubeLodEXT', MASK_WEBGL1, typeF32Vec4, [
                typeTexDepthCube,
                typeF32Vec3,
                typeF32
            ])
        ],
        normalizeFunc (pb, name, ...args) {
            const tex = args[0];
            if (!(tex instanceof PBShaderExp)) {
                throw new PBParamTypeError('textureSampleLevel', 'texture');
            }
            const texType = tex.$ast.getType();
            if (!texType.isTextureType()) {
                throw new PBParamTypeError('textureSampleLevel', 'texture');
            }
            if (pb.getDevice().type === 'webgl' && pb.shaderKind === 'vertex') {
                // WebGL1 does not support vertex texture lod
                return pb.textureSample(tex, args[1]);
            }
            if (pb.getDevice().type === 'webgpu') {
                if (texType.isExternalTexture()) {
                    return pb.textureLoad(tex, pb.ivec2(args[1]), 0);
                } else {
                    const sampler = pb.getDefaultSampler(tex, false);
                    const level = texType.isDepthTexture() && (typeof args[2] === 'number' || args[2] instanceof PBShaderExp && args[2].$ast.getType().isCompatibleType(typeF32)) ? pb.int(args[2]) : args[2];
                    const ret = texType.isExternalTexture() ? callBuiltin(pb, name, tex, sampler, args[1]) : callBuiltin(pb, name, tex, sampler, args[1], level);
                    if (ret.$ast.getType().isCompatibleType(typeF32)) {
                        return pb.vec4(ret);
                    } else {
                        return ret;
                    }
                }
            } else {
                pb.getDefaultSampler(tex, false);
                return texType.isExternalTexture() ? callBuiltin(pb, name, args[0], args[1], 0) : callBuiltin(pb, name, args[0], args[1], args[2]);
            }
        }
    },
    // textureArraySampleLevel(tex: PBShaderExp, coords: PBShaderExp, arrayIndex: number|PBShaderExp, level: number|PBShaderExp)
    textureArraySampleLevel: {
        overloads: [
            ...genType('textureSampleLevel', MASK_WEBGPU, typeF32Vec4, [
                typeTex2DArray,
                typeSampler,
                typeF32Vec2,
                typeI32,
                typeF32
            ]),
            ...genType('textureSampleLevel', MASK_WEBGPU, typeF32Vec4, [
                typeTexCubeArray,
                typeSampler,
                typeF32Vec3,
                typeI32,
                typeF32
            ]),
            ...genType('textureSampleLevel', MASK_WEBGPU, typeF32, [
                typeTexDepth2DArray,
                typeSampler,
                typeF32Vec2,
                typeI32,
                typeI32
            ]),
            ...genType('textureSampleLevel', MASK_WEBGPU, typeF32, [
                typeTexDepthCubeArray,
                typeSampler,
                typeF32Vec3,
                typeI32,
                typeI32
            ]),
            ...genType('textureLod', MASK_WEBGL2, typeF32Vec4, [
                typeTex2DArray,
                typeF32Vec3,
                typeF32
            ])
        ],
        normalizeFunc (pb, name, ...args) {
            if (args.length !== 4) {
                throw new PBParamLengthError('textureArraySampleLevel');
            }
            const tex = args[0];
            if (!(tex instanceof PBShaderExp)) {
                throw new PBParamTypeError('textureArraySampleLevel', 'texture');
            }
            const texType = tex.$ast.getType();
            if (!texType.isTextureType()) {
                throw new PBParamTypeError('textureArraySampleLevel', 'texture');
            }
            if (pb.getDevice().type === 'webgpu') {
                const sampler = pb.getDefaultSampler(tex, false);
                const level = texType.isDepthTexture() && (typeof args[3] === 'number' || args[3] instanceof PBShaderExp && args[3].$ast.getType().isCompatibleType(typeF32)) ? pb.int(args[3]) : args[3];
                const ret = callBuiltin(pb, name, tex, sampler, args[1], args[2], level);
                if (ret.$ast.getType().isCompatibleType(typeF32)) {
                    return pb.vec4(ret);
                } else {
                    return ret;
                }
            } else {
                pb.getDefaultSampler(tex, false);
                const coordsComposite = pb.vec3(args[1], pb.float(args[2]));
                return callBuiltin(pb, name, tex, coordsComposite, args[3]);
            }
        }
    },
    // textureSampleCompare(tex: PBShaderExp, coords: PBShaderExp, depthRef: number|PBShaderExp)
    textureSampleCompareLevel: {
        overloads: [
            ...genType('textureSampleCompareLevel', MASK_WEBGPU, typeF32, [
                typeTexDepth2D,
                typeSamplerComparison,
                typeF32Vec2,
                typeF32
            ]),
            ...genType('textureSampleCompareLevel', MASK_WEBGPU, typeF32, [
                typeTexDepthCube,
                typeSamplerComparison,
                typeF32Vec3,
                typeF32
            ]),
            ...genType('textureLod', MASK_WEBGL2, typeF32, [
                typeTexDepth2D,
                typeF32Vec3,
                typeF32
            ]),
            ...genType('texture', MASK_WEBGL2, typeF32, [
                typeTexDepthCube,
                typeF32Vec4
            ])
        ],
        normalizeFunc (pb, name, ...args) {
            if (args.length !== 3) {
                throw new PBParamLengthError('textureSampleCompareLevel');
            }
            const tex = args[0];
            if (!(tex instanceof PBShaderExp)) {
                throw new PBParamTypeError('textureSampleCompareLevel', 'texture');
            }
            const texType = tex.$ast.getType();
            if (!texType.isTextureType() || !texType.isDepthTexture()) {
                throw new PBParamTypeError('textureSampleCompareLevel', 'texture');
            }
            if (pb.getDevice().type === 'webgpu') {
                const sampler = pb.getDefaultSampler(tex, true);
                return callBuiltin(pb, name, tex, sampler, args[1], args[2]);
            } else {
                pb.getDefaultSampler(args[0], true);
                let coordsComposite;
                if (texType.isCubeTexture() || texType.isArrayTexture()) {
                    coordsComposite = pb.vec4(args[1], args[2]);
                } else {
                    coordsComposite = pb.vec3(args[1], args[2]);
                }
                return texType.isCubeTexture() ? callBuiltin(pb, name, tex, coordsComposite) : callBuiltin(pb, name, tex, coordsComposite, 0);
            }
        }
    },
    // textureArraySampleCompareLevel(tex: PBShaderExp, coords: PBShaderExp, arrayIndex: number|PBShaderExp, depthRef: number|PBShaderExp)
    textureArraySampleCompareLevel: {
        overloads: [
            ...genType('textureSampleCompareLevel', MASK_WEBGPU, typeF32, [
                typeTexDepth2DArray,
                typeSamplerComparison,
                typeF32Vec2,
                typeI32,
                typeF32
            ]),
            ...genType('textureSampleCompareLevel', MASK_WEBGPU, typeF32, [
                typeTexDepthCubeArray,
                typeSamplerComparison,
                typeF32Vec3,
                typeI32,
                typeF32
            ]),
            ...genType('texture', MASK_WEBGL2, typeF32, [
                typeTexDepth2DArray,
                typeF32Vec4
            ])
        ],
        normalizeFunc (pb, name, ...args) {
            if (args.length !== 4) {
                throw new PBParamLengthError('textureArraySampleCompareLevel');
            }
            const tex = args[0];
            if (!(tex instanceof PBShaderExp)) {
                throw new PBParamTypeError('textureArraySampleCompareLevel', 'texture');
            }
            const texType = tex.$ast.getType();
            if (!texType.isTextureType() || !texType.isDepthTexture()) {
                throw new PBParamTypeError('textureArraySampleCompareLevel', 'texture');
            }
            if (pb.getDevice().type === 'webgpu') {
                const sampler = pb.getDefaultSampler(tex, true);
                return callBuiltin(pb, name, tex, sampler, args[1], args[2], args[3]);
            } else {
                pb.getDefaultSampler(args[0], true);
                const coordsComposite = pb.vec4(args[1], pb.float(args[2]), args[3]);
                return callBuiltin(pb, name, tex, coordsComposite);
            }
        }
    },
    // textureSampleGrad(tex: PBShaderExp, coords: PBShaderExp, ddx: PBShaderExp, ddy: PBShaderExp)
    textureSampleGrad: {
        overloads: [
            ...genType('textureSampleGrad', MASK_WEBGPU, typeF32Vec4, [
                typeTex2D,
                typeSampler,
                typeF32Vec2,
                typeF32Vec2,
                typeF32Vec2
            ]),
            ...genType('textureSampleGrad', MASK_WEBGPU, typeF32Vec4, [
                typeTex3D,
                typeSampler,
                typeF32Vec3,
                typeF32Vec3,
                typeF32Vec3
            ]),
            ...genType('textureSampleGrad', MASK_WEBGPU, typeF32Vec4, [
                typeTexCube,
                typeSampler,
                typeF32Vec3,
                typeF32Vec3,
                typeF32Vec3
            ]),
            ...genType('textureGrad', MASK_WEBGL2, typeF32Vec4, [
                typeTex2D,
                typeF32Vec2,
                typeF32Vec2,
                typeF32Vec2
            ]),
            ...genType('textureGrad', MASK_WEBGL2, typeF32Vec4, [
                typeTex3D,
                typeF32Vec3,
                typeF32Vec3,
                typeF32Vec3
            ]),
            ...genType('textureGrad', MASK_WEBGL2, typeF32Vec4, [
                typeTexCube,
                typeF32Vec3,
                typeF32Vec3,
                typeF32Vec3
            ]),
            ...genType('texture2DGradEXT', MASK_WEBGL1, typeF32Vec4, [
                typeTex2D,
                typeF32Vec2,
                typeF32Vec2,
                typeF32Vec2
            ]),
            ...genType('textureCubeGradEXT', MASK_WEBGL1, typeF32Vec4, [
                typeTexCube,
                typeF32Vec3,
                typeF32Vec3,
                typeF32Vec3
            ])
        ],
        normalizeFunc (pb, name, ...args) {
            if (args.length !== 4) {
                throw new PBParamLengthError('textureSampleGrad');
            }
            const tex = args[0];
            if (!(tex instanceof PBShaderExp)) {
                throw new PBParamTypeError('textureSampleGrad', 'texture');
            }
            const texType = tex.$ast.getType();
            if (!texType.isTextureType()) {
                throw new PBParamTypeError('textureSampleGrad', 'texture');
            }
            if (pb.getDevice().type === 'webgpu') {
                const sampler = pb.getDefaultSampler(tex, false);
                return callBuiltin(pb, name, tex, sampler, args[1], args[2], args[3]);
            } else {
                pb.getDefaultSampler(tex, false);
                return callBuiltin(pb, name, ...args);
            }
        }
    },
    // textureArraySampleGrad(tex: PBShaderExp, coords: PBShaderExp, arrayIndex: number|PBShaderExp, ddx: PBShaderExp, ddy: PBShaderExp)
    textureArraySampleGrad: {
        overloads: [
            ...genType('textureSampleGrad', MASK_WEBGPU, typeF32Vec4, [
                typeTex2DArray,
                typeSampler,
                typeF32Vec2,
                typeI32,
                typeF32Vec2,
                typeF32Vec2
            ]),
            ...genType('textureSampleGrad', MASK_WEBGPU, typeF32Vec4, [
                typeTexCubeArray,
                typeSampler,
                typeF32Vec3,
                typeI32,
                typeF32Vec3,
                typeF32Vec3
            ]),
            ...genType('textureGrad', MASK_WEBGL2, typeF32Vec4, [
                typeTex2DArray,
                typeF32Vec3,
                typeF32Vec2,
                typeF32Vec2
            ])
        ],
        normalizeFunc (pb, name, ...args) {
            if (args.length !== 5) {
                throw new PBParamLengthError('textureArraySampleGrad');
            }
            const tex = args[0];
            if (!(tex instanceof PBShaderExp)) {
                throw new PBParamTypeError('textureArraySampleGrad', 'texture');
            }
            const texType = tex.$ast.getType();
            if (!texType.isTextureType() || !texType.isArrayTexture()) {
                throw new PBParamTypeError('textureArraySampleGrad', 'texture');
            }
            if (pb.getDevice().type === 'webgpu') {
                const sampler = pb.getDefaultSampler(tex, false);
                return callBuiltin(pb, name, tex, sampler, args[1], args[2], args[3], args[4]);
            } else {
                pb.getDefaultSampler(tex, false);
                const coordsComposite = pb.vec3(args[1], pb.float(args[2]));
                return callBuiltin(pb, name, tex, coordsComposite, args[3], args[4]);
            }
        }
    },
    storageBarrier: {
        overloads: genType('storageBarrier', MASK_WEBGPU, typeVoid, [])
    },
    workgroupBarrier: {
        overloads: genType('workgroupBarrier', MASK_WEBGPU, typeVoid, [])
    },
    atomicLoad: {
        overloades: [],
        normalizeFunc (pb, name, ...args) {
            if (args.length !== 1) {
                throw new PBParamLengthError(name);
            }
            const arg = args[0];
            if (!(arg instanceof PBShaderExp)) {
                throw new PBParamTypeError(name, 'ptr');
            }
            if (arg.$ast.getType().typeId === typeAtomicI32.typeId) {
                return pb.$callFunctionNoCheck(name, [
                    new ASTAddressOf(arg.$ast)
                ], typeI32);
            } else if (arg.$ast.getType().typeId === typeAtomicU32.typeId) {
                return pb.$callFunctionNoCheck(name, [
                    new ASTAddressOf(arg.$ast)
                ], typeU32$1);
            } else {
                throw new PBParamValueError(name, 'ptr must be atomic type');
            }
        }
    },
    atomicStore: {
        overloades: [],
        normalizeFunc (pb, name, ...args) {
            if (args.length !== 2) {
                throw new PBParamLengthError(name);
            }
            const arg1 = args[0];
            const arg2 = args[1];
            if (!(arg1 instanceof PBShaderExp)) {
                throw new PBParamTypeError(name, 'ptr');
            }
            if (arg1.$ast.getType().typeId === typeAtomicI32.typeId) {
                if (typeof arg2 === 'number') {
                    if (!Number.isInteger(arg2)) {
                        throw new PBParamValueError(name, 'value');
                    }
                    return pb.$callFunctionNoCheck(name, [
                        new ASTAddressOf(arg1.$ast),
                        new ASTScalar(arg2, typeI32)
                    ], typeVoid);
                } else if (arg2 instanceof PBShaderExp) {
                    if (arg2.$ast.getType().typeId !== typeI32.typeId) {
                        throw new PBParamTypeError(name, 'value');
                    }
                    return pb.$callFunctionNoCheck(name, [
                        new ASTAddressOf(arg1.$ast),
                        arg2.$ast
                    ], typeVoid);
                } else {
                    throw new PBParamTypeError(name, 'value');
                }
            } else if (arg1.$ast.getType().typeId === typeAtomicU32.typeId) {
                if (typeof arg2 === 'number') {
                    if (!Number.isInteger(arg2)) {
                        throw new PBParamValueError(name, 'value');
                    }
                    return pb.$callFunctionNoCheck(name, [
                        new ASTAddressOf(arg1.$ast),
                        new ASTScalar(arg2, typeU32$1)
                    ], typeVoid);
                } else if (arg2 instanceof PBShaderExp) {
                    if (arg2.$ast.getType().typeId !== typeU32$1.typeId) {
                        throw new PBParamTypeError(name, 'value');
                    }
                    return pb.$callFunctionNoCheck(name, [
                        new ASTAddressOf(arg1.$ast),
                        arg2.$ast
                    ], typeVoid);
                } else {
                    throw new PBParamTypeError(name, 'value');
                }
            } else {
                throw new PBParamValueError(name, 'ptr must be atomic type');
            }
        }
    }
};
for (const name of [
    'atomicAdd',
    'atomicSub',
    'atomicMax',
    'atomicMin',
    'atomicAnd',
    'atomicOr',
    'atomicXor',
    'atomicExchange'
]){
    builtinFunctionsAll[name] = {
        overloades: [],
        normalizeFunc (pb, name, ...args) {
            if (args.length !== 2) {
                throw new PBParamLengthError(name);
            }
            const arg1 = args[0];
            const arg2 = args[1];
            if (!(arg1 instanceof PBShaderExp)) {
                throw new PBParamTypeError(name, 'ptr');
            }
            if (arg1.$ast.getType().typeId === typeAtomicI32.typeId) {
                if (typeof arg2 === 'number') {
                    if (!Number.isInteger(arg2)) {
                        throw new PBParamValueError(name, 'value');
                    }
                    return pb.$callFunctionNoCheck(name, [
                        new ASTAddressOf(arg1.$ast),
                        new ASTScalar(arg2, typeI32)
                    ], typeI32);
                } else if (arg2 instanceof PBShaderExp) {
                    if (arg2.$ast.getType().typeId !== typeI32.typeId) {
                        throw new PBParamTypeError(name, 'value');
                    }
                    return pb.$callFunctionNoCheck(name, [
                        new ASTAddressOf(arg1.$ast),
                        arg2.$ast
                    ], typeI32);
                } else {
                    throw new PBParamTypeError(name, 'value');
                }
            } else if (arg1.$ast.getType().typeId === typeAtomicU32.typeId) {
                if (typeof arg2 === 'number') {
                    if (!Number.isInteger(arg2)) {
                        throw new PBParamValueError(name, 'value');
                    }
                    return pb.$callFunctionNoCheck(name, [
                        new ASTAddressOf(arg1.$ast),
                        new ASTScalar(arg2, typeU32$1)
                    ], typeU32$1);
                } else if (arg2 instanceof PBShaderExp) {
                    if (arg2.$ast.getType().typeId !== typeU32$1.typeId) {
                        throw new PBParamTypeError(name, 'value');
                    }
                    return pb.$callFunctionNoCheck(name, [
                        new ASTAddressOf(arg1.$ast),
                        arg2.$ast
                    ], typeU32$1);
                } else {
                    throw new PBParamTypeError(name, 'value');
                }
            } else {
                throw new PBParamValueError(name, 'ptr must be atomic type');
            }
        }
    };
}
/** @internal */ function setBuiltinFuncs(cls) {
    for (const k of Object.keys(builtinFunctionsAll)){
        cls.prototype[k] = function(...args) {
            const normalizeFunc = builtinFunctionsAll?.[k]?.normalizeFunc || callBuiltin;
            return normalizeFunc(this, k, ...args);
        };
    }
}

const StorageTextureFormatMap = {
    rgba8unorm: 'rgba8unorm',
    rgba8snorm: 'rgba8snorm',
    rgba8uint: 'rgba8ui',
    rgba8sint: 'rgba8i',
    rgba16uint: 'rgba16ui',
    rgba16sint: 'rgba16i',
    rgba16float: 'rgba16f',
    r32float: 'r32f',
    r32uint: 'r32ui',
    r32sint: 'r32i',
    rg32float: 'rg32f',
    rg32uint: 'rg32ui',
    rg32sint: 'rg32i',
    rgba32float: 'rgba32f',
    rgba32uint: 'rgba32ui',
    rgba32sint: 'rgba32i'
};
function vec_n(vecType, ...args) {
    if (this.getDevice().type === 'webgl') {
        if (vecType.scalarType === PBPrimitiveType.U32) {
            throw new PBDeviceNotSupport('unsigned integer type');
        }
        if (vecType.isMatrixType() && vecType.cols !== vecType.rows) {
            throw new PBDeviceNotSupport('non-square matrix type');
        }
    }
    if (args.length === 1 && typeof args[0] === 'string') {
        return new PBShaderExp(args[0], vecType);
    } else {
        const exp = new PBShaderExp('', vecType);
        if (vecType.isScalarType() && args.length === 1 && (typeof args[0] === 'number' || typeof args[0] === 'boolean')) {
            exp.$ast = new ASTScalar(args[0], vecType);
        } else {
            exp.$ast = new ASTShaderExpConstructor(exp.$typeinfo, args.map((arg)=>{
                if (typeof arg === 'string') {
                    throw new PBParamTypeError('vec_n');
                }
                return arg instanceof PBShaderExp ? arg.$ast : arg;
            }));
        }
        return exp;
    }
}
const primitiveCtors = {
    float: typeF32,
    int: typeI32,
    uint: typeU32$1,
    bool: typeBool,
    vec2: typeF32Vec2,
    ivec2: typeI32Vec2,
    uvec2: typeU32Vec2,
    bvec2: typeBVec2,
    vec3: typeF32Vec3,
    ivec3: typeI32Vec3,
    uvec3: typeU32Vec3,
    bvec3: typeBVec3,
    vec4: typeF32Vec4,
    ivec4: typeI32Vec4,
    uvec4: typeU32Vec4,
    bvec4: typeBVec4,
    mat2: typeMat2,
    mat2x3: typeMat2x3,
    mat2x4: typeMat2x4,
    mat3x2: typeMat3x2,
    mat3: typeMat3,
    mat3x4: typeMat3x4,
    mat4x2: typeMat4x2,
    mat4x3: typeMat4x3,
    mat4: typeMat4
};
const simpleCtors = {
    tex1D: typeTex1D,
    tex2D: typeTex2D,
    tex3D: typeTex3D,
    texCube: typeTexCube,
    tex2DShadow: typeTexDepth2D,
    texCubeShadow: typeTexDepthCube,
    tex2DArray: typeTex2DArray,
    tex2DArrayShadow: typeTexDepth2DArray,
    texExternal: typeTexExternal,
    itex1D: typeITex1D,
    itex2D: typeITex2D,
    itex3D: typeITex3D,
    itexCube: typeITexCube,
    itex2DArray: typeITex2DArray,
    utex1D: typeUTex1D,
    utex2D: typeUTex2D,
    utex3D: typeUTex3D,
    utexCube: typeUTexCube,
    utex2DArray: typeUTex2DArray,
    sampler: typeSampler,
    samplerComparison: typeSamplerComparison
};
function makeStorageTextureCtor(type) {
    const ctor = {};
    for (const k of Object.keys(StorageTextureFormatMap)){
        ctor[k] = function(rhs) {
            return new PBShaderExp(rhs, new PBTextureTypeInfo(type, StorageTextureFormatMap[k]));
        };
    }
    return ctor;
}
const texStorageCtors = {
    texStorage1D: PBTextureType.TEX_STORAGE_1D,
    texStorage2D: PBTextureType.TEX_STORAGE_2D,
    texStorage2DArray: PBTextureType.TEX_STORAGE_2D_ARRAY,
    texStorage3D: PBTextureType.TEX_STORAGE_3D
};
/** @internal */ function setConstructors(cls) {
    Object.keys(primitiveCtors).forEach((k)=>{
        cls.prototype[k] = makeConstructor(function(...args) {
            return vec_n.call(this, primitiveCtors[k], ...args);
        }, primitiveCtors[k]);
    });
    Object.keys(simpleCtors).forEach((k)=>{
        cls.prototype[k] = function(rhs) {
            return new PBShaderExp(rhs, simpleCtors[k]);
        };
    });
    Object.keys(texStorageCtors).forEach((k)=>{
        cls.prototype[k] = makeStorageTextureCtor(texStorageCtors[k]);
    });
    cls.prototype['atomic_int'] = makeConstructor(function(...args) {
        if (args.length > 1) {
            throw new PBParamLengthError('atomic_int');
        }
        if (args.length === 1) {
            if (typeof args[0] !== 'string') {
                throw new PBParamTypeError('atomic_int', 'name');
            }
            return new PBShaderExp(args[0], typeAtomicI32);
        } else {
            const exp = new PBShaderExp('', typeAtomicI32);
            exp.$ast = new ASTShaderExpConstructor(exp.$typeinfo, []);
            return exp;
        }
    }, typeAtomicI32);
    cls.prototype['atomic_uint'] = makeConstructor(function(...args) {
        if (args.length > 1) {
            throw new PBParamLengthError('atomic_uint');
        }
        if (args.length === 1 && typeof args[0] === 'string') {
            return new PBShaderExp(args[0], typeAtomicU32);
        } else if (args.length === 0) {
            const exp = new PBShaderExp('', typeAtomicU32);
            exp.$ast = new ASTShaderExpConstructor(exp.$typeinfo, []);
            return exp;
        }
        const arg = args[0];
        if (typeof arg === 'number' && Number.isInteger(arg) || arg instanceof PBShaderExp && arg.$ast.getType().typeId === typeU32$1.typeId) {
            const exp = new PBShaderExp('', typeAtomicU32);
            exp.$ast = new ASTShaderExpConstructor(exp.$typeinfo, [
                arg instanceof PBShaderExp ? arg.$ast : arg
            ]);
            return exp;
        }
        return null;
    }, typeAtomicU32);
} /*
ProgramBuilder.prototype.texStorage1D = makeStorageTextureCtor(typeinfo.PBTextureType.TEX_STORAGE_1D);
ProgramBuilder.prototype.texStorage2D = makeStorageTextureCtor(typeinfo.PBTextureType.TEX_STORAGE_2D);
ProgramBuilder.prototype.texStorage2DArray = makeStorageTextureCtor(typeinfo.PBTextureType.TEX_STORAGE_2D_ARRAY);
ProgramBuilder.prototype.texStorage3D = makeStorageTextureCtor(typeinfo.PBTextureType.TEX_STORAGE_3D);
*/

const COMPUTE_UNIFORM_NAME = 'ch_compute_uniform_block';
const COMPUTE_STORAGE_NAME = 'ch_compute_storage_block';
const VERTEX_UNIFORM_NAME = 'ch_vertex_uniform_block';
const FRAGMENT_UNIFORM_NAME = 'ch_fragment_uniform_block';
const SHARED_UNIFORM_NAME = 'ch_shared_uniform_block';
const VERTEX_STORAGE_NAME = 'ch_vertex_storage_block';
const FRAGMENT_STORAGE_NAME = 'ch_fragment_storage_block';
const SHARED_STORAGE_NAME = 'ch_shared_storage_block';
const input_prefix = 'zVSInput_';
const output_prefix_vs = 'zVSOutput_';
const output_prefix_fs = 'zFSOutput_';
/**
 * The program builder class
 * @public
 */ class ProgramBuilder {
    /** @internal */ _device;
    /** @internal */ _workgroupSize;
    /** @internal */ _scopeStack = [];
    /** @internal */ _shaderType = ShaderType.Vertex | ShaderType.Fragment | ShaderType.Compute;
    /** @internal */ _structInfo;
    /** @internal */ _uniforms;
    /** @internal */ _globalScope;
    /** @internal */ _builtinScope;
    /** @internal */ _inputScope;
    /** @internal */ _outputScope;
    /** @internal */ _inputs;
    /** @internal */ _outputs;
    /** @internal */ _vertexAttributes;
    /** @internal */ _depthRangeCorrection;
    /** @internal */ _emulateDepthClamp;
    /** @internal */ _lastError;
    /** @internal */ _reflection;
    /** @internal */ _autoStructureTypeIndex;
    /** @internal */ _nameMap;
    /**
   * Creates a program builder for given device
   * @param device - The device
   */ constructor(device){
        this._device = device;
        this._workgroupSize = null;
        this._structInfo = {};
        this._uniforms = [];
        this._scopeStack = [];
        this._globalScope = null;
        this._builtinScope = null;
        this._inputScope = null;
        this._outputScope = null;
        this._inputs = [];
        this._outputs = [];
        this._vertexAttributes = [];
        this._depthRangeCorrection = device.type === 'webgpu';
        this._emulateDepthClamp = false;
        this._lastError = null;
        this._reflection = new PBReflection(this);
        this._autoStructureTypeIndex = 0;
        this._nameMap = [];
    }
    /** Get last error */ get lastError() {
        return this._lastError;
    }
    /** @internal */ get shaderType() {
        return this._shaderType;
    }
    /** Current shader kind */ get shaderKind() {
        return this._shaderType === ShaderType.Vertex ? 'vertex' : this._shaderType === ShaderType.Fragment ? 'fragment' : this._shaderType === ShaderType.Compute ? 'compute' : null;
    }
    /** Gets the global scope */ getGlobalScope() {
        return this._globalScope;
    }
    /** @internal */ get builtinScope() {
        return this._builtinScope;
    }
    /** @internal */ get inputScope() {
        return this._inputScope;
    }
    /** @internal */ get outputScope() {
        return this._outputScope;
    }
    /** @internal */ get depthRangeCorrection() {
        return this._depthRangeCorrection;
    }
    get emulateDepthClamp() {
        return this._emulateDepthClamp;
    }
    set emulateDepthClamp(val) {
        this._emulateDepthClamp = val;
    }
    /** Get the shader code reflection interface */ getReflection() {
        return this._reflection;
    }
    /** Get the device */ getDevice() {
        return this._device;
    }
    /** @internal */ reset() {
        this._workgroupSize = null;
        this._structInfo = {};
        this._uniforms = [];
        this._scopeStack = [];
        this._globalScope = null;
        this._builtinScope = null;
        this._inputScope = null;
        this._outputScope = null;
        this._inputs = [];
        this._outputs = [];
        this._vertexAttributes = [];
        this._depthRangeCorrection = this._device.type === 'webgpu';
        this._reflection = new PBReflection(this);
        this._autoStructureTypeIndex = 0;
        this._nameMap = [];
    }
    /**
   * Query the global variable by the name
   * @param name - Name of the variable
   * @returns The variable or null if not exists
   */ queryGlobal(name) {
        return this.getReflection().tag(name);
    }
    /** @internal */ pushScope(scope) {
        this._scopeStack.unshift(scope);
    }
    /** @internal */ popScope() {
        return this._scopeStack.shift();
    }
    /** Gets the current scope */ getCurrentScope() {
        return this._scopeStack[0];
    }
    /** Gets the current function scope */ getCurrentFunctionScope() {
        let funcScope = this.getCurrentScope();
        while(funcScope && !(funcScope instanceof PBFunctionScope)){
            funcScope = funcScope.$parent;
        }
        return funcScope;
    }
    /**
   * Generates shader codes for a render program
   * @param options - The build options
   * @returns a tuple made by vertex shader source, fragment shader source, bind group layouts and vertex attributes used, or null if build faild
   */ buildRender(options) {
        setCurrentProgramBuilder(this);
        this._lastError = null;
        this.defineInternalStructs();
        const ret = this.buildRenderSource(options);
        setCurrentProgramBuilder(null);
        this.reset();
        return ret;
    }
    /**
   * Generates shader code for a compute program
   * @param options - The build programs
   * @returns a tuple made by compute shader source and bind group layouts, or null if build failed
   */ buildCompute(options) {
        setCurrentProgramBuilder(this);
        this._lastError = null;
        this._workgroupSize = options.workgroupSize;
        this.defineInternalStructs();
        const ret = this.buildComputeSource(options);
        setCurrentProgramBuilder(null);
        this.reset();
        return ret;
    }
    /**
   * Creates a shader program for render
   * @param options - The build options
   * @returns The created program or null if build failed
   */ buildRenderProgram(options) {
        const ret = this.buildRender(options);
        return ret ? this._device.createGPUProgram({
            type: 'render',
            label: options.label,
            params: {
                vs: ret[0],
                fs: ret[1],
                bindGroupLayouts: ret[2],
                vertexAttributes: ret[3]
            }
        }) : null;
    }
    /**
   * Creates a shader program for compute
   * @param options - The build options
   * @returns The created program or null if build failed
   */ buildComputeProgram(options) {
        const ret = this.buildCompute(options);
        return ret ? this._device.createGPUProgram({
            type: 'compute',
            params: {
                source: ret[0],
                bindGroupLayouts: ret[1]
            }
        }) : null;
    }
    /**
   * Creates a function
   * @param name - Name of the function
   * @param params - Parameters of the function
   * @param body - The generator function
   */ func(name, params, body) {
        this.getGlobalScope().$createFunctionIfNotExists(name, params, body);
    }
    /**
   * Create the main entry function of the shader
   * @param body - The shader generator function
   */ main(body) {
        this.getGlobalScope().$mainFunc(body);
    }
    /**
   * Create an 'AddressOf' expression for WGSL
   * @param ref - The reference variable
   * @returns the 'AddressOf' expression
   */ addressOf(ref) {
        if (this._device.type !== 'webgpu') {
            throw new PBDeviceNotSupport('pointer shader type');
        }
        if (!ref.$ast.isReference()) {
            throw new PBReferenceValueRequired(ref);
        }
        const exp = new PBShaderExp('', ref.$ast.getType());
        exp.$ast = new ASTAddressOf(ref.$ast);
        return exp;
    }
    /**
   * Creates a 'referenceOf' expression for WGSL
   * @param ptr - The pointer variable
   * @returns the 'referenceOf' expression
   */ referenceOf(ptr) {
        if (this._device.type !== 'webgpu') {
            throw new PBDeviceNotSupport('pointer shader type');
        }
        if (!ptr.$ast.getType().isPointerType()) {
            throw new PBPointerValueRequired(ptr);
        }
        const ast = new ASTReferenceOf(ptr.$ast);
        const exp = new PBShaderExp('', ast.getType());
        exp.$ast = ast;
        return exp;
    }
    /**
   * Creates a structure type variable
   * @param structName - Name of the structure type
   * @param instanceName - Name of the variable
   * @returns the created variable
   */ struct(structName, instanceName) {
        let ctor = null;
        for (const st of [
            ShaderType.Vertex,
            ShaderType.Fragment,
            ShaderType.Compute
        ]){
            if (st & this._shaderType) {
                const structInfo = this._structInfo[st];
                ctor = structInfo?.structs[structName];
                if (ctor) {
                    break;
                }
            }
        }
        if (!ctor) {
            throw new PBParamValueError('struct', 'structName', `Struct type ${structName} not exists`);
        }
        return ctor.call(this, instanceName);
    }
    /** @internal */ isIdenticalStruct(a, b, checkName) {
        if (checkName && a.structName && b.structName && a.structName !== b.structName) {
            return false;
        }
        if (a.structMembers.length !== b.structMembers.length) {
            return false;
        }
        for(let index = 0; index < a.structMembers.length; index++){
            const val = a.structMembers[index];
            const other = b.structMembers[index];
            if (val.name !== other.name) {
                return false;
            }
            if (val.type.isStructType()) {
                if (!other.type.isStructType()) {
                    return false;
                }
                if (!this.isIdenticalStruct(val.type, other.type, true)) {
                    return false;
                }
            } else if (!val.type.isCompatibleType(other.type)) {
                return false;
            }
        }
        return true;
    }
    /** @internal */ generateStructureName() {
        return `zStruct${this._autoStructureTypeIndex++}`;
    }
    /** @internal */ getVertexAttributes() {
        return this._vertexAttributes;
    }
    /** @internal */ defineHiddenStruct(type) {
        for (const shaderType of [
            ShaderType.Vertex,
            ShaderType.Fragment,
            ShaderType.Compute
        ]){
            let structInfo = this._structInfo[shaderType];
            if (!structInfo) {
                structInfo = {
                    structs: {},
                    types: []
                };
                this._structInfo[shaderType] = structInfo;
            }
            if (structInfo.structs[type.structName]) {
                throw new PBParamValueError('defineStruct', 'structName', `cannot re-define struct '${type.structName}'`);
            }
            structInfo.types.push(new ASTStructDefine(type, true));
        }
    }
    // /**
    //  * Defines an uniform buffer
    //  * @param name - Name of the uniform buffer
    //  * @param args - Members of the buffer structure
    //  * @returns The structure type constructor
    //  */
    // defineUniformBuffer(name: string, ...args: PBShaderExp[]): ShaderTypeFunc {
    //   return this.defineStructOrUniformBuffer(name, 'std140', ...args);
    // }
    // /**
    //  * Defines a structure type
    //  * @param structName - Name of the type
    //  * @param layout - The structure layout
    //  * @param args - Members of the structure
    //  * @returns The structure type constructor
    //  */
    // defineStruct(structName: string, ...args: PBShaderExp[]): ShaderTypeFunc {
    //   return this.defineStructOrUniformBuffer(structName, 'default', ...args);
    // }
    /**
   * Defines a structure type
   * @param members - Members of the structure
   * @param structName - Name of the type
   * @returns The structure type constructor
   */ defineStruct(members, structName) {
        const layout = 'default';
        const structType = new PBStructTypeInfo(structName ?? '', layout, members.map((arg)=>{
            if (!arg.$typeinfo.isPrimitiveType() && !arg.$typeinfo.isArrayType() && !arg.$typeinfo.isStructType() && !arg.$typeinfo.isAtomicI32() && !arg.$typeinfo.isAtomicU32()) {
                throw new Error(`invalid struct member type: '${arg.$str}'`);
            }
            return {
                name: arg.$str,
                type: arg.$typeinfo
            };
        }));
        for (const shaderType of [
            ShaderType.Vertex,
            ShaderType.Fragment,
            ShaderType.Compute
        ]){
            let structDef = null;
            let ctor = null;
            const structInfo = this._structInfo[shaderType];
            if (structInfo) {
                if (getCurrentProgramBuilder().shaderType === shaderType && structInfo.structs[structType.structName]) {
                    throw new PBParamValueError('defineStruct', 'structName', `cannot re-define struct '${structType.structName}'`);
                }
                for (const type of structInfo.types){
                    if (!type.builtin && this.isIdenticalStruct(type.getType(), structType, false)) {
                        structDef = type;
                        ctor = structInfo.structs[type.getType().structName];
                        break;
                    }
                }
            }
            if (structDef) {
                if (structDef.type.layout !== layout) {
                    throw new Error(`Can not redefine struct ${structDef.type.structName} with different layout`);
                }
                if (shaderType !== getCurrentProgramBuilder().shaderType) {
                    if (!this._structInfo[getCurrentProgramBuilder().shaderType]) {
                        this._structInfo[getCurrentProgramBuilder().shaderType] = {
                            structs: {},
                            types: []
                        };
                    }
                    if (this._structInfo[getCurrentProgramBuilder().shaderType].types.indexOf(structDef) < 0) {
                        this._structInfo[getCurrentProgramBuilder().shaderType].types.push(structDef);
                        this._structInfo[getCurrentProgramBuilder().shaderType].structs[structDef.getType().structName] = ctor;
                    }
                }
                return ctor;
            }
        }
        return this.internalDefineStruct(structName ?? this.generateStructureName(), layout, this._shaderType, false, ...members);
    }
    /**
   * Defines a structure type
   * @param structType - The structure type info
   * @returns The structure type constructor
   */ defineStructByType(structType) {
        const typeCopy = structType.extends(structType.structName || this.generateStructureName(), []);
        for (const shaderType of [
            ShaderType.Vertex,
            ShaderType.Fragment,
            ShaderType.Compute
        ]){
            let structDef = null;
            let ctor = null;
            const structInfo = this._structInfo[shaderType];
            if (structInfo) {
                if (getCurrentProgramBuilder().shaderType === shaderType && structInfo.structs[typeCopy.structName]) {
                    throw new PBParamValueError('defineStruct', 'structName', `cannot re-define struct '${typeCopy.structName}'`);
                }
                for (const type of structInfo.types){
                    if (!type.builtin && this.isIdenticalStruct(type.getType(), typeCopy, false)) {
                        structDef = type;
                        ctor = structInfo.structs[type.getType().structName];
                        break;
                    }
                }
            }
            if (structDef) {
                if (structDef.type.layout !== typeCopy.layout) {
                    throw new Error(`Can not redefine struct ${structDef.type.structName} with different layout`);
                }
                if (shaderType !== getCurrentProgramBuilder().shaderType) {
                    if (!this._structInfo[getCurrentProgramBuilder().shaderType]) {
                        this._structInfo[getCurrentProgramBuilder().shaderType] = {
                            structs: {},
                            types: []
                        };
                    }
                    this._structInfo[getCurrentProgramBuilder().shaderType].types.push(structDef);
                    this._structInfo[getCurrentProgramBuilder().shaderType].structs[structDef.getType().structName] = ctor;
                }
                return ctor;
            }
        }
        return this.internalDefineStructByType(this._shaderType, false, typeCopy);
    }
    /** @internal */ internalDefineStruct(structName, layout, shaderTypeMask, builtin, ...args) {
        const structType = new PBStructTypeInfo(structName, layout, args.map((arg)=>{
            if (!arg.$typeinfo.isPrimitiveType() && !arg.$typeinfo.isArrayType() && !arg.$typeinfo.isStructType() && !arg.$typeinfo.isAtomicI32() && !arg.$typeinfo.isAtomicU32()) {
                throw new Error(`invalid struct member type: '${arg.$str}'`);
            }
            return {
                name: arg.$str,
                type: arg.$typeinfo
            };
        }));
        return this.internalDefineStructByType(shaderTypeMask, builtin, structType);
    }
    /** @internal */ internalDefineStructByType(shaderTypeMask, builtin, structType) {
        const struct = makeConstructor(function structConstructor(...blockArgs) {
            let e;
            if (blockArgs.length === 1 && typeof blockArgs[0] === 'string') {
                e = new PBShaderExp(blockArgs[0], structType);
            } else {
                e = new PBShaderExp('', structType);
                e.$ast = new ASTShaderExpConstructor(e.$typeinfo, blockArgs.map((arg)=>arg instanceof PBShaderExp ? arg.$ast : arg));
            }
            return e;
        }, structType);
        for (const shaderType of [
            ShaderType.Vertex,
            ShaderType.Fragment,
            ShaderType.Compute
        ]){
            if (shaderTypeMask & shaderType) {
                let structInfo = this._structInfo[shaderType];
                if (!structInfo) {
                    structInfo = {
                        structs: {},
                        types: []
                    };
                    this._structInfo[shaderType] = structInfo;
                }
                if (structInfo.structs[structType.structName]) {
                    throw new PBParamValueError('defineStruct', 'structName', `cannot re-define struct '${structType.structName}'`);
                }
                structInfo.types.push(new ASTStructDefine(structType, builtin));
                structInfo.structs[structType.structName] = struct;
            }
        }
        // this.changeStructLayout(structType, layout);
        return struct;
    }
    /** @internal */ getFunction(name) {
        return this._globalScope ? this._globalScope.$getFunctions(name) : null;
    }
    /** @internal */ get structInfo() {
        return this._structInfo[this._shaderType];
    }
    /** @internal */ getBlockName(instanceName) {
        return `ch_block_name_${instanceName}`;
    }
    /** @internal */ defineBuiltinStruct(shaderType, inOrOut) {
        const structName = inOrOut === 'in' ? getBuiltinInputStructName(shaderType) : getBuiltinOutputStructName(shaderType);
        const instanceName = inOrOut === 'in' ? getBuiltinInputStructInstanceName(shaderType) : getBuiltinOutputStructInstanceName(shaderType);
        const stage = shaderType === ShaderType.Vertex ? 'vertex' : shaderType === ShaderType.Fragment ? 'fragment' : 'compute';
        const builtinVars = builtinVariables['webgpu'];
        const args = [];
        const prefix = [];
        for(const k in builtinVars){
            if (builtinVars[k].stage === stage && builtinVars[k].inOrOut === inOrOut) {
                args.push({
                    name: builtinVars[k].name,
                    type: builtinVars[k].type
                });
                prefix.push(`@builtin(${builtinVars[k].semantic}) `);
            }
        }
        const inoutList = inOrOut === 'in' ? this._inputs : this._outputs;
        for (const k of inoutList){
            // for debug only
            if (!(k[1] instanceof ASTDeclareVar)) {
                throw new PBInternalError('defineBuiltinStruct() failed: input/output is not declare var ast node');
            }
            const type = k[1].value.getType();
            if (!type.isPrimitiveType() && !type.isArrayType() && !type.isStructType()) {
                throw new Error(`invalid in/out variable type: '${k[1].value.name}'`);
            }
            args.push({
                name: k[1].value.name,
                type: type
            });
            prefix.push(`@location(${k[1].value.value.$location}) ${type.isPrimitiveType() && type.isInteger() ? '@interpolate(flat) ' : ''}`);
        }
        if (args.length > 0) {
            const st = this.findStructType(structName, shaderType);
            if (st) {
                st.getType().reset(structName, 'default', args);
                st.prefix = prefix;
                return null;
            } else {
                const structType = this.internalDefineStructByType(this._shaderType, false, new PBStructTypeInfo(structName, 'default', args));
                this.findStructType(structName, shaderType).prefix = prefix;
                const structInstance = this.struct(structName, instanceName);
                const structInstanceIN = inOrOut === 'in' ? this.struct(structName, getBuiltinParamName(shaderType)) : structInstance;
                return [
                    structType,
                    structInstance,
                    structName,
                    structInstanceIN
                ];
            }
        } else {
            return null;
        }
    }
    /** @internal */ defineInternalStructs() {
        this.defineHiddenStruct(typeFrexpResult);
        this.defineHiddenStruct(typeFrexpResultVec2);
        this.defineHiddenStruct(typeFrexpResultVec3);
        this.defineHiddenStruct(typeFrexpResultVec4);
    }
    /** @internal */ array(...args) {
        if (args.length === 0) {
            throw new PBParamLengthError('array');
        }
        args = args.map((arg)=>this.normalizeExpValue(arg));
        let typeok = true;
        let type = null;
        let isBool = true;
        let isFloat = true;
        let isInt = true;
        let isUint = true;
        let isComposite = false;
        for (const arg of args){
            if (arg instanceof PBShaderExp) {
                const argType = arg.$ast.getType();
                if (!argType.isConstructible()) {
                    typeok = false;
                    break;
                }
                if (!type) {
                    type = argType;
                } else if (!argType.isCompatibleType(type)) {
                    typeok = false;
                }
            }
        }
        if (typeok) {
            if (type && type.isPrimitiveType() && type.isScalarType()) {
                isBool = type.primitiveType === PBPrimitiveType.BOOL;
                isFloat = type.primitiveType === PBPrimitiveType.F32;
                isUint = type.primitiveType === PBPrimitiveType.U32;
                isInt = type.primitiveType === PBPrimitiveType.I32;
            } else if (type) {
                isBool = false;
                isFloat = false;
                isUint = false;
                isInt = false;
                isComposite = true;
            }
            for (const arg of args){
                if (!(arg instanceof PBShaderExp) && isComposite) {
                    typeok = false;
                    break;
                }
                if (typeof arg === 'number') {
                    isBool = false;
                    if ((arg | 0) === arg) {
                        if (arg < 0) {
                            isUint = false;
                            isInt = isInt && arg >= 0x80000000 >> 0;
                        } else {
                            isUint = isUint && arg <= 0xffffffff;
                            isInt = isInt && arg <= 0x7fffffff;
                        }
                    }
                } else if (typeof arg === 'boolean') {
                    isFloat = false;
                    isInt = false;
                    isUint = false;
                }
            }
        }
        if (typeok && !isComposite) {
            if (isBool) {
                type = typeBool;
            } else if (isInt) {
                type = typeI32;
            } else if (isUint) {
                type = typeU32$1;
            } else if (isFloat) {
                type = typeF32;
            }
            typeok = !!type;
        }
        if (!typeok) {
            throw new PBParamTypeError('array');
        }
        if (!type.isPrimitiveType() && !type.isArrayType() && !type.isStructType()) {
            throw new PBParamTypeError('array');
        }
        const arrayType = new PBArrayTypeInfo(type, args.length);
        const exp = new PBShaderExp('', arrayType);
        exp.$ast = new ASTShaderExpConstructor(arrayType, args.map((arg)=>{
            if (arg instanceof PBShaderExp) {
                return arg.$ast;
            }
            if (!type.isPrimitiveType() || !type.isScalarType()) {
                throw new PBTypeCastError(arg, typeof arg, type);
            }
            return new ASTScalar(arg, type);
        }));
        return exp;
    }
    /**
   * Creates a 'discard' statement
   */ discard() {
        this.getCurrentScope().$ast.statements.push(new ASTDiscard());
    }
    /** @internal */ tagShaderExp(getter, tagValue) {
        if (typeof tagValue === 'string') {
            this._reflection.tag(tagValue, getter);
        } else if (Array.isArray(tagValue)) {
            tagValue.forEach((tag)=>this.tagShaderExp(getter, tag));
        } else {
            for (const k of Object.keys(tagValue)){
                this.tagShaderExp((scope)=>{
                    const value = getter(scope);
                    return value[k];
                }, tagValue[k]);
            }
        }
    }
    /** @internal */ in(location, name, variable) {
        if (this._inputs[location]) {
            // input already exists, create an alias
            if (!this._inputScope[name]) {
                Object.defineProperty(this._inputScope, name, {
                    get: function() {
                        return variable;
                    },
                    set: function() {
                        throw new Error(`cannot assign to readonly variable: ${name}`);
                    }
                });
            }
        //throw new Error(`input location ${location} already declared`);
        } else {
            variable.$location = location;
            variable.$declareType = DeclareType.DECLARE_TYPE_IN;
            this._inputs[location] = [
                name,
                new ASTDeclareVar(new ASTPrimitive(variable))
            ];
            Object.defineProperty(this._inputScope, name, {
                get: function() {
                    return variable;
                },
                set: function() {
                    throw new Error(`cannot assign to readonly variable: ${name}`);
                }
            });
            variable.$tags.forEach((val)=>this.tagShaderExp(()=>variable, val));
        }
    }
    /** @internal */ out(location, name, variable) {
        if (this._outputs[location]) {
            throw new Error(`output location ${location} has already been used`);
        }
        variable.$location = location;
        variable.$declareType = DeclareType.DECLARE_TYPE_OUT;
        this._outputs[location] = [
            name,
            new ASTDeclareVar(new ASTPrimitive(variable))
        ];
        for (const prop of [
            name,
            String(location)
        ]){
            Object.defineProperty(this._outputScope, prop, {
                get: function() {
                    return variable;
                },
                set: function(v) {
                    getCurrentProgramBuilder().getCurrentScope().$ast.statements.push(new ASTAssignment(new ASTLValueScalar(variable.$ast), v instanceof PBShaderExp ? v.$ast : v));
                }
            });
        }
    }
    /** @internal */ getDefaultSampler(t, comparison) {
        const u = this._uniforms.findIndex((val)=>val.texture?.exp === t);
        if (u < 0) {
            return;
        //throw new Error('invalid texture uniform object');
        }
        const samplerType = comparison ? 'comparison' : 'sample';
        if (this._uniforms[u].texture.autoBindSampler && this._uniforms[u].texture.autoBindSampler !== samplerType) {
            throw new Error('multiple sampler not supported');
        }
        this._uniforms[u].texture.autoBindSampler = samplerType;
        if (this._device.type === 'webgpu') {
            const samplerName = genSamplerName(t.$str, comparison);
            if (!this.getGlobalScope()[samplerName]) {
                throw new Error(`failed to find sampler name ${samplerName}`);
            }
            return this.getGlobalScope()[samplerName];
        } else {
            return null;
        }
    }
    /** @internal */ normalizeExpValue(value) {
        if (Array.isArray(value)) {
            const converted = value.map((val)=>Array.isArray(val) ? this.normalizeExpValue(val) : val);
            return this.array(...converted);
        } else {
            return value;
        }
    }
    /** @internal */ guessExpValueType(value) {
        const val = this.normalizeExpValue(value);
        if (typeof val === 'boolean') {
            return typeBool;
        } else if (typeof val === 'number') {
            if (!Number.isInteger(val)) {
                return typeF32;
            } else if (val >= 0x80000000 >> 1 && val <= 0x7fffffff) {
                return typeI32;
            } else if (val >= 0 && val <= 0xffffffff) {
                return typeU32$1;
            } else {
                throw new PBValueOutOfRange(val);
            }
        } else if (val instanceof PBShaderExp) {
            return val.$ast?.getType() || val.$typeinfo;
        }
    }
    /** @internal */ findStructType(name, shaderType) {
        for (const st of [
            ShaderType.Vertex,
            ShaderType.Fragment,
            ShaderType.Compute
        ]){
            if (st & shaderType) {
                const structInfo = this._structInfo[st];
                if (structInfo) {
                    for (const t of structInfo.types){
                        if (t.type.structName === name) {
                            return t;
                        }
                    }
                }
            }
        }
        return null;
    }
    /** @internal */ findStructConstructor(name, shaderType) {
        for (const st of [
            ShaderType.Vertex,
            ShaderType.Fragment,
            ShaderType.Compute
        ]){
            if (st & shaderType) {
                const structInfo = this._structInfo[st];
                if (structInfo && structInfo.structs?.[name]) {
                    return structInfo.structs[name];
                }
            }
        }
        return null;
    }
    /** @internal */ buildComputeSource(options) {
        try {
            this._lastError = null;
            this._shaderType = ShaderType.Compute;
            this._scopeStack = [];
            this._globalScope = new PBGlobalScope();
            this._builtinScope = new PBBuiltinScope();
            this._inputs = [];
            this._outputs = [];
            this._inputScope = new PBInputScope();
            this._outputScope = new PBOutputScope();
            this._reflection.clear();
            this.generate(options.compute);
            // this.removeUnusedSamplerBindings(this._globalScope);
            this.mergeUniformsCompute(this._globalScope);
            this.updateUniformBindings([
                this._globalScope
            ], [
                ShaderType.Compute
            ]);
            return [
                this.generateComputeSource(this._globalScope, this._builtinScope),
                this.createBindGroupLayouts(options.label)
            ];
        } catch (err) {
            if (err instanceof PBError) {
                this._lastError = err.getMessage(this._device.type);
                console.error(this._lastError);
                return null;
            } else if (err instanceof Error) {
                this._lastError = err.toString();
                console.error(this._lastError);
                return null;
            } else {
                this._lastError = Object.prototype.toString.call(err);
                console.log(`Error: ${this._lastError}`);
                return null;
            }
        }
    }
    /** @internal */ buildRenderSource(options) {
        try {
            this._lastError = null;
            this._shaderType = ShaderType.Vertex;
            this._scopeStack = [];
            this._globalScope = new PBGlobalScope();
            this._builtinScope = new PBBuiltinScope();
            this._inputs = [];
            this._outputs = [];
            this._inputScope = new PBInputScope();
            this._outputScope = new PBOutputScope();
            this._reflection.clear();
            this.generate(options.vertex);
            const vertexScope = this._globalScope;
            const vertexBuiltinScope = this._builtinScope;
            const vertexInputs = this._inputs;
            const vertexOutputs = this._outputs;
            if (this._device.type === 'webgpu') {
            // this.removeUnusedSamplerBindings(vertexScope);
            }
            this._shaderType = ShaderType.Fragment;
            this._scopeStack = [];
            this._globalScope = new PBGlobalScope();
            this._builtinScope = new PBBuiltinScope();
            this._inputs = [];
            this._outputs = [];
            this._inputScope = new PBInputScope();
            this._outputScope = new PBOutputScope();
            this._reflection.clear();
            vertexOutputs.forEach((val, index)=>{
                this.in(index, val[0], new PBShaderExp(val[1].value.name, val[1].value.getType()).tag(...val[1].value.value.$tags));
            });
            this.generate(options.fragment);
            const fragScope = this._globalScope;
            const fragBuiltinScope = this._builtinScope;
            const fragInputs = this._inputs;
            const fragOutputs = this._outputs;
            if (this._device.type === 'webgpu') {
            // this.removeUnusedSamplerBindings(fragScope);
            }
            this.mergeUniforms(vertexScope, fragScope);
            this.updateUniformBindings([
                vertexScope,
                fragScope
            ], [
                ShaderType.Vertex,
                ShaderType.Fragment
            ]);
            return [
                this.generateRenderSource(ShaderType.Vertex, vertexScope, vertexBuiltinScope, vertexInputs.map((val)=>val[1]), vertexOutputs.map((val)=>val[1])),
                this.generateRenderSource(ShaderType.Fragment, fragScope, fragBuiltinScope, fragInputs.map((val)=>val[1]), fragOutputs.map((val)=>val[1])),
                this.createBindGroupLayouts(options.label),
                this._vertexAttributes
            ];
        } catch (err) {
            if (err instanceof PBError) {
                this._lastError = err.getMessage(this._device.type);
                console.error(this._lastError);
                return null;
            } else if (err instanceof Error) {
                this._lastError = err.toString();
                console.error(this._lastError);
                return null;
            } else {
                this._lastError = Object.prototype.toString.call(err);
                console.log(`Error: ${this._lastError}`);
                return null;
            }
        }
    }
    /** @internal */ generate(body) {
        this.pushScope(this._globalScope);
        if (this._emulateDepthClamp && this._shaderType === ShaderType.Vertex) {
            this._globalScope.$outputs.clamppedDepth = this.float().tag('CLAMPPED_DEPTH');
        }
        body && body.call(this._globalScope, this);
        this.popScope();
        // Global delcarations should be at the first
        this._globalScope.$ast.statements = [
            ...this._globalScope.$ast.statements.filter((val)=>val instanceof ASTDeclareVar || val instanceof ASTAssignment),
            ...this._globalScope.$ast.statements.filter((val)=>!(val instanceof ASTDeclareVar) && !(val instanceof ASTAssignment))
        ];
    }
    /** @internal */ generateRenderSource(shaderType, scope, builtinScope, inputs, outputs) {
        const context = {
            type: shaderType,
            mrt: shaderType === ShaderType.Fragment && outputs.length > 1,
            defines: [],
            extensions: new Set(),
            builtins: [
                ...builtinScope.$_usedBuiltins
            ],
            types: this._structInfo[shaderType]?.types || [],
            typeReplacement: new Map(),
            inputs: inputs,
            outputs: outputs,
            global: scope,
            vertexAttributes: this._vertexAttributes,
            workgroupSize: null
        };
        switch(this._device.type){
            case 'webgl':
                for (const u of this._uniforms){
                    if (u.texture) {
                        const type = u.texture.exp.$ast.getType();
                        if (type.isTextureType() && type.isDepthTexture()) {
                            if (u.texture.autoBindSampler === 'comparison') {
                                throw new PBDeviceNotSupport('depth texture comparison');
                            }
                            if (u.texture.autoBindSampler === 'sample') {
                                if (type.is2DTexture()) {
                                    context.typeReplacement.set(u.texture.exp, typeTex2D);
                                } else if (type.isCubeTexture()) {
                                    context.typeReplacement.set(u.texture.exp, typeTexCube);
                                }
                            }
                        }
                    }
                }
                return scope.$ast.toWebGL('', context);
            case 'webgl2':
                for (const u of this._uniforms){
                    if (u.texture) {
                        const type = u.texture.exp.$ast.getType();
                        if (type.isTextureType() && type.isDepthTexture() && u.texture.autoBindSampler === 'sample') {
                            if (type.is2DTexture()) {
                                context.typeReplacement.set(u.texture.exp, type.isArrayTexture() ? typeTex2DArray : typeTex2D);
                            } else if (type.isCubeTexture()) {
                                context.typeReplacement.set(u.texture.exp, typeTexCube);
                            }
                        }
                    }
                }
                return scope.$ast.toWebGL2('', context);
            case 'webgpu':
                return scope.$ast.toWGSL('', context);
            default:
                return null;
        }
    }
    /** @internal */ generateComputeSource(scope, builtinScope) {
        const context = {
            type: ShaderType.Compute,
            mrt: false,
            defines: [],
            extensions: new Set(),
            builtins: [
                ...builtinScope.$_usedBuiltins
            ],
            types: this._structInfo[ShaderType.Compute]?.types || [],
            typeReplacement: null,
            inputs: [],
            outputs: [],
            global: scope,
            vertexAttributes: [],
            workgroupSize: this._workgroupSize
        };
        return scope.$ast.toWGSL('', context);
    }
    /** @internal */ mergeUniformsCompute(globalScope) {
        const uniformList = [];
        for(let i = 0; i < this._uniforms.length; i++){
            const u = this._uniforms[i];
            if (u.block && (u.block.exp.$declareType === DeclareType.DECLARE_TYPE_UNIFORM || u.block.exp.$declareType === DeclareType.DECLARE_TYPE_STORAGE)) {
                if (u.block.exp.$typeinfo.isStructType() && u.block.exp.$isBuffer) {
                    continue;
                }
                if (!uniformList[u.group]) {
                    uniformList[u.group] = [];
                }
                const exp = new PBShaderExp(u.block.exp.$str, u.block.exp.$ast.getType());
                exp.$declareType = u.block.exp.$declareType;
                exp.$isBuffer = u.block.exp.$isBuffer;
                exp.$bindingSize = u.block.exp.$bindingSize;
                exp.$readonly = u.block.exp.$readonly;
                uniformList[u.group].push({
                    member: exp,
                    uniform: i
                });
            }
        }
        for(const k in uniformList){
            if (uniformList[k].length > 0) {
                const types = [
                    'std140',
                    'std430'
                ];
                const nameList = [
                    COMPUTE_UNIFORM_NAME,
                    COMPUTE_STORAGE_NAME
                ];
                const ulist = [
                    uniformList[k].filter((val)=>val.member.$declareType === DeclareType.DECLARE_TYPE_UNIFORM),
                    uniformList[k].filter((val)=>val.member.$declareType === DeclareType.DECLARE_TYPE_STORAGE)
                ];
                for(let i = 0; i < 2; i++){
                    if (ulist[i].length === 0) {
                        continue;
                    }
                    const nonBufferList = ulist[i].filter((val)=>!val.member.$isBuffer);
                    const bufferList = ulist[i].filter((val)=>val.member.$isBuffer);
                    const allLists = [
                        nonBufferList,
                        ...bufferList.map((val)=>[
                                val
                            ])
                    ];
                    for(let p = 0; p < allLists.length; p++){
                        if (allLists[p].length === 0) {
                            continue;
                        }
                        const uname = `${nameList[i]}_${k}_${p}`;
                        const structName = this.generateStructureName();
                        const t = getCurrentProgramBuilder().internalDefineStruct(structName, types[i], ShaderType.Compute, false, ...allLists[p].map((val)=>val.member));
                        const readonly = i > 0 ? allLists[p].findIndex((val)=>!val.member.$readonly) < 0 : true;
                        const exp = t();
                        if (i === 0) {
                            exp.uniformBuffer(Number(k), p > 0 ? allLists[p][0].member.$bindingSize : 0);
                        } else {
                            exp.storageBuffer(Number(k), p > 0 ? allLists[p][0].member.$bindingSize : 0);
                            exp.$readonly = readonly;
                        }
                        globalScope[uname] = exp;
                        const index = this._uniforms.findIndex((val)=>val.block?.name === uname);
                        this._uniforms[index].mask = ShaderType.Compute;
                        let nameMap = this._nameMap[Number(k)];
                        if (!nameMap) {
                            nameMap = {};
                            this._nameMap[Number(k)] = nameMap;
                        }
                        let writable = false;
                        for(let n = allLists[p].length - 1; n >= 0; n--){
                            const u = allLists[p][n];
                            const exp = this._uniforms[u.uniform].block.exp;
                            nameMap[exp.$str] = uname;
                            exp.$str = `${uname}.${exp.$str}`;
                            writable ||= exp.$ast.isWritable();
                        }
                        if (writable) {
                            globalScope[uname].$ast.markWritable();
                        }
                    }
                }
            }
        }
        this._uniforms = this._uniforms.filter((val)=>{
            return !val.block || val.block.exp.$typeinfo.isStructType() && val.block.exp.$isBuffer;
        //return !val.block || val.block.exp.$isBuffer;
        /*
      if (!val.block || (val.block.exp.$declareType !== AST.DeclareType.DECLARE_TYPE_UNIFORM && val.block.exp.$declareType !== AST.DeclareType.DECLARE_TYPE_STORAGE)) {
        return true;
      }
      const type = val.block.exp.$ast.getType();
      return (
        type.isTextureType() ||
        type.isSamplerType() ||
        (type.isStructType() && (type.detail.layout === 'std140' || type.detail.layout === 'std430'))
      );
      */ });
    }
    /** @internal */ mergeUniforms(globalScopeVertex, globalScopeFragmet) {
        const vertexUniformList = [];
        const fragUniformList = [];
        const sharedUniformList = [];
        //const vertexUniformList: { members: PBShaderExp[]; uniforms: number[] }[] = [];
        //const fragUniformList: { members: PBShaderExp[]; uniforms: number[] }[] = [];
        //const sharedUniformList: { members: PBShaderExp[]; uniforms: number[] }[] = [];
        for(let i = 0; i < this._uniforms.length; i++){
            const u = this._uniforms[i];
            if (u.block && (u.block.exp.$declareType === DeclareType.DECLARE_TYPE_UNIFORM || u.block.exp.$declareType === DeclareType.DECLARE_TYPE_STORAGE)) {
                if (u.block.exp.$typeinfo.isStructType() && u.block.exp.$isBuffer) {
                    continue;
                }
                const v = !!(u.mask & ShaderType.Vertex);
                const f = !!(u.mask & ShaderType.Fragment);
                if (v && f) {
                    if (!sharedUniformList[u.group]) {
                        sharedUniformList[u.group] = []; //{ members: [], uniforms: [] };
                    }
                    const exp = new PBShaderExp(u.block.exp.$str, u.block.exp.$ast.getType());
                    exp.$declareType = u.block.exp.$declareType;
                    exp.$isBuffer = u.block.exp.$isBuffer;
                    exp.$bindingSize = u.block.exp.$bindingSize;
                    exp.$readonly = u.block.exp.$readonly;
                    sharedUniformList[u.group].push({
                        member: exp,
                        uniform: i
                    });
                //sharedUniformList[u.group].uniforms.push(i);
                } else if (v) {
                    if (!vertexUniformList[u.group]) {
                        vertexUniformList[u.group] = []; //{ members: [], uniforms: [] };
                    }
                    const exp = new PBShaderExp(u.block.exp.$str, u.block.exp.$ast.getType());
                    exp.$declareType = u.block.exp.$declareType;
                    exp.$isBuffer = u.block.exp.$isBuffer;
                    exp.$bindingSize = u.block.exp.$bindingSize;
                    exp.$readonly = u.block.exp.$readonly;
                    vertexUniformList[u.group].push({
                        member: exp,
                        uniform: i
                    });
                //vertexUniformList[u.group].uniforms.push(i);
                } else if (f) {
                    if (!fragUniformList[u.group]) {
                        fragUniformList[u.group] = []; //{ members: [], uniforms: [] };
                    }
                    const exp = new PBShaderExp(u.block.exp.$str, u.block.exp.$ast.getType());
                    exp.$declareType = u.block.exp.$declareType;
                    exp.$isBuffer = u.block.exp.$isBuffer;
                    exp.$bindingSize = u.block.exp.$bindingSize;
                    exp.$readonly = u.block.exp.$readonly;
                    fragUniformList[u.group].push({
                        member: exp,
                        uniform: i
                    }); //members.push(exp);
                //fragUniformList[u.group].uniforms.push(i);
                }
            }
        }
        const uniformLists = [
            vertexUniformList,
            fragUniformList,
            sharedUniformList
        ];
        const nameListUniform = [
            VERTEX_UNIFORM_NAME,
            FRAGMENT_UNIFORM_NAME,
            SHARED_UNIFORM_NAME
        ];
        const nameListStorage = [
            VERTEX_STORAGE_NAME,
            FRAGMENT_STORAGE_NAME,
            SHARED_STORAGE_NAME
        ];
        const maskList = [
            ShaderType.Vertex,
            ShaderType.Fragment,
            ShaderType.Vertex | ShaderType.Fragment
        ];
        for(let i = 0; i < 3; i++){
            for(const k in uniformLists[i]){
                if (uniformLists[i][k]?.length > 0) {
                    const ulist = [
                        uniformLists[i][k].filter((val)=>val.member.$declareType === DeclareType.DECLARE_TYPE_UNIFORM),
                        uniformLists[i][k].filter((val)=>val.member.$declareType === DeclareType.DECLARE_TYPE_STORAGE)
                    ];
                    const nameList = [
                        nameListUniform,
                        nameListStorage
                    ];
                    const layoutList = [
                        'std140',
                        'std430'
                    ];
                    for(let j = 0; j < 2; j++){
                        if (ulist[j].length === 0) {
                            continue;
                        }
                        const nonBufferList = ulist[j].filter((val)=>!val.member.$isBuffer);
                        const bufferList = ulist[j].filter((val)=>val.member.$isBuffer);
                        const allLists = [
                            nonBufferList,
                            ...bufferList.map((val)=>[
                                    val
                                ])
                        ];
                        for(let p = 0; p < allLists.length; p++){
                            if (allLists[p].length === 0) {
                                continue;
                            }
                            const uname = `${nameList[j][i]}_${k}_${p}`;
                            const structName = this.generateStructureName();
                            const t = getCurrentProgramBuilder().internalDefineStruct(structName, layoutList[j], maskList[i], false, ...allLists[p].map((val)=>val.member));
                            const readonly = j > 0 ? allLists[p].findIndex((val)=>!val.member.$readonly) < 0 : true;
                            if (maskList[i] & ShaderType.Vertex) {
                                const exp = t();
                                if (j > 0 && !readonly) {
                                    throw new Error(`Storage buffer in vertex shader must be read-only`);
                                }
                                if (j === 0) {
                                    exp.uniformBuffer(Number(k), p > 0 ? allLists[p][0].member.$bindingSize : 0);
                                } else {
                                    exp.storageBuffer(Number(k), p > 0 ? allLists[p][0].member.$bindingSize : 0);
                                    exp.$readonly = readonly;
                                }
                                globalScopeVertex[uname] = exp;
                            }
                            if (maskList[i] & ShaderType.Fragment) {
                                const exp = t();
                                if (j === 0) {
                                    exp.uniformBuffer(Number(k), p > 0 ? allLists[p][0].member.$bindingSize : 0);
                                } else {
                                    exp.storageBuffer(Number(k), p > 0 ? allLists[p][0].member.$bindingSize : 0);
                                    exp.$readonly = readonly;
                                }
                                globalScopeFragmet[uname] = exp;
                            }
                            const index = this._uniforms.findIndex((val)=>val.block?.name === uname);
                            this._uniforms[index].mask = maskList[i];
                            let nameMap = this._nameMap[Number(k)];
                            if (!nameMap) {
                                nameMap = {};
                                this._nameMap[Number(k)] = nameMap;
                            }
                            let writable = false;
                            for(let n = allLists[p].length - 1; n >= 0; n--){
                                const u = allLists[p][n];
                                const exp = this._uniforms[u.uniform].block.exp;
                                nameMap[exp.$str] = uname;
                                exp.$str = `${uname}.${exp.$str}`;
                                writable ||= exp.$ast.isWritable();
                            }
                            if (writable) {
                                if (maskList[i] & ShaderType.Vertex) {
                                    globalScopeVertex[uname].$ast.markWritable();
                                } else {
                                    globalScopeFragmet[uname].$ast.markWritable();
                                }
                            }
                        }
                    }
                }
            }
        }
        this._uniforms = this._uniforms.filter((val)=>{
            return !val.block || val.block.exp.$typeinfo.isStructType() && val.block.exp.$isBuffer;
        /*
      if (!val.block) {
        return true;
      }
      const type = val.block.exp.$ast.getType();
      return (
        type.isTextureType() ||
        type.isSamplerType() ||
        (type.isStructType() && (type.detail.layout === 'std140' || type.detail.layout === 'std430'))
      );
      */ });
    }
    /** @internal */ updateUniformBindings(scopes, shaderTypes) {
        this._uniforms = this._uniforms.filter((val)=>!!val.mask);
        const bindings = Array.from({
            length: MAX_BINDING_GROUPS
        }).fill(0);
        for (const u of this._uniforms){
            u.binding = bindings[u.group]++;
        }
        for(let i = 0; i < scopes.length; i++){
            const scope = scopes[i];
            const type = shaderTypes[i];
            for (const u of this._uniforms){
                if (u.mask & type) {
                    const uniforms = scope.$ast.uniforms;
                    const name = u.block ? u.block.name : u.texture ? u.texture.exp.$str : u.sampler.$str;
                    const index = uniforms.findIndex((val)=>val.value.name === name);
                    if (index < 0) {
                        throw new Error(`updateUniformBindings() failed: unable to find uniform ${name}`);
                    }
                    uniforms[index].binding = u.binding;
                }
            }
        }
    }
    /** @internal */ createBindGroupLayouts(label) {
        const layouts = [];
        const dynamicOffsetIndex = [
            0,
            0,
            0,
            0
        ];
        for (const uniformInfo of this._uniforms){
            let layout = layouts[uniformInfo.group];
            if (!layout) {
                layout = {
                    label: `${label || 'unknown'}[${uniformInfo.group}]`,
                    entries: []
                };
                if (this._nameMap[uniformInfo.group]) {
                    layout.nameMap = this._nameMap[uniformInfo.group];
                }
                layouts[uniformInfo.group] = layout;
            }
            const entry = {
                binding: uniformInfo.binding,
                visibility: uniformInfo.mask,
                type: null,
                name: ''
            };
            if (uniformInfo.block) {
                entry.type = uniformInfo.block.exp.$typeinfo.clone(this.getBlockName(uniformInfo.block.name));
                const isStorage = uniformInfo.block.exp.$declareType === DeclareType.DECLARE_TYPE_STORAGE;
                entry.buffer = {
                    type: isStorage ? uniformInfo.block.exp.$readonly ? 'read-only-storage' : 'storage' : 'uniform',
                    minBindingSize: uniformInfo.block.bindingSize,
                    hasDynamicOffset: !!uniformInfo.block.bindingSize,
                    uniformLayout: entry.type.toBufferLayout(0, entry.type.layout),
                    dynamicOffsetIndex: !!uniformInfo.block.bindingSize ? dynamicOffsetIndex[uniformInfo.group]++ : -1
                };
                entry.name = uniformInfo.block.name;
            } else if (uniformInfo.texture) {
                entry.type = uniformInfo.texture.exp.$typeinfo;
                if (!entry.type.isTextureType()) {
                    throw new Error('internal error');
                }
                if (entry.type.isStorageTexture()) {
                    entry.storageTexture = {
                        access: 'write-only',
                        viewDimension: entry.type.is1DTexture() ? '1d' : '2d',
                        format: entry.type.storageTexelFormat
                    };
                } else if (entry.type.isExternalTexture()) {
                    entry.externalTexture = {
                        autoBindSampler: uniformInfo.texture.autoBindSampler ? genSamplerName(uniformInfo.texture.exp.$str, false) : null
                    };
                } else {
                    const sampleType = this._device.type === 'webgpu' ? uniformInfo.texture.exp.$sampleType : uniformInfo.texture.autoBindSampler && entry.type.isDepthTexture() ? 'float' : uniformInfo.texture.exp.$sampleType;
                    let viewDimension;
                    if (entry.type.isArrayTexture()) {
                        viewDimension = entry.type.isCubeTexture() ? 'cube-array' : '2d-array';
                    } else if (entry.type.is3DTexture()) {
                        viewDimension = '3d';
                    } else if (entry.type.isCubeTexture()) {
                        viewDimension = 'cube';
                    } else if (entry.type.is1DTexture()) {
                        viewDimension = '1d';
                    } else {
                        viewDimension = '2d';
                    }
                    entry.texture = {
                        sampleType: sampleType,
                        viewDimension: viewDimension,
                        multisampled: false,
                        autoBindSampler: null,
                        autoBindSamplerComparison: null
                    };
                    if (this._device.type === 'webgpu' || uniformInfo.texture.autoBindSampler === 'sample') {
                        entry.texture.autoBindSampler = genSamplerName(uniformInfo.texture.exp.$str, false);
                    }
                    if (this._device.type === 'webgpu' && entry.type.isDepthTexture() || uniformInfo.texture.autoBindSampler === 'comparison') {
                        entry.texture.autoBindSamplerComparison = genSamplerName(uniformInfo.texture.exp.$str, true);
                    }
                }
                entry.name = uniformInfo.texture.exp.$str;
            } else if (uniformInfo.sampler) {
                entry.type = uniformInfo.sampler.$typeinfo;
                if (!entry.type.isSamplerType()) {
                    throw new Error('internal error');
                }
                entry.sampler = {
                    type: entry.type.accessMode === PBSamplerAccessMode.SAMPLE ? uniformInfo.sampler.$sampleType === 'float' ? 'filtering' : 'non-filtering' : 'comparison'
                };
                entry.name = uniformInfo.sampler.$str;
            } else {
                throw new PBInternalError('invalid uniform entry type');
            }
            layout.entries.push(entry);
        }
        for(let i = 0; i < layouts.length; i++){
            if (!layouts[i]) {
                layouts[i] = {
                    label: `${label || 'unknown'}[${i}]`,
                    entries: []
                };
            }
        }
        return layouts;
    }
    /** @internal */ _getFunctionOverload(funcName, args) {
        const thisArgs = args.filter((val)=>{
            if (val instanceof PBShaderExp) {
                const type = val.$ast.getType();
                if (type.isStructType() && this._structInfo[this._shaderType]?.types.findIndex((t)=>t.type.structName === type.structName) < 0) {
                    return false;
                }
            }
            return true;
        });
        const fn = this.getGlobalScope().$getFunctions(funcName);
        return fn ? this._matchFunctionOverloading(fn, thisArgs) : null;
    }
    /** @internal */ _matchFunctionOverloading(overloadings, args) {
        for (const overload of overloadings){
            if (args.length !== overload.funcType.argTypes.length) {
                continue;
            }
            const result = [];
            let matches = true;
            for(let i = 0; i < args.length; i++){
                const argInfo = overload.funcType.argTypes[i];
                const argType = argInfo.byRef && argInfo.type instanceof PBPointerTypeInfo ? argInfo.type.pointerType : argInfo.type;
                const arg = args[i];
                if (typeof arg === 'boolean') {
                    if (!argType.isPrimitiveType() || argType.primitiveType !== PBPrimitiveType.BOOL) {
                        matches = false;
                        break;
                    }
                    result.push(new ASTScalar(arg, typeBool));
                } else if (typeof arg === 'number') {
                    if (!argType.isPrimitiveType() || !argType.isScalarType() || argType.scalarType === PBPrimitiveType.BOOL) {
                        matches = false;
                        break;
                    }
                    if (argType.scalarType === PBPrimitiveType.I32) {
                        if (!Number.isInteger(arg) || arg < 0x80000000 >> 0 || arg > 0x7fffffff) {
                            matches = false;
                            break;
                        }
                        result.push(new ASTScalar(arg, typeI32));
                    } else if (argType.scalarType === PBPrimitiveType.U32) {
                        if (!Number.isInteger(arg) || arg < 0 || arg > 0xffffffff) {
                            matches = false;
                            break;
                        }
                        result.push(new ASTScalar(arg, typeU32$1));
                    } else {
                        result.push(new ASTScalar(arg, argType));
                    }
                } else {
                    if (!argType.isCompatibleType(arg.$ast.getType())) {
                        matches = false;
                        break;
                    }
                    result.push(arg.$ast);
                }
            }
            if (matches) {
                return [
                    overload,
                    result
                ];
            }
        }
        return null;
    }
    /** @internal */ $callFunction(funcName, args, func) {
        if (this.getCurrentScope() === this.getGlobalScope()) {
            throw new PBNonScopedFunctionCall(funcName);
        }
        const exp = new PBShaderExp('', func.returnType);
        exp.$ast = new ASTCallFunction(funcName, args, func, getCurrentProgramBuilder().getDevice().type);
        this.getCurrentScope().$ast.statements.push(exp.$ast);
        return exp;
    }
    /** @internal */ $callFunctionNoCheck(funcName, args, retType) {
        if (this.getCurrentScope() === this.getGlobalScope()) {
            throw new PBNonScopedFunctionCall(funcName);
        }
        const exp = new PBShaderExp('', retType);
        exp.$ast = new ASTCallFunction(funcName, args, null, getCurrentProgramBuilder().getDevice().type, retType);
        this.getCurrentScope().$ast.statements.push(exp.$ast);
        return exp;
    }
}
/**
 * Base class for scope of the shader program
 * @public
 */ class PBScope extends Proxiable {
    /** @internal */ $_variables;
    /** @internal */ $_parentScope;
    /** @internal */ $_AST;
    /** @internal */ $_localScope;
    /** @internal */ constructor(astScope, parent){
        super();
        this.$_parentScope = parent || null;
        this.$_variables = {};
        this.$_AST = astScope;
        this.$_localScope = null;
    }
    /** Get the program builder */ get $builder() {
        return getCurrentProgramBuilder();
    }
    /** Returns the scope of the builtin variables */ get $builtins() {
        return getCurrentProgramBuilder().builtinScope;
    }
    /** Returns the scope of the input variables */ get $inputs() {
        return getCurrentProgramBuilder().inputScope;
    }
    /** Returns the scope of the output variables */ get $outputs() {
        return getCurrentProgramBuilder().outputScope;
    }
    /** @internal */ get $parent() {
        return this.$_parentScope;
    }
    /** @internal */ get $ast() {
        return this.$_AST;
    }
    /** @internal */ set $ast(ast) {
        this.$_AST = ast;
    }
    /**
   * Get the input vertex attribute by specified semantic
   *
   * @remarks
   * Can only be called only in vertex shader
   *
   * @param semantic - The vertex semantic
   * @returns The input vertex attribute or null if not exists
   */ $getVertexAttrib(semantic) {
        return this.$inputs.$getVertexAttrib(semantic); // getCurrentProgramBuilder().getReflection().attribute(semantic);
    }
    /** Get the current local scope */ get $l() {
        return this.$_getLocalScope();
    }
    /** Get the global scope */ get $g() {
        return this.$_getGlobalScope();
    }
    /** @internal */ $local(variable, init) {
        const initNonArray = getCurrentProgramBuilder().normalizeExpValue(init);
        variable.$global = this instanceof PBGlobalScope;
        this.$_declare(variable, initNonArray);
    }
    /** @internal */ $touch(exp) {
        this.$ast.statements.push(new ASTTouch(exp.$ast));
    }
    /**
   * Query the global variable by the name
   * @param name - Name of the variable
   * @returns The variable or null if not exists
   */ $query(name) {
        return this.$builder.getReflection().tag(name);
    }
    /** @internal */ $_declareInternal(variable, init) {
        const key = variable.$str;
        if (this.$_variables[key]) {
            throw new Error(`cannot re-declare variable '${key}'`);
        }
        if (!(variable.$ast instanceof ASTPrimitive)) {
            throw new Error(`invalid variable declaration: '${variable.$ast.toString(getCurrentProgramBuilder().getDevice().type)}'`);
        }
        const varType = variable.$typeinfo;
        if (varType.isPointerType()) {
            if (!init) {
                throw new Error(`cannot declare pointer type variable without initialization: '${variable.$str}'`);
            }
            if (!(init instanceof PBShaderExp)) {
                throw new Error(`invalid initialization for pointer type declaration: '${variable.$str}`);
            }
            const initType = init.$ast.getType();
            if (!initType.isPointerType() || !varType.pointerType.isCompatibleType(initType.pointerType)) {
                throw new Error(`incompatible pointer type assignment: '${variable.$str}'`);
            }
            variable.$typeinfo = initType;
        }
        this.$_registerVar(variable, key);
        if (init === undefined || init === null) {
            return new ASTDeclareVar(variable.$ast);
        } else {
            if (init instanceof PBShaderExp && init.$ast instanceof ASTShaderExpConstructor && init.$ast.args.length === 0) {
                if (!init.$ast.getType().isCompatibleType(variable.$ast.getType())) {
                    throw new PBTypeCastError(init, init.$ast.getType(), variable.$ast.getType());
                }
                return new ASTDeclareVar(variable.$ast);
            } else {
                return new ASTAssignment(new ASTLValueDeclare(variable.$ast), init instanceof PBShaderExp ? init.$ast : init);
            }
        }
    }
    /** @internal */ $_findOrSetUniform(variable) {
        const name = variable.$str;
        const uniformInfo = {
            group: variable.$group,
            binding: 0,
            mask: 0
        };
        if (variable.$typeinfo.isTextureType()) {
            uniformInfo.texture = {
                autoBindSampler: null,
                exp: variable
            };
        } else if (variable.$typeinfo.isSamplerType()) {
            uniformInfo.sampler = variable;
        } else {
            uniformInfo.block = {
                name: name,
                bindingSize: variable.$bindingSize,
                exp: variable
            };
        // throw new Error(`unsupported uniform type: ${name}`);
        }
        let found = false;
        for (const u of getCurrentProgramBuilder()._uniforms){
            if (u.group !== uniformInfo.group) {
                continue;
            }
            if (uniformInfo.block && u.block && u.block.name === uniformInfo.block.name && u.block.exp.$typeinfo.isCompatibleType(uniformInfo.block.exp.$typeinfo)) {
                u.mask |= getCurrentProgramBuilder().shaderType;
                variable = u.block.exp;
                // u.block.exp = variable;
                found = true;
                break;
            }
            if (uniformInfo.texture && u.texture && uniformInfo.texture.exp.$str === u.texture.exp.$str && uniformInfo.texture.exp.$typeinfo.isCompatibleType(u.texture.exp.$typeinfo)) {
                u.mask |= getCurrentProgramBuilder().shaderType;
                variable = u.texture.exp;
                // u.texture.exp = variable;
                found = true;
                break;
            }
            if (uniformInfo.sampler && u.sampler && uniformInfo.sampler.$str === u.sampler.$str && uniformInfo.sampler.$typeinfo.isCompatibleType(u.sampler.$typeinfo)) {
                u.mask |= getCurrentProgramBuilder().shaderType;
                variable = u.sampler;
                // u.sampler = variable;
                found = true;
                break;
            }
        }
        if (!found) {
            uniformInfo.mask = getCurrentProgramBuilder().shaderType;
            getCurrentProgramBuilder()._uniforms.push(uniformInfo);
        }
        if (uniformInfo.texture && !uniformInfo.texture.exp.$typeinfo.isStorageTexture() && getCurrentProgramBuilder().getDevice().type === 'webgpu') {
            // webgpu requires explicit sampler bindings
            const isDepth = variable.$typeinfo.isTextureType() && variable.$typeinfo.isDepthTexture();
            const samplerName = genSamplerName(variable.$str, false);
            const samplerExp = getCurrentProgramBuilder().sampler(samplerName).uniform(uniformInfo.group).sampleType(variable.$sampleType);
            samplerExp.$sampleType = variable.$sampleType;
            this.$local(samplerExp);
            if (isDepth) {
                const samplerNameComp = genSamplerName(variable.$str, true);
                const samplerExpComp = getCurrentProgramBuilder().samplerComparison(samplerNameComp).uniform(uniformInfo.group).sampleType(variable.$sampleType);
                this.$local(samplerExpComp);
            }
        }
        return variable;
    }
    /** @internal */ $_declare(variable, init) {
        if (this.$_variables[variable.$str]) {
            throw new PBASTError(variable.$ast, 'cannot re-declare variable');
        }
        if (variable.$declareType === DeclareType.DECLARE_TYPE_UNIFORM || variable.$declareType === DeclareType.DECLARE_TYPE_STORAGE) {
            const name = variable.$ast.name;
            if (!(this instanceof PBGlobalScope)) {
                throw new Error(`uniform or storage variables can only be declared within global scope: ${name}`);
            }
            if (variable.$declareType === DeclareType.DECLARE_TYPE_UNIFORM && !variable.$typeinfo.isTextureType() && !variable.$typeinfo.isSamplerType() && (!variable.$typeinfo.isConstructible() || !variable.$typeinfo.isHostSharable())) {
                throw new PBASTError(variable.$ast, `type '${variable.$typeinfo.toTypeName(getCurrentProgramBuilder().getDevice().type)}' cannot be declared in uniform address space`);
            }
            if (variable.$declareType === DeclareType.DECLARE_TYPE_STORAGE) {
                if (getCurrentProgramBuilder().getDevice().type !== 'webgpu') {
                    throw new PBDeviceNotSupport('storage buffer binding');
                } else if (!variable.$typeinfo.isHostSharable()) {
                    throw new PBASTError(variable.$ast, `type '${variable.$typeinfo.toTypeName(getCurrentProgramBuilder().getDevice().type)}' cannot be declared in storage address space`);
                }
            }
            /*
      if (
        variable.$declareType === AST.DeclareType.DECLARE_TYPE_STORAGE &&
        (variable.$typeinfo.isPrimitiveType() || variable.$typeinfo.isArrayType() || variable.$typeinfo.isAtomicI32() || variable.$typeinfo.isAtomicU32())
      ) {
        originalType = variable.$typeinfo as PBPrimitiveTypeInfo | PBArrayTypeInfo;
        const wrappedStruct = getCurrentProgramBuilder().defineStruct(null, new PBShaderExp('value', originalType));
        variable.$typeinfo = wrappedStruct().$typeinfo;
      }
      */ variable = this.$_findOrSetUniform(variable);
            const ast = this.$_declareInternal(variable);
            ast.group = variable.$group;
            ast.binding = 0;
            ast.blockName = getCurrentProgramBuilder().getBlockName(name);
            const type = variable.$typeinfo;
            if (type.isStructType() && variable.$isBuffer || type.isTextureType() || type.isSamplerType() || type.isStructType() && (type.detail.layout === 'std140' || type.detail.layout === 'std430')) {
                this.$ast.uniforms.push(ast);
            }
            variable.$tags.forEach((val)=>{
                getCurrentProgramBuilder().tagShaderExp(()=>variable, val);
            });
        } else {
            const ast = this.$_declareInternal(variable, init);
            this.$ast.statements.push(ast);
        }
    }
    /** @internal */ $_registerVar(variable, name) {
        const key = name || variable.$str;
        const options = {
            configurable: true,
            get: function() {
                return variable;
            },
            set: function(val) {
                getCurrentProgramBuilder().getCurrentScope().$ast.statements.push(new ASTAssignment(new ASTLValueScalar(variable.$ast), val instanceof PBShaderExp ? val.$ast : val));
            }
        };
        Object.defineProperty(this, key, options);
        this.$_variables[key] = variable;
    }
    /** @internal */ $localGet(prop) {
        if (typeof prop === 'string' && (prop[0] === '$' || prop in this)) {
            return this[prop];
        }
        return undefined;
    }
    /** @internal */ $localSet(prop, value) {
        if (prop[0] === '$' || prop in this) {
            this[prop] = value;
            return true;
        }
        return false;
    }
    /** @internal */ $get(prop) {
        const ret = this.$localGet(prop);
        return ret === undefined && this.$_parentScope ? this.$_parentScope.$thisProxy.$get(prop) : ret;
    }
    /** @internal */ $set(prop, value) {
        if (prop[0] === '$') {
            this[prop] = value;
            return true;
        } else {
            let scope = this;
            while(scope && !(prop in scope)){
                scope = scope.$_parentScope;
            }
            if (scope) {
                scope[prop] = value;
                return true;
            } else {
                if (this.$l) {
                    this.$l[prop] = value;
                    return true;
                }
            }
        }
        return false;
    }
    /** @internal */ $_getLocalScope() {
        if (!this.$_localScope) {
            this.$_localScope = new PBLocalScope(this);
        }
        return this.$_localScope;
    }
    /** @internal */ $_getGlobalScope() {
        return this.$builder.getGlobalScope();
    }
}
/**
 * The local scope of a shader
 * @public
 */ class PBLocalScope extends PBScope {
    /** @internal */ $_scope;
    constructor(scope){
        super(null, null);
        this.$_scope = scope;
    }
    /** @internal */ $get(prop) {
        return prop[0] === '$' ? this[prop] : this.$_scope.$localGet(prop);
    }
    /** @internal */ $set(prop, value) {
        if (prop[0] === '$') {
            this[prop] = value;
            return true;
        }
        if (!(this.$_scope instanceof PBGlobalScope) && value instanceof PBShaderExp && (value.isConstructor() || value.$typeinfo.isTextureType() && value.$ast instanceof ASTPrimitive && !value.$ast.name) && (value.$declareType === DeclareType.DECLARE_TYPE_UNIFORM || value.$declareType === DeclareType.DECLARE_TYPE_STORAGE)) {
            // We are setting uniform a uniform, should invoke in the global scope
            this.$g[prop] = value;
            return true;
        }
        const val = this.$_scope.$localGet(prop);
        if (val === undefined) {
            const type = getCurrentProgramBuilder().guessExpValueType(value);
            if (type.isCompatibleType(typeVoid)) {
                throw new Error(`Cannot assign void type to '${prop}'`);
            }
            const exp = new PBShaderExp(prop, type);
            if (value instanceof PBShaderExp && !this.$_scope.$parent) {
                exp.$declareType = value.$declareType;
                exp.$isBuffer = value.$isBuffer;
                exp.$bindingSize = value.$bindingSize;
                exp.$readonly = value.$readonly;
                exp.$group = value.$group;
                exp.$attrib = value.$attrib;
                exp.$sampleType = value.$sampleType;
                exp.$precision = value.$precision;
                exp.tag(...value.$tags);
            }
            this.$_scope.$local(exp, value);
            return true;
        } else {
            return this.$_scope.$localSet(prop, value);
        }
    }
    /** @internal */ $_getLocalScope() {
        return this;
    }
}
/**
 * The builtin scope of a shader
 * @public
 */ class PBBuiltinScope extends PBScope {
    /** @internal */ $_usedBuiltins;
    /** @internal */ $_builtinVars;
    constructor(){
        super(null);
        this.$_usedBuiltins = new Set();
        const isWebGPU = getCurrentProgramBuilder().getDevice().type === 'webgpu';
        if (!isWebGPU) {
            this.$_builtinVars = {};
            const v = builtinVariables[getCurrentProgramBuilder().getDevice().type];
            for(const k in v){
                const info = v[k];
                this.$_builtinVars[k] = new PBShaderExp(info.name, info.type);
            }
        }
        const v = builtinVariables[getCurrentProgramBuilder().getDevice().type];
        const that = this;
        for (const k of Object.keys(v)){
            Object.defineProperty(this, k, {
                get: function() {
                    return that.$getBuiltinVar(k);
                },
                set: function(v) {
                    if (typeof v !== 'number' && !(v instanceof PBShaderExp)) {
                        throw new Error(`Invalid output value assignment`);
                    }
                    const exp = that.$getBuiltinVar(k);
                    getCurrentProgramBuilder().getCurrentScope().$ast.statements.push(new ASTAssignment(new ASTLValueScalar(exp.$ast), v instanceof PBShaderExp ? v.$ast : v));
                }
            });
        }
    }
    /** @internal */ $_getLocalScope() {
        return null;
    }
    /** @internal */ $getBuiltinVar(name) {
        const pb = getCurrentProgramBuilder();
        this.$_usedBuiltins.add(name);
        const isWebGPU = pb.getDevice().type === 'webgpu';
        if (isWebGPU) {
            const v = builtinVariables[pb.getDevice().type];
            const info = v[name];
            const inout = info.inOrOut;
            if (inout === 'in') {
                return pb.getCurrentFunctionScope()[getBuiltinParamName(pb.shaderType)][info.name];
            }
            const structName = inout === 'in' ? getBuiltinInputStructInstanceName(pb.shaderType) : getBuiltinOutputStructInstanceName(pb.shaderType);
            const scope = pb.getCurrentScope();
            if (!scope[structName] || !scope[structName][info.name]) {
                throw new Error(`invalid use of builtin variable ${name}`);
            }
            return scope[structName][info.name];
        } else {
            if (pb.getDevice().type === 'webgl2' && (name === 'vertexIndex' || name === 'instanceIndex')) {
                return pb.uint(this.$_builtinVars[name]);
            } else {
                return this.$_builtinVars[name];
            }
        }
    }
}
/**
 * The input scope of a shader
 * @public
 */ class PBInputScope extends PBScope {
    /** @internal */ $_names;
    $_aliases;
    /** @internal */ constructor(){
        super(null);
        this.$_names = {};
        this.$_aliases = {};
    }
    /** @internal */ $getVertexAttrib(attrib) {
        const name = this.$_names[attrib];
        return name ? this[name] : null;
    }
    /** @internal */ $_getLocalScope() {
        return null;
    }
    /** @internal */ $get(prop) {
        if (prop[0] === '$') {
            return this[prop];
        }
        if (this.$_aliases[prop]) {
            prop = this.$_aliases[prop];
        }
        const pb = this.$builder;
        if (pb.getDevice().type === 'webgpu') {
            const param = pb.getCurrentFunctionScope()[getBuiltinParamName(pb.shaderType)];
            const prefix = pb.shaderKind === 'vertex' ? input_prefix : output_prefix_vs;
            const name = `${prefix}${prop}`;
            if (param.$typeinfo.structMembers.findIndex((val)=>val.name === name) < 0) {
                return undefined;
            }
            return param[`${prefix}${prop}`];
        }
        return super.$get(prop);
    }
    /** @internal */ $set(prop, value) {
        if (prop[0] === '$') {
            this[prop] = value;
        } else {
            if (!(value instanceof PBShaderExp)) {
                throw new Error(`invalid vertex input value`);
            }
            const st = getCurrentProgramBuilder().shaderType;
            if (st !== ShaderType.Vertex) {
                throw new Error(`shader input variables can only be declared in vertex shader: "${prop}"`);
            }
            const attrib = getVertexAttribByName(value.$attrib);
            if (attrib === undefined) {
                throw new Error(`can not declare shader input variable: invalid vertex attribute: "${prop}"`);
            }
            if (getCurrentProgramBuilder()._vertexAttributes.indexOf(attrib) >= 0) {
                const lastName = this.$_names[value.$attrib];
                if (prop !== lastName) {
                    const p = this[lastName];
                    if (p.$typeinfo.typeId !== value.$typeinfo.typeId) {
                        throw new Error(`can not declare shader input variable: attribute already declared with different type: "${prop}"`);
                    }
                    this.$_aliases[prop] = lastName;
                }
                return true;
            }
            if (!(value instanceof PBShaderExp) || !(value.$ast instanceof ASTShaderExpConstructor)) {
                throw new Error(`invalid shader input variable declaration: "${prop}"`);
            }
            const type = value.$ast.getType();
            if (!type.isPrimitiveType() || type.isMatrixType() || type.primitiveType === PBPrimitiveType.BOOL) {
                throw new Error(`type cannot be used as pipeline input/output: ${prop}`);
            }
            this.$_names[value.$attrib] = prop;
            const location = getCurrentProgramBuilder()._inputs.length;
            const exp = new PBShaderExp(`${input_prefix}${prop}`, type).tag(...value.$tags);
            getCurrentProgramBuilder().in(location, prop, exp);
            getCurrentProgramBuilder()._vertexAttributes.push(attrib);
            //getCurrentProgramBuilder().getReflection().setAttrib(value.$attrib, exp);
            // modify input struct for webgpu
            if (getCurrentProgramBuilder().getDevice().type === 'webgpu') {
                if (getCurrentProgramBuilder().findStructType(getBuiltinInputStructName(st), st)) {
                    getCurrentProgramBuilder().defineBuiltinStruct(st, 'in');
                }
            }
        }
        return true;
    }
}
/**
 * The output scope of a shader
 * @public
 */ class PBOutputScope extends PBScope {
    constructor(){
        super(null);
    }
    /** @internal */ $_getLocalScope() {
        return null;
    }
    /** @internal */ $set(prop, value) {
        if (prop[0] === '$' /* || prop in this*/ ) {
            this[prop] = value;
        } else {
            const pb = getCurrentProgramBuilder();
            if (!(prop in this)) {
                if (pb.getCurrentScope() === pb.getGlobalScope() && (!(value instanceof PBShaderExp) || !(value.$ast instanceof ASTShaderExpConstructor))) {
                    throw new Error(`invalid shader output variable declaration: ${prop}`);
                }
                const type = value.$ast.getType();
                if (!type.isPrimitiveType() || type.isMatrixType() || type.primitiveType === PBPrimitiveType.BOOL) {
                    throw new Error(`type cannot be used as pipeline input/output: ${prop}`);
                }
                const location = pb._outputs.length;
                pb.out(location, prop, new PBShaderExp(`${pb.shaderKind === 'vertex' ? output_prefix_vs : output_prefix_fs}${prop}`, type).tag(...value.$tags));
                // modify output struct for webgpu
                if (getCurrentProgramBuilder().getDevice().type === 'webgpu') {
                    const st = getCurrentProgramBuilder().shaderType;
                    if (getCurrentProgramBuilder().findStructType(getBuiltinInputStructName(st), st)) {
                        getCurrentProgramBuilder().defineBuiltinStruct(st, 'out');
                    }
                }
            }
            if (getCurrentProgramBuilder().getCurrentScope() !== getCurrentProgramBuilder().getGlobalScope()) {
                const ast = value.$ast;
                if (!(ast instanceof ASTShaderExpConstructor) || ast.args.length > 0) {
                    this[prop] = value;
                }
            }
        }
        return true;
    }
}
/**
 * The global scope of a shader
 * @public
 */ class PBGlobalScope extends PBScope {
    /** @internal */ $_inputStructInfo;
    /** @internal */ constructor(){
        super(new ASTGlobalScope());
        this.$_inputStructInfo = null;
    }
    /** @internal */ get $inputStructInfo() {
        if (!this.$_inputStructInfo) {
            this.$_inputStructInfo = this.$builder.defineBuiltinStruct(this.$builder.shaderType, 'in');
        }
        return this.$_inputStructInfo;
    }
    /** @internal */ get $inputStruct() {
        return this.$inputStructInfo[0];
    }
    /** @internal */ $mainFunc(body) {
        const pb = getCurrentProgramBuilder();
        if (pb.getDevice().type === 'webgpu') {
            const inputStruct = this.$inputStructInfo;
            //this.$local(inputStruct[1]);
            const isCompute = pb.shaderType === ShaderType.Compute;
            const outputStruct = isCompute ? null : pb.defineBuiltinStruct(pb.shaderType, 'out');
            if (outputStruct) {
                this.$local(outputStruct[1]);
            }
            // this.$internalCreateFunction('chMainStub', [], false, body);
            this.$internalCreateFunction('main', inputStruct ? [
                inputStruct[3]
            ] : [], true, function() {
                /*
          if (inputStruct) {
            this[inputStruct[1].$str] = this[inputStruct[3].$str];
          }
          */ if (pb.shaderType === ShaderType.Fragment && pb.emulateDepthClamp) {
                    this.$builtins.fragDepth = pb.clamp(this.$inputs.clamppedDepth, 0, 1);
                }
                body?.call(this);
                //this.chMainStub();
                if (pb.shaderType === ShaderType.Vertex) {
                    if (pb.depthRangeCorrection) {
                        this.$builtins.position.z = pb.mul(pb.add(this.$builtins.position.z, this.$builtins.position.w), 0.5);
                    }
                    if (pb.emulateDepthClamp) {
                        //z = gl_Position.z / gl_Position.w;
                        //z = (gl_DepthRange.diff * z + gl_DepthRange.near + gl_DepthRange.far) * 0.5;
                        this.$outputs.clamppedDepth = pb.div(this.$builtins.position.z, this.$builtins.position.w);
                        this.$builtins.position.z = 0;
                    }
                }
                if (!isCompute) {
                    this.$return(outputStruct[1]);
                }
            });
        } else {
            this.$internalCreateFunction('main', [], true, function() {
                if (pb.shaderType === ShaderType.Fragment && pb.emulateDepthClamp) {
                    this.$builtins.fragDepth = pb.clamp(this.$inputs.clamppedDepth, 0, 1);
                }
                body?.call(this);
                if (pb.shaderType === ShaderType.Vertex && pb.emulateDepthClamp) {
                    this.$outputs.clamppedDepth = pb.div(pb.add(pb.div(this.$builtins.position.z, this.$builtins.position.w), 1), 2);
                    this.$builtins.position.z = 0;
                }
            });
        }
    }
    /** @internal */ $createFunctionIfNotExists(name, params, body) {
        {
            this.$internalCreateFunction(name, params, false, body);
        }
    }
    /** @internal */ $getFunctions(name) {
        return this.$ast.findFunctions(name);
    }
    /** @internal */ $getCurrentFunctionScope() {
        let scope = getCurrentProgramBuilder().getCurrentScope();
        while(scope && !(scope instanceof PBFunctionScope)){
            scope = scope.$parent;
        }
        return scope;
    }
    /** @internal */ $internalCreateFunction(name, params, isMain, body) {
        const pb = getCurrentProgramBuilder();
        if (pb.getDevice().type === 'webgpu' && !isMain) {
            params.push(this.$inputStruct(getBuiltinParamName(pb.shaderType)));
        }
        params.forEach((param)=>{
            if (!(param.$ast instanceof ASTPrimitive)) {
                throw new Error(`${name}(): invalid function definition`);
            }
            let ast = param.$ast;
            if (param.$inout) {
                if (getCurrentProgramBuilder().getDevice().type === 'webgpu') {
                    param.$typeinfo = new PBPointerTypeInfo(param.$typeinfo, PBAddressSpace.UNKNOWN);
                }
                ast = new ASTReferenceOf(param.$ast);
            }
            param.$ast = new ASTFunctionParameter(ast);
        });
        const overloads = this.$getFunctions(name);
        const currentFunctionScope = this.$getCurrentFunctionScope();
        const astFunc = new ASTFunction(name, params.map((val)=>val.$ast), isMain, null, false);
        if (currentFunctionScope) {
            const curIndex = this.$ast.statements.indexOf(currentFunctionScope.$ast);
            if (curIndex < 0) {
                throw new Error('Internal error');
            }
            this.$ast.statements.splice(curIndex, 0, astFunc);
        } else {
            this.$ast.statements.push(astFunc);
        }
        new PBFunctionScope(this, params, astFunc, body);
        if (!astFunc.returnType) {
            astFunc.returnType = typeVoid;
        }
        astFunc.funcType = new PBFunctionTypeInfo(astFunc.name, astFunc.returnType, params.map((param)=>{
            const ast = param.$ast;
            return ast.paramAST instanceof ASTReferenceOf ? {
                type: ast.paramAST.value.getType(),
                byRef: ast.paramAST instanceof ASTReferenceOf
            } : {
                type: ast.paramAST.getType(),
                byRef: false
            };
        }));
        for (const overload of overloads){
            if (overload.funcType.argHash === astFunc.funcType.argHash) {
                if (overload.returnType.isCompatibleType(astFunc.returnType)) {
                    // Function signature already exists
                    // console.warn(`Function '${name}' already exists`);
                    this.$ast.statements.splice(this.$ast.statements.indexOf(astFunc), 1);
                    return;
                } else {
                    throw new Error(`Invalid function overloading: ${name}`);
                }
            }
        }
        if (overloads.length === 0) {
            Object.defineProperty(this, name, {
                get: function() {
                    const func = this.$getFunctions(name);
                    if (func.length === 0) {
                        throw new Error(`function ${name} not found`);
                    }
                    return (...args)=>{
                        let inputArg = null;
                        if (pb.getDevice().type === 'webgpu') {
                            let funcScope = pb.getCurrentScope();
                            while(funcScope && !(funcScope instanceof PBFunctionScope)){
                                funcScope = funcScope.$parent;
                            }
                            const funcArgs = funcScope.$ast.args;
                            const arg = funcArgs[funcArgs.length - 1].paramAST;
                            const name = arg.name;
                            inputArg = funcScope[name];
                        }
                        const argsNonArray = (inputArg ? [
                            ...args,
                            inputArg
                        ] : args).map((val)=>pb.normalizeExpValue(val));
                        const funcType = pb._getFunctionOverload(name, argsNonArray);
                        if (!funcType) {
                            throw new Error(`ERROR: no matching overloads for function ${name}`);
                        }
                        return getCurrentProgramBuilder().$callFunction(name, funcType[1], funcType[0]);
                    };
                }
            });
        }
    }
}
/**
 * Scope that is inside a function
 * @public
 */ class PBInsideFunctionScope extends PBScope {
    /** @internal */ constructor(parent){
        super(new ASTScope(), parent);
    }
    /**
   * Creates a 'return' statement
   * @param retval - The return value
   */ $return(retval) {
        const functionScope = this.findOwnerFunction();
        const astFunc = functionScope.$ast;
        let returnType = null;
        const retValNonArray = getCurrentProgramBuilder().normalizeExpValue(retval);
        if (retValNonArray !== undefined && retValNonArray !== null) {
            if (typeof retValNonArray === 'number') {
                if (astFunc.returnType) {
                    if (astFunc.returnType.isPrimitiveType() && astFunc.returnType.isScalarType() && !astFunc.returnType.isCompatibleType(typeBool)) {
                        returnType = astFunc.returnType;
                    }
                }
                if (!returnType) {
                    if (Number.isInteger(retValNonArray)) {
                        if (retValNonArray < 0) {
                            if (retValNonArray < 0x80000000 >> 0) {
                                throw new Error(`function ${astFunc.name}: invalid return value: ${retValNonArray}`);
                            }
                            returnType = typeI32;
                        } else {
                            if (retValNonArray > 0xffffffff) {
                                throw new Error(`function ${astFunc.name}: invalid return value: ${retValNonArray}`);
                            }
                            returnType = retValNonArray <= 0x7fffffff ? typeI32 : typeU32$1;
                        }
                    } else {
                        returnType = typeF32;
                    }
                }
            } else if (typeof retValNonArray === 'boolean') {
                returnType = typeBool;
            } else {
                returnType = retValNonArray.$ast.getType();
            }
        } else {
            returnType = typeVoid;
        }
        if (returnType.isPointerType()) {
            throw new Error('function can not return pointer type');
        }
        if (!astFunc.returnType) {
            astFunc.returnType = returnType;
        } else if (!astFunc.returnType.isCompatibleType(returnType)) {
            throw new Error(`function ${astFunc.name}: return type must be ${astFunc.returnType?.toTypeName(getCurrentProgramBuilder().getDevice().type) || 'void'}`);
        }
        let returnValue = null;
        if (retValNonArray !== undefined && retValNonArray !== null) {
            if (retValNonArray instanceof PBShaderExp) {
                returnValue = retValNonArray.$ast;
            } else {
                if (!returnType.isPrimitiveType() || !returnType.isScalarType()) {
                    throw new PBTypeCastError(retValNonArray, typeof retValNonArray, returnType);
                }
                returnValue = new ASTScalar(retValNonArray, returnType);
            }
        }
        this.$ast.statements.push(new ASTReturn(returnValue));
    }
    /**
   * Creates a new scope
   * @param body - Generator function for the scope
   * @returns The created scope
   */ $scope(body) {
        const astScope = new ASTNakedScope();
        this.$ast.statements.push(astScope);
        return new PBNakedScope(this, astScope, body);
    }
    /**
   * Creates an 'if' statement
   * @param condition - Condition expression for the if statement
   * @param body - Generator function for the scope inside the if statement
   * @returns The scope inside the if statement
   */ $if(condition, body) {
        const astIf = new ASTIf('if', condition instanceof PBShaderExp ? condition.$ast : new ASTScalar(condition, typeof condition === 'number' ? typeF32 : typeBool));
        this.$ast.statements.push(astIf);
        return new PBIfScope(this, astIf, body);
    }
    /**
   * Creates a select statement: condition ? first : second
   * @param condition - Condition expression
   * @param first - The first value
   * @param second - The second value
   * @returns The first value if condition evaluates to true, otherwise returns the second value
   */ $choice(condition, first, second) {
        const ast = new ASTSelect(condition instanceof PBShaderExp ? condition.$ast : condition, first instanceof PBShaderExp ? first.$ast : first, second instanceof PBShaderExp ? second.$ast : second);
        const exp = new PBShaderExp('', ast.getType());
        exp.$ast = ast;
        return exp;
    }
    /** Creates a 'break' statement */ $break() {
        this.$ast.statements.push(new ASTBreak());
    }
    /** Creates a 'continue' statement */ $continue() {
        this.$ast.statements.push(new ASTContinue());
    }
    /**
   * Creates a 'for' statement
   * @param counter - The repeat counter variable declaration
   * @param init - initial value of the repeat counter variable
   * @param end - end value of the counter exclusive
   * @param body - Generator function for the scope that inside the for statement
   */ $for(counter, init, end, body) {
        const initializerType = counter.$ast.getType();
        if (!initializerType.isPrimitiveType() || !initializerType.isScalarType()) {
            throw new PBASTError(counter.$ast, 'invalid for range initializer type');
        }
        const initval = init instanceof PBShaderExp ? init.$ast : new ASTScalar(init, initializerType);
        const astFor = new ASTRange(counter.$ast, initval, end instanceof PBShaderExp ? end.$ast : new ASTScalar(end, initializerType), true);
        this.$ast.statements.push(astFor);
        new PBForScope(this, counter, end, astFor, body);
    }
    /**
   * Creates a 'do..while' statement
   * @param body - Generator function for the scope that inside the do..while statment
   * @returns The scope that inside the do..while statement
   */ $do(body) {
        if (this.$builder.getDevice().type === 'webgl') {
            throw new Error(`No do-while() loop support for WebGL1.0 device`);
        }
        const astDoWhile = new ASTDoWhile(null);
        this.$ast.statements.push(astDoWhile);
        return new PBDoWhileScope(this, astDoWhile, body);
    }
    /**
   * Creates a 'while' statement
   * @param condition - Condition expression for the while statement
   * @param body - Generator function for the scope that inside the while statement
   */ $while(condition, body) {
        const astWhile = new ASTWhile(condition instanceof PBShaderExp ? condition.$ast : new ASTScalar(condition, typeof condition === 'number' ? typeF32 : typeBool));
        this.$ast.statements.push(astWhile);
        new PBWhileScope(this, astWhile, body);
    }
    /** @internal */ findOwnerFunction() {
        for(let scope = this; scope; scope = scope.$parent){
            if (scope instanceof PBFunctionScope) {
                return scope;
            }
        }
        return null;
    }
}
/**
 * Scope that insides a function
 * @public
 */ class PBFunctionScope extends PBInsideFunctionScope {
    /** @internal */ $typeinfo;
    /** @internal */ constructor(parent, params, ast, body){
        super(parent);
        this.$ast = ast;
        for (const param of params){
            if (this.$_variables[param.$str]) {
                throw new Error('Duplicate function parameter name is not allowed');
            }
            this.$_registerVar(param);
        }
        getCurrentProgramBuilder().pushScope(this);
        body && body.call(this);
        getCurrentProgramBuilder().popScope();
    }
    $isMain() {
        return this.$ast.isMainFunc;
    }
}
/**
 * Scope that insides a while statement
 * @public
 */ class PBWhileScope extends PBInsideFunctionScope {
    /** @internal */ constructor(parent, ast, body){
        super(parent);
        this.$ast = ast;
        getCurrentProgramBuilder().pushScope(this);
        body && body.call(this);
        getCurrentProgramBuilder().popScope();
    }
}
/**
 * Scope that insides a do..while statement
 * @public
 */ class PBDoWhileScope extends PBInsideFunctionScope {
    /** @internal */ constructor(parent, ast, body){
        super(parent);
        this.$ast = ast;
        getCurrentProgramBuilder().pushScope(this);
        body && body.call(this);
        getCurrentProgramBuilder().popScope();
    }
    $while(condition) {
        this.$ast.condition = condition instanceof PBShaderExp ? condition.$ast : new ASTScalar(condition, typeof condition === 'number' ? typeF32 : typeBool);
    }
}
/**
 * Scope that insides a for statement
 * @public
 */ class PBForScope extends PBInsideFunctionScope {
    /** @internal */ constructor(parent, counter, count, ast, body){
        super(parent);
        this.$ast = ast;
        this.$_registerVar(counter);
        getCurrentProgramBuilder().pushScope(this);
        body && body.call(this);
        getCurrentProgramBuilder().popScope();
    }
}
/**
 * A naked scope
 * @public
 */ class PBNakedScope extends PBInsideFunctionScope {
    /** @internal */ constructor(parent, ast, body){
        super(parent);
        this.$ast = ast;
        getCurrentProgramBuilder().pushScope(this);
        body && body.call(this);
        getCurrentProgramBuilder().popScope();
    }
}
/**
 * Scope that insides an if statement
 * @public
 */ class PBIfScope extends PBInsideFunctionScope {
    /** @internal */ constructor(parent, ast, body){
        super(parent);
        this.$ast = ast;
        getCurrentProgramBuilder().pushScope(this);
        body && body.call(this);
        getCurrentProgramBuilder().popScope();
    }
    /**
   * Creates an 'else if' branch
   * @param condition - Condition expression for the else if branch
   * @param body - Generator function for the scope that insides the else if statement
   * @returns The scope that insides the else if statement
   */ $elseif(condition, body) {
        const astElseIf = new ASTIf('else if', condition instanceof PBShaderExp ? condition.$ast : new ASTScalar(condition, typeof condition === 'number' ? typeF32 : typeBool));
        this.$ast.nextElse = astElseIf;
        return new PBIfScope(this.$_parentScope, astElseIf, body);
    }
    /**
   * Creates an 'else' branch
   * @param body - Generator function for the scope that insides the else statement
   */ $else(body) {
        const astElse = new ASTIf('else', null);
        this.$ast.nextElse = astElse;
        new PBIfScope(this.$_parentScope, astElse, body);
    }
}
setBuiltinFuncs(ProgramBuilder);
setConstructors(ProgramBuilder);

/** @internal */ class FontCanvas {
    static _canvas = null;
    static _context = null;
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
    static set font(font) {
        this.context.font = font;
    }
    static _realize() {
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
 */ class Font {
    /** @internal */ static fontCache = {};
    /** @internal */ _name;
    /** @internal */ _nameScaled;
    /** @internal */ _scale;
    /** @internal */ _size;
    /** @internal */ _family;
    /** @internal */ _top;
    /** @internal */ _bottom;
    /** @internal */ _topScaled;
    /** @internal */ _bottomScaled;
    /** @internal */ _div;
    /**
   * Creates a instance of font class from font name and the scale value
   * @param name - The font name
   * @param scale - The scale value
   */ constructor(name, scale){
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
   */ static fetchFont(name, scale) {
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
    /** Gets the font name */ get fontName() {
        return this._name;
    }
    set fontName(name) {
        this._name = name;
        this._normalizeFont();
    }
    /** Gets the scaled font name */ get fontNameScaled() {
        return this._nameScaled;
    }
    /** Gets the font size */ get size() {
        return this._size;
    }
    /** Gets the font family */ get family() {
        return this._family;
    }
    /** Gets top position of the font */ get top() {
        return this._top;
    }
    /** Gets the bottom position of the font */ get bottom() {
        return this._bottom;
    }
    /** Gets the scaled top position of the font */ get topScaled() {
        return this._topScaled;
    }
    /** Gets the scaled bottom position of the font */ get bottomScaled() {
        return this._bottomScaled;
    }
    /** Gets the maximum height of the font */ get maxHeight() {
        return this._bottom - this._top + 1;
    }
    /** Gets the scaled maximum height of the font */ get maxHeightScaled() {
        return this._bottomScaled - this._topScaled + 1;
    }
    /** Tests if two fonts are the same */ equalTo(other) {
        return this._size === other._size && this._family === other._family;
    }
    /** @internal */ _measureFontHeight(fontName) {
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
        let top, bottom;
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
        for(let i = 0; i < maxWidth * maxHeight; i++){
            if (pixels[i * 4 + 3] > 0) {
                top = Math.floor(i / maxWidth);
                break;
            }
        }
        for(let i = maxWidth * maxHeight - 1; i >= 0; i--){
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
        return {
            size,
            family,
            top,
            bottom
        };
    }
    /** @internal */ _normalizeFont() {
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

/**
 * Texture atlas manager
 * @public
 */ class TextureAtlasManager {
    /** @internal */ static ATLAS_WIDTH = 1024;
    /** @internal */ static ATLAS_HEIGHT = 1024;
    /** @internal */ _packer;
    /** @internal */ _device;
    /** @internal */ _binWidth;
    /** @internal */ _binHeight;
    /** @internal */ _rectBorderWidth;
    /** @internal */ _linearSpace;
    /** @internal */ _atlasList;
    /** @internal */ _atlasInfoMap;
    /** @internal */ _atlasRestoreHandler;
    /**
   * Creates a new texture atlas manager instance
   * @param device - The render device
   * @param binWidth - Width of an atlas bin
   * @param binHeight - Height of an atlas bin
   * @param rectBorderWidth - Border width of an atlas
   * @param linearSpace - true if the texture space is linear
   */ constructor(device, binWidth, binHeight, rectBorderWidth, linearSpace){
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
   */ get atlasTextureRestoreHandler() {
        return this._atlasRestoreHandler;
    }
    set atlasTextureRestoreHandler(f) {
        this._atlasRestoreHandler = f;
    }
    /**
   * Gets the atlas texture of a given index
   * @param index - Index of the atlas bin
   * @returns Atlas texture for given index
   */ getAtlasTexture(index) {
        return this._atlasList[index];
    }
    /**
   * Gets the information about specified atlas
   * @param key - Key of the atlas
   * @returns Information of the atlas
   */ getAtlasInfo(key) {
        return this._atlasInfoMap[key] || null;
    }
    /**
   * Check if no atlas has been created
   * @returns true if no atlas has been created
   */ isEmpty() {
        return this._atlasList.length === 0;
    }
    /**
   * Removes all created atlases
   */ clear() {
        this._packer.clear();
        for (const tex of this._atlasList){
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
   */ pushCanvas(key, ctx, x, y, w, h) {
        const rc = this._packer.insert(w + 2 * this._rectBorderWidth, h + 2 * this._rectBorderWidth);
        if (rc) {
            const atlasX = rc.x + this._rectBorderWidth;
            const atlasY = rc.y + this._rectBorderWidth;
            this._updateAtlasTextureCanvas(rc.binIndex, ctx, atlasX, atlasY, w, h, x, y);
            const info = {
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
   */ pushBitmap(key, bitmap) {
        const rc = this._packer.insert(bitmap.width + 2 * this._rectBorderWidth, bitmap.height + 2 * this._rectBorderWidth);
        if (rc) {
            const atlasX = rc.x + this._rectBorderWidth;
            const atlasY = rc.y + this._rectBorderWidth;
            this._updateAtlasTexture(rc.binIndex, bitmap, atlasX, atlasY);
            const info = {
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
    /** @internal */ _createAtlasTexture() {
        const tex = this._device.createTexture2D('rgba8unorm', this._binWidth, this._binHeight, {
            samplerOptions: {
                mipFilter: 'none'
            }
        });
        tex.update(new Uint8Array(tex.width * tex.height * 4), 0, 0, tex.width, tex.height);
        tex.restoreHandler = async ()=>{
            tex.update(new Uint8Array(tex.width * tex.height * 4), 0, 0, tex.width, tex.height);
            this._atlasRestoreHandler && await this._atlasRestoreHandler(tex);
        };
        return tex;
    }
    /** @internal */ _updateAtlasTextureCanvas(atlasIndex, ctx, x, y, w, h, xOffset, yOffset) {
        let textureAtlas = null;
        if (atlasIndex === this._atlasList.length) {
            textureAtlas = this._createAtlasTexture();
            this._atlasList.push(textureAtlas);
        } else {
            textureAtlas = this._atlasList[atlasIndex];
        }
        textureAtlas.updateFromElement(ctx.canvas, x, y, xOffset, yOffset, w, h);
    }
    /** @internal */ _updateAtlasTexture(atlasIndex, bitmap, x, y) {
        let textureAtlas = null;
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

/**
 * Manager of texture glyphs
 * @public
 */ class GlyphManager extends TextureAtlasManager {
    /**
   * Creates a new glyph manager instance
   * @param device - The render device
   * @param binWidth - Width of an atlas bin
   * @param binHeight - Height of an atlas bin
   * @param border - Border width of an atlas
   */ constructor(device, binWidth, binHeight, border){
        super(device, binWidth, binHeight, border, true);
        this.atlasTextureRestoreHandler = async ()=>{
            if (!this.isEmpty()) {
                this.clear();
            }
        };
    }
    /**
   * Gets the atlas information for given character
   * @param char - The character
   * @param font - Font of the character
   * @returns Atlas information for the glyph
   */ getGlyphInfo(char, font) {
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
   */ measureStringWidth(str, charMargin, font) {
        let w = 0;
        for (const ch of str){
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
   */ clipStringToWidth(str, width, charMargin, start, font) {
        let sum = 0;
        let i = start;
        for(; i < str.length; i++){
            sum += charMargin + this.getCharWidth(str[i], font);
            if (sum > width) {
                break;
            }
        }
        return i - start;
    }
    /** @internal */ _hash(char, font) {
        return `${font.family}@${font.size}&${char}`;
    }
    /** @internal */ _cacheGlyph(char, font) {
        const bitmap = this._getGlyphBitmap(char, font);
        return this.pushBitmap(this._hash(char, font), bitmap);
    }
    /**
   * Measuring width of a character
   * @param char - The character to be measured
   * @param font - Font of the character
   * @returns Width of the character
   */ getCharWidth(char, font) {
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
    /** @internal */ _getGlyphBitmap(char, font) {
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
}

const MAX_GLYPH_COUNT = 1024;
/**
 * Helper class to draw some text onto the screen
 * @public
 */ class DrawText {
    /** @internal */ static GLYPH_COUNT = MAX_GLYPH_COUNT;
    /** @internal */ static glyphManager = null;
    /** @internal */ static prepared = false;
    /** @internal */ static textVertexBuffer = null;
    /** @internal */ static textVertexLayout = null;
    /** @internal */ static textProgram = null;
    /** @internal */ static textBindGroup = null;
    /** @internal */ static textRenderStates = null;
    /** @internal */ static textOffset = 0;
    /** @internal */ static textMatrix = new Matrix4x4();
    /** @internal */ static font = null;
    /** @internal */ static vertexCache = null;
    /** @internal */ static colorValue = new Vector4();
    /** @internal */ static calculateTextMatrix(device, matrix) {
        const viewport = device.getViewport();
        const projectionMatrix = Matrix4x4.ortho(0, viewport.width, 0, viewport.height, 1, 100);
        const flipMatrix = Matrix4x4.translation(new Vector3(0, viewport.height, 0)).scaleRight(new Vector3(1, -1, 1));
        Matrix4x4.multiply(projectionMatrix, flipMatrix, matrix);
    }
    /**
   * Set the font that will be used to draw strings
   * @param device - The render device
   * @param name - The font name
   */ static setFont(device, name) {
        this.font = Font.fetchFont(name, device.getScale()) || Font.fetchFont('12px arial', device.getScale());
    }
    /**
   * Draw text onto the screen
   * @param device - The render device
   * @param text - The text to be drawn
   * @param color - The text color
   * @param x - X coordinate of the text
   * @param y - Y coordinate of the text
   */ static drawText(device, text, color, x, y) {
        if (text.length > 0) {
            device.pushDeviceStates();
            this.prepareDrawText(device);
            this.calculateTextMatrix(device, this.textMatrix);
            const colorValue = parseColor(color);
            this.colorValue.x = colorValue.r;
            this.colorValue.y = colorValue.g;
            this.colorValue.z = colorValue.b;
            this.colorValue.w = colorValue.a;
            this.textBindGroup.setValue('flip', device.type === 'webgpu' && device.getFramebuffer() ? 1 : 0);
            this.textBindGroup.setValue('srgbOut', device.getFramebuffer() ? 0 : 1);
            this.textBindGroup.setValue('textMatrix', this.textMatrix);
            this.textBindGroup.setValue('textColor', this.colorValue);
            device.setProgram(this.textProgram);
            device.setVertexLayout(this.textVertexLayout);
            device.setRenderStates(this.textRenderStates);
            device.setBindGroup(0, this.textBindGroup);
            let drawn = 0;
            const total = text.length;
            while(drawn < total){
                const count = Math.min(total - drawn, this.GLYPH_COUNT - this.textOffset);
                if (count > 0) {
                    x = this.drawTextNoOverflow(device, text, drawn, count, x, y);
                    drawn += count;
                    this.textOffset += count;
                }
                if (this.GLYPH_COUNT === this.textOffset) {
                    this.textOffset = 0;
                    device.flush();
                }
            }
            device.popDeviceStates();
        }
    }
    /** @internal */ static drawTextNoOverflow(device, text, start, count, x, y) {
        let drawn = 0;
        let atlasIndex = -1;
        let i = 0;
        for(; i < count; i++){
            const glyph = this.glyphManager.getGlyphInfo(text[i + start], this.font) || this.glyphManager.getGlyphInfo('?', this.font);
            if (atlasIndex >= 0 && glyph.atlasIndex !== atlasIndex) {
                this.textVertexBuffer.bufferSubData((this.textOffset + drawn) * 16 * 4, this.vertexCache, (this.textOffset + drawn) * 16, (i - drawn) * 16);
                this.textBindGroup.setTexture('tex', this.glyphManager.getAtlasTexture(atlasIndex));
                device.draw('triangle-list', (this.textOffset + drawn) * 6, (i - drawn) * 6);
                drawn = i;
            }
            atlasIndex = glyph.atlasIndex;
            const base = (this.textOffset + i) * 16;
            this.vertexCache[base + 0] = x;
            this.vertexCache[base + 1] = y;
            this.vertexCache[base + 2] = glyph.uMin;
            this.vertexCache[base + 3] = glyph.vMin;
            this.vertexCache[base + 4] = x + glyph.width;
            this.vertexCache[base + 5] = y;
            this.vertexCache[base + 6] = glyph.uMax;
            this.vertexCache[base + 7] = glyph.vMin;
            this.vertexCache[base + 8] = x + glyph.width;
            this.vertexCache[base + 9] = y + glyph.height;
            this.vertexCache[base + 10] = glyph.uMax;
            this.vertexCache[base + 11] = glyph.vMax;
            this.vertexCache[base + 12] = x;
            this.vertexCache[base + 13] = y + glyph.height;
            this.vertexCache[base + 14] = glyph.uMin;
            this.vertexCache[base + 15] = glyph.vMax;
            x += glyph.width;
        }
        this.textVertexBuffer.bufferSubData((this.textOffset + drawn) * 16 * 4, this.vertexCache, (this.textOffset + drawn) * 16, (i - drawn) * 16);
        this.textBindGroup.setTexture('tex', this.glyphManager.getAtlasTexture(atlasIndex));
        device.draw('triangle-list', (this.textOffset + drawn) * 6, (i - drawn) * 6);
        return x;
    }
    /** @internal */ static prepareDrawText(device) {
        if (!this.prepared) {
            this.prepared = true;
            this.font = this.font || Font.fetchFont('16px arial', device.getScale());
            this.glyphManager = new GlyphManager(device, 1024, 1024, 1);
            this.vertexCache = new Float32Array(this.GLYPH_COUNT * 16);
            this.textVertexBuffer = device.createInterleavedVertexBuffer([
                'position_f32x2',
                'tex0_f32x2'
            ], this.vertexCache, {
                dynamic: true
            });
            const indices = new Uint16Array(this.GLYPH_COUNT * 6);
            for(let i = 0; i < this.GLYPH_COUNT; i++){
                const base = i * 4;
                indices[i * 6 + 0] = base + 0;
                indices[i * 6 + 1] = base + 1;
                indices[i * 6 + 2] = base + 2;
                indices[i * 6 + 3] = base + 0;
                indices[i * 6 + 4] = base + 2;
                indices[i * 6 + 5] = base + 3;
            }
            const textIndexBuffer = device.createIndexBuffer(indices);
            this.textVertexLayout = device.createVertexLayout({
                vertexBuffers: [
                    {
                        buffer: this.textVertexBuffer
                    }
                ],
                indexBuffer: textIndexBuffer
            });
            this.textOffset = 0;
            this.textProgram = device.buildRenderProgram({
                vertex (pb) {
                    this.$inputs.pos = pb.vec2().attrib('position');
                    this.$inputs.uv = pb.vec2().attrib('texCoord0');
                    this.$outputs.uv = pb.vec2();
                    this.flip = pb.int(0).uniform(0);
                    this.textMatrix = pb.mat4().uniform(0);
                    pb.main(function() {
                        this.$builtins.position = pb.mul(this.textMatrix, pb.vec4(this.$inputs.pos, -50, 1));
                        this.$if(pb.notEqual(this.flip, 0), function() {
                            this.$builtins.position.y = pb.neg(this.$builtins.position.y);
                        });
                        this.$outputs.uv = this.$inputs.uv;
                    });
                },
                fragment (pb) {
                    this.$outputs.color = pb.vec4();
                    this.textColor = pb.vec4().uniform(0);
                    this.tex = pb.tex2D().uniform(0);
                    this.srgbOut = pb.int().uniform(0);
                    pb.main(function() {
                        this.alpha = pb.mul(pb.textureSample(this.tex, this.$inputs.uv).a, this.textColor.a);
                        this.$if(pb.notEqual(this.srgbOut, 0), function() {
                            this.$outputs.color = pb.vec4(pb.mul(pb.pow(this.textColor.rgb, pb.vec3(1 / 2.2)), this.alpha), this.alpha);
                        }).$else(function() {
                            this.$outputs.color = pb.vec4(pb.mul(this.textColor.rgb, this.alpha), this.alpha);
                        });
                    });
                }
            });
            this.textBindGroup = device.createBindGroup(this.textProgram.bindGroupLayouts[0]);
            this.textRenderStates = device.createRenderStateSet();
            this.textRenderStates.useBlendingState().enable(true).setBlendFuncRGB('one', 'inv-src-alpha').setBlendFuncAlpha('zero', 'one');
            this.textRenderStates.useDepthState().enableTest(false).enableWrite(false);
            this.textRenderStates.useRasterizerState().setCullMode('none');
        }
    }
}

/**
 * Base class for rendering device
 * @public
 */ class BaseDevice {
    _canvas;
    _canvasClientWidth;
    _canvasClientHeight;
    _gpuObjectList;
    _gpuMemCost;
    _disposeObjectList;
    _beginFrameTime;
    _endFrameTime;
    _frameInfo;
    _cpuTimer;
    _gpuTimer;
    _runningLoop;
    _fpsCounter;
    _runLoopFunc;
    _backend;
    _beginFrameCounter;
    _programBuilder;
    _stateStack;
    constructor(cvs, backend){
        this._backend = backend;
        this._gpuObjectList = {
            textures: [],
            samplers: [],
            buffers: [],
            programs: [],
            framebuffers: [],
            vertexArrayObjects: [],
            bindGroups: []
        };
        this._canvas = cvs;
        this._canvas.setAttribute('tabindex', '1');
        this._canvasClientWidth = cvs.clientWidth;
        this._canvasClientHeight = cvs.clientHeight;
        this._gpuMemCost = 0;
        this._disposeObjectList = [];
        this._beginFrameTime = 0;
        this._endFrameTime = 0;
        this._runLoopFunc = null;
        this._frameInfo = {
            frameCounter: 0,
            frameTimestamp: 0,
            elapsedTimeCPU: 0,
            elapsedTimeGPU: 0,
            elapsedFrame: 0,
            elapsedOverall: 0,
            FPS: 0,
            drawCalls: 0,
            computeCalls: 0,
            nextFrameCall: [],
            nextFrameCallNext: []
        };
        this._programBuilder = new ProgramBuilder(this);
        this._cpuTimer = new CPUTimer();
        this._gpuTimer = null;
        this._runningLoop = null;
        this._fpsCounter = {
            time: 0,
            frame: 0
        };
        this._stateStack = [];
        this._beginFrameCounter = 0;
        this._registerEventHandlers();
    }
    get backend() {
        return this._backend;
    }
    get videoMemoryUsage() {
        return this._gpuMemCost;
    }
    get frameInfo() {
        return this._frameInfo;
    }
    get isRendering() {
        return this._runningLoop !== null;
    }
    get canvas() {
        return this._canvas;
    }
    get type() {
        return this._backend.typeName();
    }
    get runLoopFunction() {
        return this._runLoopFunc;
    }
    get programBuilder() {
        return this._programBuilder;
    }
    setFont(fontName) {
        DrawText.setFont(this, fontName);
    }
    drawText(text, x, y, color) {
        DrawText.drawText(this, text, color, x, y);
    }
    disposeObject(obj, remove = true) {
        if (obj) {
            if (remove) {
                this.removeGPUObject(obj);
            }
            if (!obj.disposed) {
                if (this.isContextLost()) {
                    obj.destroy();
                } else {
                    this._disposeObjectList.push(obj);
                }
            }
            obj.dispatchEvent(null, 'disposed');
        }
    }
    async restoreObject(obj) {
        if (obj && obj.disposed && !this.isContextLost()) {
            await obj.restore();
            if (obj.restoreHandler) {
                await obj.restoreHandler(obj);
            }
        }
    }
    enableGPUTimeRecording(enable) {
        if (enable && !this._gpuTimer) {
            this._gpuTimer = this.createGPUTimer();
        } else if (!enable) {
            this._gpuTimer?.end();
            this._gpuTimer = null;
        }
    }
    beginFrame() {
        if (this._beginFrameCounter === 0) {
            for (const obj of this._disposeObjectList){
                obj.destroy();
            }
            this._disposeObjectList = [];
        }
        this._beginFrameCounter++;
        this._beginFrameTime = this._cpuTimer.now();
        this.updateFrameInfo();
        return this.onBeginFrame();
    }
    endFrame() {
        if (this._beginFrameCounter > 0) {
            this._beginFrameCounter--;
            if (this._beginFrameCounter === 0) {
                this._endFrameTime = this._cpuTimer.now();
                this.onEndFrame();
            }
        }
    }
    getVertexAttribFormat(semantic, dataType, componentCount) {
        return getVertexAttribFormat(semantic, dataType, componentCount);
    }
    createInterleavedVertexBuffer(attribFormats, data, options) {
        if (options && options.usage && options.usage !== 'vertex') {
            console.error(`createVertexBuffer() failed: options.usage must be 'vertex' or not set`);
            return null;
        }
        let size = 0;
        for (const format of attribFormats){
            size += getVertexFormatSize(format);
        }
        const vertexBufferType = makeVertexBufferType(data.byteLength / size >> 0, ...attribFormats);
        const opt = Object.assign({
            usage: 'vertex',
            dynamic: false,
            managed: true,
            storage: false
        }, options || {});
        if (opt.storage) {
            opt.dynamic = false;
            opt.managed = false;
        }
        if (opt.dynamic) {
            opt.managed = false;
        }
        return this.createStructuredBuffer(vertexBufferType, opt, data);
    }
    createVertexBuffer(attribFormat, data, options) {
        if (options && options.usage && options.usage !== 'vertex') {
            console.error(`createVertexBuffer() failed: options.usage must be 'vertex' or not set`);
            return null;
        }
        const count = getVertexFormatSize(attribFormat);
        const vertexBufferType = makeVertexBufferType(data.byteLength / count >> 0, attribFormat);
        const opt = Object.assign({
            usage: 'vertex',
            dynamic: false,
            managed: true,
            storage: false
        }, options || {});
        if (opt.storage) {
            opt.dynamic = false;
            opt.managed = false;
        }
        if (opt.dynamic) {
            opt.managed = false;
        }
        return this.createStructuredBuffer(vertexBufferType, opt, data);
    }
    draw(primitiveType, first, count) {
        this._frameInfo.drawCalls++;
        this._draw(primitiveType, first, count);
    }
    drawInstanced(primitiveType, first, count, numInstances) {
        this._frameInfo.drawCalls++;
        this._drawInstanced(primitiveType, first, count, numInstances);
    }
    compute(workgroupCountX, workgroupCountY, workgroupCountZ) {
        this._frameInfo.computeCalls++;
        this._compute(workgroupCountX, workgroupCountY, workgroupCountZ);
    }
    runNextFrame(f) {
        if (f) {
            this._frameInfo.nextFrameCall.push(f);
        }
    }
    exitLoop() {
        if (this._runningLoop) {
            cancelAnimationFrame(this._runningLoop);
            this._runningLoop = null;
        }
    }
    runLoop(func) {
        if (this._runningLoop !== null) {
            console.error('Device.runLoop() can not be nested');
            return;
        }
        if (!func) {
            console.error('Device.runLoop() argment error');
            return;
        }
        const that = this;
        that._runLoopFunc = func;
        (function entry() {
            that._runningLoop = requestAnimationFrame(entry);
            if (that.beginFrame()) {
                that._runLoopFunc(that);
                that.endFrame();
            }
        })();
    }
    pushDeviceStates() {
        this._stateStack.push({
            windowOrderReversed: this.isWindingOrderReversed(),
            framebuffer: this.getFramebuffer(),
            viewport: this.getViewport(),
            scissor: this.getScissor(),
            program: this.getProgram(),
            renderStateSet: this.getRenderStates(),
            vertexLayout: this.getVertexLayout(),
            bindGroups: [
                this.getBindGroup(0),
                this.getBindGroup(1),
                this.getBindGroup(2),
                this.getBindGroup(3)
            ]
        });
    }
    popDeviceStates() {
        if (this._stateStack.length === 0) {
            console.error('Device.popDeviceStates(): stack is empty');
        } else {
            const top = this._stateStack.pop();
            this.setFramebuffer(top.framebuffer);
            this.setViewport(top.viewport);
            this.setScissor(top.scissor);
            this.setProgram(top.program);
            this.setRenderStates(top.renderStateSet);
            this.setVertexLayout(top.vertexLayout);
            this.setBindGroup(0, ...top.bindGroups[0]);
            this.setBindGroup(1, ...top.bindGroups[1]);
            this.setBindGroup(2, ...top.bindGroups[2]);
            this.setBindGroup(3, ...top.bindGroups[3]);
            this.reverseVertexWindingOrder(top.windowOrderReversed);
        }
    }
    getGPUObjects() {
        return this._gpuObjectList;
    }
    getGPUObjectById(uid) {
        for (const list of [
            this._gpuObjectList.textures,
            this._gpuObjectList.samplers,
            this._gpuObjectList.buffers,
            this._gpuObjectList.framebuffers,
            this._gpuObjectList.programs,
            this._gpuObjectList.vertexArrayObjects
        ]){
            for (const obj of list){
                if (obj.uid === uid) {
                    return obj;
                }
            }
        }
        return null;
    }
    screenToDevice(val) {
        return this.getFramebuffer() ? val : Math.round(val * this.getScale());
    }
    deviceToScreen(val) {
        return this.getFramebuffer() ? val : Math.round(val / this.getScale());
    }
    buildRenderProgram(options) {
        return this._programBuilder.buildRenderProgram(options);
    }
    buildComputeProgram(options) {
        return this._programBuilder.buildComputeProgram(options);
    }
    addGPUObject(obj) {
        const list = this.getGPUObjectList(obj);
        if (list && list.indexOf(obj) < 0) {
            list.push(obj);
            this.dispatchEvent(new DeviceGPUObjectAddedEvent(obj));
        }
    }
    removeGPUObject(obj) {
        const list = this.getGPUObjectList(obj);
        if (list) {
            const index = list.indexOf(obj);
            if (index >= 0) {
                list.splice(index, 1);
                this.dispatchEvent(new DeviceGPUObjectRemovedEvent(obj));
            }
        }
    }
    updateVideoMemoryCost(delta) {
        this._gpuMemCost += delta;
    }
    _onresize() {
        if (this._canvasClientWidth !== this._canvas.clientWidth || this._canvasClientHeight !== this._canvas.clientHeight) {
            this._canvasClientWidth = this._canvas.clientWidth;
            this._canvasClientHeight = this._canvas.clientHeight;
            this.dispatchEvent(new DeviceResizeEvent(this._canvasClientWidth, this._canvasClientHeight));
        }
    }
    _registerEventHandlers() {
        const canvas = this._canvas;
        const that = this;
        if (window.ResizeObserver) {
            new window.ResizeObserver((entries)=>{
                that._onresize();
            }).observe(canvas, {});
        } else {
            if (window.MutationObserver) {
                new MutationObserver(function(mutations) {
                    if (mutations.length > 0) {
                        that._onresize();
                    }
                }).observe(canvas, {
                    attributes: true,
                    attributeFilter: [
                        'style'
                    ]
                });
            }
            window.addEventListener('resize', ()=>{
                this._onresize();
            });
        }
    }
    updateFrameInfo() {
        this._frameInfo.frameCounter++;
        this._frameInfo.drawCalls = 0;
        this._frameInfo.computeCalls = 0;
        const now = this._beginFrameTime;
        if (this._frameInfo.frameTimestamp === 0) {
            this._frameInfo.frameTimestamp = now;
            this._frameInfo.elapsedTimeCPU = 0;
            this._frameInfo.elapsedTimeGPU = 0;
            this._frameInfo.elapsedFrame = 0;
            this._frameInfo.elapsedOverall = 0;
            this._frameInfo.FPS = 0;
            this._fpsCounter.time = now;
            this._fpsCounter.frame = this._frameInfo.frameCounter;
            if (this._gpuTimer) {
                this._gpuTimer.begin();
            }
        } else {
            this._frameInfo.elapsedFrame = now - this._frameInfo.frameTimestamp;
            this._frameInfo.elapsedOverall += this._frameInfo.elapsedFrame;
            let gpuTime = 0;
            let cpuTime = 0;
            if (this._endFrameTime !== 0) {
                gpuTime = now - this._endFrameTime;
                cpuTime = this._endFrameTime - this._frameInfo.frameTimestamp;
            }
            this._frameInfo.frameTimestamp = now;
            if (now >= this._fpsCounter.time + 1000) {
                this._frameInfo.FPS = (this._frameInfo.frameCounter - this._fpsCounter.frame) * 1000 / (now - this._fpsCounter.time);
                this._fpsCounter.time = now;
                this._fpsCounter.frame = this._frameInfo.frameCounter;
                this._frameInfo.elapsedTimeGPU = gpuTime;
                this._frameInfo.elapsedTimeCPU = cpuTime;
            }
        }
        const tmp = this._frameInfo.nextFrameCall;
        this._frameInfo.nextFrameCall = this._frameInfo.nextFrameCallNext;
        this._frameInfo.nextFrameCallNext = tmp;
        for (const f of this._frameInfo.nextFrameCallNext){
            f();
        }
        this._frameInfo.nextFrameCallNext.length = 0;
    }
    getGPUObjectList(obj) {
        let list = null;
        if (obj.isTexture()) {
            list = this._gpuObjectList.textures;
        } else if (obj.isSampler()) {
            list = this._gpuObjectList.samplers;
        } else if (obj.isBuffer()) {
            list = this._gpuObjectList.buffers;
        } else if (obj.isFramebuffer()) {
            list = this._gpuObjectList.framebuffers;
        } else if (obj.isProgram()) {
            list = this._gpuObjectList.programs;
        } else if (obj.isVertexLayout()) {
            list = this._gpuObjectList.vertexArrayObjects;
        } else if (obj.isBindGroup()) {
            list = this._gpuObjectList.bindGroups;
        }
        return list;
    }
    invalidateAll() {
        for (const list of [
            this._gpuObjectList.buffers,
            this._gpuObjectList.textures,
            this._gpuObjectList.samplers,
            this._gpuObjectList.programs,
            this._gpuObjectList.framebuffers,
            this._gpuObjectList.vertexArrayObjects,
            this._gpuObjectList.bindGroups
        ]){
            for (const obj of list){
                this.disposeObject(obj, false);
            }
        }
        if (this.isContextLost()) {
            for (const obj of this._disposeObjectList){
                obj.destroy();
            }
            this._disposeObjectList = [];
        }
    }
    async reloadAll() {
        const promises = [];
        for (const list of [
            this._gpuObjectList.buffers,
            this._gpuObjectList.textures,
            this._gpuObjectList.samplers,
            this._gpuObjectList.programs,
            this._gpuObjectList.framebuffers,
            this._gpuObjectList.vertexArrayObjects,
            this._gpuObjectList.bindGroups
        ]){
            // obj.reload() may change the list, so make a copy first
            for (const obj of list.slice()){
                promises.push(obj.reload());
            }
        }
        Promise.all(promises);
        return;
    }
    parseTextureOptions(options) {
        const noMipmapFlag = options?.samplerOptions?.mipFilter === 'none' ? GPUResourceUsageFlags.TF_NO_MIPMAP : 0;
        const writableFlag = options?.writable ? GPUResourceUsageFlags.TF_WRITABLE : 0;
        const dynamicFlag = options?.dynamic ? GPUResourceUsageFlags.DYNAMIC : 0;
        return noMipmapFlag | writableFlag | dynamicFlag;
    }
    parseBufferOptions(options, defaultUsage) {
        const usage = options?.usage || defaultUsage;
        let usageFlag;
        switch(usage){
            case 'uniform':
                usageFlag = GPUResourceUsageFlags.BF_UNIFORM;
                options.managed = false;
                options.dynamic = options.dynamic ?? true;
                break;
            case 'vertex':
                usageFlag = GPUResourceUsageFlags.BF_VERTEX;
                break;
            case 'index':
                usageFlag = GPUResourceUsageFlags.BF_INDEX;
                break;
            case 'read':
                usageFlag = GPUResourceUsageFlags.BF_READ;
                options.managed = false;
                break;
            case 'write':
                usageFlag = GPUResourceUsageFlags.BF_WRITE;
                options.managed = false;
                break;
            default:
                usageFlag = 0;
                break;
        }
        const storageFlag = options?.storage ?? false ? GPUResourceUsageFlags.BF_STORAGE : 0;
        const dynamicFlag = options?.dynamic ?? false ? GPUResourceUsageFlags.DYNAMIC : 0;
        const managedFlag = dynamicFlag === 0 && (options?.managed ?? true) ? GPUResourceUsageFlags.MANAGED : 0;
        return usageFlag | storageFlag | dynamicFlag | managedFlag;
    }
}

/**
 * Structured buffer data
 * @public
 */ class StructuredBufferData {
    /** @internal */ _cache;
    /** @internal */ _buffer;
    /** @internal */ _size;
    /** @internal */ _uniformMap;
    /** @internal */ _uniformPositions;
    /**
   * Creates a new structured buffer data
   * @param layout - Layout of the structure
   * @param buffer - Buffer that holds the data
   */ constructor(layout, buffer){
        this._size = layout.byteSize + 15 & ~15;
        if (this._size <= 0) {
            throw new Error(`UniformBuffer(): invalid uniform buffer byte size: ${this._size}`);
        }
        // this._cache = new ArrayBuffer(size);
        this._uniformMap = {};
        this._uniformPositions = {};
        this._cache = buffer instanceof ArrayBuffer ? buffer : null;
        this._buffer = buffer instanceof ArrayBuffer ? null : buffer;
        this.init(layout, 0, '');
    }
    /** The buffer size in bytes */ get byteLength() {
        return this._size;
    }
    /** Get the data cache buffer */ get buffer() {
        return this._cache;
    }
    /** Get all the uniform datas */ get uniforms() {
        return this._uniformMap;
    }
    /**
   * Sets the value of a structure member
   * @param name - Name of the member
   * @param value - Value to set
   */ set(name, value) {
        if (value !== undefined) {
            const view = this._uniformMap[name];
            if (view) {
                if (this._cache) {
                    if (typeof value === 'number') {
                        view[0] = value;
                    } else if (value?._v) {
                        view.set(value._v);
                    } else if (typeof value?.length === 'number') {
                        view.set(value);
                    } else {
                        throw new Error('invalid uniform value');
                    }
                } else {
                    const size = this._uniformPositions[name][1];
                    if (typeof value === 'number') {
                        view[0] = value;
                        this._buffer.bufferSubData(this._uniformPositions[name][0], view);
                    } else if (value['BYTES_PER_ELEMENT'] && size <= value['byteLength']) {
                        const arr = value;
                        this._buffer.bufferSubData(this._uniformPositions[name][0], arr, 0, size / arr.BYTES_PER_ELEMENT >> 0);
                    } else {
                        throw new Error('invalid uniform value');
                    }
                }
            } else {
                const proto = Object.getPrototypeOf(value);
                if (proto === Object.getPrototypeOf({})) {
                    this.setStruct(name, value);
                } else {
                    throw new Error('invalid uniform value');
                }
            }
        }
    }
    /** @internal */ setStruct(name, value) {
        for(const k in value){
            this.set(`${name}.${k}`, value[k]);
        }
    }
    /** @internal */ init(layout, offset, prefix) {
        for (const entry of layout.entries){
            if (entry.subLayout) {
                offset = this.init(entry.subLayout, offset, `${prefix}${entry.name}.`);
            } else {
                const name = `${prefix}${entry.name}`;
                if (this._uniformPositions[name]) {
                    throw new Error(`UniformBuffer(): duplicate uniform name: ${name}`);
                }
                if (entry.offset < offset || entry.byteSize < 0) {
                    throw new Error('UniformBuffer(): invalid layout');
                }
                this._uniformPositions[name] = [
                    entry.offset,
                    entry.byteSize
                ];
                let viewCtor = null;
                switch(entry.type){
                    case PBPrimitiveType.F32:
                        viewCtor = Float32Array;
                        break;
                    case PBPrimitiveType.U32:
                    case PBPrimitiveType.BOOL:
                        viewCtor = Uint32Array;
                        break;
                    case PBPrimitiveType.I32:
                        viewCtor = Int32Array;
                        break;
                    case PBPrimitiveType.U16:
                    case PBPrimitiveType.U16_NORM:
                    case PBPrimitiveType.F16:
                        viewCtor = Uint16Array;
                        break;
                    case PBPrimitiveType.I16:
                    case PBPrimitiveType.I16_NORM:
                        viewCtor = Int16Array;
                        break;
                    case PBPrimitiveType.U8:
                    case PBPrimitiveType.U8_NORM:
                        viewCtor = Uint8Array;
                        break;
                    case PBPrimitiveType.I8:
                    case PBPrimitiveType.I8_NORM:
                        viewCtor = Int8Array;
                        break;
                }
                if (!viewCtor) {
                    throw new Error(`UniformBuffer(): invalid data type for uniform: ${name}`);
                }
                if (entry.byteSize % viewCtor.BYTES_PER_ELEMENT) {
                    throw new Error(`UniformBuffer(): invalid byte size for uniform: ${name}`);
                }
                if (this._cache) {
                    this._uniformMap[name] = new viewCtor(this._cache, entry.offset, entry.byteSize / viewCtor.BYTES_PER_ELEMENT);
                } else {
                    this._uniformMap[name] = new viewCtor(1);
                }
                offset = entry.offset + entry.byteSize;
            }
        }
        return offset;
    }
}

/**
 * WebGL constant value definitions
 */ var WebGLEnum;
(function(WebGLEnum) {
    WebGLEnum[WebGLEnum["READ_BUFFER"] = 0xc02] = "READ_BUFFER";
    WebGLEnum[WebGLEnum["UNPACK_ROW_LENGTH"] = 0xcf2] = "UNPACK_ROW_LENGTH";
    WebGLEnum[WebGLEnum["UNPACK_SKIP_ROWS"] = 0xcf3] = "UNPACK_SKIP_ROWS";
    WebGLEnum[WebGLEnum["UNPACK_SKIP_PIXELS"] = 0xcf4] = "UNPACK_SKIP_PIXELS";
    WebGLEnum[WebGLEnum["PACK_ROW_LENGTH"] = 0xd02] = "PACK_ROW_LENGTH";
    WebGLEnum[WebGLEnum["PACK_SKIP_ROWS"] = 0xd03] = "PACK_SKIP_ROWS";
    WebGLEnum[WebGLEnum["PACK_SKIP_PIXELS"] = 0xd04] = "PACK_SKIP_PIXELS";
    WebGLEnum[WebGLEnum["COLOR"] = 0x1800] = "COLOR";
    WebGLEnum[WebGLEnum["DEPTH"] = 0x1801] = "DEPTH";
    WebGLEnum[WebGLEnum["STENCIL"] = 0x1802] = "STENCIL";
    WebGLEnum[WebGLEnum["RED"] = 0x1903] = "RED";
    WebGLEnum[WebGLEnum["RGB8"] = 0x8051] = "RGB8";
    WebGLEnum[WebGLEnum["RGBA8"] = 0x8058] = "RGBA8";
    WebGLEnum[WebGLEnum["RGB10_A2"] = 0x8059] = "RGB10_A2";
    WebGLEnum[WebGLEnum["TEXTURE_BINDING_3D"] = 0x806a] = "TEXTURE_BINDING_3D";
    WebGLEnum[WebGLEnum["UNPACK_SKIP_IMAGES"] = 0x806d] = "UNPACK_SKIP_IMAGES";
    WebGLEnum[WebGLEnum["UNPACK_IMAGE_HEIGHT"] = 0x806e] = "UNPACK_IMAGE_HEIGHT";
    WebGLEnum[WebGLEnum["TEXTURE_3D"] = 0x806f] = "TEXTURE_3D";
    WebGLEnum[WebGLEnum["TEXTURE_WRAP_R"] = 0x8072] = "TEXTURE_WRAP_R";
    WebGLEnum[WebGLEnum["MAX_3D_TEXTURE_SIZE"] = 0x8073] = "MAX_3D_TEXTURE_SIZE";
    WebGLEnum[WebGLEnum["UNSIGNED_INT_2_10_10_10_REV"] = 0x8368] = "UNSIGNED_INT_2_10_10_10_REV";
    WebGLEnum[WebGLEnum["MAX_ELEMENTS_VERTICES"] = 0x80e8] = "MAX_ELEMENTS_VERTICES";
    WebGLEnum[WebGLEnum["MAX_ELEMENTS_INDICES"] = 0x80e9] = "MAX_ELEMENTS_INDICES";
    WebGLEnum[WebGLEnum["TEXTURE_MIN_LOD"] = 0x813a] = "TEXTURE_MIN_LOD";
    WebGLEnum[WebGLEnum["TEXTURE_MAX_LOD"] = 0x813b] = "TEXTURE_MAX_LOD";
    WebGLEnum[WebGLEnum["TEXTURE_BASE_LEVEL"] = 0x813c] = "TEXTURE_BASE_LEVEL";
    WebGLEnum[WebGLEnum["TEXTURE_MAX_LEVEL"] = 0x813d] = "TEXTURE_MAX_LEVEL";
    WebGLEnum[WebGLEnum["MIN"] = 0x8007] = "MIN";
    WebGLEnum[WebGLEnum["MAX"] = 0x8008] = "MAX";
    WebGLEnum[WebGLEnum["DEPTH_COMPONENT24"] = 0x81a6] = "DEPTH_COMPONENT24";
    WebGLEnum[WebGLEnum["MAX_TEXTURE_LOD_BIAS"] = 0x84fd] = "MAX_TEXTURE_LOD_BIAS";
    WebGLEnum[WebGLEnum["TEXTURE_COMPARE_MODE"] = 0x884c] = "TEXTURE_COMPARE_MODE";
    WebGLEnum[WebGLEnum["TEXTURE_COMPARE_FUNC"] = 0x884d] = "TEXTURE_COMPARE_FUNC";
    WebGLEnum[WebGLEnum["CURRENT_QUERY"] = 0x8865] = "CURRENT_QUERY";
    WebGLEnum[WebGLEnum["QUERY_RESULT"] = 0x8866] = "QUERY_RESULT";
    WebGLEnum[WebGLEnum["QUERY_RESULT_AVAILABLE"] = 0x8867] = "QUERY_RESULT_AVAILABLE";
    WebGLEnum[WebGLEnum["STREAM_READ"] = 0x88e1] = "STREAM_READ";
    WebGLEnum[WebGLEnum["STREAM_COPY"] = 0x88e2] = "STREAM_COPY";
    WebGLEnum[WebGLEnum["STATIC_READ"] = 0x88e5] = "STATIC_READ";
    WebGLEnum[WebGLEnum["STATIC_COPY"] = 0x88e6] = "STATIC_COPY";
    WebGLEnum[WebGLEnum["DYNAMIC_READ"] = 0x88e9] = "DYNAMIC_READ";
    WebGLEnum[WebGLEnum["DYNAMIC_COPY"] = 0x88ea] = "DYNAMIC_COPY";
    WebGLEnum[WebGLEnum["MAX_DRAW_BUFFERS"] = 0x8824] = "MAX_DRAW_BUFFERS";
    WebGLEnum[WebGLEnum["DRAW_BUFFER0"] = 0x8825] = "DRAW_BUFFER0";
    WebGLEnum[WebGLEnum["DRAW_BUFFER1"] = 0x8826] = "DRAW_BUFFER1";
    WebGLEnum[WebGLEnum["DRAW_BUFFER2"] = 0x8827] = "DRAW_BUFFER2";
    WebGLEnum[WebGLEnum["DRAW_BUFFER3"] = 0x8828] = "DRAW_BUFFER3";
    WebGLEnum[WebGLEnum["DRAW_BUFFER4"] = 0x8829] = "DRAW_BUFFER4";
    WebGLEnum[WebGLEnum["DRAW_BUFFER5"] = 0x882a] = "DRAW_BUFFER5";
    WebGLEnum[WebGLEnum["DRAW_BUFFER6"] = 0x882b] = "DRAW_BUFFER6";
    WebGLEnum[WebGLEnum["DRAW_BUFFER7"] = 0x882c] = "DRAW_BUFFER7";
    WebGLEnum[WebGLEnum["DRAW_BUFFER8"] = 0x882d] = "DRAW_BUFFER8";
    WebGLEnum[WebGLEnum["DRAW_BUFFER9"] = 0x882e] = "DRAW_BUFFER9";
    WebGLEnum[WebGLEnum["DRAW_BUFFER10"] = 0x882f] = "DRAW_BUFFER10";
    WebGLEnum[WebGLEnum["DRAW_BUFFER11"] = 0x8830] = "DRAW_BUFFER11";
    WebGLEnum[WebGLEnum["DRAW_BUFFER12"] = 0x8831] = "DRAW_BUFFER12";
    WebGLEnum[WebGLEnum["DRAW_BUFFER13"] = 0x8832] = "DRAW_BUFFER13";
    WebGLEnum[WebGLEnum["DRAW_BUFFER14"] = 0x8833] = "DRAW_BUFFER14";
    WebGLEnum[WebGLEnum["DRAW_BUFFER15"] = 0x8834] = "DRAW_BUFFER15";
    WebGLEnum[WebGLEnum["MAX_FRAGMENT_UNIFORM_COMPONENTS"] = 0x8b49] = "MAX_FRAGMENT_UNIFORM_COMPONENTS";
    WebGLEnum[WebGLEnum["MAX_VERTEX_UNIFORM_COMPONENTS"] = 0x8b4a] = "MAX_VERTEX_UNIFORM_COMPONENTS";
    WebGLEnum[WebGLEnum["SAMPLER_3D"] = 0x8b5f] = "SAMPLER_3D";
    WebGLEnum[WebGLEnum["SAMPLER_2D_SHADOW"] = 0x8b62] = "SAMPLER_2D_SHADOW";
    WebGLEnum[WebGLEnum["FRAGMENT_SHADER_DERIVATIVE_HINT"] = 0x8b8b] = "FRAGMENT_SHADER_DERIVATIVE_HINT";
    WebGLEnum[WebGLEnum["PIXEL_PACK_BUFFER"] = 0x88eb] = "PIXEL_PACK_BUFFER";
    WebGLEnum[WebGLEnum["PIXEL_UNPACK_BUFFER"] = 0x88ec] = "PIXEL_UNPACK_BUFFER";
    WebGLEnum[WebGLEnum["PIXEL_PACK_BUFFER_BINDING"] = 0x88ed] = "PIXEL_PACK_BUFFER_BINDING";
    WebGLEnum[WebGLEnum["PIXEL_UNPACK_BUFFER_BINDING"] = 0x88ef] = "PIXEL_UNPACK_BUFFER_BINDING";
    WebGLEnum[WebGLEnum["FLOAT_MAT2x3"] = 0x8b65] = "FLOAT_MAT2x3";
    WebGLEnum[WebGLEnum["FLOAT_MAT2x4"] = 0x8b66] = "FLOAT_MAT2x4";
    WebGLEnum[WebGLEnum["FLOAT_MAT3x2"] = 0x8b67] = "FLOAT_MAT3x2";
    WebGLEnum[WebGLEnum["FLOAT_MAT3x4"] = 0x8b68] = "FLOAT_MAT3x4";
    WebGLEnum[WebGLEnum["FLOAT_MAT4x2"] = 0x8b69] = "FLOAT_MAT4x2";
    WebGLEnum[WebGLEnum["FLOAT_MAT4x3"] = 0x8b6a] = "FLOAT_MAT4x3";
    WebGLEnum[WebGLEnum["SRGB"] = 0x8c40] = "SRGB";
    WebGLEnum[WebGLEnum["SRGB8"] = 0x8c41] = "SRGB8";
    WebGLEnum[WebGLEnum["SRGB_ALPHA"] = 0x8c42] = "SRGB_ALPHA";
    WebGLEnum[WebGLEnum["SRGB8_ALPHA8"] = 0x8c43] = "SRGB8_ALPHA8";
    WebGLEnum[WebGLEnum["COMPARE_REF_TO_TEXTURE"] = 0x884e] = "COMPARE_REF_TO_TEXTURE";
    WebGLEnum[WebGLEnum["RGBA32F"] = 0x8814] = "RGBA32F";
    WebGLEnum[WebGLEnum["RGB32F"] = 0x8815] = "RGB32F";
    WebGLEnum[WebGLEnum["RGBA16F"] = 0x881a] = "RGBA16F";
    WebGLEnum[WebGLEnum["RGB16F"] = 0x881b] = "RGB16F";
    WebGLEnum[WebGLEnum["VERTEX_ATTRIB_ARRAY_INTEGER"] = 0x88fd] = "VERTEX_ATTRIB_ARRAY_INTEGER";
    WebGLEnum[WebGLEnum["MAX_ARRAY_TEXTURE_LAYERS"] = 0x88ff] = "MAX_ARRAY_TEXTURE_LAYERS";
    WebGLEnum[WebGLEnum["MIN_PROGRAM_TEXEL_OFFSET"] = 0x8904] = "MIN_PROGRAM_TEXEL_OFFSET";
    WebGLEnum[WebGLEnum["MAX_PROGRAM_TEXEL_OFFSET"] = 0x8905] = "MAX_PROGRAM_TEXEL_OFFSET";
    WebGLEnum[WebGLEnum["MAX_VARYING_COMPONENTS"] = 0x8b4b] = "MAX_VARYING_COMPONENTS";
    WebGLEnum[WebGLEnum["TEXTURE_2D_ARRAY"] = 0x8c1a] = "TEXTURE_2D_ARRAY";
    WebGLEnum[WebGLEnum["TEXTURE_BINDING_2D_ARRAY"] = 0x8c1d] = "TEXTURE_BINDING_2D_ARRAY";
    WebGLEnum[WebGLEnum["R11F_G11F_B10F"] = 0x8c3a] = "R11F_G11F_B10F";
    WebGLEnum[WebGLEnum["UNSIGNED_INT_10F_11F_11F_REV"] = 0x8c3b] = "UNSIGNED_INT_10F_11F_11F_REV";
    WebGLEnum[WebGLEnum["RGB9_E5"] = 0x8c3d] = "RGB9_E5";
    WebGLEnum[WebGLEnum["UNSIGNED_INT_5_9_9_9_REV"] = 0x8c3e] = "UNSIGNED_INT_5_9_9_9_REV";
    WebGLEnum[WebGLEnum["TRANSFORM_FEEDBACK_BUFFER_MODE"] = 0x8c7f] = "TRANSFORM_FEEDBACK_BUFFER_MODE";
    WebGLEnum[WebGLEnum["MAX_TRANSFORM_FEEDBACK_SEPARATE_COMPONENTS"] = 0x8c80] = "MAX_TRANSFORM_FEEDBACK_SEPARATE_COMPONENTS";
    WebGLEnum[WebGLEnum["TRANSFORM_FEEDBACK_VARYINGS"] = 0x8c83] = "TRANSFORM_FEEDBACK_VARYINGS";
    WebGLEnum[WebGLEnum["TRANSFORM_FEEDBACK_BUFFER_START"] = 0x8c84] = "TRANSFORM_FEEDBACK_BUFFER_START";
    WebGLEnum[WebGLEnum["TRANSFORM_FEEDBACK_BUFFER_SIZE"] = 0x8c85] = "TRANSFORM_FEEDBACK_BUFFER_SIZE";
    WebGLEnum[WebGLEnum["TRANSFORM_FEEDBACK_PRIMITIVES_WRITTEN"] = 0x8c88] = "TRANSFORM_FEEDBACK_PRIMITIVES_WRITTEN";
    WebGLEnum[WebGLEnum["RASTERIZER_DISCARD"] = 0x8c89] = "RASTERIZER_DISCARD";
    WebGLEnum[WebGLEnum["MAX_TRANSFORM_FEEDBACK_INTERLEAVED_COMPONENTS"] = 0x8c8a] = "MAX_TRANSFORM_FEEDBACK_INTERLEAVED_COMPONENTS";
    WebGLEnum[WebGLEnum["MAX_TRANSFORM_FEEDBACK_SEPARATE_ATTRIBS"] = 0x8c8b] = "MAX_TRANSFORM_FEEDBACK_SEPARATE_ATTRIBS";
    WebGLEnum[WebGLEnum["INTERLEAVED_ATTRIBS"] = 0x8c8c] = "INTERLEAVED_ATTRIBS";
    WebGLEnum[WebGLEnum["SEPARATE_ATTRIBS"] = 0x8c8d] = "SEPARATE_ATTRIBS";
    WebGLEnum[WebGLEnum["TRANSFORM_FEEDBACK_BUFFER"] = 0x8c8e] = "TRANSFORM_FEEDBACK_BUFFER";
    WebGLEnum[WebGLEnum["TRANSFORM_FEEDBACK_BUFFER_BINDING"] = 0x8c8f] = "TRANSFORM_FEEDBACK_BUFFER_BINDING";
    WebGLEnum[WebGLEnum["RGBA32UI"] = 0x8d70] = "RGBA32UI";
    WebGLEnum[WebGLEnum["RGB32UI"] = 0x8d71] = "RGB32UI";
    WebGLEnum[WebGLEnum["RGBA16UI"] = 0x8d76] = "RGBA16UI";
    WebGLEnum[WebGLEnum["RGB16UI"] = 0x8d77] = "RGB16UI";
    WebGLEnum[WebGLEnum["RGBA8UI"] = 0x8d7c] = "RGBA8UI";
    WebGLEnum[WebGLEnum["RGB8UI"] = 0x8d7d] = "RGB8UI";
    WebGLEnum[WebGLEnum["RGBA32I"] = 0x8d82] = "RGBA32I";
    WebGLEnum[WebGLEnum["RGB32I"] = 0x8d83] = "RGB32I";
    WebGLEnum[WebGLEnum["RGBA16I"] = 0x8d88] = "RGBA16I";
    WebGLEnum[WebGLEnum["RGB16I"] = 0x8d89] = "RGB16I";
    WebGLEnum[WebGLEnum["RGBA8I"] = 0x8d8e] = "RGBA8I";
    WebGLEnum[WebGLEnum["RGB8I"] = 0x8d8f] = "RGB8I";
    WebGLEnum[WebGLEnum["RED_INTEGER"] = 0x8d94] = "RED_INTEGER";
    WebGLEnum[WebGLEnum["RGB_INTEGER"] = 0x8d98] = "RGB_INTEGER";
    WebGLEnum[WebGLEnum["RGBA_INTEGER"] = 0x8d99] = "RGBA_INTEGER";
    WebGLEnum[WebGLEnum["SAMPLER_2D_ARRAY"] = 0x8dc1] = "SAMPLER_2D_ARRAY";
    WebGLEnum[WebGLEnum["SAMPLER_2D_ARRAY_SHADOW"] = 0x8dc4] = "SAMPLER_2D_ARRAY_SHADOW";
    WebGLEnum[WebGLEnum["SAMPLER_CUBE_SHADOW"] = 0x8dc5] = "SAMPLER_CUBE_SHADOW";
    WebGLEnum[WebGLEnum["UNSIGNED_INT_VEC2"] = 0x8dc6] = "UNSIGNED_INT_VEC2";
    WebGLEnum[WebGLEnum["UNSIGNED_INT_VEC3"] = 0x8dc7] = "UNSIGNED_INT_VEC3";
    WebGLEnum[WebGLEnum["UNSIGNED_INT_VEC4"] = 0x8dc8] = "UNSIGNED_INT_VEC4";
    WebGLEnum[WebGLEnum["INT_SAMPLER_2D"] = 0x8dca] = "INT_SAMPLER_2D";
    WebGLEnum[WebGLEnum["INT_SAMPLER_3D"] = 0x8dcb] = "INT_SAMPLER_3D";
    WebGLEnum[WebGLEnum["INT_SAMPLER_CUBE"] = 0x8dcc] = "INT_SAMPLER_CUBE";
    WebGLEnum[WebGLEnum["INT_SAMPLER_2D_ARRAY"] = 0x8dcf] = "INT_SAMPLER_2D_ARRAY";
    WebGLEnum[WebGLEnum["UNSIGNED_INT_SAMPLER_2D"] = 0x8dd2] = "UNSIGNED_INT_SAMPLER_2D";
    WebGLEnum[WebGLEnum["UNSIGNED_INT_SAMPLER_3D"] = 0x8dd3] = "UNSIGNED_INT_SAMPLER_3D";
    WebGLEnum[WebGLEnum["UNSIGNED_INT_SAMPLER_CUBE"] = 0x8dd4] = "UNSIGNED_INT_SAMPLER_CUBE";
    WebGLEnum[WebGLEnum["UNSIGNED_INT_SAMPLER_2D_ARRAY"] = 0x8dd7] = "UNSIGNED_INT_SAMPLER_2D_ARRAY";
    WebGLEnum[WebGLEnum["DEPTH_COMPONENT32F"] = 0x8cac] = "DEPTH_COMPONENT32F";
    WebGLEnum[WebGLEnum["DEPTH32F_STENCIL8"] = 0x8cad] = "DEPTH32F_STENCIL8";
    WebGLEnum[WebGLEnum["FLOAT_32_UNSIGNED_INT_24_8_REV"] = 0x8dad] = "FLOAT_32_UNSIGNED_INT_24_8_REV";
    WebGLEnum[WebGLEnum["FRAMEBUFFER_ATTACHMENT_COLOR_ENCODING"] = 0x8210] = "FRAMEBUFFER_ATTACHMENT_COLOR_ENCODING";
    WebGLEnum[WebGLEnum["FRAMEBUFFER_ATTACHMENT_COMPONENT_TYPE"] = 0x8211] = "FRAMEBUFFER_ATTACHMENT_COMPONENT_TYPE";
    WebGLEnum[WebGLEnum["FRAMEBUFFER_ATTACHMENT_RED_SIZE"] = 0x8212] = "FRAMEBUFFER_ATTACHMENT_RED_SIZE";
    WebGLEnum[WebGLEnum["FRAMEBUFFER_ATTACHMENT_GREEN_SIZE"] = 0x8213] = "FRAMEBUFFER_ATTACHMENT_GREEN_SIZE";
    WebGLEnum[WebGLEnum["FRAMEBUFFER_ATTACHMENT_BLUE_SIZE"] = 0x8214] = "FRAMEBUFFER_ATTACHMENT_BLUE_SIZE";
    WebGLEnum[WebGLEnum["FRAMEBUFFER_ATTACHMENT_ALPHA_SIZE"] = 0x8215] = "FRAMEBUFFER_ATTACHMENT_ALPHA_SIZE";
    WebGLEnum[WebGLEnum["FRAMEBUFFER_ATTACHMENT_DEPTH_SIZE"] = 0x8216] = "FRAMEBUFFER_ATTACHMENT_DEPTH_SIZE";
    WebGLEnum[WebGLEnum["FRAMEBUFFER_ATTACHMENT_STENCIL_SIZE"] = 0x8217] = "FRAMEBUFFER_ATTACHMENT_STENCIL_SIZE";
    WebGLEnum[WebGLEnum["FRAMEBUFFER_DEFAULT"] = 0x8218] = "FRAMEBUFFER_DEFAULT";
    WebGLEnum[WebGLEnum["UNSIGNED_INT_24_8"] = 0x84fa] = "UNSIGNED_INT_24_8";
    WebGLEnum[WebGLEnum["DEPTH24_STENCIL8"] = 0x88f0] = "DEPTH24_STENCIL8";
    WebGLEnum[WebGLEnum["UNSIGNED_NORMALIZED"] = 0x8c17] = "UNSIGNED_NORMALIZED";
    WebGLEnum[WebGLEnum["DRAW_FRAMEBUFFER_BINDING"] = 0x8ca6] = "DRAW_FRAMEBUFFER_BINDING";
    WebGLEnum[WebGLEnum["READ_FRAMEBUFFER"] = 0x8ca8] = "READ_FRAMEBUFFER";
    WebGLEnum[WebGLEnum["DRAW_FRAMEBUFFER"] = 0x8ca9] = "DRAW_FRAMEBUFFER";
    WebGLEnum[WebGLEnum["READ_FRAMEBUFFER_BINDING"] = 0x8caa] = "READ_FRAMEBUFFER_BINDING";
    WebGLEnum[WebGLEnum["RENDERBUFFER_SAMPLES"] = 0x8cab] = "RENDERBUFFER_SAMPLES";
    WebGLEnum[WebGLEnum["FRAMEBUFFER_ATTACHMENT_TEXTURE_LAYER"] = 0x8cd4] = "FRAMEBUFFER_ATTACHMENT_TEXTURE_LAYER";
    WebGLEnum[WebGLEnum["MAX_COLOR_ATTACHMENTS"] = 0x8cdf] = "MAX_COLOR_ATTACHMENTS";
    WebGLEnum[WebGLEnum["COLOR_ATTACHMENT1"] = 0x8ce1] = "COLOR_ATTACHMENT1";
    WebGLEnum[WebGLEnum["COLOR_ATTACHMENT2"] = 0x8ce2] = "COLOR_ATTACHMENT2";
    WebGLEnum[WebGLEnum["COLOR_ATTACHMENT3"] = 0x8ce3] = "COLOR_ATTACHMENT3";
    WebGLEnum[WebGLEnum["COLOR_ATTACHMENT4"] = 0x8ce4] = "COLOR_ATTACHMENT4";
    WebGLEnum[WebGLEnum["COLOR_ATTACHMENT5"] = 0x8ce5] = "COLOR_ATTACHMENT5";
    WebGLEnum[WebGLEnum["COLOR_ATTACHMENT6"] = 0x8ce6] = "COLOR_ATTACHMENT6";
    WebGLEnum[WebGLEnum["COLOR_ATTACHMENT7"] = 0x8ce7] = "COLOR_ATTACHMENT7";
    WebGLEnum[WebGLEnum["COLOR_ATTACHMENT8"] = 0x8ce8] = "COLOR_ATTACHMENT8";
    WebGLEnum[WebGLEnum["COLOR_ATTACHMENT9"] = 0x8ce9] = "COLOR_ATTACHMENT9";
    WebGLEnum[WebGLEnum["COLOR_ATTACHMENT10"] = 0x8cea] = "COLOR_ATTACHMENT10";
    WebGLEnum[WebGLEnum["COLOR_ATTACHMENT11"] = 0x8ceb] = "COLOR_ATTACHMENT11";
    WebGLEnum[WebGLEnum["COLOR_ATTACHMENT12"] = 0x8cec] = "COLOR_ATTACHMENT12";
    WebGLEnum[WebGLEnum["COLOR_ATTACHMENT13"] = 0x8ced] = "COLOR_ATTACHMENT13";
    WebGLEnum[WebGLEnum["COLOR_ATTACHMENT14"] = 0x8cee] = "COLOR_ATTACHMENT14";
    WebGLEnum[WebGLEnum["COLOR_ATTACHMENT15"] = 0x8cef] = "COLOR_ATTACHMENT15";
    WebGLEnum[WebGLEnum["FRAMEBUFFER_INCOMPLETE_MULTISAMPLE"] = 0x8d56] = "FRAMEBUFFER_INCOMPLETE_MULTISAMPLE";
    WebGLEnum[WebGLEnum["MAX_SAMPLES"] = 0x8d57] = "MAX_SAMPLES";
    WebGLEnum[WebGLEnum["HALF_FLOAT"] = 0x140b] = "HALF_FLOAT";
    WebGLEnum[WebGLEnum["RG"] = 0x8227] = "RG";
    WebGLEnum[WebGLEnum["RG_INTEGER"] = 0x8228] = "RG_INTEGER";
    WebGLEnum[WebGLEnum["R8"] = 0x8229] = "R8";
    WebGLEnum[WebGLEnum["RG8"] = 0x822b] = "RG8";
    WebGLEnum[WebGLEnum["R16F"] = 0x822d] = "R16F";
    WebGLEnum[WebGLEnum["R32F"] = 0x822e] = "R32F";
    WebGLEnum[WebGLEnum["RG16F"] = 0x822f] = "RG16F";
    WebGLEnum[WebGLEnum["RG32F"] = 0x8230] = "RG32F";
    WebGLEnum[WebGLEnum["R8I"] = 0x8231] = "R8I";
    WebGLEnum[WebGLEnum["R8UI"] = 0x8232] = "R8UI";
    WebGLEnum[WebGLEnum["R16I"] = 0x8233] = "R16I";
    WebGLEnum[WebGLEnum["R16UI"] = 0x8234] = "R16UI";
    WebGLEnum[WebGLEnum["R32I"] = 0x8235] = "R32I";
    WebGLEnum[WebGLEnum["R32UI"] = 0x8236] = "R32UI";
    WebGLEnum[WebGLEnum["RG8I"] = 0x8237] = "RG8I";
    WebGLEnum[WebGLEnum["RG8UI"] = 0x8238] = "RG8UI";
    WebGLEnum[WebGLEnum["RG16I"] = 0x8239] = "RG16I";
    WebGLEnum[WebGLEnum["RG16UI"] = 0x823a] = "RG16UI";
    WebGLEnum[WebGLEnum["RG32I"] = 0x823b] = "RG32I";
    WebGLEnum[WebGLEnum["RG32UI"] = 0x823c] = "RG32UI";
    WebGLEnum[WebGLEnum["VERTEX_ARRAY_BINDING"] = 0x85b5] = "VERTEX_ARRAY_BINDING";
    WebGLEnum[WebGLEnum["R8_SNORM"] = 0x8f94] = "R8_SNORM";
    WebGLEnum[WebGLEnum["RG8_SNORM"] = 0x8f95] = "RG8_SNORM";
    WebGLEnum[WebGLEnum["RGB8_SNORM"] = 0x8f96] = "RGB8_SNORM";
    WebGLEnum[WebGLEnum["RGBA8_SNORM"] = 0x8f97] = "RGBA8_SNORM";
    WebGLEnum[WebGLEnum["SIGNED_NORMALIZED"] = 0x8f9c] = "SIGNED_NORMALIZED";
    WebGLEnum[WebGLEnum["COPY_READ_BUFFER"] = 0x8f36] = "COPY_READ_BUFFER";
    WebGLEnum[WebGLEnum["COPY_WRITE_BUFFER"] = 0x8f37] = "COPY_WRITE_BUFFER";
    WebGLEnum[WebGLEnum["COPY_READ_BUFFER_BINDING"] = 0x8f36] = "COPY_READ_BUFFER_BINDING";
    WebGLEnum[WebGLEnum["COPY_WRITE_BUFFER_BINDING"] = 0x8f37] = "COPY_WRITE_BUFFER_BINDING";
    WebGLEnum[WebGLEnum["UNIFORM_BUFFER"] = 0x8a11] = "UNIFORM_BUFFER";
    WebGLEnum[WebGLEnum["UNIFORM_BUFFER_BINDING"] = 0x8a28] = "UNIFORM_BUFFER_BINDING";
    WebGLEnum[WebGLEnum["UNIFORM_BUFFER_START"] = 0x8a29] = "UNIFORM_BUFFER_START";
    WebGLEnum[WebGLEnum["UNIFORM_BUFFER_SIZE"] = 0x8a2a] = "UNIFORM_BUFFER_SIZE";
    WebGLEnum[WebGLEnum["MAX_VERTEX_UNIFORM_BLOCKS"] = 0x8a2b] = "MAX_VERTEX_UNIFORM_BLOCKS";
    WebGLEnum[WebGLEnum["MAX_FRAGMENT_UNIFORM_BLOCKS"] = 0x8a2d] = "MAX_FRAGMENT_UNIFORM_BLOCKS";
    WebGLEnum[WebGLEnum["MAX_COMBINED_UNIFORM_BLOCKS"] = 0x8a2e] = "MAX_COMBINED_UNIFORM_BLOCKS";
    WebGLEnum[WebGLEnum["MAX_UNIFORM_BUFFER_BINDINGS"] = 0x8a2f] = "MAX_UNIFORM_BUFFER_BINDINGS";
    WebGLEnum[WebGLEnum["MAX_UNIFORM_BLOCK_SIZE"] = 0x8a30] = "MAX_UNIFORM_BLOCK_SIZE";
    WebGLEnum[WebGLEnum["MAX_COMBINED_VERTEX_UNIFORM_COMPONENTS"] = 0x8a31] = "MAX_COMBINED_VERTEX_UNIFORM_COMPONENTS";
    WebGLEnum[WebGLEnum["MAX_COMBINED_FRAGMENT_UNIFORM_COMPONENTS"] = 0x8a33] = "MAX_COMBINED_FRAGMENT_UNIFORM_COMPONENTS";
    WebGLEnum[WebGLEnum["UNIFORM_BUFFER_OFFSET_ALIGNMENT"] = 0x8a34] = "UNIFORM_BUFFER_OFFSET_ALIGNMENT";
    WebGLEnum[WebGLEnum["ACTIVE_UNIFORM_BLOCKS"] = 0x8a36] = "ACTIVE_UNIFORM_BLOCKS";
    WebGLEnum[WebGLEnum["UNIFORM_TYPE"] = 0x8a37] = "UNIFORM_TYPE";
    WebGLEnum[WebGLEnum["UNIFORM_SIZE"] = 0x8a38] = "UNIFORM_SIZE";
    WebGLEnum[WebGLEnum["UNIFORM_BLOCK_INDEX"] = 0x8a3a] = "UNIFORM_BLOCK_INDEX";
    WebGLEnum[WebGLEnum["UNIFORM_OFFSET"] = 0x8a3b] = "UNIFORM_OFFSET";
    WebGLEnum[WebGLEnum["UNIFORM_ARRAY_STRIDE"] = 0x8a3c] = "UNIFORM_ARRAY_STRIDE";
    WebGLEnum[WebGLEnum["UNIFORM_MATRIX_STRIDE"] = 0x8a3d] = "UNIFORM_MATRIX_STRIDE";
    WebGLEnum[WebGLEnum["UNIFORM_IS_ROW_MAJOR"] = 0x8a3e] = "UNIFORM_IS_ROW_MAJOR";
    WebGLEnum[WebGLEnum["UNIFORM_BLOCK_BINDING"] = 0x8a3f] = "UNIFORM_BLOCK_BINDING";
    WebGLEnum[WebGLEnum["UNIFORM_BLOCK_DATA_SIZE"] = 0x8a40] = "UNIFORM_BLOCK_DATA_SIZE";
    WebGLEnum[WebGLEnum["UNIFORM_BLOCK_ACTIVE_UNIFORMS"] = 0x8a42] = "UNIFORM_BLOCK_ACTIVE_UNIFORMS";
    WebGLEnum[WebGLEnum["UNIFORM_BLOCK_ACTIVE_UNIFORM_INDICES"] = 0x8a43] = "UNIFORM_BLOCK_ACTIVE_UNIFORM_INDICES";
    WebGLEnum[WebGLEnum["UNIFORM_BLOCK_REFERENCED_BY_VERTEX_SHADER"] = 0x8a44] = "UNIFORM_BLOCK_REFERENCED_BY_VERTEX_SHADER";
    WebGLEnum[WebGLEnum["UNIFORM_BLOCK_REFERENCED_BY_FRAGMENT_SHADER"] = 0x8a46] = "UNIFORM_BLOCK_REFERENCED_BY_FRAGMENT_SHADER";
    WebGLEnum[WebGLEnum["INVALID_INDEX"] = 0xffffffff] = "INVALID_INDEX";
    WebGLEnum[WebGLEnum["MAX_VERTEX_OUTPUT_COMPONENTS"] = 0x9122] = "MAX_VERTEX_OUTPUT_COMPONENTS";
    WebGLEnum[WebGLEnum["MAX_FRAGMENT_INPUT_COMPONENTS"] = 0x9125] = "MAX_FRAGMENT_INPUT_COMPONENTS";
    WebGLEnum[WebGLEnum["MAX_SERVER_WAIT_TIMEOUT"] = 0x9111] = "MAX_SERVER_WAIT_TIMEOUT";
    WebGLEnum[WebGLEnum["OBJECT_TYPE"] = 0x9112] = "OBJECT_TYPE";
    WebGLEnum[WebGLEnum["SYNC_CONDITION"] = 0x9113] = "SYNC_CONDITION";
    WebGLEnum[WebGLEnum["SYNC_STATUS"] = 0x9114] = "SYNC_STATUS";
    WebGLEnum[WebGLEnum["SYNC_FLAGS"] = 0x9115] = "SYNC_FLAGS";
    WebGLEnum[WebGLEnum["SYNC_FENCE"] = 0x9116] = "SYNC_FENCE";
    WebGLEnum[WebGLEnum["SYNC_GPU_COMMANDS_COMPLETE"] = 0x9117] = "SYNC_GPU_COMMANDS_COMPLETE";
    WebGLEnum[WebGLEnum["UNSIGNALED"] = 0x9118] = "UNSIGNALED";
    WebGLEnum[WebGLEnum["SIGNALED"] = 0x9119] = "SIGNALED";
    WebGLEnum[WebGLEnum["ALREADY_SIGNALED"] = 0x911a] = "ALREADY_SIGNALED";
    WebGLEnum[WebGLEnum["TIMEOUT_EXPIRED"] = 0x911b] = "TIMEOUT_EXPIRED";
    WebGLEnum[WebGLEnum["CONDITION_SATISFIED"] = 0x911c] = "CONDITION_SATISFIED";
    WebGLEnum[WebGLEnum["WAIT_FAILED"] = 0x911d] = "WAIT_FAILED";
    WebGLEnum[WebGLEnum["SYNC_FLUSH_COMMANDS_BIT"] = 0x1] = "SYNC_FLUSH_COMMANDS_BIT";
    WebGLEnum[WebGLEnum["VERTEX_ATTRIB_ARRAY_DIVISOR"] = 0x88fe] = "VERTEX_ATTRIB_ARRAY_DIVISOR";
    WebGLEnum[WebGLEnum["ANY_SAMPLES_PASSED"] = 0x8c2f] = "ANY_SAMPLES_PASSED";
    WebGLEnum[WebGLEnum["ANY_SAMPLES_PASSED_CONSERVATIVE"] = 0x8d6a] = "ANY_SAMPLES_PASSED_CONSERVATIVE";
    WebGLEnum[WebGLEnum["SAMPLER_BINDING"] = 0x8919] = "SAMPLER_BINDING";
    WebGLEnum[WebGLEnum["RGB10_A2UI"] = 0x906f] = "RGB10_A2UI";
    WebGLEnum[WebGLEnum["INT_2_10_10_10_REV"] = 0x8d9f] = "INT_2_10_10_10_REV";
    WebGLEnum[WebGLEnum["TRANSFORM_FEEDBACK"] = 0x8e22] = "TRANSFORM_FEEDBACK";
    WebGLEnum[WebGLEnum["TRANSFORM_FEEDBACK_PAUSED"] = 0x8e23] = "TRANSFORM_FEEDBACK_PAUSED";
    WebGLEnum[WebGLEnum["TRANSFORM_FEEDBACK_ACTIVE"] = 0x8e24] = "TRANSFORM_FEEDBACK_ACTIVE";
    WebGLEnum[WebGLEnum["TRANSFORM_FEEDBACK_BINDING"] = 0x8e25] = "TRANSFORM_FEEDBACK_BINDING";
    WebGLEnum[WebGLEnum["TEXTURE_IMMUTABLE_FORMAT"] = 0x912f] = "TEXTURE_IMMUTABLE_FORMAT";
    WebGLEnum[WebGLEnum["MAX_ELEMENT_INDEX"] = 0x8d6b] = "MAX_ELEMENT_INDEX";
    WebGLEnum[WebGLEnum["TEXTURE_IMMUTABLE_LEVELS"] = 0x82df] = "TEXTURE_IMMUTABLE_LEVELS";
    WebGLEnum[WebGLEnum["MAX_CLIENT_WAIT_TIMEOUT_WEBGL"] = 0x9247] = "MAX_CLIENT_WAIT_TIMEOUT_WEBGL";
    WebGLEnum[WebGLEnum["DEPTH_BUFFER_BIT"] = 0x100] = "DEPTH_BUFFER_BIT";
    WebGLEnum[WebGLEnum["STENCIL_BUFFER_BIT"] = 0x400] = "STENCIL_BUFFER_BIT";
    WebGLEnum[WebGLEnum["COLOR_BUFFER_BIT"] = 0x4000] = "COLOR_BUFFER_BIT";
    WebGLEnum[WebGLEnum["POINTS"] = 0x0] = "POINTS";
    WebGLEnum[WebGLEnum["LINES"] = 0x1] = "LINES";
    WebGLEnum[WebGLEnum["LINE_LOOP"] = 0x2] = "LINE_LOOP";
    WebGLEnum[WebGLEnum["LINE_STRIP"] = 0x3] = "LINE_STRIP";
    WebGLEnum[WebGLEnum["TRIANGLES"] = 0x4] = "TRIANGLES";
    WebGLEnum[WebGLEnum["TRIANGLE_STRIP"] = 0x5] = "TRIANGLE_STRIP";
    WebGLEnum[WebGLEnum["TRIANGLE_FAN"] = 0x6] = "TRIANGLE_FAN";
    WebGLEnum[WebGLEnum["ZERO"] = 0x0] = "ZERO";
    WebGLEnum[WebGLEnum["ONE"] = 0x1] = "ONE";
    WebGLEnum[WebGLEnum["SRC_COLOR"] = 0x300] = "SRC_COLOR";
    WebGLEnum[WebGLEnum["ONE_MINUS_SRC_COLOR"] = 0x301] = "ONE_MINUS_SRC_COLOR";
    WebGLEnum[WebGLEnum["SRC_ALPHA"] = 0x302] = "SRC_ALPHA";
    WebGLEnum[WebGLEnum["ONE_MINUS_SRC_ALPHA"] = 0x303] = "ONE_MINUS_SRC_ALPHA";
    WebGLEnum[WebGLEnum["DST_ALPHA"] = 0x304] = "DST_ALPHA";
    WebGLEnum[WebGLEnum["ONE_MINUS_DST_ALPHA"] = 0x305] = "ONE_MINUS_DST_ALPHA";
    WebGLEnum[WebGLEnum["DST_COLOR"] = 0x306] = "DST_COLOR";
    WebGLEnum[WebGLEnum["ONE_MINUS_DST_COLOR"] = 0x307] = "ONE_MINUS_DST_COLOR";
    WebGLEnum[WebGLEnum["SRC_ALPHA_SATURATE"] = 0x308] = "SRC_ALPHA_SATURATE";
    WebGLEnum[WebGLEnum["FUNC_ADD"] = 0x8006] = "FUNC_ADD";
    WebGLEnum[WebGLEnum["FUNC_MIN"] = 0x8007] = "FUNC_MIN";
    WebGLEnum[WebGLEnum["FUNC_MAX"] = 0x8008] = "FUNC_MAX";
    WebGLEnum[WebGLEnum["BLEND_EQUATION"] = 0x8009] = "BLEND_EQUATION";
    WebGLEnum[WebGLEnum["BLEND_EQUATION_RGB"] = 0x8009] = "BLEND_EQUATION_RGB";
    WebGLEnum[WebGLEnum["BLEND_EQUATION_ALPHA"] = 0x883d] = "BLEND_EQUATION_ALPHA";
    WebGLEnum[WebGLEnum["FUNC_SUBTRACT"] = 0x800a] = "FUNC_SUBTRACT";
    WebGLEnum[WebGLEnum["FUNC_REVERSE_SUBTRACT"] = 0x800b] = "FUNC_REVERSE_SUBTRACT";
    WebGLEnum[WebGLEnum["BLEND_DST_RGB"] = 0x80c8] = "BLEND_DST_RGB";
    WebGLEnum[WebGLEnum["BLEND_SRC_RGB"] = 0x80c9] = "BLEND_SRC_RGB";
    WebGLEnum[WebGLEnum["BLEND_DST_ALPHA"] = 0x80ca] = "BLEND_DST_ALPHA";
    WebGLEnum[WebGLEnum["BLEND_SRC_ALPHA"] = 0x80cb] = "BLEND_SRC_ALPHA";
    WebGLEnum[WebGLEnum["CONSTANT_COLOR"] = 0x8001] = "CONSTANT_COLOR";
    WebGLEnum[WebGLEnum["ONE_MINUS_CONSTANT_COLOR"] = 0x8002] = "ONE_MINUS_CONSTANT_COLOR";
    WebGLEnum[WebGLEnum["CONSTANT_ALPHA"] = 0x8003] = "CONSTANT_ALPHA";
    WebGLEnum[WebGLEnum["ONE_MINUS_CONSTANT_ALPHA"] = 0x8004] = "ONE_MINUS_CONSTANT_ALPHA";
    WebGLEnum[WebGLEnum["BLEND_COLOR"] = 0x8005] = "BLEND_COLOR";
    WebGLEnum[WebGLEnum["ARRAY_BUFFER"] = 0x8892] = "ARRAY_BUFFER";
    WebGLEnum[WebGLEnum["ELEMENT_ARRAY_BUFFER"] = 0x8893] = "ELEMENT_ARRAY_BUFFER";
    WebGLEnum[WebGLEnum["ARRAY_BUFFER_BINDING"] = 0x8894] = "ARRAY_BUFFER_BINDING";
    WebGLEnum[WebGLEnum["ELEMENT_ARRAY_BUFFER_BINDING"] = 0x8895] = "ELEMENT_ARRAY_BUFFER_BINDING";
    WebGLEnum[WebGLEnum["STREAM_DRAW"] = 0x88e0] = "STREAM_DRAW";
    WebGLEnum[WebGLEnum["STATIC_DRAW"] = 0x88e4] = "STATIC_DRAW";
    WebGLEnum[WebGLEnum["DYNAMIC_DRAW"] = 0x88e8] = "DYNAMIC_DRAW";
    WebGLEnum[WebGLEnum["BUFFER_SIZE"] = 0x8764] = "BUFFER_SIZE";
    WebGLEnum[WebGLEnum["BUFFER_USAGE"] = 0x8765] = "BUFFER_USAGE";
    WebGLEnum[WebGLEnum["CURRENT_VERTEX_ATTRIB"] = 0x8626] = "CURRENT_VERTEX_ATTRIB";
    WebGLEnum[WebGLEnum["FRONT"] = 0x404] = "FRONT";
    WebGLEnum[WebGLEnum["BACK"] = 0x405] = "BACK";
    WebGLEnum[WebGLEnum["FRONT_AND_BACK"] = 0x408] = "FRONT_AND_BACK";
    WebGLEnum[WebGLEnum["TEXTURE_2D"] = 0xde1] = "TEXTURE_2D";
    WebGLEnum[WebGLEnum["CULL_FACE"] = 0xb44] = "CULL_FACE";
    WebGLEnum[WebGLEnum["BLEND"] = 0xbe2] = "BLEND";
    WebGLEnum[WebGLEnum["DITHER"] = 0xbd0] = "DITHER";
    WebGLEnum[WebGLEnum["STENCIL_TEST"] = 0xb90] = "STENCIL_TEST";
    WebGLEnum[WebGLEnum["DEPTH_TEST"] = 0xb71] = "DEPTH_TEST";
    WebGLEnum[WebGLEnum["SCISSOR_TEST"] = 0xc11] = "SCISSOR_TEST";
    WebGLEnum[WebGLEnum["POLYGON_OFFSET_FILL"] = 0x8037] = "POLYGON_OFFSET_FILL";
    WebGLEnum[WebGLEnum["SAMPLE_ALPHA_TO_COVERAGE"] = 0x809e] = "SAMPLE_ALPHA_TO_COVERAGE";
    WebGLEnum[WebGLEnum["SAMPLE_COVERAGE"] = 0x80a0] = "SAMPLE_COVERAGE";
    WebGLEnum[WebGLEnum["NO_ERROR"] = 0x0] = "NO_ERROR";
    WebGLEnum[WebGLEnum["INVALID_ENUM"] = 0x500] = "INVALID_ENUM";
    WebGLEnum[WebGLEnum["INVALID_VALUE"] = 0x501] = "INVALID_VALUE";
    WebGLEnum[WebGLEnum["INVALID_OPERATION"] = 0x502] = "INVALID_OPERATION";
    WebGLEnum[WebGLEnum["OUT_OF_MEMORY"] = 0x505] = "OUT_OF_MEMORY";
    WebGLEnum[WebGLEnum["CW"] = 0x900] = "CW";
    WebGLEnum[WebGLEnum["CCW"] = 0x901] = "CCW";
    WebGLEnum[WebGLEnum["LINE_WIDTH"] = 0xb21] = "LINE_WIDTH";
    WebGLEnum[WebGLEnum["ALIASED_POINT_SIZE_RANGE"] = 0x846d] = "ALIASED_POINT_SIZE_RANGE";
    WebGLEnum[WebGLEnum["ALIASED_LINE_WIDTH_RANGE"] = 0x846e] = "ALIASED_LINE_WIDTH_RANGE";
    WebGLEnum[WebGLEnum["CULL_FACE_MODE"] = 0xb45] = "CULL_FACE_MODE";
    WebGLEnum[WebGLEnum["FRONT_FACE"] = 0xb46] = "FRONT_FACE";
    WebGLEnum[WebGLEnum["DEPTH_RANGE"] = 0xb70] = "DEPTH_RANGE";
    WebGLEnum[WebGLEnum["DEPTH_WRITEMASK"] = 0xb72] = "DEPTH_WRITEMASK";
    WebGLEnum[WebGLEnum["DEPTH_CLEAR_VALUE"] = 0xb73] = "DEPTH_CLEAR_VALUE";
    WebGLEnum[WebGLEnum["DEPTH_FUNC"] = 0xb74] = "DEPTH_FUNC";
    WebGLEnum[WebGLEnum["STENCIL_CLEAR_VALUE"] = 0xb91] = "STENCIL_CLEAR_VALUE";
    WebGLEnum[WebGLEnum["STENCIL_FUNC"] = 0xb92] = "STENCIL_FUNC";
    WebGLEnum[WebGLEnum["STENCIL_FAIL"] = 0xb94] = "STENCIL_FAIL";
    WebGLEnum[WebGLEnum["STENCIL_PASS_DEPTH_FAIL"] = 0xb95] = "STENCIL_PASS_DEPTH_FAIL";
    WebGLEnum[WebGLEnum["STENCIL_PASS_DEPTH_PASS"] = 0xb96] = "STENCIL_PASS_DEPTH_PASS";
    WebGLEnum[WebGLEnum["STENCIL_REF"] = 0xb97] = "STENCIL_REF";
    WebGLEnum[WebGLEnum["STENCIL_VALUE_MASK"] = 0xb93] = "STENCIL_VALUE_MASK";
    WebGLEnum[WebGLEnum["STENCIL_WRITEMASK"] = 0xb98] = "STENCIL_WRITEMASK";
    WebGLEnum[WebGLEnum["STENCIL_BACK_FUNC"] = 0x8800] = "STENCIL_BACK_FUNC";
    WebGLEnum[WebGLEnum["STENCIL_BACK_FAIL"] = 0x8801] = "STENCIL_BACK_FAIL";
    WebGLEnum[WebGLEnum["STENCIL_BACK_PASS_DEPTH_FAIL"] = 0x8802] = "STENCIL_BACK_PASS_DEPTH_FAIL";
    WebGLEnum[WebGLEnum["STENCIL_BACK_PASS_DEPTH_PASS"] = 0x8803] = "STENCIL_BACK_PASS_DEPTH_PASS";
    WebGLEnum[WebGLEnum["STENCIL_BACK_REF"] = 0x8ca3] = "STENCIL_BACK_REF";
    WebGLEnum[WebGLEnum["STENCIL_BACK_VALUE_MASK"] = 0x8ca4] = "STENCIL_BACK_VALUE_MASK";
    WebGLEnum[WebGLEnum["STENCIL_BACK_WRITEMASK"] = 0x8ca5] = "STENCIL_BACK_WRITEMASK";
    WebGLEnum[WebGLEnum["VIEWPORT"] = 0xba2] = "VIEWPORT";
    WebGLEnum[WebGLEnum["SCISSOR_BOX"] = 0xc10] = "SCISSOR_BOX";
    WebGLEnum[WebGLEnum["COLOR_CLEAR_VALUE"] = 0xc22] = "COLOR_CLEAR_VALUE";
    WebGLEnum[WebGLEnum["COLOR_WRITEMASK"] = 0xc23] = "COLOR_WRITEMASK";
    WebGLEnum[WebGLEnum["UNPACK_ALIGNMENT"] = 0xcf5] = "UNPACK_ALIGNMENT";
    WebGLEnum[WebGLEnum["PACK_ALIGNMENT"] = 0xd05] = "PACK_ALIGNMENT";
    WebGLEnum[WebGLEnum["MAX_TEXTURE_SIZE"] = 0xd33] = "MAX_TEXTURE_SIZE";
    WebGLEnum[WebGLEnum["MAX_VIEWPORT_DIMS"] = 0xd3a] = "MAX_VIEWPORT_DIMS";
    WebGLEnum[WebGLEnum["SUBPIXEL_BITS"] = 0xd50] = "SUBPIXEL_BITS";
    WebGLEnum[WebGLEnum["RED_BITS"] = 0xd52] = "RED_BITS";
    WebGLEnum[WebGLEnum["GREEN_BITS"] = 0xd53] = "GREEN_BITS";
    WebGLEnum[WebGLEnum["BLUE_BITS"] = 0xd54] = "BLUE_BITS";
    WebGLEnum[WebGLEnum["ALPHA_BITS"] = 0xd55] = "ALPHA_BITS";
    WebGLEnum[WebGLEnum["DEPTH_BITS"] = 0xd56] = "DEPTH_BITS";
    WebGLEnum[WebGLEnum["STENCIL_BITS"] = 0xd57] = "STENCIL_BITS";
    WebGLEnum[WebGLEnum["POLYGON_OFFSET_UNITS"] = 0x2a00] = "POLYGON_OFFSET_UNITS";
    WebGLEnum[WebGLEnum["POLYGON_OFFSET_FACTOR"] = 0x8038] = "POLYGON_OFFSET_FACTOR";
    WebGLEnum[WebGLEnum["TEXTURE_BINDING_2D"] = 0x8069] = "TEXTURE_BINDING_2D";
    WebGLEnum[WebGLEnum["SAMPLE_BUFFERS"] = 0x80a8] = "SAMPLE_BUFFERS";
    WebGLEnum[WebGLEnum["SAMPLES"] = 0x80a9] = "SAMPLES";
    WebGLEnum[WebGLEnum["SAMPLE_COVERAGE_VALUE"] = 0x80aa] = "SAMPLE_COVERAGE_VALUE";
    WebGLEnum[WebGLEnum["SAMPLE_COVERAGE_INVERT"] = 0x80ab] = "SAMPLE_COVERAGE_INVERT";
    WebGLEnum[WebGLEnum["COMPRESSED_TEXTURE_FORMATS"] = 0x86a3] = "COMPRESSED_TEXTURE_FORMATS";
    WebGLEnum[WebGLEnum["DONT_CARE"] = 0x1100] = "DONT_CARE";
    WebGLEnum[WebGLEnum["FASTEST"] = 0x1101] = "FASTEST";
    WebGLEnum[WebGLEnum["NICEST"] = 0x1102] = "NICEST";
    WebGLEnum[WebGLEnum["GENERATE_MIPMAP_HINT"] = 0x8192] = "GENERATE_MIPMAP_HINT";
    WebGLEnum[WebGLEnum["BYTE"] = 0x1400] = "BYTE";
    WebGLEnum[WebGLEnum["UNSIGNED_BYTE"] = 0x1401] = "UNSIGNED_BYTE";
    WebGLEnum[WebGLEnum["SHORT"] = 0x1402] = "SHORT";
    WebGLEnum[WebGLEnum["UNSIGNED_SHORT"] = 0x1403] = "UNSIGNED_SHORT";
    WebGLEnum[WebGLEnum["INT"] = 0x1404] = "INT";
    WebGLEnum[WebGLEnum["UNSIGNED_INT"] = 0x1405] = "UNSIGNED_INT";
    WebGLEnum[WebGLEnum["FLOAT"] = 0x1406] = "FLOAT";
    WebGLEnum[WebGLEnum["DEPTH_COMPONENT"] = 0x1902] = "DEPTH_COMPONENT";
    WebGLEnum[WebGLEnum["ALPHA"] = 0x1906] = "ALPHA";
    WebGLEnum[WebGLEnum["RGB"] = 0x1907] = "RGB";
    WebGLEnum[WebGLEnum["RGBA"] = 0x1908] = "RGBA";
    WebGLEnum[WebGLEnum["LUMINANCE"] = 0x1909] = "LUMINANCE";
    WebGLEnum[WebGLEnum["LUMINANCE_ALPHA"] = 0x190a] = "LUMINANCE_ALPHA";
    WebGLEnum[WebGLEnum["UNSIGNED_SHORT_4_4_4_4"] = 0x8033] = "UNSIGNED_SHORT_4_4_4_4";
    WebGLEnum[WebGLEnum["UNSIGNED_SHORT_5_5_5_1"] = 0x8034] = "UNSIGNED_SHORT_5_5_5_1";
    WebGLEnum[WebGLEnum["UNSIGNED_SHORT_5_6_5"] = 0x8363] = "UNSIGNED_SHORT_5_6_5";
    WebGLEnum[WebGLEnum["FRAGMENT_SHADER"] = 0x8b30] = "FRAGMENT_SHADER";
    WebGLEnum[WebGLEnum["VERTEX_SHADER"] = 0x8b31] = "VERTEX_SHADER";
    WebGLEnum[WebGLEnum["MAX_VERTEX_ATTRIBS"] = 0x8869] = "MAX_VERTEX_ATTRIBS";
    WebGLEnum[WebGLEnum["MAX_VERTEX_UNIFORM_VECTORS"] = 0x8dfb] = "MAX_VERTEX_UNIFORM_VECTORS";
    WebGLEnum[WebGLEnum["MAX_VARYING_VECTORS"] = 0x8dfc] = "MAX_VARYING_VECTORS";
    WebGLEnum[WebGLEnum["MAX_COMBINED_TEXTURE_IMAGE_UNITS"] = 0x8b4d] = "MAX_COMBINED_TEXTURE_IMAGE_UNITS";
    WebGLEnum[WebGLEnum["MAX_VERTEX_TEXTURE_IMAGE_UNITS"] = 0x8b4c] = "MAX_VERTEX_TEXTURE_IMAGE_UNITS";
    WebGLEnum[WebGLEnum["MAX_TEXTURE_IMAGE_UNITS"] = 0x8872] = "MAX_TEXTURE_IMAGE_UNITS";
    WebGLEnum[WebGLEnum["MAX_FRAGMENT_UNIFORM_VECTORS"] = 0x8dfd] = "MAX_FRAGMENT_UNIFORM_VECTORS";
    WebGLEnum[WebGLEnum["SHADER_TYPE"] = 0x8b4f] = "SHADER_TYPE";
    WebGLEnum[WebGLEnum["DELETE_STATUS"] = 0x8b80] = "DELETE_STATUS";
    WebGLEnum[WebGLEnum["LINK_STATUS"] = 0x8b82] = "LINK_STATUS";
    WebGLEnum[WebGLEnum["VALIDATE_STATUS"] = 0x8b83] = "VALIDATE_STATUS";
    WebGLEnum[WebGLEnum["ATTACHED_SHADERS"] = 0x8b85] = "ATTACHED_SHADERS";
    WebGLEnum[WebGLEnum["ACTIVE_UNIFORMS"] = 0x8b86] = "ACTIVE_UNIFORMS";
    WebGLEnum[WebGLEnum["ACTIVE_ATTRIBUTES"] = 0x8b89] = "ACTIVE_ATTRIBUTES";
    WebGLEnum[WebGLEnum["SHADING_LANGUAGE_VERSION"] = 0x8b8c] = "SHADING_LANGUAGE_VERSION";
    WebGLEnum[WebGLEnum["CURRENT_PROGRAM"] = 0x8b8d] = "CURRENT_PROGRAM";
    WebGLEnum[WebGLEnum["NEVER"] = 0x200] = "NEVER";
    WebGLEnum[WebGLEnum["LESS"] = 0x201] = "LESS";
    WebGLEnum[WebGLEnum["EQUAL"] = 0x202] = "EQUAL";
    WebGLEnum[WebGLEnum["LEQUAL"] = 0x203] = "LEQUAL";
    WebGLEnum[WebGLEnum["GREATER"] = 0x204] = "GREATER";
    WebGLEnum[WebGLEnum["NOTEQUAL"] = 0x205] = "NOTEQUAL";
    WebGLEnum[WebGLEnum["GEQUAL"] = 0x206] = "GEQUAL";
    WebGLEnum[WebGLEnum["ALWAYS"] = 0x207] = "ALWAYS";
    WebGLEnum[WebGLEnum["KEEP"] = 0x1e00] = "KEEP";
    WebGLEnum[WebGLEnum["REPLACE"] = 0x1e01] = "REPLACE";
    WebGLEnum[WebGLEnum["INCR"] = 0x1e02] = "INCR";
    WebGLEnum[WebGLEnum["DECR"] = 0x1e03] = "DECR";
    WebGLEnum[WebGLEnum["INVERT"] = 0x150a] = "INVERT";
    WebGLEnum[WebGLEnum["INCR_WRAP"] = 0x8507] = "INCR_WRAP";
    WebGLEnum[WebGLEnum["DECR_WRAP"] = 0x8508] = "DECR_WRAP";
    WebGLEnum[WebGLEnum["VENDOR"] = 0x1f00] = "VENDOR";
    WebGLEnum[WebGLEnum["RENDERER"] = 0x1f01] = "RENDERER";
    WebGLEnum[WebGLEnum["VERSION"] = 0x1f02] = "VERSION";
    WebGLEnum[WebGLEnum["NEAREST"] = 0x2600] = "NEAREST";
    WebGLEnum[WebGLEnum["LINEAR"] = 0x2601] = "LINEAR";
    WebGLEnum[WebGLEnum["NEAREST_MIPMAP_NEAREST"] = 0x2700] = "NEAREST_MIPMAP_NEAREST";
    WebGLEnum[WebGLEnum["LINEAR_MIPMAP_NEAREST"] = 0x2701] = "LINEAR_MIPMAP_NEAREST";
    WebGLEnum[WebGLEnum["NEAREST_MIPMAP_LINEAR"] = 0x2702] = "NEAREST_MIPMAP_LINEAR";
    WebGLEnum[WebGLEnum["LINEAR_MIPMAP_LINEAR"] = 0x2703] = "LINEAR_MIPMAP_LINEAR";
    WebGLEnum[WebGLEnum["TEXTURE_MAG_FILTER"] = 0x2800] = "TEXTURE_MAG_FILTER";
    WebGLEnum[WebGLEnum["TEXTURE_MIN_FILTER"] = 0x2801] = "TEXTURE_MIN_FILTER";
    WebGLEnum[WebGLEnum["TEXTURE_WRAP_S"] = 0x2802] = "TEXTURE_WRAP_S";
    WebGLEnum[WebGLEnum["TEXTURE_WRAP_T"] = 0x2803] = "TEXTURE_WRAP_T";
    WebGLEnum[WebGLEnum["TEXTURE"] = 0x1702] = "TEXTURE";
    WebGLEnum[WebGLEnum["TEXTURE_CUBE_MAP"] = 0x8513] = "TEXTURE_CUBE_MAP";
    WebGLEnum[WebGLEnum["TEXTURE_BINDING_CUBE_MAP"] = 0x8514] = "TEXTURE_BINDING_CUBE_MAP";
    WebGLEnum[WebGLEnum["TEXTURE_CUBE_MAP_POSITIVE_X"] = 0x8515] = "TEXTURE_CUBE_MAP_POSITIVE_X";
    WebGLEnum[WebGLEnum["TEXTURE_CUBE_MAP_NEGATIVE_X"] = 0x8516] = "TEXTURE_CUBE_MAP_NEGATIVE_X";
    WebGLEnum[WebGLEnum["TEXTURE_CUBE_MAP_POSITIVE_Y"] = 0x8517] = "TEXTURE_CUBE_MAP_POSITIVE_Y";
    WebGLEnum[WebGLEnum["TEXTURE_CUBE_MAP_NEGATIVE_Y"] = 0x8518] = "TEXTURE_CUBE_MAP_NEGATIVE_Y";
    WebGLEnum[WebGLEnum["TEXTURE_CUBE_MAP_POSITIVE_Z"] = 0x8519] = "TEXTURE_CUBE_MAP_POSITIVE_Z";
    WebGLEnum[WebGLEnum["TEXTURE_CUBE_MAP_NEGATIVE_Z"] = 0x851a] = "TEXTURE_CUBE_MAP_NEGATIVE_Z";
    WebGLEnum[WebGLEnum["MAX_CUBE_MAP_TEXTURE_SIZE"] = 0x851c] = "MAX_CUBE_MAP_TEXTURE_SIZE";
    WebGLEnum[WebGLEnum["TEXTURE0"] = 0x84c0] = "TEXTURE0";
    WebGLEnum[WebGLEnum["TEXTURE1"] = 0x84c1] = "TEXTURE1";
    WebGLEnum[WebGLEnum["TEXTURE2"] = 0x84c2] = "TEXTURE2";
    WebGLEnum[WebGLEnum["TEXTURE3"] = 0x84c3] = "TEXTURE3";
    WebGLEnum[WebGLEnum["TEXTURE4"] = 0x84c4] = "TEXTURE4";
    WebGLEnum[WebGLEnum["TEXTURE5"] = 0x84c5] = "TEXTURE5";
    WebGLEnum[WebGLEnum["TEXTURE6"] = 0x84c6] = "TEXTURE6";
    WebGLEnum[WebGLEnum["TEXTURE7"] = 0x84c7] = "TEXTURE7";
    WebGLEnum[WebGLEnum["TEXTURE8"] = 0x84c8] = "TEXTURE8";
    WebGLEnum[WebGLEnum["TEXTURE9"] = 0x84c9] = "TEXTURE9";
    WebGLEnum[WebGLEnum["TEXTURE10"] = 0x84ca] = "TEXTURE10";
    WebGLEnum[WebGLEnum["TEXTURE11"] = 0x84cb] = "TEXTURE11";
    WebGLEnum[WebGLEnum["TEXTURE12"] = 0x84cc] = "TEXTURE12";
    WebGLEnum[WebGLEnum["TEXTURE13"] = 0x84cd] = "TEXTURE13";
    WebGLEnum[WebGLEnum["TEXTURE14"] = 0x84ce] = "TEXTURE14";
    WebGLEnum[WebGLEnum["TEXTURE15"] = 0x84cf] = "TEXTURE15";
    WebGLEnum[WebGLEnum["TEXTURE16"] = 0x84d0] = "TEXTURE16";
    WebGLEnum[WebGLEnum["TEXTURE17"] = 0x84d1] = "TEXTURE17";
    WebGLEnum[WebGLEnum["TEXTURE18"] = 0x84d2] = "TEXTURE18";
    WebGLEnum[WebGLEnum["TEXTURE19"] = 0x84d3] = "TEXTURE19";
    WebGLEnum[WebGLEnum["TEXTURE20"] = 0x84d4] = "TEXTURE20";
    WebGLEnum[WebGLEnum["TEXTURE21"] = 0x84d5] = "TEXTURE21";
    WebGLEnum[WebGLEnum["TEXTURE22"] = 0x84d6] = "TEXTURE22";
    WebGLEnum[WebGLEnum["TEXTURE23"] = 0x84d7] = "TEXTURE23";
    WebGLEnum[WebGLEnum["TEXTURE24"] = 0x84d8] = "TEXTURE24";
    WebGLEnum[WebGLEnum["TEXTURE25"] = 0x84d9] = "TEXTURE25";
    WebGLEnum[WebGLEnum["TEXTURE26"] = 0x84da] = "TEXTURE26";
    WebGLEnum[WebGLEnum["TEXTURE27"] = 0x84db] = "TEXTURE27";
    WebGLEnum[WebGLEnum["TEXTURE28"] = 0x84dc] = "TEXTURE28";
    WebGLEnum[WebGLEnum["TEXTURE29"] = 0x84dd] = "TEXTURE29";
    WebGLEnum[WebGLEnum["TEXTURE30"] = 0x84de] = "TEXTURE30";
    WebGLEnum[WebGLEnum["TEXTURE31"] = 0x84df] = "TEXTURE31";
    WebGLEnum[WebGLEnum["ACTIVE_TEXTURE"] = 0x84e0] = "ACTIVE_TEXTURE";
    WebGLEnum[WebGLEnum["REPEAT"] = 0x2901] = "REPEAT";
    WebGLEnum[WebGLEnum["CLAMP_TO_EDGE"] = 0x812f] = "CLAMP_TO_EDGE";
    WebGLEnum[WebGLEnum["MIRRORED_REPEAT"] = 0x8370] = "MIRRORED_REPEAT";
    WebGLEnum[WebGLEnum["FLOAT_VEC2"] = 0x8b50] = "FLOAT_VEC2";
    WebGLEnum[WebGLEnum["FLOAT_VEC3"] = 0x8b51] = "FLOAT_VEC3";
    WebGLEnum[WebGLEnum["FLOAT_VEC4"] = 0x8b52] = "FLOAT_VEC4";
    WebGLEnum[WebGLEnum["INT_VEC2"] = 0x8b53] = "INT_VEC2";
    WebGLEnum[WebGLEnum["INT_VEC3"] = 0x8b54] = "INT_VEC3";
    WebGLEnum[WebGLEnum["INT_VEC4"] = 0x8b55] = "INT_VEC4";
    WebGLEnum[WebGLEnum["BOOL"] = 0x8b56] = "BOOL";
    WebGLEnum[WebGLEnum["BOOL_VEC2"] = 0x8b57] = "BOOL_VEC2";
    WebGLEnum[WebGLEnum["BOOL_VEC3"] = 0x8b58] = "BOOL_VEC3";
    WebGLEnum[WebGLEnum["BOOL_VEC4"] = 0x8b59] = "BOOL_VEC4";
    WebGLEnum[WebGLEnum["FLOAT_MAT2"] = 0x8b5a] = "FLOAT_MAT2";
    WebGLEnum[WebGLEnum["FLOAT_MAT3"] = 0x8b5b] = "FLOAT_MAT3";
    WebGLEnum[WebGLEnum["FLOAT_MAT4"] = 0x8b5c] = "FLOAT_MAT4";
    WebGLEnum[WebGLEnum["SAMPLER_2D"] = 0x8b5e] = "SAMPLER_2D";
    WebGLEnum[WebGLEnum["SAMPLER_CUBE"] = 0x8b60] = "SAMPLER_CUBE";
    WebGLEnum[WebGLEnum["VERTEX_ATTRIB_ARRAY_ENABLED"] = 0x8622] = "VERTEX_ATTRIB_ARRAY_ENABLED";
    WebGLEnum[WebGLEnum["VERTEX_ATTRIB_ARRAY_SIZE"] = 0x8623] = "VERTEX_ATTRIB_ARRAY_SIZE";
    WebGLEnum[WebGLEnum["VERTEX_ATTRIB_ARRAY_STRIDE"] = 0x8624] = "VERTEX_ATTRIB_ARRAY_STRIDE";
    WebGLEnum[WebGLEnum["VERTEX_ATTRIB_ARRAY_TYPE"] = 0x8625] = "VERTEX_ATTRIB_ARRAY_TYPE";
    WebGLEnum[WebGLEnum["VERTEX_ATTRIB_ARRAY_NORMALIZED"] = 0x886a] = "VERTEX_ATTRIB_ARRAY_NORMALIZED";
    WebGLEnum[WebGLEnum["VERTEX_ATTRIB_ARRAY_POINTER"] = 0x8645] = "VERTEX_ATTRIB_ARRAY_POINTER";
    WebGLEnum[WebGLEnum["VERTEX_ATTRIB_ARRAY_BUFFER_BINDING"] = 0x889f] = "VERTEX_ATTRIB_ARRAY_BUFFER_BINDING";
    WebGLEnum[WebGLEnum["IMPLEMENTATION_COLOR_READ_TYPE"] = 0x8b9a] = "IMPLEMENTATION_COLOR_READ_TYPE";
    WebGLEnum[WebGLEnum["IMPLEMENTATION_COLOR_READ_FORMAT"] = 0x8b9b] = "IMPLEMENTATION_COLOR_READ_FORMAT";
    WebGLEnum[WebGLEnum["COMPILE_STATUS"] = 0x8b81] = "COMPILE_STATUS";
    WebGLEnum[WebGLEnum["LOW_FLOAT"] = 0x8df0] = "LOW_FLOAT";
    WebGLEnum[WebGLEnum["MEDIUM_FLOAT"] = 0x8df1] = "MEDIUM_FLOAT";
    WebGLEnum[WebGLEnum["HIGH_FLOAT"] = 0x8df2] = "HIGH_FLOAT";
    WebGLEnum[WebGLEnum["LOW_INT"] = 0x8df3] = "LOW_INT";
    WebGLEnum[WebGLEnum["MEDIUM_INT"] = 0x8df4] = "MEDIUM_INT";
    WebGLEnum[WebGLEnum["HIGH_INT"] = 0x8df5] = "HIGH_INT";
    WebGLEnum[WebGLEnum["FRAMEBUFFER"] = 0x8d40] = "FRAMEBUFFER";
    WebGLEnum[WebGLEnum["RENDERBUFFER"] = 0x8d41] = "RENDERBUFFER";
    WebGLEnum[WebGLEnum["RGBA4"] = 0x8056] = "RGBA4";
    WebGLEnum[WebGLEnum["RGB5_A1"] = 0x8057] = "RGB5_A1";
    WebGLEnum[WebGLEnum["RGB565"] = 0x8d62] = "RGB565";
    WebGLEnum[WebGLEnum["DEPTH_COMPONENT16"] = 0x81a5] = "DEPTH_COMPONENT16";
    WebGLEnum[WebGLEnum["STENCIL_INDEX8"] = 0x8d48] = "STENCIL_INDEX8";
    WebGLEnum[WebGLEnum["DEPTH_STENCIL"] = 0x84f9] = "DEPTH_STENCIL";
    WebGLEnum[WebGLEnum["RENDERBUFFER_WIDTH"] = 0x8d42] = "RENDERBUFFER_WIDTH";
    WebGLEnum[WebGLEnum["RENDERBUFFER_HEIGHT"] = 0x8d43] = "RENDERBUFFER_HEIGHT";
    WebGLEnum[WebGLEnum["RENDERBUFFER_INTERNAL_FORMAT"] = 0x8d44] = "RENDERBUFFER_INTERNAL_FORMAT";
    WebGLEnum[WebGLEnum["RENDERBUFFER_RED_SIZE"] = 0x8d50] = "RENDERBUFFER_RED_SIZE";
    WebGLEnum[WebGLEnum["RENDERBUFFER_GREEN_SIZE"] = 0x8d51] = "RENDERBUFFER_GREEN_SIZE";
    WebGLEnum[WebGLEnum["RENDERBUFFER_BLUE_SIZE"] = 0x8d52] = "RENDERBUFFER_BLUE_SIZE";
    WebGLEnum[WebGLEnum["RENDERBUFFER_ALPHA_SIZE"] = 0x8d53] = "RENDERBUFFER_ALPHA_SIZE";
    WebGLEnum[WebGLEnum["RENDERBUFFER_DEPTH_SIZE"] = 0x8d54] = "RENDERBUFFER_DEPTH_SIZE";
    WebGLEnum[WebGLEnum["RENDERBUFFER_STENCIL_SIZE"] = 0x8d55] = "RENDERBUFFER_STENCIL_SIZE";
    WebGLEnum[WebGLEnum["FRAMEBUFFER_ATTACHMENT_OBJECT_TYPE"] = 0x8cd0] = "FRAMEBUFFER_ATTACHMENT_OBJECT_TYPE";
    WebGLEnum[WebGLEnum["FRAMEBUFFER_ATTACHMENT_OBJECT_NAME"] = 0x8cd1] = "FRAMEBUFFER_ATTACHMENT_OBJECT_NAME";
    WebGLEnum[WebGLEnum["FRAMEBUFFER_ATTACHMENT_TEXTURE_LEVEL"] = 0x8cd2] = "FRAMEBUFFER_ATTACHMENT_TEXTURE_LEVEL";
    WebGLEnum[WebGLEnum["FRAMEBUFFER_ATTACHMENT_TEXTURE_CUBE_MAP_FACE"] = 0x8cd3] = "FRAMEBUFFER_ATTACHMENT_TEXTURE_CUBE_MAP_FACE";
    WebGLEnum[WebGLEnum["COLOR_ATTACHMENT0"] = 0x8ce0] = "COLOR_ATTACHMENT0";
    WebGLEnum[WebGLEnum["DEPTH_ATTACHMENT"] = 0x8d00] = "DEPTH_ATTACHMENT";
    WebGLEnum[WebGLEnum["STENCIL_ATTACHMENT"] = 0x8d20] = "STENCIL_ATTACHMENT";
    WebGLEnum[WebGLEnum["DEPTH_STENCIL_ATTACHMENT"] = 0x821a] = "DEPTH_STENCIL_ATTACHMENT";
    WebGLEnum[WebGLEnum["NONE"] = 0x0] = "NONE";
    WebGLEnum[WebGLEnum["FRAMEBUFFER_COMPLETE"] = 0x8cd5] = "FRAMEBUFFER_COMPLETE";
    WebGLEnum[WebGLEnum["FRAMEBUFFER_INCOMPLETE_ATTACHMENT"] = 0x8cd6] = "FRAMEBUFFER_INCOMPLETE_ATTACHMENT";
    WebGLEnum[WebGLEnum["FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT"] = 0x8cd7] = "FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT";
    WebGLEnum[WebGLEnum["FRAMEBUFFER_INCOMPLETE_DIMENSIONS"] = 0x8cd9] = "FRAMEBUFFER_INCOMPLETE_DIMENSIONS";
    WebGLEnum[WebGLEnum["FRAMEBUFFER_UNSUPPORTED"] = 0x8cdd] = "FRAMEBUFFER_UNSUPPORTED";
    WebGLEnum[WebGLEnum["FRAMEBUFFER_BINDING"] = 0x8ca6] = "FRAMEBUFFER_BINDING";
    WebGLEnum[WebGLEnum["RENDERBUFFER_BINDING"] = 0x8ca7] = "RENDERBUFFER_BINDING";
    WebGLEnum[WebGLEnum["MAX_RENDERBUFFER_SIZE"] = 0x84e8] = "MAX_RENDERBUFFER_SIZE";
    WebGLEnum[WebGLEnum["INVALID_FRAMEBUFFER_OPERATION"] = 0x506] = "INVALID_FRAMEBUFFER_OPERATION";
    WebGLEnum[WebGLEnum["UNPACK_FLIP_Y_WEBGL"] = 0x9240] = "UNPACK_FLIP_Y_WEBGL";
    WebGLEnum[WebGLEnum["UNPACK_PREMULTIPLY_ALPHA_WEBGL"] = 0x9241] = "UNPACK_PREMULTIPLY_ALPHA_WEBGL";
    WebGLEnum[WebGLEnum["CONTEXT_LOST_WEBGL"] = 0x9242] = "CONTEXT_LOST_WEBGL";
    WebGLEnum[WebGLEnum["UNPACK_COLORSPACE_CONVERSION_WEBGL"] = 0x9243] = "UNPACK_COLORSPACE_CONVERSION_WEBGL";
    WebGLEnum[WebGLEnum["BROWSER_DEFAULT_WEBGL"] = 0x9244] = "BROWSER_DEFAULT_WEBGL";
    WebGLEnum[WebGLEnum["TEXTURE_MAX_ANISOTROPY"] = 0x84fe] = "TEXTURE_MAX_ANISOTROPY";
    WebGLEnum[WebGLEnum["MAX_TEXTURE_MAX_ANISOTROPY"] = 0x84ff] = "MAX_TEXTURE_MAX_ANISOTROPY";
})(WebGLEnum || (WebGLEnum = {}));

function isWebGL2(gl) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return !!(gl && gl.texStorage2D);
}
class WebGLError extends Error {
    static errorToString = {
        [WebGLEnum.NO_ERROR]: 'NO_ERROR',
        [WebGLEnum.INVALID_ENUM]: 'INVALID_ENUM',
        [WebGLEnum.INVALID_VALUE]: 'INVALID_VALUE',
        [WebGLEnum.INVALID_OPERATION]: 'INVALID_OPERATION',
        [WebGLEnum.INVALID_FRAMEBUFFER_OPERATION]: 'INVALID_FRAMEBUFFER_OPERATION',
        [WebGLEnum.OUT_OF_MEMORY]: 'OUT_OF_MEMORY',
        [WebGLEnum.CONTEXT_LOST_WEBGL]: 'CONTEXT_LOST_WEBGL'
    };
    code;
    constructor(code){
        super(WebGLError.errorToString[code]);
        this.code = code;
    }
}

const blendEquationMap = {
    add: WebGLEnum.FUNC_ADD,
    subtract: WebGLEnum.FUNC_SUBTRACT,
    'reverse-subtract': WebGLEnum.FUNC_REVERSE_SUBTRACT,
    max: WebGLEnum.FUNC_MAX,
    min: WebGLEnum.FUNC_MIN
};
const blendEquationInvMap = {
    [WebGLEnum.FUNC_ADD]: 'add',
    [WebGLEnum.FUNC_SUBTRACT]: 'subtract',
    [WebGLEnum.FUNC_REVERSE_SUBTRACT]: 'reverse-subtract',
    [WebGLEnum.FUNC_MAX]: 'max',
    [WebGLEnum.FUNC_MIN]: 'min'
};
const blendFuncMap = {
    zero: WebGLEnum.ZERO,
    one: WebGLEnum.ONE,
    'src-alpha': WebGLEnum.SRC_ALPHA,
    'inv-src-alpha': WebGLEnum.ONE_MINUS_SRC_ALPHA,
    'src-alpha-saturate': WebGLEnum.BLEND,
    'dst-alpha': WebGLEnum.DST_ALPHA,
    'inv-dst-alpha': WebGLEnum.ONE_MINUS_DST_ALPHA,
    'src-color': WebGLEnum.SRC_COLOR,
    'inv-src-color': WebGLEnum.ONE_MINUS_SRC_COLOR,
    'dst-color': WebGLEnum.DST_COLOR,
    'inv-dst-color': WebGLEnum.ONE_MINUS_DST_COLOR,
    'const-color': WebGLEnum.CONSTANT_COLOR,
    'inv-const-color': WebGLEnum.ONE_MINUS_CONSTANT_COLOR,
    'const-alpha': WebGLEnum.CONSTANT_ALPHA,
    'inv-const-alpha': WebGLEnum.ONE_MINUS_CONSTANT_ALPHA
};
const blendFuncInvMap = {
    [WebGLEnum.ZERO]: 'zero',
    [WebGLEnum.ONE]: 'one',
    [WebGLEnum.SRC_ALPHA]: 'src-alpha',
    [WebGLEnum.ONE_MINUS_SRC_ALPHA]: 'inv-src-alpha',
    [WebGLEnum.SRC_ALPHA_SATURATE]: 'src-alpha-saturate',
    [WebGLEnum.DST_ALPHA]: 'dst-alpha',
    [WebGLEnum.ONE_MINUS_DST_ALPHA]: 'inv-dst-alpha',
    [WebGLEnum.SRC_COLOR]: 'src-color',
    [WebGLEnum.ONE_MINUS_SRC_COLOR]: 'inv-src-color',
    [WebGLEnum.DST_COLOR]: 'dst-color',
    [WebGLEnum.ONE_MINUS_DST_COLOR]: 'inv-dst-color',
    [WebGLEnum.CONSTANT_COLOR]: 'const-color',
    [WebGLEnum.ONE_MINUS_CONSTANT_COLOR]: 'inv-const-color',
    [WebGLEnum.CONSTANT_ALPHA]: 'const-alpha',
    [WebGLEnum.ONE_MINUS_CONSTANT_ALPHA]: 'inv-const-alpha'
};
const faceModeMap = {
    none: WebGLEnum.NONE,
    front: WebGLEnum.FRONT,
    back: WebGLEnum.BACK
};
const faceModeInvMap = {
    [WebGLEnum.NONE]: 'none',
    [WebGLEnum.FRONT]: 'front',
    [WebGLEnum.BACK]: 'back'
};
({
    cw: WebGLEnum.CW,
    ccw: WebGLEnum.CCW
});
({
    [WebGLEnum.CW]: 'cw',
    [WebGLEnum.CCW]: 'ccw'
});
const stencilOpMap = {
    keep: WebGLEnum.KEEP,
    zero: WebGLEnum.ZERO,
    replace: WebGLEnum.REPLACE,
    incr: WebGLEnum.INCR,
    'incr-wrap': WebGLEnum.INCR_WRAP,
    decr: WebGLEnum.DECR,
    'decr-wrap': WebGLEnum.DECR_WRAP,
    invert: WebGLEnum.INVERT
};
const stencilOpInvMap = {
    [WebGLEnum.KEEP]: 'keep',
    [WebGLEnum.ZERO]: 'zero',
    [WebGLEnum.REPLACE]: 'replace',
    [WebGLEnum.INCR]: 'incr',
    [WebGLEnum.INCR_WRAP]: 'incr-wrap',
    [WebGLEnum.DECR]: 'decr',
    [WebGLEnum.DECR_WRAP]: 'decr-wrap',
    [WebGLEnum.INVERT]: 'invert'
};
const compareFuncMap = {
    always: WebGLEnum.ALWAYS,
    le: WebGLEnum.LEQUAL,
    ge: WebGLEnum.GEQUAL,
    lt: WebGLEnum.LESS,
    gt: WebGLEnum.GREATER,
    eq: WebGLEnum.EQUAL,
    ne: WebGLEnum.NOTEQUAL,
    never: WebGLEnum.NEVER
};
const compareFuncInvMap = {
    [WebGLEnum.NONE]: null,
    [WebGLEnum.ALWAYS]: 'always',
    [WebGLEnum.LEQUAL]: 'le',
    [WebGLEnum.GEQUAL]: 'ge',
    [WebGLEnum.LESS]: 'lt',
    [WebGLEnum.GREATER]: 'gt',
    [WebGLEnum.EQUAL]: 'eq',
    [WebGLEnum.NOTEQUAL]: 'ne',
    [WebGLEnum.NEVER]: 'never'
};
const textureWrappingMap = {
    repeat: WebGLEnum.REPEAT,
    'mirrored-repeat': WebGLEnum.MIRRORED_REPEAT,
    clamp: WebGLEnum.CLAMP_TO_EDGE
};
const typeMap = {
    [PBPrimitiveType.BOOL]: WebGLEnum.BOOL,
    [PBPrimitiveType.BVEC2]: WebGLEnum.BOOL_VEC2,
    [PBPrimitiveType.BVEC3]: WebGLEnum.BOOL_VEC3,
    [PBPrimitiveType.BVEC4]: WebGLEnum.BOOL_VEC4,
    [PBPrimitiveType.F32]: WebGLEnum.FLOAT,
    [PBPrimitiveType.F32VEC2]: WebGLEnum.FLOAT_VEC2,
    [PBPrimitiveType.F32VEC3]: WebGLEnum.FLOAT_VEC3,
    [PBPrimitiveType.F32VEC4]: WebGLEnum.FLOAT_VEC4,
    [PBPrimitiveType.I8]: WebGLEnum.BYTE,
    [PBPrimitiveType.I16]: WebGLEnum.SHORT,
    [PBPrimitiveType.I32]: WebGLEnum.INT,
    [PBPrimitiveType.I32VEC2]: WebGLEnum.INT_VEC2,
    [PBPrimitiveType.I32VEC3]: WebGLEnum.INT_VEC3,
    [PBPrimitiveType.I32VEC4]: WebGLEnum.INT_VEC4,
    [PBPrimitiveType.U8]: WebGLEnum.UNSIGNED_BYTE,
    [PBPrimitiveType.U8_NORM]: WebGLEnum.UNSIGNED_BYTE,
    [PBPrimitiveType.I8_NORM]: WebGLEnum.BYTE,
    [PBPrimitiveType.U16]: WebGLEnum.UNSIGNED_SHORT,
    [PBPrimitiveType.U16_NORM]: WebGLEnum.UNSIGNED_SHORT,
    [PBPrimitiveType.I16_NORM]: WebGLEnum.SHORT,
    [PBPrimitiveType.U32]: WebGLEnum.UNSIGNED_INT,
    [PBPrimitiveType.U32VEC2]: WebGLEnum.UNSIGNED_INT_VEC2,
    [PBPrimitiveType.U32VEC3]: WebGLEnum.UNSIGNED_INT_VEC3,
    [PBPrimitiveType.U32VEC4]: WebGLEnum.UNSIGNED_INT_VEC4
};
const primitiveTypeMap = {
    'triangle-list': WebGLEnum.TRIANGLES,
    'triangle-strip': WebGLEnum.TRIANGLE_STRIP,
    'triangle-fan': WebGLEnum.TRIANGLE_FAN,
    'line-list': WebGLEnum.LINES,
    'line-strip': WebGLEnum.LINE_STRIP,
    'point-list': WebGLEnum.POINTS
};
const textureTargetMap = {
    '2d': WebGLEnum.TEXTURE_2D,
    '3d': WebGLEnum.TEXTURE_3D,
    cube: WebGLEnum.TEXTURE_CUBE_MAP,
    '2darray': WebGLEnum.TEXTURE_2D_ARRAY
};
const cubeMapFaceMap = {
    [CubeFace.PX]: WebGLEnum.TEXTURE_CUBE_MAP_POSITIVE_X,
    [CubeFace.NX]: WebGLEnum.TEXTURE_CUBE_MAP_NEGATIVE_X,
    [CubeFace.PY]: WebGLEnum.TEXTURE_CUBE_MAP_POSITIVE_Y,
    [CubeFace.NY]: WebGLEnum.TEXTURE_CUBE_MAP_NEGATIVE_Y,
    [CubeFace.PZ]: WebGLEnum.TEXTURE_CUBE_MAP_POSITIVE_Z,
    [CubeFace.NZ]: WebGLEnum.TEXTURE_CUBE_MAP_NEGATIVE_Z
};
function textureMagFilterToWebGL(magFilter) {
    switch(magFilter){
        case 'nearest':
            return WebGLEnum.NEAREST;
        case 'linear':
            return WebGLEnum.LINEAR;
        default:
            return WebGLEnum.NONE;
    }
}
function textureMinFilterToWebGL(minFilter, mipFilter) {
    switch(minFilter){
        case 'nearest':
            switch(mipFilter){
                case 'none':
                    return WebGLEnum.NEAREST;
                case 'nearest':
                    return WebGLEnum.NEAREST_MIPMAP_NEAREST;
                case 'linear':
                    return WebGLEnum.NEAREST_MIPMAP_LINEAR;
            }
            break;
        case 'linear':
            switch(mipFilter){
                case 'none':
                    return WebGLEnum.LINEAR;
                case 'nearest':
                    return WebGLEnum.LINEAR_MIPMAP_NEAREST;
                case 'linear':
                    return WebGLEnum.LINEAR_MIPMAP_LINEAR;
            }
            break;
    }
    return WebGLEnum.NONE;
}

let _uniqueId = 0;
class WebGLGPUObject extends makeEventTarget(Object)() {
    _device;
    _object;
    _uid;
    _cid;
    _name;
    _restoreHandler;
    constructor(device){
        super();
        this._device = device;
        this._object = null;
        this._uid = ++_uniqueId;
        this._cid = 1;
        this._name = `${genDefaultName(this)}#${this._uid}`;
        this._restoreHandler = null;
        this._device.addGPUObject(this);
    }
    get device() {
        return this._device;
    }
    get object() {
        return this._object;
    }
    get disposed() {
        return !this._object;
    }
    get restoreHandler() {
        return this._restoreHandler;
    }
    set restoreHandler(handler) {
        this._restoreHandler = handler;
    }
    get uid() {
        return this._uid;
    }
    get cid() {
        return this._cid;
    }
    get name() {
        return this._name;
    }
    set name(val) {
        if (val !== this._name) {
            const evt = new DeviceGPUObjectRenameEvent(this, this._name);
            this._name = val;
            this._device.dispatchEvent(evt);
        }
    }
    isVertexLayout() {
        return false;
    }
    isFramebuffer() {
        return false;
    }
    isSampler() {
        return false;
    }
    isTexture() {
        return false;
    }
    isTexture2D() {
        return false;
    }
    isTexture2DArray() {
        return false;
    }
    isTexture3D() {
        return false;
    }
    isTextureCube() {
        return false;
    }
    isTextureVideo() {
        return false;
    }
    isProgram() {
        return false;
    }
    isBuffer() {
        return false;
    }
    isBindGroup() {
        return false;
    }
    dispose() {
        if (!this.disposed) {
            this._device.disposeObject(this, true);
        }
    }
    async reload() {
        if (this.disposed) {
            const p = this._device.restoreObject(this);
            this._cid++;
            return p;
        }
    }
    destroy() {
        throw new Error('Abstract function call: destroy()');
    }
    async restore() {
        throw new Error('Abstract function call: restore()');
    }
}

class WebGLBaseTexture extends WebGLGPUObject {
    _target;
    _memCost;
    _flags;
    _width;
    _height;
    _depth;
    _format;
    _mipLevelCount;
    _samplerOptions;
    _webgl1fallback;
    constructor(device, target){
        super(device);
        this._target = target || '2d';
        this._memCost = 0;
        this._flags = 0;
        this._width = 0;
        this._height = 0;
        this._depth = 1;
        this._format = 'unknown';
        this._mipLevelCount = 0;
        this._samplerOptions = null;
        this._webgl1fallback = false;
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
    get format() {
        return this._format;
    }
    get mipLevelCount() {
        return this._mipLevelCount;
    }
    get samplerOptions() {
        return this._samplerOptions;
    }
    set samplerOptions(options) {
        const params = this.getTextureCaps().getTextureFormatInfo(this._format);
        this._samplerOptions = options ? Object.assign({}, this._getSamplerOptions(params, !!options.compare), options) : null;
    }
    get isWebGL1Fallback() {
        return this._webgl1fallback;
    }
    isFilterable() {
        if (!this.getTextureCaps().getTextureFormatInfo(this._format)?.filterable) {
            return false;
        }
        if (!this.device.isWebGL2 && !isPowerOf2(this._width) && !isPowerOf2(this._height)) {
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
            this._memCost = 0;
        }
    }
    async restore() {
        if (!this._object && !this._device.isContextLost()) {
            this.init();
        }
    }
    isTexture() {
        return true;
    }
    getTextureCaps() {
        return this._device.getDeviceCaps().textureCaps;
    }
    isSRGBFormat() {
        return isSRGBTextureFormat(this._format);
    }
    isFloatFormat() {
        return isFloatTextureFormat(this._format);
    }
    isIntegerFormat() {
        return isIntegerTextureFormat(this._format);
    }
    isSignedFormat() {
        return isSignedTextureFormat(this._format);
    }
    isCompressedFormat() {
        return isCompressedTextureFormat(this._format);
    }
    isDepth() {
        return hasDepthChannel(this._format);
    }
    getDefaultSampler(shadow) {
        const params = this.getTextureCaps().getTextureFormatInfo(this._format);
        return this._device.createSampler(!this._samplerOptions || !this._samplerOptions.compare !== !shadow ? this._getSamplerOptions(params, shadow) : this._samplerOptions);
    }
    /** @internal */ allocInternal(format, width, height, depth, numMipLevels) {
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
        if (this._object && (this._format !== format || this._width !== width || this._height !== height || this._depth !== depth, this._mipLevelCount !== numMipLevels)) {
            const obj = this._object;
            this._device.runNextFrame(()=>{
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
                const params = this.getTextureCaps().getTextureFormatInfo(this._format);
                if (isWebGL2(gl) && !this.isTextureVideo()) {
                    if (!this.isTexture3D() && !this.isTexture2DArray()) {
                        gl.texStorage2D(textureTargetMap[this._target], this._mipLevelCount, params.glInternalFormat, this._width, this._height);
                    } else {
                        gl.texStorage3D(textureTargetMap[this._target], this._mipLevelCount, params.glInternalFormat, this._width, this._height, this._depth);
                    }
                    this._device.context.texParameteri(textureTargetMap[this._target], WebGLEnum.TEXTURE_BASE_LEVEL, 0);
                    this._device.context.texParameteri(textureTargetMap[this._target], WebGLEnum.TEXTURE_MAX_LEVEL, this._mipLevelCount - 1);
                } else {
                    let w = this._width;
                    let h = this._height;
                    const isCompressed = isCompressedTextureFormat(this._format);
                    const blockWidth = getTextureFormatBlockWidth(this._format);
                    const blockHeight = getTextureFormatBlockHeight(this._format);
                    const blockSize = getTextureFormatBlockSize(this._format);
                    for(let mip = 0; mip < numMipLevels; mip++){
                        const data = isCompressed ? new Uint8Array(Math.ceil(w / blockWidth) * Math.ceil(h / blockHeight) * blockSize) : null;
                        data?.fill(0xff);
                        if (this.isTextureCube()) {
                            for(let face = 0; face < 6; face++){
                                const faceTarget = cubeMapFaceMap[face];
                                if (isCompressed) {
                                    this._device.context.compressedTexImage2D(faceTarget, mip, params.glInternalFormat, w, h, 0, data);
                                } else {
                                    this._device.context.texImage2D(faceTarget, mip, params.glInternalFormat, w, h, 0, params.glFormat, params.glType[0], null);
                                }
                            }
                        } else {
                            if (isCompressed) {
                                this._device.context.compressedTexImage2D(textureTargetMap[this._target], mip, params.glInternalFormat, w, h, 0, data);
                            } else {
                                this._device.context.texImage2D(textureTargetMap[this._target], mip, params.glInternalFormat, w, h, 0, params.glFormat, params.glType[0], null);
                            }
                        }
                        w = Math.max(w >> 1, 1);
                        h = Math.max(h >> 1, 1);
                    }
                }
                const k = this.isTextureCube() ? 6 : 1;
                const memCost = this.getTextureCaps().calcMemoryUsage(this._format, params.glType[0], this._width * this._height * this._depth * k);
                this._device.updateVideoMemoryCost(memCost - this._memCost);
                this._memCost = memCost;
            }
        }
    }
    /** @internal */ _calcMipLevelCount(format, width, height, depth) {
        if (hasDepthChannel(format) || this.isTextureVideo()) {
            return 1;
        }
        if (this._flags & GPUResourceUsageFlags.TF_NO_MIPMAP) {
            return 1;
        }
        if (!this._device.isWebGL2 && (!isPowerOf2(width) || !isPowerOf2(height))) {
            return 1;
        }
        const params = this.getTextureCaps().getTextureFormatInfo(format);
        if (!params || !params.renderable) {
            return 1;
        }
        let size = Math.max(width, height);
        if (this.isTexture3D()) {
            size = Math.max(size, depth);
        }
        return Math.floor(Math.log2(size)) + 1;
    }
    /** @internal */ _getSamplerOptions(params, shadow) {
        const comparison = this.isDepth() && shadow;
        const filterable = params.filterable || comparison;
        const magFilter = filterable ? 'linear' : 'nearest';
        const minFilter = filterable ? 'linear' : 'nearest';
        const mipFilter = this._mipLevelCount > 1 ? filterable ? 'linear' : 'nearest' : 'none';
        return {
            addressU: 'clamp',
            addressV: 'clamp',
            addressW: 'clamp',
            magFilter,
            minFilter,
            mipFilter,
            compare: comparison ? 'le' : null
        };
    }
}

class WebGLTexture2D extends WebGLBaseTexture {
    constructor(device){
        super(device, '2d');
    }
    isTexture2D() {
        return true;
    }
    init() {
        this.loadEmpty(this._format, this._width, this._height, this._mipLevelCount);
    }
    update(data, xOffset, yOffset, width, height) {
        if (this._device.isContextLost()) {
            return;
        }
        if (!this._object) {
            this.allocInternal(this._format, this._width, this._height, 1, this._mipLevelCount);
        }
        const params = this.getTextureCaps().getTextureFormatInfo(this._format);
        this._device.bindTexture(textureTargetMap[this._target], 0, this);
        //this._device.context.bindTexture(textureTargetMap[this._target], this._object);
        this._device.context.pixelStorei(this._device.context.UNPACK_ALIGNMENT, 1);
        this._device.context.texSubImage2D(textureTargetMap[this._target], 0, xOffset, yOffset, width, height, params.glFormat, params.glType[0], data);
        if (this._mipLevelCount > 1) {
            this.generateMipmaps();
        }
    }
    updateFromElement(data, xOffset, yOffset, x, y, width, height) {
        if (this._device.isContextLost()) {
            return;
        }
        if (!this._object) {
            this.allocInternal(this._format, this._width, this._height, 1, this._mipLevelCount);
        }
        const params = this.getTextureCaps().getTextureFormatInfo(this._format);
        this._device.bindTexture(textureTargetMap[this._target], 0, this);
        //this._device.context.bindTexture(textureTargetMap[this._target], this._object);
        this._device.context.pixelStorei(this._device.context.UNPACK_ALIGNMENT, 1);
        if (x === 0 && y === 0 && width === data.width && height === data.height) {
            this._device.context.texSubImage2D(textureTargetMap[this._target], 0, xOffset, yOffset, params.glFormat, params.glType[0], data);
        } else {
            const cvs = document.createElement('canvas');
            cvs.width = width;
            cvs.height = height;
            const ctx = cvs.getContext('2d');
            ctx.drawImage(data, x, y, width, height, 0, 0, width, height);
            this._device.context.texSubImage2D(textureTargetMap[this._target], 0, xOffset, yOffset, params.glFormat, params.glType[0], cvs);
            cvs.width = 0;
            cvs.height = 0;
        }
        if (this._mipLevelCount > 1) {
            this.generateMipmaps();
        }
    }
    async readPixels(x, y, w, h, faceOrLevel, mipLevel, buffer) {
        if (faceOrLevel !== 0) {
            throw new Error(`Texture2D.readPixels(): parameter 'faceOrLayer' must be 0`);
        }
        if (mipLevel >= this.mipLevelCount || mipLevel < 0) {
            throw new Error(`Texture2D.readPixels(): invalid miplevel: ${mipLevel}`);
        }
        if (!this.device.isContextLost() && !this.disposed) {
            const fb = this._device.createFrameBuffer([
                this
            ], null);
            fb.setColorAttachmentMipLevel(0, mipLevel);
            fb.setColorAttachmentGenerateMipmaps(0, false);
            this._device.pushDeviceStates();
            this._device.setFramebuffer(fb);
            await this._device.readPixels(0, x, y, w, h, buffer);
            this._device.popDeviceStates();
            fb.dispose();
        }
    }
    readPixelsToBuffer(x, y, w, h, faceOrLevel, mipLevel, buffer) {
        if (faceOrLevel !== 0) {
            throw new Error(`Texture2D.readPixelsToBuffer(): parameter 'faceOrLayer' must be 0`);
        }
        if (mipLevel >= this.mipLevelCount || mipLevel < 0) {
            throw new Error(`Texture2D.readPixelsToBuffer(): invalid miplevel: ${mipLevel}`);
        }
        if (!this.device.isContextLost() && !this.disposed) {
            const fb = this._device.createFrameBuffer([
                this
            ], null);
            fb.setColorAttachmentMipLevel(0, mipLevel);
            fb.setColorAttachmentGenerateMipmaps(0, false);
            this._device.pushDeviceStates();
            this._device.setFramebuffer(fb);
            this._device.readPixelsToBuffer(0, x, y, w, h, buffer);
            this._device.popDeviceStates();
            fb.dispose();
        }
    }
    loadFromElement(element, sRGB, creationFlags) {
        this._flags = Number(creationFlags) || 0;
        if (this._flags & GPUResourceUsageFlags.TF_WRITABLE) {
            console.error(new Error('webgl device does not support storage texture'));
        } else {
            const format = sRGB ? 'rgba8unorm-srgb' : 'rgba8unorm';
            this.loadImage(element, format);
        }
    }
    createEmpty(format, width, height, creationFlags) {
        this._flags = Number(creationFlags) || 0;
        if (this._flags & GPUResourceUsageFlags.TF_WRITABLE) {
            console.error(new Error('webgl device does not support storage texture'));
        } else {
            this.loadEmpty(format, width, height, 0);
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
    createWithMipmapData(data, sRGB, creationFlags) {
        if (data.isCubemap || data.isVolume) {
            console.error('loading 2d texture with mipmap data failed: data is not 2d texture');
        } else {
            this._flags = Number(creationFlags) || 0;
            if (this._flags & GPUResourceUsageFlags.TF_WRITABLE) {
                console.error(new Error('webgl device does not support storage texture'));
            } else {
                this.loadLevels(data, sRGB);
            }
        }
    }
    /** @internal */ loadEmpty(format, width, height, numMipLevels) {
        this.allocInternal(format, width, height, 1, numMipLevels);
        if (this._mipLevelCount > 1 && !this._device.isContextLost()) {
            this.generateMipmaps();
        }
    }
    /** @internal */ loadLevels(levels, sRGB) {
        let format = sRGB ? linearTextureFormatToSRGB(levels.format) : levels.format;
        let swizzle = false;
        if (format === 'bgra8unorm') {
            format = 'rgba8unorm';
            swizzle = true;
        } else if (format === 'bgra8unorm-srgb') {
            format = 'rgba8unorm-srgb';
            swizzle = true;
        }
        const width = levels.width;
        const height = levels.height;
        const mipLevelCount = levels.mipLevels;
        if (levels.isCompressed) {
            if (!this.getTextureCaps().supportS3TCSRGB || !this.getTextureCaps().supportS3TC) {
                console.warn('No s3tc compression format support');
                return;
            }
        }
        this.allocInternal(format, width, height, 1, mipLevelCount);
        if (!this._device.isContextLost()) {
            const params = this.getTextureCaps().getTextureFormatInfo(this._format);
            const target = textureTargetMap[this._target];
            this._device.bindTexture(target, 0, this);
            //this._device.context.bindTexture(target, this._object);
            this.device.clearErrors();
            for(let i = 0; i < this._mipLevelCount; i++){
                if (levels.isCompressed) {
                    this._device.context.compressedTexSubImage2D(target, i, 0, 0, levels.mipDatas[0][i].width, levels.mipDatas[0][i].height, params.glInternalFormat, levels.mipDatas[0][i].data);
                } else {
                    if (swizzle) {
                        // convert bgra to rgba
                        for(let j = 0; j < levels.mipDatas[0][i].width * levels.mipDatas[0][i].height; j++){
                            const t = levels.mipDatas[0][i].data[j * 4];
                            levels.mipDatas[0][i].data[j * 4] = levels.mipDatas[0][i].data[j * 4 + 2];
                            levels.mipDatas[0][i].data[j * 4 + 2] = t;
                        }
                    }
                    this._device.context.texSubImage2D(target, i, 0, 0, levels.mipDatas[0][i].width, levels.mipDatas[0][i].height, params.glFormat, params.glType[0], levels.mipDatas[0][i].data);
                }
                const err = this.device.getError();
                if (err) {
                    console.error(err);
                    return;
                }
            }
        }
    }
    /** @internal */ loadImage(element, format) {
        this.allocInternal(format, Number(element.width), Number(element.height), 1, 0);
        if (!this._device.isContextLost()) {
            const params = this.getTextureCaps().getTextureFormatInfo(this._format);
            this.device.clearErrors();
            const target = textureTargetMap[this._target];
            this._device.bindTexture(target, 0, this);
            //this._device.context.bindTexture(target, this._object);
            this._device.context.pixelStorei(this._device.context.UNPACK_ALIGNMENT, 4);
            this._device.context.texSubImage2D(target, 0, 0, 0, params.glFormat, params.glType[0], element);
            const err = this.device.getError();
            if (err) {
                console.error(err);
            }
            if (this._mipLevelCount > 1) {
                this.generateMipmaps();
            }
        }
    }
}

class WebGLTexture2DArray extends WebGLBaseTexture {
    constructor(device){
        if (!device.isWebGL2) {
            throw new Error('device does not support 2d texture array');
        }
        super(device, '2darray');
    }
    isTexture2DArray() {
        return true;
    }
    init() {
        this.loadEmpty(this._format, this._width, this._height, this._depth, this._mipLevelCount);
    }
    update(data, xOffset, yOffset, zOffset, width, height, depth) {
        if (this._device.isContextLost()) {
            return;
        }
        if (!this._object) {
            this.allocInternal(this._format, this._width, this._height, this._depth, this._mipLevelCount);
        }
        const params = this.getTextureCaps().getTextureFormatInfo(this._format);
        const gl = this._device.context;
        this._device.bindTexture(textureTargetMap[this._target], 0, this);
        //gl.bindTexture(textureTargetMap[this._target], this._object);
        gl.pixelStorei(this._device.context.UNPACK_ALIGNMENT, 1);
        gl.texSubImage3D(textureTargetMap[this._target], 0, xOffset, yOffset, zOffset, width, height, depth, params.glFormat, params.glType[0], data);
        if (this._mipLevelCount > 1) {
            this.generateMipmaps();
        }
    }
    createWithMipmapData(data, creationFlags) {
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
    loadLevels(levels) {
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
            const params = this.getTextureCaps().getTextureFormatInfo(this._format);
            const gl = this._device.context;
            this._device.bindTexture(textureTargetMap[this._target], 0, this);
            //gl.bindTexture(textureTargetMap[this._target], this._object);
            this.device.clearErrors();
            for(let layer = 0; layer < levels.arraySize; layer++){
                if (levels.mipDatas[layer].length !== levels.mipLevels) {
                    console.log(`Texture2DArray.loadLevels() failed: Invalid texture data`);
                    return;
                }
                for(let i = 0; i < levels.mipLevels; i++){
                    if (levels.isCompressed) {
                        gl.compressedTexSubImage3D(gl.TEXTURE_2D_ARRAY, i, 0, 0, layer, levels.mipDatas[layer][i].width, levels.mipDatas[layer][i].height, 1, params.glInternalFormat, levels.mipDatas[layer][i].data);
                    } else {
                        gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, i, 0, 0, layer, levels.mipDatas[layer][i].width, levels.mipDatas[layer][i].height, 1, params.glFormat, params.glType[0], levels.mipDatas[layer][i].data);
                    }
                    const err = this.device.getError();
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
    updateFromElement(data, xOffset, yOffset, layerIndex, x, y, width, height) {
        if (this._device.isContextLost()) {
            return;
        }
        if (!this._object) {
            this.allocInternal(this._format, this._width, this._height, this._depth, this._mipLevelCount);
        }
        const params = this.getTextureCaps().getTextureFormatInfo(this._format);
        const gl = this._device.context;
        this._device.bindTexture(textureTargetMap[this._target], 0, this);
        //gl.bindTexture(textureTargetMap[this._target], this._object);
        gl.pixelStorei(this._device.context.UNPACK_ALIGNMENT, 1);
        if (x === 0 && y === 0 && width === data.width && height === data.height) {
            gl.texSubImage3D(textureTargetMap[this._target], 0, xOffset, yOffset, layerIndex, width, height, 1, params.glFormat, params.glType[0], data);
        } else {
            const cvs = document.createElement('canvas');
            cvs.width = width;
            cvs.height = height;
            const ctx = cvs.getContext('2d');
            ctx.drawImage(data, x, y, width, height, 0, 0, width, height);
            gl.texSubImage3D(textureTargetMap[this._target], 0, xOffset, yOffset, layerIndex, width, height, 1, params.glFormat, params.glType[0], cvs);
            cvs.width = 0;
            cvs.height = 0;
        }
        if (this._mipLevelCount > 1) {
            this.generateMipmaps();
        }
    }
    createEmpty(format, width, height, depth, creationFlags) {
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
    readPixels(x, y, w, h, layer, mipLevel, buffer) {
        if (layer < 0 || layer >= this._depth) {
            throw new Error(`Texture2DArray.readPixels(): invalid layer: ${layer}`);
        }
        if (mipLevel < 0 || mipLevel >= this.mipLevelCount) {
            throw new Error(`Texture2DArray.readPixels(): invalid miplevel: ${mipLevel}`);
        }
        return new Promise((resolve)=>{
            const fb = this._device.createFrameBuffer([
                this
            ], null);
            fb.setColorAttachmentLayer(0, layer);
            fb.setColorAttachmentMipLevel(0, mipLevel);
            fb.setColorAttachmentGenerateMipmaps(0, false);
            this._device.pushDeviceStates();
            this._device.setFramebuffer(fb);
            this._device.readPixels(0, x, y, w, h, buffer).then(()=>{
                fb.dispose();
                resolve();
            });
            this._device.popDeviceStates();
        });
    }
    readPixelsToBuffer(x, y, w, h, layer, mipLevel, buffer) {
        if (layer < 0 || layer >= this._depth) {
            throw new Error(`Texture2DArray.readPixelsToBuffer(): invalid layer: ${layer}`);
        }
        if (mipLevel < 0 || mipLevel >= this.mipLevelCount) {
            throw new Error(`Texture2DArray.readPixelsToBuffer(): invalid miplevel: ${mipLevel}`);
        }
        const fb = this._device.createFrameBuffer([
            this
        ], null);
        fb.setColorAttachmentLayer(0, layer);
        fb.setColorAttachmentMipLevel(0, mipLevel);
        fb.setColorAttachmentGenerateMipmaps(0, false);
        this._device.pushDeviceStates();
        this._device.setFramebuffer(fb);
        this._device.readPixelsToBuffer(0, x, y, w, h, buffer);
        this._device.popDeviceStates();
        fb.dispose();
    }
    loadEmpty(format, width, height, depth, numMipLevels) {
        this.allocInternal(format, width, height, depth, numMipLevels);
        if (this._mipLevelCount > 1 && !this._device.isContextLost()) {
            this.generateMipmaps();
        }
    }
}

class WebGLTexture3D extends WebGLBaseTexture {
    constructor(device){
        if (!device.isWebGL2) {
            throw new Error('device does not support 3D texture');
        }
        super(device, '3d');
    }
    get depth() {
        return this._depth;
    }
    isTexture3D() {
        return true;
    }
    init() {
        this.loadEmpty(this._format, this._width, this._height, this._depth, this._mipLevelCount);
    }
    update(data, xOffset, yOffset, zOffset, width, height, depth) {
        if (this._device.isContextLost()) {
            return;
        }
        if (!this._object) {
            this.allocInternal(this._format, this._width, this._height, this._depth, this._mipLevelCount);
        }
        const params = this.getTextureCaps().getTextureFormatInfo(this._format);
        const gl = this._device.context;
        this._device.bindTexture(textureTargetMap[this._target], 0, this);
        //gl.bindTexture(textureTargetMap[this._target], this._object);
        gl.pixelStorei(this._device.context.UNPACK_ALIGNMENT, 1);
        gl.texSubImage3D(textureTargetMap[this._target], 0, xOffset, yOffset, zOffset, width, height, depth, params.glFormat, params.glType[0], data);
    }
    createEmpty(format, width, height, depth, creationFlags) {
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
    readPixels(x, y, w, h, layer, mipLevel, buffer) {
        if (mipLevel !== 0) {
            throw new Error(`Texture3D.readPixels(): parameter mipLevel must be 0`);
        }
        return new Promise((resolve)=>{
            const fb = this._device.createFrameBuffer([
                this
            ], null);
            fb.setColorAttachmentLayer(0, layer);
            fb.setColorAttachmentGenerateMipmaps(0, false);
            this._device.pushDeviceStates();
            this._device.setFramebuffer(fb);
            this._device.readPixels(0, x, y, w, h, buffer).then(()=>{
                fb.dispose();
                resolve();
            });
            this._device.popDeviceStates();
        });
    }
    readPixelsToBuffer(x, y, w, h, layer, mipLevel, buffer) {
        if (mipLevel !== 0) {
            throw new Error(`Texture3D.readPixelsToBuffer(): parameter mipLevel must be 0`);
        }
        const fb = this._device.createFrameBuffer([
            this
        ], null);
        fb.setColorAttachmentLayer(0, layer);
        fb.setColorAttachmentGenerateMipmaps(0, false);
        this._device.pushDeviceStates();
        this._device.setFramebuffer(fb);
        this._device.readPixelsToBuffer(0, x, y, w, h, buffer);
        this._device.popDeviceStates();
        fb.dispose();
    }
    createWithMipmapData(data, creationFlags) {
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
    loadLevels(levels) {
        const format = levels.format;
        const width = levels.width;
        const height = levels.height;
        const depth = levels.depth;
        const mipLevelCount = levels.mipLevels === 1 && !(this._flags & GPUResourceUsageFlags.TF_NO_MIPMAP) ? this._calcMipLevelCount(levels.format, width, height, depth) : levels.mipLevels;
        if (levels.isCompressed) {
            if (!this.getTextureCaps().supportS3TCSRGB || !this.getTextureCaps().supportS3TC) {
                console.error('Texture2DArray.loadLevels(): No s3tc compression format support');
                return;
            }
        }
        this.allocInternal(format, width, height, levels.arraySize, mipLevelCount);
        if (!this._device.isContextLost()) {
            const params = this.getTextureCaps().getTextureFormatInfo(this._format);
            const gl = this._device.context;
            this._device.bindTexture(textureTargetMap[this._target], 0, this);
            //gl.bindTexture(textureTargetMap[this._target], this._object);
            this.device.clearErrors();
            for(let layer = 0; layer < depth; layer++){
                if (levels.mipDatas[layer].length !== levels.mipLevels) {
                    console.log(`Texture2DArray.loadLevels() failed: Invalid texture data`);
                    return;
                }
                for(let i = 0; i < levels.mipLevels; i++){
                    if (levels.isCompressed) {
                        gl.compressedTexSubImage3D(gl.TEXTURE_3D, i, 0, 0, layer, levels.mipDatas[layer][i].width, levels.mipDatas[layer][i].height, 1, params.glInternalFormat, levels.mipDatas[layer][i].data);
                    } else {
                        gl.texSubImage3D(gl.TEXTURE_3D, i, 0, 0, layer, levels.mipDatas[layer][i].width, levels.mipDatas[layer][i].height, 1, params.glFormat, params.glType[0], levels.mipDatas[layer][i].data);
                    }
                    const err = this.device.getError();
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
    /** @internal */ loadEmpty(format, width, height, depth, numMipLevels) {
        this.allocInternal(format, width, height, depth, numMipLevels);
        if (this._mipLevelCount > 1 && !this._device.isContextLost()) {
            this.generateMipmaps();
        }
    }
}

class WebGLTextureCube extends WebGLBaseTexture {
    constructor(device){
        super(device, 'cube');
    }
    init() {
        this.loadEmpty(this._format, this._width, this._mipLevelCount);
    }
    update(data, xOffset, yOffset, width, height, face) {
        if (this._device.isContextLost()) {
            return;
        }
        if (!this._object) {
            this.allocInternal(this._format, this._width, this._height, 1, this._mipLevelCount);
        }
        const params = this.getTextureCaps().getTextureFormatInfo(this._format);
        this._device.bindTexture(textureTargetMap[this._target], 0, this);
        //this._device.context.bindTexture(textureTargetMap[this._target], this._object);
        this._device.context.pixelStorei(this._device.context.UNPACK_ALIGNMENT, 1);
        this._device.context.texSubImage2D(cubeMapFaceMap[face], 0, xOffset, yOffset, width, height, params.glFormat, params.glType[0], data);
        if (this._mipLevelCount > 1) {
            this.generateMipmaps();
        }
    }
    updateFromElement(data, xOffset, yOffset, face, x, y, width, height) {
        if (this._device.isContextLost()) {
            return;
        }
        if (!this._object) {
            this.allocInternal(this._format, this._width, this._height, 1, this._mipLevelCount);
        }
        const params = this.getTextureCaps().getTextureFormatInfo(this._format);
        this._device.bindTexture(textureTargetMap[this._target], 0, this);
        //this._device.context.bindTexture(textureTargetMap[this._target], this._object);
        this._device.context.pixelStorei(this._device.context.UNPACK_ALIGNMENT, 1);
        if (x === 0 && y === 0 && width === data.width && height === data.height) {
            this._device.context.texSubImage2D(cubeMapFaceMap[face], 0, xOffset, yOffset, params.glFormat, params.glType[0], data);
        } else {
            const cvs = document.createElement('canvas');
            cvs.width = width;
            cvs.height = height;
            const ctx = cvs.getContext('2d');
            ctx.drawImage(data, x, y, width, height, 0, 0, width, height);
            this._device.context.texSubImage2D(textureTargetMap[this._target], 0, xOffset, yOffset, params.glFormat, params.glType[0], cvs);
            cvs.width = 0;
            cvs.height = 0;
        }
        if (this._mipLevelCount > 1) {
            this.generateMipmaps();
        }
    }
    createEmpty(format, size, creationFlags) {
        this._flags = Number(creationFlags) || 0;
        if (this._flags & GPUResourceUsageFlags.TF_WRITABLE) {
            console.error(new Error('webgl device does not support storage texture'));
        } else {
            this.loadEmpty(format, size, 0);
        }
    }
    readPixels(x, y, w, h, face, mipLevel, buffer) {
        if (mipLevel < 0 || mipLevel >= this.mipLevelCount) {
            throw new Error(`TextureCube.readPixels(): invalid miplevel: ${mipLevel}`);
        }
        return new Promise((resolve)=>{
            const fb = this._device.createFrameBuffer([
                this
            ], null);
            fb.setColorAttachmentCubeFace(0, face);
            fb.setColorAttachmentMipLevel(0, mipLevel);
            fb.setColorAttachmentGenerateMipmaps(0, false);
            this._device.pushDeviceStates();
            this._device.setFramebuffer(fb);
            this._device.readPixels(0, x, y, w, h, buffer).then(()=>{
                fb.dispose();
                resolve();
            });
            this._device.popDeviceStates();
        });
    }
    readPixelsToBuffer(x, y, w, h, face, mipLevel, buffer) {
        if (mipLevel < 0 || mipLevel >= this.mipLevelCount) {
            throw new Error(`TextureCube.readPixels(): invalid miplevel: ${mipLevel}`);
        }
        const fb = this._device.createFrameBuffer([
            this
        ], null);
        fb.setColorAttachmentCubeFace(0, face);
        fb.setColorAttachmentMipLevel(0, mipLevel);
        fb.setColorAttachmentGenerateMipmaps(0, false);
        this._device.pushDeviceStates();
        this._device.setFramebuffer(fb);
        this._device.readPixelsToBuffer(0, x, y, w, h, buffer);
        this._device.popDeviceStates();
        fb.dispose();
    }
    isTextureCube() {
        return true;
    }
    generateMipmaps() {
        if (this._object && this._mipLevelCount > 1) {
            const target = textureTargetMap[this._target];
            this._device.bindTexture(target, 0, this);
            //this._device.context.bindTexture(target, this._object);
            this._device.context.generateMipmap(target);
        }
    }
    createWithMipmapData(data, sRGB, creationFlags) {
        if (!data.isCubemap) {
            console.error('loading cubmap with mipmap data failed: data is not cubemap');
        } else {
            this._flags = Number(creationFlags) || 0;
            if (this._flags & GPUResourceUsageFlags.TF_WRITABLE) {
                console.error('webgl device does not support storage texture');
            } else {
                this.loadLevels(data, sRGB);
            }
        }
    }
    /** @internal */ loadEmpty(format, size, mipLevelCount) {
        this.allocInternal(format, size, size, 1, mipLevelCount);
        if (this._mipLevelCount > 1 && !this._device.isContextLost()) {
            this.generateMipmaps();
        }
    }
    loadImages(images, format) {
        const width = images[0].width;
        const height = images[0].height;
        if (images.length !== 6) {
            console.error(new Error('cubemap face list must have 6 images'));
            return;
        }
        for(let i = 1; i < 6; i++){
            if (images[i].width !== width || images[i].height !== height) {
                console.error(new Error('cubemap face images must have identical sizes'));
                return;
            }
        }
        if (width === 0 || height === 0) {
            return;
        }
        this.allocInternal(format, width, height, 1, 0);
        if (!this._device.isContextLost()) {
            this.device.clearErrors();
            this._device.bindTexture(textureTargetMap[this._target], 0, this);
            //this._device.context.bindTexture(textureTargetMap[this._target], this._object);
            const params = this.getTextureCaps().getTextureFormatInfo(this._format);
            for(let face = 0; face < 6; face++){
                this._device.context.texSubImage2D(cubeMapFaceMap[face], 0, 0, 0, params.glFormat, params.glType[0], images[face]);
                const err = this.device.getError();
                if (err) {
                    console.error(err);
                    return;
                }
            }
            if (this._mipLevelCount > 1) {
                this.generateMipmaps();
            }
        }
    }
    loadLevels(levels, sRGB) {
        const format = sRGB ? linearTextureFormatToSRGB(levels.format) : levels.format;
        const width = levels.width;
        const height = levels.height;
        const mipLevelCount = levels.mipLevels;
        if (levels.isCompressed) {
            if (!this.getTextureCaps().supportS3TCSRGB || !this.getTextureCaps().supportS3TC) {
                console.warn('No s3tc compression format support');
                return;
            }
        }
        this.allocInternal(format, width, height, 1, mipLevelCount);
        if (!this._device.isContextLost()) {
            const params = this.getTextureCaps().getTextureFormatInfo(this._format);
            this._device.bindTexture(textureTargetMap[this._target], 0, this);
            //this._device.context.bindTexture(textureTargetMap[this._target], this._object);
            this.device.clearErrors();
            for(let face = 0; face < 6; face++){
                const faceTarget = cubeMapFaceMap[face];
                if (this._mipLevelCount > 1 && levels.mipDatas[face].length !== this._mipLevelCount) {
                    console.log(`invalid texture data`);
                    return;
                }
                for(let i = 0; i < this._mipLevelCount; i++){
                    if (levels.isCompressed) {
                        this._device.context.compressedTexSubImage2D(faceTarget, i, 0, 0, levels.mipDatas[face][i].width, levels.mipDatas[face][i].height, params.glInternalFormat, levels.mipDatas[face][i].data);
                    } else {
                        this._device.context.texSubImage2D(faceTarget, i, 0, 0, levels.mipDatas[face][i].width, levels.mipDatas[face][i].height, params.glFormat, params.glType[0], levels.mipDatas[face][i].data);
                    }
                    const err = this.device.getError();
                    if (err) {
                        console.error(err);
                        return;
                    }
                }
            }
        }
    }
}

class WebGLTextureVideo extends WebGLBaseTexture {
    _source;
    _callbackId;
    constructor(device, source){
        super(device, '2d');
        this._source = null;
        this._callbackId = null;
        this._format = 'unknown';
        this.loadFromElement(source);
    }
    isTextureVideo() {
        return true;
    }
    get source() {
        return this._source;
    }
    destroy() {
        if (this._source && this._callbackId !== null) {
            this._source.cancelVideoFrameCallback(this._callbackId);
        }
        super.destroy();
    }
    init() {
        this.loadElement(this._source);
    }
    /** @internal */ loadFromElement(el) {
        this._flags = GPUResourceUsageFlags.TF_NO_MIPMAP;
        this.loadElement(el);
    }
    generateMipmaps() {
    // Does nothing
    }
    readPixels(x, y, w, h, faceOrLayer, mipLevel, buffer) {
        throw new Error(`Video texture does not support readPixels()`);
    }
    readPixelsToBuffer(x, y, w, h, faceOrLayer, mipLevel, buffer) {
        throw new Error(`Video texture does not support readPixelsToBuffer()`);
    }
    /** @internal */ updateVideoFrame() {
        if (this.object && this._source.currentTime > 0 && !this._source.requestVideoFrameCallback) {
            this.update();
            return true;
        }
        return false;
    }
    /** @internal */ update() {
        this.allocInternal('rgba8unorm', this._source.videoWidth, this._source.videoHeight, 1, 1);
        if (!this._device.isContextLost()) {
            const target = textureTargetMap[this._target];
            const params = this.getTextureCaps().getTextureFormatInfo(this._format);
            this._device.bindTexture(target, 0, this);
            //this._device.context.bindTexture(target, this._object);
            this._device.context.pixelStorei(this._device.context.UNPACK_ALIGNMENT, 1);
            this._device.context.texImage2D(target, 0, params.glInternalFormat, params.glFormat, params.glType[0], this._source);
        }
    }
    /** @internal */ loadElement(element) {
        if (this._source && this._callbackId !== null) {
            this._source.cancelVideoFrameCallback(this._callbackId);
            this._callbackId = null;
        }
        this._source = element;
        if (this._source?.requestVideoFrameCallback) {
            const that = this;
            that._callbackId = this._source.requestVideoFrameCallback(function cb() {
                if (that._object) {
                    that.update();
                    that._callbackId = that._source.requestVideoFrameCallback(cb);
                }
            });
        }
        this.allocInternal('rgba8unorm', Math.max(this._source.videoWidth, 1), Math.max(this._source.videoHeight, 1), 1, 1);
    }
}

class WebGLVertexLayout extends WebGLGPUObject {
    _vertexData;
    _dirty;
    constructor(device, options){
        super(device);
        this._vertexData = new VertexData();
        this._dirty = false;
        for (const vb of options.vertexBuffers){
            this._vertexData.setVertexBuffer(vb.buffer, vb.stepMode);
        }
        if (options.indexBuffer) {
            this._vertexData.setIndexBuffer(options.indexBuffer);
        }
        this.load();
    }
    destroy() {
        if (this._object && this._device.vaoExt) {
            this._device.vaoExt.deleteVertexArray(this._object);
        }
        this._object = null;
    }
    async restore() {
        if (!this._device.isContextLost()) {
            this.load();
        }
    }
    get vertexBuffers() {
        return this._vertexData.vertexBuffers;
    }
    get indexBuffer() {
        return this._vertexData.indexBuffer;
    }
    setDrawOffset(buffer, byteOffset) {
        for (const info of this._vertexData.vertexBuffers){
            if (info?.buffer === buffer && info.drawOffset !== byteOffset) {
                info.drawOffset = byteOffset;
                this._dirty = true;
            }
        }
    }
    getVertexBuffer(semantic) {
        return this._vertexData.getVertexBuffer(semantic);
    }
    getVertexBufferInfo(semantic) {
        return this._vertexData.getVertexBufferInfo(semantic);
    }
    getIndexBuffer() {
        return this._vertexData.getIndexBuffer();
    }
    bind() {
        if (this._object && this._device.vaoExt) {
            this._device.vaoExt.bindVertexArray(this._object);
            if (this._dirty) {
                this._dirty = false;
                this.bindBuffers();
            }
        } else {
            this.bindBuffers();
        }
    }
    draw(primitiveType, first, count) {
        this._device.setVertexLayout(this);
        this._device.draw(primitiveType, first, count);
    }
    drawInstanced(primitiveType, first, count, numInstances) {
        this._device.setVertexLayout(this);
        this._device.drawInstanced(primitiveType, first, count, numInstances);
    }
    isVertexLayout() {
        return true;
    }
    load() {
        if (this._device.isContextLost()) {
            return;
        }
        if (this._device.vaoExt) {
            if (!this._object) {
                this._object = this._device.vaoExt.createVertexArray();
                this._device.vaoExt.bindVertexArray(this._object);
                this.bindBuffers();
                this._device.vaoExt.bindVertexArray(null);
            }
        } else {
            this._object = {};
        }
    }
    bindBuffers() {
        const vertexBuffers = this._vertexData.vertexBuffers;
        const gl = this._device.context;
        for(let loc = 0; loc < vertexBuffers.length; loc++){
            const bufferInfo = vertexBuffers[loc];
            const buffer = bufferInfo?.buffer;
            if (buffer) {
                if (buffer.disposed) {
                    buffer.reload();
                }
                gl.bindBuffer(WebGLEnum.ARRAY_BUFFER, buffer.object);
                gl.enableVertexAttribArray(loc);
                if (bufferInfo.stepMode === 'instance' && this._device.instancedArraysExt) {
                    gl.vertexAttribPointer(loc, bufferInfo.type.cols, typeMap[bufferInfo.type.scalarType], bufferInfo.type.normalized, bufferInfo.stride, bufferInfo.offset);
                    this._device.instancedArraysExt.vertexAttribDivisor(loc, 1);
                } else {
                    gl.vertexAttribPointer(loc, bufferInfo.type.cols, typeMap[bufferInfo.type.scalarType], bufferInfo.type.normalized, bufferInfo.stride, bufferInfo.drawOffset + bufferInfo.offset);
                }
            } else {
                gl.disableVertexAttribArray(loc);
            }
        }
        if (this._vertexData.indexBuffer?.disposed) {
            this._vertexData.indexBuffer.reload();
        }
        gl.bindBuffer(WebGLEnum.ELEMENT_ARRAY_BUFFER, this._vertexData.indexBuffer ? this._vertexData.indexBuffer.object : null);
    }
}

class WebGLGPUBuffer extends WebGLGPUObject {
    _size;
    _usage;
    _systemMemoryBuffer;
    _systemMemory;
    _memCost;
    constructor(device, usage, data, systemMemory = false){
        super(device);
        if (usage & GPUResourceUsageFlags.BF_VERTEX && usage & GPUResourceUsageFlags.BF_INDEX) {
            throw new Error('buffer usage must not have Vertex and Index simultaneously');
        }
        if (!device.isWebGL2 && !(usage & GPUResourceUsageFlags.BF_VERTEX) && !(usage & GPUResourceUsageFlags.BF_INDEX) && !(usage & GPUResourceUsageFlags.BF_UNIFORM)) {
            throw new Error('no Vertex or Index or Uniform usage set when creating buffer');
        }
        if (device.isWebGL2 && !(usage & ~GPUResourceUsageFlags.DYNAMIC)) {
            throw new Error('buffer usage not set when creating buffer');
        }
        if (usage & GPUResourceUsageFlags.DYNAMIC && usage & GPUResourceUsageFlags.MANAGED) {
            throw new Error('buffer usage DYNAMIC and MANAGED can not be both set');
        }
        this._object = null;
        this._memCost = 0;
        this._usage = usage;
        this._size = typeof data === 'number' ? data : data.byteLength;
        if (this._size <= 0) {
            throw new Error('can not create buffer with zero size');
        }
        this._systemMemory = !!systemMemory;
        if (this._systemMemory || this._usage & GPUResourceUsageFlags.MANAGED) {
            this._systemMemoryBuffer = new Uint8Array(this._size);
            if (data && typeof data !== 'number') {
                this._systemMemoryBuffer.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
            }
        } else {
            this._systemMemoryBuffer = null;
        }
        if (!this._systemMemory) {
            this.load(this._systemMemoryBuffer || (typeof data === 'number' ? null : data));
        }
    }
    get byteLength() {
        return this._size;
    }
    get systemMemoryBuffer() {
        return this._systemMemoryBuffer?.buffer || null;
    }
    get usage() {
        return this._usage;
    }
    bufferSubData(dstByteOffset, data, srcPos, srcLength) {
        srcPos = Number(srcPos) || 0;
        dstByteOffset = Number(dstByteOffset) || 0;
        srcLength = Number(srcLength) || data.length - srcPos;
        if (srcPos + srcLength > data.length) {
            throw new Error('bufferSubData() failed: source buffer is too small');
        }
        if (dstByteOffset + srcLength * data.BYTES_PER_ELEMENT > this.byteLength) {
            throw new Error('bufferSubData() failed: dest buffer is too small');
        }
        if (this._systemMemory || this._usage & GPUResourceUsageFlags.MANAGED) {
            // copy to system backup buffer if present
            this._systemMemoryBuffer.set(new Uint8Array(data.buffer, data.byteOffset + srcPos * data.BYTES_PER_ELEMENT, srcLength * data.BYTES_PER_ELEMENT), dstByteOffset);
        }
        if (!this._systemMemory && !this.device.isContextLost()) {
            if (this.disposed) {
                this.reload();
            }
            if (!this._device.isWebGL2 && (srcPos !== 0 || srcLength !== data.length)) {
                data = data.subarray(srcPos, srcPos + srcLength);
            }
            this._device.vaoExt?.bindVertexArray(null);
            let target;
            if (this._usage & GPUResourceUsageFlags.BF_INDEX) {
                target = WebGLEnum.ELEMENT_ARRAY_BUFFER;
            } else if (this._usage & GPUResourceUsageFlags.BF_VERTEX) {
                target = WebGLEnum.ARRAY_BUFFER;
            } else if (this._usage & GPUResourceUsageFlags.BF_UNIFORM) {
                target = WebGLEnum.UNIFORM_BUFFER;
            } else if (this._usage & (GPUResourceUsageFlags.BF_READ | GPUResourceUsageFlags.BF_WRITE)) {
                target = WebGLEnum.COPY_WRITE_BUFFER;
            } else {
                throw new Error(`Invalid buffer usage`);
            }
            this._device.context.bindBuffer(target, this._object);
            if (this._device.isWebGL2) {
                this._device.context.bufferSubData(target, dstByteOffset, data, srcPos, srcLength);
            } else {
                this._device.context.bufferSubData(target, dstByteOffset, data);
            }
        }
    }
    async getBufferSubData(dstBuffer, offsetInBytes, sizeInBytes) {
        if (this.disposed) {
            this.reload();
        }
        return this._getBufferData(dstBuffer, offsetInBytes, sizeInBytes);
    }
    async _getBufferData(dstBuffer, offsetInBytes, sizeInBytes) {
        offsetInBytes = Number(offsetInBytes) || 0;
        sizeInBytes = Number(sizeInBytes) || this.byteLength - offsetInBytes;
        if (offsetInBytes < 0 || offsetInBytes + sizeInBytes > this.byteLength) {
            throw new Error('data query range out of bounds');
        }
        if (dstBuffer && dstBuffer.byteLength < sizeInBytes) {
            throw new Error('no enough space for querying buffer data');
        }
        dstBuffer = dstBuffer || new Uint8Array(sizeInBytes);
        if (this._systemMemoryBuffer) {
            dstBuffer.set(new Uint8Array(this._systemMemoryBuffer, offsetInBytes, sizeInBytes));
        } else {
            const gl = this._device.context;
            if (isWebGL2(gl)) {
                const sync = gl.fenceSync(WebGLEnum.SYNC_GPU_COMMANDS_COMPLETE, 0);
                gl.flush();
                await this.clientWaitAsync(gl, sync, 0, 10);
                gl.deleteSync(sync);
            }
            this._device.vaoExt?.bindVertexArray(null);
            let target;
            if (this._usage & GPUResourceUsageFlags.BF_INDEX) {
                target = WebGLEnum.ELEMENT_ARRAY_BUFFER;
            } else if (this._usage & GPUResourceUsageFlags.BF_VERTEX) {
                target = WebGLEnum.ARRAY_BUFFER;
            } else if (this._usage & GPUResourceUsageFlags.BF_UNIFORM) {
                target = WebGLEnum.UNIFORM_BUFFER;
            } else if (this._usage & (GPUResourceUsageFlags.BF_READ | GPUResourceUsageFlags.BF_WRITE)) {
                target = WebGLEnum.COPY_READ_BUFFER;
            } else {
                throw new Error(`Invalid buffer usage`);
            }
            gl.bindBuffer(target, this._object);
            gl.getBufferSubData(target, offsetInBytes, dstBuffer, 0, sizeInBytes);
            gl.bindBuffer(target, null);
        }
        return dstBuffer;
    }
    async restore() {
        if (!this._systemMemory && !this._object && !this._device.isContextLost()) {
            this.load(this._systemMemoryBuffer);
        }
    }
    destroy() {
        if (!this._systemMemory && this._object) {
            this._device.context.deleteBuffer(this._object);
            this._object = null;
            this._device.updateVideoMemoryCost(-this._memCost);
            this._memCost = 0;
        }
    }
    isBuffer() {
        return true;
    }
    load(data) {
        if (!this._device.isContextLost()) {
            if (!this._object) {
                this._object = this._device.context.createBuffer();
            }
            this._device.vaoExt?.bindVertexArray(null);
            let usage = this._usage & GPUResourceUsageFlags.DYNAMIC ? WebGLEnum.DYNAMIC_DRAW : WebGLEnum.STATIC_DRAW;
            let target;
            if (this._usage & GPUResourceUsageFlags.BF_INDEX) {
                target = WebGLEnum.ELEMENT_ARRAY_BUFFER;
            } else if (this._usage & GPUResourceUsageFlags.BF_VERTEX) {
                target = WebGLEnum.ARRAY_BUFFER;
            } else if (this._usage & GPUResourceUsageFlags.BF_UNIFORM) {
                target = WebGLEnum.UNIFORM_BUFFER;
            } else if (this._usage & GPUResourceUsageFlags.BF_READ) {
                target = WebGLEnum.COPY_READ_BUFFER;
                usage = WebGLEnum.STREAM_READ;
            } else if (this._usage & GPUResourceUsageFlags.BF_WRITE) {
                target = WebGLEnum.COPY_WRITE_BUFFER;
            } else {
                throw new Error(`WebGLGPUBuffer.load() failed: invalid buffer usage: ${this._usage}`);
            }
            this._device.context.bindBuffer(target, this._object);
            if (data) {
                this._device.context.bufferData(target, data, usage);
            } else {
                this._device.context.bufferData(target, this._size + 15 & ~15, usage);
            }
        }
        this._device.updateVideoMemoryCost(this._size - this._memCost);
        this._memCost = this._size;
    }
    /** @internal */ async clientWaitAsync(gl, sync, flags, interval_ms) {
        return new Promise((resolve, reject)=>{
            function test() {
                const res = gl.clientWaitSync(sync, flags, 0);
                if (res == gl.WAIT_FAILED) {
                    reject();
                    return;
                }
                if (res == gl.TIMEOUT_EXPIRED) {
                    setTimeout(test, interval_ms);
                    return;
                }
                resolve();
            }
            test();
        });
    }
}

const typeU16$1 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.U16);
const typeU32 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.U32);
class WebGLIndexBuffer extends WebGLGPUBuffer {
    indexType;
    length;
    constructor(device, data, usage){
        if (!(data instanceof Uint16Array) && !(data instanceof Uint32Array)) {
            throw new Error('invalid index data');
        }
        super(device, GPUResourceUsageFlags.BF_INDEX | usage, data);
        this.indexType = data instanceof Uint16Array ? typeU16$1 : typeU32;
        this.length = data.length;
    }
}

const STATUS_UNCHECKED = 0;
const STATUS_OK = 1;
const STATUS_FAILED = 2;
class WebGLFrameBuffer extends WebGLGPUObject {
    _options;
    _needBindBuffers;
    _drawTags;
    _lastDrawTag;
    _status;
    _statusAA;
    _width;
    _height;
    _isMRT;
    _drawBuffers;
    _hash;
    _depthAttachmentTarget;
    _colorAttachmentsAA;
    _depthAttachmentAA;
    _intermediateAttachments;
    _framebufferAA;
    constructor(device, colorAttachments, depthAttachment, opt){
        super(device);
        if (colorAttachments.length > 0 && colorAttachments.findIndex((val)=>!val) >= 0) {
            throw new Error('WebGLFramebuffer(): invalid color attachments');
        }
        this._object = null;
        this._framebufferAA = null;
        this._colorAttachmentsAA = null;
        this._depthAttachmentAA = null;
        this._intermediateAttachments = null;
        this._needBindBuffers = false;
        this._drawTags = 0;
        this._lastDrawTag = -1;
        this._status = STATUS_UNCHECKED;
        this._statusAA = STATUS_UNCHECKED;
        this._options = {
            colorAttachments: colorAttachments?.length > 0 ? colorAttachments.map((value)=>({
                    texture: value,
                    face: 0,
                    layer: 0,
                    level: 0,
                    generateMipmaps: true
                })) : null,
            depthAttachment: depthAttachment ? {
                texture: depthAttachment,
                face: 0,
                layer: 0,
                level: 0,
                generateMipmaps: false
            } : null,
            sampleCount: device.type === 'webgl' ? 1 : opt?.sampleCount ?? 1,
            ignoreDepthStencil: opt?.ignoreDepthStencil ?? false
        };
        if (!this._options.colorAttachments && !this._options.depthAttachment) {
            throw new Error('WebGLFramebuffer(): colorAttachments or depthAttachment must be specified');
        }
        this._width = this._options.colorAttachments ? this._options.colorAttachments[0].texture.width : this._options.depthAttachment.texture.width;
        this._height = this._options.colorAttachments ? this._options.colorAttachments[0].texture.height : this._options.depthAttachment.texture.height;
        if (this._options.colorAttachments && this._options.colorAttachments.findIndex((val)=>val.texture.width !== this._width || val.texture.height !== this._height) >= 0 || this._options.depthAttachment && (this._options.depthAttachment.texture.width !== this._width || this._options.depthAttachment.texture.height !== this._height)) {
            throw new Error('WebGLFramebuffer(): attachment textures must have same width and height');
        }
        this._drawBuffers = this._options.colorAttachments?.map((val, index)=>WebGLEnum.COLOR_ATTACHMENT0 + index) ?? [];
        this._isMRT = this._drawBuffers.length > 1;
        if (this._options.depthAttachment) {
            const format = this._options.depthAttachment.texture.format;
            this._depthAttachmentTarget = hasStencilChannel(format) ? WebGLEnum.DEPTH_STENCIL_ATTACHMENT : WebGLEnum.DEPTH_ATTACHMENT;
        } else {
            this._depthAttachmentTarget = WebGLEnum.NONE;
        }
        const colorAttachmentHash = this._options.colorAttachments?.map((tex)=>tex.texture.format).join(':') ?? '';
        const depthAttachmentHash = this._options.depthAttachment?.texture.format ?? '';
        this._hash = `${colorAttachmentHash}-${depthAttachmentHash}-${this._options.sampleCount ?? 1}`;
        this._init();
    }
    tagDraw() {
        this._drawTags++;
    }
    isMRT() {
        return this._isMRT;
    }
    getWidth() {
        const attachment = this._options.colorAttachments?.[0] ?? this._options.depthAttachment;
        return Math.max(attachment.texture.width >> attachment.level, 1);
    }
    getHeight() {
        const attachment = this._options.colorAttachments?.[0] ?? this._options.depthAttachment;
        return Math.max(attachment.texture.height >> attachment.level, 1);
    }
    getHash() {
        return this._hash;
    }
    async restore() {
        if (!this._object && !this._device.isContextLost()) {
            if (this._options?.depthAttachment?.texture?.disposed) {
                await this._options.depthAttachment.texture.reload();
            }
            if (this._options?.colorAttachments) {
                for (const k of this._options.colorAttachments){
                    if (k?.texture?.disposed) {
                        await k.texture.reload();
                    }
                }
            }
        }
        this._init();
    }
    destroy() {
        if (this._object) {
            this._device.context.deleteFramebuffer(this._object);
            this._object = null;
            if (this._colorAttachmentsAA) {
                for (const rb of this._colorAttachmentsAA){
                    this._device.context.deleteRenderbuffer(rb);
                }
                this._colorAttachmentsAA = null;
            }
            if (this._depthAttachmentAA) {
                this._device.context.deleteRenderbuffer(this._depthAttachmentAA);
                this._depthAttachmentAA = null;
            }
            if (this._framebufferAA) {
                this._device.context.deleteFramebuffer(this._framebufferAA);
                this._framebufferAA = null;
            }
            if (this._intermediateAttachments) {
                for (const entry of this._intermediateAttachments){
                    for (const rb of entry[1]){
                        if (rb) {
                            this._device.context.deleteTexture(rb.texture);
                            this._device.invalidateBindingTextures();
                        }
                    }
                }
                this._intermediateAttachments = null;
            }
        }
    }
    setColorAttachmentGenerateMipmaps(index, generateMipmaps) {
        const k = this._options.colorAttachments?.[index];
        if (k) {
            k.generateMipmaps = !!generateMipmaps;
        }
    }
    setColorAttachmentCubeFace(index, face) {
        const k = this._options.colorAttachments?.[index];
        if (k && k.face !== face) {
            this._needBindBuffers = true;
            if (this._device.context._currentFramebuffer === this) {
                this.unbind();
                k.face = face;
                this.bind();
            } else {
                k.face = face;
            }
        }
    }
    setColorAttachmentMipLevel(index, level) {
        const k = this._options.colorAttachments?.[index];
        if (k && k.level !== level) {
            this._needBindBuffers = true;
            if (this._device.context._currentFramebuffer === this) {
                this.unbind();
                k.level = level;
                this.bind();
            } else {
                k.level = level;
            }
        }
    }
    setColorAttachmentLayer(index, layer) {
        const k = this._options.colorAttachments?.[index];
        if (k && k.layer !== layer) {
            this._needBindBuffers = true;
            if (this._device.context._currentFramebuffer === this) {
                this.unbind();
                k.layer = layer;
                this.bind();
            } else {
                k.layer = layer;
            }
        }
    }
    setDepthAttachmentCubeFace(face) {
        const k = this._options.depthAttachment;
        if (k && k.face !== face) {
            this._needBindBuffers = true;
            if (this._device.context._currentFramebuffer === this) {
                this.unbind();
                k.face = face;
                this.bind();
            } else {
                k.face = face;
            }
        }
    }
    setDepthAttachmentLayer(layer) {
        const k = this._options.depthAttachment;
        if (k && k.layer !== layer) {
            this._needBindBuffers = true;
            if (this._device.context._currentFramebuffer === this) {
                this.unbind();
                k.layer = layer;
                this.bind();
            } else {
                k.layer = layer;
            }
        }
    }
    getDepthAttachment() {
        return this._options?.depthAttachment?.texture || null;
    }
    getColorAttachments() {
        return this._options.colorAttachments?.map((val)=>val.texture || null) || [];
    }
    bind() {
        if (this._object) {
            this._device.context._currentFramebuffer = this;
            this._lastDrawTag = -1;
            if (this._needBindBuffers) {
                this._needBindBuffers = false;
                if (!this._bindBuffersAA() || !this._bindBuffers()) {
                    this._device.context.bindFramebuffer(WebGLEnum.FRAMEBUFFER, null);
                    this._device.context._currentFramebuffer = null;
                    return false;
                }
            }
            this._device.context.bindFramebuffer(WebGLEnum.FRAMEBUFFER, this._framebufferAA || this._object);
            const drawBuffersExt = this._device.drawBuffersExt;
            if (drawBuffersExt) {
                drawBuffersExt.drawBuffers(this._drawBuffers);
            } else if (this._isMRT) {
                console.error('device does not support multiple framebuffer color attachments');
            }
            this._device.setViewport(null);
            this._device.setScissor(null);
            return true;
        }
        return false;
    }
    unbind() {
        if (this._device.context._currentFramebuffer === this) {
            this._updateMSAABuffer();
            this._device.context.bindFramebuffer(WebGLEnum.FRAMEBUFFER, null);
            this._device.context._currentFramebuffer = null;
            this._device.setViewport();
            this._device.setScissor();
            const drawBuffersExt = this._device.drawBuffersExt;
            if (drawBuffersExt) {
                drawBuffersExt.drawBuffers([
                    WebGLEnum.BACK
                ]);
            }
            if (this._options.colorAttachments) {
                for (const attachment of this._options.colorAttachments){
                    const tex = attachment.texture;
                    if (attachment.level > 0) {
                        const texture = this._intermediateAttachments?.get(tex)?.[attachment.level];
                        if (texture) {
                            const tmpFramebuffer = this._device.context.createFramebuffer();
                            this._device.context.bindFramebuffer(WebGLEnum.FRAMEBUFFER, tmpFramebuffer);
                            this._device.context.framebufferTexture2D(WebGLEnum.FRAMEBUFFER, WebGLEnum.COLOR_ATTACHMENT0, WebGLEnum.TEXTURE_2D, texture.texture, 0);
                            if (tex.isTexture2D()) {
                                this._device.bindTexture(WebGLEnum.TEXTURE_2D, 0, tex);
                                //this._device.context.bindTexture(WebGLEnum.TEXTURE_2D, tex.object);
                                this._device.context.copyTexSubImage2D(WebGLEnum.TEXTURE_2D, attachment.level, 0, 0, 0, 0, texture.width, texture.height);
                            } else if (tex.isTextureCube()) {
                                this._device.bindTexture(WebGLEnum.TEXTURE_CUBE_MAP, 0, tex);
                                //this._device.context.bindTexture(WebGLEnum.TEXTURE_CUBE_MAP, tex.object);
                                this._device.context.copyTexSubImage2D(cubeMapFaceMap[attachment.face ?? CubeFace.PX], attachment.level, 0, 0, 0, 0, texture.width, texture.height);
                            }
                            this._device.context.bindFramebuffer(WebGLEnum.FRAMEBUFFER, null);
                            this._device.context.deleteFramebuffer(tmpFramebuffer);
                        }
                    }
                    if (attachment.generateMipmaps && tex.mipLevelCount > 1) {
                        tex.generateMipmaps();
                    }
                }
            }
        }
    }
    _updateMSAABuffer() {
        if (this._options.sampleCount > 1 && this._lastDrawTag !== this._drawTags) {
            const gl = this._device.context;
            gl.bindFramebuffer(WebGLEnum.READ_FRAMEBUFFER, this._framebufferAA);
            gl.bindFramebuffer(WebGLEnum.DRAW_FRAMEBUFFER, this._object);
            let depthStencilMask = 0;
            if (!this._options.ignoreDepthStencil && this._depthAttachmentTarget !== WebGLEnum.NONE) {
                depthStencilMask = WebGLEnum.DEPTH_BUFFER_BIT | (this._depthAttachmentTarget === WebGLEnum.DEPTH_STENCIL_ATTACHMENT ? WebGLEnum.STENCIL_BUFFER_BIT : 0);
            }
            for(let i = 0; i < this._drawBuffers.length; i++){
                for(let j = 0; j < this._drawBuffers.length; j++){
                    this._drawBuffers[j] = j === i ? WebGLEnum.COLOR_ATTACHMENT0 + i : WebGLEnum.NONE;
                }
                gl.readBuffer(this._drawBuffers[i]);
                gl.drawBuffers(this._drawBuffers);
                gl.blitFramebuffer(0, 0, this._width, this._height, 0, 0, this._width, this._height, WebGLEnum.COLOR_BUFFER_BIT | depthStencilMask, WebGLEnum.NEAREST);
                depthStencilMask = 0;
            }
            if (depthStencilMask !== 0) {
                gl.blitFramebuffer(0, 0, this._width, this._height, 0, 0, this._width, this._height, depthStencilMask, WebGLEnum.NEAREST);
            }
            for(let i = 0; i < this._drawBuffers.length; i++){
                this._drawBuffers[i] = WebGLEnum.COLOR_ATTACHMENT0 + i;
            }
            gl.bindFramebuffer(WebGLEnum.READ_FRAMEBUFFER, null);
            gl.bindFramebuffer(WebGLEnum.DRAW_FRAMEBUFFER, null);
            this._lastDrawTag = this._drawTags;
        }
    }
    _load() {
        if (this._device.isContextLost()) {
            return;
        }
        do {
            if (this._options.sampleCount > 1) {
                this._framebufferAA = this._device.context.createFramebuffer();
                this._colorAttachmentsAA = [];
                this._depthAttachmentAA = null;
                if (!this._bindBuffersAA()) {
                    this.dispose();
                    break;
                }
            }
            this._object = this._device.context.createFramebuffer();
            this._device.context.bindFramebuffer(WebGLEnum.FRAMEBUFFER, this._object);
            if (!this._bindBuffers()) {
                this.dispose();
            }
        }while (0)
        this._lastDrawTag = -1;
        this._device.context.bindFramebuffer(WebGLEnum.FRAMEBUFFER, null);
        this._device.context._currentFramebuffer = null;
    }
    _bindAttachment(attachment, info) {
        if (info.texture) {
            let intermediateTexture = null;
            if (this.device.type === 'webgl' && info.level > 0) {
                if (!this._intermediateAttachments) {
                    this._intermediateAttachments = new Map();
                }
                let intermediateAttachments = this._intermediateAttachments.get(info.texture);
                if (!intermediateAttachments) {
                    intermediateAttachments = [];
                    this._intermediateAttachments.set(info.texture, intermediateAttachments);
                }
                if (!intermediateAttachments[info.level]) {
                    let width = info.texture.width;
                    let height = info.texture.height;
                    let level = info.level;
                    while(level-- > 0){
                        width = Math.max(width >> 1, 1);
                        height = Math.max(height >> 1, 1);
                    }
                    const formatInfo = this.device.getDeviceCaps().textureCaps.getTextureFormatInfo(info.texture.format);
                    intermediateTexture = this._device.context.createTexture();
                    this._device.context.activeTexture(WebGLEnum.TEXTURE0);
                    this._device.context.bindTexture(WebGLEnum.TEXTURE_2D, intermediateTexture);
                    this._device.context.texImage2D(WebGLEnum.TEXTURE_2D, 0, formatInfo.glInternalFormat, width, height, 0, formatInfo.glFormat, formatInfo.glType[0], null);
                    intermediateAttachments[info.level] = {
                        texture: intermediateTexture,
                        width,
                        height
                    };
                    this._device.bindTexture(WebGLEnum.TEXTURE_2D, 0, null);
                } else {
                    intermediateTexture = intermediateAttachments[info.level].texture;
                }
            }
            if (intermediateTexture) {
                this._device.context.framebufferTexture2D(WebGLEnum.FRAMEBUFFER, attachment, WebGLEnum.TEXTURE_2D, intermediateTexture, 0);
            } else {
                if (info.texture.isTexture2D()) {
                    if (intermediateTexture) {
                        this._device.context.framebufferRenderbuffer(WebGLEnum.FRAMEBUFFER, attachment, WebGLEnum.RENDERBUFFER, intermediateTexture);
                    } else {
                        this._device.context.framebufferTexture2D(WebGLEnum.FRAMEBUFFER, attachment, WebGLEnum.TEXTURE_2D, info.texture.object, info.level ?? 0);
                    }
                } else if (info.texture.isTextureCube()) {
                    this._device.context.framebufferTexture2D(WebGLEnum.FRAMEBUFFER, attachment, cubeMapFaceMap[info.face ?? CubeFace.PX], info.texture.object, info.level ?? 0);
                } else if (info.texture.isTexture2DArray() || info.texture.isTexture3D()) {
                    this._device.context.framebufferTextureLayer(WebGLEnum.FRAMEBUFFER, attachment, info.texture.object, info.level ?? 0, info.layer ?? 0);
                } else {
                    return false;
                }
            }
            return true;
        }
        return false;
    }
    _bindBuffers() {
        if (!this._object) {
            return false;
        }
        this._device.context.bindFramebuffer(WebGLEnum.FRAMEBUFFER, this._object);
        if (this._depthAttachmentTarget !== WebGLEnum.NONE) {
            if (!this._bindAttachment(this._depthAttachmentTarget, this._options.depthAttachment)) {
                return false;
            }
        }
        for(let i = 0; (i < this._options.colorAttachments?.length) ?? 0; i++){
            const opt = this._options.colorAttachments[i];
            if (opt.texture) {
                if (!this._bindAttachment(WebGLEnum.COLOR_ATTACHMENT0 + i, opt)) {
                    return false;
                }
            }
        }
        if (this._status === STATUS_UNCHECKED) {
            const status = this._device.context.checkFramebufferStatus(WebGLEnum.FRAMEBUFFER);
            if (status !== WebGLEnum.FRAMEBUFFER_COMPLETE) {
                console.error(`Framebuffer not complete: ${status}`);
                this._status = STATUS_FAILED;
            } else {
                this._status = STATUS_OK;
            }
        }
        return this._status === STATUS_OK;
    }
    _createRenderbufferAA(texture) {
        const renderBuffer = this._device.context.createRenderbuffer();
        const formatInfo = this.device.getDeviceCaps().textureCaps.getTextureFormatInfo(texture.format);
        this._device.context.bindRenderbuffer(WebGLEnum.RENDERBUFFER, renderBuffer);
        this._device.context.renderbufferStorageMultisample(WebGLEnum.RENDERBUFFER, this._options.sampleCount, formatInfo.glInternalFormat, this._options.depthAttachment.texture.width, this._options.depthAttachment.texture.height);
        return renderBuffer;
    }
    _bindBuffersAA() {
        if (!this._framebufferAA) {
            return true;
        }
        this._device.context.bindFramebuffer(WebGLEnum.FRAMEBUFFER, this._framebufferAA);
        if (this._depthAttachmentTarget !== WebGLEnum.NONE) {
            if (!this._depthAttachmentAA) {
                this._depthAttachmentAA = this._createRenderbufferAA(this._options.depthAttachment.texture);
            }
            this._device.context.framebufferRenderbuffer(WebGLEnum.FRAMEBUFFER, this._depthAttachmentTarget, WebGLEnum.RENDERBUFFER, this._depthAttachmentAA);
        }
        for(let i = 0; (i < this._options.colorAttachments?.length) ?? 0; i++){
            const opt = this._options.colorAttachments[i];
            if (opt.texture) {
                if (!this._colorAttachmentsAA[i]) {
                    this._colorAttachmentsAA[i] = this._createRenderbufferAA(this._options.colorAttachments[i].texture);
                }
                this._device.context.framebufferRenderbuffer(WebGLEnum.FRAMEBUFFER, WebGLEnum.COLOR_ATTACHMENT0 + i, WebGLEnum.RENDERBUFFER, this._colorAttachmentsAA[i]);
            }
        }
        if (this._statusAA === STATUS_UNCHECKED) {
            const status = this._device.context.checkFramebufferStatus(WebGLEnum.FRAMEBUFFER);
            if (status !== WebGLEnum.FRAMEBUFFER_COMPLETE) {
                console.error(`Framebuffer not complete: ${status}`);
                this._statusAA = STATUS_FAILED;
            } else {
                this._statusAA = STATUS_OK;
            }
        }
        return this._statusAA === STATUS_OK;
    }
    _init() {
        if (this._options.sampleCount !== 1 && this._options.sampleCount !== 4) {
            throw new Error(`WebGLFramebuffer(): Sample should be 1 or 4, got ${this._options.sampleCount}`);
        }
        if (this._options.sampleCount > 1 && !this._device.getDeviceCaps().framebufferCaps.supportMultisampledFramebuffer) {
            throw new Error('WebGLFramebuffer(): Multisampled frame buffer not supported');
        }
        this._load();
    }
    isFramebuffer() {
        return true;
    }
    getSampleCount() {
        return this._options.sampleCount;
    }
}

class WebGLRenderState {
    static _defaultState;
    static _currentState;
    apply(gl, force) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const c = this.constructor;
        if (force || c._currentState !== this) {
            this._apply(gl);
        }
        c._currentState = this;
    }
    static get defaultState() {
        return WebGLRenderState._defaultState;
    }
    static applyDefaults(gl, force) {
        if (force || this._currentState !== this._defaultState) {
            this._defaultState.apply(gl, force);
        }
    }
}
class WebGLColorState extends WebGLRenderState {
    static _defaultState = new WebGLColorState();
    static _currentState = null;
    redMask;
    greenMask;
    blueMask;
    alphaMask;
    constructor(){
        super();
        this.redMask = this.greenMask = this.blueMask = this.alphaMask = true;
    }
    clone() {
        return new WebGLColorState().setColorMask(this.redMask, this.greenMask, this.blueMask, this.alphaMask);
    }
    setColorMask(r, g, b, a) {
        this.redMask = r;
        this.greenMask = g;
        this.blueMask = b;
        this.alphaMask = a;
        return this;
    }
    _apply(gl) {
        gl.colorMask(this.redMask, this.greenMask, this.blueMask, this.alphaMask);
    }
}
class WebGLBlendingState extends WebGLRenderState {
    static _defaultState = new WebGLBlendingState();
    static _currentState = null;
    _srcBlendRGB;
    _dstBlendRGB;
    _srcBlendAlpha;
    _dstBlendAlpha;
    _rgbEquation;
    _alphaEquation;
    enabled;
    alphaToCoverageEnabled;
    constructor(){
        super();
        this.enabled = false;
        this.alphaToCoverageEnabled = false;
        this.srcBlendRGB = 'one';
        this.dstBlendRGB = 'zero';
        this.srcBlendAlpha = 'one';
        this.dstBlendAlpha = 'zero';
        this.rgbEquation = 'add';
        this.alphaEquation = 'add';
    }
    clone() {
        const other = new WebGLBlendingState();
        other.enable(this.enabled);
        other.enableAlphaToCoverage(this.alphaToCoverageEnabled);
        other.setBlendFuncRGB(this.srcBlendRGB, this.dstBlendRGB);
        other.setBlendFuncAlpha(this.srcBlendAlpha, this.dstBlendAlpha);
        other.setBlendEquation(this.rgbEquation, this.alphaEquation);
        return other;
    }
    get srcBlendRGB() {
        return blendFuncInvMap[this._srcBlendRGB];
    }
    set srcBlendRGB(val) {
        this._srcBlendRGB = blendFuncMap[val];
    }
    get dstBlendRGB() {
        return blendFuncInvMap[this._dstBlendRGB];
    }
    set dstBlendRGB(val) {
        this._dstBlendRGB = blendFuncMap[val];
    }
    get srcBlendAlpha() {
        return blendFuncInvMap[this._srcBlendAlpha];
    }
    set srcBlendAlpha(val) {
        this._srcBlendAlpha = blendFuncMap[val];
    }
    get dstBlendAlpha() {
        return blendFuncInvMap[this._dstBlendAlpha];
    }
    set dstBlendAlpha(val) {
        this._dstBlendAlpha = blendFuncMap[val];
    }
    get rgbEquation() {
        return blendEquationInvMap[this._rgbEquation];
    }
    set rgbEquation(val) {
        this._rgbEquation = blendEquationMap[val];
    }
    get alphaEquation() {
        return blendEquationInvMap[this._alphaEquation];
    }
    set alphaEquation(val) {
        this._alphaEquation = blendEquationMap[val];
    }
    enable(b) {
        this.enabled = !!b;
        return this;
    }
    enableAlphaToCoverage(b) {
        this.alphaToCoverageEnabled = !!b;
        return this;
    }
    setBlendFunc(src, dest) {
        this.srcBlendRGB = src;
        this.dstBlendRGB = dest;
        this.srcBlendAlpha = src;
        this.dstBlendAlpha = dest;
        return this;
    }
    setBlendFuncRGB(src, dest) {
        this.srcBlendRGB = src;
        this.dstBlendRGB = dest;
        return this;
    }
    setBlendFuncAlpha(src, dest) {
        this.srcBlendAlpha = src;
        this.dstBlendAlpha = dest;
        return this;
    }
    setBlendEquation(rgb, alpha) {
        this.rgbEquation = rgb;
        this.alphaEquation = alpha;
        return this;
    }
    _apply(gl) {
        if (this.enabled) {
            gl.enable(WebGLEnum.BLEND);
            gl.blendEquationSeparate(this._rgbEquation, this._alphaEquation);
            if (this._srcBlendRGB === this._srcBlendAlpha && this._dstBlendRGB === this._dstBlendAlpha) {
                gl.blendFunc(this._srcBlendRGB, this._dstBlendRGB);
            } else {
                gl.blendFuncSeparate(this._srcBlendRGB, this._dstBlendRGB, this._srcBlendAlpha, this._dstBlendAlpha);
            }
        } else {
            gl.disable(WebGLEnum.BLEND);
        }
        if (this.alphaToCoverageEnabled) {
            gl.enable(WebGLEnum.SAMPLE_ALPHA_TO_COVERAGE);
        } else {
            gl.disable(WebGLEnum.SAMPLE_ALPHA_TO_COVERAGE);
        }
    }
}
class WebGLRasterizerState extends WebGLRenderState {
    static _defaultState = new WebGLRasterizerState();
    static _currentState = null;
    _cullMode;
    constructor(){
        super();
        this.cullMode = 'back';
    }
    clone() {
        return new WebGLRasterizerState().setCullMode(this.cullMode);
    }
    get cullMode() {
        return faceModeInvMap[this._cullMode];
    }
    set cullMode(val) {
        this._cullMode = faceModeMap[val];
    }
    setCullMode(mode) {
        this.cullMode = mode;
        return this;
    }
    get depthClampEnabled() {
        return false;
    }
    set depthClampEnabled(val) {
        this.enableDepthClamp(val);
    }
    enableDepthClamp(enable) {
        if (enable) {
            console.error('Depth clamp not supported');
        }
        return this;
    }
    _apply(gl) {
        if (this.cullMode == 'none') {
            gl.disable(WebGLEnum.CULL_FACE);
        } else {
            gl.enable(WebGLEnum.CULL_FACE);
            gl.cullFace(this._cullMode);
        }
    }
}
class WebGLDepthState extends WebGLRenderState {
    static _defaultState = new WebGLDepthState();
    static _currentState = null;
    testEnabled;
    writeEnabled;
    _compareFunc;
    constructor(){
        super();
        this.testEnabled = true;
        this.writeEnabled = true;
        this.compareFunc = 'le';
    }
    clone() {
        const other = new WebGLDepthState();
        other.enableTest(this.testEnabled);
        other.enableWrite(this.writeEnabled);
        other.setCompareFunc(this.compareFunc);
        return other;
    }
    get compareFunc() {
        return compareFuncInvMap[this._compareFunc];
    }
    set compareFunc(val) {
        this._compareFunc = compareFuncMap[val];
    }
    enableTest(b) {
        this.testEnabled = b;
        return this;
    }
    enableWrite(b) {
        this.writeEnabled = b;
        return this;
    }
    setCompareFunc(func) {
        this.compareFunc = func;
        return this;
    }
    _apply(gl) {
        if (this.testEnabled) {
            gl.enable(WebGLEnum.DEPTH_TEST);
            gl.depthFunc(this._compareFunc);
        } else {
            gl.disable(WebGLEnum.DEPTH_TEST);
        }
        gl.depthMask(this.writeEnabled);
    }
}
class WebGLStencilState extends WebGLRenderState {
    static _defaultState = new WebGLStencilState();
    static _currentState = null;
    enabled;
    writeMask;
    ref;
    readMask;
    _failOp;
    _failOpBack;
    _zFailOp;
    _zFailOpBack;
    _passOp;
    _passOpBack;
    _func;
    _funcBack;
    constructor(){
        super();
        this.enabled = false;
        this.failOp = this.failOpBack = 'keep';
        this.zFailOp = this.zFailOpBack = 'keep';
        this.passOp = this.passOpBack = 'keep';
        this.func = this.funcBack = 'always';
        this.ref = 0;
        this.writeMask = 0xffffffff;
        this.readMask = 0xffffffff;
    }
    clone() {
        const other = new WebGLStencilState();
        other.enable(this.enabled);
        other.setWriteMask(this.writeMask);
        other.setFrontOp(this.failOp, this.zFailOp, this.passOp);
        other.setBackOp(this.failOpBack, this.zFailOpBack, this.passOpBack);
        other.setFrontCompareFunc(this.func);
        other.setBackCompareFunc(this.funcBack);
        other.setReference(this.ref);
        other.setReadMask(this.readMask);
        return other;
    }
    get failOp() {
        return stencilOpInvMap[this._failOp];
    }
    set failOp(val) {
        this._failOp = stencilOpMap[val];
    }
    get failOpBack() {
        return stencilOpInvMap[this._failOpBack];
    }
    set failOpBack(val) {
        this._failOpBack = stencilOpMap[val];
    }
    get zFailOp() {
        return stencilOpInvMap[this._zFailOp];
    }
    set zFailOp(val) {
        this._zFailOp = stencilOpMap[val];
    }
    get zFailOpBack() {
        return stencilOpInvMap[this._zFailOpBack];
    }
    set zFailOpBack(val) {
        this._zFailOpBack = stencilOpMap[val];
    }
    get passOp() {
        return stencilOpInvMap[this._passOp];
    }
    set passOp(val) {
        this._passOp = stencilOpMap[val];
    }
    get passOpBack() {
        return stencilOpInvMap[this._passOpBack];
    }
    set passOpBack(val) {
        this._passOpBack = stencilOpMap[val];
    }
    get func() {
        return compareFuncInvMap[this._func];
    }
    set func(val) {
        this._func = compareFuncMap[val];
    }
    get funcBack() {
        return compareFuncInvMap[this._funcBack];
    }
    set funcBack(val) {
        this._funcBack = compareFuncMap[val];
    }
    enable(b) {
        this.enabled = b;
        return this;
    }
    setWriteMask(mask) {
        this.writeMask = mask;
        return this;
    }
    setFrontOp(fail, zfail, zpass) {
        this.failOp = fail;
        this.zFailOp = zfail;
        this.passOp = zpass;
        return this;
    }
    setBackOp(fail, zfail, zpass) {
        this.failOpBack = fail;
        this.zFailOpBack = zfail;
        this.passOpBack = zpass;
        return this;
    }
    setFrontCompareFunc(func) {
        this.func = func;
        return this;
    }
    setBackCompareFunc(func) {
        this.funcBack = func;
        return this;
    }
    setReference(ref) {
        this.ref = ref;
        return this;
    }
    setReadMask(mask) {
        this.readMask = mask;
        return this;
    }
    _apply(gl) {
        if (this.enabled) {
            gl.enable(WebGLEnum.STENCIL_TEST);
            gl.stencilMaskSeparate(WebGLEnum.FRONT, this.writeMask);
            gl.stencilMaskSeparate(WebGLEnum.BACK, this.writeMask);
            gl.stencilFuncSeparate(WebGLEnum.FRONT, this._func, this.ref, this.readMask);
            gl.stencilFuncSeparate(WebGLEnum.BACK, this._funcBack, this.ref, this.readMask);
            gl.stencilOpSeparate(WebGLEnum.FRONT, this._failOp, this._zFailOp, this._passOp);
            gl.stencilOpSeparate(WebGLEnum.BACK, this._failOpBack, this._zFailOpBack, this._passOpBack);
        } else {
            gl.disable(WebGLEnum.STENCIL_TEST);
        }
    }
}
class WebGLRenderStateSet {
    _gl;
    colorState;
    blendingState;
    rasterizerState;
    depthState;
    stencilState;
    constructor(gl){
        this._gl = gl;
        this.colorState = null;
        this.blendingState = null;
        this.rasterizerState = null;
        this.depthState = null;
        this.stencilState = null;
    }
    clone() {
        const newStateSet = new WebGLRenderStateSet(this._gl);
        newStateSet.colorState = (this.colorState?.clone()) ?? null;
        newStateSet.blendingState = (this.blendingState?.clone()) ?? null;
        newStateSet.rasterizerState = (this.rasterizerState?.clone()) ?? null;
        newStateSet.depthState = (this.depthState?.clone()) ?? null;
        newStateSet.stencilState = (this.stencilState?.clone()) ?? null;
        return newStateSet;
    }
    copyFrom(stateSet) {
        this.colorState = stateSet.colorState;
        this.blendingState = stateSet.blendingState;
        this.rasterizerState = stateSet.rasterizerState;
        this.depthState = stateSet.depthState;
        this.stencilState = stateSet.stencilState;
    }
    apply(force) {
        const gl = this._gl;
        if (this.colorState) {
            this.colorState.apply(gl, force);
        } else {
            WebGLColorState.applyDefaults(gl, force);
        }
        if (this.blendingState) {
            this.blendingState.apply(gl, force);
        } else {
            WebGLBlendingState.applyDefaults(gl, force);
        }
        if (this.rasterizerState) {
            this.rasterizerState.apply(gl, force);
        } else {
            WebGLRasterizerState.applyDefaults(gl, force);
        }
        if (this.depthState) {
            this.depthState.apply(gl, force);
        } else {
            WebGLDepthState.applyDefaults(gl, force);
        }
        if (this.stencilState) {
            this.stencilState.apply(gl, force);
        } else {
            WebGLStencilState.applyDefaults(gl, force);
        }
    }
    useColorState(state) {
        return this.colorState = state ?? this.colorState ?? new WebGLColorState();
    }
    defaultColorState() {
        this.colorState = null;
    }
    useBlendingState(state) {
        return this.blendingState = state ?? this.blendingState ?? new WebGLBlendingState();
    }
    defaultBlendingState() {
        this.blendingState = null;
    }
    useRasterizerState(state) {
        return this.rasterizerState = state ?? this.rasterizerState ?? new WebGLRasterizerState();
    }
    defaultRasterizerState() {
        this.rasterizerState = null;
    }
    useDepthState(state) {
        return this.depthState = state ?? this.depthState ?? new WebGLDepthState();
    }
    defaultDepthState() {
        this.depthState = null;
    }
    useStencilState(state) {
        return this.stencilState = state ?? this.stencilState ?? new WebGLStencilState();
    }
    defaultStencilState() {
        this.stencilState = null;
    }
    static applyDefaults(gl, force) {
        WebGLColorState.applyDefaults(gl, force);
        WebGLBlendingState.applyDefaults(gl, force);
        WebGLRasterizerState.applyDefaults(gl, force);
        WebGLDepthState.applyDefaults(gl, force);
        WebGLStencilState.applyDefaults(gl, force);
    }
}

const GPU_DISJOINT_EXT = 0x8fbb;
const TIME_ELAPSED_EXT = 0x88bf;
var QueryState;
(function(QueryState) {
    QueryState[QueryState["QUERY_STATE_NONE"] = 0] = "QUERY_STATE_NONE";
    QueryState[QueryState["QUERY_STATE_QUERYING"] = 1] = "QUERY_STATE_QUERYING";
    QueryState[QueryState["QUERY_STATE_FINISHED"] = 2] = "QUERY_STATE_FINISHED";
})(QueryState || (QueryState = {}));
class GPUTimer {
    _device;
    _query;
    _state;
    _timerQuery;
    _gpuTime;
    constructor(device){
        this._device = device;
        this._state = 0;
        this._gpuTime = null;
        const gl = this._device.context;
        if (isWebGL2(gl)) {
            const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
            if (ext) {
                this._timerQuery = {
                    createQuery: gl.createQuery.bind(gl),
                    deleteQuery: gl.deleteQuery.bind(gl),
                    beginQuery: gl.beginQuery.bind(gl),
                    endQuery: gl.endQuery.bind(gl),
                    isQuery: gl.isQuery.bind(gl),
                    getQuery: gl.getQuery.bind(gl),
                    getQueryObject: gl.getQueryParameter.bind(gl),
                    queryCounter: ext.queryCounterEXT.bind(ext)
                };
            }
        } else {
            const ext = gl.getExtension('EXT_disjoint_timer_query');
            if (ext) {
                this._timerQuery = {
                    createQuery: ext.createQueryEXT.bind(ext),
                    deleteQuery: ext.deleteQueryEXT.bind(ext),
                    beginQuery: ext.beginQueryEXT.bind(ext),
                    endQuery: ext.endQueryEXT.bind(ext),
                    isQuery: ext.isQueryEXT.bind(ext),
                    getQuery: ext.getQueryEXT.bind(ext),
                    getQueryObject: ext.getQueryObjectEXT.bind(ext),
                    queryCounter: ext.queryCounterEXT.bind(ext)
                };
            }
        }
        this._query = this._timerQuery ? this._timerQuery.createQuery() : null;
    }
    get gpuTimerSupported() {
        return !!this._query;
    }
    begin() {
        if (this._state === 1) {
            this.end();
        }
        if (this._query) {
            this._timerQuery.beginQuery(TIME_ELAPSED_EXT, this._query);
        }
        this._gpuTime = null;
        this._state = 1;
    }
    end() {
        if (this._state === 1) {
            if (this._query) {
                this._timerQuery.endQuery(TIME_ELAPSED_EXT);
            }
            this._state = 2;
        }
    }
    ended() {
        return this._state !== 1;
    }
    elapsed() {
        if (this._state === 2) {
            if (this._gpuTime === null && this._query && this._timerQuery.getQueryObject(this._query, WebGLEnum.QUERY_RESULT_AVAILABLE)) {
                const gpuTimerDisjoint = this._device.context.getParameter(GPU_DISJOINT_EXT);
                if (!gpuTimerDisjoint) {
                    this._gpuTime = Number(this._timerQuery.getQueryObject(this._query, WebGLEnum.QUERY_RESULT)) / 1000000;
                }
            }
        }
        return this._gpuTime;
    }
}

class WebGLFramebufferCaps {
    _isWebGL2;
    _extDrawBuffers;
    _extFloatBlending;
    maxDrawBuffers;
    maxColorAttachmentBytesPerSample;
    supportMultisampledFramebuffer;
    supportFloatBlending;
    supportDepth32float;
    supportDepth32floatStencil8;
    constructor(gl){
        this._isWebGL2 = isWebGL2(gl);
        this._extDrawBuffers = this._isWebGL2 ? null : gl.getExtension('WEBGL_draw_buffers');
        this._extFloatBlending = gl.getExtension('EXT_float_blend');
        this.maxDrawBuffers = this._isWebGL2 || this._extDrawBuffers ? Math.min(gl.getParameter(WebGLEnum.MAX_COLOR_ATTACHMENTS), gl.getParameter(WebGLEnum.MAX_DRAW_BUFFERS)) : 1;
        this.maxColorAttachmentBytesPerSample = this.maxDrawBuffers * 16;
        this.supportMultisampledFramebuffer = isWebGL2(gl);
        this.supportFloatBlending = !!this._extFloatBlending;
        this.supportDepth32float = this._isWebGL2;
        this.supportDepth32floatStencil8 = this._isWebGL2;
    }
}
class WebGLMiscCaps {
    _isWebGL2;
    _extIndexUint32;
    _extBlendMinMax;
    supportOversizedViewport;
    supportBlendMinMax;
    support32BitIndex;
    supportDepthClamp;
    maxBindGroups;
    maxTexCoordIndex;
    constructor(gl){
        this._isWebGL2 = isWebGL2(gl);
        this._extBlendMinMax = null;
        this._extIndexUint32 = isWebGL2 ? gl.getExtension('OES_element_index_uint') : null;
        if (this._isWebGL2) {
            this.supportBlendMinMax = true;
            this.support32BitIndex = true;
        } else {
            this._extBlendMinMax = gl.getExtension('EXT_blend_minmax');
            this.supportBlendMinMax = !!this._extBlendMinMax;
            this.support32BitIndex = !!this._extIndexUint32;
        }
        this.supportOversizedViewport = true;
        this.supportDepthClamp = false;
        this.maxBindGroups = 4;
        this.maxTexCoordIndex = 8;
    }
}
class WebGLShaderCaps {
    _extFragDepth;
    _extStandardDerivatives;
    _extShaderTextureLod;
    supportFragmentDepth;
    supportStandardDerivatives;
    supportShaderTextureLod;
    supportHighPrecisionFloat;
    supportHighPrecisionInt;
    maxUniformBufferSize;
    uniformBufferOffsetAlignment;
    maxStorageBufferSize;
    storageBufferOffsetAlignment;
    constructor(gl){
        this._extFragDepth = null;
        this._extStandardDerivatives = null;
        this.maxStorageBufferSize = 0;
        this.storageBufferOffsetAlignment = 0;
        if (isWebGL2(gl)) {
            this.supportFragmentDepth = true;
            this.supportStandardDerivatives = true;
            this.supportShaderTextureLod = true;
            this.supportHighPrecisionFloat = true;
            this.maxUniformBufferSize = gl.getParameter(gl.MAX_UNIFORM_BLOCK_SIZE) || 16384;
            this.uniformBufferOffsetAlignment = gl.getParameter(gl.UNIFORM_BUFFER_OFFSET_ALIGNMENT) || 256;
        } else {
            this._extFragDepth = gl.getExtension('EXT_frag_depth');
            this.supportFragmentDepth = !!this._extFragDepth;
            this._extStandardDerivatives = gl.getExtension('OES_standard_derivatives');
            this.supportStandardDerivatives = !!this._extStandardDerivatives;
            this._extShaderTextureLod = gl.getExtension('EXT_shader_texture_lod');
            this.supportShaderTextureLod = !!this._extShaderTextureLod;
            this.supportHighPrecisionFloat = gl.getShaderPrecisionFormat && !!gl.getShaderPrecisionFormat(gl.VERTEX_SHADER, gl.HIGH_FLOAT)?.precision && !!gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT)?.precision;
            this.maxUniformBufferSize = 0;
            this.uniformBufferOffsetAlignment = 1;
        }
    }
}
class WebGLTextureCaps {
    _isWebGL2;
    _extS3TC;
    _extS3TCSRGB;
    _extTextureFilterAnisotropic;
    _extDepthTexture;
    _extSRGB;
    _extTextureFloat;
    _extTextureFloatLinear;
    _extTextureHalfFloat;
    _extTextureHalfFloatLinear;
    _textureFormatInfos;
    maxTextureSize;
    maxCubeTextureSize;
    npo2Mipmapping;
    npo2Repeating;
    supportS3TC;
    supportS3TCSRGB;
    supportDepthTexture;
    support3DTexture;
    supportSRGBTexture;
    supportFloatTexture;
    supportLinearFloatTexture;
    supportHalfFloatTexture;
    supportLinearHalfFloatTexture;
    supportAnisotropicFiltering;
    supportFloatColorBuffer;
    supportHalfFloatColorBuffer;
    supportFloatBlending;
    constructor(gl){
        this._isWebGL2 = isWebGL2(gl);
        this._extTextureFilterAnisotropic = gl.getExtension('EXT_texture_filter_anisotropic') || gl.getExtension('MOZ_EXT_texture_filter_anisotropic') || gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic');
        this.supportAnisotropicFiltering = !!this._extTextureFilterAnisotropic;
        if (this._isWebGL2) {
            this.supportDepthTexture = true;
        } else {
            this._extDepthTexture = gl.getExtension('WEBGL_depth_texture');
            this.supportDepthTexture = !!this._extDepthTexture;
        }
        this.support3DTexture = this._isWebGL2;
        this._extSRGB = this._isWebGL2 ? null : gl.getExtension('EXT_sRGB');
        this.supportSRGBTexture = this._isWebGL2 || !!this._extSRGB;
        if (this._isWebGL2) {
            this.supportFloatTexture = true;
        } else {
            this._extTextureFloat = gl.getExtension('OES_texture_float');
            this.supportFloatTexture = !!this._extTextureFloat;
        }
        this._extTextureFloatLinear = gl.getExtension('OES_texture_float_linear');
        this.supportLinearFloatTexture = !!this._extTextureFloatLinear;
        if (this._isWebGL2) {
            this.supportHalfFloatTexture = true;
            this.supportLinearHalfFloatTexture = true;
        } else {
            this._extTextureHalfFloat = gl.getExtension('OES_texture_half_float');
            this.supportHalfFloatTexture = !!this._extTextureHalfFloat;
            this._extTextureHalfFloatLinear = gl.getExtension('OES_texture_half_float_linear');
            this.supportLinearHalfFloatTexture = !!this._extTextureHalfFloatLinear;
        }
        if (this._isWebGL2) {
            if (gl.getExtension('EXT_color_buffer_float')) {
                this.supportHalfFloatColorBuffer = true;
                this.supportFloatColorBuffer = true;
            } else if (gl.getExtension('EXT_color_buffer_half_float')) {
                this.supportHalfFloatColorBuffer = true;
                this.supportFloatColorBuffer = false;
            } else {
                this.supportHalfFloatColorBuffer = false;
                this.supportFloatColorBuffer = false;
            }
        } else {
            this.supportFloatColorBuffer = !!gl.getExtension('WEBGL_color_buffer_float');
            this.supportHalfFloatColorBuffer = !!gl.getExtension('EXT_color_buffer_half_float');
        }
        this.supportFloatBlending = this.supportFloatColorBuffer && !!gl.getExtension('EXT_float_blend');
        this._extS3TC = gl.getExtension('WEBGL_compressed_texture_s3tc') || gl.getExtension('MOZ_WEBGL_compressed_texture_s3tc') || gl.getExtension('WEBKIT_WEBGL_compressed_texture_s3tc');
        this.supportS3TC = !!this._extS3TC;
        this._extS3TCSRGB = gl.getExtension('WEBGL_compressed_texture_s3tc_srgb');
        this.supportS3TCSRGB = !!this._extS3TCSRGB;
        this.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
        this.maxCubeTextureSize = gl.getParameter(gl.MAX_CUBE_MAP_TEXTURE_SIZE);
        if (this._isWebGL2) {
            this.npo2Mipmapping = true;
            this.npo2Repeating = true;
        } else {
            this.npo2Mipmapping = false;
            this.npo2Repeating = false;
        }
        this._textureFormatInfos = {
            rgba8unorm: {
                glFormat: gl.RGBA,
                glInternalFormat: this._isWebGL2 ? gl.RGBA8 : gl.RGBA,
                glType: [
                    gl.UNSIGNED_BYTE,
                    gl.UNSIGNED_SHORT_4_4_4_4,
                    gl.UNSIGNED_SHORT_5_5_5_1
                ],
                filterable: true,
                renderable: true,
                compressed: false
            }
        };
        if (this.supportS3TC) {
            this._textureFormatInfos['dxt1'] = {
                glFormat: gl.NONE,
                glInternalFormat: this._extS3TC.COMPRESSED_RGB_S3TC_DXT1_EXT,
                glType: [
                    gl.NONE
                ],
                filterable: true,
                renderable: false,
                compressed: true
            };
            this._textureFormatInfos['dxt3'] = {
                glFormat: gl.NONE,
                glInternalFormat: this._extS3TC.COMPRESSED_RGBA_S3TC_DXT3_EXT,
                glType: [
                    gl.NONE
                ],
                filterable: true,
                renderable: false,
                compressed: true
            };
            this._textureFormatInfos['dxt5'] = {
                glFormat: gl.NONE,
                glInternalFormat: this._extS3TC.COMPRESSED_RGBA_S3TC_DXT5_EXT,
                glType: [
                    gl.NONE
                ],
                filterable: true,
                renderable: false,
                compressed: true
            };
        }
        if (this.supportS3TCSRGB) {
            this._textureFormatInfos['dxt1-srgb'] = {
                glFormat: gl.NONE,
                glInternalFormat: this._extS3TCSRGB.COMPRESSED_SRGB_S3TC_DXT1_EXT,
                glType: [
                    gl.NONE
                ],
                filterable: true,
                renderable: false,
                compressed: true
            };
            this._textureFormatInfos['dxt3-srgb'] = {
                glFormat: gl.NONE,
                glInternalFormat: this._extS3TCSRGB.COMPRESSED_SRGB_ALPHA_S3TC_DXT3_EXT,
                glType: [
                    gl.NONE
                ],
                filterable: true,
                renderable: false,
                compressed: true
            };
            this._textureFormatInfos['dxt5-srgb'] = {
                glFormat: gl.NONE,
                glInternalFormat: this._extS3TCSRGB.COMPRESSED_SRGB_ALPHA_S3TC_DXT5_EXT,
                glType: [
                    gl.NONE
                ],
                filterable: true,
                renderable: false,
                compressed: true
            };
        }
        if (isWebGL2(gl)) {
            this._textureFormatInfos['r8unorm'] = {
                glFormat: gl.RED,
                glInternalFormat: gl.R8,
                glType: [
                    gl.UNSIGNED_BYTE
                ],
                filterable: true,
                renderable: true,
                compressed: false
            };
            this._textureFormatInfos['r8snorm'] = {
                glFormat: gl.RED,
                glInternalFormat: gl.R8_SNORM,
                glType: [
                    gl.BYTE
                ],
                filterable: true,
                renderable: false,
                compressed: false
            };
            this._textureFormatInfos['r16f'] = {
                glFormat: gl.RED,
                glInternalFormat: gl.R16F,
                glType: [
                    gl.HALF_FLOAT,
                    gl.FLOAT
                ],
                filterable: this.supportLinearHalfFloatTexture,
                renderable: this.supportHalfFloatColorBuffer,
                compressed: false
            };
            this._textureFormatInfos['r32f'] = {
                glFormat: gl.RED,
                glInternalFormat: gl.R32F,
                glType: [
                    gl.FLOAT
                ],
                filterable: this.supportLinearFloatTexture,
                renderable: this.supportFloatColorBuffer,
                compressed: false
            };
            this._textureFormatInfos['r8ui'] = {
                glFormat: gl.RED_INTEGER,
                glInternalFormat: gl.R8UI,
                glType: [
                    gl.UNSIGNED_BYTE
                ],
                filterable: false,
                renderable: true,
                compressed: false
            };
            this._textureFormatInfos['r8i'] = {
                glFormat: gl.RED_INTEGER,
                glInternalFormat: gl.R8I,
                glType: [
                    gl.BYTE
                ],
                filterable: false,
                renderable: true,
                compressed: false
            };
            this._textureFormatInfos['r16ui'] = {
                glFormat: gl.RED_INTEGER,
                glInternalFormat: gl.R16UI,
                glType: [
                    gl.UNSIGNED_SHORT
                ],
                filterable: false,
                renderable: true,
                compressed: false
            };
            this._textureFormatInfos['r16i'] = {
                glFormat: gl.RED_INTEGER,
                glInternalFormat: gl.R16I,
                glType: [
                    gl.SHORT
                ],
                filterable: false,
                renderable: true,
                compressed: false
            };
            this._textureFormatInfos['r32ui'] = {
                glFormat: gl.RED_INTEGER,
                glInternalFormat: gl.R32UI,
                glType: [
                    gl.UNSIGNED_INT
                ],
                filterable: false,
                renderable: true,
                compressed: false
            };
            this._textureFormatInfos['r32i'] = {
                glFormat: gl.RED_INTEGER,
                glInternalFormat: gl.R32I,
                glType: [
                    gl.INT
                ],
                filterable: false,
                renderable: true,
                compressed: false
            };
            this._textureFormatInfos['rg8unorm'] = {
                glFormat: gl.RG,
                glInternalFormat: gl.RG8,
                glType: [
                    gl.UNSIGNED_BYTE
                ],
                filterable: true,
                renderable: true,
                compressed: false
            };
            this._textureFormatInfos['rg8snorm'] = {
                glFormat: gl.RG,
                glInternalFormat: gl.RG8_SNORM,
                glType: [
                    gl.BYTE
                ],
                filterable: true,
                renderable: false,
                compressed: false
            };
            this._textureFormatInfos['rg16f'] = {
                glFormat: gl.RG,
                glInternalFormat: gl.RG16F,
                glType: [
                    gl.HALF_FLOAT,
                    gl.FLOAT
                ],
                filterable: this.supportLinearHalfFloatTexture,
                renderable: this.supportHalfFloatColorBuffer,
                compressed: false
            };
            this._textureFormatInfos['rg32f'] = {
                glFormat: gl.RG,
                glInternalFormat: gl.RG32F,
                glType: [
                    gl.FLOAT
                ],
                filterable: this.supportLinearFloatTexture,
                renderable: this.supportFloatColorBuffer,
                compressed: false
            };
            this._textureFormatInfos['rg8ui'] = {
                glFormat: gl.RG,
                glInternalFormat: gl.RG8UI,
                glType: [
                    gl.UNSIGNED_BYTE
                ],
                filterable: false,
                renderable: true,
                compressed: false
            };
            this._textureFormatInfos['rg8i'] = {
                glFormat: gl.RG,
                glInternalFormat: gl.RG8I,
                glType: [
                    gl.BYTE
                ],
                filterable: false,
                renderable: true,
                compressed: false
            };
            this._textureFormatInfos['rg16ui'] = {
                glFormat: gl.RG,
                glInternalFormat: gl.RG16UI,
                glType: [
                    gl.UNSIGNED_SHORT
                ],
                filterable: false,
                renderable: true,
                compressed: false
            };
            this._textureFormatInfos['rg16i'] = {
                glFormat: gl.RG,
                glInternalFormat: gl.RG16I,
                glType: [
                    gl.SHORT
                ],
                filterable: false,
                renderable: true,
                compressed: false
            };
            this._textureFormatInfos['rg32ui'] = {
                glFormat: gl.RG,
                glInternalFormat: gl.RG32UI,
                glType: [
                    gl.UNSIGNED_INT
                ],
                filterable: false,
                renderable: true,
                compressed: false
            };
            this._textureFormatInfos['rg32i'] = {
                glFormat: gl.RG,
                glInternalFormat: gl.RG32I,
                glType: [
                    gl.INT
                ],
                filterable: false,
                renderable: true,
                compressed: false
            };
            this._textureFormatInfos['rgba8unorm-srgb'] = {
                glFormat: gl.RGBA,
                glInternalFormat: gl.SRGB8_ALPHA8,
                glType: [
                    gl.UNSIGNED_BYTE
                ],
                filterable: true,
                renderable: true,
                compressed: false
            };
            this._textureFormatInfos['rgba8snorm'] = {
                glFormat: gl.RGBA,
                glInternalFormat: gl.RGBA8_SNORM,
                glType: [
                    gl.BYTE
                ],
                filterable: true,
                renderable: false,
                compressed: false
            };
            this._textureFormatInfos['rgba16f'] = {
                glFormat: gl.RGBA,
                glInternalFormat: gl.RGBA16F,
                glType: [
                    gl.HALF_FLOAT,
                    gl.FLOAT
                ],
                filterable: this.supportLinearHalfFloatTexture,
                renderable: this.supportHalfFloatColorBuffer,
                compressed: false
            };
            this._textureFormatInfos['rgba32f'] = {
                glFormat: gl.RGBA,
                glInternalFormat: gl.RGBA32F,
                glType: [
                    gl.FLOAT
                ],
                filterable: this.supportLinearFloatTexture,
                renderable: this.supportFloatColorBuffer,
                compressed: false
            };
            this._textureFormatInfos['rgba8ui'] = {
                glFormat: gl.RGBA_INTEGER,
                glInternalFormat: gl.RGBA8UI,
                glType: [
                    gl.UNSIGNED_BYTE
                ],
                filterable: false,
                renderable: true,
                compressed: false
            };
            this._textureFormatInfos['rgba8i'] = {
                glFormat: gl.RGBA_INTEGER,
                glInternalFormat: gl.RGBA8I,
                glType: [
                    gl.BYTE
                ],
                filterable: false,
                renderable: true,
                compressed: false
            };
            this._textureFormatInfos['rgba16ui'] = {
                glFormat: gl.RGBA_INTEGER,
                glInternalFormat: gl.RGBA16UI,
                glType: [
                    gl.UNSIGNED_SHORT
                ],
                filterable: false,
                renderable: true,
                compressed: false
            };
            this._textureFormatInfos['rgba16i'] = {
                glFormat: gl.RGBA_INTEGER,
                glInternalFormat: gl.RGBA16I,
                glType: [
                    gl.SHORT
                ],
                filterable: false,
                renderable: true,
                compressed: false
            };
            this._textureFormatInfos['rgba32ui'] = {
                glFormat: gl.RGBA_INTEGER,
                glInternalFormat: gl.RGBA32UI,
                glType: [
                    gl.UNSIGNED_INT
                ],
                filterable: false,
                renderable: true,
                compressed: false
            };
            this._textureFormatInfos['rgba32i'] = {
                glFormat: gl.RGBA_INTEGER,
                glInternalFormat: gl.RGBA32I,
                glType: [
                    gl.INT
                ],
                filterable: false,
                renderable: true,
                compressed: false
            };
            this._textureFormatInfos['rg11b10uf'] = {
                glFormat: gl.RGB,
                glInternalFormat: gl.R11F_G11F_B10F,
                glType: [
                    gl.UNSIGNED_INT_10F_11F_11F_REV
                ],
                filterable: true,
                renderable: false,
                compressed: false
            };
            this._textureFormatInfos['d16'] = {
                glFormat: gl.DEPTH_COMPONENT,
                glInternalFormat: gl.DEPTH_COMPONENT16,
                glType: [
                    gl.UNSIGNED_SHORT,
                    gl.UNSIGNED_INT
                ],
                filterable: false,
                renderable: true,
                compressed: false
            };
            this._textureFormatInfos['d24'] = {
                glFormat: gl.DEPTH_COMPONENT,
                glInternalFormat: gl.DEPTH_COMPONENT24,
                glType: [
                    gl.UNSIGNED_INT
                ],
                filterable: false,
                renderable: true,
                compressed: false
            };
            this._textureFormatInfos['d32f'] = {
                glFormat: gl.DEPTH_COMPONENT,
                glInternalFormat: gl.DEPTH_COMPONENT32F,
                glType: [
                    gl.FLOAT
                ],
                filterable: false,
                renderable: true,
                compressed: false
            };
            this._textureFormatInfos['d24s8'] = {
                glFormat: gl.DEPTH_STENCIL,
                glInternalFormat: gl.DEPTH24_STENCIL8,
                glType: [
                    gl.UNSIGNED_INT_24_8
                ],
                filterable: false,
                renderable: true,
                compressed: false
            };
            this._textureFormatInfos['d32fs8'] = {
                glFormat: gl.DEPTH_STENCIL,
                glInternalFormat: gl.DEPTH32F_STENCIL8,
                glType: [
                    gl.FLOAT_32_UNSIGNED_INT_24_8_REV
                ],
                filterable: false,
                renderable: true,
                compressed: false
            };
        } else {
            if (this.supportFloatTexture) {
                this._textureFormatInfos['rgba32f'] = {
                    glFormat: gl.RGBA,
                    glInternalFormat: gl.RGBA,
                    glType: [
                        gl.FLOAT,
                        gl.UNSIGNED_BYTE,
                        gl.UNSIGNED_SHORT_4_4_4_4,
                        gl.UNSIGNED_SHORT_5_5_5_1
                    ],
                    filterable: this.supportLinearFloatTexture,
                    renderable: this.supportFloatColorBuffer,
                    compressed: false
                };
            }
            if (this.supportHalfFloatTexture) {
                this._textureFormatInfos['rgba16f'] = {
                    glFormat: gl.RGBA,
                    glInternalFormat: gl.RGBA,
                    glType: [
                        this._extTextureHalfFloat.HALF_FLOAT_OES,
                        gl.UNSIGNED_BYTE,
                        gl.UNSIGNED_SHORT_4_4_4_4,
                        gl.UNSIGNED_SHORT_5_5_5_1
                    ],
                    filterable: this.supportLinearHalfFloatTexture,
                    renderable: this.supportHalfFloatColorBuffer,
                    compressed: false
                };
            }
            if (this.supportSRGBTexture) {
                this._textureFormatInfos['rgba8unorm-srgb'] = {
                    glFormat: this._extSRGB.SRGB_ALPHA_EXT,
                    glInternalFormat: this._extSRGB.SRGB_ALPHA_EXT,
                    glType: [
                        gl.UNSIGNED_BYTE
                    ],
                    filterable: true,
                    renderable: false,
                    compressed: false
                };
            }
            if (this.supportDepthTexture) {
                this._textureFormatInfos['d16'] = {
                    glFormat: gl.DEPTH_COMPONENT,
                    glInternalFormat: gl.DEPTH_COMPONENT,
                    glType: [
                        gl.UNSIGNED_SHORT
                    ],
                    filterable: false,
                    renderable: true,
                    compressed: false
                };
                this._textureFormatInfos['d24'] = {
                    glFormat: gl.DEPTH_COMPONENT,
                    glInternalFormat: gl.DEPTH_COMPONENT,
                    glType: [
                        gl.UNSIGNED_INT
                    ],
                    filterable: false,
                    renderable: true,
                    compressed: false
                };
                this._textureFormatInfos['d24s8'] = {
                    glFormat: gl.DEPTH_STENCIL,
                    glInternalFormat: gl.DEPTH_STENCIL,
                    glType: [
                        this._extDepthTexture.UNSIGNED_INT_24_8_WEBGL
                    ],
                    filterable: false,
                    renderable: true,
                    compressed: false
                };
            }
        }
    }
    calcMemoryUsage(format, type, numPixels) {
        switch(format){
            case 'd16':
            case 'd24':
            case 'd24s8':
            case 'd32f':
                switch(type){
                    case WebGLEnum.UNSIGNED_SHORT:
                        return numPixels * 2;
                    default:
                        return numPixels * 4;
                }
            case 'd32fs8':
                return numPixels * 8;
            case 'dxt1':
            case 'dxt1-srgb':
                return numPixels / 2;
            case 'dxt3':
            case 'dxt3-srgb':
            case 'dxt5':
            case 'dxt5-srgb':
                return numPixels;
            case 'r16f':
                switch(type){
                    case WebGLEnum.HALF_FLOAT:
                        return numPixels * 2;
                    default:
                        return numPixels * 4;
                }
            case 'r16i':
            case 'r16ui':
                return numPixels * 2;
            case 'r32f':
            case 'r32i':
            case 'r32ui':
                return numPixels * 4;
            case 'r8unorm':
            case 'r8snorm':
            case 'r8i':
            case 'r8ui':
                return numPixels;
            case 'rg16f':
                switch(type){
                    case WebGLEnum.HALF_FLOAT:
                        return numPixels * 4;
                    default:
                        return numPixels * 8;
                }
            case 'rg16i':
            case 'rg16ui':
                return numPixels * 4;
            case 'rg32f':
            case 'rg32i':
            case 'rg32ui':
                return numPixels * 8;
            case 'rg8unorm':
            case 'rg8snorm':
            case 'rg8i':
            case 'rg8ui':
                return numPixels * 2;
            case 'rgba16f':
                switch(type){
                    case WebGLEnum.HALF_FLOAT:
                        return numPixels * 8;
                    default:
                        return numPixels * 16;
                }
            case 'rgba16i':
            case 'rgba16ui':
                return numPixels * 8;
            case 'rgba32f':
            case 'rgba32i':
            case 'rgba32ui':
                return numPixels * 16;
            case 'rgba8unorm':
            case 'rgba8unorm-srgb':
            case 'rgba8snorm':
            case 'rgba8i':
            case 'rgba8ui':
                return numPixels * 4;
            default:
                return 0;
        }
    }
    getTextureFormatInfo(format) {
        return this._textureFormatInfos[format];
    }
}

class WebGLStructuredBuffer extends WebGLGPUBuffer {
    _structure;
    _data;
    constructor(device, structure, usage, source){
        if (!structure?.isStructType()) {
            throw new Error('invalid structure type');
        }
        if (usage & GPUResourceUsageFlags.BF_INDEX) {
            throw new Error('structured buffer must not have Index usage flag');
        }
        if (usage & GPUResourceUsageFlags.BF_READ || usage & GPUResourceUsageFlags.BF_WRITE) {
            throw new Error('structured buffer must not have Read or Write usage flags');
        }
        if (usage & GPUResourceUsageFlags.BF_VERTEX) {
            if (structure.structMembers.length !== 1 || !structure.structMembers[0].type.isArrayType()) {
                throw new Error('structured buffer for vertex usage must have only one array member');
            }
            if (!WebGLStructuredBuffer.isValidArrayElementType(structure.structMembers[0].type.elementType)) {
                throw new Error('invalid vertex data type when creating vertex buffer');
            }
        }
        const layout = structure.toBufferLayout(0, structure.layout);
        if (source && layout.byteSize !== source.byteLength) {
            throw new Error(`create structured buffer failed: invalid source size: ${source.byteLength}, should be ${layout.byteSize}`);
        }
        const useSystemMemory = !device.isWebGL2 && (usage & GPUResourceUsageFlags.BF_UNIFORM) !== 0;
        super(device, usage, source || layout.byteSize, useSystemMemory);
        this._data = new StructuredBufferData(layout, useSystemMemory ? this.systemMemoryBuffer : this);
        this._structure = structure;
    }
    set(name, value) {
        this._data.set(name, value);
    }
    get structure() {
        return this._structure;
    }
    set structure(st) {
        if (st && !st.isCompatibleType(this._structure)) {
            const layout = st.toBufferLayout(0, st.layout);
            if (layout.byteSize > this.byteLength) {
                throw new Error(`set structure type failed: new structure type is too large: ${layout.byteSize}`);
            }
            this._data = new StructuredBufferData(layout, this);
            this._structure = st;
        }
    }
    getUniformData() {
        return this._data;
    }
    static isValidArrayElementType(type) {
        if (type.isPrimitiveType()) {
            return type.scalarType !== PBPrimitiveType.BOOL && !type.isMatrixType();
        } else if (type.isStructType()) {
            for (const member of type.structMembers){
                if (!member.type.isPrimitiveType() || member.type.scalarType === PBPrimitiveType.BOOL || member.type.isMatrixType()) {
                    return false;
                }
            }
            return true;
        }
        return false;
    }
}

class WebGLBindGroup extends WebGLGPUObject {
    _layout;
    _dynamicOffsets;
    _resources;
    constructor(device, layout){
        super(device);
        this._device = device;
        this._layout = layout;
        this._dynamicOffsets = null;
        this._resources = {};
        this._object = {};
        for (const entry of this._layout.entries){
            if (entry.buffer && entry.buffer.hasDynamicOffset) {
                if (!this._dynamicOffsets) {
                    this._dynamicOffsets = [];
                }
                this._dynamicOffsets[entry.buffer.dynamicOffsetIndex] = 0;
            }
        }
    }
    getGPUId() {
        return String(this._uid);
    }
    getLayout() {
        return this._layout;
    }
    getBuffer(name) {
        return this._getBuffer(name, true);
    }
    getDynamicOffsets() {
        return this._dynamicOffsets;
    }
    setBuffer(name, buffer, offset, bindOffset, bindSize) {
        const bindName = this._layout.nameMap?.[name] ?? name;
        for (const entry of this._layout.entries){
            if (entry.name === bindName) {
                if (!entry.buffer) {
                    console.log(`setBuffer() failed: resource '${name}' is not buffer`);
                } else {
                    if (buffer && !(buffer.usage & GPUResourceUsageFlags.BF_UNIFORM)) {
                        console.log(`setBuffer() failed: buffer resource '${name}' must be type '${entry.buffer.type}'`);
                    } else if (buffer !== this._resources[entry.name]) {
                        this._resources[entry.name] = buffer;
                    }
                    if (entry.buffer.hasDynamicOffset) {
                        this._dynamicOffsets[entry.buffer.dynamicOffsetIndex] = offset ?? 0;
                    }
                }
                return;
            }
        }
        console.log(`setBuffer() failed: no buffer resource named '${name}'`);
    }
    setRawData(name, byteOffset, data, srcPos, srcLength) {
        const mappedName = this._layout.nameMap?.[name];
        if (mappedName) {
            this.setRawData(mappedName, byteOffset, data, srcPos, srcLength);
        } else {
            const buffer = this._getBuffer(name, false);
            if (buffer) {
                buffer.bufferSubData(byteOffset, data, srcPos, srcLength);
            } else {
                console.log(`set(): no uniform buffer named '${name}'`);
            }
        }
    }
    setValue(name, value) {
        const mappedName = this._layout.nameMap?.[name];
        if (mappedName) {
            this.setValue(mappedName, {
                [name]: value
            });
        } else {
            const buffer = this._getBuffer(name, false);
            if (buffer) {
                if (!(buffer instanceof WebGLStructuredBuffer)) {
                    throw new Error(`BindGroup.setValue() failed: '${name}' is not structured buffer`);
                }
                if (value?.BYTES_PER_ELEMENT) {
                    buffer.bufferSubData(0, value);
                } else {
                    for(const k in value){
                        buffer.set(k, value[k]);
                    }
                }
            } else {
                console.log(`set(): no uniform buffer named '${name}'`);
            }
        }
    }
    setTextureView(name, value, level, face, mipCount, sampler) {
        throw new Error('setTextureView() not supported for webgl device');
    }
    getTexture(name) {
        const entry = this._findTextureLayout(name);
        if (entry) {
            return (this._resources[name]?.[0]) || null;
        } else {
            throw new Error(`getTexture() failed:${name} is not a texture`);
        }
    }
    setTexture(name, texture, sampler) {
        const entry = this._findTextureLayout(name);
        if (entry) {
            this._resources[name] = [
                texture,
                sampler || texture.getDefaultSampler(!!entry.texture?.autoBindSamplerComparison)
            ];
        } else {
            console.log(`setTexture() failed: no texture uniform named '${name}'`);
        }
    }
    setSampler(name, value) {
    // no sampler uniform support for webgl
    }
    apply(program, offsets) {
        const webgl2 = this._device.isWebGL2;
        const dynamicOffsets = offsets ?? this.getDynamicOffsets();
        for(let i = 0; i < this._layout.entries.length; i++){
            const entry = this._layout.entries[i];
            const res = this._resources[entry.name];
            if (res instanceof WebGLGPUBuffer) {
                if (webgl2) {
                    if (entry.buffer.hasDynamicOffset) {
                        program.setBlock(entry.type.structName, res, dynamicOffsets[entry.buffer.dynamicOffsetIndex]);
                    } else {
                        program.setBlock(entry.type.structName, res, 0);
                    }
                } else if (res instanceof WebGLStructuredBuffer) {
                    program.setUniform(entry.name, res.getUniformData().uniforms);
                }
            } else if (Array.isArray(res)) {
                if (res[0].isTextureVideo()) {
                    res[0].updateVideoFrame();
                }
                // res[0].sampler = res[1];
                program.setUniform(entry.name, res);
            }
        }
    }
    destroy() {
        this._resources = {};
        this._object = null;
    }
    async restore() {
        this._object = {};
    }
    isBindGroup() {
        return true;
    }
    _getBuffer(name, nocreate = false) {
        const bindName = this._layout.nameMap?.[name] ?? name;
        for (const entry of this._layout.entries){
            if (entry.buffer && entry.name === bindName) {
                let buffer = this._resources[entry.name];
                if (!buffer && !nocreate) {
                    buffer = this._device.createStructuredBuffer(entry.type, {
                        usage: 'uniform'
                    });
                    this._resources[entry.name] = buffer;
                }
                return buffer;
            }
        }
        return null;
    }
    _findTextureLayout(name) {
        for (const entry of this._layout.entries){
            if ((entry.texture || entry.storageTexture || entry.externalTexture) && entry.name === name) {
                return entry;
            }
        }
        return null;
    }
}

class WebGLGPUProgram extends WebGLGPUObject {
    _vs;
    _fs;
    _unitCounter;
    _uniformSetters;
    _uniformInfo;
    _blockInfo;
    _bindGroupLayouts;
    _vertexAttributes;
    _error;
    _vertexShader;
    _fragmentShader;
    constructor(device, vertexShader, fragmentShader, bindGroupLayouts, vertexAttributes){
        super(device);
        this._object = this._device.context.createProgram();
        this._unitCounter = 0;
        this._uniformSetters = null;
        this._uniformInfo = null;
        this._blockInfo = null;
        this._error = '';
        this._vertexShader = null;
        this._fragmentShader = null;
        this._vs = vertexShader;
        this._fs = fragmentShader;
        this._bindGroupLayouts = [
            ...bindGroupLayouts
        ];
        this._vertexAttributes = [
            ...vertexAttributes
        ];
        this.load();
    }
    get type() {
        return 'render';
    }
    getCompileError() {
        return this._error;
    }
    getShaderSource(kind) {
        switch(kind){
            case 'vertex':
                return this._vs;
            case 'fragment':
                return this._fs;
            case 'compute':
                return null;
        }
    }
    getBindingInfo(name) {
        for(let group = 0; group < this._bindGroupLayouts.length; group++){
            const layout = this._bindGroupLayouts[group];
            const bindName = layout.nameMap?.[name] ?? name;
            for(let binding = 0; binding < layout.entries.length; binding++){
                const bindingPoint = layout.entries[binding];
                if (bindingPoint.name === bindName) {
                    return {
                        group: group,
                        binding: binding,
                        type: bindingPoint.type
                    };
                }
            }
        }
        return null;
    }
    get bindGroupLayouts() {
        return this._bindGroupLayouts;
    }
    get vertexAttributes() {
        return this._vertexAttributes;
    }
    setUniform(name, value) {
        const setter = this._uniformSetters[name];
        if (setter) {
            setter(value);
        } else {
            const proto = Object.getPrototypeOf(value);
            if (proto === Object.getPrototypeOf({})) {
                this._setUniformStruct(name, value);
            } else if (proto == Object.getPrototypeOf([])) {
                this._setUniformArray(name, value);
            }
        }
    }
    setBlock(name, value, offset) {
        const info = this._blockInfo[name];
        if (info) {
            this._device.bindUniformBuffer(info.index, value, offset);
        /*
      if (offset) {
        (this._device.context as WebGL2RenderingContext).bindBufferRange(
          WebGLEnum.UNIFORM_BUFFER,
          info.index,
          value.object,
          offset,
          value.byteLength - offset
        );
      } else {
        (this._device.context as WebGL2RenderingContext).bindBufferBase(
          WebGLEnum.UNIFORM_BUFFER,
          info.index,
          value.object
        );
      }
      */ } else {
            console.error(`Block not found: ${name}`);
        }
    }
    destroy() {
        if (this._object) {
            this._device.context.deleteProgram(this._object);
            this._object = null;
            this._unitCounter = 0;
            this._uniformSetters = null;
            this._uniformInfo = null;
            this._blockInfo = null;
            this._error = '';
            this._vertexShader = null;
            this._fragmentShader = null;
        }
    }
    async restore() {
        if (!this._object && !this._device.isContextLost()) {
            this.load();
        }
    }
    isProgram() {
        return true;
    }
    use() {
        if (this !== this._device.context._currentProgram) {
            if (!this.checkLoad()) {
                return false;
            }
        /*
      this._device.context._currentProgram = this;
      this._device.context.useProgram(this._object);
      */ }
        return true;
    }
    createUniformBuffer(uniform) {
        const type = this.getBindingInfo(uniform)?.type;
        return type ? this.device.createStructuredBuffer(type, {
            usage: 'uniform'
        }) : null;
    }
    _setUniformStruct(name, value) {
        for(const k in value){
            this.setUniform(`${name}.${k}`, value[k]);
        }
    }
    _setUniformArray(name, value) {
        for(let i = 0; i < value.length; i++){
            this.setUniform(`${name}[${i}]`, value[i]);
        }
    }
    load() {
        if (this._device.isContextLost()) {
            return;
        }
        const gl = this._device.context;
        this._error = null;
        this._uniformSetters = {};
        if (!this._object) {
            this._object = this._device.context.createProgram();
        }
        this._vertexShader = gl.createShader(WebGLEnum.VERTEX_SHADER);
        gl.attachShader(this._object, this._vertexShader);
        gl.shaderSource(this._vertexShader, this._vs);
        gl.compileShader(this._vertexShader);
        this._fragmentShader = gl.createShader(WebGLEnum.FRAGMENT_SHADER);
        gl.attachShader(this._object, this._fragmentShader);
        gl.shaderSource(this._fragmentShader, this._fs);
        gl.compileShader(this._fragmentShader);
        for(let loc = 0; loc < semanticList.length; loc++){
            gl.bindAttribLocation(this._object, loc, semanticList[loc]);
        }
        gl.linkProgram(this._object);
    }
    checkLoad() {
        if (!this._object) {
            return false;
        }
        if (this._vertexShader) {
            const gl = this._device.context;
            if (!this._device.isContextLost()) {
                if (!gl.getProgramParameter(this._object, WebGLEnum.LINK_STATUS)) {
                    if (!gl.getShaderParameter(this._vertexShader, WebGLEnum.COMPILE_STATUS)) {
                        this._error = gl.getShaderInfoLog(this._vertexShader);
                        console.error(new Error(`Compile shader failed: ${this._error}`));
                    } else if (!gl.getShaderParameter(this._fragmentShader, WebGLEnum.COMPILE_STATUS)) {
                        this._error = gl.getShaderInfoLog(this._fragmentShader);
                        console.error(new Error(`Compile shader failed: ${this._error}`));
                    } else {
                        this._error = gl.getProgramInfoLog(this._object);
                        console.error(new Error(`Load program failed: \n${this._error}`));
                    }
                }
            }
            gl.deleteShader(this._vertexShader);
            this._vertexShader = null;
            gl.deleteShader(this._fragmentShader);
            this._fragmentShader = null;
            if (this._error) {
                gl.deleteProgram(this._object);
                this._object = null;
                return false;
            }
            this._device.context._currentProgram = this;
            this._device.context.useProgram(this._object);
            this._uniformSetters = this.createUniformSetters();
        } else {
            this._device.context._currentProgram = this;
            this._device.context.useProgram(this._object);
        }
        return true;
    }
    createUniformSetter(info) {
        const loc = info.location;
        const isArray = info.isArray;
        const gl = this._device.context;
        switch(info.type){
            case WebGLEnum.FLOAT:
                return this.getUniformSetterfv(loc);
            case WebGLEnum.FLOAT_VEC2:
                return this.getUniformSetter2fv(loc);
            case WebGLEnum.FLOAT_VEC3:
                return this.getUniformSetter3fv(loc);
            case WebGLEnum.FLOAT_VEC4:
                return this.getUniformSetter4fv(loc);
            case WebGLEnum.INT:
                return this.getUniformSetteriv(loc);
            case WebGLEnum.INT_VEC2:
                return this.getUniformSetter2iv(loc);
            case WebGLEnum.INT_VEC3:
                return this.getUniformSetter3iv(loc);
            case WebGLEnum.INT_VEC4:
                return this.getUniformSetter4iv(loc);
            case WebGLEnum.UNSIGNED_INT:
                return this.getUniformSetteruiv(loc);
            case WebGLEnum.UNSIGNED_INT_VEC2:
                return this.getUniformSetter2uiv(loc);
            case WebGLEnum.UNSIGNED_INT_VEC3:
                return this.getUniformSetter3uiv(loc);
            case WebGLEnum.UNSIGNED_INT_VEC4:
                return this.getUniformSetter4uiv(loc);
            case WebGLEnum.BOOL:
                return this.getUniformSetteriv(loc);
            case WebGLEnum.BOOL_VEC2:
                return this.getUniformSetter2iv(loc);
            case WebGLEnum.BOOL_VEC3:
                return this.getUniformSetter3iv(loc);
            case WebGLEnum.BOOL_VEC4:
                return this.getUniformSetter4iv(loc);
            case WebGLEnum.FLOAT_MAT2:
                return this.getUniformSetterMatrix2(loc);
            case WebGLEnum.FLOAT_MAT2x3:
                return this.getUniformSetterMatrix23(loc);
            case WebGLEnum.FLOAT_MAT2x4:
                return this.getUniformSetterMatrix24(loc);
            case WebGLEnum.FLOAT_MAT3:
                return this.getUniformSetterMatrix3(loc);
            case WebGLEnum.FLOAT_MAT3x2:
                return this.getUniformSetterMatrix32(loc);
            case WebGLEnum.FLOAT_MAT3x4:
                return this.getUniformSetterMatrix34(loc);
            case WebGLEnum.FLOAT_MAT4:
                return this.getUniformSetterMatrix4(loc);
            case WebGLEnum.FLOAT_MAT4x2:
                return this.getUniformSetterMatrix42(loc);
            case WebGLEnum.FLOAT_MAT4x3:
                return this.getUniformSetterMatrix43(loc);
            case WebGLEnum.SAMPLER_2D:
            case WebGLEnum.SAMPLER_2D_SHADOW:
            case WebGLEnum.INT_SAMPLER_2D:
            case WebGLEnum.UNSIGNED_INT_SAMPLER_2D:
                {
                    const unit = this._unitCounter;
                    this._unitCounter += info.size;
                    if (!isArray) {
                        gl.uniform1i(loc, unit);
                        return this.getSamplerSetter(loc, WebGLEnum.TEXTURE_2D, unit);
                    }
                }
            case WebGLEnum.SAMPLER_2D_ARRAY:
            case WebGLEnum.SAMPLER_2D_ARRAY_SHADOW:
            case WebGLEnum.INT_SAMPLER_2D_ARRAY:
            case WebGLEnum.UNSIGNED_INT_SAMPLER_2D_ARRAY:
                {
                    const unit = this._unitCounter;
                    this._unitCounter += info.size;
                    if (!isArray) {
                        gl.uniform1i(loc, unit);
                        return this.getSamplerSetter(loc, WebGLEnum.TEXTURE_2D_ARRAY, unit);
                    }
                }
            case WebGLEnum.SAMPLER_CUBE:
            case WebGLEnum.SAMPLER_CUBE_SHADOW:
            case WebGLEnum.INT_SAMPLER_CUBE:
            case WebGLEnum.UNSIGNED_INT_SAMPLER_CUBE:
                {
                    const unit = this._unitCounter;
                    this._unitCounter += info.size;
                    if (!isArray) {
                        gl.uniform1i(loc, unit);
                        return this.getSamplerSetter(loc, WebGLEnum.TEXTURE_CUBE_MAP, unit);
                    }
                }
            case WebGLEnum.SAMPLER_3D:
            case WebGLEnum.INT_SAMPLER_3D:
            case WebGLEnum.UNSIGNED_INT_SAMPLER_3D:
                {
                    const unit = this._unitCounter;
                    this._unitCounter += info.size;
                    if (!isArray) {
                        gl.uniform1i(loc, unit);
                        return this.getSamplerSetter(loc, WebGLEnum.TEXTURE_3D, unit);
                    }
                }
        }
        console.error(`Error: unsupported uniform type: ${info.name}`);
        return null;
    }
    createUniformSetters() {
        const uniformSetters = {};
        const gl = this._device.context;
        const numUniforms = gl.getProgramParameter(this._object, WebGLEnum.ACTIVE_UNIFORMS);
        this._uniformInfo = [];
        for(let index = 0; index < numUniforms; index++){
            const info = gl.getActiveUniform(this._object, index);
            let name = info.name;
            let isArray = false;
            if (name.startsWith('gl_') || name.startsWith('webgl_')) {
                this._uniformInfo.push(null);
            } else {
                if (name.substr(-3) === '[0]') {
                    // is array
                    name = name.substr(0, name.length - 3);
                    isArray = true;
                }
                const size = info.size;
                const type = info.type;
                const blockIndex = -1;
                const offset = 0;
                const location = gl.getUniformLocation(this._object, info.name);
                const view = null;
                const { ctor: viewCtor, elementSize: viewElementSize } = this.getTypedArrayInfo(info.type);
                const uniformInfo = {
                    index,
                    name,
                    size,
                    type,
                    blockIndex,
                    offset,
                    isArray,
                    location,
                    view,
                    viewCtor,
                    viewElementSize
                };
                this._uniformInfo.push(uniformInfo);
                if (location) {
                    uniformSetters[name] = this.createUniformSetter(uniformInfo);
                }
            }
        }
        if (isWebGL2(gl)) {
            this._blockInfo = {};
            const numBlocks = gl.getProgramParameter(this._object, WebGLEnum.ACTIVE_UNIFORM_BLOCKS);
            for(let i = 0; i < numBlocks; i++){
                const name = gl.getActiveUniformBlockName(this._object, i);
                const index = gl.getUniformBlockIndex(this._object, name);
                const usedInVS = !!gl.getActiveUniformBlockParameter(this._object, i, WebGLEnum.UNIFORM_BLOCK_REFERENCED_BY_VERTEX_SHADER);
                const usedInFS = !!gl.getActiveUniformBlockParameter(this._object, i, WebGLEnum.UNIFORM_BLOCK_REFERENCED_BY_FRAGMENT_SHADER);
                const used = usedInVS || usedInFS;
                const size = gl.getActiveUniformBlockParameter(this._object, i, WebGLEnum.UNIFORM_BLOCK_DATA_SIZE);
                const uniformIndices = gl.getActiveUniformBlockParameter(this._object, i, WebGLEnum.UNIFORM_BLOCK_ACTIVE_UNIFORM_INDICES);
                this._blockInfo[name] = {
                    index,
                    used,
                    size,
                    uniformIndices
                };
                gl.uniformBlockBinding(this._object, index, index);
            }
        /*
      const indices: number[] = this._uniformInfo.map(val => val.index);
      const types = gl.getActiveUniforms(this._object, indices, WebGLEnum.UNIFORM_TYPE);
      const sizes = gl.getActiveUniforms(this._object, indices, WebGLEnum.UNIFORM_SIZE);
      const blockIndices = gl.getActiveUniforms(this._object, indices, WebGLEnum.UNIFORM_BLOCK_INDEX);
      const offsets = gl.getActiveUniforms(this._object, indices, WebGLEnum.UNIFORM_OFFSET);
      this._uniformInfo.forEach((val, index) => {
        val.type = types[index];
        val.size = sizes[index];
        val.blockIndex = blockIndices[index];
        val.offset = offsets[index];
      });
      */ }
        return uniformSetters;
    }
    getUniformSetterfv(location) {
        return (value)=>{
            this._device.context.uniform1fv(location, value);
        };
    }
    getUniformSetter2fv(location) {
        return (value)=>{
            this._device.context.uniform2fv(location, value);
        };
    }
    getUniformSetter3fv(location) {
        return (value)=>{
            this._device.context.uniform3fv(location, value);
        };
    }
    getUniformSetter4fv(location) {
        return (value)=>{
            this._device.context.uniform4fv(location, value);
        };
    }
    getUniformSetteriv(location) {
        return (value)=>{
            this._device.context.uniform1iv(location, value);
        };
    }
    getUniformSetter2iv(location) {
        return (value)=>{
            this._device.context.uniform2iv(location, value);
        };
    }
    getUniformSetter3iv(location) {
        return (value)=>{
            this._device.context.uniform3iv(location, value);
        };
    }
    getUniformSetter4iv(location) {
        return (value)=>{
            this._device.context.uniform4iv(location, value);
        };
    }
    getUniformSetteruiv(location) {
        return (value)=>{
            this._device.context.uniform1uiv(location, value);
        };
    }
    getUniformSetter2uiv(location) {
        return (value)=>{
            this._device.context.uniform2uiv(location, value);
        };
    }
    getUniformSetter3uiv(location) {
        return (value)=>{
            this._device.context.uniform3uiv(location, value);
        };
    }
    getUniformSetter4uiv(location) {
        return (value)=>{
            this._device.context.uniform4uiv(location, value);
        };
    }
    getUniformSetterMatrix2(location) {
        return (value)=>{
            this._device.context.uniformMatrix2fv(location, false, value);
        };
    }
    getUniformSetterMatrix23(location) {
        return (value)=>{
            this._device.context.uniformMatrix2x3fv(location, false, value);
        };
    }
    getUniformSetterMatrix24(location) {
        return (value)=>{
            this._device.context.uniformMatrix2x4fv(location, false, value);
        };
    }
    getUniformSetterMatrix32(location) {
        return (value)=>{
            this._device.context.uniformMatrix3x2fv(location, false, value);
        };
    }
    getUniformSetterMatrix3(location) {
        return (value)=>{
            this._device.context.uniformMatrix3fv(location, false, value);
        };
    }
    getUniformSetterMatrix34(location) {
        return (value)=>{
            this._device.context.uniformMatrix3x4fv(location, false, value);
        };
    }
    getUniformSetterMatrix42(location) {
        return (value)=>{
            this._device.context.uniformMatrix4x2fv(location, false, value);
        };
    }
    getUniformSetterMatrix43(location) {
        return (value)=>{
            this._device.context.uniformMatrix4x3fv(location, false, value);
        };
    }
    getUniformSetterMatrix4(location) {
        return (value)=>{
            this._device.context.uniformMatrix4fv(location, false, value);
        };
    }
    getSamplerSetter(location, target, unit) {
        return (texture)=>this._device.bindTexture(target, unit, texture[0], texture[1]);
    /*
    const gl = this._device.context;
    return isWebGL2(gl)
      ? (texture: [WebGLBaseTexture, WebGLTextureSampler]) => {
          const tex = texture?.[0].object ?? null;
          const sampler = texture?.[1].object ?? null;
          //gl.uniform1i(location, unit);
          gl.activeTexture(this._device.context.TEXTURE0 + unit);
          gl.bindTexture(target, tex);
          gl.bindSampler(unit, sampler);
        }
      : (texture: [WebGLBaseTexture, WebGLTextureSampler]) => {
          const tex = texture?.[0] ?? null;
          const sampler = texture?.[1] ?? null;
          //gl.uniform1i(location, unit);
          gl.activeTexture(this._device.context.TEXTURE0 + unit);
          gl.bindTexture(target, tex?.object ?? null);
          if (tex && sampler && this._device.getCurrentSamplerForTexture(tex) !== sampler) {
            const fallback = tex.isWebGL1Fallback;
            this._device.setCurrentSamplerForTexture(tex, sampler);
            gl.texParameteri(
              target,
              WebGLEnum.TEXTURE_WRAP_S,
              textureWrappingMap[false && fallback ? 'clamp' : sampler.addressModeU]
            );
            gl.texParameteri(
              target,
              WebGLEnum.TEXTURE_WRAP_T,
              textureWrappingMap[false && fallback ? 'clamp' : sampler.addressModeV]
            );
            gl.texParameteri(
              target,
              WebGLEnum.TEXTURE_MAG_FILTER,
              textureMagFilterToWebGL(sampler.magFilter)
            );
            gl.texParameteri(
              target,
              WebGLEnum.TEXTURE_MIN_FILTER,
              textureMinFilterToWebGL(sampler.minFilter, tex.isWebGL1Fallback ? 'none' : sampler.mipFilter)
            );
            if (this._device.getDeviceCaps().textureCaps.supportAnisotropicFiltering) {
              gl.texParameterf(target, WebGLEnum.TEXTURE_MAX_ANISOTROPY, sampler.maxAnisotropy);
            }
          }
        };
    */ }
    getTypedArrayInfo(type) {
        let ctor = null;
        let elementSize = 0;
        switch(type){
            case WebGLEnum.INT:
                ctor = Int32Array;
                elementSize = 4;
                break;
            case WebGLEnum.INT_VEC2:
                ctor = Int32Array;
                elementSize = 8;
                break;
            case WebGLEnum.INT_VEC3:
                ctor = Int32Array;
                elementSize = 12;
                break;
            case WebGLEnum.INT_VEC4:
                ctor = Int32Array;
                elementSize = 16;
                break;
            case WebGLEnum.UNSIGNED_INT:
            case WebGLEnum.BOOL:
                ctor = Uint32Array;
                elementSize = 4;
                break;
            case WebGLEnum.UNSIGNED_INT_VEC2:
            case WebGLEnum.BOOL_VEC2:
                ctor = Uint32Array;
                elementSize = 8;
                break;
            case WebGLEnum.UNSIGNED_INT_VEC3:
            case WebGLEnum.BOOL_VEC3:
                ctor = Uint32Array;
                elementSize = 12;
                break;
            case WebGLEnum.UNSIGNED_INT_VEC4:
            case WebGLEnum.BOOL_VEC4:
                ctor = Uint32Array;
                elementSize = 16;
                break;
            case WebGLEnum.FLOAT:
                ctor = Float32Array;
                elementSize = 4;
                break;
            case WebGLEnum.FLOAT_VEC2:
                ctor = Float32Array;
                elementSize = 8;
                break;
            case WebGLEnum.FLOAT_VEC3:
                ctor = Float32Array;
                elementSize = 12;
                break;
            case WebGLEnum.FLOAT_VEC4:
            case WebGLEnum.FLOAT_MAT2:
                ctor = Float32Array;
                elementSize = 16;
                break;
            case WebGLEnum.FLOAT_MAT2x3:
            case WebGLEnum.FLOAT_MAT3x2:
                ctor = Float32Array;
                elementSize = 24;
                break;
            case WebGLEnum.FLOAT_MAT2x4:
            case WebGLEnum.FLOAT_MAT4x2:
                ctor = Float32Array;
                elementSize = 32;
                break;
            case WebGLEnum.FLOAT_MAT3:
                ctor = Float32Array;
                elementSize = 36;
                break;
            case WebGLEnum.FLOAT_MAT3x4:
            case WebGLEnum.FLOAT_MAT4x3:
                ctor = Float32Array;
                elementSize = 48;
                break;
            case WebGLEnum.FLOAT_MAT4:
                ctor = Float32Array;
                elementSize = 64;
                break;
        }
        return {
            ctor,
            elementSize
        };
    }
}

class WebGLTextureSampler extends WebGLGPUObject {
    _options;
    constructor(device, options){
        super(device);
        this._options = Object.assign({
            addressU: 'clamp',
            addressV: 'clamp',
            addressW: 'clamp',
            magFilter: 'nearest',
            minFilter: 'nearest',
            mipFilter: 'none',
            lodMin: 0,
            lodMax: 32,
            compare: null,
            maxAnisotropy: 1
        }, options || {});
        this._load();
    }
    get addressModeU() {
        return this._options.addressU;
    }
    get addressModeV() {
        return this._options.addressV;
    }
    get addressModeW() {
        return this._options.addressW;
    }
    get magFilter() {
        return this._options.magFilter;
    }
    get minFilter() {
        return this._options.minFilter;
    }
    get mipFilter() {
        return this._options.mipFilter;
    }
    get lodMin() {
        return this._options.lodMin;
    }
    get lodMax() {
        return this._options.lodMax;
    }
    get compare() {
        return this._options.compare;
    }
    get maxAnisotropy() {
        return this._options.maxAnisotropy;
    }
    destroy() {
        if (this._object && isWebGL2(this._device.context)) {
            this._device.context.deleteSampler(this._object);
        }
        this._object = null;
    }
    async restore() {
        if (!this._object && !this._device.isContextLost()) {
            this._load();
        }
    }
    apply(texture) {
        if (texture?.object && !this._device.isWebGL2 && !this._device.isContextLost()) {
            const gl = this._device.context;
            const target = textureTargetMap[texture.target];
            this._device.bindTexture(target, 0, texture);
            //gl.bindTexture(target, texture.object);
            gl.texParameteri(target, WebGLEnum.TEXTURE_WRAP_S, textureWrappingMap[this._options.addressU]);
            gl.texParameteri(target, WebGLEnum.TEXTURE_WRAP_T, textureWrappingMap[this._options.addressV]);
            gl.texParameteri(target, WebGLEnum.TEXTURE_MAG_FILTER, textureMagFilterToWebGL(this._options.magFilter));
            gl.texParameteri(target, WebGLEnum.TEXTURE_MIN_FILTER, textureMinFilterToWebGL(this._options.minFilter, this._options.mipFilter));
            if (this._device.getDeviceCaps().textureCaps.supportAnisotropicFiltering) {
                gl.texParameterf(target, WebGLEnum.TEXTURE_MAX_ANISOTROPY, this._options.maxAnisotropy);
            }
        }
    }
    _load() {
        if (!isWebGL2(this._device.context)) {
            this._object = {};
            return true;
        }
        if (!this._device.isContextLost()) {
            const gl = this._device.context;
            if (!this._object) {
                this._object = gl.createSampler();
            }
            gl.samplerParameteri(this._object, WebGLEnum.TEXTURE_WRAP_S, textureWrappingMap[this._options.addressU]);
            gl.samplerParameteri(this._object, WebGLEnum.TEXTURE_WRAP_T, textureWrappingMap[this._options.addressV]);
            gl.samplerParameteri(this._object, WebGLEnum.TEXTURE_WRAP_R, textureWrappingMap[this._options.addressW]);
            gl.samplerParameteri(this._object, WebGLEnum.TEXTURE_MAG_FILTER, textureMagFilterToWebGL(this._options.magFilter));
            gl.samplerParameteri(this._object, WebGLEnum.TEXTURE_MIN_FILTER, textureMinFilterToWebGL(this._options.minFilter, this._options.mipFilter));
            gl.samplerParameterf(this._object, WebGLEnum.TEXTURE_MIN_LOD, this._options.lodMin);
            gl.samplerParameterf(this._object, WebGLEnum.TEXTURE_MAX_LOD, this._options.lodMax);
            if (this._options.compare === null) {
                gl.samplerParameteri(this._object, WebGLEnum.TEXTURE_COMPARE_MODE, WebGLEnum.NONE);
            } else {
                gl.samplerParameteri(this._object, WebGLEnum.TEXTURE_COMPARE_MODE, WebGLEnum.COMPARE_REF_TO_TEXTURE);
                gl.samplerParameteri(this._object, WebGLEnum.TEXTURE_COMPARE_FUNC, compareFuncMap[this._options.compare]);
            }
            if (this._device.getDeviceCaps().textureCaps.supportAnisotropicFiltering) {
                gl.samplerParameterf(this._object, WebGLEnum.TEXTURE_MAX_ANISOTROPY, this._options.maxAnisotropy);
            }
        }
        return true;
    }
    isSampler() {
        return true;
    }
}

class SamplerCache {
    _device;
    _samplers;
    constructor(device){
        this._device = device;
        this._samplers = {};
    }
    fetchSampler(options) {
        const hash = this.hash(options);
        let sampler = this._samplers[hash];
        if (!sampler) {
            sampler = this.createSampler(options);
            this._samplers[hash] = sampler;
        }
        return sampler;
    }
    hash(options) {
        const addressU = options.addressU ? String(options.addressU) : '';
        const addressV = options.addressV ? String(options.addressV) : '';
        const addressW = options.addressW ? String(options.addressW) : '';
        const magFilter = options.magFilter ? String(options.magFilter) : '';
        const minFilter = options.minFilter ? String(options.minFilter) : '';
        const mipFilter = options.mipFilter ? String(options.mipFilter) : '';
        const lodMin = options.lodMin ? String(options.lodMin) : '';
        const lodMax = options.lodMax ? String(options.lodMax) : '';
        const compare = options.compare ? String(options.compare) : '';
        const maxAnisotropy = options.maxAnisotropy ? String(options.maxAnisotropy) : '';
        return `${addressU}:${addressV}:${addressW}:${magFilter}:${minFilter}:${mipFilter}:${lodMin}:${lodMax}:${compare}:${maxAnisotropy}`;
    }
    createSampler(options) {
        return new WebGLTextureSampler(this._device, options);
    }
}

const typeU16 = PBPrimitiveTypeInfo.getCachedTypeInfo(PBPrimitiveType.U16);
const tempInt32Array = new Int32Array(4);
const tempUint32Array = new Uint32Array(4);
class WebGLDevice extends BaseDevice {
    _context;
    _isWebGL2;
    _msaaSampleCount;
    _loseContextExtension;
    _contextLost;
    _isRendering;
    _dpr;
    _reverseWindingOrder;
    _deviceCaps;
    _vaoExt;
    _instancedArraysExt;
    _drawBuffersExt;
    _currentProgram;
    _currentVertexData;
    _currentStateSet;
    _currentBindGroups;
    _currentBindGroupOffsets;
    _currentViewport;
    _currentScissorRect;
    _samplerCache;
    _textureSamplerMap;
    _captureRenderBundle;
    _deviceUniformBuffers;
    _deviceUniformBufferOffsets;
    _bindTextures;
    _bindSamplers;
    constructor(backend, cvs, options){
        super(cvs, backend);
        this._dpr = Math.max(1, Math.floor(options?.dpr ?? window.devicePixelRatio));
        this._isRendering = false;
        this._captureRenderBundle = null;
        this._msaaSampleCount = options?.msaa ? 4 : 1;
        let context = null;
        context = this.canvas.getContext(backend === backend1 ? 'webgl' : 'webgl2', {
            antialias: !!options?.msaa,
            depth: true,
            stencil: true,
            premultipliedAlpha: false
        });
        if (!context) {
            throw new Error('Invalid argument or no webgl support');
        }
        this._isWebGL2 = isWebGL2(context);
        this._contextLost = false;
        this._reverseWindingOrder = false;
        this._deviceCaps = null;
        this._context = context;
        this._currentProgram = null;
        this._currentVertexData = null;
        this._currentStateSet = null;
        this._currentBindGroups = [];
        this._currentBindGroupOffsets = [];
        this._currentViewport = null;
        this._currentScissorRect = null;
        this._deviceUniformBuffers = [];
        this._deviceUniformBufferOffsets = [];
        this._bindTextures = {
            [WebGLEnum.TEXTURE_2D]: [],
            [WebGLEnum.TEXTURE_CUBE_MAP]: [],
            [WebGLEnum.TEXTURE_3D]: [],
            [WebGLEnum.TEXTURE_2D_ARRAY]: []
        };
        this._bindSamplers = [];
        this._samplerCache = new SamplerCache(this);
        this._textureSamplerMap = new WeakMap();
        this._loseContextExtension = this._context.getExtension('WEBGL_lose_context');
        this.canvas.addEventListener('webglcontextlost', (evt)=>{
            this._contextLost = true;
            evt.preventDefault();
            this.handleContextLost();
        }, false);
        this.canvas.addEventListener('webglcontextrestored', (evt)=>{
            this._contextLost = false;
            this.handleContextRestored();
        }, false);
    }
    get context() {
        return this._context;
    }
    getFrameBufferSampleCount() {
        return this.getFramebuffer()?.getSampleCount() ?? this._msaaSampleCount;
    }
    get isWebGL2() {
        return this._isWebGL2;
    }
    get drawingBufferWidth() {
        return this.getDrawingBufferWidth();
    }
    get drawingBufferHeight() {
        return this.getDrawingBufferHeight();
    }
    get clientWidth() {
        return this.canvas.clientWidth;
    }
    get clientHeight() {
        return this.canvas.clientHeight;
    }
    getScale() {
        return this._dpr;
    }
    isContextLost() {
        return this._context.isContextLost();
    }
    getDeviceCaps() {
        return this._deviceCaps;
    }
    get vaoExt() {
        return this._vaoExt;
    }
    get instancedArraysExt() {
        return this._instancedArraysExt;
    }
    get drawBuffersExt() {
        return this._drawBuffersExt;
    }
    getDrawingBufferWidth() {
        return this._context._currentFramebuffer?.getWidth() || this._context.drawingBufferWidth;
    }
    getDrawingBufferHeight() {
        return this._context._currentFramebuffer?.getHeight() || this._context.drawingBufferHeight;
    }
    getBackBufferWidth() {
        return this.canvas.width;
    }
    getBackBufferHeight() {
        return this.canvas.height;
    }
    invalidateBindingTextures() {
        this._bindTextures = {
            [WebGLEnum.TEXTURE_2D]: [],
            [WebGLEnum.TEXTURE_CUBE_MAP]: [],
            [WebGLEnum.TEXTURE_3D]: [],
            [WebGLEnum.TEXTURE_2D_ARRAY]: []
        };
    }
    bindTexture(target, layer, texture, sampler) {
        const tex = texture?.object ?? null;
        const gl = this._context;
        gl.activeTexture(WebGLEnum.TEXTURE0 + layer);
        if (this._bindTextures[target][layer] !== tex) {
            gl.bindTexture(target, tex);
            this._bindTextures[target][layer] = tex;
        }
        if (this._isWebGL2) {
            const samp = sampler?.object ?? null;
            if (samp && this._bindSamplers[layer] !== samp) {
                gl.bindSampler(layer, samp);
                this._bindSamplers[layer] = samp;
            }
        } else if (texture && sampler && this._textureSamplerMap.get(texture) !== sampler) {
            const fallback = texture.isWebGL1Fallback;
            this._textureSamplerMap.set(texture, sampler);
            gl.texParameteri(target, WebGLEnum.TEXTURE_WRAP_S, textureWrappingMap[sampler.addressModeU]);
            gl.texParameteri(target, WebGLEnum.TEXTURE_WRAP_T, textureWrappingMap[sampler.addressModeV]);
            gl.texParameteri(target, WebGLEnum.TEXTURE_MAG_FILTER, textureMagFilterToWebGL(sampler.magFilter));
            gl.texParameteri(target, WebGLEnum.TEXTURE_MIN_FILTER, textureMinFilterToWebGL(sampler.minFilter, fallback ? 'none' : sampler.mipFilter));
            if (this.getDeviceCaps().textureCaps.supportAnisotropicFiltering) {
                gl.texParameterf(target, WebGLEnum.TEXTURE_MAX_ANISOTROPY, sampler.maxAnisotropy);
            }
        }
    }
    bindUniformBuffer(index, buffer, offset) {
        if (this._deviceUniformBuffers[index] !== buffer.object || this._deviceUniformBufferOffsets[index] !== offset) {
            if (offset) {
                this.context.bindBufferRange(WebGLEnum.UNIFORM_BUFFER, index, buffer.object, offset, buffer.byteLength - offset);
            } else {
                this.context.bindBufferBase(WebGLEnum.UNIFORM_BUFFER, index, buffer.object);
            }
            this._deviceUniformBuffers[index] = buffer.object;
            this._deviceUniformBufferOffsets[index] = offset;
        }
    }
    async initContext() {
        this.initContextState();
        this.on('resize', (evt)=>{
            const width = Math.max(1, Math.round(this.canvas.clientWidth * this._dpr));
            const height = Math.max(1, Math.round(this.canvas.clientHeight * this._dpr));
            if (width !== this.canvas.width || height !== this.canvas.height) {
                this.canvas.width = width;
                this.canvas.height = height;
                this.setViewport(this._currentViewport);
                this.setScissor(this._currentScissorRect);
            }
        });
        this.dispatchEvent(new DeviceResizeEvent(this.canvas.clientWidth, this.canvas.clientHeight));
    }
    clearFrameBuffer(clearColor, clearDepth, clearStencil) {
        const gl = this._context;
        const colorFlag = clearColor ? gl.COLOR_BUFFER_BIT : 0;
        const depthFlag = typeof clearDepth === 'number' ? gl.DEPTH_BUFFER_BIT : 0;
        const stencilFlag = typeof clearStencil === 'number' ? gl.STENCIL_BUFFER_BIT : 0;
        if (colorFlag || depthFlag || stencilFlag) {
            WebGLDepthState.applyDefaults(this._context);
            if (isWebGL2(gl) && gl._currentFramebuffer) {
                if (depthFlag || stencilFlag) {
                    const depthAttachment = gl._currentFramebuffer.getDepthAttachment();
                    if (depthAttachment) {
                        gl.clearBufferfi(WebGLEnum.DEPTH_STENCIL, 0, clearDepth || 1, clearStencil || 0);
                    }
                }
                if (colorFlag) {
                    const attachments = gl._currentFramebuffer.getColorAttachments();
                    for(let i = 0; i < attachments.length; i++){
                        if (isIntegerTextureFormat(attachments[i].format)) {
                            if (isSignedTextureFormat(attachments[i].format)) {
                                tempInt32Array[0] = clearColor[0];
                                tempInt32Array[1] = clearColor[1];
                                tempInt32Array[2] = clearColor[2];
                                tempInt32Array[3] = clearColor[3];
                                gl.clearBufferiv(WebGLEnum.COLOR, i, tempInt32Array);
                            } else {
                                tempUint32Array[0] = clearColor[0];
                                tempUint32Array[1] = clearColor[1];
                                tempUint32Array[2] = clearColor[2];
                                tempUint32Array[3] = clearColor[3];
                                gl.clearBufferuiv(WebGLEnum.COLOR, i, tempUint32Array);
                            }
                        } else {
                            gl.clearBufferfv(WebGLEnum.COLOR, i, clearColor);
                        }
                    }
                }
            } else {
                gl.clearColor(clearColor[0], clearColor[1], clearColor[2], clearColor[3]);
                gl.clearDepth(clearDepth);
                gl.clearStencil(clearStencil);
                gl.clear(colorFlag | depthFlag | stencilFlag);
            }
            gl._currentFramebuffer?.tagDraw();
        }
    }
    // factory
    createGPUTimer() {
        return new GPUTimer(this);
    }
    createRenderStateSet() {
        return new WebGLRenderStateSet(this._context);
    }
    createSampler(options) {
        return this._samplerCache.fetchSampler(options);
    }
    createTextureFromMipmapData(data, sRGB, options) {
        if (!data) {
            console.error(`Device.createTextureFromMipmapData() failed: invalid data`);
            return null;
        }
        if (data.isCubemap) {
            const tex = new WebGLTextureCube(this);
            tex.createWithMipmapData(data, sRGB, this.parseTextureOptions(options));
            return tex;
        } else if (data.isVolume) {
            const tex = new WebGLTexture3D(this);
            tex.createWithMipmapData(data, this.parseTextureOptions(options));
            return tex;
        } else if (data.isArray) {
            const tex = new WebGLTexture2DArray(this);
            tex.createWithMipmapData(data, this.parseTextureOptions(options));
            return tex;
        } else {
            const tex = new WebGLTexture2D(this);
            tex.createWithMipmapData(data, sRGB, this.parseTextureOptions(options));
            return tex;
        }
    }
    createTexture2D(format, width, height, options) {
        const tex = (options?.texture) ?? new WebGLTexture2D(this);
        if (!tex.isTexture2D()) {
            console.error('createTexture2D() failed: options.texture must be 2d texture');
            return null;
        }
        tex.createEmpty(format, width, height, this.parseTextureOptions(options));
        tex.samplerOptions = options?.samplerOptions ?? null;
        return tex;
    }
    createTexture2DFromMipmapData(data, sRGB, options) {
        const tex = (options?.texture) ?? new WebGLTexture2D(this);
        if (!tex.isTexture2D()) {
            console.error('createTexture2DFromMipmapData() failed: options.texture must be 2d texture');
            return null;
        }
        tex.createWithMipmapData(data, sRGB, this.parseTextureOptions(options));
        tex.samplerOptions = options?.samplerOptions ?? null;
        return tex;
    }
    createTexture2DFromImage(element, sRGB, options) {
        const tex = (options?.texture) ?? new WebGLTexture2D(this);
        if (!tex.isTexture2D()) {
            console.error('createTexture2DFromImage() failed: options.texture must be 2d texture');
            return null;
        }
        tex.loadFromElement(element, sRGB, this.parseTextureOptions(options));
        tex.samplerOptions = options?.samplerOptions ?? null;
        return tex;
    }
    createTexture2DArray(format, width, height, depth, options) {
        const tex = (options?.texture) ?? new WebGLTexture2DArray(this);
        if (!tex.isTexture2DArray()) {
            console.error('createTexture2DArray() failed: options.texture must be 2d array texture');
            return null;
        }
        tex.createEmpty(format, width, height, depth, this.parseTextureOptions(options));
        tex.samplerOptions = options?.samplerOptions ?? null;
        return tex;
    }
    createTexture2DArrayFromImages(elements, sRGB, options) {
        if (!elements || elements.length === 0) {
            console.error('createTexture2DArrayFromImages() failed: Invalid image elements');
            return null;
        }
        let width = 0;
        let height = 0;
        for (const element of elements){
            if (width === 0 || height === 0) {
                width = element.width;
                height = element.height;
            } else if (width !== element.width || height !== element.height) {
                console.error('createTexture2DArrayFromImages() failed: Image elements must have the same size');
                return null;
            }
        }
        if (options?.texture && !options.texture.isTexture2DArray()) {
            console.error('createTexture2DArrayFromImages() failed: options.texture must be 2d array texture');
            return null;
        }
        let tex = options?.texture;
        if (tex) {
            if (tex.depth !== elements.length) {
                console.error('createTexture2DArrayFromImages() failed: Layer count of options.texture not match the given image elements');
                return null;
            }
            if (tex.width !== width || tex.height !== height) {
                console.error('createTexture2DArrayFromImages() failed: Size of options.texture not match the given image elements');
                return null;
            }
        } else {
            tex = this.createTexture2DArray(sRGB ? 'rgba8unorm-srgb' : 'rgba8unorm', width, height, elements.length, options);
            for(let i = 0; i < elements.length; i++){
                tex.updateFromElement(elements[i], 0, 0, i, 0, 0, width, height);
            }
        }
        tex.samplerOptions = options?.samplerOptions ?? null;
        return tex;
    }
    createTexture3D(format, width, height, depth, options) {
        if (!this.isWebGL2) {
            console.error('device does not support 3d texture');
            return null;
        }
        const tex = (options?.texture) ?? new WebGLTexture3D(this);
        if (!tex.isTexture3D()) {
            console.error('createTexture3D() failed: options.texture must be 3d texture');
            return null;
        }
        tex.createEmpty(format, width, height, depth, this.parseTextureOptions(options));
        tex.samplerOptions = options?.samplerOptions ?? null;
        return tex;
    }
    createCubeTexture(format, size, options) {
        const tex = (options?.texture) ?? new WebGLTextureCube(this);
        if (!tex.isTextureCube()) {
            console.error('createCubeTexture() failed: options.texture must be cube texture');
            return null;
        }
        tex.createEmpty(format, size, this.parseTextureOptions(options));
        tex.samplerOptions = options?.samplerOptions ?? null;
        return tex;
    }
    createCubeTextureFromMipmapData(data, sRGB, options) {
        const tex = (options?.texture) ?? new WebGLTextureCube(this);
        if (!tex.isTextureCube()) {
            console.error('createCubeTextureFromMipmapData() failed: options.texture must be cube texture');
            return null;
        }
        tex.createWithMipmapData(data, sRGB, this.parseTextureOptions(options));
        tex.samplerOptions = options?.samplerOptions ?? null;
        return tex;
    }
    createTexture2DArrayFromMipmapData(data, options) {
        const tex = (options?.texture) ?? new WebGLTexture2DArray(this);
        if (!tex.isTexture2DArray()) {
            console.error('createTexture2DArrayFromMipmapData() failed: options.texture must be 2d array texture');
            return null;
        }
        tex.createWithMipmapData(data, this.parseTextureOptions(options));
        tex.samplerOptions = options?.samplerOptions ?? null;
        return tex;
    }
    createTextureVideo(el, samplerOptions) {
        const tex = new WebGLTextureVideo(this, el);
        tex.samplerOptions = samplerOptions ?? null;
        return tex;
    }
    createGPUProgram(params) {
        if (params.type === 'compute') {
            throw new Error('device does not support compute shader');
        }
        const renderProgramParams = params.params;
        return new WebGLGPUProgram(this, renderProgramParams.vs, renderProgramParams.fs, renderProgramParams.bindGroupLayouts, renderProgramParams.vertexAttributes);
    }
    createBindGroup(layout) {
        return new WebGLBindGroup(this, layout);
    }
    createBuffer(sizeInBytes, options) {
        return new WebGLGPUBuffer(this, this.parseBufferOptions(options), sizeInBytes);
    }
    copyBuffer(sourceBuffer, destBuffer, srcOffset, dstOffset, bytes) {
        if (!this.isWebGL2) {
            console.error(`copyBuffer() is not supported for current device`);
            return;
        }
        const gl = this._context;
        gl.bindBuffer(gl.COPY_READ_BUFFER, sourceBuffer.object);
        gl.bindBuffer(gl.COPY_WRITE_BUFFER, destBuffer.object);
        gl.copyBufferSubData(gl.COPY_READ_BUFFER, gl.COPY_WRITE_BUFFER, srcOffset, dstOffset, bytes);
    }
    createIndexBuffer(data, options) {
        return new WebGLIndexBuffer(this, data, this.parseBufferOptions(options, 'index'));
    }
    createStructuredBuffer(structureType, options, data) {
        return new WebGLStructuredBuffer(this, structureType, this.parseBufferOptions(options), data);
    }
    createVertexLayout(options) {
        return new WebGLVertexLayout(this, options);
    }
    createFrameBuffer(colorAttachments, depthAttachement, options) {
        this.pushDeviceStates();
        const fb = new WebGLFrameBuffer(this, colorAttachments, depthAttachement, options);
        this.popDeviceStates();
        return fb;
    }
    setBindGroup(index, bindGroup, bindGroupOffsets) {
        if (bindGroupOffsets && !isWebGL2(this._context)) {
            throw new Error(`setBindGroup(): no dynamic offset buffer support for WebGL1 device`);
        }
        this._currentBindGroups[index] = bindGroup;
        this._currentBindGroupOffsets[index] = bindGroupOffsets || null;
    }
    getBindGroup(index) {
        return [
            this._currentBindGroups[index],
            this._currentBindGroupOffsets[index]
        ];
    }
    // render related
    setViewport(vp) {
        if (vp === null || vp === undefined || !Array.isArray(vp) && vp.default) {
            this._currentViewport = {
                x: 0,
                y: 0,
                width: this.deviceToScreen(this.drawingBufferWidth),
                height: this.deviceToScreen(this.drawingBufferHeight),
                default: true
            };
        } else {
            if (Array.isArray(vp)) {
                this._currentViewport = {
                    x: vp[0],
                    y: vp[1],
                    width: vp[2],
                    height: vp[3],
                    default: false
                };
            } else {
                this._currentViewport = Object.assign({
                    default: false
                }, vp);
            }
        }
        this._context.viewport(this.screenToDevice(this._currentViewport.x), this.screenToDevice(this._currentViewport.y), this.screenToDevice(this._currentViewport.width), this.screenToDevice(this._currentViewport.height));
    }
    getViewport() {
        return Object.assign({}, this._currentViewport);
    }
    setScissor(scissor) {
        if (scissor === null || scissor === undefined || !Array.isArray(scissor) && scissor.default) {
            this._currentScissorRect = {
                x: 0,
                y: 0,
                width: this.deviceToScreen(this.drawingBufferWidth),
                height: this.deviceToScreen(this.drawingBufferHeight),
                default: true
            };
        } else {
            if (Array.isArray(scissor)) {
                this._currentScissorRect = {
                    x: scissor[0],
                    y: scissor[1],
                    width: scissor[2],
                    height: scissor[3],
                    default: false
                };
            } else {
                this._currentScissorRect = Object.assign({
                    default: false
                }, scissor);
            }
        }
        this._context.scissor(this.screenToDevice(this._currentScissorRect.x), this.screenToDevice(this._currentScissorRect.y), this.screenToDevice(this._currentScissorRect.width), this.screenToDevice(this._currentScissorRect.height));
    }
    getScissor() {
        return Object.assign({}, this._currentScissorRect);
    }
    setProgram(program) {
        this._currentProgram = program;
    }
    getProgram() {
        return this._currentProgram;
    }
    setVertexLayout(vertexData) {
        this._currentVertexData = vertexData;
    }
    getVertexLayout() {
        return this._currentVertexData;
    }
    setRenderStates(stateSet) {
        this._currentStateSet = stateSet;
    }
    getRenderStates() {
        return this._currentStateSet;
    }
    setFramebuffer(rt) {
        if (rt !== this._context._currentFramebuffer) {
            this._context._currentFramebuffer?.unbind();
            rt?.bind();
        }
    }
    getFramebuffer() {
        return this._context._currentFramebuffer ?? null;
    }
    reverseVertexWindingOrder(reverse) {
        if (this._reverseWindingOrder !== !!reverse) {
            this._reverseWindingOrder = !!reverse;
            this._context.frontFace(reverse ? this._context.CW : this._context.CCW);
        }
    }
    isWindingOrderReversed() {
        return !!this._reverseWindingOrder;
    }
    flush() {
        this.context.flush();
    }
    async readPixels(index, x, y, w, h, buffer) {
        const fb = this.getFramebuffer();
        const colorAttachment = fb ? fb.getColorAttachments()[index] : null;
        const format = colorAttachment ? colorAttachment.format : 'rgba8unorm';
        let glFormat = WebGLEnum.NONE;
        let glType = WebGLEnum.NONE;
        const pixelSize = getTextureFormatBlockSize(format);
        glFormat = this.context.getParameter(WebGLEnum.IMPLEMENTATION_COLOR_READ_FORMAT);
        glType = this.context.getParameter(WebGLEnum.IMPLEMENTATION_COLOR_READ_TYPE);
        if ((glFormat !== WebGLEnum.RGBA || glType !== WebGLEnum.UNSIGNED_BYTE && glType !== WebGLEnum.FLOAT) && !isWebGL2(this.context)) {
            throw new Error(`readPixels() failed: invalid format: ${format}`);
        }
        const byteSize = w * h * pixelSize;
        if (buffer.byteLength < byteSize) {
            throw new Error(`readPixels() failed: destination buffer must have at least ${byteSize} bytes`);
        }
        if (isWebGL2(this.context)) {
            const stagingBuffer = this.createBuffer(byteSize, {
                usage: 'read',
                managed: false
            });
            this.context.bindBuffer(WebGLEnum.PIXEL_PACK_BUFFER, stagingBuffer.object);
            this.context.readBuffer(fb ? WebGLEnum.COLOR_ATTACHMENT0 + index : WebGLEnum.COLOR_ATTACHMENT0);
            this.flush();
            this.context.readPixels(x, y, w, h, glFormat, glType, 0);
            this.context.bindBuffer(WebGLEnum.PIXEL_PACK_BUFFER, null);
            const data = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
            await stagingBuffer.getBufferSubData(data);
            stagingBuffer.dispose();
        } else {
            this.context.readPixels(x, y, w, h, glFormat, glType, buffer);
        }
    }
    readPixelsToBuffer(index, x, y, w, h, buffer) {
        const fb = this.getFramebuffer();
        const colorAttachment = fb ? fb.getColorAttachments()[index] : null;
        const format = colorAttachment ? colorAttachment.format : 'rgba8unorm';
        let glFormat = WebGLEnum.NONE;
        let glType = WebGLEnum.NONE;
        if (!isWebGL2(this.context)) {
            throw new Error('readPixels() failed: readPixels() requires webgl2 device');
        }
        if (isCompressedTextureFormat(format) || hasDepthChannel(format)) {
            throw new Error(`readPixels() failed: invalid format: ${format}`);
        }
        const r = hasRedChannel(format);
        const g = hasGreenChannel(format);
        const b = hasBlueChannel(format);
        const a = hasAlphaChannel(format);
        const numChannels = (r ? 1 : 0) + (g ? 1 : 0) + (b ? 1 : 0) + (a ? 1 : 0);
        const size = getTextureFormatBlockSize(format) / numChannels;
        const integer = isIntegerTextureFormat(format);
        const float = isFloatTextureFormat(format);
        const signed = isSignedTextureFormat(format);
        if (r && g && b && a) {
            glFormat = integer ? WebGLEnum.RGBA_INTEGER : WebGLEnum.RGBA;
        } else if (r && g) {
            glFormat = integer ? WebGLEnum.RG_INTEGER : WebGLEnum.RG;
        } else if (r) {
            glFormat = integer ? WebGLEnum.RED_INTEGER : WebGLEnum.RED;
        }
        if (size === 1) {
            glType = signed ? WebGLEnum.BYTE : WebGLEnum.UNSIGNED_BYTE;
        } else if (size === 2) {
            glType = float ? WebGLEnum.HALF_FLOAT : signed ? WebGLEnum.SHORT : WebGLEnum.UNSIGNED_SHORT;
        } else if (size === 4) {
            glType = float ? WebGLEnum.FLOAT : signed ? WebGLEnum.INT : WebGLEnum.UNSIGNED_INT;
        }
        this.context.bindBuffer(WebGLEnum.PIXEL_PACK_BUFFER, buffer.object);
        this.context.readBuffer(fb ? WebGLEnum.COLOR_ATTACHMENT0 + index : WebGLEnum.COLOR_ATTACHMENT0);
        this.flush();
        this.context.readPixels(x, y, w, h, glFormat, glType, 0);
        this.context.bindBuffer(WebGLEnum.PIXEL_PACK_BUFFER, null);
    }
    looseContext() {
        if (!this.context.isContextLost()) {
            this._loseContextExtension?.loseContext();
        }
    }
    restoreContext() {
        if (this.context.isContextLost()) {
            this.clearErrors();
            this._loseContextExtension?.restoreContext();
            const err = this.getError();
            if (err) {
                console.log(err);
            }
        }
    }
    beginCapture() {
        if (this._captureRenderBundle) {
            throw new Error('Device.beginCapture() failed: device is already capturing draw commands');
        }
        this._captureRenderBundle = [];
    }
    endCapture() {
        if (!this._captureRenderBundle) {
            throw new Error('Device.endCapture() failed: device is not capturing draw commands');
        }
        const result = this._captureRenderBundle;
        this._captureRenderBundle = null;
        return result;
    }
    executeRenderBundle(renderBundle) {
        for (const drawcall of renderBundle){
            this.setProgram(drawcall.program);
            this.setVertexLayout(drawcall.vertexLayout);
            this.setRenderStates(drawcall.renderStateSet);
            for(let i = 0; i < 4; i++){
                this.setBindGroup(i, drawcall.bindGroups[i], drawcall.bindGroupOffsets[i]);
            }
            if (drawcall.numInstances === 0) {
                this.draw(drawcall.primitiveType, drawcall.first, drawcall.count);
            } else {
                this.drawInstanced(drawcall.primitiveType, drawcall.first, drawcall.count, drawcall.numInstances);
            }
        }
    }
    /** @internal */ onBeginFrame() {
        if (this._contextLost) {
            if (!this._context.isContextLost()) {
                this._contextLost = false;
                this.handleContextRestored();
            }
        }
        return !this._contextLost;
    }
    /** @internal */ onEndFrame() {}
    /** @internal */ _draw(primitiveType, first, count) {
        if (this._currentVertexData) {
            this._currentVertexData.bind();
            if (this._currentProgram) {
                if (!this._currentProgram.use()) {
                    return;
                }
                for(let i = 0; i < this._currentProgram.bindGroupLayouts.length; i++){
                    const bindGroup = this._currentBindGroups[i];
                    if (bindGroup) {
                        const offsets = this._currentBindGroupOffsets[i];
                        bindGroup.apply(this._currentProgram, offsets);
                    } else {
                        console.error(`Missing bind group (${i}) when drawing with program '${this._currentProgram.name}'`);
                        return;
                    }
                }
            }
            if (this._currentStateSet) {
                this._currentStateSet.apply();
            } else {
                WebGLRenderStateSet.applyDefaults(this._context);
            }
            const indexBuffer = this._currentVertexData.indexBuffer;
            if (indexBuffer) {
                this.context.drawElements(primitiveTypeMap[primitiveType], count, typeMap[indexBuffer.indexType.primitiveType], first * (indexBuffer.indexType === typeU16 ? 2 : 4));
            } else {
                this.context.drawArrays(primitiveTypeMap[primitiveType], first, count);
            }
            this._context._currentFramebuffer?.tagDraw();
        }
        if (this._captureRenderBundle) {
            const rs = this._currentStateSet?.clone() ?? this.createRenderStateSet();
            if (this._reverseWindingOrder) {
                const rasterState = rs.rasterizerState;
                if (!rasterState) {
                    rs.useRasterizerState().setCullMode('front');
                } else if (rasterState.cullMode === 'back') {
                    rasterState.cullMode = 'front';
                } else if (rasterState.cullMode === 'front') {
                    rasterState.cullMode = 'back';
                }
            }
            this._captureRenderBundle.push({
                bindGroups: [
                    ...this._currentBindGroups
                ],
                bindGroupOffsets: this._currentBindGroupOffsets.map((val)=>val ? [
                        ...val
                    ] : null),
                program: this._currentProgram,
                vertexLayout: this._currentVertexData,
                primitiveType: primitiveType,
                renderStateSet: rs,
                count,
                first,
                numInstances: 0
            });
        }
    }
    /** @internal */ _drawInstanced(primitiveType, first, count, numInstances) {
        if (this.instancedArraysExt && this._currentVertexData) {
            this._currentVertexData.bind();
            if (this._currentProgram) {
                if (!this._currentProgram.use()) {
                    return;
                }
                for(let i = 0; i < this._currentBindGroups.length; i++){
                    const bindGroup = this._currentBindGroups[i];
                    if (bindGroup) {
                        const offsets = this._currentBindGroupOffsets[i];
                        bindGroup.apply(this._currentProgram, offsets);
                    }
                }
            }
            this._currentStateSet?.apply();
            const indexBuffer = this._currentVertexData.indexBuffer;
            if (indexBuffer) {
                this.instancedArraysExt.drawElementsInstanced(primitiveTypeMap[primitiveType], count, typeMap[indexBuffer.indexType.primitiveType], first * (indexBuffer.indexType === typeU16 ? 2 : 4), numInstances);
            } else {
                this.instancedArraysExt.drawArraysInstanced(primitiveTypeMap[primitiveType], first, count, numInstances);
            }
            this._context._currentFramebuffer?.tagDraw();
        }
        if (this._captureRenderBundle) {
            this._captureRenderBundle.push({
                bindGroups: [
                    ...this._currentBindGroups
                ],
                bindGroupOffsets: this._currentBindGroupOffsets.map((val)=>val ? [
                        ...val
                    ] : null),
                program: this._currentProgram,
                vertexLayout: this._currentVertexData,
                primitiveType: primitiveType,
                renderStateSet: this._currentStateSet?.clone() ?? null,
                count,
                first,
                numInstances
            });
        }
    }
    /** @internal */ _compute() {
        throw new Error('WebGL device does not support compute shader');
    }
    /** @internal */ createInstancedArraysEXT() {
        const gl = this._context;
        if (isWebGL2(gl)) {
            return {
                vertexAttribDivisor: gl.vertexAttribDivisor.bind(gl),
                drawArraysInstanced: gl.drawArraysInstanced.bind(gl),
                drawElementsInstanced: gl.drawElementsInstanced.bind(gl)
            };
        } else {
            const extInstancedArray = gl.getExtension('ANGLE_instanced_arrays');
            return extInstancedArray ? {
                vertexAttribDivisor: extInstancedArray.vertexAttribDivisorANGLE.bind(extInstancedArray),
                drawArraysInstanced: extInstancedArray.drawArraysInstancedANGLE.bind(extInstancedArray),
                drawElementsInstanced: extInstancedArray.drawElementsInstancedANGLE.bind(extInstancedArray)
            } : null;
        }
    }
    /** @internal */ createDrawBuffersEXT() {
        const gl = this._context;
        if (isWebGL2(gl)) {
            return {
                drawBuffers: gl.drawBuffers.bind(gl)
            };
        } else {
            const extDrawBuffers = gl.getExtension('WEBGL_draw_buffers');
            return extDrawBuffers ? {
                drawBuffers: extDrawBuffers.drawBuffersWEBGL.bind(extDrawBuffers)
            } : null;
        }
    }
    /** @internal */ createVertexArrayObjectEXT() {
        const gl = this._context;
        if (isWebGL2(gl)) {
            return {
                createVertexArray: gl.createVertexArray.bind(gl),
                bindVertexArray: gl.bindVertexArray.bind(gl),
                deleteVertexArray: gl.deleteVertexArray.bind(gl),
                isVertexArray: gl.isVertexArray.bind(gl)
            };
        } else {
            const extVAO = gl.getExtension('OES_vertex_array_object');
            return extVAO ? {
                createVertexArray: extVAO.createVertexArrayOES.bind(extVAO),
                bindVertexArray: extVAO.bindVertexArrayOES.bind(extVAO),
                deleteVertexArray: extVAO.deleteVertexArrayOES.bind(extVAO),
                isVertexArray: extVAO.isVertexArrayOES.bind(extVAO)
            } : null;
        }
    }
    /** @internal */ handleContextLost() {
        this._isRendering = this.isRendering;
        this.exitLoop();
        console.log('handle context lost');
        this.invalidateAll();
        this.dispatchEvent(new DeviceLostEvent());
    }
    /** @internal */ handleContextRestored() {
        console.log('handle context restored');
        this.initContextState();
        this._textureSamplerMap = new WeakMap();
        this._currentProgram = null;
        this._currentVertexData = null;
        this._currentStateSet = null;
        this._currentBindGroups = [];
        this._currentBindGroupOffsets = [];
        this._currentViewport = null;
        this._currentScissorRect = null;
        this._samplerCache = new SamplerCache(this);
        if (this._isRendering) {
            this._isRendering = false;
            this.reloadAll().then(()=>{
                this.dispatchEvent(new DeviceRestoreEvent());
                this.runLoop(this.runLoopFunction);
            });
        }
    }
    /** @internal */ initContextState() {
        this._deviceCaps = {
            miscCaps: new WebGLMiscCaps(this._context),
            framebufferCaps: new WebGLFramebufferCaps(this._context),
            shaderCaps: new WebGLShaderCaps(this._context),
            textureCaps: new WebGLTextureCaps(this._context)
        };
        this._vaoExt = this.createVertexArrayObjectEXT();
        this._instancedArraysExt = this.createInstancedArraysEXT();
        this._drawBuffersExt = this.createDrawBuffersEXT();
        this._context.pixelStorei(WebGLEnum.UNPACK_COLORSPACE_CONVERSION_WEBGL, WebGLEnum.NONE);
        this._context.pixelStorei(WebGLEnum.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        this.setViewport(null);
        this.setScissor(null);
        this._context.enable(WebGLEnum.SCISSOR_TEST);
        this.enableGPUTimeRecording(true);
        this._context._currentFramebuffer = undefined;
        this._context._currentProgram = undefined;
        this._deviceUniformBuffers = [];
        this._deviceUniformBufferOffsets = [];
        this._bindTextures = {
            [WebGLEnum.TEXTURE_2D]: [],
            [WebGLEnum.TEXTURE_CUBE_MAP]: [],
            [WebGLEnum.TEXTURE_3D]: [],
            [WebGLEnum.TEXTURE_2D_ARRAY]: []
        };
        this._bindSamplers = [];
    }
    /** @internal */ clearErrors() {
        while(this._context.getError());
    }
    /** @internal */ getCurrentSamplerForTexture(tex) {
        return this._textureSamplerMap.get(tex);
    }
    /** @internal */ setCurrentSamplerForTexture(tex, sampler) {
        this._textureSamplerMap.set(tex, sampler);
    }
    getError(throwError) {
        const errcode = this._context.getError();
        const err = errcode === WebGLEnum.NO_ERROR ? null : new WebGLError(errcode);
        if (err && throwError) {
            throw err;
        }
        return err;
    }
}
let webGL1Supported = null;
let webGL2Supported = null;
const factory = makeEventTarget(WebGLDevice)();
async function createWebGLDevice(backend, cvs, options) {
    try {
        const device = new factory(backend, cvs, options);
        await device.initContext();
        device.setViewport();
        device.setScissor();
        return device;
    } catch (err) {
        console.error(err);
        return null;
    }
}
/** @internal */ const backend1 = {
    typeName () {
        return 'webgl';
    },
    supported () {
        if (webGL1Supported === null) {
            const cvs = document.createElement('canvas');
            const gl = cvs.getContext('webgl');
            webGL1Supported = !!gl;
            cvs.width = 0;
            cvs.height = 0;
        }
        return webGL1Supported;
    },
    async createDevice (cvs, options) {
        return createWebGLDevice(this, cvs, options);
    }
};
/** @internal */ const backend2 = {
    typeName () {
        return 'webgl2';
    },
    supported () {
        if (webGL2Supported === null) {
            const cvs = document.createElement('canvas');
            const gl = cvs.getContext('webgl2');
            webGL2Supported = !!gl;
            cvs.width = 0;
            cvs.height = 0;
        }
        return webGL2Supported;
    },
    async createDevice (cvs, options) {
        return createWebGLDevice(this, cvs, options);
    }
};

/**
 * The WebGL2 backend
 * @public
 */ const backendWebGL2 = backend2;

(async function() {
    // Create WebGL2 device
    /** @type HTMLCanvasElement */ const canvas = document.querySelector('#canvas');
    const device = await backendWebGL2.createDevice(canvas);
    // Create vertex buffers
    const positions = device.createVertexBuffer('position_f32x2', new Float32Array([
        -0.3,
        -0.7,
        0.3,
        -0.7,
        0,
        0.7
    ]));
    const colors = device.createVertexBuffer('diffuse_u8normx4', new Uint8Array([
        255,
        0,
        0,
        255,
        0,
        255,
        0,
        255,
        0,
        0,
        255,
        255
    ]));
    // Create vertex input layout object
    const vertexLayout = device.createVertexLayout({
        vertexBuffers: [
            {
                buffer: positions
            },
            {
                buffer: colors
            }
        ]
    });
    // Create shader
    const program = device.buildRenderProgram({
        vertex (pb) {
            // Vertex stream definitions
            this.$inputs.position = pb.vec2().attrib('position');
            this.$inputs.color = pb.vec4().attrib('diffuse');
            // Varying definitions
            this.$outputs.color = pb.vec4();
            // Entry point
            pb.main(function() {
                this.$builtins.position = pb.vec4(this.$inputs.position, 0, 1);
                this.$outputs.color = this.$inputs.color;
            });
        },
        fragment (pb) {
            // Color output
            this.$outputs.color = pb.vec4();
            // Entry point
            pb.main(function() {
                this.$outputs.color = pb.vec4(pb.pow(this.$inputs.color.rgb, pb.vec3(1 / 2.2)), 1);
            });
        }
    });
    // Start rendering loop
    device.runLoop((device)=>{
        // Clear frame buffers
        device.clearFrameBuffer(new Vector4(0, 0, 0.5, 1), 1, 0);
        // Set current shader
        device.setProgram(program);
        // Set vertex input
        device.setVertexLayout(vertexLayout);
        // Render triangles
        device.draw('triangle-list', 0, 3);
        // Display some text
        device.drawText(`Device: ${device.type}`, 30, 30, '#ffffff');
        device.drawText(`FPS: ${device.frameInfo.FPS.toFixed(2)}`, 30, 50, '#ffff00');
    });
})();
//# sourceMappingURL=sample-0.js.map
