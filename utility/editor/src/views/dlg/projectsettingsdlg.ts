import { ImGui } from '@zephyr3d/imgui';
import { DialogRenderer } from '../../components/modal';
import type { ProjectSettings, ProjectInfo } from '../../core/services/project';
import { DlgOpenFile } from './openfiledlg';
import type { VFS } from '@zephyr3d/base';
import { renderMultiSelectedCombo } from '../../components/multicombo';

export class DlgProjectSettings extends DialogRenderer<ProjectSettings> {
  private _vfs: VFS;
  private _info: ProjectInfo;
  private _settings: ProjectSettings;
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
  }
  doRender(): void {
    const splashScreen = [this._settings.splashScreen ?? ''] as [string];
    if (ImGui.InputText('Splash Screen', splashScreen, undefined, ImGui.InputTextFlags.None)) {
      this._settings.splashScreen = splashScreen[0];
    }
    if (ImGui.IsItemHovered()) {
      ImGui.SetTooltip('Double click to select file');
      if (ImGui.IsMouseDoubleClicked(0)) {
        DlgOpenFile.openFile(
          'Select Image File',
          this._vfs,
          this._info,
          'Image (*.jpg;*.png;*.tga;*.dds)|*.jpg;*.jpeg;*.png;*.tga;*.dds',
          500,
          400
        ).then((value) => {
          if (value) {
            this._settings.splashScreen = value;
          }
        });
      }
    }
    const startupScene = [this._settings.startupScene ?? ''] as [string];
    if (ImGui.InputText('Startup Scene', startupScene, undefined, ImGui.InputTextFlags.None)) {
      this._settings.startupScene = startupScene[0];
    }
    if (ImGui.IsItemHovered()) {
      ImGui.SetTooltip('Double click to select file');
      if (ImGui.IsMouseDoubleClicked(0)) {
        DlgOpenFile.openFile(
          'Select Scene File',
          this._vfs,
          this._info,
          'Scene (*.scn)|*.scn',
          500,
          400
        ).then((value) => {
          if (value) {
            this._settings.startupScene = value;
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
        } else {
          return selected.join(';');
        }
      })
    ) {
      this._settings.preferredRHI = items.filter((val) => val.selected).map((val) => val.text);
    }
    ImGui.Button('Ok');
    if (ImGui.IsItemHovered() && ImGui.IsMouseReleased(0)) {
      this.close(this._settings);
    }
    ImGui.SameLine();
    ImGui.Button('Cancel');
    if (ImGui.IsItemHovered() && ImGui.IsMouseReleased(0)) {
      this.close(null);
    }
  }
}
