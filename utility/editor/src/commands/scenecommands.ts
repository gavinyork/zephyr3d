import type { MeshMaterial, Scene, SceneNode } from '@zephyr3d/scene';
import { getEngine } from '@zephyr3d/scene';
import { ParticleSystem } from '@zephyr3d/scene';
import { Mesh } from '@zephyr3d/scene';
import { Command } from '../core/command';
import { ASSERT, Matrix4x4, Quaternion, Vector3 } from '@zephyr3d/base';
import type { TRS } from '../types';
import { ProjectService } from '../core/services/project';
//import { importModel } from '../loaders/importer';

export type CommandExecuteResult<T> = T extends AddAssetCommand ? SceneNode : void;

function findNodesByPath(parentNode: SceneNode, path: string): SceneNode[] {
  const parts = path.split('/').filter((p) => !!p);
  const result: SceneNode[] = [parentNode];
  while (parts.length > 0) {
    const part = parts.shift();
    for (let i = result.length - 1; i >= 0; i--) {
      const insert = result[i].children
        .filter((node) => node.get().persistentId === part)
        .map((node) => node.get());
      result.splice(i, 1, ...insert);
    }
  }
  return result;
}

function findNodeByPath(parentNode: SceneNode, path: string): SceneNode {
  const result = findNodesByPath(parentNode, path);
  ASSERT(result.length === 1);
  return result[0];
}

function getNodePath(node: SceneNode) {
  ASSERT(node.attached, 'Node must be attached when calculating node path');
  const parts: string[] = [];
  const root = node.scene.rootNode;
  while (node && node !== root) {
    parts.unshift(node.persistentId);
    node = node.parent;
  }
  return parts.join('/');
}

export class AddPrefabCommand extends Command<SceneNode> {
  private readonly _scene: Scene;
  private readonly _prefab: string;
  private _nodeId: string;
  private readonly _position: Vector3;
  constructor(scene: Scene, prefab: string, position: Vector3) {
    super('Add Prefab');
    this._scene = scene;
    this._nodeId = '';
    this._prefab = prefab;
    this._position = new Vector3(position);
  }
  async execute() {
    let prefab: SceneNode = null;
    try {
      prefab = await getEngine().serializationManager.instantiatePrefab(this._scene.rootNode, this._prefab);
    } catch (err) {
      console.error(`Load prefab failed: ${this._prefab}: ${err}`);
    }
    if (prefab) {
      prefab.position.set(this._position);
      if (this._nodeId) {
        // Restore persistent id if redo
        prefab.persistentId = this._nodeId.split('/').at(-1);
      } else {
        this._nodeId = getNodePath(prefab);
      }
      return prefab;
    } else {
      this._nodeId = '';
      return null;
    }
  }
  async undo() {
    if (this._nodeId) {
      const node = findNodeByPath(this._scene.rootNode, this._nodeId);
      node.remove();
    }
  }
}

export class AddAssetCommand extends Command<SceneNode> {
  private readonly _scene: Scene;
  private readonly _asset: string;
  private _nodeId: string;
  private readonly _position: Vector3;
  constructor(scene: Scene, asset: string, position: Vector3) {
    super('Add asset');
    this._scene = scene;
    this._nodeId = '';
    this._asset = asset;
    this._position = new Vector3(position);
  }
  async execute() {
    let asset: SceneNode = null;
    try {
      //const model = await importModel(this._asset);
      //asset = await model.createSceneNode(ProjectService.serializationManager, this._scene, false);
      asset = (await ProjectService.serializationManager.fetchModel(this._asset, this._scene)).group;
    } catch (err) {
      console.error(`Load asset failed: ${this._asset}: ${err}`);
    }
    if (asset) {
      asset.position.set(this._position);
      if (this._nodeId) {
        asset.persistentId = this._nodeId.split('/').at(-1);
      } else {
        this._nodeId = getNodePath(asset);
      }
      return asset;
    } else {
      this._nodeId = '';
      return null;
    }
  }
  async undo() {
    if (this._nodeId) {
      const node = findNodeByPath(this._scene.rootNode, this._nodeId);
      node.remove();
    }
  }
}
export class AddChildCommand<T extends SceneNode = SceneNode> extends Command<T> {
  private readonly _parentId: string;
  private readonly _position: Vector3;
  private readonly _scene: Scene;
  private _nodeId: string;
  private readonly _ctor: { new (scene: Scene): T };
  constructor(parentNode: SceneNode, ctor: { new (scene: Scene): T }, position?: Vector3) {
    super('Add child node');
    this._scene = parentNode.scene;
    this._parentId = getNodePath(parentNode);
    this._nodeId = '';
    this._ctor = ctor;
    this._position = position;
  }
  async execute() {
    const parent = findNodeByPath(this._scene.rootNode, this._parentId);
    if (!parent) {
      console.error('Add batch group failed: parent node not found');
      this._nodeId = '';
      return null;
    }
    const node = new this._ctor(parent.scene);
    node.parent = parent;
    if (this._position) {
      node.position.set(this._position);
    }
    if (this._nodeId) {
      node.persistentId = this._nodeId.split('/').at(-1);
    } else {
      this._nodeId = getNodePath(node);
    }
    return node;
  }
  async undo() {
    if (this._nodeId) {
      const node = findNodeByPath(this._scene.rootNode, this._nodeId);
      node.remove();
    }
  }
}
export class AddParticleSystemCommand extends Command<ParticleSystem> {
  private readonly _scene: Scene;
  private _nodeId: string;
  private readonly _position: Vector3;
  constructor(scene: Scene, pos: Vector3) {
    super('Add particle system');
    this._scene = scene;
    this._nodeId = '';
    this._position = pos.clone();
  }
  async execute() {
    const node = new ParticleSystem(this._scene);
    node.position.set(this._position);
    if (this._nodeId) {
      node.persistentId = this._nodeId.split('/').at(-1);
    } else {
      this._nodeId = getNodePath(node);
    }
    return node;
  }
  async undo() {
    if (this._nodeId) {
      const node = findNodeByPath(this._scene.rootNode, this._nodeId);
      node.remove();
    }
  }
}
export class AddShapeCommand extends Command<Mesh> {
  private readonly _scene: Scene;
  private _nodeId: string;
  private readonly _shapeCls: string;
  private readonly _position: Vector3;
  constructor(scene: Scene, shapeCls: string, pos: Vector3) {
    super();
    this._nodeId = '';
    this._scene = scene;
    this._position = pos.clone();
    this._desc = 'Add shape';
    this._shapeCls = shapeCls;
  }
  async execute() {
    const shape = await getEngine().serializationManager.fetchPrimitive(this._shapeCls);
    const material = await getEngine().serializationManager.fetchMaterial<MeshMaterial>(
      '/assets/@builtins/materials/pbr_metallic_roughness.zmtl'
    );
    const mesh = new Mesh(this._scene, shape, material);
    mesh.position.set(this._position);
    if (this._nodeId) {
      mesh.persistentId = this._nodeId.split('/').at(-1);
    } else {
      this._nodeId = getNodePath(mesh);
    }
    return mesh;
  }
  async undo() {
    if (this._nodeId) {
      const node = findNodeByPath(this._scene.rootNode, this._nodeId);
      node.remove();
    }
  }
}

export class NodeDeleteCommand extends Command {
  private _archive: any;
  private _scene: Scene;
  private readonly _nodeId: string;
  private readonly _parentId: string;
  constructor(node: SceneNode) {
    super('Delete node');
    this._scene = node.scene;
    this._nodeId = getNodePath(node);
    this._parentId = getNodePath(node.parent);
    this._archive = null;
  }
  async execute(): Promise<void> {
    const node = findNodeByPath(this._scene.rootNode, this._nodeId);
    this._archive = await ProjectService.serializationManager.serializeObject(node, null, null);
    node.remove();
  }
  async undo() {
    if (this._archive) {
      const parent = findNodeByPath(this._scene.rootNode, this._parentId);
      const node = await ProjectService.serializationManager.deserializeObject<SceneNode>(
        parent,
        this._archive
      );
      if (node) {
        node.persistentId = this._nodeId.split('/').at(-1);
        node.parent = parent;
      }
    }
  }
}
export class NodeReparentCommand extends Command {
  private readonly _nodeId: string;
  private readonly _newParentId: string;
  private readonly _scene: Scene;
  private _oldParentId: string;
  private _oldLocalMatrix: Matrix4x4;
  constructor(node: SceneNode, newParent: SceneNode) {
    super('Reparent object');
    this._scene = node.scene;
    this._nodeId = getNodePath(node);
    this._newParentId = getNodePath(newParent);
    this._oldParentId = '';
    this._oldLocalMatrix = null;
  }
  async execute(): Promise<void> {
    const node = findNodeByPath(this._scene.rootNode, this._nodeId);
    const newParent = findNodeByPath(this._scene.rootNode, this._newParentId);
    if (node && newParent) {
      this._oldParentId = getNodePath(node.parent);
      this._oldLocalMatrix = new Matrix4x4(node.localMatrix);
      const newLocalMatrix = Matrix4x4.invertAffine(newParent.worldMatrix).multiplyRight(node.worldMatrix);
      newLocalMatrix.decompose(node.scale, node.rotation, node.position);
      node.parent = newParent;
    }
  }
  async undo() {
    const node = findNodeByPath(this._scene.rootNode, this._nodeId);
    const oldParent = findNodeByPath(this._scene.rootNode, this._oldParentId);
    this._oldLocalMatrix.decompose(node.scale, node.rotation, node.position);
    node.parent = oldParent;
  }
}

export class NodeCloneCommand extends Command<SceneNode> {
  private readonly _nodeId: string;
  private readonly _scene: Scene;
  private _newNodeId: string;
  constructor(node: SceneNode) {
    super('Clone node');
    this._scene = node.scene;
    this._nodeId = getNodePath(node);
    this._newNodeId = '';
  }
  async execute(): Promise<SceneNode> {
    const node = findNodeByPath(this._scene.rootNode, this._nodeId);
    const newNode = await node.clone();
    if (newNode) {
      if (this._newNodeId) {
        newNode.persistentId = this._newNodeId.split('/').at(-1);
      } else {
        this._newNodeId = getNodePath(newNode);
      }
    }
    return newNode;
  }
  async undo() {
    if (this._newNodeId) {
      const newNode = findNodeByPath(this._scene.rootNode, this._newNodeId);
      newNode.remove();
    }
  }
}
export class NodeTransformCommand extends Command {
  private readonly _scene: Scene;
  private readonly _nodeId: string;
  private readonly _oldTransform: TRS;
  private readonly _newTransform: TRS;
  constructor(node: SceneNode, oldTransform: TRS, newTransform: TRS, desc: string) {
    super(desc);
    this._scene = node.scene;
    this._nodeId = getNodePath(node);
    this._oldTransform = {
      position: new Vector3(oldTransform.position),
      rotation: new Quaternion(oldTransform.rotation),
      scale: new Vector3(oldTransform.scale)
    };
    this._newTransform = {
      position: new Vector3(newTransform.position),
      rotation: new Quaternion(newTransform.rotation),
      scale: new Vector3(newTransform.scale)
    };
    this._desc = desc;
  }
  get desc(): string {
    return this._desc;
  }
  async execute() {
    const node = findNodeByPath(this._scene.rootNode, this._nodeId);
    node.position = this._newTransform.position;
    node.rotation = this._newTransform.rotation;
    node.scale = this._newTransform.scale;
  }
  async undo() {
    const node = findNodeByPath(this._scene.rootNode, this._nodeId);
    if (node) {
      node.position = this._oldTransform.position;
      node.rotation = this._oldTransform.rotation;
      node.scale = this._oldTransform.scale;
    }
  }
}
