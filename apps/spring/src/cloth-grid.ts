// Cloth grid demo — 6x6 grid with all 5 constraint types + capsule collider

import { InterpolatorScalar } from '@zephyr3d/base';
import type { BoneNode, ColliderR, GrabberR, Scene } from '@zephyr3d/scene';
import { BoxShape, CapsuleShape, LambertMaterial, Mesh, SceneNode, SphereShape } from '@zephyr3d/scene';
import { SPCRJointDynamicsController, type ControllerConfig, type PhysicsCurves } from '@zephyr3d/scene';
import { createTransformAccess } from './three-bridge';
import { buildConstraints } from '@zephyr3d/scene';
import { Vector3 } from '@zephyr3d/base';

function defaultCurves(): PhysicsCurves {
  return {
    massScale: InterpolatorScalar.constant(1),
    gravityScale: InterpolatorScalar.constant(15),
    windForceScale: InterpolatorScalar.linear(0, 1),
    resistance: InterpolatorScalar.constant(0.85),
    hardness: InterpolatorScalar.constant(0),
    friction: InterpolatorScalar.constant(0.01),
    sliderJointLength: InterpolatorScalar.constant(0),
    allShrinkScale: InterpolatorScalar.constant(1),
    allStretchScale: InterpolatorScalar.constant(1),
    structuralShrinkVertical: InterpolatorScalar.constant(0.5),
    structuralStretchVertical: InterpolatorScalar.constant(0.5),
    structuralShrinkHorizontal: InterpolatorScalar.constant(0.5),
    structuralStretchHorizontal: InterpolatorScalar.constant(0.5),
    shearShrink: InterpolatorScalar.constant(0.8),
    shearStretch: InterpolatorScalar.constant(0.8),
    bendingShrinkVertical: InterpolatorScalar.constant(0.59),
    bendingStretchVertical: InterpolatorScalar.constant(0.59),
    bendingShrinkHorizontal: InterpolatorScalar.constant(0.59),
    bendingStretchHorizontal: InterpolatorScalar.constant(0.59),
    fakeWavePower: InterpolatorScalar.constant(0),
    fakeWaveFreq: InterpolatorScalar.constant(0)
  };
}

export interface ClothGridDemo {
  group: SceneNode;
  bones: SceneNode[];
  colliderObj: SceneNode;
  grabberObj: SceneNode;
  controller: SPCRJointDynamicsController;
  rootPoints: BoneNode[];
  constraints: ReturnType<typeof buildConstraints>;
  collidersR: ColliderR[];
  /** Indices of the top-row fixed points (one per column) */
  fixedIndices: number[];
  cols: number;
  rows: number;
  update: (time: number) => void;
}

export function createClothGridDemo(scene: Scene): ClothGridDemo {
  const COLS = 6;
  const ROWS = 6;
  const SPACING = 0.2;

  const group = new SceneNode(scene);
  group.position.setXYZ(0, 2, 0);

  // Create grid of bone objects
  // Layout: COLS vertical chains, each ROWS deep
  const boneGrid: SceneNode[][] = [];
  const allBones: SceneNode[] = [];
  const boneMat = new LambertMaterial();
  const boneGeo = new BoxShape({ size: 0.1 });

  let globalIndex = 0;
  for (let col = 0; col < COLS; col++) {
    const chain: SceneNode[] = [];
    for (let row = 0; row < ROWS; row++) {
      const bone = new SceneNode(scene);
      if (row === 0) {
        bone.position.setXYZ((col - (COLS - 1) / 2) * SPACING, 0, 0);
        bone.parent = group;
      } else {
        bone.position.setXYZ(0, -SPACING, 0);
        bone.parent = chain[row - 1];
      }
      const mesh = new Mesh(scene, boneGeo, boneMat);
      mesh.parent = bone;
      chain.push(bone);
      allBones.push(bone);
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      globalIndex++;
    }
    boneGrid.push(chain);
  }

  // Capsule collider
  const colliderObj = new SceneNode(scene);
  colliderObj.position.setXYZ(0, 0.8, 0.15);

  const capsuleVis = new Mesh(scene, new CapsuleShape({ radius: 0.12, height: 0.4 }), new LambertMaterial());
  capsuleVis.parent = colliderObj;

  // Grabber
  const grabberObj = new SceneNode(scene);
  grabberObj.position.setXYZ(0, 1.5, 0);
  const grabberVis = new Mesh(scene, new SphereShape({ radius: 0.35 }), new LambertMaterial());
  grabberVis.showState = 'hidden';
  grabberVis.parent = grabberObj;

  const grabbersR: GrabberR[] = [{ radius: 0.35, force: 0.5 }];

  const boneNodes: BoneNode[] = allBones.map((b, i) => {
    const wp = new Vector3();
    b.getWorldPosition(wp);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const col = Math.floor(i / ROWS);
    const row = i % ROWS;
    return {
      index: i,
      position: new Vector3(wp.x, wp.y, wp.z),
      children: [],
      isFixed: row === 0,
      depth: row,
      useForSurfaceCollision: true
    };
  });

  // Link children within each chain
  for (let col = 0; col < COLS; col++) {
    for (let row = 0; row < ROWS - 1; row++) {
      const idx = col * ROWS + row;
      boneNodes[idx].children.push(boneNodes[idx + 1]);
    }
  }

  // Root points = first bone of each chain
  const rootPoints = boneGrid.map((_, col) => boneNodes[col * ROWS]);

  const collidersR: ColliderR[] = [
    {
      radius: 0.12,
      radiusTailScale: 1,
      height: 0.4,
      friction: 0.5,
      isInverseCollider: false,
      forceType: 0
    }
  ];

  const config: ControllerConfig = {
    gravity: new Vector3(0, -9.8, 0),
    windForce: Vector3.zero(),
    relaxation: 4,
    subSteps: 3,
    rootSlideLimit: -1,
    rootRotateLimit: -1,
    constraintShrinkLimit: 1,
    blendRatio: 0,
    stabilizationFrameRate: 60,
    isFakeWave: false,
    fakeWaveSpeed: 0,
    fakeWavePower: 0,
    enableSurfaceCollision: true,
    angleLimitConfig: { angleLimit: -1, limitFromRoot: false },
    curves: defaultCurves(),
    constraintOptions: {
      structuralVertical: true,
      structuralHorizontal: true,
      shear: true,
      bendingVertical: true,
      bendingHorizontal: true,
      isLoop: false,
      collideStructuralVertical: true,
      collideStructuralHorizontal: true,
      collideShear: true,
      enableSurfaceCollision: true
    }
  };

  const controller = new SPCRJointDynamicsController(config);

  const pointTransforms = allBones.map((b) => createTransformAccess(b));
  const rootTA = createTransformAccess(group);
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

  const constraints = buildConstraints(rootPoints, config.constraintOptions);

  const update = (time: number) => {
    // Move collider up and down through the cloth
    colliderObj.position.y = 0.8 + Math.sin(time * 1.5) * 0.5;
    colliderObj.position.z = 0.15 + Math.sin(time * 0.7) * 0.2;
  };

  // Fixed point indices: first bone (row=0) of each column
  const fixedIndices = Array.from({ length: COLS }, (_, col) => col * ROWS);

  return {
    group,
    bones: allBones,
    colliderObj,
    grabberObj,
    controller,
    rootPoints,
    constraints,
    collidersR,
    fixedIndices,
    cols: COLS,
    rows: ROWS,
    update
  };
}
