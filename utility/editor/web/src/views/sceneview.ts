import { ImGui } from '@zephyr3d/imgui';
import type { SceneModel } from '../models/scenemodel';
import { EmptyView } from './emptyview';
import { PostGizmoRenderer } from './gizmo/postgizmo';
import { PropertyEditor } from '../components/grid';
import { Tab } from '../components/tab';
import type { Camera, Compositor, Scene, SceneNode } from '@zephyr3d/scene';
import { Application } from '@zephyr3d/scene';
import { eventBus } from '../core/eventbus';
import { ToolBar } from '../components/toolbar';
import { FontGlyph } from '../core/fontglyph';
import { Matrix4x4, Quaternion, Vector3 } from '@zephyr3d/base';
import { SceneNodeProps } from '../components/nodeprop';
import type { TRS } from '../types';

export class SceneView extends EmptyView<SceneModel> {
  private _postGizmoRenderer: PostGizmoRenderer;
  private _propGrid: PropertyEditor;
  private _toolbar: ToolBar;
  private _tab: Tab;
  private _transformNode: SceneNode;
  private _oldTransform: TRS;
  constructor(model: SceneModel) {
    super(model);
    this._transformNode = null;
    this._oldTransform = null;
    this.drawBackground = false;
    this.dragDropTypes = ['ASSET'];
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
        },
        {
          label: FontGlyph.glyphs['ccw'],
          id: 'UNDO',
          tooltip: 'Undo last change'
        },
        {
          label: FontGlyph.glyphs['cw'],
          id: 'REDO',
          tooltip: 'Redo last change'
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
    this._propGrid = new PropertyEditor(
      this.menubar.height + this._toolbar.height,
      this.statusbar.height,
      300,
      8,
      600,
      200,
      0.4
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
    super.render();
    const displaySize = ImGui.GetIO().DisplaySize;
    const viewportWidth = displaySize.x - this._tab.width - this._propGrid.width;
    const viewportHeight = displaySize.y - this.statusbar.height - this.menubar.height - this._toolbar.height;
    this.model.camera.viewport = [this._tab.width, this.statusbar.height, viewportWidth, viewportHeight];
    this.model.camera.scissor = [this._tab.width, this.statusbar.height, viewportWidth, viewportHeight];
    this.model.camera.aspect = viewportWidth / viewportHeight;
    this.model.camera.render(this.model.scene, this.model.compositor);
    this._tab.render();
    this._propGrid.render();
    this._toolbar.render();
    if (ImGui.Begin('FontTest')) {
      ImGui.Text(FontGlyph.allGlyphs);
    }
    ImGui.End();
  }
  handleEvent(ev: Event, type?: string): boolean {
    if (this.model.camera.handleEvent(ev, type)) {
      return true;
    }
    if (ev instanceof PointerEvent) {
      const cvs = Application.instance.device.canvas;
      const vp = this.model.camera.viewport;
      const vp_x = vp ? vp[0] : 0;
      const vp_y = vp ? cvs.clientHeight - vp[1] - vp[3] : 0;
      const vp_w = vp ? vp[2] : cvs.clientWidth;
      const vp_h = vp ? vp[3] : cvs.clientHeight;
      const x = ev.offsetX - vp_x;
      const y = ev.offsetY - vp_y;
      if (x < 0 || x >= vp_w || y < 0 || y >= vp_h) {
        return false;
      }
      if (this._postGizmoRenderer.handlePointerEvent(ev.type, x, y, ev.button)) {
        return true;
      }
      if (ev.button === 0 && ev.type === 'pointerdown') {
        this.model.camera.pickAsync(x, y).then((pickResult) => {
          this._tab.sceneHierarchy.selectNode(pickResult?.target?.node ?? null);
        });
      }
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
    this._postGizmoRenderer.on('begin_translate', this.handleBeginTransformNode, this);
    this._postGizmoRenderer.on('begin_rotate', this.handleBeginTransformNode, this);
    this._postGizmoRenderer.on('begin_scale', this.handleBeginTransformNode, this);
    this._postGizmoRenderer.on('end_translate', this.handleEndTransformNode, this);
    this._postGizmoRenderer.on('end_rotate', this.handleEndTransformNode, this);
    this._postGizmoRenderer.on('end_scale', this.handleEndTransformNode, this);
    eventBus.on('workspace_drag_drop', this.handleAssetDragDrop, this);
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
    this._postGizmoRenderer.off('begin_translate', this.handleBeginTransformNode, this);
    this._postGizmoRenderer.off('begin_rotate', this.handleBeginTransformNode, this);
    this._postGizmoRenderer.off('begin_scale', this.handleBeginTransformNode, this);
    this._postGizmoRenderer.off('end_translate', this.handleEndTransformNode, this);
    this._postGizmoRenderer.off('end_rotate', this.handleEndTransformNode, this);
    this._postGizmoRenderer.off('end_scale', this.handleEndTransformNode, this);
    eventBus.off('workspace_drag_drop', this.handleAssetDragDrop, this);
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
    if (src.parent !== dst && !src.isParentOf(dst)) {
      const localMatrix = Matrix4x4.invertAffine(dst.worldMatrix).multiplyRight(src.worldMatrix);
      localMatrix.decompose(src.scale, src.rotation, src.position);
      src.parent = dst;
    }
  }
  private handleAssetDragDrop(type: string, asset: unknown) {
    console.log(`Asset drag drop: ${type}`);
  }
  private handleNodeRemoved(node: SceneNode) {
    if (this._postGizmoRenderer.node === node) {
      this._postGizmoRenderer.node = null;
    }
  }
  private handleBeginTransformNode(node: SceneNode) {
    this._transformNode = node;
    this._oldTransform = {
      position: new Vector3(node.position),
      rotation: new Quaternion(node.rotation),
      scale: new Vector3(node.scale)
    };
  }
  private handleEndTransformNode(node: SceneNode) {
    if (node && node === this._transformNode) {
      eventBus.dispatchEvent('node_transform', node, this._oldTransform, {
        position: node.position,
        rotation: node.rotation,
        scale: node.scale
      });
      this._oldTransform = null;
      this._transformNode = null;
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
