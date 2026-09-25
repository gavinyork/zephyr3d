import { Vector3 } from '@zephyr3d/base';
import {
  MultiChainSpringSystem,
  Scene,
  SceneNode,
  SpringChain,
  SpringModifier,
  SpringSystem,
  createCapsuleCollider,
  createSphereCollider,
  createSpringConstraint,
  createSpringParticle,
  resolveCapsuleCollision,
  resolveSphereCollision
} from '../../../libs/scene/src';
import {
  getParentRelativePoseTarget,
  solveAngleLimit,
  solveDistanceConstraint
} from '../../../libs/scene/src/animation/spring/spring_solver';

function appendNode(parent: SceneNode, name: string, position: Vector3) {
  const node = new SceneNode(parent.scene);
  node.name = name;
  node.position.set(position);
  node.parent = parent;
  return node;
}

describe('Kawaii spring solver', () => {
  it('holds the animated pose during startup and reinitializes before simulation', () => {
    let reinitializeCount = 0;
    let updateCount = 0;
    let applyCount = 0;
    const system = {
      reinitializeFromCurrentPose: () => reinitializeCount++,
      update: () => updateCount++,
      applyToNodes: () => applyCount++,
      reset: () => undefined
    };
    const modifier = new SpringModifier(system as any, 1, 0.1);

    modifier.apply(null as any, 0.04);
    modifier.apply(null as any, 0.04);
    modifier.apply(null as any, 0.04);

    expect(reinitializeCount).toBe(3);
    expect(updateCount).toBe(0);
    expect(applyCount).toBe(0);

    modifier.apply(null as any, 1 / 60);
    expect(updateCount).toBe(1);
    expect(applyCount).toBe(1);

    modifier.restartSimulation(0.01);
    modifier.apply(null as any, 1 / 60);
    expect(reinitializeCount).toBe(4);
    expect(updateCount).toBe(1);
  });

  it('uses Kawaii motion by default and retains an explicit legacy fallback', () => {
    const kawaii = new MultiChainSpringSystem();
    const legacy = new MultiChainSpringSystem({ motionModel: 'legacy' });

    expect(kawaii.motionModel).toBe('kawaii');
    expect(kawaii.constraintVelocityHistoryRetention).toBeCloseTo(0.35);
    expect(kawaii.preserveInitialCollisionPenetration).toBe(true);
    expect(kawaii.initialCollisionPenetrationReleaseTime).toBeCloseTo(0.25);
    expect(legacy.motionModel).toBe('legacy');
  });

  it.each(['single', 'multi'] as const)(
    'smoothly releases authored collider overlap in the %s-chain system',
    (systemType) => {
      const chain = new SpringChain();
      const particle = createSpringParticle(new Vector3(0.75, 0, 0), { damping: 1 });
      chain.addParticle(particle);
      const options = {
        gravity: Vector3.zero(),
        enableInertialForces: false,
        solver: 'xpbd' as const,
        poseFollowRoot: 0,
        poseFollowTip: 0,
        preserveInitialCollisionPenetration: true,
        initialCollisionPenetrationReleaseTime: 0.1
      };
      const system =
        systemType === 'single' ? new SpringSystem(chain, options) : new MultiChainSpringSystem(options);
      if (system instanceof MultiChainSpringSystem) {
        system.addChain(chain);
      }
      system.addCollider(createSphereCollider(Vector3.zero(), 1));

      system.update(1 / 60);
      expect(particle.position.x).toBeCloseTo(0.75);

      for (let frame = 0; frame < 3; frame++) {
        system.update(1 / 60);
      }
      expect(particle.position.x).toBeGreaterThan(0.8);
      expect(particle.position.x).toBeLessThan(0.95);

      for (let frame = 0; frame < 4; frame++) {
        system.update(1 / 60);
      }
      expect(particle.position.x).toBeCloseTo(1);
    }
  );

  it('resolves sphere and capsule collisions inside the former one-centimeter blind zone', () => {
    const spherePosition = new Vector3(0.005, 0, 0);
    expect(resolveSphereCollision(spherePosition, createSphereCollider(Vector3.zero(), 1))).toBe(true);
    expect(spherePosition.x).toBeCloseTo(1);

    const capsule = createCapsuleCollider(new Vector3(-1, 0, 0), new Vector3(1, 0, 0), 0.5);
    const nearAxisPosition = new Vector3(0, 0.005, 0);
    expect(resolveCapsuleCollision(nearAxisPosition, capsule)).toBe(true);
    expect(nearAxisPosition.y).toBeCloseTo(0.5);

    const onAxisPosition = Vector3.zero();
    expect(resolveCapsuleCollision(onAxisPosition, capsule)).toBe(true);
    expect(onAxisPosition.magnitude).toBeCloseTo(0.5);
  });

  it('settles a double-ended chain under gravity with the default XPBD history retention', () => {
    const chain = new SpringChain();
    const particleCount = 17;
    const radius = 0.2;
    for (let i = 0; i < particleCount; i++) {
      const angle = Math.PI - (Math.PI * i) / (particleCount - 1);
      const particle = createSpringParticle(
        new Vector3(Math.cos(angle) * radius, -Math.sin(angle) * radius, Math.sin(angle * 2) * 0.025),
        {
          fixed: i === 0 || i === particleCount - 1,
          damping: 0.993
        }
      );
      chain.addParticle(particle);
      if (i > 0) {
        const previous = chain.particles[i - 1];
        chain.addConstraint(
          createSpringConstraint(i - 1, i, Vector3.distance(previous.position, particle.position), 0.82, 0)
        );
      }
    }

    // Start away from equilibrium so this verifies decay rather than a static initial state.
    chain.particles[7].position.x += 0.03;
    const system = new MultiChainSpringSystem({
      gravity: new Vector3(0, -9.8, 0),
      enableInertialForces: false,
      solver: 'xpbd',
      iterations: 6,
      poseFollowRoot: 0.251,
      poseFollowTip: 0.05,
      poseFollowExponent: 1.6
    });
    system.addChain(chain);

    const previousPositions = chain.particles.map((particle) => particle.position.clone());
    let lateMotion = 0;
    for (let frame = 0; frame < 600; frame++) {
      system.update(1 / 60);
      for (let i = 0; i < chain.particles.length; i++) {
        const position = chain.particles[i].position;
        if (frame >= 450) {
          lateMotion = Math.max(lateMotion, Vector3.distance(position, previousPositions[i]));
        }
        previousPositions[i].set(position);
      }
    }

    expect(lateMotion).toBeLessThan(1e-5);
  });

  it('settles against a collider by removing inward Verlet velocity', () => {
    const chain = new SpringChain();
    const fixed = createSpringParticle(new Vector3(0, 1, 0), { fixed: true, damping: 0.993 });
    const dynamic = createSpringParticle(new Vector3(0.05, 0, 0), { damping: 0.993 });
    chain.addParticle(fixed);
    chain.addParticle(dynamic);
    chain.addConstraint(createSpringConstraint(0, 1, 1, 0.82, 0));

    const system = new MultiChainSpringSystem({
      gravity: new Vector3(0, -9.8, 0),
      enableInertialForces: false,
      solver: 'xpbd',
      iterations: 6,
      poseFollowRoot: 0.251,
      poseFollowTip: 0.05,
      preserveInitialCollisionPenetration: false
    });
    system.addChain(chain);
    const colliderCenter = new Vector3(0, -0.25, 0);
    const colliderRadius = 0.35;
    system.addCollider(createSphereCollider(colliderCenter, colliderRadius));

    const previousPosition = dynamic.position.clone();
    let lateMotion = 0;
    for (let frame = 0; frame < 600; frame++) {
      system.update(1 / 60);
      if (frame >= 450) {
        lateMotion = Math.max(lateMotion, Vector3.distance(dynamic.position, previousPosition));
      }
      previousPosition.set(dynamic.position);
    }

    expect(lateMotion).toBeLessThan(1e-5);
    expect(Vector3.distance(dynamic.position, colliderCenter)).toBeGreaterThanOrEqual(colliderRadius - 1e-6);
  });

  it('uses the simulated parent for the pose-preserving target', () => {
    const parent = createSpringParticle(new Vector3(4, -2, 0));
    parent.animPosition.setXYZ(1, 1, 0);
    const child = createSpringParticle(new Vector3(5, -2, 0));
    child.animPosition.setXYZ(3, 2, 0);

    const target = getParentRelativePoseTarget(child, parent);

    expect(target.x).toBeCloseTo(6);
    expect(target.y).toBeCloseTo(-1);
  });

  it('blends pose follow toward the nearest fixed endpoint', () => {
    const chain = new SpringChain();
    for (let i = 0; i < 5; i++) {
      const particle = createSpringParticle(new Vector3(i, 0, 0), {
        fixed: i === 0 || i === 4,
        damping: 1
      });
      if (i === 1 || i === 3) {
        particle.position.y = 1;
        particle.prevPosition.y = 1;
      }
      chain.addParticle(particle);
    }
    const system = new MultiChainSpringSystem({
      gravity: Vector3.zero(),
      enableInertialForces: false,
      poseFollowRoot: 0.8,
      poseFollowTip: 0.1,
      poseFollowExponent: 1
    });
    system.addChain(chain);

    system.update(1 / 60);

    expect(Math.abs(chain.particles[1].position.y - chain.particles[3].position.y)).toBeLessThan(0.02);
  });

  it('applies the full distance correction when the other endpoint is fixed', () => {
    const fixed = createSpringParticle(Vector3.zero(), { fixed: true });
    const dynamic = createSpringParticle(new Vector3(2, 0, 0));

    solveDistanceConstraint(fixed, dynamic, 1, 1);

    expect(dynamic.position.x).toBeCloseTo(1);
    expect(fixed.position.x).toBeCloseTo(0);
  });

  it('limits swing around the animated direction without changing segment length', () => {
    const parent = createSpringParticle(Vector3.zero(), { fixed: true });
    const child = createSpringParticle(new Vector3(0, 1, 0));
    child.animPosition.setXYZ(1, 0, 0);
    child.prevPosition.set(child.position);

    solveAngleLimit(parent, child, 30, true);

    expect(child.position.x).toBeCloseTo(Math.cos(Math.PI / 6));
    expect(child.position.y).toBeCloseTo(Math.sin(Math.PI / 6));
    expect(child.position.magnitude).toBeCloseTo(1);
    expect(child.prevPosition.equalsTo(child.position)).toBe(true);
  });

  it('keeps XPBD projection out of the next Verlet velocity', () => {
    const chain = new SpringChain();
    const fixed = createSpringParticle(Vector3.zero(), { fixed: true });
    const dynamic = createSpringParticle(new Vector3(2, 0, 0), { damping: 1 });
    chain.addParticle(fixed);
    chain.addParticle(dynamic);
    chain.addConstraint(createSpringConstraint(0, 1, 1, 1, 0));
    const system = new MultiChainSpringSystem({
      gravity: Vector3.zero(),
      enableInertialForces: false,
      solver: 'xpbd',
      poseFollowRoot: 0,
      poseFollowTip: 0,
      constraintVelocityHistoryRetention: 1
    });
    system.addChain(chain);

    system.update(1 / 60);

    expect(dynamic.position.x).toBeCloseTo(1);
    expect(dynamic.prevPosition.x).toBeCloseTo(1);
  });

  it('converges a chain constrained by fixed endpoints from both directions', () => {
    const chain = new SpringChain();
    for (let i = 0; i < 5; i++) {
      const particle = createSpringParticle(new Vector3(i, i > 0 && i < 4 ? 0.6 : 0, 0), {
        fixed: i === 0 || i === 4,
        damping: 1
      });
      chain.addParticle(particle);
      if (i > 0) {
        chain.addConstraint(createSpringConstraint(i - 1, i, 1, 1, 0));
      }
    }
    const system = new MultiChainSpringSystem({
      gravity: Vector3.zero(),
      enableInertialForces: false,
      solver: 'xpbd',
      iterations: 8,
      poseFollowRoot: 0,
      poseFollowTip: 0,
      constraintVelocityHistoryRetention: 1
    });
    system.addChain(chain);

    for (let frame = 0; frame < 10; frame++) {
      system.update(1 / 60);
    }

    const maxLengthError = Math.max(
      ...chain.constraints.map((constraint) =>
        Math.abs(
          Vector3.distance(
            chain.particles[constraint.particleA].position,
            chain.particles[constraint.particleB].position
          ) - constraint.restLength
        )
      )
    );
    expect(chain.particles[0].position.x).toBeCloseTo(0);
    expect(chain.particles[4].position.x).toBeCloseTo(4);
    expect(maxLengthError).toBeLessThan(0.01);
  });

  it('interpolates animated targets consistently across fixed substeps', () => {
    const createFixture = () => {
      const scene = new Scene();
      const root = appendNode(scene.rootNode, 'root', Vector3.zero());
      const tip = appendNode(root, 'tip', new Vector3(1, 0, 0));
      const chain = SpringChain.fromBoneChain(root, tip, { damping: 0.9, stiffness: 1 });
      const system = new MultiChainSpringSystem({
        gravity: Vector3.zero(),
        wind: Vector3.zero(),
        enableInertialForces: false,
        solver: 'xpbd',
        poseFollowRoot: 0.05,
        poseFollowTip: 0.05
      });
      system.addChain(chain);
      system.update(1 / 60);
      return { scene, root, chain, system };
    };

    const frame30 = createFixture();
    const frame60 = createFixture();
    try {
      frame30.root.position.x = 2;
      frame30.system.update(1 / 30);

      frame60.root.position.x = 1;
      frame60.system.update(1 / 60);
      frame60.root.position.x = 2;
      frame60.system.update(1 / 60);

      for (let i = 0; i < frame30.chain.particles.length; i++) {
        expect(frame30.chain.particles[i].position.x).toBeCloseTo(frame60.chain.particles[i].position.x, 5);
        expect(frame30.chain.particles[i].position.y).toBeCloseTo(frame60.chain.particles[i].position.y, 5);
      }
    } finally {
      frame30.scene.dispose();
      frame60.scene.dispose();
    }
  });
});
