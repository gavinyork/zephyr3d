import type { FaceMode, Texture2D } from '@zephyr3d/device';
import type { BlendMode } from '../../../material';
import {
  BlinnMaterial,
  LambertMaterial,
  MeshMaterial,
  ParticleMaterial,
  PBRBluePrintMaterial,
  PBRMetallicRoughnessMaterial,
  PBRSpecularGlossinessMaterial,
  Sprite3DBlueprintMaterial,
  UnlitMaterial
} from '../../../material';
import type { PropertyAccessor, SerializableClass } from '../types';
import { Vector3, Vector4 } from '@zephyr3d/base';
import { getTextureProps } from './common';
import type { ResourceManager } from '../manager';
import { getMeshMaterialInstanceUniformsClass } from './common';
import { Sprite3DMaterial } from '../../../material/sprite3d';

type PBRMaterial = PBRMetallicRoughnessMaterial | PBRSpecularGlossinessMaterial;
type LitPropTypes = LambertMaterial | BlinnMaterial | PBRMaterial;
type UnlitPropTypes = UnlitMaterial | LitPropTypes;

function getPBRCommonProps(manager: ResourceManager): PropertyAccessor<PBRMaterial>[] {
  return [
    {
      name: 'IOR',
      type: 'float',
      default: 1.5,
      options: {
        animatable: true
      },
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
        animatable: true,
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
    ...getTextureProps<PBRMaterial>(manager, 'occlusionTexture', '2D', false, 0),
    {
      name: 'EmissiveColor',
      type: 'rgb',
      options: {
        animatable: true
      },
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
        animatable: true,
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
    ...getTextureProps<PBRMaterial>(manager, 'emissiveTexture', '2D', true, 0),
    ...getTextureProps<PBRMaterial>(manager, 'specularTexture', '2D', false, 0),
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
        animatable: true,
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
    ...getTextureProps<PBRMaterial>(manager, 'transmissionTexture', '2D', false, 1, function () {
      return this.transmission;
    }),
    {
      name: 'ThicknessFactor',
      type: 'float',
      phase: 1,
      default: 0,
      options: {
        animatable: true,
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
    ...getTextureProps<PBRMaterial>(manager, 'thicknessTexture', '2D', false, 1, function () {
      return this.transmission;
    }),
    {
      name: 'AttenuationColor',
      type: 'rgb',
      phase: 1,
      default: [1, 1, 1],
      options: {
        animatable: true
      },
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
        animatable: true,
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
        animatable: true,
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
    ...getTextureProps<PBRMaterial>(manager, 'iridescenceTexture', '2D', false, 1, function () {
      return this.iridescence;
    }),
    {
      name: 'IridescenceIOR',
      type: 'float',
      phase: 1,
      default: 1.3,
      options: {
        animatable: true
      },
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
        animatable: true,
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
        animatable: true,
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
    ...getTextureProps<PBRMaterial>(manager, 'iridescenceThicknessTexture', '2D', false, 1, function () {
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
        animatable: true,
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
    ...getTextureProps<PBRMaterial>(manager, 'clearcoatIntensityTexture', '2D', false, 1, function () {
      return this.clearcoat;
    }),
    {
      name: 'ClearCoatRoughnessFactor',
      type: 'float',
      phase: 1,
      default: 0,
      options: {
        animatable: true,
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
    ...getTextureProps<PBRMaterial>(manager, 'clearcoatRoughnessTexture', '2D', false, 1, function () {
      return this.clearcoat;
    }),
    ...getTextureProps<PBRMaterial>(manager, 'clearcoatNormalTexture', '2D', false, 1, function () {
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
      options: {
        animatable: true
      },
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
    ...getTextureProps<PBRMaterial>(manager, 'sheenColorTexture', '2D', true, 1, function () {
      return this.sheen;
    }),
    {
      name: 'SheenRoughnessFactor',
      type: 'float',
      phase: 1,
      default: 0,
      options: {
        animatable: true,
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
    ...getTextureProps<PBRMaterial>(manager, 'sheenRoughnessTexture', '2D', false, 1, function () {
      return this.sheen;
    }),
    ...getLitMaterialProps(manager)
  ];
}

function getLitMaterialProps(manager: ResourceManager): PropertyAccessor<LitPropTypes>[] {
  return [
    ...getUnlitMaterialProps(manager),
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
    ...getTextureProps<LitPropTypes>(manager, 'normalTexture', '2D', false, 0)
  ];
}

function getUnlitMaterialProps(manager: ResourceManager): PropertyAccessor<UnlitPropTypes>[] {
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
      options: {
        animatable: true
      },
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
    ...getTextureProps<UnlitPropTypes>(manager, 'albedoTexture', '2D', true, 0)
  ];
}

/** @internal */
export function getMeshMaterialClass(): SerializableClass[] {
  return [
    {
      ctor: MeshMaterial,
      name: 'MeshMaterial',
      getProps() {
        return [
          {
            name: 'AlphaCutoff',
            type: 'float',
            default: 0,
            options: {
              animatable: true,
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
            options: {
              enum: { labels: ['None', 'Blend', 'Additive'], values: ['none', 'blend', 'additive'] }
            },
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
            options: {
              enum: { labels: ['None', 'Front', 'Back'], values: ['none', 'front', 'back'] }
            },
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
              animatable: true,
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
          },
          {
            name: 'TAAStrength',
            type: 'float',
            options: {
              minValue: 0,
              maxValue: 1
            },
            default: 15 / 16,
            get(this: MeshMaterial, value) {
              value.num[0] = this.TAAStrength;
            },
            set(this: MeshMaterial, value) {
              this.TAAStrength = value.num[0];
            },
            isValid(this: MeshMaterial) {
              return !this.$isInstance;
            }
          }
        ];
      }
    },
    getMeshMaterialInstanceUniformsClass(MeshMaterial)
  ];
}

/** @internal */
export function getSprite3DMaterialClass(_manager: ResourceManager): SerializableClass[] {
  return [
    {
      ctor: Sprite3DMaterial,
      name: 'Sprite3DMaterial',
      parent: MeshMaterial,
      getProps() {
        return [];
      }
    },
    getMeshMaterialInstanceUniformsClass(Sprite3DMaterial)
  ];
}

/** @internal */
export function getParticleMaterialClass(manager: ResourceManager): SerializableClass[] {
  return [
    {
      ctor: ParticleMaterial,
      name: 'ParticleMaterial',
      parent: MeshMaterial,
      getProps() {
        return [
          {
            name: 'AlphaMap',
            type: 'object',
            default: null,
            options: {
              mimeTypes: [
                'image/jpeg',
                'image/png',
                'image/tga',
                'image/vnd.radiance',
                'image/x-dds',
                'image/webp'
              ]
            },
            isNullable() {
              return true;
            },
            get(this: ParticleMaterial, value) {
              value.str[0] = manager.getAssetId(this.alphaMap) ?? '';
            },
            async set(this: ParticleMaterial, value) {
              if (value.str[0]) {
                const assetId = value.str[0];
                let tex: Texture2D;
                try {
                  tex = await manager.fetchTexture<Texture2D>(assetId, { linearColorSpace: true });
                } catch (err) {
                  console.error(`Load asset failed: ${value.str[0]}: ${err}`);
                }
                if (tex?.isTexture2D()) {
                  this.alphaMap = tex;
                } else {
                  console.error('Invalid albedo texture');
                }
              }
            }
          },
          {
            name: 'RampMap',
            type: 'object',
            default: null,
            options: {
              mimeTypes: [
                'image/jpeg',
                'image/png',
                'image/tga',
                'image/vnd.radiance',
                'image/x-dds',
                'image/webp'
              ]
            },
            isNullable() {
              return true;
            },
            get(this: ParticleMaterial, value) {
              value.str[0] = manager.getAssetId(this.rampMap) ?? '';
            },
            async set(this: ParticleMaterial, value) {
              if (value.str[0]) {
                const assetId = value.str[0];
                let tex: Texture2D;
                try {
                  tex = await manager.fetchTexture<Texture2D>(assetId);
                } catch (err) {
                  console.error(`Load asset failed: ${value.str[0]}: ${err}`);
                }
                if (tex?.isTexture2D()) {
                  this.rampMap = tex;
                } else {
                  console.error('Invalid albedo texture');
                }
              }
            }
          }
        ];
      }
    },
    getMeshMaterialInstanceUniformsClass(ParticleMaterial)
  ];
}

/** @internal */
export function getPBRBluePrintMaterialClass(): SerializableClass[] {
  return [getMeshMaterialInstanceUniformsClass(PBRBluePrintMaterial)];
}

/** @internal */
export function getSprite3DBlueprintMaterialClass(): SerializableClass[] {
  return [getMeshMaterialInstanceUniformsClass(Sprite3DBlueprintMaterial)];
}

/** @internal */
export function getUnlitMaterialClass(manager: ResourceManager): SerializableClass[] {
  return [
    {
      ctor: UnlitMaterial,
      parent: MeshMaterial,
      name: 'UnlitMaterial',
      getProps() {
        return getUnlitMaterialProps(manager);
      }
    },
    getMeshMaterialInstanceUniformsClass(UnlitMaterial)
  ];
}

/** @internal */
export function getLambertMaterialClass(manager: ResourceManager): SerializableClass[] {
  return [
    {
      ctor: LambertMaterial,
      parent: MeshMaterial,
      name: 'LambertMaterial',
      getProps() {
        return getLitMaterialProps(manager);
      }
    },
    getMeshMaterialInstanceUniformsClass(LambertMaterial)
  ];
}

/** @internal */
export function getBlinnMaterialClass(manager: ResourceManager): SerializableClass[] {
  return [
    {
      ctor: BlinnMaterial,
      parent: MeshMaterial,
      name: 'BlinnMaterial',
      getProps() {
        return [
          {
            name: 'Shininess',
            type: 'float',
            options: {
              animatable: true,
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
          ...getLitMaterialProps(manager)
        ];
      }
    },
    getMeshMaterialInstanceUniformsClass(BlinnMaterial)
  ];
}

/** @internal */
export function getPBRMetallicRoughnessMaterialClass(manager: ResourceManager): SerializableClass[] {
  return [
    {
      ctor: PBRMetallicRoughnessMaterial,
      parent: MeshMaterial,
      name: 'PBRMetallicRoughnessMaterial',
      getProps() {
        return [
          {
            name: 'Metallic',
            type: 'float',
            options: {
              animatable: true,
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
              animatable: true,
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
            options: {
              animatable: true
            },
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
          ...getTextureProps<PBRMetallicRoughnessMaterial>(
            manager,
            'metallicRoughnessTexture',
            '2D',
            false,
            0
          ),
          ...getTextureProps<PBRMetallicRoughnessMaterial>(manager, 'specularColorTexture', '2D', true, 0),
          ...getPBRCommonProps(manager)
        ];
      }
    },
    getMeshMaterialInstanceUniformsClass(PBRMetallicRoughnessMaterial)
  ];
}

/** @internal */
export function getPBRSpecularGlossinessMaterialClass(manager: ResourceManager): SerializableClass[] {
  return [
    {
      ctor: PBRSpecularGlossinessMaterial,
      name: 'PBRSpecularGlossinessMaterial',
      parent: MeshMaterial,
      getProps() {
        return [
          {
            name: 'SpecularFactor',
            type: 'rgb',
            options: {
              animatable: true
            },
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
              animatable: true,
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
          ...getPBRCommonProps(manager)
        ];
      }
    },
    getMeshMaterialInstanceUniformsClass(PBRSpecularGlossinessMaterial)
  ];
}
