/**
 * Physics tools of the editor MCP bridge: applying the editor's physics presets to scene nodes
 * (rigid bodies, colliders, characters, vehicle chassis and wheels, joints) and reading back what
 * a node has.
 */
import { NodePhysics, getEngine } from '@zephyr3d/scene';
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

/**
 * Copies scalar/vector properties onto a physics component. Only existing properties are written,
 * so a typo is reported instead of silently ignored.
 */
function applyOverrides(target: object, values: unknown, label: string) {
  if (values === undefined || values === null) {
    return null;
  }
  if (typeof values !== 'object' || Array.isArray(values)) {
    return `\`${label}\` must be an object of property values`;
  }
  for (const [key, value] of Object.entries(values as Record<string, unknown>)) {
    const current = (target as Record<string, unknown>)[key];
    if (current === undefined && !(key in target)) {
      return `${label} has no property "${key}"`;
    }
    try {
      (target as Record<string, unknown>)[key] = value;
    } catch (err) {
      return `${label}.${key}: ${err instanceof Error ? err.message : err}`;
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
  const errors = [
    applyOverrides(scratch.body!, params.body, 'body'),
    applyOverrides(scratch.vehicle!, params.vehicle, 'vehicle'),
    applyOverrides(scratch.wheel!, params.wheel, 'wheel'),
    applyOverrides(scratch.character!, params.character, 'character'),
    applyOverrides(scratch.joint!, params.joint, 'joint')
  ].filter((e): e is string => !!e);
  if (errors.length > 0) {
    return { err: errors.join('; ') };
  }
  await controller.view.cmdManager.execute(
    new ApplyPhysicsPresetCommand(node, {
      label: preset.label,
      description: preset.description,
      apply(target, physics) {
        preset.apply(target, physics);
        applyOverrides(physics.body!, params.body, 'body');
        applyOverrides(physics.vehicle!, params.vehicle, 'vehicle');
        applyOverrides(physics.wheel!, params.wheel, 'wheel');
        applyOverrides(physics.character!, params.character, 'character');
        applyOverrides(physics.joint!, params.joint, 'joint');
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
