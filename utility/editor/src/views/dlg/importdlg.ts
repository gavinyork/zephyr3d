import { ImGui } from '@zephyr3d/imgui';
import { DialogRenderer } from '../../components/modal';
import type { VFS } from '@zephyr3d/base';

export class DlgImport extends DialogRenderer<{
  op: string;
  paths?: string[];
  rebuildPrefab?: boolean;
  rebuildMaterial?: boolean;
  sourceReference?: boolean;
}> {
  protected _vfs: VFS;
  protected _op: [number];
  protected _paths: string[];
  protected _selected: [boolean][];
  protected _rebuildPrefab: [boolean];
  protected _rebuildMaterial: [boolean];
  protected _sourceReference: [boolean];
  protected _msg: string;
  public static promptImport(title: string, vfs: VFS, width?: number, height?: number) {
    return new DlgImport(`${title}##Dialog`, vfs, width, height).showModal();
  }
  constructor(id: string, vfs: VFS, width?: number, height?: number) {
    super(id ?? 'MessageBox', width ?? 300, height ?? 0);
    this._vfs = vfs;
    this._op = [0];
    this._paths = null;
    this._selected = null;
    this._rebuildPrefab = [false];
    this._rebuildMaterial = [false];
    this._sourceReference = [false];
  }
  doRender(): void {
    ImGui.RadioButton('Copy to project', this._op, 0);
    ImGui.SameLine();
    ImGui.RadioButton('Import as Prefab', this._op, 1);
    if (this._op[0] === 1) {
      if (this._paths === null) {
        this._msg = 'Searching for importable files...';
        this._paths = [];
        this._selected = [];
        this._vfs.glob('/**/*.{gltf,glb,vrm,fbx}', { recursive: true, includeDirs: false }).then((files) => {
          for (const f of files) {
            this._paths.push(f.path);
            this._selected.push([true]);
          }
          if (this._paths.length === 0) {
            this._msg = 'No importable files found.';
          } else {
            this._msg = '';
          }
        });
      }
      ImGui.Separator();
      if (this._msg) {
        ImGui.TextDisabled(this._msg);
      } else {
        if (this._paths.length > 0) {
          for (let i = 0; i < this._paths.length; i++) {
            ImGui.PushID(i);
            ImGui.Checkbox(this._paths[i], this._selected[i]);
            ImGui.PopID();
          }
        }
      }
      ImGui.Separator();
      ImGui.Checkbox('Rebuild prefab', this._rebuildPrefab);
      ImGui.Checkbox('Rebuild material', this._rebuildMaterial);
      ImGui.Checkbox('Source Reference', this._sourceReference);
    }
    ImGui.Separator();
    if (ImGui.Button('OK')) {
      this.close({
        op: this._op[0] === 0 ? 'copy' : 'import',
        paths: this._op[0] === 1 ? this._paths.filter((v, i) => this._selected[i][0]) : null,
        rebuildPrefab: this._op[0] === 1 ? this._rebuildPrefab[0] : false,
        rebuildMaterial: this._op[0] === 1 ? this._rebuildMaterial[0] : false,
        sourceReference: this._op[0] === 1 ? this._sourceReference[0] : false
      });
    }
    ImGui.SameLine();
    if (ImGui.Button('Cancel')) {
      this.close(null);
    }
  }
}
