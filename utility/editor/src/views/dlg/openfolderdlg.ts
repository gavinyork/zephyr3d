import { ImGui } from '@zephyr3d/imgui';
import { DialogRenderer } from '../../components/modal';
import { type DirectoryInfo, VFSRenderer } from '../../components/vfsrenderer';
import type { VFS } from '@zephyr3d/base';
import { DirTreeView } from '../../components/vfsrenderer';

export class DlgOpenFolder extends DialogRenderer<DirectoryInfo[]> {
  private readonly _renderer: VFSRenderer;
  private _treeview: DirTreeView | null;
  private _multi: boolean;
  public static async openFolder(
    title: string,
    vfs: VFS,
    rootDir: string,
    multi: boolean,
    width: number,
    height: number
  ) {
    return new DlgOpenFolder(title, vfs, rootDir, multi, width, height).showModal();
  }
  constructor(id: string, vfs: VFS, rootDir: string, multi: boolean, width: number, height: number) {
    super(id, width, height);
    this._multi = multi;
    this._treeview = null;
    this._renderer = new VFSRenderer(vfs, [], Math.max(0, Math.min(width / 2, 200)), {
      rootDir,
      multiSelect: this._multi,
      foldersOnly: true,
      allowDrop: false,
      allowDblClickOpen: false
    });
    this._renderer.once('loaded', () => {
      this._treeview = new DirTreeView(this._renderer, this._renderer.options.rootDir, this._multi);
    });
  }
  doRender(): void {
    if (ImGui.BeginChild('VFS', new ImGui.ImVec2(0, -ImGui.GetFrameHeightWithSpacing() * 2), false)) {
      if (this._treeview) {
        this._treeview.render(false);
      }
    }
    ImGui.EndChild();
    if (ImGui.Button('Open')) {
      this.openFileAndClose();
    }
    ImGui.SameLine();
    if (ImGui.Button('Cancel')) {
      this._renderer.dispose();
      this.close([]);
    }
  }
  private async openFileAndClose() {
    if (this._treeview && this._treeview.selectedNodes.size > 0) {
      const items = [...this._treeview.selectedNodes];
      this._renderer.dispose();
      this.close(items);
    }
  }
}
