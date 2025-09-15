import { ImGui } from '@zephyr3d/imgui';
import { DockPannel, ResizeDirection } from '../dockpanel';
import { PropertyEditor } from '../grid';
import type { GraphEditorApi, NodeCategoryList } from './api';
import { NodeEditor } from './nodeeditor';
import { Scene } from '@zephyr3d/scene';

export class GraphEditor implements GraphEditorApi {
  private _category: DockPannel;
  private _nodePropGrid: PropertyEditor;
  private _nodeEditor: NodeEditor;
  constructor() {
    this._category = new DockPannel(0, 0, 120, 0, 8, 100, 300, ResizeDirection.Right);
    this._nodePropGrid = new PropertyEditor(0, 0, 300, 8, 400, 100, 0.4);
    this._nodePropGrid.object = new Scene();
    this._nodeEditor = new NodeEditor();
  }
  render() {
    if (ImGui.Begin('Graph Editor')) {
      const regionAvail = ImGui.GetContentRegionAvail();
      const nodeEditorWidth = regionAvail.x - this._category.width - this._nodePropGrid.width;
      const nodeEditorHeight = regionAvail.y;
      this._category.left = ImGui.GetCursorPosX();
      this._category.top = ImGui.GetCursorPosY();
      this._category.height = regionAvail.y;
      this._category.beginChild('##Category');
      ImGui.Text('Category');
      this._category.endChild();
      this._nodePropGrid.render();
      ImGui.SetCursorPos(
        new ImGui.ImVec2(this._category.width + ImGui.GetStyle().WindowPadding.x, this._category.top)
      );
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
  getNodeCategory(): NodeCategoryList {
    return [];
  }
  getCompatibleNodeTypes(_srcType: string): string[] {
    return [];
  }
  private renderCategory() {}
}
