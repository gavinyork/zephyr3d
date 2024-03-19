import { Vector3, AABB, nextPowerOf2 } from '@zephyr3d/base';
import { GraphNode } from './graph_node';
import type { Scene } from './scene';
import type { Visitor } from './visitor';

/**
 * Octree placement
 * @public
 */
/* eslint-disable no-unused-vars */
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
 * Octree node
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
   * Creates an instance of octree node
   */
  constructor() {
    this._chunk = null;
    this._position = 0;
    this._nodes = [];
    this._box = null;
    this._boxLoosed = null;
  }
  /**
   * Get all the scene nodes that this octree node contains
   * @returns An array of the scene nodes
   */
  getNodes(): GraphNode[] {
    return this._nodes;
  }
  /**
   * Gets the level index of the octree node
   * @returns The level index
   */
  getLevel() {
    return this._chunk.getLevel();
  }
  /**
   * Adds a scene node to this node
   * @param node - The scene node to be added
   */
  addNode(node: GraphNode): void {
    if (node && this._nodes.indexOf(node) < 0) {
      this._nodes.push(node);
      node.octreeNode = this;
    }
  }
  /**
   * Removes a scene node from this node
   * @param node - The scene node to be removed
   */
  removeNode(node: GraphNode): void {
    const index = this._nodes.indexOf(node);
    if (index >= 0) {
      this._nodes.splice(index, 1);
      node.octreeNode = null;
    }
  }
  /** Removes all the scene nodes that this octree node contains */
  clearNodes() {
    for (const node of this._nodes) {
      node.octreeNode = null;
    }
    this._nodes = [];
  }
  /**
   * Sets the octree chunk
   * @param chunk - The octree chunk to be set
   */
  setChunk(chunk: OctreeNodeChunk): void {
    console.assert(!!chunk, 'Invalid chunk');
    this._chunk = chunk;
  }
  /**
   * Gets the octree chunk
   * @returns The octree chunk
   */
  getChunk(): OctreeNodeChunk {
    return this._chunk;
  }
  /**
   * Sets the position of the node
   * @param index - Position of the node
   */
  setPosition(index: number): void {
    this._position = index;
  }
  /**
   * Gets the position of the octree node
   * @returns Position of the octree node
   */
  getPosition(): number {
    return this._position;
  }
  /**
   * Get the bounding box of the octree node
   * @returns The bounding box of the octree node
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
   * Gets the loosed bounding box of the node
   * @returns The loosed bounding box of the node
   */
  getBoxLoosed(): AABB {
    if (this._boxLoosed === null) {
      console.assert(!!this._chunk, 'Invalid chunk');
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
   * Gets min point of the node
   * @returns Min point of the node
   */
  getMinPoint(): Vector3 {
    console.assert(!!this._chunk, 'Invalid chunk');
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
   * Gets max point of the node
   * @returns Max point of the node
   */
  getMaxPoint(): Vector3 {
    console.assert(!!this._chunk, 'Invalid chunk');
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
   * Gets the loosed min point of the node
   * @returns Loosed min point of the node
   */
  getMinPointLoosed(): Vector3 {
    const halfNodeSize = this._chunk.getNodeSize() * 0.5;
    return this.getMinPoint().subBy(new Vector3(halfNodeSize, halfNodeSize, halfNodeSize));
  }
  /**
   * Gets the loosed max point of the node
   * @returns Loosed max point of the node
   */
  getMaxPointLoosed(): Vector3 {
    const halfNodeSize = this._chunk.getNodeSize() * 0.5;
    return this.getMaxPoint().addBy(new Vector3(halfNodeSize, halfNodeSize, halfNodeSize));
  }
  /**
   * Gets the child node by a given placement
   * @param placement - The placement
   * @returns Child node at the given placement
   */
  getChild(placement: OctreePlacement): OctreeNode {
    console.assert(!!this._chunk, 'Invalid chunk');
    const next = this._chunk.getNext();
    return next ? next.getNode(this._chunk.getChildIndex(this._position, placement)) : null;
  }
  /**
   * Gets or creates a child node by a given placement
   * @param placement - The placement
   * @returns The child node fetched
   */
  getOrCreateChild(placement: OctreePlacement): OctreeNode {
    console.assert(!!this._chunk, 'Invalid chunk');
    const next = this._chunk.getNext();
    return next ? next.getOrCreateNode(this._chunk.getChildIndex(this._position, placement)) : null;
  }
  /**
   * Gets parent of the node
   * @returns Parent of the node
   */
  getParent(): OctreeNode {
    console.assert(!!this._chunk, 'Invalid chunk');
    const prev = this._chunk.getPrev();
    return prev ? prev.getNode(this._chunk.getParentIndex(this._position)) : null;
  }
  /**
   * Gets or creates the parent node
   * @returns The parent node
   */
  getOrCreateParent(): OctreeNode {
    console.assert(!!this._chunk, 'Invalid chunk');
    const prev = this._chunk.getPrev();
    return prev ? prev.getOrCreateNode(this._chunk.getParentIndex(this._position)) : null;
  }
  /**
   * Creates all children of this node
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
   * Traverse this node by a visitor
   * @param v - The visitor
   */
  traverse(v: Visitor) {
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
 * Octree node chunk
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
  private _octree: Octree;
  /** @internal */
  private _nodeMap: Map<number, OctreeNode>;
  /**
   * Creates an instance of octree chunk
   * @param octree - Octree to which the chunk belongs
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
   * Gets an octree node at a given index
   * @param index - Index of the node
   * @returns The octree node
   */
  getNode(index: number): OctreeNode {
    return this._nodeMap.get(index) || null;
  }
  /**
   * Gets or creates an octree node at a given index
   * @param index - Index of the node
   * @returns The octree node
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
   * Gets or creates an octree node chain at a given index
   * @param index - Index of the head node
   * @returns The head node of the chain
   */
  getOrCreateNodeChain(index: number): OctreeNode {
    const node = this.getOrCreateNode(index);
    if (this._prev) {
      this._prev.getOrCreateNodeChain(this.getParentIndex(index));
    }
    return node;
  }
  /**
   * Removes all octree nodes of this chunk
   */
  clearNodes(): void {
    for (const key of this._nodeMap.keys()) {
      this._nodeMap.get(key).clearNodes();
      this._nodeMap.delete(key);
    }
  }
  /**
   * Gets the index of a child node at given placement
   * @param index - Index of the parent node
   * @param placement - The placement
   * @returns Index of the child
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
        console.assert(false, 'getChildIndex: Got invalid index');
        return 0;
    }
    const dimension2 = 2 * dim;
    return pz * dimension2 * dimension2 + py * dimension2 + px;
  }
  /**
   * Gets the index of the parent node
   * @param index - Index of the child node
   * @returns Index of the parent node
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
   * Gets the size of the node in this chunk
   * @returns The size of the node in this chunk
   */
  getNodeSize(): number {
    return this._nodeSize;
  }
  /**
   * Gets the root size of the octree
   * @returns The root size of the octree
   */
  getWorldSize(): number {
    return this._octree.getRootSize();
  }
  /**
   * Gets the dimension of this chunk
   * @returns Dimension of this chunk
   */
  getDimension(): number {
    return this._dimension;
  }
  /**
   * Gets the level index of this chunk
   * @returns Level index of this chunk
   */
  getLevel(): number {
    return this._level;
  }
  /**
   * Check if this chunk is empty
   * @returns true if this chunk is empty, otherwise false
   */
  empty(): boolean {
    return this._nodeMap.size === 0;
  }
  /**
   * Gets the chunk next to this chunk
   * @returns The next chunk
   */
  getNext(): OctreeNodeChunk {
    return this._next;
  }
  /**
   * Gets the chunk previous to this chunk
   * @returns The previous chunk
   */
  getPrev(): OctreeNodeChunk {
    return this._prev;
  }
  /**
   * Gets the octree that the chunk belongs to
   * @returns The octree
   */
  getOctree(): Octree {
    return this._octree;
  }
  /**
   * Sets the level index of this chunk
   * @param level - The level index to set
   */
  setLevel(level: number) {
    this._level = level;
  }
  /**
   * Sets the dimension of this chunk
   * @param dimension - The dimension to set
   */
  setDimension(dimension: number) {
    this._dimension = dimension;
  }
  /**
   * Sets the size of octree node in this chunk
   * @param size - The node size to set
   */
  setNodeSize(size: number) {
    this._nodeSize = size;
  }
  /**
   * Sets the next chunk
   * @param chunk - The chunk to set
   */
  setNext(chunk: OctreeNodeChunk) {
    this._next = chunk;
  }
  /**
   * Sets the previous chunk
   * @param chunk - The chunk to set
   */
  setPrev(chunk: OctreeNodeChunk) {
    this._prev = chunk;
  }
}

/**
 * Octree class
 * @public
 */
export class Octree {
  /** @internal */
  private _scene: Scene;
  /** @internal */
  private _chunks: OctreeNodeChunk[];
  /** @internal */
  private _rootSize: number;
  /** @internal */
  private _leafSize: number;
  /** @internal */
  private _rootNode: OctreeNode;
  /** @internal */
  private _nodeMap: WeakMap<GraphNode, OctreeNode>;
  /**
   * Creates an instance of octree
   * @param scene - The scene to which the octree belongs
   * @param rootSize - Root size of the octre
   * @param leafSize - Leaf size of the octree
   */
  constructor(scene: Scene, rootSize = 4096, leafSize = 64) {
    this._scene = scene;
    this._chunks = [];
    this._rootSize = 0;
    this._leafSize = 0;
    this._rootNode = null;
    this._nodeMap = new WeakMap();
    this.initialize(rootSize, leafSize);
  }
  /**
   * Initialize the octree with specified root size and leaf size
   * @param rootSize - Root size of the octree
   * @param leafSize - Leaf size of the octree
   */
  initialize(rootSize: number, leafSize: number) {
    this.finalize();
    this._leafSize = leafSize;
    this._rootSize = Math.max(leafSize, rootSize);
    let n = 1;
    for (; rootSize >= leafSize * 2; leafSize *= 2, ++n);
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
  /** Free up the octree */
  finalize() {
    this._chunks.forEach(chunk => chunk.clearNodes());
    this._chunks = [];
    this._rootSize = 0;
    this._leafSize = 0;
    this._rootNode = null;
    this._nodeMap = new WeakMap();
  }
  /**
   * Gets the scene to which the octree belongs
   * @returns The scene
   */
  getScene(): Scene {
    return this._scene;
  }
  /**
   * Gets the root size of the octree
   * @returns The root size of the octree
   */
  getRootSize(): number {
    return this._rootSize;
  }
  /**
   * Gets the leaf size of the octree
   * @returns The leaf size of the octree
   */
  getLeafSize(): number {
    return this._leafSize;
  }
  /**
   * Locates a node chain in the octree by a sphere
   * @param candidate - The candidate node
   * @param center - center of the sphere
   * @param radius - radius of the sphere
   * @returns Head node of the located node chain
   */
  locateNodeChain(candidate: OctreeNode, center: Vector3, radius: number): OctreeNode {
    let level = this._chunks.length - 1;
    while (level && this._chunks[level].getNodeSize() < 4 * radius) {
      --level;
    }
    const dim = this._chunks[level].getDimension();
    const inv_node_size = 1 / this._chunks[level].getNodeSize();
    let px = Math.floor((center.x + this._rootSize * 0.5) * inv_node_size);
    let py = Math.floor((center.y + this._rootSize * 0.5) * inv_node_size);
    let pz = Math.floor((center.z + this._rootSize * 0.5) * inv_node_size);
    if (px >= dim || py >= dim || pz >= dim) {
      return null;
    }
    const index = px + py * dim + pz * dim * dim;
    if (candidate && candidate.getChunk().getLevel() === level && candidate.getPosition() === index) {
      return candidate;
    }
    return this._chunks[level].getOrCreateNodeChain(index);
  }
  /**
   * Gets the root node of the octree
   * @returns Root node of the octree
   */
  getRootNode(): OctreeNode {
    if (!this._rootNode) {
      this._rootNode = this._chunks[0].getOrCreateNode(0);
    }
    return this._rootNode;
  }
  /**
   * Gets the number of chunks in the octree
   * @returns The number of chunks in the octree
   */
  getNumChunks(): number {
    return this._chunks.length;
  }
  /**
   * Gets the chunk by a given index
   * @param level - The chunk index
   * @returns The chunk at given index
   */
  getChunk(level: number): OctreeNodeChunk {
    return this._chunks[level];
  }
  /**
   * Place a scene node into the octree
   * @param node - The scene node to be placed
   */
  placeNode(node: GraphNode): void {
    const curNode = this._nodeMap.get(node) || null;
    let locatedNode: OctreeNode = this.getRootNode();
    if (node.clipTestEnabled) {
      const bbox = node.getWorldBoundingVolume()?.toAABB();
      if (bbox && bbox.isValid()) {
        const center = bbox.center;
        const extents = bbox.extents;
        const size = Math.max(Math.max(extents.x, extents.y), extents.z);
        locatedNode = this.locateNodeChain(curNode, center, size);
        if (!locatedNode) {
          const d = Math.max(...Vector3.abs(bbox.minPoint), ...Vector3.abs(bbox.maxPoint));
          // nodeSize >= 4 * size & octreeSize >= 2 * d
          this.resize(Math.max(d * 2, 4 * size));
          this.placeNode(node);
          return;
        }
      }
    }
    if (curNode !== locatedNode) {
      curNode?.removeNode(node);
      locatedNode?.addNode(node);
      this._nodeMap.set(node, locatedNode);
    }
  }
  /**
   * Removes a scene node from the octree
   * @param node - The scene node to be removed
   */
  removeNode(node: GraphNode): void {
    if (node.isGraphNode()) {
      const curNode = this._nodeMap.get(node) || null;
      if (curNode) {
        curNode.removeNode(node);
        this._nodeMap.delete(node);
      }
    }
  }
  resize(size: number) {
    size = Math.max(nextPowerOf2(size), this._leafSize);
    if (size === this._rootSize) {
      return;
    }
    const nodes: GraphNode[] = [];
    for (const chunk of this._chunks) {
      chunk.nodeMap.forEach(node => {
        nodes.push(...node.getNodes());
      });
    }
    this.initialize(size, this._leafSize);
    for (const node of nodes) {
      this.placeNode(node);
    }
  }
}
