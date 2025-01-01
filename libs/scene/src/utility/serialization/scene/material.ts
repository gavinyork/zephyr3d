import { FaceMode, Texture2D } from '@zephyr3d/device';
import {
  BlendMode,
  BlinnMaterial,
  LambertMaterial,
  MeshMaterial,
  PBRMetallicRoughnessMaterial,
  UnlitMaterial
} from '../../../material';
import type { SerializableClass } from '../types';
import { AssetRegistry } from '../asset/asset';
import { Vector3, Vector4 } from '@zephyr3d/base';

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
      return [
        {
          name: 'vertexColor',
          type: 'bool',
          default: { bool: [false] },
          get(this: UnlitMaterial, value) {
            value.bool[0] = this.vertexColor;
          },
          set(this: UnlitMaterial, value) {
            this.vertexColor = value.bool[0];
          }
        },
        {
          name: 'AlbedoColor',
          type: 'rgba',
          default: { num: [1, 1, 1, 1] },
          get(this: UnlitMaterial, value) {
            const color = this.albedoColor;
            value.num[0] = color.x;
            value.num[1] = color.y;
            value.num[2] = color.z;
            value.num[3] = color.w;
          },
          set(this: UnlitMaterial, value) {
            this.albedoColor = new Vector4(value.num[0], value.num[1], value.num[2], value.num[3]);
          }
        },
        {
          name: 'AlbedoTexCoordIndex',
          type: 'int',
          default: { num: [0] },
          get(this: UnlitMaterial, value) {
            value.num[0] = this.albedoTexCoordIndex;
          },
          set(this: UnlitMaterial, value) {
            this.albedoTexCoordIndex = value.num[0];
          }
        },
        {
          name: 'AlbedoTexture',
          type: 'string',
          usage: 'texture_2d',
          default: { str: [''] },
          get(this: UnlitMaterial, value) {
            const name = this.albedoTexture.name;
            value.str[0] = name?.startsWith('ASSET:') ? name.slice(6) : name;
          },
          set(this: UnlitMaterial, value) {
            if (value.str[0]?.startsWith('ASSET:')) {
              const assetId = value.str[0].slice(6);
              const assetInfo = assetRegistry.getAssetInfo(assetId);
              if (assetInfo && assetInfo.type === 'texture_2d') {
                assetRegistry.fetchTexture<Texture2D>(assetId, assetInfo.textureOptions).then((tex) => {
                  tex.name = `ASSET:${assetId}`;
                  this.albedoTexture = tex;
                });
              }
            }
          }
        }
      ];
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
      return [
        {
          name: 'vertexColor',
          type: 'bool',
          default: { bool: [false] },
          get(this: LambertMaterial, value) {
            value.bool[0] = this.vertexColor;
          },
          set(this: LambertMaterial, value) {
            this.vertexColor = value.bool[0];
          }
        },
        {
          name: 'vertexNormal',
          type: 'bool',
          default: { bool: [true] },
          get(this: LambertMaterial, value) {
            value.bool[0] = this.vertexNormal;
          },
          set(this: LambertMaterial, value) {
            this.vertexNormal = value.bool[0];
          }
        },
        {
          name: 'vertexTangent',
          type: 'bool',
          default: { bool: [false] },
          get(this: LambertMaterial, value) {
            value.bool[0] = this.vertexTangent;
          },
          set(this: LambertMaterial, value) {
            this.vertexTangent = value.bool[0];
          }
        },
        {
          name: 'AlbedoColor',
          type: 'rgba',
          default: { num: [1, 1, 1, 1] },
          get(this: LambertMaterial, value) {
            const color = this.albedoColor;
            value.num[0] = color.x;
            value.num[1] = color.y;
            value.num[2] = color.z;
            value.num[3] = color.w;
          },
          set(this: LambertMaterial, value) {
            this.albedoColor.setXYZW(value.num[0], value.num[1], value.num[2], value.num[3]);
          }
        },
        {
          name: 'AlbedoTexCoordIndex',
          type: 'int',
          default: { num: [0] },
          get(this: LambertMaterial, value) {
            value.num[0] = this.albedoTexCoordIndex;
          },
          set(this: LambertMaterial, value) {
            this.albedoTexCoordIndex = value.num[0];
          }
        },
        {
          name: 'AlbedoTexture',
          type: 'string',
          usage: 'texture_2d',
          default: { str: [''] },
          get(this: LambertMaterial, value) {
            const name = this.albedoTexture.name;
            value.str[0] = name?.startsWith('ASSET:') ? name.slice(6) : name;
          },
          set(this: LambertMaterial, value) {
            if (value.str[0]?.startsWith('ASSET:')) {
              const assetId = value.str[0].slice(6);
              const assetInfo = assetRegistry.getAssetInfo(assetId);
              if (assetInfo && assetInfo.type === 'texture_2d') {
                assetRegistry.fetchTexture<Texture2D>(assetId, assetInfo.textureOptions).then((tex) => {
                  tex.name = `ASSET:${assetId}`;
                  this.albedoTexture = tex;
                });
              }
            }
          }
        },
        {
          name: 'NormalTexCoordIndex',
          type: 'int',
          default: { num: [0] },
          get(this: LambertMaterial, value) {
            value.num[0] = this.normalTexCoordIndex;
          },
          set(this: LambertMaterial, value) {
            this.normalTexCoordIndex = value.num[0];
          }
        },
        {
          name: 'NormalTexture',
          type: 'string',
          usage: 'texture_2d',
          default: { str: [''] },
          get(this: LambertMaterial, value) {
            const name = this.normalTexture.name;
            value.str[0] = name?.startsWith('ASSET:') ? name.slice(6) : name;
          },
          set(this: LambertMaterial, value) {
            if (value.str[0]?.startsWith('ASSET:')) {
              const assetId = value.str[0].slice(6);
              const assetInfo = assetRegistry.getAssetInfo(assetId);
              if (assetInfo && assetInfo.type === 'texture_2d') {
                assetRegistry.fetchTexture<Texture2D>(assetId, assetInfo.textureOptions).then((tex) => {
                  tex.name = `ASSET:${assetId}`;
                  this.normalTexture = tex;
                });
              }
            }
          }
        }
      ];
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
          get(this: BlinnMaterial, value) {
            value.num[0] = this.shininess;
          },
          set(this: BlinnMaterial, value) {
            this.shininess = value.num[0];
          }
        },
        {
          name: 'vertexColor',
          type: 'bool',
          default: { bool: [false] },
          get(this: BlinnMaterial, value) {
            value.bool[0] = this.vertexColor;
          },
          set(this: BlinnMaterial, value) {
            this.vertexColor = value.bool[0];
          }
        },
        {
          name: 'vertexNormal',
          type: 'bool',
          default: { bool: [true] },
          get(this: BlinnMaterial, value) {
            value.bool[0] = this.vertexNormal;
          },
          set(this: BlinnMaterial, value) {
            this.vertexNormal = value.bool[0];
          }
        },
        {
          name: 'vertexTangent',
          type: 'bool',
          default: { bool: [false] },
          get(this: BlinnMaterial, value) {
            value.bool[0] = this.vertexTangent;
          },
          set(this: BlinnMaterial, value) {
            this.vertexTangent = value.bool[0];
          }
        },
        {
          name: 'AlbedoColor',
          type: 'rgba',
          default: { num: [1, 1, 1, 1] },
          get(this: BlinnMaterial, value) {
            const color = this.albedoColor;
            value.num[0] = color.x;
            value.num[1] = color.y;
            value.num[2] = color.z;
            value.num[3] = color.w;
          },
          set(this: BlinnMaterial, value) {
            this.albedoColor.setXYZW(value.num[0], value.num[1], value.num[2], value.num[3]);
          }
        },
        {
          name: 'AlbedoTexCoordIndex',
          type: 'int',
          default: { num: [0] },
          get(this: BlinnMaterial, value) {
            value.num[0] = this.albedoTexCoordIndex;
          },
          set(this: BlinnMaterial, value) {
            this.albedoTexCoordIndex = value.num[0];
          }
        },
        {
          name: 'AlbedoTexture',
          type: 'string',
          usage: 'texture_2d',
          default: { str: [''] },
          get(this: BlinnMaterial, value) {
            const name = this.albedoTexture.name;
            value.str[0] = name?.startsWith('ASSET:') ? name.slice(6) : name;
          },
          set(this: BlinnMaterial, value) {
            if (value.str[0]?.startsWith('ASSET:')) {
              const assetId = value.str[0].slice(6);
              const assetInfo = assetRegistry.getAssetInfo(assetId);
              if (assetInfo && assetInfo.type === 'texture_2d') {
                assetRegistry.fetchTexture<Texture2D>(assetId, assetInfo.textureOptions).then((tex) => {
                  tex.name = `ASSET:${assetId}`;
                  this.albedoTexture = tex;
                });
              }
            }
          }
        },
        {
          name: 'NormalTexCoordIndex',
          type: 'int',
          default: { num: [0] },
          get(this: BlinnMaterial, value) {
            value.num[0] = this.normalTexCoordIndex;
          },
          set(this: BlinnMaterial, value) {
            this.normalTexCoordIndex = value.num[0];
          }
        },
        {
          name: 'NormalTexture',
          type: 'string',
          usage: 'texture_2d',
          default: { str: [''] },
          get(this: BlinnMaterial, value) {
            const name = this.normalTexture.name;
            value.str[0] = name?.startsWith('ASSET:') ? name.slice(6) : name;
          },
          set(this: BlinnMaterial, value) {
            if (value.str[0]?.startsWith('ASSET:')) {
              const assetId = value.str[0].slice(6);
              const assetInfo = assetRegistry.getAssetInfo(assetId);
              if (assetInfo && assetInfo.type === 'texture_2d') {
                assetRegistry.fetchTexture<Texture2D>(assetId, assetInfo.textureOptions).then((tex) => {
                  tex.name = `ASSET:${assetId}`;
                  this.normalTexture = tex;
                });
              }
            }
          }
        }
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
          get(this: PBRMetallicRoughnessMaterial, value) {
            value.num[0] = this.roughness;
          },
          set(this: PBRMetallicRoughnessMaterial, value) {
            this.roughness = value.num[0];
          }
        },
        {
          name: 'SpecularFactor',
          type: 'vec4',
          default: { num: [1, 1, 1, 1] },
          get(this: PBRMetallicRoughnessMaterial, value) {
            value.num[0] = this.specularFactor.x;
            value.num[1] = this.specularFactor.y;
            value.num[2] = this.specularFactor.z;
            value.num[3] = this.specularFactor.w;
          },
          set(this: PBRMetallicRoughnessMaterial, value) {
            this.specularFactor = new Vector4(value.num[0], value.num[1], value.num[2], value.num[3]);
          }
        },
        {
          name: 'IOR',
          type: 'float',
          default: { num: [1.5] },
          get(this: PBRMetallicRoughnessMaterial, value) {
            value.num[0] = this.ior;
          },
          set(this: PBRMetallicRoughnessMaterial, value) {
            this.ior = value.num[0];
          }
        },
        {
          name: 'OcclusionStrength',
          type: 'float',
          default: { num: [1] },
          get(this: PBRMetallicRoughnessMaterial, value) {
            value.num[0] = this.occlusionStrength;
          },
          set(this: PBRMetallicRoughnessMaterial, value) {
            this.occlusionStrength = value.num[0];
          }
        },
        {
          name: 'OcclusionTexCoordIndex',
          type: 'int',
          default: { num: [0] },
          get(this: PBRMetallicRoughnessMaterial, value) {
            value.num[0] = this.occlusionTexCoordIndex;
          },
          set(this: PBRMetallicRoughnessMaterial, value) {
            this.occlusionTexCoordIndex = value.num[0];
          }
        },
        {
          name: 'OcclusionTexture',
          type: 'string',
          usage: 'texture_2d',
          default: { str: [''] },
          get(this: PBRMetallicRoughnessMaterial, value) {
            const name = this.occlusionTexture.name;
            value.str[0] = name?.startsWith('ASSET:') ? name.slice(6) : name;
          },
          set(this: PBRMetallicRoughnessMaterial, value) {
            if (value.str[0]?.startsWith('ASSET:')) {
              const assetId = value.str[0].slice(6);
              const assetInfo = assetRegistry.getAssetInfo(assetId);
              if (assetInfo && assetInfo.type === 'texture_2d') {
                assetRegistry.fetchTexture<Texture2D>(assetId, assetInfo.textureOptions).then((tex) => {
                  tex.name = `ASSET:${assetId}`;
                  this.occlusionTexture = tex;
                });
              }
            }
          }
        },
        {
          name: 'EmissiveColor',
          type: 'rgb',
          default: { num: [0, 0, 0] },
          get(this: PBRMetallicRoughnessMaterial, value) {
            value.num[0] = this.emissiveColor.x;
            value.num[1] = this.emissiveColor.y;
            value.num[2] = this.emissiveColor.z;
          },
          set(this: PBRMetallicRoughnessMaterial, value) {
            this.emissiveColor = new Vector3(value.num[0], value.num[1], value.num[2]);
          }
        },
        {
          name: 'EmissiveStrength',
          type: 'float',
          default: { num: [1] },
          get(this: PBRMetallicRoughnessMaterial, value) {
            value.num[0] = this.emissiveStrength;
          },
          set(this: PBRMetallicRoughnessMaterial, value) {
            this.emissiveStrength = value.num[0];
          }
        },
        {
          name: 'EmissiveTexCoordIndex',
          type: 'int',
          default: { num: [0] },
          get(this: PBRMetallicRoughnessMaterial, value) {
            value.num[0] = this.emissiveTexCoordIndex;
          },
          set(this: PBRMetallicRoughnessMaterial, value) {
            this.emissiveTexCoordIndex = value.num[0];
          }
        },
        {
          name: 'EmissiveTexture',
          type: 'string',
          usage: 'texture_2d',
          default: { str: [''] },
          get(this: PBRMetallicRoughnessMaterial, value) {
            const name = this.emissiveTexture.name;
            value.str[0] = name?.startsWith('ASSET:') ? name.slice(6) : name;
          },
          set(this: PBRMetallicRoughnessMaterial, value) {
            if (value.str[0]?.startsWith('ASSET:')) {
              const assetId = value.str[0].slice(6);
              const assetInfo = assetRegistry.getAssetInfo(assetId);
              if (assetInfo && assetInfo.type === 'texture_2d') {
                assetRegistry.fetchTexture<Texture2D>(assetId, assetInfo.textureOptions).then((tex) => {
                  tex.name = `ASSET:${assetId}`;
                  this.emissiveTexture = tex;
                });
              }
            }
          }
        },
        {
          name: 'Transmission',
          type: 'bool',
          default: { bool: [false] },
          get(this: PBRMetallicRoughnessMaterial, value) {
            value.bool[0] = this.transmission;
          },
          set(this: PBRMetallicRoughnessMaterial, value) {
            this.transmission = value.bool[0];
          }
        },
        {
          name: 'TransmissionFactor',
          type: 'float',
          default: { num: [0] },
          get(this: PBRMetallicRoughnessMaterial, value) {
            value.num[0] = this.transmissionFactor;
          },
          set(this: PBRMetallicRoughnessMaterial, value) {
            this.transmissionFactor = value.num[0];
          }
        },
        {
          name: 'TransmissionTexCoordIndex',
          type: 'int',
          default: { num: [0] },
          get(this: PBRMetallicRoughnessMaterial, value) {
            value.num[0] = this.transmissionTexCoordIndex;
          },
          set(this: PBRMetallicRoughnessMaterial, value) {
            this.transmissionTexCoordIndex = value.num[0];
          }
        },
        {
          name: 'TransmissionTexture',
          type: 'string',
          usage: 'texture_2d',
          default: { str: [''] },
          get(this: PBRMetallicRoughnessMaterial, value) {
            const name = this.transmissionTexture.name;
            value.str[0] = name?.startsWith('ASSET:') ? name.slice(6) : name;
          },
          set(this: PBRMetallicRoughnessMaterial, value) {
            if (value.str[0]?.startsWith('ASSET:')) {
              const assetId = value.str[0].slice(6);
              const assetInfo = assetRegistry.getAssetInfo(assetId);
              if (assetInfo && assetInfo.type === 'texture_2d') {
                assetRegistry.fetchTexture<Texture2D>(assetId, assetInfo.textureOptions).then((tex) => {
                  tex.name = `ASSET:${assetId}`;
                  this.transmissionTexture = tex;
                });
              }
            }
          }
        },
        {
          name: 'ThicknessFactor',
          type: 'float',
          default: { num: [0] },
          get(this: PBRMetallicRoughnessMaterial, value) {
            value.num[0] = this.thicknessFactor;
          },
          set(this: PBRMetallicRoughnessMaterial, value) {
            this.thicknessFactor = value.num[0];
          }
        },
        {
          name: 'ThicknessTexCoordIndex',
          type: 'int',
          default: { num: [0] },
          get(this: PBRMetallicRoughnessMaterial, value) {
            value.num[0] = this.thicknessTexCoordIndex;
          },
          set(this: PBRMetallicRoughnessMaterial, value) {
            this.thicknessTexCoordIndex = value.num[0];
          }
        },
        {
          name: 'thicknessTexture',
          type: 'string',
          usage: 'texture_2d',
          default: { str: [''] },
          get(this: PBRMetallicRoughnessMaterial, value) {
            const name = this.thicknessTexture.name;
            value.str[0] = name?.startsWith('ASSET:') ? name.slice(6) : name;
          },
          set(this: PBRMetallicRoughnessMaterial, value) {
            if (value.str[0]?.startsWith('ASSET:')) {
              const assetId = value.str[0].slice(6);
              const assetInfo = assetRegistry.getAssetInfo(assetId);
              if (assetInfo && assetInfo.type === 'texture_2d') {
                assetRegistry.fetchTexture<Texture2D>(assetId, assetInfo.textureOptions).then((tex) => {
                  tex.name = `ASSET:${assetId}`;
                  this.thicknessTexture = tex;
                });
              }
            }
          }
        },
        {
          name: 'AttenuationColor',
          type: 'rgb',
          default: { num: [1, 1, 1] },
          get(this: PBRMetallicRoughnessMaterial, value) {
            value.num[0] = this.attenuationColor.x;
            value.num[1] = this.attenuationColor.y;
            value.num[2] = this.attenuationColor.z;
          },
          set(this: PBRMetallicRoughnessMaterial, value) {
            this.attenuationColor = new Vector3(value.num[0], value.num[1], value.num[2]);
          }
        },
        {
          name: 'AttenuationDistance',
          type: 'float',
          default: { num: [99999] },
          get(this: PBRMetallicRoughnessMaterial, value) {
            value.num[0] = this.attenuationDistance;
          },
          set(this: PBRMetallicRoughnessMaterial, value) {
            this.attenuationDistance = value.num[0];
          }
        },
        {
          name: 'Iridescence',
          type: 'bool',
          default: { bool: [false] },
          get(this: PBRMetallicRoughnessMaterial, value) {
            value.bool[0] = this.iridescence;
          },
          set(this: PBRMetallicRoughnessMaterial, value) {
            this.iridescence = value.bool[0];
          }
        },
        {
          name: 'IridescenceFactor',
          type: 'float',
          default: { num: [0] },
          get(this: PBRMetallicRoughnessMaterial, value) {
            value.num[0] = this.iridescenceFactor;
          },
          set(this: PBRMetallicRoughnessMaterial, value) {
            this.iridescenceFactor = value.num[0];
          }
        },
        {
          name: 'IridescenceTexCoordIndex',
          type: 'int',
          default: { num: [0] },
          get(this: PBRMetallicRoughnessMaterial, value) {
            value.num[0] = this.iridescenceTexCoordIndex;
          },
          set(this: PBRMetallicRoughnessMaterial, value) {
            this.iridescenceTexCoordIndex = value.num[0];
          }
        },
        {
          name: 'IridescenceTexture',
          type: 'string',
          usage: 'texture_2d',
          default: { str: [''] },
          get(this: PBRMetallicRoughnessMaterial, value) {
            const name = this.iridescenceTexture.name;
            value.str[0] = name?.startsWith('ASSET:') ? name.slice(6) : name;
          },
          set(this: PBRMetallicRoughnessMaterial, value) {
            if (value.str[0]?.startsWith('ASSET:')) {
              const assetId = value.str[0].slice(6);
              const assetInfo = assetRegistry.getAssetInfo(assetId);
              if (assetInfo && assetInfo.type === 'texture_2d') {
                assetRegistry.fetchTexture<Texture2D>(assetId, assetInfo.textureOptions).then((tex) => {
                  tex.name = `ASSET:${assetId}`;
                  this.iridescenceTexture = tex;
                });
              }
            }
          }
        },
        {
          name: 'IridescenceIOR',
          type: 'float',
          default: { num: [1.3] },
          get(this: PBRMetallicRoughnessMaterial, value) {
            value.num[0] = this.iridescenceIor;
          },
          set(this: PBRMetallicRoughnessMaterial, value) {
            this.iridescenceIor = value.num[0];
          }
        },
        {
          name: 'IridescenceThicknessMin',
          type: 'float',
          default: { num: [100] },
          get(this: PBRMetallicRoughnessMaterial, value) {
            value.num[0] = this.iridescenceThicknessMin;
          },
          set(this: PBRMetallicRoughnessMaterial, value) {
            this.iridescenceThicknessMin = value.num[0];
          }
        },
        {
          name: 'IridescenceThicknessMax',
          type: 'float',
          default: { num: [400] },
          get(this: PBRMetallicRoughnessMaterial, value) {
            value.num[0] = this.iridescenceThicknessMax;
          },
          set(this: PBRMetallicRoughnessMaterial, value) {
            this.iridescenceThicknessMax = value.num[0];
          }
        },
        {
          name: 'IridescenceThicknessTexCoordIndex',
          type: 'int',
          default: { num: [0] },
          get(this: PBRMetallicRoughnessMaterial, value) {
            value.num[0] = this.iridescenceThicknessTexCoordIndex;
          },
          set(this: PBRMetallicRoughnessMaterial, value) {
            this.iridescenceThicknessTexCoordIndex = value.num[0];
          }
        },
        {
          name: 'IridescenceThicknessTexture',
          type: 'string',
          usage: 'texture_2d',
          default: { str: [''] },
          get(this: PBRMetallicRoughnessMaterial, value) {
            const name = this.iridescenceThicknessTexture.name;
            value.str[0] = name?.startsWith('ASSET:') ? name.slice(6) : name;
          },
          set(this: PBRMetallicRoughnessMaterial, value) {
            if (value.str[0]?.startsWith('ASSET:')) {
              const assetId = value.str[0].slice(6);
              const assetInfo = assetRegistry.getAssetInfo(assetId);
              if (assetInfo && assetInfo.type === 'texture_2d') {
                assetRegistry.fetchTexture<Texture2D>(assetId, assetInfo.textureOptions).then((tex) => {
                  tex.name = `ASSET:${assetId}`;
                  this.iridescenceThicknessTexture = tex;
                });
              }
            }
          }
        },
        {
          name: 'ClearCoat',
          type: 'bool',
          default: { bool: [false] },
          get(this: PBRMetallicRoughnessMaterial, value) {
            value.bool[0] = this.clearcoat;
          },
          set(this: PBRMetallicRoughnessMaterial, value) {
            this.clearcoat = value.bool[0];
          }
        },
        {
          name: 'ClearCoatIntensity',
          type: 'float',
          default: { num: [0] },
          get(this: PBRMetallicRoughnessMaterial, value) {
            value.num[0] = this.clearcoatIntensity;
          },
          set(this: PBRMetallicRoughnessMaterial, value) {
            this.clearcoatIntensity = value.num[0];
          }
        },
        {
          name: 'ClearCoatIntensityTexCoordIndex',
          type: 'int',
          default: { num: [0] },
          get(this: PBRMetallicRoughnessMaterial, value) {
            value.num[0] = this.clearcoatIntensityTexCoordIndex;
          },
          set(this: PBRMetallicRoughnessMaterial, value) {
            this.clearcoatIntensityTexCoordIndex = value.num[0];
          }
        },
        {
          name: 'ClearCoatIntensityTexture',
          type: 'string',
          usage: 'texture_2d',
          default: { str: [''] },
          get(this: PBRMetallicRoughnessMaterial, value) {
            const name = this.clearcoatIntensityTexture.name;
            value.str[0] = name?.startsWith('ASSET:') ? name.slice(6) : name;
          },
          set(this: PBRMetallicRoughnessMaterial, value) {
            if (value.str[0]?.startsWith('ASSET:')) {
              const assetId = value.str[0].slice(6);
              const assetInfo = assetRegistry.getAssetInfo(assetId);
              if (assetInfo && assetInfo.type === 'texture_2d') {
                assetRegistry.fetchTexture<Texture2D>(assetId, assetInfo.textureOptions).then((tex) => {
                  tex.name = `ASSET:${assetId}`;
                  this.clearcoatIntensityTexture = tex;
                });
              }
            }
          }
        },
        {
          name: 'ClearCoatRoughnessFactor',
          type: 'float',
          default: { num: [0] },
          get(this: PBRMetallicRoughnessMaterial, value) {
            value.num[0] = this.clearcoatRoughnessFactor;
          },
          set(this: PBRMetallicRoughnessMaterial, value) {
            this.clearcoatRoughnessFactor = value.num[0];
          }
        },
        {
          name: 'ClearCoatRoughnessTexCoordIndex',
          type: 'int',
          default: { num: [0] },
          get(this: PBRMetallicRoughnessMaterial, value) {
            value.num[0] = this.clearcoatRoughnessTexCoordIndex;
          },
          set(this: PBRMetallicRoughnessMaterial, value) {
            this.clearcoatRoughnessTexCoordIndex = value.num[0];
          }
        },
        {
          name: 'ClearCoatRoughnessTexture',
          type: 'string',
          usage: 'texture_2d',
          default: { str: [''] },
          get(this: PBRMetallicRoughnessMaterial, value) {
            const name = this.clearcoatRoughnessTexture.name;
            value.str[0] = name?.startsWith('ASSET:') ? name.slice(6) : name;
          },
          set(this: PBRMetallicRoughnessMaterial, value) {
            if (value.str[0]?.startsWith('ASSET:')) {
              const assetId = value.str[0].slice(6);
              const assetInfo = assetRegistry.getAssetInfo(assetId);
              if (assetInfo && assetInfo.type === 'texture_2d') {
                assetRegistry.fetchTexture<Texture2D>(assetId, assetInfo.textureOptions).then((tex) => {
                  tex.name = `ASSET:${assetId}`;
                  this.clearcoatRoughnessTexture = tex;
                });
              }
            }
          }
        },
        {
          name: 'ClearCoatNormalScale',
          type: 'float',
          default: { num: [1] },
          get(this: PBRMetallicRoughnessMaterial, value) {
            value.num[0] = this.clearcoatNormalScale;
          },
          set(this: PBRMetallicRoughnessMaterial, value) {
            this.clearcoatNormalScale = value.num[0];
          }
        },
        {
          name: 'ClearCoatNormalTexCoordIndex',
          type: 'int',
          default: { num: [0] },
          get(this: PBRMetallicRoughnessMaterial, value) {
            value.num[0] = this.clearcoatNormalTexCoordIndex;
          },
          set(this: PBRMetallicRoughnessMaterial, value) {
            this.clearcoatNormalTexCoordIndex = value.num[0];
          }
        },
        {
          name: 'ClearCoatNormalTexture',
          type: 'string',
          usage: 'texture_2d',
          default: { str: [''] },
          get(this: PBRMetallicRoughnessMaterial, value) {
            const name = this.clearcoatNormalTexture.name;
            value.str[0] = name?.startsWith('ASSET:') ? name.slice(6) : name;
          },
          set(this: PBRMetallicRoughnessMaterial, value) {
            if (value.str[0]?.startsWith('ASSET:')) {
              const assetId = value.str[0].slice(6);
              const assetInfo = assetRegistry.getAssetInfo(assetId);
              if (assetInfo && assetInfo.type === 'texture_2d') {
                assetRegistry.fetchTexture<Texture2D>(assetId, assetInfo.textureOptions).then((tex) => {
                  tex.name = `ASSET:${assetId}`;
                  this.clearcoatNormalTexture = tex;
                });
              }
            }
          }
        },
        {
          name: 'Sheen',
          type: 'bool',
          default: { bool: [false] },
          get(this: PBRMetallicRoughnessMaterial, value) {
            value.bool[0] = this.sheen;
          },
          set(this: PBRMetallicRoughnessMaterial, value) {
            this.sheen = value.bool[0];
          }
        },
        {
          name: 'SheenColorFactor',
          type: 'rgb',
          default: { num: [0, 0, 0] },
          get(this: PBRMetallicRoughnessMaterial, value) {
            value.num[0] = this.sheenColorFactor.x;
            value.num[1] = this.sheenColorFactor.y;
            value.num[2] = this.sheenColorFactor.z;
          },
          set(this: PBRMetallicRoughnessMaterial, value) {
            this.sheenColorFactor = new Vector3(value.num[0], value.num[1], value.num[2]);
          }
        },
        {
          name: 'SheenColorTexCoordIndex',
          type: 'int',
          default: { num: [0] },
          get(this: PBRMetallicRoughnessMaterial, value) {
            value.num[0] = this.sheenColorTexCoordIndex;
          },
          set(this: PBRMetallicRoughnessMaterial, value) {
            this.sheenColorTexCoordIndex = value.num[0];
          }
        },
        {
          name: 'SheenColorTexture',
          type: 'string',
          usage: 'texture_2d',
          default: { str: [''] },
          get(this: PBRMetallicRoughnessMaterial, value) {
            const name = this.sheenColorTexture.name;
            value.str[0] = name?.startsWith('ASSET:') ? name.slice(6) : name;
          },
          set(this: PBRMetallicRoughnessMaterial, value) {
            if (value.str[0]?.startsWith('ASSET:')) {
              const assetId = value.str[0].slice(6);
              const assetInfo = assetRegistry.getAssetInfo(assetId);
              if (assetInfo && assetInfo.type === 'texture_2d') {
                assetRegistry.fetchTexture<Texture2D>(assetId, assetInfo.textureOptions).then((tex) => {
                  tex.name = `ASSET:${assetId}`;
                  this.sheenColorTexture = tex;
                });
              }
            }
          }
        },
        {
          name: 'SheenRoughnessFactor',
          type: 'float',
          default: { num: [0] },
          get(this: PBRMetallicRoughnessMaterial, value) {
            value.num[0] = this.sheenRoughnessFactor;
          },
          set(this: PBRMetallicRoughnessMaterial, value) {
            this.sheenRoughnessFactor = value.num[0];
          }
        },
        {
          name: 'SheenRoughnessTexCoordIndex',
          type: 'int',
          default: { num: [0] },
          get(this: PBRMetallicRoughnessMaterial, value) {
            value.num[0] = this.sheenRoughnessTexCoordIndex;
          },
          set(this: PBRMetallicRoughnessMaterial, value) {
            this.sheenRoughnessTexCoordIndex = value.num[0];
          }
        },
        {
          name: 'SheenRoughnessTexture',
          type: 'string',
          usage: 'texture_2d',
          default: { str: [''] },
          get(this: PBRMetallicRoughnessMaterial, value) {
            const name = this.sheenRoughnessTexture.name;
            value.str[0] = name?.startsWith('ASSET:') ? name.slice(6) : name;
          },
          set(this: PBRMetallicRoughnessMaterial, value) {
            if (value.str[0]?.startsWith('ASSET:')) {
              const assetId = value.str[0].slice(6);
              const assetInfo = assetRegistry.getAssetInfo(assetId);
              if (assetInfo && assetInfo.type === 'texture_2d') {
                assetRegistry.fetchTexture<Texture2D>(assetId, assetInfo.textureOptions).then((tex) => {
                  tex.name = `ASSET:${assetId}`;
                  this.sheenRoughnessTexture = tex;
                });
              }
            }
          }
        },
        {
          name: 'vertexColor',
          type: 'bool',
          default: { bool: [false] },
          get(this: BlinnMaterial, value) {
            value.bool[0] = this.vertexColor;
          },
          set(this: BlinnMaterial, value) {
            this.vertexColor = value.bool[0];
          }
        },
        {
          name: 'vertexNormal',
          type: 'bool',
          default: { bool: [true] },
          get(this: BlinnMaterial, value) {
            value.bool[0] = this.vertexNormal;
          },
          set(this: BlinnMaterial, value) {
            this.vertexNormal = value.bool[0];
          }
        },
        {
          name: 'vertexTangent',
          type: 'bool',
          default: { bool: [false] },
          get(this: BlinnMaterial, value) {
            value.bool[0] = this.vertexTangent;
          },
          set(this: BlinnMaterial, value) {
            this.vertexTangent = value.bool[0];
          }
        },
        {
          name: 'AlbedoColor',
          type: 'rgba',
          default: { num: [1, 1, 1, 1] },
          get(this: BlinnMaterial, value) {
            const color = this.albedoColor;
            value.num[0] = color.x;
            value.num[1] = color.y;
            value.num[2] = color.z;
            value.num[3] = color.w;
          },
          set(this: BlinnMaterial, value) {
            this.albedoColor.setXYZW(value.num[0], value.num[1], value.num[2], value.num[3]);
          }
        },
        {
          name: 'AlbedoTexCoordIndex',
          type: 'int',
          default: { num: [0] },
          get(this: BlinnMaterial, value) {
            value.num[0] = this.albedoTexCoordIndex;
          },
          set(this: BlinnMaterial, value) {
            this.albedoTexCoordIndex = value.num[0];
          }
        },
        {
          name: 'AlbedoTexture',
          type: 'string',
          usage: 'texture_2d',
          default: { str: [''] },
          get(this: BlinnMaterial, value) {
            const name = this.albedoTexture.name;
            value.str[0] = name?.startsWith('ASSET:') ? name.slice(6) : name;
          },
          set(this: BlinnMaterial, value) {
            if (value.str[0]?.startsWith('ASSET:')) {
              const assetId = value.str[0].slice(6);
              const assetInfo = assetRegistry.getAssetInfo(assetId);
              if (assetInfo && assetInfo.type === 'texture_2d') {
                assetRegistry.fetchTexture<Texture2D>(assetId, assetInfo.textureOptions).then((tex) => {
                  tex.name = `ASSET:${assetId}`;
                  this.albedoTexture = tex;
                });
              }
            }
          }
        },
        {
          name: 'NormalTexCoordIndex',
          type: 'int',
          default: { num: [0] },
          get(this: BlinnMaterial, value) {
            value.num[0] = this.normalTexCoordIndex;
          },
          set(this: BlinnMaterial, value) {
            this.normalTexCoordIndex = value.num[0];
          }
        },
        {
          name: 'NormalTexture',
          type: 'string',
          usage: 'texture_2d',
          default: { str: [''] },
          get(this: BlinnMaterial, value) {
            const name = this.normalTexture.name;
            value.str[0] = name?.startsWith('ASSET:') ? name.slice(6) : name;
          },
          set(this: BlinnMaterial, value) {
            if (value.str[0]?.startsWith('ASSET:')) {
              const assetId = value.str[0].slice(6);
              const assetInfo = assetRegistry.getAssetInfo(assetId);
              if (assetInfo && assetInfo.type === 'texture_2d') {
                assetRegistry.fetchTexture<Texture2D>(assetId, assetInfo.textureOptions).then((tex) => {
                  tex.name = `ASSET:${assetId}`;
                  this.normalTexture = tex;
                });
              }
            }
          }
        }
      ];
    }
  };
}
