import { eventBus } from '../core/eventbus';

export class BaseController {
  private static _activeController: BaseController = null;
  private _name: string;
  constructor(name: string) {
    this._name = name;
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
