import { Vector3, Vector4 } from '@zephyr3d/base';
import {
  Scene,
  FPSCameraController,
  DirectionalLight,
  AssetManager,
  Application,
  Tonemap,
  GraphNode,
  PerspectiveCamera,
  Compositor,
  FXAA,
  Terrain
} from '@zephyr3d/scene';
import * as common from '../common';
import { imGuiEndFrame, imGuiInit, imGuiInjectEvent, imGuiNewFrame } from '@zephyr3d/imgui';
import type { Texture2D } from '@zephyr3d/device';

const terrainApp = new Application({
  backend: common.getBackend(),
  canvas: document.querySelector('#canvas'),
  enableMSAA: false
});

terrainApp.ready().then(async () => {
  async function loadTerrain(scene: Scene, assetManager: AssetManager) {
    const mapWidth = 1025;
    const mapHeight = 1025;
    const heightMap = await assetManager.fetchBinaryData('assets/maps/map4/heightmap.raw');
    const heightsInt16 = new Uint16Array(heightMap);
    const heightsF32 = new Float32Array(mapWidth * mapHeight);
    for (let i = 0; i < mapWidth * mapHeight; i++) {
      heightsF32[i] = heightsInt16[i] / 65535;
    }
    const grassMap1 = await assetManager.fetchTexture<Texture2D>('./assets/images/857caeb1.dds');
    const grassMap2 = await assetManager.fetchTexture<Texture2D>('./assets/images/grass1x.dds');
    const grassMap3 = await assetManager.fetchTexture<Texture2D>('./assets/images/gj02.dds');
    const albedoMap = await assetManager.fetchTexture<Texture2D>('./assets/maps/map4/colormap.png', {
      linearColorSpace: false
    });
    const splatMap = await assetManager.fetchTexture<Texture2D>('./assets/maps/map4/splatmap.tga', {
      linearColorSpace: true
    });
    const detailAlbedo0 = await assetManager.fetchTexture<Texture2D>('./assets/maps/map5/grass_color.png', {
      linearColorSpace: false
    });
    const detailNormal0 = await assetManager.fetchTexture<Texture2D>('./assets/maps/map5/grass_norm.png', {
      linearColorSpace: true
    });
    const detailAlbedo1 = await assetManager.fetchTexture<Texture2D>('./assets/maps/map5/28.png', {
      linearColorSpace: false
    });
    const detailNormal1 = await assetManager.fetchTexture<Texture2D>('./assets/maps/map5/29.png', {
      linearColorSpace: true
    });
    const detailAlbedo2 = await assetManager.fetchTexture<Texture2D>('./assets/maps/map5/174.jpg', {
      linearColorSpace: false
    });
    const detailNormal2 = await assetManager.fetchTexture<Texture2D>('./assets/maps/map5/174_norm.jpg', {
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
    terrain.material.albedoTexture = albedoMap;
    //terrain.material.lightModel.setNormalMap(normalMap, null, -1);
    terrain.maxPixelError = 6;
    terrain.castShadow = true;
    /*
    const detailMask = splatMap;
    const data = new Uint8Array(detailMask.width * detailMask.height * 4);
    await detailMask.readPixels(0, 0, detailMask.width, detailMask.height, 0, 0, data);
    const density = [] as number[][];
    for (let i = 0; i < detailMask.height; i++) {
      const row = [] as number[];
      for (let j = 0; j < detailMask.width; j++) {
        const val = data[i * 4 * detailMask.width + j * 4] / 255;
        //row.push(val > 0.8 ? Math.random() * 0.5 * val : 0);
        row.push(Math.random() * 0.3);
        //row.push(val > 0.8 ? 1 : 0);
      }
      density.push(row);
    }
    terrain.createGrass(density, 4, 2, -0.3, grassMap1);
    //terrain.createGrass(density, 3, 6, 0, grassMap2);
    */
    return terrain;
  }

  const device = terrainApp.device;
  device.canvas.addEventListener('contextmenu', function (ev) {
    ev.preventDefault();
    return false;
  });
  const scene = new Scene();
  scene.worldUnit = 60;
  scene.env.light.strength = 0.1;
  await imGuiInit(device);
  const camera = new PerspectiveCamera(
    scene,
    Math.PI / 3,
    device.getDrawingBufferWidth() / device.getDrawingBufferHeight(),
    1,
    500
  );
  camera.controller = new FPSCameraController({ moveSpeed: 0.5 });
  camera.sampleCount = 1;
  terrainApp.inputManager.use(imGuiInjectEvent);
  terrainApp.inputManager.use(camera.handleEvent.bind(camera));

  const light = new DirectionalLight(scene).setColor(new Vector4(1, 1, 1, 1)).setCastShadow(false);
  light.lookAt(new Vector3(1, 1, 1), new Vector3(0, 0, 0), Vector3.axisPY());
  light.intensity = 4;
  light.shadow.shadowMapSize = 2048;
  light.shadow.numShadowCascades = 4;
  light.castShadow = true;
  light.shadow.mode = 'pcf-opt';

  const compositor = new Compositor();
  compositor.appendPostEffect(new Tonemap());
  //compositor.appendPostEffect(new PostWater(30));
  compositor.appendPostEffect(new FXAA());
  scene.env.light.type = 'ibl';
  scene.env.light.strength = 0.35;
  scene.env.light.radianceMap = scene.env.sky.radianceMap;
  scene.env.light.irradianceMap = scene.env.sky.irradianceMap;
  scene.env.sky.skyType = 'scatter';
  scene.env.sky.autoUpdateIBLMaps = true;
  scene.env.sky.fogType = 'none';

  const assetManager = new AssetManager();
  const terrain = await loadTerrain(scene, assetManager);
  terrain.pickMode = GraphNode.PICK_ENABLED;
  camera.parent = terrain;

  const actor = await assetManager.fetchModel(scene, './assets/models/character/scene.gltf');
  actor.group.reparent(terrain);
  const x = terrain.scaledWidth * 0.5;
  const z = terrain.scaledHeight * 0.5;
  const y = terrain.getElevation(x, z);
  actor.group.position.setXYZ(x, y, z);
  actor.animationSet.playAnimation('Idle', 0);
  const actorTarget = new Vector3();
  const actorDirection = new Vector3();
  const actorSpeed = 6;
  let actorRunning = false;
  const eyePos = new Vector3(x + 10, y + 10, z + 10);
  const destPos = new Vector3(x, y, z);
  camera.lookAt(eyePos, destPos, Vector3.axisPY());

  const inspector = new common.Inspector(scene, compositor, camera);

  terrainApp.on('pointerup', (ev) => {
    const obj = scene.raycast(camera, ev.offsetX, ev.offsetY);
    if (obj && obj.node.isTerrain()) {
      terrain.invWorldMatrix.transformPointAffine(obj.point, actorTarget);
      if (ev.button === 2) {
        actorDirection.set(
          Vector3.mul(Vector3.sub(actorTarget, actor.group.position), new Vector3(1, 0, 1)).inplaceNormalize()
        );
        actor.group.lookAt(
          actor.group.position,
          Vector3.sub(actor.group.position, actorDirection),
          Vector3.axisPY()
        );
        actor.animationSet.playAnimation('Run', 0);
        actorRunning = true;
      }
    }
  });
  terrainApp.on('keyup', (ev) => {
    if (ev.code === 'KeyU') {
      terrain.wireframe = !terrain.wireframe;
    } else if (ev.code === 'KeyM') {
      if (camera.sampleCount === 1) {
        camera.sampleCount = 4;
      } else {
        camera.sampleCount = 1;
      }
    }
  });
  let movingSun = 0;
  Application.instance.device.canvas.addEventListener('contextmenu', function (ev) {
    ev.preventDefault();
    return false;
  });
  terrainApp.on('pointerdown', (ev) => {
    if (ev.button === 2 && ev.ctrlKey) {
      const viewport = Application.instance.device.getViewport();
      const ray = scene.constructRay(camera, viewport.width, viewport.height, ev.offsetX, ev.offsetY);
      light.lookAt(ray.direction, Vector3.zero(), Vector3.axisPY());
      movingSun = 1;
    }
  });
  terrainApp.on('pointerup', (ev) => {
    if (ev.button === 2) {
      movingSun = 0;
    }
  });
  terrainApp.on('pointermove', (ev) => {
    //const obj = scene.raycast(gltfViewer.camera, ev.offsetX, ev.offsetY);
    //console.log(`raycast: ${obj ? obj.node.constructor.name : null}`);
    if (movingSun) {
      const viewport = Application.instance.device.getViewport();
      const ray = scene.constructRay(camera, viewport.width, viewport.height, ev.offsetX, ev.offsetY);
      light.lookAt(ray.direction, Vector3.zero(), Vector3.axisPY());
    }
  });
  terrainApp.on('resize', (ev) => {
    camera.aspect = ev.width / ev.height;
  });
  terrainApp.on('tick', (ev) => {
    if (actorRunning) {
      const distance = Vector3.distance(
        Vector3.mul(actor.group.position, new Vector3(1, 0, 1)),
        Vector3.mul(actorTarget, new Vector3(1, 0, 1))
      );
      let movement = (device.frameInfo.elapsedFrame * actorSpeed) / 1000;
      if (movement >= distance) {
        actorRunning = false;
        movement = distance;
        actor.animationSet.playAnimation('Idle', 0);
      }
      const newPos = Vector3.add(actor.group.position, Vector3.scale(actorDirection, movement));
      newPos.y = terrain.getElevation(newPos.x, newPos.z);
      actor.group.position.set(newPos);
    }
    camera.updateController();
    const height = terrain.getElevation(camera.position.x, camera.position.z);
    if (camera.position.y < height + 3) {
      camera.position.y = height + 3;
    }
    camera.render(scene, compositor);

    imGuiNewFrame();
    inspector.render();
    imGuiEndFrame();
  });
  terrainApp.run();
});
