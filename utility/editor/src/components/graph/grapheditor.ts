import { ImGui } from '@zephyr3d/imgui';
import { DockPannel, ResizeDirection } from '../dockpanel';
import { PropertyEditor } from '../grid';
import type { GraphEditorApi, NodeCategory } from './api';
import { NodeEditor } from './nodeeditor';
import { Scene } from '@zephyr3d/scene';

export class GraphEditor implements GraphEditorApi {
  private _rightPanel: DockPannel;
  private _nodePropGrid: PropertyEditor;
  private _nodeEditor: NodeEditor;
  constructor() {
    this._rightPanel = new DockPannel(0, 0, 300, 0, 8, 200, 400, ResizeDirection.Left);
    this._nodePropGrid = new PropertyEditor(0.4);
    this._nodePropGrid.object = new Scene();
    this._nodeEditor = new NodeEditor(this);
  }
  render() {
    if (ImGui.Begin('Graph Editor')) {
      const regionAvail = ImGui.GetContentRegionAvail();

      const cursorPos = ImGui.GetCursorPos();
      const width = regionAvail.x;
      const height = regionAvail.y;

      this._rightPanel.left = width - this._rightPanel.width;
      this._rightPanel.top = cursorPos.y;
      this._rightPanel.height = height;
      if (this._rightPanel.beginChild('##NodeProperies')) {
        this._nodePropGrid.render();
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
    ImGui.End();
  }
  getNodeCategory(): NodeCategory[] {
    return [];
  }
  isCompatiblePin(_inType: string, _outType: string): boolean {
    return false;
  }
}
