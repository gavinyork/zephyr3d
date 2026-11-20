import { Interpolator, Vector3, Vector4 } from '@zephyr3d/base';
import {
  Scene,
  Application,
  OrbitCameraController,
  PerspectiveCamera,
  DirectionalLight,
  Mesh,
  PlaneShape,
  PBRMetallicRoughnessMaterial,
  ParticleEmitter,
  ParticleBurst,
  ParticleGradient,
  getInput,
  getEngine
} from '@zephyr3d/scene';
import { backendWebGL2 } from '@zephyr3d/backend-webgl';
import { backendWebGPU } from '@zephyr3d/backend-webgpu';

// The GPU simulation needs WebGPU; on WebGL2 the same effects run on the CPU with fewer
// particles. ?backend=webgl2 or ?backend=webgpu forces a backend.
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

// #region curves
// A curve over the normalized age (0 at birth, 1 at death) from [age, value] keys
function curve(keys) {
  return new Interpolator(
    'linear',
    'number',
    new Float32Array(keys.map((k) => k[0])),
    new Float32Array(keys.map((k) => k[1]))
  );
}

// An RGB curve over the normalized age from [age, r, g, b] keys, in linear color
function rgbCurve(keys) {
  return new Interpolator(
    'linear',
    'vec3',
    new Float32Array(keys.map((k) => k[0])),
    new Float32Array(keys.flatMap((k) => [k[1], k[2], k[3]]))
  );
}
// #endregion curves

// #region fountain
// Sparks thrown up from a cone, falling back and bouncing on the ground
function createFountain(scene) {
  const fx = new ParticleEmitter(scene);
  // 100 000 at once: with simulation 'auto' (the default) WebGPU runs them in a compute shader
  fx.maxParticles = 100000;
  fx.emission.rate = 20000;
  // Every 2-second cycle starts with a puff of extra sparks
  fx.duration = 2;
  fx.emission.bursts = [new ParticleBurst({ time: 0, count: [3000, 4000] })];
  fx.shape.type = 'cone';
  fx.shape.radius = 0.15;
  // Angles are in radians
  fx.shape.angle = 0.35;
  fx.start.lifetime.set(3, 4);
  fx.start.speed.set(7, 10);
  fx.start.size.set(0.03, 0.06);
  // Linear colors; above 1 they glow under bloom. Each spark picks one between A and B
  fx.start.colorA.setXYZW(4, 1.6, 0.4, 1);
  fx.start.colorB.setXYZW(3, 0.5, 0.1, 1);
  // Fully opaque until two thirds of the life, then fading out
  fx.overLife.color = new ParticleGradient(
    null,
    curve([
      [0, 1],
      [0.66, 1],
      [1, 0]
    ])
  );
  fx.forces.gravity.setXYZ(0, -9.8, 0);
  // The ground plane: world Y = planeHeight, with the default upward normal
  fx.collision.mode = 'plane';
  fx.collision.planeHeight = 0;
  fx.collision.bounce = 0.4;
  fx.collision.friction = 0.2;
  fx.material.blendMode = 'additive';
  // Quads lengthened along the motion, longer the faster they go
  fx.material.alignment = 'stretched';
  fx.material.stretchSpeedScale = 0.04;
  return fx;
}
// #endregion fountain

// #region smoke
// Smoke rising from a vent, stirred by noise and carried off by the scene's wind
function createSmoke(scene) {
  const fx = new ParticleEmitter(scene);
  fx.maxParticles = 4000;
  fx.emission.rate = 500;
  fx.shape.type = 'cone';
  fx.shape.radius = 0.6;
  fx.shape.angle = 0.15;
  fx.start.lifetime.set(6, 8);
  fx.start.speed.set(0.3, 0.6);
  fx.start.size.set(0.5, 0.8);
  // A random angle and a slow turn, so the puffs do not look alike
  fx.start.rotation.set(0, Math.PI * 2);
  fx.start.angularVelocity.set(-0.5, 0.5);
  fx.start.colorA.setXYZW(0.32, 0.32, 0.34, 0.5);
  fx.start.colorB.setXYZW(0.18, 0.18, 0.2, 0.5);
  // Grows to four times its size, fades in quickly and out slowly
  fx.overLife.size = curve([
    [0, 1],
    [1, 4]
  ]);
  fx.overLife.color = new ParticleGradient(
    null,
    curve([
      [0, 0],
      [0.1, 1],
      [1, 0]
    ])
  );
  // The air rises at 1.2 m/s plus the scene's wind, and drag brings the smoke to its speed.
  // Without drag the air and the wind would not move it at all
  fx.forces.drag = 0.8;
  fx.forces.airVelocity.setXYZ(0, 1.2, 0);
  fx.forces.windInfluence = 1;
  // Curl noise: swirls about 0.8 m/s² strong, two units across, changing slowly
  fx.forces.noise.strength = 0.8;
  fx.forces.noise.frequency = 0.5;
  fx.forces.noise.scrollSpeed = 0.3;
  fx.material.blendMode = 'blend';
  // Fades out near the ground behind it instead of cutting into it along a hard line
  fx.material.softDistance = 0.5;
  return fx;
}
// #endregion smoke

// #region swarm
// Glowing motes swirling in place: noise moves them around without bunching them up
function createSwarm(scene) {
  const fx = new ParticleEmitter(scene);
  fx.maxParticles = 300000;
  fx.emission.rate = 60000;
  fx.shape.type = 'sphere';
  fx.shape.radius = 2;
  fx.start.lifetime.set(4, 5);
  fx.start.speed.set(0, 0.2);
  fx.start.size.set(0.02, 0.04);
  fx.start.colorA.setXYZW(0.4, 1.6, 3, 1);
  fx.start.colorB.setXYZW(2, 0.5, 3, 1);
  fx.overLife.color = new ParticleGradient(
    null,
    curve([
      [0, 0],
      [0.2, 1],
      [0.8, 1],
      [1, 0]
    ])
  );
  // Drag toward still air keeps the speed near strength / drag, so the motes follow the swirls
  fx.forces.noise.strength = 4;
  fx.forces.noise.frequency = 0.6;
  fx.forces.noise.scrollSpeed = 0.5;
  fx.forces.drag = 1.5;
  fx.material.blendMode = 'additive';
  fx.position.setXYZ(0, 2.5, 0);
  return fx;
}
// #endregion swarm

// #region trail
// A comet circling the scene. Particles per meter travelled leave an even trail at any speed
function createTrail(scene) {
  const fx = new ParticleEmitter(scene);
  fx.maxParticles = 20000;
  fx.emission.rate = 0;
  fx.emission.rateOverDistance = 400;
  fx.shape.type = 'sphere';
  fx.shape.radius = 0.1;
  // Particles keep a fifth of the comet's velocity (world space only)
  fx.inheritVelocity = 0.2;
  fx.start.lifetime.set(1, 1.6);
  fx.start.speed.set(0.1, 0.4);
  fx.start.size.set(0.15, 0.25);
  fx.start.colorA.setXYZW(1.5, 1.8, 3, 1);
  fx.start.colorB.setXYZW(0.6, 1, 3, 1);
  // Shrinks away while it cools from white to deep red
  fx.overLife.size = curve([
    [0, 1],
    [1, 0]
  ]);
  fx.overLife.color = new ParticleGradient(
    rgbCurve([
      [0, 1, 1, 1],
      [0.3, 0.6, 0.8, 1],
      [1, 0.4, 0.1, 0.1]
    ]),
    curve([
      [0, 1],
      [1, 0]
    ])
  );
  fx.forces.drag = 2;
  fx.material.blendMode = 'additive';
  return fx;
}
// #endregion trail

const PRESETS = {
  fountain: createFountain,
  smoke: createSmoke,
  swarm: createSwarm,
  trail: createTrail
};

myApp.ready().then(function () {
  const scene = new Scene();
  scene.env.sky.skyType = 'none';
  scene.env.sky.fogType = 'none';
  scene.env.sky.skyColor = new Vector4(0.03, 0.04, 0.06, 1);
  scene.env.light.type = 'constant';
  scene.env.light.ambientColor = new Vector4(0.12, 0.13, 0.16, 1);
  // #region wind
  // The scene's wind, which grass, foliage and particles share: toward +X, gusting
  scene.env.wind.direction = 0;
  scene.env.wind.strength = 0.3;
  // #endregion wind

  const light = new DirectionalLight(scene);
  light.lookAt(new Vector3(3, 6, 4), Vector3.zero(), Vector3.axisPY());
  light.intensity = 0.8;

  const groundMaterial = new PBRMetallicRoughnessMaterial();
  groundMaterial.albedoColor = new Vector4(0.22, 0.23, 0.26, 1);
  groundMaterial.metallic = 0;
  groundMaterial.roughness = 0.9;
  new Mesh(scene, new PlaneShape({ size: 40 }), groundMaterial);

  scene.mainCamera = new PerspectiveCamera(scene, Math.PI / 3, 0.1, 200);
  scene.mainCamera.lookAt(new Vector3(0, 4, 11), new Vector3(0, 2, 0), Vector3.axisPY());
  scene.mainCamera.controller = new OrbitCameraController({ center: new Vector3(0, 2, 0) });
  scene.mainCamera.bloom = true;
  getInput().use(scene.mainCamera.handleEvent, scene.mainCamera);

  /** @type {HTMLSelectElement} */
  const presetSelect = document.querySelector('#preset-select');
  /** @type {HTMLSelectElement} */
  const simulationSelect = document.querySelector('#simulation-select');
  /** @type {HTMLElement} */
  const status = document.querySelector('#status');

  let fx = null;

  // #region simulation
  // The CPU simulation costs about a microsecond per particle each frame, so the effects made
  // for the GPU are cut down to this many particles there, rates and bursts alike
  const CPU_PARTICLES = 20000;

  function applySimulation() {
    // 'auto' picks the GPU on WebGPU from 1000 particles. Changing it starts the particles over
    fx.simulation = simulationSelect.value;
    if (fx.activeSimulation === 'cpu' && fx.maxParticles > CPU_PARTICLES) {
      const k = CPU_PARTICLES / fx.maxParticles;
      fx.maxParticles = CPU_PARTICLES;
      fx.emission.rate *= k;
      fx.emission.rateOverDistance *= k;
      for (const burst of fx.emission.bursts) {
        burst.count.set(Math.round(burst.count.min * k), Math.round(burst.count.max * k));
      }
    }
  }
  // #endregion simulation

  function usePreset(name) {
    // A new emitter per preset, so each starts from the defaults
    fx?.dispose();
    fx = PRESETS[name](scene);
    applySimulation();
  }
  usePreset(presetSelect.value);

  presetSelect.addEventListener('change', () => usePreset(presetSelect.value));
  // Rebuilds the preset, so a GPU-sized effect gets its full count back
  simulationSelect.addEventListener('change', () => usePreset(presetSelect.value));

  // #region playback
  document.querySelector('#burst-button').addEventListener('click', () => {
    // Born at the next step where the emitter is then; beyond maxParticles they are dropped
    fx.emit(Math.round(fx.maxParticles / 20));
  });
  document.querySelector('#restart-button').addEventListener('click', () => {
    // Clears the particles and plays from the start
    fx.restart();
  });
  // #endregion playback

  let lastStatus = 0;
  myApp.on('tick', function (_deltaMs, elapsedMs) {
    const t = elapsedMs * 0.001;
    // #region motion
    if (presetSelect.value === 'trail') {
      // The comet speeds up and slows down along its loop; the trail stays even
      const angle = t * 0.9 + Math.sin(t * 0.9) * 0.6;
      fx.position.setXYZ(Math.cos(angle) * 4, 1.5 + Math.sin(t * 2.1) * 0.6, Math.sin(angle) * 4);
    }
    // #endregion motion
    if (elapsedMs - lastStatus > 250) {
      lastStatus = elapsedMs;
      // aliveCount is an upper bound: particles whose lifetime may not have run out yet
      status.textContent = `${fx.activeSimulation.toUpperCase()} · up to ${fx.aliveCount} particles`;
    }
  });

  getEngine().setRenderable(scene, 0);

  myApp.run();
});
