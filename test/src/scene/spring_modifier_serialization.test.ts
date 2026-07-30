import { DRef, MemoryFS, Vector3 } from '@zephyr3d/base';
import {
  MultiChainSpringSystem,
  ResourceManager,
  Scene,
  SceneNode,
  Skeleton,
  SpringChain,
  SpringModifier,
  SpringSystem,
  createCapsuleCollider,
  createPlaneCollider,
  createSphereCollider
} from '@zephyr3d/scene';

jest.mock('@zephyr3d/scene/app/api', () => ({
  getDevice: jest.fn(() => ({
    createTexture2D: (_format: string, width: number, height: number) => ({
      width,
      height,
      update: () => undefined,
      dispose: () => undefined
    })
  }))
}));

function appendNode(parent: SceneNode, name: string, y = 0) {
  const node = new SceneNode(parent.scene);
  node.name = name;
  node.position.y = y;
  node.parent = parent;
  return node;
}

function createSkeleton(model: SceneNode, joints: SceneNode[]) {
  const skeleton = new Skeleton(
    joints,
    joints.map(() => model.worldMatrix.clone()),
    joints.map((node) => ({
      position: node.position.clone(),
      rotation: node.rotation.clone(),
      scale: node.scale.clone()
    }))
  );
  model.animationSet.skeletons.push(new DRef(skeleton));
  return skeleton;
}

describe('SpringModifier serialization', () => {
  let updateJointMatricesSpy: jest.SpyInstance;

  beforeAll(() => {
    updateJointMatricesSpy = jest
      .spyOn(Skeleton.prototype as any, 'updateJointMatrices')
      .mockImplementation(() => undefined);
  });

  afterAll(() => {
    updateJointMatricesSpy.mockRestore();
  });

  it('round-trips multi-chain spring modifiers through SceneNode serialization', async () => {
    const scene = new Scene();
    const model = appendNode(scene.rootNode, 'model');
    const rootA = appendNode(model, 'rootA');
    const midA = appendNode(rootA, 'midA', 1);
    const tipA = appendNode(midA, 'tipA', 1);
    const rootB = appendNode(model, 'rootB');
    const tipB = appendNode(rootB, 'tipB', 1.5);
    const endAnchor = appendNode(model, 'endAnchor', 2);
    const colliderNode = appendNode(model, 'colliderNode', 0.5);
    const skeleton = createSkeleton(model, [rootA, midA, tipA, rootB, tipB]);

    const chainA = SpringChain.fromBoneChain(rootA, tipA, {
      mass: 1.25,
      damping: 0.87,
      stiffness: 0.73
    });
    chainA.particles[chainA.particles.length - 1].fixed = true;
    chainA.particles[chainA.particles.length - 1].anchorNode = endAnchor;
    chainA.particles[chainA.particles.length - 1].anchorOffset = new Vector3(0.1, 0.2, 0.3);
    chainA.constraints[0].compliance = 0.0002;
    const chainB = SpringChain.fromBoneChain(rootB, tipB, {
      mass: 0.8,
      damping: 0.91,
      stiffness: 0.66
    });

    const system = new MultiChainSpringSystem({
      iterations: 8,
      gravity: new Vector3(0, -4.5, 0),
      wind: new Vector3(0.2, 0, -0.1),
      enableInertialForces: false,
      centrifugalScale: 1.7,
      coriolisScale: 0.4,
      solver: 'xpbd',
      poseFollow: 0.3,
      poseFollowRoot: 0.22,
      poseFollowTip: 0.08,
      poseFollowExponent: 2.1,
      maxPoseOffset: 0.5,
      maxPoseOffsetRoot: 0.25,
      maxPoseOffsetTip: 0.7
    });
    system.addChain(chainA);
    system.addChain(chainB);
    system.addInterChainConstraint({
      chainAIndex: 0,
      chainBIndex: 1,
      particleAIndex: 1,
      particleBIndex: 1,
      restLength: 0.45,
      stiffness: 0.6,
      compliance: 0.0001,
      lambda: 3
    });
    const sphere = createSphereCollider(new Vector3(0.1, 0.2, 0.3), 0.4, colliderNode);
    sphere.enabled = false;
    system.addCollider(sphere);
    system.addCollider(createCapsuleCollider(new Vector3(0, 0, 0), new Vector3(0, 1, 0), 0.2, colliderNode));
    system.addCollider(createPlaneCollider(new Vector3(0, -1, 0), new Vector3(0, 1, 0)));

    const modifier = new SpringModifier(system as any, 0.65);
    modifier.enabled = false;
    skeleton.modifiers.push(modifier);

    const manager = new ResourceManager(new MemoryFS());
    const serialized = await manager.serializeObject(model);
    const container = new SceneNode(scene);
    container.remove();
    const restored = (await manager.deserializeObject<SceneNode>(container, serialized))!;
    restored.parent = scene.rootNode;

    const restoredRig = restored.animationSet.rigs[0].get()!;
    const restoredModifier = restoredRig.modifiers[0] as SpringModifier;
    const restoredSystem = restoredModifier.springSystem as any as MultiChainSpringSystem;

    expect(restoredModifier).toBeInstanceOf(SpringModifier);
    expect(restoredModifier.enabled).toBe(false);
    expect(restoredModifier.weight).toBeCloseTo(0.65);
    expect(restoredSystem).toBeInstanceOf(MultiChainSpringSystem);
    expect(restoredSystem.iterations).toBe(8);
    expect(restoredSystem.gravity.y).toBeCloseTo(-4.5);
    expect(restoredSystem.wind.x).toBeCloseTo(0.2);
    expect(restoredSystem.enableInertialForces).toBe(false);
    expect(restoredSystem.centrifugalScale).toBeCloseTo(1.7);
    expect(restoredSystem.coriolisScale).toBeCloseTo(0.4);
    expect(restoredSystem.solver).toBe('xpbd');
    expect(restoredSystem.poseFollowRoot).toBeCloseTo(0.22);
    expect(restoredSystem.poseFollowTip).toBeCloseTo(0.08);
    expect(restoredSystem.poseFollowExponent).toBeCloseTo(2.1);
    expect(restoredSystem.maxPoseOffsetRoot).toBeCloseTo(0.25);
    expect(restoredSystem.maxPoseOffsetTip).toBeCloseTo(0.7);
    expect(restoredSystem.chains).toHaveLength(2);
    expect(restoredSystem.chains[0].particles.map((particle) => particle.node?.name)).toEqual([
      'rootA',
      'midA',
      'tipA'
    ]);
    expect(restoredSystem.chains[0].particles[2].anchorNode?.name).toBe('endAnchor');
    expect(restoredSystem.chains[0].particles[2].anchorOffset?.z).toBeCloseTo(0.3);
    expect(restoredSystem.chains[0].particles[1].mass).toBeCloseTo(1.25);
    expect(restoredSystem.chains[0].particles[1].damping).toBeCloseTo(0.87);
    expect(restoredSystem.chains[0].constraints[0].stiffness).toBeCloseTo(0.73);
    expect(restoredSystem.chains[0].constraints[0].compliance).toBeCloseTo(0.0002);
    expect(restoredSystem.interChainConstraints).toHaveLength(1);
    expect(restoredSystem.interChainConstraints[0].restLength).toBeCloseTo(0.45);
    expect(restoredSystem.interChainConstraints[0].lambda).toBe(0);
    expect(restoredSystem.colliders).toHaveLength(3);
    expect(restoredSystem.colliders[0].type).toBe('sphere');
    expect(restoredSystem.colliders[0].node?.name).toBe('colliderNode');
    expect(restoredSystem.colliders[0].enabled).toBe(false);
    expect((restoredSystem.colliders[0] as any).localOffset.z).toBeCloseTo(0.3);
    expect(restoredSystem.colliders[1].type).toBe('capsule');
    expect(restoredSystem.colliders[2].type).toBe('plane');
  });

  it('preserves the single-chain SpringSystem type', async () => {
    const scene = new Scene();
    const model = appendNode(scene.rootNode, 'model');
    const root = appendNode(model, 'root');
    const tip = appendNode(root, 'tip', 1);
    const skeleton = createSkeleton(model, [root, tip]);
    const system = new SpringSystem(SpringChain.fromBoneChain(root, tip), {
      solver: 'verlet',
      iterations: 3
    });
    skeleton.modifiers.push(new SpringModifier(system, 0.4));

    const manager = new ResourceManager(new MemoryFS());
    const serialized = await manager.serializeObject(model);
    const container = new SceneNode(scene);
    container.remove();
    const restored = (await manager.deserializeObject<SceneNode>(container, serialized))!;
    const restoredModifier = restored.animationSet.rigs[0].get()!.modifiers[0] as SpringModifier;

    expect(restoredModifier.springSystem).toBeInstanceOf(SpringSystem);
    expect(restoredModifier.springSystem.iterations).toBe(3);
    expect(restoredModifier.weight).toBeCloseTo(0.4);
  });
});
