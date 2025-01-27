import type { Scene } from './scene';
import type { GraphNode } from './graph_node';
import type { Mesh } from './mesh';
import type { Camera } from '../camera/camera';
import type { Terrain } from './terrain/terrain';
import type { PunctualLight, BaseLight } from './light';
import type { BoundingVolume } from '../utility/bounding_volume';
import type { BatchGroup } from './batchgroup';
import type { Visitor } from './visitor';
import type { Quaternion } from '@zephyr3d/base';
import {
  makeEventTarget,
  Matrix4x4,
  ObservableQuaternion,
  ObservableVector3,
  Vector3,
  Vector4
} from '@zephyr3d/base';
import type { ParticleSystem } from './particlesys';
import { Ref } from '../app/gc/ref';
import { AnimationSet } from '../animation';

/**
 * Node iterate function type
 * @public
 */
export type NodeIterateFunc = ((node: SceneNode) => boolean) | ((node: SceneNode) => void);

/**
 * Scene node visible state
 * @public
 */
export type SceneNodeVisible = 'visible' | 'inherit' | 'hidden';

/**
 * The base class for any kind of scene objects
 *
 * @remarks
 * We use a data structure called SceneGraph to store scenes,
 * which consists of a couple of scene objects forming a
 * hierarchical structure. This is the base class for any kind
 * of the scene object, which contains the basic properties such
 * as position, rotation, and scale of the object.
 *
 * @public
 */
export class SceneNode extends makeEventTarget(Object)<{
  nodeattached: [node: SceneNode];
  noderemoved: [node: SceneNode];
  visiblechanged: [node: SceneNode];
  transformchanged: [node: SceneNode];
  bvchanged: [node: SceneNode];
}>() {
  /*
  static readonly PICK_INHERITED = -1;
  static readonly PICK_DISABLED = 0;
  static readonly PICK_ENABLED = 1;
  */
  static readonly BBOXDRAW_INHERITED = -1;
  static readonly BBOXDRAW_DISABLED = 0;
  static readonly BBOXDRAW_LOCAL = 1;
  static readonly BBOXDRAW_WORLD = 2;
  /** @internal */
  protected _id: string;
  /** @internal */
  protected _animationSet: Ref<AnimationSet>;
  /** @internal */
  protected _clipMode: boolean;
  /** @internal */
  protected _boxDrawMode: number;
  /** @internal */
  protected _visible: SceneNodeVisible;
  /** @internal */
  protected _pickMode: boolean;
  /** @internal */
  protected _name: string;
  /** @internal */
  protected _scene: Scene;
  /** @internal */
  protected _bv: BoundingVolume;
  /** @internal */
  protected _bvDirty: boolean;
  /** @internal */
  protected _bvWorld: BoundingVolume;
  /** @internal */
  private _placeToOctree: boolean;
  /** @internal */
  private _sealed: boolean;
  /** @internal */
  private _assetUrl: string;
  /** @internal */
  protected _parent: SceneNode;
  /** @internal */
  protected _children: Ref<SceneNode>[];
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
  /** @internal */
  private _disableCallback: boolean;
  /**
   * Creates a new scene node
   * @param scene - Which scene the node belongs to
   */
  constructor(scene: Scene) {
    super();
    this._id = crypto.randomUUID();
    this._scene = scene;
    this._name = '';
    this._animationSet = new Ref();
    this._bv = null;
    this._bvWorld = null;
    this._bvDirty = true;
    this._clipMode = true;
    this._boxDrawMode = SceneNode.BBOXDRAW_DISABLED;
    this._visible = 'inherit';
    this._pickMode = false;
    this._placeToOctree = true;
    this._parent = null;
    this._sealed = false;
    this._assetUrl = '';
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
    this._disableCallback = false;
    this._tmpLocalMatrix = Matrix4x4.identity();
    this._tmpWorldMatrix = Matrix4x4.identity();
    if (scene && this !== scene.rootNode) {
      this.reparent(scene.rootNode);
    }
  }
  /** @internal */
  get placeToOctree(): boolean {
    return this._placeToOctree;
  }
  set placeToOctree(val: boolean) {
    if (!!val !== this._placeToOctree) {
      this._placeToOctree = !!val;
      if (this.isGraphNode()) {
        this.scene?.invalidateNodePlacement(this);
      }
    }
  }
  /**
   * Id of the node
   */
  get id() {
    return this._id;
  }
  set id(id: string) {
    this._id = id;
  }
  /**
   * Name of the node
   */
  get name() {
    return this._name;
  }
  set name(val: string) {
    this._name = val || '';
  }
  /** The scene to which the node belongs */
  get scene(): Scene {
    return this._scene;
  }
  /** true if the node is attached to a scene, false otherwise */
  get attached(): boolean {
    let node: SceneNode = this;
    while (node && node !== this._scene.rootNode) {
      node = node.parent;
    }
    return node === this._scene.rootNode;
  }
  /** true if the node is sealed */
  get sealed(): boolean {
    return this._sealed;
  }
  set sealed(val: boolean) {
    this._sealed = val;
  }
  get animationSet() {
    return this._animationSet.get();
  }
  set animationSet(animationSet: AnimationSet) {
    this._animationSet.set(animationSet);
  }
  /** Asset url */
  get assetUrl(): string {
    return this._assetUrl;
  }
  set assetUrl(val: string) {
    this._assetUrl = val;
  }
  /**
   * Check if given node is a direct child of the node
   * @param child - The node to be checked
   * @returns true if the given node is a direct child of this node, false otherwise
   */
  hasChild(child: SceneNode): boolean {
    return child && child.parent === this;
  }
  /**
   * Removes all children from this node
   */
  removeChildren() {
    while (this._children.length) {
      this._children[0].get().remove();
    }
  }
  /**
   * Checks if this node is the direct parent or indirect parent of a given node
   * @param child - The node to be checked
   * @returns true if this node is the direct parent or indirect parent of the given node, false otherwise
   */
  isParentOf(child: SceneNode): boolean {
    while (child && child !== this) {
      child = child.parent;
    }
    return child === this;
  }
  /**
   * Removes this node from it's parent
   * @returns self
   */
  remove() {
    this.parent = null;
    return this;
  }
  /**
   * Traverse the entire subtree of this node by a visitor
   * @param v - The visitor that will travel the subtree of this node
   * @param inverse - true if traversing from bottom to top, otherwise top to bottom
   */
  traverse(v: Visitor<SceneNode>, inverse?: boolean): void {
    if (inverse) {
      for (let i = this._children.length - 1; i >= 0; i--) {
        this._children[i].get().traverse(v, inverse);
      }
      v.visit(this);
    } else {
      v.visit(this);
      for (const child of this._children) {
        child.get().traverse(v);
      }
    }
  }
  /**
   * Iterate self and all of the children
   *
   * @remarks
   * DO NOT remove child duration iteration!
   *
   * @param callback - callback function that will be called on each node, if callback returns true, iteration will be stopped immediately
   */
  iterate(callback: NodeIterateFunc): boolean {
    if (!!callback(this)) {
      return true;
    }
    for (const child of this._children) {
      if (!!child.get().iterate(callback)) {
        return true;
      }
    }
    return false;
  }
  /**
   * Iterate self and all of the children from bottom to top in reversed order
   *
   * @remarks
   * Child can be removed duration iteration!
   *
   * @param callback - callback function that will be called on each node, if callback returns true, iteration will be stopped immediately
   */
  iterateBottomToTop(callback: NodeIterateFunc): boolean {
    for (let i = this._children.length - 1; i >= 0; i--) {
      const child = this._children[i];
      if (!!child.get().iterateBottomToTop(callback)) {
        return true;
      }
    }
    if (!!callback(this)) {
      return true;
    }
    return false;
  }
  /** true if this is a graph node, false otherwise */
  isGraphNode(): this is GraphNode {
    return false;
  }
  /** true if this is a light node, false otherwise */
  isLight(): this is BaseLight {
    return false;
  }
  /** true if this is a mesh node, false otherwise */
  isMesh(): this is Mesh {
    return false;
  }
  /** true if this is a particle system node, false otherwise */
  isParticleSystem(): this is ParticleSystem {
    return false;
  }
  /** true if this is a batch group, false otherwise */
  isBatchGroup(): this is BatchGroup {
    return false;
  }
  /** true if this is a terrain node, false otherwise */
  isTerrain(): this is Terrain {
    return false;
  }
  /** true if this is a camera node, false otherwise */
  isCamera(): this is Camera {
    return false;
  }
  /** true if this is a punctual light node, false otherwise */
  isPunctualLight(): this is PunctualLight {
    return false;
  }
  /** Disposes the node */
  dispose() {
    this.remove();
    this.removeChildren();
    this._animationSet.dispose();
  }
  /**
   * Computes the bounding volume of the node
   * @returns The output bounding volume
   */
  computeBoundingVolume(): BoundingVolume {
    return null;
  }
  /**
   * Gets the bounding volume of the node
   * @returns The bounding volume of the node
   */
  getBoundingVolume(): BoundingVolume {
    if (this._bvDirty) {
      this._bv = this.computeBoundingVolume();
      this._bvDirty = false;
    }
    return this._bv;
  }
  /**
   * Sets the bounding volume of the node
   * @param bv - The bounding volume to set
   */
  setBoundingVolume(bv: BoundingVolume) {
    if (bv !== this._bv) {
      this._bv = bv;
      this._bvDirty = !this._bv;
      this.invalidateWorldBoundingVolume(false);
    }
  }
  /**
   * Gets the world space bounding volume of the node
   * @returns The world space bounding volume of the node
   */
  getWorldBoundingVolume(): BoundingVolume {
    if (!this._bvWorld) {
      this._bvWorld = this.getBoundingVolume()?.transform(this.worldMatrix) ?? null;
    }
    return this._bvWorld;
  }
  /**
   * Force the bounding volume to be recalculated
   */
  invalidateBoundingVolume() {
    this._bvDirty = true;
    this.invalidateWorldBoundingVolume(false);
  }
  /** Force the world space bounding volume to be recalculated */
  invalidateWorldBoundingVolume(transformChanged: boolean) {
    this._bvWorld = null;
    if (this._scene) {
      if (transformChanged) {
        this.iterate((node) => {
          if (node.isGraphNode()) {
            this._scene.invalidateNodePlacement(node);
          }
        });
      } else if (this.isGraphNode()) {
        this._scene.invalidateNodePlacement(this);
      }
      this.dispatchEvent('bvchanged', this);
    }
  }
  /** Clip mode */
  get clipTestEnabled(): boolean {
    return this._clipMode;
  }
  set clipTestEnabled(val: boolean) {
    this._clipMode = val;
  }
  /** Computed value of show state */
  get hidden(): boolean {
    let node: SceneNode = this;
    while (node && node._visible === 'inherit') {
      node = node.parent;
    }
    return node ? node._visible === 'hidden' : false;
  }
  /** Show state */
  get showState(): SceneNodeVisible {
    return this._visible;
  }
  set showState(val: SceneNodeVisible) {
    if (val !== this._visible) {
      const prevHidden = this.hidden;
      this._visible = val;
      if (prevHidden !== this.hidden) {
        if (this.isGraphNode()) {
          this._scene?.invalidateNodePlacement(this);
        }
        let parent: SceneNode = this;
        while (parent) {
          parent.dispatchEvent('visiblechanged', this);
          parent = parent.parent;
        }
        this.notifyHiddenChanged();
      }
    }
  }
  /** Computed value of pick mode */
  get pickable(): boolean {
    return this._pickMode;
  }
  set pickable(val: boolean) {
    this._pickMode = !!val;
  }
  /** Computed value for bounding box draw mode */
  get computedBoundingBoxDrawMode(): number {
    if (this._boxDrawMode === SceneNode.BBOXDRAW_INHERITED) {
      let parent = this.parent;
      while (parent && !parent.isGraphNode()) {
        parent = parent.parent;
      }
      return parent?.computedBoundingBoxDrawMode ?? SceneNode.BBOXDRAW_DISABLED;
    }
    return this._boxDrawMode;
  }
  /** Bounding box draw mode */
  get boundingBoxDrawMode(): number {
    return this._boxDrawMode;
  }
  set boundingBoxDrawMode(mode: number) {
    this._boxDrawMode = mode;
  }
  /** @internal */
  protected _setParent(p: SceneNode): void {
    if (p && p._scene !== this._scene) {
      throw new Error('Parent node and child node must belongs to the same scene');
    }
    let lastParent = this._parent;
    let newParent = p;
    if (newParent !== lastParent) {
      const willDetach = (!p || !p.attached) && this.attached;
      const willAttach = !this.attached && p && p.attached;
      if (newParent) {
        newParent._children.push(new Ref<SceneNode>(this));
      }
      if (this._parent) {
        const index = this._parent._children.findIndex((val) => val.get() === this);
        this._parent.children[index].dispose();
        this._parent._children.splice(index, 1);
      }
      this._parent = p;
      this._onTransformChanged(false);
      if (willDetach) {
        this._detached();
      }
      if (willAttach) {
        this._attached();
      }
      while (lastParent) {
        lastParent.dispatchEvent('noderemoved', this);
        lastParent = lastParent.parent;
      }
      while (newParent) {
        newParent.dispatchEvent('nodeattached', this);
        newParent = newParent.parent;
      }
    }
  }
  /** @internal */
  protected _onTransformChanged(invalidateLocal: boolean): void {
    if (this._disableCallback) {
      return;
    }
    if (invalidateLocal) {
      this._localMatrix = null;
    }
    this._worldMatrix = null;
    this._invWorldMatrix = null;
    this._worldMatrixDet = null;
    this._transformTag++;
    for (const child of this._children) {
      child.get()._onTransformChanged(false);
    }
    this.invalidateWorldBoundingVolume(true);
    this.dispatchEvent('transformchanged', this);
  }
  /**
   * Get called when this node is attached to scene
   */
  protected _onAttached(): void {}
  /**
   * Get called when this node is detached from scene
   */
  protected _onDetached(): void {}
  /** @internal */
  protected _attached(): void {
    this.iterate((child) => {
      child._onAttached();
    });
  }
  /** @internal */
  protected _detached(): void {
    this.iterate((child) => {
      child._onDetached();
    });
  }
  /** @internal */
  notifyHiddenChanged() {
    this._visibleChanged();
    for (const child of this._children) {
      if (child.get().showState === 'inherit') {
        child.get().notifyHiddenChanged();
      }
    }
  }
  /** @internal */
  protected _visibleChanged(): void {}
  /** Parent of the xform */
  get parent() {
    return this._parent;
  }
  set parent(p: SceneNode) {
    p = p || null;
    if (p !== this._parent) {
      this._setParent(p);
    }
  }
  /** Children of this xform */
  get children(): Ref<SceneNode>[] {
    return this._children;
  }
  /**
   * Position of the xform relative to it's parent
   */
  get position(): Vector3 {
    return this._position;
  }
  set position(val: Vector3) {
    this._position.setXYZ(val[0], val[1], val[2]);
  }
  /**
   * Scaling of the xform
   */
  get scale(): Vector3 {
    return this._scaling;
  }
  set scale(val: Vector3) {
    this._scaling.setXYZ(val[0], val[1], val[2]);
  }
  /**
   * Rotation of the xform
   */
  get rotation() {
    return this._rotation;
  }
  set rotation(val: Quaternion) {
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
  otherToThis(other: SceneNode, v: Vector3, result?: Vector3): Vector3;
  otherToThis(other: SceneNode, v: Vector4, result?: Vector4): Vector4;
  otherToThis(other: SceneNode, v: Vector3 | Vector4, result?: Vector3 | Vector4): Vector3 | Vector4 {
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
  thisToOther(other: SceneNode, v: Vector3, result?: Vector3): Vector3;
  thisToOther(other: SceneNode, v: Vector4, result?: Vector4): Vector4;
  thisToOther(other: SceneNode, v: Vector3 | Vector4, result?: Vector3 | Vector4): Vector3 | Vector4 {
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
    this._disableCallback = true;
    this._localMatrix.decompose(this._scaling, this._rotation, this._position);
    this._disableCallback = false;
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
    this.setLocalTransform(Matrix4x4.lookAt(eye, target, up));
    return this;
  }
  /**
   * Removes this node from it's parent and add this node to another parent node if required
   * @param p - The new parent node that this node should be added to or null
   * @returns self
   */
  reparent(p?: SceneNode) {
    this.parent = p;
    return this;
  }
  /** @internal */
  get transformTag(): number {
    return this._transformTag;
  }
}
