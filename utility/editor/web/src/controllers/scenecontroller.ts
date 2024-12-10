import type { ApiClient } from '../api/client/apiclient';
import { SceneApiService } from '../api/services/sceneservcie';
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
    console.log(`SceneName: ${name} SceneUUID: ${uuid}`);
    eventBus.on('update', this.update, this);
  }
  protected onDeactivate(): void {
    eventBus.off('update', this.update, this);
  }
  private update() {
    this.model.camera.updateController();
  }
}
