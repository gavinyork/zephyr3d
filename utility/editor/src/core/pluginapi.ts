export type DisposableLike = {
  dispose(): void;
};

export type EditorProjectInfo = {
  uuid: string;
  name: string;
  lastEditScene?: string;
};

export type EditorHost = {
  currentProject: EditorProjectInfo | null;
};

export type EditorMenuLocation = 'main' | 'scene-hierarchy' | 'asset-content' | 'asset-directory';

export type EditorMenuItem = {
  id?: string;
  label: string;
  shortCut?: string;
  visible?: (ctx: EditorMenuContext) => boolean;
  enabled?: (ctx: EditorMenuContext) => boolean;
  checked?: () => boolean;
  action?: () => void;
  subMenus?: EditorMenuItem[];
};

export type EditorMenuContribution = {
  location: EditorMenuLocation;
  parentId?: string;
  items: EditorMenuItem[] | ((ctx: EditorMenuContext) => EditorMenuItem[]);
};

export type EditorToolbarItem = {
  label?: string;
  shortcut?: string;
  tooltip?: () => string;
  visible?: () => boolean;
  selected?: () => boolean;
  render?: () => boolean;
  action?: () => void;
};

export type EditorToolbarContribution =
  | EditorToolbarItem
  | ((ctx: EditorToolbarContext) => EditorToolbarItem | null | undefined);

export type EditorEditToolFactory = {
  id: string;
  canEdit: (obj: unknown, ctx: EditorEditToolFactoryContext) => boolean;
  create: (obj: unknown, ctx: EditorEditToolFactoryContext) => unknown | null;
  priority?: number;
};

export type EditorSceneContext = {
  editor: EditorHost;
  scene: unknown | null;
  selectedNodes: readonly unknown[];
  activeNode: unknown | null;
  commandManager: unknown;
  executeCommand<T>(command: unknown): Promise<T>;
  notifySceneChanged(): void;
  refreshProperties(): void;
  getCamera(): unknown | null;
  getViewportRect(): readonly [number, number, number, number] | null;
};

export type EditorAssetContext = {
  editor: EditorHost;
  vfs: unknown;
  selectedDir: { path: string } | null;
  selectedFiles: readonly { meta: { path: string; name?: string; size?: number } }[];
  selectedItems: readonly unknown[];
};

export type EditorMenuContext = {
  location: EditorMenuLocation;
  scene?: EditorSceneContext;
  assets?: EditorAssetContext;
  target?: unknown;
};

export type EditorToolbarContext = {
  scene: EditorSceneContext;
};

export type EditorEditToolFactoryContext = {
  editor: EditorHost;
  executeCommand<T>(command: unknown): Promise<T>;
  notifySceneChanged(): void;
  refreshProperties(): void;
  getCamera(): unknown | null;
  getViewportRect(): readonly [number, number, number, number] | null;
};

export type EditorEventMap = {
  sceneOpening: [path: string];
  sceneOpened: [scene: unknown, path: string];
  sceneCreated: [scene: unknown, path: string];
  sceneSaving: [scene: unknown, path: string];
  sceneSaved: [scene: unknown, path: string];
  sceneDirty: [scene: unknown];
  selectionChanged: [selectedNodes: readonly unknown[], activeNode: unknown | null];
  nodeAdded: [node: unknown];
  nodeRemoved: [node: unknown];
  nodeDeleted: [node: unknown];
  nodeTransformed: [node: unknown];
  propertyChanged: [target: object | null, prop: unknown];
  propertyEditFinished: [target: object | null, prop: unknown, oldValue: unknown, newValue: unknown];
  editToolActivated: [tool: unknown, target: unknown];
  editToolDeactivated: [tool: unknown, target: unknown];
  assetSelectionChanged: [ctx: EditorAssetContext];
};

export type EditorEventSource = {
  dispatchEvent<K extends keyof EditorEventMap>(type: K, ...args: EditorEventMap[K]): void;
};

export type EditorPluginContext = {
  editor: EditorHost;
  events: EditorEventSource;
  project: {
    getSettings(): Promise<Record<string, unknown> | null>;
    saveSettings(settings: Record<string, unknown>): Promise<void>;
  };
  system: {
    getState<T = unknown>(): Promise<T | null>;
    saveState<T = unknown>(state: T): Promise<void>;
  };
  ui: {
    message(title: string, message: string, width?: number, height?: number): Promise<void>;
  };
  registerMenuItems(contribution: EditorMenuContribution): () => void;
  registerToolbarItem(item: EditorToolbarContribution): () => void;
  registerEditTool(factory: EditorEditToolFactory): () => void;
  on<K extends keyof EditorEventMap>(
    type: K,
    listener: (...args: EditorEventMap[K]) => void,
    context?: unknown
  ): DisposableLike;
  subscriptions: DisposableLike[];
  log(...args: unknown[]): void;
};

export type EditorPlugin = {
  id: string;
  name?: string;
  version?: string;
  description?: string;
  activate: (ctx: EditorPluginContext) => void | Promise<void>;
  deactivate?: (ctx: EditorPluginContext) => void | Promise<void>;
};
