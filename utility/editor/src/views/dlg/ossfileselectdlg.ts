import { ImGui } from '@zephyr3d/imgui';
import { DialogRenderer } from '../../components/modal';
import type { VFS } from '@zephyr3d/base';

interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children: TreeNode[];
  open: boolean;
  modified: Date | null;
}

const FOLDER_COLOR = new ImGui.ImVec4(0.4, 0.7, 1.0, 1.0);
const FILE_COLOR = new ImGui.ImVec4(0.9, 0.9, 0.9, 1.0);
const SELECTED_BG = new ImGui.ImVec4(0.2, 0.4, 0.7, 0.4);
const DATE_COLOR = new ImGui.ImVec4(0.6, 0.6, 0.6, 1.0);

export class DlgOSSFileSelect extends DialogRenderer<string[]> {
  private _vfs: VFS;
  private _rootDir: string;
  private _tree: TreeNode;
  private _checkedPaths: Set<string>;
  private _loaded: boolean;

  public static async selectFiles(
    title: string,
    vfs: VFS,
    rootDir: string,
    width: number,
    height: number
  ): Promise<string[]> {
    return new DlgOSSFileSelect(`${title}##Dialog`, vfs, rootDir, width, height).showModal();
  }

  constructor(id: string, vfs: VFS, rootDir: string, width: number, height: number) {
    super(id, width, height);
    this._vfs = vfs;
    this._rootDir = rootDir;
    this._tree = null;
    this._checkedPaths = new Set();
    this._loaded = false;
    this._loadTree();
  }

  private async _loadTree() {
    const fileList = await this._vfs.glob(`${this._rootDir}/**/*`, {
      includeHidden: false,
      includeDirs: true,
      includeFiles: true,
      recursive: true
    });
    const root: TreeNode = {
      name: this._rootDir.split('/').pop() || 'assets',
      path: this._rootDir,
      isDir: true,
      children: [],
      open: true,
      modified: null
    };
    const dirMap = new Map<string, TreeNode>();
    dirMap.set(this._rootDir, root);
    const sorted = fileList
      .filter((f) => !f.path.startsWith('/assets/@builtins/') && f.path !== '/assets/@builtins')
      .sort((a, b) => a.path.localeCompare(b.path));
    for (const entry of sorted) {
      const parentPath = entry.path.substring(0, entry.path.lastIndexOf('/')) || this._rootDir;
      const parentNode = dirMap.get(parentPath);
      if (!parentNode) continue;
      const node: TreeNode = {
        name: entry.path.split('/').pop(),
        path: entry.path,
        isDir: entry.type === 'directory',
        children: [],
        open: false,
        modified: entry.modified ?? null
      };
      parentNode.children.push(node);
      if (node.isDir) {
        dirMap.set(node.path, node);
      }
    }
    this._tree = root;
    this._loaded = true;
  }

  private _toggleCheck(node: TreeNode) {
    if (this._checkedPaths.has(node.path)) {
      this._uncheckNode(node);
    } else {
      this._checkNode(node);
    }
  }

  private _checkNode(node: TreeNode) {
    this._checkedPaths.add(node.path);
    if (node.isDir) {
      for (const child of node.children) {
        this._checkNode(child);
      }
    }
  }

  private _uncheckNode(node: TreeNode) {
    this._checkedPaths.delete(node.path);
    if (node.isDir) {
      for (const child of node.children) {
        this._uncheckNode(child);
      }
    }
  }

  private _isChecked(node: TreeNode): boolean {
    return this._checkedPaths.has(node.path);
  }

  private _isPartiallyChecked(node: TreeNode): boolean {
    if (!node.isDir || node.children.length === 0) return false;
    let hasChecked = false;
    let hasUnchecked = false;
    for (const child of node.children) {
      if (this._checkedPaths.has(child.path)) {
        hasChecked = true;
      } else {
        hasUnchecked = true;
      }
      if (hasChecked && hasUnchecked) return true;
    }
    return false;
  }

  private _renderNode(node: TreeNode, depth: number) {
    const checked = this._isChecked(node);
    const partial = this._isPartiallyChecked(node);
    const indent = depth * 20;

    ImGui.SetCursorPosX(ImGui.GetCursorPosX() + indent);

    // Checkbox
    let checkVal = [checked] as [boolean];
    if (partial) {
      ImGui.PushStyleColor(ImGui.Col.CheckMark, new ImGui.ImVec4(0.7, 0.7, 0.7, 0.6));
    }
    if (ImGui.Checkbox(`##chk_${node.path}`, checkVal)) {
      this._toggleCheck(node);
    }
    if (partial) {
      ImGui.PopStyleColor(1);
    }

    ImGui.SameLine();

    // Highlight background if checked
    if (checked) {
      const min = ImGui.GetItemRectMin();
      const max = new ImGui.ImVec2(ImGui.GetContentRegionAvail().x + ImGui.GetWindowPos().x, ImGui.GetItemRectMax().y);
      ImGui.GetWindowDrawList().AddRectFilled(min, max, ImGui.GetColorU32(SELECTED_BG));
    }

    const color = node.isDir ? FOLDER_COLOR : FILE_COLOR;
    if (node.isDir && node.children.length > 0) {
      ImGui.PushStyleColor(ImGui.Col.Text, color);
      const flags = ImGui.TreeNodeFlags.SpanAvailWidth | ImGui.TreeNodeFlags.OpenOnArrow | ImGui.TreeNodeFlags.OpenOnDoubleClick;
      const open = ImGui.TreeNodeEx(`[Dir] ${node.name}##${node.path}`, node.open ? flags | ImGui.TreeNodeFlags.DefaultOpen : flags);
      ImGui.PopStyleColor(1);
      node.open = open;
      if (open) {
        for (const child of node.children) {
          this._renderNode(child, 0);
        }
        ImGui.TreePop();
      }
    } else {
      const label = node.isDir ? `[Dir] ${node.name}` : node.name;
      ImGui.TextColored(color, label);
      if (!node.isDir && node.modified) {
        const dateStr = this._formatDate(node.modified);
        const textSize = ImGui.CalcTextSize(dateStr);
        ImGui.SameLine(ImGui.GetWindowContentRegionMax().x - textSize.x);
        ImGui.TextColored(DATE_COLOR, dateStr);
      }
    }
  }

  private _getCheckedSummary(): { folders: number; files: number } {
    let folders = 0;
    let files = 0;
    for (const p of this._checkedPaths) {
      if (this._findNode(this._tree, p)?.isDir) {
        folders++;
      } else {
        files++;
      }
    }
    return { folders, files };
  }

  private _findNode(node: TreeNode, path: string): TreeNode | null {
    if (node.path === path) return node;
    for (const child of node.children) {
      const found = this._findNode(child, path);
      if (found) return found;
    }
    return null;
  }

  private _getCheckedLeafFiles(): string[] {
    const result: string[] = [];
    const collectFiles = (node: TreeNode) => {
      if (!node.isDir) {
        if (this._checkedPaths.has(node.path)) {
          result.push(node.path);
        }
      } else {
        for (const child of node.children) {
          collectFiles(child);
        }
      }
    };
    if (this._tree) {
      collectFiles(this._tree);
    }
    return result;
  }

  private _formatDate(date: Date): string {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    if (days === 0) {
      return date.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
    } else if (days === 1) {
      return 'Yesterday ' + date.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
    } else if (days < 7) {
      return date.toLocaleDateString('en-US', { weekday: 'short' });
    } else {
      return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    }
  }

  doRender(): void {
    if (!this._loaded) {
      ImGui.Text('Loading...');
      return;
    }

    const summary = this._getCheckedSummary();
    ImGui.Text(`Selected: ${summary.folders} folder(s), ${summary.files} file(s)`);
    ImGui.Separator();

    if (ImGui.BeginChild('FileTree', new ImGui.ImVec2(0, -ImGui.GetFrameHeightWithSpacing() * 1.5), true)) {
      if (this._tree) {
        this._renderNode(this._tree, 0);
      }
    }
    ImGui.EndChild();

    if (ImGui.Button('Submit', new ImGui.ImVec2(80, 0))) {
      const files = this._getCheckedLeafFiles();
      if (files.length === 0) return;
      this.close(files);
    }
    ImGui.SameLine();
    if (ImGui.Button('Cancel', new ImGui.ImVec2(80, 0))) {
      this.close(null);
    }
  }
}
