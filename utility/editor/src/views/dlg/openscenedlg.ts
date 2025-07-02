import { ImGui } from '@zephyr3d/imgui';
import { DialogRenderer } from '../../components/modal';
import type { DBSceneInfo } from '../../storage/db';

export class DlgOpenScene extends DialogRenderer {
  private _sceneNames: string[];
  private _sceneIds: string[];
  private _selected: [number];
  private _resolve: (s: string) => void;
  constructor(
    id: string,
    scenes: DBSceneInfo[],
    width: number,
    height: number,
    resolve: (s: string) => void
  ) {
    super(id, width, height);
    this._sceneNames = scenes.map((scene) => scene.name);
    this._sceneIds = scenes.map((scene) => scene.uuid);
    this._selected = [0];
    this._resolve = resolve;
  }
  doRender(): void {
    if (ImGui.BeginChild('ListBox', new ImGui.ImVec2(0, -ImGui.GetFrameHeightWithSpacing()), true)) {
      if (ImGui.ListBoxHeader('ListBoxHeader', new ImGui.ImVec2(-1, -1))) {
        for (let i = 0; i < this._sceneIds.length; i++) {
          if (ImGui.Selectable(this._sceneNames[i], this._selected[0] === i)) {
            this._selected[0] = i;
          }
        }
        ImGui.ListBoxFooter();
      }
    }
    ImGui.EndChild();
    if (ImGui.Button('Open')) {
      if (this._selected[0] >= 0 && this._selected[0] < this._sceneIds.length) {
        this._resolve(this._sceneIds[this._selected[0]]);
        this.close();
      }
    }
    ImGui.SameLine();
    if (ImGui.Button('Cancel')) {
      this._resolve('');
      this.close();
    }
  }
}
