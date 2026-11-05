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
    // The bar shows from the first progress on; without any, only the message shows
    const bar = /** @type {HTMLDivElement} */ (loadingElement.querySelector('#loading-bar'));
    bar.hidden = false;
    /** @type {HTMLDivElement} */ (bar.firstElementChild).style.width = `${fraction * 100}%`;
  },
  setMessage(text) {
    /** @type {HTMLDivElement} */ (loadingElement.querySelector('#loading-message')).textContent = text;
  },
  showError(message) {
    /** @type {HTMLDivElement} */ (loadingElement.querySelector('#loading-message')).textContent =
      `Startup failed: ${message}`;
  },
  hide() {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    // Let the bar fill up before fading out
    return wait(200)
      .then(() => {
        loadingElement.classList.add('done');
        return wait(300);
      })
      .then(() => loadingElement.remove());
  }
});

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

myApp
  .ready()
  .then(async function () {
    const startupScene = '/assets/CornellBox.zscn';
    const tasks = [];
    const preloadList = `${startupScene}.zpreload`;
    const pipelineCache = getEngine().pipelineCache;
    const [pipelineManifest, hasPreloadList] = await Promise.all([
      pipelineCache.loadManifest(),
      getEngine().VFS.exists(preloadList)
    ]);
    // Compile the recorded pipelines before the first draws, so they do not stall (WebGPU)
    if (pipelineManifest) {
      const pipelines = pipelineCache.createTask(
        pipelineCache.findEntries(pipelineManifest, { scenes: [startupScene] })
      );
      loading.trackPipelines(pipelines, 1);
      tasks.push(pipelines.run());
    }
    // Fetch the assets the scene loads, with a known total
    const assets = hasPreloadList ? getEngine().assetPreloader.createTask([preloadList]) : null;
    if (assets) {
      loading.trackPreload(assets, 2);
      tasks.push(assets.run());
    }
    // Without the list, nothing tells how far loading the scene got: it takes no share of the bar
    const sceneStage = loading.addStage('Loading scene', assets ? 1 : 0);
    await Promise.all(tasks);

    myApp.run();
    // The scene script sets up the orbit camera and the GI toggle
    await getEngine().startup(startupScene);
    assets?.release();
    // The first frame belongs to the scene stage: it compiles the shaders not precompiled
    await myApp.nextFrame();
    sceneStage.done();
    await loading.finish();
  })
  .catch((err) => loading.fail(err));
