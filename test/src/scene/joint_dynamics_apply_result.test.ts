import { Quaternion, Vector3 } from '@zephyr3d/base';
import {
  applyResult,
  extractLocalTwist,
  type PointR,
  type PointRW
} from '../../../libs/scene/src/animation/joint_dynamics';

function makePoint(
  parent: number,
  child: number,
  weight: number,
  boneAxis: Vector3,
  initialLocalRotation = Quaternion.identity()
): PointR {
  const initialLocalTwist = new Quaternion();
  extractLocalTwist(initialLocalRotation, boneAxis, initialLocalTwist);
  return {
    parent,
    child,
    applyInvertCollision: 0,
    movableLimitIndex: -1,
    movableLimitRadius: 0,
    weight,
    mass: 1,
    resistance: 1,
    hardness: 0,
    frictionScale: 0,
    sliderJointLength: 0,
    parentLength: 0,
    structuralShrinkVertical: 0,
    structuralStretchVertical: 0,
    structuralShrinkHorizontal: 0,
    structuralStretchHorizontal: 0,
    shearShrink: 0,
    shearStretch: 0,
    bendingShrinkVertical: 0,
    bendingStretchVertical: 0,
    bendingShrinkHorizontal: 0,
    bendingStretchHorizontal: 0,
    windForceScale: 0,
    fakeWavePower: 0,
    fakeWaveFreq: 0,
    forceFadeRatio: 0,
    pointRadius: 0,
    gravity: Vector3.zero(),
    boneAxis: boneAxis.clone(),
    initialLocalScale: new Vector3(1, 1, 1),
    initialLocalRotation: initialLocalRotation.clone(),
    initialLocalTwist,
    initialLocalPosition: Vector3.zero()
  };
}

function makePointState(position: Vector3): PointRW {
  return {
    positionToTransform: position.clone(),
    positionCurrentTransform: position.clone(),
    positionPreviousTransform: position.clone(),
    positionCurrent: position.clone(),
    positionPrevious: position.clone(),
    directionPrevious: Vector3.axisPZ(),
    fakeWindDirection: Vector3.axisPZ(),
    grabberIndex: -1,
    grabberDistance: 0,
    friction: 0
  };
}

function getExpectedPreservedLocalRotation(point: PointR, targetAxis: Vector3): Quaternion {
  const twistAxis = Vector3.normalize(point.boneAxis);
  const targetDir = Vector3.normalize(targetAxis);
  const initialNoTwist = Quaternion.multiply(
    point.initialLocalRotation,
    Quaternion.inverse(point.initialLocalTwist)
  );
  const initialAxis = Vector3.normalize(initialNoTwist.transform(twistAxis));
  const swingDelta = Quaternion.unitVectorToUnitVector(initialAxis, targetDir);
  return Quaternion.multiply(Quaternion.multiply(swingDelta, initialNoTwist), point.initialLocalTwist);
}

describe('JointDynamics applyResult', () => {
  it('normalizes child direction before computing aim rotation', () => {
    const boneAxis = new Vector3(0, 1, 0);
    const rootPosition = Vector3.zero();
    const childPosition = new Vector3(4, 3, 0);
    const pointsR = [makePoint(-1, 1, 0, boneAxis), makePoint(0, -1, 1, boneAxis)];
    const pointsRW = [makePointState(rootPosition), makePointState(childPosition)];

    const outputs = applyResult(
      pointsR,
      pointsRW,
      [rootPosition, childPosition],
      0,
      [Quaternion.identity(), Quaternion.identity()],
      [Quaternion.identity(), Quaternion.identity()],
      false
    );

    const expectedDirection = Vector3.normalize(Vector3.sub(childPosition, rootPosition));
    const actualDirection = Vector3.normalize(outputs[0].rotation.transform(boneAxis));
    expect(Vector3.angleBetween(actualDirection, expectedDirection)).toBeLessThan(0.0001);
  });

  it('does not keep changing twist across repeated preserve passes', () => {
    const boneAxis = new Vector3(0, 1, 0);
    const initialSwing = Quaternion.fromAxisAngle(new Vector3(1, 0, 0), Math.PI / 7);
    const initialTwistAngle = Math.PI / 6;
    const animatedTwistAngle = -Math.PI / 3;
    const initialLocalRotation = Quaternion.multiply(
      initialSwing,
      Quaternion.fromAxisAngle(boneAxis, initialTwistAngle)
    );
    let currentRotation = Quaternion.multiply(
      Quaternion.fromAxisAngle(new Vector3(0, 0, 1), -Math.PI / 8),
      Quaternion.fromAxisAngle(boneAxis, animatedTwistAngle)
    );
    const rootPosition = Vector3.zero();
    const childPosition = new Vector3(2, 3, 1);
    const pointsR = [makePoint(-1, 1, 0, boneAxis, initialLocalRotation), makePoint(0, -1, 1, boneAxis)];
    const pointsRW = [makePointState(rootPosition), makePointState(childPosition)];

    for (let i = 0; i < 8; i++) {
      const outputs = applyResult(
        pointsR,
        pointsRW,
        [rootPosition, childPosition],
        0,
        [currentRotation, Quaternion.identity()],
        [currentRotation, Quaternion.identity()],
        true
      );
      currentRotation = outputs[0].rotation;
    }

    const expectedDirection = Vector3.normalize(Vector3.sub(childPosition, rootPosition));
    const actualDirection = Vector3.normalize(currentRotation.transform(boneAxis));
    const expectedRotation = getExpectedPreservedLocalRotation(pointsR[0], expectedDirection);

    expect(Vector3.angleBetween(actualDirection, expectedDirection)).toBeLessThan(0.0001);
    expect(Quaternion.angleBetween(currentRotation, expectedRotation)).toBeLessThan(0.0001);
  });

  it('does not keep changing twist across a parent-child chain', () => {
    const boneAxis = new Vector3(0, 1, 0);
    const rootTwistAngle = Math.PI / 6;
    const midTwistAngle = -Math.PI / 5;
    const rootInitialLocal = Quaternion.multiply(
      Quaternion.fromAxisAngle(new Vector3(1, 0, 0), Math.PI / 9),
      Quaternion.fromAxisAngle(boneAxis, rootTwistAngle)
    );
    const midInitialLocal = Quaternion.multiply(
      Quaternion.fromAxisAngle(new Vector3(0, 0, 1), -Math.PI / 8),
      Quaternion.fromAxisAngle(boneAxis, midTwistAngle)
    );
    const rootPosition = Vector3.zero();
    const midPosition = new Vector3(2, 3, 1);
    const tipPosition = new Vector3(3, 5, 2);
    const pointsR = [
      makePoint(-1, 1, 0, boneAxis, rootInitialLocal),
      makePoint(0, 2, 1, boneAxis, midInitialLocal),
      makePoint(1, -1, 1, boneAxis)
    ];
    const pointsRW = [makePointState(rootPosition), makePointState(midPosition), makePointState(tipPosition)];
    const positions = [rootPosition, midPosition, tipPosition];
    let worldRotations = [
      Quaternion.multiply(
        Quaternion.fromAxisAngle(new Vector3(0, 0, 1), -Math.PI / 7),
        Quaternion.fromAxisAngle(boneAxis, -Math.PI / 2)
      ),
      Quaternion.multiply(
        Quaternion.fromAxisAngle(new Vector3(1, 0, 0), Math.PI / 6),
        Quaternion.fromAxisAngle(boneAxis, Math.PI / 3)
      ),
      Quaternion.identity()
    ];
    let localRotations = [worldRotations[0], worldRotations[1], worldRotations[2]];

    for (let i = 0; i < 10; i++) {
      const outputs = applyResult(pointsR, pointsRW, positions, 0, worldRotations, localRotations, true);
      worldRotations = outputs.map((output) => output.rotation);
      localRotations = outputs.map((output) => output.localRotation);
    }

    const rootDirection = Vector3.normalize(worldRotations[0].transform(boneAxis));
    const midDirection = Vector3.normalize(worldRotations[1].transform(boneAxis));
    const expectedRootDirection = Vector3.normalize(Vector3.sub(midPosition, rootPosition));
    const expectedMidDirection = Vector3.normalize(Vector3.sub(tipPosition, midPosition));
    const midEffectiveLocal = Quaternion.multiply(Quaternion.inverse(worldRotations[0]), worldRotations[1]);
    const expectedRootLocal = getExpectedPreservedLocalRotation(pointsR[0], expectedRootDirection);
    const expectedMidLocal = getExpectedPreservedLocalRotation(
      pointsR[1],
      Quaternion.inverse(worldRotations[0]).transform(expectedMidDirection)
    );

    expect(Vector3.angleBetween(rootDirection, expectedRootDirection)).toBeLessThan(0.0001);
    expect(Vector3.angleBetween(midDirection, expectedMidDirection)).toBeLessThan(0.0001);
    expect(Quaternion.angleBetween(worldRotations[0], expectedRootLocal)).toBeLessThan(0.001);
    expect(Quaternion.angleBetween(midEffectiveLocal, expectedMidLocal)).toBeLessThan(0.001);
  });

  it('preserves root local twist while the scene parent rotates', () => {
    const boneAxis = new Vector3(0, 1, 0);
    const rootTwistAngle = Math.PI / 6;
    const rootInitialLocal = Quaternion.multiply(
      Quaternion.fromAxisAngle(new Vector3(1, 0, 0), Math.PI / 10),
      Quaternion.fromAxisAngle(boneAxis, rootTwistAngle)
    );
    const rootPosition = Vector3.zero();
    const childLocalPosition = new Vector3(0.04, 0.08, 0.02);
    const pointsR = [makePoint(-1, 1, 0, boneAxis, rootInitialLocal), makePoint(0, -1, 1, boneAxis)];

    for (let i = 0; i < 12; i++) {
      const sceneParentRotation = Quaternion.fromAxisAngle(new Vector3(0, 0, 1), i * 0.04);
      const rootAnimatedWorld = Quaternion.multiply(sceneParentRotation, rootInitialLocal);
      const childPosition = sceneParentRotation.transform(childLocalPosition);
      const pointsRW = [makePointState(rootPosition), makePointState(childPosition)];
      const positions = [rootPosition, childPosition];
      const outputs = applyResult(
        pointsR,
        pointsRW,
        positions,
        0,
        [rootAnimatedWorld, Quaternion.identity()],
        [rootInitialLocal, Quaternion.identity()],
        true,
        [sceneParentRotation, Quaternion.identity()]
      );
      const rootLocal = Quaternion.multiply(Quaternion.inverse(sceneParentRotation), outputs[0].rotation);
      const expectedDirection = Vector3.normalize(Vector3.sub(childPosition, rootPosition));
      const actualDirection = Vector3.normalize(outputs[0].rotation.transform(boneAxis));
      const expectedLocal = getExpectedPreservedLocalRotation(pointsR[0], childLocalPosition);

      expect(Vector3.angleBetween(actualDirection, expectedDirection)).toBeLessThan(0.0001);
      expect(Quaternion.angleBetween(rootLocal, expectedLocal)).toBeLessThan(0.001);
    }
  });
});
