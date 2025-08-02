import type { SerializableClass } from '../types';
import { Camera, OrthoCamera, PerspectiveCamera } from '../../../camera';
import type { NodeHierarchy } from './node';
import { SceneNode } from '../../../scene';
import {
  TAA_DEBUG_ALAPH,
  TAA_DEBUG_CURRENT_COLOR,
  TAA_DEBUG_EDGE,
  TAA_DEBUG_HISTORY_COLOR,
  TAA_DEBUG_MOTION_VECTOR,
  TAA_DEBUG_NONE,
  TAA_DEBUG_STRENGTH,
  TAA_DEBUG_VELOCITY
} from '../../../shaders';

/** @internal */
export function getCameraClass(): SerializableClass {
  return {
    ctor: Camera,
    parent: SceneNode,
    createFunc(ctx: NodeHierarchy | SceneNode) {
      const node = new Camera(ctx.scene);
      if (ctx instanceof SceneNode) {
        node.parent = ctx;
      }
      return { obj: node };
    },
    getProps() {
      return [
        {
          name: 'HiZ',
          type: 'bool',
          default: false,
          get(this: Camera, value) {
            value.bool[0] = this.HiZ;
          },
          set(this: Camera, value) {
            this.HiZ = value.bool[0];
          }
        },
        {
          name: 'ToneMapEnabled',
          type: 'bool',
          phase: 0,
          default: true,
          options: {
            label: 'Enabled',
            group: 'PostProcessing/ToneMap'
          },
          get(this: Camera, value) {
            value.bool[0] = this.toneMap;
          },
          set(this: Camera, value) {
            this.toneMap = value.bool[0];
          }
        },
        {
          name: 'ToneMapExposure',
          type: 'float',
          options: { minValue: 0, maxValue: 8, label: 'Exposure', group: 'PostProcessing/ToneMap' },
          phase: 0,
          default: 1,
          get(this: Camera, value) {
            value.num[0] = this.toneMapExposure;
          },
          set(this: Camera, value) {
            this.toneMapExposure = value.num[0];
          }
        },
        {
          name: 'BloomEnabled',
          type: 'bool',
          phase: 0,
          default: true,
          options: {
            label: 'Enabled',
            group: 'PostProcessing/Bloom'
          },
          get(this: Camera, value) {
            value.bool[0] = this.bloom;
          },
          set(this: Camera, value) {
            this.bloom = value.bool[0];
          }
        },
        {
          name: 'BloomMaxDownsampleLevels',
          type: 'int',
          options: { minValue: 0, maxValue: 8, label: 'MaxDownsampleLevels', group: 'PostProcessing/Bloom' },
          phase: 0,
          default: 4,
          get(this: Camera, value) {
            value.num[0] = this.bloomMaxDownsampleLevels;
          },
          set(this: Camera, value) {
            this.bloomMaxDownsampleLevels = value.num[0];
          }
        },
        {
          name: 'BloomDownsampleLimit',
          type: 'int',
          options: { minValue: 2, maxValue: 64, label: 'DownsampleLimit', group: 'PostProcessing/Bloom' },
          phase: 0,
          default: 32,
          get(this: Camera, value) {
            value.num[0] = this.bloomDownsampleLimit;
          },
          set(this: Camera, value) {
            this.bloomDownsampleLimit = value.num[0];
          }
        },
        {
          name: 'BloomThreshold',
          type: 'float',
          options: {
            animatable: true,
            minValue: 0,
            maxValue: 1,
            label: 'Threshold',
            group: 'PostProcessing/Bloom'
          },
          phase: 0,
          default: 0.8,
          get(this: Camera, value) {
            value.num[0] = this.bloomThreshold;
          },
          set(this: Camera, value) {
            this.bloomThreshold = value.num[0];
          }
        },
        {
          name: 'BloomThresholdKnee',
          type: 'float',
          options: {
            animatable: true,
            minValue: 0,
            maxValue: 1,
            label: 'ThresholdKnee',
            group: 'PostProcessing/Bloom'
          },
          phase: 0,
          default: 0,
          get(this: Camera, value) {
            value.num[0] = this.bloomThresholdKnee;
          },
          set(this: Camera, value) {
            this.bloomThresholdKnee = value.num[0];
          }
        },
        {
          name: 'BloomIntensity',
          type: 'float',
          options: {
            animatable: true,
            minValue: 0,
            maxValue: 8,
            label: 'Intensity',
            group: 'PostProcessing/Bloom'
          },
          phase: 0,
          default: 1,
          get(this: Camera, value) {
            value.num[0] = this.bloomIntensity;
          },
          set(this: Camera, value) {
            this.bloomIntensity = value.num[0];
          }
        },
        {
          name: 'FXAAEnabled',
          type: 'bool',
          phase: 0,
          default: true,
          options: {
            label: 'Enabled',
            group: 'PostProcessing/FXAA'
          },
          get(this: Camera, value) {
            value.bool[0] = this.FXAA;
          },
          set(this: Camera, value) {
            this.FXAA = value.bool[0];
          }
        },
        {
          name: 'TAAEnabled',
          type: 'bool',
          phase: 0,
          default: false,
          options: {
            label: 'Enabled',
            group: 'PostProcessing/TAA'
          },
          get(this: Camera, value) {
            value.bool[0] = this.TAA;
          },
          set(this: Camera, value) {
            this.TAA = value.bool[0];
          }
        },
        {
          name: 'TAADebug',
          type: 'int',
          phase: 1,
          options: {
            label: 'Debug',
            group: 'PostProcessing/TAA',
            enum: {
              labels: [
                'None',
                'Current Color',
                'History Color',
                'Velocity',
                'Edge',
                'Alpha',
                'Motion Vector',
                'Strength'
              ],
              values: [
                TAA_DEBUG_NONE,
                TAA_DEBUG_CURRENT_COLOR,
                TAA_DEBUG_HISTORY_COLOR,
                TAA_DEBUG_VELOCITY,
                TAA_DEBUG_EDGE,
                TAA_DEBUG_ALAPH,
                TAA_DEBUG_MOTION_VECTOR,
                TAA_DEBUG_STRENGTH
              ]
            }
          },
          default: TAA_DEBUG_NONE,
          get(this: Camera, value) {
            value.num[0] = this.TAADebug;
          },
          set(this: Camera, value) {
            this.TAADebug = value.num[0];
          },
          isValid() {
            return !!this.TAA;
          }
        },
        {
          name: 'MotionBlurEnabled',
          type: 'bool',
          phase: 0,
          default: false,
          options: {
            label: 'Enabled',
            group: 'PostProcessing/MotionBlur'
          },
          get(this: Camera, value) {
            value.bool[0] = this.motionBlur;
          },
          set(this: Camera, value) {
            this.motionBlur = value.bool[0];
          }
        },
        {
          name: 'MotionBlurStrength',
          type: 'float',
          phase: 1,
          default: 1,
          options: {
            label: 'Strength',
            group: 'PostProcessing/MotionBlur',
            animatable: true,
            minValue: 0,
            maxValue: 10
          },
          get(this: Camera, value) {
            value.num[0] = this.motionBlurStrength;
          },
          set(this: Camera, value) {
            this.motionBlurStrength = value.num[0];
          },
          isValid(this: Camera) {
            return this.motionBlur;
          }
        },
        {
          name: 'SSREnabled',
          type: 'bool',
          phase: 0,
          default: false,
          options: {
            label: 'Enabled',
            group: 'PostProcessing/SSR'
          },
          get(this: Camera, value) {
            value.bool[0] = this.SSR;
          },
          set(this: Camera, value) {
            this.SSR = value.bool[0];
          }
        },
        {
          name: 'SSRMaxRoughness',
          type: 'float',
          phase: 1,
          default: 0.8,
          options: {
            label: 'RoughnessThreshold',
            group: 'PostProcessing/SSR',
            minValue: 0,
            maxValue: 1
          },
          get(this: Camera, value) {
            value.num[0] = this.ssrMaxRoughness;
          },
          set(this: Camera, value) {
            this.ssrMaxRoughness = value.num[0];
          },
          isValid(this: Camera) {
            return this.SSR;
          }
        },
        {
          name: 'SSRRoughnessFactor',
          type: 'float',
          phase: 1,
          default: 1.0,
          options: {
            label: 'RoughnessFactor',
            group: 'PostProcessing/SSR',
            minValue: 0,
            maxValue: 1
          },
          get(this: Camera, value) {
            value.num[0] = this.ssrRoughnessFactor;
          },
          set(this: Camera, value) {
            this.ssrRoughnessFactor = value.num[0];
          },
          isValid(this: Camera) {
            return this.SSR;
          }
        },
        {
          name: 'SSRStride',
          type: 'int',
          phase: 1,
          default: 2,
          options: {
            label: 'Stride',
            group: 'PostProcessing/SSR',
            minValue: 1,
            maxValue: 32
          },
          get(this: Camera, value) {
            value.num[0] = this.ssrStride;
          },
          set(this: Camera, value) {
            this.ssrStride = value.num[0];
          },
          isValid(this: Camera) {
            return this.SSR && !this.HiZ;
          }
        },
        {
          name: 'SSRMaxDistance',
          type: 'float',
          phase: 1,
          default: 100,
          options: {
            label: 'MaxDistance',
            group: 'PostProcessing/SSR',
            minValue: 0,
            maxValue: 9999
          },
          get(this: Camera, value) {
            value.num[0] = this.ssrMaxDistance;
          },
          set(this: Camera, value) {
            this.ssrMaxDistance = value.num[0];
          },
          isValid(this: Camera) {
            return this.SSR;
          }
        },
        {
          name: 'SSRMaxSteps',
          type: 'int',
          phase: 1,
          default: 120,
          options: {
            label: 'MaxSteps',
            group: 'PostProcessing/SSR',
            minValue: 1,
            maxValue: 2000
          },
          get(this: Camera, value) {
            value.num[0] = this.ssrIterations;
          },
          set(this: Camera, value) {
            this.ssrIterations = value.num[0];
          },
          isValid(this: Camera) {
            return this.SSR;
          }
        },
        {
          name: 'SSRThickness',
          type: 'float',
          phase: 1,
          default: 0.5,
          options: {
            label: 'Thickness',
            group: 'PostProcessing/SSR',
            minValue: 0,
            maxValue: 8
          },
          get(this: Camera, value) {
            value.num[0] = this.ssrThickness;
          },
          set(this: Camera, value) {
            this.ssrThickness = value.num[0];
          },
          isValid(this: Camera) {
            return this.SSR;
          }
        },
        {
          name: 'SSRBlurScale',
          phase: 1,
          type: 'float',
          default: 0.05,
          options: {
            label: 'BlurScale',
            group: 'PostProcessing/SSR',
            minValue: 0,
            maxValue: 1
          },
          get(this: Camera, value) {
            value.num[0] = this.ssrBlurScale;
          },
          set(this: Camera, value) {
            this.ssrBlurScale = value.num[0];
          },
          isValid(this: Camera) {
            return this.SSR;
          }
        },
        {
          name: 'SSRBlurDepthCutoff',
          phase: 1,
          type: 'float',
          default: 2,
          options: {
            label: 'BlurDepthCutoff',
            group: 'PostProcessing/SSR',
            minValue: 0,
            maxValue: 8
          },
          get(this: Camera, value) {
            value.num[0] = this.ssrBlurDepthCutoff;
          },
          set(this: Camera, value) {
            this.ssrBlurDepthCutoff = value.num[0];
          },
          isValid(this: Camera) {
            return this.SSR;
          }
        },
        {
          name: 'SSRBlurKernelSize',
          type: 'int',
          phase: 1,
          default: 17,
          options: {
            label: 'BlurKernelSize',
            group: 'PostProcessing/SSR',
            minValue: 1,
            maxValue: 65
          },
          get(this: Camera, value) {
            value.num[0] = this.ssrBlurKernelSize;
          },
          set(this: Camera, value) {
            this.ssrBlurKernelSize = value.num[0];
          },
          isValid(this: Camera) {
            return this.SSR;
          }
        },
        {
          name: 'SSRBlurStdDev',
          type: 'float',
          phase: 1,
          default: 10,
          options: {
            label: 'BlurStdDev',
            group: 'PostProcessing/SSR',
            minValue: 0,
            maxValue: 100
          },
          get(this: Camera, value) {
            value.num[0] = this.ssrBlurStdDev;
          },
          set(this: Camera, value) {
            this.ssrBlurStdDev = value.num[0];
          },
          isValid(this: Camera) {
            return this.SSR;
          }
        },
        {
          name: 'SSRCalcThickness',
          type: 'bool',
          phase: 1,
          default: false,
          options: {
            label: 'CalcThickness',
            group: 'PostProcessing/SSR'
          },
          get(this: Camera, value) {
            value.bool[0] = this.ssrCalcThickness;
          },
          set(this: Camera, value) {
            this.ssrCalcThickness = value.bool[0];
          },
          isValid(this: Camera) {
            return this.SSR;
          }
        },
        {
          name: 'SSAOEnabled',
          type: 'bool',
          phase: 0,
          default: false,
          options: {
            label: 'Enabled',
            group: 'PostProcessing/SSAO'
          },
          get(this: Camera, value) {
            value.bool[0] = this.SSAO;
          },
          set(this: Camera, value) {
            this.SSAO = value.bool[0];
          }
        },
        {
          name: 'SSAOScale',
          type: 'float',
          phase: 0,
          default: 10,
          options: {
            label: 'Scale',
            group: 'PostProcessing/SSAO'
          },
          get(this: Camera, value) {
            value.num[0] = this.SSAOScale;
          },
          set(this: Camera, value) {
            this.SSAOScale = value.num[0];
          }
        },
        {
          name: 'SSAOBias',
          type: 'float',
          phase: 0,
          default: 1,
          options: {
            label: 'Bias',
            group: 'PostProcessing/SSAO'
          },
          get(this: Camera, value) {
            value.num[0] = this.SSAOBias;
          },
          set(this: Camera, value) {
            this.SSAOBias = value.num[0];
          }
        },
        {
          name: 'SSAORadius',
          type: 'float',
          phase: 0,
          default: 100,
          options: {
            label: 'Radius',
            group: 'PostProcessing/SSAO'
          },
          get(this: Camera, value) {
            value.num[0] = this.SSAORadius;
          },
          set(this: Camera, value) {
            this.SSAORadius = value.num[0];
          }
        },
        {
          name: 'SSAOIntensity',
          type: 'float',
          phase: 0,
          default: 2.5,
          options: {
            label: 'Intensity',
            group: 'PostProcessing/SSAO'
          },
          get(this: Camera, value) {
            value.num[0] = this.SSAOIntensity * 100;
          },
          set(this: Camera, value) {
            this.SSAOIntensity = value.num[0] * 0.01;
          }
        }
      ];
    }
  };
}

/** @internal */
export function getPerspectiveCameraClass(): SerializableClass {
  return {
    ctor: PerspectiveCamera,
    parent: Camera,
    createFunc(ctx: NodeHierarchy | SceneNode) {
      const node = new PerspectiveCamera(ctx.scene);
      if (ctx instanceof SceneNode) {
        node.parent = ctx;
      }
      return { obj: node };
    },
    getProps() {
      return [
        {
          name: 'FovVertical',
          type: 'float',
          default: Math.PI / 3,
          options: {
            minValue: 0,
            maxValue: Math.PI
          },
          get(this: PerspectiveCamera, value) {
            value.num[0] = this.fovY;
          },
          set(this: PerspectiveCamera, value) {
            this.fovY = value.num[0];
          }
        },
        {
          name: 'Near',
          type: 'float',
          default: 1,
          get(this: PerspectiveCamera, value) {
            value.num[0] = this.near;
          },
          set(this: PerspectiveCamera, value) {
            this.near = value.num[0];
          }
        },
        {
          name: 'Far',
          type: 'float',
          default: 1000,
          get(this: PerspectiveCamera, value) {
            value.num[0] = this.far;
          },
          set(this: PerspectiveCamera, value) {
            this.far = value.num[0];
          }
        }
      ];
    }
  };
}

/** @internal */
export function getOrthoCameraClass(): SerializableClass {
  return {
    ctor: OrthoCamera,
    parent: Camera,
    createFunc(ctx: NodeHierarchy | SceneNode) {
      const node = new OrthoCamera(ctx.scene);
      if (ctx instanceof SceneNode) {
        node.parent = ctx;
      }
      return { obj: node };
    },
    getProps() {
      return [
        {
          name: 'Left',
          type: 'float',
          default: -1,
          get(this: OrthoCamera, value) {
            value.num[0] = this.left;
          },
          set(this: OrthoCamera, value) {
            this.left = value.num[0];
          }
        },
        {
          name: 'Right',
          type: 'float',
          default: 1,
          get(this: OrthoCamera, value) {
            value.num[0] = this.right;
          },
          set(this: OrthoCamera, value) {
            this.right = value.num[0];
          }
        },
        {
          name: 'Bottom',
          type: 'float',
          default: -1,
          get(this: OrthoCamera, value) {
            value.num[0] = this.bottom;
          },
          set(this: OrthoCamera, value) {
            this.bottom = value.num[0];
          }
        },
        {
          name: 'Top',
          type: 'float',
          default: 1,
          get(this: OrthoCamera, value) {
            value.num[0] = this.top;
          },
          set(this: OrthoCamera, value) {
            this.top = value.num[0];
          }
        },
        {
          name: 'Near',
          type: 'float',
          default: -1,
          get(this: OrthoCamera, value) {
            value.num[0] = this.near;
          },
          set(this: OrthoCamera, value) {
            this.near = value.num[0];
          }
        },
        {
          name: 'Far',
          type: 'float',
          default: 1,
          get(this: OrthoCamera, value) {
            value.num[0] = this.far;
          },
          set(this: OrthoCamera, value) {
            this.far = value.num[0];
          }
        }
      ];
    }
  };
}
