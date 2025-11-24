import { Vector3 } from '@zephyr3d/base';
import {
  Scene,
  Application,
  Mesh,
  OrbitCameraController,
  PerspectiveCamera,
  Primitive,
  UnlitMaterial,
  getInput,
  getEngine
} from '@zephyr3d/scene';
import { backendWebGL2 } from '@zephyr3d/backend-webgl';

const myApp = new Application({
  backend: backendWebGL2,
  canvas: document.querySelector('#my-canvas')
});

myApp.ready().then(function () {
  // Create scene and light
  const scene = new Scene();
  // Create an unlit material
  const material = new UnlitMaterial();
  // Disable backface culling
  material.cullMode = 'none';
  // Use vertex color
  material.vertexColor = true;
  // Fill the triangle data
  const triangle = new Primitive();
  const vertices = myApp.device.createVertexBuffer(
    'position_f32x3',
    new Float32Array([2, -2, 0, 0, 2, 0, -2, -2, 0])
  );
  const diffuse = myApp.device.createVertexBuffer(
    'diffuse_u8normx4',
    new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255])
  );
  const indices = myApp.device.createIndexBuffer(new Uint16Array([0, 1, 2]));
  triangle.setVertexBuffer(vertices);
  triangle.setVertexBuffer(diffuse);
  triangle.setIndexBuffer(indices);
  // Create the mesh
  new Mesh(scene, triangle, material);

  // Create camera
  scene.mainCamera = new PerspectiveCamera(scene, Math.PI / 3, 1, 100);
  scene.mainCamera.lookAt(new Vector3(0, 0, 4), Vector3.zero(), new Vector3(0, 1, 0));
  scene.mainCamera.controller = new OrbitCameraController();

  getInput().use(scene.mainCamera.handleEvent, scene.mainCamera);

  getEngine().setRenderable(scene, 0);

  myApp.run();
});
