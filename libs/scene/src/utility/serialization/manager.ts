import type { GenericConstructor } from '@zephyr3d/base';
import type { AssetRegistry } from './asset/asset';
import type { PropertyAccessor, SerializableClass } from './types';
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
import {
  getWaterClass,
  getGerstnerWaveClass,
  getGerstnerWaveGeneratorClass,
  getFFTWaveGeneratorClass,
  getFBMWaveGeneratorClass
} from './scene/water';

export class SerializationManager {
  private _classMap: Map<GenericConstructor, SerializableClass>;
  private _assetRegistry: AssetRegistry;
  private _propMap: Record<string, PropertyAccessor>;
  private _clsPropMap: Map<SerializableClass, PropertyAccessor[]>;
  constructor(assetRegistry: AssetRegistry) {
    this._assetRegistry = assetRegistry;
    this._propMap = {};
    this._clsPropMap = new Map();
    this._classMap = new Map<GenericConstructor, SerializableClass>(
      [
        getAABBClass(),
        getNodeHierarchyClass(this._assetRegistry),
        getSceneNodeClass(this._assetRegistry),
        getGraphNodeClass(this._assetRegistry),
        getMeshClass(this._assetRegistry),
        getWaterClass(this._assetRegistry),
        getTerrainClass(this._assetRegistry),
        getGerstnerWaveClass(this._assetRegistry),
        getGerstnerWaveGeneratorClass(this._assetRegistry),
        getFFTWaveGeneratorClass(this._assetRegistry),
        getFBMWaveGeneratorClass(this._assetRegistry),
        getParticleNodeClass(this._assetRegistry),
        getPunctualLightClass(this._assetRegistry),
        getDirectionalLightClass(this._assetRegistry),
        getSpotLightClass(this._assetRegistry),
        getPointLightClass(this._assetRegistry),
        getCameraClass(this._assetRegistry),
        getPerspectiveCameraClass(this._assetRegistry),
        getOrthoCameraClass(this._assetRegistry),
        getBatchGroupClass(this._assetRegistry),
        getSceneClass(this._assetRegistry),
        getMeshMaterialClass(),
        getUnlitMaterialClass(this._assetRegistry),
        getLambertMaterialClass(this._assetRegistry),
        getBlinnMaterialClass(this._assetRegistry),
        getPBRMetallicRoughnessMaterialClass(this._assetRegistry),
        getPBRSpecularGlossinessMaterialClass(this._assetRegistry),
        getParticleMaterialClass(this._assetRegistry),
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
  get assetRegistry() {
    return this._assetRegistry;
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
  getPropertyByName(name: string) {
    return this._propMap[name] ?? null;
  }
  getPropertyName(prop: PropertyAccessor) {
    for (const k of this._clsPropMap) {
      if (k[1].indexOf(prop) >= 0) {
        return `/${k[0].ctor.name}/${prop.name}`;
      }
    }
    return null;
  }
  registerClass(cls: SerializableClass) {
    if (!this._classMap.has(cls.ctor)) {
      this._classMap.set(cls.ctor, cls);
      this.registerProps(cls);
    }
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
      }
    }
  }
}
