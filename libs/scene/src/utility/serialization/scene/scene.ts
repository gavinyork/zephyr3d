import type { SkyType } from '../../../render';
import { Scene } from '../../../scene/scene';
import type { AssetRegistry } from '../asset/asset';
import type { SerializableClass } from '../types';

export function getSceneClass(assetRegistry: AssetRegistry): SerializableClass {
  return {
    ctor: Scene,
    className: 'Scene',
    createFunc() {
      return new Scene();
    },
    getProps() {
      return [
        {
          name: 'SkyType',
          type: 'string',
          enum: {
            labels: ['None', 'Color', 'SkyBox', 'Scatter', 'Scatter without Cloud'],
            values: ['none', 'color', 'skybox', 'scatter', 'scatter-nocloud']
          },
          default: { str: ['scatter'] },
          get(this: Scene, value) {
            value.str[0] = this.env.sky.skyType;
          },
          set(this: Scene, value) {
            this.env.sky.skyType = value.str[0] as SkyType;
          }
        },
        {
          name: 'SkyColor',
          type: 'rgb',
          default: { num: [1, 1, 1] },
          get(this: Scene, value) {
            const color = this.env.sky.skyColor;
            value.num[0] = color.x;
            value.num[1] = color.y;
            value.num[2] = color.z;
          },
          set(this: Scene, value) {
            this.env.sky.skyColor.setXYZW(value.num[0], value.num[1], value.num[2], 1);
          }
        }
      ];
    }
  };
}
