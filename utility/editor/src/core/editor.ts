import { imGuiEndFrame, imGuiInjectEvent, imGuiNewFrame } from '@zephyr3d/imgui';
import { eventBus } from './eventbus';
import { ModalDialog } from '../components/modal';
import { ModuleManager } from './module';
import { SceneView } from '../views/sceneview';
import { SceneController } from '../controllers/scenecontroller';
import { SceneModel } from '../models/scenemodel';
import { FontGlyph } from './fontglyph';
import { Database } from '../storage/db';
import { EditorAssetRegistry } from './assetregistry';
import { AssetManager, DRef } from '@zephyr3d/scene';
import { Texture2D } from '@zephyr3d/device';

export class Editor {
  private static _instance: Editor;
  private _moduleManager: ModuleManager;
  private _assetImages: { brushes: { [key: string]: DRef<Texture2D> } };
  private constructor() {
    this._moduleManager = new ModuleManager();
    this._assetImages = { brushes: {} };
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
    if (this._moduleManager.currentModule.controller?.handleEvent(ev)) {
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
  getBrushes() {
    return this._assetImages.brushes;
  }
  async init() {
    await Database.init();
    await FontGlyph.loadFontGlyphs('zef-16px');
    await this.loadAssets();
  }
  async loadAssets() {
    const assetManager = new AssetManager();
    const brushConfig = await assetManager.fetchJsonData('assets/conf/brushes.json');
    for (const name in brushConfig) {
      const tex = await assetManager.fetchTexture<Texture2D>(brushConfig[name]);
      this._assetImages.brushes[name] = new DRef(tex);
    }
  }
  registerModules() {
    const assetRegistry = new EditorAssetRegistry();
    const sceneModel = new SceneModel();
    const sceneView = new SceneView(sceneModel, assetRegistry);
    const sceneController = new SceneController(sceneModel, sceneView, assetRegistry);
    this._moduleManager.register('Scene', sceneModel, sceneView, sceneController);

    this._moduleManager.activate('Scene', null);
    eventBus.on('switch_module', (name, ...args: any[]) => {
      this._moduleManager.activate(name, ...args);
    });
  }
  render() {
    const module = this._moduleManager.currentModule;
    if (module?.view) {
      imGuiNewFrame();
      module.view.render();
      ModalDialog.render();
      imGuiEndFrame();
    }
  }
}
