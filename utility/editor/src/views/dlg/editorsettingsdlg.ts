import { ImGui } from '@zephyr3d/imgui';
import { DialogRenderer } from '../../components/modal';
import { EditorSettingsService, type EditorGlobalSettings } from '../../core/services/editorsettings';

export class DlgEditorSettings extends DialogRenderer<EditorGlobalSettings> {
  private static readonly RHI_VALUES: EditorGlobalSettings['defaultRHI'][] = ['webgpu', 'webgl2', 'webgl'];
  private static readonly RHI_LABELS = ['WebGPU', 'WebGL2', 'WebGL'];
  private _settings: EditorGlobalSettings;
  private _error: string;

  public static async editEditorSettings(
    title: string,
    settings: EditorGlobalSettings,
    width?: number
  ): Promise<EditorGlobalSettings> {
    return new DlgEditorSettings(title, settings, width).showModal();
  }

  constructor(id: string, settings: EditorGlobalSettings, width = 420) {
    super(id, width, 0, true, true);
    this._settings = {
      mcp: settings?.mcp ? { ...settings.mcp } : null,
      defaultRHI: settings?.defaultRHI ?? 'webgpu'
    };
    this._error = '';
  }

  doRender(): void {
    ImGui.Text('System');

    const rhiIndex = Math.max(0, DlgEditorSettings.RHI_VALUES.indexOf(this._settings.defaultRHI));
    const selectedRhiIndex = [rhiIndex] as [number];
    if (ImGui.Combo('Default RHI', selectedRhiIndex, DlgEditorSettings.RHI_LABELS)) {
      this._settings.defaultRHI = DlgEditorSettings.RHI_VALUES[selectedRhiIndex[0]];
    }
    ImGui.TextDisabled('Takes effect the next time the editor starts.');

    if (this._settings.mcp) {
      ImGui.Separator();
      ImGui.Text('MCP Service');

      const enabled = [this._settings.mcp.enabled] as [boolean];
      if (ImGui.Checkbox('Enable Local MCP Service', enabled)) {
        this._settings.mcp.enabled = enabled[0];
      }

      const port = [this._settings.mcp.port] as [number];
      if (ImGui.InputInt('Port', port, 1, 100)) {
        this._settings.mcp.port = Math.trunc(port[0]);
      }

      ImGui.TextDisabled(`Status: ${this._settings.mcp.running ? 'Running' : 'Stopped'}`);
      ImGui.TextDisabled(`URL: ${this._settings.mcp.url}`);

      if (ImGui.Button('Copy MCP URL')) {
        void EditorSettingsService.copyMcpServiceUrl().then((url) => {
          if (url && this._settings.mcp) {
            this._settings.mcp.url = url;
          }
        });
      }
    } else {
      ImGui.Separator();
      ImGui.TextDisabled('No desktop-only global settings are available in this runtime.');
    }

    if (this._error) {
      ImGui.Separator();
      ImGui.TextWrapped(this._error);
    }

    ImGui.Separator();
    if (ImGui.Button('Save')) {
      this._error = '';
      if (
        this._settings.mcp &&
        (!Number.isInteger(this._settings.mcp.port) ||
          this._settings.mcp.port < 1 ||
          this._settings.mcp.port > 65535)
      ) {
        this._error = 'Port must be an integer between 1 and 65535.';
      } else {
        this.close(this._settings);
      }
    }
    ImGui.SameLine();
    if (ImGui.Button('Cancel')) {
      this.close(null);
    }
  }
}
