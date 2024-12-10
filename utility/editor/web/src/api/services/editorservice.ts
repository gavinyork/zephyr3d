import type { ApiClient } from '../client/apiclient';
import type { CreateSceneResponse } from '../types/response';

export class EditorApiService {
  private _api: ApiClient;
  constructor(api: ApiClient) {
    this._api = api;
  }
  async createScene(name: string): Promise<CreateSceneResponse> {
    return this._api.post<CreateSceneResponse>('scene', { name });
  }
}
