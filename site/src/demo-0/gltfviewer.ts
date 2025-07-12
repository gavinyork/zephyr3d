import * as zip from '@zip.js/zip.js';
import type * as draco3d from 'draco3d';
import { Vector4, Vector3, HttpRequest } from '@zephyr3d/base';
import type { SceneNode, Scene, AnimationSet, OIT } from '@zephyr3d/scene';
import { DRef } from '@zephyr3d/scene';
import { Mesh, PlaneShape, LambertMaterial } from '@zephyr3d/scene';
import { BatchGroup, WeightedBlendedOIT, ABufferOIT, OrbitCameraController } from '@zephyr3d/scene';
import type { AABB } from '@zephyr3d/base';
import { BoundingBox, AssetManager, DirectionalLight, Application, PerspectiveCamera } from '@zephyr3d/scene';
import { EnvMaps } from './envmap';
import { Panel } from './ui';

declare global {
  const DracoDecoderModule: draco3d.DracoDecoderModule;
}

export class GLTFViewer {
  private _currentAnimation: string;
  private _modelNode: DRef<SceneNode>;
  private _animationSet: DRef<AnimationSet>;
  private _assetManager: AssetManager;
  private _scene: Scene;
  private _oit: OIT;
  private _camera: PerspectiveCamera;
  private _light0: DirectionalLight;
  private _light1: DirectionalLight;
  private _fov: number;
  private _nearPlane: number;
  private _envMaps: EnvMaps;
  private _batchGroup: BatchGroup;
  private _floor: Mesh;
  private _ui: Panel;
  private _showGUI: boolean;
  private _showFloor: boolean;
  private _useScatter: boolean;
  private _autoRotate: boolean;
  private _dracoModule: draco3d.DecoderModule;
  private _bboxNoScale: AABB;
  constructor(scene: Scene) {
    const device = Application.instance.device;
    this._currentAnimation = null;
    this._modelNode = new DRef();
    this._animationSet = new DRef();
    this._scene = scene;
    this._scene.env.light.strength = 0.8;
    this._scene.env.sky.drawGround = true;
    this._envMaps = new EnvMaps();
    this._batchGroup = new BatchGroup(scene);
    this._assetManager = new AssetManager();
    const floorMaterial = new LambertMaterial();
    floorMaterial.albedoColor = new Vector4(0.8, 0.8, 0.8, 1);
    this._floor = new Mesh(scene, new PlaneShape({ size: 1, anchor: 0 }), floorMaterial);
    this._floor.castShadow = false;
    this._autoRotate = false;
    this._oit = new WeightedBlendedOIT();
    this._fov = Math.PI / 3;
    this._nearPlane = 1;
    this._bboxNoScale = null;
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
    this._light0 = new DirectionalLight(this._scene)
      .setColor(new Vector4(1, 1, 1, 1))
      .setIntensity(18)
      .setCastShadow(true);
    this._light0.shadow.shadowMapSize = 1024;
    this._light0.shadow.depthBias = 0.1;
    this._light0.shadow.mode = 'pcf-opt';
    this._light0.shadow.pcfKernelSize = 7;
    this._light0.lookAt(new Vector3(0, 0, 0), new Vector3(1, -1, 1), Vector3.axisPY());
    this._light1 = new DirectionalLight(this._scene)
      .setColor(new Vector4(1, 1, 1, 1))
      .setIntensity(10)
      .setCastShadow(false);
    this._light1.shadow.shadowMapSize = 1024;
    this._light1.lookAt(new Vector3(0, 0, 0), new Vector3(-0.5, 0.707, 0.5), Vector3.axisPY());
    this._envMaps.selectById(this._envMaps.getIdList()[0], this.scene);
    this._ui = new Panel(this);
    this._showGUI = true;
    this._showFloor = false;
    this._useScatter = false;
    this._dracoModule = null;
  }
  async ready() {
    return new Promise<void>((resolve) => {
      DracoDecoderModule({
        onModuleLoaded: (module) => {
          this._dracoModule = module;
          Application.instance.inputManager.use(this._camera.handleEvent.bind(this._camera));
          resolve();
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
  get camera(): PerspectiveCamera {
    return this._camera;
  }
  get scene(): Scene {
    return this._scene;
  }
  get animationSet(): AnimationSet {
    return this._animationSet.get();
  }
  get animations(): string[] {
    return this._animationSet.get()?.getAnimationNames() || [];
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
  async loadModel(url: string, httpRequest?: HttpRequest) {
    this._assetManager
      .fetchModel(
        this._scene,
        url,
        {
          enableInstancing: true,
          dracoDecoderModule: this._dracoModule
        },
        httpRequest
      )
      .then((info) => {
        this._camera.clearHistoryData();
        this._modelNode.get()?.remove();
        this._modelNode.set(info.group);
        this._modelNode.get().parent = this._batchGroup;
        this._animationSet.set(info.animationSet);
        this._modelNode.get().pickable = true;
        this._currentAnimation = null;
        if (this._animationSet.get()) {
          const animations = this._animationSet.get().getAnimationNames();
          if (animations.length > 0) {
            this._animationSet.get().playAnimation(animations[0]);
          }
        }
        this._ui.update();
        this._bboxNoScale = this.getBoundingBox();
        const scaleFactor =
          Math.max(this._bboxNoScale.maxPoint.x, this._bboxNoScale.maxPoint.y, this._bboxNoScale.maxPoint.z) *
          8;
        this._floor.scale.setXYZ(scaleFactor, 1, scaleFactor);
        this._floor.position.setXYZ(
          -0.5 * scaleFactor,
          this._bboxNoScale.minPoint.y - this._bboxNoScale.extents.y * 0.01,
          -0.5 * scaleFactor
        );
        this._floor.parent = this._showFloor ? this._modelNode.get() : null;
        this.lookAt();
        this._light0.shadow.shadowRegion = this.getBoundingBox();
        this._camera.clearHistoryData();
      });
  }
  async handleDrop(data: DataTransfer) {
    this.resolveDraggedItems(data).then(async (fileMap) => {
      if (fileMap) {
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
            await this.loadModel(modelFile, new HttpRequest((url) => fileMap.get(url) ?? url));
          }
        }
      }
    });
  }
  playAnimation(name: string) {
    if (this._currentAnimation !== name) {
      this.stopAnimation();
      this._animationSet.get()?.playAnimation(name);
      this._currentAnimation = name;
      this.lookAt();
    }
  }
  stopAnimation() {
    if (this._currentAnimation) {
      this._animationSet.get()?.stopAnimation(this._currentAnimation);
      this._currentAnimation = null;
      this.lookAt();
    }
  }
  enableRotate(enable: boolean) {
    if (this._autoRotate !== enable) {
      this._autoRotate = enable;
      if (this._modelNode.get() && !this._autoRotate) {
        this._modelNode.get().rotation.identity();
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
    return this._camera.bloom;
  }
  tonemapEnabled(): boolean {
    return this._camera.toneMap;
  }
  FXAAEnabled(): boolean {
    return this._camera.FXAA;
  }
  SAOEnabled(): boolean {
    return this._camera.SSAO;
  }
  TAAEnabled(): boolean {
    return this._camera.TAA;
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
  get punctualLightEnabled(): boolean {
    return this._light0.showState !== 'hidden';
  }
  set punctualLightEnabled(enable: boolean) {
    this._light0.showState = enable ? 'visible' : 'hidden';
    this._light1.showState = enable ? 'visible' : 'hidden';
  }
  enableBloom(enable: boolean) {
    this._camera.bloom = !!enable;
  }
  enableTonemap(enable: boolean) {
    this._camera.toneMap = !!enable;
  }
  enableFXAA(enable: boolean) {
    this._camera.FXAA = !!enable;
  }
  enableSAO(enable: boolean) {
    this._camera.SSAO = !!enable;
  }
  enableTAA(enable: boolean) {
    this._camera.TAA = !!enable;
  }
  render() {
    if (this._modelNode.get()) {
      if (this._autoRotate) {
        const angle = Application.instance.device.frameInfo.elapsedOverall * 0.001;
        this._modelNode.get().rotation.fromAxisAngle(Vector3.axisPY(), angle);
      }
      if (this._animationSet) {
        this._light0.shadow.shadowRegion = this.getBoundingBox();
      }
    }
    this._camera.render(this._scene);
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
        this._modelNode.get().scaleBy(new Vector3(scale, scale, scale));
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
      if (this._camera.controller instanceof OrbitCameraController) {
        this._camera.controller.setOptions({ center });
      }
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
      const queue: DRef<SceneNode>[] = [this._modelNode];
      while (queue.length > 0) {
        const node = queue.shift();
        queue.push(...node.get().children);
        if (node.get().isMesh()) {
          func.call(context, node.get());
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
  toggleScatter() {
    this._useScatter = !this._useScatter;
    if (this._useScatter) {
      this._scene.env.sky.skyType = 'scatter';
      this._scene.env.light.radianceMap = this._scene.env.sky.radianceMap;
      this._scene.env.light.irradianceMap = this._scene.env.sky.irradianceMap;
    } else {
      this._envMaps.selectById(this._envMaps.getCurrentId(), this._scene);
    }
  }
  toggleFloor() {
    this._showFloor = !this._showFloor;
    this._floor.parent = this._showFloor ? this._modelNode.get() : null;
  }
  toggleGUI() {
    this._showGUI = !this._showGUI;
    this._ui.show(this._showGUI);
  }
  randomLightDir() {
    this._light0.lookAt(
      new Vector3(0, 0, 0),
      new Vector3(Math.random() * 2 - 1, -1, Math.random() * 2 - 1),
      Vector3.axisPY()
    );
  }
  toggleShadow() {
    this._light0.castShadow = !this._light0.castShadow;
  }
  private async resolveDraggedItems(data: DataTransfer): Promise<Map<string, string>> {
    const files = Array.from(data.files);
    const entries = Array.from(data.items).map((item) => item.webkitGetAsEntry());
    const map = await this.resolveDirectoryEntries(files, entries);
    const result = await this.resolveFileEntries(map);
    return result;
  }
}
