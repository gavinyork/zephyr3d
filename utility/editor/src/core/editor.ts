import { ImGui, imGuiCalcTextSize, imGuiEndFrame, imGuiInjectEvent, imGuiNewFrame } from '@zephyr3d/imgui';
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
import { Dialog } from '../views/dlg/dlg';

export class Editor {
  private _moduleManager: ModuleManager;
  private _assetImages: {
    brushes: { [key: string]: DRef<Texture2D> };
    app: { [key: string]: DRef<Texture2D> };
  };
  private _leakTestA: ReturnType<typeof getGPUObjectStatistics>;
  private _currentProject: ProjectInfo;
  constructor() {
    this._moduleManager = new ModuleManager();
    this._assetImages = { brushes: {}, app: {} };
    this._leakTestA = null;
    this._currentProject = null;
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
    if (this._moduleManager.currentModule?.controller?.handleEvent(ev)) {
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
    const appConfig = await assetManager.fetchJsonData('assets/conf/app.json');
    for (const name in appConfig) {
      const tex = await assetManager.fetchTexture<Texture2D>(appConfig[name], {
        samplerOptions: { mipFilter: 'none' }
      });
      this._assetImages.app[name] = new DRef(tex);
    }
  }
  registerModules() {
    const sceneModel = new SceneModel(this);
    const sceneView = new SceneView(this, sceneModel);
    const sceneController = new SceneController(this, sceneModel, sceneView);
    this._moduleManager.register('Scene', sceneModel, sceneView, sceneController);

    //this._moduleManager.activate('Scene', null);
    eventBus.on('switch_module', (name, ...args: any[]) => {
      this._moduleManager.activate(name, ...args);
    });
  }
  render() {
    imGuiNewFrame();
    const module = this._moduleManager.currentModule;
    if (module?.view) {
      module.view.render();
    } else {
      this.renderWelcomePage();
    }
    DialogRenderer.render();
    imGuiEndFrame();
  }
  renderWelcomePage() {
    const io = ImGui.GetIO();
    const displaySize = io.DisplaySize;
    ImGui.SetNextWindowPos(new ImGui.ImVec2(0, 0));
    ImGui.SetNextWindowSize(displaySize);
    const frameHeight = ImGui.GetFrameHeight();
    const itemSpacing = 10;
    const flags =
      ImGui.WindowFlags.NoDecoration |
      ImGui.WindowFlags.NoMove |
      ImGui.WindowFlags.NoResize |
      ImGui.WindowFlags.NoSavedSettings |
      ImGui.WindowFlags.NoBringToFrontOnFocus;
    if (ImGui.Begin('WelcomePage', null, flags)) {
      ImGui.TextColored(new ImGui.ImVec4(0.3, 1, 0.3, 1), 'Welcome to zephyr3d editor');
      ImGui.Separator();
      const panelHeight = 10 * frameHeight + 9 * itemSpacing;
      const iconTex = this._assetImages.app.icon.get();
      const imageSize = new ImGui.ImVec2(160, 160);
      let cursorPosY = Math.max(imageSize.y + 10, (displaySize.y - panelHeight) >> 1);
      ImGui.SetCursorPosX(Math.max(0, (displaySize.x - imageSize.x) >> 1));
      ImGui.SetCursorPosY((cursorPosY - imageSize.y) >> 1);
      ImGui.Image(iconTex, imageSize);

      ImGui.PushStyleColor(ImGui.Col.Text, new ImGui.ImVec4(0.3, 0.5, 1, 1));
      ImGui.PushStyleColor(ImGui.Col.HeaderHovered, new ImGui.Vec4(0, 0, 0, 0)); // 透明悬停
      ImGui.PushStyleColor(ImGui.Col.HeaderActive, new ImGui.Vec4(0, 0, 0, 0)); // 透明激活
      ImGui.PushStyleColor(ImGui.Col.Header, new ImGui.Vec4(0, 0, 0, 0));
      const links = ['Create Project...', 'Open Project...'];
      ImGui.PushID('WelcomeLink');
      for (let i = 0; i < links.length; i++) {
        ImGui.PushID(i);
        const label = links[i];
        const textSize = imGuiCalcTextSize(label);
        ImGui.SetCursorPosY(cursorPosY);
        ImGui.SetCursorPosX(Math.max(0, (displaySize.x - textSize.x) >> 1));
        const selected = [false] as [boolean];
        if (ImGui.Selectable(label, selected, ImGui.SelectableFlags.None, textSize)) {
          if (i === 0) {
            // Create project
            Dialog.promptName('Create Project', 'Project Name', 'New Project', 400).then((name) => {
              if (name) {
                ProjectService.createProject(name).then((uuid) => {
                  ProjectService.openProject(uuid).then((project) => {
                    this._currentProject = project;
                    this._moduleManager.activate('Scene', null);
                    Dialog.saveFile(
                      'Test Save File',
                      ProjectService.VFS,
                      this._currentProject,
                      500,
                      400
                    ).then((path) => {
                      alert(path);
                    });
                  });
                });
              }
            });
          }
          if (i === 1) {
            ProjectService.listProjects().then((projects) => {
              const names = projects.map((project) => project.name);
              const ids = projects.map((project) => project.uuid);
              Dialog.openFromList('Open Project', names, ids, 400, 400).then((id) => {
                if (id) {
                  ProjectService.openProject(id).then((project) => {
                    this._currentProject = project;
                    this._moduleManager.activate('Scene', null);
                  });
                }
              });
            });
          }
        }
        if (ImGui.IsItemHovered()) {
          ImGui.SetMouseCursor(ImGui.MouseCursor.Hand);
        }
        ImGui.PopID();
        cursorPosY += frameHeight + itemSpacing;
      }
      ImGui.PopID();
      ImGui.PopStyleColor(4);
    }
    ImGui.End();
  }
}
