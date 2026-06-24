import { Vector3, Vector4 } from '@zephyr3d/base';
import { backendWebGL2 } from '@zephyr3d/backend-webgl';
import { GLTFImporter } from '@zephyr3d/loaders';
import { ImGui, imGuiEndFrame, imGuiInit, imGuiInjectEvent, imGuiNewFrame } from '@zephyr3d/imgui';
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
  Scene
} from '@zephyr3d/scene';

const MODEL_URL = 'https://cdn.zephyr3d.org/misc/xbot.glb';
const ACTIONS = [
  { id: 'idle', label: 'Idle', url: 'https://cdn.zephyr3d.org/misc/idle.glb' },
  { id: 'walk', label: 'Walk', url: 'https://cdn.zephyr3d.org/misc/walking.glb' },
  { id: 'run', label: 'Run', url: 'https://cdn.zephyr3d.org/misc/running.glb' },
  { id: 'pistol_walk', label: 'Pistol Walk', url: 'https://cdn.zephyr3d.org/misc/pistolwalk.glb' }
];

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

const state = {
  loading: true,
  status: 'Loading xbot mesh...',
  error: '',
  /** @type {null|import('@zephyr3d/scene').SceneNode} */
  target: null,
  upperIndex: 3,
  lowerIndex: 1,
  activeUpper: '',
  activeLower: ''
};

getEngine().setRenderable(scene, 0, {
  afterRender() {
    renderPanel();
  }
});

app.on('resize', (width, height) => {
  camera.aspect = width / height;
});

app.on('tick', () => {
  camera.updateController();
});

app.run();

loadDemo().catch((err) => {
  console.error(err);
  state.loading = false;
  state.error = err instanceof Error ? err.message : `${err}`;
});

async function loadDemo() {
  state.target = await getEngine().resourceManager.fetchModel(MODEL_URL, scene);
  state.target.name = 'XBot retarget target';
  state.target.iterate((child) => {
    if (child.isMesh()) {
      keyLight.shadow.shadowRegion.addDynamicCaster(child);
    }
  });

  const sourceModels = [];
  for (const action of ACTIONS) {
    state.status = `Loading ${action.label} animation...`;
    const source = await getEngine().resourceManager.fetchModel(action.url, scene);
    source.showState = 'hidden';
    sourceModels.push(source);

    const sourceName = source.animationSet.getAnimationNames()[0];
    if (!sourceName) {
      throw new Error(`${action.label} source does not contain an animation clip`);
    }

    const clipName = action.id;
    const copied = state.target.animationSet.copyHumanoidAnimationFrom(
      source.animationSet,
      sourceName,
      clipName,
      {
        rootMotion: 'locked'
      }
    );
    if (!copied) {
      throw new Error(`Failed to retarget ${action.label} to xbot`);
    }

    action.clip = clipName;
    action.upperClip = `${clipName}_upper`;
    action.lowerClip = `${clipName}_lower`;

    const upper = state.target.animationSet.createSkeletalMaskedAnimation(clipName, action.upperClip, {
      type: 'humanoid',
      preset: 'upperBody',
      rootMotion: 'exclude'
    });
    const lower = state.target.animationSet.createSkeletalMaskedAnimation(clipName, action.lowerClip, {
      type: 'humanoid',
      preset: 'lowerBody',
      rootMotion: 'include'
    });
    if (!upper || !lower) {
      throw new Error(`Failed to create masked clips for ${action.label}`);
    }
  }

  for (const source of sourceModels) {
    source.pickable = false;
  }

  state.loading = false;
  state.status = 'Ready';
  restartBlend();
}

function renderPanel() {
  imGuiNewFrame();
  ImGui.SetNextWindowPos(new ImGui.ImVec2(12, 12), ImGui.Cond.FirstUseEver);
  ImGui.SetNextWindowSize(new ImGui.ImVec2(330, 0), ImGui.Cond.Always);
  ImGui.Begin('Retargeting + Masked Animation');

  if (state.error) {
    ImGui.Text('Failed to load demo assets');
    ImGui.Separator();
    ImGui.TextWrapped(state.error);
    ImGui.End();
    imGuiEndFrame();
    return;
  }

  if (state.loading) {
    ImGui.Text(state.status);
    ImGui.ProgressBar(-1, new ImGui.ImVec2(-1, 0), null);
    ImGui.End();
    imGuiEndFrame();
    return;
  }

  const labels = ACTIONS.map((action) => action.label);

  /** @type {[number]} */
  const upper = [state.upperIndex];
  if (ImGui.Combo('Upper body', upper, labels)) {
    state.upperIndex = upper[0];
    applyBlend();
  }

  /** @type {[number]} */
  const lower = [state.lowerIndex];
  if (ImGui.Combo('Lower body', lower, labels)) {
    state.lowerIndex = lower[0];
    applyBlend();
  }

  ImGui.End();
  imGuiEndFrame();
}

function applyBlend() {
  if (!state.target) {
    return;
  }
  const upperClip = ACTIONS[state.upperIndex].upperClip;
  const lowerClip = ACTIONS[state.lowerIndex].lowerClip;
  if (state.activeUpper !== upperClip || state.activeLower !== lowerClip) {
    state.target.animationSet.stopAnimation(state.activeUpper);
    state.target.animationSet.stopAnimation(state.activeLower);
    state.activeUpper = upperClip;
    state.activeLower = lowerClip;
    state.target.animationSet.playAnimation(state.activeUpper);
    state.target.animationSet.playAnimation(state.activeLower);
  }
}

function restartBlend() {
  if (!state.target) {
    return;
  }
  if (state.activeUpper) {
    state.target.animationSet.stopAnimation(state.activeUpper);
  }
  if (state.activeLower) {
    state.target.animationSet.stopAnimation(state.activeLower);
  }
  state.activeUpper = '';
  state.activeLower = '';
  applyBlend();
}
