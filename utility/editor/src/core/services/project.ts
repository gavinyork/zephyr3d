import type { HttpDirectoryReader, VFS } from '@zephyr3d/base';
import { HttpFS, IndexedDBFS, randomUUID } from '@zephyr3d/base';
import { getEngine } from '@zephyr3d/scene';
import { templateIndex } from '../build/templates';

export type ProjectInfo = {
  name: string;
  uuid?: string;
  lastEditScene?: string;
};

export type ProjectSettings = {
  title?: string;
  favicon?: string;
  startupScene?: string;
  splashScreen?: string;
  startupScript?: string;
  preferredRHI?: string[];
};

const defaultProjectSettings: Readonly<ProjectSettings> = {
  preferredRHI: ['WebGL', 'WebGL2', 'WebGPU']
};

export type RecentProject = {
  uuid: string;
  time: number;
};

type EditorManifest = {
  projectList: Record<string, ProjectInfo>;
  history: Record<string, number>;
};

const META_DATABASE_NAME = 'zephyr3d-editor';
const metaVFS = new IndexedDBFS(META_DATABASE_NAME, '$');
let projectVFS: VFS = metaVFS;

export class ProjectService {
  private static _currentProject = '';
  private static readonly PROJECT_MANIFEST = '/project.manifest.json';

  static get VFS() {
    return projectVFS;
  }
  static set VFS(vfs: VFS) {
    if (projectVFS && projectVFS !== metaVFS) {
      projectVFS.close();
    }
    projectVFS = vfs;
    if (getEngine()) {
      getEngine().VFS = vfs;
    }
  }
  static get assetDir() {
    return '/assets';
  }
  static get serializationManager() {
    return getEngine().serializationManager;
  }
  static get currentProject() {
    return this._currentProject;
  }
  static async listProjects(): Promise<ProjectInfo[]> {
    const manifest = await this.readManifest();
    return Object.values(manifest.projectList);
  }
  static async getRecentProjects(): Promise<ProjectInfo[]> {
    const manifest = await this.readManifest();
    return Object.keys(manifest.history)
      .sort((a, b) => manifest.history[b] - manifest.history[a])
      .map((v) => manifest.projectList[v])
      .filter((v) => !!v);
  }
  static async createProject(name: string) {
    if (!name) {
      throw new Error('Create project failed: Project name must not be empty');
    }
    const uuid = randomUUID();
    const manifest = await this.readManifest();
    manifest.projectList[uuid] = {
      name,
      uuid
    };
    await this.writeManifest(manifest);
    const vfs = new IndexedDBFS(uuid, '$');
    try {
      await vfs.makeDirectory('/src');
      await vfs.makeDirectory('/assets');
      await vfs.writeFile('/src/index.ts', templateIndex, {
        encoding: 'utf8',
        create: true
      });
      const settings = { ...defaultProjectSettings, title: name };
      await vfs.writeFile('/src/settings.json', JSON.stringify(settings, null, '  '), {
        encoding: 'utf8',
        create: true
      });
    } finally {
      await vfs.close();
    }
    return uuid;
  }
  static async getCurrentProjectInfo() {
    return this._currentProject ? await this.getProjectInfo(this._currentProject) : null;
  }
  static async getCurrentProjectSettings(): Promise<ProjectSettings> {
    if (this.VFS) {
      const exists = await this.VFS.exists('/src/settings.json');
      if (!exists) {
        await this.VFS.writeFile('/src/settings.json', JSON.stringify(defaultProjectSettings, null, '  '), {
          encoding: 'utf8',
          create: true
        });
      }
      const content = (await this.VFS.readFile('/src/settings.json', { encoding: 'utf8' })) as string;
      return JSON.parse(content);
    }
    return null;
  }
  static async saveCurrentProjectSettings(settings: ProjectSettings) {
    if (this.VFS) {
      await this.VFS.writeFile('/src/settings.json', JSON.stringify(settings, null, '  '), {
        encoding: 'utf8',
        create: true
      });
    }
  }
  static async closeCurrentProject() {
    if (this._currentProject) {
      this._currentProject = '';
      this.VFS = metaVFS;
    }
  }
  static async openProject(uuid: string): Promise<ProjectInfo> {
    const manifest = await this.readManifest();
    const info = manifest.projectList[uuid];
    if (!info) {
      throw new Error(`Cannot open project: Project <${uuid}> not found`);
    }
    if (this._currentProject) {
      throw new Error('Current project must be closed before opening another project');
    }
    manifest.history[uuid] = Date.now();
    await this.writeManifest(manifest);

    this.VFS = new IndexedDBFS(info.uuid, '$');

    this._currentProject = uuid;
    console.info(`Project opened: ${uuid}`);
    return info;
  }
  static async openRemoteProject(url: string, directoryReader: HttpDirectoryReader): Promise<ProjectInfo> {
    if (this._currentProject) {
      throw new Error('Current project must be closed before opening another project');
    }
    this.VFS = new HttpFS(url, { directoryReader });
    console.info(`Remote project opened: ${url}`);
    return {
      name: url,
      uuid: url
    };
  }
  static async deleteProject(uuid: string): Promise<void> {
    if (this._currentProject === uuid) {
      throw new Error('Project must be closed before delete it');
    }
    const manifest = await this.readManifest();
    const info = manifest.projectList[uuid];
    if (info) {
      delete manifest.projectList[uuid];
      delete manifest.history[uuid];
      await this.writeManifest(manifest);
      await IndexedDBFS.deleteDatabase(info.uuid);
    }
  }
  static async saveProject(project: ProjectInfo) {
    const manifest = await this.readManifest();
    project.uuid = project.uuid || randomUUID();
    manifest.projectList[project.uuid] = project;
    await this.writeManifest(manifest);
  }
  private static async readManifest() {
    const exists = await metaVFS.exists(ProjectService.PROJECT_MANIFEST);
    if (!exists) {
      return {
        history: {},
        projectList: {}
      };
    }
    const content = (await metaVFS.readFile(ProjectService.PROJECT_MANIFEST, {
      encoding: 'utf8'
    })) as string;
    return JSON.parse(content) as EditorManifest;
  }
  private static async writeManifest(manifest: EditorManifest) {
    await metaVFS.writeFile(ProjectService.PROJECT_MANIFEST, JSON.stringify(manifest, null, '  '), {
      create: true,
      encoding: 'utf8'
    });
  }
  private static async getProjectInfo(uuid: string) {
    const manifest = await this.readManifest();
    return manifest.projectList[uuid] ?? null;
  }
}
