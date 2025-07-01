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
import { getWaterClass, getFFTWaveGeneratorClass, getFBMWaveGeneratorClass } from './scene/water';
import {
  getAnimationClass,
  getAnimationSetClass,
  getInterpolatorClass,
  getPropTrackClass
} from './scene/animation';

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
        getInterpolatorClass(),
        getNodeHierarchyClass(),
        getAnimationSetClass(),
        getAnimationClass(),
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
  get assetRegistry() {
    return this._assetRegistry;
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
  getPropertiesByClass(cls: SerializableClass) {
    return this._clsPropMap.get(cls);
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
