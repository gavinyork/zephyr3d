import type { SceneNode } from '@zephyr3d/scene';
import { BoxShape, CylinderShape, PlaneShape, SphereShape, TorusShape } from '@zephyr3d/scene';
import { AddShapeCommand, NodeTransformCommand } from '../commands/scenecommands';
import { CommandManager } from '../core/command';
import { eventBus } from '../core/eventbus';
import type { SceneModel } from '../models/scenemodel';
import { BaseController } from './basecontroller';
import type { SceneView } from '../views/sceneview';
import type { TRS } from '../types';
import type { DBSceneInfo } from '../storage/db';

export class SceneController extends BaseController<SceneModel> {
  protected _scene: DBSceneInfo;
  protected _pools: symbol[];
  protected _view: SceneView;
  protected _cmdManager: CommandManager;
  constructor(model: SceneModel, view: SceneView) {
    super(model);
    this._view = view;
    this._pools = [];
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
  }
  protected onDeactivate(): void {
    this._scene = null;
    eventBus.off('update', this.update, this);
    eventBus.off('action', this.sceneAction, this);
    eventBus.off('node_transform', this.nodeTransform, this);
  }
  private nodeTransform(node: SceneNode, oldTransform: TRS, newTransform: TRS) {
    this._cmdManager.execute(new NodeTransformCommand(node, oldTransform, newTransform));
  }
  private sceneAction(action: string) {
    switch (action) {
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
}
