/**
 * Frame-synchronized canvas capture helpers.
 *
 * Per-frame engine state (history buffer ping-pong, frame counter, motion
 * vector matrices) is non-idempotent, so screenshots must ride a real frame
 * instead of injecting extra ad-hoc renders. Callers enqueue a request with
 * captureOnNextFrame(); the frame driver calls flushPendingCaptures() right
 * after the frame's final draw, in the same JS task.
 */

const SCREENSHOT_TIMEOUT_MS = 5000;

export interface CaptureResult {
  width: number;
  height: number;
  dataUrl: string;
}

interface PendingCapture {
  mimeType: string;
  quality?: number;
  resolve: (value: CaptureResult) => void;
  reject: (err: Error) => void;
}

const pendingCaptures: PendingCapture[] = [];

/**
 * Resolves with a capture of the next fully rendered frame. Rejects after
 * timeoutMs if no frame is rendered (e.g. the render loop is not ticking).
 */
export function captureOnNextFrame(
  mimeType = 'image/png',
  quality?: number,
  timeoutMs = SCREENSHOT_TIMEOUT_MS
): Promise<CaptureResult> {
  return new Promise<CaptureResult>((resolve, reject) => {
    const entry: PendingCapture = { mimeType, quality, resolve: null!, reject: null! };
    const timer = window.setTimeout(() => {
      const index = pendingCaptures.indexOf(entry);
      if (index >= 0) {
        pendingCaptures.splice(index, 1);
      }
      reject(
        new Error(
          `Screenshot timed out after ${timeoutMs}ms: no frame was rendered (is the render loop ticking?)`
        )
      );
    }, timeoutMs);
    entry.resolve = (value) => {
      window.clearTimeout(timer);
      resolve(value);
    };
    entry.reject = (err) => {
      window.clearTimeout(timer);
      reject(err);
    };
    pendingCaptures.push(entry);
  });
}

/**
 * Serves queued capture requests. MUST be called during the frame (e.g. from
 * the application tick handler after the frame's final draw).
 *
 * The capture itself is deferred by one microtask: the tick handler runs
 * inside the device beginFrame()/endFrame() bracket, and on WebGPU the frame's
 * command submission happens in endFrame() - capturing earlier would read the
 * still-empty swapchain texture. The microtask runs after the run loop's
 * synchronous code (endFrame() included) but still within the same JS task,
 * which keeps the GPU-backed canvas serializable for canvas.toBlob().
 */
export function flushPendingCaptures(canvas: HTMLCanvasElement): void {
  if (pendingCaptures.length === 0) {
    return;
  }
  const requests = pendingCaptures.splice(0);
  queueMicrotask(() => {
    for (const request of requests) {
      canvasToDataUrl(canvas, request.mimeType, request.quality).then(
        (dataUrl) => request.resolve({ width: canvas.width, height: canvas.height, dataUrl }),
        request.reject
      );
    }
  });
}

export async function canvasToDataUrl(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality?: number
): Promise<string> {
  const blob = await new Promise<Blob>((resolve, reject) => {
    const timer = window.setTimeout(
      () => reject(new Error('Canvas screenshot timed out')),
      SCREENSHOT_TIMEOUT_MS
    );
    canvas.toBlob(
      (value) => {
        window.clearTimeout(timer);
        if (value) {
          resolve(value);
        } else {
          reject(new Error('Canvas screenshot failed: canvas.toBlob returned null'));
        }
      },
      mimeType,
      typeof quality === 'number' ? quality : undefined
    );
  });
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(String(reader.result)));
    reader.addEventListener('error', () =>
      reject(reader.error ?? new Error('Failed to read screenshot blob'))
    );
    reader.readAsDataURL(blob);
  });
}
