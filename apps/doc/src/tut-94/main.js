import { HttpFS, Vector3, Vector4 } from '@zephyr3d/base';
import {
  Scene,
  Application,
  DirectionalLight,
  getInput,
  getEngine,
  PerspectiveCamera,
  OrbitCameraController
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
  canvas: document.querySelector('#my-canvas'),
  runtimeOptions: {
    VFS: new HttpFS('https://cdn.zephyr3d.org/misc/LeePerrySmith/')
  }
});

// Built-in profile presets, each with a surface colour to go with it. A preset
// only decides how light travels under the surface; the colour of the surface
// is the material's albedo, so it is set separately.
const PRESETS = {
  skin: new Vector4(1, 1, 1, 1),
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
  //key.color = new Vector4(1, 0.96, 0.9, 1);
  key.intensity = 2;
  key.castShadow = true;
  key.shadow.shadowMapSize = 2048;
  key.shadow.pcfKernelSize = 3;
  key.shadow.shadowDistance = 3;

  // Back light. Transmission is opt-in per light, and the thickness it needs is
  // measured from the light's shadow map, so the light must cast shadows too.
  const back = new DirectionalLight(scene);
  back.lookAt(new Vector3(0, 0, -1), Vector3.zero(), Vector3.axisPY());
  back.intensity = 3;
  back.castShadow = true;
  back.transmission = true;
  back.shadow.shadowDistance = 100;
  // #endregion transmission

  /** @type {import('@zephyr3d/scene').SSSMaterial} */
  let sssMaterial = null;
  getEngine()
    .resourceManager.instantiatePrefab(scene.rootNode, '/assets/LeePerrySmith.zprefab')
    .then((node) => {
      /** @type {import('@zephyr3d/scene').Mesh} */
      const mesh = node.findNodeByName('LeePerrySmithMesh');
      key.shadow.shadowRegion.addStaticCaster(mesh);
      back.shadow.shadowRegion.addStaticCaster(mesh);
      sssMaterial = /** @type {import('@zephyr3d/scene').SSSMaterial} */ (mesh.material);
      setPreset('skin');
      /** @type {HTMLDivElement} */ (document.querySelector('#ui')).style.display = 'block';
      // UI
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
        debugSelect.disabled = !webgpu;
        if (debugSelect.disabled) {
          debugSelect.value = 'none';
        }
        setDebugOutput(debugSelect.value);
      }
      presetSelect.addEventListener('change', () => setPreset(presetSelect.value));
      debugSelect.addEventListener('change', () => setDebugOutput(debugSelect.value));
      updateDebugState();
    });

  const target = new Vector3(0.03, 0, 0);
  scene.mainCamera = new PerspectiveCamera(scene, Math.PI / 4, 0.01, 20);
  scene.mainCamera.FXAA = true;
  scene.mainCamera.position.setXYZ(-1.3, 2, 11);
  scene.mainCamera.lookAt(new Vector3(-1.3, 2, 10), target, Vector3.axisPY());
  scene.mainCamera.controller = new OrbitCameraController({
    center: target,
    zoomSpeed: 0.2,
    panSpeed: 0.01
  });
  getInput().use(scene.mainCamera.handleEvent, scene.mainCamera);

  // #region preset
  function setPreset(preset) {
    // The profile drives the scattering; the surface colour is still the albedo
    // #region material
    // All sizes are in metres. Skin scatters over millimetres, so the effect only
    // reads on an object of sensible size: this "head" is 20 cm across.
    // The material owns its profile: edit it in place, never assign a new one
    sssMaterial.subsurfaceProfile.preset = preset;
    sssMaterial.subsurfaceProfile.worldUnitScale = 10;
    sssMaterial.albedoColor = PRESETS[preset];
    // #endregion material
  }
  // #endregion preset

  // #region debug
  function setDebugOutput(output) {
    scene.mainCamera.SSSDebugOutput = output;
    // Debug views show values, not colours: keep the tonemapper out of the way
    scene.mainCamera.toneMap = output === 'none';
  }
  // #endregion debug

  getEngine().setRenderable(scene, 0);

  myApp.run();
});
