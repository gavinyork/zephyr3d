import type { VFS } from '@zephyr3d/base';
import { ImGui } from '@zephyr3d/imgui';
import { ListView, ListViewData } from '../../components/listview';
import { renderMultiSelectedCombo } from '../../components/multicombo';
import { DialogRenderer } from '../../components/modal';
import { libDir } from '../../core/build/templates';
import { type ProjectInfo, type ProjectSettings, ProjectService } from '../../core/services/project';
import { DlgOpenFile } from './openfiledlg';
import { customTextInput } from '../../components/textinput';

class DepsContentData extends ListViewData<{ name: string; version: string }> {
  elements: { name: string; version: string }[];

  constructor(deps: { [name: string]: string }) {
    super();
    this.elements = Object.keys(deps).map((k) => ({ name: k, version: deps[k] }));
  }

  getItems() {
    return this.elements;
  }

  getItemIcon(): string {
    return '馃摝';
  }

  getItemName(item: { name: string; version: string }): string {
    return item.name;
  }

  getDetailColumn(item: { name: string; version: string }): string {
    return item.version;
  }

  getDetailColumnsInfo(): string[] {
    return ['Version'];
  }

  sortDetailItems(
    a: { name: string; version: string },
    b: { name: string; version: string },
    sortBy: number,
    sortAscending: boolean
  ): number {
    let comparison = 0;
    switch (sortBy) {
      case 0:
        comparison = a.name.localeCompare(b.name);
        break;
      case 1:
        comparison = a.version.localeCompare(b.version);
        break;
      default:
        break;
    }
    return sortAscending ? comparison : -comparison;
  }

  getDragSourcePayloadType(): string {
    return '';
  }

  getDragSourceHint(): string {
    return '';
  }

  getDragSourcePayload(): unknown {
    return null;
  }

  getDragTargetPayloadType(): string {
    return null;
  }
}

export class DepsListView extends ListView<{}, { name: string; version: string }> {
  constructor(data: DepsContentData) {
    super('##ProjectDepsList', data, false);
  }

  protected onSelectionChanged(): void {}

  protected onItemContextMenu(): void {
    if (ImGui.MenuItem('Remove')) {
      const item = [...this.selectedItems][0];
      const data = this.data as DepsContentData;
      const index = data.elements.indexOf(item);
      if (index >= 0) {
        data.elements.splice(index, 1);
      }
    }
  }
}

export class DlgProjectSettings extends DialogRenderer<ProjectSettings> {
  private static readonly RENDER_SCALE_ITEMS = [0, 1, 1.25, 1.5, 2];
  private static readonly RENDER_SCALE_LABELS = ['System', '1.0', '1.25', '1.5', '2.0'];
  private _vfs: VFS;
  private _info: ProjectInfo;
  private _settings: ProjectSettings;
  private _depList: DepsListView;

  public static async editProjectSettings(
    title: string,
    vfs: VFS,
    projectInfo: ProjectInfo,
    projectSettings: ProjectSettings,
    width?: number
  ): Promise<ProjectSettings> {
    return new DlgProjectSettings(title, vfs, projectInfo, projectSettings, width).showModal();
  }

  constructor(id: string, vfs: VFS, projectInfo: ProjectInfo, projectSettings: ProjectSettings, width = 300) {
    super(id, width, 0, true, true);
    this._vfs = vfs;
    this._info = { ...projectInfo };
    this._settings = { ...projectSettings };
    this._depList = new DepsListView(new DepsContentData(this._settings.dependencies ?? {}));
    this._depList.type = 'detail';
  }

  doRender(): void {
    const title = [this._settings.title ?? this._info.name] as [string];
    if (customTextInput('Title', title)) {
      this._settings.title = title[0];
    }

    const favicon = [this._settings.favicon ?? ''] as [string];
    if (customTextInput('Favicon', favicon)) {
      this._settings.favicon = favicon[0];
    }
    if (ImGui.IsItemHovered()) {
      ImGui.SetTooltip('Double click to select icon');
      if (ImGui.IsMouseDoubleClicked(0)) {
        DlgOpenFile.openFile(
          'Select Image File',
          this._vfs,
          '/assets',
          'Image (*.ico;*.jpg;*.png;*.webp)|*.ico;*.jpg;*.png;*.webp',
          false,
          500,
          400
        ).then((value) => {
          if (value.length > 0) {
            this._settings.favicon = value[0].meta.path;
          }
        });
      }
    }

    const splashScreen = [this._settings.splashScreen ?? ''] as [string];
    if (customTextInput('Splash Screen', splashScreen)) {
      this._settings.splashScreen = splashScreen[0];
    }
    if (ImGui.IsItemHovered()) {
      ImGui.SetTooltip('Double click to select file');
      if (ImGui.IsMouseDoubleClicked(0)) {
        DlgOpenFile.openFile(
          'Select Scene File',
          this._vfs,
          '/assets',
          'Scene (*.zscn)|*.zscn',
          false,
          500,
          400
        ).then((value) => {
          if (value.length > 0) {
            this._settings.splashScreen = value[0].meta.path;
          }
        });
      }
    }

    const startupScene = [this._settings.startupScene ?? ''] as [string];
    if (customTextInput('Startup Scene', startupScene)) {
      this._settings.startupScene = startupScene[0];
    }
    if (ImGui.IsItemHovered()) {
      ImGui.SetTooltip('Double click to select file');
      if (ImGui.IsMouseDoubleClicked(0)) {
        DlgOpenFile.openFile(
          'Select Scene File',
          this._vfs,
          '/assets',
          'Scene (*.zscn)|*.zscn',
          false,
          500,
          400
        ).then((value) => {
          if (value.length > 0) {
            this._settings.startupScene = value[0].meta.path;
          }
        });
      }
    }

    const startupScript = [this._settings.startupScript ?? ''] as [string];
    if (customTextInput('Startup Script', startupScript)) {
      this._settings.startupScript = startupScript[0];
    }
    if (ImGui.IsItemHovered()) {
      ImGui.SetTooltip('Double click to select file');
      if (ImGui.IsMouseDoubleClicked(0)) {
        DlgOpenFile.openFile(
          'Select Script File',
          this._vfs,
          '/assets',
          'Script file (*.ts;*.js)|*.ts;*.js',
          false,
          500,
          400
        ).then((value) => {
          if (value.length > 0) {
            this._settings.startupScript = value[0].meta.path;
          }
        });
      }
    }

    const items = [
      {
        text: 'WebGL',
        selected: !!this._settings.preferredRHI?.includes('WebGL')
      },
      {
        text: 'WebGL2',
        selected: !!this._settings.preferredRHI?.includes('WebGL2')
      },
      {
        text: 'WebGPU',
        selected: !!this._settings.preferredRHI?.includes('WebGPU')
      }
    ];
    if (
      renderMultiSelectedCombo('##RHI', 'Targeted RHIs', items, (selected) => {
        if (selected.length === 0) {
          return 'Please select target RHI...';
        }
        return selected.join(';');
      })
    ) {
      this._settings.preferredRHI = items.filter((val) => val.selected).map((val) => val.text);
    }

    const enableMSAA = [!!this._settings.enableMSAA] as [boolean];
    if (ImGui.Checkbox('Enable MSAA', enableMSAA)) {
      this._settings.enableMSAA = enableMSAA[0];
    }

    let renderScaleIndex = DlgProjectSettings.RENDER_SCALE_ITEMS.findIndex(
      (val) => Math.abs(val - (this._settings.renderScale ?? 1)) < 1e-6
    );
    if (renderScaleIndex < 0) {
      renderScaleIndex = 0;
    }
    const selectedRenderScaleIndex = [renderScaleIndex] as [number];
    if (ImGui.Combo('Render Scale', selectedRenderScaleIndex, DlgProjectSettings.RENDER_SCALE_LABELS)) {
      this._settings.renderScale = DlgProjectSettings.RENDER_SCALE_ITEMS[selectedRenderScaleIndex[0]];
    }

    if (ImGui.BeginChild('ListBox', new ImGui.ImVec2(0, 100), true)) {
      ImGui.TextDisabled('Additional packages');
      this._depList.render();
    }
    ImGui.EndChild();

    ImGui.Button('Save');
    if (ImGui.IsItemHovered() && ImGui.IsMouseReleased(0)) {
      this.removePackages().then(() => {
        this.close(this._settings);
      });
    }
    ImGui.SameLine();
    ImGui.Button('Cancel');
    if (ImGui.IsItemHovered() && ImGui.IsMouseReleased(0)) {
      this.close(null);
    }
  }

  async removePackages() {
    if (this._settings.dependencies) {
      const lockFile = (await ProjectService.VFS.readFile(`/${libDir}/deps.lock.json`, {
        encoding: 'utf8'
      })) as string;
      const lock = JSON.parse(lockFile) as {
        dependencies: {
          [name: string]: {
            version: string;
            entry: string;
            url: string;
          };
        };
      };
      const newPackages = this._depList.data.getItems();
      let removed = false;
      for (const k of Object.keys(this._settings.dependencies)) {
        if (newPackages.findIndex((p) => p.name === k) < 0) {
          const dir = `/${libDir}/deps/${k}@${this._settings.dependencies[k]}`;
          await ProjectService.VFS.deleteDirectory(dir, true);
          delete this._settings.dependencies[k];
          delete lock.dependencies[k];
          removed = true;
        }
      }
      if (removed) {
        if (Object.keys(this._settings.dependencies).length === 0) {
          await ProjectService.VFS.deleteDirectory(`/${libDir}/deps`, true);
          await ProjectService.VFS.deleteFile(`/${libDir}/deps.lock.json`);
        } else {
          await ProjectService.VFS.writeFile(`/${libDir}/deps.lock.json`, JSON.stringify(lock, null, 2), {
            encoding: 'utf8',
            create: true
          });
        }
      }
    }
  }
}
