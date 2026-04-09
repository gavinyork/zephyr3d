import type { Vector3 } from '@zephyr3d/base';
import { Quaternion } from '@zephyr3d/base';
import type { SceneNode } from '../../scene';
import type { ControllerConfig } from './controller';
import { SpringSystemController } from './controller';
import type { BoneNode, ColliderR, GrabberR, TransformAccess } from './types';

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

export type SpringChainConfig = {
  systemRoot: SceneNode;
  chains: { start: SceneNode; end: SceneNode }[];
};

/**
 * Physics engine for spring-based particle simulation
 * Uses Verlet integration and iterative constraint solving
 *
 * @public
 */
export class SpringSystem2 {
  private _controller: SpringSystemController;
  constructor(
    options: ControllerConfig,
    chainConfig: SpringChainConfig,
    colliders: { r: ColliderR; transform: TransformAccess }[],
    grabbers: {
      r: GrabberR;
      transform: TransformAccess;
      enabled: boolean;
    }[],
    flatPlanes: { up: Vector3; position: Vector3 }[]
  ) {
    const rootPoints: BoneNode[] = [];
    const boneNodes: BoneNode[] = [];
    const pointTransforms: TransformAccess[] = [];
    let index = 0;
    for (const chain of chainConfig.chains) {
      const chainNodes = this.collectChainNodes(chain.start, chain.end);
      for (let i = 0; i < chainNodes.length; i++) {
        const node = chainNodes[i];
        const boneNode = {
          index: index++,
          position: node.getWorldPosition(),
          children: [],
          isFixed: i === 0, // Fix the first bone in the chain
          depth: i
        };
        boneNodes.push(boneNode);
        pointTransforms.push(createTransformAccess(node));
        if (i > 0) {
          boneNodes[boneNodes.length - 2].children.push(boneNode);
        }
        if (i === 0) {
          rootPoints.push(boneNode);
        }
      }
    }
    const systemRoot = createTransformAccess(chainConfig.systemRoot);
    this._controller = new SpringSystemController(options);
    this._controller.initialize(systemRoot, rootPoints, pointTransforms, colliders, grabbers, flatPlanes);
  }

  get controller() {
    return this._controller;
  }

  private collectChainNodes(start: SceneNode, end: SceneNode): SceneNode[] {
    if (!start.isParentOf(end)) {
      throw new Error('Invalid chain: end node must be a descendant of start node');
    }
    const nodes: SceneNode[] = [];
    let current: SceneNode = end;
    for (;;) {
      nodes.unshift(current);
      if (current === start) {
        break;
      }
      current = current.parent!;
    }
    return nodes;
  }
  /**
   * Updates the physics simulation
   * @param deltaTime - Time step in seconds
   */
  update(deltaTime: number): void {
    // Clamp deltaTime to prevent instability
    const dt = Math.min(deltaTime, 0.033); // Max 30 FPS
    // simulation
    this._controller.step(dt);
  }
}
