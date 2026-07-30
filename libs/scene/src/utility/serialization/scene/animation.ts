import type { InterpolationMode, InterpolationTarget } from '@zephyr3d/base';
import { AABB, DRef, InterpolatorScalar, Quaternion } from '@zephyr3d/base';
import { base64ToUint8Array, Matrix4x4, uint8ArrayToBase64 } from '@zephyr3d/base';
import { Interpolator, Vector3 } from '@zephyr3d/base';
import { AnimationTrack, Skeleton, SkeletonRig, SkinBinding } from '../../../animation';
import type { SkeletonBindPose } from '../../../animation';
import {
  AnimationClip,
  FixedGeometryCacheTrack,
  JointDynamicsModifier,
  JointDynamicsSystem,
  MultiChainSpringSystem,
  SpringChain,
  SpringModifier,
  SpringSystem,
  createCapsuleCollider,
  createPlaneCollider,
  createSphereCollider,
  createSpringConstraint,
  createSpringParticle,
  createTransformAccess,
  PCAGeometryCacheTrack,
  MorphTargetTrack,
  NodeEulerRotationTrack,
  NodeRotationTrack,
  NodeScaleTrack,
  NodeTranslationTrack,
  PropertyTrack
} from '../../../animation';
import type { ControllerConfig, ControllerConfigUpdate } from '../../../animation/joint_dynamics/controller';
import type { ColliderR, GrabberR, JointDynamicSystemConfig } from '../../../animation/joint_dynamics';
import type {
  CapsuleCollider,
  InterChainConstraint,
  PlaneCollider,
  SphereCollider,
  SpringCollider,
  SpringSystemOptions
} from '../../../animation/spring';
import type { ResourceManager } from '../manager';
import { defineProps, type PropertyValue, type SerializableClass } from '../types';
import { SceneNode } from '../../../scene';
import { BoundingBox } from '../../bounding_volume';

type SerializedScalarCurve = {
  mode: InterpolationMode;
  inputs: number[];
  outputs: number[];
};

type SerializedControllerConfig = Partial<Omit<ControllerConfig, 'gravity' | 'windForce' | 'curves'>> & {
  gravity?: number[];
  windForce?: number[];
  curves?: Record<string, SerializedScalarCurve>;
};

type SerializedJointDynamicsCollider = {
  collider: ColliderR;
  transform?: string;
  enabled?: boolean;
};

type SerializedJointDynamicsFlatPlane = {
  up: number[];
  position: number[];
  enabled?: boolean;
};

type SerializedJointDynamicsGrabber = {
  grabber: GrabberR;
  transform?: string;
  enabled?: boolean;
};

type SerializedJointDynamicsModifier = {
  skeleton: string;
  systemRoot: string;
  chains: {
    start: string;
    end: string;
    startAnchor?: string;
    endAnchor?: string;
    startAnchorOffset?: number[];
    endAnchorOffset?: number[];
  }[];
  controllerConfig?: SerializedControllerConfig;
  colliders?: SerializedJointDynamicsCollider[];
  flatPlanes?: SerializedJointDynamicsFlatPlane[];
  grabbers?: SerializedJointDynamicsGrabber[];
  enabled?: boolean;
};

type SerializedSpringParticle = {
  node?: string;
  anchorNode?: string;
  anchorOffset?: number[];
  originalPosition: number[];
  originalRotation?: number[];
  mass: number;
  damping: number;
  fixed: boolean;
};

type SerializedSpringChain = {
  particles: SerializedSpringParticle[];
  constraints: {
    particleA: number;
    particleB: number;
    restLength: number;
    stiffness: number;
    compliance: number;
  }[];
};

type SerializedSpringCollider =
  | {
      type: 'sphere';
      node?: string;
      enabled: boolean;
      center: number[];
      radius: number;
      localRadius?: number;
      localRadiusScaleRef?: number;
      localOffset?: number[];
    }
  | {
      type: 'capsule';
      node?: string;
      enabled: boolean;
      start: number[];
      end: number[];
      radius: number;
      localRadius?: number;
      localRadiusScaleRef?: number;
      localStartOffset?: number[];
      localEndOffset?: number[];
    }
  | {
      type: 'plane';
      node?: string;
      enabled: boolean;
      point: number[];
      normal: number[];
      localPointOffset?: number[];
      localNormal?: number[];
    };

type SerializedSpringSystemOptions = Omit<SpringSystemOptions, 'gravity' | 'wind'> & {
  gravity: number[];
  wind: number[];
};

type SerializedSpringModifier = {
  skeleton: string;
  sourceId?: string;
  systemType: 'single' | 'multi';
  options: SerializedSpringSystemOptions;
  chains: SerializedSpringChain[];
  interChainConstraints?: Omit<InterChainConstraint, 'lambda'>[];
  colliders?: SerializedSpringCollider[];
  enabled?: boolean;
  weight?: number;
};

const jointDynamicsModifierSkeletons = new WeakMap<JointDynamicsModifier, SkeletonRig>();
const springModifierSkeletons = new WeakMap<SpringModifier, SkeletonRig>();

function encodeSkeletonBindPose(bindPose: SkeletonBindPose): string {
  return uint8ArrayToBase64(
    new Uint8Array(new Float32Array([...bindPose.position, ...bindPose.rotation, ...bindPose.scale]).buffer)
  );
}

function decodeSkeletonBindPose(encoded: string): SkeletonBindPose {
  const data = new Float32Array(base64ToUint8Array(encoded).buffer);
  return {
    position: new Vector3(data[0], data[1], data[2]),
    rotation: new Quaternion(data[3], data[4], data[5], data[6]),
    scale: new Vector3(data[7], data[8], data[9])
  };
}

function vectorToArray(value: Vector3): number[] {
  return [value.x, value.y, value.z];
}

function vectorFromArray(value: number[] | undefined, defaultValue = Vector3.zero()): Vector3 {
  return Array.isArray(value)
    ? new Vector3(value[0] ?? 0, value[1] ?? 0, value[2] ?? 0)
    : defaultValue.clone();
}

function quaternionToArray(value: Quaternion): number[] {
  return [value.x, value.y, value.z, value.w];
}

function quaternionFromArray(value: number[] | undefined): Quaternion | undefined {
  return Array.isArray(value)
    ? new Quaternion(value[0] ?? 0, value[1] ?? 0, value[2] ?? 0, value[3] ?? 1)
    : undefined;
}

function serializeSpringChain(chain: SpringChain): SerializedSpringChain {
  return {
    particles: chain.particles.map((particle) => ({
      ...(particle.node ? { node: particle.node.persistentId } : {}),
      ...(particle.anchorNode ? { anchorNode: particle.anchorNode.persistentId } : {}),
      ...(particle.anchorOffset ? { anchorOffset: vectorToArray(particle.anchorOffset) } : {}),
      originalPosition: vectorToArray(particle.originalPosition),
      ...(particle.originalRotation
        ? { originalRotation: quaternionToArray(particle.originalRotation) }
        : {}),
      mass: particle.mass,
      damping: particle.damping,
      fixed: particle.fixed
    })),
    constraints: chain.constraints.map((constraint) => ({
      particleA: constraint.particleA,
      particleB: constraint.particleB,
      restLength: constraint.restLength,
      stiffness: constraint.stiffness,
      compliance: constraint.compliance
    }))
  };
}

function deserializeSpringChain(ctx: SceneNode, data: SerializedSpringChain): SpringChain | null {
  const chain = new SpringChain();
  for (const item of data.particles ?? []) {
    const node = findSerializedNode(ctx, item.node);
    const anchorNode = findSerializedNode(ctx, item.anchorNode);
    if ((item.node && !node) || (item.anchorNode && !anchorNode)) {
      return null;
    }
    const position = node
      ? new Vector3(node.worldMatrix.m03, node.worldMatrix.m13, node.worldMatrix.m23)
      : vectorFromArray(item.originalPosition);
    let originalRotation = quaternionFromArray(item.originalRotation);
    if (node) {
      originalRotation = new Quaternion();
      node.worldMatrix.decompose(null, originalRotation, null);
    }
    chain.addParticle(
      createSpringParticle(position, {
        mass: item.mass,
        damping: item.damping,
        fixed: item.fixed,
        node: node ?? undefined,
        anchorNode: anchorNode ?? undefined,
        anchorOffset: item.anchorOffset ? vectorFromArray(item.anchorOffset) : undefined,
        originalRotation
      })
    );
  }
  for (const item of data.constraints ?? []) {
    if (
      item.particleA < 0 ||
      item.particleB < 0 ||
      item.particleA >= chain.particles.length ||
      item.particleB >= chain.particles.length
    ) {
      return null;
    }
    chain.addConstraint(
      createSpringConstraint(item.particleA, item.particleB, item.restLength, item.stiffness, item.compliance)
    );
  }
  return chain.particles.length > 0 ? chain : null;
}

function serializeSpringCollider(collider: SpringCollider): SerializedSpringCollider {
  switch (collider.type) {
    case 'sphere': {
      const sphere = collider as SphereCollider;
      return {
        type: 'sphere',
        ...(sphere.node ? { node: sphere.node.persistentId } : {}),
        enabled: sphere.enabled,
        center: vectorToArray(sphere.center),
        radius: sphere.radius,
        ...(sphere.localRadius !== undefined ? { localRadius: sphere.localRadius } : {}),
        ...(sphere.localRadiusScaleRef !== undefined
          ? { localRadiusScaleRef: sphere.localRadiusScaleRef }
          : {}),
        ...(sphere.localOffset ? { localOffset: vectorToArray(sphere.localOffset) } : {})
      };
    }
    case 'capsule': {
      const capsule = collider as CapsuleCollider;
      return {
        type: 'capsule',
        ...(capsule.node ? { node: capsule.node.persistentId } : {}),
        enabled: capsule.enabled,
        start: vectorToArray(capsule.start),
        end: vectorToArray(capsule.end),
        radius: capsule.radius,
        ...(capsule.localRadius !== undefined ? { localRadius: capsule.localRadius } : {}),
        ...(capsule.localRadiusScaleRef !== undefined
          ? { localRadiusScaleRef: capsule.localRadiusScaleRef }
          : {}),
        ...(capsule.localStartOffset ? { localStartOffset: vectorToArray(capsule.localStartOffset) } : {}),
        ...(capsule.localEndOffset ? { localEndOffset: vectorToArray(capsule.localEndOffset) } : {})
      };
    }
    case 'plane': {
      const plane = collider as PlaneCollider;
      return {
        type: 'plane',
        ...(plane.node ? { node: plane.node.persistentId } : {}),
        enabled: plane.enabled,
        point: vectorToArray(plane.point),
        normal: vectorToArray(plane.normal),
        ...(plane.localPointOffset ? { localPointOffset: vectorToArray(plane.localPointOffset) } : {}),
        ...(plane.localNormal ? { localNormal: vectorToArray(plane.localNormal) } : {})
      };
    }
  }
}

function restoreSpringColliderRadiusScale(
  collider: SphereCollider | CapsuleCollider,
  data: Extract<SerializedSpringCollider, { type: 'sphere' | 'capsule' }>
): void {
  const createdScaleRef = collider.localRadiusScaleRef;
  if (data.localRadiusScaleRef !== undefined) {
    collider.localRadiusScaleRef = data.localRadiusScaleRef;
  } else if (
    data.localRadius !== undefined &&
    createdScaleRef !== undefined &&
    Number.isFinite(data.localRadius) &&
    Number.isFinite(data.radius) &&
    Math.abs(data.radius) > 1e-6
  ) {
    // Older serialized modifiers omitted the authored scale reference. Recover it
    // from the stored world radius and the node scale captured by the constructor.
    const inferredScaleRef = (data.localRadius * createdScaleRef) / data.radius;
    if (Number.isFinite(inferredScaleRef) && Math.abs(inferredScaleRef) > 1e-6) {
      collider.localRadiusScaleRef = Math.abs(inferredScaleRef);
    }
  }
  collider.radius = data.radius;
}

function deserializeSpringCollider(ctx: SceneNode, data: SerializedSpringCollider): SpringCollider | null {
  const node = findSerializedNode(ctx, data.node);
  if (data.node && !node) {
    return null;
  }
  let collider: SpringCollider;
  switch (data.type) {
    case 'sphere': {
      const sphere = createSphereCollider(
        node && data.localOffset ? vectorFromArray(data.localOffset) : vectorFromArray(data.center),
        node ? (data.localRadius ?? data.radius) : data.radius,
        node ?? undefined
      );
      restoreSpringColliderRadiusScale(sphere, data);
      collider = sphere;
      break;
    }
    case 'capsule': {
      const capsule = createCapsuleCollider(
        node && data.localStartOffset ? vectorFromArray(data.localStartOffset) : vectorFromArray(data.start),
        node && data.localEndOffset ? vectorFromArray(data.localEndOffset) : vectorFromArray(data.end),
        node ? (data.localRadius ?? data.radius) : data.radius,
        node ?? undefined
      );
      restoreSpringColliderRadiusScale(capsule, data);
      collider = capsule;
      break;
    }
    case 'plane':
      collider = createPlaneCollider(
        node && data.localPointOffset ? vectorFromArray(data.localPointOffset) : vectorFromArray(data.point),
        node && data.localNormal ? vectorFromArray(data.localNormal) : vectorFromArray(data.normal),
        node ?? undefined
      );
      break;
  }
  collider.enabled = data.enabled;
  return collider;
}

function getSpringSystemOptions(
  system: SpringSystem | MultiChainSpringSystem
): SerializedSpringSystemOptions {
  return {
    iterations: system.iterations,
    gravity: vectorToArray(system.gravity),
    wind: vectorToArray(system.wind),
    enableInertialForces: system.enableInertialForces,
    centrifugalScale: system.centrifugalScale,
    coriolisScale: system.coriolisScale,
    solver: system.solver,
    poseFollow: system.poseFollow,
    poseFollowRoot: system.poseFollowRoot,
    poseFollowTip: system.poseFollowTip,
    poseFollowExponent: system.poseFollowExponent,
    maxPoseOffset: system.maxPoseOffset,
    maxPoseOffsetRoot: system.maxPoseOffsetRoot,
    maxPoseOffsetTip: system.maxPoseOffsetTip
  };
}

function deserializeSpringSystemOptions(options: SerializedSpringSystemOptions): SpringSystemOptions {
  return {
    ...options,
    gravity: vectorFromArray(options.gravity, new Vector3(0, -9.8, 0)),
    wind: vectorFromArray(options.wind)
  };
}

function serializeScalarCurve(value: InterpolatorScalar): SerializedScalarCurve {
  return {
    mode: value.mode,
    inputs: [...value.inputs],
    outputs: [...value.outputs]
  };
}

function deserializeScalarCurve(value: SerializedScalarCurve): InterpolatorScalar {
  return new InterpolatorScalar(
    value?.mode ?? 'step',
    new Float32Array(value?.inputs ?? [0]),
    new Float32Array(value?.outputs ?? [0])
  );
}

function serializeControllerConfig(value: ControllerConfig): SerializedControllerConfig {
  const curves: Record<string, SerializedScalarCurve> = {};
  for (const [key, curve] of Object.entries(value.curves)) {
    curves[key] = serializeScalarCurve(curve);
  }
  return {
    gravity: vectorToArray(value.gravity),
    windForce: vectorToArray(value.windForce),
    relaxation: value.relaxation,
    subSteps: value.subSteps,
    rootSlideLimit: value.rootSlideLimit,
    rootRotateLimit: value.rootRotateLimit,
    constraintShrinkLimit: value.constraintShrinkLimit,
    blendRatio: value.blendRatio,
    stabilizationFrameRate: value.stabilizationFrameRate,
    isFakeWave: value.isFakeWave,
    fakeWaveSpeed: value.fakeWaveSpeed,
    fakeWavePower: value.fakeWavePower,
    enableSurfaceCollision: value.enableSurfaceCollision,
    enableBroadPhase: value.enableBroadPhase,
    preserveTwist: value.preserveTwist,
    angleLimitConfig: { ...value.angleLimitConfig },
    curves,
    constraintOptions: { ...value.constraintOptions }
  };
}

function deserializeControllerConfig(
  value: SerializedControllerConfig | undefined
): JointDynamicSystemConfig['controllerConfig'] {
  if (!value) {
    return undefined;
  }
  const curves = Object.fromEntries(
    Object.entries(value.curves ?? {}).map(([key, curve]) => [key, deserializeScalarCurve(curve)])
  ) as Partial<ControllerConfig['curves']>;
  const config: JointDynamicSystemConfig['controllerConfig'] = {};
  if (value.gravity) {
    config.gravity = vectorFromArray(value.gravity, new Vector3(0, -9.8, 0));
  }
  if (value.windForce) {
    config.windForce = vectorFromArray(value.windForce);
  }
  for (const key of [
    'relaxation',
    'subSteps',
    'rootSlideLimit',
    'rootRotateLimit',
    'constraintShrinkLimit',
    'blendRatio',
    'stabilizationFrameRate',
    'isFakeWave',
    'fakeWaveSpeed',
    'fakeWavePower',
    'enableSurfaceCollision',
    'enableBroadPhase',
    'preserveTwist'
  ] as const) {
    if (value[key] !== undefined) {
      config[key] = value[key] as never;
    }
  }
  if (value.angleLimitConfig) {
    config.angleLimitConfig = { ...value.angleLimitConfig };
  }
  if (Object.keys(curves).length > 0) {
    config.curves = curves;
  }
  if (value.constraintOptions) {
    config.constraintOptions = { ...value.constraintOptions };
  }
  return config;
}

function findSerializedNode(root: SceneNode, id: string | undefined): SceneNode | null {
  if (!id) {
    return null;
  }
  const prefabNode = root.getPrefabNode() ?? root;
  return prefabNode.findNodeById(id) ?? root.scene?.findNodeById(id) ?? null;
}

export function setJointDynamicsModifierSkeleton(
  modifier: JointDynamicsModifier,
  skeleton: SkeletonRig
): void {
  jointDynamicsModifierSkeletons.set(modifier, skeleton);
}

export function getJointDynamicsModifierSkeleton(modifier: JointDynamicsModifier): SkeletonRig | null {
  return jointDynamicsModifierSkeletons.get(modifier) ?? null;
}

/** @internal */
export function setSpringModifierSkeleton(modifier: SpringModifier, skeleton: SkeletonRig): void {
  springModifierSkeletons.set(modifier, skeleton);
}

/** @internal */
export function getSpringModifierSkeleton(modifier: SpringModifier): SkeletonRig | null {
  return springModifierSkeletons.get(modifier) ?? null;
}

type JointDynamicsNumberConfigKey = {
  [K in keyof ControllerConfig]: ControllerConfig[K] extends number ? K : never;
}[keyof ControllerConfig];

type JointDynamicsBooleanConfigKey = {
  [K in keyof ControllerConfig]: ControllerConfig[K] extends boolean ? K : never;
}[keyof ControllerConfig];

type JointDynamicsCurveKey = keyof ControllerConfig['curves'];
type JointDynamicsConstraintOptionKey = keyof ControllerConfig['constraintOptions'];

const jointDynamicsPropOptions = { group: 'Joint Dynamics' };

function isJointDynamicsEditorPropPersistent() {
  return false;
}

function updateJointDynamicsConfig(modifier: JointDynamicsModifier, config: ControllerConfigUpdate): void {
  modifier.jointDynamicsSystem.controller.updateConfig(config);
}

function createJointDynamicsNumberProp(
  name: string,
  key: JointDynamicsNumberConfigKey,
  label: string,
  description: string,
  type: 'float' | 'int',
  minValue?: number
) {
  return {
    name,
    description,
    type,
    options: {
      ...jointDynamicsPropOptions,
      label,
      ...(minValue !== undefined ? { minValue } : {})
    },
    isPersistent: isJointDynamicsEditorPropPersistent,
    get(this: JointDynamicsModifier, value: Required<Pick<PropertyValue, 'num'>>) {
      value.num[0] = this.jointDynamicsSystem.controller.getConfig()[key] as number;
    },
    set(this: JointDynamicsModifier, value: Required<Pick<PropertyValue, 'num'>>) {
      updateJointDynamicsConfig(this, { [key]: value.num[0] } as ControllerConfigUpdate);
    }
  };
}

function createJointDynamicsBooleanProp(
  name: string,
  key: JointDynamicsBooleanConfigKey,
  label: string,
  description: string
) {
  return {
    name,
    description,
    type: 'bool',
    options: {
      ...jointDynamicsPropOptions,
      label
    },
    isPersistent: isJointDynamicsEditorPropPersistent,
    get(this: JointDynamicsModifier, value: Required<Pick<PropertyValue, 'bool'>>) {
      value.bool[0] = this.jointDynamicsSystem.controller.getConfig()[key] as boolean;
    },
    set(this: JointDynamicsModifier, value: Required<Pick<PropertyValue, 'bool'>>) {
      updateJointDynamicsConfig(this, { [key]: value.bool[0] } as ControllerConfigUpdate);
    }
  };
}

function createJointDynamicsVectorProp(
  name: string,
  key: 'gravity' | 'windForce',
  label: string,
  description: string
) {
  return {
    name,
    description,
    type: 'vec3',
    options: {
      ...jointDynamicsPropOptions,
      label
    },
    isPersistent: isJointDynamicsEditorPropPersistent,
    get(this: JointDynamicsModifier, value: Required<Pick<PropertyValue, 'num'>>) {
      const v = this.jointDynamicsSystem.controller.getConfig()[key];
      value.num[0] = v.x;
      value.num[1] = v.y;
      value.num[2] = v.z;
    },
    set(this: JointDynamicsModifier, value: Required<Pick<PropertyValue, 'num'>>) {
      updateJointDynamicsConfig(this, {
        [key]: new Vector3(value.num[0], value.num[1], value.num[2])
      } as ControllerConfigUpdate);
    }
  };
}

function createJointDynamicsAngleLimitNumberProp(
  name: string,
  key: 'angleLimit',
  label: string,
  description: string
) {
  return {
    name,
    description,
    type: 'float',
    options: {
      ...jointDynamicsPropOptions,
      label
    },
    isPersistent: isJointDynamicsEditorPropPersistent,
    get(this: JointDynamicsModifier, value: Required<Pick<PropertyValue, 'num'>>) {
      value.num[0] = this.jointDynamicsSystem.controller.getConfig().angleLimitConfig[key];
    },
    set(this: JointDynamicsModifier, value: Required<Pick<PropertyValue, 'num'>>) {
      updateJointDynamicsConfig(this, {
        angleLimitConfig: { [key]: value.num[0] }
      });
    }
  };
}

function createJointDynamicsAngleLimitBooleanProp(
  name: string,
  key: 'limitFromRoot',
  label: string,
  description: string
) {
  return {
    name,
    description,
    type: 'bool',
    options: {
      ...jointDynamicsPropOptions,
      label
    },
    isPersistent: isJointDynamicsEditorPropPersistent,
    get(this: JointDynamicsModifier, value: Required<Pick<PropertyValue, 'bool'>>) {
      value.bool[0] = this.jointDynamicsSystem.controller.getConfig().angleLimitConfig[key];
    },
    set(this: JointDynamicsModifier, value: Required<Pick<PropertyValue, 'bool'>>) {
      updateJointDynamicsConfig(this, {
        angleLimitConfig: { [key]: value.bool[0] }
      });
    }
  };
}

function createJointDynamicsConstraintOptionProp(
  name: string,
  key: JointDynamicsConstraintOptionKey,
  label: string,
  description: string
) {
  return {
    name,
    description,
    type: 'bool',
    options: {
      ...jointDynamicsPropOptions,
      label
    },
    isPersistent: isJointDynamicsEditorPropPersistent,
    get(this: JointDynamicsModifier, value: Required<Pick<PropertyValue, 'bool'>>) {
      value.bool[0] = this.jointDynamicsSystem.controller.getConfig().constraintOptions[key];
    },
    set(this: JointDynamicsModifier, value: Required<Pick<PropertyValue, 'bool'>>) {
      updateJointDynamicsConfig(this, {
        constraintOptions: { [key]: value.bool[0] } as Partial<ControllerConfig['constraintOptions']>
      });
    }
  };
}

function createJointDynamicsCurveProp(
  name: string,
  key: JointDynamicsCurveKey,
  label: string,
  description: string
) {
  return {
    name,
    description,
    type: 'float',
    options: {
      ...jointDynamicsPropOptions,
      label
    },
    isPersistent: isJointDynamicsEditorPropPersistent,
    get(this: JointDynamicsModifier, value: Required<Pick<PropertyValue, 'num'>>) {
      value.num[0] = this.jointDynamicsSystem.controller.getConfig().curves[key].evaluate(0);
    },
    set(this: JointDynamicsModifier, value: Required<Pick<PropertyValue, 'num'>>) {
      const val = value.num[0];
      updateJointDynamicsConfig(this, {
        curves: {
          [key]: InterpolatorScalar.constant(val)
        }
      });
    }
  };
  /*
  return {
    name,
    description,
    type: 'object',
    readonly: true,
    options: {
      ...jointDynamicsPropOptions,
      label,
      objectTypes: [Interpolator],
      edit: 'curve1f' as const
    },
    isPersistent: isJointDynamicsEditorPropPersistent,
    get(this: JointDynamicsModifier, value: Required<Pick<PropertyValue, 'object'>>) {
      value.object[0] = this.jointDynamicsSystem.controller.getConfig().curves[key];
    },
    set(this: JointDynamicsModifier, value: Required<Pick<PropertyValue, 'object'>>) {
      const curve = value.object[0];
      if (curve instanceof InterpolatorScalar) {
        updateJointDynamicsConfig(this, { curves: { [key]: curve } as Partial<ControllerConfig['curves']> });
      } else if (curve instanceof Interpolator && curve.target === 'number') {
        updateJointDynamicsConfig(this, {
          curves: {
            [key]: new InterpolatorScalar(
              curve.mode,
              new Float32Array(curve.inputs),
              new Float32Array(curve.outputs)
            )
          } as Partial<ControllerConfig['curves']>
        });
      }
    }
  };
  */
}

/** @internal */
export function getSpringModifierClass(): SerializableClass {
  return {
    ctor: SpringModifier,
    name: 'SpringModifier',
    createFunc(ctx: SceneNode, init: SerializedSpringModifier) {
      const skeleton =
        ctx.findSkeletonRigById(init.skeleton) ?? ctx.findSkeletonById(init.skeleton)?.rig ?? null;
      if (!skeleton || !Array.isArray(init.chains) || init.chains.length === 0) {
        return { obj: null, loadProps: false };
      }
      const chains = init.chains.map((chain) => deserializeSpringChain(ctx, chain));
      if (chains.some((chain) => !chain)) {
        return { obj: null, loadProps: false };
      }
      const options = deserializeSpringSystemOptions(init.options);
      let system: SpringSystem | MultiChainSpringSystem;
      if (init.systemType === 'single') {
        system = new SpringSystem(chains[0]!, options);
      } else {
        const multiChainSystem = new MultiChainSpringSystem(options);
        for (const chain of chains) {
          multiChainSystem.addChain(chain!);
        }
        for (const constraint of init.interChainConstraints ?? []) {
          if (
            constraint.chainAIndex < 0 ||
            constraint.chainBIndex < 0 ||
            constraint.chainAIndex >= chains.length ||
            constraint.chainBIndex >= chains.length
          ) {
            continue;
          }
          multiChainSystem.addInterChainConstraint({ ...constraint, lambda: 0 });
        }
        system = multiChainSystem;
      }
      for (const colliderData of init.colliders ?? []) {
        const collider = deserializeSpringCollider(ctx, colliderData);
        if (collider) {
          system.addCollider(collider);
        }
      }
      const modifier = new SpringModifier(system as unknown as SpringSystem, init.weight ?? 1);
      modifier.sourceId = init.sourceId ?? '';
      modifier.enabled = init.enabled ?? true;
      setSpringModifierSkeleton(modifier, skeleton);
      return { obj: modifier, loadProps: false };
    },
    getInitParams(obj: SpringModifier) {
      const skeleton = getSpringModifierSkeleton(obj);
      const system = obj.springSystem as unknown as SpringSystem | MultiChainSpringSystem;
      const isMultiChain = system instanceof MultiChainSpringSystem;
      if (!isMultiChain && !(system instanceof SpringSystem)) {
        throw new Error('Serialize SpringModifier failed: Unsupported spring system type');
      }
      const chains = isMultiChain ? system.chains : [system.chain];
      const init: SerializedSpringModifier = {
        skeleton: skeleton?.persistentId ?? '',
        sourceId: obj.sourceId,
        systemType: isMultiChain ? 'multi' : 'single',
        options: getSpringSystemOptions(system),
        chains: chains.map(serializeSpringChain),
        ...(isMultiChain
          ? {
              interChainConstraints: system.interChainConstraints.map(
                ({ lambda: _lambda, ...constraint }) => constraint
              )
            }
          : {}),
        colliders: system.colliders.map(serializeSpringCollider),
        enabled: obj.enabled,
        weight: obj.weight
      };
      return init;
    },
    getProps() {
      return defineProps([
        {
          name: 'Commands',
          description: 'Reset spring modifier state',
          type: 'command',
          command(this: SpringModifier) {
            this.reset();
            return false;
          },
          get(value) {
            value.str[0] = 'Reset';
          }
        },
        {
          name: 'Enabled',
          description: 'Whether this spring modifier is active',
          type: 'bool',
          isPersistent() {
            return false;
          },
          get(this: SpringModifier, value) {
            value.bool[0] = this.enabled;
          },
          set(this: SpringModifier, value) {
            this.enabled = value.bool[0];
          }
        },
        {
          name: 'Weight',
          description: 'Physics blend weight. 0 uses animation only, 1 uses full spring physics',
          type: 'float',
          options: {
            minValue: 0,
            maxValue: 1
          },
          isPersistent() {
            return false;
          },
          get(this: SpringModifier, value) {
            value.num[0] = this.weight;
          },
          set(this: SpringModifier, value) {
            this.weight = value.num[0];
          }
        }
      ]);
    }
  };
}

/** @internal */
export function getJointDynamicsModifierClass(): SerializableClass {
  return {
    ctor: JointDynamicsModifier,
    name: 'JointDynamicsModifier',
    createFunc(ctx: SceneNode, init: SerializedJointDynamicsModifier) {
      const skeleton =
        ctx.findSkeletonRigById(init.skeleton) ?? ctx.findSkeletonById(init.skeleton)?.rig ?? null;
      const systemRoot = findSerializedNode(ctx, init.systemRoot);
      if (!skeleton || !systemRoot) {
        return { obj: null, loadProps: false };
      }
      const chains = (init.chains ?? [])
        .map((chain): JointDynamicSystemConfig['chainConfig']['chains'][number] | null => {
          const start = findSerializedNode(ctx, chain.start);
          const end = findSerializedNode(ctx, chain.end);
          const startAnchor = findSerializedNode(ctx, chain.startAnchor);
          const endAnchor = findSerializedNode(ctx, chain.endAnchor);
          return start && end
            ? {
                start,
                end,
                startAnchor: startAnchor ?? undefined,
                endAnchor: endAnchor ?? undefined,
                startAnchorOffset: chain.startAnchorOffset
                  ? vectorFromArray(chain.startAnchorOffset)
                  : undefined,
                endAnchorOffset: chain.endAnchorOffset ? vectorFromArray(chain.endAnchorOffset) : undefined
              }
            : null;
        })
        .filter((chain): chain is JointDynamicSystemConfig['chainConfig']['chains'][number] => {
          return !!chain && chain.start.isParentOf(chain.end);
        });
      if (chains.length === 0) {
        return { obj: null, loadProps: false };
      }
      const serializedColliders = init.colliders ?? [];
      const colliders: { r: ColliderR; transform: ReturnType<typeof createTransformAccess> }[] =
        serializedColliders.map((item) => {
          const transform = findSerializedNode(ctx, item.transform);
          return {
            r: { ...item.collider },
            transform: transform
              ? createTransformAccess(transform)
              : createTransformAccess(new SceneNode(null), false)
          };
        });
      const serializedGrabbers = init.grabbers ?? [];
      const grabbers: {
        r: GrabberR;
        transform: ReturnType<typeof createTransformAccess>;
        enabled: boolean;
      }[] = serializedGrabbers.map((item) => {
        const transform = findSerializedNode(ctx, item.transform);
        return {
          r: { ...item.grabber },
          transform: transform
            ? createTransformAccess(transform)
            : createTransformAccess(new SceneNode(null), false),
          enabled: item.enabled ?? false
        };
      });
      const flatPlanes = (init.flatPlanes ?? []).map((item) => ({
        up: vectorFromArray(item.up, Vector3.axisPY()),
        position: vectorFromArray(item.position),
        enabled: item.enabled ?? true
      }));
      const controllerConfig = deserializeControllerConfig(init.controllerConfig);
      const config: JointDynamicSystemConfig = {
        chainConfig: {
          systemRoot,
          chains
        },
        controllerConfig
      };
      const system = new JointDynamicsSystem(
        config,
        colliders,
        grabbers,
        flatPlanes.map((item) => ({ up: item.up, position: item.position }))
      );
      for (let i = 0; i < serializedColliders.length; i++) {
        if (serializedColliders[i]?.enabled === false) {
          system.controller.setColliderEnabledAt(i, false);
        }
      }
      for (let i = 0; i < flatPlanes.length; i++) {
        if (!flatPlanes[i].enabled) {
          system.controller.setFlatPlaneEnabledAt(i, false);
        }
      }
      const modifier = new JointDynamicsModifier(system);
      modifier.enabled = init.enabled ?? true;
      setJointDynamicsModifierSkeleton(modifier, skeleton);
      return { obj: modifier, loadProps: false };
    },
    getInitParams(obj: JointDynamicsModifier) {
      const skeleton = getJointDynamicsModifierSkeleton(obj);
      const chainConfig = obj.jointDynamicsSystem.chainConfig;
      const controllerConfig = obj.jointDynamicsSystem.controller.getConfig();
      const init: SerializedJointDynamicsModifier = {
        skeleton: skeleton?.persistentId ?? '',
        systemRoot: chainConfig.systemRoot.persistentId,
        chains: chainConfig.chains.map((chain) => ({
          start: chain.start.persistentId,
          end: chain.end.persistentId,
          startAnchor: chain.startAnchor?.persistentId,
          endAnchor: chain.endAnchor?.persistentId,
          startAnchorOffset: chain.startAnchorOffset ? vectorToArray(chain.startAnchorOffset) : undefined,
          endAnchorOffset: chain.endAnchorOffset ? vectorToArray(chain.endAnchorOffset) : undefined
        })),
        controllerConfig: serializeControllerConfig(controllerConfig),
        colliders: obj.jointDynamicsSystem.getColliderSnapshots().map((item) => ({
          collider: { ...item.r },
          transform: item.transform instanceof SceneNode ? item.transform.persistentId : undefined,
          enabled: item.enabled
        })),
        flatPlanes: obj.jointDynamicsSystem.getFlatPlaneSnapshots().map((item) => ({
          up: vectorToArray(item.up),
          position: vectorToArray(item.position),
          enabled: item.enabled
        })),
        grabbers: obj.jointDynamicsSystem.getGrabberSnapshots().map((item) => ({
          grabber: { ...item.r },
          transform: item.transform instanceof SceneNode ? item.transform.persistentId : undefined,
          enabled: item.enabled
        })),
        enabled: obj.enabled
      };
      return init;
    },
    getProps() {
      return defineProps([
        {
          name: 'Commands',
          description: 'Reset joint dynamics modifier state',
          type: 'command',
          command(this: JointDynamicsModifier) {
            this.reset();
            return false;
          },
          get(value) {
            value.str[0] = 'Reset';
          }
        },
        {
          name: 'Enabled',
          description: 'Whether this joint dynamics modifier is active',
          type: 'bool',
          options: {
            ...jointDynamicsPropOptions,
            label: 'Enabled'
          },
          isPersistent: isJointDynamicsEditorPropPersistent,
          get(this: JointDynamicsModifier, value) {
            value.bool[0] = this.enabled;
          },
          set(this: JointDynamicsModifier, value) {
            this.enabled = value.bool[0];
          }
        },
        {
          name: 'Weight',
          description: 'Physics blend weight. 0 uses animation only, 1 uses full joint dynamics',
          type: 'float',
          options: {
            ...jointDynamicsPropOptions,
            label: 'Weight',
            minValue: 0,
            maxValue: 1
          },
          isPersistent: isJointDynamicsEditorPropPersistent,
          get(this: JointDynamicsModifier, value) {
            value.num[0] = this.weight;
          },
          set(this: JointDynamicsModifier, value) {
            this.weight = value.num[0];
          }
        },
        createJointDynamicsVectorProp('Gravity', 'gravity', 'Gravity', 'Global gravity vector'),
        createJointDynamicsVectorProp('WindForce', 'windForce', 'Wind Force', 'Global wind force vector'),
        createJointDynamicsNumberProp(
          'Relaxation',
          'relaxation',
          'Relaxation',
          'Constraint relaxation iterations per substep',
          'int',
          0
        ),
        createJointDynamicsNumberProp(
          'SubSteps',
          'subSteps',
          'Sub Steps',
          'Simulation substeps per frame',
          'int',
          1
        ),
        createJointDynamicsNumberProp(
          'RootSlideLimit',
          'rootSlideLimit',
          'Root Slide Limit',
          'Maximum system-local root movement left as relative physics lag after large root motion. -1 means unlimited',
          'float'
        ),
        createJointDynamicsNumberProp(
          'RootRotateLimit',
          'rootRotateLimit',
          'Root Rotate Limit',
          'Maximum root rotation angle per substep. -1 means unlimited',
          'float'
        ),
        createJointDynamicsNumberProp(
          'ConstraintShrinkLimit',
          'constraintShrinkLimit',
          'Shrink Limit',
          'Upper limit for horizontal and shear constraint shrink power',
          'float',
          0
        ),
        createJointDynamicsNumberProp(
          'StabilizationFrameRate',
          'stabilizationFrameRate',
          'Stabilization FPS',
          'Target frame rate used by stabilization logic',
          'float',
          0
        ),
        createJointDynamicsBooleanProp(
          'FakeWave',
          'isFakeWave',
          'Fake Wave',
          'Enable sinusoidal fake wave on leaf bones'
        ),
        createJointDynamicsNumberProp(
          'FakeWaveSpeed',
          'fakeWaveSpeed',
          'Fake Wave Speed',
          'Global fake wave speed',
          'float'
        ),
        createJointDynamicsNumberProp(
          'FakeWavePower',
          'fakeWavePower',
          'Fake Wave Power',
          'Global fake wave amplitude multiplier',
          'float'
        ),
        createJointDynamicsBooleanProp(
          'EnableSurfaceCollision',
          'enableSurfaceCollision',
          'Surface Collision',
          'Enable triangle-based surface collision'
        ),
        createJointDynamicsBooleanProp(
          'EnableBroadPhase',
          'enableBroadPhase',
          'Broad Phase',
          'Enable broad-phase pruning before precise collider tests'
        ),
        createJointDynamicsBooleanProp(
          'PreserveTwist',
          'preserveTwist',
          'Preserve Twist',
          'Preserve each joint initial local twist after physics simulation'
        ),
        createJointDynamicsAngleLimitNumberProp(
          'AngleLimit',
          'angleLimit',
          'Angle Limit',
          'Post-simulation parent-child angle limit. -1 disables angle limiting'
        ),
        createJointDynamicsAngleLimitBooleanProp(
          'AngleLimitFromRoot',
          'limitFromRoot',
          'Limit From Root',
          'Apply angle limiting from the chain root'
        ),
        createJointDynamicsConstraintOptionProp(
          'StructuralVertical',
          'structuralVertical',
          'Structural Vertical',
          'Generate parent-child vertical constraints'
        ),
        createJointDynamicsConstraintOptionProp(
          'StructuralHorizontal',
          'structuralHorizontal',
          'Structural Horizontal',
          'Generate same-depth horizontal constraints across chains'
        ),
        createJointDynamicsConstraintOptionProp(
          'Shear',
          'shear',
          'Shear',
          'Generate diagonal cross-bracing constraints'
        ),
        createJointDynamicsConstraintOptionProp(
          'BendingVertical',
          'bendingVertical',
          'Bending Vertical',
          'Generate skip-one vertical bending constraints'
        ),
        createJointDynamicsConstraintOptionProp(
          'BendingHorizontal',
          'bendingHorizontal',
          'Bending Horizontal',
          'Generate skip-one horizontal bending constraints'
        ),
        createJointDynamicsConstraintOptionProp(
          'Loop',
          'isLoop',
          'Loop',
          'Connect the last root point back to the first root point'
        ),
        createJointDynamicsConstraintOptionProp(
          'CollideStructuralVertical',
          'collideStructuralVertical',
          'Collide Structural V',
          'Enable per-constraint collision on structural vertical pairs'
        ),
        createJointDynamicsConstraintOptionProp(
          'CollideStructuralHorizontal',
          'collideStructuralHorizontal',
          'Collide Structural H',
          'Enable per-constraint collision on structural horizontal pairs'
        ),
        createJointDynamicsConstraintOptionProp(
          'CollideShear',
          'collideShear',
          'Collide Shear',
          'Enable per-constraint collision on shear pairs'
        ),
        createJointDynamicsConstraintOptionProp(
          'ConstraintSurfaceCollision',
          'enableSurfaceCollision',
          'Constraint Surface Collision',
          'Enable surface collision in constraint generation'
        ),
        createJointDynamicsCurveProp(
          'MassScale',
          'massScale',
          'Mass Scale',
          'Depth curve that scales point mass'
        ),
        createJointDynamicsCurveProp(
          'GravityScale',
          'gravityScale',
          'Gravity Scale',
          'Depth curve that scales gravity strength'
        ),
        createJointDynamicsCurveProp(
          'WindForceScale',
          'windForceScale',
          'Wind Force Scale',
          'Depth curve that scales wind force'
        ),
        createJointDynamicsCurveProp(
          'Resistance',
          'resistance',
          'Resistance',
          'Depth curve for velocity damping'
        ),
        createJointDynamicsCurveProp(
          'Hardness',
          'hardness',
          'Hardness',
          'Depth curve for restore-to-animation stiffness'
        ),
        createJointDynamicsCurveProp(
          'Friction',
          'friction',
          'Friction',
          'Depth curve for collision friction'
        ),
        createJointDynamicsCurveProp(
          'PointRadius',
          'pointRadius',
          'Point Radius',
          'Depth curve for collision radius'
        ),
        createJointDynamicsCurveProp(
          'SliderJointLength',
          'sliderJointLength',
          'Slider Joint Length',
          'Depth curve for extra horizontal and shear constraint slack'
        ),
        createJointDynamicsCurveProp(
          'AllShrinkScale',
          'allShrinkScale',
          'All Shrink Scale',
          'Depth curve for global shrink stiffness multiplier'
        ),
        createJointDynamicsCurveProp(
          'AllStretchScale',
          'allStretchScale',
          'All Stretch Scale',
          'Depth curve for global stretch stiffness multiplier'
        ),
        createJointDynamicsCurveProp(
          'StructuralShrinkVertical',
          'structuralShrinkVertical',
          'Structural Shrink V',
          'Depth curve for structural vertical shrink stiffness'
        ),
        createJointDynamicsCurveProp(
          'StructuralStretchVertical',
          'structuralStretchVertical',
          'Structural Stretch V',
          'Depth curve for structural vertical stretch stiffness'
        ),
        createJointDynamicsCurveProp(
          'StructuralShrinkHorizontal',
          'structuralShrinkHorizontal',
          'Structural Shrink H',
          'Depth curve for structural horizontal shrink stiffness'
        ),
        createJointDynamicsCurveProp(
          'StructuralStretchHorizontal',
          'structuralStretchHorizontal',
          'Structural Stretch H',
          'Depth curve for structural horizontal stretch stiffness'
        ),
        createJointDynamicsCurveProp(
          'ShearShrink',
          'shearShrink',
          'Shear Shrink',
          'Depth curve for shear shrink stiffness'
        ),
        createJointDynamicsCurveProp(
          'ShearStretch',
          'shearStretch',
          'Shear Stretch',
          'Depth curve for shear stretch stiffness'
        ),
        createJointDynamicsCurveProp(
          'BendingShrinkVertical',
          'bendingShrinkVertical',
          'Bending Shrink V',
          'Depth curve for bending vertical shrink stiffness'
        ),
        createJointDynamicsCurveProp(
          'BendingStretchVertical',
          'bendingStretchVertical',
          'Bending Stretch V',
          'Depth curve for bending vertical stretch stiffness'
        ),
        createJointDynamicsCurveProp(
          'BendingShrinkHorizontal',
          'bendingShrinkHorizontal',
          'Bending Shrink H',
          'Depth curve for bending horizontal shrink stiffness'
        ),
        createJointDynamicsCurveProp(
          'BendingStretchHorizontal',
          'bendingStretchHorizontal',
          'Bending Stretch H',
          'Depth curve for bending horizontal stretch stiffness'
        ),
        createJointDynamicsCurveProp(
          'FakeWavePowerCurve',
          'fakeWavePower',
          'Fake Wave Power Curve',
          'Depth curve for fake wave amplitude'
        ),
        createJointDynamicsCurveProp(
          'FakeWaveFreq',
          'fakeWaveFreq',
          'Fake Wave Freq',
          'Depth curve for fake wave frequency offset'
        )
      ]);
    }
  };
}

/** @internal */
export function getInterpolatorClass(): SerializableClass {
  return {
    ctor: Interpolator,
    name: 'Interpolator',
    createFunc(
      ctx,
      init: { mode: InterpolationMode; target: InterpolationTarget; inputs: string; outputs: string }
    ) {
      const inputs = init.inputs
        ? new Float32Array(base64ToUint8Array(init.inputs).buffer)
        : new Float32Array();
      const outputs = init.outputs
        ? new Float32Array(base64ToUint8Array(init.outputs).buffer)
        : new Float32Array();
      return { obj: new Interpolator(init.mode, init.target, inputs, outputs) };
    },
    getInitParams(obj: Interpolator) {
      const inputs: Float32Array<ArrayBuffer> =
        obj.inputs instanceof Float32Array
          ? obj.inputs
          : obj.inputs
            ? new Float32Array(obj.inputs)
            : new Float32Array();
      const outputs: Float32Array<ArrayBuffer> =
        obj.outputs instanceof Float32Array
          ? obj.outputs
          : obj.outputs
            ? new Float32Array(obj.outputs)
            : new Float32Array();
      return {
        mode: obj.mode,
        target: obj.target,
        inputs: uint8ArrayToBase64(new Uint8Array(inputs.buffer, inputs.byteOffset, inputs.byteLength)),
        outputs: uint8ArrayToBase64(new Uint8Array(outputs.buffer, outputs.byteOffset, outputs.byteLength))
      };
    },
    getProps() {
      return defineProps([
        {
          name: 'Mode',
          description:
            'What kind of method does this interpolator use to interpolate data, possible value is `step` | `linear` | `cubicspline` | `cubicspline-natural`',
          type: 'string',
          get(this: Interpolator, value) {
            value.str[0] = this.mode;
          }
        },
        {
          name: 'Target',
          description:
            'What type of data this interpolator handles, possible value is `number` | `vec2` | `vec3` | `vec4 | `quat`',
          type: 'string',
          get(this: Interpolator, value) {
            value.str[0] = this.target ?? '';
          }
        }
      ]);
    }
  };
}

/** @internal */
export function getMorphTrackClass(): SerializableClass {
  return {
    ctor: MorphTargetTrack,
    name: 'MorphTargetTrack',
    getProps() {
      return defineProps([
        {
          name: 'TrackName',
          description: 'The track name',
          type: 'string',
          options: {
            label: 'Name'
          },
          get(this: MorphTargetTrack, value) {
            value.str[0] = this.name;
          },
          set(this: MorphTargetTrack, value) {
            this.name = value.str[0];
          }
        },
        {
          name: 'Interpolator',
          description: 'Interpolator object for this track',
          type: 'object',
          options: {
            objectTypes: [Interpolator]
          },
          isHidden() {
            return true;
          },
          get(this: MorphTargetTrack, value) {
            value.object[0] = this.interpolator;
          },
          set(this: MorphTargetTrack, value) {
            this.interpolator = value.object[0] as Interpolator;
          }
        },
        {
          name: 'DefaultWeights',
          description: 'Default weights for this track',
          type: 'object',
          get(this: MorphTargetTrack, value) {
            value.object[0] = this.defaultWeights ?? null;
          },
          set(this: MorphTargetTrack, value) {
            this.defaultWeights = (value.object[0] as number[]) ?? null;
          }
        },
        {
          name: 'OriginBoundingBox',
          description: 'Original bounding box',
          type: 'object',
          get(this: MorphTargetTrack, value) {
            if (!this.originBoundingBox) {
              value.object[0] = null;
            } else {
              const arr = [...this.originBoundingBox.minPoint, ...this.originBoundingBox.maxPoint];
              value.object[0] = arr;
            }
          },
          set(this: MorphTargetTrack, value) {
            if (!value.object[0]) {
              this.originBoundingBox = null;
            } else {
              const bbox = new AABB();
              const values = value.object[0] as number[];
              bbox.minPoint.setXYZ(values[0], values[1], values[2]);
              bbox.maxPoint.setXYZ(values[3], values[4], values[5]);
              this.originBoundingBox = bbox;
            }
          }
        },
        {
          name: 'BoundingBox',
          description: 'Bounding box when this track in action',
          type: 'object',
          get(this: MorphTargetTrack, value) {
            if (!this.boundingBox) {
              value.object[0] = null;
            } else {
              const arr: number[] = [];
              for (const box of this.boundingBox) {
                arr.push(...box.minPoint);
                arr.push(...box.maxPoint);
              }
              value.object[0] = arr;
            }
          },
          set(this: MorphTargetTrack, value) {
            if (!value.object[0]) {
              this.boundingBox = null;
            } else {
              const arr: BoundingBox[] = [];
              const values = value.object[0] as number[];
              for (let i = 0; i < values.length / 6; i++) {
                arr.push(
                  new BoundingBox(
                    new Vector3(values[i * 6 + 0], values[i * 6 + 1], values[i * 6 + 2]),
                    new Vector3(values[i * 6 + 3], values[i * 6 + 4], values[i * 6 + 5])
                  )
                );
              }
              this.boundingBox = arr;
            }
          }
        },
        {
          name: 'TrackTarget',
          description: 'Target object this track applys to',
          type: 'string',
          isHidden() {
            return true;
          },
          get(this: NodeRotationTrack, value) {
            value.str[0] = this.target;
          },
          set(this: NodeRotationTrack, value) {
            this.target = value.str[0];
          }
        }
      ]);
    }
  };
}

function encodeFloat32Array(values: Float32Array) {
  return uint8ArrayToBase64(new Uint8Array(values.buffer, values.byteOffset, values.byteLength));
}

function decodeFloat32Array(value: string) {
  return new Float32Array(base64ToUint8Array(value).buffer);
}

export function getFixedGeometryCacheTrackClass(): SerializableClass {
  return {
    ctor: FixedGeometryCacheTrack,
    name: 'FixedGeometryCacheTrack',
    getProps() {
      return defineProps([
        {
          name: 'TrackName',
          description: 'The track name',
          type: 'string',
          options: {
            label: 'Name'
          },
          get(this: FixedGeometryCacheTrack, value) {
            value.str[0] = this.name;
          },
          set(this: FixedGeometryCacheTrack, value) {
            this.name = value.str[0];
          }
        },
        {
          name: 'TrackTarget',
          description: 'Target object this track applys to',
          type: 'string',
          isHidden() {
            return true;
          },
          get(this: FixedGeometryCacheTrack, value) {
            value.str[0] = this.target;
          },
          set(this: FixedGeometryCacheTrack, value) {
            this.target = value.str[0];
          }
        },
        {
          name: 'Times',
          description: 'Keyframe timestamps for this geometry cache track',
          type: 'string',
          isHidden() {
            return true;
          },
          get(this: FixedGeometryCacheTrack, value) {
            value.str[0] = encodeFloat32Array(this.times);
          },
          set(this: FixedGeometryCacheTrack, value) {
            this.times = value.str[0] ? decodeFloat32Array(value.str[0]) : new Float32Array();
          }
        },
        {
          name: 'Frames',
          description: 'Serialized geometry cache frames for this track',
          type: 'object',
          isHidden() {
            return true;
          },
          get(this: FixedGeometryCacheTrack, value) {
            value.object[0] = this.frames.map((frame) => ({
              positions: encodeFloat32Array(frame.positions),
              normals: frame.normals ? encodeFloat32Array(frame.normals) : '',
              bounds: [
                frame.boundingBox.minPoint.x,
                frame.boundingBox.minPoint.y,
                frame.boundingBox.minPoint.z,
                frame.boundingBox.maxPoint.x,
                frame.boundingBox.maxPoint.y,
                frame.boundingBox.maxPoint.z
              ]
            }));
          },
          set(this: FixedGeometryCacheTrack, value) {
            this.frames = (
              (value.object[0] as Array<{
                positions: string;
                normals: string;
                bounds: number[];
              }>) ?? []
            ).map((frame) => ({
              positions: decodeFloat32Array(frame.positions),
              normals: frame.normals ? decodeFloat32Array(frame.normals) : null,
              boundingBox: new BoundingBox(
                new Vector3(frame.bounds[0], frame.bounds[1], frame.bounds[2]),
                new Vector3(frame.bounds[3], frame.bounds[4], frame.bounds[5])
              )
            }));
          }
        }
      ]);
    }
  };
}

export function getPCAGeometryCacheTrackClass(): SerializableClass {
  return {
    ctor: PCAGeometryCacheTrack,
    name: 'PCAGeometryCacheTrack',
    getProps() {
      return defineProps([
        {
          name: 'TrackName',
          description: 'The track name',
          type: 'string',
          options: {
            label: 'Name'
          },
          get(this: PCAGeometryCacheTrack, value) {
            value.str[0] = this.name;
          },
          set(this: PCAGeometryCacheTrack, value) {
            this.name = value.str[0];
          }
        },
        {
          name: 'TrackTarget',
          description: 'Target object this track applys to',
          type: 'string',
          isHidden() {
            return true;
          },
          get(this: PCAGeometryCacheTrack, value) {
            value.str[0] = this.target;
          },
          set(this: PCAGeometryCacheTrack, value) {
            this.target = value.str[0];
          }
        },
        {
          name: 'Times',
          description: 'Keyframe timestamps for this PCA geometry cache track',
          type: 'string',
          isHidden() {
            return true;
          },
          get(this: PCAGeometryCacheTrack, value) {
            value.str[0] = encodeFloat32Array(this.times);
          },
          set(this: PCAGeometryCacheTrack, value) {
            this.times = value.str[0] ? decodeFloat32Array(value.str[0]) : new Float32Array();
          }
        },
        {
          name: 'Bounds',
          description: 'Per-frame bounding boxes for the PCA geometry cache',
          type: 'object',
          isHidden() {
            return true;
          },
          get(this: PCAGeometryCacheTrack, value) {
            value.object[0] = this.bounds;
          },
          set(this: PCAGeometryCacheTrack, value) {
            this.bounds = (value.object[0] as [number, number, number, number, number, number][]) ?? [];
          }
        },
        {
          name: 'PositionReference',
          description: 'Reference position data for the PCA geometry cache',
          type: 'string',
          isHidden() {
            return true;
          },
          get(this: PCAGeometryCacheTrack, value) {
            value.str[0] = this.positionReference ? encodeFloat32Array(this.positionReference) : '';
          },
          set(this: PCAGeometryCacheTrack, value) {
            this.positionReference = value.str[0] ? decodeFloat32Array(value.str[0]) : null;
          }
        },
        {
          name: 'PositionMean',
          description: 'Mean position data for the PCA geometry cache',
          type: 'string',
          isHidden() {
            return true;
          },
          get(this: PCAGeometryCacheTrack, value) {
            value.str[0] = encodeFloat32Array(this.positionMean);
          },
          set(this: PCAGeometryCacheTrack, value) {
            this.positionMean = value.str[0] ? decodeFloat32Array(value.str[0]) : new Float32Array();
          }
        },
        {
          name: 'PositionBases',
          description: 'Principal position basis vectors for the PCA geometry cache',
          type: 'object',
          isHidden() {
            return true;
          },
          get(this: PCAGeometryCacheTrack, value) {
            value.object[0] = this.positionBases.map((item) => encodeFloat32Array(item));
          },
          set(this: PCAGeometryCacheTrack, value) {
            this.positionBases = ((value.object[0] as string[]) ?? []).map((item) =>
              decodeFloat32Array(item)
            );
          }
        },
        {
          name: 'PositionCoefficients',
          description: 'Per-frame position coefficient data for the PCA geometry cache',
          type: 'object',
          isHidden() {
            return true;
          },
          get(this: PCAGeometryCacheTrack, value) {
            value.object[0] = this.positionCoefficients.map((item) => encodeFloat32Array(item));
          },
          set(this: PCAGeometryCacheTrack, value) {
            this.positionCoefficients = ((value.object[0] as string[]) ?? []).map((item) =>
              decodeFloat32Array(item)
            );
          }
        },
        {
          name: 'NormalMean',
          description: 'Mean normal data for the PCA geometry cache',
          type: 'string',
          isHidden() {
            return true;
          },
          get(this: PCAGeometryCacheTrack, value) {
            value.str[0] = this.normalMean ? encodeFloat32Array(this.normalMean) : '';
          },
          set(this: PCAGeometryCacheTrack, value) {
            this.normalMean = value.str[0] ? decodeFloat32Array(value.str[0]) : null;
          }
        },
        {
          name: 'NormalBases',
          description: 'Principal normal basis vectors for the PCA geometry cache',
          type: 'object',
          isHidden() {
            return true;
          },
          get(this: PCAGeometryCacheTrack, value) {
            value.object[0] = this.normalBases?.map((item) => encodeFloat32Array(item)) ?? [];
          },
          set(this: PCAGeometryCacheTrack, value) {
            this.normalBases =
              ((value.object[0] as string[]) ?? []).map((item) => decodeFloat32Array(item)) ?? null;
          }
        },
        {
          name: 'NormalCoefficients',
          description: 'Per-frame normal coefficient data for the PCA geometry cache',
          type: 'object',
          isHidden() {
            return true;
          },
          get(this: PCAGeometryCacheTrack, value) {
            value.object[0] = this.normalCoefficients?.map((item) => encodeFloat32Array(item)) ?? [];
          },
          set(this: PCAGeometryCacheTrack, value) {
            this.normalCoefficients =
              ((value.object[0] as string[]) ?? []).map((item) => decodeFloat32Array(item)) ?? null;
          }
        }
      ]);
    }
  };
}

/** @internal */
export function getNodeRotationTrackClass(): SerializableClass {
  return {
    ctor: NodeRotationTrack,
    name: 'NodeRotationTrack',
    getProps() {
      return defineProps([
        {
          name: 'TrackName',
          description: 'The track name',
          type: 'string',
          options: {
            label: 'Name'
          },
          get(this: NodeRotationTrack, value) {
            value.str[0] = this.name;
          },
          set(this: NodeRotationTrack, value) {
            this.name = value.str[0];
          }
        },
        {
          name: 'Interpolator',
          description: 'Interpolator object for this track',
          type: 'object',
          options: {
            objectTypes: [Interpolator]
          },
          isHidden() {
            return true;
          },
          get(this: NodeRotationTrack, value) {
            value.object[0] = this.interpolator;
          },
          set(this: NodeRotationTrack, value) {
            this.interpolator = value.object[0] as Interpolator;
          }
        },
        {
          name: 'TrackTarget',
          description: 'Target object this track applys to',
          type: 'string',
          isHidden() {
            return true;
          },
          get(this: NodeRotationTrack, value) {
            value.str[0] = this.target;
          },
          set(this: NodeRotationTrack, value) {
            this.target = value.str[0];
          }
        }
      ]);
    }
  };
}

/** @internal */
export function getNodeEulerRotationTrackClass(): SerializableClass {
  return {
    ctor: NodeEulerRotationTrack,
    name: 'NodeEulerRotationTrack',
    getProps() {
      return defineProps([
        {
          name: 'TrackName',
          description: 'The track name',
          type: 'string',
          options: {
            label: 'Name'
          },
          get(this: NodeEulerRotationTrack, value) {
            value.str[0] = this.name;
          },
          set(this: NodeEulerRotationTrack, value) {
            this.name = value.str[0];
          }
        },
        {
          name: 'Interpolator',
          description: 'Interpolator object for this track',
          type: 'object',
          options: {
            objectTypes: [Interpolator]
          },
          isHidden() {
            return true;
          },
          get(this: NodeEulerRotationTrack, value) {
            value.object[0] = this.interpolator;
          },
          set(this: NodeEulerRotationTrack, value) {
            this.interpolator = value.object[0] as Interpolator;
          }
        },
        {
          name: 'TrackTarget',
          description: 'Target object this track applys to',
          type: 'string',
          isHidden() {
            return true;
          },
          get(this: NodeEulerRotationTrack, value) {
            value.str[0] = this.target;
          },
          set(this: NodeEulerRotationTrack, value) {
            this.target = value.str[0];
          }
        }
      ]);
    }
  };
}

/** @internal */
export function getNodeTranslationTrackClass(): SerializableClass {
  return {
    ctor: NodeTranslationTrack,
    name: 'NodeTranslationTrack',
    getProps() {
      return defineProps([
        {
          name: 'TrackName',
          description: 'The track name',
          type: 'string',
          options: {
            label: 'Name'
          },
          get(this: NodeTranslationTrack, value) {
            value.str[0] = this.name;
          },
          set(this: NodeTranslationTrack, value) {
            this.name = value.str[0];
          }
        },
        {
          name: 'Interpolator',
          description: 'Interpolator object for this track',
          type: 'object',
          options: {
            objectTypes: [Interpolator]
          },
          isHidden() {
            return true;
          },
          get(this: NodeTranslationTrack, value) {
            value.object[0] = this.interpolator;
          },
          set(this: NodeTranslationTrack, value) {
            this.interpolator = value.object[0] as Interpolator;
          }
        },
        {
          name: 'TrackTarget',
          description: 'Target object this track applys to',
          type: 'string',
          isHidden() {
            return true;
          },
          get(this: NodeTranslationTrack, value) {
            value.str[0] = this.target;
          },
          set(this: NodeTranslationTrack, value) {
            this.target = value.str[0];
          }
        }
      ]);
    }
  };
}

/** @internal */
export function getNodeScaleTrackClass(): SerializableClass {
  return {
    ctor: NodeScaleTrack,
    name: 'NodeScaleTrack',
    getProps() {
      return defineProps([
        {
          name: 'TrackName',
          description: 'The track name',
          type: 'string',
          options: {
            label: 'Name'
          },
          get(this: NodeScaleTrack, value) {
            value.str[0] = this.name;
          },
          set(this: NodeScaleTrack, value) {
            this.name = value.str[0];
          }
        },
        {
          name: 'Interpolator',
          description: 'Interpolator object for this track',
          type: 'object',
          options: {
            objectTypes: [Interpolator]
          },
          isHidden() {
            return true;
          },
          get(this: NodeScaleTrack, value) {
            value.object[0] = this.interpolator;
          },
          set(this: NodeScaleTrack, value) {
            this.interpolator = value.object[0] as Interpolator;
          }
        },
        {
          name: 'TrackTarget',
          description: 'Target object this track applys to',
          type: 'string',
          isHidden() {
            return true;
          },
          get(this: NodeScaleTrack, value) {
            value.str[0] = this.target;
          },
          set(this: NodeScaleTrack, value) {
            this.target = value.str[0];
          }
        }
      ]);
    }
  };
}

/** @internal */
export function getPropTrackClass(manager: ResourceManager): SerializableClass {
  return {
    ctor: PropertyTrack,
    name: 'PropertyTrack',
    createFunc(ctx, init) {
      return { obj: new PropertyTrack(manager.getPropertyByName(init)) };
    },
    getInitParams(obj: PropertyTrack) {
      return manager.getPropertyName(obj.getProp());
    },
    getProps() {
      return defineProps([
        {
          name: 'TrackName',
          description: 'The track name',
          type: 'string',
          options: {
            label: 'Name'
          },
          get(this: PropertyTrack, value) {
            value.str[0] = this.name;
          },
          set(this: PropertyTrack, value) {
            this.name = value.str[0];
          }
        },
        {
          name: 'TrackTarget',
          description: 'Target object this track applys to',
          type: 'string',
          options: {
            label: 'Target'
          },
          get(this: PropertyTrack, value) {
            value.str[0] = this.target;
          },
          set(this: PropertyTrack, value) {
            this.target = value.str[0];
          }
        },
        {
          name: 'TrackProp',
          description: 'Which property of the target object does this track handle',
          type: 'string',
          get(this: PropertyTrack, value) {
            value.str[0] = manager.getPropertyName(this.getProp()) ?? '';
          }
        },
        {
          name: 'TrackData',
          description: 'Interpolator data used by this property track',
          type: 'object_array',
          options: {
            objectTypes: [Interpolator]
          },
          isHidden(this: PropertyTrack, index: number) {
            return index >= 0;
          },
          get(this: PropertyTrack, value) {
            value.object = this.interpolatorAlpha
              ? [this.interpolator, this.interpolatorAlpha]
              : [this.interpolator];
          },
          set(this: PropertyTrack, value) {
            this.interpolator = value.object[0] as Interpolator;
            this.interpolatorAlpha = value.object[1] as Interpolator;
          }
        }
      ]);
    }
  };
}

/** @internal */
export function getSkeletonClass(): SerializableClass {
  return {
    ctor: Skeleton,
    name: 'Skeleton',
    createFunc(
      ctx: SceneNode,
      init: {
        joints: string[];
        rootJoint?: string;
        rootBindPose?: string;
        inverseBindMatrices: string;
        bindPoseMatrices: string;
        bindPose: string;
        id: string;
      }
    ) {
      const prefabNode = ctx.getPrefabNode() ?? ctx;
      const joints = init.joints
        .map((id) => prefabNode.findNodeById(id)!)
        .map((node) => {
          node!.jointTypeT = 'static';
          node!.jointTypeS = 'static';
          node!.jointTypeR = 'static';
          return node;
        });
      const rootJoint = init.rootJoint ? prefabNode.findNodeById(init.rootJoint) : null;
      const inverseBindMatricesArray = new Float32Array(base64ToUint8Array(init.inverseBindMatrices).buffer);
      const bindPoseArray = new Float32Array(
        base64ToUint8Array(init.bindPose ?? init.bindPoseMatrices).buffer
      );
      const rootBindPose = init.rootBindPose ? decodeSkeletonBindPose(init.rootBindPose) : undefined;
      const inverseBindMatrices: Matrix4x4[] = [];
      const bindPose: { rotation: Quaternion; scale: Vector3; position: Vector3 }[] = [];
      for (let i = 0; i < joints.length; i++) {
        inverseBindMatrices.push(new Matrix4x4(inverseBindMatricesArray.slice(i * 16, i * 16 + 16)));
        if (!init.bindPose) {
          const matrix = new Matrix4x4(bindPoseArray.slice(i * 16, i * 16 + 16));
          const trs = {
            position: new Vector3(),
            rotation: new Quaternion(),
            scale: new Vector3()
          };
          matrix.decompose(trs.scale, trs.rotation, trs.position);
          bindPose.push(trs);
        } else {
          bindPose.push({
            position: new Vector3(
              bindPoseArray[i * 10 + 0],
              bindPoseArray[i * 10 + 1],
              bindPoseArray[i * 10 + 2]
            ),
            rotation: new Quaternion(
              bindPoseArray[i * 10 + 3],
              bindPoseArray[i * 10 + 4],
              bindPoseArray[i * 10 + 5],
              bindPoseArray[i * 10 + 6]
            ),
            scale: new Vector3(
              bindPoseArray[i * 10 + 7],
              bindPoseArray[i * 10 + 8],
              bindPoseArray[i * 10 + 9]
            )
          });
        }
      }
      let rig =
        (ctx.animationSet.rigs
          .map((ref) => ref.get())
          .find(
            (item) =>
              !!item &&
              SkeletonRig.getRigKey(item.joints, item.rootJoint) === SkeletonRig.getRigKey(joints, rootJoint)
          ) as SkeletonRig | undefined) ?? null;
      if (!rig) {
        rig = new SkeletonRig(joints, bindPose, {
          rootJoint,
          rootBindPose
        });
        ctx.animationSet.rigs.push(new DRef(rig));
      }
      const skeleton = new SkinBinding(rig, inverseBindMatrices, joints);
      skeleton.persistentId = init.id;
      return {
        obj: skeleton,
        loadProps: false
      };
    },
    getInitParams(obj: Skeleton) {
      const inverseBindMatrices: number[] = obj.inverseBindMatrices
        .map((v) => [...v])
        .reduce((a, b) => [...a, ...b], []);
      const bindPose: number[] = obj.bindPose
        .map((v) => [...v.position, ...v.rotation, ...v.scale])
        .reduce((a, b) => [...a, ...b], []);
      return {
        joints: obj.joints.map((joint) => joint.persistentId),
        rootJoint: obj.rig.rootJoint?.persistentId ?? '',
        rootBindPose: encodeSkeletonBindPose(obj.rig.rootBindPose),
        inverseBindMatrices: uint8ArrayToBase64(new Uint8Array(new Float32Array(inverseBindMatrices).buffer)),
        bindPose: uint8ArrayToBase64(new Uint8Array(new Float32Array(bindPose).buffer)),
        id: obj.persistentId
      };
    },
    getProps() {
      return [];
    }
  };
}

/** @internal */
export function getSkeletonRigClass(): SerializableClass {
  return {
    ctor: SkeletonRig,
    name: 'SkeletonRig',
    createFunc(
      ctx: SceneNode,
      init: {
        joints: string[];
        rootJoint?: string;
        rootBindPose?: string;
        bindPoseMatrices: string;
        bindPose: string;
        id: string;
      }
    ) {
      const prefabNode = ctx.getPrefabNode() ?? ctx;
      const joints = init.joints
        .map((id) => prefabNode.findNodeById(id)!)
        .map((node) => {
          node!.jointTypeT = 'static';
          node!.jointTypeS = 'static';
          node!.jointTypeR = 'static';
          return node;
        });
      const rootJoint = init.rootJoint ? prefabNode.findNodeById(init.rootJoint) : null;
      const rootBindPose = init.rootBindPose ? decodeSkeletonBindPose(init.rootBindPose) : undefined;
      const bindPoseArray = new Float32Array(
        base64ToUint8Array(init.bindPose ?? init.bindPoseMatrices).buffer
      );
      const bindPose: { rotation: Quaternion; scale: Vector3; position: Vector3 }[] = [];
      for (let i = 0; i < joints.length; i++) {
        if (!init.bindPose) {
          const matrix = new Matrix4x4(bindPoseArray.slice(i * 16, i * 16 + 16));
          const trs = {
            position: new Vector3(),
            rotation: new Quaternion(),
            scale: new Vector3()
          };
          matrix.decompose(trs.scale, trs.rotation, trs.position);
          bindPose.push(trs);
        } else {
          bindPose.push({
            position: new Vector3(
              bindPoseArray[i * 10 + 0],
              bindPoseArray[i * 10 + 1],
              bindPoseArray[i * 10 + 2]
            ),
            rotation: new Quaternion(
              bindPoseArray[i * 10 + 3],
              bindPoseArray[i * 10 + 4],
              bindPoseArray[i * 10 + 5],
              bindPoseArray[i * 10 + 6]
            ),
            scale: new Vector3(
              bindPoseArray[i * 10 + 7],
              bindPoseArray[i * 10 + 8],
              bindPoseArray[i * 10 + 9]
            )
          });
        }
      }
      const rig = new SkeletonRig(joints, bindPose, {
        rootJoint,
        rootBindPose
      });
      rig.persistentId = init.id;
      return {
        obj: rig,
        loadProps: false
      };
    },
    getInitParams(obj: SkeletonRig) {
      const bindPose: number[] = obj.bindPose
        .map((v) => [...v.position, ...v.rotation, ...v.scale])
        .reduce((a, b) => [...a, ...b], []);
      return {
        joints: obj.joints.map((joint) => joint.persistentId),
        rootJoint: obj.rootJoint?.persistentId ?? '',
        rootBindPose: encodeSkeletonBindPose(obj.rootBindPose),
        bindPose: uint8ArrayToBase64(new Uint8Array(new Float32Array(bindPose).buffer)),
        id: obj.persistentId
      };
    },
    getProps() {
      return [];
    }
  };
}

/** @internal */
export function getSkinBindingClass(): SerializableClass {
  return {
    ctor: SkinBinding,
    name: 'SkinBinding',
    createFunc(
      ctx: SceneNode,
      init: {
        rig: string;
        joints?: string[];
        inverseBindMatrices: string;
        id: string;
      }
    ) {
      const rig = ctx.findSkeletonRigById(init.rig);
      if (!rig) {
        throw new Error(`Deserialize SkinBinding failed: skeleton rig '${init.rig}' not found`);
      }
      const prefabNode = ctx.getPrefabNode() ?? ctx;
      const joints = (init.joints ?? rig.joints.map((joint) => joint.persistentId))
        .map((id) => prefabNode.findNodeById(id)!)
        .filter((node): node is SceneNode => !!node);
      const inverseBindMatricesArray = new Float32Array(base64ToUint8Array(init.inverseBindMatrices).buffer);
      const inverseBindMatrices: Matrix4x4[] = [];
      for (let i = 0; i < joints.length; i++) {
        inverseBindMatrices.push(new Matrix4x4(inverseBindMatricesArray.slice(i * 16, i * 16 + 16)));
      }
      const binding = new SkinBinding(rig, inverseBindMatrices, joints);
      binding.persistentId = init.id;
      return {
        obj: binding,
        loadProps: false
      };
    },
    getInitParams(obj: SkinBinding) {
      const inverseBindMatrices: number[] = obj.inverseBindMatrices
        .map((v) => [...v])
        .reduce((a, b) => [...a, ...b], []);
      return {
        rig: obj.rig.persistentId,
        joints: obj.joints.map((joint) => joint.persistentId),
        inverseBindMatrices: uint8ArrayToBase64(new Uint8Array(new Float32Array(inverseBindMatrices).buffer)),
        id: obj.persistentId
      };
    },
    getProps() {
      return [];
    }
  };
}

/** @internal */
export function getAnimationClass(manager: ResourceManager): SerializableClass {
  return {
    ctor: AnimationClip,
    name: 'AnimationClip',
    createFunc(ctx: SceneNode, init: string) {
      return { obj: ctx.animationSet.get(init) ?? ctx.animationSet.createAnimation(init, false) };
    },
    getInitParams(obj: AnimationClip) {
      return obj.name;
    },
    getProps() {
      return defineProps([
        {
          name: 'Name',
          description: 'The animation name, unique in `AnimationSet`',
          type: 'string',
          get(this: AnimationClip, value) {
            value.str[0] = this.name;
          }
        },
        {
          name: 'Duration',
          description: 'Time duration of the animation in seconds',
          type: 'float',
          default: 1,
          get(this: AnimationClip, value) {
            value.num[0] = this.timeDuration;
          },
          set(this: AnimationClip, value) {
            this.timeDuration = value.num[0];
          }
        },
        {
          name: 'Weight',
          description: 'Weight of this animation, used in animation blending',
          type: 'float',
          default: 1,
          get(this: AnimationClip, value) {
            value.num[0] = this.weight;
          },
          set(this: AnimationClip, value) {
            this.weight = value.num[0];
          }
        },
        {
          name: 'AutoPlay',
          description: 'Whether this animation should automatically start playing when model is loaded',
          type: 'bool',
          default: false,
          get(this: AnimationClip, value) {
            value.bool[0] = this.autoPlay;
          },
          set(this: AnimationClip, value) {
            this.autoPlay = value.bool[0];
          }
        },
        {
          name: 'Rigs',
          description: 'Rig references used by this animation clip',
          type: 'object',
          isHidden() {
            return true;
          },
          get(this: AnimationClip, value) {
            value.object[0] = [...this.skeletons];
          },
          set(this: AnimationClip, value) {
            if (!this.skeletons) {
              this.skeletons = new Set();
            }
            for (const val of (value.object[0] as string[]) ?? []) {
              this.skeletons.add(val);
            }
          }
        },
        {
          name: 'Skeletons',
          description: 'Legacy skeleton references used by this animation clip',
          type: 'object',
          isHidden() {
            return true;
          },
          get(this: AnimationClip, value) {
            value.object[0] = [];
          },
          set(this: AnimationClip, value) {
            if (!this.skeletons) {
              this.skeletons = new Set();
            }
            for (const val of (value.object[0] as string[]) ?? []) {
              this.skeletons.add(val);
            }
          }
        },
        {
          name: 'Tracks',
          description: 'Animation tracks of this animation clip',
          type: 'object_array',
          options: {
            edit: 'proptrack',
            objectTypes: [PropertyTrack]
          },
          readonly: true,
          isHidden(this: AnimationClip, index: number, obj: unknown) {
            if (index < 0) {
              return false;
            } else {
              return !(obj instanceof PropertyTrack);
            }
          },
          get(this: AnimationClip, value) {
            value.object = [];
            for (const tracks of this.tracks) {
              for (const track of tracks[1]) {
                if (tracks[0] instanceof SceneNode && !(track instanceof PropertyTrack)) {
                  track.target = tracks[0].persistentId;
                }
              }
              //value.object.push(...tracks[1].filter((track) => track instanceof PropertyTrack));
              value.object.push(...tracks[1]);
            }
          },
          set(this: AnimationClip, value) {
            for (const track of value.object) {
              if (track instanceof PropertyTrack) {
                const targetObj = manager.findAnimationTarget(this._animationSet.model, track);
                if (targetObj) {
                  this.addTrack(targetObj, track);
                }
              } else if (track instanceof AnimationTrack) {
                const prefabNode = this._animationSet.model.getPrefabNode() ?? this._animationSet.model;
                const node = prefabNode.findNodeById(track.target);
                if (node) {
                  this.addTrack(node, track);
                } else {
                  console.error(`No node found with id = ${track.target}`);
                }
              }
            }
          },
          delete(this: AnimationClip, index) {
            const trackList: AnimationTrack[] = [];
            for (const tracks of this.tracks) {
              trackList.push(...tracks[1].filter((track) => track instanceof PropertyTrack));
            }
            const trackToRemove = trackList[index];
            if (trackToRemove) {
              this.deleteTrack(trackToRemove);
            }
          }
        }
      ]);
    }
  };
}
