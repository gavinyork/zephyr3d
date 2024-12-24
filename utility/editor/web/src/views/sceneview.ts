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
  private _dragDropTypes: string[];
  constructor(model: SceneModel) {
    super(model);
    this._transformNode = null;
    this._oldTransform = null;
    this.drawBackground = false;
    this._dragDropTypes = [];
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
    this._tab.render();
    this._propGrid.render();
    this._toolbar.render();
    if (this._dragDropTypes.length > 0) {
      if (viewportWidth > 0 && viewportHeight > 0) {
        this.renderDropZone(
          this._tab.width,
          this.menubar.height + this._toolbar.height,
          viewportWidth,
          viewportHeight
        );
      }
    }
    this.model.camera.viewport = [this._tab.width, this.statusbar.height, viewportWidth, viewportHeight];
    this.model.camera.scissor = [this._tab.width, this.statusbar.height, viewportWidth, viewportHeight];
    this.model.camera.aspect = viewportWidth / viewportHeight;
    this.model.camera.render(this.model.scene, this.model.compositor);
    if (ImGui.Begin('FontTest')) {
      ImGui.Text(FontGlyph.allGlyphs);
    }
    ImGui.End();
  }
  renderDropZone(x: number, y: number, w: number, h: number) {
    const color = new ImGui.ImVec4(0, 0, 0, 0);
    ImGui.PushStyleColor(ImGui.Col.WindowBg, color);
    ImGui.PushStyleVar(ImGui.StyleVar.WindowPadding, new ImGui.ImVec2(0, 0));
    ImGui.PushStyleVar(ImGui.StyleVar.WindowBorderSize, 0);
    ImGui.SetNextWindowPos(new ImGui.ImVec2(x, y));
    ImGui.SetNextWindowSize(new ImGui.ImVec2(w, h));
    ImGui.Begin(
      '##DropZone',
      null,
      ImGui.WindowFlags.NoTitleBar |
        ImGui.WindowFlags.NoBringToFrontOnFocus |
        ImGui.WindowFlags.NoCollapse |
        ImGui.WindowFlags.NoDecoration |
        ImGui.WindowFlags.NoScrollbar |
        ImGui.WindowFlags.NoScrollWithMouse |
        ImGui.WindowFlags.NoMove |
        ImGui.WindowFlags.NoResize
    );
    ImGui.PushStyleColor(ImGui.Col.Header, color);
    ImGui.PushStyleColor(ImGui.Col.HeaderActive, color);
    ImGui.PushStyleColor(ImGui.Col.HeaderHovered, color);
    ImGui.Selectable('##dropzone', false, ImGui.SelectableFlags.Disabled, ImGui.GetContentRegionAvail());
    if (ImGui.BeginDragDropTarget()) {
      for (const type of this._dragDropTypes) {
        const payload = ImGui.AcceptDragDropPayload(type);
        if (payload) {
          const mousePos = ImGui.GetMousePos();
          const pos = [mousePos.x, mousePos.y];
          if (this.posToViewport(pos, this.model.camera.viewport)) {
            eventBus.dispatchEvent('workspace_drag_drop', type, payload.Data, pos[0], pos[1]);
          }
          break;
        }
      }
      ImGui.EndDragDropTarget();
    }
    ImGui.PopStyleColor(3);
    ImGui.End();
    ImGui.PopStyleColor();
    ImGui.PopStyleVar(2);
  }
  handleEvent(ev: Event, type?: string): boolean {
    if (this.model.camera.handleEvent(ev, type)) {
      return true;
    }
    if (ev instanceof PointerEvent) {
      const p = [ev.offsetX, ev.offsetY];
      if (!this.posToViewport(p, this.model.camera.viewport)) {
        return false;
      }
      if (this._postGizmoRenderer.handlePointerEvent(ev.type, p[0], p[1], ev.button)) {
        return true;
      }
      if (ev.button === 0 && ev.type === 'pointerdown') {
        this.model.camera.pickAsync(p[0], p[1]).then((pickResult) => {
          this._tab.sceneHierarchy.selectNode(pickResult?.target?.node ?? null);
        });
      }
    }
    return true;
  }
  private posToViewport(pos: number[], viewport: ArrayLike<number>): boolean {
    const cvs = Application.instance.device.canvas;
    const vp = viewport;
    const vp_x = vp ? vp[0] : 0;
    const vp_y = vp ? cvs.clientHeight - vp[1] - vp[3] : 0;
    const vp_w = vp ? vp[2] : cvs.clientWidth;
    const vp_h = vp ? vp[3] : cvs.clientHeight;
    pos[0] -= vp_x;
    pos[1] -= vp_y;
    return pos[0] >= 0 && pos[0] < vp_w && pos[1] >= 0 && pos[1] < vp_h;
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
    eventBus.on('workspace_drag_start', this.handleNodeDragStart, this);
    eventBus.on('workspace_drag_end', this.handleNodeDragEnd, this);
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
    eventBus.off('workspace_drag_start', this.handleNodeDragStart, this);
    eventBus.off('workspace_drag_end', this.handleNodeDragEnd, this);
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
  private handleNodeDragStart() {
    this._dragDropTypes = ['ASSET'];
  }
  private handleNodeDragEnd() {
    Application.instance.device.nextFrame(() => {
      this._dragDropTypes = [];
    });
  }
  private handleNodeDragDrop(src: SceneNode, dst: SceneNode) {
    if (src.parent !== dst && !src.isParentOf(dst)) {
      const localMatrix = Matrix4x4.invertAffine(dst.worldMatrix).multiplyRight(src.worldMatrix);
      localMatrix.decompose(src.scale, src.rotation, src.position);
      src.parent = dst;
    }
  }
  private handleAssetDragDrop(type: string, asset: unknown, x: number, y: number) {
    console.log(`DragDrop ${type} at (${x}, ${y})`);
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
