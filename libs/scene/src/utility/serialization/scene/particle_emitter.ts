import type { Interpolator, Nullable } from '@zephyr3d/base';
import { Interpolator as InterpolatorClass } from '@zephyr3d/base';
import { GraphNode } from '../../../scene';
import type { SceneNode } from '../../../scene/scene_node';
import { ParticleEmitter } from '../../../scene/particle/particle_emitter';
import type {
  ParticleSimulationMode,
  ParticleSortOrder,
  ParticleSpace
} from '../../../scene/particle/particle_emitter';
import type { ParticleRange, ParticleShapeType } from '../../../scene/particle/particle_modules';
import { ParticleBurst, ParticleGradient } from '../../../scene/particle/particle_modules';
import { ParticleSpriteMaterial } from '../../../material/particlesprite';
import type { ParticleAlignment } from '../../../material/particlesprite';
import { MeshMaterial } from '../../../material/meshmaterial';
import type { Texture2D } from '@zephyr3d/device';
import type { ResourceManager } from '../manager';
import { getMeshMaterialInstanceUniformsClass } from './common';
import { defineProps, type PropertyAccessor, type SerializableClass } from '../types';

const DEG = 180 / Math.PI;
const RAD = Math.PI / 180;

/** A min/max range property, optionally shown in degrees */
function rangeProp(
  name: string,
  description: string,
  group: string,
  pick: (node: ParticleEmitter) => ParticleRange,
  defaults: [number, number],
  degrees = false
): PropertyAccessor<ParticleEmitter, 'DUMMY'> {
  const k = degrees ? DEG : 1;
  return {
    name,
    description,
    type: 'vec2',
    default: [defaults[0] * k, defaults[1] * k],
    options: { group, label: name },
    get(this: ParticleEmitter, value) {
      const r = pick(this);
      value.num[0] = r.min * k;
      value.num[1] = r.max * k;
    },
    set(this: ParticleEmitter, value) {
      pick(this).set(value.num[0] / k, value.num[1] / k);
    }
  };
}

/** A curve property: kept in the scene file; edited in code for now */
function curveProp(
  name: string,
  description: string,
  get: (node: ParticleEmitter) => Nullable<Interpolator>,
  set: (node: ParticleEmitter, curve: Nullable<Interpolator>) => void
): PropertyAccessor<ParticleEmitter, 'DUMMY'> {
  return {
    name,
    description,
    type: 'object',
    default: null,
    options: { group: 'Over Lifetime', objectTypes: [InterpolatorClass] },
    isHidden() {
      return true;
    },
    isNullable() {
      return true;
    },
    get(this: ParticleEmitter, value) {
      value.object[0] = get(this);
    },
    set(this: ParticleEmitter, value) {
      const curve = value.object[0];
      set(this, curve instanceof InterpolatorClass ? curve : null);
    }
  };
}

function shapeUses(node: ParticleEmitter, ...types: ParticleShapeType[]) {
  return types.includes(node.shape.type);
}

/** @internal */
export function getParticleBurstClass(): SerializableClass {
  return {
    ctor: ParticleBurst,
    name: 'ParticleBurst',
    getProps() {
      return defineProps([
        {
          name: 'Time',
          description: 'Seconds into the emission cycle of the first burst',
          type: 'float',
          default: 0,
          options: { minValue: 0 },
          get(this: ParticleBurst, value) {
            value.num[0] = this.time;
          },
          set(this: ParticleBurst, value) {
            this.time = value.num[0];
          }
        },
        {
          name: 'Count',
          description: 'Particles per burst, a whole number picked between min and max',
          type: 'vec2',
          default: [30, 30],
          get(this: ParticleBurst, value) {
            value.num[0] = this.count.min;
            value.num[1] = this.count.max;
          },
          set(this: ParticleBurst, value) {
            this.count.set(value.num[0], value.num[1]);
          }
        },
        {
          name: 'Cycles',
          description: 'How many bursts, Interval apart; 0 repeats until the end of the emission cycle',
          type: 'int',
          default: 1,
          options: { minValue: 0 },
          get(this: ParticleBurst, value) {
            value.num[0] = this.cycles;
          },
          set(this: ParticleBurst, value) {
            this.cycles = Math.max(0, Math.floor(value.num[0]));
          }
        },
        {
          name: 'Interval',
          description: 'Seconds between the bursts of this entry',
          type: 'float',
          default: 0.1,
          options: { minValue: 0.001 },
          get(this: ParticleBurst, value) {
            value.num[0] = this.interval;
          },
          set(this: ParticleBurst, value) {
            this.interval = value.num[0];
          }
        }
      ]);
    }
  };
}

/** @internal */
export function getParticleEmitterClass(): SerializableClass {
  return {
    ctor: ParticleEmitter,
    name: 'ParticleEmitter',
    parent: GraphNode,
    createFunc(ctx: SceneNode) {
      const node = new ParticleEmitter(ctx.scene!);
      node.parent = ctx;
      return { obj: node };
    },
    getProps() {
      return defineProps([
        // ---- Playback ----
        {
          name: 'Playback',
          description: 'Play from the start or resume, pause, stop emitting, or clear and play again',
          type: 'command',
          options: { group: 'Playback', defaultOpen: true },
          get(value) {
            value.str = ['Play', 'Pause', 'Stop', 'Restart'];
          },
          command(this: ParticleEmitter, index) {
            if (index === 0) {
              this.play();
            } else if (index === 1) {
              this.pause();
            } else if (index === 2) {
              this.stop();
            } else {
              this.restart();
            }
            return false;
          }
        },
        {
          name: 'Simulation',
          description:
            'Where particles are simulated; auto picks the GPU on WebGPU from 1000 particles. Without WebGPU the GPU choices run on the CPU with at most 20000 particles',
          type: 'string',
          default: 'auto',
          options: {
            group: 'Playback',
            enum: { labels: ['Auto', 'CPU', 'GPU'], values: ['auto', 'cpu', 'gpu'] }
          },
          get(this: ParticleEmitter, value) {
            value.str[0] = this.simulation;
          },
          set(this: ParticleEmitter, value) {
            this.simulation = value.str[0] as ParticleSimulationMode;
          }
        },
        {
          name: 'MaxParticles',
          description: 'Most particles alive at once; births beyond it are dropped',
          type: 'int',
          default: 1000,
          options: { group: 'Playback', minValue: 1, maxValue: 1000000 },
          get(this: ParticleEmitter, value) {
            value.num[0] = this.maxParticles;
          },
          set(this: ParticleEmitter, value) {
            this.maxParticles = value.num[0];
          }
        },
        {
          name: 'Space',
          description:
            'World: particles stay where they were born when the emitter moves. Local: they move with it',
          type: 'string',
          default: 'world',
          options: {
            group: 'Playback',
            enum: { labels: ['World', 'Local'], values: ['world', 'local'] }
          },
          get(this: ParticleEmitter, value) {
            value.str[0] = this.space;
          },
          set(this: ParticleEmitter, value) {
            this.space = value.str[0] as ParticleSpace;
          }
        },
        {
          name: 'Duration',
          description: 'Seconds of an emission cycle; bursts repeat every cycle',
          type: 'float',
          default: 5,
          options: { group: 'Playback', minValue: 0.01 },
          get(this: ParticleEmitter, value) {
            value.num[0] = this.duration;
          },
          set(this: ParticleEmitter, value) {
            this.duration = value.num[0];
          }
        },
        {
          name: 'Looping',
          description: 'Repeat the emission cycle; otherwise emission ends after one',
          type: 'bool',
          default: true,
          options: { group: 'Playback' },
          get(this: ParticleEmitter, value) {
            value.bool[0] = this.looping;
          },
          set(this: ParticleEmitter, value) {
            this.looping = value.bool[0];
          }
        },
        {
          name: 'StartDelay',
          description: 'Seconds from play to the first emission',
          type: 'float',
          default: 0,
          options: { group: 'Playback', minValue: 0 },
          get(this: ParticleEmitter, value) {
            value.num[0] = this.startDelay;
          },
          set(this: ParticleEmitter, value) {
            this.startDelay = value.num[0];
          }
        },
        {
          name: 'Prewarm',
          description: 'Start a looping effect as if it had been playing for a cycle',
          type: 'bool',
          default: false,
          options: { group: 'Playback' },
          get(this: ParticleEmitter, value) {
            value.bool[0] = this.prewarm;
          },
          set(this: ParticleEmitter, value) {
            this.prewarm = value.bool[0];
          }
        },
        {
          name: 'SimulationSpeed',
          description: 'Speed of time for the effect',
          type: 'float',
          default: 1,
          options: { group: 'Playback', minValue: 0, maxValue: 10 },
          get(this: ParticleEmitter, value) {
            value.num[0] = this.simulationSpeed;
          },
          set(this: ParticleEmitter, value) {
            this.simulationSpeed = value.num[0];
          }
        },
        {
          name: 'AutoPlay',
          description: 'Play once in the scene',
          type: 'bool',
          default: true,
          options: { group: 'Playback' },
          get(this: ParticleEmitter, value) {
            value.bool[0] = this.autoPlay;
          },
          set(this: ParticleEmitter, value) {
            this.autoPlay = value.bool[0];
          }
        },
        {
          name: 'Seed',
          description: 'Random seed; the same seed and frame times give the same effect',
          type: 'int',
          default: 1,
          options: { group: 'Playback', minValue: 0 },
          get(this: ParticleEmitter, value) {
            value.num[0] = this.seed;
          },
          set(this: ParticleEmitter, value) {
            this.seed = value.num[0];
          }
        },
        // ---- Emission ----
        {
          name: 'Rate',
          description: 'Particles per second',
          type: 'float',
          default: 50,
          options: { group: 'Emission', minValue: 0 },
          get(this: ParticleEmitter, value) {
            value.num[0] = this.emission.rate;
          },
          set(this: ParticleEmitter, value) {
            this.emission.rate = value.num[0];
          }
        },
        {
          name: 'RateOverDistance',
          description: 'Particles per meter the emitter moves (trails, tire smoke)',
          type: 'float',
          default: 0,
          options: { group: 'Emission', minValue: 0 },
          get(this: ParticleEmitter, value) {
            value.num[0] = this.emission.rateOverDistance;
          },
          set(this: ParticleEmitter, value) {
            this.emission.rateOverDistance = value.num[0];
          }
        },
        {
          name: 'Bursts',
          description: 'Bursts of particles within each emission cycle',
          type: 'object_array',
          default: [],
          options: { group: 'Emission', objectTypes: [ParticleBurst], elementLabel: 'Burst' },
          isNullable() {
            return false;
          },
          get(this: ParticleEmitter, value) {
            value.object = [...this.emission.bursts];
          },
          set(this: ParticleEmitter, value) {
            this.emission.bursts = ((value.object ?? []) as unknown[]).filter(
              (b): b is ParticleBurst => b instanceof ParticleBurst
            );
          },
          create() {
            return new ParticleBurst();
          },
          add(this: ParticleEmitter, value, index) {
            const burst = value?.object?.[0];
            const b = burst instanceof ParticleBurst ? burst : new ParticleBurst();
            const bursts = this.emission.bursts;
            bursts.splice(index === undefined || index < 0 ? bursts.length : index, 0, b);
          },
          delete(this: ParticleEmitter, index) {
            this.emission.bursts.splice(index, 1);
          }
        },
        // ---- Shape ----
        {
          name: 'Shape',
          description: 'Shape particles are born from, emitting along +Y',
          type: 'string',
          default: 'cone',
          options: {
            group: 'Shape',
            enum: {
              labels: ['Point', 'Sphere', 'Hemisphere', 'Box', 'Cone', 'Circle', 'Edge'],
              values: ['point', 'sphere', 'hemisphere', 'box', 'cone', 'circle', 'edge']
            }
          },
          get(this: ParticleEmitter, value) {
            value.str[0] = this.shape.type;
          },
          set(this: ParticleEmitter, value) {
            this.shape.type = value.str[0] as ParticleShapeType;
          }
        },
        {
          name: 'Radius',
          description: 'Radius of the shape',
          type: 'float',
          default: 0.2,
          options: { group: 'Shape', minValue: 0 },
          isHidden(this: ParticleEmitter) {
            return !shapeUses(this, 'sphere', 'hemisphere', 'cone', 'circle');
          },
          get(this: ParticleEmitter, value) {
            value.num[0] = this.shape.radius;
          },
          set(this: ParticleEmitter, value) {
            this.shape.radius = value.num[0];
          }
        },
        {
          name: 'BoxSize',
          description: 'Size of the box',
          type: 'vec3',
          default: [1, 1, 1],
          options: { group: 'Shape' },
          isHidden(this: ParticleEmitter) {
            return !shapeUses(this, 'box');
          },
          get(this: ParticleEmitter, value) {
            value.num[0] = this.shape.boxSize.x;
            value.num[1] = this.shape.boxSize.y;
            value.num[2] = this.shape.boxSize.z;
          },
          set(this: ParticleEmitter, value) {
            this.shape.boxSize.setXYZ(value.num[0], value.num[1], value.num[2]);
          }
        },
        {
          name: 'Length',
          description: 'Length of the edge, along X',
          type: 'float',
          default: 1,
          options: { group: 'Shape', minValue: 0 },
          isHidden(this: ParticleEmitter) {
            return !shapeUses(this, 'edge');
          },
          get(this: ParticleEmitter, value) {
            value.num[0] = this.shape.length;
          },
          set(this: ParticleEmitter, value) {
            this.shape.length = value.num[0];
          }
        },
        {
          name: 'Thickness',
          description:
            'Part of the shape particles are born in: 0 on its surface (rim of cone and circle, faces of box) only, 1 throughout',
          type: 'float',
          default: 1,
          options: { group: 'Shape', minValue: 0, maxValue: 1 },
          isHidden(this: ParticleEmitter) {
            return shapeUses(this, 'point', 'edge');
          },
          get(this: ParticleEmitter, value) {
            value.num[0] = this.shape.thickness;
          },
          set(this: ParticleEmitter, value) {
            this.shape.thickness = value.num[0];
          }
        },
        {
          name: 'Angle',
          description:
            'Half angle in degrees: of the spread around +Y (point, box, edge; 180 for every direction), of the cone at its rim (cone)',
          type: 'float',
          default: 0.4 * DEG,
          options: { group: 'Shape', minValue: 0, maxValue: 180 },
          isHidden(this: ParticleEmitter) {
            return !shapeUses(this, 'point', 'box', 'edge', 'cone');
          },
          get(this: ParticleEmitter, value) {
            value.num[0] = this.shape.angle * DEG;
          },
          set(this: ParticleEmitter, value) {
            this.shape.angle = value.num[0] * RAD;
          }
        },
        {
          name: 'Arc',
          description: 'Range in degrees around +Y the shape covers',
          type: 'float',
          default: 360,
          options: { group: 'Shape', minValue: 0, maxValue: 360 },
          isHidden(this: ParticleEmitter) {
            return !shapeUses(this, 'sphere', 'hemisphere', 'cone', 'circle');
          },
          get(this: ParticleEmitter, value) {
            value.num[0] = this.shape.arc * DEG;
          },
          set(this: ParticleEmitter, value) {
            this.shape.arc = value.num[0] * RAD;
          }
        },
        {
          name: 'RandomizeDirection',
          description: '0 to 1: blends the direction toward a random one',
          type: 'float',
          default: 0,
          options: { group: 'Shape', minValue: 0, maxValue: 1 },
          get(this: ParticleEmitter, value) {
            value.num[0] = this.shape.randomizeDirection;
          },
          set(this: ParticleEmitter, value) {
            this.shape.randomizeDirection = value.num[0];
          }
        },
        {
          name: 'InheritVelocity',
          description: "Share of the emitter's velocity particles take at birth (world space only)",
          type: 'float',
          default: 0,
          options: { group: 'Shape', minValue: -2, maxValue: 2 },
          get(this: ParticleEmitter, value) {
            value.num[0] = this.inheritVelocity;
          },
          set(this: ParticleEmitter, value) {
            this.inheritVelocity = value.num[0];
          }
        },
        // ---- Start ----
        rangeProp(
          'Lifetime',
          'Seconds a particle lives, picked between min and max',
          'Start',
          (n) => n.start.lifetime,
          [1, 1.5]
        ),
        rangeProp('Speed', 'Speed along the emission direction', 'Start', (n) => n.start.speed, [2, 3]),
        rangeProp('Size', 'Height of the quad', 'Start', (n) => n.start.size, [0.2, 0.4]),
        {
          name: 'Aspect',
          description: 'Width over height of the quad',
          type: 'float',
          default: 1,
          options: { group: 'Start', minValue: 0.01, maxValue: 100 },
          get(this: ParticleEmitter, value) {
            value.num[0] = this.start.aspect;
          },
          set(this: ParticleEmitter, value) {
            this.start.aspect = value.num[0];
          }
        },
        rangeProp(
          'Rotation',
          'Angle of the quad in its plane at birth, degrees',
          'Start',
          (n) => n.start.rotation,
          [0, 0],
          true
        ),
        rangeProp(
          'AngularVelocity',
          'Rate the quad turns at, degrees per second',
          'Start',
          (n) => n.start.angularVelocity,
          [0, 0],
          true
        ),
        {
          name: 'ColorA',
          description: 'Linear color; each particle picks one between A and B. May exceed 1 for bloom',
          type: 'rgba',
          default: [1, 1, 1, 1],
          options: { group: 'Start' },
          get(this: ParticleEmitter, value) {
            const c = this.start.colorA;
            value.num[0] = c.x;
            value.num[1] = c.y;
            value.num[2] = c.z;
            value.num[3] = c.w;
          },
          set(this: ParticleEmitter, value) {
            this.start.colorA.setXYZW(value.num[0], value.num[1], value.num[2], value.num[3]);
          }
        },
        {
          name: 'ColorB',
          description: 'Linear color, see ColorA',
          type: 'rgba',
          default: [1, 1, 1, 1],
          options: { group: 'Start' },
          get(this: ParticleEmitter, value) {
            const c = this.start.colorB;
            value.num[0] = c.x;
            value.num[1] = c.y;
            value.num[2] = c.z;
            value.num[3] = c.w;
          },
          set(this: ParticleEmitter, value) {
            this.start.colorB.setXYZW(value.num[0], value.num[1], value.num[2], value.num[3]);
          }
        },
        // ---- Over Lifetime ----
        curveProp(
          'SizeOverLife',
          'Size factor over the normalized age',
          (n) => n.overLife.size,
          (n, c) => (n.overLife.size = c)
        ),
        curveProp(
          'ColorOverLifeRGB',
          'Color factor over the normalized age',
          (n) => n.overLife.color?.rgb ?? null,
          (n, c) => {
            const alpha = n.overLife.color?.alpha ?? null;
            n.overLife.color = c || alpha ? new ParticleGradient(c, alpha) : null;
          }
        ),
        curveProp(
          'ColorOverLifeAlpha',
          'Alpha factor over the normalized age',
          (n) => n.overLife.color?.alpha ?? null,
          (n, c) => {
            const rgb = n.overLife.color?.rgb ?? null;
            n.overLife.color = c || rgb ? new ParticleGradient(rgb, c) : null;
          }
        ),
        // ---- Forces ----
        {
          name: 'Gravity',
          description: 'Acceleration in world space; not scaled with the emitter',
          type: 'vec3',
          default: [0, 0, 0],
          options: { group: 'Forces' },
          get(this: ParticleEmitter, value) {
            const g = this.forces.gravity;
            value.num[0] = g.x;
            value.num[1] = g.y;
            value.num[2] = g.z;
          },
          set(this: ParticleEmitter, value) {
            this.forces.gravity.setXYZ(value.num[0], value.num[1], value.num[2]);
          }
        },
        {
          name: 'Drag',
          description:
            "How strongly the air carries particles: rate in 1/s their velocity approaches the air's. 0 leaves AirVelocity and the wind without effect; high for smoke, snow and leaves, low for sparks",
          type: 'float',
          default: 0,
          options: { group: 'Forces', minValue: 0, maxValue: 100 },
          get(this: ParticleEmitter, value) {
            value.num[0] = this.forces.drag;
          },
          set(this: ParticleEmitter, value) {
            this.forces.drag = value.num[0];
          }
        },
        {
          name: 'AirVelocity',
          description: 'Velocity of the air in world space; moves particles only when Drag is above 0',
          type: 'vec3',
          default: [0, 0, 0],
          options: { group: 'Forces' },
          get(this: ParticleEmitter, value) {
            const a = this.forces.airVelocity;
            value.num[0] = a.x;
            value.num[1] = a.y;
            value.num[2] = a.z;
          },
          set(this: ParticleEmitter, value) {
            this.forces.airVelocity.setXYZ(value.num[0], value.num[1], value.num[2]);
          }
        },
        {
          name: 'WindInfluence',
          description:
            "Share of the scene's wind added to the air's velocity, gusts included; moves particles only when Drag is above 0",
          type: 'float',
          default: 0,
          options: { group: 'Forces', minValue: 0, maxValue: 10 },
          get(this: ParticleEmitter, value) {
            value.num[0] = this.forces.windInfluence;
          },
          set(this: ParticleEmitter, value) {
            this.forces.windInfluence = value.num[0];
          }
        },
        {
          name: 'NoiseStrength',
          description:
            'Average acceleration of the swirling curl noise (scaled with the emitter); 0 for none',
          type: 'float',
          default: 0,
          options: { group: 'Forces', minValue: 0, maxValue: 1000 },
          get(this: ParticleEmitter, value) {
            value.num[0] = this.forces.noise.strength;
          },
          set(this: ParticleEmitter, value) {
            this.forces.noise.strength = value.num[0];
          }
        },
        {
          name: 'NoiseFrequency',
          description: 'Noise cells per unit: larger for smaller swirls',
          type: 'float',
          default: 1,
          options: { group: 'Forces', minValue: 0, maxValue: 100 },
          isHidden(this: ParticleEmitter) {
            return !(this.forces.noise.strength > 0);
          },
          get(this: ParticleEmitter, value) {
            value.num[0] = this.forces.noise.frequency;
          },
          set(this: ParticleEmitter, value) {
            this.forces.noise.frequency = value.num[0];
          }
        },
        {
          name: 'NoiseScrollSpeed',
          description: 'Speed the noise pattern changes at, units per second; 0 for a still field',
          type: 'float',
          default: 0.5,
          options: { group: 'Forces', minValue: 0, maxValue: 100 },
          isHidden(this: ParticleEmitter) {
            return !(this.forces.noise.strength > 0);
          },
          get(this: ParticleEmitter, value) {
            value.num[0] = this.forces.noise.scrollSpeed;
          },
          set(this: ParticleEmitter, value) {
            this.forces.noise.scrollSpeed = value.num[0];
          }
        },
        // ---- Collision ----
        {
          name: 'CollisionMode',
          description:
            "What particles collide with: a plane, or the scene's signed distance field (GPU simulation only, needs the scene SDF)",
          type: 'string',
          default: 'none',
          options: {
            group: 'Collision',
            enum: { labels: ['None', 'Plane', 'Scene SDF'], values: ['none', 'plane', 'sdf'] }
          },
          get(this: ParticleEmitter, value) {
            value.str[0] = this.collision.mode;
          },
          set(this: ParticleEmitter, value) {
            const mode = value.str[0];
            this.collision.mode = mode === 'plane' || mode === 'sdf' ? mode : 'none';
          }
        },
        {
          name: 'PlaneNormal',
          description: 'Normal of the plane in world space, toward the side particles stay on',
          type: 'vec3',
          default: [0, 1, 0],
          options: { group: 'Collision' },
          isHidden(this: ParticleEmitter) {
            return this.collision.mode !== 'plane';
          },
          get(this: ParticleEmitter, value) {
            const n = this.collision.planeNormal;
            value.num[0] = n.x;
            value.num[1] = n.y;
            value.num[2] = n.z;
          },
          set(this: ParticleEmitter, value) {
            this.collision.planeNormal.setXYZ(value.num[0], value.num[1], value.num[2]);
          }
        },
        {
          name: 'PlaneHeight',
          description:
            'Distance of the plane from the world origin along its normal: the height of the ground for an upward normal',
          type: 'float',
          default: 0,
          options: { group: 'Collision' },
          isHidden(this: ParticleEmitter) {
            return this.collision.mode !== 'plane';
          },
          get(this: ParticleEmitter, value) {
            value.num[0] = this.collision.planeHeight;
          },
          set(this: ParticleEmitter, value) {
            this.collision.planeHeight = value.num[0];
          }
        },
        {
          name: 'Bounce',
          description: 'Share of the speed into the surface kept, bouncing back',
          type: 'float',
          default: 0.5,
          options: { group: 'Collision', minValue: 0, maxValue: 1 },
          isHidden(this: ParticleEmitter) {
            return this.collision.mode === 'none';
          },
          get(this: ParticleEmitter, value) {
            value.num[0] = this.collision.bounce;
          },
          set(this: ParticleEmitter, value) {
            this.collision.bounce = value.num[0];
          }
        },
        {
          name: 'Friction',
          description: 'Share of the speed along the surface lost each frame in contact',
          type: 'float',
          default: 0,
          options: { group: 'Collision', minValue: 0, maxValue: 1 },
          isHidden(this: ParticleEmitter) {
            return this.collision.mode === 'none';
          },
          get(this: ParticleEmitter, value) {
            value.num[0] = this.collision.friction;
          },
          set(this: ParticleEmitter, value) {
            this.collision.friction = value.num[0];
          }
        },
        {
          name: 'LifetimeLoss',
          description:
            'Share of the lifetime used up by each frame in contact while moving into the surface; 1 kills at the first contact',
          type: 'float',
          default: 0,
          options: { group: 'Collision', minValue: 0, maxValue: 1 },
          isHidden(this: ParticleEmitter) {
            return this.collision.mode === 'none';
          },
          get(this: ParticleEmitter, value) {
            value.num[0] = this.collision.lifetimeLoss;
          },
          set(this: ParticleEmitter, value) {
            this.collision.lifetimeLoss = value.num[0];
          }
        },
        {
          name: 'RadiusScale',
          description: "Radius of a particle's collision sphere as a share of half its size",
          type: 'float',
          default: 1,
          options: { group: 'Collision', minValue: 0, maxValue: 10 },
          isHidden(this: ParticleEmitter) {
            return this.collision.mode === 'none';
          },
          get(this: ParticleEmitter, value) {
            value.num[0] = this.collision.radiusScale;
          },
          set(this: ParticleEmitter, value) {
            this.collision.radiusScale = value.num[0];
          }
        },
        // ---- Bounds ----
        {
          name: 'BoundsMode',
          description:
            'Auto measures the particles; Fixed culls with the box below, in the space of the emitter',
          type: 'string',
          default: 'auto',
          options: {
            group: 'Bounds',
            enum: { labels: ['Auto', 'Fixed'], values: ['auto', 'fixed'] }
          },
          get(this: ParticleEmitter, value) {
            value.str[0] = this.bounds.mode;
          },
          set(this: ParticleEmitter, value) {
            this.bounds.mode = value.str[0] === 'fixed' ? 'fixed' : 'auto';
            this.invalidateBoundingVolume();
          }
        },
        {
          name: 'BoundsMin',
          description: 'Lower corner of the fixed bounds',
          type: 'vec3',
          default: [-1, -1, -1],
          options: { group: 'Bounds' },
          isHidden(this: ParticleEmitter) {
            return this.bounds.mode !== 'fixed';
          },
          get(this: ParticleEmitter, value) {
            const p = this.bounds.box.minPoint;
            value.num[0] = p.x;
            value.num[1] = p.y;
            value.num[2] = p.z;
          },
          set(this: ParticleEmitter, value) {
            this.bounds.box.minPoint.setXYZ(value.num[0], value.num[1], value.num[2]);
            this.invalidateBoundingVolume();
          }
        },
        {
          name: 'BoundsMax',
          description: 'Upper corner of the fixed bounds',
          type: 'vec3',
          default: [1, 1, 1],
          options: { group: 'Bounds' },
          isHidden(this: ParticleEmitter) {
            return this.bounds.mode !== 'fixed';
          },
          get(this: ParticleEmitter, value) {
            const p = this.bounds.box.maxPoint;
            value.num[0] = p.x;
            value.num[1] = p.y;
            value.num[2] = p.z;
          },
          set(this: ParticleEmitter, value) {
            this.bounds.box.maxPoint.setXYZ(value.num[0], value.num[1], value.num[2]);
            this.invalidateBoundingVolume();
          }
        },
        // ---- Rendering ----
        {
          name: 'SortOrder',
          description: 'Order particles are drawn in (not sorted by depth)',
          type: 'string',
          default: 'oldest-first',
          options: {
            group: 'Rendering',
            enum: { labels: ['Oldest First', 'Newest First'], values: ['oldest-first', 'newest-first'] }
          },
          get(this: ParticleEmitter, value) {
            value.str[0] = this.sortOrder;
          },
          set(this: ParticleEmitter, value) {
            this.sortOrder = value.str[0] as ParticleSortOrder;
          }
        },
        {
          name: 'Material',
          description: 'Material of the quads',
          type: 'object',
          default: null,
          options: { group: 'Rendering', objectTypes: [ParticleSpriteMaterial] },
          get(this: ParticleEmitter, value) {
            value.object[0] = this.material;
          },
          set(this: ParticleEmitter, value) {
            if (!value.object[0]) {
              this.material = null;
            } else if (value.object[0] instanceof ParticleSpriteMaterial) {
              this.material = value.object[0];
            } else {
              console.error('Invalid material type');
            }
          }
        }
      ]);
    }
  };
}

/** @internal */
export function getParticleSpriteMaterialClass(manager: ResourceManager): SerializableClass[] {
  return [
    {
      ctor: ParticleSpriteMaterial,
      name: 'ParticleSpriteMaterial',
      parent: MeshMaterial,
      getProps() {
        return defineProps([
          {
            name: 'Texture',
            description: 'Color texture (sRGB, alpha for coverage); empty for a soft round dot',
            type: 'object',
            default: '',
            options: {
              mimeTypes: [
                'image/jpeg',
                'image/png',
                'image/tga',
                'image/vnd.radiance',
                'image/x-dds',
                'image/webp'
              ]
            },
            isNullable() {
              return true;
            },
            get(this: ParticleSpriteMaterial, value) {
              value.str[0] = manager.getAssetId(this.texture) ?? '';
            },
            async set(this: ParticleSpriteMaterial, value) {
              if (!value || !value.str[0]) {
                this.texture = null;
              } else {
                let tex: Nullable<Texture2D> = null;
                try {
                  tex = await manager.fetchTexture<Texture2D>(value.str[0]);
                } catch (err) {
                  console.error(`Load asset failed: ${value.str[0]}: ${err}`);
                }
                if (tex?.isTexture2D()) {
                  this.texture = tex;
                } else {
                  console.error('Invalid particle texture');
                }
              }
            }
          },
          {
            name: 'AlphaFromRed',
            description: 'Take the alpha from the red channel of the texture and use white for the color',
            type: 'bool',
            default: false,
            get(this: ParticleSpriteMaterial, value) {
              value.bool[0] = this.alphaFromRed;
            },
            set(this: ParticleSpriteMaterial, value) {
              this.alphaFromRed = value.bool[0];
            }
          },
          {
            name: 'Alignment',
            description:
              'View: parallel to the screen. Velocity: height along the motion. Stretched: also lengthened by the speed. Horizontal: lying flat. Vertical: upright, turned toward the camera',
            type: 'string',
            default: 'view',
            options: {
              enum: {
                labels: ['View', 'Velocity', 'Stretched', 'Horizontal', 'Vertical'],
                values: ['view', 'velocity', 'stretched', 'horizontal', 'vertical']
              }
            },
            get(this: ParticleSpriteMaterial, value) {
              value.str[0] = this.alignment;
            },
            set(this: ParticleSpriteMaterial, value) {
              this.alignment = value.str[0] as ParticleAlignment;
            }
          },
          {
            name: 'StretchSpeedScale',
            description: 'Length added along the velocity per unit of speed',
            type: 'float',
            default: 0.1,
            options: { minValue: 0, maxValue: 10 },
            isHidden(this: ParticleSpriteMaterial) {
              return this.alignment !== 'stretched';
            },
            get(this: ParticleSpriteMaterial, value) {
              value.num[0] = this.stretchSpeedScale;
            },
            set(this: ParticleSpriteMaterial, value) {
              this.stretchSpeedScale = value.num[0];
            }
          },
          {
            name: 'StretchLengthScale',
            description: 'Length as a multiple of the particle size, before the speed is added',
            type: 'float',
            default: 1,
            options: { minValue: 0, maxValue: 10 },
            isHidden(this: ParticleSpriteMaterial) {
              return this.alignment !== 'stretched';
            },
            get(this: ParticleSpriteMaterial, value) {
              value.num[0] = this.stretchLengthScale;
            },
            set(this: ParticleSpriteMaterial, value) {
              this.stretchLengthScale = value.num[0];
            }
          },
          {
            name: 'FlipbookTiles',
            description: 'Columns and rows of flipbook frames in the texture; 1, 1 for none',
            type: 'int2',
            default: [1, 1],
            options: { minValue: 1, maxValue: 64 },
            get(this: ParticleSpriteMaterial, value) {
              const f = this.flipbook;
              value.num[0] = f.tilesX;
              value.num[1] = f.tilesY;
            },
            set(this: ParticleSpriteMaterial, value) {
              this.flipbook = { tilesX: value.num[0], tilesY: value.num[1] };
            }
          },
          {
            name: 'FlipbookMode',
            description: 'Lifetime plays the frames over the life; Random picks one per particle',
            type: 'string',
            default: 'lifetime',
            options: {
              enum: { labels: ['Lifetime', 'Random'], values: ['lifetime', 'random'] }
            },
            isHidden(this: ParticleSpriteMaterial) {
              const f = this.flipbook;
              return f.tilesX * f.tilesY <= 1;
            },
            get(this: ParticleSpriteMaterial, value) {
              value.str[0] = this.flipbook.mode;
            },
            set(this: ParticleSpriteMaterial, value) {
              this.flipbook = { mode: value.str[0] === 'random' ? 'random' : 'lifetime' };
            }
          },
          {
            name: 'FlipbookCycles',
            description: 'Times the frames play over the life',
            type: 'float',
            default: 1,
            options: { minValue: 0, maxValue: 100 },
            isHidden(this: ParticleSpriteMaterial) {
              const f = this.flipbook;
              return f.tilesX * f.tilesY <= 1 || f.mode !== 'lifetime';
            },
            get(this: ParticleSpriteMaterial, value) {
              value.num[0] = this.flipbook.cycles;
            },
            set(this: ParticleSpriteMaterial, value) {
              this.flipbook = { cycles: value.num[0] };
            }
          },
          {
            name: 'FlipbookBlend',
            description: 'Cross-fade between consecutive frames',
            type: 'bool',
            default: false,
            isHidden(this: ParticleSpriteMaterial) {
              const f = this.flipbook;
              return f.tilesX * f.tilesY <= 1 || f.mode !== 'lifetime';
            },
            get(this: ParticleSpriteMaterial, value) {
              value.bool[0] = this.flipbook.blend;
            },
            set(this: ParticleSpriteMaterial, value) {
              this.flipbook = { blend: value.bool[0] };
            }
          },
          {
            name: 'SoftDistance',
            description:
              'Distance over which quads fade out toward the scene behind them, hiding where they cut into it; 0 for off',
            type: 'float',
            default: 0,
            options: { minValue: 0, maxValue: 100 },
            get(this: ParticleSpriteMaterial, value) {
              value.num[0] = this.softDistance;
            },
            set(this: ParticleSpriteMaterial, value) {
              this.softDistance = value.num[0];
            }
          },
          {
            name: 'NearFadeDistance',
            description: 'Distance from the near plane over which quads fade in; 0 for off',
            type: 'float',
            default: 0,
            options: { minValue: 0, maxValue: 100 },
            get(this: ParticleSpriteMaterial, value) {
              value.num[0] = this.nearFadeDistance;
            },
            set(this: ParticleSpriteMaterial, value) {
              this.nearFadeDistance = value.num[0];
            }
          }
        ]);
      }
    },
    getMeshMaterialInstanceUniformsClass(ParticleSpriteMaterial, 'ParticleSpriteMaterial')
  ];
}
