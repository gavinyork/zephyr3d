export const springRuntimeScriptSource = `import { Vector3 } from '@zephyr3d/base';
import {
  RuntimeScript,
  scriptProp,
  createSphereCollider,
  createCapsuleCollider,
  createPlaneCollider,
  SpringModifier,
  SpringSystem,
  SpringChain
} from '@zephyr3d/scene';

// 这里保留对旧格式 capsule / plane 数据的兼容解析，
// 这样编辑器里的新结构化配置和历史 metaData 都能被运行时脚本识别。
function parseCapsuleDistance(value, fallback, scale = 1) {
  const minValue = 0.0001 * scale;
  let distance = Math.abs(Number(fallback) || 0);
  if (typeof value === 'number' && Number.isFinite(value)) {
    distance = Math.abs(value);
  } else if (Array.isArray(value) && value.length >= 3) {
    const x = Number(value[0]) || 0;
    const y = Number(value[1]) || 0;
    const z = Number(value[2]) || 0;
    const legacyDistance = Math.abs(x) > 1e-6 ? Math.abs(x) : Math.hypot(x, y, z);
    distance = legacyDistance || distance;
  }
  return Math.max(minValue, distance * scale);
}

function parsePlaneNormalY(value, fallback = 1) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 0 ? -1 : 1;
  }
  if (Array.isArray(value) && value.length >= 3) {
    return (Number(value[1]) || 0) < 0 ? -1 : 1;
  }
  return fallback < 0 ? -1 : 1;
}

function resolveHostScope(host) {
  return (
    host?.scene?.rootNode ||
    (typeof host?.getPrefabNode === 'function' && host.getPrefabNode()) ||
    host
  );
}

function getSceneColliderMeta(node) {
  const meta = node?.metaData;
  const collider = meta?.sceneCollider;
  if (collider && typeof collider === 'object') {
    return { config: collider, legacy: false };
  }
  const legacyCollider = meta?.springCollider;
  if (legacyCollider && typeof legacyCollider === 'object') {
    return { config: legacyCollider, legacy: true };
  }
  return null;
}

// 除了脚本里显式声明的 colliders，还允许从场景节点 metaData 中收集共享碰撞体。
// 这样 spring 可以与场景里已有的碰撞体 authoring 结果协同工作。
function collectSceneNodeColliders(host, includePlane = true) {
  const colliders = [];
  resolveHostScope(host)?.iterate?.((node) => {
    const entry = getSceneColliderMeta(node);
    const colliderConfig = entry?.config;
    if (
      !colliderConfig ||
      (colliderConfig.type !== 'sphere' &&
        colliderConfig.type !== 'capsule' &&
        colliderConfig.type !== 'plane')
    ) {
      return false;
    }
    if (colliderConfig.type === 'plane' && !includePlane) {
      return false;
    }
    const unitScale = entry?.legacy ? 0.1 : 1;
    let collider = null;
    if (colliderConfig.type === 'sphere') {
      collider = createSphereCollider(
        Vector3.zero(),
        Math.max(0, (Number(colliderConfig.radius) || 0.15) * unitScale),
        node
      );
      collider.localRadiusScaleRef = 1;
    } else if (colliderConfig.type === 'capsule') {
      collider = createCapsuleCollider(
        new Vector3(parseCapsuleDistance(colliderConfig.offset, 0.1, unitScale), 0, 0),
        new Vector3(-parseCapsuleDistance(colliderConfig.endOffset, 0.1, unitScale), 0, 0),
        Math.max(0, (Number(colliderConfig.radius) || 0.1) * unitScale),
        node
      );
      collider.localRadiusScaleRef = 1;
    } else if (colliderConfig.type === 'plane') {
      collider = createPlaneCollider(
        Vector3.zero(),
        new Vector3(0, parsePlaneNormalY(colliderConfig.normal), 0),
        node
      );
    }
    if (collider) {
      collider.enabled = colliderConfig.enabled !== false;
      colliders.push(collider);
    }
    return false;
  });
  return colliders;
}

// 这部分碰撞体来自脚本配置本身，是每个 spring 宿主私有的附加碰撞体。
function buildConfigColliders(root, config) {
  const colliders = [];
  for (const colliderConfig of config?.colliders ?? []) {
    const attachNode = root.findNodeByName(String(colliderConfig?.bone ?? '')) ?? root;
    let collider = null;
    if (colliderConfig?.type === 'sphere') {
      collider = createSphereCollider(
        new Vector3(
          Number(colliderConfig.offsetX) || 0,
          Number(colliderConfig.offsetY) || 0,
          Number(colliderConfig.offsetZ) || 0
        ),
        Math.max(0, Number(colliderConfig.radius) || 0.15),
        attachNode
      );
    } else if (colliderConfig?.type === 'capsule') {
      collider = createCapsuleCollider(
        new Vector3(
          Number(colliderConfig.offsetX) || 0,
          Number(colliderConfig.offsetY) || 0,
          Number(colliderConfig.offsetZ) || 0
        ),
        new Vector3(
          Number(colliderConfig.endOffsetX) || 0,
          Number(colliderConfig.endOffsetY) || 0.2,
          Number(colliderConfig.endOffsetZ) || 0
        ),
        Math.max(0, Number(colliderConfig.radius) || 0.1),
        attachNode
      );
    } else if (colliderConfig?.type === 'plane') {
      collider = createPlaneCollider(
        new Vector3(
          Number(colliderConfig.offsetX) || 0,
          Number(colliderConfig.offsetY) || 0,
          Number(colliderConfig.offsetZ) || 0
        ),
        new Vector3(
          Number(colliderConfig.normalX) || 0,
          Number(colliderConfig.normalY) || 1,
          Number(colliderConfig.normalZ) || 0
        ),
        attachNode
      );
    }
    if (collider) {
      collider.enabled = colliderConfig?.enabled !== false;
      colliders.push(collider);
    }
  }
  return colliders;
}

// 只要任何会影响 spring 重建结果的配置发生变化，就会生成新的签名。
// 这样可以避免每帧重建，同时保证配置变动后能立即生效。
function buildSignature(config) {
  const gravity = Array.isArray(config?.gravity) ? config.gravity : [0, -9.8, 0];
  return JSON.stringify({
    enabled: config?.enabled !== false,
    chainDamping: Number(config?.chainDamping),
    chainStiffness: Number(config?.chainStiffness),
    gravityX: Number(gravity[0]),
    gravityY: Number(gravity[1]),
    gravityZ: Number(gravity[2]),
    iterations: Number(config?.iterations),
    enableInertialForces: config?.enableInertialForces !== false,
    centrifugalScale: Number(config?.centrifugalScale),
    coriolisScale: Number(config?.coriolisScale),
    solver: String(config?.solver ?? 'xpbd'),
    poseFollow: Number(config?.poseFollow),
    poseFollowRoot: Number(config?.poseFollowRoot),
    poseFollowTip: Number(config?.poseFollowTip),
    poseFollowExponent: Number(config?.poseFollowExponent),
    maxPoseOffset: Number(config?.maxPoseOffset),
    maxPoseOffsetRoot: Number(config?.maxPoseOffsetRoot),
    maxPoseOffsetTip: Number(config?.maxPoseOffsetTip),
    modifierWeight: Number(config?.modifierWeight),
    chains: config?.chains ?? [],
    colliders: config?.colliders ?? []
  });
}

export default class extends RuntimeScript {
  // 隐藏标记只用于编辑器识别这是 spring 插件脚本宿主。
  @scriptProp({ type: 'string', default: 'springtest', hidden: true })
  __editorPluginType = 'springtest';

  @scriptProp({ type: 'bool', label: 'Enabled', group: 'General', default: true })
  enabled = true;

  @scriptProp({ type: 'float', label: 'Modifier Weight', group: 'General', default: 1, minValue: 0, maxValue: 1 })
  modifierWeight = 1;

  @scriptProp({ type: 'float', label: 'Damping', group: 'Chain', default: 0.9, minValue: 0, maxValue: 1 })
  chainDamping = 0.9;

  @scriptProp({ type: 'float', label: 'Stiffness', group: 'Chain', default: 0.82, minValue: 0, maxValue: 1 })
  chainStiffness = 0.82;

  @scriptProp({ type: 'vec3', label: 'Gravity', group: 'Simulation', default: [0, -9.8, 0] })
  gravity = [0, -9.8, 0];

  @scriptProp({ type: 'int', label: 'Iterations', group: 'Simulation', default: 6, minValue: 1, maxValue: 32 })
  iterations = 6;

  @scriptProp({ type: 'bool', label: 'Enable Inertial Forces', group: 'Simulation', default: true })
  enableInertialForces = true;

  @scriptProp({ type: 'float', label: 'Centrifugal Scale', group: 'Simulation', default: 2, minValue: 0 })
  centrifugalScale = 2;

  @scriptProp({ type: 'float', label: 'Coriolis Scale', group: 'Simulation', default: 1, minValue: 0 })
  coriolisScale = 1;

  @scriptProp({
    type: 'string',
    label: 'Solver',
    group: 'Simulation',
    default: 'xpbd',
    enum: {
      labels: ['XPBD', 'Verlet'],
      values: ['xpbd', 'verlet']
    }
  })
  solver = 'xpbd';

  @scriptProp({ type: 'float', label: 'Pose Follow', group: 'PoseFollow', default: 0.3, minValue: 0, maxValue: 1 })
  poseFollow = 0.3;

  @scriptProp({
    type: 'float',
    label: 'Pose Follow Root',
    group: 'PoseFollow',
    default: 0.15,
    minValue: 0,
    maxValue: 1
  })
  poseFollowRoot = 0.15;

  @scriptProp({
    type: 'float',
    label: 'Pose Follow Tip',
    group: 'PoseFollow',
    default: 0.05,
    minValue: 0,
    maxValue: 1
  })
  poseFollowTip = 0.05;

  @scriptProp({
    type: 'float',
    label: 'Pose Follow Exponent',
    group: 'PoseFollow',
    default: 1.6,
    minValue: 0.1
  })
  poseFollowExponent = 1.6;

  @scriptProp({ type: 'float', label: 'Max Pose Offset', group: 'PoseFollow', default: 0.3, minValue: 0 })
  maxPoseOffset = 0.3;

  @scriptProp({
    type: 'float',
    label: 'Max Pose Offset Root',
    group: 'PoseFollow',
    default: 0.2,
    minValue: 0
  })
  maxPoseOffsetRoot = 0.2;

  @scriptProp({
    type: 'float',
    label: 'Max Pose Offset Tip',
    group: 'PoseFollow',
    default: 0.4,
    minValue: 0
  })
  maxPoseOffsetTip = 0.4;

  @scriptProp({
    type: 'object_array',
    label: 'Bone Chains',
    group: 'Chain',
    element: {
      type: 'object',
      fields: [
        { name: 'startBone', type: 'string', label: 'Start', default: '' },
        { name: 'endBone', type: 'string', label: 'End', default: '' }
      ]
    },
    default: [
      { startBone: 'joint2', endBone: 'joint11' },
      { startBone: 'joint13', endBone: 'joint22' },
      { startBone: 'joint24', endBone: 'joint34' },
      { startBone: 'joint36', endBone: 'joint44' },
      { startBone: 'joint58', endBone: 'joint67' },
      { startBone: 'joint69', endBone: 'joint76' },
      { startBone: 'joint78', endBone: 'joint88' },
      { startBone: 'joint101', endBone: 'joint109' },
      { startBone: 'joint111', endBone: 'joint119' },
      { startBone: 'joint121', endBone: 'joint130' },
      { startBone: 'joint132', endBone: 'joint138' }
    ]
  })
  chains = [];

  @scriptProp({
    type: 'object_array',
    label: 'Colliders',
    group: 'Collider',
    element: {
      type: 'object',
      fields: [
        {
          name: 'type',
          type: 'string',
          label: 'Type',
          default: 'sphere',
          enum: {
            labels: ['Sphere', 'Capsule', 'Plane'],
            values: ['sphere', 'capsule', 'plane']
          }
        },
        { name: 'enabled', type: 'bool', label: 'Enabled', default: true },
        { name: 'bone', type: 'string', label: 'Bone', default: '' },
        { name: 'offsetX', type: 'float', label: 'Offset X', default: 0 },
        { name: 'offsetY', type: 'float', label: 'Offset Y', default: 0 },
        { name: 'offsetZ', type: 'float', label: 'Offset Z', default: 0 },
        { name: 'endOffsetX', type: 'float', label: 'End Offset X', default: 0 },
        { name: 'endOffsetY', type: 'float', label: 'End Offset Y', default: 0.2 },
        { name: 'endOffsetZ', type: 'float', label: 'End Offset Z', default: 0 },
        { name: 'radius', type: 'float', label: 'Radius', default: 0.15, minValue: 0 },
        { name: 'normalX', type: 'float', label: 'Normal X', default: 0 },
        { name: 'normalY', type: 'float', label: 'Normal Y', default: 1 },
        { name: 'normalZ', type: 'float', label: 'Normal Z', default: 0 }
      ]
    },
    default: []
  })
  colliders = [];

  onAttached(host) {
    this._host = host;
    this._skeleton = null;
    this._modifiers = [];
    this._configColliders = [];
    this._signature = '';
    this._initDelayFrames = 1;
    this._initRetryFrames = 120;
  }

  // spring 的运行策略是：
  // 1. 先检查骨骼和链条是否有效
  // 2. 再用签名判断是否需要重建 modifier
  onUpdate() {
    const root = this._host;
    const config = root?.scriptConfig;
    if (!root || !config || !config.enabled) {
      this.disposeSpringState();
      return;
    }
    if (this._initDelayFrames > 0) {
      this._initDelayFrames -= 1;
      return;
    }
    const skeletonRef = root.animationSet?.skeletons?.[0];
    const skeleton = typeof skeletonRef?.get === 'function' ? skeletonRef.get() : skeletonRef;
    if (!skeleton) {
      if (this._initRetryFrames > 0) {
        this._initRetryFrames -= 1;
      }
      this.disposeSpringState();
      return;
    }
    let hasValidChainPose = false;
    for (const chainConfig of config.chains ?? []) {
      const chainStart = root.findNodeByName(chainConfig.startBone);
      const chainEnd = root.findNodeByName(chainConfig.endBone);
      if (!chainStart || !chainEnd) {
        continue;
      }
      const startPos = chainStart.getWorldPosition();
      const endPos = chainEnd.getWorldPosition();
      if (Vector3.distance(startPos, endPos) > 1e-4) {
        hasValidChainPose = true;
        break;
      }
    }
    if (!hasValidChainPose) {
      if (this._initRetryFrames > 0) {
        this._initRetryFrames -= 1;
      }
      this.disposeSpringState();
      return;
    }
    this._initRetryFrames = 120;
    const signature = buildSignature(config);
    if (this._skeleton === skeleton && this._signature === signature && this._modifiers.length > 0) {
      return;
    }
    // 一旦链条、碰撞体或主要模拟参数变化，就整套重建 spring modifier。
    this.disposeSpringState();
    const sharedColliders = collectSceneNodeColliders(root, true);
    const configColliders = buildConfigColliders(root, config);
    const modifiers = [];
    for (const chainConfig of config.chains ?? []) {
      const chainStart = root.findNodeByName(chainConfig.startBone);
      const chainEnd = root.findNodeByName(chainConfig.endBone);
      if (!chainStart || !chainEnd) {
        continue;
      }
      const chain = SpringChain.fromBoneChain(chainStart, chainEnd, {
        damping: Number(config.chainDamping ?? 0.9),
        stiffness: Number(config.chainStiffness ?? 0.82)
      });
      const springSystem = new SpringSystem(chain, {
        gravity: new Vector3(
          Number((Array.isArray(config.gravity) ? config.gravity[0] : 0) ?? 0),
          Number((Array.isArray(config.gravity) ? config.gravity[1] : -9.8) ?? -9.8),
          Number((Array.isArray(config.gravity) ? config.gravity[2] : 0) ?? 0)
        ),
        iterations: Math.max(1, Number(config.iterations) || 6),
        enableInertialForces: config.enableInertialForces !== false,
        centrifugalScale: Math.max(0, Number(config.centrifugalScale) || 2),
        coriolisScale: Math.max(0, Number(config.coriolisScale) || 1),
        solver: String(config.solver ?? 'xpbd'),
        poseFollow: Number(config.poseFollow ?? 0.3),
        poseFollowRoot: Number(config.poseFollowRoot ?? 0.15),
        poseFollowTip: Number(config.poseFollowTip ?? 0.05),
        poseFollowExponent: Math.max(0.1, Number(config.poseFollowExponent) || 1.6),
        maxPoseOffset: Math.max(0, Number(config.maxPoseOffset) || 0.3),
        maxPoseOffsetRoot: Math.max(0, Number(config.maxPoseOffsetRoot) || 0.2),
        maxPoseOffsetTip: Math.max(0, Number(config.maxPoseOffsetTip) || 0.4)
      });
      for (const collider of sharedColliders) {
        springSystem.addCollider(collider);
      }
      for (const collider of configColliders) {
        springSystem.addCollider(collider);
      }
      const modifier = new SpringModifier(springSystem, Math.max(0, Number(config.modifierWeight) || 1));
      skeleton.modifiers.push(modifier);
      modifiers.push(modifier);
    }
    this._skeleton = skeleton;
    this._configColliders = configColliders;
    this._modifiers = modifiers;
    this._signature = signature;
  }

  onDetached(host) {
    if (host === this._host) {
      this.disposeSpringState();
      this._host = null;
      this._initDelayFrames = 0;
      this._initRetryFrames = 0;
    }
  }

  onDestroy() {
    this.disposeSpringState();
    this._host = null;
    this._initDelayFrames = 0;
    this._initRetryFrames = 0;
  }

  disposeSpringState() {
    if (this._skeleton && this._modifiers.length > 0) {
      this._skeleton.modifiers = this._skeleton.modifiers.filter(
        (modifier) => !this._modifiers.includes(modifier)
      );
    }
    for (const modifier of this._modifiers) {
      if (typeof modifier.dispose === 'function') {
        modifier.dispose();
      }
    }
    this._modifiers = [];
    this._configColliders = [];
    this._skeleton = null;
    this._signature = '';
  }
}
`;
