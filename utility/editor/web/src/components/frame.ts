import { eventBus } from '../core/eventbus';
import type { DocumentType } from './common';
import { Menubar } from './menubar';
import { ModalDialog } from './modal';
import { DlgNewScene } from '../views/dlg/newscenedlg';

export class Frame {
  private _mainMenuBar: Menubar;
  constructor() {
    this._mainMenuBar = new Menubar();
    eventBus.on('action_doc_request_new', this.requestNew, this);
    eventBus.on('action_doc_request_close', this.requestClose, this);
  }
  dispose() {
    eventBus.off('action_doc_request_new', this.requestNew, this);
  }
  requestNew(type: DocumentType) {
    if (type === 'scene') {
      new DlgNewScene('New Scene', true);
    }
  }
  requestClose(type: DocumentType) {
    eventBus.dispatchEvent('action_doc_post_close', type);
  }
  render() {
    this._mainMenuBar.render();
    ModalDialog.render();
  }
}
