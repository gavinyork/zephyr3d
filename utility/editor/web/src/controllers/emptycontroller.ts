import { eventBus } from '../core/eventbus';
import type { DocumentType } from '../components/common';
import { DlgNewScene } from '../views/dlg/newscenedlg';
import { BaseController } from './basecontroller';
import { EditorApiService } from '../api/services/editorservice';
import type { ApiClient } from '../api/client/apiclient';
import type { BaseModel } from '../models/basemodel';
import { Dialog } from '../views/dlg/dlg';

export class EmptyController<T extends BaseModel> extends BaseController<T> {
  private _editorservice: EditorApiService;
  constructor(model: T, apiClient: ApiClient) {
    super(model, apiClient);
    this._editorservice = new EditorApiService(this.apiClient);
  }
  protected onActivate(): void {
    eventBus.on('action_doc_request_new', this.requestNew, this);
    eventBus.on('action_doc_request_close', this.requestClose, this);
    eventBus.on('action_doc_request_new_scene', this.requestNewScene, this);
  }
  protected onDeactivate() {
    eventBus.off('action_doc_request_new', this.requestNew, this);
    eventBus.off('action_doc_request_close', this.requestClose, this);
    eventBus.off('action_doc_request_new_scene', this.requestNewScene, this);
  }
  requestNew(type: DocumentType) {
    if (type === 'scene') {
      Dialog.createScene('New Scene');
    }
  }
  requestClose() {
    eventBus.dispatchEvent('switch_module', 'Empty');
  }
  requestNewScene(name: string) {
    this._editorservice.createScene(name).then((val) => {
      eventBus.dispatchEvent('switch_module', 'Scene', val.name, val.uuid);
    });
  }
}
