import { ImGui } from '@zephyr3d/imgui';
import { DockPannel, ResizeDirection } from '../dockpanel';
import { PropertyEditor } from '../grid';
import type { GraphEditorApi, NodeCategory, NodeCategoryList } from './api';
import { NodeEditor } from './nodeeditor';
import { Scene } from '@zephyr3d/scene';

export class GraphEditor implements GraphEditorApi {
  private _leftPanel: DockPannel;
  private _rightPanel: DockPannel;
  private _nodePropGrid: PropertyEditor;
  private _nodeEditor: NodeEditor;
  constructor() {
    this._leftPanel = new DockPannel(0, 0, 120, 0, 8, 100, 300, ResizeDirection.Right);
    this._rightPanel = new DockPannel(0, 0, 300, 0, 8, 200, 400, ResizeDirection.Left);
    this._nodePropGrid = new PropertyEditor(0.4);
    this._nodePropGrid.object = new Scene();
    this._nodeEditor = new NodeEditor();
  }
  render() {
    if (ImGui.Begin('Graph Editor')) {
      const regionAvail = ImGui.GetContentRegionAvail();

      this._leftPanel.left = ImGui.GetCursorPosX();
      this._leftPanel.top = ImGui.GetCursorPosY();
      this._leftPanel.height = regionAvail.y;
      if (this._leftPanel.beginChild('##Category')) {
        ImGui.Text('Category');
      }
      this._leftPanel.endChild();

      this._rightPanel.left = regionAvail.x - this._rightPanel.width;
      this._rightPanel.top = this._leftPanel.top;
      this._rightPanel.height = this._leftPanel.height;
      if (this._rightPanel.beginChild('##NodeProperies')) {
        this._nodePropGrid.render();
      }
      this._rightPanel.endChild();

      ImGui.SetCursorPos(new ImGui.ImVec2(this._leftPanel.width + this._leftPanel.left, this._leftPanel.top));
      const nodeEditorWidth = this._rightPanel.left - this._leftPanel.width - this._leftPanel.left;
      const nodeEditorHeight = regionAvail.y;
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
  private renderCategoryList(category: NodeCategoryList) {
    /*
    if (!('name' in category)) {
      for (const item of category) {
        if (!'name') const leaf = !('children' in item);
        const isOpen = ImGui.TreeNodeEx(item.name, leaf ? ImGui.TreeNodeFlags.Leaf : 0);
        if (leaf && ImGui.IsItemClicked(ImGui.MouseButton.Right)) {
          ImGui.OpenPopup('CategoryNodeContextMenu');
        }
        if (ImGui.BeginPopup('CategoryNodeContextMenu')) {
          ImGui.MenuItem('Add Node');
          ImGui.EndPopup();
        }
        if (isOpen) {
          if (!leaf) {
            for (const child of item.children) {
              this.renderCategoryList(child);
            }
          }
          ImGui.TreePop();
        }
      }
    }
    */
  }
}
