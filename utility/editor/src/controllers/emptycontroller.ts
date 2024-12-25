import { eventBus } from '../core/eventbus';
import type { DocumentType } from '../components/common';
import { BaseController } from './basecontroller';
import type { BaseModel } from '../models/basemodel';
import { Dialog } from '../views/dlg/dlg';
import { Database, SceneInfo } from '../storage/db';

export class EmptyController<T extends BaseModel> extends BaseController<T> {
  constructor(model: T) {
    super(model);
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
    const scene: SceneInfo = {
      name,
      content: {},
      metadata: {}
    };
    Database.addScene(scene).then((uuid) => {
      scene.uuid = uuid;
      eventBus.dispatchEvent('switch_module', 'Scene', scene);
    });
  }
}
