import { Quaternion, Vector3 } from '@zephyr3d/base';
import { MemoryFS } from '@zephyr3d/base';
import { ResourceManager, Scene, SceneNode } from '@zephyr3d/scene';
import * as RAPIER from '@dimforge/rapier3d-simd-compat';
import { Collider, type ColliderShape, RigidBody } from '@zephyr3d/scene';
import type { PhysicsSimulation } from '@zephyr3d/physics';
import { initPhysics } from '@zephyr3d/physics';
import { rapierPhysics } from '@zephyr3d/physics-rapier';
import { addPhysics, getPhysics, removePhysics } from './helpers';

const DT = 1 / 60;

beforeAll(async () => {
  // The compat build inlines the WebAssembly, so nothing is fetched.
  await RAPIER.init();
  await initPhysics(rapierPhysics, { rapier: RAPIER });
});

function makeWorld(scene: Scene) {
  const world = scene.physicsWorld as PhysicsSimulation;
  world.enabled = false;
  return world;
}

function run(world: PhysicsSimulation, seconds: number) {
  const frames = Math.round(seconds / DT);
  for (let i = 0; i < frames; i++) {
    world.update(DT);
  }
}

function addGround(scene: Scene, y = 0) {
  const ground = new SceneNode(scene);
  ground.position.setXYZ(0, y - 0.5, 0);
  const collider = new Collider();
  collider.size = new Vector3(40, 1, 40);
  addPhysics(ground, collider);
  return ground;
}

function addBody(scene: Scene, shape: ColliderShape, position: Vector3, parent?: SceneNode) {
  const node = new SceneNode(scene);
  if (parent) {
    node.parent = parent;
  }
  node.position.set(position);
  addPhysics(node, new RigidBody());
  const collider = new Collider();
  collider.shape = shape;
  addPhysics(node, collider);
  return node;
}

describe('physics', () => {
  it('lets a body fall freely under gravity', () => {
    const scene = new Scene();
    const world = makeWorld(scene);
    const node = addBody(scene, 'sphere', new Vector3(0, 100, 0));
    world.interpolation = false;
    run(world, 1);
    // Rapier integrates within substeps, so the drop sits between the
    // semi-implicit Euler value and the exact g t^2 / 2 = 4.905.
    expect(node.getWorldPosition().y).toBeCloseTo(100 - 4.905, 1);
    expect(getPhysics(node, RigidBody)!.getLinearVelocity().y).toBeCloseTo(-9.81, 2);
  });

  it('rests a box on a static collider and lets it sleep', () => {
    const scene = new Scene();
    const world = makeWorld(scene);
    addGround(scene);
    const node = addBody(scene, 'box', new Vector3(0, 3, 0));
    run(world, 4);
    expect(node.getWorldPosition().y).toBeCloseTo(0.5, 1);
    expect(getPhysics(node, RigidBody)!.isSleeping).toBe(true);
  });

  it('stacks boxes', () => {
    const scene = new Scene();
    const world = makeWorld(scene);
    addGround(scene);
    const boxes = [0, 1, 2, 3].map((i) => addBody(scene, 'box', new Vector3(0, 0.5 + i * 1.01, 0)));
    run(world, 3);
    boxes.forEach((box, i) => {
      const p = box.getWorldPosition();
      expect(p.y).toBeCloseTo(0.5 + i, 1);
      expect(Math.abs(p.x)).toBeLessThan(0.05);
    });
  });

  it('writes the simulated pose through a transformed parent', () => {
    const scene = new Scene();
    const world = makeWorld(scene);
    addGround(scene);
    const parent = new SceneNode(scene);
    parent.position.setXYZ(5, 2, -3);
    parent.rotation = Quaternion.fromAxisAngle(new Vector3(0, 1, 0), Math.PI / 3);
    const node = addBody(scene, 'sphere', new Vector3(0, 1, 0), parent);
    run(world, 4);
    const p = node.getWorldPosition();
    expect(p.x).toBeCloseTo(5, 2);
    expect(p.y).toBeCloseTo(0.5, 1);
    expect(p.z).toBeCloseTo(-3, 2);
    expect(node.parent).toBe(parent);
  });

  it('builds a compound body from colliders on child nodes', () => {
    const scene = new Scene();
    const world = makeWorld(scene);
    addGround(scene);
    const node = new SceneNode(scene);
    node.position.setXYZ(0, 3, 0);
    addPhysics(node, new RigidBody());
    // A dumbbell: two spheres on child nodes, nothing on the body node itself.
    for (const x of [-1, 1]) {
      const part = new SceneNode(scene);
      part.parent = node;
      part.position.setXYZ(x, 0, 0);
      const collider = new Collider();
      collider.shape = 'sphere';
      addPhysics(part, collider);
    }
    run(world, 4);
    // Rests on both spheres, so it neither tips over nor sinks between them.
    expect(node.getWorldPosition().y).toBeCloseTo(0.5, 1);
  });

  it('moves a body teleported by setting its node position', () => {
    const scene = new Scene();
    const world = makeWorld(scene);
    addGround(scene);
    const node = addBody(scene, 'box', new Vector3(0, 0.5, 0));
    run(world, 2);
    node.position.setXYZ(10, 0.5, 0);
    run(world, 1);
    expect(node.getWorldPosition().x).toBeCloseTo(10, 2);
  });

  it('has a kinematic body push dynamic ones aside', () => {
    const scene = new Scene();
    const world = makeWorld(scene);
    addGround(scene);
    const pusher = addBody(scene, 'box', new Vector3(-3, 0.5, 0));
    getPhysics(pusher, RigidBody)!.motionType = 'kinematic';
    const box = addBody(scene, 'box', new Vector3(0, 0.5, 0));
    for (let i = 0; i < 120; i++) {
      pusher.position.setXYZ(-3 + (i + 1) * 0.04, 0.5, 0);
      world.update(DT);
    }
    expect(box.getWorldPosition().x).toBeGreaterThan(2);
  });

  it('applies impulses and velocities set before the body exists', () => {
    const scene = new Scene();
    const world = makeWorld(scene);
    world.gravity = Vector3.zero();
    // Interpolated poses trail the simulation by up to a step.
    world.interpolation = false;
    const node = addBody(scene, 'sphere', new Vector3(0, 0, 0));
    const body = getPhysics(node, RigidBody)!;
    body.setLinearVelocity(new Vector3(1, 0, 0));
    run(world, 1);
    expect(node.getWorldPosition().x).toBeCloseTo(1, 2);
    body.mass = 2;
    body.applyImpulse(new Vector3(0, 0, 4));
    world.update(DT);
    expect(body.getLinearVelocity().z).toBeCloseTo(2, 3);
  });

  it('stops simulating a body whose component is removed', () => {
    const scene = new Scene();
    const world = makeWorld(scene);
    const node = addBody(scene, 'sphere', new Vector3(0, 10, 0));
    run(world, 0.5);
    removePhysics(node, getPhysics(node, RigidBody)!);
    const y = node.getWorldPosition().y;
    run(world, 0.5);
    expect(node.getWorldPosition().y).toBe(y);
  });

  it('draws bodies between their last two simulated poses', () => {
    const scene = new Scene();
    const world = makeWorld(scene);
    world.gravity = Vector3.zero();
    const node = addBody(scene, 'sphere', new Vector3(0, 0, 0));
    getPhysics(node, RigidBody)!.setLinearVelocity(new Vector3(1, 0, 0));
    world.update(DT);
    world.update(DT * 1.5);
    // Two steps taken, half a step left over: drawn half way from step 1 to 2.
    expect(node.getWorldPosition().x).toBeCloseTo(1.5 * DT, 4);
  });

  it('gives the same result regardless of the order components were added in', () => {
    const simulate = (reverse: boolean) => {
      const scene = new Scene();
      const world = makeWorld(scene);
      const nodes: SceneNode[] = [];
      for (let i = 0; i < 6; i++) {
        const node = new SceneNode(scene);
        node.position.setXYZ((i % 3) * 0.3, 0.5 + i * 1.05, (i % 2) * 0.3);
        nodes.push(node);
      }
      const ground = new SceneNode(scene);
      ground.position.setXYZ(0, -0.5, 0);
      const attach = [...nodes].map((node) => () => {
        addPhysics(node, new RigidBody());
        addPhysics(node, new Collider());
      });
      attach.push(() => {
        const c = new Collider();
        c.size = new Vector3(40, 1, 40);
        addPhysics(ground, c);
      });
      (reverse ? attach.reverse() : attach).forEach((f) => f());
      run(world, 3);
      return nodes.flatMap((node) => {
        const p = node.getWorldPosition();
        return [p.x, p.y, p.z];
      });
    };
    expect(simulate(true)).toEqual(simulate(false));
  });

  it('round-trips the components through serialization', async () => {
    const scene = new Scene();
    const manager = new ResourceManager(new MemoryFS());
    const node = new SceneNode(scene);
    const body = new RigidBody();
    body.motionType = 'kinematic';
    body.mass = 3;
    body.gravityScale = 0.5;
    addPhysics(node, body);
    const collider = new Collider();
    collider.shape = 'capsule';
    collider.radius = 0.25;
    collider.height = 1.5;
    collider.offset = new Vector3(0, 0.75, 0);
    collider.friction = 0.9;
    collider.isTrigger = true;
    addPhysics(node, collider);

    const serialized = await manager.serializeObject(node);
    const container = new SceneNode(scene);
    const restored = (await manager.deserializeObject<SceneNode>(container, serialized))!;
    const rb = getPhysics(restored, RigidBody)!;
    const rc = getPhysics(restored, Collider)!;
    expect(rb.motionType).toBe('kinematic');
    expect(rb.mass).toBe(3);
    expect(rb.gravityScale).toBe(0.5);
    expect(rc.shape).toBe('capsule');
    expect(rc.radius).toBe(0.25);
    expect(rc.height).toBe(1.5);
    expect(rc.offset.y).toBe(0.75);
    expect(rc.friction).toBeCloseTo(0.9);
    expect(rc.isTrigger).toBe(true);
    expect(rc.world).toBe(scene.physicsWorld);
  });

  it('starts with its initial velocity once, not again when rebuilt', () => {
    const scene = new Scene();
    const world = makeWorld(scene);
    world.gravity = Vector3.zero();
    const node = addBody(scene, 'sphere', new Vector3(0, 10, 0));
    const body = getPhysics(node, RigidBody)!;
    body.initialLinearVelocity = new Vector3(3, 0, 0);
    body.initialAngularVelocity = new Vector3(0, 2, 0);
    world.update(DT);
    expect(body.getLinearVelocity().x).toBeCloseTo(3, 4);
    expect(body.getAngularVelocity().y).toBeCloseTo(2, 2);
    body.setLinearVelocity(Vector3.zero());
    // Rebuilt by a settings change: keeps going as it was, no fresh kick.
    body.mass = 5;
    world.update(DT);
    expect(body.getLinearVelocity().x).toBeCloseTo(0, 4);
    // Leaving and re-entering the scene starts it again.
    node.parent = null;
    world.update(DT);
    node.parent = scene.rootNode;
    world.update(DT);
    expect(body.getLinearVelocity().x).toBeCloseTo(3, 4);
  });

  it('lets a script velocity win over the initial one, and ignores it on non-dynamic bodies', () => {
    const scene = new Scene();
    const world = makeWorld(scene);
    world.gravity = Vector3.zero();
    const a = getPhysics(addBody(scene, 'sphere', new Vector3(0, 10, 0)), RigidBody)!;
    a.initialLinearVelocity = new Vector3(3, 0, 0);
    a.setLinearVelocity(new Vector3(0, 0, 1));
    const b = getPhysics(addBody(scene, 'sphere', new Vector3(5, 10, 0)), RigidBody)!;
    b.motionType = 'kinematic';
    b.initialLinearVelocity = new Vector3(3, 0, 0);
    world.update(DT);
    expect(a.getLinearVelocity().x).toBeCloseTo(0, 4);
    expect(a.getLinearVelocity().z).toBeCloseTo(1, 4);
    expect(b.node!.getWorldPosition().x).toBeCloseTo(5, 4);
  });

  it('round-trips the initial velocities', async () => {
    const scene = new Scene();
    const manager = new ResourceManager(new MemoryFS());
    const node = new SceneNode(scene);
    const body = new RigidBody();
    body.initialLinearVelocity = new Vector3(1, 2, 3);
    body.initialAngularVelocity = new Vector3(0, -4, 0);
    addPhysics(node, body);
    const restored = (await manager.deserializeObject<SceneNode>(
      new SceneNode(scene),
      await manager.serializeObject(node)
    ))!;
    const rb = getPhysics(restored, RigidBody)!;
    expect([rb.initialLinearVelocity.x, rb.initialLinearVelocity.y, rb.initialLinearVelocity.z]).toEqual([
      1, 2, 3
    ]);
    expect(rb.initialAngularVelocity.y).toBe(-4);
  });
});
