/**
 * Worker entry for the procedural mesh generator.
 *
 * Kept separate from `generator.ts` so the tessellator itself stays free of
 * worker globals and can run under plain node.
 */
import { generatePrimitive } from './generator';
import type { GenerateMessage, WorkerError, WorkerProgress } from './generator';

self.onmessage = (event: MessageEvent<GenerateMessage>) => {
  const message = event.data;
  if (message?.type !== 'generate') {
    return;
  }
  try {
    const result = generatePrimitive(message.spec, message.deadlineAt, (progress) => {
      const update: WorkerProgress = { type: 'progress', progress };
      postMessage(update);
    });
    postMessage(result);
  } catch (err) {
    const response: WorkerError = {
      type: 'error',
      error: err instanceof Error ? err.message : String(err)
    };
    postMessage(response);
  }
};
