import { Camera, OrthoCamera, PerspectiveCamera } from '../../camera';
import {
  BlinnMaterial,
  LambertMaterial,
  Material,
  MeshMaterial,
  ParticleMaterial,
  PBRMetallicRoughnessMaterial,
  PBRSpecularGlossinessMaterial,
  UnlitMaterial
} from '../../material';
import { Primitive } from '../../render';
import type { Visitor } from '../../scene';
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
  const props = (cls.getProps(obj, true) ?? []).sort((a, b) => (a.phase ?? 0) - (b.phase ?? 0));
  let currentPhase: number = undefined;
  const promises: Promise<void>[] = [];
  for (const prop of props) {
    if (!prop.set) {
      continue;
    }
    const k = prop.name;
    const v = json[k];
    if (v === undefined) {
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
  instance: boolean,
  assetList?: Set<string>
) {
  const props = cls.getProps(obj, true) ?? [];
  for (const prop of props) {
    if (instance && !prop.instance) {
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

export function serializeObject(
  obj: any,
  assetRegistry: AssetRegistry,
  json?: any,
  assetList?: Set<string>,
  instance?: boolean
) {
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
    serializeObjectProps(obj, info, json.Object, assetRegistry, instance, assetList);
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

class GatherVisitor implements Visitor<SceneNode> {
  /** @internal */
  private _primitiveSet: Set<Primitive>;
  private _materialSet: Set<Material>;
  /**
   * Creates an instance of CullVisitor
   * @param renderPass - Render pass for the culling task
   * @param camera - Camera that will be used for culling
   * @param rendeQueue - RenderQueue
   * @param viewPoint - Camera position of the primary render pass
   */
  constructor() {
    this._primitiveSet = new Set();
    this._materialSet = new Set();
  }
  get primitiveSet() {
    return this._primitiveSet;
  }
  get materialSet() {
    return this._materialSet;
  }
  visit(target: SceneNode): unknown {
    if (target.isMesh()) {
      return this.visitMesh(target);
    } else if (target.isParticleSystem()) {
      return this.visitParticleSystem(target);
    }
  }
  /** @internal */
  visitParticleSystem(node: ParticleSystem) {
    this.addMaterial(node.material);
    return true;
  }
  /** @internal */
  visitMesh(node: Mesh) {
    if (!node.sealed) {
      this.addMaterial(node.material);
      this.addPrimitive(node.primitive);
    }
    return true;
  }
  /** @internal */
  private addMaterial(material: Material) {
    if (material) {
      this._materialSet.add(material);
      if (material.$isInstance) {
        this._materialSet.add(material.coreMaterial);
      }
    }
  }
  private addPrimitive(primitive: Primitive) {
    if (primitive) {
      this._primitiveSet.add(primitive);
    }
  }
}

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

export async function deserializeSceneFromURL(
  url: string,
  assetRegistry: AssetRegistry
): Promise<{ scene: Scene; meta: any }> {
  try {
    const data = await assetRegistry.assetManager.fetchTextData(url);
    const json = JSON.parse(data);
    const scene = await deserializeScene<Scene>(null, assetRegistry, json);
    const meta = json['meta'] ?? null;
    return { scene, meta };
  } catch (err) {
    console.error(`Deserialize scene failed: ${err}`);
    return null;
  }
}

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
