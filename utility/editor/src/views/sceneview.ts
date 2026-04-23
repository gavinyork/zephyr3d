import { ImGui } from '@zephyr3d/imgui';
import type { SceneModel } from '../models/scenemodel';
import { PostGizmoRenderer } from './gizmo/postgizmo';
import type { TransformSpace } from './gizmo/postgizmo';
import { PropertyEditor } from '../components/grid';
import type {
  Camera,
  Compositor,
  PickResult,
  PropertyAccessor,
  PropertyTrack,
  Scene,
  MeshMaterial
} from '@zephyr3d/scene';
import {
  Mesh,
  ParticleSystem,
  PointLight,
  RectLight,
  SpotLight,
  Water,
  ClipmapTerrain,
  PerspectiveCamera,
  //OrthoCamera,
  getDevice,
  getEngine,
  Sprite
} from '@zephyr3d/scene';
import { SceneNode } from '@zephyr3d/scene';
import { DirectionalLight } from '@zephyr3d/scene';
import { eventBus } from '../core/eventbus';
import { ToolBar } from '../components/toolbar';
import type { ToolBarItem } from '../components/toolbar';
import { FontGlyph } from '../core/fontglyph';
import type { AABB, GenericConstructor, Nullable } from '@zephyr3d/base';
import { DRef, HttpFS } from '@zephyr3d/base';
import { ASSERT, Matrix4x4, Quaternion, Vector3 } from '@zephyr3d/base';
import type { TRS } from '../types';
import { Dialog } from './dlg/dlg';
import { renderTextureViewer } from '../components/textureviewer';
import { MenubarView } from '../components/menubar';
import type { MenuBarOptions } from '../components/menubar';
import { StatusBar } from '../components/statusbar';
import { BaseView } from './baseview';
import { CommandManager, CompositeCommand } from '../core/command';
import {
  AddAssetCommand,
  AddChildCommand,
  AddPrefabCommand,
  AddShapeCommand,
  PropertyEditCommand,
  NodeCloneCommand,
  NodeDeleteCommand,
  NodeReparentCommand,
  NodeTransformCommand
} from '../commands/scenecommands';
import { NodeProxy } from '../helpers/proxy';
import type { EditTool, EditToolContext } from './edittools/edittool';
import { createEditTool, isObjectEditable } from './edittools/edittool';
import { calcHierarchyBoundingBoxWorld } from '../helpers/misc';
import { DialogRenderer } from '../components/modal';
import { DlgEditColorTrack } from './dlg/editcolortrackdlg';
import { DlgCurveEditor } from './dlg/curveeditordlg';
import { BottomView } from '../components/bottomview';
import { ProjectService } from '../core/services/project';
import type { SceneController } from '../controllers/scenecontroller';
import { EditorCameraController } from '../helpers/editorcontroller';
import { ensureDependencies } from '../core/build/dep';
import { SceneHierarchy } from '../components/scenehierarchy';
import { DockPannel, ResizeDirection } from '../components/dockpanel';
import { DlgSaveFile } from './dlg/savefiledlg';
import { ResourceService } from '../core/services/resource';
import { DlgMessage } from './dlg/messagedlg';
import type { EditorMenuContext, EditorSceneContext } from '../core/plugin';
import type { EditorMenuItem } from '../core/plugin';

type ColliderKind = 'sphere' | 'capsule' | 'plane';
type MultiTransformItem = {
  node: SceneNode;
  startWorld: Matrix4x4;
  startTransform: TRS;
};
type PropertySnapshot = {
  num: number[];
  str: string[];
  bool: boolean[];
  object: object[];
};
type SyncedPropertyRecord = {
  oldValue: PropertySnapshot;
  newValue: PropertySnapshot;
};

export class SceneView extends BaseView<SceneModel, SceneController> {
  private readonly _cmdManager: CommandManager;
  private _postGizmoRenderer: Nullable<PostGizmoRenderer>;
  private _rightDockPanel: DockPannel;
  private readonly _propGrid: PropertyEditor;
  private readonly _toolbar: ToolBar;
  private _leftDockPanel: Nullable<DockPannel>;
  private _sceneHierarchy: Nullable<SceneHierarchy>;
  private readonly _menubar: MenubarView;
  private _assetView: Nullable<BottomView>;
  private readonly _statusbar: StatusBar;
  private readonly _transformNode: DRef<SceneNode>;
  private _oldTransform: Nullable<TRS>;
  private _workspaceDragging: boolean;
  private _renderDropZone: boolean;
  private readonly _nodeToBePlaced: DRef<SceneNode>;
  private _typeToBePlaced: 'shape' | 'asset' | 'prefab' | 'node' | 'none';
  private _ctorToBePlaced: Nullable<{ new (scene: Scene): SceneNode }>;
  private _descToBePlaced: Nullable<string>;
  private _assetToBeAdded: Nullable<string>;
  private _shapeToBeAdded: Nullable<{ cls: string }>;
  private _mousePosX: number;
  private _mousePosY: number;
  private _pickResult: Nullable<PickResult>;
  private _postGizmoCaptured: boolean;
  private _showTextureViewer: boolean;
  private _showDeviceInfo: boolean;
  private readonly _clipBoardData: DRef<SceneNode>;
  private _clipBoardNodes: SceneNode[];
  private _proxy: Nullable<NodeProxy>;
  private readonly _currentEditTool: DRef<EditTool>;
  private readonly _cameraAnimationEyeFrom: Vector3;
  private readonly _cameraAnimationTargetFrom: Vector3;
  private readonly _cameraAnimationEyeTo: Vector3;
  private readonly _cameraAnimationTargetTo: Vector3;
  private _cameraAnimationTime: number;
  private readonly _cameraAnimationDuration: number;
  private _animatedCamera: Nullable<Camera>;
  private readonly _editingProps: Map<object, Map<PropertyAccessor, { id: string; value: number[] }>>;
  private _trackId: number;
  private _lastDuplicateTarget: 'scene' | 'asset';
  private _multiTransformItems: MultiTransformItem[];
  private _multiTransformMasterStartWorld: Nullable<Matrix4x4>;
  private _multiTransformPivot: Nullable<SceneNode>;
  private _preferredTransformSpace: TransformSpace;
  private _suspendMultiPropertySync: boolean;
  private _syncedPropertySessions: Map<string, Map<SceneNode, SyncedPropertyRecord>>;
  private readonly _editToolContext: EditToolContext;
  private _activePluginContributionShortcuts: boolean;
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
    this._clipBoardNodes = [];
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
    this._lastDuplicateTarget = 'scene';
    this._multiTransformItems = [];
    this._multiTransformMasterStartWorld = null;
    this._multiTransformPivot = null;
    this._preferredTransformSpace = 'world';
    this._suspendMultiPropertySync = false;
    this._syncedPropertySessions = new Map();
    this._activePluginContributionShortcuts = false;
    this._editToolContext = {
      executeCommand: (command) => this._cmdManager.execute(command),
      notifySceneChanged: () => eventBus.dispatchEvent('scene_changed'),
      refreshProperties: () => this._propGrid.refresh(),
      getCamera: () => this.controller.model.scene.mainCamera ?? null,
      getViewportRect: () => {
        const viewport = this.controller.model.scene.mainCamera?.viewport;
        if (!viewport) {
          return null;
        }
        return [
          viewport[0],
          getDevice().canvas.clientHeight - viewport[1] - viewport[3],
          viewport[2],
          viewport[3]
        ];
      }
    };
    this._statusbar = new StatusBar();
    this._menubar = new MenubarView(this.createMenuOptions());
    this._toolbar = new ToolBar(
      'MainToolBar',
      this.createToolbarItems(),
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
  private createMenuOptions(): MenuBarOptions {
    const menuOptions: MenuBarOptions = {
      items: [
        {
          label: 'Project',
          id: 'project',
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
              label: 'System Plugins...',
              action: () => eventBus.dispatchEvent('action', 'SYSTEM_PLUGINS')
            },
            {
              label: 'Build Project',
              action: () => eventBus.dispatchEvent('action', 'BUILD_PROJECT')
            }
          ]
        },
        {
          label: 'Scene',
          id: 'scene',
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
          id: 'edit',
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
                this.handleCopySelectedNodes();
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
          id: 'add',
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
                },
                {
                  label: 'Rect Light',
                  action: () => this.handleAddNode(RectLight, 'Add rect light')
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
                /*
                {
                  label: 'Orthogonal Camera',
                  action: () => this.handleAddNode(OrthoCamera, 'Add orthogonal camera')
                }
                */
              ]
            },
            {
              label: 'Sprite',
              action: () => this.handleAddNode(Sprite, 'Add Sprite')
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
          id: 'view',
          subMenus: [
            {
              label: 'Grid',
              action: () => (this._postGizmoRenderer!.drawGrid = !this._postGizmoRenderer!.drawGrid),
              checked: () => !!this._postGizmoRenderer!.drawGrid
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
    };
    this.editor.plugins.applyMainMenuContributions(menuOptions.items, {
      location: 'main',
      scene: this.createSceneContext()
    });
    return menuOptions;
  }
  private createToolbarItems(): ToolBarItem[] {
    return (
      [
        {
          label: FontGlyph.glyphs['mouse-pointer'],
          shortcut: 'Q',
          tooltip: () => 'Select node',
          selected: () => {
            return this._postGizmoRenderer!.mode === 'select';
          },
          action: () => {
            // 检查是否正在处理摄像机移动
            const cameraController = this.controller.model.scene.mainCamera
              ?.controller as EditorCameraController;
            if (cameraController && cameraController.isRightMouseDown()) {
              return; // 如果正在处理摄像机移动，不激活选择工具
            }
            this._postGizmoRenderer!.mode = 'select';
          }
        },
        {
          label: FontGlyph.glyphs['move'],
          shortcut: 'W',
          tooltip: () => 'Move selected node',
          selected: () => {
            return this._postGizmoRenderer!.mode === 'translation';
          },
          action: () => {
            // 检查是否正在处理摄像机移动
            const cameraController = this.controller.model.scene.mainCamera
              ?.controller as EditorCameraController;
            if (cameraController && cameraController.isRightMouseDown()) {
              return; // 如果正在处理摄像机移动，不激活选择工具
            }
            this._postGizmoRenderer!.mode = 'translation';
          }
        },
        {
          label: FontGlyph.glyphs['arrows-cw'],
          shortcut: 'E',
          tooltip: () => 'Rotate selected node',
          selected: () => {
            return this._postGizmoRenderer!.mode === 'rotation';
          },
          action: () => {
            // 检查是否正在处理摄像机移动
            const cameraController = this.controller.model.scene.mainCamera
              ?.controller as EditorCameraController;
            if (cameraController && cameraController.isRightMouseDown()) {
              return; // 如果正在处理摄像机移动，不激活选择工具
            }
            this._postGizmoRenderer!.mode = 'rotation';
          }
        },
        {
          label: FontGlyph.glyphs['resize-vertical'],
          shortcut: 'R',
          tooltip: () => 'Scale selected node',
          selected: () => {
            return this._postGizmoRenderer!.mode === 'scaling';
          },
          action: () => {
            // 检查是否正在处理摄像机移动
            const cameraController = this.controller.model.scene.mainCamera
              ?.controller as EditorCameraController;
            if (cameraController && cameraController.isRightMouseDown()) {
              return; // 如果正在处理摄像机移动，不激活选择工具
            }
            this._postGizmoRenderer!.mode = 'scaling';
          }
        },
        {
          label: FontGlyph.glyphs['th-thumb-empty'],
          visible: () => {
            return (
              this.controller.model.scene.mainCamera.isOrtho() &&
              !!this._sceneHierarchy!.selectedNode?.isSprite()
            );
          },
          selected: () => {
            return this._postGizmoRenderer!.mode === 'edit-rect';
          },
          action: () => {
            this._postGizmoRenderer!.mode = 'edit-rect';
          }
        },
        {
          label: FontGlyph.glyphs['cancel'],
          shortcut: 'Delete',
          tooltip: () => 'Delete selected node',
          selected: () => {
            return (this._sceneHierarchy?.selectedNodes.size ?? 0) > 0;
          },
          action: () => {
            this.handleDeleteSelectedNodes();
          }
        },
        {
          label: '-'
        },
        {
          label: '',
          tooltip: () =>
            this.isTransformSpaceForcedWorld()
              ? 'Transform space (multi-selection uses World): click to set preferred space'
              : 'Transform space for move/rotate/scale',
          visible: () => this.isTransformModeActive(),
          selected: () => this._preferredTransformSpace === 'local',
          render: () => ImGui.Button(this._preferredTransformSpace === 'local' ? 'Local' : 'World'),
          action: () => {
            this._preferredTransformSpace = this._preferredTransformSpace === 'local' ? 'world' : 'local';
            this.updateGizmoTransformSpace();
          }
        },
        {
          label: '-',
          visible: () => this.isTransformModeActive()
        },
        {
          label: '',
          tooltip: () => 'Snap to grid when moving node (0 for no snap)',
          visible: () => {
            return this._postGizmoRenderer!.mode === 'translation';
          },
          selected: () => true,
          render: () => {
            const snapping = [this._postGizmoRenderer!.snapping] as [number];
            ImGui.SetNextItemWidth(50);
            if (ImGui.DragFloat('Snap', snapping, 0.1, 10, ImGui.InputTextFlags.EnterReturnsTrue)) {
              this._postGizmoRenderer!.snapping = Math.max(0, snapping[0]);
            }
            return false;
          }
        },
        {
          label: '-',
          visible: () => {
            return this._postGizmoRenderer!.mode === 'translation';
          }
        },
        {
          label: FontGlyph.glyphs['link'],
          shortcut: 'Ctrl+D',
          tooltip: () => 'Creatas an instance of current node',
          selected: () => {
            return (this._sceneHierarchy?.selectedNodes.size ?? 0) > 0;
          },
          action: () => {
            this.handleCloneSelectedNodes();
          }
        },
        {
          label: FontGlyph.glyphs['eye'],
          shortcut: 'F',
          tooltip: () => 'Focus on selected node',
          selected: () => {
            return !!this._sceneHierarchy!.selectedNode;
          },
          action: () => {
            const node = this._sceneHierarchy!.selectedNode;
            if (node) {
              this.lookAt(this.controller.model.scene.mainCamera!, node);
            }
          }
        },
        {
          label: FontGlyph.glyphs['pencil'],
          tooltip: () => 'Edit selected node',
          visible: () =>
            !!this._currentEditTool.get() ||
            (!this._currentEditTool.get() &&
              isObjectEditable(this.editor, this._sceneHierarchy!.selectedNode, this._editToolContext)),
          selected: () => {
            return !!this._currentEditTool.get();
          },
          action: () => {
            const selectedNode = this._sceneHierarchy!.selectedNode;
            if (selectedNode) {
              this.handleEditNode(selectedNode);
            }
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
            return (this._sceneHierarchy?.selectedNodes.size ?? 0) > 0;
          },
          action: () => {
            this.handleCopySelectedNodes();
          }
        },
        {
          label: FontGlyph.glyphs['paste'],
          shortcut: 'Ctrl+V',
          tooltip: () => 'Paste',
          selected: () => {
            return this._clipBoardNodes.length > 0 || !!this._clipBoardData.get();
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
        },
        {
          label: FontGlyph.glyphs['eye'],
          id: 'PLAY_CURRENT_SCENE',
          selected: () => true,
          tooltip: () => {
            return 'Preview current scene in new tab';
          },
          action: () => {
            this.playCurrentScene();
          }
        }
      ] as ToolBarItem[]
    ).concat(this.editor.plugins.getToolbarItems({ scene: this.createSceneContext() }));
  }
  private refreshPluginContributions() {
    if (this._activePluginContributionShortcuts) {
      this._menubar.unregisterShortcuts(this);
      this._toolbar.unregisterShortcuts(this);
    }
    this._menubar.options = this.createMenuOptions();
    this._toolbar.tools = this.createToolbarItems();
    if (this._activePluginContributionShortcuts) {
      this._menubar.registerShortcuts(this);
      this._toolbar.registerShortcuts(this);
    }
  }
  private createSceneContext(): EditorSceneContext {
    return {
      editor: this.editor,
      scene: this.controller.model.scene,
      selectedNodes: this.getSelectedSceneNodes(),
      activeNode: this._sceneHierarchy?.selectedNode ?? null,
      commandManager: this._cmdManager,
      executeCommand: (command) => this._cmdManager.execute(command),
      notifySceneChanged: () => eventBus.dispatchEvent('scene_changed'),
      refreshProperties: () => this._propGrid.refresh(),
      getCamera: () => this.controller.model.scene?.mainCamera ?? null,
      getViewportRect: () => this._editToolContext.getViewportRect()
    };
  }
  private renderContextMenuItems(items: readonly EditorMenuItem[], ctx: EditorMenuContext) {
    this.editor.plugins.renderMenuItems(items, ctx);
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
    this._assetView!.panel.top = displaySize.y - this._statusbar.height - this._assetView!.panel.height;
    this._assetView!.panel.width = Math.max(0, displaySize.x - this._rightDockPanel.width);
    this._leftDockPanel!.height =
      displaySize.y -
      this._menubar.height -
      this._toolbar.height -
      this._statusbar.height -
      this._assetView!.panel.height;

    this._menubar.render(this.controller.editor.currentProject.name);

    if (
      this._leftDockPanel!.begin(
        '##SceneHierarchyPanel'
        //this._sceneHierarchy.draggingItem ? ImGui.WindowFlags.NoScrollbar : 0
      )
    ) {
      this._sceneHierarchy!.render(this.controller.editor.sceneChanged);
    }
    this._leftDockPanel!.end();

    if (this._rightDockPanel.begin('##PropertyGridPanel')) {
      this._propGrid.render();
    }
    this._rightDockPanel.end();

    this._toolbar.render();
    this._assetView!.render();

    const camera = this.controller.model.scene.mainCamera;

    const viewportWidth = displaySize.x - this._leftDockPanel!.width - this._rightDockPanel.width;
    const viewportHeight =
      displaySize.y -
      this._statusbar.height -
      this._menubar.height -
      this._toolbar.height -
      this._assetView!.panel.height;
    if (viewportWidth > 0 && viewportHeight > 0) {
      camera.screenViewport = [
        this._leftDockPanel!.width,
        this._statusbar.height + this._assetView!.panel.height,
        viewportWidth,
        viewportHeight
      ];
      camera.viewport = camera.screenViewport;
      camera.scissor = camera.screenViewport;
      camera!.render(this.controller.model.scene);

      // Render selected camera
      const selectedNode = this._sceneHierarchy!.selectedNode;
      if (selectedNode instanceof PerspectiveCamera && selectedNode !== camera) {
        selectedNode.viewport = [camera!.viewport![0] + 20, camera!.viewport![1] + 20, 300, 200];
        selectedNode.scissor = selectedNode.viewport;
        selectedNode.aspect = selectedNode.viewport[2] / selectedNode.viewport[3];
        selectedNode.render(this.controller.model.scene);
      }

      if (this._renderDropZone) {
        this.renderDropZone(
          this._leftDockPanel!.width,
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
        if (!settings!.startupScene && !settings!.startupScript) {
          DlgMessage.messageBox('Error', 'Please set startup scene or startup script in <Project Settings>');
        } else {
          this.openPreviewInNewTab();
        }
      });
    });
  }
  async playCurrentScene() {
    await ensureDependencies();
    if (!(await this.controller.ensureSceneSaved())) {
      return;
    }
    const scenePath = this.controller.scenePath;
    if (!scenePath) {
      await DlgMessage.messageBox('Error', 'Please save current scene first.');
      return;
    }
    this.openPreviewInNewTab(scenePath);
  }
  private openPreviewInNewTab(sceneOverride?: string) {
    const projectId = this.controller.editor.currentProject.uuid!;
    const url = new URL(window.location.href);
    url.search = '';
    url.searchParams.append('project', projectId);
    if (sceneOverride) {
      url.searchParams.append('scene', sceneOverride);
    }
    if (ProjectService.VFS instanceof HttpFS) {
      url.searchParams.append('remote', '');
    }
    const a = document.createElement('a');
    a.href = url.href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.click();
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
          const data = (payload ? payload.Data : peekPayload!.Data) as { isDir: boolean; path: string }[];
          if (data.length === 1 && !data[0].isDir) {
            this.handleWorkspaceDragEnter('ASSET', data[0]);
          }
        }
        const mousePos = ImGui.GetMousePos();
        const pos = [mousePos.x, mousePos.y];
        if (this.posToViewport(pos, this.controller.model.scene.mainCamera!.viewport!)) {
          eventBus.dispatchEvent(
            payload ? 'workspace_drag_drop' : 'workspace_dragging',
            'ASSET',
            payload ? payload.Data : peekPayload!.Data,
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
    if (this.controller.model.scene.mainCamera!.handleEvent(ev, type)) {
      return true;
    }
    const placeNode = this._nodeToBePlaced.get();
    if (placeNode && ev instanceof KeyboardEvent && ev.type === 'keydown' && ev.key === 'Escape') {
      placeNode.parent = null;
      this._nodeToBePlaced.dispose();
    }
    if (ev instanceof PointerEvent) {
      const p = [ev.offsetX, ev.offsetY];
      const insideViewport = this.posToViewport(p, this.controller.model.scene.mainCamera!.viewport!);
      this._mousePosX = insideViewport ? p[0] : -1;
      this._mousePosY = insideViewport ? p[1] : -1;
      if (this._postGizmoCaptured) {
        this._postGizmoRenderer!.handlePointerEvent(ev.type, p[0], p[1], ev.button, this._pickResult!);
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
                  .execute(new AddAssetCommand(this.controller.model.scene, this._assetToBeAdded!, pos))
                  .then((node) => {
                    this._sceneHierarchy!.selectNode(node);
                    placeNode.parent = null;
                    this.editor.plugins.dispatchEvent('nodeAdded', node);
                    eventBus.dispatchEvent('scene_changed');
                  });
                break;
              case 'prefab':
                this._cmdManager
                  .execute(new AddPrefabCommand(this.controller.model.scene, this._assetToBeAdded!, pos))
                  .then((node) => {
                    this._sceneHierarchy!.selectNode(node);
                    placeNode.parent = null;
                    this.editor.plugins.dispatchEvent('nodeAdded', node);
                    eventBus.dispatchEvent('scene_changed');
                  });
                break;
              case 'shape':
                this._cmdManager
                  .execute(new AddShapeCommand(this.controller.model.scene, this._shapeToBeAdded!.cls, pos))
                  .then((mesh) => {
                    this._sceneHierarchy!.selectNode(mesh);
                    placeNode.parent = null;
                    this.editor.plugins.dispatchEvent('nodeAdded', mesh);
                    eventBus.dispatchEvent('scene_changed');
                  });
                break;
              case 'node':
                this._cmdManager
                  .execute(
                    new AddChildCommand(
                      this.controller.model.scene.rootNode,
                      this._ctorToBePlaced!,
                      pos
                    ).setDesc(this._descToBePlaced ?? 'Add node')
                  )
                  .then((node) => {
                    if (node instanceof DirectionalLight) {
                      node.sunLight = true;
                    }
                    this._sceneHierarchy!.selectNode(node);
                    placeNode.parent = null;
                    this._proxy!.createProxy(node!);
                    this.editor.plugins.dispatchEvent('nodeAdded', node);
                    eventBus.dispatchEvent('scene_changed');
                  });
                break;
            }
          }
        }
      }
      if (this._postGizmoRenderer!.handlePointerEvent(ev.type, p[0], p[1], ev.button, this._pickResult!)) {
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
            const ray = this.controller.model.scene.mainCamera!.constructRay(
              this._mousePosX,
              this._mousePosY
            );
            let hitDistance = -ray.origin.y / ray.direction.y;
            if (Number.isNaN(hitDistance) || !Number.isFinite(hitDistance) || hitDistance < 0) {
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
          !this._currentEditTool.get()?.handlePointerEvent(ev, node, hitPos!) &&
          ev.button === 0 &&
          ev.type === 'pointerdown'
        ) {
          node = this._proxy!.getProto(node!);
          this.applySceneViewSelection(node, ImGui.GetIO().KeyCtrl, ImGui.GetIO().KeyShift);
        }
      }
    }
    return true;
  }
  private applySceneViewSelection(node: Nullable<SceneNode>, ctrl: boolean, shift: boolean) {
    const targetNode = this.resolvePickedSelectionTarget(node);
    if (!ctrl && !shift) {
      this._sceneHierarchy!.selectNode(targetNode);
      return;
    }
    if (!targetNode) {
      return;
    }
    const currentSelection = new Set(this.getSelectedSceneNodes());
    if (ctrl) {
      if (currentSelection.has(targetNode)) {
        currentSelection.delete(targetNode);
      } else {
        currentSelection.add(targetNode);
      }
      const nextSelection = [...currentSelection];
      const activeNode =
        nextSelection.length > 0
          ? currentSelection.has(targetNode)
            ? targetNode
            : nextSelection[nextSelection.length - 1]
          : null;
      this._sceneHierarchy!.selectNodes(nextSelection, activeNode);
      return;
    }
    currentSelection.add(targetNode);
    this._sceneHierarchy!.selectNodes([...currentSelection], targetNode);
  }
  private getPickSelectionRoot(node: Nullable<SceneNode>): Nullable<SceneNode> {
    if (!node) {
      return null;
    }
    let assetNode = node;
    while (assetNode && !getEngine().resourceManager.getAssetId(assetNode)) {
      assetNode = assetNode.parent!;
    }
    const targetNode = assetNode ?? node;
    return targetNode.getPrefabNode() ?? targetNode;
  }
  private resolvePickedSelectionTarget(node: Nullable<SceneNode>): Nullable<SceneNode> {
    if (!node) {
      return null;
    }
    const rootNode = this.getPickSelectionRoot(node);
    const selectedNode = this._sceneHierarchy?.selectedNode ?? null;
    const selectedRootNode = this.getPickSelectionRoot(selectedNode);
    const isSameRootSubNodeSelection =
      !!selectedNode &&
      !!selectedRootNode &&
      selectedRootNode === rootNode &&
      selectedNode !== selectedRootNode;
    if (isSameRootSubNodeSelection && node !== rootNode) {
      return node;
    }
    return selectedNode === rootNode && node !== rootNode ? node : rootNode;
  }
  lookAt(camera: Camera, node: SceneNode) {
    if (camera === node) {
      return;
    }
    const aabb = calcHierarchyBoundingBoxWorld(node);
    const nodePos = aabb.center;
    const radius = aabb.diagonalLength * 0.5;
    const distance = Math.max(radius / camera.getTanHalfFovy(), camera.getNearPlane() + 1);
    const cameraZ = camera.worldMatrix.getRow(2).xyz();
    const worldPos = Vector3.add(nodePos, Vector3.scale(cameraZ, Math.min(100, distance * 2)));
    const localEye = camera.parent!.invWorldMatrix.transformPointAffine(worldPos);
    const localTarget = camera.parent!.invWorldMatrix.transformPointAffine(nodePos);
    //camera.controller.lookAt(localEye, localTarget, Vector3.axisPY());

    // 新增：更新视图中心到选中物体的中心
    const controller = camera.controller as EditorCameraController;
    if (controller && controller.setViewCenter) {
      controller.setViewCenter(nodePos);
    }

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
      300,
      this.editor
    );
    this._menubar.registerShortcuts(this);
    this._menubar.on('action', this.handleSceneAction, this);
    this._toolbar.registerShortcuts(this);
    this._activePluginContributionShortcuts = true;
    this.registerShortcut('Ctrl+D', () => {
      this.handleDuplicateShortcut();
    });
    this._toolbar.on('action', this.handleSceneAction, this);
    this.editor.plugins.on('pluginContributionsChanged', this.refreshPluginContributions, this);
    this._assetView.renderer.on('selection_changed', this.handleAssetSelectionChanged, this);
    this._propGrid.on('object_property_changed', this.handleObjectPropertyChanged, this);
    this._propGrid.on('object_property_edit_finished', this.handleObjectPropertyEditFinished, this);
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
    this._sceneHierarchy!.selectNode(this.controller.model.scene.rootNode);
  }
  protected onDeactivate(): void {
    super.onDeactivate();
    this._assetView?.renderer.off('selection_changed', this.handleAssetSelectionChanged, this);
    this._assetView?.dispose();
    this._assetView = null;
    this._menubar.unregisterShortcuts(this);
    this._menubar.off('action', this.handleSceneAction, this);
    this._toolbar.unregisterShortcuts(this);
    this._activePluginContributionShortcuts = false;
    this._toolbar.off('action', this.handleSceneAction, this);
    this.editor.plugins.off('pluginContributionsChanged', this.refreshPluginContributions, this);
    this._propGrid.off('object_property_changed', this.handleObjectPropertyChanged, this);
    this._propGrid.off('object_property_edit_finished', this.handleObjectPropertyEditFinished, this);
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
      this._postGizmoRenderer = new PostGizmoRenderer(this.controller.model.scene.mainCamera!, null);
      this._postGizmoRenderer.mode = 'select';
      this.updateGizmoTransformSpace();
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
      this._sceneHierarchy = new SceneHierarchy(
        this.controller.model.scene,
        () => this.controller.openedSceneName,
        (node) => ({
          location: 'scene-hierarchy',
          scene: this.createSceneContext(),
          target: node
        }),
        (items, ctx) => this.renderContextMenuItems(items, ctx)
      );
      this._sceneHierarchy.on('selection_changed', this.handleHierarchySelectionChanged, this);
      this._sceneHierarchy.on('node_selected', this.handleNodeSelected, this);
      this._sceneHierarchy.on('node_deselected', this.handleNodeDeselected, this);
      this._sceneHierarchy.on('node_request_delete', this.handleDeleteNode, this);
      this._sceneHierarchy.on('node_drag_drop', this.handleNodeDragDrop, this);
      this._sceneHierarchy.on('node_double_clicked', this.handleNodeDoubleClicked, this);
      this._sceneHierarchy.on('set_main_camera', this.handleSetMainCamera, this);
      this._sceneHierarchy.on('request_go_to_assets', this.handleGoToAssets, this);
      this._sceneHierarchy.on('request_add_child', this.handleAddChild, this);
      this._sceneHierarchy.on('request_save_prefab', this.handleSavePrefab, this);
      this._sceneHierarchy.on('request_add_collider', this.handleAddCollider, this);
      this.controller.model.scene.rootNode.on('nodeattached', this.handleNodeAttached, this);
      this.controller.model.scene.rootNode.on('noderemoved', this.handleNodeRemoved, this);
      this.syncNodeProxyTree(this.controller.model.scene.rootNode);
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
    }
  }
  private sceneFinialize() {
    this._leftDockPanel = null;
    this._multiTransformPivot = null;
    this._syncedPropertySessions.clear();
    this._propGrid.object = null;
    this._propGrid.clear();
    if (this._sceneHierarchy) {
      this._sceneHierarchy.off('selection_changed', this.handleHierarchySelectionChanged, this);
      this._sceneHierarchy.off('node_selected', this.handleNodeSelected, this);
      this._sceneHierarchy.off('node_deselected', this.handleNodeDeselected, this);
      this._sceneHierarchy.off('node_request_delete', this.handleDeleteNode, this);
      this._sceneHierarchy.off('node_drag_drop', this.handleNodeDragDrop, this);
      this._sceneHierarchy.off('node_double_clicked', this.handleNodeDoubleClicked, this);
      this._sceneHierarchy.off('set_main_camera', this.handleSetMainCamera, this);
      this._sceneHierarchy.off('request_go_to_assets', this.handleGoToAssets, this);
      this._sceneHierarchy.off('request_add_child', this.handleAddChild, this);
      this._sceneHierarchy.off('request_save_prefab', this.handleSavePrefab, this);
      this._sceneHierarchy.off('request_add_collider', this.handleAddCollider, this);
      this._sceneHierarchy = null;
    }
    if (this.controller.model.scene) {
      this.controller.model.scene.rootNode.off('nodeattached', this.handleNodeAttached, this);
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
      this._proxy!.updateProxy(object);
      this.syncPropertyToMultiSelection(object, prop);
    } else if (this.shouldRefreshSelectedColliderProxy(prop)) {
      const selectedNode = this._sceneHierarchy?.selectedNode;
      if (selectedNode) {
        this._proxy!.updateProxy(selectedNode);
      }
    }
    const info = this._editingProps.get(object)?.get(prop);
    if (info) {
      const value = { num: [0, 0, 0, 0], str: [], object: [], bool: [] };
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
    this.editor.plugins.dispatchEvent('propertyChanged', object, prop);
    eventBus.dispatchEvent('scene_changed');
  }
  private async handleObjectPropertyEditFinished(
    object: Nullable<object>,
    prop: PropertyAccessor,
    oldValue: PropertySnapshot,
    newValue: PropertySnapshot
  ) {
    if (!object || !prop?.set) {
      return;
    }
    const source = object as object;
    const commands: PropertyEditCommand[] = [];
    if (!this.isSamePropertyValue(oldValue, newValue)) {
      commands.push(
        new PropertyEditCommand(
          source,
          prop,
          this.clonePropertyValue(oldValue),
          this.clonePropertyValue(newValue)
        )
      );
    }

    if (source instanceof SceneNode) {
      const sessionKey = this.getPropertySessionKey(source, prop);
      const syncedTargets = this._syncedPropertySessions.get(sessionKey);
      if (syncedTargets?.size) {
        for (const [target, record] of syncedTargets) {
          if (!this.isSamePropertyValue(record.oldValue, record.newValue)) {
            commands.push(
              new PropertyEditCommand(
                target,
                prop,
                this.clonePropertyValue(record.oldValue),
                this.clonePropertyValue(record.newValue),
                `Edit property ${prop.name} (multi)`
              )
            );
          }
        }
      }
      this._syncedPropertySessions.delete(sessionKey);
    }
    if (commands.length === 1) {
      await this._cmdManager.execute(commands[0]);
    } else if (commands.length > 1) {
      await this._cmdManager.execute(new CompositeCommand(`Edit property ${prop.name}`, commands));
    }
    this.editor.plugins.dispatchEvent('propertyEditFinished', object, prop, oldValue, newValue);
    eventBus.dispatchEvent('scene_changed');
  }
  private shouldRefreshSelectedColliderProxy(prop: PropertyAccessor) {
    const selectedNode = this._sceneHierarchy?.selectedNode;
    if (!selectedNode || !selectedNode.metaData || typeof selectedNode.metaData !== 'object') {
      return false;
    }
    const collider =
      (selectedNode.metaData as any).sceneCollider ?? (selectedNode.metaData as any).springCollider;
    if (!collider || typeof collider !== 'object') {
      return false;
    }
    const cls = getEngine().resourceManager.getClassByProperty(prop);
    if (!cls) {
      return false;
    }
    return (
      cls.name === 'JSONProp' ||
      cls.name === 'JSONString' ||
      cls.name === 'JSONNumber' ||
      cls.name === 'JSONBool' ||
      cls.name === 'JSONData' ||
      cls.name === 'JSONArray'
    );
  }
  update(dt: number) {
    const selectedNode = this._sceneHierarchy!.selectedNode;
    if (selectedNode?.isCamera() && selectedNode !== this.controller.model.scene.mainCamera) {
      this._proxy!.updateProxy(selectedNode);
    }
    this._postGizmoRenderer!.updateHitInfo(this._mousePosX, this._mousePosY);
    const placeNode = this._nodeToBePlaced.get();
    if (this._mousePosX >= 0 && this._mousePosY >= 0) {
      if (placeNode) {
        placeNode.parent = this.controller.model.scene.rootNode;
      }
      this.controller.model.scene
        .mainCamera!.pickAsync(this._mousePosX, this._mousePosY)
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
        const controller = this._animatedCamera.controller as EditorCameraController;
        controller?.syncCameraDistanceToViewCenter?.();
        this._animatedCamera = null;
      }
    }
    if (!this._postGizmoCaptured && this._postGizmoRenderer?.node === this._multiTransformPivot) {
      this.updateMultiTransformPivot();
    }
    if (this._postGizmoCaptured) {
      const masterNode = this._transformNode.get();
      if (masterNode) {
        this.applyMultiTransformFromMaster(masterNode);
      }
    }
    if (this._currentEditTool.get()) {
      this._currentEditTool.get()!.update(dt);
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
      const value = { num: [0, 0, 0, 0], str: [], object: [], bool: [] };
      prop.get.call(target, value);
      id = { id: `${label}##EditTrack${this._trackId++}`, value: value.num };
      map.set(prop, id);
    }
    if (prop.type === 'rgb' || prop.type === 'rgba') {
      Dialog.editColorTrack(
        id.id,
        prop.type === 'rgba',
        track.interpolator!,
        track.interpolatorAlpha!,
        (value) => {
          prop.set!.call(target, { num: value, str: [], bool: [], object: [] });
        },
        600,
        500
      ).then((result) => {
        this.endEditPropAnimation(track, target, result);
      });
    } else {
      Dialog.editCurve(
        id.id,
        track.interpolator!,
        (value) => {
          prop.set!.call(target, { num: value, str: [], object: [], bool: [] });
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
      prop.set!.call(target, { num: id.value, str: [], object: [], bool: [] });
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
    this._postGizmoRenderer!.editAABB(aabb);
  }
  private endEditAABB(aabb: AABB) {
    this._postGizmoRenderer!.endEditAABB(aabb);
  }
  private handleCopySelectedNodes() {
    const selectedNodes = this.getTopLevelSelection(this.getSelectedSceneNodes()).filter(
      (node) => node !== this.controller.model.scene.rootNode
    );
    if (selectedNodes.length === 0) {
      this._clipBoardData.dispose();
      this._clipBoardNodes = [];
      return;
    }
    this._clipBoardData.set(selectedNodes[0]);
    this._clipBoardNodes = selectedNodes;
  }
  private async handlePasteNode() {
    const clipNodes = this._clipBoardNodes.length
      ? this._clipBoardNodes
      : this._clipBoardData.get()
        ? [this._clipBoardData.get()!]
        : [];
    if (clipNodes.length === 0) {
      return;
    }
    const commands: NodeCloneCommand[] = [];
    for (const node of clipNodes) {
      if (!node || node === this.controller.model.scene.rootNode) {
        continue;
      }
      let hasTerrain = false;
      node.iterate((child) => {
        if (child.isClipmapTerrain()) {
          hasTerrain = true;
          return true;
        }
        return false;
      });
      if (hasTerrain) {
        DlgMessage.messageBox('Error', 'Cloning terrain node is not allowed');
        continue;
      }
      commands.push(new NodeCloneCommand(node));
    }
    if (commands.length === 0) {
      return;
    }
    const result =
      commands.length === 1
        ? [await this._cmdManager.execute(commands[0])]
        : ((await this._cmdManager.execute(new CompositeCommand('Paste nodes', commands))) as SceneNode[]);
    const clonedNodes: SceneNode[] = [];
    let lastCloned: Nullable<SceneNode> = null;
    for (let i = 0; i < result.length; i++) {
      const sceneNode = result[i];
      if (!sceneNode) {
        continue;
      }
      sceneNode.position.x += 1;
      clonedNodes.push(sceneNode);
      lastCloned = sceneNode;
    }
    if (clonedNodes.length > 0) {
      this._sceneHierarchy!.selectNodes(clonedNodes, lastCloned);
      for (const node of clonedNodes) {
        this.editor.plugins.dispatchEvent('nodeAdded', node);
      }
      eventBus.dispatchEvent('scene_changed');
    }
  }
  private handleEditNode(node: SceneNode) {
    if (!node) {
      return;
    }
    const currentTool = this._currentEditTool.get();
    if (!currentTool) {
      const tool = createEditTool(this.editor, node, this._editToolContext);
      this._currentEditTool.set(tool);
      if (tool) {
        this.editor.plugins.dispatchEvent('editToolActivated', tool, node);
      }
      return;
    }
    const currentTarget = currentTool.getTarget();
    const sameTarget =
      currentTarget === node || (currentTarget instanceof SceneNode && currentTarget.isParentOf(node));
    if (sameTarget) {
      this.editor.plugins.dispatchEvent('editToolDeactivated', currentTool, currentTarget);
      this._currentEditTool.dispose();
    } else {
      this.editor.plugins.dispatchEvent('editToolDeactivated', currentTool, currentTarget);
      const tool = createEditTool(this.editor, node, this._editToolContext);
      this._currentEditTool.set(tool);
      if (tool) {
        this.editor.plugins.dispatchEvent('editToolActivated', tool, node);
      }
    }
  }
  private getSelectedSceneNodes() {
    return this._sceneHierarchy ? [...this._sceneHierarchy.selectedNodes] : [];
  }
  private getTransformSelectionNodes(source?: SceneNode) {
    const selected = this.getTopLevelSelection(this.getSelectedSceneNodes()).filter(
      (node) =>
        node !== this.controller.model.scene.rootNode &&
        node !== this.controller.model.scene.mainCamera &&
        (!source || node !== source)
    );
    return selected;
  }
  private getTopLevelSelection(nodes: SceneNode[]) {
    return nodes.filter((node) => !nodes.some((other) => other !== node && other.isParentOf(node)));
  }
  private ensureMultiTransformPivot() {
    if (!this._multiTransformPivot) {
      this._multiTransformPivot = new SceneNode(this.controller.model.scene);
      this._multiTransformPivot.name = '__multi_transform_pivot__';
      this._multiTransformPivot.sealed = true;
      this._multiTransformPivot.gpuPickable = false;
      this._multiTransformPivot.parent = null;
    }
    return this._multiTransformPivot;
  }
  private updateMultiTransformPivot() {
    const nodes = this.getTransformSelectionNodes();
    if (nodes.length <= 1) {
      return null;
    }
    const pivot = this.ensureMultiTransformPivot();
    const center = new Vector3();
    for (const node of nodes) {
      center.addBy(node.getWorldPosition());
    }
    center.scaleBy(1 / nodes.length);
    pivot.position.set(center);
    pivot.rotation.identity();
    pivot.scale.setXYZ(1, 1, 1);
    return pivot;
  }
  private buildTRS(node: SceneNode): TRS {
    return {
      position: new Vector3(node.position),
      rotation: new Quaternion(node.rotation),
      scale: new Vector3(node.scale)
    };
  }
  private clonePropertyValue(value: {
    num: number[];
    str: string[];
    bool: boolean[];
    object: object[];
  }): PropertySnapshot {
    return {
      num: [...(value.num ?? [])],
      str: [...(value.str ?? [])],
      bool: [...(value.bool ?? [])],
      object: [...(value.object ?? [])]
    };
  }
  private isSamePropertyValue(a: PropertySnapshot, b: PropertySnapshot) {
    if (a.num.length !== b.num.length || a.str.length !== b.str.length || a.bool.length !== b.bool.length) {
      return false;
    }
    for (let i = 0; i < a.num.length; i++) {
      if (a.num[i] !== b.num[i]) {
        return false;
      }
    }
    for (let i = 0; i < a.str.length; i++) {
      if (a.str[i] !== b.str[i]) {
        return false;
      }
    }
    for (let i = 0; i < a.bool.length; i++) {
      if (a.bool[i] !== b.bool[i]) {
        return false;
      }
    }
    if (a.object.length !== b.object.length) {
      return false;
    }
    for (let i = 0; i < a.object.length; i++) {
      if (a.object[i] !== b.object[i]) {
        return false;
      }
    }
    return true;
  }
  private getPropertySessionKey(object: SceneNode, prop: PropertyAccessor) {
    const propName = getEngine().resourceManager.getPropertyName(prop) ?? prop.name;
    return `${object.runtimeId}:${propName}`;
  }
  private syncPropertyToMultiSelection(object: object, prop: PropertyAccessor) {
    if (this._suspendMultiPropertySync || !(object instanceof SceneNode) || !prop?.set) {
      return;
    }
    if (this._propGrid.object !== object) {
      return;
    }
    const selectedNodes = this.getSelectedSceneNodes().filter(
      (node) =>
        node !== object && node !== this.controller.model.scene.rootNode && node !== this._multiTransformPivot
    );
    if (selectedNodes.length === 0) {
      return;
    }
    const value = { num: [0, 0, 0, 0], str: [] as string[], object: [] as any[], bool: [false] };
    prop.get.call(object, value);
    const newValue = this.clonePropertyValue(value);
    const resourceManager = getEngine().resourceManager;
    const propPath = resourceManager.getPropertyName(prop);
    const pathProp = propPath ? resourceManager.getPropertyByName(propPath) : null;
    const sessionKey = this.getPropertySessionKey(object, prop);
    let session = this._syncedPropertySessions.get(sessionKey);
    if (!session) {
      session = new Map();
      this._syncedPropertySessions.set(sessionKey, session);
    }
    this._suspendMultiPropertySync = true;
    try {
      for (const target of selectedNodes) {
        const targetProp = prop.isValid?.call(target) === false ? pathProp : prop;
        if (!targetProp || !targetProp.set) {
          continue;
        }
        if (targetProp.isValid && !targetProp.isValid.call(target)) {
          continue;
        }
        let record = session.get(target);
        if (!record) {
          const oldValue = {
            num: [0, 0, 0, 0],
            str: [''],
            bool: [false],
            object: []
          } as PropertySnapshot;
          targetProp.get.call(target, oldValue);
          record = {
            oldValue: this.clonePropertyValue(oldValue),
            newValue: this.clonePropertyValue(oldValue)
          };
          session.set(target, record);
        }
        record.newValue = this.clonePropertyValue(newValue);
        targetProp.set.call(target, this.clonePropertyValue(newValue));
        this._proxy?.updateProxy(target);
      }
    } finally {
      this._suspendMultiPropertySync = false;
    }
  }
  private applyWorldMatrixToNode(node: SceneNode, worldMatrix: Matrix4x4) {
    const localMatrix = node.parent
      ? Matrix4x4.invertAffine(node.parent.worldMatrix).multiplyRight(worldMatrix)
      : new Matrix4x4(worldMatrix);
    localMatrix.decompose(node.scale, node.rotation, node.position);
  }
  private applyMultiTransformFromMaster(master: SceneNode) {
    if (!this._multiTransformMasterStartWorld || this._multiTransformItems.length === 0) {
      return;
    }
    const masterCurrentWorld = new Matrix4x4(master.worldMatrix);
    const invMasterStart = Matrix4x4.invertAffine(this._multiTransformMasterStartWorld);
    const deltaWorld = masterCurrentWorld.multiplyRight(invMasterStart);
    for (const item of this._multiTransformItems) {
      const targetWorld = new Matrix4x4(deltaWorld).multiplyRight(item.startWorld);
      this.applyWorldMatrixToNode(item.node, targetWorld);
    }
  }
  private async handleCloneSelectedNodes() {
    const selectedNodes = this.getTopLevelSelection(this.getSelectedSceneNodes()).filter(
      (node) => node !== this.controller.model.scene.rootNode
    );
    if (selectedNodes.length === 0) {
      return;
    }
    const commands: NodeCloneCommand[] = [];
    for (const node of selectedNodes) {
      let hasTerrain = false;
      node.iterate((child) => {
        if (child.isClipmapTerrain()) {
          hasTerrain = true;
          return true;
        }
        return false;
      });
      if (hasTerrain) {
        DlgMessage.messageBox('Error', 'Cloning terrain node is not allowed');
        continue;
      }
      commands.push(new NodeCloneCommand(node));
    }
    if (commands.length === 0) {
      return;
    }
    const result =
      commands.length === 1
        ? [await this._cmdManager.execute(commands[0])]
        : ((await this._cmdManager.execute(new CompositeCommand('Clone nodes', commands))) as SceneNode[]);
    const clonedNodes: SceneNode[] = [];
    let lastCloned: Nullable<SceneNode> = null;
    for (const sceneNode of result) {
      if (!sceneNode) {
        continue;
      }
      sceneNode.position.x += 1;
      clonedNodes.push(sceneNode);
      lastCloned = sceneNode;
    }
    if (clonedNodes.length > 0) {
      this._sceneHierarchy!.selectNodes(clonedNodes, lastCloned);
      for (const node of clonedNodes) {
        this.editor.plugins.dispatchEvent('nodeAdded', node);
      }
      eventBus.dispatchEvent('scene_changed');
    }
  }
  private async handleDeleteSelectedNodes() {
    const selectedNodes = this.getTopLevelSelection(this.getSelectedSceneNodes());
    if (selectedNodes.length === 0) {
      return;
    }
    const commands: NodeDeleteCommand[] = [];
    for (const node of selectedNodes) {
      if (node?.parent) {
        const command = this.prepareDeleteNodeCommand(node);
        if (command) {
          commands.push(command);
        }
      }
    }
    if (commands.length === 0) {
      return;
    }
    if (commands.length === 1) {
      await this._cmdManager.execute(commands[0]);
    } else {
      await this._cmdManager.execute(new CompositeCommand('Delete nodes', commands));
    }
    for (const node of selectedNodes) {
      this.editor.plugins.dispatchEvent('nodeDeleted', node);
    }
    eventBus.dispatchEvent('scene_changed');
  }
  private async handleDeleteNode(node: SceneNode) {
    const command = this.prepareDeleteNodeCommand(node);
    if (!command) {
      return;
    }
    await this._cmdManager.execute(command);
    this.editor.plugins.dispatchEvent('nodeDeleted', node);
    eventBus.dispatchEvent('scene_changed');
  }
  private prepareDeleteNodeCommand(node: SceneNode): Nullable<NodeDeleteCommand> {
    if (!node) {
      return null;
    }
    if (node === this.controller.model.scene.mainCamera) {
      Dialog.messageBox('Zephyr3d editor', 'Cannot delete main camera');
      return null;
    }
    const editTarget = this._currentEditTool.get()?.getTarget();
    if (editTarget instanceof SceneNode && editTarget.isParentOf(node)) {
      this.editor.plugins.dispatchEvent('editToolDeactivated', this._currentEditTool.get()!, editTarget);
      this._currentEditTool.dispose();
    }
    const selectedNodes = this.getSelectedSceneNodes();
    if (selectedNodes.some((selected) => node.isParentOf(selected))) {
      this._sceneHierarchy!.selectNode(null);
    }
    if (this._propGrid.object instanceof SceneNode && node.isParentOf(this._propGrid.object)) {
      this._propGrid.object = this.controller.model.scene;
    }
    if (node.isParentOf(this._postGizmoRenderer!.node)) {
      this._postGizmoRenderer!.node = null;
    }
    return new NodeDeleteCommand(node);
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
          const ray = this.controller.model.scene.mainCamera!.constructRay(p[0], p[1]);
          let hitDistance = -ray.origin.y / ray.direction.y;
          if (Number.isNaN(hitDistance) || !Number.isFinite(hitDistance) || hitDistance < 0) {
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
          ? new AddAssetCommand(this.controller.model.scene, this._assetToBeAdded!, pos)
          : new AddPrefabCommand(this.controller.model.scene, this._assetToBeAdded!, pos);
      this._cmdManager.execute(command).then((node) => {
        this._sceneHierarchy!.selectNode(node);
        this.editor.plugins.dispatchEvent('nodeAdded', node);
        eventBus.dispatchEvent('scene_changed');
      });
    }
  }
  private editMaterial(label: string, name: string, type: GenericConstructor<MeshMaterial>, path: string) {
    Dialog.editMaterial(label, name, type, path, 800, 600);
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
  private handleNodeSelected(_node: SceneNode) {}
  private resolveNodeAssetPath(node: SceneNode): Nullable<string> {
    if (node === this.controller.model.scene.rootNode) {
      const scenePath = this.controller.scenePath;
      return scenePath && scenePath.startsWith('/') ? ProjectService.VFS.normalizePath(scenePath) : null;
    }

    const prefabNode = node.getPrefabNode();
    if (prefabNode?.prefabId?.startsWith('/')) {
      return ProjectService.VFS.normalizePath(prefabNode.prefabId);
    }

    let assetNode: Nullable<SceneNode> = node;
    while (assetNode) {
      const assetId = getEngine().resourceManager.getAssetId(assetNode);
      if (typeof assetId === 'string' && assetId.startsWith('/')) {
        return ProjectService.VFS.normalizePath(assetId);
      }
      assetNode = assetNode.parent;
    }

    let ctor: any = node.constructor;
    const resourceManager = getEngine().resourceManager;
    while (ctor) {
      const cls = resourceManager.getClassByConstructor(ctor);
      if (cls) {
        const props = resourceManager.getPropertiesByClass(cls) ?? [];
        for (const prop of props) {
          if (!prop.options?.mimeTypes?.length) {
            continue;
          }
          if (prop.isValid && !prop.isValid.call(node)) {
            continue;
          }
          const value = { num: [0, 0, 0, 0], str: [''], bool: [false], object: [] };
          prop.get.call(node, value);
          const path = value.str[0];
          if (typeof path === 'string' && path.startsWith('/')) {
            return ProjectService.VFS.normalizePath(path);
          }
        }
      }
      ctor = cls ? cls.parent : Object.getPrototypeOf(ctor);
    }
    return null;
  }
  private handleGoToAssets(node: SceneNode) {
    const path = this.resolveNodeAssetPath(node);
    if (path) {
      eventBus.dispatchEvent('reveal_asset', path);
    }
  }
  private handleHierarchySelectionChanged(_selectedNodes: SceneNode[], activeNode: Nullable<SceneNode>) {
    this._lastDuplicateTarget = 'scene';
    this._syncedPropertySessions.clear();
    this.editor.plugins.dispatchEvent('selectionChanged', _selectedNodes, activeNode);
    const outlineNodes = this.getSelectedSceneNodes().filter(
      (node) =>
        node !== this.controller.model.scene.rootNode && node !== this.controller.model.scene.mainCamera
    );
    this._postGizmoRenderer!.selectedNodes = outlineNodes;
    const editTarget = this._currentEditTool.get()?.getTarget();
    if (
      this._currentEditTool.get() &&
      (!(editTarget instanceof SceneNode) ||
        !activeNode ||
        (editTarget !== activeNode && !editTarget.isParentOf(activeNode)))
    ) {
      this.editor.plugins.dispatchEvent('editToolDeactivated', this._currentEditTool.get()!, editTarget);
      this._currentEditTool.dispose();
    }
    if (!activeNode) {
      this._postGizmoRenderer!.node = null;
      this.updateGizmoTransformSpace();
      this._propGrid.object = this.controller.model.scene;
      return;
    }
    const pivot = this.updateMultiTransformPivot();
    this._postGizmoRenderer!.node =
      pivot ??
      (activeNode === activeNode.scene!.rootNode || activeNode === this.controller.model.scene.mainCamera
        ? null
        : activeNode);
    this.updateGizmoTransformSpace();
    this._propGrid.object = activeNode === activeNode.scene!.rootNode ? activeNode.scene : activeNode;
  }
  private isTransformModeActive() {
    const mode = this._postGizmoRenderer?.mode;
    return mode === 'translation' || mode === 'rotation' || mode === 'scaling';
  }
  private isTransformSpaceForcedWorld() {
    return !!this._postGizmoRenderer && this._postGizmoRenderer.node === this._multiTransformPivot;
  }
  private updateGizmoTransformSpace() {
    if (!this._postGizmoRenderer) {
      return;
    }
    this._postGizmoRenderer.transformSpace = this.isTransformSpaceForcedWorld()
      ? 'world'
      : this._preferredTransformSpace;
  }
  private handleNodeDeselected(_node: SceneNode) {}
  private handleAssetSelectionChanged() {
    this._lastDuplicateTarget = 'asset';
  }
  private async handleDuplicateShortcut() {
    const selectedNodes = this.getSelectedSceneNodes();
    const assetRenderer = this._assetView?.renderer;
    if (this._lastDuplicateTarget === 'asset' && assetRenderer) {
      try {
        if (await assetRenderer.duplicateSelectedItems()) {
          return;
        }
      } catch (err) {
        DlgMessage.messageBox('Error', `Duplicate asset failed: ${err}`);
        return;
      }
    }
    if (selectedNodes.length > 0) {
      await this.handleCloneSelectedNodes();
      return;
    }
    if (assetRenderer) {
      try {
        await assetRenderer.duplicateSelectedItems();
      } catch (err) {
        DlgMessage.messageBox('Error', `Duplicate asset failed: ${err}`);
      }
    }
  }
  private handleNodeDragDrop(src: SceneNode, dst: SceneNode) {
    if (src.parent !== dst && !src.isParentOf(dst)) {
      this._cmdManager.execute(new NodeReparentCommand(src, dst)).then(() => {
        this.editor.plugins.dispatchEvent('nodeTransformed', src);
        eventBus.dispatchEvent('scene_changed');
      });
    }
  }
  private handleNodeDoubleClicked(node: SceneNode) {
    this.lookAt(this.controller.model.scene.mainCamera!, node);
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
    const mesh = new Mesh(this.controller.model.scene, shape!, material!);
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
    this._proxy!.createProxy(node);
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
        node!.parent = null;
        node!.iterate((node) => {
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
      this._sceneHierarchy!.selectNode(node);
      this.editor.plugins.dispatchEvent('nodeAdded', node);
      eventBus.dispatchEvent('scene_changed');
    });
  }
  private handleSavePrefab(node: SceneNode) {
    let hasTerrain = false;
    node.iterate((node) => {
      if (node.isClipmapTerrain()) {
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
  private handleAddCollider(node: SceneNode, type: ColliderKind) {
    const defaultMeta =
      type === 'sphere'
        ? {
            sceneCollider: {
              type: 'sphere',
              enabled: true,
              visible: true,
              radius: 0.15
            }
          }
        : type === 'capsule'
          ? {
              sceneCollider: {
                type: 'capsule',
                enabled: true,
                visible: true,
                offset: 0.1,
                endOffset: 0.1,
                radius: 0.1
              }
            }
          : {
              sceneCollider: {
                type: 'plane',
                enabled: true,
                visible: true,
                normal: 1,
                planeSize: 0.5
              }
            };
    const typeName = type === 'sphere' ? 'Sphere' : type === 'capsule' ? 'Capsule' : 'Plane';
    this._cmdManager.execute(new AddChildCommand(node, SceneNode)).then((colliderNode) => {
      if (!colliderNode) {
        return;
      }
      let index = 1;
      while (node.children.find((c) => c.name === `${typeName}Collider_${index}`)) {
        index++;
      }
      colliderNode.name = `${typeName}Collider_${index}`;
      colliderNode.metaData = defaultMeta as any;
      colliderNode.gpuPickable = true;
      this._proxy!.createProxy(colliderNode);
      this._proxy!.updateProxy(colliderNode);
      this._sceneHierarchy?.selectNode(colliderNode);
      this._propGrid.refresh();
      this.editor.plugins.dispatchEvent('nodeAdded', colliderNode);
      eventBus.dispatchEvent('scene_changed');
    });
  }
  private handleNodeRemoved(node: SceneNode) {
    if (node.isParentOf(this._postGizmoRenderer!.node!)) {
      this._postGizmoRenderer!.node = null;
    }
    const selectedNodes = this.getSelectedSceneNodes();
    if (selectedNodes.some((selected) => node.isParentOf(selected))) {
      this._sceneHierarchy!.selectNode(null);
    }
    this.editor.plugins.dispatchEvent('nodeRemoved', node);
  }
  private handleNodeAttached(node: SceneNode) {
    this.syncNodeProxyTree(node);
    this.editor.plugins.dispatchEvent('nodeAdded', node);
  }
  private syncNodeProxyTree(root: Nullable<SceneNode>) {
    if (!root || !this._proxy) {
      return;
    }
    root.iterate((node) => {
      this._proxy!.createProxy(node);
      this._proxy!.updateProxy(node);
      if (node === this.controller.model.scene.mainCamera) {
        this._proxy!.hideProxy(node);
      }
    });
  }
  private handleBeginTransformNode(node: SceneNode) {
    const isPivot = node === this._multiTransformPivot;
    this._transformNode.set(node);
    this._oldTransform = this.buildTRS(node);
    this._multiTransformMasterStartWorld = new Matrix4x4(node.worldMatrix);
    const selectedNodes = isPivot
      ? this.getTransformSelectionNodes()
      : this.getTopLevelSelection(this.getSelectedSceneNodes()).filter(
          (n) => n !== node && n !== this.controller.model.scene.rootNode
        );
    this._multiTransformItems = selectedNodes.map((n) => ({
      node: n,
      startWorld: new Matrix4x4(n.worldMatrix),
      startTransform: this.buildTRS(n)
    }));
    if (!isPivot) {
      node.iterate((child) => {
        child.gpuPickable = false;
        return false;
      });
    }
    for (const item of this._multiTransformItems) {
      item.node.iterate((child) => {
        child.gpuPickable = false;
        return false;
      });
    }
    this._postGizmoCaptured = true;
  }
  private async handleEndTransformNode(node: SceneNode, desc: string) {
    if (node && node === this._transformNode.get()) {
      const isPivot = node === this._multiTransformPivot;
      this.applyMultiTransformFromMaster(node);
      const commands: NodeTransformCommand[] = [];
      if (!isPivot) {
        commands.push(
          new NodeTransformCommand(
            node,
            this._oldTransform!,
            {
              position: node.position,
              rotation: node.rotation,
              scale: node.scale
            },
            desc
          )
        );
      }
      for (const item of this._multiTransformItems) {
        commands.push(
          new NodeTransformCommand(
            item.node,
            item.startTransform,
            this.buildTRS(item.node),
            `${desc} (multi)`
          )
        );
      }
      if (commands.length === 1) {
        await this._cmdManager.execute(commands[0]);
      } else if (commands.length > 1) {
        await this._cmdManager.execute(new CompositeCommand(desc, commands));
      }
      this._oldTransform = null;
      if (!isPivot) {
        node.iterate((child) => {
          child.gpuPickable = true;
          return false;
        });
      }
      for (const item of this._multiTransformItems) {
        item.node.iterate((child) => {
          child.gpuPickable = true;
          return false;
        });
      }
      this.editor.plugins.dispatchEvent(
        'nodeTransformed',
        this._multiTransformItems.length > 0
          ? [node, ...this._multiTransformItems.map((item) => item.node)]
          : node
      );
      this._multiTransformItems = [];
      this._multiTransformMasterStartWorld = null;
      this._transformNode.dispose();
      this.controller.model.scene.octree.prune();
      eventBus.dispatchEvent('scene_changed');
    }
    this._postGizmoCaptured = false;
  }
  private async handleEndTranslateNode(node: SceneNode) {
    await this.handleEndTransformNode(node, 'moving object');
    this._suspendMultiPropertySync = true;
    try {
      this._propGrid.dispatchEvent(
        'object_property_changed',
        node,
        getEngine().resourceManager.getPropertyByName('/SceneNode/Position')
      );
    } finally {
      this._suspendMultiPropertySync = false;
    }
  }
  private async handleEndRotateNode(node: SceneNode) {
    await this.handleEndTransformNode(node, 'rotating object');
    this._suspendMultiPropertySync = true;
    try {
      this._propGrid.dispatchEvent(
        'object_property_changed',
        node,
        getEngine().resourceManager.getPropertyByName('/SceneNode/Rotation')
      );
    } finally {
      this._suspendMultiPropertySync = false;
    }
  }
  private async handleEndScaleNode(node: SceneNode) {
    await this.handleEndTransformNode(node, 'scaling object');
    this._suspendMultiPropertySync = true;
    try {
      this._propGrid.dispatchEvent(
        'object_property_changed',
        node,
        getEngine().resourceManager.getPropertyByName('/SceneNode/Scale')
      );
    } finally {
      this._suspendMultiPropertySync = false;
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
      eventBus.dispatchEvent('scene_changed');
    }
  }
}
