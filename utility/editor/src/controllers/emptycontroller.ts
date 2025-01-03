import { eventBus } from '../core/eventbus';
import type { DocumentType } from '../components/common';
import { BaseController } from './basecontroller';
import type { BaseModel } from '../models/basemodel';
import { Dialog } from '../views/dlg/dlg';
import { Database, type DBSceneInfo } from '../storage/db';
import type { EmptyView } from '../views/emptyview';

export class EmptyController<T extends BaseModel> extends BaseController<T> {
  private _view: EmptyView<null>;
  constructor(view: EmptyView<null>) {
    super(null);
    this._view = view;
  }
  handleEvent(ev: Event): boolean {
    return this._view.shortcut(ev);
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
    const scene: DBSceneInfo = {
      name,
      content: {},
      metadata: {}
    };
    Database.putScene(scene).then((uuid) => {
      scene.uuid = uuid;
      eventBus.dispatchEvent('switch_module', 'Scene', scene);
    });
  }
}
