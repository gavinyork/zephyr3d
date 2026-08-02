import { getDesktopAPI, type DesktopGlobalSettings } from './desktop';

export type EditorGlobalSettings = DesktopGlobalSettings;

const defaultGlobalSettings: EditorGlobalSettings = {
  mcp: null,
  defaultRHI: 'webgpu',
  llm: null
};

export class EditorSettingsService {
  static async getGlobalSettings(): Promise<EditorGlobalSettings> {
    const desktop = getDesktopAPI();
    return desktop?.settings ? await desktop.settings.getGlobalSettings() : defaultGlobalSettings;
  }

  static async saveGlobalSettings(settings: Partial<EditorGlobalSettings>): Promise<EditorGlobalSettings> {
    const desktop = getDesktopAPI();
    return desktop?.settings ? await desktop.settings.saveGlobalSettings(settings) : defaultGlobalSettings;
  }

  static async copyMcpServiceUrl(): Promise<string | null> {
    const desktop = getDesktopAPI();
    return desktop?.settings ? await desktop.settings.copyMcpServiceUrl() : null;
  }

  static async toggleDevTools(): Promise<boolean> {
    const desktop = getDesktopAPI();
    return desktop?.settings ? await desktop.settings.toggleDevTools() : false;
  }

  static async setLlmApiKey(provider: NonNullable<EditorGlobalSettings['llm']>['provider'], apiKey: string) {
    const desktop = getDesktopAPI();
    return desktop?.settings ? await desktop.settings.setLlmApiKey(provider, apiKey) : false;
  }

  static async clearLlmApiKey(provider: NonNullable<EditorGlobalSettings['llm']>['provider']) {
    const desktop = getDesktopAPI();
    return desktop?.settings ? await desktop.settings.clearLlmApiKey(provider) : false;
  }

  static async listLlmModels(
    provider: NonNullable<EditorGlobalSettings['llm']>['provider'],
    baseUrl: string
  ): Promise<string[]> {
    const desktop = getDesktopAPI();
    return desktop?.settings ? await desktop.settings.listLlmModels(provider, baseUrl) : [];
  }
}
