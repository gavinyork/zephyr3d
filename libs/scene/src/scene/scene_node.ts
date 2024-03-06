import { XForm } from './xform';
import type { Scene } from './scene';
import type { GraphNode } from './graph_node';
import type { Mesh } from './mesh';
import type { Camera } from '../camera/camera';
import type { Terrain } from './terrain/terrain';
import type { PunctualLight, BaseLight } from './light';
import type { BoundingVolume } from '../utility/bounding_volume';

/**
 * Base interface for all scene node visitors
 * @public
 */
export interface SceneNodeVisitor {
  visit(target: SceneNode): unknown;
}

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
export class SceneNode extends XForm<SceneNode> {
  static readonly CLIP_INHERITED = -1;
  static readonly CLIP_DISABLED = 0;
  static readonly CLIP_ENABLED = 1;
  static readonly SHOW_INHERITED = -1;
  static readonly SHOW_HIDE = 0;
  static readonly SHOW_DEFAULT = 1;
  static readonly PICK_INHERITED = -1;
  static readonly PICK_DISABLED = 0;
  static readonly PICK_ENABLED = 1;
  static readonly BBOXDRAW_INHERITED = -1;
  static readonly BBOXDRAW_DISABLED = 0;
  static readonly BBOXDRAW_LOCAL = 1;
  static readonly BBOXDRAW_WORLD = 2;
  /** @internal */
  protected _clipMode: number;
  /** @internal */
  protected _renderOrder: number;
  /** @internal */
  protected _boxDrawMode: number;
  /** @internal */
  protected _visible: number;
  /** @internal */
  protected _pickMode: number;
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
  /**
   * Creates a new scene node
   * @param scene - Which scene the node belongs to
   */
  constructor(scene: Scene) {
    super();
    this._scene = scene;
    this._name = '';
    this._bv = null;
    this._bvWorld = null;
    this._bvDirty = true;
    this._clipMode = SceneNode.CLIP_ENABLED;
    this._boxDrawMode = SceneNode.BBOXDRAW_DISABLED;
    this._visible = SceneNode.SHOW_INHERITED;
    this._pickMode = SceneNode.PICK_DISABLED;
    if (scene && this !== scene.rootNode) {
      this.reparent(scene.rootNode);
    }
  }
  /**
   * Name of the scene node
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
  /** true if the node is attached to the scene node, false otherwise */
  get attached(): boolean {
    return !!this._scene?.rootNode?.isParentOf(this);
  }
  /**
   * Check if given node is a direct child of the node
   * @param child - The node to be checked
   * @returns true if the given node is a direct child of this node, false otherwise
   */
  hasChild(child: SceneNode): boolean {
    return this._children.indexOf(child) >= 0;
  }
  /**
   * Removes all children from this node
   */
  removeChildren() {
    while (this._children.length) {
      this._children[0].remove();
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
  traverse(v: SceneNodeVisitor, inverse?: boolean): void {
    if (inverse) {
      for (let i = this._children.length - 1; i >= 0; i--) {
        this._children[i].traverse(v, inverse);
      }
      v.visit(this);
    } else {
      v.visit(this);
      for (const child of this._children) {
        child.traverse(v);
      }
    }
  }
  /**
   * Iterate self and all of the children
   * @param callback - callback function that will be called on each node
   */
  iterate(callback: (node: SceneNode) => void) {
    callback(this);
    for (const child of this._children) {
      child.iterate(callback);
    }
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
  }
  /**
   * Computes the bounding volume of the node
   * @param bv - The output bounding volume
   * @returns The output bounding volume
   */
  computeBoundingVolume(bv: BoundingVolume): BoundingVolume {
    return bv;
  }
  /**
   * Gets the bounding volume of the node
   * @returns The bounding volume of the node
   */
  getBoundingVolume(): BoundingVolume {
    if (this._bvDirty) {
      this._bv = this.computeBoundingVolume(this._bv) || null;
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
      this.invalidateBoundingVolume();
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
    this.invalidateWorldBoundingVolume();
  }
  /** Force the world space bounding volume to be recalculated */
  invalidateWorldBoundingVolume() {
    this._bvWorld = null;
    this._scene?.invalidateNodePlacement(this);
  }
  /**
   * Computed value of clip mode
   */
  get computedClipMode(): number {
    if (this._clipMode === SceneNode.CLIP_INHERITED) {
      let parent = this.parent;
      while (parent && !parent.isGraphNode()) {
        parent = parent.parent;
      }
      return parent?.computedClipMode ?? SceneNode.CLIP_ENABLED;
    }
    return this._clipMode;
  }
  /** Clip mode */
  get clipMode(): number {
    return this._clipMode;
  }
  set clipMode(val: number) {
    this._clipMode = val;
  }
  /** Computed value of show state */
  get hidden(): boolean {
    let node: SceneNode = this;
    while (node && node._visible === SceneNode.SHOW_INHERITED) {
      node = node.parent;
    }
    return node ? node._visible === SceneNode.SHOW_HIDE : false;
  }
  /** Show state */
  get showState() {
    return this._visible;
  }
  set showState(val: number) {
    if (val !== this._visible) {
      const prevHidden = this.hidden;
      this._visible = val;
      if (prevHidden !== this.hidden) {
        this.notifyHiddenChanged();
      }
    }
  }
  /** Computed value of pick mode */
  get pickable(): boolean {
    let node: SceneNode = this;
    while (node && node._pickMode === SceneNode.PICK_INHERITED) {
      node = node.parent;
    }
    return node ? node._pickMode === SceneNode.PICK_ENABLED : false;
  }
  /** Pick mode */
  get pickMode(): number {
    return this._pickMode;
  }
  set pickMode(val: number) {
    this._pickMode = val;
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
    if (p !== this._parent) {
      const sceneLast = this.attached ? this.scene : null;
      const sceneNew = p?.attached ? p.scene : null;
      const willDetach = sceneLast && sceneLast !== sceneNew;
      const willAttach = sceneNew && sceneLast !== sceneNew;
      willDetach && this._willDetach();
      willAttach && this._willAttach();
      super._setParent(p);
      willDetach && this._detached();
      willAttach && this._attached();
    }
  }
  /** @internal */
  protected _onTransformChanged(invalidateLocal: boolean): void {
    super._onTransformChanged(invalidateLocal);
    this.invalidateWorldBoundingVolume();
  }
  /** @internal */
  protected _willAttach(): void {}
  /** @internal */
  protected _attached(): void {}
  /** @internal */
  protected _willDetach(): void {}
  /** @internal */
  protected _detached(): void {}
  /** @internal */
  notifyHiddenChanged() {
    this._visibleChanged();
    for (const child of this._children) {
      if (child.showState === SceneNode.SHOW_INHERITED) {
        child.notifyHiddenChanged();
      }
    }
  }
  /** @internal */
  protected _visibleChanged(): void {}
}
