import type { Scene } from '@zephyr3d/scene';
import { eventBus } from '../core/eventbus';
import { SceneModel } from '../models/scenemodel';
import { BaseController } from './basecontroller';
import { SceneView } from '../views/sceneview';
import { Dialog } from '../views/dlg/dlg';
import type { Editor } from '../core/editor';
import { ProjectService } from '../core/services/project';
import { DlgProjectSettings } from '../views/dlg/projectsettingsdlg';

export class SceneController extends BaseController<SceneModel, SceneView> {
  protected _editor: Editor;
  protected _view: SceneView;
  protected _model: SceneModel;
  protected _scenePath: string;
  protected _sceneChanged: boolean;
  constructor(editor: Editor) {
    super();
    this._editor = editor;
    this._model = new SceneModel();
    this._view = new SceneView(this);
    this._sceneChanged = false;
  }
  get editor() {
    return this._editor;
  }
  get sceneChanged() {
    return this._sceneChanged;
  }
  getModel(): SceneModel {
    return this._model;
  }
  getView(): SceneView {
    return this._view;
  }
  handleEvent(ev: Event, type?: string): boolean {
    return this.view.handleEvent(ev, type);
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
  private async sceneAction(action: string, ...args: any[]) {
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
      case 'PROJECT_SETTINGS': {
        const info = await DlgProjectSettings.editProjectSettings(
          'Edit Project Settings',
          ProjectService.VFS,
          this._editor.currentProject,
          400
        );
        if (info) {
          await ProjectService.saveProject(info);
        }
        break;
      }
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
          'Scene (*.scn)|*.scn|All files (*)|*',
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
          const name =
            typeof args[0] === 'string'
              ? args[0]
              : await Dialog.openFile(
                  'Open Scene',
                  ProjectService.VFS,
                  this._editor.currentProject,
                  'Scene (*.scn)|*.scn|All files (*)|*',
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
    this.model.scene.mainCamera.updateController();
    this._view.update(dt);
  }
  private async saveScene() {
    await ProjectService.serializationManager.saveScene(this.model.scene, this._scenePath);
    this._editor.currentProject.lastEditScene = this._scenePath;
    await this._editor.saveProject();
    this._sceneChanged = false;
  }
  async loadScene(path: string): Promise<Scene> {
    return ProjectService.serializationManager.loadScene(path);
  }
  async openScene(path: string, resetView: boolean) {
    const scene = await this.loadScene(path);
    this._editor.currentProject.lastEditScene = path;
    await this._editor.saveProject();
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
