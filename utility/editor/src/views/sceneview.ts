import { ImGui } from '@zephyr3d/imgui';
import type { SceneModel } from '../models/scenemodel';
import { PostGizmoRenderer } from './gizmo/postgizmo';
import { PropertyEditor } from '../components/grid';
import type {
  Camera,
  Compositor,
  PickResult,
  PropertyAccessor,
  PropertyTrack,
  PropertyValue,
  Scene,
  MeshMaterial
} from '@zephyr3d/scene';
import {
  Mesh,
  ParticleSystem,
  PointLight,
  SpotLight,
  Water,
  ClipmapTerrain,
  PerspectiveCamera,
  OrthoCamera,
  getDevice,
  getEngine
} from '@zephyr3d/scene';
import { SceneNode } from '@zephyr3d/scene';
import { DirectionalLight } from '@zephyr3d/scene';
import { eventBus } from '../core/eventbus';
import { ToolBar } from '../components/toolbar';
import { FontGlyph } from '../core/fontglyph';
import type { AABB } from '@zephyr3d/base';
import { DRef, HttpFS } from '@zephyr3d/base';
import { ASSERT, Quaternion, Vector3 } from '@zephyr3d/base';
import type { TRS } from '../types';
import { Dialog } from './dlg/dlg';
import { renderTextureViewer } from '../components/textureviewer';
import { MenubarView } from '../components/menubar';
import { StatusBar } from '../components/statusbar';
import { BaseView } from './baseview';
import { CommandManager } from '../core/command';
import {
  AddAssetCommand,
  AddChildCommand,
  AddPrefabCommand,
  AddShapeCommand,
  NodeCloneCommand,
  NodeDeleteCommand,
  NodeReparentCommand,
  NodeTransformCommand
} from '../commands/scenecommands';
import { NodeProxy } from '../helpers/proxy';
import type { EditTool } from './edittools/edittool';
import { createEditTool, isObjectEditable } from './edittools/edittool';
import { calcHierarchyBoundingBox } from '../helpers/misc';
import { DialogRenderer } from '../components/modal';
import { DlgEditColorTrack } from './dlg/editcolortrackdlg';
import { DlgCurveEditor } from './dlg/curveeditordlg';
import { BottomView } from '../components/bottomview';
import { ProjectService } from '../core/services/project';
import type { SceneController } from '../controllers/scenecontroller';
import { EditorCameraController } from '../helpers/editocontroller';
import { ensureDependencies } from '../core/build/dep';
import { SceneHierarchy } from '../components/scenehierarchy';
import { DockPannel, ResizeDirection } from '../components/dockpanel';
import { DlgSaveFile } from './dlg/savefiledlg';
import { ResourceService } from '../core/services/resource';
import { DlgMessage } from './dlg/messagedlg';

export class SceneView extends BaseView<SceneModel, SceneController> {
  private readonly _cmdManager: CommandManager;
  private _postGizmoRenderer: PostGizmoRenderer;
  private _rightDockPanel: DockPannel;
  private readonly _propGrid: PropertyEditor;
  private readonly _toolbar: ToolBar;
  private _leftDockPanel: DockPannel;
  private _sceneHierarchy: SceneHierarchy;
  private readonly _menubar: MenubarView;
  private _assetView: BottomView;
  private readonly _statusbar: StatusBar;
  private readonly _transformNode: DRef<SceneNode>;
  private _oldTransform: TRS;
  private _workspaceDragging: boolean;
  private _renderDropZone: boolean;
  private readonly _nodeToBePlaced: DRef<SceneNode>;
  private _typeToBePlaced: 'shape' | 'asset' | 'prefab' | 'node' | 'none';
  private _ctorToBePlaced: { new (scene: Scene): SceneNode };
  private _descToBePlaced: string;
  private _assetToBeAdded: string;
  private _shapeToBeAdded: { cls: string };
  private _mousePosX: number;
  private _mousePosY: number;
  private _pickResult: PickResult;
  private _postGizmoCaptured: boolean;
  private _showTextureViewer: boolean;
  private _showDeviceInfo: boolean;
  private readonly _clipBoardData: DRef<SceneNode>;
  private _aabbForEdit: AABB;
  private _proxy: NodeProxy;
  private readonly _currentEditTool: DRef<EditTool>;
  private readonly _cameraAnimationEyeFrom: Vector3;
  private readonly _cameraAnimationTargetFrom: Vector3;
  private readonly _cameraAnimationEyeTo: Vector3;
  private readonly _cameraAnimationTargetTo: Vector3;
  private _cameraAnimationTime: number;
  private readonly _cameraAnimationDuration: number;
  private _animatedCamera: Camera;
  private readonly _editingProps: Map<object, Map<PropertyAccessor, { id: string; value: number[] }>>;
  private _trackId: number;
  constructor(controller: SceneController) {
    super(controller);
    this._cmdManager = new CommandManager();
    this._transformNode = new DRef();
    this._oldTransform = null;
    this._workspaceDragging = false;
    this._renderDropZone = false;
    this._nodeToBePlaced = new DRef();
    this._typeToBePlaced = 'none';
    this._ctorToBePlaced = null;
    this._descToBePlaced = null;
    this._assetToBeAdded = null;
    this._shapeToBeAdded = null;
    this._clipBoardData = new DRef();
    this._mousePosX = -1;
    this._mousePosY = -1;
    this._pickResult = null;
    this._postGizmoCaptured = false;
    this._showTextureViewer = false;
    this._showDeviceInfo = false;
    this._aabbForEdit = null;
    this._proxy = null;
    this._currentEditTool = new DRef();
    this._cameraAnimationEyeFrom = new Vector3();
    this._cameraAnimationTargetFrom = new Vector3();
    this._cameraAnimationEyeTo = new Vector3();
    this._cameraAnimationTargetTo = new Vector3();
    this._cameraAnimationTime = 0;
    this._cameraAnimationDuration = 100;
    this._animatedCamera = null;
    this._editingProps = new Map();
    this._trackId = 0;
    this._statusbar = new StatusBar();
    this._menubar = new MenubarView({
      items: [
        {
          label: 'Project',
          subMenus: [
            {
              label: 'New Project...',
              action: () => eventBus.dispatchEvent('action', 'NEW_PROJECT')
            },
            {
              label: 'Open Project...',
              action: () => eventBus.dispatchEvent('action', 'OPEN_PROJECT')
            },
            {
              label: 'Close Project',
              action: () => eventBus.dispatchEvent('action', 'CLOSE_PROJECT')
            },
            {
              label: 'Export Project',
              action: () => eventBus.dispatchEvent('action', 'EXPORT_PROJECT')
            },
            {
              label: 'Delete Project',
              action: () => eventBus.dispatchEvent('action', 'DELETE_PROJECT')
            },
            {
              label: '-'
            },
            {
              label: 'Project Settings...',
              action: () => eventBus.dispatchEvent('action', 'PROJECT_SETTINGS')
            },
            {
              label: 'Build Project',
              action: () => eventBus.dispatchEvent('action', 'BUILD_PROJECT')
            }
          ]
        },
        {
          label: 'Scene',
          subMenus: [
            {
              label: 'New Scene',
              shortCut: 'Ctrl+N',
              action: () => eventBus.dispatchEvent('action', 'NEW_DOC')
            },
            {
              label: 'Open Scene...',
              shortCut: 'Ctrl+O',
              action: () => eventBus.dispatchEvent('action', 'OPEN_DOC')
            },
            {
              label: 'Save Scene',
              shortCut: 'Ctrl+S',
              action: () => eventBus.dispatchEvent('action', 'SAVE_DOC')
            },
            {
              label: 'Save Scene As...',
              shortCut: 'Ctrl+Alt+S',
              action: () => eventBus.dispatchEvent('action', 'SAVE_DOC_AS')
            }
          ]
        },
        {
          label: 'Edit',
          subMenus: [
            {
              label: 'Undo',
              shortCut: 'Ctrl+Z',
              action: () => {
                this._cmdManager.undo();
              }
            },
            {
              label: 'Redo',
              shortCut: 'Ctrl+Y',
              action: () => {
                this._cmdManager.redo();
              }
            },
            {
              label: 'Copy',
              shortCut: 'Ctrl+C',
              action: () => {
                const node = this._sceneHierarchy.selectedNode;
                if (node) {
                  this.handleCopyNode(node);
                }
              }
            },
            {
              label: 'Paste',
              shortCut: 'Ctrl+V',
              action: () => {
                this.handlePasteNode();
              }
            }
          ]
        },
        {
          label: 'Add',
          subMenus: [
            {
              label: 'Mesh',
              subMenus: [
                {
                  label: 'Box',
                  action: () => this.handleAddShape('/assets/@builtins/primitives/box.zmsh')
                },
                {
                  label: 'Sphere',
                  action: () => this.handleAddShape('/assets/@builtins/primitives/sphere.zmsh')
                },
                {
                  label: 'Plane',
                  action: () => this.handleAddShape('/assets/@builtins/primitives/plane.zmsh')
                },
                {
                  label: 'Cylinder',
                  action: () => this.handleAddShape('/assets/@builtins/primitives/cylinder.zmsh')
                },
                {
                  label: 'Torus',
                  action: () => this.handleAddShape('/assets/@builtins/primitives/torus.zmsh')
                },
                {
                  label: 'Tetrahedron',
                  action: () => this.handleAddShape('/assets/@builtins/primitives/tetrahedron.zmsh')
                }
              ]
            },
            {
              label: 'Light',
              subMenus: [
                {
                  label: 'Directional Light',
                  action: () => this.handleAddNode(DirectionalLight, 'Add directional light')
                },
                {
                  label: 'Point Light',
                  action: () => this.handleAddNode(PointLight, 'Add point light')
                },
                {
                  label: 'Spot Light',
                  action: () => this.handleAddNode(SpotLight, 'Add spot light')
                }
              ]
            },
            {
              label: 'Camera',
              subMenus: [
                {
                  label: 'Perspective Camera',
                  action: () => this.handleAddNode(PerspectiveCamera, 'Add perspective camera')
                }
              ]
            },
            {
              label: 'Particle System',
              action: () => this.handleAddNode(ParticleSystem, 'Add particle system')
            },
            {
              label: 'Water',
              action: () => this.handleAddNode(Water, 'Add water')
            },
            {
              label: 'Terrain',
              action: () => this.handleAddNode(ClipmapTerrain, 'Add terrain')
            }
          ]
        },
        {
          label: 'View',
          subMenus: [
            {
              label: 'Grid',
              action: () => (this._postGizmoRenderer.drawGrid = !this._postGizmoRenderer.drawGrid),
              checked: () => !!this._postGizmoRenderer.drawGrid
            },
            {
              label: 'Texture viewer',
              id: 'SHOW_TEXTURE_VIEWER',
              action: () => (this._showTextureViewer = !this._showTextureViewer),
              checked: () => this._showTextureViewer
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
            return !!this._sceneHierarchy.selectedNode;
          },
          action: () => {
            const node = this._sceneHierarchy.selectedNode;
            if (node?.parent) {
              this.handleDeleteNode(node);
            }
          }
        },
        {
          label: FontGlyph.glyphs['link'],
          shortcut: 'Ctrl+D',
          tooltip: () => 'Creatas an instance of current node',
          selected: () => {
            return !!this._sceneHierarchy.selectedNode;
          },
          action: () => {
            this.handleCloneNode(this._sceneHierarchy.selectedNode);
          }
        },
        {
          label: FontGlyph.glyphs['eye'],
          shortcut: 'F',
          tooltip: () => 'Focus on selected node',
          selected: () => {
            return !!this._sceneHierarchy.selectedNode;
          },
          action: () => {
            const node = this._sceneHierarchy.selectedNode;
            if (node) {
              this.lookAt(this.controller.model.scene.mainCamera, node);
            }
          }
        },
        {
          label: FontGlyph.glyphs['pencil'],
          tooltip: () => 'Edit selected node',
          visible: () =>
            !!this._currentEditTool.get() ||
            (!this._currentEditTool.get() && isObjectEditable(this._sceneHierarchy.selectedNode)),
          selected: () => {
            return !!this._currentEditTool.get();
          },
          action: () => {
            this.handleEditNode(this._sceneHierarchy.selectedNode);
          }
        },
        {
          label: '-'
        },
        {
          label: FontGlyph.glyphs['clone'],
          shortcut: 'Ctrl+C',
          tooltip: () => 'Copy',
          selected: () => {
            return !!this._sceneHierarchy.selectedNode;
          },
          action: () => {
            const node = this._sceneHierarchy.selectedNode;
            if (node) {
              this.handleCopyNode(node);
            }
          }
        },
        {
          label: FontGlyph.glyphs['paste'],
          shortcut: 'Ctrl+V',
          tooltip: () => 'Paste',
          selected: () => {
            return !!this._clipBoardData.get();
          },
          action: () => {
            this.handlePasteNode();
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
            return cmd ? `Undo ${cmd.getDesc()}` : 'Undo';
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
            return cmd ? `Redo ${cmd.getDesc()}` : 'Redo';
          },
          action: () => {
            this._cmdManager.redo();
          }
        },
        {
          label: '-'
        },
        {
          label: FontGlyph.glyphs['play'],
          id: 'PLAY',
          selected: () => true,
          tooltip: () => {
            return 'Play current project in new tab';
          },
          action: () => {
            this.play();
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
    this._rightDockPanel = new DockPannel(0, 0, 400, 0, 8, 200, 600, ResizeDirection.Left);
    this._propGrid = new PropertyEditor(0.4);
    this._postGizmoRenderer = null;
    this._leftDockPanel = null;
    this._sceneHierarchy = null;
    this._assetView = null;
  }
  get editor() {
    return this.controller.editor;
  }
  get toolbar() {
    return this._toolbar;
  }
  get cmdManager() {
    return this._cmdManager;
  }
  reset() {
    this.sceneFinialize();
    this._cmdManager.clear();
    this._propGrid.object = null;
    this._transformNode.dispose();
    this._oldTransform = null;
    this._workspaceDragging = false;
    this._nodeToBePlaced.dispose();
    this._postGizmoCaptured = false;
    this._showTextureViewer = false;
    this._showDeviceInfo = false;
    this._animatedCamera = null;
    this._currentEditTool?.dispose();
    this.sceneSetup();
  }
  render() {
    const displaySize = ImGui.GetIO().DisplaySize;
    this._rightDockPanel.left = displaySize.x - this._rightDockPanel.width;
    this._rightDockPanel.top = this._menubar.height + this._toolbar.height;
    this._rightDockPanel.height =
      displaySize.y - this._menubar.height - this._toolbar.height - this._statusbar.height;
    this._assetView.panel.top = displaySize.y - this._statusbar.height - this._assetView.panel.height;
    this._assetView.panel.width = Math.max(0, displaySize.x - this._rightDockPanel.width);
    this._leftDockPanel.height =
      displaySize.y -
      this._menubar.height -
      this._toolbar.height -
      this._statusbar.height -
      this._assetView.panel.height;

    this._menubar.render(this.controller.editor.currentProject.name);

    if (
      this._leftDockPanel.begin(
        '##SceneHierarchyPanel'
        //this._sceneHierarchy.draggingItem ? ImGui.WindowFlags.NoScrollbar : 0
      )
    ) {
      this._sceneHierarchy.render(this.controller.editor.sceneChanged);
    }
    this._leftDockPanel.end();

    if (this._rightDockPanel.begin('##PropertyGridPanel')) {
      this._propGrid.render();
    }
    this._rightDockPanel.end();

    this._toolbar.render();
    this._assetView.render();
    const viewportWidth = displaySize.x - this._leftDockPanel.width - this._rightDockPanel.width;
    const viewportHeight =
      displaySize.y -
      this._statusbar.height -
      this._menubar.height -
      this._toolbar.height -
      this._assetView.panel.height;
    if (viewportWidth > 0 && viewportHeight > 0) {
      const camera = this.controller.model.scene.mainCamera;
      camera.viewport = [
        this._leftDockPanel.width,
        this._statusbar.height + this._assetView.panel.height,
        viewportWidth,
        viewportHeight
      ];
      camera.scissor = [
        this._leftDockPanel.width,
        this._statusbar.height + this._assetView.panel.height,
        viewportWidth,
        viewportHeight
      ];
      if (camera instanceof PerspectiveCamera) {
        camera.aspect = viewportWidth / viewportHeight;
      } else if (camera instanceof OrthoCamera) {
        camera.bottom = -10;
        camera.top = 10;
        camera.left = (-10 * viewportWidth) / viewportHeight;
        camera.right = (10 * viewportWidth) / viewportHeight;
      }
      camera.render(this.controller.model.scene);

      // Render selected camera
      const selectedNode = this._sceneHierarchy.selectedNode;
      if (selectedNode instanceof PerspectiveCamera && selectedNode !== camera) {
        selectedNode.viewport = [camera.viewport[0] + 20, camera.viewport[1] + 20, 300, 200];
        selectedNode.scissor = selectedNode.viewport;
        selectedNode.aspect = selectedNode.viewport[2] / selectedNode.viewport[3];
        selectedNode.render(this.controller.model.scene);
      }

      if (this._renderDropZone) {
        this.renderDropZone(
          this._leftDockPanel.width,
          this._menubar.height + this._toolbar.height,
          viewportWidth,
          viewportHeight
        );
      }
    }
    this._statusbar.render();

    this._currentEditTool.get()?.render();

    if (this._showTextureViewer) {
      renderTextureViewer();
    }
    if (this._showDeviceInfo) {
      this.renderDeviceInfo();
    }
  }
  play() {
    ensureDependencies().then(() => {
      this.controller.editor.getProjectSettings().then((settings) => {
        if (!settings.startupScene && !settings.startupScript) {
          DlgMessage.messageBox('Error', 'Please select startup scene in <Project Settings>');
        } else {
          const projectId = this.controller.editor.currentProject.uuid;
          const url = new URL(window.location.href);
          url.searchParams.append('project', projectId);
          url.searchParams.append('remote', ProjectService.VFS instanceof HttpFS ? '1' : '0');
          const a = document.createElement('a');
          a.href = url.href;
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          a.click();
        }
      });
    });
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
      const peekPayload = ImGui.AcceptDragDropPayload('ASSET', ImGui.DragDropFlags.AcceptBeforeDelivery);
      const payload = ImGui.AcceptDragDropPayload('ASSET');
      if (payload || peekPayload) {
        if (!this._workspaceDragging) {
          this._workspaceDragging = true;
          const data = (payload ? payload.Data : peekPayload.Data) as { isDir: boolean; path: string }[];
          if (data.length === 1 && !data[0].isDir) {
            this.handleWorkspaceDragEnter('ASSET', data[0]);
          }
        }
        const mousePos = ImGui.GetMousePos();
        const pos = [mousePos.x, mousePos.y];
        if (this.posToViewport(pos, this.controller.model.scene.mainCamera.viewport)) {
          eventBus.dispatchEvent(
            payload ? 'workspace_drag_drop' : 'workspace_dragging',
            'ASSET',
            payload ? payload.Data : peekPayload.Data,
            pos[0],
            pos[1]
          );
        }
      }
      ImGui.EndDragDropTarget();
    } else if (this._workspaceDragging) {
      this._workspaceDragging = false;
      this.handleWorkspaceDragLeave();
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
    if (this._animatedCamera) {
      return true;
    }
    if (this.controller.model.scene.mainCamera.handleEvent(ev, type)) {
      return true;
    }
    const placeNode = this._nodeToBePlaced.get();
    if (placeNode && ev instanceof KeyboardEvent && ev.type === 'keydown' && ev.key === 'Escape') {
      placeNode.parent = null;
      this._nodeToBePlaced.dispose();
    }
    if (ev instanceof PointerEvent) {
      const p = [ev.offsetX, ev.offsetY];
      const insideViewport = this.posToViewport(p, this.controller.model.scene.mainCamera.viewport);
      this._mousePosX = insideViewport ? p[0] : -1;
      this._mousePosY = insideViewport ? p[1] : -1;
      if (this._postGizmoCaptured) {
        this._postGizmoRenderer.handlePointerEvent(ev.type, p[0], p[1], ev.button, this._pickResult);
        return true;
      }
      if (!insideViewport) {
        return false;
      }
      if (placeNode) {
        if (ev.type === 'pointerdown') {
          if (ev.button === 0) {
            const pos = placeNode.position.clone();
            this._nodeToBePlaced.dispose();
            switch (this._typeToBePlaced) {
              case 'asset':
                this._cmdManager
                  .execute(new AddAssetCommand(this.controller.model.scene, this._assetToBeAdded, pos))
                  .then((node) => {
                    this._sceneHierarchy.selectNode(node);
                    placeNode.parent = null;
                    eventBus.dispatchEvent('scene_changed');
                  });
                break;
              case 'prefab':
                this._cmdManager
                  .execute(new AddPrefabCommand(this.controller.model.scene, this._assetToBeAdded, pos))
                  .then((node) => {
                    this._sceneHierarchy.selectNode(node);
                    placeNode.parent = null;
                    eventBus.dispatchEvent('scene_changed');
                  });
                break;
              case 'shape':
                this._cmdManager
                  .execute(new AddShapeCommand(this.controller.model.scene, this._shapeToBeAdded.cls, pos))
                  .then((mesh) => {
                    this._sceneHierarchy.selectNode(mesh);
                    placeNode.parent = null;
                    eventBus.dispatchEvent('scene_changed');
                  });
                break;
              case 'node':
                this._cmdManager
                  .execute(
                    new AddChildCommand(
                      this.controller.model.scene.rootNode,
                      this._ctorToBePlaced,
                      pos
                    ).setDesc(this._descToBePlaced ?? 'Add node')
                  )
                  .then((node) => {
                    if (node instanceof DirectionalLight) {
                      node.sunLight = true;
                    }
                    this._sceneHierarchy.selectNode(node);
                    placeNode.parent = null;
                    this._proxy.createProxy(node);
                    eventBus.dispatchEvent('scene_changed');
                  });
                break;
            }
          }
        }
      }
      if (this._postGizmoRenderer.handlePointerEvent(ev.type, p[0], p[1], ev.button, this._pickResult)) {
        return true;
      }
      if (
        this._currentEditTool.get() ||
        !!placeNode?.parent ||
        (ev.button === 0 && ev.type === 'pointerdown')
      ) {
        const pickResult = this._pickResult;
        let node = pickResult?.target?.node ?? null;
        const hitPos = pickResult?.intersectedPoint ?? null;
        if (placeNode?.parent) {
          if (hitPos) {
            placeNode.position.set(hitPos);
          } else {
            const ray = this.controller.model.scene.mainCamera.constructRay(this._mousePosX, this._mousePosY);
            let hitDistance = -ray.origin.y / ray.direction.y;
            if (Number.isNaN(hitDistance) || hitDistance < 0) {
              hitDistance = 10;
            }
            const x = ray.origin.x + ray.direction.x * hitDistance;
            const y = ray.origin.y + ray.direction.y * hitDistance;
            const z = ray.origin.z + ray.direction.z * hitDistance;
            placeNode.position.setXYZ(x, y, z);
          }
        }
        if (
          !placeNode &&
          !this._currentEditTool.get()?.handlePointerEvent(ev, node, hitPos) &&
          ev.button === 0 &&
          ev.type === 'pointerdown'
        ) {
          if (node) {
            let assetNode = node;
            while (assetNode && !getEngine().resourceManager.getAssetId(assetNode)) {
              assetNode = assetNode.parent;
            }
            if (assetNode) {
              node = assetNode;
            }
          }
          node = this._proxy.getProto(node);
          if (!ImGui.GetIO().KeyAlt) {
            this._sceneHierarchy.selectNode(node?.getPrefabNode() ?? node);
          } else {
            this._sceneHierarchy.selectNode(node);
          }
        }
      }
    }
    return true;
  }
  lookAt(camera: Camera, node: SceneNode) {
    if (camera === node) {
      return;
    }
    const aabb = calcHierarchyBoundingBox(node);
    const nodePos = aabb.center;
    const radius = aabb.diagonalLength * 0.5;
    const distance = Math.max(radius / camera.getTanHalfFovy(), camera.getNearPlane() + 1);
    const cameraZ = camera.worldMatrix.getRow(2).xyz();
    const worldPos = Vector3.add(nodePos, Vector3.scale(cameraZ, Math.min(100, distance * 2)));
    const localEye = camera.parent.invWorldMatrix.transformPointAffine(worldPos);
    const localTarget = camera.parent.invWorldMatrix.transformPointAffine(nodePos);
    //camera.controller.lookAt(localEye, localTarget, Vector3.axisPY());
    this._animatedCamera = camera;
    camera.getWorldPosition(this._cameraAnimationEyeFrom);
    Vector3.sub(this._cameraAnimationEyeFrom, cameraZ, this._cameraAnimationTargetFrom);
    this._cameraAnimationEyeTo.set(localEye);
    this._cameraAnimationTargetTo.set(localTarget);
    this._cameraAnimationTime = 0;
  }
  private posToViewport(pos: number[], viewport: ArrayLike<number>): boolean {
    const cvs = getDevice().canvas;
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
    this._assetView = new BottomView(
      ProjectService.VFS,
      0,
      ImGui.GetIO().DisplaySize.y - this._statusbar.height - 300,
      ImGui.GetIO().DisplaySize.x,
      300
    );
    this._menubar.registerShortcuts(this);
    this._menubar.on('action', this.handleSceneAction, this);
    this._toolbar.registerShortcuts(this);
    this._toolbar.on('action', this.handleSceneAction, this);
    this._propGrid.on('object_property_changed', this.handleObjectPropertyChanged, this);
    this._propGrid.on('request_edit_aabb', this.editAABB, this);
    this._propGrid.on('end_edit_aabb', this.endEditAABB, this);
    this._propGrid.on('request_edit_track', this.editPropAnimation, this);
    this._propGrid.on('end_edit_track', this.endEditPropAnimation, this);
    eventBus.on('scene_add_asset', this.handleAddAsset, this);
    eventBus.on('workspace_drag_start', this.handleWorkspaceDragStart, this);
    eventBus.on('workspace_drag_end', this.handleWorkspaceDragEnd, this);
    eventBus.on('workspace_dragging', this.handleWorkspaceDragging, this);
    eventBus.on('workspace_drag_drop', this.handleWorkspaceDragDrop, this);
    eventBus.on('edit_material', this.editMaterial, this);
    eventBus.on('edit_material_function', this.editMaterialFunction, this);
    this.reset();
    this._sceneHierarchy.selectNode(this.controller.model.scene.rootNode);
  }
  protected onDeactivate(): void {
    super.onDeactivate();
    this._assetView?.dispose();
    this._assetView = null;
    this._menubar.unregisterShortcuts(this);
    this._menubar.off('action', this.handleSceneAction, this);
    this._toolbar.unregisterShortcuts(this);
    this._toolbar.off('action', this.handleSceneAction, this);
    this._propGrid.off('object_property_changed', this.handleObjectPropertyChanged, this);
    this._propGrid.off('request_edit_aabb', this.editAABB, this);
    this._propGrid.off('end_edit_aabb', this.endEditAABB, this);
    this._propGrid.off('request_edit_track', this.editPropAnimation, this);
    this._propGrid.off('end_edit_track', this.endEditPropAnimation, this);
    eventBus.off('scene_add_asset', this.handleAddAsset, this);
    eventBus.off('workspace_drag_start', this.handleWorkspaceDragStart, this);
    eventBus.off('workspace_drag_end', this.handleWorkspaceDragEnd, this);
    eventBus.off('workspace_dragging', this.handleWorkspaceDragging, this);
    eventBus.off('workspace_drag_drop', this.handleWorkspaceDragDrop, this);
    eventBus.off('edit_material', this.editMaterial, this);
    eventBus.off('edit_material_function', this.editMaterialFunction, this);
    this.sceneFinialize();
  }
  private sceneSetup() {
    if (this.controller.model.scene) {
      this._proxy = new NodeProxy(this.controller.model.scene);
      this._postGizmoRenderer = new PostGizmoRenderer(this.controller.model.scene.mainCamera, null);
      this._postGizmoRenderer.mode = 'select';
      this._leftDockPanel = new DockPannel(
        0,
        this._menubar.height + this._toolbar.height,
        300,
        0,
        8,
        200,
        600,
        ResizeDirection.Right
      );
      this._sceneHierarchy = new SceneHierarchy(this.controller.model.scene);
      this._sceneHierarchy.on('node_selected', this.handleNodeSelected, this);
      this._sceneHierarchy.on('node_deselected', this.handleNodeDeselected, this);
      this._sceneHierarchy.on('node_request_delete', this.handleDeleteNode, this);
      this._sceneHierarchy.on('node_drag_drop', this.handleNodeDragDrop, this);
      this._sceneHierarchy.on('node_double_clicked', this.handleNodeDoubleClicked, this);
      this._sceneHierarchy.on('set_main_camera', this.handleSetMainCamera, this);
      this._sceneHierarchy.on('request_add_child', this.handleAddChild, this);
      this._sceneHierarchy.on('request_save_prefab', this.handleSavePrefab, this);
      this.controller.model.scene.rootNode.on('noderemoved', this.handleNodeRemoved, this);
      this.controller.model.scene.rootNode.iterate((node) => {
        this._proxy.createProxy(node);
        if (node === this.controller.model.scene.mainCamera) {
          this._proxy.hideProxy(node);
        }
      });
      this._propGrid.clear();
      this._propGrid.object = this.controller.model.scene;
      this.controller.model.scene.on('startrender', this.handleStartRender, this);
      this.controller.model.scene.on('endrender', this.handleEndRender, this);
      this._postGizmoRenderer.on('begin_translate', this.handleBeginTransformNode, this);
      this._postGizmoRenderer.on('begin_rotate', this.handleBeginTransformNode, this);
      this._postGizmoRenderer.on('begin_scale', this.handleBeginTransformNode, this);
      this._postGizmoRenderer.on('end_translate', this.handleEndTranslateNode, this);
      this._postGizmoRenderer.on('end_rotate', this.handleEndRotateNode, this);
      this._postGizmoRenderer.on('end_scale', this.handleEndScaleNode, this);
      this._postGizmoRenderer.on('aabb_changed', this.handleEditAABB, this);
    }
  }
  private sceneFinialize() {
    this._leftDockPanel = null;
    this._propGrid.object = null;
    this._propGrid.clear();
    if (this._sceneHierarchy) {
      this._sceneHierarchy.off('node_selected', this.handleNodeSelected, this);
      this._sceneHierarchy.off('node_deselected', this.handleNodeDeselected, this);
      this._sceneHierarchy.off('node_request_delete', this.handleDeleteNode, this);
      this._sceneHierarchy.off('node_drag_drop', this.handleNodeDragDrop, this);
      this._sceneHierarchy.off('node_double_clicked', this.handleNodeDoubleClicked, this);
      this._sceneHierarchy.off('set_main_camera', this.handleSetMainCamera, this);
      this._sceneHierarchy.off('request_add_child', this.handleAddChild, this);
      this._sceneHierarchy.off('request_save_prefab', this.handleSavePrefab, this);
      this._sceneHierarchy = null;
    }
    if (this.controller.model.scene) {
      this.controller.model.scene.rootNode.off('noderemoved', this.handleNodeRemoved, this);
      this.controller.model.scene.off('startrender', this.handleStartRender, this);
      this.controller.model.scene.off('endrender', this.handleEndRender, this);
    }
    if (this._postGizmoRenderer) {
      this._postGizmoRenderer.off('begin_translate', this.handleBeginTransformNode, this);
      this._postGizmoRenderer.off('begin_rotate', this.handleBeginTransformNode, this);
      this._postGizmoRenderer.off('begin_scale', this.handleBeginTransformNode, this);
      this._postGizmoRenderer.off('end_translate', this.handleEndTranslateNode, this);
      this._postGizmoRenderer.off('end_rotate', this.handleEndRotateNode, this);
      this._postGizmoRenderer.off('end_scale', this.handleEndScaleNode, this);
      this._postGizmoRenderer.off('aabb_changed', this.handleEditAABB, this);
      this._postGizmoRenderer.dispose();
      this._postGizmoRenderer = null;
    }
    if (this._proxy) {
      this._proxy.dispose();
      this._proxy = null;
    }
    this.closeAllTrackEditors();
  }
  private renderDeviceInfo() {
    const device = getDevice();
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
  private closeAllTrackEditors() {
    for (const a of this._editingProps) {
      for (const b of a[1]) {
        const dlgIndex = DialogRenderer.findModeless(b[1].id);
        if (dlgIndex >= 0) {
          const dlg = DialogRenderer.getModeless(dlgIndex);
          if (dlg) {
            dlg.close(false);
          }
        }
      }
    }
  }
  private handleObjectPropertyChanged(object: object, prop: PropertyAccessor) {
    if (object instanceof SceneNode) {
      this._proxy.updateProxy(object);
    }
    const info = this._editingProps.get(object)?.get(prop);
    if (info) {
      const value = { num: [0, 0, 0, 0] };
      prop.get.call(object, value);
      const dlgIndex = DialogRenderer.findModeless(info.id);
      if (dlgIndex >= 0) {
        const dlg = DialogRenderer.getModeless(dlgIndex);
        if (dlg instanceof DlgEditColorTrack) {
          dlg.rampTextureCreator.setKeyframeValue(value.num);
        } else if (dlg instanceof DlgCurveEditor) {
          dlg.curveEditor.setKeyframeValue(value.num);
        }
      }
    }
    eventBus.dispatchEvent('scene_changed');
  }
  update(dt: number) {
    const selectedNode = this._sceneHierarchy.selectedNode;
    if (selectedNode?.isCamera() && selectedNode !== this.controller.model.scene.mainCamera) {
      this._proxy.updateProxy(selectedNode);
    }
    this._postGizmoRenderer.updateHitInfo(this._mousePosX, this._mousePosY);
    const placeNode = this._nodeToBePlaced.get();
    if (this._mousePosX >= 0 && this._mousePosY >= 0) {
      if (placeNode) {
        placeNode.parent = this.controller.model.scene.rootNode;
      }
      this.controller.model.scene.mainCamera
        .pickAsync(this._mousePosX, this._mousePosY)
        .then((pickResult) => {
          this._pickResult = pickResult;
        });
    } else if (placeNode) {
      placeNode.parent = null;
    }
    if (this._animatedCamera) {
      this._cameraAnimationTime += dt;
      const t = Math.min(this._cameraAnimationTime / this._cameraAnimationDuration, 1);
      this._animatedCamera.controller?.lookAt(
        Vector3.combine(this._cameraAnimationEyeFrom, this._cameraAnimationEyeTo, 1 - t, t),
        Vector3.combine(this._cameraAnimationTargetFrom, this._cameraAnimationTargetTo, 1 - t, t),
        Vector3.axisPY()
      );
      if (this._cameraAnimationTime >= this._cameraAnimationDuration) {
        this._animatedCamera = null;
      }
    }
    if (this._currentEditTool.get()) {
      this._currentEditTool.get().update(dt);
    }
  }
  private editPropAnimation(track: PropertyTrack, target: object) {
    let map = this._editingProps.get(target);
    if (!map) {
      map = new Map();
      this._editingProps.set(target, map);
    }
    const prop = track.getProp();
    let id = map.get(prop);
    if (!id) {
      const label =
        prop.type === 'rgb' || prop.type === 'rgba'
          ? `Edit animation track - ${getEngine().resourceManager.getPropertyName(prop)}`
          : `Edit animation track - ${getEngine().resourceManager.getPropertyName(prop)}`;
      const value: PropertyValue = { num: [0, 0, 0, 0] };
      prop.get.call(target, value);
      id = { id: `${label}##EditTrack${this._trackId++}`, value: value.num };
      map.set(prop, id);
    }
    if (prop.type === 'rgb' || prop.type === 'rgba') {
      Dialog.editColorTrack(
        id.id,
        prop.type === 'rgba',
        track.interpolator,
        track.interpolatorAlpha,
        (value) => {
          prop.set.call(target, { num: value });
        },
        600,
        500
      ).then((result) => {
        this.endEditPropAnimation(track, target, result);
      });
    } else {
      Dialog.editCurve(
        id.id,
        track.interpolator,
        (value) => {
          prop.set.call(target, { num: value });
        },
        600,
        500
      ).then((result) => {
        this.endEditPropAnimation(track, target, result);
      });
    }
  }
  private endEditPropAnimation(track: PropertyTrack, target: object, edited: boolean) {
    const prop = track.getProp();
    const map = this._editingProps.get(target);
    ASSERT(!!map, 'No editing track map found for target');
    const id = map.get(prop);
    if (id) {
      DialogRenderer.close(id.id, edited);
      prop.set.call(target, { num: id.value });
      map.delete(prop);
      if (map.size === 0) {
        this._editingProps.delete(target);
      }
    }
    if (edited) {
      eventBus.dispatchEvent('scene_changed');
    }
  }
  private editAABB(aabb: AABB) {
    this._aabbForEdit = aabb;
    this._postGizmoRenderer.editAABB(this._aabbForEdit);
  }
  private endEditAABB(aabb: AABB) {
    if (aabb === this._aabbForEdit) {
      this._aabbForEdit = null;
      this._postGizmoRenderer.endEditAABB();
      eventBus.dispatchEvent('scene_changed');
    }
  }
  private handleCopyNode(node: SceneNode) {
    if (node) {
      this._clipBoardData.set(node);
    }
  }
  private handlePasteNode() {
    if (this._clipBoardData.get()) {
      this.handleCloneNode(this._clipBoardData.get());
    }
  }
  private handleCloneNode(node: SceneNode) {
    if (!node) {
      return;
    }
    let hasTerrain = false;
    node.iterate((node) => {
      if (node.isTerrain() || node.isClipmapTerrain()) {
        hasTerrain = true;
        return true;
      }
      return false;
    });
    if (hasTerrain) {
      DlgMessage.messageBox('Error', 'Cloning terrain node is not allowed');
      return;
    }
    this._cmdManager.execute(new NodeCloneCommand(node)).then((sceneNode) => {
      sceneNode.position.x += 1;
      this._sceneHierarchy.selectNode(sceneNode);
    });
    eventBus.dispatchEvent('scene_changed');
  }
  private handleEditNode(node: SceneNode) {
    if (!node) {
      return;
    }
    if (!this._currentEditTool.get()) {
      this._currentEditTool.set(createEditTool(this.editor, node));
    } else {
      this._currentEditTool.dispose();
    }
  }
  private handleDeleteNode(node: SceneNode) {
    if (!node) {
      return;
    }
    if (node === this.controller.model.scene.mainCamera) {
      Dialog.messageBox('Zephyr3d editor', 'Cannot delete main camera');
      return;
    }
    const editTarget = this._currentEditTool.get()?.getTarget();
    if (editTarget instanceof SceneNode && editTarget.isParentOf(node)) {
      this._currentEditTool.dispose();
    }
    if (node.isParentOf(this._sceneHierarchy.selectedNode)) {
      this._sceneHierarchy.selectNode(null);
    }
    if (this._propGrid.object instanceof SceneNode && node.isParentOf(this._propGrid.object)) {
      this._propGrid.object = this.controller.model.scene;
    }
    if (node.isParentOf(this._postGizmoRenderer.node)) {
      this._postGizmoRenderer.node = null;
    }
    this._cmdManager.execute(new NodeDeleteCommand(node));
    eventBus.dispatchEvent('scene_changed');
  }
  private handleWorkspaceDragEnter(_type: string, payload: { isDir: boolean; path: string }) {
    const mimeType = getEngine().VFS.guessMIMEType(payload.path);
    if (mimeType === 'model/gltf-binary' || mimeType === 'model/gltf+json') {
      this.handleAddAsset(payload.path);
    } else if (mimeType === 'application/vnd.zephyr3d.prefab+json') {
      this.handleAddPrefab(payload.path);
    }
  }
  private handleWorkspaceDragLeave() {}
  private handleWorkspaceDragStart(_type: string, _payload: unknown) {
    this._renderDropZone = true;
  }
  private handleWorkspaceDragging(_type: string, _payload: unknown, x: number, y: number) {
    this._mousePosX = x;
    this._mousePosY = y;
    const placeNode = this._nodeToBePlaced?.get();
    if (placeNode) {
      const pickResult = this._pickResult;
      const p = [x, y];
      const hitPos = pickResult?.intersectedPoint ?? null;
      if (placeNode?.parent) {
        if (hitPos) {
          placeNode.position.set(hitPos);
        } else {
          const ray = this.controller.model.scene.mainCamera.constructRay(p[0], p[1]);
          let hitDistance = -ray.origin.y / ray.direction.y;
          if (Number.isNaN(hitDistance) || hitDistance < 0) {
            hitDistance = 10;
          }
          const x = ray.origin.x + ray.direction.x * hitDistance;
          const y = ray.origin.y + ray.direction.y * hitDistance;
          const z = ray.origin.z + ray.direction.z * hitDistance;
          placeNode.position.setXYZ(x, y, z);
        }
      }
    }
  }
  private handleWorkspaceDragDrop() {
    this._renderDropZone = false;
    const placeNode = this._nodeToBePlaced?.get();
    if (placeNode) {
      const pos = placeNode.position.clone();
      placeNode.parent = null;
      this._nodeToBePlaced.dispose();
      const command =
        this._typeToBePlaced === 'asset'
          ? new AddAssetCommand(this.controller.model.scene, this._assetToBeAdded, pos)
          : new AddPrefabCommand(this.controller.model.scene, this._assetToBeAdded, pos);
      this._cmdManager.execute(command).then((node) => {
        this._sceneHierarchy.selectNode(node);
        eventBus.dispatchEvent('scene_changed');
      });
    }
  }
  private editMaterial(label: string, name: string, path: string) {
    Dialog.editMaterial(label, name, path, 800, 600);
  }
  private editMaterialFunction(path: string) {
    Dialog.editMaterialFunction(path, path, 800, 600);
  }
  private handleWorkspaceDragEnd() {
    if (!this._workspaceDragging) {
      this._renderDropZone = false;
      const node = this._nodeToBePlaced?.get();
      if (node) {
        node.parent = null;
        this._nodeToBePlaced.dispose();
      }
    }
  }
  private handleNodeSelected(node: SceneNode) {
    this._postGizmoRenderer.node =
      node === node.scene.rootNode || node === this.controller.model.scene.mainCamera ? null : node;
    this._propGrid.object = node === node.scene.rootNode ? node.scene : node;
  }
  private handleNodeDeselected(node: SceneNode) {
    this._postGizmoRenderer.node = null;
    if (this._propGrid.object === node) {
      this._propGrid.object = this.controller.model.scene;
    }
  }
  private handleNodeDragDrop(src: SceneNode, dst: SceneNode) {
    if (src.parent !== dst && !src.isParentOf(dst)) {
      this._cmdManager.execute(new NodeReparentCommand(src, dst));
      eventBus.dispatchEvent('scene_changed');
    }
  }
  private handleNodeDoubleClicked(node: SceneNode) {
    this.lookAt(this.controller.model.scene.mainCamera, node);
  }
  private async handleAddShape(shapeCls: string) {
    const placeNode = this._nodeToBePlaced.get();
    if (placeNode) {
      placeNode.remove();
      this._nodeToBePlaced.dispose();
      this._typeToBePlaced = 'none';
    }
    const shape = await getEngine().resourceManager.fetchPrimitive(shapeCls);
    const material = await getEngine().resourceManager.fetchMaterial<MeshMaterial>(
      '/assets/@builtins/materials/pbr_metallic_roughness.zmtl'
    );
    const mesh = new Mesh(this.controller.model.scene, shape, material);
    mesh.gpuPickable = false;
    this._nodeToBePlaced.set(mesh);
    this._shapeToBeAdded = {
      cls: shapeCls
    };
    this._typeToBePlaced = 'shape';
    this._ctorToBePlaced = null;
  }
  private handleAddNode<T extends SceneNode>(ctor: { new (scene: Scene): T }, desc: string) {
    const placeNode = this._nodeToBePlaced.get();
    if (placeNode) {
      placeNode.remove();
      this._nodeToBePlaced.dispose();
      this._typeToBePlaced = 'none';
    }
    const node = new ctor(this.controller.model.scene);
    node.parent = null;
    node.gpuPickable = false;
    this._proxy.createProxy(node);
    this._nodeToBePlaced.set(node);
    this._typeToBePlaced = 'node';
    this._ctorToBePlaced = ctor;
    this._descToBePlaced = desc;
  }
  private handleAddPrefab(prefab: string) {
    const placeNode = this._nodeToBePlaced.get();
    if (placeNode) {
      placeNode.remove();
      this._nodeToBePlaced.dispose();
      this._typeToBePlaced = 'none';
    }
    getEngine()
      .resourceManager.instantiatePrefab(this.controller.model.scene.rootNode, prefab)
      .then((node) => {
        node.parent = null;
        node.iterate((node) => {
          node.gpuPickable = false;
        });
        this._nodeToBePlaced.set(node);
        this._assetToBeAdded = prefab;
        this._typeToBePlaced = 'prefab';
        this._ctorToBePlaced = null;
      });
  }
  private handleAddAsset(asset: string) {
    const placeNode = this._nodeToBePlaced.get();
    if (placeNode) {
      placeNode.remove();
      this._nodeToBePlaced.dispose();
      this._typeToBePlaced = 'none';
    }
    getEngine()
      .resourceManager.fetchModel(asset, this.controller.model.scene)
      .then((node) => {
        node.group.parent = null;
        node.group.iterate((node) => {
          node.gpuPickable = false;
        });
        this._nodeToBePlaced.set(node.group);
        this._assetToBeAdded = asset;
        this._typeToBePlaced = 'asset';
        this._ctorToBePlaced = null;
      })
      .catch((err) => {
        Dialog.messageBox('Error', `${err}`);
      });
  }
  private handleAddChild(parent: SceneNode, ctor: { new (scene: Scene): SceneNode }) {
    this._cmdManager.execute(new AddChildCommand(parent, ctor)).then((node) => {
      this._sceneHierarchy.selectNode(node);
      eventBus.dispatchEvent('scene_changed');
    });
  }
  private handleSavePrefab(node: SceneNode) {
    let hasTerrain = false;
    node.iterate((node) => {
      if (node.isTerrain() || node.isClipmapTerrain()) {
        hasTerrain = true;
        return true;
      }
      return false;
    });
    if (hasTerrain) {
      DlgMessage.messageBox('Error', 'Terrain node cannot be saved as prefab');
      return;
    }
    DlgSaveFile.saveFile(
      'Save Prefab',
      getEngine().VFS,
      '/assets',
      'Prefab (*.zprefab)|*.zprefab',
      500,
      400
    ).then((name) => {
      if (name) {
        ResourceService.savePrefab(
          node,
          getEngine().resourceManager,
          getEngine().VFS.dirname(name),
          getEngine().VFS.basename(name)
        );
      }
    });
  }
  private handleNodeRemoved(node: SceneNode) {
    if (node.isParentOf(this._postGizmoRenderer.node)) {
      this._postGizmoRenderer.node = null;
    }
    if (node.isParentOf(this._sceneHierarchy.selectedNode)) {
      this._sceneHierarchy.selectNode(null);
    }
  }
  private handleBeginTransformNode(node: SceneNode) {
    this._transformNode.set(node);
    this._oldTransform = {
      position: new Vector3(node.position),
      rotation: new Quaternion(node.rotation),
      scale: new Vector3(node.scale)
    };
    node.iterate((child) => {
      child.gpuPickable = false;
      return false;
    });
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
      node.iterate((child) => {
        child.gpuPickable = true;
        return false;
      });
      this._transformNode.dispose();
      this.controller.model.scene.octree.prune();
    }
    this._postGizmoCaptured = false;
  }
  private handleEndTranslateNode(node: SceneNode) {
    this.handleEndTransformNode(node, 'moving object');
    this._propGrid.dispatchEvent(
      'object_property_changed',
      node,
      getEngine().resourceManager.getPropertyByName('/SceneNode/Position')
    );
  }
  private handleEndRotateNode(node: SceneNode) {
    this.handleEndTransformNode(node, 'rotating object');
    this._propGrid.dispatchEvent(
      'object_property_changed',
      node,
      getEngine().resourceManager.getPropertyByName('/SceneNode/Rotation')
    );
  }
  private handleEndScaleNode(node: SceneNode) {
    this.handleEndTransformNode(node, 'scaling object');
    this._propGrid.dispatchEvent(
      'object_property_changed',
      node,
      getEngine().resourceManager.getPropertyByName('/SceneNode/Scale')
    );
  }
  private handleEditAABB(aabb: AABB) {
    if (this._aabbForEdit) {
      this._aabbForEdit.minPoint.set(aabb.minPoint);
      this._aabbForEdit.maxPoint.set(aabb.maxPoint);
    }
  }
  private handleSceneAction(action: string) {
    eventBus.dispatchEvent('action', action);
  }
  private handleStartRender(scene: Scene, camera: Camera, compositor: Compositor) {
    if (
      this._postGizmoRenderer &&
      camera === this.controller.model.scene.mainCamera &&
      (this._postGizmoRenderer.node || this._postGizmoRenderer.drawGrid)
    ) {
      this._postGizmoRenderer.camera = camera;
      compositor.appendPostEffect(this._postGizmoRenderer);
    }
  }
  private handleEndRender(scene: Scene, camera: Camera, compositor: Compositor) {
    if (
      this._postGizmoRenderer &&
      camera === this.controller.model.scene.mainCamera &&
      (this._postGizmoRenderer.node || this._postGizmoRenderer.drawGrid)
    ) {
      compositor.removePostEffect(this._postGizmoRenderer);
    }
  }
  private handleSetMainCamera(camera: Camera) {
    if (camera !== this.controller.model.scene.mainCamera) {
      this._proxy.showProxy(this.controller.model.scene.mainCamera);
      this.controller.model.scene.mainCamera.controller = null;
      this._proxy.hideProxy(camera);
      this.controller.model.scene.mainCamera = camera;
      this.controller.model.scene.mainCamera.controller = new EditorCameraController();
      this._postGizmoRenderer.camera = camera;
      this._postGizmoRenderer.node = null;
    }
  }
}
