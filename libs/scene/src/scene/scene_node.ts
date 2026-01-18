import type { Scene } from './scene';
import type { GraphNode } from './graph_node';
import type { Mesh } from './mesh';
import type { Camera } from '../camera/camera';
import type { PunctualLight, BaseLight } from './light';
import type { BoundingVolume } from '../utility/bounding_volume';
import type { BatchGroup } from './batchgroup';
import type { Visitor } from './visitor';
import type { IDisposable, Immutable, Nullable, Quaternion } from '@zephyr3d/base';
import { Disposable, DRef, makeObservable, randomUUID } from '@zephyr3d/base';
import { Matrix4x4, ObservableQuaternion, ObservableVector3, Vector3, Vector4 } from '@zephyr3d/base';
import type { ParticleSystem } from './particlesys';
import type { Skeleton } from '../animation';
import { AnimationSet } from '../animation';
import type { SharedModel } from '../asset';
import type { Water } from './water';
import type { ClipmapTerrain } from './terrain-cm/terrain-cm';
import type { Metadata } from 'draco3d';
import { getEngine } from '../app/api';
import type { Sprite } from './sprite';

/**
 * Iteration callback used by traversal helpers.
 *
 * Return true to stop traversal early.
 *
 * @public
 */
export type NodeIterateFunc = ((node: SceneNode) => boolean) | ((node: SceneNode) => void);

/**
 * Visibility state of a node.
 *
 * - 'visible': force visible
 * - 'hidden': force hidden
 * - 'inherit': inherits from the closest ancestor that is not 'inherit'
 *
 * @public
 */
export type SceneNodeVisible = 'visible' | 'inherit' | 'hidden';

/**
 * The base class of all scene graph objects.
 *
 * @remarks
 * Responsibilities:
 * - Defines hierarchical transform (position, rotation, scale) with lazily computed matrices.
 * - Integrates with the scene graph (parent/children, attachment notifications).
 * - Provides traversal utilities (`iterate`, `iterateBottomToTop`, `traverse`).
 * - Manages visibility state and CPU/GPU picking flags.
 * - Computes and caches local/world bounding volumes, notifies scene for spatial updates.
 * - Supports cloning and shared model instancing.
 * - Emits events on visibility, transform, bounding volume, attachment, and disposal.
 *
 * Performance:
 * - `localMatrix`, `worldMatrix`, and `invWorldMatrix` are cached until invalidated.
 * - Transform mutations and `invalidateBoundingVolume` update caches and spatial structures.
 *
 * Events:
 * - `nodeattached`, `noderemoved`, `visiblechanged`, `transformchanged`, `bvchanged`, `dispose`.
 *
 * @public
 */
export class SceneNode
  extends makeObservable(Disposable)<{
    /** Emitted on all ancestors when a node is attached under them. */
    nodeattached: [node: SceneNode];
    /** Emitted on all ancestors when a node is removed from under them. */
    noderemoved: [node: SceneNode];
    /** Emitted when effective visibility changes (considering inheritance). */
    visiblechanged: [node: SceneNode];
    /** Emitted when local/world transform changes. */
    transformchanged: [node: SceneNode];
    /** Emitted when local/world bounding volume changes. */
    bvchanged: [node: SceneNode];
    /** Emitted when the node is disposed. */
    dispose: [];
  }>()
  implements IDisposable
{
  private static _runTimeId = 1;
  /*
  static readonly PICK_INHERITED = -1;
  static readonly PICK_DISABLED = 0;
  static readonly PICK_ENABLED = 1;
  */
  /** Bounding-box draw mode inherited from nearest graph ancestor. */
  static readonly BBOXDRAW_INHERITED = -1;
  /** Disable bounding-box visualization. */
  static readonly BBOXDRAW_DISABLED = 0;
  /** Draw local-space bounding box. */
  static readonly BBOXDRAW_LOCAL = 1;
  /** Draw world-space bounding box. */
  static readonly BBOXDRAW_WORLD = 2;

  /** @internal Runtime unique id. */
  protected readonly _runtimeId: number;
  /** @internal Unique persistent id. */
  protected _id: string;
  /** @internal Prefab id */
  protected _prefabId: string;
  /** @internal Animation set reference. */
  protected _animationSet: DRef<AnimationSet>;
  /** @internal Optional shared model reference for instancing. */
  protected _sharedModel: DRef<SharedModel>;
  /** @internal */
  protected _jointTypeT: 'none' | 'animated' | 'static';
  /** @internal */
  protected _jointTypeS: 'none' | 'animated' | 'static';
  /** @internal */
  protected _jointTypeR: 'none' | 'animated' | 'static';
  /** @internal Clip test flag used by renderer. */
  protected _clipMode: boolean;
  /** @internal Bounding-box visualization mode. */
  protected _boxDrawMode: number;
  /** @internal Visibility state ('visible'|'hidden'|'inherit'). */
  protected _visible: SceneNodeVisible;
  /** @internal CPU picking flag. */
  protected _pickable: boolean;
  /** @internal GPU picking flag. */
  protected _gpuPickable: boolean;
  /** @internal Friendly name for debugging/UI. */
  protected _name: string;
  /** @internal Owning scene. */
  protected _scene: Nullable<Scene>;

  /** @internal Local-space bounding volume cache. */
  protected _bv: Nullable<BoundingVolume>;
  /** @internal True if local BV needs recomputing. */
  protected _bvDirty: boolean;
  /** @internal World-space bounding volume cache. */
  protected _bvWorld: Nullable<BoundingVolume>;

  /** @internal Whether this node participates in scene spatial structures (octree). */
  private _placeToOctree: boolean;
  /** @internal If true, this node cannot be cloned/attached as a child (engine policy). */
  private _sealed: boolean;

  /** @internal Parent node. */
  protected _parent: Nullable<SceneNode>;
  /** @internal Children list (DRef for memory/resource mgmt). */
  protected _children: DRef<SceneNode>[];

  /** @internal Local position (observable). */
  protected _position: ObservableVector3;
  /** @internal Local scale (observable). */
  protected _scaling: ObservableVector3;
  /** @internal Local rotation (observable quaternion). */
  protected _rotation: ObservableQuaternion;

  /** @internal Local transform matrix cache. */
  protected _localMatrix: Nullable<Matrix4x4>;
  /** @internal World transform matrix cache. */
  protected _worldMatrix: Nullable<Matrix4x4>;
  /** @internal Determinant of world transform (cached). */
  protected _worldMatrixDet: Nullable<number>;
  /** @internal Inverse world transform matrix cache. */
  protected _invWorldMatrix: Nullable<Matrix4x4>;

  /** @internal Scratch local matrix to avoid allocations. */
  protected _tmpLocalMatrix: Matrix4x4;
  /** @internal Scratch world matrix to avoid allocations. */
  protected _tmpWorldMatrix: Matrix4x4;

  /** @internal Monotonically increasing tag for transform changes. */
  protected _transformTag: number;
  /** @internal Shared callback used by observables on transform mutation. */
  protected _transformChangeCallback: () => void;

  /** @internal Arbitrary metadata payload for this node. */
  protected _metaData: Nullable<Metadata>;
  /** @internal If true, suppress transform-change callbacks (during bulk updates). */
  private _disableCallback: boolean;
  /** @internal User-attached script entry (engine-defined). */
  private _script: string;
  /**
   * Construct a scene node.
   *
   * @remarks
   * If a `scene` is provided and this is not the root node, the node is reparented
   * under the scene's root immediately.
   *
   * @param scene - Scene that will own this node.
   */
  constructor(scene: Nullable<Scene>) {
    super();
    this._runtimeId = SceneNode._runTimeId++;
    this._id = randomUUID();
    this._prefabId = '';
    this._scene = scene;
    this._name = '';
    this._animationSet = new DRef();
    this._sharedModel = new DRef();
    this._jointTypeT = 'none';
    this._jointTypeS = 'none';
    this._jointTypeR = 'none';
    this._bv = null;
    this._bvWorld = null;
    this._bvDirty = true;
    this._clipMode = true;
    this._boxDrawMode = SceneNode.BBOXDRAW_DISABLED;
    this._visible = 'inherit';
    this._pickable = false;
    this._gpuPickable = true;
    this._placeToOctree = true;
    this._sealed = false;
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
    this._script = '';
    this._metaData = null;
    this._parent = null;
    this.reparent(scene?.rootNode ?? null);
  }
  /**
   * Whether the node should be inserted into the scene's spatial structure.
   *
   * @remarks
   * Toggling this hints the scene to (re)place the node in octree/acceleration structures.
   */
  get placeToOctree() {
    return this._placeToOctree;
  }
  set placeToOctree(val) {
    if (!!val !== this._placeToOctree) {
      this._placeToOctree = !!val;
      if (this.isGraphNode()) {
        this.scene?.invalidateNodePlacement(this);
      }
    }
  }
  /**
   * Node's runtime unique identifier
   */
  get runtimeId() {
    return this._runtimeId;
  }
  /**
   * Node's persistent identifier.
   *
   * @remarks
   * Changing this affects serialization and registry lookup; ensure uniqueness.
   */
  get persistentId() {
    return this._id;
  }
  set persistentId(id: string) {
    this._id = id;
  }
  /**
   * If not empty, this node was loaded from a prefab
   *
   * @remarks
   * Internal used for serialization
   */
  get prefabId() {
    return this._prefabId;
  }
  set prefabId(id: string) {
    this._prefabId = id;
  }
  /**
   * Get prefab node this node belongs to, or null if this node does not belongs to any prefab
   * @returns prefab node this node belongs to
   */
  getPrefabNode(): Nullable<SceneNode> {
    return this._prefabId ? this : (this.parent?.getPrefabNode() ?? null);
  }
  /**
   * Translation type if this is a joint node of any skeleton
   *
   * @remarks
   * Internal used for serialization
   */
  get jointTypeT() {
    return this._jointTypeT;
  }
  set jointTypeT(val: 'none' | 'animated' | 'static') {
    this._jointTypeT = val;
  }
  /**
   * Scale type if this is a joint node of any skeleton
   *
   * @remarks
   * Internal used for serialization
   */
  get jointTypeS() {
    return this._jointTypeS;
  }
  set jointTypeS(val: 'none' | 'animated' | 'static') {
    this._jointTypeS = val;
  }
  /**
   * Rotation type if this is a joint node of any skeleton
   *
   * @remarks
   * Internal used for serialization
   */
  get jointTypeR() {
    return this._jointTypeR;
  }
  set jointTypeR(val: 'none' | 'animated' | 'static') {
    this._jointTypeR = val;
  }
  /**
   * Arbitrary metadata associated with this node.
   *
   * @remarks
   * Stored and transported with the node; format is application-defined.
   */
  get metaData() {
    return this._metaData;
  }
  set metaData(val: Nullable<Metadata>) {
    this._metaData = val;
  }
  /**
   * Attached script filename or identifier (engine-specific).
   *
   * @remarks
   * Integrates with the engine’s scripting system if available.
   */
  get script() {
    return this._script;
  }
  set script(fileName: string) {
    this._script = fileName ?? '';
  }
  /**
   * Display name of the node (for UI/debugging).
   */
  get name() {
    return this._name;
  }
  set name(val: string) {
    this._name = val || '';
  }
  /** The owning scene. */
  get scene() {
    return this._scene;
  }
  /**
   * Whether this node is currently attached under the scene's root.
   */
  get attached() {
    if (!this._scene) {
      return false;
    }
    let node: Nullable<SceneNode> = this;
    while (node && node !== this._scene.rootNode) {
      node = node.parent;
    }
    return node === this._scene.rootNode;
  }
  /**
   * If true, the node is logically sealed; some operations (like cloning as child)
   * may be restricted by engine policies.
   */
  get sealed() {
    return this._sealed;
  }
  set sealed(val) {
    this._sealed = val;
  }
  /**
   * Lazily created animation set for this node.
   *
   * @remarks
   * Accessing this schedules the node for update in the scene.
   */
  get animationSet() {
    if (!this._animationSet.get()) {
      this._animationSet.set(new AnimationSet(this));
      this.scene?.queueUpdateNode(this);
    }
    return this._animationSet.get()!;
  }
  /**
   * Shared model reference for instancing/streaming systems.
   */
  get sharedModel() {
    return this._sharedModel.get();
  }
  set sharedModel(model: Nullable<SharedModel>) {
    this._sharedModel.set(model);
  }
  /**
   * Clone this node.
   *
   * @remarks
   * If a shared model exists, it may create an instanced node. The clone is
   * attached under the same parent; children are cloned based on `method` and `recursive`.
   *
   * @param method - Clone method ('deep' or 'instance').
   * @param recursive - Whether children are cloned recursively.
   * @returns New node instance
   */
  async clone(): Promise<this> {
    this.iterate((node) => {
      if (node.isClipmapTerrain()) {
        throw new Error('Cloning terrain node is not allowed');
      }
    });
    const parent = this.parent;
    const tmpParent = new SceneNode(this.scene);
    const data = await getEngine().resourceManager.serializeObject(this);
    const other = (await getEngine().resourceManager.deserializeObject<this>(tmpParent, data))!;
    other.persistentId = randomUUID();
    other.parent = parent;
    tmpParent.dispose();
    const postClonePromises: Promise<void>[] = [];
    other.iterate((node) => {
      const P = node.onPostClone();
      if (P instanceof Promise) {
        postClonePromises.push(P);
      }
    });
    if (postClonePromises.length > 0) {
      await Promise.all(postClonePromises);
    }
    return other;
  }
  /**
   * Whether the given node is a direct child of this node.
   * @param child - The node to be checked
   * @returns true if the given node is a direct child of this node, false otherwise
   */
  hasChild(child: SceneNode) {
    return child && child.parent === this;
  }
  /**
   * Remove all children from this node.
   */
  removeChildren() {
    while (this._children.length) {
      this._children[0].get()!.remove();
    }
  }
  /**
   * Whether this node is an ancestor (direct or indirect) of the given node.
   */
  isParentOf(child: Nullable<SceneNode>) {
    while (child && child !== this) {
      child = child.parent!;
    }
    return child === this;
  }
  /**
   * Detach this node from its parent.
   *
   * @returns this
   */
  remove() {
    this.parent = null;
    return this;
  }
  /**
   * Depth-first traversal of this node's subtree (pre-order).
   *
   * @param v - Visitor invoked on each node.
   */
  traverse(v: Visitor<SceneNode>) {
    v.visit(this);
    for (const child of this._children) {
      child.get()!.traverse(v);
    }
  }
  /**
   * Iterate self and descendants in pre-order.
   *
   * Warning: Do not remove children during this iteration. To allow removal, use `iterateBottomToTop`.
   *
   * @param callback - Called for each node; if returns true, iteration stops.
   * @returns true if iteration was aborted early.
   */
  iterate(callback: NodeIterateFunc) {
    if (callback(this)) {
      return true;
    }
    for (const child of this._children) {
      if (child.get()!.iterate(callback)) {
        return true;
      }
    }
    return false;
  }
  /**
   * Iterate self and descendants in reverse post-order (bottom-to-top).
   *
   * Child nodes can be safely removed during this iteration.
   *
   * @param callback - Called for each node; if returns true, iteration stops.
   * @returns true if iteration was aborted early.
   */
  iterateBottomToTop(callback: NodeIterateFunc) {
    for (let i = this._children.length - 1; i >= 0; i--) {
      const child = this._children[i];
      if (child.get()!.iterateBottomToTop(callback)) {
        return true;
      }
    }
    if (callback(this)) {
      return true;
    }
    return false;
  }
  /** Type guard: true if this node is a graph node. */
  isGraphNode(): this is GraphNode {
    return false;
  }
  /** Type guard: true if this node is a light. */
  isLight(): this is BaseLight {
    return false;
  }
  /** Type guard: true if this node is a mesh. */
  isMesh(): this is Mesh {
    return false;
  }
  /** Type guard: true if this node is a sprite */
  isSprite(): this is Sprite {
    return false;
  }
  /** Type guard: true if this node is a water node. */
  isWater(): this is Water {
    return false;
  }
  /** Type guard: true if this node is a particle system. */
  isParticleSystem(): this is ParticleSystem {
    return false;
  }
  /** Type guard: true if this node is a batch group. */
  isBatchGroup(): this is BatchGroup {
    return false;
  }
  /** Type guard: true if this node is a clipmap terrain. */
  isClipmapTerrain(): this is ClipmapTerrain {
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
  /**
   * Computes the bounding volume of the node
   * @returns The output bounding volume
   */
  computeBoundingVolume(): Nullable<BoundingVolume> {
    return null;
  }
  /**
   * Gets the bounding volume of the node
   * @returns The bounding volume of the node
   */
  getBoundingVolume(): Nullable<BoundingVolume> {
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
  getWorldBoundingVolume(): Nullable<BoundingVolume> {
    if (!this._bvWorld) {
      this._bvWorld = this.computeWorldBoundingVolume(this.getBoundingVolume());
    }
    return this._bvWorld;
  }
  /**
   * Computes the world space bounding volume of the node
   * @returns The output bounding volume
   */
  computeWorldBoundingVolume(localBV: Nullable<BoundingVolume>): Nullable<BoundingVolume> {
    return localBV?.transform(this.worldMatrix) ?? null;
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
            this._scene!.invalidateNodePlacement(node);
          }
        });
      } else if (this.isGraphNode()) {
        this._scene.invalidateNodePlacement(this);
      }
      this.dispatchEvent('bvchanged', this);
    }
  }
  /** Clip mode */
  get clipTestEnabled() {
    return this._clipMode;
  }
  set clipTestEnabled(val) {
    this._clipMode = val;
  }
  /** Computed value of show state */
  get hidden() {
    let node: Nullable<SceneNode> = this;
    while (node && node._visible === 'inherit') {
      node = node.parent;
    }
    return node ? node._visible === 'hidden' : false;
  }
  /** Show state */
  get showState() {
    return this._visible;
  }
  set showState(val) {
    if (val !== this._visible) {
      const prevHidden = this.hidden;
      this._visible = val;
      if (prevHidden !== this.hidden) {
        if (this.isGraphNode()) {
          this._scene?.invalidateNodePlacement(this);
        }
        let parent: Nullable<SceneNode> = this;
        while (parent) {
          parent.dispatchEvent('visiblechanged', this);
          parent = parent.parent;
        }
        this.notifyHiddenChanged();
      }
    }
  }
  /** Whether this node is enabled for CPU picking */
  get pickable() {
    return this._pickable;
  }
  set pickable(val) {
    this._pickable = !!val;
  }
  /** Whether this node is enabled for GPU picking */
  get gpuPickable() {
    return this._gpuPickable;
  }
  set gpuPickable(val) {
    this._gpuPickable = !!val;
  }
  /**
   * Finds a scene node by its persistent ID.
   *
   * @typeParam T - Expected node type.
   * @param id - Persistent identifier to match against `SceneNode.persistentId`.
   * @returns The first matching node, or `null` if not found.
   */
  findNodeById<T extends SceneNode>(id: string): T {
    let node: Nullable<T> = null;
    this.iterate((child) => {
      if (child.persistentId === id) {
        node = child as T;
        return true;
      }
    });
    return node as unknown as T;
  }
  /**
   * Finds a skeleton object by its persistent ID.
   * @param id - Persistent identifier to match against `Skeleton.persistentId`.
   * @returns The first matchign node, or `null` if not found.
   */
  findSkeletonById(id: string) {
    const prefabNode = this.getPrefabNode() ?? this;
    let sk: Nullable<DRef<Skeleton>> = null;
    prefabNode.iterate((node) => {
      sk = node.animationSet.skeletons.find((s) => s.get()!.persistentId === id) ?? null;
      return !!sk;
    });
    // avoid ts2339 compilation error (maybe a typescript bug?)
    return (sk as Nullable<DRef<Skeleton>>)?.get() ?? null;
  }
  /**
   * Finds a scene node by name.
   *
   * If multiple nodes share the same name, returns the first match encountered
   * during traversal.
   *
   * @typeParam T - Expected node type.
   * @param name - Node name to match.
   * @returns The first matching node, or `null` if not found.
   *
   * @remarks
   * Names are not guaranteed unique. Prefer IDs for stable references.
   */
  findNodeByName<T extends SceneNode>(name: string): Nullable<T> {
    let node: Nullable<T> = null;
    this.iterate((child) => {
      if (child.name === name) {
        node = child as T;
        return true;
      }
    });
    return node;
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
  get boundingBoxDrawMode() {
    return this._boxDrawMode;
  }
  set boundingBoxDrawMode(mode) {
    this._boxDrawMode = mode;
  }
  /** Get called when the node was just created by cloning from other node */
  protected onPostClone(): void | Promise<void> {}
  /** Disposes the node */
  protected onDispose() {
    super.onDispose();
    this.remove();
    this.removeChildren();
    this._animationSet.dispose();
    this._sharedModel.dispose();
  }
  /** @internal */
  protected _setParent(p: Nullable<SceneNode>) {
    if (p && p._scene !== this._scene) {
      throw new Error('Parent node and child node must belongs to the same scene');
    }
    let lastParent = this._parent;
    let newParent = p;
    if (newParent !== lastParent) {
      const willDetach = (!p || !p.attached) && this.attached;
      const willAttach = !this.attached && p && p.attached;
      if (newParent) {
        newParent._children.push(new DRef(this));
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
  protected _onTransformChanged(invalidateLocal: boolean) {
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
      child.get()!._onTransformChanged(false);
    }
    this.invalidateWorldBoundingVolume(true);
    this.dispatchEvent('transformchanged', this);
  }
  /**
   * Get called when this node is attached to scene
   */
  protected _onAttached() {}
  /**
   * Get called when this node is detached from scene
   */
  protected _onDetached() {}
  /** @internal */
  protected _attached() {
    this.iterate((child) => {
      this.scene!.queueUpdateNode(child);
      child._onAttached();
    });
  }
  /** @internal */
  protected _detached() {
    this.iterate((child) => {
      child._onDetached();
    });
  }
  /** @internal */
  notifyHiddenChanged() {
    this._visibleChanged();
    for (const child of this._children) {
      if (child.get()!.showState === 'inherit') {
        child.get()!.notifyHiddenChanged();
      }
    }
  }
  /** @internal */
  protected _visibleChanged() {}
  /** Parent of the xform */
  get parent() {
    return this._parent;
  }
  set parent(p) {
    if (p !== this._parent) {
      this._setParent(p);
    }
  }
  /** Children of this xform */
  get children() {
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
  get rotation(): Quaternion {
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
  getWorldPosition(outPos?: Vector3) {
    return (
      outPos?.setXYZ(this.worldMatrix.m03, this.worldMatrix.m13, this.worldMatrix.m23) ??
      new Vector3(this.worldMatrix.m03, this.worldMatrix.m13, this.worldMatrix.m23)
    );
  }
  /**
   * Moves the xform by an offset vector
   * @param delta - The offset vector
   * @returns self
   */
  moveBy(delta: Vector3) {
    this._position.addBy(delta);
    return this;
  }
  /**
   * Scales the xform by a given scale factor
   * @param factor - The scale factor
   * @returns self
   */
  scaleBy(factor: Vector3) {
    this._scaling.mulBy(factor);
    return this;
  }
  /**
   * Sets the local transform matrix of the xform
   * @param matrix - The transform matrix to set
   * @returns self
   */
  setLocalTransform(matrix: Matrix4x4) {
    this._disableCallback = true;
    matrix.decompose(this._scaling, this._rotation, this._position);
    this._disableCallback = false;
    this._onTransformChanged(true);
    return this;
  }
  /** Local transformation matrix of the xform */
  get localMatrix(): Immutable<Matrix4x4> {
    if (!this._localMatrix) {
      this.calculateLocalTransform(this._tmpLocalMatrix);
      this._localMatrix = this._tmpLocalMatrix;
    }
    return this._localMatrix;
  }
  set localMatrix(matrix: Immutable<Matrix4x4>) {
    this.setLocalTransform(matrix);
  }
  /** World transformation matrix of the xform */
  get worldMatrix(): Immutable<Matrix4x4> {
    if (!this._worldMatrix) {
      this._worldMatrix = this._tmpWorldMatrix;
      this.calculateWorldTransform(this._worldMatrix);
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
  get invWorldMatrix(): Immutable<Matrix4x4> {
    if (!this._invWorldMatrix) {
      this._invWorldMatrix = Matrix4x4.invertAffine(this.worldMatrix);
    }
    return this._invWorldMatrix;
  }
  /**
   * Calculate local transform matrix
   * @param outMatrix - Matrix object that holds the result of calculation
   */
  calculateLocalTransform(outMatrix: Matrix4x4) {
    outMatrix.compose(this._scaling, this._rotation, this._position);
  }
  /**
   * Calculate world transform matrix
   * @param outMatrix - Matrix object that holds the result of calculation
   */
  calculateWorldTransform(outMatrix: Matrix4x4) {
    if (this._parent) {
      Matrix4x4.multiplyAffine(this._parent.worldMatrix, this.localMatrix, outMatrix);
    } else {
      outMatrix.set(this.localMatrix);
    }
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
   * Update node state once per-frame
   * @param frameId - Current frame id
   * @param elapsedInSeconds - Elapsed time from game start in seconds
   * @param deltaInSeconds - Elapsed time since previous frame in seconds
   */
  update(frameId: number, elapsedInSeconds: number, deltaInSeconds: number) {
    if (!this.attached) {
      return;
    }
    const animationSet = this._animationSet.get();
    if (animationSet) {
      if (animationSet.numAnimations > 0 || animationSet.skeletons.length > 0) {
        animationSet.update(deltaInSeconds);
        this.scene!.queueUpdateNode(this);
      } else {
        this._animationSet.dispose();
      }
    }
  }
  /**
   * Update node state once per-camera
   * @param _camera - Updates according to which camera
   * @param _elapsedInSeconds - Elapsed time from game start in seconds
   * @param _deltaInSeconds - Elapsed time since previous frame in seconds
   */
  updatePerCamera(_camera: Camera, _elapsedInSeconds: number, _deltaInSeconds: number) {}
  /**
   * Removes this node from it's parent and add this node to another parent node if required
   * @param p - The new parent node that this node should be added to or null
   * @returns self
   */
  reparent(p?: Nullable<SceneNode>) {
    this.parent = p ?? null;
    return this;
  }
  /** @internal */
  get transformTag() {
    return this._transformTag;
  }
}
