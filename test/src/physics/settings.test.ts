import { MemoryFS, Vector3 } from '@zephyr3d/base';
import { ResourceManager, Scene, ScenePhysicsSettings, SceneNode } from '@zephyr3d/scene';
import * as RAPIER from '@dimforge/rapier3d-simd-compat';
import { Collider, initPhysics, isPhysicsReady, PhysicsWorld, registerPhysics, RigidBody } from '@zephyr3d/physics';

const DT = 1 / 60;

function run(world: PhysicsWorld, seconds: number) {
  const frames = Math.round(seconds / DT);
  for (let i = 0; i < frames; i++) {
    world.update(DT);
  }
}

describe('physics registration and scene settings', () => {
  it('registers the components without loading the engine', () => {
    const manager = new ResourceManager(new MemoryFS());
    registerPhysics(manager);
    registerPhysics(manager);
    expect(isPhysicsReady()).toBe(false);
    expect(manager.getClassByConstructor(RigidBody)?.name).toBe('RigidBody');
    expect(manager.getClassByConstructor(Collider)?.name).toBe('Collider');
  });

  describe('with the engine loaded', () => {
    beforeAll(async () => {
      await RAPIER.init();
      await initPhysics({ rapier: RAPIER });
    });

    it('uses the defaults for a scene without settings', () => {
      const scene = new Scene();
      expect(scene.physicsSettings).toBeNull();
      const world = PhysicsWorld.get(scene);
      expect(world.gravity.y).toBeCloseTo(-9.81, 5);
      expect(world.fixedTimeStep).toBeCloseTo(1 / 60, 8);
      expect(world.maxSubSteps).toBe(4);
      expect(world.getLayerCollision(3, 5)).toBe(true);
      expect(world.layerNames[0]).toBe('Default');
    });

    it('applies scene settings and later changes to them', () => {
      const scene = new Scene();
      const settings = new ScenePhysicsSettings();
      settings.gravity = new Vector3(0, -1, 0);
      settings.setLayerName(2, 'Debris');
      settings.setLayerCollision(1, 2, false);
      scene.physicsSettings = settings;
      const world = PhysicsWorld.get(scene);
      world.enabled = false;
      expect(world.gravity.y).toBeCloseTo(-1, 5);
      expect(world.layerNames[2]).toBe('Debris');
      expect(world.getLayerCollision(2, 1)).toBe(false);

      // A falling body follows the scene's gravity, and a change to it.
      const node = new SceneNode(scene);
      node.position.setXYZ(0, 100, 0);
      node.addComponent(new RigidBody());
      node.addComponent(new Collider());
      world.interpolation = false;
      run(world, 1);
      expect(node.getComponent(RigidBody)!.getLinearVelocity().y).toBeCloseTo(-1, 2);
      settings.gravity = new Vector3(0, -20, 0);
      run(world, 1);
      expect(node.getComponent(RigidBody)!.getLinearVelocity().y).toBeCloseTo(-21, 1);

      // Changes made to the world directly last until the settings change.
      world.maxSubSteps = 9;
      run(world, 0.1);
      expect(world.maxSubSteps).toBe(9);
      settings.maxSubSteps = 2;
      run(world, 0.1);
      expect(world.maxSubSteps).toBe(2);

      // Removing the settings restores the defaults.
      scene.physicsSettings = null;
      run(world, 0.1);
      expect(world.gravity.y).toBeCloseTo(-9.81, 5);
      expect(world.getLayerCollision(1, 2)).toBe(true);
      expect(world.layerNames[2]).toBe('Layer 2');
    });

    it('round-trips scene settings and loads a mismatched matrix symmetrically', async () => {
      const manager = new ResourceManager(new MemoryFS());
      registerPhysics(manager);
      const scene = new Scene();
      const settings = new ScenePhysicsSettings();
      settings.gravity = new Vector3(1, -3, 0);
      settings.fixedTimeStep = 1 / 120;
      settings.maxSubSteps = 6;
      settings.interpolation = false;
      settings.waitForCollidersOnStart = false;
      settings.setLayerName(15, 'Ghost "quoted"');
      settings.setLayerCollision(15, 0, false);
      scene.physicsSettings = settings;
      const data = await manager.serializeObject(scene);
      const restored = (await manager.deserializeObject<Scene>(new Scene(), data))!;
      const r = restored.physicsSettings!;
      expect(r).toBeInstanceOf(ScenePhysicsSettings);
      expect(r.gravity.x).toBeCloseTo(1, 5);
      expect(r.gravity.y).toBeCloseTo(-3, 5);
      expect(r.fixedTimeStep).toBeCloseTo(1 / 120, 8);
      expect(r.maxSubSteps).toBe(6);
      expect(r.interpolation).toBe(false);
      expect(r.waitForCollidersOnStart).toBe(false);
      expect(r.getLayerName(15)).toBe('Ghost "quoted"');
      expect(r.getLayerName(1)).toBe('Layer 1');
      expect(r.getLayerCollision(0, 15)).toBe(false);
      expect(r.getLayerCollision(0, 14)).toBe(true);

      const loose = new ScenePhysicsSettings();
      // Layer 0 says it ignores layer 1; layer 1 does not: the pair collides.
      loose.layerMatrixData = `${0xffff & ~2},65535,${0xffff & ~8},${0xffff & ~4}`;
      expect(loose.getLayerCollision(0, 1)).toBe(true);
      expect(loose.getLayerCollision(1, 0)).toBe(true);
      expect(loose.getLayerCollision(2, 3)).toBe(false);
      expect(loose.getLayerCollision(3, 2)).toBe(false);

      const plain = (await manager.deserializeObject<Scene>(
        new Scene(),
        await manager.serializeObject(new Scene())
      ))!;
      expect(plain.physicsSettings).toBeNull();
    });

    it('does not step on its own while simulation is disabled', () => {
      const scene = new Scene();
      PhysicsWorld.get(scene);
      const node = new SceneNode(scene);
      node.position.setXYZ(0, 10, 0);
      node.addComponent(new RigidBody());
      node.addComponent(new Collider());
      PhysicsWorld.simulationEnabled = false;
      try {
        for (let i = 0; i < 30; i++) {
          scene.dispatchEvent('afterupdate', scene);
        }
        expect(node.position.y).toBe(10);
      } finally {
        PhysicsWorld.simulationEnabled = true;
      }
    });
  });
});
