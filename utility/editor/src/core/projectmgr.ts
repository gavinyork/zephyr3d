import { IndexedDBFS } from '@zephyr3d/base';
import { EmbeddedAssetInfo, SerializationManager } from '@zephyr3d/scene';

export type ProjectInfo = {
  name: string;
};

const DATABASE_NAME = 'zephyr3d-editor';

export class ProjectManager {
  private static _currentProject = '';
  private static _currentProjectVFS: IndexedDBFS = null;
  private static _currentSerializationManager: SerializationManager = null;
  private static readonly PROJECT_MANIFEST = '/project.manifest.json';
  private static _vfs = new IndexedDBFS(DATABASE_NAME, '$');

  static async listProjects(): Promise<ProjectInfo[]> {
    const exists = await this._vfs.exists(ProjectManager.PROJECT_MANIFEST);
    if (!exists) {
      return [];
    }
    const content = (await this._vfs.readFile(ProjectManager.PROJECT_MANIFEST, {
      encoding: 'utf8'
    })) as string;
    return JSON.parse(content) as ProjectInfo[];
  }
  static async createProject(info: ProjectInfo) {
    if (!info || !info.name) {
      throw new Error('Create project failed: Project name must not be empty');
    }
    const projects = await this.listProjects();
    if (projects.find((proj) => proj.name === info.name)) {
      throw new Error(`Create project failed: Project <${info.name}> already exists`);
    }
    projects.push(info);
    const content = JSON.stringify(projects, null, '  ');
    await this._vfs.writeFile(ProjectManager.PROJECT_MANIFEST, content, { encoding: 'utf8' });
  }
  static async getCurrentProjectInfo() {
    if (this._currentProject) {
      const projects = await this.listProjects();
      return projects.find((proj) => proj.name === this._currentProject);
    }
    return null;
  }
  static closeCurrentProject() {
    if (this._currentProject) {
      this._currentProject = '';
      this._currentProjectVFS = null;
      this._currentSerializationManager = null;
    }
  }
  static async openProject(name: string) {
    const projects = await this.listProjects();
    const info = projects.find((proj) => proj.name === name);
    if (!info) {
      throw new Error(`Cannot open project: Project <${name}> not found`);
    }
    this.closeCurrentProject();
    this._currentProject = info.name;
    this._currentProjectVFS = new IndexedDBFS(DATABASE_NAME, info.name, false);
    this._currentSerializationManager = new SerializationManager(this._currentProjectVFS);
  }
  static async openScene(path: string) {
    /*
    const content = (await this._currentProjectVFS.readFile(path, { encoding: 'utf8' })) as string;
    const sceneinfo = JSON.parse(content);
    */
  }
  static get projectVFS() {
    return this._currentProjectVFS;
  }
  static get projectSerializationManager() {
    return this._currentSerializationManager;
  }
  static async putEmbeddedAssets(assets: EmbeddedAssetInfo[]) {
    // TODO
  }
}
