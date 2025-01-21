import type { AssetRegistry, Scene } from '@zephyr3d/scene';
import {
  BoxShape,
  CylinderShape,
  deserializeObject,
  PlaneShape,
  serializeObject,
  SphereShape,
  TorusShape
} from '@zephyr3d/scene';
import { AddBatchGroupCommand, AddParticleSystemCommand, AddShapeCommand } from '../commands/scenecommands';
import { eventBus } from '../core/eventbus';
import type { SceneModel } from '../models/scenemodel';
import { BaseController } from './basecontroller';
import type { SceneView } from '../views/sceneview';
import { Database, type DBSceneInfo } from '../storage/db';
import { Dialog } from '../views/dlg/dlg';

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
      case 'OPEN_DOC':
        Database.listScenes().then((scenes) => {
          Dialog.openScene('Select scene:', scenes, 300).then((sceneId) => {
            if (sceneId) {
              this.openScene(sceneId);
            }
          });
        });
        break;
      case 'ADD_BOX': {
        this._view.cmdManager.execute(
          new AddShapeCommand(this.model.scene, BoxShape, { anchor: 0.5, anchorY: 0 })
        );
        break;
      }
      case 'ADD_SPHERE': {
        this._view.cmdManager.execute(new AddShapeCommand(this.model.scene, SphereShape, null));
        break;
      }
      case 'ADD_PLANE': {
        this._view.cmdManager.execute(new AddShapeCommand(this.model.scene, PlaneShape, null));
        break;
      }
      case 'ADD_CYLINDER': {
        this._view.cmdManager.execute(
          new AddShapeCommand(this.model.scene, CylinderShape, { topCap: true, bottomCap: true })
        );
        break;
      }
      case 'ADD_TORUS': {
        this._view.cmdManager.execute(new AddShapeCommand(this.model.scene, TorusShape, null));
        break;
      }
      case 'ADD_PARTICLE_SYSTEM': {
        this._view.cmdManager.execute(new AddParticleSystemCommand(this.model.scene));
        break;
      }
      case 'ADD_BATCH_GROUP': {
        this._view.cmdManager.execute(new AddBatchGroupCommand(this.model.scene));
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
  private saveScene(name: string) {
    this._scene = Object.assign({}, this._scene ?? {}, {
      name,
      content: serializeObject(this.model.scene, this._assetRegistry, {}),
      metadata: {
        activeCamera: this.model.camera?.id ?? ''
      }
    });
    console.log(JSON.stringify(this._scene.content, null, 2));
    Database.putScene(this._scene).then((uuid) => {
      this._scene.uuid = uuid;
      Dialog.messageBox('Zephyr3d', `Scene saved: ${uuid}`);
    });
  }
  openScene(uuid: string) {
    Database.getScene(uuid)
      .then((sceneinfo) => {
        if (sceneinfo) {
          this._scene = sceneinfo;
          deserializeObject<Scene>(null, sceneinfo.content, this._assetRegistry).then((scene) => {
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
