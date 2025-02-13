import { AABB } from '@zephyr3d/base';
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
import { GerstnerWaveGenerator, Primitive } from '../../render';
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
import { getGraphNodeClass, getNodeHierarchyClass, getSceneNodeClass, NodeHierarchy } from './scene/node';
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
import type { PropertyAccessor, PropertyType, PropertyValue, SerializableClass } from './types';
import { getAABBClass } from './scene/misc';
import {
  GerstnerWaveCls,
  getGerstnerWaveClass,
  getGerstnerWaveGeneratorClass,
  getWaterClass
} from './scene/water';
import { Water } from '../../scene/water';

export * from './asset/asset';
export * from './scene/batch';
export * from './scene/camera';
export * from './scene/light';
export * from './scene/mesh';
export * from './scene/node';
export * from './scene/particle';
export * from './types';

const serializationInfoCache: WeakMap<AssetRegistry, Map<any, SerializableClass>> = new WeakMap();

const defaultValues: Record<PropertyType, any> = {
  bool: false,
  float: 0,
  int: 0,
  int2: [0, 0],
  int3: [0, 0, 0],
  int4: [0, 0, 0, 0],
  object: null,
  object_array: [],
  rgb: [0, 0, 0],
  rgba: [0, 0, 0, 0],
  string: '',
  vec2: [0, 0],
  vec3: [0, 0, 0],
  vec4: [0, 0, 0, 0],
  command: null
};

function getDefaultValue<T>(obj: T, prop: PropertyAccessor<T>) {
  let v = prop.getDefaultValue?.call(obj) ?? prop.default;
  if (v === undefined) {
    v = defaultValues[prop.type];
    console.warn(`No default value found for property: ${prop.name}, ${v} will be used`);
  }
  return v;
}

export function getSerializationInfo(assetRegistry: AssetRegistry) {
  let info = serializationInfoCache.get(assetRegistry);
  if (!info) {
    info = new Map<any, SerializableClass>([
      [AABB, getAABBClass()],
      [NodeHierarchy, getNodeHierarchyClass(assetRegistry)],
      [SceneNode, getSceneNodeClass(assetRegistry)],
      [GraphNode, getGraphNodeClass(assetRegistry)],
      [Mesh, getMeshClass(assetRegistry)],
      [Water, getWaterClass(assetRegistry)],
      [GerstnerWaveCls, getGerstnerWaveClass(assetRegistry)],
      [GerstnerWaveGenerator, getGerstnerWaveGeneratorClass(assetRegistry)],
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
    const phase = prop.phase ?? 0;
    if (phase !== currentPhase) {
      currentPhase = phase;
      if (promises.length > 0) {
        await Promise.all(promises);
      }
    }
    if (prop.type === 'command') {
      continue;
    }
    if (!prop.set) {
      continue;
    }
    if (prop.isValid && !prop.isValid.call(obj)) {
      continue;
    }
    const persistent = prop.persistent ?? true;
    if (!persistent) {
      continue;
    }
    const k = prop.name;
    const v = json[k] ?? getDefaultValue(obj, prop);
    const tmpVal: PropertyValue = {
      num: [0, 0, 0, 0],
      str: [''],
      bool: [false],
      object: [null]
    };
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
      case 'int':
        tmpVal.num[0] = v;
        break;
      case 'string':
        tmpVal.str[0] = v;
        break;
      case 'bool':
        tmpVal.bool[0] = v;
        break;
      case 'vec2':
      case 'int2':
        tmpVal.num[0] = v[0];
        tmpVal.num[1] = v[1];
        break;
      case 'vec3':
      case 'int3':
      case 'rgb':
        tmpVal.num[0] = v[0];
        tmpVal.num[1] = v[1];
        tmpVal.num[2] = v[2];
        break;
      case 'vec4':
      case 'int4':
      case 'rgba':
        tmpVal.num[0] = v[0];
        tmpVal.num[1] = v[1];
        tmpVal.num[2] = v[2];
        tmpVal.num[3] = v[3];
        break;
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
    if (prop.isValid && !prop.isValid.call(obj)) {
      continue;
    }
    if (prop.type === 'command') {
      continue;
    }
    const persistent = prop.persistent ?? true;
    if (!persistent) {
      continue;
    }
    const tmpVal: PropertyValue = {
      num: [0, 0, 0, 0],
      str: [''],
      bool: [false],
      object: [null]
    };
    const k = prop.name;
    prop.get.call(obj, tmpVal);
    switch (prop.type) {
      case 'object': {
        const value =
          typeof tmpVal.str[0] === 'string' && tmpVal.str[0]
            ? tmpVal.str[0]
            : tmpVal.object[0]
            ? serializeObject(tmpVal.object[0], assetRegistry, {}, assetList)
            : null;
        if (value) {
          json[k] = value;
          if (assetList && typeof json[k] === 'string' && assetRegistry.getAssetInfo(json[k])) {
            assetList.add(json[k]);
          }
        }
        break;
      }
      case 'object_array':
        json[k] = [];
        for (const p of tmpVal.object) {
          json[k].push(serializeObject(p, assetRegistry, {}, assetList));
        }
        break;
      case 'float':
      case 'int':
        if (
          (prop.default === undefined && !prop.getDefaultValue) ||
          getDefaultValue(obj, prop) !== tmpVal.num[0]
        ) {
          json[k] = tmpVal.num[0];
        }
        break;
      case 'string':
        if (
          (prop.default === undefined && !prop.getDefaultValue) ||
          getDefaultValue(obj, prop) !== tmpVal.str[0]
        ) {
          json[k] = tmpVal.str[0];
        }
        break;
      case 'bool':
        if (
          (prop.default === undefined && !prop.getDefaultValue) ||
          getDefaultValue(obj, prop) !== tmpVal.bool[0]
        ) {
          json[k] = tmpVal.bool[0];
        }
        break;
      case 'vec2':
      case 'int2':
        if (prop.default !== undefined || !!prop.getDefaultValue) {
          const v = getDefaultValue(obj, prop);
          if (v[0] === tmpVal.num[0] && v[1] === tmpVal.num[1]) {
            break;
          }
        }
        json[k] = [tmpVal.num[0], tmpVal.num[1]];
        break;
      case 'vec3':
      case 'int3':
      case 'rgb':
        if (prop.default !== undefined || !!prop.getDefaultValue) {
          const v = getDefaultValue(obj, prop);
          if (v[0] === tmpVal.num[0] && v[1] === tmpVal.num[1] && v[2] === tmpVal.num[2]) {
            break;
          }
        }
        json[k] = [tmpVal.num[0], tmpVal.num[1], tmpVal.num[2]];
        break;
      case 'vec4':
      case 'int4':
      case 'rgba':
        if (prop.default !== undefined || !!prop.getDefaultValue) {
          const v = getDefaultValue(obj, prop);
          if (
            v[0] === tmpVal.num[0] &&
            v[1] === tmpVal.num[1] &&
            v[2] === tmpVal.num[2] &&
            v[3] === tmpVal.num[3]
          ) {
            break;
          }
        }
        json[k] = [tmpVal.num[0], tmpVal.num[1], tmpVal.num[2], tmpVal.num[3]];
        break;
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
  let p: T | Promise<T>;
  let loadProps = true;
  if (info.createFunc) {
    let result = info.createFunc(ctx, initParams);
    if (result instanceof Promise) {
      result = await result;
    }
    p = result.obj;
    loadProps = result.loadProps ?? true;
  } else {
    p = new info.ctor();
  }
  //const p: T | Promise<T> = info.createFunc ? info.createFunc(ctx, initParams) : new info.ctor();
  if (!p) {
    return null;
  }
  const obj = p instanceof Promise ? await p : p;
  if (loadProps) {
    while (info) {
      await deserializeObjectProps(obj, info, json, assetRegistry);
      info = info.parent;
    }
  }
  return obj;
}

/*
export function serializeScene(
  nodeOrScene: Scene | SceneNode,
  assetRegistry: AssetRegistry,
  assetList?: Set<string>
) {
  const json = {} as any;
  const v = new GatherVisitor();
  const node = nodeOrScene instanceof SceneNode ? nodeOrScene : nodeOrScene.rootNode;
  node.traverse(v);
  json.allMaterials = [] as any[];
  for (const m of v.materialSet) {
    if (!m.persistentId) {
      Material.registerMaterial(crypto.randomUUID(), m);
    }
    const pid = m.persistentId;
    m.persistentId = '';
    const matContent = serializeObject(m, assetRegistry, null, assetList, m.$isInstance);
    m.persistentId = pid;
    json.allMaterials.push({
      id: m.persistentId,
      proto: m.$isInstance ? m.coreMaterial.persistentId : null,
      content: matContent
    });
  }
  json.allPrimitives = [] as any[];
  for (const p of v.primitiveSet) {
    if (!p.persistentId) {
      Primitive.registerPrimitive(crypto.randomUUID(), p);
    }
    const pid = p.persistentId;
    p.persistentId = '';
    const primContent = serializeObject(p, assetRegistry, null, assetList);
    p.persistentId = pid;
    json.allPrimitives.push({
      id: p.persistentId,
      content: primContent
    });
  }
  json.content = serializeObject(nodeOrScene, assetRegistry, null, assetList);
  return json;
}
*/
export async function deserializeSceneFromURL(
  url: string,
  assetRegistry: AssetRegistry
): Promise<{ scene: Scene; meta: any }> {
  try {
    const data = await assetRegistry.assetManager.fetchTextData(url);
    const json = JSON.parse(data);
    const scene = await deserializeObject<Scene>(null, json, assetRegistry);
    const meta = json['meta'] ?? null;
    return { scene, meta };
  } catch (err) {
    console.error(`Deserialize scene failed: ${err}`);
    return null;
  }
}
/*
export async function deserializeScene<T>(scene: Scene, assetRegistry: AssetRegistry, json: any) {
  const allMaterials = json.allMaterials as { id: string; proto: string; content: any }[];
  if (allMaterials) {
    const nonInstancedMaterials = allMaterials.filter(
      (val) => !val.proto && !Material.findMaterialById(val.id)
    );
    let promises: Promise<Material>[] = nonInstancedMaterials.map((val) =>
      deserializeObject(null, val.content, assetRegistry)
    );
    let materials: Material[] = await Promise.all(promises);
    for (let i = 0; i < nonInstancedMaterials.length; i++) {
      Material.registerMaterial(nonInstancedMaterials[i].id, materials[i]);
    }
    const instancedMaterials = allMaterials.filter(
      (val) => val.proto && Material.findMaterialById(val.proto) && !Material.findMaterialById(val.id)
    );
    promises = instancedMaterials.map((val) => deserializeObject(null, val.content, assetRegistry));
    materials = await Promise.all(promises);
    for (let i = 0; i < instancedMaterials.length; i++) {
      Material.registerMaterial(instancedMaterials[i].id, materials[i]);
    }
  }
  const allPrimitives = json.allPrimitives as { id: string; content: any }[];
  if (allPrimitives) {
    const newPrimitives = allPrimitives.filter((val) => !Primitive.findPrimitiveById(val.id));
    const promises: Promise<Primitive>[] = newPrimitives.map((val) =>
      deserializeObject(null, val.content, assetRegistry)
    );
    const primitives: Primitive[] = await Promise.all(promises);
    for (let i = 0; i < newPrimitives.length; i++) {
      Primitive.registerPrimitive(newPrimitives[i].id, primitives[i]);
    }
  }
  return await deserializeObject<T>(scene, json.content, assetRegistry);
}
*/
