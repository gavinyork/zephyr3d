import type { ApiClient } from '../api/client/apiclient';
import { SceneApiService } from '../api/services/sceneservcie';
import { CommandManager } from '../core/command';
import { SceneModel } from '../models/scenemodel';
import { BaseController } from './basecontroller';

export class SceneController extends BaseController<SceneModel> {
  protected _api: SceneApiService;
  protected _cmdManager: CommandManager;
  constructor(model: SceneModel, apiClient: ApiClient) {
    super(model);
    this._api = new SceneApiService(apiClient);
    this._cmdManager = new CommandManager();
  }
  protected onActivate(name: string, uuid: string): void {
    console.log(`SceneName: ${name} SceneUUID: ${uuid}`);
  }
}
