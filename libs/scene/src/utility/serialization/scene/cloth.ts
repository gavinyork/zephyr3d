import { GPUClothComponent, normalizeGPUClothComponentConfig } from '../../../animation/cloth';
import type { SerializableClass } from '../types';

/** @internal */
export function getGPUClothComponentClass(): SerializableClass {
  return {
    ctor: GPUClothComponent,
    name: 'GPUClothComponent',
    createFunc(_ctx, init) {
      return {
        obj: new GPUClothComponent(normalizeGPUClothComponentConfig(init)),
        loadProps: false
      };
    },
    getInitParams(component: GPUClothComponent) {
      return component.config;
    },
    getProps() {
      return [];
    }
  };
}
