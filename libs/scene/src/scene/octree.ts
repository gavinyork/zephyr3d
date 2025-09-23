import { Vector3, AABB, nextPowerOf2, ASSERT } from '@zephyr3d/base';
import type { GraphNode } from './graph_node';
import type { Scene } from './scene';
import type { Visitor } from './visitor';

/**
 * Child placement within an octree node.
 *
 * @remarks
 * Encodes the child octant by the sign of \((x, y, z)\):
 * - `P` for positive, `N` for negative.
 * - Example: `PPN` means \(+x, +y, -z\).
 *
 * @public
 */
export enum OctreePlacement {
  PPP = 0,
  PPN = 1,
  PNP = 2,
  PNN = 3,
  NPP = 4,
  NPN = 5,
  NNP = 6,
  NNN = 7
}

/**
 * A single node (cell) within the octree hierarchy.
 *
 * @remarks
 * - Holds scene graph nodes that spatially belong to the node's region.
 * - Computes tight and loosed AABBs on demand.
 * - Provides navigation to parent/children based on placement.
 *
 * @public
 */
export class OctreeNode {
  /** @internal */
  private _chunk: OctreeNodeChunk;
  /** @internal */
  private _position: number;
  /** @internal */
  private _nodes: GraphNode[];
  /** @internal */
  private _box: AABB;
  /** @internal */
  private _boxLoosed: AABB;
  /**
   * Create an empty octree node.
   *
   * @remarks
   * Nodes are created and wired by `OctreeNodeChunk`.
   */
  constructor() {
    this._chunk = null;
    this._position = 0;
    this._nodes = [];
    this._box = null;
    this._boxLoosed = null;
  }
  /**
   * Get all scene nodes contained in this octree node.
   *
   * @remarks
   * The returned array is owned by the node and may be mutated internally.
   *
   * @returns An array of scene nodes currently held by this octree node.
   */
  getNodes(): GraphNode[] {
    return this._nodes;
  }
  /**
   * Get the hierarchical level index of this node.
   *
   * @remarks
   * Level 0 is the root chunk; higher levels are finer subdivisions.
   *
   * @returns The level index of this octree node.
   */
  getLevel() {
    return this._chunk.getLevel();
  }
  /**
   * Add a scene node to this octree node.
   *
   * @param node - Scene node to add.
   */
  addNode(node: GraphNode): void {
    if (node && this._nodes.indexOf(node) < 0) {
      this._nodes.push(node);
      node.octreeNode = this;
    }
  }
  /**
   * Remove a scene node from this octree node.
   *
   * @param node - Scene node to remove.
   */
  removeNode(node: GraphNode): void {
    const index = this._nodes.indexOf(node);
    if (index >= 0) {
      this._nodes.splice(index, 1);
      node.octreeNode = null;
    }
  }
  /**
   * Remove all scene nodes from this octree node.
   */
  clearNodes() {
    for (const node of this._nodes) {
      node.octreeNode = null;
    }
    this._nodes = [];
  }
  /**
   * Assign the chunk that owns this node.
   *
   * @param chunk - Owning chunk.
   */
  setChunk(chunk: OctreeNodeChunk): void {
    ASSERT(!!chunk, 'Invalid chunk');
    this._chunk = chunk;
  }
  /**
   * Get the chunk that owns this node.
   *
   * @returns The `OctreeNodeChunk` that owns this node.
   */
  getChunk(): OctreeNodeChunk {
    return this._chunk;
  }
  /**
   * Set the node's linear position index within the owning chunk.
   *
   * @param index - Position index.
   */
  setPosition(index: number): void {
    this._position = index;
  }
  /**
   * Get the node's linear position index within the owning chunk.
   *
   * @returns The linear position index of this node.
   */
  getPosition(): number {
    return this._position;
  }
  /**
   * Get the tight AABB of this node, computed from its existing children.
   *
   * @remarks
   * - Computed lazily by merging all child boxes from the next chunk level.
   * - Returns `null` if no child contributes a valid box.
   *
   * @returns The tight `AABB` of this node, or `null` if unavailable.
   */
  getBox() {
    if (this._box === null) {
      const box = new AABB();
      box.beginExtend();
      for (let i = 0; i < 8; i++) {
        const child = this.getChild(i);
        if (child) {
          const childBox = child.getBox();
          if (childBox) {
            box.extend(childBox.minPoint);
            box.extend(childBox.maxPoint);
          }
        }
      }
      if (box.isValid()) {
        this._box = box;
      }
    }
    return this._box;
  }
  /**
   * Get the loosed AABB of this node.
   *
   * @remarks
   * The loosed AABB expands the node by half a node size in each direction,
   * forming a conservative region used for stable placement.
   *
   * @returns The loosed `AABB` of this node.
   */
  getBoxLoosed(): AABB {
    if (this._boxLoosed === null) {
      ASSERT(!!this._chunk, 'Invalid chunk');
      const d = this._chunk.getDimension();
      const nodeSize = this._chunk.getNodeSize();
      const halfWorldSize = this._chunk.getWorldSize() * 0.5;
      const px = this._position % d;
      const py = Math.floor(this._position / d) % d;
      const pz = Math.floor(Math.floor(this._position / d) / d);
      const minPoint = new Vector3(px - 0.5, py - 0.5, pz - 0.5)
        .scaleBy(nodeSize)
        .subBy(new Vector3(halfWorldSize, halfWorldSize, halfWorldSize));
      const maxPoint = new Vector3(
        minPoint.x + nodeSize * 2,
        minPoint.y + nodeSize * 2,
        minPoint.z + nodeSize * 2
      );
      this._boxLoosed = new AABB(minPoint, maxPoint);
    }
    return this._boxLoosed;
  }
  /**
   * Get the minimum (tight) corner point of this node in world space.
   *
   * @returns The minimum corner as a `Vector3`.
   */
  getMinPoint(): Vector3 {
    ASSERT(!!this._chunk, 'Invalid chunk');
    const d = this._chunk.getDimension();
    const nodeSize = this._chunk.getNodeSize();
    const halfWorldSize = this._chunk.getWorldSize() * 0.5;
    const px = this._position % d;
    const py = Math.floor(this._position / d) % d;
    const pz = Math.floor(Math.floor(this._position / d) / d);
    return new Vector3(px, py, pz)
      .scaleBy(nodeSize)
      .subBy(new Vector3(halfWorldSize, halfWorldSize, halfWorldSize));
  }
  /**
   * Get the maximum (tight) corner point of this node in world space.
   *
   * @returns The maximum corner as a `Vector3`.
   */
  getMaxPoint(): Vector3 {
    ASSERT(!!this._chunk, 'Invalid chunk');
    const d = this._chunk.getDimension();
    const nodeSize = this._chunk.getNodeSize();
    const halfWorldSize = this._chunk.getWorldSize() * 0.5;
    const px = (this._position % d) + 1;
    const py = (Math.floor(this._position / d) % d) + 1;
    const pz = Math.floor(Math.floor(this._position / d) / d) + 1;
    return new Vector3(px, py, pz)
      .scaleBy(nodeSize)
      .subBy(new Vector3(halfWorldSize, halfWorldSize, halfWorldSize));
  }
  /**
   * Get the loosed minimum corner point of this node in world space.
   *
   * @returns The loosed minimum corner as a `Vector3`.
   */
  getMinPointLoosed(): Vector3 {
    const halfNodeSize = this._chunk.getNodeSize() * 0.5;
    return this.getMinPoint().subBy(new Vector3(halfNodeSize, halfNodeSize, halfNodeSize));
  }
  /**
   * Get the loosed maximum corner point of this node in world space.
   *
   * @returns The loosed maximum corner as a `Vector3`.
   */
  getMaxPointLoosed(): Vector3 {
    const halfNodeSize = this._chunk.getNodeSize() * 0.5;
    return this.getMaxPoint().addBy(new Vector3(halfNodeSize, halfNodeSize, halfNodeSize));
  }
  /**
   * Get a child node by placement from the next (finer) chunk.
   *
   * @param placement - Child octant placement.
   *
   * @remarks
   * Returns `null` if the next chunk does not exist or the child is absent.
   *
   * @returns The child `OctreeNode`, or `null` if not present.
   */
  getChild(placement: OctreePlacement): OctreeNode {
    ASSERT(!!this._chunk, 'Invalid chunk');
    const next = this._chunk.getNext();
    return next ? next.getNode(this._chunk.getChildIndex(this._position, placement)) : null;
  }
  /**
   * Get or create a child node by placement from the next (finer) chunk.
   *
   * @param placement - Child octant placement.
   *
   * @remarks
   * Returns `null` if the next chunk does not exist.
   *
   * @returns The existing or newly created child `OctreeNode`, or `null` if creation is not possible.
   */
  getOrCreateChild(placement: OctreePlacement): OctreeNode {
    ASSERT(!!this._chunk, 'Invalid chunk');
    const next = this._chunk.getNext();
    return next ? next.getOrCreateNode(this._chunk.getChildIndex(this._position, placement)) : null;
  }
  /**
   * Get the parent node from the previous (coarser) chunk.
   *
   * @remarks
   * Returns `null` if the previous chunk does not exist or the parent is absent.
   *
   * @returns The parent `OctreeNode`, or `null` if not present.
   */
  getParent(): OctreeNode {
    ASSERT(!!this._chunk, 'Invalid chunk');
    const prev = this._chunk.getPrev();
    return prev ? prev.getNode(this._chunk.getParentIndex(this._position)) : null;
  }
  /**
   * Get or create the parent node from the previous (coarser) chunk.
   *
   * @remarks
   * Returns `null` if the previous chunk does not exist.
   *
   * @returns The existing or newly created parent `OctreeNode`, or `null` if creation is not possible.
   */
  getOrCreateParent(): OctreeNode {
    ASSERT(!!this._chunk, 'Invalid chunk');
    const prev = this._chunk.getPrev();
    return prev ? prev.getOrCreateNode(this._chunk.getParentIndex(this._position)) : null;
  }
  /**
   * Create all eight children for this node in the next (finer) chunk.
   *
   * @remarks
   * No-op when the next chunk does not exist.
   */
  createChildren() {
    this.getOrCreateChild(OctreePlacement.PPP);
    this.getOrCreateChild(OctreePlacement.PPN);
    this.getOrCreateChild(OctreePlacement.PNP);
    this.getOrCreateChild(OctreePlacement.PNN);
    this.getOrCreateChild(OctreePlacement.NPP);
    this.getOrCreateChild(OctreePlacement.NPN);
    this.getOrCreateChild(OctreePlacement.NNP);
    this.getOrCreateChild(OctreePlacement.NNN);
  }
  /**
   * Traverse this node and existing children in pre-order.
   *
   * @param v - Visitor invoked on each node; if it returns `true`, traversal continues into children.
   *
   * @remarks
   * Children are visited in octant order [PPP, PPN, PNP, PNN, NPP, NPN, NNP, NNN].
   */
  traverse(v: Visitor<OctreeNode>) {
    if (v.visit(this)) {
      for (let i = 0; i < 8; i++) {
        const child = this.getChild(i);
        if (child) {
          child.traverse(v);
        }
      }
    }
  }
}

/**
 * A grid of octree nodes at a specific level of detail.
 *
 * @remarks
 * - Each chunk represents a uniform grid of (d x d x d) nodes, where (d = 2^\{level\}).
 * - Chunks are linked as a hierarchy from coarse (root) to fine (leaf) via `prev`/`next`.
 * - Nodes are created lazily and indexed by a linear index.
 *
 * @public
 */
export class OctreeNodeChunk {
  /** @internal */
  private _level: number;
  /** @internal */
  private _dimension: number;
  /** @internal */
  private _nodeSize: number;
  /** @internal */
  private _prev: OctreeNodeChunk;
  /** @internal */
  private _next: OctreeNodeChunk;
  /** @internal */
  private readonly _octree: Octree;
  /** @internal */
  private readonly _nodeMap: Map<number, OctreeNode>;
  /**
   * Create a chunk for the given octree.
   *
   * @param octree - Owning octree.
   */
  constructor(octree: Octree) {
    this._octree = octree;
    this._level = 0;
    this._dimension = 0;
    this._nodeSize = 0;
    this._next = null;
    this._prev = null;
    this._nodeMap = new Map();
  }
  /** @internal */
  get nodeMap() {
    return this._nodeMap;
  }
  /**
   * Get an octree node by linear index.
   *
   * @param index - Linear index within this chunk.
   *
   * @returns The `OctreeNode` at the index, or `null` if absent.
   */
  getNode(index: number): OctreeNode {
    return this._nodeMap.get(index) || null;
  }
  /**
   * Get or create an octree node by linear index.
   *
   * @param index - Linear index within this chunk.
   *
   * @returns The existing or newly created `OctreeNode`.
   */
  getOrCreateNode(index: number): OctreeNode {
    let node = this.getNode(index);
    if (!node) {
      node = new OctreeNode();
      node.setChunk(this);
      node.setPosition(index);
      this._nodeMap.set(index, node);
    }
    return node;
  }
  /**
   * Ensure the node chain (this level and all parents) exists for a given index.
   *
   * @param index - Linear index at this level.
   *
   * @returns The `OctreeNode` at this level; parent nodes are created as needed.
   */
  getOrCreateNodeChain(index: number): OctreeNode {
    const node = this.getOrCreateNode(index);
    if (this._prev) {
      this._prev.getOrCreateNodeChain(this.getParentIndex(index));
    }
    return node;
  }
  /**
   * Remove and clear all nodes in this chunk.
   *
   * @remarks
   * Also detaches all scene nodes held by each `OctreeNode`.
   */
  clearNodes(): void {
    for (const key of this._nodeMap.keys()) {
      this._nodeMap.get(key).clearNodes();
      this._nodeMap.delete(key);
    }
  }
  /**
   * Compute the child index in the next chunk for a given parent index and placement.
   *
   * @param index - Parent node index in this chunk.
   * @param placement - Child octant placement.
   *
   * @returns The linear index of the child in the next chunk.
   */
  getChildIndex(index: number, placement: OctreePlacement): number {
    const dim = this._dimension;
    let px = 2 * (index % dim);
    let py = 2 * (Math.floor(index / dim) % dim);
    let pz = 2 * Math.floor(Math.floor(index / dim) / dim);
    switch (placement) {
      case OctreePlacement.PPP:
        ++px;
        ++py;
        ++pz;
        break;
      case OctreePlacement.PPN:
        ++px;
        ++py;
        break;
      case OctreePlacement.PNP:
        ++px;
        ++pz;
        break;
      case OctreePlacement.PNN:
        ++px;
        break;
      case OctreePlacement.NPP:
        ++py;
        ++pz;
        break;
      case OctreePlacement.NPN:
        ++py;
        break;
      case OctreePlacement.NNP:
        ++pz;
        break;
      case OctreePlacement.NNN:
        break;
      default:
        ASSERT(false, 'getChildIndex: Got invalid index');
        return 0;
    }
    const dimension2 = 2 * dim;
    return pz * dimension2 * dimension2 + py * dimension2 + px;
  }
  /**
   * Compute the parent index in the previous chunk for a given child index.
   *
   * @param index - Child node index in this chunk.
   *
   * @returns The linear index of the parent in the previous chunk.
   */
  getParentIndex(index: number): number {
    const dim = this._dimension;
    const px = index % dim >> 1;
    const py = Math.floor(index / dim) % dim >> 1;
    const pz = Math.floor(Math.floor(index / dim) / dim) >> 1;
    const d = dim >> 1;
    return px + py * d + pz * d * d;
  }
  /**
   * Node size at this chunk level.
   *
   * @remarks
   * Represents the world-space edge length for a cell at this level.
   *
   * @returns The world-space edge length per cell in this chunk.
   */
  getNodeSize(): number {
    return this._nodeSize;
  }
  /**
   * Root world size of the octree.
   *
   * @remarks
   * Same across all chunks; used to convert between world coordinates and indices.
   *
   * @returns The root world size (edge length) of the octree.
   */
  getWorldSize(): number {
    return this._octree.getRootSize();
  }
  /**
   * Dimension of this chunk (number of cells per axis).
   *
   * @remarks
   * Equals \(2^\{level\}\).
   *
   * @returns The dimension (cells per axis) for this chunk.
   */
  getDimension(): number {
    return this._dimension;
  }
  /**
   * Level index of this chunk (0 = root/coarsest).
   *
   * @returns The level index of this chunk.
   */
  getLevel(): number {
    return this._level;
  }
  /**
   * Whether this chunk currently has no created nodes.
   *
   * @returns True if the chunk has no nodes; otherwise false.
   */
  empty(): boolean {
    return this._nodeMap.size === 0;
  }
  /**
   * Next (finer) chunk in the hierarchy, or `null` if this is the finest.
   *
   * @returns The next `OctreeNodeChunk`, or `null` if none.
   */
  getNext(): OctreeNodeChunk {
    return this._next;
  }
  /**
   * Previous (coarser) chunk in the hierarchy, or `null` if this is the root.
   *
   * @returns The previous `OctreeNodeChunk`, or `null` if none.
   */
  getPrev(): OctreeNodeChunk {
    return this._prev;
  }
  /**
   * The octree that owns this chunk.
   *
   * @returns The owning `Octree` instance.
   */
  getOctree(): Octree {
    return this._octree;
  }
  /**
   * Set the level index.
   *
   * @param level - Level index for this chunk.
   */
  setLevel(level: number) {
    this._level = level;
  }
  /**
   * Set the dimension (cells per axis).
   *
   * @param dimension - Dimension for this chunk (typically \(2^\{level\}\)).
   */
  setDimension(dimension: number) {
    this._dimension = dimension;
  }
  /**
   * Set the node size at this level.
   *
   * @param size - World-space edge length per cell.
   */
  setNodeSize(size: number) {
    this._nodeSize = size;
  }
  /**
   * Link to the next (finer) chunk.
   *
   * @param chunk - The next chunk.
   */
  setNext(chunk: OctreeNodeChunk) {
    this._next = chunk;
  }
  /**
   * Link to the previous (coarser) chunk.
   *
   * @param chunk - The previous chunk.
   */
  setPrev(chunk: OctreeNodeChunk) {
    this._prev = chunk;
  }
}

/**
 * Spatial acceleration structure for scene graph nodes using an octree hierarchy.
 *
 * @remarks
 * - Organizes `GraphNode` instances into a multi-level grid of `OctreeNodeChunk`s.
 * - Supports dynamic resizing to accommodate large scenes while maintaining a minimum leaf size.
 * - Placement is driven by world-space AABBs; nodes are mapped to an appropriate level by size.
 * - Maintains a weak map from `GraphNode` to the current `OctreeNode` for efficient updates.
 *
 * Performance:
 * - Nodes and chunks are created lazily.
 * - Resizing re-inserts existing nodes; use sparingly and prefer reasonable initial sizes.
 *
 * Invariants:
 * - `rootSize` and `leafSize` are powers of two; `rootSize >= leafSize`.
 * - Level 0 chunk exists after initialization.
 *
 * @public
 */
export class Octree {
  /** @internal */
  private readonly _scene: Scene;
  /** @internal */
  private _chunks: OctreeNodeChunk[];
  /** @internal */
  private _rootSize: number;
  /** @internal */
  private readonly _maxRootSize: number;
  /** @internal */
  private _leafSize: number;
  /** @internal */
  private _rootNode: OctreeNode;
  /** @internal */
  private _nodeMap: WeakMap<GraphNode, OctreeNode>;
  /** @internal */
  private readonly _nodes: Set<GraphNode>;
  /**
   * Create an octree.
   *
   * @param scene - Owning scene instance.
   * @param rootSize - Initial root world size (edge length), power of two. Defaults to 8.
   * @param leafSize - Minimum leaf cell size (edge length), power of two. Defaults to 8.
   * @param maxRootSize - Hard cap for dynamic growth. Defaults to 65536.
   *
   * @remarks
   * The octree is initialized on construction; use `finalize()` to clear all data.
   */
  constructor(scene: Scene, rootSize = 8, leafSize = 8, maxRootSize = 65536) {
    this._scene = scene;
    this._chunks = [];
    this._rootSize = 0;
    this._leafSize = 0;
    this._rootNode = null;
    this._nodeMap = new WeakMap();
    this._nodes = new Set();
    this.initialize(rootSize, leafSize);
    this._maxRootSize = Math.max(maxRootSize, this._rootSize);
  }
  /**
   * Initialize the octree with specified root and leaf sizes.
   *
   * @param rootSize - Root world size (edge length).
   * @param leafSize - Leaf cell size (edge length).
   *
   * @remarks
   * - Clears any existing data.
   * - Builds chunk hierarchy from coarse to fine granularity.
   */
  initialize(rootSize: number, leafSize: number) {
    this.finalize();
    this._leafSize = leafSize;
    this._rootSize = Math.max(leafSize, rootSize);
    let n = 1;
    for (; rootSize >= leafSize * 2; leafSize *= 2, ++n) {
      // no-op
    }
    for (let i = 0; i < n; ++i, rootSize *= 0.5) {
      const chunk = new OctreeNodeChunk(this);
      chunk.setLevel(i);
      chunk.setNodeSize(rootSize);
      chunk.setDimension(1 << i);
      this._chunks.push(chunk);
      if (i > 0) {
        this._chunks[i - 1].setNext(chunk);
        chunk.setPrev(this._chunks[i - 1]);
      }
    }
  }
  /**
   * Free all nodes and chunks owned by this octree.
   *
   * @remarks
   * Resets sizes, root node, and placement maps.
   */
  finalize() {
    this._chunks.forEach((chunk) => chunk.clearNodes());
    this._chunks = [];
    this._rootSize = 0;
    this._leafSize = 0;
    this._rootNode = null;
    this._nodeMap = new WeakMap();
  }
  /**
   * Owning scene.
   *
   * @returns The `Scene` that owns this octree.
   */
  getScene(): Scene {
    return this._scene;
  }
  /**
   * Root world size (edge length).
   *
   * @returns The current root world size.
   */
  getRootSize(): number {
    return this._rootSize;
  }
  /**
   * Minimum leaf cell size (edge length).
   *
   * @returns The current leaf cell size.
   */
  getLeafSize(): number {
    return this._leafSize;
  }
  /**
   * Locate the best-fit node chain for a sphere.
   *
   * @param candidate - Optional current node containing the object (hint for reuse).
   * @param center - Sphere center in world coordinates.
   * @param radius - Sphere radius in world units.
   *
   * @remarks
   * - Chooses the finest level where node size is at least (4 \\times) radius.
   * - Returns `null` if the sphere lies outside the current octree bounds.
   * - If `candidate` already matches, it is returned directly.
   *
   * @returns The head `OctreeNode` of the located chain, or `null` if out of bounds.
   */
  locateNodeChain(candidate: OctreeNode, center: Vector3, radius: number): OctreeNode {
    let level = this._chunks.length - 1;
    while (level >= 0 && this._chunks[level].getNodeSize() < 4 * radius) {
      --level;
    }
    if (level < 0) {
      return null;
    }
    const dim = this._chunks[level].getDimension();
    const inv_node_size = 1 / this._chunks[level].getNodeSize();
    const px = Math.floor((center.x + this._rootSize * 0.5) * inv_node_size);
    const py = Math.floor((center.y + this._rootSize * 0.5) * inv_node_size);
    const pz = Math.floor((center.z + this._rootSize * 0.5) * inv_node_size);
    if (px >= dim || px < 0 || py >= dim || py < 0 || pz >= dim || pz < 0) {
      return null;
    }
    const index = px + py * dim + pz * dim * dim;
    if (candidate && candidate.getChunk().getLevel() === level && candidate.getPosition() === index) {
      return candidate;
    }
    return this._chunks[level].getOrCreateNodeChain(index);
  }
  /**
   * Get the root node (level 0, index 0), creating it if necessary.
   *
   * @returns The root `OctreeNode`.
   */
  getRootNode(): OctreeNode {
    if (!this._rootNode) {
      this._rootNode = this._chunks[0].getOrCreateNode(0);
    }
    return this._rootNode;
  }
  /**
   * Number of chunks (levels) in the octree hierarchy.
   *
   * @returns The total number of chunk levels.
   */
  getNumChunks(): number {
    return this._chunks.length;
  }
  /**
   * Get a chunk by level index.
   *
   * @param level - Chunk level (0 is root).
   *
   * @returns The `OctreeNodeChunk` at the given level.
   */
  getChunk(level: number): OctreeNodeChunk {
    return this._chunks[level];
  }
  /**
   * Place or update a scene node in the octree.
   *
   * @param node - Scene graph node to place.
   *
   * @remarks
   * - Uses the node's world-space AABB to determine size and best-fit level.
   * - If the node does not fit within current bounds and growth is allowed,
   *   the octree resizes (up to `maxRootSize`) and reinserts nodes.
   * - Nodes without valid bounds or with clip tests disabled fall back to the root.
   */
  placeNode(node: GraphNode): void {
    const curNode = this._nodeMap.get(node) || null;
    let locatedNode: OctreeNode = this.getRootNode();
    if (node.clipTestEnabled) {
      const bbox = node.getWorldBoundingVolume()?.toAABB();
      if (bbox && bbox.isValid()) {
        const center = bbox.center;
        const extents = bbox.extents;
        let size = Math.min(Math.max(Math.max(extents.x, extents.y), extents.z), this._maxRootSize);
        if (Number.isNaN(size)) {
          size = this._maxRootSize;
        }
        locatedNode = this.locateNodeChain(curNode, center, size);
        if (!locatedNode) {
          let d = Math.min(
            Math.max(...Vector3.abs(bbox.minPoint), ...Vector3.abs(bbox.maxPoint)),
            this._maxRootSize
          );
          if (Number.isNaN(d)) {
            d = this._maxRootSize;
          }
          const newSize = nextPowerOf2(Math.ceil(Math.max(d * 2, 4 * size)));
          if (newSize <= this._maxRootSize) {
            this.resize(newSize);
            this.placeNode(node);
            return;
          } else {
            locatedNode = this.getRootNode();
          }
        }
      }
    }
    if (curNode !== locatedNode) {
      curNode?.removeNode(node);
      locatedNode?.addNode(node);
      this._nodeMap.set(node, locatedNode);
    }
    this._nodes.add(node);
  }
  /**
   * Remove a scene node from the octree.
   *
   * @param node - Scene graph node to remove.
   */
  removeNode(node: GraphNode): void {
    if (node.isGraphNode()) {
      const curNode = this._nodeMap.get(node) || null;
      if (curNode) {
        curNode.removeNode(node);
        this._nodeMap.delete(node);
      }
      this._nodes.delete(node);
    }
  }
  /**
   * Shrink the octree to the minimum size if the first finer level is empty.
   *
   * @remarks
   * Useful after many removals; preserves `leafSize`.
   */
  prune() {
    if (this._chunks.length === 1) {
      return;
    }
    for (const entry of this._chunks[1].nodeMap) {
      if (entry[1].getNodes().length > 0) {
        return;
      }
    }
    this.resize(this._leafSize);
  }
  /**
   * Resize the octree root size and rebuild chunks.
   *
   * @param size - New root world size (edge length). Rounded up to the next power of two and clamped to `leafSize`.
   *
   * @remarks
   * - Reinitializes chunks and reinserts previously placed nodes.
   * - No-op if the size does not change.
   */
  resize(size: number) {
    size = Math.max(nextPowerOf2(Math.ceil(size)), this._leafSize);
    if (size === this._rootSize) {
      return;
    }
    const nodes: GraphNode[] = [];
    for (const chunk of this._chunks) {
      chunk.nodeMap.forEach((node) => {
        nodes.push(...node.getNodes());
      });
    }
    this.initialize(size, this._leafSize);
    for (const node of nodes) {
      this.placeNode(node);
    }
  }
}
