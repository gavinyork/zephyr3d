import { test as base, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareToBaseline, writeActualOnly } from './compare';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

type BackendId = 'webgl2' | 'webgpu';

interface SceneInfo {
  name: string;
  description: string;
  frames: number;
  /** False when the scene's own predicate rules out the live backend. */
  supported: boolean;
}

interface Harness {
  page: Page;
  backend: BackendId;
  adapter: string;
  scenes: SceneInfo[];
}

/**
 * The harness page is worker-scoped, not test-scoped.
 *
 * Device creation plus first-use shader compilation is by far the most
 * expensive thing here - especially on the software rasteriser - so the browser,
 * the page and the engine device are created once per worker and every scene
 * runs against them in turn. Each scene still gets a fresh Scene and camera
 * (see SceneCapturer.capture), so this shares cost without sharing state.
 */
const test = base.extend<{}, { harness: Harness }>({
  harness: [
    async ({ browser }, use, workerInfo) => {
      const meta = workerInfo.project.metadata as { backend: BackendId; convention: string };
      const page = await browser.newPage({ viewport: { width: 600, height: 600 } });

      const consoleErrors: string[] = [];
      page.on('console', (m) => {
        if (m.type() === 'error') {
          consoleErrors.push(m.text());
        }
      });
      page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));

      await page.goto(`/index.html?convention=${meta.convention}`);
      await page.waitForFunction(() => (globalThis as any).__zephyrHarnessReady === true);

      const info = await page.evaluate(
        (backend) => (globalThis as any).__zephyrHarness.init(backend),
        meta.backend
      );
      const scenes: SceneInfo[] = await page.evaluate(() => (globalThis as any).__zephyrHarness.listScenes());

      // Surfaced in the report header so a mismatch traced to the wrong adapter
      // is obvious rather than a mystery.
      console.log(`[${workerInfo.project.name}] adapter: ${info.adapter}, ${scenes.length} scene(s)`);

      await use({ page, backend: meta.backend, adapter: info.adapter, scenes });

      await page.close();
      if (consoleErrors.length) {
        // Reported after the run rather than mid-test: a console error that did
        // not change any pixels should not silently pass, but it also should not
        // be attributed to whichever scene happened to be running.
        console.warn(
          `[${workerInfo.project.name}] ${consoleErrors.length} console error(s):\n  ${consoleErrors.slice(0, 20).join('\n  ')}`
        );
      }
    },
    { scope: 'worker' }
  ]
});

// The scene list lives in the page, but Playwright needs test names up front.
// Kept in sync by asserting against the page's list in the first test rather
// than by duplicating scene metadata here.
const SCENE_NAMES = [
  'sanity-orientation',
  'unlit-textured',
  'pbr-metalrough-grid',
  'pbr-ibl',
  'sky-atmosphere',
  'shadow-hard',
  'shadow-pcf',
  'shadow-pcss',
  'shadow-vsm',
  'shadow-esm',
  'shadow-csm',
  'shadow-defaults',
  'shadow-normal-offset',
  'cluster-many-lights',
  'spot-shadow',
  'oit-weighted',
  'oit-abuffer',
  'oit-dual-depth',
  'post-tonemap-bloom',
  'post-fxaa',
  'taa-multiframe',
  'skin-sss',
  'skin-shadow',
  'hair',
  'hair-strands-helix',
  'hair-strands-fan',
  'hair-strands-width',
  'hair-strands-gpu-helix',
  'hair-shadow-pcf',
  'hair-shadow-dom',
  'hair-scatter-off',
  'hair-scatter-on',
  'eye-frontal',
  'eye-angled',
  'eye-pupil-dilated',
  'eye-socket-occlusion'
];

test('scene registry matches the harness page', async ({ harness }) => {
  expect(harness.scenes.map((s) => s.name)).toEqual(SCENE_NAMES);
});

for (const sceneName of SCENE_NAMES) {
  test(sceneName, async ({ harness }, testInfo) => {
    const meta = testInfo.project.metadata as { convention: string };
    // A scene may declare a backend it cannot run on - vertex-stage storage
    // buffers, for one, are WebGPU-only. Skipping is not the same as passing: a
    // skipped scene is visible in the report, so a feature silently losing its
    // only backend does not look like coverage.
    const info = harness.scenes.find((s) => s.name === sceneName);
    test.skip(info?.supported === false, `${sceneName} is unsupported on ${harness.backend}`);
    const result = await harness.page.evaluate(
      (name) => (globalThis as any).__zephyrHarness.runScene(name),
      sceneName
    );

    expect(result.width, 'capture width').toBeGreaterThan(0);
    const rgba = Buffer.from(result.rgbaBase64, 'base64');
    expect(rgba.length, 'capture byte length').toBe(result.width * result.height * 4);

    // A fully uniform capture almost always means the scene failed to render
    // rather than that it legitimately produced a flat image. Checked before the
    // comparison, so that UPDATE_BASELINES can never accept a blank frame as a
    // baseline - which would leave the scene permanently green while testing
    // nothing.
    const distinct = new Set<number>();
    for (let i = 0; i < rgba.length && distinct.size <= 4; i += 4) {
      distinct.add((rgba[i] << 16) | (rgba[i + 1] << 8) | rgba[i + 2]);
    }
    if (distinct.size <= 1) {
      for (const a of writeActualOnly(rgba, result.width, result.height, testInfo.outputPath())) {
        await testInfo.attach(a.name, { path: a.path, contentType: 'image/png' });
      }
    }
    expect(distinct.size, `scene "${sceneName}" produced a near-uniform image`).toBeGreaterThan(1);

    const baselinePath = path.join(
      ROOT,
      'baselines',
      testInfo.project.name,
      meta.convention,
      `${sceneName}.png`
    );
    const outcome = compareToBaseline(
      rgba,
      result.width,
      result.height,
      baselinePath,
      testInfo.outputPath(),
      result.tolerance
    );

    for (const a of outcome.artifacts) {
      await testInfo.attach(a.name, { path: a.path, contentType: 'image/png' });
    }

    if (outcome.status === 'baseline-written') {
      testInfo.annotations.push({ type: 'baseline', description: outcome.message });
      return;
    }
    expect(outcome.status, `${sceneName}: ${outcome.message}`).toBe('match');
  });
}
