import { ImGui } from '@zephyr3d/imgui';
import { ListView, ListViewData } from '../../components/listview';
import { DialogRenderer } from '../../components/modal';
import type { Editor } from '../../core/editor';
import type { SystemPluginRecord } from '../../core/services/systemplugin';
import { FilePicker } from '../../components/filepicker';
import { templateEditorPlugin } from '../../core/build/templates';
import { SystemPluginService } from '../../core/services/systemplugin';

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

  protected onSelectionChanged(): void {}
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
      ImGui.Text(`Id: ${selected.id}`);
      ImGui.Text(`Entry: ${selected.entry}`);
      if (selected.description) {
        ImGui.TextWrapped(selected.description);
      }
      if (ImGui.Button(selected.enabled ? 'Disable' : 'Enable') && !this._busy) {
        this.toggleSelected(selected);
      }
      ImGui.SameLine();
      if (ImGui.Button('Remove') && !this._busy) {
        this.removeSelected(selected);
      }
      ImGui.SameLine();
      if (ImGui.Button('Open Source') && !this._busy) {
        const entryPath = SystemPluginService.VFS.normalizePath(
          selected.packageDir + '/' + selected.entry.replace(/^\/+/, '')
        );
        this._editor.editCode(entryPath, entryPath.endsWith('.ts') ? 'typescript' : 'javascript');
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

  private async createTemplatePlugin() {
    this._busy = true;
    try {
      const file = new File([templateEditorPlugin], 'example-editor-plugin.ts', {
        type: 'text/typescript'
      });
      const plugin = await this._editor.installSystemPluginFromFile(file);
      this._message = `Created plugin template '${plugin.id}'. You can open its source and continue editing.`;
      await this.reload();
    } catch (err) {
      this._message = `Create template failed: ${err}`;
    } finally {
      this._busy = false;
    }
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
}
