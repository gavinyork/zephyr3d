import { PathUtils } from '@zephyr3d/base';
import { BlobReader, TextWriter, ZipReader, configure, type FileEntry } from '@zip.js/zip.js';
import { libDir } from '../build/templates';
import { installDeps, readLock } from '../build/dep';
import { createLinkedDirectoryVFS, createSystemPluginVFS } from './storage';

configure({ useWebWorkers: false });

const systemPluginVFS = createSystemPluginVFS();

const SYSTEM_PLUGIN_ROOT = '/system/plugins';
const SYSTEM_PLUGIN_PACKAGES_DIR = `${SYSTEM_PLUGIN_ROOT}/packages`;
const SYSTEM_PLUGIN_STATE_DIR = `${SYSTEM_PLUGIN_ROOT}/state`;
const SYSTEM_PLUGIN_MANIFEST = `${SYSTEM_PLUGIN_ROOT}/manifest.json`;
const SYSTEM_PLUGIN_PACKAGE_MANIFEST = 'plugin.json';
const SYSTEM_PLUGIN_DEV_PACKAGE_MANIFEST = 'plugin.dev.json';

export type SystemPluginManifestEntry = {
  id: string;
  name?: string;
  version?: string;
  description?: string;
  entry: string;
  dependencies?: Record<string, string>;
  linked?: {
    directory: string;
    entry?: string;
  };
  enabled: boolean;
  installedAt: number;
  updatedAt: number;
};

export type SystemPluginPackageManifest = {
  id: string;
  entry: string;
  name?: string;
  version?: string;
  description?: string;
  dependencies?: Record<string, string>;
};

type SystemPluginManifest = {
  plugins: Record<string, SystemPluginManifestEntry>;
};

export type SystemPluginRecord = SystemPluginManifestEntry & {
  packageDir: string;
  statePath: string;
  settingsPath: string;
  depsRoot: string;
  depsLockPath: string;
};

export type InstalledSystemPlugin = {
  id: string;
  entryPath: string;
  source: string;
  manifest: SystemPluginRecord;
};

export type InstallSystemPluginInput = {
  id: string;
  name?: string;
  version?: string;
  description?: string;
  entryFileName?: string;
  source: string;
  dependencies?: Record<string, string>;
  enabled?: boolean;
};

export type SystemPluginFileInput = {
  path: string;
  source: string;
};

export type InstallSystemPluginFilesInput = {
  id: string;
  name?: string;
  version?: string;
  description?: string;
  entryFileName?: string;
  files: SystemPluginFileInput[];
  dependencies?: Record<string, string>;
  enabled?: boolean;
};

export type LinkSystemPluginInput = {
  directory: string;
  entryFileName?: string;
  enabled?: boolean;
};

export type SystemPluginProgressHandler = (stage: string) => void;

export type SystemPluginFileRecord = {
  path: string;
  relativePath: string;
  name: string;
  isEntry: boolean;
};

export type SystemPluginDirectoryRecord = {
  path: string;
  relativePath: string;
  name: string;
};

type LinkedPluginFileAnalysisCacheEntry = {
  source: string;
  importSpecifiers: string[];
  modifiedAt: number;
  size: number;
};

type LinkedPluginEntryGraphCacheEntry = {
  filePaths: string[];
};

type LinkedPluginManifestCacheEntry = {
  manifestFileName: string;
  manifestSource: string;
  packageManifest: SystemPluginPackageManifest;
  modifiedAt: number;
  size: number;
};

type LinkedPluginGraphFilesResult = {
  files: SystemPluginFileInput[];
  importSpecifiersByPath: Map<string, string[]>;
};

type LinkedPluginGraphCache = {
  manifest?: LinkedPluginManifestCacheEntry;
  files: Map<string, LinkedPluginFileAnalysisCacheEntry>;
  entryGraphs: Map<string, LinkedPluginEntryGraphCacheEntry>;
};

export class SystemPluginService {
  private static readonly _linkedPluginMounts = new Map<
    string,
    ReturnType<typeof createLinkedDirectoryVFS>
  >();
  private static readonly _linkedPluginDirectories = new Map<string, string>();
  private static readonly _linkedPluginGraphCaches = new Map<string, LinkedPluginGraphCache>();

  static get VFS() {
    return systemPluginVFS;
  }

  static get manifestPath() {
    return SYSTEM_PLUGIN_MANIFEST;
  }

  static get packagesDir() {
    return SYSTEM_PLUGIN_PACKAGES_DIR;
  }

  static get stateDir() {
    return SYSTEM_PLUGIN_STATE_DIR;
  }

  static get packageManifestFileName() {
    return SYSTEM_PLUGIN_PACKAGE_MANIFEST;
  }

  static async ensureLayout() {
    await systemPluginVFS.makeDirectory(SYSTEM_PLUGIN_PACKAGES_DIR, true);
    await systemPluginVFS.makeDirectory(SYSTEM_PLUGIN_STATE_DIR, true);
  }

  static async listPlugins(): Promise<SystemPluginRecord[]> {
    await this.syncLinkedPluginMounts();
    const manifest = await this.readManifest();
    return Object.values(manifest.plugins).map((plugin) => this.toRecord(plugin));
  }

  static async getPlugin(id: string): Promise<SystemPluginRecord | null> {
    await this.syncLinkedPluginMounts();
    const manifest = await this.readManifest();
    return manifest.plugins[id] ? this.toRecord(manifest.plugins[id]) : null;
  }

  static async getInstalledPluginSource(id: string): Promise<InstalledSystemPlugin | null> {
    await this.syncLinkedPluginMounts();
    const manifest = await this.readManifest();
    const plugin = manifest.plugins[id];
    if (!plugin) {
      return null;
    }
    const entryPath = this.normalizePluginEntry(plugin.id, plugin.entry);
    const source = (await systemPluginVFS.readFile(entryPath, { encoding: 'utf8' })) as string;
    return {
      id,
      entryPath,
      source,
      manifest: this.toRecord(plugin)
    };
  }

  static async listPluginFiles(id: string): Promise<SystemPluginFileRecord[]> {
    const plugin = await this.getPlugin(id);
    if (!plugin) {
      throw new Error(`System plugin '${id}' is not installed`);
    }
    const files = await systemPluginVFS.readDirectory(plugin.packageDir, {
      includeHidden: true,
      recursive: true
    });
    const entryPath = this.normalizePluginEntry(plugin.id, plugin.entry);
    return files
      .filter((item) => item.type === 'file')
      .map((item) => ({
        path: item.path,
        relativePath: systemPluginVFS.relative(item.path, plugin.packageDir),
        name: PathUtils.basename(item.path),
        isEntry: systemPluginVFS.normalizePath(item.path) === entryPath
      }))
      .sort((a, b) => a.path.localeCompare(b.path));
  }

  static async readPluginTextFile(id: string, relativePath: string): Promise<string> {
    const plugin = await this.getPlugin(id);
    if (!plugin) {
      throw new Error(`System plugin '${id}' is not installed`);
    }
    const normalizedRelativePath = this.normalizePluginFilePath(relativePath);
    if (!normalizedRelativePath) {
      throw new Error('Plugin file path must not be empty');
    }
    const fullPath = systemPluginVFS.normalizePath(
      systemPluginVFS.join(plugin.packageDir, normalizedRelativePath)
    );
    if (!(await systemPluginVFS.exists(fullPath))) {
      throw new Error(`Plugin file '${normalizedRelativePath}' does not exist`);
    }
    return (await systemPluginVFS.readFile(fullPath, { encoding: 'utf8' })) as string;
  }

  static async listPluginDirectories(id: string): Promise<SystemPluginDirectoryRecord[]> {
    const plugin = await this.getPlugin(id);
    if (!plugin) {
      throw new Error(`System plugin '${id}' is not installed`);
    }
    const directories = await systemPluginVFS.readDirectory(plugin.packageDir, {
      includeHidden: true,
      recursive: true
    });
    return directories
      .filter((item) => item.type === 'directory')
      .map((item) => ({
        path: item.path,
        relativePath: systemPluginVFS.relative(item.path, plugin.packageDir),
        name: PathUtils.basename(item.path)
      }))
      .sort((a, b) => a.path.localeCompare(b.path));
  }

  static async findPluginByPath(path: string): Promise<SystemPluginRecord | null> {
    await this.syncLinkedPluginMounts();
    const normalizedPath = systemPluginVFS.normalizePath(path);
    const plugins = await this.listPlugins();
    for (const plugin of plugins) {
      const packageDir = systemPluginVFS.normalizePath(plugin.packageDir);
      if (normalizedPath === packageDir || normalizedPath.startsWith(`${packageDir}/`)) {
        return plugin;
      }
    }
    return null;
  }

  static async createPluginFile(pluginId: string, relativePath: string, source = ''): Promise<string> {
    await this.ensureLayout();
    const plugin = await this.getPlugin(pluginId);
    if (!plugin) {
      throw new Error(`System plugin '${pluginId}' is not installed`);
    }
    if (plugin.linked?.directory) {
      throw new Error(`Linked plugin '${plugin.id}' is read-only in the built-in plugin editor`);
    }
    const normalizedRelativePath = this.normalizePluginFilePath(relativePath);
    if (!normalizedRelativePath) {
      throw new Error('Plugin file path must not be empty');
    }
    if (normalizedRelativePath === SYSTEM_PLUGIN_PACKAGE_MANIFEST) {
      throw new Error(`Plugin file '${SYSTEM_PLUGIN_PACKAGE_MANIFEST}' is managed by the plugin manifest`);
    }
    const fullPath = systemPluginVFS.normalizePath(
      systemPluginVFS.join(plugin.packageDir, normalizedRelativePath)
    );
    if (await systemPluginVFS.exists(fullPath)) {
      throw new Error(`Plugin file '${normalizedRelativePath}' already exists`);
    }

    const files = await this.readPluginFiles(plugin.id);
    files.push({ path: normalizedRelativePath, source });
    this.validatePluginFiles(files, plugin.entry.replace(/^\/+/, ''), plugin.id);

    await this.ensureParentDirectory(fullPath);
    await systemPluginVFS.writeFile(fullPath, source, {
      encoding: 'utf8',
      create: true
    });
    return fullPath;
  }

  static async createPluginDirectory(pluginId: string, relativePath: string): Promise<string> {
    await this.ensureLayout();
    const plugin = await this.getPlugin(pluginId);
    if (!plugin) {
      throw new Error(`System plugin '${pluginId}' is not installed`);
    }
    if (plugin.linked?.directory) {
      throw new Error(`Linked plugin '${plugin.id}' is read-only in the built-in plugin editor`);
    }
    const normalizedRelativePath = this.normalizePluginFilePath(relativePath);
    if (!normalizedRelativePath) {
      throw new Error('Plugin directory path must not be empty');
    }
    const fullPath = systemPluginVFS.normalizePath(
      systemPluginVFS.join(plugin.packageDir, normalizedRelativePath)
    );
    if (await systemPluginVFS.exists(fullPath)) {
      throw new Error(`Plugin directory '${normalizedRelativePath}' already exists`);
    }

    await this.ensureParentDirectory(fullPath);
    await systemPluginVFS.makeDirectory(fullPath, true);
    return fullPath;
  }

  static async renamePluginFile(
    pluginId: string,
    oldRelativePath: string,
    newRelativePath: string
  ): Promise<string> {
    await this.ensureLayout();
    const plugin = await this.getPlugin(pluginId);
    if (!plugin) {
      throw new Error(`System plugin '${pluginId}' is not installed`);
    }
    if (plugin.linked?.directory) {
      throw new Error(`Linked plugin '${plugin.id}' is read-only in the built-in plugin editor`);
    }
    const oldPath = this.normalizePluginFilePath(oldRelativePath);
    const nextPath = this.normalizePluginFilePath(newRelativePath);
    if (!oldPath || !nextPath) {
      throw new Error('Plugin file path must not be empty');
    }
    if (oldPath === SYSTEM_PLUGIN_PACKAGE_MANIFEST || nextPath === SYSTEM_PLUGIN_PACKAGE_MANIFEST) {
      throw new Error(`Plugin file '${SYSTEM_PLUGIN_PACKAGE_MANIFEST}' cannot be renamed`);
    }
    if (oldPath === plugin.entry.replace(/^\/+/, '')) {
      throw new Error('Renaming the plugin entry file is not supported yet');
    }

    const oldFullPath = systemPluginVFS.normalizePath(systemPluginVFS.join(plugin.packageDir, oldPath));
    const newFullPath = systemPluginVFS.normalizePath(systemPluginVFS.join(plugin.packageDir, nextPath));
    if (!(await systemPluginVFS.exists(oldFullPath))) {
      throw new Error(`Plugin file '${oldPath}' does not exist`);
    }
    if (await systemPluginVFS.exists(newFullPath)) {
      throw new Error(`Plugin file '${nextPath}' already exists`);
    }

    const files = await this.readPluginFiles(plugin.id);
    const target = files.find((file) => file.path === oldPath);
    if (!target) {
      throw new Error(`Plugin file '${oldPath}' does not exist`);
    }
    target.path = nextPath;
    this.validatePluginFiles(files, plugin.entry.replace(/^\/+/, ''), plugin.id);

    await this.ensureParentDirectory(newFullPath);
    await systemPluginVFS.move(oldFullPath, newFullPath);
    return newFullPath;
  }

  static async deletePluginFile(pluginId: string, relativePath: string): Promise<void> {
    await this.ensureLayout();
    const plugin = await this.getPlugin(pluginId);
    if (!plugin) {
      throw new Error(`System plugin '${pluginId}' is not installed`);
    }
    if (plugin.linked?.directory) {
      throw new Error(`Linked plugin '${plugin.id}' is read-only in the built-in plugin editor`);
    }
    const normalizedRelativePath = this.normalizePluginFilePath(relativePath);
    if (!normalizedRelativePath) {
      throw new Error('Plugin file path must not be empty');
    }
    if (normalizedRelativePath === SYSTEM_PLUGIN_PACKAGE_MANIFEST) {
      throw new Error(`Cannot delete '${SYSTEM_PLUGIN_PACKAGE_MANIFEST}'`);
    }
    if (normalizedRelativePath === plugin.entry.replace(/^\/+/, '')) {
      throw new Error('Cannot delete the plugin entry file');
    }

    const fullPath = systemPluginVFS.normalizePath(
      systemPluginVFS.join(plugin.packageDir, normalizedRelativePath)
    );
    if (!(await systemPluginVFS.exists(fullPath))) {
      throw new Error(`Plugin file '${normalizedRelativePath}' does not exist`);
    }

    const files = (await this.readPluginFiles(plugin.id)).filter(
      (file) => file.path !== normalizedRelativePath
    );
    this.validatePluginFiles(files, plugin.entry.replace(/^\/+/, ''), plugin.id);
    await systemPluginVFS.deleteFile(fullPath);
  }

  static async renamePluginDirectory(
    pluginId: string,
    oldRelativePath: string,
    newRelativePath: string
  ): Promise<string> {
    await this.ensureLayout();
    const plugin = await this.getPlugin(pluginId);
    if (!plugin) {
      throw new Error(`System plugin '${pluginId}' is not installed`);
    }
    if (plugin.linked?.directory) {
      throw new Error(`Linked plugin '${plugin.id}' is read-only in the built-in plugin editor`);
    }
    const oldPath = this.normalizePluginFilePath(oldRelativePath);
    const nextPath = this.normalizePluginFilePath(newRelativePath);
    if (!oldPath || !nextPath) {
      throw new Error('Plugin directory path must not be empty');
    }
    if (this.isEntryInsideDirectory(plugin.entry.replace(/^\/+/, ''), oldPath)) {
      throw new Error('Renaming the directory that contains the plugin entry file is not supported yet');
    }

    const oldFullPath = systemPluginVFS.normalizePath(systemPluginVFS.join(plugin.packageDir, oldPath));
    const newFullPath = systemPluginVFS.normalizePath(systemPluginVFS.join(plugin.packageDir, nextPath));
    if (!(await systemPluginVFS.exists(oldFullPath))) {
      throw new Error(`Plugin directory '${oldPath}' does not exist`);
    }
    const oldStat = await systemPluginVFS.stat(oldFullPath);
    if (!oldStat?.isDirectory) {
      throw new Error(`Plugin path '${oldPath}' is not a directory`);
    }
    if (await systemPluginVFS.exists(newFullPath)) {
      throw new Error(`Plugin directory '${nextPath}' already exists`);
    }

    await this.ensureParentDirectory(newFullPath);
    await systemPluginVFS.move(oldFullPath, newFullPath);
    return newFullPath;
  }

  static async deletePluginDirectory(pluginId: string, relativePath: string): Promise<void> {
    await this.ensureLayout();
    const plugin = await this.getPlugin(pluginId);
    if (!plugin) {
      throw new Error(`System plugin '${pluginId}' is not installed`);
    }
    if (plugin.linked?.directory) {
      throw new Error(`Linked plugin '${plugin.id}' is read-only in the built-in plugin editor`);
    }
    const normalizedRelativePath = this.normalizePluginFilePath(relativePath);
    if (!normalizedRelativePath) {
      throw new Error('Plugin directory path must not be empty');
    }
    if (this.isEntryInsideDirectory(plugin.entry.replace(/^\/+/, ''), normalizedRelativePath)) {
      throw new Error('Cannot delete the directory that contains the plugin entry file');
    }

    const fullPath = systemPluginVFS.normalizePath(
      systemPluginVFS.join(plugin.packageDir, normalizedRelativePath)
    );
    if (!(await systemPluginVFS.exists(fullPath))) {
      throw new Error(`Plugin directory '${normalizedRelativePath}' does not exist`);
    }
    const stat = await systemPluginVFS.stat(fullPath);
    if (!stat?.isDirectory) {
      throw new Error(`Plugin path '${normalizedRelativePath}' is not a directory`);
    }

    await systemPluginVFS.deleteDirectory(fullPath, true);
  }

  static async getPluginByPath(path: string): Promise<SystemPluginRecord | null> {
    await this.syncLinkedPluginMounts();
    const manifest = await this.readManifest();
    const normalizedPath = systemPluginVFS.normalizePath(path);
    for (const plugin of Object.values(manifest.plugins)) {
      const packageDir = systemPluginVFS.normalizePath(this.getPackageDir(plugin.id));
      if (normalizedPath === packageDir || normalizedPath.startsWith(`${packageDir}/`)) {
        return this.toRecord(plugin);
      }
    }
    return null;
  }

  static async installPlugin(input: InstallSystemPluginInput): Promise<SystemPluginRecord> {
    return this.installPluginFiles({
      id: input.id,
      name: input.name,
      version: input.version,
      description: input.description,
      entryFileName: input.entryFileName,
      dependencies: input.dependencies,
      files: [
        {
          path: input.entryFileName ?? 'index.ts',
          source: input.source
        }
      ],
      enabled: input.enabled
    });
  }

  static async installPluginFiles(
    input: InstallSystemPluginFilesInput,
    onProgress?: SystemPluginProgressHandler
  ): Promise<SystemPluginRecord> {
    onProgress?.('Validating plugin manifest...');
    await this.ensureLayout();
    const packageManifest = this.resolvePackageManifestForInstall(input);
    const normalizedFiles = this.withPackageManifestFile(
      this.normalizePluginFiles(input.files),
      packageManifest
    );
    const entryFileName = this.normalizeEntryFileName(packageManifest.entry);
    this.validatePluginFiles(normalizedFiles, entryFileName, packageManifest.id);

    const now = Date.now();
    const manifest = await this.readManifest();
    const oldEntry = manifest.plugins[packageManifest.id];
    const packageDir = this.getPackageDir(packageManifest.id);

    onProgress?.('Removing old plugin files...');
    await this.unmountLinkedPlugin(packageManifest.id);

    await systemPluginVFS.deleteDirectory(packageDir, true).catch(() => undefined);
    await systemPluginVFS.makeDirectory(packageDir, true);
    onProgress?.('Writing plugin files...');
    for (const file of normalizedFiles) {
      const fullPath = systemPluginVFS.join(packageDir, file.path);
      await this.ensureParentDirectory(fullPath);
      await systemPluginVFS.writeFile(fullPath, file.source, {
        encoding: 'utf8',
        create: true
      });
    }
    if (packageManifest.dependencies && Object.keys(packageManifest.dependencies).length > 0) {
      await systemPluginVFS.makeDirectory(systemPluginVFS.join(packageDir, libDir), true);
    }

    onProgress?.('Updating plugin manifest...');
    manifest.plugins[packageManifest.id] = {
      id: packageManifest.id,
      name: packageManifest.name,
      version: packageManifest.version,
      description: packageManifest.description,
      entry: `/${entryFileName}`,
      dependencies: packageManifest.dependencies
        ? { ...packageManifest.dependencies }
        : oldEntry?.dependencies,
      linked: undefined,
      enabled: input.enabled ?? true,
      installedAt: oldEntry?.installedAt ?? now,
      updatedAt: now
    };
    await this.writeManifest(manifest);
    return this.toRecord(manifest.plugins[packageManifest.id]);
  }

  static async linkPlugin(
    input: LinkSystemPluginInput,
    onProgress?: SystemPluginProgressHandler
  ): Promise<SystemPluginRecord> {
    onProgress?.('Reading plugin source...');
    await this.ensureLayout();
    const linkedInfo = await this.readLinkedPluginInput(input.directory, input.entryFileName, onProgress);
    const packageManifest = linkedInfo.packageManifest;
    const entryFileName = linkedInfo.entryFileName;

    const now = Date.now();
    const manifest = await this.readManifest();
    const oldEntry = manifest.plugins[packageManifest.id];
    if (oldEntry?.linked?.directory && oldEntry.linked.directory !== input.directory) {
      this._linkedPluginGraphCaches.delete(oldEntry.linked.directory);
    }
    manifest.plugins[packageManifest.id] = {
      id: packageManifest.id,
      name: packageManifest.name,
      version: packageManifest.version,
      description: packageManifest.description,
      entry: `/${entryFileName}`,
      dependencies: packageManifest.dependencies,
      linked: {
        directory: input.directory,
        entry: input.entryFileName ? `/${entryFileName}` : undefined
      },
      enabled: input.enabled ?? true,
      installedAt: oldEntry?.installedAt ?? now,
      updatedAt: now
    };
    onProgress?.('Writing link information...');
    await this.writeManifest(manifest);
    onProgress?.('Mounting plugin directory...');
    await this.mountLinkedPlugin(this.toRecord(manifest.plugins[packageManifest.id]));
    return this.toRecord(manifest.plugins[packageManifest.id]);
  }

  static async refreshLinkedPlugins(onProgress?: SystemPluginProgressHandler): Promise<SystemPluginRecord[]> {
    await this.ensureLayout();
    const manifest = await this.readManifest();
    const linkedEntries = Object.values(manifest.plugins).filter((plugin) => !!plugin.linked?.directory);
    const refreshed: SystemPluginRecord[] = [];
    let dirty = false;
    let index = 0;
    for (const plugin of Object.values(manifest.plugins)) {
      const directory = plugin.linked?.directory?.trim();
      if (!directory) {
        continue;
      }
      index++;
      onProgress?.(`Refreshing plugin ${plugin.name || plugin.id} (${index}/${linkedEntries.length})...`);
      const linkedInfo = await this.readLinkedPluginInput(
        directory,
        plugin.linked?.entry?.replace(/^\/+/, ''),
        onProgress
      );
      const nextManifest = linkedInfo.packageManifest;
      const nextEntry = linkedInfo.entryFileName;
      if (
        plugin.name !== nextManifest.name ||
        plugin.version !== nextManifest.version ||
        plugin.description !== nextManifest.description ||
        plugin.entry !== `/${nextEntry}` ||
        JSON.stringify(plugin.dependencies ?? {}) !== JSON.stringify(nextManifest.dependencies ?? {})
      ) {
        plugin.name = nextManifest.name;
        plugin.version = nextManifest.version;
        plugin.description = nextManifest.description;
        plugin.entry = `/${nextEntry}`;
        plugin.dependencies = nextManifest.dependencies;
        plugin.updatedAt = Date.now();
        dirty = true;
      }
      refreshed.push(this.toRecord(plugin));
    }
    if (dirty) {
      onProgress?.('Saving refreshed plugin manifest...');
      await this.writeManifest(manifest);
    }
    onProgress?.('Syncing linked plugin directories...');
    await this.syncLinkedPluginMounts();
    return refreshed;
  }

  static async removePlugin(id: string): Promise<void> {
    const manifest = await this.readManifest();
    const plugin = manifest.plugins[id];
    if (!plugin) {
      return;
    }
    await this.unmountLinkedPlugin(id);
    delete manifest.plugins[id];
    await this.writeManifest(manifest);
    await systemPluginVFS.deleteDirectory(this.getPackageDir(id), true).catch(() => undefined);
    await systemPluginVFS.deleteFile(this.getStatePath(id)).catch(() => undefined);
    await systemPluginVFS.deleteFile(this.getSettingsPath(id)).catch(() => undefined);
  }

  static async setPluginEnabled(id: string, enabled: boolean): Promise<SystemPluginRecord> {
    const manifest = await this.readManifest();
    const plugin = manifest.plugins[id];
    if (!plugin) {
      throw new Error(`System plugin '${id}' is not installed`);
    }
    plugin.enabled = !!enabled;
    plugin.updatedAt = Date.now();
    await this.writeManifest(manifest);
    return this.toRecord(plugin);
  }

  static async readPluginState<T = unknown>(id: string): Promise<T | null> {
    const path = this.getStatePath(id);
    if (!(await systemPluginVFS.exists(path))) {
      return null;
    }
    const content = (await systemPluginVFS.readFile(path, { encoding: 'utf8' })) as string;
    return JSON.parse(content) as T;
  }

  static async writePluginState<T = unknown>(id: string, state: T): Promise<void> {
    await this.ensureLayout();
    await systemPluginVFS.writeFile(this.getStatePath(id), JSON.stringify(state ?? null, null, 2), {
      encoding: 'utf8',
      create: true
    });
  }

  static async readPluginSettings<T = unknown>(id: string): Promise<T | null> {
    const path = this.getSettingsPath(id);
    if (!(await systemPluginVFS.exists(path))) {
      return null;
    }
    const content = (await systemPluginVFS.readFile(path, { encoding: 'utf8' })) as string;
    return JSON.parse(content) as T;
  }

  static async writePluginSettings<T = unknown>(id: string, settings: T): Promise<void> {
    await this.ensureLayout();
    await systemPluginVFS.writeFile(this.getSettingsPath(id), JSON.stringify(settings ?? null, null, 2), {
      encoding: 'utf8',
      create: true
    });
  }

  static createPackageManifestContent(
    plugin: Pick<
      SystemPluginManifestEntry,
      'id' | 'entry' | 'name' | 'version' | 'description' | 'dependencies'
    >
  ) {
    return `${JSON.stringify(
      this.normalizePackageManifest({
        id: plugin.id,
        entry: plugin.entry.replace(/^\/+/, ''),
        name: plugin.name,
        version: plugin.version,
        description: plugin.description,
        dependencies: plugin.dependencies
      }),
      null,
      2
    )}\n`;
  }

  static async installPluginFromFile(
    file: File,
    onProgress?: SystemPluginProgressHandler
  ): Promise<SystemPluginRecord> {
    const fileName = (file.name || '').toLowerCase();
    if (!fileName.endsWith('.zip')) {
      throw new Error(
        "Install Plugin only accepts '.zip' plugin packages. Use Install Folder for unpacked plugins."
      );
    }
    return this.installPluginFromZip(file, onProgress);
  }

  static async installPluginFromDirectory(
    files: File[],
    onProgress?: SystemPluginProgressHandler
  ): Promise<SystemPluginRecord> {
    onProgress?.('Reading plugin directory files...');
    const inputFiles = await Promise.all(
      files.map(async (file) => ({
        path: this.normalizePluginFilePath(file.webkitRelativePath || file.name),
        source: await file.text()
      }))
    );
    onProgress?.('Parsing plugin directory structure...');
    const packageFiles = this.normalizeImportedPluginFiles(inputFiles);
    const packageManifest = this.readPackageManifestFromFiles(packageFiles);
    return this.installPluginFiles(
      {
        id: packageManifest.id,
        name: packageManifest.name,
        version: packageManifest.version,
        description: packageManifest.description,
        entryFileName: packageManifest.entry,
        dependencies: packageManifest.dependencies,
        files: packageFiles,
        enabled: true
      },
      onProgress
    );
  }

  static async installPluginFromZip(
    file: Blob,
    onProgress?: SystemPluginProgressHandler
  ): Promise<SystemPluginRecord> {
    onProgress?.('Reading plugin ZIP package...');
    const zipReader = new ZipReader(new BlobReader(file));
    try {
      const entries = await zipReader.getEntries();
      const inputFiles: SystemPluginFileInput[] = [];
      onProgress?.(
        `Extracting plugin files (${entries.filter((entry) => !entry.directory).length} total)...`
      );
      for (const entry of entries) {
        if (entry.directory) {
          continue;
        }
        inputFiles.push({
          path: this.normalizePluginFilePath(entry.filename),
          source: await (entry as FileEntry).getData(new TextWriter())
        });
      }
      onProgress?.('Parsing plugin package structure...');
      const packageFiles = this.normalizeImportedPluginFiles(inputFiles);
      const packageManifest = this.readPackageManifestFromFiles(packageFiles);
      return this.installPluginFiles(
        {
          id: packageManifest.id,
          name: packageManifest.name,
          version: packageManifest.version,
          description: packageManifest.description,
          entryFileName: packageManifest.entry,
          dependencies: packageManifest.dependencies,
          files: packageFiles,
          enabled: true
        },
        onProgress
      );
    } finally {
      await zipReader.close();
    }
  }

  static async installPluginDependency(
    pluginId: string,
    spec: string,
    onProgress?: (msg: string) => void
  ): Promise<{ name: string; version: string }> {
    const plugin = await this.getPlugin(pluginId);
    if (!plugin) {
      throw new Error(`System plugin '${pluginId}' is not installed`);
    }
    if (plugin.linked?.directory) {
      throw new Error(
        `Linked plugin '${plugin.id}' cannot install dependencies from the built-in plugin manager`
      );
    }
    const match = spec.match(/^((?:@[^/]+\/)?[^@/]+)(?:@(.+))?$/);
    const packageName = match?.[1] ?? spec;
    const previousVersion = plugin.dependencies?.[packageName];
    await systemPluginVFS.makeDirectory(plugin.depsRoot, true);
    const result = await installDeps(plugin.id, systemPluginVFS, plugin.packageDir, spec, onProgress, true);
    if (previousVersion && previousVersion !== result.version) {
      const oldDir = systemPluginVFS.join(plugin.depsRoot, `${result.name}@${previousVersion}`);
      await systemPluginVFS.deleteDirectory(oldDir, true).catch(() => undefined);
    }
    const manifest = await this.readManifest();
    const manifestEntry = manifest.plugins[pluginId];
    if (manifestEntry) {
      manifestEntry.dependencies = {
        ...(manifestEntry.dependencies ?? {}),
        [result.name]: result.version
      };
      manifestEntry.updatedAt = Date.now();
      await this.writeManifest(manifest);
      await this.syncPackageManifestFile(this.toRecord(manifestEntry));
    }
    return result;
  }

  static async removePluginDependency(pluginId: string, packageName: string): Promise<void> {
    const plugin = await this.getPlugin(pluginId);
    if (!plugin) {
      throw new Error(`System plugin '${pluginId}' is not installed`);
    }
    if (plugin.linked?.directory) {
      throw new Error(
        `Linked plugin '${plugin.id}' cannot remove dependencies from the built-in plugin manager`
      );
    }
    const manifest = await this.readManifest();
    const manifestEntry = manifest.plugins[pluginId];
    if (!manifestEntry) {
      throw new Error(`System plugin '${pluginId}' is not installed`);
    }
    const existingVersion = manifestEntry.dependencies?.[packageName];
    if (!existingVersion) {
      throw new Error(`Dependency '${packageName}' is not installed for plugin '${pluginId}'`);
    }

    const lock = await this.readPluginDependencyLock(plugin);
    if (lock?.dependencies?.[packageName]) {
      const cachedDir = systemPluginVFS.join(
        plugin.depsRoot,
        `${packageName}@${lock.dependencies[packageName].version}`
      );
      await systemPluginVFS.deleteDirectory(cachedDir, true).catch(() => undefined);
      delete lock.dependencies[packageName];
      if (Object.keys(lock.dependencies).length === 0) {
        await systemPluginVFS.deleteFile(plugin.depsLockPath).catch(() => undefined);
      } else {
        await systemPluginVFS.writeFile(plugin.depsLockPath, JSON.stringify(lock, null, 2), {
          encoding: 'utf8',
          create: true
        });
      }
    } else {
      const cachedDir = systemPluginVFS.join(plugin.depsRoot, `${packageName}@${existingVersion}`);
      await systemPluginVFS.deleteDirectory(cachedDir, true).catch(() => undefined);
    }

    delete manifestEntry.dependencies?.[packageName];
    if (manifestEntry.dependencies && Object.keys(manifestEntry.dependencies).length === 0) {
      delete manifestEntry.dependencies;
    }
    manifestEntry.updatedAt = Date.now();
    await this.writeManifest(manifest);
    await this.syncPackageManifestFile(this.toRecord(manifestEntry));

    if (!(await this.hasDependencyCacheFiles(plugin.depsRoot))) {
      await systemPluginVFS.deleteDirectory(plugin.depsRoot, true).catch(() => undefined);
    }
  }

  static getDependenciesRoot(id: string) {
    return systemPluginVFS.join(this.getPackageDir(id), libDir);
  }

  static getDependenciesLockPath(id: string) {
    return systemPluginVFS.join(this.getDependenciesRoot(id), 'deps.lock.json');
  }

  static async updatePluginSourceByEntryPath(entryPath: string, source: string): Promise<SystemPluginRecord> {
    return this.updatePluginFile(entryPath, source);
  }

  static async updatePluginFile(path: string, source: string): Promise<SystemPluginRecord> {
    await this.ensureLayout();
    await this.syncLinkedPluginMounts();
    const normalizedPath = systemPluginVFS.normalizePath(path);
    const plugin = await this.getPluginByPath(normalizedPath);
    if (!plugin) {
      throw new Error(`System plugin file '${path}' is not installed`);
    }
    if (plugin.linked?.directory) {
      throw new Error(`Linked plugin '${plugin.id}' is read-only in the built-in plugin editor`);
    }

    const manifest = await this.readManifest();
    const manifestEntry = manifest.plugins[plugin.id];
    const files = await this.readPluginFiles(plugin.id);
    const relativePath = systemPluginVFS.relative(normalizedPath, plugin.packageDir);
    const existing = files.find((file) => file.path === relativePath);
    if (existing) {
      existing.source = source;
    } else {
      files.push({ path: relativePath, source });
    }

    let nextPackageManifest = this.readPackageManifestFromFiles(files);
    if (nextPackageManifest.id !== plugin.id) {
      throw new Error(
        `System plugin id cannot be changed from '${plugin.id}' to '${nextPackageManifest.id}'`
      );
    }
    this.validatePluginFiles(files, nextPackageManifest.entry, plugin.id);

    await systemPluginVFS.writeFile(normalizedPath, source, {
      encoding: 'utf8',
      create: true
    });

    nextPackageManifest = this.normalizePackageManifest(nextPackageManifest);
    manifestEntry.name = nextPackageManifest.name;
    manifestEntry.version = nextPackageManifest.version;
    manifestEntry.description = nextPackageManifest.description;
    manifestEntry.entry = `/${nextPackageManifest.entry}`;
    manifestEntry.dependencies = nextPackageManifest.dependencies;
    manifestEntry.updatedAt = Date.now();
    await this.writeManifest(manifest);
    return this.toRecord(manifestEntry);
  }

  static validatePluginSource(source: string) {
    this.validatePluginImports(source);
  }

  static validatePluginFiles(
    files: SystemPluginFileInput[],
    entryFileName: string,
    pluginId?: string,
    importSpecifiersByPath?: ReadonlyMap<string, string[]>
  ) {
    const normalizedFiles = this.normalizePluginFiles(files);
    const entryPath = this.normalizePluginFilePath(entryFileName);
    const packageManifest = this.readPackageManifestFromFiles(normalizedFiles);
    if (packageManifest.entry !== entryPath) {
      throw new Error(
        `System plugin package manifest entry '${packageManifest.entry}' does not match expected entry '${entryPath}'`
      );
    }
    if (pluginId && packageManifest.id !== pluginId) {
      throw new Error(
        `System plugin package manifest id cannot be changed from '${pluginId}' to '${packageManifest.id}'`
      );
    }
    if (!normalizedFiles.some((file) => file.path === entryPath)) {
      throw new Error(`System plugin entry '${entryPath}' does not exist in plugin package`);
    }
    for (const file of normalizedFiles) {
      if (file.path === SYSTEM_PLUGIN_PACKAGE_MANIFEST) {
        continue;
      }
      const specs = importSpecifiersByPath?.get(file.path);
      this.validatePluginImports(file.source, specs);
      this.validateRelativeImportsStayWithinPlugin(file.path, file.source, specs);
    }
  }

  private static validatePluginImports(source: string, specs?: readonly string[]) {
    const importSpecs = specs ?? this.collectImportSpecifiers(source);
    for (const spec of importSpecs) {
      if (spec.startsWith('./') || spec.startsWith('../') || spec.startsWith('/')) {
        continue;
      }
      if (spec.startsWith('@zephyr3d/')) {
        continue;
      }
      // Bare imports are allowed for third-party packages declared and installed inside the plugin package.
      continue;
    }
  }

  static collectImportSpecifiers(source: string): string[] {
    const importSpecs = new Set<string>();
    const patterns = [
      /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
      /\b(?:import|export)\b[\s\S]*?\bfrom\s*["']([^"']+)["']/g,
      /\bimport\s*["']([^"']+)["']/g
    ];
    for (const pattern of patterns) {
      for (;;) {
        const match = pattern.exec(source);
        if (!match) {
          break;
        }
        importSpecs.add(match[1]);
      }
    }
    return [...importSpecs];
  }

  private static normalizeEntryFileName(name: string) {
    return this.normalizePluginFilePath(name || 'index.ts') || 'index.ts';
  }

  private static normalizePluginEntry(id: string, entry: string) {
    return systemPluginVFS.normalizePath(
      systemPluginVFS.join(this.getPackageDir(id), entry.replace(/^\/+/, ''))
    );
  }

  private static normalizePluginFilePath(path: string) {
    const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
    const resolved: string[] = [];
    for (const part of parts) {
      if (part === '.') {
        continue;
      }
      if (part === '..') {
        if (resolved.length === 0) {
          throw new Error(`Plugin file path '${path}' cannot escape plugin root`);
        }
        resolved.pop();
        continue;
      }
      resolved.push(part);
    }
    return resolved.join('/');
  }

  private static stripPluginImportQuery(spec: string) {
    const queryIndex = spec.indexOf('?');
    const hashIndex = spec.indexOf('#');
    const cutIndex =
      queryIndex >= 0 && hashIndex >= 0
        ? Math.min(queryIndex, hashIndex)
        : queryIndex >= 0
          ? queryIndex
          : hashIndex;
    return cutIndex >= 0 ? spec.slice(0, cutIndex) : spec;
  }

  private static async resolveLinkedPluginModulePath(
    linkedVFS: ReturnType<typeof createLinkedDirectoryVFS>,
    path: string
  ): Promise<string | null> {
    const candidates = new Set<string>();
    const normalizedPath = this.normalizePluginFilePath(path);
    if (normalizedPath) {
      candidates.add(normalizedPath);
      if (!/\.(ts|js|mjs)$/i.test(normalizedPath)) {
        candidates.add(`${normalizedPath}.ts`);
        candidates.add(`${normalizedPath}.js`);
        candidates.add(`${normalizedPath}.mjs`);
      }
    }
    for (const candidate of candidates) {
      const absolutePath = linkedVFS.normalizePath(linkedVFS.join('/', candidate));
      if (!(await linkedVFS.exists(absolutePath))) {
        continue;
      }
      const stat = await linkedVFS.stat(absolutePath);
      if (stat.isFile) {
        return candidate;
      }
    }
    return null;
  }

  private static getLinkedPluginGraphCache(directory: string): LinkedPluginGraphCache {
    let cache = this._linkedPluginGraphCaches.get(directory);
    if (!cache) {
      cache = {
        files: new Map(),
        entryGraphs: new Map()
      };
      this._linkedPluginGraphCaches.set(directory, cache);
    }
    return cache;
  }

  private static getLinkedPluginFileCacheFingerprint(stat: { modified: Date; size: number }) {
    return {
      modifiedAt: stat.modified?.getTime?.() ?? 0,
      size: stat.size ?? 0
    };
  }

  private static isLinkedPluginFileCacheCurrent(
    cacheEntry: { modifiedAt: number; size: number } | undefined,
    stat: { modified: Date; size: number }
  ) {
    if (!cacheEntry) {
      return false;
    }
    const fingerprint = this.getLinkedPluginFileCacheFingerprint(stat);
    return cacheEntry.modifiedAt === fingerprint.modifiedAt && cacheEntry.size === fingerprint.size;
  }

  private static async getLinkedPluginFileAnalysis(
    cache: LinkedPluginGraphCache,
    linkedVFS: ReturnType<typeof createLinkedDirectoryVFS>,
    normalizedPath: string
  ) {
    const absolutePath = linkedVFS.normalizePath(linkedVFS.join('/', normalizedPath));
    const stat = await linkedVFS.stat(absolutePath);
    if (!stat.isFile) {
      throw new Error(`Plugin file '${normalizedPath}' does not exist`);
    }
    const cached = cache.files.get(normalizedPath);
    if (this.isLinkedPluginFileCacheCurrent(cached, stat)) {
      return cached;
    }
    const source = (await linkedVFS.readFile(absolutePath, { encoding: 'utf8' })) as string;
    const fingerprint = this.getLinkedPluginFileCacheFingerprint(stat);
    const analysis: LinkedPluginFileAnalysisCacheEntry = {
      source,
      importSpecifiers: this.collectImportSpecifiers(source),
      modifiedAt: fingerprint.modifiedAt,
      size: fingerprint.size
    };
    cache.files.set(normalizedPath, analysis);
    return analysis;
  }

  private static async tryCollectCachedLinkedPluginGraphFiles(
    cache: LinkedPluginGraphCache,
    linkedVFS: ReturnType<typeof createLinkedDirectoryVFS>,
    resolvedEntryPath: string
  ): Promise<LinkedPluginGraphFilesResult | null> {
    const entryCache = cache.entryGraphs.get(resolvedEntryPath);
    if (!entryCache || entryCache.filePaths.length === 0) {
      return null;
    }
    const files: SystemPluginFileInput[] = [];
    const importSpecifiersByPath = new Map<string, string[]>();
    for (const filePath of entryCache.filePaths) {
      const absolutePath = linkedVFS.normalizePath(linkedVFS.join('/', filePath));
      if (!(await linkedVFS.exists(absolutePath))) {
        return null;
      }
      const stat = await linkedVFS.stat(absolutePath);
      if (!stat.isFile) {
        return null;
      }
      const cached = cache.files.get(filePath);
      if (!this.isLinkedPluginFileCacheCurrent(cached, stat) || !cached) {
        return null;
      }
      files.push({
        path: filePath,
        source: cached.source
      });
      importSpecifiersByPath.set(filePath, cached.importSpecifiers);
    }
    return {
      files,
      importSpecifiersByPath
    };
  }

  private static async collectLinkedPluginGraphFiles(
    directory: string,
    linkedVFS: ReturnType<typeof createLinkedDirectoryVFS>,
    entryFileName: string
  ): Promise<LinkedPluginGraphFilesResult> {
    const resolvedEntryPath = await this.resolveLinkedPluginModulePath(linkedVFS, entryFileName);
    if (!resolvedEntryPath) {
      throw new Error(`System plugin entry '${entryFileName}' does not exist in linked plugin`);
    }

    const cache = this.getLinkedPluginGraphCache(directory);
    const cachedGraph = await this.tryCollectCachedLinkedPluginGraphFiles(
      cache,
      linkedVFS,
      resolvedEntryPath
    );
    if (cachedGraph) {
      return cachedGraph;
    }

    const collected = new Map<string, string>();
    const importSpecifiersByPath = new Map<string, string[]>();
    const visit = async (filePath: string): Promise<void> => {
      const normalizedPath = this.normalizePluginFilePath(filePath);
      if (collected.has(normalizedPath)) {
        return;
      }
      const analysis = await this.getLinkedPluginFileAnalysis(cache, linkedVFS, normalizedPath);
      collected.set(normalizedPath, analysis.source);
      importSpecifiersByPath.set(normalizedPath, analysis.importSpecifiers);

      const specs = analysis.importSpecifiers;
      for (const spec of specs) {
        if (!spec.startsWith('./') && !spec.startsWith('../') && !spec.startsWith('/')) {
          continue;
        }
        const normalizedSpec = this.stripPluginImportQuery(spec);
        const nextPath = spec.startsWith('/')
          ? this.normalizePluginFilePath(normalizedSpec)
          : this.normalizePluginFilePath(
              linkedVFS.join(linkedVFS.dirname(`/${normalizedPath}`), normalizedSpec).replace(/^\/+/, '')
            );
        const resolvedPath = await this.resolveLinkedPluginModulePath(linkedVFS, nextPath);
        if (!resolvedPath) {
          throw new Error(`Plugin import '${spec}' from '${normalizedPath}' does not exist`);
        }
        await visit(resolvedPath);
      }
    };

    await visit(resolvedEntryPath);
    const filePaths = [...collected.keys()];
    cache.entryGraphs.set(resolvedEntryPath, {
      filePaths
    });
    return {
      files: filePaths.map((path) => ({
        path,
        source: collected.get(path) as string
      })),
      importSpecifiersByPath
    };
  }

  private static normalizePluginFiles(files: SystemPluginFileInput[]) {
    const normalized = new Map<string, string>();
    for (const file of files) {
      const path = this.normalizePluginFilePath(file.path);
      if (!path) {
        continue;
      }
      normalized.set(path, file.source);
    }
    return [...normalized.entries()].map(([path, source]) => ({ path, source }));
  }

  private static normalizeImportedPluginFiles(files: SystemPluginFileInput[]) {
    const normalizedFiles = this.normalizePluginFiles(files);
    if (normalizedFiles.some((file) => file.path === SYSTEM_PLUGIN_PACKAGE_MANIFEST)) {
      return normalizedFiles;
    }
    const commonPrefix = this.findCommonDirectoryPrefix(normalizedFiles.map((file) => file.path));
    for (let i = commonPrefix.length; i > 0; i--) {
      const prefix = commonPrefix.slice(0, i).join('/');
      const stripped = normalizedFiles
        .filter((file) => file.path === prefix || file.path.startsWith(`${prefix}/`))
        .map((file) => ({
          path: file.path === prefix ? '' : file.path.slice(prefix.length + 1),
          source: file.source
        }))
        .filter((file) => !!file.path);
      if (stripped.some((file) => file.path === SYSTEM_PLUGIN_PACKAGE_MANIFEST)) {
        return stripped;
      }
    }
    throw new Error(`Plugin package must contain '${SYSTEM_PLUGIN_PACKAGE_MANIFEST}' at its root`);
  }

  private static findCommonDirectoryPrefix(paths: string[]) {
    if (paths.length === 0) {
      return [];
    }
    const segmentsList = paths.map((path) => path.split('/').filter(Boolean));
    const minLength = Math.min(...segmentsList.map((segments) => segments.length));
    const prefix: string[] = [];
    for (let i = 0; i < minLength - 1; i++) {
      const segment = segmentsList[0][i];
      if (!segmentsList.every((segments) => segments[i] === segment)) {
        break;
      }
      prefix.push(segment);
    }
    return prefix;
  }

  private static readPackageManifestFromFiles(files: SystemPluginFileInput[]) {
    const manifestFile = files.find((file) => file.path === SYSTEM_PLUGIN_PACKAGE_MANIFEST);
    if (!manifestFile) {
      throw new Error(`Plugin package is missing '${SYSTEM_PLUGIN_PACKAGE_MANIFEST}'`);
    }
    return this.parsePackageManifest(manifestFile.source, SYSTEM_PLUGIN_PACKAGE_MANIFEST);
  }

  private static parsePackageManifest(source: string, fileName: string) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(source);
    } catch (err) {
      throw new Error(`Invalid '${fileName}': ${err}`);
    }
    return this.normalizePackageManifest(parsed);
  }

  private static async readLinkedPackageManifest(
    directory: string,
    linkedVFS: ReturnType<typeof createLinkedDirectoryVFS>
  ) {
    const cache = this.getLinkedPluginGraphCache(directory);
    const manifestCandidates = [SYSTEM_PLUGIN_DEV_PACKAGE_MANIFEST, SYSTEM_PLUGIN_PACKAGE_MANIFEST];
    for (const manifestFileName of manifestCandidates) {
      const manifestPath = linkedVFS.normalizePath(linkedVFS.join('/', manifestFileName));
      if (!(await linkedVFS.exists(manifestPath))) {
        continue;
      }
      const stat = await linkedVFS.stat(manifestPath);
      if (!stat.isFile) {
        continue;
      }
      if (
        cache.manifest?.manifestFileName === manifestFileName &&
        this.isLinkedPluginFileCacheCurrent(cache.manifest, stat)
      ) {
        return {
          manifestFileName,
          manifestSource: cache.manifest.manifestSource,
          packageManifest: cache.manifest.packageManifest
        };
      }
      const source = (await linkedVFS.readFile(manifestPath, { encoding: 'utf8' })) as string;
      const fingerprint = this.getLinkedPluginFileCacheFingerprint(stat);
      const packageManifest = this.parsePackageManifest(source, manifestFileName);
      cache.manifest = {
        manifestFileName,
        manifestSource: source,
        packageManifest,
        modifiedAt: fingerprint.modifiedAt,
        size: fingerprint.size
      };
      return {
        manifestFileName,
        manifestSource: source,
        packageManifest
      };
    }
    throw new Error(
      `Linked plugin directory must contain '${SYSTEM_PLUGIN_DEV_PACKAGE_MANIFEST}' or '${SYSTEM_PLUGIN_PACKAGE_MANIFEST}' at its root`
    );
  }

  private static resolvePackageManifestForInstall(input: InstallSystemPluginFilesInput) {
    const normalizedFiles = this.normalizePluginFiles(input.files);
    const manifestFile = normalizedFiles.find((file) => file.path === SYSTEM_PLUGIN_PACKAGE_MANIFEST);
    if (manifestFile) {
      const packageManifest = this.readPackageManifestFromFiles(normalizedFiles);
      if (input.id && input.id !== packageManifest.id) {
        throw new Error(
          `Install input id '${input.id}' does not match '${SYSTEM_PLUGIN_PACKAGE_MANIFEST}' id '${packageManifest.id}'`
        );
      }
      return packageManifest;
    }
    return this.normalizePackageManifest({
      id: input.id,
      name: input.name,
      version: input.version,
      description: input.description,
      entry: input.entryFileName ?? 'index.ts',
      dependencies: input.dependencies
    });
  }

  private static withPackageManifestFile(
    files: SystemPluginFileInput[],
    packageManifest: SystemPluginPackageManifest
  ) {
    const normalized = new Map<string, string>();
    for (const file of files) {
      if (file.path === SYSTEM_PLUGIN_PACKAGE_MANIFEST) {
        continue;
      }
      normalized.set(file.path, file.source);
    }
    normalized.set(SYSTEM_PLUGIN_PACKAGE_MANIFEST, `${JSON.stringify(packageManifest, null, 2)}\n`);
    return [...normalized.entries()].map(([path, source]) => ({ path, source }));
  }

  private static normalizePackageManifest(manifest: unknown): SystemPluginPackageManifest {
    if (!manifest || typeof manifest !== 'object') {
      throw new Error(`'${SYSTEM_PLUGIN_PACKAGE_MANIFEST}' must contain a JSON object`);
    }
    const value = manifest as Record<string, unknown>;
    const id = typeof value.id === 'string' ? value.id.trim() : '';
    if (!id) {
      throw new Error(`'${SYSTEM_PLUGIN_PACKAGE_MANIFEST}.id' must be a non-empty string`);
    }
    const entry = this.normalizeEntryFileName(typeof value.entry === 'string' ? value.entry : '');
    if (!entry) {
      throw new Error(`'${SYSTEM_PLUGIN_PACKAGE_MANIFEST}.entry' must be a non-empty string`);
    }
    const dependencies = this.normalizePackageDependencies(value.dependencies);
    return {
      id,
      entry,
      name: typeof value.name === 'string' && value.name.trim() ? value.name.trim() : undefined,
      version: typeof value.version === 'string' && value.version.trim() ? value.version.trim() : undefined,
      description:
        typeof value.description === 'string' && value.description.trim()
          ? value.description.trim()
          : undefined,
      dependencies
    };
  }

  private static normalizePackageDependencies(value: unknown) {
    if (value === undefined || value === null) {
      return undefined;
    }
    if (typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`'${SYSTEM_PLUGIN_PACKAGE_MANIFEST}.dependencies' must be an object`);
    }
    const result: Record<string, string> = {};
    for (const [key, version] of Object.entries(value as Record<string, unknown>)) {
      const packageName = key.trim();
      const packageVersion = typeof version === 'string' ? version.trim() : '';
      if (!packageName || !packageVersion) {
        throw new Error(
          `'${SYSTEM_PLUGIN_PACKAGE_MANIFEST}.dependencies' must map package names to versions`
        );
      }
      result[packageName] = packageVersion;
    }
    return Object.keys(result).length > 0 ? result : undefined;
  }

  private static validateRelativeImportsStayWithinPlugin(
    filePath: string,
    source: string,
    specs?: readonly string[]
  ) {
    const importSpecs = specs ?? this.collectImportSpecifiers(source);
    for (const spec of importSpecs) {
      if (!spec.startsWith('./') && !spec.startsWith('../')) {
        continue;
      }
      const baseDir = PathUtils.dirname(`/${filePath}`);
      const resolved = PathUtils.normalize(PathUtils.join(baseDir, spec));
      if (!resolved.startsWith('/')) {
        throw new Error(`System plugin relative import '${spec}' in '${filePath}' escapes plugin root`);
      }
      const normalized = resolved.replace(/^\/+/, '');
      if (normalized.startsWith('../') || normalized === '..') {
        throw new Error(`System plugin relative import '${spec}' in '${filePath}' escapes plugin root`);
      }
    }
  }

  private static async ensureParentDirectory(path: string) {
    const dir = systemPluginVFS.dirname(path);
    if (dir && dir !== '.') {
      await systemPluginVFS.makeDirectory(dir, true);
    }
  }

  private static isEntryInsideDirectory(entryPath: string, directoryPath: string) {
    return entryPath === directoryPath || entryPath.startsWith(`${directoryPath}/`);
  }

  private static async readPluginFiles(id: string): Promise<SystemPluginFileInput[]> {
    const plugin = await this.getPlugin(id);
    if (!plugin) {
      throw new Error(`System plugin '${id}' is not installed`);
    }
    const files = await systemPluginVFS.readDirectory(plugin.packageDir, {
      includeHidden: true,
      recursive: true
    });
    const result: SystemPluginFileInput[] = [];
    for (const item of files) {
      if (item.type !== 'file') {
        continue;
      }
      const source = (await systemPluginVFS.readFile(item.path, { encoding: 'utf8' })) as string;
      result.push({
        path: systemPluginVFS.relative(item.path, plugin.packageDir),
        source
      });
    }
    return result;
  }

  private static getPackageDir(id: string) {
    return systemPluginVFS.join(SYSTEM_PLUGIN_PACKAGES_DIR, id);
  }

  private static getStatePath(id: string) {
    return systemPluginVFS.join(SYSTEM_PLUGIN_STATE_DIR, `${id}.json`);
  }

  private static getSettingsPath(id: string) {
    return systemPluginVFS.join(SYSTEM_PLUGIN_STATE_DIR, `${id}.settings.json`);
  }

  private static async readPluginDependencyLock(plugin: SystemPluginRecord): Promise<{
    dependencies: Record<string, { version: string; entry: string; url: string }>;
  } | null> {
    if (!(await systemPluginVFS.exists(plugin.depsLockPath))) {
      return null;
    }
    const content = (await systemPluginVFS.readFile(plugin.depsLockPath, {
      encoding: 'utf8'
    })) as string;
    return JSON.parse(content) as {
      dependencies: Record<string, { version: string; entry: string; url: string }>;
    };
  }

  private static async hasDependencyCacheFiles(depsRoot: string): Promise<boolean> {
    if (!(await systemPluginVFS.exists(depsRoot))) {
      return false;
    }
    const entries = await systemPluginVFS.readDirectory(depsRoot, {
      includeHidden: true,
      recursive: true
    });
    return entries.some((entry) => entry.type === 'file');
  }

  private static async syncPackageManifestFile(plugin: SystemPluginRecord) {
    const packageManifestPath = systemPluginVFS.join(plugin.packageDir, SYSTEM_PLUGIN_PACKAGE_MANIFEST);
    await systemPluginVFS.writeFile(packageManifestPath, this.createPackageManifestContent(plugin), {
      encoding: 'utf8',
      create: true
    });
  }

  private static async readManifest(): Promise<SystemPluginManifest> {
    await this.ensureLayout();
    if (!(await systemPluginVFS.exists(SYSTEM_PLUGIN_MANIFEST))) {
      return {
        plugins: {}
      };
    }
    const content = (await systemPluginVFS.readFile(SYSTEM_PLUGIN_MANIFEST, {
      encoding: 'utf8'
    })) as string;
    const manifest = JSON.parse(content) as SystemPluginManifest;
    const normalized: SystemPluginManifest = {
      plugins: manifest?.plugins ?? {}
    };
    let dirty = false;
    for (const plugin of Object.values(normalized.plugins) as (SystemPluginManifestEntry & {
      builtin?: boolean;
    })[]) {
      if ('builtin' in plugin) {
        delete plugin.builtin;
        dirty = true;
      }
      if (plugin.linked && typeof plugin.linked.directory !== 'string') {
        delete plugin.linked;
        dirty = true;
      } else if (plugin.linked && 'entry' in plugin.linked && typeof plugin.linked.entry !== 'string') {
        delete plugin.linked.entry;
        dirty = true;
      }
    }
    if (dirty) {
      await this.writeManifest(normalized);
    }
    return normalized;
  }

  private static async writeManifest(manifest: SystemPluginManifest) {
    await this.ensureLayout();
    await systemPluginVFS.writeFile(SYSTEM_PLUGIN_MANIFEST, JSON.stringify(manifest, null, 2), {
      encoding: 'utf8',
      create: true
    });
  }

  private static toRecord(plugin: SystemPluginManifestEntry): SystemPluginRecord {
    return {
      ...plugin,
      packageDir: this.getPackageDir(plugin.id),
      statePath: this.getStatePath(plugin.id),
      settingsPath: this.getSettingsPath(plugin.id),
      depsRoot: this.getDependenciesRoot(plugin.id),
      depsLockPath: this.getDependenciesLockPath(plugin.id)
    };
  }

  private static async syncLinkedPluginMounts() {
    const manifest = await this.readManifest();
    const linkedEntries = Object.values(manifest.plugins).filter((plugin) => !!plugin.linked?.directory);
    const keepIds = new Set(linkedEntries.map((plugin) => plugin.id));
    for (const id of [...this._linkedPluginMounts.keys()]) {
      if (!keepIds.has(id)) {
        await this.unmountLinkedPlugin(id);
      }
    }
    for (const entry of linkedEntries) {
      await this.mountLinkedPlugin(this.toRecord(entry));
    }
  }

  private static async mountLinkedPlugin(plugin: SystemPluginRecord) {
    const directory = plugin.linked?.directory?.trim();
    if (!directory) {
      await this.unmountLinkedPlugin(plugin.id);
      return;
    }
    const currentDirectory = this._linkedPluginDirectories.get(plugin.id);
    if (currentDirectory === directory && this._linkedPluginMounts.has(plugin.id)) {
      return;
    }
    await this.unmountLinkedPlugin(plugin.id);
    const vfs = createLinkedDirectoryVFS(directory);
    await systemPluginVFS.mount(this.getPackageDir(plugin.id), vfs);
    this._linkedPluginMounts.set(plugin.id, vfs);
    this._linkedPluginDirectories.set(plugin.id, directory);
  }

  private static async unmountLinkedPlugin(id: string) {
    if (this._linkedPluginMounts.has(id)) {
      await systemPluginVFS.unmount(this.getPackageDir(id)).catch(() => false);
      const vfs = this._linkedPluginMounts.get(id);
      this._linkedPluginMounts.delete(id);
      this._linkedPluginDirectories.delete(id);
      await vfs?.close?.();
    }
  }

  private static async readLinkedPluginInput(
    directory: string,
    entryFileName?: string,
    onProgress?: SystemPluginProgressHandler
  ) {
    const linkedVFS = createLinkedDirectoryVFS(directory);
    try {
      onProgress?.('Reading plugin manifest...');
      const { manifestFileName, manifestSource, packageManifest } = await this.readLinkedPackageManifest(
        directory,
        linkedVFS
      );
      const normalizedEntryFileName = this.normalizeEntryFileName(entryFileName ?? packageManifest.entry);
      onProgress?.('Analyzing plugin entry dependencies...');
      const graphFilesResult = await this.collectLinkedPluginGraphFiles(
        directory,
        linkedVFS,
        normalizedEntryFileName
      );
      const graphFiles = graphFilesResult.files;
      const packageFiles =
        manifestFileName === SYSTEM_PLUGIN_PACKAGE_MANIFEST
          ? [{ path: SYSTEM_PLUGIN_PACKAGE_MANIFEST, source: manifestSource }, ...graphFiles]
          : graphFiles;
      const validationFiles =
        manifestFileName === SYSTEM_PLUGIN_PACKAGE_MANIFEST
          ? packageFiles
          : this.withPackageManifestFile(packageFiles, packageManifest);
      onProgress?.('Validating plugin source...');
      this.validatePluginFiles(
        validationFiles,
        normalizedEntryFileName,
        packageManifest.id,
        graphFilesResult.importSpecifiersByPath
      );
      onProgress?.('Checking plugin dependency cache...');
      await this.ensureLinkedPluginDependencies(linkedVFS, packageManifest);
      return {
        packageManifest,
        entryFileName: normalizedEntryFileName
      };
    } finally {
      await linkedVFS.close();
    }
  }

  private static async ensureLinkedPluginDependencies(
    linkedVFS: ReturnType<typeof createLinkedDirectoryVFS>,
    packageManifest: SystemPluginPackageManifest
  ) {
    const dependencies = Object.entries(packageManifest.dependencies ?? {});
    if (dependencies.length === 0) {
      return;
    }
    const lock = await readLock(linkedVFS, '/');
    for (const [name, versionRange] of dependencies) {
      if (lock?.dependencies?.[name]) {
        continue;
      }
      await installDeps(packageManifest.id, linkedVFS, '/', `${name}@${versionRange}`, undefined, true);
    }
  }
}
