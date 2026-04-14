import type { Mesh } from '../../../scene/mesh';
import type { SceneNode } from '../../../scene/scene_node';
import { createGPUClothWrapBindingData } from '../../../animation/cloth/gpu_cloth_system';
import { defineProps, type SerializableClass } from '../types';

export type ClothColliderType = 'sphere' | 'capsule' | 'plane';

const clothConfigHostMap = new WeakMap<ClothScriptConfig, SceneNode>();
const clothTargetHostMap = new WeakMap<ClothTargetMeshConfig, SceneNode>();
const clothTargetOwnerMap = new WeakMap<ClothTargetMeshConfig, ClothScriptConfig>();

function clamp01(value: number) {
  return Math.min(Math.max(value, 0), 1);
}

function normalizePlaneDirection(value: number) {
  return value < 0 ? -1 : 1;
}

function resolveClothHostScope(host: SceneNode) {
  return (
    (typeof (host as any)?.getPrefabNode === 'function' && (host as any).getPrefabNode()) ||
    host.scene?.rootNode ||
    host
  );
}

function resolveClothMeshById(host: SceneNode | null | undefined, meshId: string): Mesh | null {
  const id = String(meshId ?? '').trim();
  if (!host || !id) {
    return null;
  }
  const scope = resolveClothHostScope(host);
  const candidate = scope?.findNodeById?.(id);
  return candidate?.isMesh?.() && candidate.primitive ? (candidate as Mesh) : null;
}

function resolveClothMeshLabel(host: SceneNode | null | undefined, meshId: string) {
  const id = String(meshId ?? '').trim();
  if (!id) {
    return '';
  }
  const mesh = resolveClothMeshById(host, id);
  if (mesh) {
    const name = String(mesh.name ?? '').trim();
    return name || mesh.persistentId || id;
  }
  return `[Missing] ${id}`;
}

function getClothConfigHost(config: ClothScriptConfig) {
  return clothConfigHostMap.get(config) ?? null;
}

function getClothTargetHost(target: ClothTargetMeshConfig) {
  const owner = clothTargetOwnerMap.get(target);
  return clothTargetHostMap.get(target) ?? (owner ? clothConfigHostMap.get(owner) : null) ?? null;
}

function setClothTargetOwner(target: ClothTargetMeshConfig, owner: ClothScriptConfig, host?: SceneNode | null) {
  clothTargetOwnerMap.set(target, owner);
  if (host) {
    clothTargetHostMap.set(target, host);
  }
}

function clearClothTargetBinding(target: ClothTargetMeshConfig) {
  target.bindingData = '';
  target.bindingSignature = '';
}

function clearClothBindings(config: ClothScriptConfig) {
  for (const target of config.targetMeshes) {
    clearClothTargetBinding(target);
  }
}

function setClothBindingStatus(config: ClothScriptConfig, status: string) {
  config.bindingStatus = status;
}

function ensureDefaultTargetMeshEntry(config: ClothScriptConfig) {
  if (config.targetMeshes.length === 0) {
    const target = new ClothTargetMeshConfig();
    config.targetMeshes.push(target);
    setClothTargetOwner(target, config, getClothConfigHost(config));
  }
}

function invalidateClothBindings(config: ClothScriptConfig, status = 'Binding cache needs rebuild') {
  clearClothBindings(config);
  setClothBindingStatus(config, status);
}

async function bindClothTargetMeshes(config: ClothScriptConfig) {
  const host = getClothConfigHost(config);
  if (config.bindingInProgress) {
    return;
  }
  const simulationMesh =
    resolveClothMeshById(host, config.simulationMeshId) || (host?.isMesh?.() && host.primitive ? (host as Mesh) : null);
  if (!simulationMesh) {
    setClothBindingStatus(config, 'Set Simulation Mesh before binding.');
    return;
  }
  const targetEntries = config.targetMeshes.filter((entry) => String(entry.meshId ?? '').trim().length > 0);
  if (targetEntries.length === 0) {
    setClothBindingStatus(config, 'Add at least one Target Mesh before binding.');
    return;
  }
  config.bindingInProgress = true;
  setClothBindingStatus(config, 'Binding target meshes...');
  let successCount = 0;
  const failedTargets: string[] = [];
  try {
    for (const entry of targetEntries) {
      const targetMesh = resolveClothMeshById(getClothTargetHost(entry), entry.meshId);
      if (!targetMesh) {
        clearClothTargetBinding(entry);
        failedTargets.push(resolveClothMeshLabel(host, entry.meshId));
        continue;
      }
      if (targetMesh === simulationMesh) {
        clearClothTargetBinding(entry);
        failedTargets.push(resolveClothMeshLabel(host, entry.meshId));
        continue;
      }
      try {
        const data = await createGPUClothWrapBindingData(simulationMesh, targetMesh);
        entry.bindingData = JSON.stringify(data);
        entry.bindingSignature =
          `${data.version}:${data.vertexCount}:${data.sourceVertexCount}:${data.sourceIndexCount}:${data.hasNormals ? 1 : 0}`;
        successCount++;
      } catch (err) {
        clearClothTargetBinding(entry);
        failedTargets.push(
          `${resolveClothMeshLabel(host, entry.meshId)}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  } finally {
    config.bindingInProgress = false;
  }
  if (successCount > 0 && failedTargets.length === 0) {
    setClothBindingStatus(config, `Bound ${successCount} target mesh(es).`);
  } else if (successCount > 0) {
    setClothBindingStatus(
      config,
      `Bound ${successCount} target mesh(es), ${failedTargets.length} failed: ${failedTargets.join('; ')}`
    );
  } else {
    setClothBindingStatus(config, failedTargets[0] || 'Binding failed.');
  }
}

export function bindClothScriptConfigHost(config: ClothScriptConfig, host: SceneNode) {
  clothConfigHostMap.set(config, host);
  ensureDefaultTargetMeshEntry(config);
  for (const target of config.targetMeshes) {
    setClothTargetOwner(target, config, host);
  }
}

export class ClothColliderConfig {
  type: ClothColliderType;
  enabled: boolean;
  bone: string;
  offsetX: number;
  offsetY: number;
  offsetZ: number;
  endOffsetX: number;
  endOffsetY: number;
  endOffsetZ: number;
  normalX: number;
  normalY: number;
  normalZ: number;
  radius: number;

  constructor(type: ClothColliderType = 'sphere') {
    this.type = type;
    this.enabled = true;
    this.bone = '';
    this.offsetX = 0;
    this.offsetY = 0;
    this.offsetZ = 0;
    this.endOffsetX = 0;
    this.endOffsetY = 0.2;
    this.endOffsetZ = 0;
    this.normalX = 0;
    this.normalY = 1;
    this.normalZ = 0;
    this.radius = 0.15;
  }
}

export class ClothTargetMeshConfig {
  meshId: string;
  bindingData: string;
  bindingSignature: string;

  constructor() {
    this.meshId = '';
    this.bindingData = '';
    this.bindingSignature = '';
  }
}

export class ClothScriptConfig {
  enabled: boolean;
  autoUpdate: boolean;
  simulationMeshId: string;
  targetMeshes: ClothTargetMeshConfig[];
  bindingStatus: string;
  bindingInProgress: boolean;
  damping: number;
  dynamicFriction: number;
  staticFriction: number;
  stiffness: number;
  poseFollow: number;
  substeps: number;
  gravityX: number;
  gravityY: number;
  gravityZ: number;
  solverIterations: number;
  vertexPinWeightsByTarget: string;
  pinnedVertexIndicesByTarget: string;
  maxNeighbors: number;
  maxTrianglesPerVertex: number;
  workgroupSize: number;
  rebuildNormals: boolean;
  colliders: ClothColliderConfig[];

  constructor() {
    this.enabled = true;
    this.autoUpdate = true;
    this.simulationMeshId = '';
    this.targetMeshes = [new ClothTargetMeshConfig()];
    this.bindingStatus = 'Binding cache needs rebuild';
    this.bindingInProgress = false;
    this.damping = 0.02;
    this.dynamicFriction = 0.15;
    this.staticFriction = 0.3;
    this.stiffness = 0.3;
    this.poseFollow = 0;
    this.substeps = 2;
    this.gravityX = 0;
    this.gravityY = -9.8;
    this.gravityZ = 0;
    this.solverIterations = 5;
    this.vertexPinWeightsByTarget = '';
    this.pinnedVertexIndicesByTarget = '';
    this.maxNeighbors = 8;
    this.maxTrianglesPerVertex = 16;
    this.workgroupSize = 64;
    this.rebuildNormals = true;
    this.colliders = [];
  }
}

export function getClothColliderConfigClass(): SerializableClass {
  return {
    ctor: ClothColliderConfig,
    name: 'ClothColliderConfig',
    noTitle: true,
    createFunc() {
      return { obj: new ClothColliderConfig() };
    },
    getProps() {
      return defineProps([
        {
          name: 'Type',
          type: 'string',
          options: {
            group: 'Shape',
            enum: {
              labels: ['Sphere', 'Capsule', 'Plane'],
              values: ['sphere', 'capsule', 'plane']
            }
          },
          get(this: ClothColliderConfig, value) {
            value.str[0] = this.type;
          },
          set(this: ClothColliderConfig, value) {
            this.type = (value.str[0] as ClothColliderType) ?? 'sphere';
          }
        },
        {
          name: 'Enabled',
          type: 'bool',
          options: {
            group: 'General'
          },
          get(this: ClothColliderConfig, value) {
            value.bool[0] = this.enabled;
          },
          set(this: ClothColliderConfig, value) {
            this.enabled = !!value.bool[0];
          }
        },
        {
          name: 'Bone',
          type: 'string',
          options: {
            group: 'General'
          },
          get(this: ClothColliderConfig, value) {
            value.str[0] = this.bone;
          },
          set(this: ClothColliderConfig, value) {
            this.bone = value.str[0] ?? '';
          }
        },
        {
          name: 'Offset',
          type: 'vec3',
          options: {
            group: 'Shape'
          },
          isValid(this: ClothColliderConfig) {
            return this.type !== 'plane';
          },
          get(this: ClothColliderConfig, value) {
            value.num[0] = this.offsetX;
            value.num[1] = this.offsetY;
            value.num[2] = this.offsetZ;
          },
          set(this: ClothColliderConfig, value) {
            this.offsetX = value.num[0];
            this.offsetY = value.num[1];
            this.offsetZ = value.num[2];
          }
        },
        {
          name: 'EndOffset',
          type: 'vec3',
          options: {
            group: 'Shape'
          },
          isValid(this: ClothColliderConfig) {
            return this.type === 'capsule';
          },
          get(this: ClothColliderConfig, value) {
            value.num[0] = this.endOffsetX;
            value.num[1] = this.endOffsetY;
            value.num[2] = this.endOffsetZ;
          },
          set(this: ClothColliderConfig, value) {
            this.endOffsetX = value.num[0];
            this.endOffsetY = value.num[1];
            this.endOffsetZ = value.num[2];
          }
        },
        {
          name: 'Radius',
          type: 'float',
          options: {
            group: 'Shape',
            minValue: 0
          },
          isValid(this: ClothColliderConfig) {
            return this.type !== 'plane';
          },
          get(this: ClothColliderConfig, value) {
            value.num[0] = this.radius;
          },
          set(this: ClothColliderConfig, value) {
            this.radius = value.num[0];
          }
        },
        {
          name: 'Normal',
          type: 'float',
          options: {
            group: 'Shape',
            minValue: -1,
            maxValue: 1
          },
          isValid(this: ClothColliderConfig) {
            return this.type === 'plane';
          },
          get(this: ClothColliderConfig, value) {
            value.num[0] = this.normalY;
          },
          set(this: ClothColliderConfig, value) {
            this.normalX = 0;
            this.normalY = normalizePlaneDirection(value.num[0]);
            this.normalZ = 0;
          }
        }
      ]);
    }
  };
}

export function getClothTargetMeshConfigClass(): SerializableClass {
  return {
    ctor: ClothTargetMeshConfig,
    name: 'ClothTargetMeshConfig',
    noTitle: true,
    createFunc() {
      return { obj: new ClothTargetMeshConfig() };
    },
    getProps() {
      return defineProps([
        {
          name: 'TargetMesh',
          type: 'string',
          options: {
            sceneNode: {
              kind: 'mesh'
            }
          },
          isPersistent() {
            return false;
          },
          get(this: ClothTargetMeshConfig, value) {
            value.str[0] = resolveClothMeshLabel(getClothTargetHost(this), this.meshId);
          },
          set(this: ClothTargetMeshConfig, value) {
            const nextId = String(value.str[0] ?? '').trim();
            if (this.meshId !== nextId) {
              this.meshId = nextId;
              clearClothTargetBinding(this);
              const owner = clothTargetOwnerMap.get(this);
              if (owner) {
                setClothBindingStatus(owner, 'Binding cache needs rebuild');
              }
            }
          }
        },
        {
          name: 'MeshId',
          type: 'string',
          isHidden() {
            return true;
          },
          get(this: ClothTargetMeshConfig, value) {
            value.str[0] = this.meshId;
          },
          set(this: ClothTargetMeshConfig, value) {
            this.meshId = value.str[0] ?? '';
          }
        },
        {
          name: 'BindingData',
          type: 'string',
          isHidden() {
            return true;
          },
          get(this: ClothTargetMeshConfig, value) {
            value.str[0] = this.bindingData;
          },
          set(this: ClothTargetMeshConfig, value) {
            this.bindingData = value.str[0] ?? '';
          }
        },
        {
          name: 'BindingSignature',
          type: 'string',
          isHidden() {
            return true;
          },
          get(this: ClothTargetMeshConfig, value) {
            value.str[0] = this.bindingSignature;
          },
          set(this: ClothTargetMeshConfig, value) {
            this.bindingSignature = value.str[0] ?? '';
          }
        }
      ]);
    }
  };
}

export function getClothScriptConfigClass(): SerializableClass {
  return {
    ctor: ClothScriptConfig,
    name: 'ClothScriptConfig',
    noTitle: true,
    createFunc() {
      return { obj: new ClothScriptConfig() };
    },
    getProps() {
      return defineProps([
        {
          name: 'Enabled',
          type: 'bool',
          options: {
            group: 'General'
          },
          get(this: ClothScriptConfig, value) {
            value.bool[0] = this.enabled;
          },
          set(this: ClothScriptConfig, value) {
            this.enabled = !!value.bool[0];
          }
        },
        {
          name: 'AutoUpdate',
          type: 'bool',
          options: {
            group: 'General'
          },
          get(this: ClothScriptConfig, value) {
            value.bool[0] = this.autoUpdate;
          },
          set(this: ClothScriptConfig, value) {
            this.autoUpdate = !!value.bool[0];
          }
        },
        {
          name: 'SimulationMesh',
          type: 'string',
          options: {
            group: 'General',
            sceneNode: {
              kind: 'mesh'
            }
          },
          isPersistent() {
            return false;
          },
          get(this: ClothScriptConfig, value) {
            value.str[0] = resolveClothMeshLabel(getClothConfigHost(this), this.simulationMeshId);
          },
          set(this: ClothScriptConfig, value) {
            const nextId = String(value.str[0] ?? '').trim();
            if (this.simulationMeshId !== nextId) {
              this.simulationMeshId = nextId;
              invalidateClothBindings(this);
            }
          }
        },
        {
          name: 'SimulationMeshId',
          type: 'string',
          isHidden() {
            return true;
          },
          get(this: ClothScriptConfig, value) {
            value.str[0] = this.simulationMeshId;
          },
          set(this: ClothScriptConfig, value) {
            this.simulationMeshId = value.str[0] ?? '';
          }
        },
        {
          name: 'TargetMesh',
          type: 'object_array',
          options: {
            group: 'Binding',
            objectTypes: [ClothTargetMeshConfig],
            inlineObjectArray: true
          },
          get(this: ClothScriptConfig, value) {
            ensureDefaultTargetMeshEntry(this);
            value.object = this.targetMeshes;
          },
          set(this: ClothScriptConfig, value) {
            this.targetMeshes = ((value.object ?? []) as ClothTargetMeshConfig[]).filter(
              (entry): entry is ClothTargetMeshConfig => entry instanceof ClothTargetMeshConfig
            );
            ensureDefaultTargetMeshEntry(this);
            const host = getClothConfigHost(this);
            for (const entry of this.targetMeshes) {
              setClothTargetOwner(entry, this, host);
            }
          },
          add(this: ClothScriptConfig, value, index) {
            const target = (value.object?.[0] as ClothTargetMeshConfig) ?? new ClothTargetMeshConfig();
            setClothTargetOwner(target, this, getClothConfigHost(this));
            this.targetMeshes.splice(index ?? this.targetMeshes.length, 0, target);
            setClothBindingStatus(this, 'Binding cache needs rebuild');
          },
          delete(this: ClothScriptConfig, index) {
            this.targetMeshes.splice(index, 1);
            ensureDefaultTargetMeshEntry(this);
            setClothBindingStatus(this, 'Binding cache needs rebuild');
          },
          create() {
            return new ClothTargetMeshConfig();
          }
        },
        {
          name: 'BindingStatus',
          type: 'string',
          readonly: true,
          options: {
            group: 'Binding'
          },
          isPersistent() {
            return false;
          },
          get(this: ClothScriptConfig, value) {
            value.str[0] = this.bindingStatus;
          }
        },
        {
          name: 'Binding',
          type: 'command',
          options: {
            group: 'Binding'
          },
          get(this: ClothScriptConfig, value) {
            value.str[0] = this.bindingInProgress ? 'Binding...' : 'Bind';
            value.str[1] = 'Clear';
          },
          command(this: ClothScriptConfig, index) {
            if (index === 0) {
              if (!this.bindingInProgress) {
                void bindClothTargetMeshes(this);
              }
            } else {
              clearClothBindings(this);
              setClothBindingStatus(this, 'Binding cache cleared.');
            }
            return true;
          }
        },
        {
          name: 'VertexPinWeightsByTarget',
          type: 'string',
          isHidden() {
            return true;
          },
          get(this: ClothScriptConfig, value) {
            value.str[0] = this.vertexPinWeightsByTarget;
          },
          set(this: ClothScriptConfig, value) {
            this.vertexPinWeightsByTarget = value.str[0] ?? '';
          }
        },
        {
          name: 'PinnedVertexIndicesByTarget',
          type: 'string',
          isHidden() {
            return true;
          },
          get(this: ClothScriptConfig, value) {
            value.str[0] = this.pinnedVertexIndicesByTarget;
          },
          set(this: ClothScriptConfig, value) {
            this.pinnedVertexIndicesByTarget = value.str[0] ?? '';
          }
        },
        {
          name: 'Gravity',
          type: 'vec3',
          options: {
            group: 'Simulation'
          },
          get(this: ClothScriptConfig, value) {
            value.num[0] = this.gravityX;
            value.num[1] = this.gravityY;
            value.num[2] = this.gravityZ;
          },
          set(this: ClothScriptConfig, value) {
            this.gravityX = value.num[0];
            this.gravityY = value.num[1];
            this.gravityZ = value.num[2];
          }
        },
        {
          name: 'Damping',
          type: 'float',
          options: {
            group: 'Simulation',
            minValue: 0,
            maxValue: 1
          },
          get(this: ClothScriptConfig, value) {
            value.num[0] = this.damping;
          },
          set(this: ClothScriptConfig, value) {
            this.damping = clamp01(value.num[0]);
          }
        },
        {
          name: 'Stiffness',
          type: 'float',
          options: {
            group: 'Simulation',
            minValue: 0,
            maxValue: 1
          },
          get(this: ClothScriptConfig, value) {
            value.num[0] = this.stiffness;
          },
          set(this: ClothScriptConfig, value) {
            this.stiffness = clamp01(value.num[0]);
          }
        },
        {
          name: 'DynamicFriction',
          type: 'float',
          options: {
            group: 'Simulation',
            minValue: 0,
            maxValue: 1
          },
          get(this: ClothScriptConfig, value) {
            value.num[0] = this.dynamicFriction;
          },
          set(this: ClothScriptConfig, value) {
            this.dynamicFriction = clamp01(value.num[0]);
          }
        },
        {
          name: 'PoseFollow',
          type: 'float',
          options: {
            group: 'PoseFollow',
            minValue: 0,
            maxValue: 1
          },
          get(this: ClothScriptConfig, value) {
            value.num[0] = this.poseFollow;
          },
          set(this: ClothScriptConfig, value) {
            this.poseFollow = clamp01(value.num[0]);
          }
        },
        {
          name: 'StaticFriction',
          type: 'float',
          options: {
            group: 'Simulation',
            minValue: 0,
            maxValue: 1
          },
          get(this: ClothScriptConfig, value) {
            value.num[0] = this.staticFriction;
          },
          set(this: ClothScriptConfig, value) {
            this.staticFriction = clamp01(value.num[0]);
          }
        },
        {
          name: 'SolverIterations',
          type: 'int',
          options: {
            group: 'Simulation',
            minValue: 1,
            maxValue: 32
          },
          get(this: ClothScriptConfig, value) {
            value.num[0] = this.solverIterations;
          },
          set(this: ClothScriptConfig, value) {
            this.solverIterations = value.num[0];
          }
        },
        {
          name: 'Substeps',
          type: 'int',
          options: {
            group: 'Simulation',
            minValue: 1,
            maxValue: 8
          },
          get(this: ClothScriptConfig, value) {
            value.num[0] = this.substeps;
          },
          set(this: ClothScriptConfig, value) {
            this.substeps = Math.max(1, Math.min(8, value.num[0] | 0));
          }
        },
        {
          name: 'MaxNeighbors',
          type: 'int',
          options: {
            group: 'Advanced',
            minValue: 1,
            maxValue: 64
          },
          get(this: ClothScriptConfig, value) {
            value.num[0] = this.maxNeighbors;
          },
          set(this: ClothScriptConfig, value) {
            this.maxNeighbors = value.num[0];
          }
        },
        {
          name: 'MaxTrianglesPerVertex',
          type: 'int',
          options: {
            group: 'Advanced',
            minValue: 1,
            maxValue: 64
          },
          get(this: ClothScriptConfig, value) {
            value.num[0] = this.maxTrianglesPerVertex;
          },
          set(this: ClothScriptConfig, value) {
            this.maxTrianglesPerVertex = value.num[0];
          }
        },
        {
          name: 'WorkgroupSize',
          type: 'int',
          options: {
            group: 'Advanced',
            minValue: 1,
            maxValue: 256
          },
          get(this: ClothScriptConfig, value) {
            value.num[0] = this.workgroupSize;
          },
          set(this: ClothScriptConfig, value) {
            this.workgroupSize = value.num[0];
          }
        },
        {
          name: 'RebuildNormals',
          type: 'bool',
          options: {
            group: 'Advanced'
          },
          get(this: ClothScriptConfig, value) {
            value.bool[0] = this.rebuildNormals;
          },
          set(this: ClothScriptConfig, value) {
            this.rebuildNormals = !!value.bool[0];
          }
        },
        {
          name: 'Colliders',
          type: 'object_array',
          options: {
            group: 'Collider',
            objectTypes: [ClothColliderConfig]
          },
          get(this: ClothScriptConfig, value) {
            value.object = this.colliders;
          },
          set(this: ClothScriptConfig, value) {
            this.colliders = (value.object ?? []) as ClothColliderConfig[];
          },
          add(this: ClothScriptConfig, value, index) {
            this.colliders.splice(index ?? this.colliders.length, 0, value.object![0] as ClothColliderConfig);
          },
          delete(this: ClothScriptConfig, index) {
            this.colliders.splice(index, 1);
          },
          create() {
            return new ClothColliderConfig();
          }
        }
      ]);
    }
  };
}
