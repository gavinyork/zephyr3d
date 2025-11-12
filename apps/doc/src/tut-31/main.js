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
  getInput,
  getEngine
} from '@zephyr3d/scene';

const myApp = new Application({
  backend: backendWebGL2,
  canvas: document.querySelector('#my-canvas')
});

myApp.ready().then(async () => {
  // Load terrain
  async function loadTerrain(scene) {
    const assetManager = new AssetManager();
    // Terrain resolution
    const mapWidth = 257;
    const mapHeight = 257;
    // Load heights
    const heightMap = await assetManager.fetchBinaryData(
      'https://cdn.zephyr3d.org/doc/assets/maps/map1/heightmap.raw'
    );
    const heightsInt16 = new Uint16Array(heightMap);
    const heightsF32 = new Float32Array(mapWidth * mapHeight);
    // Converts 16-bit integer height values to floating-point numbers in the range of 0 to 1
    for (let i = 0; i < mapWidth * mapHeight; i++) {
      heightsF32[i] = heightsInt16[i] / 65535;
    }
    // Splat map
    /** @type {import('@zephyr3d/device').Texture2D} */
    const splatMap = await assetManager.fetchTexture(
      'https://cdn.zephyr3d.org/doc/assets/maps/map1/splatmap.tga',
      {
        linearColorSpace: true
      }
    );
    // Detail Texture 1, the weights correspond to the R channel of the splat map
    /** @type {import('@zephyr3d/device').Texture2D} */
    const detailAlbedo0 = await assetManager.fetchTexture(
      'https://cdn.zephyr3d.org/doc/assets/maps/map1/detail1.jpg',
      {
        linearColorSpace: false
      }
    );
    /** @type {import('@zephyr3d/device').Texture2D} */
    const detailNormal0 = await assetManager.fetchTexture(
      'https://cdn.zephyr3d.org/doc/assets/maps/map1/detail1_norm.jpg',
      {
        linearColorSpace: true
      }
    );
    // Detail Texture 2, the weights correspond to the G channel of the splat map
    /** @type {import('@zephyr3d/device').Texture2D} */
    const detailAlbedo1 = await assetManager.fetchTexture(
      'https://cdn.zephyr3d.org/doc/assets/maps/map1/detail2.jpg',
      {
        linearColorSpace: false
      }
    );
    /** @type {import('@zephyr3d/device').Texture2D} */
    const detailNormal1 = await assetManager.fetchTexture(
      'https://cdn.zephyr3d.org/doc/assets/maps/map1/detail2_norm.jpg',
      {
        linearColorSpace: true
      }
    );
    // Detail Texture 3, the weights correspond to the B channel of the splat map
    /** @type {import('@zephyr3d/device').Texture2D} */
    const detailAlbedo2 = await assetManager.fetchTexture(
      'https://cdn.zephyr3d.org/doc/assets/maps/map1/detail3.jpg',
      {
        linearColorSpace: false
      }
    );
    /** @type {import('@zephyr3d/device').Texture2D} */
    const detailNormal2 = await assetManager.fetchTexture(
      'https://cdn.zephyr3d.org/doc/assets/maps/map1/detail3_norm.jpg',
      {
        linearColorSpace: true
      }
    );
    // Grass blade textures
    /** @type {import('@zephyr3d/device').Texture2D} */
    const grass1 = await assetManager.fetchTexture('https://cdn.zephyr3d.org/doc/assets/images/grass1.dds');
    /** @type {import('@zephyr3d/device').Texture2D} */
    const grass2 = await assetManager.fetchTexture('https://cdn.zephyr3d.org/doc/assets/images/grass2.dds');
    // Create and initialize the terrain
    const terrain = new Terrain(scene);
    terrain.create(mapWidth, mapHeight, heightsF32, new Vector3(1, 62, 1), 33, {
      splatMap,
      detailMaps: {
        albedoTextures: [detailAlbedo0, detailAlbedo1, detailAlbedo2],
        normalTextures: [detailNormal0, detailNormal1, detailNormal2],
        uvScale: [30, 30, 30],
        normalScale: [20, 5, 0.5],
        metallic: [0, 0, 0],
        roughness: [0.95, 0.9, 0.7],
        grass: [
          [
            {
              bladeWidth: 2,
              bladeHeigh: 2,
              density: 1.5,
              offset: -0.1,
              texture: grass1
            },
            {
              bladeWidth: 2,
              bladeHeigh: 3,
              density: 0.1,
              offset: -0.02,
              texture: grass2
            }
          ]
        ]
      }
    });
    // Enable shadow
    terrain.castShadow = true;
    return terrain;
  }

  const scene = new Scene();
  scene.mainCamera = new PerspectiveCamera(scene, Math.PI / 3, 1, 500);
  scene.mainCamera.controller = new FPSCameraController({ moveSpeed: 0.5 });
  getInput().use(scene.mainCamera.handleEvent, scene.mainCamera);

  // Directional light，4 Cascade levels
  const light = new DirectionalLight(scene).setColor(new Vector4(1, 1, 1, 1)).setCastShadow(false);
  light.lookAt(new Vector3(1, 1, 1), new Vector3(0, 0, 0), Vector3.axisPY());
  light.shadow.shadowMapSize = 2048;
  light.shadow.numShadowCascades = 4;
  light.castShadow = true;
  light.shadow.mode = 'pcf-opt';

  scene.mainCamera.SSAO = true;
  scene.mainCamera.FXAA = true;

  // Environment lighting and fogging
  scene.env.light.type = 'ibl';
  scene.env.light.strength = 0.1;
  scene.env.light.radianceMap = scene.env.sky.radianceMap;
  scene.env.light.irradianceMap = scene.env.sky.irradianceMap;

  // Load terrain
  const terrain = await loadTerrain(scene);

  // Sets the Terrain as the camera's parent node
  scene.mainCamera.parent = terrain;

  scene.mainCamera.lookAt(new Vector3(223, 10, 10), new Vector3(222, 10, 15), Vector3.axisPY());

  getEngine().setRenderable(scene, 0, {
    beforeRender(scene) {
      const camera = scene.mainCamera;
      if (
        camera.position.x > 0 &&
        camera.position.x < terrain.scaledWidth &&
        camera.position.z > 0 &&
        camera.position.z < terrain.scaledHeight
      ) {
        // retreive height for current position
        const height = terrain.getElevation(camera.position.x, camera.position.z);
        // Fix camera position
        if (camera.position.y < height + 3) {
          camera.position.y = height + 3;
        }
      }
    }
  });

  myApp.run();
});
