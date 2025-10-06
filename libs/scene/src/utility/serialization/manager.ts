import { ASSERT, type GenericConstructor, type TypedArray, type VFS } from '@zephyr3d/base';
import type { PropertyAccessor, PropertyType, PropertyValue, SerializableClass } from './types';
import { getAABBClass } from './scene/misc';
import { getGraphNodeClass, getSceneNodeClass } from './scene/node';
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
  getParticleMaterialClass,
  getPBRBluePrintMaterialClass
} from './scene/material';
import { getMeshClass } from './scene/mesh';
import { getParticleNodeClass } from './scene/particle';
import {
  getBoxShapeClass,
  getBoxFrameShapeClass,
  getSphereShapeClass,
  getTorusShapeClass,
  getCylinderShapeClass,
  getPlaneShapeClass,
  getTetrahedronShapeClass
} from './scene/primitive';
import { getSceneClass } from './scene/scene';
import { getTerrainClass } from './scene/terrain';
import { getWaterClass, getFFTWaveGeneratorClass, getFBMWaveGeneratorClass } from './scene/water';
import {
  getAnimationClass,
  getInterpolatorClass,
  getMorphTrackClass,
  getNodeEulerRotationTrackClass,
  getNodeRotationTrackClass,
  getNodeScaleTrackClass,
  getNodeTranslationTrackClass,
  getPropTrackClass,
  getSkeletonClass
} from './scene/animation';
import type { Scene, SceneNode } from '../../scene';
import type { PropertyTrack } from '../../animation';
import type { ModelFetchOptions, TextureFetchOptions } from '../../asset';
import { AssetManager } from '../../asset';
import type { BaseTexture, SamplerOptions, Texture2D, Texture2DArray, TextureCube } from '@zephyr3d/device';
import {
  getJSONBoolClass,
  getJSONObjectClass,
  getJSONNumberClass,
  getJSONPropClass,
  getJSONStringClass,
  getJSONArrayClass
} from './json';
import {
  ConstantScalarNode,
  ConstantVec2Node,
  ConstantVec3Node,
  ConstantVec4Node
} from '../blueprint/common/constants';
import {
  ConstantTexture2DArrayNode,
  ConstantTexture2DNode,
  ConstantTextureCubeNode,
  TextureSampleNode
} from '../blueprint/material/texture';
import {
  AbsNode,
  ArccosineHNode,
  ArcCosNode,
  ArcsineHNode,
  ArcSinNode,
  ArcTan2Node,
  ArctangentHNode,
  ArcTanNode,
  CeilNode,
  ClampNode,
  CompAddNode,
  CompDivNode,
  CompMulNode,
  CompSubNode,
  CosHNode,
  CosNode,
  CrossProductNode,
  DDXNode,
  DDYNode,
  Degrees2RadiansNode,
  DistanceNode,
  DotProductNode,
  Exp2Node,
  ExpNode,
  FaceForwardNode,
  FloorNode,
  FmaNode,
  FractNode,
  FWidthNode,
  InvSqrtNode,
  LengthNode,
  Log2Node,
  LogNode,
  MakeVectorNode,
  MaxNode,
  MinNode,
  MixNode,
  ModNode,
  NormalizeNode,
  PowNode,
  Radians2DegreesNode,
  ReflectNode,
  RefractNode,
  SaturateNode,
  SignNode,
  SinHNode,
  SinNode,
  SqrtNode,
  StepNode,
  TanHNode,
  TanNode
} from '../blueprint/common/math';
import {
  CameraPositionNode,
  VertexBinormalNode,
  VertexColorNode,
  VertexNormalNode,
  VertexPositionNode,
  VertexTangentNode,
  VertexUVNode
} from '../blueprint/material/inputs';
import { PBRBlockNode } from '../blueprint/material/pbr';
import type { BlueprintDAG, GraphStructure, IGraphNode, NodeConnection } from '../blueprint/node';
import type { Material } from '../../material';
import type { Primitive } from '../../render';

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
  private _vfs: VFS;
  private _propMap: Record<string, PropertyAccessor>;
  private readonly _propNameMap: Map<PropertyAccessor, string>;
  private readonly _clsPropMap: Map<SerializableClass, PropertyAccessor[]>;
  private readonly _assetManager: AssetManager;
  private readonly _editorMode: boolean;
  private _allocated: WeakMap<any, string>;
  /**
   * Create a SerializationManager bound to a virtual file system.
   *
   * @param vfs - Virtual file system used for reading/writing assets and scenes.
   */
  constructor(vfs: VFS, editorMode = false) {
    this._vfs = vfs;
    this._editorMode = editorMode;
    this._allocated = new WeakMap();
    this._assetManager = new AssetManager(this);
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
        getSkeletonClass(),
        getAnimationClass(this),
        getPropTrackClass(this),
        getNodeRotationTrackClass(),
        getNodeScaleTrackClass(),
        getNodeTranslationTrackClass(),
        getNodeEulerRotationTrackClass(),
        getMorphTrackClass(),
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
        getPBRBluePrintMaterialClass(this),
        getParticleMaterialClass(this),
        getBoxShapeClass(),
        getBoxFrameShapeClass(),
        getSphereShapeClass(),
        getTorusShapeClass(),
        getCylinderShapeClass(),
        getPlaneShapeClass(),
        getTetrahedronShapeClass(),
        ConstantScalarNode.getSerializationCls(),
        ConstantVec2Node.getSerializationCls(),
        ConstantVec3Node.getSerializationCls(),
        ConstantVec4Node.getSerializationCls(),
        ConstantTexture2DNode.getSerializationCls(this),
        ConstantTexture2DArrayNode.getSerializationCls(this),
        ConstantTextureCubeNode.getSerializationCls(this),
        MakeVectorNode.getSerializationCls(),
        Degrees2RadiansNode.getSerializationCls(),
        Radians2DegreesNode.getSerializationCls(),
        SinNode.getSerializationCls(),
        CosNode.getSerializationCls(),
        TanNode.getSerializationCls(),
        ArcSinNode.getSerializationCls(),
        ArcCosNode.getSerializationCls(),
        ArcTanNode.getSerializationCls(),
        ArcTan2Node.getSerializationCls(),
        SinHNode.getSerializationCls(),
        CosHNode.getSerializationCls(),
        TanHNode.getSerializationCls(),
        ArcsineHNode.getSerializationCls(),
        ArccosineHNode.getSerializationCls(),
        ArctangentHNode.getSerializationCls(),
        ExpNode.getSerializationCls(),
        Exp2Node.getSerializationCls(),
        LogNode.getSerializationCls(),
        Log2Node.getSerializationCls(),
        SqrtNode.getSerializationCls(),
        InvSqrtNode.getSerializationCls(),
        AbsNode.getSerializationCls(),
        SignNode.getSerializationCls(),
        FloorNode.getSerializationCls(),
        CeilNode.getSerializationCls(),
        FractNode.getSerializationCls(),
        DDXNode.getSerializationCls(),
        DDYNode.getSerializationCls(),
        FWidthNode.getSerializationCls(),
        CompAddNode.getSerializationCls(),
        CompSubNode.getSerializationCls(),
        CompMulNode.getSerializationCls(),
        CompDivNode.getSerializationCls(),
        ModNode.getSerializationCls(),
        MinNode.getSerializationCls(),
        MaxNode.getSerializationCls(),
        PowNode.getSerializationCls(),
        StepNode.getSerializationCls(),
        FmaNode.getSerializationCls(),
        ClampNode.getSerializationCls(),
        SaturateNode.getSerializationCls(),
        MixNode.getSerializationCls(),
        NormalizeNode.getSerializationCls(),
        FaceForwardNode.getSerializationCls(),
        ReflectNode.getSerializationCls(),
        RefractNode.getSerializationCls(),
        LengthNode.getSerializationCls(),
        DistanceNode.getSerializationCls(),
        DotProductNode.getSerializationCls(),
        CrossProductNode.getSerializationCls(),
        VertexColorNode.getSerializationCls(),
        VertexUVNode.getSerializationCls(),
        VertexPositionNode.getSerializationCls(),
        VertexNormalNode.getSerializationCls(),
        VertexTangentNode.getSerializationCls(),
        VertexBinormalNode.getSerializationCls(),
        CameraPositionNode.getSerializationCls(),
        PBRBlockNode.getSerializationCls(),
        TextureSampleNode.getSerializationCls()
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
  get VFS() {
    return this._vfs;
  }
  set VFS(vfs: VFS) {
    this._vfs = vfs;
  }
  /**
   * Wethether editor mode is enabled
   *
   * @remarks
   * In editor mode, some properties will be disabled
   */
  get editorMode() {
    return this._editorMode;
  }
  /**
   * AssetManager
   */
  get assetManager() {
    return this._assetManager;
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
    const data = await this._assetManager.fetchBinaryData(id);
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
    const model = await this._assetManager.fetchModel(scene, id, options);
    if (model) {
      this._allocated.set(model.group, id);
    }
    return model;
  }
  /**
   * Load a texture directly from an ArrayBuffer or typed array.
   *
   * - Chooses an appropriate loader based on the provided MIME type.
   * - Can upload into an existing texture if `texture` is specified.
   *
   * @typeParam T - Expected concrete texture type.
   * @param arrayBuffer - Raw texture data buffer.
   * @param mimeType - MIME type of the texture (must be supported by a registered loader).
   * @param srgb - If true, treat image as sRGB; otherwise linear.
   * @param samplerOptions - Optional sampler options passed to the loader path.
   * @param texture - Optional destination texture to populate.
   * @returns A promise that resolves to the created or populated texture.
   */
  async loadTextureFromBuffer<T extends BaseTexture>(
    arrayBuffer: ArrayBuffer | TypedArray,
    mimeType: string,
    srgb?: boolean,
    samplerOptions?: SamplerOptions,
    texture?: BaseTexture
  ): Promise<T> {
    return this._assetManager.loadTextureFromBuffer(arrayBuffer, mimeType, srgb, samplerOptions, texture);
  }
  /**
   * Load a texture by ID and track the allocation for reverse lookup.
   *
   * @param id - Texture identifier or path.
   * @param options - Optional texture fetch options.
   *
   * @returns A Promise resolving to the loaded texture, or `null` if failed.
   */
  async fetchTexture<T extends Texture2D | TextureCube | Texture2DArray>(
    id: string,
    options?: TextureFetchOptions<T>
  ) {
    const texture = await this._assetManager.fetchTexture(id, options);
    if (texture) {
      this._allocated.set(texture, id);
    }
    return texture;
  }
  /**
   * Load a material by ID and track the allocation for reverse lookup.
   *
   * @param id - Material identifier or path.
   *
   * @returns A Promise resolving to the loaded material, or `null` if failed.
   */
  async fetchMaterial<T extends Material = Material>(id: string) {
    const material = await this._assetManager.fetchMaterial<T>(id);
    if (material) {
      this._allocated.set(material, id);
    }
    return material;
  }
  /**
   * Load a primitive by ID and track the allocation for reverse lookup.
   *
   * @param id - Primitive identifier or path.
   *
   * @returns A Promise resolving to the loaded primitive, or `null` if failed.
   */
  async fetchPrimitive<T extends Primitive = Primitive>(id: string) {
    const primitive = await this._assetManager.fetchPrimitive<T>(id);
    if (primitive) {
      this._allocated.set(primitive, id);
    }
    return primitive;
  }
  /**
   * Instantiate a prefab from a JSON file via VFS.
   * @param parent - Parent node to attach the instantiated prefab to.
   * @param path - Path to the prefab JSON file in VFS.
   * @returns A Promise resolving to the instantiated `SceneNode`, or `null` on failure.
   */
  async instantiatePrefab(parent: SceneNode, path: string): Promise<SceneNode> {
    try {
      const content = (await this._vfs.readFile(path, { encoding: 'utf8' })) as string;
      const json = JSON.parse(content) as { type: string; data: object };
      ASSERT(json?.type === 'SceneNode', 'Invalid prefab format');
      return await this.deserializeObject<SceneNode>(parent, json.data);
    } catch (err) {
      console.error(`Failed to instantiate prefab from ${path}:`, err);
      return null;
    }
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
  private rebuildGraphStructure(
    nodes: Record<number, IGraphNode>,
    links: { startNodeId: number; startSlotId: number; endNodeId: number; endSlotId: number }[]
  ): GraphStructure {
    const gs: GraphStructure = {
      outgoing: {},
      incoming: {}
    };
    // Initialize adjacency lists
    for (const nodeId in nodes) {
      gs.outgoing[nodeId] = [];
      gs.incoming[nodeId] = [];
    }
    // Fill with links
    for (const link of links) {
      const outConnection: NodeConnection = {
        targetNodeId: link.endNodeId,
        startSlotId: link.startSlotId,
        endSlotId: link.endSlotId
      };

      const inConnection: NodeConnection = {
        targetNodeId: link.startNodeId,
        startSlotId: link.startSlotId,
        endSlotId: link.endSlotId
      };

      gs.outgoing[link.startNodeId]?.push(outConnection);
      gs.incoming[link.endNodeId]?.push(inConnection);
    }
    return gs;
  }
  private collectReachableBackward(
    gs: GraphStructure,
    nodes: Record<number, IGraphNode>,
    roots: number[]
  ): Set<number> {
    const reachable = new Set<number>();
    const q: number[] = [];

    for (const r of roots) {
      if (nodes[r]) {
        reachable.add(r);
        q.push(r);
      }
    }
    while (q.length > 0) {
      const u = q.shift()!;
      const ins = gs.incoming[u] || [];
      for (const conn of ins) {
        const v = conn.targetNodeId; // 前驱
        if (!reachable.has(v)) {
          reachable.add(v);
          q.push(v);
        }
      }
    }
    return reachable;
  }
  private getReverseTopologicalOrderFromRoots(
    gs: GraphStructure,
    nodes: Record<number, IGraphNode>,
    roots: number[]
  ): {
    order: number[];
    levels: number[][];
  } {
    if (!roots || roots.length === 0) {
      return { order: [], levels: [] };
    }
    const sub = this.collectReachableBackward(gs, nodes, roots);
    if (sub.size === 0) {
      return { order: [], levels: [] };
    }
    const outDegree = new Map<number, number>();
    for (const id of sub) {
      const outs = (gs.outgoing[id] || []).filter((c) => sub.has(c.targetNodeId));
      outDegree.set(id, outs.length);
    }
    let currentLevel = Array.from(outDegree.entries())
      .filter(([, deg]) => deg === 0)
      .map(([id]) => id);
    const result: number[] = [];
    const levels: number[][] = [];
    while (currentLevel.length > 0) {
      levels.push([...currentLevel]);
      result.push(...currentLevel);
      const nextLevel: number[] = [];
      for (const u of currentLevel) {
        const ins = gs.incoming[u] || [];
        for (const conn of ins) {
          const v = conn.targetNodeId; // 前驱
          if (!sub.has(v)) {
            continue;
          }
          const deg = outDegree.get(v)! - 1;
          outDegree.set(v, deg);
          if (deg === 0) {
            nextLevel.push(v);
          }
        }
      }
      currentLevel = nextLevel;
    }
    if (result.length !== sub.size) {
      console.warn('Subgraph contains cycles (from given roots).');
      return null;
    }
    return { order: result, levels };
  }
  createBluePrintDAG(
    nodeMap: Record<number, IGraphNode>,
    roots: number[],
    links: { startNodeId: number; startSlotId: number; endNodeId: number; endSlotId: number }[]
  ): BlueprintDAG {
    const gs = this.rebuildGraphStructure(nodeMap, links);
    for (const k in gs.incoming) {
      const node = nodeMap[k];
      for (const conn of gs.incoming[k]) {
        const input = node.inputs.find((input) => input.id === conn.endSlotId);
        input.inputNode = nodeMap[conn.targetNodeId];
        input.inputId = conn.startSlotId;
      }
    }
    return {
      graph: gs,
      nodeMap,
      roots,
      order: this.getReverseTopologicalOrderFromRoots(gs, nodeMap, roots).order.reverse()
    };
  }
  async loadBluePrint(path: string) {
    try {
      const content = (await this._vfs.readFile(path, { encoding: 'utf8' })) as string;
      const state = JSON.parse(content) as {
        nodes: {
          id: number;
          locked: boolean;
          node: object;
        }[];
        links: { startNodeId: number; startSlotId: number; endNodeId: number; endSlotId: number }[];
      };
      const nodeMap: Record<number, IGraphNode> = {};
      const roots: number[] = [];
      for (const node of state.nodes) {
        const impl = await this.deserializeObject<IGraphNode>(null, node.node);
        nodeMap[node.id] = impl;
        if (node.locked) {
          roots.push(node.id);
        }
      }
      return await this.createBluePrintDAG(nodeMap, roots, state.links);
    } catch (err) {
      const msg = `Load material failed: ${err}`;
      console.error(msg);
      return null;
    }
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
  private static readonly _pathPattern = /^([^\][]+)(?:\[(\d+)\])?$/;
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
            tmpVal.object[0] = v
              ? Array.isArray(v)
                ? v
                : (await this.deserializeObject<any>(obj, v)) ?? null
              : null;
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
              ? Array.isArray(tmpVal.object[0])
                ? tmpVal.object[0]
                : this.serializeObject(tmpVal.object[0], {}, asyncTasks)
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
                await this.VFS.writeFile(relativePath, buffer, {
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
