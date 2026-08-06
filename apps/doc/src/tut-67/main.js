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
  getInput,
  getEngine
} from '@zephyr3d/scene';
import { backendWebGL2 } from '@zephyr3d/backend-webgl';

const myApp = new Application({
  backend: backendWebGL2,
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
  ];
  const spheres = [];
  for (let i = 0; i < colors.length; i++) {
    const angle = (i / colors.length) * Math.PI * 2;
    const sphere = new Mesh(scene, new SphereShape({ radius: 6 }), transparentMaterial(...colors[i]));
    sphere.position.setXYZ(Math.cos(angle) * 5, 0, Math.sin(angle) * 5);
    spheres.push({ mesh: sphere, angle });
  }
  const torus = new Mesh(scene, new TorusShape(), transparentMaterial(1, 1, 1));
  torus.scale.setXYZ(4, 4, 4);

  // Create camera
  scene.mainCamera = new PerspectiveCamera(scene, Math.PI / 3, 1, 500);
  scene.mainCamera.lookAt(new Vector3(0, 12, 32), Vector3.zero(), Vector3.axisPY());
  scene.mainCamera.controller = new OrbitCameraController();

  // Enable Weighted Blended OIT: transparent fragments blend correctly
  // without any manual sorting. Works on WebGL/WebGL2/WebGPU.
  // On WebGPU devices, `camera.oit = new ABufferOIT()` gives exact
  // per-pixel sorted results at a higher cost.
  scene.mainCamera.oit = new WeightedBlendedOIT();

  const btnNone = document.querySelector('#btn-none');
  const btnWb = document.querySelector('#btn-wb');
  btnNone.addEventListener('click', () => {
    scene.mainCamera.oit = null;
    btnNone.classList.add('active');
    btnWb.classList.remove('active');
  });
  btnWb.addEventListener('click', () => {
    scene.mainCamera.oit = new WeightedBlendedOIT();
    btnWb.classList.add('active');
    btnNone.classList.remove('active');
  });

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
