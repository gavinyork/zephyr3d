import type { DecoderModule } from 'draco3d';
import { isPowerOf2, nextPowerOf2, HttpRequest } from '@zephyr3d/base';
import type { SharedModel } from './model';
import { GLTFLoader } from './loaders/gltf/gltf_loader';
import { WebImageLoader } from './loaders/image/webimage_loader';
import { DDSLoader } from './loaders/dds/dds_loader';
import { HDRLoader } from './loaders/hdr/hdr';
import { SceneNode } from '../scene/scene_node';
import { CopyBlitter } from '../blitter';
import { getSheenLutLoader } from './builtin';
import { BUILTIN_ASSET_TEXTURE_SHEEN_LUT } from '../values';
import { Application } from '../app/app';
import { AnimationSet } from '../animation/animationset';
import type { BaseTexture, SamplerOptions } from '@zephyr3d/device';
import type { Scene } from '../scene/scene';
import type { AbstractTextureLoader, AbstractModelLoader } from './loaders/loader';
import { TGALoader } from './loaders/image/tga_Loader';
import { WeakRef } from '../app';

/**
 * Options for texture fetching
 * @public
 **/
export type TextureFetchOptions<T extends BaseTexture> = {
  /** MIME type of the texture, if not specified, model type will be determined by file extension */
  mimeType?: string;
  /** If true, load the texture in linear color space, other wise load in sRGB color space */
  linearColorSpace?: boolean;
  /** If not null, load into existing texture */
  texture?: T;
  /** Sampler options of the texture */
  samplerOptions?: SamplerOptions;
};

/**
 * Options for model fetching
 * @public
 **/
export type ModelFetchOptions = {
  /** MIME type of the model, if not specified, model type will be determined by file extension */
  mimeType?: string;
  /** Draco module */
  dracoDecoderModule?: DecoderModule;
  /** True if the model need to be rendered instanced, the default value is false */
  enableInstancing?: boolean;
  /** PostProcess loading function for the mesh  */
  postProcess?: (model: SharedModel) => SharedModel;
};

/**
 * Data structure returned by AssetManager.fetchModel()
 * @public
 */
export type ModelInfo = {
  /** Mesh group */
  group: SceneNode;
  /** Animation set, null if no animation */
  animationSet: AnimationSet;
};

/**
 * The asset manager
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
  private static _textureLoaders: AbstractTextureLoader[] = [
    new WebImageLoader(),
    new DDSLoader(),
    new HDRLoader(),
    new TGALoader()
  ];
  /** @internal */
  private static _modelLoaders: AbstractModelLoader[] = [new GLTFLoader()];
  /** @internal */
  private _httpRequest: HttpRequest;
  /** @internal */
  private _textures: {
    [hash: string]: Promise<BaseTexture> | WeakRef<BaseTexture>;
  };
  /** @internal */
  private _models: {
    [url: string]: Promise<SharedModel> | WeakRef<SharedModel>;
  };
  /** @internal */
  private _binaryDatas: {
    [url: string]: Promise<ArrayBuffer>;
  };
  /** @internal */
  private _textDatas: {
    [url: string]: Promise<string>;
  };
  /**
   * Creates an instance of AssetManager
   */
  constructor() {
    this._httpRequest = new HttpRequest();
    this._textures = {};
    this._models = {};
    this._binaryDatas = {};
    this._textDatas = {};
  }
  /**
   * HttpRequest instance of the asset manager
   */
  get httpRequest(): HttpRequest {
    return this._httpRequest;
  }
  /**
   * Adds a texture loader to the asset manager
   *
   * @remarks
   * TODO: this should be a static method
   *
   * @param loader - The texture loader to be added
   */
  static addTextureLoader(loader: AbstractTextureLoader): void {
    if (loader) {
      this._textureLoaders.unshift(loader);
    }
  }
  /**
   * Adds a model loader to the asset manager
   *
   * @remarks
   * TODO: this should be a static method
   *
   * @param loader - The model loader to be added
   */
  static addModelLoader(loader: AbstractModelLoader) {
    if (loader) {
      this._modelLoaders.unshift(loader);
    }
  }
  /**
   * Fetches a text resource from a given URL
   * @param url - The URL from where to fetch the resource
   * @param postProcess - A function that will be involved when the text data was loaded.
   * @param httpRequest - Custom HttpRequest object to be used
   *
   * @remarks
   * If a text data has already been loaded, the function will ignore the
   * postProcess parameter and directly return the text loaded previously.
   * To load the same text with different postProcess parameters,
   * use different AssetManager instances separately.
   *
   * @returns The fetched text
   */
  async fetchTextData(
    url: string,
    postProcess?: (text: string) => string,
    httpRequest?: HttpRequest
  ): Promise<string> {
    const hash = httpRequest?.urlResolver?.(url) ?? url;
    let P = this._textDatas[hash];
    if (!P) {
      P = this.loadTextData(url, postProcess, httpRequest);
      this._textDatas[hash] = P;
    }
    return P;
  }
  /**
   * Fetches a binary resource from a given URL
   * @param url - The URL from where to fetch the resource
   * @param postProcess - A function that will be involved when the binary data was loaded.
   * @param httpRequest - Custom HttpRequest object to be used
   *
   * @remarks
   * If a binary data has already been loaded, the function will ignore the
   * postProcess parameter and directly return the data loaded previously.
   * To load the same data with different postProcess parameters,
   * use different AssetManager instances separately.
   *
   * @returns Binary data as ArrayBuffer
   */
  async fetchBinaryData(
    url: string,
    postProcess?: (data: ArrayBuffer) => ArrayBuffer,
    httpRequest?: HttpRequest
  ): Promise<ArrayBuffer> {
    const hash = httpRequest?.urlResolver?.(url) ?? url;
    let P = this._binaryDatas[hash];
    if (!P) {
      P = this.loadBinaryData(url, postProcess, httpRequest);
      this._binaryDatas[hash] = P;
    }
    return P;
  }
  /**
   * Fetches a texture resource from a given URL
   * @param url - The URL from where to fetch the resource
   * @param options - Options for texture fetching
   * @param httpRequest - Custom HttpRequest object to be used
   *
   * @returns The fetched texture
   */
  async fetchTexture<T extends BaseTexture>(
    url: string,
    options?: TextureFetchOptions<T>,
    httpRequest?: HttpRequest
  ): Promise<T> {
    if (options?.texture) {
      return this.loadTexture(
        url,
        options.mimeType ?? null,
        !options.linearColorSpace,
        options.samplerOptions,
        options.texture,
        httpRequest
      ) as Promise<T>;
    } else {
      const hash = this.getHash('2d', url, options);
      let P = this._textures[hash] as Promise<T> | WeakRef<T>;
      if (P instanceof WeakRef && P.get() && !P.get().disposed) {
        return P.get();
      } else if (!P || P instanceof WeakRef) {
        P = this.loadTexture(
          url,
          options?.mimeType ?? null,
          !options?.linearColorSpace,
          options?.samplerOptions,
          null,
          httpRequest
        ) as Promise<T>;
        this._textures[hash] = P;
      }
      const tex: T = await P;
      if (this._textures[hash] instanceof Promise) {
        this._textures[hash] = new WeakRef<T>(tex);
      }
      return tex;
    }
  }
  /** @internal */
  async fetchModelData(
    url: string,
    options?: ModelFetchOptions,
    httpRequest?: HttpRequest
  ): Promise<SharedModel> {
    const hash = url;
    let P = this._models[hash];
    if (P instanceof WeakRef && P.get() && !P.get().disposed) {
      return P.get();
    } else if (!P || P instanceof WeakRef) {
      P = this.loadModel(url, options, httpRequest);
      this._models[hash] = P;
    }
    const sharedModel = await P;
    if (this._models[hash] instanceof Promise) {
      this._models[hash] = new WeakRef<SharedModel>(sharedModel);
    }
    return sharedModel;
  }
  /**
   * Fetches a model resource from a given URL and adds it to a scene
   * @param scene - The scene to which the model node belongs
   * @param url - The URL from where to fetch the resource
   * @param options - Options for model fetching
   * @param httpRequest - HttpRequest object to be used
   *
   * @remarks
   * If a model has already been loaded, the function will ignore the
   * postProcess parameter and directly return the model loaded previously.
   * To load the same model with different postProcess parameters,
   * use different AssetManager instances separately.
   *
   * @returns The created model node
   */
  async fetchModel(
    scene: Scene,
    url: string,
    options?: ModelFetchOptions,
    httpRequest?: HttpRequest
  ): Promise<ModelInfo> {
    const sharedModel = await this.fetchModelData(url, options, httpRequest);
    const node = sharedModel.createSceneNode(scene, !!options?.enableInstancing);
    return { group: node, animationSet: node.animationSet };
  }
  /** @internal */
  async loadTextData(
    url: string,
    postProcess?: (text: string) => string,
    httpRequest?: HttpRequest
  ): Promise<string> {
    let text = await (httpRequest ?? this._httpRequest).requestText(url);
    if (postProcess) {
      try {
        text = postProcess(text);
      } catch (err) {
        throw new Error(`Load text data post process failed: ${err}`);
      }
    }
    return text;
  }
  /** @internal */
  async loadBinaryData(
    url: string,
    postProcess?: (data: ArrayBuffer) => ArrayBuffer,
    httpRequest?: HttpRequest
  ): Promise<ArrayBuffer> {
    let data = await (httpRequest ?? this._httpRequest).requestArrayBuffer(url);
    if (postProcess) {
      try {
        data = postProcess(data);
      } catch (err) {
        throw new Error(`Load binary data post process failed: ${err}`);
      }
    }
    return data;
  }
  /** @internal */
  async loadTexture(
    url: string,
    mimeType?: string,
    srgb?: boolean,
    samplerOptions?: SamplerOptions,
    texture?: BaseTexture,
    httpRequest?: HttpRequest
  ): Promise<BaseTexture> {
    const data = await (httpRequest ?? this._httpRequest).requestArrayBuffer(url);
    let ext = '';
    let filename = '';
    const dataUriMatchResult = url.match(/^data:([^;]+)/);
    if (dataUriMatchResult) {
      mimeType = mimeType || dataUriMatchResult[1];
    } else {
      filename = new URL(url, new URL(location.href).origin).pathname
        .split('/')
        .filter((val) => !!val)
        .slice(-1)[0];
      const p = filename ? filename.lastIndexOf('.') : -1;
      ext = p >= 0 ? filename.substring(p).toLowerCase() : null;
      if (!mimeType) {
        if (ext === '.jpg' || ext === '.jpeg') {
          mimeType = 'image/jpg';
        } else if (ext === '.png') {
          mimeType = 'image/png';
        }
      }
    }
    for (const loader of AssetManager._textureLoaders) {
      if ((!ext || !loader.supportExtension(ext)) && (!mimeType || !loader.supportMIMEType(mimeType))) {
        continue;
      }
      const tex = await this.doLoadTexture(loader, mimeType, data, !!srgb, samplerOptions, texture);
      tex.name = filename;
      return tex;
    }
    throw new Error(`Can not find loader for asset ${url}`);
  }
  /** @internal */
  async doLoadTexture(
    loader: AbstractTextureLoader,
    mimeType: string,
    data: ArrayBuffer,
    srgb: boolean,
    samplerOptions?: SamplerOptions,
    texture?: BaseTexture
  ): Promise<BaseTexture> {
    const device = Application.instance.device;
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
  /** @internal */
  async loadModel(url: string, options?: ModelFetchOptions, httpRequest?: HttpRequest): Promise<SharedModel> {
    httpRequest = httpRequest ?? this.httpRequest;
    const data = await httpRequest.requestBlob(url);
    const filename = new URL(url, new URL(location.href).origin).pathname
      .split('/')
      .filter((val) => !!val)
      .slice(-1)[0];
    const p = filename ? filename.lastIndexOf('.') : -1;
    const ext = p >= 0 ? filename.substring(p) : null;
    for (const loader of AssetManager._modelLoaders) {
      if (!loader.supportExtension(ext) && !loader.supportMIMEType(options?.mimeType || data.type)) {
        continue;
      }
      let model = await loader.load(
        this,
        url,
        options?.mimeType || data.type,
        data,
        httpRequest,
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
   * Fetches a built-in texture
   * @param name - Name of the built-in texture
   * @returns The built-in texture
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
   * Sets the loader for a given builtin-texture
   * @param name - Name of the builtin texture
   * @param loader - Loader for the builtin texture
   */
  static setBuiltinTextureLoader(name: string, loader: (assetManager: AssetManager) => BaseTexture): void {
    if (loader) {
      this._builtinTextureLoaders[name] = loader;
    } else {
      this._builtinTextureLoaders[name] = undefined;
    }
  }
  private getHash<T extends BaseTexture>(type: string, url: string, options: TextureFetchOptions<T>): string {
    return `${type}:${url}:${!options?.linearColorSpace}`;
  }
}
