import type { EventListener, FileMetadata, Nullable, VFS } from '@zephyr3d/base';
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
import { ProjectService } from './services/project';
import { DlgMessage } from '../views/dlg/messagedlg';
import { DlgMessageBoxEx } from '../views/dlg/messageexdlg';
import { eventBus } from './eventbus';
import type {
  EditorMenuLocation as PublicEditorMenuLocation,
  EditorMenuItem as PublicEditorMenuItem,
  EditorMenuContribution as PublicEditorMenuContribution,
  EditorToolbarContribution as PublicEditorToolbarContribution,
  EditorEditToolFactory as PublicEditorEditToolFactory,
  EditorSceneContext as PublicEditorSceneContext,
  EditorAssetContext as PublicEditorAssetContext,
  EditorMenuContext as PublicEditorMenuContext,
  EditorToolbarContext as PublicEditorToolbarContext,
  EditorEditToolFactoryContext as PublicEditorEditToolFactoryContext,
  EditorPropertyAccessorProvider as PublicEditorPropertyAccessorProvider,
  EditorEventMap as PublicEditorEventMap,
  EditorPlugin as PublicEditorPlugin,
  EditorPluginContext as PublicEditorPluginContext,
  EditorPluginSetting as PublicEditorPluginSetting,
  EditorPluginSettingsSchema as PublicEditorPluginSettingsSchema
} from './pluginapi';
import { Dialog } from '../views/dlg/dlg';

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

export type EditorMenuLocation = PublicEditorMenuLocation;
export type EditorMenuItem = PublicEditorMenuItem;
export type EditorMenuContribution = PublicEditorMenuContribution;
export type EditorToolbarContribution = PublicEditorToolbarContribution;
export type EditorEditToolFactory = PublicEditorEditToolFactory;
export type EditorSceneContext = PublicEditorSceneContext;
export type EditorAssetContext = PublicEditorAssetContext;
export type EditorMenuContext = PublicEditorMenuContext;
export type EditorToolbarContext = PublicEditorToolbarContext;
export type EditorEditToolFactoryContext = PublicEditorEditToolFactoryContext;
export type EditorPropertyAccessorProvider = PublicEditorPropertyAccessorProvider;
export type EditorEventMap = PublicEditorEventMap;
export type EditorPlugin = PublicEditorPlugin;
export type EditorPluginContext = PublicEditorPluginContext;
export type EditorPluginSetting = PublicEditorPluginSetting;
export type EditorPluginSettingsSchema = PublicEditorPluginSettingsSchema;

function normalizePluginSettings(
  schema: EditorPluginSettingsSchema | undefined,
  settings: Record<string, unknown> | null | undefined
) {
  if (!schema) {
    return settings ? { ...settings } : null;
  }
  const result: Record<string, unknown> = {};
  for (const [key, descriptor] of Object.entries(schema)) {
    const value = settings?.[key];
    if (value === undefined || value === null) {
      if (descriptor.default !== undefined) {
        result[key] = descriptor.default;
      }
      continue;
    }
    if (descriptor.type === 'boolean') {
      result[key] = !!value;
      continue;
    }
    if (descriptor.type === 'number') {
      if (typeof value === 'number' && Number.isFinite(value)) {
        result[key] = value;
      } else if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
        result[key] = Number(value);
      } else if (descriptor.default !== undefined) {
        result[key] = descriptor.default;
      }
      continue;
    }
    result[key] = typeof value === 'string' ? value : String(value);
  }
  return result;
}

export type InternalEditorMenuItem = Omit<MenuItemOptions, 'enabled' | 'subMenus'> & {
  visible?: (ctx: InternalEditorMenuContext) => boolean;
  enabled?: (ctx: InternalEditorMenuContext) => boolean;
  subMenus?: InternalEditorMenuItem[];
};

export type InternalEditorMenuContribution = {
  location: EditorMenuLocation;
  parentId?: string;
  items: InternalEditorMenuItem[] | ((ctx: InternalEditorMenuContext) => InternalEditorMenuItem[]);
};

export type InternalEditorToolbarContribution =
  | ToolBarItem
  | ((ctx: InternalEditorToolbarContext) => ToolBarItem);

export type InternalEditorEditToolFactory = {
  id: string;
  canEdit: (obj: unknown, ctx: InternalEditorEditToolFactoryContext) => boolean;
  create: (obj: unknown, ctx: InternalEditorEditToolFactoryContext) => Nullable<EditTool>;
  priority?: number;
};

export type InternalEditorSceneContext = {
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

export type InternalEditorAssetContext = {
  editor: Editor;
  vfs: VFS;
  selectedDir: Nullable<{ path: string }>;
  selectedFiles: readonly { meta: FileMetadata }[];
  selectedItems: readonly unknown[];
};

export type InternalEditorMenuContext = {
  location: EditorMenuLocation;
  scene?: InternalEditorSceneContext;
  assets?: InternalEditorAssetContext;
  target?: unknown;
};

export type InternalEditorToolbarContext = {
  scene: InternalEditorSceneContext;
};

export type InternalEditorEditToolFactoryContext = EditToolContext & {
  editor: Editor;
};

export type InternalEditorPropertyAccessorProvider = (
  object: unknown
) => PropertyAccessor<any>[] | Promise<PropertyAccessor<any>[]>;

export type InternalEditorEventMap = {
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
  assetSelectionChanged: [ctx: InternalEditorAssetContext];
};

type EditorPluginEntry = {
  plugin: EditorPlugin;
  context: Nullable<EditorPluginContext>;
};

export class EditorPluginManager extends Observable<InternalEditorEventMap> {
  private readonly _editor: Editor;
  private readonly _plugins = new Map<string, EditorPluginEntry>();
  private readonly _activePlugins = new Set<string>();
  private readonly _mainMenuItems: InternalEditorMenuContribution[] = [];
  private readonly _contextMenuItems: InternalEditorMenuContribution[] = [];
  private readonly _toolbarItems: InternalEditorToolbarContribution[] = [];
  private readonly _editToolFactories: InternalEditorEditToolFactory[] = [];
  private readonly _propertyAccessorProviders = new Map<string, InternalEditorPropertyAccessorProvider>();

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

  getPlugin(id: string) {
    return this._plugins.get(id)?.plugin ?? null;
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

  addMenuItems(contribution: InternalEditorMenuContribution) {
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

  addToolbarItem(item: InternalEditorToolbarContribution) {
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

  addEditToolFactory(factory: InternalEditorEditToolFactory) {
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

  addPropertyAccessorProvider(id: string, provider: InternalEditorPropertyAccessorProvider) {
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

  getContextMenuItems(location: EditorMenuLocation, ctx: InternalEditorMenuContext) {
    return this._contextMenuItems
      .filter((contribution) => contribution.location === location)
      .flatMap((contribution) => this.resolveMenuItems(contribution, ctx));
  }

  getToolbarItems(ctx: InternalEditorToolbarContext) {
    return this._toolbarItems
      .map((item) => (typeof item === 'function' ? item(ctx) : item))
      .filter((item): item is ToolBarItem => !!item);
  }

  canEditObject(obj: unknown, ctx: InternalEditorEditToolFactoryContext) {
    return this._editToolFactories.some((factory) => factory.canEdit(obj, ctx));
  }

  createEditTool(obj: unknown, ctx: InternalEditorEditToolFactoryContext): Nullable<EditTool> {
    const factory = this._editToolFactories.find((item) => item.canEdit(obj, ctx));
    return factory?.create(obj, ctx) ?? null;
  }

  applyMainMenuContributions(items: MenuItemOptions[], ctx: InternalEditorMenuContext) {
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

  renderMenuItems(items: readonly InternalEditorMenuItem[], ctx: InternalEditorMenuContext) {
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

  toMenuItemOptions(
    items: readonly InternalEditorMenuItem[],
    ctx: InternalEditorMenuContext
  ): MenuItemOptions[] {
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
    const context = {
      editor: this._editor as unknown as EditorPluginContext['editor'],
      events: this,
      project: {
        isReadOnly: () => this._editor.isProjectReadOnly(),
        getSettings: () => ProjectService.getCurrentProjectSettings(),
        saveSettings: (settings) => ProjectService.saveCurrentProjectSettings(settings),
        exists: (path) => this._editor.projectFileExists(path),
        ensureDirectory: (path) => this._editor.ensureProjectDirectory(path),
        readText: (path) => this._editor.readProjectTextFile(path),
        readBinary: async (path) =>
          (await ProjectService.VFS.readFile(path, { encoding: 'binary' })) as ArrayBuffer,
        writeText: (path, content) => this._editor.writeProjectTextFile(path, content),
        writeBinary: async (path, data) =>
          await ProjectService.VFS.writeFile(path, data, { encoding: 'binary' }),
        openCode: (path, language) => this._editor.openProjectCodeFile(path, language)
      },
      system: {
        getState: <T = unknown>() => this._editor.getPluginState<T>(plugin.id),
        saveState: <T = unknown>(state: T) => this._editor.savePluginState(plugin.id, state),
        getSettings: async <T = Record<string, unknown>>() =>
          normalizePluginSettings(
            plugin.settings,
            (await this._editor.getPluginSettings<Record<string, unknown>>(plugin.id)) ?? null
          ) as T | null,
        saveSettings: async <T extends Record<string, unknown> = Record<string, unknown>>(settings: T) =>
          this._editor.savePluginSettings(
            plugin.id,
            normalizePluginSettings(plugin.settings, settings) as Record<string, unknown>
          )
      },
      ui: {
        message: (title, message, width, height) => DlgMessage.messageBox(title, message, width, height),
        confirm: async (title, message, okLabel = 'Ok', cancelLabel = 'Cancel') =>
          (await DlgMessageBoxEx.messageBoxEx(title, message, [okLabel, cancelLabel], 420, 0, true)) ===
          okLabel,
        selectProjectFiles: async (title, rootDir, multi, filter, width, height) =>
          await Dialog.openFile(title, ProjectService.VFS, rootDir, filter, multi, width, height),
        selectProjectFolders: async (title, rootDir, multi, width, height) =>
          await Dialog.openFolder(title, ProjectService.VFS, rootDir, multi, width, height)
      },
      refreshProperties: () => eventBus.dispatchEvent('refresh_properties'),
      notifySceneChanged: () => eventBus.dispatchEvent('scene_changed'),
      registerMenuItems: (contribution: EditorMenuContribution) => {
        const dispose = this.addMenuItems(contribution as unknown as InternalEditorMenuContribution);
        context.subscriptions.push(new EditorPluginSubscription(dispose));
        return dispose;
      },
      registerToolbarItem: (item: EditorToolbarContribution) => {
        const dispose = this.addToolbarItem(item as InternalEditorToolbarContribution);
        context.subscriptions.push(new EditorPluginSubscription(dispose));
        return dispose;
      },
      registerEditTool: (factory: EditorEditToolFactory) => {
        const dispose = this.addEditToolFactory(factory as unknown as InternalEditorEditToolFactory);
        context.subscriptions.push(new EditorPluginSubscription(dispose));
        return dispose;
      },
      registerPropertyAccessors: (providerId: string, provider: EditorPropertyAccessorProvider) => {
        const dispose = this.addPropertyAccessorProvider(`${plugin.id}:${providerId}`, provider);
        context.subscriptions.push(new EditorPluginSubscription(dispose));
        return dispose;
      },
      on: (type, listener, listenerContext) => {
        const eventContext = listenerContext ?? context;
        this.on(
          type as keyof InternalEditorEventMap,
          listener as EventListener<InternalEditorEventMap, keyof InternalEditorEventMap>,
          eventContext
        );
        const subscription = new EditorPluginSubscription(() =>
          this.off(
            type as keyof InternalEditorEventMap,
            listener as EventListener<InternalEditorEventMap, keyof InternalEditorEventMap>,
            eventContext
          )
        );
        context.subscriptions.push(subscription);
        return subscription;
      },
      subscriptions: [],
      log: (...args) => console.info(`[editor-plugin:${plugin.id}]`, ...args)
    } as EditorPluginContext;
    return context;
  }

  private resolveMenuItems(
    contribution: InternalEditorMenuContribution,
    ctx: InternalEditorMenuContext
  ): InternalEditorMenuItem[] {
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
