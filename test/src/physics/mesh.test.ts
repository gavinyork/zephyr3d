import { float2half, Vector3 } from '@zephyr3d/base';
import type { NullDevice } from '@zephyr3d/backend-null';
import { createNullDevice } from '@zephyr3d/backend-null';
import { ClipmapTerrain, Mesh, Primitive, Scene, SceneNode } from '@zephyr3d/scene';
import * as api from '../../../libs/scene/src/app/api';
import * as RAPIER from '@dimforge/rapier3d-simd-compat';
import { Collider, RigidBody } from '@zephyr3d/scene';
import type { PhysicsSimulation } from '@zephyr3d/physics';
import { initPhysics } from '@zephyr3d/physics';
import { rapierPhysics } from '@zephyr3d/physics-rapier';
import { addPhysics, getPhysics } from './helpers';

const DT = 1 / 60;

let device: NullDevice;

beforeAll(async () => {
  await RAPIER.init();
  await initPhysics(rapierPhysics, { rapier: RAPIER });
  device = await createNullDevice();
  jest.spyOn(api, 'getDevice').mockReturnValue(device as any);
});

function makeWorld(scene: Scene) {
  const world = scene.physicsWorld as PhysicsSimulation;
  world.enabled = false;
  world.interpolation = false;
  return world;
}

function run(world: PhysicsSimulation, seconds: number) {
  const frames = Math.round(seconds / DT);
  for (let i = 0; i < frames; i++) {
    world.update(DT);
  }
}

/** A unit cube centred on the origin: 8 vertices, 12 triangles. */
const CUBE_POSITIONS = new Float32Array([
  -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5, -0.5, 0.5, -0.5, -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5,
  0.5, 0.5, -0.5, 0.5, 0.5
]);
const CUBE_INDICES = new Uint32Array([
  0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 3, 6, 2, 3, 7, 6, 0, 4, 7, 0, 7, 3, 1, 2, 6, 1, 6, 5
]);

/** A flat grid of `n` x `n` unit quads on y = 0, centred on the origin. */
function grid(n: number) {
  const positions: number[] = [];
  const indices: number[] = [];
  for (let z = 0; z <= n; z++) {
    for (let x = 0; x <= n; x++) {
      positions.push(x - n / 2, 0, z - n / 2);
    }
  }
  for (let z = 0; z < n; z++) {
    for (let x = 0; x < n; x++) {
      const a = z * (n + 1) + x;
      indices.push(a, a + n + 1, a + 1, a + 1, a + n + 1, a + n + 2);
    }
  }
  return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}

function addMeshCollider(scene: Scene, positions: Float32Array, indices: Uint32Array, shape = 'mesh') {
  const node = new SceneNode(scene);
  const collider = new Collider();
  collider.shape = shape as 'mesh';
  collider.setMeshData(positions, indices);
  addPhysics(node, collider);
  return node;
}

function addBody(scene: Scene, shape: 'box' | 'sphere', position: Vector3) {
  const node = new SceneNode(scene);
  node.position.set(position);
  addPhysics(node, new RigidBody());
  const collider = new Collider();
  collider.shape = shape;
  addPhysics(node, collider);
  return node;
}

/** A cube primitive whose index buffer also holds a coarser level: the top face. */
function cubeWithLod() {
  const primitive = new Primitive();
  primitive.createAndSetVertexBuffer('position_f32x3', CUBE_POSITIONS);
  // LOD 1: the top face (y = +0.5), two triangles, after the cube's 36 indices.
  const top = [3, 7, 6, 3, 6, 2];
  primitive.createAndSetIndexBuffer(new Uint16Array([...CUBE_INDICES, ...top]));
  primitive.primitiveType = 'triangle-list';
  primitive.indexStart = 0;
  primitive.indexCount = 36;
  primitive.lods = [{ indexStart: 36, indexCount: 6, screenSize: 0.1 } as any];
  return primitive;
}

describe('mesh and convex colliders', () => {
  it('lets a ball roll down a mesh ramp', () => {
    const scene = new Scene();
    const world = makeWorld(scene);
    // A slope falling along +X: y = -0.5 x.
    const positions = new Float32Array([-6, 3, -3, 6, -3, -3, 6, -3, 3, -6, 3, 3]);
    addMeshCollider(scene, positions, new Uint32Array([0, 2, 1, 0, 3, 2]));
    const ball = addBody(scene, 'sphere', new Vector3(-4, 2.8, 0));
    run(world, 2);
    const p = ball.getWorldPosition();
    expect(p.x).toBeGreaterThan(0);
    // Still on the ramp: centre half a radius-normal above the surface.
    expect(p.y).toBeCloseTo(-0.5 * p.x + 0.5 * Math.sqrt(1.25), 1);
  });

  it('scales mesh vertices along each axis', () => {
    const scene = new Scene();
    const world = makeWorld(scene);
    const platform = addMeshCollider(scene, CUBE_POSITIONS, CUBE_INDICES);
    platform.scale.setXYZ(8, 0.5, 8);
    const ball = addBody(scene, 'sphere', new Vector3(3, 3, -3));
    run(world, 3);
    // Top of the scaled cube at 0.25, plus the radius.
    expect(ball.getWorldPosition().y).toBeCloseTo(0.75, 2);
  });

  it('slides over a mesh floor without catching on inner edges', () => {
    const scene = new Scene();
    const world = makeWorld(scene);
    const g = grid(20);
    getPhysics(addMeshCollider(scene, g.positions, g.indices), Collider)!.friction = 0;
    const box = addBody(scene, 'box', new Vector3(-8, 0.5, 0.3));
    const body = getPhysics(box, RigidBody)!;
    getPhysics(box, Collider)!.friction = 0;
    run(world, 0.5);
    body.setLinearVelocity(new Vector3(6, 0, 0));
    let maxVy = 0;
    for (let i = 0; i < 90; i++) {
      world.update(DT);
      maxVy = Math.max(maxVy, Math.abs(body.getLinearVelocity().y));
    }
    expect(box.getWorldPosition().x).toBeGreaterThan(0);
    expect(maxVy).toBeLessThan(0.05);
  });

  it('warns once about a mesh collider on a dynamic body, and builds it', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const scene = new Scene();
      const world = makeWorld(scene);
      const node = new SceneNode(scene);
      addPhysics(node, new RigidBody());
      const collider = new Collider();
      collider.shape = 'mesh';
      collider.setMeshData(CUBE_POSITIONS, CUBE_INDICES);
      addPhysics(node, collider);
      world.update(DT);
      collider.friction = 0.2;
      world.update(DT);
      expect(collider.ready).toBe(true);
      expect(warn.mock.calls.filter((c) => String(c[0]).includes('mesh collider')).length).toBe(1);
    } finally {
      warn.mockRestore();
    }
  });

  it('builds a convex hull a dynamic body can rest on', () => {
    const scene = new Scene();
    const world = makeWorld(scene);
    addMeshCollider(scene, CUBE_POSITIONS, CUBE_INDICES).scale.setXYZ(20, 1, 20);
    const rock = new SceneNode(scene);
    rock.position.setXYZ(0, 3, 0);
    addPhysics(rock, new RigidBody());
    const hull = new Collider();
    hull.shape = 'convex';
    // A square pyramid, base down.
    hull.setMeshData(new Float32Array([-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1, 0, 1, 0]));
    addPhysics(rock, hull);
    run(world, 4);
    expect(hull.ready).toBe(true);
    expect(rock.getWorldPosition().y).toBeCloseTo(0.5, 2);
    expect(getPhysics(rock, RigidBody)!.isSleeping).toBe(true);
  });

  it('reports a convex hull that cannot be built', () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const scene = new Scene();
      const world = makeWorld(scene);
      const flat = addMeshCollider(
        scene,
        new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 1]),
        undefined!,
        'convex'
      );
      world.update(DT);
      const collider = getPhysics(flat, Collider)!;
      expect(collider.ready).toBe(false);
      expect(collider.error).toMatch(/convex hull/);
    } finally {
      error.mockRestore();
    }
  });
});

describe('mesh read back', () => {
  it('refuses meshes that change shape', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const scene = new Scene();
      const world = makeWorld(scene);
      const mesh = new Mesh(scene, cubeWithLod());
      jest.spyOn(mesh, 'getMorphData').mockReturnValue({} as any);
      const c = new Collider();
      c.shape = 'mesh';
      addPhysics(mesh, c);
      await world.whenReady();
      expect(c.ready).toBe(false);
      expect(c.error).toMatch(/morph/);
    } finally {
      error.mockRestore();
    }
  });

  it('waits to start until the starting colliders are in', async () => {
    const scene = new Scene();
    const world = makeWorld(scene);
    const ground = new Mesh(scene, cubeWithLod());
    ground.scale.setXYZ(20, 1, 20);
    ground.position.setXYZ(0, -0.5, 0);
    const gc = new Collider();
    gc.shape = 'mesh';
    addPhysics(ground, gc);
    const box = addBody(scene, 'box', new Vector3(0, 2, 0));
    for (let i = 0; i < 5; i++) {
      world.update(DT);
    }
    // Read back still in flight: nothing has moved.
    expect(gc.ready).toBe(false);
    expect(box.getWorldPosition().y).toBe(2);
    await world.whenReady();
    run(world, 2);
    expect(box.getWorldPosition().y).toBeCloseTo(0.5, 2);
  });

  it('starts at once when asked not to wait, holding back only the waiting body', async () => {
    const scene = new Scene();
    const world = makeWorld(scene);
    world.waitForCollidersOnStart = false;
    const free = addBody(scene, 'sphere', new Vector3(5, 10, 0));
    const rock = new Mesh(scene, cubeWithLod());
    rock.position.setXYZ(0, 10, 0);
    addPhysics(rock, new RigidBody());
    const hull = new Collider();
    hull.shape = 'convex';
    addPhysics(rock, hull);
    for (let i = 0; i < 10; i++) {
      world.update(DT);
    }
    expect(free.getWorldPosition().y).toBeLessThan(10);
    expect(rock.getWorldPosition().y).toBe(10);
    await world.whenReady();
    world.update(DT);
    expect(hull.ready).toBe(true);
    world.update(DT);
    expect(rock.getWorldPosition().y).toBeLessThan(10);
  });

  it('gives the same result on every run with a read-back floor', async () => {
    const simulate = async () => {
      const scene = new Scene();
      const world = makeWorld(scene);
      const ground = new Mesh(scene, cubeWithLod());
      ground.scale.setXYZ(20, 1, 20);
      ground.position.setXYZ(0, -0.5, 0);
      const gc = new Collider();
      gc.shape = 'mesh';
      addPhysics(ground, gc);
      const boxes = [0, 1, 2].map((i) => addBody(scene, 'box', new Vector3(i * 0.3, 1 + i * 1.2, 0)));
      // Frames go by while the floor is read back; how many must not matter.
      for (let i = 0; i < 3; i++) {
        world.update(DT);
        await Promise.resolve();
      }
      await world.whenReady();
      run(world, 2);
      return boxes.flatMap((b) => {
        const p = b.getWorldPosition();
        return [p.x, p.y, p.z];
      });
    };
    expect(await simulate()).toEqual(await simulate());
  });
});

describe('terrain collider', () => {
  /** A planar terrain: height = 0.25 x + 0.5 z in texels, so the axes cannot be swapped unnoticed. */
  function planeTerrain(scene: Scene, size: number) {
    const terrain = new ClipmapTerrain(scene, size, size);
    const data = new Uint16Array(size * size);
    for (let z = 0; z < size; z++) {
      for (let x = 0; x < size; x++) {
        data[z * size + x] = float2half(0.25 * x + 0.5 * z);
      }
    }
    (terrain as any).setHeightData(data, size, size);
    return terrain;
  }

  function surfaceY(world: PhysicsSimulation, x: number, z: number) {
    return world.raycast(new Vector3(x, 1000, z), new Vector3(0, -1, 0))?.point.y ?? NaN;
  }

  it('matches the terrain heights where the terrain is drawn', () => {
    const scene = new Scene();
    const world = makeWorld(scene);
    const terrain = planeTerrain(scene, 16);
    terrain.position.setXYZ(10, 1, -5);
    terrain.scale.setXYZ(2, 3, 2);
    addPhysics(terrain, Object.assign(new Collider(), { shape: 'terrain' }));
    world.update(DT);
    expect(getPhysics(terrain, Collider)!.ready).toBe(true);
    // Texel (i, j) is centred at position + (i + 0.5) * cell, cell = 2.
    for (const [i, j] of [
      [3, 7],
      [12, 2],
      [8.5, 9.25]
    ]) {
      const x = 10 + (i + 0.5) * 2;
      const z = -5 + (j + 0.5) * 2;
      expect(surfaceY(world, x, z)).toBeCloseTo(1 + 3 * (0.25 * i + 0.5 * j), 3);
    }
  });

  it('is hit by rays exactly on its grid lines and edges', () => {
    const scene = new Scene();
    const world = makeWorld(scene);
    const terrain = planeTerrain(scene, 16);
    terrain.position.setXYZ(10, 1, -5);
    terrain.scale.setXYZ(2, 3, 2);
    addPhysics(terrain, Object.assign(new Collider(), { shape: 'terrain' }));
    world.update(DT);
    // Sample columns and rows lie on whole numbers here; Rapier alone misses
    // straight-down rays along them (dimforge/rapier#165).
    expect(surfaceY(world, 35, 0)).toBeCloseTo(13, 3);
    expect(surfaceY(world, 27, 13.5)).toBeCloseTo(20.125, 3);
    // The far corner, on the outer edges.
    expect(surfaceY(world, 41, 26)).toBeCloseTo(34.75, 3);
    expect(world.raycastAll(new Vector3(35, 100, 0), new Vector3(0, -1, 0)).length).toBe(1);
  });

  it('rebuilds when the heights change', () => {
    const scene = new Scene();
    const world = makeWorld(scene);
    const terrain = planeTerrain(scene, 8);
    addPhysics(terrain, Object.assign(new Collider(), { shape: 'terrain' }));
    world.update(DT);
    (terrain as any).setHeightData(new Uint16Array(64).fill(float2half(5)), 8, 8);
    world.update(DT);
    world.update(DT);
    expect(surfaceY(world, 3, 3)).toBeCloseTo(5, 3);
  });
});
