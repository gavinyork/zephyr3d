import type { AssetRegistry, Scene } from '@zephyr3d/scene';
import { deserializeScene, serializeObject, serializeScene } from '@zephyr3d/scene';
import { eventBus } from '../core/eventbus';
import type { SceneModel } from '../models/scenemodel';
import { BaseController } from './basecontroller';
import type { SceneView } from '../views/sceneview';
import { Database, type DBSceneInfo } from '../storage/db';
import { Dialog } from '../views/dlg/dlg';
import { ZipDownloader } from '../helpers/zipdownload';

export class SceneController extends BaseController<SceneModel> {
  protected _scene: DBSceneInfo;
  protected _view: SceneView;
  protected _assetRegistry: AssetRegistry;
  constructor(model: SceneModel, view: SceneView, assetRegistry: AssetRegistry) {
    super(model);
    this._view = view;
    this._assetRegistry = assetRegistry;
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
              this.exportScene(name);
            }
          });
        } else {
          this.saveScene(this._scene.name, false);
          this.exportScene(this._scene.name);
        }
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
  private update() {
    this.model.camera.updateController();
  }
  private saveScene(name: string, showMessage = true) {
    const assetList = new Set<string>();
    this._scene = Object.assign({}, this._scene ?? {}, {
      name,
      content: serializeScene(this.model.scene, this._assetRegistry, assetList), // serializeObject(this.model.scene, this._assetRegistry, {}, assetList),
      metadata: {
        activeCamera: this.model.camera?.id ?? ''
      }
    });
    console.log(JSON.stringify(this._scene.content, null, 2));
    console.log([...assetList]);
    Database.putScene(this._scene).then((uuid) => {
      this._scene.uuid = uuid;
      if (showMessage) {
        Dialog.messageBox('Zephyr3d', `Scene saved: ${uuid}`);
      }
    });
  }
  private async exportScene(name: string) {
    const assetList = new Set<string>();
    this._scene = Object.assign({}, this._scene ?? {}, {
      name,
      content: serializeObject(this.model.scene, this._assetRegistry, {}, assetList),
      metadata: {
        activeCamera: this.model.camera?.id ?? ''
      }
    });
    const zipDownloader = new ZipDownloader(`${name}.zip`);
    if (assetList.size > 0) {
      await Database.exportAssets(zipDownloader, [...assetList], 'assets');
    }
    await zipDownloader.zipWriter.add(
      'scene.json',
      new Blob([JSON.stringify(this._scene.content, null, 2)]).stream()
    );
    await zipDownloader.finish();
  }
  openScene(uuid: string) {
    Database.getScene(uuid)
      .then((sceneinfo) => {
        if (sceneinfo) {
          this._scene = sceneinfo;
          deserializeScene<Scene>(null, this._assetRegistry, sceneinfo.content).then((scene) => {
            //deserializeObject<Scene>(null, sceneinfo.content, this._assetRegistry).then((scene) => {
            if (scene) {
              const cameraId = sceneinfo.metadata?.activeCamera as string;
              this.reset(scene, cameraId);
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
  reset(scene?: Scene, cameraId?: string) {
    this.model.reset(scene, cameraId);
    this._view.reset(this.model.scene);
  }
}
