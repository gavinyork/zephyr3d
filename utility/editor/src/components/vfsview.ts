import { FileMetadata, VFS } from '@zephyr3d/base';
import { DockPannel, ResizeDirection } from './dockpanel';
import { ImGui } from '@zephyr3d/imgui';
import { convertEmojiString } from '../helpers/emoji';

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

export class VFSView {
  private static baseFlags =
    ImGui.TreeNodeFlags.SpanAvailWidth |
    ImGui.TreeNodeFlags.SpanFullWidth |
    ImGui.TreeNodeFlags.OpenOnDoubleClick;
  private _vfs: VFS;
  private _panel: DockPannel;
  private _treePanel: DockPannel;
  private _filesystem: DirectoryInfo;
  private _selectedDir: DirectoryInfo;

  constructor(vfs: VFS, left: number, top: number, width: number, height: number) {
    this._vfs = vfs;
    this._panel = new DockPannel(left, top, width, height, 8, 0, 99999, ResizeDirection.Top, 200, 600);
    this._treePanel = new DockPannel(0, 0, 200, -1, 8, 200, 500, ResizeDirection.Right, 0, 99999);
    this._filesystem = null;
    this._selectedDir = null;
    this.loadFileSystem();
  }
  get vfs() {
    return this._vfs;
  }
  get height() {
    return this._panel.height;
  }
  render(width: number) {
    this._panel.width = width;
    if (this._panel.begin('##VFSView')) {
      if (this._treePanel.beginChild('##VFSViewTree')) {
        if (this._filesystem) {
          this.renderDir(this._filesystem);
        }
      }
      this._treePanel.endChild();
      ImGui.SetCursorPos(new ImGui.ImVec2(this._treePanel.width, 0));
      if (ImGui.BeginChild('##VFSViewContent', new ImGui.ImVec2(-1, -1), true, ImGui.WindowFlags.None)) {
      }
      ImGui.EndChild();
    }
    this._panel.end();
  }
  selectDir(dir: DirectoryInfo) {
    if (dir !== this._selectedDir) {
      this._selectedDir = dir;
      this.refreshFileView();
    }
  }
  refreshFileView() {}
  renderDir(dir: DirectoryInfo) {
    const name = dir.path.slice(dir.path.lastIndexOf('/') + 1);
    const emoji = '📁';
    const id = dir.path;
    const label = convertEmojiString(`${emoji}${name || 'asset://'}##${id}`);
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
    if (dir.open) {
      for (const subdir of dir.subDir) {
        this.renderDir(subdir);
      }
      /*
      for (const file of dir.files) {
        if (ImGui.TreeNodeEx(file.meta.name, VFSView.baseFlags | ImGui.TreeNodeFlags.Leaf)) {
          ImGui.TreePop();
        }
      }
      */
      ImGui.TreePop();
    }
  }
  async loadFileSystem() {
    const rootDir = await this.loadDirectoryInfo('/');
    this._filesystem = rootDir;
  }
  async loadDirectoryInfo(path: string): Promise<DirectoryInfo> {
    const dirExists = await this._vfs.exists(path);
    if (!dirExists) {
      return null;
    }
    const stats = await this._vfs.stat(path);
    if (!stats || !stats.isDirectory) {
      return null;
    }
    this._vfs.getInfo();
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
}
