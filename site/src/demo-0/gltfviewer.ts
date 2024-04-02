import * as zip from '@zip.js/zip.js';
import { Vector4, Vector3 } from '@zephyr3d/base';
import { SceneNode, Scene, AnimationSet, BatchGroup } from '@zephyr3d/scene';
import type { AABB } from '@zephyr3d/base';
import {
  BoundingBox,
  AssetManager,
  DirectionalLight,
  OrbitCameraController,
  Application,
  Tonemap,
  PerspectiveCamera,
  Compositor,
  FXAA,
  Bloom
} from '@zephyr3d/scene';
import { EnvMaps } from './envmap';
import { Panel } from './ui';

export class GLTFViewer {
  private _currentAnimation: string;
  private _modelNode: SceneNode;
  private _animationSet: AnimationSet;
  private _assetManager: AssetManager;
  private _scene: Scene;
  private _tonemap: Tonemap;
  private _bloom: Bloom;
  private _fxaa: FXAA;
  private _doTonemap: boolean;
  private _doBloom: boolean;
  private _doFXAA: boolean;
  private _camera: PerspectiveCamera;
  private _light0: DirectionalLight;
  private _light1: DirectionalLight;
  private _fov: number;
  private _nearPlane: number;
  private _envMaps: EnvMaps;
  private _batchGroup: BatchGroup;
  //private _ui: UI;
  private _ui: Panel;
  private _compositor: Compositor;
  constructor(scene: Scene) {
    this._currentAnimation = null;
    this._modelNode = null;
    this._animationSet = null;
    this._scene = scene;
    this._envMaps = new EnvMaps();
    this._batchGroup = new BatchGroup(scene);
    //this._ui = new UI(this);
    this._assetManager = new AssetManager();
    this._tonemap = new Tonemap();
    this._bloom = new Bloom();
    this._bloom.threshold = 0.85;
    this._bloom.intensity = 1.5;
    this._fxaa = new FXAA();
    this._doTonemap = true;
    this._doBloom = true;
    this._doFXAA = true;
    this._fov = Math.PI / 3;
    this._nearPlane = 1;
    this._compositor = new Compositor();
    this._compositor.appendPostEffect(this._tonemap);
    this._compositor.appendPostEffect(this._bloom);
    this._compositor.appendPostEffect(this._fxaa);
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
    this._envMaps.selectById(this._envMaps.getIdList()[0], this.scene);
    this._ui = new Panel(this);
  }
  get envMaps(): EnvMaps {
    return this._envMaps;
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
  get bloom(): Bloom {
    return this._bloom;
  }
  get camera(): PerspectiveCamera {
    return this._camera;
  }
  get scene(): Scene {
    return this._scene;
  }
  get animationSet(): AnimationSet {
    return this._animationSet;
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
    // Make url unique so that a file url in zip will not conflict with other zip
    for (const key of Array.from(fileMap.keys())) {
      fileMap.set(url + key, fileMap.get(key));
    }
    return fileMap;
  }
  async loadModel(url: string) {
    this._modelNode?.remove();
    this._assetManager.purgeCache();
    this._assetManager.fetchModel(this._scene, url, { enableInstancing: true }).then((info) => {
      this._modelNode?.dispose();
      this._modelNode = info.group;
      this._modelNode.parent = this._batchGroup;
      this._animationSet?.dispose();
      this._animationSet = info.animationSet;
      this._modelNode.pickable = true;
      this._currentAnimation = null;
      if (this._animationSet) {
        const animations = this._animationSet.getAnimationNames();
        if (animations.length > 0) {
          this._animationSet.playAnimation(animations[0], 0);
        }
      }
      this._ui.update();
      this.lookAt();
    });
  }
  async handleDrop(data: DataTransfer) {
    this.resolveDraggedItems(data).then(async (fileMap) => {
      if (fileMap){
        this._assetManager.httpRequest.urlResolver = (url) => {
          return fileMap.get(url) || url;
        };
        if (fileMap.size === 1 && /\.zip$/i.test(Array.from(fileMap.keys())[0])) {
          fileMap = await this.readZip(fileMap.get(Array.from(fileMap.keys())[0]))
        }
        if (fileMap.size === 1 && /\.hdr$/i.test(Array.from(fileMap.keys())[0])) {
          const hdrFile = Array.from(fileMap.keys())[0];
          this._envMaps.selectByPath(hdrFile, this.scene, url => fileMap.get(url) || url);
        } else {
          const modelFile = Array.from(fileMap.keys()).find((val) => /(\.gltf|\.glb)$/i.test(val));
          await this.loadModel(modelFile);
        }
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
  bloomEnabled(): boolean {
    return this._doBloom;
  }
  tonemapEnabled(): boolean {
    return this._doTonemap;
  }
  FXAAEnabled(): boolean {
    return this._doFXAA;
  }
  syncPostEffects() {
    this._compositor.clear();
    if (this._doTonemap) {
      this._compositor.appendPostEffect(this._tonemap);
    }
    if (this._doBloom) {
      this._compositor.appendPostEffect(this._bloom);
    }
    if (this._doFXAA) {
      this._compositor.appendPostEffect(this._fxaa);
    }
  }
  get punctualLightEnabled(): boolean {
    return this._light0.showState !== 'hidden';
  }
  set punctualLightEnabled(enable: boolean) {
    this._light0.showState = enable ? 'visible' : 'hidden';
    this._light1.showState = enable ? 'visible' : 'hidden';
  }
  get environmentLightEnabled(): boolean {
    return this._scene.env.light.type === 'ibl';
  }
  set environmentLightEnabled(enable: boolean) {
    this._scene.env.light.type = enable ? 'ibl' : 'none';
  }
  enableBloom(enable: boolean) {
    if (!!enable !== this._doBloom) {
      this._doBloom = !!enable;
      this.syncPostEffects();
    }
  }
  enableTonemap(enable: boolean) {
    if (!!enable !== this._doTonemap) {
      this._doTonemap = !!enable;
      this.syncPostEffects();
    }
  }
  enableFXAA(enable: boolean) {
    if (!!enable !== this._doFXAA) {
      this._doFXAA = !!enable;
      this.syncPostEffects();
    }
  }
  render() {
    this._camera.render(this._scene, this._compositor);
    //this._ui.render();
  }
  lookAt() {
    const bbox = this.getBoundingBox();
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
      this._camera.far = Math.max(1000, dist + extents.z + 100);
      (this._camera.controller as OrbitCameraController).setOptions({ center });
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
