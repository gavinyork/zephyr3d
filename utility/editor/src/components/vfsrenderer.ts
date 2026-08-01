import type { FileMetadata, GenericConstructor, Immutable, Nullable, VFS } from '@zephyr3d/base';
import type { TextureAddressMode, TextureFilterMode, TextureSampler } from '@zephyr3d/device';
import UPNG from 'upng-js';
import { DataTransferVFS, Disposable, guessMimeType, makeObservable, PathUtils } from '@zephyr3d/base';
import { DockPannel, ResizeDirection } from './dockpanel';
import { ImGui, imGuiCalcTextSize } from '@zephyr3d/imgui';
import { convertEmojiString } from '../helpers/emoji';
import { ProjectService } from '../core/services/project';
import { eventBus } from '../core/eventbus';
import { DlgPromptName } from '../views/dlg/promptnamedlg';
import { DlgRename } from '../views/dlg/renamedlg';
import { DlgMessage } from '../views/dlg/messagedlg';
import { DlgProgress } from '../views/dlg/progressdlg';
import { DlgMessageBoxEx } from '../views/dlg/messageexdlg';
import { templateScript } from '../core/build/templates';
import { installDeps, reinstallPackages } from '../core/build/dep';
import { DlgRampTextureCreator } from '../views/dlg/ramptexturedlg';
import { DlgNoiseTextureCreator } from '../views/dlg/noisetexturedlg';
import { TreeViewData, TreeView } from './treeview';
import { DlgImport } from '../views/dlg/importdlg';
import { DlgZABCCompress, type ZABCCompressDialogResult } from '../views/dlg/zabccompressdlg';
import { ListView, ListViewData } from './listview';
import { ResourceService } from '../core/services/resource';
import { DlgSaveFile } from '../views/dlg/savefiledlg';
import { exportMultipleFilesToDirectory } from '../helpers/downloader';
import type {
  BluePrintUniformTexture,
  BluePrintUniformValue,
  MaterialBlueprintIR,
  MeshMaterial,
  SharedModel
} from '@zephyr3d/scene';
import {
  CompAddNode,
  CompMulNode,
  CompSubNode,
  ConstantScalarNode,
  ConstantVec3Node,
  getEngine,
  PBRBlockNode,
  PBRBluePrintMaterial,
  PBRMetallicRoughnessMaterial,
  SpriteBlueprintMaterial,
  SwizzleNode,
  TextureSampleNode,
  VertexColorNode
} from '@zephyr3d/scene';
import { exportFile, exportMultipleFilesAsZip } from '../helpers/downloader';
import { matchesMimeType } from '../helpers/mimematch';
import { buildPrimitiveGlbFromZmshContent } from '../helpers/primitiveglb';
import { DlgImportOptions } from '../views/dlg/importoptionsdlg';
import { DialogRenderer } from './modal';
import type { Editor } from '../core/editor';
import type { RuntimeEditorAssetContext, RuntimeEditorMenuContext } from '../core/plugin';
import type { PropertyAccessor } from '@zephyr3d/scene';
import { AssetThumbnailService, ImageAssetThumbnailProvider } from './assetthumbnail';
import { getDesktopAPI, isDesktopApp } from '../core/services/desktop';
import { ElectronFS } from '../core/services/electronfs';

type BlueprintNodeState = {
  id: number;
  position?: Nullable<number[]>;
  title: string;
  locked: boolean;
  node: Record<string, unknown>;
};

type BlueprintLinkState = {
  startNodeId: number;
  startSlotId: number;
  endNodeId: number;
  endSlotId: number;
};

export type FileInfo = {
  meta: FileMetadata;
  parent: DirectoryInfo;
};

export type DirectoryInfo = {
  path: string;
  files: FileInfo[];
  subDir: DirectoryInfo[];
  parent: DirectoryInfo;
  open: boolean;
  loaded?: boolean;
  hasChildrenHint?: boolean;
};

interface AreaBounds {
  min: ImGui.ImVec2;
  max: ImGui.ImVec2;
}

const enum DropZone {
  None = 'none',
  Navigation = 'navigation', // Drag to home directory
  Content = 'content' // Drag to current selected directory
}

type VFSRendererOptions = {
  rootDir?: string;
  allowDrop?: boolean;
  allowDblClickOpen?: boolean;
  multiSelect?: boolean;
  foldersOnly?: boolean;
  editor?: Editor;
  rootLabel?: string;
  showDependencyTools?: boolean;
  showGenericFileCreate?: boolean;
  openFile?: (path: string, mimeType: string) => void;
};

export type VFSRendererContextMenuLocation = 'asset-content' | 'asset-directory';
export type VFSRendererAssetPickerPayload = {
  type: 'asset-picker';
  object: object;
  prop: PropertyAccessor<any>;
};

type PathRewriteRule = {
  oldPath: string;
  newPath: string;
  isDirectory: boolean;
};

class VFSDirData extends TreeViewData<DirectoryInfo> {
  private _renderer: VFSRenderer;
  private _rootLabel: string;
  constructor(renderer: VFSRenderer, rootLabel: string) {
    super();
    this._renderer = renderer;
    this._rootLabel = rootLabel;
  }
  getRoot(): DirectoryInfo {
    return this._renderer.root;
  }
  getChildren(parent: DirectoryInfo): DirectoryInfo[] {
    return parent?.subDir ?? [];
  }
  hasChildren(parent: DirectoryInfo): boolean {
    return parent?.hasChildrenHint ?? parent?.subDir?.length > 0;
  }
  getParent(node: DirectoryInfo): DirectoryInfo {
    return node.parent;
  }
  getId(node: DirectoryInfo): string {
    return node.path;
  }
  getNodeName(node: DirectoryInfo): string {
    const name = node.path.slice(node.path.lastIndexOf('/') + 1);
    const emoji = '📁';
    const id = node.path;
    return convertEmojiString(`${emoji}${node === this._renderer.root ? this._rootLabel : name}##${id}`);
  }
  getDragSourcePayloadType(): string {
    return '';
  }
  getDragSourcePayload(): unknown {
    return null;
  }
  getDragTargetPayloadType(): string {
    return 'ASSET';
  }
}

class VFSContentData extends ListViewData<FileInfo | DirectoryInfo> {
  renderer: VFSRenderer;
  private _columnNames: string[];
  constructor(renderer: VFSRenderer) {
    super();
    this.renderer = renderer;
    this._columnNames = ['Size', 'Type', 'Modified'];
  }
  getItems() {
    return this.renderer.options.foldersOnly
      ? this.renderer.currentDirContent.filter((val) => 'subDir' in val)
      : this.renderer.currentDirContent;
  }
  getItemIcon(item: FileInfo | DirectoryInfo): string {
    const isDir = 'subDir' in item;
    return isDir ? '📁' : this.renderer.getFileEmoji(item.meta);
  }
  getItemName(item: FileInfo | DirectoryInfo): string {
    const isDir = 'subDir' in item;
    return isDir ? item.path.slice(item.path.lastIndexOf('/') + 1) : item.meta.name;
  }
  getDetailColumn(item: FileInfo | DirectoryInfo, col: number): string {
    const isDir = 'subDir' in item;
    if (col === 0) {
      return isDir ? '--' : this.renderer.formatFileSize(item.meta.size);
    }
    if (col === 1) {
      return isDir ? '' : guessMimeType(item.meta.name);
    }
    if (col === 2) {
      return !isDir && !!item.meta.modified ? this.renderer.formatDate(item.meta.modified) : '--';
    }
    return '';
  }
  getDetailColumnsInfo(): string[] {
    return this._columnNames;
  }
  sortDetailItems(
    a: FileInfo | DirectoryInfo,
    b: FileInfo | DirectoryInfo,
    sortBy: number,
    sortAscending: boolean
  ): number {
    const isADir = 'subDir' in a;
    const isBDir = 'subDir' in b;
    if (isADir && !isBDir) {
      return -1;
    }
    if (!isADir && isBDir) {
      return 1;
    }
    let comparison = 0;
    switch (sortBy) {
      case 0: {
        const nameA = isADir ? a.path.slice(a.path.lastIndexOf('/') + 1) : (a as FileInfo).meta.name;
        const nameB = isBDir ? b.path.slice(b.path.lastIndexOf('/') + 1) : (b as FileInfo).meta.name;
        comparison = nameA.localeCompare(nameB);
        break;
      }
      case 1:
        if (!isADir && !isBDir) {
          comparison = (a as FileInfo).meta.size - (b as FileInfo).meta.size;
        }
        break;

      case 2:
        if (!isADir && !isBDir) {
          const typeA = guessMimeType((a as FileInfo).meta.name);
          const typeB = guessMimeType((b as FileInfo).meta.name);
          comparison = typeA.localeCompare(typeB);
        }
        break;

      case 3:
        if (!isADir && !isBDir) {
          const timeA = (a as FileInfo).meta.modified?.getTime() || 0;
          const timeB = (b as FileInfo).meta.modified?.getTime() || 0;
          comparison = timeA - timeB;
        }
        break;
    }
    return sortAscending ? comparison : -comparison;
  }
  getDragSourcePayloadType(): string {
    return this.renderer.selectedItems.size > 0 ? 'ASSET' : null;
  }
  getDragSourceHint(_lv, item: DirectoryInfo | FileInfo): string {
    if (this.renderer.selectedItems.size > 0) {
      const ctrlDown = ImGui.GetIO().KeyCtrl;
      let icon = 'subDir' in item ? '📁' : this.renderer.getFileEmoji(item.meta);
      if (ctrlDown) {
        icon += '+';
      }
      return convertEmojiString(icon);
    }
    return '';
  }
  getDragSourcePayload(): unknown {
    if (this.renderer.selectedItems.size > 0) {
      return [...this.renderer.selectedItems].map((item) => ({
        isDir: 'subDir' in item,
        path: 'subDir' in item ? item.path : item.meta.path
      }));
    }
    return null;
  }
  getDragTargetPayloadType(): string {
    return 'ASSET';
  }
}

export class ContentListView extends ListView<{}, FileInfo | DirectoryInfo> {
  constructor(data: VFSContentData) {
    super(`##VFSContentListView${data.renderer.id}`, data);
  }
  get renderer() {
    return (this._data as VFSContentData).renderer;
  }
  protected renderGridContent(
    item: FileInfo | DirectoryInfo,
    _index: number,
    min: ImGui.ImVec2,
    max: ImGui.ImVec2
  ): boolean {
    return 'subDir' in item ? false : this.renderer.renderFileThumbnail(item, min, max);
  }
  protected postRenderItem(item: FileInfo | DirectoryInfo): void {
    super.postRenderItem(item);
    if ('subDir' in item && !this.renderer.VFS.readOnly) {
      this.renderer.acceptFileMoveOrCopy(item.path);
    }
  }
  protected onContentContextMenu(): void {
    this.renderer.renderPluginContextMenu('asset-content', null);
    if (!this.renderer.VFS.readOnly) {
      if (ImGui.BeginMenu('Create New')) {
        if (ImGui.MenuItem('Folder...')) {
          this.renderer.createNewFolder();
        }
        if (this.renderer.showGenericFileCreate && ImGui.MenuItem('File...')) {
          this.renderer.createNewFile('Create File', 'untitled.ts', async (path) => {
            await this.renderer.VFS.writeFile(path, '', {
              encoding: 'utf8',
              create: true
            });
          });
        }
        if (this.renderer.VFS.isParentOf('/assets', this.renderer.selectedDir.path)) {
          ImGui.Separator();
          if (ImGui.MenuItem('Scene...')) {
            this.renderer.createNewFile('Create Scene', 'Scene Name', (path) => {
              if (!path.toLowerCase().endsWith('.zscn')) {
                path = `${path}.zscn`;
              }
              eventBus.dispatchEvent('action', 'NEW_DOC', { path });
            });
          }
          ImGui.Separator();
          if (ImGui.BeginMenu('Material')) {
            const materialTypes: Map<GenericConstructor<MeshMaterial>, string> = new Map<
              GenericConstructor<MeshMaterial>,
              string
            >([
              [PBRBluePrintMaterial, 'PBR Material'],
              [SpriteBlueprintMaterial, 'Sprite Material']
            ]);
            for (const entry of materialTypes) {
              const title = entry[1];
              if (ImGui.MenuItem(`${title}...`)) {
                this.renderer.createNewFile(`Create ${title}`, 'Material Name', (path) => {
                  if (!path.toLowerCase().endsWith('.zmtl')) {
                    path = `${path}.zmtl`;
                  }
                  const name = path.slice(0, -5);
                  eventBus.dispatchEvent('edit_material', name, name, entry[0], path);
                });
              }
            }
            ImGui.EndMenu();
          }
          ImGui.Separator();
          if (ImGui.MenuItem('Material function...')) {
            this.renderer.createNewFile('Create Material Function', 'Function Name', (path) => {
              if (!path.toLowerCase().endsWith('.zmf')) {
                path = `${path}.zmf`;
              }
              eventBus.dispatchEvent('edit_material_function', path);
            });
          }
          ImGui.Separator();
          if (ImGui.MenuItem('Typescript...')) {
            this.renderer.createNewFile('Create Typescript', 'Script Name', async (path) => {
              if (!path.toLowerCase().endsWith('.ts') && !path.toLowerCase().endsWith('.js')) {
                path = `${path}.ts`;
              }
              await this.renderer.VFS.writeFile(path, templateScript ?? '', {
                encoding: 'utf8',
                create: true
              });
            });
          }
          ImGui.Separator();
          if (ImGui.BeginMenu('Texture')) {
            if (ImGui.MenuItem('Ramp Texture...')) {
              this.renderer.createRampTexture(this.renderer.selectedDir.path);
            }
            if (ImGui.MenuItem('Noise Texture...')) {
              this.renderer.createNoiseTexture(this.renderer.selectedDir.path);
            }
            ImGui.EndMenu();
          }
        }
        ImGui.EndMenu();
      }
    }
  }
  protected onItemContextMenu(): void {
    this.onContentContextMenu();
    const selectedCount = this.renderer.selectedItems.size;
    const selectedItems = Array.from(this._selectedItems);
    if (selectedCount > 0) {
      if (selectedCount === 1) {
        const item = selectedItems[0];
        if (!('subDir' in item)) {
          const mimeType = this.renderer.VFS.guessMIMEType(item.meta.path);
          if (mimeType === 'application/vnd.zephyr3d.material+json') {
            ImGui.Separator();
            if (ImGui.MenuItem('Create Material Instance...')) {
              DlgSaveFile.saveFile(
                'Create Material Instance',
                this.renderer.VFS,
                '/assets',
                'Material (*.zmtl)|*.zmtl',
                500,
                400
              ).then((name) => {
                if (name) {
                  if (!name.endsWith('.zmtl')) {
                    name = `${name}.zmtl`;
                  }
                  this.renderer.copyFile(item.meta.path, name, 'prompt');
                }
              });
            }
            if (ImGui.MenuItem('Convert To Blueprint Material...')) {
              void this.renderer.convertMaterialToBlueprint(item.meta.path);
            }
          }
          if (item.meta.path.endsWith('.zmsh')) {
            ImGui.Separator();
            if (ImGui.MenuItem('Export as GLB')) {
              this.renderer.exportPrimitiveAsGlb(item.meta.path);
            }
          }
          ImGui.Separator();
          if (ImGui.MenuItem('Edit as text')) {
            this.renderer.openFile(item.meta.path, mimeType);
          }
        }
        if (this.renderer.canRevealInFileManager(item)) {
          ImGui.Separator();
          if (ImGui.MenuItem(this.renderer.revealInFileManagerLabel)) {
            this.renderer.revealItemInFileManager(item);
          }
        }
        ImGui.Separator();
        if (ImGui.MenuItem('Rename')) {
          this.renderer.renameSelectedItem();
        }
      }
      ImGui.Separator();
      if (ImGui.MenuItem(`Delete (${selectedCount} item${selectedCount > 1 ? 's' : ''})`)) {
        this.renderer.deleteSelectedItems();
      }
      ImGui.Separator();
      if (ImGui.MenuItem(`Export (${selectedCount} item${selectedCount > 1 ? 's' : ''})`)) {
        this.renderer.exportSelectedItems();
      }
    }
  }
  protected onSelectionChanged(): void {
    this.renderer.emitSelectedChanged();
  }
  protected onDragDrop(item: FileInfo | DirectoryInfo, _type: string, payload: unknown): void {
    const path = 'subDir' in item ? item.path : item.meta.path;
    this.renderer.handleAssetDrop(path, payload);
  }
  protected handleItemDoubleClick(item: FileInfo | DirectoryInfo): void {
    const isDir = 'subDir' in item;
    if (isDir) {
      this.renderer.nav.selectNode(item);
      item.open = true;
    } else {
      this.renderer.fileDoubleClicked(item);
    }
  }
}

export class DirTreeView extends TreeView<{}, DirectoryInfo> {
  private _renderer: VFSRenderer;
  constructor(renderer: VFSRenderer, projectName: string, multi?: boolean) {
    super(`###VFSNavigator${renderer.id}`, new VFSDirData(renderer, projectName), multi);
    this._renderer = renderer;
  }
  protected onGetContextMenuId(node: DirectoryInfo): string {
    return this._renderer.VFS.readOnly ? '' : `vfs_${node.path}`;
  }
  protected onNodeDeselected(): void {
    this._renderer.refreshFileView();
  }
  protected onNodeSelected(): void {
    void this._renderer.ensureDirectoryLoaded(this.selectedNode).finally(() => {
      this._renderer.refreshFileView();
    });
  }
  protected onNodeOpenChanged(node: DirectoryInfo, open: boolean) {
    node.open = open;
    if (open) {
      void this._renderer.ensureDirectoryLoaded(node).catch((err) => {
        console.error(`Load directory ${node.path} failed: ${err}`);
      });
    }
  }
  protected onDrawContextMenu(dir: DirectoryInfo) {
    this._renderer.renderPluginContextMenu('asset-directory', dir);
    if (this._renderer.canRevealInFileManager(dir)) {
      if (ImGui.MenuItem(this._renderer.revealInFileManagerLabel)) {
        this._renderer.revealItemInFileManager(dir);
      }
      ImGui.Separator();
    }
    if (ImGui.BeginMenu('Create New##VFSCreate')) {
      if (ImGui.MenuItem('Folder...##VFSCreateFolder')) {
        DlgPromptName.promptName('Create Folder', 'NewFolder').then((name) => {
          name = name.trim();
          if (name) {
            if (PathUtils.sanitizeFilename(name) !== name) {
              DlgMessage.messageBox('Error', 'Invalid folder name');
            } else {
              this._renderer.VFS.readDirectory(dir.path, { includeHidden: true, recursive: false })
                .then((items) => {
                  if (items.find((item) => item.type === 'directory' && item.name === name)) {
                    DlgMessage.messageBox('Error', 'A folder with same name already exists');
                  } else {
                    this._renderer.VFS.makeDirectory(this._renderer.VFS.join(dir.path, name), false).catch(
                      (err) => {
                        DlgMessage.messageBox('Error', `Create folder failed: ${err}`);
                      }
                    );
                  }
                })
                .catch((err) => {
                  DlgMessage.messageBox('Error', `Read parent path failed: ${err}`);
                });
            }
          }
        });
      }
      if (this._renderer.showGenericFileCreate && ImGui.MenuItem('File...##VFSCreateFile')) {
        this._renderer.createNewFile('Create File', 'untitled.ts', async (path) => {
          await this._renderer.VFS.writeFile(path, '', {
            encoding: 'utf8',
            create: true
          });
        });
      }
      ImGui.EndMenu();
    }
    if (dir !== this._renderer.root && dir.path !== '/assets' && dir.path !== '/src') {
      if (ImGui.MenuItem('Delete##VFSDeleteFolder')) {
        this._renderer.VFS.deleteDirectory(dir.path, true)
          .then(() => {
            this._renderer.removePathsFromFileSystem([dir.path]);
            if (dir === this.selectedNode) {
              this.selectNode(null);
            }
            this._renderer.refreshFileView();
            this._renderer.emitSelectedChanged();
            this._renderer.queueFileSystemReload(true);
          })
          .catch((err) => {
            DlgMessage.messageBox('Error', `Delete directory failed: ${err}`);
          });
      }
      if (ImGui.MenuItem('Rename##VFSRenameFolder')) {
        this._renderer.renameItem(dir);
      }
    }
  }
  protected onDragDrop(node: DirectoryInfo, _type: string, payload: unknown) {
    this._renderer.handleAssetDrop(node.path, payload);
  }
}

export class VFSRenderer extends makeObservable(Disposable)<{
  loaded: [];
  selection_changed: [
    selectedDir: DirectoryInfo,
    selectedFiles: FileInfo[],
    selectedItems: (FileInfo | DirectoryInfo)[]
  ];
  file_dbl_clicked: [file: FileInfo];
  asset_picker_drop: [payload: VFSRendererAssetPickerPayload, path: string];
}>() {
  private static VFSId = 1;
  private static readonly baseFlags =
    ImGui.TreeNodeFlags.SpanAvailWidth |
    ImGui.TreeNodeFlags.SpanFullWidth |
    ImGui.TreeNodeFlags.OpenOnArrow |
    ImGui.TreeNodeFlags.OpenOnDoubleClick;
  public readonly id: number;
  private readonly _vfs: VFS;
  private readonly _treePanel: DockPannel;
  private _nav: DirTreeView;
  private _contentView: ContentListView;
  private readonly _thumbnailService: AssetThumbnailService;
  private _filesystem: DirectoryInfo;
  private _fileFilter: string[];
  private _currentDirContent: (FileInfo | DirectoryInfo)[] = [];
  private _navigationBounds: AreaBounds | null = null;
  private _contentBounds: AreaBounds | null = null;
  private _isDragOverNavigation = false;
  private _isDragOverContent = false;
  private _pendingRevealAssetPath: string | null = null;
  private _forceNavRefresh = false;
  private _reloadTimer: ReturnType<typeof setTimeout> | null = null;
  private _reloadQueued = false;
  private _reloadQueuedPreserveSelection = false;
  private _reloadingFileSystem = false;
  private _vfsBatchDepth = 0;
  private _vfsBatchReloadPending = false;
  private _selectedDirPath: string | null = null;
  private readonly _options: VFSRendererOptions = null;

  constructor(vfs: VFS, fileFilter: string[] = [], treePanelWidth = 200, options?: VFSRendererOptions) {
    super();
    this.id = VFSRenderer.VFSId++;
    this._vfs = vfs;
    this._vfs.on('changed', this.onVFSChanged, this);
    this._treePanel = new DockPannel(0, 0, treePanelWidth, -1, 8, 200, 500, ResizeDirection.Right, 0, 99999);
    this._thumbnailService = new AssetThumbnailService([new ImageAssetThumbnailProvider()], 256, 2);
    this._filesystem = null;
    this._fileFilter = fileFilter?.slice() ?? [];
    this._options = {
      rootDir: '/assets',
      allowDrop: true,
      allowDblClickOpen: true,
      multiSelect: true,
      foldersOnly: false,
      rootLabel: null,
      showDependencyTools: true,
      showGenericFileCreate: false,
      ...options
    };
    this._nav = new DirTreeView(this, this._options.rootLabel || this._options.rootDir);
    this._contentView = new ContentListView(new VFSContentData(this));
    eventBus.on('reveal_asset', this.revealAsset, this);
    this.loadFileSystem();
    if (this._options.allowDrop) {
      eventBus.on('external_dragenter', this.handleDragEvent, this);
      eventBus.on('external_dragover', this.handleDragEvent, this);
      eventBus.on('external_dragleave', this.handleDragEvent, this);
      eventBus.on('external_drop', this.handleDragEvent, this);
    }
  }

  get VFS() {
    return this._vfs;
  }
  get options(): Immutable<VFSRendererOptions> {
    return this._options;
  }
  get nav() {
    return this._nav;
  }
  get root() {
    return this._filesystem;
  }
  get fileFilter(): string[] {
    return this._fileFilter;
  }
  set fileFilter(filter: string[]) {
    this._fileFilter = filter?.slice() ?? [];
    this.loadFileSystem().then(() => {
      this.refreshFileView();
    });
  }
  get selectedDir() {
    return this._nav?.selectedNode ?? null;
  }
  get selectedFiles() {
    return [...this._contentView.selectedItems].filter((item) => 'meta' in item);
  }
  get selectedItems() {
    return this._contentView.selectedItems;
  }
  get showGenericFileCreate() {
    return !!this._options.showGenericFileCreate;
  }
  get currentDirContent() {
    return this._currentDirContent;
  }
  private async serializeBlueprintNode(
    id: number,
    impl: object,
    position: [number, number] | null,
    title = '',
    locked = false
  ): Promise<BlueprintNodeState> {
    return {
      id,
      position: position ? [position[0], position[1]] : null,
      title,
      locked,
      node: await getEngine().resourceManager.serializeObject(impl)
    };
  }
  private getTextureAssetId(texture: unknown): string {
    if (!texture) {
      return '';
    }
    return getEngine().resourceManager.getAssetId(texture) ?? '';
  }
  private applyTextureSamplerToNode(
    node: TextureSampleNode,
    sampler: TextureSampler | null | undefined,
    wrapS?: string | null,
    wrapT?: string | null
  ) {
    const normalizeWrap = (mode: string | null | undefined): TextureAddressMode => {
      if (mode === 'repeat' || mode === 'clamp' || mode === 'mirrored-repeat') {
        return mode;
      }
      if (mode === 'mirrored_repeat') {
        return 'mirrored-repeat';
      }
      return 'clamp';
    };
    const normalizeFilter = (
      mode: TextureFilterMode | string | null | undefined,
      fallback: TextureFilterMode
    ): TextureFilterMode => {
      return mode === 'nearest' || mode === 'linear' || mode === 'none' ? mode : fallback;
    };
    node.addressU = normalizeWrap(wrapS ?? sampler?.addressModeU);
    node.addressV = normalizeWrap(wrapT ?? sampler?.addressModeV);
    node.filterMin = normalizeFilter(sampler?.minFilter, 'linear');
    node.filterMag = normalizeFilter(sampler?.magFilter, 'linear');
    node.filterMip = normalizeFilter(sampler?.mipFilter, 'nearest');
  }
  private shouldExplicitizeVertexColor(sourcePath: string, material: PBRMetallicRoughnessMaterial) {
    if (!(material as PBRMetallicRoughnessMaterial & { vertexColor?: boolean }).vertexColor) {
      return false;
    }
    const controller = this._options.editor?.moduleManager.currentModule?.controller;
    const scene = (
      controller as {
        model?: { scene?: { rootNode?: { iterate?: (fn: (node: any) => boolean | void) => boolean } } };
      }
    )?.model?.scene;
    const rootNode = scene?.rootNode;
    if (!rootNode?.iterate) {
      return false;
    }
    const normalizedPath = sourcePath.toLowerCase();
    let matchedMeshCount = 0;
    let hasMissingDiffuseStream = false;
    rootNode.iterate((node) => {
      if (!node?.isMesh?.()) {
        return false;
      }
      const meshMaterial = node.material?.coreMaterial ?? node.material ?? null;
      const materialAssetId = (getEngine().resourceManager.getAssetId(meshMaterial) ?? '').toLowerCase();
      if (materialAssetId !== normalizedPath) {
        return false;
      }
      matchedMeshCount++;
      if (!node.primitive?.getVertexBuffer?.('diffuse')) {
        hasMissingDiffuseStream = true;
        return true;
      }
      return false;
    });
    return matchedMeshCount > 0 && !hasMissingDiffuseStream;
  }
  private async createPBRBlueprintFragmentState(
    material: PBRMetallicRoughnessMaterial,
    options?: {
      explicitVertexColor?: boolean;
    }
  ) {
    let nextId = 1;
    const nodes: BlueprintNodeState[] = [];
    const links: BlueprintLinkState[] = [];
    const rootId = nextId++;
    nodes.push(await this.serializeBlueprintNode(rootId, new PBRBlockNode(), [640, 60], '', true));
    const addLink = (startNodeId: number, startSlotId: number, endNodeId: number, endSlotId: number) => {
      links.push({
        startNodeId,
        startSlotId,
        endNodeId,
        endSlotId
      });
    };
    const connectRoot = (source: { nodeId: number; slotId?: number }, targetSlotId: number) => {
      addLink(source.nodeId, source.slotId ?? 1, rootId, targetSlotId);
    };
    const setUniformName = (
      node: { isUniform: boolean; paramName: string },
      uniformName: string | null | undefined
    ) => {
      if (!uniformName) {
        return;
      }
      node.isUniform = true;
      node.paramName = uniformName.startsWith('u_') ? uniformName : `u_${uniformName}`;
    };
    const addScalarNode = async (
      value: number,
      position: [number, number],
      targetSlotId: number | null = null
    ) => {
      const nodeId = nextId++;
      const node = new ConstantScalarNode();
      node.x = value;
      nodes.push(await this.serializeBlueprintNode(nodeId, node, position));
      if (targetSlotId !== null) {
        connectRoot({ nodeId }, targetSlotId);
      }
      return nodeId;
    };
    const addVec3Node = async (
      x: number,
      y: number,
      z: number,
      position: [number, number],
      targetSlotId: number | null = null,
      uniformName?: string | null
    ) => {
      const nodeId = nextId++;
      const node = new ConstantVec3Node();
      node.x = x;
      node.y = y;
      node.z = z;
      setUniformName(node, uniformName);
      nodes.push(await this.serializeBlueprintNode(nodeId, node, position));
      if (targetSlotId !== null) {
        connectRoot({ nodeId }, targetSlotId);
      }
      return nodeId;
    };
    const addSwizzleNode = async (
      input: { nodeId: number; slotId?: number },
      swizzle: string,
      position: [number, number],
      targetSlotId: number | null = null
    ) => {
      const nodeId = nextId++;
      const node = new SwizzleNode();
      node.swizzle = swizzle;
      nodes.push(await this.serializeBlueprintNode(nodeId, node, position));
      addLink(input.nodeId, input.slotId ?? 1, nodeId, 1);
      if (targetSlotId !== null) {
        connectRoot({ nodeId }, targetSlotId);
      }
      return nodeId;
    };
    const addBinaryNode = async (
      NodeCtor: new () => CompAddNode | CompSubNode | CompMulNode,
      inputA: { nodeId: number; slotId?: number },
      inputB: { nodeId: number; slotId?: number },
      position: [number, number],
      targetSlotId: number | null = null
    ) => {
      const nodeId = nextId++;
      const node = new NodeCtor();
      nodes.push(await this.serializeBlueprintNode(nodeId, node, position));
      addLink(inputA.nodeId, inputA.slotId ?? 1, nodeId, 1);
      addLink(inputB.nodeId, inputB.slotId ?? 1, nodeId, 2);
      if (targetSlotId !== null) {
        connectRoot({ nodeId }, targetSlotId);
      }
      return nodeId;
    };
    const addMulNode = async (
      inputA: { nodeId: number; slotId?: number },
      inputB: { nodeId: number; slotId?: number },
      position: [number, number],
      targetSlotId: number | null = null
    ) => addBinaryNode(CompMulNode, inputA, inputB, position, targetSlotId);
    const addAddNode = async (
      inputA: { nodeId: number; slotId?: number },
      inputB: { nodeId: number; slotId?: number },
      position: [number, number],
      targetSlotId: number | null = null
    ) => addBinaryNode(CompAddNode, inputA, inputB, position, targetSlotId);
    const addSubNode = async (
      inputA: { nodeId: number; slotId?: number },
      inputB: { nodeId: number; slotId?: number },
      position: [number, number],
      targetSlotId: number | null = null
    ) => addBinaryNode(CompSubNode, inputA, inputB, position, targetSlotId);
    const addTextureNode = async (
      texture: unknown,
      options: {
        samplerType?: 'Color' | 'Normal';
        sRGB?: boolean;
        position: [number, number];
        sampler?: TextureSampler | null;
        wrapS?: string | null;
        wrapT?: string | null;
      }
    ) => {
      const textureId = this.getTextureAssetId(texture);
      if (!textureId) {
        return null;
      }
      const nodeId = nextId++;
      const node = new TextureSampleNode();
      node.textureId = textureId;
      node.samplerType = options.samplerType ?? 'Color';
      node.sRGB = options.sRGB ?? true;
      this.applyTextureSamplerToNode(node, options.sampler, options.wrapS, options.wrapT);
      nodes.push(await this.serializeBlueprintNode(nodeId, node, options.position));
      return nodeId;
    };
    const isVec3 = (x: number, y: number, z: number, value: number) =>
      x === value && y === value && z === value;
    const baseColorConstNodeId = await addVec3Node(
      material.albedoColor.x,
      material.albedoColor.y,
      material.albedoColor.z,
      [40, -120],
      null,
      'AlbedoColor'
    );
    let opacitySource: { nodeId: number; slotId?: number } | null =
      material.albedoColor.w !== 1
        ? { nodeId: await addScalarNode(material.albedoColor.w, [40, -20]) }
        : null;
    let baseColorSource: { nodeId: number; slotId?: number } = { nodeId: baseColorConstNodeId, slotId: 1 };
    if (material.albedoTexture) {
      const albedoTexNodeId = await addTextureNode(material.albedoTexture, {
        sRGB: true,
        position: [250, -120],
        sampler: material.albedoTextureSampler,
        wrapS: (material as PBRMetallicRoughnessMaterial & { albedoTexCoordAddressU?: string })
          .albedoTexCoordAddressU,
        wrapT: (material as PBRMetallicRoughnessMaterial & { albedoTexCoordAddressV?: string })
          .albedoTexCoordAddressV
      });
      baseColorSource = {
        nodeId: await addMulNode(
          { nodeId: baseColorConstNodeId, slotId: 1 },
          { nodeId: albedoTexNodeId, slotId: 6 },
          [470, -120]
        ),
        slotId: 1
      };
      const textureAlphaSource = { nodeId: albedoTexNodeId, slotId: 5 };
      opacitySource = opacitySource
        ? {
            nodeId: await addMulNode(opacitySource, textureAlphaSource, [470, -20]),
            slotId: 1
          }
        : textureAlphaSource;
    }
    if (options?.explicitVertexColor) {
      const vertexColorNodeId = nextId++;
      nodes.push(await this.serializeBlueprintNode(vertexColorNodeId, new VertexColorNode(), [690, -120]));
      baseColorSource = {
        nodeId: await addMulNode(
          baseColorSource,
          {
            nodeId: await addSwizzleNode({ nodeId: vertexColorNodeId, slotId: 1 }, 'rgb', [690, -60]),
            slotId: 1
          },
          [910, -120]
        ),
        slotId: 1
      };
      const vertexAlphaSource = {
        nodeId: await addSwizzleNode({ nodeId: vertexColorNodeId, slotId: 1 }, 'a', [690, 0])
      };
      opacitySource = opacitySource
        ? {
            nodeId: await addMulNode(opacitySource, vertexAlphaSource, [910, -20]),
            slotId: 1
          }
        : vertexAlphaSource;
    }
    connectRoot(baseColorSource, 1);
    if (opacitySource) {
      connectRoot(opacitySource, 8);
    }
    const metallicRoughnessTextureNodeId = material.metallicRoughnessTexture
      ? await addTextureNode(material.metallicRoughnessTexture, {
          sRGB: false,
          position: [20, 80],
          sampler: material.metallicRoughnessTextureSampler
        })
      : null;
    if (metallicRoughnessTextureNodeId) {
      if (material.metallic !== 1) {
        const metallicFactorNodeId = await addScalarNode(material.metallic, [20, 20]);
        connectRoot(
          {
            nodeId: await addMulNode(
              { nodeId: metallicFactorNodeId },
              { nodeId: metallicRoughnessTextureNodeId, slotId: 4 },
              [240, 20]
            )
          },
          2
        );
      } else {
        connectRoot({ nodeId: metallicRoughnessTextureNodeId, slotId: 4 }, 2);
      }
      if (material.roughness !== 1) {
        const roughnessFactorNodeId = await addScalarNode(material.roughness, [20, 140]);
        connectRoot(
          {
            nodeId: await addMulNode(
              { nodeId: roughnessFactorNodeId },
              { nodeId: metallicRoughnessTextureNodeId, slotId: 3 },
              [240, 140]
            )
          },
          3
        );
      } else {
        connectRoot({ nodeId: metallicRoughnessTextureNodeId, slotId: 3 }, 3);
      }
    } else {
      if (material.metallic !== 1) {
        await addScalarNode(material.metallic, [20, 20], 2);
      }
      if (material.roughness !== 1) {
        await addScalarNode(material.roughness, [20, 140], 3);
      }
    }
    const specularColorTextureNodeId = material.specularColorTexture
      ? await addTextureNode(material.specularColorTexture, {
          sRGB: true,
          position: [20, 260],
          sampler: material.specularColorTextureSampler
        })
      : null;
    if (specularColorTextureNodeId) {
      if (!isVec3(material.specularFactor.x, material.specularFactor.y, material.specularFactor.z, 1)) {
        const specularFactorNodeId = await addVec3Node(
          material.specularFactor.x,
          material.specularFactor.y,
          material.specularFactor.z,
          [20, 320],
          null,
          'SpecularFactor'
        );
        connectRoot(
          {
            nodeId: await addMulNode(
              { nodeId: specularFactorNodeId },
              { nodeId: specularColorTextureNodeId, slotId: 6 },
              [240, 260]
            )
          },
          4
        );
      } else {
        connectRoot({ nodeId: specularColorTextureNodeId, slotId: 6 }, 4);
      }
    } else if (!isVec3(material.specularFactor.x, material.specularFactor.y, material.specularFactor.z, 1)) {
      await addVec3Node(
        material.specularFactor.x,
        material.specularFactor.y,
        material.specularFactor.z,
        [20, 260],
        4,
        'SpecularFactor'
      );
    }
    const specularTextureNodeId = material.specularTexture
      ? await addTextureNode(material.specularTexture, {
          sRGB: false,
          position: [20, 440],
          sampler: material.specularTextureSampler
        })
      : null;
    if (specularTextureNodeId) {
      if (material.specularFactor.w !== 1) {
        const specularWeightNodeId = await addScalarNode(material.specularFactor.w, [20, 380]);
        connectRoot(
          {
            nodeId: await addMulNode(
              { nodeId: specularWeightNodeId },
              { nodeId: specularTextureNodeId, slotId: 5 },
              [240, 440]
            )
          },
          9
        );
      } else {
        connectRoot({ nodeId: specularTextureNodeId, slotId: 5 }, 9);
      }
    } else if (material.specularFactor.w !== 1) {
      await addScalarNode(material.specularFactor.w, [20, 380], 9);
    }
    const emissiveTextureNodeId = material.emissiveTexture
      ? await addTextureNode(material.emissiveTexture, {
          sRGB: true,
          position: [300, 40],
          sampler: material.emissiveTextureSampler
        })
      : null;
    // A blueprint Emissive output replaces the whole emissive term, so it can only carry one of the
    // material's two authoring quantities. This bakes the legacy display-referred emissiveStrength;
    // the physical emissiveLuminance is copied onto the blueprint material by copyFrom but is not
    // reachable from the graph. Retune the baked value if the target scene is in physical mode.
    const emissiveFactor =
      material.emissiveStrength !== 1
        ? {
            nodeId: await addVec3Node(
              material.emissiveColor.x * material.emissiveStrength,
              material.emissiveColor.y * material.emissiveStrength,
              material.emissiveColor.z * material.emissiveStrength,
              [300, -20],
              null,
              'Emissive'
            )
          }
        : !isVec3(material.emissiveColor.x, material.emissiveColor.y, material.emissiveColor.z, 0)
          ? {
              nodeId: await addVec3Node(
                material.emissiveColor.x,
                material.emissiveColor.y,
                material.emissiveColor.z,
                [300, -20],
                null,
                'Emissive'
              )
            }
          : null;
    if (emissiveTextureNodeId) {
      if (emissiveFactor) {
        connectRoot(
          {
            nodeId: await addMulNode(emissiveFactor, { nodeId: emissiveTextureNodeId, slotId: 6 }, [520, 40])
          },
          5
        );
      } else {
        connectRoot({ nodeId: emissiveTextureNodeId, slotId: 6 }, 5);
      }
    } else if (emissiveFactor) {
      connectRoot(emissiveFactor, 5);
    }
    if (material.normalTexture) {
      const normalTextureNodeId = await addTextureNode(material.normalTexture, {
        samplerType: 'Normal',
        sRGB: false,
        position: [300, 160],
        sampler: material.normalTextureSampler
      });
      connectRoot({ nodeId: normalTextureNodeId, slotId: 6 }, 6);
    }
    if (material.occlusionTexture) {
      const occlusionTextureNodeId = await addTextureNode(material.occlusionTexture, {
        sRGB: false,
        position: [300, 440],
        sampler: material.occlusionTextureSampler
      });
      if (material.occlusionStrength !== 1) {
        const oneNodeId = await addScalarNode(1, [300, 560]);
        const occlusionStrengthNodeId = await addScalarNode(material.occlusionStrength, [300, 620]);
        const deltaNodeId = await addSubNode(
          { nodeId: occlusionTextureNodeId, slotId: 2 },
          { nodeId: oneNodeId },
          [520, 500]
        );
        const scaledNodeId = await addMulNode(
          { nodeId: deltaNodeId },
          { nodeId: occlusionStrengthNodeId },
          [740, 500]
        );
        connectRoot(
          {
            nodeId: await addAddNode({ nodeId: oneNodeId }, { nodeId: scaledNodeId }, [960, 500])
          },
          10
        );
      } else {
        connectRoot({ nodeId: occlusionTextureNodeId, slotId: 2 }, 10);
      }
    }
    return {
      nodes,
      links,
      canvasOffset: [0, 0],
      canvasScale: 1
    };
  }
  private collectBlueprintUniforms(fragmentIR: MaterialBlueprintIR, vertexIR?: MaterialBlueprintIR | null) {
    const uniformValues: BluePrintUniformValue[] = [];
    const uniformTextures: BluePrintUniformTexture[] = [];
    for (const ir of [fragmentIR, vertexIR]) {
      if (!ir) {
        continue;
      }
      for (const u of ir.uniformValues) {
        const exists = uniformValues.find((v) => v.name === u.name);
        if (exists) {
          if (ir === fragmentIR) {
            exists.inFragmentShader = true;
          } else {
            exists.inVertexShader = true;
          }
          continue;
        }
        uniformValues.push({
          name: u.name,
          type: u.type,
          value: typeof u.value === 'number' ? [u.value] : [...u.value],
          inVertexShader: ir === vertexIR,
          inFragmentShader: ir === fragmentIR
        });
      }
      for (const u of ir.uniformTextures) {
        const exists = uniformTextures.find((v) => v.name === u.name);
        if (exists) {
          if (ir === fragmentIR) {
            exists.inFragmentShader = true;
          } else {
            exists.inVertexShader = true;
          }
          continue;
        }
        uniformTextures.push({
          name: u.name,
          type: u.type,
          texture: u.texture,
          sRGB: u.sRGB,
          wrapS: u.wrapS,
          wrapT: u.wrapT,
          minFilter: u.minFilter,
          magFilter: u.magFilter,
          mipFilter: u.mipFilter,
          inVertexShader: ir === vertexIR,
          inFragmentShader: ir === fragmentIR
        });
      }
    }
    return {
      uniformValues,
      uniformTextures
    };
  }
  async runWithVFSBatchUpdate<T>(task: () => Promise<T>): Promise<T> {
    this._vfsBatchDepth++;
    try {
      return await task();
    } finally {
      this._vfsBatchDepth--;
      if (this._vfsBatchDepth <= 0) {
        this._vfsBatchDepth = 0;
        if (this._vfsBatchReloadPending) {
          this._vfsBatchReloadPending = false;
          this.queueFileSystemReload(true);
        }
      }
    }
  }
  get revealInFileManagerLabel() {
    return getDesktopAPI()?.platform === 'win32' ? 'Show in Explorer' : 'Reveal in File Manager';
  }
  render() {
    if (
      ImGui.BeginChild(
        `##VFSViewContainer${this.id}`,
        new ImGui.ImVec2(-1, -1),
        false,
        ImGui.WindowFlags.None
      )
    ) {
      const pos = ImGui.GetCursorPos();
      if (this._treePanel.beginChild(`##VFSViewTree${this.id}`)) {
        const contentMin = ImGui.GetWindowPos();
        const contentMax = new ImGui.ImVec2(
          contentMin.x + ImGui.GetWindowSize().x,
          contentMin.y + ImGui.GetWindowSize().y
        );

        this._navigationBounds = {
          min: contentMin,
          max: contentMax
        };

        if (this._isDragOverNavigation) {
          this.renderNavigationDropHighlight();
        }
        if (this._filesystem) {
          const forceNavRefresh = this._forceNavRefresh;
          this._forceNavRefresh = false;
          this._nav.render(forceNavRefresh);
          //this.renderDir(this._filesystem);
        }
      }
      this._treePanel.endChild();

      ImGui.SetCursorPos(new ImGui.ImVec2(this._treePanel.width + 8, pos.y));
      if (
        ImGui.BeginChild(
          `##VFSViewContent${this.id}`,
          new ImGui.ImVec2(-1, -1),
          false,
          ImGui.WindowFlags.None
        )
      ) {
        this.renderContentArea();
      }
      ImGui.EndChild();
    }
    ImGui.EndChild();
  }

  public isMouseInArea(mousePos: ImGui.ImVec2, area: 'navigation' | 'content'): boolean {
    const bounds = area === 'navigation' ? this._navigationBounds : this._contentBounds;

    if (!bounds) {
      return false;
    }

    return (
      mousePos.x >= bounds.min.x &&
      mousePos.x <= bounds.max.x &&
      mousePos.y >= bounds.min.y &&
      mousePos.y <= bounds.max.y
    );
  }

  public getDropZoneAtPosition(mousePos: ImGui.ImVec2): DropZone {
    if (this.isMouseInArea(mousePos, 'navigation')) {
      return DropZone.Navigation;
    } else if (this.isMouseInArea(mousePos, 'content')) {
      return DropZone.Content;
    }
    return DropZone.None;
  }

  public setDragOverState(mousePos: ImGui.ImVec2, isDragging: boolean) {
    if (!isDragging) {
      this._isDragOverNavigation = false;
      this._isDragOverContent = false;
      return;
    }

    const zone = this.getDropZoneAtPosition(mousePos);
    this._isDragOverNavigation = zone === DropZone.Navigation;
    this._isDragOverContent = zone === DropZone.Content;
  }

  private renderContentArea() {
    ImGui.BeginChild(
      `##VFSContentToolBar${this.id}`,
      new ImGui.ImVec2(-1, ImGui.GetFrameHeight() + ImGui.GetStyle().ItemSpacing.y),
      false
    );
    this.renderToolbar();
    ImGui.EndChild();

    ImGui.BeginChild(`##VFSContentContainer${this.id}`, new ImGui.ImVec2(-1, -1), true);
    const contentMin = ImGui.GetCursorScreenPos();
    const availableSize = ImGui.GetContentRegionAvail();
    const contentMax = new ImGui.ImVec2(contentMin.x + availableSize.x, contentMin.y + availableSize.y);

    this._contentBounds = {
      min: contentMin,
      max: contentMax
    };

    if (this._isDragOverContent) {
      this.renderContentDropHighlight();
    }

    ImGui.BeginChild(`##VFSContentInnerContainer${this.id}`, new ImGui.ImVec2(-1, -1), false);
    if (this.selectedDir) {
      this._contentView.render();
    } else {
      const windowSize = ImGui.GetWindowSize();
      const textSize = imGuiCalcTextSize('Select a folder to view its contents');
      ImGui.SetCursorPos(
        new ImGui.ImVec2((windowSize.x - textSize.x) * 0.5, (windowSize.y - textSize.y) * 0.5)
      );
      ImGui.TextDisabled('Select a folder to view its contents');
    }
    ImGui.EndChild();
    ImGui.EndChild();
  }

  private renderNavigationDropHighlight() {
    const drawList = ImGui.GetWindowDrawList();
    const bounds = this._navigationBounds;

    if (!bounds) {
      return;
    }

    const highlightColor = ImGui.ColorConvertFloat4ToU32(new ImGui.ImVec4(0.3, 0.7, 1.0, 0.6));
    const backgroundColor = ImGui.ColorConvertFloat4ToU32(new ImGui.ImVec4(0.3, 0.7, 1.0, 0.1));
    drawList.AddRectFilled(bounds.min, bounds.max, backgroundColor, 4.0);
    drawList.AddRect(bounds.min, bounds.max, highlightColor, 4.0, ImGui.DrawCornerFlags.None, 2.0);
  }

  private renderContentDropHighlight() {
    const drawList = ImGui.GetWindowDrawList();
    const bounds = this._contentBounds;

    if (!bounds) {
      return;
    }

    const highlightColor = ImGui.ColorConvertFloat4ToU32(new ImGui.ImVec4(0.3, 1.0, 0.3, 0.6));
    const backgroundColor = ImGui.ColorConvertFloat4ToU32(new ImGui.ImVec4(0.3, 1.0, 0.3, 0.1));
    drawList.AddRectFilled(bounds.min, bounds.max, backgroundColor, 4.0);
    drawList.AddRect(bounds.min, bounds.max, highlightColor, 4.0, ImGui.DrawCornerFlags.None, 2.0);
  }

  public getDropTargetDirectory(): DirectoryInfo | null {
    if (this._isDragOverNavigation) {
      return this._filesystem;
    } else if (this._isDragOverContent) {
      return this.selectedDir;
    }
    return null;
  }

  public getDragDropInfo() {
    return {
      isOverNavigation: this._isDragOverNavigation,
      isOverContent: this._isDragOverContent,
      targetDirectory: this.getDropTargetDirectory(),
      dropZone: this._isDragOverNavigation
        ? DropZone.Navigation
        : this._isDragOverContent
          ? DropZone.Content
          : DropZone.None
    };
  }

  private renderToolbar() {
    const canGoUp = this.selectedDir && this.selectedDir.parent;
    if (canGoUp) {
      if (ImGui.Button('⬆##DirUP')) {
        this.selectedDir.parent.open = true;
        this._nav.selectNode(this.selectedDir.parent);
      }
    } else {
      ImGui.PushStyleVar(ImGui.StyleVar.Alpha, 0.5);
      ImGui.Button('⬆##DirUP');
      ImGui.PopStyleVar();
    }
    if (ImGui.IsItemHovered()) {
      ImGui.SetTooltip(canGoUp ? 'Go to parent directory' : 'Already at root directory');
    }
    if (!this._vfs.readOnly && this._options.showDependencyTools) {
      ImGui.SameLine();
      if (ImGui.Button(convertEmojiString('📦##ImportPackage'))) {
        DlgPromptName.promptName('Install Package', 'package', 'packageName@x.y.z').then((val) => {
          if (val) {
            ProjectService.getCurrentProjectSettings().then((settings) => {
              if (settings.dependencies && val in settings.dependencies) {
                DlgMessage.messageBox('Error', `Package ${val} already installed`);
              } else {
                const dlgMessageBoxEx = new DlgMessageBoxEx(
                  'Install package',
                  '',
                  ['Installing...'],
                  400,
                  0,
                  false
                );
                dlgMessageBoxEx.showModal();
                installDeps(
                  ProjectService.currentProject,
                  this.VFS,
                  '/',
                  val,
                  (msg) => (dlgMessageBoxEx.text = msg)
                ).then((result) => {
                  console.info('Dependencies installed');
                  dlgMessageBoxEx.buttons[0] = 'Ok';
                  settings.dependencies = Object.assign(settings.dependencies ?? {}, {
                    [result.name]: result.version
                  });
                  ProjectService.saveCurrentProjectSettings(settings);
                });
              }
            });
          }
        });
      }
      if (ImGui.IsItemHovered()) {
        ImGui.SetTooltip('Installs a third party library');
      }
      ImGui.SameLine();
      if (ImGui.Button(convertEmojiString('♻️##ReinstallPackages'))) {
        reinstallPackages();
      }
      if (ImGui.IsItemHovered()) {
        ImGui.SetTooltip('Reinstalls all third party libraries');
      }
    }
    ImGui.SameLine();
    ImGui.Dummy(new ImGui.ImVec2(20, 0));
    ImGui.SameLine();

    if (ImGui.RadioButton('List', this._contentView?.type === 'list')) {
      this._contentView.type = 'list';
    }
    ImGui.SameLine();

    if (ImGui.RadioButton('Grid', this._contentView?.type === 'grid')) {
      this._contentView.type = 'grid';
    }
    ImGui.SameLine();

    if (ImGui.RadioButton('Details', this._contentView?.type === 'detail')) {
      this._contentView.type = 'detail';
    }

    ImGui.SameLine();
    ImGui.Dummy(new ImGui.ImVec2(20, 0));
    ImGui.SameLine();

    if (this._contentView?.type === 'grid') {
      ImGui.SameLine();
      ImGui.Text('Size:');
      ImGui.SameLine();
      ImGui.SetNextItemWidth(100);
      const size = [this._contentView.gridItemSize] as [number];
      if (ImGui.SliderInt('##GridSize', size, 40, 120)) {
        this._contentView.gridItemSize = size[0];
      }
    }
  }

  fileDoubleClicked(file: FileInfo) {
    if (this._options.allowDblClickOpen) {
      if (file.meta.path.toLowerCase().endsWith('.zscn')) {
        // open scene
        eventBus.dispatchEvent('action', 'OPEN_DOC', { path: file.meta.path });
      } else if (file.meta.path.toLowerCase().endsWith('.zmtl')) {
        let name = this._vfs.basename(file.meta.path).slice(0, -5);
        if (this._vfs.isParentOf('/assets/@builtins', file.meta.path)) {
          name = `${name} (read-only)`;
        }
        eventBus.dispatchEvent('edit_material', name, name, null, file.meta.path);
      } else if (file.meta.path.toLowerCase().endsWith('.zmf')) {
        eventBus.dispatchEvent('edit_material_function', file.meta.path);
      } else if (file.meta.path.toLowerCase().endsWith('.zmsh')) {
        let name = this._vfs.basename(file.meta.path).slice(0, -5);
        if (this._vfs.isParentOf('/assets/@builtins', file.meta.path)) {
          name = `${name} (read-only)`;
        }
        eventBus.dispatchEvent('edit_primitive', name, file.meta.path);
      } else {
        const mimeType = this._vfs.guessMIMEType(file.meta.path);
        this.openFile(file.meta.path, mimeType);
      }
    }
    this.dispatchEvent('file_dbl_clicked', file);
  }

  openFile(path: string, mimeType: string) {
    if (this._options.openFile) {
      this._options.openFile(path, mimeType);
    } else {
      eventBus.dispatchEvent('action', 'EDIT_CODE', path, mimeType);
    }
  }

  renderFileThumbnail(file: FileInfo, min: ImGui.ImVec2, max: ImGui.ImVec2) {
    const mimeType = this._vfs.guessMIMEType(file.meta.path);
    const thumbnail = this._thumbnailService.request({
      vfs: this._vfs,
      path: file.meta.path,
      mimeType,
      meta: file.meta,
      thumbnailSize: Math.max(max.x - min.x, max.y - min.y)
    });
    if (thumbnail.status !== 'ready' || !thumbnail.texture) {
      return false;
    }

    const drawList = ImGui.GetWindowDrawList();
    const backgroundColor = ImGui.GetColorU32(new ImGui.ImVec4(0.14, 0.14, 0.14, 1));
    drawList.AddRectFilled(min, max, backgroundColor, 4);

    const boundsWidth = Math.max(1, max.x - min.x);
    const boundsHeight = Math.max(1, max.y - min.y);
    const aspectRatio = thumbnail.aspectRatio > 0 ? thumbnail.aspectRatio : 1;
    let drawWidth = boundsWidth;
    let drawHeight = drawWidth / aspectRatio;
    if (drawHeight > boundsHeight) {
      drawHeight = boundsHeight;
      drawWidth = drawHeight * aspectRatio;
    }

    const inset = 1;
    const clipMin = new ImGui.ImVec2(min.x + inset, min.y + inset);
    const clipMax = new ImGui.ImVec2(max.x - inset, max.y - inset);
    const offsetX = Math.round((boundsWidth - drawWidth) * 0.5);
    const offsetY = Math.round((boundsHeight - drawHeight) * 0.5);
    const alignedWidth = Math.min(Math.round(drawWidth), Math.max(1, clipMax.x - clipMin.x));
    const alignedHeight = Math.min(Math.round(drawHeight), Math.max(1, clipMax.y - clipMin.y));
    const drawMin = new ImGui.ImVec2(min.x + offsetX, min.y + offsetY);
    const drawMax = new ImGui.ImVec2(drawMin.x + alignedWidth, drawMin.y + alignedHeight);
    drawList.PushClipRect(clipMin, clipMax, true);
    drawList.AddImage(thumbnail.texture.get(), drawMin, drawMax);
    drawList.PopClipRect();
    return true;
  }

  private sortContent() {
    this._currentDirContent.sort((a, b) => {
      const isADir = 'subDir' in a;
      const isBDir = 'subDir' in b;

      if (isADir && !isBDir) {
        return -1;
      }
      if (!isADir && isBDir) {
        return 1;
      }
      const nameA = isADir ? a.path.slice(a.path.lastIndexOf('/') + 1) : (a as FileInfo).meta.name;
      const nameB = isBDir ? b.path.slice(b.path.lastIndexOf('/') + 1) : (b as FileInfo).meta.name;
      return nameA.localeCompare(nameB);
    });
  }

  getFileEmoji(meta: FileMetadata): string {
    const mimeType = guessMimeType(meta.name);
    if (mimeType.startsWith('image/')) {
      return '🖼️';
    }
    if (mimeType.startsWith('video/')) {
      return '🎬';
    }
    if (mimeType.startsWith('audio/')) {
      return '🔊';
    }
    if (mimeType.includes('text') || mimeType.includes('json')) {
      return '📝';
    }
    if (mimeType.includes('zip') || mimeType.includes('archive')) {
      return '📦';
    }

    const ext = meta.name.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'js':
      case 'ts':
      case 'jsx':
      case 'tsx':
      case 'py':
      case 'java':
      case 'cpp':
      case 'c':
      case 'h':
      case 'css':
      case 'scss':
      case 'sass':
      case 'less':
        return '📜';
      case 'html':
      case 'htm':
        return '🌍';
      case 'gltf':
      case 'glb':
        return '🧊';
      default:
        return '📄';
    }
  }

  formatFileSize(bytes: number): string {
    if (bytes === 0) {
      return '0 B';
    }

    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  formatDate(date: Date): string {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) {
      return date.toLocaleTimeString('en-US', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit'
      });
    } else if (days === 1) {
      return (
        'Yesterday ' +
        date.toLocaleTimeString('en-US', {
          hour12: false,
          hour: '2-digit',
          minute: '2-digit'
        })
      );
    } else if (days < 7) {
      return date.toLocaleDateString('en-US', { weekday: 'short' });
    } else {
      return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
    }
  }

  createNewFolder() {
    if (!this.selectedDir) {
      return;
    }

    DlgPromptName.promptName('Create Folder', 'NewFolder').then((name) => {
      name = name.trim();
      if (name) {
        const sanitized = PathUtils.sanitizeFilename(name);
        if (sanitized !== name) {
          DlgMessage.messageBox('Error', 'Invalid folder name');
        } else {
          const newPath = this._vfs.join(this.selectedDir.path, name);
          this._vfs.makeDirectory(newPath, false).catch((err) => {
            DlgMessage.messageBox('Error', `Create folder failed: ${err}`);
          });
        }
      }
    });
  }
  async createRampTexture(path: string) {
    const data = await DlgRampTextureCreator.createRampTexture(
      'Create Ramp Texture',
      true,
      null,
      null,
      600,
      400
    );
    if (data) {
      const sanitized = PathUtils.sanitizeFilename(data.name);
      const filePath = this._vfs.join(path, `${sanitized}.png`);
      const pngData = UPNG.encode([data.data.buffer], data.data.length >> 2, 1, 0);
      await this._vfs.writeFile(filePath, pngData, { create: true, encoding: 'binary' });
    }
  }
  async createNoiseTexture(path: string) {
    const result = await DlgNoiseTextureCreator.createNoiseTexture(
      'Create Noise Texture',
      this._vfs,
      path,
      960,
      620
    );
    if (result) {
      try {
        await this._vfs.writeFile(result.path, result.data, { create: true, encoding: 'binary' });
      } catch (err) {
        DlgMessage.messageBox('Error', `Create noise texture failed: ${err}`);
      }
    }
  }
  async createNewFile(title: string, defaultName: string, content: (path: string) => void | Promise<void>) {
    if (!this.selectedDir) {
      return;
    }
    const name = (await DlgPromptName.promptName(title, 'Name', defaultName)).trim();
    if (name) {
      if (PathUtils.sanitizeFilename(name) !== name) {
        DlgMessage.messageBox('Error', 'Invalid file name');
      } else {
        const newPath = this._vfs.join(this.selectedDir.path, name);
        const exists = await this._vfs.exists(newPath);
        if (exists) {
          const stat = await this._vfs.stat(newPath);
          if (stat.isDirectory) {
            DlgMessage.messageBox('Error', `${newPath} is a directory`);
          } else {
            if (
              'Yes' !==
              (await DlgMessageBoxEx.messageBoxEx(
                title,
                `'${this._vfs.basename(newPath)}' already exists, do you want to overwrite it?`,
                ['Yes', 'No']
              ))
            ) {
              return;
            }
          }
        }
        try {
          await content(newPath);
        } catch (err) {
          DlgMessage.messageBox('Error', `Create file failed: ${err}`);
        }
      }
    }
  }

  async convertMaterialToBlueprint(sourcePath: string) {
    const material = await getEngine().resourceManager.fetchMaterial(sourcePath, { overrideVFS: this._vfs });
    if (!(material instanceof PBRMetallicRoughnessMaterial)) {
      DlgMessage.messageBox(
        'Convert Material',
        'Only PBR metallic-roughness materials can be converted right now.'
      );
      return;
    }
    const sourceName = this._vfs.basename(sourcePath, this._vfs.extname(sourcePath));
    const defaultPath = this._vfs.join(this._vfs.dirname(sourcePath), `${sourceName}_bp.zmtl`);
    const outputPath = await DlgSaveFile.saveFile(
      'Convert To Blueprint Material',
      this._vfs,
      '/assets',
      'Material (*.zmtl)|*.zmtl',
      520,
      420,
      this._vfs.basename(defaultPath)
    );
    if (!outputPath) {
      return;
    }
    const finalMaterialPath = outputPath.toLowerCase().endsWith('.zmtl') ? outputPath : `${outputPath}.zmtl`;
    const blueprintPath = this._vfs.join(
      this._vfs.dirname(finalMaterialPath),
      `${this._vfs.basename(finalMaterialPath, '.zmtl')}.zbpt`
    );
    const blueprintMaterial = new PBRBluePrintMaterial();
    blueprintMaterial.copyFrom(material as PBRMetallicRoughnessMaterial & PBRBluePrintMaterial);
    // Vertex color on PBRM is an implicit backend multiply. Once we convert to an
    // explicit blueprint surface graph, keeping that flag would cause PBRM to apply
    // an extra vertex-color path on top of the blueprint output and may request a
    // diffuse vertex stream that the preview mesh does not provide.
    (blueprintMaterial as PBRBluePrintMaterial & { vertexColor?: boolean }).vertexColor = false;
    // These texture-backed surface channels are re-expressed in the generated blueprint graph.
    // Clearing the backend texture props avoids applying the same maps twice in the inherited PBRM path.
    const blueprintMaterialPBR = blueprintMaterial as PBRBluePrintMaterial & {
      albedoTexture: unknown;
      metallicRoughnessTexture: unknown;
      specularColorTexture: unknown;
      specularTexture: unknown;
      emissiveTexture: unknown;
      normalTexture: unknown;
      occlusionTexture: unknown;
    };
    blueprintMaterialPBR.albedoTexture = null;
    blueprintMaterialPBR.metallicRoughnessTexture = null;
    blueprintMaterialPBR.specularColorTexture = null;
    blueprintMaterialPBR.specularTexture = null;
    blueprintMaterialPBR.emissiveTexture = null;
    blueprintMaterialPBR.normalTexture = null;
    blueprintMaterialPBR.occlusionTexture = null;
    const explicitVertexColor = this.shouldExplicitizeVertexColor(sourcePath, material);
    const fragmentState = await this.createPBRBlueprintFragmentState(material, {
      explicitVertexColor
    });
    const blueprintContent = {
      type: 'PBRMaterial',
      state: {
        fragment: fragmentState,
        vertex: blueprintMaterial.vertexIR.editorState
      }
    };
    await this.runWithVFSBatchUpdate(async () => {
      await this._vfs.writeFile(blueprintPath, JSON.stringify(blueprintContent, null, 2), {
        encoding: 'utf8',
        create: true
      });
      getEngine().resourceManager.invalidateBluePrint(blueprintPath);
      const blueprints = await getEngine().resourceManager.loadBluePrint(blueprintPath);
      const fragmentIR = blueprints?.fragment ?? blueprintMaterial.fragmentIR;
      const vertexIR = blueprints?.vertex ?? blueprintMaterial.vertexIR;
      blueprintMaterial.fragmentIR = fragmentIR;
      blueprintMaterial.vertexIR = vertexIR;
      const uniforms = this.collectBlueprintUniforms(fragmentIR, vertexIR);
      const props = await getEngine().resourceManager.serializeObjectProps(blueprintMaterial);
      const materialContent = {
        type: 'PBRBluePrintMaterial',
        props,
        data: {
          IR: blueprintPath,
          uniformValues: uniforms.uniformValues,
          uniformTextures: uniforms.uniformTextures
        }
      };
      await this._vfs.writeFile(finalMaterialPath, JSON.stringify(materialContent, null, 2), {
        encoding: 'utf8',
        create: true
      });
    });
    getEngine().resourceManager.invalidateBluePrint(blueprintPath);
    const label = this._vfs.basename(finalMaterialPath, '.zmtl');
    eventBus.dispatchEvent('edit_material', label, label, null, finalMaterialPath);
  }

  async exportSelectedItems() {
    if (this.selectedItems.size === 0) {
      return;
    }
    const items = Array.from(this.selectedItems);
    const selectedPaths = items.map((item) => ('subDir' in item ? item.path : item.meta.path));
    const preserveAssetsPath = selectedPaths.every(
      (path) => path === '/assets' || this._vfs.isParentOf('/assets', path)
    );
    if (items.length === 1 && !('subDir' in items[0]) && !preserveAssetsPath) {
      const filename = this._vfs.basename(items[0].meta.path);
      this._vfs.readFile(items[0].meta.path, { encoding: 'binary' }).then((data) => {
        exportFile(data as ArrayBuffer, filename);
      });
    } else {
      const files = (items.filter((items) => !('subDir' in items)) as FileInfo[]).map(
        (item: FileInfo) => item.meta.path
      );
      const dirs = (items.filter((items) => 'subDir' in items) as DirectoryInfo[]).map(
        (item: DirectoryInfo) => item.path
      );
      const dlgProgressBar = new DlgProgress('Export Assets##ExportProgress', 320);
      dlgProgressBar.showModal();
      dlgProgressBar.setProgress(0, 1);
      const zipFilename =
        items.length === 1
          ? `${this._vfs.basename('subDir' in items[0] ? items[0].path : items[0].meta.path)}.zip`
          : preserveAssetsPath
            ? 'assets-export.zip'
            : 'export.zip';
      try {
        if (preserveAssetsPath && isDesktopApp()) {
          const desktop = getDesktopAPI();
          const targetRoot = await desktop?.fs.pickDirectory({
            title: 'Select Export Directory',
            buttonLabel: 'Export Here'
          });
          if (!targetRoot) {
            return;
          }
          const targetFS = new ElectronFS(`project:${targetRoot}`);
          const resetPaths: string[] = [];
          try {
            if (await targetFS.exists('/assets')) {
              const existingEntries = await targetFS.readDirectory('/assets', {
                includeHidden: true,
                recursive: false
              });
              if (existingEntries.length > 0) {
                const action = await DlgMessageBoxEx.messageBoxEx(
                  'Export Assets',
                  'The target directory already contains an assets folder.\n\nReplace it, merge into it, or cancel?',
                  ['Replace', 'Merge', 'Cancel'],
                  420,
                  0,
                  true
                );
                if (action === 'Cancel' || !action) {
                  return;
                }
                if (action === 'Replace') {
                  resetPaths.push('/assets');
                }
              }
            }
          } finally {
            await targetFS.close();
          }
          const exported = await exportMultipleFilesToDirectory(files, dirs, this._vfs, {
            preserveProjectPaths: true,
            targetRoot,
            resetPaths,
            onProgress: (current, total) => dlgProgressBar.setProgress(current, total)
          });
          if (!exported) {
            return;
          }
        } else {
          await exportMultipleFilesAsZip(files, dirs, zipFilename, this._vfs, {
            preserveProjectPaths: preserveAssetsPath,
            onProgress: (current, total) => dlgProgressBar.setProgress(current, total)
          });
        }
      } finally {
        dlgProgressBar.close();
      }
    }
  }

  async exportPrimitiveAsGlb(path: string) {
    try {
      const content = (await this._vfs.readFile(path, { encoding: 'utf8' })) as string;
      const filename = `${PathUtils.basename(path, '.zmsh')}.glb`;
      const glb = buildPrimitiveGlbFromZmshContent(content, PathUtils.basename(path, '.zmsh'), path);
      exportFile(glb, filename);
    } catch (err) {
      DlgMessage.messageBox('Error', `Export GLB failed: ${err}`);
    }
  }

  async duplicateSelectedItems(): Promise<boolean> {
    if (this._vfs.readOnly || this.selectedItems.size === 0) {
      return false;
    }
    const items = Array.from(this.selectedItems);
    for (const item of items) {
      const isDir = 'subDir' in item;
      const sourcePath = isDir ? item.path : item.meta.path;
      const targetPath = await this.makeDuplicatedPath(sourcePath, isDir);
      if (isDir) {
        await this.copyDirectoryRecursive(sourcePath, targetPath);
      } else {
        await this._vfs.copyFile(sourcePath, targetPath, {
          overwrite: false
        });
      }
    }
    return true;
  }

  deleteSelectedItems() {
    if (this.selectedItems.size === 0) {
      return;
    }

    const items = Array.from(this.selectedItems);
    const deletedPaths = items.map((item) => ('subDir' in item ? item.path : item.meta.path));
    eventBus.dispatchEvent('assets_deleting', deletedPaths);
    const deletePromises = items.map((item) => {
      const isDir = 'subDir' in item;
      if (isDir) {
        return this._vfs.deleteDirectory(item.path, true);
      } else {
        return this._vfs.deleteFile((item as FileInfo).meta.path);
      }
    });

    Promise.all(deletePromises)
      .then(() => {
        this.removePathsFromFileSystem(deletedPaths);
        this._contentView.deselectAll();
        this.refreshFileView();
        this.emitSelectedChanged();
        this.queueFileSystemReload(true);
      })
      .catch((err) => {
        DlgMessage.messageBox('Error', `Delete failed: ${err}`);
      });
  }

  private async makeDuplicatedPath(sourcePath: string, isDir: boolean): Promise<string> {
    const parentPath = this._vfs.dirname(sourcePath);
    const basename = this._vfs.basename(sourcePath);
    const ext = isDir ? '' : this._vfs.extname(basename);
    const stem = ext ? basename.slice(0, -ext.length) : basename;
    let index = 1;
    while (true) {
      const suffix = index === 1 ? ' copy' : ` copy ${index}`;
      const candidateName = `${stem}${suffix}${ext}`;
      const candidatePath = this._vfs.join(parentPath, candidateName);
      if (!(await this._vfs.exists(candidatePath))) {
        return candidatePath;
      }
      index++;
    }
  }

  private async copyDirectoryRecursive(sourceDir: string, targetDir: string): Promise<void> {
    await this._vfs.makeDirectory(targetDir, true);
    const entries = await this._vfs.readDirectory(sourceDir, {
      includeHidden: true,
      recursive: true
    });
    for (const entry of entries) {
      const relativePath = PathUtils.relative(sourceDir, entry.path);
      if (!relativePath || relativePath === '.') {
        continue;
      }
      const targetPath = this._vfs.join(targetDir, relativePath);
      if (entry.type === 'directory') {
        await this._vfs.makeDirectory(targetPath, true);
      } else if (entry.type === 'file') {
        const parentDir = this._vfs.dirname(targetPath);
        if (!(await this._vfs.exists(parentDir))) {
          await this._vfs.makeDirectory(parentDir, true);
        }
        await this._vfs.copyFile(entry.path, targetPath, {
          overwrite: false
        });
      }
    }
  }

  canRevealInFileManager(item: DirectoryInfo | FileInfo | null | undefined) {
    if (!item || !(this._vfs instanceof ElectronFS) || !getDesktopAPI()?.fs?.revealPath) {
      return false;
    }
    const targetPath = this.getItemPath(item);
    if (this.isMountedVirtualAssetPath(targetPath)) {
      return false;
    }
    return true;
  }

  revealItemInFileManager(item: DirectoryInfo | FileInfo) {
    if (!this.canRevealInFileManager(item)) {
      return;
    }
    const targetPath = 'subDir' in item ? item.path : item.meta.path;
    void (this._vfs as ElectronFS).revealPath(targetPath).catch((err) => {
      DlgMessage.messageBox('Error', `Reveal path failed: ${err}`);
    });
  }

  private isMountedVirtualAssetPath(path: string) {
    return this._vfs.isParentOf('/assets/@builtins', path);
  }

  renameItem(item: DirectoryInfo | FileInfo) {
    const isDir = 'subDir' in item;
    const currentName = isDir
      ? item.path.slice(item.path.lastIndexOf('/') + 1)
      : (item as FileInfo).meta.name;
    DlgRename.rename('Rename', currentName).then(async (newName) => {
      newName = newName.trim();
      if (newName && newName !== currentName) {
        if (PathUtils.sanitizeFilename(newName) !== newName) {
          DlgMessage.messageBox('Error', 'Invalid name');
        } else {
          try {
            const oldPath = isDir ? item.path : item.meta.path;
            const parentPath = isDir
              ? item.path.slice(0, item.path.lastIndexOf('/'))
              : (item as FileInfo).meta.path.slice(0, (item as FileInfo).meta.path.lastIndexOf('/'));
            const newPath = this._vfs.join(parentPath, newName);
            await this._vfs.move(oldPath, newPath);
            try {
              await this.rewriteAssetReferencesAfterMove([
                {
                  oldPath,
                  newPath,
                  isDirectory: isDir
                }
              ]);
            } catch (err) {
              console.warn(`Rewrite references after rename failed: ${err}`);
            }
          } catch (err) {
            DlgMessage.messageBox('Error', `Rename failed: ${err}`);
          }
        }
      }
    });
  }

  renameSelectedItem() {
    if (this.selectedItems.size !== 1) {
      return;
    }
    this.renameItem(Array.from(this.selectedItems)[0]);
  }

  selectDir() {
    this.refreshFileView();
  }

  refreshFileView(preserveSelection = false, selectedItemPaths?: string[]) {
    const pathsToRestore = preserveSelection ? (selectedItemPaths ?? this.getSelectedItemPaths()) : [];
    if (!this.selectedDir) {
      this._currentDirContent = [];
      this._contentView.deselectAll();
      return;
    }

    this._currentDirContent = [...this.selectedDir.subDir, ...this.selectedDir.files];
    this.sortContent();
    if (pathsToRestore.length > 0) {
      const pathSet = new Set(pathsToRestore.map((path) => this._vfs.normalizePath(path)));
      const itemsToRestore = this._currentDirContent.filter((item) => pathSet.has(this.getItemPath(item)));
      this._contentView.deselectAll();
      if (itemsToRestore.length > 0) {
        this._contentView.selectItems(itemsToRestore);
      }
      return;
    }
    this._contentView.deselectAll();
  }

  private getSelectedItemPaths() {
    return [...this.selectedItems].map((item) => this.getItemPath(item));
  }

  private getItemPath(item: FileInfo | DirectoryInfo) {
    return this._vfs.normalizePath('subDir' in item ? item.path : item.meta.path);
  }

  private revealAsset(path: string) {
    void this.revealAssetAsync(path);
  }

  private async revealAssetAsync(path: string) {
    if (!path) {
      return;
    }
    const normalizedPath = this._vfs.normalizePath(path);
    if (!this._filesystem) {
      this._pendingRevealAssetPath = normalizedPath;
      return;
    }
    await this.selectAssetByPath(normalizedPath);
  }

  private async selectAssetByPath(path: string) {
    if (!path) {
      return;
    }
    const normalizedPath = this._vfs.normalizePath(path);
    const dirPath = this._vfs.dirname(normalizedPath);
    await this.ensureDirectoryChainLoaded(dirPath);
    const dir = this.findDirectoryByPath(this._filesystem, dirPath);
    if (!dir) {
      return;
    }
    this._nav.selectNode(dir);
    const file = dir.files.find((item) => this._vfs.normalizePath(item.meta.path) === normalizedPath);
    if (file) {
      this._contentView.deselectAll();
      this._contentView.selectItems([file]);
    }
  }

  renderDir(dir: DirectoryInfo) {
    const name = dir.path.slice(dir.path.lastIndexOf('/') + 1);
    const emoji = '📁';
    const id = dir.path;
    const label = convertEmojiString(
      `${emoji}${dir === this._filesystem ? this._options.rootDir : name}##${id}`
    );
    let flags = VFSRenderer.baseFlags;
    if (this.selectedDir === dir) {
      flags |= ImGui.TreeNodeFlags.Selected;
    }
    if (!dir.hasChildrenHint && dir.subDir.length === 0) {
      flags |= ImGui.TreeNodeFlags.Leaf;
    }
    const forceExpanded = this.selectedDir ? this.isParentOf(dir, this.selectedDir) : false;
    if (forceExpanded) {
      ImGui.SetNextItemOpen(true);
    }
    dir.open = ImGui.TreeNodeEx(label, flags);
    this.acceptFileMoveOrCopy(dir.path);
    if (ImGui.IsItemClicked(ImGui.MouseButton.Left)) {
      this._nav.selectNode(dir);
    }
    if (!this._vfs.readOnly) {
      if (ImGui.IsItemClicked(ImGui.MouseButton.Right)) {
        ImGui.OpenPopup(`vfs_${id}`);
      }
      if (ImGui.BeginPopup(`vfs_${id}`)) {
        if (ImGui.BeginMenu('Create New##VFSCreate')) {
          if (ImGui.MenuItem('Folder...##VFSCreateFolder')) {
            DlgPromptName.promptName('Create Folder', 'NewFolder').then((name) => {
              name = name.trim();
              if (name) {
                if (PathUtils.sanitizeFilename(name) !== name) {
                  DlgMessage.messageBox('Error', 'Invalid folder name');
                } else {
                  this._vfs
                    .readDirectory(dir.path, { includeHidden: true, recursive: false })
                    .then((items) => {
                      if (items.find((item) => item.type === 'directory' && item.name === name)) {
                        DlgMessage.messageBox('Error', 'A folder with same name already exists');
                      } else {
                        this._vfs.makeDirectory(this._vfs.join(dir.path, name), false).catch((err) => {
                          DlgMessage.messageBox('Error', `Create folder failed: ${err}`);
                        });
                      }
                    })
                    .catch((err) => {
                      DlgMessage.messageBox('Error', `Read parent path failed: ${err}`);
                    });
                }
              }
            });
          }
          ImGui.EndMenu();
        }
        if (dir !== this._filesystem && dir.path !== '/assets' && dir.path !== '/src') {
          if (ImGui.MenuItem('Delete##VFSDeleteFolder')) {
            this._vfs
              .deleteDirectory(dir.path, true)
              .then(() => {
                this.removePathsFromFileSystem([dir.path]);
                if (dir === this.selectedDir) {
                  this._nav.selectNode(null);
                }
                this.refreshFileView();
                this.emitSelectedChanged();
                this.queueFileSystemReload(true);
              })
              .catch((err) => {
                DlgMessage.messageBox('Error', `Delete directory failed: ${err}`);
              });
          }
          if (ImGui.MenuItem('Rename##VFSRenameFolder')) {
            this.renameItem(dir);
          }
        }
        ImGui.EndPopup();
      }
    }
    if (dir.open) {
      for (const subdir of dir.subDir) {
        this.renderDir(subdir);
      }
      ImGui.TreePop();
    }
  }

  async loadFileSystem() {
    const previousSelectedDirPath =
      this._selectedDirPath ??
      (this.selectedDir ? this._vfs.normalizePath(this.selectedDir.path) : this._options.rootDir);
    const rootDir = await this.loadDirectoryInfo(this._options.rootDir, 1);
    this._filesystem = rootDir;
    this._forceNavRefresh = true;

    let selectedDir: DirectoryInfo | null = this._filesystem;
    if (previousSelectedDirPath) {
      await this.ensureDirectoryChainLoaded(previousSelectedDirPath);
      selectedDir = this.findDirectoryByPath(this._filesystem, previousSelectedDirPath) ?? this._filesystem;
    }
    this._nav.selectNode(selectedDir);
    this._selectedDirPath = this._vfs.normalizePath(selectedDir?.path ?? this._options.rootDir);
    if (this._pendingRevealAssetPath) {
      const path = this._pendingRevealAssetPath;
      this._pendingRevealAssetPath = null;
      await this.selectAssetByPath(path);
    }

    this.dispatchEvent('loaded');
  }

  queueFileSystemReload(preserveSelection = false) {
    this._reloadQueued = true;
    this._reloadQueuedPreserveSelection = this._reloadQueuedPreserveSelection || preserveSelection;
    if (this._reloadTimer) {
      clearTimeout(this._reloadTimer);
    }
    this._reloadTimer = setTimeout(() => {
      this._reloadTimer = null;
      void this.flushFileSystemReload();
    }, 120);
  }

  private async flushFileSystemReload() {
    if (this._reloadingFileSystem || !this._reloadQueued) {
      return;
    }
    this._reloadingFileSystem = true;
    try {
      while (this._reloadQueued) {
        const preserveSelection = this._reloadQueuedPreserveSelection;
        this._reloadQueued = false;
        this._reloadQueuedPreserveSelection = false;
        const selectedItemPaths = preserveSelection ? this.getSelectedItemPaths() : [];
        await this.loadFileSystem();
        this.refreshFileView(preserveSelection, selectedItemPaths);
      }
    } finally {
      this._reloadingFileSystem = false;
    }
  }

  removePathsFromFileSystem(paths: string[]) {
    if (!this._filesystem || !paths?.length) {
      return;
    }
    const normalizedPaths = paths.map((path) => this._vfs.normalizePath(path));
    for (const path of normalizedPaths) {
      this.removePathFromDirectory(this._filesystem, path);
      if (this.selectedDir && this._vfs.normalizePath(this.selectedDir.path) === path) {
        const fallbackDir =
          this.findDirectoryByPath(this._filesystem, this._vfs.dirname(path)) ?? this._filesystem;
        this._nav.selectNode(fallbackDir);
      }
    }
  }

  private removePathFromDirectory(dir: DirectoryInfo, targetPath: string): boolean {
    const subDirIndex = dir.subDir.findIndex((subDir) => this._vfs.normalizePath(subDir.path) === targetPath);
    if (subDirIndex >= 0) {
      dir.subDir.splice(subDirIndex, 1);
      return true;
    }
    const fileIndex = dir.files.findIndex((file) => this._vfs.normalizePath(file.meta.path) === targetPath);
    if (fileIndex >= 0) {
      dir.files.splice(fileIndex, 1);
      return true;
    }
    for (const subDir of dir.subDir) {
      if (this.removePathFromDirectory(subDir, targetPath)) {
        return true;
      }
    }
    return false;
  }

  private findDirectoryByPath(root: DirectoryInfo, path: string): DirectoryInfo | null {
    if (root.path === path) {
      return root;
    }

    for (const subDir of root.subDir) {
      const found = this.findDirectoryByPath(subDir, path);
      if (found) {
        return found;
      }
    }

    return null;
  }

  async ensureDirectoryLoaded(dir: DirectoryInfo) {
    if (!dir || dir.loaded) {
      return;
    }
    const refreshed = await this.loadDirectoryInfo(dir.path, 1);
    if (!refreshed) {
      return;
    }
    dir.files = refreshed.files;
    dir.subDir = refreshed.subDir;
    dir.loaded = true;
    dir.hasChildrenHint = refreshed.hasChildrenHint;
    for (const subDir of dir.subDir) {
      subDir.parent = dir;
    }
    if (this.selectedDir === dir) {
      this.refreshFileView();
    }
  }

  private async ensureDirectoryChainLoaded(path: string) {
    if (!this._filesystem) {
      return;
    }
    const rootPath = this._vfs.normalizePath(this._filesystem.path);
    const normalizedPath = this._vfs.normalizePath(path);
    if (normalizedPath === rootPath) {
      await this.ensureDirectoryLoaded(this._filesystem);
      return;
    }
    const relative = normalizedPath.slice(rootPath.length).replace(/^\/+/, '');
    let current = this._filesystem;
    await this.ensureDirectoryLoaded(current);
    for (const part of relative.split('/').filter(Boolean)) {
      const nextPath = this._vfs.join(current.path, part);
      let next = current.subDir.find(
        (dir) => this._vfs.normalizePath(dir.path) === this._vfs.normalizePath(nextPath)
      );
      if (!next) {
        await this.ensureDirectoryLoaded(current);
        next = current.subDir.find(
          (dir) => this._vfs.normalizePath(dir.path) === this._vfs.normalizePath(nextPath)
        );
      }
      if (!next) {
        return;
      }
      current.open = true;
      next.parent = current;
      await this.ensureDirectoryLoaded(next);
      current = next;
    }
  }

  private isParentOf(parent: DirectoryInfo, child: DirectoryInfo) {
    while (child.parent) {
      if (parent.path === child.parent.path) {
        return true;
      }
      child = child.parent;
    }
    return false;
  }
  async loadDirectoryInfo(path: string, depth = Number.POSITIVE_INFINITY): Promise<DirectoryInfo> {
    if (!this._vfs) {
      return null;
    }

    try {
      const info: DirectoryInfo = {
        files: [],
        subDir: [],
        parent: null,
        open: false,
        path,
        loaded: depth > 0,
        hasChildrenHint: false
      };

      const content: FileMetadata[] =
        this._fileFilter?.length > 0
          ? await this._vfs.glob(this._fileFilter, { cwd: path, recursive: false, includeDirs: true })
          : await this._vfs.readDirectory(path, {
              includeHidden: true,
              recursive: false
            });

      for (const entry of content) {
        if (entry.type === 'directory') {
          info.hasChildrenHint = true;
          if (depth > 0) {
            const dirInfo =
              depth > 1
                ? await this.loadDirectoryInfo(entry.path, depth - 1)
                : {
                    files: [],
                    subDir: [],
                    parent: info,
                    open: false,
                    path: entry.path,
                    loaded: false,
                    hasChildrenHint: true
                  };
            if (dirInfo) {
              info.subDir.push(dirInfo);
              dirInfo.parent = info;
            }
          }
        } else if (entry.type === 'file') {
          info.files.push({
            meta: entry,
            parent: info
          });
        }
      }

      return info;
    } catch {
      return null;
    }
  }

  async handleDragEvent(ev: DragEvent) {
    if (DialogRenderer.isModalDialogOpened()) {
      return;
    }
    const info = this.getDragDropInfo();
    this.setDragOverState(
      new ImGui.ImVec2(ev.offsetX, ev.offsetY),
      ev.type !== 'dragleave' && ev.type !== 'drop'
    );
    if (info.targetDirectory && ev.type === 'drop' && !this._vfs.readOnly) {
      const data = ev.dataTransfer;
      const dtVFS = new DataTransferVFS(data);
      if (!this._vfs.isParentOf('/assets', info.targetDirectory.path)) {
        if (
          (await DlgMessageBoxEx.messageBoxEx(
            'Warning',
            `Copying asset files outside the /assets folder may break paths and loading. Do you want to proceed?`,
            ['Cancel', 'Continue'],
            400,
            0,
            true,
            new ImGui.ImVec4(211 / 255, 47 / 255, 47 / 255, 1),
            '⚠️'
          )) === 'Cancel'
        ) {
          return;
        }
      }
      const droppedZabc = await dtVFS.glob('/**/*.zabc', { recursive: true, includeDirs: false });
      const droppedFiles = await dtVFS.glob('/**/*', { recursive: true, includeDirs: false });
      const onlyZabcDrop =
        droppedFiles.length > 0 && droppedFiles.every((entry) => entry.path.toLowerCase().endsWith('.zabc'));
      const rawZabcPaths = await this.filterRawZabcPaths(
        dtVFS,
        droppedZabc.map((entry) => entry.path)
      );
      const zabcDecision =
        rawZabcPaths.length > 0
          ? await this.askZabcImportOptions(dtVFS, rawZabcPaths)
          : ({ action: 'keep', components: 16, compressNormals: false } as ZABCCompressDialogResult);
      if (zabcDecision.action === 'cancel') {
        return;
      }

      const copyDroppedFiles = async () => {
        const dlgProgressBar = new DlgProgress('Copy File##CopyProgress', 300);
        dlgProgressBar.showModal();
        try {
          await dtVFS.copyFileEx('/**/*', info.targetDirectory.path, {
            overwrite: true,
            targetVFS: this._vfs,
            onProgress: (current, total) => {
              dlgProgressBar.setProgress(current, total);
            }
          });
          if (zabcDecision.action === 'compress' && rawZabcPaths.length > 0) {
            const targetFiles = rawZabcPaths.map((sourcePath) =>
              this._vfs.join(info.targetDirectory.path, sourcePath.replace(/^\/+/, ''))
            );
            await this.compressImportedZabcFiles(
              targetFiles,
              zabcDecision.components,
              zabcDecision.compressNormals
            );
          }
        } finally {
          dlgProgressBar.close();
        }
      };

      if (onlyZabcDrop) {
        await copyDroppedFiles();
        return;
      }

      DlgImport.promptImport('Import options', dtVFS, 0, 0).then(async (result) => {
        if (result?.op === 'copy') {
          await copyDroppedFiles();
        } else if (result?.op === 'import') {
          const models: SharedModel[] = [];
          const dlgProgressBar = new DlgProgress('Import File##ImportProgress', 300);
          dlgProgressBar.showModal();
          for (let i = 0; i < result.paths.length; i++) {
            dlgProgressBar.setProgress(i + 1, result.paths.length);
            try {
              const sharedModel = await ResourceService.importModel(dtVFS, result.paths[i]);
              models.push(sharedModel);
              //await sharedModel.savePrefab(getEngine().resourceManager, info.targetDirectory.path);
            } catch (err) {
              console.error(`Load model ${result.paths[i]} failed: ${err}`);
            }
          }
          dlgProgressBar.close();
          if (models.length > 0) {
            const dlgImportOptions = new DlgImportOptions(
              'Import options',
              this._vfs,
              models,
              result.paths,
              300
            );
            const saveOptions = await dlgImportOptions.showModal();
            if (saveOptions) {
              const dlgProgressBar = new DlgProgress('Write File##ImportProgress', 300);
              dlgProgressBar.showModal();
              await this.runWithVFSBatchUpdate(async () => {
                for (let i = 0; i < result.paths.length; i++) {
                  dlgProgressBar.setProgress(i + 1, result.paths.length);
                  try {
                    await ResourceService.savePrefab(
                      models[i],
                      getEngine().resourceManager,
                      PathUtils.basename(result.paths[i], PathUtils.extname(result.paths[i])),
                      info.targetDirectory.path,
                      dtVFS,
                      {
                        ...saveOptions[i],
                        rebuildPrefab: !!result.rebuildPrefab,
                        rebuildMaterial: !!result.rebuildMaterial
                      }
                    );
                  } catch (err) {
                    console.error(`Write model ${result.paths[i]} failed: ${err}`);
                  }
                }
              });
              dlgProgressBar.close();
            }
          }
        }
      });
    }
  }

  emitSelectedChanged() {
    this._selectedDirPath = this.selectedDir ? this._vfs.normalizePath(this.selectedDir.path) : null;
    this.dispatchEvent('selection_changed', this.selectedDir ?? null, this.selectedFiles, [
      ...this.selectedItems
    ]);
  }

  getAssetContext(): RuntimeEditorAssetContext {
    return {
      editor: this._options.editor,
      vfs: this._vfs,
      selectedDir: this.selectedDir,
      selectedFiles: this.selectedFiles,
      selectedItems: [...this.selectedItems]
    };
  }

  renderPluginContextMenu(location: VFSRendererContextMenuLocation, target: unknown) {
    const editor = this._options.editor;
    if (!editor) {
      return;
    }
    const ctx: RuntimeEditorMenuContext = {
      location,
      assets: this.getAssetContext(),
      target
    };
    const items = editor.plugins.getContextMenuItems(location, ctx);
    if (items.length > 0) {
      editor.plugins.renderMenuItems(items, ctx);
      ImGui.Separator();
    }
  }

  private async askZabcImportOptions(srcVFS: VFS, rawZabcPaths: string[]): Promise<ZABCCompressDialogResult> {
    const previewPath = rawZabcPaths[0] ?? '';
    return DlgZABCCompress.prompt(
      rawZabcPaths.length,
      (components, compressNormals) =>
        this.previewZabcCompression(srcVFS, previewPath, components, compressNormals),
      460
    );
  }

  private async compressImportedZabcFiles(files: string[], components: number, compressNormals: boolean) {
    if (!files.length) {
      return;
    }
    const dlgProgressBar = new DlgProgress('Compress ZABC##CompressZABC', 360);
    dlgProgressBar.showModal();
    try {
      for (let i = 0; i < files.length; i++) {
        const path = files[i];
        dlgProgressBar.setProgress(i + 1, files.length);
        await this.compressSingleZabc(path, components, compressNormals);
      }
    } finally {
      dlgProgressBar.close();
    }
  }

  private async filterRawZabcPaths(srcVFS: VFS, paths: string[]) {
    const raw: string[] = [];
    for (const path of paths) {
      try {
        const data = (await srcVFS.readFile(path, { encoding: 'binary' })) as ArrayBuffer;
        if (this.isRawZabcData(data)) {
          raw.push(path);
        }
      } catch {
        raw.push(path);
      }
    }
    return raw;
  }

  private isRawZabcData(arrayBuffer: ArrayBuffer) {
    const manifest = this.tryParseZabcManifest(arrayBuffer);
    if (!manifest) {
      return true;
    }
    const animations = Array.isArray((manifest as any).animations) ? (manifest as any).animations : [];
    for (const animation of animations) {
      const tracks = Array.isArray(animation?.tracks) ? animation.tracks : [];
      for (const track of tracks) {
        const codec = `${track?.codec ?? 'fixed'}`.toLowerCase();
        if (codec !== 'pca') {
          return true;
        }
      }
    }
    return false;
  }

  private tryParseZabcManifest(arrayBuffer: ArrayBuffer): Record<string, unknown> | null {
    try {
      if (arrayBuffer.byteLength >= 12) {
        const magic = new Uint8Array(arrayBuffer, 0, 4);
        if (magic[0] === 0x5a && magic[1] === 0x41 && magic[2] === 0x42 && magic[3] === 0x43) {
          const view = new DataView(arrayBuffer);
          const manifestLength = view.getUint32(8, true);
          const start = 12;
          const end = start + manifestLength;
          const text = new TextDecoder().decode(arrayBuffer.slice(start, end));
          return JSON.parse(text) as Record<string, unknown>;
        }
      }
      const text = new TextDecoder().decode(arrayBuffer);
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  private async compressSingleZabc(path: string, components: number, compressNormals: boolean) {
    const input = (await this._vfs.readFile(path, { encoding: 'binary' })) as ArrayBuffer;
    const worker = new Worker(new URL('../workers/zabc_pca.ts', import.meta.url), { type: 'module' });
    const output = await new Promise<ArrayBuffer>((resolve, reject) => {
      worker.onmessage = (event: MessageEvent<{ type: string; output?: ArrayBuffer; error?: string }>) => {
        const data = event.data;
        if (data?.type === 'success' && data.output) {
          resolve(data.output);
        } else {
          reject(new Error(data?.error || 'ZABC compression failed'));
        }
      };
      worker.onerror = (event) => {
        reject(new Error(event.message || 'ZABC worker failed'));
      };
      worker.postMessage(
        {
          type: 'compress',
          input,
          components,
          compressNormals
        },
        [input]
      );
    }).finally(() => {
      worker.terminate();
    });
    await this._vfs.writeFile(path, output, { encoding: 'binary', create: true });
  }

  private async previewZabcCompression(
    srcVFS: VFS,
    path: string,
    components: number,
    compressNormals: boolean
  ) {
    if (!path) {
      throw new Error('No .zabc file selected for preview');
    }
    const input = (await srcVFS.readFile(path, { encoding: 'binary' })) as ArrayBuffer;
    const worker = new Worker(new URL('../workers/zabc_pca.ts', import.meta.url), { type: 'module' });
    const stats = await new Promise<{
      animationCount: number;
      trackCount: number;
      frameCount: number;
      sourcePayloadBytes: number;
      convertedPayloadBytes: number;
      maxPositionError: number;
      rmsPositionError: number;
    }>((resolve, reject) => {
      worker.onmessage = (
        event: MessageEvent<{
          type: string;
          stats?: {
            animationCount: number;
            trackCount: number;
            frameCount: number;
            sourcePayloadBytes: number;
            convertedPayloadBytes: number;
            maxPositionError: number;
            rmsPositionError: number;
          };
          error?: string;
        }>
      ) => {
        const data = event.data;
        if (data?.type === 'preview' && data.stats) {
          resolve(data.stats);
        } else {
          reject(new Error(data?.error || 'ZABC preview failed'));
        }
      };
      worker.onerror = (event) => {
        reject(new Error(event.message || 'ZABC preview worker failed'));
      };
      worker.postMessage(
        {
          type: 'preview',
          input,
          components,
          compressNormals
        },
        [input]
      );
    }).finally(() => {
      worker.terminate();
    });
    return stats;
  }

  onVFSChanged(
    type: 'created' | 'deleted' | 'moved' | 'modified',
    path: string,
    itemType: 'file' | 'directory'
  ) {
    const rootPath = this._vfs.normalizePath(this._options.rootDir || '/');
    const changedPath = this._vfs.normalizePath(path || '/');
    if (type === 'moved' || changedPath === '/') {
      this._thumbnailService.clear();
    } else if (this._vfs.isParentOf(rootPath, changedPath)) {
      this._thumbnailService.invalidate(changedPath, itemType === 'directory');
    }
    if (
      changedPath !== '/' &&
      !this._vfs.isParentOf(rootPath, changedPath) &&
      !this._vfs.isParentOf(changedPath, rootPath)
    ) {
      return;
    }
    if (this._vfsBatchDepth > 0) {
      this._reloadQueuedPreserveSelection = true;
      this._vfsBatchReloadPending = true;
      return;
    }
    this.queueFileSystemReload(true);
  }
  protected onDispose() {
    super.onDispose();
    if (this._reloadTimer) {
      clearTimeout(this._reloadTimer);
      this._reloadTimer = null;
    }
    this._thumbnailService.dispose();
    this._vfs.off('changed', this.onVFSChanged, this);
    eventBus.off('reveal_asset', this.revealAsset, this);
    if (this._options.allowDrop) {
      eventBus.off('external_dragenter', this.handleDragEvent, this);
      eventBus.off('external_dragover', this.handleDragEvent, this);
      eventBus.off('external_dragleave', this.handleDragEvent, this);
      eventBus.off('external_drop', this.handleDragEvent, this);
    }
  }
  acceptFileMoveOrCopy(path: string) {
    if (ImGui.BeginDragDropTarget()) {
      const payload = ImGui.AcceptDragDropPayload('ASSET')?.Data as unknown;
      if (payload) {
        this.handleAssetDrop(path, payload);
      }
      ImGui.EndDragDropTarget();
    }
  }
  handleAssetDrop(targetPath: string, payload: unknown) {
    const data = payload as { isDir: boolean; path: string }[] | VFSRendererAssetPickerPayload;
    if (Array.isArray(data)) {
      void this.handleFileMoveOrCopy(targetPath, data);
    } else if (
      data &&
      typeof data === 'object' &&
      (data as VFSRendererAssetPickerPayload).type === 'asset-picker'
    ) {
      const path = this.normalizeAssetPickerTargetPath(targetPath);
      if (path && this.isAssetPickerPathAccepted(data as VFSRendererAssetPickerPayload, path)) {
        this.dispatchEvent('asset_picker_drop', data as VFSRendererAssetPickerPayload, path);
      }
    }
  }
  private isAssetPickerPathAccepted(payload: VFSRendererAssetPickerPayload, path: string) {
    const mimeTypes = payload.prop?.options?.mimeTypes;
    if (!mimeTypes?.length) {
      return true;
    }
    const mimeType = this._vfs.guessMIMEType(path);
    return matchesMimeType(mimeTypes, mimeType);
  }
  private normalizeAssetPickerTargetPath(path: string) {
    const normalized = this._vfs.normalizePath(path);
    const file = this.findFileByPath(this._filesystem, normalized);
    return file ? normalized : null;
  }
  private findFileByPath(root: Nullable<DirectoryInfo>, path: string): Nullable<FileInfo> {
    if (!root) {
      return null;
    }
    const normalizedPath = this._vfs.normalizePath(path);
    const file = root.files.find((item) => this._vfs.normalizePath(item.meta.path) === normalizedPath);
    if (file) {
      return file;
    }
    for (const subDir of root.subDir) {
      const found = this.findFileByPath(subDir, normalizedPath);
      if (found) {
        return found;
      }
    }
    return null;
  }
  async copyFile(src: string, dst: string, overwriteMode: 'overwrite' | 'prompt' | 'cancel') {
    src = this.VFS.normalizePath(src);
    dst = this.VFS.normalizePath(dst);
    if (src === dst) {
      console.error(`Invalid destination file name: ${dst}`);
      return;
    }
    if (!(await this.VFS.exists(src))) {
      console.error(`Source file not exists: ${src}`);
      return;
    }
    if (!(await this.VFS.stat(src)).isFile) {
      console.error(`Source is not a file: ${src}`);
      return;
    }
    if (await this.VFS.exists(dst)) {
      if ((await this.VFS.stat(dst)).isDirectory) {
        console.error(`Destination is a directory: ${dst}`);
        return;
      }
      if (overwriteMode === 'cancel') {
        return;
      } else if (overwriteMode === 'prompt') {
        if (
          (await DlgMessageBoxEx.messageBoxEx(
            'Copy file',
            `${dst} already exists, do you want to overwrite it?`,
            ['Yes', 'No']
          )) === 'No'
        ) {
          return;
        }
      }
    }
    await this.VFS.copyFile(src, dst, { overwrite: true });
  }
  async handleFileMoveOrCopy(targetDir: string, payload: { isDir: boolean; path: string }[]) {
    const copy = ImGui.GetIO().KeyCtrl;
    const dlg = copy ? new DlgProgress('CopyFile##CopyProgress', 300, true) : null;
    const movedRules: PathRewriteRule[] = [];
    if (dlg) {
      dlg.showModal();
      dlg.setProgress(0, payload.length);
    }
    for (let i = 0; i < payload.length; i++) {
      const asset = payload[i];
      const vfs = this.VFS;
      const sourceDir = asset.path;
      const parentDir = vfs.dirname(sourceDir);
      if (vfs.isParentOf(parentDir, targetDir) && vfs.isParentOf(targetDir, parentDir)) {
        // no-op
      } else if (!asset.isDir) {
        const targetPath = vfs.join(targetDir, vfs.basename(sourceDir));
        if (copy) {
          await vfs.copyFile(sourceDir, targetPath, {
            overwrite: true
          });
        } else {
          await vfs.move(sourceDir, targetPath, {
            overwrite: true
          });
          movedRules.push({
            oldPath: sourceDir,
            newPath: targetPath,
            isDirectory: false
          });
        }
      } else {
        if (vfs.isParentOf(sourceDir, targetDir)) {
          console.error(`Cannot ${copy ? 'copy' : 'move'} parent directory to child directory`);
        } else {
          const dest = vfs.join(targetDir, vfs.basename(sourceDir));
          if (copy) {
            await vfs.copyFileEx(vfs.join(sourceDir, '/**/*'), dest, {
              overwrite: true,
              onProgress: (current, total) => {
                if (dlg) {
                  dlg.setSubProgress(current, total);
                }
              }
            });
          } else {
            await vfs.move(sourceDir, dest);
            movedRules.push({
              oldPath: sourceDir,
              newPath: dest,
              isDirectory: true
            });
          }
        }
      }
      if (dlg) {
        dlg.setProgress(i + 1, payload.length);
      }
    }
    if (!copy && movedRules.length > 0) {
      try {
        await this.rewriteAssetReferencesAfterMove(movedRules);
      } catch (err) {
        console.warn(`Rewrite references after move failed: ${err}`);
      }
    }
    if (dlg) {
      dlg.close();
    }
  }

  private async rewriteAssetReferencesAfterMove(rules: PathRewriteRule[]) {
    const deduplicated = this.prepareRewriteRules(rules);
    if (deduplicated.length === 0) {
      return;
    }
    const rootDir = this._options.rootDir || '/assets';
    const entries = await this._vfs.readDirectory(rootDir, {
      includeHidden: true,
      recursive: true
    });
    const targetFiles = entries.filter(
      (entry) =>
        entry.type === 'file' &&
        (entry.path.toLowerCase().endsWith('.zscn') ||
          entry.path.toLowerCase().endsWith('.prefab') ||
          entry.path.toLowerCase().endsWith('.zprefab') ||
          entry.path.toLowerCase().endsWith('.zmtl'))
    );
    for (const file of targetFiles) {
      try {
        const text = (await this._vfs.readFile(file.path, { encoding: 'utf8' })) as string;
        const json = JSON.parse(text);
        if (this.rewriteJsonPathValues(json, deduplicated)) {
          await this._vfs.writeFile(file.path, JSON.stringify(json, null, 2), {
            encoding: 'utf8',
            create: true
          });
        }
      } catch (err) {
        console.warn(`Skip reference rewrite for ${file.path}: ${err}`);
      }
    }
  }

  private prepareRewriteRules(rules: PathRewriteRule[]): PathRewriteRule[] {
    const map = new Map<string, PathRewriteRule>();
    for (const rule of rules) {
      const oldPath = this._vfs.normalizePath(rule.oldPath);
      const newPath = this._vfs.normalizePath(rule.newPath);
      if (!oldPath || !newPath || oldPath === newPath) {
        continue;
      }
      map.set(oldPath, {
        oldPath,
        newPath,
        isDirectory: rule.isDirectory
      });
    }
    return [...map.values()].sort((a, b) => b.oldPath.length - a.oldPath.length);
  }

  private rewriteJsonPathValues(node: unknown, rules: PathRewriteRule[]): boolean {
    let changed = false;
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        const value = node[i];
        if (typeof value === 'string') {
          const rewritten = this.rewritePathString(value, rules);
          if (rewritten !== value) {
            node[i] = rewritten;
            changed = true;
          }
        } else if (value && typeof value === 'object') {
          changed = this.rewriteJsonPathValues(value, rules) || changed;
        }
      }
      return changed;
    }
    if (!node || typeof node !== 'object') {
      return false;
    }
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (typeof value === 'string') {
        const rewritten = this.rewritePathString(value, rules);
        if (rewritten !== value) {
          (node as Record<string, unknown>)[key] = rewritten;
          changed = true;
        }
      } else if (value && typeof value === 'object') {
        changed = this.rewriteJsonPathValues(value, rules) || changed;
      }
    }
    return changed;
  }

  private rewritePathString(value: string, rules: PathRewriteRule[]): string {
    for (const rule of rules) {
      if (rule.isDirectory) {
        if (value === rule.oldPath) {
          return rule.newPath;
        }
        if (value.startsWith(`${rule.oldPath}/`)) {
          return `${rule.newPath}${value.slice(rule.oldPath.length)}`;
        }
      } else if (value === rule.oldPath) {
        return rule.newPath;
      }
    }
    return value;
  }
}
