// Bone chain demo — 8-bone pendulum with sphere collider

import { InterpolatorScalar, Vector4 } from '@zephyr3d/base';
import type { BoneNode, ColliderR, GrabberR, Scene } from '@zephyr3d/scene';
import { BoxShape, JointDynamicsSystem, createTransformAccess } from '@zephyr3d/scene';
import { LambertMaterial, Mesh, SceneNode, SphereShape } from '@zephyr3d/scene';
import { Vector3 } from '@zephyr3d/base';

export interface BoneChainDemo {
  root: SceneNode;
  bones: SceneNode[];
  colliderObj: SceneNode;
  grabberObj: SceneNode;
  springSystem: JointDynamicsSystem;
  rootPoints: BoneNode[];
  collidersR: ColliderR[];
  update: (time: number, dt: number) => void;
}

export function createBoneChainDemo(scene: Scene): BoneChainDemo {
  const BONE_COUNT = 8;
  const BONE_SPACING = 0.2;

  // Create bone hierarchy
  const sysroot = new SceneNode(scene);
  sysroot.position.setXYZ(0, 2, 0);
  const rootGeo = new BoxShape({ size: 0.1 });
  const rootMat = new LambertMaterial();
  rootMat.albedoColor = new Vector4(0, 0, 1, 1);
  const rootMesh = new Mesh(scene, rootGeo, rootMat);
  rootMesh.parent = sysroot;

  const root = new SceneNode(scene);
  root.parent = sysroot;

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
  const boneGeo = new BoxShape({ size: 0.06 });
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

  const jointDynamicSystem = new JointDynamicsSystem(
    {
      chainConfig: { systemRoot: sysroot, chains: [{ start: root, end: bones[bones.length - 1] }] },
      controllerConfig: {
        curves: {
          resistance: InterpolatorScalar.constant(1),
          hardness: InterpolatorScalar.constant(0)
        },
        constraintOptions: {
          structuralVertical: true,
          bendingVertical: true
        }
      }
    },
    [{ r: collidersR[0], transform: createTransformAccess(colliderObj) }],
    [{ r: grabbersR[0], transform: createTransformAccess(grabberObj), enabled: false }],
    [{ up: new Vector3(0, 1, 0), position: new Vector3(0, 0, 0) }]
  );
  const update = (time: number, dt: number) => {
    // Oscillate root
    sysroot.position.x = Math.sin(time * 2) * 0.5;
    sysroot.position.y = 2 + Math.sin(time * 1.5) * 0.1;
    sysroot.rotation.fromAxisAngle(Vector3.axisPY(), time * 2);
    jointDynamicSystem.update(dt);
  };

  return {
    root: sysroot,
    bones,
    colliderObj,
    grabberObj,
    springSystem: jointDynamicSystem,
    rootPoints,
    collidersR,
    update
  };
}
