import { BaseModel } from '../models/basemodel';

export abstract class BaseView<Model extends BaseModel> {
  private _model: Model;
  constructor(model: Model) {
    this._model = model;
  }
  get model() {
    return this._model;
  }
  activate() {
    this.onActivate();
  }
  deactivate() {
    this.onDeactivate();
  }
  abstract render();
  protected onActivate() {}
  protected onDeactivate() {}
}
