import { eventBus } from '../core/eventbus';
import type { BaseModel } from '../models/basemodel';
import { BaseView } from '../views/baseview';

export abstract class BaseController<
  Model extends BaseModel,
  View extends BaseView<Model, BaseController<Model, View>>
> {
  constructor() {}
  get model() {
    return this.getModel();
  }
  get view() {
    return this.getView();
  }
  handleEvent(_ev: Event): boolean {
    return false;
  }
  abstract getModel(): Model;
  abstract getView(): View;
  async activate(...args: any[]): Promise<void> {
    eventBus.on('error', this.onError, this);
    await this.onActivate(...args);
  }
  deactivate() {
    eventBus.off('error', this.onError, this);
    this.onDeactivate();
  }
  onError(err: string) {
    console.error(err);
  }
  protected async onActivate(..._args: any[]) {}
  protected onDeactivate() {}
}
