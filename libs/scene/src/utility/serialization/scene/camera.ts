import type { SerializableClass } from '../types';
import { Camera, OrthoCamera, PerspectiveCamera } from '../../../camera';
import type { NodeHierarchy } from './node';
import type { AssetRegistry } from '../asset/asset';
import { SceneNode } from '../../../scene';
import {
  TAA_DEBUG_ALAPH,
  TAA_DEBUG_CURRENT_COLOR,
  TAA_DEBUG_EDGE,
  TAA_DEBUG_HISTORY_COLOR,
  TAA_DEBUG_MOTION_VECTOR,
  TAA_DEBUG_NONE,
  TAA_DEBUG_VELOCITY
} from '../../../shaders';

export function getCameraClass(assetRegistry: AssetRegistry): SerializableClass {
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
          name: 'ClearColor',
          type: 'rgba',
          default: [0, 0, 0, 1],
          get(this: Camera, value) {
            value.num[0] = this.clearColor.x;
            value.num[1] = this.clearColor.y;
            value.num[2] = this.clearColor.z;
            value.num[3] = this.clearColor.w;
          },
          set(this: Camera, value) {
            this.clearColor.setXYZW(value.num[0], value.num[1], value.num[2], value.num[3]);
          }
        },
        {
          name: 'ToneMapEnabled',
          label: 'Enabled',
          group: 'PostProcessing/ToneMap',
          type: 'bool',
          phase: 0,
          default: true,
          get(this: Camera, value) {
            value.bool[0] = this.toneMap;
          },
          set(this: Camera, value) {
            this.toneMap = value.bool[0];
          }
        },
        {
          name: 'ToneMapExposure',
          label: 'Exposure',
          group: 'PostProcessing/ToneMap',
          type: 'float',
          options: { minValue: 0, maxValue: 8 },
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
          label: 'Enabled',
          group: 'PostProcessing/Bloom',
          type: 'bool',
          phase: 0,
          default: true,
          get(this: Camera, value) {
            value.bool[0] = this.bloom;
          },
          set(this: Camera, value) {
            this.bloom = value.bool[0];
          }
        },
        {
          name: 'BloomMaxDownsampleLevels',
          label: 'MaxDownsampleLevels',
          group: 'PostProcessing/Bloom',
          type: 'int',
          options: { minValue: 0, maxValue: 8 },
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
          label: 'DownsampleLimit',
          group: 'PostProcessing/Bloom',
          type: 'int',
          options: { minValue: 2, maxValue: 64 },
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
          label: 'Threshold',
          group: 'PostProcessing/Bloom',
          type: 'float',
          animatable: true,
          options: { minValue: 0, maxValue: 1 },
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
          label: 'ThresholdKnee',
          group: 'PostProcessing/Bloom',
          type: 'float',
          animatable: true,
          options: { minValue: 0, maxValue: 1 },
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
          label: 'Intensity',
          group: 'PostProcessing/Bloom',
          type: 'float',
          animatable: true,
          options: { minValue: 0, maxValue: 8 },
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
          label: 'Enabled',
          group: 'PostProcessing/FXAA',
          type: 'bool',
          phase: 0,
          default: true,
          get(this: Camera, value) {
            value.bool[0] = this.FXAA;
          },
          set(this: Camera, value) {
            this.FXAA = value.bool[0];
          }
        },
        {
          name: 'TAAEnabled',
          label: 'Enabled',
          group: 'PostProcessing/TAA',
          type: 'bool',
          phase: 0,
          default: false,
          get(this: Camera, value) {
            value.bool[0] = this.TAA;
          },
          set(this: Camera, value) {
            this.TAA = value.bool[0];
          }
        },
        {
          name: 'TAADebug',
          label: 'Debug',
          group: 'PostProcessing/TAA',
          type: 'int',
          phase: 1,
          enum: {
            labels: ['None', 'Current Color', 'History Color', 'Velocity', 'Edge', 'Alpha', 'Motion Vector'],
            values: [
              TAA_DEBUG_NONE,
              TAA_DEBUG_CURRENT_COLOR,
              TAA_DEBUG_HISTORY_COLOR,
              TAA_DEBUG_VELOCITY,
              TAA_DEBUG_EDGE,
              TAA_DEBUG_ALAPH,
              TAA_DEBUG_MOTION_VECTOR
            ]
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
          name: 'TAABlendFactor',
          label: 'BlendFactor',
          group: 'PostProcessing/TAA',
          type: 'float',
          phase: 1,
          options: {
            minValue: 0,
            maxValue: 1
          },
          default: 1 / 16,
          get(this: Camera, value) {
            value.num[0] = this.TAABlendFactor;
          },
          set(this: Camera, value) {
            this.TAABlendFactor = value.num[0];
          },
          isValid() {
            return !!this.TAA;
          }
        },
        {
          name: 'MotionBlurEnabled',
          label: 'Enabled',
          group: 'PostProcessing/MotionBlur',
          type: 'bool',
          phase: 0,
          default: false,
          get(this: Camera, value) {
            value.bool[0] = this.motionBlur;
          },
          set(this: Camera, value) {
            this.motionBlur = value.bool[0];
          }
        },
        {
          name: 'MotionBlurStrength',
          label: 'Strength',
          group: 'PostProcessing/MotionBlur',
          type: 'float',
          animatable: true,
          phase: 1,
          default: 1,
          options: {
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
          label: 'Enabled',
          group: 'PostProcessing/SSR',
          type: 'bool',
          phase: 0,
          default: false,
          get(this: Camera, value) {
            value.bool[0] = this.SSR;
          },
          set(this: Camera, value) {
            this.SSR = value.bool[0];
          }
        },
        {
          name: 'SSRMaxRoughness',
          label: 'RoughnessThreshold',
          group: 'PostProcessing/SSR',
          type: 'float',
          phase: 1,
          default: 0.8,
          options: {
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
          label: 'RoughnessFactor',
          group: 'PostProcessing/SSR',
          type: 'float',
          phase: 1,
          default: 1.0,
          options: {
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
          label: 'Stride',
          group: 'PostProcessing/SSR',
          type: 'int',
          phase: 1,
          default: 2,
          options: {
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
          label: 'MaxDistance',
          group: 'PostProcessing/SSR',
          type: 'float',
          phase: 1,
          default: 100,
          options: {
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
          label: 'MaxSteps',
          group: 'PostProcessing/SSR',
          type: 'int',
          phase: 1,
          default: 120,
          options: {
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
          label: 'Thickness',
          group: 'PostProcessing/SSR',
          type: 'float',
          phase: 1,
          default: 0.5,
          options: {
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
          label: 'BlurScale',
          group: 'PostProcessing/SSR',
          phase: 1,
          type: 'float',
          default: 0.05,
          options: {
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
          label: 'BlurDepthCutoff',
          group: 'PostProcessing/SSR',
          phase: 1,
          type: 'float',
          default: 2,
          options: {
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
          label: 'BlurKernelSize',
          group: 'PostProcessing/SSR',
          type: 'int',
          phase: 1,
          default: 17,
          options: {
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
          label: 'BlurStdDev',
          group: 'PostProcessing/SSR',
          type: 'float',
          phase: 1,
          default: 10,
          options: {
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
          label: 'CalcThickness',
          group: 'PostProcessing/SSR',
          type: 'bool',
          phase: 1,
          default: false,
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
          label: 'Enabled',
          group: 'PostProcessing/SSAO',
          type: 'bool',
          phase: 0,
          default: false,
          get(this: Camera, value) {
            value.bool[0] = this.SSAO;
          },
          set(this: Camera, value) {
            this.SSAO = value.bool[0];
          }
        },
        {
          name: 'SSAOScale',
          label: 'Scale',
          group: 'PostProcessing/SSAO',
          type: 'float',
          phase: 0,
          default: 10,
          get(this: Camera, value) {
            value.num[0] = this.SSAOScale;
          },
          set(this: Camera, value) {
            this.SSAOScale = value.num[0];
          }
        },
        {
          name: 'SSAOBias',
          label: 'Bias',
          group: 'PostProcessing/SSAO',
          type: 'float',
          phase: 0,
          default: 1,
          get(this: Camera, value) {
            value.num[0] = this.SSAOBias;
          },
          set(this: Camera, value) {
            this.SSAOBias = value.num[0];
          }
        },
        {
          name: 'SSAORadius',
          label: 'Radius',
          group: 'PostProcessing/SSAO',
          type: 'float',
          phase: 0,
          default: 100,
          get(this: Camera, value) {
            value.num[0] = this.SSAORadius;
          },
          set(this: Camera, value) {
            this.SSAORadius = value.num[0];
          }
        },
        {
          name: 'SSAOIntensity',
          label: 'Intensity',
          group: 'PostProcessing/SSAO',
          type: 'float',
          phase: 0,
          default: 2.5,
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

export function getPerspectiveCameraClass(assetRegistry: AssetRegistry): SerializableClass {
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

export function getOrthoCameraClass(assetRegistry: AssetRegistry): SerializableClass {
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
