import type { Texture2D, TextureCube } from '@zephyr3d/device';
import type { AssetRegistry } from '../asset/asset';
import type { PropertyAccessor } from '../types';
import type { Material } from '../../../material';

export function getTextureProps<T extends Material>(
  assetRegistry: AssetRegistry,
  name: keyof T & string & { [P in keyof T]: T[P] extends Texture2D | TextureCube ? P : never }[keyof T],
  type: T[typeof name] extends Texture2D ? '2D' : T[typeof name] extends TextureCube ? 'Cube' : never,
  phase: number,
  isValid?: (this: T) => boolean
): PropertyAccessor<T>[] {
  return [
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
    },
    {
      name: name[0].toUpperCase() + name.slice(1),
      type: 'object',
      default: null,
      phase: phase,
      nullable: true,
      get(value) {
        value.str[0] = assetRegistry.getAssetId(this[name]) ?? '';
      },
      async set(value) {
        if (!value) {
          this[name] = null;
        } else {
          if (value.str[0]) {
            const assetId = value.str[0];
            const assetInfo = assetRegistry.getAssetInfo(assetId);
            if (assetInfo && assetInfo.type === 'texture') {
              let tex: Texture2D | TextureCube;
              try {
                tex = await assetRegistry.fetchTexture<Texture2D | TextureCube>(
                  assetId,
                  assetInfo.textureOptions
                );
              } catch (err) {
                console.error(`Load asset failed: ${value.str[0]}: ${err}`);
                tex = null;
              }
              const isValidTextureType =
                type === '2D' ? tex?.isTexture2D() : type === 'Cube' ? tex?.isTextureCube() : false;
              if (isValidTextureType) {
                tex.name = assetInfo.name;
                this[name] = tex as any;
              } else {
                console.error('Invalid texture type');
              }
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
    }
  ];
}
