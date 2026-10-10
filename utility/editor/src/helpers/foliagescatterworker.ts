/** Starting the foliage scatter worker; its own module, as import.meta does not load in tests */
import type { FoliageScatterMessage, FoliageScatterResult } from '../workers/foliage_scatter';

/** Runs the scatter worker */
export function runScatterWorker(
  message: FoliageScatterMessage,
  timeoutMs: number
): Promise<FoliageScatterResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../workers/foliage_scatter.ts', import.meta.url), { type: 'module' });
    const timer = window.setTimeout(() => {
      worker.terminate();
      reject(new Error(`Foliage scatter timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    const finish = () => {
      window.clearTimeout(timer);
      worker.terminate();
    };
    worker.onmessage = (event: MessageEvent<any>) => {
      const msg = event.data;
      if (msg?.type === 'success') {
        finish();
        resolve(msg);
      } else if (msg?.type === 'error') {
        finish();
        reject(new Error(String(msg.error)));
      }
    };
    worker.onerror = (event) => {
      finish();
      reject(new Error(event.message || 'Foliage scatter worker failed'));
    };
    const transfer: Transferable[] = [message.heights.buffer, message.avoid.buffer];
    if (message.density) {
      transfer.push(message.density.buffer);
    }
    if (message.surfaces) {
      transfer.push(message.surfaces.buffer);
    }
    worker.postMessage(message, transfer);
  });
}
