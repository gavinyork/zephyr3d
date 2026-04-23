import { IndexedDBFS, PathUtils } from '@zephyr3d/base';

const META_DATABASE_NAME = 'zephyr3d-editor';
const systemPluginVFS = new IndexedDBFS(META_DATABASE_NAME, '$');

const SYSTEM_PLUGIN_ROOT = '/system/plugins';
const SYSTEM_PLUGIN_PACKAGES_DIR = `${SYSTEM_PLUGIN_ROOT}/packages`;
const SYSTEM_PLUGIN_STATE_DIR = `${SYSTEM_PLUGIN_ROOT}/state`;
const SYSTEM_PLUGIN_MANIFEST = `${SYSTEM_PLUGIN_ROOT}/manifest.json`;

export type SystemPluginManifestEntry = {
  id: string;
  name?: string;
  version?: string;
  description?: string;
  entry: string;
  enabled: boolean;
  installedAt: number;
  updatedAt: number;
  builtin?: boolean;
};

type SystemPluginManifest = {
  plugins: Record<string, SystemPluginManifestEntry>;
};

export type SystemPluginRecord = SystemPluginManifestEntry & {
  packageDir: string;
  statePath: string;
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
  enabled?: boolean;
  builtin?: boolean;
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
  enabled?: boolean;
  builtin?: boolean;
};

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

export class SystemPluginService {
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

  static async ensureLayout() {
    await systemPluginVFS.makeDirectory(SYSTEM_PLUGIN_PACKAGES_DIR, true);
    await systemPluginVFS.makeDirectory(SYSTEM_PLUGIN_STATE_DIR, true);
  }

  static async listPlugins(): Promise<SystemPluginRecord[]> {
    const manifest = await this.readManifest();
    return Object.values(manifest.plugins).map((plugin) => this.toRecord(plugin));
  }

  static async getPlugin(id: string): Promise<SystemPluginRecord | null> {
    const manifest = await this.readManifest();
    return manifest.plugins[id] ? this.toRecord(manifest.plugins[id]) : null;
  }

  static async getInstalledPluginSource(id: string): Promise<InstalledSystemPlugin | null> {
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

  static async createPluginFile(pluginId: string, relativePath: string, source = ''): Promise<string> {
    await this.ensureLayout();
    const plugin = await this.getPlugin(pluginId);
    if (!plugin) {
      throw new Error(`System plugin '${pluginId}' is not installed`);
    }
    const normalizedRelativePath = this.normalizePluginFilePath(relativePath);
    if (!normalizedRelativePath) {
      throw new Error('Plugin file path must not be empty');
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
    const oldPath = this.normalizePluginFilePath(oldRelativePath);
    const nextPath = this.normalizePluginFilePath(newRelativePath);
    if (!oldPath || !nextPath) {
      throw new Error('Plugin file path must not be empty');
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
    const normalizedRelativePath = this.normalizePluginFilePath(relativePath);
    if (!normalizedRelativePath) {
      throw new Error('Plugin file path must not be empty');
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
      files: [
        {
          path: input.entryFileName ?? 'index.ts',
          source: input.source
        }
      ],
      enabled: input.enabled,
      builtin: input.builtin
    });
  }

  static async installPluginFiles(input: InstallSystemPluginFilesInput): Promise<SystemPluginRecord> {
    if (!input.id?.trim()) {
      throw new Error('System plugin id must not be empty');
    }
    await this.ensureLayout();
    const normalizedFiles = this.normalizePluginFiles(input.files);
    const entryFileName = this.normalizeEntryFileName(input.entryFileName ?? 'index.ts');
    this.validatePluginFiles(normalizedFiles, entryFileName);

    const now = Date.now();
    const manifest = await this.readManifest();
    const oldEntry = manifest.plugins[input.id];
    const packageDir = this.getPackageDir(input.id);

    await systemPluginVFS.deleteDirectory(packageDir, true).catch(() => undefined);
    await systemPluginVFS.makeDirectory(packageDir, true);
    for (const file of normalizedFiles) {
      const fullPath = systemPluginVFS.join(packageDir, file.path);
      await this.ensureParentDirectory(fullPath);
      await systemPluginVFS.writeFile(fullPath, file.source, {
        encoding: 'utf8',
        create: true
      });
    }

    manifest.plugins[input.id] = {
      id: input.id,
      name: input.name,
      version: input.version,
      description: input.description,
      entry: `/${entryFileName}`,
      enabled: input.enabled ?? true,
      installedAt: oldEntry?.installedAt ?? now,
      updatedAt: now,
      builtin: !!input.builtin
    };
    await this.writeManifest(manifest);
    return this.toRecord(manifest.plugins[input.id]);
  }

  static async removePlugin(id: string): Promise<void> {
    const manifest = await this.readManifest();
    const plugin = manifest.plugins[id];
    if (!plugin) {
      return;
    }
    if (plugin.builtin) {
      throw new Error(`Builtin system plugin '${id}' cannot be removed. Disable it instead.`);
    }
    delete manifest.plugins[id];
    await this.writeManifest(manifest);
    await systemPluginVFS.deleteDirectory(this.getPackageDir(id), true).catch(() => undefined);
    await systemPluginVFS.deleteFile(this.getStatePath(id)).catch(() => undefined);
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

  static async installPluginFromFile(file: File): Promise<SystemPluginRecord> {
    const source = await file.text();
    const entryFileName = file.name || 'index.ts';
    const id = this.inferPluginId(source) ?? this.createPluginIdFromName(PathUtils.basename(entryFileName));
    const name =
      this.inferPluginMetaString(source, 'name') ?? PathUtils.basename(entryFileName).replace(/\.[^.]+$/, '');
    const version = this.inferPluginMetaString(source, 'version') ?? '0.1.0';
    const description = this.inferPluginMetaString(source, 'description') ?? '';
    return this.installPlugin({
      id,
      name,
      version,
      description,
      entryFileName,
      source,
      enabled: true
    });
  }

  static async installPluginFromDirectory(files: File[]): Promise<SystemPluginRecord> {
    const inputFiles = await Promise.all(
      files.map(async (file) => ({
        path: this.normalizePluginFilePath(file.webkitRelativePath || file.name),
        source: await file.text()
      }))
    );
    const entryFile = this.findPluginEntryFile(inputFiles);
    if (!entryFile) {
      throw new Error('Cannot determine plugin entry file from selected directory');
    }
    const id =
      this.inferPluginId(entryFile.source) ?? this.createPluginIdFromName(PathUtils.basename(entryFile.path));
    const name =
      this.inferPluginMetaString(entryFile.source, 'name') ??
      PathUtils.basename(entryFile.path).replace(/\.[^.]+$/, '');
    const version = this.inferPluginMetaString(entryFile.source, 'version') ?? '0.1.0';
    const description = this.inferPluginMetaString(entryFile.source, 'description') ?? '';
    return this.installPluginFiles({
      id,
      name,
      version,
      description,
      entryFileName: entryFile.path,
      files: inputFiles,
      enabled: true
    });
  }

  static async updatePluginSourceByEntryPath(entryPath: string, source: string): Promise<SystemPluginRecord> {
    return this.updatePluginFile(entryPath, source);
  }

  static async updatePluginFile(path: string, source: string): Promise<SystemPluginRecord> {
    await this.ensureLayout();
    const normalizedPath = systemPluginVFS.normalizePath(path);
    const plugin = await this.getPluginByPath(normalizedPath);
    if (!plugin) {
      throw new Error(`System plugin file '${path}' is not installed`);
    }

    const manifest = await this.readManifest();
    const manifestEntry = manifest.plugins[plugin.id];
    const entryPath = this.normalizePluginEntry(plugin.id, manifestEntry.entry);
    const files = await this.readPluginFiles(plugin.id);
    const relativePath = systemPluginVFS.relative(normalizedPath, plugin.packageDir);
    const existing = files.find((file) => file.path === relativePath);
    if (existing) {
      existing.source = source;
    } else {
      files.push({ path: relativePath, source });
    }

    this.validatePluginFiles(files, manifestEntry.entry.replace(/^\/+/, ''), plugin.id);

    await systemPluginVFS.writeFile(normalizedPath, source, {
      encoding: 'utf8',
      create: true
    });

    if (normalizedPath === entryPath) {
      manifestEntry.name = this.inferPluginMetaString(source, 'name') ?? manifestEntry.name;
      manifestEntry.version = this.inferPluginMetaString(source, 'version') ?? manifestEntry.version;
      manifestEntry.description =
        this.inferPluginMetaString(source, 'description') ?? manifestEntry.description;
    }
    manifestEntry.updatedAt = Date.now();
    await this.writeManifest(manifest);
    return this.toRecord(manifestEntry);
  }

  static validatePluginSource(source: string) {
    this.validatePluginImports(source);
  }

  static validatePluginFiles(files: SystemPluginFileInput[], entryFileName: string, pluginId?: string) {
    const normalizedFiles = this.normalizePluginFiles(files);
    const entryPath = this.normalizePluginFilePath(entryFileName);
    if (!normalizedFiles.some((file) => file.path === entryPath)) {
      throw new Error(`System plugin entry '${entryPath}' does not exist in plugin package`);
    }
    for (const file of normalizedFiles) {
      if (pluginId && file.path === entryPath) {
        const inferredId = this.inferPluginId(file.source);
        if (inferredId && inferredId !== pluginId) {
          throw new Error(
            `System plugin id cannot be changed from '${pluginId}' to '${inferredId}' by editing the entry source`
          );
        }
      }
      this.validatePluginImports(file.source);
      this.validateRelativeImportsStayWithinPlugin(file.path, file.source);
    }
  }

  private static validatePluginImports(source: string) {
    const specs = this.collectImportSpecifiers(source);
    for (const spec of specs) {
      if (spec.startsWith('./') || spec.startsWith('../') || spec.startsWith('/')) {
        continue;
      }
      if (spec.startsWith('@zephyr3d/')) {
        continue;
      }
      throw new Error(
        `System plugin imports must be relative or use import-map/host-provided modules. Unsupported import: '${spec}'`
      );
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

  static inferPluginId(source: string): string | null {
    return this.inferPluginMetaString(source, 'id');
  }

  private static inferPluginMetaString(source: string, key: 'id' | 'name' | 'version' | 'description') {
    const pattern = new RegExp(`${key}\\s*:\\s*['"]([^'"]+)['"]`);
    const match = source.match(pattern);
    return match?.[1] ?? null;
  }

  private static createPluginIdFromName(name: string) {
    const normalized = name
      .replace(/\.[^.]+$/, '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return `user.${normalized || 'plugin'}`;
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

  private static validateRelativeImportsStayWithinPlugin(filePath: string, source: string) {
    const specs = this.collectImportSpecifiers(source);
    for (const spec of specs) {
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

  private static findPluginEntryFile(files: SystemPluginFileInput[]) {
    const explicit = files.find((file) => !!this.inferPluginId(file.source));
    if (explicit) {
      return explicit;
    }
    const preferredNames = ['index.ts', 'index.js', 'main.ts', 'main.js'];
    for (const name of preferredNames) {
      const found = files.find((file) => file.path === name || file.path.endsWith(`/${name}`));
      if (found) {
        return found;
      }
    }
    return files[0] ?? null;
  }

  private static getPackageDir(id: string) {
    return systemPluginVFS.join(SYSTEM_PLUGIN_PACKAGES_DIR, id);
  }

  private static getStatePath(id: string) {
    return systemPluginVFS.join(SYSTEM_PLUGIN_STATE_DIR, `${id}.json`);
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
    return {
      plugins: manifest?.plugins ?? {}
    };
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
      statePath: this.getStatePath(plugin.id)
    };
  }
}
