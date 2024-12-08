import { eventBus } from '../core/eventbus';
import type { BaseView } from '../views/baseview';

export class BaseController<Model, View extends BaseView<Model>> {
  private static _activeController: BaseController<any, any> = null;
  private _name: string;
  private _model: Model;
  private _view: View;
  constructor(name: string, model: Model, view: View) {
    this._name = name;
    this._model = model;
    this._view = view;
  }
  get model() {
    return this._model;
  }
  get view() {
    return this._view;
  }
  render() {
    this._view.render(this._model);
  }
  activate() {
    if (BaseController._activeController !== this) {
      BaseController._activeController.deactivate();
    }
    BaseController._activeController = this;
    eventBus.on('error', this.onError, this);
    this.onActivate();
  }
  deactivate() {
    if (BaseController._activeController === this) {
      BaseController._activeController = null;
      eventBus.off('error', this.onError, this);
      this.onDeactivate();
    }
  }
  onError(err: string) {
    console.error(err);
  }
  protected onActivate() {
    console.log(`Controller activated: ${this._name}`);
  }
  protected onDeactivate() {
    console.log(`Controller deactivated: ${this._name}`);
  }
}
