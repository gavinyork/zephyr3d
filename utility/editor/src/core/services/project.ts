import { IndexedDBFS } from '@zephyr3d/base';
import { EmbeddedAssetInfo, SerializationManager } from '@zephyr3d/scene';

export type ProjectInfo = {
  name: string;
  uuid?: string;
  homedir?: string;
};

export type RecentProject = {
  uuid: string;
  time: number;
};

type EditorManifest = {
  projectList: Record<string, ProjectInfo>;
  history: Record<string, number>;
};

const DATABASE_NAME = 'zephyr3d-editor';
const editorVFS = new IndexedDBFS(DATABASE_NAME, '$');

export class ProjectService {
  private static _currentProject = '';
  private static _serializationManager: SerializationManager = new SerializationManager(editorVFS);
  private static readonly PROJECT_MANIFEST = '/project.manifest.json';
  private static _vfs = editorVFS;

  static get VFS() {
    return this._vfs;
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
    const uuid = crypto.randomUUID();
    const manifest = await this.readManifest();
    manifest.projectList[uuid] = {
      name,
      uuid,
      homedir: await this.createHomeDir(uuid)
    };
    await this.writeManifest(manifest);
    return uuid;
  }
  static async getCurrentProjectInfo() {
    return this._currentProject ? await this.getProjectInfo(this._currentProject) : null;
  }
  static async closeCurrentProject(purge: boolean) {
    if (this._currentProject) {
      if (purge) {
        await this.deleteProject(this._currentProject);
      }
      this._currentProject = '';
    }
  }
  static async openProject(uuid: string): Promise<ProjectInfo> {
    const manifest = await this.readManifest();
    const info = manifest.projectList[uuid];
    if (!info) {
      throw new Error(`Cannot open project: Project <${uuid}> not found`);
    }
    if (uuid !== this._currentProject) {
      this.closeCurrentProject(false);
      this._currentProject = info.uuid;
    }
    manifest.history[uuid] = Date.now();
    await this.writeManifest(manifest);
    return info;
  }
  static async saveProject(project: ProjectInfo) {
    const manifest = await this.readManifest();
    project.uuid = project.uuid || crypto.randomUUID();
    manifest.projectList[project.uuid] = project;
    await this.writeManifest(manifest);
  }
  static async deleteProject(uuid: string) {
    if (this._currentProject === uuid) {
      await this.closeCurrentProject(true);
    } else {
      new IndexedDBFS(DATABASE_NAME, uuid, false).deleteFileSystem();
    }
    const manifest = await this.readManifest();
    delete manifest.projectList[uuid];
    delete manifest.history[uuid];
    await this.deleteHomeDir(uuid);
    await this.writeManifest(manifest);
  }
  static async openScene(path: string) {
    /*
    const content = (await this._currentProjectVFS.readFile(path, { encoding: 'utf8' })) as string;
    const sceneinfo = JSON.parse(content);
    */
  }
  static get serializationManager() {
    return this._serializationManager;
  }
  static async putEmbeddedAssets(assets: EmbeddedAssetInfo[]) {
    // TODO
  }
  private static async readManifest() {
    const exists = await this._vfs.exists(ProjectService.PROJECT_MANIFEST);
    if (!exists) {
      return {
        history: {},
        projectList: {}
      };
    }
    const content = (await this._vfs.readFile(ProjectService.PROJECT_MANIFEST, {
      encoding: 'utf8'
    })) as string;
    return JSON.parse(content) as EditorManifest;
  }
  private static async writeManifest(manifest: EditorManifest) {
    await this._vfs.writeFile(ProjectService.PROJECT_MANIFEST, JSON.stringify(manifest, null, '  '), {
      create: true,
      encoding: 'utf8'
    });
  }
  private static async createHomeDir(uuid: string) {
    const homedir = this.getHomeDirName(uuid);
    await this._vfs.makeDirectory(homedir, true);
    return homedir;
  }
  private static async deleteHomeDir(uuid: string) {
    const homedir = this.getHomeDirName(uuid);
    await this._vfs.deleteDirectory(homedir, true);
  }
  private static getHomeDirName(uuid: string) {
    return `/home/${uuid}`;
  }
  private static async getProjectInfo(uuid: string) {
    const manifest = await this.readManifest();
    return manifest.projectList[uuid] ?? null;
  }
}
