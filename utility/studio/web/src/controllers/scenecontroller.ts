import type { ApiClient } from '../api/client/apiclient';
import { SceneApiService } from '../api/services/sceneservcie';
import { CommandManager } from '../core/command';
import { SceneModel } from '../models/scenemodel';
import { SceneView } from '../views/scene/sceneview';
import { BaseController } from './basecontroller';

export class SceneController extends BaseController {
  protected _api: SceneApiService;
  protected _model: SceneModel;
  protected _view: SceneView;
  protected _cmdManager: CommandManager;
  constructor(apiClient: ApiClient) {
    super('SceneController');
    this._api = new SceneApiService(apiClient);
    this._model = new SceneModel();
    this._view = new SceneView();
    this._cmdManager = new CommandManager();
  }
}
