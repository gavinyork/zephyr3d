import type { Application } from '@zephyr3d/scene';
import { getDevice } from '@zephyr3d/scene';
import type { CaptureResult } from './capture';
import { canvasToDataUrl } from './capture';

export interface HeadlessCaptureOptions {
  /** Number of frames to render before capture (>= 1). */
  frames: number;
  /** Fixed timestep in milliseconds, or null to use wall-clock timing. */
  fixedDt: number | null;
  mimeType?: string;
}

/**
 * Renders exactly `frames` frames by manually stepping the application, then
 * captures the canvas of the final frame.
 *
 * Each step goes through Application.stepFrame() so all per-frame
 * non-idempotent state (history buffer ping-pong, frame counter, motion
 * vector matrices) advances exactly once per rendered frame. The application
 * run loop must not be active.
 */
export async function runHeadlessCapture(
  app: Application,
  opts: HeadlessCaptureOptions
): Promise<CaptureResult> {
  const device = getDevice();
  if (opts.fixedDt !== null) {
    device.setFixedFrameTime(opts.fixedDt);
  }
  const frames = Math.max(1, Math.floor(opts.frames) || 1);
  let stalls = 0;
  for (let i = 0; i < frames; i++) {
    // Yield one macrotask between frames so in-flight asset loads (e.g. the
    // fire-and-forget sky panorama fetch) and promise chains can settle.
    // Deliberately NOT requestAnimationFrame: hidden windows must not depend
    // on compositor vsync.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    if (!app.stepFrame()) {
      // beginFrame() refused (e.g. context lost); retry a bounded number of times.
      if (++stalls > 100) {
        throw new Error('Headless capture failed: device refused to begin frame (context lost?)');
      }
      i--;
      continue;
    }
    stalls = 0;
  }
  // CRITICAL: no await between the final stepFrame() above and canvasToDataUrl()
  // below - toBlob must be initiated in the same JS task as the last draw
  // (GPU-backed canvases, especially WebGPU, may not remain serializable once
  // the task that drew them completes).
  const canvas = device.canvas as HTMLCanvasElement;
  const dataUrl = await canvasToDataUrl(canvas, opts.mimeType ?? 'image/png');
  return { width: canvas.width, height: canvas.height, dataUrl };
}
