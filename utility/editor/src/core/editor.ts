import { ImGui, imGuiCalcTextSize, imGuiEndFrame, imGuiInjectEvent, imGuiNewFrame } from '@zephyr3d/imgui';
import { eventBus } from './eventbus';
import { DialogRenderer } from '../components/modal';
import { ModuleManager } from './module';
import { SceneController } from '../controllers/scenecontroller';
import { FontGlyph } from './fontglyph';
import { AssetManager, DRef } from '@zephyr3d/scene';
import type { Texture2D } from '@zephyr3d/device';
import {
  analyzeGPUObjectGrowth,
  formatGrowthAnalysis,
  getGPUObjectStatistics
} from '../helpers/leakdetector';
import { HttpFS } from '@zephyr3d/base';
import type { ProjectInfo } from './services/project';
import { ProjectService } from './services/project';
import { Dialog } from '../views/dlg/dlg';
import { ZipDownloader } from '../helpers/zipdownload';
import { ScriptingSystem } from '@zephyr3d/runtime';
import { VFSScriptRegistry } from './scripting';
import { moduleSharing } from './moduleshare';

import * as zephyr3d_base from '@zephyr3d/base';
import * as zephyr3d_device from '@zephyr3d/device';
import * as zephyr3d_scene from '@zephyr3d/scene';
import * as zephyr3d_runtime from '@zephyr3d/runtime';

const testScript2 = `
import { Foo } from './hello';

export default function(host, props) {
  return {
    init() {
      this.foo = new Foo();
      this.foo.init();
    },
    update() {
      this.foo.update();
    }
  };
}

`;

const testScript = `
import { Vector3 } from "@zephyr3d/base";

console.log('Test script imported');

export class Foo {
  private v: Vector3;
  constructor() {
    this.v = new Vector3(1, 2, 3);
  }
  init() {
    console.log('init: ' + this.v.toString());
  },
  update() {
    console.log('update: ' + this.v.toString());
  }
}
`;

export class Editor {
  private readonly _moduleManager: ModuleManager;
  private readonly _assetImages: {
    brushes: { [key: string]: DRef<Texture2D> };
    app: { [key: string]: DRef<Texture2D> };
  };
  private _leakTestA: ReturnType<typeof getGPUObjectStatistics>;
  private _currentProject: ProjectInfo;
  private _scriptRoot: string;
  private _registry: VFSScriptRegistry;
  private _scriptingSystem: ScriptingSystem;
  constructor() {
    this._moduleManager = new ModuleManager();
    this._assetImages = { brushes: {}, app: {} };
    this._leakTestA = null;
    this._currentProject = null;
    this._scriptRoot = '/scripts';
    this._registry = new VFSScriptRegistry({ mode: 'editor' }, ProjectService.VFS, this._scriptRoot);
    this._scriptingSystem = new ScriptingSystem(this._registry, {
      onLoadError(e) {
        console.error(e);
      }
    });
  }
  get sceneChanged() {
    return !!(this._moduleManager.currentModule?.controller as SceneController)?.sceneChanged;
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
  update(dt: number, elapsed: number) {
    this._scriptingSystem.update(dt, elapsed);
    eventBus.dispatchEvent('update', dt);
  }
  getBrushes() {
    return this._assetImages.brushes;
  }
  get currentProject() {
    return this._currentProject;
  }
  async saveProject() {
    if (this._currentProject) {
      ProjectService.saveProject(this._currentProject);
    }
  }
  async init() {
    //await Database.init();
    await FontGlyph.loadFontGlyphs('zef-16px');
    await this.loadAssets();
    moduleSharing.shareModules({
      '@zephyr3d/base': zephyr3d_base
    });
    moduleSharing.shareModules({
      '@zephyr3d/device': zephyr3d_device
    });
    moduleSharing.shareModules({
      '@zephyr3d/scene': zephyr3d_scene
    });
    moduleSharing.shareModules({
      '@zephyr3d/runtime': zephyr3d_runtime
    });
    await ProjectService.VFS.makeDirectory(this._scriptRoot, true);
    await ProjectService.VFS.writeFile(ProjectService.VFS.join(this._scriptRoot, 'hello.ts'), testScript, {
      encoding: 'utf8'
    });
    await ProjectService.VFS.writeFile(ProjectService.VFS.join(this._scriptRoot, 'main.ts'), testScript2, {
      encoding: 'utf8'
    });
    await this._scriptingSystem.attachScript(this, {
      module: '#/main'
    });
  }
  async loadAssets() {
    const assetManager = new AssetManager(
      new HttpFS(window.location.href.slice(0, window.location.href.lastIndexOf('/')))
    );
    const brushConfig = await assetManager.fetchJsonData('conf/brushes.json');
    for (const name in brushConfig) {
      const tex = await assetManager.fetchTexture<Texture2D>(brushConfig[name]);
      this._assetImages.brushes[name] = new DRef(tex);
    }
    const appConfig = await assetManager.fetchJsonData('conf/app.json');
    for (const name in appConfig) {
      const tex = await assetManager.fetchTexture<Texture2D>(appConfig[name], {
        samplerOptions: { mipFilter: 'none' }
      });
      this._assetImages.app[name] = new DRef(tex);
    }
  }
  registerModules() {
    const sceneController = new SceneController(this);
    this._moduleManager.register('Scene', sceneController);

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
            this.newProject();
          }
          if (i === 1) {
            ProjectService.listProjects().then((projects) => {
              const names = projects.map((project) => project.name);
              const ids = projects.map((project) => project.uuid);
              Dialog.openFromList('Open Project', names, ids, 400, 400).then((id) => {
                if (id) {
                  ProjectService.openProject(id).then((project) => {
                    this._currentProject = project;
                    this._moduleManager.activate('Scene', this._currentProject.lastEditScene ?? '');
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
  async closeProject(lastScenePath: string) {
    if (this._currentProject) {
      this._currentProject.lastEditScene = lastScenePath ?? '';
      await ProjectService.saveProject(this._currentProject);
      await ProjectService.closeCurrentProject();
      this._currentProject = null;
      this._moduleManager.activate('');
    }
  }
  async exportProject() {
    if (!this._currentProject) {
      return;
    }
    const zipDownloader = new ZipDownloader(`${this._currentProject.name}.zip`);
    const fileList = await ProjectService.VFS.readDirectory(this.currentProject.homedir, {
      includeHidden: true,
      recursive: true
    });
    const files = fileList.filter((path) => path.type === 'file');
    let directories = fileList.filter((path) => path.type === 'directory');
    for (const file of files) {
      const content = (await ProjectService.VFS.readFile(file.path, { encoding: 'binary' })) as ArrayBuffer;
      const path = ProjectService.VFS.relative(file.path);
      await zipDownloader.zipWriter.add(path, new Blob([content]).stream());
      directories = directories.filter((dir) => !file.path.startsWith(`${dir.path}/`));
    }
    for (const dir of directories) {
      await zipDownloader.zipWriter.add(`${ProjectService.VFS.relative(dir.path)}/`);
    }
    await zipDownloader.finish();
  }
  async newProject() {
    const name = await Dialog.promptName('Create Project', 'Project Name', 'New Project', 400);
    if (name) {
      const uuid = await ProjectService.createProject(name);
      const project = await ProjectService.openProject(uuid);
      this._currentProject = project;
      this._moduleManager.activate('Scene', '');
    }
  }
  async openProject() {
    const projects = await ProjectService.listProjects();
    const names = projects.map((project) => project.name);
    const ids = projects.map((project) => project.uuid);
    const id = await Dialog.openFromList('Open Project', names, ids, 400, 400);
    if (id) {
      const project = await ProjectService.openProject(id);
      this._currentProject = project;
      this._moduleManager.activate('Scene', project.lastEditScene ?? '');
    }
  }
  async deleteProject(uuid: string) {
    await ProjectService.deleteProject(uuid);
  }
  protected async createMonacoLoader() {
    return new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = './js/vs/loader.js';
      document.head.appendChild(script);
      script.onload = () => {
        const require = (window as any).require;
        require.config({
          paths: {
            vs: './js/vs'
          }
        });
        resolve();
      };
      script.onerror = (err) => {
        reject(err);
      };
    });
  }
  protected setupMonacoEnvironment(): void {
    /*
    (window as any).MonacoEnvironment = {
      // 改用 getWorker 而不是 getWorkerUrl
      getWorker: function (_moduleId: string, label: string) {
        switch (label) {
          case 'css':
          case 'scss':
          case 'less':
            return new CSSWorker();
          case 'html':
          case 'handlebars':
          case 'razor':
            return new HTMLWorker();
          case 'typescript':
          case 'javascript':
            return new TSWorker();
          default:
            // 对于默认的 editor worker，使用 workerMain.js
            return new EditorWorker();
        }
      }
    };
    */
  }
}
