import { Vector2 } from '@zephyr3d/base';
import type { SceneNode } from '../../../scene';
import { GraphNode } from '../../../scene';
import { Water } from '../../../scene/water';
import type { SerializableClass } from '../types';
import type { WaveGenerator } from '../../../render';
import { FBMWaveGenerator, FFTWaveGenerator } from '../../../render';
import type { Texture2D } from '@zephyr3d/device';
import type { SerializationManager } from '../manager';

/** @internal */
export function getFBMWaveGeneratorClass(): SerializableClass {
  return {
    ctor: FBMWaveGenerator,
    name: 'FBMWaveGenerator',
    getProps() {
      return [
        {
          name: 'NumOctaves',
          type: 'int',
          options: { minValue: 1, maxValue: 8 },
          default: 4,
          get(this: FBMWaveGenerator, value) {
            value.num[0] = this.numOctaves;
          },
          set(this: FBMWaveGenerator, value) {
            this.numOctaves = value.num[0];
          }
        },
        {
          name: 'Wind',
          type: 'vec2',
          default: [0.1, 0],
          options: {
            animatable: true
          },
          get(this: FBMWaveGenerator, value) {
            value.num[0] = this.wind.x;
            value.num[1] = this.wind.y;
          },
          set(this: FBMWaveGenerator, value) {
            this.wind = new Vector2(value.num[0], value.num[1]);
          }
        },
        {
          name: 'Amplitude',
          type: 'float',
          options: { animatable: true, minValue: 0, maxValue: 5 },
          default: 0.3,
          get(this: FBMWaveGenerator, value) {
            value.num[0] = this.amplitude;
          },
          set(this: FBMWaveGenerator, value) {
            this.amplitude = value.num[0];
          }
        },
        {
          name: 'Frequency',
          type: 'float',
          options: { animatable: true, minValue: 0, maxValue: 16 },
          default: 3,
          get(this: FBMWaveGenerator, value) {
            value.num[0] = this.frequency;
          },
          set(this: FBMWaveGenerator, value) {
            this.frequency = value.num[0];
          }
        }
      ];
    }
  };
}

/** @internal */
export function getFFTWaveGeneratorClass(): SerializableClass {
  return {
    ctor: FFTWaveGenerator,
    name: 'FFTWaveGenerator',
    getProps() {
      return [
        {
          name: 'Alignment',
          type: 'float',
          options: { animatable: true, minValue: 0, maxValue: 1 },
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
          options: {
            animatable: true
          },
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
          options: { animatable: true, minValue: 0, maxValue: 10 },
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
          options: { animatable: true, minValue: 0, maxValue: 10 },
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
          options: { animatable: true, minValue: 0, maxValue: 1000 },
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
          options: { animatable: true, minValue: 0, maxValue: 1 },
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
          options: { animatable: true, minValue: -4, maxValue: 0 },
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

/** @internal */
export function getWaterClass(manager: SerializationManager): SerializableClass {
  return {
    ctor: Water,
    name: 'Water',
    parent: GraphNode,
    createFunc(ctx: SceneNode) {
      const node = new Water(ctx.scene);
      node.parent = ctx;
      return { obj: node };
    },
    getProps() {
      return [
        {
          name: 'WaveGenerator',
          type: 'object',
          default: null,
          options: {
            objectTypes: [FFTWaveGenerator, FBMWaveGenerator]
          },
          isNullable() {
            return true;
          },
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
          name: 'Wireframe',
          type: 'bool',
          default: false,
          get(this: Water, value) {
            value.bool[0] = this.wireframe;
          },
          set(this: Water, value) {
            this.wireframe = value.bool[0];
          }
        },
        {
          name: 'AnimationSpeed',
          type: 'float',
          default: 1,
          options: { animatable: true, minValue: 0, maxValue: 100 },
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
          options: { animatable: true, minValue: 0, maxValue: 100 },
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
          options: { animatable: true, minValue: 0, maxValue: 1 },
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
          default: null,
          isNullable() {
            return true;
          },
          get(this: Water, value) {
            value.str[0] = manager.getAssetId(this.material.scatterRampTexture) ?? '';
          },
          async set(value) {
            if (!value) {
              this.material.scatterRampTexture = null;
            } else {
              if (value.str[0]) {
                const assetId = value.str[0];
                let tex: Texture2D;
                try {
                  tex = await manager.fetchTexture<Texture2D>(assetId);
                } catch (err) {
                  console.error(`Load asset failed: ${value.str[0]}: ${err}`);
                  tex = null;
                }
                if (tex?.isTexture2D()) {
                  this.material.scatterRampTexture = tex;
                } else {
                  console.error('Invalid texture type');
                }
              }
            }
          }
        },
        {
          name: 'AbsorptionRampTexture',
          type: 'object',
          default: null,
          isNullable() {
            return true;
          },
          get(this: Water, value) {
            value.str[0] = manager.getAssetId(this.material.absorptionRampTexture) ?? '';
          },
          async set(this: Water, value) {
            if (!value) {
              this.material.absorptionRampTexture = null;
            } else {
              if (value.str[0]) {
                const assetId = value.str[0];
                let tex: Texture2D;
                try {
                  tex = await manager.fetchTexture<Texture2D>(assetId);
                } catch (err) {
                  console.error(`Load asset failed: ${value.str[0]}: ${err}`);
                  tex = null;
                }
                if (tex?.isTexture2D()) {
                  this.material.absorptionRampTexture = tex;
                } else {
                  console.error('Invalid texture type');
                }
              }
            }
          }
        }
      ];
    }
  };
}
