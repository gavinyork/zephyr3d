import { eventBus } from '../core/eventbus';
import type { BaseModel } from '../models/basemodel';

export class BaseController<Model extends BaseModel> {
  private _model: Model;
  constructor(model: Model) {
    this._model = model;
  }
  get model() {
    return this._model;
  }
  handleEvent(ev: Event): boolean {
    return false;
  }
  activate(...args: any[]) {
    eventBus.on('error', this.onError, this);
    this.onActivate(...args);
  }
  deactivate() {
    eventBus.off('error', this.onError, this);
    this.onDeactivate();
  }
  onError(err: string) {
    console.error(err);
  }
  protected onActivate(...args: any[]) {}
  protected onDeactivate() {}
}
