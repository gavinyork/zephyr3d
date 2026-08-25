import { mimeTypeOf, Vector3, Vector4 } from '@zephyr3d/base';
import type { SceneNode } from '../../../scene';
import { GraphNode } from '../../../scene';
import { HairNode } from '../../../scene/hair';
import type { HairShadingModel } from '../../../material/hair';
import type { BlendMode } from '../../../material/meshmaterial';
import { defineProps, type SerializableClass } from '../types';

/**
 * Serialization for {@link HairNode}.
 *
 * @remarks
 * Ordinary in every respect: the node holds all of its own state, so these are
 * plain accessors onto it and the node saves and loads like any other.
 *
 * Two things are deliberately absent. The strand geometry is not here - it lives
 * in the `.zhair` asset the node references by path, and that file holds nothing
 * but strands, so the same groom can be shared by characters that style it
 * differently. Nor is the material: it is an implementation detail of the node
 * (see the {@link HairNode} class remarks), and its controls appear below as
 * properties of the node itself.
 * @internal
 */
export function getHairNodeClass(): SerializableClass {
  return {
    ctor: HairNode,
    name: 'HairNode',
    parent: GraphNode,
    createFunc(ctx: SceneNode) {
      const node = new HairNode(ctx.scene!);
      node.parent = ctx;
      return { obj: node };
    },
    getProps() {
      return defineProps([
        {
          name: 'HairAsset',
          description: 'Strand geometry asset drawn by this node',
          type: 'string',
          default: '',
          options: {
            group: 'Geometry',
            label: 'Hair Asset',
            mimeTypes: [mimeTypeOf('.zhair')]
          },
          get(this: HairNode, value) {
            value.str[0] = this.hairAsset;
          },
          async set(this: HairNode, value) {
            await this.setHairAsset(value?.str?.[0] ?? '');
          }
        },
        {
          name: 'StrandStride',
          description:
            'Draw one strand in every N. Thins the groom evenly across the scalp rather than cropping it',
          type: 'int',
          default: 1,
          options: { group: 'Geometry', minValue: 1, maxValue: 64 },
          get(this: HairNode, value) {
            value.num[0] = this.strandStride;
          },
          set(this: HairNode, value) {
            this.strandStride = value.num[0];
          }
        },
        {
          name: 'MaxStrands',
          description: 'Upper bound on drawn strands, widening the stride further when needed. 0 disables',
          type: 'int',
          default: 0,
          options: { group: 'Geometry', minValue: 0, maxValue: 1000000 },
          get(this: HairNode, value) {
            value.num[0] = this.maxStrands;
          },
          set(this: HairNode, value) {
            this.maxStrands = value.num[0];
          }
        },
        {
          name: 'SegmentsPerStrand',
          description:
            'Ribbon segments generated per strand. Independent of the control point count, so the same strands can be drawn coarser at a distance',
          type: 'int',
          default: 8,
          options: { group: 'Geometry', minValue: 1, maxValue: 64 },
          get(this: HairNode, value) {
            value.num[0] = this.segmentsPerStrand;
          },
          set(this: HairNode, value) {
            this.segmentsPerStrand = value.num[0];
          }
        },
        {
          name: 'StrandWidthScale',
          description: 'Multiplier on the width stored in the strand data',
          type: 'float',
          default: 1,
          options: { group: 'Geometry', animatable: true, minValue: 0, maxValue: 100 },
          get(this: HairNode, value) {
            value.num[0] = this.strandWidthScale;
          },
          set(this: HairNode, value) {
            this.strandWidthScale = value.num[0];
          }
        },
        {
          name: 'MinStrandWidth',
          description: 'Lower bound on ribbon width, in world units',
          type: 'float',
          default: 0,
          options: { group: 'Geometry', minValue: 0, maxValue: 1 },
          get(this: HairNode, value) {
            value.num[0] = this.minStrandWidth;
          },
          set(this: HairNode, value) {
            this.minStrandWidth = value.num[0];
          }
        },
        {
          name: 'MinPixelWidth',
          description:
            'Lower bound on ribbon width in pixels. Real hair is thinner than a pixel; widening it and paying the coverage back in alpha keeps distant hair from breaking into a flickering dotted line',
          type: 'float',
          default: 1.4,
          options: { group: 'Geometry', minValue: 0, maxValue: 8 },
          get(this: HairNode, value) {
            value.num[0] = this.minPixelWidth;
          },
          set(this: HairNode, value) {
            this.minPixelWidth = value.num[0];
          }
        },
        {
          name: 'RootOcclusion',
          description:
            'Darkens ambient light on strands near the root, standing in for the occlusion of being buried in the groom. Environment light is not shadowed, so without this a dense hairstyle is as bright inside as out. Direct light is left to the shadow map',
          type: 'float',
          default: 0.5,
          options: { group: 'Shading', animatable: true, minValue: 0, maxValue: 1 },
          get(this: HairNode, value) {
            value.num[0] = this.rootOcclusion;
          },
          set(this: HairNode, value) {
            this.rootOcclusion = value.num[0];
          }
        },
        {
          name: 'RootOcclusionRange',
          description: 'Fraction of a strand length over which the root occlusion fades out',
          type: 'float',
          default: 0.6,
          options: { group: 'Shading', minValue: 0.001, maxValue: 1 },
          isHidden(this: HairNode) {
            return this.rootOcclusion <= 0;
          },
          get(this: HairNode, value) {
            value.num[0] = this.rootOcclusionRange;
          },
          set(this: HairNode, value) {
            this.rootOcclusionRange = value.num[0];
          }
        },
        {
          name: 'StrandLOD',
          description: 'Drop strands with distance, redistributing their coverage to the survivors',
          type: 'bool',
          default: false,
          options: { group: 'Geometry' },
          get(this: HairNode, value) {
            value.bool[0] = this.strandLOD;
          },
          set(this: HairNode, value) {
            this.strandLOD = value.bool[0];
          }
        },
        {
          name: 'MinStrandLODRatio',
          description: 'Floor on the fraction of strands distance decimation keeps',
          type: 'float',
          default: 0.05,
          options: { group: 'Geometry', minValue: 0, maxValue: 1 },
          isHidden(this: HairNode) {
            return !this.strandLOD;
          },
          get(this: HairNode, value) {
            value.num[0] = this.minStrandLODRatio;
          },
          set(this: HairNode, value) {
            this.minStrandLODRatio = value.num[0];
          }
        },
        {
          name: 'AlbedoColor',
          description: 'Base color of the strands',
          type: 'rgba',
          default: [1, 1, 1, 1],
          options: { group: 'Shading', animatable: true, minValue: 0, maxValue: 1 },
          get(this: HairNode, value) {
            value.num[0] = this.albedoColor.x;
            value.num[1] = this.albedoColor.y;
            value.num[2] = this.albedoColor.z;
            value.num[3] = this.albedoColor.w;
          },
          set(this: HairNode, value) {
            this.albedoColor = new Vector4(value.num[0], value.num[1], value.num[2], value.num[3]);
          }
        },
        {
          name: 'ShadingModel',
          description:
            'Which scattering model shades the hair. Marschner derives the lobes from the fibre; Kajiya-Kay is the art-directed double lobe',
          type: 'string',
          default: 'kajiya-kay',
          options: {
            group: 'Shading',
            enum: {
              labels: ['Kajiya-Kay (double lobe)', 'Marschner (fibre)'],
              values: ['kajiya-kay', 'marschner']
            }
          },
          get(this: HairNode, value) {
            value.str[0] = this.shadingModel;
          },
          set(this: HairNode, value) {
            this.shadingModel = value.str[0] as HairShadingModel;
          }
        },
        {
          name: 'Specular1Color',
          description: 'Color of the primary (sharp, near-white) specular lobe',
          type: 'rgb',
          default: [0.35, 0.35, 0.35],
          options: { group: 'Shading', animatable: true, minValue: 0, maxValue: 1 },
          isHidden(this: HairNode) {
            return this.shadingModel !== 'kajiya-kay';
          },
          get(this: HairNode, value) {
            value.num[0] = this.specular1Color.x;
            value.num[1] = this.specular1Color.y;
            value.num[2] = this.specular1Color.z;
          },
          set(this: HairNode, value) {
            this.specular1Color = new Vector3(value.num[0], value.num[1], value.num[2]);
          }
        },
        {
          name: 'Specular1Power',
          description: 'Exponent of the primary specular lobe',
          type: 'float',
          default: 160,
          options: { group: 'Shading', animatable: true, minValue: 1, maxValue: 1024 },
          isHidden(this: HairNode) {
            return this.shadingModel !== 'kajiya-kay';
          },
          get(this: HairNode, value) {
            value.num[0] = this.specular1Power;
          },
          set(this: HairNode, value) {
            this.specular1Power = value.num[0];
          }
        },
        {
          name: 'Specular1Shift',
          description: 'Shift of the primary specular lobe along the strand',
          type: 'float',
          default: 0.05,
          options: { group: 'Shading', animatable: true, minValue: -1, maxValue: 1 },
          isHidden(this: HairNode) {
            return this.shadingModel !== 'kajiya-kay';
          },
          get(this: HairNode, value) {
            value.num[0] = this.specular1Shift;
          },
          set(this: HairNode, value) {
            this.specular1Shift = value.num[0];
          }
        },
        {
          name: 'Specular2Color',
          description: 'Color of the secondary (broad, tinted) specular lobe',
          type: 'rgb',
          default: [0.5, 0.35, 0.25],
          options: { group: 'Shading', animatable: true, minValue: 0, maxValue: 1 },
          isHidden(this: HairNode) {
            return this.shadingModel !== 'kajiya-kay';
          },
          get(this: HairNode, value) {
            value.num[0] = this.specular2Color.x;
            value.num[1] = this.specular2Color.y;
            value.num[2] = this.specular2Color.z;
          },
          set(this: HairNode, value) {
            this.specular2Color = new Vector3(value.num[0], value.num[1], value.num[2]);
          }
        },
        {
          name: 'Specular2Power',
          description: 'Exponent of the secondary specular lobe',
          type: 'float',
          default: 20,
          options: { group: 'Shading', animatable: true, minValue: 1, maxValue: 1024 },
          isHidden(this: HairNode) {
            return this.shadingModel !== 'kajiya-kay';
          },
          get(this: HairNode, value) {
            value.num[0] = this.specular2Power;
          },
          set(this: HairNode, value) {
            this.specular2Power = value.num[0];
          }
        },
        {
          name: 'Specular2Shift',
          description: 'Shift of the secondary specular lobe along the strand',
          type: 'float',
          default: -0.08,
          options: { group: 'Shading', animatable: true, minValue: -1, maxValue: 1 },
          isHidden(this: HairNode) {
            return this.shadingModel !== 'kajiya-kay';
          },
          get(this: HairNode, value) {
            value.num[0] = this.specular2Shift;
          },
          set(this: HairNode, value) {
            this.specular2Shift = value.num[0];
          }
        },
        {
          name: 'MarschnerShift',
          description: 'Longitudinal shift of the Marschner lobes',
          type: 'float',
          default: 0.035,
          options: { group: 'Shading', animatable: true, minValue: 0, maxValue: 0.5 },
          isHidden(this: HairNode) {
            return this.shadingModel !== 'marschner';
          },
          get(this: HairNode, value) {
            value.num[0] = this.marschnerShift;
          },
          set(this: HairNode, value) {
            this.marschnerShift = value.num[0];
          }
        },
        {
          name: 'MarschnerRoughness',
          description: 'Longitudinal roughness of the Marschner lobes',
          type: 'float',
          default: 0.25,
          options: { group: 'Shading', animatable: true, minValue: 0.01, maxValue: 1 },
          isHidden(this: HairNode) {
            return this.shadingModel !== 'marschner';
          },
          get(this: HairNode, value) {
            value.num[0] = this.marschnerRoughness;
          },
          set(this: HairNode, value) {
            this.marschnerRoughness = value.num[0];
          }
        },
        {
          name: 'MarschnerIOR',
          description: 'Index of refraction of the fibre',
          type: 'float',
          default: 1.55,
          options: { group: 'Shading', animatable: true, minValue: 1, maxValue: 3 },
          isHidden(this: HairNode) {
            return this.shadingModel !== 'marschner';
          },
          get(this: HairNode, value) {
            value.num[0] = this.marschnerIOR;
          },
          set(this: HairNode, value) {
            this.marschnerIOR = value.num[0];
          }
        },
        {
          name: 'MarschnerAbsorption',
          description:
            'How strongly pigmented the fibre is. Deepens the transmitted paths without touching the white surface reflection',
          type: 'float',
          default: 1,
          options: { group: 'Shading', animatable: true, minValue: 0, maxValue: 8 },
          isHidden(this: HairNode) {
            return this.shadingModel !== 'marschner';
          },
          get(this: HairNode, value) {
            value.num[0] = this.marschnerAbsorption;
          },
          set(this: HairNode, value) {
            this.marschnerAbsorption = value.num[0];
          }
        },
        {
          name: 'MarschnerLobes',
          description: 'Relative weight of the R, TT and TRT lobes',
          type: 'vec3',
          default: [1, 1, 1],
          options: { group: 'Shading', animatable: true, minValue: 0, maxValue: 4 },
          isHidden(this: HairNode) {
            return this.shadingModel !== 'marschner';
          },
          get(this: HairNode, value) {
            value.num[0] = this.marschnerLobes.x;
            value.num[1] = this.marschnerLobes.y;
            value.num[2] = this.marschnerLobes.z;
          },
          set(this: HairNode, value) {
            this.marschnerLobes = new Vector3(value.num[0], value.num[1], value.num[2]);
          }
        },
        {
          name: 'StrandRoundness',
          description:
            'How far the shading normal bends across the ribbon. At 0 a strand shades as a flat tape, at 1 as a cylinder',
          type: 'float',
          default: 1,
          options: { group: 'Shading', animatable: true, minValue: 0, maxValue: 1 },
          get(this: HairNode, value) {
            value.num[0] = this.strandRoundness;
          },
          set(this: HairNode, value) {
            this.strandRoundness = value.num[0];
          }
        },
        {
          name: 'DiffuseWrap',
          description: 'How far diffuse lighting wraps around the fibre',
          type: 'float',
          default: 0.5,
          options: { group: 'Shading', animatable: true, minValue: 0, maxValue: 1 },
          get(this: HairNode, value) {
            value.num[0] = this.diffuseWrap;
          },
          set(this: HairNode, value) {
            this.diffuseWrap = value.num[0];
          }
        },
        {
          name: 'TransmissionColor',
          description: 'Color of light transmitted through the fibre',
          type: 'rgb',
          default: [0.6, 0.35, 0.2],
          options: { group: 'Shading', animatable: true, minValue: 0, maxValue: 1 },
          get(this: HairNode, value) {
            value.num[0] = this.transmissionColor.x;
            value.num[1] = this.transmissionColor.y;
            value.num[2] = this.transmissionColor.z;
          },
          set(this: HairNode, value) {
            this.transmissionColor = new Vector3(value.num[0], value.num[1], value.num[2]);
          }
        },
        {
          name: 'TransmissionIntensity',
          description: 'Strength of back-lit transmission',
          type: 'float',
          default: 0.35,
          options: { group: 'Shading', animatable: true, minValue: 0, maxValue: 4 },
          get(this: HairNode, value) {
            value.num[0] = this.transmissionIntensity;
          },
          set(this: HairNode, value) {
            this.transmissionIntensity = value.num[0];
          }
        },
        {
          name: 'TransmissionPower',
          description: 'Falloff exponent of back-lit transmission',
          type: 'float',
          default: 4,
          options: { group: 'Shading', animatable: true, minValue: 1, maxValue: 64 },
          get(this: HairNode, value) {
            value.num[0] = this.transmissionPower;
          },
          set(this: HairNode, value) {
            this.transmissionPower = value.num[0];
          }
        },
        {
          name: 'ScatterColor',
          description: 'Color of multiple scattering within the groom',
          type: 'rgb',
          default: [0.55, 0.32, 0.18],
          options: { group: 'Shading', animatable: true, minValue: 0, maxValue: 1 },
          get(this: HairNode, value) {
            value.num[0] = this.scatterColor.x;
            value.num[1] = this.scatterColor.y;
            value.num[2] = this.scatterColor.z;
          },
          set(this: HairNode, value) {
            this.scatterColor = new Vector3(value.num[0], value.num[1], value.num[2]);
          }
        },
        {
          name: 'ScatterIntensity',
          description: 'Strength of multiple scattering',
          type: 'float',
          default: 0,
          options: { group: 'Shading', animatable: true, minValue: 0, maxValue: 4 },
          get(this: HairNode, value) {
            value.num[0] = this.scatterIntensity;
          },
          set(this: HairNode, value) {
            this.scatterIntensity = value.num[0];
          }
        },
        {
          name: 'ScatterLocal',
          description: 'Share of scattering taken as local rather than global',
          type: 'float',
          default: 0.5,
          options: { group: 'Shading', animatable: true, minValue: 0, maxValue: 1 },
          isHidden(this: HairNode) {
            return this.scatterIntensity <= 0;
          },
          get(this: HairNode, value) {
            value.num[0] = this.scatterLocal;
          },
          set(this: HairNode, value) {
            this.scatterLocal = value.num[0];
          }
        },
        {
          name: 'ScatterWrap',
          description: 'How far scattered light wraps around the fibre',
          type: 'float',
          default: 0.8,
          options: { group: 'Shading', animatable: true, minValue: 0, maxValue: 1 },
          isHidden(this: HairNode) {
            return this.scatterIntensity <= 0;
          },
          get(this: HairNode, value) {
            value.num[0] = this.scatterWrap;
          },
          set(this: HairNode, value) {
            this.scatterWrap = value.num[0];
          }
        },
        {
          name: 'BlendMode',
          description:
            'How the strands blend with what is behind them. The pixel-width floor pays its widening back in alpha, which only means anything once blending is on',
          type: 'string',
          default: 'none',
          options: {
            group: 'Transparency',
            enum: {
              labels: ['None', 'Blend', 'Additive', 'Max', 'Min'],
              values: ['none', 'blend', 'additive', 'max', 'min']
            }
          },
          get(this: HairNode, value) {
            value.str[0] = this.blendMode;
          },
          set(this: HairNode, value) {
            this.blendMode = value.str[0] as BlendMode;
          }
        },
        {
          name: 'AlphaCutoff',
          description: 'Alpha below which a fragment is discarded',
          type: 'float',
          default: 0,
          options: { group: 'Transparency', animatable: true, minValue: 0, maxValue: 1 },
          get(this: HairNode, value) {
            value.num[0] = this.alphaCutoff;
          },
          set(this: HairNode, value) {
            this.alphaCutoff = value.num[0];
          }
        },
        {
          name: 'AlphaDither',
          description: 'Dither the alpha test, so a temporal filter resolves the soft edge',
          type: 'bool',
          default: false,
          options: { group: 'Transparency' },
          get(this: HairNode, value) {
            value.bool[0] = this.alphaDither;
          },
          set(this: HairNode, value) {
            this.alphaDither = value.bool[0];
          }
        },
        {
          name: 'CastShadow',
          description: 'If true, the groom is drawn into shadow maps',
          type: 'bool',
          default: true,
          options: { group: 'Shadow' },
          get(this: HairNode, value) {
            value.bool[0] = this.castShadow;
          },
          set(this: HairNode, value) {
            this.castShadow = value.bool[0];
          }
        },
        {
          name: 'TransparentShadowCaster',
          description: 'Let the shadow caster pass respect strand alpha, for softer self-shadowing',
          type: 'bool',
          default: false,
          options: { group: 'Shadow' },
          isHidden(this: HairNode) {
            return !this.castShadow;
          },
          get(this: HairNode, value) {
            value.bool[0] = this.transparentShadowCaster;
          },
          set(this: HairNode, value) {
            this.transparentShadowCaster = value.bool[0];
          }
        },
        {
          name: 'ShadowAlphaCutoff',
          description: 'Alpha below which a fragment casts no shadow',
          type: 'float',
          default: 0,
          options: { group: 'Shadow', minValue: 0, maxValue: 1 },
          isHidden(this: HairNode) {
            return !this.castShadow || !this.transparentShadowCaster;
          },
          get(this: HairNode, value) {
            value.num[0] = this.shadowAlphaCutoff;
          },
          set(this: HairNode, value) {
            this.shadowAlphaCutoff = value.num[0];
          }
        },
        {
          name: 'Simulation',
          description:
            'Run strand dynamics on this groom. WebGPU only; the strands stay in their authored pose elsewhere',
          type: 'bool',
          default: false,
          options: { group: 'Simulation' },
          get(this: HairNode, value) {
            value.bool[0] = this.simulationEnabled;
          },
          set(this: HairNode, value) {
            this.simulationEnabled = value.bool[0];
          }
        },
        {
          name: 'Gravity',
          description: 'World-space gravity acting on the strands',
          type: 'vec3',
          default: [0, -9.8, 0],
          options: { group: 'Simulation', animatable: true },
          isHidden(this: HairNode) {
            return !this.simulationEnabled;
          },
          get(this: HairNode, value) {
            value.num[0] = this.gravity.x;
            value.num[1] = this.gravity.y;
            value.num[2] = this.gravity.z;
          },
          set(this: HairNode, value) {
            this.gravity = new Vector3(value.num[0], value.num[1], value.num[2]);
          }
        },
        {
          name: 'Stiffness',
          description:
            'Fraction of the deviation from the authored shape removed per fixed step. High values pin the styling and erase visible motion',
          type: 'float',
          default: 0.05,
          options: { group: 'Simulation', animatable: true, minValue: 0, maxValue: 1 },
          isHidden(this: HairNode) {
            return !this.simulationEnabled;
          },
          get(this: HairNode, value) {
            value.num[0] = this.stiffness;
          },
          set(this: HairNode, value) {
            this.stiffness = value.num[0];
          }
        },
        {
          name: 'Damping',
          description: 'Velocity lost each step. 0 keeps full inertia',
          type: 'float',
          default: 0.05,
          options: { group: 'Simulation', animatable: true, minValue: 0, maxValue: 1 },
          isHidden(this: HairNode) {
            return !this.simulationEnabled;
          },
          get(this: HairNode, value) {
            value.num[0] = this.damping;
          },
          set(this: HairNode, value) {
            this.damping = value.num[0];
          }
        },
        {
          name: 'Friction',
          description: 'Tangential motion removed at a contact',
          type: 'float',
          default: 0.2,
          options: { group: 'Simulation', minValue: 0, maxValue: 1 },
          isHidden(this: HairNode) {
            return !this.simulationEnabled;
          },
          get(this: HairNode, value) {
            value.num[0] = this.friction;
          },
          set(this: HairNode, value) {
            this.friction = value.num[0];
          }
        },
        {
          name: 'Substeps',
          description: 'Integration substeps per fixed step. More is stabler and slower',
          type: 'int',
          default: 2,
          options: { group: 'Simulation', minValue: 1, maxValue: 8 },
          isHidden(this: HairNode) {
            return !this.simulationEnabled;
          },
          get(this: HairNode, value) {
            value.num[0] = this.substeps;
          },
          set(this: HairNode, value) {
            this.substeps = value.num[0];
          }
        }
      ]);
    }
  };
}
