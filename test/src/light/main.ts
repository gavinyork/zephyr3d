import { backendWebGL2 } from '@zephyr3d/backend-webgl';
import { Vector3, Vector4 } from '@zephyr3d/base';
import { Scene, Application, PerspectiveCamera, DirectionalLight, Compositor, Tonemap, PBRMetallicRoughnessMaterial, BoxShape, Mesh, FPSCameraController } from '@zephyr3d/scene';
import { imGuiEndFrame, imGuiInit, imGuiInjectEvent, imGuiNewFrame } from '@zephyr3d/imgui';
import * as common from '../common';

const myApp = new Application({
  backend: backendWebGL2,
  canvas: document.querySelector('#canvas')
});


myApp.ready().then(async() => {

  await imGuiInit(myApp.device);
  myApp.inputManager.use(imGuiInjectEvent);

  // 创建场景
  const scene = new Scene();

  // 创建摄像机
  const camera = new PerspectiveCamera(scene, Math.PI/3, myApp.device.canvas.width/myApp.device.canvas.height, 1, 600);
  camera.lookAt(new Vector3(0, 8, 30), new Vector3(0, 8, 0), Vector3.axisPY());
  camera.controller = new FPSCameraController();
  myApp.inputManager.use(camera.handleEvent.bind(camera));

  // 创建方向光
  const light = new DirectionalLight(scene);
  light.lookAt(new Vector3(1, 1, 1), new Vector3(0, 0, 0), new Vector3(0, 1, 0));
  light.castShadow = true;
  light.shadow.numShadowCascades = 4;

  // 设置天空渲染模式为大气散射
  scene.env.sky.skyType = 'scatter';
  // 设置雾效为大气散射
  scene.env.sky.fogType = 'scatter';
  // 设置场景距离单位
  scene.worldUnit = 2;

  // 创建地面和一些盒子

  const material = new PBRMetallicRoughnessMaterial();
  material.lightModel.metallic = 0.1;
  material.lightModel.roughness = 0.6;
  material.lightModel.albedo = new Vector4(0.3, 0.2, 0.2, 1);

  const box = new BoxShape();
  const floor = new Mesh(scene, box);
  floor.scale.setXYZ(2000, 10, 2000);
  floor.position.setXYZ(-1000, -10, -1000);
  floor.material = material;

  for (let i = -40; i <= 40; i++) {
    const box1 = new Mesh(scene, box);
    box1.scale.setXYZ(3, 30, 3);
    box1.position.setXYZ(-20, 0, i * 10);
    box1.material = material;
    const box2 = new Mesh(scene, box);
    box2.scale.setXYZ(3, 30, 3);
    box2.position.setXYZ(20, 0, i * 10);
    box2.material = material;
  }

  // 添加Tonemap后处理效果
  const compositor = new Compositor();
  compositor.appendPostEffect(new Tonemap());

  // 窗口大小发生变化重新设置相机投影矩阵的宽高比
  myApp.on('resize', ev => {
    camera.aspect = ev.width / ev.height;
  });

  const inspector = new common.Inspector(scene, compositor, camera);

  let movingSun = 0;
  Application.instance.device.canvas.addEventListener('contextmenu', function(ev){
    ev.preventDefault();
    return false;
  });
  myApp.on('pointerdown', ev => {
    if (ev.button === 2 && ev.ctrlKey) {
      const viewport = Application.instance.device.getViewport();
      const ray = scene.constructRay(camera, viewport.width, viewport.height, ev.offsetX, ev.offsetY);
      light.lookAt(ray.direction, Vector3.zero(), Vector3.axisPY());
      movingSun = 1;
    }
  });
  myApp.on('pointerup', ev => {
    if (ev.button === 2) {
      movingSun = 0;
    }
  });
  myApp.on('pointermove', ev => {
    //const obj = scene.raycast(gltfViewer.camera, ev.offsetX, ev.offsetY);
    //console.log(`raycast: ${obj ? obj.node.constructor.name : null}`);
    if (movingSun) {
      const viewport = Application.instance.device.getViewport();
      const ray = scene.constructRay(camera, viewport.width, viewport.height, ev.offsetX, ev.offsetY);
      light.lookAt(ray.direction, Vector3.zero(), Vector3.axisPY());
    }
  });
  myApp.on('tick', function () {
    camera.updateController();
    camera.render(scene, compositor);
    imGuiNewFrame();
    inspector.render();
    imGuiEndFrame();
  });

  myApp.run();
});
