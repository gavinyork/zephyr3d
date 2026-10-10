import { Vector3 } from '@zephyr3d/base';
import { Collider, FoliageSystem, NodePhysics, RigidBody, Scene, SceneNode } from '@zephyr3d/scene';
import * as RAPIER from '@dimforge/rapier3d-simd-compat';
import type { PhysicsSimulation } from '@zephyr3d/physics';
import { initPhysics } from '@zephyr3d/physics';
import { rapierPhysics } from '@zephyr3d/physics-rapier';

beforeAll(async () => {
  await RAPIER.init();
  await initPhysics(rapierPhysics, { rapier: RAPIER });
});

/** A world as the editor has it: never stepped */
function editorWorld(scene: Scene) {
  const world = scene.physicsWorld as PhysicsSimulation;
  world.enabled = false;
  return world;
}

function addBox(scene: Scene, parent: SceneNode | null, y: number, size: number) {
  const node = new SceneNode(scene);
  if (parent) {
    node.parent = parent;
  }
  node.position.setXYZ(0, y, 0);
  const collider = new Collider();
  collider.size = new Vector3(size, 1, size);
  node.physics = new NodePhysics({ colliders: [collider] });
  return node;
}

describe('physics for foliage on any surface', () => {
  it('sees colliders added since the last step once synchronized, without stepping', () => {
    const scene = new Scene();
    const world = editorWorld(scene);
    addBox(scene, null, 0, 20);
    const from = new Vector3(0, 10, 0);
    const down = new Vector3(0, -1, 0);
    expect(world.raycast(from, down)).toBeNull();
    world.syncWithScene();
    expect(world.raycast(from, down)!.point.y).toBeCloseTo(0.5, 4);
    // A moved static collider too
    const ledge = addBox(scene, null, 3, 4);
    world.syncWithScene();
    expect(world.raycast(from, down)!.point.y).toBeCloseTo(3.5, 4);
    ledge.position.setXYZ(0, 5, 0);
    world.syncWithScene();
    expect(world.raycast(from, down)!.point.y).toBeCloseTo(5.5, 4);
  });

  it('moves no body when synchronizing', () => {
    const scene = new Scene();
    const world = editorWorld(scene);
    addBox(scene, null, 0, 20);
    const ball = new SceneNode(scene);
    ball.position.setXYZ(0, 5, 0);
    const body = new RigidBody();
    body.initialLinearVelocity = new Vector3(3, 0, 0);
    const collider = new Collider();
    collider.shape = 'sphere';
    ball.physics = new NodePhysics({ body, colliders: [collider] });
    for (let i = 0; i < 5; i++) {
      world.syncWithScene();
    }
    expect(ball.position.x).toBeCloseTo(0, 6);
    expect(ball.position.y).toBeCloseTo(5, 6);
    expect(world.raycast(new Vector3(0, 10, 0), new Vector3(0, -1, 0))!.node).toBe(ball);
  });

  it('tells the colliders of foliage chunks apart, so instances do not grow on each other', () => {
    const scene = new Scene();
    const world = editorWorld(scene);
    const ground = addBox(scene, null, 0, 20);
    const foliage = new FoliageSystem(scene);
    // A chunk collider body as the foliage system builds them: sealed, a direct child
    const chunk = new SceneNode(scene);
    chunk.sealed = true;
    chunk.parent = foliage;
    const body = new RigidBody();
    body.motionType = 'static';
    chunk.physics = new NodePhysics({ body });
    const instance = addBox(scene, chunk, 2, 2);
    instance.sealed = true;
    world.syncWithScene();
    const hits = world.raycastAll(new Vector3(0, 10, 0), new Vector3(0, -1, 0));
    expect(hits.map((h) => h.node)).toEqual([instance, ground]);
    expect(foliage.ownsNode(hits[0].node)).toBe(true);
    expect(foliage.ownsNode(hits[1].node)).toBe(false);
    expect(hits.find((h) => !foliage.ownsNode(h.node))!.node).toBe(ground);
  });
});
