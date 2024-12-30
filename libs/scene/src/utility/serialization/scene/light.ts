import type { SceneNode } from '../../../scene/scene_node';
import {
  BaseLight,
  DirectionalLight,
  PointLight,
  PunctualLight,
  SpotLight
} from '../../../scene/light';
import type { Scene } from '../../../scene/scene';
import type { SerializableClass } from '../types';
import { sceneNodeClass } from './node';
import { Vector4 } from '@zephyr3d/base';

export const punctualLightClass: SerializableClass<SceneNode> = {
  ctor: PunctualLight,
  parent: sceneNodeClass,
  className: 'PunctualLight',
  getProps() {
    return [
      {
        name: 'Color',
        type: 'vec3',
        default: { num: [1, 1, 1] },
        get(this: PunctualLight, value) {
          value.num[0] = this.color.x;
          value.num[1] = this.color.y;
          value.num[2] = this.color.z;
        },
        set(this: PunctualLight, value) {
          this.color = new Vector4(value.num[0], value.num[1], value.num[2], 1);
        }
      },
      {
        name: 'Intensity',
        type: 'float',
        default: { num: [1] },
        get(this: BaseLight, value) {
          value.num[0] = this.intensity;
        },
        set(this: BaseLight, value) {
          this.intensity = value.num[0];
        }
      },
      {
        name: 'CastShadow',
        type: 'bool',
        default: { bool: [false] },
        get(this: PunctualLight, value) {
          value.bool[0] = this.castShadow;
        },
        set(this: PunctualLight, value) {
          this.castShadow = value.bool[0];
        }
      }
    ];
  }
};

export const directionalLightClass: SerializableClass<SceneNode> = {
  ctor: DirectionalLight,
  parent: punctualLightClass,
  className: 'DirectionalLight',
  createFunc(scene: Scene) {
    return new DirectionalLight(scene);
  },
  getProps() {
    return [
      {
        name: 'SunLight',
        type: 'bool',
        default: { bool: [false] },
        get(this: DirectionalLight, value) {
          value.bool[0] = this.sunLight;
        },
        set(this: DirectionalLight, value) {
          this.sunLight = value.bool[0];
        }
      }
    ];
  }
};

export const pointLightClass: SerializableClass<SceneNode> = {
  ctor: PointLight,
  parent: punctualLightClass,
  className: 'PointLight',
  createFunc(scene: Scene) {
    return new PointLight(scene);
  },
  getProps() {
    return [
      {
        name: 'Range',
        type: 'float',
        default: { num: [10] },
        get(this: PointLight, value) {
          value.num[0] = this.range;
        },
        set(this: PointLight, value) {
          this.range = value.num[0];
        }
      }
    ];
  }
};

export const spotLightClass: SerializableClass<SceneNode> = {
  ctor: SpotLight,
  parent: punctualLightClass,
  className: 'SpotLight',
  createFunc(scene: Scene) {
    return new SpotLight(scene);
  },
  getProps() {
    return [
      {
        name: 'Range',
        type: 'float',
        default: { num: [10] },
        get(this: SpotLight, value) {
          value.num[0] = this.range;
        },
        set(this: SpotLight, value) {
          this.range = value.num[0];
        }
      },
      {
        name: 'Cutoff',
        type: 'float',
        default: { num: [Math.cos(Math.PI / 4)] },
        get(this: SpotLight, value) {
          value.num[0] = this.cutoff;
        },
        set(this: SpotLight, value) {
          this.cutoff = value.num[0];
        }
      }
    ];
  }
};
