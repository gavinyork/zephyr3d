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
  Primitive,
  BoundingBox,
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
/** A loaded boat. How deep it floats is set by its submerged fraction, below, not by the mass. */
const BOAT_MASS = 2500;
/**
 * How far the hull pushes the water's surface down where it sits, in metres:
 * about half its draft. The deeper and faster a hull goes, the harder it
 * forces the water aside at its bow and stern, and the thicker its wake foams.
 */
const BOAT_DISPLACEMENT = 0.3;
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
  // The hull's footprint is its bounding box: the box's blunt ends push the
  // water harder than a rounded footprint would, which is where a hull makes
  // its bow wave and its wash. It floats: it displaces the same water however
  // it bobs, so its wake comes from its way through the water alone, not from
  // its pitching over the swell.
  const boatDisturber = new WaterDisturber(boat, 'box');
  boatDisturber.size = new Vector3(BOAT_SIZE.sizeX, BOAT_SIZE.sizeY, BOAT_SIZE.sizeZ);
  boatDisturber.strength = BOAT_DISPLACEMENT;
  boatDisturber.floating = true;
  interaction.addDisturber(boatDisturber);
  const buoyDisturber = new WaterDisturber(buoy, 'sphere');
  buoyDisturber.radius = BUOY_RADIUS;
  buoyDisturber.strength = 0.15;
  interaction.addDisturber(buoyDisturber);

  // Float on ambient waves and external impulses only. Disturber wakes remain
  // visible, but cannot drive either floating body and sustain oscillation.
  const sampler = new WaterSurfaceSampler(water, {
    spacing: 2,
    cols: 25,
    rows: 25,
    updateHz: 30,
    includeDisturbers: false
  });
  // The boat is not held at the waterline: buoyancy puts it there. The helm
  // only ever adds a thrust and a rudder torque, so the hull pitches over a
  // swell and heels into a turn.
  // Five probes along the length so the swell can pitch it; three across so it
  // can heel.
  const boatBody = new FloatingBody({
    node: boat,
    size: new Vector3(BOAT_SIZE.sizeX, BOAT_SIZE.sizeY, BOAT_SIZE.sizeZ),
    mass: BOAT_MASS,
    // Loaded, so riding deep. Pushing this up sinks the boat deeper and makes
    // it wetter and slower to right itself; down floats it high, as an empty
    // hull does.
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
    (v) => `${v.toFixed(1)}/s`
  );
  bindRange(
    'foamdecay',
    (v) => (interaction.foamDecay = v),
    (v) => `${v.toFixed(2)}/s`
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
    // External waves drive buoyancy; the bodies' own wakes are rendering only.
    sampler.update(delta);
    boatBody.update(delta, waveHeightAt, waterLevel);
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
  });

  myApp.run();
});

/**
 * A small open boat inside the box `size`, bow towards local +Z: a pointed
 * stem raked up out of the water, a flat transom at the stern, a V bottom
 * breaking at a chine into the topsides, and a little sheer towards the bow.
 * Flat shaded. Returns the hull and the deck as separate primitives, for two
 * materials.
 */
function createBoatPrimitives(size) {
  const halfBeam = size.sizeX / 2;
  const height = size.sizeY;
  const length = size.sizeZ;
  const stations = 24;
  const smooth = (t) => t * t * (3 - 2 * t);
  // Station t from the transom (0) to the stem (1): its half beam, keel,
  // chine and gunwale heights
  const section = (t) => {
    const plan =
      t < 0.55 ? 0.82 + 0.18 * Math.sin((Math.PI / 2) * (t / 0.55)) : 1 - ((t - 0.55) / 0.45) ** 1.6;
    const hb = halfBeam * plan;
    const keel = -height / 2 + 0.55 * height * Math.max(0, (t - 0.6) / 0.4) ** 2;
    const gunwale = height / 2 - 0.12 * height + 0.12 * height * smooth(t);
    const chine = Math.min(keel + 0.22 * height, gunwale - 0.05);
    const z = -length / 2 + t * length;
    return {
      z,
      mid: (keel + gunwale) / 2,
      // Port gunwale, port chine, keel, starboard chine, starboard gunwale
      points: [
        [-hb, gunwale],
        [-0.88 * hb, chine],
        [0, keel],
        [0.88 * hb, chine],
        [hb, gunwale]
      ]
    };
  };
  const sections = [];
  for (let i = 0; i <= stations; i++) {
    sections.push(section(i / stations));
  }
  // Triangles turned so their normal points away from `outward`'s reference
  const build = () => ({ positions: [], normals: [], indices: [] });
  const hull = build();
  const deck = build();
  const addTriangle = (target, a, b, c, outward) => {
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const len = Math.hypot(n[0], n[1], n[2]);
    if (len < 1e-9) {
      return;
    }
    n = n.map((x) => x / len);
    const centroid = [0, 1, 2].map((k) => (a[k] + b[k] + c[k]) / 3);
    const out = outward(centroid);
    if (n[0] * out[0] + n[1] * out[1] + n[2] * out[2] < 0) {
      [b, c] = [c, b];
      n = n.map((x) => -x);
    }
    for (const p of [a, b, c]) {
      target.indices.push(target.positions.length / 3);
      target.positions.push(...p);
      target.normals.push(...n);
    }
  };
  // Away from the hull's axis at that height, in the cross-section's plane
  const radial = (p) => {
    const t = Math.min(1, Math.max(0, (p[2] + length / 2) / length));
    return [p[0], p[1] - section(t).mid, 0];
  };
  for (let i = 0; i < stations; i++) {
    const s0 = sections[i];
    const s1 = sections[i + 1];
    const at = (s, k) => [s.points[k][0], s.points[k][1], s.z];
    for (let k = 0; k < 4; k++) {
      addTriangle(hull, at(s0, k), at(s0, k + 1), at(s1, k + 1), radial);
      addTriangle(hull, at(s0, k), at(s1, k + 1), at(s1, k), radial);
    }
    addTriangle(deck, at(s0, 0), at(s0, 4), at(s1, 4), () => [0, 1, 0]);
    addTriangle(deck, at(s0, 0), at(s1, 4), at(s1, 0), () => [0, 1, 0]);
  }
  // The transom, a fan across the stern section
  const stern = sections[0];
  const sp = (k) => [stern.points[k][0], stern.points[k][1], stern.z];
  for (let k = 1; k < 4; k++) {
    addTriangle(hull, sp(0), sp(k), sp(k + 1), () => [0, 0, -1]);
  }
  const bounds = new BoundingBox(
    new Vector3(-halfBeam, -height / 2, -length / 2),
    new Vector3(halfBeam, height / 2, length / 2)
  );
  const toPrimitive = (data) => {
    const prim = new Primitive();
    prim.createAndSetVertexBuffer('position_f32x3', new Float32Array(data.positions));
    prim.createAndSetVertexBuffer('normal_f32x3', new Float32Array(data.normals));
    prim.createAndSetIndexBuffer(new Uint16Array(data.indices));
    prim.setBoundingVolume(bounds);
    prim.indexCount = data.indices.length;
    return prim;
  };
  return { hull: toPrimitive(hull), deck: toPrimitive(deck) };
}

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
  water.causticsRange = 90;
  water.causticsDepth = 3;
  water.causticsFadeDistance = 30;
  water.absorptionScale = 2.5;

  const waves = new FFTWaveGenerator();
  waves.wind = new Vector2(4, 2);
  waves.setWaveStrength(0, 0.4);
  waves.setWaveStrength(1, 0.01);
  waves.setWaveStrength(2, 0.01);
  waves.setWaveCroppiness(0, -3.5);
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
  //water.foamAmount = 0.3;
  water.foamFalloff = 0.8;

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

  // A boat that floats on the water and is driven from the keyboard: a hull
  // with a deck and a helm console on it
  const boatMaterial = new PBRMetallicRoughnessMaterial();
  boatMaterial.albedoColor = new Vector4(0.8, 0.3, 0.2, 1);
  boatMaterial.metallic = 0;
  boatMaterial.roughness = 0.6;
  const deckMaterial = new PBRMetallicRoughnessMaterial();
  deckMaterial.albedoColor = new Vector4(0.62, 0.48, 0.32, 1);
  deckMaterial.metallic = 0;
  deckMaterial.roughness = 0.8;
  const consoleMaterial = new PBRMetallicRoughnessMaterial();
  consoleMaterial.albedoColor = new Vector4(0.9, 0.9, 0.88, 1);
  consoleMaterial.metallic = 0;
  consoleMaterial.roughness = 0.4;
  const boatPrimitives = createBoatPrimitives(BOAT_SIZE);
  const boat = new Mesh(scene, boatPrimitives.hull, boatMaterial);
  boat.position.setXYZ(0, 0, -10);
  const boatDeck = new Mesh(scene, boatPrimitives.deck, deckMaterial);
  boatDeck.parent = boat;
  const helm = new Mesh(scene, new BoxShape({ sizeX: 0.8, sizeY: 0.4, sizeZ: 0.5 }), consoleMaterial);
  helm.parent = boat;
  helm.position.setXYZ(0, 0.55, -0.4);
  for (const part of [boat, boatDeck, helm]) {
    sun.shadow.shadowRegion.addDynamicCaster(part);
  }
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
