import { ImGui } from '@zephyr3d/imgui';
import { ModalDialog } from '../../components/modal';
import type { DBSceneInfo } from '../../storage/db';
import { eventBus } from '../../core/eventbus';

export class DlgOpenScene extends ModalDialog {
  private _sceneNames: string[];
  private _sceneIds: string[];
  private _selected: [number];
  constructor(id: string, open: boolean, scenes: DBSceneInfo[], width?: number, height?: number) {
    super(id, open, width, height);
    this._sceneNames = scenes.map((scene) => scene.name);
    this._sceneIds = scenes.map((scene) => scene.uuid);
    this._selected = [0];
  }
  doRender(): void {
    ImGui.SetNextItemWidth(ImGui.GetContentRegionAvail().x);
    ImGui.ListBox('##SceneList', this._selected, this._sceneNames, this._sceneNames.length, 5);
    if (ImGui.Button('Open')) {
      if (this._selected[0] >= 0 && this._selected[0] < this._sceneIds.length) {
        eventBus.dispatchEvent('action_doc_request_open_scene', this._sceneIds[this._selected[0]]);
        this.close();
      }
    }
    ImGui.SameLine();
    if (ImGui.Button('Cancel')) {
      this.close();
    }
  }
}
