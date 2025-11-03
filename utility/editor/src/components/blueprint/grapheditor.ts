import { ImGui } from '@zephyr3d/imgui';
import { DockPannel, ResizeDirection } from '../dockpanel';
import { PropertyEditor } from '../grid';
import type { GraphEditorApi, NodeCategory } from './api';
import { NodeEditor } from './nodeeditor';
import { Observable } from '@zephyr3d/base';
import type { IGraphNode, PropertyAccessor } from '@zephyr3d/scene';

export class GraphEditor
  extends Observable<{ object_property_changed: [object: object, prop: PropertyAccessor] }>
  implements GraphEditorApi
{
  private _rightPanel: DockPannel;
  private _propGrid: PropertyEditor;
  private _nodeEditor: Record<string, NodeEditor>;
  private _activeTab: string;
  protected _label: string;
  constructor(label: string, tabs: string[]) {
    super();
    this._rightPanel = new DockPannel(0, 0, 300, 0, 8, 200, 400, ResizeDirection.Left);
    this._propGrid = new PropertyEditor(0.4);
    this._nodeEditor = {};
    this._activeTab = tabs[0] ?? '';
    if (tabs) {
      for (const tab of tabs) {
        this._nodeEditor[tab] = new NodeEditor(this);
      }
    }
    this._label = label ?? 'Graph Editor';
    this._propGrid.on('object_property_changed', this.onPropChanged, this);
  }
  getNodeEditor(tab: string) {
    return this._nodeEditor[tab];
  }
  get propEditor() {
    return this._propGrid;
  }
  addTab(label: string) {
    this._nodeEditor[label] = new NodeEditor(this);
    return this._nodeEditor[label];
  }
  render() {
    const editor = this.getNodeEditor(this._activeTab);
    if (editor) {
      if (editor.selectedNodes.length === 1) {
        const selectedNode = editor.nodes.get(editor.selectedNodes[0]);
        if (selectedNode && selectedNode.impl !== this._propGrid.object) {
          this._propGrid.clear();
          this._propGrid.object = selectedNode.impl;
          this.onSelectionChanged(selectedNode.impl);
        }
      } else if (this._propGrid.object) {
        this._propGrid.clear();
        this.onSelectionChanged(null);
      }
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
      this.renderNodeEditor();
      ImGui.EndChild();
    }
  }

  renderNodeEditor() {
    if (ImGui.BeginTabBar('##NodeEditorTab')) {
      for (const tab of Object.keys(this._nodeEditor)) {
        if (ImGui.BeginTabItem(tab)) {
          this._activeTab = tab;
          ImGui.BeginChild(
            `##NodeEditor#${tab}`,
            ImGui.GetContentRegionAvail(),
            false,
            ImGui.WindowFlags.NoScrollbar | ImGui.WindowFlags.NoScrollWithMouse
          );
          this._nodeEditor[tab].render();
          ImGui.EndChild();
          ImGui.EndTabItem();
        }
      }
      ImGui.EndTabBar();
    }
  }
  getNodeCategory(): NodeCategory[] {
    return [];
  }
  isCompatiblePin(_inType: string, _outType: string): boolean {
    return false;
  }
  protected onPropChanged(_obj: object, _prop: PropertyAccessor) {}
  protected onSelectionChanged(_obj: IGraphNode) {}
  protected renderRightPanel() {
    this._propGrid.render();
  }
  protected updateToplevelPropertyEditor(_propEditor: PropertyEditor) {}
}
