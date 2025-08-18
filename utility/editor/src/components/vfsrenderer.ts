import type { FileMetadata, VFS } from '@zephyr3d/base';
import { DataTransferVFS, Observable } from '@zephyr3d/base';
import { DockPannel, ResizeDirection } from './dockpanel';
import { ImGui, imGuiCalcTextSize } from '@zephyr3d/imgui';
import { convertEmojiString } from '../helpers/emoji';
import { ProjectService, type ProjectInfo } from '../core/services/project';
import { enableWorkspaceDragging } from './dragdrop';
import { eventBus } from '../core/eventbus';
import { DlgPromptName } from '../views/dlg/promptnamedlg';
import { DlgMessage } from '../views/dlg/messagedlg';
import { DlgProgress } from '../views/dlg/progressdlg';
import { DlgMessageBoxEx } from '../views/dlg/messageexdlg';
import { templateScript } from '../core/build/templates';

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

enum ViewMode {
  List = 0,
  Grid = 1,
  Details = 2
}

enum SortBy {
  Name = 0,
  Size = 1,
  Type = 2,
  Modified = 3
}

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
  allowDrop?: boolean;
  multiSelect?: boolean;
};

export class VFSRenderer extends Observable<{
  selection_changed: [selectedDir: DirectoryInfo, selectedFiles: FileInfo[]];
}> {
  private static readonly baseFlags =
    ImGui.TreeNodeFlags.SpanAvailWidth |
    ImGui.TreeNodeFlags.SpanFullWidth |
    ImGui.TreeNodeFlags.OpenOnArrow |
    ImGui.TreeNodeFlags.OpenOnDoubleClick;
  private readonly _vfs: VFS;
  private readonly _project: ProjectInfo;
  private readonly _treePanel: DockPannel;
  private _filesystem: DirectoryInfo;
  private _selectedDir: DirectoryInfo;
  private _fileFilter: string[];
  private _currentDirContent: (FileInfo | DirectoryInfo)[] = [];
  private _viewMode: ViewMode = ViewMode.List;
  private _sortBy: SortBy = SortBy.Name;
  private _sortAscending: boolean = true;
  private readonly _selectedItems: Set<FileInfo | DirectoryInfo> = new Set();
  private _gridItemSize: number = 80;
  private _hoveredItem: FileInfo | DirectoryInfo | null = null;
  private _navigationBounds: AreaBounds | null = null;
  private _contentBounds: AreaBounds | null = null;
  private _isDragOverNavigation = false;
  private _isDragOverContent = false;
  private readonly _options: VFSRendererOptions = null;

  constructor(
    vfs: VFS,
    project: ProjectInfo,
    fileFilter: string[] = [],
    treePanelWidth = 200,
    options?: VFSRendererOptions
  ) {
    super();
    this._vfs = vfs;
    this._vfs.on('changed', this.onVFSChanged, this);
    this._project = project;
    this._treePanel = new DockPannel(0, 0, treePanelWidth, -1, 8, 200, 500, ResizeDirection.Right, 0, 99999);
    this._filesystem = null;
    this._selectedDir = null;
    this._fileFilter = fileFilter?.slice() ?? [];
    this._options = { allowDrop: true, multiSelect: true, ...options };
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
    return this._selectedDir ?? null;
  }
  get selectedFiles() {
    return [...this._selectedItems].filter((item) => 'meta' in item);
  }
  get selectedItems() {
    return this._selectedItems;
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
          this.renderDir(this._filesystem);
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
    this._hoveredItem = null;
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

    if (this._selectedDir) {
      switch (this._viewMode) {
        case ViewMode.List:
          this.renderListView();
          break;
        case ViewMode.Grid:
          this.renderGridView();
          break;
        case ViewMode.Details:
          this.renderDetailsView();
          break;
      }
    } else {
      const windowSize = ImGui.GetWindowSize();
      const textSize = imGuiCalcTextSize('Select a folder to view its contents');
      ImGui.SetCursorPos(
        new ImGui.ImVec2((windowSize.x - textSize.x) * 0.5, (windowSize.y - textSize.y) * 0.5)
      );
      ImGui.TextDisabled('Select a folder to view its contents');
    }

    this.handleContextMenu();
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
      return this._selectedDir;
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

  private showItemProperties(item: FileInfo | DirectoryInfo) {
    const isDir = 'subDir' in item;
    const name = isDir ? item.path.slice(item.path.lastIndexOf('/') + 1) : (item as FileInfo).meta.name;
    let info = `Name: ${name}\n`;
    info += `Type: ${isDir ? 'Folder' : 'File'}\n`;
    if (!isDir) {
      const meta = (item as FileInfo).meta;
      info += `Size: ${this.formatFileSize(meta.size)}\n`;
      if (meta.mimeType) {
        info += `MIME Type: ${meta.mimeType}\n`;
      }
      if (meta.modified) {
        info += `Modified: ${this.formatDate(meta.modified)}\n`;
      }
    }

    info += `Path: ${isDir ? item.path : (item as FileInfo).meta.path}`;
    DlgMessage.messageBox('Properties', info);
  }

  private renderToolbar() {
    const canGoUp = this._selectedDir && this._selectedDir.parent;
    if (canGoUp) {
      if (ImGui.Button('⬆##DirUP')) {
        this._selectedDir.parent.open = true;
        this.selectDir(this._selectedDir.parent);
      }
    } else {
      ImGui.PushStyleVar(ImGui.StyleVar.Alpha, 0.5);
      ImGui.Button('⬆##DirUP');
      ImGui.PopStyleVar();
      if (ImGui.IsItemHovered()) {
        ImGui.SetTooltip('Already at root directory');
      }
    }
    ImGui.SameLine();
    ImGui.Separator();
    ImGui.SameLine();

    if (ImGui.RadioButton('List', this._viewMode === ViewMode.List)) {
      this._viewMode = ViewMode.List;
    }
    ImGui.SameLine();

    if (ImGui.RadioButton('Grid', this._viewMode === ViewMode.Grid)) {
      this._viewMode = ViewMode.Grid;
    }
    ImGui.SameLine();

    if (ImGui.RadioButton('Details', this._viewMode === ViewMode.Details)) {
      this._viewMode = ViewMode.Details;
    }

    ImGui.SameLine();
    ImGui.Dummy(new ImGui.ImVec2(20, 0));
    ImGui.SameLine();

    ImGui.Text('Sort by:');
    ImGui.SameLine();
    ImGui.SetNextItemWidth(100);

    const sortItems = ['Name', 'Size', 'Type', 'Modified'];
    const currentSort = this._sortBy;
    if (ImGui.Combo('##SortBy', [currentSort], sortItems)) {
      this._sortBy = currentSort;
      this.sortContent();
    }

    ImGui.SameLine();
    if (ImGui.Button(this._sortAscending ? '↑' : '↓')) {
      this._sortAscending = !this._sortAscending;
      this.sortContent();
    }

    ImGui.SameLine();
    ImGui.Dummy(new ImGui.ImVec2(20, 0));
    ImGui.SameLine();

    if (this._viewMode === ViewMode.Grid) {
      ImGui.SameLine();
      ImGui.Text('Size:');
      ImGui.SameLine();
      ImGui.SetNextItemWidth(100);
      const size = [this._gridItemSize] as [number];
      if (ImGui.SliderInt('##GridSize', size, 40, 120)) {
        this._gridItemSize = size[0];
      }
    }
  }

  private renderListView() {
    for (let i = 0; i < this._currentDirContent.length; i++) {
      const item = this._currentDirContent[i];
      this.renderListItem(item, i);
    }
  }

  private renderGridView() {
    const windowWidth = ImGui.GetWindowContentRegionMax().x - ImGui.GetWindowContentRegionMin().x;
    const itemsPerRow = Math.max(1, Math.floor(windowWidth / (this._gridItemSize + 10)));

    for (let i = 0; i < this._currentDirContent.length; i++) {
      const item = this._currentDirContent[i];

      if (i % itemsPerRow !== 0) {
        ImGui.SameLine();
      }

      this.renderGridItem(item, i);
    }
  }

  private renderDetailsView() {
    if (
      ImGui.BeginTable(
        '##FileTable',
        4,
        ImGui.TableFlags.Resizable |
          ImGui.TableFlags.Sortable |
          ImGui.TableFlags.BordersInnerV |
          ImGui.TableFlags.RowBg
      )
    ) {
      ImGui.TableSetupColumn('Name', ImGui.TableColumnFlags.DefaultSort);
      ImGui.TableSetupColumn('Size');
      ImGui.TableSetupColumn('Type');
      ImGui.TableSetupColumn('Modified');
      ImGui.TableHeadersRow();

      const sortSpecs = ImGui.TableGetSortSpecs();
      if (sortSpecs && sortSpecs.SpecsDirty) {
        this.handleTableSort(sortSpecs);
        sortSpecs.SpecsDirty = false;
      }

      for (let i = 0; i < this._currentDirContent.length; i++) {
        const item = this._currentDirContent[i];
        this.renderTableRow(item, i);
      }

      ImGui.EndTable();
    }
  }

  private renderListItem(item: FileInfo | DirectoryInfo, index: number) {
    const isDir = 'subDir' in item;
    const name = isDir ? item.path.slice(item.path.lastIndexOf('/') + 1) : (item as FileInfo).meta.name;

    const emoji = isDir ? '📁' : this.getFileEmoji((item as FileInfo).meta);
    const label = convertEmojiString(`${emoji} ${name}##item_${index}`);

    const isSelected = this._selectedItems.has(item);
    const keyCtrl = ImGui.GetIO().KeyCtrl;

    if (ImGui.Selectable(label, isSelected, ImGui.SelectableFlags.AllowDoubleClick)) {
      if (isSelected && !keyCtrl) {
        this.handleItemClick(item);
      }
    }
    if (ImGui.IsItemHovered()) {
      this._hoveredItem = item;
    }
    if (ImGui.IsItemClicked(ImGui.MouseButton.Left) && (keyCtrl || !this._selectedItems.has(item))) {
      this.handleItemClick(item);
    }
    if (ImGui.IsItemHovered() && ImGui.IsMouseDoubleClicked(ImGui.MouseButton.Left)) {
      this.handleItemDoubleClick(item);
    }
    if (isDir) {
      this.acceptFileMoveOrCopy(item.path);
    }
    if (this._selectedItems.size > 0) {
      enableWorkspaceDragging(
        item,
        'ASSET',
        () =>
          [...this.selectedItems].map((item) => {
            return {
              isDir: 'subDir' in item,
              path: 'subDir' in item ? item.path : item.meta.path
            };
          }),
        () => {
          const ctrlDown = ImGui.GetIO().KeyCtrl;
          let icon = isDir ? '📁' : this.getFileEmoji(item.meta);
          if (ctrlDown) {
            icon += '+';
          }
          ImGui.Text(convertEmojiString(icon));
        }
      );
    }
  }

  private renderGridItem(item: FileInfo | DirectoryInfo, index: number) {
    const isDir = 'subDir' in item;
    const name = isDir ? item.path.slice(item.path.lastIndexOf('/') + 1) : (item as FileInfo).meta.name;

    const emoji = isDir ? '📁' : this.getFileEmoji((item as FileInfo).meta);
    const isSelected = this._selectedItems.has(item);
    const keyCtrl = ImGui.GetIO().KeyCtrl;

    ImGui.BeginGroup();

    const iconSize = this._gridItemSize;
    if (
      ImGui.Selectable(
        `##icon_${index}`,
        isSelected,
        ImGui.SelectableFlags.AllowDoubleClick,
        new ImGui.ImVec2(iconSize, iconSize)
      )
    ) {
      if (isSelected && !keyCtrl) {
        this.handleItemClick(item);
      }
    }
    if (ImGui.IsItemHovered()) {
      this._hoveredItem = item;
    }
    if (ImGui.IsItemClicked(ImGui.MouseButton.Left) && (keyCtrl || !this._selectedItems.has(item))) {
      this.handleItemClick(item);
    }
    if (ImGui.IsItemHovered() && ImGui.IsMouseDoubleClicked(ImGui.MouseButton.Left)) {
      this.handleItemDoubleClick(item);
    }
    if (isDir) {
      this.acceptFileMoveOrCopy(item.path);
    }
    if (this._selectedItems.size > 0) {
      enableWorkspaceDragging(
        item,
        'ASSET',
        () =>
          [...this.selectedItems].map((item) => {
            return {
              isDir: 'subDir' in item,
              path: 'subDir' in item ? item.path : item.meta.path
            };
          }),
        () => {
          const ctrlDown = ImGui.GetIO().KeyCtrl;
          let icon = isDir ? '📁' : this.getFileEmoji(item.meta);
          if (ctrlDown) {
            icon += '+';
          }
          ImGui.Text(convertEmojiString(icon));
        }
      );
    }

    const drawList = ImGui.GetWindowDrawList();
    const pos = ImGui.GetItemRectMin();
    const emojiSize = ImGui.CalcTextSize(convertEmojiString(emoji));
    const emojiPos = new ImGui.ImVec2(
      pos.x + (iconSize - emojiSize.x) * 0.5,
      pos.y + (iconSize - emojiSize.y) * 0.5
    );
    drawList.AddText(emojiPos, ImGui.GetColorU32(ImGui.Col.Text), convertEmojiString(emoji));

    ImGui.PushTextWrapPos(ImGui.GetCursorPosX() + iconSize);
    ImGui.TextWrapped(name);
    ImGui.PopTextWrapPos();

    ImGui.EndGroup();
  }

  private renderTableRow(item: FileInfo | DirectoryInfo, index: number) {
    const isDir = 'subDir' in item;
    const meta = isDir ? null : (item as FileInfo).meta;
    const name = isDir ? item.path.slice(item.path.lastIndexOf('/') + 1) : meta.name;

    ImGui.TableNextRow();
    ImGui.TableSetColumnIndex(0);
    const emoji = isDir ? '📁' : this.getFileEmoji(meta);
    const label = convertEmojiString(`${emoji} ${name}##row_${index}`);
    const isSelected = this._selectedItems.has(item);
    const keyCtrl = ImGui.GetIO().KeyCtrl;
    if (
      ImGui.Selectable(
        label,
        isSelected,
        ImGui.SelectableFlags.SpanAllColumns | ImGui.SelectableFlags.AllowDoubleClick
      )
    ) {
      if (isSelected && !keyCtrl) {
        this.handleItemClick(item);
      }
    }
    if (ImGui.IsItemHovered()) {
      this._hoveredItem = item;
    }
    if (ImGui.IsItemClicked(ImGui.MouseButton.Left) && (keyCtrl || !this._selectedItems.has(item))) {
      this.handleItemClick(item);
    }
    if (ImGui.IsItemHovered() && ImGui.IsMouseDoubleClicked(ImGui.MouseButton.Left)) {
      this.handleItemDoubleClick(item);
    }
    if (this._selectedItems.size > 0) {
      enableWorkspaceDragging(
        item,
        'ASSET',
        () =>
          [...this.selectedItems].map((item) => {
            return {
              isDir: 'subDir' in item,
              path: 'subDir' in item ? item.path : item.meta.path
            };
          }),
        () => {
          const ctrlDown = ImGui.GetIO().KeyCtrl;
          let icon = isDir ? '📁' : this.getFileEmoji(item.meta);
          if (ctrlDown) {
            icon += '+';
          }
          ImGui.Text(convertEmojiString(icon));
        }
      );
    }

    ImGui.TableSetColumnIndex(1);
    if (!isDir && meta) {
      ImGui.Text(this.formatFileSize(meta.size));
    } else {
      ImGui.Text('--');
    }

    ImGui.TableSetColumnIndex(2);
    if (!isDir) {
      if (meta?.mimeType) {
        ImGui.Text(meta.mimeType);
      } else {
        ImGui.Text('File');
      }
    }

    ImGui.TableSetColumnIndex(3);
    const modifiedDate = isDir ? null : meta?.modified;
    if (modifiedDate) {
      ImGui.Text(this.formatDate(modifiedDate));
    } else {
      ImGui.Text('--');
    }
  }

  private handleItemClick(item: FileInfo | DirectoryInfo) {
    const io = ImGui.GetIO();

    if (this._options.multiSelect && io.KeyCtrl) {
      if (this._selectedItems.has(item)) {
        this._selectedItems.delete(item);
      } else {
        this._selectedItems.add(item);
      }
    } else if (this._options.multiSelect && io.KeyShift && this._selectedItems.size > 0) {
      this._selectedItems.clear();
      this._selectedItems.add(item);
    } else {
      this._selectedItems.clear();
      this._selectedItems.add(item);
    }
    this.emitSelectedChanged();
  }

  private handleItemDoubleClick(item: FileInfo | DirectoryInfo) {
    const isDir = 'subDir' in item;
    if (isDir) {
      this.selectDir(item as DirectoryInfo);
      item.open = true;
    } else {
      if (item.meta.path.toLowerCase().endsWith('.scn')) {
        // open scene
        eventBus.dispatchEvent('action', 'OPEN_DOC', item.meta.path);
      } else {
        const mimeType = this._vfs.guessMIMEType(item.meta.path);
        if (
          mimeType === 'text/javascript' ||
          mimeType === 'text/x-typescript' ||
          mimeType === 'text/html' ||
          mimeType === 'application/json' ||
          mimeType === 'text/plain'
        ) {
          eventBus.dispatchEvent('action', 'EDIT_CODE', item.meta.path, mimeType);
        }
      }
    }
  }

  private handleContextMenu() {
    if (ImGui.IsWindowHovered() && ImGui.IsMouseClicked(ImGui.MouseButton.Right)) {
      const clickedItem = this.getItemUnderMouse();
      if (clickedItem) {
        if (!this._selectedItems.has(clickedItem)) {
          this._selectedItems.clear();
          this._selectedItems.add(clickedItem);
          this.emitSelectedChanged();
        }
        ImGui.OpenPopup('##ItemContextMenu');
      } else {
        ImGui.OpenPopup('##ContentContextMenu');
      }
    }

    if (ImGui.BeginPopup('##ItemContextMenu')) {
      const selectedCount = this._selectedItems.size;
      const selectedItems = Array.from(this._selectedItems);

      if (selectedCount > 0) {
        if (ImGui.MenuItem(`Delete (${selectedCount} item${selectedCount > 1 ? 's' : ''})`)) {
          this.deleteSelectedItems();
        }

        if (selectedCount === 1) {
          const item = selectedItems[0];

          ImGui.Separator();
          if (ImGui.MenuItem('Rename')) {
            this.renameSelectedItem();
          }

          ImGui.Separator();
          if (ImGui.MenuItem('Properties')) {
            this.showItemProperties(item);
          }
        }
      }

      ImGui.EndPopup();
    }

    if (ImGui.BeginPopup('##ContentContextMenu')) {
      if (ImGui.BeginMenu('Create New')) {
        if (ImGui.MenuItem('Folder...')) {
          this.createNewFolder();
        }
        ImGui.Separator();
        if (ImGui.MenuItem('Typescript...')) {
          this.createNewFile('Create Typescript', 'NewScript.ts', 'utf8', templateScript);
        }
        ImGui.EndMenu();
      }

      ImGui.Separator();

      if (ImGui.BeginMenu('View')) {
        if (ImGui.RadioButton('List View', this._viewMode === ViewMode.List)) {
          this._viewMode = ViewMode.List;
        }
        if (ImGui.RadioButton('Grid View', this._viewMode === ViewMode.Grid)) {
          this._viewMode = ViewMode.Grid;
        }
        if (ImGui.RadioButton('Details View', this._viewMode === ViewMode.Details)) {
          this._viewMode = ViewMode.Details;
        }
        ImGui.EndMenu();
      }

      if (ImGui.BeginMenu('Sort by')) {
        if (ImGui.RadioButton('Name', this._sortBy === SortBy.Name)) {
          this._sortBy = SortBy.Name;
          this.sortContent();
        }
        if (ImGui.RadioButton('Size', this._sortBy === SortBy.Size)) {
          this._sortBy = SortBy.Size;
          this.sortContent();
        }
        if (ImGui.RadioButton('Type', this._sortBy === SortBy.Type)) {
          this._sortBy = SortBy.Type;
          this.sortContent();
        }
        if (ImGui.RadioButton('Modified', this._sortBy === SortBy.Modified)) {
          this._sortBy = SortBy.Modified;
          this.sortContent();
        }
        ImGui.Separator();
        if (ImGui.MenuItem(this._sortAscending ? 'Descending' : 'Ascending')) {
          this._sortAscending = !this._sortAscending;
          this.sortContent();
        }
        ImGui.EndMenu();
      }

      if (ImGui.MenuItem('Refresh')) {
        this.refreshFileView();
      }

      ImGui.EndPopup();
    }
  }

  private getItemUnderMouse(): FileInfo | DirectoryInfo | null {
    return this._hoveredItem;
  }

  private handleTableSort(sortSpecs: any) {
    if (sortSpecs.Specs.length > 0) {
      const spec = sortSpecs.Specs[0];
      switch (spec.ColumnIndex) {
        case 0:
          this._sortBy = SortBy.Name;
          break;
        case 1:
          this._sortBy = SortBy.Size;
          break;
        case 2:
          this._sortBy = SortBy.Type;
          break;
        case 3:
          this._sortBy = SortBy.Modified;
          break;
      }
      this._sortAscending = spec.SortDirection === ImGui.SortDirection.Ascending;
      this.sortContent();
    }
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

      let comparison = 0;

      switch (this._sortBy) {
        case SortBy.Name:
          const nameA = isADir ? a.path.slice(a.path.lastIndexOf('/') + 1) : (a as FileInfo).meta.name;
          const nameB = isBDir ? b.path.slice(b.path.lastIndexOf('/') + 1) : (b as FileInfo).meta.name;
          comparison = nameA.localeCompare(nameB);
          break;

        case SortBy.Size:
          if (!isADir && !isBDir) {
            comparison = (a as FileInfo).meta.size - (b as FileInfo).meta.size;
          }
          break;

        case SortBy.Type:
          if (!isADir && !isBDir) {
            const typeA = (a as FileInfo).meta.mimeType || '';
            const typeB = (b as FileInfo).meta.mimeType || '';
            comparison = typeA.localeCompare(typeB);
          }
          break;

        case SortBy.Modified:
          if (!isADir && !isBDir) {
            const timeA = (a as FileInfo).meta.modified?.getTime() || 0;
            const timeB = (b as FileInfo).meta.modified?.getTime() || 0;
            comparison = timeA - timeB;
          }
          break;
      }

      return this._sortAscending ? comparison : -comparison;
    });
  }

  private getFileEmoji(meta: FileMetadata): string {
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
        return '🌐';
      default:
        return '📄';
    }
  }

  private formatFileSize(bytes: number): string {
    if (bytes === 0) {
      return '0 B';
    }

    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  private formatDate(date: Date): string {
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

  private createNewFolder() {
    if (!this._selectedDir) {
      return;
    }

    DlgPromptName.promptName('Create Folder', 'NewFolder').then((name) => {
      if (name) {
        if (/[\\/?*]/.test(name)) {
          DlgMessage.messageBox('Error', 'Invalid folder name');
        } else {
          const newPath = this._vfs.join(this._selectedDir.path, name);
          this._vfs.makeDirectory(newPath, false).catch((err) => {
            DlgMessage.messageBox('Error', `Create folder failed: ${err}`);
          });
        }
      }
    });
  }

  private async createNewFile(
    title: string,
    defaultName: string,
    encoding: 'utf8' | 'binary',
    content?: string
  ) {
    if (!this._selectedDir) {
      return;
    }
    const name = await DlgPromptName.promptName(title, 'Name', defaultName);
    if (name) {
      if (/[\\/?*]/.test(name)) {
        DlgMessage.messageBox('Error', 'Invalid file name');
      } else {
        const newPath = this._vfs.join(this._selectedDir.path, name);
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
          await this._vfs.writeFile(newPath, content ?? '', { encoding, create: true });
        } catch (err) {
          DlgMessage.messageBox('Error', `Create file failed: ${err}`);
        }
      }
    }
  }

  private deleteSelectedItems() {
    if (this._selectedItems.size === 0) {
      return;
    }

    const items = Array.from(this._selectedItems);
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
        this._selectedItems.clear();
        this.emitSelectedChanged();
      })
      .catch((err) => {
        DlgMessage.messageBox('Error', `Delete failed: ${err}`);
      });
  }

  private renameItem(item: DirectoryInfo | FileInfo) {
    const isDir = 'subDir' in item;
    const currentName = isDir
      ? item.path.slice(item.path.lastIndexOf('/') + 1)
      : (item as FileInfo).meta.name;
    DlgPromptName.promptName('Rename', 'Name', currentName).then((newName) => {
      if (newName && newName !== currentName) {
        if (/[\\/?*]/.test(newName)) {
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

  private renameSelectedItem() {
    if (this._selectedItems.size !== 1) {
      return;
    }
    this.renameItem(Array.from(this._selectedItems)[0]);
  }

  selectDir(dir: DirectoryInfo) {
    if (dir !== this._selectedDir) {
      this._selectedDir = dir;
      this.refreshFileView();
    }
  }

  refreshFileView() {
    if (!this._selectedDir) {
      this._currentDirContent = [];
      return;
    }

    this._currentDirContent = [...this._selectedDir.subDir, ...this._selectedDir.files];
    this.sortContent();
    if (this._selectedItems.size > 0) {
      this._selectedItems.clear();
      this.emitSelectedChanged();
    }
  }

  renderDir(dir: DirectoryInfo) {
    const name = dir.path.slice(dir.path.lastIndexOf('/') + 1);
    const emoji = '📁';
    const id = dir.path;
    const label = convertEmojiString(
      `${emoji}${dir === this._filesystem ? this._project.name : name}##${id}`
    );
    let flags = VFSRenderer.baseFlags;
    if (this._selectedDir === dir) {
      flags |= ImGui.TreeNodeFlags.Selected;
    }
    if (dir.subDir.length === 0) {
      flags |= ImGui.TreeNodeFlags.Leaf;
    }
    const forceExpanded = this._selectedDir ? this.isParentOf(dir, this._selectedDir) : false;
    if (forceExpanded) {
      ImGui.SetNextItemOpen(true);
    }
    dir.open = ImGui.TreeNodeEx(label, flags);
    this.acceptFileMoveOrCopy(dir.path);
    if (ImGui.IsItemClicked(ImGui.MouseButton.Left)) {
      this.selectDir(dir);
    }
    if (ImGui.IsItemClicked(ImGui.MouseButton.Right)) {
      ImGui.OpenPopup(`vfs_${id}`);
    }
    if (ImGui.BeginPopup(`vfs_${id}`)) {
      if (ImGui.BeginMenu('Create New##VFSCreate')) {
        if (ImGui.MenuItem('Folder...##VFSCreateFolder')) {
          DlgPromptName.promptName('Create Folder', 'NewFolder').then((name) => {
            if (name) {
              if (/[\\/?*]/.test(name)) {
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
        ImGui.Separator();
        if (ImGui.MenuItem('Scene...##VFSCreateScene')) {
          console.log('Create scene');
        }
        ImGui.EndMenu();
      }
      if (dir !== this._filesystem) {
        if (ImGui.MenuItem('Delete##VFSDeleteFolder')) {
          this._vfs
            .deleteDirectory(dir.path, true)
            .then(() => {
              if (dir === this._selectedDir) {
                this.selectDir(null);
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
    if (dir.open) {
      for (const subdir of dir.subDir) {
        this.renderDir(subdir);
      }
      ImGui.TreePop();
    }
  }

  async loadFileSystem() {
    if (!this._project) {
      return;
    }
    const rootDir = await this.loadDirectoryInfo('/assets');
    this._filesystem = rootDir;

    if (this._selectedDir) {
      const newSelectedDir = this.findDirectoryByPath(this._filesystem, this._selectedDir.path);
      this.selectDir(newSelectedDir ?? null);
    } else {
      this.selectDir(this._filesystem);
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
    if (!stats || !stats.isDirectory) {
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
    if (info.targetDirectory && ev.type === 'drop') {
      const data = ev.dataTransfer;
      const testVFS = new DataTransferVFS(data);
      const dlgProgressBar = new DlgProgress('Copy File##CopyProgress', 300);
      dlgProgressBar.showModal();
      await testVFS.copyFileEx('/**/*', info.targetDirectory.path, {
        overwrite: true,
        targetVFS: this._vfs,
        onProgress: (current, total) => {
          dlgProgressBar.setProgress(current, total);
        }
      });
      dlgProgressBar.close();
    }
  }

  emitSelectedChanged() {
    this.dispatchEvent('selection_changed', this._selectedDir ?? null, this.selectedFiles);
  }

  onVFSChanged(type: 'created' | 'deleted' | 'moved' | 'modified') {
    if (type !== 'modified') {
      this.loadFileSystem().then(() => {
        this.refreshFileView();
      });
    }
  }
  dispose() {
    this._vfs.off('changed', this.onVFSChanged, this);
    if (this._options.allowDrop) {
      eventBus.off('external_dragenter', this.handleDragEvent, this);
      eventBus.off('external_dragover', this.handleDragEvent, this);
      eventBus.off('external_dragleave', this.handleDragEvent, this);
      eventBus.off('external_drop', this.handleDragEvent, this);
    }
  }
  private acceptFileMoveOrCopy(path: string) {
    if (ImGui.BeginDragDropTarget()) {
      const payload = ImGui.AcceptDragDropPayload('ASSET')?.Data as { isDir: boolean; path: string }[];
      if (payload) {
        this.handleFileMoveOrCopy(path, payload);
      }
      ImGui.EndDragDropTarget();
    }
  }
  private async handleFileMoveOrCopy(targetDir: string, payload: { isDir: boolean; path: string }[]) {
    const copy = ImGui.GetIO().KeyCtrl;
    const dlg = copy ? new DlgProgress('CopyFile##CopyProgress', 300, true) : null;
    if (dlg) {
      dlg.showModal();
      dlg.setProgress(0, payload.length);
    }
    for (let i = 0; i < payload.length; i++) {
      const asset = payload[i];
      const vfs = ProjectService.VFS;
      const sourceDir = asset.path;
      const parentDir = vfs.dirname(sourceDir);
      if (vfs.isParentOf(parentDir, targetDir) && vfs.isParentOf(targetDir, parentDir)) {
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
