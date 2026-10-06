import { Collider, RigidBody, Scene, SceneNode } from '@zephyr3d/scene';
import * as RAPIER from '@dimforge/rapier3d-simd-compat';
import { initPhysics, PhysicsSimulation, type BackendWorld, type PhysicsBackend } from '@zephyr3d/physics';
import { rapierPhysics } from '@zephyr3d/physics-rapier';
import { addPhysics } from './helpers';

/** A physics engine that hands everything to Rapier, counting what it is asked for. */
function countingEngine() {
  const counts = { init: 0, worlds: 0, bodies: 0, steps: 0 };
  const engine: PhysicsBackend<unknown> = {
    name: 'Counting',
    get ready() {
      return rapierPhysics.ready;
    },
    async init() {
      counts.init++;
      await rapierPhysics.init({ rapier: RAPIER });
    },
    createWorld(): BackendWorld {
      counts.worlds++;
      const world = rapierPhysics.createWorld();
      return new Proxy(world, {
        get(target, prop, receiver) {
          if (prop === 'createBody') {
            counts.bodies++;
          } else if (prop === 'step') {
            counts.steps++;
          }
          const value = Reflect.get(target, prop, receiver);
          return typeof value === 'function' ? value.bind(target) : value;
        }
      });
    }
  };
  return { engine, counts };
}

beforeAll(async () => {
  await RAPIER.init();
});

describe('physics engines', () => {
  it('simulates scenes with the engine given to initPhysics', async () => {
    const { engine, counts } = countingEngine();
    await initPhysics(engine);
    await initPhysics(engine);
    expect(counts.init).toBe(1);
    const scene = new Scene();
    const world = scene.physicsWorld as PhysicsSimulation;
    expect(world).toBeInstanceOf(PhysicsSimulation);
    expect(scene.physicsWorld).toBe(world);
    world.enabled = false;
    const node = new SceneNode(scene);
    node.position.setXYZ(0, 10, 0);
    addPhysics(node, new RigidBody());
    addPhysics(node, new Collider());
    for (let i = 0; i < 30; i++) {
      world.update(1 / 60);
    }
    expect(counts.worlds).toBe(1);
    expect(counts.bodies).toBeGreaterThan(0);
    expect(counts.steps).toBe(30);
    expect(node.getWorldPosition().y).toBeLessThan(10);
  });

  it('creates the world when a node with physics data enters the scene', () => {
    const scene = new Scene();
    const node = new SceneNode(scene);
    node.remove();
    addPhysics(node, new Collider());
    expect(node.physics!.colliders[0].world).toBeNull();
    node.parent = scene.rootNode;
    const collider = node.physics!.colliders[0];
    expect(collider.world).toBe(scene.physicsWorld);
    node.remove();
    expect(collider.world).toBeNull();
  });

  it('moves the physics data to a world given to the scene', () => {
    const scene = new Scene();
    const node = new SceneNode(scene);
    const body = addPhysics(node, new RigidBody());
    const first = scene.physicsWorld!;
    expect(body.world).toBe(first);
    const second = new PhysicsSimulation(scene, rapierPhysics);
    scene.setPhysicsWorld(second);
    expect(first.disposed).toBe(true);
    expect(body.world).toBe(second);
    expect(() => scene.setPhysicsWorld(new PhysicsSimulation(new Scene(), rapierPhysics))).toThrow();
  });

  it('disposes the world with the scene', () => {
    const scene = new Scene();
    const world = scene.physicsWorld!;
    scene.dispose();
    expect(world.disposed).toBe(true);
  });
});
