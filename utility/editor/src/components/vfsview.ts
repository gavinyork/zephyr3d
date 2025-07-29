import { FileMetadata, VFS } from '@zephyr3d/base';
import { DockPannel, ResizeDirection } from './dockpanel';
import { ImGui } from '@zephyr3d/imgui';
import { convertEmojiString } from '../helpers/emoji';
import { ProjectInfo } from '../core/services/project';
import { Dialog } from '../views/dlg/dlg';
import { enableWorkspaceDragging } from './dragdrop';
import { eventBus } from '../core/eventbus';

type FileInfo = {
  meta: FileMetadata;
  parent: DirectoryInfo;
};

type DirectoryInfo = {
  path: string;
  files: FileInfo[];
  subDir: DirectoryInfo[];
  parent: DirectoryInfo;
  open: boolean;
};

// 视图模式枚举
enum ViewMode {
  List = 0,
  Grid = 1,
  Details = 2
}

// 排序方式枚举
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
  Navigation = 'navigation', // 拖放到根目录
  Content = 'content' // 拖放到当前内容区目录
}

export class VFSView {
  private static baseFlags = ImGui.TreeNodeFlags.SpanAvailWidth | ImGui.TreeNodeFlags.SpanFullWidth;
  private _vfs: VFS;
  private _project: ProjectInfo;
  private _panel: DockPannel;
  private _treePanel: DockPannel;
  private _filesystem: DirectoryInfo;
  private _selectedDir: DirectoryInfo;

  // 新增属性：右侧面板相关
  private _currentDirContent: (FileInfo | DirectoryInfo)[] = [];
  private _viewMode: ViewMode = ViewMode.List;
  private _sortBy: SortBy = SortBy.Name;
  private _sortAscending: boolean = true;
  private _selectedItems: Set<FileInfo | DirectoryInfo> = new Set();
  private _lastClickTime: number = 0;
  private _lastClickedItem: FileInfo | DirectoryInfo = null;
  private _gridItemSize: number = 80;
  private _showHidden: boolean = false;
  private _hoveredItem: FileInfo | DirectoryInfo | null = null;
  private _navigationBounds: AreaBounds | null = null;
  private _contentBounds: AreaBounds | null = null;
  private _isDragOverNavigation = false;
  private _isDragOverContent = false;

  constructor(vfs: VFS, project: ProjectInfo, left: number, top: number, width: number, height: number) {
    this._vfs = vfs;
    this._project = project;
    this._panel = new DockPannel(left, top, width, height, 8, 0, 99999, ResizeDirection.Top, 200, 600);
    this._treePanel = new DockPannel(0, 0, 200, -1, 8, 200, 500, ResizeDirection.Right, 0, 99999);
    this._filesystem = null;
    this._selectedDir = null;
    this.loadFileSystem();
    eventBus.on('external_dragenter', this.handleDragEvent, this);
    eventBus.on('external_dragover', this.handleDragEvent, this);
    eventBus.on('external_dragleave', this.handleDragEvent, this);
    eventBus.on('external_drop', this.handleDragEvent, this);
  }

  get width() {
    return this._panel.width;
  }

  get height() {
    return this._panel.height;
  }

  render(width: number) {
    this._panel.width = width;
    if (this._panel.begin('##VFSView')) {
      // 左侧目录树
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

        // 如果正在拖放并且鼠标在导航区域内，显示高亮效果
        if (this._isDragOverNavigation) {
          this.renderNavigationDropHighlight();
        }
        if (this._filesystem) {
          this.renderDir(this._filesystem);
        }
      }
      this._treePanel.endChild();

      // 右侧内容区域
      ImGui.SetCursorPos(new ImGui.ImVec2(this._treePanel.width, 0));
      if (ImGui.BeginChild('##VFSViewContent', new ImGui.ImVec2(-1, -1), true, ImGui.WindowFlags.None)) {
        this.renderContentArea();
      }
      ImGui.EndChild();
    }
    this._panel.end();
  }

  public isMouseInArea(mousePos: ImGui.ImVec2, area: 'navigation' | 'content'): boolean {
    const bounds = area === 'navigation' ? this._navigationBounds : this._contentBounds;

    if (!bounds) return false;

    return (
      mousePos.x >= bounds.min.x &&
      mousePos.x <= bounds.max.x &&
      mousePos.y >= bounds.min.y &&
      mousePos.y <= bounds.max.y
    );
  }

  // 获取鼠标当前所在的拖放区域
  public getDropZoneAtPosition(mousePos: ImGui.ImVec2): DropZone {
    if (this.isMouseInArea(mousePos, 'navigation')) {
      return DropZone.Navigation;
    } else if (this.isMouseInArea(mousePos, 'content')) {
      return DropZone.Content;
    }
    return DropZone.None;
  }

  // 设置拖放状态
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
  // 渲染右侧内容区域
  private renderContentArea() {
    this._hoveredItem = null;
    // 工具栏
    this.renderToolbar();
    ImGui.Separator();

    const contentMin = ImGui.GetCursorScreenPos();
    const availableSize = ImGui.GetContentRegionAvail();
    const contentMax = new ImGui.ImVec2(contentMin.x + availableSize.x, contentMin.y + availableSize.y);

    this._contentBounds = {
      min: contentMin,
      max: contentMax
    };

    // 如果正在拖放并且鼠标在内容区域内，显示高亮效果
    if (this._isDragOverContent) {
      this.renderContentDropHighlight();
    }

    // 内容区域
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
      // 没有选中目录时的提示
      const windowSize = ImGui.GetWindowSize();
      const textSize = ImGui.CalcTextSize('Select a folder to view its contents');
      ImGui.SetCursorPos(
        new ImGui.ImVec2((windowSize.x - textSize.x) * 0.5, (windowSize.y - textSize.y) * 0.5)
      );
      ImGui.TextDisabled('Select a folder to view its contents');
    }

    // 处理右键菜单
    this.handleContextMenu();
  }

  private renderNavigationDropHighlight() {
    const drawList = ImGui.GetWindowDrawList();
    const bounds = this._navigationBounds;

    if (!bounds) return;

    // 绘制高亮边框和背景
    const highlightColor = ImGui.ColorConvertFloat4ToU32(new ImGui.ImVec4(0.3, 0.7, 1.0, 0.6));
    const backgroundColor = ImGui.ColorConvertFloat4ToU32(new ImGui.ImVec4(0.3, 0.7, 1.0, 0.1));

    // 背景高亮
    drawList.AddRectFilled(bounds.min, bounds.max, backgroundColor, 4.0);

    // 边框高亮
    drawList.AddRect(bounds.min, bounds.max, highlightColor, 4.0, ImGui.DrawCornerFlags.None, 2.0);

    // 添加提示文字
    const rootDirName = this._filesystem
      ? this._filesystem.path.slice(this._filesystem.path.lastIndexOf('/') + 1) || 'Root'
      : 'Root Directory';

    const text = `Drop to ${rootDirName}`;
    const textSize = ImGui.CalcTextSize(text);
    const textPos = new ImGui.ImVec2(
      bounds.min.x + (bounds.max.x - bounds.min.x - textSize.x) * 0.5,
      bounds.max.y - textSize.y - 10
    );

    // 文字背景
    const textBg = ImGui.ColorConvertFloat4ToU32(new ImGui.ImVec4(0.0, 0.0, 0.0, 0.7));
    drawList.AddRectFilled(
      new ImGui.ImVec2(textPos.x - 8, textPos.y - 3),
      new ImGui.ImVec2(textPos.x + textSize.x + 8, textPos.y + textSize.y + 3),
      textBg,
      3.0
    );

    // 文字
    const textColor = ImGui.ColorConvertFloat4ToU32(new ImGui.ImVec4(1.0, 1.0, 1.0, 1.0));
    drawList.AddText(textPos, textColor, text);
  }

  // 渲染内容区域拖放高亮效果
  private renderContentDropHighlight() {
    const drawList = ImGui.GetWindowDrawList();
    const bounds = this._contentBounds;

    if (!bounds) return;

    const highlightColor = ImGui.ColorConvertFloat4ToU32(new ImGui.ImVec4(0.3, 1.0, 0.3, 0.6));
    const backgroundColor = ImGui.ColorConvertFloat4ToU32(new ImGui.ImVec4(0.3, 1.0, 0.3, 0.1));

    // 背景高亮
    drawList.AddRectFilled(bounds.min, bounds.max, backgroundColor, 4.0);

    // 边框高亮
    drawList.AddRect(bounds.min, bounds.max, highlightColor, 4.0, ImGui.DrawCornerFlags.None, 2.0);

    // 添加提示文字
    const currentDirName = this._selectedDir
      ? this._selectedDir.path.slice(this._selectedDir.path.lastIndexOf('/') + 1) || 'Current Directory'
      : 'Current Directory';

    const text = `Drop to ${currentDirName}`;
    const textSize = ImGui.CalcTextSize(text);
    const textPos = new ImGui.ImVec2(
      bounds.min.x + (bounds.max.x - bounds.min.x - textSize.x) * 0.5,
      bounds.min.y + (bounds.max.y - bounds.min.y - textSize.y) * 0.5
    );

    // 文字背景
    const textBg = ImGui.ColorConvertFloat4ToU32(new ImGui.ImVec4(0.0, 0.0, 0.0, 0.7));
    drawList.AddRectFilled(
      new ImGui.ImVec2(textPos.x - 10, textPos.y - 5),
      new ImGui.ImVec2(textPos.x + textSize.x + 10, textPos.y + textSize.y + 5),
      textBg,
      4.0
    );

    // 文字
    const textColor = ImGui.ColorConvertFloat4ToU32(new ImGui.ImVec4(1.0, 1.0, 1.0, 1.0));
    drawList.AddText(textPos, textColor, text);
  }

  public getDropTargetDirectory(): DirectoryInfo | null {
    if (this._isDragOverNavigation) {
      return this._filesystem; // 拖放到根目录
    } else if (this._isDragOverContent) {
      return this._selectedDir; // 拖放到当前内容区目录
    }
    return null;
  }

  // 获取当前拖放信息（供外部使用）
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

  // 处理外部文件拖放
  public handleExternalDrop(files: FileList, mousePos: ImGui.ImVec2): boolean {
    const targetDirectory = this.getDropTargetDirectory();

    if (!targetDirectory) {
      console.log('No valid drop target');
      return false;
    }

    const zone = this.getDropZoneAtPosition(mousePos);
    const targetPath = targetDirectory.path;

    console.log(`Dropping ${files.length} files to: ${targetPath} (zone: ${zone})`);

    // 实现文件拖放逻辑
    Array.from(files).forEach((file, index) => {
      console.log(`  File ${index + 1}: ${file.name} -> ${targetPath}`);
      // 这里实现实际的文件操作
      //this.handleFileUpload(file, targetDirectory);
    });

    // 刷新文件视图
    this.refreshFileView();

    return true;
  }

  private showItemProperties(item: FileInfo | DirectoryInfo) {
    const isDir = 'subDir' in item;
    const name = isDir ? item.path.slice(item.path.lastIndexOf('/') + 1) : (item as FileInfo).meta.name;

    let info = `Name: ${name}\n`;
    info += `Type: ${isDir ? 'Folder' : 'File'}\n`;

    if (!isDir) {
      const meta = (item as FileInfo).meta;
      info += `Size: ${this.formatFileSize(meta.size)}\n`;
      if (meta.mimeType) info += `MIME Type: ${meta.mimeType}\n`;
      if (meta.modified) info += `Modified: ${this.formatDate(meta.modified)}\n`;
    }

    info += `Path: ${isDir ? item.path : (item as FileInfo).meta.path}`;

    Dialog.messageBox('Properties', info);
  }

  // 渲染工具栏
  private renderToolbar() {
    // 视图模式切换
    ImGui.Text('View:');
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

    // 排序选项
    ImGui.Text('Sort by:');
    ImGui.SameLine();
    ImGui.SetNextItemWidth(100);

    const sortItems = ['Name', 'Size', 'Type', 'Modified'];
    let currentSort = this._sortBy;
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

    // 显示隐藏文件
    if (ImGui.Checkbox('Show Hidden', [this._showHidden])) {
      this.refreshFileView();
    }

    // 网格视图时的图标大小滑块
    if (this._viewMode === ViewMode.Grid) {
      ImGui.SameLine();
      ImGui.Text('Size:');
      ImGui.SameLine();
      ImGui.SetNextItemWidth(100);
      ImGui.SliderInt('##GridSize', [this._gridItemSize], 40, 120);
    }
  }

  // 列表视图
  private renderListView() {
    for (let i = 0; i < this._currentDirContent.length; i++) {
      const item = this._currentDirContent[i];
      this.renderListItem(item, i);
    }
  }

  // 网格视图
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

  // 详细视图
  private renderDetailsView() {
    // 表头
    if (
      ImGui.BeginTable(
        '##FileTable',
        4,
        ImGui.TableFlags.Resizable | ImGui.TableFlags.Sortable | ImGui.TableFlags.BordersInnerV
      )
    ) {
      ImGui.TableSetupColumn('Name', ImGui.TableColumnFlags.DefaultSort);
      ImGui.TableSetupColumn('Size');
      ImGui.TableSetupColumn('Type');
      ImGui.TableSetupColumn('Modified');
      ImGui.TableHeadersRow();

      // 处理表格排序
      const sortSpecs = ImGui.TableGetSortSpecs();
      if (sortSpecs && sortSpecs.SpecsDirty) {
        this.handleTableSort(sortSpecs);
        sortSpecs.SpecsDirty = false;
      }

      // 渲染行
      for (let i = 0; i < this._currentDirContent.length; i++) {
        const item = this._currentDirContent[i];
        this.renderTableRow(item, i);
      }

      ImGui.EndTable();
    }
  }
  // 渲染列表项
  private renderListItem(item: FileInfo | DirectoryInfo, index: number) {
    const isDir = 'subDir' in item;
    const name = isDir ? item.path.slice(item.path.lastIndexOf('/') + 1) : (item as FileInfo).meta.name;

    const emoji = isDir ? '📁' : this.getFileEmoji((item as FileInfo).meta);
    const label = convertEmojiString(`${emoji} ${name}##item_${index}`);

    const isSelected = this._selectedItems.has(item);

    if (ImGui.Selectable(label, isSelected, ImGui.SelectableFlags.AllowDoubleClick)) {
      this.handleItemClick(item, index);
    }

    // 跟踪鼠标悬停状态
    if (ImGui.IsItemHovered()) {
      this._hoveredItem = item;
    }

    if (ImGui.IsItemHovered() && ImGui.IsMouseDoubleClicked(ImGui.MouseButton.Left)) {
      this.handleItemDoubleClick(item);
    }

    if (!isDir) {
      enableWorkspaceDragging(item, 'asset', item.meta.path);
    }
  }

  // 渲染网格项
  private renderGridItem(item: FileInfo | DirectoryInfo, index: number) {
    const isDir = 'subDir' in item;
    const name = isDir ? item.path.slice(item.path.lastIndexOf('/') + 1) : (item as FileInfo).meta.name;

    const emoji = isDir ? '📁' : this.getFileEmoji((item as FileInfo).meta);
    const isSelected = this._selectedItems.has(item);

    ImGui.BeginGroup();

    // 图标
    const iconSize = this._gridItemSize;
    if (
      ImGui.Selectable(
        `##icon_${index}`,
        isSelected,
        ImGui.SelectableFlags.AllowDoubleClick,
        new ImGui.ImVec2(iconSize, iconSize)
      )
    ) {
      this.handleItemClick(item, index);
    }

    // 跟踪鼠标悬停状态
    if (ImGui.IsItemHovered()) {
      this._hoveredItem = item;
    }

    if (ImGui.IsItemHovered() && ImGui.IsMouseDoubleClicked(ImGui.MouseButton.Left)) {
      this.handleItemDoubleClick(item);
    }

    if (!isDir) {
      enableWorkspaceDragging(item, 'asset', item.meta.path);
    }

    // 在图标中央显示 emoji
    const drawList = ImGui.GetWindowDrawList();
    const pos = ImGui.GetItemRectMin();
    const emojiSize = ImGui.CalcTextSize(convertEmojiString(emoji));
    const emojiPos = new ImGui.ImVec2(
      pos.x + (iconSize - emojiSize.x) * 0.5,
      pos.y + (iconSize - emojiSize.y) * 0.5
    );
    drawList.AddText(emojiPos, ImGui.GetColorU32(ImGui.Col.Text), convertEmojiString(emoji));

    // 文件名
    ImGui.PushTextWrapPos(ImGui.GetCursorPosX() + iconSize);
    ImGui.TextWrapped(name);
    ImGui.PopTextWrapPos();

    ImGui.EndGroup();
  }

  // 渲染表格行
  private renderTableRow(item: FileInfo | DirectoryInfo, index: number) {
    const isDir = 'subDir' in item;
    const meta = isDir ? null : (item as FileInfo).meta;
    const name = isDir ? item.path.slice(item.path.lastIndexOf('/') + 1) : meta.name;

    ImGui.TableNextRow();

    // 名称列
    ImGui.TableSetColumnIndex(0);
    const emoji = isDir ? '📁' : this.getFileEmoji(meta);
    const label = convertEmojiString(`${emoji} ${name}##row_${index}`);
    const isSelected = this._selectedItems.has(item);

    if (
      ImGui.Selectable(
        label,
        isSelected,
        ImGui.SelectableFlags.SpanAllColumns | ImGui.SelectableFlags.AllowDoubleClick
      )
    ) {
      this.handleItemClick(item, index);
    }

    // 跟踪鼠标悬停状态
    if (ImGui.IsItemHovered()) {
      this._hoveredItem = item;
    }

    if (ImGui.IsItemHovered() && ImGui.IsMouseDoubleClicked(ImGui.MouseButton.Left)) {
      this.handleItemDoubleClick(item);
    }

    if (!isDir) {
      enableWorkspaceDragging(item, 'asset', item.meta.path);
    }

    // 大小列
    ImGui.TableSetColumnIndex(1);
    if (!isDir && meta) {
      ImGui.Text(this.formatFileSize(meta.size));
    } else {
      ImGui.Text('--');
    }

    // 类型列
    ImGui.TableSetColumnIndex(2);
    if (isDir) {
      ImGui.Text('Folder');
    } else if (meta?.mimeType) {
      ImGui.Text(meta.mimeType.split('/')[1] || 'File');
    } else {
      ImGui.Text('File');
    }

    // 修改时间列
    ImGui.TableSetColumnIndex(3);
    const modifiedDate = isDir ? null : meta?.modified;
    if (modifiedDate) {
      ImGui.Text(this.formatDate(modifiedDate));
    } else {
      ImGui.Text('--');
    }
  }

  // 处理项目点击
  private handleItemClick(item: FileInfo | DirectoryInfo, index: number) {
    const currentTime = Date.now();
    const io = ImGui.GetIO();

    if (io.KeyCtrl) {
      // Ctrl+点击：多选
      if (this._selectedItems.has(item)) {
        this._selectedItems.delete(item);
      } else {
        this._selectedItems.add(item);
      }
    } else if (io.KeyShift && this._selectedItems.size > 0) {
      // Shift+点击：范围选择
      this._selectedItems.clear();
      this._selectedItems.add(item);
    } else {
      // 普通点击：单选
      this._selectedItems.clear();
      this._selectedItems.add(item);
    }

    this._lastClickTime = currentTime;
    this._lastClickedItem = item;
  }

  // 处理双击
  private handleItemDoubleClick(item: FileInfo | DirectoryInfo) {
    const isDir = 'subDir' in item;

    if (isDir) {
      // 双击目录：选中并展开
      this.selectDir(item as DirectoryInfo);
      (item as DirectoryInfo).open = true;
    } else {
      // 双击文件：打开文件（这里可以触发文件打开事件）
      console.log('Open file:', (item as FileInfo).meta.path);
      // 可以在这里添加文件打开的逻辑
    }
  }

  // 处理右键菜单
  // 处理右键菜单
  private handleContextMenu() {
    if (ImGui.IsWindowHovered() && ImGui.IsMouseClicked(ImGui.MouseButton.Right)) {
      // 检查是否右键点击了某个项目
      const clickedItem = this.getItemUnderMouse();

      if (clickedItem) {
        // 右键点击了项目
        if (this._selectedItems.has(clickedItem)) {
          // 点击的是已选中的项目：保持当前选择状态，显示多选菜单
          // 不改变选择状态
        } else {
          // 点击的是未选中的项目：选中该项目并清除其他选择
          this._selectedItems.clear();
          this._selectedItems.add(clickedItem);
          this._lastClickedItem = clickedItem;
        }
        ImGui.OpenPopup('##ItemContextMenu');
      } else {
        // 右键点击了空白区域：显示通用菜单
        ImGui.OpenPopup('##ContentContextMenu');
      }
    }

    // 项目相关的右键菜单
    if (ImGui.BeginPopup('##ItemContextMenu')) {
      const selectedCount = this._selectedItems.size;
      const selectedItems = Array.from(this._selectedItems);

      if (selectedCount > 0) {
        // 删除操作
        if (ImGui.MenuItem(`Delete (${selectedCount} item${selectedCount > 1 ? 's' : ''})`)) {
          this.deleteSelectedItems();
        }

        if (selectedCount === 1) {
          // 单个项目的操作
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

    // 空白区域的右键菜单保持不变...
    if (ImGui.BeginPopup('##ContentContextMenu')) {
      if (ImGui.BeginMenu('Create New')) {
        if (ImGui.MenuItem('Folder...')) {
          this.createNewFolder();
        }
        ImGui.Separator();
        if (ImGui.MenuItem('File...')) {
          this.createNewFile();
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
  private selectAll() {
    this._selectedItems.clear();
    for (const item of this._currentDirContent) {
      this._selectedItems.add(item);
    }
  }
  // 获取鼠标下的项目
  private getItemUnderMouse(): FileInfo | DirectoryInfo | null {
    // 这个方法需要根据当前的视图模式来实现
    // 由于 ImGui 的限制，我们需要在渲染时记录项目的位置信息
    return this._hoveredItem;
  }

  // 处理表格排序
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

  // 排序内容
  private sortContent() {
    this._currentDirContent.sort((a, b) => {
      const isADir = 'subDir' in a;
      const isBDir = 'subDir' in b;

      // 目录总是在文件前面
      if (isADir && !isBDir) return -1;
      if (!isADir && isBDir) return 1;

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

  // 获取文件 emoji
  private getFileEmoji(meta: FileMetadata): string {
    if (!meta?.mimeType) return '📄';

    const mimeType = meta.mimeType.toLowerCase();
    if (mimeType.startsWith('image/')) return '🖼️';
    if (mimeType.startsWith('video/')) return '🎬';
    if (mimeType.startsWith('audio/')) return '🔊';
    if (mimeType.includes('text') || mimeType.includes('json')) return '📝';
    if (mimeType.includes('zip') || mimeType.includes('archive')) return '📦';

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

  // 格式化文件大小
  private formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 B';

    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  // 格式化日期
  private formatDate(date: Date): string {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) {
      // 今天
      return date.toLocaleTimeString('en-US', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit'
      });
    } else if (days === 1) {
      // 昨天
      return (
        'Yesterday ' +
        date.toLocaleTimeString('en-US', {
          hour12: false,
          hour: '2-digit',
          minute: '2-digit'
        })
      );
    } else if (days < 7) {
      // 本周内
      return date.toLocaleDateString('en-US', { weekday: 'short' });
    } else {
      // 更早
      return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
    }
  }

  // 创建新文件夹
  private createNewFolder() {
    if (!this._selectedDir) return;

    Dialog.promptName('Create Folder', 'NewFolder').then((name) => {
      if (name) {
        if (/[\\/?*]/.test(name)) {
          Dialog.messageBox('Error', 'Invalid folder name');
        } else {
          const newPath = this._vfs.join(this._selectedDir.path, name);
          this._vfs
            .makeDirectory(newPath, false)
            .then(() => {
              this.loadFileSystem().then(() => {
                this.refreshFileView();
              });
            })
            .catch((err) => {
              Dialog.messageBox('Error', `Create folder failed: ${err}`);
            });
        }
      }
    });
  }

  // 创建新文件
  private createNewFile() {
    if (!this._selectedDir) return;

    Dialog.promptName('Create File', 'NewFile.txt').then((name) => {
      if (name) {
        if (/[\\/?*]/.test(name)) {
          Dialog.messageBox('Error', 'Invalid file name');
        } else {
          const newPath = this._vfs.join(this._selectedDir.path, name);
          this._vfs
            .writeFile(newPath, '', { encoding: 'utf8' })
            .then(() => {
              this.loadFileSystem().then(() => {
                this.refreshFileView();
              });
            })
            .catch((err) => {
              Dialog.messageBox('Error', `Create file failed: ${err}`);
            });
        }
      }
    });
  }

  // 删除选中项目
  private deleteSelectedItems() {
    if (this._selectedItems.size === 0) return;

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
        this.loadFileSystem().then(() => {
          this.refreshFileView();
        });
      })
      .catch((err) => {
        Dialog.messageBox('Error', `Delete failed: ${err}`);
      });
  }

  // 重命名选中项目
  private renameSelectedItem() {
    if (this._selectedItems.size !== 1) return;

    const item = Array.from(this._selectedItems)[0];
    const isDir = 'subDir' in item;
    const currentName = isDir
      ? item.path.slice(item.path.lastIndexOf('/') + 1)
      : (item as FileInfo).meta.name;

    Dialog.promptName('Rename', currentName).then((newName) => {
      if (newName && newName !== currentName) {
        if (/[\\/?*]/.test(newName)) {
          Dialog.messageBox('Error', 'Invalid name');
        } else {
          const parentPath = isDir
            ? item.path.slice(0, item.path.lastIndexOf('/'))
            : (item as FileInfo).meta.path.slice(0, (item as FileInfo).meta.path.lastIndexOf('/'));
          const newPath = this._vfs.join(parentPath, newName);

          this._vfs.moveFile(isDir ? item.path : item.meta.path, newPath);
          this.loadFileSystem();
        }
      }
    });
  }

  // 选择目录
  selectDir(dir: DirectoryInfo) {
    if (dir !== this._selectedDir) {
      this._selectedDir = dir;
      this.refreshFileView();
    }
  }

  // 刷新文件视图
  refreshFileView() {
    if (!this._selectedDir) {
      this._currentDirContent = [];
      return;
    }

    // 合并目录和文件
    this._currentDirContent = [...this._selectedDir.subDir, ...this._selectedDir.files];

    // 过滤隐藏文件
    if (!this._showHidden) {
      this._currentDirContent = this._currentDirContent.filter((item) => {
        const isDir = 'subDir' in item;
        const name = isDir ? item.path.slice(item.path.lastIndexOf('/') + 1) : (item as FileInfo).meta.name;
        return !name.startsWith('.');
      });
    }

    // 排序
    this.sortContent();

    // 清空选择
    this._selectedItems.clear();
  }

  // 原有的目录树渲染方法
  renderDir(dir: DirectoryInfo) {
    const name = dir.path.slice(dir.path.lastIndexOf('/') + 1);
    const emoji = '📁';
    const id = dir.path;
    const label = convertEmojiString(
      `${emoji}${dir === this._filesystem ? this._project.name : name}##${id}`
    );
    let flags = VFSView.baseFlags;
    if (this._selectedDir === dir) {
      flags |= ImGui.TreeNodeFlags.Selected;
    }
    if (dir.subDir.length === 0) {
      flags |= ImGui.TreeNodeFlags.Leaf;
    }
    dir.open = ImGui.TreeNodeEx(label, flags);
    if (ImGui.IsItemClicked(ImGui.MouseButton.Left)) {
      this.selectDir(dir);
    }
    if (ImGui.IsItemClicked(ImGui.MouseButton.Right)) {
      ImGui.OpenPopup(`vfs_${id}`);
    }
    if (ImGui.BeginPopup(`vfs_${id}`)) {
      if (ImGui.BeginMenu('Create New##VFSCreate')) {
        if (ImGui.MenuItem('Folder...##VFSCreateFolder')) {
          Dialog.promptName('Create Folder', 'NewFolder').then((name) => {
            if (name) {
              if (/[\\/?*]/.test(name)) {
                Dialog.messageBox('Error', 'Invalid folder name');
              } else {
                this._vfs
                  .readDirectory(dir.path, { includeHidden: true, recursive: false })
                  .then((items) => {
                    if (items.find((item) => item.type === 'directory' && item.name === name)) {
                      Dialog.messageBox('Error', 'A folder with same name already exists');
                    } else {
                      this._vfs
                        .makeDirectory(this._vfs.join(dir.path, name), false)
                        .then(() => {
                          this.loadFileSystem();
                        })
                        .catch((err) => {
                          Dialog.messageBox('Error', `Create folder failed: ${err}`);
                        });
                    }
                  })
                  .catch((err) => {
                    Dialog.messageBox('Error', `Read parent path failed: ${err}`);
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
                this._selectedDir = null;
              }
              this.loadFileSystem();
            })
            .catch((err) => {
              Dialog.messageBox('Error', `Delete directory failed: ${err}`);
            });
          console.log('Delete folder');
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
    const rootDir = await this.loadDirectoryInfo(this._project.homedir);
    this._filesystem = rootDir;

    // 如果之前有选中的目录，尝试重新找到它
    if (this._selectedDir) {
      const newSelectedDir = this.findDirectoryByPath(this._filesystem, this._selectedDir.path);
      if (newSelectedDir) {
        this._selectedDir = newSelectedDir;
        this.refreshFileView();
      } else {
        this._selectedDir = null;
        this._currentDirContent = [];
      }
    }
  }
  // 根据路径查找目录
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

    const content = await this._vfs.readDirectory(path, {
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

  handleDragEvent(ev: DragEvent) {
    const info = this.getDragDropInfo();
    this.setDragOverState(
      new ImGui.ImVec2(ev.offsetX, ev.offsetY),
      ev.type !== 'dragleave' && ev.type !== 'drop'
    );
    if (ev.type === 'drop') {
      console.log(info);
    }
  }
}
