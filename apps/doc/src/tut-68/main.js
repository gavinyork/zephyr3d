import { Vector3, Vector4 } from '@zephyr3d/base';
import {
  Scene,
  Application,
  OrbitCameraController,
  PerspectiveCamera,
  Mesh,
  DirectionalLight,
  BoxShape,
  SphereShape,
  TorusShape,
  PBRMetallicRoughnessMaterial,
  panoramaToCubemap,
  getInput,
  getEngine
} from '@zephyr3d/scene';
import { backendWebGL2 } from '@zephyr3d/backend-webgl';

const myApp = new Application({
  backend: backendWebGL2,
  canvas: document.querySelector('#my-canvas')
});

myApp.ready().then(async function () {
  const scene = new Scene();

  // SSGI requires IBL environment lighting with both radiance and irradiance data
  const panorama = await getEngine().resourceManager.fetchTexture(
    'https://cdn.zephyr3d.org/doc/assets/images/Wide_Street.hdr'
  );
  const skyMap = myApp.device.createCubeTexture('rgba16f', 512);
  panoramaToCubemap(/** @type {import('@zephyr3d/device').Texture2D} */ (panorama), skyMap);
  scene.env.sky.skyType = 'skybox';
  scene.env.sky.skyboxTexture = skyMap;
  scene.env.sky.fogType = 'none';
  scene.env.light.type = 'ibl';

  // Keep direct lighting weak so the indirect bounce is clearly visible
  const light = new DirectionalLight(scene);
  light.rotation.fromEulerAngle(-Math.PI / 3, Math.PI / 4, 0);
  light.color = new Vector4(0.3, 0.3, 0.3, 1);

  // An open box with strongly colored walls: with SSGI enabled, the red and
  // green walls bleed color onto the white floor and the objects inside.
  function makeWall(sizeX, sizeY, sizeZ, x, y, z, r, g, b) {
    const material = new PBRMetallicRoughnessMaterial();
    material.albedoColor = new Vector4(r, g, b, 1);
    material.metallic = 0;
    material.roughness = 0.95;
    const wall = new Mesh(scene, new BoxShape({ sizeX, sizeY, sizeZ }), material);
    wall.position.setXYZ(x, y, z);
    return wall;
  }
  const W = 40;
  makeWall(W, 1, W, -W / 2, 0, -W / 2, 1, 1, 1); // floor
  makeWall(W, W, 1, -W / 2, 0, -W / 2 - 1, 1, 1, 1); // back wall
  makeWall(1, W, W, -W / 2 - 1, 0, -W / 2, 1, 0.1, 0.1); // red wall (left)
  makeWall(1, W, W, W / 2, 0, -W / 2, 0.1, 1, 0.1); // green wall (right)

  // Objects inside the box
  const sphereMaterial = new PBRMetallicRoughnessMaterial();
  sphereMaterial.albedoColor = new Vector4(0.9, 0.9, 0.9, 1);
  sphereMaterial.metallic = 0.1;
  sphereMaterial.roughness = 0.6;
  const sphere = new Mesh(scene, new SphereShape({ radius: 6 }), sphereMaterial);
  sphere.position.setXYZ(-8, 7, -5);
  const torus = new Mesh(scene, new TorusShape(), sphereMaterial);
  torus.scale.setXYZ(4, 4, 4);
  torus.position.setXYZ(8, 5, 5);

  // Create camera. SSGI requires HDR rendering.
  scene.mainCamera = new PerspectiveCamera(scene, Math.PI / 3, 1, 500);
  scene.mainCamera.lookAt(new Vector3(0, 20, 42), new Vector3(0, 8, 0), Vector3.axisPY());
  scene.mainCamera.controller = new OrbitCameraController({ center: new Vector3(0, 8, 0) });
  scene.mainCamera.HDR = true;
  scene.mainCamera.toneMap = true;

  // Enable SSGI
  scene.mainCamera.SSGI = true;
  scene.mainCamera.ssgiQualityPreset = 'balanced';

  const btnOff = document.querySelector('#btn-off');
  const btnOn = document.querySelector('#btn-on');
  btnOff.addEventListener('click', () => {
    scene.mainCamera.SSGI = false;
    btnOff.classList.add('active');
    btnOn.classList.remove('active');
  });
  btnOn.addEventListener('click', () => {
    scene.mainCamera.SSGI = true;
    btnOn.classList.add('active');
    btnOff.classList.remove('active');
  });

  getInput().use(scene.mainCamera.handleEvent, scene.mainCamera);

  getEngine().setRenderable(scene, 0);

  myApp.run();
});
