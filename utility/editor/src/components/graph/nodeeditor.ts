import { ImGui } from '@zephyr3d/imgui';
import { BaseGraphNode } from './node';
import type { GraphEditor } from './grapheditor';
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
  type: string;
}

export class NodeEditor {
  private graphEditor: GraphEditor;
  private nodes: Map<number, BaseGraphNode>;
  private links: GraphLink[];
  private nextLinkId: number;
  private selectedNodes: number[];
  private draggingNode: number;
  private dragOffset: ImGui.ImVec2;
  private isDraggingCanvas: boolean;
  private readonly canvasOffset: ImGui.ImVec2;
  public canvasScale: number;
  private isCreatingLink: boolean;
  private linkStartSlot: SlotInfo;
  private hoveredSlot: SlotInfo;
  private contextMenuNode: number;
  private showContextMenu: boolean;
  private readonly gridSize: number;
  private showGrid: boolean;
  private selectedLinks: Set<number>;
  private selectedSlot: SlotInfo;
  private hoveredLinkId: number;
  private showCanvasContextMenu: boolean;
  private canvasContextClickPos: ImGui.ImVec2;
  private canvasContextClickLocal: ImGui.ImVec2;
  private readonly linkHitRadius: number;
  private readonly linkWidthNormal: number;
  private readonly linkWidthHover: number;
  private readonly linkWidthSelected: number;
  private readonly pinOuterRadius: number;
  private readonly pinHighlightColor: ImGui.ImVec4;
  private readonly pinHoverColor: ImGui.ImVec4;
  private readonly linkSelectedColor: ImGui.ImVec4;
  private readonly linkHoverColor: ImGui.ImVec4;

  constructor(graphEditor: GraphEditor) {
    this.graphEditor = graphEditor;
    this.nodes = new Map();
    this.links = [];
    this.nextLinkId = 1;
    this.selectedNodes = [];
    this.draggingNode = null;
    this.dragOffset = new ImGui.ImVec2(0, 0);
    this.isDraggingCanvas = false;
    this.canvasOffset = new ImGui.ImVec2(0, 0);
    this.canvasScale = 1.0;
    this.isCreatingLink = false;
    this.linkStartSlot = null;
    this.hoveredSlot = null;
    this.contextMenuNode = null;
    this.showContextMenu = false;
    this.gridSize = 20;
    this.showGrid = true;
    this.selectedLinks = new Set();
    this.selectedSlot = null;
    this.hoveredLinkId = null;
    this.showCanvasContextMenu = false;
    this.canvasContextClickPos = new ImGui.ImVec2(0, 0);
    this.canvasContextClickLocal = new ImGui.ImVec2(0, 0);
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

  private addNode(node: BaseGraphNode) {
    if (!this.nodes.get(node.id)) {
      this.nodes.set(node.id, node);
    }
    return node;
  }

  private deleteNode(nodeId: number) {
    this.links = this.links.filter((link) => link.startNodeId !== nodeId && link.endNodeId !== nodeId);
    this.nodes.delete(nodeId);
    this.selectedNodes = this.selectedNodes.filter((id) => id !== nodeId);
  }

  private findLinkIntoInput(nodeId: number, slotId: number): GraphLink | null {
    return this.links.find((lk) => lk.endNodeId === nodeId && lk.endSlotId === slotId) || null;
  }

  private removeLinksIntoInput(nodeId: number, slotId: number) {
    const toDelete = this.links.filter((lk) => lk.endNodeId === nodeId && lk.endSlotId === slotId);
    if (toDelete.length === 0) return;

    const ids = new Set(toDelete.map((l) => l.id));
    for (const id of ids) this.selectedLinks.delete(id);
    this.links = this.links.filter((lk) => !ids.has(lk.id));
  }

  private addLink(startNodeId: number, startSlotId: number, endNodeId: number, endSlotId: number) {
    const existingLink = this.links.find(
      (link) =>
        link.startNodeId === startNodeId &&
        link.startSlotId === startSlotId &&
        link.endNodeId === endNodeId &&
        link.endSlotId === endSlotId
    );
    if (existingLink) {
      return;
    }

    const occupied = this.findLinkIntoInput(endNodeId, endSlotId);
    if (occupied) {
      this.selectedLinks.delete(occupied.id); // 清理选中状态
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
      if (!startNode || !endNode) continue;

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
    if (c1 <= 0) return Math.hypot(p.x - a.x, p.y - a.y);

    const c2 = vx * vx + vy * vy;
    if (c2 <= c1) return Math.hypot(p.x - b.x, p.y - b.y);

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

  private drawGrid(drawList: ImGui.DrawList, canvasPos: ImGui.ImVec2, canvasSize: ImGui.ImVec2) {
    if (!this.showGrid) {
      return;
    }

    const gridColor = ImGui.ColorConvertFloat4ToU32(new ImGui.ImVec4(0.3, 0.3, 0.3, 0.5));
    const gridStep = this.gridSize * this.canvasScale;

    const startX = 0;
    const startY = 0;

    for (let x = startX; x < canvasSize.x; x += gridStep) {
      if (x >= 0) {
        drawList.AddLine(
          new ImGui.ImVec2(canvasPos.x + x, canvasPos.y),
          new ImGui.ImVec2(canvasPos.x + x, canvasPos.y + canvasSize.y),
          gridColor
        );
      }
    }

    for (let y = startY; y < canvasSize.y; y += gridStep) {
      if (y >= 0) {
        drawList.AddLine(
          new ImGui.ImVec2(canvasPos.x, canvasPos.y + y),
          new ImGui.ImVec2(canvasPos.x + canvasSize.x, canvasPos.y + y),
          gridColor
        );
      }
    }
  }

  private drawLink(drawList: ImGui.DrawList, link: GraphLink, canvasPos: ImGui.ImVec2) {
    const startNode = this.nodes.get(link.startNodeId);
    const endNode = this.nodes.get(link.endNodeId);
    if (!startNode || !endNode) return;

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
    if (ownerIndex < 0) return false;
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
      if (inside) return true;
    }
    return false;
  }

  private handleInput(canvasPos: ImGui.ImVec2, canvasSize: ImGui.ImVec2) {
    const mousePos = ImGui.GetMousePos();
    const relativeMousePos = new ImGui.ImVec2(mousePos.x - canvasPos.x, mousePos.y - canvasPos.y);
    const worldMousePos = this.canvasToWorld(relativeMousePos);

    const isMouseInCanvas =
      mousePos.x >= canvasPos.x &&
      mousePos.x <= canvasPos.x + canvasSize.x &&
      mousePos.y >= canvasPos.y &&
      mousePos.y <= canvasPos.y + canvasSize.y;

    if (!isMouseInCanvas) {
      return;
    }

    let hovered = this.getSlotAtPosition(worldMousePos);
    if (hovered && this.isPinOccludedOnScreen(hovered, canvasPos)) {
      hovered = null;
    }
    this.hoveredSlot = hovered;
    this.hoveredLinkId = this.getLinkUnderMouse(canvasPos);

    if (ImGui.IsMouseClicked(0)) {
      if (this.hoveredSlot) {
        if (ImGui.GetIO().KeyAlt) {
          if (this.hoveredSlot.isOutput) {
            const toDelete = this.links.filter(
              (lk) =>
                lk.startNodeId === this.hoveredSlot!.nodeId && lk.startSlotId === this.hoveredSlot!.slotId
            );
            if (toDelete.length > 0) {
              const ids = new Set(toDelete.map((l) => l.id));
              for (const id of ids) this.selectedLinks.delete(id);
              this.links = this.links.filter((lk) => !ids.has(lk.id));
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
          if (
            this.linkStartSlot &&
            this.linkStartSlot.isOutput !== this.hoveredSlot.isOutput &&
            this.linkStartSlot.nodeId !== this.hoveredSlot.nodeId
          ) {
            if (this.linkStartSlot.isOutput) {
              this.addLink(
                this.linkStartSlot.nodeId,
                this.linkStartSlot.slotId,
                this.hoveredSlot.nodeId,
                this.hoveredSlot.slotId
              );
            } else {
              this.addLink(
                this.hoveredSlot.nodeId,
                this.hoveredSlot.slotId,
                this.linkStartSlot.nodeId,
                this.linkStartSlot.slotId
              );
            }
          }
          this.isCreatingLink = false;
          this.linkStartSlot = null;
        } else {
          if (ImGui.GetIO().KeyCtrl) {
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
        if (!ImGui.GetIO().KeyCtrl) {
          this.selectedLinks.clear();
          this.selectedSlot = null;
        }
        this.selectedLinks.add(this.hoveredLinkId);
        this.isCreatingLink = false;
        this.linkStartSlot = null;
      } else {
        const clickedNode = this.hitTestNodeAt(worldMousePos);
        if (clickedNode) {
          if (!ImGui.GetIO().KeyCtrl) {
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

        this.isCreatingLink = false;
        this.linkStartSlot = null;
      }
    }

    if (ImGui.IsMouseClicked(1)) {
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
        if (hitSlot && this.isPinOccludedOnScreen(hitSlot, canvasPos)) hitSlot = null;

        if (!hitLink && !hitSlot) {
          this.canvasContextClickPos = ImGui.GetMousePos();
          this.canvasContextClickLocal = new ImGui.ImVec2(
            this.canvasContextClickPos.x - canvasPos.x,
            this.canvasContextClickPos.y - canvasPos.y
          );
          this.showCanvasContextMenu = true;
        }
      }
    }

    if (this.draggingNode !== null && ImGui.IsMouseDown(0)) {
      const node = this.nodes.get(this.draggingNode);
      if (node) {
        node.position.x = worldMousePos.x - this.dragOffset.x;
        node.position.y = worldMousePos.y - this.dragOffset.y;
      }
    } else if (this.isDraggingCanvas && ImGui.IsMouseDown(0)) {
      const mouseDelta = ImGui.GetMouseDragDelta(0);
      this.canvasOffset.x += mouseDelta.x / this.canvasScale;
      this.canvasOffset.y += mouseDelta.y / this.canvasScale;
      ImGui.ResetMouseDragDelta(0);
    }

    if (ImGui.IsMouseReleased(0)) {
      this.draggingNode = null;
      this.isDraggingCanvas = false;
    }

    const wheel = ImGui.GetIO().MouseWheel;
    if (wheel !== 0 && isMouseInCanvas) {
      const scaleFactor = wheel > 0 ? 1.1 : 0.9;
      this.canvasScale = Math.max(0.1, Math.min(3.0, this.canvasScale * scaleFactor));
    }

    if (ImGui.IsKeyPressed(ImGui.GetKeyIndex(ImGui.Key.Delete))) {
      if (this.selectedLinks.size > 0) {
        const idsToDelete = new Set(this.selectedLinks);
        this.links = this.links.filter((link) => !idsToDelete.has(link.id));
        this.selectedLinks.clear();
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

    if (this.showCanvasContextMenu) {
      this.showCanvasContextMenu = false;
      ImGui.OpenPopup('CanvasContextMenu');
    }
    if (ImGui.BeginPopup('CanvasContextMenu')) {
      const category = this.graphEditor.getNodeCategory();
      this.renderCategoryList(category);
      ImGui.EndPopup();
    }
  }

  private renderCategoryList(category: NodeCategory[]) {
    for (const item of category) {
      const leaf = !item.children;
      const isOpen = ImGui.TreeNodeEx(item.name, leaf ? ImGui.TreeNodeFlags.Leaf : 0);
      if (leaf && item.create && ImGui.IsItemClicked(ImGui.MouseButton.Left)) {
        const node = item.create(
          this,
          this.canvasToWorld(this.canvasContextClickLocal),
          //this.canvasContextClickLocal,
          new ImGui.ImVec4(Math.random(), Math.random(), Math.random(), 1)
        );
        this.addNode(node);
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
    if (!node) return;
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
      this.addNode(
        new BaseGraphNode(
          this,
          'Input',
          new ImGui.ImVec2(100, 100),
          [],
          [{ id: 1, name: 'Out', type: 'float' }],
          new ImGui.ImVec4(0.2, 0.8, 0.2, 1.0)
        )
      );
    }
    ImGui.SameLine();
    if (ImGui.Button('Add Math Node')) {
      this.addNode(
        new BaseGraphNode(
          this,
          'Math',
          new ImGui.ImVec2(100, 100),
          [
            { id: 1, name: 'A', type: 'float' },
            { id: 2, name: 'B', type: 'float' }
          ],
          [{ id: 1, name: 'Result', type: 'float' }],
          new ImGui.ImVec4(0.8, 0.4, 0.2, 1.0)
        )
      );
    }
    ImGui.SameLine();
    if (ImGui.Button('Clear All')) {
      this.nodes.clear();
      this.links = [];
      this.selectedNodes = [];
    }

    ImGui.SameLine();
    const showGrid = [this.showGrid] as [boolean];
    if (ImGui.Checkbox('Show Grid', showGrid)) {
      this.showGrid = showGrid[0];
    }

    ImGui.Separator();

    const canvasPos = ImGui.GetCursorScreenPos();
    const canvasSize = ImGui.GetContentRegionAvail();
    const drawList = ImGui.GetWindowDrawList();

    drawList.AddRectFilled(
      canvasPos,
      new ImGui.ImVec2(canvasPos.x + canvasSize.x, canvasPos.y + canvasSize.y),
      ImGui.ColorConvertFloat4ToU32(new ImGui.ImVec4(0.1, 0.1, 0.1, 1.0))
    );

    this.drawGrid(drawList, canvasPos, canvasSize);

    for (const link of this.links) {
      this.drawLink(drawList, link, canvasPos);
    }

    if (this.isCreatingLink && this.linkStartSlot) {
      const mousePos = ImGui.GetMousePos();
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
      node.draw(drawList, canvasPos);
      if (this.hoveredSlot && this.hoveredSlot.nodeId === node.id) {
        this.drawPinHighlight(drawList, canvasPos, this.hoveredSlot, false);
      }
      if (this.selectedSlot && this.selectedSlot.nodeId === node.id) {
        this.drawPinHighlight(drawList, canvasPos, this.selectedSlot, true);
      }
    }
    this.handleInput(canvasPos, canvasSize);
    ImGui.SetCursorScreenPos(canvasPos);
    ImGui.InvisibleButton('Canvas', canvasSize);
    this.drawContextMenu();
  }
}
