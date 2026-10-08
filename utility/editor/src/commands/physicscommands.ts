import type { SceneNode, Scene } from '@zephyr3d/scene';
import {
  CharacterController,
  Collider,
  getEngine,
  Joint,
  NodePhysics,
  RigidBody,
  Vehicle,
  Wheel
} from '@zephyr3d/scene';
import type { Nullable } from '@zephyr3d/base';
import { AABB, Matrix4x4, Vector3 } from '@zephyr3d/base';
import { Command } from '../core/command';

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

/** A box collider fitted around what its node shows. */
function fittedCollider(node: SceneNode) {
  return colliderAround(getSubtreeLocalBounds(node));
}

/**
 * A box collider fitted around a vehicle chassis: around what the node itself
 * shows, if anything, not its subtree. The wheels below it are rays; a box
 * around them would rest on the ground with them and drag the car to a stop.
 */
function fittedChassisCollider(node: SceneNode) {
  const own = node.getBoundingVolume()?.toAABB();
  return own?.isValid() ? colliderAround(own) : fittedCollider(node);
}

/** A box collider spanning `bounds`, in its node's space; the default box if null. */
function colliderAround(bounds: Nullable<AABB>) {
  const collider = new Collider();
  if (bounds) {
    const size = Vector3.sub(bounds.maxPoint, bounds.minPoint);
    collider.size = new Vector3(Math.max(size.x, 0.01), Math.max(size.y, 0.01), Math.max(size.z, 0.01));
    collider.offset = Vector3.scale(Vector3.add(bounds.minPoint, bounds.maxPoint), 0.5);
  }
  return collider;
}

/**
 * A wheel sized to what its node shows: radius from the bounds' largest extent.
 * The radius is in metres, so the node's world scale is applied to its local bounds.
 */
function fittedWheel(node: SceneNode) {
  const wheel = new Wheel();
  const bounds = getSubtreeLocalBounds(node);
  if (bounds) {
    const size = Vector3.sub(bounds.maxPoint, bounds.minPoint);
    const scale = new Vector3();
    node.worldMatrix.decompose(scale, null, null);
    const radius =
      Math.max(size.x * Math.abs(scale.x), size.y * Math.abs(scale.y), size.z * Math.abs(scale.z)) / 2;
    if (radius > 0.01) {
      wheel.radius = radius;
    }
  }
  // Front or rear of the vehicle above: front wheels steer, rear wheels drive
  // (half the engine force each, as for a rear wheel drive car) and hold the handbrake
  const along = alongVehicleForward(node);
  if (along > 0) {
    wheel.steer = 1;
  } else if (along < 0) {
    wheel.drive = 0.5;
    wheel.handbrake = 1;
  }
  return wheel;
}

/**
 * How far a wheel node sits ahead of the centre of the vehicle chassis above it,
 * along the vehicle's forward axis; 0 if there is no vehicle above.
 */
function alongVehicleForward(node: SceneNode) {
  let chassis = node.parent;
  while (chassis && !chassis.physics?.vehicle) {
    chassis = chassis.parent;
  }
  const vehicle = chassis?.physics?.vehicle;
  if (!chassis || !vehicle) {
    return 0;
  }
  const local = Matrix4x4.invertAffine(chassis.worldMatrix).transformPointAffine(
    node.getWorldPosition(),
    new Vector3()
  );
  switch (vehicle.forward) {
    case '+x':
      return local.x;
    case '-x':
      return -local.x;
    case '-z':
      return -local.z;
    default:
      return local.z;
  }
}

/**
 * A character controller fitted to what its node shows. Its capsule stands on
 * the node's origin and its size is in the node's units, so the local bounds
 * give it directly: height from the origin to the top, radius from the widest
 * horizontal extent.
 */
function fittedCharacter(node: SceneNode) {
  const character = new CharacterController();
  const bounds = getSubtreeLocalBounds(node);
  if (bounds && bounds.maxPoint.y > 0.01) {
    const height = bounds.maxPoint.y;
    const size = Vector3.sub(bounds.maxPoint, bounds.minPoint);
    const radius = Math.min(Math.max(size.x, size.z) / 2, height / 2);
    if (radius > 0.01) {
      character.height = height;
      character.radius = radius;
    }
  }
  return character;
}

function hasColliderBelow(node: SceneNode) {
  let found = false;
  node.iterate((child) => {
    if (found || (child.physics?.colliders.length ?? 0) > 0) {
      found = true;
      return true;
    }
    return false;
  });
  return found;
}

/**
 * A ready-made set of physics data the editor offers for a node. Each adds to
 * what the node has, replacing only the slot it fills.
 */
export interface PhysicsPreset {
  /** Menu label. */
  label: string;
  /** Tooltip. */
  description: string;
  apply(node: SceneNode, physics: NodePhysics): void;
}

/** A rigid body of a kind, with a collider fitted to the node if nothing below has one. */
function bodyPreset(label: string, description: string, motionType: 'dynamic' | 'kinematic'): PhysicsPreset {
  return {
    label,
    description,
    apply(node, physics) {
      const body = new RigidBody();
      body.motionType = motionType;
      physics.body = body;
      if (!hasColliderBelow(node)) {
        physics.addCollider(fittedCollider(node));
      }
    }
  };
}

/** The presets of the Add Physics menu, in menu order. */
export const PHYSICS_PRESETS: readonly PhysicsPreset[] = [
  {
    label: 'Static Collider',
    description: 'A box around the object that others bump into; it never moves',
    apply(node, physics) {
      physics.addCollider(fittedCollider(node));
    }
  },
  bodyPreset(
    'Dynamic Body',
    'Falls, collides and gets pushed around, with a box around the object',
    'dynamic'
  ),
  bodyPreset(
    'Kinematic Body',
    'Follows its animation or script and pushes others aside, with a box around the object',
    'kinematic'
  ),
  {
    label: 'Trigger Zone',
    description: 'A box around the object that reports what enters and leaves it, without blocking',
    apply(node, physics) {
      const collider = fittedCollider(node);
      collider.isTrigger = true;
      physics.addCollider(collider);
    }
  },
  {
    label: 'Character',
    description:
      'A capsule standing on the object origin, sized to the object, that walks, climbs steps and slides along walls, moved by a script',
    apply(node, physics) {
      physics.character = fittedCharacter(node);
    }
  },
  {
    label: 'Vehicle Chassis',
    description: 'A heavy dynamic body driven as a vehicle; add Wheel to nodes below it',
    apply(node, physics) {
      if (!physics.body || physics.body.motionType !== 'dynamic') {
        const body = new RigidBody();
        body.mass = 1000;
        physics.body = body;
      }
      if (!hasColliderBelow(node)) {
        physics.addCollider(fittedChassisCollider(node));
      }
      physics.vehicle = new Vehicle();
    }
  },
  {
    label: 'Wheel',
    description:
      'A wheel of the vehicle above, sized to the object; a front wheel steers, a rear wheel drives and holds the handbrake',
    apply(node, physics) {
      physics.wheel = fittedWheel(node);
    }
  },
  {
    label: 'Hinge Joint',
    description: 'Lets the rigid body here or above turn about an axis, like a door or a lever',
    apply(_node, physics) {
      const joint = new Joint();
      joint.type = 'hinge';
      physics.joint = joint;
    }
  }
];

/**
 * Replaces a node's physics data, keeping what it had for undo. The change
 * itself is made by `change`, on fresh data each time it is run.
 */
abstract class PhysicsDataCommand extends Command {
  private readonly _scene: Scene;
  private readonly _path: string[];
  private _saved: Nullable<Record<string, unknown>>;
  private _hadData: boolean;
  constructor(desc: string, node: SceneNode) {
    super(desc);
    this._scene = node.scene!;
    this._path = nodePath(node);
    this._saved = null;
    this._hadData = false;
  }
  async execute() {
    const node = findNode(this._scene, this._path);
    if (!node) {
      return;
    }
    this._hadData = !!node.physics;
    this._saved = node.physics
      ? ((await getEngine().resourceManager.serializeObject(node.physics)) as Record<string, unknown>)
      : null;
    this.change(node);
  }
  async undo() {
    const node = findNode(this._scene, this._path);
    if (!node) {
      return;
    }
    node.physics =
      this._hadData && this._saved
        ? await getEngine().resourceManager.deserializeObject<NodePhysics>(node, this._saved)
        : null;
  }
  protected abstract change(node: SceneNode): void;
}

/** Applies a preset; see {@link PHYSICS_PRESETS}. */
export class ApplyPhysicsPresetCommand extends PhysicsDataCommand {
  private readonly _preset: PhysicsPreset;
  constructor(node: SceneNode, preset: PhysicsPreset) {
    super(`Add physics: ${preset.label}`, node);
    this._preset = preset;
  }
  protected change(node: SceneNode) {
    if (!node.physics) {
      node.physics = new NodePhysics();
    }
    this._preset.apply(node, node.physics);
  }
}

/** Takes all physics data off a node. */
export class RemovePhysicsCommand extends PhysicsDataCommand {
  constructor(node: SceneNode) {
    super('Remove physics', node);
  }
  protected change(node: SceneNode) {
    node.physics = null;
  }
}
