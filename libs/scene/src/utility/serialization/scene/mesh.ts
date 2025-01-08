import {
  BlinnMaterial,
  LambertMaterial,
  MeshMaterial,
  PBRMetallicRoughnessMaterial,
  PBRSpecularGlossinessMaterial,
  UnlitMaterial
} from '../../../material';
import { Primitive } from '../../../render';
import { Mesh } from '../../../scene';
import type { Scene } from '../../../scene/scene';
import { BoxFrameShape, BoxShape, CylinderShape, PlaneShape, SphereShape, TorusShape } from '../../../shapes';
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
          name: 'Primitive',
          type: 'object',
          default: { object: [null] },
          objectTypes: [
            Primitive,
            BoxShape,
            BoxFrameShape,
            SphereShape,
            CylinderShape,
            PlaneShape,
            TorusShape
          ],
          get(this: Mesh, value) {
            value.object[0] = this.primitive;
          },
          set(this: Mesh, value) {
            if (!value.object[0]) {
              this.primitive = null;
            } else if (value.object[0] instanceof Primitive) {
              this.primitive = value.object[0];
            } else {
              console.error('Invalid primitive type');
            }
          }
        },
        {
          name: 'Material',
          type: 'object',
          default: { object: [null] },
          objectTypes: [
            UnlitMaterial,
            LambertMaterial,
            BlinnMaterial,
            PBRMetallicRoughnessMaterial,
            PBRSpecularGlossinessMaterial
          ],
          get(this: Mesh, value) {
            value.object[0] = this.material;
          },
          set(this: Mesh, value) {
            if (!value.object[0]) {
              this.material = null;
            } else if (value.object[0] instanceof MeshMaterial) {
              this.material = value.object[0];
            } else {
              console.error('Invalid material type');
            }
          }
        }
      ];
    }
  };
}
