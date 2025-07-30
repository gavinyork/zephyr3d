import type { DBSceneInfo } from '../../storage/db';
import { DlgOpen } from './opendlg';

export class DlgOpenScene extends DlgOpen {
  public static async openScene(
    title: string,
    scene: DBSceneInfo[],
    width?: number,
    height?: number
  ): Promise<string> {
    return new DlgOpenScene(title, scene, width, height).showModal();
  }
  constructor(id: string, scenes: DBSceneInfo[], width: number, height: number) {
    super(
      id,
      scenes.map((scene) => scene.name),
      scenes.map((scene) => scene.uuid),
      width,
      height
    );
  }
}
