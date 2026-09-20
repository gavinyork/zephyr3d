import { Quaternion, Vector2, Vector3, Vector4 } from '@zephyr3d/base';
import {
  Scene,
  Application,
  OrbitCameraController,
  PerspectiveCamera,
  Mesh,
  DirectionalLight,
  BoxShape,
  PlaneShape,
  CylinderShape,
  SphereShape,
  PBRMetallicRoughnessMaterial,
  UnlitMaterial,
  Water,
  FFTWaveGenerator,
  WaterSurfaceSampler,
  FloatingBody,
  getInput,
  getEngine
} from '@zephyr3d/scene';
import { backendWebGL2 } from '@zephyr3d/backend-webgl';
import { backendWebGPU } from '@zephyr3d/backend-webgpu';

const params = new URLSearchParams(location.search);

//
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

const GRID = 7;
const SPACING = 24;
const BOX_SIZE = { sizeX: 8, sizeY: 8, sizeZ: 8 };

myApp.ready().then(function () {
  const { scene, water, markers } = buildScene();

  // A 15x15 lattice over 84 metres: fine enough that the interpolation error
  // across a cell stays well under the wave height, and small enough that a
  // batch is cheap. A larger lattice buys nothing - the query cost is dominated
  // by the frame it is issued on and the readback, not by the point count.
  //
  // The quarter-second ease only matters in the position-driven mode. Under
  // physics the sampler is a height field the buoyancy reads, and the body's
  // own mass and damping are what shape the motion.
  const sampler = new WaterSurfaceSampler(water, {
    spacing: 6,
    cols: 15,
    rows: 15,
    updateHz: 30,
    timeConstant: 0.25
  });

  // The lag probe and the exact dots both need the true surface under each
  // marker. Both go through the sampler's extra-points channel so they share the
  // one feedback render per batch; a second call to the water per frame is what
  // was flashing the screen black.
  const lagInputs = markers.map((m) => new Vector3(m.body.position.x, 0, m.body.position.z));
  sampler.addExtraPoints(lagInputs, (results, inputs) => {
    let maxAbove = -Infinity;
    let sumSq = 0;
    let samplerGap = 0;
    for (let i = 0; i < markers.length; i++) {
      const truth = results[i].y;
      const gap = markers[i].body.position.y - truth;
      maxAbove = Math.max(maxAbove, gap);
      sumSq += gap * gap;
      const sampled = sampler.sampleWorldYRaw(inputs[i].x, inputs[i].z);
      samplerGap = Math.max(samplerGap, Math.abs(sampled - truth));
      if (state.reference) {
        markers[i].reference.position.setXYZ(results[i].x, results[i].y, results[i].z);
      }
    }
    state.lag.maxAbove = maxAbove;
    state.lag.peakAbove = Math.max(state.lag.peakAbove, maxAbove);
    state.lag.rmsGap = Math.sqrt(sumSq / markers.length);
    state.lag.samplerGap = samplerGap;
  });

  // Handy from the console, and what the harness inspects: the sampler alone can
  // be compared against `water.getSurfacePoint` without reading the panel.
  globalThis.waterSampling = { water, sampler, markers, scene };

  const state = {
    /** @type {boolean} Drive the markers from the CPU sampler. */
    sampling: true,
    /**
     * End-to-end lag, measured rather than inferred.
     *
     * Every quarter second the markers' current XZ are put to the material's own
     * surface evaluation. The gap between each body's centre and that surface is
     * what the lag turns into on screen: positive is a body above the water it
     * should be sitting in, which is the airborne look. The peak is held with a
     * slow decay so a brief launch stays readable, and the sampler's height table
     * is compared to the same truth so the two sources of lag can be told apart.
     */
    lag: {
      /** @type {number} `sampler.readCount` the last time a batch was stamped. */
      seenReads: 0,
      /** @type {number} Device frame counter when the newest batch was accepted. */
      acceptFrame: 0,
      /** @type {boolean} An onSubmittedWorkDone probe is in flight. */
      gpuDonePending: false,
      /** @type {number} Frames the GPU trailed the CPU by, from the latest probe. */
      gpuDoneFrames: 0,
      /** @type {number} Worst body-above-true-surface gap in the latest probe, metres. */
      maxAbove: 0,
      /** @type {number} Same, held with decay. */
      peakAbove: 0,
      /** @type {number} RMS of body-vs-true-surface gap in the latest probe. */
      rmsGap: 0,
      /** @type {number} Worst |sampler table - true surface| in the latest probe. */
      samplerGap: 0
    },
    /** @type {boolean} Drive the markers by buoyancy rather than by easing to the surface. */
    physics: true,
    /** @type {boolean} Overlay the GPU-evaluated surface point, for checking the sampler. */
    reference: false
  };

  getEngine().setRenderable(scene, 0);

  const status = document.querySelector('#status');
  /** @type { HTMLInputElement } */
  const samplingCheck = document.querySelector('#sampling-check');
  /** @type { HTMLInputElement } */
  const physicsCheck = document.querySelector('#physics-check');
  /** @type { HTMLInputElement } */
  const referenceCheck = document.querySelector('#reference-check');
  /** @type { HTMLInputElement } */
  const speedInput = document.querySelector('#speed-input');
  /** @type { HTMLSpanElement } */
  const speedLabel = document.querySelector('#speed-label');
  /** @type { HTMLInputElement } */
  const rateInput = document.querySelector('#rate-input');
  /** @type { HTMLSpanElement } */
  const rateLabel = document.querySelector('#rate-label');
  /** @type { HTMLInputElement } */
  const easeInput = document.querySelector('#ease-input');
  /** @type { HTMLSpanElement } */
  const easeLabel = document.querySelector('#ease-label');
  /** @type { HTMLInputElement } */
  const inflightInput = document.querySelector('#inflight-input');
  /** @type { HTMLSpanElement } */
  const inflightLabel = document.querySelector('#inflight-label');

  // How far the CPU may run ahead of the GPU. This is where the readback's
  // latency comes from when the GPU is the bottleneck: the map only completes
  // once every frame queued ahead of it has finished, so a deep queue means a
  // late answer. 0 removes the bound and shows the browser's own behaviour.
  const applyInflight = () => {
    const n = Number(inflightInput.value);
    myApp.device.maxFramesInFlight = n;
    inflightLabel.textContent = n === 0 ? 'unbounded' : `${n} frame${n === 1 ? '' : 's'}`;
  };
  inflightInput.addEventListener('input', applyInflight);
  applyInflight();

  samplingCheck.addEventListener('change', function () {
    state.sampling = samplingCheck.checked;
    sampler.updateHz = samplingCheck.checked ? 30 : 0.1;
  });

  physicsCheck.addEventListener('change', function () {
    state.physics = physicsCheck.checked;
    // Switching modes re-seats every body at its rest height so the handover is
    // a still start rather than a fall from wherever the other mode left it.
    for (const marker of markers) {
      marker.body.reset(marker.node.position.x, marker.node.position.z, water.worldMatrix.m13, marker.yaw);
    }
  });
  physicsCheck.checked = state.physics;

  referenceCheck.addEventListener('change', function () {
    state.reference = referenceCheck.checked;
    for (const marker of markers) {
      marker.reference.showState = state.reference ? 'visible' : 'hidden';
    }
  });

  speedInput.addEventListener('input', function () {
    water.animationSpeed = Number(speedInput.value);
    speedLabel.textContent = water.animationSpeed.toFixed(2);
  });
  water.animationSpeed = Number(speedInput.value);
  speedLabel.textContent = water.animationSpeed.toFixed(2);

  rateInput.addEventListener('input', function () {
    sampler.updateHz = Number(rateInput.value);
    rateLabel.textContent = `${sampler.updateHz.toFixed(1)}Hz`;
  });
  rateLabel.textContent = `${sampler.updateHz.toFixed(1)}Hz`;
  easeInput.addEventListener('input', function () {
    sampler.timeConstant = Number(easeInput.value);
    easeLabel.textContent = `${sampler.timeConstant.toFixed(2)}s`;
  });
  easeLabel.textContent = `${sampler.timeConstant.toFixed(2)}s`;

  const cam = scene.mainCamera;
  const forwarder = function (ev, type) {
    return cam ? cam.handleEvent.call(cam, ev, type) : false;
  };
  getInput().use(forwarder);

  const tmpNormal = new Vector3();
  const tmpAxis = new Vector3();
  const tmpRotation = new Quaternion();
  const tmpTilt = new Quaternion();

  const waterLevel = water.worldMatrix.m13;
  // The buoyancy reads wave height above the still-water level; the sampler
  // reports world Y, so the level is subtracted back out.
  //
  // The RAW table, not the eased one. The ease is for the position-driven mode,
  // where the boxes have no inertia and need the height itself to move smoothly.
  // A rigid body has inertia, and reading the eased height put a second lag -
  // about a quarter second at this swell - on top of the query's own. That lag
  // is what held the boxes in the air after a crest had already fallen away.
  const waveHeightAt = (x, z) => sampler.sampleWorldYRaw(x, z) - waterLevel;

  myApp.on('tick', function (deltaMs) {
    const delta = Math.min(0.1, deltaMs / 1000);
    sampler.update(delta);

    if (state.physics && state.sampling) {
      for (const marker of markers) {
        marker.body.update(delta, waveHeightAt, waterLevel);
      }
    } else {
      for (const marker of markers) {
        const p = marker.node.position;
        sampler.sampleNormal(p.x, p.z, tmpNormal);
        if (state.sampling) {
          p.y = sampler.sampleWorldY(p.x, p.z);
        } else {
          // With sampling off nothing lifts the markers, so they sit at the
          // still-water level and the wave visibly runs through them.
          p.y = water.worldMatrix.m13;
          tmpNormal.setXYZ(0, 1, 0);
        }
        // The box's own yaw first, then a small step towards the surface normal.
        // Rebuilt from the yaw each frame rather than accumulated onto the previous
        // rotation: accumulating would let the tilt compound and slowly roll the
        // box over, and it would make the yaw drift with it.
        //
        // The tilt is capped per frame because the normal off a coarse lattice is
        // noisy, and a box that follows it exactly reads as twitching rather than
        // as riding a swell.
        Quaternion.fromEulerAngle(0, marker.yaw, 0, 'ZYX', tmpRotation);
        const cos = Math.min(1, Math.max(-1, Vector3.dot(Vector3.axisPY(), tmpNormal)));
        const angle = Math.acos(cos);
        if (angle > 1e-6) {
          Vector3.cross(Vector3.axisPY(), tmpNormal, tmpAxis);
          tmpTilt.fromAxisAngle(tmpAxis, Math.min(Math.PI * 0.002, angle));
          Quaternion.multiply(tmpTilt, tmpRotation, tmpRotation);
        }
        marker.node.rotation = tmpRotation;
      }
    }

    // The peak decays a little each frame so it reads as "recent worst" rather
    // than "worst ever"; roughly two seconds to fall away.
    state.lag.peakAbove *= Math.exp(-delta / 2);
    // Keep the lag probe's query positions on the bodies. They ride along in
    // the sampler's own batch, so there is no second feedback render.
    for (let i = 0; i < markers.length; i++) {
      lagInputs[i].setXYZ(markers[i].body.position.x, 0, markers[i].body.position.z);
    }

    // The accepted stage is stamped here, in the tick, with the device's own
    // frame counter so it is on the same scale as the stages Water records.
    if (sampler.readCount !== state.lag.seenReads) {
      state.lag.seenReads = sampler.readCount;
      state.lag.acceptFrame = myApp.device.frameInfo.frameCounter;
    }
    const t = water.lastFeedbackTiming;
    status.textContent =
      `waveTime ${water.waveTime.toFixed(2)}s  speed ${water.animationSpeed.toFixed(2)}\n` +
      `queries ${sampler.readCount}  failed ${sampler.failCount}  ` +
      `${sampler.ready ? 'sampling' : 'waiting for first batch'}\n` +
      `${sampler.spacing}m lattice  ${sampler.batchSize} points/batch\n` +
      `batch ${(sampler.pending ? sampler.pendingSeconds : sampler.lastLatency).toFixed(3)}s / ` +
      `${sampler.batchFrames} frames  ease ${sampler.timeConstant.toFixed(2)}s  ` +
      `fps ${myApp.device.frameInfo.FPS.toFixed(0)}  ` +
      `gpu ${myApp.device.frameInfo.elapsedTimeGPU.toFixed(1)}ms/frame  ` +
      `gpu done +${state.lag.gpuDoneFrames} frames after submit
` +
      `stages (frames after issue): recorded +${t.recorded - t.issued}  ` +
      `readback +${t.mapped - t.issued}  accepted +${state.lag.acceptFrame - t.issued}
` +
      `body above true surface: now ${state.lag.maxAbove.toFixed(3)}m  ` +
      `peak ${state.lag.peakAbove.toFixed(3)}m  rms ${state.lag.rmsGap.toFixed(3)}m
` +
      `sampler table vs true surface: ${state.lag.samplerGap.toFixed(3)}m`;
  });

  myApp.run();
});

/**
 * Query each marker's own position directly and park a dot on the answer.
 *
 * Both this and the batch the sampler runs go through the same evaluation, so
 * the difference between them is not one of correctness - it is the price of the
 * lattice. The dots are exact and current; the boxes are interpolated across a
 * six-metre lattice and lag by the query interval. Where they visibly separate is
 * where the lattice is too coarse or the query rate too low for the motion.
 */
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
  bed.position.setXYZ(0, -20, 0);

  const water = new Water(scene);
  water.scale.setXYZ(1, 1, 1);
  water.position.setXYZ(0, 0, 0);
  water.gridScale = 1;
  water.animationSpeed = 1;
  water.infinite = false;
  water.scale.setXYZ(1000, 1, 1000);
  //
  const waves = new FFTWaveGenerator();
  waves.wind = new Vector2(12, 0);
  waves.setWaveLength(0, 400);
  waves.setWaveLength(1, 100);
  waves.setWaveLength(2, 16);
  waves.setWaveStrength(0, 1.2);
  waves.setWaveStrength(1, 0.8);
  waves.setWaveStrength(2, 0.9);
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

  // Markers are placed on a lattice centred on the water's own origin, which is
  // also where the reading is taken: the sampler is handed world positions, not
  // water-local ones, so the lattice has to be built in world space too.
  const markerMaterial = new PBRMetallicRoughnessMaterial();
  markerMaterial.albedoColor = new Vector4(0.25, 0.75, 0.4, 1);
  markerMaterial.metallic = 0;
  markerMaterial.roughness = 0.5;

  // Unlit, and small enough to sit inside the marker box: the cross-check reads
  // as "is the dot inside the box", and a shaded sphere the size of the box
  // would hide the answer at exactly the angles where it matters.
  const referenceMaterial = new UnlitMaterial();
  referenceMaterial.albedoColor = new Vector4(1, 0.25, 0.2, 1);

  const markers = [];
  const half = (GRID - 1) / 2;
  for (let iz = 0; iz < GRID; iz++) {
    for (let ix = 0; ix < GRID; ix++) {
      const x = (ix - half) * SPACING;
      const z = (iz - half) * SPACING;
      const node = new Mesh(scene, new BoxShape(BOX_SIZE), markerMaterial);
      node.position.setXYZ(x, 0, z);
      const reference = new Mesh(scene, new SphereShape({ radius: 0.22 }), referenceMaterial);
      reference.position.setXYZ(x, 0, z);
      reference.showState = 'hidden';
      const yaw = (ix + iz) * 0.3;
      // Half submerged at rest, mass derived to match. A 3x3x3 lattice of probes
      // is enough to give a box this size a righting moment that feels right;
      // more only costs.
      const body = new FloatingBody({
        node,
        size: new Vector3(BOX_SIZE.sizeX, BOX_SIZE.sizeY, BOX_SIZE.sizeZ),
        submergedFraction: 0.1,
        probeColumns: 3,
        probeRows: 3,
        probeLayers: 3
      });
      body.reset(x, z, water.position.y, yaw);
      markers.push({ node, reference, yaw, body });
    }
  }

  // A pole marking the lattice centre, so the eye has a fixed reference for how
  // far the markers rise and fall.
  const poleMaterial = new PBRMetallicRoughnessMaterial();
  poleMaterial.albedoColor = new Vector4(0.8, 0.8, 0.85, 1);
  poleMaterial.metallic = 0;
  poleMaterial.roughness = 0.8;
  const pole = new Mesh(
    scene,
    new CylinderShape({ topRadius: 0.12, bottomRadius: 0.12, height: 22 }),
    poleMaterial
  );
  pole.position.setXYZ(0, -11, 0);

  scene.mainCamera = new PerspectiveCamera(scene, Math.PI / 3, 0.1, 2000);
  scene.mainCamera.lookAt(new Vector3(0, 12, 34), new Vector3(0, 1, 0), Vector3.axisPY());
  scene.mainCamera.controller = new OrbitCameraController();
  scene.mainCamera.TAA = true;

  return { scene, water, markers };
}
