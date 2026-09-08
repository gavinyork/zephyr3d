import { Vector2, Vector3, Vector4, DRef } from '@zephyr3d/base';
import {
  Scene,
  Application,
  OrbitCameraController,
  PerspectiveCamera,
  Mesh,
  DirectionalLight,
  BoxShape,
  CylinderShape,
  PlaneShape,
  SphereShape,
  PBRMetallicRoughnessMaterial,
  Water,
  FFTWaveGenerator,
  getInput,
  getEngine,
  getDevice
} from '@zephyr3d/scene';
import { backendWebGL2 } from '@zephyr3d/backend-webgl';
import { backendWebGPU } from '@zephyr3d/backend-webgpu';

async function resolveBackend() {
  const forced = new URLSearchParams(location.search).get('backend');
  if (forced === 'webgl2') {
    return backendWebGL2;
  }
  if (forced === 'webgpu') {
    return backendWebGPU;
  }
  return (await backendWebGPU.supported()) ? backendWebGPU : backendWebGL2;
}

const myApp = new Application({
  backend: await resolveBackend(),
  canvas: document.querySelector('#my-canvas')
});

myApp.ready().then(function () {
  /** @type {DRef<Scene>} */
  const ocean = new DRef(buildOceanScene());
  /** @type {DRef<Scene>} */
  const pool = new DRef(buildPoolScene());

  const state = {
    /** @type {Scene} */
    scene: null
  };
  const forwarder = function (ev, type) {
    const cam = state.scene && state.scene.mainCamera;
    return cam ? cam.handleEvent.call(cam, ev, type) : false;
  };

  const applyScene = function (/** @type {Scene} */ scene) {
    state.scene = scene;
    getEngine().setRenderable(scene, 0);
  };

  /** @type {HTMLSelectElement} */
  const select = document.querySelector('#scene-select');
  select.addEventListener('change', function () {
    applyScene(select.value === 'pool' ? pool.get() : ocean.get());
  });
  if (new URLSearchParams(location.search).get('scene') === 'pool') {
    select.value = 'pool';
  }
  applyScene(select.value === 'pool' ? pool.get() : ocean.get());

  getInput().use(forwarder);
  myApp.run();
});

// Ocean: FFT waves with foam over a sand bed, caustics on the bed.
function buildOceanScene() {
  const scene = new Scene();

  // A little constant ambient so foam and the bed keep detail under the sun.
  scene.env.light.type = 'constant';
  scene.env.light.ambientColor = new Vector4(0.12, 0.16, 0.22, 1);

  // The sun, off vertical enough that caustics and shadows land visibly.
  const sun = new DirectionalLight(scene);
  sun.rotation.fromEulerAngle(-Math.PI / 4, Math.PI / 4, 0);
  sun.castShadow = true;

  const rockMaterial = new PBRMetallicRoughnessMaterial();
  rockMaterial.albedoColor = new Vector4(0.45, 0.4, 0.35, 1);
  rockMaterial.metallic = 0;
  rockMaterial.roughness = 0.95;
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2;
    const rock = new Mesh(scene, new BoxShape({ size: 6 + (i % 3) * 3 }), rockMaterial);
    rock.position.setXYZ(Math.cos(angle) * 25, -1.5 + (i % 3) * 0.8, Math.sin(angle) * 25);
    rock.rotation.fromEulerAngle(0.3 * i, 0.7 * i, 0.2 * i);
    sun.shadow.shadowRegion.addStaticCaster(rock);
  }

  const pillarMaterial = new PBRMetallicRoughnessMaterial();
  pillarMaterial.albedoColor = new Vector4(0.4, 0.26, 0.16, 1);
  pillarMaterial.roughness = 0.9;
  const pillar = new Mesh(
    scene,
    new CylinderShape({ topRadius: 1.5, bottomRadius: 1.5, height: 16 }),
    pillarMaterial
  );
  pillar.position.setXYZ(0, -8, 0);
  sun.shadow.shadowRegion.addStaticCaster(pillar);

  // The sand bed. Its depth matches the caustic focal depth.
  const bedMaterial = new PBRMetallicRoughnessMaterial();
  bedMaterial.albedoColor = new Vector4(0.76, 0.7, 0.5, 1);
  bedMaterial.roughness = 1;
  const bed = new Mesh(scene, new PlaneShape({ size: 400 }), bedMaterial);
  bed.position.setXYZ(0, -3, 0);

  const water = new Water(scene);
  water.scale.setXYZ(5000, 1, 5000);
  water.position.setXYZ(0, 0, 0);
  water.gridScale = 1;
  water.animationSpeed = 1;

  // FFT rather than FBM, so the surface genuinely folds - that is what feeds
  // both the foam and cresting here.
  const waves = new FFTWaveGenerator();
  waves.wind = new Vector2(14, 5);
  waves.setWaveLength(0, 120);
  waves.setWaveLength(1, 30);
  waves.setWaveLength(2, 6);
  waves.setWaveStrength(0, 0.7);
  waves.setWaveStrength(1, 0.8);
  waves.setWaveStrength(2, 0.9);
  waves.setWaveCroppiness(0, -2.2);
  waves.setWaveCroppiness(1, -2);
  waves.setWaveCroppiness(2, -1.4);
  waves.foamWidth = 1.1;
  waves.foamContrast = 2.5;
  water.waveGenerator = waves;

  // Turbid open-ocean water: the bed fades with depth, so only the shallow
  // reaches carry a visible caustic web.
  water.absorption = new Vector3(0.4, 0.14, 0.09);
  water.scattering = new Vector3(0.06, 0.12, 0.15);
  water.reflectionStrength = 0.8;
  water.refractionScale = 1;
  water.foamAmount = 1;
  water.foamFalloff = 1.5;

  water.causticsEnabled = true;
  water.causticsDepth = 3;
  water.causticsRange = 40;
  water.causticsSceneDepth = true;

  scene.mainCamera = new PerspectiveCamera(scene, Math.PI / 3, 1, 1000);
  scene.mainCamera.lookAt(new Vector3(0, 18, 60), new Vector3(0, 0, 0), Vector3.axisPY());
  scene.mainCamera.controller = new OrbitCameraController();
  scene.mainCamera.TAA = true;

  return scene;
}

// Pool: a thick-walled basin, clear shallow water, caustics on a tiled floor.
function buildPoolScene() {
  const scene = new Scene();
  const sun = new DirectionalLight(scene);
  sun.rotation.fromEulerAngle(-Math.PI / 5, Math.PI / 3, 0);
  sun.castShadow = true;

  // A modest blue ambient so the pool interior and walls keep shape without
  // washing out - the caustics and clear water are what this scene is about.
  scene.env.light.type = 'constant';
  scene.env.light.ambientColor = new Vector4(0.16, 0.2, 0.26, 1);

  // Four thick walls form the pool. Each sits on the floor and rises above the
  // waterline; the surface covers the interior.
  const wallMaterial = new PBRMetallicRoughnessMaterial();
  wallMaterial.albedoColor = new Vector4(0.62, 0.65, 0.7, 1);
  wallMaterial.metallic = 0;
  wallMaterial.roughness = 0.7;
  const HALF = 14;
  const WALL = 1.2;
  const WALL_H = 7;
  const wallSpecs = [
    { x: 0, z: HALF, sx: HALF * 2, sz: WALL },
    { x: 0, z: -HALF, sx: HALF * 2, sz: WALL },
    { x: HALF, z: 0, sx: WALL, sz: HALF * 2 },
    { x: -HALF, z: 0, sx: WALL, sz: HALF * 2 }
  ];
  for (const w of wallSpecs) {
    const wall = new Mesh(scene, new BoxShape({ sizeX: w.sx, sizeY: WALL_H, sizeZ: w.sz }), wallMaterial);
    wall.position.setXYZ(w.x, WALL_H / 2 - 3, w.z);
    sun.shadow.shadowRegion.addStaticCaster(wall);
  }

  const sphereMaterial = new PBRMetallicRoughnessMaterial();
  sphereMaterial.albedoColor = new Vector4(0.1, 0.65, 0.1, 1);
  sphereMaterial.metallic = 0;
  sphereMaterial.roughness = 0.7;
  const sphere = new Mesh(scene, new SphereShape({ radius: 2 }), sphereMaterial);
  sphere.position.setXYZ(3, -1, 4);
  sun.shadow.shadowRegion.addStaticCaster(sphere);

  // The pool floor, textured so refraction and caustics have a pattern to
  // distort.
  const floorMaterial = new PBRMetallicRoughnessMaterial();
  floorMaterial.albedoColor = new Vector4(0.9, 0.95, 1, 1);
  floorMaterial.albedoTexture = makeCheckerTexture();
  floorMaterial.metallic = 0;
  floorMaterial.roughness = 0.1;
  const floor = new Mesh(scene, new PlaneShape({ size: HALF * 2 }), floorMaterial);
  floor.position.setXYZ(0, -3, 0);

  const water = new Water(scene);
  water.scale.setXYZ(HALF, 1, HALF);
  water.position.setXYZ(0, 3, 0);
  water.gridScale = 1;
  water.animationSpeed = 1;
  water.causticsIntensity = 1;
  water.causticsRange = 30;
  water.causticsFadeDistance = 6;
  water.absorptionScale = 2.5;

  // FFT, gentle in height but sharp in curvature, so the caustic web is lively
  // without churning the pool.
  const waves = new FFTWaveGenerator();
  waves.wind = new Vector2(1, 1);
  waves.setWaveLength(0, 400);
  waves.setWaveLength(1, 100);
  waves.setWaveLength(2, 15);
  waves.setWaveStrength(0, 0.4);
  waves.setWaveStrength(1, 0.4);
  waves.setWaveStrength(2, 0.02);
  waves.setWaveCroppiness(0, -1.5);
  waves.setWaveCroppiness(1, -1.2);
  waves.setWaveCroppiness(2, -0.5);
  water.waveGenerator = waves;

  // Very clear water: the point is to see through it to the tiles.
  water.absorption = new Vector3(0.08, 0.03, 0.02);
  water.scattering = new Vector3(0.01, 0.02, 0.03);
  water.reflectionStrength = 0.5;
  water.refractionScale = 1;
  water.foamAmount = 0.3;
  water.foamFalloff = 1.8;

  water.causticsEnabled = true;
  water.causticsDepth = 3;
  water.causticsSceneDepth = true;

  scene.mainCamera = new PerspectiveCamera(scene, Math.PI / 3, 0.1, 200);
  scene.mainCamera.lookAt(new Vector3(0, 15, 34), new Vector3(0, -1, 0), Vector3.axisPY());
  scene.mainCamera.controller = new OrbitCameraController();
  scene.mainCamera.FXAA = true;

  return scene;
}

// A small tiled checkerboard; the tiles repeat across the floor via the plane's
// UVs, so refraction and caustics have an unambiguous pattern to displace.
function makeCheckerTexture() {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  const cell = size >> 3;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const dark = (((x / cell) | 0) + ((y / cell) | 0)) & 1;
      data[i] = dark ? 60 : 220;
      data[i + 1] = dark ? 70 : 225;
      data[i + 2] = dark ? 80 : 230;
      data[i + 3] = 255;
    }
  }
  const tex = getDevice().createTexture2D('rgba8unorm', size, size);
  tex.update(data, 0, 0, size, size);
  return tex;
}
