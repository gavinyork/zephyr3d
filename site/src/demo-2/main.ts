import * as zip from '@zip.js/zip.js';
import type { AABB } from '@zephyr3d/base';
import { Vector3, Vector4 } from '@zephyr3d/base';
import type { SceneNode } from '@zephyr3d/scene';
import {
  Scene,
  AssetManager,
  Application,
  Tonemap,
  BoundingBox,
  FPSCameraController,
  PointLight,
  UnlitMaterial,
  Mesh,
  DirectionalLight,
  PerspectiveCamera,
  SphereShape
} from '@zephyr3d/scene';
import type { DeviceBackend } from '@zephyr3d/device';
import { backendWebGPU } from '@zephyr3d/backend-webgpu';
import { backendWebGL1, backendWebGL2 } from '@zephyr3d/backend-webgl';
import { Panel } from './ui';

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

async function fetchAssetArchive(url: string, progressCallback: (percent: number) => void): Promise<Blob> {
  progressCallback(0);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error('Download failed');
  }
  const contentLength = response.headers.get('content-length');
  const totalBytes = contentLength ? parseInt(contentLength, 10) : 0;
  let receivedBytes = 0;
  let data: Uint8Array = new Uint8Array(totalBytes || 1024 * 1024);
  const reader = response.body.getReader();
  if (!reader) {
    throw new Error('Download data is empty');
  }
  const read = async (): Promise<void> => {
    const { done, value } = await reader.read();
    if (done) {
      return;
    }
    if (data.length < receivedBytes + value.length) {
      const newData = new Uint8Array(Math.max(2 * data.length, receivedBytes + value.length));
      newData.set(data);
      data = newData;
    }
    data.set(value, receivedBytes);
    receivedBytes += value.length;
    progressCallback(Math.floor((receivedBytes / totalBytes) * 100));
    return read();
  };
  await read();
  return new Blob([data]);
}

async function readZip(blob: Blob): Promise<Map<string, string>> {
  const reader = new zip.ZipReader(new zip.BlobReader(blob));
  const entries = await reader.getEntries();
  const fileMap = new Map();
  for (const entry of entries) {
    if (!entry.directory) {
      const blob = await entry.getData(new zip.BlobWriter());
      const fileURL = URL.createObjectURL(blob);
      fileMap.set(`/${entry.filename}`, fileURL);
    }
  }
  await reader.close();
  return fileMap;
}

const lightApp = new Application({
  backend: getBackend(),
  canvas: document.querySelector('#canvas'),
  pixelRatio: 1
});

const animationFunctions: ((elapsed: number) => void)[] = [];
lightApp.ready().then(async () => {
  const device = lightApp.device;
  device.setFont('24px arial');
  const scene = new Scene();
  const camera = new PerspectiveCamera(
    scene,
    Math.PI / 3,
    device.getDrawingBufferWidth() / device.getDrawingBufferHeight(),
    1,
    260
  );
  camera.controller = new FPSCameraController({ moveSpeed: 0.05 });
  camera.compositor.appendPostEffect(new Tonemap());

  lightApp.inputManager.use(camera.handleEvent.bind(camera));

  const assetManager = new AssetManager();
  scene.env.light.strength = 0.3;

  const loadPercent = 0;
  let message = `Loading %${loadPercent} ...`;
  fetchAssetArchive('./assets/sponza.zip', (percent) => {
    message = `Loading %${percent} ...`;
  }).then(async (zipContent) => {
    const fileMap = await readZip(zipContent);
    assetManager.httpRequest.urlResolver = (url) => fileMap.get(url) || url;

    assetManager.fetchModel(scene, '/sponza/Sponza.gltf').then((info) => {
      message = '';
      function traverseModel(group: SceneNode, func: (node: SceneNode) => void, context?: any) {
        if (group) {
          const queue: SceneNode[] = [group];
          while (queue.length > 0) {
            const node = queue.shift();
            queue.push(...node.children.map((node) => node.get()));
            if (node.isMesh()) {
              func.call(context, node);
            }
          }
        }
      }
      function getBoundingBox(model: SceneNode): AABB {
        const bbox = new BoundingBox();
        bbox.beginExtend();
        traverseModel(model, (node) => {
          if (node.isGraphNode()) {
            const aabb = node.getWorldBoundingVolume()?.toAABB();
            if (aabb && aabb.isValid()) {
              bbox.extend(aabb.minPoint);
              bbox.extend(aabb.maxPoint);
            }
          }
        });
        return bbox.isValid() ? bbox : null;
      }
      function randomPoint(bbox: AABB) {
        return new Vector3(
          Vector3.add(
            bbox.minPoint,
            new Vector3(
              Math.random() * bbox.extents.x * 2,
              Math.random() * bbox.extents.y * 2,
              Math.random() * bbox.extents.z * 2
            )
          )
        );
      }
      function lightAnimation(bbox: AABB, light: PointLight) {
        const velocity = new Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
        return function (elapsed: number) {
          light.position.set(Vector3.add(light.position, Vector3.scale(velocity, elapsed)));
          const pos = light.position;
          for (let i = 0; i < 3; i++) {
            if (pos[i] < bbox.minPoint[i] + light.range) {
              velocity[i] = Math.abs(velocity[i]);
              pos[i] = bbox.minPoint[i] + light.range;
            } else if (pos[i] > bbox.maxPoint[i] - light.range) {
              velocity[i] = -Math.abs(velocity[i]);
              pos[i] = bbox.maxPoint[i] - light.range;
            }
          }
        };
      }
      const ballMaterial = new UnlitMaterial();
      ballMaterial.albedoColor = new Vector4(1, 1, 0, 1);
      function initLights(model: SceneNode) {
        const light = new DirectionalLight(scene)
          .setColor(new Vector4(1, 1, 1, 1))
          .setIntensity(5)
          .setCastShadow(false);
        light.lookAt(new Vector3(0, 0, 0), new Vector3(0.5, -0.707, -0.5), Vector3.axisPY());
        light.castShadow = true;
        light.shadow.shadowMapSize = 1024;
        light.shadow.mode = 'pcf-opt';
        const bbox = getBoundingBox(model);
        light.shadow.shadowRegion = bbox;
        const sphere = new SphereShape();
        for (let i = 0; i < 255; i++) {
          const color = Vector3.normalize(new Vector3(Math.random(), Math.random(), Math.random()));
          const pointlight = new PointLight(scene)
            .setRange(
              Math.min(bbox.extents.x, bbox.extents.y, bbox.extents.z) * (0.027 + Math.random() * 0.3)
            )
            .setIntensity(20)
            .setColor(new Vector4(color.x, color.y, color.z, 1))
            .setCastShadow(false);
          pointlight.position.set(randomPoint(bbox));
          const ball = new Mesh(scene, sphere);
          ball.scale.setXYZ(0.02, 0.02, 0.02);
          ball.castShadow = false;
          ball.material = ballMaterial;
          ball.reparent(pointlight);
          animationFunctions.push(lightAnimation(bbox, pointlight));
        }
      }
      function lookAt(model: SceneNode, camera: PerspectiveCamera) {
        const bbox = getBoundingBox(model);
        const minSize = 10;
        const maxSize = 100;
        if (bbox) {
          const center = bbox.center;
          const extents = bbox.extents;
          let size = Math.max(extents.x, extents.y);
          if (size < minSize || size > maxSize) {
            const scale = size < minSize ? minSize / size : maxSize / size;
            model.scaleBy(new Vector3(scale, scale, scale));
            center.scaleBy(scale);
            extents.scaleBy(scale);
            size *= scale;
          }
          const dist = size / Math.tan(camera.getFOV() * 0.5) + extents.z + camera.getNearPlane();
          camera.lookAt(
            new Vector3(center.x - extents.x * 0.7, center.y - extents.y * 0.6, center.z),
            new Vector3(center.x, center.y - extents.y * 0.6, center.z),
            Vector3.axisPY()
          );
          camera.near = Math.min(1, camera.near);
          camera.far = Math.max(10, dist + extents.z + 100);
        }
      }
      lookAt(info.group, camera);
      console.log(scene.boundingBox);
      initLights(info.group);
    });
  });

  let ui: Panel = null;
  lightApp.on('resize', (width, height) => {
    camera.aspect = width / height;
  });
  lightApp.on('tick', () => {
    for (const f of animationFunctions) {
      f(device.frameInfo.elapsedFrame * 0.004);
    }
    camera.updateController();
    camera.render(scene);
    if (message) {
      lightApp.device.drawText(message, 20, 20, '#a00000');
    } else if (!ui) {
      ui = new Panel();
    }
  });

  lightApp.run();
});
