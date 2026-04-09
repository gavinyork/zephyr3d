import { defineProps, type SerializableClass } from '../types';

export type ClothColliderType = 'sphere' | 'capsule';

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
    this.radius = 0.15;
  }
}

export class ClothScriptConfig {
  enabled: boolean;
  autoUpdate: boolean;
  damping: number;
  stiffness: number;
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
    this.damping = 0.995;
    this.stiffness = 0.3;
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
              labels: ['Sphere', 'Capsule'],
              values: ['sphere', 'capsule']
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
          get(this: ClothColliderConfig, value) {
            value.num[0] = this.radius;
          },
          set(this: ClothColliderConfig, value) {
            this.radius = value.num[0];
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
            this.damping = value.num[0];
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
            this.stiffness = value.num[0];
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
