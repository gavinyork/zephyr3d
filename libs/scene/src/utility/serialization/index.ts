import { Camera, OrthoCamera, PerspectiveCamera } from '../../camera';
import {
  BlinnMaterial,
  LambertMaterial,
  MeshMaterial,
  ParticleMaterial,
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
  getMeshMaterialClass,
  getParticleMaterialClass,
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
import type { PropertyValue, SerializableClass } from './types';

export * from './asset/asset';
export * from './scene/batch';
export * from './scene/camera';
export * from './scene/light';
export * from './scene/mesh';
export * from './scene/node';
export * from './scene/particle';
export * from './types';

const serializationInfoCache: WeakMap<AssetRegistry, Map<any, SerializableClass>> = new WeakMap();

export function getSerializationInfo(assetRegistry: AssetRegistry) {
  let info = serializationInfoCache.get(assetRegistry);
  if (!info) {
    info = new Map<any, SerializableClass>([
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
      [MeshMaterial, getMeshMaterialClass()],
      [UnlitMaterial, getUnlitMaterialClass(assetRegistry)],
      [LambertMaterial, getLambertMaterialClass(assetRegistry)],
      [BlinnMaterial, getBlinnMaterialClass(assetRegistry)],
      [PBRMetallicRoughnessMaterial, getPBRMetallicRoughnessMaterialClass(assetRegistry)],
      [PBRSpecularGlossinessMaterial, getPBRSpecularGlossinessMaterialClass(assetRegistry)],
      [ParticleMaterial, getParticleMaterialClass(assetRegistry)],
      [Primitive, getPrimitiveClass()],
      [BoxShape, getBoxShapeClass()],
      [BoxFrameShape, getBoxFrameShapeClass()],
      [SphereShape, getSphereShapeClass()],
      [TorusShape, getTorusShapeClass()],
      [CylinderShape, getCylinderShapeClass()],
      [PlaneShape, getPlaneShapeClass()]
    ]);
    serializationInfoCache.set(assetRegistry, info);
  }
  return info;
}

export async function deserializeObjectProps<T>(
  obj: T,
  cls: SerializableClass,
  json: object,
  assetRegistry: AssetRegistry
) {
  const props = (cls.getProps(obj) ?? []).sort((a, b) => (a.phase ?? 0) - (b.phase ?? 0));
  let currentPhase: number = undefined;
  const promises: Promise<void>[] = [];
  for (const prop of props) {
    if (!prop.set) {
      continue;
    }
    const phase = prop.phase ?? 0;
    if (phase !== currentPhase) {
      currentPhase = phase;
      if (promises.length > 0) {
        await Promise.all(promises);
      }
    }
    const tmpVal: PropertyValue = {
      num: [0, 0, 0, 0],
      str: [''],
      bool: [false],
      object: [null]
    };
    const k = prop.name;
    const v = json[k];
    switch (prop.type) {
      case 'object':
        if (typeof v === 'string' && v) {
          tmpVal.str[0] = v;
        } else {
          tmpVal.object[0] = v ? (await deserializeObject<any>(obj, v, assetRegistry)) ?? null : null;
        }
        break;
      case 'object_array':
        tmpVal.object = [];
        if (Array.isArray(v)) {
          for (const p of v) {
            if (typeof p === 'string' && p) {
              tmpVal.str[0] = p;
            } else {
              tmpVal.object.push(p ? (await deserializeObject<any>(obj, p, assetRegistry)) ?? null : null);
            }
          }
        }
        break;
      case 'float':
      case 'int': {
        tmpVal.num[0] = v ?? prop.default?.num[0] ?? 0;
        break;
      }
      case 'string': {
        tmpVal.str[0] = v ?? prop.default?.str[0] ?? '';
        break;
      }
      case 'bool': {
        tmpVal.bool[0] = v ?? prop.default?.bool[0] ?? false;
        break;
      }
      case 'vec2': {
        tmpVal.num[0] = v ? v[0] : prop.default?.num[0] ?? 0;
        tmpVal.num[1] = v ? v[1] : prop.default?.num[1] ?? 0;
        break;
      }
      case 'vec3':
      case 'rgb': {
        tmpVal.num[0] = v ? v[0] : prop.default?.num[0] ?? 0;
        tmpVal.num[1] = v ? v[1] : prop.default?.num[1] ?? 0;
        tmpVal.num[2] = v ? v[2] : prop.default?.num[2] ?? 0;
        break;
      }
      case 'vec4':
      case 'rgba': {
        tmpVal.num[0] = v ? v[0] : prop.default?.num[0] ?? 0;
        tmpVal.num[1] = v ? v[1] : prop.default?.num[1] ?? 0;
        tmpVal.num[2] = v ? v[2] : prop.default?.num[2] ?? 0;
        tmpVal.num[3] = v ? v[3] : prop.default?.num[3] ?? 0;
        break;
      }
    }
    promises.push(Promise.resolve(prop.set.call(obj, tmpVal)));
  }
  if (promises.length > 0) {
    await Promise.all(promises);
  }
}

export function serializeObjectProps<T>(
  obj: T,
  cls: SerializableClass,
  json: object,
  assetRegistry: AssetRegistry,
  assetList?: Set<string>
) {
  const props = cls.getProps(obj) ?? [];
  for (const prop of props) {
    const tmpVal: PropertyValue = {
      num: [0, 0, 0, 0],
      str: [''],
      bool: [false],
      object: [null]
    };
    const k = prop.name;
    prop.get.call(obj, tmpVal);
    switch (prop.type) {
      case 'object':
        json[k] =
          typeof tmpVal.str[0] === 'string' && tmpVal.str[0]
            ? tmpVal.str[0]
            : tmpVal.object[0]
            ? serializeObject(tmpVal.object[0], assetRegistry, {}, assetList)
            : null;
        if (assetList && typeof json[k] === 'string' && assetRegistry.getAssetInfo(json[k])) {
          assetList.add(json[k]);
        }
        break;
      case 'object_array':
        json[k] = [];
        for (const p of tmpVal.object) {
          json[k].push(serializeObject(p, assetRegistry, {}, assetList));
        }
        break;
      case 'float':
      case 'int': {
        if (!prop.default || prop.default.num[0] !== tmpVal.num[0]) {
          json[k] = tmpVal.num[0];
        }
        break;
      }
      case 'string': {
        if (!prop.default || prop.default.str[0] !== tmpVal.str[0]) {
          json[k] = tmpVal.str[0];
        }
        break;
      }
      case 'bool': {
        if (!prop.default || prop.default.bool[0] !== tmpVal.bool[0]) {
          json[k] = tmpVal.bool[0];
        }
        break;
      }
      case 'vec2': {
        if (!prop.default || prop.default.num[0] !== tmpVal.num[0] || prop.default.num[1] !== tmpVal.num[1]) {
          json[k] = [tmpVal.num[0], tmpVal.num[1]];
        }
        break;
      }
      case 'vec3':
      case 'rgb': {
        if (
          !prop.default ||
          prop.default.num[0] !== tmpVal.num[0] ||
          prop.default.num[1] !== tmpVal.num[1] ||
          prop.default.num[2] !== tmpVal.num[2]
        ) {
          json[k] = [tmpVal.num[0], tmpVal.num[1], tmpVal.num[2]];
        }
        break;
      }
      case 'vec4':
      case 'rgba': {
        if (
          !prop.default ||
          prop.default.num[0] !== tmpVal.num[0] ||
          prop.default.num[1] !== tmpVal.num[1] ||
          prop.default.num[2] !== tmpVal.num[2] ||
          prop.default.num[3] !== tmpVal.num[3]
        ) {
          json[k] = [tmpVal.num[0], tmpVal.num[1], tmpVal.num[2], tmpVal.num[3]];
        }
        break;
      }
    }
  }
}

export function serializeObject(obj: any, assetRegistry: AssetRegistry, json?: any, assetList?: Set<string>) {
  const serializationInfo = getSerializationInfo(assetRegistry);
  const cls = [...serializationInfo.values()];
  const index = cls.findIndex((val) => val.ctor === obj.constructor);
  if (index < 0) {
    throw new Error('Serialize object failed: Cannot found serialization meta data');
  }
  let info = cls[index];
  const initParams = info?.getInitParams?.(obj);
  json = json ?? {};
  json.ClassName = info.className;
  json.Object = {};
  if (initParams) {
    json.Init = initParams;
    if (assetList && initParams.asset && assetRegistry.getAssetInfo(initParams.asset)) {
      assetList.add(initParams.asset);
    }
  }
  obj = info.getObject?.(obj) ?? obj;
  while (info) {
    serializeObjectProps(obj, info, json.Object, assetRegistry, assetList);
    info = info.parent;
  }
  return json;
}

export async function deserializeObject<T>(ctx: any, json: object, assetRegistry: AssetRegistry): Promise<T> {
  const serializationInfo = getSerializationInfo(assetRegistry);
  const cls = [...serializationInfo.values()];
  const className = json['ClassName'];
  const index = cls.findIndex((val) => val.className === className);
  if (index < 0) {
    throw new Error('Deserialize object failed: Cannot found serialization meta data');
  }
  let info = cls[index];
  const initParams: { asset?: string } = json['Init'];
  json = json['Object'];
  const p: T | Promise<T> = info.createFunc ? info.createFunc(ctx, initParams) : new info.ctor();
  if (!p) {
    return null;
  }
  const obj = p instanceof Promise ? await p : p;
  while (info) {
    await deserializeObjectProps(obj, info, json, assetRegistry);
    info = info.parent;
  }
  return obj;
}
