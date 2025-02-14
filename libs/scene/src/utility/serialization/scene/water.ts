import { degree2radian, radian2degree, Vector2 } from '@zephyr3d/base';
import { SceneNode } from '../../../scene';
import { Water } from '../../../scene/water';
import type { AssetRegistry } from '../asset/asset';
import type { PropertyAccessor, SerializableClass } from '../types';
import type { NodeHierarchy } from './node';
import { getGraphNodeClass } from './node';
import { GerstnerWaveGenerator, WaveGenerator } from '../../../render';

export class GerstnerWaveCls {
  public generator: GerstnerWaveGenerator;
  public index: number;
  public direction: number;
  public amplitude: number;
  public steepness: number;
  public waveLength: number;
  public isOmni: boolean;
  public originX: number;
  public originZ: number;
  constructor(generator: GerstnerWaveGenerator, index: number) {
    this.generator = generator;
    this.index = index;
    this.direction = this.generator.getWaveDirection(this.index);
    this.amplitude = this.generator.getWaveAmplitude(this.index);
    this.steepness = this.generator.getWaveSteepness(this.index);
    this.waveLength = this.generator.getWaveLength(this.index);
    this.isOmni = this.generator.isOmniWave(this.index);
    this.originX = this.generator.getOriginX(this.index);
    this.originZ = this.generator.getOriginZ(this.index);
  }
  update() {
    this.generator.setWaveDirection(this.index, this.direction);
    this.generator.setWaveAmplitude(this.index, this.amplitude);
    this.generator.setWaveSteepness(this.index, this.steepness);
    this.generator.setWaveLength(this.index, this.waveLength);
    this.generator.setOmniWave(this.index, this.isOmni);
    this.generator.setOrigin(this.index, this.originX, this.originZ);
  }
}

export function getGerstnerWaveClass(assetRegistry): SerializableClass {
  return {
    ctor: GerstnerWaveCls,
    className: 'Wave',
    createFunc(ctx: GerstnerWaveGenerator, initParams: number) {
      return {
        obj: new GerstnerWaveCls(ctx, initParams)
      };
    },
    getInitParams(obj: GerstnerWaveCls) {
      return obj.index;
    },
    getProps(val: GerstnerWaveCls) {
      return [
        {
          name: 'Direction',
          type: 'float',
          options: { minValue: 0, maxValue: 360 },
          get(this: GerstnerWaveCls, value) {
            value.num[0] = radian2degree(this.direction);
          },
          set(this: GerstnerWaveCls, value) {
            this.direction = degree2radian(value.num[0]);
            this.generator.setWaveAmplitude(this.index, this.direction);
          }
        },
        {
          name: 'Steepness',
          type: 'float',
          options: { minValue: 0, maxValue: 1 },
          get(this: GerstnerWaveCls, value) {
            value.num[0] = this.steepness;
          },
          set(this: GerstnerWaveCls, value) {
            this.steepness = value.num[0];
            this.generator.setWaveSteepness(this.index, this.steepness);
          }
        },
        {
          name: 'Amplitude',
          type: 'float',
          options: { minValue: 0, maxValue: 1 },
          get(this: GerstnerWaveCls, value) {
            value.num[0] = this.amplitude;
          },
          set(this: GerstnerWaveCls, value) {
            this.amplitude = value.num[0];
            this.generator.setWaveAmplitude(this.index, this.amplitude);
          }
        },
        {
          name: 'WaveLength',
          type: 'float',
          get(this: GerstnerWaveCls, value) {
            value.num[0] = this.waveLength;
          },
          set(this: GerstnerWaveCls, value) {
            this.waveLength = value.num[0];
            this.generator.setWaveLength(this.index, this.waveLength);
          }
        },
        {
          name: 'OmniWave',
          type: 'bool',
          get(this: GerstnerWaveCls, value) {
            value.bool[0] = this.isOmni;
          },
          set(this: GerstnerWaveCls, value) {
            this.isOmni = value.bool[0];
            this.generator.setOmniWave(this.index, this.isOmni);
          }
        },
        {
          name: 'OmniOrigin',
          type: 'vec2',
          get(this: GerstnerWaveCls, value) {
            value.num[0] = this.originX;
            value.num[1] = this.originZ;
          },
          set(this: GerstnerWaveCls, value) {
            this.originX = value.num[0];
            this.originZ = value.num[1];
            this.generator.setOrigin(this.index, this.originX, this.originZ);
          },
          isValid(this: GerstnerWaveCls) {
            return this.isOmni;
          }
        }
      ];
    }
  };
}

export function getGerstnerWaveGeneratorClass(assetRegistry: AssetRegistry): SerializableClass {
  return {
    ctor: GerstnerWaveGenerator,
    className: 'GerstnerWaveGenerator',
    getProps(val: GerstnerWaveGenerator) {
      const waveProps: PropertyAccessor<GerstnerWaveGenerator>[] = [];
      for (let i = 0; i < val.numWaves; i++) {
        waveProps.push({
          name: `Wave${i}`,
          type: 'object',
          nullable: i === val.numWaves - 1,
          objectTypes: [GerstnerWaveCls],
          get(this: GerstnerWaveGenerator, value) {
            value.object[0] = new GerstnerWaveCls(this, i);
          },
          set(this: GerstnerWaveGenerator, value) {
            if (value.object[0]) {
              (value.object[0] as GerstnerWaveCls).update();
            } else if (i === val.numWaves - 1) {
              this.numWaves--;
            }
          }
        });
      }
      waveProps.push({
        name: 'Operation',
        type: 'command',
        get(this: GerstnerWaveGenerator, value) {
          value.str = ['Add'];
        },
        command(this: GerstnerWaveGenerator, index) {
          this.numWaves++;
          return true;
        }
      });
      return waveProps;
    }
  };
}
export function getWaterClass(assetRegistry: AssetRegistry): SerializableClass {
  return {
    ctor: Water,
    parent: getGraphNodeClass(assetRegistry),
    className: 'Water',
    createFunc(ctx: NodeHierarchy | SceneNode) {
      const node = new Water(ctx.scene);
      if (ctx instanceof SceneNode) {
        node.parent = ctx;
      }
      return { obj: node };
    },
    getProps() {
      return [
        {
          name: 'WaveGenerator',
          type: 'object',
          default: null,
          objectTypes: [GerstnerWaveGenerator],
          get(this: Water, value) {
            value.object[0] = this.waveGenerator ?? null;
          },
          set(this: Water, value) {
            if (!value.object[0]) {
              this.waveGenerator = null;
            } else {
              this.waveGenerator = value.object[0] as WaveGenerator;
            }
          }
        }
      ];
    }
  };
}
