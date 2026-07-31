import { Quaternion, Vector3 } from '@zephyr3d/base';
import { MultiChainSpringSystem, Scene, SceneNode, SpringChain, SpringSystem } from '@zephyr3d/scene';

type TestSpringSystem = Pick<SpringSystem, 'update' | 'applyToNodes'>;

function appendNode(parent: SceneNode, name: string, position: Vector3) {
  const node = new SceneNode(parent.scene);
  node.name = name;
  node.position.set(position);
  node.parent = parent;
  return node;
}

function createChainFixture(createSystem: (chain: SpringChain) => TestSpringSystem) {
  const scene = new Scene();
  const parent = appendNode(scene.rootNode, 'parent', Vector3.zero());
  const root = appendNode(parent, 'root', Vector3.zero());
  const mid = appendNode(root, 'mid', new Vector3(1, 0, 0));
  const tip = appendNode(mid, 'tip', new Vector3(1, 0, 0));
  const chain = SpringChain.fromBoneChain(root, tip);
  return { scene, parent, root, chain, system: createSystem(chain) };
}

const systemFactories: Array<[string, (chain: SpringChain) => TestSpringSystem]> = [
  ['SpringSystem', (chain) => new SpringSystem(chain, { enableInertialForces: false })],
  [
    'MultiChainSpringSystem',
    (chain) => {
      const system = new MultiChainSpringSystem({ enableInertialForces: false });
      system.addChain(chain);
      return system;
    }
  ]
];

describe.each(systemFactories)('%s input pose tracking', (_name, createSystem) => {
  it('keeps the authored target pose stable across unanimated simulation frames', () => {
    const fixture = createChainFixture(createSystem);
    try {
      for (let frame = 0; frame < 240; frame++) {
        fixture.system.update(1 / 60);
        fixture.system.applyToNodes(1);
      }

      expect(fixture.chain.particles[1].animPosition.x).toBeCloseTo(1);
      expect(fixture.chain.particles[1].animPosition.y).toBeCloseTo(0);
      expect(fixture.chain.particles[2].animPosition.x).toBeCloseTo(2);
      expect(fixture.chain.particles[2].animPosition.y).toBeCloseTo(0);
    } finally {
      fixture.scene.dispose();
    }
  });

  it('does not feed the previous spring output back into an unanimated target pose', () => {
    const fixture = createChainFixture(createSystem);
    try {
      fixture.chain.particles[1].position.setXYZ(1, -1, 0);
      fixture.chain.particles[2].position.setXYZ(2, -2, 0);
      fixture.system.applyToNodes(1);
      expect(Math.abs(fixture.root.rotation.z)).toBeGreaterThan(0.1);

      fixture.system.update(1 / 60);

      expect(fixture.chain.particles[1].animPosition.x).toBeCloseTo(1);
      expect(fixture.chain.particles[1].animPosition.y).toBeCloseTo(0);
      expect(fixture.root.rotation.equalsTo(Quaternion.identity())).toBe(true);
    } finally {
      fixture.scene.dispose();
    }
  });

  it('keeps an external parent pose while restoring unanimated spring joint rotations', () => {
    const fixture = createChainFixture(createSystem);
    try {
      fixture.chain.particles[1].position.setXYZ(1, -1, 0);
      fixture.chain.particles[2].position.setXYZ(2, -2, 0);
      fixture.system.applyToNodes(1);
      fixture.parent.rotation.set(Quaternion.fromAxisAngle(Vector3.axisPZ(), Math.PI / 2));

      fixture.system.update(1 / 60);

      expect(fixture.chain.particles[1].animPosition.x).toBeCloseTo(0);
      expect(fixture.chain.particles[1].animPosition.y).toBeCloseTo(1);
    } finally {
      fixture.scene.dispose();
    }
  });

  it('accepts a new upstream rotation written directly to a spring joint', () => {
    const fixture = createChainFixture(createSystem);
    try {
      fixture.chain.particles[1].position.setXYZ(1, -1, 0);
      fixture.chain.particles[2].position.setXYZ(2, -2, 0);
      fixture.system.applyToNodes(1);
      fixture.root.rotation.set(Quaternion.fromAxisAngle(Vector3.axisPZ(), Math.PI / 2));

      fixture.system.update(1 / 60);

      expect(fixture.chain.particles[1].animPosition.x).toBeCloseTo(0);
      expect(fixture.chain.particles[1].animPosition.y).toBeCloseTo(1);
      expect(fixture.root.rotation.equalsTo(Quaternion.fromAxisAngle(Vector3.axisPZ(), Math.PI / 2))).toBe(
        true
      );
    } finally {
      fixture.scene.dispose();
    }
  });
});
