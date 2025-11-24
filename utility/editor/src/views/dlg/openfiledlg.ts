import { ImGui } from '@zephyr3d/imgui';
import { DialogRenderer } from '../../components/modal';
import type { DirectoryInfo, FileInfo } from '../../components/vfsrenderer';
import { VFSRenderer } from '../../components/vfsrenderer';
import type { VFS } from '@zephyr3d/base';

export class DlgOpenFile extends DialogRenderer<string> {
  private readonly _renderer: VFSRenderer;
  private _name: [string];
  private _filterLabels: string[];
  private _filterPatterns: string[][];
  private _selected: [number];
  private _error: string;
  public static async openFile(
    title: string,
    vfs: VFS,
    rootDir: string,
    filter: string,
    width: number,
    height: number
  ) {
    return new DlgOpenFile(title, vfs, rootDir, filter, width, height).showModal();
  }
  constructor(id: string, vfs: VFS, rootDir: string, filter: string, width: number, height: number) {
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
    this._error = '';
    this._selected = [0];
    this._renderer = new VFSRenderer(
      vfs,
      this._filterLabels.length > 0 ? this._filterPatterns[this._selected[0]] : [],
      Math.max(0, Math.min(width / 2, 200)),
      {
        rootDir,
        multiSelect: false,
        allowDrop: false,
        allowDblClickOpen: false
      }
    );
    this._renderer.on('file_dbl_clicked', (file: FileInfo) => {
      this._name[0] = file.meta.name;
      this._error = '';
      this.openFileAndClose();
    });
    this._renderer.on('selection_changed', this.updateSelection, this);
  }
  updateSelection(selectedDir: DirectoryInfo, files: FileInfo[]) {
    if (files.length === 1) {
      this._error = '';
      this._name[0] = files[0].meta.name;
    }
  }
  doRender(): void {
    if (ImGui.BeginChild('VFS', new ImGui.ImVec2(0, -ImGui.GetFrameHeightWithSpacing() * 2), false)) {
      this._renderer.render();
    }
    ImGui.EndChild();
    if (
      !ImGui.IsItemActive() &&
      !ImGui.IsAnyItemActive() &&
      !ImGui.IsPopupOpen('', ImGui.PopupFlags.AnyPopupId)
    ) {
      ImGui.SetKeyboardFocusHere();
    }
    const textEntered = ImGui.InputTextWithHint(
      '',
      'Enter file name',
      this._name,
      undefined,
      ImGui.InputTextFlags.EnterReturnsTrue
    );
    if (this._filterLabels.length > 0) {
      ImGui.SameLine();
      if (ImGui.Combo('##FileTypeCombo', this._selected, this._filterLabels)) {
        this._renderer.fileFilter = this._filterPatterns[this._selected[0]];
      }
    }
    if (ImGui.Button('Open') || textEntered) {
      this.openFileAndClose();
    }
    ImGui.SameLine();
    if (ImGui.Button('Cancel')) {
      this._renderer.off('selection_changed', this.updateSelection, this);
      this._renderer.dispose();
      this.close('');
    }
    if (this._error) {
      ImGui.SameLine();
      ImGui.TextColored(new ImGui.ImVec4(0.85, 0.0, 0.0, 1.0), this._error);
    }
  }
  private async openFileAndClose() {
    if (!this._name[0]) {
      this._error = 'No file selected';
      return;
    }
    this._error = '';
    if (this._renderer.selectedDir && !/[\\/?*]/.test(this._name[0])) {
      const name = this._renderer.VFS.join(this._renderer.selectedDir.path, this._name[0]);
      const exists = await this._renderer.VFS.exists(name);
      if (exists) {
        const stat = await this._renderer.VFS.stat(name);
        if (stat.isFile) {
          this._renderer.off('selection_changed', this.updateSelection, this);
          this._renderer.dispose();
          this.close(name);
        }
      }
    }
    this._error = 'File not exists';
  }
}
