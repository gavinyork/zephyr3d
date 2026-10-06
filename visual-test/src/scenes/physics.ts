import { Quaternion, Vector3, Vector4 } from '@zephyr3d/base';
import {
  BoundingBox,
  BoxShape,
  CapsuleShape,
  CylinderShape,
  Mesh,
  PBRMetallicRoughnessMaterial,
  Primitive,
  SphereShape
} from '@zephyr3d/scene';
import type { Scene } from '@zephyr3d/scene';
import {
  CharacterController,
  Collider,
  initPhysics,
  Joint,
  PhysicsWorld,
  RigidBody,
  Vehicle,
  Wheel
} from '@zephyr3d/physics';
import type { VisualScene } from '../types';
import { bareScene, placeCamera, shadowKeyLight } from './common';

function material(color: Vector4) {
  const m = new PBRMetallicRoughnessMaterial();
  m.albedoColor = color;
  m.metallic = 0;
  m.roughness = 0.6;
  return m;
}

function box(scene: Scene, color: Vector4, size: Vector3, position: Vector3, dynamic: boolean) {
  const mesh = new Mesh(scene, new BoxShape({ size: size.x, sizeY: size.y, sizeZ: size.z }), material(color));
  mesh.position.set(position);
  if (dynamic) {
    mesh.addComponent(new RigidBody());
  }
  const collider = new Collider();
  collider.size = size;
  mesh.addComponent(collider);
  return mesh;
}

function ball(scene: Scene, color: Vector4, radius: number, position: Vector3) {
  const mesh = new Mesh(scene, new SphereShape({ radius }), material(color));
  mesh.position.set(position);
  mesh.addComponent(new RigidBody());
  const collider = new Collider();
  collider.shape = 'sphere';
  collider.radius = radius;
  collider.restitution = 0.3;
  mesh.addComponent(collider);
  return mesh;
}

/**
 * Rigid bodies dropped onto a tilted slab and a floor, captured mid-motion.
 *
 * Pins the whole physics path end to end - WebAssembly loading from the
 * package's dist, component registration, fixed stepping driven by the
 * harness's fixed frame time, and pose write-back into the render - not the
 * solver's numbers, which the unit tests cover. Captured while bodies are still
 * moving so that render-pose interpolation is in the image too.
 *
 * Deterministic: the simulation only ever sees fixed steps, and Rapier gives
 * bit-identical results across platforms for identical inputs. Lit with
 * shadows, so a body resting on something can be told from one hovering.
 */
export const physicsDrop: VisualScene = {
  name: 'physics-drop',
  description:
    'Boxes and balls falling onto a tilted slab and a floor. Regresses Rapier loading, stepping and pose write-back.',
  frames: 75,
  async setup({ scene, camera }) {
    await initPhysics();
    bareScene(scene);
    // Shadows show whether a body rests on something or hovers above it.
    shadowKeyLight(scene, 'pcf');

    // Static: no rigid body, just colliders.
    box(scene, new Vector4(0.55, 0.55, 0.55, 1), new Vector3(12, 0.5, 12), new Vector3(0, -0.25, 0), false);
    const slab = box(
      scene,
      new Vector4(0.35, 0.4, 0.5, 1),
      new Vector3(4, 0.3, 3),
      new Vector3(-1.2, 1.2, 0),
      false
    );
    slab.rotation = Quaternion.fromAxisAngle(Vector3.axisPZ(), -0.35);

    const colors = [
      new Vector4(0.9, 0.35, 0.15, 1),
      new Vector4(0.15, 0.45, 0.9, 1),
      new Vector4(0.95, 0.8, 0.2, 1),
      new Vector4(0.3, 0.75, 0.35, 1)
    ];
    for (let i = 0; i < 6; i++) {
      const b = box(
        scene,
        colors[i % 4],
        new Vector3(0.6, 0.6, 0.6),
        new Vector3(-2 + (i % 3) * 0.7, 3 + Math.floor(i / 3) * 0.9, -0.4 + (i % 2) * 0.8),
        true
      );
      b.rotation = Quaternion.fromAxisAngle(new Vector3(1, 1, 0).inplaceNormalize(), i * 0.4);
    }
    for (let i = 0; i < 4; i++) {
      ball(scene, colors[(i + 2) % 4], 0.3, new Vector3(1.5 + (i % 2) * 0.5, 2.5 + i * 0.8, -0.5 + i * 0.35));
    }

    placeCamera(camera, new Vector3(0, 4.5, 9), new Vector3(0, 0.8, 0));
  }
};

/** Rolling ground, 12 m square: y = 0.5 sin(0.6 x) cos(0.5 z), with exact normals. */
function rollingGround() {
  const n = 32;
  const size = 12;
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const x = (i / n - 0.5) * size;
      const z = (j / n - 0.5) * size;
      positions.push(x, 0.5 * Math.sin(0.6 * x) * Math.cos(0.5 * z), z);
      const dx = 0.3 * Math.cos(0.6 * x) * Math.cos(0.5 * z);
      const dz = -0.25 * Math.sin(0.6 * x) * Math.sin(0.5 * z);
      const len = Math.hypot(dx, 1, dz);
      normals.push(-dx / len, 1 / len, -dz / len);
    }
  }
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * (n + 1) + i;
      indices.push(a, a + n + 1, a + 1, a + 1, a + n + 1, a + n + 2);
    }
  }
  const prim = new Primitive();
  prim.createAndSetVertexBuffer('position_f32x3', new Float32Array(positions));
  prim.createAndSetVertexBuffer('normal_f32x3', new Float32Array(normals));
  prim.createAndSetIndexBuffer(new Uint16Array(indices));
  prim.setBoundingVolume(
    new BoundingBox(new Vector3(-size / 2, -0.5, -size / 2), new Vector3(size / 2, 0.5, size / 2))
  );
  prim.indexCount = indices.length;
  return prim;
}

/**
 * Low-poly rocks and crates falling onto rolling ground, every collider built
 * from its render mesh: the ground as a triangle mesh, the rocks and crates as
 * convex hulls.
 *
 * All of them read their mesh back from the GPU. Pins that path end to end -
 * the read back itself, the start barrier that holds the simulation until the
 * colliders are in, and mesh and convex contacts - in a real backend rather
 * than the null device the unit tests use.
 *
 * Deterministic: setup awaits every read back before the first frame, and the
 * barrier would hold the simulation even if it did not. Lit with shadows, so
 * a body resting on the ground can be told from one hovering above it.
 */
export const physicsMeshGround: VisualScene = {
  name: 'physics-mesh-ground',
  description:
    'Convex rocks and crates on rolling mesh-collided ground. Regresses mesh read back, the start barrier, and mesh and convex contacts.',
  frames: 90,
  async setup({ scene, camera }) {
    await initPhysics();
    bareScene(scene);
    // Shadows show whether a body rests on the ground or hovers above it.
    shadowKeyLight(scene, 'pcf');

    const ground = new Mesh(scene, rollingGround(), material(new Vector4(0.5, 0.55, 0.45, 1)));
    const groundCollider = new Collider();
    groundCollider.shape = 'mesh';
    ground.addComponent(groundCollider);

    const colors = [
      new Vector4(0.9, 0.35, 0.15, 1),
      new Vector4(0.15, 0.45, 0.9, 1),
      new Vector4(0.95, 0.8, 0.2, 1),
      new Vector4(0.6, 0.6, 0.65, 1)
    ];
    // One shared rock mesh: read back once for all of them.
    const rockShape = new SphereShape({ radius: 0.4, verticalDetail: 5, horizonalDetail: 7 });
    for (let i = 0; i < 8; i++) {
      const rock = new Mesh(scene, rockShape, material(colors[i % 4]));
      rock.position.setXYZ(-3 + (i % 4) * 1.7, 2.5 + Math.floor(i / 4) * 1.2, -1 + (i % 3) * 0.9);
      rock.scale.setXYZ(1, 0.7 + (i % 3) * 0.15, 1.2);
      rock.addComponent(new RigidBody());
      const hull = new Collider();
      hull.shape = 'convex';
      rock.addComponent(hull);
    }
    const crateShape = new BoxShape({ size: 0.7 });
    for (let i = 0; i < 4; i++) {
      const crate = new Mesh(scene, crateShape, material(colors[(i + 1) % 4]));
      crate.position.setXYZ(-2.2 + i * 1.5, 4.5, 0.4);
      crate.rotation = Quaternion.fromAxisAngle(new Vector3(1, 0.5, 0).inplaceNormalize(), i * 0.6);
      crate.addComponent(new RigidBody());
      const hull = new Collider();
      hull.shape = 'convex';
      crate.addComponent(hull);
    }
    await PhysicsWorld.get(scene).whenReady();

    placeCamera(camera, new Vector3(0, 5, 10), new Vector3(0, 0.5, 0));
  }
};

/**
 * A hinged door knocked open by a rolling ball, a chain of beads on ball joints
 * swinging down from a fixed point, and a character walking up a flight of
 * steps, captured mid-motion.
 *
 * Pins joints and the character controller in the real render path: hinge
 * frames and pivots, ball joints chained to each other and to the world, and
 * a character moved from the world's fixed update - stepping, standing on the
 * steps, and its node written where the controller put it.
 *
 * Deterministic: everything is driven by fixed steps, including the character,
 * whose walk is a pure function of the steps taken.
 */
export const physicsJoints: VisualScene = {
  name: 'physics-joints',
  description:
    'Hinged door hit by a ball, a bead chain on ball joints, and a character climbing steps. Regresses joints and the character controller.',
  frames: 75,
  async setup({ scene, camera }) {
    await initPhysics();
    bareScene(scene);
    shadowKeyLight(scene, 'pcf');
    const grey = new Vector4(0.55, 0.55, 0.55, 1);
    box(scene, grey, new Vector3(14, 0.5, 10), new Vector3(0, -0.25, 0), false);

    // Door, hinged on its left edge at x = 1.
    const door = box(
      scene,
      new Vector4(0.6, 0.4, 0.25, 1),
      new Vector3(1.2, 2, 0.1),
      new Vector3(1.6, 1.02, 0),
      true
    );
    const hinge = new Mesh(scene, new BoxShape({ size: 0.05, sizeY: 2.1, sizeZ: 0.05 }), material(grey));
    hinge.parent = door;
    hinge.position.setXYZ(-0.62, 0, 0);
    const joint = new Joint();
    joint.type = 'hinge';
    joint.limitsEnabled = true;
    joint.lowerLimit = -100;
    joint.upperLimit = 100;
    hinge.addComponent(joint);
    const knock = ball(scene, new Vector4(0.9, 0.35, 0.15, 1), 0.3, new Vector3(2.0, 0.3, 4));
    knock.getComponent(RigidBody)!.mass = 8;
    knock.getComponent(RigidBody)!.setLinearVelocity(new Vector3(0, 0, -6));

    // Bead chain, laid out level from a fixed point and let go.
    const beads = 7;
    let prev: Mesh | null = null;
    for (let i = 0; i < beads; i++) {
      const bead = ball(
        scene,
        new Vector4(0.15, 0.45, 0.9, 1),
        0.12,
        new Vector3(-4 + (i + 1) * 0.3, 3.5, 0)
      );
      const link = new Joint();
      link.type = 'ball';
      link.anchor = new Vector3(-0.15, 0, 0);
      link.connectedBody = prev;
      bead.addComponent(link);
      prev = bead;
    }

    // Character walking up three steps along -X, from the fixed update.
    for (let i = 0; i < 3; i++) {
      box(scene, grey, new Vector3(1, 0.2 * (i + 1), 2), new Vector3(-1 - i, 0.1 * (i + 1), 2.5), false);
    }
    const hero = new Mesh(
      scene,
      new CapsuleShape({ radius: 0.3, height: 1.2, anchor: 0 }),
      material(new Vector4(0.3, 0.75, 0.35, 1))
    );
    hero.position.setXYZ(0.5, 0, 2.5);
    const controller = new CharacterController();
    hero.addComponent(controller);
    let vy = 0;
    const world = PhysicsWorld.get(scene);
    world.on('fixedupdate', (dt) => {
      vy = controller.isGrounded ? -1 : vy - 9.81 * dt;
      controller.move(new Vector3(-1.6 * dt, vy * dt, 0));
    });

    placeCamera(camera, new Vector3(0, 4.5, 9), new Vector3(-0.5, 1, 0.5));
  }
};

/**
 * A four wheeled car driven up a ramp from the world's fixed update, steering
 * a little, captured on the ramp with its suspension loaded unevenly.
 *
 * Pins vehicles in the real render path: wheel rays finding a box ramp and the
 * floor, suspension holding the body up, engine force moving it, and the wheel
 * nodes written back - lowered onto the ground, steered and rolled - under an
 * interpolated chassis.
 *
 * Deterministic: inputs are set once and everything runs in fixed steps.
 */
export const physicsVehicle: VisualScene = {
  name: 'physics-vehicle',
  description:
    'A car with ray cast suspension driving up a ramp. Regresses vehicles, suspension and wheel write-back.',
  frames: 100,
  async setup({ scene, camera }) {
    await initPhysics();
    bareScene(scene);
    shadowKeyLight(scene, 'pcf');
    const grey = new Vector4(0.55, 0.55, 0.55, 1);
    box(scene, grey, new Vector3(30, 0.5, 30), new Vector3(0, -0.25, 0), false);
    const ramp = box(
      scene,
      new Vector4(0.4, 0.45, 0.55, 1),
      new Vector3(4, 0.3, 6),
      new Vector3(0.8, 0.45, 2.5),
      false
    );
    ramp.rotation = Quaternion.fromAxisAngle(Vector3.axisPX(), -0.2);

    const car = new Mesh(
      scene,
      new BoxShape({ size: 1.8, sizeY: 0.6, sizeZ: 4 }),
      material(new Vector4(0.9, 0.35, 0.15, 1))
    );
    car.position.setXYZ(0, 0.75, -3.5);
    const body = new RigidBody();
    body.mass = 1000;
    car.addComponent(body);
    const shell = new Collider();
    shell.size = new Vector3(1.8, 0.6, 4);
    car.addComponent(shell);
    const vehicle = new Vehicle();
    car.addComponent(vehicle);
    // A cylinder lies along Y; turned onto its side its axis is the axle.
    const tyre = new CylinderShape({ topRadius: 0.4, bottomRadius: 0.4, height: 0.3, anchor: 0.5 });
    const tyreMaterial = material(new Vector4(0.12, 0.12, 0.12, 1));
    for (const front of [true, false]) {
      for (const side of [-1, 1]) {
        const node = new Mesh(scene, tyre, tyreMaterial);
        node.parent = car;
        node.position.setXYZ(side * 1.05, -0.35, front ? 1.3 : -1.3);
        node.rotation = Quaternion.fromAxisAngle(Vector3.axisPZ(), Math.PI / 2);
        const wheel = new Wheel();
        wheel.steer = front ? 1 : 0;
        wheel.drive = front ? 0 : 0.5;
        node.addComponent(wheel);
      }
    }
    vehicle.throttle = 0.8;
    vehicle.steering = 0.15;

    placeCamera(camera, new Vector3(7, 4, 6), new Vector3(0, 0.8, 0));
  }
};
