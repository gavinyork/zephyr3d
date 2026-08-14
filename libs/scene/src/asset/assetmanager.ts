import type { DecoderModule } from 'draco3d';
import type { HttpRequest, Nullable, ReadOptions, TypedArray, VFS, WriteOptions } from '@zephyr3d/base';
import {
  isPowerOf2,
  nextPowerOf2,
  DWeakRef,
  DRef,
  base64ToUint8Array,
  Vector3,
  ASSERT,
  Vector4,
  guessMimeType
} from '@zephyr3d/base';
import type { SharedModel } from './model';
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
import type { AbstractTextureLoader } from './loaders/loader';
import { TGALoader } from './loaders/image/tga_Loader';
import { getDevice, getEngine } from '../app/api';
import {
  Material,
  PBRBluePrintMaterial,
  PBRBluePrintMaterialInstance,
  SpriteBlueprintMaterial
} from '../material';
import type {
  BluePrintEditorState,
  BluePrintUniformTexture,
  BluePrintUniformValue,
  GraphStructure,
  IGraphNode,
  NodeConnection,
  ResourceManager
} from '../utility';
import { BoundingBox } from '../utility/bounding_volume';
import { MaterialBlueprintIR } from '../utility/blueprint/material/ir';
import { getDefaultTexture2D } from '../utility/blueprint/material/texture';
import type { Skeleton } from '../animation';
import { Primitive } from '../render';
import { FontAsset } from '../text';

/**
 * Base fetch options
 *
 * @public
 */
export type BaseFetchOptions = {
  /**
   * VFS used to fetch file data
   */
  overrideVFS?: VFS;
};

/**
 * Options for font fetching.
 * @public
 */
export type FontAssetFetchOptions = BaseFetchOptions & {
  pageSize?: number;
  glyphSize?: number;
};

/**
 * Options for texture fetching.
 *
 * Controls how a texture is loaded, converted, and optionally uploaded into an existing texture object.
 *
 * @typeParam T - Texture type to be returned, extending BaseTexture.
 * @public
 */
export type TextureFetchOptions<T extends BaseTexture> = BaseFetchOptions & {
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
export type ModelFetchOptions = BaseFetchOptions & {
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
   * If true, meshes will be loaded from this model.
   * Default is true.
   */
  loadMeshes?: boolean;
  /**
   * If true, rigs and skin bindings will be loaded from this model.
   * Default is true.
   */
  loadSkeletons?: boolean;
  /**
   * If true, animations will be loaded from this model.
   * Default is true.
   */
  loadAnimations?: boolean;
  /**
   * If true, automatically create joint dynamics (for VRM models only).
   * Default is true.
   */
  loadJointDynamics?: boolean;
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
 * Interface for model importers
 *
 * @public
 */
export interface ModelLoader {
  loadModel(path: string, vfs?: VFS): Promise<SharedModel>;
}

type AssetCacheKind =
  | 'texture'
  | 'model'
  | 'binary'
  | 'font'
  | 'text'
  | 'blueprint'
  | 'material'
  | 'primitive'
  | 'skeleton'
  | 'json';

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
  private _modelLoaders: Record<string, ModelLoader> = {};
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
    [url: string]: Promise<Nullable<ArrayBuffer>>;
  };
  /** @internal */
  private _fontAssets: {
    [url: string]: Nullable<FontAsset> | Promise<Nullable<FontAsset>>;
  };
  /** @internal */
  private _textDatas: {
    [url: string]: Promise<string>;
  };
  /** @internal */
  private _bluePrints: {
    [url: string]: Promise<Nullable<Record<string, MaterialBlueprintIR>>>;
  };
  /** @internal */
  private _materials: {
    [url: string]: Promise<Nullable<Material>> | DWeakRef<Material>;
  };
  /** @internal */
  private _primitives: {
    [url: string]: Promise<Nullable<Primitive>> | DWeakRef<Primitive>;
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
  private readonly _cacheKeysByPath: Map<string, Set<string>>;
  /** @internal */
  private readonly _cachePathByKey: Map<string, string>;
  /** @internal */
  private readonly _resourceManager: ResourceManager;
  /**
   * Creates an instance of AssetManager
   */
  constructor(resourceManager?: ResourceManager) {
    this._resourceManager = resourceManager ?? getEngine().resourceManager;
    this._textures = {};
    this._models = {};
    this._materials = {};
    this._primitives = {};
    this._skeletons = {};
    this._bluePrints = {};
    this._binaryDatas = {};
    this._fontAssets = {};
    this._textDatas = {};
    this._jsonDatas = {};
    this._cacheKeysByPath = new Map();
    this._cachePathByKey = new Map();
  }
  /**
   * VFS used to read resources (files, URLs, virtual mounts).
   */
  get vfs() {
    return this._resourceManager.VFS;
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
    this.clearCacheEntries(this._textures);
    this._textures = {};
    this.clearCacheEntries(this._models);
    this._models = {};
    this.clearCacheEntries(this._materials);
    this._materials = {};
    this.clearCacheEntries(this._primitives);
    this._primitives = {};
    this.clearCacheEntries(this._skeletons);
    this._skeletons = {};
    this._bluePrints = {};
    this._fontAssets = {};
    this._binaryDatas = {};
    this._textDatas = {};
    this._jsonDatas = {};
    this._cacheKeysByPath.clear();
    this._cachePathByKey.clear();
  }
  /**
   * Evicts cached data loaded from a VFS path.
   *
   * Existing scene objects keep their current resources. Subsequent loads read the asset again.
   *
   * @param path - Changed VFS file or directory path.
   * @param recursive - Whether entries below a directory path should also be evicted.
   * @returns Number of cache entries removed.
   */
  invalidateAsset(path: string, recursive = false) {
    const normalizedPath = this.vfs.normalizePath(path);
    let removed = 0;
    const indexedPaths = recursive
      ? [...this._cacheKeysByPath.keys()].filter((sourcePath) =>
          this.cachePathMatches(sourcePath, normalizedPath, true)
        )
      : [normalizedPath];
    for (const sourcePath of indexedPaths) {
      const tokens = this._cacheKeysByPath.get(sourcePath);
      if (!tokens) {
        continue;
      }
      for (const token of [...tokens]) {
        const separator = token.indexOf('\0');
        const kind = token.slice(0, separator) as AssetCacheKind;
        const key = token.slice(separator + 1);
        if (this.removeCacheEntry(kind, key)) {
          removed++;
        }
      }
    }
    return removed;
  }
  private clearCacheEntries<T>(cache: Record<string, T>, matches: (key: string) => boolean = () => true) {
    let removed = 0;
    for (const key of Object.keys(cache)) {
      if (!matches(key)) {
        continue;
      }
      const cached = cache[key];
      if (cached instanceof DWeakRef) {
        cached.dispose();
      }
      delete cache[key];
      removed++;
    }
    return removed;
  }
  private cachePathMatches(cachePath: string, normalizedPath: string, recursive: boolean) {
    return (
      cachePath === normalizedPath ||
      (recursive &&
        cachePath.startsWith(normalizedPath.endsWith('/') ? normalizedPath : `${normalizedPath}/`))
    );
  }
  private normalizeAssetSourcePath(path: string) {
    return /^(?:[a-z]+:)?\/\//i.test(path) || path.startsWith('data:') || path.startsWith('blob:')
      ? path
      : this.vfs.normalizePath(path);
  }
  private getCache(kind: AssetCacheKind): Record<string, unknown> {
    switch (kind) {
      case 'texture':
        return this._textures;
      case 'model':
        return this._models;
      case 'binary':
        return this._binaryDatas;
      case 'font':
        return this._fontAssets;
      case 'text':
        return this._textDatas;
      case 'blueprint':
        return this._bluePrints;
      case 'material':
        return this._materials;
      case 'primitive':
        return this._primitives;
      case 'skeleton':
        return this._skeletons;
      case 'json':
        return this._jsonDatas;
    }
  }
  private getCacheToken(kind: AssetCacheKind, key: string) {
    return `${kind}\0${key}`;
  }
  private trackCacheEntry(kind: AssetCacheKind, key: string, sourcePath: string) {
    const token = this.getCacheToken(kind, key);
    const normalizedSourcePath = this.normalizeAssetSourcePath(sourcePath);
    const previousPath = this._cachePathByKey.get(token);
    if (previousPath === normalizedSourcePath) {
      return;
    }
    if (previousPath) {
      const previousKeys = this._cacheKeysByPath.get(previousPath);
      previousKeys?.delete(token);
      if (previousKeys?.size === 0) {
        this._cacheKeysByPath.delete(previousPath);
      }
    }
    let keys = this._cacheKeysByPath.get(normalizedSourcePath);
    if (!keys) {
      keys = new Set();
      this._cacheKeysByPath.set(normalizedSourcePath, keys);
    }
    keys.add(token);
    this._cachePathByKey.set(token, normalizedSourcePath);
  }
  private removeCacheEntry(kind: AssetCacheKind, key: string) {
    const cache = this.getCache(kind);
    const existed = key in cache;
    if (existed) {
      const cached = cache[key];
      if (cached instanceof DWeakRef) {
        cached.dispose();
      }
      delete cache[key];
    }
    const token = this.getCacheToken(kind, key);
    const sourcePath = this._cachePathByKey.get(token);
    if (sourcePath) {
      const keys = this._cacheKeysByPath.get(sourcePath);
      keys?.delete(token);
      if (keys?.size === 0) {
        this._cacheKeysByPath.delete(sourcePath);
      }
      this._cachePathByKey.delete(token);
    }
    return existed;
  }
  /**
   * Removes a cached font asset entry by URL.
   *
   * This only evicts the cache entry. It does not dispose any external references to the FontAsset.
   *
   * @param url - Resource URL or VFS path.
   * @returns `true` if a cache entry existed and was removed.
   */
  releaseFontAsset(url: string) {
    return this.removeCacheEntry('font', url);
  }
  /**
   * Remove one material entry from cache.
   *
   * @param url - Material asset path.
   * @returns `true` if an entry existed and was removed.
   */
  invalidateMaterial(url: string) {
    return this.removeCacheEntry('material', url);
  }
  /**
   * Register a texture loader (highest priority first).
   *
   * Note: This is a static registry shared by all AssetManager instances.
   *
   * @param loader - A concrete texture loader implementation.
   */
  static addTextureLoader(loader: AbstractTextureLoader) {
    if (loader) {
      this._textureLoaders.unshift(loader);
    }
  }
  /**
   * Register a model loader (highest priority first).
   */
  setModelLoader(mimeType: string, loader: ModelLoader) {
    if (loader) {
      this._modelLoaders[mimeType] = loader;
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
    options?: BaseFetchOptions
  ) {
    const hash = httpRequest?.urlResolver?.(url) ?? url;
    let P = this._textDatas[hash];
    if (!P) {
      P = this.loadTextData(url, postProcess, options?.overrideVFS);
      this._textDatas[hash] = P;
      this.trackCacheEntry('text', hash, url);
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
    options?: BaseFetchOptions
  ): Promise<T> {
    const hash = httpRequest?.urlResolver?.(url) ?? url;
    let P = this._jsonDatas[hash] as Promise<T>;
    if (!P) {
      P = this.loadJsonData<T>(url, postProcess, options?.overrideVFS);
      this._jsonDatas[hash] = P;
      this.trackCacheEntry('json', hash, url);
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
    postProcess?: Nullable<(data: ArrayBuffer) => ArrayBuffer>,
    httpRequest?: Nullable<HttpRequest>,
    options?: BaseFetchOptions
  ) {
    const hash = httpRequest?.urlResolver?.(url) ?? url;
    let P = this._binaryDatas[hash];
    if (!P) {
      P = this.loadBinaryData(url, postProcess, options?.overrideVFS);
      this._binaryDatas[hash] = P;
      this.trackCacheEntry('binary', hash, url);
    }
    return P;
  }
  /**
   * Fetch a font asset via VFS.
   *
   * - Cached per URL only.
   * - `options` are applied only when the font is first loaded for that URL.
   * - If the URL is already cached, later calls ignore `options` and reuse the cached FontAsset.
   *
   * @param url - Resource URL or VFS path.
   * @param options - Optional MSDF atlas settings bound to the loaded FontAsset.
   * @returns A promise that resolves to the loaded (and optionally processed) font asset.
   */
  async fetchFontAsset(url: string, options?: FontAssetFetchOptions) {
    const hash = url;
    let P = this._fontAssets[hash];
    if (!P) {
      P = new Promise<Nullable<FontAsset>>((resolve, reject) => {
        this.loadBinaryData(url, null, options?.overrideVFS)
          .then((data) => {
            resolve(data ? FontAsset.fromBuffer(data, options) : null);
          })
          .catch((err) => {
            reject(
              new Error(`Failed to load font asset from ${url}: ${err instanceof Error ? err.message : err}`)
            );
          });
      });
      this._fontAssets[hash] = P;
      this.trackCacheEntry('font', hash, url);
    }
    return P;
  }
  /**
   * Fetch a font asset via VFS if already cached.
   * @param url - Resource URL or VFS path.
   * @returns The cached FontAsset if it exists and is loaded, or null if not cached or still loading.
   */
  getFontAsset(url: string): Nullable<FontAsset> {
    const hash = url;
    return this._fontAssets[hash] instanceof Promise ? null : (this._fontAssets[hash] ?? null);
  }
  async fetchBluePrint(url: string, options?: BaseFetchOptions) {
    const hash = url;
    let P = this._bluePrints[hash];
    if (!P) {
      P = this.loadBluePrint(url, options?.overrideVFS);
      this._bluePrints[hash] = P;
      this.trackCacheEntry('blueprint', hash, url);
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
  async fetchMaterial<T extends Material = Material>(
    url: string,
    options?: BaseFetchOptions
  ): Promise<Nullable<T>> {
    const hash = url;
    let P = this._materials[hash] as Promise<Nullable<T>> | DWeakRef<T>;
    if (P instanceof DWeakRef && P.get() && !P.get()!.disposed) {
      return P.get()!;
    } else if (!P || P instanceof DWeakRef) {
      P = this.loadMaterial<T>(url, false, options?.overrideVFS);
      this._materials[hash] = P;
      this.trackCacheEntry('material', hash, url);
    }
    const material = await P;
    if (this._materials[hash] === P) {
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
  async fetchPrimitive<T extends Primitive = Primitive>(
    url: string,
    options?: BaseFetchOptions
  ): Promise<Nullable<T>> {
    const hash = url;
    let P = this._primitives[hash] as Promise<Nullable<T>> | DWeakRef<T>;
    if (P instanceof DWeakRef && P.get() && !P.get()!.disposed) {
      return P.get()!;
    } else if (!P || P instanceof DWeakRef) {
      P = this.loadPrimitive<T>(url, options?.overrideVFS);
      this._primitives[hash] = P;
      this.trackCacheEntry('primitive', hash, url);
    }
    const primitive = await P;
    if (this._primitives[hash] === P) {
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
  async fetchTexture<T extends BaseTexture>(url: string, options?: TextureFetchOptions<T>): Promise<T> {
    if (options?.texture) {
      return this.loadTexture(
        url,
        options.mimeType ?? null,
        !options.linearColorSpace,
        options.samplerOptions,
        options.texture,
        options.overrideVFS
      ) as Promise<T>;
    } else {
      const hash = this.getHash('2d', url, options);
      let P = this._textures[hash] as Promise<T> | DWeakRef<T>;
      if (P instanceof DWeakRef && P.get() && !P.get()!.disposed) {
        return P.get()!;
      } else if (!P || P instanceof DWeakRef) {
        P = this.loadTexture(
          url,
          options?.mimeType ?? null,
          !options?.linearColorSpace,
          options?.samplerOptions,
          null,
          options?.overrideVFS
        ) as Promise<T>;
        this._textures[hash] = P;
        this.trackCacheEntry('texture', hash, url);
      }
      const tex: T = await P;
      if (this._textures[hash] === P) {
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
  async fetchModelData(url: string, options?: ModelFetchOptions) {
    const hash = url;
    let P = this._models[hash];
    if (P instanceof DWeakRef && P.get() && !P.get()!.disposed) {
      return P.get()!;
    } else if (!P || P instanceof DWeakRef) {
      P = this.loadModel(url, options, options?.overrideVFS);
      this._models[hash] = P;
      this.trackCacheEntry('model', hash, url);
    }
    const sharedModel = await P;
    if (this._models[hash] === P) {
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
   *
   * @internal
   */
  async fetchModel(scene: Scene, url: string, options?: ModelFetchOptions) {
    const sharedModel = new DRef<SharedModel>();
    try {
      sharedModel.set(await this.fetchModelData(url, options));
      const node = await sharedModel
        .get()!
        .createSceneNode(
          getEngine().resourceManager,
          scene,
          options?.enableInstancing ?? false,
          options?.loadMeshes ?? true,
          options?.loadSkeletons ?? true,
          options?.loadAnimations ?? true,
          options?.loadJointDynamics ?? true,
          options?.overrideVFS ?? getEngine().resourceManager.VFS
        );
      node.sharedModel = sharedModel.get();
      node.animationSet.resetSkeletonModifiers();
      return node;
    } catch (err) {
      console.error(`Load model failed: ${url}: ${err}`);
    } finally {
      sharedModel.dispose();
    }
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
  async loadTextData(url: string, postProcess?: (text: string) => string, vfs?: VFS) {
    let text = (await this.readFileFromVFS(url, { encoding: 'utf8' }, vfs)) as string;
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
  async loadJsonData<T = unknown>(url: string, postProcess?: (json: any) => any, vfs?: VFS): Promise<T> {
    let json = JSON.parse((await this.readFileFromVFS(url, { encoding: 'utf8' }, vfs)) as string) as T;

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
  async loadBinaryData(url: string, postProcess?: Nullable<(data: ArrayBuffer) => ArrayBuffer>, vfs?: VFS) {
    try {
      let data = (await this.readFileFromVFS(url, { encoding: 'binary' }, vfs)) as ArrayBuffer;
      if (postProcess) {
        data = postProcess(data);
      }
      return data;
    } catch (err) {
      console.error(`Load binary data failed: ${err}`);
      return null;
    }
  }
  async loadPrimitive<T extends Primitive = Primitive>(url: string, vfs?: VFS): Promise<Nullable<T>> {
    try {
      const data = (await this.readFileFromVFS(url, { encoding: 'utf8' }, vfs)) as string;
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
        const obj = await this._resourceManager.deserializeObject<T>(null, content.data);
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
  async reloadBluePrintMaterials(filter?: (m: PBRBluePrintMaterial) => boolean) {
    const promises: Promise<Nullable<Material>>[] = [];
    const paths: string[] = [];
    for (const k of Object.keys(this._materials)) {
      const m = this._materials[k];
      if (m instanceof Promise) {
        promises.push(m);
        paths.push(k);
      } else if (m instanceof DWeakRef && !!m.get()) {
        promises.push(Promise.resolve(m.get()!));
        paths.push(k);
      }
    }
    const materials = await Promise.all(promises);
    const knownPaths = new Set(paths);
    for (const assetId of this._resourceManager.getTrackedMaterialAssetIds()) {
      if (knownPaths.has(assetId)) {
        continue;
      }
      const refs = this._resourceManager.getMaterialRefsByAssetId(assetId);
      for (const ref of refs ?? []) {
        const material = ref.get();
        if (material instanceof PBRBluePrintMaterial && !material.disposed) {
          materials.push(material);
          paths.push(assetId);
          knownPaths.add(assetId);
          break;
        }
      }
    }

    // Reload blueprint parents first so dependent instances always resync against the latest parent state.
    for (let i = 0; i < materials.length; i++) {
      const m = materials[i];
      if (
        m instanceof PBRBluePrintMaterial &&
        !(m instanceof PBRBluePrintMaterialInstance) &&
        (!filter || filter(m))
      ) {
        const content = JSON.parse(
          (await this.readFileFromVFS(paths[i], { encoding: 'utf8' })) as string
        ) as {
          type: string;
          props?: Record<string, unknown>;
        };
        const data = await this.loadBluePrintMaterialData(paths[i], true);
        if (data) {
          m.fragmentIR = data.irFragment!;
          m.vertexIR = data.irVertex!;
          m.uniformValues = data.uniformValues;
          m.uniformTextures = data.uniformTextures;
          if (content.type === 'PBRBluePrintMaterial' && content.props) {
            await this._resourceManager.deserializeObjectProps(m, content.props);
          }
          this._resourceManager.syncMaterialReferences(m);
        }
      }
    }

    // Then reload instances from disk so override maps stay in sync with the refreshed parent materials.
    for (let i = 0; i < materials.length; i++) {
      const m = materials[i];
      if (m instanceof PBRBluePrintMaterialInstance && (!filter || filter(m))) {
        const content = JSON.parse(
          (await this.readFileFromVFS(paths[i], { encoding: 'utf8' })) as string
        ) as {
          type: string;
          data?: {
            parent?: string;
            uniformValues?: BluePrintUniformValue[];
            uniformTextures?: BluePrintUniformTexture[];
          };
        };
        if (content.type !== 'PBRBluePrintMaterialInstance' || !content.data?.parent) {
          continue;
        }
        const parent = await this.fetchMaterial<PBRBluePrintMaterial>(content.data.parent);
        if (!(parent instanceof PBRBluePrintMaterial)) {
          continue;
        }
        m.setParentMaterial(parent, content.data.parent);
        m.setOverrides(
          content.data.uniformValues ?? [],
          await this.hydrateBluePrintUniformTextures(content.data.uniformTextures ?? [])
        );
        const instanceContent = JSON.parse(
          (await this.readFileFromVFS(paths[i], { encoding: 'utf8' })) as string
        ) as {
          type: string;
          props?: Record<string, unknown>;
        };
        if (instanceContent.type === 'PBRBluePrintMaterialInstance' && instanceContent.props) {
          await this._resourceManager.deserializeObjectProps(m, instanceContent.props);
        }
        m.setMaterialPropertyOverrides(Object.keys(instanceContent.props ?? {}));
        this._resourceManager.syncMaterialReferences(m);
      }
    }
  }
  private async loadBluePrintMaterialData(
    url:
      | string
      | { IR: string; uniformValues: BluePrintUniformValue[]; uniformTextures: BluePrintUniformTexture[] },
    reload: boolean,
    vfs?: VFS
  ) {
    try {
      let irData: {
        IR: string;
        uniformValues: BluePrintUniformValue[];
        uniformTextures: BluePrintUniformTexture[];
      };
      if (typeof url === 'string') {
        const data = (await this.readFileFromVFS(url, { encoding: 'utf8' }, vfs)) as string;
        const content = JSON.parse(data) as { type: string; data: any };
        ASSERT(
          content.type === 'PBRBluePrintMaterial' ||
            content.type === 'PBRBluePrintMaterialInstance' ||
            content.type === 'SpriteBluePrintMaterial',
          `Unsupported material type: ${content.type}`
        );
        if (content.type === 'PBRBluePrintMaterialInstance') {
          const parentPath = content.data.parent as string;
          ASSERT(
            typeof parentPath === 'string' && !!parentPath,
            'Blueprint material instance requires parent'
          );
          const parentContent = JSON.parse(
            (await this.readFileFromVFS(parentPath, { encoding: 'utf8' }, vfs)) as string
          ) as {
            type: string;
            data?: {
              IR?: string;
              uniformValues?: BluePrintUniformValue[];
              uniformTextures?: BluePrintUniformTexture[];
            };
          };
          ASSERT(
            parentContent.type === 'PBRBluePrintMaterial',
            `Invalid parent blueprint material: ${parentPath}`
          );
          irData = {
            IR: parentContent.data?.IR ?? content.data.IR ?? '',
            uniformValues: content.data.uniformValues ?? parentContent.data?.uniformValues ?? [],
            uniformTextures: content.data.uniformTextures ?? parentContent.data?.uniformTextures ?? []
          };
          ASSERT(!!irData.IR, `Parent blueprint material missing IR path: ${parentPath}`);
        } else {
          irData = content.data as {
            IR: string;
            uniformValues: BluePrintUniformValue[];
            uniformTextures: BluePrintUniformTexture[];
          };
        }
      } else {
        irData = url;
      }
      const ir = reload
        ? await this.loadBluePrint(irData.IR, vfs)
        : await this.fetchBluePrint(irData.IR, vfs ? { overrideVFS: vfs } : undefined);
      const uniformValues: BluePrintUniformValue[] = irData.uniformValues.map((v) => ({
        ...v,
        finalValue: v.value.length === 1 ? v.value[0] : new Float32Array(v.value)
      }));
      const uniformTextures = await this.hydrateBluePrintUniformTextures(irData.uniformTextures, vfs);
      return {
        irFragment: ir?.['fragment'] ?? null,
        irVertex: ir?.['vertex'] ?? null,
        uniformValues,
        uniformTextures
      };
    } catch (err) {
      console.error(`Load material failed: ${err}`);
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
  async loadMaterial<T extends Material = Material>(
    url: string,
    reload: boolean,
    vfs?: VFS
  ): Promise<Nullable<T>> {
    try {
      const data = (await this.readFileFromVFS(url, { encoding: 'utf8' }, vfs)) as string;
      const content = JSON.parse(data) as { type: string; props: any; data: any };
      ASSERT(
        content.type === 'PBRBluePrintMaterial' ||
          content.type === 'PBRBluePrintMaterialInstance' ||
          content.type === 'SpriteBluePrintMaterial' ||
          content.type === 'Default',
        `Unsupported material type: ${content.type}`
      );
      let mat: T;
      if (content.type === 'PBRBluePrintMaterial') {
        const data = (await this.loadBluePrintMaterialData(
          content.data as {
            IR: string;
            uniformValues: BluePrintUniformValue[];
            uniformTextures: BluePrintUniformTexture[];
          },
          reload,
          vfs
        ))!;
        mat = new PBRBluePrintMaterial(
          data.irFragment!,
          data.irVertex!,
          data.uniformValues,
          data.uniformTextures
        ) as unknown as T;
      } else if (content.type === 'PBRBluePrintMaterialInstance') {
        const parentMaterial = await this.fetchMaterial<PBRBluePrintMaterial>(
          content.data.parent,
          vfs ? { overrideVFS: vfs } : undefined
        );
        ASSERT(
          parentMaterial instanceof PBRBluePrintMaterial,
          `Invalid parent blueprint material: ${content.data.parent}`
        );
        const instance = new PBRBluePrintMaterialInstance(parentMaterial, content.data.parent);
        instance.setOverrides(
          content.data.uniformValues ?? [],
          await this.hydrateBluePrintUniformTextures(content.data.uniformTextures ?? [], vfs)
        );
        mat = instance as unknown as T;
      } else if (content.type === 'SpriteBluePrintMaterial') {
        const data = (await this.loadBluePrintMaterialData(
          content.data as {
            IR: string;
            uniformValues: BluePrintUniformValue[];
            uniformTextures: BluePrintUniformTexture[];
          },
          reload,
          vfs
        ))!;
        mat = new SpriteBlueprintMaterial(
          data.irFragment!,
          data.uniformValues,
          data.uniformTextures
        ) as unknown as T;
      } else {
        const obj = await this._resourceManager.deserializeObject<T>(null, content.data);
        if (!(obj instanceof Material)) {
          if (typeof (obj as any).dispose === 'function') {
            (obj as any).dispose();
          }
          return null;
        }
        return obj;
      }
      if (mat && content.props) {
        await this._resourceManager.deserializeObjectProps(mat, content.props);
      }
      if (mat instanceof PBRBluePrintMaterialInstance) {
        mat.setMaterialPropertyOverrides(Object.keys(content.props ?? {}));
        mat.syncInheritedUniforms();
      }
      return mat;
    } catch (err) {
      console.error(`Load material failed: ${err}`);
      return null;
    }
  }

  private async hydrateBluePrintUniformTextures(
    textures: BluePrintUniformTexture[],
    vfs?: VFS
  ): Promise<BluePrintUniformTexture[]> {
    return Promise.all(
      (textures ?? []).map(async (v) => {
        let tex: Nullable<BaseTexture> = null;
        if (v.texture) {
          try {
            tex = await this.fetchTexture(v.texture, {
              linearColorSpace: !v.sRGB,
              overrideVFS: vfs
            });
          } catch (err) {
            console.warn(`Load blueprint texture failed: ${v.texture}: ${String(err)}`);
          }
        }
        tex = tex ?? getDefaultTexture2D();
        return {
          ...v,
          exposed: v.exposed ?? true,
          finalTexture: new DRef(tex),
          finalSampler: getDevice().createSampler({
            addressU: v.wrapS as TextureAddressMode,
            addressV: v.wrapT as TextureAddressMode,
            minFilter: v.minFilter as TextureFilterMode,
            magFilter: v.magFilter as TextureFilterMode,
            mipFilter: v.mipFilter as TextureFilterMode
          }),
          params: tex ? new Vector4(tex.width, tex.height, tex.depth, tex.mipLevelCount) : Vector4.zero()
        };
      })
    );
  }
  private rebuildGraphStructure(
    nodes: Record<number, IGraphNode>,
    links: { startNodeId: number; startSlotId: number; endNodeId: number; endSlotId: number }[]
  ) {
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
  private collectReachableBackward(gs: GraphStructure, nodes: Record<number, IGraphNode>, roots: number[]) {
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
        const v = conn.targetNodeId; // predecessor
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
  ) {
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
          const v = conn.targetNodeId; // predecessor
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
  ) {
    const gs = this.rebuildGraphStructure(nodeMap, links);
    for (const k in gs.incoming) {
      const node = nodeMap[k];
      for (const conn of gs.incoming[k]) {
        const input = node.inputs.find((input) => input.id === conn.endSlotId)!;
        input.inputNode = nodeMap[conn.targetNodeId];
        input.inputId = conn.startSlotId;
      }
    }
    return {
      graph: gs,
      nodeMap,
      roots,
      order: this.getReverseTopologicalOrderFromRoots(gs, nodeMap, roots)!.order.reverse()
    };
  }
  invalidateBluePrint(path: string) {
    this.removeCacheEntry('blueprint', path);
  }
  async loadBluePrint(path: string, vfs?: VFS) {
    try {
      const content = (await this.readFileFromVFS(path, { encoding: 'utf8' }, vfs)) as string;
      const bp = JSON.parse(content) as {
        type: string;
        state: Record<string, BluePrintEditorState>;
      };
      ASSERT(
        bp.type === 'PBRMaterial' || bp.type === 'SpriteMaterial' || bp.type === 'MaterialFunction',
        `Unsupported blueprint type: ${bp.type}`
      );
      const states = bp.state;
      const result: Record<string, MaterialBlueprintIR> = {};
      for (const k of Object.keys(states)) {
        const roots: number[] = [];
        const nodeMap: Record<number, IGraphNode> = {};
        const state = states[k];
        const nodes = await Promise.all(
          state.nodes.map(async (node) => ({
            id: node.id,
            impl: await this._resourceManager.deserializeObject<IGraphNode>(null, node.node)
          }))
        );
        for (const { id, impl } of nodes) {
          nodeMap[id] = impl!;
          if (impl!.outputs.length === 0) {
            roots.push(id);
          }
        }
        const dag = await this.createBluePrintDAG(nodeMap, roots, state.links);
        result[k] = new MaterialBlueprintIR(dag, path, state);
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
    mimeType?: Nullable<string>,
    srgb?: boolean,
    samplerOptions?: SamplerOptions,
    texture?: Nullable<BaseTexture>,
    vfs?: VFS
  ) {
    const data = (await this.readFileFromVFS(url, { encoding: 'binary' }, vfs)) as ArrayBuffer;
    mimeType = mimeType ?? this.vfs.guessMIMEType(url);
    for (const loader of AssetManager._textureLoaders) {
      if (!loader.supportMIMEType(mimeType)) {
        continue;
      }
      const tex = await this.doLoadTexture(loader, mimeType, data, !!srgb, samplerOptions, texture);
      if (tex) {
        tex.name = this.vfs.basename(url);
      }
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
    texture?: Nullable<BaseTexture>
  ) {
    const device = getDevice();
    if (device.type !== 'webgl') {
      return await loader.load(mimeType, data, srgb, samplerOptions, texture);
    } else {
      let tex = await loader.load(mimeType, data, srgb, samplerOptions);
      if (tex) {
        if (texture) {
          const magFilter =
            tex.width !== texture.width || tex.height !== texture.height ? 'linear' : 'nearest';
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
  async loadModel(url: string, options?: ModelFetchOptions, vfs?: VFS) {
    const mimeType = options?.mimeType || guessMimeType(url);
    const importer = this._modelLoaders[mimeType];
    if (importer) {
      let model = await importer.loadModel(url, vfs);
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
  static setBuiltinTextureLoader(name: string, loader: (assetManager: AssetManager) => BaseTexture) {
    if (loader) {
      this._builtinTextureLoaders[name] = loader;
    } else {
      delete this._builtinTextureLoaders[name];
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
  private getHash<T extends BaseTexture>(type: string, url: string, options?: TextureFetchOptions<T>) {
    return `${type}:${url}:${!options?.linearColorSpace}`;
  }
  /**
   * Try reading from file from a VFS
   *
   * @param path - File path
   * @param options - Read options
   * @param vfs - VFS to read from
   * @returns File content
   *
   * @internal
   */
  async readFileFromVFS(path: string, options: ReadOptions, vfs?: VFS) {
    return await (vfs ?? this.vfs).readFile(path, options);
  }
  /**
   * Write file to a VFS
   *
   * @param path - File path
   * @param data - Data to write
   * @param options - Write options
   * @param vfs - VFS to write to
   */
  async writeFileToVFSs(path: string, data: ArrayBuffer | string, options: WriteOptions, vfs?: VFS) {
    await (vfs ?? this.vfs).writeFile(path, data, options);
  }
}
