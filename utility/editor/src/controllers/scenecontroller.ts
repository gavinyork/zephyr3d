import type { Scene } from '@zephyr3d/scene';
import { deserializeObject, serializeObject } from '@zephyr3d/scene';
import { eventBus } from '../core/eventbus';
import type { SceneModel } from '../models/scenemodel';
import { BaseController } from './basecontroller';
import type { SceneView } from '../views/sceneview';
import { Dialog } from '../views/dlg/dlg';
import type { Editor } from '../core/editor';
import { ProjectService } from '../core/services/project';

export class SceneController extends BaseController<SceneModel> {
  protected _editor: Editor;
  protected _scenePath: string;
  protected _sceneChanged: boolean;
  protected _view: SceneView;
  constructor(editor: Editor, model: SceneModel, view: SceneView) {
    super(model);
    this._editor = editor;
    this._view = view;
    this._sceneChanged = false;
  }
  get editor() {
    return this._editor;
  }
  get sceneChanged() {
    return this._sceneChanged;
  }
  handleEvent(ev: Event, type?: string): boolean {
    return this._view.handleEvent(ev, type);
  }
  protected async onActivate(scenePath: string): Promise<void> {
    this._scenePath = '';
    this._sceneChanged = !scenePath;
    if (scenePath) {
      await this.openScene(scenePath, false);
    } else {
      await this.createScene(false);
    }
    eventBus.on('update', this.update, this);
    eventBus.on('action', this.sceneAction, this);
    eventBus.on('scene_changed', this.invalidateScene, this);
  }
  protected onDeactivate(): void {
    this._scenePath = '';
    this._sceneChanged = false;
    eventBus.off('update', this.update, this);
    eventBus.off('action', this.sceneAction, this);
    eventBus.off('scene_changed', this.invalidateScene, this);
  }
  private invalidateScene() {
    this._sceneChanged = true;
  }
  private async sceneAction(action: string) {
    switch (action) {
      case 'OPEN_PROJECT':
        await this.sceneAction('CLOSE_PROJECT');
        if (!this._editor.currentProject) {
          await this._editor.openProject();
        }
        break;
      case 'NEW_PROJECT':
        await this.sceneAction('CLOSE_PROJECT');
        if (!this._editor.currentProject) {
          await this._editor.newProject();
        }
        break;
      case 'CLOSE_PROJECT':
        if (await this.ensureSceneSaved()) {
          await this._editor.closeProject(this._scenePath);
        }
        break;
      case 'EXPORT_PROJECT':
        if (await this.ensureSceneSaved()) {
          await this._editor.exportProject();
        }
        break;
      case 'DELETE_PROJECT': {
        if (this._editor.currentProject) {
          const uuid = this._editor.currentProject.uuid;
          if (
            (await Dialog.messageBoxEx(
              'zephyr3d editor',
              'Are you sure you want to delete current project?',
              ['Yes', 'Cancel']
            )) === 'Yes'
          ) {
            this._sceneChanged = false;
            await this.sceneAction('CLOSE_PROJECT');
            if (!this._editor.currentProject) {
              await this._editor.deleteProject(uuid);
            }
          }
        }
      }
      case 'NEW_DOC':
        if (await this.ensureSceneSaved()) {
          this.createScene(true);
        }
        break;
      case 'SAVE_DOC':
        if (!this._scenePath) {
          await this.sceneAction('SAVE_DOC_AS');
        } else {
          await this.saveScene();
        }
        break;
      case 'SAVE_DOC_AS': {
        const name = await Dialog.saveFile(
          'Save Scene',
          ProjectService.VFS,
          this._editor.currentProject,
          'Scene (*.zscn)|*.zscn|All files (*)|*',
          500,
          400
        );
        if (name) {
          this._scenePath = name;
          await this.sceneAction('SAVE_DOC');
        }
        break;
      }
      case 'OPEN_DOC': {
        if (await this.ensureSceneSaved()) {
          const name = await Dialog.openFile(
            'Open Scene',
            ProjectService.VFS,
            this._editor.currentProject,
            'Scene (*.zscn)|*.zscn|All files (*)|*',
            500,
            400
          );
          if (name) {
            await this.openScene(name, true);
          }
        }
        break;
      }
      default:
        console.log('Unknown action');
        break;
    }
  }
  private update(dt: number) {
    this.model.camera.updateController();
    this._view.update(dt);
  }
  private async saveScene() {
    // Don't export editor camera
    const parent = this.model.camera.parent;
    this.model.camera.parent = null;

    const asyncTasks: Promise<unknown>[] = [];
    const content = await serializeObject(
      this.model.scene,
      ProjectService.serializationManager,
      null,
      asyncTasks
    );
    await Promise.all(asyncTasks);
    await ProjectService.VFS.writeFile(this._scenePath, JSON.stringify(content), {
      encoding: 'utf8',
      create: true
    });
    console.log(JSON.stringify(content, null, 2));
    console.log([...asyncTasks]);
    await Promise.all(asyncTasks);
    this._sceneChanged = false;

    // Restore editor camera
    this.model.camera.parent = parent;
  }
  async loadScene(path: string) {
    const content = (await ProjectService.VFS.readFile(path, { encoding: 'utf8' })) as string;
    const json = JSON.parse(content);
    return deserializeObject<Scene>(null, json, ProjectService.serializationManager);
  }
  async openScene(path: string, resetView: boolean) {
    const scene = await this.loadScene(path);
    this._scenePath = path;
    this._sceneChanged = false;
    this.reset(scene, resetView);
  }
  createScene(resetView: boolean) {
    this._scenePath = '';
    this._sceneChanged = true;
    this.reset(null, resetView);
  }
  async ensureSceneSaved(): Promise<boolean> {
    if (this._sceneChanged) {
      const value = await Dialog.messageBoxEx('zephyr3d editor', 'Save current scene?', [
        'Yes',
        'No',
        'Cancel'
      ]);
      if (value === 'Cancel') {
        return false;
      }
      if (value === 'Yes') {
        await this.sceneAction('SAVE_DOC');
        if (this._sceneChanged) {
          return false;
        }
      }
    }
    return true;
  }
  reset(scene?: Scene, resetView?: boolean) {
    this.model.reset(scene);
    if (resetView) {
      this._view.reset();
    }
  }
}
