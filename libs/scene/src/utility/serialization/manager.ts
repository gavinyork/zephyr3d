import type { GenericConstructor, VFS } from '@zephyr3d/base';
import type { PropertyAccessor, PropertyValue, SerializableClass } from './types';
import { getAABBClass } from './scene/misc';
import { getGraphNodeClass, getNodeHierarchyClass, getSceneNodeClass } from './scene/node';
import { getBatchGroupClass } from './scene/batch';
import { getCameraClass, getPerspectiveCameraClass, getOrthoCameraClass } from './scene/camera';
import {
  getPunctualLightClass,
  getDirectionalLightClass,
  getSpotLightClass,
  getPointLightClass
} from './scene/light';
import {
  getMeshMaterialClass,
  getUnlitMaterialClass,
  getLambertMaterialClass,
  getBlinnMaterialClass,
  getPBRMetallicRoughnessMaterialClass,
  getPBRSpecularGlossinessMaterialClass,
  getParticleMaterialClass
} from './scene/material';
import { getMeshClass } from './scene/mesh';
import { getParticleNodeClass } from './scene/particle';
import {
  getPrimitiveClass,
  getBoxShapeClass,
  getBoxFrameShapeClass,
  getSphereShapeClass,
  getTorusShapeClass,
  getCylinderShapeClass,
  getPlaneShapeClass
} from './scene/primitive';
import { getSceneClass } from './scene/scene';
import { getTerrainClass } from './scene/terrain';
import { getWaterClass, getFFTWaveGeneratorClass, getFBMWaveGeneratorClass } from './scene/water';
import { getAnimationClass, getInterpolatorClass, getPropTrackClass } from './scene/animation';
import type { Scene, SceneNode } from '../../scene';
import type { PropertyTrack } from '../../animation';
import type { ModelFetchOptions, TextureFetchOptions } from '../../asset';
import { AssetManager } from '../../asset';
import type { Texture2D, TextureCube } from '@zephyr3d/device';

/**
 * Serialization manager class
 * @public
 */
export class SerializationManager {
  private readonly _classMap: Map<GenericConstructor, SerializableClass>;
  private readonly _vfs: VFS;
  private _propMap: Record<string, PropertyAccessor>;
  private readonly _propNameMap: Map<PropertyAccessor, string>;
  private readonly _clsPropMap: Map<SerializableClass, PropertyAccessor[]>;
  private readonly _assetManager: AssetManager;
  private readonly _allocated: WeakMap<any, string>;
  constructor(vfs: VFS) {
    this._vfs = vfs;
    this._allocated = new WeakMap();
    this._assetManager = new AssetManager(this._vfs);
    this._propMap = {};
    this._propNameMap = new Map();
    this._clsPropMap = new Map();
    this._classMap = new Map<GenericConstructor, SerializableClass>(
      [
        getAABBClass(),
        getInterpolatorClass(),
        getNodeHierarchyClass(),
        getAnimationClass(this),
        getPropTrackClass(this),
        getSceneNodeClass(this),
        getGraphNodeClass(),
        getMeshClass(),
        getWaterClass(this),
        getTerrainClass(this),
        getFFTWaveGeneratorClass(),
        getFBMWaveGeneratorClass(),
        getParticleNodeClass(),
        getPunctualLightClass(),
        getDirectionalLightClass(),
        getSpotLightClass(),
        getPointLightClass(),
        getCameraClass(),
        getPerspectiveCameraClass(),
        getOrthoCameraClass(),
        getBatchGroupClass(),
        getSceneClass(this),
        getMeshMaterialClass(),
        getUnlitMaterialClass(this),
        getLambertMaterialClass(this),
        getBlinnMaterialClass(this),
        getPBRMetallicRoughnessMaterialClass(this),
        getPBRSpecularGlossinessMaterialClass(this),
        getParticleMaterialClass(this),
        getPrimitiveClass(),
        getBoxShapeClass(),
        getBoxFrameShapeClass(),
        getSphereShapeClass(),
        getTorusShapeClass(),
        getCylinderShapeClass(),
        getPlaneShapeClass()
      ].map((val) => [val.ctor, val])
    );
    for (const k of this._classMap) {
      this.registerProps(k[1]);
    }
  }
  get vfs() {
    return this._vfs;
  }
  getClasses(): SerializableClass[] {
    return [...this._classMap.values()];
  }
  getClassByConstructor(ctor: GenericConstructor) {
    return this._classMap.get(ctor) ?? null;
  }
  getClassByObject(obj: object) {
    return this.getClassByConstructor(obj.constructor as GenericConstructor);
  }
  getClassByName(className: string) {
    for (const val of this._classMap) {
      if (val[0].name === className) {
        return val[1];
      }
    }
    return null;
  }
  getClassByProperty(prop: PropertyAccessor): SerializableClass {
    for (const k of this._clsPropMap) {
      if (k[1].indexOf(prop) >= 0) {
        return k[0];
      }
    }
    return null;
  }
  getPropertiesByClass(cls: SerializableClass) {
    return this._clsPropMap.get(cls) ?? null;
  }
  getPropertyByClass(cls: SerializableClass, name: string) {
    return this.getPropertiesByClass(cls)?.find((value) => value.name === name) ?? null;
  }
  getPropertyByName(name: string) {
    return this._propMap[name] ?? null;
  }
  getPropertyName(prop: PropertyAccessor) {
    return this._propNameMap.get(prop) ?? null;
  }
  registerClass(cls: SerializableClass) {
    if (!this._classMap.has(cls.ctor)) {
      this._classMap.set(cls.ctor, cls);
      this.registerProps(cls);
    }
  }
  getAssetId(asset: unknown) {
    return this._allocated.get(asset) ?? null;
  }
  async fetchBinary(id: string) {
    const data = await this.doFetchBinary(id);
    if (data) {
      this._allocated.set(data, id);
    }
    return data;
  }
  protected async doFetchBinary(path: string) {
    return await this._assetManager.fetchBinaryData(path, null);
  }
  protected async doFetchModel(path: string, scene: Scene, options?: ModelFetchOptions) {
    return await this._assetManager.fetchModel(scene, path, options);
  }
  protected async doFetchTexture<T extends Texture2D | TextureCube>(
    path: string,
    options?: TextureFetchOptions<T>
  ) {
    return await this._assetManager.fetchTexture<T>(path, options);
  }
  async fetchModel(id: string, scene: Scene, options?: ModelFetchOptions) {
    const model = await this.doFetchModel(id, scene, options);
    if (model) {
      this._allocated.set(model.group, id);
    }
    return model;
  }
  async fetchTexture<T extends Texture2D | TextureCube>(id: string, options?: TextureFetchOptions<T>) {
    const texture = await this.doFetchTexture(id, options);
    if (texture) {
      this._allocated.set(texture, id);
    }
    return texture;
  }
  private static readonly _pathPattern = /^([^\[\]]+)(?:\[(\d+)\])?$/;
  private static parsePropertyPath(str: string) {
    const match = str.match(this._pathPattern);
    if (match) {
      return {
        original: match[0],
        prefix: match[1],
        index: match[2] || null,
        indexValue: match[2] ? parseInt(match[2], 10) : null,
        hasIndex: !!match[2]
      };
    }
    return null;
  }

  findAnimationTarget(node: SceneNode, track: PropertyTrack) {
    const target = track.target ?? '';
    const value: PropertyValue = { object: [] };
    const parts = target.split('/').filter((val) => !!val);
    let targetObj: object = node;
    while (parts.length > 0) {
      const propName = parts.shift();
      const info = SerializationManager.parsePropertyPath(propName);
      if (!info) {
        return null;
      }
      const cls = this.getClassByConstructor(targetObj.constructor as GenericConstructor);
      if (!cls) {
        return null;
      }
      const prop = this.getPropertyByClass(cls, info.prefix);
      if (!prop) {
        return null;
      }
      if (info.hasIndex) {
        if (prop.type !== 'object_array') {
          return null;
        }
        prop.get.call(targetObj, value);
        targetObj = value.object?.[info.indexValue] ?? null;
      } else {
        if (prop.type !== 'object') {
          return null;
        }
        prop.get.call(targetObj, value);
        targetObj = value.object?.[0] ?? null;
      }
      if (!targetObj) {
        return null;
      }
    }
    return targetObj;
  }
  /** @internal */
  private registerProps(cls: SerializableClass) {
    if (!this._clsPropMap.get(cls)) {
      const props = cls.getProps() ?? [];
      this._clsPropMap.set(cls, props);
      for (const prop of props) {
        const path = `/${cls.ctor.name}/${prop.name}`;
        if (this._propMap[path]) {
          throw new Error(`Cannot register property ${path}: property name already exists`);
        }
        this._propMap[path] = prop;
        this._propNameMap.set(prop, path);
      }
    }
  }
}
