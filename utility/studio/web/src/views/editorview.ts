import { Menubar } from '../components/menubar';
import { BaseView } from './baseview';

export class EditorView extends BaseView<void> {
  private _mainMenuBar: Menubar;
  constructor() {
    super();
    this._mainMenuBar = new Menubar();
  }
  public render() {
    this._mainMenuBar.render();
  }
}
