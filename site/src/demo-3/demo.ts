import { Quaternion, Vector3, Vector4 } from '@zephyr3d/base';
import { Texture2D } from '@zephyr3d/device';
import { Application, AssetHierarchyNode, AssetManager, Compositor, DirectionalLight, FXAA, GraphNode, MeshMaterial, ModelInfo, OrbitCameraController, PBRMetallicRoughnessMaterial, PBRSpecularGlossinessMaterial, PerspectiveCamera, Scene, SceneNode, SharedModel, Terrain, Tonemap } from '@zephyr3d/scene';
import * as zip from '@zip.js/zip.js';
import { TreeMaterialMetallicRoughness, TreeMaterialSpecularGlossiness } from './treematerial';

export class Demo {
  private _assetManager: AssetManager;
  private _scene: Scene;
  private _terrain: Terrain;
  private _camera: PerspectiveCamera;
  private _character: ModelInfo;
  private _compositor: Compositor;
  private _axisPZ: Vector3;
  private _actorTarget: Vector3;
  private _actorDirection: Vector3;
  private _actorSpeed: number;
  private _actorRunning: boolean;
  constructor(){
    this._assetManager = null;
    this._scene = null;
    this._terrain = null;
    this._camera = null;
    this._compositor = null;
    this._axisPZ = Vector3.axisPZ();
    this._actorTarget = new Vector3();
    this._actorDirection = new Vector3();
    this._actorSpeed = 6;
    this._actorRunning = false;
  }
  private async readZip(url: string): Promise<Map<string, string>> {
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
  get camera() {
    return this._camera;
  }
  createScene(): Scene {
    const scene = new Scene();
    scene.worldUnit = 60;
    scene.env.light.type = 'ibl';
    scene.env.light.strength = 1;
    scene.env.light.radianceMap = scene.env.sky.radianceMap;
    scene.env.light.irradianceMap = scene.env.sky.irradianceMap;
    scene.env.sky.skyType = 'scatter';
    scene.env.sky.fogType = 'scatter';

    const light = new DirectionalLight(scene).setColor(new Vector4(1, 1, 1, 1));
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
    const camera = new PerspectiveCamera(
      scene,
      Math.PI / 3,
      Application.instance.device.getDrawingBufferWidth() / Application.instance.device.getDrawingBufferHeight(),
      1,
      1500
    );
    camera.controller = new OrbitCameraController();
    return camera;
  }
  async load() {
    // load world
    this._assetManager = new AssetManager();
    this._scene = this.createScene();
    this._terrain = await this.loadTerrain(this._scene, this._assetManager);
    this._camera = this.createCamera(this._scene);
    this._character = await this.loadCharacter(this._scene, this._assetManager);
    this._compositor = new Compositor();
    this._compositor.appendPostEffect(new Tonemap());
    this._compositor.appendPostEffect(new FXAA());
    // initialize
    this._camera.parent = this._terrain;
    this._character.group.parent = this._terrain;
    const x = this._terrain.scaledWidth * 0.5;
    const z = this._terrain.scaledHeight * 0.5;
    const y = this._terrain.getElevation(x, z);
    this._character.group.position.setXYZ(x, y, z);
    this._character.animationSet.playAnimation('idle01_yindao', 0);
    const eyePos = new Vector3(x + 10, y + 10, z + 10);
    const destPos = new Vector3(x, y, z);
    this._camera.lookAt(eyePos, destPos, Vector3.axisPY());
    (this._camera.controller as OrbitCameraController).setOptions({ center: destPos });
  }
  async loadModelIndirect(fileMap: Map<string, string>, modelFile: string, scene: Scene, assetManager: AssetManager) {
    const urlResolver = assetManager.httpRequest.urlResolver;
    assetManager.httpRequest.urlResolver = url => fileMap.get(url) || url;
    const modelInfo = await this._assetManager.fetchModel(scene, modelFile);
    assetManager.httpRequest.urlResolver = urlResolver;
    return modelInfo;
  }
  async loadModelFromZip(zipUrl: string, scene: Scene, assetManager: AssetManager) {
    const fileMap = await this.readZip(zipUrl);
    const keys = Array.from(fileMap.keys());
    const modelFile = keys.find((val) => /(\.gltf|\.glb)$/i.test(val));
    for (const key of keys) {
      fileMap.set(zipUrl + key, fileMap.get(key));
    }
    return await this.loadModelIndirect(fileMap, zipUrl + modelFile, scene, assetManager);
  }
  async loadCharacter(scene: Scene, assetManager: AssetManager) {
    const character = await this.loadModelFromZip('assets/models/alice_shellfire.zip', scene, assetManager);
    character.group.scale.setXYZ(2, 2, 2);
    return character;
  }
  async loadTerrain(scene: Scene, assetManager: AssetManager) {
    const mapWidth = 1025;
    const mapHeight = 1025;
    const heightMap = await assetManager.fetchBinaryData('assets/maps/map3/heightmap.raw');
    const heightsInt16 = new Uint16Array(heightMap);
    const heightsF32 = new Float32Array(mapWidth * mapHeight);
    for (let i = 0; i < mapWidth * mapHeight; i++) {
      heightsF32[i] = heightsInt16[i] / 65535;
    }
    const grassMap1 = await assetManager.fetchTexture<Texture2D>('./assets/maps/map3/857caeb1.dds');
    const grassMap2 = await assetManager.fetchTexture<Texture2D>('./assets/maps/map3/grass1x.dds');
    const grassMap3 = await assetManager.fetchTexture<Texture2D>('./assets/maps/map3/gj02.dds');
    const splatMap = await assetManager.fetchTexture<Texture2D>('./assets/maps/map3/splatmap.tga', {
      linearColorSpace: true
    });
    const detailAlbedo0 = await assetManager.fetchTexture<Texture2D>('./assets/maps/map3/grass_color.png', {
      linearColorSpace: false
    });
    const detailNormal0 = await assetManager.fetchTexture<Texture2D>('./assets/maps/map3/grass_norm.png', {
      linearColorSpace: true
    });
    const detailAlbedo1 = await assetManager.fetchTexture<Texture2D>('./assets/maps/map3/28.png', {
      linearColorSpace: false
    });
    const detailNormal1 = await assetManager.fetchTexture<Texture2D>('./assets/maps/map3/29.png', {
      linearColorSpace: true
    });
    const detailAlbedo2 = await assetManager.fetchTexture<Texture2D>('./assets/maps/map3/174.jpg', {
      linearColorSpace: false
    });
    const detailNormal2 = await assetManager.fetchTexture<Texture2D>('./assets/maps/map3/174_norm.jpg', {
      linearColorSpace: true
    });
    const terrain = new Terrain(scene);
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
    terrain.pickMode = GraphNode.PICK_ENABLED;

    // Distribute some trees
    const PY = Vector3.axisPY();
    const trees = [{
      url: 'assets/models/stylized_tree.glb',
      scale: 1.5
    }];
    const f = 1 / trees.length;
    for (let i = 0; i < 500; i++) {
      const x = Math.random() * terrain.scaledWidth;
      const z = Math.random() * terrain.scaledHeight;
      const y = terrain.getElevation(x, z);
      const index = Math.min(Math.floor(Math.random() / f), trees.length - 1);
      const tree = await assetManager.fetchModel(scene, trees[index].url, null, this.replaceMaterials);
      tree.group.parent = terrain;
      tree.group.pickMode = SceneNode.PICK_DISABLED;
      tree.group.position.setXYZ(x, y, z);
      tree.group.scale.setXYZ(trees[index].scale, trees[index].scale, trees[index].scale);
      tree.group.rotation = Quaternion.fromAxisAngle(PY, Math.random() * 2 * Math.PI);
    }

    return terrain;
  }
  replaceMaterials(model: SharedModel): SharedModel {
    function recusivelyReplaceMaterial(node: AssetHierarchyNode) {
      if (node.mesh) {
        for (const subMesh of node.mesh.subMeshes) {
          const material = subMesh.material as MeshMaterial;
          const needChange = material.blendMode === 'blend' || material.alphaCutoff > 0;
          if (material instanceof PBRMetallicRoughnessMaterial && material.albedoTexture && needChange) {
            const newMaterial = new TreeMaterialMetallicRoughness();
            newMaterial.textureWidth = material.albedoTexture.width;
            newMaterial.textureHeight = material.albedoTexture.height;
            newMaterial.blendMode = 'none';
            newMaterial.alphaCutoff = 0.8;
            newMaterial.stateSet.useRasterizerState().setCullMode('none');
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
            subMesh.material = newMaterial;
          } else if (material instanceof PBRSpecularGlossinessMaterial && material.albedoTexture && needChange) {
            const newMaterial = new TreeMaterialMetallicRoughness();
            newMaterial.textureWidth = material.albedoTexture.width;
            newMaterial.textureHeight = material.albedoTexture.height;
            newMaterial.blendMode = 'none';
            newMaterial.alphaCutoff = 0.8;
            newMaterial.stateSet.useRasterizerState().setCullMode('none');
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
            newMaterial.specularTexture = material.specularTexture;
            newMaterial.specularTexCoordIndex = material.specularTexCoordIndex;
            newMaterial.specularTexCoordMatrix = material.specularTexCoordMatrix;
            newMaterial.specularTextureSampler = material.specularTextureSampler;
            newMaterial.metallic = 0;
            newMaterial.roughness = 1;
            subMesh.material = newMaterial;
          }
        }
      }
      for (const child of node.children) {
        recusivelyReplaceMaterial(child);
      }
    }
    for(const node of model.nodes) {
      recusivelyReplaceMaterial(node);
    }
    return model;
  }
  handlePointerUp(button: number, x: number, y: number) {
    const obj = this._scene.raycast(this._camera, x, y);
    if (obj && obj.node.isTerrain()) {
      this._terrain.invWorldMatrix.transformPointAffine(obj.point, this._actorTarget);
      if (button === 2) {
        this._actorDirection.set(
          Vector3.mul(Vector3.sub(this._actorTarget, this._character.group.position), new Vector3(1, 0, 1)).inplaceNormalize()
        );
        this._character.group.rotation = Quaternion.unitVectorToUnitVector(this._axisPZ, this._actorDirection);
        this._character.animationSet.playAnimation('run_front', 0);
        this._actorRunning = true;
      }
    }
  }
  updateCharacter() {
    if (this._actorRunning) {
      const distance = Vector3.distance(
        Vector3.mul(this._character.group.position, new Vector3(1, 0, 1)),
        Vector3.mul(this._actorTarget, new Vector3(1, 0, 1))
      );
      let movement = (Application.instance.device.frameInfo.elapsedFrame * this._actorSpeed) / 1000;
      if (movement >= distance) {
        this._actorRunning = false;
        movement = distance;
        this._character.animationSet.playAnimation('idle01_yindao', 0);
      }
      const newPos = Vector3.add(this._character.group.position, Vector3.scale(this._actorDirection, movement));
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
    this.updateCharacter();
    this.updateCamera();
    this._camera.render(this._scene, this._compositor);
  }
}
