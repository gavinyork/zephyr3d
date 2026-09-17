//
import { Vector2, Vector3, Vector4 } from '@zephyr3d/base';
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

//
const params = new URLSearchParams(location.search);

const BOAT_SIZE = { sizeX: 1.6, sizeY: 1, sizeZ: 3.6 };
const BOAT_MASS = 1500;
/** Thrust at full throttle, as an acceleration in m/s^2. Turned into a force by the mass. */
const BOAT_ACCEL = 6;
/** Rudder authority at full helm and full way on, as an angular acceleration in rad/s^2. */
const BOAT_TURN_ACCEL = 2.5;
/**
 * Sideways resistance of the hull, per second. A boat has a keel: it slides
 * forward far more readily than it slides sideways, and without this the thrust
 * would just skid it about like a puck.
 */
const BOAT_KEEL_DRAG = 4;
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
  interaction.windowSize = 120;
  water.interaction = interaction;

  // Things in the water. The boat and the buoy move, so they push water about;
  // the pilings do not, so they only block and reflect.
  const boatDisturber = new WaterDisturber(boat, 'box');
  boatDisturber.size = new Vector3(BOAT_SIZE.sizeX, BOAT_SIZE.sizeY, BOAT_SIZE.sizeZ);
  boatDisturber.strength = 0.15;
  interaction.addDisturber(boatDisturber);
  const buoyDisturber = new WaterDisturber(buoy, 'sphere');
  buoyDisturber.radius = BUOY_RADIUS;
  buoyDisturber.strength = 0.15;
  interaction.addDisturber(buoyDisturber);

  // Two-way coupling. The boat and the buoy float on the surface the material
  // draws - the ambient sea plus the interaction field, read back through the
  // water's own evaluation - and their motion disturbs that field in turn. A 2 m
  // lattice resolves the boat's wake and a stone's outer rings, not capillary
  // detail.
  const sampler = new WaterSurfaceSampler(water, { spacing: 2, cols: 25, rows: 25, updateHz: 30 });
  // The boat is not held at the waterline: buoyancy puts it there. The helm
  // only ever adds a thrust and a rudder torque, so the hull pitches over a
  // swell, heels into a turn, and drops into the trough of its own wake.
  // Five probes along the length so the swell can pitch it; three across so it
  // can heel.
  const boatBody = new FloatingBody({
    node: boat,
    size: new Vector3(BOAT_SIZE.sizeX, BOAT_SIZE.sizeY, BOAT_SIZE.sizeZ),
    mass: BOAT_MASS,
    // Riding high, as an empty hull does. Pushing this up sinks the boat deeper
    // and makes it far wetter and slower to right itself.
    submergedFraction: 0.35,
    probeColumns: 3,
    probeRows: 5,
    probeLayers: 3,
    // Well under the heave damping a small float wants: a boat should coast, and
    // the keel term below is what stops it from sliding sideways.
    linearDamping: 1.2,
    angularDamping: 2.5
  });
  boatBody.reset(boat.position.x, boat.position.z, water.position.y, 0);
  // Yaw inertia of the box hull, so the rudder can be specified as an angular
  // acceleration instead of a torque that has to be retuned with the mass.
  const boatInertiaY = (BOAT_MASS * (BOAT_SIZE.sizeX ** 2 + BOAT_SIZE.sizeZ ** 2)) / 12;
  const buoyBody = new FloatingBody({
    node: buoy,
    size: new Vector3(BUOY_RADIUS * 1.6, BUOY_RADIUS * 1.6, BUOY_RADIUS * 1.6),
    mass: 200,
    submergedFraction: 0.5,
    linearDamping: 1.5,
    angularDamping: 2
  });
  buoyBody.reset(buoy.position.x, buoy.position.z, water.position.y, 0);
  pilings.map((p) => {
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
    boatBody,
    buoyBody,
    device: myApp.device
  };

  getEngine().setRenderable(scene, 0);

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

  const cam = scene.mainCamera;
  const waterLevel = water.worldMatrix.m13;
  const waveHeightAt = (x, z) => sampler.sampleWorldYRaw(x, z) - waterLevel;
  // The bodies here are disturbers as well as floats, so the surface they read
  // is partly one they made. Damping them against the water rather than against
  // the world is what pays for the waves they radiate and lets the whole thing
  // come to rest.
  const waveVelocityAt = (x, z) => sampler.sampleWorldVelocityY(x, z);

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
      state.dragging = pev.buttons === 2;
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
      // A force-driven hull can be rolled over by a big enough sea and has no
      // way back on its own, so there is a way to set it upright again.
      if (kev.key.toLowerCase() === 'r') {
        boatBody.reset(boatBody.position.x, boatBody.position.z, waterLevel, 0);
      }
    } else if (type === 'keyup') {
      state.keys.delete(kev.key.toLowerCase());
    }
    return false;
  });
  const forwarder = function (ev, type) {
    return cam ? cam.handleEvent.call(cam, ev, type) : false;
  };
  getInput().use(forwarder);

  const boatForward = new Vector3();
  const tmpForce = new Vector3();

  myApp.on('tick', function (deltaMs) {
    const delta = Math.min(0.1, deltaMs / 1000);
    state.time += delta;
    // The boat is force driven, like the buoy: the helm only adds a thrust
    // along the hull's own forward axis and a rudder torque about Y, and
    // buoyancy is what holds it at the waterline. So it pitches over a swell,
    // heels into a turn, and drops into the trough of its own wake.
    const keys = state.keys;
    const thrust =
      (keys.has('w') || keys.has('arrowup') ? 1 : 0) - (keys.has('s') || keys.has('arrowdown') ? 0.5 : 0);
    const turn =
      (keys.has('a') || keys.has('arrowleft') ? 1 : 0) - (keys.has('d') || keys.has('arrowright') ? 1 : 0);
    // Local +Z is the bow. Taken from the body's orientation rather than a
    // stored yaw, so the thrust tilts with the hull: a boat that has just
    // launched off a crest is briefly pushing at the sky.
    boatBody.rotation.transform(Vector3.axisPZ(), boatForward);
    Vector3.scale(boatForward, thrust * BOAT_ACCEL * BOAT_MASS, tmpForce);
    boatBody.externalForce.addBy(tmpForce);
    // The heading, which is the bow flattened onto the water and renormalised.
    // The keel works on the horizontal flow past the hull, so it has to be
    // resolved against a horizontal axis: measured against the tilted bow
    // instead, a hull that is pitching reads its own heave as headway and the
    // sideways term turns into a push across the water.
    const headingLength = Math.hypot(boatForward.x, boatForward.z);
    let boatSpeed = 0;
    if (headingLength > 1e-4) {
      const hx = boatForward.x / headingLength;
      const hz = boatForward.z / headingLength;
      boatSpeed = boatBody.velocity.x * hx + boatBody.velocity.z * hz;
      // The keel: whatever horizontal velocity is not along the heading,
      // resisted hard. Heave is left to the buoyancy.
      tmpForce.setXYZ(boatBody.velocity.x - hx * boatSpeed, 0, boatBody.velocity.z - hz * boatSpeed);
      tmpForce.scaleBy(-BOAT_KEEL_DRAG * BOAT_MASS);
      boatBody.externalForce.addBy(tmpForce);
    }
    // A rudder needs way on: with no water running over it there is no turn.
    boatBody.externalTorque.y += turn * BOAT_TURN_ACCEL * boatInertiaY * Math.min(1, Math.abs(boatSpeed) / 2);
    // The boat and the buoy ride whatever the surface is doing, wake and
    // stones included.
    sampler.update(delta);
    boatBody.update(delta, waveHeightAt, waterLevel, waveVelocityAt);
    buoyBody.update(delta, waveHeightAt, waterLevel, waveVelocityAt);
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
  });

  myApp.run();
});

function buildScene() {
  const scene = new Scene();

  const sun = new DirectionalLight(scene);
  sun.rotation.fromEulerAngle(-Math.PI / 4, Math.PI / 4, 0);
  sun.castShadow = true;

  const bedMaterial = new PBRMetallicRoughnessMaterial();
  bedMaterial.albedoColor = new Vector4(0.2, 0.24, 0.3, 1);
  bedMaterial.metallic = 0;
  bedMaterial.roughness = 1;
  const bed = new Mesh(scene, new PlaneShape({ size: 4000 }), bedMaterial);
  bed.position.setXYZ(0, -3, 0);

  const water = new Water(scene);
  water.scale.setXYZ(1000, 1, 1000);
  water.position.setXYZ(0, 0, 0);
  water.infinite = true;
  water.gridScale = 1;
  water.animationSpeed = 1;
  water.causticsIntensity = 1.5;
  water.causticsRange = 60;
  water.causticsDepth = 6;
  water.causticsFadeDistance = 15;
  water.absorptionScale = 2.5;

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
  water.subsurfaceIntensity = 0.5;
  water.subsurfaceCrestHeight = 1.5;
  water.foamAmount = 0.3;
  water.foamFalloff = 1.8;

  water.causticsEnabled = true;
  water.causticsDepth = 3;
  water.causticsSceneDepth = true;

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
    sun.shadow.shadowRegion.addStaticCaster(pole);
  }

  // A boat: a box hull that floats on the water and is driven from the keyboard.
  const boatMaterial = new PBRMetallicRoughnessMaterial();
  boatMaterial.albedoColor = new Vector4(0.8, 0.3, 0.2, 1);
  boatMaterial.metallic = 0;
  boatMaterial.roughness = 0.6;
  const boat = new Mesh(scene, new BoxShape(BOAT_SIZE), boatMaterial);
  boat.position.setXYZ(0, 0, -10);
  sun.shadow.shadowRegion.addDynamicCaster(boat);
  sun.shadow.shadowDistance = 100;

  // A buoy that bobs in and out of the water on its own.
  const buoyMaterial = new PBRMetallicRoughnessMaterial();
  buoyMaterial.albedoColor = new Vector4(0.95, 0.85, 0.2, 1);
  buoyMaterial.metallic = 0;
  buoyMaterial.roughness = 0.5;
  const buoy = new Mesh(scene, new SphereShape({ radius: BUOY_RADIUS }), buoyMaterial);
  buoy.position.setXYZ(10, 0, 4);
  sun.shadow.shadowRegion.addDynamicCaster(buoy);

  scene.mainCamera = new PerspectiveCamera(scene, Math.PI / 3, 0.1, 2000);
  scene.mainCamera.lookAt(new Vector3(0, 12, 26), new Vector3(0, 0, 0), Vector3.axisPY());
  scene.mainCamera.controller = new OrbitCameraController();
  scene.mainCamera.TAA = true;

  return { scene, water, waves, boat, buoy, pilings };
}
