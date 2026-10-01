import { ImGui } from '@zephyr3d/imgui';
import { DerivedTextureService } from '../../core/services/derivedtextures';
import type { DerivedTextureStatus } from '../../core/services/derivedtextures';
import type { VFS } from '@zephyr3d/base';
import type {
  TextureCompression,
  TextureImportSettings,
  TextureQuality,
  TextureUsage
} from '@zephyr3d/scene';
import {
  isSRGBTextureUsage,
  readTextureImportSettings,
  resolveTextureCompression,
  writeTextureImportSettings
} from '@zephyr3d/scene';
import { DialogRenderer } from '../../components/modal';
import { DlgMessage } from './messagedlg';

const USAGES: { value: TextureUsage; label: string }[] = [
  { value: 'color', label: 'Color (sRGB)' },
  { value: 'normal', label: 'Normal Map' },
  { value: 'mask', label: 'Mask / Linear Data' },
  { value: 'hdr', label: 'HDR' },
  { value: 'ui', label: 'UI (uncompressed)' }
];
const COMPRESSIONS: { value: TextureCompression; label: string }[] = [
  { value: 'auto', label: 'Auto (by usage)' },
  { value: 'etc1s', label: 'ETC1S (smallest)' },
  { value: 'uastc', label: 'UASTC (highest quality)' },
  { value: 'none', label: 'None' }
];
const QUALITIES: { value: TextureQuality; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'High' }
];
const MAX_SIZES = [0, 4096, 2048, 1024, 512, 256, 128];

type SettingKey = keyof TextureImportSettings;

/**
 * Edits the `.zmeta` import settings of one or more textures.
 *
 * With several textures selected the dialog shows the first one's settings and
 * writes back only the fields the user changed, so a batch edit of, say, the max
 * size leaves each texture's own usage alone.
 */
export class DlgTextureSettings extends DialogRenderer<boolean> {
  private readonly _vfs: VFS;
  private readonly _paths: string[];
  private _settings: TextureImportSettings[] | null;
  private readonly _edited: Partial<TextureImportSettings>;
  private readonly _changed: Set<SettingKey>;
  private _saving: boolean;
  private _status: DerivedTextureStatus | null;
  private _statusTime: number;
  static async editTextureSettings(vfs: VFS, paths: string[]) {
    return new DlgTextureSettings(vfs, paths).showModal();
  }
  constructor(vfs: VFS, paths: string[]) {
    super(`Texture Settings##TextureSettingsDlg`, 420, 0);
    this._vfs = vfs;
    this._paths = paths;
    this._settings = null;
    this._edited = {};
    this._changed = new Set();
    this._saving = false;
    this._status = null;
    this._statusTime = 0;
    Promise.all(paths.map((path) => readTextureImportSettings(vfs, path))).then(
      (settings) => {
        this._settings = settings;
        Object.assign(this._edited, settings[0]);
      },
      (err) => {
        DlgMessage.messageBox('Error', `Failed to read texture settings: ${err}`);
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
  doRender(): void {
    if (!this._settings) {
      ImGui.Text('Loading...');
      return;
    }
    if (this._paths.length === 1) {
      ImGui.TextUnformatted(this._paths[0]);
    } else {
      ImGui.TextUnformatted(`${this._paths.length} textures, showing ${this._paths[0]}`);
      ImGui.TextDisabled('Only the fields you change are applied to every texture.');
    }
    ImGui.Separator();
    this.combo('Usage', 'usage', USAGES);
    this.combo('Compression', 'compression', COMPRESSIONS);
    this.combo('Quality', 'quality', QUALITIES);
    this.combo(
      'Max Size',
      'maxSize',
      MAX_SIZES.map((size) => ({ value: size, label: size === 0 ? 'Source size' : `${size}` }))
    );
    const mipmaps = [!!this._edited.mipmaps] as [boolean];
    if (ImGui.Checkbox('Generate Mipmaps', mipmaps)) {
      this._edited.mipmaps = mipmaps[0];
      this._changed.add('mipmaps');
    }
    ImGui.Separator();
    const effective = this._edited as TextureImportSettings;
    const encoding = resolveTextureCompression(effective);
    ImGui.TextDisabled(
      `Ships as: ${encoding === 'none' ? 'uncompressed' : encoding.toUpperCase()}, ${
        isSRGBTextureUsage(effective.usage) ? 'sRGB' : 'linear'
      }`
    );
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
  /** Derived copy state of the first texture, as saved; refreshed about once a second */
  private renderStatus() {
    const now = performance.now();
    if (now - this._statusTime > 1000) {
      this._statusTime = now;
      DerivedTextureService.getStatus(this._paths[0]).then(
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
          `Compressed copy: ${kb(status.sourceSize)} -> ${kb(status.derivedSize)}, ${
            status.loaded ? 'in use in the editor' : 'not loaded yet (reopen the scene to use it)'
          }`
        );
        break;
      case 'pending':
        ImGui.TextDisabled('Compressed copy: queued');
        break;
      case 'failed':
        ImGui.TextColored(new ImGui.ImVec4(0.9, 0.35, 0.3, 1), `Compression failed: ${status.error ?? ''}`);
        break;
      case 'uncompressed':
        ImGui.TextDisabled('Compressed copy: none, the source image is used');
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
        await writeTextureImportSettings(this._vfs, this._paths[i], next);
        DerivedTextureService.request(this._paths[i]);
      }
      this.close(true);
    } catch (err) {
      this._saving = false;
      DlgMessage.messageBox('Error', `Failed to save texture settings: ${err}`);
    }
  }
}
