import { ImGui } from '@zephyr3d/imgui';
import { DerivedAssetService } from '../../core/services/derivedassets';
import type { DerivedAssetStatus } from '../../core/services/derivedassets';
import type { VFS } from '@zephyr3d/base';
import type { MeshCompression, MeshImportSettings } from '@zephyr3d/scene';
import { getMeshLodTargets, readMeshImportSettings, writeMeshImportSettings } from '@zephyr3d/scene';
import { DialogRenderer } from '../../components/modal';
import { DlgMessage } from './messagedlg';

const COMPRESSIONS: { value: MeshCompression; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'meshopt', label: 'meshopt (quantized)' }
];
const NORMAL_BITS: { value: MeshImportSettings['normalBits']; label: string }[] = [
  { value: 12, label: '12 bit (recommended)' },
  { value: 8, label: '8 bit (smallest, visible on smooth surfaces)' },
  { value: 16, label: '16 bit' },
  { value: 0, label: 'Keep float' }
];

type SettingKey = keyof MeshImportSettings;

/**
 * Edits the `.zmeta` import settings of one or more meshes (.zmsh). Like the
 * texture settings dialog, a batch edit writes back only the fields changed.
 */
export class DlgMeshSettings extends DialogRenderer<boolean> {
  private readonly _vfs: VFS;
  private readonly _paths: string[];
  private _settings: MeshImportSettings[] | null;
  private readonly _edited: Partial<MeshImportSettings>;
  private readonly _changed: Set<SettingKey>;
  private _saving: boolean;
  private _status: DerivedAssetStatus | null;
  private _statusTime: number;
  static async editMeshSettings(vfs: VFS, paths: string[]) {
    return new DlgMeshSettings(vfs, paths).showModal();
  }
  constructor(vfs: VFS, paths: string[]) {
    super(`Mesh Settings##MeshSettingsDlg`, 420, 0);
    this._vfs = vfs;
    this._paths = paths;
    this._settings = null;
    this._edited = {};
    this._changed = new Set();
    this._saving = false;
    this._status = null;
    this._statusTime = 0;
    Promise.all(paths.map((path) => readMeshImportSettings(vfs, path))).then(
      (settings) => {
        this._settings = settings;
        Object.assign(this._edited, settings[0]);
      },
      (err) => {
        DlgMessage.messageBox('Error', `Failed to read mesh settings: ${err}`);
        this.close(false);
      }
    );
  }
  private combo<T>(label: string, key: SettingKey, items: { value: T; label: string }[]) {
    const current = this._edited[key] as T;
    const index = [
      Math.max(
        0,
        items.findIndex((item) => item.value === current)
      )
    ] as [number];
    if (
      ImGui.Combo(
        label,
        index,
        items.map((item) => item.label)
      )
    ) {
      (this._edited as Record<string, unknown>)[key] = items[index[0]].value;
      this._changed.add(key);
    }
  }
  private checkbox(label: string, key: 'lodEnabled') {
    const value = [!!this._edited[key]] as [boolean];
    if (ImGui.Checkbox(label, value)) {
      this._edited[key] = value[0];
      this._changed.add(key);
    }
  }
  private inputInt(label: string, key: 'lodMinTriangles', min: number) {
    const value = [this._edited[key] ?? min] as [number];
    if (ImGui.InputInt(label, value, 10, 100)) {
      this._edited[key] = Math.max(value[0], min);
      this._changed.add(key);
    }
  }
  private sliderFloat(
    label: string,
    key: 'lodReduction' | 'lodPixelError',
    min: number,
    max: number,
    format: string
  ) {
    const value = [this._edited[key] ?? min] as [number];
    if (ImGui.SliderFloat(label, value, min, max, format)) {
      this._edited[key] = value[0];
      this._changed.add(key);
    }
  }
  doRender(): void {
    if (!this._settings) {
      ImGui.Text('Loading...');
      return;
    }
    if (this._paths.length === 1) {
      ImGui.TextUnformatted(this._paths[0]);
    } else {
      ImGui.TextUnformatted(`${this._paths.length} meshes, showing ${this._paths[0]}`);
      ImGui.TextDisabled('Only the fields you change are applied to every mesh.');
    }
    ImGui.Separator();
    this.combo('Compression', 'compression', COMPRESSIONS);
    if (this._edited.compression === 'meshopt') {
      this.combo('Normal Precision', 'normalBits', NORMAL_BITS);
      ImGui.TextDisabled('Positions, texture coordinates and vertex order are kept exactly.');
    }
    ImGui.Separator();
    this.checkbox('Generate LODs', 'lodEnabled');
    if (this._edited.lodEnabled) {
      this.inputInt('Min Triangles', 'lodMinTriangles', 1);
      this.sliderFloat('Triangles Per Level', 'lodReduction', 0.1, 0.9, '%.2f');
      this.sliderFloat('Pixel Error', 'lodPixelError', 1, 32, '%.1f');
      ImGui.TextDisabled("Each level keeps that fraction of the previous level's triangles;");
      ImGui.TextDisabled('levels stop before one would have fewer than Min Triangles.');
      ImGui.TextDisabled('A level shows once its error looks smaller than Pixel Error on screen;');
      ImGui.TextDisabled('higher values switch to simpler levels closer to the camera.');
      this.renderLodEstimate();
    }
    this.renderStatus();
    ImGui.Separator();
    if (this._saving) {
      ImGui.TextDisabled('Saving...');
      return;
    }
    if (ImGui.Button('OK')) {
      void this.save();
    }
    ImGui.SameLine();
    if (ImGui.Button('Cancel')) {
      this.close(false);
    }
  }
  /** Levels the edited settings would give the first mesh, from its source triangle count */
  private renderLodEstimate() {
    const triangles = this._status?.sourceTriangles;
    if (triangles === undefined) {
      return;
    }
    if (triangles === 0) {
      ImGui.TextDisabled('Only triangle meshes get levels of detail.');
      return;
    }
    const targets = getMeshLodTargets(triangles, {
      lodEnabled: true,
      lodMinTriangles: this._edited.lodMinTriangles ?? 1,
      lodReduction: this._edited.lodReduction ?? 0.5
    });
    if (targets.length <= 1) {
      ImGui.TextDisabled(`Source has ${triangles} triangles: too few for any level, none is made.`);
    } else {
      ImGui.TextDisabled(`Up to ${targets.length} levels, triangles: ${targets.join(', ')}`);
    }
  }
  /** Derived copy state of the first mesh, as saved; refreshed about once a second */
  private renderStatus() {
    const now = performance.now();
    if (now - this._statusTime > 1000) {
      this._statusTime = now;
      DerivedAssetService.getStatus(this._paths[0]).then(
        (status) => (this._status = status),
        () => (this._status = null)
      );
    }
    const status = this._status;
    if (!status) {
      return;
    }
    const kb = (n = 0) => `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
    switch (status.state) {
      case 'ready':
        ImGui.TextDisabled(
          `Derived copy: ${kb(status.sourceSize)} -> ${kb(status.derivedSize)}, ${
            status.loaded ? 'in use in the editor' : 'not loaded yet (reopen the scene to use it)'
          }`
        );
        if ((status.lodLevels ?? 1) > 1) {
          ImGui.TextDisabled(`Levels of detail made: ${status.lodLevels}`);
        }
        break;
      case 'pending':
        ImGui.TextDisabled('Derived copy: queued');
        break;
      case 'failed':
        ImGui.TextColored(new ImGui.ImVec4(0.9, 0.35, 0.3, 1), `Processing failed: ${status.error ?? ''}`);
        break;
      case 'uncompressed':
        ImGui.TextDisabled('Derived copy: none, the source mesh is used');
        break;
    }
  }
  private async save() {
    if (this._changed.size === 0) {
      this.close(false);
      return;
    }
    this._saving = true;
    try {
      for (let i = 0; i < this._paths.length; i++) {
        const next = { ...this._settings![i] };
        for (const key of this._changed) {
          (next as Record<string, unknown>)[key] = this._edited[key];
        }
        await writeMeshImportSettings(this._vfs, this._paths[i], next);
        DerivedAssetService.request(this._paths[i]);
      }
      this.close(true);
    } catch (err) {
      this._saving = false;
      DlgMessage.messageBox('Error', `Failed to save mesh settings: ${err}`);
    }
  }
}
