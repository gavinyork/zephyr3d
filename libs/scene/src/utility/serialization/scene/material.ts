import type { FaceMode, Texture2D } from '@zephyr3d/device';
import type { BlendMode } from '../../../material';
import {
  BlinnMaterial,
  LambertMaterial,
  MeshMaterial,
  PBRMetallicRoughnessMaterial,
  PBRSpecularGlossinessMaterial,
  UnlitMaterial
} from '../../../material';
import type { PropertyAccessor, SerializableClass } from '../types';
import type { AssetRegistry } from '../asset/asset';
import { Vector3, Vector4 } from '@zephyr3d/base';

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
      }
    },
    {
      name: 'OcclusionTexCoordIndex',
      type: 'int',
      default: { num: [0] },
      get(this: PBRMaterial, value) {
        value.num[0] = this.occlusionTexCoordIndex;
      },
      set(this: PBRMaterial, value) {
        this.occlusionTexCoordIndex = value.num[0];
      }
    },
    {
      name: 'OcclusionTexture',
      type: 'object',
      default: { str: [''] },
      get(this: PBRMaterial, value) {
        const name = this.occlusionTexture?.name ?? '';
        value.str[0] = name.startsWith('ASSET:') ? name.slice(6) : name;
      },
      set(this: PBRMaterial, value) {
        if (value.str[0]?.startsWith('ASSET:')) {
          const assetId = value.str[0].slice(6);
          const assetInfo = assetRegistry.getAssetInfo(assetId);
          if (assetInfo && assetInfo.type === 'texture') {
            assetRegistry.fetchTexture<Texture2D>(assetId, assetInfo.textureOptions).then((tex) => {
              if (tex?.isTexture2D()) {
                tex.name = `ASSET:${assetId}`;
                this.occlusionTexture = tex;
              } else {
                console.error('Invalid occlusion texture');
              }
            });
          }
        }
      }
    },
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
    {
      name: 'EmissiveTexCoordIndex',
      type: 'int',
      default: { num: [0] },
      get(this: PBRMaterial, value) {
        value.num[0] = this.emissiveTexCoordIndex;
      },
      set(this: PBRMaterial, value) {
        this.emissiveTexCoordIndex = value.num[0];
      }
    },
    {
      name: 'EmissiveTexture',
      type: 'object',
      default: { str: [''] },
      get(this: PBRMaterial, value) {
        const name = this.emissiveTexture?.name ?? '';
        value.str[0] = name.startsWith('ASSET:') ? name.slice(6) : name;
      },
      set(this: PBRMaterial, value) {
        if (value.str[0]?.startsWith('ASSET:')) {
          const assetId = value.str[0].slice(6);
          const assetInfo = assetRegistry.getAssetInfo(assetId);
          if (assetInfo && assetInfo.type === 'texture') {
            assetRegistry.fetchTexture<Texture2D>(assetId, assetInfo.textureOptions).then((tex) => {
              if (tex?.isTexture2D()) {
                tex.name = `ASSET:${assetId}`;
                this.emissiveTexture = tex;
              } else {
                console.error('Invalid emissive texture');
              }
            });
          }
        }
      }
    },
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
    {
      name: 'SpecularTexCoordIndex',
      type: 'int',
      default: { num: [0] },
      get(this: PBRMaterial, value) {
        value.num[0] = this.specularTexCoordIndex;
      },
      set(this: PBRMaterial, value) {
        this.specularTexCoordIndex = value.num[0];
      }
    },
    {
      name: 'SpecularTexture',
      type: 'object',
      default: { str: [''] },
      get(this: PBRMaterial, value) {
        const name = this.specularTexture?.name ?? '';
        value.str[0] = name.startsWith('ASSET:') ? name.slice(6) : name;
      },
      set(this: PBRMaterial, value) {
        if (value.str[0]?.startsWith('ASSET:')) {
          const assetId = value.str[0].slice(6);
          const assetInfo = assetRegistry.getAssetInfo(assetId);
          if (assetInfo && assetInfo.type === 'texture') {
            assetRegistry.fetchTexture<Texture2D>(assetId, assetInfo.textureOptions).then((tex) => {
              if (tex?.isTexture2D()) {
                tex.name = `ASSET:${assetId}`;
                this.specularTexture = tex;
              } else {
                console.error('Invalid specular texture');
              }
            });
          }
        }
      }
    },
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
      }
    },
    {
      name: 'TransmissionTexCoordIndex',
      type: 'int',
      default: { num: [0] },
      get(this: PBRMaterial, value) {
        value.num[0] = this.transmissionTexCoordIndex;
      },
      set(this: PBRMaterial, value) {
        this.transmissionTexCoordIndex = value.num[0];
      }
    },
    {
      name: 'TransmissionTexture',
      type: 'object',
      default: { str: [''] },
      get(this: PBRMaterial, value) {
        const name = this.transmissionTexture?.name ?? '';
        value.str[0] = name.startsWith('ASSET:') ? name.slice(6) : name;
      },
      set(this: PBRMaterial, value) {
        if (value.str[0]?.startsWith('ASSET:')) {
          const assetId = value.str[0].slice(6);
          const assetInfo = assetRegistry.getAssetInfo(assetId);
          if (assetInfo && assetInfo.type === 'texture') {
            assetRegistry.fetchTexture<Texture2D>(assetId, assetInfo.textureOptions).then((tex) => {
              if (tex?.isTexture2D()) {
                tex.name = `ASSET:${assetId}`;
                this.transmissionTexture = tex;
              } else {
                console.error('Invalid transmission texture');
              }
            });
          }
        }
      }
    },
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
      }
    },
    {
      name: 'ThicknessTexCoordIndex',
      type: 'int',
      default: { num: [0] },
      get(this: PBRMaterial, value) {
        value.num[0] = this.thicknessTexCoordIndex;
      },
      set(this: PBRMaterial, value) {
        this.thicknessTexCoordIndex = value.num[0];
      }
    },
    {
      name: 'thicknessTexture',
      type: 'object',
      default: { str: [''] },
      get(this: PBRMaterial, value) {
        const name = this.thicknessTexture?.name ?? '';
        value.str[0] = name.startsWith('ASSET:') ? name.slice(6) : name;
      },
      set(this: PBRMaterial, value) {
        if (value.str[0]?.startsWith('ASSET:')) {
          const assetId = value.str[0].slice(6);
          const assetInfo = assetRegistry.getAssetInfo(assetId);
          if (assetInfo && assetInfo.type === 'texture') {
            assetRegistry.fetchTexture<Texture2D>(assetId, assetInfo.textureOptions).then((tex) => {
              if (tex?.isTexture2D()) {
                tex.name = `ASSET:${assetId}`;
                this.thicknessTexture = tex;
              } else {
                console.error('Invalid thickness texture');
              }
            });
          }
        }
      }
    },
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
      }
    },
    {
      name: 'IridescenceTexCoordIndex',
      type: 'int',
      default: { num: [0] },
      get(this: PBRMaterial, value) {
        value.num[0] = this.iridescenceTexCoordIndex;
      },
      set(this: PBRMaterial, value) {
        this.iridescenceTexCoordIndex = value.num[0];
      }
    },
    {
      name: 'IridescenceTexture',
      type: 'object',
      default: { str: [''] },
      get(this: PBRMaterial, value) {
        const name = this.iridescenceTexture?.name ?? '';
        value.str[0] = name.startsWith('ASSET:') ? name.slice(6) : name;
      },
      set(this: PBRMaterial, value) {
        if (value.str[0]?.startsWith('ASSET:')) {
          const assetId = value.str[0].slice(6);
          const assetInfo = assetRegistry.getAssetInfo(assetId);
          if (assetInfo && assetInfo.type === 'texture') {
            assetRegistry.fetchTexture<Texture2D>(assetId, assetInfo.textureOptions).then((tex) => {
              if (tex?.isTexture2D()) {
                tex.name = `ASSET:${assetId}`;
                this.iridescenceTexture = tex;
              } else {
                console.error('Invalid iridescence texture');
              }
            });
          }
        }
      }
    },
    {
      name: 'IridescenceIOR',
      type: 'float',
      default: { num: [1.3] },
      get(this: PBRMaterial, value) {
        value.num[0] = this.iridescenceIor;
      },
      set(this: PBRMaterial, value) {
        this.iridescenceIor = value.num[0];
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
      }
    },
    {
      name: 'IridescenceThicknessTexCoordIndex',
      type: 'int',
      default: { num: [0] },
      get(this: PBRMaterial, value) {
        value.num[0] = this.iridescenceThicknessTexCoordIndex;
      },
      set(this: PBRMaterial, value) {
        this.iridescenceThicknessTexCoordIndex = value.num[0];
      }
    },
    {
      name: 'IridescenceThicknessTexture',
      type: 'object',
      default: { str: [''] },
      get(this: PBRMaterial, value) {
        const name = this.iridescenceThicknessTexture?.name ?? '';
        value.str[0] = name.startsWith('ASSET:') ? name.slice(6) : name;
      },
      set(this: PBRMaterial, value) {
        if (value.str[0]?.startsWith('ASSET:')) {
          const assetId = value.str[0].slice(6);
          const assetInfo = assetRegistry.getAssetInfo(assetId);
          if (assetInfo && assetInfo.type === 'texture') {
            assetRegistry.fetchTexture<Texture2D>(assetId, assetInfo.textureOptions).then((tex) => {
              if (tex?.isTexture2D()) {
                tex.name = `ASSET:${assetId}`;
                this.iridescenceThicknessTexture = tex;
              } else {
                console.error('Invalid iridescence thickness texture');
              }
            });
          }
        }
      }
    },
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
      }
    },
    {
      name: 'ClearCoatIntensityTexCoordIndex',
      type: 'int',
      default: { num: [0] },
      get(this: PBRMaterial, value) {
        value.num[0] = this.clearcoatIntensityTexCoordIndex;
      },
      set(this: PBRMaterial, value) {
        this.clearcoatIntensityTexCoordIndex = value.num[0];
      }
    },
    {
      name: 'ClearCoatIntensityTexture',
      type: 'object',
      default: { str: [''] },
      get(this: PBRMaterial, value) {
        const name = this.clearcoatIntensityTexture?.name ?? '';
        value.str[0] = name.startsWith('ASSET:') ? name.slice(6) : name;
      },
      set(this: PBRMaterial, value) {
        if (value.str[0]?.startsWith('ASSET:')) {
          const assetId = value.str[0].slice(6);
          const assetInfo = assetRegistry.getAssetInfo(assetId);
          if (assetInfo && assetInfo.type === 'texture') {
            assetRegistry.fetchTexture<Texture2D>(assetId, assetInfo.textureOptions).then((tex) => {
              if (tex?.isTexture2D()) {
                tex.name = `ASSET:${assetId}`;
                this.clearcoatIntensityTexture = tex;
              } else {
                console.error('Invalid clearcoat intensity texture');
              }
            });
          }
        }
      }
    },
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
      }
    },
    {
      name: 'ClearCoatRoughnessTexCoordIndex',
      type: 'int',
      default: { num: [0] },
      get(this: PBRMaterial, value) {
        value.num[0] = this.clearcoatRoughnessTexCoordIndex;
      },
      set(this: PBRMaterial, value) {
        this.clearcoatRoughnessTexCoordIndex = value.num[0];
      }
    },
    {
      name: 'ClearCoatRoughnessTexture',
      type: 'object',
      default: { str: [''] },
      get(this: PBRMaterial, value) {
        const name = this.clearcoatRoughnessTexture?.name ?? '';
        value.str[0] = name.startsWith('ASSET:') ? name.slice(6) : name;
      },
      set(this: PBRMaterial, value) {
        if (value.str[0]?.startsWith('ASSET:')) {
          const assetId = value.str[0].slice(6);
          const assetInfo = assetRegistry.getAssetInfo(assetId);
          if (assetInfo && assetInfo.type === 'texture') {
            assetRegistry.fetchTexture<Texture2D>(assetId, assetInfo.textureOptions).then((tex) => {
              if (tex?.isTexture2D()) {
                tex.name = `ASSET:${assetId}`;
                this.clearcoatRoughnessTexture = tex;
              } else {
                console.error('Invalid clearcoat roughness texture');
              }
            });
          }
        }
      }
    },
    {
      name: 'ClearCoatNormalScale',
      type: 'float',
      default: { num: [1] },
      get(this: PBRMaterial, value) {
        value.num[0] = this.clearcoatNormalScale;
      },
      set(this: PBRMaterial, value) {
        this.clearcoatNormalScale = value.num[0];
      }
    },
    {
      name: 'ClearCoatNormalTexCoordIndex',
      type: 'int',
      default: { num: [0] },
      get(this: PBRMaterial, value) {
        value.num[0] = this.clearcoatNormalTexCoordIndex;
      },
      set(this: PBRMaterial, value) {
        this.clearcoatNormalTexCoordIndex = value.num[0];
      }
    },
    {
      name: 'ClearCoatNormalTexture',
      type: 'object',
      default: { str: [''] },
      get(this: PBRMaterial, value) {
        const name = this.clearcoatNormalTexture?.name ?? '';
        value.str[0] = name.startsWith('ASSET:') ? name.slice(6) : name;
      },
      set(this: PBRMaterial, value) {
        if (value.str[0]?.startsWith('ASSET:')) {
          const assetId = value.str[0].slice(6);
          const assetInfo = assetRegistry.getAssetInfo(assetId);
          if (assetInfo && assetInfo.type === 'texture') {
            assetRegistry.fetchTexture<Texture2D>(assetId, assetInfo.textureOptions).then((tex) => {
              if (tex?.isTexture2D()) {
                tex.name = `ASSET:${assetId}`;
                this.clearcoatNormalTexture = tex;
              } else {
                console.error('Invalid clearcoat normal texture');
              }
            });
          }
        }
      }
    },
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
      }
    },
    {
      name: 'SheenColorTexCoordIndex',
      type: 'int',
      default: { num: [0] },
      get(this: PBRMaterial, value) {
        value.num[0] = this.sheenColorTexCoordIndex;
      },
      set(this: PBRMaterial, value) {
        this.sheenColorTexCoordIndex = value.num[0];
      }
    },
    {
      name: 'SheenColorTexture',
      type: 'object',
      default: { str: [''] },
      get(this: PBRMaterial, value) {
        const name = this.sheenColorTexture?.name ?? '';
        value.str[0] = name.startsWith('ASSET:') ? name.slice(6) : name;
      },
      set(this: PBRMaterial, value) {
        if (value.str[0]?.startsWith('ASSET:')) {
          const assetId = value.str[0].slice(6);
          const assetInfo = assetRegistry.getAssetInfo(assetId);
          if (assetInfo && assetInfo.type === 'texture') {
            assetRegistry.fetchTexture<Texture2D>(assetId, assetInfo.textureOptions).then((tex) => {
              if (tex?.isTexture2D()) {
                tex.name = `ASSET:${assetId}`;
                this.sheenColorTexture = tex;
              } else {
                console.error('Invalid sheen color texture');
              }
            });
          }
        }
      }
    },
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
      }
    },
    {
      name: 'SheenRoughnessTexCoordIndex',
      type: 'int',
      default: { num: [0] },
      get(this: PBRMaterial, value) {
        value.num[0] = this.sheenRoughnessTexCoordIndex;
      },
      set(this: PBRMaterial, value) {
        this.sheenRoughnessTexCoordIndex = value.num[0];
      }
    },
    {
      name: 'SheenRoughnessTexture',
      type: 'object',
      default: { str: [''] },
      get(this: PBRMaterial, value) {
        const name = this.sheenRoughnessTexture?.name ?? '';
        value.str[0] = name.startsWith('ASSET:') ? name.slice(6) : name;
      },
      set(this: PBRMaterial, value) {
        if (value.str[0]?.startsWith('ASSET:')) {
          const assetId = value.str[0].slice(6);
          const assetInfo = assetRegistry.getAssetInfo(assetId);
          if (assetInfo && assetInfo.type === 'texture') {
            assetRegistry.fetchTexture<Texture2D>(assetId, assetInfo.textureOptions).then((tex) => {
              if (tex?.isTexture2D()) {
                tex.name = `ASSET:${assetId}`;
                this.sheenRoughnessTexture = tex;
              } else {
                console.error('Invalid sheen roughness texture');
              }
            });
          }
        }
      }
    },
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
      }
    },
    {
      name: 'NormalTexCoordIndex',
      type: 'int',
      default: { num: [0] },
      get(this: LitPropTypes, value) {
        value.num[0] = this.normalTexCoordIndex;
      },
      set(this: LitPropTypes, value) {
        this.normalTexCoordIndex = value.num[0];
      }
    },
    {
      name: 'NormalTexture',
      type: 'object',
      default: { str: [''] },
      get(this: LitPropTypes, value) {
        const name = this.normalTexture?.name ?? '';
        value.str[0] = name.startsWith('ASSET:') ? name.slice(6) : name;
      },
      set(this: LitPropTypes, value) {
        if (value.str[0]?.startsWith('ASSET:')) {
          const assetId = value.str[0].slice(6);
          const assetInfo = assetRegistry.getAssetInfo(assetId);
          if (assetInfo && assetInfo.type === 'texture') {
            assetRegistry.fetchTexture<Texture2D>(assetId, assetInfo.textureOptions).then((tex) => {
              if (tex?.isTexture2D()) {
                tex.name = `ASSET:${assetId}`;
                this.normalTexture = tex;
              } else {
                console.error('Invalid normal texture');
              }
            });
          }
        }
      }
    }
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
    {
      name: 'AlbedoTexCoordIndex',
      type: 'int',
      default: { num: [0] },
      get(this: UnlitPropTypes, value) {
        value.num[0] = this.albedoTexCoordIndex;
      },
      set(this: UnlitPropTypes, value) {
        this.albedoTexCoordIndex = value.num[0];
      }
    },
    {
      name: 'AlbedoTexture',
      type: 'object',
      default: { str: [''] },
      get(this: UnlitPropTypes, value) {
        const name = this.albedoTexture?.name ?? '';
        value.str[0] = name.startsWith('ASSET:') ? name.slice(6) : name;
      },
      set(this: UnlitPropTypes, value) {
        if (value.str[0]?.startsWith('ASSET:')) {
          const assetId = value.str[0].slice(6);
          const assetInfo = assetRegistry.getAssetInfo(assetId);
          if (assetInfo && assetInfo.type === 'texture') {
            assetRegistry.fetchTexture<Texture2D>(assetId, assetInfo.textureOptions).then((tex) => {
              if (tex?.isTexture2D()) {
                tex.name = `ASSET:${assetId}`;
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

export function getMeshMaterialClass(): SerializableClass<MeshMaterial> {
  return {
    ctor: MeshMaterial,
    className: 'MeshMaterial',
    createFunc() {
      return new MeshMaterial();
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

export function getUnlitMaterialClass(assetRegistry: AssetRegistry): SerializableClass<MeshMaterial> {
  return {
    ctor: UnlitMaterial,
    parent: getMeshMaterialClass(),
    className: 'UnlitMaterial',
    createFunc() {
      return new UnlitMaterial();
    },
    getProps() {
      return getUnlitMaterialProps(assetRegistry);
    }
  };
}

export function getLambertMaterialClass(assetRegistry: AssetRegistry): SerializableClass<MeshMaterial> {
  return {
    ctor: LambertMaterial,
    parent: getMeshMaterialClass(),
    className: 'LambertMaterial',
    createFunc() {
      return new LambertMaterial();
    },
    getProps() {
      return getLitMaterialProps(assetRegistry);
    }
  };
}

export function getBlinnMaterialClass(assetRegistry: AssetRegistry): SerializableClass<MeshMaterial> {
  return {
    ctor: BlinnMaterial,
    parent: getMeshMaterialClass(),
    className: 'BlinnMaterial',
    createFunc() {
      return new BlinnMaterial();
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

export function getPBRMetallicRoughnessMaterialClass(
  assetRegistry: AssetRegistry
): SerializableClass<MeshMaterial> {
  return {
    ctor: PBRMetallicRoughnessMaterial,
    parent: getMeshMaterialClass(),
    className: 'PBRMetallicRoughnessMaterial',
    createFunc() {
      return new PBRMetallicRoughnessMaterial();
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
        {
          name: 'MetallicRoughnessTexCoordIndex',
          type: 'int',
          default: { num: [0] },
          get(this: PBRMetallicRoughnessMaterial, value) {
            value.num[0] = this.metallicRoughnessTexCoordIndex;
          },
          set(this: PBRMetallicRoughnessMaterial, value) {
            this.metallicRoughnessTexCoordIndex = value.num[0];
          }
        },
        {
          name: 'MetallicRoughnessTexture',
          type: 'object',
          default: { str: [''] },
          get(this: PBRMetallicRoughnessMaterial, value) {
            const name = this.metallicRoughnessTexture?.name ?? '';
            value.str[0] = name.startsWith('ASSET:') ? name.slice(6) : name;
          },
          set(this: PBRMetallicRoughnessMaterial, value) {
            if (value.str[0]?.startsWith('ASSET:')) {
              const assetId = value.str[0].slice(6);
              const assetInfo = assetRegistry.getAssetInfo(assetId);
              if (assetInfo && assetInfo.type === 'texture') {
                assetRegistry.fetchTexture<Texture2D>(assetId, assetInfo.textureOptions).then((tex) => {
                  if (tex?.isTexture2D()) {
                    tex.name = `ASSET:${assetId}`;
                    this.metallicRoughnessTexture = tex;
                  } else {
                    console.error('Invalid metallic roughness texture');
                  }
                });
              }
            }
          }
        },
        {
          name: 'SpecularColorTexCoordIndex',
          type: 'int',
          default: { num: [0] },
          get(this: PBRMetallicRoughnessMaterial, value) {
            value.num[0] = this.specularColorTexCoordIndex;
          },
          set(this: PBRMetallicRoughnessMaterial, value) {
            this.specularColorTexCoordIndex = value.num[0];
          }
        },
        {
          name: 'SpecularColorTexture',
          type: 'object',
          default: { str: [''] },
          get(this: PBRMetallicRoughnessMaterial, value) {
            const name = this.specularColorTexture?.name ?? '';
            value.str[0] = name.startsWith('ASSET:') ? name.slice(6) : name;
          },
          set(this: PBRMetallicRoughnessMaterial, value) {
            if (value.str[0]?.startsWith('ASSET:')) {
              const assetId = value.str[0].slice(6);
              const assetInfo = assetRegistry.getAssetInfo(assetId);
              if (assetInfo && assetInfo.type === 'texture') {
                assetRegistry.fetchTexture<Texture2D>(assetId, assetInfo.textureOptions).then((tex) => {
                  if (tex?.isTexture2D()) {
                    tex.name = `ASSET:${assetId}`;
                    this.specularColorTexture = tex;
                  } else {
                    console.error('Invalid specular texture');
                  }
                });
              }
            }
          }
        },
        ...getPBRCommonProps(assetRegistry)
      ];
    }
  };
}

export function getPBRSpecularGlossinessMaterialClass(
  assetRegistry: AssetRegistry
): SerializableClass<MeshMaterial> {
  return {
    ctor: PBRSpecularGlossinessMaterial,
    parent: getMeshMaterialClass(),
    className: 'PBRSpecularGlossinessMaterial',
    createFunc() {
      return new PBRSpecularGlossinessMaterial();
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
