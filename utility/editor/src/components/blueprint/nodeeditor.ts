import { ImGui, imGuiWantCaptureKeyboard } from '@zephyr3d/imgui';
import { GNode } from './node';
import type { GraphEditorApi } from './api';
import type { NodeCategory } from './api';
import { ASSERT, Observable } from '@zephyr3d/base';
import type { IGraphNode, GraphStructure, NodeConnection } from '@zephyr3d/scene';
import { getEngine } from '@zephyr3d/scene';

const SLOT_RADIUS = 6;

interface GraphLink {
  id: number;
  startNodeId: number;
  startSlotId: number;
  endNodeId: number;
  endSlotId: number;
  color: ImGui.ImVec4;
}

interface SlotInfo {
  nodeId: number;
  slotId: number;
  position: ImGui.ImVec2;
  isOutput: boolean;
}

// Traversal Result
interface TraversalResult {
  order: number[];
  levels: number[][];
}

export class NodeEditor extends Observable<{ changed: [] }> {
  private api: GraphEditorApi;
  public nodes: Map<number, GNode>;
  private links: GraphLink[];
  private nextLinkId: number;

  private graphStructure: GraphStructure;
  private structureDirty: boolean;

  public selectedNodes: number[];
  private draggingNode: number;
  private isDraggingCanvas: boolean;
  private isHoveringMenu: boolean;
  private canvasOffset: ImGui.ImVec2;
  public canvasSize: ImGui.ImVec2;
  public canvasScale: number;
  private isCreatingLink: boolean;
  private linkStartSlot: SlotInfo;
  private hoveredSlot: SlotInfo;
  private contextMenuNode: number;
  private showContextMenu: boolean;
  private showGrid: boolean;
  private gridSizePx: number;
  private gridCellCount: number;
  private showCanvasContextMenu: boolean;
  private canvasContextClickLocal: ImGui.ImVec2;
  private dragOffsetsForSelection: Map<number, ImGui.ImVec2>;
  private pendingSingleSelectNodeId: number | null;
  private dragStartedOnThisClick: boolean;
  private mouseDownPosWorld: ImGui.ImVec2 | null;
  private justOpened: boolean;
  private nodeSearchBuf: [string];
  private filteredCategory: NodeCategory[];
  private readonly linkHitRadius: number;
  private readonly linkWidthNormal: number;
  private readonly linkWidthSelected: number;
  private readonly pinOuterRadius: number;
  private readonly pinHighlightColor: ImGui.ImVec4;
  private readonly pinHoverColor: ImGui.ImVec4;

  constructor(api: GraphEditorApi) {
    super();
    this.api = api;
    this.nodes = new Map();
    this.links = [];
    this.nextLinkId = 1;
    this.graphStructure = {
      outgoing: {},
      incoming: {}
    };
    this.structureDirty = true;
    this.selectedNodes = [];
    this.draggingNode = null;
    this.isDraggingCanvas = false;
    this.canvasOffset = new ImGui.ImVec2(0, 0);
    this.canvasScale = 1.0;
    this.isCreatingLink = false;
    this.linkStartSlot = null;
    this.isHoveringMenu = false;
    this.hoveredSlot = null;
    this.contextMenuNode = null;
    this.showContextMenu = false;
    this.showGrid = true;
    this.gridSizePx = 10;
    this.gridCellCount = 8;
    this.showCanvasContextMenu = false;
    this.canvasContextClickLocal = new ImGui.ImVec2(0, 0);
    this.dragOffsetsForSelection = new Map();
    this.pendingSingleSelectNodeId = null;
    this.dragStartedOnThisClick = false;
    this.mouseDownPosWorld = null;
    this.justOpened = true;
    this.nodeSearchBuf = [''];
    this.filteredCategory = [];
    this.linkHitRadius = 6;
    this.linkWidthNormal = 2.0;
    this.linkWidthSelected = 4.0;
    this.pinOuterRadius = 7; //SLOT_RADIUS + 3;
    this.pinHighlightColor = new ImGui.ImVec4(1.0, 0.8, 0.2, 1.0);
    this.pinHoverColor = new ImGui.ImVec4(1.0, 1.0, 1.0, 0.8);
  }

  get graph(): GraphStructure {
    this.rebuildGraphStructure();
    return this.graphStructure;
  }

  private invalidateStructure() {
    this.structureDirty = true;
    this.dispatchEvent('changed');
  }

  // Rebuild graph structure
  private rebuildGraphStructure() {
    if (!this.structureDirty) {
      return;
    }

    this.graphStructure.outgoing = {};
    this.graphStructure.incoming = {};

    // Initialize adjacency lists
    for (const nodeId of this.nodes.keys()) {
      this.graphStructure.outgoing[nodeId] = [];
      this.graphStructure.incoming[nodeId] = [];
    }

    // Fill with links
    for (const link of this.links) {
      const outConnection: NodeConnection = {
        targetNodeId: link.endNodeId,
        startSlotId: link.startSlotId,
        endSlotId: link.endSlotId
      };

      const inConnection: NodeConnection = {
        targetNodeId: link.startNodeId,
        startSlotId: link.startSlotId,
        endSlotId: link.endSlotId
      };

      this.graphStructure.outgoing[link.startNodeId]?.push(outConnection);
      this.graphStructure.incoming[link.endNodeId]?.push(inConnection);
    }

    this.structureDirty = false;
  }

  // Test for cycling links
  private wouldCreateCycle(startNodeId: number, endNodeId: number): boolean {
    this.rebuildGraphStructure();

    // Check if startNodeId can be reached from endNodeId by using DFS
    const visited = new Set<number>();
    const stack = [endNodeId];

    while (stack.length > 0) {
      const currentId = stack.pop()!;

      if (currentId === startNodeId) {
        return true; // cycle found
      }

      if (visited.has(currentId)) {
        continue;
      }
      visited.add(currentId);

      // Add successors to stack
      const outgoing = this.graphStructure.outgoing[currentId] || [];
      for (const conn of outgoing) {
        if (!visited.has(conn.targetNodeId)) {
          stack.push(conn.targetNodeId);
        }
      }
    }

    return false;
  }

  private collectReachableForward(roots: number[]): Set<number> {
    this.rebuildGraphStructure();
    const reachable = new Set<number>();
    const q: number[] = [];

    for (const r of roots) {
      if (this.nodes.has(r)) {
        reachable.add(r);
        q.push(r);
      }
    }
    while (q.length > 0) {
      const u = q.shift()!;
      const outs = this.graphStructure.outgoing[u] || [];
      for (const conn of outs) {
        const v = conn.targetNodeId;
        if (!reachable.has(v)) {
          reachable.add(v);
          q.push(v);
        }
      }
    }
    return reachable;
  }

  private collectReachableBackward(roots: number[]): Set<number> {
    this.rebuildGraphStructure();
    const reachable = new Set<number>();
    const q: number[] = [];

    for (const r of roots) {
      if (this.nodes.has(r)) {
        reachable.add(r);
        q.push(r);
      }
    }
    while (q.length > 0) {
      const u = q.shift()!;
      const ins = this.graphStructure.incoming[u] || [];
      for (const conn of ins) {
        const v = conn.targetNodeId; // 前驱
        if (!reachable.has(v)) {
          reachable.add(v);
          q.push(v);
        }
      }
    }
    return reachable;
  }

  public saveState() {
    const nodes = [...this.nodes.values()].map((node) => {
      const impl = getEngine().serializationManager.serializeObject(node.impl);
      return {
        id: node.id,
        position: [node.position.x, node.position.y],
        titleBg: node.titleBg,
        titleTextCol: node.titleTextCol,
        locked: node.locked,
        impl
      };
    });
    const links = this.links.map((link) => ({
      startNodeId: link.startNodeId,
      startSlotId: link.startSlotId,
      endNodeId: link.endNodeId,
      endSlotId: link.endSlotId
    }));
    return {
      nodes,
      links,
      canvasOffset: [this.canvasOffset.x, this.canvasOffset.y],
      canvasScale: this.canvasScale
    };
  }

  public async loadState(state: ReturnType<NodeEditor['saveState']>) {
    // clear interaction states
    this.clearInteractionState();
    // clear nodes
    const nodes = [...this.nodes.values()];
    for (const node of nodes) {
      this.deleteNode(node.id, true);
    }
    // load nodes
    for (const node of state.nodes) {
      const impl = await getEngine().serializationManager.deserializeObject<IGraphNode>(null, node.impl);
      const n = new GNode(this, new ImGui.ImVec2(node.position[0], node.position[1]), impl);
      n.id = node.id;
      n.titleBg = node.titleBg;
      n.titleTextCol = node.titleTextCol;
      n.locked = node.locked;
      this.addNode(n);
    }
    // load links
    for (const link of state.links) {
      this.addLink(link.startNodeId, link.startSlotId, link.endNodeId, link.endSlotId);
    }
    // apply canvas states
    this.canvasOffset.x = state.canvasOffset[0];
    this.canvasOffset.y = state.canvasOffset[1];
    this.canvasScale = state.canvasScale;
  }
  public getTopologicalOrderFromRoots(roots: number[]): TraversalResult | null {
    if (!roots || roots.length === 0) {
      return { order: [], levels: [] };
    }

    this.rebuildGraphStructure();

    const sub = this.collectReachableForward(roots);

    if (sub.size === 0) {
      return { order: [], levels: [] };
    }

    const inDegree = new Map<number, number>();
    for (const id of sub) {
      const incoming = (this.graphStructure.incoming[id] || []).filter((c) => sub.has(c.targetNodeId));
      inDegree.set(id, incoming.length);
    }

    let currentLevel = Array.from(inDegree.entries())
      .filter(([_, deg]) => deg === 0)
      .map(([id]) => id);

    const result: number[] = [];
    const levels: number[][] = [];

    while (currentLevel.length > 0) {
      levels.push([...currentLevel]);
      result.push(...currentLevel);

      const nextLevel: number[] = [];
      for (const u of currentLevel) {
        const outs = this.graphStructure.outgoing[u] || [];
        for (const conn of outs) {
          const v = conn.targetNodeId;
          if (!sub.has(v)) {
            continue;
          }

          const deg = inDegree.get(v)! - 1;
          inDegree.set(v, deg);
          if (deg === 0) {
            nextLevel.push(v);
          }
        }
      }
      currentLevel = nextLevel;
    }

    if (result.length !== sub.size) {
      console.warn('Subgraph contains cycles (from given roots).');
      return null;
    }

    return { order: result, levels };
  }

  public getReverseTopologicalOrderFromRoots(roots: number[]): TraversalResult | null {
    if (!roots || roots.length === 0) {
      return { order: [], levels: [] };
    }

    this.rebuildGraphStructure();

    const sub = this.collectReachableBackward(roots);
    if (sub.size === 0) {
      return { order: [], levels: [] };
    }

    const outDegree = new Map<number, number>();
    for (const id of sub) {
      const outs = (this.graphStructure.outgoing[id] || []).filter((c) => sub.has(c.targetNodeId));
      outDegree.set(id, outs.length);
    }

    let currentLevel = Array.from(outDegree.entries())
      .filter(([, deg]) => deg === 0)
      .map(([id]) => id);

    const result: number[] = [];
    const levels: number[][] = [];

    while (currentLevel.length > 0) {
      levels.push([...currentLevel]);
      result.push(...currentLevel);

      const nextLevel: number[] = [];
      for (const u of currentLevel) {
        const ins = this.graphStructure.incoming[u] || [];
        for (const conn of ins) {
          const v = conn.targetNodeId; // 前驱
          if (!sub.has(v)) {
            continue;
          }

          const deg = outDegree.get(v)! - 1;
          outDegree.set(v, deg);
          if (deg === 0) {
            nextLevel.push(v);
          }
        }
      }
      currentLevel = nextLevel;
    }

    if (result.length !== sub.size) {
      console.warn('Subgraph contains cycles (from given roots).');
      return null;
    }

    return { order: result, levels };
  }

  public getTopologicalOrder(): TraversalResult {
    this.rebuildGraphStructure();

    const inDegree = new Map<number, number>();
    const result: number[] = [];
    const levels: number[][] = [];

    for (const nodeId of this.nodes.keys()) {
      const incoming = this.graphStructure.incoming[nodeId] || [];
      inDegree.set(nodeId, incoming.length);
    }

    let currentLevel = Array.from(inDegree.entries())
      .filter(([_, degree]) => degree === 0)
      .map(([nodeId, _]) => nodeId);

    while (currentLevel.length > 0) {
      levels.push([...currentLevel]);
      result.push(...currentLevel);
      const nextLevel: number[] = [];

      for (const nodeId of currentLevel) {
        const outgoing = this.graphStructure.outgoing[nodeId] || [];
        for (const conn of outgoing) {
          const targetDegree = inDegree.get(conn.targetNodeId)! - 1;
          inDegree.set(conn.targetNodeId, targetDegree);

          if (targetDegree === 0) {
            nextLevel.push(conn.targetNodeId);
          }
        }
      }

      currentLevel = nextLevel;
    }

    if (result.length !== this.nodes.size) {
      return null;
    }

    return { order: result, levels };
  }

  public getReverseTopologicalOrder(): TraversalResult {
    this.rebuildGraphStructure();

    const outDegree = new Map<number, number>();
    const result: number[] = [];
    const levels: number[][] = [];

    for (const nodeId of this.nodes.keys()) {
      const outgoing = this.graphStructure.outgoing[nodeId] || [];
      outDegree.set(nodeId, outgoing.length);
    }

    let currentLevel = Array.from(outDegree.entries())
      .filter(([_, degree]) => degree === 0)
      .map(([nodeId, _]) => nodeId);

    while (currentLevel.length > 0) {
      levels.push([...currentLevel]);
      result.push(...currentLevel);
      const nextLevel: number[] = [];

      for (const nodeId of currentLevel) {
        const incoming = this.graphStructure.incoming[nodeId] || [];
        for (const conn of incoming) {
          const targetDegree = outDegree.get(conn.targetNodeId)! - 1;
          outDegree.set(conn.targetNodeId, targetDegree);

          if (targetDegree === 0) {
            nextLevel.push(conn.targetNodeId);
          }
        }
      }

      currentLevel = nextLevel;
    }

    if (result.length !== this.nodes.size) {
      return null;
    }

    return { order: result, levels };
  }

  public getNodePredecessors(nodeId: number): number[] {
    this.rebuildGraphStructure();
    const incoming = this.graphStructure.incoming[nodeId] || [];
    return incoming.map((conn) => conn.targetNodeId);
  }

  public getNodeSuccessors(nodeId: number): number[] {
    this.rebuildGraphStructure();
    const outgoing = this.graphStructure.outgoing[nodeId] || [];
    return outgoing.map((conn) => conn.targetNodeId);
  }

  public getConnectionsBetween(startNodeId: number, endNodeId: number): GraphLink[] {
    return this.links.filter((link) => link.startNodeId === startNodeId && link.endNodeId === endNodeId);
  }

  public addNode(node: GNode) {
    if (!this.nodes.get(node.id)) {
      this.nodes.set(node.id, node);
      this.invalidateStructure();
    }
    return node;
  }

  private deleteLink(index: number) {
    const link = this.links[index];
    const node = this.nodes.get(link.endNodeId).impl;
    ASSERT(!!node, 'Node not exists');
    const pin = node.inputs.find((pin) => pin.id === link.endSlotId);
    ASSERT(!!pin, 'Pin not exists');
    pin.inputNode = null;
    pin.inputId = null;
    this.links.splice(index, 1);
  }

  private deleteNode(nodeId: number, force = false) {
    const node = this.nodes.get(nodeId);
    if (!node) {
      console.error('Cannot delete non-exist node');
      return;
    }
    if (node.locked && !force) {
      console.info('Cannot delete locked node');
      return;
    }
    for (let i = this.links.length - 1; i >= 0; i--) {
      const link = this.links[i];
      if (link.startNodeId === nodeId || link.endNodeId === nodeId) {
        this.deleteLink(i);
      }
    }
    this.nodes.delete(nodeId);
    this.selectedNodes = this.selectedNodes.filter((id) => id !== nodeId);
    this.invalidateStructure();
  }

  private findLinkIntoInput(nodeId: number, slotId: number): GraphLink | null {
    return this.links.find((lk) => lk.endNodeId === nodeId && lk.endSlotId === slotId) || null;
  }

  private removeLinksIntoInput(nodeId: number, slotId: number) {
    let deleted = 0;
    for (let i = this.links.length - 1; i >= 0; i--) {
      const lk = this.links[i];
      if (lk.endNodeId === nodeId && lk.endSlotId === slotId) {
        this.deleteLink(i);
        deleted++;
      }
    }
    if (deleted) {
      this.invalidateStructure();
    }
  }

  private addLink(startNodeId: number, startSlotId: number, endNodeId: number, endSlotId: number): boolean {
    const existingLink = this.links.find(
      (link) =>
        link.startNodeId === startNodeId &&
        link.startSlotId === startSlotId &&
        link.endNodeId === endNodeId &&
        link.endSlotId === endSlotId
    );
    if (existingLink) {
      return false;
    }

    if (this.wouldCreateCycle(startNodeId, endNodeId)) {
      console.warn(`Cannot create link: would form a cycle between nodes ${startNodeId} and ${endNodeId}`);
      return false;
    }

    const occupied = this.findLinkIntoInput(endNodeId, endSlotId);
    if (occupied) {
      const index = this.links.indexOf(occupied);
      this.deleteLink(index);
    }

    const link: GraphLink = {
      id: this.nextLinkId++,
      startNodeId,
      startSlotId,
      endNodeId,
      endSlotId,
      color: new ImGui.ImVec4(0.9, 0.9, 0.9, 1.0)
    };
    this.links.push(link);
    const inputPin = this.nodes.get(endNodeId).inputs.find((pin) => pin.id === endSlotId);
    ASSERT(!!inputPin, 'Input pin not found');
    inputPin.inputNode = this.nodes.get(startNodeId).impl;
    inputPin.inputId = startSlotId;
    this.invalidateStructure();
    return true;
  }

  private getNodesArray(): GNode[] {
    return Array.from(this.nodes.values());
  }

  private hitTestNodeAt(worldPos: ImGui.ImVec2): GNode {
    const nodesArray = this.getNodesArray();

    for (let i = nodesArray.length - 1; i >= 0; i--) {
      const node = nodesArray[i];

      if (
        worldPos.x >= node.position.x &&
        worldPos.x <= node.position.x + node.size.x &&
        worldPos.y >= node.position.y &&
        worldPos.y <= node.position.y + node.size.y
      ) {
        return node;
      }
    }

    return null;
  }

  private isPointNearBezier(
    p: ImGui.ImVec2,
    p0: ImGui.ImVec2,
    p1: ImGui.ImVec2,
    p2: ImGui.ImVec2,
    p3: ImGui.ImVec2,
    threshold: number
  ): boolean {
    const steps = 24;
    let prev = p0;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const x =
        Math.pow(1 - t, 3) * p0.x +
        3 * Math.pow(1 - t, 2) * t * p1.x +
        3 * (1 - t) * t * t * p2.x +
        t * t * t * p3.x;
      const y =
        Math.pow(1 - t, 3) * p0.y +
        3 * Math.pow(1 - t, 2) * t * p1.y +
        3 * (1 - t) * t * t * p2.y +
        t * t * t * p3.y;

      const cur = new ImGui.ImVec2(x, y);
      if (this.pointToSegmentDistance(p, prev, cur) <= threshold) {
        return true;
      }
      prev = cur;
    }
    return false;
  }

  private getLinkUnderMouse(canvasPos: ImGui.ImVec2): number | null {
    const mousePos = ImGui.GetMousePos();

    for (let i = this.links.length - 1; i >= 0; i--) {
      const link = this.links[i];
      const startNode = this.nodes.get(link.startNodeId);
      const endNode = this.nodes.get(link.endNodeId);
      if (!startNode || !endNode) {
        continue;
      }

      const startPos = this.worldToCanvas(startNode.getSlotPosition(link.startSlotId, true));
      const endPos = this.worldToCanvas(endNode.getSlotPosition(link.endSlotId, false));

      const p0 = new ImGui.ImVec2(canvasPos.x + startPos.x, canvasPos.y + startPos.y);
      const p3 = new ImGui.ImVec2(canvasPos.x + endPos.x, canvasPos.y + endPos.y);
      const p1 = new ImGui.ImVec2(p0.x + 50, p0.y);
      const p2 = new ImGui.ImVec2(p3.x - 50, p3.y);

      if (this.isPointNearBezier(mousePos, p0, p1, p2, p3, this.linkHitRadius)) {
        return link.id;
      }
    }
    return null;
  }

  private pointToSegmentDistance(p: ImGui.ImVec2, a: ImGui.ImVec2, b: ImGui.ImVec2): number {
    const vx = b.x - a.x;
    const vy = b.y - a.y;
    const wx = p.x - a.x;
    const wy = p.y - a.y;

    const c1 = vx * wx + vy * wy;
    if (c1 <= 0) {
      return Math.hypot(p.x - a.x, p.y - a.y);
    }

    const c2 = vx * vx + vy * vy;
    if (c2 <= c1) {
      return Math.hypot(p.x - b.x, p.y - b.y);
    }

    const t = c1 / c2;
    const projx = a.x + t * vx;
    const projy = a.y + t * vy;
    return Math.hypot(p.x - projx, p.y - projy);
  }

  worldToCanvas(worldPos: ImGui.ImVec2): ImGui.ImVec2 {
    return new ImGui.ImVec2(
      (worldPos.x + this.canvasOffset.x) * this.canvasScale,
      (worldPos.y + this.canvasOffset.y) * this.canvasScale
    );
  }

  canvasToWorld(canvasPos: ImGui.ImVec2): ImGui.ImVec2 {
    return new ImGui.ImVec2(
      canvasPos.x / this.canvasScale - this.canvasOffset.x,
      canvasPos.y / this.canvasScale - this.canvasOffset.y
    );
  }

  private getSlotAtPosition(pos: ImGui.ImVec2): SlotInfo {
    const nodesArray = this.getNodesArray();
    for (let i = nodesArray.length - 1; i >= 0; i--) {
      const node = nodesArray[i];

      for (const output of node.outputs) {
        const slotPos = node.getSlotPosition(output.id, true);
        const distance = Math.hypot(pos.x - slotPos.x, pos.y - slotPos.y);
        if (distance <= SLOT_RADIUS + 3) {
          return {
            nodeId: node.id,
            slotId: output.id,
            position: slotPos,
            isOutput: true
          };
        }
      }

      for (const input of node.inputs) {
        const slotPos = node.getSlotPosition(input.id, false);
        const distance = Math.hypot(pos.x - slotPos.x, pos.y - slotPos.y);
        if (distance <= SLOT_RADIUS + 3) {
          return {
            nodeId: node.id,
            slotId: input.id,
            position: slotPos,
            isOutput: false
          };
        }
      }
    }
    return null;
  }

  private drawGrid(drawList: ImGui.DrawList, canvasPos: ImGui.ImVec2) {
    if (!this.showGrid) {
      return;
    }

    if (this.gridSizePx < 2) {
      return;
    }

    const minorCol = ImGui.ColorConvertFloat4ToU32(new ImGui.ImVec4(0.25, 0.25, 0.25, 0.55));
    const majorCol = ImGui.ColorConvertFloat4ToU32(new ImGui.ImVec4(0.35, 0.35, 0.35, 0.85));

    const worldStep = this.gridSizePx / this.canvasScale;
    const worldMin = this.canvasToWorld(new ImGui.ImVec2(0, 0));
    const worldMax = this.canvasToWorld(this.canvasSize);

    const startWorldX = Math.floor(worldMin.x / worldStep);
    const endWorldX = Math.ceil(worldMax.x / worldStep);
    const startWorldY = Math.floor(worldMin.y / worldStep);
    const endWorldY = Math.ceil(worldMax.y / worldStep);

    for (let gx = startWorldX; gx <= endWorldX; gx++) {
      const worldX = gx * worldStep;
      const xCanvas = this.worldToCanvas(new ImGui.ImVec2(worldX, 0)).x;
      const xScreen = canvasPos.x + xCanvas;

      const isMajor = gx % this.gridCellCount === 0;
      const col = isMajor ? majorCol : minorCol;

      drawList.AddLine(
        new ImGui.ImVec2(xScreen, canvasPos.y),
        new ImGui.ImVec2(xScreen, canvasPos.y + this.canvasSize.y),
        col
      );
    }

    for (let gy = startWorldY; gy <= endWorldY; gy++) {
      const worldY = gy * worldStep;
      const yCanvas = this.worldToCanvas(new ImGui.ImVec2(0, worldY)).y;
      if (yCanvas < 0) {
        continue;
      }
      const yScreen = canvasPos.y + yCanvas;

      const isMajor = gy % this.gridCellCount === 0;
      const col = isMajor ? majorCol : minorCol;

      drawList.AddLine(
        new ImGui.ImVec2(canvasPos.x, yScreen),
        new ImGui.ImVec2(canvasPos.x + this.canvasSize.x, yScreen),
        col
      );
    }
  }
  private drawLink(drawList: ImGui.DrawList, link: GraphLink, canvasPos: ImGui.ImVec2) {
    const startNode = this.nodes.get(link.startNodeId);
    const endNode = this.nodes.get(link.endNodeId);
    if (!startNode || !endNode) {
      return;
    }

    const startPos = this.worldToCanvas(startNode.getSlotPosition(link.startSlotId, true));
    const endPos = this.worldToCanvas(endNode.getSlotPosition(link.endSlotId, false));

    const p0 = new ImGui.ImVec2(canvasPos.x + startPos.x, canvasPos.y + startPos.y);
    const p3 = new ImGui.ImVec2(canvasPos.x + endPos.x, canvasPos.y + endPos.y);
    const p1 = new ImGui.ImVec2(p0.x + 50, p0.y);
    const p2 = new ImGui.ImVec2(p3.x - 50, p3.y);

    const color = link.color;
    const width = this.linkWidthNormal;

    drawList.AddBezierCubic(p0, p1, p2, p3, ImGui.ColorConvertFloat4ToU32(color), width);
  }

  private isPinOccludedOnScreen(slot: SlotInfo, canvasPos: ImGui.ImVec2): boolean {
    const nodesArray = this.getNodesArray();
    const ownerIndex = nodesArray.findIndex((n) => n.id === slot.nodeId);
    if (ownerIndex < 0) {
      return false;
    }
    const owner = this.nodes.get(slot.nodeId)!;
    const posWorld = owner.getSlotPosition(slot.slotId, slot.isOutput);
    const posScreen = this.worldToCanvas(posWorld);
    const center = new ImGui.ImVec2(canvasPos.x + posScreen.x, canvasPos.y + posScreen.y);

    for (let i = ownerIndex + 1; i < nodesArray.length; i++) {
      const n = nodesArray[i];
      const minWorld = new ImGui.ImVec2(n.position.x, n.position.y);
      const maxWorld = new ImGui.ImVec2(n.position.x + n.size.x, n.position.y + n.size.y);
      const min = this.worldToCanvas(minWorld);
      const max = this.worldToCanvas(maxWorld);
      const minScreen = new ImGui.ImVec2(canvasPos.x + min.x, canvasPos.y + min.y);
      const maxScreen = new ImGui.ImVec2(canvasPos.x + max.x, canvasPos.y + max.y);
      const inside =
        center.x >= minScreen.x &&
        center.x <= maxScreen.x &&
        center.y >= minScreen.y &&
        center.y <= maxScreen.y;
      if (inside) {
        return true;
      }
    }
    return false;
  }

  private handleInput(canvasPos: ImGui.ImVec2, isCanvasHovered: boolean, isCanvasFocused: boolean) {
    const io = ImGui.GetIO();
    const mousePos = ImGui.GetMousePos();
    const relativeMousePos = new ImGui.ImVec2(mousePos.x - canvasPos.x, mousePos.y - canvasPos.y);
    const worldMousePos = this.canvasToWorld(relativeMousePos);

    const canProcessThisFrame =
      isCanvasHovered || this.isDraggingCanvas || this.draggingNode !== null || this.isCreatingLink;

    if (!canProcessThisFrame) {
      return;
    }

    if (isCanvasHovered) {
      let hovered = this.getSlotAtPosition(worldMousePos);
      if (hovered && this.isPinOccludedOnScreen(hovered, canvasPos)) {
        hovered = null;
      }
      this.hoveredSlot = hovered;
    }

    const hoveredNode = isCanvasHovered ? this.hitTestNodeAt(worldMousePos) : null;
    for (const node of this.nodes.values()) {
      node.hovered = false;
    }
    if (hoveredNode) {
      hoveredNode.hovered = true;
    }

    if (isCanvasHovered && ImGui.IsMouseClicked(0)) {
      if (this.hoveredSlot) {
        if (io.KeyAlt) {
          if (this.hoveredSlot.isOutput) {
            let deleted = 0;
            for (let i = this.links.length - 1; i >= 0; i--) {
              const lk = this.links[i];
              if (
                lk.startNodeId === this.hoveredSlot!.nodeId &&
                lk.startSlotId === this.hoveredSlot!.slotId
              ) {
                this.deleteLink(i);
                deleted++;
              }
            }
            this.isCreatingLink = false;
            this.linkStartSlot = null;
            if (deleted) {
              this.invalidateStructure();
            }
          } else {
            this.removeLinksIntoInput(this.hoveredSlot.nodeId, this.hoveredSlot.slotId);
            this.isCreatingLink = false;
            this.linkStartSlot = null;
          }
          return;
        }

        if (this.isCreatingLink) {
          let linkok = false;
          if (
            this.linkStartSlot &&
            this.linkStartSlot.isOutput !== this.hoveredSlot.isOutput &&
            this.linkStartSlot.nodeId !== this.hoveredSlot.nodeId
          ) {
            if (this.linkStartSlot.isOutput) {
              const inTypes = this.getSlotInputType(this.hoveredSlot);
              const outputType = this.getSlotOutputType(this.linkStartSlot);
              if (!outputType || inTypes.includes(outputType)) {
                linkok = this.addLink(
                  this.linkStartSlot.nodeId,
                  this.linkStartSlot.slotId,
                  this.hoveredSlot.nodeId,
                  this.hoveredSlot.slotId
                );
              }
            } else {
              const inTypes = this.getSlotInputType(this.linkStartSlot);
              const outputType = this.getSlotOutputType(this.hoveredSlot);
              if (!outputType || inTypes.includes(outputType)) {
                linkok = this.addLink(
                  this.hoveredSlot.nodeId,
                  this.hoveredSlot.slotId,
                  this.linkStartSlot.nodeId,
                  this.linkStartSlot.slotId
                );
              }
            }
          }
          if (linkok) {
            this.isCreatingLink = false;
            this.linkStartSlot = null;
          }
        } else {
          if (io.KeyCtrl) {
            this.isCreatingLink = false;
            this.linkStartSlot = null;
          } else {
            this.isCreatingLink = true;
            this.linkStartSlot = this.hoveredSlot;
          }
        }
      } else {
        if (this.isCreatingLink && this.linkStartSlot) {
          if (!this.canvasContextClickLocal) {
            const mpos = ImGui.GetMousePos();
            this.canvasContextClickLocal = new ImGui.ImVec2(mpos.x - canvasPos.x, mpos.y - canvasPos.y);
            this.showCanvasContextMenu = true;
          } else if (!this.isHoveringMenu) {
            this.canvasContextClickLocal = null;
            this.showCanvasContextMenu = false;
            this.isCreatingLink = false;
            this.linkStartSlot = null;
          }
        } else {
          const clickedNode = this.hitTestNodeAt(worldMousePos);
          if (clickedNode) {
            const isAlreadySelected = this.selectedNodes.includes(clickedNode.id);

            this.mouseDownPosWorld = worldMousePos;
            this.dragStartedOnThisClick = false;

            if (io.KeyCtrl) {
              if (!isAlreadySelected) {
                clickedNode.selected = true;
                this.selectedNodes.push(clickedNode.id);
              } else {
                clickedNode.selected = false;
                this.selectedNodes = this.selectedNodes.filter((id) => id !== clickedNode.id);
              }
              this.pendingSingleSelectNodeId = null;
            } else {
              if (!isAlreadySelected) {
                this.selectedNodes = [];
                this.nodes.forEach((n) => (n.selected = false));
                clickedNode.selected = true;
                this.selectedNodes.push(clickedNode.id);
                this.pendingSingleSelectNodeId = null;
              } else {
                this.pendingSingleSelectNodeId = clickedNode.id;
              }
            }

            this.draggingNode = clickedNode.id;

            this.dragOffsetsForSelection.clear();
            for (const id of this.selectedNodes) {
              const n = this.nodes.get(id);
              if (!n) {
                continue;
              }
              this.dragOffsetsForSelection.set(
                id,
                new ImGui.ImVec2(worldMousePos.x - n.position.x, worldMousePos.y - n.position.y)
              );
            }

            const nodeId = clickedNode.id;
            const nodeObj = this.nodes.get(nodeId)!;
            this.nodes.delete(nodeId);
            this.nodes.set(nodeId, nodeObj);
          } else {
            this.selectedNodes = [];
            this.nodes.forEach((n) => (n.selected = false));
            this.isDraggingCanvas = true;

            if (!this.canvasContextClickLocal) {
              this.isCreatingLink = false;
              this.linkStartSlot = null;
            }
          }
        }
      }
    }

    if (ImGui.IsMouseDown(0)) {
      /*
      if (isCanvasHovered && !this.draggingNode && !this.isCreatingLink) {
        this.isDraggingCanvas = this.isDraggingCanvas || true;
      }
      */
      if (this.isDraggingCanvas) {
        const mouseDelta = ImGui.GetMouseDragDelta(0);
        this.canvasOffset.x += mouseDelta.x / this.canvasScale;
        this.canvasOffset.y += mouseDelta.y / this.canvasScale;
        ImGui.ResetMouseDragDelta(0);
      } else if (this.draggingNode !== null) {
        if (!this.dragStartedOnThisClick && this.mouseDownPosWorld) {
          const downScreen = new ImGui.ImVec2(
            (this.mouseDownPosWorld.x + this.canvasOffset.x) * this.canvasScale + canvasPos.x,
            (this.mouseDownPosWorld.y + this.canvasOffset.y) * this.canvasScale + canvasPos.y
          );
          const dx = mousePos.x - downScreen.x;
          const dy = mousePos.y - downScreen.y;
          const dist2 = dx * dx + dy * dy;
          const startDragThresholdPx = 4;
          if (dist2 >= startDragThresholdPx * startDragThresholdPx) {
            this.dragStartedOnThisClick = true;
          }
        }

        if (this.dragStartedOnThisClick) {
          for (const id of this.selectedNodes) {
            const n = this.nodes.get(id);
            const off = this.dragOffsetsForSelection.get(id);
            if (!n || !off) {
              continue;
            }
            const candidate = new ImGui.ImVec2(worldMousePos.x - off.x, worldMousePos.y - off.y);
            const snapped = this.snapWorldToScreenGrid(candidate, this.canvasScale);
            n.position.x = snapped.x;
            n.position.y = snapped.y;
          }
        }
      }
    } else {
      if (!this.dragStartedOnThisClick && this.pendingSingleSelectNodeId !== null) {
        const keepId = this.pendingSingleSelectNodeId;
        this.nodes.forEach((n) => (n.selected = false));
        this.selectedNodes = [keepId];
        const keepNode = this.nodes.get(keepId);
        if (keepNode) {
          keepNode.selected = true;
        }
      }

      this.draggingNode = null;
      this.isDraggingCanvas = false;
      this.dragOffsetsForSelection.clear();
      this.pendingSingleSelectNodeId = null;
      this.dragStartedOnThisClick = false;
      this.mouseDownPosWorld = null;
    }

    const wheel = io.MouseWheel;
    if (wheel !== 0 && isCanvasHovered) {
      const scaleFactor = wheel > 0 ? 1.1 : 0.9;
      this.canvasScale = Math.max(0.1, Math.min(3.0, this.canvasScale * scaleFactor));
    }

    if (isCanvasFocused && ImGui.IsKeyPressed(ImGui.GetKeyIndex(ImGui.Key.Delete))) {
      if (this.selectedNodes.length > 0) {
        for (const nodeId of this.selectedNodes.slice()) {
          this.deleteNode(nodeId);
        }
      }
    }

    if (isCanvasHovered && ImGui.IsMouseClicked(1)) {
      this.clearInteractionState();

      let rightClickedNode: GNode | null = null;
      for (const node of this.nodes) {
        if (
          worldMousePos.x >= node[1].position.x &&
          worldMousePos.x <= node[1].position.x + node[1].size.x &&
          worldMousePos.y >= node[1].position.y &&
          worldMousePos.y <= node[1].position.y + node[1].size.y
        ) {
          rightClickedNode = node[1];
          break;
        }
      }

      if (rightClickedNode) {
        this.contextMenuNode = rightClickedNode.id;
        this.showContextMenu = true;
        rightClickedNode.selected = true;
        this.selectedNodes.push(rightClickedNode.id);
      } else {
        const hitLink = this.getLinkUnderMouse(canvasPos);
        let hitSlot = this.getSlotAtPosition(worldMousePos);
        if (hitSlot && this.isPinOccludedOnScreen(hitSlot, canvasPos)) {
          hitSlot = null;
        }

        if (!hitLink && !hitSlot) {
          const mpos = ImGui.GetMousePos();
          this.canvasContextClickLocal = new ImGui.ImVec2(mpos.x - canvasPos.x, mpos.y - canvasPos.y);
          this.showCanvasContextMenu = true;
        }
      }
    }
  }

  private drawContextMenu() {
    if (this.showContextMenu && !!this.contextMenuNode) {
      this.showContextMenu = false;
      ImGui.OpenPopup('NodeContextMenu');
    }
    if (ImGui.BeginPopup('NodeContextMenu')) {
      if (this.contextMenuNode !== null) {
        if (ImGui.MenuItem('Delete Node')) {
          this.deleteNode(this.contextMenuNode);
          this.contextMenuNode = null;
        }
      }
      ImGui.EndPopup();
    }

    let focusOnSearch = false;
    this.isHoveringMenu = false;
    if (this.showCanvasContextMenu) {
      this.showCanvasContextMenu = false;
      this.filteredCategory = this.api.getNodeCategory();
      focusOnSearch = true;
      ImGui.OpenPopup('CanvasContextMenu');
    }
    if (this.canvasContextClickLocal && ImGui.BeginPopup('CanvasContextMenu')) {
      this.isHoveringMenu = ImGui.IsWindowHovered();
      const maxHeight = 500;
      if (ImGui.BeginChild('##CanvasContextMenuSearch', new ImGui.ImVec2(300, maxHeight), false)) {
        ImGui.SetNextItemWidth(-1);
        if (ImGui.InputTextWithHint('##CanvasContextMenuSearch', 'Search', this.nodeSearchBuf, undefined)) {
          if (this.nodeSearchBuf[0]) {
            this.filteredCategory = this.filterCategory(this.nodeSearchBuf[0], this.api.getNodeCategory());
          } else {
            this.filteredCategory = this.api.getNodeCategory();
          }
        }
        if (focusOnSearch) {
          ImGui.SetKeyboardFocusHere();
        }
        ImGui.Separator();
        if (ImGui.BeginChild('##CanvasContextMenuScrollArea', ImGui.GetContentRegionAvail(), false)) {
          this.renderCategoryList(this.filteredCategory);
        }
        ImGui.EndChild();
      }
      ImGui.EndChild();
      ImGui.EndPopup();
    } else {
      this.canvasContextClickLocal = null;
      this.nodeSearchBuf[0] = '';
    }
  }

  private filterCategory(str: string, category: NodeCategory[]): NodeCategory[] {
    const newCategory: NodeCategory[] = [];
    str = str.toLowerCase();
    for (const k of category) {
      const v = { ...k };
      if (!v.name.toLowerCase().includes(str)) {
        v.create = null;
      }
      if (v.children) {
        v.children = this.filterCategory(str, v.children);
      }
      if (!!v.create || v.children?.length > 0) {
        newCategory.push(v);
      }
    }
    return newCategory;
  }
  private renderCategoryList(category: NodeCategory[]) {
    for (const item of category) {
      const leaf = !item.children;
      let flags = ImGui.TreeNodeFlags.SpanFullWidth;
      if (leaf) {
        flags |= ImGui.TreeNodeFlags.Leaf;
      }
      const isOpen = ImGui.TreeNodeEx(item.name, flags);
      if (leaf && item.create && ImGui.IsItemClicked(ImGui.MouseButton.Left)) {
        const world = this.canvasToWorld(this.canvasContextClickLocal!);
        const snapped = this.snapWorldToScreenGrid(world, this.canvasScale);
        const node = new GNode(this, snapped, item.create());
        this.addNode(node);
        if (this.isCreatingLink && this.linkStartSlot) {
          if (this.linkStartSlot.isOutput) {
            const outputType = this.getSlotOutputType(this.linkStartSlot);
            const inputSlot =
              node.inputs.find((value) => !outputType || value.type?.includes(outputType)) ?? node.inputs[0];
            if (inputSlot) {
              this.addLink(this.linkStartSlot.nodeId, this.linkStartSlot.slotId, node.id, inputSlot.id);
            }
          } else {
            const types = this.getSlotInputType(this.linkStartSlot);
            const outputSlot =
              node.outputs.find((value) => {
                const outputType = node.impl.getOutputType(value.id);
                return !!outputType && types.includes(outputType);
              }) ?? node.outputs[0];
            if (outputSlot) {
              this.addLink(node.id, outputSlot.id, this.linkStartSlot.nodeId, this.linkStartSlot.slotId);
            }
          }
        }
        this.clearInteractionState();
        ImGui.CloseCurrentPopup();
      }
      if (isOpen) {
        if (!leaf) {
          this.renderCategoryList(item.children);
        }
        ImGui.TreePop();
      }
    }
  }

  private drawPinHighlight(
    drawList: ImGui.DrawList,
    canvasPos: ImGui.ImVec2,
    slot: SlotInfo,
    selected: boolean
  ) {
    const node = this.nodes.get(slot.nodeId);
    if (!node) {
      return;
    }
    const posWorld = node.getSlotPosition(slot.slotId, slot.isOutput);
    const posScreen = this.worldToCanvas(posWorld);
    const center = new ImGui.ImVec2(canvasPos.x + posScreen.x, canvasPos.y + posScreen.y);

    const color = selected ? this.pinHighlightColor : this.pinHoverColor;
    const colU32 = ImGui.ColorConvertFloat4ToU32(color);

    drawList.AddCircle(center, this.pinOuterRadius, colU32, 16, 2.0);
  }

  private clearInteractionState() {
    this.isCreatingLink = false;
    this.linkStartSlot = null;
    this.draggingNode = null;
    this.isDraggingCanvas = false;

    this.selectedNodes = [];
    this.nodes.forEach((n) => (n.selected = false));

    this.hoveredSlot = null;

    this.contextMenuNode = null;
    this.showContextMenu = false;

    this.dragOffsetsForSelection.clear();
    this.pendingSingleSelectNodeId = null;
    this.dragStartedOnThisClick = false;
    this.mouseDownPosWorld = null;
  }

  public render() {
    // Toolbar
    if (ImGui.Button('Add Input Node')) {
      console.log('Add Input Node');
    }
    ImGui.SameLine();
    if (ImGui.Button('Add Math Node')) {
      console.log('Add Math Node');
    }
    ImGui.SameLine();
    if (ImGui.Button('Clear All')) {
      this.nodes.clear();
      this.links = [];
      this.selectedNodes = [];
      this.invalidateStructure();
    }

    ImGui.SameLine();
    const showGrid = [this.showGrid] as [boolean];
    if (ImGui.Checkbox('Show Grid', showGrid)) {
      this.showGrid = showGrid[0];
    }

    // For debug
    ImGui.SameLine();
    if (ImGui.Button('Check DAG')) {
      const topo = this.getReverseTopologicalOrderFromRoots([1]);
      if (topo) {
        console.log('Graph is a valid DAG');
        console.log('Topological order:', topo.order);
        console.log('Levels:', topo.levels);
      } else {
        console.log('Graph contains cycles!');
      }
    }
    ImGui.SameLine();
    if (ImGui.Button('Check save')) {
      const state = this.saveState();
      console.log(JSON.stringify(state, null, ' '));
      this.loadState(state);
    }

    ImGui.Separator();

    const canvasPos = ImGui.GetCursorScreenPos();
    this.canvasSize = ImGui.GetContentRegionAvail();
    const drawList = ImGui.GetWindowDrawList();

    const viewMinWorld = this.canvasToWorld(new ImGui.ImVec2(0, 0));
    const viewMaxWorld = this.canvasToWorld(this.canvasSize);
    const viewRect = {
      min: new ImGui.ImVec2(
        Math.min(viewMinWorld.x, viewMaxWorld.x),
        Math.min(viewMinWorld.y, viewMaxWorld.y)
      ),
      max: new ImGui.ImVec2(
        Math.max(viewMinWorld.x, viewMaxWorld.x),
        Math.max(viewMinWorld.y, viewMaxWorld.y)
      )
    };
    drawList.PushClipRect(
      canvasPos,
      new ImGui.ImVec2(canvasPos.x + this.canvasSize.x, canvasPos.y + this.canvasSize.y)
    );

    drawList.AddRectFilled(
      canvasPos,
      new ImGui.ImVec2(canvasPos.x + this.canvasSize.x, canvasPos.y + this.canvasSize.y),
      ImGui.ColorConvertFloat4ToU32(new ImGui.ImVec4(0.1, 0.1, 0.1, 1.0))
    );

    this.drawGrid(drawList, canvasPos);

    for (const link of this.links) {
      const startNode = this.nodes.get(link.startNodeId);
      const endNode = this.nodes.get(link.endNodeId);
      if (!startNode || !endNode) {
        continue;
      }

      const startWorld = startNode.getSlotPosition(link.startSlotId, true);
      const endWorld = endNode.getSlotPosition(link.endSlotId, false);

      const bb = this.getLinkBoundingBox(
        startWorld,
        endWorld,
        Math.max(this.linkHitRadius, this.linkWidthSelected)
      );
      if (this.rectIntersects(bb.min, bb.max, viewRect.min, viewRect.max)) {
        this.drawLink(drawList, link, canvasPos);
      }
    }

    if (this.isCreatingLink && this.linkStartSlot) {
      const mousePos = this.canvasContextClickLocal
        ? new ImGui.ImVec2(
            this.canvasContextClickLocal.x + canvasPos.x,
            this.canvasContextClickLocal.y + canvasPos.y
          )
        : ImGui.GetMousePos();
      const node = this.nodes.get(this.linkStartSlot!.nodeId)!;
      const startPos = node.getSlotPosition(this.linkStartSlot.slotId, this.linkStartSlot.isOutput);
      const startScreenPos = this.worldToCanvas(startPos);
      const startDrawPos = new ImGui.ImVec2(canvasPos.x + startScreenPos.x, canvasPos.y + startScreenPos.y);

      const cp1 = new ImGui.ImVec2(startDrawPos.x + 50, startDrawPos.y);
      const cp2 = new ImGui.ImVec2(mousePos.x - 50, mousePos.y);

      drawList.AddBezierCubic(
        startDrawPos,
        cp1,
        cp2,
        mousePos,
        ImGui.ColorConvertFloat4ToU32(new ImGui.ImVec4(1.0, 1.0, 1.0, 0.5)),
        2.0
      );
    }

    const nodesArrayForDraw = this.getNodesArray();
    for (const node of nodesArrayForDraw) {
      const nMin = node.position;
      const nMax = new ImGui.ImVec2(node.position.x + node.size.x, node.position.y + node.size.y);
      if (this.rectIntersects(nMin, nMax, viewRect.min, viewRect.max)) {
        node.draw(drawList, canvasPos);
        if (this.hoveredSlot && this.hoveredSlot.nodeId === node.id) {
          this.drawPinHighlight(drawList, canvasPos, this.hoveredSlot, false);
        }
        if (this.isCreatingLink && this.linkStartSlot && this.linkStartSlot.nodeId === node.id) {
          this.drawPinHighlight(drawList, canvasPos, this.linkStartSlot, true);
        }
      }
    }
    drawList.PopClipRect();

    ImGui.SetCursorScreenPos(canvasPos);
    ImGui.InvisibleButton('Canvas', this.canvasSize);
    if (this.justOpened) {
      this.justOpened = false;
      ImGui.SetItemDefaultFocus();
    }
    const isCanvasHovered = ImGui.IsItemHovered(
      ImGui.HoveredFlags.AllowWhenBlockedByActiveItem | ImGui.HoveredFlags.AllowWhenBlockedByPopup
    );
    const isCanvasFocused = ImGui.IsItemFocused();
    imGuiWantCaptureKeyboard(isCanvasFocused);
    this.handleInput(canvasPos, isCanvasHovered, isCanvasFocused);
    this.drawContextMenu();
  }
  private rectIntersects(
    aMin: ImGui.ImVec2,
    aMax: ImGui.ImVec2,
    bMin: ImGui.ImVec2,
    bMax: ImGui.ImVec2
  ): boolean {
    return !(aMax.x < bMin.x || aMin.x > bMax.x || aMax.y < bMin.y || aMin.y > bMax.y);
  }

  private getLinkBoundingBox(
    startWorld: ImGui.ImVec2,
    endWorld: ImGui.ImVec2,
    padding = 6
  ): { min: ImGui.ImVec2; max: ImGui.ImVec2 } {
    const p0 = startWorld;
    const p3 = endWorld;
    const p1 = new ImGui.ImVec2(p0.x + 50, p0.y);
    const p2 = new ImGui.ImVec2(p3.x - 50, p3.y);

    const minX = Math.min(p0.x, p1.x, p2.x, p3.x) - padding;
    const minY = Math.min(p0.y, p1.y, p2.y, p3.y) - padding;
    const maxX = Math.max(p0.x, p1.x, p2.x, p3.x) + padding;
    const maxY = Math.max(p0.y, p1.y, p2.y, p3.y) + padding;

    return { min: new ImGui.ImVec2(minX, minY), max: new ImGui.ImVec2(maxX, maxY) };
  }
  private getSlotInputType(slot: SlotInfo) {
    const node = this.nodes.get(slot.nodeId).impl;
    const inTypes = node.inputs.find((pin) => pin.id === slot.slotId)?.type ?? [];
    return Array.isArray(inTypes) ? inTypes : [inTypes];
  }
  private getSlotOutputType(slot: SlotInfo) {
    const node = this.nodes.get(slot.nodeId).impl;
    return node.getOutputType(slot.slotId);
  }
  snapWorldToScreenGrid(pos: ImGui.ImVec2, canvasScale: number): ImGui.ImVec2 {
    const gWorld = this.gridSizePx / Math.max(1e-6, canvasScale);
    return new ImGui.ImVec2(Math.round(pos.x / gWorld) * gWorld, Math.round(pos.y / gWorld) * gWorld);
  }
}
