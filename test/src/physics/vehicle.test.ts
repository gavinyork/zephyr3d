import { MemoryFS, Quaternion, Vector3 } from '@zephyr3d/base';
import { ResourceManager, Scene, SceneNode } from '@zephyr3d/scene';
import * as RAPIER from '@dimforge/rapier3d-simd-compat';
import {
  Collider,
  initPhysics,
  PhysicsWorld,
  registerPhysics,
  RigidBody,
  Vehicle,
  Wheel,
  type VehicleForward
} from '@zephyr3d/physics';

const DT = 1 / 60;
const MASS = 1000;
const G = 9.81;

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

function addGround(scene: Scene) {
  const ground = new SceneNode(scene);
  ground.position.setXYZ(0, -0.5, 0);
  const collider = new Collider();
  collider.size = new Vector3(400, 1, 400);
  ground.addComponent(collider);
  return ground;
}

interface CarOptions {
  forward?: VehicleForward;
  drive?: 'front' | 'rear' | 'all';
  position?: Vector3;
  rotation?: Quaternion;
}

/**
 * A 1000 kg car, 1.8 x 0.6 x 4 m body, wheels 0.4 m radius with 0.3 m
 * suspension, placed so the wheels just touch the ground at rest.
 */
function addCar(scene: Scene, options: CarOptions = {}) {
  const forward = options.forward ?? '+z';
  const car = new SceneNode(scene);
  car.name = 'car';
  car.position.set(options.position ?? new Vector3(0, 0.7, 0));
  if (options.rotation) {
    car.rotation.set(options.rotation);
  }
  const body = new RigidBody();
  body.mass = MASS;
  car.addComponent(body);
  const box = new Collider();
  box.size = forward === '+z' || forward === '-z' ? new Vector3(1.8, 0.6, 4) : new Vector3(4, 0.6, 1.8);
  box.offset = new Vector3(0, 0.3, 0);
  car.addComponent(box);
  const vehicle = new Vehicle();
  vehicle.forward = forward;
  car.addComponent(vehicle);
  // Front is +1 along the forward axis.
  const f = forward === '+z' || forward === '+x' ? 1 : -1;
  const alongX = forward === '+x' || forward === '-x';
  const wheels: { node: SceneNode; wheel: Wheel; front: boolean }[] = [];
  for (const front of [true, false]) {
    for (const side of [-1, 1]) {
      const node = new SceneNode(scene);
      node.parent = car;
      const along = (front ? 1.3 : -1.3) * f;
      // Wheel centre 0.3 below the body origin: resting on the ground at y 0.4.
      node.position = alongX ? new Vector3(along, -0.3, side * 0.9) : new Vector3(side * 0.9, -0.3, along);
      const wheel = new Wheel();
      wheel.steer = front ? 1 : 0;
      const drive = options.drive ?? 'rear';
      wheel.drive = drive === 'all' ? 0.25 : (drive === 'front') === front ? 0.5 : 0;
      wheel.handbrake = front ? 0 : 1;
      node.addComponent(wheel);
      wheels.push({ node, wheel, front });
    }
  }
  return { car, body, vehicle, wheels };
}

describe('vehicle', () => {
  it('rests on its wheels with the suspension sunk by g / (4 stiffness)', () => {
    const scene = new Scene();
    const world = makeWorld(scene);
    addGround(scene);
    const { car, vehicle, wheels } = addCar(scene);
    run(world, 4);
    expect(vehicle.error).toBe('');
    expect(vehicle.wheels.length).toBe(4);
    for (const { wheel } of wheels) {
      expect(wheel.inContact).toBe(true);
      expect(wheel.groundNode).not.toBeNull();
      expect(wheel.suspensionLength).toBeCloseTo(0.3 - G / (4 * 30), 2);
      // Within 2%: the last update before the body sleeps still has a little damping in it.
      expect(Math.abs(wheel.suspensionForce / ((MASS * G) / 4) - 1)).toBeLessThan(0.02);
    }
    // The body settles lower by the same amount.
    expect(car.position.y).toBeCloseTo(0.7 - G / 120, 2);
    expect(Math.abs(vehicle.speed)).toBeLessThan(0.01);
  });

  it('places wheel nodes on the suspension and gives them back afterwards', () => {
    const scene = new Scene();
    const world = makeWorld(scene);
    addGround(scene);
    const { car, wheels } = addCar(scene);
    const rest = wheels.map(({ node }) => node.position.clone());
    run(world, 3);
    for (const { node, wheel } of wheels) {
      // Centre at radius above the ground, under its rest place.
      expect(node.getWorldPosition().y).toBeCloseTo(0.4, 2);
      expect(wheel.contactPoint.y).toBeCloseTo(0, 2);
    }
    expect(wheels[0].node.position.x).toBeCloseTo(rest[0].x, 3);
    car.removeComponent(car.getComponent(Vehicle)!);
    world.update(DT);
    wheels.forEach(({ node }, i) => {
      expect(node.position.x).toBeCloseTo(rest[i].x, 6);
      expect(node.position.y).toBeCloseTo(rest[i].y, 6);
      expect(node.position.z).toBeCloseTo(rest[i].z, 6);
    });
  });

  for (const forward of ['+z', '-z', '+x', '-x'] as VehicleForward[]) {
    it(`drives towards ${forward}, and backwards on negative throttle`, () => {
      const scene = new Scene();
      const world = makeWorld(scene);
      addGround(scene);
      const { car, vehicle } = addCar(scene, { forward });
      run(world, 1);
      const start = car.getWorldPosition();
      vehicle.throttle = 1;
      run(world, 2);
      const dir = {
        '+z': new Vector3(0, 0, 1),
        '-z': new Vector3(0, 0, -1),
        '+x': new Vector3(1, 0, 0),
        '-x': new Vector3(-1, 0, 0)
      }[forward];
      const moved = Vector3.dot(Vector3.sub(car.getWorldPosition(), start), dir);
      expect(moved).toBeGreaterThan(1);
      expect(vehicle.speed).toBeGreaterThan(2);
      vehicle.throttle = -1;
      run(world, 4);
      expect(vehicle.speed).toBeLessThan(-1);
    });
  }

  it('rolls its wheels forward when driving forward', () => {
    const scene = new Scene();
    const world = makeWorld(scene);
    addGround(scene);
    const { vehicle, wheels } = addCar(scene);
    run(world, 1);
    vehicle.throttle = 1;
    run(world, 1);
    // The top of a rolling wheel moves forward relative to its centre.
    const { node } = wheels[2];
    const top = node.worldMatrix.transformPointAffine(new Vector3(0, 0.4, 0), new Vector3());
    const before = Vector3.sub(top, node.getWorldPosition());
    world.update(DT);
    const top2 = node.worldMatrix.transformPointAffine(new Vector3(0, 0.4, 0), new Vector3());
    const after = Vector3.sub(top2, node.getWorldPosition());
    // Turned forward (+z) at the top.
    expect(Vector3.cross(before, after).x).toBeGreaterThan(0);
  });

  it('stops under the brake', () => {
    const scene = new Scene();
    const world = makeWorld(scene);
    addGround(scene);
    const { vehicle } = addCar(scene);
    run(world, 1);
    vehicle.throttle = 1;
    run(world, 3);
    expect(vehicle.speed).toBeGreaterThan(5);
    vehicle.throttle = 0;
    vehicle.brake = 1;
    run(world, 4);
    expect(Math.abs(vehicle.speed)).toBeLessThan(0.1);
  });

  it('turns left on positive steering, right on negative', () => {
    for (const sign of [1, -1]) {
      const scene = new Scene();
      const world = makeWorld(scene);
      addGround(scene);
      const { car, vehicle } = addCar(scene);
      run(world, 1);
      vehicle.throttle = 0.6;
      vehicle.steering = sign;
      run(world, 3);
      // Facing +z, left is +x.
      expect(Math.sign(car.getWorldPosition().x)).toBe(sign);
      expect(Math.abs(car.getWorldPosition().x)).toBeGreaterThan(0.5);
    }
  });

  it('only pushes with the driven wheels', () => {
    for (const drive of ['front', 'rear'] as const) {
      const scene = new Scene();
      const world = makeWorld(scene);
      addGround(scene);
      const { vehicle, wheels } = addCar(scene, { drive });
      run(world, 1);
      vehicle.throttle = 1;
      world.update(DT);
      for (const { wheel, front } of wheels) {
        expect(wheel.drive > 0).toBe((drive === 'front') === front);
      }
      run(world, 1);
      expect(vehicle.speed).toBeGreaterThan(1);
    }
  });

  it('follows extra per wheel inputs', () => {
    const scene = new Scene();
    const world = makeWorld(scene);
    addGround(scene);
    const { vehicle, wheels } = addCar(scene, { drive: 'front' });
    run(world, 1);
    // No throttle: only the rear wheels' own force drives it.
    wheels[2].wheel.engineForce = 1500;
    wheels[3].wheel.engineForce = 1500;
    run(world, 2);
    expect(vehicle.speed).toBeGreaterThan(1);
  });

  it('reports why it cannot be built', () => {
    const scene = new Scene();
    const world = makeWorld(scene);
    const node = new SceneNode(scene);
    const vehicle = new Vehicle();
    node.addComponent(vehicle);
    const orphan = new SceneNode(scene);
    const wheel = new Wheel();
    orphan.addComponent(wheel);
    world.update(DT);
    expect(vehicle.error).toMatch(/RigidBody/);
    expect(wheel.error).toMatch(/Vehicle/);
    node.addComponent(new RigidBody());
    world.update(DT);
    expect(vehicle.error).toMatch(/Wheel/);
  });

  it('keeps working after its body or wheels change', () => {
    const scene = new Scene();
    const world = makeWorld(scene);
    addGround(scene);
    const { body, vehicle, wheels } = addCar(scene);
    run(world, 1);
    vehicle.throttle = 1;
    run(world, 1);
    body.mass = 1200;
    wheels[0].wheel.suspensionStiffness = 40;
    run(world, 1);
    expect(vehicle.error).toBe('');
    expect(vehicle.wheels.length).toBe(4);
    expect(vehicle.speed).toBeGreaterThan(2);
    // Rest places stay where they were authored, not where the wheels were.
    expect(wheels[0].node.getWorldPosition().y).toBeCloseTo(0.4, 1);
  });

  it('is deterministic', () => {
    const simulate = () => {
      const scene = new Scene();
      const world = makeWorld(scene);
      addGround(scene);
      const { car, vehicle } = addCar(scene, {
        rotation: Quaternion.fromAxisAngle(Vector3.axisPY(), 0.3)
      });
      vehicle.throttle = 0.8;
      vehicle.steering = 0.4;
      run(world, 3);
      const p = car.getWorldPosition();
      return [p.x, p.y, p.z];
    };
    expect(simulate()).toEqual(simulate());
  });

  it('round-trips through serialization', async () => {
    const scene = new Scene();
    const manager = new ResourceManager(new MemoryFS());
    registerPhysics(manager);
    const node = new SceneNode(scene);
    const vehicle = new Vehicle();
    vehicle.forward = '-x';
    vehicle.maxEngineForce = 7000;
    vehicle.layer = 3;
    node.addComponent(vehicle);
    const wheelNode = new SceneNode(scene);
    wheelNode.parent = node;
    const wheel = new Wheel();
    wheel.radius = 0.55;
    wheel.drive = 0.25;
    wheel.steer = -1;
    wheel.suspensionStiffness = 45;
    wheelNode.addComponent(wheel);
    const restored = (await manager.deserializeObject<SceneNode>(
      new SceneNode(scene),
      await manager.serializeObject(node)
    ))!;
    const v = restored.getComponent(Vehicle)!;
    expect(v.forward).toBe('-x');
    expect(v.maxEngineForce).toBe(7000);
    expect(v.layer).toBe(3);
    const w = restored.children[0].getComponent(Wheel)!;
    expect(w.radius).toBeCloseTo(0.55);
    expect(w.drive).toBeCloseTo(0.25);
    expect(w.steer).toBe(-1);
    expect(w.suspensionStiffness).toBe(45);
  });
});
