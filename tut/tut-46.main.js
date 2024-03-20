import { backendWebGL2 } from '@zephyr3d/backend-webgl';
import { Vector3 } from '@zephyr3d/base';
import { Scene, Application, PerspectiveCamera, OrbitCameraController, Mesh, DirectionalLight, BoxShape, LambertMaterial } from '@zephyr3d/scene';

const myApp = new Application({
  backend: backendWebGL2,
  canvas: document.querySelector('#my-canvas')
});

myApp.ready().then(async () => {
  const device = myApp.device;

  const scene = new Scene();

  // Creates a directional light
  const light = new DirectionalLight(scene);
  light.lookAt(Vector3.one(), Vector3.zero(), Vector3.axisPY());

  const boxShape = new BoxShape();
  const material = new LambertMaterial();
  const mesh = new Mesh(scene, boxShape, material);
  const camera = new PerspectiveCamera(scene, Math.PI/3, device.getDrawingBufferWidth() / device.getDrawingBufferHeight(), 1, 500);
  camera.lookAt(new Vector3(0, 0, 4), new Vector3(0, 0, 0), Vector3.axisPY());
  camera.controller = new OrbitCameraController();
  myApp.inputManager.use(camera.handleEvent.bind(camera));

  myApp.on('tick', ev => {
    camera.updateController();
    // Obtain the canvas width in CSS pixels
    const canvasWidth = myApp.device.deviceToScreen(myApp.device.canvas.width);
    // Obtain the canvas height in CSS pixels
    const canvasHeight = myApp.device.deviceToScreen(myApp.device.canvas.height);
    // Full-screen rendering
    camera.viewport = [0, 0, canvasWidth, canvasHeight];
    camera.aspect = camera.viewport[2]/camera.viewport[3];
    camera.render(scene);
    // Picture-in-Picture Rendering
    camera.viewport = [30, 30, 200, 160];
    camera.aspect = camera.viewport[2]/camera.viewport[3];
    camera.render(scene);
  });

  myApp.run();
});
