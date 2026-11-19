import { AABB, Vector3, Vector4 } from '@zephyr3d/base';
import { backendWebGL2 } from '@zephyr3d/backend-webgl';
import { backendWebGPU } from '@zephyr3d/backend-webgpu';
import { GLTFImporter } from '@zephyr3d/loaders';
import {
  Application,
  CylinderShape,
  DirectionalLight,
  getDevice,
  getEngine,
  getInput,
  LambertMaterial,
  Mesh,
  NodeRotationTrack,
  NodeScaleTrack,
  NodeTranslationTrack,
  OrbitCameraController,
  PerspectiveCamera,
  PlaneShape,
  Scene
} from '@zephyr3d/scene';

const MODEL_URL = 'https://cdn.zephyr3d.org/misc/xbot.glb';
const CLIPS = [
  { name: 'idle', url: 'https://cdn.zephyr3d.org/misc/idle.glb' },
  { name: 'walk', url: 'https://cdn.zephyr3d.org/misc/walking.glb' },
  { name: 'run', url: 'https://cdn.zephyr3d.org/misc/running.glb' }
];
// Distance between neighbouring actors, in meters
const SPACING = 1.6;
// With hats on, one actor in HAT_EVERY wears one
const HAT_EVERY = 4;

// Baked poses are evaluated in a compute pass on WebGPU and on the CPU on WebGL2.
// ?backend=webgl2 or ?backend=webgpu forces a backend.
async function resolveBackend() {
  const forced = new URLSearchParams(location.search).get('backend');
  if (forced === 'webgl2') {
    return backendWebGL2;
  }
  if (forced === 'webgpu') {
    return backendWebGPU;
  }
  return (await backendWebGPU.supported()) ? backendWebGPU : backendWebGL2;
}

const app = new Application({
  backend: await resolveBackend(),
  canvas: document.querySelector('#my-canvas')
});

await app.ready();

getEngine().resourceManager.setModelLoader('model/gltf+json', new GLTFImporter());
getEngine().resourceManager.setModelLoader('model/gltf-binary', new GLTFImporter());

const scene = new Scene();

const sun = new DirectionalLight(scene);
sun.rotation.fromEulerAngle(-Math.PI / 3, Math.PI / 6, 0);
sun.castShadow = true;

const groundMaterial = new LambertMaterial();
groundMaterial.albedoColor = new Vector4(0.42, 0.44, 0.42, 1);
const ground = new Mesh(scene, new PlaneShape({ size: 80 }), groundMaterial);
ground.castShadow = false;

const camera = new PerspectiveCamera(scene, Math.PI / 3, 0.1, 500);
camera.lookAt(new Vector3(0, 7, 17), new Vector3(0, 1, 0), Vector3.axisPY());
camera.controller = new OrbitCameraController({ center: new Vector3(0, 1, 0) });
scene.mainCamera = camera;
getInput().use(camera.handleEvent, camera);

const hatShape = new CylinderShape({ topRadius: 8, bottomRadius: 8, height: 14 });
const hatMaterial = new LambertMaterial();
hatMaterial.albedoColor = new Vector4(0.1, 0.1, 0.12, 1);

/** @type {HTMLSelectElement} */
const sizeSelect = document.querySelector('#size-select');
/** @type {HTMLInputElement} */
const gpuCheck = document.querySelector('#gpu-check');
/** @type {HTMLInputElement} */
const hatCheck = document.querySelector('#hat-check');
const statsText = document.querySelector('#stats');
document.querySelector('#backend-note').textContent =
  app.device.type === 'webgpu'
    ? 'WebGPU: baked poses are evaluated in a compute pass.'
    : 'WebGL2: the crowd is still batched, but baked poses are evaluated on the CPU; the compute pass needs WebGPU.';

/** The actors in grid order, each with its hat or null */
const crowd = [];
/** Model instance holding the retargeted clips, never drawn */
let template = null;
let status = 'Loading model and clips...';

getEngine().setRenderable(scene, 0, {
  afterRender() {
    // Draw calls are counted per frame, so they are read once the scene is drawn
    if (getDevice().frameInfo.frameCounter % 10 === 0) {
      updateStats();
    }
  }
});

app.run();

sizeSelect.addEventListener('change', requestCrowd);
gpuCheck.addEventListener('change', function () {
  for (const entry of crowd) {
    entry.actor.animationSet.gpuAnimation = gpuCheck.checked;
  }
});
hatCheck.addEventListener('change', function () {
  crowd.forEach(updateHat);
});

// Crowd changes run one after another, once the clips are loaded
let crowdTask = loadDemo();
requestCrowd();

async function loadDemo() {
  // #region clips
  // The template is never drawn: it holds the clips retargeted from the
  // animation files, which every actor shares
  template = await getEngine().resourceManager.fetchModel(MODEL_URL, scene);
  if (!template) {
    throw new Error(`Cannot load ${MODEL_URL}`);
  }
  template.showState = 'hidden';
  for (const clip of CLIPS) {
    const source = await getEngine().resourceManager.fetchModel(clip.url, scene);
    const sourceName = source.animationSet.getAnimationNames()[0];
    const copied = template.animationSet.copyHumanoidAnimationFrom(source.animationSet, sourceName, {
      targetName: clip.name
    });
    if (!copied) {
      throw new Error(`Cannot retarget ${clip.url}`);
    }
    // The retargeted clip has its own copy of the keys
    source.dispose();
  }
  // #endregion clips
  status = '';
}

// #region share
// Track types a retargeted humanoid clip is made of
const TRACK_TYPES = [NodeRotationTrack, NodeTranslationTrack, NodeScaleTrack];

// Give an actor the clips of the template. Both are instances of the same model,
// so their nodes match one to one in traversal order. The new tracks reuse the
// interpolators of the template's tracks, so the keys are stored once for the
// whole crowd.
function shareClips(actor) {
  const templateNodes = [];
  const actorNodes = [];
  template.iterate((node) => {
    templateNodes.push(node);
  });
  actor.iterate((node) => {
    actorNodes.push(node);
  });
  const nodeMap = new Map(templateNodes.map((node, i) => [node, actorNodes[i]]));
  const rigIds = new Map(
    template.animationSet.rigs.map((ref, i) => [
      ref.get().persistentId,
      actor.animationSet.rigs[i].get().persistentId
    ])
  );
  for (const { name } of CLIPS) {
    const source = template.animationSet.get(name);
    const clip = actor.animationSet.createAnimation(name);
    clip.timeDuration = source.timeDuration;
    for (const id of source.skeletons) {
      clip.addSkeleton(rigIds.get(id));
    }
    for (const [target, tracks] of source.tracks) {
      for (const track of tracks) {
        const TrackType = TRACK_TYPES.find((type) => track instanceof type);
        clip.addTrack(nodeMap.get(target), new TrackType(track.interpolator));
      }
    }
  }
}
// #endregion share

// #region actor
async function createActor(index) {
  // The model data is cached after the first load, so this only builds nodes.
  // enableInstancing gives the meshes material instances: without them the
  // meshes are not batched at all.
  const actor = await getEngine().resourceManager.fetchModel(MODEL_URL, scene, {
    enableInstancing: true
  });
  shareClips(actor);
  actor.animationSet.gpuAnimation = gpuCheck.checked;
  // Each actor picks a clip, a speed and a phase of its own
  const clip = CLIPS[Math.floor(fract(index * 0.7548777) * CLIPS.length)].name;
  const playback = actor.animationSet.play(clip, { speedRatio: 0.85 + 0.3 * fract(index * 0.5698403) });
  playback.normalizedTime = fract(index * 0.618034);
  actor.rotation.fromEulerAngle(0, (fract(index * 0.4142136) - 0.5) * 0.8, 0);
  return actor;
}
// #endregion actor

function requestCrowd() {
  crowdTask = crowdTask.then(() => setCrowdSize(Number(sizeSelect.value)));
  crowdTask.catch(showError);
}

async function setCrowdSize(count) {
  while (crowd.length > count) {
    crowd.pop().actor.dispose();
  }
  const side = Math.ceil(Math.sqrt(count));
  const half = ((side - 1) * SPACING) / 2;
  // Keep the shadow map on the crowd rather than on the whole ground
  sun.shadow.shadowRegion.setRegion(
    new AABB(new Vector3(-half - 1, 0, -half - 1), new Vector3(half + 1, 2.5, half + 1))
  );
  const place = (entry, i) => {
    entry.actor.position.setXYZ((i % side) * SPACING - half, 0, Math.floor(i / side) * SPACING - half);
  };
  crowd.forEach(place);
  while (crowd.length < count) {
    status = `Adding actors: ${crowd.length} / ${count}`;
    const entry = { actor: await createActor(crowd.length), hat: null };
    place(entry, crowd.length);
    updateHat(entry, crowd.length);
    crowd.push(entry);
    // Let a frame through now and then, so the page keeps responding
    if (crowd.length % 10 === 0) {
      await app.nextFrame();
    }
  }
  status = '';
}

// #region hats
// A node attached below a joint follows the joint nodes, so an actor wearing
// a hat takes the regular path even with gpuAnimation on
function updateHat(entry, index) {
  const wear = hatCheck.checked && index % HAT_EVERY === 0;
  if (wear && !entry.hat) {
    entry.hat = new Mesh(scene, hatShape, hatMaterial.createInstance());
    entry.hat.parent = entry.actor.findNodeByName('mixamorig:Head');
    // The joints of this rig measure in centimeters
    entry.hat.position.setXYZ(0, 16, 2);
  } else if (!wear && entry.hat) {
    entry.hat.dispose();
    entry.hat = null;
  }
}
// #endregion hats

// #region stats
function updateStats() {
  let baked = 0;
  for (const entry of crowd) {
    if (entry.actor.animationSet.isPlayingOnGpu) {
      baked++;
    }
  }
  const info = getDevice().frameInfo;
  statsText.textContent = [
    status || `isPlayingOnGpu: ${baked} / ${crowd.length}`,
    `Draw calls: ${info.drawCalls}`,
    `CPU frame time: ${info.elapsedTimeCPU.toFixed(1)} ms`
  ].join('\n');
}
// #endregion stats

function fract(x) {
  return x - Math.floor(x);
}

function showError(err) {
  console.error(err);
  status = `Error: ${err instanceof Error ? err.message : err}`;
  statsText.textContent = status;
}
