import { ImGui } from '@zephyr3d/imgui';
import { ModalDialog } from '../../components/modal';
import { eventBus } from '../../core/eventbus';

export class DlgNewScene extends ModalDialog {
  private _sceneName: string;
  private _action: 'action_doc_request_new_scene' | 'action_doc_request_save_scene';
  constructor(
    id: string,
    open: boolean,
    action: 'action_doc_request_new_scene' | 'action_doc_request_save_scene',
    width?: number
  ) {
    super(id, open, width);
    this._sceneName = '';
    this._action = action;
  }
  doRender(): void {
    const name = [this._sceneName] as [string];
    if (ImGui.InputText('Scene Name', name)) {
      this._sceneName = name[0];
    }
    if (ImGui.Button('OK')) {
      this.close();
      eventBus.dispatchEvent(this._action, this._sceneName);
    }
  }
}
