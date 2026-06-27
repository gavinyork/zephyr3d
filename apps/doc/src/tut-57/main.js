import { Vector3, Vector4 } from '@zephyr3d/base';
import { backendWebGL2 } from '@zephyr3d/backend-webgl';
import { GLTFImporter } from '@zephyr3d/loaders';
import { ImGui, imGuiEndFrame, imGuiInit, imGuiInjectEvent, imGuiNewFrame } from '@zephyr3d/imgui';
import {
  AnimationController,
  Application,
  DirectionalLight,
  getEngine,
  getInput,
  LambertMaterial,
  Mesh,
  OrbitCameraController,
  PerspectiveCamera,
  PlaneShape,
  Scene
} from '@zephyr3d/scene';

const MODEL_URL = 'https://cdn.zephyr3d.org/misc/xbot.glb';
const IDLE_ACTION_URL = 'https://cdn.zephyr3d.org/misc/idle.glb';
const RUN_ACTION_URL = 'https://cdn.zephyr3d.org/misc/running.glb';

/** @type {AnimationController} */
let controller;

const app = new Application({
  backend: backendWebGL2,
  canvas: document.querySelector('#my-canvas'),
  enableMSAA: true
});

await app.ready();

await imGuiInit(
  app.device,
  `'Segoe UI', Tahoma, Geneva, Verdana, sans-serif`,
  12,
  app.device.getScaleY() > 1 ? 24 : 12
);

getEngine().resourceManager.setModelLoader('model/gltf+json', new GLTFImporter());
getEngine().resourceManager.setModelLoader('model/gltf-binary', new GLTFImporter());

const scene = new Scene();
scene.env.light.type = 'none';

const camera = new PerspectiveCamera(scene, Math.PI / 3, 0.05, 100);
camera.lookAt(new Vector3(0, 1.25, 4), new Vector3(0, 1.1, 0), Vector3.axisPY());
camera.controller = new OrbitCameraController({
  center: new Vector3(0, 1.1, 0)
});
scene.mainCamera = camera;

const keyLight = new DirectionalLight(scene);
keyLight.setColor(new Vector4(1, 1, 1, 1)).setIntensity(6);
keyLight.lookAt(new Vector3(3, 4, 4), new Vector3(0, 1, 0), Vector3.axisPY());
keyLight.castShadow = true;
keyLight.shadow.depthBias = 0.02;
keyLight.shadow.mode = 'pcf-opt';

const fillLight = new DirectionalLight(scene);
fillLight.setColor(new Vector4(0.45, 0.55, 0.7, 1)).setIntensity(2);
fillLight.lookAt(new Vector3(-4, 2, -3), new Vector3(0, 1, 0), Vector3.axisPY());

const floorMaterial = new LambertMaterial();
floorMaterial.albedoColor = new Vector4(0.34, 0.34, 0.34, 1);
const floor = new Mesh(scene, new PlaneShape({ size: 6, resolution: 6 }), floorMaterial);
floor.castShadow = false;
floor.position.setXYZ(0, 0, 0);

getInput().use(imGuiInjectEvent);
getInput().use(camera.handleEvent, camera);

getEngine().setRenderable(scene, 0, {
  afterRender() {
    renderButtons();
  }
});

app.run();

controller = await loadDemo();

async function loadDemo() {
  const bot = await getEngine().resourceManager.fetchModel(MODEL_URL, scene);
  bot.iterate((node) => {
    if (node.isMesh() && node.castShadow) {
      keyLight.shadow.shadowRegion.addDynamicCaster(node);
    }
  });
  // retarget idle animation to bot
  const idle = await getEngine().resourceManager.fetchModel(IDLE_ACTION_URL, scene);
  bot.animationSet.copyHumanoidAnimationFrom(idle.animationSet, idle.animationSet.getAnimationNames()[0], {
    targetName: 'idle'
  });
  // retarget running animation to bot
  const run = await getEngine().resourceManager.fetchModel(RUN_ACTION_URL, scene);
  bot.animationSet.copyHumanoidAnimationFrom(run.animationSet, run.animationSet.getAnimationNames()[0], {
    targetName: 'run'
  });

  const controller = new AnimationController(bot.animationSet);
  controller
    .addState('idle', {
      transition: 0.2,
      timeline: {
        steps: [
          {
            type: 'play',
            clip: 'idle',
            options: { repeat: 0 }
          }
        ]
      },
      responses: [
        {
          event: 'move',
          target: { targetState: 'run' }
        }
      ]
    })
    .addState('run', {
      transition: 0.2,
      timeline: {
        steps: [
          {
            type: 'play',
            clip: 'run',
            options: { repeat: 0 }
          }
        ]
      },
      responses: [
        {
          event: 'stopMove',
          target: { targetState: 'idle' }
        }
      ]
    });

  controller.setState('idle');
  return controller;
}

function renderButtons() {
  imGuiNewFrame();
  ImGui.SetNextWindowPos(new ImGui.ImVec2(12, 12), ImGui.Cond.FirstUseEver);
  ImGui.SetNextWindowSize(new ImGui.ImVec2(220, 0), ImGui.Cond.Always);
  ImGui.Begin('Dispatch events');

  if (ImGui.Button('Dispatch move event') && controller) {
    controller.dispatch('move');
  }
  if (ImGui.Button('Dispatch stopMove event') && controller) {
    controller.dispatch('stopMove');
  }

  ImGui.End();
  imGuiEndFrame();
}
