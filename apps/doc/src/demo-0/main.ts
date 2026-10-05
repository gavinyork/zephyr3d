import { Application, getDevice, getEngine, Scene } from '@zephyr3d/scene';
import { GLTFViewer } from './gltfviewer';
import { backendWebGL2 } from '@zephyr3d/backend-webgl';
import { backendWebGPU } from '@zephyr3d/backend-webgpu';
import type { DeviceBackend } from '@zephyr3d/device';
import { GLTFImporter } from '@zephyr3d/loaders';

function getQueryString(name: string) {
  return new URL(window.location.toString()).searchParams.get(name) || null;
}

async function getBackend(): Promise<DeviceBackend> {
  const type = getQueryString('dev') || 'webgl2';
  if (type === 'webgpu') {
    if (await backendWebGPU.supported()) {
      return backendWebGPU;
    } else {
      console.warn('No WebGPU support, fall back to WebGL2');
    }
  }
  return backendWebGL2;
}

const gltfApp = new Application({
  backend: await getBackend(),
  canvas: document.querySelector('#canvas'),
  enableMSAA: true
});

gltfApp.ready().then(async () => {
  getEngine().resourceManager.setModelLoader('model/gltf+json', new GLTFImporter());
  getEngine().resourceManager.setModelLoader('model/gltf-binary', new GLTFImporter());
  console.log(gltfApp.device.getAdapterInfo());
  const scene = new Scene();
  const gltfViewer = new GLTFViewer(scene);
  gltfViewer.loadModel('https://cdn.zephyr3d.org/doc/assets/models/DamagedHelmet.glb');
  gltfApp.on('drop', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (ev.dataTransfer.items.length > 0) {
      gltfViewer.handleDrop(ev.dataTransfer);
    }
  });
  getDevice().canvas.addEventListener('contextmenu', function (ev) {
    ev.preventDefault();
    return false;
  });
  gltfApp.on('resize', (width, height) => {
    gltfViewer.camera.aspect = width / height;
  });
  gltfApp.on('tick', () => {
    gltfViewer.camera.updateController();
    gltfViewer.render();
  });
  gltfApp.run();
});
