import { ImGui } from '@zephyr3d/imgui';
import { DialogRenderer } from '../../components/modal';
import type { DirectoryInfo, FileInfo } from '../../components/vfsrenderer';
import { VFSRenderer } from '../../components/vfsrenderer';
import type { VFS } from '@zephyr3d/base';
import type { ProjectInfo } from '../../core/services/project';

export class DlgOpenFile extends DialogRenderer<string> {
  private readonly _renderer: VFSRenderer;
  private _name: [string];
  public static async openFile(title: string, vfs: VFS, project: ProjectInfo, width: number, height: number) {
    return new DlgOpenFile(title, vfs, project, width, height).showModal();
  }
  constructor(id: string, vfs: VFS, project: ProjectInfo, width: number, height: number) {
    super(id, width, height);
    this._renderer = new VFSRenderer(vfs, project, Math.max(0, Math.min(width / 2, 200)), {
      multiSelect: false,
      allowDrop: false
    });
    this._renderer.on('selection_changed', this.updateSelection, this);
    this._name = [''];
  }
  updateSelection(selectedDir: DirectoryInfo, files: FileInfo[]) {
    if (files.length === 1) {
      this._name[0] = files[0].meta.name;
    }
  }
  doRender(): void {
    if (ImGui.BeginChild('VFS', new ImGui.ImVec2(0, -ImGui.GetFrameHeightWithSpacing() * 2), false)) {
      this._renderer.render();
    }
    ImGui.EndChild();
    ImGui.InputText('File Name', this._name, undefined);
    if (ImGui.Button('Open')) {
      if (this._renderer.selectedDir && this._name[0] && !/[\\/?*]/.test(this._name[0])) {
        const name = this._renderer.VFS.join(this._renderer.selectedDir.path, this._name[0]);
        this._renderer.VFS.exists(name).then((exists) => {
          if (exists) {
            this._renderer.VFS.stat(name).then((stat) => {
              if (stat.isFile) {
                this._renderer.off('selection_changed', this.updateSelection, this);
                this._renderer.dispose();
                this.close(name);
              }
            });
          }
        });
      }
    }
    ImGui.SameLine();
    if (ImGui.Button('Cancel')) {
      this._renderer.off('selection_changed', this.updateSelection, this);
      this._renderer.dispose();
      this.close('');
    }
  }
}
