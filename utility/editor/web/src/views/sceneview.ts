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

export class SceneView extends EmptyView<SceneModel> {
  private _postGizmoRenderer: PostGizmoRenderer;
  private _propGrid: PropertyEditor;
  private _toolbar: ToolBar;
  private _tab: Tab;
  constructor(model: SceneModel) {
    super(model);
    this.drawBackground = false;
    this._postGizmoRenderer = new PostGizmoRenderer(this.model.camera, null);
    this._postGizmoRenderer.mode = 'select';
    this._propGrid = new PropertyEditor(300, 8, 600, 200, 0.4);
    this._toolbar = new ToolBar(0, this.menubar.height, -1, 30, 8, 2, 0, 20);
    this._toolbar.tools.push(
      {
        label: FontGlyph.glyphs['mouse-pointer'],
        id: 'TOOL_SELECT'
      },
      {
        label: FontGlyph.glyphs['move'],
        id: 'TOOL_TRANSLATE'
      },
      {
        label: FontGlyph.glyphs['arrows-cw'],
        id: 'TOOL_ROTATE'
      },
      {
        label: FontGlyph.glyphs['resize-vertical'],
        id: 'TOOL_SCALE'
      }
    );
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
          label: 'Edit',
          subMenus: [
            {
              label: 'Undo',
              shortCut: 'Ctrl+Z',
              id: 'UNDO'
            },
            {
              label: '-'
            },
            {
              label: 'Translate',
              shortCut: 'T',
              id: 'TRANSLATE'
            },
            {
              label: 'Rotate',
              shortCut: 'R',
              id: 'ROTATE'
            },
            {
              label: 'Scale',
              shortCut: 'S',
              id: 'SCALE'
            },
            {
              label: '-'
            },
            {
              label: 'Delete',
              id: 'DELETE'
            },
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
        }
      ]
    };
  }
  render() {
    const displaySize = ImGui.GetIO().DisplaySize;
    const frameHeight = ImGui.GetFrameHeight();
    this.model.camera.viewport = [
      this._tab.width,
      frameHeight,
      displaySize.x - this._tab.width - this._propGrid.width,
      displaySize.y - frameHeight * 2
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
  protected onActivate(): void {
    super.onActivate();
    this.menubar.on('action', this.handleSceneAction, this);
    this._tab.sceneHierarchy.on('node_selected', this.handleNodeSelected, this);
    this._tab.sceneHierarchy.on('node_deselected', this.handleNodeDeselected, this);
    this.model.scene.rootNode.on('noderemoved', this.handleNodeRemoved, this);
    this.model.scene.on('startrender', this.handleStartRender, this);
    this.model.scene.on('endrender', this.handleEndRender, this);
  }
  protected onDeactivate(): void {
    super.onDeactivate();
    this.menubar.off('action', this.handleSceneAction, this);
    this._tab.sceneHierarchy.off('node_selected', this.handleNodeSelected, this);
    this._tab.sceneHierarchy.off('node_deselected', this.handleNodeDeselected, this);
    this.model.scene.rootNode.off('noderemoved', this.handleNodeRemoved, this);
    this.model.scene.off('startrender', this.handleStartRender, this);
    this.model.scene.off('endrender', this.handleEndRender, this);
  }
  private handleNodeRemoved(node: SceneNode) {
    if (this._postGizmoRenderer.node === node) {
      this._postGizmoRenderer.node = null;
    }
  }
  private handleNodeSelected(node: SceneNode) {
    this._postGizmoRenderer.node = node;
  }
  private handleNodeDeselected() {
    this._postGizmoRenderer.node = null;
  }
  private handleSceneAction(action: string) {
    eventBus.dispatchEvent('action', action);
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
