import { Quaternion, Vector3, Vector4 } from '@zephyr3d/base';
import {
  Scene,
  Application,
  OrbitCameraController,
  PerspectiveCamera,
  Mesh,
  DirectionalLight,
  SphereShape,
  CylinderShape,
  SSSMaterial,
  PBRMetallicRoughnessMaterial,
  getInput,
  getEngine
} from '@zephyr3d/scene';
import { backendWebGL2 } from '@zephyr3d/backend-webgl';
import { backendWebGPU } from '@zephyr3d/backend-webgpu';

// The screen-space diffusion runs on WebGPU only; WebGL2 still shades the
// material and its transmission. ?backend=webgl2 or ?backend=webgpu forces a backend.
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

// Built-in profile presets, each with a surface colour to go with it. A preset
// only decides how light travels under the surface; the colour of the surface
// is the material's albedo, so it is set separately.
const PRESETS = {
  skin: new Vector4(0.8, 0.55, 0.45, 1),
  skin_pale: new Vector4(0.88, 0.68, 0.6, 1),
  skin_tan: new Vector4(0.62, 0.4, 0.28, 1),
  skin_dark: new Vector4(0.3, 0.17, 0.11, 1),
  wax: new Vector4(0.85, 0.8, 0.62, 1),
  jade: new Vector4(0.3, 0.62, 0.42, 1),
  marble: new Vector4(0.88, 0.87, 0.85, 1)
};

// Values accepted by camera.SSSDebugOutput
const DEBUG_OUTPUTS = [
  'none',
  'diffusible',
  'diffuseAmount',
  'profileId',
  'normal',
  'diffusionDistance',
  'sampleRadius',
  'weight',
  'acceptance',
  'centerWeight',
  'diffused',
  'thickness'
];

myApp.ready().then(function () {
  const webgpu = myApp.device.type === 'webgpu';
  const scene = new Scene();
  // Dark studio: no sky, and a little ambient so the unlit side stays readable
  scene.env.sky.skyType = 'none';
  scene.env.sky.fogType = 'none';
  scene.env.light.type = 'constant';
  scene.env.light.ambientColor = new Vector4(0.04, 0.045, 0.05, 1);

  // Grazing key light from the left, so the terminator runs down the head.
  // A small PCF kernel keeps its shadow edges hard.
  const key = new DirectionalLight(scene);
  key.lookAt(new Vector3(-1, 0.35, 0.45), Vector3.zero(), Vector3.axisPY());
  key.color = new Vector4(1, 0.96, 0.9, 1);
  key.intensity = 4;
  key.castShadow = true;
  key.shadow.shadowMapSize = 2048;
  key.shadow.pcfKernelSize = 3;
  key.shadow.shadowDistance = 3;

  // A thin rod between the key light and the head. Its shadow puts a hard edge
  // across the lit side: a symmetric blur hardly changes a smooth terminator,
  // while a step edge shows the diffusion plainly.
  const rodMaterial = new PBRMetallicRoughnessMaterial();
  rodMaterial.albedoColor = new Vector4(0.25, 0.26, 0.3, 1);
  rodMaterial.metallic = 0;
  rodMaterial.roughness = 0.6;
  const rod = new Mesh(
    scene,
    new CylinderShape({ topRadius: 0.005, bottomRadius: 0.005, height: 0.5, anchor: 0.5 }),
    rodMaterial
  );
  rod.position.setXYZ(-0.156, 0, 0.133);

  // #region material
  // All sizes are in metres. Skin scatters over millimetres, so the effect only
  // reads on an object of sensible size: this "head" is 20 cm across.
  const sssMaterial = new SSSMaterial();
  sssMaterial.albedoColor = PRESETS.skin;
  // The material owns its profile: edit it in place, never assign a new one
  sssMaterial.subsurfaceProfile.preset = 'skin';
  const head = new Mesh(
    scene,
    new SphereShape({ radius: 0.1, horizonalDetail: 64, verticalDetail: 48 }),
    sssMaterial
  );
  // #endregion material

  // #region transmission
  // A disc 5 mm thick beside the head, standing in for an ear. The head hides
  // it from the key light, so what lights its front is the back light coming
  // through it.
  const ear = new Mesh(
    scene,
    new CylinderShape({
      topRadius: 0.035,
      bottomRadius: 0.035,
      height: 0.005,
      anchor: 0.5,
      radialDetail: 48
    }),
    sssMaterial
  );
  ear.position.setXYZ(0.16, -0.01, -0.03);
  ear.rotation = Quaternion.fromAxisAngle(Vector3.axisPX(), Math.PI / 2);

  // Back light. Transmission is opt-in per light, and the thickness it needs is
  // measured from the light's shadow map, so the light must cast shadows too.
  const back = new DirectionalLight(scene);
  back.lookAt(new Vector3(0.2, 0.15, -1), Vector3.zero(), Vector3.axisPY());
  back.intensity = 3;
  back.castShadow = true;
  back.transmission = true;
  back.shadow.shadowDistance = 3;
  // #endregion transmission

  // A plain PBR material of the same colour, for the A/B comparison
  const pbrMaterial = new PBRMetallicRoughnessMaterial();
  pbrMaterial.albedoColor = PRESETS.skin;
  pbrMaterial.metallic = 0;
  pbrMaterial.roughness = 0.5;

  // Camera close to the head; near plane, zoom and pan sized to a 30 cm scene
  const target = new Vector3(0.03, 0, 0);
  scene.mainCamera = new PerspectiveCamera(scene, Math.PI / 4, 0.01, 20);
  scene.mainCamera.lookAt(new Vector3(0.03, 0.03, 0.5), target, Vector3.axisPY());
  scene.mainCamera.controller = new OrbitCameraController({
    center: target,
    zoomSpeed: 0.05,
    panSpeed: 0.0005
  });

  getInput().use(scene.mainCamera.handleEvent, scene.mainCamera);

  // #region preset
  function setPreset(preset) {
    // The profile drives the scattering; the surface colour is still the albedo
    sssMaterial.subsurfaceProfile.preset = preset;
    sssMaterial.albedoColor = PRESETS[preset];
    pbrMaterial.albedoColor = PRESETS[preset];
  }
  // #endregion preset

  // #region debug
  function setDebugOutput(output) {
    scene.mainCamera.SSSDebugOutput = output;
    // Debug views show values, not colours: keep the tonemapper out of the way
    scene.mainCamera.toneMap = output === 'none';
  }
  // #endregion debug

  // #region toggle
  function setSubsurface(enabled) {
    // There is no switch for the diffusion pass: it runs whenever an opaque
    // SSSMaterial is drawn. Swapping the material is how it is turned off.
    head.material = enabled ? sssMaterial : pbrMaterial;
    ear.material = enabled ? sssMaterial : pbrMaterial;
  }
  // #endregion toggle

  // UI
  /** @type {HTMLInputElement} */
  const sssCheck = document.querySelector('#sss-check');
  /** @type {HTMLSelectElement} */
  const presetSelect = document.querySelector('#preset-select');
  /** @type {HTMLSelectElement} */
  const debugSelect = document.querySelector('#debug-select');
  /** @type {HTMLElement} */
  const note = document.querySelector('#backend-note');
  for (const preset of Object.keys(PRESETS)) {
    presetSelect.add(new Option(preset, preset));
  }
  for (const output of DEBUG_OUTPUTS) {
    debugSelect.add(new Option(output, output));
  }
  note.textContent = webgpu
    ? 'WebGPU: screen-space diffusion is on.'
    : 'WebGL2: no screen-space diffusion (WebGPU only). Shading and transmission still apply.';

  // Debug views only exist where the diffusion pass runs
  function updateDebugState() {
    debugSelect.disabled = !webgpu || !sssCheck.checked;
    if (debugSelect.disabled) {
      debugSelect.value = 'none';
    }
    setDebugOutput(debugSelect.value);
  }
  sssCheck.addEventListener('change', () => {
    setSubsurface(sssCheck.checked);
    updateDebugState();
  });
  presetSelect.addEventListener('change', () => setPreset(presetSelect.value));
  debugSelect.addEventListener('change', () => setDebugOutput(debugSelect.value));
  updateDebugState();

  getEngine().setRenderable(scene, 0);

  myApp.run();
});
