import { imGuiEndFrame, imGuiInjectEvent, imGuiNewFrame } from '@zephyr3d/imgui';
import { eventBus } from './eventbus';
import { ModalDialog } from '../components/modal';
import { ModuleManager } from './module';
import { EmptyView } from '../views/emptyview';
import { EmptyController } from '../controllers/emptycontroller';

export class Editor {
  private static _instance: Editor;
  private _moduleManager: ModuleManager;
  private constructor() {
    this._moduleManager = new ModuleManager();
    this._moduleManager.register('Empty', null, EmptyView, EmptyController);
    this._moduleManager.activate('Empty');
    eventBus.on('switch_module', (name, ...args: any[]) => {
      this._moduleManager.activate(name, ...args);
    });
  }
  static get instance(): Editor {
    if (!this._instance) {
      this._instance = new Editor();
    }
    return this._instance;
  }
  handleEvent(ev: Event, type?: string): boolean {
    return imGuiInjectEvent(ev, type);
  }
  resize(w: number, h: number) {
    eventBus.dispatchEvent('resize', w, h);
  }
  update(dt: number) {
    eventBus.dispatchEvent('update', dt);
  }
  render() {
    const module = this._moduleManager.currentModule;
    if (module.view) {
      imGuiNewFrame();
      module.view.render();
      ModalDialog.render();
      imGuiEndFrame();
    }
  }
}
