import type { SceneNode } from '@zephyr3d/scene';
import {
  CharacterController,
  Collider,
  Joint,
  NodePhysics,
  RigidBody,
  Vehicle,
  Wheel,
  type PhysicsPart
} from '@zephyr3d/scene';

/** Puts a physics part in the matching slot of a node's physics data, creating the data if needed. */
export function addPhysics<T extends PhysicsPart>(node: SceneNode, part: T): T {
  if (!node.physics) {
    node.physics = new NodePhysics();
  }
  const physics = node.physics;
  if (part instanceof Collider) {
    physics.addCollider(part);
  } else if (part instanceof RigidBody) {
    physics.body = part;
  } else if (part instanceof CharacterController) {
    physics.character = part;
  } else if (part instanceof Joint) {
    physics.joint = part;
  } else if (part instanceof Vehicle) {
    physics.vehicle = part;
  } else if (part instanceof Wheel) {
    physics.wheel = part;
  }
  return part;
}

/** Takes a physics part off its node and disposes it. */
export function removePhysics(node: SceneNode, part: PhysicsPart) {
  const physics = node.physics;
  if (!physics) {
    return false;
  }
  if (part instanceof Collider) {
    if (!physics.removeCollider(part)) {
      return false;
    }
  } else if (physics.body === part) {
    physics.body = null;
  } else if (physics.character === part) {
    physics.character = null;
  } else if (physics.joint === part) {
    physics.joint = null;
  } else if (physics.vehicle === part) {
    physics.vehicle = null;
  } else if (physics.wheel === part) {
    physics.wheel = null;
  } else {
    return false;
  }
  part.dispose();
  return true;
}

/** The first physics part of a type on a node, or null. */
export function getPhysics<T extends PhysicsPart>(
  node: SceneNode,
  type: abstract new (...args: never[]) => T
): T | null {
  return (node.physics?.parts.find((part) => part instanceof type) as T) ?? null;
}
