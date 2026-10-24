import type { Texture2D } from '@zephyr3d/device';
import type {
  CloudFormation,
  CloudMode,
  EnvLightType,
  FogType,
  SkyType,
  VolumetricCloudDebugView
} from '../../../render';
import { Scene } from '../../../scene/scene';
import { defineProps, type SerializableClass } from '../types';
import type { Nullable } from '@zephyr3d/base';
import { Vector2, Vector3, Vector4 } from '@zephyr3d/base';
import type { ResourceManager } from '../manager';
import { JSONArray, JSONData } from '../json';
import type { Camera } from '../../../camera';
import type { SceneNode } from '../../../scene';
import { ScriptAttachment, normalizeScriptAttachmentConfig } from '../../../scene/script_attachment';
import type { LightingMode } from '../../physical';
import { ScenePhysicsSettings } from '../../../scene/physics_settings';

/** @internal */
export function getSceneClass(manager: ResourceManager): SerializableClass {
  return {
    ctor: Scene,
    name: 'Scene',
    createFunc() {
      return { obj: new Scene() };
    },
    getProps() {
      return defineProps([
        {
          name: 'LightingMode',
          description: 'Lighting unit model. Legacy preserves the historical unitless pipeline.',
          type: 'string',
          phase: 0,
          default: 'legacy',
          options: {
            group: 'Rendering',
            enum: {
              labels: ['Legacy', 'Physical (experimental)'],
              values: ['legacy', 'physical']
            }
          },
          get(this: Scene, value) {
            value.str[0] = this.lightingMode;
          },
          set(this: Scene, value) {
            this.lightingMode = value.str[0] as LightingMode;
          }
        },
        {
          name: 'SDFEnabled',
          description:
            'Track the meshes with a baked signed distance field and stream their fields in around the camera, for the effects and simulations that read the scene SDF.',
          type: 'bool',
          default: false,
          options: { group: 'SDF' },
          get(this: Scene, value) {
            value.bool[0] = this.sdf.enabled;
          },
          set(this: Scene, value) {
            this.sdf.enabled = value.bool[0];
          }
        },
        {
          name: 'SDFStreamRadius',
          description: 'Distance from the camera within which mesh fields are kept loaded.',
          type: 'float',
          default: 256,
          options: { group: 'SDF', minValue: 1, maxValue: 100000 },
          isHidden(this: Scene) {
            return !this.sdf.enabled;
          },
          get(this: Scene, value) {
            value.num[0] = this.sdf.streamRadius;
          },
          set(this: Scene, value) {
            this.sdf.streamRadius = Math.max(1, value.num[0]);
          }
        },
        {
          name: 'GIEnabled',
          description:
            'Build the voxel scene the global illumination reads: the static meshes with a baked distance field are rasterized into a material atlas around the camera, giving the field surfaces their colour and glow. Turns SDFEnabled on. WebGPU only; nothing changes on WebGL2.',
          type: 'bool',
          default: false,
          options: { group: 'Global Illumination' },
          get(this: Scene, value) {
            value.bool[0] = this.gi.enabled;
          },
          set(this: Scene, value) {
            this.gi.enabled = value.bool[0];
          }
        },
        {
          name: 'GIVoxelizeBudget',
          description:
            'Meshes voxelized per frame. Higher fills the voxel scene sooner after loading or moving far, at the cost of a longer frame while it does.',
          type: 'int',
          default: 8,
          options: { group: 'Global Illumination', minValue: 1, maxValue: 64 },
          isHidden(this: Scene) {
            return !this.gi.enabled;
          },
          get(this: Scene, value) {
            value.num[0] = this.gi.voxelizeBudget;
          },
          set(this: Scene, value) {
            this.gi.voxelizeBudget = value.num[0];
          }
        },
        {
          name: 'GITerrainAlbedo',
          description:
            'Colour the terrain is given in the voxel scene, so the light it bounces onto nearby surfaces takes this tint, until it is read from the terrain itself.',
          type: 'rgb',
          default: [0.3, 0.3, 0.3],
          options: { group: 'Global Illumination' },
          isHidden(this: Scene) {
            return !this.gi.enabled;
          },
          get(this: Scene, value) {
            const color = this.gi.terrainAlbedo;
            value.num[0] = color.x;
            value.num[1] = color.y;
            value.num[2] = color.z;
          },
          set(this: Scene, value) {
            this.gi.terrainAlbedo.setXYZ(value.num[0], value.num[1], value.num[2]);
          }
        },
        {
          name: 'MetersPerUnit',
          description: 'Physical meters represented by one scene unit',
          type: 'float',
          phase: 0,
          default: 1,
          options: {
            group: 'Rendering',
            minValue: 0.000001
          },
          get(this: Scene, value) {
            value.num[0] = this.metersPerUnit;
          },
          set(this: Scene, value) {
            this.metersPerUnit = value.num[0];
          },
          isValid(this: Scene) {
            return this.lightingMode === 'physical';
          }
        },
        {
          name: 'Name',
          description: 'Scene name',
          type: 'string',
          default: '',
          isHidden() {
            return true;
          },
          get(this: Scene, value) {
            value.str[0] = this.name;
          },
          set(this: Scene, value) {
            this.name = value.str[0];
          }
        },
        {
          name: 'EnvLightType',
          description: 'Environment light type of scene',
          phase: 0,
          type: 'string',
          options: {
            enum: {
              labels: ['None', 'Constant', 'Hemispheric', 'IBL'],
              values: ['none', 'constant', 'hemisphere', 'ibl']
            }
          },
          default: 'ibl',
          get(this: Scene, value) {
            value.str[0] = this.env.light.type;
          },
          set(this: Scene, value) {
            this.env.light.type = value.str[0] as EnvLightType;
          }
        },
        {
          name: 'AmbientColor',
          description: 'RGB value for ambient color if environment light type sets to `Constant`',
          type: 'rgb',
          phase: 1,
          default: [0.2, 0.2, 0.2],
          options: {
            animatable: true
          },
          get(this: Scene, value) {
            const color = this.env.light.ambientColor;
            value.num[0] = color.x;
            value.num[1] = color.y;
            value.num[2] = color.z;
          },
          set(this: Scene, value) {
            this.env.light.ambientColor.setXYZW(value.num[0], value.num[1], value.num[2], 1);
          },
          isValid() {
            return this.env.light.type === 'constant';
          }
        },
        {
          name: 'AmbientUp',
          description: 'RGB value for upper ambient color if environment light type sets to `Hemispheric`',
          type: 'rgb',
          phase: 1,
          default: [0.3, 0.5, 0.8],
          options: {
            animatable: true
          },
          get(this: Scene, value) {
            const color = this.env.light.ambientUp;
            value.num[0] = color.x;
            value.num[1] = color.y;
            value.num[2] = color.z;
          },
          set(this: Scene, value) {
            this.env.light.ambientUp.setXYZW(value.num[0], value.num[1], value.num[2], 1);
          },
          isValid() {
            return this.env.light.type === 'hemisphere';
          }
        },
        {
          name: 'AmbientDown',
          description: 'RGB value for lower ambient color if environment light type sets to `Hemispheric`',
          type: 'rgb',
          phase: 1,
          default: [0.2, 0.2, 0.2],
          options: {
            animatable: true
          },
          get(this: Scene, value) {
            const color = this.env.light.ambientDown;
            value.num[0] = color.x;
            value.num[1] = color.y;
            value.num[2] = color.z;
          },
          set(this: Scene, value) {
            this.env.light.ambientDown.setXYZW(value.num[0], value.num[1], value.num[2], 1);
          },
          isValid() {
            return this.env.light.type === 'hemisphere';
          }
        },
        {
          name: 'EnvLightStrength',
          description: 'Environment light strength',
          type: 'float',
          phase: 0,
          options: { animatable: true, minValue: 0, maxValue: 10 },
          default: 1,
          get(this: Scene, value) {
            value.num[0] = this.env.light.strength;
          },
          set(this: Scene, value) {
            this.env.light.strength = value.num[0];
          }
        },
        {
          name: 'EnvLightIntensity',
          description:
            'Illuminance an authored (skybox / image) sky represents, in lux. Not used by the ' +
            'scattering sky, whose brightness comes from the sun illuminance; dim that with ' +
            'EnvLightStrength instead.',
          type: 'float',
          phase: 0,
          options: {
            animatable: true,
            minValue: 0,
            label: 'Intensity (lux)',
            group: 'Environment/Physical'
          },
          default: 30000,
          get(this: Scene, value) {
            value.num[0] = this.env.light.intensity;
          },
          set(this: Scene, value) {
            this.env.light.intensity = value.num[0];
          },
          isHidden(this: Scene) {
            // A scattering sky derives its luminance from the sun, so this value never reaches the
            // bake. Hiding it avoids presenting a control that cannot affect the image.
            return this.lightingMode !== 'physical' || this.env.sky.skyType === 'scatter';
          }
        },
        {
          name: 'EnvLightSpecularStrength',
          description: 'Environment light specular strength',
          type: 'float',
          phase: 0,
          options: { animatable: true, minValue: 0, maxValue: 10 },
          default: 1,
          get(this: Scene, value) {
            value.num[0] = this.env.light.specularStrength;
          },
          set(this: Scene, value) {
            this.env.light.specularStrength = value.num[0];
          }
        },
        {
          name: 'SHWindowWeights',
          description: 'Window weights for SH lighting',
          type: 'vec3',
          options: { minValue: 0, maxValue: 1 },
          default: [1, 1, 1],
          get(this: Scene, value) {
            const weights = this.env.sky.shWindowWeights;
            value.num[0] = weights.x;
            value.num[1] = weights.y;
            value.num[2] = weights.z;
          },
          set(this: Scene, value) {
            this.env.sky.shWindowWeights = new Vector3(value.num[0], value.num[1], value.num[2]);
          }
        },
        {
          name: 'RadianceConvSamples',
          description: 'Sample count for radiance convolution',
          type: 'int',
          options: { minValue: 1, maxValue: 2048 },
          default: 64,
          get(this: Scene, value) {
            value.num[0] = this.env.sky.radianceConvSamples;
          },
          set(this: Scene, value) {
            this.env.sky.radianceConvSamples = value.num[0];
          }
        },
        {
          name: 'IrradianceConvSamples',
          description: 'Sample count for irradiance convolution',
          type: 'int',
          options: { minValue: 1, maxValue: 2048 },
          default: 256,
          get(this: Scene, value) {
            value.num[0] = this.env.sky.irradianceConvSamples;
          },
          set(this: Scene, value) {
            this.env.sky.irradianceConvSamples = value.num[0];
          }
        },
        {
          name: 'SkyType',
          description: 'Type of sky rendering used by the scene',
          type: 'string',
          phase: 0,
          options: {
            enum: {
              labels: ['None', 'Image', 'SkyBox', 'Scatter'],
              values: ['none', 'image', 'skybox', 'scatter']
            }
          },
          default: 'scatter',
          get(this: Scene, value) {
            value.str[0] = this.env.sky.skyType;
          },
          set(this: Scene, value) {
            this.env.sky.skyType = value.str[0] as SkyType;
          }
        },
        {
          name: 'SkyColor',
          description: 'RGB value for sky color if skyType sets to `Image`',
          type: 'rgb',
          phase: 1,
          default: [1, 1, 1],
          options: {
            animatable: true
          },
          isValid(this: Scene) {
            return this.env.sky.skyType === 'image';
          },
          get(this: Scene, value) {
            const color = this.env.sky.skyColor;
            value.num[0] = color.x;
            value.num[1] = color.y;
            value.num[2] = color.z;
          },
          set(this: Scene, value) {
            this.env.sky.skyColor = new Vector4(value.num[0], value.num[1], value.num[2], 1);
            this.env.sky.invalidate();
          }
        },
        {
          name: 'SkyImage',
          description: 'Sky image file path if skyType sets to `Image`',
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
          isValid(this: Scene) {
            return this.env.sky.skyType === 'image';
          },
          isNullable() {
            return true;
          },
          get(this: Scene, value) {
            value.str[0] = manager.getAssetId(this.env.sky.skyImage) ?? '';
          },
          async set(this: Scene, value) {
            if (!value) {
              this.env.sky.skyImage = null;
            } else {
              if (value.str[0]) {
                const assetId = value.str[0];
                let tex: Nullable<Texture2D>;
                try {
                  tex = await manager.fetchTexture<Texture2D>(assetId);
                } catch (err) {
                  console.error(`Load asset failed: ${value.str[0]}: ${err}`);
                  tex = null;
                }
                const isValidTextureType = !!tex?.isTexture2D();
                if (isValidTextureType) {
                  this.env.sky.skyImage = tex;
                } else {
                  console.error('Invalid texture type');
                }
              }
            }
          }
        },
        {
          name: 'FogType',
          description: 'Type of fog rendering used by the scene',
          type: 'string',
          phase: 0,
          options: {
            enum: {
              labels: ['None', 'ExponentialHeightFog'],
              values: ['none', 'height_fog']
            }
          },
          default: 'none',
          get(this: Scene, value) {
            value.str[0] = this.env.sky.fogType;
          },
          set(this: Scene, value) {
            this.env.sky.fogType = value.str[0] as FogType;
          }
        },
        {
          type: 'float',
          name: 'HeightFogDensity',
          description: 'Base density of exponential height fog',
          default: 0.04,
          options: { group: 'HeightFog', label: 'Density', minValue: 0, maxValue: 1 },
          isValid(this: Scene) {
            return this.env.sky.fogType === 'height_fog';
          },
          get(this: Scene, value) {
            value.num[0] = this.env.sky.heightFogDensity;
          },
          set(this: Scene, value) {
            this.env.sky.heightFogDensity = value.num[0];
          }
        },
        {
          name: 'HeightFogFalloff',
          description: 'How quickly fog density changes with height',
          type: 'float',
          default: 0.2,
          options: { group: 'HeightFog', label: 'Falloff', minValue: 0, maxValue: 1 },
          isValid(this: Scene) {
            return this.env.sky.fogType === 'height_fog';
          },
          get(this: Scene, value) {
            value.num[0] = this.env.sky.heightFogFalloff;
          },
          set(this: Scene, value) {
            this.env.sky.heightFogFalloff = value.num[0];
          }
        },
        {
          name: 'HeightFogStartHeight',
          description: 'World height where height fog starts',
          type: 'float',
          default: 0,
          options: { group: 'HeightFog', label: 'StartHeight', minValue: 0, maxValue: 1000 },
          isValid(this: Scene) {
            return this.env.sky.fogType === 'height_fog';
          },
          get(this: Scene, value) {
            value.num[0] = this.env.sky.heightFogStartHeight;
          },
          set(this: Scene, value) {
            this.env.sky.heightFogStartHeight = value.num[0];
          }
        },
        {
          name: 'HeightFogColor',
          description: 'Base color of the height fog',
          type: 'rgb',
          phase: 1,
          default: [0, 0, 0],
          options: {
            group: 'HeightFog',
            label: 'FogColor',
            animatable: true
          },
          isValid(this: Scene) {
            return this.env.sky.fogType === 'height_fog';
          },
          get(this: Scene, value) {
            const color = this.env.sky.heightFogColor;
            value.num[0] = color.x;
            value.num[1] = color.y;
            value.num[2] = color.z;
          },
          set(this: Scene, value) {
            this.env.sky.heightFogColor = new Vector3(value.num[0], value.num[1], value.num[2]);
          }
        },
        {
          name: 'HeightFogStartDistance',
          description: 'Distance from the camera where height fog begins',
          type: 'float',
          default: 0,
          options: {
            group: 'HeightFog',
            label: 'StartDistance'
          },
          isValid(this: Scene) {
            return this.env.sky.fogType === 'height_fog';
          },
          get(this: Scene, value) {
            value.num[0] = this.env.sky.heightFogStartDistance;
          },
          set(this: Scene, value) {
            this.env.sky.heightFogStartDistance = value.num[0];
          }
        },
        {
          name: 'HeightFogEndDistance',
          description:
            'Horizontal distance beyond which height fog stops getting thicker. 0 lets it keep accumulating to any distance',
          type: 'float',
          default: 10000,
          options: {
            group: 'HeightFog',
            label: 'EndDistance'
          },
          isValid(this: Scene) {
            return this.env.sky.fogType === 'height_fog';
          },
          get(this: Scene, value) {
            value.num[0] = this.env.sky.heightFogEndDistance;
          },
          set(this: Scene, value) {
            this.env.sky.heightFogEndDistance = value.num[0];
          }
        },
        {
          name: 'HeightFogMaxOpacity',
          description: 'Maximum opacity of the height fog',
          type: 'float',
          options: { group: 'HeightFog', label: 'MaxOpacity', minValue: 0, maxValue: 1 },
          default: 1,
          isValid(this: Scene) {
            return this.env.sky.fogType === 'height_fog';
          },
          get(this: Scene, value) {
            value.num[0] = this.env.sky.heightFogMaxOpacity;
          },
          set(this: Scene, value) {
            this.env.sky.heightFogMaxOpacity = value.num[0];
          }
        },
        {
          name: 'HeightFogAtmosphereStrength',
          description: 'How much atmospheric scattering contributes to the fog',
          type: 'float',
          options: { group: 'HeightFog', label: 'AtmosphereStrength', minValue: 0, maxValue: 10 },
          default: 1,
          isValid(this: Scene) {
            return this.env.sky.fogType === 'height_fog';
          },
          get(this: Scene, value) {
            value.num[0] = this.env.sky.heightFogAtmosphereContribution;
          },
          set(this: Scene, value) {
            this.env.sky.heightFogAtmosphereContribution = value.num[0];
          }
        },
        {
          name: 'HeightFogDirExponent',
          description: 'Directional inscattering exponent for height fog',
          type: 'float',
          default: 4,
          options: { group: 'HeightFog', label: 'DirectionalExponent' },
          isValid(this: Scene) {
            return this.env.sky.fogType === 'height_fog';
          },
          get(this: Scene, value) {
            value.num[0] = this.env.sky.heightFogDirExponent;
          },
          set(this: Scene, value) {
            this.env.sky.heightFogDirExponent = value.num[0];
          }
        },
        {
          name: 'HeightFogDirColor',
          description: 'Directional inscattering color for height fog',
          type: 'rgb',
          default: [0, 0, 0],
          options: {
            group: 'HeightFog',
            label: 'DirectionalInscattering'
          },
          isValid(this: Scene) {
            return this.env.sky.fogType === 'height_fog';
          },
          get(this: Scene, value) {
            value.num[0] = this.env.sky.heightFogDirColor.x;
            value.num[1] = this.env.sky.heightFogDirColor.y;
            value.num[2] = this.env.sky.heightFogDirColor.z;
          },
          set(this: Scene, value) {
            this.env.sky.heightFogDirColor = new Vector3(value.num[0], value.num[1], value.num[2]);
          }
        },
        {
          name: 'HeightFogSkyLightStrength',
          description:
            'Makes distant fog take the color of the environment behind it instead of one flat color, removing the dark band at the horizon. Needs an IBL environment light',
          type: 'float',
          options: { group: 'HeightFog', label: 'SkyLightStrength', minValue: 0, maxValue: 1 },
          default: 0,
          isValid(this: Scene) {
            return this.env.sky.fogType === 'height_fog';
          },
          get(this: Scene, value) {
            value.num[0] = this.env.sky.heightFogSkyLightStrength;
          },
          set(this: Scene, value) {
            this.env.sky.heightFogSkyLightStrength = value.num[0];
          }
        },
        {
          name: 'HeightFogSkyLightRoughness',
          description:
            'Blurriness of the environment seen through the fog. Higher values give a softer, more uniform fog color',
          type: 'float',
          options: { group: 'HeightFog', label: 'SkyLightRoughness', minValue: 0, maxValue: 1 },
          default: 0.15,
          isValid(this: Scene) {
            return this.env.sky.fogType === 'height_fog';
          },
          get(this: Scene, value) {
            value.num[0] = this.env.sky.heightFogSkyLightRoughness;
          },
          set(this: Scene, value) {
            this.env.sky.heightFogSkyLightRoughness = value.num[0];
          }
        },
        {
          name: 'AerialPerspectiveDistance',
          description:
            'How far the atmosphere keeps hazing distant objects toward the sky color. Beyond this distance the haze stops getting thicker',
          type: 'float',
          phase: 1,
          options: { animatable: true, minValue: 1, maxValue: 200000 },
          default: 96000,
          get(this: Scene, value) {
            value.num[0] = this.env.sky.aerialPerspectiveDistance;
          },
          set(this: Scene, value) {
            this.env.sky.aerialPerspectiveDistance = value.num[0];
          },
          isValid() {
            return this.env.sky.skyType === 'scatter';
          }
        },
        {
          name: 'AerialPerspectiveViewDistanceScale',
          description:
            'Strength of the atmospheric haze on distant objects. Higher values make them fade into the sky color sooner; the sky itself does not change',
          type: 'float',
          phase: 1,
          options: { animatable: true, minValue: 0, maxValue: 10 },
          default: 1,
          get(this: Scene, value) {
            value.num[0] = this.env.sky.aerialPerspectiveViewDistanceScale;
          },
          set(this: Scene, value) {
            this.env.sky.aerialPerspectiveViewDistanceScale = value.num[0];
          },
          isValid() {
            return this.env.sky.skyType === 'scatter';
          }
        },
        {
          name: 'AerialPerspectiveStartDepth',
          description:
            'Distance from the camera, in meters, where the atmospheric haze starts. Anything nearer stays completely clear',
          type: 'float',
          phase: 1,
          options: { animatable: true, minValue: 0, maxValue: 10000 },
          default: 100,
          get(this: Scene, value) {
            value.num[0] = this.env.sky.aerialPerspectiveStartDepth;
          },
          set(this: Scene, value) {
            this.env.sky.aerialPerspectiveStartDepth = value.num[0];
          },
          isValid() {
            return this.env.sky.skyType === 'scatter';
          }
        },
        {
          name: 'CameraHeightScale',
          description:
            'How many meters of atmosphere one world unit stands for. Larger values make the camera climb faster through the sky and distant objects haze sooner',
          type: 'float',
          phase: 1,
          options: { animatable: true, minValue: 0.001, maxValue: 1000 },
          default: 1,
          get(this: Scene, value) {
            value.num[0] = this.env.sky.cameraHeightScale;
          },
          set(this: Scene, value) {
            this.env.sky.cameraHeightScale = value.num[0];
          },
          isValid() {
            return this.env.sky.skyType === 'scatter';
          }
        },
        {
          name: 'AtmosphereRebakeAltitudeRatio',
          description:
            'How much the camera must climb or descend, as a fraction of its altitude, before the environment lighting from the sky is updated. Smaller values follow the sky more closely while flying but cost more',
          type: 'float',
          phase: 1,
          options: { minValue: 0, maxValue: 1 },
          default: 0.05,
          get(this: Scene, value) {
            value.num[0] = this.env.sky.atmosphereRebakeAltitudeRatio;
          },
          set(this: Scene, value) {
            this.env.sky.atmosphereRebakeAltitudeRatio = value.num[0];
          },
          isValid() {
            return this.env.sky.skyType === 'scatter';
          }
        },
        {
          name: 'AtmosphereRebakeAngle',
          description:
            'How far, in degrees of planet curvature, the camera must travel before the environment lighting from the sky is updated. 0.5 degrees is about 55 km on Earth',
          type: 'float',
          phase: 1,
          options: { minValue: 0, maxValue: 10 },
          default: 0.5,
          get(this: Scene, value) {
            value.num[0] = this.env.sky.atmosphereRebakeAngle;
          },
          set(this: Scene, value) {
            this.env.sky.atmosphereRebakeAngle = value.num[0];
          },
          isValid() {
            return this.env.sky.skyType === 'scatter';
          }
        },
        {
          name: 'GroundAlbedo',
          description:
            'Color of the ground seen below the horizon where no geometry covers the sky. It also reflects light back up and brightens the sky slightly',
          type: 'rgb',
          phase: 1,
          default: [0.401978, 0.401978, 0.401978],
          get(this: Scene, value) {
            value.num[0] = this.env.sky.groundAlbedo.x;
            value.num[1] = this.env.sky.groundAlbedo.y;
            value.num[2] = this.env.sky.groundAlbedo.z;
          },
          set(this: Scene, value) {
            this.env.sky.groundAlbedo = new Vector3(value.num[0], value.num[1], value.num[2]);
          },
          isValid() {
            return this.env.sky.skyType === 'scatter';
          }
        },
        {
          name: 'LowerHemisphereIsBlack',
          description:
            'Keeps the ground below the horizon out of the environment lighting, so objects are not lit from below as if standing on an endless plain. The ground stays visible in the sky itself',
          type: 'bool',
          phase: 1,
          default: true,
          get(this: Scene, value) {
            value.bool[0] = this.env.sky.lowerHemisphereIsBlack;
          },
          set(this: Scene, value) {
            this.env.sky.lowerHemisphereIsBlack = value.bool[0];
          },
          isValid() {
            return this.env.sky.skyType === 'scatter';
          }
        },
        {
          name: 'AtmosphereExposure',
          description: 'Exposure multiplier for atmospheric scattering and sky rendering',
          type: 'float',
          options: { animatable: true, minValue: 0, maxValue: 8 },
          default: 1,
          get(this: Scene, value) {
            value.num[0] = this.env.sky.atmosphereExposure;
          },
          set(this: Scene, value) {
            this.env.sky.atmosphereExposure = value.num[0];
          },
          isValid() {
            return this.env.sky.skyType === 'scatter';
          }
        },
        {
          name: 'Cloudy',
          description: 'Cloud coverage amount for the procedural sky',
          type: 'float',
          default: 0.6,
          phase: 1,
          options: { animatable: true, minValue: 0, maxValue: 1 },
          get(this: Scene, value) {
            value.num[0] = this.env.sky.cloudy;
          },
          set(this: Scene, value) {
            this.env.sky.cloudy = value.num[0];
          },
          isValid() {
            return this.env.sky.skyType === 'scatter';
          }
        },
        {
          name: 'CloudIntensity',
          description: 'Brightness of procedural clouds',
          type: 'float',
          default: 40,
          phase: 1,
          options: { animatable: true, minValue: 0, maxValue: 200 },
          get(this: Scene, value) {
            value.num[0] = this.env.sky.cloudIntensity;
          },
          set(this: Scene, value) {
            this.env.sky.cloudIntensity = value.num[0];
          },
          isValid() {
            return this.env.sky.skyType === 'scatter';
          }
        },
        {
          name: 'CloudMode',
          description:
            'Procedural draws a flat cloud layer; Volumetric draws lit 3D clouds (WebGPU only, falls back to Procedural elsewhere)',
          type: 'string',
          phase: 1,
          options: {
            enum: { labels: ['Procedural', 'Volumetric'], values: ['procedural', 'volumetric'] }
          },
          default: 'procedural',
          get(this: Scene, value) {
            value.str[0] = this.env.sky.cloudMode;
          },
          set(this: Scene, value) {
            this.env.sky.cloudMode = value.str[0] as CloudMode;
          },
          isValid() {
            return this.env.sky.skyType === 'scatter';
          }
        },
        {
          name: 'VolumetricCloudLayerBottomAltitude',
          description: 'Raises the cloud base: higher clouds look smaller and farther away',
          type: 'float',
          default: 5000,
          phase: 2,
          options: {
            group: 'VolumetricClouds',
            label: 'LayerBottomAltitude',
            animatable: true,
            minValue: 0,
            maxValue: 20000
          },
          get(this: Scene, value) {
            value.num[0] = this.env.sky.volumetricCloud.layerBottomAltitude;
          },
          set(this: Scene, value) {
            this.env.sky.volumetricCloud.layerBottomAltitude = value.num[0];
          },
          isValid(this: Scene) {
            return this.env.sky.skyType === 'scatter' && this.env.sky.cloudMode === 'volumetric';
          }
        },
        {
          name: 'VolumetricCloudLayerHeight',
          description: 'Lets clouds tower higher above their base',
          type: 'float',
          default: 10000,
          phase: 2,
          options: {
            group: 'VolumetricClouds',
            label: 'LayerHeight',
            animatable: true,
            minValue: 100,
            maxValue: 20000
          },
          get(this: Scene, value) {
            value.num[0] = this.env.sky.volumetricCloud.layerHeight;
          },
          set(this: Scene, value) {
            this.env.sky.volumetricCloud.layerHeight = value.num[0];
          },
          isValid(this: Scene) {
            return this.env.sky.skyType === 'scatter' && this.env.sky.cloudMode === 'volumetric';
          }
        },
        {
          name: 'VolumetricCloudBaseHeightVariation',
          description: 'Maximum local rise of cloud undersides above the layer base, in meters',
          type: 'float',
          default: 700,
          phase: 2,
          options: {
            group: 'VolumetricClouds',
            label: 'BaseHeightVariation',
            animatable: true,
            minValue: 0,
            maxValue: 2000
          },
          get(this: Scene, value) {
            value.num[0] = this.env.sky.volumetricCloud.baseHeightVariation;
          },
          set(this: Scene, value) {
            this.env.sky.volumetricCloud.baseHeightVariation = value.num[0];
          },
          isValid(this: Scene) {
            return this.env.sky.skyType === 'scatter' && this.env.sky.cloudMode === 'volumetric';
          }
        },
        {
          name: 'VolumetricCloudCoverage',
          description: 'Weather coverage: higher grows cloud fields; zero removes all clouds',
          type: 'float',
          default: 0.45,
          phase: 2,
          options: {
            group: 'VolumetricClouds',
            label: 'Coverage',
            animatable: true,
            minValue: 0,
            maxValue: 1
          },
          get(this: Scene, value) {
            value.num[0] = this.env.sky.volumetricCloud.coverage;
          },
          set(this: Scene, value) {
            this.env.sky.volumetricCloud.coverage = value.num[0];
          },
          isValid(this: Scene) {
            return this.env.sky.skyType === 'scatter' && this.env.sky.cloudMode === 'volumetric';
          }
        },
        {
          name: 'VolumetricCloudDensity',
          description: 'Makes clouds more opaque and their shadowed sides darker',
          type: 'float',
          default: 0.03,
          phase: 2,
          options: {
            group: 'VolumetricClouds',
            label: 'Density',
            animatable: true,
            minValue: 0,
            maxValue: 0.5
          },
          get(this: Scene, value) {
            value.num[0] = this.env.sky.volumetricCloud.density;
          },
          set(this: Scene, value) {
            this.env.sky.volumetricCloud.density = value.num[0];
          },
          isValid(this: Scene) {
            return this.env.sky.skyType === 'scatter' && this.env.sky.cloudMode === 'volumetric';
          }
        },
        {
          name: 'VolumetricCloudWeatherMapScale',
          description:
            'Spreads cloud fields wider apart; lower packs more, smaller cloud fields into the sky',
          type: 'float',
          default: 64000,
          phase: 2,
          options: {
            group: 'VolumetricClouds',
            label: 'WeatherMapScale',
            animatable: true,
            minValue: 1000,
            maxValue: 500000
          },
          get(this: Scene, value) {
            value.num[0] = this.env.sky.volumetricCloud.weatherMapScale;
          },
          set(this: Scene, value) {
            this.env.sky.volumetricCloud.weatherMapScale = value.num[0];
          },
          isValid(this: Scene) {
            return this.env.sky.skyType === 'scatter' && this.env.sky.cloudMode === 'volumetric';
          }
        },
        {
          name: 'VolumetricCloudBaseNoiseScale',
          description: 'Size of the large billows that shape each cloud',
          type: 'float',
          default: 12000,
          phase: 2,
          options: {
            group: 'VolumetricClouds',
            label: 'BaseNoiseScale',
            animatable: true,
            minValue: 100,
            maxValue: 100000
          },
          get(this: Scene, value) {
            value.num[0] = this.env.sky.volumetricCloud.baseNoiseScale;
          },
          set(this: Scene, value) {
            this.env.sky.volumetricCloud.baseNoiseScale = value.num[0];
          },
          isValid(this: Scene) {
            return this.env.sky.skyType === 'scatter' && this.env.sky.cloudMode === 'volumetric';
          }
        },
        {
          name: 'VolumetricCloudShapeStrength',
          description:
            'Strength of the large noise billows; lower keeps cloud bodies fuller and more connected',
          type: 'float',
          default: 1,
          phase: 2,
          options: {
            group: 'VolumetricClouds',
            label: 'ShapeStrength',
            animatable: true,
            minValue: 0,
            maxValue: 1
          },
          get(this: Scene, value) {
            value.num[0] = this.env.sky.volumetricCloud.shapeStrength;
          },
          set(this: Scene, value) {
            this.env.sky.volumetricCloud.shapeStrength = value.num[0];
          },
          isValid(this: Scene) {
            return this.env.sky.skyType === 'scatter' && this.env.sky.cloudMode === 'volumetric';
          }
        },
        {
          name: 'VolumetricCloudDetailNoiseScale',
          description: 'Size of the small wisps along cloud edges',
          type: 'float',
          default: 1000,
          phase: 2,
          options: {
            group: 'VolumetricClouds',
            label: 'DetailNoiseScale',
            animatable: true,
            minValue: 10,
            maxValue: 10000
          },
          get(this: Scene, value) {
            value.num[0] = this.env.sky.volumetricCloud.detailNoiseScale;
          },
          set(this: Scene, value) {
            this.env.sky.volumetricCloud.detailNoiseScale = value.num[0];
          },
          isValid(this: Scene) {
            return this.env.sky.skyType === 'scatter' && this.env.sky.cloudMode === 'volumetric';
          }
        },
        {
          name: 'VolumetricCloudFormation',
          description:
            'Isolated: separate island-like clouds with persistent gaps. Connected: cloud fields that merge as Coverage rises',
          type: 'string',
          default: 'isolated',
          phase: 2,
          options: {
            group: 'VolumetricClouds',
            label: 'Formation',
            enum: { labels: ['Isolated', 'Connected'], values: ['isolated', 'connected'] }
          },
          get(this: Scene, value) {
            value.str[0] = this.env.sky.volumetricCloud.formation;
          },
          set(this: Scene, value) {
            this.env.sky.volumetricCloud.formation = value.str[0] as CloudFormation;
          },
          isValid(this: Scene) {
            return this.env.sky.skyType === 'scatter' && this.env.sky.cloudMode === 'volumetric';
          }
        },
        {
          name: 'VolumetricCloudAnvilBias',
          description: 'Spreads the tops of tall clouds out into anvils',
          type: 'float',
          default: 0,
          phase: 2,
          options: {
            group: 'VolumetricClouds',
            label: 'AnvilBias',
            animatable: true,
            minValue: 0,
            maxValue: 1
          },
          get(this: Scene, value) {
            value.num[0] = this.env.sky.volumetricCloud.anvilBias;
          },
          set(this: Scene, value) {
            this.env.sky.volumetricCloud.anvilBias = value.num[0];
          },
          isValid(this: Scene) {
            return this.env.sky.skyType === 'scatter' && this.env.sky.cloudMode === 'volumetric';
          }
        },
        {
          name: 'VolumetricCloudDetailErosion',
          description: 'Higher gives raggeder, wispier cloud edges',
          type: 'float',
          default: 0.25,
          phase: 2,
          options: {
            group: 'VolumetricClouds',
            label: 'DetailErosion',
            animatable: true,
            minValue: 0,
            maxValue: 1
          },
          get(this: Scene, value) {
            value.num[0] = this.env.sky.volumetricCloud.detailErosion;
          },
          set(this: Scene, value) {
            this.env.sky.volumetricCloud.detailErosion = value.num[0];
          },
          isValid(this: Scene) {
            return this.env.sky.skyType === 'scatter' && this.env.sky.cloudMode === 'volumetric';
          }
        },
        {
          name: 'VolumetricCloudDetailBottomErosion',
          description:
            'Detail erosion at the cloud base relative to the full amount; lower keeps the base flatter',
          type: 'float',
          default: 0.1,
          phase: 2,
          options: {
            group: 'VolumetricClouds',
            label: 'DetailBottomErosion',
            animatable: true,
            minValue: 0,
            maxValue: 1
          },
          get(this: Scene, value) {
            value.num[0] = this.env.sky.volumetricCloud.detailBottomErosion;
          },
          set(this: Scene, value) {
            this.env.sky.volumetricCloud.detailBottomErosion = value.num[0];
          },
          isValid(this: Scene) {
            return this.env.sky.skyType === 'scatter' && this.env.sky.cloudMode === 'volumetric';
          }
        },
        {
          name: 'VolumetricCloudPhaseG',
          description: 'Tightens and brightens the silver lining around the sun',
          type: 'float',
          default: 0.8,
          phase: 2,
          options: {
            group: 'VolumetricClouds',
            label: 'PhaseG',
            animatable: true,
            minValue: -0.999,
            maxValue: 0.999
          },
          get(this: Scene, value) {
            value.num[0] = this.env.sky.volumetricCloud.phaseG;
          },
          set(this: Scene, value) {
            this.env.sky.volumetricCloud.phaseG = value.num[0];
          },
          isValid(this: Scene) {
            return this.env.sky.skyType === 'scatter' && this.env.sky.cloudMode === 'volumetric';
          }
        },
        {
          name: 'VolumetricCloudPhaseG2',
          description: 'Negative values brighten clouds when looking away from the sun',
          type: 'float',
          default: -0.3,
          phase: 2,
          options: {
            group: 'VolumetricClouds',
            label: 'PhaseG2',
            animatable: true,
            minValue: -0.999,
            maxValue: 0.999
          },
          get(this: Scene, value) {
            value.num[0] = this.env.sky.volumetricCloud.phaseG2;
          },
          set(this: Scene, value) {
            this.env.sky.volumetricCloud.phaseG2 = value.num[0];
          },
          isValid(this: Scene) {
            return this.env.sky.skyType === 'scatter' && this.env.sky.cloudMode === 'volumetric';
          }
        },
        {
          name: 'VolumetricCloudPhaseBlend',
          description: 'Moves the look from the sun-facing lobe (0) to the second lobe (1)',
          type: 'float',
          default: 0.5,
          phase: 2,
          options: {
            group: 'VolumetricClouds',
            label: 'PhaseBlend',
            animatable: true,
            minValue: 0,
            maxValue: 1
          },
          get(this: Scene, value) {
            value.num[0] = this.env.sky.volumetricCloud.phaseBlend;
          },
          set(this: Scene, value) {
            this.env.sky.volumetricCloud.phaseBlend = value.num[0];
          },
          isValid(this: Scene) {
            return this.env.sky.skyType === 'scatter' && this.env.sky.cloudMode === 'volumetric';
          }
        },
        {
          name: 'VolumetricCloudMultiScatteringOctaves',
          description: 'More bounces make thick clouds glow brighter and softer',
          type: 'int',
          default: 2,
          phase: 2,
          options: {
            group: 'VolumetricClouds',
            label: 'MultiScatteringOctaves',
            animatable: true,
            minValue: 0,
            maxValue: 2
          },
          get(this: Scene, value) {
            value.num[0] = this.env.sky.volumetricCloud.msOctaves;
          },
          set(this: Scene, value) {
            this.env.sky.volumetricCloud.msOctaves = value.num[0];
          },
          isValid(this: Scene) {
            return this.env.sky.skyType === 'scatter' && this.env.sky.cloudMode === 'volumetric';
          }
        },
        {
          name: 'VolumetricCloudMultiScatteringContribution',
          description: 'Brightness of the bounced light inside clouds',
          type: 'float',
          default: 0.5,
          phase: 2,
          options: {
            group: 'VolumetricClouds',
            label: 'MultiScatteringContribution',
            animatable: true,
            minValue: 0,
            maxValue: 1
          },
          get(this: Scene, value) {
            value.num[0] = this.env.sky.volumetricCloud.msContribution;
          },
          set(this: Scene, value) {
            this.env.sky.volumetricCloud.msContribution = value.num[0];
          },
          isValid(this: Scene) {
            return this.env.sky.skyType === 'scatter' && this.env.sky.cloudMode === 'volumetric';
          }
        },
        {
          name: 'VolumetricCloudMultiScatteringOcclusion',
          description: 'Lower lets bounced light reach deeper into thick clouds',
          type: 'float',
          default: 0.5,
          phase: 2,
          options: {
            group: 'VolumetricClouds',
            label: 'MultiScatteringOcclusion',
            animatable: true,
            minValue: 0,
            maxValue: 1
          },
          get(this: Scene, value) {
            value.num[0] = this.env.sky.volumetricCloud.msOcclusion;
          },
          set(this: Scene, value) {
            this.env.sky.volumetricCloud.msOcclusion = value.num[0];
          },
          isValid(this: Scene) {
            return this.env.sky.skyType === 'scatter' && this.env.sky.cloudMode === 'volumetric';
          }
        },
        {
          name: 'VolumetricCloudMultiScatteringEccentricity',
          description: 'Lower spreads bounced light evenly instead of around the sun',
          type: 'float',
          default: 0.5,
          phase: 2,
          options: {
            group: 'VolumetricClouds',
            label: 'MultiScatteringEccentricity',
            animatable: true,
            minValue: 0,
            maxValue: 1
          },
          get(this: Scene, value) {
            value.num[0] = this.env.sky.volumetricCloud.msEccentricity;
          },
          set(this: Scene, value) {
            this.env.sky.volumetricCloud.msEccentricity = value.num[0];
          },
          isValid(this: Scene) {
            return this.env.sky.skyType === 'scatter' && this.env.sky.cloudMode === 'volumetric';
          }
        },
        {
          name: 'VolumetricCloudGroundAlbedo',
          description: 'Brightens cloud undersides with light bounced off the ground',
          type: 'float',
          default: 0.4,
          phase: 2,
          options: {
            group: 'VolumetricClouds',
            label: 'GroundAlbedo',
            animatable: true,
            minValue: 0,
            maxValue: 1
          },
          get(this: Scene, value) {
            value.num[0] = this.env.sky.volumetricCloud.groundAlbedo;
          },
          set(this: Scene, value) {
            this.env.sky.volumetricCloud.groundAlbedo = value.num[0];
          },
          isValid(this: Scene) {
            return this.env.sky.skyType === 'scatter' && this.env.sky.cloudMode === 'volumetric';
          }
        },
        {
          name: 'VolumetricCloudSkyLightBottomOcclusion',
          description: 'Darkens the sky light on cloud undersides',
          type: 'float',
          default: 0.5,
          phase: 2,
          options: {
            group: 'VolumetricClouds',
            label: 'SkyLightBottomOcclusion',
            animatable: true,
            minValue: 0,
            maxValue: 1
          },
          get(this: Scene, value) {
            value.num[0] = this.env.sky.volumetricCloud.skyLightCloudBottomOcclusion;
          },
          set(this: Scene, value) {
            this.env.sky.volumetricCloud.skyLightCloudBottomOcclusion = value.num[0];
          },
          isValid(this: Scene) {
            return this.env.sky.skyType === 'scatter' && this.env.sky.cloudMode === 'volumetric';
          }
        },
        {
          name: 'VolumetricCloudTracingMaxDistance',
          description: 'How far into the layer clouds are still drawn; lower drops distant clouds',
          type: 'float',
          default: 50000,
          phase: 2,
          options: {
            group: 'VolumetricClouds',
            label: 'TracingMaxDistance',
            animatable: true,
            minValue: 1000,
            maxValue: 500000
          },
          get(this: Scene, value) {
            value.num[0] = this.env.sky.volumetricCloud.tracingMaxDistance;
          },
          set(this: Scene, value) {
            this.env.sky.volumetricCloud.tracingMaxDistance = value.num[0];
          },
          isValid(this: Scene) {
            return this.env.sky.skyType === 'scatter' && this.env.sky.cloudMode === 'volumetric';
          }
        },
        {
          name: 'VolumetricCloudViewSampleCountScale',
          description: 'Finer cloud detail at a higher cost',
          type: 'float',
          default: 2,
          phase: 2,
          options: {
            group: 'VolumetricClouds',
            label: 'ViewSampleCountScale',
            animatable: true,
            minValue: 0.05,
            maxValue: 8
          },
          get(this: Scene, value) {
            value.num[0] = this.env.sky.volumetricCloud.viewSampleCountScale;
          },
          set(this: Scene, value) {
            this.env.sky.volumetricCloud.viewSampleCountScale = value.num[0];
          },
          isValid(this: Scene) {
            return this.env.sky.skyType === 'scatter' && this.env.sky.cloudMode === 'volumetric';
          }
        },
        {
          name: 'VolumetricCloudShadowSampleCountScale',
          description: 'Smoother self-shadowing inside clouds at a higher cost',
          type: 'float',
          default: 1,
          phase: 2,
          options: {
            group: 'VolumetricClouds',
            label: 'ShadowSampleCountScale',
            animatable: true,
            minValue: 0.05,
            maxValue: 8
          },
          get(this: Scene, value) {
            value.num[0] = this.env.sky.volumetricCloud.shadowSampleCountScale;
          },
          set(this: Scene, value) {
            this.env.sky.volumetricCloud.shadowSampleCountScale = value.num[0];
          },
          isValid(this: Scene) {
            return this.env.sky.skyType === 'scatter' && this.env.sky.cloudMode === 'volumetric';
          }
        },
        {
          name: 'VolumetricCloudShadowTracingDistance',
          description: 'How far towards the sun clouds look for cloud that shades them',
          type: 'float',
          default: 15000,
          phase: 2,
          options: {
            group: 'VolumetricClouds',
            label: 'ShadowTracingDistance',
            animatable: true,
            minValue: 100,
            maxValue: 50000
          },
          get(this: Scene, value) {
            value.num[0] = this.env.sky.volumetricCloud.shadowTracingDistance;
          },
          set(this: Scene, value) {
            this.env.sky.volumetricCloud.shadowTracingDistance = value.num[0];
          },
          isValid(this: Scene) {
            return this.env.sky.skyType === 'scatter' && this.env.sky.cloudMode === 'volumetric';
          }
        },
        {
          name: 'VolumetricCloudStopTracingTransmittance',
          description: 'Lower is slightly more exact behind dense clouds but slower',
          type: 'float',
          default: 0.005,
          phase: 2,
          options: {
            group: 'VolumetricClouds',
            label: 'StopTracingTransmittance',
            animatable: true,
            minValue: 0,
            maxValue: 1
          },
          get(this: Scene, value) {
            value.num[0] = this.env.sky.volumetricCloud.stopTracingTransmittanceThreshold;
          },
          set(this: Scene, value) {
            this.env.sky.volumetricCloud.stopTracingTransmittanceThreshold = value.num[0];
          },
          isValid(this: Scene) {
            return this.env.sky.skyType === 'scatter' && this.env.sky.cloudMode === 'volumetric';
          }
        },
        {
          name: 'VolumetricCloudNoiseSeed',
          description: 'Picks a different generated cloud pattern',
          type: 'int',
          default: 0,
          phase: 2,
          options: {
            group: 'VolumetricClouds',
            label: 'NoiseSeed',
            animatable: true,
            minValue: 0,
            maxValue: 1000
          },
          get(this: Scene, value) {
            value.num[0] = this.env.sky.volumetricCloud.noiseSeed;
          },
          set(this: Scene, value) {
            this.env.sky.volumetricCloud.noiseSeed = value.num[0];
          },
          isValid(this: Scene) {
            return this.env.sky.skyType === 'scatter' && this.env.sky.cloudMode === 'volumetric';
          }
        },
        {
          name: 'VolumetricCloudFramesPerUpdate',
          description: 'Fewer frames let clouds and sunlight change faster but cost more per frame',
          type: 'int',
          default: 64,
          phase: 2,
          options: {
            group: 'VolumetricClouds',
            label: 'FramesPerUpdate',
            animatable: true,
            minValue: 4,
            maxValue: 256
          },
          get(this: Scene, value) {
            value.num[0] = this.env.sky.volumetricCloud.framesPerUpdate;
          },
          set(this: Scene, value) {
            this.env.sky.volumetricCloud.framesPerUpdate = value.num[0];
          },
          isValid(this: Scene) {
            return this.env.sky.skyType === 'scatter' && this.env.sky.cloudMode === 'volumetric';
          }
        },
        {
          name: 'VolumetricCloudCacheResolution',
          description: 'Keeps clouds sharp at narrow fields of view at a higher memory cost',
          type: 'int',
          default: 768,
          phase: 2,
          options: {
            group: 'VolumetricClouds',
            label: 'CacheResolution',
            animatable: true,
            minValue: 128,
            maxValue: 2048
          },
          get(this: Scene, value) {
            value.num[0] = this.env.sky.volumetricCloud.cacheResolution;
          },
          set(this: Scene, value) {
            this.env.sky.volumetricCloud.cacheResolution = value.num[0];
          },
          isValid(this: Scene) {
            return this.env.sky.skyType === 'scatter' && this.env.sky.cloudMode === 'volumetric';
          }
        },
        {
          name: 'VolumetricCloudPerSampleSunTransmittance',
          description:
            'Reddens the sunlight inside clouds by the air between each point and the sun; matters most at sunrise and sunset',
          type: 'bool',
          default: false,
          phase: 2,
          options: { group: 'VolumetricClouds', label: 'PerSampleSunTransmittance' },
          get(this: Scene, value) {
            value.bool[0] = this.env.sky.volumetricCloud.perSampleAtmosphericLightTransmittance;
          },
          set(this: Scene, value) {
            this.env.sky.volumetricCloud.perSampleAtmosphericLightTransmittance = value.bool[0];
          },
          isValid(this: Scene) {
            return this.env.sky.skyType === 'scatter' && this.env.sky.cloudMode === 'volumetric';
          }
        },
        {
          name: 'VolumetricCloudAlbedo',
          description: 'Tint of the light clouds scatter; lower values make clouds greyer',
          type: 'rgb',
          default: [1, 1, 1],
          phase: 2,
          options: { group: 'VolumetricClouds', label: 'Albedo', animatable: true },
          get(this: Scene, value) {
            const c = this.env.sky.volumetricCloud.albedo;
            value.num[0] = c.x;
            value.num[1] = c.y;
            value.num[2] = c.z;
          },
          set(this: Scene, value) {
            this.env.sky.volumetricCloud.albedo = new Vector3(value.num[0], value.num[1], value.num[2]);
          },
          isValid(this: Scene) {
            return this.env.sky.skyType === 'scatter' && this.env.sky.cloudMode === 'volumetric';
          }
        },
        {
          name: 'VolumetricCloudWind',
          description: 'Direction and speed the clouds drift with, in meters per second',
          type: 'vec2',
          default: [10, 0],
          phase: 2,
          options: {
            group: 'VolumetricClouds',
            label: 'Wind',
            animatable: true,
            minValue: -100,
            maxValue: 100
          },
          get(this: Scene, value) {
            const w = this.env.sky.volumetricCloud.wind;
            value.num[0] = w.x;
            value.num[1] = w.y;
          },
          set(this: Scene, value) {
            this.env.sky.volumetricCloud.wind = new Vector2(value.num[0], value.num[1]);
          },
          isValid(this: Scene) {
            return this.env.sky.skyType === 'scatter' && this.env.sky.cloudMode === 'volumetric';
          }
        },
        {
          name: 'VolumetricCloudWeatherMap',
          description:
            'Where clouds form: R Connected footprints, G Isolated footprints (higher values fill first as Coverage rises), B cloud type (0 stratus to 1 cumulus). Empty generates one',
          type: 'object',
          default: null,
          phase: 2,
          options: {
            group: 'VolumetricClouds',
            label: 'WeatherMap',
            mimeTypes: ['image/png', 'image/tga', 'image/webp', 'image/ktx2', 'image/x-dds']
          },
          isNullable() {
            return true;
          },
          get(this: Scene, value) {
            value.str[0] = manager.getAssetId(this.env.sky.cloudWeatherMap) ?? '';
          },
          async set(this: Scene, value) {
            if (!value || !value.str[0]) {
              this.env.sky.cloudWeatherMap = null;
              return;
            }
            let tex: Nullable<Texture2D> = null;
            try {
              // Data, not color: no sRGB decoding
              tex = await manager.fetchTexture<Texture2D>(value.str[0], { linearColorSpace: true });
            } catch (err) {
              console.error(`Load asset failed: ${value.str[0]}: ${err}`);
            }
            if (tex?.isTexture2D()) {
              this.env.sky.cloudWeatherMap = tex;
            } else {
              console.error('Invalid texture type');
            }
          },
          isValid(this: Scene) {
            return this.env.sky.skyType === 'scatter' && this.env.sky.cloudMode === 'volumetric';
          }
        },
        {
          name: 'VolumetricCloudBaseNoise',
          description:
            'Shape of the large billows, as a 2D atlas of the slices of a cubic volume (e.g. 128^3 as 2048x1024). Empty generates one',
          type: 'object',
          default: null,
          phase: 2,
          options: {
            group: 'VolumetricClouds',
            label: 'BaseNoise',
            mimeTypes: ['image/png', 'image/tga', 'image/webp', 'image/ktx2', 'image/x-dds']
          },
          isNullable() {
            return true;
          },
          get(this: Scene, value) {
            value.str[0] = manager.getAssetId(this.env.sky.cloudBaseNoise) ?? '';
          },
          async set(this: Scene, value) {
            if (!value || !value.str[0]) {
              this.env.sky.cloudBaseNoise = null;
              return;
            }
            let tex: Nullable<Texture2D> = null;
            try {
              // Data, not color: no sRGB decoding
              tex = await manager.fetchTexture<Texture2D>(value.str[0], { linearColorSpace: true });
            } catch (err) {
              console.error(`Load asset failed: ${value.str[0]}: ${err}`);
            }
            if (tex?.isTexture2D()) {
              this.env.sky.cloudBaseNoise = tex;
            } else {
              console.error('Invalid texture type');
            }
          },
          isValid(this: Scene) {
            return this.env.sky.skyType === 'scatter' && this.env.sky.cloudMode === 'volumetric';
          }
        },
        {
          name: 'VolumetricCloudDetailNoise',
          description:
            'Shape of the small edge wisps, as a 2D atlas of the slices of a cubic volume (e.g. 32^3 as 256x128). Empty generates one',
          type: 'object',
          default: null,
          phase: 2,
          options: {
            group: 'VolumetricClouds',
            label: 'DetailNoise',
            mimeTypes: ['image/png', 'image/tga', 'image/webp', 'image/ktx2', 'image/x-dds']
          },
          isNullable() {
            return true;
          },
          get(this: Scene, value) {
            value.str[0] = manager.getAssetId(this.env.sky.cloudDetailNoise) ?? '';
          },
          async set(this: Scene, value) {
            if (!value || !value.str[0]) {
              this.env.sky.cloudDetailNoise = null;
              return;
            }
            let tex: Nullable<Texture2D> = null;
            try {
              // Data, not color: no sRGB decoding
              tex = await manager.fetchTexture<Texture2D>(value.str[0], { linearColorSpace: true });
            } catch (err) {
              console.error(`Load asset failed: ${value.str[0]}: ${err}`);
            }
            if (tex?.isTexture2D()) {
              this.env.sky.cloudDetailNoise = tex;
            } else {
              console.error('Invalid texture type');
            }
          },
          isValid(this: Scene) {
            return this.env.sky.skyType === 'scatter' && this.env.sky.cloudMode === 'volumetric';
          }
        },
        {
          name: 'VolumetricCloudDebugView',
          description:
            'Shows a cloud resource, height profile or density section over the sky for inspection',
          type: 'string',
          default: 'none',
          phase: 2,
          options: {
            group: 'VolumetricClouds',
            label: 'DebugView',
            enum: {
              labels: [
                'None',
                'WeatherMap',
                'BaseNoise',
                'DetailNoise',
                'HeightProfileXY',
                'HeightProfileXZ',
                'BaseDensityXY',
                'BaseDensityXZ',
                'DensityXY',
                'DensityXZ'
              ],
              values: [
                'none',
                'weather',
                'baseNoise',
                'detailNoise',
                'profileXY',
                'profileXZ',
                'baseDensityXY',
                'baseDensityXZ',
                'densityXY',
                'densityXZ'
              ]
            }
          },
          get(this: Scene, value) {
            value.str[0] = this.env.sky.cloudDebugView;
          },
          set(this: Scene, value) {
            this.env.sky.cloudDebugView = value.str[0] as VolumetricCloudDebugView;
          },
          isValid(this: Scene) {
            return this.env.sky.skyType === 'scatter' && this.env.sky.cloudMode === 'volumetric';
          }
        },
        {
          name: 'VolumetricCloudDebugSlice',
          description:
            'Noise slice depth, normalized Z of XY sections, or normalized layer height of XZ sections',
          type: 'float',
          default: 0,
          phase: 2,
          options: { group: 'VolumetricClouds', label: 'DebugSlice', minValue: 0, maxValue: 1 },
          get(this: Scene, value) {
            value.num[0] = this.env.sky.cloudDebugSlice;
          },
          set(this: Scene, value) {
            this.env.sky.cloudDebugSlice = value.num[0];
          },
          isValid(this: Scene) {
            return this.env.sky.skyType === 'scatter' && this.env.sky.cloudMode === 'volumetric';
          }
        },
        {
          name: 'VolumetricCloudDebugChannel',
          description: 'Channel shown by DebugView: 0 color, 1-4 R, G, B or A as grey',
          type: 'int',
          default: 0,
          phase: 2,
          options: { group: 'VolumetricClouds', label: 'DebugChannel', minValue: 0, maxValue: 4 },
          get(this: Scene, value) {
            value.num[0] = this.env.sky.cloudDebugChannel;
          },
          set(this: Scene, value) {
            this.env.sky.cloudDebugChannel = value.num[0];
          },
          isValid(this: Scene) {
            return this.env.sky.skyType === 'scatter' && this.env.sky.cloudMode === 'volumetric';
          }
        },
        {
          name: 'Wind',
          description: 'Wind direction and speed used by the procedural sky',
          type: 'vec2',
          default: [0, 0],
          phase: 1,
          options: { animatable: true, minValue: -100, maxValue: 100 },
          get(this: Scene, value) {
            value.num[0] = this.env.sky.wind.x;
            value.num[1] = this.env.sky.wind.y;
          },
          set(this: Scene, value) {
            this.env.sky.wind.setXY(value.num[0], value.num[1]);
          },
          isValid() {
            return this.env.sky.skyType === 'scatter';
          }
        },
        {
          name: 'SkyBoxRotation',
          description: 'Euler rotation of the skybox',
          type: 'vec3',
          default: [0, 0, 0],
          phase: 1,
          options: {
            label: 'Rotation',
            edit: 'quaternion',
            animatable: true
          },
          get(this: Scene, value) {
            value.num[0] = this.env.sky.skyboxRotation.x;
            value.num[1] = this.env.sky.skyboxRotation.y;
            value.num[2] = this.env.sky.skyboxRotation.z;
          },
          set(this: Scene, value) {
            this.env.sky.skyboxRotation = new Vector3(value.num[0], value.num[1], value.num[2]);
          },
          isValid() {
            return this.env.sky.skyType === 'skybox';
          }
        },
        {
          name: 'SkyBoxTextureSize',
          description: 'Skybox cubemap resolution',
          type: 'int',
          default: 1024,
          get(this: Scene, value) {
            value.num[0] = this.env.sky.skyboxTextureSize;
          },
          set(this: Scene, value) {
            this.env.sky.skyboxTextureSize = value.num[0];
          },
          isValid() {
            return this.env.sky.skyType === 'skybox';
          }
        },
        {
          name: 'PanoramaTexture',
          description: 'Panorama texture file path if skyType sets to `skybox`',
          type: 'object',
          phase: 1,
          options: {
            mimeTypes: ['image/vnd.radiance']
          },
          get(this: Scene, value) {
            value.str[0] = this.env.sky.panoramaTextureAsset;
          },
          async set(this: Scene, value) {
            this.env.sky.panoramaTextureAsset = value.str[0];
          },
          isValid() {
            return this.env.sky.skyType === 'skybox';
          }
        },
        {
          name: 'WindFieldDirection',
          description:
            'Compass direction the wind blows toward, in degrees. Grass leans and gusts travel this way',
          type: 'float',
          default: 0,
          options: { group: 'Wind', label: 'Direction', animatable: true, minValue: -180, maxValue: 180 },
          get(this: Scene, value) {
            value.num[0] = this.env.wind.direction;
          },
          set(this: Scene, value) {
            this.env.wind.direction = value.num[0];
          }
        },
        {
          name: 'WindFieldStrength',
          description: 'How hard the wind blows. 0 is still air; higher values bend grass further over',
          type: 'float',
          default: 0.3,
          options: { group: 'Wind', label: 'Strength', animatable: true, minValue: 0, maxValue: 2 },
          get(this: Scene, value) {
            value.num[0] = this.env.wind.strength;
          },
          set(this: Scene, value) {
            this.env.wind.strength = value.num[0];
          }
        },
        {
          name: 'WindFieldSpeed',
          description: 'How fast the gusts sweep across the ground, in units per second',
          type: 'float',
          default: 4,
          options: { group: 'Wind', label: 'GustSpeed', animatable: true, minValue: 0, maxValue: 50 },
          get(this: Scene, value) {
            value.num[0] = this.env.wind.speed;
          },
          set(this: Scene, value) {
            this.env.wind.speed = value.num[0];
          }
        },
        {
          name: 'WindFieldGustStrength',
          description:
            'How strongly gusts come and go. 0 gives a steady wind; higher values make waves of stronger wind roll through fields',
          type: 'float',
          default: 0.6,
          options: { group: 'Wind', label: 'GustStrength', animatable: true, minValue: 0, maxValue: 2 },
          get(this: Scene, value) {
            value.num[0] = this.env.wind.gustStrength;
          },
          set(this: Scene, value) {
            this.env.wind.gustStrength = value.num[0];
          }
        },
        {
          name: 'WindFieldGustScale',
          description: 'Size of a gust on the ground, in units. Larger values give broad, slow-looking waves',
          type: 'float',
          default: 30,
          options: { group: 'Wind', label: 'GustSize', animatable: true, minValue: 0.1, maxValue: 500 },
          get(this: Scene, value) {
            value.num[0] = this.env.wind.gustScale;
          },
          set(this: Scene, value) {
            this.env.wind.gustScale = value.num[0];
          }
        },
        {
          name: 'WindFieldDetailStrength',
          description: 'Amount of small, fast flutter on top of the gusts',
          type: 'float',
          default: 0.25,
          options: { group: 'Wind', label: 'TurbulenceStrength', animatable: true, minValue: 0, maxValue: 2 },
          get(this: Scene, value) {
            value.num[0] = this.env.wind.detailStrength;
          },
          set(this: Scene, value) {
            this.env.wind.detailStrength = value.num[0];
          }
        },
        {
          name: 'WindFieldDetailScale',
          description: 'Size of the small flutter patches, in units',
          type: 'float',
          default: 4,
          options: { group: 'Wind', label: 'TurbulenceSize', animatable: true, minValue: 0.1, maxValue: 100 },
          get(this: Scene, value) {
            value.num[0] = this.env.wind.detailScale;
          },
          set(this: Scene, value) {
            this.env.wind.detailScale = value.num[0];
          }
        },
        {
          name: 'NodeHierarchy',
          description: 'Node tree of this scene',
          type: 'object',
          isHidden() {
            return true;
          },
          get(this: Scene, value) {
            value.object[0] = this.rootNode;
          },
          set(this: Scene, value) {
            const sceneNode = value.object[0] as SceneNode;
            if (sceneNode) {
              sceneNode.remove();
              for (const child of sceneNode.children) {
                child.parent = this.rootNode;
              }
            }
          }
        },
        {
          name: 'MainCamera',
          description: 'Main camera node of this scene',
          type: 'string',
          isHidden() {
            return true;
          },
          get(this: Scene, value) {
            value.str[0] = this.mainCamera?.persistentId ?? '';
          },
          set(this: Scene, value) {
            this.mainCamera = value.str[0] ? this.findNodeById<Camera>(value.str[0]) : null;
          }
        },
        {
          name: 'Script',
          description: 'The first script path which is attached to this scene',
          type: 'object',
          options: {
            mimeTypes: ['text/x-typescript']
          },
          isHidden() {
            return true;
          },
          isNullable() {
            return true;
          },
          get(this: Scene, value) {
            value.str[0] = this.script;
          },
          set(this: Scene, value) {
            this.script = value?.str?.[0] ?? '';
          }
        },
        {
          name: 'Scripts',
          description: 'All scripts paths which are attached to this scene',
          type: 'object_array',
          options: {
            objectTypes: [ScriptAttachment]
          },
          isHidden() {
            return true;
          },
          getDefaultValue(this: Scene) {
            return this.scripts;
          },
          isNullable() {
            return false;
          },
          get(this: Scene, value) {
            value.object = this.scripts;
          },
          set(this: Scene, value) {
            this.scripts = (value.object as ScriptAttachment[]) ?? [];
          },
          create() {
            return new ScriptAttachment();
          },
          add(this: Scene, value, index) {
            const attachments = this.scripts;
            attachments.splice(
              index ?? attachments.length,
              0,
              (value.object?.[0] as ScriptAttachment) ?? new ScriptAttachment()
            );
            this.scripts = attachments;
          },
          delete(this: Scene, index) {
            const attachments = this.scripts;
            if (index >= 0 && index < attachments.length) {
              attachments.splice(index, 1);
              this.scripts = attachments;
            }
          }
        },
        {
          name: 'ScriptConfig',
          description: 'Configuration object passed to the first scene script',
          type: 'object',
          default: null,
          options: { objectTypes: [JSONData, JSONArray] },
          isHidden() {
            return true;
          },
          isNullable() {
            return true;
          },
          isPersistent(this: Scene) {
            return !!this.script;
          },
          get(this: Scene, value) {
            const config = normalizeScriptAttachmentConfig(this.scriptConfig);
            value.object[0] =
              config == null
                ? null
                : Array.isArray(config)
                  ? new JSONArray(null, config)
                  : new JSONData(null, config);
          },
          set(this: Scene, value) {
            const data = value?.object[0] as
              | JSONData
              | JSONArray
              | Record<string, unknown>
              | unknown[]
              | null
              | undefined;
            this.scriptConfig =
              data instanceof JSONData || data instanceof JSONArray
                ? normalizeScriptAttachmentConfig(data.data)
                : normalizeScriptAttachmentConfig(data);
          }
        },
        {
          name: 'ScriptConfigs',
          description: 'Per-script configuration array for all scene scripts',
          type: 'object',
          default: null,
          options: { objectTypes: [JSONArray] },
          getDefaultValue(this: Scene) {
            return this.scriptConfigs;
          },
          isHidden() {
            return true;
          },
          isNullable() {
            return true;
          },
          isPersistent(this: Scene) {
            return this.scripts.length > 0;
          },
          get(this: Scene, value) {
            value.object[0] = this.scriptConfigs.length > 0 ? new JSONArray(null, this.scriptConfigs) : null;
          },
          set(this: Scene, value) {
            const data = value?.object[0] as JSONArray | unknown[] | null | undefined;
            this.scriptConfigs = data instanceof JSONArray ? data.data : Array.isArray(data) ? data : [];
          }
        },
        {
          name: 'Physics',
          description:
            'Gravity, step rate and collision layers used when the scene is simulated with physics; leave empty for defaults',
          type: 'object',
          default: null,
          options: { objectTypes: [ScenePhysicsSettings] },
          isNullable() {
            return true;
          },
          get(this: Scene, value) {
            value.object[0] = this.physicsSettings;
          },
          set(this: Scene, value) {
            const settings = value?.object[0];
            this.physicsSettings = settings instanceof ScenePhysicsSettings ? settings : null;
          }
        },
        {
          name: 'Metadata',
          description: 'Meta data for this scene',
          type: 'object',
          default: null,
          options: { objectTypes: [JSONData, JSONArray] },
          isNullable() {
            return true;
          },
          get(this: Scene, value) {
            value.object[0] = this.metaData
              ? Array.isArray(this.metaData)
                ? new JSONArray(null, this.metaData)
                : new JSONData(null, this.metaData)
              : null;
          },
          set(this: Scene, value) {
            const data = value?.object[0] as
              | JSONData
              | JSONArray
              | Record<string, unknown>
              | unknown[]
              | null
              | undefined;
            this.metaData =
              data instanceof JSONData || data instanceof JSONArray ? data.data : (data ?? null);
          }
        }
      ]);
    }
  };
}
