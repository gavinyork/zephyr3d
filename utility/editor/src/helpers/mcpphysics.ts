/**
 * Physics tools of the editor MCP bridge: applying the editor's physics presets to scene nodes
 * (rigid bodies, colliders, characters, vehicle chassis and wheels, joints) and reading back what
 * a node has.
 */
import { NodePhysics, getEngine } from '@zephyr3d/scene';
import { Quaternion, Vector3 } from '@zephyr3d/base';
import type { SceneController } from '../controllers/scenecontroller';
import {
  ApplyPhysicsPresetCommand,
  PHYSICS_PRESETS,
  RemovePhysicsCommand
} from '../commands/physicscommands';
import { eventBus } from '../core/eventbus';

/** Stable key of a preset, from its menu label: "Vehicle Chassis" -> "vehicle_chassis" */
function presetKey(label: string) {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function findNode(controller: SceneController | null, id: unknown) {
  const scene = controller?.model?.scene ?? null;
  if (!scene) {
    return { node: null, err: 'No scene is currently opened' };
  }
  const nodeId = typeof id === 'string' ? id.trim() : '';
  if (!nodeId) {
    return { node: null, err: 'Pass `node_id`, the persistent id of a scene node' };
  }
  const node = scene.findNodeById(nodeId);
  if (!node) {
    return { node: null, err: `Node not found in current scene: ${nodeId}` };
  }
  return { node, err: null };
}

/** All presets the editor offers, in menu order */
export function listPhysicsPresets() {
  return {
    presets: PHYSICS_PRESETS.map((preset) => ({
      preset: presetKey(preset.label),
      label: preset.label,
      description: preset.description
    })),
    err: null
  };
}

/** `max_engine_force` and `maxEngineForce` both name the same property */
function toCamelCase(key: string) {
  return key.replace(/_+([a-z0-9])/g, (_m, c: string) => c.toUpperCase());
}

/**
 * Copies properties onto a physics component, e.g. `{ radius: 0.35 }` onto a wheel.
 *
 * Property names are taken as written or in camel case, so `max_engine_force` and
 * `maxEngineForce` both work. Vectors are given as number arrays. An unknown name is reported
 * rather than silently ignored.
 */
function applyOverrides(target: object | null | undefined, values: unknown, label: string) {
  if (values === undefined || values === null) {
    return null;
  }
  if (!target) {
    return `\`${label}\` was given but the preset has no ${label}`;
  }
  if (typeof values !== 'object' || Array.isArray(values)) {
    return `\`${label}\` must be an object of property values`;
  }
  for (const [rawKey, value] of Object.entries(values as Record<string, unknown>)) {
    const key = rawKey in target ? rawKey : toCamelCase(rawKey);
    if (!(key in target)) {
      return `${label} has no property "${rawKey}"`;
    }
    const current = (target as Record<string, unknown>)[key];
    try {
      if (current instanceof Vector3) {
        if (!Array.isArray(value) || value.length !== 3 || value.some((v) => typeof v !== 'number')) {
          return `${label}.${key} must be an array of 3 numbers`;
        }
        (target as Record<string, unknown>)[key] = new Vector3(value[0], value[1], value[2]);
      } else if (current instanceof Quaternion) {
        if (!Array.isArray(value) || value.length !== 4 || value.some((v) => typeof v !== 'number')) {
          return `${label}.${key} must be an array of 4 numbers`;
        }
        (target as Record<string, unknown>)[key] = new Quaternion(value[0], value[1], value[2], value[3]);
      } else {
        (target as Record<string, unknown>)[key] = value;
      }
    } catch (err) {
      return `${label}.${key}: ${err instanceof Error ? err.message : err}`;
    }
  }
  return null;
}

/** Every property group a preset can produce, with the argument each expects */
const OVERRIDE_GROUPS: readonly [string, string][] = [
  ['body', 'RigidBody'],
  ['vehicle', 'Vehicle'],
  ['wheel', 'Wheel'],
  ['character', 'CharacterController'],
  ['joint', 'Joint']
];

/** Applies every override group of a call. Returns the first error, or null. */
function applyAllOverrides(physics: NodePhysics, params: any) {
  const get = (name: string) =>
    ({
      body: physics.body,
      vehicle: physics.vehicle,
      wheel: physics.wheel,
      character: physics.character,
      joint: physics.joint
    })[name];
  for (const [name] of OVERRIDE_GROUPS) {
    if (params[name] === undefined || params[name] === null) {
      continue;
    }
    const err = applyOverrides(get(name) ?? null, params[name], name);
    if (err) {
      return err;
    }
  }
  // Colliders are a list; the overrides apply to each one the preset fitted
  if (params.collider !== undefined && params.collider !== null) {
    if (physics.colliders.length === 0) {
      return '`collider` was given but the preset has no collider';
    }
    for (const collider of physics.colliders) {
      const err = applyOverrides(collider, params.collider, 'collider');
      if (err) {
        return err;
      }
    }
  }
  return null;
}

export async function getNodePhysics(controller: SceneController | null, params: any) {
  const { node, err } = findNode(controller, params.node_id);
  if (!node) {
    return { physics: null, err };
  }
  if (!node.physics) {
    return { physics: null, err: null };
  }
  const data = await getEngine().resourceManager.serializeObject(node.physics);
  const components: string[] = [];
  if (node.physics.body) {
    components.push('body');
  }
  if (node.physics.colliders.length > 0) {
    components.push('collider');
  }
  if (node.physics.character) {
    components.push('character');
  }
  if (node.physics.vehicle) {
    components.push('vehicle');
  }
  if (node.physics.wheel) {
    components.push('wheel');
  }
  if (node.physics.joint) {
    components.push('joint');
  }
  return {
    physics: {
      components,
      body_motion_type: node.physics.body?.motionType ?? null,
      error: node.physics.error ?? '',
      data
    },
    err: null
  };
}

export async function setNodePhysics(controller: SceneController | null, params: any) {
  const { node, err } = findNode(controller, params.node_id);
  if (!node || !controller) {
    return { err };
  }
  const key = String(params.preset ?? '')
    .trim()
    .toLowerCase();
  if (!key) {
    return { err: 'Pass `preset`, one of the keys from physics_list_presets' };
  }
  const preset = PHYSICS_PRESETS.find((p) => presetKey(p.label) === key);
  if (!preset) {
    return {
      err: `Unknown preset "${params.preset}". Available: ${PHYSICS_PRESETS.map((p) => presetKey(p.label)).join(', ')}`
    };
  }
  // Overrides are validated against the preset's own result, so apply the preset to a scratch
  // NodePhysics first and reject the call before the scene is touched
  const scratch = new NodePhysics();
  preset.apply(node, scratch);
  const invalid = applyAllOverrides(scratch, params);
  if (invalid) {
    return { err: invalid };
  }
  await controller.view.cmdManager.execute(
    new ApplyPhysicsPresetCommand(node, {
      label: preset.label,
      description: preset.description,
      apply(target, physics) {
        preset.apply(target, physics);
        applyAllOverrides(physics, params);
      }
    })
  );
  eventBus.dispatchEvent('scene_changed');
  eventBus.dispatchEvent('refresh_properties');
  const applied = node.physics;
  return {
    preset: key,
    components: {
      body: applied?.body?.motionType ?? null,
      colliders: applied?.colliders.length ?? 0,
      character: !!applied?.character,
      vehicle: !!applied?.vehicle,
      wheel: !!applied?.wheel,
      joint: !!applied?.joint
    },
    error: applied?.error ?? '',
    err: null
  };
}

export async function removeNodePhysics(controller: SceneController | null, params: any) {
  const { node, err } = findNode(controller, params.node_id);
  if (!node || !controller) {
    return { err };
  }
  if (!node.physics) {
    return { err: null };
  }
  await controller.view.cmdManager.execute(new RemovePhysicsCommand(node));
  eventBus.dispatchEvent('scene_changed');
  eventBus.dispatchEvent('refresh_properties');
  return { err: null };
}
