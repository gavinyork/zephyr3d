import type { DeepPartial } from '@zephyr3d/base';
import { InterpolatorScalar, Vector3 } from '@zephyr3d/base';
import { Quaternion } from '@zephyr3d/base';
import { SceneNode } from '../../scene/scene_node';
import type { ControllerConfig, JointDynamicsColliderHandle, JointDynamicsGrabberHandle } from './controller';
import { JointDynamicsSystemController } from './controller';
import { ColliderForce, type BoneNode, type ColliderR, type GrabberR, type TransformAccess } from './types';

const _quat = new Quaternion();

const _defaultTA = createTransformAccess(new SceneNode(null));

/**
 * Create a transform adapter that lets the joint dynamics solver read from and write to a SceneNode.
 *
 * @param obj - Scene node to expose through the TransformAccess interface.
 * @returns A TransformAccess wrapper backed by the supplied scene node.
 *
 * @public
 */
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
    getWorldScale(): Vector3 {
      const s = new Vector3();
      obj.worldMatrix.decompose(s, null, null);
      return s;
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

/**
 * Describes the bone chains simulated by a JointDynamicsSystem.
 *
 * Each chain is defined by an inclusive start and end node. The end node must be
 * a descendant of the start node.
 *
 * @public
 */
export type JointChainConfig = {
  /** Root transform used for root motion compensation. */
  systemRoot: SceneNode;
  /** Bone chains to simulate. */
  chains: { start: SceneNode; end: SceneNode }[];
};

/**
 * Configuration used to construct a JointDynamicsSystem.
 *
 * @public
 */
export type JointDynamicSystemConfig = {
  /** Bone chain topology and root transform. */
  chainConfig: JointChainConfig;
  /** Optional controller configuration overrides. */
  controllerConfig?: DeepPartial<ControllerConfig, 2>;
};

/**
 * Physics system for spring-like joint dynamics on scene node bone chains.
 *
 * The system builds particles and constraints from one or more bone chains,
 * advances them with Verlet integration, solves constraints and collisions, and
 * writes the resulting positions and rotations back to the scene graph.
 *
 * @public
 */
export class JointDynamicsSystem {
  private _controller: JointDynamicsSystemController;
  /**
   * Create a joint dynamics system for one or more bone chains.
   *
   * @param config - Bone chain topology and controller configuration.
   * @param colliders - Optional colliders to register during initialization.
   * @param grabbers - Optional grabbers to register during initialization.
   * @param flatPlanes - Optional world-space planes that dynamic points cannot cross.
   */
  constructor(
    config: JointDynamicSystemConfig,
    colliders: { r: ColliderR; transform: TransformAccess }[] = [],
    grabbers: {
      r: GrabberR;
      transform: TransformAccess;
      enabled: boolean;
    }[] = [],
    flatPlanes: { up: Vector3; position: Vector3 }[] = []
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

  /**
   * Get the low-level controller that owns simulation state and advanced runtime controls.
   *
   * Most callers should prefer the convenience methods on JointDynamicsSystem.
   *
   * @returns The underlying joint dynamics controller.
   */
  get controller(): JointDynamicsSystemController {
    return this._controller;
  }

  /**
   * Add a fully configured collider at runtime.
   *
   * The collider transform is read from the supplied scene node every simulation step.
   * If no transform is supplied, the collider is created at the identity transform.
   *
   * @param r - Read-only collider parameters.
   * @param transform - Optional scene node that drives the collider transform.
   * @returns A stable handle that remains valid until this collider is removed.
   */
  addCollider(r: ColliderR, transform?: SceneNode): JointDynamicsColliderHandle {
    return this._controller.addCollider(r, transform ? createTransformAccess(transform) : _defaultTA);
  }

  /**
   * Add a spherical collider at runtime.
   *
   * The collider transform is read from the supplied scene node every simulation step.
   * If no transform is supplied, the collider is created at the identity transform.
   *
   * @param radius - Sphere radius in world units before transform scaling.
   * @param transform - Optional scene node that drives the collider transform.
   * @param friction - Contact friction coefficient applied by this collider. Defaults to 0.
   * @param inversed - If true, points are constrained inside the sphere instead of pushed out.
   * @returns A stable handle that remains valid until this collider is removed.
   */
  addSphereCollider(
    radius: number,
    transform?: SceneNode,
    friction?: number,
    inversed?: boolean
  ): JointDynamicsColliderHandle {
    return this.addCollider(
      {
        forceType: ColliderForce.Off,
        friction: friction ?? 0,
        height: 0,
        isInverseCollider: inversed ?? false,
        radius,
        radiusTailScale: 1
      },
      transform
    );
  }

  /**
   * Add a capsule collider at runtime.
   *
   * The capsule is aligned to the collider transform's local Y axis. Its head radius is
   * `radius`, its tail radius is `radius * radiusTailScale`, and `height` defines the
   * distance between the capsule ends before transform scaling.
   *
   * @param radius - Capsule head radius in world units before transform scaling.
   * @param height - Capsule length in world units before transform scaling.
   * @param transform - Optional scene node that drives the collider transform.
   * @param radiusTailScale - Tail radius multiplier relative to the head radius. Defaults to 1.
   * @param friction - Contact friction coefficient applied by this collider. Defaults to 0.
   * @param inversed - If true, points are constrained inside the capsule instead of pushed out.
   * @returns A stable handle that remains valid until this collider is removed.
   */
  addCapsuleCollider(
    radius: number,
    height: number,
    transform?: SceneNode,
    radiusTailScale?: number,
    friction?: number,
    inversed?: boolean
  ): JointDynamicsColliderHandle {
    return this.addCollider(
      {
        forceType: ColliderForce.Off,
        friction: friction ?? 0,
        height,
        isInverseCollider: inversed ?? false,
        radius,
        radiusTailScale: radiusTailScale ?? 1
      },
      transform
    );
  }

  /**
   * Enable or disable a collider by stable handle.
   *
   * Disabled colliders remain registered but are ignored by simulation until re-enabled.
   *
   * @param handle - Collider handle returned by addCollider, addSphereCollider, or addCapsuleCollider.
   * @param enabled - Whether the collider should participate in simulation.
   * @returns true if the handle is valid and the enabled state was updated.
   */
  setColliderEnabled(handle: JointDynamicsColliderHandle, enabled: boolean): boolean {
    return this._controller.setColliderEnabled(handle, enabled);
  }

  /**
   * Remove a collider by stable handle.
   *
   * @param handle - Collider handle returned by addCollider, addSphereCollider, or addCapsuleCollider.
   * @returns true if the collider existed and was removed.
   */
  removeCollider(handle: JointDynamicsColliderHandle): boolean {
    return this._controller.removeCollider(handle);
  }

  /**
   * Remove a collider by current array index.
   *
   * Prefer removeCollider(handle) for runtime-owned colliders.
   *
   * @param index - Current collider array index.
   * @returns true if the collider existed and was removed.
   */
  removeColliderAt(index: number): boolean {
    return this._controller.removeColliderAt(index);
  }

  /**
   * Add a grabber at runtime.
   *
   * The grabber transform is read from the supplied scene node every simulation step.
   * If no transform is supplied, the grabber is created at the identity transform.
   *
   * @param r - Read-only grabber parameters.
   * @param transform - Optional scene node that drives the grabber transform.
   * @returns A stable handle that remains valid until this grabber is removed.
   */
  addGrabber(r: GrabberR, transform?: SceneNode): JointDynamicsGrabberHandle {
    return this._controller.addGrabber(r, transform ? createTransformAccess(transform) : _defaultTA, false);
  }

  /**
   * Enable or disable a grabber by stable handle.
   *
   * Disabling a grabber also releases any points currently held by it.
   *
   * @param handle - Grabber handle returned by addGrabber.
   * @param enabled - Whether the grabber should participate in simulation.
   * @returns true if the handle is valid and the enabled state was updated.
   */
  setGrabberEnabled(handle: JointDynamicsGrabberHandle, enabled: boolean): boolean {
    return this._controller.setGrabberEnabled(handle, enabled);
  }

  /**
   * Remove a grabber by stable handle.
   *
   * @param handle - Grabber handle returned by addGrabber.
   * @returns true if the grabber existed and was removed.
   */
  removeGrabber(handle: JointDynamicsGrabberHandle): boolean {
    return this._controller.removeGrabber(handle);
  }

  /**
   * Remove a grabber by current array index.
   *
   * Prefer removeGrabber(handle) for runtime-owned grabbers.
   *
   * @param index - Current grabber array index.
   * @returns true if the grabber existed and was removed.
   */
  removeGrabberAt(index: number): boolean {
    return this._controller.removeGrabberAt(index);
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
   * Advance the physics simulation and write the resulting transforms back to the chain nodes.
   *
   * @param deltaTime - Frame time step in seconds. Values larger than 0.033 are clamped for stability.
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
      preserveTwist: false,
      curves: {
        gravityScale: InterpolatorScalar.constant(1),
        windForceScale: InterpolatorScalar.constant(1),
        massScale: InterpolatorScalar.constant(1),
        resistance: InterpolatorScalar.constant(0.95),
        hardness: InterpolatorScalar.constant(0.001),
        friction: InterpolatorScalar.constant(0.5),
        pointRadius: InterpolatorScalar.constant(0.05),
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
