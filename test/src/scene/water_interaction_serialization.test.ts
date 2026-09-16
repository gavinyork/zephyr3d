/**
 * Round trip of the water interaction field and its disturbers through the
 * serialization system.
 *
 * What has to hold: every parameter that shapes the field comes back as it was
 * saved, the disturbers come back in order with their node bindings recorded
 * as persistent ids (the nodes themselves may not exist yet when the field is
 * loaded), and the defaults are what the class documents.
 */

import { MemoryFS, Vector2, Vector3 } from '@zephyr3d/base';
import { ResourceManager } from '../../../libs/scene/src/utility/serialization/manager';
import { WaterDisturber, WaterInteraction } from '../../../libs/scene/src/render/water_interaction';
import type { SceneNode } from '../../../libs/scene/src/scene/scene_node';

/** A node stub with just what the disturber reads from a node. */
function stubNode(id: string): SceneNode {
  return { persistentId: id } as unknown as SceneNode;
}

describe('water interaction serialization', () => {
  test('the field round-trips with its parameters and disturbers', async () => {
    const manager = new ResourceManager(new MemoryFS());
    const interaction = new WaterInteraction();
    interaction.resolution = 256;
    interaction.windowSize = 40;
    interaction.waveSpeed = 1.1;
    interaction.damping = 0.4;
    interaction.maxAmplitude = 0.3;
    interaction.spongeWidth = 0.15;
    interaction.followMode = 'fixed';
    interaction.center = new Vector2(3, -7);
    interaction.foamAmount = 0.5;
    interaction.foamDecay = 1.2;
    interaction.foamThreshold = 0.05;
    const boat = new WaterDisturber(stubNode('node-boat'), 'box');
    boat.size = new Vector3(1.6, 1, 3.6);
    boat.strength = 0.2;
    const piling = new WaterDisturber(null, 'capsule');
    piling.nodeId = 'node-piling';
    piling.radius = 0.35;
    piling.halfLength = 6;
    piling.blocking = true;
    piling.enabled = false;
    interaction.addDisturber(boat);
    interaction.addDisturber(piling);

    const json = await manager.serializeObject(interaction);
    expect(json.ClassName).toBe('WaterInteraction');
    const restored = (await manager.deserializeObject<WaterInteraction>(null, json))!;
    expect(restored).toBeInstanceOf(WaterInteraction);
    expect(restored).not.toBe(interaction);
    expect(restored.resolution).toBe(256);
    expect(restored.windowSize).toBe(40);
    expect(restored.waveSpeed).toBeCloseTo(1.1);
    expect(restored.damping).toBeCloseTo(0.4);
    expect(restored.maxAmplitude).toBeCloseTo(0.3);
    expect(restored.spongeWidth).toBeCloseTo(0.15);
    expect(restored.followMode).toBe('fixed');
    expect(restored.center.x).toBeCloseTo(3);
    expect(restored.center.y).toBeCloseTo(-7);
    expect(restored.foamAmount).toBeCloseTo(0.5);
    expect(restored.foamDecay).toBeCloseTo(1.2);
    expect(restored.foamThreshold).toBeCloseTo(0.05);

    expect(restored.disturbers).toHaveLength(2);
    const [rBoat, rPiling] = restored.disturbers;
    expect(rBoat).toBeInstanceOf(WaterDisturber);
    expect(rBoat.shape).toBe('box');
    // The node comes back as an id to be bound against the scene, not as the object.
    expect(rBoat.node).toBeNull();
    expect(rBoat.nodeId).toBe('node-boat');
    expect(rBoat.size.x).toBeCloseTo(1.6);
    expect(rBoat.size.z).toBeCloseTo(3.6);
    expect(rBoat.strength).toBeCloseTo(0.2);
    expect(rBoat.blocking).toBe(false);
    expect(rBoat.enabled).toBe(true);
    expect(rPiling.shape).toBe('capsule');
    expect(rPiling.nodeId).toBe('node-piling');
    expect(rPiling.radius).toBeCloseTo(0.35);
    expect(rPiling.halfLength).toBeCloseTo(6);
    expect(rPiling.blocking).toBe(true);
    expect(rPiling.enabled).toBe(false);
  });

  test('a default field serializes to defaults and back', async () => {
    const manager = new ResourceManager(new MemoryFS());
    const json = await manager.serializeObject(new WaterInteraction());
    const restored = (await manager.deserializeObject<WaterInteraction>(null, json))!;
    expect(restored.resolution).toBe(512);
    expect(restored.windowSize).toBe(64);
    expect(restored.followMode).toBe('camera');
    expect(restored.foamAmount).toBeCloseTo(0.15);
    expect(restored.disturbers).toHaveLength(0);
  });

  test('node ids bind against a scene on resolve', () => {
    const interaction = new WaterInteraction();
    const d = new WaterDisturber(null);
    d.nodeId = 'a';
    interaction.addDisturber(d);
    interaction.followMode = 'node';
    interaction.followNodeId = 'b';
    const nodes: Record<string, SceneNode> = { a: stubNode('a'), b: stubNode('b') };
    const scene = { findNodeById: (id: string) => nodes[id] ?? null } as never;
    interaction.resolveNodes(scene);
    expect(d.node).toBe(nodes.a);
    expect(interaction.followNode).toBe(nodes.b);
    // Already bound: resolving again leaves it alone.
    d.nodeId = 'b';
    interaction.resolveNodes(scene);
    expect(d.node).toBe(nodes.a);
  });
});
