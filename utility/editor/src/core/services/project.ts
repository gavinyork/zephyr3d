import type { HttpDirectoryReader, Immutable, VFS } from '@zephyr3d/base';
import { HttpFS, MemoryFS, PathUtils, randomUUID } from '@zephyr3d/base';
import { DEFAULT_MORPH_TARGET_LIMIT, getEngine, normalizeMorphTargetLimit, setMorphTargetLimit, tryGetApp } from '@zephyr3d/scene';
import { fileListFileName, libDir, projectFileName } from '../build/templates';
import { DlgMessage } from '../../views/dlg/messagedlg';
import { installDeps } from '../build/dep';
import { createEditorMetaVFS, createProjectVFS, deleteProjectVFS } from './storage';
import { getDesktopAPI, type DesktopFSScope } from './desktop';

export type ProjectInfo = {
  name: string;
  uuid?: string;
  path?: string;
  lastEditScene?: string;
};

export type ProjectSettings = {
  title?: string;
  favicon?: string;
  startupScene?: string;
  splashScreen?: string;
  startupScript?: string;
  preferredRHI?: string[];
  enableMSAA?: boolean;
  renderScale?: number;
  morphTargetLimit?: number;
  dependencies?: { [name: string]: string };
};

const defaultProjectSettings: Immutable<ProjectSettings> = {
  preferredRHI: ['WebGL', 'WebGL2', 'WebGPU'],
  enableMSAA: false,
  renderScale: 0,
  morphTargetLimit: DEFAULT_MORPH_TARGET_LIMIT
};

function normalizeRenderScale(scale: number): number {
  const supportedScales = [0, 1, 1.25, 1.5, 2];
  if (typeof scale !== 'number' || !Number.isFinite(scale)) {
    return 0;
  }
  for (const value of supportedScales) {
    if (Math.abs(value - scale) < 1e-6) {
      return value;
    }
  }
  return 1;
}

function normalizeProjectSettings(settings: ProjectSettings): ProjectSettings {
  const preferredRHI = settings?.preferredRHI ?? defaultProjectSettings.preferredRHI;
  return {
    ...defaultProjectSettings,
    ...settings,
    preferredRHI: preferredRHI ? [...preferredRHI] : undefined,
    enableMSAA: !!settings?.enableMSAA,
    renderScale: normalizeRenderScale(settings?.renderScale),
    morphTargetLimit: normalizeMorphTargetLimit(settings?.morphTargetLimit)
  };
}

export type RecentProject = {
  uuid: string;
  time: number;
};

type EditorManifest = {
  projectList: Record<string, ProjectInfo>;
  history: Record<string, number>;
};

function isAbsoluteProjectId(value: string): boolean {
  return (
    typeof value === 'string' &&
    (/^[a-zA-Z]:[\\/]/.test(value) || value.startsWith('\\\\') || value.startsWith('/'))
  );
}

function normalizeProjectInfo(info: ProjectInfo | null | undefined): ProjectInfo | null {
  if (!info) {
    return null;
  }
  if (!info.path && isAbsoluteProjectId(info.uuid)) {
    return {
      ...info,
      path: info.uuid
    };
  }
  return { ...info };
}

export function getProjectStorageId(project: ProjectInfo): string {
  return project.path || project.uuid;
}

function resolveDesktopProjectDirectory(parentDirectory: string, projectName: string): string {
  const normalizedParent = String(parentDirectory || '')
    .trim()
    .replace(/[\\/]+$/, '');
  const normalizedName = String(projectName || '')
    .trim()
    .replace(/[\\/]+/g, ' ')
    .trim();
  if (!normalizedParent || !normalizedName) {
    return normalizedParent || normalizedName;
  }
  const separator = normalizedParent.includes('\\') ? '\\' : '/';
  return `${normalizedParent}${separator}${normalizedName}`;
}

const metaVFS = createEditorMetaVFS();
let projectVFS: VFS = metaVFS;

export class ProjectService {
  private static _currentProject = '';
  private static _currentProjectInfo: ProjectInfo | null = null;
  private static readonly PROJECT_MANIFEST = '/project.manifest.json';
  static get VFS() {
    return projectVFS;
  }
  static set VFS(vfs: VFS) {
    if (projectVFS && projectVFS !== metaVFS) {
      projectVFS.close();
    }
    projectVFS = vfs;
    if (tryGetApp()) {
      getEngine().VFS = vfs;
    }
  }
  static get assetDir() {
    return '/assets';
  }
  static get currentProject() {
    return this._currentProject;
  }
  static get currentProjectStorageId() {
    return this._currentProjectInfo ? getProjectStorageId(this._currentProjectInfo) : '';
  }
  static applyRuntimeSettings(settings?: ProjectSettings | null) {
    setMorphTargetLimit(settings?.morphTargetLimit);
  }
  static async listProjects(): Promise<ProjectInfo[]> {
    const manifest = await this.readManifest(true);
    return Object.values(manifest.projectList).map((project) => normalizeProjectInfo(project));
  }
  static async getRecentProjects(): Promise<ProjectInfo[]> {
    const manifest = await this.readManifest(true);
    return Object.keys(manifest.history)
      .sort((a, b) => manifest.history[b] - manifest.history[a])
      .map((v) => manifest.projectList[v])
      .map((project) => normalizeProjectInfo(project))
      .filter((v) => !!v);
  }
  static async importProject(files: File[], directory?: string, nameOverride?: string) {
    let baseDir = '';
    for (const f of files) {
      if (f.name === projectFileName) {
        baseDir = PathUtils.dirname(f.webkitRelativePath);
        break;
      }
    }
    if (!baseDir) {
      await DlgMessage.messageBox('Error', 'No project found in specified directory');
      return '';
    }
    const name = nameOverride?.trim() || PathUtils.basename(baseDir);
    const desktop = getDesktopAPI();
    if (desktop && directory && !isAbsoluteProjectId(directory)) {
      throw new Error(`Import project failed: Parent directory must be an absolute path, got <${directory}>`);
    }
    const selectedDirectory = desktop
      ? directory ||
        (desktop.fs.pickDirectory
          ? await desktop.fs.pickDirectory({
              title: 'Select Import Parent Directory',
              buttonLabel: 'Select Folder'
            })
          : '')
      : randomUUID();
    if (!selectedDirectory) {
      return '';
    }
    const uuid = desktop ? resolveDesktopProjectDirectory(selectedDirectory, name) : selectedDirectory;
    const project = normalizeProjectInfo({
      name,
      uuid
    });
    await this.ensureProjectLocationAvailable(project);
    const vfs = createProjectVFS(getProjectStorageId(project));
    try {
      for (const f of files) {
        const path = `/${PathUtils.relative(baseDir, f.webkitRelativePath)}`;
        if (path === `/${fileListFileName}`) {
          continue;
        }
        const content = await f.arrayBuffer();
        await vfs.writeFile(path, content, { encoding: 'binary', create: true });
      }
      if (!(await vfs.exists('/assets'))) {
        await vfs.makeDirectory('/assets');
      }
    } finally {
      await vfs.close();
    }
    const manifest = await this.readManifest();
    manifest.projectList[uuid] = project;
    await this.writeManifest(manifest);
    return uuid;
  }
  static async createProject(name: string, directory?: string) {
    if (!name) {
      throw new Error('Create project failed: Project name must not be empty');
    }
    const desktop = getDesktopAPI();
    if (desktop && directory && !isAbsoluteProjectId(directory)) {
      throw new Error(`Create project failed: Parent directory must be an absolute path, got <${directory}>`);
    }
    const selectedDirectory = desktop
      ? directory ||
        (desktop.fs.pickDirectory
          ? await desktop.fs.pickDirectory({
              title: 'Select Project Parent Directory',
              buttonLabel: 'Select Folder'
            })
          : '')
      : randomUUID();
    if (!selectedDirectory) {
      return '';
    }
    const uuid = desktop ? resolveDesktopProjectDirectory(selectedDirectory, name) : selectedDirectory;
    const project = normalizeProjectInfo({
      name,
      uuid
    });
    await this.ensureProjectLocationAvailable(project);
    const vfs = createProjectVFS(getProjectStorageId(project));
    try {
      await vfs.makeDirectory('/assets', true);
      const settings = { ...defaultProjectSettings, title: name };
      await vfs.writeFile(`/${projectFileName}`, JSON.stringify(settings, null, 2), {
        encoding: 'utf8',
        create: true
      });
    } finally {
      await vfs.close();
    }
    const manifest = await this.readManifest();
    manifest.projectList[uuid] = project;
    await this.writeManifest(manifest);
    return uuid;
  }
  static async registerProjectDirectory(directory?: string) {
    const desktop = getDesktopAPI();
    if (!desktop) {
      throw new Error('Open project directory is only supported in the desktop editor');
    }
    if (directory && !isAbsoluteProjectId(directory)) {
      throw new Error(
        `Open project directory failed: Project directory must be an absolute path, got <${directory}>`
      );
    }
    const projectDirectory =
      directory ||
      (desktop.fs.pickDirectory
        ? await desktop.fs.pickDirectory({
            title: 'Select Project Directory',
            buttonLabel: 'Select Folder'
          })
        : '');
    if (!projectDirectory) {
      return '';
    }
    const project = await this.loadProjectFromDirectory(projectDirectory);
    const manifest = await this.readManifest();
    manifest.projectList[project.uuid] = project;
    manifest.history[project.uuid] = Date.now();
    await this.writeManifest(manifest);
    return project.uuid;
  }
  static async getCurrentProjectInfo() {
    if (!this._currentProject) {
      this._currentProjectInfo = null;
      return null;
    }
    if (this._currentProjectInfo?.uuid === this._currentProject) {
      return { ...this._currentProjectInfo };
    }
    const info = await this.getProjectInfo(this._currentProject);
    this._currentProjectInfo = info ? { ...info } : null;
    return info;
  }
  static async getCurrentProjectSettings(): Promise<ProjectSettings> {
    if (this.VFS) {
      const exists = await this.VFS.exists(`/${projectFileName}`);
      if (!exists) {
        await this.VFS.writeFile(`/${projectFileName}`, JSON.stringify(defaultProjectSettings, null, 2), {
          encoding: 'utf8',
          create: true
        });
      }
      const content = (await this.VFS.readFile(`/${projectFileName}`, { encoding: 'utf8' })) as string;
      return normalizeProjectSettings(JSON.parse(content));
    }
    return null;
  }
  static async saveCurrentProjectSettings(settings: ProjectSettings) {
    if (this.VFS) {
      await this.VFS.writeFile(
        `/${projectFileName}`,
        JSON.stringify(normalizeProjectSettings(settings), null, 2),
        {
          encoding: 'utf8',
          create: true
        }
      );
    }
  }
  static async closeCurrentProject() {
    if (this._currentProject || this._currentProjectInfo || this.VFS !== metaVFS) {
      this._currentProject = '';
      this._currentProjectInfo = null;
      this.VFS = metaVFS;
    }
  }
  static async openProject(uuid: string): Promise<ProjectInfo> {
    const manifest = await this.readManifest(true);
    const info = normalizeProjectInfo(manifest.projectList[uuid]);
    if (!info) {
      throw new Error(`Cannot open project: Project <${uuid}> not found`);
    }
    if (!(await this.isProjectAvailable(info))) {
      delete manifest.projectList[uuid];
      delete manifest.history[uuid];
      await this.writeManifest(manifest);
      throw new Error(`Cannot open project: Project <${uuid}> is no longer available`);
    }
    if (this._currentProject) {
      throw new Error('Current project must be closed before opening another project');
    }
    manifest.history[uuid] = Date.now();
    await this.writeManifest(manifest);

    this.VFS = createProjectVFS(getProjectStorageId(info));

    this._currentProject = uuid;
    this._currentProjectInfo = { ...info };
    console.info(`Project opened: ${uuid}`);
    return info;
  }
  static async openRemoteProject(url: string, directoryReader: HttpDirectoryReader): Promise<ProjectInfo> {
    if (this._currentProject) {
      throw new Error('Current project must be closed before opening another project');
    }
    this.VFS = new HttpFS(url, { directoryReader });
    const settings = await this.getCurrentProjectSettings();
    const deps = Object.keys(settings.dependencies ?? {});
    if (deps.length > 0) {
      const libsVFS = new MemoryFS();
      await this.VFS.mount(`/${libDir}`, libsVFS);
      for (const dep of deps) {
        const depName = dep;
        const depVersion = settings.dependencies[dep];
        const packageName = `${depName}@${depVersion}`;
        const installed = await ProjectService.VFS.exists(`/${libDir}/deps/${packageName}`);
        if (!installed) {
          await installDeps(url, this.VFS, '/', packageName, null, false);
        }
      }
    }
    console.info(`Remote project opened: ${url}`);
    this._currentProjectInfo = {
      name: url,
      uuid: url
    };
    return {
      name: url,
      uuid: url
    };
  }
  static async deleteProject(uuid: string): Promise<void> {
    if (this._currentProject === uuid) {
      throw new Error('Project must be closed before delete it');
    }
    const manifest = await this.readManifest(true);
    const info = normalizeProjectInfo(manifest.projectList[uuid]);
    if (info) {
      delete manifest.projectList[uuid];
      delete manifest.history[uuid];
      await this.writeManifest(manifest);
      await deleteProjectVFS(getProjectStorageId(info));
    }
  }
  static async saveProject(project: ProjectInfo) {
    const manifest = await this.readManifest();
    project.uuid = project.uuid || randomUUID();
    const normalizedProject = normalizeProjectInfo(project);
    manifest.projectList[project.uuid] = normalizedProject;
    await this.writeManifest(manifest);
    if (normalizedProject?.uuid && normalizedProject.uuid === this._currentProject) {
      this._currentProjectInfo = { ...normalizedProject };
    }
  }
  private static async readManifest(validate = false) {
    const exists = await metaVFS.exists(ProjectService.PROJECT_MANIFEST);
    const manifest = !exists
      ? {
          history: {},
          projectList: {}
        }
      : (((JSON.parse(
          (await metaVFS.readFile(ProjectService.PROJECT_MANIFEST, {
            encoding: 'utf8'
          })) as string
        ) as EditorManifest) ?? {
          history: {},
          projectList: {}
        }) as EditorManifest);
    if (!validate) {
      return manifest;
    }
    let dirty = false;
    for (const uuid of Object.keys(manifest.projectList)) {
      const info = normalizeProjectInfo(manifest.projectList[uuid]);
      if (!info || !(await this.isProjectAvailable(info))) {
        delete manifest.projectList[uuid];
        delete manifest.history[uuid];
        dirty = true;
      }
    }
    for (const uuid of Object.keys(manifest.history)) {
      if (!manifest.projectList[uuid]) {
        delete manifest.history[uuid];
        dirty = true;
      }
    }
    if (dirty) {
      await this.writeManifest(manifest);
    }
    return manifest;
  }
  private static async writeManifest(manifest: EditorManifest) {
    await metaVFS.writeFile(ProjectService.PROJECT_MANIFEST, JSON.stringify(manifest, null, 2), {
      create: true,
      encoding: 'utf8'
    });
  }
  private static async getProjectInfo(uuid: string) {
    const manifest = await this.readManifest(true);
    return normalizeProjectInfo(manifest.projectList[uuid]);
  }
  private static async loadProjectFromDirectory(directory: string): Promise<ProjectInfo> {
    const project = normalizeProjectInfo({
      name: '',
      uuid: directory
    });
    const vfs = createProjectVFS(getProjectStorageId(project));
    try {
      const exists = await vfs.exists(`/${projectFileName}`);
      if (!exists) {
        throw new Error(`Open project directory failed: <${directory}> does not contain ${projectFileName}`);
      }
      const content = (await vfs.readFile(`/${projectFileName}`, { encoding: 'utf8' })) as string;
      const settings = normalizeProjectSettings(JSON.parse(content));
      const name = settings.title?.trim() || PathUtils.basename(directory.replace(/\\/g, '/'));
      return normalizeProjectInfo({
        name,
        uuid: directory
      });
    } finally {
      await vfs.close();
    }
  }
  private static async isProjectAvailable(project: ProjectInfo) {
    const storageId = getProjectStorageId(project);
    if (!storageId) {
      return false;
    }
    const desktop = getDesktopAPI();
    if (desktop?.fs?.exists) {
      return await desktop.fs.exists(`project:${storageId}` as DesktopFSScope, `/${projectFileName}`);
    }
    const vfs = createProjectVFS(storageId);
    try {
      return await vfs.exists(`/${projectFileName}`);
    } finally {
      await vfs.close();
    }
  }
  private static async ensureProjectLocationAvailable(project: ProjectInfo) {
    const storageId = getProjectStorageId(project);
    if (!storageId) {
      throw new Error('Create project failed: Invalid project storage location');
    }
    const vfs = createProjectVFS(storageId);
    try {
      if (!(await vfs.exists('/'))) {
        return;
      }
      const stat = await vfs.stat('/');
      if (!stat.isDirectory) {
        throw new Error(`Create project failed: <${storageId}> is not a directory`);
      }
      const entries = await vfs.readDirectory('/', { recursive: false });
      if (entries.length > 0) {
        throw new Error(
          `Create project failed: Project directory <${storageId}> already exists and is not empty`
        );
      }
    } finally {
      await vfs.close();
    }
  }
}
