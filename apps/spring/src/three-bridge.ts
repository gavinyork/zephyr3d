// Three.js bridge — adapts THREE.Object3D to TransformAccess interface

import type { TransformAccess, SceneNode } from '@zephyr3d/scene';
import type { Vector3 } from '@zephyr3d/base';
import { Quaternion } from '@zephyr3d/base';

const _quat = new Quaternion();

export function createTransformAccess(obj: SceneNode): TransformAccess {
  return {
    getWorldPosition(): Vector3 {
      return obj.getWorldPosition();
    },
    getWorldRotation(): Quaternion {
      const q = new Quaternion();
      obj.worldMatrix.decompose(null, q, null);
      return q;
    },
    getLocalPosition(): Vector3 {
      return obj.position.clone();
    },
    getLocalRotation(): Quaternion {
      return obj.rotation.clone();
    },
    getLocalScale(): Vector3 {
      return obj.scale.clone();
    },
    setWorldPosition(p: Vector3): void {
      if (obj.parent) {
        obj.position = obj.parent.invWorldMatrix.transformPointAffine(p);
      } else {
        obj.position.set(p);
      }
    },
    setWorldRotation(q: Quaternion): void {
      // Convert world rotation to local: localRot = inverse(parentWorldRot) * worldRot
      if (obj.parent) {
        obj.parent.worldMatrix.decompose(null, _quat, null);
        Quaternion.multiply(Quaternion.inverse(_quat), q, obj.rotation);
      } else {
        obj.rotation.set(q);
      }
    },
    setLocalPosition(p: Vector3): void {
      obj.position.set(p);
    },
    setLocalRotation(q: Quaternion): void {
      obj.rotation.set(q);
    },
    setLocalScale(s: Vector3): void {
      obj.scale.set(s);
    }
  };
}
