import type { BaseTexture, SamplerOptions } from '@zephyr3d/device';
import type { AssetManager } from '../assetmanager';
import type { SharedModel } from '../model';
import type { DecoderModule } from 'draco3d';
import type { Nullable, TypedArray, VFS } from '@zephyr3d/base';

/**
 * Base interface for any kind loaders
 * @public
 */
export class LoaderBase {
  /** @internal */
  protected _urlResolver: Nullable<(url: string) => string>;
  /**
   * Creates an instance of LoaderBase
   */
  constructor() {
    this._urlResolver = null;
  }
  /**
   * URL resolver for the loader
   */
  get urlResolver() {
    return this._urlResolver;
  }
  set urlResolver(resolver) {
    this._urlResolver = resolver;
  }
  /**
   * Sends a GET request
   * @param url - The URL to get
   * @param headers - The headers for the request
   * @param crossOrigin - crossOrigin property for the request
   * @returns Response of the request
   */
  async request(url: string, headers: Record<string, string> = {}, crossOrigin = 'anonymous') {
    const s = this._urlResolver ? this._urlResolver(url) : null;
    return s
      ? fetch(s, {
          credentials: crossOrigin === 'anonymous' ? 'same-origin' : 'include',
          headers: headers
        })
      : null;
  }
}
/**
 * Base class for any kind of texture loaders
 * @public
 */
export abstract class AbstractTextureLoader extends LoaderBase {
  /**
   * Tests whether the loader supports loading a texture with given MIME type.
   * @param mimeType - The MIME type to test
   * @returns true if it supports
   */
  abstract supportMIMEType(mimeType: string): boolean;
  /**
   * Loads a texture
   * @param assetManager - The instance of AssetManager
   * @param url - The request URL
   * @param mimeType - MIME type for the texture image data
   * @param data - The texture image data
   * @param srgb - true if the texture is of sRGB format
   * @param samplerOptions - Sampler options of the texture
   * @param texture - if not null, this is a texture restore operation
   * @returns The loaded texture
   */
  abstract load(
    mimeType: string,
    data: ArrayBuffer | TypedArray,
    srgb: boolean,
    samplerOptions?: SamplerOptions,
    texture?: Nullable<BaseTexture>
  ): Promise<Nullable<BaseTexture>>;
}

/**
 * Base class for any kind of model loaders
 * @public
 */
export abstract class AbstractModelLoader extends LoaderBase {
  /**
   * Tests whether the loader supports loading a model with given MIME type.
   * @param mimeType - The MIME type to test
   * @returns true if it supports
   */
  abstract supportMIMEType(mimeType: string): boolean;
  /**
   * Loads a model
   * @param assetManager - The instance of AssetManager
   * @param url - The request URL
   * @param mimeType - MIME type for the model data
   * @param data - The model data
   * @returns The loaded model
   */
  abstract load(
    assetManager: AssetManager,
    url: string,
    mimeType: string,
    data: Blob,
    dracoDecoderModule?: DecoderModule,
    VFSs?: VFS[]
  ): Promise<Nullable<SharedModel>>;
}
