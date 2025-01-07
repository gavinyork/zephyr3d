import { ImGui } from '@zephyr3d/imgui';
import { ModalDialog } from '../../components/modal';
import { eventBus } from '../../core/eventbus';

export class DlgPromptName extends ModalDialog {
  private _sceneName: string;
  private _action: 'action_doc_request_save_scene';
  constructor(
    id: string,
    open: boolean,
    action: 'action_doc_request_save_scene',
    width?: number,
    height?: number
  ) {
    super(id, open, width, height);
    this._sceneName = '';
    this._action = action;
  }
  doRender(): void {
    const name = [this._sceneName] as [string];
    if (ImGui.InputText('Scene Name', name)) {
      this._sceneName = name[0];
    }
    if (ImGui.Button('Save')) {
      this.close();
      eventBus.dispatchEvent(this._action, this._sceneName);
    }
    ImGui.SameLine();
    if (ImGui.Button('Cancel')) {
      this.close();
    }
  }
}
