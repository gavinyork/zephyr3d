import type { FaceMode, Texture2D } from '@zephyr3d/device';
import type { BlendMode } from '../../../material';
import {
  BlinnMaterial,
  LambertMaterial,
  Material,
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
      default: 1.5,
      get(this: PBRMaterial, value) {
        value.num[0] = this.ior;
      },
      set(this: PBRMaterial, value) {
        this.ior = value.num[0];
      },
      isValid() {
        return !this.$isInstance;
      }
    },
    {
      name: 'OcclusionStrength',
      type: 'float',
      phase: 2,
      default: 1,
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
        return !this.$isInstance && !!this.occlusionTexture;
      }
    },
    ...getTextureProps<PBRMaterial>(assetRegistry, 'occlusionTexture', '2D', 0),
    {
      name: 'EmissiveColor',
      type: 'rgb',
      get(this: PBRMaterial, value) {
        value.num[0] = this.emissiveColor.x;
        value.num[1] = this.emissiveColor.y;
        value.num[2] = this.emissiveColor.z;
      },
      set(this: PBRMaterial, value) {
        this.emissiveColor = new Vector3(value.num[0], value.num[1], value.num[2]);
      },
      getDefaultValue(this: PBRMaterial) {
        return this.$isInstance ? this.coreMaterial.emissiveColor : [0, 0, 0];
      }
    },
    {
      name: 'EmissiveStrength',
      type: 'float',
      options: {
        minValue: 0,
        maxValue: 1
      },
      get(this: PBRMaterial, value) {
        value.num[0] = this.emissiveStrength;
      },
      set(this: PBRMaterial, value) {
        this.emissiveStrength = value.num[0];
      },
      getDefaultValue(this: PBRMaterial) {
        return this.$isInstance ? this.coreMaterial.emissiveStrength : 1;
      }
    },
    ...getTextureProps<PBRMaterial>(assetRegistry, 'emissiveTexture', '2D', 0),
    ...getTextureProps<PBRMaterial>(assetRegistry, 'specularTexture', '2D', 0),
    {
      name: 'Transmission',
      type: 'bool',
      phase: 0,
      default: false,
      get(this: PBRMaterial, value) {
        value.bool[0] = this.transmission;
      },
      set(this: PBRMaterial, value) {
        this.transmission = value.bool[0];
      },
      isValid() {
        return !this.$isInstance;
      }
    },
    {
      name: 'TransmissionFactor',
      type: 'float',
      phase: 1,
      default: 0,
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
        return !this.$isInstance && !!this.transmission;
      }
    },
    ...getTextureProps<PBRMaterial>(assetRegistry, 'transmissionTexture', '2D', 1, function () {
      return this.transmission;
    }),
    {
      name: 'ThicknessFactor',
      type: 'float',
      phase: 1,
      default: 0,
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
        return !this.$isInstance && !!this.transmission;
      }
    },
    ...getTextureProps<PBRMaterial>(assetRegistry, 'thicknessTexture', '2D', 1, function () {
      return this.transmission;
    }),
    {
      name: 'AttenuationColor',
      type: 'rgb',
      phase: 1,
      default: [1, 1, 1],
      get(this: PBRMaterial, value) {
        value.num[0] = this.attenuationColor.x;
        value.num[1] = this.attenuationColor.y;
        value.num[2] = this.attenuationColor.z;
      },
      set(this: PBRMaterial, value) {
        this.attenuationColor = new Vector3(value.num[0], value.num[1], value.num[2]);
      },
      isValid() {
        return !this.$isInstance && !!this.transmission;
      }
    },
    {
      name: 'AttenuationDistance',
      type: 'float',
      phase: 1,
      default: 99999,
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
        return !this.$isInstance && !!this.transmission;
      }
    },
    {
      name: 'Iridescence',
      type: 'bool',
      phase: 0,
      default: false,
      get(this: PBRMaterial, value) {
        value.bool[0] = this.iridescence;
      },
      set(this: PBRMaterial, value) {
        this.iridescence = value.bool[0];
      },
      isValid() {
        return !this.$isInstance;
      }
    },
    {
      name: 'IridescenceFactor',
      type: 'float',
      phase: 1,
      default: 0,
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
        return !this.$isInstance && !!this.iridescence;
      }
    },
    ...getTextureProps<PBRMaterial>(assetRegistry, 'iridescenceTexture', '2D', 1, function () {
      return this.iridescence;
    }),
    {
      name: 'IridescenceIOR',
      type: 'float',
      phase: 1,
      default: 1.3,
      get(this: PBRMaterial, value) {
        value.num[0] = this.iridescenceIor;
      },
      set(this: PBRMaterial, value) {
        this.iridescenceIor = value.num[0];
      },
      isValid() {
        return !this.$isInstance && !!this.iridescence;
      }
    },
    {
      name: 'IridescenceThicknessMin',
      type: 'float',
      phase: 1,
      default: 100,
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
        return !this.$isInstance && !!this.iridescence;
      }
    },
    {
      name: 'IridescenceThicknessMax',
      type: 'float',
      phase: 1,
      default: 400,
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
        return !this.$isInstance && !!this.iridescence;
      }
    },
    ...getTextureProps<PBRMaterial>(assetRegistry, 'iridescenceThicknessTexture', '2D', 1, function () {
      return this.iridescence;
    }),
    {
      name: 'ClearCoat',
      type: 'bool',
      phase: 0,
      default: false,
      get(this: PBRMaterial, value) {
        value.bool[0] = this.clearcoat;
      },
      set(this: PBRMaterial, value) {
        this.clearcoat = value.bool[0];
      },
      isValid() {
        return !this.$isInstance;
      }
    },
    {
      name: 'ClearCoatIntensity',
      type: 'float',
      phase: 1,
      default: 0,
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
        return !this.$isInstance && !!this.clearcoat;
      }
    },
    ...getTextureProps<PBRMaterial>(assetRegistry, 'clearcoatIntensityTexture', '2D', 1, function () {
      return this.clearcoat;
    }),
    {
      name: 'ClearCoatRoughnessFactor',
      type: 'float',
      phase: 1,
      default: 0,
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
        return !this.$isInstance && !!this.clearcoat;
      }
    },
    ...getTextureProps<PBRMaterial>(assetRegistry, 'clearcoatRoughnessTexture', '2D', 1, function () {
      return this.clearcoat;
    }),
    ...getTextureProps<PBRMaterial>(assetRegistry, 'clearcoatNormalTexture', '2D', 1, function () {
      return this.clearcoat;
    }),
    {
      name: 'Sheen',
      type: 'bool',
      phase: 0,
      default: false,
      get(this: PBRMaterial, value) {
        value.bool[0] = this.sheen;
      },
      set(this: PBRMaterial, value) {
        this.sheen = value.bool[0];
      },
      isValid() {
        return !this.$isInstance;
      }
    },
    {
      name: 'SheenColorFactor',
      type: 'rgb',
      phase: 1,
      default: [0, 0, 0],
      get(this: PBRMaterial, value) {
        value.num[0] = this.sheenColorFactor.x;
        value.num[1] = this.sheenColorFactor.y;
        value.num[2] = this.sheenColorFactor.z;
      },
      set(this: PBRMaterial, value) {
        this.sheenColorFactor = new Vector3(value.num[0], value.num[1], value.num[2]);
      },
      isValid() {
        return !this.$isInstance && !!this.sheen;
      }
    },
    ...getTextureProps<PBRMaterial>(assetRegistry, 'sheenColorTexture', '2D', 1, function () {
      return this.sheen;
    }),
    {
      name: 'SheenRoughnessFactor',
      type: 'float',
      phase: 1,
      default: 0,
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
        return !this.$isInstance && !!this.sheen;
      }
    },
    ...getTextureProps<PBRMaterial>(assetRegistry, 'sheenRoughnessTexture', '2D', 1, function () {
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
      default: true,
      get(this: LitPropTypes, value) {
        value.bool[0] = this.vertexNormal;
      },
      set(this: LitPropTypes, value) {
        this.vertexNormal = value.bool[0];
      },
      isValid() {
        return !this.$isInstance;
      }
    },
    {
      name: 'vertexTangent',
      type: 'bool',
      default: false,
      get(this: LitPropTypes, value) {
        value.bool[0] = this.vertexTangent;
      },
      set(this: LitPropTypes, value) {
        this.vertexTangent = value.bool[0];
      },
      isValid() {
        return !this.$isInstance && !!this.vertexNormal;
      }
    },
    ...getTextureProps<LitPropTypes>(assetRegistry, 'normalTexture', '2D', 0)
  ];
}
function getUnlitMaterialProps(assetRegistry: AssetRegistry): PropertyAccessor<UnlitPropTypes>[] {
  return [
    {
      name: 'vertexColor',
      type: 'bool',
      default: false,
      get(this: UnlitPropTypes, value) {
        value.bool[0] = this.vertexColor;
      },
      set(this: UnlitPropTypes, value) {
        this.vertexColor = value.bool[0];
      },
      isValid() {
        return !this.$isInstance;
      }
    },
    {
      name: 'AlbedoColor',
      type: 'rgba',
      get(this: UnlitPropTypes, value) {
        const color = this.albedoColor;
        value.num[0] = color.x;
        value.num[1] = color.y;
        value.num[2] = color.z;
        value.num[3] = color.w;
      },
      set(this: UnlitPropTypes, value) {
        this.albedoColor = new Vector4(value.num[0], value.num[1], value.num[2], value.num[3]);
      },
      getDefaultValue(this: UnlitPropTypes) {
        return this.$isInstance ? this.coreMaterial.albedoColor : [1, 1, 1, 1];
      }
    },
    ...getTextureProps<UnlitPropTypes>(assetRegistry, 'albedoTexture', '2D', 0)
  ];
}

export function getMeshMaterialClass(): SerializableClass {
  return {
    ctor: MeshMaterial,
    className: 'MeshMaterial',
    createFunc(ctx, initParams) {
      let mat = Material.findMaterialById(initParams.persistentId);
      if (mat) {
        return { obj: mat, loadProps: false };
      } else if (initParams.persistentId === initParams.corePersistentId) {
        mat = new MeshMaterial();
        mat.persistentId = initParams.persistentId;
        return { obj: mat, loadProps: true };
      } else {
        const coreMaterial = Material.findMaterialById(initParams.corePersistentId);
        if (!coreMaterial) {
          throw new Error('Load material failed: core material not found');
        }
        mat = coreMaterial.createInstance();
        mat.persistentId = initParams.persistentId;
        return { obj: mat, loadProps: true };
      }
    },
    getInitParams(obj: MeshMaterial) {
      return {
        persistentId: obj.persistentId,
        corePersistentId: obj.coreMaterial.persistentId
      };
    },
    getProps() {
      return [
        {
          name: 'AlphaCutoff',
          type: 'float',
          default: 0,
          options: {
            minValue: 0,
            maxValue: 1
          },
          get(this: MeshMaterial, value) {
            value.num[0] = this.alphaCutoff;
          },
          set(this: MeshMaterial, value) {
            this.alphaCutoff = value.num[0];
          },
          isValid() {
            return !this.$isInstance;
          }
        },
        {
          name: 'AlphaToCoverage',
          type: 'bool',
          default: false,
          get(this: MeshMaterial, value) {
            value.bool[0] = this.alphaToCoverage;
          },
          set(this: MeshMaterial, value) {
            this.alphaToCoverage = value.bool[0];
          },
          isValid() {
            return !this.$isInstance;
          }
        },
        {
          name: 'BlendMode',
          type: 'string',
          enum: { labels: ['None', 'Blend', 'Additive'], values: ['none', 'blend', 'additive'] },
          default: 'none',
          get(this: MeshMaterial, value) {
            value.str[0] = this.blendMode;
          },
          set(this: MeshMaterial, value) {
            this.blendMode = value.str[0] as BlendMode;
          },
          isValid() {
            return !this.$isInstance;
          }
        },
        {
          name: 'CullMode',
          type: 'string',
          enum: { labels: ['None', 'Front', 'Back'], values: ['none', 'front', 'back'] },
          default: 'back',
          get(this: MeshMaterial, value) {
            value.str[0] = this.cullMode;
          },
          set(this: MeshMaterial, value) {
            this.cullMode = value.str[0] as FaceMode;
          },
          isValid() {
            return !this.$isInstance;
          }
        },
        {
          name: 'Opacity',
          type: 'float',
          options: {
            minValue: 0,
            maxValue: 1
          },
          default: 1,
          get(this: MeshMaterial, value) {
            value.num[0] = this.opacity;
          },
          set(this: MeshMaterial, value) {
            this.opacity = value.num[0];
          },
          getDefaultValue(this: MeshMaterial) {
            return this.$isInstance ? this.coreMaterial.opacity : 1;
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
    createFunc(ctx, initParams) {
      let mat = Material.findMaterialById(initParams.persistentId);
      if (mat) {
        return { obj: mat, loadProps: false };
      } else {
        mat = new ParticleMaterial();
        mat.persistentId = initParams.persistentId;
        return { obj: mat, loadProps: true };
      }
    },
    getInitParams(obj: MeshMaterial) {
      return {
        persistentId: obj.persistentId
      };
    },
    getProps() {
      return [
        {
          name: 'AlphaMap',
          type: 'object',
          default: '',
          get(this: ParticleMaterial, value) {
            value.str[0] = assetRegistry.getAssetId(this.alphaMap) ?? '';
          },
          async set(this: ParticleMaterial, value) {
            if (value.str[0]) {
              const assetId = value.str[0];
              const assetInfo = assetRegistry.getAssetInfo(assetId);
              if (assetInfo && assetInfo.type === 'texture') {
                let tex: Texture2D;
                try {
                  tex = await assetRegistry.fetchTexture<Texture2D>(assetId, assetInfo.textureOptions);
                } catch (err) {
                  console.error(`Load asset failed: ${value.str[0]}: ${err}`);
                }
                if (tex?.isTexture2D()) {
                  tex.name = assetInfo.name;
                  this.alphaMap = tex;
                } else {
                  console.error('Invalid albedo texture');
                }
              }
            }
          }
        },
        {
          name: 'RampMap',
          type: 'object',
          default: '',
          get(this: ParticleMaterial, value) {
            value.str[0] = assetRegistry.getAssetId(this.rampMap) ?? '';
          },
          async set(this: ParticleMaterial, value) {
            if (value.str[0]) {
              const assetId = value.str[0];
              const assetInfo = assetRegistry.getAssetInfo(assetId);
              if (assetInfo && assetInfo.type === 'texture') {
                let tex: Texture2D;
                try {
                  tex = await assetRegistry.fetchTexture<Texture2D>(assetId, assetInfo.textureOptions);
                } catch (err) {
                  console.error(`Load asset failed: ${value.str[0]}: ${err}`);
                }
                if (tex?.isTexture2D()) {
                  tex.name = assetInfo.name;
                  this.rampMap = tex;
                } else {
                  console.error('Invalid albedo texture');
                }
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
    createFunc(ctx, initParams) {
      let mat = Material.findMaterialById(initParams.persistentId);
      if (mat) {
        return { obj: mat, loadProps: false };
      } else if (initParams.persistentId === initParams.corePersistentId) {
        mat = new UnlitMaterial();
        mat.persistentId = initParams.persistentId;
        return { obj: mat, loadProps: true };
      } else {
        const coreMaterial = Material.findMaterialById(initParams.corePersistentId);
        if (!coreMaterial) {
          throw new Error('Load material failed: core material not found');
        }
        mat = coreMaterial.createInstance();
        mat.persistentId = initParams.persistentId;
        return { obj: mat, loadProps: true };
      }
    },
    getInitParams(obj: MeshMaterial) {
      return {
        persistentId: obj.persistentId,
        corePersistentId: obj.coreMaterial.persistentId
      };
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
    createFunc(ctx, initParams) {
      let mat = Material.findMaterialById(initParams.persistentId);
      if (mat) {
        return { obj: mat, loadProps: false };
      } else if (initParams.persistentId === initParams.corePersistentId) {
        mat = new LambertMaterial();
        mat.persistentId = initParams.persistentId;
        return { obj: mat, loadProps: true };
      } else {
        const coreMaterial = Material.findMaterialById(initParams.corePersistentId);
        if (!coreMaterial) {
          throw new Error('Load material failed: core material not found');
        }
        mat = coreMaterial.createInstance();
        mat.persistentId = initParams.persistentId;
        return { obj: mat, loadProps: true };
      }
    },
    getInitParams(obj: MeshMaterial) {
      return {
        persistentId: obj.persistentId,
        corePersistentId: obj.coreMaterial.persistentId
      };
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
    createFunc(ctx, initParams) {
      let mat = Material.findMaterialById(initParams.persistentId);
      if (mat) {
        return { obj: mat, loadProps: false };
      } else if (initParams.persistentId === initParams.corePersistentId) {
        mat = new BlinnMaterial();
        mat.persistentId = initParams.persistentId;
        return { obj: mat, loadProps: true };
      } else {
        const coreMaterial = Material.findMaterialById(initParams.corePersistentId);
        if (!coreMaterial) {
          throw new Error('Load material failed: core material not found');
        }
        mat = coreMaterial.createInstance();
        mat.persistentId = initParams.persistentId;
        return { obj: mat, loadProps: true };
      }
    },
    getInitParams(obj: MeshMaterial) {
      return {
        persistentId: obj.persistentId,
        corePersistentId: obj.coreMaterial.persistentId
      };
    },
    getProps() {
      return [
        {
          name: 'Shininess',
          type: 'float',
          options: {
            minValue: 0,
            maxValue: 2048
          },
          get(this: BlinnMaterial, value) {
            value.num[0] = this.shininess;
          },
          set(this: BlinnMaterial, value) {
            this.shininess = value.num[0];
          },
          getDefaultValue(this: BlinnMaterial) {
            return this.$isInstance ? this.coreMaterial.shininess : 32;
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
    createFunc(ctx, initParams) {
      let mat = Material.findMaterialById(initParams.persistentId);
      if (mat) {
        return { obj: mat, loadProps: false };
      } else if (initParams.persistentId === initParams.corePersistentId) {
        mat = new PBRMetallicRoughnessMaterial();
        mat.persistentId = initParams.persistentId;
        return { obj: mat, loadProps: true };
      } else {
        const coreMaterial = Material.findMaterialById(initParams.corePersistentId);
        if (!coreMaterial) {
          throw new Error('Load material failed: core material not found');
        }
        mat = coreMaterial.createInstance();
        mat.persistentId = initParams.persistentId;
        return { obj: mat, loadProps: true };
      }
    },
    getInitParams(obj: MeshMaterial) {
      return {
        persistentId: obj.persistentId,
        corePersistentId: obj.coreMaterial.persistentId
      };
    },
    getProps() {
      return [
        {
          name: 'Metallic',
          type: 'float',
          options: {
            minValue: 0,
            maxValue: 1
          },
          get(this: PBRMetallicRoughnessMaterial, value) {
            value.num[0] = this.metallic;
          },
          set(this: PBRMetallicRoughnessMaterial, value) {
            this.metallic = value.num[0];
          },
          getDefaultValue(this: PBRMetallicRoughnessMaterial) {
            return this.$isInstance ? this.coreMaterial.metallic : 1;
          }
        },
        {
          name: 'Roughness',
          type: 'float',
          options: {
            minValue: 0,
            maxValue: 1
          },
          get(this: PBRMetallicRoughnessMaterial, value) {
            value.num[0] = this.roughness;
          },
          set(this: PBRMetallicRoughnessMaterial, value) {
            this.roughness = value.num[0];
          },
          getDefaultValue(this: PBRMetallicRoughnessMaterial) {
            return this.$isInstance ? this.coreMaterial.roughness : 1;
          }
        },
        {
          name: 'SpecularFactor',
          type: 'rgba',
          get(this: PBRMetallicRoughnessMaterial, value) {
            value.num[0] = this.specularFactor.x;
            value.num[1] = this.specularFactor.y;
            value.num[2] = this.specularFactor.z;
            value.num[3] = this.specularFactor.w;
          },
          set(this: PBRMetallicRoughnessMaterial, value) {
            this.specularFactor = new Vector4(value.num[0], value.num[1], value.num[2], value.num[3]);
          },
          getDefaultValue(this: PBRMetallicRoughnessMaterial) {
            return this.$isInstance ? this.coreMaterial.specularFactor : [1, 1, 1, 1];
          }
        },
        ...getTextureProps<PBRMetallicRoughnessMaterial>(assetRegistry, 'metallicRoughnessTexture', '2D', 0),
        ...getTextureProps<PBRMetallicRoughnessMaterial>(assetRegistry, 'specularColorTexture', '2D', 0),
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
    createFunc(ctx, initParams) {
      let mat = Material.findMaterialById(initParams.persistentId);
      if (mat) {
        return { obj: mat, loadProps: false };
      } else if (initParams.persistentId === initParams.corePersistentId) {
        mat = new PBRSpecularGlossinessMaterial();
        mat.persistentId = initParams.persistentId;
        return { obj: mat, loadProps: true };
      } else {
        const coreMaterial = Material.findMaterialById(initParams.corePersistentId);
        if (!coreMaterial) {
          throw new Error('Load material failed: core material not found');
        }
        mat = coreMaterial.createInstance();
        mat.persistentId = initParams.persistentId;
        return { obj: mat, loadProps: true };
      }
    },
    getInitParams(obj: MeshMaterial) {
      return {
        persistentId: obj.persistentId,
        corePersistentId: obj.coreMaterial.persistentId
      };
    },
    getProps() {
      return [
        {
          name: 'SpecularFactor',
          type: 'rgb',
          get(this: PBRSpecularGlossinessMaterial, value) {
            value.num[0] = this.specularFactor.x;
            value.num[1] = this.specularFactor.y;
            value.num[2] = this.specularFactor.z;
          },
          set(this: PBRSpecularGlossinessMaterial, value) {
            this.specularFactor = new Vector3(value.num[0], value.num[1], value.num[2]);
          },
          getDefaultValue(this: PBRSpecularGlossinessMaterial) {
            return this.$isInstance ? this.coreMaterial.specularFactor : [1, 1, 1];
          }
        },
        {
          name: 'GlossnessFactor',
          type: 'float',
          options: {
            minValue: 0,
            maxValue: 1
          },
          get(this: PBRSpecularGlossinessMaterial, value) {
            value.num[0] = this.glossinessFactor;
          },
          set(this: PBRSpecularGlossinessMaterial, value) {
            this.glossinessFactor = value.num[0];
          },
          getDefaultValue(this: PBRSpecularGlossinessMaterial) {
            return this.$isInstance ? this.coreMaterial.glossinessFactor : 1;
          }
        },
        ...getPBRCommonProps(assetRegistry)
      ];
    }
  };
}
