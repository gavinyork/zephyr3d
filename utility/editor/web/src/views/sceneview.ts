import { ImGui } from '@zephyr3d/imgui';
import { SceneModel } from '../models/scenemodel';
import { EmptyView } from './emptyview';
import { PostGizmoRenderer } from './gizmo/postgizmo';
import { PropertyEditor } from '../components/grid';
import { Tab } from '../components/tab';
import { Camera, Compositor, Scene, SceneNode } from '@zephyr3d/scene';
import { eventBus } from '../core/eventbus';
import { ToolBar } from '../components/toolbar';
import { FontGlyph } from '../core/fontglyph';
import { Matrix4x4 } from '@zephyr3d/base';
import { SceneNodeProps } from '../components/nodeprop';

export class SceneView extends EmptyView<SceneModel> {
  private _postGizmoRenderer: PostGizmoRenderer;
  private _propGrid: PropertyEditor;
  private _toolbar: ToolBar;
  private _tab: Tab;
  constructor(model: SceneModel) {
    super(model);
    this.drawBackground = false;
    this._propGrid = new PropertyEditor(300, 8, 600, 200, 0.4);
    this._toolbar = new ToolBar(
      [
        {
          label: FontGlyph.glyphs['mouse-pointer'],
          id: 'TOOL_SELECT',
          tooltip: 'Select node',
          group: 0
        },
        {
          label: FontGlyph.glyphs['move'],
          id: 'TOOL_TRANSLATE',
          tooltip: 'Move current selected node',
          group: 0
        },
        {
          label: FontGlyph.glyphs['arrows-cw'],
          id: 'TOOL_ROTATE',
          tooltip: 'Rotate current selected node',
          group: 0
        },
        {
          label: FontGlyph.glyphs['resize-vertical'],
          id: 'TOOL_SCALE',
          tooltip: 'Scale current selected node',
          group: 0
        },
        {
          label: '-'
        }
      ],
      0,
      this.menubar.height,
      -1,
      30,
      16,
      16,
      10
    );
    this._postGizmoRenderer = new PostGizmoRenderer(this.model.camera, null);
    this._postGizmoRenderer.mode = 'select';
    this._tab = new Tab(
      this.model.scene,
      true,
      this.menubar.height + this._toolbar.height,
      this.statusbar.height
    );
    this.menubar.options = {
      items: [
        ...this.menubar.options.items,
        {
          label: 'Add',
          subMenus: [
            {
              label: 'Box',
              id: 'ADD_BOX'
            },
            {
              label: 'Sphere',
              id: 'ADD_SPHERE'
            },
            {
              label: 'Plane',
              id: 'ADD_PLANE'
            },
            {
              label: 'Cylinder',
              id: 'ADD_CYLINDER'
            },
            {
              label: 'Torus',
              id: 'ADD_TORUS'
            }
          ]
        }
      ]
    };
  }
  render() {
    const displaySize = ImGui.GetIO().DisplaySize;
    const frameHeight = ImGui.GetFrameHeight();
    this.model.camera.viewport = [
      this._tab.width,
      this.statusbar.height,
      displaySize.x - this._tab.width - this._propGrid.width,
      displaySize.y - this.statusbar.height - this.menubar.height - this._toolbar.height
    ];
    this.model.camera.scissor = [0, frameHeight, displaySize.x, displaySize.y - frameHeight * 2];
    this.model.camera.aspect = this.model.camera.viewport[2] / this.model.camera.viewport[3];
    this.model.camera.render(this.model.scene, this.model.compositor);
    this._tab.render();
    this._propGrid.render();
    this._toolbar.render();
    /*
    if (ImGui.Begin('FontTest')) {
      ImGui.Text(FontGlyph.allGlyphs);
    }
    ImGui.End();
    */
    super.render();
  }
  handleEvent(ev: Event, type?: string): boolean {
    if (!this._postGizmoRenderer.handleEvent(ev, type)) {
      return this.model.camera.handleEvent(ev, type);
    }
    return true;
  }
  protected onActivate(): void {
    super.onActivate();
    this.menubar.on('action', this.handleSceneAction, this);
    this._toolbar.on('action', this.handleSceneAction, this);
    this._tab.sceneHierarchy.on('node_selected', this.handleNodeSelected, this);
    this._tab.sceneHierarchy.on('node_deselected', this.handleNodeDeselected, this);
    this._tab.sceneHierarchy.on('node_drag_drop', this.handleNodeDragDrop, this);
    this.model.scene.rootNode.on('noderemoved', this.handleNodeRemoved, this);
    this.model.scene.on('startrender', this.handleStartRender, this);
    this.model.scene.on('endrender', this.handleEndRender, this);
  }
  protected onDeactivate(): void {
    super.onDeactivate();
    this.menubar.off('action', this.handleSceneAction, this);
    this._toolbar.off('action', this.handleSceneAction, this);
    this._tab.sceneHierarchy.off('node_selected', this.handleNodeSelected, this);
    this._tab.sceneHierarchy.off('node_deselected', this.handleNodeDeselected, this);
    this._tab.sceneHierarchy.off('node_drag_drop', this.handleNodeDragDrop, this);
    this.model.scene.rootNode.off('noderemoved', this.handleNodeRemoved, this);
    this.model.scene.off('startrender', this.handleStartRender, this);
    this.model.scene.off('endrender', this.handleEndRender, this);
  }
  private handleNodeSelected(node: SceneNode) {
    this._postGizmoRenderer.node = node;
    this._propGrid.object = node;
    this._propGrid.clear();
    for (const prop of SceneNodeProps) {
      this._propGrid.addProperty(prop);
    }
  }
  private handleNodeDeselected(node: SceneNode) {
    if (this._postGizmoRenderer.node === node) {
      this._postGizmoRenderer.node = null;
    }
    if (this._propGrid.object === node) {
      this._propGrid.object = null;
      this._propGrid.clear();
    }
  }
  private handleNodeDragDrop(src: SceneNode, dst: SceneNode) {
    const localMatrix = Matrix4x4.invertAffine(dst.worldMatrix).multiplyRight(src.worldMatrix);
    localMatrix.decompose(src.scale, src.rotation, src.position);
    src.parent = dst;
  }
  private handleNodeRemoved(node: SceneNode) {
    if (this._postGizmoRenderer.node === node) {
      this._postGizmoRenderer.node = null;
    }
  }
  private handleSceneAction(action: string) {
    switch (action) {
      case 'TOOL_SELECT':
        this._postGizmoRenderer.mode = 'select';
        break;
      case 'TOOL_TRANSLATE':
        this._postGizmoRenderer.mode = 'translation';
        break;
      case 'TOOL_ROTATE':
        this._postGizmoRenderer.mode = 'rotation';
        break;
      case 'TOOL_SCALE':
        this._postGizmoRenderer.mode = 'scaling';
        break;
      default:
        eventBus.dispatchEvent('action', action);
        break;
    }
  }
  private handleStartRender(scene: Scene, camera: Camera, compositor: Compositor) {
    if (this._postGizmoRenderer && (this._postGizmoRenderer.node || this._postGizmoRenderer.drawGrid)) {
      compositor.appendPostEffect(this._postGizmoRenderer);
    }
  }
  private handleEndRender(scene: Scene, camera: Camera, compositor: Compositor) {
    if ((this._postGizmoRenderer && this._postGizmoRenderer.node) || this._postGizmoRenderer.drawGrid) {
      compositor.removePostEffect(this._postGizmoRenderer);
    }
  }
}
