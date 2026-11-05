import type { VFS } from '@zephyr3d/base';
import type { Application } from '@zephyr3d/scene';
import { getEngine, LoadingProgress } from '@zephyr3d/scene';
import type { ProjectSettings } from './project';
import { createPipelineCacheTask } from './pipelinecache';
import { getScenePreloadPath } from './assetpreload';
import { DEFAULT_SPLASH_BACKGROUND } from '../build/templates';
import { installSplashScreen } from '../build/splash';

/**
 * Starts a preview the way a build's entry does: the splash screen tracks pipeline
 * precompilation, asset preloading and scene loading, and hides once the scene is drawn.
 * It replaces the editor's own loading mask.
 */
export async function startPreview(
  app: Application,
  vfs: VFS,
  settings: ProjectSettings,
  sceneOverride: string | null
) {
  const startupScene = sceneOverride ?? settings.startupScene ?? '';
  const splash =
    settings.defaultSplash !== false
      ? new LoadingProgress(installSplashScreen(settings.splashBackground ?? DEFAULT_SPLASH_BACKGROUND))
      : null;
  document.getElementById('zephyr-loading')?.remove();
  const loading: Promise<unknown>[] = [];
  const preloadList = startupScene ? getScenePreloadPath(startupScene) : '';
  const [pipelines, hasPreloadList] = await Promise.all([
    settings.precompilePipelines !== false ? createPipelineCacheTask(vfs) : null,
    preloadList ? vfs.exists(preloadList) : false
  ]);
  if (pipelines) {
    splash?.trackPipelines(pipelines, 1);
    loading.push(pipelines.run());
  }
  const assets = hasPreloadList ? getEngine().assetPreloader.createTask([preloadList]) : null;
  if (assets) {
    splash?.trackPreload(assets, 2);
    loading.push(assets.run());
  }
  // Without the list, nothing tells how far loading the scene got: it takes no share of the bar
  const sceneStage = splash?.addStage('Loading scene', assets ? 1 : 0);
  await Promise.all(loading);
  await getEngine().startup(startupScene, settings.startupScript);
  assets?.release();
  // The first frame compiles the shaders not precompiled
  await app.nextFrame();
  sceneStage?.done();
  await splash?.finish();
}
