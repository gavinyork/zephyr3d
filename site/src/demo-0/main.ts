import { Application, Scene } from '@zephyr3d/scene';
import { GLTFViewer } from './gltfviewer';
import { Vector3 } from '@zephyr3d/base';
import { backendWebGL2 } from '@zephyr3d/backend-webgl';

const gltfApp = new Application({
  backend: backendWebGL2,
  canvas: document.querySelector('#canvas'),
  enableMSAA: true
});

gltfApp.ready().then(async () => {
  const scene = new Scene();
  scene.env.sky.fogType = 'exp';
  const gltfViewer = new GLTFViewer(scene);
  gltfApp.inputManager.use(gltfViewer.camera.handleEvent.bind(gltfViewer.camera));
  gltfApp.on('drop', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (ev.dataTransfer.items.length > 0) {
      gltfViewer.handleDrop(ev.dataTransfer);
    }
  });
  let movingSun = 0;
  Application.instance.device.canvas.addEventListener('contextmenu', function (ev) {
    ev.preventDefault();
    return false;
  });
  gltfApp.on('pointermove', (ev) => {
    if (movingSun) {
      const viewport = Application.instance.device.getViewport();
      const ray = scene.constructRay(
        gltfViewer.camera,
        viewport.width,
        viewport.height,
        ev.offsetX,
        ev.offsetY
      );
      gltfViewer.light0.lookAt(ray.direction, Vector3.zero(), Vector3.axisPY());
    }
  });
  gltfApp.on('pointerdown', (ev) => {
    if (ev.button === 2) {
      const viewport = Application.instance.device.getViewport();
      const ray = scene.constructRay(
        gltfViewer.camera,
        viewport.width,
        viewport.height,
        ev.offsetX,
        ev.offsetY
      );
      gltfViewer.light0.lookAt(ray.direction, Vector3.zero(), Vector3.axisPY());
      movingSun = 1;
    }
  });
  gltfApp.on('pointerup', (ev) => {
    if (ev.button === 2) {
      movingSun = 0;
    }
  });
  gltfApp.on('keyup', (ev) => {
    if (ev.code === 'KeyT') {
      gltfViewer.toggleTonemap();
    } else if (ev.code === 'KeyB') {
      gltfViewer.toggleBloom();
    }
  });
  gltfApp.on('resize', (ev) => {
    gltfViewer.camera.aspect = ev.width / ev.height;
  });
  gltfApp.on('tick', (ev) => {
    gltfViewer.camera.updateController();
    gltfViewer.render();
  });
  gltfApp.run();
});
