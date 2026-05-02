import { getEngine, type Scene } from '@zephyr3d/scene';
import { eventBus } from '../core/eventbus';
import { SceneModel } from '../models/scenemodel';
import { BaseController } from './basecontroller';
import { SceneView } from '../views/sceneview';
import { Dialog } from '../views/dlg/dlg';
import type { Editor } from '../core/editor';
import { ProjectService } from '../core/services/project';
import { DlgProjectSettings } from '../views/dlg/projectsettingsdlg';
import { DlgMessage } from '../views/dlg/messagedlg';
import { DlgSystemPlugins } from '../views/dlg/systempluginsdlg';
import type { Nullable } from '@zephyr3d/base';

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
  get scenePath() {
    return this._scenePath;
  }
  get openedSceneName() {
    if (!this._scenePath) {
      return 'Untitled';
    }
    const normalized = this._scenePath.replace(/\\/g, '/');
    const index = normalized.lastIndexOf('/');
    const fileName = index >= 0 ? normalized.slice(index + 1) : normalized;
    return fileName.replace(/\.zscn$/i, '');
  }
  discardSceneChanges() {
    this._sceneChanged = false;
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
      try {
        await this.openScene(scenePath, false);
      } catch (err) {
        console.error(`Open scene '${scenePath}' failed: ${err}`);
        await this.createScene(false);
      }
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
    if (this._model.scene) {
      this._editor.plugins.dispatchEvent('sceneDirty', this._model.scene);
    }
  }
  private async sceneAction(
    action: string,
    arg?: { id?: string; force?: boolean; name?: string; path?: string; cb?: (result?: unknown) => void }
  ) {
    switch (action) {
      case 'OPEN_PROJECT': {
        await this.sceneAction('CLOSE_PROJECT', arg);
        let result: { id: Nullable<string>; err: Nullable<string> };
        if (!this._editor.currentProject) {
          result = await this._editor.openProject(arg?.id);
        } else {
          result = {
            id: null,
            err: 'User refused to open project'
          };
        }
        if (arg?.cb) {
          arg.cb(result);
        }
        break;
      }
      case 'NEW_PROJECT': {
        await this.sceneAction('CLOSE_PROJECT', arg);
        let id: string = null;
        if (!this._editor.currentProject) {
          id = await this._editor.newProject(arg?.name);
        }
        if (arg?.cb) {
          arg?.cb?.(id ? { id, err: null } : { id: null, err: 'User refused to create project' });
        }
        break;
      }
      case 'CLOSE_PROJECT': {
        let err: string = null;
        if (!arg?.force && (await this.ensureSceneSaved())) {
          err = await this._editor.closeProject(this._scenePath);
        }
        if (arg?.cb) {
          arg.cb(err);
        }
        break;
      }
      case 'PROJECT_SETTINGS': {
        const settings = await this._editor.getProjectSettings();
        const newSettings = await DlgProjectSettings.editProjectSettings(
          'Edit Project Settings',
          ProjectService.VFS,
          this._editor.currentProject,
          settings,
          500
        );
        if (newSettings) {
          await this._editor.saveProjectSettings(newSettings);
        }
        arg?.cb?.();
        break;
      }
      case 'SYSTEM_PLUGINS':
        await DlgSystemPlugins.show(this._editor);
        arg?.cb?.();
        break;
      case 'EXPORT_PROJECT': {
        let err: string = null;
        if (!arg?.force && (await this.ensureSceneSaved())) {
          err = await this._editor.exportProject();
        }
        if (arg?.cb) {
          arg.cb(err);
        }
        break;
      }
      case 'DELETE_PROJECT': {
        let err: string = null;
        if (this._editor.currentProject) {
          const uuid = this._editor.currentProject.uuid;
          if (
            !arg?.force &&
            (await Dialog.messageBoxEx(
              'zephyr3d editor',
              'Are you sure you want to delete current project?',
              ['Yes', 'Cancel']
            )) === 'Yes'
          ) {
            this._sceneChanged = false;
            await this.sceneAction('CLOSE_PROJECT', { force: true });
            await this._editor.deleteProject(uuid);
          } else {
            err = 'User refused to delete current project';
          }
        } else {
          err = 'No project opened';
        }
        if (arg?.cb) {
          arg.cb(err);
        }
        break;
      }
      case 'NEW_DOC': {
        let path: string = null;
        let err: string = null;
        if (!arg?.force && (await this.ensureSceneSaved())) {
          path = this.createScene(true, arg?.path);
        } else {
          err = 'User refused to create scene';
        }
        if (arg?.cb) {
          arg.cb({ path, err });
        }
        break;
      }
      case 'SAVE_DOC':
        if (!this._scenePath) {
          await this.sceneAction('SAVE_DOC_AS', arg);
        } else {
          await this.saveScene();
        }
        arg?.cb?.({
          path: this._scenePath,
          err: this._scenePath ? null : 'User refused to save scene'
        });
        break;
      case 'SAVE_DOC_AS': {
        const name =
          arg?.path ||
          (await Dialog.saveFile(
            'Save Scene',
            ProjectService.VFS,
            '/assets',
            'Scene (*.zscn)|*.zscn|All files (*)|*',
            500,
            400
          ));
        if (name) {
          this._scenePath = name.endsWith('.zscn') ? name : `${name}.zscn`;
          await this.sceneAction('SAVE_DOC');
        }
        break;
      }
      case 'OPEN_DOC': {
        let err = null;
        if (!arg?.force && (await this.ensureSceneSaved())) {
          if (arg?.path) {
            await this.openScene(arg.path, true);
          } else {
            const name = await Dialog.openFile(
              'Open Scene',
              ProjectService.VFS,
              '/assets',
              'Scene (*.zscn)|*.zscn|All files (*)|*',
              false,
              500,
              400
            );
            if (name.length > 0) {
              await this.openScene(name[0].meta.path, true);
            } else {
              err = 'User refused to open scene';
            }
          }
        }
        if (arg?.cb) {
          arg.cb(err);
        }
        break;
      }
      default:
        break;
    }
  }
  private update(dt: number) {
    this.model.scene.mainCamera.updateController();
    this._view.update(dt);
  }
  async saveScene() {
    if (ProjectService.VFS.readOnly) {
      const msg = 'Cannot save scene in read-only mode';
      console.error(msg);
      await DlgMessage.messageBox('Error', msg);
    } else {
      this._editor.plugins.dispatchEvent('sceneSaving', this.model.scene, this._scenePath);
      await getEngine().resourceManager.saveScene(this.model.scene, this._scenePath);
      this._editor.currentProject.lastEditScene = this._scenePath;
      await this._editor.saveProject();
      this._sceneChanged = false;
      this._editor.plugins.dispatchEvent('sceneSaved', this.model.scene, this._scenePath);
    }
  }
  async loadScene(path: string): Promise<Scene> {
    return getEngine().resourceManager.loadScene(path);
  }
  async openScene(path: string, resetView: boolean) {
    this._editor.plugins.dispatchEvent('sceneOpening', path);
    const scene = await this.loadScene(path);
    this._editor.currentProject.lastEditScene = path;
    await this._editor.saveProject();
    this._scenePath = path;
    this._sceneChanged = false;
    this.reset(scene, resetView);
    this._editor.plugins.dispatchEvent('sceneOpened', this.model.scene, path);
  }
  createScene(resetView: boolean, path?: string) {
    this._scenePath = path ?? '';
    this._sceneChanged = true;
    this.reset(null, resetView);
    this._editor.plugins.dispatchEvent('sceneCreated', this.model.scene, this._scenePath);
    return this._scenePath;
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
