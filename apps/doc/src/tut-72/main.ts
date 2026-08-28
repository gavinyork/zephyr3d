import { Vector3, Vector4 } from '@zephyr3d/base';
import { backendWebGL2 } from '@zephyr3d/backend-webgl';
import {
  Application,
  DirectionalLight,
  EyeMaterial,
  getEngine,
  getInput,
  Mesh,
  OrbitCameraController,
  PerspectiveCamera,
  Scene,
  SphereShape
} from '@zephyr3d/scene';
import type { Texture2D } from '@zephyr3d/device';

const IRIS_TEXTURE = 'https://cdn.zephyr3d.org/misc/iris.png';
const SCLERA_TEXTURE = 'https://cdn.zephyr3d.org/misc/sclera.png';

const app = new Application({
  canvas: document.querySelector<HTMLCanvasElement>('#my-canvas')!,
  backend: backendWebGL2
});

await app.ready();
const irisTexture = await getEngine().resourceManager.fetchTexture<Texture2D>(IRIS_TEXTURE);
const scleraTexture = await getEngine().resourceManager.fetchTexture<Texture2D>(SCLERA_TEXTURE);

const scene = new Scene();
scene.env.sky.skyType = 'none';
scene.env.sky.fogType = 'none';
scene.env.light.type = 'constant';
scene.env.light.ambientColor = new Vector4(0.14, 0.15, 0.18, 1);

const camera = new PerspectiveCamera(scene, Math.PI / 5, 0.1, 50);
camera.position.setXYZ(0, 0, 4.2);
camera.controller = new OrbitCameraController({ center: Vector3.zero() });
scene.mainCamera = camera;
getInput().use(camera.handleEvent, camera);
getEngine().setRenderable(scene, 0);

const key = new DirectionalLight(scene);
key.lookAt(new Vector3(3, 4, 5), Vector3.zero(), Vector3.axisPY());
key.color = new Vector4(1, 0.98, 0.95, 1);

const fill = new DirectionalLight(scene);
fill.lookAt(new Vector3(-4, 1, 2), Vector3.zero(), Vector3.axisPY());
fill.color = new Vector4(0.35, 0.4, 0.5, 1);

const material = new EyeMaterial();
material.vertexTangent = true;
material.irisRadius = 0.2;
material.irisDepth = 0.06;
material.ior = 1.376;
material.irisBrightness = 0.12;
material.limbalRingWidth = 0.12;
material.limbalRingStrength = 0.75;
material.corneaSpecularStrength = 1;
material.corneaRoughness = 0.05;
material.scleraWrap = 0.35;
material.irisColor = new Vector4(1, 1, 1, 1);
material.irisTexture = irisTexture;
material.scleraTexture = scleraTexture;
new Mesh(
  scene,
  new SphereShape({
    horizonalDetail: 64,
    verticalDetail: 64,
    eyeCompatible: true
  }),
  material
);

app.run();
