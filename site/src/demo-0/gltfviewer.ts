import * as zip from '@zip.js/zip.js';
import type * as draco3d from 'draco3d';
import { Vector4, Vector3 } from '@zephyr3d/base';
import type { SceneNode, Scene, AnimationSet, OIT } from '@zephyr3d/scene';
import { Mesh, PlaneShape, PBRMetallicRoughnessMaterial } from '@zephyr3d/scene';
import {
  BatchGroup,
  PostWater,
  WeightedBlendedOIT,
  ABufferOIT,
  SAO,
  FFTWaveGenerator,
  OrbitCameraController
} from '@zephyr3d/scene';
import type { AABB } from '@zephyr3d/base';
import {
  BoundingBox,
  AssetManager,
  DirectionalLight,
  Application,
  Tonemap,
  PerspectiveCamera,
  Compositor,
  FXAA,
  Bloom
} from '@zephyr3d/scene';
import { EnvMaps } from './envmap';
import { Panel } from './ui';
import { imGuiInit, imGuiEndFrame, imGuiInjectEvent, imGuiNewFrame } from '@zephyr3d/imgui';
import { Inspector } from '@zephyr3d/inspector';

declare global {
  const DracoDecoderModule: draco3d.DracoDecoderModule;
}

export class GLTFViewer {
  private _currentAnimation: string;
  private _modelNode: SceneNode;
  private _animationSet: AnimationSet;
  private _assetManager: AssetManager;
  private _scene: Scene;
  private _tonemap: Tonemap;
  private _water: PostWater;
  private _bloom: Bloom;
  private _fxaa: FXAA;
  private _sao: SAO;
  private _oit: OIT;
  private _doTonemap: boolean;
  private _doWater: boolean;
  private _doBloom: boolean;
  private _doFXAA: boolean;
  private _doSAO: boolean;
  private _camera: PerspectiveCamera;
  private _light0: DirectionalLight;
  private _light1: DirectionalLight;
  private _fov: number;
  private _nearPlane: number;
  private _envMaps: EnvMaps;
  private _batchGroup: BatchGroup;
  private _floor: Mesh;
  private _ui: Panel;
  private _autoRotate: boolean;
  private _compositor: Compositor;
  private _dracoModule: draco3d.DecoderModule;
  private _inspector: Inspector;
  private _bboxNoScale: AABB;
  constructor(scene: Scene) {
    const device = Application.instance.device;
    this._currentAnimation = null;
    this._modelNode = null;
    this._animationSet = null;
    this._scene = scene;
    this._scene.env.light.strength = 0.5;
    this._envMaps = new EnvMaps();
    this._batchGroup = new BatchGroup(scene);
    this._assetManager = new AssetManager();
    this._tonemap = new Tonemap();
    this._water = new PostWater(0, new FFTWaveGenerator());
    this._water.elevation = 2;
    this._water.ssr = true;
    const floorMaterial = new PBRMetallicRoughnessMaterial();
    floorMaterial.metallic = 0.1;
    floorMaterial.roughness = 0.8;
    this._floor = new Mesh(scene, new PlaneShape({ size: 100 }), floorMaterial);
    this._bloom = new Bloom();
    this._sao = new SAO();
    this._sao.radius = 10;
    this._sao.intensity = 0.025;
    this._bloom.threshold = 0.85;
    this._bloom.intensity = 1.5;
    this._fxaa = new FXAA();
    this._doTonemap = true;
    this._doBloom = true;
    this._doFXAA = true;
    this._doWater = false;
    this._doSAO = false;
    this._autoRotate = false;
    this._oit = new WeightedBlendedOIT();
    this._fov = Math.PI / 3;
    this._nearPlane = 1;
    this._bboxNoScale = null;
    this._compositor = new Compositor();
    this._compositor.appendPostEffect(this._tonemap);
    this._compositor.appendPostEffect(this._bloom);
    this._compositor.appendPostEffect(this._fxaa);
    this._camera = new PerspectiveCamera(
      scene,
      Math.PI / 3,
      device.getDrawingBufferWidth() / device.getDrawingBufferHeight(),
      1,
      160
    );
    this._camera.oit = this._oit;
    this._camera.position.setXYZ(0, 0, 15);
    this._camera.controller = new OrbitCameraController();
    this._light0 = new DirectionalLight(this._scene).setColor(new Vector4(1, 1, 1, 1)).setCastShadow(true);
    this._light0.shadow.shadowMapSize = 1024;
    this._light0.lookAt(new Vector3(0, 0, 0), new Vector3(0, -1, 1), Vector3.axisPY());
    this._light1 = new DirectionalLight(this._scene).setColor(new Vector4(1, 1, 1, 1)).setCastShadow(false);
    this._light1.shadow.shadowMapSize = 1024;
    this._light1.lookAt(new Vector3(0, 0, 0), new Vector3(-0.5, 0.707, 0.5), Vector3.axisPY());
    this._envMaps.selectById(this._envMaps.getIdList()[0], this.scene);
    this._ui = new Panel(this);
    this._dracoModule = null;
    this._inspector = new Inspector(this._scene, this._compositor, this._camera);
  }
  async ready() {
    return new Promise<void>((resolve) => {
      DracoDecoderModule({
        onModuleLoaded: (module) => {
          this._dracoModule = module;
          imGuiInit(Application.instance.device).then(() => {
            Application.instance.inputManager.use(imGuiInjectEvent);
            Application.instance.inputManager.use(this._camera.handleEvent.bind(this._camera));
            resolve();
          });
        }
      });
    });
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
    this._assetManager
      .fetchModel(this._scene, url, {
        enableInstancing: true,
        dracoDecoderModule: this._dracoModule
      })
      .then((info) => {
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
            this._animationSet.playAnimation(animations[0]);
          }
        }
        this._ui.update();
        this._bboxNoScale = this.getBoundingBox();
        this._floor.parent = this._modelNode;
        this._floor.position.setXYZ(-50, this._bboxNoScale.minPoint.y, -50);
        this.lookAt();
        this._light0.shadow.shadowRegion = this.getBoundingBox();
      });
    this._water.ssrMaxDistance = Vector3.distance(
      this._scene.boundingBox.minPoint,
      this._scene.boundingBox.maxPoint
    );
  }
  async handleDrop(data: DataTransfer) {
    this.resolveDraggedItems(data).then(async (fileMap) => {
      if (fileMap) {
        this._assetManager.httpRequest.urlResolver = (url) => {
          return fileMap.get(url) || url;
        };
        if (fileMap.size === 1 && /\.zip$/i.test(Array.from(fileMap.keys())[0])) {
          fileMap = await this.readZip(fileMap.get(Array.from(fileMap.keys())[0]));
        }
        if (fileMap.size === 1 && /\.hdr$/i.test(Array.from(fileMap.keys())[0])) {
          const hdrFile = Array.from(fileMap.keys())[0];
          this._envMaps.selectByPath(hdrFile, this.scene, (url) => fileMap.get(url) || url);
        } else {
          const modelFile = Array.from(fileMap.keys()).find((val) => /(\.gltf|\.glb)$/i.test(val));
          if (!modelFile) {
            console.error('GLTF model not found');
          } else {
            await this.loadModel(modelFile);
          }
        }
      }
    });
  }
  playAnimation(name: string) {
    if (this._currentAnimation !== name) {
      this.stopAnimation();
      this._animationSet?.playAnimation(name);
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
  enableRotate(enable: boolean) {
    if (this._autoRotate !== enable) {
      this._autoRotate = enable;
      if (this._modelNode && !this._autoRotate) {
        this._modelNode.rotation.identity();
      }
    }
  }
  rotateEnabled(): boolean {
    return this._autoRotate;
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
  waterEnabled(): boolean {
    return this._doWater;
  }
  FXAAEnabled(): boolean {
    return this._doFXAA;
  }
  SAOEnabled(): boolean {
    return this._doSAO;
  }
  getOITType(): string {
    return this._oit?.getType() ?? '';
  }
  setOITType(val: string) {
    if (this._oit?.getType() !== val) {
      this._oit?.dispose();
      if (val === WeightedBlendedOIT.type) {
        this._oit = new WeightedBlendedOIT();
      } else if (val === ABufferOIT.type) {
        this._oit = new ABufferOIT();
      } else {
        this._oit = null;
      }
      this._camera.oit = this._oit;
    }
  }
  syncPostEffects() {
    this._compositor.clear();
    if (this._doSAO) {
      this._compositor.appendPostEffect(this._sao);
    }
    if (this._doWater) {
      this._compositor.appendPostEffect(this._water);
    }
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
  enableWater(enable: boolean) {
    if (!!enable !== this._doWater) {
      this._doWater = !!enable;
      this.syncPostEffects();
    }
  }
  enableFXAA(enable: boolean) {
    if (!!enable !== this._doFXAA) {
      this._doFXAA = !!enable;
      this.syncPostEffects();
    }
  }
  enableSAO(enable: boolean) {
    if (!!enable !== this._doSAO) {
      this._doSAO = !!enable;
      this.syncPostEffects();
    }
  }
  render() {
    if (this._modelNode && this._autoRotate) {
      const angle = Application.instance.device.frameInfo.elapsedOverall * 0.001;
      this._modelNode.rotation.fromAxisAngle(Vector3.axisPY(), angle);
    }
    this._camera.render(this._scene, this._compositor);
    if (true || (window as any).__NOT_EXISTS__) {
      imGuiNewFrame();
      this._inspector.render();
      imGuiEndFrame();
    }
    //this._ui.render();
  }
  lookAt() {
    const bbox = this._bboxNoScale;
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
  nextBackground() {
    const idList = this._envMaps.getIdList();
    if (idList?.length > 0) {
      const currentId = this._envMaps.getCurrentId();
      const index = idList.indexOf(currentId);
      const newIndex = (index + 1) % idList.length;
      this._envMaps.selectById(idList[newIndex], this._scene);
    }
  }
  private getBoundingBox(): AABB {
    const bbox = new BoundingBox();
    bbox.beginExtend();
    this.traverseModel((node) => {
      if (node.isGraphNode() && node !== this._floor) {
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
