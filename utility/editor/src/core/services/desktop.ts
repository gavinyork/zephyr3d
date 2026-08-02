export type DesktopFSScope = 'meta' | 'system' | `project:${string}`;

export type DesktopFSReadOptions = {
  encoding?: 'utf8' | 'binary' | 'base64';
  offset?: number;
  length?: number;
};

export type DesktopFSWriteOptions = {
  encoding?: 'utf8' | 'binary' | 'base64';
  append?: boolean;
  create?: boolean;
};

export type DesktopFSMoveOptions = {
  overwrite?: boolean;
};

export type DesktopFSListOptions = {
  recursive?: boolean;
};

export type DesktopDirectoryPickOptions = {
  title?: string;
  defaultPath?: string;
  buttonLabel?: string;
};

export type DesktopFilePickFilter = {
  name: string;
  extensions: string[];
};

export type DesktopFilePickOptions = {
  title?: string;
  defaultPath?: string;
  buttonLabel?: string;
  filters?: DesktopFilePickFilter[];
};

export type DesktopFileMetadata = {
  name: string;
  path: string;
  size: number;
  type: 'file' | 'directory';
  created: string;
  modified: string;
};

export type DesktopPickedFile = {
  name: string;
  path: string;
  size: number;
  mimeType: string;
  dataBase64: string;
};

export type DesktopFileStat = {
  size: number;
  isFile: boolean;
  isDirectory: boolean;
  created: string;
  modified: string;
  accessed?: string;
};

export type DesktopFSChangeEvent = {
  watchId: string;
  scope: DesktopFSScope;
  path: string;
  type: 'created' | 'deleted' | 'moved' | 'modified';
  itemType: 'file' | 'directory';
};

export type DesktopMcpSettings = {
  enabled: boolean;
  port: number;
  running: boolean;
  url: string;
};

export type DesktopLlmProvider = 'openai' | 'anthropic' | 'custom';

export type DesktopLlmSettings = {
  provider: DesktopLlmProvider;
  baseUrl: string;
  model: string;
  apiKeyConfigured: boolean;
  /** False when OS-level secret encryption is unavailable and keys fall back to plaintext storage. */
  apiKeyStorageSecure?: boolean;
  temperature: number;
  maxOutputTokens: number;
  maxToolSteps: number | null;
  toolCalling: boolean;
  requireToolApproval: boolean;
};

export type DesktopGlobalSettings = {
  mcp: DesktopMcpSettings | null;
  defaultRHI: 'webgpu' | 'webgl2' | 'webgl';
  llm: DesktopLlmSettings | null;
};

export type DesktopAssistantSessionSummary = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  active: boolean;
  scopeId: string | null;
};

export type DesktopAssistantAttachment = {
  id: string;
  name: string;
  mimeType: string;
  dataUrl: string;
};

export type DesktopAssistantMessage = {
  id: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  attachments?: DesktopAssistantAttachment[];
  createdAt: string;
  status?: 'pending' | 'complete' | 'error';
  /** Injected by the assistant runtime (e.g. tool screenshot fed back to the model), not typed by the user. */
  synthetic?: boolean;
  /** OpenAI-style tool calls issued by this assistant message (persisted for context replay). */
  toolCalls?: {
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }[];
  /** For tool-role messages: the tool call this message responds to. */
  toolCallId?: string;
  /** For tool-role messages: the tool name that produced this result. */
  toolName?: string;
};

export type DesktopAssistantEvent =
  | {
      type: 'session_updated';
      session: DesktopAssistantSessionSummary;
    }
  | {
      type: 'session_deleted';
      sessionId: string;
      scopeId: string | null;
    }
  | {
      type: 'message_started';
      sessionId: string;
      message: DesktopAssistantMessage;
    }
  | {
      type: 'message_delta';
      sessionId: string;
      messageId: string;
      delta: string;
      content: string;
    }
  | {
      type: 'message_completed';
      sessionId: string;
      messageId: string;
      content: string;
      status: 'pending' | 'complete' | 'error';
    }
  | {
      type: 'message_added';
      sessionId: string;
      message: DesktopAssistantMessage;
    }
  | {
      type: 'tool_call_approval_requested';
      sessionId: string;
      callId: string;
      tool: string;
      args: unknown;
    }
  | {
      type: 'tool_call_approval_resolved';
      sessionId: string;
      callId: string;
      approved: boolean;
    }
  | {
      type: 'tool_call_started';
      sessionId: string;
      callId: string;
      tool: string;
      args: unknown;
    }
  | {
      type: 'tool_call_finished';
      sessionId: string;
      callId: string;
      tool: string;
      result: unknown;
      isError: boolean;
    }
  | {
      type: 'run_state';
      sessionId: string;
      active: boolean;
      error?: string | null;
    };

export type ZephyrEditorDesktopAPI = {
  platform: string;
  versions: {
    electron?: string;
    chrome?: string;
    node?: string;
  };
  fs: {
    makeDirectory(scope: DesktopFSScope, path: string, recursive?: boolean): Promise<void>;
    revealPath(scope: DesktopFSScope, path: string): Promise<void>;
    pickDirectory(options?: DesktopDirectoryPickOptions): Promise<string | null>;
    pickFile(options?: DesktopFilePickOptions): Promise<DesktopPickedFile | null>;
    readDirectory(
      scope: DesktopFSScope,
      path: string,
      options?: DesktopFSListOptions
    ): Promise<DesktopFileMetadata[]>;
    deleteDirectory(scope: DesktopFSScope, path: string, recursive?: boolean): Promise<void>;
    readFile(
      scope: DesktopFSScope,
      path: string,
      options?: DesktopFSReadOptions
    ): Promise<ArrayBuffer | string>;
    writeFile(
      scope: DesktopFSScope,
      path: string,
      data: ArrayBuffer | string,
      options?: DesktopFSWriteOptions
    ): Promise<void>;
    deleteFile(scope: DesktopFSScope, path: string): Promise<void>;
    exists(scope: DesktopFSScope, path: string): Promise<boolean>;
    stat(scope: DesktopFSScope, path: string): Promise<DesktopFileStat>;
    move(
      scope: DesktopFSScope,
      sourcePath: string,
      targetPath: string,
      options?: DesktopFSMoveOptions
    ): Promise<void>;
    deleteScope(scope: DesktopFSScope): Promise<void>;
    watch(scope: DesktopFSScope, path?: string): Promise<string>;
    unwatch(watchId: string): Promise<void>;
    onChange(listener: (event: DesktopFSChangeEvent) => void): () => void;
  };
  settings: {
    getGlobalSettings(): Promise<DesktopGlobalSettings>;
    saveGlobalSettings(settings: Partial<DesktopGlobalSettings>): Promise<DesktopGlobalSettings>;
    copyMcpServiceUrl(): Promise<string>;
    toggleDevTools(): Promise<boolean>;
    setLlmApiKey(provider: DesktopLlmProvider, apiKey: string): Promise<boolean>;
    clearLlmApiKey(provider: DesktopLlmProvider): Promise<boolean>;
    createAssistantSession(title?: string, scopeId?: string | null): Promise<DesktopAssistantSessionSummary>;
    listAssistantSessions(scopeId?: string | null): Promise<DesktopAssistantSessionSummary[]>;
    getAssistantSessionMessages(
      sessionId: string,
      scopeId?: string | null
    ): Promise<DesktopAssistantMessage[]>;
    sendAssistantMessage(
      sessionId: string,
      content: string,
      attachments?: DesktopAssistantAttachment[],
      scopeId?: string | null
    ): Promise<DesktopAssistantMessage>;
    cancelAssistantRun(sessionId: string, scopeId?: string | null): Promise<boolean>;
    approveAssistantToolCall(sessionId: string, callId: string, scopeId?: string | null): Promise<boolean>;
    rejectAssistantToolCall(sessionId: string, callId: string, scopeId?: string | null): Promise<boolean>;
    renameAssistantSession(
      sessionId: string,
      title: string,
      scopeId?: string | null
    ): Promise<DesktopAssistantSessionSummary>;
    deleteAssistantSession(sessionId: string, scopeId?: string | null): Promise<boolean>;
    readClipboardImage(): Promise<{ mimeType: string; dataBase64: string } | null>;
    listLlmModels(provider: DesktopLlmProvider, baseUrl: string): Promise<string[]>;
    onAssistantEvent(listener: (event: DesktopAssistantEvent) => void): () => void;
  };
  headless?: {
    reportResult(payload: DesktopHeadlessResult): Promise<void>;
  };
};

/** Result payload reported by the renderer at the end of a one-shot headless run. */
export type DesktopHeadlessResult =
  | { ok: true; width: number; height: number; dataUrl: string }
  | { ok: false; error: string };

declare global {
  interface Window {
    zephyrEditorDesktop?: ZephyrEditorDesktopAPI;
  }
}

export function getDesktopAPI() {
  return globalThis.window?.zephyrEditorDesktop ?? null;
}

export function isDesktopApp() {
  return !!getDesktopAPI();
}
