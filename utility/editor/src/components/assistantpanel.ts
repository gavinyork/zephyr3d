import { Disposable } from '@zephyr3d/base';
import { ImGui } from '@zephyr3d/imgui';
import { customTextInput, CustomInputTextFlags } from './textinput';
import { AssistantService } from '../core/services/assistant';
import { EditorSettingsService } from '../core/services/editorsettings';
import type {
  DesktopAssistantAttachment,
  DesktopAssistantEvent,
  DesktopAssistantMessage,
  DesktopAssistantSessionSummary
} from '../core/services/desktop';

type PendingApproval = {
  callId: string;
  tool: string;
  args: unknown;
};

type ToolTimelineState = 'awaiting_approval' | 'approved' | 'rejected' | 'running' | 'succeeded' | 'failed';

type ToolTimelineEntry = {
  callId: string;
  tool: string;
  args: unknown;
  result?: unknown;
  state: ToolTimelineState;
  updatedAt: string;
};

type VirtualItemLayout = {
  width: number;
  height: number;
};

export class AssistantPanel extends Disposable {
  private static readonly MAX_RENDER_TEXT_CHARS = 12000;
  private static readonly READONLY_TEXT_INPUT_FLAGS =
    CustomInputTextFlags.ReadOnly | CustomInputTextFlags.Multiline;
  private static readonly USER_MESSAGE_BG = new ImGui.ImVec4(0.2, 0.3, 0.24, 1.0);
  private static readonly USER_MESSAGE_BG_HOVERED = new ImGui.ImVec4(0.23, 0.34, 0.27, 1.0);
  private static readonly USER_MESSAGE_BORDER = new ImGui.ImVec4(0.31, 0.47, 0.37, 1.0);
  private static readonly ASSISTANT_MESSAGE_BG = new ImGui.ImVec4(0.19, 0.24, 0.32, 1.0);
  private static readonly ASSISTANT_MESSAGE_BG_HOVERED = new ImGui.ImVec4(0.22, 0.28, 0.37, 1.0);
  private static readonly ASSISTANT_MESSAGE_BORDER = new ImGui.ImVec4(0.33, 0.41, 0.55, 1.0);
  private _sessions: DesktopAssistantSessionSummary[];
  private _selectedSessionId: string;
  private _messages: DesktopAssistantMessage[];
  private _input: [string];
  private _status: string;
  private _sessionScopeId: string | null;
  private _pendingAttachments: DesktopAssistantAttachment[];
  private _unsubscribe: () => void;
  private _pendingApprovals: Map<string, PendingApproval[]>;
  private _messageDrafts: Map<string, Map<string, DesktopAssistantMessage>>;
  private _toolTimeline: Map<string, ToolTimelineEntry[]>;
  private _conversationContentRevision: number;
  private _pendingConversationScrollRevision: number | null;
  private _messageLayoutCache: Map<string, VirtualItemLayout>;
  private _timelineLayoutCache: Map<string, VirtualItemLayout>;
  private _renameInput: [string];
  private _confirmDeleteSessionId: string;
  private _expandedMessageIds: Set<string>;
  private _llmModel: string;
  private _llmModels: string[];
  private _llmModelBusy: boolean;

  constructor() {
    super();
    this._sessions = [];
    this._selectedSessionId = '';
    this._messages = [];
    this._input = [''];
    this._status = '';
    this._sessionScopeId = AssistantService.currentScopeId();
    this._pendingAttachments = [];
    this._unsubscribe = () => {};
    this._pendingApprovals = new Map();
    this._messageDrafts = new Map();
    this._toolTimeline = new Map();
    this._conversationContentRevision = 0;
    this._pendingConversationScrollRevision = null;
    this._messageLayoutCache = new Map();
    this._timelineLayoutCache = new Map();
    this._renameInput = [''];
    this._confirmDeleteSessionId = '';
    this._expandedMessageIds = new Set();
    this._llmModel = '';
    this._llmModels = [];
    this._llmModelBusy = false;
    if (AssistantService.isAvailable()) {
      this._unsubscribe = AssistantService.onEvent((event) => {
        void this.handleAssistantEvent(event);
      });
      void this.initialize();
    }
  }

  render() {
    if (!AssistantService.isAvailable()) {
      ImGui.TextDisabled('Assistant is only available in the desktop editor runtime.');
      return;
    }
    const currentScopeId = AssistantService.currentScopeId();
    if (currentScopeId !== this._sessionScopeId) {
      this._sessionScopeId = currentScopeId;
      void this.handleScopeChanged();
    }

    this.renderToolbar();

    if (this._status) {
      ImGui.TextWrapped(this._status);
      ImGui.Separator();
    }

    const leftWidth = 220;
    const timelineWidth = 280;
    const bodyHeight = -ImGui.GetFrameHeightWithSpacing() * 3 - 8;

    if (ImGui.BeginChild('##AssistantSessions', new ImGui.ImVec2(leftWidth, bodyHeight), true)) {
      for (const session of this._sessions) {
        const label = `${session.title}${session.active ? ' *' : ''}##${session.id}`;
        if (ImGui.Selectable(label, session.id === this._selectedSessionId)) {
          void this.selectSession(session.id);
        }
      }
    }
    ImGui.EndChild();

    ImGui.SameLine();

    const conversationWidth = Math.max(
      240,
      ImGui.GetContentRegionAvail().x - timelineWidth - ImGui.GetStyle().ItemSpacing.x
    );
    if (ImGui.BeginChild('##AssistantConversation', new ImGui.ImVec2(conversationWidth, bodyHeight), true)) {
      this.renderMessages();
    }
    ImGui.EndChild();

    ImGui.SameLine();

    if (ImGui.BeginChild('##AssistantTimeline', new ImGui.ImVec2(0, bodyHeight), true)) {
      this.renderToolTimeline();
    }
    ImGui.EndChild();

    this.renderComposer();
  }

  protected onDispose() {
    super.onDispose();
    this._unsubscribe();
  }

  private async initialize() {
    this._sessionScopeId = AssistantService.currentScopeId();
    await this.reloadSessions();
    if (!this._selectedSessionId && this._sessions.length > 0) {
      await this.selectSession(this._sessions[0].id);
    }
    void this.refreshLlmModel();
  }

  private async refreshLlmModel() {
    try {
      const settings = await EditorSettingsService.getGlobalSettings();
      this._llmModel = settings.llm?.model ?? '';
    } catch {
      this._llmModel = '';
    }
  }

  private async loadLlmModels() {
    if (this._llmModelBusy) {
      return;
    }
    this._llmModelBusy = true;
    try {
      const settings = await EditorSettingsService.getGlobalSettings();
      this._llmModel = settings.llm?.model ?? '';
      if (!settings.llm) {
        this._status = 'LLM settings are not available in this runtime.';
        return;
      }
      this._llmModels = await EditorSettingsService.listLlmModels(
        settings.llm.provider,
        settings.llm.baseUrl
      );
      if (!this._llmModels.length) {
        this._status = 'Provider returned no models.';
      }
    } catch (err) {
      this._status = `Load models failed: ${err instanceof Error ? err.message : err}`;
    } finally {
      this._llmModelBusy = false;
    }
  }

  private async applyLlmModel(model: string) {
    if (!model || model === this._llmModel || this._llmModelBusy) {
      return;
    }
    this._llmModelBusy = true;
    try {
      const settings = await EditorSettingsService.getGlobalSettings();
      if (!settings.llm) {
        return;
      }
      const saved = await EditorSettingsService.saveGlobalSettings({
        llm: { ...settings.llm, model }
      });
      this._llmModel = saved.llm?.model ?? model;
      this._status = `Model switched to ${this._llmModel} (takes effect on the next run).`;
    } catch (err) {
      this._status = `Switch model failed: ${err instanceof Error ? err.message : err}`;
    } finally {
      this._llmModelBusy = false;
    }
  }

  private async handleScopeChanged() {
    this._selectedSessionId = '';
    this._messages = [];
    this._pendingAttachments = [];
    this._status = '';
    await this.reloadSessions();
    if (this._sessions.length > 0) {
      await this.selectSession(this._sessions[0].id);
    }
  }

  private async reloadSessions() {
    this._sessions = await AssistantService.listSessions();
    if (
      this._selectedSessionId &&
      !this._sessions.find((session) => session.id === this._selectedSessionId)
    ) {
      this._selectedSessionId = '';
      this._messages = [];
    }
  }

  private async selectSession(sessionId: string) {
    this._selectedSessionId = sessionId;
    this._messages = await AssistantService.getSessionMessages(sessionId);
    this._pendingAttachments = [];
    this._confirmDeleteSessionId = '';
    this._renameInput[0] = this._sessions.find((session) => session.id === sessionId)?.title ?? '';
    this.markConversationContentAppended(sessionId);
  }

  private renderToolbar() {
    if (ImGui.Button('New Session')) {
      void this.createSession();
    }
    ImGui.SameLine();
    if (ImGui.Button('Refresh')) {
      void this.reloadAndRefreshCurrentSession();
    }
    ImGui.SameLine();
    const active = this.currentSession?.active;
    if (ImGui.Button('Cancel Run') && active) {
      void this.cancelCurrentRun();
    }
    if (this._selectedSessionId) {
      ImGui.SameLine();
      ImGui.SetNextItemWidth(180);
      customTextInput('##AssistantSessionTitle', this._renameInput, 'Session title');
      ImGui.SameLine();
      if (ImGui.Button('Rename')) {
        void this.renameCurrentSession();
      }
      ImGui.SameLine();
      if (this._confirmDeleteSessionId === this._selectedSessionId) {
        if (ImGui.Button('Confirm Delete')) {
          void this.deleteCurrentSession();
        }
        ImGui.SameLine();
        if (ImGui.Button('Keep')) {
          this._confirmDeleteSessionId = '';
        }
      } else if (ImGui.Button('Delete')) {
        this._confirmDeleteSessionId = this._selectedSessionId;
      }
    }
    ImGui.AlignTextToFramePadding();
    ImGui.Text(`Model: ${this._llmModel || '(not configured)'}`);
    ImGui.SameLine();
    if (this._llmModels.length > 0) {
      ImGui.SetNextItemWidth(260);
      const modelIndex = [this._llmModels.indexOf(this._llmModel)] as [number];
      if (ImGui.Combo('##AssistantModelSwitch', modelIndex, this._llmModels)) {
        void this.applyLlmModel(this._llmModels[modelIndex[0]]);
      }
      ImGui.SameLine();
      if (ImGui.SmallButton(this._llmModelBusy ? 'Loading...' : 'Reload Models') && !this._llmModelBusy) {
        void this.loadLlmModels();
      }
    } else if (ImGui.SmallButton(this._llmModelBusy ? 'Loading...' : 'Load Models') && !this._llmModelBusy) {
      void this.loadLlmModels();
    }
  }

  private async renameCurrentSession() {
    if (!this._selectedSessionId) {
      return;
    }
    try {
      await AssistantService.renameSession(this._selectedSessionId, this._renameInput[0]);
      await this.reloadSessions();
    } catch (err) {
      this._status = `Rename session failed: ${err}`;
    }
  }

  private async deleteCurrentSession() {
    const sessionId = this._selectedSessionId;
    this._confirmDeleteSessionId = '';
    if (!sessionId) {
      return;
    }
    try {
      await AssistantService.deleteSession(sessionId);
      this._selectedSessionId = '';
      this._messages = [];
      await this.reloadSessions();
      if (this._sessions.length > 0) {
        await this.selectSession(this._sessions[0].id);
      }
    } catch (err) {
      this._status = `Delete session failed: ${err}`;
    }
  }

  private async pasteClipboardImage() {
    try {
      const attachment = await AssistantService.pickClipboardImageAttachment();
      if (attachment) {
        this._pendingAttachments = [...this._pendingAttachments, attachment];
      } else {
        this._status = 'No image found in the clipboard.';
      }
    } catch (err) {
      this._status = `Paste image failed: ${err}`;
    }
  }

  private renderMessages() {
    if (!this._selectedSessionId) {
      ImGui.TextDisabled('Create or select a session to start chatting.');
      return;
    }
    if (ImGui.BeginChild('##AssistantMessages', new ImGui.ImVec2(-1, -1), false)) {
      const messages = this.currentConversationMessages;
      const pending = this.currentPendingApprovals;
      if (messages.length === 0) {
        if (pending.length === 0) {
          ImGui.TextDisabled('No messages yet.');
        }
      } else {
        const layout = this.computeVirtualListLayout(messages, (message, wrapWidth) =>
          this.measureMessageHeight(message, wrapWidth)
        );
        if (layout.topPadding > 0) {
          ImGui.Dummy(new ImGui.ImVec2(0, layout.topPadding));
        }
        for (let i = layout.startIndex; i < layout.endIndex; i++) {
          this.renderMessageItem(messages[i]);
        }
        if (layout.bottomPadding > 0) {
          ImGui.Dummy(new ImGui.ImVec2(0, layout.bottomPadding));
        }
      }
      this.renderPendingApprovalRows(pending);
      this.renderConversationActivityHint();
      ImGui.Dummy(new ImGui.ImVec2(0, 1));
      if (
        this._pendingConversationScrollRevision !== null &&
        this._conversationContentRevision >= this._pendingConversationScrollRevision
      ) {
        ImGui.SetScrollHereY(1.0);
        this._pendingConversationScrollRevision = null;
      }
    }
    ImGui.EndChild();
  }

  private renderToolTimeline() {
    if (!this._selectedSessionId) {
      ImGui.TextDisabled('Tool activity will appear here.');
      return;
    }
    ImGui.Text('Tool Timeline');
    const timeline = this.currentToolTimeline;
    if (timeline.length === 0) {
      ImGui.Separator();
      ImGui.TextDisabled('No tool calls in this session yet.');
      return;
    }
    const layout = this.computeVirtualListLayout(timeline, (entry, wrapWidth) =>
      this.measureTimelineEntryHeight(entry, wrapWidth)
    );
    if (layout.topPadding > 0) {
      ImGui.Dummy(new ImGui.ImVec2(0, layout.topPadding));
    }
    for (let i = layout.startIndex; i < layout.endIndex; i++) {
      this.renderTimelineEntry(timeline[i]);
    }
    if (layout.bottomPadding > 0) {
      ImGui.Dummy(new ImGui.ImVec2(0, layout.bottomPadding));
    }
  }

  private renderComposer() {
    const canSend = !!this._selectedSessionId && !this.currentSession?.active;
    const buttonWidth = 110;
    ImGui.SetNextItemWidth(-buttonWidth * 2 - ImGui.GetStyle().ItemSpacing.x * 2);
    const submitted = customTextInput(
      '##AssistantPrompt',
      this._input,
      this._selectedSessionId ? 'Ask the assistant...' : 'Create a session first',
      CustomInputTextFlags.EnterReturnsTrue
    );
    ImGui.SameLine();
    if (ImGui.Button('Attach Image')) {
      void this.pickImageAttachment();
    }
    ImGui.SameLine();
    if (ImGui.Button('Paste Image')) {
      void this.pasteClipboardImage();
    }
    ImGui.SameLine();
    if (ImGui.Button('Send') || (submitted && canSend)) {
      if (canSend) {
        void this.sendCurrentInput();
      }
    }
    if (this._pendingAttachments.length > 0) {
      for (const attachment of this._pendingAttachments) {
        ImGui.TextWrapped(`Image: ${attachment.name}`);
        ImGui.SameLine();
        if (ImGui.SmallButton(`Remove##${attachment.id}`)) {
          this._pendingAttachments = this._pendingAttachments.filter((item) => item.id !== attachment.id);
        }
      }
    }
  }

  private async createSession() {
    try {
      const session = await AssistantService.createSession(`Session ${this._sessions.length + 1}`);
      if (session) {
        await this.reloadSessions();
        await this.selectSession(session.id);
      }
    } catch (err) {
      this._status = `Create session failed: ${err}`;
    }
  }

  private async reloadAndRefreshCurrentSession() {
    try {
      const current = this._selectedSessionId;
      await this.reloadSessions();
      if (current) {
        await this.selectSession(current);
      }
    } catch (err) {
      this._status = `Reload sessions failed: ${err}`;
    }
  }

  private async cancelCurrentRun() {
    if (!this._selectedSessionId) {
      return;
    }
    try {
      await AssistantService.cancelRun(this._selectedSessionId);
    } catch (err) {
      this._status = `Cancel run failed: ${err}`;
    }
  }

  private async approveToolCall(callId: string) {
    if (!this._selectedSessionId) {
      return;
    }
    try {
      await AssistantService.approveToolCall(this._selectedSessionId, callId);
    } catch (err) {
      this._status = `Approve tool call failed: ${err}`;
    }
  }

  private async rejectToolCall(callId: string) {
    if (!this._selectedSessionId) {
      return;
    }
    try {
      await AssistantService.rejectToolCall(this._selectedSessionId, callId);
    } catch (err) {
      this._status = `Reject tool call failed: ${err}`;
    }
  }

  private async sendCurrentInput() {
    const text = this._input[0].trim();
    if ((!text && this._pendingAttachments.length === 0) || !this._selectedSessionId) {
      return;
    }
    const attachments = this._pendingAttachments.slice();
    this._input[0] = '';
    this._pendingAttachments = [];
    this._status = '';
    try {
      await AssistantService.sendMessage(this._selectedSessionId, text, attachments);
    } catch (err) {
      this._pendingAttachments = attachments;
      this._status = `Send failed: ${err}`;
    }
  }

  private async pickImageAttachment() {
    try {
      const attachment = await AssistantService.pickImageAttachment();
      if (!attachment) {
        return;
      }
      this._pendingAttachments = [...this._pendingAttachments, attachment];
    } catch (err) {
      this._status = `Attach image failed: ${err}`;
    }
  }

  private async handleAssistantEvent(event: DesktopAssistantEvent) {
    switch (event.type) {
      case 'session_updated': {
        const index = this._sessions.findIndex((session) => session.id === event.session.id);
        if (index >= 0) {
          this._sessions[index] = event.session;
        } else {
          this._sessions.unshift(event.session);
        }
        break;
      }
      case 'session_deleted': {
        this._sessions = this._sessions.filter((session) => session.id !== event.sessionId);
        if (event.sessionId === this._selectedSessionId) {
          this._selectedSessionId = '';
          this._messages = [];
          if (this._sessions.length > 0) {
            void this.selectSession(this._sessions[0].id);
          }
        }
        break;
      }
      case 'message_started':
        this.upsertDraftMessage(event.sessionId, event.message);
        this.markConversationContentAppended(event.sessionId);
        break;
      case 'message_delta':
        this.updateDraftMessage(event.sessionId, event.messageId, {
          content: event.content,
          status: 'pending'
        });
        this.invalidateMessageLayout(event.sessionId, event.messageId);
        this.markConversationContentAppended(event.sessionId);
        break;
      case 'message_completed':
        this.updateDraftMessage(event.sessionId, event.messageId, {
          content: event.content,
          status: event.status
        });
        this.invalidateMessageLayout(event.sessionId, event.messageId);
        this.markConversationContentAppended(event.sessionId);
        break;
      case 'message_added':
        this.removeDraftMessage(event.sessionId, event.message.id);
        this.invalidateMessageLayout(event.sessionId, event.message.id);
        if (event.sessionId === this._selectedSessionId) {
          if (!this._messages.find((message) => message.id === event.message.id)) {
            this._messages.push(event.message);
          }
        }
        this.markConversationContentAppended(event.sessionId);
        break;
      case 'tool_call_approval_requested': {
        const pending = this._pendingApprovals.get(event.sessionId) ?? [];
        if (!pending.find((item) => item.callId === event.callId)) {
          pending.push({
            callId: event.callId,
            tool: event.tool,
            args: event.args
          });
          this._pendingApprovals.set(event.sessionId, pending);
        }
        this.markConversationContentAppended(event.sessionId);
        this.upsertToolTimelineEntry(event.sessionId, {
          callId: event.callId,
          tool: event.tool,
          args: event.args,
          state: 'awaiting_approval'
        });
        break;
      }
      case 'tool_call_approval_resolved': {
        const pending = this._pendingApprovals.get(event.sessionId) ?? [];
        this._pendingApprovals.set(
          event.sessionId,
          pending.filter((item) => item.callId !== event.callId)
        );
        this.patchToolTimelineEntry(event.sessionId, event.callId, {
          state: event.approved ? 'approved' : 'rejected'
        });
        if (!event.approved) {
          this._status = 'Tool approval was rejected.';
        }
        break;
      }
      case 'tool_call_started':
        this.upsertToolTimelineEntry(event.sessionId, {
          callId: event.callId,
          tool: event.tool,
          args: event.args,
          state: 'running'
        });
        break;
      case 'tool_call_finished':
        this.patchToolTimelineEntry(event.sessionId, event.callId, {
          tool: event.tool,
          result: event.result,
          state: event.isError ? 'failed' : 'succeeded'
        });
        break;
      case 'run_state':
        if (event.error) {
          this._status = event.error;
        }
        break;
      default:
        break;
    }
  }

  private get currentSession() {
    return this._sessions.find((session) => session.id === this._selectedSessionId) ?? null;
  }

  private get currentPendingApprovals() {
    return this._pendingApprovals.get(this._selectedSessionId) ?? [];
  }

  private get currentConversationMessages() {
    const messages = this._messages.filter((message) => message.role !== 'tool');
    const drafts = Array.from(this._messageDrafts.get(this._selectedSessionId)?.values() ?? []).filter(
      (message) => message.role !== 'tool'
    );
    return [...messages, ...drafts]
      .filter((message) => !this.shouldHideConversationMessage(message))
      .sort((a, b) =>
        a.createdAt === b.createdAt ? a.id.localeCompare(b.id) : a.createdAt.localeCompare(b.createdAt)
      );
  }

  private get currentToolTimeline() {
    return this._toolTimeline.get(this._selectedSessionId) ?? [];
  }

  private upsertDraftMessage(sessionId: string, message: DesktopAssistantMessage) {
    const drafts = this._messageDrafts.get(sessionId) ?? new Map<string, DesktopAssistantMessage>();
    drafts.set(message.id, { ...message });
    this._messageDrafts.set(sessionId, drafts);
    this.invalidateMessageLayout(sessionId, message.id);
  }

  private updateDraftMessage(sessionId: string, messageId: string, patch: Partial<DesktopAssistantMessage>) {
    const drafts = this._messageDrafts.get(sessionId);
    const current = drafts?.get(messageId);
    if (!drafts || !current) {
      return;
    }
    drafts.set(messageId, {
      ...current,
      ...patch
    });
    this.invalidateMessageLayout(sessionId, messageId);
  }

  private removeDraftMessage(sessionId: string, messageId: string) {
    this._messageDrafts.get(sessionId)?.delete(messageId);
    this.invalidateMessageLayout(sessionId, messageId);
  }

  private upsertToolTimelineEntry(
    sessionId: string,
    entry: Omit<ToolTimelineEntry, 'updatedAt'> & { updatedAt?: string }
  ) {
    const timeline = this._toolTimeline.get(sessionId) ?? [];
    const next: ToolTimelineEntry = {
      ...entry,
      updatedAt: entry.updatedAt ?? new Date().toISOString()
    };
    const index = timeline.findIndex((item) => item.callId === entry.callId);
    if (index >= 0) {
      timeline[index] = {
        ...timeline[index],
        ...next
      };
    } else {
      timeline.push(next);
    }
    this._toolTimeline.set(sessionId, timeline);
    this.invalidateTimelineLayout(sessionId, entry.callId);
  }

  private patchToolTimelineEntry(sessionId: string, callId: string, patch: Partial<ToolTimelineEntry>) {
    const timeline = this._toolTimeline.get(sessionId) ?? [];
    const index = timeline.findIndex((item) => item.callId === callId);
    if (index >= 0) {
      timeline[index] = {
        ...timeline[index],
        ...patch,
        updatedAt: new Date().toISOString()
      };
      this._toolTimeline.set(sessionId, timeline);
      this.invalidateTimelineLayout(sessionId, callId);
    }
  }

  private markConversationContentAppended(sessionId: string) {
    if (sessionId === this._selectedSessionId) {
      this._conversationContentRevision++;
      this._pendingConversationScrollRevision = this._conversationContentRevision;
    }
  }

  private shouldHideConversationMessage(message: DesktopAssistantMessage) {
    if (message.synthetic) {
      return true;
    }
    // Hides both streaming placeholders and persisted tool-call-only turns
    // (no prose); the Tool Timeline already surfaces the calls themselves.
    return message.role === 'assistant' && !this.getMessageRenderText(message).trim();
  }

  private renderMessageItem(message: DesktopAssistantMessage) {
    const text = this.getMessageRenderText(message);
    if (!this.shouldHideConversationMessage(message)) {
      ImGui.Separator();
      ImGui.AlignTextToFramePadding();
      ImGui.Text(`${message.role}${message.status === 'error' ? ' (error)' : ''}`);
      ImGui.SameLine();
      if (ImGui.SmallButton(`Copy##AssistantMessageCopy_${message.id}`)) {
        ImGui.SetClipboardText(message.content ?? '');
      }
      if ((message.content?.length ?? 0) > AssistantPanel.MAX_RENDER_TEXT_CHARS) {
        ImGui.SameLine();
        const expanded = this._expandedMessageIds.has(message.id);
        if (
          ImGui.SmallButton(`${expanded ? 'Collapse' : 'Show Full'}##AssistantMessageExpand_${message.id}`)
        ) {
          if (expanded) {
            this._expandedMessageIds.delete(message.id);
          } else {
            this._expandedMessageIds.add(message.id);
          }
          this.invalidateMessageLayout(this._selectedSessionId, message.id);
        }
      }
      this.renderReadOnlyTextBlock(`##AssistantMessage_${message.id}`, text, message.role);
    }
  }

  private renderPendingApprovalRows(pending: readonly PendingApproval[]) {
    for (const item of pending) {
      ImGui.Separator();
      ImGui.AlignTextToFramePadding();
      ImGui.Text(`Tool approval required: ${this.getRenderText(item.tool)}.`);
      ImGui.SameLine();
      if (ImGui.Button(`Approve##${item.callId}`)) {
        void this.approveToolCall(item.callId);
      }
      ImGui.SameLine();
      if (ImGui.SmallButton(`Reject##${item.callId}`)) {
        void this.rejectToolCall(item.callId);
      }
    }
  }

  private renderConversationActivityHint() {
    const hint = this.getConversationActivityHint();
    if (!hint) {
      return;
    }
    ImGui.Separator();
    ImGui.TextDisabled(hint);
  }

  private getConversationActivityHint() {
    if (!this.currentSession?.active) {
      return null;
    }
    const pendingApproval = this.currentPendingApprovals[0];
    if (pendingApproval) {
      return `Awaiting approval for ${this.getRenderText(pendingApproval.tool)}...`;
    }
    const runningTool = [...this.currentToolTimeline]
      .reverse()
      .find((entry) => entry.state === 'running' || entry.state === 'approved');
    if (runningTool) {
      return `Calling ${this.getRenderText(runningTool.tool)}...`;
    }
    const drafts = Array.from(this._messageDrafts.get(this._selectedSessionId)?.values() ?? []);
    const pendingAssistantDraft = drafts.find(
      (message) => message.role === 'assistant' && (message.status === 'pending' || !message.status)
    );
    if (pendingAssistantDraft && !this.getMessageRenderText(pendingAssistantDraft).trim()) {
      return 'Thinking...';
    }
    return 'Working...';
  }

  private renderTimelineEntry(entry: ToolTimelineEntry) {
    const argsText = this.getRenderJson(entry.args ?? {});
    ImGui.Separator();
    ImGui.AlignTextToFramePadding();
    ImGui.Text(`${entry.tool} [${entry.state}]`);
    ImGui.SameLine();
    if (ImGui.SmallButton(`Copy Args##${entry.callId}`)) {
      ImGui.SetClipboardText(argsText);
    }
    this.renderReadOnlyTextBlock(`##AssistantTimelineArgs_${entry.callId}`, argsText);
    if (entry.result !== undefined) {
      const resultText = this.getRenderJson(entry.result);
      if (ImGui.SmallButton(`Copy Result##${entry.callId}`)) {
        ImGui.SetClipboardText(resultText);
      }
      this.renderReadOnlyTextBlock(`##AssistantTimelineResult_${entry.callId}`, resultText);
    }
  }

  private computeVirtualListLayout<T>(
    items: readonly T[],
    measureHeight: (item: T, wrapWidth: number) => number
  ) {
    const wrapWidth = Math.max(1, ImGui.GetContentRegionAvail().x);
    const viewportHeight = Math.max(1, ImGui.GetContentRegionAvail().y);
    const scrollY = ImGui.GetScrollY();
    const viewportEnd = scrollY + viewportHeight;
    const offsets = new Array<number>(items.length + 1);
    offsets[0] = 0;
    for (let i = 0; i < items.length; i++) {
      offsets[i + 1] = offsets[i] + Math.max(1, measureHeight(items[i], wrapWidth));
    }
    let startIndex = 0;
    while (startIndex < items.length && offsets[startIndex + 1] < scrollY) {
      startIndex++;
    }
    let endIndex = startIndex;
    while (endIndex < items.length && offsets[endIndex] < viewportEnd) {
      endIndex++;
    }
    const overscan = 2;
    startIndex = Math.max(0, startIndex - overscan);
    endIndex = Math.min(items.length, endIndex + overscan);
    return {
      startIndex,
      endIndex,
      topPadding: offsets[startIndex],
      bottomPadding: offsets[items.length] - offsets[endIndex]
    };
  }

  private measureMessageHeight(message: DesktopAssistantMessage, wrapWidth: number) {
    const key = this.getMessageLayoutKey(this._selectedSessionId, message.id);
    const cached = this._messageLayoutCache.get(key);
    if (cached && Math.abs(cached.width - wrapWidth) < 1) {
      return cached.height;
    }
    const style = ImGui.GetStyle();
    const separatorHeight = 1 + style.ItemSpacing.y * 2;
    const headerHeight = Math.max(ImGui.GetTextLineHeight(), ImGui.GetFrameHeight());
    const contentHeight = this.measureReadOnlyTextBlockHeight(this.getMessageRenderText(message));
    const height = separatorHeight + headerHeight + style.ItemSpacing.y + contentHeight;
    this._messageLayoutCache.set(key, { width: wrapWidth, height });
    return height;
  }

  private measureTimelineEntryHeight(entry: ToolTimelineEntry, wrapWidth: number) {
    const key = this.getTimelineLayoutKey(this._selectedSessionId, entry.callId);
    const cached = this._timelineLayoutCache.get(key);
    if (cached && Math.abs(cached.width - wrapWidth) < 1) {
      return cached.height;
    }
    const style = ImGui.GetStyle();
    const separatorHeight = 1 + style.ItemSpacing.y * 2;
    const headerHeight = Math.max(ImGui.GetTextLineHeight(), ImGui.GetFrameHeight());
    const argsHeight = this.measureReadOnlyTextBlockHeight(this.getRenderJson(entry.args ?? {}));
    const resultHeight =
      entry.result === undefined
        ? 0
        : this.measureReadOnlyTextBlockHeight(this.getRenderJson(entry.result)) + style.ItemSpacing.y;
    const height = separatorHeight + headerHeight + style.ItemSpacing.y + argsHeight + resultHeight;
    this._timelineLayoutCache.set(key, { width: wrapWidth, height });
    return height;
  }

  private renderReadOnlyTextBlock(label: string, text: string, role?: DesktopAssistantMessage['role']) {
    const value: [string] = [text];
    if (role === 'user') {
      ImGui.PushStyleColor(ImGui.Col.FrameBg, AssistantPanel.USER_MESSAGE_BG);
      ImGui.PushStyleColor(ImGui.Col.FrameBgHovered, AssistantPanel.USER_MESSAGE_BG_HOVERED);
      ImGui.PushStyleColor(ImGui.Col.Border, AssistantPanel.USER_MESSAGE_BORDER);
    } else if (role === 'assistant') {
      ImGui.PushStyleColor(ImGui.Col.FrameBg, AssistantPanel.ASSISTANT_MESSAGE_BG);
      ImGui.PushStyleColor(ImGui.Col.FrameBgHovered, AssistantPanel.ASSISTANT_MESSAGE_BG_HOVERED);
      ImGui.PushStyleColor(ImGui.Col.Border, AssistantPanel.ASSISTANT_MESSAGE_BORDER);
    }
    customTextInput(
      label,
      value,
      '',
      AssistantPanel.READONLY_TEXT_INPUT_FLAGS,
      -1,
      this.measureReadOnlyTextBlockHeight(text)
    );
    if (role === 'user' || role === 'assistant') {
      ImGui.PopStyleColor(3);
    }
  }

  private measureReadOnlyTextBlockHeight(text: string) {
    const style = ImGui.GetStyle();
    const lineHeight = ImGui.GetTextLineHeight();
    const lineCount = Math.max(1, text.split('\n').length);
    const contentHeight = Math.max(lineHeight, lineCount * lineHeight);
    return Math.max(ImGui.GetFrameHeight(), contentHeight + style.FramePadding.y * 2 + 2);
  }

  private getRenderText(text: string) {
    return this.truncateRenderText(text ?? '');
  }

  private getMessageRenderText(message: DesktopAssistantMessage) {
    const parts: string[] = [];
    if (message.content) {
      parts.push(message.content);
    }
    for (const attachment of message.attachments ?? []) {
      parts.push(`[Image] ${attachment.name}`);
    }
    const joined = parts.join('\n');
    return this._expandedMessageIds.has(message.id) ? joined : this.truncateRenderText(joined);
  }

  private getRenderJson(value: unknown) {
    try {
      return this.truncateRenderText(JSON.stringify(value, null, 2) ?? '');
    } catch (err) {
      return this.truncateRenderText(String(err));
    }
  }

  private truncateRenderText(text: string) {
    if (text.length <= AssistantPanel.MAX_RENDER_TEXT_CHARS) {
      return text;
    }
    const remaining = text.length - AssistantPanel.MAX_RENDER_TEXT_CHARS;
    return `${text.slice(0, AssistantPanel.MAX_RENDER_TEXT_CHARS)}\n...[truncated ${remaining} chars in panel]`;
  }

  private invalidateMessageLayout(sessionId: string, messageId: string) {
    this._messageLayoutCache.delete(this.getMessageLayoutKey(sessionId, messageId));
  }

  private invalidateTimelineLayout(sessionId: string, callId: string) {
    this._timelineLayoutCache.delete(this.getTimelineLayoutKey(sessionId, callId));
  }

  private getMessageLayoutKey(sessionId: string, messageId: string) {
    return `${sessionId}:${messageId}`;
  }

  private getTimelineLayoutKey(sessionId: string, callId: string) {
    return `${sessionId}:${callId}`;
  }
}
