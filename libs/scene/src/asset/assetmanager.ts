import type { DecoderModule } from 'draco3d';
import type { HttpRequest, ReadOptions, TypedArray, VFS, WriteOptions } from '@zephyr3d/base';
import {
  isPowerOf2,
  nextPowerOf2,
  DWeakRef,
  DRef,
  base64ToUint8Array,
  Vector3,
  ASSERT,
  VFSError
} from '@zephyr3d/base';
import type { SharedModel } from './model';
import { GLTFLoader } from './loaders/gltf/gltf_loader';
import { WebImageLoader } from './loaders/image/webimage_loader';
import { DDSLoader } from './loaders/dds/dds_loader';
import { HDRLoader } from './loaders/hdr/hdr';
import type { SceneNode } from '../scene/scene_node';
import { CopyBlitter } from '../blitter';
import { getSheenLutLoader } from './builtin';
import { BUILTIN_ASSET_TEXTURE_SHEEN_LUT } from '../values';
import type { AnimationSet } from '../animation/animationset';
import type {
  BaseTexture,
  PrimitiveType,
  SamplerOptions,
  TextureAddressMode,
  TextureFilterMode,
  VertexAttribFormat,
  VertexSemantic
} from '@zephyr3d/device';
import type { Scene } from '../scene/scene';
import type { AbstractTextureLoader, AbstractModelLoader } from './loaders/loader';
import { TGALoader } from './loaders/image/tga_Loader';
import { getDevice, getEngine } from '../app/api';
import { Material, PBRBluePrintMaterial } from '../material';
import type {
  BlueprintDAG,
  GraphStructure,
  IGraphNode,
  IRUniformTexture,
  IRUniformValue,
  NodeConnection,
  SerializationManager
} from '../utility';
import { BoundingBox } from '../utility/bounding_volume';
import { MaterialBlueprintIR } from '../utility/blueprint/material/ir';
import type { Skeleton } from '../animation';
import { Primitive } from '../render';

/**
 * Options for texture fetching.
 *
 * Controls how a texture is loaded, converted, and optionally uploaded into an existing texture object.
 *
 * @typeParam T - Texture type to be returned, extending BaseTexture.
 * @public
 */
export type TextureFetchOptions<T extends BaseTexture> = {
  /**
   * Explicit MIME type hint. If omitted, the type is inferred from file extension via VFS.
   */
  mimeType?: string;
  /**
   * If true, load the image as linear data. If false or omitted, load as sRGB (when supported).
   *
   * Note: For WebGL targets, non-power-of-two or sRGB textures may be repacked based on constraints.
   */
  linearColorSpace?: boolean;
  /**
   * Optional target texture to upload into. If provided, loader data will be copied/blitted
   * into this texture instead of creating a new one.
   */
  texture?: T;
  /**
   * Optional sampler options for the loaded texture. May be used by loaders for mip generation
   * or by blit paths when repacking textures on constrained backends.
   */
  samplerOptions?: SamplerOptions;
};

/**
 * Options for model fetching.
 *
 * Provides decoding and instancing hints used by supported model loaders.
 * @public
 */
export type ModelFetchOptions = {
  /**
   * Explicit MIME type hint for the model. If omitted, inferred from file extension via VFS.
   */
  mimeType?: string;
  /**
   * Optional Draco decoder module for compressed geometry decoding.
   */
  dracoDecoderModule?: DecoderModule;
  /**
   * If true, the created scene node may be prepared for instanced rendering (engine-dependent).
   * Default is false.
   */
  enableInstancing?: boolean;
  /**
   * Optional post-process callback applied to the loaded SharedModel before creating nodes.
   * Use this to remap materials, merge meshes, or apply custom data transforms.
   */
  postProcess?: (model: SharedModel) => SharedModel;
};

/**
 * Data structure returned by AssetManager.fetchModel().
 *
 * Bundles the created scene node group and an optional animation set if present in the asset.
 * @public
 */
export type ModelInfo = {
  /**
   * The root scene node of the loaded model (may contain child hierarchy).
   */
  group: SceneNode;
  /**
   * The animation set associated with the model or null if none.
   */
  animationSet: AnimationSet;
};

/**
 * Centralized asset manager for loading and caching resources.
 *
 * Responsibilities:
 * - Abstracts resource loading via VFS (text/json/binary).
 * - Dispatches texture/model loading to registered loaders by MIME type.
 * - Caches results and uses weak references to allow GPU resources to be GC'd when unused.
 * - Harmonizes cross-backend constraints (e.g., WebGL non-power-of-two rules and sRGB handling).
 * - Provides access to built-in textures with device-restore handlers.
 *
 * Threading/async model:
 * - All I/O is async; repeated calls are coalesced via internal promise caches keyed by URL or hash.
 *
 * @public
 */
export class AssetManager {
  /** @internal */
  private static _builtinTextures: {
    [name: string]: BaseTexture;
  } = {};
  /** @internal */
  private static _builtinTextureLoaders: {
    [name: string]: (assetManager: AssetManager, texture?: BaseTexture) => BaseTexture;
  } = {
    [BUILTIN_ASSET_TEXTURE_SHEEN_LUT]: getSheenLutLoader(64)
  };
  /** @internal */
  private static readonly _textureLoaders: AbstractTextureLoader[] = [
    new WebImageLoader(),
    new DDSLoader(),
    new HDRLoader(),
    new TGALoader()
  ];
  /** @internal */
  private static readonly _modelLoaders: AbstractModelLoader[] = [new GLTFLoader()];
  /** @internal */
  private _textures: {
    [hash: string]: Promise<BaseTexture> | DWeakRef<BaseTexture>;
  };
  /** @internal */
  private _models: {
    [url: string]: Promise<SharedModel> | DWeakRef<SharedModel>;
  };
  /** @internal */
  private _binaryDatas: {
    [url: string]: Promise<ArrayBuffer>;
  };
  /** @internal */
  private _textDatas: {
    [url: string]: Promise<string>;
  };
  /** @internal */
  private _bluePrints: {
    [url: string]: Promise<Record<string, MaterialBlueprintIR>>;
  };
  /** @internal */
  private _materials: {
    [url: string]: Promise<Material> | DWeakRef<Material>;
  };
  /** @internal */
  private _primitives: {
    [url: string]: Promise<Primitive> | DWeakRef<Primitive>;
  };
  /** @internal */
  private _skeletons: {
    [url: string]: Promise<Skeleton> | DWeakRef<Skeleton>;
  };
  /** @internal */
  private _jsonDatas: {
    [url: string]: Promise<any>;
  };
  /** @internal */
  private readonly _serializationManager: SerializationManager;
  /**
   * Creates an instance of AssetManager
   */
  constructor(serializationManager?: SerializationManager) {
    this._serializationManager = serializationManager ?? getEngine().serializationManager;
    this._textures = {};
    this._models = {};
    this._materials = {};
    this._primitives = {};
    this._bluePrints = {};
    this._binaryDatas = {};
    this._textDatas = {};
    this._jsonDatas = {};
  }
  /**
   * VFS used to read resources (files, URLs, virtual mounts).
   */
  get vfs() {
    return this._serializationManager.VFS;
  }
  /**
   * Clear cached references and promises.
   *
   * - Disposes any DWeakRef holders maintained by this manager.
   * - Empties internal maps for textures, models, and raw data (text/json/binary).
   * - Does not forcibly dispose GPU resources; it only clears references so they can be GC'd
   *   if no other owners are holding them.
   */
  clearCache() {
    for (const k in Object.keys(this._textures)) {
      const v = this._textures[k];
      if (v instanceof DWeakRef) {
        v.dispose();
      }
    }
    this._textures = {};
    for (const k in Object.keys(this._models)) {
      const v = this._models[k];
      if (v instanceof DWeakRef) {
        v.dispose();
      }
    }
    this._models = {};
    for (const k in Object.keys(this._materials)) {
      const v = this._materials[k];
      if (v instanceof DWeakRef) {
        v.dispose();
      }
    }
    this._materials = {};
    for (const k in Object.keys(this._primitives)) {
      const v = this._primitives[k];
      if (v instanceof DWeakRef) {
        v.dispose();
      }
    }
    this._primitives = {};
    for (const k in Object.keys(this._skeletons)) {
      const v = this._skeletons[k];
      if (v instanceof DWeakRef) {
        v.dispose();
      }
    }
    this._skeletons = {};
    this._binaryDatas = {};
    this._textDatas = {};
    this._jsonDatas = {};
  }
  /**
   * Register a texture loader (highest priority first).
   *
   * Note: This is a static registry shared by all AssetManager instances.
   *
   * @param loader - A concrete texture loader implementation.
   */
  static addTextureLoader(loader: AbstractTextureLoader): void {
    if (loader) {
      this._textureLoaders.unshift(loader);
    }
  }
  /**
   * Register a model loader (highest priority first).
   *
   * Note: This is a static registry shared by all AssetManager instances.
   *
   * @param loader - A concrete model loader implementation.
   */
  static addModelLoader(loader: AbstractModelLoader) {
    if (loader) {
      this._modelLoaders.unshift(loader);
    }
  }
  /**
   * Fetch a UTF-8 text resource via VFS.
   *
   * - Results are cached per resolved URL (via HttpRequest.urlResolver if provided; otherwise the raw URL).
   * - If cached, any provided postProcess is ignored for subsequent calls; create a separate AssetManager
   *   if you need different post-processing of the same URL.
   *
   * @param url - Resource URL or VFS path.
   * @param postProcess - Optional transformation applied to the loaded text.
   * @param httpRequest - Optional HttpRequest for custom URL resolution/headers.
   * @returns A promise that resolves to the loaded (and optionally processed) text.
   */
  async fetchTextData(
    url: string,
    postProcess?: (text: string) => string,
    httpRequest?: HttpRequest,
    VFSs?: VFS[]
  ): Promise<string> {
    const hash = httpRequest?.urlResolver?.(url) ?? url;
    let P = this._textDatas[hash];
    if (!P) {
      P = this.loadTextData(url, postProcess, VFSs);
      this._textDatas[hash] = P;
    }
    return P;
  }
  /**
   * Fetch a JSON resource via VFS.
   *
   * - Parses as JSON after text load.
   * - Cached per resolved URL. Post-process is applied only on the first load for a given cache key.
   *
   * @param url - Resource URL or VFS path.
   * @param postProcess - Optional transformation applied to the parsed JSON object.
   * @param httpRequest - Optional HttpRequest for custom URL resolution/headers.
   * @returns A promise that resolves to the loaded (and optionally processed) JSON value.
   */
  async fetchJsonData<T = any>(
    url: string,
    postProcess?: (json: T) => T,
    httpRequest?: HttpRequest,
    VFSs?: VFS[]
  ): Promise<T> {
    const hash = httpRequest?.urlResolver?.(url) ?? url;
    let P = this._jsonDatas[hash];
    if (!P) {
      P = this.loadJsonData(url, postProcess, VFSs);
      this._jsonDatas[hash] = P;
    }
    return P;
  }
  /**
   * Fetch a binary resource via VFS.
   *
   * - Cached per resolved URL. Post-process is applied only on first load for a given key.
   *
   * @param url - Resource URL or VFS path.
   * @param postProcess - Optional transformation applied to the loaded ArrayBuffer.
   * @param httpRequest - Optional HttpRequest for custom URL resolution/headers.
   * @returns A promise that resolves to the loaded (and optionally processed) ArrayBuffer.
   */
  async fetchBinaryData(
    url: string,
    postProcess?: (data: ArrayBuffer) => ArrayBuffer,
    httpRequest?: HttpRequest,
    VFSs?: VFS[]
  ): Promise<ArrayBuffer> {
    const hash = httpRequest?.urlResolver?.(url) ?? url;
    let P = this._binaryDatas[hash];
    if (!P) {
      P = this.loadBinaryData(url, postProcess, VFSs);
      this._binaryDatas[hash] = P;
    }
    return P;
  }
  async fetchBluePrint(url: string, VFSs?: VFS[]): Promise<Record<string, MaterialBlueprintIR>> {
    const hash = url;
    let P = this._bluePrints[hash];
    if (!P) {
      P = this.loadBluePrint(url, VFSs);
      this._bluePrints[hash] = P;
    }
    return P;
  }
  /**
   * Fetch a material resource.
   *
   * @typeParam T - Expected concrete material type.
   * @param url - Resource URL or VFS path.
   * @returns A promise that resolves to the loaded material.
   */
  async fetchMaterial<T extends Material = Material>(url: string, VFSs?: VFS[]): Promise<T> {
    const hash = url;
    let P = this._materials[hash] as Promise<T> | DWeakRef<T>;
    if (P instanceof DWeakRef && P.get() && !P.get().disposed) {
      return P.get();
    } else if (!P || P instanceof DWeakRef) {
      P = this.loadMaterial<T>(url, VFSs);
      this._materials[hash] = P;
    }
    const material = await P;
    if (this._materials[hash] instanceof Promise) {
      this._materials[hash] = new DWeakRef<Material>(material);
    }
    return material;
  }
  /**
   * Fetch a primitive resource.
   *
   * @typeParam T - Expected concrete primitive type.
   * @param url - Resource URL or VFS path.
   * @returns A promise that resolves to the loaded primitive.
   */
  async fetchPrimitive<T extends Primitive = Primitive>(url: string, VFSs?: VFS[]): Promise<T> {
    const hash = url;
    let P = this._primitives[hash] as Promise<T> | DWeakRef<T>;
    if (P instanceof DWeakRef && P.get() && !P.get().disposed) {
      return P.get();
    } else if (!P || P instanceof DWeakRef) {
      P = this.loadPrimitive<T>(url, VFSs);
      this._primitives[hash] = P;
    }
    const primitive = await P;
    if (this._primitives[hash] instanceof Promise) {
      this._primitives[hash] = new DWeakRef<Primitive>(primitive);
    }
    return primitive;
  }
  /**
   * Fetch a texture resource via registered loaders.
   *
   * - Chooses loader by explicit MIME type or by VFS file extension inference.
   * - Deduplicates in-flight requests and caches ready textures.
   * - If `options.texture` is provided, the asset will be uploaded/blitted into that texture.
   * - On WebGL backends, enforces constraints by repacking non-power-of-two or sRGB textures.
   *
   * @typeParam T - Expected concrete texture type.
   * @param url - Resource URL or VFS path.
   * @param options - Texture fetching options (color space, sampler, target texture).
   * @param httpRequest - Optional HttpRequest (not used for binary read but may supply URL resolver for hashing).
   * @returns A promise that resolves to the loaded texture.
   */
  async fetchTexture<T extends BaseTexture>(
    url: string,
    options?: TextureFetchOptions<T>,
    VFSs?: VFS[]
  ): Promise<T> {
    if (options?.texture) {
      return this.loadTexture(
        url,
        options.mimeType ?? null,
        !options.linearColorSpace,
        options.samplerOptions,
        options.texture,
        VFSs
      ) as Promise<T>;
    } else {
      const hash = this.getHash('2d', url, options);
      let P = this._textures[hash] as Promise<T> | DWeakRef<T>;
      if (P instanceof DWeakRef && P.get() && !P.get().disposed) {
        return P.get();
      } else if (!P || P instanceof DWeakRef) {
        P = this.loadTexture(
          url,
          options?.mimeType ?? null,
          !options?.linearColorSpace,
          options?.samplerOptions,
          null,
          VFSs
        ) as Promise<T>;
        this._textures[hash] = P;
      }
      const tex: T = await P;
      if (this._textures[hash] instanceof Promise) {
        this._textures[hash] = new DWeakRef<T>(tex);
      }
      return tex;
    }
  }
  /**
   * Fetch a model resource via registered model loaders (data only).
   *
   * - Returns a SharedModel which can create scene nodes in any Scene.
   * - Uses DWeakRef to cache and allow model data to be reclaimed if unused.
   *
   * @param url - Model URL or VFS path.
   * @param options - Model loader options (MIME override, Draco, instancing hint, post-process).
   * @returns A promise that resolves to the SharedModel.
   * @internal
   */
  async fetchModelData(url: string, options?: ModelFetchOptions, VFSs?: VFS[]): Promise<SharedModel> {
    const hash = url;
    let P = this._models[hash];
    if (P instanceof DWeakRef && P.get() && !P.get().disposed) {
      return P.get();
    } else if (!P || P instanceof DWeakRef) {
      P = this.loadModel(url, options, VFSs);
      this._models[hash] = P;
    }
    const sharedModel = await P;
    if (this._models[hash] instanceof Promise) {
      this._models[hash] = new DWeakRef<SharedModel>(sharedModel);
    }
    return sharedModel;
  }
  /**
   * Fetch a model resource and instantiate it under a scene.
   *
   * - Loads or retrieves a cached SharedModel, then creates a SceneNode hierarchy.
   * - Returns both the created group node and any associated AnimationSet.
   *
   * @param scene - Scene into which the model node will be created.
   * @param url - Model URL or VFS path.
   * @param options - Model loader options and instancing hint.
   * @param httpRequest - Optional HttpRequest (unused for binary read; present for API symmetry).
   * @returns A promise with the created node group and animation set info.
   */
  async fetchModel(scene: Scene, url: string, options?: ModelFetchOptions, VFSs?: VFS[]): Promise<ModelInfo> {
    const sharedModel = await this.fetchModelData(url, options, VFSs);
    const node = sharedModel.createSceneNode(scene, !!options?.enableInstancing);
    return { group: node, animationSet: node.animationSet };
  }
  /**
   * Load a text resource via VFS and optionally post-process it.
   *
   * - Does not use or modify the internal cache; use fetchTextData for cached loads.
   *
   * @param url - Resource URL or VFS path.
   * @param postProcess - Optional transformation applied to the text.
   * @returns A promise that resolves to the loaded (and optionally processed) text.
   * @internal
   */
  async loadTextData(url: string, postProcess?: (text: string) => string, VFSs?: VFS[]): Promise<string> {
    let text = (await this.readFileFromVFSs(url, { encoding: 'utf8' }, VFSs)) as string;
    if (postProcess) {
      try {
        text = postProcess(text);
      } catch (err) {
        throw new Error(`Load text data post process failed: ${err}`);
      }
    }
    return text;
  }
  /**
   * Load a JSON resource via VFS and optionally post-process it.
   *
   * - Does not use or modify the internal cache; use fetchJsonData for cached loads.
   *
   * @param url - Resource URL or VFS path.
   * @param postProcess - Optional transformation applied to the parsed JSON.
   * @returns A promise that resolves to the loaded (and optionally processed) JSON.
   * @internal
   */
  async loadJsonData(url: string, postProcess?: (json: any) => any, VFSs?: VFS[]): Promise<string> {
    let json = JSON.parse((await this.readFileFromVFSs(url, { encoding: 'utf8' }, VFSs)) as string);

    if (postProcess) {
      try {
        json = postProcess(json);
      } catch (err) {
        throw new Error(`Load json data post process failed: ${err}`);
      }
    }
    return json;
  }
  /**
   * Load a binary resource via VFS and optionally post-process it.
   *
   * - Does not use or modify the internal cache; use fetchBinaryData for cached loads.
   *
   * @param url - Resource URL or VFS path.
   * @param postProcess - Optional transformation applied to the ArrayBuffer.
   * @returns A promise that resolves to the loaded (and optionally processed) ArrayBuffer.
   * @internal
   */
  async loadBinaryData(
    url: string,
    postProcess?: (data: ArrayBuffer) => ArrayBuffer,
    VFSs?: VFS[]
  ): Promise<ArrayBuffer> {
    try {
      let data = (await this.readFileFromVFSs(url, { encoding: 'binary' }, VFSs)) as ArrayBuffer;
      if (postProcess) {
        data = postProcess(data);
      }
      return data;
    } catch (err) {
      console.error(`Load binary data failed: ${err}`);
      return null;
    }
  }
  async loadPrimitive<T extends Primitive = Primitive>(url: string, VFSs?: VFS[]): Promise<T> {
    try {
      const data = (await this.readFileFromVFSs(url, { encoding: 'utf8' }, VFSs)) as string;
      const content = JSON.parse(data) as { type: string; data: any };
      ASSERT(
        content.type === 'Primitive' || content.type === 'Default',
        `Unsupported primitive type: ${content.type}`
      );
      if (content.type === 'Primitive') {
        const data = content.data as {
          vertices: Record<VertexSemantic, { format: VertexAttribFormat; data: string }>;
          indices: string;
          indexType: 'u16' | 'u32';
          indexCount: number;
          type: PrimitiveType;
          boxMin: number[];
          boxMax: number[];
        };
        const primitive = new Primitive();
        for (const k in data.vertices) {
          const v = data.vertices[k as VertexSemantic];
          const vertexData = base64ToUint8Array(v.data);
          primitive.createAndSetVertexBuffer(v.format, vertexData);
        }
        if (data.indices) {
          const indexData = base64ToUint8Array(data.indices);
          const indices =
            data.indexType === 'u16'
              ? new Uint16Array(indexData.buffer)
              : data.indexType === 'u32'
                ? new Uint32Array(indexData.buffer)
                : null;
          if (!indices) {
            console.error(`Invalid index type in primitive data: ${data.indexType}`);
            return null;
          }
          primitive.createAndSetIndexBuffer(indices);
        }
        primitive.primitiveType = data.type;
        primitive.indexCount = data.indexCount;
        primitive.setBoundingVolume(
          new BoundingBox(
            new Vector3(data.boxMin[0], data.boxMin[1], data.boxMin[2]),
            new Vector3(data.boxMax[0], data.boxMax[1], data.boxMax[2])
          )
        );
        return primitive as T;
      } else {
        const obj = await this._serializationManager.deserializeObject<T>(null, content.data);
        if (!(obj instanceof Primitive)) {
          if (typeof (obj as any).dispose === 'function') {
            (obj as any).dispose();
          }
          return null;
        }
        return obj;
      }
    } catch (err) {
      console.error(`Load primitive failed: ${err}`);
      return null;
    }
  }
  /**
   * Load a material.
   *
   * - Does not use or modify the internal cache; use fetchMaterial for cached loads.
   *
   * @param url - Resource URL or VFS path.
   * @returns A promise that resolves to the loaded material.
   * @internal
   */
  async loadMaterial<T extends Material = Material>(url: string, VFSs?: VFS[]): Promise<T> {
    try {
      const data = (await this.readFileFromVFSs(url, { encoding: 'utf8' }, VFSs)) as string;
      const content = JSON.parse(data) as { type: string; data: any };
      ASSERT(
        content.type === 'PBRBluePrintMaterial' || content.type === 'Default',
        `Unsupported material type: ${content.type}`
      );
      if (content.type === 'PBRBluePrintMaterial') {
        const ir = await this.fetchBluePrint(content.data.IR as string, VFSs);
        const material = new PBRBluePrintMaterial(ir['fragment'], ir['vertex']);
        const uniformValues: IRUniformValue[] = (
          content.data.uniformValues as { name: string; value: number[] }[]
        ).map((v) => ({
          node: null,
          name: v.name,
          value: v.value.length === 1 ? v.value[0] : new Float32Array(v.value)
        }));
        const uniformTextures: IRUniformTexture[] = [];
        const textures = content.data.uniformTextures as {
          name: string;
          id: number;
          texture: string;
          wrapS: string;
          wrapT: string;
          minFilter: string;
          magFilter: string;
          mipFilter: string;
        }[];
        for (const v of textures) {
          uniformTextures.push({
            node: null,
            name: v.name,
            texture: new DRef(await this.fetchTexture(v.texture, null, VFSs)),
            sampler: new DRef(
              getDevice().createSampler({
                addressU: v.wrapS as TextureAddressMode,
                addressV: v.wrapT as TextureAddressMode,
                minFilter: v.minFilter as TextureFilterMode,
                magFilter: v.magFilter as TextureFilterMode,
                mipFilter: v.mipFilter as TextureFilterMode
              })
            )
          });
        }
        material.uniformValues = uniformValues;
        material.uniformTextures = uniformTextures;
        return material as unknown as T;
      } else {
        const obj = await this._serializationManager.deserializeObject<T>(null, content.data);
        if (!(obj instanceof Material)) {
          if (typeof (obj as any).dispose === 'function') {
            (obj as any).dispose();
          }
          return null;
        }
        return obj;
      }
    } catch (err) {
      console.error(`Load material failed: ${err}`);
      return null;
    }
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
  async loadBluePrint(path: string, VFSs?: VFS[]) {
    try {
      const content = (await this.readFileFromVFSs(path, { encoding: 'utf8' }, VFSs)) as string;
      const bp = JSON.parse(content) as {
        type: string;
        state: Record<
          string,
          {
            nodes: {
              id: number;
              locked: boolean;
              node: object;
            }[];
            links: { startNodeId: number; startSlotId: number; endNodeId: number; endSlotId: number }[];
          }
        >;
      };
      ASSERT(
        bp.type === 'PBRMaterial' || bp.type === 'MaterialFunction',
        `Unsupported blueprint type: ${bp.type}`
      );
      const states = bp.state;
      const nodeMap: Record<number, IGraphNode> = {};
      const roots: number[] = [];
      const result: Record<string, MaterialBlueprintIR> = {};
      for (const k of Object.keys(states)) {
        const state = states[k];
        for (const node of state.nodes) {
          const impl = await this._serializationManager.deserializeObject<IGraphNode>(null, node.node);
          nodeMap[node.id] = impl;
          if (impl.outputs.length === 0) {
            roots.push(node.id);
          }
        }
        const dag = await this.createBluePrintDAG(nodeMap, roots, state.links);
        result[k] = new MaterialBlueprintIR(dag, path);
      }
      return result;
    } catch (err) {
      const msg = `Load material failed: ${err}`;
      console.error(msg);
      return null;
    }
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
    for (const loader of AssetManager._textureLoaders) {
      if (!loader.supportMIMEType(mimeType)) {
        continue;
      }
      const tex = await this.doLoadTexture(loader, mimeType, arrayBuffer, !!srgb, samplerOptions, texture);
      return tex as T;
    }
    throw new Error(`Can not find loader for MIME type '${mimeType}'`);
  }
  /**
   * Load a texture via VFS by URL and MIME type.
   *
   * - Uses the first loader that supports the inferred or provided MIME type.
   * - On WebGL, may repack textures (resample to power-of-two, convert formats) to meet backend constraints.
   * - If `texture` is provided, the source is blitted into it, possibly resizing or changing sampling accordingly.
   *
   * @param url - Texture URL or VFS path.
   * @param mimeType - Optional explicit MIME type; otherwise inferred by VFS.
   * @param srgb - If true, treat image as sRGB; otherwise linear.
   * @param samplerOptions - Optional sampler options for loader or blit path.
   * @param texture - Optional destination texture to populate.
   * @returns A promise that resolves to the created or populated texture.
   * @internal
   */
  async loadTexture(
    url: string,
    mimeType?: string,
    srgb?: boolean,
    samplerOptions?: SamplerOptions,
    texture?: BaseTexture,
    VFSs?: VFS[]
  ): Promise<BaseTexture> {
    const data = (await this.readFileFromVFSs(url, { encoding: 'binary' }, VFSs)) as ArrayBuffer;
    mimeType = mimeType ?? this.vfs.guessMIMEType(url);
    for (const loader of AssetManager._textureLoaders) {
      if (!loader.supportMIMEType(mimeType)) {
        continue;
      }
      const tex = await this.doLoadTexture(loader, mimeType, data, !!srgb, samplerOptions, texture);
      tex.name = this.vfs.basename(url);
      return tex;
    }
    throw new Error(`Can not find loader for asset ${url}`);
  }
  /**
   * Internal routine that executes the texture load using a specific loader and applies
   * backend-specific compatibility steps (e.g., WebGL NPOT/sRGB rules).
   *
   * @param loader - Concrete loader to use for decoding/creation.
   * @param mimeType - Texture MIME type.
   * @param data - Raw binary data.
   * @param srgb - If true, treat image as sRGB; otherwise linear.
   * @param samplerOptions - Optional sampler options.
   * @param texture - Optional destination texture to populate.
   * @returns A promise that resolves to the created or populated texture.
   * @internal
   */
  async doLoadTexture(
    loader: AbstractTextureLoader,
    mimeType: string,
    data: ArrayBuffer | TypedArray,
    srgb: boolean,
    samplerOptions?: SamplerOptions,
    texture?: BaseTexture
  ): Promise<BaseTexture> {
    const device = getDevice();
    if (device.type !== 'webgl') {
      return await loader.load(mimeType, data, srgb, samplerOptions, texture);
    } else {
      let tex = await loader.load(mimeType, data, srgb, samplerOptions);
      if (texture) {
        const magFilter = tex.width !== texture.width || tex.height !== texture.height ? 'linear' : 'nearest';
        const minFilter = magFilter;
        const mipFilter = 'none';
        const sampler = device.createSampler({
          addressU: 'clamp',
          addressV: 'clamp',
          magFilter,
          minFilter,
          mipFilter
        });
        const blitter = new CopyBlitter();
        blitter.blit(tex as any, texture as any, sampler);
        tex = texture;
      } else {
        const po2_w = isPowerOf2(tex.width);
        const po2_h = isPowerOf2(tex.height);
        const srgb = tex.isSRGBFormat();
        if (srgb || !po2_w || !po2_h) {
          const newWidth = po2_w ? tex.width : nextPowerOf2(tex.width);
          const newHeight = po2_h ? tex.height : nextPowerOf2(tex.height);
          const magFilter = newWidth !== tex.width || newHeight !== tex.height ? 'linear' : 'nearest';
          const minFilter = magFilter;
          const mipFilter = 'none';
          const sampler = device.createSampler({
            addressU: 'clamp',
            addressV: 'clamp',
            magFilter,
            minFilter,
            mipFilter
          });
          const destFormat = srgb ? 'rgba8unorm' : tex.format;
          const blitter = new CopyBlitter();
          const newTexture = tex.isTexture2D()
            ? device.createTexture2D(destFormat, newWidth, newHeight)
            : device.createCubeTexture(destFormat, newWidth);
          blitter.blit(tex as any, newTexture as any, sampler);
          tex.dispose();
          tex = newTexture;
        }
      }
      return tex;
    }
  }
  /**
   * Load a model via registered model loaders.
   *
   * - Selects loader by MIME type (explicit or inferred).
   * - Optionally applies a post-process transform to the SharedModel.
   * - Sets the model's name from the source filename for convenience.
   *
   * @param url - Model URL or VFS path.
   * @param options - Model load options (MIME override, Draco module, post-process hook).
   * @returns A promise that resolves to the loaded SharedModel.
   * @internal
   */
  async loadModel(url: string, options?: ModelFetchOptions, VFSs?: VFS[]): Promise<SharedModel> {
    const arrayBuffer = (await this.readFileFromVFSs(url, { encoding: 'binary' }, VFSs)) as ArrayBuffer;
    const mimeType = options?.mimeType || this.vfs.guessMIMEType(url);
    const data = new Blob([arrayBuffer], { type: mimeType });
    const filename = this.vfs.basename(url);
    for (const loader of AssetManager._modelLoaders) {
      if (!loader.supportMIMEType(mimeType)) {
        continue;
      }
      let model = await loader.load(
        this,
        url,
        options?.mimeType || data.type,
        data,
        options?.dracoDecoderModule,
        VFSs
      );
      if (!model) {
        throw new Error(`Load asset failed: ${url}`);
      }
      if (options?.postProcess) {
        try {
          model = options.postProcess(model);
        } catch (err) {
          throw new Error(`Model loader post process failed: ${err}`);
        }
      }
      model.name = filename;
      return model;
    }
    throw new Error(`Can not find loader for asset ${url}`);
  }
  /**
   * Fetch a built-in texture synchronously by name.
   *
   * - If this built-in was not created yet, the registered loader is invoked.
   * - Registers a device restore handler so the texture can be re-initialized after device loss.
   * - If an existing texture is provided, the loader uploads into it.
   *
   * @typeParam T - Expected concrete texture type.
   * @param name - Built-in texture identifier.
   * @param texture - Optional destination texture to populate.
   * @returns The built-in texture (created or populated).
   */
  fetchBuiltinTexture<T extends BaseTexture>(name: string, texture?: T): T {
    const loader = AssetManager._builtinTextureLoaders[name];
    if (!loader) {
      throw new Error(`Unknown builtin texture name: ${name}`);
    }
    if (texture) {
      return loader(this, texture) as T;
    } else {
      texture = AssetManager._builtinTextures[name] as T;
      if (!texture) {
        texture = loader(this) as T;
        AssetManager._builtinTextures[name] = texture;
      }
      texture.restoreHandler = (tex) => {
        loader(this, tex as BaseTexture);
      };
      return texture;
    }
  }
  /**
   * Override or unregister the loader for a named built-in texture.
   *
   * - Passing a valid loader function sets/overrides the creation path.
   * - Passing `undefined` removes the loader mapping for the given name.
   *
   * @param name - Built-in texture identifier.
   * @param loader - Factory that creates the built-in texture using the provided AssetManager.
   */
  static setBuiltinTextureLoader(name: string, loader: (assetManager: AssetManager) => BaseTexture): void {
    if (loader) {
      this._builtinTextureLoaders[name] = loader;
    } else {
      this._builtinTextureLoaders[name] = undefined;
    }
  }
  /**
   * Compute a cache key for texture requests.
   *
   * Includes texture type tag, URL, and color space choice to avoid cross-color-space cache collisions.
   *
   * @typeParam T - Texture type parameter (not used for runtime behavior; helps preserve generic intent).
   * @param type - Logical texture type tag (e.g., '2d', 'cube').
   * @param url - Resource URL or VFS path.
   * @param options - Texture fetch options to incorporate into the key.
   * @returns A string cache key combining type, URL, and color space choice.
   * @internal
   */
  private getHash<T extends BaseTexture>(type: string, url: string, options: TextureFetchOptions<T>): string {
    return `${type}:${url}:${!options?.linearColorSpace}`;
  }
  /**
   * Try reading from file from a list of VFSs
   *
   * @param path - File path
   * @param options - Read options
   * @param vfsList - VFS list
   * @returns File content
   *
   * @internal
   */
  async readFileFromVFSs(path: string, options: ReadOptions, vfsList?: VFS[]) {
    vfsList = vfsList ?? [this.vfs];
    for (const vfs of vfsList) {
      if (!(await vfs.exists(path))) {
        continue;
      }
      const stat = await vfs.stat(path);
      if (!stat || !stat.isFile) {
        continue;
      }
      return await vfs.readFile(path, options);
    }
    throw new VFSError('File does not exist', 'ENOENT', path);
  }
  /**
   * Write file to a list of VFSs
   *
   * @param path - File path
   * @param data - Data to write
   * @param options - Write options
   * @param vfsList - Which VFSs will be written to
   */
  async writeFileToVFSs(path: string, data: ArrayBuffer | string, options: WriteOptions, vfsList?: VFS[]) {
    vfsList = vfsList ?? [this.vfs];
    for (const vfs of vfsList) {
      await vfs.writeFile(path, data, options);
    }
  }
}
