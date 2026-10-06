import { MemoryFS, Vector3 } from '@zephyr3d/base';
import {
  CharacterController,
  Collider,
  Joint,
  NodePhysics,
  ResourceManager,
  RigidBody,
  Scene,
  SceneNode,
  setPhysicsWorldFactory,
  Wheel
} from '@zephyr3d/scene';

// No physics package is loaded in this file: physics data is plain data.
beforeAll(() => {
  setPhysicsWorldFactory(null);
});

describe('node physics without a physics engine', () => {
  it('leaves scenes without a world, and keeps the data editable', () => {
    const scene = new Scene();
    const node = new SceneNode(scene);
    node.physics = new NodePhysics();
    const body = new RigidBody();
    body.mass = 5;
    node.physics.body = body;
    const collider = node.physics.addCollider(new Collider());
    expect(scene.physicsWorld).toBeNull();
    expect(body.world).toBeNull();
    expect(body.node).toBe(node);
    expect(collider.node).toBe(node);
    expect(node.physics.parts).toEqual([body, collider]);
    expect(collider.ready).toBe(false);
  });

  it('keeps a part on one node only', () => {
    const scene = new Scene();
    const a = new SceneNode(scene);
    const b = new SceneNode(scene);
    a.physics = new NodePhysics();
    b.physics = new NodePhysics();
    const collider = a.physics.addCollider(new Collider());
    expect(() => b.physics!.addCollider(collider)).toThrow();
    a.physics.removeCollider(collider);
    expect(collider.node).toBeNull();
    b.physics.addCollider(collider);
    expect(collider.node).toBe(b);
    const data = a.physics;
    expect(() => (b.physics = data)).toThrow();
  });

  it('disposes the data it replaces', () => {
    const scene = new Scene();
    const node = new SceneNode(scene);
    const first = new NodePhysics();
    const body = new RigidBody();
    first.body = body;
    node.physics = first;
    node.physics = new NodePhysics();
    expect(first.disposed).toBe(true);
    expect(body.disposed).toBe(true);
  });

  it('saves and loads every part', async () => {
    const scene = new Scene();
    const manager = new ResourceManager(new MemoryFS());
    const node = new SceneNode(scene);
    node.physics = new NodePhysics();
    const body = new RigidBody();
    body.motionType = 'kinematic';
    body.mass = 3;
    node.physics.body = body;
    const collider = new Collider();
    collider.shape = 'sphere';
    collider.radius = 0.25;
    collider.isTrigger = true;
    node.physics.addCollider(collider);
    const second = new Collider();
    second.size = new Vector3(1, 2, 3);
    node.physics.addCollider(second);
    const joint = new Joint();
    joint.type = 'hinge';
    node.physics.joint = joint;
    const wheelNode = new SceneNode(scene);
    wheelNode.parent = node;
    wheelNode.physics = new NodePhysics();
    const wheel = new Wheel();
    wheel.radius = 0.4;
    wheelNode.physics.wheel = wheel;
    const serialized = await manager.serializeObject(node);
    const restored = (await manager.deserializeObject<SceneNode>(new SceneNode(scene), serialized))!;
    const physics = restored.physics!;
    expect(physics).toBeInstanceOf(NodePhysics);
    const rb = physics.body as RigidBody;
    expect(rb).toBeInstanceOf(RigidBody);
    expect(rb.motionType).toBe('kinematic');
    expect(rb.mass).toBe(3);
    expect(physics.colliders.length).toBe(2);
    expect(physics.colliders[0].shape).toBe('sphere');
    expect(physics.colliders[0].radius).toBe(0.25);
    expect(physics.colliders[0].isTrigger).toBe(true);
    expect(physics.colliders[1].size.y).toBe(2);
    expect(physics.joint!.type).toBe('hinge');
    expect(physics.vehicle).toBeNull();
    const restoredWheel = restored.children[0].physics!.wheel!;
    expect(restoredWheel.radius).toBe(0.4);
    expect(restoredWheel.node).toBe(restored.children[0]);
  });

  it('saves a character controller as the body', async () => {
    const scene = new Scene();
    const manager = new ResourceManager(new MemoryFS());
    const node = new SceneNode(scene);
    node.physics = new NodePhysics();
    const cc = new CharacterController();
    cc.height = 1.5;
    node.physics.body = cc;
    const restored = (await manager.deserializeObject<SceneNode>(
      new SceneNode(scene),
      await manager.serializeObject(node)
    ))!;
    const body = restored.physics!.body as CharacterController;
    expect(body).toBeInstanceOf(CharacterController);
    expect(body.height).toBe(1.5);
  });

  it('saves nothing for nodes without physics', async () => {
    const scene = new Scene();
    const manager = new ResourceManager(new MemoryFS());
    const node = new SceneNode(scene);
    const restored = (await manager.deserializeObject<SceneNode>(
      new SceneNode(scene),
      await manager.serializeObject(node)
    ))!;
    expect(restored.physics).toBeNull();
  });
});
