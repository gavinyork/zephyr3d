import { degree2radian, radian2degree, Vector2 } from '@zephyr3d/base';
import { SceneNode } from '../../../scene';
import { Water } from '../../../scene/water';
import type { AssetRegistry } from '../asset/asset';
import type { PropertyAccessor, SerializableClass } from '../types';
import type { NodeHierarchy } from './node';
import { getGraphNodeClass } from './node';
import type { WaveGenerator } from '../../../render';
import { FFTWaveGenerator, GerstnerWaveGenerator } from '../../../render';
import type { Texture2D } from '@zephyr3d/device';

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

export function getFFTWaveGeneratorClass(assetRegistry: AssetRegistry): SerializableClass {
  return {
    ctor: FFTWaveGenerator,
    className: 'FFTWaveGenerator',
    getProps(val: FFTWaveGenerator) {
      return [
        {
          name: 'Alignment',
          type: 'float',
          options: { minValue: 0, maxValue: 1 },
          get(this: FFTWaveGenerator, value) {
            value.num[0] = this.alignment;
          },
          set(this: FFTWaveGenerator, value) {
            this.alignment = value.num[0];
          }
        },
        {
          name: 'Wind',
          type: 'vec2',
          get(this: FFTWaveGenerator, value) {
            value.num[0] = this.wind.x;
            value.num[1] = this.wind.y;
          },
          set(this: FFTWaveGenerator, value) {
            this.wind = new Vector2(value.num[0], value.num[1]);
          }
        },
        {
          name: 'FoamWidth',
          type: 'float',
          default: 1.2,
          options: { minValue: 0, maxValue: 10 },
          get(this: FFTWaveGenerator, value) {
            value.num[0] = this.foamWidth;
          },
          set(this: FFTWaveGenerator, value) {
            this.foamWidth = value.num[0];
          }
        },
        {
          name: 'FoamContrast',
          type: 'float',
          default: 7.2,
          options: { minValue: 0, maxValue: 10 },
          get(this: FFTWaveGenerator, value) {
            value.num[0] = this.foamContrast;
          },
          set(this: FFTWaveGenerator, value) {
            this.foamContrast = value.num[0];
          }
        },
        {
          name: 'WaveLengthCascades',
          type: 'vec3',
          default: [400, 100, 15],
          options: { minValue: 0, maxValue: 1000 },
          get(this: FFTWaveGenerator, value) {
            value.num[0] = this.getWaveLength(0);
            value.num[1] = this.getWaveLength(1);
            value.num[2] = this.getWaveLength(2);
          },
          set(this: FFTWaveGenerator, value) {
            this.setWaveLength(0, value.num[0]);
            this.setWaveLength(1, value.num[1]);
            this.setWaveLength(2, value.num[2]);
          }
        },
        {
          name: 'WaveStrengthCascades',
          type: 'vec3',
          default: [0.4, 0.4, 0.2],
          options: { minValue: 0, maxValue: 1 },
          get(this: FFTWaveGenerator, value) {
            value.num[0] = this.getWaveStrength(0);
            value.num[1] = this.getWaveStrength(1);
            value.num[2] = this.getWaveStrength(2);
          },
          set(this: FFTWaveGenerator, value) {
            this.setWaveStrength(0, value.num[0]);
            this.setWaveStrength(1, value.num[1]);
            this.setWaveStrength(2, value.num[2]);
          }
        },
        {
          name: 'WaveCroppinessCascades',
          type: 'vec3',
          default: [-1.5, -1.2, -0.5],
          options: { minValue: -4, maxValue: 0 },
          get(this: FFTWaveGenerator, value) {
            value.num[0] = this.getWaveCroppiness(0);
            value.num[1] = this.getWaveCroppiness(1);
            value.num[2] = this.getWaveCroppiness(2);
          },
          set(this: FFTWaveGenerator, value) {
            this.setWaveCroppiness(0, value.num[0]);
            this.setWaveCroppiness(1, value.num[1]);
            this.setWaveCroppiness(2, value.num[2]);
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
          nullable: true,
          objectTypes: [GerstnerWaveGenerator, FFTWaveGenerator],
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
        },
        {
          name: 'GridScale',
          type: 'float',
          default: 1,
          options: { minValue: 0, maxValue: 1 },
          get(this: Water, value) {
            value.num[0] = this.gridScale;
          },
          set(this: Water, value) {
            this.gridScale = value.num[0];
          }
        },
        {
          name: 'AnimationSpeed',
          type: 'float',
          default: 1,
          options: { minValue: 0, maxValue: 100 },
          get(this: Water, value) {
            value.num[0] = this.animationSpeed;
          },
          set(this: Water, value) {
            this.animationSpeed = value.num[0];
          }
        },
        {
          name: 'DepthScale',
          type: 'float',
          default: 10,
          options: { minValue: 0, maxValue: 100 },
          get(this: Water, value) {
            value.num[0] = this.material.depthMulti;
          },
          set(this: Water, value) {
            this.material.depthMulti = value.num[0];
          }
        },
        {
          name: 'RefractionStrength',
          type: 'float',
          default: 0,
          options: { minValue: 0, maxValue: 1 },
          get(this: Water, value) {
            value.num[0] = this.material.refractionStrength;
          },
          set(this: Water, value) {
            this.material.refractionStrength = value.num[0];
          }
        },
        {
          name: 'Displace',
          type: 'float',
          default: 16,
          options: { minValue: 1, maxValue: 256 },
          get(this: Water, value) {
            value.num[0] = this.material.displace;
          },
          set(this: Water, value) {
            this.material.displace = value.num[0];
          }
        },
        {
          name: 'TAAStrength',
          type: 'float',
          default: 0.4,
          options: { minValue: 0, maxValue: 1 },
          get(this: Water, value) {
            value.num[0] = this.TAAStrength;
          },
          set(this: Water, value) {
            this.TAAStrength = value.num[0];
          }
        },
        {
          name: 'ScatterRampTexture',
          type: 'object',
          nullable: true,
          default: null,
          get(this: Water, value) {
            value.str[0] = assetRegistry.getAssetId(this.material.scatterRampTexture) ?? '';
          },
          async set(value) {
            if (!value) {
              this.material.scatterRampTexture = null;
            } else {
              if (value.str[0]) {
                const assetId = value.str[0];
                const assetInfo = assetRegistry.getAssetInfo(assetId);
                if (assetInfo && assetInfo.type === 'texture') {
                  let tex: Texture2D;
                  try {
                    tex = await assetRegistry.fetchTexture<Texture2D>(assetId, assetInfo.textureOptions);
                  } catch (err) {
                    console.error(`Load asset failed: ${value.str[0]}: ${err}`);
                    tex = null;
                  }
                  if (tex?.isTexture2D()) {
                    tex.name = assetInfo.name;
                    this.material.scatterRampTexture = tex;
                  } else {
                    console.error('Invalid texture type');
                  }
                }
              }
            }
          }
        },
        {
          name: 'AbsorptionRampTexture',
          type: 'object',
          nullable: true,
          default: null,
          get(this: Water, value) {
            value.str[0] = assetRegistry.getAssetId(this.material.absorptionRampTexture) ?? '';
          },
          async set(this: Water, value) {
            if (!value) {
              this.material.absorptionRampTexture = null;
            } else {
              if (value.str[0]) {
                const assetId = value.str[0];
                const assetInfo = assetRegistry.getAssetInfo(assetId);
                if (assetInfo && assetInfo.type === 'texture') {
                  let tex: Texture2D;
                  try {
                    tex = await assetRegistry.fetchTexture<Texture2D>(assetId, assetInfo.textureOptions);
                  } catch (err) {
                    console.error(`Load asset failed: ${value.str[0]}: ${err}`);
                    tex = null;
                  }
                  if (tex?.isTexture2D()) {
                    tex.name = assetInfo.name;
                    this.material.absorptionRampTexture = tex;
                  } else {
                    console.error('Invalid texture type');
                  }
                }
              }
            }
          }
        }
      ];
    }
  };
}
