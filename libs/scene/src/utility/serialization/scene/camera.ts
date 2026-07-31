import { defineProps, type SerializableClass } from '../types';
import { Camera, OrthoCamera, PerspectiveCamera } from '../../../camera';
import type { CameraOITMode, SSGIQualityPreset, SSSDebugView, SSSQualityPreset } from '../../../camera';
import { SceneNode } from '../../../scene';
import type { CameraProjectionMode, CameraSensorFit } from '../../physical';
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
          name: 'ScreenSpaceShadow',
          type: 'bool',
          default: true,
          get(this: Camera, value) {
            value.bool[0] = this.screenSpaceShadowMask;
          },
          set(this: Camera, value) {
            this.screenSpaceShadowMask = value.bool[0];
          }
        },
        {
          name: 'OITMode',
          type: 'string',
          default: 'none',
          options: {
            label: 'OIT',
            group: 'Rendering',
            enum: {
              labels: ['None', 'Weighted', 'ABuffer', 'DualDepthPeeling'],
              values: ['none', 'weighted', 'abuffer', 'dual-depth']
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
          name: 'DualDepthPeels',
          type: 'int',
          default: 8,
          options: {
            label: 'Depth Peels',
            group: 'Rendering',
            minValue: 1
          },
          get(this: Camera, value) {
            value.num[0] = this.oitDualDepthPeels;
          },
          set(this: Camera, value) {
            this.oitDualDepthPeels = value.num[0];
          },
          isValid(this: Camera) {
            return this.oitMode === 'dual-depth';
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
          },
          isHidden(this: Camera) {
            return this.scene?.lightingMode === 'physical';
          }
        },
        {
          name: 'Aperture',
          type: 'float',
          phase: 1,
          default: 16,
          options: {
            label: 'Aperture (f-number)',
            group: 'PostProcessing/ToneMap',
            minValue: 0.1,
            maxValue: 64,
            animatable: true
          },
          get(this: Camera, value) {
            value.num[0] = this.aperture;
          },
          set(this: Camera, value) {
            this.aperture = value.num[0];
          },
          isHidden(this: Camera) {
            return this.scene?.lightingMode !== 'physical';
          }
        },
        {
          name: 'ShutterSpeed',
          description: 'Shutter-open time in seconds',
          type: 'float',
          phase: 1,
          default: 1 / 125,
          options: {
            label: 'Shutter (seconds)',
            group: 'PostProcessing/ToneMap',
            minValue: 0.000001,
            maxValue: 60,
            animatable: true
          },
          get(this: Camera, value) {
            value.num[0] = this.shutterSpeed;
          },
          set(this: Camera, value) {
            this.shutterSpeed = value.num[0];
          },
          isHidden(this: Camera) {
            return this.scene?.lightingMode !== 'physical';
          }
        },
        {
          name: 'ISO',
          type: 'float',
          phase: 1,
          default: 100,
          options: {
            group: 'PostProcessing/ToneMap',
            minValue: 1,
            maxValue: 204800,
            animatable: true
          },
          get(this: Camera, value) {
            value.num[0] = this.ISO;
          },
          set(this: Camera, value) {
            this.ISO = value.num[0];
          },
          isHidden(this: Camera) {
            return this.scene?.lightingMode !== 'physical';
          }
        },
        {
          name: 'ExposureCompensation',
          description: 'Exposure compensation in stops',
          type: 'float',
          phase: 1,
          default: 0,
          options: {
            label: 'Compensation (EV)',
            group: 'PostProcessing/ToneMap',
            minValue: -10,
            maxValue: 10,
            animatable: true
          },
          get(this: Camera, value) {
            value.num[0] = this.exposureCompensation;
          },
          set(this: Camera, value) {
            this.exposureCompensation = value.num[0];
          },
          isHidden(this: Camera) {
            return this.scene?.lightingMode !== 'physical';
          }
        },
        {
          name: 'ColorAdjustEnabled',
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
          description:
            'Luminance above which a pixel blooms. Under physical lighting the buffer is camera ' +
            'pre-exposed, where 0.8 is roughly a white surface in direct sunlight; lower it for a ' +
            'more pronounced glow.',
          type: 'float',
          options: {
            animatable: true,
            minValue: 0,
            // Not capped at 1: physical scenes legitimately threshold above sunlit white to
            // restrict blooming to genuine emitters.
            maxValue: 8,
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
          default: false,
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
          name: 'SSGIEnabled',
          type: 'bool',
          phase: 0,
          default: false,
          options: { label: 'Enabled', group: 'PostProcessing/SSGI' },
          get(this: Camera, value) {
            value.bool[0] = this.SSGI;
          },
          set(this: Camera, value) {
            this.SSGI = value.bool[0];
          }
        },
        {
          name: 'SSGIQualityPreset',
          type: 'string',
          phase: 1,
          default: 'quality',
          options: {
            label: 'Quality',
            group: 'PostProcessing/SSGI',
            enum: {
              labels: ['Quality', 'Balanced', 'Performance', 'Custom'],
              values: ['quality', 'balanced', 'performance', 'custom']
            }
          },
          get(this: Camera, value) {
            value.str[0] = this.ssgiQualityPreset;
          },
          set(this: Camera, value) {
            this.ssgiQualityPreset = value.str[0] as SSGIQualityPreset;
          },
          isValid(this: Camera) {
            return this.SSGI;
          }
        },
        {
          name: 'SSGIHalfResolution',
          type: 'bool',
          phase: 2,
          default: false,
          options: {
            label: 'HalfResolution',
            group: 'PostProcessing/SSGI'
          },
          get(this: Camera, value) {
            value.bool[0] = this.ssgiHalfResolution;
          },
          set(this: Camera, value) {
            this.ssgiHalfResolution = value.bool[0];
          },
          isValid(this: Camera) {
            return this.SSGI && this.ssgiQualityPreset === 'custom';
          }
        },
        {
          name: 'SSGIRaysPerPixel',
          type: 'int',
          phase: 2,
          default: 2,
          options: {
            label: 'RaysPerPixel',
            group: 'PostProcessing/SSGI',
            minValue: 1,
            maxValue: 4
          },
          get(this: Camera, value) {
            value.num[0] = this.ssgiRaysPerPixel;
          },
          set(this: Camera, value) {
            this.ssgiRaysPerPixel = value.num[0];
          },
          isValid(this: Camera) {
            return this.SSGI && this.ssgiQualityPreset === 'custom';
          }
        },
        {
          name: 'SSGIMaxSteps',
          type: 'int',
          phase: 2,
          default: 64,
          options: {
            label: 'MaxSteps',
            group: 'PostProcessing/SSGI',
            minValue: 1,
            maxValue: 256
          },
          get(this: Camera, value) {
            value.num[0] = this.ssgiMaxSteps;
          },
          set(this: Camera, value) {
            this.ssgiMaxSteps = value.num[0];
          },
          isValid(this: Camera) {
            return this.SSGI && this.ssgiQualityPreset === 'custom';
          }
        },
        {
          name: 'SSGIDenoisePasses',
          type: 'int',
          phase: 2,
          default: 3,
          options: {
            label: 'DenoisePasses',
            group: 'PostProcessing/SSGI',
            minValue: 0,
            maxValue: 5
          },
          get(this: Camera, value) {
            value.num[0] = this.ssgiDenoisePasses;
          },
          set(this: Camera, value) {
            this.ssgiDenoisePasses = value.num[0];
          },
          isValid(this: Camera) {
            return this.SSGI && this.ssgiQualityPreset === 'custom';
          }
        },
        {
          name: 'SSGIIntensity',
          type: 'float',
          phase: 1,
          default: 0.7,
          options: {
            label: 'Intensity',
            group: 'PostProcessing/SSGI',
            minValue: 0,
            maxValue: 4,
            animatable: true
          },
          get(this: Camera, value) {
            value.num[0] = this.ssgiIntensity;
          },
          set(this: Camera, value) {
            this.ssgiIntensity = value.num[0];
          },
          isValid(this: Camera) {
            return this.SSGI;
          }
        },
        {
          name: 'SSGIAOIntensity',
          type: 'float',
          phase: 1,
          default: 0.8,
          options: {
            label: 'AO intensity',
            group: 'PostProcessing/SSGI',
            minValue: 0,
            maxValue: 1,
            animatable: true
          },
          get(this: Camera, value) {
            value.num[0] = this.ssgiAOIntensity;
          },
          set(this: Camera, value) {
            this.ssgiAOIntensity = value.num[0];
          },
          isValid(this: Camera) {
            return this.SSGI;
          }
        },
        {
          name: 'SSGIAOPower',
          type: 'float',
          phase: 1,
          default: 1,
          options: {
            label: 'AO contrast',
            group: 'PostProcessing/SSGI',
            minValue: 0.01,
            maxValue: 4,
            animatable: true
          },
          get(this: Camera, value) {
            value.num[0] = this.ssgiAOPower;
          },
          set(this: Camera, value) {
            this.ssgiAOPower = value.num[0];
          },
          isValid(this: Camera) {
            return this.SSGI;
          }
        },
        {
          name: 'SSGISkyOcclusion',
          type: 'float',
          phase: 1,
          default: 1,
          options: {
            label: 'Sky occlusion',
            group: 'PostProcessing/SSGI',
            minValue: 0,
            maxValue: 1,
            animatable: true
          },
          get(this: Camera, value) {
            value.num[0] = this.ssgiSkyOcclusion;
          },
          set(this: Camera, value) {
            this.ssgiSkyOcclusion = value.num[0];
          },
          isValid(this: Camera) {
            return this.SSGI;
          }
        },
        {
          name: 'SSGIMaxDistance',
          type: 'float',
          phase: 1,
          default: 32,
          options: {
            label: 'MaxDistance',
            group: 'PostProcessing/SSGI',
            minValue: 0.1,
            maxValue: 512
          },
          get(this: Camera, value) {
            value.num[0] = this.ssgiMaxDistance;
          },
          set(this: Camera, value) {
            this.ssgiMaxDistance = value.num[0];
          },
          isValid(this: Camera) {
            return this.SSGI;
          }
        },
        {
          name: 'SSGIThickness',
          type: 'float',
          phase: 1,
          default: 0.5,
          options: {
            label: 'Thickness',
            group: 'PostProcessing/SSGI',
            minValue: 0.001,
            maxValue: 8
          },
          get(this: Camera, value) {
            value.num[0] = this.ssgiThickness;
          },
          set(this: Camera, value) {
            this.ssgiThickness = value.num[0];
          },
          isValid(this: Camera) {
            return this.SSGI;
          }
        },
        {
          name: 'SSGIStride',
          type: 'int',
          phase: 1,
          default: 1,
          options: {
            label: 'Stride',
            group: 'PostProcessing/SSGI',
            minValue: 1,
            maxValue: 16
          },
          get(this: Camera, value) {
            value.num[0] = this.ssgiStride;
          },
          set(this: Camera, value) {
            this.ssgiStride = value.num[0];
          },
          isValid(this: Camera) {
            return this.SSGI;
          }
        },
        {
          name: 'SSGIMaxRayIntensity',
          description: 'Maximum ray radiance after camera exposure in physical lighting mode',
          type: 'float',
          phase: 1,
          default: 10,
          options: {
            label: 'MaxRayIntensity',
            group: 'PostProcessing/SSGI',
            minValue: 0,
            maxValue: 64
          },
          get(this: Camera, value) {
            value.num[0] = this.ssgiMaxRayIntensity;
          },
          set(this: Camera, value) {
            this.ssgiMaxRayIntensity = value.num[0];
          },
          isValid(this: Camera) {
            return this.SSGI;
          }
        },
        {
          name: 'SSGITemporalEnabled',
          type: 'bool',
          phase: 1,
          default: true,
          options: { label: 'Temporal', group: 'PostProcessing/SSGI' },
          get(this: Camera, value) {
            value.bool[0] = this.ssgiTemporal;
          },
          set(this: Camera, value) {
            this.ssgiTemporal = value.bool[0];
          },
          isValid(this: Camera) {
            return this.SSGI;
          }
        },
        {
          name: 'SSGITemporalWeight',
          type: 'float',
          phase: 1,
          default: 0.94,
          options: {
            label: 'TemporalWeight',
            group: 'PostProcessing/SSGI',
            minValue: 0,
            maxValue: 0.99
          },
          get(this: Camera, value) {
            value.num[0] = this.ssgiTemporalWeight;
          },
          set(this: Camera, value) {
            this.ssgiTemporalWeight = value.num[0];
          },
          isValid(this: Camera) {
            return this.SSGI && this.ssgiTemporal;
          }
        },
        {
          name: 'SSGIDepthReject',
          type: 'float',
          phase: 1,
          default: 0.5,
          options: {
            label: 'DepthReject',
            group: 'PostProcessing/SSGI',
            minValue: 0,
            maxValue: 4
          },
          get(this: Camera, value) {
            value.num[0] = this.ssgiDepthReject;
          },
          set(this: Camera, value) {
            this.ssgiDepthReject = value.num[0];
          },
          isValid(this: Camera) {
            return this.SSGI;
          }
        },
        {
          name: 'SSGINormalReject',
          type: 'float',
          phase: 1,
          default: 0.75,
          options: {
            label: 'NormalReject',
            group: 'PostProcessing/SSGI',
            minValue: -1,
            maxValue: 1
          },
          get(this: Camera, value) {
            value.num[0] = this.ssgiNormalReject;
          },
          set(this: Camera, value) {
            this.ssgiNormalReject = value.num[0];
          },
          isValid(this: Camera) {
            return this.SSGI;
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
          name: 'SSRTemporal',
          type: 'bool',
          phase: 1,
          default: true,
          options: {
            label: 'Temporal',
            group: 'PostProcessing/SSR'
          },
          get(this: Camera, value) {
            value.bool[0] = this.ssrTemporal;
          },
          set(this: Camera, value) {
            this.ssrTemporal = value.bool[0];
          },
          isValid(this: Camera) {
            return this.SSR;
          }
        },
        {
          name: 'SSRTemporalWeight',
          type: 'float',
          phase: 1,
          default: 0.85,
          options: {
            label: 'TemporalWeight',
            group: 'PostProcessing/SSR',
            minValue: 0,
            maxValue: 1
          },
          get(this: Camera, value) {
            value.num[0] = this.ssrTemporalWeight;
          },
          set(this: Camera, value) {
            this.ssrTemporalWeight = value.num[0];
          },
          isValid(this: Camera) {
            return this.SSR && this.ssrTemporal;
          }
        },
        {
          name: 'SSSEnabled',
          type: 'bool',
          phase: 0,
          default: false,
          options: {
            label: 'Enabled',
            group: 'PostProcessing/SSS'
          },
          get(this: Camera, value) {
            value.bool[0] = this.SSS;
          },
          set(this: Camera, value) {
            this.SSS = value.bool[0];
          }
        },
        {
          name: 'SSSQualityPreset',
          type: 'string',
          phase: 0,
          default: 'balanced',
          options: {
            label: 'QualityPreset',
            group: 'PostProcessing/SSS',
            enum: {
              labels: ['Quality', 'Balanced', 'Performance'],
              values: ['quality', 'balanced', 'performance']
            }
          },
          get(this: Camera, value) {
            value.str[0] = this.sssQualityPreset;
          },
          set(this: Camera, value) {
            this.sssQualityPreset = value.str[0] as SSSQualityPreset;
          },
          isValid(this: Camera) {
            return this.SSS;
          }
        },
        {
          name: 'SSSBlurScale',
          type: 'float',
          phase: 0,
          default: 11,
          options: {
            label: 'BlurScale',
            group: 'PostProcessing/SSS',
            minValue: 0,
            maxValue: 64
          },
          get(this: Camera, value) {
            value.num[0] = this.sssBlurScale;
          },
          set(this: Camera, value) {
            this.sssBlurScale = value.num[0];
          },
          isValid(this: Camera) {
            return this.SSS;
          }
        },
        {
          name: 'SSSStrength',
          type: 'float',
          phase: 0,
          default: 0.65,
          options: {
            label: 'Strength',
            group: 'PostProcessing/SSS',
            minValue: 0,
            maxValue: 4
          },
          get(this: Camera, value) {
            value.num[0] = this.sssStrength;
          },
          set(this: Camera, value) {
            this.sssStrength = value.num[0];
          },
          isValid(this: Camera) {
            return this.SSS;
          }
        },
        {
          name: 'SSSTransmissionStrength',
          type: 'float',
          phase: 0,
          default: 0.18,
          options: {
            label: 'Transmission',
            group: 'PostProcessing/SSS',
            minValue: 0,
            maxValue: 4
          },
          get(this: Camera, value) {
            value.num[0] = this.sssTransmissionStrength;
          },
          set(this: Camera, value) {
            this.sssTransmissionStrength = value.num[0];
          },
          isValid(this: Camera) {
            return this.SSS;
          }
        },
        {
          name: 'SSSTransmissionPower',
          type: 'float',
          phase: 0,
          default: 2.1,
          options: {
            label: 'TransmissionPower',
            group: 'PostProcessing/SSS',
            minValue: 0.1,
            maxValue: 8
          },
          get(this: Camera, value) {
            value.num[0] = this.sssTransmissionPower;
          },
          set(this: Camera, value) {
            this.sssTransmissionPower = value.num[0];
          },
          isValid(this: Camera) {
            return this.SSS;
          }
        },
        {
          name: 'SSSMultiScatter',
          type: 'float',
          phase: 0,
          default: 0.08,
          options: {
            label: 'MultiScatter',
            group: 'PostProcessing/SSS',
            minValue: 0,
            maxValue: 2
          },
          get(this: Camera, value) {
            value.num[0] = this.sssMultiScatter;
          },
          set(this: Camera, value) {
            this.sssMultiScatter = value.num[0];
          },
          isValid(this: Camera) {
            return this.SSS;
          }
        },
        {
          name: 'SSSDebugView',
          type: 'string',
          phase: 0,
          default: 'none',
          options: {
            label: 'DebugView',
            group: 'PostProcessing/SSS',
            enum: {
              labels: [
                'None',
                'ScatterMask',
                'ScatterSoftness',
                'ScatterRadius',
                'ScatterFalloff',
                'ProfileEnergy',
                'ProfileTransmission',
                'ProfileBoundary',
                'Diffuse',
                'Blur',
                'ScreenThinness',
                'ThinTransmissionMask',
                'ThinLighting',
                'TransmissionShadow'
              ],
              values: [
                'none',
                'scatter_mask',
                'scatter_softness',
                'scatter_radius',
                'scatter_falloff',
                'profile_energy',
                'profile_transmission',
                'profile_boundary',
                'diffuse',
                'blur',
                'screen_thinness',
                'thin_transmission_mask',
                'thin_lighting',
                'transmission_shadow'
              ]
            }
          },
          get(this: Camera, value) {
            value.str[0] = this.sssDebugView;
          },
          set(this: Camera, value) {
            this.sssDebugView = value.str[0] as SSSDebugView;
          },
          isValid(this: Camera) {
            return this.SSS;
          }
        },
        {
          name: 'SkinSSSEnabled',
          type: 'bool',
          phase: 0,
          default: false,
          options: {
            label: 'Enabled',
            group: 'PostProcessing/SkinSSS'
          },
          get(this: Camera, value) {
            value.bool[0] = this.skinSSS;
          },
          set(this: Camera, value) {
            this.skinSSS = value.bool[0];
          }
        },
        {
          name: 'SkinSSSStrength',
          type: 'float',
          phase: 0,
          default: 1,
          options: {
            label: 'Strength',
            group: 'PostProcessing/SkinSSS',
            minValue: 0,
            maxValue: 4
          },
          get(this: Camera, value) {
            value.num[0] = this.skinSSSStrength;
          },
          set(this: Camera, value) {
            this.skinSSSStrength = value.num[0];
          },
          isValid(this: Camera) {
            return this.skinSSS;
          }
        },
        {
          name: 'SkinSSSOpacity',
          type: 'float',
          phase: 0,
          default: 0.18,
          options: {
            label: 'Opacity',
            group: 'PostProcessing/SkinSSS',
            minValue: 0,
            maxValue: 1
          },
          get(this: Camera, value) {
            value.num[0] = this.skinSSSOpacity;
          },
          set(this: Camera, value) {
            this.skinSSSOpacity = value.num[0];
          },
          isValid(this: Camera) {
            return this.skinSSS;
          }
        },
        {
          name: 'SkinSSSSampleStep',
          type: 'float',
          phase: 0,
          default: 2,
          options: {
            label: 'SampleStep',
            group: 'PostProcessing/SkinSSS',
            minValue: 0.25,
            maxValue: 8
          },
          get(this: Camera, value) {
            value.num[0] = this.skinSSSSampleStep;
          },
          set(this: Camera, value) {
            this.skinSSSSampleStep = value.num[0];
          },
          isValid(this: Camera) {
            return this.skinSSS;
          }
        },
        {
          name: 'SkinSSSDepthScale',
          type: 'float',
          phase: 0,
          default: 80,
          options: {
            label: 'DepthScale',
            group: 'PostProcessing/SkinSSS',
            minValue: 0,
            maxValue: 256
          },
          get(this: Camera, value) {
            value.num[0] = this.skinSSSDepthScale;
          },
          set(this: Camera, value) {
            this.skinSSSDepthScale = value.num[0];
          },
          isValid(this: Camera) {
            return this.skinSSS;
          }
        },
        {
          name: 'SkinSSSColorBoost',
          type: 'float',
          phase: 0,
          default: 1,
          options: {
            label: 'ColorBoost',
            group: 'PostProcessing/SkinSSS',
            minValue: 0,
            maxValue: 4
          },
          get(this: Camera, value) {
            value.num[0] = this.skinSSSColorBoost;
          },
          set(this: Camera, value) {
            this.skinSSSColorBoost = value.num[0];
          },
          isValid(this: Camera) {
            return this.skinSSS;
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
          name: 'ProjectionMode',
          type: 'string',
          phase: 0,
          default: 'fov',
          options: {
            enum: {
              labels: ['Field of View', 'Physical Lens'],
              values: ['fov', 'physical']
            }
          },
          get(this: PerspectiveCamera, value) {
            value.str[0] = this.projectionMode;
          },
          set(this: PerspectiveCamera, value) {
            this.projectionMode = value.str[0] as CameraProjectionMode;
          }
        },
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
          },
          isHidden(this: PerspectiveCamera) {
            return this.projectionMode === 'physical';
          }
        },
        {
          name: 'FocalLength',
          description: 'Physical focal length in millimeters',
          type: 'float',
          default: 50,
          options: {
            minValue: 0.1,
            maxValue: 2000,
            animatable: true
          },
          get(this: PerspectiveCamera, value) {
            value.num[0] = this.focalLengthMm;
          },
          set(this: PerspectiveCamera, value) {
            this.focalLengthMm = value.num[0];
          },
          isHidden(this: PerspectiveCamera) {
            return this.projectionMode !== 'physical';
          }
        },
        {
          name: 'SensorWidth',
          description: 'Physical sensor width in millimeters',
          type: 'float',
          default: 36,
          options: {
            minValue: 0.1,
            maxValue: 200,
            animatable: true
          },
          get(this: PerspectiveCamera, value) {
            value.num[0] = this.sensorWidthMm;
          },
          set(this: PerspectiveCamera, value) {
            this.sensorWidthMm = value.num[0];
          },
          isHidden(this: PerspectiveCamera) {
            return this.projectionMode !== 'physical';
          }
        },
        {
          name: 'SensorHeight',
          description: 'Physical sensor height in millimeters',
          type: 'float',
          default: 24,
          options: {
            minValue: 0.1,
            maxValue: 200,
            animatable: true
          },
          get(this: PerspectiveCamera, value) {
            value.num[0] = this.sensorHeightMm;
          },
          set(this: PerspectiveCamera, value) {
            this.sensorHeightMm = value.num[0];
          },
          isHidden(this: PerspectiveCamera) {
            return this.projectionMode !== 'physical';
          }
        },
        {
          name: 'SensorFit',
          type: 'string',
          default: 'horizontal',
          options: {
            enum: {
              labels: ['Horizontal', 'Vertical'],
              values: ['horizontal', 'vertical']
            }
          },
          get(this: PerspectiveCamera, value) {
            value.str[0] = this.sensorFit;
          },
          set(this: PerspectiveCamera, value) {
            this.sensorFit = value.str[0] as CameraSensorFit;
          },
          isHidden(this: PerspectiveCamera) {
            return this.projectionMode !== 'physical';
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
        },
        {
          name: 'AutoAspect',
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
      ]);
    }
  };
}
