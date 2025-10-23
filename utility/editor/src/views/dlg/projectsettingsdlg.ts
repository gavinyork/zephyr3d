import { ImGui, imGuiCalcTextSize } from '@zephyr3d/imgui';
import { DialogRenderer } from '../../components/modal';
import { type ProjectSettings, type ProjectInfo } from '../../core/services/project';
import { DlgOpenFile } from './openfiledlg';
import type { VFS } from '@zephyr3d/base';
import { renderMultiSelectedCombo } from '../../components/multicombo';

export class DlgProjectSettings extends DialogRenderer<ProjectSettings> {
  private _vfs: VFS;
  private _info: ProjectInfo;
  private _settings: ProjectSettings;
  private _selectedDep: [number];
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
    this._selectedDep = [-1];
  }
  doRender(): void {
    const title = [this._settings.title ?? this._info.name] as [string];
    if (ImGui.InputText('Title', title, undefined, ImGui.InputTextFlags.None)) {
      this._settings.title = title[0];
    }
    const favicon = [this._settings.favicon ?? ''] as [string];
    if (ImGui.InputText('Favicon', favicon, undefined, ImGui.InputTextFlags.None)) {
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
          500,
          400
        ).then((value) => {
          if (value) {
            this._settings.favicon = value;
          }
        });
      }
    }
    const splashScreen = [this._settings.splashScreen ?? ''] as [string];
    if (ImGui.InputText('Splash Screen', splashScreen, undefined, ImGui.InputTextFlags.None)) {
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
          '/assets',
          'Scene (*.zscn)|*.zscn',
          500,
          400
        ).then((value) => {
          if (value) {
            this._settings.startupScene = value;
          }
        });
      }
    }
    const startupScript = [this._settings.startupScript ?? ''] as [string];
    if (ImGui.InputText('Startup Script', startupScript, undefined, ImGui.InputTextFlags.None)) {
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
          500,
          400
        ).then((value) => {
          if (value) {
            this._settings.startupScript = value;
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
    if (ImGui.BeginChild('ListBox', new ImGui.ImVec2(0, 100), true)) {
      ImGui.TextDisabled('Additional packages');
      if (this._selectedDep[0] >= 0) {
        ImGui.SameLine();
        const buttonTextRemove = 'Remove';
        const spacing = ImGui.GetStyle().ItemSpacing.x;
        const padding = ImGui.GetStyle().FramePadding.x;
        const totalWidth = imGuiCalcTextSize(buttonTextRemove).x + 2 * padding + spacing;
        const offset = ImGui.GetContentRegionAvail().x - totalWidth;
        ImGui.SetCursorPosX(ImGui.GetCursorPosX() + offset);
        if (ImGui.Button('Remove')) {
          console.log('Remove package');
        }
      }
      if (ImGui.ListBoxHeader('ListBoxHeader', new ImGui.ImVec2(-1, -1))) {
        if (this._settings.dependencies?.length > 0) {
          for (let i = 0; i < this._settings.dependencies.length; i++) {
            if (ImGui.Selectable(this._settings.dependencies[i], this._selectedDep[0] === i)) {
              this._selectedDep[0] = i;
            }
            /*
            if (ImGui.IsItemClicked(ImGui.MouseButton.Right)) {
              ImGui.OpenPopup(`##${this._settings.dependencies[i]}`);
            }
            if (ImGui.BeginPopup(`##${this._settings.dependencies[i]}`)) {
              if (ImGui.MenuItem('Remove')) {
                console.log(`Remove dependence: ${this._settings.dependencies[i]}`);
              }
              ImGui.EndPopup();
            }
            */
          }
        }
        ImGui.ListBoxFooter();
      }
    }
    ImGui.EndChild();

    ImGui.Button('Save');
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
