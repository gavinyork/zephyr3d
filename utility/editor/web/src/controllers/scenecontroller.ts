import { BoxShape, CylinderShape, PlaneShape, SphereShape, TorusShape } from '@zephyr3d/scene';
import type { ApiClient } from '../api/client/apiclient';
import { SceneApiService } from '../api/services/sceneservcie';
import { AddShapeCommand } from '../commands/scenecommands';
import { CommandManager } from '../core/command';
import { eventBus } from '../core/eventbus';
import { SceneModel } from '../models/scenemodel';
import { BaseController } from './basecontroller';

export class SceneController extends BaseController<SceneModel> {
  protected _api: SceneApiService;
  protected _cmdManager: CommandManager;
  constructor(model: SceneModel, apiClient: ApiClient) {
    super(model, apiClient);
    this._api = new SceneApiService(this.apiClient);
    this._cmdManager = new CommandManager();
  }
  handleEvent(ev: Event, type?: string): boolean {
    return this.model.camera.handleEvent(ev, type);
  }
  protected onActivate(name: string, uuid: string): void {
    eventBus.on('update', this.update, this);
    eventBus.on('action', this.sceneAction, this);
  }
  protected onDeactivate(): void {
    eventBus.off('update', this.update, this);
    eventBus.off('action', this.sceneAction, this);
  }
  private sceneAction(action: string) {
    switch (action) {
      case 'UNDO':
        this._cmdManager.undo();
        break;
      case 'REDO':
        alert('Not implemented');
        break;
      case 'TRANSLATE':
        console.log('Translate');
        break;
      case 'ROTATE':
        console.log('Rotate');
        break;
      case 'SCALE':
        console.log('Scale');
        break;
      case 'DELETE':
        console.log('Delete');
        break;
      case 'ADD_BOX': {
        this._cmdManager.execute(
          new AddShapeCommand(this.model.scene, BoxShape, { anchor: 0.5, anchorY: 0 })
        );
        break;
      }
      case 'ADD_SPHERE': {
        this._cmdManager.execute(new AddShapeCommand(this.model.scene, SphereShape));
        break;
      }
      case 'ADD_PLANE': {
        this._cmdManager.execute(new AddShapeCommand(this.model.scene, PlaneShape));
        break;
      }
      case 'ADD_CYLINDER': {
        this._cmdManager.execute(new AddShapeCommand(this.model.scene, CylinderShape));
        break;
      }
      case 'ADD_TORUS': {
        this._cmdManager.execute(new AddShapeCommand(this.model.scene, TorusShape));
        break;
      }
      default:
        console.log('Unknown action');
        break;
    }
  }
  private update() {
    this.model.camera.updateController();
  }
}
