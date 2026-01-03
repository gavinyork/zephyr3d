import type {
  BaseTexture,
  Texture2D,
  TextureAddressMode,
  TextureCube,
  TextureSampler
} from '@zephyr3d/device';
import { defineProps, type PropertyAccessor, type SerializableClass } from '../types';
import type { Material, MeshMaterial } from '../../../material';
import type { Nullable } from '@zephyr3d/base';
import { Matrix4x4, Vector2, Vector3, Vector4 } from '@zephyr3d/base';
import type { ResourceManager } from '../manager';
import { getDevice, getEngine } from '../../../app/api';

/** @internal */
export const meshInstanceClsMap: Map<
  {
    new (...args: any[]): MeshMaterial;
  },
  { C: { new (m: MeshMaterial) }; S: SerializableClass }
> = new Map();

/** @internal */
export function getMeshMaterialInstanceUniformsClass(cls: {
  new (...args: any[]): MeshMaterial;
}): SerializableClass {
  let info = meshInstanceClsMap.get(cls);
  if (!info) {
    class C {
      materialId: string;
      constructor(public material: MeshMaterial) {
        this.materialId = getEngine().resourceManager.getAssetId(material.coreMaterial) ?? '';
      }
    }
    const S: SerializableClass = {
      ctor: C,
      name: `${cls.name}InstanceUniforms`,
      async createFunc(_ctx, init) {
        const material = await getEngine().resourceManager.fetchMaterial<MeshMaterial>(init);
        return { obj: new C(material!.createInstance()) };
      },
      getInitParams(obj: C) {
        return obj.materialId;
      },
      getProps() {
        return (cls as typeof MeshMaterial).INSTANCE_UNIFORMS.filter((u) => !!u.name).map<
          PropertyAccessor<any, 'DUMMY'>
        >((u) => ({
          name: u.name,
          type: u.type,
          get(this: C, value) {
            const val = this.material[u.prop];
            if (u.type === 'float') {
              value.num[0] = val;
            } else if (u.type === 'vec2') {
              value.num![0] = val.x;
              value.num[1] = val.y;
            } else if (u.type === 'vec3' || u.type === 'rgb') {
              value.num[0] = val.x;
              value.num[1] = val.y;
              value.num[2] = val.z;
            } else if (u.type === 'vec4' || u.type === 'rgba') {
              value.num[0] = val.x;
              value.num[1] = val.y;
              value.num[2] = val.z;
              value.num[3] = val.w;
            }
          },
          set(this: C, value) {
            if (u.type === 'float') {
              this.material[u.prop] = value.num[0];
            } else if (u.type === 'vec2') {
              this.material[u.prop] = new Vector2(value.num[0], value.num[1]);
            } else if (u.type === 'vec3' || u.type === 'rgb') {
              this.material[u.prop] = new Vector3(value.num[0], value.num[1], value.num[2]);
            } else if (u.type === 'vec4' || u.type === 'rgba') {
              this.material[u.prop] = new Vector4(value.num[0], value.num[1], value.num[2], value.num[3]);
            }
          }
        }));
      }
    };
    info = { C, S };
    meshInstanceClsMap.set(cls, info);
  }
  return info.S;
}

export function getTextureProps<T extends Material>(
  manager: ResourceManager,
  name: keyof T &
    string &
    { [P in keyof T]: T[P] extends Nullable<Texture2D | TextureCube> ? P : never }[keyof T],
  type: T[typeof name] extends Nullable<Texture2D>
    ? '2D'
    : T[typeof name] extends Nullable<TextureCube>
      ? 'Cube'
      : never,
  sRGB: boolean,
  phase: number,
  isValid?: (this: T) => boolean
): PropertyAccessor<T>[] {
  return defineProps([
    {
      name: name[0].toUpperCase() + name.slice(1),
      type: 'object',
      default: '',
      phase: phase,
      options: {
        mimeTypes:
          type === '2D'
            ? ['image/jpeg', 'image/png', 'image/tga', 'image/vnd.radiance', 'image/x-dds', 'image/webp']
            : ['image/x-dds']
      },
      isNullable() {
        return true;
      },
      get(value) {
        value.str[0] = manager.getAssetId(this[name]) ?? '';
      },
      async set(value) {
        if (!value || !value.str[0]) {
          this[name] = null as any;
        } else {
          const assetId = value.str[0];
          let tex: Nullable<Texture2D | TextureCube>;
          try {
            tex = await manager.fetchTexture<Texture2D | TextureCube>(assetId, { linearColorSpace: !sRGB });
          } catch (err) {
            console.error(`Load asset failed: ${value.str[0]}: ${err}`);
            tex = null;
          }
          const isValidTextureType =
            type === '2D' ? tex?.isTexture2D() : type === 'Cube' ? tex?.isTextureCube() : false;
          if (isValidTextureType) {
            this[name] = tex as any;
          } else {
            console.error('Invalid texture type');
          }
        }
      },
      isValid() {
        if (this.$isInstance) {
          return false;
        }
        if (isValid) {
          return isValid.call(this);
        }
        return true;
      }
    },
    {
      name: name[0].toUpperCase() + name.slice(1, name.length - 7) + 'TexCoordScale',
      type: 'vec2',
      phase: phase + 1,
      default: [1, 1],
      options: {
        animatable: true
      },
      get(this: T, value) {
        const matrix = this[name.slice(0, name.length - 7) + 'TexCoordMatrix'] as Matrix4x4;
        if (!matrix) {
          value.num[0] = 1;
          value.num[1] = 1;
        } else {
          const scale = new Vector3();
          matrix.decompose(scale, null, null);
          value.num[0] = scale.x;
          value.num[1] = scale.y;
        }
      },
      set(this: T, value) {
        if (value.num[0] === 1 && value.num[1] === 1) {
          this[name.slice(0, name.length - 7) + 'TexCoordMatrix'] = null;
        } else {
          this[name.slice(0, name.length - 7) + 'TexCoordMatrix'] = Matrix4x4.scaling(
            new Vector3(value.num[0], value.num[1], 1)
          );
        }
      },
      isValid() {
        if (this.$isInstance) {
          return false;
        }
        if (isValid) {
          return !!this[name] && isValid.call(this);
        } else {
          return !!this[name];
        }
      }
    },
    {
      name: name[0].toUpperCase() + name.slice(1, name.length - 7) + 'TexCoordAddressU',
      type: 'string',
      options: {
        enum: {
          labels: ['Clamp', 'Repeat', 'MirroredRepeat'],
          values: ['clamp', 'repeat', 'mirrored_repeat']
        }
      },
      phase: phase + 1,
      default: 'clamp',
      get(this: T, value) {
        const sampler =
          (this[name.slice(0, name.length - 7) + 'TextureSampler'] as TextureSampler) ??
          (this[name] as BaseTexture).getDefaultSampler(false);
        value.str[0] = sampler.addressModeU;
      },
      set(this: T, value) {
        const sampler =
          (this[name.slice(0, name.length - 7) + 'TextureSampler'] as TextureSampler) ??
          (this[name] as BaseTexture).getDefaultSampler(false);
        this[name.slice(0, name.length - 7) + 'TextureSampler'] = getDevice().createSampler({
          addressU: value.str[0] as TextureAddressMode,
          addressV: sampler.addressModeV,
          lodMax: sampler.lodMax,
          lodMin: sampler.lodMin,
          magFilter: sampler.magFilter,
          minFilter: sampler.minFilter,
          mipFilter: sampler.mipFilter,
          maxAnisotropy: sampler.maxAnisotropy
        });
      },
      isValid() {
        if (this.$isInstance) {
          return false;
        }
        if (isValid) {
          return !!this[name] && isValid.call(this);
        } else {
          return !!this[name];
        }
      }
    },
    {
      name: name[0].toUpperCase() + name.slice(1, name.length - 7) + 'TexCoordAddressV',
      type: 'string',
      options: {
        enum: {
          labels: ['Clamp', 'Repeat', 'MirroredRepeat'],
          values: ['clamp', 'repeat', 'mirrored_repeat']
        }
      },
      phase: phase + 1,
      default: 'clamp',
      get(this: T, value) {
        const sampler =
          (this[name.slice(0, name.length - 7) + 'TextureSampler'] as TextureSampler) ??
          (this[name] as BaseTexture).getDefaultSampler(false);
        value.str[0] = sampler.addressModeV;
      },
      set(this: T, value) {
        const sampler =
          (this[name.slice(0, name.length - 7) + 'TextureSampler'] as TextureSampler) ??
          (this[name] as BaseTexture).getDefaultSampler(false);
        this[name.slice(0, name.length - 7) + 'TextureSampler'] = getDevice().createSampler({
          addressU: sampler.addressModeU,
          addressV: value.str[0] as TextureAddressMode,
          lodMax: sampler.lodMax,
          lodMin: sampler.lodMin,
          magFilter: sampler.magFilter,
          minFilter: sampler.minFilter,
          mipFilter: sampler.mipFilter,
          maxAnisotropy: sampler.maxAnisotropy
        });
      },
      isValid() {
        if (this.$isInstance) {
          return false;
        }
        if (isValid) {
          return !!this[name] && isValid.call(this);
        } else {
          return !!this[name];
        }
      }
    },
    {
      name: name[0].toUpperCase() + name.slice(1, name.length - 7) + 'TexCoordIndex',
      type: 'int',
      phase: phase + 1,
      default: 0,
      get(value) {
        value.num[0] = this[name.slice(0, name.length - 7) + 'TexCoordIndex'];
      },
      set(value) {
        this[name.slice(0, name.length - 7) + 'TexCoordIndex'] = value.num[0];
      },
      isValid() {
        if (this.$isInstance) {
          return false;
        }
        if (isValid) {
          return !!this[name] && isValid.call(this);
        } else {
          return !!this[name];
        }
      }
    }
  ]);
}
