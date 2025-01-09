import { Camera, OrthoCamera, PerspectiveCamera } from '../../camera';
import {
  BlinnMaterial,
  LambertMaterial,
  PBRMetallicRoughnessMaterial,
  PBRSpecularGlossinessMaterial,
  UnlitMaterial
} from '../../material';
import { Primitive } from '../../render';
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
import { BoxFrameShape, BoxShape, CylinderShape, PlaneShape, SphereShape, TorusShape } from '../../shapes';
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
import {
  getBoxFrameShapeClass,
  getBoxShapeClass,
  getCylinderShapeClass,
  getPlaneShapeClass,
  getPrimitiveClass,
  getSphereShapeClass,
  getTorusShapeClass
} from './scene/primitive';
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
  return new Map<any, SerializableClass>([
    [SceneNode, getSceneNodeClass(assetRegistry)],
    [GraphNode, getGraphNodeClass(assetRegistry)],
    [Mesh, getMeshClass(assetRegistry)],
    [ParticleSystem, getParticleNodeClass(assetRegistry)],
    [PunctualLight, getPunctualLightClass(assetRegistry)],
    [DirectionalLight, getDirectionalLightClass(assetRegistry)],
    [SpotLight, getSpotLightClass(assetRegistry)],
    [PointLight, getPointLightClass(assetRegistry)],
    [Camera, getCameraClass(assetRegistry)],
    [PerspectiveCamera, getPerspectiveCameraClass(assetRegistry)],
    [OrthoCamera, getOrthoCameraClass(assetRegistry)],
    [BatchGroup, getBatchGroupClass(assetRegistry)],
    [Scene, getSceneClass(assetRegistry)],
    [UnlitMaterial, getUnlitMaterialClass(assetRegistry)],
    [LambertMaterial, getLambertMaterialClass(assetRegistry)],
    [BlinnMaterial, getBlinnMaterialClass(assetRegistry)],
    [PBRMetallicRoughnessMaterial, getPBRMetallicRoughnessMaterialClass(assetRegistry)],
    [PBRSpecularGlossinessMaterial, getPBRSpecularGlossinessMaterialClass(assetRegistry)],
    [Primitive, getPrimitiveClass(assetRegistry)],
    [BoxShape, getBoxShapeClass(assetRegistry)],
    [BoxFrameShape, getBoxFrameShapeClass(assetRegistry)],
    [SphereShape, getSphereShapeClass(assetRegistry)],
    [TorusShape, getTorusShapeClass(assetRegistry)],
    [CylinderShape, getCylinderShapeClass(assetRegistry)],
    [PlaneShape, getPlaneShapeClass(assetRegistry)]
  ]);
}
