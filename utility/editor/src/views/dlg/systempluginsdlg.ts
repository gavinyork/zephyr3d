import { ImGui } from '@zephyr3d/imgui';
import { ListView, ListViewData } from '../../components/listview';
import { DialogRenderer } from '../../components/modal';
import type { Editor } from '../../core/editor';
import type { EditorPluginSetting, EditorPluginSettingsSchema } from '../../core/pluginapi';
import type { SystemPluginRecord } from '../../core/services/systemplugin';
import { FilePicker } from '../../components/filepicker';
import { templateEditorPluginFiles } from '../../core/build/templates';
import { SystemPluginService } from '../../core/services/systemplugin';
import { getDesktopAPI } from '../../core/services/desktop';
import { DlgPromptName } from './promptnamedlg';
import { DlgMessageBoxEx } from './messageexdlg';
import { Dialog } from './dlg';
import type {
  FileMetadata,
  FileStat,
  ListOptions,
  MoveOptions,
  ReadOptions,
  WriteOptions
} from '@zephyr3d/base';
import { PathUtils, VFSError, VFS } from '@zephyr3d/base';
import { VFSRenderer } from '../../components/vfsrenderer';
import { CustomInputTextFlags, customTextInput } from '../../components/textinput';
import { DlgProgress } from './progressdlg';

function getPluginDependencyLines(plugin: SystemPluginRecord): string[] {
  const dependencies = Object.entries(plugin.dependencies ?? {}).sort(([a], [b]) => a.localeCompare(b));
  if (dependencies.length === 0) {
    return [];
  }
  return ['Dependencies:', ...dependencies.map(([name, version]) => `${name}: ${version}`)];
}

function getPluginDependencySummary(plugin: SystemPluginRecord): string {
  const dependencies = Object.entries(plugin.dependencies ?? {}).sort(([a], [b]) => a.localeCompare(b));
  if (dependencies.length === 0) {
    return 'Dependencies: none';
  }
  return `Dependencies: ${dependencies.map(([name, version]) => `${name}@${version}`).join(', ')}`;
}

function getPluginModeSummary(plugin: SystemPluginRecord): string {
  return plugin.linked?.directory ? `Mode: linked (${plugin.linked.directory})` : 'Mode: installed package';
}

const LEGACY_0YAO_SCRIPT_PATHS = ['/assets/scripts/gpucloth.ts', '/assets/scripts/springtest.ts'];
const PHYSICS_TOOLS_SCRIPT_PATHS = [
  '/assets/plugins/0yao/gpucloth.ts',
  '/assets/plugins/0yao/springtest.ts',
  '/assets/plugins/0yao/externalanimations.ts'
];
const WARDROBE_SCRIPT_PATHS = [
  '/assets/plugins/0yao/wardrobehost.ts',
  '/assets/plugins/0yao/outfitpart.ts',
  '/assets/plugins/0yao/shared.ts',
  '/assets/plugins/0yao/mesh-io.ts',
  '/assets/plugins/0yao/primitive-override.ts',
  '/assets/plugins/0yao/calibration-runtime.ts'
];

const AUTO_SCRIPT_PATHS_BY_PLUGIN_ID: Record<string, string[]> = {
  'com.0yao.zephyr3d-plugin': [...LEGACY_0YAO_SCRIPT_PATHS, ...PHYSICS_TOOLS_SCRIPT_PATHS, ...WARDROBE_SCRIPT_PATHS],
  'com.0yao.zephyr3d-plugin.physics-tools': PHYSICS_TOOLS_SCRIPT_PATHS,
  'com.0yao.zephyr3d-plugin.wardrobe': WARDROBE_SCRIPT_PATHS
};

function normalizePluginSettingsForSchema(
  schema: EditorPluginSettingsSchema,
  settings: Record<string, unknown> | null | undefined
) {
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

class SystemPluginListData extends ListViewData<SystemPluginRecord> {
  constructor(public elements: SystemPluginRecord[]) {
    super();
  }

  getItems() {
    return this.elements;
  }

  getItemIcon(_item: SystemPluginRecord): string {
    return '';
  }

  getItemName(item: SystemPluginRecord): string {
    return item.name || item.id;
  }

  getDetailColumnsInfo(): string[] {
    return ['Id', 'Version'];
  }

  getDetailColumn(item: SystemPluginRecord, col: number): string {
    switch (col) {
      case 0:
        return item.id;
      case 1:
        return item.version ?? '-';
      default:
        return '';
    }
  }

  sortDetailItems(
    a: SystemPluginRecord,
    b: SystemPluginRecord,
    sortBy: number,
    sortAscending: boolean
  ): number {
    let comparison = 0;
    switch (sortBy) {
      case 0:
        comparison = (a.name || a.id).localeCompare(b.name || b.id);
        break;
      case 1:
        comparison = a.id.localeCompare(b.id);
        break;
      case 2:
        comparison = (a.version ?? '').localeCompare(b.version ?? '');
        break;
      default:
        break;
    }
    return sortAscending ? comparison : -comparison;
  }

  getDragSourcePayloadType(): string {
    return '';
  }

  getDragSourceHint(): string {
    return '';
  }

  getDragSourcePayload(): unknown {
    return null;
  }

  getDragTargetPayloadType(): string {
    return null;
  }
}

class SystemPluginListView extends ListView<{}, SystemPluginRecord> {
  constructor(
    data: SystemPluginListData,
    private readonly _togglePlugin: (plugin: SystemPluginRecord) => void,
    private readonly _isBusy: () => boolean
  ) {
    super('##SystemPluginList', data, false);
    this.type = 'detail';
  }

  protected renderDetailLeadingContent(item: SystemPluginRecord): boolean {
    const value = [item.enabled] as [boolean];
    if (ImGui.Checkbox(`##plugin-enabled-${item.id}`, value)) {
      this.handleItemClick(item);
      if (!this._isBusy()) {
        this._togglePlugin(item);
      }
    }
    if (ImGui.IsItemHovered()) {
      ImGui.SetTooltip(item.enabled ? 'Disable plugin' : 'Enable plugin');
    }
    return true;
  }

  protected postRenderItem(item: SystemPluginRecord): void {
    if (ImGui.IsItemHovered()) {
      const detail = [
        item.description,
        item.description ? '' : null,
        `Id: ${item.id}`,
        `Entry: ${item.entry}`,
        getPluginModeSummary(item),
        ...((item.description || item.entry) && Object.keys(item.dependencies ?? {}).length > 0 ? [''] : []),
        ...getPluginDependencyLines(item)
      ]
        .filter((line) => line !== null && line !== undefined)
        .join('\n');
      ImGui.SetTooltip(detail);
    }
  }

  protected onSelectionChanged(): void {}
}

class SystemPluginPackageVFS extends VFS {
  private readonly _editor: Editor;
  private readonly _plugin: SystemPluginRecord;

  constructor(editor: Editor, plugin: SystemPluginRecord) {
    super(false);
    this._editor = editor;
    this._plugin = plugin;
  }

  toHostPath(path: string) {
    const relativePath = this.toPluginRelativePath(path);
    return SystemPluginService.VFS.normalizePath(
      SystemPluginService.VFS.join(this._plugin.packageDir, relativePath)
    );
  }

  private toPluginRelativePath(path: string) {
    const normalized = this.normalizePath(path);
    return normalized.replace(/^\/+/, '');
  }

  private toVirtualPath(relativePath: string) {
    return this.normalizePath(`/${relativePath.replace(/^\/+/, '')}`);
  }

  private async getFilesAndDirectories() {
    const [files, directories] = await Promise.all([
      this._editor.listSystemPluginFiles(this._plugin.id),
      this._editor.listSystemPluginDirectories(this._plugin.id)
    ]);
    return { files, directories };
  }

  protected async _makeDirectory(path: string, recursive: boolean): Promise<void> {
    const relativePath = this.toPluginRelativePath(path);
    if (!relativePath) {
      throw new VFSError('Cannot create root directory', 'EEXIST', path);
    }
    if (!recursive) {
      const parent = this.dirname(path);
      if (!(await this.exists(parent))) {
        throw new VFSError(`Parent directory does not exist: ${parent}`, 'ENOENT', parent);
      }
    }
    await this._editor.createSystemPluginDirectory(this._plugin.id, relativePath);
  }

  protected async _readDirectory(path: string, options?: ListOptions): Promise<FileMetadata[]> {
    const dir = this.normalizePath(path);
    const { files, directories } = await this.getFilesAndDirectories();
    const entries: FileMetadata[] = [];
    const now = new Date();

    for (const directory of directories) {
      const virtualPath = this.toVirtualPath(directory.relativePath);
      if (!this.shouldIncludeEntry(dir, virtualPath, options)) {
        continue;
      }
      entries.push({
        name: PathUtils.basename(virtualPath),
        path: virtualPath,
        size: 0,
        type: 'directory',
        created: now,
        modified: now
      });
    }

    for (const file of files) {
      const virtualPath = this.toVirtualPath(file.relativePath);
      if (!this.shouldIncludeEntry(dir, virtualPath, options)) {
        continue;
      }
      let size = 0;
      try {
        const stat = await SystemPluginService.VFS.stat(file.path);
        size = stat.size;
      } catch {
        size = 0;
      }
      entries.push({
        name: file.name,
        path: virtualPath,
        size,
        type: 'file',
        created: now,
        modified: now
      });
    }

    return entries;
  }

  protected async _deleteDirectory(path: string, recursive: boolean): Promise<void> {
    if (!recursive) {
      const entries = await this._readDirectory(path);
      if (entries.length > 0) {
        throw new VFSError('Directory is not empty', 'ENOTEMPTY', path);
      }
    }
    await this._editor.deleteSystemPluginDirectory(this._plugin.id, this.toPluginRelativePath(path));
  }

  protected async _readFile(path: string, options?: ReadOptions): Promise<ArrayBuffer | string> {
    return SystemPluginService.VFS.readFile(this.toHostPath(path), options);
  }

  protected async _writeFile(
    path: string,
    data: ArrayBuffer | string,
    options?: WriteOptions
  ): Promise<void> {
    if (options?.append) {
      const current = (await this.exists(path))
        ? await this._readFile(path, { encoding: options.encoding ?? 'utf8' })
        : '';
      data = typeof current === 'string' && typeof data === 'string' ? current + data : data;
    }
    const source =
      typeof data === 'string'
        ? data
        : options?.encoding === 'base64'
          ? btoa(String.fromCodePoint(...new Uint8Array(data)))
          : new TextDecoder().decode(data);
    if (await this.exists(path)) {
      await this._editor.updateSystemPluginFile(this.toHostPath(path), source);
    } else {
      await this._editor.createSystemPluginFile(this._plugin.id, this.toPluginRelativePath(path), source);
    }
  }

  protected async _deleteFile(path: string): Promise<void> {
    await this._editor.deleteSystemPluginFile(this._plugin.id, this.toPluginRelativePath(path));
  }

  protected async _exists(path: string): Promise<boolean> {
    const normalized = this.normalizePath(path);
    if (normalized === '/') {
      return true;
    }
    return SystemPluginService.VFS.exists(this.toHostPath(normalized));
  }

  protected async _stat(path: string): Promise<FileStat> {
    const normalized = this.normalizePath(path);
    if (normalized === '/') {
      const now = new Date();
      return {
        size: 0,
        isFile: false,
        isDirectory: true,
        created: now,
        modified: now
      };
    }
    return SystemPluginService.VFS.stat(this.toHostPath(normalized));
  }

  protected async _deleteFileSystem(): Promise<void> {}

  protected async _wipe(): Promise<void> {}

  protected async _move(sourcePath: string, targetPath: string, _options?: MoveOptions): Promise<void> {
    const source = this.toPluginRelativePath(sourcePath);
    const target = this.toPluginRelativePath(targetPath);
    const stat = await this._stat(sourcePath);
    if (stat.isDirectory) {
      await this._editor.renameSystemPluginDirectory(this._plugin.id, source, target);
    } else {
      await this._editor.renameSystemPluginFile(this._plugin.id, source, target);
    }
  }

  private shouldIncludeEntry(rootDir: string, entryPath: string, options?: ListOptions) {
    if (!options?.includeHidden && PathUtils.basename(entryPath).startsWith('.')) {
      return false;
    }
    const normalizedRoot = this.normalizePath(rootDir);
    const normalizedEntry = this.normalizePath(entryPath);
    if (normalizedEntry === normalizedRoot || !this.isParentOf(normalizedRoot, normalizedEntry)) {
      return false;
    }
    const relativePath = this.relative(normalizedEntry, normalizedRoot);
    if (!options?.recursive && relativePath.includes('/')) {
      return false;
    }
    if (options?.pattern) {
      if (typeof options.pattern === 'string' && !relativePath.includes(options.pattern)) {
        return false;
      }
      if (options.pattern instanceof RegExp && !options.pattern.test(relativePath)) {
        return false;
      }
    }
    return true;
  }
}

class DlgPluginFiles extends DialogRenderer<void> {
  private readonly _editor: Editor;
  private _plugin: SystemPluginRecord;
  private readonly _vfs: SystemPluginPackageVFS;
  private readonly _renderer: VFSRenderer;

  static async show(editor: Editor, plugin: SystemPluginRecord) {
    return new DlgPluginFiles(editor, plugin).showModal();
  }

  constructor(editor: Editor, plugin: SystemPluginRecord) {
    super(`Plugin Files##${plugin.id}`, 860, 560, true, false, false);
    this._editor = editor;
    this._plugin = plugin;
    this._vfs = new SystemPluginPackageVFS(editor, plugin);
    this._renderer = new VFSRenderer(this._vfs, [], 240, {
      rootDir: '/',
      rootLabel: plugin.id,
      allowDrop: false,
      allowDblClickOpen: true,
      multiSelect: true,
      showDependencyTools: false,
      showGenericFileCreate: true,
      openFile: (path, mimeType) => {
        const hostPath = this._vfs.toHostPath(path);
        this._editor.openCodeFile(hostPath, this.guessLanguageFromMimeType(hostPath, mimeType));
      }
    });
  }

  doRender(): void {
    ImGui.Text(`Plugin: ${this._plugin.id}`);
    if (this._plugin.linked?.directory) {
      ImGui.TextDisabled(`Linked to: ${this._plugin.linked.directory}`);
    }
    ImGui.Separator();
    if (ImGui.Button('Install Package...') && !this._plugin.linked?.directory) {
      this.installPackage();
    }
    ImGui.SameLine();
    if (ImGui.Button('Remove Package...') && !this._plugin.linked?.directory) {
      this.removePackage();
    }
    ImGui.Separator();
    if (
      ImGui.BeginChild(
        '##PluginFilesVFS',
        new ImGui.ImVec2(0, -ImGui.GetFrameHeightWithSpacing() * 1.5),
        false
      )
    ) {
      this._renderer.render();
    }
    ImGui.EndChild();
    ImGui.Separator();
    if (ImGui.Button('Close')) {
      this._renderer.dispose();
      this.close();
    }
  }

  private guessLanguageFromMimeType(path: string, mimeType: string) {
    if (mimeType === 'text/x-typescript') {
      return 'typescript';
    }
    if (mimeType === 'text/javascript') {
      return 'javascript';
    }
    if (mimeType === 'text/html') {
      return 'html';
    }
    if (mimeType === 'application/json' || mimeType?.endsWith('+json')) {
      return 'json';
    }
    if (path.endsWith('.ts') || path.endsWith('.tsx')) {
      return 'typescript';
    }
    if (path.endsWith('.js') || path.endsWith('.mjs') || path.endsWith('.jsx')) {
      return 'javascript';
    }
    if (path.endsWith('.json')) {
      return 'json';
    }
    if (path.endsWith('.html')) {
      return 'html';
    }
    return 'plaintext';
  }

  private installPackage() {
    DlgPromptName.promptName('Install Package', 'package', 'packageName@x.y.z').then((val) => {
      if (!val) {
        return;
      }
      const dlgMessageBoxEx = new DlgMessageBoxEx('Install package', '', ['Installing...'], 400, 0, false);
      dlgMessageBoxEx.showModal();
      this._editor
        .installSystemPluginDependency(this._plugin.id, val, (msg) => {
          dlgMessageBoxEx.text = msg;
        })
        .then(async (result) => {
          await this.refreshPluginRecord();
          dlgMessageBoxEx.text = `Installed ${result.name}@${result.version}`;
          dlgMessageBoxEx.buttons[0] = 'Ok';
        })
        .catch((err) => {
          dlgMessageBoxEx.text = `Install failed: ${err}`;
          dlgMessageBoxEx.buttons[0] = 'Ok';
        });
    });
  }

  private async removePackage() {
    const dependencyNames = Object.keys(this._plugin.dependencies ?? {}).sort((a, b) => a.localeCompare(b));
    if (dependencyNames.length === 0) {
      this.showInfo('No packages', `Plugin '${this._plugin.id}' does not have any installed package.`);
      return;
    }
    const selected = await Dialog.openFromList(
      'Remove Package',
      dependencyNames.map((name) => `${name}@${this._plugin.dependencies[name]}`),
      dependencyNames,
      undefined,
      420,
      320
    );
    if (!selected) {
      return;
    }
    const confirmed = await DlgMessageBoxEx.messageBoxEx(
      'Remove package',
      `Remove ${selected}@${this._plugin.dependencies[selected]} from plugin '${this._plugin.id}'?`,
      ['Remove', 'Cancel'],
      420,
      0,
      true
    );
    if (confirmed !== 'Remove') {
      return;
    }
    const dlgMessageBoxEx = new DlgMessageBoxEx(
      'Remove package',
      'Removing...',
      ['Please wait'],
      400,
      0,
      false
    );
    dlgMessageBoxEx.showModal();
    this._editor
      .removeSystemPluginDependency(this._plugin.id, selected)
      .then(async () => {
        await this.refreshPluginRecord();
        dlgMessageBoxEx.close('');
      })
      .catch((err) => {
        dlgMessageBoxEx.text = `Remove failed: ${err}`;
        dlgMessageBoxEx.buttons[0] = 'Ok';
      });
  }

  private showInfo(title: string, message: string) {
    void DlgMessageBoxEx.messageBoxEx(title, message, ['Ok'], 360, 0, true);
  }

  private async refreshPluginRecord() {
    const plugins = await this._editor.listSystemPlugins();
    this._plugin = plugins.find((plugin) => plugin.id === this._plugin.id) ?? this._plugin;
  }
}

class DlgPluginSettings extends DialogRenderer<Record<string, unknown> | null> {
  private readonly _plugin: SystemPluginRecord;
  private readonly _schema: EditorPluginSettingsSchema;
  private readonly _values: Record<string, unknown>;

  static async edit(
    plugin: SystemPluginRecord,
    schema: EditorPluginSettingsSchema,
    settings: Record<string, unknown> | null
  ) {
    return new DlgPluginSettings(plugin, schema, settings).showModal();
  }

  constructor(
    plugin: SystemPluginRecord,
    schema: EditorPluginSettingsSchema,
    settings: Record<string, unknown> | null
  ) {
    super(`Plugin Settings##${plugin.id}`, 560, 0, true, true);
    this._plugin = plugin;
    this._schema = schema;
    this._values = normalizePluginSettingsForSchema(schema, settings);
  }

  doRender(): void {
    ImGui.Text(this._plugin.name || this._plugin.id);
    ImGui.TextDisabled(this._plugin.id);
    ImGui.Separator();
    for (const [key, descriptor] of Object.entries(this._schema)) {
      this.renderSetting(key, descriptor);
    }
    ImGui.Separator();
    if (ImGui.Button('Save')) {
      this.close(this._values);
    }
    ImGui.SameLine();
    if (ImGui.Button('Reset')) {
      const normalized = normalizePluginSettingsForSchema(this._schema, null);
      for (const key of Object.keys(this._values)) {
        delete this._values[key];
      }
      Object.assign(this._values, normalized);
    }
    ImGui.SameLine();
    if (ImGui.Button('Cancel')) {
      this.close(null);
    }
  }

  private renderSetting(key: string, descriptor: EditorPluginSetting) {
    const label = descriptor.label || key;
    if (descriptor.type === 'boolean') {
      const value = [!!this._values[key]] as [boolean];
      if (ImGui.Checkbox(label, value)) {
        this._values[key] = value[0];
      }
      this.renderSettingDescription(descriptor);
      return;
    }

    ImGui.Text(label);
    if (descriptor.type === 'string' && descriptor.options?.length) {
      const optionLabels = descriptor.options.map((item) => item.label);
      const currentIndex = Math.max(
        0,
        descriptor.options.findIndex((item) => item.value === this._values[key])
      );
      const selectedIndex = [currentIndex] as [number];
      if (ImGui.Combo(`##${key}`, selectedIndex, optionLabels)) {
        this._values[key] = descriptor.options[selectedIndex[0]].value;
      }
      this.renderSettingDescription(descriptor);
      return;
    }
    if (descriptor.type === 'number' && descriptor.options?.length) {
      const optionLabels = descriptor.options.map((item) => item.label);
      const currentIndex = Math.max(
        0,
        descriptor.options.findIndex((item) => item.value === this._values[key])
      );
      const selectedIndex = [currentIndex] as [number];
      if (ImGui.Combo(`##${key}`, selectedIndex, optionLabels)) {
        this._values[key] = descriptor.options[selectedIndex[0]].value;
      }
      this.renderSettingDescription(descriptor);
      return;
    }
    if (descriptor.type === 'number') {
      if (descriptor.integer) {
        const value = [Number(this._values[key] ?? descriptor.default ?? 0) | 0] as [number];
        if (
          ImGui.InputInt(`##${key}`, value, descriptor.step ?? 1, Math.max((descriptor.step ?? 1) * 10, 1))
        ) {
          let nextValue = value[0];
          if (typeof descriptor.min === 'number') {
            nextValue = Math.max(descriptor.min, nextValue);
          }
          if (typeof descriptor.max === 'number') {
            nextValue = Math.min(descriptor.max, nextValue);
          }
          this._values[key] = nextValue;
        }
      } else {
        const value = [Number(this._values[key] ?? descriptor.default ?? 0)] as [number];
        if (ImGui.InputFloat(`##${key}`, value, descriptor.step ?? 0.1, (descriptor.step ?? 0.1) * 10)) {
          let nextValue = value[0];
          if (typeof descriptor.min === 'number') {
            nextValue = Math.max(descriptor.min, nextValue);
          }
          if (typeof descriptor.max === 'number') {
            nextValue = Math.min(descriptor.max, nextValue);
          }
          this._values[key] = nextValue;
        }
      }
      this.renderSettingDescription(descriptor);
      return;
    }

    const textValue = [String(this._values[key] ?? descriptor.default ?? '')] as [string];
    const flags = descriptor.secret ? CustomInputTextFlags.Password : 0;
    if (descriptor.multiline) {
      if (customTextInput(`##${key}`, textValue, '', CustomInputTextFlags.Multiline | flags, -1, 80)) {
        this._values[key] = textValue[0];
      }
    } else if (customTextInput(`##${key}`, textValue, '', flags)) {
      this._values[key] = textValue[0];
    }
    this.renderSettingDescription(descriptor);
  }

  private renderSettingDescription(descriptor: EditorPluginSetting) {
    if (descriptor.description) {
      ImGui.TextDisabled(descriptor.description);
    }
    ImGui.Spacing();
  }
}

export class DlgSystemPlugins extends DialogRenderer<void> {
  private readonly _editor: Editor;
  private readonly _listData: SystemPluginListData;
  private readonly _listView: SystemPluginListView;
  private _busy = false;

  static async show(editor: Editor) {
    return new DlgSystemPlugins(editor).showModal();
  }

  constructor(editor: Editor) {
    super('Plugin Manager', 760, 480, true, false, false);
    this._editor = editor;
    this._listData = new SystemPluginListData([]);
    this._listView = new SystemPluginListView(
      this._listData,
      (plugin) => this.toggleSelected(plugin),
      () => this._busy
    );
    this.reload().catch(() => undefined);
  }

  doRender(): void {
    if (ImGui.Button(this._busy ? 'Installing...' : 'Install...') && !this._busy) {
      this.installPlugin();
    }
    if (ImGui.IsItemHovered()) {
      ImGui.SetTooltip('Installs a plugin from ZIP file');
    }
    ImGui.SameLine();
    if (ImGui.Button('Install Folder...') && !this._busy) {
      this.installPluginFolder();
    }
    if (ImGui.IsItemHovered()) {
      ImGui.SetTooltip('Installs a plugin from directory');
    }
    ImGui.SameLine();
    if (ImGui.Button('Link...') && !this._busy) {
      this.linkPlugin();
    }
    if (ImGui.IsItemHovered()) {
      ImGui.SetTooltip(
        'Links a desktop plugin directory for development. Supports plugin.dev.json source entry.'
      );
    }
    ImGui.SameLine();
    if (ImGui.Button('New Template...') && !this._busy) {
      this.createTemplatePlugin();
    }
    ImGui.SameLine();
    if (ImGui.Button('Refresh') && !this._busy) {
      this.refreshPlugins().catch(() => undefined);
    }

    ImGui.Separator();
    if (ImGui.BeginChild('##SystemPluginsBody', new ImGui.ImVec2(0, -70), true)) {
      this._listView.render();
    }
    ImGui.EndChild();

    const selected = [...this._listView.selectedItems][0] ?? null;
    if (selected) {
      if (ImGui.Button('Export Zip...') && !this._busy) {
        this.exportPlugin(selected);
      }
      ImGui.SameLine();
      if (ImGui.Button('Remove') && !this._busy) {
        this.removeSelected(selected);
      }
      ImGui.SameLine();
      if (ImGui.Button('Browse Files...') && !this._busy) {
        this.browseFiles(selected);
      }
      ImGui.SameLine();
      if (ImGui.Button('Install Package...') && !this._busy && !selected.linked?.directory) {
        this.installPluginPackage(selected);
      }
      ImGui.SameLine();
      if (ImGui.Button('Remove Package...') && !this._busy && !selected.linked?.directory) {
        this.removePluginPackage(selected);
      }
      ImGui.SameLine();
      if (ImGui.Button('Settings...') && !this._busy) {
        this.editPluginSettings(selected);
      }
      ImGui.TextWrapped(getPluginModeSummary(selected));
      ImGui.TextWrapped(getPluginDependencySummary(selected));
    } else {
      ImGui.TextDisabled('Select a plugin to inspect or remove it.');
    }

    ImGui.Separator();
    if (ImGui.Button('Close')) {
      this.close();
    }
  }

  private async reload() {
    this._listData.elements = await this._editor.listSystemPlugins();
  }

  private async runPluginBusyTask(
    title: string,
    action: (updateProgress: (current: number, total: number, message: string) => void) => Promise<void>
  ) {
    const progress = new DlgProgress(`${title}##SystemPluginProgress`, 420);
    progress.showModal();
    progress.setProgress(0, 4);
    progress.setMessage('准备中...');
    this._busy = true;
    try {
      await action((current, total, message) => {
        progress.setProgress(current, total);
        progress.setMessage(message);
      });
      progress.setProgress(4, 4);
      progress.setMessage('操作完成');
    } finally {
      progress.close();
      this._busy = false;
    }
  }

  private async refreshPlugins() {
    try {
      await this.runPluginBusyTask('刷新插件', async (updateProgress) => {
        updateProgress(1, 4, '正在扫描已 Link 的插件...');
        this._listData.elements = await this._editor.refreshSystemPluginsWithProgress((message) => {
          updateProgress(2, 4, message);
        });
        updateProgress(4, 4, '插件列表已刷新');
      });
    } catch {}
  }

  private async installPlugin() {
    try {
      const files = await FilePicker.chooseFiles(false, '.zip');
      if (files?.[0]) {
        await this.runPluginBusyTask('安装插件', async (updateProgress) => {
          updateProgress(1, 4, '正在读取插件包...');
          await this._editor.installSystemPluginFromFileWithProgress(files[0], (message) => {
            updateProgress(2, 4, message);
          });
          updateProgress(3, 4, '正在刷新插件列表...');
          await this.reload();
          updateProgress(4, 4, '插件安装完成');
        });
      }
    } catch {}
  }

  private async installPluginFolder() {
    try {
      const files = await FilePicker.chooseDirectory();
      if (files?.length) {
        await this.runPluginBusyTask('安装插件目录', async (updateProgress) => {
          updateProgress(1, 4, '正在读取插件目录...');
          await this._editor.installSystemPluginFromDirectoryWithProgress(files, (message) => {
            updateProgress(2, 4, message);
          });
          updateProgress(3, 4, '正在刷新插件列表...');
          await this.reload();
          updateProgress(4, 4, '插件安装完成');
        });
      }
    } catch {}
  }

  private async linkPlugin() {
    const desktop = getDesktopAPI();
    if (!desktop?.fs?.pickDirectory) {
      return;
    }
    try {
      const directory = await desktop.fs.pickDirectory({
        title: 'Select Plugin Directory',
        buttonLabel: 'Link Plugin'
      });
      if (directory) {
        await this.runPluginBusyTask('Link 插件', async (updateProgress) => {
          updateProgress(1, 4, '正在读取插件目录...');
          await this._editor.linkSystemPluginWithProgress(directory, undefined, (message) => {
            updateProgress(2, 4, message);
          });
          updateProgress(3, 4, '正在刷新插件列表...');
          await this.reload();
          updateProgress(4, 4, '插件 Link 完成');
        });
      }
    } catch (err) {
      await DlgMessageBoxEx.messageBoxEx(
        'Link Plugin Failed',
        err instanceof Error ? err.message : String(err),
        ['Close'],
        480,
        0,
        true
      );
    }
  }

  private async createTemplatePlugin() {
    this._busy = true;
    try {
      const template = await this.createUniqueTemplatePluginInput();
      await this._editor.installSystemPluginFiles({
        id: template.id,
        entryFileName: 'index.ts',
        files: template.files.map((file) => ({
          path: file.path,
          source: file.source
        })),
        enabled: true
      });
      await this.reload();
    } catch {
    } finally {
      this._busy = false;
    }
  }

  private async createUniqueTemplatePluginInput() {
    const baseId = 'com.example.editor-plugin';
    const baseName = 'Example Editor Plugin';
    const installedIds = new Set((await this._editor.listSystemPlugins()).map((plugin) => plugin.id));
    let index = 1;
    let id = baseId;
    while (installedIds.has(id)) {
      index++;
      id = `${baseId}-${index}`;
    }

    const name = index === 1 ? baseName : `${baseName} ${index}`;
    const commandId = `${id
      .replace(/[^a-z0-9]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase()}.about`;
    const label = index === 1 ? 'Example Plugin...' : `Example Plugin ${index}...`;
    const title = index === 1 ? 'Example Plugin' : `Example Plugin ${index}`;
    return {
      id,
      files: templateEditorPluginFiles.map((file) => ({
        path: file.path,
        source: file.source
          .replace('"id": "com.example.editor-plugin"', `"id": "${id}"`)
          .replace('"name": "Example Editor Plugin"', `"name": "${name}"`)
          .replace("id: 'example-editor-plugin.about'", `id: '${commandId}'`)
          .replace("label: 'Example Plugin...'", `label: '${label}'`)
          .replace("ctx.ui.message('Example Plugin'", `ctx.ui.message('${title}'`)
      }))
    };
  }

  private async toggleSelected(plugin: SystemPluginRecord) {
    this._busy = true;
    try {
      await this._editor.setSystemPluginEnabled(plugin.id, !plugin.enabled);
      await this.reload();
    } catch {
    } finally {
      this._busy = false;
    }
  }

  private async removeSelected(plugin: SystemPluginRecord) {
    this._busy = true;
    try {
      const autoScriptPaths = AUTO_SCRIPT_PATHS_BY_PLUGIN_ID[plugin.id] ?? [];
      let shouldDeleteScripts = false;
      if (autoScriptPaths.length > 0 && this._editor.currentProject && !this._editor.isProjectReadOnly()) {
        const existingPaths: string[] = [];
        for (const path of autoScriptPaths) {
          if (await this._editor.projectFileExists(path)) {
            existingPaths.push(path);
          }
        }
        if (existingPaths.length > 0) {
          const confirmed = await DlgMessageBoxEx.messageBoxEx(
            'Remove plugin scripts',
            `Also remove these generated project scripts?\n\n${existingPaths.join('\n')}`,
            ['Remove Plugin And Scripts', 'Keep Scripts', 'Cancel'],
            460,
            0,
            true
          );
          if (confirmed === 'Cancel') {
            return;
          }
          shouldDeleteScripts = confirmed === 'Remove Plugin And Scripts';
          if (shouldDeleteScripts) {
            for (const path of existingPaths) {
              await this._editor.deleteProjectFile(path);
            }
          }
        }
      }
      await this._editor.removeSystemPlugin(plugin.id);
      void shouldDeleteScripts;
      await this.reload();
    } catch {
    } finally {
      this._busy = false;
    }
  }

  private async exportPlugin(plugin: SystemPluginRecord) {
    this._busy = true;
    try {
      await this._editor.exportSystemPlugin(plugin.id);
    } catch {
    } finally {
      this._busy = false;
    }
  }

  private async browseFiles(plugin: SystemPluginRecord) {
    await DlgPluginFiles.show(this._editor, plugin);
  }

  private async editPluginSettings(plugin: SystemPluginRecord) {
    this._busy = true;
    try {
      const schema = await this._editor.getSystemPluginSettingsSchema(plugin.id);
      if (!schema || Object.keys(schema).length === 0) {
        return;
      }
      const settings = await this._editor.getPluginSettings<Record<string, unknown>>(plugin.id);
      const result = await DlgPluginSettings.edit(plugin, schema, settings);
      if (result) {
        await this._editor.saveSystemPluginSettings(plugin.id, result, true);
        await this.reload();
      }
    } catch {
    } finally {
      this._busy = false;
    }
  }

  private installPluginPackage(plugin: SystemPluginRecord) {
    DlgPromptName.promptName('Install Package', 'package', 'packageName@x.y.z').then((val) => {
      if (!val) {
        return;
      }
      this._busy = true;
      const dlgMessageBoxEx = new DlgMessageBoxEx('Install package', '', ['Installing...'], 400, 0, false);
      dlgMessageBoxEx.showModal();
      this._editor
        .installSystemPluginDependency(plugin.id, val, (msg) => {
          dlgMessageBoxEx.text = msg;
        })
        .then(async () => {
          dlgMessageBoxEx.close('');
          await this.reload();
        })
        .catch(() => {
          dlgMessageBoxEx.close('');
        })
        .finally(() => {
          this._busy = false;
        });
    });
  }

  private async removePluginPackage(plugin: SystemPluginRecord) {
    const dependencyNames = Object.keys(plugin.dependencies ?? {}).sort((a, b) => a.localeCompare(b));
    if (dependencyNames.length === 0) {
      return;
    }
    const selectedDependency = await Dialog.openFromList(
      'Remove Package',
      dependencyNames.map((name) => `${name}@${plugin.dependencies[name]}`),
      dependencyNames,
      undefined,
      420,
      320
    );
    if (!selectedDependency) {
      return;
    }
    const confirmed = await DlgMessageBoxEx.messageBoxEx(
      'Remove package',
      `Remove ${selectedDependency}@${plugin.dependencies[selectedDependency]} from plugin '${plugin.id}'?`,
      ['Remove', 'Cancel'],
      420,
      0,
      true
    );
    if (confirmed !== 'Remove') {
      return;
    }
    this._busy = true;
    const dlgMessageBoxEx = new DlgMessageBoxEx(
      'Remove package',
      'Removing...',
      ['Please wait'],
      400,
      0,
      false
    );
    dlgMessageBoxEx.showModal();
    this._editor
      .removeSystemPluginDependency(plugin.id, selectedDependency)
      .then(async () => {
        dlgMessageBoxEx.close('');
        await this.reload();
      })
      .catch(() => {
        dlgMessageBoxEx.close('');
      })
      .finally(() => {
        this._busy = false;
      });
  }
}
