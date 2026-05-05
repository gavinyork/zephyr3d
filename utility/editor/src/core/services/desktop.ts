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

export type DesktopFileMetadata = {
  name: string;
  path: string;
  size: number;
  type: 'file' | 'directory';
  created: string;
  modified: string;
};

export type DesktopFileStat = {
  size: number;
  isFile: boolean;
  isDirectory: boolean;
  created: string;
  modified: string;
  accessed?: string;
};

export type DesktopMcpSettings = {
  enabled: boolean;
  port: number;
  running: boolean;
  url: string;
};

export type DesktopGlobalSettings = {
  mcp: DesktopMcpSettings | null;
  defaultRHI: 'webgpu' | 'webgl2' | 'webgl';
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
    pickDirectory(options?: DesktopDirectoryPickOptions): Promise<string | null>;
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
  };
  settings: {
    getGlobalSettings(): Promise<DesktopGlobalSettings>;
    saveGlobalSettings(settings: Partial<DesktopGlobalSettings>): Promise<DesktopGlobalSettings>;
    copyMcpServiceUrl(): Promise<string>;
    toggleDevTools(): Promise<boolean>;
  };
};

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
