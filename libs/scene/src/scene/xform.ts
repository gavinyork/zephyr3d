import type { Quaternion } from '@zephyr3d/base';
import { Vector3, Matrix4x4, ObservableVector3, ObservableQuaternion, Vector4, makeEventTarget } from '@zephyr3d/base';
import type { SceneNode } from './scene_node';

/**
 * Presents a transformation from one space to another
 * @public
 */
export class XForm<T extends XForm<T> = XForm<any>> extends makeEventTarget(Object)<{ 
  nodeattached: SceneNode,
  noderemoved: SceneNode,
  transformchanged: SceneNode
}>() {
  /** @internal */
  protected _parent: T;
  /** @internal */
  protected _children: T[];
  /** @internal */
  protected _position: ObservableVector3;
  /** @internal */
  protected _scaling: ObservableVector3;
  /** @internal */
  protected _rotation: ObservableQuaternion;
  /** @internal */
  protected _localMatrix: Matrix4x4;
  /** @internal */
  protected _worldMatrix: Matrix4x4;
  /** @internal */
  protected _worldMatrixDet: number;
  /** @internal */
  protected _invWorldMatrix: Matrix4x4;
  /** @internal */
  protected _tmpLocalMatrix: Matrix4x4;
  /** @internal */
  protected _tmpWorldMatrix: Matrix4x4;
  /** @internal */
  protected _transformTag: number;
  /** @internal */
  protected _transformChangeCallback: () => void;
  /**
   * Creates an instance of XForm
   */
  constructor() {
    super();
    this._parent = null;
    this._children = [];
    this._transformChangeCallback = () => this._onTransformChanged(true);
    this._position = new ObservableVector3(0, 0, 0);
    this._position.callback = this._transformChangeCallback;
    this._scaling = new ObservableVector3(1, 1, 1);
    this._scaling.callback = this._transformChangeCallback;
    this._rotation = new ObservableQuaternion();
    this._rotation.callback = this._transformChangeCallback;
    this._worldMatrix = null;
    this._worldMatrixDet = null;
    this._invWorldMatrix = null;
    this._localMatrix = null;
    this._transformTag = 0;
    this._tmpLocalMatrix = Matrix4x4.identity();
    this._tmpWorldMatrix = Matrix4x4.identity();
  }
  /** Parent of the xform */
  get parent() {
    return this._parent;
  }
  set parent(p: T) {
    p = p || null;
    if (p !== this._parent) {
      this._setParent(p);
    }
  }
  /** Children of this xform */
  get children(): T[] {
    return this._children;
  }
  /**
   * Position of the xform relative to it's parent
   */
  get position(): Vector3 {
    if (!this._position) {
      this.syncTRS();
    }
    return this._position;
  }
  set position(val: Vector3) {
    if (!this._position) {
      this.syncTRS();
    }
    this._position.setXYZ(val[0], val[1], val[2]);
  }
  /**
   * Scaling of the xform
   */
  get scale(): Vector3 {
    if (!this._scaling) {
      this.syncTRS();
    }
    return this._scaling;
  }
  set scale(val: Vector3) {
    if (!this._scaling) {
      this.syncTRS();
    }
    this._scaling.setXYZ(val[0], val[1], val[2]);
  }
  /**
   * Rotation of the xform
   */
  get rotation() {
    if (!this._rotation) {
      this.syncTRS();
    }
    return this._rotation;
  }
  set rotation(val: Quaternion) {
    if (!this._rotation) {
      this.syncTRS();
    }
    this._rotation.setXYZW(val[0], val[1], val[2], val[3]);
  }
  /**
   * Transform world coordinate to local space
   * @param v - point or vector in world space
   * @param result - The output result
   * @returns The transformed local space coordinate
   */
  worldToThis(v: Vector3, result?: Vector3): Vector3;
  worldToThis(v: Vector4, result?: Vector4): Vector4;
  worldToThis(v: Vector3 | Vector4, result?: Vector3 | Vector4): Vector3 | Vector4 {
    if (v instanceof Vector3) {
      result = result || new Vector3();
      this.invWorldMatrix.transformPointAffine(v, result as Vector3);
      return result;
    } else {
      result = result || new Vector4();
      this.invWorldMatrix.transformAffine(v, result as Vector4);
      return result;
    }
  }
  /**
   * Transform coordinate in other coordinate space to local space
   * @param other - The other coordinate space
   * @param v - point or vector in other coordinate space
   * @param result - The output result
   * @returns The transformed local space coordinate
   */
  otherToThis(other: XForm, v: Vector3, result?: Vector3): Vector3;
  otherToThis(other: XForm, v: Vector4, result?: Vector4): Vector4;
  otherToThis(other: XForm, v: Vector3 | Vector4, result?: Vector3 | Vector4): Vector3 | Vector4 {
    return this.worldToThis(other.thisToWorld(v as any, result as any), result as any);
  }
  /**
   * Transform local coordinate to world space
   * @param v - point or vector in local space
   * @param result - The output result
   * @returns The transformed world space coordinate
   */
  thisToWorld(v: Vector3, result?: Vector3): Vector3;
  thisToWorld(v: Vector4, result?: Vector4): Vector4;
  thisToWorld(v: Vector3 | Vector4, result?: Vector3 | Vector4): Vector3 | Vector4 {
    if (v instanceof Vector3) {
      result = result || new Vector3();
      this.worldMatrix.transformPointAffine(v, result as Vector3);
      return result;
    } else {
      result = result || new Vector4();
      this.worldMatrix.transformAffine(v, result as Vector4);
      return result;
    }
  }
  /**
   * Transform local space coordinate to other coordinate space
   * @param other - The other coordinate space
   * @param v - point or vector in localspace
   * @param result - The output result
   * @returns The transformed coordinate in other coordinate space
   */
  thisToOther(other: XForm, v: Vector3, result?: Vector3): Vector3;
  thisToOther(other: XForm, v: Vector4, result?: Vector4): Vector4;
  thisToOther(other: XForm, v: Vector3 | Vector4, result?: Vector3 | Vector4): Vector3 | Vector4 {
    return other.worldToThis(this.thisToWorld(v as any, result as any), result as any);
  }
  /**
   * Gets the position of the xform in world space
   * @returns position of the xform in world space
   */
  getWorldPosition(): Vector3 {
    return new Vector3(this.worldMatrix.m03, this.worldMatrix.m13, this.worldMatrix.m23);
  }
  /**
   * Moves the xform by an offset vector
   * @param delta - The offset vector
   * @returns self
   */
  moveBy(delta: Vector3): this {
    this._position.addBy(delta);
    return this;
  }
  /**
   * Scales the xform by a given scale factor
   * @param factor - The scale factor
   * @returns self
   */
  scaleBy(factor: Vector3): this {
    this._scaling.mulBy(factor);
    return this;
  }
  /**
   * Sets the local transform matrix of the xform
   * @param matrix - The transform matrix to set
   * @returns self
   */
  setLocalTransform(matrix: Matrix4x4): this {
    this._localMatrix = matrix;
    this._position = null;
    this._rotation = null;
    this._scaling = null;
    this._onTransformChanged(false);
    return this;
  }
  /** Local transformation matrix of the xform */
  get localMatrix() {
    if (!this._localMatrix) {
      this._localMatrix = this._tmpLocalMatrix;
      this._localMatrix
        .scaling(this._scaling)
        .rotateLeft(new Matrix4x4(this._rotation))
        .translateLeft(this._position);
    }
    return this._localMatrix;
  }
  set localMatrix(matrix: Matrix4x4) {
    this.setLocalTransform(matrix);
  }
  /** World transformation matrix of the xform */
  get worldMatrix() {
    if (!this._worldMatrix) {
      this._worldMatrix = this._tmpWorldMatrix;
      if (this._parent) {
        Matrix4x4.multiplyAffine(this._parent.worldMatrix, this.localMatrix, this._worldMatrix);
      } else {
        this._worldMatrix.set(this.localMatrix);
      }
    }
    return this._worldMatrix;
  }
  /** The determinant of world matrix */
  get worldMatrixDet() {
    if (this._worldMatrixDet === null) {
      this._worldMatrixDet = this.worldMatrix.det();
    }
    return this._worldMatrixDet;
  }
  /** Inverse of the world transformation matrix of the xform */
  get invWorldMatrix() {
    if (!this._invWorldMatrix) {
      this._invWorldMatrix = Matrix4x4.invertAffine(this.worldMatrix);
    }
    return this._invWorldMatrix;
  }
  /**
   * Sets the local tranformation matrix by a look-at matrix
   * @param eye - The eye position used to make the look-at matrix
   * @param target - The target position used to make the look-at matrix
   * @param up - The up vector used to make the look-at matrix
   * @returns self
   */
  lookAt(eye: Vector3, target: Vector3, up: Vector3) {
    Matrix4x4.lookAt(eye, target, up).decompose(this._scaling, this._rotation, this._position);
    return this;
  }
  /**
   * Removes this node from it's parent and add this node to another parent node if required
   * @param p - The new parent node that this node should be added to or null
   * @returns self
   */
  reparent(p?: T) {
    this.parent = p;
    return this;
  }
  /** @internal */
  getTag(): number {
    return this._transformTag;
  }
  /** @internal */
  private syncTRS(): void {
    this._position = new ObservableVector3();
    this._rotation = new ObservableQuaternion();
    this._scaling = new ObservableVector3();
    this._localMatrix.decompose(this._scaling, this._rotation, this._position);
    this._position.callback = this._transformChangeCallback;
    this._rotation.callback = this._transformChangeCallback;
    this._scaling.callback = this._transformChangeCallback;
  }
  /** @internal */
  protected _onTransformChanged(invalidateLocal: boolean) {
    if (invalidateLocal) {
      this._localMatrix = null;
    }
    if (this._worldMatrix) {
      this._worldMatrix = null;
      this._invWorldMatrix = null;
      this._transformTag++;
      for (const child of this._children) {
        child._onTransformChanged(false);
      }
    }
    this._worldMatrixDet = null;
  }
  /** @internal */
  protected _setParent(p: T) {
    if (this._parent !== p) {
      if (this._parent) {
        this._parent._children.splice(this._parent._children.indexOf(this as unknown as T), 1);
      }
      this._parent = p;
      if (this._parent) {
        this._parent._children.push(this as unknown as T);
      }
      this._onTransformChanged(false);
    }
  }
}
