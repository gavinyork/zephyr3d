import { float2half, Vector3 } from '@zephyr3d/base';
import type { NullDevice } from '@zephyr3d/backend-null';
import { createNullDevice } from '@zephyr3d/backend-null';
import { ClipmapTerrain, Scene, SceneNode } from '@zephyr3d/scene';
import * as api from '../../../libs/scene/src/app/api';
import * as RAPIER from '@dimforge/rapier3d-simd-compat';
import { Collider, type ColliderOutline } from '@zephyr3d/scene';
import type { PhysicsSimulation } from '@zephyr3d/physics';
import { initPhysics } from '@zephyr3d/physics';
import { rapierPhysics } from '@zephyr3d/physics-rapier';
import { addPhysics } from './helpers';

let device: NullDevice;

beforeAll(async () => {
  await RAPIER.init();
  await initPhysics(rapierPhysics, { rapier: RAPIER });
  device = await createNullDevice();
  jest.spyOn(api, 'getDevice').mockReturnValue(device as any);
});

/** Outline points in world space. */
function worldPoints(node: SceneNode, outline: ColliderOutline) {
  const m = node.worldMatrix.clone().multiplyRight(outline.transform);
  const points: Vector3[] = [];
  for (let i = 0; i < outline.segments.length; i += 3) {
    const p = new Vector3(outline.segments[i], outline.segments[i + 1], outline.segments[i + 2]);
    points.push(m.transformPointAffine(p, new Vector3()));
  }
  return points;
}

function addCollider(scene: Scene, setup: (c: Collider) => void) {
  const node = new SceneNode(scene);
  const collider = new Collider();
  setup(collider);
  addPhysics(node, collider);
  return { node, collider };
}

describe('collider outline', () => {
  it('traces a scaled, offset, turned box', async () => {
    const scene = new Scene();
    const { node, collider } = addCollider(scene, (c) => {
      c.size = new Vector3(1, 2, 3);
      c.offset = new Vector3(0, 1, 0);
    });
    node.position.setXYZ(5, 0, 0);
    node.scale.setXYZ(2, 2, 2);
    const outline = (await collider.node!.scene!.physicsWorld!.getColliderOutline(collider))!;
    expect(outline.segments.length).toBe(12 * 6);
    const points = worldPoints(node, outline);
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const zs = points.map((p) => p.z);
    expect(Math.min(...xs)).toBeCloseTo(4, 4);
    expect(Math.max(...xs)).toBeCloseTo(6, 4);
    // Offset (0, 1, 0) in node space is 2 up at scale 2; half height 2.
    expect(Math.min(...ys)).toBeCloseTo(0, 4);
    expect(Math.max(...ys)).toBeCloseTo(4, 4);
    expect(Math.max(...zs)).toBeCloseTo(3, 4);
  });

  it('keeps its key while the node moves, and changes it with the scale and settings', () => {
    const scene = new Scene();
    const { node, collider } = addCollider(scene, () => undefined);
    const key = collider.node!.scene!.physicsWorld!.getColliderOutlineKey(collider);
    node.position.setXYZ(1, 2, 3);
    node.rotation.fromEulerAngle(0.3, 0.2, 0.1);
    expect(collider.node!.scene!.physicsWorld!.getColliderOutlineKey(collider)).toBe(key);
    node.scale.setXYZ(1, 2, 1);
    const scaledKey = collider.node!.scene!.physicsWorld!.getColliderOutlineKey(collider);
    expect(scaledKey).not.toBe(key);
    collider.size = new Vector3(2, 2, 2);
    expect(collider.node!.scene!.physicsWorld!.getColliderOutlineKey(collider)).not.toBe(scaledKey);
  });

  it('draws spheres, capsules and cylinders within their bounds', async () => {
    const scene = new Scene();
    for (const shape of ['sphere', 'capsule', 'cylinder'] as const) {
      const { node, collider } = addCollider(scene, (c) => {
        c.shape = shape;
        c.radius = 0.5;
        c.height = 3;
      });
      const points = worldPoints(
        node,
        (await collider.node!.scene!.physicsWorld!.getColliderOutline(collider))!
      );
      const ys = points.map((p) => p.y);
      const r = Math.max(...points.map((p) => Math.hypot(p.x, p.z)));
      expect(r).toBeCloseTo(0.5, 4);
      expect(Math.max(...ys)).toBeCloseTo(shape === 'sphere' ? 0.5 : 1.5, 4);
      expect(Math.min(...ys)).toBeCloseTo(shape === 'sphere' ? -0.5 : -1.5, 4);
    }
  });

  it('draws the convex hull the physics engine computes', async () => {
    const scene = new Scene();
    // A cube's corners plus points inside it, which the hull leaves out.
    const points: number[] = [];
    for (let i = 0; i < 8; i++) {
      points.push(i & 1 ? 1 : -1, i & 2 ? 1 : -1, i & 4 ? 1 : -1);
    }
    points.push(0, 0, 0, 0.5, 0.2, -0.3);
    const { node, collider } = addCollider(scene, (c) => {
      c.shape = 'convex';
      c.setMeshData(new Float32Array(points));
    });
    const outline = worldPoints(
      node,
      (await collider.node!.scene!.physicsWorld!.getColliderOutline(collider))!
    );
    for (const p of outline) {
      expect(Math.abs(p.x)).toBeCloseTo(1, 4);
      expect(Math.abs(p.y)).toBeCloseTo(1, 4);
      expect(Math.abs(p.z)).toBeCloseTo(1, 4);
    }
    // 12 cube edges plus one diagonal per triangulated face.
    expect(outline.length / 2).toBe(18);
  });

  it('draws each mesh edge once', async () => {
    const scene = new Scene();
    const { node, collider } = addCollider(scene, (c) => {
      c.shape = 'mesh';
      c.setMeshData(
        new Float32Array([0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1]),
        new Uint32Array([0, 1, 2, 0, 2, 3])
      );
    });
    const outline = worldPoints(
      node,
      (await collider.node!.scene!.physicsWorld!.getColliderOutline(collider))!
    );
    expect(outline.length / 2).toBe(5);
  });

  it('reports why a shape cannot be built', async () => {
    const scene = new Scene();
    const { collider } = addCollider(scene, (c) => {
      c.shape = 'convex';
      c.setMeshData(new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 1]));
    });
    await expect(collider.node!.scene!.physicsWorld!.getColliderOutline(collider)).rejects.toThrow(
      /convex hull/
    );
  });

  it('puts terrain lines on the surface the simulation collides with', async () => {
    const scene = new Scene();
    const world = scene.physicsWorld as PhysicsSimulation;
    world.enabled = false;
    const size = 17;
    const terrain = new ClipmapTerrain(scene, size, size);
    const data = new Uint16Array(size * size);
    for (let z = 0; z < size; z++) {
      for (let x = 0; x < size; x++) {
        data[z * size + x] = float2half(0.25 * x + 0.5 * z + ((x * z) % 3) * 0.1);
      }
    }
    (terrain as any).setHeightData(data, size, size);
    terrain.position.setXYZ(10, 1, -5);
    terrain.scale.setXYZ(2, 3, 2);
    const collider = Object.assign(new Collider(), { shape: 'terrain' as const, terrainResolution: 2 });
    addPhysics(terrain, collider);
    world.update(1 / 60);
    const points = worldPoints(
      terrain,
      (await collider.node!.scene!.physicsWorld!.getColliderOutline(collider))!
    );
    // Every 2nd texel is sampled: 9 x 9 samples, all rows and columns drawn.
    expect(points.length / 2).toBe(2 * 9 * 8);
    for (let i = 0; i < points.length; i += 7) {
      const p = points[i];
      // Nudged inside, where a ray down hits the surface the outline traces.
      const x = Math.min(Math.max(p.x, 11.01), 42.99);
      const z = Math.min(Math.max(p.z, -3.99), 27.99);
      const hit = world.raycast(new Vector3(x, 1000, z), new Vector3(0, -1, 0));
      if (Math.abs(x - p.x) < 1e-6 && Math.abs(z - p.z) < 1e-6) {
        expect(hit!.point.y).toBeCloseTo(p.y, 3);
      }
    }
  });
});
