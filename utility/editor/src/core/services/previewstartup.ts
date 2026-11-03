import type { VFS } from '@zephyr3d/base';
import type { Application } from '@zephyr3d/scene';
import { generateSplashScreenHTML, getEngine, SplashScreen } from '@zephyr3d/scene';
import type { ProjectSettings } from './project';
import { createStartupPipelineTasks } from './pipelinecache';
import { getScenePreloadPath } from './assetpreload';
import { DEFAULT_SPLASH_BACKGROUND } from '../build/templates';

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
  let splash: SplashScreen | null = null;
  if (settings.defaultSplash !== false) {
    const markup = generateSplashScreenHTML({
      background: settings.splashBackground ?? DEFAULT_SPLASH_BACKGROUND
    });
    document.head.insertAdjacentHTML('beforeend', markup.head);
    document.body.insertAdjacentHTML('beforeend', markup.body);
    splash = SplashScreen.find();
  }
  document.getElementById('zephyr-loading')?.remove();
  const loading: Promise<unknown>[] = [];
  const pipelines =
    settings.precompilePipelines !== false ? await createStartupPipelineTasks(vfs, startupScene) : null;
  if (pipelines) {
    splash?.trackPipelines(pipelines.startup, 1);
    loading.push(pipelines.startup.run());
  }
  const assets = startupScene
    ? getEngine().assetPreloader.createTask([getScenePreloadPath(startupScene)])
    : null;
  if (assets) {
    splash?.trackPreload(assets, 2);
    loading.push(assets.run());
  }
  const sceneStage = splash?.addStage('Loading scene', 1);
  await Promise.all(loading);
  await getEngine().startup(startupScene, settings.startupScript);
  assets?.release();
  sceneStage?.done();
  await app.nextFrame();
  await splash?.hide();
  if (pipelines && settings.precompileOtherScenes !== false) {
    void pipelines.all().run({ priority: 'background' });
  }
}
