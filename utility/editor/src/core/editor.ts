import type * as Monaco from 'monaco-editor';
import { ImGui, imGuiCalcTextSize, imGuiEndFrame, imGuiInjectEvent, imGuiNewFrame } from '@zephyr3d/imgui';
import { eventBus } from './eventbus';
import { DialogRenderer } from '../components/modal';
import { ModuleManager } from './module';
import { SceneController } from '../controllers/scenecontroller';
import { FontGlyph } from './fontglyph';
import { AssetManager, ScriptingSystem, SerializationManager } from '@zephyr3d/scene';
import type { Texture2D } from '@zephyr3d/device';
import {
  analyzeGPUObjectGrowth,
  formatGrowthAnalysis,
  getGPUObjectStatistics
} from '../helpers/leakdetector';
import { DRef, GenericHtmlDirectoryReader, HttpFS } from '@zephyr3d/base';
import type { ProjectInfo, ProjectSettings } from './services/project';
import { ProjectService } from './services/project';
import { Dialog } from '../views/dlg/dlg';
import { ZipDownloader } from '../helpers/zipdownload';
import { CodeEditor } from '../components/codeeditor';
import { buildForEndUser } from './build/build';
import { initLogView } from '../components/logview';
import { loadTypes } from './build/loadtypes';
import { ensureDependencies } from './build/dep';

export class Editor {
  private readonly _moduleManager: ModuleManager;
  private readonly _assetImages: {
    brushes: { [key: string]: DRef<Texture2D> };
    app: { [key: string]: DRef<Texture2D> };
  };
  private _leakTestA: ReturnType<typeof getGPUObjectStatistics>;
  private _currentProject: ProjectInfo;
  private _codeEditor: CodeEditor;
  private _scriptingSystem: ScriptingSystem;
  private _extraLibs: Record<string, Monaco.IDisposable>;
  constructor() {
    this._moduleManager = new ModuleManager();
    this._assetImages = { brushes: {}, app: {} };
    this._leakTestA = null;
    this._currentProject = null;
    this._codeEditor = null;
    this._extraLibs = {};
    this._scriptingSystem = new ScriptingSystem({
      onLoadError(e) {
        console.error(e);
      }
    });
    this._scriptingSystem.registry.VFS = ProjectService.VFS;
    this._scriptingSystem.registry.editorMode = true;
  }
  get sceneChanged() {
    return !!(this._moduleManager.currentModule?.controller as SceneController)?.sceneChanged;
  }
  async loadScriptDependencies(path: string) {
    const dependencies: Record<string, string> = {};
    await this._scriptingSystem.registry.getDependencies(path, null, dependencies);
    for (const k of Object.keys(dependencies)) {
      // Must delete old lib reference first!!!
      const oldDisposable = this._extraLibs[k];
      if (oldDisposable) {
        oldDisposable.dispose();
        delete this._extraLibs[k];
      }
      // And then add lib
      const f = `file:///${ProjectService.VFS.relative(k, '/')}`;
      const disposable = window.monaco.languages.typescript.typescriptDefaults.addExtraLib(
        dependencies[k],
        f
      );
      if (disposable) {
        this._extraLibs[k] = disposable;
      }
    }
  }
  deleteScriptDependence(path: string) {
    const disposable = this._extraLibs[path];
    if (disposable) {
      disposable.dispose();
    }
    delete this._extraLibs[path];
  }
  deleteAllDependences() {
    for (const k of Object.keys(this._extraLibs)) {
      this.deleteScriptDependence(k);
    }
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
  async getProjectSettings() {
    return this._currentProject ? await ProjectService.getCurrentProjectSettings() : null;
  }
  async saveProjectSettings(settings: ProjectSettings) {
    if (this._currentProject) {
      await ProjectService.saveCurrentProjectSettings(settings);
    }
  }
  async init() {
    //await Database.init();
    await FontGlyph.loadFontGlyphs('zef-16px');
    await this.loadAssets();
    initLogView({ maxLines: 8000 });
    eventBus.on('action', this.onAction, this);
  }
  async loadAssets() {
    const assetManager = new AssetManager(
      new SerializationManager(
        new HttpFS(window.location.href.slice(0, window.location.href.lastIndexOf('/')))
      )
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
  async loadDepTypes() {
    if (await ProjectService.VFS.exists('/deps.lock.json')) {
      const content = (await ProjectService.VFS.readFile('/deps.lock.json', { encoding: 'utf8' })) as string;
      const deps = JSON.parse(content) as {
        dependencies: Record<string, { version: string; entry: string }>;
      };
      if (this._currentProject) {
        for (const k of Object.keys(deps.dependencies)) {
          const pkg = `${k}@${deps.dependencies[k].version}`;
          console.log(`Loading DTS for package ${pkg}`);
          try {
            const libs = await loadTypes(this._currentProject.uuid, pkg, window.monaco);
            if (libs.project === this._currentProject?.uuid) {
              for (const k of Object.keys(libs.libs)) {
                this._extraLibs[k] = libs.libs[k];
              }
            } else {
              for (const k of Object.keys(libs.libs)) {
                libs.libs[k]?.dispose();
              }
            }
          } catch (err) {
            console.error(`Failed to load DTS for package ${pkg}: ${err}`);
          }
        }
      }
    }
  }
  registerModules() {
    const sceneController = new SceneController(this);
    this._moduleManager.register('Scene', sceneController);

    eventBus.on('switch_module', (name, ...args: any[]) => {
      this._moduleManager.activate(name, ...args);
    });
  }
  async editCode(fileName: string, language: string) {
    if (this._codeEditor) {
      if (!this._codeEditor.close()) {
        return;
      }
      this._codeEditor = null;
    }
    const content = (await ProjectService.VFS.readFile(fileName, { encoding: 'utf8' })) as string;
    this._codeEditor = new CodeEditor(fileName);
    this._codeEditor.show(content, language);
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
      const links = ['Create Project...', 'Open Project...', 'Open Remote Project...'];
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
                    this._scriptingSystem.registry.VFS = ProjectService.VFS;
                    this.loadDepTypes();
                    this._moduleManager.activate('Scene', this._currentProject.lastEditScene ?? '');
                  });
                }
              });
            });
          }
          if (i === 2) {
            Dialog.promptName('Open Remote Project', 'Project URL', '', 400).then((url) => {
              if (url) {
                ProjectService.openRemoteProject(url, new GenericHtmlDirectoryReader()).then((project) => {
                  this._currentProject = project;
                  this._scriptingSystem.registry.VFS = ProjectService.VFS;
                  this.loadDepTypes();
                  this._moduleManager.activate('Scene', '');
                });
              }
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
      if (this._codeEditor && !this._codeEditor.close()) {
        return;
      }
      this._codeEditor = null;
      this.deleteAllDependences();
      this._currentProject.lastEditScene = lastScenePath ?? '';
      await ProjectService.saveProject(this._currentProject);
      this._moduleManager.activate('');
      await ProjectService.closeCurrentProject();
      this._currentProject = null;
    }
  }
  async exportProject() {
    if (!this._currentProject) {
      return;
    }
    const zipDownloader = new ZipDownloader(`${this._currentProject.name}.zip`);
    const fileList = await ProjectService.VFS.glob('/**/*', {
      includeHidden: true,
      includeDirs: true,
      includeFiles: true,
      recursive: true
    });
    const files = fileList.filter((path) => path.type === 'file' && !path.path.startsWith('/dist/'));
    let directories = fileList.filter(
      (path) => path.type === 'directory' && path.path !== '/dist' && !path.path.startsWith('/dist/')
    );
    for (const file of files) {
      const content = (await ProjectService.VFS.readFile(file.path, { encoding: 'binary' })) as ArrayBuffer;
      const path = ProjectService.VFS.relative(file.path, '/');
      await zipDownloader.zipWriter.add(path, new Blob([content]).stream());
      directories = directories.filter((dir) => !file.path.startsWith(`${dir.path}/`));
    }
    for (const dir of directories) {
      await zipDownloader.zipWriter.add(`${ProjectService.VFS.relative(dir.path, '/')}/`);
    }
    await zipDownloader.finish();
  }
  async newProject() {
    const name = await Dialog.promptName('Create Project', 'Project Name', 'New Project', 400);
    if (name) {
      const uuid = await ProjectService.createProject(name);
      const project = await ProjectService.openProject(uuid);
      this._currentProject = project;
      this._scriptingSystem.registry.VFS = ProjectService.VFS;
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
      this.loadDepTypes();
      this._moduleManager.activate('Scene', project.lastEditScene ?? '');
    }
  }
  async deleteProject(uuid: string) {
    await ProjectService.deleteProject(uuid);
  }
  async buildProject() {
    await ensureDependencies();
    await buildForEndUser({
      input: '/src/index.ts',
      distDir: '/dist'
    });
    const zipDownloader = new ZipDownloader(`${this._currentProject.name}_dist.zip`);
    const distFileList = await ProjectService.VFS.glob('/dist/**/*', {
      includeHidden: true,
      includeDirs: false,
      includeFiles: true,
      recursive: true
    });
    const distFiles = distFileList.filter((path) => path.type === 'file');
    let distDirs = distFileList.filter((path) => path.type === 'directory');
    for (const file of distFiles) {
      const content = (await ProjectService.VFS.readFile(file.path, { encoding: 'binary' })) as ArrayBuffer;
      const path = ProjectService.VFS.relative(file.path, '/');
      await zipDownloader.zipWriter.add(path, new Blob([content]).stream());
      distDirs = distDirs.filter((dir) => !file.path.startsWith(`${dir.path}/`));
    }
    for (const dir of distDirs) {
      await zipDownloader.zipWriter.add(`${dir.path}/`);
    }
    await zipDownloader.finish();
  }
  private onAction(action: string, fileName: string, arg: string) {
    if (action === 'EDIT_CODE' && fileName) {
      if (arg === 'text/javascript' || arg === 'text/x-typescript') {
        this.loadScriptDependencies(fileName).then(() => {
          if (arg === 'text/javascript') {
            this.editCode(fileName, 'javascript');
          } else if (arg === 'text/x-typescript') {
            this.editCode(fileName, 'typescript');
          }
        });
      } else if (arg === 'text/html') {
        this.editCode(fileName, 'html');
      } else if (arg === 'application/json') {
        this.editCode(fileName, 'json');
      } else if (arg === 'text/plain') {
        this.editCode(fileName, 'plaintext');
      }
    } else if (action === 'SAVE_CODE') {
      ProjectService.VFS.writeFile(fileName, arg, { encoding: 'utf8', create: true });
    } else if (action === 'BUILD_PROJECT') {
      this.buildProject().then(() => {
        console.log('Project build succeeded');
      });
    }
  }
}
