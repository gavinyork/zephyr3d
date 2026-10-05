import { Quaternion, Vector3 } from '@zephyr3d/base';
import { MemoryFS } from '@zephyr3d/base';
import { ResourceManager, Scene, SceneNode } from '@zephyr3d/scene';
import * as RAPIER from '@dimforge/rapier3d-simd-compat';
import {
  Collider,
  initPhysics,
  PhysicsWorld,
  registerPhysicsClasses,
  RigidBody,
  type ColliderShape,
  type PhysicsObject
} from '@zephyr3d/physics';

const DT = 1 / 60;

beforeAll(async () => {
  await RAPIER.init();
  await initPhysics({ rapier: RAPIER });
});

function makeWorld(scene: Scene) {
  const world = PhysicsWorld.get(scene);
  world.enabled = false;
  world.interpolation = false;
  return world;
}

function run(world: PhysicsWorld, seconds: number) {
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
  ground.addComponent(collider);
  return ground;
}

function addBody(scene: Scene, shape: ColliderShape, position: Vector3) {
  const node = new SceneNode(scene);
  node.position.set(position);
  node.addComponent(new RigidBody());
  const collider = new Collider();
  collider.shape = shape;
  node.addComponent(collider);
  return node;
}

function nameOf(object: PhysicsObject | null) {
  return object?.host?.name ?? '?';
}

/** Records every physics event an object receives, as readable strings. */
function record(object: PhysicsObject, log: string[]) {
  const self = nameOf(object);
  object.on('collisionenter', (e) => void log.push(`${self} enter ${nameOf(e.other)}`));
  object.on('collisionstay', (e) => void log.push(`${self} stay ${nameOf(e.other)}`));
  object.on('collisionexit', (e) => void log.push(`${self} exit ${nameOf(e.other)}`));
  object.on('triggerenter', (e) => void log.push(`${self} triggerenter ${nameOf(e.other)}`));
  object.on('triggerexit', (e) => void log.push(`${self} triggerexit ${nameOf(e.other)}`));
  return log;
}

function count(log: string[], entry: string) {
  return log.filter((l) => l === entry).length;
}

describe('physics layers', () => {
  it('lets layers that do not collide pass through each other', () => {
    const scene = new Scene();
    const world = makeWorld(scene);
    addGround(scene);
    const box = addBody(scene, 'box', new Vector3(0, 2, 0));
    box.getComponent(Collider)!.layer = 3;
    world.setLayerCollision(0, 3, false);
    expect(world.getLayerCollision(3, 0)).toBe(false);
    run(world, 1.5);
    expect(box.getWorldPosition().y).toBeLessThan(-1);
  });

  it('applies a matrix change to colliders already resting', () => {
    const scene = new Scene();
    const world = makeWorld(scene);
    addGround(scene);
    const box = addBody(scene, 'box', new Vector3(0, 0.5, 0));
    box.getComponent(Collider)!.layer = 2;
    run(world, 3);
    expect(box.getWorldPosition().y).toBeCloseTo(0.5, 1);
    world.setLayerCollision(2, 0, false);
    run(world, 1);
    expect(box.getWorldPosition().y).toBeLessThan(-1);
  });
});

describe('physics events', () => {
  it('raises enter on landing, stay while resting and exit when lifted off', () => {
    const scene = new Scene();
    const world = makeWorld(scene);
    const ground = addGround(scene);
    ground.name = 'ground';
    const box = addBody(scene, 'box', new Vector3(0, 1, 0));
    box.name = 'box';
    const log = record(box.getComponent(RigidBody)!, []);
    record(ground.getComponent(Collider)!, log);
    run(world, 1);
    expect(count(log, 'box enter ground')).toBe(1);
    expect(count(log, 'ground enter box')).toBe(1);
    expect(count(log, 'box stay ground')).toBeGreaterThan(10);
    expect(log.indexOf('box enter ground')).toBeLessThan(log.indexOf('box stay ground'));
    box.position.setXYZ(0, 5, 0);
    world.update(DT);
    expect(count(log, 'box exit ground')).toBe(1);
    expect(count(log, 'ground exit box')).toBe(1);
  });

  it('keeps the contact of a sleeping body without an exit', () => {
    const scene = new Scene();
    const world = makeWorld(scene);
    const ground = addGround(scene);
    ground.name = 'ground';
    const box = addBody(scene, 'box', new Vector3(0, 0.6, 0));
    box.name = 'box';
    const body = box.getComponent(RigidBody)!;
    const log = record(body, []);
    run(world, 4);
    expect(body.isSleeping).toBe(true);
    const stays = count(log, 'box stay ground');
    run(world, 3);
    expect(count(log, 'box exit ground')).toBe(0);
    // Asleep but still touching: stay keeps coming.
    expect(count(log, 'box stay ground')).toBeGreaterThan(stays);
  });

  it('raises one enter for a compound body touching in two places', () => {
    const scene = new Scene();
    const world = makeWorld(scene);
    const ground = addGround(scene);
    ground.name = 'ground';
    const node = new SceneNode(scene);
    node.name = 'dumbbell';
    node.position.setXYZ(0, 1, 0);
    node.addComponent(new RigidBody());
    for (const x of [-1, 1]) {
      const part = new SceneNode(scene);
      part.parent = node;
      part.position.setXYZ(x, 0, 0);
      const c = new Collider();
      c.shape = 'sphere';
      part.addComponent(c);
    }
    const log = record(node.getComponent(RigidBody)!, []);
    run(world, 2);
    expect(count(log, 'dumbbell enter ground')).toBe(1);
    expect(count(log, 'dumbbell exit ground')).toBe(0);
  });

  it('does not report a collider rebuilt by a property change as letting go', () => {
    const scene = new Scene();
    const world = makeWorld(scene);
    const ground = addGround(scene);
    ground.name = 'ground';
    const box = addBody(scene, 'box', new Vector3(0, 0.6, 0));
    box.name = 'box';
    const log = record(box.getComponent(RigidBody)!, []);
    run(world, 1);
    ground.getComponent(Collider)!.friction = 0.9;
    box.getComponent(Collider)!.restitution = 0.1;
    run(world, 0.5);
    expect(count(log, 'box enter ground')).toBe(1);
    expect(count(log, 'box exit ground')).toBe(0);
  });

  it('reports a touch that starts and ends within one frame', () => {
    const scene = new Scene();
    const world = makeWorld(scene);
    world.gravity = Vector3.zero();
    const wall = new SceneNode(scene);
    wall.name = 'wall';
    const wc = new Collider();
    wc.size = new Vector3(1, 4, 4);
    wc.restitution = 1;
    wall.addComponent(wc);
    const ball = addBody(scene, 'sphere', new Vector3(-1.05, 0, 0));
    ball.name = 'ball';
    ball.getComponent(Collider)!.restitution = 1;
    ball.getComponent(RigidBody)!.setLinearVelocity(new Vector3(6, 0, 0));
    const log = record(ball.getComponent(RigidBody)!, []);
    // One frame of four steps: hits the wall and bounces clear before it ends.
    world.update(4 * DT);
    expect(ball.getComponent(RigidBody)!.getLinearVelocity().x).toBeLessThan(0);
    expect(log).toEqual(['ball enter wall', 'ball exit wall']);
  });

  it('tells the remaining object when the other leaves', () => {
    const scene = new Scene();
    const world = makeWorld(scene);
    const ground = addGround(scene);
    ground.name = 'ground';
    const box = addBody(scene, 'box', new Vector3(0, 0.6, 0));
    box.name = 'box';
    const groundCollider = ground.getComponent(Collider)!;
    const groundLog = record(groundCollider, []);
    const boxLog = record(box.getComponent(RigidBody)!, []);
    run(world, 1);
    box.remove();
    world.update(DT);
    expect(count(groundLog, 'ground exit box')).toBe(1);
    expect(count(boxLog, 'box exit ground')).toBe(0);
  });

  it('raises trigger events on both sides without blocking', () => {
    const scene = new Scene();
    const world = makeWorld(scene);
    const zone = new SceneNode(scene);
    zone.name = 'zone';
    zone.position.setXYZ(0, 2, 0);
    const zc = new Collider();
    zc.size = new Vector3(2, 1, 2);
    zc.isTrigger = true;
    zone.addComponent(zc);
    const ball = addBody(scene, 'sphere', new Vector3(0, 4, 0));
    ball.name = 'ball';
    const log = record(ball.getComponent(RigidBody)!, []);
    record(zc, log);
    run(world, 1.5);
    expect(count(log, 'ball triggerenter zone')).toBe(1);
    expect(count(log, 'zone triggerenter ball')).toBe(1);
    expect(count(log, 'ball triggerexit zone')).toBe(1);
    expect(count(log, 'zone triggerexit ball')).toBe(1);
    expect(log.some((l) => l.includes(' enter ') || l.includes(' stay '))).toBe(false);
    expect(ball.getWorldPosition().y).toBeLessThan(0);
  });

  it('lets a trigger zone with no rigid body sense a kinematic body', () => {
    const scene = new Scene();
    const world = makeWorld(scene);
    const zone = new SceneNode(scene);
    zone.name = 'zone';
    const zc = new Collider();
    zc.isTrigger = true;
    zone.addComponent(zc);
    const mover = addBody(scene, 'box', new Vector3(-3, 0, 0));
    mover.name = 'mover';
    mover.getComponent(RigidBody)!.motionType = 'kinematic';
    const log = record(zc, []);
    for (let i = 0; i < 60; i++) {
      mover.position.setXYZ(-3 + (i + 1) * 0.1, 0, 0);
      world.update(DT);
    }
    expect(log).toEqual(['zone triggerenter mover', 'zone triggerexit mover']);
  });

  it('reports the contact normal from this object towards the other, and the impact', () => {
    const scene = new Scene();
    const world = makeWorld(scene);
    const ground = addGround(scene);
    const ball = addBody(scene, 'sphere', new Vector3(0, 2, 0));
    let normal: Vector3 | null = null;
    let groundNormal: Vector3 | null = null;
    let impulse = 0;
    let contacts = 0;
    ball.getComponent(RigidBody)!.on('collisionenter', (e) => {
      normal = e.normal.clone();
      impulse = e.impulse;
      contacts = e.contacts.length;
    });
    ground.getComponent(Collider)!.on('collisionenter', (e) => {
      groundNormal = e.normal.clone();
    });
    run(world, 1);
    expect(normal!.y).toBeCloseTo(-1, 3);
    expect(groundNormal!.y).toBeCloseTo(1, 3);
    expect(impulse).toBeGreaterThan(0);
    expect(contacts).toBeGreaterThan(0);
  });

  it('raises the same events in the same order on every run', () => {
    const simulate = () => {
      const scene = new Scene();
      const world = makeWorld(scene);
      const ground = addGround(scene);
      ground.name = 'ground';
      const log: string[] = [];
      record(ground.getComponent(Collider)!, log);
      for (let i = 0; i < 6; i++) {
        const box = addBody(scene, 'box', new Vector3((i % 3) * 0.4, 0.5 + i * 1.1, (i % 2) * 0.4));
        box.name = `box${i}`;
        record(box.getComponent(RigidBody)!, log);
      }
      run(world, 3);
      return log;
    };
    const first = simulate();
    expect(first.length).toBeGreaterThan(0);
    expect(simulate()).toEqual(first);
  });
});

describe('physics queries', () => {
  function stage() {
    const scene = new Scene();
    const world = makeWorld(scene);
    const ground = addGround(scene);
    ground.name = 'ground';
    const box = new SceneNode(scene);
    box.name = 'box';
    box.position.setXYZ(0, 2, 0);
    box.addComponent(new RigidBody());
    box.getComponent(RigidBody)!.motionType = 'static';
    const bc = new Collider();
    bc.layer = 1;
    box.addComponent(bc);
    const zone = new SceneNode(scene);
    zone.name = 'zone';
    zone.position.setXYZ(0, 4, 0);
    const zc = new Collider();
    zc.isTrigger = true;
    zone.addComponent(zc);
    // Queries see the world as of the last step.
    world.update(DT);
    return { scene, world, ground, box, zone };
  }

  it('finds the nearest collider along a ray', () => {
    const { world, box } = stage();
    const hit = world.raycast(new Vector3(0, 10, 0), new Vector3(0, -2, 0))!;
    expect(hit.node).toBe(box);
    expect(hit.body).toBe(box.getComponent(RigidBody));
    expect(hit.distance).toBeCloseTo(7.5, 4);
    expect(hit.point.y).toBeCloseTo(2.5, 4);
    expect(hit.normal.y).toBeCloseTo(1, 4);
  });

  it('filters by layer, trigger and excluded object', () => {
    const { world, box, zone, ground } = stage();
    const down = new Vector3(0, -1, 0);
    const from = new Vector3(0, 10, 0);
    expect(world.raycast(from, down, Infinity, { layerMask: 1 << 0 })!.node).toBe(ground);
    expect(world.raycast(from, down, Infinity, { includeTriggers: true })!.node).toBe(zone);
    expect(world.raycast(from, down, Infinity, { exclude: box.getComponent(RigidBody) })!.node).toBe(ground);
    expect(world.raycast(from, down, 5)).toBeNull();
  });

  it('lists every collider along a ray, nearest first', () => {
    const { world, box, zone, ground } = stage();
    const hits = world.raycastAll(new Vector3(0, 10, 0), new Vector3(0, -1, 0), Infinity, {
      includeTriggers: true
    });
    expect(hits.map((h) => h.node)).toEqual([zone, box, ground]);
  });

  it('casts and overlaps shapes', () => {
    const { world, box, ground } = stage();
    const cast = world.shapeCast(
      { type: 'sphere', radius: 0.5 },
      new Vector3(0, 10, 0),
      Quaternion.identity(),
      new Vector3(0, -1, 0)
    )!;
    expect(cast.node).toBe(box);
    expect(cast.distance).toBeCloseTo(7, 3);
    expect(cast.point.y).toBeCloseTo(2.5, 3);
    const overlapping = world.overlap(
      { type: 'box', size: new Vector3(1, 1, 1) },
      new Vector3(0, 0, 0),
      Quaternion.identity()
    );
    expect(overlapping.map((c) => c.host)).toEqual([ground]);
    expect(world.overlapPoint(new Vector3(0.2, 2.1, 0)).map((c) => c.host)).toEqual([box]);
  });

  it('sees the world as of the last step', () => {
    const { scene, world, box } = stage();
    const added = new SceneNode(scene);
    added.position.setXYZ(10, 3, 0);
    added.addComponent(new Collider());
    box.position.setXYZ(5, 2, 0);
    // Neither change is simulated yet.
    expect(world.overlapPoint(new Vector3(10, 3, 0)).length).toBe(0);
    expect(world.overlapPoint(new Vector3(0, 2, 0)).map((c) => c.host)).toEqual([box]);
    world.update(DT);
    expect(world.overlapPoint(new Vector3(10, 3, 0)).map((c) => c.host)).toEqual([added]);
    expect(world.overlapPoint(new Vector3(0, 2, 0)).length).toBe(0);
    expect(world.raycast(new Vector3(5, 10, 0), new Vector3(0, -1, 0))!.node).toBe(box);
  });

  it('finds nothing before the first step', () => {
    const scene = new Scene();
    const world = makeWorld(scene);
    addGround(scene);
    expect(world.raycast(new Vector3(0, 10, 0), new Vector3(0, -1, 0))).toBeNull();
  });
});

describe('physics fixed update', () => {
  it('runs once before each step', () => {
    const scene = new Scene();
    const world = makeWorld(scene);
    addBody(scene, 'sphere', Vector3.zero());
    const steps: number[] = [];
    world.on('fixedupdate', (dt) => void steps.push(dt));
    world.update(3 * DT);
    world.update(0.5 * DT);
    expect(steps.length).toBe(3);
    expect(steps[0]).toBeCloseTo(DT, 9);
  });

  it('applies a force from the fixed update to one step, and from outside to the whole frame', () => {
    const scene = new Scene();
    const world = makeWorld(scene);
    world.gravity = Vector3.zero();
    const a = addBody(scene, 'sphere', new Vector3(-5, 0, 0)).getComponent(RigidBody)!;
    const b = addBody(scene, 'sphere', new Vector3(5, 0, 0)).getComponent(RigidBody)!;
    world.update(DT);
    let first = true;
    world.on('fixedupdate', () => {
      if (first) {
        a.applyForce(new Vector3(60, 0, 0));
        first = false;
      }
    });
    b.applyForce(new Vector3(60, 0, 0));
    world.update(3 * DT);
    // Mass 1: one step of 60 N gives 1 m/s, three steps give 3 m/s.
    expect(a.getLinearVelocity().x).toBeCloseTo(1, 3);
    expect(b.getLinearVelocity().x).toBeCloseTo(3, 3);
    world.update(DT);
    expect(b.getLinearVelocity().x).toBeCloseTo(3, 3);
  });
});

describe('rigid body axis locks', () => {
  it('keeps locked axes still', () => {
    const scene = new Scene();
    const world = makeWorld(scene);
    world.gravity = Vector3.zero();
    const node = addBody(scene, 'box', Vector3.zero());
    const body = node.getComponent(RigidBody)!;
    body.lockTranslationX = true;
    body.lockRotationX = true;
    body.lockRotationY = true;
    body.lockRotationZ = true;
    body.setLinearVelocity(new Vector3(2, 1, 0));
    body.setAngularVelocity(new Vector3(3, 3, 3));
    run(world, 1);
    const p = node.getWorldPosition();
    expect(p.x).toBeCloseTo(0, 5);
    expect(p.y).toBeCloseTo(1, 2);
    expect(body.getAngularVelocity().magnitude).toBeCloseTo(0, 5);
    body.lockTranslationX = false;
    body.setLinearVelocity(new Vector3(2, 0, 0));
    run(world, 1);
    expect(node.getWorldPosition().x).toBeCloseTo(2, 2);
  });

  it('round-trips layer and locks through serialization', async () => {
    const scene = new Scene();
    const manager = new ResourceManager(new MemoryFS());
    registerPhysicsClasses(manager);
    const node = new SceneNode(scene);
    const body = new RigidBody();
    body.lockRotationX = true;
    body.lockTranslationZ = true;
    node.addComponent(body);
    const collider = new Collider();
    collider.layer = 7;
    node.addComponent(collider);
    const serialized = await manager.serializeObject(node);
    const restored = (await manager.deserializeObject<SceneNode>(new SceneNode(scene), serialized))!;
    const rb = restored.getComponent(RigidBody)!;
    expect(rb.lockRotationX).toBe(true);
    expect(rb.lockRotationY).toBe(false);
    expect(rb.lockTranslationZ).toBe(true);
    expect(restored.getComponent(Collider)!.layer).toBe(7);
  });
});
