export const gpuClothRuntimeScriptSource = `import { Vector3 } from '@zephyr3d/base';
import {
  RuntimeScript,
  scriptProp,
  GPUClothSystem,
  createSphereCollider,
  createCapsuleCollider,
  createPlaneCollider
} from '@zephyr3d/scene';

function clamp01(value) {
  return Math.min(Math.max(Number.isFinite(value) ? value : 0, 0), 1);
}

// 编辑器把“按目标网格分桶”的权重数据存成 JSON 字符串，
// 运行时脚本负责把它解析回可供 GPU cloth 使用的数据结构。
function parseTargetEncodedMap(source) {
  const text = String(source ?? '').trim();
  if (!text) {
    return {};
  }
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    const result = {};
    for (const [key, value] of Object.entries(parsed)) {
      result[key] = typeof value === 'string' ? value : String(value ?? '');
    }
    return result;
  } catch {
    return {};
  }
}

function readNumber(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function resolveHostScope(host) {
  return (
    (typeof host?.getPrefabNode === 'function' && host.getPrefabNode()) ||
    host?.scene?.rootNode ||
    host
  );
}

function resolveMeshById(host, meshId) {
  const id = String(meshId ?? '').trim();
  if (!host || !id) {
    return null;
  }
  const candidate = resolveHostScope(host)?.findNodeById?.(id);
  return candidate?.isMesh?.() && candidate.primitive ? candidate : null;
}

function resolveSimulationMesh(host, config) {
  const simulationMeshId = String(config?.simulationMeshId ?? '').trim();
  if (simulationMeshId) {
    return resolveMeshById(host, simulationMeshId);
  }
  return host?.isMesh?.() && host.primitive ? host : null;
}

// 新格式存储的是 cloth weight，运行时需要转换成 GPUClothSystem 使用的 pinned weight。
// 为兼容旧数据，这里仍保留对 legacy pinnedVertexIndicesByTarget 的读取。
function parsePinnedVertexMap(config) {
  return parseTargetEncodedMap(config?.vertexPinWeightsByTarget);
}

function parseTargetMeshBindingDataByTarget(config) {
  return parseTargetEncodedMap(config?.targetMeshBindingDataByTarget);
}

function parseTargetMeshBindingSignatureByTarget(config) {
  return parseTargetEncodedMap(config?.targetMeshBindingSignatureByTarget);
}

function getPinnedVertexSource(config, target) {
  const targetId = String(target?.persistentId ?? '');
  if (!targetId) {
    return '';
  }
  const byTarget = parsePinnedVertexMap(config);
  return Object.prototype.hasOwnProperty.call(byTarget, targetId) ? byTarget[targetId] ?? '' : '';
}

function getLegacyPinnedVertexSource(config, target) {
  const targetId = String(target?.persistentId ?? '');
  if (!targetId) {
    return '';
  }
  const byTarget = parseTargetEncodedMap(config?.pinnedVertexIndicesByTarget);
  return Object.prototype.hasOwnProperty.call(byTarget, targetId) ? byTarget[targetId] ?? '' : '';
}

function parsePinnedVertexWeights(config, target) {
  const vertexCount = Math.max(0, Number(target?.primitive?.getNumVertices?.()) || 0);
  if (vertexCount <= 0) {
    return undefined;
  }
  const source = getPinnedVertexSource(config, target);
  if (source.trim()) {
    const weights = new Float32Array(vertexCount);
    for (const token of source.split(',')) {
      const entry = token.trim();
      if (!entry) {
        continue;
      }
      const separator = entry.indexOf(':');
      if (separator < 0) {
        continue;
      }
      const index = Number(entry.slice(0, separator).trim()) | 0;
      const clothWeight = clamp01(Number(entry.slice(separator + 1).trim()));
      if (Number.isFinite(index) && index >= 0 && index < vertexCount) {
        weights[index] = 1 - clothWeight;
      }
    }
    return weights;
  }
  const legacySource = getLegacyPinnedVertexSource(config, target);
  if (!legacySource.trim()) {
    return undefined;
  }
  const weights = new Float32Array(vertexCount);
  for (const token of legacySource.split(/[^0-9]+/g)) {
    if (!token) {
      continue;
    }
    const index = Number(token) | 0;
    if (Number.isFinite(index) && index >= 0 && index < vertexCount) {
      weights[index] = 1;
    }
  }
  return weights;
}

function normalizePlaneDirection(value) {
  return Number(value) < 0 ? -1 : 1;
}

function getSceneColliderMetaEntry(node) {
  const meta = node?.metaData;
  const collider = meta?.sceneCollider;
  if (
    collider &&
    typeof collider === 'object' &&
    (collider.type === 'sphere' || collider.type === 'capsule' || collider.type === 'plane')
  ) {
    return { config: collider, legacy: false };
  }
  const legacyCollider = meta?.springCollider;
  if (
    legacyCollider &&
    typeof legacyCollider === 'object' &&
    (legacyCollider.type === 'sphere' || legacyCollider.type === 'capsule' || legacyCollider.type === 'plane')
  ) {
    return { config: legacyCollider, legacy: true };
  }
  return null;
}

function parseSceneColliderDistance(value, fallback, scale = 1) {
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

function collectSceneNodeColliders(host, includePlane = true) {
  const colliders = [];
  const scope = resolveHostScope(host);
  scope?.iterate?.((node) => {
    const entry = getSceneColliderMetaEntry(node);
    const colliderConfig = entry?.config;
    if (!colliderConfig) {
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
        new Vector3(parseSceneColliderDistance(colliderConfig.offset, 0.1, unitScale), 0, 0),
        new Vector3(-parseSceneColliderDistance(colliderConfig.endOffset, 0.1, unitScale), 0, 0),
        Math.max(0, (Number(colliderConfig.radius) || 0.1) * unitScale),
        node
      );
      collider.localRadiusScaleRef = 1;
    } else if (colliderConfig.type === 'plane') {
      collider = createPlaneCollider(
        Vector3.zero(),
        new Vector3(0, normalizePlaneDirection(colliderConfig.normal), 0),
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

function buildConfigColliders(host, config) {
  const colliders = [];
  for (const colliderConfig of config?.colliders ?? []) {
    const attachNode = host?.findNodeByName?.(String(colliderConfig?.bone ?? '')) ?? host;
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
        Math.max(0, Number(colliderConfig.radius) || 0.15),
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
          normalizePlaneDirection(colliderConfig.normalY),
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

function buildClothColliders(host, config) {
  return [...collectSceneNodeColliders(host, true), ...buildConfigColliders(host, config)];
}

// targetMeshIds 只保存可编辑的目标 mesh 列表；
// 绑定缓存则单独存放在按 target id 分桶的字符串映射中。
function resolveWrapTargets(host, simulationMesh, config) {
  const result = [];
  const targetMeshIds = Array.isArray(config?.targetMeshIds) ? config.targetMeshIds : [];
  const bindingDataByTarget = parseTargetMeshBindingDataByTarget(config);
  for (const targetMeshId of targetMeshIds) {
    const meshId = String(targetMeshId ?? '').trim();
    const bindingDataText = meshId ? String(bindingDataByTarget[meshId] ?? '').trim() : '';
    if (!meshId || !bindingDataText) {
      continue;
    }
    const target = resolveMeshById(host, meshId);
    if (!target || target === simulationMesh || !target.primitive) {
      continue;
    }
    try {
      const data = JSON.parse(bindingDataText);
      if (data && typeof data === 'object') {
        result.push({ target, data });
      }
    } catch (err) {
      console.warn('Ignore invalid GPU cloth binding cache for target:', meshId, err);
    }
  }
  return result;
}

// 结构签名用于判断“是否需要整套重建 GPU cloth 对象”。
// 只要网格拓扑、包裹目标、绑定缓存或影响结构的数据变了，就必须重新 createFromMesh。
function buildStructureSignature(simulationMesh, config, wrapTargets) {
  const primitive = simulationMesh?.primitive;
  const bindingSignatureByTarget = parseTargetMeshBindingSignatureByTarget(config);
  return JSON.stringify({
    meshId: String(simulationMesh?.persistentId ?? ''),
    primitiveId: Number(primitive?.id) || 0,
    weights: getPinnedVertexSource(config, simulationMesh) || getLegacyPinnedVertexSource(config, simulationMesh),
    maxNeighbors: Math.max(1, Number(config?.maxNeighbors) || 8),
    maxTrianglesPerVertex: Math.max(1, Number(config?.maxTrianglesPerVertex) || 16),
    workgroupSize: Math.max(1, Number(config?.workgroupSize) || 64),
    rebuildNormals: config?.rebuildNormals !== false,
    wrapTargets: wrapTargets.map((entry) => {
      const targetId = String(entry.target?.persistentId ?? '');
      return {
        id: targetId,
        primitiveId: Number(entry.target?.primitive?.id) || 0,
        bindingSignature:
          bindingSignatureByTarget[targetId] ??
          (String(entry.data?.version ?? '') +
            ':' +
            String(entry.data?.vertexCount ?? '') +
            ':' +
            String(entry.data?.sourceVertexCount ?? '') +
            ':' +
            String(entry.data?.influenceCount ?? ''))
      };
    })
  });
}

// 运行时签名用于判断“是否只需要更新现有 cloth 实例的参数”。
// 这类参数变化不涉及拓扑重建，因此可以直接 apply 到现有实例。
function buildRuntimeSignature(host, simulationMesh, config) {
  const gravity = Array.isArray(config?.gravity) ? config.gravity : [0, -9.8, 0];
  return JSON.stringify({
    sceneId: String(simulationMesh?.scene?.name ?? host?.scene?.name ?? ''),
    enabled: config?.enabled !== false,
    autoUpdate: config?.autoUpdate !== false,
    damping: readNumber(config?.damping, 0.02),
    dynamicFriction: readNumber(config?.dynamicFriction, 0.15),
    staticFriction: readNumber(config?.staticFriction, 0.3),
    stiffness: readNumber(config?.stiffness, 0.3),
    poseFollow: readNumber(config?.poseFollow, 0),
    substeps: Math.max(1, Math.min(8, Number(config?.substeps) || 2)),
    solverIterations: Math.max(1, Number(config?.solverIterations) || 5),
    gravityX: readNumber(gravity[0], 0),
    gravityY: readNumber(gravity[1], -9.8),
    gravityZ: readNumber(gravity[2], 0),
    colliders: JSON.stringify(config?.colliders ?? []),
    sceneColliders: JSON.stringify(
      collectSceneNodeColliders(host, true).map((collider) => String(collider?.type ?? ''))
    )
  });
}

export default class extends RuntimeScript {
  // 这是供编辑器识别插件宿主用的隐藏标记，不属于用户需要直接编辑的配置。
  @scriptProp({ type: 'string', default: 'gpucloth', hidden: true })
  __editorPluginType = 'gpucloth';

  @scriptProp({ type: 'bool', label: 'Enabled', group: 'General', default: true })
  enabled = true;

  @scriptProp({ type: 'bool', label: 'Auto Update', group: 'General', default: true })
  autoUpdate = true;

  @scriptProp({
    type: 'node',
    label: 'Simulation Mesh',
    group: 'General',
    sceneNode: { kind: 'mesh' },
    default: ''
  })
  simulationMeshId = '';

  @scriptProp({ type: 'vec3', label: 'Gravity', group: 'Simulation', default: [0, -9.8, 0] })
  gravity = [0, -9.8, 0];

  @scriptProp({ type: 'float', label: 'Damping', group: 'Simulation', default: 0.02, minValue: 0, maxValue: 1 })
  damping = 0.02;

  @scriptProp({
    type: 'float',
    label: 'Dynamic Friction',
    group: 'Simulation',
    default: 0.15,
    minValue: 0,
    maxValue: 1
  })
  dynamicFriction = 0.15;

  @scriptProp({
    type: 'float',
    label: 'Static Friction',
    group: 'Simulation',
    default: 0.3,
    minValue: 0,
    maxValue: 1
  })
  staticFriction = 0.3;

  @scriptProp({ type: 'float', label: 'Stiffness', group: 'Simulation', default: 0.3, minValue: 0, maxValue: 1 })
  stiffness = 0.3;

  @scriptProp({ type: 'float', label: 'Pose Follow', group: 'PoseFollow', default: 0, minValue: 0, maxValue: 1 })
  poseFollow = 0;

  @scriptProp({ type: 'int', label: 'Solver Iterations', group: 'Simulation', default: 5, minValue: 1, maxValue: 32 })
  solverIterations = 5;

  @scriptProp({ type: 'int', label: 'Substeps', group: 'Simulation', default: 2, minValue: 1, maxValue: 8 })
  substeps = 2;

  @scriptProp({ type: 'int', label: 'Max Neighbors', group: 'Advanced', default: 8, minValue: 1, maxValue: 64 })
  maxNeighbors = 8;

  @scriptProp({
    type: 'int',
    label: 'Max Triangles Per Vertex',
    group: 'Advanced',
    default: 16,
    minValue: 1,
    maxValue: 64
  })
  maxTrianglesPerVertex = 16;

  @scriptProp({ type: 'int', label: 'Workgroup Size', group: 'Advanced', default: 64, minValue: 1, maxValue: 256 })
  workgroupSize = 64;

  @scriptProp({ type: 'bool', label: 'Rebuild Normals', group: 'Advanced', default: true })
  rebuildNormals = true;

  @scriptProp({ type: 'string', default: '', hidden: true })
  vertexPinWeightsByTarget = '';

  @scriptProp({ type: 'string', default: '', hidden: true })
  pinnedVertexIndicesByTarget = '';

  @scriptProp({ type: 'string', default: '', hidden: true })
  targetMeshBindingDataByTarget = '';

  @scriptProp({ type: 'string', default: '', hidden: true })
  targetMeshBindingSignatureByTarget = '';

  // 这里改为“标量节点数组”而不是对象数组。
  // 可编辑配置只保留 target mesh 自身；绑定缓存拆到按 target id 分桶的隐藏字段中维护。
  @scriptProp({
    type: 'object_array',
    label: 'Target Meshes',
    group: 'Binding',
    element: {
      type: 'node',
      label: 'Target Mesh',
      default: '',
      sceneNode: { kind: 'mesh' }
    },
    default: ['']
  })
  targetMeshIds = [];

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
    this._cloth = null;
    this._rebuilding = null;
    this._structureSignature = '';
    this._runtimeSignature = '';
    this._disposed = false;
  }

  onDetached(host) {
    if (host === this._host) {
      this.disposeCloth();
      this._host = null;
    }
  }

  onDestroy() {
    this._disposed = true;
    this.disposeCloth();
    this._host = null;
  }

  // 每帧只做两件事：
  // 1. 根据结构签名判断是否需要重建 cloth
  // 2. 根据运行时签名判断是否只需刷新参数
  onUpdate(deltaTime) {
    const host = this._host;
    if (!host || host.disposed) {
      this.disposeCloth();
      return;
    }
    const config = host.scriptConfig ?? {};
    const simulationMesh = resolveSimulationMesh(host, config);
    if (!simulationMesh?.primitive) {
      this.disposeCloth();
      return;
    }
    const wrapTargets = resolveWrapTargets(host, simulationMesh, config);
    const structureSignature = buildStructureSignature(simulationMesh, config, wrapTargets);
    if (!this._cloth || this._structureSignature !== structureSignature) {
      this.ensureCloth(host, simulationMesh, config, wrapTargets, structureSignature);
      return;
    }
    const runtimeSignature = buildRuntimeSignature(host, simulationMesh, config);
    if (this._runtimeSignature !== runtimeSignature) {
      this.applyRuntimeConfig(host, simulationMesh, config);
    }
    if (this._cloth && config.autoUpdate === false) {
      this._cloth.update(deltaTime);
    }
  }

  // createFromMesh 成本较高，因此单独封装成异步重建流程，
  // 并用 _rebuilding 防止一帧内重复发起多次重建。
  async ensureCloth(host, simulationMesh, config, wrapTargets, structureSignature) {
    if (this._rebuilding) {
      return this._rebuilding;
    }
    this._rebuilding = (async () => {
      let nextCloth = null;
      try {
        nextCloth = await GPUClothSystem.createFromMesh(simulationMesh, {
          enabled: config.enabled !== false,
          gravity: new Vector3(
            readNumber(Array.isArray(config.gravity) ? config.gravity[0] : undefined, 0),
            readNumber(Array.isArray(config.gravity) ? config.gravity[1] : undefined, -9.8),
            readNumber(Array.isArray(config.gravity) ? config.gravity[2] : undefined, 0)
          ),
          damping: readNumber(config.damping, 0.02),
          dynamicFriction: readNumber(config.dynamicFriction, 0.15),
          staticFriction: readNumber(config.staticFriction, 0.3),
          stiffness: readNumber(config.stiffness, 0.3),
          poseFollow: readNumber(config.poseFollow, 0),
          substeps: Math.max(1, Math.min(8, Number(config.substeps) || 2)),
          solverIterations: Math.max(1, Number(config.solverIterations) || 5),
          maxNeighbors: Math.max(1, Number(config.maxNeighbors) || 8),
          workgroupSize: Math.max(1, Number(config.workgroupSize) || 64),
          maxTrianglesPerVertex: Math.max(1, Number(config.maxTrianglesPerVertex) || 16),
          rebuildNormals: config.rebuildNormals !== false,
          pinnedVertexWeights: parsePinnedVertexWeights(config, simulationMesh),
          colliders: buildClothColliders(host, config),
          autoUpdate: config.autoUpdate !== false
        });
        if (wrapTargets.length > 0) {
          nextCloth.setWrapTargetsFromBindingData(wrapTargets);
        }
      } catch (err) {
        console.error('GPU cloth initialization failed:', err);
        if (nextCloth) {
          nextCloth.dispose();
        }
        return;
      }
      if (this._disposed || this._host !== host) {
        nextCloth.dispose();
        return;
      }
      this.disposeCloth();
      this._cloth = nextCloth;
      this._structureSignature = structureSignature;
      this._runtimeSignature = '';
      this.applyRuntimeConfig(host, simulationMesh, config);
      if (!nextCloth.supported && nextCloth.disabledReason) {
        console.warn('GPU cloth disabled:', nextCloth.disabledReason);
      }
    })().finally(() => {
      this._rebuilding = null;
    });
    return this._rebuilding;
  }

  // 这里更新的是“已存在 cloth 实例上的可热更新参数”。
  // 如果结构签名没有变化，就尽量走这条轻量路径而不是整套重建。
  applyRuntimeConfig(host, simulationMesh, config) {
    if (!this._cloth) {
      return;
    }
    this._cloth.enabled = config.enabled !== false;
    this._cloth.gravity = new Vector3(
      readNumber(Array.isArray(config.gravity) ? config.gravity[0] : undefined, 0),
      readNumber(Array.isArray(config.gravity) ? config.gravity[1] : undefined, -9.8),
      readNumber(Array.isArray(config.gravity) ? config.gravity[2] : undefined, 0)
    );
    this._cloth.damping = readNumber(config.damping, 0.02);
    this._cloth.dynamicFriction = readNumber(config.dynamicFriction, 0.15);
    this._cloth.staticFriction = readNumber(config.staticFriction, 0.3);
    this._cloth.stiffness = readNumber(config.stiffness, 0.3);
    this._cloth.poseFollow = readNumber(config.poseFollow, 0);
    this._cloth.substeps = Math.max(1, Math.min(8, Number(config.substeps) || 2));
    this._cloth.solverIterations = Math.max(1, Number(config.solverIterations) || 5);
    this._cloth.colliders = buildClothColliders(host, config);
    this._cloth.bindToScene(config.autoUpdate === false ? null : simulationMesh.scene || host.scene || null);
    this._runtimeSignature = buildRuntimeSignature(host, simulationMesh, config);
  }

  disposeCloth() {
    if (this._cloth) {
      this._cloth.dispose();
      this._cloth = null;
    }
    this._structureSignature = '';
    this._runtimeSignature = '';
  }
}
`;
