import { Interpolator, Vector3, Vector4 } from '@zephyr3d/base';
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
  ParticleEmitter,
  ParticleGradient,
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

// The keys as curves over the normalized age (0 at birth, 1 at death). The emitter
// multiplies its colours in linear space, so the sRGB bytes are converted first.
function createGradient(keys) {
  const ages = new Float32Array(keys.map((k) => k[0]));
  const toLinear = (byte) => Math.pow(byte / 255, 2.2);
  const rgb = new Float32Array(keys.flatMap((k) => [toLinear(k[1]), toLinear(k[2]), toLinear(k[3])]));
  const alpha = new Float32Array(keys.map((k) => k[4]));
  return new ParticleGradient(
    new Interpolator('linear', 'vec3', ages, rgb),
    new Interpolator('linear', 'number', ages, alpha)
  );
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
  const particles = new ParticleEmitter(scene);
  // Most particles alive at once: room for the continuous flow plus a burst
  particles.maxParticles = 800;
  // Particles per second, whatever the frame rate
  particles.emission.rate = 150;
  particles.shape.type = 'sphere';
  particles.shape.radius = 0.6;
  // 0: born on the surface of the shape, 1: anywhere inside it
  particles.shape.thickness = 0;
  // Spread around +Y in radians, used by point, box and edge
  particles.shape.angle = 0.4;
  // Lifetime in seconds, speed and size, each picked per particle in its range
  particles.start.lifetime.set(1.4, 2.2);
  particles.start.speed.set(1, 1.8);
  particles.start.size.set(0.12, 0.2);
  // Born small and bright, grows into smoke: factors over the normalized age
  particles.overLife.size = new Interpolator(
    'linear',
    'number',
    new Float32Array([0, 1]),
    new Float32Array([1, 4])
  );
  particles.overLife.color = createGradient(RAMP_KEYS);
  // Drag eases the velocities towards the air's: the plume rises and drifts along +X
  particles.forces.drag = 1;
  particles.forces.airVelocity.setXYZ(0.6, 1.4, 0);
  // #endregion particles

  // #region material
  // A ParticleSpriteMaterial; without a texture each particle is a soft round dot
  const material = particles.material;
  material.blendMode = 'additive';
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
  shapeSelect.value = particles.shape.type;
  shapeSelect.addEventListener('change', function () {
    particles.shape.type = /** @type {import('@zephyr3d/scene').ParticleShapeType} */ (shapeSelect.value);
  });
  /** @type {HTMLSelectElement} */
  const behaviorSelect = document.querySelector('#behavior-select');
  behaviorSelect.addEventListener('change', function () {
    particles.shape.thickness = behaviorSelect.value === 'surface' ? 0 : 1;
  });
  /** @type {HTMLSelectElement} */
  const blendSelect = document.querySelector('#blend-select');
  blendSelect.value = material.blendMode;
  blendSelect.addEventListener('change', function () {
    material.blendMode = /** @type {import('@zephyr3d/scene').BlendMode} */ (blendSelect.value);
  });

  // #region worldspace
  /** @type {HTMLInputElement} */
  const worldCheck = document.querySelector('#world-check');
  worldCheck.addEventListener('change', function () {
    // Changing the space clears the particles alive
    particles.space = worldCheck.checked ? 'world' : 'local';
  });
  // #endregion worldspace

  // #region burst
  /** @type {HTMLInputElement} */
  const continuousCheck = document.querySelector('#continuous-check');
  continuousCheck.addEventListener('change', function () {
    // A rate of 0 stops the continuous emission; bursts still work
    particles.emission.rate = continuousCheck.checked ? 150 : 0;
  });
  /** @type {HTMLButtonElement} */
  const burstButton = document.querySelector('#burst-button');
  burstButton.addEventListener('click', function () {
    // Born at the next step, where the emitter is then; whatever exceeds
    // maxParticles is dropped
    particles.emit(200);
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
