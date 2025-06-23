import { ImGui } from '@zephyr3d/imgui';
import { ModalDialog } from '../../components/modal';
import type { DBSceneInfo } from '../../storage/db';
import { renderMultiSelectedCombo } from '../../components/multicombo';

export class DlgExportScene extends ModalDialog {
  private _sceneList: { text: string; selected: boolean; info: DBSceneInfo }[];
  private _resolve: (scenes: DBSceneInfo[]) => void;
  constructor(
    id: string,
    open: boolean,
    scenes: DBSceneInfo[],
    width: number,
    height: number,
    resolve: (scenes: DBSceneInfo[]) => void
  ) {
    super(id, open, width, height);
    this._sceneList = scenes.map((scene) => ({ text: scene.name, selected: false, info: scene }));
    this._resolve = resolve;
  }
  doRender(): void {
    renderMultiSelectedCombo('Select scenes to export:', this._sceneList, -1);
    if (ImGui.Button('Export')) {
      const scenesForExport = this._sceneList.filter((val) => val.selected).map((val) => val.info);
      if (scenesForExport.length > 0) {
        this._resolve(scenesForExport);
        this.close();
      }
    }
    ImGui.SameLine();
    if (ImGui.Button('Cancel')) {
      this._resolve([]);
      this.close();
    }
  }
}
