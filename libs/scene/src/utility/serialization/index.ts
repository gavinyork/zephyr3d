import { Camera, OrthoCamera, PerspectiveCamera } from '../../camera';
import {
  BatchGroup,
  DirectionalLight,
  GraphNode,
  Mesh,
  ParticleSystem,
  PointLight,
  SceneNode,
  SpotLight
} from '../../scene';
import { batchGroupClass } from './scene/batch';
import { cameraClass, orthographicCameraClass, perspectiveCameraClass } from './scene/camera';
import { directionalLightClass, pointLightClass, spotLightClass } from './scene/light';
import { meshNodeClass } from './scene/mesh';
import { graphNodeClass, sceneNodeClass } from './scene/node';
import { particleNodeClass } from './scene/particle';
import type { SerializableClass } from './types';

export * from './scene/batch';
export * from './scene/camera';
export * from './scene/light';
export * from './scene/mesh';
export * from './scene/node';
export * from './scene/particle';
export * from './types';
export * from './serializer';

const nodeSerializationInfo = new Map<any, SerializableClass<SceneNode>>([
  [SceneNode, sceneNodeClass],
  [GraphNode, graphNodeClass],
  [Mesh, meshNodeClass],
  [ParticleSystem, particleNodeClass],
  [DirectionalLight, directionalLightClass],
  [SpotLight, spotLightClass],
  [PointLight, pointLightClass],
  [Camera, cameraClass],
  [PerspectiveCamera, perspectiveCameraClass],
  [OrthoCamera, orthographicCameraClass],
  [BatchGroup, batchGroupClass]
]);

export { nodeSerializationInfo };
