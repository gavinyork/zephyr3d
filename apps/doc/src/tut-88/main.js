import { HttpFS } from '@zephyr3d/base';
import { Application, getEngine, LoadingProgress } from '@zephyr3d/scene';
import { backendWebGL2 } from '@zephyr3d/backend-webgl';
import { backendWebGPU } from '@zephyr3d/backend-webgpu';

// DDGI needs WebGPU; ?backend=webgl2 or ?backend=webgpu forces a backend.
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

// The loading screen is markup in index.html; this implements the LoadingScreen
// protocol on it, for LoadingProgress to show the progress
const loadingElement = document.querySelector('#loading');
const loading = new LoadingProgress({
  setProgress(fraction) {
    loadingElement.querySelector('#loading-bar > div').style.width = `${fraction * 100}%`;
  },
  setMessage(text) {
    loadingElement.querySelector('#loading-message').textContent = text;
  },
  showError(message) {
    loadingElement.querySelector('#loading-message').textContent = `Startup failed: ${message}`;
  },
  hide() {
    loadingElement.classList.add('done');
    return new Promise((resolve) => setTimeout(resolve, 300)).then(() => loadingElement.remove());
  }
});
const deviceStage = loading.addStage('Creating device');

const myApp = new Application({
  backend: await resolveBackend(),
  canvas: document.querySelector('#my-canvas'),
  runtimeOptions: {
    // The Cornell box project as the editor builds it: the scene, its script, the
    // pipelines recorded while editing it and the list of the assets it loads
    VFS: new HttpFS('https://cdn.zephyr3d.org/demos/cornellbox'),
    scriptsRoot: '/assets'
  }
});

myApp.ready().then(async function () {
  deviceStage.done();
  const startupScene = '/assets/CornellBox.zscn';
  const tasks = [];
  // Compile the recorded pipelines before the first draws, so they do not stall (WebGPU)
  const pipelineCache = getEngine().pipelineCache;
  const pipelineManifest = await pipelineCache.loadManifest();
  if (pipelineManifest) {
    const pipelines = pipelineCache.createTask(
      pipelineCache.findEntries(pipelineManifest, { scenes: [startupScene] })
    );
    loading.trackPipelines(pipelines, 1);
    tasks.push(pipelines.run());
  }
  // Fetch the assets the scene loads, with a known total
  const assets = getEngine().assetPreloader.createTask([`${startupScene}.zpreload`]);
  loading.trackPreload(assets, 2);
  tasks.push(assets.run());
  const sceneStage = loading.addStage('Loading scene');
  await Promise.all(tasks);

  myApp.run();
  // The scene script sets up the orbit camera and the GI toggle
  await getEngine().startup(startupScene);
  assets.release();
  sceneStage.done();
  // Hide the loading screen once the scene is on screen
  await myApp.nextFrame();
  await loading.finish();
}).catch((err) => loading.fail(err));
