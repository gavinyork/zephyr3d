/**
 * Capture the opt-in cloud shaping scenes without starting a local server.
 * Build the scene package and visual-test first, then run from visual-test:
 *
 *   node tools/cloud-diagnostics.mjs
 *   node tools/cloud-diagnostics.mjs --adapter=swiftshader
 *   node tools/cloud-diagnostics.mjs --scenes=cloud-density-xy,cloud-controlled-detail
 *   node tools/cloud-diagnostics.mjs --scenes=cloud-profile-*
 *   node tools/cloud-diagnostics.mjs --init-only
 *   node tools/cloud-diagnostics.mjs --checks-only
 *   node tools/cloud-diagnostics.mjs --profile
 *
 * PNGs and summary.json are diagnostic artifacts, not accepted baselines.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { chromium } from '@playwright/test';
import { PNG } from 'pngjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseOptions(args) {
  const options = {
    adapter: 'gpu',
    scenes: [],
    output: path.join(root, 'test-results', 'cloud-diagnostics')
  };
  for (const arg of args) {
    if (arg === '--help' || arg === '-h') {
      console.log(
        'Usage: node tools/cloud-diagnostics.mjs [--adapter=gpu|swiftshader] ' +
          '[--scenes=name,pattern*] [--output=directory] [--init-only]\n' +
          '       Add --checks to capture plus GPU checks, or --checks-only for GPU checks alone.\n' +
          '       --cloud-overrides=JSON adjusts approved numeric diagnostic cloud parameters.\n' +
          '       --profile records whole-scene per-frame GPU timestamps and memory usage.\n' +
          'Loads dist/index.html over file://; does not start a server or accept baselines.'
      );
      process.exit(0);
    } else if (arg.startsWith('--adapter=')) {
      options.adapter = arg.slice('--adapter='.length);
    } else if (arg.startsWith('--scenes=')) {
      options.scenes = arg.slice('--scenes='.length).split(',').filter(Boolean);
    } else if (arg.startsWith('--output=')) {
      options.output = path.resolve(arg.slice('--output='.length));
    } else if (arg.startsWith('--cloud-overrides=')) {
      options.cloudOverrides = JSON.parse(arg.slice('--cloud-overrides='.length));
      if (
        typeof options.cloudOverrides !== 'object' ||
        options.cloudOverrides === null ||
        Array.isArray(options.cloudOverrides)
      ) {
        throw new Error('--cloud-overrides must be a JSON object');
      }
    } else if (arg === '--init-only') {
      options.initOnly = true;
    } else if (arg === '--checks') {
      options.checks = true;
    } else if (arg === '--checks-only') {
      options.checks = true;
      options.initOnly = true;
    } else if (arg === '--profile') {
      options.profile = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (options.adapter !== 'gpu' && options.adapter !== 'swiftshader') {
    throw new Error('--adapter must be gpu or swiftshader');
  }
  return options;
}

function matchesScene(name, patterns) {
  return (
    patterns.length === 0 ||
    patterns.some((pattern) => {
      const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*');
      return new RegExp(`^${escaped}$`).test(name);
    })
  );
}

function pixelStats(rgba) {
  let min = 255;
  let max = 0;
  let redSum = 0;
  let nonzeroRed = 0;
  const colors = new Set();
  for (let offset = 0; offset < rgba.length; offset += 4) {
    min = Math.min(min, rgba[offset]);
    max = Math.max(max, rgba[offset]);
    redSum += rgba[offset];
    nonzeroRed += rgba[offset] > 0 ? 1 : 0;
    colors.add((rgba[offset] << 16) | (rgba[offset + 1] << 8) | rgba[offset + 2]);
  }
  const pixels = rgba.length / 4;
  return {
    minRed: min,
    maxRed: max,
    meanRed: redSum / pixels,
    nonzeroRedFraction: nonzeroRed / pixels,
    distinctRgb: colors.size
  };
}

function writeMetricSection(rgba, width, height, output, overrides = {}) {
  // XY debug textures span 64 km x 5 km but occupy a square image. Crop
  // the central 16 km and present it with equal metres per output pixel.
  const cropWidth = Math.round(width / 4);
  const cropX = Math.floor((width - cropWidth) / 2);
  const extentWidth = overrides.weatherMapScale ?? 64000;
  const extentHeight = overrides.layerHeight ?? 5000;
  const metricWidth = extentWidth / 4;
  const outputWidth = 512;
  const outputHeight = Math.max(1, Math.round((outputWidth * extentHeight) / metricWidth));
  const image = new PNG({ width: outputWidth, height: outputHeight });
  for (let y = 0; y < outputHeight; y++) {
    const sourceY = Math.min(height - 1, Math.floor(((y + 0.5) * height) / outputHeight));
    for (let x = 0; x < outputWidth; x++) {
      const sourceX = cropX + Math.min(cropWidth - 1, Math.floor(((x + 0.5) * cropWidth) / outputWidth));
      const sourceOffset = (sourceY * width + sourceX) * 4;
      rgba.copy(image.data, (y * outputWidth + x) * 4, sourceOffset, sourceOffset + 4);
    }
  }
  fs.writeFileSync(output, PNG.sync.write(image));
  return {
    sourceExtentMeters: { width: extentWidth, height: extentHeight },
    crop: {
      xPixels: cropX,
      widthPixels: cropWidth,
      xMeters: extentWidth * 0.375,
      widthMeters: metricWidth,
      heightMeters: extentHeight
    },
    outputPixels: { width: outputWidth, height: outputHeight },
    interpolation: 'nearest'
  };
}

async function run(options) {
  const entry = path.join(root, 'dist', 'index.html');
  if (!fs.existsSync(entry)) {
    throw new Error(`Missing built harness: ${entry}. Run npm run build first.`);
  }
  fs.mkdirSync(options.output, { recursive: true });
  const url = pathToFileURL(entry);
  url.searchParams.set('diagnostics', 'clouds');
  if (options.profile) {
    url.searchParams.set('profile', '1');
  }
  if (options.cloudOverrides) {
    url.searchParams.set('cloudOverrides', JSON.stringify(options.cloudOverrides));
  }
  const launchArgs = ['--allow-file-access-from-files', '--enable-unsafe-webgpu'];
  if (options.adapter === 'swiftshader') {
    launchArgs.push('--use-webgpu-adapter=swiftshader', '--enable-features=Vulkan');
  }
  const summary = {
    entry: url.href,
    adapterRequested: options.adapter,
    launchArgs,
    platform: `${process.platform}-${process.arch}`,
    timing: 'Capture duration is host wall time including rendering and readback; not GPU time.',
    acceptedBaselines: false,
    cloudOverrides: options.cloudOverrides ?? {},
    console: [],
    pageErrors: [],
    scenes: []
  };
  const summaryPath = path.join(options.output, 'summary.json');
  const saveSummary = () => fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2) + '\n');
  let browser;
  let activeScene = null;
  try {
    browser = await chromium.launch({ channel: 'chromium', headless: true, args: launchArgs });
    summary.chromium = browser.version();
    const page = await browser.newPage({ viewport: { width: 600, height: 600 } });
    page.on('console', (message) => {
      if (message.type() === 'error' || message.type() === 'warning') {
        const item = {
          scene: activeScene,
          type: message.type(),
          text: message.text(),
          location: message.location()
        };
        if (
          activeScene === null &&
          item.text.includes('ERR_FILE_NOT_FOUND') &&
          item.location.url.endsWith('/asset-manifest.json')
        ) {
          // Engine.init probes this optional editor-build manifest. These
          // procedural diagnostics have no external assets or manifest.
          item.optionalResource = 'Absent editor-build manifest; no cloud assets depend on it.';
        }
        summary.console.push(item);
        console.error(`[browser ${item.type}] ${item.text}`);
      }
    });
    page.on('pageerror', (error) => {
      summary.pageErrors.push({ scene: activeScene, message: error.stack ?? error.message });
      console.error(`[pageerror] ${error.message}`);
    });
    await page.goto(url.href);
    await page.waitForFunction(() => globalThis.__zephyrHarnessReady === true, null, { timeout: 30000 });
    summary.context = await page.evaluate(() => ({ secure: isSecureContext, webgpu: !!navigator.gpu }));
    summary.adapter = await page.evaluate(() => globalThis.__zephyrHarness.init('webgpu'));
    console.log(`Adapter: ${summary.adapter.adapter}`);
    const available = await page.evaluate(() => globalThis.__zephyrHarness.listScenes());
    summary.availableScenes = available;
    const selected = available.filter((scene) => matchesScene(scene.name, options.scenes));
    for (const pattern of options.scenes) {
      if (!available.some((scene) => matchesScene(scene.name, [pattern]))) {
        throw new Error(`No cloud diagnostic scene matches: ${pattern}`);
      }
    }
    if (options.checks) {
      activeScene = 'GPU cloud checks';
      const checks = await page.evaluate(() => globalThis.__zephyrHarness.runCloudChecks());
      const filename = 'checks.json';
      fs.writeFileSync(path.join(options.output, filename), JSON.stringify(checks, null, 2) + '\n');
      summary.checks = { json: filename, passed: checks.passed, elapsedMs: checks.elapsedMs };
      console.log(`GPU cloud checks: ${checks.passed ? 'passed' : 'failed'}`);
      activeScene = null;
      saveSummary();
    }
    if (!options.initOnly) {
      for (const scene of selected) {
        activeScene = scene.name;
        const started = performance.now();
        const item = { name: scene.name, description: scene.description, frames: scene.frames };
        try {
          if (!scene.supported) {
            throw new Error('Cloud scene does not support the active backend');
          }
          const capture = await page.evaluate(
            (name) => globalThis.__zephyrHarness.runScene(name),
            scene.name
          );
          const rgba = Buffer.from(capture.rgbaBase64, 'base64');
          if (rgba.length !== capture.width * capture.height * 4) {
            throw new Error(`Invalid RGBA length: ${rgba.length}`);
          }
          const image = new PNG({ width: capture.width, height: capture.height });
          image.data = rgba;
          const filename = `${scene.name}.png`;
          fs.writeFileSync(path.join(options.output, filename), PNG.sync.write(image));
          Object.assign(item, {
            status: 'captured',
            png: filename,
            width: capture.width,
            height: capture.height,
            statistics: pixelStats(rgba)
          });
          if (capture.gpuTimingMs) {
            const steady = capture.gpuTimingMs
              .filter(
                (timing) =>
                  timing.frame > 0 && timing.status === 'resolved' && Number.isFinite(timing.durationMs)
              )
              .map((timing) => timing.durationMs)
              .sort((a, b) => a - b);
            Object.assign(item, {
              gpuTimingMs: capture.gpuTimingMs,
              videoMemoryUsage: capture.videoMemoryUsage,
              steadyGpuMedianMs: steady.length
                ? (steady[Math.floor((steady.length - 1) / 2)] + steady[Math.floor(steady.length / 2)]) / 2
                : null,
              gpuTimingScope:
                'Whole scene render; frame 0 initialization excluded from median. Each subsequent frame traces 1/4 of the cloud sky cache.'
            });
          }
          if (scene.name === 'cloud-base-density-xy' || scene.name === 'cloud-density-xy') {
            const metricName = `${scene.name}.metric.png`;
            item.metricSection = {
              png: metricName,
              ...writeMetricSection(
                rgba,
                capture.width,
                capture.height,
                path.join(options.output, metricName),
                options.cloudOverrides
              )
            };
          }
          console.log(`${scene.name}: saved ${filename}`);
        } catch (error) {
          item.status = 'failed';
          item.error = error.stack ?? String(error);
          console.error(`${scene.name}: ${error.message}`);
        }
        item.durationMs = Math.round((performance.now() - started) * 100) / 100;
        summary.scenes.push(item);
        saveSummary();
      }
    }
    summary.status =
      summary.scenes.some((scene) => scene.status === 'failed') ||
      summary.checks?.passed === false ||
      summary.pageErrors.length > 0 ||
      summary.console.some((message) => message.type === 'error' && !message.optionalResource)
        ? 'failed'
        : options.initOnly
          ? 'initialized'
          : 'captured';
  } catch (error) {
    summary.status = 'failed';
    summary.error = error.stack ?? String(error);
    console.error(error.stack ?? String(error));
  } finally {
    activeScene = null;
    await browser?.close();
    saveSummary();
  }
  console.log(`Summary: ${summaryPath}`);
  if (summary.status === 'failed') {
    process.exitCode = 1;
  }
}

await run(parseOptions(process.argv.slice(2)));
