import { Vector3, Vector4 } from '@zephyr3d/base';
import { backendWebGL2 } from '@zephyr3d/backend-webgl';
import { GLTFImporter } from '@zephyr3d/loaders';
import {
  Application,
  DirectionalLight,
  getEngine,
  getInput,
  LambertMaterial,
  Mesh,
  OrbitCameraController,
  PerspectiveCamera,
  PlaneShape,
  Scene,
  NodeEulerRotationTrack
} from '@zephyr3d/scene';

export const MODEL_URL = 'https://cdn.zephyr3d.org/misc/xbot.glb';
export const ACTION_URLS = {
  idle: 'https://cdn.zephyr3d.org/misc/idle.glb',
  walk: 'https://cdn.zephyr3d.org/misc/walking.glb',
  run: 'https://cdn.zephyr3d.org/misc/running.glb',
  pistolwalk: 'https://cdn.zephyr3d.org/misc/pistolwalk.glb',
  wave: 'https://cdn.zephyr3d.org/misc/waving.glb',
  attack: 'https://cdn.zephyr3d.org/misc/attack.glb'
};

export async function createDemoShell(canvas, options = {}) {
  const app = new Application({
    backend: backendWebGL2,
    canvas,
    enableMSAA: true
  });

  await app.ready();

  getEngine().resourceManager.setModelLoader('model/gltf+json', new GLTFImporter());
  getEngine().resourceManager.setModelLoader('model/gltf-binary', new GLTFImporter());

  const scene = new Scene();
  scene.env.light.type = 'none';

  const camera = new PerspectiveCamera(scene, Math.PI / 3, 0.05, 100);
  camera.lookAt(
    options.cameraPosition ?? new Vector3(0, 1.25, 4),
    options.cameraTarget ?? new Vector3(0, 1.1, 0),
    Vector3.axisPY()
  );
  camera.controller = new OrbitCameraController({
    center: options.cameraCenter ?? new Vector3(0, 1.1, 0)
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
  const floor = new Mesh(
    scene,
    new PlaneShape({ size: options.floorSize ?? 6, resolution: 6 }),
    floorMaterial
  );
  floor.castShadow = false;
  floor.position.setXYZ(0, 0, 0);

  getInput().use(camera.handleEvent, camera);

  app.on('resize', (width, height) => {
    camera.aspect = width / height;
  });
  app.on('tick', () => {
    camera.updateController();
  });

  getEngine().setRenderable(scene, 0);

  return {
    app,
    scene,
    camera,
    keyLight,
    fillLight,
    floor
  };
}

export async function loadRetargetedBot(scene, keyLight, actions) {
  const bot = await getEngine().resourceManager.fetchModel(MODEL_URL, scene);
  bot.iterate((node) => {
    if (node.isMesh() && node.castShadow) {
      keyLight.shadow.shadowRegion.addDynamicCaster(node);
    }
  });

  for (const action of actions) {
    const source = await getEngine().resourceManager.fetchModel(action.url, scene);
    source.showState = 'hidden';
    const sourceName = action.sourceName ?? source.animationSet.getAnimationNames()[0];
    if (!sourceName) {
      throw new Error(`Animation source ${action.url} does not contain an animation clip`);
    }
    const targetName = action.targetName ?? sourceName;
    const copied = bot.animationSet.copyHumanoidAnimationFrom(source.animationSet, sourceName, targetName, {
      rootMotion: action.rootMotion ?? 'scaled'
    });
    if (!copied) {
      throw new Error(`Failed to retarget ${sourceName} to ${targetName}`);
    }
  }

  return bot;
}

export function createMaskedClip(bot, sourceName, targetName, options) {
  const clip = bot.animationSet.createSkeletalMaskedAnimation(sourceName, targetName, options);
  if (!clip) {
    throw new Error(`Failed to create masked clip ${targetName} from ${sourceName}`);
  }
  return clip;
}

export function createRotateClip(target, name, duration) {
  const clip = target.animationSet.createAnimation(name);
  clip.timeDuration = duration;
  clip.addTrack(
    target,
    new NodeEulerRotationTrack('linear', [
      { time: 0, value: new Vector3(0, 0, 0) },
      { time: duration, value: new Vector3(0, Math.PI * 2, 0) }
    ])
  );
  return clip;
}
