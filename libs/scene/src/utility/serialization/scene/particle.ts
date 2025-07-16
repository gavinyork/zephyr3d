import { GraphNode, type EmitterBehavior, type EmitterShape } from '../../../scene';
import { SceneNode } from '../../../scene/scene_node';
import { ParticleSystem } from '../../../scene/particlesys';
import type { SerializableClass } from '../types';
import type { NodeHierarchy } from './node';
import { ParticleMaterial } from '../../../material';

/** @internal */
export function getParticleNodeClass(): SerializableClass {
  return {
    ctor: ParticleSystem,
    parent: GraphNode,
    createFunc(ctx: NodeHierarchy | SceneNode) {
      const node = new ParticleSystem(ctx.scene);
      if (ctx instanceof SceneNode) {
        node.parent = ctx;
      }
      return { obj: node };
    },
    getProps() {
      return [
        {
          name: 'WorldSpace',
          type: 'bool',
          default: true,
          get(this: ParticleSystem, value) {
            value.bool[0] = this.worldSpace;
          },
          set(this: ParticleSystem, value) {
            this.worldSpace = value.bool[0];
          }
        },
        {
          name: 'MaxParticleCount',
          type: 'int',
          default: 100,
          get(this: ParticleSystem, value) {
            value.num[0] = this.maxParticleCount;
          },
          set(this: ParticleSystem, value) {
            this.maxParticleCount = value.num[0];
          }
        },
        {
          name: 'EmitInterval',
          type: 'int',
          default: 100,
          get(this: ParticleSystem, value) {
            value.num[0] = this.emitInterval;
          },
          set(this: ParticleSystem, value) {
            this.emitInterval = value.num[0];
          }
        },
        {
          name: 'EmitCount',
          type: 'int',
          default: 1,
          get(this: ParticleSystem, value) {
            value.num[0] = this.emitCount;
          },
          set(this: ParticleSystem, value) {
            this.emitCount = value.num[0];
          }
        },
        {
          name: 'Gravity',
          type: 'vec3',
          animatable: true,
          default: [0, 0, 0],
          get(this: ParticleSystem, value) {
            const gravity = this.gravity;
            value.num[0] = gravity.x;
            value.num[1] = gravity.y;
            value.num[2] = gravity.z;
          },
          set(this: ParticleSystem, value) {
            this.gravity.setXYZ(value.num[0], value.num[1], value.num[2]);
          }
        },
        {
          name: 'Wind',
          type: 'vec3',
          animatable: true,
          default: [0, 0, 0],
          get(this: ParticleSystem, value) {
            const wind = this.wind;
            value.num[0] = wind.x;
            value.num[1] = wind.y;
            value.num[2] = wind.z;
          },
          set(this: ParticleSystem, value) {
            this.wind.setXYZ(value.num[0], value.num[1], value.num[2]);
          }
        },
        {
          name: 'Scalar',
          animatable: true,
          type: 'float',
          default: 1,
          get(this: ParticleSystem, value) {
            value.num[0] = this.scalar;
          },
          set(this: ParticleSystem, value) {
            this.scalar = value.num[0];
          }
        },
        {
          name: 'Aspect',
          animatable: true,
          type: 'float',
          default: 1,
          get(this: ParticleSystem, value) {
            value.num[0] = this.aspect;
          },
          set(this: ParticleSystem, value) {
            this.aspect = value.num[0];
          }
        },
        {
          name: 'AirResistence',
          type: 'bool',
          default: false,
          get(this: ParticleSystem, value) {
            value.bool[0] = this.airResistence;
          },
          set(this: ParticleSystem, value) {
            this.airResistence = value.bool[0];
          }
        },
        {
          name: 'JitterSpeed',
          type: 'float',
          animatable: true,
          default: 1,
          get(this: ParticleSystem, value) {
            value.num[0] = this.jitterSpeed;
          },
          set(this: ParticleSystem, value) {
            this.jitterSpeed = value.num[0];
          }
        },
        {
          name: 'JitterPower',
          type: 'float',
          animatable: true,
          default: 0,
          get(this: ParticleSystem, value) {
            value.num[0] = this.jitterPower;
          },
          set(this: ParticleSystem, value) {
            this.jitterPower = value.num[0];
          }
        },
        {
          name: 'EmitterShape',
          type: 'string',
          enum: {
            labels: ['Point', 'Sphere', 'Box', 'Cylinder', 'Cone'],
            values: ['point', 'sphere', 'box', 'cylinder', 'cone']
          },
          default: 'point',
          get(this: ParticleSystem, value) {
            value.str[0] = this.emitterShape;
          },
          set(this: ParticleSystem, value) {
            this.emitterShape = value.str[0] as EmitterShape;
          }
        },
        {
          name: 'EmitterBehavior',
          type: 'string',
          enum: {
            labels: ['Surface', 'Volume'],
            values: ['surface', 'volume']
          },
          default: 'surface',
          get(this: ParticleSystem, value) {
            value.str[0] = this.emitterBehavior;
          },
          set(this: ParticleSystem, value) {
            this.emitterBehavior = value.str[0] as EmitterBehavior;
          }
        },
        {
          name: 'Directional',
          type: 'bool',
          default: false,
          get(this: ParticleSystem, value) {
            value.bool[0] = this.directional;
          },
          set(this: ParticleSystem, value) {
            this.directional = value.bool[0];
          }
        },
        {
          name: 'Rotation',
          type: 'vec2',
          animatable: true,
          default: [0, 0],
          get(this: ParticleSystem, value) {
            value.num[0] = this.particleRotationMin;
            value.num[1] = this.particleRotationMax;
          },
          set(this: ParticleSystem, value) {
            this.particleRotationMin = value.num[0];
            this.particleRotationMax = value.num[1];
          }
        },
        {
          name: 'ConeRadius',
          type: 'vec2',
          animatable: true,
          default: [0, 0.1],
          get(this: ParticleSystem, value) {
            value.num[0] = this.emitterConeRadiusMin;
            value.num[1] = this.emitterConeRadiusMax;
          },
          set(this: ParticleSystem, value) {
            this.emitterConeRadiusMin = value.num[0];
            this.emitterConeRadiusMax = value.num[1];
          }
        },
        {
          name: 'Velocity',
          type: 'vec2',
          animatable: true,
          default: [2, 3],
          get(this: ParticleSystem, value) {
            value.num[0] = this.particleVelocityMin;
            value.num[1] = this.particleVelocityMax;
          },
          set(this: ParticleSystem, value) {
            this.particleVelocityMin = value.num[0];
            this.particleVelocityMax = value.num[1];
          }
        },
        {
          name: 'Life',
          type: 'vec2',
          animatable: true,
          default: [1, 1.5],
          get(this: ParticleSystem, value) {
            value.num[0] = this.particleLifeMin;
            value.num[1] = this.particleLifeMax;
          },
          set(this: ParticleSystem, value) {
            this.particleLifeMin = value.num[0];
            this.particleLifeMax = value.num[1];
          }
        },
        {
          name: 'Size1',
          animatable: true,
          type: 'vec2',
          default: [0.4, 0.5],
          get(this: ParticleSystem, value) {
            value.num[0] = this.particleSize1Min;
            value.num[1] = this.particleSize1Max;
          },
          set(this: ParticleSystem, value) {
            this.particleSize1Min = value.num[0];
            this.particleSize1Max = value.num[1];
          }
        },
        {
          name: 'Size2',
          animatable: true,
          type: 'vec2',
          default: [0, 0.1],
          get(this: ParticleSystem, value) {
            value.num[0] = this.particleSize2Min;
            value.num[1] = this.particleSize2Max;
          },
          set(this: ParticleSystem, value) {
            this.particleSize2Min = value.num[0];
            this.particleSize2Max = value.num[1];
          }
        },
        {
          name: 'Acceleration',
          animatable: true,
          type: 'vec2',
          default: [-0.01, -0.02],
          get(this: ParticleSystem, value) {
            value.num[0] = this.particleAccelMin;
            value.num[1] = this.particleAccelMax;
          },
          set(this: ParticleSystem, value) {
            this.particleAccelMin = value.num[0];
            this.particleAccelMax = value.num[1];
          }
        },
        {
          name: 'Material',
          type: 'object',
          default: null,
          objectTypes: [ParticleMaterial],
          get(this: ParticleSystem, value) {
            value.object[0] = this.getMaterial();
          },
          set(this: ParticleSystem, value) {
            if (!value.object[0]) {
              this.material = null;
            } else if (value.object[0] instanceof ParticleMaterial) {
              this.material = value.object[0];
            } else {
              console.error('Invalid material type');
            }
          }
        }
      ];
    }
  };
}
