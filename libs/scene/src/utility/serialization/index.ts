import { Camera, OrthoCamera, PerspectiveCamera } from '../../camera';
import {
  BlinnMaterial,
  LambertMaterial,
  PBRMetallicRoughnessMaterial,
  PBRSpecularGlossinessMaterial,
  UnlitMaterial
} from '../../material';
import {
  BatchGroup,
  DirectionalLight,
  GraphNode,
  Mesh,
  ParticleSystem,
  PointLight,
  PunctualLight,
  Scene,
  SceneNode,
  SpotLight
} from '../../scene';
import type { AssetRegistry } from './asset/asset';
import { getBatchGroupClass } from './scene/batch';
import { getCameraClass, getOrthoCameraClass, getPerspectiveCameraClass } from './scene/camera';
import {
  getDirectionalLightClass,
  getPointLightClass,
  getPunctualLightClass,
  getSpotLightClass
} from './scene/light';
import {
  getBlinnMaterialClass,
  getLambertMaterialClass,
  getPBRMetallicRoughnessMaterialClass,
  getPBRSpecularGlossinessMaterialClass,
  getUnlitMaterialClass
} from './scene/material';
import { getMeshClass } from './scene/mesh';
import { getGraphNodeClass, getSceneNodeClass } from './scene/node';
import { getParticleNodeClass } from './scene/particle';
import { getSceneClass } from './scene/scene';
import type { SerializableClass } from './types';

export * from './asset/asset';
export * from './scene/batch';
export * from './scene/camera';
export * from './scene/light';
export * from './scene/mesh';
export * from './scene/node';
export * from './scene/particle';
export * from './types';
export * from './serializer';

export function getSerializationInfo(assetRegistry: AssetRegistry) {
  return new Map<any, SerializableClass<any>>([
    [SceneNode, getSceneNodeClass()],
    [GraphNode, getGraphNodeClass()],
    [Mesh, getMeshClass()],
    [ParticleSystem, getParticleNodeClass()],
    [PunctualLight, getPunctualLightClass()],
    [DirectionalLight, getDirectionalLightClass()],
    [SpotLight, getSpotLightClass()],
    [PointLight, getPointLightClass()],
    [Camera, getCameraClass()],
    [PerspectiveCamera, getPerspectiveCameraClass()],
    [OrthoCamera, getOrthoCameraClass()],
    [BatchGroup, getBatchGroupClass()],
    [Scene, getSceneClass(assetRegistry)],
    [UnlitMaterial, getUnlitMaterialClass(assetRegistry)],
    [LambertMaterial, getLambertMaterialClass(assetRegistry)],
    [BlinnMaterial, getBlinnMaterialClass(assetRegistry)],
    [PBRMetallicRoughnessMaterial, getPBRMetallicRoughnessMaterialClass(assetRegistry)],
    [PBRSpecularGlossinessMaterial, getPBRSpecularGlossinessMaterialClass(assetRegistry)]
  ]);
}
