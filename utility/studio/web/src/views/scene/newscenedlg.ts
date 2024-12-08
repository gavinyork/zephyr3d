import { ImGui } from '@zephyr3d/imgui';
import { ModalDialog } from '../../components/modal';
import { eventBus } from '../../core/eventbus';
import { createScene } from '../../api/services/sceneservcie';

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
      createScene(this._sceneName).then((value) => {
        this.close();
        if (value) {
          eventBus.dispatchEvent('action_doc_post_new', 'scene', value.name, value.uuid);
        }
      });
    }
  }
}
