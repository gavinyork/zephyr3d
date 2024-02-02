import type { BaseTexture, SamplerOptions } from '@zephyr3d/device';
import type { AssetManager } from '../assetmanager';
import type { SharedModel } from '../model';

/**
 * Base interface for any kind loaders
 * @public
 */
export class LoaderBase {
  /** @internal */
  protected _urlResolver: (url: string) => string;
  /**
   * Creates an instance of LoaderBase
   */
  constructor() {
    this._urlResolver = null;
  }
  /**
   * URL resolver for the loader
   */
  get urlResolver(): (url: string) => string {
    return this._urlResolver;
  }
  set urlResolver(resolver: (url: string) => string) {
    this._urlResolver = resolver;
  }
  /**
   * Sends a GET request
   * @param url - The URL to get
   * @param headers - The headers for the request
   * @param crossOrigin - crossOrigin property for the request
   * @returns Response of the request
   */
  async request(
    url: string,
    headers: Record<string, string> = {},
    crossOrigin = 'anonymous'
  ): Promise<Response> {
    url = this._urlResolver ? this._urlResolver(url) : null;
    return url
      ? fetch(url, {
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
   * Tests whether the loader supports loading a texture with given file extension.
   * @param ext - The file extension to test
   * @returns true if it supports
   */
  abstract supportExtension(ext: string): boolean;
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
   * @param noMipmap - true if mipmap needn't to be generated for the texture
   * @param texture - if not null, this is a texture restore operation
   * @returns The loaded texture
   */
  abstract load(
    assetManager: AssetManager,
    url: string,
    mimeType: string,
    data: ArrayBuffer,
    srgb: boolean,
    samplerOptions?: SamplerOptions,
    texture?: BaseTexture
  ): Promise<BaseTexture>;
}

/**
 * Base class for any kind of model loaders
 * @public
 */
export abstract class AbstractModelLoader extends LoaderBase {
  /**
   * Tests whether the loader supports loading a model with given file extension.
   * @param ext - The file extension to test
   * @returns true if it supports
   */
  abstract supportExtension(ext: string): boolean;
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
  abstract load(assetManager: AssetManager, url: string, mimeType: string, data: Blob): Promise<SharedModel>;
}
