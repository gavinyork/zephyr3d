# Pipeline Precompilation and Asset Preloading

The first time a draw needs a new combination of shader and render state, the browser compiles a pipeline, and the frame waits for it. In a scene with many materials and effects this shows up as hitches the first time something new appears on screen. Loading a scene has a second problem: until its assets are fetched, nothing knows how much is left, so a loading bar cannot move.

Zephyr3D solves both with recordings made ahead of time:

| Recording | File | Used to |
| --- | --- | --- |
| Pipeline cache | `/pipeline-cache.json` | Compile the recorded pipelines before the draws that need them |
| Preload list | `<scene>.zscn.zpreload`, beside each scene | Fetch a scene's assets first, with a known total, so the progress bar is accurate |

The editor records both and builds use them automatically. Applications written against the Scene API can use the same files through `getEngine().pipelineCache` and `getEngine().assetPreloader`.

> The code on this page is a fragment: imports and application setup are left out.

## Recording in the editor

**Recording pipelines.** The record button in the scene view toolbar (next to Play) plays the project in a new tab and records every pipeline it uses into `/pipeline-cache.json` at the project root. A red badge in the corner shows that recording is on. The file is written every few seconds and when the tab is hidden, so you can simply close the tab when done.

Only what is drawn gets recorded, so play through what matters: walk to each area, trigger the effects, switch the materials and settings the application switches. Each session adds to the recordings already there, so several short sessions are as good as one long one.

The file keeps one recording per backend. A WebGPU session does not record what WebGL2 needs, so if a build may fall back to WebGL2, record once on each.

**Warmup cameras.** Places the player only reaches later are easy to miss. Right-click a camera other than the active one in the scene hierarchy and check `Pipeline Warmup Camera`. While recording, the first time a scene is shown, each of its warmup cameras renders a few frames behind the scenes, so what it sees is recorded too. What is on screen does not change.

**Preload lists.** While recording, each scene loaded also records the assets it fetches into its preload list. When the project is built, the editor loads every scene once more to record the assets it needs from the start, and ships each list with the size of every file, so the loading progress is weighted by bytes.

**Settings.** `Project Settings → Precompile Recorded Pipelines` (on by default) controls whether builds ship the pipeline cache and compile it at startup. `Project → Clear Pipeline Cache...` deletes all recordings, for example after large material changes, so the next session starts clean.

## What a build does at startup

A project built by the editor starts up in this order:

1. Compile the recorded pipelines and preload the startup scene's assets, in parallel. The built-in splash screen shows both as one progress bar.
2. Load the startup scene, which now finds its assets in the cache, then release what the preload held.
3. Render the first frame, which compiles any pipeline that was not recorded, then hide the splash screen.

A missing pipeline cache or preload list is not an error: the build then compiles pipelines on demand and loads the scene without a known total.

## Using the recordings in code

The same steps in your own startup code, with a loading screen of your own:

```ts
const engine = getEngine();
const progress = new LoadingProgress(myLoadingScreen);

const loading: Promise<unknown>[] = [];
if (await engine.VFS.exists(PIPELINE_CACHE_FILE)) {
  const pipelines = engine.pipelineCache.createTask();
  progress.trackPipelines(pipelines, 1);
  loading.push(pipelines.run());
}
const assets = engine.assetPreloader.createTask(['/assets/main.zscn.zpreload']);
progress.trackPreload(assets, 2);
loading.push(assets.run());
await Promise.all(loading);

const scene = await engine.loadSceneFromFile('/assets/main.zscn');
assets.release();
// ... make the scene renderable and run the application
await progress.finish();
```

`LoadingProgress`, `PIPELINE_CACHE_FILE` and the task classes come from `@zephyr3d/scene`.

- **`LoadingProgress`** combines weighted stages into one bar that never goes back. `myLoadingScreen` implements `LoadingScreen`: `setProgress(fraction)`, and optionally `setMessage(text)`, `showError(message)` and `hide()`. Put the screen in your page's markup, so it shows before any script loads. `addStage()` adds stages of your own, such as loading the scene.
- **`pipelineCache.createTask()`** reads `/pipeline-cache.json` by default; pass other paths, or recordings already read, to compile those. Recordings of another backend are skipped. `run({ priority: 'background' })` compiles a few pipelines at a time spread over frames, for example to prepare the next level while the current one is playing; the default `'foreground'` compiles as fast as possible behind a loading screen.
- **`assetPreloader.createTask()`** fetches every recorded asset through the asset manager, so a later load of the scene finds them in its cache. The task keeps what it loaded until `release()`; call it once the scene is loaded, and assets nothing else took are freed.

## Checking coverage

`getEngine().pipelineCache.getStats()` reports how pipelines were made:

| Field | Meaning |
| --- | --- |
| `precompiled` | Compiled ahead of time |
| `precompiledUsed` | Of those, used by a draw or dispatch |
| `onDemand` | Compiled when a draw needed them, stalling it |
| `onDemandPrograms` | The programs of the latest on-demand pipelines |

A growing `onDemand` during play means the recording missed something: record again through that part, or add a warmup camera there. A low `precompiledUsed` compared with `precompiled` means the cache holds pipelines the application no longer uses; clear it and record again.

## Recording without the editor

The device records pipelines itself. `getDevice().getPipelineRecorder()` returns the recorder (or null when the device has nothing to record); call `begin()` before the first frame, render, then `export(tag)` gives the `PipelineCacheData` to store. `pushTag()`/`popTag()` group pipelines, for example one tag per level. Start recording before the first frame: render bundles replay their draws without asking for pipelines again, so pipelines used only inside bundles recorded earlier are missed.

## Limits and pitfalls

- A recording only matches the shaders it was made with. After upgrading the engine or changing materials, shaders change and the old entries no longer match; they are skipped, compiled for nothing, or take time without helping. Record again before releasing.
- WebGPU recordings list the device features they relied on. On a device lacking one of them, a warning is printed and the pipelines that depend on it may fail to compile; those draws still work, compiled on demand.
- On WebGL2 the cache compiles shader programs; the remaining state is cheap to set and is not cached.
- Fetches made with options that cannot be stored, such as callbacks or a custom VFS, are not recorded in preload lists; those assets load when the scene asks for them.
- Preloaded assets stay in memory until `release()`. A list recorded long ago may include assets the scene no longer uses; they cost loading time and are freed on release.
