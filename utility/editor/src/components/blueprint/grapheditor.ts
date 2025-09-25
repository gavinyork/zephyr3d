import { ImGui } from '@zephyr3d/imgui';
import { DockPannel, ResizeDirection } from '../dockpanel';
import { PropertyEditor } from '../grid';
import type { GraphEditorApi, NodeCategory } from './api';
import { NodeEditor } from './nodeeditor';

export class GraphEditor implements GraphEditorApi {
  private _rightPanel: DockPannel;
  private _nodePropGrid: PropertyEditor;
  private _nodeEditor: NodeEditor;
  protected _label: string;
  constructor(label: string) {
    this._rightPanel = new DockPannel(0, 0, 300, 0, 8, 200, 400, ResizeDirection.Left);
    this._nodePropGrid = new PropertyEditor(0.4);
    this._nodeEditor = new NodeEditor(this);
    this._label = label ?? 'Graph Editor';
  }
  get nodeEditor() {
    return this._nodeEditor;
  }

  get nodePropEditor() {
    return this._nodePropGrid;
  }

  render() {
    if (this._nodeEditor.selectedNodes.length === 1) {
      const selectedNode = this._nodeEditor.nodes.get(this._nodeEditor.selectedNodes[0]);
      if (selectedNode && selectedNode.impl !== this._nodePropGrid.object) {
        this._nodePropGrid.object = selectedNode.impl;
      }
    } else if (this._nodePropGrid.object) {
      this._nodePropGrid.object = null;
    }

    const regionAvail = ImGui.GetContentRegionAvail();

    const cursorPos = ImGui.GetCursorPos();
    const width = regionAvail.x;
    const height = regionAvail.y;

    this._rightPanel.left = width - this._rightPanel.width;
    this._rightPanel.top = cursorPos.y;
    this._rightPanel.height = height;
    if (this._rightPanel.beginChild('##NodeProperies')) {
      this.renderRightPanel();
    }
    this._rightPanel.endChild();

    ImGui.SetCursorPos(cursorPos);
    const nodeEditorWidth = this._rightPanel.left - cursorPos.x;
    const nodeEditorHeight = height;
    if (nodeEditorWidth > 0 && nodeEditorHeight > 0) {
      ImGui.BeginChild(
        '##NodeEditor',
        new ImGui.ImVec2(nodeEditorWidth, nodeEditorHeight),
        false,
        ImGui.WindowFlags.NoScrollbar | ImGui.WindowFlags.NoScrollWithMouse
      );
      this._nodeEditor.render();
      ImGui.EndChild();
    }
  }
  getNodeCategory(): NodeCategory[] {
    return [];
  }
  isCompatiblePin(_inType: string, _outType: string): boolean {
    return false;
  }
  protected renderRightPanel() {
    this._nodePropGrid.render();
  }
}
