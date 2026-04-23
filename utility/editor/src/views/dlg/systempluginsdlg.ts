import { ImGui } from '@zephyr3d/imgui';
import { ListView, ListViewData } from '../../components/listview';
import { DialogRenderer } from '../../components/modal';
import type { Editor } from '../../core/editor';
import type { SystemPluginRecord } from '../../core/services/systemplugin';
import { FilePicker } from '../../components/filepicker';
import { templateEditorPluginFiles } from '../../core/build/templates';
import { SystemPluginService } from '../../core/services/systemplugin';
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

class SystemPluginListData extends ListViewData<SystemPluginRecord> {
  constructor(public elements: SystemPluginRecord[]) {
    super();
  }

  getItems() {
    return this.elements;
  }

  getItemIcon(item: SystemPluginRecord): string {
    return item.enabled ? '🔌' : '🚫';
  }

  getItemName(item: SystemPluginRecord): string {
    return item.name || item.id;
  }

  getDetailColumnsInfo(): string[] {
    return ['Id', 'Version', 'Status'];
  }

  getDetailColumn(item: SystemPluginRecord, col: number): string {
    switch (col) {
      case 0:
        return item.id;
      case 1:
        return item.version ?? '-';
      case 2:
        return item.enabled ? 'Enabled' : 'Disabled';
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
      case 3:
        comparison = Number(a.enabled) - Number(b.enabled);
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
  constructor(data: SystemPluginListData) {
    super('##SystemPluginList', data, false);
    this.type = 'detail';
  }

  protected postRenderItem(item: SystemPluginRecord): void {
    if (ImGui.IsItemHovered()) {
      const detail = [
        item.description,
        item.description ? '' : null,
        `Id: ${item.id}`,
        `Entry: ${item.entry}`
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
  private readonly _plugin: SystemPluginRecord;
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
}

export class DlgSystemPlugins extends DialogRenderer<void> {
  private readonly _editor: Editor;
  private readonly _listData: SystemPluginListData;
  private readonly _listView: SystemPluginListView;
  private _busy = false;
  private _message = '';

  static async show(editor: Editor) {
    return new DlgSystemPlugins(editor).showModal();
  }

  constructor(editor: Editor) {
    super('System Plugins', 760, 480, true, false, false);
    this._editor = editor;
    this._listData = new SystemPluginListData([]);
    this._listView = new SystemPluginListView(this._listData);
    this.reload().catch((err) => {
      this._message = String(err);
    });
  }

  doRender(): void {
    ImGui.TextWrapped(
      'System plugins are stored in the global zephyr3d-editor database and are available to all projects.'
    );
    ImGui.Separator();

    if (ImGui.Button(this._busy ? 'Installing...' : 'Install Plugin...') && !this._busy) {
      this.installPlugin();
    }
    ImGui.SameLine();
    if (ImGui.Button('Install Folder...') && !this._busy) {
      this.installPluginFolder();
    }
    ImGui.SameLine();
    if (ImGui.Button('New Template...') && !this._busy) {
      this.createTemplatePlugin();
    }
    ImGui.SameLine();
    if (ImGui.Button('Refresh') && !this._busy) {
      this.reload().catch((err) => {
        this._message = String(err);
      });
    }

    ImGui.Separator();
    if (ImGui.BeginChild('##SystemPluginsBody', new ImGui.ImVec2(0, -70), true)) {
      this._listView.render();
    }
    ImGui.EndChild();

    const selected = [...this._listView.selectedItems][0] ?? null;
    if (selected) {
      if (ImGui.Button(selected.enabled ? 'Disable' : 'Enable') && !this._busy) {
        this.toggleSelected(selected);
      }
      ImGui.SameLine();
      if (ImGui.Button('Export Zip...') && !this._busy) {
        this.exportPlugin(selected);
      }
      if (!selected.builtin) {
        ImGui.SameLine();
        if (ImGui.Button('Remove') && !this._busy) {
          this.removeSelected(selected);
        }
      }
      ImGui.SameLine();
      if (ImGui.Button('Open Source') && !this._busy) {
        const entryPath = SystemPluginService.VFS.normalizePath(
          selected.packageDir + '/' + selected.entry.replace(/^\/+/, '')
        );
        this._editor.openCodeFile(entryPath, entryPath.endsWith('.ts') ? 'typescript' : 'javascript');
      }
      ImGui.SameLine();
      if (ImGui.Button('Browse Files...') && !this._busy) {
        this.browseFiles(selected);
      }
    } else {
      ImGui.TextDisabled('Select a plugin to enable, disable, remove, or inspect it.');
    }

    if (this._message) {
      ImGui.Separator();
      ImGui.TextWrapped(this._message);
    }

    ImGui.Separator();
    if (ImGui.Button('Close')) {
      this.close();
    }
  }

  private async reload() {
    this._listData.elements = await this._editor.listSystemPlugins();
    this._message = '';
  }

  private async installPlugin() {
    this._busy = true;
    try {
      const files = await FilePicker.chooseFiles(false, '.ts,.js,text/typescript,text/javascript');
      if (files?.[0]) {
        const plugin = await this._editor.installSystemPluginFromFile(files[0]);
        this._message = `Installed plugin '${plugin.id}'.`;
        await this.reload();
      }
    } catch (err) {
      this._message = `Install failed: ${err}`;
    } finally {
      this._busy = false;
    }
  }

  private async installPluginFolder() {
    this._busy = true;
    try {
      const files = await FilePicker.chooseDirectory();
      if (files?.length) {
        const plugin = await this._editor.installSystemPluginFromDirectory(files);
        this._message = `Installed plugin folder '${plugin.id}'.`;
        await this.reload();
      }
    } catch (err) {
      this._message = `Install folder failed: ${err}`;
    } finally {
      this._busy = false;
    }
  }

  private async createTemplatePlugin() {
    this._busy = true;
    try {
      const template = await this.createUniqueTemplatePluginInput();
      const plugin = await this._editor.installSystemPluginFiles({
        id: template.id,
        name: template.name,
        version: '0.1.0',
        description: 'A multi-file system-level zephyr3d editor plugin.',
        entryFileName: 'index.ts',
        files: template.files.map((file) => ({
          path: file.path,
          source: file.source
        })),
        enabled: true
      });
      this._message = `Created multi-file plugin template '${plugin.id}'. You can browse its files and continue editing.`;
      await this.reload();
    } catch (err) {
      this._message = `Create template failed: ${err}`;
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
      name,
      files: templateEditorPluginFiles.map((file) => ({
        path: file.path,
        source: file.source
          .replace("id: 'com.example.editor-plugin'", `id: '${id}'`)
          .replace("name: 'Example Editor Plugin'", `name: '${name}'`)
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
    } catch (err) {
      this._message = `Update plugin failed: ${err}`;
    } finally {
      this._busy = false;
    }
  }

  private async removeSelected(plugin: SystemPluginRecord) {
    this._busy = true;
    try {
      await this._editor.removeSystemPlugin(plugin.id);
      await this.reload();
    } catch (err) {
      this._message = `Remove plugin failed: ${err}`;
    } finally {
      this._busy = false;
    }
  }

  private async exportPlugin(plugin: SystemPluginRecord) {
    this._busy = true;
    try {
      await this._editor.exportSystemPlugin(plugin.id);
      this._message = `Exported plugin '${plugin.id}' as zip.`;
    } catch (err) {
      this._message = `Export zip failed: ${err}`;
    } finally {
      this._busy = false;
    }
  }

  private async browseFiles(plugin: SystemPluginRecord) {
    await DlgPluginFiles.show(this._editor, plugin);
  }
}
