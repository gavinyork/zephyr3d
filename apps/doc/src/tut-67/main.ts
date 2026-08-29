import { Vector3, Vector4 } from '@zephyr3d/base';
import {
  Scene,
  Application,
  OrbitCameraController,
  PerspectiveCamera,
  Mesh,
  DirectionalLight,
  SphereShape,
  TorusShape,
  PlaneShape,
  PBRMetallicRoughnessMaterial,
  WeightedBlendedOIT,
  ABufferOIT,
  DualDepthPeelingOIT,
  getInput,
  getEngine
} from '@zephyr3d/scene';
import { backendWebGL1, backendWebGL2 } from '@zephyr3d/backend-webgl';
import { backendWebGPU } from '@zephyr3d/backend-webgpu';

// Prefer WebGPU so that every OIT mode can be demonstrated: ABuffer OIT is
// WebGPU-only, and dual depth peeling needs capabilities WebGL1 lacks.
// Fall back to WebGL2, then WebGL1.
async function selectBackend() {
  if (await backendWebGPU.supported()) {
    return backendWebGPU;
  }
  console.warn('No WebGPU support, fall back to WebGL2');
  if (await backendWebGL2.supported()) {
    return backendWebGL2;
  }
  console.warn('No WebGL2 support, fall back to WebGL');
  return backendWebGL1;
}

const myApp = new Application({
  backend: await selectBackend(),
  canvas: document.querySelector('#my-canvas')
});

myApp.ready().then(function () {
  const scene = new Scene();
  scene.env.light.strength = 0.5;

  const light = new DirectionalLight(scene);
  light.rotation.fromEulerAngle(-Math.PI / 4, Math.PI / 4, 0);

  // Opaque floor for reference
  const floorMaterial = new PBRMetallicRoughnessMaterial();
  floorMaterial.albedoColor = new Vector4(0.8, 0.8, 0.8, 1);
  floorMaterial.roughness = 0.9;
  const floor = new Mesh(scene, new PlaneShape({ size: 60 }), floorMaterial);
  floor.position.setXYZ(-30, -8, -30);

  // A cluster of intersecting transparent objects.
  // Without OIT their blending order is wrong from most view angles.
  function transparentMaterial(r, g, b) {
    const material = new PBRMetallicRoughnessMaterial();
    material.albedoColor = new Vector4(r, g, b, 1);
    material.metallic = 0;
    material.roughness = 0.4;
    material.blendMode = 'blend';
    material.opacity = 0.5;
    return material;
  }
  const colors = [
    [1, 0.2, 0.2],
    [0.2, 1, 0.2],
    [0.2, 0.4, 1],
    [1, 1, 0.2],
    [1, 0.2, 1],
    [0.2, 1, 1]
  ] as const;
  const spheres = [];
  for (let i = 0; i < colors.length; i++) {
    const angle = (i / colors.length) * Math.PI * 2;
    const sphere = new Mesh(
      scene,
      new SphereShape({ radius: 6 }),
      transparentMaterial(colors[i][0], colors[i][1], colors[i][2])
    );
    sphere.position.setXYZ(Math.cos(angle) * 5, 0, Math.sin(angle) * 5);
    spheres.push({ mesh: sphere, angle });
  }
  const torus = new Mesh(scene, new TorusShape(), transparentMaterial(1, 1, 1));
  torus.scale.setXYZ(4, 4, 4);

  // Create camera
  scene.mainCamera = new PerspectiveCamera(scene, Math.PI / 3, 1, 500);
  scene.mainCamera.lookAt(new Vector3(0, 12, 32), Vector3.zero(), Vector3.axisPY());
  scene.mainCamera.controller = new OrbitCameraController();

  // The three OIT implementations. Each one reports whether the current device
  // can run it via supportDevice(); unsupported modes are greyed out below
  // instead of silently falling back to sorted alpha blending.
  const modes = [
    { id: 'btn-none', label: 'No OIT', create: () => null },
    { id: 'btn-wb', label: 'Weighted Blended', create: () => new WeightedBlendedOIT() },
    { id: 'btn-ddp', label: 'Dual Depth Peeling', create: () => new DualDepthPeelingOIT(8) },
    { id: 'btn-abuffer', label: 'ABuffer', create: () => new ABufferOIT() }
  ];

  const deviceType = myApp.device.type;
  document.querySelector('#device-type').textContent = deviceType;

  let activeButton = null;

  function selectMode(mode, button) {
    // The camera holds its OIT through a reference-counted handle, so assigning
    // a new one releases the previous instance.
    scene.mainCamera.oit = mode.create();
    activeButton?.classList.remove('active');
    button.classList.add('active');
    activeButton = button;
  }

  const available = [];
  for (const mode of modes) {
    const button = document.querySelector<HTMLButtonElement>(`#${mode.id}`);
    // "No OIT" has nothing to probe and is always available. For the rest,
    // build one throwaway instance just to ask the device about it.
    const probe = mode.create();
    const supported = !probe || probe.supportDevice(deviceType);
    probe?.dispose();

    if (!supported) {
      button.disabled = true;
      button.title = `${mode.label} is not supported on ${deviceType}`;
      continue;
    }
    button.addEventListener('click', () => selectMode(mode, button));
    available.push({ mode, button });
  }

  // Start on the most accurate mode this device supports, which is the last
  // available entry since `modes` is ordered from cheapest to most accurate.
  const initial = available[available.length - 1];
  selectMode(initial.mode, initial.button);

  getInput().use(scene.mainCamera.handleEvent, scene.mainCamera);

  getEngine().setRenderable(scene, 0, {
    beforeRender() {
      // Slowly swirl the spheres through each other so the blend
      // order changes continuously
      const t = myApp.device.frameInfo.elapsedOverall * 0.0005;
      for (const s of spheres) {
        s.mesh.position.setXYZ(
          Math.cos(s.angle + t) * 5,
          Math.sin(t * 2 + s.angle) * 2,
          Math.sin(s.angle + t) * 5
        );
      }
    }
  });

  myApp.run();
});
