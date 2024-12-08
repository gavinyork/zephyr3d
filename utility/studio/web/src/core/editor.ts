import { imGuiEndFrame, imGuiInjectEvent, imGuiNewFrame } from '@zephyr3d/imgui';
import { eventBus } from './eventbus';
import type { BaseController } from '../controllers/basecontroller';
import { ModalDialog } from '../components/modal';

export class Editor {
  private static _instance: Editor;
  private _controller: BaseController<any, any>;
  private constructor() {
    this._controller = null;
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
    if (this._controller) {
      imGuiNewFrame();
      this._controller.render();
      ModalDialog.render();
      imGuiEndFrame();
    }
  }
}
