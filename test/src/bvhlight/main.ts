import type { AABB } from '@zephyr3d/base';
import { Vector3, Vector4 } from '@zephyr3d/base';
import type { SceneNode } from '@zephyr3d/scene';
import {
  Scene,
  AssetManager,
  panoramaToCubemap,
  prefilterCubemap,
  Application,
  Tonemap,
  BoundingBox,
  FPSCameraController,
  PointLight,
  UnlitMaterial,
  Mesh,
  GraphNode,
  DirectionalLight,
  PerspectiveCamera,
  SphereShape,
  Compositor
} from '@zephyr3d/scene';
import * as common from '../common';
import type { Texture2D } from '@zephyr3d/device';
import { imGuiEndFrame, imGuiInit, imGuiInjectEvent, imGuiNewFrame } from '@zephyr3d/imgui';

const bvhLightApp = new Application({
  backend: common.getBackend(),
  canvas: document.querySelector('#canvas'),
  pixelRatio: 1
});
const animationFunctions: ((elapsed: number) => void)[] = [];
bvhLightApp.ready().then(async () => {
  const device = bvhLightApp.device;
  const scene = new Scene();
  const camera = new PerspectiveCamera(
    scene,
    Math.PI / 3,
    device.getDrawingBufferWidth() / device.getDrawingBufferHeight(),
    1,
    260
  );
  camera.controller = new FPSCameraController({ moveSpeed: 0.5 });
  const compositor = new Compositor();
  compositor.appendPostEffect(new Tonemap());
  await imGuiInit(device);

  bvhLightApp.inputManager.use(imGuiInjectEvent);
  bvhLightApp.inputManager.use(camera.handleEvent.bind(camera));

  const inspector = new common.Inspector(scene, null);
  const assetManager = new AssetManager();
  const tex = await assetManager.fetchTexture<Texture2D>('./assets/images/environments/papermill.hdr');
  const skyMap = device.createCubeTexture('rgba16f', 512);
  const radianceMap = device.createCubeTexture('rgba16f', 256);
  const irradianceMap = device.createCubeTexture('rgba16f', 128, { samplerOptions: { mipFilter: 'none' } });
  panoramaToCubemap(tex, skyMap);
  prefilterCubemap(skyMap, 'ggx', radianceMap);
  prefilterCubemap(skyMap, 'lambertian', irradianceMap);
  scene.env.light.type = 'ibl';
  scene.env.light.radianceMap = radianceMap;
  scene.env.light.irradianceMap = irradianceMap;
  scene.env.light.strength = 0.6;
  scene.env.sky.skyType = 'skybox';
  scene.env.sky.skyboxTexture = skyMap;
  scene.env.sky.fogType = 'none';
  scene.env.sky.fogStart = 3;
  scene.env.sky.fogEnd = 160;
  scene.env.sky.fogTop = 30;
  tex.dispose();

  assetManager.fetchModel(scene, './assets/models/sponza/Sponza.gltf', null).then((info) => {
    function traverseModel(group: SceneNode, func: (node: SceneNode) => void, context?: any) {
      if (group) {
        const queue: SceneNode[] = [group];
        while (queue.length > 0) {
          const node = queue.shift();
          queue.push(...node.children);
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
      const sphere = new SphereShape();
      for (let i = 0; i < 255; i++) {
        const color = Vector3.normalize(new Vector3(Math.random(), Math.random(), Math.random()));
        const pointlight = new PointLight(scene)
          .setRange(Math.min(bbox.extents.x, bbox.extents.y, bbox.extents.z) * (0.02 + Math.random() * 0.3))
          .setIntensity(20)
          .setColor(new Vector4(color.x, color.y, color.z, 1))
          .setCastShadow(false);
        pointlight.position.set(randomPoint(bbox));
        const ball = new Mesh(scene, sphere);
        ball.pickMode = GraphNode.PICK_DISABLED;
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
  bvhLightApp.on('resize', (ev) => {
    camera.aspect = ev.width / ev.height;
  });
  bvhLightApp.on('tick', () => {
    for (const f of animationFunctions) {
      f(device.frameInfo.elapsedFrame * 0.004);
    }
    camera.updateController();
    camera.render(scene, compositor);
    imGuiNewFrame();
    inspector.render();
    imGuiEndFrame();
  });
  bvhLightApp.run();
});
