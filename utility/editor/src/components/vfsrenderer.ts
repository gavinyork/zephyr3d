import type { FileMetadata, VFS } from '@zephyr3d/base';
import UPNG from 'upng-js';
import { DataTransferVFS, Disposable, makeObservable, PathUtils } from '@zephyr3d/base';
import { DockPannel, ResizeDirection } from './dockpanel';
import { ImGui, imGuiCalcTextSize } from '@zephyr3d/imgui';
import { convertEmojiString } from '../helpers/emoji';
import { ProjectService } from '../core/services/project';
import { eventBus } from '../core/eventbus';
import { DlgPromptName } from '../views/dlg/promptnamedlg';
import { DlgMessage } from '../views/dlg/messagedlg';
import { DlgProgress } from '../views/dlg/progressdlg';
import { DlgMessageBoxEx } from '../views/dlg/messageexdlg';
import { templateScript } from '../core/build/templates';
import { installDeps, reinstallPackages } from '../core/build/dep';
import { DlgRampTextureCreator } from '../views/dlg/ramptexturedlg';
import { TreeViewData, TreeView } from './treeview';
import { DlgImport } from '../views/dlg/importdlg';
import { ListView, ListViewData } from './listview';
import { ResourceService } from '../core/services/resource';

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
};

class VFSDirData extends TreeViewData<DirectoryInfo> {
  private _renderer: VFSRenderer;
  private _projectName: string;
  constructor(renderer: VFSRenderer, projectName: string) {
    super();
    this._renderer = renderer;
    this._projectName = projectName;
  }
  getRoot(): DirectoryInfo {
    return this._renderer.root;
  }
  getChildren(parent: DirectoryInfo): DirectoryInfo[] {
    return parent?.subDir ?? [];
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
    return convertEmojiString(`${emoji}${node === this._renderer.root ? this._projectName : name}##${id}`);
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
    return this.renderer.currentDirContent;
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
      return isDir ? '' : (item.meta.mimeType ?? 'File');
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
          const typeA = (a as FileInfo).meta.mimeType || '';
          const typeB = (b as FileInfo).meta.mimeType || '';
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
    return null;
  }
}

export class ContentListView extends ListView<{}, FileInfo | DirectoryInfo> {
  constructor(data: VFSContentData) {
    super('##VFSContentListView', data);
  }
  get renderer() {
    return (this._data as VFSContentData).renderer;
  }
  protected postRenderItem(item: FileInfo | DirectoryInfo): void {
    super.postRenderItem(item);
    if ('subDir' in item && !this.renderer.VFS.readOnly) {
      this.renderer.acceptFileMoveOrCopy(item.path);
    }
  }
  protected onContentContextMenu(): void {
    if (!this.renderer.VFS.readOnly) {
      if (ImGui.BeginMenu('Create New')) {
        if (ImGui.MenuItem('Folder...')) {
          this.renderer.createNewFolder();
        }
        if (this.renderer.VFS.isParentOf('/assets', this.renderer.selectedDir.path)) {
          ImGui.Separator();
          if (ImGui.MenuItem('Scene...')) {
            this.renderer.createNewFile('Create Scene', 'Scene Name', (path) => {
              if (!path.toLowerCase().endsWith('.zscn')) {
                path = `${path}.zscn`;
              }
              eventBus.dispatchEvent('action', 'NEW_DOC', path);
            });
          }
          ImGui.Separator();
          if (ImGui.MenuItem('Material...')) {
            this.renderer.createNewFile('Create Material', 'Material Name', (path) => {
              if (!path.toLowerCase().endsWith('.zmtl')) {
                path = `${path}.zmtl`;
              }
              const name = path.slice(0, -5);
              eventBus.dispatchEvent('edit_material', name, name, path);
            });
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
              DlgPromptName.promptName('Create Material Instance', '', 'Material Instance Name').then(
                (name) => {
                  name = name.trim();
                  if (name) {
                    if (PathUtils.sanitizeFilename(name) !== name) {
                      DlgMessage.messageBox('Error', 'Invalid file name');
                    } else {
                      if (!name.endsWith('.zmtl')) {
                        name = `${name}.zmtl`;
                      }
                      const path = this.renderer.VFS.join(this.renderer.VFS.dirname(item.meta.path), name);
                      this.renderer.copyFile(item.meta.path, path, 'prompt');
                    }
                  }
                }
              );
            }
          }
          ImGui.Separator();
          if (ImGui.MenuItem('Edit as text')) {
            eventBus.dispatchEvent('action', 'EDIT_CODE', item.meta.path, mimeType);
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
    }
  }
  protected onSelectionChanged(): void {
    this.renderer.emitSelectedChanged();
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
  constructor(renderer: VFSRenderer, projectName: string) {
    super('###VFSNavigator', new VFSDirData(renderer, projectName));
    this._renderer = renderer;
  }
  protected onGetContextMenuId(node: DirectoryInfo): string {
    return this._renderer.VFS.readOnly ? '' : `vfs_${node.path}`;
  }
  protected onNodeDeselected(): void {
    this._renderer.refreshFileView();
  }
  protected onNodeSelected(): void {
    this._renderer.refreshFileView();
  }
  protected onDrawContextMenu(dir: DirectoryInfo) {
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
      ImGui.EndMenu();
    }
    if (dir !== this._renderer.root && dir.path !== '/assets' && dir.path !== '/src') {
      if (ImGui.MenuItem('Delete##VFSDeleteFolder')) {
        this._renderer.VFS.deleteDirectory(dir.path, true)
          .then(() => {
            if (dir === this.selectedNode) {
              this.selectNode(null);
            }
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
    this._renderer.handleFileMoveOrCopy(node.path, payload as { isDir: boolean; path: string }[]);
  }
}

export class VFSRenderer extends makeObservable(Disposable)<{
  selection_changed: [selectedDir: DirectoryInfo, selectedFiles: FileInfo[]];
  file_dbl_clicked: [file: FileInfo];
}>() {
  private static readonly baseFlags =
    ImGui.TreeNodeFlags.SpanAvailWidth |
    ImGui.TreeNodeFlags.SpanFullWidth |
    ImGui.TreeNodeFlags.OpenOnArrow |
    ImGui.TreeNodeFlags.OpenOnDoubleClick;
  private readonly _vfs: VFS;
  private readonly _treePanel: DockPannel;
  private _nav: DirTreeView;
  private _contentView: ContentListView;
  private _filesystem: DirectoryInfo;
  private _fileFilter: string[];
  private _currentDirContent: (FileInfo | DirectoryInfo)[] = [];
  private _navigationBounds: AreaBounds | null = null;
  private _contentBounds: AreaBounds | null = null;
  private _isDragOverNavigation = false;
  private _isDragOverContent = false;
  private readonly _options: VFSRendererOptions = null;

  constructor(vfs: VFS, fileFilter: string[] = [], treePanelWidth = 200, options?: VFSRendererOptions) {
    super();
    this._vfs = vfs;
    this._vfs.on('changed', this.onVFSChanged, this);
    this._treePanel = new DockPannel(0, 0, treePanelWidth, -1, 8, 200, 500, ResizeDirection.Right, 0, 99999);
    this._filesystem = null;
    this._fileFilter = fileFilter?.slice() ?? [];
    this._options = {
      rootDir: '/assets',
      allowDrop: true,
      allowDblClickOpen: true,
      multiSelect: true,
      ...options
    };
    this._nav = new DirTreeView(this, this._options.rootDir);
    this._contentView = new ContentListView(new VFSContentData(this));
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
  get currentDirContent() {
    return this._currentDirContent;
  }
  render() {
    if (ImGui.BeginChild('##VFSViewContainer', new ImGui.ImVec2(-1, -1), false, ImGui.WindowFlags.None)) {
      const pos = ImGui.GetCursorPos();
      if (this._treePanel.beginChild('##VFSViewTree')) {
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
          this._nav.render(false);
          //this.renderDir(this._filesystem);
        }
      }
      this._treePanel.endChild();

      ImGui.SetCursorPos(new ImGui.ImVec2(this._treePanel.width + 8, pos.y));
      if (ImGui.BeginChild('##VFSViewContent', new ImGui.ImVec2(-1, -1), false, ImGui.WindowFlags.None)) {
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
      '##VFSContentToolBar',
      new ImGui.ImVec2(-1, ImGui.GetFrameHeight() + ImGui.GetStyle().ItemSpacing.y),
      false
    );
    this.renderToolbar();
    ImGui.EndChild();

    ImGui.BeginChild('##VFSContentContainer', new ImGui.ImVec2(-1, -1), true);
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

    ImGui.BeginChild('##VFSContentInnerContainer', new ImGui.ImVec2(-1, -1), false);
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
    if (!this._vfs.readOnly) {
      ImGui.SameLine();
      if (ImGui.Button(convertEmojiString('📦##ImportPackage'))) {
        DlgPromptName.promptName('Install Package', 'package', 'packageName@x.y.z').then((val) => {
          if (val) {
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
              [val],
              (msg) => (dlgMessageBoxEx.text = msg)
            ).then(() => {
              console.info('Dependencies installed');
              dlgMessageBoxEx.buttons[0] = 'Ok';
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
        eventBus.dispatchEvent('action', 'OPEN_DOC', file.meta.path);
      } else if (file.meta.path.toLowerCase().endsWith('.zmtl')) {
        const name = this._vfs.basename(file.meta.path).slice(0, -5);
        eventBus.dispatchEvent('edit_material', name, name, file.meta.path);
      } else if (file.meta.path.toLowerCase().endsWith('.zmf')) {
        eventBus.dispatchEvent('edit_material_function', file.meta.path);
      } else {
        const mimeType = this._vfs.guessMIMEType(file.meta.path);
        eventBus.dispatchEvent('action', 'EDIT_CODE', file.meta.path, mimeType);
      }
    }
    this.dispatchEvent('file_dbl_clicked', file);
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
    if (!meta?.mimeType) {
      return '📄';
    }

    const mimeType = meta.mimeType.toLowerCase();
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

  deleteSelectedItems() {
    if (this.selectedItems.size === 0) {
      return;
    }

    const items = Array.from(this.selectedItems);
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
        this._contentView.deselectAll();
        this.emitSelectedChanged();
      })
      .catch((err) => {
        DlgMessage.messageBox('Error', `Delete failed: ${err}`);
      });
  }

  renameItem(item: DirectoryInfo | FileInfo) {
    const isDir = 'subDir' in item;
    const currentName = isDir
      ? item.path.slice(item.path.lastIndexOf('/') + 1)
      : (item as FileInfo).meta.name;
    DlgPromptName.promptName('Rename', 'Name', currentName).then((newName) => {
      newName = newName.trim();
      if (newName && newName !== currentName) {
        if (PathUtils.sanitizeFilename(newName) !== newName) {
          DlgMessage.messageBox('Error', 'Invalid name');
        } else {
          const parentPath = isDir
            ? item.path.slice(0, item.path.lastIndexOf('/'))
            : (item as FileInfo).meta.path.slice(0, (item as FileInfo).meta.path.lastIndexOf('/'));
          const newPath = this._vfs.join(parentPath, newName);
          this._vfs.move(isDir ? item.path : item.meta.path, newPath);
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

  refreshFileView() {
    if (!this.selectedDir) {
      this._currentDirContent = [];
      return;
    }

    this._currentDirContent = [...this.selectedDir.subDir, ...this.selectedDir.files];
    this.sortContent();
    this._contentView.deselectAll();
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
    if (dir.subDir.length === 0) {
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
                if (dir === this.selectedDir) {
                  this._nav.selectNode(null);
                }
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
    const rootDir = await this.loadDirectoryInfo(this._options.rootDir);
    this._filesystem = rootDir;

    if (this.selectedDir) {
      const newSelectedDir = this.findDirectoryByPath(this._filesystem, this.selectedDir.path);
      this._nav.selectNode(newSelectedDir ?? null);
    } else {
      this._nav.selectNode(this._filesystem);
    }
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

  private isParentOf(parent: DirectoryInfo, child: DirectoryInfo) {
    while (child.parent) {
      if (parent.path === child.parent.path) {
        return true;
      }
      child = child.parent;
    }
    return false;
  }
  async loadDirectoryInfo(path: string): Promise<DirectoryInfo> {
    if (!this._vfs) {
      return null;
    }

    const dirExists = await this._vfs.exists(path);
    if (!dirExists) {
      return null;
    }

    const stats = await this._vfs.stat(path);
    if (!stats) {
      return null;
    }

    const info: DirectoryInfo = {
      files: [],
      subDir: [],
      parent: null,
      open: false,
      path
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
        const dirInfo = await this.loadDirectoryInfo(entry.path);
        if (dirInfo) {
          info.subDir.push(dirInfo);
          dirInfo.parent = info;
        }
      } else if (entry.type === 'file') {
        info.files.push({
          meta: entry,
          parent: info
        });
      }
    }

    return info;
  }

  async handleDragEvent(ev: DragEvent) {
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
      DlgImport.promptImport('Import options', dtVFS, 0, 0).then(async (result) => {
        if (result?.op === 'copy') {
          const dlgProgressBar = new DlgProgress('Copy File##CopyProgress', 300);
          dlgProgressBar.showModal();
          await dtVFS.copyFileEx('/**/*', info.targetDirectory.path, {
            overwrite: true,
            targetVFS: this._vfs,
            onProgress: (current, total) => {
              dlgProgressBar.setProgress(current, total);
            }
          });
          dlgProgressBar.close();
        } else if (result?.op === 'import') {
          const dlgProgressBar = new DlgProgress('Import File##ImportProgress', 300);
          dlgProgressBar.showModal();
          for (let i = 0; i < result.paths.length; i++) {
            dlgProgressBar.setProgress(i + 1, result.paths.length);
            try {
              const sharedModel = await ResourceService.importModel(dtVFS, result.paths[i]);
              await sharedModel.savePrefab(ProjectService.serializationManager, info.targetDirectory.path);
            } catch (err) {
              console.error(`Load model ${result.paths[i]} failed: ${err}`);
            }
          }
          dlgProgressBar.close();
        }
      });
    }
  }

  emitSelectedChanged() {
    this.dispatchEvent('selection_changed', this.selectedDir ?? null, this.selectedFiles);
  }

  onVFSChanged(type: 'created' | 'deleted' | 'moved' | 'modified') {
    if (type !== 'modified') {
      this.loadFileSystem().then(() => {
        this.refreshFileView();
      });
    }
  }
  protected onDispose() {
    super.onDispose();
    this._vfs.off('changed', this.onVFSChanged, this);
    if (this._options.allowDrop) {
      eventBus.off('external_dragenter', this.handleDragEvent, this);
      eventBus.off('external_dragover', this.handleDragEvent, this);
      eventBus.off('external_dragleave', this.handleDragEvent, this);
      eventBus.off('external_drop', this.handleDragEvent, this);
    }
  }
  acceptFileMoveOrCopy(path: string) {
    if (ImGui.BeginDragDropTarget()) {
      const payload = ImGui.AcceptDragDropPayload('ASSET')?.Data as { isDir: boolean; path: string }[];
      if (payload) {
        this.handleFileMoveOrCopy(path, payload);
      }
      ImGui.EndDragDropTarget();
    }
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
          }
        }
      }
      if (dlg) {
        dlg.setProgress(i + 1, payload.length);
      }
    }
    if (dlg) {
      dlg.close();
    }
  }
}
