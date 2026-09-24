import type { FaceMode, Texture2D } from '@zephyr3d/device';
import type { BlendMode } from '../../../material';
import {
  BlinnMaterial,
  HairMaterial,
  HairStrandMaterial,
  LambertMaterial,
  MeshMaterial,
  MToonMaterial,
  ParticleMaterial,
  PBRBluePrintMaterial,
  PBRBluePrintMaterialInstance,
  PBRMetallicRoughnessMaterial,
  PBRSpecularGlossinessMaterial,
  EyeMaterial,
  SkinMaterial,
  SubsurfaceProfile,
  SkinProfile,
  type SkinProfilePreset,
  type MToonOutlineWidthMode,
  type SubsurfaceProfilePreset,
  SpriteBlueprintMaterial,
  UnlitMaterial,
  type HairStrandDirection,
  type HairShadingModel
} from '../../../material';
import type { PBRBlueprintOutputName } from '../../../material/pbrblueprint';
import { defineProps, type PropertyAccessor, type SerializableClass } from '../types';
import type { GenericConstructor, Nullable } from '@zephyr3d/base';
import { Vector2, Vector3, Vector4 } from '@zephyr3d/base';
import { getTextureProps } from './common';
import type { ResourceManager } from '../manager';
import { getMeshMaterialInstanceUniformsClass } from './common';
import { SpriteMaterial } from '../../../material/sprite';
import { StandardSpriteMaterial } from '../../../material/sprite_std';
import type { PBRReflectionMode } from '../../../material/mixins/lightmodel/pbrmetallicroughness';

type PBRMaterial = PBRMetallicRoughnessMaterial | PBRSpecularGlossinessMaterial;
type LitPropTypes = LambertMaterial | BlinnMaterial | SkinMaterial | HairMaterial | PBRMaterial;
type UnlitPropTypes = UnlitMaterial | LitPropTypes;

function createBlueprintOutputHiddenPredicate(_outputs: readonly PBRBlueprintOutputName[]) {
  return function (this: any) {
    return this instanceof PBRBluePrintMaterial;
  };
}

function canEditParentMaterialProperty(material: MeshMaterial) {
  return (
    !material.$isInstance &&
    !(material as MeshMaterial & { isBlueprintMaterialInstance?: boolean }).isBlueprintMaterialInstance
  );
}

function isBlueprintMaterialAssetInstanceWithInheritedParentProps(material: MeshMaterial) {
  return !!(material as MeshMaterial & { isBlueprintMaterialInstance?: boolean }).isBlueprintMaterialInstance;
}

function isBlueprintMaterialAssetInstance(material: MeshMaterial): material is MeshMaterial & {
  isBlueprintMaterialInstance: true;
  markMaterialPropertyOverridden?: (propName: string) => void;
} {
  return !!(material as MeshMaterial & { isBlueprintMaterialInstance?: boolean }).isBlueprintMaterialInstance;
}

function allowBlueprintInstanceOverride(material: MeshMaterial, propName: string, setter: () => void) {
  setter();
  if (isBlueprintMaterialAssetInstance(material)) {
    material.markMaterialPropertyOverridden?.(propName);
  }
}

type BlueprintInstanceSubsurfaceMaterial = PBRMetallicRoughnessMaterial & {
  isBlueprintMaterialInstance?: boolean;
  setBlueprintInstanceSubsurfacePreset?: (val: SubsurfaceProfilePreset) => void;
  setBlueprintInstanceSubsurfaceStrength?: (val: number) => void;
  setBlueprintInstanceSubsurfaceScale?: (val: number) => void;
  setBlueprintInstanceSubsurfaceProfileValue?: <K extends keyof SubsurfaceProfile>(
    propName: string,
    key: K,
    value: SubsurfaceProfile[K]
  ) => void;
};

function canEditBlueprintInstanceSubsurfaceProfile(material: PBRMetallicRoughnessMaterial) {
  return (
    !!material.subsurfaceProfile &&
    !!(material as BlueprintInstanceSubsurfaceMaterial).isBlueprintMaterialInstance
  );
}

function getBlueprintInstanceSubsurfaceMaterial(
  material: PBRMetallicRoughnessMaterial
): BlueprintInstanceSubsurfaceMaterial {
  return material as BlueprintInstanceSubsurfaceMaterial;
}

export function getSubsurfaceProfileClass(): SerializableClass {
  return {
    ctor: SubsurfaceProfile,
    name: 'SubsurfaceProfile',
    getProps() {
      return defineProps([
        {
          name: 'Preset',
          type: 'string',
          default: 'skin_default',
          options: {
            label: 'LookPreset',
            enum: {
              labels: [
                'Skin Thin',
                'Skin Default',
                'Skin HeavyMakeup',
                'Wax Backlit',
                'Wax Soft',
                'Jade Backlit',
                'Jade Soft'
              ],
              values: [
                'skin_thin',
                'skin_default',
                'skin_heavy_makeup',
                'wax_backlit',
                'wax_soft',
                'jade_backlit',
                'jade_soft'
              ]
            }
          },
          get(this: SubsurfaceProfile, value) {
            value.str[0] = this.preset;
          },
          set(this: SubsurfaceProfile, value) {
            this.preset = value.str[0] as SubsurfaceProfilePreset;
          }
        },
        {
          name: 'ScatterColor',
          type: 'rgb',
          default: [1, 0.45, 0.17],
          options: {
            label: 'MeanFreePathColor',
            animatable: true,
            minValue: 0,
            maxValue: 1
          },
          get(this: SubsurfaceProfile, value) {
            value.num[0] = this.meanFreePathColor.x;
            value.num[1] = this.meanFreePathColor.y;
            value.num[2] = this.meanFreePathColor.z;
          },
          set(this: SubsurfaceProfile, value) {
            this.meanFreePathColor = new Vector3(value.num[0], value.num[1], value.num[2]);
          }
        },
        {
          name: 'ScatterDistance',
          type: 'float',
          default: 0.92,
          options: {
            label: 'MeanFreePathDistance',
            animatable: true,
            minValue: 0,
            maxValue: 8
          },
          get(this: SubsurfaceProfile, value) {
            value.num[0] = this.meanFreePathDistance;
          },
          set(this: SubsurfaceProfile, value) {
            this.meanFreePathDistance = value.num[0];
          }
        },
        {
          name: 'ScatterWeight',
          type: 'float',
          default: 0.82,
          options: {
            label: 'ScatterWeight',
            animatable: true,
            minValue: 0,
            maxValue: 8
          },
          get(this: SubsurfaceProfile, value) {
            value.num[0] = this.strength;
          },
          set(this: SubsurfaceProfile, value) {
            this.strength = value.num[0];
          }
        },
        {
          name: 'ScatterScale',
          type: 'float',
          default: 0.96,
          options: {
            label: 'ScatterScale',
            animatable: true,
            minValue: 0,
            maxValue: 8
          },
          get(this: SubsurfaceProfile, value) {
            value.num[0] = this.scale;
          },
          set(this: SubsurfaceProfile, value) {
            this.scale = value.num[0];
          }
        },
        {
          name: 'WorldUnitScale',
          type: 'float',
          default: 1,
          options: {
            label: 'WorldUnitScale',
            animatable: true,
            minValue: 0.05,
            maxValue: 4
          },
          get(this: SubsurfaceProfile, value) {
            value.num[0] = this.worldUnitScale;
          },
          set(this: SubsurfaceProfile, value) {
            this.worldUnitScale = value.num[0];
          }
        },
        {
          name: 'BoundaryColorBleed',
          type: 'float',
          default: 0.22,
          options: {
            label: 'BoundaryColorBleed',
            animatable: true,
            minValue: 0,
            maxValue: 1
          },
          get(this: SubsurfaceProfile, value) {
            value.num[0] = this.boundaryColorBleed;
          },
          set(this: SubsurfaceProfile, value) {
            this.boundaryColorBleed = value.num[0];
          }
        },
        {
          name: 'TransmissionTintColor',
          type: 'rgb',
          default: [1, 0.46, 0.34],
          options: {
            label: 'TransmissionTintColor',
            animatable: true,
            minValue: 0,
            maxValue: 1
          },
          get(this: SubsurfaceProfile, value) {
            value.num[0] = this.transmissionTintColor.x;
            value.num[1] = this.transmissionTintColor.y;
            value.num[2] = this.transmissionTintColor.z;
          },
          set(this: SubsurfaceProfile, value) {
            this.transmissionTintColor = new Vector3(value.num[0], value.num[1], value.num[2]);
          }
        },
        {
          name: 'ExtinctionScale',
          type: 'float',
          default: 1.06,
          options: {
            label: 'ExtinctionScale',
            animatable: true,
            minValue: 0,
            maxValue: 4
          },
          get(this: SubsurfaceProfile, value) {
            value.num[0] = this.extinctionScale;
          },
          set(this: SubsurfaceProfile, value) {
            this.extinctionScale = value.num[0];
          }
        },
        {
          name: 'NormalScale',
          type: 'float',
          default: 1,
          options: {
            label: 'NormalScale',
            animatable: true,
            minValue: 0,
            maxValue: 2
          },
          get(this: SubsurfaceProfile, value) {
            value.num[0] = this.normalScale;
          },
          set(this: SubsurfaceProfile, value) {
            this.normalScale = value.num[0];
          }
        },
        {
          name: 'ScatteringDistribution',
          type: 'float',
          default: 0.6,
          options: {
            label: 'ScatteringDistribution',
            animatable: true,
            minValue: 0,
            maxValue: 1
          },
          get(this: SubsurfaceProfile, value) {
            value.num[0] = this.scatteringDistribution;
          },
          set(this: SubsurfaceProfile, value) {
            this.scatteringDistribution = value.num[0];
          }
        },
        {
          name: 'SpecularDetailSoftness',
          type: 'float',
          default: 0.78,
          options: {
            label: 'SpecularDetailSoftness',
            animatable: true,
            minValue: 0,
            maxValue: 1
          },
          get(this: SubsurfaceProfile, value) {
            value.num[0] = this.specularDetailSoftness;
          },
          set(this: SubsurfaceProfile, value) {
            this.specularDetailSoftness = value.num[0];
          }
        },
        {
          name: 'SpecularDetailRadius',
          type: 'float',
          default: 1.8,
          options: {
            label: 'SpecularDetailRadius',
            animatable: true,
            minValue: 0,
            maxValue: 4
          },
          get(this: SubsurfaceProfile, value) {
            value.num[0] = this.specularDetailRadius;
          },
          set(this: SubsurfaceProfile, value) {
            this.specularDetailRadius = value.num[0];
          }
        }
      ]);
    }
  };
}

/**
 * Serialization for {@link SkinProfile}, the profile asset driving
 * {@link SkinMaterial}'s subsurface scattering.
 */
export function getSkinProfileClass(): SerializableClass {
  return {
    // Not constructible from here by design; the cast is the price of declaring
    // the class at all. `createFunc` below is what actually supplies the
    // instance, so the constructor is never reached.
    ctor: SkinProfile as unknown as GenericConstructor,
    name: 'SkinProfile',
    /**
     * Hands back the owning material's profile instead of building one.
     *
     * A profile holds a row of a 256-entry GPU table that is only freed when its
     * material is disposed, so deserializing into a fresh instance - which is
     * what the default path does for an object-typed property - stranded a row
     * on every scene load and every undo. `ctx` is the owner, since the
     * property's deserializer passes the object it is filling in.
     */
    createFunc(ctx: unknown) {
      const material = ctx as SkinMaterial | null;
      return material instanceof SkinMaterial
        ? { obj: material.subsurfaceProfile }
        : { obj: null, loadProps: false };
    },
    getProps() {
      return defineProps([
        {
          name: 'Preset',
          description:
            'Starting look for the whole profile: skin tones, wax, jade or marble. Choosing a preset overwrites every other value here, so pick one first and fine-tune afterwards',
          type: 'string',
          default: 'skin',
          options: {
            label: 'LookPreset',
            enum: {
              labels: ['Skin', 'Skin Pale', 'Skin Tan', 'Skin Dark', 'Wax', 'Jade', 'Marble'],
              values: ['skin', 'skin_pale', 'skin_tan', 'skin_dark', 'wax', 'jade', 'marble']
            }
          },
          get(this: SkinProfile, value) {
            value.str[0] = this.preset;
          },
          set(this: SkinProfile, value) {
            this.preset = value.str[0] as SkinProfilePreset;
          }
        },
        {
          name: 'SurfaceAlbedo',
          description:
            "Set this close to the skin's base color. It does not recolor the surface; it fine-tunes how soft or tight the scattered glow is in each color channel",
          type: 'rgb',
          default: [0.85, 0.63, 0.55],
          options: { animatable: true, minValue: 0, maxValue: 1 },
          get(this: SkinProfile, value) {
            value.num[0] = this.surfaceAlbedo.x;
            value.num[1] = this.surfaceAlbedo.y;
            value.num[2] = this.surfaceAlbedo.z;
          },
          set(this: SkinProfile, value) {
            this.surfaceAlbedo = new Vector3(value.num[0], value.num[1], value.num[2]);
          }
        },
        {
          name: 'MeanFreePath',
          description:
            'Relative softness per color channel. The channel with the highest value bleeds furthest, which sets the color of the glow in shadow edges and around fine details; skin keeps red high, giving the warm red fringe at the light-to-shadow transition',
          type: 'rgb',
          default: [1, 0.28, 0.14],
          options: { animatable: true, minValue: 0, maxValue: 1 },
          get(this: SkinProfile, value) {
            value.num[0] = this.meanFreePath.x;
            value.num[1] = this.meanFreePath.y;
            value.num[2] = this.meanFreePath.z;
          },
          set(this: SkinProfile, value) {
            this.meanFreePath = new Vector3(value.num[0], value.num[1], value.num[2]);
          }
        },
        {
          name: 'MeanFreePathDistance',
          description:
            'Overall softness of the skin, in real-world metres (about 0.01 for human skin). Higher values blur lighting and surface detail more, giving a waxy, translucent look; lower values give a harder, more opaque, plastic-like surface',
          type: 'float',
          default: 0.012,
          options: { animatable: true, minValue: 0, maxValue: 1 },
          get(this: SkinProfile, value) {
            value.num[0] = this.meanFreePathDistance;
          },
          set(this: SkinProfile, value) {
            this.meanFreePathDistance = value.num[0];
          }
        },
        {
          name: 'WorldUnitScale',
          description:
            "Set this to the model's size relative to real life (1 for a life-size model in metres, 4 for a head modelled four times too large). If the skin looks too waxy or too hard only because of the model's scale, fix it here instead of changing the softness",
          type: 'float',
          default: 1,
          options: { animatable: true, minValue: 0.01, maxValue: 100 },
          get(this: SkinProfile, value) {
            value.num[0] = this.worldUnitScale;
          },
          set(this: SkinProfile, value) {
            this.worldUnitScale = value.num[0];
          }
        },
        {
          name: 'ScatterScale',
          description:
            'Quick overall softness knob on top of MeanFreePathDistance, affecting both the soft skin look and the glow through thin parts. Raise it for softer, more translucent skin; 0 removes the soft scattering look entirely',
          type: 'float',
          default: 1,
          options: { animatable: true, minValue: 0, maxValue: 8 },
          get(this: SkinProfile, value) {
            value.num[0] = this.scatterScale;
          },
          set(this: SkinProfile, value) {
            this.scatterScale = value.num[0];
          }
        },
        {
          name: 'BoundaryColorBleed',
          description:
            'Color used where this skin meets a different profile, e.g. face and lips. Values near white let the softness blend smoothly across the boundary; darker or more saturated values tint the transition and make the seam more visible',
          type: 'rgb',
          default: [0.78, 0.44, 0.36],
          options: { animatable: true, minValue: 0, maxValue: 1 },
          get(this: SkinProfile, value) {
            value.num[0] = this.boundaryColorBleed.x;
            value.num[1] = this.boundaryColorBleed.y;
            value.num[2] = this.boundaryColorBleed.z;
          },
          set(this: SkinProfile, value) {
            this.boundaryColorBleed = new Vector3(value.num[0], value.num[1], value.num[2]);
          }
        },
        {
          name: 'TransmissionTint',
          description:
            'Color of the glow seen when light shines through thin parts such as ears, nostrils and fingers from behind. Warm reds and oranges for skin',
          type: 'rgb',
          default: [1, 0.42, 0.3],
          options: { animatable: true, minValue: 0, maxValue: 1 },
          get(this: SkinProfile, value) {
            value.num[0] = this.transmissionTint.x;
            value.num[1] = this.transmissionTint.y;
            value.num[2] = this.transmissionTint.z;
          },
          set(this: SkinProfile, value) {
            this.transmissionTint = new Vector3(value.num[0], value.num[1], value.num[2]);
          }
        },
        {
          name: 'ExtinctionScale',
          description:
            'How opaque the material is to back-lighting. Higher values make only the thinnest edges glow; lower values let the glow reach thicker areas, making the object look more translucent overall',
          type: 'float',
          default: 1,
          options: { animatable: true, minValue: 0, maxValue: 8 },
          get(this: SkinProfile, value) {
            value.num[0] = this.extinctionScale;
          },
          set(this: SkinProfile, value) {
            this.extinctionScale = value.num[0];
          }
        },
        {
          name: 'NormalScale',
          description:
            'Stability of the back-lit glow. Too low makes the glow through thin parts disappear or look blotchy; higher values give a cleaner, smoother glow but wash out small thin details. Does not affect front-lit skin',
          type: 'float',
          default: 0.08,
          options: { animatable: true, minValue: 0, maxValue: 1 },
          get(this: SkinProfile, value) {
            value.num[0] = this.normalScale;
          },
          set(this: SkinProfile, value) {
            this.normalScale = value.num[0];
          }
        },
        {
          name: 'ScatteringDistribution',
          description:
            'How directional the back-lit glow is. Values near 1 make thin parts glow strongly only when looking almost straight towards the light; lower values spread the glow over a wider range of viewing angles',
          type: 'float',
          default: 0.93,
          options: { animatable: true, minValue: -1, maxValue: 1 },
          get(this: SkinProfile, value) {
            value.num[0] = this.scatteringDistribution;
          },
          set(this: SkinProfile, value) {
            this.scatteringDistribution = value.num[0];
          }
        },
        {
          name: 'IOR',
          description:
            'Changes how the back-lit glow depends on the viewing angle. Higher values make the glow follow the surface shape and the light more than the camera direction. Does not affect front-lit highlights',
          type: 'float',
          default: 1.55,
          options: { animatable: true, minValue: 1, maxValue: 3 },
          get(this: SkinProfile, value) {
            value.num[0] = this.ior;
          },
          set(this: SkinProfile, value) {
            this.ior = value.num[0];
          }
        },
        {
          name: 'Roughness0',
          description:
            'Sharpness of the tight highlight layer, as a fraction of the material roughness. Lower values give a small, crisp, oily-looking highlight',
          type: 'float',
          default: 0.5,
          options: { animatable: true, minValue: 0.01, maxValue: 1 },
          get(this: SkinProfile, value) {
            value.num[0] = this.roughness0;
          },
          set(this: SkinProfile, value) {
            this.roughness0 = value.num[0];
          }
        },
        {
          name: 'Roughness1',
          description:
            'Sharpness of the broad highlight layer, as a fraction of the material roughness. Lower values make the soft sheen smaller and brighter',
          type: 'float',
          default: 1,
          options: { animatable: true, minValue: 0.01, maxValue: 1 },
          get(this: SkinProfile, value) {
            value.num[0] = this.roughness1;
          },
          set(this: SkinProfile, value) {
            this.roughness1 = value.num[0];
          }
        },
        {
          name: 'LobeMix',
          description:
            'Balance between the two highlight layers. 0 shows only the tight, crisp highlight; higher values add more of the broad, soft sheen for a more matte look',
          type: 'float',
          default: 0.15,
          options: { animatable: true, minValue: 0, maxValue: 1 },
          get(this: SkinProfile, value) {
            value.num[0] = this.lobeMix;
          },
          set(this: SkinProfile, value) {
            this.lobeMix = value.num[0];
          }
        }
      ]);
    }
  };
}

function getPBRCommonProps(manager: ResourceManager): PropertyAccessor<PBRMaterial>[] {
  const supportsSSSThicknessAuthoring = function (this: PBRMaterial) {
    return (
      (!this.$isInstance || isBlueprintMaterialAssetInstance(this as unknown as MeshMaterial)) &&
      !!(this.transmission || (this as PBRMaterial & { subsurfaceProfile?: unknown }).subsurfaceProfile)
    );
  };
  return defineProps([
    {
      name: 'IOR',
      description: 'Index of refraction for the material surface',
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
      description: 'Strength multiplier for the occlusion texture effect',
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
      isHidden: createBlueprintOutputHiddenPredicate(['AO']),
      isValid(this: PBRMaterial) {
        return !this.$isInstance && !!this.occlusionTexture;
      }
    },
    ...getTextureProps<PBRMaterial>(manager, 'occlusionTexture', '2D', false, 0, undefined, ['AO']),
    {
      name: 'EmissiveColor',
      description: 'Base self-illumination color emitted by the material',
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
      isHidden: createBlueprintOutputHiddenPredicate(['Emissive']),
      getDefaultValue(this: PBRMaterial) {
        return this.$isInstance ? this.coreMaterial.emissiveColor : [0, 0, 0];
      }
    },
    {
      name: 'EmissiveStrength',
      description:
        'Display-referred intensity multiplier for the emissive color and texture, used by legacy ' +
        'lighting. Physical lighting uses EmissiveLuminance instead.',
      type: 'float',
      options: {
        animatable: true,
        minValue: 0
      },
      get(this: PBRMaterial, value) {
        value.num[0] = this.emissiveStrength;
      },
      set(this: PBRMaterial, value) {
        this.emissiveStrength = value.num[0];
      },
      isHidden: createBlueprintOutputHiddenPredicate(['Emissive']),
      getDefaultValue(this: PBRMaterial) {
        return this.$isInstance ? this.coreMaterial.emissiveStrength : 1;
      }
    },
    {
      name: 'EmissiveLuminance',
      description:
        'Emissive multiplier used by physical lighting. With EmissiveExposureWeight at 1 it is a ' +
        'luminance in cd/m²: a display is 200-1000, a neon sign 5,000-20,000, a sunlit white ' +
        'surface ~25,000. With the weight at 0, as on imported glTF/FBX materials, the exposure ' +
        'cancels out and it is a display-referred multiplier where the useful range is about [0, 1].',
      type: 'float',
      options: {
        animatable: true,
        minValue: 0
      },
      get(this: PBRMaterial, value) {
        value.num[0] = this.emissiveLuminance;
      },
      set(this: PBRMaterial, value) {
        this.emissiveLuminance = value.num[0];
      },
      isHidden: createBlueprintOutputHiddenPredicate(['Emissive']),
      getDefaultValue(this: PBRMaterial) {
        return this.$isInstance ? this.coreMaterial.emissiveLuminance : 1000;
      }
    },
    {
      name: 'EmissiveExposureWeight',
      description:
        'How strongly the emissive term follows camera exposure, and therefore what unit ' +
        'EmissiveLuminance carries. 1 reads it as a cd/m² luminance that dims as the camera stops ' +
        'down; 0 cancels the exposure out, making it a display-referred multiplier that ignores ' +
        'aperture, shutter and ISO. Imported glTF/FBX materials are set to 0.',
      type: 'float',
      options: {
        animatable: true,
        minValue: 0,
        maxValue: 1
      },
      get(this: PBRMaterial, value) {
        value.num[0] = this.emissiveExposureWeight;
      },
      set(this: PBRMaterial, value) {
        this.emissiveExposureWeight = value.num[0];
      },
      // Materials are not scene-bound, so this cannot be gated on lightingMode. It is inert in
      // legacy anyway (pre-exposure is 1 there), so it stays visible like the other emissive props.
      isHidden: createBlueprintOutputHiddenPredicate(['Emissive']),
      getDefaultValue(this: PBRMaterial) {
        return this.$isInstance ? this.coreMaterial.emissiveExposureWeight : 1;
      }
    },
    {
      name: 'RectSpecularScale',
      description:
        'Brightness of the highlights produced by rectangular area lights on this material; 1 is neutral, lower values dim the reflections of the light panels, higher values make them brighter',
      type: 'float',
      options: {
        label: 'RectSpecularScale',
        animatable: true,
        minValue: 0,
        maxValue: 4
      },
      get(this: PBRMaterial, value) {
        value.num[0] = this.rectSpecularScale;
      },
      set(this: PBRMaterial, value) {
        this.rectSpecularScale = value.num[0];
      },
      getDefaultValue(this: PBRMaterial) {
        if (this instanceof PBRBluePrintMaterialInstance) {
          return this.parentMaterial?.rectSpecularScale ?? 1;
        }
        return this.$isInstance ? this.coreMaterial.rectSpecularScale : 1;
      }
    },
    ...getTextureProps<PBRMaterial>(manager, 'emissiveTexture', '2D', true, 0, undefined, ['Emissive']),
    ...getTextureProps<PBRMaterial>(manager, 'specularTexture', '2D', false, 0, undefined, [
      'SpecularWeight'
    ]),
    {
      name: 'Transmission',
      description: 'If true, enables light transmission through the material',
      type: 'bool',
      phase: 0,
      default: false,
      get(this: PBRMaterial, value) {
        value.bool[0] = this.transmission;
      },
      set(this: PBRMaterial, value) {
        allowBlueprintInstanceOverride(this as unknown as MeshMaterial, 'Transmission', () => {
          this.transmission = value.bool[0];
        });
      },
      isValid() {
        return !this.$isInstance || isBlueprintMaterialAssetInstance(this as unknown as MeshMaterial);
      }
    },
    {
      name: 'TransmissionFactor',
      description: 'Amount of transmitted light, from fully opaque to fully transparent',
      type: 'float',
      phase: 1,
      default: 0.2,
      options: {
        animatable: true,
        minValue: 0,
        maxValue: 1
      },
      get(this: PBRMaterial, value) {
        value.num[0] = this.transmissionFactor;
      },
      set(this: PBRMaterial, value) {
        allowBlueprintInstanceOverride(this as unknown as MeshMaterial, 'TransmissionFactor', () => {
          this.transmissionFactor = value.num[0];
        });
      },
      getDefaultValue(this: PBRMaterial) {
        return this.$isInstance ? this.coreMaterial.transmissionFactor : 0.2;
      },
      isValid() {
        return supportsSSSThicknessAuthoring.call(this);
      }
    },
    ...getTextureProps<PBRMaterial>(manager, 'transmissionTexture', '2D', false, 1, function () {
      return this.transmission || !!(this as PBRMaterial & { subsurfaceProfile?: unknown }).subsurfaceProfile;
    }),
    {
      name: 'ThicknessFactor',
      description: 'Physical thickness used by transmission and volume attenuation',
      type: 'float',
      phase: 1,
      default: 0.35,
      options: {
        animatable: true,
        minValue: 0,
        maxValue: 99999
      },
      get(this: PBRMaterial, value) {
        value.num[0] = this.thicknessFactor;
      },
      set(this: PBRMaterial, value) {
        allowBlueprintInstanceOverride(this as unknown as MeshMaterial, 'ThicknessFactor', () => {
          this.thicknessFactor = value.num[0];
        });
      },
      getDefaultValue(this: PBRMaterial) {
        return this.$isInstance ? this.coreMaterial.thicknessFactor : 0.35;
      },
      isValid() {
        return supportsSSSThicknessAuthoring.call(this);
      }
    },
    ...getTextureProps<PBRMaterial>(manager, 'thicknessTexture', '2D', false, 1, function () {
      return this.transmission || !!(this as PBRMaterial & { subsurfaceProfile?: unknown }).subsurfaceProfile;
    }),
    {
      name: 'AttenuationColor',
      description: 'Color tint applied to transmitted light as it travels through the material',
      type: 'rgb',
      phase: 1,
      default: [1, 0.5, 0.4],
      options: {
        animatable: true
      },
      get(this: PBRMaterial, value) {
        value.num[0] = this.attenuationColor.x;
        value.num[1] = this.attenuationColor.y;
        value.num[2] = this.attenuationColor.z;
      },
      set(this: PBRMaterial, value) {
        allowBlueprintInstanceOverride(this as unknown as MeshMaterial, 'AttenuationColor', () => {
          this.attenuationColor = new Vector3(value.num[0], value.num[1], value.num[2]);
        });
      },
      getDefaultValue(this: PBRMaterial) {
        return this.$isInstance ? this.coreMaterial.attenuationColor : [1, 0.5, 0.4];
      },
      isValid() {
        return supportsSSSThicknessAuthoring.call(this);
      }
    },
    {
      name: 'AttenuationDistance',
      description: 'Distance over which transmitted light is attenuated inside the material',
      type: 'float',
      phase: 1,
      default: 0.6,
      options: {
        animatable: true,
        minValue: 0,
        maxValue: 99999
      },
      get(this: PBRMaterial, value) {
        value.num[0] = this.attenuationDistance;
      },
      set(this: PBRMaterial, value) {
        allowBlueprintInstanceOverride(this as unknown as MeshMaterial, 'AttenuationDistance', () => {
          this.attenuationDistance = value.num[0];
        });
      },
      getDefaultValue(this: PBRMaterial) {
        return this.$isInstance ? this.coreMaterial.attenuationDistance : 0.6;
      },
      isValid() {
        return supportsSSSThicknessAuthoring.call(this);
      }
    },
    {
      name: 'Iridescence',
      description: 'If true, enables thin-film iridescence on the material surface',
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
      description: 'Strength of the iridescence effect',
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
      description: 'Index of refraction used for the iridescence layer',
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
      description: 'Minimum thin-film thickness used for iridescence, typically in nanometers',
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
      description: 'Maximum thin-film thickness used for iridescence, typically in nanometers',
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
      description: 'If true, enables a clear coat layer on top of the material',
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
        return (
          !this.$isInstance &&
          !isBlueprintMaterialAssetInstanceWithInheritedParentProps(this as unknown as MeshMaterial)
        );
      }
    },
    {
      name: 'ClearCoatIntensity',
      description: 'Strength of the clear coat layer',
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
        return (
          !this.$isInstance &&
          !isBlueprintMaterialAssetInstanceWithInheritedParentProps(this as unknown as MeshMaterial) &&
          !!this.clearcoat
        );
      }
    },
    ...getTextureProps<PBRMaterial>(manager, 'clearcoatIntensityTexture', '2D', false, 1, function () {
      return (
        !isBlueprintMaterialAssetInstanceWithInheritedParentProps(this as unknown as MeshMaterial) &&
        this.clearcoat
      );
    }),
    {
      name: 'ClearCoatRoughnessFactor',
      description: 'Roughness of the clear coat layer',
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
        return (
          !this.$isInstance &&
          !isBlueprintMaterialAssetInstanceWithInheritedParentProps(this as unknown as MeshMaterial) &&
          !!this.clearcoat
        );
      }
    },
    ...getTextureProps<PBRMaterial>(manager, 'clearcoatRoughnessTexture', '2D', false, 1, function () {
      return (
        !isBlueprintMaterialAssetInstanceWithInheritedParentProps(this as unknown as MeshMaterial) &&
        this.clearcoat
      );
    }),
    ...getTextureProps<PBRMaterial>(manager, 'clearcoatNormalTexture', '2D', false, 1, function () {
      return (
        !isBlueprintMaterialAssetInstanceWithInheritedParentProps(this as unknown as MeshMaterial) &&
        this.clearcoat
      );
    }),
    {
      name: 'Sheen',
      description: 'If true, enables a soft fabric-like sheen layer',
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
      description: 'Color of the sheen layer',
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
      description: 'Roughness of the sheen layer',
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
      name: 'NormalScale',
      description: 'Strength multiplier for normal map X and Y components',
      type: 'float',
      default: 1,
      options: {
        animatable: true,
        minValue: 0,
        maxValue: 3
      },
      get(this: LitPropTypes, value) {
        value.num[0] = this.normalScale;
      },
      set(this: LitPropTypes, value) {
        allowBlueprintInstanceOverride(this as unknown as MeshMaterial, 'NormalScale', () => {
          this.normalScale = value.num[0];
        });
      },
      isHidden: createBlueprintOutputHiddenPredicate(['Normal']),
      getDefaultValue(this: LitPropTypes) {
        if (this instanceof PBRBluePrintMaterialInstance) {
          return this.parentMaterial?.normalScale ?? 1;
        }
        return this.$isInstance ? this.coreMaterial.normalScale : 1;
      },
      isValid() {
        return !this.$isInstance || isBlueprintMaterialAssetInstance(this as unknown as MeshMaterial);
      }
    },
    {
      name: 'NormalFlipY',
      description: 'If true, flips the green (Y) component sampled from the normal map',
      type: 'bool',
      default: false,
      get(this: LitPropTypes, value) {
        value.bool[0] = this.normalFlipY;
      },
      set(this: LitPropTypes, value) {
        allowBlueprintInstanceOverride(this as unknown as MeshMaterial, 'NormalFlipY', () => {
          this.normalFlipY = value.bool[0];
        });
      },
      isHidden: createBlueprintOutputHiddenPredicate(['Normal']),
      getDefaultValue(this: LitPropTypes) {
        if (this instanceof PBRBluePrintMaterialInstance) {
          return this.parentMaterial?.normalFlipY ?? false;
        }
        return this.$isInstance ? this.coreMaterial.normalFlipY : false;
      },
      isValid() {
        return !this.$isInstance || isBlueprintMaterialAssetInstance(this as unknown as MeshMaterial);
      }
    },
    {
      name: 'doubleSidedLighting',
      description: 'If true, lighting is evaluated on both sides of the surface',
      type: 'bool',
      default: true,
      isValid(this: LitPropTypes) {
        return !this.$isInstance;
      },
      get(this: LitPropTypes, value) {
        value.bool[0] = this.doubleSidedLighting;
      },
      set(this: LitPropTypes, value) {
        allowBlueprintInstanceOverride(this as unknown as MeshMaterial, 'doubleSidedLighting', () => {
          this.doubleSidedLighting = value.bool[0];
        });
      },
      getDefaultValue(this: LitPropTypes) {
        if (this instanceof PBRBluePrintMaterialInstance) {
          return this.parentMaterial?.doubleSidedLighting ?? true;
        }
        // Must match what the constructor actually sets - mixinLight enables
        // FEATURE_DOUBLE_SIDED_LIGHTING - because this value is used both to
        // decide whether to omit the property when saving and to fill it in
        // when it is absent on load. Returning false here made every asset
        // written before this accessor existed (all of which omitted the key,
        // since true was then the assumed default) load as single-sided.
        return this.$isInstance ? this.coreMaterial.doubleSidedLighting : true;
      }
    },
    {
      name: 'vertexNormal',
      description: 'If true, uses vertex normals for lighting and normal mapping',
      type: 'bool',
      default: true,
      get(this: LitPropTypes, value) {
        value.bool[0] = this.vertexNormal;
      },
      set(this: LitPropTypes, value) {
        this.vertexNormal = value.bool[0];
      },
      isHidden: createBlueprintOutputHiddenPredicate(['Normal']),
      isValid(this: LitPropTypes) {
        return !this.$isInstance;
      }
    },
    {
      name: 'vertexTangent',
      description: 'If true, uses vertex tangents for tangent-space normal mapping',
      type: 'bool',
      default: false,
      get(this: LitPropTypes, value) {
        value.bool[0] = this.vertexTangent;
      },
      set(this: LitPropTypes, value) {
        this.vertexTangent = value.bool[0];
      },
      isHidden: createBlueprintOutputHiddenPredicate(['Tangent']),
      isValid(this: LitPropTypes) {
        return !this.$isInstance && !!this.vertexNormal;
      }
    },
    ...getTextureProps<LitPropTypes>(manager, 'normalTexture', '2D', false, 0, undefined, ['Normal'])
  ]);
}

function getUnlitMaterialProps(manager: ResourceManager): PropertyAccessor<UnlitPropTypes>[] {
  return defineProps([
    {
      name: 'vertexColor',
      description: 'If true, multiplies the material color by per-vertex color data',
      type: 'bool',
      default: false,
      get(this: UnlitPropTypes, value) {
        value.bool[0] = this.vertexColor;
      },
      set(this: UnlitPropTypes, value) {
        this.vertexColor = value.bool[0];
      },
      isHidden: createBlueprintOutputHiddenPredicate(['BaseColor']),
      isValid(this: UnlitPropTypes) {
        return !this.$isInstance;
      }
    },
    {
      name: 'AlbedoColor',
      description: 'Base RGBA color of the material before lighting',
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
      isHidden: createBlueprintOutputHiddenPredicate(['BaseColor', 'Opacity']),
      getDefaultValue(this: UnlitPropTypes) {
        return this.$isInstance ? this.coreMaterial.albedoColor : [1, 1, 1, 1];
      }
    },
    ...getTextureProps<UnlitPropTypes>(manager, 'albedoTexture', '2D', true, 0, undefined, [
      'BaseColor',
      'Opacity'
    ])
  ]);
}

function getMToonMaterialProps(manager: ResourceManager): PropertyAccessor<MToonMaterial>[] {
  return defineProps([
    {
      name: 'AlbedoColor',
      description: 'Base RGBA color of the MToon material',
      type: 'rgba',
      options: {
        animatable: true
      },
      get(this: MToonMaterial, value) {
        const color = this.albedoColor;
        value.num[0] = color.x;
        value.num[1] = color.y;
        value.num[2] = color.z;
        value.num[3] = color.w;
      },
      set(this: MToonMaterial, value) {
        this.albedoColor = new Vector4(value.num[0], value.num[1], value.num[2], value.num[3]);
      },
      getDefaultValue(this: MToonMaterial) {
        return this.$isInstance ? this.coreMaterial.albedoColor : [1, 1, 1, 1];
      }
    },
    ...getTextureProps<MToonMaterial>(manager, 'albedoTexture', '2D', true, 0),
    {
      name: 'NormalScale',
      description: 'Scalar applied to the MToon normal texture',
      type: 'float',
      phase: 1,
      default: 1,
      options: {
        animatable: true,
        minValue: 0,
        maxValue: 2
      },
      get(this: MToonMaterial, value) {
        value.num[0] = this.normalScale;
      },
      set(this: MToonMaterial, value) {
        this.normalScale = value.num[0];
      },
      isValid(this: MToonMaterial) {
        return !this.$isInstance && !!this.normalTexture;
      }
    },
    ...getTextureProps<MToonMaterial>(manager, 'normalTexture', '2D', false, 0),
    {
      name: 'DoubleSidedLighting',
      description: 'If true, MToon lighting is evaluated on both sides of the surface',
      type: 'bool',
      default: true,
      get(this: MToonMaterial, value) {
        value.bool[0] = this.doubleSidedLighting;
      },
      set(this: MToonMaterial, value) {
        this.doubleSidedLighting = value.bool[0];
      }
    },
    {
      name: 'EmissiveColor',
      description: 'Base self-illumination color emitted by the MToon material',
      type: 'rgb',
      options: {
        animatable: true
      },
      get(this: MToonMaterial, value) {
        value.num[0] = this.emissiveColor.x;
        value.num[1] = this.emissiveColor.y;
        value.num[2] = this.emissiveColor.z;
      },
      set(this: MToonMaterial, value) {
        this.emissiveColor = new Vector3(value.num[0], value.num[1], value.num[2]);
      },
      getDefaultValue(this: MToonMaterial) {
        return this.$isInstance ? this.coreMaterial.emissiveColor : [0, 0, 0];
      }
    },
    {
      name: 'EmissiveStrength',
      description: 'Intensity multiplier for the MToon emissive color and texture',
      type: 'float',
      default: 1,
      options: {
        animatable: true,
        minValue: 0
      },
      get(this: MToonMaterial, value) {
        value.num[0] = this.emissiveStrength;
      },
      set(this: MToonMaterial, value) {
        this.emissiveStrength = value.num[0];
      },
      getDefaultValue(this: MToonMaterial) {
        return this.$isInstance ? this.coreMaterial.emissiveStrength : 1;
      }
    },
    ...getTextureProps<MToonMaterial>(manager, 'emissiveTexture', '2D', true, 0),
    {
      name: 'ShadeColorFactor',
      description: 'MToon shadow-side color factor',
      type: 'rgb',
      default: [0, 0, 0],
      options: {
        animatable: true,
        minValue: 0,
        maxValue: 1
      },
      get(this: MToonMaterial, value) {
        value.num[0] = this.shadeColorFactor.x;
        value.num[1] = this.shadeColorFactor.y;
        value.num[2] = this.shadeColorFactor.z;
      },
      set(this: MToonMaterial, value) {
        this.shadeColorFactor = new Vector3(value.num[0], value.num[1], value.num[2]);
      },
      getDefaultValue(this: MToonMaterial) {
        return this.$isInstance ? this.coreMaterial.shadeColorFactor : [0, 0, 0];
      }
    },
    ...getTextureProps<MToonMaterial>(manager, 'shadeMultiplyTexture', '2D', true, 0),
    {
      name: 'ShadingShiftFactor',
      description: 'MToon terminator shift factor',
      type: 'float',
      default: 0,
      options: {
        animatable: true,
        minValue: -1,
        maxValue: 1
      },
      get(this: MToonMaterial, value) {
        value.num[0] = this.shadingShiftFactor;
      },
      set(this: MToonMaterial, value) {
        this.shadingShiftFactor = value.num[0];
      },
      getDefaultValue(this: MToonMaterial) {
        return this.$isInstance ? this.coreMaterial.shadingShiftFactor : 0;
      }
    },
    {
      name: 'ShadingShiftTextureScale',
      description: 'Scale applied to the MToon shading shift texture',
      type: 'float',
      phase: 1,
      default: 1,
      options: {
        animatable: true
      },
      get(this: MToonMaterial, value) {
        value.num[0] = this.shadingShiftTextureScale;
      },
      set(this: MToonMaterial, value) {
        this.shadingShiftTextureScale = value.num[0];
      },
      isValid(this: MToonMaterial) {
        return !this.$isInstance && !!this.shadingShiftTexture;
      }
    },
    ...getTextureProps<MToonMaterial>(manager, 'shadingShiftTexture', '2D', false, 0),
    {
      name: 'ShadingToonyFactor',
      description: 'MToon shadow edge sharpness factor',
      type: 'float',
      default: 0.9,
      options: {
        animatable: true,
        minValue: 0,
        maxValue: 0.99
      },
      get(this: MToonMaterial, value) {
        value.num[0] = this.shadingToonyFactor;
      },
      set(this: MToonMaterial, value) {
        this.shadingToonyFactor = value.num[0];
      },
      getDefaultValue(this: MToonMaterial) {
        return this.$isInstance ? this.coreMaterial.shadingToonyFactor : 0.9;
      }
    },
    {
      name: 'GIEqualizationFactor',
      description: 'MToon indirect lighting equalization factor',
      type: 'float',
      default: 0.9,
      options: {
        animatable: true,
        minValue: 0,
        maxValue: 1
      },
      get(this: MToonMaterial, value) {
        value.num[0] = this.giEqualizationFactor;
      },
      set(this: MToonMaterial, value) {
        this.giEqualizationFactor = value.num[0];
      },
      getDefaultValue(this: MToonMaterial) {
        return this.$isInstance ? this.coreMaterial.giEqualizationFactor : 0.9;
      }
    },
    {
      name: 'MatcapFactor',
      description: 'MToon matcap color factor',
      type: 'rgb',
      default: [1, 1, 1],
      options: {
        animatable: true,
        minValue: 0,
        maxValue: 1
      },
      get(this: MToonMaterial, value) {
        value.num[0] = this.matcapFactor.x;
        value.num[1] = this.matcapFactor.y;
        value.num[2] = this.matcapFactor.z;
      },
      set(this: MToonMaterial, value) {
        this.matcapFactor = new Vector3(value.num[0], value.num[1], value.num[2]);
      },
      getDefaultValue(this: MToonMaterial) {
        return this.$isInstance ? this.coreMaterial.matcapFactor : [1, 1, 1];
      }
    },
    ...getTextureProps<MToonMaterial>(manager, 'matcapTexture', '2D', true, 0),
    {
      name: 'ParametricRimColorFactor',
      description: 'MToon parametric rim color factor',
      type: 'rgb',
      default: [0, 0, 0],
      options: {
        animatable: true,
        minValue: 0,
        maxValue: 1
      },
      get(this: MToonMaterial, value) {
        value.num[0] = this.parametricRimColorFactor.x;
        value.num[1] = this.parametricRimColorFactor.y;
        value.num[2] = this.parametricRimColorFactor.z;
      },
      set(this: MToonMaterial, value) {
        this.parametricRimColorFactor = new Vector3(value.num[0], value.num[1], value.num[2]);
      },
      getDefaultValue(this: MToonMaterial) {
        return this.$isInstance ? this.coreMaterial.parametricRimColorFactor : [0, 0, 0];
      }
    },
    {
      name: 'ParametricRimFresnelPowerFactor',
      description: 'MToon parametric rim Fresnel power factor',
      type: 'float',
      default: 5,
      options: {
        animatable: true,
        minValue: 0
      },
      get(this: MToonMaterial, value) {
        value.num[0] = this.parametricRimFresnelPowerFactor;
      },
      set(this: MToonMaterial, value) {
        this.parametricRimFresnelPowerFactor = value.num[0];
      },
      getDefaultValue(this: MToonMaterial) {
        return this.$isInstance ? this.coreMaterial.parametricRimFresnelPowerFactor : 5;
      }
    },
    {
      name: 'ParametricRimLiftFactor',
      description: 'MToon parametric rim lift factor',
      type: 'float',
      default: 0,
      options: {
        animatable: true,
        minValue: 0,
        maxValue: 1
      },
      get(this: MToonMaterial, value) {
        value.num[0] = this.parametricRimLiftFactor;
      },
      set(this: MToonMaterial, value) {
        this.parametricRimLiftFactor = value.num[0];
      },
      getDefaultValue(this: MToonMaterial) {
        return this.$isInstance ? this.coreMaterial.parametricRimLiftFactor : 0;
      }
    },
    {
      name: 'RimLightingMixFactor',
      description: 'MToon rim lighting mix factor',
      type: 'float',
      default: 1,
      options: {
        animatable: true,
        minValue: 0,
        maxValue: 1
      },
      get(this: MToonMaterial, value) {
        value.num[0] = this.rimLightingMixFactor;
      },
      set(this: MToonMaterial, value) {
        this.rimLightingMixFactor = value.num[0];
      },
      getDefaultValue(this: MToonMaterial) {
        return this.$isInstance ? this.coreMaterial.rimLightingMixFactor : 1;
      }
    },
    ...getTextureProps<MToonMaterial>(manager, 'rimMultiplyTexture', '2D', true, 0),
    {
      name: 'OutlineWidthMode',
      description: 'MToon outline width mode',
      type: 'string',
      default: 'none',
      options: {
        enum: {
          labels: ['None', 'World Coordinates', 'Screen Coordinates'],
          values: ['none', 'worldCoordinates', 'screenCoordinates']
        }
      },
      get(this: MToonMaterial, value) {
        value.str[0] = this.outlineWidthMode;
      },
      set(this: MToonMaterial, value) {
        this.outlineWidthMode = value.str[0] as MToonOutlineWidthMode;
      },
      isValid(this: MToonMaterial) {
        return !this.$isInstance;
      }
    },
    {
      name: 'OutlineWidthFactor',
      description: 'MToon outline width factor',
      type: 'float',
      default: 0,
      options: {
        animatable: true,
        minValue: 0
      },
      get(this: MToonMaterial, value) {
        value.num[0] = this.outlineWidthFactor;
      },
      set(this: MToonMaterial, value) {
        this.outlineWidthFactor = value.num[0];
      },
      isValid(this: MToonMaterial) {
        return !this.$isInstance && this.outlineWidthMode !== 'none';
      }
    },
    ...getTextureProps<MToonMaterial>(manager, 'outlineWidthMultiplyTexture', '2D', false, 1, function () {
      return this.outlineWidthMode !== 'none';
    }),
    {
      name: 'OutlineColorFactor',
      description: 'MToon outline color factor',
      type: 'rgb',
      default: [0, 0, 0],
      options: {
        animatable: true,
        minValue: 0,
        maxValue: 1
      },
      get(this: MToonMaterial, value) {
        value.num[0] = this.outlineColorFactor.x;
        value.num[1] = this.outlineColorFactor.y;
        value.num[2] = this.outlineColorFactor.z;
      },
      set(this: MToonMaterial, value) {
        this.outlineColorFactor = new Vector3(value.num[0], value.num[1], value.num[2]);
      },
      isValid(this: MToonMaterial) {
        return !this.$isInstance && this.outlineWidthMode !== 'none';
      }
    },
    {
      name: 'OutlineLightingMixFactor',
      description: 'MToon outline lighting mix factor',
      type: 'float',
      default: 1,
      options: {
        animatable: true,
        minValue: 0,
        maxValue: 1
      },
      get(this: MToonMaterial, value) {
        value.num[0] = this.outlineLightingMixFactor;
      },
      set(this: MToonMaterial, value) {
        this.outlineLightingMixFactor = value.num[0];
      },
      isValid(this: MToonMaterial) {
        return !this.$isInstance && this.outlineWidthMode !== 'none';
      }
    },
    {
      name: 'OutlineUsesTangentNormals',
      description: 'Use the tangent attribute xyz as smooth normals for MToon outline expansion',
      type: 'boolean',
      default: false,
      get(this: MToonMaterial, value) {
        value.bool[0] = this.outlineUsesTangentNormals;
      },
      set(this: MToonMaterial, value) {
        this.outlineUsesTangentNormals = value.bool[0];
      },
      isValid(this: MToonMaterial) {
        return !this.$isInstance && this.outlineWidthMode !== 'none';
      }
    },
    ...getTextureProps<MToonMaterial>(manager, 'uvAnimationMaskTexture', '2D', false, 0),
    {
      name: 'UVAnimationScrollXSpeedFactor',
      description: 'MToon UV animation scroll speed on the X axis',
      type: 'float',
      default: 0,
      options: {
        animatable: true
      },
      get(this: MToonMaterial, value) {
        value.num[0] = this.uvAnimationScrollXSpeedFactor;
      },
      set(this: MToonMaterial, value) {
        this.uvAnimationScrollXSpeedFactor = value.num[0];
      },
      getDefaultValue(this: MToonMaterial) {
        return this.$isInstance ? this.coreMaterial.uvAnimationScrollXSpeedFactor : 0;
      }
    },
    {
      name: 'UVAnimationScrollYSpeedFactor',
      description: 'MToon UV animation scroll speed on the Y axis',
      type: 'float',
      default: 0,
      options: {
        animatable: true
      },
      get(this: MToonMaterial, value) {
        value.num[0] = this.uvAnimationScrollYSpeedFactor;
      },
      set(this: MToonMaterial, value) {
        this.uvAnimationScrollYSpeedFactor = value.num[0];
      },
      getDefaultValue(this: MToonMaterial) {
        return this.$isInstance ? this.coreMaterial.uvAnimationScrollYSpeedFactor : 0;
      }
    },
    {
      name: 'UVAnimationRotationSpeedFactor',
      description: 'MToon UV animation rotation speed',
      type: 'float',
      default: 0,
      options: {
        animatable: true
      },
      get(this: MToonMaterial, value) {
        value.num[0] = this.uvAnimationRotationSpeedFactor;
      },
      set(this: MToonMaterial, value) {
        this.uvAnimationRotationSpeedFactor = value.num[0];
      },
      getDefaultValue(this: MToonMaterial) {
        return this.$isInstance ? this.coreMaterial.uvAnimationRotationSpeedFactor : 0;
      }
    },
    {
      name: 'TransparentWithZWrite',
      description: 'If true, transparent MToon pixels also write depth',
      type: 'bool',
      default: false,
      get(this: MToonMaterial, value) {
        value.bool[0] = this.transparentWithZWrite;
      },
      set(this: MToonMaterial, value) {
        this.transparentWithZWrite = value.bool[0];
      },
      isValid(this: MToonMaterial) {
        return !this.$isInstance;
      }
    },
    {
      name: 'RenderQueueOffsetNumber',
      description: 'MToon render queue offset number',
      type: 'int',
      default: 0,
      options: {
        minValue: -9,
        maxValue: 9
      },
      get(this: MToonMaterial, value) {
        value.num[0] = this.renderQueueOffsetNumber;
      },
      set(this: MToonMaterial, value) {
        this.renderQueueOffsetNumber = value.num[0];
      },
      isValid(this: MToonMaterial) {
        return !this.$isInstance;
      }
    }
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
            description:
              'If greater then 0, pixels which have alpha smaller than alpha cutoff will be discarded',
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
            isValid(this: MeshMaterial) {
              return canEditParentMaterialProperty(this);
            }
          },
          {
            name: 'AlphaToCoverage',
            description: 'If true, alpha-to-coverage will be enabled',
            type: 'bool',
            default: false,
            get(this: MeshMaterial, value) {
              value.bool[0] = this.alphaToCoverage;
            },
            set(this: MeshMaterial, value) {
              this.alphaToCoverage = value.bool[0];
            },
            isValid(this: MeshMaterial) {
              return canEditParentMaterialProperty(this);
            }
          },
          {
            name: 'AlphaDither',
            description: 'If true, alpha-dithering will be enabled',
            type: 'bool',
            default: false,
            get(this: MeshMaterial, value) {
              value.bool[0] = this.alphaDither;
            },
            set(this: MeshMaterial, value) {
              this.alphaDither = value.bool[0];
            },
            isValid(this: MeshMaterial) {
              return canEditParentMaterialProperty(this) && this.alphaCutoff > 0;
            }
          },
          {
            name: 'BlendMode',
            description: 'Blending mode for this material',
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
            isValid(this: MeshMaterial) {
              return canEditParentMaterialProperty(this);
            }
          },
          {
            name: 'TransparentShadowCaster',
            description:
              'Lets a transparent (blended) material cast shadows. Areas more opaque than ShadowAlphaCutoff cast solid shadows, useful for foliage, hair cards or fabric; when off, transparent objects cast no shadow',
            type: 'bool',
            default: false,
            get(this: MeshMaterial, value) {
              value.bool[0] = this.transparentShadowCaster;
            },
            set(this: MeshMaterial, value) {
              this.transparentShadowCaster = value.bool[0];
            },
            isValid(this: MeshMaterial) {
              return canEditParentMaterialProperty(this) && this.blendMode !== 'none';
            }
          },
          {
            name: 'ShadowAlphaCutoff',
            description:
              'Opacity above which a transparent material casts shadow. Lower values make fainter parts cast shadow too, giving fuller shadows; higher values keep only the most opaque parts, giving thinner shadows',
            type: 'float',
            default: 0.5,
            options: {
              animatable: true,
              minValue: 0,
              maxValue: 1
            },
            get(this: MeshMaterial, value) {
              value.num[0] = this.shadowAlphaCutoff;
            },
            set(this: MeshMaterial, value) {
              this.shadowAlphaCutoff = value.num[0];
            },
            isValid(this: MeshMaterial) {
              return (
                canEditParentMaterialProperty(this) &&
                this.blendMode !== 'none' &&
                this.transparentShadowCaster
              );
            }
          },
          {
            name: 'CullMode',
            description: 'Cull mode for this material',
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
            isValid(this: MeshMaterial) {
              return canEditParentMaterialProperty(this);
            }
          },
          {
            name: 'Opacity',
            description: 'Opacity value for this material, no effect if blendingMode is `none`',
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
            isHidden: createBlueprintOutputHiddenPredicate(['Opacity']),
            getDefaultValue(this: MeshMaterial) {
              return this.$isInstance ? this.coreMaterial.opacity : 1;
            }
          },
          {
            name: 'TAAStrength',
            description: 'TAA strength for this material',
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
              return canEditParentMaterialProperty(this);
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
            description: 'Texture file path for the sprite',
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
            async set(this: StandardSpriteMaterial, value) {
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
            description: 'Alpha texture file path',
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
            description: 'Ramp texture file path',
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
      parent: PBRMetallicRoughnessMaterial,
      name: 'PBRBluePrintMaterial',
      getProps() {
        return defineProps([]);
      }
    },
    getMeshMaterialInstanceUniformsClass(PBRBluePrintMaterial)
  ];
}

/** @internal */
export function getPBRBluePrintMaterialInstanceClass(): SerializableClass[] {
  return [
    {
      ctor: PBRBluePrintMaterialInstance,
      parent: PBRBluePrintMaterial,
      name: 'PBRBluePrintMaterialInstance',
      getProps() {
        return defineProps([]);
      }
    },
    getMeshMaterialInstanceUniformsClass(PBRBluePrintMaterialInstance)
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
export function getMToonMaterialClass(manager: ResourceManager): SerializableClass[] {
  return [
    {
      ctor: MToonMaterial,
      parent: MeshMaterial,
      name: 'MToonMaterial',
      getProps() {
        return getMToonMaterialProps(manager);
      }
    },
    getMeshMaterialInstanceUniformsClass(MToonMaterial)
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
            description: 'Shininess value',
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
export function getHairMaterialClass(manager: ResourceManager): SerializableClass[] {
  return [
    {
      ctor: HairMaterial,
      parent: MeshMaterial,
      name: 'HairMaterial',
      getProps() {
        return defineProps([
          {
            name: 'ShadingModel',
            description:
              'Which scattering model shades the hair. Marschner derives the lobes from the fibre; Kajiya-Kay is the art-directed double lobe',
            type: 'string',
            default: 'kajiya-kay',
            options: {
              enum: {
                labels: ['Kajiya-Kay (double lobe)', 'Marschner (fibre)'],
                values: ['kajiya-kay', 'marschner']
              }
            },
            get(this: HairMaterial, value) {
              value.str[0] = this.shadingModel;
            },
            set(this: HairMaterial, value) {
              this.shadingModel = value.str[0] as HairShadingModel;
            },
            isValid(this: HairMaterial) {
              return !this.$isInstance;
            }
          },
          {
            name: 'Specular1Color',
            description: 'Color of the primary (sharp, near-white) specular lobe',
            type: 'rgb',
            default: [0.35, 0.35, 0.35],
            options: {
              animatable: true,
              minValue: 0,
              maxValue: 1
            },
            get(this: HairMaterial, value) {
              value.num[0] = this.specular1Color.x;
              value.num[1] = this.specular1Color.y;
              value.num[2] = this.specular1Color.z;
            },
            set(this: HairMaterial, value) {
              this.specular1Color = new Vector3(value.num[0], value.num[1], value.num[2]);
            }
          },
          {
            name: 'Specular1Power',
            description: 'Exponent of the primary specular lobe',
            type: 'float',
            default: 160,
            options: {
              animatable: true,
              minValue: 1,
              maxValue: 1024
            },
            get(this: HairMaterial, value) {
              value.num[0] = this.specular1Power;
            },
            set(this: HairMaterial, value) {
              this.specular1Power = value.num[0];
            }
          },
          {
            name: 'Specular1Shift',
            description: 'Shift of the primary specular lobe along the strand',
            type: 'float',
            default: -0.15,
            options: {
              animatable: true,
              minValue: -1,
              maxValue: 1
            },
            get(this: HairMaterial, value) {
              value.num[0] = this.specular1Shift;
            },
            set(this: HairMaterial, value) {
              this.specular1Shift = value.num[0];
            }
          },
          {
            name: 'Specular2Color',
            description: 'Color of the secondary (broad, hair-tinted) specular lobe',
            type: 'rgb',
            default: [0.5, 0.45, 0.4],
            options: {
              animatable: true,
              minValue: 0,
              maxValue: 1
            },
            get(this: HairMaterial, value) {
              value.num[0] = this.specular2Color.x;
              value.num[1] = this.specular2Color.y;
              value.num[2] = this.specular2Color.z;
            },
            set(this: HairMaterial, value) {
              this.specular2Color = new Vector3(value.num[0], value.num[1], value.num[2]);
            }
          },
          {
            name: 'Specular2Power',
            description: 'Exponent of the secondary specular lobe',
            type: 'float',
            default: 40,
            options: {
              animatable: true,
              minValue: 1,
              maxValue: 1024
            },
            get(this: HairMaterial, value) {
              value.num[0] = this.specular2Power;
            },
            set(this: HairMaterial, value) {
              this.specular2Power = value.num[0];
            }
          },
          {
            name: 'Specular2Shift',
            description: 'Shift of the secondary specular lobe along the strand',
            type: 'float',
            default: 0.1,
            options: {
              animatable: true,
              minValue: -1,
              maxValue: 1
            },
            get(this: HairMaterial, value) {
              value.num[0] = this.specular2Shift;
            },
            set(this: HairMaterial, value) {
              this.specular2Shift = value.num[0];
            }
          },
          {
            name: 'StrandDirection',
            description: 'Which TBN axis runs along the hair strands in the card atlas',
            type: 'string',
            default: 'binormal',
            options: {
              enum: {
                labels: ['Tangent (U)', 'Binormal (V)'],
                values: ['tangent', 'binormal']
              }
            },
            get(this: HairMaterial, value) {
              value.str[0] = this.strandDirection;
            },
            set(this: HairMaterial, value) {
              this.strandDirection = value.str[0] as HairStrandDirection;
            },
            isValid(this: HairMaterial) {
              return !this.$isInstance;
            }
          },
          // The Marschner parameters are deliberately not gated on ShadingModel.
          // An invalid property is skipped on both save and load, so gating them
          // would drop one model's tuning every time the material was saved under
          // the other - and switching back and forth is exactly what comparing
          // two models involves.
          {
            name: 'MarschnerShift',
            description: 'Cuticle tilt that separates the three Marschner lobes, in sine units',
            type: 'float',
            default: 0.035,
            options: {
              animatable: true,
              minValue: -0.2,
              maxValue: 0.2
            },
            get(this: HairMaterial, value) {
              value.num[0] = this.marschnerShift;
            },
            set(this: HairMaterial, value) {
              this.marschnerShift = value.num[0];
            },
            isValid(this: HairMaterial) {
              return !this.$isInstance;
            }
          },
          {
            name: 'MarschnerRoughness',
            description: 'Longitudinal width of the Marschner lobes',
            type: 'float',
            default: 0.3,
            options: {
              animatable: true,
              minValue: 0.005,
              maxValue: 1
            },
            get(this: HairMaterial, value) {
              value.num[0] = this.marschnerRoughness;
            },
            set(this: HairMaterial, value) {
              this.marschnerRoughness = value.num[0];
            },
            isValid(this: HairMaterial) {
              return !this.$isInstance;
            }
          },
          {
            name: 'MarschnerIOR',
            description: 'Refractive index of the fibre. 1.55 is the measured value for keratin',
            type: 'float',
            default: 1.55,
            options: {
              animatable: true,
              minValue: 1.01,
              maxValue: 2.5
            },
            get(this: HairMaterial, value) {
              value.num[0] = this.marschnerIOR;
            },
            set(this: HairMaterial, value) {
              this.marschnerIOR = value.num[0];
            },
            isValid(this: HairMaterial) {
              return !this.$isInstance;
            }
          },
          {
            name: 'MarschnerAbsorption',
            description: 'How strongly the transmitted Marschner paths take on the hair colour',
            type: 'float',
            default: 1,
            options: {
              animatable: true,
              minValue: 0,
              maxValue: 4
            },
            get(this: HairMaterial, value) {
              value.num[0] = this.marschnerAbsorption;
            },
            set(this: HairMaterial, value) {
              this.marschnerAbsorption = value.num[0];
            },
            isValid(this: HairMaterial) {
              return !this.$isInstance;
            }
          },
          {
            name: 'MarschnerLobes',
            description: 'Per-path intensities of the Marschner model as (R, TT, TRT)',
            type: 'vec3',
            default: [1, 1, 1],
            options: {
              animatable: true,
              minValue: 0,
              maxValue: 4
            },
            get(this: HairMaterial, value) {
              value.num[0] = this.marschnerLobes.x;
              value.num[1] = this.marschnerLobes.y;
              value.num[2] = this.marschnerLobes.z;
            },
            set(this: HairMaterial, value) {
              this.marschnerLobes = new Vector3(value.num[0], value.num[1], value.num[2]);
            },
            isValid(this: HairMaterial) {
              return !this.$isInstance;
            }
          },
          {
            name: 'ShiftMapScale',
            description: 'Scale applied to the per-strand shift texture',
            type: 'float',
            phase: 1,
            default: 1,
            options: {
              animatable: true,
              minValue: 0,
              maxValue: 4
            },
            get(this: HairMaterial, value) {
              value.num[0] = this.shiftMapScale;
            },
            set(this: HairMaterial, value) {
              this.shiftMapScale = value.num[0];
            },
            isValid(this: HairMaterial) {
              return !this.$isInstance && !!this.specularShiftTexture;
            }
          },
          ...getTextureProps<HairMaterial>(manager, 'specularShiftTexture', '2D', false, 0),
          {
            name: 'DiffuseWrap',
            description: 'Wrap diffuse amount that softens the terminator across thin cards',
            type: 'float',
            default: 0.5,
            options: {
              animatable: true,
              minValue: 0,
              maxValue: 1
            },
            get(this: HairMaterial, value) {
              value.num[0] = this.diffuseWrap;
            },
            set(this: HairMaterial, value) {
              this.diffuseWrap = value.num[0];
            }
          },
          {
            name: 'TransmissionColor',
            description: 'Tint color of the backlit transmission term',
            type: 'rgb',
            default: [0.9, 0.65, 0.45],
            options: {
              animatable: true,
              minValue: 0,
              maxValue: 1
            },
            get(this: HairMaterial, value) {
              value.num[0] = this.transmissionColor.x;
              value.num[1] = this.transmissionColor.y;
              value.num[2] = this.transmissionColor.z;
            },
            set(this: HairMaterial, value) {
              this.transmissionColor = new Vector3(value.num[0], value.num[1], value.num[2]);
            }
          },
          {
            name: 'TransmissionIntensity',
            description: 'Intensity of the backlit transmission term, 0 disables it',
            type: 'float',
            default: 0,
            options: {
              animatable: true,
              minValue: 0,
              maxValue: 4
            },
            get(this: HairMaterial, value) {
              value.num[0] = this.transmissionIntensity;
            },
            set(this: HairMaterial, value) {
              this.transmissionIntensity = value.num[0];
            }
          },
          {
            name: 'TransmissionPower',
            description: 'View-alignment exponent of the transmission term',
            type: 'float',
            default: 6,
            options: {
              animatable: true,
              minValue: 1,
              maxValue: 64
            },
            get(this: HairMaterial, value) {
              value.num[0] = this.transmissionPower;
            },
            set(this: HairMaterial, value) {
              this.transmissionPower = value.num[0];
            }
          },
          {
            name: 'ScatterColor',
            description: 'Tint of multiply-scattered light',
            type: 'rgb',
            default: [1, 0.85, 0.7],
            options: {
              animatable: true
            },
            get(this: HairMaterial, value) {
              value.num[0] = this.scatterColor.x;
              value.num[1] = this.scatterColor.y;
              value.num[2] = this.scatterColor.z;
            },
            set(this: HairMaterial, value) {
              this.scatterColor = new Vector3(value.num[0], value.num[1], value.num[2]);
            }
          },
          {
            name: 'ScatterIntensity',
            description: 'Intensity of the multiple scattering term, 0 disables it',
            type: 'float',
            default: 0,
            options: {
              animatable: true,
              minValue: 0,
              maxValue: 4
            },
            get(this: HairMaterial, value) {
              value.num[0] = this.scatterIntensity;
            },
            set(this: HairMaterial, value) {
              this.scatterIntensity = value.num[0];
            }
          },
          {
            name: 'ScatterLocal',
            description:
              'Balance between scattering that follows the light and scattering that survives where it is blocked',
            type: 'float',
            default: 0.5,
            options: {
              animatable: true,
              minValue: 0,
              maxValue: 1
            },
            get(this: HairMaterial, value) {
              value.num[0] = this.scatterLocal;
            },
            set(this: HairMaterial, value) {
              this.scatterLocal = value.num[0];
            }
          },
          {
            name: 'ScatterWrap',
            description: 'Angular width of the forward-scattered lobe',
            type: 'float',
            default: 1,
            options: {
              animatable: true,
              minValue: 0,
              maxValue: 4
            },
            get(this: HairMaterial, value) {
              value.num[0] = this.scatterWrap;
            },
            set(this: HairMaterial, value) {
              this.scatterWrap = value.num[0];
            }
          },
          {
            name: 'OcclusionStrength',
            description: 'Strength of the baked occlusion (root darkening) texture',
            type: 'float',
            phase: 1,
            default: 1,
            options: {
              animatable: true,
              minValue: 0,
              maxValue: 1
            },
            get(this: HairMaterial, value) {
              value.num[0] = this.occlusionStrength;
            },
            set(this: HairMaterial, value) {
              this.occlusionStrength = value.num[0];
            },
            isValid(this: HairMaterial) {
              return !this.$isInstance && !!this.occlusionTexture;
            }
          },
          ...getTextureProps<HairMaterial>(manager, 'occlusionTexture', '2D', false, 0),
          ...getLitMaterialProps(manager)
        ]);
      }
    },
    getMeshMaterialInstanceUniformsClass(HairMaterial)
  ];
}

/**
 * Serialization for the GPU strand expansion material.
 *
 * @remarks
 * Declared as a child of {@link HairMaterial}, so every lighting property the
 * parent exposes is inherited and only the expansion controls appear here.
 * The strand geometry itself is deliberately absent: it belongs to the node that
 * draws it, which references a `.zhair` asset, and duplicating millions of
 * control points into a material would defeat the point of having that file.
 * @internal
 */
export function getHairStrandMaterialClass(): SerializableClass[] {
  return [
    {
      ctor: HairStrandMaterial,
      parent: HairMaterial,
      name: 'HairStrandMaterial',
      getProps() {
        return defineProps([
          {
            name: 'SegmentsPerStrand',
            description:
              'Ribbon segments generated per strand. Independent of the control point count, so the same strands can be drawn coarser at a distance',
            type: 'int',
            default: 8,
            options: { minValue: 1, maxValue: 64 },
            get(this: HairStrandMaterial, value) {
              value.num[0] = this.segmentsPerStrand;
            },
            set(this: HairStrandMaterial, value) {
              this.segmentsPerStrand = value.num[0];
            }
          },
          {
            name: 'StrandWidthScale',
            description: 'Multiplier on the width stored in the strand data',
            type: 'float',
            default: 1,
            options: { animatable: true, minValue: 0, maxValue: 100 },
            get(this: HairStrandMaterial, value) {
              value.num[0] = this.strandWidthScale;
            },
            set(this: HairStrandMaterial, value) {
              this.strandWidthScale = value.num[0];
            }
          },
          {
            name: 'MinStrandWidth',
            description: 'Lower bound on ribbon width, in world units',
            type: 'float',
            default: 0,
            options: { minValue: 0, maxValue: 1 },
            get(this: HairStrandMaterial, value) {
              value.num[0] = this.minStrandWidth;
            },
            set(this: HairStrandMaterial, value) {
              this.minStrandWidth = value.num[0];
            }
          },
          {
            name: 'MinPixelWidth',
            description:
              'Lower bound on ribbon width in pixels. Real hair is thinner than a pixel; widening it and paying the coverage back in alpha keeps distant hair from breaking into a flickering dotted line',
            type: 'float',
            default: 1.4,
            options: { minValue: 0, maxValue: 8 },
            get(this: HairStrandMaterial, value) {
              value.num[0] = this.minPixelWidth;
            },
            set(this: HairStrandMaterial, value) {
              this.minPixelWidth = value.num[0];
            }
          },
          {
            name: 'StrandRoundness',
            description:
              'How far the shading normal bends across the ribbon. At 0 the strand shades as a flat tape, at 1 as a cylinder',
            type: 'float',
            default: 1,
            options: { animatable: true, minValue: 0, maxValue: 1 },
            get(this: HairStrandMaterial, value) {
              value.num[0] = this.strandRoundness;
            },
            set(this: HairStrandMaterial, value) {
              this.strandRoundness = value.num[0];
            }
          },
          {
            name: 'StrandLOD',
            description: 'Drop strands with distance, redistributing their coverage to the survivors',
            type: 'bool',
            default: false,
            get(this: HairStrandMaterial, value) {
              value.bool[0] = this.strandLOD;
            },
            set(this: HairStrandMaterial, value) {
              this.strandLOD = value.bool[0];
            }
          },
          {
            name: 'MinStrandLODRatio',
            description: 'Floor on the fraction of strands distance decimation keeps',
            type: 'float',
            default: 0.05,
            options: { minValue: 0, maxValue: 1 },
            isValid(this: HairStrandMaterial) {
              return this.strandLOD;
            },
            get(this: HairStrandMaterial, value) {
              value.num[0] = this.minStrandLODRatio;
            },
            set(this: HairStrandMaterial, value) {
              this.minStrandLODRatio = value.num[0];
            }
          }
        ]);
      }
    },
    getMeshMaterialInstanceUniformsClass(HairStrandMaterial)
  ];
}

/** @internal */
export function getSkinMaterialClass(manager: ResourceManager): SerializableClass[] {
  return [
    {
      ctor: SkinMaterial,
      parent: MeshMaterial,
      name: 'SkinMaterial',
      getProps() {
        return defineProps([
          {
            name: 'Roughness',
            description: 'GGX base roughness for skin',
            type: 'float',
            default: 0.5,
            options: { animatable: true, minValue: 0.045, maxValue: 1 },
            get(this: SkinMaterial, value) {
              value.num[0] = this.roughness;
            },
            set(this: SkinMaterial, value) {
              this.roughness = value.num[0];
            },
            getDefaultValue(this: SkinMaterial) {
              return this.$isInstance ? this.coreMaterial.roughness : 0.5;
            }
          },
          {
            name: 'SpecularF0',
            description: 'Fresnel F0 for the skin oil layer. UE5: 0.08 * Specular',
            type: 'float',
            default: 0.04,
            options: { animatable: true, minValue: 0, maxValue: 0.2 },
            get(this: SkinMaterial, value) {
              value.num[0] = this.specularF0;
            },
            set(this: SkinMaterial, value) {
              this.specularF0 = value.num[0];
            },
            getDefaultValue(this: SkinMaterial) {
              return this.$isInstance ? this.coreMaterial.specularF0 : 0.04;
            }
          },
          {
            name: 'SubsurfaceProfile',
            description: 'Profile driving the subsurface scattering of this skin',
            type: 'object',
            phase: 0,
            default: null,
            options: {
              objectTypes: [SkinProfile as unknown as GenericConstructor]
            },
            get(this: SkinMaterial, value) {
              value.object[0] = this.subsurfaceProfile;
            },
            // Deliberately empty rather than absent. The material owns its
            // profile and cannot be handed another one, but a property with no
            // setter is skipped outright during deserialization, and the nested
            // values would never be read back - `createFunc` on the profile
            // class has already routed them into this material's own instance by
            // the time this runs.
            set() {}
          },
          {
            name: 'TransmissionStrength',
            description:
              'Multiplier on back-lit transmission; needs a shadow-casting light with transmission enabled',
            type: 'float',
            default: 1,
            options: { animatable: true, minValue: 0, maxValue: 4 },
            get(this: SkinMaterial, value) {
              value.num[0] = this.transmissionStrength;
            },
            set(this: SkinMaterial, value) {
              this.transmissionStrength = value.num[0];
            },
            getDefaultValue(this: SkinMaterial) {
              return this.$isInstance ? this.coreMaterial.transmissionStrength : 1;
            }
          },
          ...getTextureProps<SkinMaterial>(manager, 'subsurfaceTexture', '2D', false, 1),
          ...getLitMaterialProps(manager)
        ]);
      }
    },
    getMeshMaterialInstanceUniformsClass(SkinMaterial)
  ];
}

/**
 * Serialization for {@link EyeMaterial}.
 *
 * Every `getDefaultValue()` non-instance branch below must return exactly what
 * the constructor sets. The serializer uses this both to decide whether a
 * property can be omitted when saving and to fill it in when it is absent on
 * load, so a mismatch silently rewrites assets - which is what a mismatched
 * `doubleSidedLighting` default did before it was found.
 */
export function getEyeMaterialClass(manager: ResourceManager): SerializableClass[] {
  return [
    {
      ctor: EyeMaterial,
      parent: MeshMaterial,
      name: 'EyeMaterial',
      getProps() {
        return defineProps([
          {
            name: 'IrisCenter',
            description: 'UV coordinate of the pupil centre on the eyeball mesh',
            type: 'vec2',
            default: [0.5, 0.5],
            options: { minValue: 0, maxValue: 1 },
            get(this: EyeMaterial, value) {
              value.num[0] = this.irisCenter.x;
              value.num[1] = this.irisCenter.y;
            },
            set(this: EyeMaterial, value) {
              this.irisCenter = new Vector4(value.num[0], value.num[1], 0, 0);
            },
            getDefaultValue(this: EyeMaterial) {
              const c = this.$isInstance ? this.coreMaterial.irisCenter : new Vector4(0.5, 0.5, 0, 0);
              return [c.x, c.y];
            }
          },
          {
            name: 'IrisRadius',
            description: 'Iris disc radius in UV units',
            type: 'float',
            default: 0.22,
            options: { animatable: true, minValue: 0.001, maxValue: 0.5 },
            get(this: EyeMaterial, value) {
              value.num[0] = this.irisRadius;
            },
            set(this: EyeMaterial, value) {
              this.irisRadius = value.num[0];
            },
            getDefaultValue(this: EyeMaterial) {
              return this.$isInstance ? this.coreMaterial.irisRadius : 0.22;
            }
          },
          {
            name: 'IrisDepth',
            description: 'Depth of the iris plane below the cornea; 0 disables parallax',
            type: 'float',
            default: 0.06,
            options: { animatable: true, minValue: 0, maxValue: 0.5 },
            get(this: EyeMaterial, value) {
              value.num[0] = this.irisDepth;
            },
            set(this: EyeMaterial, value) {
              this.irisDepth = value.num[0];
            },
            getDefaultValue(this: EyeMaterial) {
              return this.$isInstance ? this.coreMaterial.irisDepth : 0.06;
            }
          },
          {
            name: 'IOR',
            description: 'Index of refraction of the cornea (1.376 is physical)',
            type: 'float',
            default: 1.376,
            options: { animatable: true, minValue: 1, maxValue: 2 },
            get(this: EyeMaterial, value) {
              value.num[0] = this.ior;
            },
            set(this: EyeMaterial, value) {
              this.ior = value.num[0];
            },
            getDefaultValue(this: EyeMaterial) {
              return this.$isInstance ? this.coreMaterial.ior : 1.376;
            }
          },
          {
            name: 'PupilRadius',
            description: 'Pupil radius as a fraction of the iris radius',
            type: 'float',
            default: 0.35,
            options: { animatable: true, minValue: 0.01, maxValue: 0.95 },
            get(this: EyeMaterial, value) {
              value.num[0] = this.pupilRadius;
            },
            set(this: EyeMaterial, value) {
              this.pupilRadius = value.num[0];
            },
            getDefaultValue(this: EyeMaterial) {
              return this.$isInstance ? this.coreMaterial.pupilRadius : 0.35;
            }
          },
          {
            name: 'PupilDilation',
            description: 'Pupil dilation from -1 (constricted) to 1 (dilated)',
            type: 'float',
            default: 0,
            options: { animatable: true, minValue: -1, maxValue: 1 },
            get(this: EyeMaterial, value) {
              value.num[0] = this.pupilDilation;
            },
            set(this: EyeMaterial, value) {
              this.pupilDilation = value.num[0];
            },
            getDefaultValue(this: EyeMaterial) {
              return this.$isInstance ? this.coreMaterial.pupilDilation : 0;
            }
          },
          {
            name: 'IrisColor',
            description: 'Tint multiplied over the iris texture',
            type: 'rgba',
            default: [1, 1, 1, 1],
            options: { animatable: true, minValue: 0, maxValue: 4 },
            get(this: EyeMaterial, value) {
              value.num[0] = this.irisColor.x;
              value.num[1] = this.irisColor.y;
              value.num[2] = this.irisColor.z;
              value.num[3] = this.irisColor.w;
            },
            set(this: EyeMaterial, value) {
              this.irisColor = new Vector4(value.num[0], value.num[1], value.num[2], value.num[3]);
            },
            getDefaultValue(this: EyeMaterial) {
              const c = this.$isInstance ? this.coreMaterial.irisColor : new Vector4(1, 1, 1, 1);
              return [c.x, c.y, c.z, c.w];
            }
          },
          {
            name: 'IrisBrightness',
            description: 'Internal scattering that keeps the iris from crushing to black in shadow',
            type: 'float',
            default: 0.15,
            options: { animatable: true, minValue: 0, maxValue: 2 },
            get(this: EyeMaterial, value) {
              value.num[0] = this.irisBrightness;
            },
            set(this: EyeMaterial, value) {
              this.irisBrightness = value.num[0];
            },
            getDefaultValue(this: EyeMaterial) {
              return this.$isInstance ? this.coreMaterial.irisBrightness : 0.15;
            }
          },
          {
            name: 'LimbalRingWidth',
            description: 'Width of the dark ring at the iris edge, as a fraction of the iris radius',
            type: 'float',
            default: 0.15,
            options: { animatable: true, minValue: 0, maxValue: 1 },
            get(this: EyeMaterial, value) {
              value.num[0] = this.limbalRingWidth;
            },
            set(this: EyeMaterial, value) {
              this.limbalRingWidth = value.num[0];
            },
            getDefaultValue(this: EyeMaterial) {
              return this.$isInstance ? this.coreMaterial.limbalRingWidth : 0.15;
            }
          },
          {
            name: 'LimbalRingStrength',
            description: 'How dark the limbal ring gets; 0 disables it',
            type: 'float',
            default: 0.7,
            options: { animatable: true, minValue: 0, maxValue: 1 },
            get(this: EyeMaterial, value) {
              value.num[0] = this.limbalRingStrength;
            },
            set(this: EyeMaterial, value) {
              this.limbalRingStrength = value.num[0];
            },
            getDefaultValue(this: EyeMaterial) {
              return this.$isInstance ? this.coreMaterial.limbalRingStrength : 0.7;
            }
          },
          {
            name: 'ScleraColor',
            description: 'Base sclera colour; pure white reads as plastic',
            type: 'rgba',
            default: [0.9, 0.88, 0.86, 1],
            options: { animatable: true, minValue: 0, maxValue: 1 },
            get(this: EyeMaterial, value) {
              value.num[0] = this.scleraColor.x;
              value.num[1] = this.scleraColor.y;
              value.num[2] = this.scleraColor.z;
              value.num[3] = this.scleraColor.w;
            },
            set(this: EyeMaterial, value) {
              this.scleraColor = new Vector4(value.num[0], value.num[1], value.num[2], value.num[3]);
            },
            getDefaultValue(this: EyeMaterial) {
              const c = this.$isInstance ? this.coreMaterial.scleraColor : new Vector4(0.9, 0.88, 0.86, 1);
              return [c.x, c.y, c.z, c.w];
            }
          },
          {
            name: 'ScleraWrap',
            description: 'Diffuse wrap for the sclera, standing in for its subsurface softness',
            type: 'float',
            default: 0.35,
            options: { animatable: true, minValue: 0, maxValue: 2 },
            get(this: EyeMaterial, value) {
              value.num[0] = this.scleraWrap;
            },
            set(this: EyeMaterial, value) {
              this.scleraWrap = value.num[0];
            },
            getDefaultValue(this: EyeMaterial) {
              return this.$isInstance ? this.coreMaterial.scleraWrap : 0.35;
            }
          },
          {
            name: 'ScleraEdgeTint',
            description: 'Vasculature colour bled into the sclera away from the iris; alpha is its strength',
            type: 'rgba',
            default: [0.55, 0.22, 0.18, 1],
            options: { animatable: true, minValue: 0, maxValue: 1 },
            get(this: EyeMaterial, value) {
              value.num[0] = this.scleraEdgeTint.x;
              value.num[1] = this.scleraEdgeTint.y;
              value.num[2] = this.scleraEdgeTint.z;
              value.num[3] = this.scleraEdgeTint.w;
            },
            set(this: EyeMaterial, value) {
              this.scleraEdgeTint = new Vector4(value.num[0], value.num[1], value.num[2], value.num[3]);
            },
            getDefaultValue(this: EyeMaterial) {
              const c = this.$isInstance
                ? this.coreMaterial.scleraEdgeTint
                : new Vector4(0.55, 0.22, 0.18, 1);
              return [c.x, c.y, c.z, c.w];
            }
          },
          {
            name: 'CorneaSpecularStrength',
            description: 'Strength of the corneal highlight - the main cue that an eye is wet',
            type: 'float',
            default: 1,
            options: { animatable: true, minValue: 0, maxValue: 4 },
            get(this: EyeMaterial, value) {
              value.num[0] = this.corneaSpecularStrength;
            },
            set(this: EyeMaterial, value) {
              this.corneaSpecularStrength = value.num[0];
            },
            getDefaultValue(this: EyeMaterial) {
              return this.$isInstance ? this.coreMaterial.corneaSpecularStrength : 1;
            }
          },
          {
            name: 'CorneaRoughness',
            description: 'Corneal roughness; the cornea is close to a mirror, so keep this very low',
            type: 'float',
            default: 0.05,
            options: { animatable: true, minValue: 0.001, maxValue: 1 },
            get(this: EyeMaterial, value) {
              value.num[0] = this.corneaRoughness;
            },
            set(this: EyeMaterial, value) {
              this.corneaRoughness = value.num[0];
            },
            getDefaultValue(this: EyeMaterial) {
              return this.$isInstance ? this.coreMaterial.corneaRoughness : 0.05;
            }
          },
          {
            name: 'vertexTangent',
            description: 'Whether the mesh supplies tangents; without them refraction is disabled',
            type: 'bool',
            default: false,
            get(this: EyeMaterial, value) {
              value.bool[0] = this.vertexTangent;
            },
            set(this: EyeMaterial, value) {
              this.vertexTangent = value.bool[0];
            },
            getDefaultValue(this: EyeMaterial) {
              return this.$isInstance ? this.coreMaterial.vertexTangent : false;
            }
          },
          {
            name: 'SocketOcclusion',
            description: 'Enables analytic shadowing of the eyeball by the eyelids and socket',
            type: 'bool',
            default: false,
            get(this: EyeMaterial, value) {
              value.bool[0] = this.socketOcclusion;
            },
            set(this: EyeMaterial, value) {
              this.socketOcclusion = value.bool[0];
            },
            getDefaultValue(this: EyeMaterial) {
              return this.$isInstance ? this.coreMaterial.socketOcclusion : false;
            }
          },
          {
            name: 'SocketRotation',
            description: 'Euler rotation in degrees of the socket frame; zero matches +Y up, +Z gaze assets',
            type: 'vec3',
            default: [0, 0, 0],
            options: { minValue: -180, maxValue: 180 },
            get(this: EyeMaterial, value) {
              value.num[0] = this.socketRotation.x;
              value.num[1] = this.socketRotation.y;
              value.num[2] = this.socketRotation.z;
            },
            set(this: EyeMaterial, value) {
              this.socketRotation = new Vector4(value.num[0], value.num[1], value.num[2], 0);
            },
            getDefaultValue(this: EyeMaterial) {
              const r = this.$isInstance ? this.coreMaterial.socketRotation : new Vector4(0, 0, 0, 0);
              return [r.x, r.y, r.z];
            }
          },
          {
            name: 'UpperLidAngle',
            description: 'Aperture half-angle towards the upper lid, in degrees',
            type: 'float',
            default: 50,
            options: { animatable: true, minValue: 5, maxValue: 90 },
            get(this: EyeMaterial, value) {
              value.num[0] = this.upperLidAngle;
            },
            set(this: EyeMaterial, value) {
              this.upperLidAngle = value.num[0];
            },
            getDefaultValue(this: EyeMaterial) {
              return this.$isInstance ? this.coreMaterial.upperLidAngle : 50;
            }
          },
          {
            name: 'LowerLidAngle',
            description: 'Aperture half-angle towards the lower lid, in degrees',
            type: 'float',
            default: 65,
            options: { animatable: true, minValue: 5, maxValue: 90 },
            get(this: EyeMaterial, value) {
              value.num[0] = this.lowerLidAngle;
            },
            set(this: EyeMaterial, value) {
              this.lowerLidAngle = value.num[0];
            },
            getDefaultValue(this: EyeMaterial) {
              return this.$isInstance ? this.coreMaterial.lowerLidAngle : 65;
            }
          },
          {
            name: 'SocketOcclusionSoftness',
            description: 'Width of the lit-to-shadowed transition, in degrees',
            type: 'float',
            default: 15,
            options: { animatable: true, minValue: 1, maxValue: 45 },
            get(this: EyeMaterial, value) {
              value.num[0] = this.socketOcclusionSoftness;
            },
            set(this: EyeMaterial, value) {
              this.socketOcclusionSoftness = value.num[0];
            },
            getDefaultValue(this: EyeMaterial) {
              return this.$isInstance ? this.coreMaterial.socketOcclusionSoftness : 15;
            }
          },
          {
            name: 'SocketOcclusionStrength',
            description: 'Overall socket occlusion strength',
            type: 'float',
            default: 0.65,
            options: { animatable: true, minValue: 0, maxValue: 1 },
            get(this: EyeMaterial, value) {
              value.num[0] = this.socketOcclusionStrength;
            },
            set(this: EyeMaterial, value) {
              this.socketOcclusionStrength = value.num[0];
            },
            getDefaultValue(this: EyeMaterial) {
              return this.$isInstance ? this.coreMaterial.socketOcclusionStrength : 0.65;
            }
          },
          {
            name: 'ContactAO',
            description:
              'Enables screen-space contact occlusion of the eyeball by the eyelid, read from the depth prepass',
            type: 'bool',
            default: false,
            get(this: EyeMaterial, value) {
              value.bool[0] = this.contactAO;
            },
            set(this: EyeMaterial, value) {
              this.contactAO = value.bool[0];
            },
            getDefaultValue(this: EyeMaterial) {
              return this.$isInstance ? this.coreMaterial.contactAO : false;
            }
          },
          {
            name: 'ContactAORadius',
            description: 'Radius of the contact occlusion disc, in world units',
            type: 'float',
            default: 0.006,
            options: { animatable: true, minValue: 0.0001, maxValue: 0.1 },
            get(this: EyeMaterial, value) {
              value.num[0] = this.contactAORadius;
            },
            set(this: EyeMaterial, value) {
              this.contactAORadius = value.num[0];
            },
            getDefaultValue(this: EyeMaterial) {
              return this.$isInstance ? this.coreMaterial.contactAORadius : 0.006;
            }
          },
          {
            name: 'ContactAOMinDistance',
            description: 'Smallest depth step counted as an occluder, in world units',
            type: 'float',
            default: 0.0004,
            options: { animatable: true, minValue: 0.00001, maxValue: 0.02 },
            get(this: EyeMaterial, value) {
              value.num[0] = this.contactAOMinDistance;
            },
            set(this: EyeMaterial, value) {
              this.contactAOMinDistance = value.num[0];
            },
            getDefaultValue(this: EyeMaterial) {
              return this.$isInstance ? this.coreMaterial.contactAOMinDistance : 0.0004;
            }
          },
          {
            name: 'ContactAOMaxDistance',
            description: 'Largest depth step counted as an occluder, in world units',
            type: 'float',
            default: 0.006,
            options: { animatable: true, minValue: 0.00001, maxValue: 0.2 },
            get(this: EyeMaterial, value) {
              value.num[0] = this.contactAOMaxDistance;
            },
            set(this: EyeMaterial, value) {
              this.contactAOMaxDistance = value.num[0];
            },
            getDefaultValue(this: EyeMaterial) {
              return this.$isInstance ? this.coreMaterial.contactAOMaxDistance : 0.006;
            }
          },
          {
            name: 'ContactAOStrength',
            description: 'Overall contact occlusion strength',
            type: 'float',
            default: 0.7,
            options: { animatable: true, minValue: 0, maxValue: 1 },
            get(this: EyeMaterial, value) {
              value.num[0] = this.contactAOStrength;
            },
            set(this: EyeMaterial, value) {
              this.contactAOStrength = value.num[0];
            },
            getDefaultValue(this: EyeMaterial) {
              return this.$isInstance ? this.coreMaterial.contactAOStrength : 0.7;
            }
          },
          {
            name: 'ContactAOTemporalJitter',
            description:
              'Advances the contact occlusion noise pattern every frame so TAA can integrate it away; enable only with temporal anti-aliasing',
            type: 'bool',
            default: false,
            get(this: EyeMaterial, value) {
              value.bool[0] = this.contactAOTemporalJitter;
            },
            set(this: EyeMaterial, value) {
              this.contactAOTemporalJitter = value.bool[0];
            },
            getDefaultValue(this: EyeMaterial) {
              return this.$isInstance ? this.coreMaterial.contactAOTemporalJitter : false;
            }
          },
          ...getTextureProps<EyeMaterial>(manager, 'irisTexture', '2D', true, 0),
          ...getTextureProps<EyeMaterial>(manager, 'scleraTexture', '2D', true, 0)
        ]);
      }
    },
    getMeshMaterialInstanceUniformsClass(EyeMaterial)
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
            description: 'Metallic value',
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
            isHidden: createBlueprintOutputHiddenPredicate(['Metallic']),
            getDefaultValue(this: PBRMetallicRoughnessMaterial) {
              return this.$isInstance ? this.coreMaterial.metallic : 1;
            }
          },
          {
            name: 'Roughness',
            description: 'Roughness value',
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
            isHidden: createBlueprintOutputHiddenPredicate(['Roughness']),
            getDefaultValue(this: PBRMetallicRoughnessMaterial) {
              return this.$isInstance ? this.coreMaterial.roughness : 1;
            }
          },
          {
            name: 'SpecularFactor',
            description: 'RGBA specular factor used to tint and scale specular reflections',
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
            isHidden: createBlueprintOutputHiddenPredicate(['Specular', 'SpecularWeight']),
            getDefaultValue(this: PBRMetallicRoughnessMaterial) {
              return this.$isInstance ? this.coreMaterial.specularFactor : [1, 1, 1, 1];
            }
          },
          {
            name: 'Reflection',
            description: 'Reflection mode',
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
              const reflectionMode = value.str[0] as PBRReflectionMode;
              const blueprintInstance = this as PBRMetallicRoughnessMaterial & {
                isBlueprintMaterialInstance?: boolean;
                setBlueprintInstanceReflectionMode?: (val: PBRReflectionMode, inherited?: boolean) => void;
              };
              if (
                blueprintInstance.isBlueprintMaterialInstance &&
                blueprintInstance.setBlueprintInstanceReflectionMode
              ) {
                blueprintInstance.setBlueprintInstanceReflectionMode(reflectionMode);
              } else {
                this.reflectionMode = reflectionMode;
              }
            },
            getDefaultValue(this: PBRMetallicRoughnessMaterial) {
              return this.$isInstance ? this.coreMaterial.reflectionMode : 'ggx';
            }
          },
          {
            name: 'Anisotropy',
            description: 'Strength of anisotropic reflections; values near 0 behave isotropically',
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
            description: 'Rotation angle in degrees for the anisotropic highlight direction',
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
            description: 'Scale and bias applied when decoding anisotropy direction from its texture',
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
              return (
                !this.$isInstance &&
                this.reflectionMode === 'anisotropic' &&
                !!this.anisotropyDirectionTexture
              );
            }
          },
          {
            name: 'SubsurfaceLookPreset',
            description: 'Per-instance preset override for the active subsurface profile',
            type: 'string',
            phase: 1,
            default: 'skin_default',
            options: {
              label: 'LookPreset',
              enum: {
                labels: [
                  'Skin Thin',
                  'Skin Default',
                  'Skin HeavyMakeup',
                  'Wax Backlit',
                  'Wax Soft',
                  'Jade Backlit',
                  'Jade Soft'
                ],
                values: [
                  'skin_thin',
                  'skin_default',
                  'skin_heavy_makeup',
                  'wax_backlit',
                  'wax_soft',
                  'jade_backlit',
                  'jade_soft'
                ]
              },
              group: 'Subsurface Profile'
            },
            get(this: PBRMetallicRoughnessMaterial, value) {
              value.str[0] = this.subsurfaceProfile?.preset ?? 'skin_default';
            },
            set(this: PBRMetallicRoughnessMaterial, value) {
              const profile = getBlueprintInstanceSubsurfaceMaterial(this);
              if (profile.isBlueprintMaterialInstance && profile.setBlueprintInstanceSubsurfacePreset) {
                profile.setBlueprintInstanceSubsurfacePreset(value.str[0] as SubsurfaceProfilePreset);
              }
            },
            isValid(this: PBRMetallicRoughnessMaterial) {
              return canEditBlueprintInstanceSubsurfaceProfile(this);
            }
          },
          {
            name: 'SubsurfaceMeanFreePathColor',
            description: 'Per-instance mean free path color override for the active subsurface profile',
            type: 'rgb',
            phase: 1,
            default: [1, 0.45, 0.17],
            options: {
              label: 'MeanFreePathColor',
              animatable: true,
              minValue: 0,
              maxValue: 1,
              group: 'Subsurface Profile'
            },
            get(this: PBRMetallicRoughnessMaterial, value) {
              value.num[0] = this.subsurfaceProfile?.meanFreePathColor.x ?? 0;
              value.num[1] = this.subsurfaceProfile?.meanFreePathColor.y ?? 0;
              value.num[2] = this.subsurfaceProfile?.meanFreePathColor.z ?? 0;
            },
            set(this: PBRMetallicRoughnessMaterial, value) {
              const profile = getBlueprintInstanceSubsurfaceMaterial(this);
              profile.setBlueprintInstanceSubsurfaceProfileValue?.(
                'SubsurfaceMeanFreePathColor',
                'meanFreePathColor',
                new Vector3(value.num[0], value.num[1], value.num[2])
              );
            },
            isValid(this: PBRMetallicRoughnessMaterial) {
              return canEditBlueprintInstanceSubsurfaceProfile(this);
            }
          },
          {
            name: 'SubsurfaceMeanFreePathDistance',
            description: 'Per-instance mean free path distance override for the active subsurface profile',
            type: 'float',
            phase: 1,
            default: 0.92,
            options: {
              label: 'MeanFreePathDistance',
              animatable: true,
              minValue: 0,
              maxValue: 8,
              group: 'Subsurface Profile'
            },
            get(this: PBRMetallicRoughnessMaterial, value) {
              value.num[0] = this.subsurfaceProfile?.meanFreePathDistance ?? 0;
            },
            set(this: PBRMetallicRoughnessMaterial, value) {
              const profile = getBlueprintInstanceSubsurfaceMaterial(this);
              profile.setBlueprintInstanceSubsurfaceProfileValue?.(
                'SubsurfaceMeanFreePathDistance',
                'meanFreePathDistance',
                value.num[0]
              );
            },
            isValid(this: PBRMetallicRoughnessMaterial) {
              return canEditBlueprintInstanceSubsurfaceProfile(this);
            }
          },
          {
            name: 'SubsurfaceScatterWeight',
            description: 'Per-instance scatter weight override for the active subsurface profile',
            type: 'float',
            phase: 1,
            default: 0.82,
            options: {
              label: 'ScatterWeight',
              animatable: true,
              minValue: 0,
              maxValue: 8,
              group: 'Subsurface Profile'
            },
            get(this: PBRMetallicRoughnessMaterial, value) {
              value.num[0] = this.subsurfaceProfile?.strength ?? 0;
            },
            set(this: PBRMetallicRoughnessMaterial, value) {
              const profile = getBlueprintInstanceSubsurfaceMaterial(this);
              if (profile.isBlueprintMaterialInstance && profile.setBlueprintInstanceSubsurfaceStrength) {
                profile.setBlueprintInstanceSubsurfaceStrength(value.num[0]);
              }
            },
            isValid(this: PBRMetallicRoughnessMaterial) {
              return canEditBlueprintInstanceSubsurfaceProfile(this);
            }
          },
          {
            name: 'SubsurfaceScatterScale',
            description: 'Per-instance scatter scale override for the active subsurface profile',
            type: 'float',
            phase: 1,
            default: 0.96,
            options: {
              label: 'ScatterScale',
              animatable: true,
              minValue: 0,
              maxValue: 8,
              group: 'Subsurface Profile'
            },
            get(this: PBRMetallicRoughnessMaterial, value) {
              value.num[0] = this.subsurfaceProfile?.scale ?? 0;
            },
            set(this: PBRMetallicRoughnessMaterial, value) {
              const profile = getBlueprintInstanceSubsurfaceMaterial(this);
              if (profile.isBlueprintMaterialInstance && profile.setBlueprintInstanceSubsurfaceScale) {
                profile.setBlueprintInstanceSubsurfaceScale(value.num[0]);
              }
            },
            isValid(this: PBRMetallicRoughnessMaterial) {
              return canEditBlueprintInstanceSubsurfaceProfile(this);
            }
          },
          {
            name: 'SubsurfaceWorldUnitScale',
            description: 'Per-instance world unit scale override for the active subsurface profile',
            type: 'float',
            phase: 1,
            default: 1,
            options: {
              label: 'WorldUnitScale',
              animatable: true,
              minValue: 0.05,
              maxValue: 4,
              group: 'Subsurface Profile'
            },
            get(this: PBRMetallicRoughnessMaterial, value) {
              value.num[0] = this.subsurfaceProfile?.worldUnitScale ?? 1;
            },
            set(this: PBRMetallicRoughnessMaterial, value) {
              const profile = getBlueprintInstanceSubsurfaceMaterial(this);
              profile.setBlueprintInstanceSubsurfaceProfileValue?.(
                'SubsurfaceWorldUnitScale',
                'worldUnitScale',
                value.num[0]
              );
            },
            isValid(this: PBRMetallicRoughnessMaterial) {
              return canEditBlueprintInstanceSubsurfaceProfile(this);
            }
          },
          {
            name: 'SubsurfaceBoundaryColorBleed',
            description: 'Per-instance boundary color bleed override for the active subsurface profile',
            type: 'float',
            phase: 1,
            default: 0.22,
            options: {
              label: 'BoundaryColorBleed',
              animatable: true,
              minValue: 0,
              maxValue: 1,
              group: 'Subsurface Profile'
            },
            get(this: PBRMetallicRoughnessMaterial, value) {
              value.num[0] = this.subsurfaceProfile?.boundaryColorBleed ?? 0;
            },
            set(this: PBRMetallicRoughnessMaterial, value) {
              const profile = getBlueprintInstanceSubsurfaceMaterial(this);
              profile.setBlueprintInstanceSubsurfaceProfileValue?.(
                'SubsurfaceBoundaryColorBleed',
                'boundaryColorBleed',
                value.num[0]
              );
            },
            isValid(this: PBRMetallicRoughnessMaterial) {
              return canEditBlueprintInstanceSubsurfaceProfile(this);
            }
          },
          {
            name: 'SubsurfaceTransmissionTintColor',
            description: 'Per-instance transmission tint color override for the active subsurface profile',
            type: 'rgb',
            phase: 1,
            default: [1, 0.46, 0.34],
            options: {
              label: 'TransmissionTintColor',
              animatable: true,
              minValue: 0,
              maxValue: 1,
              group: 'Subsurface Profile'
            },
            get(this: PBRMetallicRoughnessMaterial, value) {
              value.num[0] = this.subsurfaceProfile?.transmissionTintColor.x ?? 0;
              value.num[1] = this.subsurfaceProfile?.transmissionTintColor.y ?? 0;
              value.num[2] = this.subsurfaceProfile?.transmissionTintColor.z ?? 0;
            },
            set(this: PBRMetallicRoughnessMaterial, value) {
              const profile = getBlueprintInstanceSubsurfaceMaterial(this);
              profile.setBlueprintInstanceSubsurfaceProfileValue?.(
                'SubsurfaceTransmissionTintColor',
                'transmissionTintColor',
                new Vector3(value.num[0], value.num[1], value.num[2])
              );
            },
            isValid(this: PBRMetallicRoughnessMaterial) {
              return canEditBlueprintInstanceSubsurfaceProfile(this);
            }
          },
          {
            name: 'SubsurfaceExtinctionScale',
            description: 'Per-instance extinction scale override for the active subsurface profile',
            type: 'float',
            phase: 1,
            default: 1.06,
            options: {
              label: 'ExtinctionScale',
              animatable: true,
              minValue: 0,
              maxValue: 4,
              group: 'Subsurface Profile'
            },
            get(this: PBRMetallicRoughnessMaterial, value) {
              value.num[0] = this.subsurfaceProfile?.extinctionScale ?? 0;
            },
            set(this: PBRMetallicRoughnessMaterial, value) {
              const profile = getBlueprintInstanceSubsurfaceMaterial(this);
              profile.setBlueprintInstanceSubsurfaceProfileValue?.(
                'SubsurfaceExtinctionScale',
                'extinctionScale',
                value.num[0]
              );
            },
            isValid(this: PBRMetallicRoughnessMaterial) {
              return canEditBlueprintInstanceSubsurfaceProfile(this);
            }
          },
          {
            name: 'SubsurfaceNormalScale',
            description: 'Per-instance normal scale override for the active subsurface profile',
            type: 'float',
            phase: 1,
            default: 1,
            options: {
              label: 'NormalScale',
              animatable: true,
              minValue: 0,
              maxValue: 2,
              group: 'Subsurface Profile'
            },
            get(this: PBRMetallicRoughnessMaterial, value) {
              value.num[0] = this.subsurfaceProfile?.normalScale ?? 0;
            },
            set(this: PBRMetallicRoughnessMaterial, value) {
              const profile = getBlueprintInstanceSubsurfaceMaterial(this);
              profile.setBlueprintInstanceSubsurfaceProfileValue?.(
                'SubsurfaceNormalScale',
                'normalScale',
                value.num[0]
              );
            },
            isValid(this: PBRMetallicRoughnessMaterial) {
              return canEditBlueprintInstanceSubsurfaceProfile(this);
            }
          },
          {
            name: 'SubsurfaceScatteringDistribution',
            description: 'Per-instance scattering distribution override for the active subsurface profile',
            type: 'float',
            phase: 1,
            default: 0.6,
            options: {
              label: 'ScatteringDistribution',
              animatable: true,
              minValue: 0,
              maxValue: 1,
              group: 'Subsurface Profile'
            },
            get(this: PBRMetallicRoughnessMaterial, value) {
              value.num[0] = this.subsurfaceProfile?.scatteringDistribution ?? 0;
            },
            set(this: PBRMetallicRoughnessMaterial, value) {
              const profile = getBlueprintInstanceSubsurfaceMaterial(this);
              profile.setBlueprintInstanceSubsurfaceProfileValue?.(
                'SubsurfaceScatteringDistribution',
                'scatteringDistribution',
                value.num[0]
              );
            },
            isValid(this: PBRMetallicRoughnessMaterial) {
              return canEditBlueprintInstanceSubsurfaceProfile(this);
            }
          },
          {
            name: 'SubsurfaceSpecularDetailSoftness',
            description: 'Per-instance specular detail softness override for the active subsurface profile',
            type: 'float',
            phase: 1,
            default: 0.78,
            options: {
              label: 'SpecularDetailSoftness',
              animatable: true,
              minValue: 0,
              maxValue: 1,
              group: 'Subsurface Profile'
            },
            get(this: PBRMetallicRoughnessMaterial, value) {
              value.num[0] = this.subsurfaceProfile?.specularDetailSoftness ?? 0;
            },
            set(this: PBRMetallicRoughnessMaterial, value) {
              const profile = getBlueprintInstanceSubsurfaceMaterial(this);
              profile.setBlueprintInstanceSubsurfaceProfileValue?.(
                'SubsurfaceSpecularDetailSoftness',
                'specularDetailSoftness',
                value.num[0]
              );
            },
            isValid(this: PBRMetallicRoughnessMaterial) {
              return canEditBlueprintInstanceSubsurfaceProfile(this);
            }
          },
          {
            name: 'SubsurfaceSpecularDetailRadius',
            description: 'Per-instance specular detail radius override for the active subsurface profile',
            type: 'float',
            phase: 1,
            default: 1.8,
            options: {
              label: 'SpecularDetailRadius',
              animatable: true,
              minValue: 0,
              maxValue: 4,
              group: 'Subsurface Profile'
            },
            get(this: PBRMetallicRoughnessMaterial, value) {
              value.num[0] = this.subsurfaceProfile?.specularDetailRadius ?? 0;
            },
            set(this: PBRMetallicRoughnessMaterial, value) {
              const profile = getBlueprintInstanceSubsurfaceMaterial(this);
              profile.setBlueprintInstanceSubsurfaceProfileValue?.(
                'SubsurfaceSpecularDetailRadius',
                'specularDetailRadius',
                value.num[0]
              );
            },
            isValid(this: PBRMetallicRoughnessMaterial) {
              return canEditBlueprintInstanceSubsurfaceProfile(this);
            }
          },
          {
            name: 'SubsurfaceProfile',
            description: 'If true, enables subsurface scattering for translucent materials',
            type: 'object',
            phase: 0,
            default: null,
            options: {
              objectTypes: [SubsurfaceProfile]
            },
            isNullable() {
              return true;
            },
            get(this: PBRMetallicRoughnessMaterial, value) {
              value.object[0] = this.subsurfaceProfile;
            },
            set(this: PBRMetallicRoughnessMaterial, value) {
              this.subsurfaceProfile = (value.object[0] as SubsurfaceProfile) ?? null;
            },
            isValid(this: PBRMetallicRoughnessMaterial) {
              return canEditParentMaterialProperty(this);
            }
          },
          ...getTextureProps<PBRMetallicRoughnessMaterial>(
            manager,
            'subsurfaceTexture',
            '2D',
            false,
            1,
            function () {
              return !!this.subsurfaceProfile;
            }
          ),
          ...getTextureProps<PBRMetallicRoughnessMaterial>(
            manager,
            'metallicRoughnessTexture',
            '2D',
            false,
            0,
            undefined,
            ['Metallic', 'Roughness']
          ),
          ...getTextureProps<PBRMetallicRoughnessMaterial>(
            manager,
            'specularColorTexture',
            '2D',
            true,
            0,
            undefined,
            ['Specular']
          ),
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
            description: 'RGB specular color multiplier for reflected highlights',
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
            description: 'Glossiness of the surface; higher values produce sharper reflections',
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
