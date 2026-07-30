import { Vector3 } from '@zephyr3d/base';
import {
  MultiChainSpringSystem,
  Scene,
  SceneNode,
  SpringChain,
  createSphereCollider,
  createSpringParticle
} from '../../../libs/scene/src';

function appendNode(parent: SceneNode, name: string, position: Vector3) {
  const node = new SceneNode(parent.scene);
  node.name = name;
  node.position.set(position);
  node.parent = parent;
  return node;
}

describe('MultiChainSpringSystem runtime rebind', () => {
  it('uses runtime-remapped anchors and colliders without changing authored references', () => {
    const scene = new Scene();
    const sourceAnchor = appendNode(scene.rootNode, 'sourceSpine', new Vector3(0, 1, 0));
    const targetAnchor = appendNode(scene.rootNode, 'targetSpine', new Vector3(10, 2, 0));
    const chainRoot = appendNode(sourceAnchor, 'necklaceRoot', new Vector3(1, 0, 0));
    const chainMid = appendNode(chainRoot, 'necklaceMid', new Vector3(1, 0, 0));
    const chainEnd = appendNode(chainMid, 'necklaceEnd', new Vector3(1, 0, 0));
    const chain = SpringChain.fromBoneChain(chainRoot, chainEnd, {
      damping: 0.9,
      stiffness: 0.82
    });
    const endParticle = chain.particles[chain.particles.length - 1];
    endParticle.fixed = true;
    endParticle.anchorNode = sourceAnchor;
    endParticle.anchorOffset = sourceAnchor.worldToThis(chainEnd.getWorldPosition(), new Vector3());
    const authoredAnchorOffset = endParticle.anchorOffset.clone();
    const authoredRestLength = chain.constraints[0].restLength;
    const collider = createSphereCollider(new Vector3(0.25, 0, 0), 0.1, sourceAnchor);
    const system = new MultiChainSpringSystem({
      gravity: Vector3.zero(),
      enableInertialForces: false,
      solver: 'xpbd'
    });
    system.addChain(chain);
    system.addCollider(collider);

    chainRoot.parent = targetAnchor;
    chainMid.position.x = 2;
    system.setRuntimeNodeMap(new Map([[sourceAnchor, targetAnchor]]));
    system.reinitializeFromCurrentPose();

    expect(chain.particles[0].position.x).toBeCloseTo(chainRoot.getWorldPosition().x);
    expect(endParticle.position.x).toBeCloseTo(chainEnd.getWorldPosition().x);
    expect(endParticle.prevPosition.x).toBeCloseTo(endParticle.position.x);
    expect(chain.constraints[0].restLength).toBeCloseTo(authoredRestLength);
    expect(
      (
        system as unknown as {
          getRuntimeRestLength(constraint: (typeof chain.constraints)[number]): number;
        }
      ).getRuntimeRestLength(chain.constraints[0])
    ).toBeCloseTo(Vector3.distance(chain.particles[0].position, chain.particles[1].position));
    expect(collider.center.x).toBeCloseTo(targetAnchor.getWorldPosition().x + 0.25);

    expect(endParticle.anchorNode).toBe(sourceAnchor);
    expect(endParticle.anchorOffset?.equalsTo(authoredAnchorOffset)).toBe(true);
    expect(collider.node).toBe(sourceAnchor);

    const previousEndX = endParticle.position.x;
    targetAnchor.position.x += 2;
    system.update(1 / 60);
    expect(endParticle.position.x).toBeCloseTo(previousEndX + 2);
  });

  it('preserves Verlet velocity when collision pushout corrects a particle', () => {
    const chain = new SpringChain();
    const particle = createSpringParticle(new Vector3(0.5, 0, 0), {
      damping: 1,
      fixed: false
    });
    particle.prevPosition.setXYZ(0.4, 0, 0);
    chain.addParticle(particle);
    const system = new MultiChainSpringSystem({
      gravity: Vector3.zero(),
      enableInertialForces: false,
      iterations: 1,
      poseFollowRoot: 0,
      poseFollowTip: 0
    });
    system.addChain(chain);
    system.addCollider(createSphereCollider(Vector3.zero(), 1));

    system.update(1 / 60);
    expect(particle.position.x).toBeCloseTo(1);
    expect(particle.prevPosition.x).toBeCloseTo(0.9);

    system.update(1 / 60);
    expect(particle.position.x).toBeCloseTo(1.1);
  });

  it('excludes fixed roots driven by another spring chain from global inertia', () => {
    const scene = new Scene();
    const mainRoot = appendNode(scene.rootNode, 'mainRoot', Vector3.zero());
    const mainTip = appendNode(mainRoot, 'mainTip', new Vector3(1, 0, 0));
    const pendantRoot = appendNode(mainTip, 'pendantRoot', new Vector3(0, -1, 0));
    const pendantTip = appendNode(pendantRoot, 'pendantTip', new Vector3(0, -1, 0));
    const mainChain = SpringChain.fromBoneChain(mainRoot, mainTip);
    const pendantChain = SpringChain.fromBoneChain(pendantRoot, pendantTip);
    const system = new MultiChainSpringSystem({ enableInertialForces: true });
    system.addChain(mainChain);
    system.addChain(pendantChain);

    for (const chain of system.chains) {
      for (const particle of chain.particles) {
        particle.lastFramePosition.set(particle.position);
      }
    }
    pendantChain.particles[0].position.x += 1;

    const rotation = (
      system as unknown as {
        calculateGlobalRotation(dt: number): { center: Vector3; omega: Vector3 };
      }
    ).calculateGlobalRotation(1 / 60);
    expect(rotation.center.magnitudeSq).toBe(0);
    expect(rotation.omega.magnitudeSq).toBe(0);
  });
});
