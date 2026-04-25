import type { EventListener, FileMetadata, Nullable, VFS, IDisposable } from '@zephyr3d/base';
import { Disposable, Observable } from '@zephyr3d/base';
import type { Scene, SceneNode, Camera, PropertyAccessor } from '@zephyr3d/scene';
import { ClipmapTerrain } from '@zephyr3d/scene';
import { ImGui } from '@zephyr3d/imgui';
import type { MenuItemOptions } from '../components/menubar';
import type { ToolBarItem } from '../components/toolbar';
import type { Command, CommandManager } from './command';
import type { Editor } from './editor';
import type { EditTool, EditToolContext } from '../views/edittools/edittool';
import { TerrainEditTool } from '../views/edittools/terrain';
import { ProjectService, type ProjectSettings } from './services/project';
import { DlgMessage } from '../views/dlg/messagedlg';
import { eventBus } from './eventbus';

class EditorPluginSubscription extends Disposable {
  private readonly _disposeCallback: () => void;

  constructor(dispose: () => void) {
    super();
    this._disposeCallback = dispose;
  }

  protected onDispose() {
    this._disposeCallback();
  }
}

type EditorPluginEntry = {
  plugin: EditorPlugin;
  context: Nullable<EditorPluginContext>;
};

export type EditorMenuLocation = 'main' | 'scene-hierarchy' | 'asset-content' | 'asset-directory';

export type EditorMenuItem = Omit<MenuItemOptions, 'enabled' | 'subMenus'> & {
  visible?: (ctx: EditorMenuContext) => boolean;
  enabled?: (ctx: EditorMenuContext) => boolean;
  subMenus?: EditorMenuItem[];
};

export type EditorMenuContribution = {
  location: EditorMenuLocation;
  parentId?: string;
  items: EditorMenuItem[] | ((ctx: EditorMenuContext) => EditorMenuItem[]);
};

export type EditorToolbarContribution = ToolBarItem | ((ctx: EditorToolbarContext) => ToolBarItem);

export type EditorEditToolFactory = {
  id: string;
  canEdit: (obj: unknown, ctx: EditorEditToolFactoryContext) => boolean;
  create: (obj: unknown, ctx: EditorEditToolFactoryContext) => Nullable<EditTool>;
  priority?: number;
};

export type EditorPlugin = {
  id: string;
  name?: string;
  version?: string;
  description?: string;
  activate: (ctx: EditorPluginContext) => void | Promise<void>;
  deactivate?: (ctx: EditorPluginContext) => void | Promise<void>;
};

export type EditorSceneContext = {
  editor: Editor;
  scene: Nullable<Scene>;
  selectedNodes: readonly SceneNode[];
  activeNode: Nullable<SceneNode>;
  commandManager: CommandManager;
  executeCommand<T>(command: Command<T>): Promise<T>;
  notifySceneChanged(): void;
  refreshProperties(): void;
  getCamera(): Nullable<Camera>;
  getViewportRect(): readonly [number, number, number, number] | null;
};

export type EditorAssetContext = {
  editor: Editor;
  vfs: VFS;
  selectedDir: Nullable<{ path: string }>;
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

export type EditorEditToolFactoryContext = EditToolContext & {
  editor: Editor;
};

export type EditorPropertyAccessorProvider = (
  object: unknown
) => PropertyAccessor<any>[] | Promise<PropertyAccessor<any>[]>;

export type EditorEventMap = {
  pluginContributionsChanged: [];
  sceneOpening: [path: string];
  sceneOpened: [scene: Scene, path: string];
  sceneCreated: [scene: Scene, path: string];
  sceneSaving: [scene: Scene, path: string];
  sceneSaved: [scene: Scene, path: string];
  sceneDirty: [scene: Scene];
  selectionChanged: [selectedNodes: readonly SceneNode[], activeNode: Nullable<SceneNode>];
  nodeAdded: [node: SceneNode];
  nodeRemoved: [node: SceneNode];
  nodeDeleted: [node: SceneNode];
  nodeTransformed: [node: SceneNode | readonly SceneNode[]];
  propertyChanged: [target: Nullable<object>, prop: PropertyAccessor];
  propertyEditFinished: [
    target: Nullable<object>,
    prop: PropertyAccessor,
    oldValue: unknown,
    newValue: unknown
  ];
  editToolActivated: [tool: EditTool, target: unknown];
  editToolDeactivated: [tool: EditTool, target: unknown];
  assetSelectionChanged: [ctx: EditorAssetContext];
};

export class EditorPluginManager extends Observable<EditorEventMap> {
  private readonly _editor: Editor;
  private readonly _plugins = new Map<string, EditorPluginEntry>();
  private readonly _activePlugins = new Set<string>();
  private readonly _mainMenuItems: EditorMenuContribution[] = [];
  private readonly _contextMenuItems: EditorMenuContribution[] = [];
  private readonly _toolbarItems: EditorToolbarContribution[] = [];
  private readonly _editToolFactories: EditorEditToolFactory[] = [];
  private readonly _propertyAccessorProviders = new Map<string, EditorPropertyAccessorProvider>();

  constructor(editor: Editor) {
    super();
    this._editor = editor;
    this.registerBuiltinContributions();
  }

  get editor() {
    return this._editor;
  }

  registerPlugin(plugin: EditorPlugin) {
    if (this._plugins.has(plugin.id)) {
      throw new Error(`Editor plugin '${plugin.id}' already registered`);
    }
    this._plugins.set(plugin.id, { plugin, context: null });
  }

  async activatePlugin(id: string) {
    const entry = this._plugins.get(id);
    if (!entry) {
      throw new Error(`Editor plugin '${id}' is not registered`);
    }
    if (!this._activePlugins.has(id)) {
      const context = this.createPluginContext(entry.plugin);
      await entry.plugin.activate(context);
      entry.context = context;
      this._activePlugins.add(id);
    }
  }

  async deactivatePlugin(id: string) {
    const entry = this._plugins.get(id);
    if (entry && this._activePlugins.has(id)) {
      const context = entry.context ?? this.createPluginContext(entry.plugin);
      await entry.plugin.deactivate?.(context);
      for (const subscription of context.subscriptions.splice(0)) {
        subscription.dispose();
      }
      entry.context = null;
      this._activePlugins.delete(id);
    }
  }

  async activateAll() {
    for (const id of this._plugins.keys()) {
      await this.activatePlugin(id);
    }
  }

  hasPlugin(id: string) {
    return this._plugins.has(id);
  }

  unregisterPlugin(id: string) {
    if (this._activePlugins.has(id)) {
      throw new Error(`Editor plugin '${id}' is still active`);
    }
    this._plugins.delete(id);
  }

  isPluginActive(id: string) {
    return this._activePlugins.has(id);
  }

  addMenuItems(contribution: EditorMenuContribution) {
    const list = contribution.location === 'main' ? this._mainMenuItems : this._contextMenuItems;
    list.push(contribution);
    this.dispatchContributionChanged();
    const dispose = () => {
      const index = list.indexOf(contribution);
      if (index >= 0) {
        list.splice(index, 1);
        this.dispatchContributionChanged();
      }
    };
    return dispose;
  }

  addToolbarItem(item: EditorToolbarContribution) {
    this._toolbarItems.push(item);
    this.dispatchContributionChanged();
    return () => {
      const index = this._toolbarItems.indexOf(item);
      if (index >= 0) {
        this._toolbarItems.splice(index, 1);
        this.dispatchContributionChanged();
      }
    };
  }

  addEditToolFactory(factory: EditorEditToolFactory) {
    if (this._editToolFactories.some((item) => item.id === factory.id)) {
      throw new Error(`Editor edit tool factory '${factory.id}' already registered`);
    }
    this._editToolFactories.push(factory);
    this._editToolFactories.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
    this.dispatchContributionChanged();
    return () => {
      const index = this._editToolFactories.indexOf(factory);
      if (index >= 0) {
        this._editToolFactories.splice(index, 1);
        this.dispatchContributionChanged();
      }
    };
  }

  addPropertyAccessorProvider(id: string, provider: EditorPropertyAccessorProvider) {
    if (this._propertyAccessorProviders.has(id)) {
      throw new Error(`Editor property accessor provider '${id}' already registered`);
    }
    this._propertyAccessorProviders.set(id, provider);
    this.dispatchContributionChanged();
    return () => {
      if (this._propertyAccessorProviders.delete(id)) {
        this.dispatchContributionChanged();
      }
    };
  }

  async getPropertyAccessors(object: unknown) {
    const results = await Promise.all(
      [...this._propertyAccessorProviders.values()].map((provider) => Promise.resolve(provider(object)))
    );
    return results.flatMap((props) => props ?? []);
  }

  getContextMenuItems(location: EditorMenuLocation, ctx: EditorMenuContext) {
    return this._contextMenuItems
      .filter((contribution) => contribution.location === location)
      .flatMap((contribution) => this.resolveMenuItems(contribution, ctx));
  }

  getToolbarItems(ctx: EditorToolbarContext) {
    return this._toolbarItems
      .map((item) => (typeof item === 'function' ? item(ctx) : item))
      .filter((item): item is ToolBarItem => !!item);
  }

  canEditObject(obj: unknown, ctx: EditorEditToolFactoryContext) {
    return this._editToolFactories.some((factory) => factory.canEdit(obj, ctx));
  }

  createEditTool(obj: unknown, ctx: EditorEditToolFactoryContext): Nullable<EditTool> {
    const factory = this._editToolFactories.find((item) => item.canEdit(obj, ctx));
    return factory?.create(obj, ctx) ?? null;
  }

  applyMainMenuContributions(items: MenuItemOptions[], ctx: EditorMenuContext) {
    for (const contribution of this._mainMenuItems) {
      const contributed = this.resolveMenuItems(contribution, ctx);
      if (contributed.length === 0) {
        continue;
      }
      const normalized = this.toMenuItemOptions(contributed, ctx);
      if (contribution.parentId) {
        const parent = this.findMenuItem(items, contribution.parentId);
        if (parent) {
          parent.subMenus = [...(parent.subMenus ?? []), ...normalized];
        } else {
          items.push(...normalized);
        }
      } else {
        items.push(...normalized);
      }
    }
  }

  renderMenuItems(items: readonly EditorMenuItem[], ctx: EditorMenuContext) {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.visible && !item.visible(ctx)) {
        continue;
      }
      if (item.label === '-') {
        ImGui.Separator();
        continue;
      }
      if (item.subMenus?.length) {
        if (ImGui.BeginMenu(`${item.label}##${item.id ?? item.label}`)) {
          this.renderMenuItems(item.subMenus, ctx);
          ImGui.EndMenu();
        }
      } else if (
        ImGui.MenuItem(
          `${item.label}##${item.id ?? item.label}`,
          item.shortCut ?? null,
          !!item.checked?.(),
          item.enabled?.(ctx) ?? true
        )
      ) {
        item.action?.();
      }
    }
  }

  toMenuItemOptions(items: readonly EditorMenuItem[], ctx: EditorMenuContext): MenuItemOptions[] {
    return items.map((item) => ({
      label: item.label,
      shortCut: item.shortCut,
      id: item.id,
      action: item.action,
      checked: item.checked,
      enabled: item.enabled ? () => item.enabled(ctx) : undefined,
      subMenus: item.subMenus ? this.toMenuItemOptions(item.subMenus, ctx) : undefined
    }));
  }

  private createPluginContext(plugin: EditorPlugin): EditorPluginContext {
    const context: EditorPluginContext = {
      editor: this._editor,
      events: this,
      project: {
        isReadOnly: () => this._editor.isProjectReadOnly(),
        getSettings: () => ProjectService.getCurrentProjectSettings(),
        saveSettings: (settings) => ProjectService.saveCurrentProjectSettings(settings),
        exists: (path) => this._editor.projectFileExists(path),
        ensureDirectory: (path) => this._editor.ensureProjectDirectory(path),
        readText: (path) => this._editor.readProjectTextFile(path),
        writeText: (path, content) => this._editor.writeProjectTextFile(path, content),
        openCode: (path, language) => this._editor.openProjectCodeFile(path, language)
      },
      system: {
        getState: <T = unknown>() => this._editor.getPluginState<T>(plugin.id),
        saveState: <T = unknown>(state: T) => this._editor.savePluginState(plugin.id, state)
      },
      ui: {
        message: (title, message, width, height) => DlgMessage.messageBox(title, message, width, height)
      },
      refreshProperties: () => eventBus.dispatchEvent('refresh_properties'),
      notifySceneChanged: () => eventBus.dispatchEvent('scene_changed'),
      registerMenuItems: (contribution) => {
        const dispose = this.addMenuItems(contribution);
        context.subscriptions.push(new EditorPluginSubscription(dispose));
        return dispose;
      },
      registerToolbarItem: (item) => {
        const dispose = this.addToolbarItem(item);
        context.subscriptions.push(new EditorPluginSubscription(dispose));
        return dispose;
      },
      registerEditTool: (factory) => {
        const dispose = this.addEditToolFactory(factory);
        context.subscriptions.push(new EditorPluginSubscription(dispose));
        return dispose;
      },
      registerPropertyAccessors: (providerId, provider) => {
        const dispose = this.addPropertyAccessorProvider(`${plugin.id}:${providerId}`, provider);
        context.subscriptions.push(new EditorPluginSubscription(dispose));
        return dispose;
      },
      on: (type, listener, listenerContext) => {
        const eventContext = listenerContext ?? context;
        this.on(type, listener as EventListener<EditorEventMap, keyof EditorEventMap>, eventContext);
        const subscription = new EditorPluginSubscription(() =>
          this.off(type, listener as EventListener<EditorEventMap, keyof EditorEventMap>, eventContext)
        );
        context.subscriptions.push(subscription);
        return subscription;
      },
      subscriptions: [],
      log: (...args) => console.info(`[editor-plugin:${plugin.id}]`, ...args)
    };
    return {
      ...context
    };
  }

  private resolveMenuItems(contribution: EditorMenuContribution, ctx: EditorMenuContext): EditorMenuItem[] {
    const items = typeof contribution.items === 'function' ? contribution.items(ctx) : contribution.items;
    return (items ?? []).filter((item) => !item.visible || item.visible(ctx));
  }

  private findMenuItem(items: MenuItemOptions[], id: string): Nullable<MenuItemOptions> {
    for (const item of items) {
      if (item.id === id) {
        return item;
      }
      const found = item.subMenus ? this.findMenuItem(item.subMenus, id) : null;
      if (found) {
        return found;
      }
    }
    return null;
  }

  private registerBuiltinContributions() {
    this.addEditToolFactory({
      id: 'zephyr3d.editor.terrain-edit-tool',
      canEdit: (obj) => obj instanceof ClipmapTerrain,
      create: (obj, ctx) => (obj instanceof ClipmapTerrain ? new TerrainEditTool(ctx.editor, obj) : null)
    });
  }

  private dispatchContributionChanged() {
    this.dispatchEvent('pluginContributionsChanged');
  }
}

export type EditorPluginContext = {
  editor: Editor;
  events: EditorPluginManager;
  project: {
    isReadOnly(): boolean;
    getSettings(): Promise<ProjectSettings>;
    saveSettings(settings: ProjectSettings): Promise<void>;
    exists(path: string): Promise<boolean>;
    ensureDirectory(path: string): Promise<void>;
    readText(path: string): Promise<Nullable<string>>;
    writeText(path: string, content: string): Promise<void>;
    openCode(path: string, language?: string): Promise<void>;
  };
  system: {
    getState<T = unknown>(): Promise<Nullable<T>>;
    saveState<T = unknown>(state: T): Promise<void>;
  };
  ui: {
    message(title: string, message: string, width?: number, height?: number): Promise<void>;
  };
  refreshProperties(): void;
  notifySceneChanged(): void;
  registerMenuItems(contribution: EditorMenuContribution): () => void;
  registerToolbarItem(item: EditorToolbarContribution): () => void;
  registerEditTool(factory: EditorEditToolFactory): () => void;
  registerPropertyAccessors(id: string, provider: EditorPropertyAccessorProvider): () => void;
  /**
   * Subscribe to editor events. Subscriptions are automatically disposed when the plugin is deactivated.
   */
  on<K extends keyof EditorEventMap>(
    type: K,
    listener: EventListener<EditorEventMap, K>,
    context?: unknown
  ): IDisposable;
  subscriptions: IDisposable[];
  log(...args: unknown[]): void;
};
