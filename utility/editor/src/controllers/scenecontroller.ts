import type { EmbeddedAssetInfo, Scene, SerializationManager } from '@zephyr3d/scene';
import { deserializeObject, OrbitCameraController, serializeObject } from '@zephyr3d/scene';
import { eventBus } from '../core/eventbus';
import type { SceneModel } from '../models/scenemodel';
import { BaseController } from './basecontroller';
import type { SceneView } from '../views/sceneview';
import { Database, type DBSceneInfo } from '../storage/db';
import { Dialog } from '../views/dlg/dlg';
import { ZipDownloader } from '../helpers/zipdownload';
import type { Editor } from '../core/editor';

export class SceneController extends BaseController<SceneModel> {
  protected _editor: Editor;
  protected _scene: DBSceneInfo;
  protected _view: SceneView;
  protected _serializationManager: SerializationManager;
  constructor(
    editor: Editor,
    model: SceneModel,
    view: SceneView,
    serializationManager: SerializationManager
  ) {
    super(model);
    this._editor = editor;
    this._view = view;
    this._serializationManager = serializationManager;
  }
  get editor() {
    return this._editor;
  }
  handleEvent(ev: Event, type?: string): boolean {
    return this._view.handleEvent(ev, type);
  }
  protected onActivate(scene: DBSceneInfo): void {
    this._scene = scene;
    eventBus.on('update', this.update, this);
    eventBus.on('action', this.sceneAction, this);
  }
  protected onDeactivate(): void {
    this._scene = null;
    eventBus.off('update', this.update, this);
    eventBus.off('action', this.sceneAction, this);
  }
  private sceneAction(action: string) {
    switch (action) {
      case 'NEW_DOC':
        this.createScene();
        break;
      case 'SAVE_DOC':
        if (!this._scene) {
          Dialog.promptName('Input scene name:').then((name) => {
            if (name) {
              this.saveScene(name);
            }
          });
        } else {
          this.saveScene(this._scene.name);
        }
        break;
      case 'EXPORT_DOC':
        if (!this._scene) {
          Dialog.promptName('Input scene name:').then((name) => {
            if (name) {
              this.saveScene(name, false);
              this.exportScene(this.model.scene, name);
            }
          });
        } else {
          this.saveScene(this._scene.name, false).then(() => {
            this.exportScene(this.model.scene, this._scene.name);
          });
        }
        break;
      case 'BATCH_EXPORT_DOC':
        Database.listScenes().then((scenes) => {
          Dialog.batchExportScene('Batch export scene', scenes, 300).then((sceneList) => {
            if (sceneList.length > 0) {
              Promise.all(sceneList.map((val) => this.loadScene(val))).then((scenes) => {
                this.batchExportScene(
                  scenes.map((scene, index) => ({ scene: scene, name: sceneList[index].name })),
                  'scenes'
                );
              });
            }
          });
        });
        break;
      case 'OPEN_DOC':
        Database.listScenes().then((scenes) => {
          Dialog.openScene('Select scene:', scenes, 300).then((sceneId) => {
            if (sceneId) {
              this.openScene(sceneId);
            }
          });
        });
        break;
      default:
        console.log('Unknown action');
        break;
    }
  }
  private update(dt: number) {
    this.model.camera.updateController();
    this._view.update(dt);
  }
  private async saveScene(name: string, showMessage = true) {
    const assetList = new Set<string>();
    const embeddedAssetList: Promise<EmbeddedAssetInfo>[] = [];
    this._scene = Object.assign({}, this._scene ?? {}, {
      name,
      content: await serializeObject(
        this.model.scene,
        this._serializationManager.assetRegistry,
        null,
        assetList,
        embeddedAssetList
      ),
      metadata: {
        activeCamera: this.model.camera?.id ?? '',
        activeCameraLookAt:
          this.model.camera?.controller instanceof OrbitCameraController
            ? [...this.model.camera.controller.center]
            : [0, 0, 0]
      }
    });
    console.log(JSON.stringify(this._scene.content, null, 2));
    console.log([...assetList]);
    console.log([...embeddedAssetList]);
    const embeddedAssets = await Promise.all(embeddedAssetList);
    await this._serializationManager.assetRegistry.putEmbeddedAssets(embeddedAssets);
    await Database.putScene(this._scene);
    const uuid = await Database.putScene(this._scene);
    this._scene.uuid = uuid;
    if (showMessage) {
      Dialog.messageBox('Zephyr3d', `Scene saved: ${uuid}`);
    }
  }
  private async batchExportScene(scenes: { scene: Scene; name: string }[], name: string) {
    const assetList = new Set<string>();
    const contents = await Promise.all(
      scenes.map((val) =>
        serializeObject(val.scene, this._serializationManager.assetRegistry, null, assetList)
      )
    );
    const zipDownloader = new ZipDownloader(`${name}.zip`);
    if (assetList.size > 0) {
      await Database.exportAssets(zipDownloader, [...assetList], 'assets');
    }
    for (let i = 0; i < contents.length; i++) {
      const content = contents[i];
      const name = scenes[i].name;
      await zipDownloader.zipWriter.add(
        `scene.${name}.json`,
        new Blob([JSON.stringify(content, null, 2)]).stream()
      );
    }
    await zipDownloader.finish();
  }
  private async exportScene(scene: Scene, name: string) {
    const assetList = new Set<string>();
    const content = await serializeObject(scene, this._serializationManager.assetRegistry, null, assetList);
    content.meta = {
      activeCamera: this.model.camera?.id ?? ''
    };
    const zipDownloader = new ZipDownloader(`${name}.zip`);
    if (assetList.size > 0) {
      await Database.exportAssets(zipDownloader, [...assetList], 'assets');
    }
    await zipDownloader.zipWriter.add(
      `scene.${name}.json`,
      new Blob([JSON.stringify(content, null, 2)]).stream()
    );
    await zipDownloader.finish();
  }
  async loadScene(sceneinfo: DBSceneInfo) {
    return deserializeObject<Scene>(null, sceneinfo.content, this._serializationManager.assetRegistry);
  }
  openScene(uuid: string) {
    Database.getScene(uuid)
      .then((sceneinfo) => {
        if (sceneinfo) {
          this._scene = sceneinfo;
          this.loadScene(sceneinfo).then((scene) => {
            if (scene) {
              const cameraId = sceneinfo.metadata?.activeCamera as string;
              const cameraLookAt = sceneinfo.metadata?.activeCameraLookAt as number[];
              this.reset(scene, cameraId, cameraLookAt);
            } else {
              throw new Error('Cannot load scene');
            }
          });
        } else {
          Dialog.messageBox('Zephyr3d', `Scene not found: ${uuid}`);
        }
      })
      .catch((err) => {
        Dialog.messageBox('Zephyr3d', `Error loading scene: ${err}`);
      });
  }
  createScene() {
    this._scene = null;
    this.reset();
  }
  reset(scene?: Scene, cameraId?: string, cameraLookAt?: number[]) {
    this.model.reset(scene, cameraId, cameraLookAt);
    this._view.reset(this.model.scene);
  }
}
