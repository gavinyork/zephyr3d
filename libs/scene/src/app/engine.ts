import type { IDisposable, Nullable, ReadOptions } from '@zephyr3d/base';
import { MemoryFS, objectEntries } from '@zephyr3d/base';
import { DRef } from '@zephyr3d/base';
import { HttpFS, type VFS } from '@zephyr3d/base';
import { Vector3 } from '@zephyr3d/base';
import { ScriptingSystem } from './scriptingsystem';
import type { Host } from './scriptingsystem';
import type { RuntimeScript } from './runtimescript';
import { getDevice } from './api';
import { ResourceManager } from '../utility/serialization/manager';
import type { Scene } from '../scene';
import { BoxShape, CylinderShape, PlaneShape, SphereShape, TetrahedronShape, TorusShape } from '../shapes';
import {
  BlinnMaterial,
  LambertMaterial,
  PBRMetallicRoughnessMaterial,
  PBRSpecularGlossinessMaterial,
  UnlitMaterial
} from '../material';
import { StandardSpriteMaterial } from '../material/sprite_std';
import {
  GPUClothSystem,
  createCapsuleCollider,
  createPlaneCollider,
  createSphereCollider,
  SpringChain,
  SpringModifier,
  SpringSystem
} from '../animation';
import { ScreenAdapter } from './screen';

const BUILTIN_SPRING_TEST_SCRIPT_JS = `import { Vector3 } from '@zephyr3d/base';
import {
  RuntimeScript,
  createSphereCollider,
  createCapsuleCollider,
  createPlaneCollider,
  SpringModifier,
  SpringSystem,
  SpringChain
} from '@zephyr3d/scene';

export default class extends RuntimeScript {
  onAttached(host) {
    const root = host;
    const config = root?.scriptConfig;
    if (!config || !config.enabled) {
      return;
    }
    const skeleton = root.animationSet?.skeletons?.[0]?.get();
    if (!skeleton) {
      return;
    }
    const parseVec3 = (value, fallback, scale = 1) => {
      if (Array.isArray(value) && value.length >= 3) {
        return new Vector3(
          (Number(value[0]) || 0) * scale,
          (Number(value[1]) || 0) * scale,
          (Number(value[2]) || 0) * scale
        );
      }
      return fallback.clone();
    };
    const getSceneColliderMeta = (node) => {
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
    };
    const buildSceneColliders = (host, includePlane = true) => {
      const colliders = [];
      const scope =
        host?.scene?.rootNode ||
        (typeof host?.getPrefabNode === 'function' && host.getPrefabNode()) ||
        host;
      scope?.iterate?.((node) => {
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
            parseVec3(colliderConfig.offset, Vector3.zero(), unitScale),
            Math.max(0, (Number(colliderConfig.radius) || 0.15) * unitScale),
            node
          );
          collider.localRadiusScaleRef = 1;
        } else if (colliderConfig.type === 'capsule') {
          collider = createCapsuleCollider(
            parseVec3(colliderConfig.offset, Vector3.zero(), unitScale),
            parseVec3(colliderConfig.endOffset, new Vector3(0, 0.2, 0), unitScale),
            Math.max(0, (Number(colliderConfig.radius) || 0.1) * unitScale),
            node
          );
          collider.localRadiusScaleRef = 1;
        } else if (colliderConfig.type === 'plane') {
          collider = createPlaneCollider(
            parseVec3(colliderConfig.offset, Vector3.zero(), unitScale),
            parseVec3(colliderConfig.normal, Vector3.axisPY()),
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
    };
    const buildConfigColliders = (host, config) => {
      const colliders = [];
      for (const colliderConfig of config?.colliders ?? []) {
        const attachNode = root.findNodeByName(colliderConfig.bone) ?? host;
        let collider = null;
        if (colliderConfig.type === 'sphere') {
          collider = createSphereCollider(
            new Vector3(colliderConfig.offsetX, colliderConfig.offsetY, colliderConfig.offsetZ),
            Math.max(0, Number(colliderConfig.radius) || 0.15),
            attachNode
          );
        } else if (colliderConfig.type === 'capsule') {
          collider = createCapsuleCollider(
            new Vector3(colliderConfig.offsetX, colliderConfig.offsetY, colliderConfig.offsetZ),
            new Vector3(colliderConfig.endOffsetX, colliderConfig.endOffsetY, colliderConfig.endOffsetZ),
            Math.max(0, Number(colliderConfig.radius) || 0.1),
            attachNode
          );
        } else if (colliderConfig.type === 'plane') {
          collider = createPlaneCollider(
            new Vector3(colliderConfig.offsetX, colliderConfig.offsetY, colliderConfig.offsetZ),
            new Vector3(colliderConfig.normalX, colliderConfig.normalY, colliderConfig.normalZ),
            attachNode
          );
        }
        if (collider) {
          collider.enabled = colliderConfig.enabled !== false;
          colliders.push(collider);
        }
      }
      return colliders;
    };
    const sharedColliders = buildSceneColliders(root, true);
    const configColliders = buildConfigColliders(root, config);
    for (const chainConfig of config.chains ?? []) {
      const chainStart = root.findNodeByName(chainConfig.startBone);
      const chainEnd = root.findNodeByName(chainConfig.endBone);
      if (!chainStart || !chainEnd) {
        continue;
      }
      const chain = SpringChain.fromBoneChain(chainStart, chainEnd, {
        damping: config.chainDamping,
        stiffness: config.chainStiffness
      });
      const springSystem = new SpringSystem(chain, {
        gravity: new Vector3(config.gravityX, config.gravityY, config.gravityZ),
        iterations: config.iterations,
        enableInertialForces: config.enableInertialForces,
        centrifugalScale: config.centrifugalScale,
        coriolisScale: config.coriolisScale,
        solver: config.solver,
        poseFollow: config.poseFollow,
        poseFollowRoot: config.poseFollowRoot,
        poseFollowTip: config.poseFollowTip,
        poseFollowExponent: config.poseFollowExponent,
        maxPoseOffset: config.maxPoseOffset,
        maxPoseOffsetRoot: config.maxPoseOffsetRoot,
        maxPoseOffsetTip: config.maxPoseOffsetTip
      });
      for (const collider of sharedColliders) {
        springSystem.addCollider(collider);
      }
      for (const collider of configColliders) {
        springSystem.addCollider(collider);
      }
      const springModifier = new SpringModifier(springSystem, config.modifierWeight);
      skeleton.modifiers.push(springModifier);
    }
  }
}
`;

const BUILTIN_GPU_CLOTH_SCRIPT_JS = `import { Vector3 } from '@zephyr3d/base';
import {
  RuntimeScript,
  GPUClothSystem,
  createSphereCollider,
  createCapsuleCollider
} from '@zephyr3d/scene';

function parseTargetEncodedMap(source) {
  const text = String(source || '').trim();
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

function parsePinnedVertexMap(config) {
  const source = String(config?.vertexPinWeightsByTarget || '').trim();
  if (!source) {
    return {};
  }
  return parseTargetEncodedMap(source);
}

function getPinnedVertexSource(config, host) {
  const hostId = String(host?.persistentId || '');
  if (hostId) {
    const byTarget = parsePinnedVertexMap(config);
    if (Object.prototype.hasOwnProperty.call(byTarget, hostId)) {
      return byTarget[hostId] || '';
    }
  }
  return '';
}

function getLegacyPinnedVertexSource(config, host) {
  const hostId = String(host?.persistentId || '');
  if (hostId) {
    const byTarget = parseTargetEncodedMap(config?.pinnedVertexIndicesByTarget);
    if (Object.prototype.hasOwnProperty.call(byTarget, hostId)) {
      return byTarget[hostId] || '';
    }
  }
  return '';
}

function getVertexWeightSource(config, host) {
  return getPinnedVertexSource(config, host) || getLegacyPinnedVertexSource(config, host);
}

function parsePinnedVertexIndices(config, host) {
  const vertexCount = Math.max(0, Number(host?.primitive?.getNumVertices?.()) || 0);
  if (vertexCount <= 0) {
    return undefined;
  }
  const source = getPinnedVertexSource(config, host);
  if (!source.trim()) {
    const legacySource = getLegacyPinnedVertexSource(config, host);
    if (!legacySource.trim()) {
      return undefined;
    }
    const legacyWeights = new Float32Array(vertexCount);
    const values = legacySource
      .split(/[^0-9]+/g)
      .filter((v) => v.length > 0)
      .map((v) => Number(v))
      .filter((v) => Number.isFinite(v) && v >= 0)
      .map((v) => v | 0);
    for (const index of values) {
      if (index < vertexCount) {
        legacyWeights[index] = 1;
      }
    }
    return legacyWeights;
  }
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
    const clothWeight = Math.min(Math.max(Number(entry.slice(separator + 1).trim()) || 0, 0), 1);
    if (Number.isFinite(index) && index >= 0 && index < vertexCount) {
      weights[index] = 1 - clothWeight;
    }
  }
  return weights;
}

function readNumber(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
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

function parseSceneColliderVec3(value, fallback, scale = 1) {
  if (Array.isArray(value) && value.length >= 3) {
    return new Vector3(
      (Number(value[0]) || 0) * scale,
      (Number(value[1]) || 0) * scale,
      (Number(value[2]) || 0) * scale
    );
  }
  return fallback.clone();
}

function sceneColliderVec3ToArray(value) {
  return [value.x, value.y, value.z];
}

function collectSceneNodeColliders(host, includePlane = false) {
  const colliders = [];
  const scope =
    host?.scene?.rootNode ||
    (typeof host?.getPrefabNode === 'function' && host.getPrefabNode()) ||
    host;
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
        parseSceneColliderVec3(colliderConfig.offset, Vector3.zero(), unitScale),
        Math.max(0, (Number(colliderConfig.radius) || 0.15) * unitScale),
        node
      );
      collider.localRadiusScaleRef = 1;
    } else if (colliderConfig.type === 'capsule') {
      collider = createCapsuleCollider(
        parseSceneColliderVec3(colliderConfig.offset, Vector3.zero(), unitScale),
        parseSceneColliderVec3(colliderConfig.endOffset, new Vector3(0, 0.2, 0), unitScale),
        Math.max(0, (Number(colliderConfig.radius) || 0.1) * unitScale),
        node
      );
      collider.localRadiusScaleRef = 1;
    } else if (colliderConfig.type === 'plane') {
      collider = createPlaneCollider(
        parseSceneColliderVec3(colliderConfig.offset, Vector3.zero(), unitScale),
        parseSceneColliderVec3(colliderConfig.normal, Vector3.axisPY()),
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

function serializeSceneColliderConfig(host, includePlane = false) {
  const scope =
    host?.scene?.rootNode ||
    (typeof host?.getPrefabNode === 'function' && host.getPrefabNode()) ||
    host;
  const colliders = [];
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
    colliders.push({
      type: colliderConfig.type,
      enabled: colliderConfig.enabled !== false,
      offset: sceneColliderVec3ToArray(parseSceneColliderVec3(colliderConfig.offset, Vector3.zero(), unitScale)),
      endOffset: sceneColliderVec3ToArray(
        parseSceneColliderVec3(colliderConfig.endOffset, new Vector3(0, 0.2, 0), unitScale)
      ),
      normal: sceneColliderVec3ToArray(parseSceneColliderVec3(colliderConfig.normal, Vector3.axisPY())),
      radius: Math.max(0, (Number(colliderConfig.radius) || 0.15) * unitScale),
      planeSize: Math.max(0, (Number(colliderConfig.planeSize) || 0.5) * unitScale)
    });
    return false;
  });
  return JSON.stringify(colliders);
}

function serializeColliderConfig(colliders) {
  return JSON.stringify(
    (colliders || []).map((collider) => ({
      type: String(collider?.type || 'sphere'),
      enabled: collider?.enabled !== false,
      bone: String(collider?.bone || ''),
      offsetX: Number(collider?.offsetX) || 0,
      offsetY: Number(collider?.offsetY) || 0,
      offsetZ: Number(collider?.offsetZ) || 0,
      endOffsetX: Number(collider?.endOffsetX) || 0,
      endOffsetY: Number(collider?.endOffsetY) || 0,
      endOffsetZ: Number(collider?.endOffsetZ) || 0,
      radius: Number(collider?.radius) || 0
    }))
  );
}

function buildStructureSignature(host, config) {
  return JSON.stringify({
    primitiveId: Number(host?.primitive?.id) || 0,
    vertexPinWeightsByTarget: getVertexWeightSource(config, host),
    maxNeighbors: Number(config?.maxNeighbors) || 8,
    maxTrianglesPerVertex: Number(config?.maxTrianglesPerVertex) || 16,
    workgroupSize: Number(config?.workgroupSize) || 64,
    rebuildNormals: config?.rebuildNormals !== false
  });
}

function buildRuntimeSignature(config, host) {
  return JSON.stringify({
    enabled: config?.enabled !== false,
    autoUpdate: config?.autoUpdate !== false,
    damping: Number(config?.damping),
    stiffness: Number(config?.stiffness),
    gravityX: Number(config?.gravityX),
    gravityY: Number(config?.gravityY),
    gravityZ: Number(config?.gravityZ),
    solverIterations: Number(config?.solverIterations),
    sceneColliders: serializeSceneColliderConfig(host, false),
    colliders: serializeColliderConfig(config?.colliders)
  });
}

function getSceneColliderMetaEntry(node: any) {
  const meta = node?.metaData;
  const collider = meta?.sceneCollider;
  if (
    collider &&
    typeof collider === 'object' &&
    (collider.type === 'sphere' || collider.type === 'capsule' || collider.type === 'plane')
  ) {
    return {
      config: collider,
      legacy: false
    };
  }
  const legacyCollider = meta?.springCollider;
  if (
    legacyCollider &&
    typeof legacyCollider === 'object' &&
    (legacyCollider.type === 'sphere' ||
      legacyCollider.type === 'capsule' ||
      legacyCollider.type === 'plane')
  ) {
    return {
      config: legacyCollider,
      legacy: true
    };
  }
  return null;
}

function parseSceneColliderVec3(value: unknown, fallback: Vector3, scale = 1) {
  if (Array.isArray(value) && value.length >= 3) {
    return new Vector3(
      (Number(value[0]) || 0) * scale,
      (Number(value[1]) || 0) * scale,
      (Number(value[2]) || 0) * scale
    );
  }
  return fallback.clone();
}

function sceneColliderVec3ToArray(value: Vector3): [number, number, number] {
  return [value.x, value.y, value.z];
}

function collectSceneNodeColliders(host: any, includePlane = false) {
  const colliders: any[] = [];
  const scope =
    host?.scene?.rootNode ||
    (typeof host?.getPrefabNode === 'function' && host.getPrefabNode()) ||
    host;
  scope?.iterate?.((node: any) => {
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
        parseSceneColliderVec3(colliderConfig.offset, Vector3.zero(), unitScale),
        Math.max(0, (Number(colliderConfig.radius) || 0.15) * unitScale),
        node
      );
      collider.localRadiusScaleRef = 1;
    } else if (colliderConfig.type === 'capsule') {
      collider = createCapsuleCollider(
        parseSceneColliderVec3(colliderConfig.offset, Vector3.zero(), unitScale),
        parseSceneColliderVec3(colliderConfig.endOffset, new Vector3(0, 0.2, 0), unitScale),
        Math.max(0, (Number(colliderConfig.radius) || 0.1) * unitScale),
        node
      );
      collider.localRadiusScaleRef = 1;
    } else if (colliderConfig.type === 'plane') {
      collider = createPlaneCollider(
        parseSceneColliderVec3(colliderConfig.offset, Vector3.zero(), unitScale),
        parseSceneColliderVec3(colliderConfig.normal, Vector3.axisPY()),
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

function serializeSceneNodeColliderConfig(host: any, includePlane = false) {
  const colliders: any[] = [];
  const scope =
    host?.scene?.rootNode ||
    (typeof host?.getPrefabNode === 'function' && host.getPrefabNode()) ||
    host;
  scope?.iterate?.((node: any) => {
    const entry = getSceneColliderMetaEntry(node);
    const colliderConfig = entry?.config;
    if (!colliderConfig) {
      return false;
    }
    if (colliderConfig.type === 'plane' && !includePlane) {
      return false;
    }
    const unitScale = entry?.legacy ? 0.1 : 1;
    colliders.push({
      type: colliderConfig.type,
      enabled: colliderConfig.enabled !== false,
      offset: sceneColliderVec3ToArray(parseSceneColliderVec3(colliderConfig.offset, Vector3.zero(), unitScale)),
      endOffset: sceneColliderVec3ToArray(
        parseSceneColliderVec3(colliderConfig.endOffset, new Vector3(0, 0.2, 0), unitScale)
      ),
      normal: sceneColliderVec3ToArray(parseSceneColliderVec3(colliderConfig.normal, Vector3.axisPY())),
      radius: Math.max(0, (Number(colliderConfig.radius) || 0.15) * unitScale),
      planeSize: Math.max(0, (Number(colliderConfig.planeSize) || 0.5) * unitScale)
    });
    return false;
  });
  return JSON.stringify(colliders);
}

function buildColliders(host, config) {
  const colliders = collectSceneNodeColliders(host, false);
  const scope =
    (typeof host?.getPrefabNode === 'function' && host.getPrefabNode()) ||
    host?.scene?.rootNode ||
    host;
  for (const colliderConfig of config?.colliders || []) {
    const attachNode = (colliderConfig?.bone && scope?.findNodeByName?.(colliderConfig.bone)) || host;
    let collider = null;
    if (colliderConfig?.type === 'capsule') {
      collider = createCapsuleCollider(
        new Vector3(
          Number(colliderConfig?.offsetX) || 0,
          Number(colliderConfig?.offsetY) || 0,
          Number(colliderConfig?.offsetZ) || 0
        ),
        new Vector3(
          Number(colliderConfig?.endOffsetX) || 0,
          Number(colliderConfig?.endOffsetY) || 0.2,
          Number(colliderConfig?.endOffsetZ) || 0
        ),
        Math.max(0, Number(colliderConfig?.radius) || 0.15),
        attachNode
      );
    } else {
      collider = createSphereCollider(
        new Vector3(
          Number(colliderConfig?.offsetX) || 0,
          Number(colliderConfig?.offsetY) || 0,
          Number(colliderConfig?.offsetZ) || 0
        ),
        Math.max(0, Number(colliderConfig?.radius) || 0.15),
        attachNode
      );
    }
    collider.enabled = colliderConfig?.enabled !== false;
    colliders.push(collider);
  }
  return colliders;
}

export default class extends RuntimeScript {
  constructor() {
    super();
    this._host = null;
    this._cloth = null;
    this._structureSignature = '';
    this._runtimeSignature = '';
    this._rebuilding = false;
  }

  async onAttached(host) {
    this._host = host;
    await this._ensureCloth(true);
  }

  onUpdate(deltaTime) {
    const host = this._host;
    const config = host?.scriptConfig;
    if (!host || !config) {
      return;
    }
    const structureSignature = buildStructureSignature(host, config);
    if (!this._cloth || structureSignature !== this._structureSignature) {
      if (!this._rebuilding) {
        this._rebuilding = true;
        Promise.resolve(this._ensureCloth(false)).finally(() => {
          this._rebuilding = false;
        });
      }
      return;
    }
    const runtimeSignature = buildRuntimeSignature(config, host);
    if (runtimeSignature !== this._runtimeSignature) {
      this._applyRuntimeConfig();
    }
    if (this._cloth && config.autoUpdate === false) {
      this._cloth.update(deltaTime);
    }
  }

  onDetached() {
    this._disposeCloth();
    this._host = null;
  }

  onDestroy() {
    this._disposeCloth();
    this._host = null;
  }

  async _ensureCloth(force) {
    const host = this._host;
    const config = host?.scriptConfig;
    if (!host || !config || !host.isMesh?.() || !host.primitive) {
      this._disposeCloth();
      return;
    }
    const structureSignature = buildStructureSignature(host, config);
    if (!force && this._cloth && structureSignature === this._structureSignature) {
      this._applyRuntimeConfig();
      return;
    }
    this._disposeCloth();
    try {
      const cloth = await GPUClothSystem.createFromMesh(host, {
        enabled: config.enabled !== false,
        gravity: new Vector3(
          readNumber(config.gravityX, 0),
          readNumber(config.gravityY, -9.8),
          readNumber(config.gravityZ, 0)
        ),
        damping: readNumber(config.damping, 0.02),
        stiffness: readNumber(config.stiffness, 0.3),
        solverIterations: Math.max(1, Number(config.solverIterations) || 5),
        maxNeighbors: Math.max(1, Number(config.maxNeighbors) || 8),
        workgroupSize: Math.max(1, Number(config.workgroupSize) || 64),
        maxTrianglesPerVertex: Math.max(1, Number(config.maxTrianglesPerVertex) || 16),
        rebuildNormals: config.rebuildNormals !== false,
        pinnedVertexWeights: parsePinnedVertexIndices(config, host),
        colliders: buildColliders(host, config),
        autoUpdate: config.autoUpdate !== false
      });
      this._cloth = cloth;
      this._structureSignature = structureSignature;
      this._applyRuntimeConfig();
      if (!cloth.supported && cloth.disabledReason) {
        console.warn('GPU cloth disabled:', cloth.disabledReason);
      }
    } catch (err) {
      console.error('GPU cloth initialization failed:', err);
    }
  }

  _applyRuntimeConfig() {
    const cloth = this._cloth;
    const host = this._host;
    const config = host?.scriptConfig;
    if (!cloth || !config) {
      return;
    }
    cloth.enabled = config.enabled !== false;
    cloth.gravity = new Vector3(
      readNumber(config.gravityX, 0),
      readNumber(config.gravityY, -9.8),
      readNumber(config.gravityZ, 0)
    );
    cloth.damping = readNumber(config.damping, 0.02);
    cloth.stiffness = readNumber(config.stiffness, 0.3);
    cloth.solverIterations = Math.max(1, Number(config.solverIterations) || 5);
    cloth.colliders = buildColliders(host, config);
    cloth.bindToScene(config.autoUpdate === false ? null : host.scene || null);
    this._runtimeSignature = buildRuntimeSignature(config, host);
  }

  _disposeCloth() {
    if (this._cloth) {
      this._cloth.dispose();
      this._cloth = null;
    }
    this._structureSignature = '';
    this._runtimeSignature = '';
  }
}
`;

/**
 * Interface for objects that can be rendered.
 *
 * @public
 */
export interface IRenderable extends IDisposable {
  render(): void;
}

/**
 * Interface for render hooks to customize rendering behavior.
 *
 * @public
 */
export interface IRenderHook {
  // If presents, called before rendering the renderable. Return `false` to skip rendering.
  beforeRender?: (renderable: any) => boolean | void;
  // If presents, called after rendering the renderable.
  afterRender?: (renderable: any) => void;
}

function isBuiltinGPUClothScript(script: string): boolean {
  const normalized = (script ?? '').trim().toLowerCase().replace(/\\/g, '/');
  return /(^|\/)gpucloth(\.ts|\.js)?$/.test(normalized);
}

function parseClothTargetEncodedMap(source: unknown): Record<string, string> {
  const text = String(source ?? '').trim();
  if (!text) {
    return {};
  }
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof key === 'string') {
        result[key] = typeof value === 'string' ? value : String(value ?? '');
      }
    }
    return result;
  } catch {
    return {};
  }
}

function parseClothPinnedVertexMap(config: any): Record<string, string> {
  const source = String(config?.vertexPinWeightsByTarget || '').trim();
  if (!source) {
    return {};
  }
  return parseClothTargetEncodedMap(source);
}

function getClothPinnedVertexSource(config: any, target?: any): string {
  const targetId = String(target?.persistentId ?? '');
  if (targetId) {
    const byTarget = parseClothPinnedVertexMap(config);
    if (Object.prototype.hasOwnProperty.call(byTarget, targetId)) {
      return byTarget[targetId] ?? '';
    }
  }
  return '';
}

function getClothLegacyPinnedVertexSource(config: any, target?: any): string {
  const targetId = String(target?.persistentId ?? '');
  if (targetId) {
    const byTarget = parseClothTargetEncodedMap(config?.pinnedVertexIndicesByTarget);
    if (Object.prototype.hasOwnProperty.call(byTarget, targetId)) {
      return byTarget[targetId] ?? '';
    }
  }
  return '';
}

function getClothVertexWeightSource(config: any, target?: any): string {
  return getClothPinnedVertexSource(config, target) || getClothLegacyPinnedVertexSource(config, target);
}

function parseClothPinnedVertexIndices(config: any, target?: any): Float32Array<ArrayBuffer> | undefined {
  const vertexCount = Math.max(0, Number(target?.primitive?.getNumVertices?.()) || 0);
  if (vertexCount <= 0) {
    return undefined;
  }
  const source = getClothPinnedVertexSource(config, target);
  if (!source.trim()) {
    const legacySource = getClothLegacyPinnedVertexSource(config, target);
    if (!legacySource.trim()) {
      return undefined;
    }
    const legacyWeights = new Float32Array(vertexCount);
    const values = legacySource
      .split(/[^0-9]+/g)
      .filter((v) => v.length > 0)
      .map((v) => Number(v))
      .filter((v) => Number.isFinite(v) && v >= 0)
      .map((v) => v | 0);
    for (const index of values) {
      if (index < vertexCount) {
        legacyWeights[index] = 1;
      }
    }
    return legacyWeights;
  }
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
    const clothWeight = Math.min(Math.max(Number(entry.slice(separator + 1).trim()) || 0, 0), 1);
    if (Number.isFinite(index) && index >= 0 && index < vertexCount) {
      weights[index] = 1 - clothWeight;
    }
  }
  return weights;
}

function readClothNumber(value: unknown, fallback: number): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function getSceneColliderMetaEntry(node: any) {
  const meta = node?.metaData;
  const collider = meta?.sceneCollider;
  if (
    collider &&
    typeof collider === 'object' &&
    (collider.type === 'sphere' || collider.type === 'capsule' || collider.type === 'plane')
  ) {
    return {
      config: collider,
      legacy: false
    };
  }
  const legacyCollider = meta?.springCollider;
  if (
    legacyCollider &&
    typeof legacyCollider === 'object' &&
    (legacyCollider.type === 'sphere' ||
      legacyCollider.type === 'capsule' ||
      legacyCollider.type === 'plane')
  ) {
    return {
      config: legacyCollider,
      legacy: true
    };
  }
  return null;
}

function parseSceneColliderVec3(value: unknown, fallback: Vector3, scale = 1) {
  if (Array.isArray(value) && value.length >= 3) {
    return new Vector3(
      (Number(value[0]) || 0) * scale,
      (Number(value[1]) || 0) * scale,
      (Number(value[2]) || 0) * scale
    );
  }
  return fallback.clone();
}

function sceneColliderVec3ToArray(value: Vector3): [number, number, number] {
  return [value.x, value.y, value.z];
}

function collectSceneNodeColliders(host: any, includePlane = false) {
  const colliders: any[] = [];
  const scope =
    host?.scene?.rootNode ||
    (typeof host?.getPrefabNode === 'function' && host.getPrefabNode()) ||
    host;
  scope?.iterate?.((node: any) => {
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
        parseSceneColliderVec3(colliderConfig.offset, Vector3.zero(), unitScale),
        Math.max(0, (Number(colliderConfig.radius) || 0.15) * unitScale),
        node
      );
      collider.localRadiusScaleRef = 1;
    } else if (colliderConfig.type === 'capsule') {
      collider = createCapsuleCollider(
        parseSceneColliderVec3(colliderConfig.offset, Vector3.zero(), unitScale),
        parseSceneColliderVec3(colliderConfig.endOffset, new Vector3(0, 0.2, 0), unitScale),
        Math.max(0, (Number(colliderConfig.radius) || 0.1) * unitScale),
        node
      );
      collider.localRadiusScaleRef = 1;
    } else if (colliderConfig.type === 'plane') {
      collider = createPlaneCollider(
        parseSceneColliderVec3(colliderConfig.offset, Vector3.zero(), unitScale),
        parseSceneColliderVec3(colliderConfig.normal, Vector3.axisPY()),
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

function serializeSceneNodeColliderConfig(host: any, includePlane = false) {
  const colliders: any[] = [];
  const scope =
    host?.scene?.rootNode ||
    (typeof host?.getPrefabNode === 'function' && host.getPrefabNode()) ||
    host;
  scope?.iterate?.((node: any) => {
    const entry = getSceneColliderMetaEntry(node);
    const colliderConfig = entry?.config;
    if (!colliderConfig) {
      return false;
    }
    if (colliderConfig.type === 'plane' && !includePlane) {
      return false;
    }
    const unitScale = entry?.legacy ? 0.1 : 1;
    colliders.push({
      type: colliderConfig.type,
      enabled: colliderConfig.enabled !== false,
      offset: sceneColliderVec3ToArray(parseSceneColliderVec3(colliderConfig.offset, Vector3.zero(), unitScale)),
      endOffset: sceneColliderVec3ToArray(
        parseSceneColliderVec3(colliderConfig.endOffset, new Vector3(0, 0.2, 0), unitScale)
      ),
      normal: sceneColliderVec3ToArray(parseSceneColliderVec3(colliderConfig.normal, Vector3.axisPY())),
      radius: Math.max(0, (Number(colliderConfig.radius) || 0.15) * unitScale),
      planeSize: Math.max(0, (Number(colliderConfig.planeSize) || 0.5) * unitScale)
    });
    return false;
  });
  return JSON.stringify(colliders);
}

function serializeClothColliderConfig(colliders: any[]) {
  return JSON.stringify(
    (colliders || []).map((collider) => ({
      type: String(collider?.type || 'sphere'),
      enabled: collider?.enabled !== false,
      bone: String(collider?.bone || ''),
      offsetX: readClothNumber(collider?.offsetX, 0),
      offsetY: readClothNumber(collider?.offsetY, 0),
      offsetZ: readClothNumber(collider?.offsetZ, 0),
      endOffsetX: readClothNumber(collider?.endOffsetX, 0),
      endOffsetY: readClothNumber(collider?.endOffsetY, 0),
      endOffsetZ: readClothNumber(collider?.endOffsetZ, 0),
      radius: readClothNumber(collider?.radius, 0)
    }))
  );
}

function buildClothStructureSignature(host: any, config: any) {
  return JSON.stringify({
    primitiveId: Number(host?.primitive?.id) || 0,
    vertexPinWeightsByTarget: getClothVertexWeightSource(config, host),
    maxNeighbors: Math.max(1, Number(config?.maxNeighbors) || 8),
    maxTrianglesPerVertex: Math.max(1, Number(config?.maxTrianglesPerVertex) || 16),
    workgroupSize: Math.max(1, Number(config?.workgroupSize) || 64),
    rebuildNormals: config?.rebuildNormals !== false
  });
}

function buildClothRuntimeSignature(config: any, host: any) {
  return JSON.stringify({
    enabled: config?.enabled !== false,
    autoUpdate: config?.autoUpdate !== false,
    damping: readClothNumber(config?.damping, 0.02),
    stiffness: readClothNumber(config?.stiffness, 0.3),
    gravityX: readClothNumber(config?.gravityX, 0),
    gravityY: readClothNumber(config?.gravityY, -9.8),
    gravityZ: readClothNumber(config?.gravityZ, 0),
    solverIterations: Math.max(1, Number(config?.solverIterations) || 5),
    sceneColliders: serializeSceneNodeColliderConfig(host, false),
    colliders: serializeClothColliderConfig(config?.colliders ?? [])
  });
}

function buildClothColliders(host: any, config: any) {
  const colliders = collectSceneNodeColliders(host, false);
  const scope =
    (typeof host?.getPrefabNode === 'function' && host.getPrefabNode()) ||
    host?.scene?.rootNode ||
    host;
  for (const colliderConfig of config?.colliders ?? []) {
    const attachNode = (colliderConfig?.bone && scope?.findNodeByName?.(colliderConfig.bone)) || host;
    let collider = null;
    if (colliderConfig?.type === 'capsule') {
      collider = createCapsuleCollider(
        new Vector3(
          readClothNumber(colliderConfig?.offsetX, 0),
          readClothNumber(colliderConfig?.offsetY, 0),
          readClothNumber(colliderConfig?.offsetZ, 0)
        ),
        new Vector3(
          readClothNumber(colliderConfig?.endOffsetX, 0),
          readClothNumber(colliderConfig?.endOffsetY, 0.2),
          readClothNumber(colliderConfig?.endOffsetZ, 0)
        ),
        Math.max(0, readClothNumber(colliderConfig?.radius, 0.15)),
        attachNode
      );
    } else {
      collider = createSphereCollider(
        new Vector3(
          readClothNumber(colliderConfig?.offsetX, 0),
          readClothNumber(colliderConfig?.offsetY, 0),
          readClothNumber(colliderConfig?.offsetZ, 0)
        ),
        Math.max(0, readClothNumber(colliderConfig?.radius, 0.15)),
        attachNode
      );
    }
    collider.enabled = colliderConfig?.enabled !== false;
    colliders.push(collider);
  }
  return colliders;
}

function resolveClothGravity(target: any, config: any) {
  const worldGravity = new Vector3(
    readClothNumber(config?.gravityX, 0),
    readClothNumber(config?.gravityY, -9.8),
    readClothNumber(config?.gravityZ, 0)
  );
  const invWorldMatrix = target?.invWorldMatrix;
  if (!invWorldMatrix?.transformVectorAffine) {
    return worldGravity;
  }
  return invWorldMatrix.transformVectorAffine(worldGravity, new Vector3());
}

function collectBuiltinClothTargetMeshes(host: any): any[] {
  if (!host) {
    return [];
  }
  if (host.isMesh?.() && host.primitive) {
    return [host];
  }
  const targets: any[] = [];
  host.iterate?.((node: any) => {
    if (node?.isMesh?.() && node.primitive) {
      targets.push(node);
    }
    return false;
  });
  return targets;
}

function ensureBuiltinClothState(host: any) {
  return ((host as any).__builtinClothState ??= {
    cloth: null,
    structureSignature: '',
    runtimeSignature: '',
    rebuilding: false
  });
}

/**
 * Core engine class managing scripting, serialization, and rendering.
 *
 * Responsibilities:
 * - Manages a {@link ScriptingSystem} for dynamic script attachment and lifecycle.
 * - Manages a {@link ResourceManager} for loading scenes and assets.
 * - Maintains a list of active renderable objects to be rendered each frame.
 * - Provides methods to attach/detach scripts, update scripts, load scenes, and read files.
 * - Supports enabling/disabling of runtime operations.
 *
 * @remarks
 * The engine can be configured with a virtual file system (VFS) and script root path.
 * It exposes methods to manage scripts on host objects, update scripts each frame,
 * load scenes from files, and render active objects.
 *
 * @public
 */
export class Engine {
  private _builtinsVFS: Nullable<MemoryFS>;
  private _scriptingSystem: ScriptingSystem;
  private _resourceManager: ResourceManager;
  private _enabled: boolean;
  private _screen: ScreenAdapter;
  protected _activeRenderables: {
    renderable: DRef<IRenderable>;
    hook: Nullable<IRenderHook>;
  }[];
  // 内置 springtest 的延迟挂载队列：
  // 需要等骨骼世界矩阵稳定后再初始化弹簧，避免 restLength 在未就位时采样为异常值。
  private _pendingBuiltinSpringHosts: Array<{ host: any; retries: number; delayFrames: number }>;
  private _builtinClothHosts: any[];
  private _loadingScenes: Partial<Record<string, Promise<Nullable<Scene>>>>;
  /**
   * Creates a new runtime manager.
   *
   * @param VFS - Optional virtual file system passed to the internal {@link ScriptingSystem}.
   * @param scriptsRoot - Optional scripts root path within the VFS. Defaults as in `ScriptingSystem`.
   * @param enabled - Whether runtime operations are active. Defaults to `true`.
   */
  constructor(VFS?: VFS, scriptsRoot?: string, enabled?: boolean) {
    VFS = VFS ?? new HttpFS('./');
    this._builtinsVFS = null;
    this._scriptingSystem = new ScriptingSystem({ VFS, scriptsRoot });
    this._resourceManager = new ResourceManager(VFS);
    this._enabled = enabled ?? true;
    this._activeRenderables = [];
    this._pendingBuiltinSpringHosts = [];
    this._builtinClothHosts = [];
    this._loadingScenes = {};
    this._screen = new ScreenAdapter();
  }
  /**
   * Exposes the instance of {@link ScriptingSystem}.
   */
  get scriptingSystem() {
    return this._scriptingSystem;
  }
  /**
   * Exposes the virtual file system used by the underlying {@link ScriptingSystem}'s registry.
   */
  get VFS() {
    return this._scriptingSystem.registry.VFS;
  }
  set VFS(vfs: VFS) {
    if (vfs !== this._resourceManager.VFS) {
      this._resourceManager.VFS?.close();
      this._resourceManager.VFS = vfs;
      this._scriptingSystem.registry.VFS = vfs;
      this.ensureBuiltinVFS();
    }
  }
  /**
   * Exposes the instance of {@link ResourceManager}.
   */
  get resourceManager() {
    return this._resourceManager;
  }
  /**
   * Exposes the instanceof {@link Screen}
   */
  get screen() {
    return this._screen;
  }
  /** @internal */
  async init() {
    await this.ensureBuiltinVFS();
  }
  /**
   * Detaches all scripts from all hosts, if enabled.
   *
   * No-op when `enabled === false`.
   */
  detachAllScripts() {
    if (this._enabled) {
      this._scriptingSystem.detachAllScripts();
    }
  }
  /**
   * Attaches a script module to the given host, if enabled.
   *
   * When disabled, this method resolves to `null` without side effects.
   *
   * @typeParam T - Host type.
   * @param host - Host object to attach the script to.
   * @param module - Module identifier to resolve and load.
   * @returns The `RuntimeScript<T>` instance, or `null` if disabled or on failure.
   */
  async attachScript<T extends Host>(host: Nullable<T>, module: string) {
    if (!this._enabled) {
      return null;
    }
    if (host && (this.tryAttachBuiltinSpringScript(host, module) || this.tryAttachBuiltinGPUClothScript(host, module))) {
      return null;
    }
    return await this._scriptingSystem.attachScript(host, module);
  }
  /**
   * Detaches a script from a host, by module ID or instance, if enabled.
   *
   * No-op when disabled.
   *
   * @typeParam T - Host type.
   * @param host - Host to detach from.
   * @param idOrInstance - Target script by module ID or instance reference.
   */
  detachScript<T extends Host>(host: T, idOrInstance: string | RuntimeScript<T>) {
    if (this._enabled) {
      this._scriptingSystem.detachScript(host, idOrInstance);
    }
  }
  /**
   * Gets all scripts attached to a host.
   *
   * Delegates to {@link ScriptingSystem.getScriptObjects}.
   *
   * @typeParam T - Expected script type.
   * @param host - Host object to query.
   * @returns Script instances attached to the host, or an empty array.
   */
  getScriptObjects<T extends RuntimeScript<any>>(host: unknown) {
    return this._scriptingSystem.getScriptObjects(host) as T[];
  }
  /**
   * Ticks all attached scripts by calling their `onUpdate` hooks, if enabled.
   *
   * Delegates to {@link ScriptingSystem.update}. No-op when disabled.
   *
   * @param deltaTime - Time since last update in Seconds.
   * @param elapsedTime - Total elapsed time in Seconds.
   */
  update(deltaTime: number, elapsedTime: number) {
    if (this._enabled) {
      // 每帧先尝试处理内置 spring 的延迟挂载，再执行常规脚本更新。
      this.flushPendingBuiltinSpringHosts();
      this.updateBuiltinClothHosts(deltaTime);
      this._scriptingSystem.update(deltaTime, elapsedTime);
    }
  }
  async loadSceneFromFile(path: string) {
    path = this.VFS.normalizePath(path);
    if (!this._loadingScenes[path]) {
      this._loadingScenes[path] = this._loadScene(path);
    }
    return this._loadingScenes[path]!;
  }
  setRenderable(renderable: Nullable<IRenderable>, layer = 0, hook?: IRenderHook) {
    if (!this._activeRenderables[layer]) {
      this._activeRenderables[layer] = {
        renderable: new DRef<IRenderable>(null),
        hook: null
      };
    }
    this._activeRenderables[layer].hook = hook ?? null;
    this._activeRenderables[layer].renderable.set(renderable);
  }
  async readFile<T extends ReadOptions['encoding'] = 'binary'>(path: string, encoding?: T) {
    try {
      const content = await this.VFS.readFile(path, { encoding: encoding ?? 'binary' });
      return content as T extends 'binary' ? ArrayBuffer : string;
    } catch (err) {
      console.error(`Read file '${path}' failed: ${err}`);
      return null;
    }
  }
  async startup(
    startupScene?: Nullable<string>,
    splashScreen?: Nullable<string>,
    startupScript?: Nullable<string>
  ) {
    const splashScreenLayer = 9999;
    if (splashScreen) {
      const splashScreenScene = await this.loadSceneFromFile(splashScreen);
      if (splashScreenScene) {
        this.setRenderable(splashScreenScene, splashScreenLayer);
      }
    }
    if (startupScript) {
      const path =
        startupScript.toLowerCase().endsWith('.ts') || startupScript.toLowerCase().endsWith('.js')
          ? startupScript.slice(0, -3)
          : startupScript;
      await this.attachScript(null, path);
    }
    if (startupScene) {
      const scene = await this.loadSceneFromFile(startupScene);
      this.setRenderable(scene, 0);
    }
    this.setRenderable(null, splashScreenLayer);
  }
  render() {
    this._activeRenderables.forEach((info) => {
      const render = info.hook?.beforeRender
        ? (info.hook.beforeRender(info.renderable.get() ?? null) ?? true)
        : true;
      if (render) {
        info.renderable.get()?.render();
      }
      if (info.hook?.afterRender) {
        info.hook.afterRender(info.renderable.get() ?? null);
      }
    });
  }
  private async ensureBuiltinVFS() {
    if (!this._builtinsVFS) {
      this._builtinsVFS = await this.createBuiltinVFS();
    }
    this.VFS.unmount('/assets/@builtins');
    this.VFS.mount('/assets/@builtins', this._builtinsVFS);
  }
  private async createBuiltinVFS() {
    const fs = new MemoryFS();
    const shapeClsMap = {
      '/primitives/box.zmsh': BoxShape,
      '/primitives/sphere.zmsh': SphereShape,
      '/primitives/cylinder.zmsh': CylinderShape,
      '/primitives/plane.zmsh': PlaneShape,
      '/primitives/torus.zmsh': TorusShape,
      '/primitives/tetrahedron.zmsh': TetrahedronShape,
      '/materials/unlit.zmtl': UnlitMaterial,
      '/materials/lambert.zmtl': LambertMaterial,
      '/materials/blinnphong.zmtl': BlinnMaterial,
      '/materials/pbr_metallic_roughness.zmtl': PBRMetallicRoughnessMaterial,
      '/materials/pbr_specular_glossiness.zmtl': PBRSpecularGlossinessMaterial,
      '/materials/sprite_std.zmtl': StandardSpriteMaterial
    } as const;
    for (const [key] of objectEntries(shapeClsMap)) {
      const obj = new shapeClsMap[key]();
      await this.writeSerializableObject(fs, 'Default', obj, key);
      obj.dispose();
    }
    await fs.writeFile('/scripts/springtest.js', BUILTIN_SPRING_TEST_SCRIPT_JS, {
      encoding: 'utf8',
      create: true
    });
    await fs.writeFile('/scripts/gpucloth.js', BUILTIN_GPU_CLOTH_SCRIPT_JS, {
      encoding: 'utf8',
      create: true
    });
    fs.readOnly = true;
    return fs;
  }
  private async writeSerializableObject(VFS: VFS, type: string, obj: any, path: string) {
    try {
      const data = await this.resourceManager.serializeObject(obj);
      const content = JSON.stringify({ type, data }, null, 2);
      await VFS.writeFile(path, content, { encoding: 'utf8', create: true });
    } catch (err) {
      console.error(`Write file '${path}' failed: ${err}`);
    }
  }
  private async _loadScene(path: string) {
    try {
      const scene = await this._resourceManager.loadScene(path);
      if (scene) {
        if (scene.script) {
          await this.attachScriptOrBuiltin(scene as any, scene.script);
        }
        const P: Promise<any>[] = [];
        const scripts: string[] = [];
        scene.rootNode.iterate((node) => {
          if (node.script) {
            if (this.tryAttachBuiltinSpringScript(node, node.script)) {
              return false;
            }
            if (this.tryAttachBuiltinGPUClothScript(node, node.script)) {
              return false;
            }
            scripts.push(node.script);
            P.push(this.attachScript(node, node.script));
          }
          return false;
        });
        if (P.length > 0) {
          const result = await Promise.allSettled(P);
          for (let i = 0; i < result.length; i++) {
            if (result[i].status === 'rejected') {
              console.error(`Attach script failed: ${scripts[i]}`);
            }
          }
        }
      }
      return scene;
    } catch (err) {
      console.error(`Load scene from '${path}' failed: ${err}`);
      return null;
    }
  }
  private async attachScriptOrBuiltin(host: any, script: string) {
    if (this.tryAttachBuiltinSpringScript(host, script) || this.tryAttachBuiltinGPUClothScript(host, script)) {
      return;
    }
    try {
      await this.attachScript(host, script);
    } catch (err) {
      console.error(`Attach script failed: ${err}`);
    }
  }
  private isBuiltinSpringTestScript(script: string): boolean {
    const normalized = (script ?? '').trim().toLowerCase().replace(/\\/g, '/');
    return /(^|\/)springtest(\.ts|\.js)?$/.test(normalized);
  }
  private tryAttachBuiltinSpringScript(root: any, script: string): boolean {
    if (!this.isBuiltinSpringTestScript(script)) {
      return false;
    }
    this.enqueueBuiltinSpringHost(root);
    return true;
  }
  private enqueueBuiltinSpringHost(host: any) {
    if (!host) {
      return;
    }
    if ((host as any).__builtinSpringAttached) {
      return;
    }
    if (this._pendingBuiltinSpringHosts.some((v) => v.host === host)) {
      return;
    }
    this._pendingBuiltinSpringHosts.push({
      host,
      // 给出足够重试窗口，等待模型/骨骼异步资源加载完成。
      retries: 120,
      // 至少延迟 1 帧，避免与反序列化同帧初始化导致姿态未就绪。
      delayFrames: 1
    });
  }
  private flushPendingBuiltinSpringHosts() {
    if (this._pendingBuiltinSpringHosts.length === 0) {
      return;
    }
    const remained: Array<{ host: any; retries: number; delayFrames: number }> = [];
    for (const item of this._pendingBuiltinSpringHosts) {
      const host = item.host;
      if (!host || host.disposed || (host as any).__builtinSpringAttached) {
        continue;
      }
      if (item.delayFrames > 0) {
        item.delayFrames -= 1;
        remained.push(item);
        continue;
      }
      const ok = this.attachBuiltinSpringScript(host);
      if (!ok && item.retries > 0) {
        item.retries -= 1;
        item.delayFrames = 1;
        remained.push(item);
      }
    }
    this._pendingBuiltinSpringHosts = remained;
  }
  private tryAttachBuiltinGPUClothScript(host: any, script: string): boolean {
    if (!host || !isBuiltinGPUClothScript(script)) {
      return false;
    }
    if (!this._builtinClothHosts.includes(host)) {
      this._builtinClothHosts.push(host);
    }
    return true;
  }
  private updateBuiltinClothHosts(deltaTime: number) {
    if (this._builtinClothHosts.length === 0) {
      return;
    }
    const remained: any[] = [];
    for (const host of this._builtinClothHosts) {
      if (!host || host.disposed) {
        this.disposeBuiltinClothHost(host);
        continue;
      }
      if (!isBuiltinGPUClothScript(host.script ?? '')) {
        this.disposeBuiltinClothHost(host);
        continue;
      }
      remained.push(host);
      this.updateBuiltinClothHost(host, deltaTime);
    }
    this._builtinClothHosts = remained;
  }
  private updateBuiltinClothHost(host: any, deltaTime: number) {
    const config = host?.scriptConfig;
    const targets = collectBuiltinClothTargetMeshes(host);
    if (!host || !config || targets.length === 0) {
      this.disposeBuiltinClothHost(host);
      return;
    }
    const previousTargets = ((host as any).__builtinClothTargets as any[] | undefined) ?? [];
    for (const previousTarget of previousTargets) {
      if (!targets.includes(previousTarget)) {
        this.disposeBuiltinClothTarget(previousTarget);
      }
    }
    (host as any).__builtinClothTargets = targets;
    for (const target of targets) {
      const state = ensureBuiltinClothState(target);
      const structureSignature = buildClothStructureSignature(target, config);
      const runtimeSignature = buildClothRuntimeSignature(config, target);
      if (!state.cloth || structureSignature !== state.structureSignature) {
        if (!state.rebuilding) {
          state.rebuilding = true;
          Promise.resolve(this.ensureBuiltinClothHost(host, target)).finally(() => {
            const latestState = (target as any)?.__builtinClothState;
            if (latestState) {
              latestState.rebuilding = false;
            }
          });
        }
        continue;
      }
      if (runtimeSignature !== state.runtimeSignature) {
        this.applyBuiltinClothRuntimeConfig(host, target);
      }
      state.cloth.gravity = resolveClothGravity(target, config);
      if (state.cloth && config.autoUpdate === false) {
        state.cloth.update(deltaTime);
      }
    }
  }
  private async ensureBuiltinClothHost(host: any, target: any) {
    const config = host?.scriptConfig;
    if (!host || !config || !target || !target.isMesh?.() || !target.primitive) {
      this.disposeBuiltinClothTarget(target);
      return;
    }
    const state = ensureBuiltinClothState(target);
    const structureSignature = buildClothStructureSignature(target, config);
    if (state.cloth && structureSignature === state.structureSignature) {
      this.applyBuiltinClothRuntimeConfig(host, target);
      return;
    }
    this.disposeBuiltinClothTarget(target);
    try {
      const cloth = await GPUClothSystem.createFromMesh(target, {
        enabled: config.enabled !== false,
        gravity: resolveClothGravity(target, config),
        damping: readClothNumber(config.damping, 0.02),
        stiffness: readClothNumber(config.stiffness, 0.3),
        solverIterations: Math.max(1, Number(config.solverIterations) || 5),
        maxNeighbors: Math.max(1, Number(config.maxNeighbors) || 8),
        workgroupSize: Math.max(1, Number(config.workgroupSize) || 64),
        maxTrianglesPerVertex: Math.max(1, Number(config.maxTrianglesPerVertex) || 16),
        rebuildNormals: config.rebuildNormals !== false,
        pinnedVertexWeights: parseClothPinnedVertexIndices(config, target),
        colliders: buildClothColliders(target, config),
        autoUpdate: config.autoUpdate !== false,
        device: getDevice()
      });
      (target as any).__builtinClothState = {
        cloth,
        structureSignature,
        runtimeSignature: '',
        rebuilding: false
      };
      this.applyBuiltinClothRuntimeConfig(host, target);
      if (!cloth.supported && cloth.disabledReason) {
        console.warn('GPU cloth disabled:', cloth.disabledReason);
      }
    } catch (err) {
      console.error('GPU cloth initialization failed:', err);
    }
  }
  private applyBuiltinClothRuntimeConfig(host: any, target: any) {
    const config = host?.scriptConfig;
    const state = target?.__builtinClothState;
    const cloth = state?.cloth as Nullable<GPUClothSystem>;
    if (!cloth || !config) {
      return;
    }
    cloth.enabled = config.enabled !== false;
    cloth.gravity = resolveClothGravity(target, config);
    cloth.damping = readClothNumber(config.damping, 0.02);
    cloth.stiffness = readClothNumber(config.stiffness, 0.3);
    cloth.solverIterations = Math.max(1, Number(config.solverIterations) || 5);
    cloth.colliders = buildClothColliders(target, config);
    cloth.bindToScene(config.autoUpdate === false ? null : target.scene || host.scene || null);
    state.runtimeSignature = buildClothRuntimeSignature(config, target);
  }
  private disposeBuiltinClothHost(host: any) {
    const targets = ((host as any)?.__builtinClothTargets as any[] | undefined) ?? [];
    for (const target of targets) {
      this.disposeBuiltinClothTarget(target);
    }
    if (host && '__builtinClothTargets' in host) {
      (host as any).__builtinClothTargets = [];
    }
  }
  private disposeBuiltinClothTarget(target: any) {
    const state = target?.__builtinClothState;
    if (state?.cloth) {
      state.cloth.dispose();
    }
    if (target && '__builtinClothState' in target) {
      (target as any).__builtinClothState = null;
    }
  }
  private attachBuiltinSpringScript(root: any): boolean {
    const config = root?.scriptConfig;
    if (!config || !config.enabled) {
      return true;
    }
    const skeletonRef = root.animationSet?.skeletons?.[0];
    const skeleton = typeof skeletonRef?.get === 'function' ? skeletonRef.get() : skeletonRef;
    if (!skeleton) {
      return false;
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
      // 链条骨骼尚未形成有效世界距离，延后到后续帧再初始化。
      return false;
    }
    const sharedColliders = collectSceneNodeColliders(root, true);
    const configColliders = [];
    for (const colliderConfig of config?.colliders ?? []) {
      const attachNode = root.findNodeByName(colliderConfig.bone) ?? root;
      let collider: any = null;
      if (colliderConfig.type === 'sphere') {
        collider = createSphereCollider(
          new Vector3(colliderConfig.offsetX, colliderConfig.offsetY, colliderConfig.offsetZ),
          Math.max(0, Number(colliderConfig.radius) || 0.15),
          attachNode
        );
      } else if (colliderConfig.type === 'capsule') {
        collider = createCapsuleCollider(
          new Vector3(colliderConfig.offsetX, colliderConfig.offsetY, colliderConfig.offsetZ),
          new Vector3(colliderConfig.endOffsetX, colliderConfig.endOffsetY, colliderConfig.endOffsetZ),
          Math.max(0, Number(colliderConfig.radius) || 0.1),
          attachNode
        );
      } else if (colliderConfig.type === 'plane') {
        collider = createPlaneCollider(
          new Vector3(colliderConfig.offsetX, colliderConfig.offsetY, colliderConfig.offsetZ),
          new Vector3(colliderConfig.normalX, colliderConfig.normalY, colliderConfig.normalZ),
          attachNode
        );
      }
      if (collider) {
        collider.enabled = colliderConfig.enabled !== false;
        configColliders.push(collider);
      }
    }
    for (const chainConfig of config.chains ?? []) {
      const chainStart = root.findNodeByName(chainConfig.startBone);
      const chainEnd = root.findNodeByName(chainConfig.endBone);
      if (!chainStart || !chainEnd) {
        continue;
      }
      const chain = SpringChain.fromBoneChain(chainStart, chainEnd, {
        damping: config.chainDamping,
        stiffness: config.chainStiffness
      });
      const springSystem = new SpringSystem(chain, {
        gravity: new Vector3(config.gravityX, config.gravityY, config.gravityZ),
        iterations: config.iterations,
        enableInertialForces: config.enableInertialForces,
        centrifugalScale: config.centrifugalScale,
        coriolisScale: config.coriolisScale,
        solver: config.solver,
        poseFollow: config.poseFollow,
        poseFollowRoot: config.poseFollowRoot,
        poseFollowTip: config.poseFollowTip,
        poseFollowExponent: config.poseFollowExponent,
        maxPoseOffset: config.maxPoseOffset,
        maxPoseOffsetRoot: config.maxPoseOffsetRoot,
        maxPoseOffsetTip: config.maxPoseOffsetTip
      });
      for (const collider of sharedColliders) {
        springSystem.addCollider(collider);
      }
      for (const collider of configColliders) {
        springSystem.addCollider(collider);
      }
      const springModifier = new SpringModifier(springSystem, config.modifierWeight);
      skeleton.modifiers.push(springModifier);
    }
    // 标记已完成，防止重复挂载同一套 spring modifier。
    (root as any).__builtinSpringAttached = true;
    return true;
  }
}
