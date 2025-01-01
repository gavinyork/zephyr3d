import { Camera, OrthoCamera, PerspectiveCamera } from '../../camera';
import {
  BatchGroup,
  DirectionalLight,
  GraphNode,
  Mesh,
  ParticleSystem,
  PointLight,
  PunctualLight,
  SceneNode,
  SpotLight
} from '../../scene';
import { AssetRegistry } from './asset/asset';
import { getBatchGroupClass } from './scene/batch';
import { getCameraClass, getOrthoCameraClass, getPerspectiveCameraClass } from './scene/camera';
import {
  getDirectionalLightClass,
  getPointLightClass,
  getPunctualLightClass,
  getSpotLightClass
} from './scene/light';
import { getMeshClass } from './scene/mesh';
import { getGraphNodeClass, getSceneNodeClass } from './scene/node';
import { getParticleNodeClass } from './scene/particle';
import type { SerializableClass } from './types';

export * from './scene/batch';
export * from './scene/camera';
export * from './scene/light';
export * from './scene/mesh';
export * from './scene/node';
export * from './scene/particle';
export * from './types';
export * from './serializer';

export function getNodeSerializationInfo(assetRegistry: AssetRegistry) {
  return new Map<any, SerializableClass<SceneNode>>([
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
    [BatchGroup, getBatchGroupClass()]
  ]);
}
