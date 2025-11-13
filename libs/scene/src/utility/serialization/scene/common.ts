import type {
  BaseTexture,
  Texture2D,
  TextureAddressMode,
  TextureCube,
  TextureSampler
} from '@zephyr3d/device';
import type { PropertyAccessor } from '../types';
import type { Material } from '../../../material';
import { Matrix4x4, Vector3 } from '@zephyr3d/base';
import type { ResourceManager } from '../manager';
import { getDevice } from '../../../app/api';

export function getTextureProps<T extends Material>(
  manager: ResourceManager,
  name: keyof T & string & { [P in keyof T]: T[P] extends Texture2D | TextureCube ? P : never }[keyof T],
  type: T[typeof name] extends Texture2D ? '2D' : T[typeof name] extends TextureCube ? 'Cube' : never,
  sRGB: boolean,
  phase: number,
  isValid?: (this: T) => boolean
): PropertyAccessor<T>[] {
  return [
    {
      name: name[0].toUpperCase() + name.slice(1),
      type: 'object',
      default: null,
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
        if (!value) {
          this[name] = null;
        } else {
          if (value.str[0]) {
            const assetId = value.str[0];
            let tex: Texture2D | TextureCube;
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
  ];
}
