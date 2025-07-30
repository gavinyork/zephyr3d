import { ImGui } from '@zephyr3d/imgui';
import { DialogRenderer } from '../../components/modal';
import type { DBSceneInfo } from '../../storage/db';
import { renderMultiSelectedCombo } from '../../components/multicombo';

export class DlgExportScene extends DialogRenderer<DBSceneInfo[]> {
  private _sceneList: { text: string; selected: boolean; info: DBSceneInfo }[];
  public static async batchExportScene(
    title: string,
    scene: DBSceneInfo[],
    width?: number,
    height?: number
  ): Promise<DBSceneInfo[]> {
    return new DlgExportScene(title, scene, width, height).showModal();
  }
  constructor(id: string, scenes: DBSceneInfo[], width: number, height: number) {
    super(id, width, height);
    this._sceneList = scenes.map((scene) => ({ text: scene.name, selected: false, info: scene }));
  }
  doRender(): void {
    renderMultiSelectedCombo('Select scenes to export:', this._sceneList, -1);
    if (ImGui.Button('Export')) {
      const scenesForExport = this._sceneList.filter((val) => val.selected).map((val) => val.info);
      if (scenesForExport.length > 0) {
        this.close(scenesForExport);
      }
    }
    ImGui.SameLine();
    if (ImGui.Button('Cancel')) {
      this.close([]);
    }
  }
}
