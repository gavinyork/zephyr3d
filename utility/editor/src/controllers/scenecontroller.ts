import type { AssetRegistry, Scene, SceneNode } from '@zephyr3d/scene';
import {
  BoxShape,
  CylinderShape,
  deserializeObject,
  getSerializationInfo,
  PlaneShape,
  serializeObject,
  SphereShape,
  TorusShape
} from '@zephyr3d/scene';
import { AddParticleSystemCommand, AddShapeCommand, NodeTransformCommand } from '../commands/scenecommands';
import { CommandManager } from '../core/command';
import { eventBus } from '../core/eventbus';
import type { SceneModel } from '../models/scenemodel';
import { BaseController } from './basecontroller';
import type { SceneView } from '../views/sceneview';
import type { TRS } from '../types';
import { Database, type DBSceneInfo } from '../storage/db';
import { Dialog } from '../views/dlg/dlg';

export class SceneController extends BaseController<SceneModel> {
  protected _scene: DBSceneInfo;
  protected _pools: symbol[];
  protected _view: SceneView;
  protected _assetRegistry: AssetRegistry;
  protected _cmdManager: CommandManager;
  constructor(model: SceneModel, view: SceneView, assetRegistry: AssetRegistry) {
    super(model);
    this._view = view;
    this._pools = [];
    this._assetRegistry = assetRegistry;
    this._cmdManager = new CommandManager();
  }
  handleEvent(ev: Event, type?: string): boolean {
    return this._view.handleEvent(ev, type);
  }
  protected onActivate(scene: DBSceneInfo): void {
    this._scene = scene;
    eventBus.on('update', this.update, this);
    eventBus.on('action', this.sceneAction, this);
    eventBus.on('node_transform', this.nodeTransform, this);
    eventBus.on('action_doc_request_save_scene', this.saveScene, this);
    eventBus.on('action_doc_request_open_scene', this.openScene, this);
  }
  protected onDeactivate(): void {
    this._scene = null;
    eventBus.off('update', this.update, this);
    eventBus.off('action', this.sceneAction, this);
    eventBus.off('node_transform', this.nodeTransform, this);
    eventBus.off('action_doc_request_save_scene', this.saveScene, this);
    eventBus.off('action_doc_request_open_scene', this.openScene, this);
  }
  private nodeTransform(node: SceneNode, oldTransform: TRS, newTransform: TRS) {
    this._cmdManager.execute(new NodeTransformCommand(node, oldTransform, newTransform));
  }
  private sceneAction(action: string) {
    switch (action) {
      case 'NEW_DOC':
        this.createScene();
        break;
      case 'SAVE_DOC':
        if (!this._scene) {
          Dialog.saveScene('Input scene name:');
        } else {
          eventBus.dispatchEvent('action_doc_request_save_scene', this._scene.name);
        }
        break;
      case 'OPEN_DOC':
        Database.listScenes().then((scenes) => {
          Dialog.openScene('Select scene:', scenes, 300);
        });
        break;
      case 'UNDO':
        this._cmdManager.undo();
        break;
      case 'REDO':
        this._cmdManager.redo();
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
        const poolId = Symbol();
        this._pools.push(poolId);
        this._cmdManager.execute(
          new AddShapeCommand(this.model.scene, BoxShape, { anchor: 0.5, anchorY: 0 }, poolId)
        );
        break;
      }
      case 'ADD_SPHERE': {
        const poolId = Symbol();
        this._pools.push(poolId);
        this._cmdManager.execute(new AddShapeCommand(this.model.scene, SphereShape, null, poolId));
        break;
      }
      case 'ADD_PLANE': {
        const poolId = Symbol();
        this._pools.push(poolId);
        this._cmdManager.execute(new AddShapeCommand(this.model.scene, PlaneShape, null, poolId));
        break;
      }
      case 'ADD_CYLINDER': {
        const poolId = Symbol();
        this._pools.push(poolId);
        this._cmdManager.execute(
          new AddShapeCommand(this.model.scene, CylinderShape, { topCap: true, bottomCap: true }, poolId)
        );
        break;
      }
      case 'ADD_TORUS': {
        const poolId = Symbol();
        this._pools.push(poolId);
        this._cmdManager.execute(new AddShapeCommand(this.model.scene, TorusShape, null, poolId));
        break;
      }
      case 'ADD_PARTICLE_SYSTEM': {
        const poolId = Symbol();
        this._pools.push(poolId);
        this._cmdManager.execute(new AddParticleSystemCommand(this.model.scene, poolId));
        break;
      }
      default:
        console.log('Unknown action');
        break;
    }
  }
  private update() {
    this.model.camera.updateController();
    this._view.toolbar.selectTool('UNDO', this._cmdManager.canUndo());
    this._view.toolbar.selectTool('REDO', this._cmdManager.canRedo());
  }
  private saveScene(name: string) {
    this._scene = Object.assign({}, this._scene ?? {}, {
      name,
      content: serializeObject(this.model.scene, getSerializationInfo(this._assetRegistry), {})
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
          deserializeObject<Scene>(null, sceneinfo.content, getSerializationInfo(this._assetRegistry)).then(
            (scene) => {
              if (scene) {
                this.model.reset(scene);
                this._view.reset(this.model.scene);
              } else {
                throw new Error('Cannot load scene');
              }
            }
          );
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
    this.model.reset();
    this._view.reset(this.model.scene);
  }
}
