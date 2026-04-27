import { ImGui } from '@zephyr3d/imgui';
import { DialogRenderer } from '../../components/modal';
import type { FileInfo } from '../../components/vfsrenderer';
import { VFSRenderer } from '../../components/vfsrenderer';
import type { VFS } from '@zephyr3d/base';

export class DlgOpenFile extends DialogRenderer<FileInfo[]> {
  private readonly _renderer: VFSRenderer;
  private _name: [string];
  private _filterLabels: string[];
  private _filterPatterns: string[][];
  private _selected: [number];
  public static async openFile(
    title: string,
    vfs: VFS,
    rootDir: string,
    filter: string | null,
    multi: boolean,
    width: number,
    height: number
  ) {
    return new DlgOpenFile(title, vfs, rootDir, filter, multi, width, height).showModal();
  }
  constructor(
    id: string,
    vfs: VFS,
    rootDir: string,
    filter: string,
    multi: boolean,
    width: number,
    height: number
  ) {
    super(id, width, height);
    this._name = [''];
    this._filterLabels = [];
    this._filterPatterns = [];
    if (filter) {
      const parts = filter.split('|');
      const numFilters = parts.length >> 1;
      for (let i = 0; i < numFilters; i++) {
        this._filterLabels.push(parts[i * 2]);
        this._filterPatterns.push(parts[i * 2 + 1].split(';').filter((val) => !!val));
      }
    }
    this._selected = [0];
    this._renderer = new VFSRenderer(
      vfs,
      this._filterLabels.length > 0 ? this._filterPatterns[this._selected[0]] : [],
      Math.max(0, Math.min(width / 2, 200)),
      {
        rootDir,
        multiSelect: multi,
        allowDrop: false,
        allowDblClickOpen: false
      }
    );
    this._renderer.on('file_dbl_clicked', (file: FileInfo) => {
      this._name[0] = file.meta.name;
      this.openFileAndClose();
    });
  }
  doRender(): void {
    if (ImGui.BeginChild('VFS', new ImGui.ImVec2(0, -ImGui.GetFrameHeightWithSpacing() * 2), false)) {
      this._renderer.render();
    }
    ImGui.EndChild();
    if (this._filterLabels.length > 0) {
      if (ImGui.Combo('##FileTypeCombo', this._selected, this._filterLabels)) {
        this._renderer.fileFilter = this._filterPatterns[this._selected[0]];
      }
    }
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
    if (this._renderer.selectedFiles.length > 0) {
      const files = this._renderer.selectedFiles.slice();
      this._renderer.dispose();
      this.close(files);
    }
  }
}
