import type { BaseController } from '../controllers/basecontroller';
import type { BaseModel } from '../models/basemodel';
import type { BaseView } from '../views/baseview';

export class ModuleManager {
  private _modules: Record<
    string,
    {
      name: string;
      model: BaseModel;
      view: BaseView<any>;
      controller: BaseController<any>;
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
  register(name: string, model: BaseModel, view: BaseView<any>, controller: BaseController<any>) {
    if (!name) {
      throw new Error(`Invalid module name: ${name}`);
    }
    if (this._modules[name]) {
      throw new Error(`Module ${name} already registered`);
    }
    this._modules[name] = { name, model, view, controller };
  }
  activate(name: string, ...args: any[]) {
    const module = this._modules[name];
    if (!module) {
      throw new Error(`Cannot activate module ${name}: Module not exists`);
    }
    const currentModule = this._modules[this._currentModule];
    if (currentModule) {
      currentModule.controller?.deactivate();
      currentModule.view?.deactivate();
    }
    this._currentModule = name;
    module.controller?.activate(...args);
    module.view?.activate();
  }
}
