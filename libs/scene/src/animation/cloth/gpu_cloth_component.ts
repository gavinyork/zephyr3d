import { Disposable, Vector3, type Nullable } from '@zephyr3d/base';
import type { Mesh } from '../../scene/mesh';
import type { SceneNode } from '../../scene/scene_node';
import {
  createCapsuleCollider,
  createBoxCollider,
  createPlaneCollider,
  createSphereCollider,
  type SpringCollider
} from '../spring';
import {
  GPUClothSystem,
  type GPUClothWrapBindingData,
  type GPUClothWrapBindingTarget
} from './gpu_cloth_system';

/** Serialized collider used by {@link GPUClothComponent}. */
export type GPUClothColliderConfig = {
  type: 'sphere' | 'capsule' | 'plane' | 'box';
  enabled?: boolean;
  nodeId?: string;
  offset?: [number, number, number];
  endOffset?: [number, number, number];
  radius?: number;
  size?: [number, number, number];
  normal?: [number, number, number];
};

/** Serialized wrap target used by {@link GPUClothComponent}. */
export type GPUClothWrapTargetConfig = {
  meshId: string;
  meshPath?: Array<{ name: string; sameNameIndex: number }>;
  bindingData: GPUClothWrapBindingData;
  /** Sparse per-vertex wrap weights encoded as `vertexIndex:weight`. Missing vertices default to 1. */
  targetWrapWeights?: string;
};

/** Persistent configuration for a GPU cloth component. */
export type GPUClothComponentConfig = {
  version: 1;
  sourceId?: string;
  enabled: boolean;
  simulationMeshId: string;
  simulationMeshPath?: Array<{ name: string; sameNameIndex: number }>;
  gravity: [number, number, number];
  damping: number;
  dynamicFriction: number;
  staticFriction: number;
  stiffness: number;
  poseFollow: number;
  substeps: number;
  solverIterations: number;
  maxNeighbors: number;
  maxTrianglesPerVertex: number;
  workgroupSize: number;
  rebuildNormals: boolean;
  pinnedVertexWeights: string;
  wrapTargets: GPUClothWrapTargetConfig[];
  colliders: GPUClothColliderConfig[];
};

const DEFAULT_CONFIG: GPUClothComponentConfig = {
  version: 1,
  sourceId: '',
  enabled: true,
  simulationMeshId: '',
  gravity: [0, -9.8, 0],
  damping: 0.02,
  dynamicFriction: 0.15,
  staticFriction: 0.3,
  stiffness: 0.3,
  poseFollow: 0,
  substeps: 2,
  solverIterations: 5,
  maxNeighbors: 8,
  maxTrianglesPerVertex: 16,
  workgroupSize: 64,
  rebuildNormals: true,
  pinnedVertexWeights: '',
  wrapTargets: [],
  colliders: []
};

function finite(value: unknown, fallback: number) {
  const result = Number(value);
  return Number.isFinite(result) ? result : fallback;
}

function clamp(value: unknown, min: number, max: number, fallback: number) {
  return Math.min(Math.max(finite(value, fallback), min), max);
}

function vec3(value: unknown, fallback: [number, number, number]): [number, number, number] {
  const source = Array.isArray(value) ? value : fallback;
  return [finite(source[0], fallback[0]), finite(source[1], fallback[1]), finite(source[2], fallback[2])];
}

function cloneBindingData(value: GPUClothWrapBindingData): GPUClothWrapBindingData {
  return {
    version: 4,
    vertexCount: Math.max(0, finite(value?.vertexCount, 0) | 0),
    sourceVertexCount: Math.max(0, finite(value?.sourceVertexCount, 0) | 0),
    influenceCount: Math.max(0, finite(value?.influenceCount, 0) | 0),
    maxOffsetDistance: Math.max(0, finite(value?.maxOffsetDistance, 0)),
    sourceTriangleIndices: String(value?.sourceTriangleIndices ?? ''),
    sourceBarycentrics: String(value?.sourceBarycentrics ?? ''),
    targetLocalOffsets: String(value?.targetLocalOffsets ?? '')
  };
}

function normalizeNodePath(value: unknown) {
  return Array.isArray(value)
    ? value
        .filter((entry) => entry && typeof entry === 'object')
        .map((entry: any) => ({
          name: String(entry.name ?? ''),
          sameNameIndex: Math.max(0, Math.floor(Number(entry.sameNameIndex) || 0))
        }))
    : [];
}

function resolveMeshByReference(
  host: SceneNode,
  id: string,
  path: Array<{ name: string; sameNameIndex: number }> | undefined
) {
  const root = ((typeof (host as any)?.getPrefabNode === 'function' && (host as any).getPrefabNode()) ||
    host.scene?.rootNode ||
    host) as SceneNode;
  if (Array.isArray(path)) {
    let current: SceneNode | null = root;
    for (const segment of normalizeNodePath(path)) {
      if (!current) {
        break;
      }
      const matches: SceneNode[] = current.children.filter(
        (child) => child.name === segment.name
      ) as SceneNode[];
      current = matches[segment.sameNameIndex] ?? null;
      if (!current) break;
    }
    if (isMesh(current)) return current;
  }
  const candidate = host.findNodeById<SceneNode>(id) ?? root.findNodeById<SceneNode>(id);
  return isMesh(candidate) ? candidate : null;
}

/** Normalizes untrusted or older component data into the current schema. */
export function normalizeGPUClothComponentConfig(
  value?: Partial<GPUClothComponentConfig> | null
): GPUClothComponentConfig {
  const source = value ?? {};
  return {
    version: 1,
    sourceId: String(source.sourceId ?? ''),
    enabled: source.enabled !== false,
    simulationMeshId: String(source.simulationMeshId ?? ''),
    ...(Array.isArray(source.simulationMeshPath)
      ? { simulationMeshPath: normalizeNodePath(source.simulationMeshPath) }
      : {}),
    gravity: vec3(source.gravity, DEFAULT_CONFIG.gravity),
    damping: clamp(source.damping, 0, 1, DEFAULT_CONFIG.damping),
    dynamicFriction: clamp(source.dynamicFriction, 0, 1, DEFAULT_CONFIG.dynamicFriction),
    staticFriction: clamp(source.staticFriction, 0, 1, DEFAULT_CONFIG.staticFriction),
    stiffness: clamp(source.stiffness, 0, 1, DEFAULT_CONFIG.stiffness),
    poseFollow: clamp(source.poseFollow, 0, 1, DEFAULT_CONFIG.poseFollow),
    substeps: clamp(source.substeps, 1, 8, DEFAULT_CONFIG.substeps) | 0,
    solverIterations: Math.max(1, finite(source.solverIterations, DEFAULT_CONFIG.solverIterations) | 0),
    maxNeighbors: Math.max(1, finite(source.maxNeighbors, DEFAULT_CONFIG.maxNeighbors) | 0),
    maxTrianglesPerVertex: Math.max(
      1,
      finite(source.maxTrianglesPerVertex, DEFAULT_CONFIG.maxTrianglesPerVertex) | 0
    ),
    workgroupSize: clamp(source.workgroupSize, 1, 256, DEFAULT_CONFIG.workgroupSize) | 0,
    rebuildNormals: source.rebuildNormals !== false,
    pinnedVertexWeights: String(source.pinnedVertexWeights ?? ''),
    wrapTargets: (Array.isArray(source.wrapTargets) ? source.wrapTargets : [])
      .filter((entry) => !!entry?.meshId && !!entry.bindingData)
      .map((entry) => ({
        meshId: String(entry.meshId),
        ...(Array.isArray(entry.meshPath)
          ? { meshPath: normalizeNodePath(entry.meshPath) }
          : {}),
        bindingData: cloneBindingData(entry.bindingData),
        targetWrapWeights: String(entry.targetWrapWeights ?? '')
      })),
    colliders: (Array.isArray(source.colliders) ? source.colliders : []).map((entry) => ({
      type:
        entry?.type === 'capsule' || entry?.type === 'plane' || entry?.type === 'box'
          ? entry.type
          : 'sphere',
      enabled: entry?.enabled !== false,
      nodeId: String(entry?.nodeId ?? ''),
      offset: vec3(entry?.offset, [0, 0, 0]),
      endOffset: vec3(entry?.endOffset, [0, 0.2, 0]),
      radius: Math.max(0, finite(entry?.radius, 0.15)),
      normal: vec3(entry?.normal, [0, 1, 0]),
      size: vec3(entry?.size, [0.3, 0.3, 0.3])
    }))
  };
}

function isMesh(node: Nullable<SceneNode>): node is Mesh {
  return !!node?.isMesh?.() && !!(node as Mesh).primitive;
}

function parsePinnedWeights(source: string, vertexCount: number) {
  if (!source.trim() || vertexCount <= 0) {
    return undefined;
  }
  const result = new Float32Array(vertexCount);
  for (const token of source.split(',')) {
    const separator = token.indexOf(':');
    if (separator < 0) {
      continue;
    }
    const parsedIndex = Number(token.slice(0, separator).trim());
    const clothWeight = clamp(Number(token.slice(separator + 1).trim()), 0, 1, 1);
    if (!Number.isInteger(parsedIndex) || parsedIndex < 0 || parsedIndex >= vertexCount) {
      continue;
    }
    result[parsedIndex] = 1 - clothWeight;
  }
  return result;
}

function parseTargetWrapWeights(source: string, vertexCount: number) {
  if (!source.trim() || vertexCount <= 0) {
    return undefined;
  }
  const result = new Float32Array(vertexCount);
  result.fill(1);
  for (const token of source.split(',')) {
    const separator = token.indexOf(':');
    if (separator < 0) {
      continue;
    }
    const parsedIndex = Number(token.slice(0, separator).trim());
    if (!Number.isInteger(parsedIndex) || parsedIndex < 0 || parsedIndex >= vertexCount) {
      continue;
    }
    result[parsedIndex] = clamp(Number(token.slice(separator + 1).trim()), 0, 1, 1);
  }
  return result;
}

/**
 * Serializable owner for one GPU cloth simulation.
 *
 * The component stores only stable asset data. GPU buffers are rebuilt when its host enters a scene.
 */
export class GPUClothComponent extends Disposable {
  private _config: GPUClothComponentConfig;
  private _host: Nullable<SceneNode>;
  private _system: Nullable<GPUClothSystem>;
  private _generation: number;
  private _rebuildPromise: Nullable<Promise<void>>;
  private _disabledReason: Nullable<string>;
  private _simulationMesh: Nullable<Mesh>;

  constructor(config?: Partial<GPUClothComponentConfig> | null) {
    super();
    this._config = normalizeGPUClothComponentConfig(config);
    this._host = null;
    this._system = null;
    this._generation = 0;
    this._rebuildPromise = null;
    this._disabledReason = null;
    this._simulationMesh = null;
  }

  get config() {
    return normalizeGPUClothComponentConfig(this._config);
  }

  get host() {
    return this._host;
  }

  get system() {
    return this._system;
  }

  get disabledReason() {
    return this._disabledReason;
  }

  setConfig(config: Partial<GPUClothComponentConfig>) {
    this._config = normalizeGPUClothComponentConfig(config);
    return this.rebuild();
  }

  /** @internal */
  attach(host: SceneNode) {
    if (this._host === host) {
      return;
    }
    if (this._host) {
      throw new Error('GPU cloth component is already attached to another scene node.');
    }
    this._host = host;
    host.on('nodeattached', this._handleHierarchyChanged, this);
    host.on('noderemoved', this._handleHierarchyChanged, this);
    if (host.attached) {
      void this.rebuild();
    }
  }

  /** @internal */
  detach(host?: SceneNode) {
    if (!this._host || (host && this._host !== host)) {
      return;
    }
    this._host.off('nodeattached', this._handleHierarchyChanged, this);
    this._host.off('noderemoved', this._handleHierarchyChanged, this);
    this._host = null;
    this.releaseRuntime();
  }

  /** @internal */
  hostAttached() {
    if (this._host?.attached) {
      void this.rebuild();
    }
  }

  /** @internal */
  hostDetached() {
    this.releaseRuntime();
  }

  async rebuild() {
    const generation = ++this._generation;
    this.releaseSystem();
    const previous = this._rebuildPromise;
    const task = (async () => {
      if (previous) {
        await previous.catch(() => undefined);
      }
      const host = this._host;
      if (generation !== this._generation || !host?.attached || this.disposed) {
        return;
      }
      await this.createSystem(host, generation);
    })();
    this._rebuildPromise = task;
    try {
      await task;
    } finally {
      if (this._rebuildPromise === task) {
        this._rebuildPromise = null;
      }
    }
  }

  private async createSystem(host: SceneNode, generation: number) {
    const config = this._config;
    const simulationMesh = resolveMeshByReference(host, config.simulationMeshId, config.simulationMeshPath);
    if (!isMesh(simulationMesh)) {
      this._disabledReason = 'GPU cloth simulation mesh was not found.';
      return;
    }
    this.watchSimulationMesh(simulationMesh);
    const gravity = simulationMesh.invWorldMatrix.transformVectorAffine(
      new Vector3(config.gravity[0], config.gravity[1], config.gravity[2]),
      new Vector3()
    );
    let system: Nullable<GPUClothSystem> = null;
    try {
      system = await GPUClothSystem.createFromMesh(simulationMesh, {
        enabled: config.enabled,
        gravity,
        damping: config.damping,
        dynamicFriction: config.dynamicFriction,
        staticFriction: config.staticFriction,
        stiffness: config.stiffness,
        poseFollow: config.poseFollow,
        substeps: config.substeps,
        solverIterations: config.solverIterations,
        maxNeighbors: config.maxNeighbors,
        maxTrianglesPerVertex: config.maxTrianglesPerVertex,
        workgroupSize: config.workgroupSize,
        rebuildNormals: config.rebuildNormals,
        pinnedVertexWeights: parsePinnedWeights(
          config.pinnedVertexWeights,
          simulationMesh.primitive?.getNumVertices() ?? 0
        ),
        colliders: this.createColliders(host, config.colliders),
        autoUpdate: true
      });
      const targets = this.resolveWrapTargets(host, simulationMesh, config.wrapTargets);
      if (targets.length > 0) {
        await system.setWrapTargetsFromBindingData(targets);
      }
    } catch (err) {
      system?.dispose();
      if (generation === this._generation) {
        this._disabledReason = err instanceof Error ? err.message : String(err);
      }
      return;
    }
    if (generation !== this._generation || this.disposed || this._host !== host || !host.attached) {
      system.dispose();
      return;
    }
    this._system = system;
    this._disabledReason = system.disabledReason;
  }

  private createColliders(host: SceneNode, configs: GPUClothColliderConfig[]) {
    const result: SpringCollider[] = [];
    for (const config of configs) {
      const node = (config.nodeId ? host.findNodeById<SceneNode>(config.nodeId) : null) ?? host;
      const offset = vec3(config.offset, [0, 0, 0]);
      const endOffset = vec3(config.endOffset, [0, 0.2, 0]);
      const normal = vec3(config.normal, [0, 1, 0]);
      let collider: SpringCollider;
      if (config.type === 'capsule') {
        collider = createCapsuleCollider(
          new Vector3(offset[0], offset[1], offset[2]),
          new Vector3(endOffset[0], endOffset[1], endOffset[2]),
          Math.max(0, finite(config.radius, 0.15)),
          node
        );
      } else if (config.type === 'plane') {
        collider = createPlaneCollider(
          new Vector3(offset[0], offset[1], offset[2]),
          new Vector3(normal[0], normal[1], normal[2]),
          node
        );
      } else if (config.type === 'box') {
        const size = vec3(config.size, [0.3, 0.3, 0.3]);
        collider = createBoxCollider(
          new Vector3(offset[0], offset[1], offset[2]),
          new Vector3(Math.max(0.0001, size[0] * 0.5), Math.max(0.0001, size[1] * 0.5), Math.max(0.0001, size[2] * 0.5)),
          node
        );
      } else {
        collider = createSphereCollider(
          new Vector3(offset[0], offset[1], offset[2]),
          Math.max(0, finite(config.radius, 0.15)),
          node
        );
      }
      collider.enabled = config.enabled !== false;
      result.push(collider);
    }
    return result;
  }

  private resolveWrapTargets(host: SceneNode, simulationMesh: Mesh, configs: GPUClothWrapTargetConfig[]) {
    const result: GPUClothWrapBindingTarget[] = [];
    for (const config of configs) {
      const target = resolveMeshByReference(host, config.meshId, config.meshPath);
      if (isMesh(target) && target !== simulationMesh) {
        result.push({
          target,
          data: cloneBindingData(config.bindingData),
          targetWrapWeights: parseTargetWrapWeights(
            config.targetWrapWeights ?? '',
            target.primitive?.getNumVertices() ?? 0
          )
        });
      }
    }
    return result;
  }

  private watchSimulationMesh(mesh: Nullable<Mesh>) {
    if (this._simulationMesh === mesh) {
      return;
    }
    this._simulationMesh?.off('primitive_changed', this._handlePrimitiveChanged, this);
    this._simulationMesh = mesh;
    this._simulationMesh?.on('primitive_changed', this._handlePrimitiveChanged, this);
  }

  private releaseSystem() {
    this.watchSimulationMesh(null);
    this._system?.dispose();
    this._system = null;
  }

  private releaseRuntime() {
    this._generation++;
    this.releaseSystem();
  }

  private _handleHierarchyChanged() {
    void this.rebuild();
  }

  private _handlePrimitiveChanged() {
    void this.rebuild();
  }

  protected onDispose() {
    this.detach();
    super.onDispose();
  }
}
