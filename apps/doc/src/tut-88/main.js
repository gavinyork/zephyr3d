import { Vector3, Vector4 } from '@zephyr3d/base';
import {
  Scene,
  Application,
  OrbitCameraController,
  PerspectiveCamera,
  PBRMetallicRoughnessMaterial,
  Mesh,
  PointLight,
  BoxShape,
  getInput,
  getEngine
} from '@zephyr3d/scene';
import { backendWebGL2 } from '@zephyr3d/backend-webgl';
import { backendWebGPU } from '@zephyr3d/backend-webgpu';

// DDGI needs WebGPU; ?backend=webgl2 or ?backend=webgpu forces a backend.
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
  const scene = new Scene();
  // Light only comes from the ceiling light and its bounces
  scene.env.light.type = 'none';
  scene.env.sky.skyType = 'none';

  // Cornell box, 5 m inside with 0.2 m walls; every part is the same unit box scaled
  const box = new BoxShape({ size: 1 });
  function createMaterial(r, g, b) {
    const material = new PBRMetallicRoughnessMaterial();
    material.albedoColor = new Vector4(r, g, b, 1);
    material.metallic = 0;
    material.roughness = 0.9;
    return material;
  }
  const white = createMaterial(0.73, 0.73, 0.73);
  const red = createMaterial(0.63, 0.065, 0.05);
  const green = createMaterial(0.14, 0.45, 0.091);
  function createBlock(material, position, scale, angle = 0) {
    const mesh = new Mesh(scene, box, material);
    mesh.position.set(position);
    mesh.scale.set(scale);
    mesh.rotation.fromEulerAngle(0, angle, 0);
    mesh.castShadow = true;
    return mesh;
  }
  createBlock(white, new Vector3(0, -0.1, 0), new Vector3(5.4, 0.2, 5.4)); // floor
  createBlock(white, new Vector3(0, 5.1, 0), new Vector3(5.4, 0.2, 5.4)); // ceiling
  createBlock(white, new Vector3(0, 2.5, -2.6), new Vector3(5.4, 5.4, 0.2)); // back wall
  createBlock(red, new Vector3(-2.6, 2.5, 0), new Vector3(0.2, 5.4, 5.4)); // left wall
  createBlock(green, new Vector3(2.6, 2.5, 0), new Vector3(0.2, 5.4, 5.4)); // right wall
  createBlock(white, new Vector3(-0.9, 1.5, -0.8), new Vector3(1.5, 3, 1.5), 0.3); // tall block
  createBlock(white, new Vector3(0.9, 0.75, 0.8), new Vector3(1.5, 1.5, 1.5), -0.3); // short block

  // Ceiling light
  const light = new PointLight(scene);
  light.position.setXYZ(0, 4.59, 0);
  light.range = 12;
  light.intensity = 15;
  light.color = new Vector4(1, 0.92, 0.8, 1);
  light.castShadow = true;
  light.shadow.depthBias = 0.01;
  light.shadow.normalBias = 1.5;

  const webgpu = myApp.device.type === 'webgpu';
  if (webgpu) {
    // Code-built shapes have no baked field asset, so bake the shared box once at run time
    scene.sdf.enabled = true;
    scene.sdf.bakeField(box).catch((err) => console.error(`Cannot bake a distance field: ${err}`));
    // DDGI, with probes every 0.5 m to resolve the 0.2 m walls
    scene.gi.enabled = true;
    scene.gi.probeSpacing = 0.5;
  }

  scene.mainCamera = new PerspectiveCamera(scene, Math.PI / 3, 0.1, 100);
  scene.mainCamera.lookAt(new Vector3(-0.6, 3.2, 8), new Vector3(0, 2.5, 0), Vector3.axisPY());
  scene.mainCamera.controller = new OrbitCameraController({ center: new Vector3(0, 2.5, 0) });
  // TAA smooths the probe interpolation
  scene.mainCamera.TAA = true;
  getInput().use(scene.mainCamera.handleEvent, scene.mainCamera);

  // Toggle the GI contribution through the UI buttons
  const btnOff = document.querySelector('#btn-off');
  const btnOn = document.querySelector('#btn-on');
  if (!webgpu) {
    btnOn.disabled = true;
    btnOn.title = 'DDGI requires WebGPU';
    document.querySelector('#notice').hidden = false;
  }

  function setGI(enabled) {
    // Keep the probes running and only scale their light, so switching back is instant
    scene.gi.intensity = enabled ? 1 : 0;
    btnOff.classList.toggle('active', !enabled);
    btnOn.classList.toggle('active', enabled);
    btnOff.setAttribute('aria-pressed', String(!enabled));
    btnOn.setAttribute('aria-pressed', String(enabled));
  }

  btnOff.addEventListener('click', () => setGI(false));
  btnOn.addEventListener('click', () => setGI(true));
  setGI(webgpu);

  getEngine().setRenderable(scene, 0);

  myApp.run();
});
