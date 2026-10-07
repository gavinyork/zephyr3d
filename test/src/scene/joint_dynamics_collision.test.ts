import { InterpolatorScalar, Matrix4x4, Quaternion, Vector3 } from '@zephyr3d/base';
import { Scene, SceneNode } from '../../../libs/scene/src/scene';
import {
  ColliderForce,
  type ColliderR,
  type ColliderRW,
  JointDynamicsSystem,
  type PointR,
  pushoutFromCapsule,
  pushoutFromSphere
} from '../../../libs/scene/src/animation/joint_dynamics';

function makeCapsule(height: number, scaledHeight: number): { colR: ColliderR; colRW: ColliderRW } {
  const colR: ColliderR = {
    radius: 0.5,
    radiusTailScale: 1,
    height,
    friction: 0,
    isInverseCollider: false,
    forceType: ColliderForce.Off
  };
  const colRW: ColliderRW = {
    positionCurrent: new Vector3(0, 0, 0),
    directionCurrent: new Vector3(0, scaledHeight, 0),
    boundsCenter: new Vector3(0, scaledHeight * 0.5, 0),
    boundsRadius: scaledHeight * 0.5 + colR.radius,
    positionCurrentTransform: new Vector3(0, scaledHeight * 0.5, 0),
    positionPreviousTransform: new Vector3(0, scaledHeight * 0.5, 0),
    directionCurrentTransform: Quaternion.identity(),
    directionPreviousTransform: Quaternion.identity(),
    worldToLocal: Matrix4x4.identity(),
    worldScale: new Vector3(2, 2, 2),
    localBoundsMin: Vector3.zero(),
    localBoundsMax: Vector3.zero(),
    boxAxes: [Vector3.axisPX(), Vector3.axisPY(), Vector3.axisPZ()],
    boxHalfExtents: Vector3.zero(),
    radius: colR.radius * 2,
    height: scaledHeight,
    enabled: 1
  };
  return { colR, colRW };
}

describe('JointDynamics capsule collision', () => {
  it('does not feed previous physics output back into a static short chain', () => {
    const scene = new Scene();
    const root = new SceneNode(scene);
    const child = new SceneNode(scene);
    root.parent = scene.rootNode;
    child.parent = root;
    child.position.setXYZ(0, 0.05, 0);

    const system = new JointDynamicsSystem({
      chainConfig: {
        systemRoot: root,
        chains: [{ start: root, end: child }]
      },
      controllerConfig: {
        gravity: Vector3.zero(),
        preserveTwist: true,
        subSteps: 1,
        relaxation: 0,
        curves: {
          resistance: InterpolatorScalar.constant(0),
          hardness: InterpolatorScalar.constant(1)
        },
        constraintOptions: {
          structuralVertical: true
        }
      }
    });

    const disturbedRotation = Quaternion.fromAxisAngle(Vector3.axisPZ(), Math.PI / 5);
    root.rotation.set(disturbedRotation);
    system.controller.reset();
    root.rotation.identity();

    for (let i = 0; i < 12; i++) {
      system.update(1 / 60);
    }

    expect(Quaternion.angleBetween(root.rotation, Quaternion.identity())).toBeLessThan(0.001);
    expect(Vector3.distance(child.position, new Vector3(0, 0.05, 0))).toBeLessThan(0.001);
  });

  it('deduplicates shared nodes across multiple short chains', () => {
    const scene = new Scene();
    const root = new SceneNode(scene);
    const childA = new SceneNode(scene);
    const childB = new SceneNode(scene);
    root.parent = scene.rootNode;
    childA.parent = root;
    childB.parent = root;
    childA.position.setXYZ(0, 0.05, 0);
    childB.position.setXYZ(0.05, 0, 0);

    const system = new JointDynamicsSystem({
      chainConfig: {
        systemRoot: root,
        chains: [
          { start: root, end: childA },
          { start: root, end: childB }
        ]
      },
      controllerConfig: {
        gravity: Vector3.zero(),
        preserveTwist: true,
        subSteps: 1,
        relaxation: 0,
        curves: {
          resistance: InterpolatorScalar.constant(0),
          hardness: InterpolatorScalar.constant(1)
        },
        constraintOptions: {
          structuralVertical: true
        }
      }
    });
    for (let i = 0; i < 12; i++) {
      system.update(1 / 60);
    }

    expect(Quaternion.angleBetween(root.rotation, Quaternion.identity())).toBeLessThan(0.001);
    expect(Vector3.distance(childA.position, new Vector3(0, 0.05, 0))).toBeLessThan(0.001);
    expect(Vector3.distance(childB.position, new Vector3(0.05, 0, 0))).toBeLessThan(0.001);
  });

  it('fully resets simulation state after teleporting the system root', () => {
    const scene = new Scene();
    const root = new SceneNode(scene);
    const child = new SceneNode(scene);
    root.parent = scene.rootNode;
    child.parent = root;
    child.position.setXYZ(0, 1, 0);

    const system = new JointDynamicsSystem({
      chainConfig: {
        systemRoot: root,
        chains: [{ start: root, end: child }]
      },
      controllerConfig: {
        constraintOptions: {
          structuralVertical: true
        }
      }
    });

    system.update(1 / 60);
    root.position.setXYZ(20, 0, 0);
    system.controller.reset();

    system.update(1 / 60);
    expect(child.getWorldPosition().x).toBeGreaterThan(19);
  });

  it('uses scaled runtime capsule height for side contacts', () => {
    const { colR, colRW } = makeCapsule(1, 2);
    const pointR = { pointRadius: 0 } as PointR;
    const point = new Vector3(0.75, 1.25, 0);

    const result = pushoutFromCapsule(colR, colRW, point, pointR);

    expect(result.hit).toBe(true);
    expect(result.point.x).toBeCloseTo(1);
    expect(result.point.y).toBeCloseTo(1.25);
  });

  it('keeps sphere and capsule pushout bounded when the point is near its own radius', () => {
    const sphere = pushoutFromSphere(Vector3.zero(), 0.5, 0.1, new Vector3(0.100001, 0, 0));
    expect(sphere.hit).toBe(true);
    expect(sphere.point.x).toBeCloseTo(0.6);
    expect(sphere.point.magnitude).toBeLessThan(1);

    const { colR, colRW } = makeCapsule(1, 2);
    const capsule = pushoutFromCapsule(colR, colRW, new Vector3(0.100001, 1.25, 0), {
      pointRadius: 0.1
    } as PointR);
    expect(capsule.hit).toBe(true);
    expect(capsule.point.x).toBeCloseTo(1.1);
    expect(capsule.point.y).toBeCloseTo(1.25);
    expect(capsule.point.magnitude).toBeLessThan(2);
  });
});
