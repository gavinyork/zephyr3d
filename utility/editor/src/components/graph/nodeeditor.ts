import { ImGui, imGuiWantCaptureKeyboard } from '@zephyr3d/imgui';
import { BaseGraphNode } from './node';
import type { GraphEditorApi } from './api';
import type { NodeCategory } from './api';

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
  type: string[] | string;
}

// Adjacency List
interface NodeConnection {
  targetNodeId: number;
  linkId: number;
  startSlotId: number;
  endSlotId: number;
}

interface GraphStructure {
  // Forward Adjacency List: nodeId -> Output links
  outgoing: Map<number, NodeConnection[]>;
  // Backward Adjacency List: nodeId -> Input links
  incoming: Map<number, NodeConnection[]>;
}

// Traversal Result
interface TraversalResult {
  order: number[];
  levels: number[][]; // Node id grouped by level
}

export class NodeEditor {
  private api: GraphEditorApi;
  public nodes: Map<number, BaseGraphNode>;
  private links: GraphLink[];
  private nextLinkId: number;

  private graphStructure: GraphStructure;
  private structureDirty: boolean = true;

  public selectedNodes: number[];
  private draggingNode: number;
  private dragOffset: ImGui.ImVec2;
  private isDraggingCanvas: boolean;
  private isHoveringMenu: boolean;
  private readonly canvasOffset: ImGui.ImVec2;
  public canvasSize: ImGui.ImVec2;
  public canvasScale: number;
  private isCreatingLink: boolean;
  private linkStartSlot: SlotInfo;
  private hoveredSlot: SlotInfo;
  private contextMenuNode: number;
  private showContextMenu: boolean;
  private showGrid: boolean;
  private selectedLinks: Set<number>;
  private selectedSlot: SlotInfo;
  private hoveredLinkId: number;
  private showCanvasContextMenu: boolean;
  private canvasContextClickLocal: ImGui.ImVec2;
  private justOpened: boolean;
  private readonly linkHitRadius: number;
  private readonly linkWidthNormal: number;
  private readonly linkWidthHover: number;
  private readonly linkWidthSelected: number;
  private readonly pinOuterRadius: number;
  private readonly pinHighlightColor: ImGui.ImVec4;
  private readonly pinHoverColor: ImGui.ImVec4;
  private readonly linkSelectedColor: ImGui.ImVec4;
  private readonly linkHoverColor: ImGui.ImVec4;

  constructor(api: GraphEditorApi) {
    this.api = api;
    this.nodes = new Map();
    this.links = [];
    this.nextLinkId = 1;
    this.graphStructure = {
      outgoing: new Map(),
      incoming: new Map()
    };

    this.selectedNodes = [];
    this.draggingNode = null;
    this.dragOffset = new ImGui.ImVec2(0, 0);
    this.isDraggingCanvas = false;
    this.canvasOffset = new ImGui.ImVec2(0, 0);
    this.canvasScale = 1.0;
    this.isCreatingLink = false;
    this.isHoveringMenu = false;
    this.linkStartSlot = null;
    this.hoveredSlot = null;
    this.contextMenuNode = null;
    this.showContextMenu = false;
    this.showGrid = true;
    this.selectedLinks = new Set();
    this.selectedSlot = null;
    this.hoveredLinkId = null;
    this.showCanvasContextMenu = false;
    this.canvasContextClickLocal = new ImGui.ImVec2(0, 0);
    this.justOpened = true;
    this.linkHitRadius = 6;
    this.linkWidthNormal = 2.0;
    this.linkWidthHover = 3.0;
    this.linkWidthSelected = 4.0;
    this.pinOuterRadius = SLOT_RADIUS + 3;
    this.pinHighlightColor = new ImGui.ImVec4(1.0, 0.8, 0.2, 1.0);
    this.pinHoverColor = new ImGui.ImVec4(1.0, 1.0, 1.0, 0.8);
    this.linkSelectedColor = new ImGui.ImVec4(1.0, 0.8, 0.2, 1.0);
    this.linkHoverColor = new ImGui.ImVec4(1.0, 1.0, 1.0, 0.8);
  }

  // Rebuild graph structure
  private rebuildGraphStructure() {
    if (!this.structureDirty) {
      return;
    }

    this.graphStructure.outgoing.clear();
    this.graphStructure.incoming.clear();

    // Initialize adjacency lists
    for (const nodeId of this.nodes.keys()) {
      this.graphStructure.outgoing.set(nodeId, []);
      this.graphStructure.incoming.set(nodeId, []);
    }

    // Fill with links
    for (const link of this.links) {
      const outConnection: NodeConnection = {
        targetNodeId: link.endNodeId,
        linkId: link.id,
        startSlotId: link.startSlotId,
        endSlotId: link.endSlotId
      };

      const inConnection: NodeConnection = {
        targetNodeId: link.startNodeId,
        linkId: link.id,
        startSlotId: link.startSlotId,
        endSlotId: link.endSlotId
      };

      this.graphStructure.outgoing.get(link.startNodeId)?.push(outConnection);
      this.graphStructure.incoming.get(link.endNodeId)?.push(inConnection);
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
      const outgoing = this.graphStructure.outgoing.get(currentId) || [];
      for (const conn of outgoing) {
        if (!visited.has(conn.targetNodeId)) {
          stack.push(conn.targetNodeId);
        }
      }
    }

    return false;
  }

  // Topological sort (Kahn's algorithm)
  public getTopologicalOrder(): TraversalResult {
    this.rebuildGraphStructure();

    const inDegree = new Map<number, number>();
    const result: number[] = [];
    const levels: number[][] = [];

    for (const nodeId of this.nodes.keys()) {
      const incoming = this.graphStructure.incoming.get(nodeId) || [];
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
        const outgoing = this.graphStructure.outgoing.get(nodeId) || [];
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

  // Reverse topological sort (Kahn's algorithm)
  public getReverseTopologicalOrder(): TraversalResult {
    this.rebuildGraphStructure();

    const outDegree = new Map<number, number>();
    const result: number[] = [];
    const levels: number[][] = [];

    for (const nodeId of this.nodes.keys()) {
      const outgoing = this.graphStructure.outgoing.get(nodeId) || [];
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
        const incoming = this.graphStructure.incoming.get(nodeId) || [];
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
    const incoming = this.graphStructure.incoming.get(nodeId) || [];
    return incoming.map((conn) => conn.targetNodeId);
  }

  public getNodeSuccessors(nodeId: number): number[] {
    this.rebuildGraphStructure();
    const outgoing = this.graphStructure.outgoing.get(nodeId) || [];
    return outgoing.map((conn) => conn.targetNodeId);
  }

  public getConnectionsBetween(startNodeId: number, endNodeId: number): GraphLink[] {
    return this.links.filter((link) => link.startNodeId === startNodeId && link.endNodeId === endNodeId);
  }

  public addNode(node: BaseGraphNode) {
    if (!this.nodes.get(node.id)) {
      this.nodes.set(node.id, node);
      this.structureDirty = true;
    }
    return node;
  }

  private deleteNode(nodeId: number) {
    const node = this.nodes.get(nodeId);
    if (!node) {
      console.error('Cannot delete non-exist node');
      return;
    }
    if (node.locked) {
      console.info('Cannot delete locked node');
      return;
    }
    this.links = this.links.filter((link) => link.startNodeId !== nodeId && link.endNodeId !== nodeId);
    this.nodes.delete(nodeId);
    this.selectedNodes = this.selectedNodes.filter((id) => id !== nodeId);
    this.structureDirty = true;
  }

  private findLinkIntoInput(nodeId: number, slotId: number): GraphLink | null {
    return this.links.find((lk) => lk.endNodeId === nodeId && lk.endSlotId === slotId) || null;
  }

  private removeLinksIntoInput(nodeId: number, slotId: number) {
    const toDelete = this.links.filter((lk) => lk.endNodeId === nodeId && lk.endSlotId === slotId);
    if (toDelete.length === 0) {
      return;
    }

    const ids = new Set(toDelete.map((l) => l.id));
    for (const id of ids) {
      this.selectedLinks.delete(id);
    }
    this.links = this.links.filter((lk) => !ids.has(lk.id));
    this.structureDirty = true;
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
      this.selectedLinks.delete(occupied.id);
      this.links = this.links.filter((lk) => lk.id !== occupied.id);
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
    this.structureDirty = true;
    return true;
  }

  private getNodesArray(): BaseGraphNode[] {
    return Array.from(this.nodes.values());
  }

  private hitTestNodeAt(worldPos: ImGui.ImVec2): BaseGraphNode {
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
            isOutput: true,
            type: output.type
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
            isOutput: false,
            type: input.type
          };
        }
      }
    }
    return null;
  }

  private drawGrid(drawList: ImGui.DrawList, canvasPos: ImGui.ImVec2) {
    if (!this.showGrid) return;

    // 屏幕像素中的网格步长（固定像素，不随缩放）
    const stepScreen = 20; // 可改为 this.gridPixelStep
    if (stepScreen < 2) return;

    // 颜色
    const minorCol = ImGui.ColorConvertFloat4ToU32(new ImGui.ImVec4(0.25, 0.25, 0.25, 0.55));
    const majorCol = ImGui.ColorConvertFloat4ToU32(new ImGui.ImVec4(0.35, 0.35, 0.35, 0.85));

    // 每 N 条为主网格
    const majorEvery = 5;

    // 关键：用“世界格子索引”决定主/次
    // 定义一个“世界网格步长”，其单位是世界单位（例如 1.0 表示每个世界单位一格）
    // 因为我们让网格不缩放，只平移，所以用 canvasScale 来将世界格子映射到屏幕像素：
    // worldStep * canvasScale ≈ stepScreen
    // 简便起见，用精确对应：worldStep = stepScreen / canvasScale
    const worldStep = stepScreen / this.canvasScale;

    // 画布左上角对应的世界坐标（用于计算格子索引）
    const worldMin = this.canvasToWorld(new ImGui.ImVec2(0, 0)); // 世界坐标

    // 当前视口覆盖的世界范围（仅用于边界）
    const worldMax = this.canvasToWorld(this.canvasSize);

    // 计算起始/结束的网格索引（世界格子索引）
    const startWorldX = Math.floor(worldMin.x / worldStep);
    const endWorldX = Math.ceil(worldMax.x / worldStep);
    const startWorldY = Math.floor(worldMin.y / worldStep);
    const endWorldY = Math.ceil(worldMax.y / worldStep);

    // 将世界网格线位置映射到屏幕：screen = canvasPos + (world + offset) * scale
    // 你已经定义了 worldToCanvas = (world + canvasOffset) * canvasScale（相对 canvas 内）
    // 因此屏幕坐标 = canvasPos + worldToCanvas(...)
    // 注意：下面我们用 worldIndex * worldStep 计算世界坐标线的位置

    // 纵向网格线（变化 X，画垂直线）
    for (let gx = startWorldX; gx <= endWorldX; gx++) {
      const worldX = gx * worldStep;
      const xCanvas = this.worldToCanvas(new ImGui.ImVec2(worldX, 0)).x; // 相对 canvas 的 X
      const xScreen = canvasPos.x + xCanvas;

      const isMajor = gx % majorEvery === 0; // 基于世界格子索引判断主/次，不会跳
      const col = isMajor ? majorCol : minorCol;

      drawList.AddLine(
        new ImGui.ImVec2(xScreen, canvasPos.y),
        new ImGui.ImVec2(xScreen, canvasPos.y + this.canvasSize.y),
        col
      );
    }

    // 横向网格线（变化 Y，画水平线）
    for (let gy = startWorldY; gy <= endWorldY; gy++) {
      const worldY = gy * worldStep;
      const yCanvas = this.worldToCanvas(new ImGui.ImVec2(0, worldY)).y; // 相对 canvas 的 Y
      if (yCanvas < 0) {
        continue;
      }
      const yScreen = canvasPos.y + yCanvas;

      const isMajor = gy % majorEvery === 0; // 基于世界格子索引判断主/次，不会跳
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

    let color = link.color;
    let width = this.linkWidthNormal;

    const isSelected = this.selectedLinks.has(link.id);
    const isHovered = this.hoveredLinkId === link.id;

    if (isSelected) {
      color = this.linkSelectedColor;
      width = this.linkWidthSelected;
    } else if (isHovered) {
      color = this.linkHoverColor;
      width = this.linkWidthHover;
    }

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
      this.hoveredLinkId = this.getLinkUnderMouse(canvasPos);
    }

    if (isCanvasHovered && ImGui.IsMouseClicked(0)) {
      if (this.hoveredSlot) {
        if (io.KeyAlt) {
          if (this.hoveredSlot.isOutput) {
            const toDelete = this.links.filter(
              (lk) =>
                lk.startNodeId === this.hoveredSlot!.nodeId && lk.startSlotId === this.hoveredSlot!.slotId
            );
            if (toDelete.length > 0) {
              const ids = new Set(toDelete.map((l) => l.id));
              for (const id of ids) this.selectedLinks.delete(id);
              this.links = this.links.filter((lk) => !ids.has(lk.id));
              this.structureDirty = true;
            }
            this.isCreatingLink = false;
            this.linkStartSlot = null;
            this.selectedSlot = this.hoveredSlot;
            this.selectedLinks.clear();
          } else {
            this.removeLinksIntoInput(this.hoveredSlot.nodeId, this.hoveredSlot.slotId);
            this.isCreatingLink = false;
            this.linkStartSlot = null;
            this.selectedSlot = this.hoveredSlot;
            this.selectedLinks.clear();
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
              const inTypes = Array.isArray(this.hoveredSlot.type)
                ? this.hoveredSlot.type
                : [this.hoveredSlot.type];
              if (inTypes.includes(this.linkStartSlot.type as string)) {
                linkok = this.addLink(
                  this.linkStartSlot.nodeId,
                  this.linkStartSlot.slotId,
                  this.hoveredSlot.nodeId,
                  this.hoveredSlot.slotId
                );
              }
            } else {
              const inTypes = Array.isArray(this.linkStartSlot.type)
                ? this.linkStartSlot.type
                : [this.linkStartSlot.type];
              if (inTypes.includes(this.hoveredSlot.type as string)) {
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
            this.selectedSlot = this.hoveredSlot;
            this.isCreatingLink = false;
            this.linkStartSlot = null;
          } else {
            this.selectedSlot = this.hoveredSlot;
            this.isCreatingLink = true;
            this.linkStartSlot = this.hoveredSlot;
          }
          this.selectedLinks.clear();
        }
      } else if (this.hoveredLinkId !== null) {
        if (!io.KeyCtrl) {
          this.selectedLinks.clear();
          this.selectedSlot = null;
        }
        this.selectedLinks.add(this.hoveredLinkId);
        this.isCreatingLink = false;
        this.linkStartSlot = null;
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
            if (!io.KeyCtrl) {
              this.selectedNodes = [];
              this.nodes.forEach((n) => (n.selected = false));
            }
            clickedNode.selected = true;
            if (!this.selectedNodes.includes(clickedNode.id)) {
              this.selectedNodes.push(clickedNode.id);
            }
            this.draggingNode = clickedNode.id;
            this.dragOffset = new ImGui.ImVec2(
              worldMousePos.x - clickedNode.position.x,
              worldMousePos.y - clickedNode.position.y
            );

            const nodeId = clickedNode.id;
            const nodeObj = this.nodes.get(nodeId)!;
            this.nodes.delete(nodeId);
            this.nodes.set(nodeId, nodeObj);
          } else {
            this.selectedLinks.clear();
            this.selectedSlot = null;
            this.selectedNodes = [];
            this.nodes.forEach((n) => (n.selected = false));
            this.isDraggingCanvas = true;
          }

          if (!this.canvasContextClickLocal) {
            this.isCreatingLink = false;
            this.linkStartSlot = null;
          }
        }
      }
    }

    if (isCanvasHovered && ImGui.IsMouseClicked(1)) {
      this.clearInteractionState();

      let rightClickedNode: BaseGraphNode | null = null;
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

    if (ImGui.IsMouseDown(0)) {
      if (isCanvasHovered && !this.draggingNode && !this.isCreatingLink) {
        this.isDraggingCanvas = this.isDraggingCanvas || true;
      }
      if (this.isDraggingCanvas) {
        const mouseDelta = ImGui.GetMouseDragDelta(0);
        this.canvasOffset.x += mouseDelta.x / this.canvasScale;
        this.canvasOffset.y += mouseDelta.y / this.canvasScale;
        ImGui.ResetMouseDragDelta(0);
      } else if (this.draggingNode !== null) {
        const node = this.nodes.get(this.draggingNode);
        if (node) {
          node.position.x = worldMousePos.x - this.dragOffset.x;
          node.position.y = worldMousePos.y - this.dragOffset.y;
        }
      }
    } else {
      this.draggingNode = null;
      this.isDraggingCanvas = false;
    }

    const wheel = io.MouseWheel;
    if (wheel !== 0 && isCanvasHovered) {
      const scaleFactor = wheel > 0 ? 1.1 : 0.9;
      this.canvasScale = Math.max(0.1, Math.min(3.0, this.canvasScale * scaleFactor));
    }

    if (isCanvasFocused && ImGui.IsKeyPressed(ImGui.GetKeyIndex(ImGui.Key.Delete))) {
      if (this.selectedLinks.size > 0) {
        const idsToDelete = new Set(this.selectedLinks);
        this.links = this.links.filter((link) => !idsToDelete.has(link.id));
        this.selectedLinks.clear();
        this.structureDirty = true;
      }
      if (this.selectedNodes.length > 0) {
        for (const nodeId of this.selectedNodes.slice()) {
          this.deleteNode(nodeId);
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

    this.isHoveringMenu = false;
    if (this.showCanvasContextMenu) {
      this.showCanvasContextMenu = false;
      ImGui.OpenPopup('CanvasContextMenu');
    }
    if (this.canvasContextClickLocal && ImGui.BeginPopup('CanvasContextMenu')) {
      this.isHoveringMenu = ImGui.IsWindowHovered();
      let category = this.api.getNodeCategory();
      if (this.linkStartSlot) {
        category = this.linkStartSlot.isOutput
          ? this.filterCategoryOutput(this.linkStartSlot.type as string, category)
          : this.filterCategoryInput(this.linkStartSlot.type, category);
      }
      this.renderCategoryList(category);
      ImGui.EndPopup();
    } else {
      this.canvasContextClickLocal = null;
    }
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
        const node = new BaseGraphNode(this, this.canvasToWorld(this.canvasContextClickLocal), item.create());
        this.addNode(node);
        if (!this.isCreatingLink) {
          this.clearInteractionState();
        }
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

  private filterCategoryOutput(outputPinType: string, category: NodeCategory[]) {
    if (!outputPinType) {
      return category;
    }
    const outCategory: NodeCategory[] = [];
    for (const v of category) {
      const copy: NodeCategory = { ...v };
      copy.children = copy.children ? this.filterCategoryOutput(outputPinType, copy.children) : null;
      if (!v.inTypes || v.inTypes.length === 0 || !v.inTypes.includes(outputPinType)) {
        copy.create = null;
        copy.inTypes = null;
        copy.outTypes = null;
      }
      if (copy.children?.length > 0 || !!copy.create) {
        outCategory.push(copy);
      }
    }
    return outCategory;
  }

  private filterCategoryInput(inputPinType: string[] | string, category: NodeCategory[]) {
    if (!inputPinType) {
      return category;
    }
    const inputTypes = Array.isArray(inputPinType) ? inputPinType : [inputPinType];
    const outCategory: NodeCategory[] = [];
    for (const v of category) {
      const copy: NodeCategory = { ...v };
      copy.children = copy.children ? this.filterCategoryInput(inputPinType, copy.children) : null;
      if (!v.outTypes || v.outTypes.length === 0 || v.outTypes.every((val) => !inputTypes.includes(val))) {
        copy.create = null;
        copy.inTypes = null;
        copy.outTypes = null;
      }
      if (copy.children?.length > 0 || !!copy.create) {
        outCategory.push(copy);
      }
    }
    return outCategory;
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
    this.selectedLinks.clear();
    this.selectedSlot = null;

    this.hoveredSlot = null;
    this.hoveredLinkId = null;

    this.contextMenuNode = null;
    this.showContextMenu = false;
  }

  public render() {
    // 工具栏
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
      this.structureDirty = true;
    }

    ImGui.SameLine();
    const showGrid = [this.showGrid] as [boolean];
    if (ImGui.Checkbox('Show Grid', showGrid)) {
      this.showGrid = showGrid[0];
    }

    // 新增：调试按钮
    ImGui.SameLine();
    if (ImGui.Button('Check DAG')) {
      const topo = this.getTopologicalOrder();
      if (topo) {
        console.log('Graph is a valid DAG');
        console.log('Topological order:', topo.order);
        console.log('Levels:', topo.levels);
      } else {
        console.log('Graph contains cycles!');
      }
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

    drawList.AddRectFilled(
      canvasPos,
      new ImGui.ImVec2(canvasPos.x + this.canvasSize.x, canvasPos.y + this.canvasSize.y),
      ImGui.ColorConvertFloat4ToU32(new ImGui.ImVec4(0.1, 0.1, 0.1, 1.0))
    );

    this.drawGrid(drawList, canvasPos);

    for (const link of this.links) {
      const startNode = this.nodes.get(link.startNodeId);
      const endNode = this.nodes.get(link.endNodeId);
      if (!startNode || !endNode) continue;

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
      const nMin = node.position; // world
      const nMax = new ImGui.ImVec2(node.position.x + node.size.x, node.position.y + node.size.y);
      if (this.rectIntersects(nMin, nMax, viewRect.min, viewRect.max)) {
        node.draw(drawList, canvasPos);
        if (this.hoveredSlot && this.hoveredSlot.nodeId === node.id) {
          this.drawPinHighlight(drawList, canvasPos, this.hoveredSlot, false);
        }
        if (this.selectedSlot && this.selectedSlot.nodeId === node.id) {
          this.drawPinHighlight(drawList, canvasPos, this.selectedSlot, true);
        }
      }
    }
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
    // 控制点（世界坐标）
    const p0 = startWorld;
    const p3 = endWorld;
    const p1 = new ImGui.ImVec2(p0.x + 50, p0.y);
    const p2 = new ImGui.ImVec2(p3.x - 50, p3.y);

    // 粗略包围盒：取四点 min/max，再加一个 padding 用于线宽/命中半径
    const minX = Math.min(p0.x, p1.x, p2.x, p3.x) - padding;
    const minY = Math.min(p0.y, p1.y, p2.y, p3.y) - padding;
    const maxX = Math.max(p0.x, p1.x, p2.x, p3.x) + padding;
    const maxY = Math.max(p0.y, p1.y, p2.y, p3.y) + padding;

    return { min: new ImGui.ImVec2(minX, minY), max: new ImGui.ImVec2(maxX, maxY) };
  }
}
