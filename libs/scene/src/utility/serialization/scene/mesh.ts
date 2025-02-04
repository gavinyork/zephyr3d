import {
  BlinnMaterial,
  LambertMaterial,
  Material,
  MeshMaterial,
  PBRMetallicRoughnessMaterial,
  PBRSpecularGlossinessMaterial,
  UnlitMaterial
} from '../../../material';
import { Primitive } from '../../../render';
import { Mesh, SceneNode } from '../../../scene';
import { Scene } from '../../../scene/scene';
import { BoxFrameShape, BoxShape, CylinderShape, PlaneShape, SphereShape, TorusShape } from '../../../shapes';
import type { AssetRegistry } from '../asset/asset';
import type { SerializableClass } from '../types';
import { getGraphNodeClass } from './node';

export function getMeshClass(assetRegistry: AssetRegistry): SerializableClass {
  return {
    ctor: Mesh,
    parent: getGraphNodeClass(assetRegistry),
    className: 'Mesh',
    createFunc(scene: Scene | SceneNode) {
      if (scene instanceof Scene) {
        return { obj: new Mesh(scene) };
      } else if (scene instanceof SceneNode) {
        const mesh = new Mesh(scene.scene);
        mesh.parent = scene;
        return { obj: mesh };
      } else {
        return null;
      }
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
          name: 'PrimitiveId',
          type: 'string',
          get(this: Mesh, value) {
            value.str[0] = this.primitive?.persistentId ?? '';
          },
          set(this: Mesh, value) {
            this.primitive = Primitive.findPrimitiveById(value.str[0]);
          }
        },
        {
          name: 'Primitive',
          type: 'object',
          persistent: false,
          default: { object: [null] },
          objectTypes: [BoxShape, BoxFrameShape, SphereShape, CylinderShape, PlaneShape, TorusShape],
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
          name: 'MaterialId',
          type: 'string',
          get(this: Mesh, value) {
            value.str[0] = this.material?.persistentId ?? '';
          },
          set(this: Mesh, value) {
            this.material = Material.findMaterialById(value.str[0]) as MeshMaterial;
          }
        },
        {
          name: 'Material',
          type: 'object',
          default: { object: [null] },
          persistent: false,
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
