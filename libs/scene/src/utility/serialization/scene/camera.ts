import type { SceneNode } from '../../../scene/scene_node';
import type { Scene } from '../../../scene/scene';
import type { SerializableClass } from '../types';
import { sceneNodeClass } from './node';
import { Camera, OrthoCamera, PerspectiveCamera } from '../../../camera';

export const cameraClass: SerializableClass<SceneNode> = {
  ctor: Camera,
  parent: sceneNodeClass,
  className: 'Camera',
  createFunc(scene: Scene) {
    return new Camera(scene);
  },
  getProps() {
    return [
      {
        name: 'HiZ',
        type: 'bool',
        default: { bool: [false] },
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
        default: { bool: [false] },
        get(this: Camera, value) {
          value.bool[0] = this.TAA;
        },
        set(this: Camera, value) {
          this.TAA = value.bool[0];
        }
      },
      {
        name: 'SSR',
        type: 'bool',
        default: { bool: [false] },
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
        default: { num: [0.8] },
        get(this: Camera, value) {
          value.num[0] = this.ssrMaxRoughness;
        },
        set(this: Camera, value) {
          this.ssrMaxRoughness = value.num[0];
        }
      },
      {
        name: 'SSRRoughnessFactor',
        type: 'float',
        default: { num: [1.0] },
        get(this: Camera, value) {
          value.num[0] = this.ssrRoughnessFactor;
        },
        set(this: Camera, value) {
          this.ssrRoughnessFactor = value.num[0];
        }
      },
      {
        name: 'SSRStride',
        type: 'float',
        default: { num: [2] },
        get(this: Camera, value) {
          value.num[0] = this.ssrStride;
        },
        set(this: Camera, value) {
          this.ssrStride = value.num[0];
        }
      },
      {
        name: 'SSRMaxDistance',
        type: 'float',
        default: { num: [100] },
        get(this: Camera, value) {
          value.num[0] = this.ssrMaxDistance;
        },
        set(this: Camera, value) {
          this.ssrMaxDistance = value.num[0];
        }
      },
      {
        name: 'SSRMaxSteps',
        type: 'float',
        default: { num: [120] },
        get(this: Camera, value) {
          value.num[0] = this.ssrIterations;
        },
        set(this: Camera, value) {
          this.ssrIterations = value.num[0];
        }
      },
      {
        name: 'SSRThickness',
        type: 'float',
        default: { num: [0.5] },
        get(this: Camera, value) {
          value.num[0] = this.ssrThickness;
        },
        set(this: Camera, value) {
          this.ssrThickness = value.num[0];
        }
      },
      {
        name: 'SSRBlurScale',
        type: 'float',
        default: { num: [0.05] },
        get(this: Camera, value) {
          value.num[0] = this.ssrBlurScale;
        },
        set(this: Camera, value) {
          this.ssrBlurScale = value.num[0];
        }
      },
      {
        name: 'SSRBlurDepthCutoff',
        type: 'float',
        default: { num: [2] },
        get(this: Camera, value) {
          value.num[0] = this.ssrBlurDepthCutoff;
        },
        set(this: Camera, value) {
          this.ssrBlurDepthCutoff = value.num[0];
        }
      },
      {
        name: 'SSRBlurKernelSize',
        type: 'float',
        default: { num: [17] },
        get(this: Camera, value) {
          value.num[0] = this.ssrBlurKernelSize;
        },
        set(this: Camera, value) {
          this.ssrBlurKernelSize = value.num[0];
        }
      },
      {
        name: 'SSRBlurStdDev',
        type: 'float',
        default: { num: [10] },
        get(this: Camera, value) {
          value.num[0] = this.ssrBlurStdDev;
        },
        set(this: Camera, value) {
          this.ssrBlurStdDev = value.num[0];
        }
      },
      {
        name: 'SSRCalcThickness',
        type: 'bool',
        default: { bool: [false] },
        get(this: Camera, value) {
          value.bool[0] = this.ssrCalcThickness;
        },
        set(this: Camera, value) {
          this.ssrCalcThickness = value.bool[0];
        }
      },
      {
        name: 'SampleCount',
        type: 'int',
        default: { num: [1] },
        get(this: Camera, value) {
          value.num[0] = this.sampleCount;
        },
        set(this: Camera, value) {
          this.sampleCount = value.num[0];
        }
      },
      {
        name: 'Clear',
        type: 'vec4',
        default: { num: [0, 0, 0, 1] },
        get(this: Camera, value) {
          value.num[0] = this.sampleCount;
        },
        set(this: Camera, value) {
          this.sampleCount = value.num[0];
        }
      }
    ];
  }
};

export const perspectiveCameraClass: SerializableClass<SceneNode> = {
  ctor: PerspectiveCamera,
  parent: cameraClass,
  className: 'PerspectiveCamera',
  createFunc(scene: Scene) {
    return new PerspectiveCamera(scene);
  },
  getProps() {
    return [
      {
        name: 'FovVertical',
        type: 'float',
        default: { num: [Math.PI / 3] },
        get(this: PerspectiveCamera, value) {
          value.num[0] = this.fovY;
        },
        set(this: PerspectiveCamera, value) {
          this.fovY = value.num[0];
        }
      },
      {
        name: 'AspectRatio',
        type: 'float',
        default: { num: [1] },
        get(this: PerspectiveCamera, value) {
          value.num[0] = this.aspect;
        },
        set(this: PerspectiveCamera, value) {
          this.aspect = value.num[0];
        }
      },
      {
        name: 'Near',
        type: 'float',
        default: { num: [1] },
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
        default: { num: [1000] },
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

export const orthographicCameraClass: SerializableClass<SceneNode> = {
  ctor: OrthoCamera,
  parent: cameraClass,
  className: 'OrthoCamera',
  createFunc(scene: Scene) {
    return new OrthoCamera(scene);
  },
  getProps() {
    return [
      {
        name: 'Left',
        type: 'float',
        default: { num: [-1] },
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
        default: { num: [1] },
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
        default: { num: [-1] },
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
        default: { num: [1] },
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
        default: { num: [-1] },
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
        default: { num: [1] },
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
