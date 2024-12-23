import { ImGui, imGuiEndFrame, imGuiInjectEvent, imGuiNewFrame } from '@zephyr3d/imgui';
import { eventBus } from './eventbus';
import { ModalDialog } from '../components/modal';
import { ModuleManager } from './module';
import { EmptyView } from '../views/emptyview';
import { EmptyController } from '../controllers/emptycontroller';
import { SceneView } from '../views/sceneview';
import { SceneController } from '../controllers/scenecontroller';
import { SceneModel } from '../models/scenemodel';
import { ApiClient } from '../api/client/apiclient';
import { FontGlyph } from './fontglyph';
import { Database } from '../storage/db';

export class Editor {
  private static _instance: Editor;
  private _moduleManager: ModuleManager;
  private _apiClient: ApiClient;
  private constructor() {
    this._apiClient = new ApiClient();
    this._moduleManager = new ModuleManager();
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
  async init() {
    await Database.init();
    await FontGlyph.loadFontGlyphs(this._apiClient, 'zef-16px');
  }
  registerModules() {
    const emptyView = new EmptyView(null);
    const emptyController = new EmptyController(null, this._apiClient);
    this._moduleManager.register('Empty', null, emptyView, emptyController);

    const sceneModel = new SceneModel();
    const sceneView = new SceneView(sceneModel);
    const sceneController = new SceneController(sceneModel, sceneView, this._apiClient);
    this._moduleManager.register('Scene', sceneModel, sceneView, sceneController);

    this._moduleManager.activate('Empty');
    eventBus.on('switch_module', (name, ...args: any[]) => {
      this._moduleManager.activate(name, ...args);
    });
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
