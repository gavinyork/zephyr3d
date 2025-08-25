import { ImGui } from '@zephyr3d/imgui';
import { DialogRenderer } from '../../components/modal';
import { ProjectInfo } from '../../core/services/project';
import { DlgOpenFile } from './openfiledlg';
import { VFS } from '@zephyr3d/base';
import { renderMultiSelectedCombo } from '../../components/multicombo';

export class DlgProjectSettings extends DialogRenderer<ProjectInfo> {
  private _vfs: VFS;
  private _info: ProjectInfo;
  public static async editProjectSettings(
    title: string,
    vfs: VFS,
    projectInfo: ProjectInfo,
    width?: number
  ): Promise<ProjectInfo> {
    return new DlgProjectSettings(title, vfs, projectInfo, width).showModal();
  }
  constructor(id: string, vfs: VFS, projectInfo: ProjectInfo, width = 300) {
    super(id, width, 0, true, true);
    this._vfs = vfs;
    this._info = { ...projectInfo };
  }
  doRender(): void {
    const name = [this._info.name] as [string];
    if (ImGui.InputText('Project Name', name, undefined, ImGui.InputTextFlags.AutoSelectAll)) {
      this._info.name = name[0];
    }
    const splashScreen = [this._info.splashScreen ?? ''] as [string];
    if (ImGui.InputText('Splash Screen', splashScreen, undefined, ImGui.InputTextFlags.None)) {
      this._info.splashScreen = splashScreen[0];
    }
    if (ImGui.IsItemHovered()) {
      ImGui.SetTooltip('Double click to select file');
      if (ImGui.IsMouseDoubleClicked(0)) {
        DlgOpenFile.openFile(
          'Select Image File',
          this._vfs,
          this._info,
          'Image|*.jpg;*.jpeg;*.png;*.tga;*.dds',
          500,
          400
        ).then((value) => {
          if (value) {
            this._info.splashScreen = value;
          }
        });
      }
    }
    const startupScene = [this._info.startupScene ?? ''] as [string];
    if (ImGui.InputText('Startup Scene', startupScene, undefined, ImGui.InputTextFlags.None)) {
      this._info.startupScene = startupScene[0];
    }
    if (ImGui.IsItemHovered()) {
      ImGui.SetTooltip('Double click to select file');
      if (ImGui.IsMouseDoubleClicked(0)) {
        DlgOpenFile.openFile('Select Scene File', this._vfs, this._info, 'Scene|*.scn', 500, 400).then(
          (value) => {
            if (value) {
              this._info.startupScene = value;
            }
          }
        );
      }
    }
    const items = [
      {
        text: 'WebGL',
        selected: !!this._info.preferredRHI?.includes('WebGL')
      },
      {
        text: 'WebGL2',
        selected: !!this._info.preferredRHI?.includes('WebGL2')
      },
      {
        text: 'WebGPU',
        selected: !!this._info.preferredRHI?.includes('WebGPU')
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
      this._info.preferredRHI = items.filter((val) => val.selected).map((val) => val.text);
    }
    ImGui.Button('Ok');
    if (ImGui.IsItemHovered() && ImGui.IsMouseReleased(0)) {
      this.close(this._info);
    }
    ImGui.SameLine();
    ImGui.Button('Cancel');
    if (ImGui.IsItemHovered() && ImGui.IsMouseReleased(0)) {
      this.close(null);
    }
  }
}
