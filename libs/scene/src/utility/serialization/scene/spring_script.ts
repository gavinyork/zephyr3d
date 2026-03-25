import { defineProps, type SerializableClass } from '../types';

export class SpringBoneChainConfig {
  startBone: string;
  endBone: string;
  constructor(startBone = '', endBone = '') {
    this.startBone = startBone;
    this.endBone = endBone;
  }
}

export type SpringColliderType = 'sphere' | 'capsule' | 'plane';

export class SpringColliderConfig {
  type: SpringColliderType;
  enabled: boolean;
  bone: string;
  offsetX: number;
  offsetY: number;
  offsetZ: number;
  endOffsetX: number;
  endOffsetY: number;
  endOffsetZ: number;
  radius: number;
  normalX: number;
  normalY: number;
  normalZ: number;

  constructor(type: SpringColliderType = 'sphere') {
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
    this.normalX = 0;
    this.normalY = 1;
    this.normalZ = 0;
  }
}

export class SpringScriptConfig {
  enabled: boolean;
  chainDamping: number;
  chainStiffness: number;
  gravityX: number;
  gravityY: number;
  gravityZ: number;
  iterations: number;
  enableInertialForces: boolean;
  centrifugalScale: number;
  coriolisScale: number;
  solver: 'xpbd' | 'verlet';
  poseFollow: number;
  poseFollowRoot: number;
  poseFollowTip: number;
  poseFollowExponent: number;
  maxPoseOffset: number;
  maxPoseOffsetRoot: number;
  maxPoseOffsetTip: number;
  // legacy single sphere collider fields (kept for backward compatibility)
  colliderOffsetX: number;
  colliderOffsetY: number;
  colliderOffsetZ: number;
  colliderRadius: number;
  modifierWeight: number;
  chains: SpringBoneChainConfig[];
  colliders: SpringColliderConfig[];
  constructor() {
    this.enabled = true;
    this.chainDamping = 0.9;
    this.chainStiffness = 0.82;
    this.gravityX = 0;
    this.gravityY = -9.8;
    this.gravityZ = 0;
    this.iterations = 6;
    this.enableInertialForces = true;
    this.centrifugalScale = 2;
    this.coriolisScale = 1;
    this.solver = 'xpbd';
    this.poseFollow = 0.3;
    this.poseFollowRoot = 0.15;
    this.poseFollowTip = 0.05;
    this.poseFollowExponent = 1.6;
    this.maxPoseOffset = 0.3;
    this.maxPoseOffsetRoot = 0.2;
    this.maxPoseOffsetTip = 0.4;
    this.colliderOffsetX = 0;
    this.colliderOffsetY = 1.5;
    this.colliderOffsetZ = 0;
    this.colliderRadius = 0.15;
    this.modifierWeight = 1;
    this.chains = defaultSpringChains();
    this.colliders = [];
  }
}

export function defaultSpringChains() {
  return [
    new SpringBoneChainConfig('joint2', 'joint11'),
    new SpringBoneChainConfig('joint13', 'joint22'),
    new SpringBoneChainConfig('joint24', 'joint34'),
    new SpringBoneChainConfig('joint36', 'joint44'),
    new SpringBoneChainConfig('joint58', 'joint67'),
    new SpringBoneChainConfig('joint69', 'joint76'),
    new SpringBoneChainConfig('joint78', 'joint88'),
    new SpringBoneChainConfig('joint101', 'joint109'),
    new SpringBoneChainConfig('joint111', 'joint119'),
    new SpringBoneChainConfig('joint121', 'joint130'),
    new SpringBoneChainConfig('joint132', 'joint138')
  ];
}

export function getSpringBoneChainConfigClass(): SerializableClass {
  return {
    ctor: SpringBoneChainConfig,
    name: 'SpringBoneChain',
    noTitle: true,
    createFunc() {
      return { obj: new SpringBoneChainConfig() };
    },
    getProps() {
      return defineProps([
        {
          name: 'StartBone',
          type: 'string',
          options: {
            label: 'Start'
          },
          get(this: SpringBoneChainConfig, value) {
            value.str[0] = this.startBone;
          },
          set(this: SpringBoneChainConfig, value) {
            this.startBone = value.str[0] ?? '';
          }
        },
        {
          name: 'EndBone',
          type: 'string',
          options: {
            label: 'End'
          },
          get(this: SpringBoneChainConfig, value) {
            value.str[0] = this.endBone;
          },
          set(this: SpringBoneChainConfig, value) {
            this.endBone = value.str[0] ?? '';
          }
        }
      ]);
    }
  };
}

export function getSpringColliderConfigClass(): SerializableClass {
  return {
    ctor: SpringColliderConfig,
    name: 'SpringColliderConfig',
    noTitle: true,
    createFunc() {
      return { obj: new SpringColliderConfig() };
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
          get(this: SpringColliderConfig, value) {
            value.str[0] = this.type;
          },
          set(this: SpringColliderConfig, value) {
            this.type = (value.str[0] as SpringColliderType) ?? 'sphere';
          }
        },
        {
          name: 'Enabled',
          type: 'bool',
          options: {
            group: 'General'
          },
          get(this: SpringColliderConfig, value) {
            value.bool[0] = this.enabled;
          },
          set(this: SpringColliderConfig, value) {
            this.enabled = !!value.bool[0];
          }
        },
        {
          name: 'Bone',
          type: 'string',
          options: {
            group: 'General'
          },
          get(this: SpringColliderConfig, value) {
            value.str[0] = this.bone;
          },
          set(this: SpringColliderConfig, value) {
            this.bone = value.str[0] ?? '';
          }
        },
        {
          name: 'Offset',
          type: 'vec3',
          options: {
            group: 'Shape'
          },
          get(this: SpringColliderConfig, value) {
            value.num[0] = this.offsetX;
            value.num[1] = this.offsetY;
            value.num[2] = this.offsetZ;
          },
          set(this: SpringColliderConfig, value) {
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
          isValid(this: SpringColliderConfig) {
            return this.type === 'capsule';
          },
          get(this: SpringColliderConfig, value) {
            value.num[0] = this.endOffsetX;
            value.num[1] = this.endOffsetY;
            value.num[2] = this.endOffsetZ;
          },
          set(this: SpringColliderConfig, value) {
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
          isValid(this: SpringColliderConfig) {
            return this.type === 'sphere' || this.type === 'capsule';
          },
          get(this: SpringColliderConfig, value) {
            value.num[0] = this.radius;
          },
          set(this: SpringColliderConfig, value) {
            this.radius = value.num[0];
          }
        },
        {
          name: 'Normal',
          type: 'vec3',
          options: {
            group: 'Shape'
          },
          isValid(this: SpringColliderConfig) {
            return this.type === 'plane';
          },
          get(this: SpringColliderConfig, value) {
            value.num[0] = this.normalX;
            value.num[1] = this.normalY;
            value.num[2] = this.normalZ;
          },
          set(this: SpringColliderConfig, value) {
            this.normalX = value.num[0];
            this.normalY = value.num[1];
            this.normalZ = value.num[2];
          }
        }
      ]);
    }
  };
}

export function getSpringScriptConfigClass(): SerializableClass {
  return {
    ctor: SpringScriptConfig,
    name: 'SpringScriptConfig',
    noTitle: true,
    createFunc() {
      return { obj: new SpringScriptConfig() };
    },
    getProps() {
      return defineProps([
        {
          name: 'Enabled',
          type: 'bool',
          options: {
            group: 'General'
          },
          get(this: SpringScriptConfig, value) {
            value.bool[0] = this.enabled;
          },
          set(this: SpringScriptConfig, value) {
            this.enabled = !!value.bool[0];
          }
        },
        {
          name: 'ModifierWeight',
          type: 'float',
          options: {
            group: 'General',
            minValue: 0,
            maxValue: 1
          },
          get(this: SpringScriptConfig, value) {
            value.num[0] = this.modifierWeight;
          },
          set(this: SpringScriptConfig, value) {
            this.modifierWeight = value.num[0];
          }
        },
        {
          name: 'Damping',
          type: 'float',
          options: {
            group: 'Chain',
            minValue: 0,
            maxValue: 1
          },
          get(this: SpringScriptConfig, value) {
            value.num[0] = this.chainDamping;
          },
          set(this: SpringScriptConfig, value) {
            this.chainDamping = value.num[0];
          }
        },
        {
          name: 'Stiffness',
          type: 'float',
          options: {
            group: 'Chain',
            minValue: 0,
            maxValue: 1
          },
          get(this: SpringScriptConfig, value) {
            value.num[0] = this.chainStiffness;
          },
          set(this: SpringScriptConfig, value) {
            this.chainStiffness = value.num[0];
          }
        },
        {
          name: 'BoneChains',
          type: 'object_array',
          options: {
            group: 'Chain',
            objectTypes: [SpringBoneChainConfig]
          },
          get(this: SpringScriptConfig, value) {
            value.object = this.chains;
          },
          set(this: SpringScriptConfig, value) {
            this.chains = (value.object ?? []) as SpringBoneChainConfig[];
          },
          add(this: SpringScriptConfig, value, index) {
            this.chains.splice(index ?? this.chains.length, 0, value.object![0] as SpringBoneChainConfig);
          },
          delete(this: SpringScriptConfig, index) {
            this.chains.splice(index, 1);
          },
          create() {
            return new SpringBoneChainConfig();
          }
        },
        {
          name: 'Gravity',
          type: 'vec3',
          options: {
            group: 'Simulation'
          },
          get(this: SpringScriptConfig, value) {
            value.num[0] = this.gravityX;
            value.num[1] = this.gravityY;
            value.num[2] = this.gravityZ;
          },
          set(this: SpringScriptConfig, value) {
            this.gravityX = value.num[0];
            this.gravityY = value.num[1];
            this.gravityZ = value.num[2];
          }
        },
        {
          name: 'Iterations',
          type: 'int',
          options: {
            group: 'Simulation',
            minValue: 1,
            maxValue: 32
          },
          get(this: SpringScriptConfig, value) {
            value.num[0] = this.iterations;
          },
          set(this: SpringScriptConfig, value) {
            this.iterations = value.num[0];
          }
        },
        {
          name: 'EnableInertialForces',
          type: 'bool',
          options: {
            group: 'Simulation'
          },
          get(this: SpringScriptConfig, value) {
            value.bool[0] = this.enableInertialForces;
          },
          set(this: SpringScriptConfig, value) {
            this.enableInertialForces = !!value.bool[0];
          }
        },
        {
          name: 'CentrifugalScale',
          type: 'float',
          options: {
            group: 'Simulation'
          },
          get(this: SpringScriptConfig, value) {
            value.num[0] = this.centrifugalScale;
          },
          set(this: SpringScriptConfig, value) {
            this.centrifugalScale = value.num[0];
          }
        },
        {
          name: 'CoriolisScale',
          type: 'float',
          options: {
            group: 'Simulation'
          },
          get(this: SpringScriptConfig, value) {
            value.num[0] = this.coriolisScale;
          },
          set(this: SpringScriptConfig, value) {
            this.coriolisScale = value.num[0];
          }
        },
        {
          name: 'Solver',
          type: 'string',
          options: {
            group: 'Simulation',
            enum: {
              labels: ['XPBD', 'Verlet'],
              values: ['xpbd', 'verlet']
            }
          },
          get(this: SpringScriptConfig, value) {
            value.str[0] = this.solver;
          },
          set(this: SpringScriptConfig, value) {
            this.solver = (value.str[0] as 'xpbd' | 'verlet') ?? 'xpbd';
          }
        },
        {
          name: 'PoseFollow',
          type: 'float',
          options: {
            group: 'PoseFollow'
          },
          get(this: SpringScriptConfig, value) {
            value.num[0] = this.poseFollow;
          },
          set(this: SpringScriptConfig, value) {
            this.poseFollow = value.num[0];
          }
        },
        {
          name: 'PoseFollowRoot',
          type: 'float',
          options: {
            group: 'PoseFollow'
          },
          get(this: SpringScriptConfig, value) {
            value.num[0] = this.poseFollowRoot;
          },
          set(this: SpringScriptConfig, value) {
            this.poseFollowRoot = value.num[0];
          }
        },
        {
          name: 'PoseFollowTip',
          type: 'float',
          options: {
            group: 'PoseFollow'
          },
          get(this: SpringScriptConfig, value) {
            value.num[0] = this.poseFollowTip;
          },
          set(this: SpringScriptConfig, value) {
            this.poseFollowTip = value.num[0];
          }
        },
        {
          name: 'PoseFollowExponent',
          type: 'float',
          options: {
            group: 'PoseFollow'
          },
          get(this: SpringScriptConfig, value) {
            value.num[0] = this.poseFollowExponent;
          },
          set(this: SpringScriptConfig, value) {
            this.poseFollowExponent = value.num[0];
          }
        },
        {
          name: 'MaxPoseOffset',
          type: 'float',
          options: {
            group: 'PoseFollow'
          },
          get(this: SpringScriptConfig, value) {
            value.num[0] = this.maxPoseOffset;
          },
          set(this: SpringScriptConfig, value) {
            this.maxPoseOffset = value.num[0];
          }
        },
        {
          name: 'MaxPoseOffsetRoot',
          type: 'float',
          options: {
            group: 'PoseFollow'
          },
          get(this: SpringScriptConfig, value) {
            value.num[0] = this.maxPoseOffsetRoot;
          },
          set(this: SpringScriptConfig, value) {
            this.maxPoseOffsetRoot = value.num[0];
          }
        },
        {
          name: 'MaxPoseOffsetTip',
          type: 'float',
          options: {
            group: 'PoseFollow'
          },
          get(this: SpringScriptConfig, value) {
            value.num[0] = this.maxPoseOffsetTip;
          },
          set(this: SpringScriptConfig, value) {
            this.maxPoseOffsetTip = value.num[0];
          }
        },
        {
          name: 'Colliders',
          type: 'object_array',
          options: {
            group: 'Collider',
            objectTypes: [SpringColliderConfig]
          },
          get(this: SpringScriptConfig, value) {
            value.object = this.colliders;
          },
          set(this: SpringScriptConfig, value) {
            this.colliders = (value.object ?? []) as SpringColliderConfig[];
          },
          add(this: SpringScriptConfig, value, index) {
            this.colliders.splice(index ?? this.colliders.length, 0, value.object![0] as SpringColliderConfig);
          },
          delete(this: SpringScriptConfig, index) {
            this.colliders.splice(index, 1);
          },
          create() {
            return new SpringColliderConfig();
          }
        },
        {
          name: 'ColliderOffset',
          type: 'vec3',
          isHidden() {
            return true;
          },
          get(this: SpringScriptConfig, value) {
            value.num[0] = this.colliderOffsetX;
            value.num[1] = this.colliderOffsetY;
            value.num[2] = this.colliderOffsetZ;
          },
          set(this: SpringScriptConfig, value) {
            this.colliderOffsetX = value.num[0];
            this.colliderOffsetY = value.num[1];
            this.colliderOffsetZ = value.num[2];
          }
        },
        {
          name: 'ColliderRadius',
          type: 'float',
          isHidden() {
            return true;
          },
          get(this: SpringScriptConfig, value) {
            value.num[0] = this.colliderRadius;
          },
          set(this: SpringScriptConfig, value) {
            this.colliderRadius = value.num[0];
          }
        }
      ]);
    }
  };
}
