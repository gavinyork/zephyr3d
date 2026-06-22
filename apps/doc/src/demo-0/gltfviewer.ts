import { Vector4, Vector3, DRef, DataTransferVFS } from '@zephyr3d/base';
import type { SceneNode, Scene, AnimationSet, OIT } from '@zephyr3d/scene';
import { LambertMaterial, getInput, getEngine } from '@zephyr3d/scene';
import { BatchGroup, WeightedBlendedOIT, ABufferOIT, OrbitCameraController } from '@zephyr3d/scene';
import type { AABB, VFS } from '@zephyr3d/base';
import { BoundingBox, DirectionalLight, PerspectiveCamera } from '@zephyr3d/scene';
import { EnvMaps } from './envmap';
import { Panel } from './ui';

export class GLTFViewer {
  private _currentAnimation: string;
  private readonly _modelNode: DRef<SceneNode>;
  private readonly _animationSet: DRef<AnimationSet>;
  private readonly _scene: Scene;
  private _oit: OIT;
  private readonly _camera: PerspectiveCamera;
  private readonly _light: DirectionalLight;
  private readonly _fov: number;
  private readonly _nearPlane: number;
  private readonly _envMaps: EnvMaps;
  private readonly _batchGroup: BatchGroup;
  private readonly _ui: Panel;
  private _bboxNoScale: AABB;
  constructor(scene: Scene) {
    this._currentAnimation = null;
    this._modelNode = new DRef();
    this._animationSet = new DRef();
    this._scene = scene;
    this._scene.env.light.strength = 0.8;
    this._envMaps = new EnvMaps();
    this._batchGroup = new BatchGroup(scene);
    const floorMaterial = new LambertMaterial();
    floorMaterial.albedoColor = new Vector4(0.8, 0.8, 0.8, 1);
    this._oit = new WeightedBlendedOIT();
    this._fov = Math.PI / 3;
    this._nearPlane = 1;
    this._bboxNoScale = null;
    this._camera = new PerspectiveCamera(scene, Math.PI / 3, 1, 160);
    this._camera.oit = this._oit;
    this._camera.position.setXYZ(0, 0, 15);
    this._camera.controller = new OrbitCameraController();
    this._light = new DirectionalLight(this._scene).setColor(new Vector4(1, 1, 1, 1)).setIntensity(8);
    this._light.lookAt(new Vector3(0, 0, 0), new Vector3(1, -1, 1), Vector3.axisPY());
    this._envMaps.selectById(this._envMaps.getIdList()[0], this.scene);
    this._ui = new Panel(this);
    getInput().use(this._camera.handleEvent, this._camera);
  }
  get envMaps(): EnvMaps {
    return this._envMaps;
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
  async loadModel(url: string, vfs?: VFS) {
    this._modelNode.get()?.remove();
    this._modelNode.dispose();
    const node = await getEngine().resourceManager.fetchModel(url, this._scene, { overrideVFS: vfs });
    this._camera.clearHistoryData();
    this._modelNode.set(node);
    this._modelNode.get().parent = this._batchGroup;
    this._animationSet.set(node.animationSet);
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
    this.lookAt();
    this._light.shadow.shadowRegion.clear().addDynamicCaster(this._modelNode.get());
    this._camera.clearHistoryData();
  }
  async handleDrop(data: DataTransfer) {
    const dtVFS = new DataTransferVFS(data);
    try {
      const result = await dtVFS.glob('/**/*.{gltf,glb,vrm}', { recursive: true, includeDirs: false });
      if (result.length > 0) {
        const gltf = result[0].path;
        await this.loadModel(gltf, dtVFS);
      }
    } finally {
      dtVFS.wipe();
    }
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
  enableShadow(enable: boolean) {
    this._light.setCastShadow(enable);
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
    return this._light.showState !== 'hidden';
  }
  set punctualLightEnabled(enable: boolean) {
    this._light.showState = enable ? 'visible' : 'hidden';
  }
  enableTonemap(enable: boolean) {
    this._camera.toneMap = !!enable;
  }
  enableFXAA(enable: boolean) {
    this._camera.FXAA = !!enable;
  }
  enableTAA(enable: boolean) {
    this._camera.TAA = !!enable;
  }
  render() {
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
      const queue: SceneNode[] = [this._modelNode.get()];
      while (queue.length > 0) {
        const node = queue.shift();
        queue.push(...node.children);
        if (node.isMesh()) {
          func.call(context, node);
        }
      }
    }
  }
}
