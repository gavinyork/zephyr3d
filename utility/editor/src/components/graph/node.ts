import { ImGui, imGuiCalcTextSize } from '@zephyr3d/imgui';
import { GraphEditor } from './grapheditor';

export type GraphNodeInput = { id: number; name: string; type: string; value?: any };
export type GraphNodeOutput = { id: number; name: string; type: string; value?: any };

const SLOT_HEIGHT = 25;
const NODE_PADDING_TOP = 30;
const NODE_PADDING_BOTTOM = 8;
const NODE_PADDING_LEFT = 8;
const NODE_PADDING_RIGHT = 8;
const NODE_SPACING = 20;
const SLOT_MARGIN = 5;
const SLOT_RADIUS = 6;

export class BaseGraphNode {
  private static _nextId = 1;
  id: number;
  title: string;
  position: ImGui.ImVec2;
  size: ImGui.ImVec2;
  inputs: GraphNodeInput[];
  outputs: GraphNodeOutput[];
  selected: boolean;
  hovered: boolean;
  color: ImGui.ImVec4;
  editor: GraphEditor;
  constructor(
    editor: GraphEditor,
    title: string,
    position: ImGui.ImVec2,
    inputs: GraphNodeInput[],
    outputs: GraphNodeOutput[],
    color: ImGui.ImVec4
  ) {
    this.id = BaseGraphNode._nextId++;
    this.editor = editor;
    this.title = title;
    this.position = new ImGui.ImVec2(position.x, position.y);
    this.inputs = inputs.slice();
    this.outputs = outputs.slice();
    this.color = new ImGui.ImVec4(color.x, color.y, color.z, color.w);
    this.selected = false;
    this.hovered = false;
    this.size = this.calculateSize();
  }
  getSlotPosition(slotId: number, isOutput: boolean): ImGui.ImVec2 {
    const slots = isOutput ? this.outputs : this.inputs;
    const slotIndex = slots.findIndex((slot) => slot.id === slotId);

    if (slotIndex === -1) {
      return new ImGui.ImVec2(0, 0);
    }

    const slotY = this.position.y + NODE_PADDING_TOP + slotIndex * SLOT_HEIGHT + SLOT_RADIUS;
    const slotX = isOutput
      ? this.position.x + this.size.x - NODE_PADDING_RIGHT - SLOT_MARGIN - SLOT_RADIUS
      : this.position.x + NODE_PADDING_LEFT + SLOT_MARGIN + SLOT_RADIUS;

    return new ImGui.ImVec2(slotX, slotY);
  }
  calculateSize() {
    let maxInputWidth = 0;
    let maxOutputWidth = 0;
    for (const input of this.inputs) {
      const size = imGuiCalcTextSize(input.name ?? 'M').x + 2 * (SLOT_RADIUS + SLOT_MARGIN);
      maxInputWidth = Math.max(size, maxInputWidth);
    }
    for (const output of this.outputs) {
      const size = imGuiCalcTextSize(output.name ?? 'M').x + 2 * (SLOT_RADIUS + SLOT_MARGIN);
      maxOutputWidth = Math.max(size, maxOutputWidth);
    }
    const minWidth = maxInputWidth + maxOutputWidth + NODE_PADDING_LEFT + NODE_PADDING_TOP + NODE_SPACING;
    const minHeight =
      NODE_PADDING_TOP +
      NODE_PADDING_BOTTOM +
      Math.max(this.inputs.length, this.outputs.length) * SLOT_HEIGHT;
    return new ImGui.ImVec2(minWidth, minHeight);
  }
  draw(drawList: ImGui.DrawList, canvasPos: ImGui.ImVec2) {
    const nodeScreenPos = this.editor.worldToCanvas(this.position);
    const nodePos = new ImGui.ImVec2(canvasPos.x + nodeScreenPos.x, canvasPos.y + nodeScreenPos.y);

    const nodeSize = new ImGui.ImVec2(
      this.size.x * this.editor.canvasScale,
      this.size.y * this.editor.canvasScale
    );

    // 节点背景
    const nodeColor = ImGui.ColorConvertFloat4ToU32(
      new ImGui.ImVec4(this.color.x * 0.7, this.color.y * 0.7, this.color.z * 0.7, 1.0)
    );

    drawList.AddRectFilled(
      nodePos,
      new ImGui.ImVec2(nodePos.x + nodeSize.x, nodePos.y + nodeSize.y),
      nodeColor,
      4.0
    );

    // 节点边框
    const borderColor = this.selected
      ? ImGui.ColorConvertFloat4ToU32(new ImGui.ImVec4(1.0, 1.0, 0.0, 1.0))
      : ImGui.ColorConvertFloat4ToU32(new ImGui.ImVec4(0.6, 0.6, 0.6, 1.0));

    drawList.AddRect(
      nodePos,
      new ImGui.ImVec2(nodePos.x + nodeSize.x, nodePos.y + nodeSize.y),
      borderColor,
      4.0,
      0,
      this.selected ? 2.0 : 1.0
    );

    // 节点标题
    const titlePos = new ImGui.ImVec2(nodePos.x + 8, nodePos.y + 4);
    drawList.AddText(
      titlePos,
      ImGui.ColorConvertFloat4ToU32(new ImGui.ImVec4(1.0, 1.0, 1.0, 1.0)),
      this.title
    );

    // 绘制输入插槽
    for (let i = 0; i < this.inputs.length; i++) {
      const input = this.inputs[i];
      const slotPos = this.getSlotPosition(input.id, false);
      const slotScreenPos = this.editor.worldToCanvas(slotPos);
      const slotDrawPos = new ImGui.ImVec2(canvasPos.x + slotScreenPos.x, canvasPos.y + slotScreenPos.y);

      // 插槽圆圈
      drawList.AddCircleFilled(
        slotDrawPos,
        SLOT_RADIUS * this.editor.canvasScale,
        ImGui.ColorConvertFloat4ToU32(new ImGui.ImVec4(0.4, 0.4, 0.8, 1.0))
      );

      // 插槽标签
      const labelPos = new ImGui.ImVec2(
        slotDrawPos.x + SLOT_MARGIN + SLOT_RADIUS,
        slotDrawPos.y - SLOT_RADIUS
      );
      drawList.AddText(
        labelPos,
        ImGui.ColorConvertFloat4ToU32(new ImGui.ImVec4(0.9, 0.9, 0.9, 1.0)),
        input.name
      );
    }

    // 绘制输出插槽
    for (let i = 0; i < this.outputs.length; i++) {
      const output = this.outputs[i];
      const slotPos = this.getSlotPosition(output.id, true);
      const slotScreenPos = this.editor.worldToCanvas(slotPos);
      const slotDrawPos = new ImGui.ImVec2(canvasPos.x + slotScreenPos.x, canvasPos.y + slotScreenPos.y);

      // 插槽圆圈
      drawList.AddCircleFilled(
        slotDrawPos,
        SLOT_RADIUS * this.editor.canvasScale,
        ImGui.ColorConvertFloat4ToU32(new ImGui.ImVec4(0.8, 0.4, 0.4, 1.0))
      );

      // 插槽标签
      const textSize = imGuiCalcTextSize(output.name);
      const labelPos = new ImGui.ImVec2(
        slotDrawPos.x - textSize.x - SLOT_RADIUS - SLOT_MARGIN,
        slotDrawPos.y - SLOT_RADIUS
      );
      drawList.AddText(
        labelPos,
        ImGui.ColorConvertFloat4ToU32(new ImGui.ImVec4(0.9, 0.9, 0.9, 1.0)),
        output.name
      );
    }
  }
}

// 节点类型定义
export interface GraphNode {
  id: number;
  title: string;
  position: ImGui.ImVec2;
  size: ImGui.ImVec2;
  inputs: GraphNodeInput[];
  outputs: GraphNodeOutput[];
  selected: boolean;
  hovered: boolean;
  color: ImGui.ImVec4;
}

export function worldToCanvas(
  worldPos: ImGui.ImVec2,
  canvasOffset: ImGui.ImVec2,
  canvasScale: number
): ImGui.ImVec2 {
  return new ImGui.ImVec2(
    (worldPos.x + canvasOffset.x) * canvasScale,
    (worldPos.y + canvasOffset.y) * canvasScale
  );
}

export function canvasToWorld(
  canvasPos: ImGui.ImVec2,
  canvasOffset: ImGui.ImVec2,
  canvasScale: number
): ImGui.ImVec2 {
  return new ImGui.ImVec2(
    canvasPos.x / canvasScale - canvasOffset.x,
    canvasPos.y / canvasScale - canvasOffset.y
  );
}

export function getSlotPosition(node: GraphNode, slotId: number, isOutput: boolean): ImGui.ImVec2 {
  const slots = isOutput ? node.outputs : node.inputs;
  const slotIndex = slots.findIndex((slot) => slot.id === slotId);

  if (slotIndex === -1) {
    return new ImGui.ImVec2(0, 0);
  }

  const slotY = node.position.y + NODE_PADDING_TOP + slotIndex * SLOT_HEIGHT + SLOT_RADIUS;
  const slotX = isOutput
    ? node.position.x + node.size.x - NODE_PADDING_RIGHT - SLOT_MARGIN - SLOT_RADIUS
    : node.position.x + NODE_PADDING_LEFT + SLOT_MARGIN + SLOT_RADIUS;

  return new ImGui.ImVec2(slotX, slotY);
}

export function drawNode(
  drawList: ImGui.DrawList,
  node: GraphNode,
  canvasOffset: ImGui.ImVec2,
  canvasPos: ImGui.ImVec2,
  canvasScale: number
) {
  const nodeScreenPos = worldToCanvas(node.position, canvasOffset, canvasScale);
  const nodePos = new ImGui.ImVec2(canvasPos.x + nodeScreenPos.x, canvasPos.y + nodeScreenPos.y);

  const nodeSize = new ImGui.ImVec2(node.size.x * canvasScale, node.size.y * canvasScale);

  // 节点背景
  const nodeColor = ImGui.ColorConvertFloat4ToU32(
    new ImGui.ImVec4(node.color.x * 0.7, node.color.y * 0.7, node.color.z * 0.7, 1.0)
  );

  drawList.AddRectFilled(
    nodePos,
    new ImGui.ImVec2(nodePos.x + nodeSize.x, nodePos.y + nodeSize.y),
    nodeColor,
    4.0
  );

  // 节点边框
  const borderColor = node.selected
    ? ImGui.ColorConvertFloat4ToU32(new ImGui.ImVec4(1.0, 1.0, 0.0, 1.0))
    : ImGui.ColorConvertFloat4ToU32(new ImGui.ImVec4(0.6, 0.6, 0.6, 1.0));

  drawList.AddRect(
    nodePos,
    new ImGui.ImVec2(nodePos.x + nodeSize.x, nodePos.y + nodeSize.y),
    borderColor,
    4.0,
    0,
    node.selected ? 2.0 : 1.0
  );

  // 节点标题
  const titlePos = new ImGui.ImVec2(nodePos.x + 8, nodePos.y + 4);
  drawList.AddText(titlePos, ImGui.ColorConvertFloat4ToU32(new ImGui.ImVec4(1.0, 1.0, 1.0, 1.0)), node.title);

  // 绘制输入插槽
  for (let i = 0; i < node.inputs.length; i++) {
    const input = node.inputs[i];
    const slotPos = getSlotPosition(node, input.id, false);
    const slotScreenPos = worldToCanvas(slotPos, canvasOffset, canvasScale);
    const slotDrawPos = new ImGui.ImVec2(canvasPos.x + slotScreenPos.x, canvasPos.y + slotScreenPos.y);

    // 插槽圆圈
    drawList.AddCircleFilled(
      slotDrawPos,
      SLOT_RADIUS * canvasScale,
      ImGui.ColorConvertFloat4ToU32(new ImGui.ImVec4(0.4, 0.4, 0.8, 1.0))
    );

    // 插槽标签
    const labelPos = new ImGui.ImVec2(slotDrawPos.x + SLOT_MARGIN + SLOT_RADIUS, slotDrawPos.y - SLOT_RADIUS);
    drawList.AddText(
      labelPos,
      ImGui.ColorConvertFloat4ToU32(new ImGui.ImVec4(0.9, 0.9, 0.9, 1.0)),
      input.name
    );
  }

  // 绘制输出插槽
  for (let i = 0; i < node.outputs.length; i++) {
    const output = node.outputs[i];
    const slotPos = getSlotPosition(node, output.id, true);
    const slotScreenPos = worldToCanvas(slotPos, canvasOffset, canvasScale);
    const slotDrawPos = new ImGui.ImVec2(canvasPos.x + slotScreenPos.x, canvasPos.y + slotScreenPos.y);

    // 插槽圆圈
    drawList.AddCircleFilled(
      slotDrawPos,
      SLOT_RADIUS * canvasScale,
      ImGui.ColorConvertFloat4ToU32(new ImGui.ImVec4(0.8, 0.4, 0.4, 1.0))
    );

    // 插槽标签
    const textSize = imGuiCalcTextSize(output.name);
    const labelPos = new ImGui.ImVec2(
      slotDrawPos.x - textSize.x - SLOT_RADIUS - SLOT_MARGIN,
      slotDrawPos.y - SLOT_RADIUS
    );
    drawList.AddText(
      labelPos,
      ImGui.ColorConvertFloat4ToU32(new ImGui.ImVec4(0.9, 0.9, 0.9, 1.0)),
      output.name
    );
  }
}
