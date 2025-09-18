import { ImGui, imGuiCalcTextSize } from '@zephyr3d/imgui';
import type { NodeEditor } from './nodeeditor';
import type { IGraphNode } from '@zephyr3d/scene';

export type GraphNodeInput = { id: number; name: string; type: string; value?: any };
export type GraphNodeOutput = { id: number; name: string; type: string; value?: any };

const SLOT_HEIGHT = 25;
const NODE_PADDING_BOTTOM = 8;
const NODE_PADDING_LEFT = 8;
const NODE_PADDING_RIGHT = 8;
const NODE_SPACING = 20;
const SLOT_MARGIN = 5;
const SLOT_RADIUS = 6;

export class BaseGraphNode {
  private static _nextId = 1;
  readonly _id: number;
  readonly _position: ImGui.ImVec2;
  private _titleRect: ImGui.ImVec2;
  private _size: ImGui.ImVec2;
  private _selected: boolean;
  private _hovered: boolean;
  private _locked: boolean;
  private _editor: NodeEditor;
  private _impl: IGraphNode;
  constructor(editor: NodeEditor, position: ImGui.ImVec2, impl: IGraphNode) {
    this._id = BaseGraphNode._nextId++;
    this._editor = editor;
    this._impl = impl;
    this._position = new ImGui.ImVec2(position.x, position.y);
    this._selected = false;
    this._hovered = false;
    this._locked = false;
    this._size = null;
    this._impl.on('changed', this.changed, this);
  }
  toString() {
    return this._impl.toString();
  }
  changed() {
    this._size = null;
  }
  get id() {
    return this._id;
  }
  get size() {
    if (!this._size) {
      this.calculateSize();
    }
    return this._size;
  }
  get position() {
    return this._position;
  }
  get inputs() {
    return this._impl.inputs;
  }
  get outputs() {
    return this._impl.outputs;
  }
  get selected() {
    return this._selected;
  }
  set selected(val: boolean) {
    this._selected = val;
  }
  get hovered() {
    return this._hovered;
  }
  set hovered(val: boolean) {
    this._hovered = val;
  }
  get locked() {
    return this._locked;
  }
  set locked(val: boolean) {
    this._locked = val;
  }
  get impl() {
    return this._impl;
  }
  getSlotPosition(slotId: number, isOutput: boolean): ImGui.ImVec2 {
    const slots = isOutput ? this.outputs : this.inputs;
    const slotIndex = slots.findIndex((slot) => slot.id === slotId);

    if (slotIndex === -1) {
      return new ImGui.ImVec2(0, 0);
    }

    const slotY =
      this.position.y + this._titleRect.y + NODE_PADDING_BOTTOM + slotIndex * SLOT_HEIGHT + SLOT_RADIUS;
    const slotX = isOutput
      ? this.position.x + this.size.x - NODE_PADDING_RIGHT - SLOT_MARGIN - SLOT_RADIUS
      : this.position.x + NODE_PADDING_LEFT + SLOT_MARGIN + SLOT_RADIUS;

    return new ImGui.ImVec2(slotX, slotY);
  }
  calculateSize() {
    let maxInputWidth = 0;
    let maxOutputWidth = 0;
    this._titleRect = imGuiCalcTextSize(this.toString());
    this._titleRect.x += 2 * 10;
    this._titleRect.y += 2 * 6;
    for (const input of this.inputs) {
      const size = imGuiCalcTextSize(input.name ?? 'M').x + 2 * (SLOT_RADIUS + SLOT_MARGIN);
      maxInputWidth = Math.max(size, maxInputWidth);
    }
    for (const output of this.outputs) {
      const size = imGuiCalcTextSize(output.name ?? 'M').x + 2 * (SLOT_RADIUS + SLOT_MARGIN);
      maxOutputWidth = Math.max(size, maxOutputWidth);
    }
    const minWidth = Math.max(
      maxInputWidth + maxOutputWidth + NODE_PADDING_LEFT + NODE_PADDING_RIGHT + NODE_SPACING,
      this._titleRect.x
    );
    const minHeight =
      this._titleRect.y +
      NODE_PADDING_BOTTOM * 2 +
      Math.max(this.inputs.length, this.outputs.length) * SLOT_HEIGHT;
    this._size = new ImGui.ImVec2(minWidth, minHeight);
  }
  draw(drawList: ImGui.DrawList, canvasPos: ImGui.ImVec2) {
    const nodeScreenPos = this._editor.worldToCanvas(this.position);
    const nodePos = new ImGui.ImVec2(canvasPos.x + nodeScreenPos.x, canvasPos.y + nodeScreenPos.y);

    const nodeSize = new ImGui.ImVec2(
      this.size.x * this._editor.canvasScale,
      this.size.y * this._editor.canvasScale
    );

    const nodeRounding = 10.0; // 圆角半径
    const borderThickness = 1.0;

    const titleBg = new ImGui.ImVec4(0.4, 0.4, 0.1, 0.95);
    const bodyBg = new ImGui.ImVec4(0.1, 0.1, 0.1, 0.9);

    const titleTextColor = new ImGui.ImVec4(1.0, 1.0, 1.0, 1.0);
    const bodyBorderColor = this.selected
      ? new ImGui.ImVec4(1.0, 1.0, 0.0, 1.0)
      : new ImGui.ImVec4(0.6, 0.6, 0.6, 1.0);

    const nodeRectMin = nodePos;
    const nodeRectMax = new ImGui.ImVec2(nodePos.x + nodeSize.x, nodePos.y + nodeSize.y);

    const titleHeight = this._titleRect.y * this._editor.canvasScale;
    const titleRectMin = nodePos;
    const titleRectMax = new ImGui.ImVec2(nodePos.x + nodeSize.x, nodePos.y + titleHeight);

    drawList.AddRectFilled(nodeRectMin, nodeRectMax, ImGui.ColorConvertFloat4ToU32(bodyBg), nodeRounding, 15);

    drawList.AddRectFilled(
      titleRectMin,
      titleRectMax,
      ImGui.ColorConvertFloat4ToU32(titleBg),
      nodeRounding,
      3
    );

    drawList.AddRect(
      nodeRectMin,
      nodeRectMax,
      ImGui.ColorConvertFloat4ToU32(bodyBorderColor),
      nodeRounding,
      15,
      borderThickness
    );

    const titlePaddingX = 10 * this._editor.canvasScale;
    const titlePaddingY = 6 * this._editor.canvasScale;
    const titlePos = new ImGui.ImVec2(nodePos.x + titlePaddingX, nodePos.y + titlePaddingY);
    drawList.AddText(titlePos, ImGui.ColorConvertFloat4ToU32(titleTextColor), this.toString());

    for (let i = 0; i < this.inputs.length; i++) {
      const input = this.inputs[i];
      const slotPos = this.getSlotPosition(input.id, false);
      const slotScreenPos = this._editor.worldToCanvas(slotPos);
      const slotDrawPos = new ImGui.ImVec2(canvasPos.x + slotScreenPos.x, canvasPos.y + slotScreenPos.y);

      drawList.AddCircleFilled(
        slotDrawPos,
        SLOT_RADIUS * this._editor.canvasScale,
        ImGui.ColorConvertFloat4ToU32(new ImGui.ImVec4(0.4, 0.4, 0.8, 1.0))
      );

      const labelPos = new ImGui.ImVec2(
        slotDrawPos.x + SLOT_MARGIN + SLOT_RADIUS,
        slotDrawPos.y - SLOT_RADIUS
      );
      drawList.AddText(
        labelPos,
        ImGui.ColorConvertFloat4ToU32(new ImGui.ImVec4(0.95, 0.95, 0.98, 1.0)),
        input.name
      );
    }

    for (let i = 0; i < this.outputs.length; i++) {
      const output = this.outputs[i];
      const slotPos = this.getSlotPosition(output.id, true);
      const slotScreenPos = this._editor.worldToCanvas(slotPos);
      const slotDrawPos = new ImGui.ImVec2(canvasPos.x + slotScreenPos.x, canvasPos.y + slotScreenPos.y);

      drawList.AddCircleFilled(
        slotDrawPos,
        SLOT_RADIUS * this._editor.canvasScale,
        ImGui.ColorConvertFloat4ToU32(new ImGui.ImVec4(0.8, 0.4, 0.4, 1.0))
      );

      const textSize = imGuiCalcTextSize(output.name);
      const labelPos = new ImGui.ImVec2(
        slotDrawPos.x - textSize.x - SLOT_RADIUS - SLOT_MARGIN,
        slotDrawPos.y - SLOT_RADIUS
      );
      drawList.AddText(
        labelPos,
        ImGui.ColorConvertFloat4ToU32(new ImGui.ImVec4(0.95, 0.95, 0.98, 1.0)),
        output.name
      );
    }
  }
}
