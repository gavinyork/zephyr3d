import { eventBus } from '../core/eventbus';
import type { DocumentType } from '../components/common';
import { DlgNewScene } from '../views/scene/newscenedlg';
import { BaseController } from './basecontroller';
import { EditorApiService } from '../api/services/editorservice';
import { ApiClient } from '../api/client/apiclient';

export class EmptyController extends BaseController<null> {
  private _editorservice: EditorApiService;
  constructor(apiClient: ApiClient) {
    super(null);
    this._editorservice = new EditorApiService(apiClient);
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
      new DlgNewScene('New Scene', true);
    }
  }
  requestClose() {
    eventBus.dispatchEvent('switch_module', 'Empty');
  }
  requestNewScene(name: string) {
    this._editorservice.createScene(name).then((val) => {
      eventBus.dispatchEvent('switch_module', val.name, val.uuid);
    });
  }
}
