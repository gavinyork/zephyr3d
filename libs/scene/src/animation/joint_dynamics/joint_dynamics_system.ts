import type { DeepPartial } from '@zephyr3d/base';
import { InterpolatorScalar, Vector3 } from '@zephyr3d/base';
import { Quaternion } from '@zephyr3d/base';
import type { SceneNode } from '../../scene';
import type { ControllerConfig } from './controller';
import { JointDynamicsSystemController } from './controller';
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

export type JointChainConfig = {
  systemRoot: SceneNode;
  chains: { start: SceneNode; end: SceneNode }[];
};

export type JointDynamicSystemConfig = {
  chainConfig: JointChainConfig;
  controllerConfig?: DeepPartial<ControllerConfig, 2>;
};

/**
 * Physics engine for spring-based particle simulation
 * Uses Verlet integration and iterative constraint solving
 *
 * @public
 */
export class JointDynamicsSystem {
  private _controller: JointDynamicsSystemController;
  constructor(
    config: JointDynamicSystemConfig,
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
    for (const chain of config.chainConfig.chains) {
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
    const systemRoot = createTransformAccess(config.chainConfig.systemRoot);
    const defaultConfig = this.getDefaultControllerConfig();
    const controllerConfig: ControllerConfig = {
      ...defaultConfig,
      ...config?.controllerConfig,
      angleLimitConfig: { ...defaultConfig.angleLimitConfig, ...config?.controllerConfig?.angleLimitConfig },
      curves: { ...defaultConfig.curves, ...config?.controllerConfig?.curves },
      constraintOptions: {
        ...defaultConfig.constraintOptions,
        ...config?.controllerConfig?.constraintOptions
      }
    };
    this._controller = new JointDynamicsSystemController(controllerConfig);
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
  /** @internal */
  private getDefaultControllerConfig(): ControllerConfig {
    return {
      gravity: new Vector3(0, -9.8, 0),
      relaxation: 3,
      subSteps: 3,
      enableSurfaceCollision: false,
      windForce: Vector3.zero(),
      rootSlideLimit: -1,
      rootRotateLimit: -1,
      constraintShrinkLimit: 1,
      blendRatio: 0,
      stabilizationFrameRate: 60,
      isFakeWave: false,
      fakeWaveSpeed: 0,
      fakeWavePower: 0,
      angleLimitConfig: { angleLimit: -1, limitFromRoot: false },
      enableBroadPhase: false,
      curves: {
        gravityScale: InterpolatorScalar.constant(1),
        windForceScale: InterpolatorScalar.constant(1),
        massScale: InterpolatorScalar.constant(1),
        resistance: InterpolatorScalar.constant(0.95),
        hardness: InterpolatorScalar.constant(0.001),
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
      },
      constraintOptions: {
        structuralVertical: false,
        structuralHorizontal: false,
        shear: false,
        bendingVertical: false,
        bendingHorizontal: false,
        isLoop: false,
        collideStructuralVertical: false,
        collideStructuralHorizontal: false,
        collideShear: false,
        enableSurfaceCollision: false
      }
    };
  }
}
