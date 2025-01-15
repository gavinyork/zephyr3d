import { Texture2D, TextureCube } from '@zephyr3d/device';
import { AssetRegistry } from '../asset/asset';
import { PropertyAccessor } from '../types';

export function getTextureProps<T>(
  assetRegistry: AssetRegistry,
  name: keyof T & string & { [P in keyof T]: T[P] extends Texture2D | TextureCube ? P : never }[keyof T],
  type: T[typeof name] extends Texture2D ? '2D' : T[typeof name] extends TextureCube ? 'Cube' : never,
  isValid?: (this: T) => boolean
): PropertyAccessor<T>[] {
  return [
    {
      name: name[0].toUpperCase() + name.slice(1, name.length - 7) + 'TexCoordIndex',
      type: 'int',
      default: { num: [0] },
      get(value) {
        value.num[0] = this[name.slice(0, name.length - 7) + 'TexCoordIndex'];
      },
      set(value) {
        this[name.slice(0, name.length - 7) + 'TexCoordIndex'] = value.num[0];
      },
      isValid() {
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
      get(value) {
        value.str[0] = assetRegistry.getAssetId(this[name]) ?? '';
      },
      set(value) {
        if (value.str[0]) {
          const assetId = value.str[0];
          const assetInfo = assetRegistry.getAssetInfo(assetId);
          if (assetInfo && assetInfo.type === 'texture') {
            assetRegistry
              .fetchTexture<Texture2D | TextureCube>(assetId, assetInfo.textureOptions)
              .then((tex) => {
                const isValidTextureType =
                  type === '2D' ? tex?.isTexture2D() : type === 'Cube' ? tex?.isTextureCube() : false;
                if (isValidTextureType) {
                  tex.name = assetInfo.name;
                  this[name] = tex as any;
                } else {
                  console.error('Invalid texture type');
                }
              });
          }
        }
      },
      isValid
    }
  ];
}
