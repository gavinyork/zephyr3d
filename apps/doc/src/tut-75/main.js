//
import { DRef, Quaternion, Vector2, Vector3, Vector4 } from '@zephyr3d/base';
import {
  Scene,
  Application,
  OrbitCameraController,
  PerspectiveCamera,
  Mesh,
  DirectionalLight,
  PlaneShape,
  CylinderShape,
  BoxShape,
  SphereShape,
  PBRMetallicRoughnessMaterial,
  Water,
  WaterInteraction,
  WaterDisturber,
  WaterSurfaceSampler,
  FloatingBody,
  FFTWaveGenerator,
  getInput,
  getEngine
} from '@zephyr3d/scene';
import { backendWebGL2 } from '@zephyr3d/backend-webgl';
import { backendWebGPU } from '@zephyr3d/backend-webgpu';

const params = new URLSearchParams(location.search);

const BOAT_SIZE = { sizeX: 1.6, sizeY: 1, sizeZ: 3.6 };
const BOAT_ACCEL = 6;
const BOAT_DRAG = 0.8;
const BOAT_TURN_RATE = 1.2;
const BUOY_RADIUS = 0.8;
const PILING_RADIUS = 0.35;
const PILING_HEIGHT = 12;

async function resolveBackend() {
  const forced = params.get('backend');
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
  const { scene, water, waves, boat, buoy, pilings } = buildScene();

  // The field is one object hung off the water. Everything that evaluates the
  // surface - the material, the height query, the caustics - sees it from here on.
  const interaction = new WaterInteraction();
  water.interaction = interaction;
  // The water holds the field by reference count and disposes it when detached,
  // as it does its wave generator. This demo detaches and reattaches the same
  // field from a checkbox, so it keeps a reference of its own.
  const interactionRef = new DRef(interaction);
  globalThis.waterInteractionRef = interactionRef;

  // Things in the water. The boat and the buoy move, so they push water about;
  // the pilings do not, so they only block and reflect.
  const boatDisturber = new WaterDisturber(boat.node, 'box');
  boatDisturber.size = new Vector3(BOAT_SIZE.sizeX, BOAT_SIZE.sizeY, BOAT_SIZE.sizeZ);
  boatDisturber.strength = 0.15;
  interaction.addDisturber(boatDisturber);
  const buoyDisturber = new WaterDisturber(buoy, 'sphere');
  buoyDisturber.radius = BUOY_RADIUS;
  buoyDisturber.strength = 0.15;
  interaction.addDisturber(buoyDisturber);

  // Two-way coupling. The buoy floats on the surface the material draws -
  // the ambient sea plus the interaction field, read back through the water's
  // own evaluation - and its motion disturbs that field in turn. A 2 m lattice
  // resolves the boat's wake and a stone's outer rings, not capillary detail.
  const sampler = new WaterSurfaceSampler(water, { spacing: 2, cols: 25, rows: 25, updateHz: 30 });
  const buoyBody = new FloatingBody({
    node: buoy,
    size: new Vector3(BUOY_RADIUS * 1.6, BUOY_RADIUS * 1.6, BUOY_RADIUS * 1.6),
    mass: 200,
    submergedFraction: 0.5,
    linearDamping: 1.5,
    angularDamping: 2
  });
  buoyBody.reset(buoy.position.x, buoy.position.z, water.position.y, 0);
  const pilingDisturbers = pilings.map((p) => {
    const d = new WaterDisturber(p, 'capsule');
    d.radius = PILING_RADIUS;
    d.halfLength = PILING_HEIGHT / 2;
    d.blocking = true;
    interaction.addDisturber(d);
    return d;
  });

  const state = {
    /** @type {number} Peak height of a dropped stone's bump, metres. */
    strength: 0.25,
    /** @type {number} Radius of the bump, metres. */
    radius: 1,
    /** @type {number} Stones dropped so far. */
    drops: 0,
    /** @type {{x: number, y: number} | null} Where the left button went down, screen pixels. */
    pressAt: null,
    /** @type {boolean} Shift is held: the pointer drags through the water. */
    dragging: false,
    /** @type {{x: number, z: number} | null} Where the drag was last frame, world. */
    dragLast: null,
    /** @type {{x: number, y: number}} Pointer position, screen pixels. */
    pointer: { x: 0, y: 0 },
    /** @type {Set<string>} Keys held down. */
    keys: new Set(),
    /** @type {number} Seconds elapsed, for the buoy's bob. */
    time: 0
  };

  globalThis.waterInteraction = {
    water,
    interaction,
    scene,
    waves,
    boat,
    buoy,
    boatDisturber,
    buoyDisturber,
    sampler,
    buoyBody,
    device: myApp.device
  };

  getEngine().setRenderable(scene, 0);

  const status = document.querySelector('#status');
  /** @type {HTMLInputElement} */
  const enabledCheck = document.querySelector('#enabled-check');
  /** @type {HTMLSelectElement} */
  const debugSelect = document.querySelector('#debug-select');
  /** @type {HTMLSelectElement} */
  const resolutionSelect = document.querySelector('#resolution-select');
  const bindRange = (id, apply, format) => {
    /** @type {HTMLInputElement} */
    const input = document.querySelector(`#${id}-input`);
    /** @type {HTMLElement} */
    const label = document.querySelector(`#${id}-label`);
    const update = () => {
      const v = Number(input.value);
      apply(v);
      label.textContent = format(v);
    };
    input.addEventListener('input', update);
    update();
    return update;
  };

  enabledCheck.addEventListener('change', function () {
    water.interaction = enabledCheck.checked ? interaction : null;
  });
  debugSelect.addEventListener('change', function () {
    water.debugOutput = /** @type {import('@zephyr3d/scene').WaterDebugOutput} */ (debugSelect.value);
  });
  resolutionSelect.addEventListener('change', function () {
    interaction.resolution = Number(resolutionSelect.value);
    refreshSpeed();
  });
  bindRange(
    'window',
    (v) => (interaction.windowSize = v),
    (v) => `${v}m`
  );
  const refreshSpeed = bindRange(
    'speed',
    (v) => (interaction.waveSpeed = v),
    () => `${interaction.waveSpeed.toFixed(1)}m/s`
  );
  bindRange(
    'damping',
    (v) => (interaction.damping = v),
    (v) => `${v.toFixed(1)}/s`
  );
  bindRange(
    'foam',
    (v) => (interaction.foamAmount = v),
    (v) => v.toFixed(2)
  );
  bindRange(
    'foamdecay',
    (v) => (interaction.foamDecay = v),
    (v) => `${v.toFixed(2)}/s`
  );
  bindRange(
    'strength',
    (v) => (state.strength = v),
    (v) => `${v.toFixed(2)}m`
  );
  bindRange(
    'radius',
    (v) => (state.radius = v),
    (v) => `${v.toFixed(1)}m`
  );
  bindRange(
    'push',
    (v) => {
      boatDisturber.strength = v;
      buoyDisturber.strength = v;
    },
    (v) => `${v.toFixed(2)}m`
  );
  /** @type {HTMLInputElement} */
  const blockCheck = document.querySelector('#block-check');
  blockCheck.addEventListener('change', function () {
    for (const d of pilingDisturbers) {
      d.blocking = blockCheck.checked;
    }
  });
  bindRange(
    'sea',
    (v) => {
      waves.setWaveStrength(0, 1.2 * v);
      waves.setWaveStrength(1, 0.8 * v);
      waves.setWaveStrength(2, 0.9 * v);
    },
    (v) => v.toFixed(2)
  );
  bindRange(
    'anim',
    (v) => (water.animationSpeed = v),
    (v) => v.toFixed(2)
  );

  const cam = scene.mainCamera;
  const waterLevel = water.worldMatrix.m13;
  const waveHeightAt = (x, z) => sampler.sampleWorldYRaw(x, z) - waterLevel;

  /** World XZ under a screen position on the still-water plane, or null if the ray misses it. */
  const pickWater = (sx, sy) => {
    const ray = cam.constructRay(sx, sy);
    const dy = ray.direction.y;
    if (Math.abs(dy) < 1e-6) {
      return null;
    }
    const t = (waterLevel - ray.origin.y) / dy;
    if (t <= 0) {
      return null;
    }
    return { x: ray.origin.x + ray.direction.x * t, z: ray.origin.z + ray.direction.z * t };
  };

  // Ahead of the camera controller, without consuming anything: a click that
  // does not move is a stone, a drag is still an orbit.
  getInput().use(function (ev, type) {
    const pev = /** @type {PointerEvent} */ (ev);
    const kev = /** @type {KeyboardEvent} */ (ev);
    if (type === 'pointerdown' && pev.button === 0) {
      state.pressAt = { x: pev.offsetX, y: pev.offsetY };
      // Keyboard focus follows the pointer, so the boat answers after a slider is touched.
      myApp.focus();
    } else if (type === 'pointermove') {
      state.pointer.x = pev.offsetX;
      state.pointer.y = pev.offsetY;
      state.dragging = pev.shiftKey;
    } else if (type === 'pointerup' && pev.button === 0 && state.pressAt) {
      const moved = Math.hypot(pev.offsetX - state.pressAt.x, pev.offsetY - state.pressAt.y);
      state.pressAt = null;
      if (moved < 4 && !pev.shiftKey) {
        const hit = pickWater(pev.offsetX, pev.offsetY);
        if (hit) {
          interaction.addImpulse(hit.x, hit.z, state.radius, -state.strength);
          state.drops++;
        }
      }
    } else if (type === 'keyup' && kev.key === 'Shift') {
      state.dragging = false;
    }
    if (type === 'keydown') {
      state.keys.add(kev.key.toLowerCase());
    } else if (type === 'keyup') {
      state.keys.delete(kev.key.toLowerCase());
    }
    return false;
  });
  const forwarder = function (ev, type) {
    return cam ? cam.handleEvent.call(cam, ev, type) : false;
  };
  getInput().use(forwarder);

  myApp.on('tick', function (deltaMs) {
    const delta = Math.min(0.1, deltaMs / 1000);
    state.time += delta;
    // The boat is driven kinematically: thrust and turn, with drag, held at
    // the still-water level. It is what disturbs the water, not what rides it.
    const keys = state.keys;
    const thrust =
      (keys.has('w') || keys.has('arrowup') ? 1 : 0) - (keys.has('s') || keys.has('arrowdown') ? 0.5 : 0);
    const turn =
      (keys.has('a') || keys.has('arrowleft') ? 1 : 0) - (keys.has('d') || keys.has('arrowright') ? 1 : 0);
    boat.speed += (thrust * BOAT_ACCEL - boat.speed * BOAT_DRAG) * delta;
    boat.yaw += turn * BOAT_TURN_RATE * delta * Math.min(1, Math.abs(boat.speed) / 2);
    boat.node.position.x += Math.sin(boat.yaw) * boat.speed * delta;
    boat.node.position.z += Math.cos(boat.yaw) * boat.speed * delta;
    boat.node.rotation = Quaternion.fromEulerAngle(0, boat.yaw, 0, 'ZYX');
    // The buoy rides whatever the surface is doing, wake and stones included.
    sampler.update(delta);
    buoyBody.update(delta, waveHeightAt, waterLevel);
    // A dragged object pushes the water down a little at every position it
    // passes through; the wake is what the field makes of that trail.
    if (state.dragging) {
      const hit = pickWater(state.pointer.x, state.pointer.y);
      if (hit) {
        const last = state.dragLast;
        if (!last || Math.hypot(hit.x - last.x, hit.z - last.z) > interaction.texelSize) {
          interaction.addImpulse(hit.x, hit.z, state.radius, -state.strength * 0.25);
          state.dragLast = hit;
        }
      }
    } else {
      state.dragLast = null;
    }
    status.textContent =
      `waveTime ${water.waveTime.toFixed(2)}s  fps ${myApp.device.frameInfo.FPS.toFixed(0)}\n` +
      `field ${interaction.resolution}x${interaction.resolution} over ${interaction.windowSize}m  ` +
      `texel ${interaction.texelSize.toFixed(3)}m\n` +
      `wave speed ${interaction.waveSpeed.toFixed(2)}m/s (max ${interaction.maxWaveSpeed.toFixed(2)})  ` +
      `damping ${interaction.damping.toFixed(1)}/s\n` +
      `window origin (${interaction.originX.toFixed(1)}, ${interaction.originZ.toFixed(1)})  ` +
      `stones ${state.drops}${state.dragging ? '  dragging' : ''}\n` +
      `boat speed ${boat.speed.toFixed(1)}m/s  disturbers ${interaction.disturbers.length}
` +
      `buoy y ${buoyBody.position.y.toFixed(2)}m  surface queries ${sampler.readCount} ` +
      `(${sampler.batchFrames} frames/batch)`;
  });

  myApp.run();
});

function buildScene() {
  const scene = new Scene();

  const sun = new DirectionalLight(scene);
  sun.rotation.fromEulerAngle(-Math.PI / 4, Math.PI / 4, 0);
  sun.intensity = 8;
  sun.castShadow = true;

  const bedMaterial = new PBRMetallicRoughnessMaterial();
  bedMaterial.albedoColor = new Vector4(0.2, 0.24, 0.3, 1);
  bedMaterial.metallic = 0;
  bedMaterial.roughness = 1;
  const bed = new Mesh(scene, new PlaneShape({ size: 4000 }), bedMaterial);
  bed.position.setXYZ(0, -5, 0);

  const water = new Water(scene);
  water.position.setXYZ(0, 0, 0);
  water.gridScale = 1;
  water.animationSpeed = 1;
  water.infinite = false;
  water.scale.setXYZ(1000, 1, 1000);
  // A gentle sea, so the ripples are not lost in it. The Sea slider scales it.
  const waves = new FFTWaveGenerator();
  waves.wind = new Vector2(6, 0);
  waves.setWaveLength(0, 400);
  waves.setWaveLength(1, 100);
  waves.setWaveLength(2, 16);
  waves.setWaveStrength(0, 1.2 * 0.6);
  waves.setWaveStrength(1, 0.8 * 0.6);
  waves.setWaveStrength(2, 0.9 * 0.6);
  waves.setWaveCroppiness(0, -2.2);
  waves.setWaveCroppiness(1, -2);
  waves.setWaveCroppiness(2, -1.4);
  water.waveGenerator = waves;

  water.absorption = new Vector3(0.4, 0.14, 0.09);
  water.scattering = new Vector3(0.06, 0.12, 0.15);
  water.reflectionStrength = 0.8;
  water.refractionScale = 1;
  water.subsurfaceIntensity = 0.5;
  water.subsurfaceCrestHeight = 1.5;
  water.sunScatteringIntensity = 0.4;
  water.foamAmount = 1;
  water.foamFalloff = 1.5;
  water.causticsEnabled = true;
  water.causticsIntensity = 1.5;

  // Pilings standing in the water, so the eye has something fixed to judge the
  // ripples against and something for the ripples to reflect off.
  const poleMaterial = new PBRMetallicRoughnessMaterial();
  poleMaterial.albedoColor = new Vector4(0.55, 0.42, 0.3, 1);
  poleMaterial.metallic = 0;
  poleMaterial.roughness = 0.8;
  const poleShape = new CylinderShape({
    topRadius: PILING_RADIUS,
    bottomRadius: PILING_RADIUS,
    height: PILING_HEIGHT
  });
  const pilings = [];
  for (const [x, z] of [
    [-6, -6],
    [6, -6],
    [-6, 6],
    [6, 6]
  ]) {
    const pole = new Mesh(scene, poleShape, poleMaterial);
    pole.position.setXYZ(x, -PILING_HEIGHT / 3, z);
    pilings.push(pole);
  }

  // A boat: a box sitting half in the water, driven from the keyboard.
  const boatMaterial = new PBRMetallicRoughnessMaterial();
  boatMaterial.albedoColor = new Vector4(0.8, 0.3, 0.2, 1);
  boatMaterial.metallic = 0;
  boatMaterial.roughness = 0.6;
  const boatNode = new Mesh(scene, new BoxShape(BOAT_SIZE), boatMaterial);
  boatNode.position.setXYZ(0, 0, -10);
  const boat = { node: boatNode, speed: 0, yaw: 0 };

  // A buoy that bobs in and out of the water on its own.
  const buoyMaterial = new PBRMetallicRoughnessMaterial();
  buoyMaterial.albedoColor = new Vector4(0.95, 0.85, 0.2, 1);
  buoyMaterial.metallic = 0;
  buoyMaterial.roughness = 0.5;
  const buoy = new Mesh(scene, new SphereShape({ radius: BUOY_RADIUS }), buoyMaterial);
  buoy.position.setXYZ(10, 0, 4);

  scene.mainCamera = new PerspectiveCamera(scene, Math.PI / 3, 0.1, 2000);
  scene.mainCamera.lookAt(new Vector3(0, 12, 26), new Vector3(0, 0, 0), Vector3.axisPY());
  scene.mainCamera.controller = new OrbitCameraController();
  scene.mainCamera.TAA = true;

  return { scene, water, waves, boat, buoy, pilings };
}
