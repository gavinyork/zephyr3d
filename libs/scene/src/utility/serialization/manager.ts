import type { GenericConstructor, VFS } from '@zephyr3d/base';
import type { PropertyAccessor, PropertyType, PropertyValue, SerializableClass } from './types';
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
import {
  getJSONBoolClass,
  getJSONObjectClass,
  getJSONNumberClass,
  getJSONPropClass,
  getJSONStringClass,
  getJSONArrayClass
} from './json';
import { Application } from '../../app';

const defaultValues: Record<PropertyType, any> = {
  bool: false,
  float: 0,
  int: 0,
  int2: [0, 0],
  int3: [0, 0, 0],
  int4: [0, 0, 0, 0],
  object: null,
  object_array: [],
  embedded: '',
  rgb: [0, 0, 0],
  rgba: [0, 0, 0, 0],
  string: '',
  vec2: [0, 0],
  vec3: [0, 0, 0],
  vec4: [0, 0, 0, 0],
  command: null
};

/**
 * Manages serialization and deserialization of engine objects to/from JSON,
 * including asset resolution via a virtual file system (VFS) and asset manager.
 *
 * @remarks
 * - Keeps a registry of serializable classes and their properties.
 * - Converts object graphs to JSON using per-class metadata and property accessors.
 * - Supports async asset embedding/export and lazy deserialization via phases.
 * - Maps loaded assets/objects back to their source IDs for caching and deduplication.
 *
 * Typical workflow:
 * 1. Construct with a `VFS`.
 * 2. Optionally `registerClass` for custom types.
 * 3. Use `serializeObject` and `deserializeObject` to convert between runtime objects and JSON.
 * 4. Use `saveScene` / `loadScene` for scene I/O.
 *
 * Caching:
 * - `getAssetId` returns the known source ID for an allocated asset when available.
 *
 * Threading:
 * - Methods returning Promises perform async I/O using the provided `VFS`/AssetManager.
 *
 * @public
 */
export class SerializationManager {
  private readonly _classMap: Map<GenericConstructor, SerializableClass>;
  private readonly _vfs: VFS;
  private _propMap: Record<string, PropertyAccessor>;
  private readonly _propNameMap: Map<PropertyAccessor, string>;
  private readonly _clsPropMap: Map<SerializableClass, PropertyAccessor[]>;
  private readonly _assetManager: AssetManager;
  private _allocated: WeakMap<any, string>;
  /**
   * Create a SerializationManager bound to a virtual file system.
   *
   * @param vfs - Virtual file system used for reading/writing assets and scenes.
   */
  constructor(vfs: VFS) {
    this._vfs = vfs;
    this._allocated = new WeakMap();
    this._assetManager = new AssetManager(this._vfs);
    this._propMap = {};
    this._propNameMap = new Map();
    this._clsPropMap = new Map();
    this._classMap = new Map<GenericConstructor, SerializableClass>(
      [
        getJSONPropClass(),
        getJSONNumberClass(),
        getJSONStringClass(),
        getJSONBoolClass(),
        getJSONObjectClass(),
        getJSONArrayClass(),
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
  /**
   * The virtual file system used by this manager.
   *
   * @remarks
   * Used by asset fetchers and scene save/load operations.
   */
  get vfs() {
    return this._vfs;
  }
  /**
   * Get the list of all registered serializable classes.
   *
   * @remarks
   * Includes built-in classes registered during construction and any custom classes
   * registered via `registerClass`.
   *
   * @returns An array of `SerializableClass` metadata.
   */
  getClasses(): SerializableClass[] {
    return [...this._classMap.values()];
  }
  /**
   * Get serialization metadata by a constructor function.
   *
   * @param ctor - The class constructor to look up.
   *
   * @returns The `SerializableClass` metadata, or `null` if not found.
   */
  getClassByConstructor(ctor: GenericConstructor) {
    return this._classMap.get(ctor) ?? null;
  }
  /**
   * Get serialization metadata by an object instance.
   *
   * @param obj - The object whose constructor will be used for the lookup.
   *
   * @returns The `SerializableClass` metadata, or `null` if not found.
   */
  getClassByObject(obj: object) {
    return this.getClassByConstructor(obj.constructor as GenericConstructor);
  }
  /**
   * Get serialization metadata by class name.
   *
   * @param className - Fully qualified class name as stored in JSON.
   *
   * @returns The `SerializableClass` metadata, or `null` if not found.
   */
  getClassByName(className: string) {
    for (const val of this._classMap) {
      if (val[0].name === className) {
        return val[1];
      }
    }
    return null;
  }
  /**
   * Find the class that owns a given property accessor.
   *
   * @param prop - Property accessor to search for.
   *
   * @returns The `SerializableClass` that declares the property, or `null` if unknown.
   */
  getClassByProperty(prop: PropertyAccessor): SerializableClass {
    for (const k of this._clsPropMap) {
      if (k[1].indexOf(prop) >= 0) {
        return k[0];
      }
    }
    return null;
  }
  /**
   * Get the properties declared on a given class.
   *
   * @param cls - Serializable class metadata.
   *
   * @returns An array of `PropertyAccessor` entries, or `null` if none.
   */
  getPropertiesByClass(cls: SerializableClass) {
    return this._clsPropMap.get(cls) ?? null;
  }
  /**
   * Get a property accessor by class and property name.
   *
   * @param cls - Serializable class metadata.
   * @param name - Property name to search for.
   *
   * @returns The `PropertyAccessor`, or `null` if not found.
   */
  getPropertyByClass(cls: SerializableClass, name: string) {
    return this.getPropertiesByClass(cls)?.find((value) => value.name === name) ?? null;
  }
  /**
   * Get a property accessor by its canonical path.
   *
   * @remarks
   * The canonical path format is `/ClassName/propName`.
   *
   * @param name - Canonical property path.
   *
   * @returns The `PropertyAccessor`, or `null` if not found.
   */
  getPropertyByName(name: string) {
    return this._propMap[name] ?? null;
  }
  /**
   * Get the canonical path for a property accessor.
   *
   * @remarks
   * Returns a string like `/ClassName/propName` if the property is registered.
   *
   * @param prop - Property accessor.
   *
   * @returns The canonical path, or `null` if unknown.
   */
  getPropertyName(prop: PropertyAccessor) {
    return this._propNameMap.get(prop) ?? null;
  }
  /**
   * Register a serializable class and its properties.
   *
   * @remarks
   * - No effect if the class is already registered.
   * - Also registers the class's properties with canonical paths.
   *
   * @param cls - Serializable class metadata to register.
   */
  registerClass(cls: SerializableClass) {
    if (!this._classMap.has(cls.ctor)) {
      this._classMap.set(cls.ctor, cls);
      this.registerProps(cls);
    }
  }
  /**
   * Get the known asset ID previously associated with a loaded/allocated asset.
   *
   * @remarks
   * Returns `null` if the asset was not loaded or tracked by this manager.
   *
   * @param asset - Asset instance (e.g., texture, model group) to look up.
   *
   * @returns The asset ID string, or `null` if unknown.
   */
  getAssetId(asset: unknown) {
    return this._allocated.get(asset) ?? null;
  }
  /**
   * Fetch a binary asset by ID via the asset manager.
   *
   * @remarks
   * - Associates the returned data with the given ID for future reverse lookup.
   * - The ID is typically a VFS path or locator.
   *
   * @param id - Asset identifier or path.
   *
   * @returns A Promise that resolves to the binary content, or `null` if not found.
   */
  async fetchBinary(id: string) {
    const data = await this.doFetchBinary(id);
    if (data) {
      this._allocated.set(data, id);
    }
    return data;
  }
  /**
   * Serialize an object to a JSON structure using registered class metadata.
   *
   * @remarks
   * - Throws if the object's class is not registered.
   * - Populates `asyncTasks` with pending I/O tasks for embedded resources.
   *
   * @param obj - The object to serialize.
   * @param json - Optional existing JSON object to fill.
   * @param asyncTasks - Optional list to collect async tasks for embedded asset export.
   *
   * @returns The serialized JSON structure.
   */
  serializeObject(obj: any, json?: any, asyncTasks?: Promise<unknown>[]) {
    if (obj === null || obj === undefined) {
      return obj;
    }
    const cls = this.getClasses();
    const index = cls.findIndex((val) => val.ctor === obj.constructor);
    if (index < 0) {
      throw new Error('Serialize object failed: Cannot found serialization meta data');
    }
    let info = cls[index];
    const initParams = info?.getInitParams?.(obj);
    json = json ?? {};
    json.ClassName = info.name;
    json.Object = {};
    if (initParams !== undefined && initParams !== null) {
      json.Init = initParams;
    }
    while (info) {
      this.serializeObjectProps(obj, info, json.Object, asyncTasks);
      info = this.getClassByConstructor(info.parent);
    }
    return json;
  }
  /**
   * Deserialize a JSON structure into an object instance.
   *
   * @remarks
   * - Uses the `ClassName` field to locate the registered class.
   * - Supports custom `createFunc` and phased property loading.
   *
   * @param ctx - Context object passed to custom constructors/resolvers.
   * @param json - The serialized JSON structure.
   *
   * @returns A Promise resolving to the reconstructed object instance, or `null` on failure.
   */
  async deserializeObject<T extends object>(ctx: any, json: object): Promise<T> {
    const cls = this.getClasses();
    const className = json['ClassName'];
    const index = cls.findIndex((val) => val.name === className);
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
      p = new info.ctor() as T;
    }
    //const p: T | Promise<T> = info.createFunc ? info.createFunc(ctx, initParams) : new info.ctor();
    if (!p) {
      return null;
    }
    const obj = p instanceof Promise ? await p : p;
    if (loadProps) {
      while (info) {
        await this.deserializeObjectProps(obj, info, json);
        info = this.getClassByConstructor(info.parent);
      }
    }
    return obj;
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
  /**
   * Load a model by ID and track the allocation for reverse lookup.
   *
   * @param id - Model identifier or path.
   * @param scene - Scene into which the model is loaded.
   * @param options - Optional model fetch options.
   *
   * @returns A Promise resolving to the loaded model object, or `null` if failed.
   */
  async fetchModel(id: string, scene: Scene, options?: ModelFetchOptions) {
    const model = await this.doFetchModel(id, scene, options);
    if (model) {
      this._allocated.set(model.group, id);
    }
    return model;
  }
  /**
   * Load a texture by ID and track the allocation for reverse lookup.
   *
   * @param id - Texture identifier or path.
   * @param options - Optional texture fetch options.
   *
   * @returns A Promise resolving to the loaded texture, or `null` if failed.
   */
  async fetchTexture<T extends Texture2D | TextureCube>(id: string, options?: TextureFetchOptions<T>) {
    const texture = await this.doFetchTexture(id, options);
    if (texture) {
      this._allocated.set(texture, id);
    }
    return texture;
  }
  /**
   * Load a scene from a JSON file via VFS.
   *
   * @remarks
   * - Deserializes the scene graph.
   * - Attaches scripts referenced by nodes after load (asynchronous).
   *
   * @param filename - Path to the scene JSON file in VFS.
   *
   * @returns A Promise resolving to the loaded `Scene`.
   */
  async loadScene(filename: string): Promise<Scene> {
    const content = (await this._vfs.readFile(filename, { encoding: 'utf8' })) as string;
    const json = JSON.parse(content);
    return await this.deserializeObject<Scene>(null, json);
  }
  /**
   * Save a scene to a JSON file via VFS.
   *
   * @remarks
   * - Collects async export tasks for embedded resources and awaits them.
   * - Writes a UTF-8 JSON representation to VFS.
   *
   * @param scene - Scene to serialize and save.
   * @param filename - Destination path in VFS.
   */
  async saveScene(scene: Scene, filename: string): Promise<void> {
    const asyncTasks: Promise<unknown>[] = [];
    const content = await this.serializeObject(scene, null, asyncTasks);
    await Promise.all(asyncTasks);
    await this._vfs.writeFile(filename, JSON.stringify(content), {
      encoding: 'utf8',
      create: true
    });
  }
  /**
   * Clear cached allocations and asset-manager caches.
   *
   * @remarks
   * Useful when reloading content or changing VFS mounts.
   */
  clearCache() {
    this._allocated = new WeakMap();
    this._assetManager.clearCache();
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
  /**
   * Find the object targeted by an animation track starting from a node.
   *
   * @remarks
   * - Parses a target path like `prop/subprop[0]/child` where indexed entries
   *   require `object_array` type and non-indexed entries require `object` type.
   * - Returns `null` if any segment cannot be resolved through registered metadata.
   *
   * @param node - Root node used as the starting point.
   * @param track - Property track containing a target path.
   *
   * @returns The resolved target object, or `null` if not found.
   */
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
        const path = `/${cls.name}/${prop.name}`;
        if (this._propMap[path]) {
          throw new Error(`Cannot register property ${path}: property name already exists`);
        }
        this._propMap[path] = prop;
        this._propNameMap.set(prop, path);
      }
    }
  }
  private getDefaultValue<T>(obj: T, prop: PropertyAccessor<T>) {
    let v = prop.getDefaultValue?.call(obj) ?? prop.default;
    if (v === undefined) {
      v = defaultValues[prop.type];
    }
    return v;
  }
  private async deserializeObjectProps<T extends object>(obj: T, cls: SerializableClass, json: object) {
    const props = (this.getPropertiesByClass(cls) ?? []).sort((a, b) => (a.phase ?? 0) - (b.phase ?? 0));
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
      const v = json[k] ?? this.getDefaultValue(obj, prop);
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
            tmpVal.object[0] = v ? (await this.deserializeObject<any>(obj, v)) ?? null : null;
          }
          break;
        case 'object_array':
          tmpVal.object = [];
          if (Array.isArray(v)) {
            for (const p of v) {
              if (typeof p === 'string' && p) {
                tmpVal.str[0] = p;
              } else {
                tmpVal.object.push(p ? (await this.deserializeObject<any>(obj, p)) ?? null : null);
              }
            }
          }
          break;
        case 'embedded':
          if (typeof v === 'string' && v) {
            tmpVal.str[0] = v;
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
      promises.push(Promise.resolve(prop.set.call(obj, tmpVal, -1)));
    }
    if (promises.length > 0) {
      await Promise.all(promises);
    }
  }
  private serializeObjectProps<T extends object>(
    obj: T,
    cls: SerializableClass,
    json: object,
    asyncTasks?: Promise<unknown>[]
  ) {
    const props = this.getPropertiesByClass(cls) ?? [];
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
              ? this.serializeObject(tmpVal.object[0], {}, asyncTasks)
              : null;
          if (value) {
            json[k] = value;
          }
          break;
        }
        case 'object_array':
          json[k] = [];
          for (const p of tmpVal.object) {
            json[k].push(this.serializeObject(p, {}, asyncTasks));
          }
          break;
        case 'embedded': {
          const relativePath = tmpVal.str[0].startsWith('/') ? tmpVal.str[0].slice(1) : tmpVal.str[0];
          json[k] = relativePath;
          if (asyncTasks) {
            const resource = tmpVal.object[0];
            asyncTasks.push(
              (async () => {
                console.log(k);
                const buffer = (await resource) as ArrayBuffer;
                await this.vfs.writeFile(relativePath, buffer, {
                  encoding: 'binary',
                  create: true
                });
              })()
            );
          }
          break;
        }
        case 'float':
        case 'int':
          if (
            (prop.default === undefined && !prop.getDefaultValue) ||
            this.getDefaultValue(obj, prop) !== tmpVal.num[0]
          ) {
            json[k] = tmpVal.num[0];
          }
          break;
        case 'string':
          if (
            (prop.default === undefined && !prop.getDefaultValue) ||
            this.getDefaultValue(obj, prop) !== tmpVal.str[0]
          ) {
            json[k] = tmpVal.str[0];
          }
          break;
        case 'bool':
          if (
            (prop.default === undefined && !prop.getDefaultValue) ||
            this.getDefaultValue(obj, prop) !== tmpVal.bool[0]
          ) {
            json[k] = tmpVal.bool[0];
          }
          break;
        case 'vec2':
        case 'int2':
          if (prop.default !== undefined || !!prop.getDefaultValue) {
            const v = this.getDefaultValue(obj, prop);
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
            const v = this.getDefaultValue(obj, prop);
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
            const v = this.getDefaultValue(obj, prop);
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
}
