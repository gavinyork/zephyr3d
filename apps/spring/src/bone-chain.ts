// Bone chain demo — 8-bone pendulum with sphere collider

import { InterpolatorScalar } from '@zephyr3d/base';
import type { BoneNode, ColliderR, GrabberR, Scene } from '@zephyr3d/scene';
import { LambertMaterial, Mesh, SceneNode, SphereShape } from '@zephyr3d/scene';
import { SPCRJointDynamicsController, type ControllerConfig, type PhysicsCurves } from '@zephyr3d/scene';
import { buildConstraints } from '@zephyr3d/scene';
import { createTransformAccess } from './three-bridge';
import { Vector3 } from '@zephyr3d/base';

function defaultCurves(): PhysicsCurves {
  return {
    massScale: InterpolatorScalar.constant(1),
    gravityScale: InterpolatorScalar.constant(1),
    windForceScale: InterpolatorScalar.linear(0, 1),
    resistance: InterpolatorScalar.constant(0.95),
    hardness: InterpolatorScalar.constant(0.0),
    friction: InterpolatorScalar.constant(0.5),
    sliderJointLength: InterpolatorScalar.constant(0),
    allShrinkScale: InterpolatorScalar.constant(1),
    allStretchScale: InterpolatorScalar.constant(1),
    structuralShrinkVertical: InterpolatorScalar.constant(1),
    structuralStretchVertical: InterpolatorScalar.constant(1),
    structuralShrinkHorizontal: InterpolatorScalar.constant(0.5),
    structuralStretchHorizontal: InterpolatorScalar.constant(0.5),
    shearShrink: InterpolatorScalar.constant(0.5),
    shearStretch: InterpolatorScalar.constant(0.5),
    bendingShrinkVertical: InterpolatorScalar.constant(0.5),
    bendingStretchVertical: InterpolatorScalar.constant(0.5),
    bendingShrinkHorizontal: InterpolatorScalar.constant(0.5),
    bendingStretchHorizontal: InterpolatorScalar.constant(0.5),
    fakeWavePower: InterpolatorScalar.constant(0),
    fakeWaveFreq: InterpolatorScalar.constant(0)
  };
}

export interface BoneChainDemo {
  root: SceneNode;
  bones: SceneNode[];
  colliderObj: SceneNode;
  grabberObj: SceneNode;
  controller: SPCRJointDynamicsController;
  rootPoints: BoneNode[];
  constraints: ReturnType<typeof buildConstraints>;
  collidersR: ColliderR[];
  update: (time: number) => void;
}

export function createBoneChainDemo(scene: Scene): BoneChainDemo {
  const BONE_COUNT = 8;
  const BONE_SPACING = 0.2;

  // Create bone hierarchy as Three.js objects
  const root = new SceneNode(scene);
  root.position.setXYZ(0, 2, 0);

  const bones: SceneNode[] = [];
  let parent: SceneNode = root;
  for (let i = 0; i < BONE_COUNT; i++) {
    const bone = new SceneNode(scene);
    bone.position.setXYZ(0, -BONE_SPACING, 0);
    bone.parent = parent;
    bones.push(bone);
    parent = bone;
  }

  // Visual: small spheres at each bone
  const boneMat = new LambertMaterial();
  const boneGeo = new SphereShape({ radius: 0.03 });
  for (const b of bones) {
    const mesh = new Mesh(scene, boneGeo, boneMat);
    mesh.parent = b;
  }

  // Collider sphere at bottom
  const colliderObj = new SceneNode(scene);
  colliderObj.position.setXYZ(0, 0.3, 0);

  const colliderVis = new Mesh(scene, new SphereShape({ radius: 0.15 }), new LambertMaterial());
  colliderVis.parent = colliderObj;

  // Grabber
  const grabberObj = new SceneNode(scene);
  grabberObj.position.setXYZ(0, 1.5, 0);
  const grabberVis = new Mesh(scene, new SphereShape({ radius: 0.3 }), new LambertMaterial());
  grabberVis.parent = grabberObj;
  grabberVis.showState = 'hidden';

  const grabbersR: GrabberR[] = [{ radius: 0.3, force: 0.5 }];

  const allBones = [root, ...bones];
  const boneNodes: BoneNode[] = allBones.map((b, i) => {
    const wp = new Vector3();
    b.getWorldPosition(wp);
    return {
      index: i,
      position: new Vector3(wp.x, wp.y, wp.z),
      children: [],
      isFixed: i === 0,
      depth: i
    };
  });
  // Link children
  for (let i = 0; i < boneNodes.length - 1; i++) {
    boneNodes[i].children.push(boneNodes[i + 1]);
  }

  const rootPoints = [boneNodes[0]];

  const collidersR: ColliderR[] = [
    {
      radius: 0.15,
      radiusTailScale: 1,
      height: 0,
      friction: 0.5,
      isInverseCollider: false,
      forceType: 0
    }
  ];

  const config: ControllerConfig = {
    gravity: new Vector3(0, -9.8, 0),
    windForce: Vector3.zero(),
    relaxation: 3,
    subSteps: 3,
    rootSlideLimit: -1,
    rootRotateLimit: -1,
    constraintShrinkLimit: 1,
    blendRatio: 0,
    stabilizationFrameRate: 60,
    isFakeWave: false,
    fakeWaveSpeed: 0,
    fakeWavePower: 0,
    enableSurfaceCollision: false,
    enableBroadPhase: true,
    angleLimitConfig: { angleLimit: -1, limitFromRoot: false },
    curves: defaultCurves(),
    constraintOptions: {
      structuralVertical: true,
      structuralHorizontal: false,
      shear: false,
      bendingVertical: true,
      bendingHorizontal: false,
      isLoop: false,
      collideStructuralVertical: true,
      collideStructuralHorizontal: false,
      collideShear: false,
      enableSurfaceCollision: false
    }
  };

  const controller = new SPCRJointDynamicsController(config);

  const pointTransforms = allBones.map((b) => createTransformAccess(b));
  const rootTA = createTransformAccess(root);
  const colliderTA = createTransformAccess(colliderObj);
  const grabberTA = createTransformAccess(grabberObj);

  controller.initialize(
    rootTA,
    rootPoints,
    pointTransforms,
    [{ r: collidersR[0], transform: colliderTA }],
    [{ r: grabbersR[0], transform: grabberTA, enabled: false }],
    [{ up: new Vector3(0, 1, 0), position: new Vector3(0, 0, 0) }] // floor at y=0
  );

  // Get constraints for debug rendering
  const constraints = buildConstraints(rootPoints, config.constraintOptions);

  const update = (time: number) => {
    // Oscillate root
    root.position.x = Math.sin(time * 2) * 0.5;
    root.position.y = 2 + Math.sin(time * 1.5) * 0.1;
  };

  return {
    root,
    bones,
    colliderObj,
    grabberObj,
    controller,
    rootPoints,
    constraints,
    collidersR,
    update
  };
}
