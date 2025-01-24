import type { EmitterBehavior, EmitterShape } from '../../../scene';
import { SceneNode } from '../../../scene/scene_node';
import { ParticleSystem } from '../../../scene/particlesys';
import { Scene } from '../../../scene/scene';
import type { AssetRegistry } from '../asset/asset';
import type { SerializableClass } from '../types';
import { getGraphNodeClass } from './node';
import { ParticleMaterial } from '../../../material';

export function getParticleNodeClass(assetRegistry: AssetRegistry): SerializableClass {
  return {
    ctor: ParticleSystem,
    parent: getGraphNodeClass(assetRegistry),
    className: 'ParticleSystem',
    createFunc(scene: Scene | SceneNode) {
      if (scene instanceof Scene) {
        return new ParticleSystem(scene);
      } else if (scene instanceof SceneNode) {
        const particlesys = new ParticleSystem(scene.scene);
        particlesys.parent = scene;
        return particlesys;
      } else {
        return null;
      }
    },
    getProps() {
      return [
        {
          name: 'WorldSpace',
          type: 'bool',
          default: { bool: [true] },
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
          default: { num: [100] },
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
          default: { num: [100] },
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
          default: { num: [1] },
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
          default: { num: [0, 0, 0] },
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
          default: { num: [0, 0, 0] },
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
          type: 'float',
          default: { num: [1] },
          get(this: ParticleSystem, value) {
            value.num[0] = this.scalar;
          },
          set(this: ParticleSystem, value) {
            this.scalar = value.num[0];
          }
        },
        {
          name: 'Aspect',
          type: 'float',
          default: { num: [1] },
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
          default: { bool: [false] },
          get(this: ParticleSystem, value) {
            value.bool[0] = this.airResistence;
          },
          set(this: ParticleSystem, value) {
            this.airResistence = value.bool[0];
          }
        },
        {
          name: 'ParticleRotation',
          type: 'float',
          default: { num: [0] },
          get(this: ParticleSystem, value) {
            value.num[0] = this.particleRotation;
          },
          set(this: ParticleSystem, value) {
            this.particleRotation = value.num[0];
          }
        },
        {
          name: 'ParticleRotationVar',
          type: 'float',
          default: { num: [0] },
          get(this: ParticleSystem, value) {
            value.num[0] = this.particleRotationVar;
          },
          set(this: ParticleSystem, value) {
            this.particleRotationVar = value.num[0];
          }
        },
        {
          name: 'JitterSpeed',
          type: 'float',
          default: { num: [1] },
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
          default: { num: [0] },
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
          default: { str: ['point'] },
          get(this: ParticleSystem, value) {
            value.str[0] = this.emitterShape;
          },
          set(this: ParticleSystem, value) {
            this.emitterShape = value.str[0] as EmitterShape;
          }
        },
        {
          name: 'Directional',
          type: 'bool',
          default: { bool: [false] },
          get(this: ParticleSystem, value) {
            value.bool[0] = this.directional;
          },
          set(this: ParticleSystem, value) {
            this.directional = value.bool[0];
          }
        },
        {
          name: 'EmitterShape',
          type: 'string',
          enum: {
            labels: ['Point', 'Sphere', 'Box', 'Cylinder', 'Cone'],
            values: ['point', 'sphere', 'box', 'cylinder', 'cone']
          },
          default: { str: ['point'] },
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
          default: { str: ['surface'] },
          get(this: ParticleSystem, value) {
            value.str[0] = this.emitterBehavior;
          },
          set(this: ParticleSystem, value) {
            this.emitterBehavior = value.str[0] as EmitterBehavior;
          }
        },
        {
          name: 'EmitterConeRadius',
          type: 'float',
          default: { num: [0] },
          get(this: ParticleSystem, value) {
            value.num[0] = this.emitterConeRadius;
          },
          set(this: ParticleSystem, value) {
            this.emitterConeRadius = value.num[0];
          }
        },
        {
          name: 'EmitterConeRadiusVar',
          type: 'float',
          default: { num: [0.1] },
          get(this: ParticleSystem, value) {
            value.num[0] = this.emitterConeRadiusVar;
          },
          set(this: ParticleSystem, value) {
            this.emitterConeRadiusVar = value.num[0];
          }
        },
        {
          name: 'ParticleVelocity',
          type: 'float',
          default: { num: [0.2] },
          get(this: ParticleSystem, value) {
            value.num[0] = this.particleVelocity;
          },
          set(this: ParticleSystem, value) {
            this.particleVelocity = value.num[0];
          }
        },
        {
          name: 'ParticleVelocityVar',
          type: 'float',
          default: { num: [0.2] },
          get(this: ParticleSystem, value) {
            value.num[0] = this.particleVelocityVar;
          },
          set(this: ParticleSystem, value) {
            this.particleVelocityVar = value.num[0];
          }
        },
        {
          name: 'ParticleLife',
          type: 'float',
          default: { num: [1] },
          get(this: ParticleSystem, value) {
            value.num[0] = this.particleLife;
          },
          set(this: ParticleSystem, value) {
            this.particleLife = value.num[0];
          }
        },
        {
          name: 'ParticleLifeVar',
          type: 'float',
          default: { num: [0.5] },
          get(this: ParticleSystem, value) {
            value.num[0] = this.particleLifeVar;
          },
          set(this: ParticleSystem, value) {
            this.particleLifeVar = value.num[0];
          }
        },
        {
          name: 'ParticleSize1',
          type: 'float',
          default: { num: [0.4] },
          get(this: ParticleSystem, value) {
            value.num[0] = this.particleSize1;
          },
          set(this: ParticleSystem, value) {
            this.particleSize1 = value.num[0];
          }
        },
        {
          name: 'ParticleSize1Var',
          type: 'float',
          default: { num: [0.1] },
          get(this: ParticleSystem, value) {
            value.num[0] = this.particleSize1Var;
          },
          set(this: ParticleSystem, value) {
            this.particleSize1Var = value.num[0];
          }
        },
        {
          name: 'ParticleSize2',
          type: 'float',
          default: { num: [0] },
          get(this: ParticleSystem, value) {
            value.num[0] = this.particleSize2;
          },
          set(this: ParticleSystem, value) {
            this.particleSize2 = value.num[0];
          }
        },
        {
          name: 'ParticleSize2Var',
          type: 'float',
          default: { num: [0.1] },
          get(this: ParticleSystem, value) {
            value.num[0] = this.particleSize2Var;
          },
          set(this: ParticleSystem, value) {
            this.particleSize2Var = value.num[0];
          }
        },
        {
          name: 'Acceleration',
          type: 'float',
          default: { num: [-0.01] },
          get(this: ParticleSystem, value) {
            value.num[0] = this.particleAccel;
          },
          set(this: ParticleSystem, value) {
            this.particleAccel = value.num[0];
          }
        },
        {
          name: 'ParticleAccelerationVar',
          type: 'float',
          default: { num: [-0.01] },
          get(this: ParticleSystem, value) {
            value.num[0] = this.particleAccelVar;
          },
          set(this: ParticleSystem, value) {
            this.particleAccelVar = value.num[0];
          }
        },
        {
          name: 'Transparency',
          type: 'float',
          default: { num: [1] },
          get(this: ParticleSystem, value) {
            value.num[0] = this.transparency;
          },
          set(this: ParticleSystem, value) {
            this.transparency = value.num[0];
          }
        },
        {
          name: 'ColorMultiplier',
          type: 'float',
          default: { num: [1] },
          get(this: ParticleSystem, value) {
            value.num[0] = this.colorMultiplier;
          },
          set(this: ParticleSystem, value) {
            this.colorMultiplier = value.num[0];
          }
        },
        {
          name: 'Material',
          type: 'object',
          default: { object: [null] },
          objectTypes: [ParticleMaterial],
          get(this: ParticleSystem, value) {
            value.object[0] = this.getMaterial();
          }
        }
      ];
    }
  };
}
