import type * as Monaco from 'monaco-editor';
import { ImGui, imGuiCalcTextSize, imGuiEndFrame, imGuiInjectEvent, imGuiNewFrame } from '@zephyr3d/imgui';
import { eventBus } from './eventbus';
import { DialogRenderer } from '../components/modal';
import { ModuleManager } from './module';
import { SceneController } from '../controllers/scenecontroller';
import { FontGlyph } from './fontglyph';
import { AssetManager, ResourceManager, getEngine } from '@zephyr3d/scene';
import type { Texture2D } from '@zephyr3d/device';
import {
  analyzeGPUObjectGrowth,
  formatGrowthAnalysis,
  getGPUObjectStatistics
} from '../helpers/leakdetector';
import type { FileMetadata, HttpDirectoryReader, HttpDirectoryReaderContext } from '@zephyr3d/base';
import { DRef, HttpFS, MemoryFS, PathUtils } from '@zephyr3d/base';
import type { ProjectInfo, ProjectSettings } from './services/project';
import { ProjectService } from './services/project';
import { Dialog } from '../views/dlg/dlg';
import { ZipDownloader } from '../helpers/downloader';
import { CodeEditor } from '../components/codeeditor';
import { buildForEndUser } from './build/build';
import { initLogView } from '../components/logview';
import { loadTypes } from './build/loadtypes';
import { ensureDependencies, installDeps } from './build/dep';
import { FilePicker } from '../components/filepicker';
import { fileListFileName, generateIndexTS, libDir } from './build/templates';
import { DlgMessageBoxEx } from '../views/dlg/messageexdlg';
import { DlgMessage } from '../views/dlg/messagedlg';
import { EditorPluginManager, type EditorPlugin, type EditorPluginDefinition } from './plugin';
import { ScriptRegistry } from '@zephyr3d/scene';
import {
  SystemPluginService,
  type SystemPluginDirectoryRecord,
  type InstalledSystemPlugin,
  type SystemPluginFileInput,
  type SystemPluginFileRecord,
  type SystemPluginRecord
} from './services/systemplugin';

type TreeData = { files: { name: string; size: number }[]; subDirs: { [name: string]: TreeData } };

class RemoteProjectDirectoryReader implements HttpDirectoryReader {
  readonly name = 'file-list-reader';
  private _treeData: TreeData;
  private _dt: Date;
  constructor(fileList: TreeData) {
    this._treeData = fileList;
    this._dt = new Date();
  }
  async readOnce(dirPath: string, ctx: HttpDirectoryReaderContext): Promise<FileMetadata[]> {
    const entries = dirPath.split('/').filter((val) => !!val);
    let data = this._treeData;
    while (entries.length > 0) {
      const name = entries.shift();
      let subdir = data.subDirs[name];
      if (!subdir) {
        data = null;
        break;
      }
      data = subdir;
    }
    const result: FileMetadata[] = [];
    if (data) {
      if (data.subDirs) {
        for (const k of Object.keys(data.subDirs)) {
          const fullPath = ctx.normalizePath(ctx.joinPath(dirPath, k + '/'));
          result.push({
            name: k,
            path: fullPath,
            size: 0,
            type: 'directory',
            created: this._dt,
            modified: this._dt
          });
        }
      }
      if (data.files) {
        for (const f of data.files) {
          const fullPath = ctx.normalizePath(ctx.joinPath(dirPath, f.name));
          result.push({
            name: f.name,
            path: fullPath,
            size: f.size,
            type: 'file',
            created: this._dt,
            modified: this._dt
          });
        }
      }
    }
    return result;
  }
}

export class Editor {
  private readonly _moduleManager: ModuleManager;
  private readonly _assetImages: {
    brushes: { [key: string]: DRef<Texture2D> };
    app: { [key: string]: DRef<Texture2D> };
  };
  private _leakTestA: ReturnType<typeof getGPUObjectStatistics>;
  private _currentProject: ProjectInfo;
  private _isRemoteProject: boolean;
  private _codeEditor: CodeEditor;
  private _extraLibs: Record<string, Monaco.IDisposable>;
  private readonly _plugins: EditorPluginManager;
  private readonly _systemPluginRegistrations: Map<string, SystemPluginRecord>;
  constructor() {
    this._moduleManager = new ModuleManager();
    this._assetImages = { brushes: {}, app: {} };
    this._leakTestA = null;
    this._currentProject = null;
    this._isRemoteProject = false;
    this._codeEditor = null;
    this._extraLibs = {};
    this._plugins = new EditorPluginManager(this);
    this._systemPluginRegistrations = new Map();
  }
  get moduleManager() {
    return this._moduleManager;
  }
  get plugins() {
    return this._plugins;
  }
  registerPlugin(plugin: EditorPlugin) {
    this._plugins.registerPlugin(plugin);
  }
  get sceneChanged() {
    return !!(this._moduleManager.currentModule?.controller as SceneController)?.sceneChanged;
  }
  async loadScriptDependencies(path: string) {
    const monaco = await this.waitForMonaco();
    if (!monaco) {
      return;
    }
    const dependencies: Record<string, string> = {};
    await this.getScriptRegistryForPath(path).getDependencies(path, null, dependencies);
    for (const k of Object.keys(dependencies)) {
      // Must delete old lib reference first!!!
      const oldDisposable = this._extraLibs[k];
      if (oldDisposable) {
        oldDisposable.dispose();
        delete this._extraLibs[k];
      }
      // And then add lib
      const vfs = this.getVFSForPath(k);
      const f = `file:///${vfs.relative(k, '/')}`;
      const disposable = monaco.languages.typescript.typescriptDefaults.addExtraLib(dependencies[k], f);
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
        console.debug(formatGrowthAnalysis(analysis));
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
  async saveProject() {
    if (this._currentProject && !this._isRemoteProject) {
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
  isProjectReadOnly() {
    return !this._currentProject || !!ProjectService.VFS.readOnly;
  }
  async projectFileExists(path: string) {
    return this._currentProject ? await ProjectService.VFS.exists(path) : false;
  }
  async ensureProjectDirectory(path: string) {
    if (!this._currentProject) {
      throw new Error('No project is currently open');
    }
    if (ProjectService.VFS.readOnly) {
      throw new Error('Current project is read-only');
    }
    await ProjectService.VFS.makeDirectory(path, true);
  }
  async readProjectTextFile(path: string) {
    if (!this._currentProject) {
      return null;
    }
    return (await ProjectService.VFS.readFile(path, { encoding: 'utf8' })) as string;
  }
  async writeProjectTextFile(path: string, content: string) {
    if (!this._currentProject) {
      throw new Error('No project is currently open');
    }
    if (ProjectService.VFS.readOnly) {
      throw new Error('Current project is read-only');
    }
    const dir = ProjectService.VFS.dirname(path);
    if (dir && dir !== '/' && !(await ProjectService.VFS.exists(dir))) {
      await ProjectService.VFS.makeDirectory(dir, true);
    }
    await ProjectService.VFS.writeFile(path, content, { encoding: 'utf8', create: true });
  }
  async openProjectCodeFile(path: string, language?: string) {
    if (!this._currentProject) {
      throw new Error('No project is currently open');
    }
    const nextLanguage =
      language ??
      (path.endsWith('.ts')
        ? 'typescript'
        : path.endsWith('.js')
          ? 'javascript'
          : path.endsWith('.json')
            ? 'json'
            : path.endsWith('.html')
              ? 'html'
              : 'plaintext');
    await this.openCodeFile(path, nextLanguage);
  }
  async init(fontSize: number) {
    //await Database.init();
    await FontGlyph.loadFontGlyphs('zef-16px', fontSize);
    await this.loadAssets();
    initLogView({ maxLines: 8000 });
    eventBus.on('action', this.onAction, this);
    await this.loadSystemPlugins();
  }
  async loadAssets() {
    const assetManager = new AssetManager(
      new ResourceManager(new HttpFS(window.location.href.slice(0, window.location.href.lastIndexOf('/'))))
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
    const monaco = await this.waitForMonaco();
    if (!monaco) {
      return;
    }
    if (await ProjectService.VFS.exists(`/${libDir}/deps.lock.json`)) {
      const content = (await ProjectService.VFS.readFile(`/${libDir}/deps.lock.json`, {
        encoding: 'utf8'
      })) as string;
      const deps = JSON.parse(content) as {
        dependencies: Record<string, { version: string; entry: string }>;
      };
      if (this._currentProject) {
        for (const k of Object.keys(deps.dependencies)) {
          const pkg = `${k}@${deps.dependencies[k].version}`;
          console.info(`Loading DTS for package ${pkg}`);
          try {
            const libs = await loadTypes(this._currentProject.uuid, pkg, monaco);
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
  private async loadDependencyTypesFromLock(
    ownerId: string,
    vfs: typeof ProjectService.VFS,
    projectRoot: string,
    monaco: typeof Monaco
  ) {
    const lockPath = vfs.join(projectRoot, `/${libDir}/deps.lock.json`);
    if (!(await vfs.exists(lockPath))) {
      return;
    }
    const content = (await vfs.readFile(lockPath, {
      encoding: 'utf8'
    })) as string;
    const deps = JSON.parse(content) as {
      dependencies: Record<string, { version: string; entry: string }>;
    };
    for (const depName of Object.keys(deps.dependencies ?? {})) {
      const pkg = `${depName}@${deps.dependencies[depName].version}`;
      console.info(`Loading DTS for package ${pkg}`);
      try {
        const libs = await loadTypes(ownerId, pkg, monaco);
        for (const libPath of Object.keys(libs.libs)) {
          const oldDisposable = this._extraLibs[libPath];
          if (oldDisposable) {
            oldDisposable.dispose();
          }
          const disposable = libs.libs[libPath] as Monaco.IDisposable & { ownerId?: string };
          disposable.ownerId = ownerId;
          this._extraLibs[libPath] = disposable;
        }
      } catch (err) {
        console.error(`Failed to load DTS for package ${pkg}: ${err}`);
      }
    }
  }
  private async loadSystemPluginDepTypes(path: string) {
    const monaco = await this.waitForMonaco();
    if (!monaco) {
      return;
    }
    const plugin = await SystemPluginService.findPluginByPath(path);
    if (!plugin) {
      return;
    }
    await this.refreshSystemPluginDependencyTypes(plugin.id, plugin.packageDir, monaco);
  }
  registerModules() {
    const sceneController = new SceneController(this);
    this._moduleManager.register('Scene', sceneController);

    eventBus.on('switch_module', (name, ...args: any[]) => {
      this._moduleManager.activate(name, ...args);
    });
  }
  async editCode(fileName: string, language: string) {
    const monaco = await this.waitForMonaco();
    if (!monaco) {
      await DlgMessage.messageBox('Error', 'Code editor is not ready yet. Please try again in a moment.');
      return;
    }
    if (this._codeEditor) {
      if (!this._codeEditor.close()) {
        return;
      }
      this._codeEditor = null;
    }
    const content = (await this.getVFSForPath(fileName).readFile(fileName, { encoding: 'utf8' })) as string;
    this._codeEditor = new CodeEditor(fileName);
    this._codeEditor.show(content, language);
  }

  async openCodeFile(fileName: string, language: string) {
    if (language === 'typescript' || language === 'javascript') {
      await this.loadScriptDependencies(fileName);
      if (this.isSystemPluginPath(fileName)) {
        await this.loadSystemPluginDepTypes(fileName);
      }
    }
    await this.editCode(fileName, language);
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
      const iconTex = this._assetImages.app.logo_i.get();
      const imageSize = new ImGui.ImVec2(320, Math.floor((320 / iconTex.width) * iconTex.height));
      let cursorPosY = Math.max(imageSize.y + 10, (displaySize.y - panelHeight) >> 1);
      ImGui.SetCursorPosX(Math.max(0, (displaySize.x - imageSize.x) >> 1));
      ImGui.SetCursorPosY((cursorPosY - imageSize.y) >> 1);
      ImGui.Image(iconTex, imageSize);

      ImGui.PushStyleColor(ImGui.Col.Text, new ImGui.ImVec4(0.3, 0.5, 1, 1));
      ImGui.PushStyleColor(ImGui.Col.HeaderHovered, new ImGui.Vec4(0, 0, 0, 0));
      ImGui.PushStyleColor(ImGui.Col.HeaderActive, new ImGui.Vec4(0, 0, 0, 0));
      ImGui.PushStyleColor(ImGui.Col.Header, new ImGui.Vec4(0, 0, 0, 0));
      const links = ['Create Project...', 'Open Project...', 'Open Remote Project...', 'Import Project...'];
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
            this.openProject();
          }
          if (i === 2) {
            this.openRemoteProject();
          }
          if (i === 3) {
            this.importProject();
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
  async loadFileList(url: string): Promise<TreeData> {
    try {
      let fileList: TreeData = null;
      const { origin, pathname } = new URL(url);
      const fileListUrl = pathname.endsWith('/')
        ? `${origin}${pathname}${fileListFileName}`
        : `${origin}${pathname}/${fileListFileName}`;
      const res = await fetch(fileListUrl);
      if (res.ok) {
        fileList = await res.json();
      }
      return fileList;
    } catch {
      return null;
    }
  }
  async closeProject(lastScenePath: string) {
    if (this._currentProject) {
      if (this._codeEditor && !this._codeEditor.close()) {
        return;
      }
      this._codeEditor = null;
      this.deleteAllDependences();
      this._currentProject.lastEditScene = lastScenePath ?? '';
      await this.saveProject();
      this._moduleManager.activate('');
      await ProjectService.closeCurrentProject();
      this._currentProject = null;
    }
  }

  async exportProject() {
    if (!this._currentProject) {
      return;
    }
    const treeData: TreeData = {
      files: [],
      subDirs: {}
    };
    function addDirectory(path: string): TreeData {
      const entries = path.split('/').filter((val) => !!val);
      let data = treeData;
      while (entries.length > 0) {
        const name = entries.shift();
        let subdir = data.subDirs[name];
        if (!subdir) {
          subdir = { files: [], subDirs: {} };
          data.subDirs[name] = subdir;
        }
        data = subdir;
      }
      return data;
    }
    function addFile(path: string, size: number) {
      const dir = PathUtils.dirname(path);
      const name = PathUtils.basename(path);
      const data = addDirectory(dir);
      data.files.push({
        name,
        size
      });
    }
    const zipDownloader = new ZipDownloader(`${this._currentProject.name}.zip`);
    const fileList = await ProjectService.VFS.glob('/**/*', {
      includeHidden: true,
      includeDirs: true,
      includeFiles: true,
      recursive: true
    });
    const files = fileList.filter(
      (path) =>
        path.type === 'file' &&
        !path.path.startsWith('/dist/') &&
        !path.path.startsWith('/assets/@builtins/') &&
        !path.path.startsWith(`/${libDir}/`) &&
        path.path !== `/${fileListFileName}`
    );
    let directories = fileList.filter(
      (path) =>
        path.type === 'directory' &&
        path.path !== '/dist' &&
        path.path !== '/assets/@builtins' &&
        path.path !== `/${libDir}` &&
        !path.path.startsWith('/dist/') &&
        !path.path.startsWith('/assets/@builtins/') &&
        !path.path.startsWith(`/${libDir}/`)
    );
    for (const file of files) {
      const content = (await ProjectService.VFS.readFile(file.path, { encoding: 'binary' })) as ArrayBuffer;
      const path = ProjectService.VFS.relative(file.path, '/');
      const stream = new Blob([content]).stream();
      await zipDownloader.zipWriter.add(path, stream);
      directories = directories.filter((dir) => !file.path.startsWith(`${dir.path}/`));
      addFile(file.path, file.size);
    }
    for (const dir of directories) {
      await zipDownloader.zipWriter.add(`${ProjectService.VFS.relative(dir.path, '/')}/`);
      addDirectory(dir.path);
    }
    await zipDownloader.zipWriter.add(
      fileListFileName,
      new Blob([JSON.stringify(treeData, null, 2)]).stream()
    );
    await zipDownloader.finish();
  }
  async importProject() {
    const files = await FilePicker.chooseDirectory();
    if (files?.length > 0) {
      const uuid = await ProjectService.importProject(files);
      if (uuid) {
        const project = await ProjectService.openProject(uuid);
        const settings = await ProjectService.getCurrentProjectSettings();
        this._currentProject = project;
        this._moduleManager.activate('Scene', settings.startupScene ?? project.lastEditScene ?? '');
        for (const dep of Object.keys(settings.dependencies ?? {})) {
          const depName = dep;
          const depVersion = settings.dependencies[dep];
          const packageName = `${depName}@${depVersion}`;
          const installed = await ProjectService.VFS.exists(`/${libDir}/deps/${packageName}`);
          if (!installed) {
            const dlgMessageBoxEx = new DlgMessageBoxEx(
              'Install package',
              `Installing ${packageName}`,
              [],
              400,
              0,
              false
            );
            dlgMessageBoxEx.showModal();
            await installDeps(uuid, ProjectService.VFS, '/', packageName, null, false);
            dlgMessageBoxEx.close('');
          }
        }
      }
    }
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
  async openRemoteProject(url?: string) {
    url = url || (await Dialog.promptName('Open Remote Project', 'Project URL', '', 400));
    if (!url) {
      return;
    }
    const fileList = await this.loadFileList(url);
    if (!fileList) {
      await DlgMessage.messageBox('Error', `Cannot read remote project at <${url}>`);
      return;
    }
    const loading = new DlgMessageBoxEx('zephyr3d', 'Loading project, please wait...', []);
    loading.showModal();
    try {
      const project = await ProjectService.openRemoteProject(url, new RemoteProjectDirectoryReader(fileList));
      this._currentProject = project;
      this._isRemoteProject = true;
      this.loadDepTypes();
      const settings = await ProjectService.getCurrentProjectSettings();
      await this._moduleManager.activate(
        'Scene',
        settings.startupScene || this._currentProject.lastEditScene || ''
      );
    } finally {
      loading.close('');
    }
  }
  async openProject(id?: string) {
    if (!id) {
      const projects = await ProjectService.listProjects();
      const names = projects.map((project) => project.name);
      const ids = projects.map((project) => project.uuid);
      id = await Dialog.openFromList('Open Project', names, ids, 400, 400);
    }
    if (id) {
      this._isRemoteProject = false;
      const project = await ProjectService.openProject(id);
      const settings = await ProjectService.getCurrentProjectSettings();
      this._currentProject = project;
      this.loadDepTypes();
      this._moduleManager.activate('Scene', settings.startupScene ?? project.lastEditScene ?? '');
      for (const dep of Object.keys(settings.dependencies ?? {})) {
        const depName = dep;
        const depVersion = settings.dependencies[dep];
        const packageName = `${depName}@${depVersion}`;
        const installed = await ProjectService.VFS.exists(`/${libDir}/deps/${packageName}`);
        if (!installed) {
          const dlgMessageBoxEx = new DlgMessageBoxEx(
            'Install package',
            `Installing ${packageName}`,
            [],
            400,
            0,
            false
          );
          dlgMessageBoxEx.showModal();
          await installDeps(id, ProjectService.VFS, '/', packageName, null, false);
          dlgMessageBoxEx.close('');
        }
      }
    }
  }
  async deleteProject(uuid: string) {
    await ProjectService.deleteProject(uuid);
  }
  async buildProject() {
    const settings = await ProjectService.getCurrentProjectSettings();
    if (!settings.startupScene && !settings.startupScript) {
      await DlgMessage.messageBox(
        'Error',
        'Please set startup scene or startup script in <Project Settings>'
      );
      return;
    }
    const srcIndexTS = generateIndexTS(settings);
    const srcVFS = new MemoryFS();
    const distVFS = new MemoryFS();
    srcVFS.writeFile('/index.ts', srcIndexTS, { encoding: 'utf8', create: true });
    ProjectService.VFS.mount('/src', srcVFS);
    if (ProjectService.VFS.readOnly) {
      await ProjectService.VFS.mount('/dist', distVFS);
    } else {
      await ProjectService.VFS.deleteDirectory('/dist', true);
      await ProjectService.VFS.makeDirectory('/dist', true);
    }
    await ensureDependencies();
    await buildForEndUser({
      input: '/src/index.ts',
      distDir: '/dist'
    });
    ProjectService.VFS.unmount('/src');
    srcVFS.close();

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
    if (ProjectService.VFS.readOnly) {
      ProjectService.VFS.unmount('/dist');
      distVFS.close();
    }
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
      } else if (arg === 'application/json' || arg.endsWith('+json')) {
        this.editCode(fileName, 'json');
      } else {
        this.editCode(fileName, 'plaintext');
      }
    } else if (action === 'SAVE_CODE') {
      void this.handleSaveCode(fileName, arg);
    } else if (action === 'BUILD_PROJECT') {
      this.buildProject().then(() => {
        console.info('Project build succeeded');
      });
    }
  }

  async getPluginState<T = unknown>(pluginId: string): Promise<T | null> {
    return SystemPluginService.readPluginState<T>(pluginId);
  }

  async savePluginState<T = unknown>(pluginId: string, state: T) {
    await SystemPluginService.writePluginState(pluginId, state);
  }

  async getPluginSettings<T = Record<string, unknown>>(pluginId: string): Promise<T | null> {
    return SystemPluginService.readPluginSettings<T>(pluginId);
  }

  async savePluginSettings<T = Record<string, unknown>>(pluginId: string, settings: T) {
    await SystemPluginService.writePluginSettings(pluginId, settings);
  }

  async saveSystemPluginSettings<T = Record<string, unknown>>(pluginId: string, settings: T, reload = true) {
    await SystemPluginService.writePluginSettings(pluginId, settings);
    const plugin = await SystemPluginService.getPlugin(pluginId);
    if (reload && plugin?.enabled) {
      return (await this.tryLoadSystemPlugin(pluginId, true))
        ? plugin
        : ((await SystemPluginService.getPlugin(pluginId)) ?? plugin);
    }
    return plugin;
  }

  async getSystemPluginSettingsSchema(pluginId: string) {
    if (this._plugins.hasPlugin(pluginId)) {
      const plugin = this._plugins.getPlugin(pluginId);
      if (plugin) {
        return plugin.settings ?? null;
      }
    }
    const installed = await SystemPluginService.getInstalledPluginSource(pluginId);
    if (!installed) {
      return null;
    }
    const plugin = await this.importSystemPlugin(installed);
    return plugin.settings ?? null;
  }

  async listSystemPlugins() {
    return SystemPluginService.listPlugins();
  }

  async installSystemPluginFromFile(file: File) {
    const plugin = await SystemPluginService.installPluginFromFile(file);
    const loadedId = await this.tryLoadSystemPlugin(plugin.id, true);
    return (await SystemPluginService.getPlugin(loadedId ?? plugin.id)) ?? plugin;
  }

  async installSystemPluginFromDirectory(files: File[]) {
    const plugin = await SystemPluginService.installPluginFromDirectory(files);
    const loadedId = await this.tryLoadSystemPlugin(plugin.id, true);
    return (await SystemPluginService.getPlugin(loadedId ?? plugin.id)) ?? plugin;
  }

  async installSystemPluginFiles(input: {
    id: string;
    name?: string;
    version?: string;
    description?: string;
    entryFileName?: string;
    files: SystemPluginFileInput[];
    enabled?: boolean;
  }) {
    const plugin = await SystemPluginService.installPluginFiles(input);
    const loadedId = await this.tryLoadSystemPlugin(plugin.id, true);
    return (await SystemPluginService.getPlugin(loadedId ?? plugin.id)) ?? plugin;
  }

  async listSystemPluginFiles(id: string): Promise<SystemPluginFileRecord[]> {
    return SystemPluginService.listPluginFiles(id);
  }

  async listSystemPluginDirectories(id: string): Promise<SystemPluginDirectoryRecord[]> {
    return SystemPluginService.listPluginDirectories(id);
  }

  async exportSystemPlugin(id: string) {
    const plugin = await SystemPluginService.getPlugin(id);
    if (!plugin) {
      throw new Error(`System plugin '${id}' is not installed`);
    }
    const files = await SystemPluginService.listPluginFiles(id);
    if (!files.length) {
      throw new Error(`System plugin '${id}' does not contain any source files`);
    }

    const zipDownloader = new ZipDownloader(`${plugin.id}.zip`);
    let manifestWritten = false;
    for (const file of files) {
      if (file.relativePath === SystemPluginService.packageManifestFileName) {
        manifestWritten = true;
        await zipDownloader.zipWriter.add(
          file.relativePath,
          new Blob([SystemPluginService.createPackageManifestContent(plugin)]).stream()
        );
        continue;
      }
      const content = (await SystemPluginService.VFS.readFile(file.path, {
        encoding: 'binary'
      })) as ArrayBuffer;
      await zipDownloader.zipWriter.add(file.relativePath, new Blob([content]).stream());
    }
    if (!manifestWritten) {
      await zipDownloader.zipWriter.add(
        SystemPluginService.packageManifestFileName,
        new Blob([SystemPluginService.createPackageManifestContent(plugin)]).stream()
      );
    }
    await zipDownloader.finish();
  }

  async installSystemPluginDependency(id: string, spec: string, onProgress?: (msg: string) => void) {
    const result = await SystemPluginService.installPluginDependency(id, spec, onProgress);
    const plugin = await SystemPluginService.getPlugin(id);
    if (plugin?.enabled) {
      await this.tryLoadSystemPlugin(id, true);
    }
    if (plugin) {
      await this.refreshSystemPluginDependencyTypes(plugin.id, plugin.packageDir).catch(() => undefined);
    }
    return result;
  }

  async removeSystemPluginDependency(id: string, packageName: string) {
    const plugin = await SystemPluginService.getPlugin(id);
    if (!plugin) {
      throw new Error(`System plugin '${id}' is not installed`);
    }
    await this.removeSystemPluginDependencyTypes(plugin.id, packageName);
    await SystemPluginService.removePluginDependency(id, packageName);
    if (plugin.enabled) {
      await this.tryLoadSystemPlugin(id, true);
    }
  }

  async createSystemPluginFile(id: string, relativePath: string, source = '') {
    const filePath = await SystemPluginService.createPluginFile(id, relativePath, source);
    const plugin = await SystemPluginService.getPlugin(id);
    if (plugin?.enabled) {
      await this.tryLoadSystemPlugin(id, true);
    }
    return filePath;
  }

  async createSystemPluginDirectory(id: string, relativePath: string) {
    const dirPath = await SystemPluginService.createPluginDirectory(id, relativePath);
    const plugin = await SystemPluginService.getPlugin(id);
    if (plugin?.enabled) {
      await this.tryLoadSystemPlugin(id, true);
    }
    return dirPath;
  }

  async renameSystemPluginFile(id: string, oldRelativePath: string, newRelativePath: string) {
    const filePath = await SystemPluginService.renamePluginFile(id, oldRelativePath, newRelativePath);
    const plugin = await SystemPluginService.getPlugin(id);
    if (plugin?.enabled) {
      await this.tryLoadSystemPlugin(id, true);
    }
    return filePath;
  }

  async deleteSystemPluginFile(id: string, relativePath: string) {
    await SystemPluginService.deletePluginFile(id, relativePath);
    const plugin = await SystemPluginService.getPlugin(id);
    if (plugin?.enabled) {
      await this.tryLoadSystemPlugin(id, true);
    }
  }

  async updateSystemPluginFile(path: string, source: string) {
    const plugin = await SystemPluginService.updatePluginFile(path, source);
    if (plugin.enabled) {
      await this.tryLoadSystemPlugin(plugin.id, true);
    }
    return (await SystemPluginService.getPlugin(plugin.id)) ?? plugin;
  }

  async renameSystemPluginDirectory(id: string, oldRelativePath: string, newRelativePath: string) {
    const dirPath = await SystemPluginService.renamePluginDirectory(id, oldRelativePath, newRelativePath);
    const plugin = await SystemPluginService.getPlugin(id);
    if (plugin?.enabled) {
      await this.tryLoadSystemPlugin(id, true);
    }
    return dirPath;
  }

  async deleteSystemPluginDirectory(id: string, relativePath: string) {
    await SystemPluginService.deletePluginDirectory(id, relativePath);
    const plugin = await SystemPluginService.getPlugin(id);
    if (plugin?.enabled) {
      await this.tryLoadSystemPlugin(id, true);
    }
  }

  async setSystemPluginEnabled(id: string, enabled: boolean) {
    const plugin = await SystemPluginService.setPluginEnabled(id, enabled);
    if (enabled) {
      const loadedId = await this.tryLoadSystemPlugin(id, true);
      return (await SystemPluginService.getPlugin(loadedId ?? id)) ?? plugin;
    } else if (this._plugins.hasPlugin(id) && this._plugins.isPluginActive(id)) {
      await this._plugins.deactivatePlugin(id);
    }
    return plugin;
  }

  async removeSystemPlugin(id: string) {
    if (this._plugins.hasPlugin(id) && this._plugins.isPluginActive(id)) {
      await this._plugins.deactivatePlugin(id);
    }
    if (this._plugins.hasPlugin(id)) {
      this._plugins.unregisterPlugin(id);
    }
    await SystemPluginService.removePlugin(id);
    this._systemPluginRegistrations.delete(id);
  }

  async loadSystemPlugins() {
    const plugins = await SystemPluginService.listPlugins();
    for (const plugin of plugins) {
      if (plugin.enabled) {
        await this.tryLoadSystemPlugin(plugin.id, false);
      } else if (this._plugins.hasPlugin(plugin.id) && this._plugins.isPluginActive(plugin.id)) {
        await this._plugins.deactivatePlugin(plugin.id);
      }
    }
  }

  private async tryLoadSystemPlugin(id: string, reactivate: boolean): Promise<string | null> {
    try {
      return await this.loadSystemPlugin(id, reactivate);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Failed to load system plugin '${id}'. The plugin has been disabled.`, err);
      await this.disableFailedSystemPlugin(id, message);
      return null;
    }
  }

  private async loadSystemPlugin(id: string, reactivate: boolean): Promise<string | null> {
    const installed = await SystemPluginService.getInstalledPluginSource(id);
    if (!installed) {
      return null;
    }
    const plugin = await this.importSystemPlugin(installed);
    if (plugin.id !== id) {
      throw new Error(`System plugin '${id}' exports mismatched plugin id '${plugin.id}'`);
    }
    const manifest = installed.manifest;
    if (reactivate && this._plugins.hasPlugin(id)) {
      if (this._plugins.isPluginActive(id)) {
        await this._plugins.deactivatePlugin(id);
      }
      this._plugins.unregisterPlugin(id);
    }
    if (!this._plugins.hasPlugin(plugin.id)) {
      this.registerPlugin(plugin);
      this._systemPluginRegistrations.set(plugin.id, manifest);
      await this._plugins.activatePlugin(plugin.id);
      return plugin.id;
    }
    this._systemPluginRegistrations.set(plugin.id, manifest);
    if (reactivate && this._plugins.isPluginActive(plugin.id)) {
      await this._plugins.deactivatePlugin(plugin.id);
    }
    if (!this._plugins.isPluginActive(plugin.id)) {
      await this._plugins.activatePlugin(plugin.id);
    }
    return plugin.id;
  }

  private async disableFailedSystemPlugin(id: string, reason: string) {
    try {
      if (this._plugins.hasPlugin(id) && this._plugins.isPluginActive(id)) {
        await this._plugins.deactivatePlugin(id);
      }
    } catch (err) {
      console.warn(`Failed to deactivate system plugin '${id}' after load error:`, err);
    }
    if (this._plugins.hasPlugin(id)) {
      try {
        this._plugins.unregisterPlugin(id);
      } catch (err) {
        console.warn(`Failed to unregister system plugin '${id}' after load error:`, err);
      }
    }
    this._systemPluginRegistrations.delete(id);
    try {
      await SystemPluginService.setPluginEnabled(id, false);
      console.warn(`System plugin '${id}' was disabled because it failed to load: ${reason}`);
    } catch (err) {
      console.error(`Failed to disable system plugin '${id}' after load error:`, err);
    }
  }

  private async importSystemPlugin(installed: InstalledSystemPlugin) {
    SystemPluginService.validatePluginSource(installed.source);
    const registry = new ScriptRegistry(SystemPluginService.VFS, installed.manifest.packageDir);
    const moduleUrl = await registry.resolveRuntimeUrl(installed.entryPath);
    if (!moduleUrl) {
      throw new Error(`Cannot load system plugin '${installed.id}'`);
    }
    const mod = await import(/* @vite-ignore */ moduleUrl);
    const definition = (mod.default ?? mod.plugin ?? mod) as EditorPluginDefinition;
    if (typeof definition?.activate !== 'function') {
      throw new Error(`System plugin '${installed.id}' does not export a valid editor plugin`);
    }
    const plugin: EditorPlugin = {
      ...definition,
      id: installed.manifest.id,
      name: installed.manifest.name,
      version: installed.manifest.version,
      description: installed.manifest.description
    };
    return plugin;
  }

  private async waitForMonaco(timeoutMs = 15000): Promise<typeof Monaco | null> {
    const monacoNow = (window as any).monaco as typeof Monaco | undefined;
    if (monacoNow?.languages?.typescript?.typescriptDefaults) {
      return monacoNow;
    }

    return new Promise((resolve) => {
      let settled = false;
      const cleanup = () => {
        window.removeEventListener('monaco-ready', onReady);
        clearTimeout(timer);
      };
      const finish = (value: typeof Monaco | null) => {
        if (!settled) {
          settled = true;
          cleanup();
          resolve(value);
        }
      };
      const onReady = () => {
        const monaco = (window as any).monaco as typeof Monaco | undefined;
        if (monaco?.languages?.typescript?.typescriptDefaults) {
          finish(monaco);
        }
      };
      const timer = window.setTimeout(() => finish(null), timeoutMs);
      window.addEventListener('monaco-ready', onReady, { once: true });
      onReady();
    });
  }

  private getVFSForPath(path: string) {
    return this.isSystemPluginPath(path) ? SystemPluginService.VFS : ProjectService.VFS;
  }

  private async handleSaveCode(fileName: string, content: string) {
    try {
      if (this.isSystemPluginPath(fileName)) {
        const plugin = await SystemPluginService.updatePluginFile(fileName, content);
        if (plugin.enabled) {
          await this.tryLoadSystemPlugin(plugin.id, true);
        }
      } else {
        await this.getVFSForPath(fileName).writeFile(fileName, content, { encoding: 'utf8', create: true });
      }
    } catch (err) {
      await DlgMessage.messageBox('Error', `Save failed: ${err}`);
    }
  }

  private getScriptRegistryForPath(path: string) {
    return this.isSystemPluginPath(path)
      ? new ScriptRegistry(SystemPluginService.VFS, this.getSystemPluginPackageDir(path))
      : getEngine().scriptingSystem.registry;
  }

  private async refreshSystemPluginDependencyTypes(
    pluginId: string,
    pluginPackageDir: string,
    monaco?: typeof Monaco
  ) {
    const monacoInstance = monaco ?? (await this.waitForMonaco());
    if (!monacoInstance) {
      return;
    }
    this.clearDependencyTypesForOwner(pluginId);
    await this.loadDependencyTypesFromLock(
      pluginId,
      SystemPluginService.VFS,
      pluginPackageDir,
      monacoInstance
    );
  }

  private async removeSystemPluginDependencyTypes(pluginId: string, packageName: string) {
    await this.waitForMonaco();
    const encodedName = encodeURIComponent(packageName);
    for (const libPath of Object.keys(this._extraLibs)) {
      if (
        libPath.startsWith(`file:///types/esm.sh/${encodedName}/`) ||
        libPath.startsWith(`file:///types/${encodedName}/`) ||
        libPath.startsWith(`file:///types/${packageName}/`)
      ) {
        this.deleteScriptDependence(libPath);
      }
    }
    this.removeCompilerPathMapping(packageName);
  }

  private clearDependencyTypesForOwner(ownerId: string) {
    for (const libPath of Object.keys(this._extraLibs)) {
      const disposable = this._extraLibs[libPath] as Monaco.IDisposable & { ownerId?: string };
      if (disposable?.ownerId === ownerId) {
        this.deleteScriptDependence(libPath);
      }
    }
  }

  private removeCompilerPathMapping(packageName: string) {
    const monaco = (window as any).monaco as typeof Monaco | undefined;
    if (!monaco?.languages?.typescript?.typescriptDefaults) {
      return;
    }
    const defaults = monaco.languages.typescript.typescriptDefaults;
    const prev = defaults.getCompilerOptions?.() ?? {};
    const nextPaths = { ...(prev.paths || {}) };
    delete nextPaths[packageName];
    defaults.setCompilerOptions({
      ...prev,
      paths: nextPaths
    });
  }

  private isSystemPluginPath(path: string) {
    return path?.startsWith('/system/plugins/');
  }

  private getSystemPluginPackageDir(path: string) {
    const normalizedPath = SystemPluginService.VFS.normalizePath(path);
    const packagesDir = SystemPluginService.VFS.normalizePath(SystemPluginService.packagesDir);
    const packagePrefix = `${packagesDir}/`;
    if (!normalizedPath.startsWith(packagePrefix)) {
      return SystemPluginService.packagesDir;
    }
    const relativePath = normalizedPath.slice(packagePrefix.length);
    const pluginId = relativePath.split('/')[0];
    return pluginId
      ? SystemPluginService.VFS.join(SystemPluginService.packagesDir, pluginId)
      : SystemPluginService.packagesDir;
  }
}
