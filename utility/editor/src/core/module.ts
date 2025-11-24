import type { BaseController } from '../controllers/basecontroller';
import type { BaseModel } from '../models/basemodel';
import type { BaseView } from '../views/baseview';

export class ModuleManager {
  private _modules: Record<
    string,
    {
      name: string;
      model: BaseModel;
      view: BaseView<any, any>;
      controller: BaseController<any, any>;
    }
  >;
  private _currentModule: string;
  constructor() {
    this._modules = {};
    this._currentModule = '';
  }
  get currentModule() {
    return this._modules[this._currentModule] ?? null;
  }
  register(name: string, controller: BaseController<any, any>) {
    if (!name) {
      throw new Error(`Invalid module name: ${name}`);
    }
    if (this._modules[name]) {
      throw new Error(`Module ${name} already registered`);
    }
    this._modules[name] = { name, model: controller.model, view: controller.view, controller };
  }
  async activate(name: string, ...args: any[]) {
    const currentModule = this._modules[this._currentModule];
    if (currentModule) {
      currentModule.controller?.deactivate();
      currentModule.view?.deactivate();
    }
    this._currentModule = '';
    if (name) {
      const module = this._modules[name];
      if (!module) {
        throw new Error(`Cannot activate module ${name}: Module not exists`);
      }
      await module.controller?.activate(...args);
      module.view?.activate();
      this._currentModule = name;
    }
  }
}
