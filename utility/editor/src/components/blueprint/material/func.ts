import type { NodeCategory } from '../api';
import { GraphEditor } from '../grapheditor';
import { getConstantNodeCategories } from '../nodes/constants';
import { getMathNodeCategories } from '../nodes/math';
import { getTextureNodeCategories } from './texture';
import { ASSERT } from '@zephyr3d/base';
import { ImGui } from '@zephyr3d/imgui';
import { getInputNodeCategories } from './inputs';
import { ProjectService } from '../../../core/services/project';
import { Dialog } from '../../../views/dlg/dlg';
import type { NodeEditorState } from '../nodeeditor';
import { getFunctionNodeCategories } from '../nodes/func';

export class MaterialFunctionEditor extends GraphEditor {
  private _version: number;
  constructor(label: string) {
    super(label, ['function']);
    this._version = 0;
    this.nodePropEditor.on('object_property_changed', this.graphChanged, this);
    this.getNodeEditor('function').on('changed', this.graphChanged, this);
  }
  open() {}
  close() {}
  getNodeCategory(): NodeCategory[] {
    return [
      ...getConstantNodeCategories(),
      ...getInputNodeCategories(),
      ...getTextureNodeCategories(),
      ...getMathNodeCategories(),
      ...getFunctionNodeCategories()
    ];
  }
  get saved() {
    return this._version === this.getNodeEditor('function').version;
  }
  async save(path: string) {
    if (path) {
      const VFS = ProjectService.VFS;
      // Save blueprint
      const state = await this.getNodeEditor('function').saveState();
      try {
        await VFS.writeFile(path, JSON.stringify({ type: 'MaterialFunction', state }, null, 2), {
          encoding: 'utf8',
          create: true
        });
      } catch (err) {
        const msg = `Save material failed: ${err}`;
        console.error(msg);
        Dialog.messageBox('Error', msg);
      }
      this._version = this.getNodeEditor('function').version;
    }
  }
  async load(path: string) {
    try {
      const blueprintContent = (await ProjectService.VFS.readFile(path, { encoding: 'utf8' })) as string;
      const blueprintData = JSON.parse(blueprintContent);
      ASSERT(blueprintData.type === 'MaterialFunction', 'Invalid PBR Material BluePrint');
      const state = blueprintData.state as NodeEditorState;
      await this.getNodeEditor('function').loadState(state);
      this._version = this.getNodeEditor('function').version;
    } catch (err) {
      const msg = `Load material failed: ${err}`;
      console.error(msg);
      Dialog.messageBox('Error', msg);
    }
  }
  protected renderRightPanel() {
    const v = new ImGui.ImVec2();
    ImGui.GetContentRegionAvail(v);
    if (ImGui.BeginChild('##BluePrintNodeProps', v, true)) {
      super.renderRightPanel();
    }
    ImGui.EndChild();
  }
  protected onPropChanged(): void {}
  private graphChanged() {}
}
