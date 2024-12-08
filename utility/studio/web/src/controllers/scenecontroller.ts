import type { ApiClient } from '../api/client/apiclient';
import { SceneApiService } from '../api/services/sceneservcie';
import { CommandManager } from '../core/command';
import { SceneModel } from '../models/scenemodel';
import { SceneView } from '../views/scene/sceneview';
import { BaseController } from './basecontroller';

export class SceneController extends BaseController<SceneModel, SceneView> {
  protected _api: SceneApiService;
  protected _cmdManager: CommandManager;
  constructor(apiClient: ApiClient) {
    super('SceneController', new SceneModel(), new SceneView());
    this._api = new SceneApiService(apiClient);
    this._cmdManager = new CommandManager();
  }
}
