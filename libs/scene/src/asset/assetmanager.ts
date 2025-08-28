import type { DecoderModule } from 'draco3d';
import type { HttpRequest, TypedArray, VFS } from '@zephyr3d/base';
import { isPowerOf2, nextPowerOf2, DWeakRef } from '@zephyr3d/base';
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
import type { BaseTexture, SamplerOptions } from '@zephyr3d/device';
import type { Scene } from '../scene/scene';
import type { AbstractTextureLoader, AbstractModelLoader } from './loaders/loader';
import { TGALoader } from './loaders/image/tga_Loader';
import { getDevice, getEngine } from '../app/api';

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
  private _jsonDatas: {
    [url: string]: Promise<any>;
  };
  /** @internal */
  private readonly _vfs: VFS;
  /**
   * Creates an instance of AssetManager
   */
  constructor(vfs?: VFS) {
    this._vfs = vfs ?? getEngine().VFS;
    this._textures = {};
    this._models = {};
    this._binaryDatas = {};
    this._textDatas = {};
    this._jsonDatas = {};
  }
  /**
   * VFS used to read resources (files, URLs, virtual mounts).
   */
  get vfs() {
    return this._vfs;
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
    httpRequest?: HttpRequest
  ): Promise<string> {
    const hash = httpRequest?.urlResolver?.(url) ?? url;
    let P = this._textDatas[hash];
    if (!P) {
      P = this.loadTextData(url, postProcess);
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
    httpRequest?: HttpRequest
  ): Promise<T> {
    const hash = httpRequest?.urlResolver?.(url) ?? url;
    let P = this._jsonDatas[hash];
    if (!P) {
      P = this.loadJsonData(url, postProcess);
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
    httpRequest?: HttpRequest
  ): Promise<ArrayBuffer> {
    const hash = httpRequest?.urlResolver?.(url) ?? url;
    let P = this._binaryDatas[hash];
    if (!P) {
      P = this.loadBinaryData(url, postProcess);
      this._binaryDatas[hash] = P;
    }
    return P;
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
        options.texture
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
          null
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
  async fetchModelData(url: string, options?: ModelFetchOptions): Promise<SharedModel> {
    const hash = url;
    let P = this._models[hash];
    if (P instanceof DWeakRef && P.get() && !P.get().disposed) {
      return P.get();
    } else if (!P || P instanceof DWeakRef) {
      P = this.loadModel(url, options);
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
  async fetchModel(scene: Scene, url: string, options?: ModelFetchOptions): Promise<ModelInfo> {
    const sharedModel = await this.fetchModelData(url, options);
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
  async loadTextData(url: string, postProcess?: (text: string) => string): Promise<string> {
    let text = (await this._vfs.readFile(url, { encoding: 'utf8' })) as string;
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
  async loadJsonData(url: string, postProcess?: (json: any) => any): Promise<string> {
    let json = JSON.parse((await this._vfs.readFile(url, { encoding: 'utf8' })) as string);

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
  async loadBinaryData(url: string, postProcess?: (data: ArrayBuffer) => ArrayBuffer): Promise<ArrayBuffer> {
    let data = (await this._vfs.readFile(url, { encoding: 'binary' })) as ArrayBuffer;
    if (postProcess) {
      try {
        data = postProcess(data);
      } catch (err) {
        throw new Error(`Load binary data post process failed: ${err}`);
      }
    }
    return data;
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
    texture?: BaseTexture
  ): Promise<BaseTexture> {
    const data = (await this._vfs.readFile(url, { encoding: 'binary' })) as ArrayBuffer;
    mimeType = mimeType ?? this._vfs.guessMIMEType(url);
    for (const loader of AssetManager._textureLoaders) {
      if (!loader.supportMIMEType(mimeType)) {
        continue;
      }
      const tex = await this.doLoadTexture(loader, mimeType, data, !!srgb, samplerOptions, texture);
      tex.name = this._vfs.basename(url);
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
  async loadModel(url: string, options?: ModelFetchOptions): Promise<SharedModel> {
    const arrayBuffer = (await this._vfs.readFile(url, { encoding: 'binary' })) as ArrayBuffer;
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
        options?.dracoDecoderModule
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
}
