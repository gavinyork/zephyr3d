import { Vector2, Vector3, Vector4 } from '@zephyr3d/base';
import {
  Scene,
  Application,
  OrbitCameraController,
  PerspectiveCamera,
  Mesh,
  DirectionalLight,
  BoxShape,
  CylinderShape,
  PBRMetallicRoughnessMaterial,
  Water,
  FBMWaveGenerator,
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

  // Directional light acts as the sun
  const sun = new DirectionalLight(scene);
  sun.rotation.fromEulerAngle(-Math.PI / 5, Math.PI / 4, 0);
  sun.castShadow = true;

  // A few rocks poking through the surface to show refraction and depth shading
  const rockMaterial = new PBRMetallicRoughnessMaterial();
  rockMaterial.albedoColor = new Vector4(0.45, 0.4, 0.35, 1);
  rockMaterial.metallic = 0;
  rockMaterial.roughness = 0.95;
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2;
    const rock = new Mesh(scene, new BoxShape({ size: 6 + (i % 3) * 3 }), rockMaterial);
    rock.position.setXYZ(Math.cos(angle) * 25, -4 + (i % 3), Math.sin(angle) * 25);
    rock.rotation.fromEulerAngle(0.3 * i, 0.7 * i, 0.2 * i);
  }
  // A pier column
  const pillarMaterial = new PBRMetallicRoughnessMaterial();
  pillarMaterial.albedoColor = new Vector4(0.4, 0.26, 0.16, 1);
  pillarMaterial.roughness = 0.9;
  const pillar = new Mesh(
    scene,
    new CylinderShape({ topRadius: 1.5, bottomRadius: 1.5, height: 16 }),
    pillarMaterial
  );
  pillar.position.setXYZ(0, -8, 0);

  // Sandy bottom so the depth-based shading has something to fade to
  const bottomMaterial = new PBRMetallicRoughnessMaterial();
  bottomMaterial.albedoColor = new Vector4(0.76, 0.7, 0.5, 1);
  bottomMaterial.roughness = 1;
  const bottom = new Mesh(scene, new BoxShape({ sizeX: 400, sizeY: 1, sizeZ: 400 }), bottomMaterial);
  bottom.position.setXYZ(-200, -12, -200);

  // Create the water surface. The node transform defines the covered region:
  // scale X/Z control the extent, the node position moves the center.
  const water = new Water(scene);
  water.position.setXYZ(-200, 0, -200);
  water.scale.setXYZ(400, 1, 400);
  water.gridScale = 1;
  water.animationSpeed = 1;

  // FBM waves: cheap procedural waves, a good default
  const waves = new FBMWaveGenerator();
  waves.amplitude = 0.3;
  waves.frequency = 3;
  waves.numOctaves = 4;
  waves.wind = new Vector2(0.1, 0);
  water.waveGenerator = waves;

  // Water shading controls
  water.material.depthMulti = 0.1;
  water.material.displace = 32;
  water.material.refractionStrength = 0.2;

  // Create camera
  scene.mainCamera = new PerspectiveCamera(scene, Math.PI / 3, 1, 1000);
  scene.mainCamera.lookAt(new Vector3(0, 18, 60), new Vector3(0, 0, 0), Vector3.axisPY());
  scene.mainCamera.controller = new OrbitCameraController();
  scene.mainCamera.FXAA = true;

  getInput().use(scene.mainCamera.handleEvent, scene.mainCamera);

  getEngine().setRenderable(scene, 0);

  myApp.run();
});
