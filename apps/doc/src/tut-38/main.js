import { backendWebGL2 } from '@zephyr3d/backend-webgl';
import { Vector3, Vector4 } from '@zephyr3d/base';
import {
  Scene,
  FPSCameraController,
  DirectionalLight,
  AssetManager,
  Application,
  PerspectiveCamera,
  Terrain,
  getInput
} from '@zephyr3d/scene';

const myApp = new Application({
  backend: backendWebGL2,
  canvas: document.querySelector('#my-canvas')
});

myApp.ready().then(async () => {
  async function loadTerrain(scene, assetManager) {
    const mapWidth = 513;
    const mapHeight = 513;
    const heightMap = await assetManager.fetchBinaryData('assets/maps/map2/heightmap.raw');
    const heightsInt16 = new Uint16Array(heightMap);
    const heightsF32 = new Float32Array(mapWidth * mapHeight);
    for (let i = 0; i < mapWidth * mapHeight; i++) {
      heightsF32[i] = heightsInt16[i] / 65535;
    }
    const splatMap = await assetManager.fetchTexture('./assets/maps/map2/splatmap.tga', {
      linearColorSpace: true
    });
    const detailAlbedo0 = await assetManager.fetchTexture('./assets/maps/map2/stone_color.png', {
      linearColorSpace: false
    });
    const detailNormal0 = await assetManager.fetchTexture('./assets/maps/map2/stone_norm.png', {
      linearColorSpace: true
    });
    const detailAlbedo1 = await assetManager.fetchTexture('./assets/maps/map2/grass_color.png', {
      linearColorSpace: false
    });
    const detailNormal1 = await assetManager.fetchTexture('./assets/maps/map2/grass_norm.png', {
      linearColorSpace: true
    });
    const detailAlbedo2 = await assetManager.fetchTexture('./assets/maps/map2/174.jpg', {
      linearColorSpace: false
    });
    const detailNormal2 = await assetManager.fetchTexture('./assets/maps/map2/174_norm.jpg', {
      linearColorSpace: true
    });
    const terrain = new Terrain(scene);
    terrain.create(mapWidth, mapHeight, heightsF32, new Vector3(1, 100, 1), 33, {
      splatMap,
      detailMaps: {
        albedoTextures: [detailAlbedo0, detailAlbedo1, detailAlbedo2],
        normalTextures: [detailNormal0, detailNormal1, detailNormal2],
        uvScale: [30, 30, 30],
        normalScale: [2, 5, 0.5],
        metallic: [0, 0, 0],
        roughness: [0.95, 0.9, 0.7]
      }
    });
    terrain.castShadow = true;
    return terrain;
  }

  const scene = new Scene();
  scene.env.light.strength = 0.1;

  const camera = new PerspectiveCamera(scene, Math.PI / 3, 1, 500);
  camera.controller = new FPSCameraController({ moveSpeed: 0.5 });
  camera.lookAt(new Vector3(200, 40, 80), new Vector3(250, 0, 250), Vector3.axisPY());
  getInput().use(camera.handleEvent.bind(camera));

  const light = new DirectionalLight(scene).setColor(new Vector4(1, 1, 1, 1)).setCastShadow(false);
  light.lookAt(new Vector3(1, 1, 1), new Vector3(0, 0, 0), Vector3.axisPY());
  light.shadow.shadowMapSize = 2048;
  light.shadow.numShadowCascades = 4;
  light.castShadow = true;
  light.shadow.mode = 'pcf-opt';

  camera.FXAA = true;

  scene.env.light.type = 'ibl';
  scene.env.light.strength = 0.35;
  scene.env.light.radianceMap = scene.env.sky.radianceMap;
  scene.env.sky.skyType = 'scatter';

  const assetManager = new AssetManager();
  loadTerrain(scene, assetManager);

  myApp.on('resize', (width, height) => {
    camera.aspect = width / height;
  });

  myApp.on('tick', () => {
    camera.updateController();
    camera.render(scene);
  });

  myApp.run();
});
