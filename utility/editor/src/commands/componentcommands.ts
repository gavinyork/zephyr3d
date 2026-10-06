import type { SceneNode, SceneNodeComponent, SceneNodeComponentType, Scene } from '@zephyr3d/scene';
import { getEngine } from '@zephyr3d/scene';
import type { Nullable } from '@zephyr3d/base';
import { AABB, Matrix4x4, Vector3 } from '@zephyr3d/base';
import { Collider, PhysicsComponent, RigidBody, Vehicle, Wheel } from '@zephyr3d/physics';
import { Command } from '../core/command';

type ComponentCtor = new () => SceneNodeComponent;

function nodePath(node: SceneNode) {
  const parts: string[] = [];
  const root = node.scene!.rootNode;
  for (let n: Nullable<SceneNode> = node; n && n !== root; n = n.parent) {
    parts.unshift(n.persistentId);
  }
  return parts;
}

function findNode(scene: Scene, path: string[]): Nullable<SceneNode> {
  let node: Nullable<SceneNode> = scene.rootNode;
  for (const id of path) {
    node = node?.children.find((child) => child.persistentId === id) ?? null;
  }
  return node;
}

const PROXY_NODE_NAME = '$__PROXY__$';

/**
 * Bounds of a node and its descendants in the node's own space, or null when
 * nothing in the subtree has bounds. Editor proxies (light and camera icons)
 * are left out.
 */
export function getSubtreeLocalBounds(node: SceneNode): Nullable<AABB> {
  const toLocal = Matrix4x4.invertAffine(node.worldMatrix);
  const bounds = new AABB();
  bounds.beginExtend();
  node.iterate((child) => {
    if (child.name === PROXY_NODE_NAME) {
      return false;
    }
    const bv = child.getBoundingVolume();
    if (bv) {
      const box = bv.transform(Matrix4x4.multiply(toLocal, child.worldMatrix)).toAABB();
      bounds.extend(box.minPoint);
      bounds.extend(box.maxPoint);
    }
    return false;
  });
  return bounds.isValid() ? bounds : null;
}

/** Fits a new box collider around what its node shows. */
function fitCollider(collider: Collider, node: SceneNode) {
  const bounds = getSubtreeLocalBounds(node);
  if (bounds) {
    const size = Vector3.sub(bounds.maxPoint, bounds.minPoint);
    collider.size = new Vector3(Math.max(size.x, 0.01), Math.max(size.y, 0.01), Math.max(size.z, 0.01));
    collider.offset = Vector3.scale(Vector3.add(bounds.minPoint, bounds.maxPoint), 0.5);
  }
}

/** Sizes a new wheel to what its node shows: radius from the bounds' height. */
function fitWheel(wheel: Wheel, node: SceneNode) {
  const bounds = getSubtreeLocalBounds(node);
  if (bounds) {
    const size = Vector3.sub(bounds.maxPoint, bounds.minPoint);
    const radius = Math.max(size.x, size.y, size.z) / 2;
    if (radius > 0.01) {
      wheel.radius = radius;
    }
  }
}

function hasColliderBelow(node: SceneNode) {
  let found = false;
  node.iterate((child) => {
    if (found || child.getComponent(Collider)) {
      found = true;
      return true;
    }
    return false;
  });
  return found;
}

/** Display group of a component type in the Add Component menu. */
export function getComponentCategory(type: { prototype: unknown }): string {
  return type.prototype instanceof PhysicsComponent ? 'Physics' : 'General';
}

/** Component types the Add Component menu offers: registered and serializable. */
export function getAddableComponentTypes(types: readonly SceneNodeComponentType[]) {
  const manager = getEngine().resourceManager;
  return types
    .map((type) => ({ type, cls: manager.getClassByConstructor(type as unknown as ComponentCtor) }))
    .filter((entry) => !!entry.cls)
    .map((entry) => ({ type: entry.type as unknown as ComponentCtor, name: entry.cls!.name }));
}

/**
 * Adds a component to a node, set up for the node where that helps: a collider
 * is fitted around the node's bounds, a rigid body on a node with no collider
 * gets one, so it does not fall through everything, a vehicle gets the rigid
 * body it needs, and a wheel takes its radius from its node.
 */
export class AddComponentCommand extends Command<Nullable<SceneNodeComponent>> {
  private readonly _scene: Scene;
  private readonly _path: string[];
  private readonly _ctor: ComponentCtor;
  /** Components added by the last execute, as indices into the node's list. */
  private _added: { path: string[]; index: number }[];
  constructor(node: SceneNode, ctor: ComponentCtor) {
    super(`Add component`);
    this._scene = node.scene!;
    this._path = nodePath(node);
    this._ctor = ctor;
    this._added = [];
  }
  async execute() {
    this._added = [];
    const node = findNode(this._scene, this._path);
    if (!node) {
      return null;
    }
    const component = new this._ctor();
    if (component instanceof Collider) {
      fitCollider(component, node);
    } else if (component instanceof Wheel) {
      fitWheel(component, node);
    }
    // A vehicle drives a dynamic rigid body on its node.
    const needsBody = component instanceof Vehicle && !node.getComponent(RigidBody);
    const needsCollider = (component instanceof RigidBody || needsBody) && !hasColliderBelow(node);
    if (needsBody) {
      const body = new RigidBody();
      body.mass = 1000;
      this._added.push({ path: this._path, index: node.components.length });
      node.addComponent(body);
    }
    this._added.push({ path: this._path, index: node.components.length });
    node.addComponent(component);
    if (needsCollider) {
      const collider = new Collider();
      fitCollider(collider, node);
      this._added.push({ path: this._path, index: node.components.length });
      node.addComponent(collider);
    }
    return component;
  }
  async undo() {
    for (let i = this._added.length - 1; i >= 0; i--) {
      const { path, index } = this._added[i];
      const node = findNode(this._scene, path);
      const component = node?.components[index];
      if (component) {
        node!.removeComponent(component);
      }
    }
    this._added = [];
  }
}

/** Removes a component; undo restores it with its settings, at the end of the node's list. */
export class RemoveComponentCommand extends Command {
  private readonly _scene: Scene;
  private readonly _path: string[];
  private readonly _index: number;
  private _saved: unknown;
  constructor(node: SceneNode, component: SceneNodeComponent) {
    super(`Remove component`);
    this._scene = node.scene!;
    this._path = nodePath(node);
    this._index = node.components.indexOf(component);
    this._saved = null;
  }
  async execute() {
    const node = findNode(this._scene, this._path);
    const component = node?.components[this._index];
    if (!component) {
      return;
    }
    this._saved = await getEngine().resourceManager.serializeObject(component);
    node!.removeComponent(component);
  }
  async undo() {
    const node = findNode(this._scene, this._path);
    if (!node || !this._saved) {
      return;
    }
    const component = await getEngine().resourceManager.deserializeObject<SceneNodeComponent>(
      node,
      this._saved as Record<string, unknown>
    );
    if (component) {
      node.addComponent(component);
    }
  }
}
