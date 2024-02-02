/**
 *  Math type definitions
 */

import { toFloat } from './misc';
import { CubeFace } from './types';
import type { Plane } from './plane';

const IDENT_MATRIX3x3 = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
const IDENT_MATRIX4x4 = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

/**
 * Base class for vector and matrix types.
 * This class extends the Float32Array to observe data changes.
 * @public
 */
export class VectorBase extends Float32Array {
  /**
   * Check if all data is close enough to another
   * @param other - The data to be compared with.
   * @param epsilon - The minimal error allowd.
   * @returns true if close enough, otherwise false.
   */
  equalsTo(other: Float32Array, epsl?: number): boolean {
    if (!other || this.length !== other.length) {
      return false;
    }
    if (this === other) {
      return true;
    }
    for (let i = 0; i < this.length; i++) {
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
   */
  toString(): string {
    const elements = [...this].map(val => val.toFixed(3));
    return `${this.constructor.name}{${elements.join(',')}}`;
  }
  /**
   * Check the data for the presence of NaN.
   *
   * @returns true if NaN is present, otherwise false.
   */
  isNaN(): boolean {
    for (let i = 0; i < this.length; i++) {
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
 */
export class Vector2 extends VectorBase {
  /**
   * Creates a new Vector2 initialized with values.
   * @param x - The x component.
   * @param y - The y component.
   */
  constructor(x: number, y: number);
  /**
   * Creates a new Vector2 initialized with values in an array.
   * @param elements - Array that contains the x, y values.
   */
  constructor(elements: number[]);
  /**
   * Creates a new Vector2 initialized with values in a Float32Array.
   * @param array - Float32Array object that contains the x, y values.
   */
  constructor(array: Float32Array);
  /**
   * Creates a new Vector2 placed on a given ArrayBuffer object.
   * @param buffer - The array buffer object.
   * @param offset - The byte offset of the buffer where the vector placed at.
   */
  constructor(buffer: ArrayBuffer, offset: number);
  /**
   * Creates a new Vector2 filled with zero values.
   */
  constructor();
  constructor(arg0?: number|number[]|Float32Array|ArrayBuffer, arg1?: number) {
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
   */
  clone(): Vector2 {
    return new Vector2(this);
  }
  /** Get the x component value. */
  get x() {
    return this[0];
  }
  set x(v: number) {
    this[0] = v;
  }
  /** Get the y component value. */
  get y() {
    return this[1];
  }
  set y(v: number) {
    this[1] = v;
  }
  /** Get the length of the vector. */
  get magnitude() {
    return Math.sqrt(this[0] * this[0] + this[1] * this[1]);
  }
  /** Get the squared length of the vector. */
  get magnitudeSq() {
    return this[0] * this[0] + this[1] * this[1];
  }
  /**
   * Set component values.
   * @param x - The x component value.
   * @param y - The y component value.
   * @returns self
   */
  setXY(x: number, y: number) {
    this[0] = x;
    this[1] = y;
    return this;
  }
  /**
   * Set component values and then normalize the vector.
   * @param x - The x component value.
   * @param y - The y component value.
   * @returns self
   */
  setAndNormalize(x: number, y: number) {
    const mag = Math.sqrt(x * x + y * y);
    return this.setXY(x / mag, y / mag);
  }
  /**
   * Subtract a vector from this vector.
   * @param other - The vector that will be subtract.
   * @returns self
   */
  subBy(other: Vector2) {
    return Vector2.sub(this, other, this);
  }
  /**
   * Add a vector to this vector.
   * @param other - The vector that will be added.
   * @returns self
   */
  addBy(other: Vector2) {
    return Vector2.add(this, other, this);
  }
  /**
   * Multiply this vector by a vector.
   * @param other - The vector that will be multiplied by.
   * @returns self
   */
  mulBy(other: Vector2) {
    return Vector2.mul(this, other, this);
  }
  /**
   * Divide this vector by a vector.
   * @param other - The vector that will be divide by.
   * @returns self
   */
  divBy(other: Vector2) {
    return Vector2.div(this, other, this);
  }
  /**
   * Scale this vector by a scalar number.
   * @param f - amount to scale this vector by.
   * @returns self
   */
  scaleBy(f: number) {
    return Vector2.scale(this, f, this);
  }
  /**
   * Normalize this vector inplace.
   * @returns self
   */
  inplaceNormalize() {
    return Vector2.normalize(this, this);
  }
  /**
   * Inverse this vector inplace.
   * @returns self
   */
  inplaceInverse() {
    return Vector2.inverse(this, this);
  }
  /**
   * Set the component values to the minimum of this vector and another vector.
   * @param other - The vector that to be compared with.
   * @returns self
   */
  inplaceMin(other: Vector2) {
    return Vector2.min(this, other, this);
  }
  /**
   * Set the component values to the maximum of this vector and another vector.
   * @param other - The vector that to be compared with.
   * @returns self
   */
  inplaceMax(other: Vector2) {
    return Vector2.max(this, other, this);
  }
  /**
   * Creates a new Vector2 initialized with zero values.
   * @returns The new vector
   */
  static zero(): Vector2 {
    return new Vector2(0, 0);
  }
  /**
   * Creates a new Vector2 initialized with one.
   * @returns The new vector
   */
  static one(): Vector2 {
    return new Vector2(1, 1);
  }
  /**
   * Creates a new Vector2 pointing in the positive direction of the X axis, i.e. vec2(1, 0)
   * @returns The new vector
   */
  static axisPX(): Vector2 {
    return new Vector2(1, 0);
  }
  /**
   * Creates a new Vector2 pointing in the negative direction of the X axis, i.e. vec2(-1, 0)
   * @returns The new vector
   */
   static axisNX(): Vector2 {
    return new Vector2(-1, 0);
  }
  /**
   * Creates a new Vector2 pointing in the positive direction of the Y axis, i.e. vec2(0, 1)
   * @returns The new vector
   */
   static axisPY(): Vector2 {
    return new Vector2(0, 1);
  }
  /**
   * Creates a new Vector2 pointing in the negative direction of the Y axis, i.e. vec2(0, -1)
   * @returns The new vector
   */
  static axisNY(): Vector2 {
    return new Vector2(0, -1);
  }
  /**
   * Calculates the distance between two Vector2's.
   * @param v1 - The first vector.
   * @param v2 - The second vector.
   * @returns distance between v1 and v2
   */
  static distance(v1: Vector2, v2: Vector2): number {
    return Math.sqrt(this.distanceSq(v1, v2));
  }
  /**
   * Calculates the squared distance between two Vector2's.
   * @param v1 - The first vector.
   * @param v2 - The second vector.
   * @returns squared distance between v1 and v2
   */
   static distanceSq(v1: Vector2, v2: Vector2): number {
    const dx = v1.x - v2.x;
    const dy = v1.y - v2.y;
    return dx * dx + dy * dy;
  }
  /**
   * Normalize a Vector2
   * @param v - The input vector
   * @param result - The output vector (can be the same vector as v). if not specified, a new vector will be created.
   * @returns The output vector
   */
  static normalize(v: Vector2, result?: Vector2): Vector2 {
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
   */
   static inverse(v: Vector2, result?: Vector2): Vector2 {
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
   */
   static sub(a: Vector2, b: Vector2, result?: Vector2): Vector2 {
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
   */
   static add(a: Vector2, b: Vector2, result?: Vector2): Vector2 {
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
   */
   static mul(a: Vector2, b: Vector2, result?: Vector2): Vector2 {
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
   */
   static div(a: Vector2, b: Vector2, result?: Vector2): Vector2 {
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
   */
   static scale(a: Vector2, b: number, result?: Vector2): Vector2 {
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
   */
   static min(a: Vector2, b: Vector2, result?: Vector2): Vector2 {
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
   */
   static max(a: Vector2, b: Vector2, result?: Vector2): Vector2 {
    const x = a.x > b.x ? a.x : b.x;
    const y = a.y > b.y ? a.y : b.y;
    return (result || new Vector2()).setXY(x, y);
  }
  /**
   * Calculates the absolute values of a Vector2.
   * @param a - The input vector.
   * @param result - The output vector (can be the same vector as a or b). if not specified, a new vector will be created.
   * @returns The output vector
   */
   static abs(a: Vector2, result?: Vector2): Vector2 {
    const x = a.x < 0 ? -a.x : a.x;
    const y = a.y < 0 ? -a.y : a.y;
    return (result || new Vector2()).setXY(x, y);
  }
  /**
   * Calculates the dot product of two Vector2's.
   * @param a - The first operand.
   * @param b - The second operand.
   * @returns dot product of a and b
   */
   static dot(a: Vector2, b: Vector2): number {
    return a.x * b.x + a.y * b.y;
  }
  /**
   * Calculates the cross product of two Vector2's.
   * @param a - The first operand.
   * @param b - The second operand.
   * @returns z component of the cross product of the two vectors.
   */
  static cross(a: Vector2, b: Vector2): number {
    return a.x * b.y - a.y * b.x;
  }
}
/**
 * Observable 2 dimentional vector
 *
 * @public
 */
export class ObservableVector2 extends Vector2 {
  /** @internal */
  private _callback: () => void;
  /** The callback function which will be executed when the value changed */
  get callback() {
    return this._callback;
  }
  set callback(cb) {
    this._callback = cb;
  }
  /**
   * {@inheritDoc Vector2.x}
   */
  get x() {
    return super.x;
  }
  set x(val: number) {
    val = toFloat(val);
    if (val !== super.x) {
      super.x = val;
      this._callback && this._callback();
    }
  }
  /**
   * {@inheritDoc Vector2.y}
   */
  get y() {
    return super.y;
  }
  set y(val: number) {
    val = toFloat(val);
    if (val !== super.y) {
      super.y = val;
      this._callback && this._callback();
    }
  }
  /**
   * {@inheritDoc Vector2.setXY}
   */
  setXY(x: number, y: number): this {
    x = toFloat(x);
    y = toFloat(y);
    if (x !== super.x || y !== super.y) {
      super.setXY(x, y);
      this._callback && this._callback();
    }
    return this;
  }
  /**
   * Inherited from Float32Array.copyWithin
   */
  copyWithin(target: number, start: number, end?: number): this {
    super.copyWithin(target, start, end);
    this._callback && this._callback();
    return this;
  }
  /**
   * Inherited from Float32Array.fill
   */
  fill(value: number, start?: number, end?: number): this {
    super.fill(value,  start, end);
    this._callback && this._callback();
    return this;
  }
  /**
   * Inherited from Float32Array.reverse
   */
  reverse(): Float32Array {
    super.reverse();
    this._callback && this._callback();
    return this;
  }
  /**
   * Inherited from Float32Array.set
   */
  set(array: ArrayLike<number>, offset?: number): void {
    const ret = super.set(array, offset);
    this._callback && this._callback();
  }
  /**
   * Inherited from Float32Array.sort
   */
  sort(compareFn?: (a: number, b: number) => number): this {
    super.sort(compareFn);
    this._callback && this._callback();
    return this;
  }
}
/**
 * 3 dimentional vector
 * @public
 */
export class Vector3 extends VectorBase {
  /**
   * Creates a new Vector3 initialized with values.
   * @param x - The x component.
   * @param y - The y component.
   * @param z - The z component.
   */
  constructor(x: number, y: number, z: number);
  /**
   * Creates a new Vector3 initialized with values in an array.
   * @param elements - Array that contains the x, y, z values.
   */
  constructor(elements: number[]);
  /**
   * Creates a new Vector3 initialized with values in a Float32Array.
   * @param array - Float32Array object that contains the x, y, z values.
   */
  constructor(array: Float32Array);
  /**
   * Creates a new Vector3 placed on a given ArrayBuffer object.
   * @param buffer - The array buffer object.
   * @param offset - The byte offset of the buffer where the vector placed at.
   */
  constructor(buffer: ArrayBuffer, offset: number);
  /**
   * Creates a new Vector3 filled with zero values.
   */
  constructor();
  constructor(arg0?: number|number[]|Float32Array|ArrayBuffer, arg1?: number, arg2?: number) {
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
   */
  clone(): Vector3 {
    return new Vector3(this);
  }
  /** Get the x component value. */
  get x() {
    return this[0];
  }
  set x(v: number) {
    this[0] = v;
  }
  /** Get the y component value. */
  get y() {
    return this[1];
  }
  set y(v: number) {
    this[1] = v;
  }
  /** Get the z component value. */
  get z() {
    return this[2];
  }
  set z(v: number) {
    this[2] = v;
  }
  /** Get the length of the vector. */
  get magnitude(): number {
    return Math.sqrt(this[0] * this[0] + this[1] * this[1] + this[2] * this[2]);
  }
  /** Get the squared length of the vector. */
  get magnitudeSq(): number {
    return this[0] * this[0] + this[1] * this[1] + this[2] * this[2];
  }
  /**
   * Creates a new Vector2 initialized with x, y component of this vector.
   * @returns The new vector
   */
  xy(): Vector2 {
    return new Vector2(this.x, this.y);
  }
  /**
   * Set component values.
   * @param x - The x component value.
   * @param y - The y component value.
   * @param z - The z component value.
   * @returns self
   */
  setXYZ(x: number, y: number, z: number): Vector3 {
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
   */
  setAndNormalize(x: number, y: number, z: number): Vector3 {
    const mag = Math.sqrt(x * x + y * y + z * z);
    return this.setXYZ(x/mag, y/mag, z/mag);
  }
  /**
   * Subtract a vector from this vector.
   * @param other - The vector that will be subtract.
   * @returns self
   */
  subBy(other: Vector3): Vector3 {
    return Vector3.sub(this, other, this);
  }
  /**
   * Add a vector to this vector.
   * @param other - The vector that will be added.
   * @returns self
   */
  addBy(other: Vector3): Vector3 {
    return Vector3.add(this, other, this);
  }
  /**
   * Multiply this vector by a vector.
   * @param other - The vector that will be multiplied by.
   * @returns self
   */
  mulBy(other: Vector3): Vector3 {
    return Vector3.mul(this, other, this);
  }
  /**
   * Divide this vector by a vector.
   * @param other - The vector that will be divide by.
   * @returns self
   */
  divBy(other: Vector3): Vector3 {
    return Vector3.div(this, other, this);
  }
  /**
   * Scale this vector by a scalar number.
   * @param f - amount to scale this vector by.
   * @returns self
   */
  scaleBy(f: number): Vector3 {
    return Vector3.scale(this, f, this);
  }
  /**
   * Normalize this vector inplace.
   * @returns self
   */
  inplaceNormalize() {
    return Vector3.normalize(this, this);
  }
  /**
   * Inverse this vector inplace.
   * @returns self
   */
  inplaceInverse() {
    return Vector3.inverse(this, this);
  }
  /**
   * Set the component values to the minimum of this vector and another vector.
   * @param other - The vector that to be compared with.
   * @returns self
   */
  inplaceMin(other: Vector3) {
    return Vector3.min(this, other, this);
  }
  /**
   * Set the component values to the maximum of this vector and another vector.
   * @param other - The vector that to be compared with.
   * @returns self
   */
  inplaceMax(other: Vector3) {
    return Vector3.max(this, other, this);
  }
  /**
   * Creates a new Vector3 initialized with zero values.
   * @returns The new vector
   */
  static zero(): Vector3 {
    return new Vector3(0, 0, 0);
  }
  /**
   * Creates a new Vector3 initialized with one.
   * @returns The new vector
   */
  static one(): Vector3 {
    return new Vector3(1, 1, 1);
  }
  /**
   * Creates a new Vector3 pointing in the positive direction of the X axis, i.e. vec3(1, 0, 0)
   * @returns The new vector
   */
  static axisPX(): Vector3 {
    return new Vector3(1, 0, 0);
  }
  /**
   * Creates a new Vector3 pointing in the negative direction of the X axis, i.e. vec3(-1, 0, 0)
   * @returns The new vector
   */
  static axisNX(): Vector3 {
    return new Vector3(-1, 0, 0);
  }
  /**
   * Creates a new Vector3 pointing in the positive direction of the Y axis, i.e. vec3(0, 1, 0)
   * @returns The new vector
   */
  static axisPY(): Vector3 {
    return new Vector3(0, 1, 0);
  }
  /**
   * Creates a new Vector3 pointing in the negative direction of the Y axis, i.e. vec3(0, -1, 0)
   * @returns The new vector
   */
  static axisNY(): Vector3 {
    return new Vector3(0, -1, 0);
  }
  /**
   * Creates a new Vector3 pointing in the positive direction of the Z axis, i.e. vec3(0, 0, 1)
   * @returns The new vector
   */
  static axisPZ(): Vector3 {
    return new Vector3(0, 0, 1);
  }
  /**
   * Creates a new Vector2 pointing in the negative direction of the Z axis, i.e. vec3(0, 0, -1)
   * @returns The new vector
   */
  static axisNZ(): Vector3 {
    return new Vector3(0, 0, -1);
  }
  /**
   * Calculates the distance between two Vector3's.
   * @param v1 - The first vector.
   * @param v2 - The second vector.
   * @returns distance between v1 and v2
   */
  static distance(v1: Vector3, v2: Vector3): number {
    return Math.sqrt(this.distanceSq(v1, v2));
  }
  /**
   * Calculates the squared distance between two Vector3's.
   * @param v1 - The first vector.
   * @param v2 - The second vector.
   * @returns squared distance between v1 and v2
   */
  static distanceSq(v1: Vector3, v2: Vector3): number {
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
   */
  static normalize(v: Vector3, result?: Vector3): Vector3 {
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
   */
  static inverse(v: Vector3, result?: Vector3): Vector3 {
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
   */
  static sub(a: Vector3, b: Vector3, result?: Vector3): Vector3 {
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
   */
  static add(a: Vector3, b: Vector3, result?: Vector3): Vector3 {
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
   */
  static mul(a: Vector3, b: Vector3, result?: Vector3): Vector3 {
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
   */
  static div(a: Vector3, b: Vector3, result?: Vector3): Vector3 {
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
   */
  static scale(a: Vector3, b: number, result?: Vector3): Vector3 {
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
   */
  static min(a: Vector3, b: Vector3, result?: Vector3): Vector3 {
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
   */
  static max(a: Vector3, b: Vector3, result?: Vector3): Vector3 {
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
   */
  static abs(a: Vector3, result?: Vector3): Vector3 {
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
   */
  static dot(a: Vector3, b: Vector3): number {
    return a.x * b.x + a.y * b.y + a.z * b.z;
  }
  /**
   * Calculates the cross product of two Vector3's.
   * @param a - The first operand.
   * @param b - The second operand.
   * @returns the cross product of the two vectors.
   */
  static cross(a: Vector3, b: Vector3, result?: Vector3): Vector3 {
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
 */
export class ObservableVector3 extends Vector3 {
  /** @internal */
  private _callback: () => void;
  /** The callback function which will be executed when the value changed */
  get callback() {
    return this._callback;
  }
  set callback(cb) {
    this._callback = cb;
  }
  /**
   * {@inheritDoc Vector3.x}
   */
  get x() {
    return super.x;
  }
  set x(val: number) {
    val = toFloat(val);
    if (val !== super.x) {
      super.x = val;
      this._callback && this._callback();
    }
  }
  /**
   * {@inheritDoc Vector3.y}
   */
  get y() {
    return super.y;
  }
  set y(val: number) {
    val = toFloat(val);
    if (val !== super.y) {
      super.y = val;
      this._callback && this._callback();
    }
  }
  /**
   * {@inheritDoc Vector3.z}
   */
  get z() {
    return super.z;
  }
  set z(val: number) {
    val = toFloat(val);
    if (val !== super.z) {
      super.z = val;
      this._callback && this._callback();
    }
  }
  /**
   * {@inheritDoc Vector3.setXYZ}
   */
  setXYZ(x: number, y: number, z: number): this {
    x = toFloat(x);
    y = toFloat(y);
    z = toFloat(z);
    if (x !== super.x || y !== super.y || z !== super.z) {
      super.setXYZ(x, y, z);
      this._callback && this._callback();
    }
    return this;
  }
  /**
   * Inherited from Float32Array.copyWithin
   */
  copyWithin(target: number, start: number, end?: number): this {
    super.copyWithin(target, start, end);
    this._callback && this._callback();
    return this;
  }
  /**
   * Inherited from Float32Array.fill
   */
  fill(value: number, start?: number, end?: number): this {
    super.fill(value,  start, end);
    this._callback && this._callback();
    return this;
  }
  /**
   * Inherited from Float32Array.reverse
   */
  reverse(): Float32Array {
    super.reverse();
    this._callback && this._callback();
    return this;
  }
  /**
   * Inherited from Float32Array.set
   */
  set(array: ArrayLike<number>, offset?: number): void {
    super.set(array, offset);
    this._callback && this._callback();
  }
  /**
   * Inherited from Float32Array.sort
   */
  sort(compareFn?: (a: number, b: number) => number): this {
    super.sort(compareFn);
    this._callback && this._callback();
    return this;
  }
}
/**
 * 4 dimentional vector
 * @public
 */
export class Vector4 extends VectorBase {
  /**
   * Creates a new Vector4 initialized with values.
   * @param x - The x component.
   * @param y - The y component.
   * @param z - The z component.
   * @param w - The w component.
   */
  constructor(x: number, y: number, z: number, w: number);
  /**
   * Creates a new Vector4 initialized with values in an array.
   * @param elements - Array that contains the x, y, z, w values.
   */
  constructor(elements: number[]);
  /**
   * Creates a new Vector4 initialized with values in a Float32Array.
   * @param array - Float32Array object that contains the x, y, z, w values.
   */
  constructor(array: Float32Array);
  /**
   * Creates a new Vector4 placed on a given ArrayBuffer object.
   * @param buffer - The array buffer object.
   * @param offset - The byte offset of the buffer where the vector placed at.
   */
  constructor(buffer: ArrayBuffer, offset: number);
  /**
   * Creates a new Vector4 filled with zero values.
   */
  constructor();
  constructor(arg0?: number|number[]|Float32Array|ArrayBuffer, arg1?: number, arg2?: number, arg3?: number) {
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
   */
  clone(): Vector4 {
    return new Vector4(this);
  }
  /** Get the x component value. */
  get x() {
    return this[0];
  }
  set x(v: number) {
    this[0] = v;
  }
  /** Get the y component value. */
  get y() {
    return this[1];
  }
  set y(v: number) {
    this[1] = v;
  }
  /** Get the z component value. */
  get z() {
    return this[2];
  }
  set z(v: number) {
    this[2] = v;
  }
  /** Get the w component value. */
  get w() {
    return this[3];
  }
  set w(v: number) {
    this[3] = v;
  }
  /** Get the length of the vector. */
  get magnitude(): number {
    return Math.sqrt(this[0] * this[0] + this[1] * this[1] + this[2] * this[2] + this[3] * this[3]);
  }
  /** Get the squared length of the vector. */
  get magnitudeSq(): number {
    return this[0] * this[0] + this[1] * this[1] + this[2] * this[2] + this[3] * this[3];
  }
  /**
   * Creates a new Vector2 initialized with x, y component of this vector.
   * @returns The new vector
   */
  xy(): Vector2 {
    return new Vector2(this.x, this.y);
  }
  /**
   * Creates a new Vector3 initialized with x, y, z component of this vector.
   * @returns The new vector
   */
  xyz(): Vector3 {
    return new Vector3(this.x, this.y, this.z);
  }
  /**
   * Set component values.
   * @param x - The x component value.
   * @param y - The y component value.
   * @param z - The z component value.
   * @param w - The w component value.
   * @returns self
   */
  setXYZW(x: number, y: number, z: number, w: number): Vector4 {
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
   */
  setAndNormalize(x: number, y: number, z: number, w: number): Vector4 {
    const mag = Math.sqrt(x*x + y*y + z*z + w*w);
    return this.setXYZW(x/mag, y/mag, z/mag, w/mag);
  }
  /**
   * Subtract a vector from this vector.
   * @param other - The vector that will be subtract.
   * @returns self
   */
  subBy(other: Vector4): Vector4 {
    return Vector4.sub(this, other, this);
  }
  /**
   * Add a vector to this vector.
   * @param other - The vector that will be added.
   * @returns self
   */
  addBy(other: Vector4): Vector4 {
    return Vector4.add(this, other, this);
  }
  /**
   * Multiply this vector by a vector.
   * @param other - The vector that will be multiplied by.
   * @returns self
   */
  mulBy(other: Vector4): Vector4 {
    return Vector4.mul(this, other, this);
  }
  /**
   * Divide this vector by a vector.
   * @param other - The vector that will be divide by.
   * @returns self
   */
  divBy(other: Vector4): Vector4 {
    return Vector4.div(this, other, this);
  }
  /**
   * Scale this vector by a scalar number.
   * @param f - amount to scale this vector by.
   * @returns self
   */
  scaleBy(f: number): Vector4 {
    return Vector4.scale(this, f, this);
  }
  /**
   * Normalize this vector inplace.
   * @returns self
   */
  inplaceNormalize(): Vector4 {
    return Vector4.normalize(this, this);
  }
  /**
   * Inverse this vector inplace.
   * @returns self
   */
  inplaceInverse(): Vector4 {
    return Vector4.inverse(this, this);
  }
  /**
   * Set the component values to the minimum of this vector and another vector.
   * @param other - The vector that to be compared with.
   * @returns self
   */
  inplaceMin(other: Vector4) {
    return Vector4.min(this, other, this);
  }
  /**
   * Set the component values to the maximum of this vector and another vector.
   * @param other - The vector that to be compared with.
   * @returns self
   */
  inplaceMax(other: Vector4) {
    return Vector4.max(this, other, this);
  }
  /**
   * Creates a new Vector4 initialized with zero values.
   * @returns The new vector
   */
  static zero(): Vector4 {
    return new Vector4(0, 0, 0, 0);
  }
  /**
   * Creates a new Vector4 initialized with one.
   * @returns The new vector
   */
  static one(): Vector4 {
    return new Vector4(1, 1, 1, 1);
  }
  /**
   * Creates a new Vector4 pointing in the positive direction of the X axis, i.e. vec4(1, 0, 0, 0)
   * @returns The new vector
   */
  static axisPX(): Vector4 {
    return new Vector4(1, 0, 0, 0);
  }
  /**
   * Creates a new Vector4 pointing in the negative direction of the X axis, i.e. vec4(-1, 0, 0, 0)
   * @returns The new vector
   */
  static axisNX(): Vector4 {
    return new Vector4(-1, 0, 0, 0);
  }
  /**
   * Creates a new Vector4 pointing in the positive direction of the Y axis, i.e. vec4(0, 1, 0, 0)
   * @returns The new vector
   */
  static axisPY(): Vector4 {
    return new Vector4(0, 1, 0, 0);
  }
  /**
   * Creates a new Vector4 pointing in the negative direction of the Y axis, i.e. vec4(0, -1, 0, 0)
   * @returns The new vector
   */
  static axisNY(): Vector4 {
    return new Vector4(0, -1, 0, 0);
  }
  /**
   * Creates a new Vector4 pointing in the positive direction of the Z axis, i.e. vec4(0, 0, 1, 0)
   * @returns The new vector
   */
  static axisPZ(): Vector4 {
    return new Vector4(0, 0, 1, 0);
  }
  /**
   * Creates a new Vector4 pointing in the negative direction of the Z axis, i.e. vec4(0, 0, -1, 0)
   * @returns The new vector
   */
  static axisNZ(): Vector4 {
    return new Vector4(0, 0, -1, 0);
  }
  /**
   * Creates a new Vector4 pointing in the positive direction of the W axis, i.e. vec4(0, 0, 0, 1)
   * @returns The new vector
   */
  static axisPW(): Vector4 {
    return new Vector4(0, 0, 0, 1);
  }
  /**
   * Creates a new Vector4 pointing in the negative direction of the W axis, i.e. vec4(0, 0, 0, -1)
   * @returns The new vector
   */
  static axisNW(): Vector4 {
    return new Vector4(0, 0, 0, -1);
  }
  /**
   * Normalize a Vector4
   * @param v - The input vector
   * @param result - The output vector (can be the same as v). if not specified, a new vector will be created.
   * @returns The output vector
   */
  static normalize(v: Vector4, result?: Vector4): Vector4 {
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
   */
  static inverse(v: Vector4, result?: Vector4): Vector4 {
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
   */
  static sub(a: Vector4, b: Vector4, result?: Vector4): Vector4 {
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
   */
  static add(a: Vector4, b: Vector4, result?: Vector4): Vector4 {
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
   */
  static mul(a: Vector4, b: Vector4, result?: Vector4): Vector4 {
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
   */
  static div(a: Vector4, b: Vector4, result?: Vector4): Vector4 {
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
   */
  static scale(a: Vector4, b: number, result?: Vector4): Vector4 {
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
   */
  static min(a: Vector4, b: Vector4, result?: Vector4): Vector4 {
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
   */
  static max(a: Vector4, b: Vector4, result?: Vector4): Vector4 {
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
   */
  static abs(a: Vector4, result?: Vector4): Vector4 {
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
   */
  static dot(a: Vector4, b: Vector4): number {
    return a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
  }
}
/**
 * Observable 4 dimentional vector
 *
 * @public
 */
export class ObservableVector4 extends Vector4 {
  /** @internal */
  private _callback: () => void;
  /** The callback function which will be executed when the value changed */
  get callback() {
    return this._callback;
  }
  set callback(cb) {
    this._callback = cb;
  }
  /**
   * {@inheritDoc Vector4.x}
   */
  get x() {
    return super.x;
  }
  set x(val: number) {
    val = toFloat(val);
    if (val !== super.x) {
      super.x = val;
      this._callback && this._callback();
    }
  }
  /**
   * {@inheritDoc Vector4.y}
   */
  get y() {
    return super.y;
  }
  set y(val: number) {
    val = toFloat(val);
    if (val !== super.y) {
      super.y = val;
      this._callback && this._callback();
    }
  }
  /**
   * {@inheritDoc Vector4.z}
   */
  get z() {
    return super.z;
  }
  set z(val: number) {
    val = toFloat(val);
    if (val !== super.z) {
      super.z = val;
      this._callback && this._callback();
    }
  }
  /**
   * {@inheritDoc Vector4.w}
   */
   get w() {
    return super.w;
  }
  set w(val: number) {
    val = toFloat(val);
    if (val !== super.w) {
      super.w = val;
      this._callback && this._callback();
    }
  }
  /**
   * {@inheritDoc Vector4.setXYZW}
   */
  setXYZW(x: number, y: number, z: number, w: number): this {
    x = toFloat(x);
    y = toFloat(y);
    z = toFloat(z);
    w = toFloat(w);
    if (x !== super.x || y !== super.y || z !== super.z || w !== super.w) {
      super.setXYZW(x, y, z, w);
      this._callback && this._callback();
    }
    return this;
  }
  /**
   * Inherited from Float32Array.copyWithin
   */
  copyWithin(target: number, start: number, end?: number): this {
    super.copyWithin(target, start, end);
    this._callback && this._callback();
    return this;
  }
  /**
   * Inherited from Float32Array.fill
   */
  fill(value: number, start?: number, end?: number): this {
    super.fill(value,  start, end);
    this._callback && this._callback();
    return this;
  }
  /**
   * Inherited from Float32Array.reverse
   */
  reverse(): Float32Array {
    super.reverse();
    this._callback && this._callback();
    return this;
  }
  /**
   * Inherited from Float32Array.set
   */
  set(array: ArrayLike<number>, offset?: number): void {
    super.set(array, offset);
    this._callback && this._callback();
  }
  /**
   * Inherited from Float32Array.sort
   */
  sort(compareFn?: (a: number, b: number) => number): this {
    super.sort(compareFn);
    this._callback && this._callback();
    return this;
  }
}
/**
 * Quaternion
 * @public
 */
export class Quaternion extends VectorBase {
  /**
   * Creates a new Quaternion initialized with values.
   * @param x - The x component.
   * @param y - The y component.
   * @param z - The z component.
   * @param w - The w component.
   */
  constructor(x: number, y: number, z: number, w: number);
  /**
   * Creates a new Quaternion initialized with values in an array.
   * @param elements - Array that contains the x, y, z, w values.
   */
  constructor(elements: number[]);
  /**
   * Creates a new Quaternion initialized with values in a Float32Array.
   * @param array - Float32Array object that contains the x, y, z, w values.
   */
  constructor(array: Float32Array);
  /**
   * Creates a new Quaternion placed on a given ArrayBuffer object.
   * @param buffer - The array buffer object.
   * @param offset - The byte offset of the buffer where the vector placed at.
   */
  constructor(buffer: ArrayBuffer, offset: number);
  /**
   * Creates a new identity Quaternion.
   */
  constructor();
  constructor(arg0?: number|number[]|Float32Array|ArrayBuffer, arg1?: number, arg2?: number, arg3?: number) {
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
   */
  clone(): Quaternion {
    return new Quaternion(this);
  }
  /** Get the x component value. */
  get x() {
    return this[0];
  }
  set x(v: number) {
    this[0] = v;
  }
  /** Get the y component value. */
  get y() {
    return this[1];
  }
  set y(v: number) {
    this[1] = v;
  }
  /** Get the z component value. */
  get z() {
    return this[2];
  }
  set z(v: number) {
    this[2] = v;
  }
  /** Get the w component value. */
  get w() {
    return this[3];
  }
  set w(v: number) {
    this[3] = v;
  }
  /**
   * Set component values.
   * @param x - The x component value.
   * @param y - The y component value.
   * @param z - The z component value.
   * @param w - The w component value.
   * @returns self
   */
  setXYZW(x: number, y: number, z: number, w: number): Quaternion {
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
   */
  scaleBy(f: number): Quaternion {
    return Quaternion.scale(this, f, this);
  }
  /**
   * Set component values and then normalize the quaternion.
   * @param x - The x component value.
   * @param y - The y component value.
   * @param z - The z component value.
   * @param w - The w component value.
   * @returns self
   */
  setAndNormalize(x: number, y: number, z: number, w: number): Quaternion {
    const mag = Math.sqrt(x * x + y * y + z * z + w * w);
    return this.setXYZW(x/mag, y/mag, z/mag, w/mag);
  }
  /** Get the length of the quaternion. */
  get magnitude(): number {
    return Math.sqrt(this[0] * this[0] + this[1] * this[1] + this[2] * this[2] + this[3] * this[3]);
  }
  /** Get the squared length of the quaternion. */
  get magnitudeSq(): number {
    return this[0] * this[0] + this[1] * this[1] + this[2] * this[2] + this[3] * this[3];
  }
  /** Make this quaternion an identity quaternion */
  identity(): Quaternion {
    return Quaternion.identity(this);
  }
  /**
   * Normalize this quaternion inplace.
   * @returns self
   */
  inplaceNormalize(): Quaternion {
    return Quaternion.normalize(this, this);
  }
  /**
   * Calculates the conjugate of this quaternion inplace.
   * @returns self
   */
  inplaceConjugate(): Quaternion {
    return Quaternion.conjugate(this, this);
  }
  /**
   * Multiply this quaternion by another quaternion at the right side inplace.
   * @param other - The quaternion that to be multiplied by.
   * @returns self
   */
  multiplyRight(other: Quaternion) {
    return Quaternion.multiply(this, other, this);
  }
  /**
   * Multiply this quaternion by another quaternion at the left side inplace.
   * @param other - The quaternion that to be multiplied by.
   * @returns self
   */
  multiplyLeft(other: Quaternion) {
    return Quaternion.multiply(other, this, this);
  }
  /**
   * Make a quaternion used to rotate a unit vector to another inplace.
   * @param from - The unit vector to be rotated.
   * @param to - The destination unit vector.
   * @returns self
   */
  unitVectorToUnitVector(from: Vector3, to: Vector3) {
    return Quaternion.unitVectorToUnitVector(from, to, this);
  }
  /**
   * Calculates the quaternion from an euler angle in specific order inplace.
   * @param x - Angle to rotate around X axis in radians.
   * @param y - Angle to rotate around Y axis in radians.
   * @param z - Angle to rotate around Z axis in radians.
   * @param order - Intrinsic order for conversion.
   * @returns self
   */
  fromEulerAngle(x: number, y: number, z: number, order: 'XYZ' | 'YXZ' | 'ZXY' | 'ZYX' | 'YZX' | 'XZY') {
    return Quaternion.fromEulerAngle(x, y, z, order, this);
  }
  /**
   * Calculates the quaternion from the given angle and rotation axis inplace.
   * @param axis - The rotation axis.
   * @param angle - The rotate angle.
   * @returns self
   */
  fromAxisAngle(axis: Vector3, angle: number) {
    return Quaternion.fromAxisAngle(axis, angle, this);
  }
  /**
   * Calculates the rotation axis and angle for this quaternion
   * @param axis - A vector that receives the rotation axis.
   * @returns - The rotation angle
   */
  toAxisAngle(axis: Vector3): number {
    const rad = Math.acos(this[3]) * 2;
    const s = Math.sin(rad / 2);
    if (s > 0.000001) {
      axis.setXYZ(this[0]/s, this[1]/2, this[2]/s);
    } else {
      axis.setXYZ(1, 0, 0);
    }
    return rad;
  }
  /**
   * Convert this rotation to euler angles in ZYX order
   * @param angles - A vector that receives the euler angles. If not given, a new vector will be created.
   * @returns The vector that holds the euler angles.
   */
  toEulerAngles(angles?: Vector3): Vector3 {
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
   */
  fromRotationMatrix(matrix: Matrix3x3 | Matrix4x4) {
    return Quaternion.fromRotationMatrix(matrix, this);
  }
  /**
   * Convert this quaternion to a 3x3 rotation matrix.
   * @param matrix - The output matrix, if not specified, a new matrix will be created.
   * @returns The output matrix.
   */
  toMatrix3x3(matrix?: Matrix3x3): Matrix3x3 {
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
   */
   toMatrix4x4(matrix?: Matrix4x4): Matrix4x4 {
    const m = matrix || Matrix4x4.identity();
    this.toMatrix(m);
    return m;
  }
  /**
   * Get the direction of axis x
   * @param result - The output vector, if not specified, a new vector will be created.
   * @returns The direction of axis x
   */
  getDirectionX(result?: Vector3): Vector3 {
    result = result ?? new Vector3();
    return result.setXYZ(1-2*(this.y*this.y+this.z*this.z), 2*(this.x*this.y+this.z*this.w), 2*(this.z*this.x-this.y*this.w));
  }
  /**
   * Get the direction of axis y
   * @param result - The output vector, if not specified, a new vector will be created.
   * @returns The direction of axis y
   */
  getDirectionY(result?: Vector3): Vector3 {
    result = result ?? new Vector3();
    return result.setXYZ(2*(this.x*this.y-this.z*this.w), 1-2*(this.z*this.z+this.x*this.x), 2*(this.y*this.z+this.x*this.w));
  }
  /**
   * Get the direction of axis z
   * @param result - The output vector, if not specified, a new vector will be created.
   * @returns The direction of axis z
   */
  getDirectionZ(result?: Vector3): Vector3 {
    result = result ?? new Vector3();
    return result.setXYZ(2*(this.z*this.x+this.y*this.w), 2*(this.y*this.z-this.x*this.w), 1-2*(this.y*this.y+this.x*this.x));
  }
  /**
   * Get the rotate angle and the rotation axis for this quaternion.
   * @param result - The output vector, if not specified, a new vector will be created.
   * @returns An vector4 that the x, y, z component presents the axis and the w component presents the angle.
   */
  getAxisAngle(result?: Vector4): Vector4 {
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
   */
  transform(v: Vector3, result?: Vector3): Vector3 {
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
    return result.setXYZ(
      (1 - yy - zz) * v.x + (xy - wz) * v.y + (xz + wy) * v.z,
      (xy + wz) * v.x + (1 - xx - zz) * v.y + (yz - wx) * v.z,
      (xz - wy) * v.x + (yz + wx) * v.y + (1 - xx - yy) * v.z
    );
  }
  /**
   * Scale a Quaternion by a scalar number.
   * @param a - The quaternion to be scaled.
   * @param b - The scalar number.
   * @param result - The output quaternion (can be the same quaternion as a). if not specified, a new quaternion will be created.
   * @returns The output quaternion
   */
  static scale(q: Quaternion, t: number, result?: Quaternion): Quaternion {
    result = result || q;
    return result.setXYZW(q.x * t, q.y * t, q.z * t, q.w * t);
  }
  /**
   * Calculates the dot product of two Quaternion's.
   * @param a - The first operand.
   * @param b - The second operand.
   * @returns dot product of a and b
   */
  static dot(a: Quaternion, b: Quaternion): number {
    return a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
  }
  /**
   * Create an identity quaternion
   * @param q - The output quaternion, if not specified, a new quaternion will be created.
   * @returns The output quaternion
   */
  static identity(q?: Quaternion): Quaternion {
    return (q || new Quaternion()).setXYZW(0, 0, 0, 1);
  }
  /**
   * Normalize a quaternion
   * @param q - The input quaternion
   * @param result - The output quaternion (can be the same as q), if not specified, a new quaternion will be created.
   * @returns The output quaternion
   */
  static normalize(q: Quaternion, result?: Quaternion): Quaternion {
    const mag = q.magnitude;
    return (result || new Quaternion()).setXYZW(q.x / mag, q.y / mag, q.z / mag, q.w / mag);
  }
  /**
   * Gets the conjugate of a quaternion
   * @param q - The input quaternion
   * @param result - The output quaternion (can be the same as q), if not specified, a new quaternion will be created.
   * @returns The output quaternion
   */
  static conjugate(q: Quaternion, result?: Quaternion): Quaternion {
    return (result || new Quaternion()).setXYZW(-q.x, -q.y, -q.z, q.w);
  }
  /**
   * Multiply two Quaternion's.
   * @param a - The first operand.
   * @param b - The second operand.
   * @param result - The output quaternion (can be the same as a or b). if not specified, a new quaternion will be created.
   * @returns The output quaternion
   */
  static multiply(a: Quaternion, b: Quaternion, result?: Quaternion): Quaternion {
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
   */
  static slerp(a: Quaternion, b: Quaternion, t: number, result?: Quaternion): Quaternion {
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
      return result.setAndNormalize(
        a.x * s + b.x * t,
        a.y * s + b.y * t,
        a.z * s + b.z * t,
        a.w * s + b.w * t
      );
    }
    const halfSin = Math.sqrt(halfSinSqr);
    const halfTheta = Math.atan2(halfSin, halfCos);
    const ratioA = Math.sin((1 - t) * halfTheta) / halfSin;
    const ratioB = Math.sin(t * halfTheta) / halfSin;
    return result.setXYZW(
      ax * ratioA + bx * ratioB,
      ay * ratioA + by * ratioB,
      az * ratioA + bz * ratioB,
      aw * ratioA + bw * ratioB
    );
  }
  /**
   * Gets the angular distance between two unit quaternions.
   * @param a - The origin quaternion
   * @param b - The destination quaternion
   * @returns - The angle in radians
   */
  static angleBetween(a: Quaternion, b: Quaternion): number {
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
   */
  static unitVectorToUnitVector(from: Vector3, to: Vector3, result?: Quaternion): Quaternion {
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
      return result.setAndNormalize(
        from.y * to.z - from.z * to.y,
        from.z * to.x - from.x * to.z,
        from.x * to.y - from.y * to.x,
        r
      );
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
   */
  static fromEulerAngle(
    a: number,
    b: number,
    c: number,
    order: 'XYZ' | 'YXZ' | 'ZXY' | 'ZYX' | 'YZX' | 'XZY',
    result?: Quaternion
  ): Quaternion {
    result = result || new Quaternion();
    const c1 = Math.cos(a / 2);
    const c2 = Math.cos(b / 2);
    const c3 = Math.cos(c / 2);
    const s1 = Math.sin(a / 2);
    const s2 = Math.sin(b / 2);
    const s3 = Math.sin(c / 2);
    switch (order) {
      case 'XYZ':
        return result.setXYZW(
          s1 * c2 * c3 + c1 * s2 * s3,
          c1 * s2 * c3 - s1 * c2 * s3,
          c1 * c2 * s3 + s1 * s2 * c3,
          c1 * c2 * c3 - s1 * s2 * s3
        );
      case 'YXZ':
        return result.setXYZW(
          s1 * c2 * c3 + c1 * s2 * s3,
          c1 * s2 * c3 - s1 * c2 * s3,
          c1 * c2 * s3 - s1 * s2 * c3,
          c1 * c2 * c3 + s1 * s2 * s3
        );
      case 'ZXY':
        return result.setXYZW(
          s1 * c2 * c3 - c1 * s2 * s3,
          c1 * s2 * c3 + s1 * c2 * s3,
          c1 * c2 * s3 + s1 * s2 * c3,
          c1 * c2 * c3 - s1 * s2 * s3
        );
      case 'ZYX':
        return result.setXYZW(
          s1 * c2 * c3 - c1 * s2 * s3,
          c1 * s2 * c3 + s1 * c2 * s3,
          c1 * c2 * s3 - s1 * s2 * c3,
          c1 * c2 * c3 + s1 * s2 * s3
        );
      case 'YZX':
        return result.setXYZW(
          s1 * c2 * c3 + c1 * s2 * s3,
          c1 * s2 * c3 + s1 * c2 * s3,
          c1 * c2 * s3 - s1 * s2 * c3,
          c1 * c2 * c3 - s1 * s2 * s3
        );
      case 'XZY':
        return result.setXYZW(
          s1 * c2 * c3 - c1 * s2 * s3,
          c1 * s2 * c3 - s1 * c2 * s3,
          c1 * c2 * s3 + s1 * s2 * c3,
          c1 * c2 * c3 + s1 * s2 * s3
        );
    }
  }
  /**
   * Creates a quaternion from the given angle and rotation axis.
   * @param axis - The rotation axis.
   * @param angle - The rotate angle.
   * @param result - The output quaternion, if not specified, a new quaternion will be created.
   * @returns The output quaternion
   */
  static fromAxisAngle(axis: Vector3, angle: number, result?: Quaternion): Quaternion {
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
   */
  static fromRotationMatrix(matrix: Matrix3x3 | Matrix4x4, result?: Quaternion): Quaternion {
    // assume matrix contains rotation without scaling
    result = result || new Quaternion();
    const trace = matrix.m00 + matrix.m11 + matrix.m22;
    let s;
    if (trace > 0) {
      s = 0.5 / Math.sqrt(trace + 1);
      result.setXYZW(
        (matrix.m21 - matrix.m12) * s,
        (matrix.m02 - matrix.m20) * s,
        (matrix.m10 - matrix.m01) * s,
        0.25 / s
      );
    } else if (matrix.m00 > matrix.m11 && matrix.m00 > matrix.m22) {
      s = 2 * Math.sqrt(1 + matrix.m00 - matrix.m11 - matrix.m22);
      result.setXYZW(
        0.25 * s,
        (matrix.m01 + matrix.m10) / s,
        (matrix.m02 + matrix.m20) / s,
        (matrix.m21 - matrix.m12) / s
      );
    } else if (matrix.m11 > matrix.m22) {
      s = 2 * Math.sqrt(1 - matrix.m00 + matrix.m11 - matrix.m22);
      result.setXYZW(
        (matrix.m10 + matrix.m01) / s,
        0.25 * s,
        (matrix.m21 + matrix.m12) / s,
        (matrix.m02 - matrix.m20) / s
      );
    } else {
      s = 2 * Math.sqrt(1 - matrix.m00 - matrix.m11 + matrix.m22);
      result.setXYZW(
        (matrix.m02 + matrix.m20) / s,
        (matrix.m12 + matrix.m21) / s,
        0.25 * s,
        (matrix.m10 - matrix.m01) / s
      );
    }
    return result;
  }
  /** @internal */
  private toMatrix(matrix: Matrix3x3 | Matrix4x4) {
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
 */
export class ObservableQuaternion extends Quaternion {
  /** @internal */
  private _callback: () => void;
  /** The callback function which will be executed when the value changed */
  get callback() {
    return this._callback;
  }
  set callback(cb) {
    this._callback = cb;
  }
  /**
   * {@inheritDoc Quaternion.x}
   */
  get x() {
    return super.x;
  }
  set x(val: number) {
    val = toFloat(val);
    if (val !== super.x) {
      super.x = val;
      this._callback && this._callback();
    }
  }
  /**
   * {@inheritDoc Quaternion.y}
   */
  get y() {
    return super.y;
  }
  set y(val: number) {
    val = toFloat(val);
    if (val !== super.y) {
      super.y = val;
      this._callback && this._callback();
    }
  }
  /**
   * {@inheritDoc Quaternion.z}
   */
  get z() {
    return super.z;
  }
  set z(val: number) {
    val = toFloat(val);
    if (val !== super.z) {
      super.z = val;
      this._callback && this._callback();
    }
  }
  /**
   * {@inheritDoc Quaternion.w}
   */
   get w() {
    return super.w;
  }
  set w(val: number) {
    val = toFloat(val);
    if (val !== super.w) {
      super.w = val;
      this._callback && this._callback();
    }
  }
  /**
   * {@inheritDoc Quaternion.setXYZW}
   */
  setXYZW(x: number, y: number, z: number, w: number): this {
    x = toFloat(x);
    y = toFloat(y);
    z = toFloat(z);
    w = toFloat(w);
    if (x !== super.x || y !== super.y || z !== super.z || w !== super.w) {
      super.setXYZW(x, y, z, w);
      this._callback && this._callback();
    }
    return this;
  }
  /**
   * Inherited from Float32Array.copyWithin
   */
  copyWithin(target: number, start: number, end?: number): this {
    super.copyWithin(target, start, end);
    this._callback && this._callback();
    return this;
  }
  /**
   * Inherited from Float32Array.fill
   */
  fill(value: number, start?: number, end?: number): this {
    super.fill(value,  start, end);
    this._callback && this._callback();
    return this;
  }
  /**
   * Inherited from Float32Array.reverse
   */
  reverse(): Float32Array {
    super.reverse();
    this._callback && this._callback();
    return this;
  }
  /**
   * Inherited from Float32Array.set
   */
  set(array: ArrayLike<number>, offset?: number): void {
    const ret = super.set(array, offset);
    this._callback && this._callback();
  }
  /**
   * Inherited from Float32Array.sort
   */
  sort(compareFn?: (a: number, b: number) => number): this {
    super.sort(compareFn);
    this._callback && this._callback();
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
 */
export class Matrix3x3 extends VectorBase {
  /**
   * Creates a Matrix3x3 initialized with values.
   * @param m00 - element at row 0, column 0
   * @param m10 - element at row 0, column 1
   * @param m20 - element at row 0, column 2
   * @param m01 - element at row 1, column 0
   * @param m11 - element at row 1, column 1
   * @param m21 - element at row 1, column 2
   * @param m02 - element at row 2, column 0
   * @param m12 - element at row 2, column 1
   * @param m22 - element at row 2, column 2
   */
  constructor(
    m00: number, m10: number, m20: number,
    m01: number, m11: number, m21: number,
    m02: number, m12: number, m22: number);
  /**
   * Creates a Matrix3x3 initialized with values in an array.
   * @param elements - Array that contains the values.
   */
  constructor(elements: number[]);
  /**
   * Cerates a Matrix3x3 initialized with values in a Float32Array.
   * @param array - Float32Array object that contains the values.
   */
  constructor(array: Float32Array);
  /**
   * Creates a new Matrix3x3 placed on a given ArrayBuffer object.
   * @param buffer - The array buffer object.
   * @param offset - The byte offset of the buffer where the matrix placed at.
   */
  constructor(buffer: ArrayBuffer, offset: number);
  /**
   * Creates a new identity Matrix3x3.
   */
  constructor();
  constructor(arg0?: number|number[]|Float32Array|ArrayBuffer, arg1?: number, arg2?: number, arg3?: number, arg4?: number, arg5?: number, arg6?: number, arg7?: number, arg8?: number) {
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
   */
  clone(): Matrix3x3 {
    return new Matrix3x3(this);
  }
  /** Get the element at row 0, column 0 */
  get m00() {
    return this[0];
  }
  set m00(v: number) {
    this[0] = v;
  }
  /** Get the element at row 0, column 1 */
  get m10() {
    return this[1];
  }
  set m10(v: number) {
    this[1] = v;
  }
  /** Get the element at row 0, column 2 */
  get m20() {
    return this[2];
  }
  set m20(v: number) {
    this[2] = v;
  }
  /** Get the element at row 1, column 0 */
  get m01() {
    return this[3];
  }
  set m01(v: number) {
    this[3] = v;
  }
  /** Get the element at row 1, column 1 */
  get m11() {
    return this[4];
  }
  set m11(v: number) {
    this[4] = v;
  }
  /** Get the element at row 1, column 2 */
  get m21() {
    return this[5];
  }
  set m21(v: number) {
    this[5] = v;
  }
  /** Get the element at row 2, column 0 */
  get m02() {
    return this[6];
  }
  set m02(v: number) {
    this[6] = v;
  }
  /** Get the element at row 2, column 1 */
  get m12() {
    return this[7];
  }
  set m12(v: number) {
    this[7] = v;
  }
  /** Get the element at row 2, column 2 */
  get m22() {
    return this[8];
  }
  set m22(v: number) {
    this[8] = v;
  }
  /**
   * Get the values in a row as a Vector3
   * @param row - The row index
   * @param result - The output vector, if not specified, a new vector will be created.
   * @returns The output vector
   */
  getRow(row: number, result?: Vector3): Vector3 {
    return (result || new Vector3()).setXYZ(this[row * 3], this[row * 3 + 1], this[row * 3 + 2]);
  }
  /**
   * Set values to a row in the matrix.
   * @param row - The row index
   * @param v - The values to be set
   * @returns - self
   */
  setRow(row: number, v: Vector3) {
    this[row * 3] = v.x;
    this[row * 3 + 1] = v.y;
    this[row * 3 + 2] = v.z;
    return this;
  }
  /**
   * Get the values in a column as a Vector3
   * @param col - The column index
   * @param result - The output vector, if not specified, a new vector will be created.
   * @returns The output vector
   */
   getCol(col: number, result?: Vector3): Vector3 {
    return (result || new Vector3()).setXYZ(this[col], this[3 + col], this[6 + col]);
  }
  /**
   * Set values to a column in the matrix.
   * @param col - The column index.
   * @param v - The values to be set.
   * @returns self
   */
  setCol(col: number, v: Vector3) {
    this[col] = v.x;
    this[3 + col] = v.y;
    this[6 + col] = v.z;
    return this;
  }
  /**
   * Adds two Matrix3x3's component-wise.
   * @param a - The first operand.
   * @param b - The second operand.
   * @param result - The output matrix (can be the same as a or b), if not specified, a new matrix will be created.
   * @returns The output matrix
   */
  static add(a: Matrix3x3, b: Matrix3x3, result?: Matrix3x3) {
    result = result || new Matrix3x3();
    for (let i = 0; i < 9; i++) {
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
   */
  static sub(a: Matrix3x3, b: Matrix3x3, result?: Matrix3x3) {
    result = result || new Matrix3x3();
    for (let i = 0; i < 9; i++) {
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
   */
  static mul(a: Matrix3x3, b: Matrix3x3, result?: Matrix3x3) {
    result = result || new Matrix3x3();
    for (let i = 0; i < 9; i++) {
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
   */
  static div(a: Matrix3x3, b: Matrix3x3, result?: Matrix3x3) {
    result = result || new Matrix3x3();
    for (let i = 0; i < 9; i++) {
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
   */
  static scale(a: Matrix3x3, f: number, result?: Matrix3x3) {
    result = result || new Matrix3x3();
    for (let i = 0; i < 9; i++) {
      result[i] = a[i] * f;
    }
    return result;
  }
  /**
   * Creates an identity Matrix3x3.
   * @param result - The output matrix, if not specified, a new matrix will be created.
   * @returns The output matrix
   */
  static identity(result?: Matrix3x3): Matrix3x3 {
    result = result || new Matrix3x3();
    result.set(IDENT_MATRIX3x3);
    return result;
  }
  /**
   * Transpose a Matrix3x3.
   * @param matrix - The matrix to be transposed.
   * @param result - The output matrix (can be the same as matrix), if not specified, a new matrix will be created.
   * @returns The output matrix
   */
  static transpose(matrix: Matrix3x3, result?: Matrix3x3): Matrix3x3 {
    result = result || new Matrix3x3();
    if (matrix === result) {
      [result[1], result[3]] = [result[3], result[1]];
      [result[2], result[6]] = [result[6], result[2]];
      [result[5], result[7]] = [result[7], result[5]];
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
   */
  static invert(matrix: Matrix3x3, result?: Matrix3x3): Matrix3x3 {
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
   */
  static rotationX(angle: number, result?: Matrix3x3): Matrix3x3 {
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
   */
   static rotationY(angle: number, result?: Matrix3x3): Matrix3x3 {
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
   */
   static rotationZ(angle: number, result?: Matrix3x3): Matrix3x3 {
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
   */
   static rotation(axis: Vector3, angle: number, result?: Matrix3x3): Matrix3x3 {
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
   */
  static multiply(m1: Matrix3x3, m2: Matrix3x3, result?: Matrix3x3): Matrix3x3 {
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
   */
  subBy(other: Matrix3x3) {
    return Matrix3x3.sub(this, other, this);
  }
  /**
   * Add a matrix to this matrix component-wise.
   * @param other - The matrix that will be added.
   * @returns self
   */
  addBy(other: Matrix3x3) {
    return Matrix3x3.add(this, other, this);
  }
  /**
   * Multiplies this matrix by a matrix component-wise.
   * @param other - The matrix that will be multiplied by.
   * @returns self
   */
  mulBy(other: Matrix3x3) {
    return Matrix3x3.mul(this, other, this);
  }
  /**
   * Divide this matrix by a matrix component-wise.
   * @param other - The matrix that will be divide by.
   * @returns self
   */
  divBy(other: Matrix3x3) {
    return Matrix3x3.div(this, other, this);
  }
  /**
   * Scale this matrix by a scalar number component-wise.
   * @param f - amount to scale this matrix by.
   * @returns self
   */
  scaleBy(f: number) {
    return Matrix3x3.scale(this, f, this);
  }
  /**
   * Make this matrix identity.
   * @returns self
   */
  identity() {
    return Matrix3x3.identity(this);
  }
  /**
   * Calculate the inverse of this matrix inplace.
   * @returns self
   */
  inplaceInvert() {
    return Matrix3x3.invert(this, this);
  }
  /**
   * Calculate the transpose of this matrix inplace.
   * @returns self
   */
  transpose() {
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
   */
  multiplyRight(other: Matrix3x3) {
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
   */
  multiplyLeft(other: Matrix3x3) {
    return Matrix3x3.multiply(other, this, this);
  }
  /**
   * Calculates a rotation around x axis inplace.
   * @param angle - The rotate angle in radians.
   * @returns self
   */
  rotationX(angle: number) {
    return Matrix3x3.rotationX(angle, this);
  }
  /**
   * Calculates a rotation around y axis inplace.
   * @param angle - The rotate angle in radians.
   * @returns self
   */
  rotationY(angle: number) {
    return Matrix3x3.rotationY(angle, this);
  }
  /**
   * Calculates a rotation around z axis inplace.
   * @param angle - The rotate angle in radians.
   * @returns self
   */
  rotationZ(angle: number) {
    return Matrix3x3.rotationZ(angle, this);
  }
  /**
   * Calculates a rotation around a given axis.
   * @param axis - The rotation axis.
   * @param angle - The rotate angle in radians.
   * @returns self
   */
  rotation(axis: Vector3, angle: number) {
    return Matrix3x3.rotation(axis, angle, this);
  }
  /**
   * Transform a vector by this matrix.
   * @param vec - The vector to be transformed.
   * @param result - The output vector (can be the same as vec), if not specified, a new vector will be created.
   * @returns The output vector
   */
  transform(vec: Vector3, result?: Vector3): Vector3 {
    result = result || new Vector3();
    return result.setXYZ(
      this[0] * vec[0] + this[3] * vec[1] + this[6] * vec[2],
      this[1] * vec[0] + this[4] * vec[1] + this[7] * vec[2],
      this[2] * vec[0] + this[5] * vec[1] + this[8] * vec[2]
    );
  }
  /**
   * {@inheritDoc Matrix3x3.transform}
   */
  transformPoint(vec: Vector3, result?: Vector3): Vector3 {
    return this.transform(vec, result);
  }
  /**
   * {@inheritDoc Matrix3x3.transform}
   */
  transformVector(vec: Vector3, result?: Vector3): Vector3 {
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
 */

export class Matrix4x4 extends VectorBase {
  /**
   * Creates a Matrix4x4 initialized with values.
   * @param m00 - element at row 0, column 0
   * @param m10 - element at row 0, column 1
   * @param m20 - element at row 0, column 2
   * @param m30 - element at row 0, column 3
   * @param m01 - element at row 1, column 0
   * @param m11 - element at row 1, column 1
   * @param m21 - element at row 1, column 2
   * @param m31 - element at row 1, column 3
   * @param m02 - element at row 2, column 0
   * @param m12 - element at row 2, column 1
   * @param m22 - element at row 2, column 2
   * @param m32 - element at row 2, column 3
   * @param m03 - element at row 3, column 0
   * @param m13 - element at row 3, column 1
   * @param m23 - element at row 3, column 2
   * @param m33 - element at row 3, column 3
   */
  constructor(
    m00: number, m10: number, m20: number, m30: number,
    m01: number, m11: number, m21: number, m31: number,
    m02: number, m12: number, m22: number, m32: number,
    m03: number, m13: number, m23: number, m33: number);
  /**
   * Creates a Matrix4x4 initialized with values in an array.
   * @param elements - Array that contains the values.
   */
  constructor(elements: number[]);
  /**
   * Cerates a Matrix4x4 initialized with values in a Float32Array.
   * @param array - Float32Array object that contains the values.
   */
  constructor(array: Float32Array);
  /**
   * Creates a new Matrix4x4 placed on a given ArrayBuffer object.
   * @param buffer - The array buffer object.
   * @param offset - The byte offset of the buffer where the matrix placed at.
   */
  constructor(buffer: ArrayBuffer, offset: number);
  /**
   * Creates a new identity Matrix4x4.
   */
  constructor();
  constructor(arg0?: number[]|number|Float32Array|ArrayBuffer, arg1?: number, arg2?: number, arg3?: number, arg4?: number, arg5?: number, arg6?: number, arg7?: number, arg8?: number, arg9?: number, arg10?: number, arg11?: number, arg12?: number, arg13?: number, arg14?: number, arg15?: number) {
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
   */
  clone(): Matrix4x4 {
    return new Matrix4x4(this);
  }
  /** Get the element at row 0, column 0 */
  get m00() {
    return this[0];
  }
  set m00(v: number) {
    this[0] = v;
  }
  /** Get the element at row 0, column 1 */
  get m10() {
    return this[1];
  }
  set m10(v: number) {
    this[1] = v;
  }
  /** Get the element at row 0, column 2 */
  get m20() {
    return this[2];
  }
  set m20(v: number) {
    this[2] = v;
  }
  /** Get the element at row 0, column 3 */
  get m30() {
    return this[3];
  }
  set m30(v: number) {
    this[3] = v;
  }
  /** Get the element at row 1, column 0 */
  get m01() {
    return this[4];
  }
  set m01(v: number) {
    this[4] = v;
  }
  /** Get the element at row 1, column 1 */
  get m11() {
    return this[5];
  }
  set m11(v: number) {
    this[5] = v;
  }
  /** Get the element at row 1, column 2 */
  get m21() {
    return this[6];
  }
  set m21(v: number) {
    this[6] = v;
  }
  /** Get the element at row 1, column 3 */
  get m31() {
    return this[7];
  }
  set m31(v: number) {
    this[7] = v;
  }
  /** Get the element at row 2, column 0 */
  get m02() {
    return this[8];
  }
  set m02(v: number) {
    this[8] = v;
  }
  /** Get the element at row 2, column 1 */
  get m12() {
    return this[9];
  }
  set m12(v: number) {
    this[9] = v;
  }
  /** Get the element at row 2, column 2 */
  get m22() {
    return this[10];
  }
  set m22(v: number) {
    this[10] = v;
  }
  /** Get the element at row 2, column 3 */
  get m32() {
    return this[11];
  }
  set m32(v: number) {
    this[11] = v;
  }
  /** Get the element at row 3, column 0 */
  get m03() {
    return this[12];
  }
  set m03(v: number) {
    this[12] = v;
  }
  /** Get the element at row 3, column 1 */
  get m13() {
    return this[13];
  }
  set m13(v: number) {
    this[13] = v;
  }
  /** Get the element at row 3, column 2 */
  get m23() {
    return this[14];
  }
  set m23(v: number) {
    this[14] = v;
  }
  /** Get the element at row 3, column 3 */
  get m33() {
    return this[15];
  }
  set m33(v: number) {
    this[15] = v;
  }
  /**
   * Get the values in a row as a Vector4
   * @param row - The row index
   * @param result - The output vector, if not specified, a new vector will be created.
   * @returns The output vector
   */
  getRow(row: number, result?: Vector4): Vector4 {
    return (result || new Vector4()).setXYZW(
      this[row * 4],
      this[row * 4 + 1],
      this[row * 4 + 2],
      this[row * 4 + 3]
    );
  }
  /**
   * Set values to a row in the matrix.
   * @param row - The row index
   * @param v - The values to be set
   * @returns - self
   */
  setRow(row: number, v: Vector4) {
    this[row * 4] = v.x;
    this[row * 4 + 1] = v.y;
    this[row * 4 + 2] = v.z;
    this[row * 4 + 3] = v.w;
    return this;
  }
  /**
   * Get the values in a column as a Vector4
   * @param col - The column index
   * @param result - The output vector, if not specified, a new vector will be created.
   * @returns The output vector
   */
  getCol(col: number, result?: Vector4): Vector4 {
    return (result || new Vector4()).setXYZW(this[col], this[4 + col], this[8 + col], this[12 + col]);
  }
  /**
   * Set values to a column in the matrix.
   * @param col - The column index.
   * @param v - The values to be set.
   * @returns self
   */
  setCol(col: number, v: Vector4) {
    this[col] = v.x;
    this[4 + col] = v.y;
    this[8 + col] = v.z;
    this[12 + col] = v.w;
    return this;
  }
  /**
   * Adds two Matrix4x4's component-wise.
   * @param a - The first operand.
   * @param b - The second operand.
   * @param result - The output matrix (can be the same as a or b), if not specified, a new matrix will be created.
   * @returns The output matrix
   */
  static add(a: Matrix4x4, b: Matrix4x4, result?: Matrix4x4) {
    result = result || new Matrix4x4();
    for (let i = 0; i < 16; i++) {
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
   */
  static sub(a: Matrix4x4, b: Matrix4x4, result?: Matrix4x4) {
    result = result || new Matrix4x4();
    for (let i = 0; i < 16; i++) {
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
   */
  static mul(a: Matrix4x4, b: Matrix4x4, result?: Matrix4x4) {
    result = result || new Matrix4x4();
    for (let i = 0; i < 16; i++) {
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
   */
  static div(a: Matrix4x4, b: Matrix4x4, result?: Matrix4x4) {
    result = result || new Matrix4x4();
    for (let i = 0; i < 16; i++) {
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
   */
  static scale(a: Matrix4x4, f: number, result?: Matrix4x4) {
    result = result || new Matrix4x4();
    for (let i = 0; i < 16; i++) {
      result[i] = a[i] * f;
    }
    return result;
  }
  /**
   * Creates an identity Matrix4x4.
   * @param result - The output matrix, if not specified, a new matrix will be created.
   * @returns The output matrix
   */
  static identity(result?: Matrix4x4): Matrix4x4 {
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
   */
  static ortho(
    left: number,
    right: number,
    bottom: number,
    top: number,
    near: number,
    far: number,
    result?: Matrix4x4
  ): Matrix4x4 {
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
   */
  static reflection(nx: number, ny: number, nz: number, d: number, result?: Matrix4x4): Matrix4x4 {
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
   */
  static perspective(
    fovY: number,
    aspect: number,
    znear: number,
    zfar: number,
    result?: Matrix4x4
  ): Matrix4x4 {
    const h = znear * Math.tan(fovY * 0.5);
    const w = h * aspect;
    return this.frustum(-w, w, -h, h, znear, zfar, result);
  }
  static obliqueProjection(projectionMatrix: Matrix4x4, clipPlane: Plane): Matrix4x4 {
    const result = new Matrix4x4(projectionMatrix);
    const q = Matrix4x4.invert(projectionMatrix).transform(new Vector4(clipPlane.a > 0 ? 1 : -1, clipPlane.b > 0 ? 1 : -1, 1, 1));
    const s = 2 / (q.x * clipPlane.a + q.y * clipPlane.b + q.z * clipPlane.c + q.w * clipPlane.d);
    result[2] = clipPlane.a * s - result[3];
    result[6] = clipPlane.b * s - result[7];
    result[10] = clipPlane.c * s - result[11];
    result[14] = clipPlane.d *s - result[15];
    return result;
  }
  static obliquePerspective(perspectiveMatrix: Matrix4x4, nearPlane: Vector4): Matrix4x4 {
    const result = new Matrix4x4(perspectiveMatrix);
    const q = new Vector4(
      ((nearPlane.x > 0 ? 1 : nearPlane.x < 0 ? -1 : 0) + perspectiveMatrix.m02) / perspectiveMatrix.m00,
      ((nearPlane.y > 0 ? 1 : nearPlane.y < 0 ? -1 : 0) + perspectiveMatrix.m12) / perspectiveMatrix.m11,
      -1,
      (1 + perspectiveMatrix.m22) / perspectiveMatrix.m23
    );
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
    */
  }
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
   */
  static frustum(
    left: number,
    right: number,
    bottom: number,
    top: number,
    znear: number,
    zfar: number,
    result?: Matrix4x4
  ): Matrix4x4 {
    result = result || new Matrix4x4();
    const dx = right - left;
    const dy = top - bottom;
    const dz = znear - zfar;
    result[0] = (2 * znear) / dx;
    result[1] = 0;
    result[2] = 0;
    result[3] = 0;
    result[4] = 0;
    result[5] = (2 * znear) / dy;
    result[6] = 0;
    result[7] = 0;
    result[8] = (left + right) / dx;
    result[9] = (top + bottom) / dy;
    result[10] = (znear + zfar) / dz;
    result[11] = -1;
    result[12] = 0;
    result[13] = 0;
    result[14] = (2 * znear * zfar) / dz;
    result[15] = 0;

    return result;
  }
  /**
   * Transpose a Matrix4x4.
   * @param matrix - The matrix to be transposed.
   * @param result - The output matrix (can be the same as matrix), if not specified, a new matrix will be created.
   * @returns The output matrix
   */
  static transpose(matrix: Matrix4x4, result?: Matrix4x4): Matrix4x4 {
    result = result || new Matrix4x4();
    if (matrix === result) {
      [result[1], result[4]] = [result[4], result[1]];
      [result[2], result[8]] = [result[8], result[2]];
      [result[3], result[12]] = [result[12], result[3]];
      [result[6], result[9]] = [result[9], result[6]];
      [result[7], result[13]] = [result[13], result[7]];
      [result[11], result[14]] = [result[14], result[11]];
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
   */
  static invert(matrix: Matrix4x4, result?: Matrix4x4): Matrix4x4 {
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
   */
  static invertAffine(matrix: Matrix4x4, result?: Matrix4x4): Matrix4x4 {
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
    result[12] =
      d *
      (m10 * m31 * m22 +
        m20 * m11 * m32 +
        m30 * m21 * m12 -
        (m10 * m21 * m32 + m20 * m31 * m12 + m30 * m11 * m22));
    result[13] =
      d *
      (m00 * m21 * m32 +
        m20 * m31 * m02 +
        m30 * m01 * m22 -
        (m00 * m31 * m22 + m20 * m01 * m32 + m30 * m21 * m02));
    result[14] =
      d *
      (m00 * m31 * m12 +
        m10 * m01 * m32 +
        m30 * m11 * m02 -
        (m00 * m11 * m32 + m10 * m31 * m02 + m30 * m01 * m12));
    result[15] = 1;

    return result;
  }
  /**
   * Creates a Matrix4x4 which presents a translation.
   * @param t - The translate vector.
   * @param result - The output matrix. if not specified, a new matrix will be created.
   * @returns The output matrix
   */
  static translation(t: Vector3, result?: Matrix4x4): Matrix4x4 {
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
   */
  static scaling(s: Vector3, result?: Matrix4x4): Matrix4x4 {
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
   */
  static rotationX(angle: number, result?: Matrix4x4): Matrix4x4 {
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
   */
  static rotationY(angle: number, result?: Matrix4x4): Matrix4x4 {
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
   */
  static rotationZ(angle: number, result?: Matrix4x4): Matrix4x4 {
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
   */
  static rotation(axis: Vector3, angle: number, result?: Matrix4x4): Matrix4x4 {
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
   */
  static lookAt(eye: Vector3, target: Vector3, up: Vector3, result?: Matrix4x4): Matrix4x4 {
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
   */
  static lookAtCubeFace(face: CubeFace, pos: Vector3, result?: Matrix4x4): Matrix4x4 {
    switch (face) {
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
   */
  static multiply(m1: Matrix4x4, m2: Matrix4x4, result?: Matrix4x4): Matrix4x4 {
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
   */
  static multiplyAffine(m1: Matrix4x4, m2: Matrix4x4, result?: Matrix4x4): Matrix4x4 {
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
   */
  static translateRight(m: Matrix4x4, t: Vector3, result?: Matrix4x4): Matrix4x4 {
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
   */
  static translateLeft(m: Matrix4x4, t: Vector3, result?: Matrix4x4): Matrix4x4 {
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
   */
  static scaleRight(m: Matrix4x4, s: Vector3, result?: Matrix4x4): Matrix4x4 {
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
   */
  static scaleLeft(m: Matrix4x4, s: Vector3, result?: Matrix4x4): Matrix4x4 {
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
   */
   static rotateRight(m: Matrix4x4, r: Matrix3x3 | Matrix4x4 | Quaternion, result?: Matrix4x4): Matrix4x4 {
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
   */
  static rotateLeft(m: Matrix4x4, r: Matrix3x3 | Matrix4x4 | Quaternion, result?: Matrix4x4): Matrix4x4 {
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
   */
  subBy(other: Matrix4x4) {
    return Matrix4x4.sub(this, other, this);
  }
  /**
   * Add a matrix to this matrix component-wise.
   * @param other - The matrix that will be added.
   * @returns self
   */
  addBy(other: Matrix4x4) {
    return Matrix4x4.add(this, other, this);
  }
  /**
   * Multiplies this matrix by a matrix component-wise.
   * @param other - The matrix that will be multiplied by.
   * @returns self
   */
  mulBy(other: Matrix4x4) {
    return Matrix4x4.mul(this, other, this);
  }
  /**
   * Divide this matrix by a matrix component-wise.
   * @param other - The matrix that will be divide by.
   * @returns self
   */
  divBy(other: Matrix4x4) {
    return Matrix4x4.div(this, other, this);
  }
  /**
   * Scale this matrix by a scalar number component-wise.
   * @param f - amount to scale this matrix by.
   * @returns self
   */
  scaleBy(f: number) {
    return Matrix4x4.scale(this, f, this);
  }
  /**
   * Make this matrix identity.
   * @returns self
   */
  identity() {
    return Matrix4x4.identity(this);
  }
  /**
   * Calculates a right-handed perspective projection matrix inplace.
   * @param fovY - The vertical field of view in radians.
   * @param aspect - The aspect ratio.
   * @param znear - The near clip plane.
   * @param zfar - The far clip plane.
   * @returns self
   */
  perspective(fovY: number, aspect: number, znear: number, zfar: number) {
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
   */
  frustum(left: number, right: number, bottom: number, top: number, znear: number, zfar: number) {
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
   */
  ortho(left: number, right: number, bottom: number, top: number, near: number, far: number) {
    return Matrix4x4.ortho(left, right, bottom, top, near, far, this);
  }
  /**
   * Check if this matrix is orthogonal projection matrix.
   *
   * @remarks
   * This method assumes that this is an affine transform matrix or a projection matrix (perspective or orthogonal).
   *
   * @returns true if this is an orthogonal projection matrix, otherwise false
   */
  isOrtho(): boolean {
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
   */
  isPerspective(): boolean {
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
   */
  getNearPlaneWidth(): number {
    if (this.isPerspective()) {
      return (2 * this.getNearPlane()) / this[0];
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
   */
  getNearPlaneHeight(): number {
    if (this.isPerspective()) {
      return (2 * this.getNearPlane()) / this[5];
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
   */
  getNearPlane(): number {
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
   */
  getFarPlaneWidth(): number {
    if (this.isPerspective()) {
      return (this.getNearPlaneWidth() * this.getFarPlane()) / this.getNearPlane();
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
   */
  getFarPlaneHeight(): number {
    if (this.isPerspective()) {
      return (this.getNearPlaneHeight() * this.getFarPlane()) / this.getNearPlane();
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
   */
  getFarPlane(): number {
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
   */
  getFov(): number {
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
   */
  getTanHalfFov(): number {
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
   */
  getAspect(): number {
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
   */
  getLeftPlane(): number {
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
   */
  getRightPlane(): number {
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
   */
  getTopPlane(): number {
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
   */
  getBottomPlane(): number {
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
   */
  setNearFar(znear: number, zfar: number): this {
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
   */
  translation(t: Vector3) {
    return Matrix4x4.translation(t, this);
  }
  /**
   * Calculates a scale matrix inplace.
   * @param s - The scale vector.
   * @returns self
   */
  scaling(s: Vector3) {
    return Matrix4x4.scaling(s, this);
  }
  /**
   * Invert this matrix inplace.
   * @returns self
   */
  inplaceInvert() {
    return Matrix4x4.invert(this, this);
  }
  /**
   * Invert this matrix inplace, assuming this matrix presents an affine transformation.
   * @returns self
   */
  inplaceInvertAffine() {
    return Matrix4x4.invertAffine(this, this);
  }
  /**
   * Calculates the transpose of this matrix inplace.
   * @returns self
   */
  transpose() {
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
   */
  multiplyRight(other: Matrix4x4) {
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
   */
  multiplyRightAffine(other: Matrix4x4) {
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
   */
  multiplyLeft(other: Matrix4x4) {
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
   */
  multiplyLeftAffine(other: Matrix4x4) {
    return Matrix4x4.multiplyAffine(other, this, this);
  }
  /**
   * Calculates a rotation around x axis inplace.
   * @param angle - The rotate angle in radians.
   * @returns self
   */
  rotationX(angle: number) {
    return Matrix4x4.rotationX(angle, this);
  }
  /**
   * Calculates a rotation around y axis inplace.
   * @param angle - The rotate angle in radians.
   * @returns self
   */
  rotationY(angle: number) {
    return Matrix4x4.rotationY(angle, this);
  }
  /**
   * Calculates a rotation around z axis inplace.
   * @param angle - The rotate angle in radians.
   * @returns self
   */
  rotationZ(angle: number) {
    return Matrix4x4.rotationZ(angle, this);
  }
  /**
   * Calculates a rotation around a given axis inplace.
   * @param axis - The rotation axis.
   * @param angle - The rotate angle in radians.
   * @returns self
   */
  rotation(axis: Vector3, angle: number) {
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
   */
  translateRight(t: Vector3) {
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
   */
  translateLeft(t: Vector3) {
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
   */
  scaleRight(s: Vector3) {
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
   */
  scaleLeft(s: Vector3) {
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
   */
  rotateRight(r: Matrix3x3 | Matrix4x4 | Quaternion) {
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
   */
  rotateLeft(r: Matrix3x3 | Matrix4x4 | Quaternion) {
    return Matrix4x4.rotateLeft(this, r, this);
  }
  /**
   * Calculates a look-at matrix inplace.
   * @param eye - Position of the eye.
   * @param target - The point that the eye is looking at.
   * @param up - The up vector.
   * @returns self
   */
  lookAt(eye: Vector3, target: Vector3, up: Vector3) {
    return Matrix4x4.lookAt(eye, target, up, this);
  }
  /**
   * Transform a point by this matrix.
   * @param point - The point to be transformed.
   * @param result - The output vector, if not specified, a new vector will be created.
   * @returns The output vector
   */
  transformPoint(point: Vector3, result?: Vector4): Vector4 {
    result = result || new Vector4();
    return result.setXYZW(
      this[0] * point[0] + this[4] * point[1] + this[8] * point[2] + this[12],
      this[1] * point[0] + this[5] * point[1] + this[9] * point[2] + this[13],
      this[2] * point[0] + this[6] * point[1] + this[10] * point[2] + this[14],
      this[3] * point[0] + this[7] * point[1] + this[11] * point[2] + this[15]
    );
  }
  /**
   * Transform a point by this matrix and then do a perspective divide.
   * @param point - The point to be transformed.
   * @param result - The output vector, if not specified, a new vector will be created.
   * @returns The output vector
   */
  transformPointP(point: Vector3, result?: Vector3): Vector3 {
    result = result || new Vector3();
    const x = this[0] * point[0] + this[4] * point[1] + this[8] * point[2] + this[12];
    const y = this[1] * point[0] + this[5] * point[1] + this[9] * point[2] + this[13];
    const z = this[2] * point[0] + this[6] * point[1] + this[10] * point[2] + this[14];
    const w = this[3] * point[0] + this[7] * point[1] + this[11] * point[2] + this[15];
    return result.setXYZ(x/w, y/w, z/w);
  }
  /**
   * Transform a point by this matrix, assuming this matrix presents an affine transformation.
   * @param point - The point to be transformed.
   * @param result - The output vector (can be the same as point), if not specified, a new vector will be created.
   * @returns The output vector
   */
  transformPointAffine(point: Vector3, result?: Vector3): Vector3 {
    result = result || new Vector3();
    return result.setXYZ(
      this[0] * point[0] + this[4] * point[1] + this[8] * point[2] + this[12],
      this[1] * point[0] + this[5] * point[1] + this[9] * point[2] + this[13],
      this[2] * point[0] + this[6] * point[1] + this[10] * point[2] + this[14]
    );
  }
  /**
   * Transform a vector by this matrix.
   * @param vec - The vector to be transformed.
   * @param result - The output vector, if not specified, a new vector will be created.
   * @returns The output vector
   */
  transformVector(vec: Vector3, result?: Vector4): Vector4 {
    result = result || new Vector4();
    return result.setXYZW(
      this[0] * vec[0] + this[4] * vec[1] + this[8] * vec[2],
      this[1] * vec[0] + this[5] * vec[1] + this[9] * vec[2],
      this[2] * vec[0] + this[6] * vec[1] + this[10] * vec[2],
      this[3] * vec[0] + this[7] * vec[1] + this[11] * vec[2]
    );
  }
  /**
   * Transform a vector by this matrix assuming this matrix presents an affine transformation.
   * @param vec - The vector to be transformed.
   * @param result - The output vector (can be the same as vec), if not specified, a new vector will be created.
   * @returns The output vector
   */
  transformVectorAffine(vec: Vector3, result?: Vector3): Vector3 {
    result = result || new Vector3();
    return result.setXYZ(
      this[0] * vec[0] + this[4] * vec[1] + this[8] * vec[2],
      this[1] * vec[0] + this[5] * vec[1] + this[9] * vec[2],
      this[2] * vec[0] + this[6] * vec[1] + this[10] * vec[2]
    );
  }
  /**
   * Transform a vector by this matrix.
   * @param vec - The vector to be transformed.
   * @param result - The output vector (can be the same as vec), if not specified, a new vector will be created.
   * @returns The output vector
   */
  transform(vec: Vector4, result?: Vector4): Vector4 {
    result = result || new Vector4();
    return result.setXYZW(
      this[0] * vec[0] + this[4] * vec[1] + this[8] * vec[2] + this[12] * vec[3],
      this[1] * vec[0] + this[5] * vec[1] + this[9] * vec[2] + this[13] * vec[3],
      this[2] * vec[0] + this[6] * vec[1] + this[10] * vec[2] + this[14] * vec[3],
      this[3] * vec[0] + this[7] * vec[1] + this[11] * vec[2] + this[15] * vec[3]
    );
  }
  /**
   * Transform a vector by this matrix, assuming this matrix presents an affine transformation.
   * @param vec - The vector to be transformed.
   * @param result - The output vector (can be the same as vec), if not specified, a new vector will be created.
   * @returns The output vector
   */
  transformAffine(vec: Vector4, result?: Vector4): Vector4 {
    result = result || new Vector4();
    return result.setXYZW(
      this[0] * vec[0] + this[4] * vec[1] + this[8] * vec[2] + this[12] * vec[3],
      this[1] * vec[0] + this[5] * vec[1] + this[9] * vec[2] + this[13] * vec[3],
      this[2] * vec[0] + this[6] * vec[1] + this[10] * vec[2] + this[14] * vec[3],
      vec.w
    );
  }
  /**
   * Calculates the determinant of this matrix.
   * @returns The determinant
   */
  det() {
    const m00 = this[0],
      m01 = this[1],
      m02 = this[2],
      m03 = this[3];
    const m10 = this[4],
      m11 = this[5],
      m12 = this[6],
      m13 = this[7];
    const m20 = this[8],
      m21 = this[9],
      m22 = this[10],
      m23 = this[11];
    const m30 = this[12],
      m31 = this[13],
      m32 = this[14],
      m33 = this[15];
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
   */
  decompose(scale?: Vector3, rotation?: Quaternion | Matrix3x3 | Matrix4x4, translation?: Vector3) {
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
   */
  decomposeLookAt(eye?: Vector3, target?: Vector3, up?: Vector3) {
    eye && eye.setXYZ(this[12], this[13], this[14]);
    up && up.setXYZ(this[4], this[5], this[6]);
    target && target.setXYZ(this[12] - this[8], this[13] - this[9], this[14] - this[10]);
    return this;
  }
  /** @internal */
  toDualQuaternion(): { real: Quaternion; dual: Quaternion; scale: Vector3 } {
    const t = new Vector3();
    const r = new Quaternion();
    const s = new Vector3();
    this.decompose(s, r, t);
    const translation = new Quaternion(this.m03 * 0.5, this.m13 * 0.5, this.m23 * 0.5, 0);
    const dual = Quaternion.multiply(translation, r);
    return { real: r, dual: dual, scale: s };
  }
}
