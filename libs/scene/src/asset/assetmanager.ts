import type { DecoderModule } from 'draco3d';
import { isPowerOf2, nextPowerOf2, HttpRequest } from '@zephyr3d/base';
import type { AssetHierarchyNode, AssetSkeleton, AssetSubMeshData, SharedModel } from './model';
import { GLTFLoader } from './loaders/gltf/gltf_loader';
import { WebImageLoader } from './loaders/image/webimage_loader';
import { DDSLoader } from './loaders/dds/dds_loader';
import { HDRLoader } from './loaders/hdr/hdr';
import { SceneNode } from '../scene/scene_node';
import { Mesh } from '../scene/mesh';
import { RotationTrack, ScaleTrack, Skeleton, TranslationTrack } from '../animation';
import { AnimationClip } from '../animation/animation';
import { CopyBlitter } from '../blitter';
import { getSheenLutLoader, getTestCubemapLoader } from './builtin';
import { BUILTIN_ASSET_TEXTURE_SHEEN_LUT, BUILTIN_ASSET_TEST_CUBEMAP, MAX_MORPH_TARGETS } from '../values';
import { Application } from '../app';
import { AnimationSet } from '../animation/animationset';
import type { BaseTexture, Texture2D, GPUObject, SamplerOptions } from '@zephyr3d/device';
import type { Scene } from '../scene/scene';
import type { AbstractTextureLoader, AbstractModelLoader } from './loaders/loader';
import { TGALoader } from './loaders/image/tga_Loader';
import { MorphTargetTrack } from '../animation/morphtrack';
import { processMorphData } from '../animation/morphtarget';

/**
 * Options for texture fetching
 * @public
 **/
export type TextureFetchOptions<T extends BaseTexture> = {
  mimeType?: string;
  linearColorSpace?: boolean;
  texture?: T;
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
  static _builtinTextures: {
    [name: string]: Promise<BaseTexture>;
  } = {};
  /** @internal */
  static _builtinTextureLoaders: {
    [name: string]: (assetManager: AssetManager, texture?: BaseTexture) => Promise<BaseTexture>;
  } = {
    [BUILTIN_ASSET_TEXTURE_SHEEN_LUT]: getSheenLutLoader(64),
    [BUILTIN_ASSET_TEST_CUBEMAP]: getTestCubemapLoader()
  };
  /** @internal */
  private _httpRequest: HttpRequest;
  /** @internal */
  private _textureLoaders: AbstractTextureLoader[];
  /** @internal */
  private _modelLoaders: AbstractModelLoader[];
  /** @internal */
  private _textures: {
    [hash: string]: Promise<BaseTexture>;
  };
  /** @internal */
  private _models: {
    [url: string]: Promise<SharedModel>;
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
    this._textureLoaders = [new WebImageLoader(), new DDSLoader(), new HDRLoader(), new TGALoader()];
    this._modelLoaders = [new GLTFLoader()];
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
   * Removes all cached assets
   */
  clearCache() {
    this._textures = {};
    this._models = {};
    this._binaryDatas = {};
    this._textDatas = {};
  }
  /**
   * Remove and dispose all cached assets
   */
  purgeCache() {
    for (const k in this._textures) {
      this._textures[k].then((tex) => tex?.dispose()).catch((err) => {});
    }
    this._textures = {};
    this._models = {};
    this._binaryDatas = {};
    this._textDatas = {};
  }
  /**
   * Adds a texture loader to the asset manager
   *
   * @remarks
   * TODO: this should be a static method
   *
   * @param loader - The texture loader to be added
   */
  addTextureLoader(loader: AbstractTextureLoader): void {
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
  addModelLoader(loader: AbstractModelLoader) {
    if (loader) {
      this._modelLoaders.unshift(loader);
    }
  }
  /**
   * Fetches a text resource from a given URL
   * @param url - The URL from where to fetch the resource
   * @param postProcess - A function that will be involved when the text data was loaded.
   *
   * @remarks
   * If a text data has already been loaded, the function will ignore the
   * postProcess parameter and directly return the text loaded previously.
   * To load the same text with different postProcess parameters,
   * use different AssetManager instances separately.
   *
   * @returns The fetched text
   */
  async fetchTextData(url: string, postProcess?: (text: string) => string): Promise<string> {
    let P = this._textDatas[url];
    if (!P) {
      P = this.loadTextData(url, postProcess);
      this._textDatas[url] = P;
    }
    return P;
  }
  /**
   * Fetches a binary resource from a given URL
   * @param url - The URL from where to fetch the resource
   * @param postProcess - A function that will be involved when the binary data was loaded.
   *
   * @remarks
   * If a binary data has already been loaded, the function will ignore the
   * postProcess parameter and directly return the data loaded previously.
   * To load the same data with different postProcess parameters,
   * use different AssetManager instances separately.
   *
   * @returns Binary data as ArrayBuffer
   */
  async fetchBinaryData(url: string, postProcess?: (data: ArrayBuffer) => ArrayBuffer): Promise<ArrayBuffer> {
    let P = this._binaryDatas[url];
    if (!P) {
      P = this.loadBinaryData(url, postProcess);
      this._binaryDatas[url] = P;
    }
    return P;
  }
  /**
   * Fetches a texture resource from a given URL
   * @param url - The URL from where to fetch the resource
   * @param options - Options for texture fetching
   * @returns The fetched texture
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
      let P = this._textures[hash];
      if (!P) {
        P = this.loadTexture(
          url,
          options?.mimeType ?? null,
          !options?.linearColorSpace,
          options?.samplerOptions
        );
        this._textures[hash] = P;
      } else {
        const tex = await P;
        if (tex.disposed) {
          await tex.reload();
          return tex as T;
        }
      }
      return P as Promise<T>;
    }
  }
  /** @internal */
  async fetchModelData(scene: Scene, url: string, options?: ModelFetchOptions): Promise<SharedModel> {
    let P = this._models[url];
    if (!P) {
      P = this.loadModel(url, options);
      this._models[url] = P;
    }
    return P;
  }
  /**
   * Fetches a model resource from a given URL and adds it to a scene
   * @param scene - The scene to which the model node belongs
   * @param url - The URL from where to fetch the resource
   * @param options - Options for model fetching
   *
   * @remarks
   * If a model has already been loaded, the function will ignore the
   * postProcess parameter and directly return the model loaded previously.
   * To load the same model with different postProcess parameters,
   * use different AssetManager instances separately.
   *
   * @returns The created model node
   */
  async fetchModel(scene: Scene, url: string, options?: ModelFetchOptions): Promise<ModelInfo> {
    const sharedModel = await this.fetchModelData(scene, url, options);
    return this.createSceneNode(scene, url, sharedModel, !!options?.enableInstancing);
  }
  /** @internal */
  async loadTextData(url: string, postProcess?: (text: string) => string): Promise<string> {
    let text = await this._httpRequest.requestText(url);
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
  async loadBinaryData(url: string, postProcess?: (data: ArrayBuffer) => ArrayBuffer): Promise<ArrayBuffer> {
    let data = await this._httpRequest.requestArrayBuffer(url);
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
    texture?: BaseTexture
  ): Promise<BaseTexture> {
    const data = await this._httpRequest.requestArrayBuffer(url);
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
    for (const loader of this._textureLoaders) {
      if ((!ext || !loader.supportExtension(ext)) && (!mimeType || !loader.supportMIMEType(mimeType))) {
        continue;
      }
      const tex = await this.doLoadTexture(loader, filename, mimeType, data, !!srgb, samplerOptions, texture);
      tex.name = filename;
      if (url.match(/^blob:/)) {
        tex.restoreHandler = async (tex: GPUObject) => {
          await this.doLoadTexture(
            loader,
            filename,
            mimeType,
            data,
            !!srgb,
            samplerOptions,
            tex as BaseTexture
          );
        };
      } else {
        const so = samplerOptions ? null : { ...samplerOptions };
        tex.restoreHandler = async (tex: GPUObject) => {
          await this.loadTexture(url, mimeType, srgb, so, tex as BaseTexture);
        };
      }
      return tex;
    }
    throw new Error(`Can not find loader for asset ${url}`);
  }
  /** @internal */
  async doLoadTexture(
    loader: AbstractTextureLoader,
    url: string,
    mimeType: string,
    data: ArrayBuffer,
    srgb: boolean,
    samplerOptions?: SamplerOptions,
    texture?: BaseTexture
  ): Promise<BaseTexture> {
    const device = Application.instance.device;
    if (device.type !== 'webgl') {
      return await loader.load(this, url, mimeType, data, srgb, samplerOptions, texture);
    } else {
      let tex = await loader.load(this, url, mimeType, data, srgb, samplerOptions);
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
  async loadModel(url: string, options?: ModelFetchOptions): Promise<SharedModel> {
    const data = await this.httpRequest.requestBlob(url);
    const filename = new URL(url, new URL(location.href).origin).pathname
      .split('/')
      .filter((val) => !!val)
      .slice(-1)[0];
    const p = filename ? filename.lastIndexOf('.') : -1;
    const ext = p >= 0 ? filename.substring(p) : null;
    for (const loader of this._modelLoaders) {
      if (!loader.supportExtension(ext) && !loader.supportMIMEType(options?.mimeType || data.type)) {
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
   * Fetches a built-in texture
   * @param name - Name of the built-in texture
   * @returns The built-in texture
   */
  async fetchBuiltinTexture<T extends BaseTexture>(name: string, texture?: BaseTexture): Promise<T> {
    const loader = AssetManager._builtinTextureLoaders[name];
    if (!loader) {
      throw new Error(`Unknown builtin texture name: ${name}`);
    }
    if (texture) {
      return loader(this, texture) as Promise<T>;
    } else {
      let P = AssetManager._builtinTextures[name];
      if (!P) {
        P = loader(this);
        AssetManager._builtinTextures[name] = P;
      }
      const tex = await P;
      tex.restoreHandler = async (tex) => {
        await loader(this, tex as Texture2D);
      };
      return tex as T;
    }
  }
  /** @internal */
  private createSceneNode(
    scene: Scene,
    url: string,
    model: SharedModel,
    instancing: boolean
  ): { group: SceneNode; animationSet: AnimationSet } {
    const group = new SceneNode(scene);
    group.name = model.name;
    group.assetUrl = url;
    group.sealed = true;
    group.animationSet = new AnimationSet(scene, group);
    for (let i = 0; i < model.scenes.length; i++) {
      const assetScene = model.scenes[i];
      const skeletonMeshMap: Map<
        AssetSkeleton,
        { mesh: Mesh[]; bounding: AssetSubMeshData[]; skeleton?: Skeleton }
      > = new Map();
      const nodeMap: Map<AssetHierarchyNode, SceneNode> = new Map();
      for (let k = 0; k < assetScene.rootNodes.length; k++) {
        this.setAssetNodeToSceneNode(
          scene,
          group,
          model,
          assetScene.rootNodes[k],
          skeletonMeshMap,
          nodeMap,
          instancing
        );
      }
      for (const animationData of model.animations) {
        const animation = new AnimationClip(animationData.name);
        for (const track of animationData.tracks) {
          if (track.type === 'translation') {
            animation.addTrack(nodeMap.get(track.node), new TranslationTrack(track.interpolator));
          } else if (track.type === 'scale') {
            animation.addTrack(nodeMap.get(track.node), new ScaleTrack(track.interpolator));
          } else if (track.type === 'rotation') {
            animation.addTrack(nodeMap.get(track.node), new RotationTrack(track.interpolator));
          } else if (track.type === 'weights') {
            for (const m of track.node.mesh.subMeshes) {
              if (track.interpolator.stride > MAX_MORPH_TARGETS) {
                console.error(
                  `Morph target too large: ${track.interpolator.stride}, the maximum is ${MAX_MORPH_TARGETS}`
                );
              } else {
                const morphTrack = new MorphTargetTrack(track, m);
                animation.addTrack(m.mesh, morphTrack);
              }
            }
          } else {
            console.error(`Invalid animation track type: ${track.type}`);
          }
        }
        if (animation.tracks.size === 0) {
          continue;
        }
        group.animationSet.add(animation);
        for (const sk of animationData.skeletons) {
          const nodes = skeletonMeshMap.get(sk);
          if (nodes) {
            if (!nodes.skeleton) {
              nodes.skeleton = new Skeleton(
                sk.joints.map((val) => nodeMap.get(val)),
                sk.inverseBindMatrices,
                sk.bindPoseMatrices,
                nodes.mesh,
                nodes.bounding
              );
            }
            animation.addSkeleton(nodes.skeleton);
          }
        }
      }
    }
    if (group.animationSet.numAnimations === 0) {
      group.animationSet.dispose();
      group.animationSet = null;
    }
    return { group, animationSet: group.animationSet };
  }
  /**
   * Sets the loader for a given builtin-texture
   * @param name - Name of the builtin texture
   * @param loader - Loader for the builtin texture
   */
  static setBuiltinTextureLoader(
    name: string,
    loader: (assetManager: AssetManager) => Promise<BaseTexture>
  ): void {
    if (loader) {
      this._builtinTextureLoaders[name] = loader;
    } else {
      this._builtinTextureLoaders[name] = undefined;
    }
  }
  /** @internal */
  private setAssetNodeToSceneNode(
    scene: Scene,
    parent: SceneNode,
    model: SharedModel,
    assetNode: AssetHierarchyNode,
    skeletonMeshMap: Map<AssetSkeleton, { mesh: Mesh[]; bounding: AssetSubMeshData[] }>,
    nodeMap: Map<AssetHierarchyNode, SceneNode>,
    instancing: boolean
  ) {
    const node: SceneNode = new SceneNode(scene);
    nodeMap.set(assetNode, node);
    node.name = `${assetNode.name}`;
    node.position.set(assetNode.position);
    node.rotation.set(assetNode.rotation);
    node.scale.set(assetNode.scaling);
    if (assetNode.mesh) {
      const meshData = assetNode.mesh;
      const skeleton = assetNode.skeleton;
      for (const subMesh of meshData.subMeshes) {
        for (const instance of assetNode.instances) {
          const meshNode = new Mesh(scene);
          meshNode.position = instance.t;
          meshNode.scale = instance.s;
          meshNode.rotation = instance.r;
          meshNode.name = subMesh.name;
          meshNode.clipTestEnabled = true;
          meshNode.showState = 'inherit';
          meshNode.primitive = subMesh.primitive;
          meshNode.material = instancing ? subMesh.material.createInstance() : subMesh.material;
          meshNode.parent = node;
          subMesh.mesh = meshNode;
          processMorphData(subMesh, meshData.morphWeights);
          if (skeleton) {
            if (!skeletonMeshMap.has(skeleton)) {
              skeletonMeshMap.set(skeleton, { mesh: [meshNode], bounding: [subMesh] });
            } else {
              skeletonMeshMap.get(skeleton).mesh.push(meshNode);
              skeletonMeshMap.get(skeleton).bounding.push(subMesh);
            }
          }
        }
      }
    }
    node.parent = parent;
    for (const child of assetNode.children) {
      this.setAssetNodeToSceneNode(scene, node, model, child, skeletonMeshMap, nodeMap, instancing);
    }
  }
  private getHash<T extends BaseTexture>(type: string, url: string, options: TextureFetchOptions<T>): string {
    return `${type}:${url}:${!options?.linearColorSpace}`;
  }
}
