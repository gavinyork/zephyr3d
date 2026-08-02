import { ImGui } from '@zephyr3d/imgui';
import { DialogRenderer } from '../../components/modal';
import { EditorSettingsService, type EditorGlobalSettings } from '../../core/services/editorsettings';
import { customTextInput, CustomInputTextFlags } from '../../components/textinput';

export class DlgEditorSettings extends DialogRenderer<EditorGlobalSettings> {
  private static readonly RHI_VALUES: EditorGlobalSettings['defaultRHI'][] = ['webgpu', 'webgl2', 'webgl'];
  private static readonly RHI_LABELS = ['WebGPU', 'WebGL2', 'WebGL'];
  private static readonly LLM_PROVIDER_VALUES: NonNullable<EditorGlobalSettings['llm']>['provider'][] = [
    'openai',
    'anthropic',
    'custom'
  ];
  private static readonly LLM_PROVIDER_LABELS = ['OpenAI', 'Anthropic', 'Custom'];
  private _settings: EditorGlobalSettings;
  private _error: string;
  private _apiKey: [string];
  private _apiKeyChanged: boolean;
  private _clearApiKey: boolean;
  private _modelList: string[];
  private _modelListStatus: string;
  private _fetchingModels: boolean;

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
      defaultRHI: settings?.defaultRHI ?? 'webgpu',
      llm: settings?.llm
        ? { ...settings.llm }
        : {
            provider: 'openai',
            baseUrl: 'https://api.openai.com/v1',
            model: 'gpt-4.1-mini',
            apiKeyConfigured: false,
            temperature: 0.2,
            maxOutputTokens: 4096,
            maxToolSteps: 32,
            toolCalling: true,
            requireToolApproval: true
          }
    };
    this._error = '';
    this._apiKey = [''];
    this._apiKeyChanged = false;
    this._clearApiKey = false;
    this._modelList = [];
    this._modelListStatus = '';
    this._fetchingModels = false;
  }

  private async fetchModelList() {
    if (!this._settings.llm || this._fetchingModels) {
      return;
    }
    this._fetchingModels = true;
    this._modelListStatus = 'Fetching model list...';
    try {
      this._modelList = await EditorSettingsService.listLlmModels(
        this._settings.llm.provider,
        this._settings.llm.baseUrl
      );
      this._modelListStatus = this._modelList.length
        ? `${this._modelList.length} models available.`
        : 'Provider returned no models.';
    } catch (err) {
      this._modelList = [];
      this._modelListStatus = `Fetch models failed: ${err instanceof Error ? err.message : err}`;
    } finally {
      this._fetchingModels = false;
    }
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

    if (this._settings.llm) {
      ImGui.Separator();
      ImGui.Text('LLM');

      const providerIndex = Math.max(
        0,
        DlgEditorSettings.LLM_PROVIDER_VALUES.indexOf(this._settings.llm.provider)
      );
      const selectedProviderIndex = [providerIndex] as [number];
      if (ImGui.Combo('Provider', selectedProviderIndex, DlgEditorSettings.LLM_PROVIDER_LABELS)) {
        const nextProvider = DlgEditorSettings.LLM_PROVIDER_VALUES[selectedProviderIndex[0]];
        if (nextProvider !== this._settings.llm.provider) {
          this._settings.llm.provider = nextProvider;
          // Clear provider-specific fields so the main process fills in the
          // new provider's defaults on save, instead of carrying over the
          // previous provider's endpoint/model.
          this._settings.llm.baseUrl = '';
          this._settings.llm.model = '';
          this._modelList = [];
          this._modelListStatus = '';
        }
      }

      const baseUrl = [this._settings.llm.baseUrl ?? ''] as [string];
      if (customTextInput('Base URL', baseUrl)) {
        this._settings.llm.baseUrl = baseUrl[0];
      }

      const model = [this._settings.llm.model ?? ''] as [string];
      if (customTextInput('Model', model)) {
        this._settings.llm.model = model[0];
      }
      ImGui.SameLine();
      if (ImGui.SmallButton(this._fetchingModels ? 'Fetching...' : 'Fetch') && !this._fetchingModels) {
        void this.fetchModelList();
      }
      if (this._modelList.length > 0) {
        const modelIndex = [this._modelList.indexOf(this._settings.llm.model)] as [number];
        ImGui.SetNextItemWidth(-1);
        if (ImGui.Combo('##LlmModelPick', modelIndex, this._modelList)) {
          const picked = this._modelList[modelIndex[0]];
          if (picked) {
            this._settings.llm.model = picked;
          }
        }
      }
      if (this._modelListStatus) {
        ImGui.TextDisabled(this._modelListStatus);
      }

      const temperature = [this._settings.llm.temperature ?? 0.2] as [number];
      if (ImGui.InputFloat('Temperature', temperature, 0.05, 0.25)) {
        this._settings.llm.temperature = temperature[0];
      }

      const maxOutputTokens = [this._settings.llm.maxOutputTokens ?? 4096] as [number];
      if (ImGui.InputInt('Max Output Tokens', maxOutputTokens, 128, 1024)) {
        this._settings.llm.maxOutputTokens = Math.trunc(maxOutputTokens[0]);
      }

      const unlimitedToolSteps = [this._settings.llm.maxToolSteps === null] as [boolean];
      if (ImGui.Checkbox('Unlimited Tool Steps', unlimitedToolSteps)) {
        this._settings.llm.maxToolSteps = unlimitedToolSteps[0]
          ? null
          : Math.max(1, this._settings.llm.maxToolSteps ?? 32);
      }

      if (this._settings.llm.maxToolSteps !== null) {
        const maxToolSteps = [this._settings.llm.maxToolSteps ?? 32] as [number];
        if (ImGui.InputInt('Max Tool Steps', maxToolSteps, 1, 8)) {
          this._settings.llm.maxToolSteps = Math.trunc(maxToolSteps[0]);
        }
      } else {
        ImGui.TextDisabled('Tool-call loop limit is disabled.');
      }

      const toolCalling = [this._settings.llm.toolCalling] as [boolean];
      if (ImGui.Checkbox('Enable Tool Calling', toolCalling)) {
        this._settings.llm.toolCalling = toolCalling[0];
      }

      const requireToolApproval = [this._settings.llm.requireToolApproval] as [boolean];
      if (ImGui.Checkbox('Require Tool Approval', requireToolApproval)) {
        this._settings.llm.requireToolApproval = requireToolApproval[0];
      }

      ImGui.TextDisabled(
        this._settings.llm.apiKeyConfigured && !this._clearApiKey
          ? 'API key is configured.'
          : 'API key is not configured.'
      );

      if (this._settings.llm.apiKeyStorageSecure === false) {
        ImGui.PushStyleColor(ImGui.Col.Text, new ImGui.ImVec4(1.0, 0.6, 0.2, 1.0));
        ImGui.TextWrapped(
          'Warning: OS-level secret encryption is unavailable on this system; API keys will be stored in plaintext.'
        );
        ImGui.PopStyleColor();
      }

      if (customTextInput('API Key', this._apiKey, '', CustomInputTextFlags.Password)) {
        this._apiKeyChanged = true;
        this._clearApiKey = false;
      }

      if (ImGui.Button('Clear Stored API Key')) {
        this._clearApiKey = true;
        this._apiKeyChanged = false;
        this._apiKey[0] = '';
      }
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
      } else if (
        this._settings.llm &&
        (!Number.isInteger(this._settings.llm.maxOutputTokens) || this._settings.llm.maxOutputTokens < 128)
      ) {
        this._error = 'Max output tokens must be an integer greater than or equal to 128.';
      } else if (
        this._settings.llm &&
        this._settings.llm.maxToolSteps !== null &&
        (!Number.isInteger(this._settings.llm.maxToolSteps) || this._settings.llm.maxToolSteps < 1)
      ) {
        this._error = 'Max tool steps must be an integer greater than or equal to 1, or set to unlimited.';
      } else {
        this.close(this._settings);
      }
    }
    ImGui.SameLine();
    if (ImGui.Button('Cancel')) {
      this.close(null);
    }
  }

  get pendingApiKey() {
    return this._apiKeyChanged ? this._apiKey[0] : '';
  }

  get shouldClearApiKey() {
    return this._clearApiKey;
  }
}
