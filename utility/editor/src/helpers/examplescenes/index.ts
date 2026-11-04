import { buildingsScene } from './buildings';
import { cornellBoxScene } from './cornellbox';
import { terrainScene } from './terrain';
import type { ExampleSceneType } from './common';

export * from './common';

export const exampleSceneTypes: readonly ExampleSceneType[] = [cornellBoxScene, buildingsScene, terrainScene];
