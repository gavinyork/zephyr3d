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
  SpriteBlueprintMaterial,
  UnlitMaterial
} from '../../../material';
import { defineProps, type PropertyAccessor, type SerializableClass } from '../types';
import type { Nullable } from '@zephyr3d/base';
import { Vector2, Vector3, Vector4 } from '@zephyr3d/base';
import { getTextureProps } from './common';
import type { ResourceManager } from '../manager';
import { getMeshMaterialInstanceUniformsClass } from './common';
import { SpriteMaterial } from '../../../material/sprite';
import { StandardSpriteMaterial } from '../../../material/sprite_std';
import type { PBRReflectionMode } from '../../../material/mixins/lightmodel/pbrmetallicroughness';

type PBRMaterial = PBRMetallicRoughnessMaterial | PBRSpecularGlossinessMaterial;
type LitPropTypes = LambertMaterial | BlinnMaterial | PBRMaterial;
type UnlitPropTypes = UnlitMaterial | LitPropTypes;

function getPBRCommonProps(manager: ResourceManager): PropertyAccessor<PBRMaterial>[] {
  return defineProps([
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
  ]);
}

function getLitMaterialProps(manager: ResourceManager): PropertyAccessor<LitPropTypes>[] {
  return defineProps([
    ...getUnlitMaterialProps(manager),
    {
      name: 'doubleSidedLighting',
      type: 'bool',
      default: false,
      isValid(this: LitPropTypes) {
        return !this.$isInstance && this.cullMode !== 'back';
      },
      get(this: LitPropTypes, value) {
        value.bool[0] = this.doubleSidedLighting;
      },
      set(this: LitPropTypes, value) {
        this.doubleSidedLighting = value.bool[0];
      }
    },
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
  ]);
}

function getUnlitMaterialProps(manager: ResourceManager): PropertyAccessor<UnlitPropTypes>[] {
  return defineProps([
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
  ]);
}

/** @internal */
export function getMeshMaterialClass(): SerializableClass[] {
  return [
    {
      ctor: MeshMaterial,
      name: 'MeshMaterial',
      getProps() {
        return defineProps([
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
        ]);
      }
    },
    getMeshMaterialInstanceUniformsClass(MeshMaterial)
  ];
}

/** @internal */
export function getSpriteMaterialClass(_manager: ResourceManager): SerializableClass[] {
  return [
    {
      ctor: SpriteMaterial,
      name: 'SpriteMaterial',
      parent: MeshMaterial,
      getProps() {
        return [];
      }
    },
    getMeshMaterialInstanceUniformsClass(SpriteMaterial)
  ];
}

/** @internal */
export function getStandardSpriteMaterialClass(manager: ResourceManager): SerializableClass[] {
  return [
    {
      ctor: StandardSpriteMaterial,
      name: 'StandardSpriteMaterial',
      parent: SpriteMaterial,
      getProps() {
        return defineProps([
          {
            name: 'SpriteTexture',
            type: 'object',
            default: '',
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
            get(value) {
              value.str[0] = manager.getAssetId(this.spriteTexture) ?? '';
            },
            async set(value) {
              if (!value || !value.str[0]) {
                this.spriteTexture = null;
              } else {
                const assetId = value.str[0];
                let tex: Nullable<Texture2D>;
                try {
                  tex = await manager.fetchTexture<Texture2D>(assetId, {
                    linearColorSpace: false
                  });
                } catch (err) {
                  console.error(`Load asset failed: ${value.str[0]}: ${err}`);
                  tex = null;
                }
                if (tex?.isTexture2D()) {
                  this.spriteTexture = tex;
                } else {
                  console.error('Invalid texture type');
                }
              }
            },
            isValid() {
              return !this.$isInstance;
            }
          }
        ]);
      }
    },
    getMeshMaterialInstanceUniformsClass(StandardSpriteMaterial)
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
        return defineProps([
          {
            name: 'AlphaMap',
            type: 'object',
            default: '',
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
              if (!value || !value.str[0]) {
                this.alphaMap = null;
              } else {
                const assetId = value.str[0];
                let tex: Nullable<Texture2D> = null;
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
            default: '',
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
              if (!value || !value.str[0]) {
                this.rampMap = null;
              } else {
                const assetId = value.str[0];
                let tex: Nullable<Texture2D> = null;
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
        ]);
      }
    },
    getMeshMaterialInstanceUniformsClass(ParticleMaterial)
  ];
}

/** @internal */
export function getPBRBluePrintMaterialClass(): SerializableClass[] {
  return [
    {
      ctor: PBRBluePrintMaterial,
      parent: MeshMaterial,
      name: 'PBRBluePrintMaterial',
      getProps() {
        return defineProps([
          {
            name: 'doubleSidedLighting',
            type: 'bool',
            default: false,
            isValid(this: LitPropTypes) {
              return !this.$isInstance && this.cullMode !== 'back';
            },
            get(this: LitPropTypes, value) {
              value.bool[0] = this.doubleSidedLighting;
            },
            set(this: LitPropTypes, value) {
              this.doubleSidedLighting = value.bool[0];
            }
          },
          {
            name: 'Reflection',
            type: 'string',
            default: 'ggx',
            options: {
              enum: {
                labels: ['None', 'GGX', 'Anisotropic', 'Glint'],
                values: ['none', 'ggx', 'anisotropic', 'glint']
              }
            },
            get(this: PBRBluePrintMaterial, value) {
              value.str[0] = this.reflectionMode;
            },
            set(this: PBRBluePrintMaterial, value) {
              this.reflectionMode = value.str[0] as PBRReflectionMode;
            },
            getDefaultValue(this: PBRBluePrintMaterial) {
              return this.$isInstance ? this.coreMaterial.reflectionMode : 'ggx';
            }
          },
          {
            name: 'SubsurfaceScattering',
            type: 'bool',
            phase: 0,
            default: false,
            get(this: PBRBluePrintMaterial, value) {
              value.bool[0] = this.subsurfaceScattering;
            },
            set(this: PBRBluePrintMaterial, value) {
              this.subsurfaceScattering = value.bool[0];
            },
            isValid(this: PBRBluePrintMaterial) {
              return !this.$isInstance;
            }
          },
          {
            name: 'SubsurfaceColor',
            type: 'rgb',
            phase: 1,
            default: [1, 0.3, 0.2],
            options: {
              animatable: true
            },
            get(this: PBRBluePrintMaterial, value) {
              value.num[0] = this.subsurfaceColor.x;
              value.num[1] = this.subsurfaceColor.y;
              value.num[2] = this.subsurfaceColor.z;
            },
            set(this: PBRBluePrintMaterial, value) {
              this.subsurfaceColor = new Vector3(value.num[0], value.num[1], value.num[2]);
            },
            getDefaultValue(this: PBRBluePrintMaterial) {
              return this.$isInstance ? this.coreMaterial.subsurfaceColor : [1, 0.3, 0.2];
            },
            isValid(this: PBRBluePrintMaterial) {
              return this.subsurfaceScattering;
            }
          },
          {
            name: 'SubsurfaceScale',
            type: 'float',
            phase: 1,
            default: 0.5,
            options: {
              animatable: true,
              minValue: 0,
              maxValue: 8
            },
            get(this: PBRBluePrintMaterial, value) {
              value.num[0] = this.subsurfaceScale;
            },
            set(this: PBRBluePrintMaterial, value) {
              this.subsurfaceScale = value.num[0];
            },
            getDefaultValue(this: PBRBluePrintMaterial) {
              return this.$isInstance ? this.coreMaterial.subsurfaceScale : 0.5;
            },
            isValid(this: PBRBluePrintMaterial) {
              return this.subsurfaceScattering;
            }
          },
          {
            name: 'SubsurfacePower',
            type: 'float',
            phase: 1,
            default: 1.5,
            options: {
              animatable: true,
              minValue: 0,
              maxValue: 16
            },
            get(this: PBRBluePrintMaterial, value) {
              value.num[0] = this.subsurfacePower;
            },
            set(this: PBRBluePrintMaterial, value) {
              this.subsurfacePower = value.num[0];
            },
            getDefaultValue(this: PBRBluePrintMaterial) {
              return this.$isInstance ? this.coreMaterial.subsurfacePower : 1.5;
            },
            isValid(this: PBRBluePrintMaterial) {
              return this.subsurfaceScattering;
            }
          },
          {
            name: 'SubsurfaceIntensity',
            type: 'float',
            phase: 1,
            default: 0.5,
            options: {
              animatable: true,
              minValue: 0,
              maxValue: 4
            },
            get(this: PBRBluePrintMaterial, value) {
              value.num[0] = this.subsurfaceIntensity;
            },
            set(this: PBRBluePrintMaterial, value) {
              this.subsurfaceIntensity = value.num[0];
            },
            getDefaultValue(this: PBRBluePrintMaterial) {
              return this.$isInstance ? this.coreMaterial.subsurfaceIntensity : 0.5;
            },
            isValid(this: PBRBluePrintMaterial) {
              return this.subsurfaceScattering;
            }
          },
          {
            name: 'Anisotropy',
            type: 'float',
            default: 0.75,
            options: {
              animatable: true,
              minValue: -0.95,
              maxValue: 0.95
            },
            get(this: PBRBluePrintMaterial, value) {
              value.num[0] = this.anisotropy;
            },
            set(this: PBRBluePrintMaterial, value) {
              this.anisotropy = value.num[0];
            },
            getDefaultValue(this: PBRBluePrintMaterial) {
              return this.$isInstance ? this.coreMaterial.anisotropy : 0.75;
            },
            isValid(this: PBRBluePrintMaterial) {
              return this.reflectionMode === 'anisotropic';
            }
          },
          {
            name: 'AnisotropyDirection',
            type: 'float',
            default: 0,
            options: {
              animatable: true,
              minValue: 0,
              maxValue: 360
            },
            get(this: PBRBluePrintMaterial, value) {
              value.num[0] = this.anisotropyDirection;
            },
            set(this: PBRBluePrintMaterial, value) {
              this.anisotropyDirection = value.num[0];
            },
            getDefaultValue(this: PBRBluePrintMaterial) {
              return this.$isInstance ? this.coreMaterial.anisotropyDirection : 0;
            },
            isValid(this: PBRBluePrintMaterial) {
              return this.reflectionMode === 'anisotropic';
            }
          },
          {
            name: 'AnisotropyDirectionScaleBias',
            type: 'vec2',
            default: [1, 0],
            options: {
              animatable: true
            },
            get(this: PBRBluePrintMaterial, value) {
              value.num[0] = this.anisotropyDirectionScaleBias.x;
              value.num[1] = this.anisotropyDirectionScaleBias.y;
            },
            set(this: PBRBluePrintMaterial, value) {
              this.anisotropyDirectionScaleBias = new Vector2(value.num[0], value.num[1]);
            },
            getDefaultValue(this: PBRBluePrintMaterial) {
              return this.$isInstance ? this.coreMaterial.anisotropyDirectionScaleBias : [1, 0];
            },
            isValid(this: PBRBluePrintMaterial) {
              return this.reflectionMode === 'anisotropic';
            }
          }
        ]);
      }
    },
    getMeshMaterialInstanceUniformsClass(PBRBluePrintMaterial)
  ];
}

/** @internal */
export function getSpriteBlueprintMaterialClass(): SerializableClass[] {
  return [
    {
      ctor: SpriteBlueprintMaterial,
      parent: MeshMaterial,
      name: 'SpriteBlueprintMaterial',
      getProps() {
        return [];
      }
    },
    getMeshMaterialInstanceUniformsClass(SpriteBlueprintMaterial)
  ];
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
        return defineProps([
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
        ]);
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
        return defineProps([
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
          {
            name: 'Reflection',
            type: 'string',
            default: 'ggx',
            options: {
              enum: {
                labels: ['None', 'GGX', 'Anisotropic', 'Glint'],
                values: ['none', 'ggx', 'anisotropic', 'glint']
              }
            },
            get(this: PBRMetallicRoughnessMaterial, value) {
              value.str[0] = this.reflectionMode;
            },
            set(this: PBRMetallicRoughnessMaterial, value) {
              this.reflectionMode = value.str[0] as PBRReflectionMode;
            },
            getDefaultValue(this: PBRMetallicRoughnessMaterial) {
              return this.$isInstance ? this.coreMaterial.reflectionMode : 'ggx';
            }
          },
          {
            name: 'Anisotropy',
            type: 'float',
            default: 0.75,
            options: {
              animatable: true,
              minValue: -0.95,
              maxValue: 0.95
            },
            get(this: PBRMetallicRoughnessMaterial, value) {
              value.num[0] = this.anisotropy;
            },
            set(this: PBRMetallicRoughnessMaterial, value) {
              this.anisotropy = value.num[0];
            },
            getDefaultValue(this: PBRMetallicRoughnessMaterial) {
              return this.$isInstance ? this.coreMaterial.anisotropy : 0.75;
            },
            isValid(this: PBRMetallicRoughnessMaterial) {
              return this.reflectionMode === 'anisotropic';
            }
          },
          {
            name: 'AnisotropyDirection',
            type: 'float',
            default: 0,
            options: {
              animatable: true,
              minValue: 0,
              maxValue: 360
            },
            get(this: PBRMetallicRoughnessMaterial, value) {
              value.num[0] = this.anisotropyDirection;
            },
            set(this: PBRMetallicRoughnessMaterial, value) {
              this.anisotropyDirection = value.num[0];
            },
            getDefaultValue(this: PBRMetallicRoughnessMaterial) {
              return this.$isInstance ? this.coreMaterial.anisotropyDirection : 0;
            },
            isValid(this: PBRMetallicRoughnessMaterial) {
              return this.reflectionMode === 'anisotropic';
            }
          },
          ...getTextureProps<PBRMetallicRoughnessMaterial>(
            manager,
            'anisotropyDirectionTexture',
            '2D',
            false,
            0,
            function () {
              return this.reflectionMode === 'anisotropic';
            }
          ),
          {
            name: 'AnisotropyDirectionScaleBias',
            type: 'vec2',
            default: [1, 0],
            options: {
              animatable: true
            },
            get(this: PBRMetallicRoughnessMaterial, value) {
              value.num[0] = this.anisotropyDirectionScaleBias.x;
              value.num[1] = this.anisotropyDirectionScaleBias.y;
            },
            set(this: PBRMetallicRoughnessMaterial, value) {
              this.anisotropyDirectionScaleBias = new Vector2(value.num[0], value.num[1]);
            },
            getDefaultValue(this: PBRMetallicRoughnessMaterial) {
              return this.$isInstance ? this.coreMaterial.anisotropyDirectionScaleBias : [1, 0];
            },
            isValid() {
              return !this.$isInstance && this.reflectionMode === 'anisotropic' && !!this.anisotropyDirectionTexture;
            }
          },
          {
            name: 'SubsurfaceScattering',
            type: 'bool',
            phase: 0,
            default: false,
            get(this: PBRMetallicRoughnessMaterial, value) {
              value.bool[0] = this.subsurfaceScattering;
            },
            set(this: PBRMetallicRoughnessMaterial, value) {
              this.subsurfaceScattering = value.bool[0];
            },
            isValid() {
              return !this.$isInstance;
            }
          },
          {
            name: 'SubsurfaceColor',
            type: 'rgb',
            phase: 1,
            default: [1, 0.3, 0.2],
            options: {
              animatable: true
            },
            get(this: PBRMetallicRoughnessMaterial, value) {
              value.num[0] = this.subsurfaceColor.x;
              value.num[1] = this.subsurfaceColor.y;
              value.num[2] = this.subsurfaceColor.z;
            },
            set(this: PBRMetallicRoughnessMaterial, value) {
              this.subsurfaceColor = new Vector3(value.num[0], value.num[1], value.num[2]);
            },
            getDefaultValue(this: PBRMetallicRoughnessMaterial) {
              return this.$isInstance ? this.coreMaterial.subsurfaceColor : [1, 0.3, 0.2];
            },
            isValid(this: PBRMetallicRoughnessMaterial) {
              return this.subsurfaceScattering;
            }
          },
          {
            name: 'SubsurfaceScale',
            type: 'float',
            phase: 1,
            default: 0.5,
            options: {
              animatable: true,
              minValue: 0,
              maxValue: 8
            },
            get(this: PBRMetallicRoughnessMaterial, value) {
              value.num[0] = this.subsurfaceScale;
            },
            set(this: PBRMetallicRoughnessMaterial, value) {
              this.subsurfaceScale = value.num[0];
            },
            getDefaultValue(this: PBRMetallicRoughnessMaterial) {
              return this.$isInstance ? this.coreMaterial.subsurfaceScale : 0.5;
            },
            isValid(this: PBRMetallicRoughnessMaterial) {
              return this.subsurfaceScattering;
            }
          },
          {
            name: 'SubsurfacePower',
            type: 'float',
            phase: 1,
            default: 1.5,
            options: {
              animatable: true,
              minValue: 0,
              maxValue: 16
            },
            get(this: PBRMetallicRoughnessMaterial, value) {
              value.num[0] = this.subsurfacePower;
            },
            set(this: PBRMetallicRoughnessMaterial, value) {
              this.subsurfacePower = value.num[0];
            },
            getDefaultValue(this: PBRMetallicRoughnessMaterial) {
              return this.$isInstance ? this.coreMaterial.subsurfacePower : 1.5;
            },
            isValid(this: PBRMetallicRoughnessMaterial) {
              return this.subsurfaceScattering;
            }
          },
          {
            name: 'SubsurfaceIntensity',
            type: 'float',
            phase: 1,
            default: 0.5,
            options: {
              animatable: true,
              minValue: 0,
              maxValue: 4
            },
            get(this: PBRMetallicRoughnessMaterial, value) {
              value.num[0] = this.subsurfaceIntensity;
            },
            set(this: PBRMetallicRoughnessMaterial, value) {
              this.subsurfaceIntensity = value.num[0];
            },
            getDefaultValue(this: PBRMetallicRoughnessMaterial) {
              return this.$isInstance ? this.coreMaterial.subsurfaceIntensity : 0.5;
            },
            isValid(this: PBRMetallicRoughnessMaterial) {
              return this.subsurfaceScattering;
            }
          },
          ...getTextureProps<PBRMetallicRoughnessMaterial>(manager, 'subsurfaceTexture', '2D', false, 1, function () {
            return this.subsurfaceScattering;
          }),
          ...getTextureProps<PBRMetallicRoughnessMaterial>(
            manager,
            'metallicRoughnessTexture',
            '2D',
            false,
            0
          ),
          ...getTextureProps<PBRMetallicRoughnessMaterial>(manager, 'specularColorTexture', '2D', true, 0),
          ...getPBRCommonProps(manager)
        ]);
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
        return defineProps([
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
        ]);
      }
    },
    getMeshMaterialInstanceUniformsClass(PBRSpecularGlossinessMaterial)
  ];
}
