import type { DBSceneInfo } from '../../storage/db';
import { DlgMessage } from './messagedlg';
import { DlgPromptName } from './newscenedlg';
import { DlgOpenScene } from './openscenedlg';

export class Dialog {
  public static messageBox(title: string, message: string, width?: number, height?: number) {
    new DlgMessage(`${title}##Dialog`, message, true, width, height);
  }
  public static openScene(title: string, scene: DBSceneInfo[], width?: number, height?: number) {
    new DlgOpenScene(title, true, scene, width, height);
  }
  public static saveScene(title: string, width?: number, height?: number) {
    new DlgPromptName(title, true, 'action_doc_request_save_scene', width, height);
  }
}
