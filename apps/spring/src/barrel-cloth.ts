// Skirt demo — 12-column × 8-row flared skirt with isLoop=true
//
// Key design: initial bone positions form a cone (each row is wider than the
// previous). Horizontal constraint rest-lengths are therefore larger at the
// hem than at the waist, so the physics naturally maintains the flared shape
// and amplifies it under gravity/inertia.

import { InterpolatorScalar, Quaternion } from '@zephyr3d/base';
import type { BoneNode, ColliderR, GrabberR, Scene } from '@zephyr3d/scene';
import { SpringSystem2 } from '@zephyr3d/scene';
import {
  CapsuleShape,
  LambertMaterial,
  Mesh,
  SphereShape,
  type ControllerConfig,
  type PhysicsCurves
} from '@zephyr3d/scene';
import { createTransformAccess } from './three-bridge';
import { /*buildConstraints, */ SceneNode } from '@zephyr3d/scene';
import { Vector3 } from '@zephyr3d/base';

function defaultCurves(): PhysicsCurves {
  return {
    massScale: InterpolatorScalar.constant(0.5),
    gravityScale: InterpolatorScalar.constant(1),
    windForceScale: InterpolatorScalar.linear(0, 1),
    // resistance applied per-substep: effective = 0.93^3 ≈ 0.80/frame
    // Moderate damping — cloth settles without spring-like oscillation
    resistance: InterpolatorScalar.constant(0.93),
    hardness: InterpolatorScalar.constant(0.0),
    friction: InterpolatorScalar.constant(0.2),
    sliderJointLength: InterpolatorScalar.constant(0),
    allShrinkScale: InterpolatorScalar.constant(1),
    allStretchScale: InterpolatorScalar.constant(1),
    // ── KEY: stiff structural = inextensible fabric ──
    structuralShrinkVertical: InterpolatorScalar.constant(0.95),
    structuralStretchVertical: InterpolatorScalar.constant(0.95),
    structuralShrinkHorizontal: InterpolatorScalar.constant(0.7),
    structuralStretchHorizontal: InterpolatorScalar.constant(0.7),
    // Moderate shear keeps the grid from collapsing diagonally
    shearShrink: InterpolatorScalar.constant(0.025),
    shearStretch: InterpolatorScalar.constant(0.025),
    // ── KEY: very soft bending = cloth folds/drapes freely ──
    bendingShrinkVertical: InterpolatorScalar.constant(0.02),
    bendingStretchVertical: InterpolatorScalar.constant(0.02),
    bendingShrinkHorizontal: InterpolatorScalar.constant(0.02),
    bendingStretchHorizontal: InterpolatorScalar.constant(0.02),
    fakeWavePower: InterpolatorScalar.constant(0),
    fakeWaveFreq: InterpolatorScalar.constant(0)
  };
}

export interface BarrelClothDemo {
  group: SceneNode;
  bones: SceneNode[];
  colliderObj: SceneNode;
  grabberObj: SceneNode;
  springSystem: SpringSystem2;
  rootPoints: BoneNode[];
  //constraints: ReturnType<typeof buildConstraints>;
  collidersR: ColliderR[];
  fixedIndices: number[];
  cols: number;
  rows: number;
  update: (time: number, dt: number) => void;
}

export function createBarrelClothDemo(scene: Scene): BarrelClothDemo {
  const COLS = 22;
  const ROWS = 20; // longer skirt for visible draping
  const WAIST_RADIUS = 0.15;
  const FLARE_PER_ROW = 0.063; // subtle flare: hem radius ≈ 0.15 + 9×0.03 = 0.42
  const ROW_SPACING = 0.12; // denser rows for smoother draping
  const WAIST_Y = 2.0;

  const group = new SceneNode(scene);
  group.position.setXYZ(0, WAIST_Y, 0);

  // Bone grid with cone-shaped initial layout.
  // Each child bone is offset OUTWARD (radially) as well as downward,
  // so horizontal constraint rest-lengths increase toward the hem.
  const boneGrid: SceneNode[][] = [];
  const allBones: SceneNode[] = [];
  const boneMat = new LambertMaterial();
  const boneGeo = new SphereShape({ radius: 0.015 });

  for (let col = 0; col < COLS; col++) {
    const angle = (col / COLS) * Math.PI * 2;
    const cx = Math.cos(angle);
    const cz = Math.sin(angle);
    const chain: SceneNode[] = [];

    for (let row = 0; row < ROWS; row++) {
      const bone = new SceneNode(scene);
      if (row === 0) {
        bone.position.setXYZ(cx * WAIST_RADIUS, 0, cz * WAIST_RADIUS);
        bone.parent = group;
      } else {
        // Outward offset bakes the cone into the constraint rest-lengths
        bone.position.setXYZ(cx * FLARE_PER_ROW, -ROW_SPACING, cz * FLARE_PER_ROW);
        bone.parent = chain[row - 1];
      }
      const mesh = new Mesh(scene, boneGeo, boneMat);
      mesh.parent = bone;
      chain.push(bone);
      allBones.push(bone);
    }
    boneGrid.push(chain);
  }

  // Body capsule collider - prevents skirt from clipping through legs
  const BODY_RADIUS = 0.13;
  const BODY_HEIGHT = (ROWS - 1) * ROW_SPACING;
  const colliderObj = new SceneNode(scene);
  colliderObj.position.setXYZ(0, WAIST_Y - BODY_HEIGHT * 0.5, 0);

  const mesh = new Mesh(
    scene,
    new CapsuleShape({ radius: BODY_RADIUS, height: BODY_HEIGHT }),
    new LambertMaterial()
  );
  mesh.parent = colliderObj;

  // Grabber
  const grabberObj = new SceneNode(scene);
  grabberObj.position.setXYZ(0, WAIST_Y - 0.6, 0.6);
  const grabberVis = new Mesh(scene, new SphereShape({ radius: 0.3 }), new LambertMaterial());
  grabberVis.showState = 'hidden';
  grabberVis.parent = grabberObj;

  const grabbersR: GrabberR[] = [{ radius: 0.3, force: 0.5 }];

  const boneNodes: BoneNode[] = allBones.map((b, i) => {
    const wp = new Vector3();
    b.getWorldPosition(wp);
    const row = i % ROWS;
    return {
      index: i,
      position: new Vector3(wp.x, wp.y, wp.z),
      children: [],
      isFixed: row === 0,
      depth: row,
      useForSurfaceCollision: false
    };
  });

  for (let col = 0; col < COLS; col++) {
    for (let row = 0; row < ROWS - 1; row++) {
      const idx = col * ROWS + row;
      boneNodes[idx].children.push(boneNodes[idx + 1]);
    }
  }

  const rootPoints = boneGrid.map((_, col) => boneNodes[col * ROWS]);

  const collidersR: ColliderR[] = [
    {
      radius: BODY_RADIUS,
      radiusTailScale: 1,
      height: BODY_HEIGHT,
      friction: 0.1,
      isInverseCollider: false,
      forceType: 0
    }
  ];

  const config: ControllerConfig = {
    gravity: new Vector3(0, -9.8, 0),
    windForce: Vector3.zero(),
    relaxation: 2,
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
    angleLimitConfig: { angleLimit: -1, limitFromRoot: false },
    curves: defaultCurves(),
    constraintOptions: {
      structuralVertical: true,
      structuralHorizontal: true,
      shear: true,
      bendingVertical: true,
      bendingHorizontal: false, // DISABLE: allows horizontal folding when fallen
      isLoop: true,
      collideStructuralVertical: true,
      collideStructuralHorizontal: true,
      collideShear: true,
      enableSurfaceCollision: false
    },
    enableBroadPhase: true
  };

  const colliderTA = createTransformAccess(colliderObj);
  const grabberTA = createTransformAccess(grabberObj);

  const springSystem = new SpringSystem2(
    config,
    {
      systemRoot: group,
      chains: boneGrid.map((chain) => ({ start: chain[0], end: chain[chain.length - 1] }))
    },
    [{ r: collidersR[0], transform: colliderTA }],
    [{ r: grabbersR[0], transform: grabberTA, enabled: false }],
    [{ up: new Vector3(0, 1, 0), position: new Vector3(0, 0, 0) }]
  );

  //const constraints = buildConstraints(rootPoints, config.constraintOptions);

  const fixedIndices = Array.from({ length: COLS }, (_, col) => col * ROWS);

  // Graceful hip sway — slow and smooth so the cloth drapes, not bounces
  const update = (time: number, dt: number) => {
    group.position.x = Math.sin(time * 1.5) * 0.25;
    group.position.z = Math.sin(time * 0.8) * 0.15;
    group.rotation = Quaternion.fromAxisAngle(Vector3.axisPY(), time * 2.4);
    //group.position.y = WAIST_Y - BODY_HEIGHT * 0.5 + (Math.sin(time * 6) * 0.5 + 0.5) * 0.8;
    colliderObj.position.x = group.position.x;
    colliderObj.position.z = group.position.z;

    springSystem.update(dt);
  };

  return {
    group,
    bones: allBones,
    colliderObj,
    grabberObj,
    springSystem,
    rootPoints,
    //constraints,
    collidersR,
    fixedIndices,
    cols: COLS,
    rows: ROWS,
    update
  };
}
