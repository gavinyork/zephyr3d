import { imGuiEndFrame, imGuiInjectEvent, imGuiNewFrame } from '@zephyr3d/imgui';
import { eventBus } from './eventbus';
import { DialogRenderer } from '../components/modal';
import { ModuleManager } from './module';
import { SceneView } from '../views/sceneview';
import { SceneController } from '../controllers/scenecontroller';
import { SceneModel } from '../models/scenemodel';
import { FontGlyph } from './fontglyph';
import { Database } from '../storage/db';
import { AssetManager, DRef } from '@zephyr3d/scene';
import type { Texture2D } from '@zephyr3d/device';
import {
  analyzeGPUObjectGrowth,
  formatGrowthAnalysis,
  getGPUObjectStatistics
} from '../helpers/leakdetector';
import { HttpFS } from '@zephyr3d/base';

export class Editor {
  private _moduleManager: ModuleManager;
  private _assetImages: { brushes: { [key: string]: DRef<Texture2D> } };
  private _leakTestA: ReturnType<typeof getGPUObjectStatistics>;
  constructor() {
    this._moduleManager = new ModuleManager();
    this._assetImages = { brushes: {} };
    this._leakTestA = null;
  }
  handleEvent(ev: Event, type?: string): boolean {
    if (
      ev.type === 'keyup' &&
      (ev as KeyboardEvent).key === 'F12' &&
      (ev as KeyboardEvent).ctrlKey &&
      !(ev as KeyboardEvent).shiftKey &&
      !(ev as KeyboardEvent).altKey
    ) {
      const statistics = getGPUObjectStatistics();
      if (!this._leakTestA) {
        this._leakTestA = statistics;
      } else {
        const analysis = analyzeGPUObjectGrowth(this._leakTestA, statistics, {
          minGrowth: 1,
          stackDepth: 32,
          includeNewStacks: true
        });
        console.log(formatGrowthAnalysis(analysis));
        this._leakTestA = null;
      }
      return true;
    }
    if (imGuiInjectEvent(ev, type)) {
      return true;
    }
    if (ev.type === 'dragenter' || ev.type === 'dragover' || ev.type === 'drop') {
      ev.preventDefault();
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
    const assetManager = new AssetManager(
      new HttpFS(window.location.href.slice(0, window.location.href.lastIndexOf('/')))
    );
    const brushConfig = await assetManager.fetchJsonData('assets/conf/brushes.json');
    for (const name in brushConfig) {
      const tex = await assetManager.fetchTexture<Texture2D>(brushConfig[name]);
      this._assetImages.brushes[name] = new DRef(tex);
    }
  }
  registerModules() {
    const sceneModel = new SceneModel(this);
    const sceneView = new SceneView(this, sceneModel);
    const sceneController = new SceneController(this, sceneModel, sceneView);
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
      DialogRenderer.render();
      imGuiEndFrame();
    }
  }
}
