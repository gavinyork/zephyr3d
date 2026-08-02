import {
  getDesktopAPI,
  type DesktopAssistantAttachment,
  type DesktopAssistantEvent,
  type DesktopAssistantMessage,
  type DesktopAssistantSessionSummary
} from './desktop';
import { ProjectService } from './project';

export class AssistantService {
  private static _sessionScopes = new Map<string, string | null>();

  static isAvailable() {
    return !!getDesktopAPI()?.settings;
  }

  static currentScopeId() {
    return ProjectService.currentProjectStorageId || null;
  }

  static async createSession(title?: string): Promise<DesktopAssistantSessionSummary | null> {
    const desktop = getDesktopAPI();
    if (!desktop?.settings) {
      return null;
    }
    const session = await desktop.settings.createAssistantSession(title, this.currentScopeId());
    this.rememberSessionScope(session);
    return session;
  }

  static async listSessions(): Promise<DesktopAssistantSessionSummary[]> {
    const desktop = getDesktopAPI();
    if (!desktop?.settings) {
      return [];
    }
    const sessions = await desktop.settings.listAssistantSessions(this.currentScopeId());
    sessions.forEach((session) => this.rememberSessionScope(session));
    return sessions;
  }

  static async getSessionMessages(sessionId: string): Promise<DesktopAssistantMessage[]> {
    const desktop = getDesktopAPI();
    return desktop?.settings
      ? await desktop.settings.getAssistantSessionMessages(sessionId, this.currentScopeId())
      : [];
  }

  static async sendMessage(
    sessionId: string,
    content: string,
    attachments?: DesktopAssistantAttachment[]
  ): Promise<DesktopAssistantMessage | null> {
    const desktop = getDesktopAPI();
    return desktop?.settings
      ? await desktop.settings.sendAssistantMessage(sessionId, content, attachments, this.currentScopeId())
      : null;
  }

  static async pickImageAttachment(): Promise<DesktopAssistantAttachment | null> {
    const desktop = getDesktopAPI();
    if (!desktop?.fs?.pickFile) {
      return null;
    }
    const picked = await desktop.fs.pickFile({
      title: 'Select Reference Image',
      buttonLabel: 'Attach Image',
      filters: [
        {
          name: 'Images',
          extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp']
        }
      ]
    });
    if (!picked || !picked.mimeType.startsWith('image/')) {
      return null;
    }
    return {
      id: `att_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      name: picked.name,
      mimeType: picked.mimeType,
      dataUrl: `data:${picked.mimeType};base64,${picked.dataBase64}`
    };
  }

  static async renameSession(
    sessionId: string,
    title: string
  ): Promise<DesktopAssistantSessionSummary | null> {
    const desktop = getDesktopAPI();
    return desktop?.settings
      ? await desktop.settings.renameAssistantSession(sessionId, title, this.currentScopeId())
      : null;
  }

  static async deleteSession(sessionId: string): Promise<boolean> {
    const desktop = getDesktopAPI();
    return desktop?.settings
      ? await desktop.settings.deleteAssistantSession(sessionId, this.currentScopeId())
      : false;
  }

  static async pickClipboardImageAttachment(): Promise<DesktopAssistantAttachment | null> {
    const desktop = getDesktopAPI();
    if (!desktop?.settings?.readClipboardImage) {
      return null;
    }
    const image = await desktop.settings.readClipboardImage();
    if (!image) {
      return null;
    }
    return {
      id: `att_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      name: `clipboard_${new Date().toISOString().replace(/[:.]/g, '-')}.png`,
      mimeType: image.mimeType,
      dataUrl: `data:${image.mimeType};base64,${image.dataBase64}`
    };
  }

  static async cancelRun(sessionId: string): Promise<boolean> {
    const desktop = getDesktopAPI();
    return desktop?.settings
      ? await desktop.settings.cancelAssistantRun(sessionId, this.currentScopeId())
      : false;
  }

  static async approveToolCall(sessionId: string, callId: string): Promise<boolean> {
    const desktop = getDesktopAPI();
    return desktop?.settings
      ? await desktop.settings.approveAssistantToolCall(sessionId, callId, this.currentScopeId())
      : false;
  }

  static async rejectToolCall(sessionId: string, callId: string): Promise<boolean> {
    const desktop = getDesktopAPI();
    return desktop?.settings
      ? await desktop.settings.rejectAssistantToolCall(sessionId, callId, this.currentScopeId())
      : false;
  }

  static onEvent(listener: (event: DesktopAssistantEvent) => void): () => void {
    const desktop = getDesktopAPI();
    return desktop?.settings
      ? desktop.settings.onAssistantEvent((event) => {
          if (this.shouldForwardEvent(event)) {
            listener(event);
          }
        })
      : () => {};
  }

  private static rememberSessionScope(session: DesktopAssistantSessionSummary) {
    this._sessionScopes.set(session.id, session.scopeId ?? null);
  }

  private static shouldForwardEvent(event: DesktopAssistantEvent) {
    if (event.type === 'session_updated') {
      this.rememberSessionScope(event.session);
      return (event.session.scopeId ?? null) === this.currentScopeId();
    }
    if (event.type === 'session_deleted') {
      this._sessionScopes.delete(event.sessionId);
      return (event.scopeId ?? null) === this.currentScopeId();
    }
    const scopeId = this._sessionScopes.get(event.sessionId);
    return scopeId !== undefined && scopeId === this.currentScopeId();
  }
}
