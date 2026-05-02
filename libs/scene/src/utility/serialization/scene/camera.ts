import { defineProps, type SerializableClass } from '../types';
import type { CameraOITMode } from '../../../camera';
import { Camera, OrthoCamera, PerspectiveCamera } from '../../../camera';
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
    name: 'Camera',
    parent: SceneNode,
    createFunc(ctx: SceneNode) {
      const node = new Camera(ctx.scene);
      node.parent = ctx;
      return { obj: node };
    },
    getProps() {
      return defineProps([
        {
          name: 'UseScreenSettings',
          description: 'Whether this camera is adapted to screen settings',
          type: 'bool',
          default: false,
          get(this: Camera, value) {
            value.bool[0] = this.adapted;
          },
          set(this: Camera, value) {
            this.adapted = value.bool[0];
          }
        },
        {
          name: 'DesignWidth',
          description: 'Design width of screen settings',
          type: 'int',
          options: { minValue: 1 },
          default: 1280,
          isHidden(this: Camera) {
            return !this.adapted;
          },
          get(this: Camera, value) {
            value.num[0] = this.screenConfig.designWidth;
          },
          set(this: Camera, value) {
            this.screenConfig = { ...this.screenConfig, designWidth: value.num[0] };
          }
        },
        {
          name: 'DesignHeight',
          description: 'Design height of screen settings',
          type: 'int',
          options: { minValue: 1 },
          default: 720,
          isHidden(this: Camera) {
            return !this.adapted;
          },
          get(this: Camera, value) {
            value.num[0] = this.screenConfig.designHeight;
          },
          set(this: Camera, value) {
            this.screenConfig = { ...this.screenConfig, designHeight: value.num[0] };
          }
        },
        {
          name: 'ScreenScaleMode',
          description:
            'Scale mode of screen settings, valid values are `fit` | `cover` | `stretch` | `fit-width` | `fit-height`',
          type: 'string',
          default: 'cover',
          options: {
            enum: {
              labels: ['ShowAll', 'NoBorder', 'ExactFit', 'FixedWidth', 'FixedHeight'],
              values: ['fit', 'cover', 'stretch', 'fit-width', 'fit-height']
            }
          },
          isHidden(this: Camera) {
            return !this.adapted;
          },
          get(this: Camera, value) {
            value.str[0] = this.screenConfig.scaleMode;
          },
          set(this: Camera, value) {
            this.screenConfig = { ...this.screenConfig, scaleMode: value.str[0] as any };
          }
        },
        {
          name: 'HDR',
          description: 'If true, float point framebuffer will be used for rendering',
          type: 'bool',
          default: false,
          get(this: Camera, value) {
            value.bool[0] = this.HDR;
          },
          set(this: Camera, value) {
            this.HDR = value.bool[0];
          }
        },
        {
          name: 'HiZ',
          description: 'If true, HiZ rendering pass will be enabled',
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
          name: 'OITMode',
          description:
            'Which OIT mode should be used for transparent rendering, valid values are `none` | `weighted` | `abuffer`',
          type: 'string',
          default: 'none',
          options: {
            label: 'OIT',
            group: 'Rendering',
            enum: {
              labels: ['None', 'Weighted', 'ABuffer'],
              values: ['none', 'weighted', 'abuffer']
            }
          },
          get(this: Camera, value) {
            value.str[0] = this.oitMode;
          },
          set(this: Camera, value) {
            this.oitMode = value.str[0] as CameraOITMode;
          }
        },
        {
          name: 'ABufferLayers',
          description: 'Maximum layers for abuffer OIT',
          type: 'int',
          default: 20,
          options: {
            label: 'ABuffer Layers',
            group: 'Rendering',
            minValue: 1
          },
          get(this: Camera, value) {
            value.num[0] = this.oitABufferLayers;
          },
          set(this: Camera, value) {
            this.oitABufferLayers = value.num[0];
          },
          isValid(this: Camera) {
            return this.oitMode === 'abuffer';
          }
        },
        {
          name: 'ToneMapEnabled',
          description: 'If true, tonemap post-processing will be enabled',
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
          description: 'Exposure value for tonemapping',
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
          name: 'ColorAdjustEnabled',
          description: `If true, color adjust post-processing will be enabled`,
          type: 'bool',
          phase: 0,
          default: false,
          options: {
            label: 'Enabled',
            group: 'PostProcessing/ColorAdjust'
          },
          get(this: Camera, value) {
            value.bool[0] = this.colorAdjust;
          },
          set(this: Camera, value) {
            this.colorAdjust = value.bool[0];
          }
        },
        {
          name: 'ColorAdjustSaturation',
          description: 'Saturation value for color adjust post-processing',
          type: 'float',
          phase: 1,
          default: 1,
          options: {
            label: 'Saturation',
            group: 'PostProcessing/ColorAdjust',
            minValue: 0,
            maxValue: 2,
            animatable: true
          },
          get(this: Camera, value) {
            value.num[0] = this.colorAdjustSaturation;
          },
          set(this: Camera, value) {
            this.colorAdjustSaturation = value.num[0];
          },
          isValid(this: Camera) {
            return this.colorAdjust;
          }
        },
        {
          name: 'ColorAdjustContrast',
          description: 'Contrast value for color adjust post-processing',
          type: 'float',
          phase: 1,
          default: 1,
          options: {
            label: 'Contrast',
            group: 'PostProcessing/ColorAdjust',
            minValue: 0,
            maxValue: 2,
            animatable: true
          },
          get(this: Camera, value) {
            value.num[0] = this.colorAdjustContrast;
          },
          set(this: Camera, value) {
            this.colorAdjustContrast = value.num[0];
          },
          isValid(this: Camera) {
            return this.colorAdjust;
          }
        },
        {
          name: 'ColorAdjustHue',
          description: 'Hue value for color adjust post-processing',
          type: 'float',
          phase: 1,
          default: 0,
          options: {
            label: 'Hue',
            group: 'PostProcessing/ColorAdjust',
            minValue: -1,
            maxValue: 1,
            animatable: true
          },
          get(this: Camera, value) {
            value.num[0] = this.colorAdjustHue / 180;
          },
          set(this: Camera, value) {
            this.colorAdjustHue = value.num[0] * 180;
          },
          isValid(this: Camera) {
            return this.colorAdjust;
          }
        },
        {
          name: 'Sharpen',
          description: 'Sharpen value for color adjust post-processing',
          type: 'float',
          phase: 1,
          default: 0,
          options: {
            label: 'Sharpen',
            group: 'PostProcessing/ColorAdjust',
            minValue: 0,
            maxValue: 2,
            animatable: true
          },
          get(this: Camera, value) {
            value.num[0] = this.colorAdjustSharpen;
          },
          set(this: Camera, value) {
            this.colorAdjustSharpen = value.num[0];
          },
          isValid(this: Camera) {
            return this.colorAdjust;
          }
        },
        {
          name: 'BloomEnabled',
          description: 'If true, bloom post-processing will be enabled',
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
          description: 'Maximum downsample levels for bloom post-processing',
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
          description: 'Minimum downsample framebuffer resolution for bloom post-processing',
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
          description: 'Color threshold for bloom post-processing',
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
          description: 'Color threshold-knee value for bloom post-processing',
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
          description: 'Intensity value for bloom post-processing',
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
          description: 'If true, FXAA post-processing will be enabled',
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
          description: 'If true, TAA post-processing will be enabled',
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
          description: 'Debug channel for TAA post-processing',
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
          description: 'If true, motion blur post-processing will be enabled',
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
          description: 'Strength value for motion blur post-processing',
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
          description: 'If true, SSR post-processing will be enabled',
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
          description: 'Maximum roughness value for SSR post-processing',
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
          description: 'Global roughness multiplier for debugging',
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
          description: 'How many pixels per step for screen-space ray tracing, no effect if HiZ is enabled',
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
          description: 'Maximum distance in pixels for screen-space ray tracing',
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
          description: 'Maximum steps for screen-space ray tracing',
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
          description: 'Thickness value for screen-space ray tracing',
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
          description: 'Scale value of bilateral blur for SSR post-processing',
          phase: 1,
          type: 'float',
          default: 0.01,
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
          description: 'Depth cutoff of bilateral blur for SSR post-processing',
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
          description: 'Kernel size of bilateral blur for SSR post-processing',
          type: 'int',
          phase: 1,
          default: 10,
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
          description: 'Stddev of bilateral blur for SSR post-processing',
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
          description: 'If true, automatically calculate thickness for screen-space ray tracing',
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
          description: 'If true, SAO post-processing will be enabled',
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
          description: 'Scale value for SAO post-processing',
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
          description: 'Bias value for SAO post-processing',
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
          description: 'Radius value for SAO post-processing',
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
          description: 'Intensity value for SAO post-processing',
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
      ]);
    }
  };
}

/** @internal */
export function getPerspectiveCameraClass(): SerializableClass {
  return {
    ctor: PerspectiveCamera,
    parent: Camera,
    name: 'PerspectiveCamera',
    createFunc(ctx: SceneNode) {
      const node = new PerspectiveCamera(ctx.scene);
      node.parent = ctx;
      return { obj: node };
    },
    getProps() {
      return defineProps([
        {
          name: 'FovVertical',
          description: 'Vertical FOV in radians',
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
          description: 'Near clip plane',
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
          description: 'Far clip plane',
          type: 'float',
          default: 1000,
          get(this: PerspectiveCamera, value) {
            value.num[0] = this.far;
          },
          set(this: PerspectiveCamera, value) {
            this.far = value.num[0];
          }
        },
        {
          name: 'AutoAspect',
          description: 'If true, automatically determine aspect ratio',
          type: 'bool',
          default: true,
          get(this: PerspectiveCamera, value) {
            value.bool[0] = this.autoAspect;
          },
          set(this: PerspectiveCamera, value) {
            this.autoAspect = value.bool[0];
          }
        }
      ]);
    }
  };
}

/** @internal */
export function getOrthoCameraClass(): SerializableClass {
  return {
    ctor: OrthoCamera,
    parent: Camera,
    name: 'OrthoCamera',
    createFunc(ctx: SceneNode) {
      const node = new OrthoCamera(ctx.scene!);
      node.parent = ctx;
      return { obj: node };
    },
    getProps() {
      return defineProps([
        {
          name: 'Left',
          description: 'Left clip plane',
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
          description: 'Right clip plane',
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
          description: 'Bottom clip plane',
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
          description: 'Top clip plane',
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
          description: 'Near clip plane',
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
          description: 'Far clip plane',
          type: 'float',
          default: 1,
          get(this: OrthoCamera, value) {
            value.num[0] = this.far;
          },
          set(this: OrthoCamera, value) {
            this.far = value.num[0];
          }
        }
      ]);
    }
  };
}
