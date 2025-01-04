import {
  BlinnMaterial,
  LambertMaterial,
  MeshMaterial,
  PBRMetallicRoughnessMaterial,
  PBRSpecularGlossinessMaterial,
  UnlitMaterial
} from '../../../material';
import { Mesh } from '../../../scene';
import type { Scene } from '../../../scene/scene';
import type { SerializableClass } from '../types';
import { getGraphNodeClass } from './node';

export function getMeshClass(): SerializableClass {
  return {
    ctor: Mesh,
    parent: getGraphNodeClass(),
    className: 'Mesh',
    createFunc(scene: Scene) {
      return new Mesh(scene);
    },
    getProps() {
      return [
        {
          name: 'CastShadow',
          type: 'bool',
          default: { bool: [false] },
          get(this: Mesh, value) {
            value.bool[0] = this.castShadow;
          },
          set(this: Mesh, value) {
            this.castShadow = value.bool[0];
          }
        },
        {
          name: 'Material',
          type: 'object',
          default: { object: new LambertMaterial() },
          objectTypes: [
            UnlitMaterial,
            LambertMaterial,
            BlinnMaterial,
            PBRMetallicRoughnessMaterial,
            PBRSpecularGlossinessMaterial
          ],
          get(this: Mesh, value) {
            value.object = this.material;
          },
          set(this: Mesh, value) {
            if (value.object instanceof MeshMaterial) {
              this.material = value.object;
            } else {
              console.error('Invalid material type');
            }
          }
        }
      ];
    }
  };
}
