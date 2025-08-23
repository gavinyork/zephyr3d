import type { HttpDirectoryReader, VFS } from '@zephyr3d/base';
import { HttpFS, IndexedDBFS, randomUUID } from '@zephyr3d/base';
import { SerializationManager } from '@zephyr3d/scene';
import { templateIndex, templateIndexHTML } from '../build/templates';

export type ProjectInfo = {
  name: string;
  uuid?: string;
  lastEditScene?: string;
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

export class ProjectService {
  private static _currentProject = '';
  private static _serializationManager: SerializationManager = null;
  private static readonly PROJECT_MANIFEST = '/project.manifest.json';
  private static _vfs: VFS = null;

  static get VFS() {
    return this._vfs;
  }
  static get serializationManager() {
    return this._serializationManager;
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
      await vfs.writeFile('/index.html', templateIndexHTML, {
        encoding: 'utf8',
        create: true
      });
      await vfs.writeFile('/src/index.ts', templateIndex, {
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
  static async closeCurrentProject() {
    if (this._currentProject) {
      this._currentProject = '';
      await this._vfs.close();
      this._vfs = null;
      this._serializationManager.clearCache();
      this._serializationManager = null;
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

    this._vfs = new IndexedDBFS(info.uuid, '$');
    this._serializationManager = new SerializationManager(this._vfs);
    console.log(`Project opened: ${uuid}`);
    return info;
  }
  static async openRemoteProject(url: string, directoryReader: HttpDirectoryReader): Promise<ProjectInfo> {
    if (this._currentProject) {
      throw new Error('Current project must be closed before opening another project');
    }
    this._vfs = new HttpFS(url, { directoryReader });
    this._serializationManager = new SerializationManager(this._vfs);
    console.log(`Remote project opened: ${url}`);
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
