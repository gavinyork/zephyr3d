import { Vector3, Vector4 } from '@zephyr3d/base';
import {
  Scene,
  Application,
  OrbitCameraController,
  PerspectiveCamera,
  DirectionalLight,
  Mesh,
  PlaneShape,
  CylinderShape,
  SphereShape,
  PBRMetallicRoughnessMaterial,
  UnlitMaterial,
  ParticleSystem,
  Sprite,
  StandardSpriteMaterial,
  getInput,
  getEngine,
  getDevice
} from '@zephyr3d/scene';
import { backendWebGL2 } from '@zephyr3d/backend-webgl';
import { backendWebGPU } from '@zephyr3d/backend-webgpu';

// Everything here runs on both backends; WebGPU is used when available.
// ?backend=webgl2 or ?backend=webgpu forces a backend.
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

// Particle shape: a soft round blob. ParticleMaterial reads only the red channel
// of the alpha map, as coverage, so the bytes are plain data in a linear format.
function createAlphaMap(size) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = ((x + 0.5) / size) * 2 - 1;
      const dy = ((y + 0.5) / size) * 2 - 1;
      const t = Math.max(0, 1 - (dx * dx + dy * dy));
      const value = Math.round(t * t * 255);
      const i = (y * size + x) * 4;
      data[i] = value;
      data[i + 1] = value;
      data[i + 2] = value;
      data[i + 3] = value;
    }
  }
  const tex = getDevice().createTexture2D('rgba8unorm', size, size);
  tex.update(data, 0, 0, size, size);
  return tex;
}

// Colour and opacity over a particle's life: [age, r, g, b, alpha], with the
// colour as sRGB bytes and alpha linear. Hot and bright at birth, smoke at the end.
const RAMP_KEYS = [
  [0, 255, 250, 220, 0],
  [0.06, 255, 236, 160, 1],
  [0.25, 255, 140, 40, 1],
  [0.5, 190, 40, 20, 0.85],
  [0.7, 70, 66, 70, 0.6],
  [1, 60, 60, 66, 0]
];

// The ramp is sampled along U at the particle's normalized age (0 at birth, 1 at death)
function createRampMap(width) {
  const data = new Uint8Array(width * 4);
  for (let x = 0; x < width; x++) {
    const age = x / (width - 1);
    let k = 1;
    while (k < RAMP_KEYS.length - 1 && RAMP_KEYS[k][0] < age) {
      k++;
    }
    const a = RAMP_KEYS[k - 1];
    const b = RAMP_KEYS[k];
    const f = (age - a[0]) / (b[0] - a[0]);
    for (let c = 1; c <= 3; c++) {
      data[x * 4 + c - 1] = Math.round(a[c] + (b[c] - a[c]) * f);
    }
    data[x * 4 + 3] = Math.round((a[4] + (b[4] - a[4]) * f) * 255);
  }
  // An sRGB format: sampling hands the shader linear colours, alpha is left as is
  const tex = getDevice().createTexture2D('rgba8unorm-srgb', width, 1, { mipmapping: false });
  tex.update(data, 0, 0, width, 1);
  return tex;
}

// A map pin: round head, pointed tip at the bottom centre of its atlas cell
function drawPin(ctx, x0, y0, cell, color, label) {
  const cx = x0 + cell / 2;
  const cy = y0 + 48;
  const r = 36;
  const tipY = y0 + cell - 4;
  // The two sides of the pin are tangent to the head
  const a = Math.acos(r / (tipY - cy));
  ctx.beginPath();
  ctx.moveTo(cx, tipY);
  ctx.arc(cx, cy, r, Math.PI / 2 + a, Math.PI / 2 - a);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.fillText(label, cx, cy + 2);
}

function drawStar(ctx, x0, y0, cell) {
  const cx = x0 + cell / 2;
  const cy = y0 + cell / 2;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? 54 : 23;
    const angle = -Math.PI / 2 + (i * Math.PI) / 5;
    ctx.lineTo(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r);
  }
  ctx.closePath();
  ctx.fillStyle = '#ffd43b';
  ctx.fill();
  ctx.stroke();
}

// Sprite icons: three map pins and a star in a 2 x 2 atlas, drawn with the canvas API
function createIconAtlas() {
  const cell = 128;
  const canvas = document.createElement('canvas');
  canvas.width = cell * 2;
  canvas.height = cell * 2;
  const ctx = canvas.getContext('2d');
  ctx.lineWidth = 6;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#0d1118';
  ctx.font = 'bold 44px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  drawPin(ctx, 0, 0, cell, '#3d8bfd', '1');
  drawPin(ctx, cell, 0, cell, '#f76707', '2');
  drawPin(ctx, 0, cell, cell, '#12b886', '3');
  drawStar(ctx, cell, cell, cell);
  // The icons are colours, so the texture is created as sRGB
  return getDevice().createTexture2DFromImage(canvas, true);
}

// #region uv
// Shows one cell of the 2 x 2 atlas (row 0 is the top of the image).
// setUVInfo() takes left, bottom, right, top, with V counted up from the bottom edge.
function useAtlasCell(material, col, row) {
  material.setUVInfo(col * 0.5, 0.5 - row * 0.5, col * 0.5 + 0.5, 1 - row * 0.5);
}
// #endregion uv

myApp.ready().then(function () {
  const scene = new Scene();
  // A dark backdrop, so additive particles have something to brighten
  scene.env.sky.skyType = 'none';
  scene.env.sky.fogType = 'none';
  scene.env.sky.skyColor = new Vector4(0.03, 0.04, 0.06, 1);
  scene.env.light.type = 'constant';
  scene.env.light.ambientColor = new Vector4(0.12, 0.13, 0.16, 1);

  const light = new DirectionalLight(scene);
  light.lookAt(new Vector3(3, 6, 4), Vector3.zero(), Vector3.axisPY());
  light.intensity = 0.8;

  const groundMaterial = new PBRMetallicRoughnessMaterial();
  groundMaterial.albedoColor = new Vector4(0.22, 0.23, 0.26, 1);
  groundMaterial.metallic = 0;
  groundMaterial.roughness = 0.9;
  new Mesh(scene, new PlaneShape({ size: 16 }), groundMaterial);

  const postMaterial = new PBRMetallicRoughnessMaterial();
  postMaterial.albedoColor = new Vector4(0.6, 0.6, 0.62, 1);
  postMaterial.metallic = 0;
  postMaterial.roughness = 0.6;
  const postShape = new CylinderShape({ topRadius: 0.05, bottomRadius: 0.05, height: 1.2 });

  // #region sprite
  const atlas = createIconAtlas();
  for (let i = 0; i < 3; i++) {
    const angle = (i / 3) * Math.PI * 2 + Math.PI / 2;
    const x = Math.cos(angle) * 4;
    const z = Math.sin(angle) * 4;
    new Mesh(scene, postShape, postMaterial).position.setXYZ(x, 0, z);

    const pinMaterial = new StandardSpriteMaterial();
    pinMaterial.spriteTexture = atlas;
    // The icons have transparent surroundings; the default blend mode 'none' draws them opaque
    pinMaterial.blendMode = 'blend';
    useAtlasCell(pinMaterial, i % 2, i >> 1);
    const pin = new Sprite(scene, pinMaterial);
    // Pivot at the bottom centre, so the tip of the pin sits on top of the post
    pin.anchorX = 0.5;
    pin.anchorY = 0;
    pin.position.setXYZ(x, 1.2, z);
    // A sprite is a 1 x 1 quad: X and Y scale are its width and height in world units
    pin.scale.setXYZ(0.6, 0.6, 1);
  }

  // Same texture, another cell; spun in its billboard plane in the tick handler below
  const starMaterial = new StandardSpriteMaterial();
  starMaterial.spriteTexture = atlas;
  starMaterial.blendMode = 'blend';
  useAtlasCell(starMaterial, 1, 1);
  const star = new Sprite(scene, starMaterial);
  star.position.setXYZ(0, 3.2, 0);
  star.scale.setXYZ(0.5, 0.5, 1);
  // #endregion sprite

  // #region particles
  const particles = new ParticleSystem(scene);
  // Sizes the instance buffer: room for the continuous flow plus a burst
  particles.maxParticleCount = 800;
  // 6 particles every 40 ms, i.e. 150 per second
  particles.emitInterval = 40;
  particles.emitCount = 6;
  particles.emitterShape = 'sphere';
  particles.emitterBehavior = 'surface';
  particles.emitterShapeSizeMin = new Vector3(0.6, 0.6, 0.6);
  particles.emitterShapeSizeMax = new Vector3(0.6, 0.6, 0.6);
  // Spread of the launch direction around +Y, used by point, box and cylinder
  particles.emitterConeRadiusMax = 0.4;
  // Lifetime in seconds
  particles.particleLifeMin = 1.4;
  particles.particleLifeMax = 2.2;
  particles.particleVelocityMin = 1;
  particles.particleVelocityMax = 1.8;
  // Born small and bright, grows into smoke
  particles.particleSize1Min = 0.12;
  particles.particleSize1Max = 0.2;
  particles.particleSize2Min = 0.5;
  particles.particleSize2Max = 0.8;
  // With airResistence on, velocities ease towards the wind: the plume rises and drifts along +X
  particles.airResistence = true;
  particles.wind = new Vector3(0.6, 1.4, 0);
  // #endregion particles

  // #region material
  const material = particles.material;
  material.alphaMap = createAlphaMap(64);
  material.rampMap = createRampMap(64);
  material.blendMode = 'additive';
  // Particles wobble sideways by up to this distance, at jitterSpeed radians per second
  material.jitterPower = 0.05;
  // #endregion material

  // A small bright ball marks the emitter; as a child node it travels with it
  const markerMaterial = new UnlitMaterial();
  markerMaterial.albedoColor = new Vector4(1, 0.85, 0.5, 1);
  const marker = new Mesh(scene, new SphereShape({ radius: 0.06 }), markerMaterial);
  marker.parent = particles;

  scene.mainCamera = new PerspectiveCamera(scene, Math.PI / 3, 0.1, 200);
  scene.mainCamera.lookAt(new Vector3(0, 4.5, 9.5), new Vector3(0, 1.2, 0), Vector3.axisPY());
  scene.mainCamera.controller = new OrbitCameraController({ center: new Vector3(0, 1.2, 0) });
  getInput().use(scene.mainCamera.handleEvent, scene.mainCamera);

  // #region motion
  myApp.on('tick', function (_deltaMs, elapsedMs) {
    const t = elapsedMs * 0.001;
    // The emitter circles the centre. In world space the particles stay where they
    // were emitted and leave a trail; in local space the whole plume follows it.
    particles.position.setXYZ(Math.cos(t * 0.8) * 2.5, 0.8, Math.sin(t * 0.8) * 2.5);
    // A sprite turns in its billboard plane with the node's rotation around Z
    star.rotation.fromEulerAngle(0, 0, t * 1.5);
  });
  // #endregion motion

  /** @type {HTMLSelectElement} */
  const shapeSelect = document.querySelector('#shape-select');
  shapeSelect.value = particles.emitterShape;
  shapeSelect.addEventListener('change', function () {
    particles.emitterShape = shapeSelect.value;
  });
  /** @type {HTMLSelectElement} */
  const behaviorSelect = document.querySelector('#behavior-select');
  behaviorSelect.value = particles.emitterBehavior;
  behaviorSelect.addEventListener('change', function () {
    particles.emitterBehavior = behaviorSelect.value;
  });
  /** @type {HTMLSelectElement} */
  const blendSelect = document.querySelector('#blend-select');
  blendSelect.value = material.blendMode;
  blendSelect.addEventListener('change', function () {
    material.blendMode = blendSelect.value;
  });

  // #region worldspace
  /** @type {HTMLInputElement} */
  const worldCheck = document.querySelector('#world-check');
  worldCheck.addEventListener('change', function () {
    // Also applies to the particles already alive: their stored positions are
    // reinterpreted, not converted, so they jump until they expire
    particles.worldSpace = worldCheck.checked;
  });
  // #endregion worldspace

  // #region burst
  /** @type {HTMLInputElement} */
  const continuousCheck = document.querySelector('#continuous-check');
  continuousCheck.addEventListener('change', function () {
    // emitCount 0 stops the timed emission; bursts still work
    particles.emitCount = continuousCheck.checked ? 6 : 0;
  });
  /** @type {HTMLButtonElement} */
  const burstButton = document.querySelector('#burst-button');
  burstButton.addEventListener('click', function () {
    // Emits at once from the emitter's current transform; whatever exceeds
    // maxParticleCount is dropped
    particles.newParticle(200, particles.worldMatrix);
  });
  // #endregion burst

  // #region oit
  /** @type {HTMLInputElement} */
  const oitCheck = document.querySelector('#oit-check');
  oitCheck.addEventListener('change', function () {
    // Weighted blended OIT needs no sorting, but composites additive particles like blended ones
    scene.mainCamera.oitMode = oitCheck.checked ? 'weighted' : 'none';
  });
  // #endregion oit

  getEngine().setRenderable(scene, 0);

  myApp.run();
});
