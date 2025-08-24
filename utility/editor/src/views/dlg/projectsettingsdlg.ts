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
    if (ImGui.Button('SplashScreen')) {
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
    ImGui.SameLine();
    if (ImGui.Button('Clear')) {
      this._info.splashScreen = '';
    }
    ImGui.SameLine();
    ImGui.TextUnformatted(this._info.splashScreen ?? '');

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
    if (renderMultiSelectedCombo('RHI', items, -1)) {
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
