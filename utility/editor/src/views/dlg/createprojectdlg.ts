import { ImGui, imGuiCalcTextSize } from '@zephyr3d/imgui';
import { DialogRenderer } from '../../components/modal';
import { getDesktopAPI } from '../../core/services/desktop';

export type CreateProjectResult = {
  name: string;
  directory: string;
};

export class DlgCreateProject extends DialogRenderer<CreateProjectResult | null> {
  private readonly _name: [string];
  private readonly _directory: [string];
  private _firstOpen: boolean;
  private _pickingDirectory: boolean;

  public static async createProject(
    title: string,
    defaultName?: string,
    defaultDirectory?: string,
    width?: number
  ): Promise<CreateProjectResult | null> {
    return new DlgCreateProject(title, defaultName, defaultDirectory, width).showModal();
  }

  constructor(id: string, defaultName = '', defaultDirectory = '', width = 560) {
    super(id, width, 0, true, true);
    this._name = [defaultName];
    this._directory = [defaultDirectory];
    this._firstOpen = true;
    this._pickingDirectory = false;
  }

  doRender(): void {
    if (this._firstOpen) {
      ImGui.SetKeyboardFocusHere();
      this._firstOpen = false;
    }

    ImGui.PushItemWidth(ImGui.GetContentRegionAvail().x);
    ImGui.InputTextWithHint('##ProjectName', 'Enter project name', this._name, undefined);
    ImGui.PopItemWidth();

    const btnWidth = imGuiCalcTextSize('...').x + ImGui.GetStyle().FramePadding.x * 2;
    ImGui.PushItemWidth(ImGui.GetContentRegionAvail().x - btnWidth - ImGui.GetStyle().ItemSpacing.x);
    ImGui.InputTextWithHint(
      '##ProjectDirectory',
      'Select or enter a project directory',
      this._directory,
      undefined
    );
    ImGui.PopItemWidth();
    ImGui.SameLine();
    if (ImGui.Button('...', new ImGui.ImVec2(btnWidth, 0))) {
      this.pickDirectory();
    }

    const canCreate = !!this._name[0].trim() && !!this._directory[0].trim();
    if (ImGui.Button('Create') && canCreate) {
      this.close({
        name: this._name[0].trim(),
        directory: this._directory[0].trim()
      });
    }
    ImGui.SameLine();
    if (ImGui.Button('Cancel')) {
      this.close(null);
    }
  }

  private pickDirectory() {
    const desktop = getDesktopAPI();
    if (!desktop?.fs?.pickDirectory || this._pickingDirectory) {
      return;
    }
    this._pickingDirectory = true;
    desktop.fs
      .pickDirectory({
        title: 'Select Project Directory',
        defaultPath: this._directory[0] || undefined,
        buttonLabel: 'Select Folder'
      })
      .then((directory) => {
        if (directory) {
          this._directory[0] = directory;
        }
      })
      .finally(() => {
        this._pickingDirectory = false;
      });
  }
}
