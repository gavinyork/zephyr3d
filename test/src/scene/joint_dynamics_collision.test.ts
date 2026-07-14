import { InterpolatorScalar, Matrix4x4, Quaternion, Vector3 } from '@zephyr3d/base';
import { Scene, SceneNode } from '../../../libs/scene/src/scene';
import {
  ColliderForce,
  type ColliderR,
  type ColliderRW,
  JointDynamicsSystem,
  type PointR,
  type PointRW,
  pushoutFromCapsule,
  pushoutFromSphere,
  simulate
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
    const controller = system.controller as unknown as { _pointsR: PointR[]; _pointTransforms: unknown[] };

    expect(controller._pointsR).toHaveLength(3);
    expect(controller._pointTransforms).toHaveLength(3);

    for (let i = 0; i < 12; i++) {
      system.update(1 / 60);
    }

    expect(Quaternion.angleBetween(root.rotation, Quaternion.identity())).toBeLessThan(0.001);
    expect(Vector3.distance(childA.position, new Vector3(0, 0.05, 0))).toBeLessThan(0.001);
    expect(Vector3.distance(childB.position, new Vector3(0.05, 0, 0))).toBeLessThan(0.001);
  });

  it('uses current transform positions as simulation targets with preserveTwist enabled', () => {
    const scene = new Scene();
    const root = new SceneNode(scene);
    const child = new SceneNode(scene);
    root.parent = scene.rootNode;
    child.parent = root;
    child.position.setXYZ(0.1, 0, 0);

    const system = new JointDynamicsSystem({
      chainConfig: {
        systemRoot: root,
        chains: [{ start: root, end: child }]
      },
      controllerConfig: {
        gravity: Vector3.zero(),
        preserveTwist: true,
        subSteps: 1,
        relaxation: 0
      }
    });
    const controller = system.controller as unknown as { _pointsRW: PointRW[] };

    system.update(1 / 60);
    child.position.setXYZ(0.1, -0.03, 0);
    system.update(1 / 60);

    expect(controller._pointsRW[1].positionCurrentTransform.y).toBeCloseTo(-0.03);
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

    const controller = system.controller as unknown as {
      _pointsRW: PointRW[];
      _previousRootPosition: Vector3;
      _positionsToTransform: Vector3[];
    };
    const childWorld = child.getWorldPosition();

    expect(controller._previousRootPosition.x).toBeCloseTo(root.getWorldPosition().x);
    expect(controller._pointsRW[1].positionCurrent.x).toBeCloseTo(childWorld.x);
    expect(controller._pointsRW[1].positionPrevious.x).toBeCloseTo(childWorld.x);
    expect(controller._pointsRW[1].positionCurrentTransform.x).toBeCloseTo(childWorld.x);
    expect(controller._pointsRW[1].positionPreviousTransform.x).toBeCloseTo(childWorld.x);
    expect(controller._positionsToTransform[1].x).toBeCloseTo(childWorld.x);

    system.update(1 / 60);
    expect(child.getWorldPosition().x).toBeGreaterThan(19);
  });

  it('interprets root slide limit in system-local units', () => {
    const scene = new Scene();
    const root = new SceneNode(scene);
    const child = new SceneNode(scene);
    root.parent = scene.rootNode;
    child.parent = root;
    child.position.setXYZ(1, 0, 0);
    root.scale.setXYZ(2, 2, 2);

    const system = new JointDynamicsSystem({
      chainConfig: {
        systemRoot: root,
        chains: [{ start: root, end: child }]
      },
      controllerConfig: {
        gravity: Vector3.zero(),
        subSteps: 1,
        relaxation: 0,
        rootSlideLimit: 10,
        curves: {
          resistance: InterpolatorScalar.constant(1),
          hardness: InterpolatorScalar.constant(0)
        }
      }
    });

    const controller = system.controller as unknown as { _pointsRW: PointRW[] };
    root.position.setXYZ(500, 0, 0);
    system.update(1 / 60);

    expect(controller._pointsRW[1].positionCurrentTransform.x).toBeCloseTo(502);
    expect(controller._pointsRW[1].positionCurrent.x).toBeCloseTo(482);
    expect(
      controller._pointsRW[1].positionCurrentTransform.x - controller._pointsRW[1].positionCurrent.x
    ).toBeCloseTo(20);
  });

  it('rescales point parameters and constraints when the system root scale changes', () => {
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
        gravity: new Vector3(0, -10, 0),
        curves: {
          pointRadius: InterpolatorScalar.constant(0.2)
        },
        constraintOptions: {
          structuralVertical: true
        }
      }
    });

    root.scale.setXYZ(0.1, 0.1, 0.1);
    system.update(1 / 60);

    const controller = system.controller as unknown as {
      _pointsR: Array<{ parentLength: number; pointRadius: number; gravity: Vector3 }>;
      _constraints: Array<{ length: number }>;
    };

    expect(controller._pointsR[1].parentLength).toBeCloseTo(0.1);
    expect(controller._pointsR[1].pointRadius).toBeCloseTo(0.02);
    expect(controller._pointsR[1].gravity.y).toBeCloseTo(-1);
    expect(controller._constraints[0].length).toBeCloseTo(0.1);
  });

  it('scales runtime capsule height during collider update', () => {
    const { colR, colRW } = makeCapsule(1, 0);
    colRW.positionCurrentTransform.setXYZ(0, 0, 0);
    colRW.positionPreviousTransform.setXYZ(0, 0, 0);

    simulate(
      {
        isPaused: false,
        stepTime: 1 / 60,
        subSteps: 1,
        rootPosition: Vector3.zero(),
        previousRootPosition: Vector3.zero(),
        rootSlideLimit: -1,
        rootRotation: Quaternion.identity(),
        previousRootRotation: Quaternion.identity(),
        rootRotateLimit: -1,
        windForce: Vector3.zero(),
        enableSurfaceCollision: false,
        surfaceConstraints: [],
        relaxation: 0,
        constraintShrinkLimit: 0,
        blendRatio: 0,
        isFakeWave: false,
        fakeWaveSpeed: 0,
        fakeWavePower: 0,
        fakeWaveCounter: 0,
        collisionScale: 1,
        enableBroadPhase: true
      },
      [],
      [],
      [],
      [colR],
      [colRW],
      [],
      [],
      [],
      []
    );

    expect(colRW.height).toBeCloseTo(2);
    expect(colRW.directionCurrent.y).toBeCloseTo(2);
    expect(colRW.positionCurrent.y).toBeCloseTo(-1);
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

  it('keeps sphere pushout bounded when the point is near its own radius from the center', () => {
    const center = Vector3.zero();
    const result = pushoutFromSphere(center, 0.5, 0.1, new Vector3(0.100001, 0, 0));

    expect(result.hit).toBe(true);
    expect(result.point.x).toBeCloseTo(0.6);
    expect(result.point.magnitude).toBeLessThan(1);
  });

  it('keeps capsule side pushout bounded when the point is near its own radius from the axis', () => {
    const { colR, colRW } = makeCapsule(1, 2);
    const pointR = { pointRadius: 0.1 } as PointR;
    const result = pushoutFromCapsule(colR, colRW, new Vector3(0.100001, 1.25, 0), pointR);

    expect(result.hit).toBe(true);
    expect(result.point.x).toBeCloseTo(1.1);
    expect(result.point.y).toBeCloseTo(1.25);
    expect(result.point.magnitude).toBeLessThan(2);
  });
});
