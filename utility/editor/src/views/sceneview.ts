import { ImGui } from '@zephyr3d/imgui';
import type { SceneModel } from '../models/scenemodel';
import { PostGizmoRenderer } from './gizmo/postgizmo';
import { PropertyEditor } from '../components/grid';
import { Tab } from '../components/tab';
import type { AssetRegistry, Camera, Compositor, Scene, SceneNode } from '@zephyr3d/scene';
import { Application, DirectionalLight, getSerializationInfo } from '@zephyr3d/scene';
import { eventBus } from '../core/eventbus';
import { ToolBar } from '../components/toolbar';
import { FontGlyph } from '../core/fontglyph';
import { Matrix4x4, Quaternion, Vector3 } from '@zephyr3d/base';
import type { TRS } from '../types';
import type { DBAssetInfo } from '../storage/db';
import { Dialog } from './dlg/dlg';
import { renderTextureViewer } from '../components/textureviewer';
import { MenubarView } from '../components/menubar';
import { StatusBar } from '../components/statusbar';
import { BaseView } from './baseview';

export class SceneView extends BaseView<SceneModel> {
  private _postGizmoRenderer: PostGizmoRenderer;
  private _propGrid: PropertyEditor;
  private _toolbar: ToolBar;
  private _tab: Tab;
  private _menubar: MenubarView;
  private _statusbar: StatusBar;
  private _transformNode: SceneNode;
  private _oldTransform: TRS;
  private _dragDropTypes: string[];
  private _nodeToBePlaced: SceneNode;
  private _mousePosX: number;
  private _mousePosY: number;
  private _assetRegistry: AssetRegistry;
  private _postGizmoCaptured: boolean;
  private _drawTextureViewer: boolean;
  constructor(model: SceneModel, assetRegistry: AssetRegistry) {
    super(model);
    this._transformNode = null;
    this._oldTransform = null;
    this._dragDropTypes = [];
    this._nodeToBePlaced = null;
    this._mousePosX = -1;
    this._mousePosY = -1;
    this._postGizmoCaptured = false;
    this._drawTextureViewer = false;
    this._assetRegistry = assetRegistry;
    this._statusbar = new StatusBar();
    this._menubar = new MenubarView({
      items: [
        {
          label: `File`,
          subMenus: [
            {
              label: 'New',
              shortCut: 'Ctrl+N',
              id: 'NEW_DOC'
            },
            {
              label: 'Open',
              shortCut: 'Ctrl+O',
              id: 'OPEN_DOC'
            },
            {
              label: 'Save',
              shortCut: 'Ctrl+S',
              id: 'SAVE_DOC'
            }
          ]
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
            },
            {
              label: '-'
            },
            {
              label: 'ParticleSystem',
              id: 'ADD_PARTICLE_SYSTEM'
            }
          ]
        },
        {
          label: 'Tools',
          subMenus: [
            {
              label: 'Texture viewer',
              id: 'SHOW_TEXTURE_VIEWER',
              checked: this._drawTextureViewer
            }
          ]
        }
      ]
    });
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
          shortcut: 'Ctrl+Z',
          id: 'UNDO',
          tooltip: 'Undo last change'
        },
        {
          label: FontGlyph.glyphs['cw'],
          shortcut: 'Ctrl+Shift+Z',
          id: 'REDO',
          tooltip: 'Redo last change'
        }
      ],
      0,
      this._menubar.height,
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
      this._menubar.height + this._toolbar.height,
      this._statusbar.height,
      assetRegistry
    );
    this._propGrid = new PropertyEditor(
      getSerializationInfo(this._tab.assetHierarchy.assetRegistry),
      this._menubar.height + this._toolbar.height,
      this._statusbar.height,
      400,
      8,
      600,
      200,
      0.6
    );
  }
  get toolbar() {
    return this._toolbar;
  }
  reset(scene: Scene) {
    this.sceneFinialize();
    this._postGizmoRenderer.dispose();
    this._postGizmoRenderer = new PostGizmoRenderer(this.model.camera, null);
    this._postGizmoRenderer.mode = 'select';
    this._tab.sceneHierarchy.selectNode(null);
    this._tab.sceneHierarchy.scene = scene;
    this._propGrid.object = null;
    this._transformNode = null;
    this._oldTransform = null;
    this._dragDropTypes = [];
    this._nodeToBePlaced = null;
    this._postGizmoCaptured = false;
    this._drawTextureViewer = false;
    this._menubar.checkMenuItem('SHOW_TEXTURE_VIEWER', false);
    this.sceneSetup();
  }
  render() {
    this._menubar.render();
    this._tab.render();
    this._propGrid.render();
    this._toolbar.render();
    this._statusbar.render();
    const displaySize = ImGui.GetIO().DisplaySize;
    const viewportWidth = displaySize.x - this._tab.width - this._propGrid.width;
    const viewportHeight =
      displaySize.y - this._statusbar.height - this._menubar.height - this._toolbar.height;
    if (this._dragDropTypes.length > 0) {
      if (viewportWidth > 0 && viewportHeight > 0) {
        this.renderDropZone(
          this._tab.width,
          this._menubar.height + this._toolbar.height,
          viewportWidth,
          viewportHeight
        );
      }
    }
    if (this._nodeToBePlaced) {
      if (this._mousePosX >= 0 && this._mousePosY >= 0) {
        this._nodeToBePlaced.parent = this.model.scene.rootNode;
        const ray = this.model.camera.constructRay(this._mousePosX, this._mousePosY);
        let hitDistance = -ray.origin.y / ray.direction.y;
        if (Number.isNaN(hitDistance) || hitDistance < 0) {
          hitDistance = 10;
        }
        this._nodeToBePlaced.position.setXYZ(
          ray.origin.x + ray.direction.x * hitDistance,
          ray.origin.y + ray.direction.y * hitDistance,
          ray.origin.z + ray.direction.z * hitDistance
        );
      } else {
        this._nodeToBePlaced.parent = null;
      }
    }
    this.model.camera.viewport = [this._tab.width, this._statusbar.height, viewportWidth, viewportHeight];
    this.model.camera.scissor = [this._tab.width, this._statusbar.height, viewportWidth, viewportHeight];
    this.model.camera.aspect = viewportWidth / viewportHeight;
    this.model.camera.render(this.model.scene, this.model.compositor);

    if (this._drawTextureViewer) {
      renderTextureViewer();
    }
    /*
    if (ImGui.Begin('FontTest')) {
      ImGui.Text(FontGlyph.allGlyphs);
    }
    ImGui.End();
    */
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
        const peekPayload = ImGui.AcceptDragDropPayload(type, ImGui.DragDropFlags.AcceptBeforeDelivery);
        const payload = ImGui.AcceptDragDropPayload(type);
        if (payload || peekPayload) {
          const mousePos = ImGui.GetMousePos();
          const pos = [mousePos.x, mousePos.y];
          if (this.posToViewport(pos, this.model.camera.viewport)) {
            eventBus.dispatchEvent(
              payload ? 'workspace_drag_drop' : 'workspace_dragging',
              type,
              payload ? payload.Data : peekPayload.Data,
              pos[0],
              pos[1]
            );
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
    if (this.shortcut(ev)) {
      return true;
    }
    if (this.model.camera.handleEvent(ev, type)) {
      return true;
    }
    if (ev instanceof PointerEvent) {
      const p = [ev.offsetX, ev.offsetY];
      const insideViewport = this.posToViewport(p, this.model.camera.viewport);
      if (this._postGizmoCaptured) {
        this._postGizmoRenderer.handlePointerEvent(ev.type, p[0], p[1], ev.button);
        return true;
      }
      if (!insideViewport) {
        this._mousePosX = -1;
        this._mousePosY = -1;
        return false;
      }
      this._mousePosX = p[0];
      this._mousePosY = p[1];
      if (this._nodeToBePlaced) {
        if (ev.type === 'pointerdown') {
          if (ev.button === 2) {
            this._nodeToBePlaced.parent = null;
            this._assetRegistry.releaseAsset(this._nodeToBePlaced);
            this._nodeToBePlaced = null;
          } else if (ev.button === 0) {
            this._tab.sceneHierarchy.selectNode(this._nodeToBePlaced);
            this._nodeToBePlaced = null;
          }
        }
      }
      if (this._postGizmoRenderer.handlePointerEvent(ev.type, p[0], p[1], ev.button)) {
        return true;
      }
      if (ev.button === 0 && ev.type === 'pointerdown') {
        this.model.camera.pickAsync(p[0], p[1]).then((pickResult) => {
          let node = pickResult?.target?.node ?? null;
          if (node) {
            let sealedNode = node;
            while (sealedNode && !sealedNode.sealed) {
              sealedNode = sealedNode.parent;
            }
            if (sealedNode) {
              node = sealedNode;
            }
          }
          this._tab.sceneHierarchy.selectNode(node);
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
    this._menubar.registerShortcuts(this);
    this._menubar.on('action', this.handleSceneAction, this);
    this._toolbar.registerShortcuts(this);
    this._toolbar.on('action', this.handleSceneAction, this);
    this._tab.sceneHierarchy.on('node_selected', this.handleNodeSelected, this);
    this._tab.sceneHierarchy.on('node_deselected', this.handleNodeDeselected, this);
    this._tab.sceneHierarchy.on('node_drag_drop', this.handleNodeDragDrop, this);
    eventBus.on('scene_add_asset', this.handleAddAsset, this);
    this.sceneSetup();
  }
  protected onDeactivate(): void {
    super.onDeactivate();
    this._menubar.unregisterShortcuts(this);
    this._menubar.off('action', this.handleSceneAction, this);
    this._toolbar.unregisterShortcuts(this);
    this._toolbar.off('action', this.handleSceneAction, this);
    this._tab.sceneHierarchy.off('node_selected', this.handleNodeSelected, this);
    this._tab.sceneHierarchy.off('node_deselected', this.handleNodeDeselected, this);
    this._tab.sceneHierarchy.off('node_drag_drop', this.handleNodeDragDrop, this);
    eventBus.off('scene_add_asset', this.handleAddAsset, this);
    this.sceneFinialize();
  }
  private sceneSetup() {
    this.model.scene.rootNode.on('noderemoved', this.handleNodeRemoved, this);
    this.model.scene.on('startrender', this.handleStartRender, this);
    this.model.scene.on('endrender', this.handleEndRender, this);
    this._postGizmoRenderer.on('begin_translate', this.handleBeginTransformNode, this);
    this._postGizmoRenderer.on('begin_rotate', this.handleBeginTransformNode, this);
    this._postGizmoRenderer.on('begin_scale', this.handleBeginTransformNode, this);
    this._postGizmoRenderer.on('end_translate', this.handleEndTransformNode, this);
    this._postGizmoRenderer.on('end_rotate', this.handleEndTransformNode, this);
    this._postGizmoRenderer.on('end_scale', this.handleEndTransformNode, this);
  }
  private sceneFinialize() {
    this.model.scene.rootNode.off('noderemoved', this.handleNodeRemoved, this);
    this.model.scene.off('startrender', this.handleStartRender, this);
    this.model.scene.off('endrender', this.handleEndRender, this);
    this._postGizmoRenderer.off('begin_translate', this.handleBeginTransformNode, this);
    this._postGizmoRenderer.off('begin_rotate', this.handleBeginTransformNode, this);
    this._postGizmoRenderer.off('begin_scale', this.handleBeginTransformNode, this);
    this._postGizmoRenderer.off('end_translate', this.handleEndTransformNode, this);
    this._postGizmoRenderer.off('end_rotate', this.handleEndTransformNode, this);
    this._postGizmoRenderer.off('end_scale', this.handleEndTransformNode, this);
  }
  private handleNodeSelected(node: SceneNode) {
    let sealedNode = node;
    while (sealedNode && !sealedNode.sealed) {
      sealedNode = sealedNode.parent;
    }
    if (sealedNode) {
      node = sealedNode;
    }
    this._postGizmoRenderer.node =
      node === node.scene.rootNode || node instanceof DirectionalLight ? null : node;
    this._propGrid.object = node === node.scene.rootNode ? node.scene : node;
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
  private handleAddAsset(asset: DBAssetInfo) {
    console.log(`Add asset ${asset.name}`);
    if (this._nodeToBePlaced) {
      this._assetRegistry.releaseAsset(this._nodeToBePlaced);
      this._nodeToBePlaced = null;
    }
    this._assetRegistry.fetchModel(asset.uuid, this.model.scene, { enableInstancing: true })
      .then((node) => {
        this._nodeToBePlaced = node.group;
      })
      .catch((err) => {
        Dialog.messageBox('Error', `${err}`);
      });
  }
  private handleNodeRemoved(node: SceneNode) {
    if (node.isParentOf(this._postGizmoRenderer.node)) {
      this._postGizmoRenderer.node = null;
    }
    if (node.isParentOf(this._tab.sceneHierarchy.selectedNode)) {
      this._tab.sceneHierarchy.selectNode(null);
    }
  }
  private handleBeginTransformNode(node: SceneNode) {
    this._transformNode = node;
    this._oldTransform = {
      position: new Vector3(node.position),
      rotation: new Quaternion(node.rotation),
      scale: new Vector3(node.scale)
    };
    this._postGizmoCaptured = true;
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
    this._postGizmoCaptured = false;
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
      case 'SHOW_TEXTURE_VIEWER':
        this._drawTextureViewer = !this._drawTextureViewer;
        this._menubar.checkMenuItem(action, this._drawTextureViewer);
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
