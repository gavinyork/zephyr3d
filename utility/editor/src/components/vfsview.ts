import { FileMetadata, VFS } from '@zephyr3d/base';
import { DockPannel, ResizeDirection } from './dockpanel';
import { ImGui } from '@zephyr3d/imgui';
import { convertEmojiString } from '../helpers/emoji';
import { ProjectInfo } from '../core/services/project';
import { Dialog } from '../views/dlg/dlg';

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
  private static baseFlags = ImGui.TreeNodeFlags.SpanAvailWidth | ImGui.TreeNodeFlags.SpanFullWidth;
  private _vfs: VFS;
  private _project: ProjectInfo;
  private _panel: DockPannel;
  private _treePanel: DockPannel;
  private _filesystem: DirectoryInfo;
  private _selectedDir: DirectoryInfo;

  constructor(vfs: VFS, project: ProjectInfo, left: number, top: number, width: number, height: number) {
    this._vfs = vfs;
    this._project = project;
    this._panel = new DockPannel(left, top, width, height, 8, 0, 99999, ResizeDirection.Top, 200, 600);
    this._treePanel = new DockPannel(0, 0, 200, -1, 8, 200, 500, ResizeDirection.Right, 0, 99999);
    this._filesystem = null;
    this._selectedDir = null;
    this.loadFileSystem();
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
    const rootDir = await this.loadDirectoryInfo(this._project.homedir);
    this._filesystem = rootDir;
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
