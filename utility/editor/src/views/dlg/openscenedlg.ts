import type { DBSceneInfo } from '../../storage/db';
import { DlgOpen } from './opendlg';

export class DlgOpenScene extends DlgOpen {
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
