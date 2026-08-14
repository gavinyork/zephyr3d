import { backendWebGL2 } from '@zephyr3d/backend-webgl';
import { backendWebGPU } from '@zephyr3d/backend-webgpu';
import { Application, getDevice } from '@zephyr3d/scene';
import { SceneCapturer } from './capture';
import { findScene, SCENES } from './registry';
import type { BackendId, CaptureResult } from './types';

/**
 * Capture resolution. Small on purpose: the SwiftShader gate is CPU-bound, and
 * a regression that is invisible at 512x512 is not one worth gating on.
 */
const CAPTURE_SIZE = 512;

interface HarnessApi {
  init(backend: BackendId): Promise<{ backend: BackendId; adapter: string }>;
  listScenes(): { name: string; description: string; frames: number }[];
  runScene(name: string): Promise<CaptureResult>;
}

let app: Application | null = null;
let capturer: SceneCapturer | null = null;

async function init(backend: BackendId) {
  if (app) {
    throw new Error('harness already initialised; reload the page to switch backend');
  }
  const canvas = document.querySelector<HTMLCanvasElement>('#canvas')!;
  app = new Application({
    canvas,
    backend: backend === 'webgpu' ? backendWebGPU : backendWebGL2,
    enableMSAA: false,
    // Never let the host's display scaling reach the engine. The capture target
    // is an offscreen framebuffer anyway, but the device sizes itself from this.
    pixelRatio: 1
  });
  await app.ready();
  const device = getDevice();
  capturer = new SceneCapturer(app, backend, CAPTURE_SIZE);
  return { backend, adapter: describeAdapter(device) };
}

/**
 * Describes the adapter the engine device is actually running on.
 *
 * Recorded into the test output so that a baseline mismatch caused by running on
 * the wrong adapter is self-evident rather than a mystery diff - which matters
 * because the SwiftShader and real-GPU tracks share every scene and differ by as
 * little as one least-significant bit.
 *
 * Must come from `device.getAdapterInfo()` (implemented by both backends), not
 * from probing a throwaway WebGL context: `--use-webgpu-adapter=swiftshader`
 * switches only WebGPU, so a WebGL probe cheerfully reports the real GPU while
 * WebGPU is on SwiftShader - exactly the confusion this line exists to prevent.
 */
function describeAdapter(device: ReturnType<typeof getDevice>): string {
  return `${device.type} :: ${unmaskedWebglRenderer(device) ?? formatAdapterInfo(device.getAdapterInfo())}`;
}

function formatAdapterInfo(info: any): string {
  if (!info) {
    return 'unknown';
  }
  if (typeof info === 'string') {
    return info;
  }
  const parts = [info.vendor, info.architecture, info.device, info.description, info.renderer].filter(
    Boolean
  );
  return parts.length ? parts.join(' / ') : 'unknown';
}

/**
 * The WebGL backend's `getAdapterInfo()` reports the masked vendor/renderer
 * ("WebKit / WebKit WebGL"), which is identical on SwiftShader and on a real GPU
 * and so cannot serve the one purpose this string has. The unmasked strings sit
 * behind WEBGL_debug_renderer_info on the device's own context; reaching for that
 * context needs a cast, since it is a WebGL-backend detail rather than part of
 * AbstractDevice. Diagnostics only - nothing depends on the result.
 */
function unmaskedWebglRenderer(device: ReturnType<typeof getDevice>): string | null {
  const ctx = (device as unknown as { context?: WebGL2RenderingContext }).context;
  if (!ctx || typeof ctx.getExtension !== 'function') {
    return null;
  }
  const dbg = ctx.getExtension('WEBGL_debug_renderer_info');
  return dbg ? String(ctx.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : null;
}

const api: HarnessApi = {
  init,
  listScenes: () => SCENES.map((s) => ({ name: s.name, description: s.description, frames: s.frames ?? 1 })),
  async runScene(name: string) {
    const def = findScene(name);
    if (!def) {
      throw new Error(`unknown scene: ${name}`);
    }
    if (!capturer) {
      throw new Error('harness not initialised; call init() first');
    }
    return capturer.capture(def);
  }
};

(globalThis as unknown as { __zephyrHarness: HarnessApi }).__zephyrHarness = api;
// The runner waits on this rather than on a fixed timeout.
(globalThis as unknown as { __zephyrHarnessReady: boolean }).__zephyrHarnessReady = true;
