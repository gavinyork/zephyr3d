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

  static async installPlugin(input: InstallSystemPluginInput): Promise<SystemPluginRecord> {
    if (!input.id?.trim()) {
      throw new Error('System plugin id must not be empty');
    }
    await this.ensureLayout();
    this.validatePluginSource(input.source);

    const now = Date.now();
    const manifest = await this.readManifest();
    const oldEntry = manifest.plugins[input.id];
    const entryFileName = this.normalizeEntryFileName(input.entryFileName ?? 'index.ts');
    const packageDir = this.getPackageDir(input.id);
    const entryPath = systemPluginVFS.join(packageDir, entryFileName);

    await systemPluginVFS.deleteDirectory(packageDir, true).catch(() => undefined);
    await systemPluginVFS.makeDirectory(packageDir, true);
    await systemPluginVFS.writeFile(entryPath, input.source, {
      encoding: 'utf8',
      create: true
    });

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
    const name = this.inferPluginMetaString(source, 'name') ?? PathUtils.basename(entryFileName).replace(/\.[^.]+$/, '');
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

  static validatePluginSource(source: string) {
    const specs = this.collectImportSpecifiers(source);
    for (const spec of specs) {
      if (spec.startsWith('./') || spec.startsWith('../') || spec.startsWith('/')) {
        continue;
      }
      if (spec === 'zephyr3d/editor-plugin') {
        continue;
      }
      if (
        spec.startsWith('@zephyr3d/') &&
        (spec === '@zephyr3d/base' || spec === '@zephyr3d/scene' || spec === '@zephyr3d/device')
      ) {
        continue;
      }
      throw new Error(
        `System plugin imports must be relative or use allowed built-in modules. Unsupported import: '${spec}'`
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
    const normalized = name.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? 'index.ts';
    return normalized || 'index.ts';
  }

  private static normalizePluginEntry(id: string, entry: string) {
    return systemPluginVFS.normalizePath(systemPluginVFS.join(this.getPackageDir(id), entry.replace(/^\/+/, '')));
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
