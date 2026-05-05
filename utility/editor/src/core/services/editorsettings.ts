import { getDesktopAPI, type DesktopGlobalSettings } from './desktop';

export type EditorGlobalSettings = DesktopGlobalSettings;

const defaultGlobalSettings: EditorGlobalSettings = {
  mcp: null,
  defaultRHI: 'webgpu'
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
}
