import { test as base, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareToBaseline, encodeCapturePng, judgeCapture, recordCapture, writeActualOnly } from './compare';
import { platformKey } from './digest';
import { DigestFile, type DigestEnvironment } from './digest_file';
import { HttpImageSource, ImageStore } from './image_store';
import { createRequire } from 'node:module';

const PLAYWRIGHT_VERSION = (
  createRequire(import.meta.url)('@playwright/test/package.json') as { version: string }
).version;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
/** Captures that missed their digest; uploaded by CI as the `visual-captures` artifact. */
const CAPTURES_DIR = process.env.VISUAL_CAPTURES_DIR ?? path.join(ROOT, '.baseline-cache', 'captures');

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
  /** Digest baselines; null on the real-GPU projects, which keep per-machine PNGs. */
  digests: DigestFile | null;
  images: ImageStore;
  environment: DigestEnvironment;
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
      const meta = workerInfo.project.metadata as {
        backend: BackendId;
        adapter: 'swiftshader' | 'gpu';
        convention: string;
      };
      const page = await browser.newPage({ viewport: { width: 600, height: 600 } });

      const consoleErrors: string[] = [];
      page.on('console', (m) => {
        if (m.type() === 'error') {
          // Chromium's text for a failed load ("Failed to load resource: ...")
          // does not name the resource; the location does.
          const url = m.location().url;
          consoleErrors.push(url ? `${m.text()} (${url})` : m.text());
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

      // Only the software rasteriser is reproducible enough to be pinned by
      // digests; see README "Baselines".
      const digests =
        meta.adapter === 'swiftshader'
          ? DigestFile.load(DigestFile.pathFor(ROOT, workerInfo.project.name, meta.convention))
          : null;
      const images = new ImageStore(path.join(ROOT, '.baseline-cache'), new HttpImageSource());
      const environment: DigestEnvironment = {
        playwright: PLAYWRIGHT_VERSION,
        chromium: browser.version(),
        adapter: info.adapter
      };
      const recorded = digests?.environment(platformKey());
      if (
        recorded &&
        (recorded.playwright !== environment.playwright || recorded.chromium !== environment.chromium)
      ) {
        console.warn(
          `[${workerInfo.project.name}] digests for ${platformKey()} were recorded with Playwright ` +
            `${recorded.playwright} / Chromium ${recorded.chromium}, this run uses ${environment.playwright} / ` +
            `${environment.chromium}: expect digest misses that are environment changes, not regressions`
        );
      }

      await use({ page, backend: meta.backend, adapter: info.adapter, scenes, digests, images, environment });

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
  'ktx2-basis',
  'gltf-compression',
  'quantized-vertices',
  'zmsh-binary',
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
  'cluster-many-lights-ortho',
  'spot-shadow',
  'rect-light-diffuse',
  'rect-light-glossy',
  'rect-light-physical',
  'rect-light-shadow',
  'rect-light-materials',
  'rect-light-blueprint',
  'rect-light-pcss-small',
  'rect-light-pcss-large',
  'rect-light-pcss-wall',
  'rect-light-auto-range',
  'rect-light-shadow-dom',
  'point-light-shadow-dom',
  'water-caustics-off',
  'water-caustics-on',
  'water-caustics-deep-bed',
  'water-caustics-moving',
  'water-caustics-two-pools',
  'water-caustics-crest',
  'water-caustics-range-border',
  'water-surface-grazing',
  'water-infinite-horizon',
  'water-infinite-horizon-raised',
  'water-horizon-reflect',
  'water-infinite-horizon-control',
  'water-refraction-cheap',
  'water-subsurface-backlit',
  'water-foam-storm',
  'water-foam-gerstner',
  'oit-weighted',
  'oit-abuffer',
  'oit-dual-depth',
  'post-tonemap-bloom',
  'post-fxaa',
  'post-motionblur-object',
  'post-motionblur-rotation',
  'post-motionblur-camera',
  'post-motionblur-trailing',
  'post-motionblur-long',
  'taa-multiframe',
  'sss',
  'sss-diffusion-jade',
  'sss-shadow',
  'transmission-thickness-ladder',
  'transmission-thickness-scale',
  'transmission-thickness-slant',
  'transmission-thickness-sphere',
  'transmission-thickness-sphere-fine',
  'transmission-thickness-ladder-point',
  'transmission-thickness-ladder-rect',
  'transmission-rect-backlit',
  'hair',
  'hair-strands-helix',
  'hair-file-helix',
  'hair-strands-fan',
  'hair-strands-width',
  'hair-strands-gpu-helix',
  'hair-node-transform',
  'hair-simulation',
  'hair-simulation-motion',
  'hair-simulation-jitter',
  'hair-simulation-motion-vectors',
  'hair-simulation-motion-rest',
  'hair-simulation-motion-blended',
  'hair-shadow-receive',
  'hair-shadow-dom-deep',
  'hair-shadow-pcf',
  'hair-shadow-dom',
  'hair-scatter-off',
  'hair-scatter-on',
  'hair-marschner',
  'hair-marschner-strands',
  'eye-frontal',
  'eye-angled',
  'eye-pupil-dilated',
  'eye-socket-occlusion',
  'skin-instanced-cpu',
  'skin-animation-bank',
  'skin-gpu-animation',
  'batch-instance-culling',
  'batch-instance-culling-off',
  'skin-batch-instance-culling',
  'skin-batch-instance-culling-off',
  'batch-instance-culling-growing',
  'batch-instance-culling-growing-off',
  'physics-drop',
  'physics-mesh-ground',
  'physics-joints',
  'physics-vehicle'
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

    if (harness.digests) {
      const judged = await judgeCapture(rgba, result.width, result.height, {
        scene: sceneName,
        platform: platformKey(),
        digests: harness.digests,
        images: harness.images,
        tolerance: result.tolerance,
        deterministic: result.deterministic,
        update: !!process.env.UPDATE_BASELINES,
        artifactDir: testInfo.outputPath()
      });
      for (const a of judged.artifacts) {
        await testInfo.attach(a.name, { path: a.path, contentType: 'image/png' });
      }
      if (judged.status !== 'match' && judged.status !== 'baseline-written') {
        // Kept so the capture can be accepted later without re-rendering:
        // `baselines:accept` locally, `baselines:update-from-ci` from a CI run.
        recordCapture(CAPTURES_DIR, {
          project: testInfo.project.name,
          convention: meta.convention,
          scene: sceneName,
          platform: platformKey(),
          digest: judged.digest,
          size: result.width,
          status: judged.status,
          deterministic: result.deterministic,
          environment: harness.environment,
          png: encodeCapturePng(rgba, result.width, result.height)
        });
      }
      if (judged.digestsChanged) {
        harness.digests.setEnvironment(platformKey(), harness.environment);
        harness.digests.save();
      }
      if (judged.status === 'baseline-written' || judged.status === 'tolerant-match') {
        // Visible in the report: a tolerant match that persists means the
        // digest is stale, which is the cue to re-accept the scene.
        testInfo.annotations.push({ type: judged.status, description: judged.message });
        return;
      }
      expect(judged.status, `${sceneName}: ${judged.message}`).toBe('match');
      return;
    }

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
