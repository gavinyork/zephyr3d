import { MemoryFS, Quaternion, Vector3 } from '@zephyr3d/base';
import { ResourceManager, Scene, SceneNode } from '@zephyr3d/scene';
import * as RAPIER from '@dimforge/rapier3d-simd-compat';
import {
  CharacterController,
  Collider,
  initPhysics,
  Joint,
  PhysicsWorld,
  registerPhysics,
  RigidBody
} from '@zephyr3d/physics';

const DT = 1 / 60;

beforeAll(async () => {
  await RAPIER.init();
  await initPhysics({ rapier: RAPIER });
});

function makeWorld(scene: Scene, gravity = true) {
  const world = PhysicsWorld.get(scene);
  world.enabled = false;
  world.interpolation = false;
  if (!gravity) {
    world.gravity = Vector3.zero();
  }
  return world;
}

function run(world: PhysicsWorld, seconds: number, each?: () => void) {
  const frames = Math.round(seconds / DT);
  for (let i = 0; i < frames; i++) {
    world.update(DT);
    each?.();
  }
}

function addBox(
  scene: Scene,
  position: Vector3,
  size = new Vector3(1, 1, 1),
  motion: 'dynamic' | 'static' = 'dynamic'
) {
  const node = new SceneNode(scene);
  node.position.set(position);
  const body = new RigidBody();
  body.motionType = motion;
  node.addComponent(body);
  const c = new Collider();
  c.size = size;
  node.addComponent(c);
  return node;
}

function addBall(scene: Scene, position: Vector3, radius = 0.2) {
  const node = new SceneNode(scene);
  node.position.set(position);
  node.addComponent(new RigidBody());
  const c = new Collider();
  c.shape = 'sphere';
  c.radius = radius;
  node.addComponent(c);
  return node;
}

function addStatic(scene: Scene, position: Vector3, size: Vector3, rotation?: Quaternion) {
  const node = new SceneNode(scene);
  node.position.set(position);
  if (rotation) {
    node.rotation = rotation;
  }
  const c = new Collider();
  c.size = size;
  node.addComponent(c);
  return node;
}

/** A joint on its own child node of `parent`, at `local`. */
function addJoint(parent: SceneNode, local: Vector3, setup: (joint: Joint) => void) {
  const node = new SceneNode(parent.scene!);
  node.parent = parent;
  node.position.set(local);
  const joint = new Joint();
  setup(joint);
  node.addComponent(joint);
  return joint;
}

/** A door 1 wide, 2 tall, hinged on a vertical axis at its left edge, x = 0. */
function door(scene: Scene, setup: (joint: Joint) => void) {
  const node = addBox(scene, new Vector3(0.5, 1, 0), new Vector3(1, 2, 0.1));
  const joint = addJoint(node, new Vector3(-0.5, 0, 0), (j) => {
    j.type = 'hinge';
    setup(j);
  });
  return { node, joint, body: node.getComponent(RigidBody)! };
}

describe('joints', () => {
  it('holds fixed bodies together as they fall', () => {
    const scene = new Scene();
    const world = makeWorld(scene);
    const a = addBox(scene, new Vector3(0, 5, 0));
    const b = addBox(scene, new Vector3(1.2, 5, 0));
    addJoint(a, Vector3.zero(), (j) => {
      j.type = 'fixed';
      j.connectedBody = b;
    });
    run(world, 0.8);
    const pa = a.getWorldPosition();
    const pb = b.getWorldPosition();
    expect(pa.y).toBeLessThan(3);
    expect(Vector3.distance(pa, pb)).toBeCloseTo(1.2, 2);
    expect(pb.y - pa.y).toBeCloseTo(0, 2);
  });

  it('swings a hinge about its pivot within its limits', () => {
    const scene = new Scene();
    const world = makeWorld(scene, false);
    const { node, joint, body } = door(scene, (j) => {
      j.limitsEnabled = true;
      j.lowerLimit = -45;
      j.upperLimit = 45;
    });
    world.update(DT);
    body.setAngularVelocity(new Vector3(0, 3, 0));
    let max = 0;
    run(world, 2, () => {
      max = Math.max(max, Math.abs(joint.angle));
      // The hinge stays on its axis: the door's left edge does not move.
      const pivot = node.worldMatrix.transformPointAffine(new Vector3(-0.5, 0, 0), new Vector3());
      expect(Math.hypot(pivot.x, pivot.z)).toBeLessThan(0.02);
    });
    expect(max).toBeGreaterThan(40);
    expect(max).toBeLessThan(47);
  });

  it('drives a hinge at a speed, and to an angle', () => {
    const scene = new Scene();
    const world = makeWorld(scene, false);
    const spun = door(scene, (j) => {
      j.motorMode = 'velocity';
      j.motorTarget = 90;
    });
    run(world, 1);
    expect(spun.joint.angle).toBeGreaterThan(75);
    expect(spun.joint.angle).toBeLessThan(95);

    const scene2 = new Scene();
    const world2 = makeWorld(scene2, false);
    const held = door(scene2, (j) => {
      j.motorMode = 'position';
      j.motorTarget = 30;
    });
    run(world2, 3);
    expect(held.joint.angle).toBeCloseTo(30, 0);
    // Positive angles turn counter-clockwise about +Y seen from above: the free
    // edge (x = +1 at rest) moves towards -Z.
    const edge = held.node.worldMatrix.transformPointAffine(new Vector3(0.5, 0, 0), new Vector3());
    expect(edge.z).toBeLessThan(-0.3);
  });

  it('keeps its zero when one of its bodies is rebuilt', () => {
    const scene = new Scene();
    const world = makeWorld(scene, false);
    const { joint, body } = door(scene, (j) => {
      j.motorMode = 'position';
      j.motorTarget = 30;
    });
    run(world, 3);
    body.mass = 3;
    body.canSleep = false;
    run(world, 2);
    expect(joint.angle).toBeCloseTo(30, 0);
  });

  it('slides along its axis up to its limit only', () => {
    const scene = new Scene();
    const world = makeWorld(scene);
    world.gravity = new Vector3(5, -9.81, 0);
    const box = addBox(scene, new Vector3(0, 3, 0));
    const joint = addJoint(box, Vector3.zero(), (j) => {
      j.type = 'slider';
      j.axis = new Vector3(1, 0, 0);
      j.limitsEnabled = true;
      j.lowerLimit = 0;
      j.upperLimit = 2;
    });
    run(world, 3);
    const p = box.getWorldPosition();
    expect(p.x).toBeCloseTo(2, 1);
    expect(p.y).toBeCloseTo(3, 2);
    expect(joint.position).toBeCloseTo(2, 1);
  });

  it('swings a ball joint pendulum at a fixed distance', () => {
    const scene = new Scene();
    const world = makeWorld(scene);
    const bob = addBall(scene, new Vector3(0, 3, 0));
    addJoint(bob, new Vector3(0, 2, 0), (j) => {
      j.type = 'ball';
    });
    world.update(DT);
    bob.getComponent(RigidBody)!.setLinearVelocity(new Vector3(3, 0, 1));
    const pivot = new Vector3(0, 5, 0);
    let maxX = 0;
    run(world, 2, () => {
      const p = bob.getWorldPosition();
      maxX = Math.max(maxX, p.x);
      expect(Vector3.distance(p, pivot)).toBeCloseTo(2, 1);
    });
    expect(maxX).toBeGreaterThan(0.5);
  });

  it('limits how far a ball joint swings', () => {
    const scene = new Scene();
    const world = makeWorld(scene);
    const bob = addBall(scene, new Vector3(0, 3, 0));
    addJoint(bob, new Vector3(0, 2, 0), (j) => {
      j.type = 'ball';
      j.limitsEnabled = true;
      j.swingLimit = 20;
    });
    world.update(DT);
    bob.getComponent(RigidBody)!.setLinearVelocity(new Vector3(6, 0, 0));
    let maxAngle = 0;
    run(world, 2, () => {
      const p = bob.getWorldPosition();
      maxAngle = Math.max(maxAngle, (Math.atan2(Math.abs(p.x), 5 - p.y) * 180) / Math.PI);
    });
    expect(maxAngle).toBeGreaterThan(15);
    expect(maxAngle).toBeLessThan(24);
  });

  it('lets a rope go slack but not longer', () => {
    const scene = new Scene();
    const world = makeWorld(scene);
    const bob = addBall(scene, new Vector3(0, 4, 0));
    addJoint(bob, Vector3.zero(), (j) => {
      j.type = 'rope';
      j.length = 2;
      j.connectedAnchor = new Vector3(0, 5, 0);
    });
    const pivot = new Vector3(0, 5, 0);
    let maxDist = 0;
    run(world, 2, () => {
      maxDist = Math.max(maxDist, Vector3.distance(bob.getWorldPosition(), pivot));
    });
    expect(maxDist).toBeLessThan(2.05);
    expect(bob.getWorldPosition().y).toBeCloseTo(3, 1);
  });

  it('settles a spring where its pull matches the weight', () => {
    const scene = new Scene();
    const world = makeWorld(scene);
    const bob = addBall(scene, new Vector3(0, 4, 0));
    addJoint(bob, Vector3.zero(), (j) => {
      j.type = 'spring';
      j.connectedAnchor = new Vector3(0, 5, 0);
      j.length = 1;
      j.stiffness = 100;
      j.damping = 10;
    });
    run(world, 6);
    // Mass 1: stretched by g / k beyond the rest length.
    expect(5 - bob.getWorldPosition().y).toBeCloseTo(1 + 9.81 / 100, 2);
  });

  it('connects once the connected node is in the scene', () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const scene = new Scene();
      const world = makeWorld(scene);
      const a = addBox(scene, new Vector3(0, 5, 0));
      const b = addBox(scene, new Vector3(1.5, 5, 0));
      b.remove();
      const joint = addJoint(a, Vector3.zero(), (j) => {
        j.type = 'fixed';
        j.connectedBody = b;
      });
      world.update(DT);
      expect(joint.error).toMatch(/not in the scene/);
      b.parent = scene.rootNode;
      run(world, 0.5);
      expect(joint.error).toBe('');
      expect(Vector3.distance(a.getWorldPosition(), b.getWorldPosition())).toBeCloseTo(1.5, 2);
    } finally {
      error.mockRestore();
    }
  });

  it('reports both ends on the same body', () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const scene = new Scene();
      const world = makeWorld(scene);
      const a = addBox(scene, new Vector3(0, 5, 0));
      const joint = addJoint(a, Vector3.zero(), (j) => {
        j.connectedBody = a;
      });
      world.update(DT);
      expect(joint.error).toMatch(/same rigid body/);
    } finally {
      error.mockRestore();
    }
  });

  it('keeps joined bodies from colliding unless asked', () => {
    const settle = (collide: boolean) => {
      const scene = new Scene();
      const world = makeWorld(scene, false);
      const a = addBox(scene, Vector3.zero(), new Vector3(1, 1, 1), 'static');
      const b = addBox(scene, new Vector3(0.6, 0, 0));
      addJoint(b, new Vector3(-0.3, 0, 0), (j) => {
        j.type = 'ball';
        j.connectedBody = a;
        j.collideConnected = collide;
      });
      run(world, 1);
      return Vector3.distance(b.getWorldPosition(), new Vector3(0.6, 0, 0));
    };
    expect(settle(false)).toBeLessThan(0.01);
    expect(settle(true)).toBeGreaterThan(0.05);
  });

  it('round-trips joints and character controllers through serialization', async () => {
    const scene = new Scene();
    const manager = new ResourceManager(new MemoryFS());
    registerPhysics(manager);
    const other = new SceneNode(scene);
    const node = new SceneNode(scene);
    const joint = new Joint();
    joint.type = 'slider';
    joint.connectedBody = other;
    joint.axis = new Vector3(1, 0, 0);
    joint.limitsEnabled = true;
    joint.upperLimit = 3;
    joint.motorMode = 'velocity';
    joint.motorTarget = 2;
    node.addComponent(joint);
    const cc = new CharacterController();
    cc.height = 1.6;
    cc.stepHeight = 0.4;
    cc.pushBodies = false;
    node.addComponent(cc);
    const restored = (await manager.deserializeObject<SceneNode>(
      new SceneNode(scene),
      await manager.serializeObject(node)
    ))!;
    const rj = restored.getComponent(Joint)!;
    expect(rj.type).toBe('slider');
    expect(rj.connectedBodyId).toBe(other.persistentId);
    expect(rj.axis.x).toBe(1);
    expect(rj.limitsEnabled).toBe(true);
    expect(rj.upperLimit).toBe(3);
    expect(rj.motorMode).toBe('velocity');
    expect(rj.motorTarget).toBe(2);
    const rc = restored.getComponent(CharacterController)!;
    expect(rc.height).toBeCloseTo(1.6);
    expect(rc.stepHeight).toBeCloseTo(0.4);
    expect(rc.pushBodies).toBe(false);
    // Its own body and capsule are not node components, so not saved.
    expect(restored.getComponent(RigidBody)).toBeFalsy();
  });
});

describe('character controller', () => {
  function addCharacter(scene: Scene, position: Vector3) {
    const node = new SceneNode(scene);
    node.name = 'hero';
    node.position.set(position);
    const cc = new CharacterController();
    node.addComponent(cc);
    return { node, cc };
  }

  /**
   * Walks with a horizontal velocity under gravity, moving from the fixed
   * update the way CharacterController's documentation shows.
   */
  function walk(
    world: PhysicsWorld,
    cc: CharacterController,
    velocity: Vector3,
    seconds: number,
    each?: () => void
  ) {
    let vy = 0;
    const handler = (dt: number) => {
      vy = cc.isGrounded ? -1 : vy - 9.81 * dt;
      cc.move(new Vector3(velocity.x * dt, vy * dt, velocity.z * dt));
    };
    world.on('fixedupdate', handler);
    run(world, seconds, each);
    world.off('fixedupdate', handler);
  }

  function ground(scene: Scene) {
    return addStatic(scene, new Vector3(0, -0.5, 0), new Vector3(40, 1, 40));
  }

  it('walks on flat ground, standing on it', () => {
    const scene = new Scene();
    const world = makeWorld(scene);
    ground(scene);
    const { node, cc } = addCharacter(scene, new Vector3(0, 0, 0));
    walk(world, cc, new Vector3(2, 0, 0), 1);
    const p = node.getWorldPosition();
    expect(p.x).toBeCloseTo(2, 1);
    expect(p.y).toBeCloseTo(0, 1);
    expect(cc.isGrounded).toBe(true);
    expect(cc.groundNormal!.y).toBeCloseTo(1, 2);
  });

  it('stops at a wall and slides along it', () => {
    const scene = new Scene();
    const world = makeWorld(scene);
    ground(scene);
    addStatic(scene, new Vector3(3, 1, 0), new Vector3(1, 2, 20));
    const { node, cc } = addCharacter(scene, new Vector3(0, 0, 0));
    walk(world, cc, new Vector3(3, 0, 1), 2);
    const p = node.getWorldPosition();
    // Wall face at x = 2.5, capsule radius 0.3.
    expect(p.x).toBeLessThan(2.25);
    expect(p.x).toBeGreaterThan(2.1);
    expect(p.z).toBeGreaterThan(1.5);
  });

  it('walks up a low step but not a high one', () => {
    const climb = (height: number) => {
      const scene = new Scene();
      const world = makeWorld(scene);
      ground(scene);
      addStatic(scene, new Vector3(3, height / 2, 0), new Vector3(2, height, 4));
      const { node, cc } = addCharacter(scene, new Vector3(0, 0, 0));
      walk(world, cc, new Vector3(2, 0, 0), 2);
      return node.getWorldPosition();
    };
    const low = climb(0.25);
    expect(low.x).toBeGreaterThan(2.5);
    expect(low.y).toBeCloseTo(0.25, 1);
    const high = climb(0.5);
    expect(high.x).toBeLessThan(2);
  });

  it('walks up gentle slopes, not steep ones, and slides down steep ones', () => {
    const slope = (degrees: number) => {
      const scene = new Scene();
      const world = makeWorld(scene);
      ground(scene);
      const angle = (degrees * Math.PI) / 180;
      // A slab rising along +X from x = 1.
      addStatic(
        scene,
        new Vector3(1 + 4 * Math.cos(angle), 4 * Math.sin(angle) - 0.5 * Math.cos(angle), 0),
        new Vector3(8, 1, 4),
        Quaternion.fromAxisAngle(Vector3.axisPZ(), angle)
      );
      return { scene, world };
    };
    const gentle = slope(30);
    const a = addCharacter(gentle.scene, new Vector3(0, 0, 0));
    walk(gentle.world, a.cc, new Vector3(2, 0, 0), 2.5);
    expect(a.node.getWorldPosition().y).toBeGreaterThan(1);

    const steep = slope(60);
    const b = addCharacter(steep.scene, new Vector3(0, 0, 0));
    walk(steep.world, b.cc, new Vector3(2, 0, 0), 2.5);
    expect(b.node.getWorldPosition().y).toBeLessThan(0.5);

    // Dropped onto the steep slope, standing still: it slides down.
    const c = addCharacter(steep.scene, new Vector3(2.5, 3.2, 0));
    const start = c.node.getWorldPosition().x;
    walk(steep.world, c.cc, Vector3.zero(), 2);
    expect(c.node.getWorldPosition().x).toBeLessThan(start - 0.3);
  });

  it('stays on the ground walking down a slope', () => {
    const scene = new Scene();
    const world = makeWorld(scene);
    const angle = (20 * Math.PI) / 180;
    // Falling along +X from y = 0 at x = 0.
    addStatic(
      scene,
      new Vector3(5 * Math.cos(angle), -5 * Math.sin(angle) - 0.5 * Math.cos(angle), 0),
      new Vector3(10, 1, 4),
      Quaternion.fromAxisAngle(Vector3.axisPZ(), -angle)
    );
    const { node, cc } = addCharacter(scene, new Vector3(0.5, 0.1, 0));
    walk(world, cc, Vector3.zero(), 0.5);
    let airborne = 0;
    walk(world, cc, new Vector3(3, 0, 0), 2, () => {
      airborne += cc.isGrounded ? 0 : 1;
    });
    expect(node.getWorldPosition().x).toBeGreaterThan(5);
    expect(airborne).toBe(0);
  });

  it('pushes dynamic bodies it walks into', () => {
    const scene = new Scene();
    const world = makeWorld(scene);
    ground(scene);
    const box = addBox(scene, new Vector3(2, 0.5, 0));
    const { cc } = addCharacter(scene, new Vector3(0, 0, 0));
    walk(world, cc, new Vector3(2, 0, 0), 2);
    expect(box.getWorldPosition().x).toBeGreaterThan(2.5);
  });

  it('raises trigger events on the controller', () => {
    const scene = new Scene();
    const world = makeWorld(scene);
    ground(scene);
    const zone = new SceneNode(scene);
    zone.name = 'zone';
    zone.position.setXYZ(2, 1, 0);
    const zc = new Collider();
    zc.size = new Vector3(1, 2, 2);
    zc.isTrigger = true;
    zone.addComponent(zc);
    const { cc } = addCharacter(scene, new Vector3(0, 0, 0));
    const log: string[] = [];
    cc.on('triggerenter', (e) => void log.push(`enter ${e.otherNode?.name}`));
    cc.on('triggerexit', (e) => void log.push(`exit ${e.otherNode?.name}`));
    zc.on('triggerenter', (e) => void log.push(`zone sees ${e.other === cc ? 'controller' : 'other'}`));
    walk(world, cc, new Vector3(2, 0, 0), 2.5);
    expect([...log].sort()).toEqual(['enter zone', 'exit zone', 'zone sees controller']);
    expect(log.indexOf('enter zone')).toBeLessThan(log.indexOf('exit zone'));
  });

  it('moves the same way on every run', () => {
    const simulate = () => {
      const scene = new Scene();
      const world = makeWorld(scene);
      ground(scene);
      addStatic(scene, new Vector3(3, 0.15, 0.5), new Vector3(1, 0.3, 1));
      addBox(scene, new Vector3(2, 0.5, -1));
      const { node, cc } = addCharacter(scene, new Vector3(0, 0, 0));
      walk(world, cc, new Vector3(2, 0, -0.3), 3);
      const p = node.getWorldPosition();
      return [p.x, p.y, p.z];
    };
    expect(simulate()).toEqual(simulate());
  });
});
