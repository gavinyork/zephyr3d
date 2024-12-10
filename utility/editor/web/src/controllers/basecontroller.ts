import { ApiClient } from '../api/client/apiclient';
import { eventBus } from '../core/eventbus';
import type { BaseModel } from '../models/basemodel';

export class BaseController<Model extends BaseModel> {
  private _model: Model;
  private _apiClient: ApiClient;
  constructor(model: Model, apiClient: ApiClient) {
    this._model = model;
    this._apiClient = apiClient;
  }
  get model() {
    return this._model;
  }
  get apiClient() {
    return this._apiClient;
  }
  handleEvent(ev: Event, type?: string): boolean {
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
