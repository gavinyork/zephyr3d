import { backendWebGL1, backendWebGL2 } from '@zephyr3d/backend-webgl';
import { backendWebGPU } from '@zephyr3d/backend-webgpu';
import type { DeviceBackend } from '@zephyr3d/device';

export function getQueryString(name: string) {
  return new URL(window.location.toString()).searchParams.get(name) || null;
}

export function getBackend(): DeviceBackend {
  const type = getQueryString('dev') || 'webgl';
  if (type === 'webgl') {
    return backendWebGL1;
  } else if (type === 'webgl2') {
    return backendWebGL2;
  } else if (type === 'webgpu') {
    return backendWebGPU;
  }
  return null;
}

export interface TestCase {
  caseName: string;
  times: number;
  execute: () => void;
}

export function assert(exp, msg) {
  if (!exp) {
    throw new Error(msg);
  }
}

async function delay() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function asyncWrapper(fn: Function, msg: HTMLElement, times: number) {
  return async function (...args: any[]) {
    try {
      for (const i of [...Array(times)].map((_, i) => i)) {
        const s = `testing... (${i}/${times})`;
        if (msg) {
          msg.innerHTML = s;
        } else {
          (globalThis as any).process.stdout.write(`${s}\n`);
        }
        await Promise.resolve(fn(...args));
        await delay();
      }
      if (msg) {
        msg.style.color = '#00ff00';
        msg.innerHTML = 'Passed';
      } else {
        (globalThis as any).process.stdout.write(`Passed\n`);
      }
    } catch (err) {
      if (msg) {
        msg.style.color = '#ff0000';
        msg.innerHTML = `${err}`;
      } else {
        (globalThis as any).process.stdout.write(`${err}\n`);
      }
    }
  };
}

export async function doTest(desc: string, cases: TestCase[]) {
  if (globalThis.document) {
    const title = document.getElementById('title');
    title.textContent = `${desc} - testing`;
    const table = document.getElementById('test-results');
    for (const testcase of cases) {
      const tr = document.createElement('tr');
      const tdname = document.createElement('td');
      tdname.innerHTML = testcase.caseName;
      tr.appendChild(tdname);
      const tdresult = document.createElement('td');
      tr.appendChild(tdresult);
      table.appendChild(tr);
      await asyncWrapper(testcase.execute, tdresult, testcase.times)();
    }
    title.textContent = `${desc} - finished`;
  } else {
    for (const testcase of cases) {
      await asyncWrapper(testcase.execute, null, testcase.times)();
    }
  }
}
