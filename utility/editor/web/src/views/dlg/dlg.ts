import { DlgMessage } from './messagedlg';
import { DlgNewScene } from './newscenedlg';

export class Dialog {
  public static messageBox(title: string, message: string, width?: number) {
    new DlgMessage(`${title}##Dialog`, true, width, message);
  }
  public static createScene(title: string) {
    new DlgNewScene(title, true);
  }
}
