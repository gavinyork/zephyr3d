import type { FileMetadata, IDisposable, Vector3, VFS } from '@zephyr3d/base';
import type { Mesh, PropertyAccessor, Scene, SceneNode } from '@zephyr3d/scene';

export type EditorDirectoryInfo = {
  path: string;
  files: EditorFileInfo[];
  subDir: EditorDirectoryInfo[];
  parent: EditorDirectoryInfo | null;
  open: boolean;
};

export type EditorFileInfo = {
  meta: FileMetadata;
  parent: EditorDirectoryInfo | null;
};

export type DisposableLike = IDisposable;

export type EditorProjectInfo = {
  uuid?: string;
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
  label: string;
  shortcut?: string;
  tooltip?: () => string;
  visible?: () => boolean;
  selected?: () => boolean;
  render?: (buttonSize: unknown) => boolean;
  action?: () => void;
};

export type EditorToolbarContribution =
  | EditorToolbarItem
  | ((ctx: EditorToolbarContext) => EditorToolbarItem);

export type EditorEditToolFactory = {
  id: string;
  canEdit: (obj: unknown, ctx: EditorEditToolFactoryContext) => boolean;
  create: (obj: unknown, ctx: EditorEditToolFactoryContext) => unknown | null;
  priority?: number;
};

export type EditorPropertyAccessorProvider = (
  object: unknown
) => PropertyAccessor<any>[] | Promise<PropertyAccessor<any>[]>;

export type EditorCommands = {
  addChildNode<T extends SceneNode = SceneNode>(
    parent: SceneNode,
    ctor: { new (scene: Scene): T },
    position?: Vector3
  ): Promise<T>;
  addShapeNode<T extends 'box' | 'sphere' | 'plane' | 'cylinder' | 'torus' | 'tetrahedron'>(
    scene: Scene,
    type: T,
    position?: Vector3
  ): Promise<Mesh>;
  instantiatePrefab(scene: Scene, prefabPath: string, position?: Vector3): Promise<SceneNode>;
  deleteNode(node: SceneNode): Promise<void>;
  reparentNode(node: SceneNode, newParent: SceneNode): Promise<void>;
  cloneNode(node: SceneNode): Promise<SceneNode>;
  executeCommand<T>(command: unknown): Promise<T>;
  executeUserCallback<T>(execute: () => T | Promise<T>, undo: () => void | Promise<void>): Promise<null | T>;
};

export type EditorSceneContext = {
  editor: EditorHost;
  scene: unknown | null;
  selectedNodes: readonly unknown[];
  activeNode: unknown | null;
  commands: EditorCommands;
  notifySceneChanged(): void;
  refreshProperties(): void;
  getCamera(): unknown | null;
  getViewportRect(): readonly [number, number, number, number] | null;
};

export type EditorAssetContext = {
  editor: EditorHost;
  vfs: VFS;
  selectedDir: { path: string } | null;
  selectedFiles: readonly { meta: FileMetadata }[];
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
  scene: EditorSceneContext;
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

export type EditorPluginSettingOption<T extends string | number = string | number> = {
  label: string;
  value: T;
};

export type EditorPluginStringSetting = {
  type: 'string';
  label?: string;
  description?: string;
  default?: string;
  placeholder?: string;
  secret?: boolean;
  multiline?: boolean;
  options?: EditorPluginSettingOption<string>[];
};

export type EditorPluginNumberSetting = {
  type: 'number';
  label?: string;
  description?: string;
  default?: number;
  placeholder?: string;
  integer?: boolean;
  min?: number;
  max?: number;
  step?: number;
  options?: EditorPluginSettingOption<number>[];
};

export type EditorPluginBooleanSetting = {
  type: 'boolean';
  label?: string;
  description?: string;
  default?: boolean;
};

export type EditorPluginSetting =
  | EditorPluginStringSetting
  | EditorPluginNumberSetting
  | EditorPluginBooleanSetting;

export type EditorPluginSettingsSchema = Record<string, EditorPluginSetting>;

export type EditorPluginContext = {
  editor: EditorHost;
  events: EditorEventSource;
  project: {
    isReadOnly(): boolean;
    getSettings(): Promise<Record<string, unknown> | null>;
    saveSettings(settings: Record<string, unknown>): Promise<void>;
    exists(path: string): Promise<boolean>;
    ensureDirectory(path: string): Promise<void>;
    readText(path: string): Promise<string | null>;
    readBinary(path: string): Promise<ArrayBuffer>;
    writeText(path: string, content: string): Promise<void>;
    writeBinary(path: string, data: string | ArrayBuffer): Promise<void>;
    openCode(path: string, language?: string): Promise<void>;
  };
  system: {
    getState<T = unknown>(): Promise<T | null>;
    saveState<T = unknown>(state: T): Promise<void>;
    getSettings<T = Record<string, unknown>>(): Promise<T | null>;
    saveSettings<T = Record<string, unknown>>(settings: T): Promise<void>;
  };
  ui: {
    message(title: string, message: string, width?: number, height?: number): Promise<void>;
    confirm(title: string, message: string, okLabel?: string, cancelLabel?: string): Promise<boolean>;
    selectProjectFiles(
      title: string,
      rootDir: string,
      multi?: boolean,
      filter?: string,
      width?: number,
      height?: number
    ): Promise<EditorFileInfo[]>;
    selectProjectFolders(
      title: string,
      rootDir: string,
      multi?: boolean,
      width?: number,
      height?: number
    ): Promise<EditorDirectoryInfo[]>;
  };
  refreshProperties(): void;
  notifySceneChanged(): void;
  registerMenuItems(contribution: EditorMenuContribution): () => void;
  registerToolbarItem(item: EditorToolbarContribution): () => void;
  registerEditTool(factory: EditorEditToolFactory): () => void;
  registerPropertyAccessors(id: string, provider: EditorPropertyAccessorProvider): () => void;
  on<K extends keyof EditorEventMap>(
    type: K,
    listener: (...args: EditorEventMap[K]) => void,
    context?: unknown
  ): DisposableLike;
  subscriptions: DisposableLike[];
  log(...args: unknown[]): void;
};

export type EditorPluginMetadata = {
  id: string;
  name?: string;
  version?: string;
  description?: string;
};

export type EditorPluginDefinition = Partial<EditorPluginMetadata> & {
  settings?: EditorPluginSettingsSchema;
  activate: (ctx: EditorPluginContext) => void | Promise<void>;
  deactivate?: (ctx: EditorPluginContext) => void | Promise<void>;
};

export type EditorPlugin = EditorPluginMetadata & {
  settings?: EditorPluginSettingsSchema;
  activate: (ctx: EditorPluginContext) => void | Promise<void>;
  deactivate?: (ctx: EditorPluginContext) => void | Promise<void>;
};
