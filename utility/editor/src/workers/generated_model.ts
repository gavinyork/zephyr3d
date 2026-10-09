/**
 * Worker entry for the procedural mesh generator; the generator itself lives in `procedural_core.ts`
 * so other workers can share its script sandbox.
 */
import { generatePrimitive } from './procedural_core';
import type { GenerateMessage, WorkerError } from './procedural_core';

self.onmessage = (event: MessageEvent<GenerateMessage>) => {
  const message = event.data;
  if (message?.type !== 'generate') {
    return;
  }
  try {
    const result = generatePrimitive(message.spec, message.deadlineAt);
    postMessage(result);
  } catch (err) {
    const response: WorkerError = {
      type: 'error',
      error: err instanceof Error ? err.message : String(err)
    };
    postMessage(response);
  }
};
