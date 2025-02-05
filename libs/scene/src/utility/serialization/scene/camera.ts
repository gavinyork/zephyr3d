import type { SerializableClass } from '../types';
import { Camera, OrthoCamera, PerspectiveCamera } from '../../../camera';
import type { NodeHierarchy } from './node';
import { getSceneNodeClass } from './node';
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
    parent: getSceneNodeClass(assetRegistry),
    className: 'Camera',
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
          name: 'TAA',
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
          name: 'SSR',
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
        }
      ];
    }
  };
}

export function getPerspectiveCameraClass(assetRegistry: AssetRegistry): SerializableClass {
  return {
    ctor: PerspectiveCamera,
    parent: getCameraClass(assetRegistry),
    className: 'PerspectiveCamera',
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
    parent: getCameraClass(assetRegistry),
    className: 'OrthoCamera',
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
