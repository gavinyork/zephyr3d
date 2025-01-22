import type { FaceMode, Texture2D } from '@zephyr3d/device';
import type { BlendMode } from '../../../material';
import {
  BlinnMaterial,
  LambertMaterial,
  MeshMaterial,
  ParticleMaterial,
  PBRMetallicRoughnessMaterial,
  PBRSpecularGlossinessMaterial,
  UnlitMaterial
} from '../../../material';
import type { PropertyAccessor, SerializableClass } from '../types';
import type { AssetRegistry } from '../asset/asset';
import { Vector3, Vector4 } from '@zephyr3d/base';
import { getTextureProps } from './common';

type PBRMaterial = PBRMetallicRoughnessMaterial | PBRSpecularGlossinessMaterial;
type LitPropTypes = LambertMaterial | BlinnMaterial | PBRMaterial;
type UnlitPropTypes = UnlitMaterial | LitPropTypes;

function getPBRCommonProps(assetRegistry: AssetRegistry): PropertyAccessor<PBRMaterial>[] {
  return [
    {
      name: 'IOR',
      type: 'float',
      default: { num: [1.5] },
      get(this: PBRMaterial, value) {
        value.num[0] = this.ior;
      },
      set(this: PBRMaterial, value) {
        this.ior = value.num[0];
      }
    },
    {
      name: 'OcclusionStrength',
      type: 'float',
      default: { num: [1] },
      options: {
        minValue: 0,
        maxValue: 1
      },
      get(this: PBRMaterial, value) {
        value.num[0] = this.occlusionStrength;
      },
      set(this: PBRMaterial, value) {
        this.occlusionStrength = value.num[0];
      },
      isValid() {
        return !!this.occlusionTexture;
      }
    },
    ...getTextureProps<PBRMaterial>(assetRegistry, 'occlusionTexture', '2D'),
    {
      name: 'EmissiveColor',
      type: 'rgb',
      default: { num: [0, 0, 0] },
      get(this: PBRMaterial, value) {
        value.num[0] = this.emissiveColor.x;
        value.num[1] = this.emissiveColor.y;
        value.num[2] = this.emissiveColor.z;
      },
      set(this: PBRMaterial, value) {
        this.emissiveColor = new Vector3(value.num[0], value.num[1], value.num[2]);
      }
    },
    {
      name: 'EmissiveStrength',
      type: 'float',
      default: { num: [1] },
      options: {
        minValue: 0,
        maxValue: 1
      },
      get(this: PBRMaterial, value) {
        value.num[0] = this.emissiveStrength;
      },
      set(this: PBRMaterial, value) {
        this.emissiveStrength = value.num[0];
      }
    },
    ...getTextureProps<PBRMaterial>(assetRegistry, 'emissiveTexture', '2D'),
    {
      name: 'SpecularFactor',
      type: 'vec4',
      default: { num: [1, 1, 1, 1] },
      get(this: PBRMaterial, value) {
        value.num[0] = this.specularFactor.x;
        value.num[1] = this.specularFactor.y;
        value.num[2] = this.specularFactor.z;
        value.num[3] = this.specularFactor.w;
      },
      set(this: PBRMaterial, value) {
        this.specularFactor = new Vector4(value.num[0], value.num[1], value.num[2], value.num[3]);
      }
    },
    ...getTextureProps<PBRMaterial>(assetRegistry, 'specularTexture', '2D'),
    {
      name: 'Transmission',
      type: 'bool',
      default: { bool: [false] },
      get(this: PBRMaterial, value) {
        value.bool[0] = this.transmission;
      },
      set(this: PBRMaterial, value) {
        this.transmission = value.bool[0];
      }
    },
    {
      name: 'TransmissionFactor',
      type: 'float',
      default: { num: [0] },
      options: {
        minValue: 0,
        maxValue: 1
      },
      get(this: PBRMaterial, value) {
        value.num[0] = this.transmissionFactor;
      },
      set(this: PBRMaterial, value) {
        this.transmissionFactor = value.num[0];
      },
      isValid() {
        return !!this.transmission;
      }
    },
    ...getTextureProps<PBRMaterial>(assetRegistry, 'transmissionTexture', '2D', function () {
      return this.transmission;
    }),
    {
      name: 'ThicknessFactor',
      type: 'float',
      default: { num: [0] },
      options: {
        minValue: 0,
        maxValue: 99999
      },
      get(this: PBRMaterial, value) {
        value.num[0] = this.thicknessFactor;
      },
      set(this: PBRMaterial, value) {
        this.thicknessFactor = value.num[0];
      },
      isValid() {
        return !!this.transmission;
      }
    },
    ...getTextureProps<PBRMaterial>(assetRegistry, 'thicknessTexture', '2D', function () {
      return this.transmission;
    }),
    {
      name: 'AttenuationColor',
      type: 'rgb',
      default: { num: [1, 1, 1] },
      get(this: PBRMaterial, value) {
        value.num[0] = this.attenuationColor.x;
        value.num[1] = this.attenuationColor.y;
        value.num[2] = this.attenuationColor.z;
      },
      set(this: PBRMaterial, value) {
        this.attenuationColor = new Vector3(value.num[0], value.num[1], value.num[2]);
      },
      isValid() {
        return !!this.transmission;
      }
    },
    {
      name: 'AttenuationDistance',
      type: 'float',
      default: { num: [99999] },
      options: {
        minValue: 0,
        maxValue: 99999
      },
      get(this: PBRMaterial, value) {
        value.num[0] = this.attenuationDistance;
      },
      set(this: PBRMaterial, value) {
        this.attenuationDistance = value.num[0];
      },
      isValid() {
        return !!this.transmission;
      }
    },
    {
      name: 'Iridescence',
      type: 'bool',
      default: { bool: [false] },
      get(this: PBRMaterial, value) {
        value.bool[0] = this.iridescence;
      },
      set(this: PBRMaterial, value) {
        this.iridescence = value.bool[0];
      }
    },
    {
      name: 'IridescenceFactor',
      type: 'float',
      default: { num: [0] },
      options: {
        minValue: 0,
        maxValue: 1
      },
      get(this: PBRMaterial, value) {
        value.num[0] = this.iridescenceFactor;
      },
      set(this: PBRMaterial, value) {
        this.iridescenceFactor = value.num[0];
      },
      isValid() {
        return !!this.iridescence;
      }
    },
    ...getTextureProps<PBRMaterial>(assetRegistry, 'iridescenceTexture', '2D', function () {
      return this.iridescence;
    }),
    {
      name: 'IridescenceIOR',
      type: 'float',
      default: { num: [1.3] },
      get(this: PBRMaterial, value) {
        value.num[0] = this.iridescenceIor;
      },
      set(this: PBRMaterial, value) {
        this.iridescenceIor = value.num[0];
      },
      isValid() {
        return !!this.iridescence;
      }
    },
    {
      name: 'IridescenceThicknessMin',
      type: 'float',
      default: { num: [100] },
      options: {
        minValue: 0,
        maxValue: 1000
      },
      get(this: PBRMaterial, value) {
        value.num[0] = this.iridescenceThicknessMin;
      },
      set(this: PBRMaterial, value) {
        this.iridescenceThicknessMin = value.num[0];
      },
      isValid() {
        return !!this.iridescence;
      }
    },
    {
      name: 'IridescenceThicknessMax',
      type: 'float',
      default: { num: [400] },
      options: {
        minValue: 0,
        maxValue: 1000
      },
      get(this: PBRMaterial, value) {
        value.num[0] = this.iridescenceThicknessMax;
      },
      set(this: PBRMaterial, value) {
        this.iridescenceThicknessMax = value.num[0];
      },
      isValid() {
        return !!this.iridescence;
      }
    },
    ...getTextureProps<PBRMaterial>(assetRegistry, 'iridescenceThicknessTexture', '2D', function () {
      return this.iridescence;
    }),
    {
      name: 'ClearCoat',
      type: 'bool',
      default: { bool: [false] },
      get(this: PBRMaterial, value) {
        value.bool[0] = this.clearcoat;
      },
      set(this: PBRMaterial, value) {
        this.clearcoat = value.bool[0];
      }
    },
    {
      name: 'ClearCoatIntensity',
      type: 'float',
      default: { num: [0] },
      options: {
        minValue: 0,
        maxValue: 1
      },
      get(this: PBRMaterial, value) {
        value.num[0] = this.clearcoatIntensity;
      },
      set(this: PBRMaterial, value) {
        this.clearcoatIntensity = value.num[0];
      },
      isValid() {
        return !!this.clearcoat;
      }
    },
    ...getTextureProps<PBRMaterial>(assetRegistry, 'clearcoatIntensityTexture', '2D', function () {
      return this.clearcoat;
    }),
    {
      name: 'ClearCoatRoughnessFactor',
      type: 'float',
      default: { num: [0] },
      options: {
        minValue: 0,
        maxValue: 1
      },
      get(this: PBRMaterial, value) {
        value.num[0] = this.clearcoatRoughnessFactor;
      },
      set(this: PBRMaterial, value) {
        this.clearcoatRoughnessFactor = value.num[0];
      },
      isValid() {
        return !!this.clearcoat;
      }
    },
    ...getTextureProps<PBRMaterial>(assetRegistry, 'clearcoatRoughnessTexture', '2D', function () {
      return this.clearcoat;
    }),
    ...getTextureProps<PBRMaterial>(assetRegistry, 'clearcoatNormalTexture', '2D', function () {
      return this.clearcoat;
    }),
    {
      name: 'Sheen',
      type: 'bool',
      default: { bool: [false] },
      get(this: PBRMaterial, value) {
        value.bool[0] = this.sheen;
      },
      set(this: PBRMaterial, value) {
        this.sheen = value.bool[0];
      }
    },
    {
      name: 'SheenColorFactor',
      type: 'rgb',
      default: { num: [0, 0, 0] },
      get(this: PBRMaterial, value) {
        value.num[0] = this.sheenColorFactor.x;
        value.num[1] = this.sheenColorFactor.y;
        value.num[2] = this.sheenColorFactor.z;
      },
      set(this: PBRMaterial, value) {
        this.sheenColorFactor = new Vector3(value.num[0], value.num[1], value.num[2]);
      },
      isValid() {
        return !!this.sheen;
      }
    },
    ...getTextureProps<PBRMaterial>(assetRegistry, 'sheenColorTexture', '2D', function () {
      return this.sheen;
    }),
    {
      name: 'SheenRoughnessFactor',
      type: 'float',
      default: { num: [0] },
      options: {
        minValue: 0,
        maxValue: 1
      },
      get(this: PBRMaterial, value) {
        value.num[0] = this.sheenRoughnessFactor;
      },
      set(this: PBRMaterial, value) {
        this.sheenRoughnessFactor = value.num[0];
      },
      isValid() {
        return !!this.sheen;
      }
    },
    ...getTextureProps<PBRMaterial>(assetRegistry, 'sheenRoughnessTexture', '2D', function () {
      return this.sheen;
    }),
    ...getLitMaterialProps(assetRegistry)
  ];
}

function getLitMaterialProps(assetRegistry: AssetRegistry): PropertyAccessor<LitPropTypes>[] {
  return [
    ...getUnlitMaterialProps(assetRegistry),
    {
      name: 'vertexNormal',
      type: 'bool',
      default: { bool: [true] },
      get(this: LitPropTypes, value) {
        value.bool[0] = this.vertexNormal;
      },
      set(this: LitPropTypes, value) {
        this.vertexNormal = value.bool[0];
      }
    },
    {
      name: 'vertexTangent',
      type: 'bool',
      default: { bool: [false] },
      get(this: LitPropTypes, value) {
        value.bool[0] = this.vertexTangent;
      },
      set(this: LitPropTypes, value) {
        this.vertexTangent = value.bool[0];
      },
      isValid() {
        return !!this.vertexNormal;
      }
    },
    ...getTextureProps<LitPropTypes>(assetRegistry, 'normalTexture', '2D')
  ];
}
function getUnlitMaterialProps(assetRegistry: AssetRegistry): PropertyAccessor<UnlitPropTypes>[] {
  return [
    {
      name: 'vertexColor',
      type: 'bool',
      default: { bool: [false] },
      get(this: UnlitPropTypes, value) {
        value.bool[0] = this.vertexColor;
      },
      set(this: UnlitPropTypes, value) {
        this.vertexColor = value.bool[0];
      }
    },
    {
      name: 'AlbedoColor',
      type: 'rgba',
      default: { num: [1, 1, 1, 1] },
      get(this: UnlitPropTypes, value) {
        const color = this.albedoColor;
        value.num[0] = color.x;
        value.num[1] = color.y;
        value.num[2] = color.z;
        value.num[3] = color.w;
      },
      set(this: UnlitPropTypes, value) {
        this.albedoColor = new Vector4(value.num[0], value.num[1], value.num[2], value.num[3]);
      }
    },
    ...getTextureProps<UnlitPropTypes>(assetRegistry, 'albedoTexture', '2D')
  ];
}

export function getMeshMaterialClass(): SerializableClass {
  return {
    ctor: MeshMaterial,
    className: 'MeshMaterial',
    createFunc(ctx: any, poolId: string) {
      return new MeshMaterial(typeof poolId === 'string' ? Symbol.for(poolId) : void 0);
    },
    getInitParams(obj: MeshMaterial) {
      return [obj.poolId ? Symbol.keyFor(obj.poolId) : null];
    },
    getProps() {
      return [
        {
          name: 'AlphaCutoff',
          type: 'float',
          default: { num: [0] },
          options: {
            minValue: 0,
            maxValue: 1
          },
          get(this: MeshMaterial, value) {
            value.num[0] = this.alphaCutoff;
          },
          set(this: MeshMaterial, value) {
            this.alphaCutoff = value.num[0];
          }
        },
        {
          name: 'AlphaToCoverage',
          type: 'bool',
          default: { bool: [false] },
          get(this: MeshMaterial, value) {
            value.bool[0] = this.alphaToCoverage;
          },
          set(this: MeshMaterial, value) {
            this.alphaToCoverage = value.bool[0];
          }
        },
        {
          name: 'BlendMode',
          type: 'string',
          enum: { labels: ['None', 'Blend', 'Additive'], values: ['none', 'blend', 'additive'] },
          default: { str: ['none'] },
          get(this: MeshMaterial, value) {
            value.str[0] = this.blendMode;
          },
          set(this: MeshMaterial, value) {
            this.blendMode = value.str[0] as BlendMode;
          }
        },
        {
          name: 'CullMode',
          type: 'string',
          enum: { labels: ['None', 'Front', 'Back'], values: ['none', 'front', 'back'] },
          default: { str: ['back'] },
          get(this: MeshMaterial, value) {
            value.str[0] = this.cullMode;
          },
          set(this: MeshMaterial, value) {
            this.cullMode = value.str[0] as FaceMode;
          }
        },
        {
          name: 'Opacity',
          type: 'float',
          options: {
            minValue: 0,
            maxValue: 1
          },
          default: { num: [1] },
          get(this: MeshMaterial, value) {
            value.num[0] = this.opacity;
          },
          set(this: MeshMaterial, value) {
            this.opacity = value.num[0];
          }
        }
      ];
    }
  };
}

export function getParticleMaterialClass(assetRegistry: AssetRegistry): SerializableClass {
  return {
    ctor: ParticleMaterial,
    parent: getMeshMaterialClass(),
    className: 'ParticleMaterial',
    createFunc(ctx: any, poolId: string) {
      return new ParticleMaterial(typeof poolId === 'string' ? Symbol.for(poolId) : void 0);
    },
    getInitParams(obj: ParticleMaterial) {
      return [obj.poolId ? Symbol.keyFor(obj.poolId) : null];
    },
    getProps() {
      return [
        {
          name: 'AlbedoColor',
          type: 'rgba',
          default: { num: [1, 1, 1, 1] },
          get(this: ParticleMaterial, value) {
            const color = this.albedoColor;
            value.num[0] = color.x;
            value.num[1] = color.y;
            value.num[2] = color.z;
            value.num[3] = color.w;
          },
          set(this: ParticleMaterial, value) {
            this.albedoColor = new Vector4(value.num[0], value.num[1], value.num[2], value.num[3]);
          }
        },
        {
          name: 'AlbedoTexture',
          type: 'object',
          default: { str: [''] },
          get(this: ParticleMaterial, value) {
            value.str[0] = assetRegistry.getAssetId(this.albedoTexture) ?? '';
          },
          set(this: ParticleMaterial, value) {
            if (value.str[0]) {
              const assetId = value.str[0];
              const assetInfo = assetRegistry.getAssetInfo(assetId);
              if (assetInfo && assetInfo.type === 'texture') {
                assetRegistry.fetchTexture<Texture2D>(assetId, assetInfo.textureOptions).then((tex) => {
                  if (tex?.isTexture2D()) {
                    tex.name = assetInfo.name;
                    this.albedoTexture = tex;
                  } else {
                    console.error('Invalid albedo texture');
                  }
                });
              }
            }
          }
        }
      ];
    }
  };
}

export function getUnlitMaterialClass(assetRegistry: AssetRegistry): SerializableClass {
  return {
    ctor: UnlitMaterial,
    parent: getMeshMaterialClass(),
    className: 'UnlitMaterial',
    createFunc(ctx: any, poolId: string) {
      return new UnlitMaterial(typeof poolId === 'string' ? Symbol.for(poolId) : void 0);
    },
    getInitParams(obj: UnlitMaterial) {
      return [obj.poolId ? Symbol.keyFor(obj.poolId) : null];
    },
    getProps() {
      return getUnlitMaterialProps(assetRegistry);
    }
  };
}

export function getLambertMaterialClass(assetRegistry: AssetRegistry): SerializableClass {
  return {
    ctor: LambertMaterial,
    parent: getMeshMaterialClass(),
    className: 'LambertMaterial',
    createFunc(ctx: any, poolId: string) {
      return new LambertMaterial(typeof poolId === 'string' ? Symbol.for(poolId) : void 0);
    },
    getInitParams(obj: LambertMaterial) {
      return [obj.poolId ? Symbol.keyFor(obj.poolId) : null];
    },
    getProps() {
      return getLitMaterialProps(assetRegistry);
    }
  };
}

export function getBlinnMaterialClass(assetRegistry: AssetRegistry): SerializableClass {
  return {
    ctor: BlinnMaterial,
    parent: getMeshMaterialClass(),
    className: 'BlinnMaterial',
    createFunc(ctx: any, poolId: string) {
      return new BlinnMaterial(typeof poolId === 'string' ? Symbol.for(poolId) : void 0);
    },
    getInitParams(obj: BlinnMaterial) {
      return [obj.poolId ? Symbol.keyFor(obj.poolId) : null];
    },
    getProps() {
      return [
        {
          name: 'Shininess',
          type: 'float',
          default: { num: [32] },
          options: {
            minValue: 0,
            maxValue: 2048
          },
          get(this: BlinnMaterial, value) {
            value.num[0] = this.shininess;
          },
          set(this: BlinnMaterial, value) {
            this.shininess = value.num[0];
          }
        },
        ...getLitMaterialProps(assetRegistry)
      ];
    }
  };
}

export function getPBRMetallicRoughnessMaterialClass(assetRegistry: AssetRegistry): SerializableClass {
  return {
    ctor: PBRMetallicRoughnessMaterial,
    parent: getMeshMaterialClass(),
    className: 'PBRMetallicRoughnessMaterial',
    createFunc(ctx: any, poolId: string) {
      return new PBRMetallicRoughnessMaterial(typeof poolId === 'string' ? Symbol.for(poolId) : void 0);
    },
    getInitParams(obj: PBRMetallicRoughnessMaterial) {
      return [obj.poolId ? Symbol.keyFor(obj.poolId) : null];
    },
    getProps() {
      return [
        {
          name: 'Metallic',
          type: 'float',
          default: { num: [1] },
          options: {
            minValue: 0,
            maxValue: 1
          },
          get(this: PBRMetallicRoughnessMaterial, value) {
            value.num[0] = this.metallic;
          },
          set(this: PBRMetallicRoughnessMaterial, value) {
            this.metallic = value.num[0];
          }
        },
        {
          name: 'Roughness',
          type: 'float',
          default: { num: [1] },
          options: {
            minValue: 0,
            maxValue: 1
          },
          get(this: PBRMetallicRoughnessMaterial, value) {
            value.num[0] = this.roughness;
          },
          set(this: PBRMetallicRoughnessMaterial, value) {
            this.roughness = value.num[0];
          }
        },
        ...getTextureProps<PBRMetallicRoughnessMaterial>(assetRegistry, 'metallicRoughnessTexture', '2D'),
        ...getTextureProps<PBRMetallicRoughnessMaterial>(assetRegistry, 'specularColorTexture', '2D'),
        ...getPBRCommonProps(assetRegistry)
      ];
    }
  };
}

export function getPBRSpecularGlossinessMaterialClass(assetRegistry: AssetRegistry): SerializableClass {
  return {
    ctor: PBRSpecularGlossinessMaterial,
    parent: getMeshMaterialClass(),
    className: 'PBRSpecularGlossinessMaterial',
    createFunc(ctx: any, poolId: string) {
      return new PBRSpecularGlossinessMaterial(typeof poolId === 'string' ? Symbol.for(poolId) : void 0);
    },
    getInitParams(obj: PBRSpecularGlossinessMaterial) {
      return [obj.poolId ? Symbol.keyFor(obj.poolId) : null];
    },
    getProps() {
      return [
        {
          name: 'GlossnessFactor',
          type: 'float',
          default: { num: [1] },
          options: {
            minValue: 0,
            maxValue: 1
          },
          get(this: PBRSpecularGlossinessMaterial, value) {
            value.num[0] = this.glossinessFactor;
          },
          set(this: PBRSpecularGlossinessMaterial, value) {
            this.glossinessFactor = value.num[0];
          }
        },
        ...getPBRCommonProps(assetRegistry)
      ];
    }
  };
}
