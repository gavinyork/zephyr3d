import type { AABB } from '@zephyr3d/base';
import * as zip from '@zip.js/zip.js';
import { Vector4, Vector3, Vector2 } from '@zephyr3d/base';
import type { SceneNode, Scene, AnimationSet } from '@zephyr3d/scene';
import {
  BoundingBox,
  GraphNode,
  Material,
  AssetManager,
  DirectionalLight,
  OrbitCameraController,
  panoramaToCubemap,
  prefilterCubemap,
  Application,
  Tonemap,
  SAO,
  PerspectiveCamera,
  PostWater,
  Compositor,
  FXAA,
  Bloom,
  BUILTIN_ASSET_TEXTURE_SHEEN_LUT
} from '@zephyr3d/scene';
import type { Texture2D } from '@zephyr3d/device';
import type { TextureCube } from '@zephyr3d/device';

export class GLTFViewer {
  private _currentAnimation: string;
  private _modelNode: SceneNode;
  private _animationSet: AnimationSet;
  private _assetManager: AssetManager;
  private _scene: Scene;
  private _tonemap: Tonemap;
  private _sao: SAO;
  private _bloom: Bloom;
  private _water: PostWater;
  private _doTonemap: boolean;
  private _doSAO: boolean;
  private _doBloom: boolean;
  private _doWater: boolean;
  private _camera: PerspectiveCamera;
  private _light0: DirectionalLight;
  private _light1: DirectionalLight;
  private _fov: number;
  private _nearPlane: number;
  private _radianceMap: TextureCube;
  private _irradianceMap: TextureCube;
  private _skyMap: TextureCube;
  private _compositor: Compositor;
  constructor(scene: Scene) {
    this._currentAnimation = null;
    this._modelNode = null;
    this._animationSet = null;
    this._scene = scene;
    this._assetManager = new AssetManager();
    this._assetManager.fetchBuiltinTexture(BUILTIN_ASSET_TEXTURE_SHEEN_LUT);
    this._tonemap = new Tonemap();
    this._sao = new SAO();
    this._bloom = new Bloom();
    this._water = new PostWater(0);
    this._doTonemap = false;
    this._doSAO = false;
    this._doBloom = false;
    this._doWater = false;
    this._fov = Math.PI / 3;
    this._nearPlane = 1;
    this._compositor = new Compositor();
    this._compositor.appendPostEffect(new FXAA());
    this._camera = new PerspectiveCamera(
      scene,
      Math.PI / 3,
      Application.instance.device.getDrawingBufferWidth() /
        Application.instance.device.getDrawingBufferHeight(),
      1,
      160
    );
    this._camera.position.setXYZ(0, 0, 15);
    this._camera.controller = new OrbitCameraController();
    this._light0 = new DirectionalLight(this._scene).setColor(new Vector4(1, 1, 1, 1)).setCastShadow(false);
    this._light0.shadow.shadowMapSize = 1024;
    this._light0.lookAt(new Vector3(0, 0, 0), new Vector3(0, -1, 1), Vector3.axisPY());
    this._light1 = new DirectionalLight(this._scene).setColor(new Vector4(1, 1, 1, 1)).setCastShadow(false);
    this._light1.shadow.shadowMapSize = 1024;
    this._light1.lookAt(new Vector3(0, 0, 0), new Vector3(-0.5, 0.707, 0.5), Vector3.axisPY());
    this._radianceMap = Application.instance.device.createCubeTexture('rgba16f', 256);
    this._irradianceMap = Application.instance.device.createCubeTexture('rgba16f', 64, {
      samplerOptions: { mipFilter: 'none' }
    });

    scene.env.sky.skyType = 'scatter';
    scene.env.sky.wind = new Vector2(160, 240);
    scene.env.sky.fogType = 'none';
    scene.env.sky.fogStart = 10;
    scene.env.sky.fogEnd = 300;
    scene.env.sky.fogTop = 30;
    if (scene.env.sky.skyboxTexture) {
      prefilterCubemap(scene.env.sky.skyboxTexture, 'ggx', this._radianceMap);
      prefilterCubemap(scene.env.sky.skyboxTexture, 'lambertian', this._irradianceMap);
    }
    scene.env.light.type = 'ibl';
    //scene.env.light.radianceMap = this._radianceMap;
    //scene.env.light.irradianceMap = this._irradianceMap;
    this._skyMap = Application.instance.device.createCubeTexture('rgba16f', 512);

    /*
    this._assetManager.fetchTexture<Texture2D>(`./assets/images/environments/papermill.hdr`).then(tex => {
      panoramaToCubemap(tex, this._skyMap);
      prefilterCubemap(this._skyMap, 'ggx', this._radianceMap);
      prefilterCubemap(this._skyMap, 'lambertian', this._irradianceMap);
      scene.env.light.type = 'ibl';
      scene.env.light.radianceMap = this._radianceMap;
      scene.env.light.irradianceMap = this._irradianceMap;
      scene.env.sky.skyType = 'skybox';
      scene.env.sky.skyboxTexture = this._skyMap;
      scene.env.sky.fogType = 'none';
      scene.env.sky.fogStart = 10;
      scene.env.sky.fogEnd = 300;
      scene.env.sky.fogTop = 30;
      tex.dispose();
    });
    */
    Material.setGCOptions({
      drawableCountThreshold: 0,
      materialCountThreshold: 0,
      inactiveTimeDuration: 10000,
      verbose: true
    });
  }
  get assetManager() {
    return this._assetManager;
  }
  get light0(): DirectionalLight {
    return this._light0;
  }
  get light1(): DirectionalLight {
    return this._light1;
  }
  get FOV(): number {
    return this._fov;
  }
  set FOV(val: number) {
    if (val !== this._fov) {
      this._fov = val;
      this.lookAt();
    }
  }
  get sao(): SAO {
    return this._sao;
  }
  get bloom(): Bloom {
    return this._bloom;
  }
  get camera(): PerspectiveCamera {
    return this._camera;
  }
  get scene(): Scene {
    return this._scene;
  }
  get animations(): string[] {
    return this._animationSet?.getAnimationNames() || [];
  }
  get compositor(): Compositor {
    return this._compositor;
  }
  async readZip(url: string): Promise<Map<string, string>> {
    const response = await fetch(url);
    const blob = await response.blob();
    const reader = new zip.ZipReader(new zip.BlobReader(blob));
    const entries = await reader.getEntries();
    const fileMap = new Map();
    for (const entry of entries) {
      if (!entry.directory) {
        const blob = await entry.getData(new zip.BlobWriter());
        const fileURL = URL.createObjectURL(blob);
        fileMap.set(`/${entry.filename}`, fileURL);
      }
    }
    await reader.close();
    return fileMap;
  }
  async handleDrop(data: DataTransfer) {
    this.resolveDraggedItems(data).then(async (fileMap) => {
      if (fileMap) {
        this._assetManager.httpRequest.urlResolver = (url) => {
          return fileMap.get(url) || url;
        };
        if (fileMap.size === 1 && /\.zip$/i.test(Array.from(fileMap.keys())[0])) {
          fileMap = await this.readZip(fileMap.get(Array.from(fileMap.keys())[0]))
        }
        console.log(fileMap);
        if (fileMap.size === 1 && /\.hdr$/i.test(Array.from(fileMap.keys())[0])) {
          const hdrFile = Array.from(fileMap.keys())[0];
          this._assetManager
            .fetchTexture<Texture2D>(hdrFile, {
              linearColorSpace: true,
              samplerOptions: {
                mipFilter: 'none'
              }
            })
            .then((tex) => {
              panoramaToCubemap(tex, this._skyMap);
              prefilterCubemap(this._skyMap, 'ggx', this._radianceMap);
              prefilterCubemap(this._skyMap, 'lambertian', this._irradianceMap);
              this._scene.env.sky.skyboxTexture = this._skyMap;
              tex.dispose();
            });
        } else {
          const modelFile = Array.from(fileMap.keys()).find((val) => /(\.gltf|\.glb)$/i.test(val));
          if (modelFile) {
            this._modelNode?.remove();
            this._assetManager.clearCache();
            this._assetManager.fetchModel(this._scene, modelFile, null).then((info) => {
              this._modelNode?.dispose();
              this._modelNode = info.group;
              this._animationSet?.dispose();
              this._animationSet = info.animationSet;
              this._modelNode.pickMode = GraphNode.PICK_ENABLED;
              this._currentAnimation = null;
              if (this._animationSet) {
                const animations = this._animationSet.getAnimationNames();
                if (animations.length > 0) {
                  this._animationSet.playAnimation(animations[0], 0);
                }
              }
              this.lookAt();
            });
          }
        }
        console.log(this._modelNode);
      }
    });
  }
  playAnimation(name: string) {
    if (this._currentAnimation !== name) {
      this.stopAnimation();
      this._animationSet?.playAnimation(name, 0);
      this._currentAnimation = name;
      this.lookAt();
    }
  }
  stopAnimation() {
    if (this._currentAnimation) {
      this._animationSet?.stopAnimation(this._currentAnimation);
      this._currentAnimation = null;
      this.lookAt();
    }
  }
  enableShadow(enable: boolean) {
    this._light0.setCastShadow(enable);
  }
  toggleWater(): boolean {
    if (!this._doWater) {
      this._compositor.appendPostEffect(this._water);
      this._doWater = true;
    } else {
      this._compositor.removePostEffect(this._water);
      this._doWater = false;
    }
    return this._doWater;
  }
  toggleBloom(): boolean {
    if (this._doBloom) {
      this._compositor.removePostEffect(this._bloom);
      this._doBloom = false;
    } else {
      this._compositor.appendPostEffect(this._bloom);
      this._doBloom = true;
    }
    return this._doBloom;
  }
  toggleTonemap(): boolean {
    if (!this._doTonemap) {
      this._compositor.appendPostEffect(this._tonemap);
      this._doTonemap = true;
    } else {
      this._compositor.removePostEffect(this._tonemap);
      this._doTonemap = false;
    }
    return this._doTonemap;
  }
  toggleSAO(): boolean {
    if (!this._doSAO) {
      this._compositor.appendPostEffect(this._sao);
      this._doSAO = true;
    } else {
      this._compositor.removePostEffect(this._sao);
      this._doSAO = false;
    }
    return this._doSAO;
  }
  render() {
    this._camera.render(this._scene, this._compositor);
  }
  lookAt() {
    const bbox = this.getBoundingBox();
    console.log(bbox.extents.toString());
    const minSize = 10;
    const maxSize = 100;
    if (bbox) {
      const center = bbox.center;
      const extents = bbox.extents;
      let size = Math.max(extents.x, extents.y);
      if (size < minSize || size > maxSize) {
        const scale = size < minSize ? minSize / size : maxSize / size;
        this._modelNode.scaleBy(new Vector3(scale, scale, scale));
        center.scaleBy(scale);
        extents.scaleBy(scale);
        size *= scale;
      }
      const dist = size / Math.tan(this._fov * 0.5) + extents.z + this._nearPlane;

      this._camera.lookAt(
        Vector3.add(center, Vector3.scale(Vector3.axisPZ(), dist)),
        center,
        Vector3.axisPY()
      );
      this._camera.near = Math.min(1, this._camera.near);
      this._camera.far = Math.max(10, dist + extents.z + 100);
      (this._camera.controller as OrbitCameraController).setOptions({ distance: dist });
    }
  }
  private getBoundingBox(): AABB {
    const bbox = new BoundingBox();
    bbox.beginExtend();
    this.traverseModel((node) => {
      if (node.isGraphNode()) {
        const aabb = node.getWorldBoundingVolume()?.toAABB();
        if (aabb && aabb.isValid()) {
          bbox.extend(aabb.minPoint);
          bbox.extend(aabb.maxPoint);
        }
      }
    });
    return bbox.isValid() ? bbox : null;
  }
  private traverseModel(func: (node: SceneNode) => void, context?: any) {
    if (this._modelNode) {
      const queue: SceneNode[] = [this._modelNode];
      while (queue.length > 0) {
        const node = queue.shift();
        queue.push(...node.children);
        if (node.isMesh()) {
          func.call(context, node);
        }
      }
    }
  }
  private async readDirectoryEntry(entry: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> {
    return new Promise((resolve, reject) => {
      entry.createReader().readEntries(
        (fileEntries) => resolve(fileEntries),
        (err) => reject(err)
      );
    });
  }
  private async resolveDirectoryEntries(
    files: File[],
    entries: FileSystemEntry[]
  ): Promise<Map<string, { entry: FileSystemEntry; file: File }>> {
    const map: Map<string, { entry: FileSystemEntry; file: File }> = new Map();
    let i = 0;
    while (i < entries.length) {
      const entry = entries[i];
      if (entry.isDirectory) {
        entries.splice(i, 1);
        if (i < files.length) {
          files.splice(i, 1);
        }
        entries.push(...(await this.readDirectoryEntry(entry as FileSystemDirectoryEntry)));
      } else {
        map.set(entry.fullPath, {
          entry,
          file: i < files.length ? files[i] : null
        });
        i++;
      }
    }
    return map;
  }
  private async resolveFileEntries(
    map: Map<string, { entry: FileSystemEntry; file: File }>
  ): Promise<Map<string, string>> {
    const result: Map<string, string> = new Map();
    const promises = Array.from(map.entries()).map(
      (entry) =>
        new Promise<File>((resolve, reject) => {
          const key = `/${entry[0]
            .slice(1)
            .split('/')
            .map((val) => encodeURIComponent(val))
            .join('/')}`;
          if (entry[1].file) {
            result.set(key, URL.createObjectURL(entry[1].file));
            resolve(null);
          } else {
            (entry[1].entry as FileSystemFileEntry).file(
              (f) => {
                result.set(key, URL.createObjectURL(f));
                resolve(null);
              },
              (err) => reject(err)
            );
          }
        })
    );
    await Promise.all(promises);
    return result;
  }
  private async resolveDraggedItems(data: DataTransfer): Promise<Map<string, string>> {
    const files = Array.from(data.files);
    const entries = Array.from(data.items).map((item) => item.webkitGetAsEntry());
    const map = await this.resolveDirectoryEntries(files, entries);
    const result = await this.resolveFileEntries(map);
    return result;
  }
}
