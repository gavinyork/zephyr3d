import { imGuiEndFrame, imGuiInjectEvent, imGuiNewFrame } from '@zephyr3d/imgui';
import { eventBus } from './eventbus';
import { DialogRenderer } from '../components/modal';
import { ModuleManager } from './module';
import { SceneView } from '../views/sceneview';
import { SceneController } from '../controllers/scenecontroller';
import { SceneModel } from '../models/scenemodel';
import { FontGlyph } from './fontglyph';
import { AssetManager, DRef } from '@zephyr3d/scene';
import type { Texture2D } from '@zephyr3d/device';
import {
  analyzeGPUObjectGrowth,
  formatGrowthAnalysis,
  getGPUObjectStatistics
} from '../helpers/leakdetector';
import { HttpFS } from '@zephyr3d/base';
import { ProjectInfo, ProjectService } from './services/project';

export class Editor {
  private _moduleManager: ModuleManager;
  private _assetImages: { brushes: { [key: string]: DRef<Texture2D> } };
  private _leakTestA: ReturnType<typeof getGPUObjectStatistics>;
  private _currentProject: ProjectInfo;
  private _currentProjectIsTemporal: boolean;
  constructor() {
    this._moduleManager = new ModuleManager();
    this._assetImages = { brushes: {} };
    this._leakTestA = null;
    this._currentProject = null;
    this._currentProjectIsTemporal = false;
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
    if (ev.type === 'dragenter' || ev.type === 'dragover' || ev.type === 'drop' || ev.type === 'dragleave') {
      ev.preventDefault();
      if (ev.type === 'dragenter') {
        eventBus.dispatchEvent('external_dragenter', ev as DragEvent);
      } else if (ev.type === 'dragover') {
        eventBus.dispatchEvent('external_dragover', ev as DragEvent);
      } else if (ev.type === 'dragleave') {
        eventBus.dispatchEvent('external_dragleave', ev as DragEvent);
      } else {
        eventBus.dispatchEvent('external_drop', ev as DragEvent);
      }
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
  get currentProject() {
    return this._currentProject;
  }
  async init() {
    //await Database.init();
    await FontGlyph.loadFontGlyphs('zef-16px');
    await this.loadAssets();
    const recentProjects = await ProjectService.getRecentProjects();
    if (recentProjects.length === 0) {
      const uuid = await ProjectService.createProject('MyProject');
      this._currentProject = await ProjectService.openProject(uuid);
      this._currentProjectIsTemporal = true;
    } else {
      this._currentProject = await ProjectService.openProject(recentProjects[0].uuid);
      this._currentProjectIsTemporal = false;
    }
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
      if (this._currentProject) {
        module.view.render();
      }
      DialogRenderer.render();
      imGuiEndFrame();
    }
  }
}
