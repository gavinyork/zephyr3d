// Cloth grid demo — 6x6 grid with all 5 constraint types + capsule collider

import { InterpolatorScalar } from '@zephyr3d/base';
import type { BoneNode, ColliderR, GrabberR, Scene } from '@zephyr3d/scene';
import { JointDynamicsSystem, createTransformAccess } from '@zephyr3d/scene';
import { BoxShape, CapsuleShape, LambertMaterial, Mesh, SceneNode, SphereShape } from '@zephyr3d/scene';
import { Vector3 } from '@zephyr3d/base';

export interface ClothGridDemo {
  group: SceneNode;
  bones: SceneNode[];
  colliderObj: SceneNode;
  grabberObj: SceneNode;
  springSystem: JointDynamicsSystem;
  rootPoints: BoneNode[];
  collidersR: ColliderR[];
  fixedIndices: number[];
  cols: number;
  rows: number;
  update: (time: number, dt: number) => void;
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
    }
    boneGrid.push(chain);
  }

  // Multiple colliders for broad-phase testing
  const colliderObj = new SceneNode(scene);
  const colliderNodes: SceneNode[] = [];
  const colliderDefs = [
    { radius: 0.12, height: 0.4, x: 0, y: 0.8, z: 0.15 },
    { radius: 0.11, height: 0.35, x: -0.35, y: 1.05, z: -0.1 },
    { radius: 0.1, height: 0.3, x: 0.35, y: 0.65, z: 0.2 },
    { radius: 0.09, height: 0.25, x: 0, y: 1.2, z: -0.25 }
  ];
  for (const def of colliderDefs) {
    const colliderNode = new SceneNode(scene);
    colliderNode.parent = colliderObj;
    colliderNode.position.setXYZ(def.x, def.y, def.z);
    const capsuleVis = new Mesh(
      scene,
      new CapsuleShape({ radius: def.radius, height: def.height }),
      new LambertMaterial()
    );
    capsuleVis.parent = colliderNode;
    colliderNodes.push(colliderNode);
  }

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

  const collidersR: ColliderR[] = colliderDefs.map((def) => ({
    radius: def.radius,
    radiusTailScale: 1,
    height: def.height,
    friction: 0.5,
    isInverseCollider: false,
    forceType: 0
  }));

  const colliderTAs = colliderNodes.map((node) => createTransformAccess(node));
  const grabberTA = createTransformAccess(grabberObj);

  const springSystem = new JointDynamicsSystem(
    {
      chainConfig: {
        systemRoot: group,
        chains: boneGrid.map((chain) => ({ start: chain[0], end: chain[chain.length - 1] }))
      },
      controllerConfig: {
        enableSurfaceCollision: true,
        enableBroadPhase: true,
        curves: {
          windForceScale: InterpolatorScalar.linear(0, 1),
          resistance: InterpolatorScalar.constant(0.85),
          structuralShrinkVertical: InterpolatorScalar.constant(0.5),
          structuralStretchVertical: InterpolatorScalar.constant(0.5),
          shearShrink: InterpolatorScalar.constant(0.8),
          shearStretch: InterpolatorScalar.constant(0.8)
        },
        constraintOptions: {
          structuralVertical: true,
          structuralHorizontal: true,
          shear: true,
          bendingVertical: true,
          bendingHorizontal: true,
          collideStructuralVertical: true,
          collideStructuralHorizontal: true,
          collideShear: true,
          enableSurfaceCollision: true
        }
      }
    },
    collidersR.map((r, index) => ({ r, transform: colliderTAs[index] })),
    [{ r: grabbersR[0], transform: grabberTA, enabled: false }],
    [{ up: new Vector3(0, 1, 0), position: new Vector3(0, 0, 0) }] // floor at y=0
  );

  //const constraints = buildConstraints(rootPoints, config.constraintOptions);

  const update = (time: number, dt: number) => {
    colliderNodes[0].position.y = 0.8 + Math.sin(time * 1.5) * 0.5;
    colliderNodes[0].position.z = 0.15 + Math.sin(time * 0.7) * 0.2;
    colliderNodes[1].position.x = -0.35 + Math.sin(time * 0.9) * 0.18;
    colliderNodes[1].position.y = 1.05 + Math.cos(time * 1.2) * 0.22;
    colliderNodes[2].position.x = 0.35 + Math.cos(time * 1.1) * 0.2;
    colliderNodes[2].position.z = 0.2 + Math.sin(time * 1.6) * 0.16;
    colliderNodes[3].position.y = 1.2 + Math.sin(time * 1.8) * 0.18;
    colliderNodes[3].position.z = -0.25 + Math.cos(time * 0.8) * 0.14;

    springSystem.update(dt);
  };

  // Fixed point indices: first bone (row=0) of each column
  const fixedIndices = Array.from({ length: COLS }, (_, col) => col * ROWS);

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
