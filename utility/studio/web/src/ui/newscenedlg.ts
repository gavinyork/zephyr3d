import { ImGui } from '@zephyr3d/imgui';
import { ModalDialog } from './modal';
import { eventBus } from '../eventbus';

export class DlgNewScene extends ModalDialog {
  private _sceneName: string;
  constructor(id: string, open: boolean) {
    super(id, open);
    this._sceneName = '';
  }
  doRender(): void {
    const name = [this._sceneName] as [string];
    if (ImGui.InputText('场景名称', name)) {
      this._sceneName = name[0];
    }
    if (ImGui.Button('确定')) {
      this.close();
      eventBus.dispatchEvent('action_doc_post_new', 'scene');
    }
  }
}
