import { ImGui } from '@zephyr3d/imgui';
import type { SceneModel } from '../models/scenemodel';
import { PostGizmoRenderer } from './gizmo/postgizmo';
import { PropertyEditor } from '../components/grid';
import { Tab } from '../components/tab';
import type { AssetRegistry, Camera, Compositor, Scene, ShapeOptionType, ShapeType } from '@zephyr3d/scene';
import {
  BoxShape,
  CylinderShape,
  Mesh,
  ParticleSystem,
  PBRMetallicRoughnessMaterial,
  PlaneShape,
  Ref,
  SphereShape,
  TorusShape
} from '@zephyr3d/scene';
import { SceneNode } from '@zephyr3d/scene';
import { Application, DirectionalLight } from '@zephyr3d/scene';
import { eventBus } from '../core/eventbus';
import { ToolBar } from '../components/toolbar';
import { FontGlyph } from '../core/fontglyph';
import type { GenericConstructor } from '@zephyr3d/base';
import { Quaternion, Vector3 } from '@zephyr3d/base';
import type { TRS } from '../types';
import { Database, type DBAssetInfo } from '../storage/db';
import { Dialog } from './dlg/dlg';
import { renderTextureViewer } from '../components/textureviewer';
import { MenubarView } from '../components/menubar';
import { StatusBar } from '../components/statusbar';
import { BaseView } from './baseview';
import { CommandManager } from '../core/command';
import {
  AddAssetCommand,
  AddBatchGroupCommand,
  AddParticleSystemCommand,
  AddShapeCommand,
  NodeDeleteCommand,
  NodeReparentCommand,
  NodeTransformCommand
} from '../commands/scenecommands';
import { ZipDownloader } from '../helpers/zipdownload';

export class SceneView extends BaseView<SceneModel> {
  private _cmdManager: CommandManager;
  private _postGizmoRenderer: PostGizmoRenderer;
  private _propGrid: PropertyEditor;
  private _toolbar: ToolBar;
  private _tab: Tab;
  private _menubar: MenubarView;
  private _statusbar: StatusBar;
  private _transformNode: Ref<SceneNode>;
  private _oldTransform: TRS;
  private _dragDropTypes: string[];
  private _nodeToBePlaced: Ref<SceneNode>;
  private _typeToBePlaced: 'shape' | 'asset' | 'particlesys' | 'none';
  private _assetToBeAdded: DBAssetInfo;
  private _shapeToBeAdded: { cls: GenericConstructor<ShapeType>; options: any };
  private _mousePosX: number;
  private _mousePosY: number;
  private _assetRegistry: AssetRegistry;
  private _postGizmoCaptured: boolean;
  private _showTextureViewer: boolean;
  private _showDeviceInfo: boolean;
  constructor(model: SceneModel, assetRegistry: AssetRegistry) {
    super(model);
    this._cmdManager = new CommandManager();
    this._transformNode = new Ref();
    this._oldTransform = null;
    this._dragDropTypes = [];
    this._nodeToBePlaced = new Ref();
    this._typeToBePlaced = 'none';
    this._assetToBeAdded = null;
    this._shapeToBeAdded = null;
    this._mousePosX = -1;
    this._mousePosY = -1;
    this._postGizmoCaptured = false;
    this._showTextureViewer = false;
    this._showDeviceInfo = false;
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
              action: () => eventBus.dispatchEvent('action', 'NEW_DOC')
            },
            {
              label: 'Open',
              shortCut: 'Ctrl+O',
              action: () => eventBus.dispatchEvent('action', 'OPEN_DOC')
            },
            {
              label: 'Save',
              shortCut: 'Ctrl+S',
              action: () => eventBus.dispatchEvent('action', 'SAVE_DOC')
            },
            {
              label: 'Export',
              action: () => eventBus.dispatchEvent('action', 'EXPORT_DOC')
            }
          ]
        },
        {
          label: 'Add',
          subMenus: [
            {
              label: 'Box',
              action: () => this.handleAddShape(BoxShape, { anchor: 0.5, anchorY: 0 })
            },
            {
              label: 'Sphere',
              action: () => this.handleAddShape(SphereShape)
            },
            {
              label: 'Plane',
              action: () => this.handleAddShape(PlaneShape)
            },
            {
              label: 'Cylinder',
              action: () => this.handleAddShape(CylinderShape, { topCap: true, bottomCap: true })
            },
            {
              label: 'Torus',
              action: () => this.handleAddShape(TorusShape)
            },
            {
              label: '-'
            },
            {
              label: 'ParticleSystem',
              action: () => this.handleAddParticleSystem()
            }
          ]
        },
        {
          label: 'Tools',
          subMenus: [
            {
              label: 'Texture viewer',
              id: 'SHOW_TEXTURE_VIEWER',
              action: () => (this._showTextureViewer = !this._showTextureViewer),
              checked: () => this._showTextureViewer
            },
            {
              label: 'Curve editor',
              id: 'SHOW_CURVE_EDITOR',
              action: () => {
                Dialog.editCurve('Edit curve', 600, 500).then((interpolator) => {
                  console.dir(interpolator);
                });
              }
            },
            {
              label: 'Device Information',
              id: 'SHOW_DEVICE_INFO',
              action: () => (this._showDeviceInfo = !this._showDeviceInfo),
              checked: () => this._showDeviceInfo
            }
          ]
        }
      ]
    });
    this._toolbar = new ToolBar(
      'MainToolBar',
      [
        {
          label: FontGlyph.glyphs['mouse-pointer'],
          shortcut: 'Esc',
          tooltip: () => 'Select node',
          selected: () => {
            return this._postGizmoRenderer.mode === 'select';
          },
          action: () => {
            this._postGizmoRenderer.mode = 'select';
          }
        },
        {
          label: FontGlyph.glyphs['move'],
          shortcut: 'T',
          tooltip: () => 'Move selected node',
          selected: () => {
            return this._postGizmoRenderer.mode === 'translation';
          },
          action: () => {
            this._postGizmoRenderer.mode = 'translation';
          }
        },
        {
          label: FontGlyph.glyphs['arrows-cw'],
          shortcut: 'R',
          tooltip: () => 'Rotate selected node',
          selected: () => {
            return this._postGizmoRenderer.mode === 'rotation';
          },
          action: () => {
            this._postGizmoRenderer.mode = 'rotation';
          }
        },
        {
          label: FontGlyph.glyphs['resize-vertical'],
          shortcut: 'S',
          tooltip: () => 'Scale selected node',
          selected: () => {
            return this._postGizmoRenderer.mode === 'scaling';
          },
          action: () => {
            this._postGizmoRenderer.mode = 'scaling';
          }
        },
        {
          label: FontGlyph.glyphs['cancel'],
          shortcut: 'Delete',
          tooltip: () => 'Delete selected node',
          selected: () => {
            return !!this._postGizmoRenderer.node;
          },
          action: () => {
            const node = this._tab.sceneHierarchy.selectedNode;
            if (node) {
              this.handleDeleteNode(node);
            }
          }
        },
        {
          label: '-'
        },
        {
          label: FontGlyph.glyphs['ccw'],
          shortcut: 'Ctrl+Z',
          selected: () => {
            return !!this._cmdManager.getUndoCommand();
          },
          tooltip: () => {
            const cmd = this._cmdManager.getUndoCommand();
            return cmd ? `Undo ${cmd.desc}` : 'Undo';
          },
          action: () => {
            this._cmdManager.undo();
          }
        },
        {
          label: FontGlyph.glyphs['cw'],
          shortcut: 'Ctrl+Y',
          id: 'REDO',
          selected: () => {
            return !!this._cmdManager.getRedoCommand();
          },
          tooltip: () => {
            const cmd = this._cmdManager.getRedoCommand();
            return cmd ? `Redo ${cmd.desc}` : 'Redo';
          },
          action: () => {
            this._cmdManager.redo();
          }
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
      assetRegistry,
      this._menubar.height + this._toolbar.height,
      this._statusbar.height,
      400,
      8,
      600,
      200,
      0.4
    );
  }
  get toolbar() {
    return this._toolbar;
  }
  get cmdManager() {
    return this._cmdManager;
  }
  reset(scene: Scene) {
    this.sceneFinialize();
    this._cmdManager.clear();
    this._postGizmoRenderer.dispose();
    this._postGizmoRenderer = new PostGizmoRenderer(this.model.camera, null);
    this._postGizmoRenderer.mode = 'select';
    this._tab.sceneHierarchy.selectNode(null);
    this._tab.sceneHierarchy.scene = scene;
    this._propGrid.object = null;
    this._transformNode.dispose();
    this._oldTransform = null;
    this._dragDropTypes = [];
    this._nodeToBePlaced.dispose();
    this._postGizmoCaptured = false;
    this._showTextureViewer = false;
    this._showDeviceInfo = false;
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
    const placeNode = this._nodeToBePlaced.get();
    if (placeNode) {
      if (this._mousePosX >= 0 && this._mousePosY >= 0) {
        placeNode.parent = this.model.scene.rootNode;
        const ray = this.model.camera.constructRay(this._mousePosX, this._mousePosY);
        let hitDistance = -ray.origin.y / ray.direction.y;
        if (Number.isNaN(hitDistance) || hitDistance < 0) {
          hitDistance = 10;
        }
        placeNode.position.setXYZ(
          ray.origin.x + ray.direction.x * hitDistance,
          ray.origin.y + ray.direction.y * hitDistance,
          ray.origin.z + ray.direction.z * hitDistance
        );
      } else {
        placeNode.parent = null;
      }
    }
    this.model.camera.viewport = [this._tab.width, this._statusbar.height, viewportWidth, viewportHeight];
    this.model.camera.scissor = [this._tab.width, this._statusbar.height, viewportWidth, viewportHeight];
    this.model.camera.aspect = viewportWidth / viewportHeight;
    this.model.camera.render(this.model.scene, this.model.compositor);

    if (this._showTextureViewer) {
      renderTextureViewer();
    }
    if (this._showDeviceInfo) {
      this.renderDeviceInfo();
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
      const placeNode = this._nodeToBePlaced.get();
      if (placeNode) {
        if (ev.type === 'pointerdown') {
          if (ev.button === 2) {
            placeNode.parent = null;
            this._nodeToBePlaced.dispose();
          } else if (ev.button === 0) {
            const pos = placeNode.position.clone();
            placeNode.parent = null;
            this._nodeToBePlaced.dispose();
            switch (this._typeToBePlaced) {
              case 'asset':
                this._cmdManager
                  .execute(
                    new AddAssetCommand(this.model.scene, this._assetRegistry, this._assetToBeAdded, pos)
                  )
                  .then((node) => {
                    this._tab.sceneHierarchy.selectNode(node);
                  });
                break;
              case 'shape':
                this._cmdManager
                  .execute(
                    new AddShapeCommand(
                      this.model.scene,
                      this._shapeToBeAdded.cls,
                      pos,
                      this._shapeToBeAdded.options
                    )
                  )
                  .then((mesh) => {
                    this._tab.sceneHierarchy.selectNode(mesh);
                  });
              case 'particlesys':
                this._cmdManager.execute(new AddParticleSystemCommand(this.model.scene, pos)).then((node) => {
                  this._tab.sceneHierarchy.selectNode(node);
                });
            }
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
            let assetNode = node;
            while (assetNode && !this._assetRegistry.getAssetId(assetNode)) {
              assetNode = assetNode.parent;
            }
            if (assetNode) {
              node = assetNode;
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
    this._tab.sceneHierarchy.on('node_request_delete', this.handleDeleteNode, this);
    this._tab.sceneHierarchy.on('node_drag_drop', this.handleNodeDragDrop, this);
    eventBus.on('scene_add_asset', this.handleAddAsset, this);
    eventBus.on('scene_add_batch', this.handleAddBatch, this);
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
    this._tab.sceneHierarchy.off('node_request_delete', this.handleDeleteNode, this);
    this._tab.sceneHierarchy.off('node_drag_drop', this.handleNodeDragDrop, this);
    eventBus.off('scene_add_asset', this.handleAddAsset, this);
    eventBus.off('scene_add_batch', this.handleAddBatch, this);
    this.sceneFinialize();
  }
  private sceneSetup() {
    this.model.scene.rootNode.on('noderemoved', this.handleNodeRemoved, this);
    this.model.scene.on('startrender', this.handleStartRender, this);
    this.model.scene.on('endrender', this.handleEndRender, this);
    this._postGizmoRenderer.on('begin_translate', this.handleBeginTransformNode, this);
    this._postGizmoRenderer.on('begin_rotate', this.handleBeginTransformNode, this);
    this._postGizmoRenderer.on('begin_scale', this.handleBeginTransformNode, this);
    this._postGizmoRenderer.on('end_translate', this.handleEndTranslateNode, this);
    this._postGizmoRenderer.on('end_rotate', this.handleEndRotateNode, this);
    this._postGizmoRenderer.on('end_scale', this.handleEndScaleNode, this);
  }
  private sceneFinialize() {
    this.model.scene.rootNode.off('noderemoved', this.handleNodeRemoved, this);
    this.model.scene.off('startrender', this.handleStartRender, this);
    this.model.scene.off('endrender', this.handleEndRender, this);
    this._postGizmoRenderer.off('begin_translate', this.handleBeginTransformNode, this);
    this._postGizmoRenderer.off('begin_rotate', this.handleBeginTransformNode, this);
    this._postGizmoRenderer.off('begin_scale', this.handleBeginTransformNode, this);
    this._postGizmoRenderer.off('end_translate', this.handleEndTranslateNode, this);
    this._postGizmoRenderer.off('end_rotate', this.handleEndRotateNode, this);
    this._postGizmoRenderer.off('end_scale', this.handleEndScaleNode, this);
  }
  private renderDeviceInfo() {
    const device = Application.instance.device;
    const gpuObjectList = device.getGPUObjects();
    if (ImGui.Begin('DeviceInfo')) {
      if (ImGui.BeginTable('DeviceProperties', 2)) {
        ImGui.TableNextRow();
        ImGui.TableNextColumn();
        ImGui.Text('Type');
        ImGui.TableNextColumn();
        ImGui.Text(device.type);
        ImGui.TableNextRow();
        ImGui.TableNextColumn();
        ImGui.Text('FPS');
        ImGui.TableNextColumn();
        ImGui.Text(device.frameInfo.FPS.toFixed(2));
        ImGui.TableNextRow();
        ImGui.TableNextColumn();
        ImGui.Text('Texture Count');
        ImGui.TableNextColumn();
        ImGui.Text(`${gpuObjectList.textures.length}`);
        ImGui.TableNextRow();
        ImGui.TableNextColumn();
        ImGui.Text('Buffer Count');
        ImGui.TableNextColumn();
        ImGui.Text(`${gpuObjectList.buffers.length}`);
        ImGui.TableNextRow();
        ImGui.TableNextColumn();
        ImGui.Text('BindGroup Count');
        ImGui.TableNextColumn();
        ImGui.Text(`${gpuObjectList.bindGroups.length}`);
        ImGui.TableNextRow();
        ImGui.TableNextColumn();
        ImGui.Text('Framebuffer Count');
        ImGui.TableNextColumn();
        ImGui.Text(`${gpuObjectList.framebuffers.length}`);
        ImGui.EndTable();
      }
    }
    ImGui.End();
  }
  private handleDeleteNode(node: SceneNode) {
    if (node === this.model.camera) {
      Dialog.messageBox('Zephyr3d editor', 'Cannot delete active camera');
      return;
    }
    if (node.isParentOf(this._tab.sceneHierarchy.selectedNode)) {
      this._tab.sceneHierarchy.selectNode(null);
    }
    if (this._propGrid.object instanceof SceneNode && node.isParentOf(this._propGrid.object)) {
      this._propGrid.object = null;
    }
    if (node.isParentOf(this._postGizmoRenderer.node)) {
      this._postGizmoRenderer.node = null;
    }
    this._cmdManager.execute(new NodeDeleteCommand(node, this._assetRegistry));
  }
  private handleNodeSelected(node: SceneNode) {
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
      this._cmdManager.execute(new NodeReparentCommand(src, dst));
    }
  }
  private handleAddShape<T extends ShapeType>(shapeCls: GenericConstructor<T>, options?: ShapeOptionType<T>) {
    const placeNode = this._nodeToBePlaced.get();
    if (placeNode) {
      placeNode.remove();
      this._nodeToBePlaced.dispose();
      this._typeToBePlaced = 'none';
    }
    const shape = new shapeCls(options);
    const mesh = new Mesh(this.model.scene, shape, new PBRMetallicRoughnessMaterial());
    this._nodeToBePlaced.set(mesh);
    this._shapeToBeAdded = {
      cls: shapeCls,
      options
    };
    this._typeToBePlaced = 'shape';
  }
  private handleAddParticleSystem() {
    const placeNode = this._nodeToBePlaced.get();
    if (placeNode) {
      placeNode.remove();
      this._nodeToBePlaced.dispose();
      this._typeToBePlaced = 'none';
    }
    const ps = new ParticleSystem(this.model.scene);
    this._nodeToBePlaced.set(ps);
    this._typeToBePlaced = 'particlesys';
  }
  private handleAddAsset(asset: DBAssetInfo) {
    const placeNode = this._nodeToBePlaced.get();
    if (placeNode) {
      placeNode.remove();
      this._nodeToBePlaced.dispose();
      this._typeToBePlaced = 'none';
    }
    this._assetRegistry
      .fetchModel(asset.uuid, this.model.scene, { enableInstancing: true })
      .then((node) => {
        this._nodeToBePlaced.set(node.group);
        this._assetToBeAdded = asset;
        this._typeToBePlaced = 'asset';
      })
      .catch((err) => {
        Dialog.messageBox('Error', `${err}`);
      });
  }
  private handleAddBatch() {
    this._cmdManager.execute(new AddBatchGroupCommand(this.model.scene)).then((node) => {
      this._tab.sceneHierarchy.selectNode(node);
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
    this._transformNode.set(node);
    this._oldTransform = {
      position: new Vector3(node.position),
      rotation: new Quaternion(node.rotation),
      scale: new Vector3(node.scale)
    };
    this._postGizmoCaptured = true;
  }
  private handleEndTransformNode(node: SceneNode, desc: string) {
    if (node && node === this._transformNode.get()) {
      this._cmdManager.execute(
        new NodeTransformCommand(
          node,
          this._oldTransform,
          {
            position: node.position,
            rotation: node.rotation,
            scale: node.scale
          },
          desc
        )
      );
      this._oldTransform = null;
      this._transformNode.dispose();
      this.model.scene.octree.prune();
    }
    this._postGizmoCaptured = false;
  }
  private handleEndTranslateNode(node: SceneNode) {
    this.handleEndTransformNode(node, 'moving object');
  }
  private handleEndRotateNode(node: SceneNode) {
    this.handleEndTransformNode(node, 'rotating object');
  }
  private handleEndScaleNode(node: SceneNode) {
    this.handleEndTransformNode(node, 'scaling object');
  }
  private handleSceneAction(action: string) {
    switch (action) {
      case 'TEST_ZIP_DOWNLOAD': {
        const assetList: string[] = [];
        for (const asset of this._tab.assetHierarchy.assets) {
          assetList.push(...asset.assets.map((val) => val.uuid));
        }
        if (assetList.length > 0) {
          const zipDownloader = new ZipDownloader('test.zip');
          Database.exportAssets(zipDownloader, assetList, 'ASSET')
            .then(() => {
              zipDownloader.finish();
            })
            .catch((err) => {
              zipDownloader.finish();
            });
        }
        break;
      }
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
