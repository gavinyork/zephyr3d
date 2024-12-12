import { imGuiEndFrame, imGuiInjectEvent, imGuiNewFrame, imGuiSetFontGlyph } from '@zephyr3d/imgui';
import { eventBus } from './eventbus';
import { ModalDialog } from '../components/modal';
import { ModuleManager } from './module';
import { EmptyView } from '../views/emptyview';
import { EmptyController } from '../controllers/emptycontroller';
import { SceneView } from '../views/sceneview';
import { SceneController } from '../controllers/scenecontroller';
import { SceneModel } from '../models/scenemodel';
import { ApiClient } from '../api/client/apiclient';
import { Font } from '@zephyr3d/device';
import { Application } from '@zephyr3d/scene';
import { ICONS } from '../views/icons';

export class Editor {
  private static _instance: Editor;
  private _moduleManager: ModuleManager;
  private _apiClient: ApiClient;
  private constructor() {
    this._apiClient = new ApiClient();
    this._moduleManager = new ModuleManager(this._apiClient);
    this._moduleManager.register('Empty', null, EmptyView, EmptyController);
    this._moduleManager.register('Scene', SceneModel, SceneView, SceneController);
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
    if (imGuiInjectEvent(ev, type)) {
      return true;
    }
    if (this._moduleManager.currentModule.controller?.handleEvent(ev, type)) {
      return true;
    }
    return false;
  }
  resize(w: number, h: number) {
    eventBus.dispatchEvent('resize', w, h);
  }
  update(dt: number) {
    eventBus.dispatchEvent('update', dt);
  }
  async loadEditorFonts() {
    try {
      const font = new FontFace('EditorIcon', 'url(assets/fonts/icons.woff2');
      const loadedFont = await font.load();
      document.fonts.add(loadedFont);
    } catch (err) {
      console.error(`Failed to load icon font: ${err}`);
    }
    const deviceFont = new Font('12px EditorIcon', Application.instance.device.getScale());
    for (const k of Object.getOwnPropertyNames(ICONS)) {
      const charCode = String(ICONS[k]).charCodeAt(0);
      imGuiSetFontGlyph(charCode, deviceFont);
    }
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
