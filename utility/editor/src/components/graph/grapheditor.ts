import { ImGui } from '@zephyr3d/imgui';
import { BaseGraphNode } from './node';

const SLOT_RADIUS = 6;

// 连接线类型定义
interface GraphLink {
  id: number;
  startNodeId: number;
  startSlotId: number;
  endNodeId: number;
  endSlotId: number;
  color: ImGui.ImVec4;
}

// 插槽位置信息
interface SlotInfo {
  nodeId: number;
  slotId: number;
  position: ImGui.ImVec2;
  isOutput: boolean;
  type: string;
}

export class GraphEditor {
  private nodes: Map<number, BaseGraphNode> = new Map();
  private links: GraphLink[] = [];
  private nextLinkId = 1;
  private selectedNodes: number[] = [];
  private draggingNode: number | null = null;
  private dragOffset: ImGui.ImVec2 = new ImGui.ImVec2(0, 0);
  private isDraggingCanvas = false;
  private readonly canvasOffset: ImGui.ImVec2 = new ImGui.ImVec2(0, 0);
  public canvasScale = 1.0;
  private isCreatingLink = false;
  private linkStartSlot: SlotInfo | null = null;
  private hoveredSlot: SlotInfo | null = null;
  private contextMenuNode: number | null = null;
  private showContextMenu = false;
  private readonly gridSize = 20;
  private showGrid = true;

  constructor() {
    this.initializeDefaultNodes();
  }

  private initializeDefaultNodes() {
    // 创建一些示例节点
    this.addNode(
      new BaseGraphNode(
        this,
        'Input',
        new ImGui.ImVec2(50, 50),
        [],
        [{ id: 1, name: 'Out', type: 'float' }],
        new ImGui.ImVec4(0.2, 0.8, 0.2, 1.0)
      )
    );

    this.addNode(
      new BaseGraphNode(
        this,
        'Math',
        new ImGui.ImVec2(250, 50),
        [
          { id: 1, name: 'x', type: 'float' },
          { id: 2, name: 'xxxxxxafeidkfeikakk', type: 'float' },
          { id: 3, name: 'Cxxxxx', type: 'float' },
          { id: 4, name: 'D', type: 'float' },
          { id: 5, name: 'E', type: 'float' },
          { id: 6, name: 'F', type: 'float' }
        ],
        [{ id: 1, name: 'Result', type: 'float' }],
        new ImGui.ImVec4(0.8, 0.4, 0.2, 1.0)
      )
    );

    this.addNode(
      new BaseGraphNode(
        this,
        'Output',
        new ImGui.ImVec2(450, 50),
        [{ id: 1, name: 'In', type: 'float' }],
        [],
        new ImGui.ImVec4(0.8, 0.2, 0.2, 1.0)
      )
    );
  }

  private addNode(node: BaseGraphNode) {
    if (!this.nodes.get(node.id)) {
      this.nodes.set(node.id, node);
    }
    return node;
  }

  private deleteNode(nodeId: number) {
    // 删除相关的连接线
    this.links = this.links.filter((link) => link.startNodeId !== nodeId && link.endNodeId !== nodeId);

    // 删除节点
    this.nodes.delete(nodeId);

    // 清除选择
    this.selectedNodes = this.selectedNodes.filter((id) => id !== nodeId);
  }

  private addLink(startNodeId: number, startSlotId: number, endNodeId: number, endSlotId: number) {
    // 检查是否已存在相同的连接
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

  private getSlotAtPosition(pos: ImGui.ImVec2): SlotInfo | null {
    for (const node of this.nodes) {
      // 检查输入插槽
      for (const input of node[1].inputs) {
        const slotPos = node[1].getSlotPosition(input.id, false);
        const distance = Math.sqrt(Math.pow(pos.x - slotPos.x, 2) + Math.pow(pos.y - slotPos.y, 2));
        if (distance <= SLOT_RADIUS + 3) {
          return {
            nodeId: node[1].id,
            slotId: input.id,
            position: slotPos,
            isOutput: false,
            type: input.type
          };
        }
      }

      // 检查输出插槽
      for (const output of node[1].outputs) {
        const slotPos = node[1].getSlotPosition(output.id, true);
        const distance = Math.sqrt(Math.pow(pos.x - slotPos.x, 2) + Math.pow(pos.y - slotPos.y, 2));
        if (distance <= SLOT_RADIUS + 3) {
          return {
            nodeId: node[1].id,
            slotId: output.id,
            position: slotPos,
            isOutput: true,
            type: output.type
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

    // 计算网格起始位置
    const startX = 0; //Math.floor((-this.canvasOffset.x * this.canvasScale) / gridStep) * gridStep;
    const startY = 0; //Math.floor((-this.canvasOffset.y * this.canvasScale) / gridStep) * gridStep;

    // 绘制垂直线
    for (let x = startX; x < canvasSize.x; x += gridStep) {
      if (x >= 0) {
        drawList.AddLine(
          new ImGui.ImVec2(canvasPos.x + x, canvasPos.y),
          new ImGui.ImVec2(canvasPos.x + x, canvasPos.y + canvasSize.y),
          gridColor
        );
      }
    }

    // 绘制水平线
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

    if (!startNode || !endNode) {
      return;
    }

    const startPos = startNode.getSlotPosition(link.startSlotId, true);
    const endPos = endNode.getSlotPosition(link.endSlotId, false);

    const startScreenPos = this.worldToCanvas(startPos);
    const endScreenPos = this.worldToCanvas(endPos);

    const startDrawPos = new ImGui.ImVec2(canvasPos.x + startScreenPos.x, canvasPos.y + startScreenPos.y);
    const endDrawPos = new ImGui.ImVec2(canvasPos.x + endScreenPos.x, canvasPos.y + endScreenPos.y);

    // 绘制贝塞尔曲线
    const cp1 = new ImGui.ImVec2(startDrawPos.x + 50, startDrawPos.y);
    const cp2 = new ImGui.ImVec2(endDrawPos.x - 50, endDrawPos.y);

    drawList.AddBezierCubic(
      startDrawPos,
      cp1,
      cp2,
      endDrawPos,
      ImGui.ColorConvertFloat4ToU32(link.color),
      2.0
    );
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

    // 检查鼠标悬停的插槽
    console.log(worldMousePos.x, worldMousePos.y);
    this.hoveredSlot = this.getSlotAtPosition(worldMousePos);

    // 左键点击
    if (ImGui.IsMouseClicked(0)) {
      if (this.hoveredSlot) {
        if (this.isCreatingLink) {
          // 完成连接
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
          // 开始创建连接
          this.isCreatingLink = true;
          this.linkStartSlot = this.hoveredSlot;
        }
      } else {
        // 检查是否点击了节点
        let clickedNode: BaseGraphNode | null = null;
        for (const node of this.nodes) {
          if (
            worldMousePos.x >= node[1].position.x &&
            worldMousePos.x <= node[1].position.x + node[1].size.x &&
            worldMousePos.y >= node[1].position.y &&
            worldMousePos.y <= node[1].position.y + node[1].size.y
          ) {
            clickedNode = node[1];
            break;
          }
        }

        if (clickedNode) {
          if (!ImGui.GetIO().KeyCtrl) {
            // 清除其他选择
            this.selectedNodes = [];
            this.nodes.forEach((n) => (n.selected = false));
          }

          clickedNode.selected = true;
          this.selectedNodes.push(clickedNode.id);
          this.draggingNode = clickedNode.id;
          this.dragOffset = new ImGui.ImVec2(
            worldMousePos.x - clickedNode.position.x,
            worldMousePos.y - clickedNode.position.y
          );
        } else {
          // 点击空白区域
          this.selectedNodes = [];
          this.nodes.forEach((n) => (n.selected = false));
          this.isDraggingCanvas = true;
        }

        this.isCreatingLink = false;
        this.linkStartSlot = null;
      }
    }

    // 右键点击
    if (ImGui.IsMouseClicked(1)) {
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
      }
    }

    // 拖拽处理
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

    // 释放鼠标
    if (ImGui.IsMouseReleased(0)) {
      this.draggingNode = null;
      this.isDraggingCanvas = false;
    }

    // 鼠标滚轮缩放
    const wheel = ImGui.GetIO().MouseWheel;
    if (wheel !== 0 && isMouseInCanvas) {
      const scaleFactor = wheel > 0 ? 1.1 : 0.9;
      this.canvasScale = Math.max(0.1, Math.min(3.0, this.canvasScale * scaleFactor));
    }
  }

  private drawContextMenu() {
    if (this.showContextMenu) {
      if (ImGui.BeginPopup('NodeContextMenu')) {
        if (this.contextMenuNode !== null) {
          if (ImGui.MenuItem('Delete Node')) {
            this.deleteNode(this.contextMenuNode);
            this.contextMenuNode = null;
          }
        }
        ImGui.EndPopup();
      } else {
        this.showContextMenu = false;
      }
    }

    if (this.showContextMenu && this.contextMenuNode !== null) {
      ImGui.OpenPopup('NodeContextMenu');
    }
  }

  public render() {
    if (ImGui.Begin('Graph Editor')) {
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

      // 画布区域
      const canvasPos = ImGui.GetCursorScreenPos();
      const canvasSize = ImGui.GetContentRegionAvail();
      const drawList = ImGui.GetWindowDrawList();

      // 画布背景
      drawList.AddRectFilled(
        canvasPos,
        new ImGui.ImVec2(canvasPos.x + canvasSize.x, canvasPos.y + canvasSize.y),
        ImGui.ColorConvertFloat4ToU32(new ImGui.ImVec4(0.1, 0.1, 0.1, 1.0))
      );

      // 绘制网格
      this.drawGrid(drawList, canvasPos, canvasSize);

      // 绘制连接线
      for (const link of this.links) {
        this.drawLink(drawList, link, canvasPos);
      }

      // 绘制正在创建的连接线
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

      // 绘制节点
      for (const node of this.nodes) {
        node[1].draw(drawList, canvasPos);
      }

      // 处理输入
      this.handleInput(canvasPos, canvasSize);

      // 不可见按钮用于捕获输入
      ImGui.SetCursorScreenPos(canvasPos);
      ImGui.InvisibleButton('Canvas', canvasSize);

      // 绘制上下文菜单
      this.drawContextMenu();
      /*
      // 状态信息
      ImGui.Text(`Nodes: ${this.nodes.length}, Links: ${this.links.length}`);
      ImGui.Text(
        `Scale: ${this.canvasScale.toFixed(2)}, Offset: (${this.canvasOffset.x.toFixed(
          0
        )}, ${this.canvasOffset.y.toFixed(0)})`
      );
*/
    }
    ImGui.End();
  }
}
