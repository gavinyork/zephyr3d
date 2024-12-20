import { Application, Scene } from '@zephyr3d/scene';
import { GLTFViewer } from './gltfviewer';
import { backendWebGL2, backendWebGL1 } from '@zephyr3d/backend-webgl';
import { backendWebGPU } from '@zephyr3d/backend-webgpu';
import type { DeviceBackend } from '@zephyr3d/device';

function getQueryString(name: string) {
  return new URL(window.location.toString()).searchParams.get(name) || null;
}

function getBackend(): DeviceBackend {
  const type = getQueryString('dev') || 'webgl';
  if (type === 'webgpu') {
    if (backendWebGPU.supported()) {
      return backendWebGPU;
    } else {
      console.warn('No WebGPU support, fall back to WebGL2');
    }
  }
  if (type === 'webgl2') {
    if (backendWebGL2.supported()) {
      return backendWebGL2;
    } else {
      console.warn('No WebGL2 support, fall back to WebGL1');
    }
  }
  return backendWebGL1;
}

const gltfApp = new Application({
  backend: getBackend(),
  canvas: document.querySelector('#canvas'),
  enableMSAA: true
});

gltfApp.ready().then(async () => {
  console.log(gltfApp.device.getAdapterInfo());
  //await imGuiInit(gltfApp.device);
  //gltfApp.inputManager.use(imGuiInjectEvent);
  const scene = new Scene();
  scene.env.sky.fogType = 'exp';
  const gltfViewer = new GLTFViewer(scene);
  await gltfViewer.ready();
  gltfViewer.loadModel('./assets/models/DamagedHelmet.glb');
  gltfApp.on('drop', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (ev.dataTransfer.items.length > 0) {
      gltfViewer.handleDrop(ev.dataTransfer);
    }
  });
  Application.instance.device.canvas.addEventListener('contextmenu', function (ev) {
    ev.preventDefault();
    return false;
  });
  gltfApp.on('resize', (ev) => {
    gltfViewer.camera.aspect = ev.width / ev.height;
  });
  gltfApp.on('keyup', (ev) => {
    console.log(ev.code);
    if (ev.code === 'KeyB') {
      gltfViewer.nextBackground();
    } else if (ev.code === 'KeyN') {
      gltfViewer.toggleScatter();
    } else if (ev.code === 'KeyF') {
      gltfViewer.toggleFloor();
    } else if (ev.code === 'Backquote') {
      gltfViewer.toggleInspector();
    } else if (ev.code === 'KeyT') {
      gltfViewer.toggleGUI();
    } else if (ev.code === 'KeyR') {
      gltfViewer.enableRotate(!gltfViewer.rotateEnabled());
    } else if (ev.code === 'KeyL') {
      gltfViewer.randomLightDir();
    } else if (ev.code === 'KeyO') {
      gltfViewer.enableWater(!gltfViewer.waterEnabled());
    } else if (ev.code === 'KeyP') {
      gltfViewer.toggleShadow();
    }
  });
  gltfApp.on('tick', (ev) => {
    gltfViewer.camera.updateController();
    gltfViewer.render();
  });
  gltfApp.run();
});
