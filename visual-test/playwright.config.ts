import { defineConfig } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.HARNESS_PORT ?? 4321);

/**
 * Backend/adapter matrix.
 *
 * Two facts about Chromium, both established by the Step 0 spike and both
 * load-bearing here:
 *
 *  1. `channel: 'chromium'` is mandatory. Playwright's default headless build
 *     is the "headless shell", where `navigator.gpu` exists but
 *     `requestAdapter()` always resolves to null - WebGPU is simply absent.
 *  2. The page must be served over http://127.0.0.1. WebGPU is only exposed in
 *     a secure context, and `about:blank` has an opaque (null) origin, so
 *     `navigator.gpu` is not injected there at all.
 *
 * The `-swiftshader` projects pin a software rasteriser, which the spike
 * confirmed is byte-reproducible run-to-run; their baselines are committed and
 * gate CI. The `-gpu` projects run the same scenes on the real adapter: their
 * output legitimately differs (the spike measured a 1/255 delta on a plain
 * clear colour), so their baselines are per-machine and git-ignored. They catch
 * regressions locally without ever being an authority.
 */
const SWIFTSHADER_WEBGL = ['--use-gl=angle', '--use-angle=swiftshader'];
const SWIFTSHADER_WEBGPU = [
  '--enable-unsafe-webgpu',
  '--use-webgpu-adapter=swiftshader',
  '--enable-features=Vulkan'
];

function project(name: string, backend: 'webgl2' | 'webgpu', adapter: 'swiftshader' | 'gpu', args: string[]) {
  return {
    name,
    metadata: { backend, adapter, convention: 'reverse' as const },
    use: {
      channel: 'chromium' as const,
      launchOptions: { args }
    }
  };
}

export default defineConfig({
  testDir: './tests',
  outputDir: './test-results',
  // Determinism is the product here: a retry that turns red into green would
  // hide exactly the flakiness this harness exists to surface.
  retries: 0,
  // Software rasterisation is slow; a heavy scene can take tens of seconds.
  timeout: 120_000,
  expect: { timeout: 15_000 },
  // Each worker drives its own browser. Kept low because the software
  // rasteriser is CPU-bound and the real-GPU projects contend for one adapter.
  workers: process.env.CI ? 2 : 3,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI
    ? [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]]
    : [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    // Traces/screenshots of the harness page itself are of little value (the
    // canvas is not the capture source); the diff PNGs are attached instead.
    trace: 'off',
    screenshot: 'off',
    video: 'off'
  },
  projects: [
    project('webgl2-swiftshader', 'webgl2', 'swiftshader', SWIFTSHADER_WEBGL),
    project('webgpu-swiftshader', 'webgpu', 'swiftshader', SWIFTSHADER_WEBGPU),
    project('webgl2-gpu', 'webgl2', 'gpu', []),
    project('webgpu-gpu', 'webgpu', 'gpu', ['--enable-unsafe-webgpu'])
  ],
  webServer: {
    command: `node ${JSON.stringify(path.join(__dirname, 'tools', 'serve.mjs'))} ${PORT}`,
    url: `http://127.0.0.1:${PORT}/index.html`,
    reuseExistingServer: !process.env.CI,
    stdout: 'ignore',
    stderr: 'pipe',
    timeout: 30_000
  }
});
