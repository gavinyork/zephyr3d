import type { HttpFS } from '@zephyr3d/base';
import { PRNG, Quaternion, Vector3, Vector4 } from '@zephyr3d/base';
import type { Texture2D } from '@zephyr3d/device';
import type { AssetHierarchyNode, MeshMaterial, ModelInfo, SharedModel, SceneNode } from '@zephyr3d/scene';
import { BatchGroup, getDevice, getInput } from '@zephyr3d/scene';
import {
  AssetManager,
  DirectionalLight,
  OrbitCameraController,
  PBRMetallicRoughnessMaterial,
  PBRSpecularGlossinessMaterial,
  PerspectiveCamera,
  Scene,
  Terrain
} from '@zephyr3d/scene';
import * as zip from '@zip.js/zip.js';
import { TreeMaterialMetallicRoughness } from './treematerial';
import { Panel } from './ui';

export class Demo {
  private readonly _assetManager: AssetManager;
  private readonly _scene: Scene;
  private readonly _root: SceneNode;
  private _terrain: Terrain;
  private readonly _camera: PerspectiveCamera;
  private _character: ModelInfo;
  private readonly _axisPZ: Vector3;
  private readonly _actorTarget: Vector3;
  private readonly _actorDirection: Vector3;
  private readonly _actorSpeed: number;
  private _actorRunning: boolean;
  private _loaded: boolean;
  private _loadPercent: number;
  private _showInspector: boolean;
  private _ui: Panel;
  private _lastAnimation: string;
  constructor() {
    this._terrain = null;
    this._axisPZ = Vector3.axisPZ();
    this._actorTarget = new Vector3();
    this._actorDirection = new Vector3();
    this._actorSpeed = 6;
    this._actorRunning = false;
    this._assetManager = new AssetManager();
    this._scene = this.createScene();
    this._root = new BatchGroup(this._scene);
    this._camera = this.createCamera(this._scene);
    this._camera.bloom = true;
    this._camera.FXAA = true;
    getDevice().setFont('24px arial');
    this.render();
    this._loaded = false;
    this._loadPercent = 0;
    this._ui = null;
    this._lastAnimation = null;
  }
  async fetchAssetArchive(url: string, progressCallback: (percent: number) => void): Promise<Blob> {
    progressCallback(0);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error('Download failed');
    }
    const contentLength = response.headers.get('content-length');
    const totalBytes = contentLength ? parseInt(contentLength, 10) : 0;
    let receivedBytes = 0;
    let data: Uint8Array<ArrayBuffer> = new Uint8Array(totalBytes || 1024 * 1024);
    const reader = response.body.getReader();
    if (!reader) {
      throw new Error('Download data is empty');
    }
    const read = async (): Promise<void> => {
      const { done, value } = await reader.read();
      if (done) {
        return;
      }
      if (data.length < receivedBytes + value.length) {
        const newData = new Uint8Array(Math.max(2 * data.length, receivedBytes + value.length));
        newData.set(data);
        data = newData;
      }
      data.set(value, receivedBytes);
      receivedBytes += value.length;
      progressCallback(Math.floor((receivedBytes / totalBytes) * 100));
      return read();
    };
    await read();
    return new Blob([data]);
  }

  private async readZip(blob: Blob): Promise<Map<string, string>> {
    const reader = new zip.ZipReader(new zip.BlobReader(blob));
    const entries = await reader.getEntries();
    const fileMap = new Map();
    for (const entry of entries) {
      if (!entry.directory) {
        const blob = await (entry as zip.FileEntry).getData(new zip.BlobWriter());
        const fileURL = URL.createObjectURL(blob);
        fileMap.set(`/${entry.filename}`, fileURL);
      }
    }
    await reader.close();
    return fileMap;
  }

  get camera() {
    return this._camera;
  }
  createScene(): Scene {
    const scene = new Scene();
    scene.env.light.type = 'ibl';
    scene.env.light.strength = 1;
    scene.env.light.radianceMap = scene.env.sky.radianceMap;
    scene.env.light.irradianceMap = scene.env.sky.irradianceMap;
    scene.env.sky.skyType = 'scatter';
    scene.env.sky.cloudy = 0.6;

    const light = new DirectionalLight(scene).setColor(new Vector4(1, 1, 1, 1)).setIntensity(15);
    light.lookAt(new Vector3(1, 1, 1), new Vector3(0, 0, 0), Vector3.axisPY());
    light.intensity = 4;
    light.shadow.shadowMapSize = 2048;
    light.shadow.numShadowCascades = 4;
    light.shadow.shadowDistance = 300;
    light.castShadow = true;
    light.shadow.mode = 'pcf-opt';

    return scene;
  }
  createCamera(scene: Scene): PerspectiveCamera {
    const camera = new PerspectiveCamera(scene, Math.PI / 3, 1, 1500);
    return camera;
  }
  async load() {
    this._loaded = false;
    this._loadPercent = 0;
    const zipContent = await this.fetchAssetArchive(
      'https://cdn.zephyr3d.org/doc/assets/terrain_assets.zip',
      (percent) => {
        this._loadPercent = percent;
      }
    );
    getDevice().runNextFrame(async () => {
      const fileMap = await this.readZip(zipContent);
      (this._assetManager.vfs as HttpFS).urlResolver = (url) => fileMap.get(url) || url;

      // load world
      this._terrain = await this.loadTerrain(this._scene, this._assetManager);
      this._terrain.parent = this._root;
      this._character = await this.loadCharacter(this._scene, this._assetManager);
      // initialize
      this._camera.parent = this._terrain;
      this._character.group.parent = this._terrain;
      this._character.group.showState = 'visible';
      const x = this._terrain.scaledWidth * 0.37;
      const z = this._terrain.scaledHeight * 0.19;
      const y = this._terrain.getElevation(x, z);
      this._character.group.position.setXYZ(x, y, z);
      this.idle();
      //this._character.animationSet.playAnimation('idle01_yindao', 0);
      const eyePos = new Vector3(x + 1, y + 5, z - 21);
      const destPos = new Vector3(x, y, z);
      this._camera.lookAt(eyePos, destPos, Vector3.axisPY());
      this._camera.controller = new OrbitCameraController({ center: destPos });
      // loaded
      this._terrain.showState = 'visible';
      this._scene.env.sky.wind.setXY(700, 350);
      getInput().use(this._camera.handleEvent.bind(this._camera));
      this._loaded = true;
    });
  }
  playAnimation(name: string) {
    if (this._lastAnimation !== name) {
      if (this._lastAnimation) {
        this._character.animationSet.stopAnimation(this._lastAnimation, { fadeOut: 0.3 });
      }
      this._character.animationSet.playAnimation(name, { fadeIn: 0.3 });
      this._lastAnimation = name;
    }
  }
  idle() {
    this.playAnimation('idle01_yindao');
  }
  run() {
    this.playAnimation('run_front');
  }
  async loadCharacter(scene: Scene, assetManager: AssetManager) {
    const character = await assetManager.fetchModel(
      scene,
      'https://cdn.zephyr3d.org/doc/assets/models/alice_shellfire/scene.gltf'
    );
    character.group.scale.setXYZ(2, 2, 2);
    return character;
  }
  async loadTerrain(scene: Scene, assetManager: AssetManager) {
    const mapWidth = 1025;
    const mapHeight = 1025;
    const heightMap = await assetManager.fetchBinaryData(
      'https://cdn.zephyr3d.org/doc/assets/maps/map3/heightmap.raw'
    );
    const heightsInt16 = new Uint16Array(heightMap);
    const heightsF32 = new Float32Array(mapWidth * mapHeight);
    for (let i = 0; i < mapWidth * mapHeight; i++) {
      heightsF32[i] = heightsInt16[i] / 65535;
    }
    const grassMap1 = await assetManager.fetchTexture<Texture2D>(
      'https://cdn.zephyr3d.org/doc/assets/maps/map3/857caeb1.dds'
    );
    const grassMap2 = await assetManager.fetchTexture<Texture2D>(
      'https://cdn.zephyr3d.org/doc/assets/maps/map3/grass1x.dds'
    );
    const grassMap3 = await assetManager.fetchTexture<Texture2D>(
      'https://cdn.zephyr3d.org/doc/assets/maps/map3/gj02.dds'
    );
    const splatMap = await assetManager.fetchTexture<Texture2D>(
      'https://cdn.zephyr3d.org/doc/assets/maps/map3/splatmap.tga',
      {
        linearColorSpace: true
      }
    );
    const detailAlbedo0 = await assetManager.fetchTexture<Texture2D>(
      'https://cdn.zephyr3d.org/doc/assets/maps/map3/grass_color.png',
      {
        linearColorSpace: false
      }
    );
    const detailNormal0 = await assetManager.fetchTexture<Texture2D>(
      'https://cdn.zephyr3d.org/doc/assets/maps/map3/grass_norm.png',
      {
        linearColorSpace: true
      }
    );
    const detailAlbedo1 = await assetManager.fetchTexture<Texture2D>(
      'https://cdn.zephyr3d.org/doc/assets/maps/map3/28.png',
      {
        linearColorSpace: false
      }
    );
    const detailNormal1 = await assetManager.fetchTexture<Texture2D>(
      'https://cdn.zephyr3d.org/doc/assets/maps/map3/29.png',
      {
        linearColorSpace: true
      }
    );
    const detailAlbedo2 = await assetManager.fetchTexture<Texture2D>(
      'https://cdn.zephyr3d.org/doc/assets/maps/map3/174.jpg',
      {
        linearColorSpace: false
      }
    );
    const detailNormal2 = await assetManager.fetchTexture<Texture2D>(
      'https://cdn.zephyr3d.org/doc/assets/maps/map3/174_norm.jpg',
      {
        linearColorSpace: true
      }
    );
    const terrain = new Terrain(scene);
    terrain.scale.setXYZ(0.5, 1, 0.5);
    terrain.showState = 'hidden';
    terrain.create(mapWidth, mapHeight, heightsF32, new Vector3(1, 100, 1), 33, {
      splatMap,
      detailMaps: {
        albedoTextures: [detailAlbedo0, detailAlbedo1, detailAlbedo2],
        normalTextures: [detailNormal0, detailNormal1, detailNormal2],
        uvScale: [120, 120, 120],
        normalScale: [2, 5, 0.5],
        metallic: [0, 0, 0],
        roughness: [0.95, 0.9, 0.7],
        grass: [
          [
            {
              bladeWidth: 2,
              bladeHeigh: 2,
              density: 1.2,
              offset: -0.1,
              texture: grassMap1
            },
            {
              bladeWidth: 2,
              bladeHeigh: 3,
              density: 0.06,
              offset: -0.02,
              texture: grassMap2
            }
          ],
          [
            {
              bladeWidth: 2,
              bladeHeigh: 2,
              density: 0.6,
              offset: 0,
              texture: grassMap3
            }
          ]
        ]
      }
    });
    terrain.maxPixelError = 6;
    terrain.castShadow = true;
    terrain.pickable = true;

    // Distribute some trees
    const numTrees = 500;
    const PY = Vector3.axisPY();
    const trees = [
      {
        url: 'https://cdn.zephyr3d.org/doc/assets/models/stylized_tree.glb',
        scale: 1.5
      }
    ];
    const f = 1 / trees.length;
    const seed = 0;
    const prng = new PRNG(seed);
    for (let i = 0; i < numTrees; i++) {
      const x = prng.get() * terrain.scaledWidth;
      const z = prng.get() * terrain.scaledHeight;
      const y = terrain.getElevation(x, z);
      const index = Math.min(Math.floor(prng.get() / f), trees.length - 1);
      const tree = await assetManager.fetchModel(scene, trees[index].url, {
        postProcess: this.replaceMaterials,
        enableInstancing: true
      });
      tree.group.parent = terrain;
      tree.group.pickable = false;
      tree.group.position.setXYZ(x, y, z);
      tree.group.scale.setXYZ(trees[index].scale, trees[index].scale, trees[index].scale);
      tree.group.rotation = Quaternion.fromAxisAngle(PY, prng.get() * 2 * Math.PI);
    }

    return terrain;
  }
  replaceMaterials(model: SharedModel): SharedModel {
    function recusivelyReplaceMaterial(node: AssetHierarchyNode) {
      if (node.mesh) {
        for (const subMesh of node.mesh.subMeshes) {
          const material = subMesh.material.get() as MeshMaterial;
          const needChange = material.blendMode === 'blend' || material.alphaCutoff > 0;
          if (material instanceof PBRMetallicRoughnessMaterial && material.albedoTexture && needChange) {
            const newMaterial = new TreeMaterialMetallicRoughness();
            newMaterial.textureWidth = material.albedoTexture.width;
            newMaterial.textureHeight = material.albedoTexture.height;
            newMaterial.blendMode = 'none';
            newMaterial.alphaCutoff = 0.8;
            newMaterial.cullMode = 'none';
            newMaterial.ior = material.ior;
            newMaterial.specularFactor = material.specularFactor;
            newMaterial.albedoColor = material.albedoColor;
            newMaterial.albedoTexCoordIndex = material.albedoTexCoordIndex;
            newMaterial.albedoTexCoordMatrix = material.albedoTexCoordMatrix;
            newMaterial.albedoTexture = material.albedoTexture;
            newMaterial.albedoTextureSampler = material.albedoTextureSampler;
            newMaterial.normalTexture = material.normalTexture;
            newMaterial.normalTexCoordIndex = material.normalTexCoordIndex;
            newMaterial.normalTexCoordMatrix = material.normalTexCoordMatrix;
            newMaterial.normalTextureSampler = material.normalTextureSampler;
            newMaterial.normalScale = material.normalScale;
            newMaterial.occlusionTexture = material.occlusionTexture;
            newMaterial.occlusionTexCoordIndex = material.occlusionTexCoordIndex;
            newMaterial.occlusionTexCoordMatrix = material.occlusionTexCoordMatrix;
            newMaterial.occlusionTextureSampler = material.occlusionTextureSampler;
            newMaterial.metallicRoughnessTexture = material.metallicRoughnessTexture;
            newMaterial.metallicRoughnessTexCoordIndex = material.metallicRoughnessTexCoordIndex;
            newMaterial.metallicRoughnessTexCoordMatrix = material.metallicRoughnessTexCoordMatrix;
            newMaterial.metallicRoughnessTextureSampler = material.metallicRoughnessTextureSampler;
            newMaterial.specularTexture = material.specularTexture;
            newMaterial.specularTexCoordIndex = material.specularTexCoordIndex;
            newMaterial.specularTexCoordMatrix = material.specularTexCoordMatrix;
            newMaterial.specularTextureSampler = material.specularTextureSampler;
            newMaterial.specularColorTexture = material.specularColorTexture;
            newMaterial.specularColorTexCoordIndex = material.specularColorTexCoordIndex;
            newMaterial.specularColorTexCoordMatrix = material.specularColorTexCoordMatrix;
            newMaterial.specularColorTextureSampler = material.specularColorTextureSampler;
            newMaterial.metallic = 0;
            newMaterial.roughness = 1;
            subMesh.material.set(newMaterial);
          } else if (
            material instanceof PBRSpecularGlossinessMaterial &&
            material.albedoTexture &&
            needChange
          ) {
            const newMaterial = new TreeMaterialMetallicRoughness();
            newMaterial.textureWidth = material.albedoTexture.width;
            newMaterial.textureHeight = material.albedoTexture.height;
            newMaterial.blendMode = 'none';
            newMaterial.alphaCutoff = 0.8;
            newMaterial.cullMode = 'none';
            newMaterial.ior = material.ior;
            newMaterial.albedoColor = material.albedoColor;
            newMaterial.albedoTexCoordIndex = material.albedoTexCoordIndex;
            newMaterial.albedoTexCoordMatrix = material.albedoTexCoordMatrix;
            newMaterial.albedoTexture = material.albedoTexture;
            newMaterial.albedoTextureSampler = material.albedoTextureSampler;
            newMaterial.normalTexture = material.normalTexture;
            newMaterial.normalTexCoordIndex = material.normalTexCoordIndex;
            newMaterial.normalTexCoordMatrix = material.normalTexCoordMatrix;
            newMaterial.normalTextureSampler = material.normalTextureSampler;
            newMaterial.normalScale = material.normalScale;
            newMaterial.occlusionTexture = material.occlusionTexture;
            newMaterial.occlusionTexCoordIndex = material.occlusionTexCoordIndex;
            newMaterial.occlusionTexCoordMatrix = material.occlusionTexCoordMatrix;
            newMaterial.occlusionTextureSampler = material.occlusionTextureSampler;
            newMaterial.specularTexture = material.specularTexture;
            newMaterial.specularTexCoordIndex = material.specularTexCoordIndex;
            newMaterial.specularTexCoordMatrix = material.specularTexCoordMatrix;
            newMaterial.specularTextureSampler = material.specularTextureSampler;
            newMaterial.metallic = 0;
            newMaterial.roughness = 1;
            subMesh.material.set(newMaterial);
          }
        }
      }
      for (const child of node.children) {
        recusivelyReplaceMaterial(child);
      }
    }
    for (const node of model.nodes) {
      recusivelyReplaceMaterial(node);
    }
    return model;
  }
  handlePointerUp(button: number, x: number, y: number) {
    if (!this._loaded) {
      return;
    }
    const ray = this._camera.constructRay(x, y);
    const obj = this._scene.raycast(ray, this._camera.getFarPlane());
    if (obj && obj.target.node.isTerrain()) {
      this._terrain.invWorldMatrix.transformPointAffine(obj.point, this._actorTarget);
      if (button === 2) {
        this._actorDirection.set(
          Vector3.mul(
            Vector3.sub(this._actorTarget, this._character.group.position),
            new Vector3(1, 0, 1)
          ).inplaceNormalize()
        );
        this._character.group.rotation = Quaternion.unitVectorToUnitVector(
          this._axisPZ,
          this._actorDirection
        );
        this.run();
        this._actorRunning = true;
      }
    }
  }
  updateCharacter() {
    if (this._loaded && this._actorRunning) {
      const distance = Vector3.distance(
        Vector3.mul(this._character.group.position, new Vector3(1, 0, 1)),
        Vector3.mul(this._actorTarget, new Vector3(1, 0, 1))
      );
      let movement = (getDevice().frameInfo.elapsedFrame * this._actorSpeed) / 1000;
      if (movement >= distance) {
        this._actorRunning = false;
        movement = distance;
        this.idle();
      }
      const newPos = Vector3.add(
        this._character.group.position,
        Vector3.scale(this._actorDirection, movement)
      );
      newPos.y = this._terrain.getElevation(newPos.x, newPos.z);
      this._character.group.position.set(newPos);
      (this._camera.controller as OrbitCameraController).center = newPos;
    }
  }
  updateCamera() {
    this._camera.updateController();
    const height = this._terrain.getElevation(this._camera.position.x, this._camera.position.z);
    if (this._camera.position.y < height + 2) {
      this._camera.position.y = height + 2;
    }
  }
  render() {
    if (this._loaded) {
      this.updateCharacter();
      this.updateCamera();
    }
    this._camera.render(this._scene);
    if (!this._loaded) {
      getDevice().drawText(`Loading: %${this._loadPercent}`, 20, 20, '#a00000');
    } else {
      if (!this._ui) {
        this._ui = new Panel();
      }
    }
  }
  toggleInspector() {
    this._showInspector = !this._showInspector;
  }
  toggleGUI() {
    if (this._ui) {
      this._ui.toggle();
    }
  }
}
