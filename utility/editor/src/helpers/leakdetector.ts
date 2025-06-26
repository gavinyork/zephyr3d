import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping';
import type { GPUObject } from '@zephyr3d/device';
import { Application } from '@zephyr3d/scene';

let traceMap: TraceMap = null;
const gpuObjectStackTraceMap: WeakMap<GPUObject, string> = new WeakMap();
const stackTraceGPUObjectMap: Map<string, GPUObject[]> = new Map();

function getGPUObjectType(obj: GPUObject) {
  if (obj.isBindGroup()) {
    return 'BindGroup';
  }
  if (obj.isBuffer()) {
    return 'Buffer';
  }
  if (obj.isFramebuffer()) {
    return 'FrameBuffer';
  }
  if (obj.isProgram()) {
    return 'Program';
  }
  if (obj.isSampler()) {
    return 'Sampler';
  }
  if (obj.isTexture()) {
    return 'Texture';
  }
  if (obj.isVertexLayout()) {
    return 'VertexLayout';
  }
  return 'unknown';
}

export function getGPUObjectStatistics() {
  return [...stackTraceGPUObjectMap]
    .sort((a, b) => b[1].length - a[1].length)
    .map((val) => ({
      stack: getStackFrames(val[0], 32),
      objectType: getGPUObjectType(val[1][0]),
      objectCount: val[1].length
    }));
}

export async function initLeakDetector() {
  const jsmap = await (await fetch('js/index.js.map')).text();
  traceMap = new TraceMap(jsmap);

  const device = Application.instance.device;
  device.on('gpuobject_added', function (obj) {
    const stack = new Error().stack;
    if (stack) {
      gpuObjectStackTraceMap.set(obj, stack);
    }
    let objList = stackTraceGPUObjectMap.get(stack);
    if (!objList) {
      objList = [];
      stackTraceGPUObjectMap.set(stack, objList);
    }
    objList.push(obj);
  });
  device.on('gpuobject_removed', function (obj) {
    const stack = gpuObjectStackTraceMap.get(obj);
    if (stack) {
      gpuObjectStackTraceMap.delete(obj);
      const objList = stackTraceGPUObjectMap.get(stack);
      if (objList) {
        const index = objList.indexOf(obj);
        if (index >= 0) {
          objList.splice(index, 1);
        }
        if (objList.length === 0) {
          stackTraceGPUObjectMap.delete(stack);
        }
      }
    }
  });

  Error['stackTraceLimit'] = 50;
}

export function sourceMapToOrigin(line: number, column: number) {
  return originalPositionFor(traceMap, { line, column });
}

const LINE_RE = /^\s*at\s+(.*?)\s+\((.*?):(\d+):(\d+)\)$|^\s*at\s+(.*?):(\d+):(\d+)$/;

export function getMappedStack(): string {
  function mapFrame(frame: string): string {
    const m = frame.match(LINE_RE);
    if (!m) return frame; // 不是标准 stack line

    // 提取生成代码中的文件、行、列
    const file = m[2] || m[5];
    const line = Number(m[3] || m[6]);
    const column = Number(m[4] || m[7]);

    // 只示范 index.js；如需处理多文件自行判断
    if (!file.endsWith('index.js')) return frame;

    const pos = originalPositionFor(traceMap, { line, column });

    // 若 map 中没有对应条目就原样返回
    if (!pos.source) return frame;

    const fnName = m[1] || '<anonymous>';
    return `    at ${fnName} (${pos.source}:${pos.line}:${pos.column})`;
  }
  const stack = new Error().stack ?? '';
  const mapped = stack
    .split('\n')
    // 第一行是 “Error” 字样，保留
    .map((l, idx) => (idx === 0 ? l : mapFrame(l)))
    .join('\n');
  return mapped;
}

export function getStackFrames(stack: string, maxDepth: number) {
  const lines = stack.split('\n');
  const frames = [];

  // 从索引 2 开始，跳过 "Error" 和 "captureStackFrames" 本身
  for (let i = 2; i < Math.min(lines.length, maxDepth + 2); i++) {
    const line = lines[i];
    if (!line) continue;

    const frame = parseStackLine(line);
    if (frame) {
      frames.push({
        ...frame,
        index: i - 2,
        raw: line.trim()
      });
    }
  }

  return frames;
}

function extractFileName(filePath: string) {
  return filePath ? filePath.split('?')[0].split('#')[0].split('/').pop() || 'unknown' : 'unknown';
}

function parseStackLine(line: string) {
  // Chrome/Edge: "    at functionName (file:line:column)"
  let match = line.match(/^\s*at\s+(.+?)\s+\((.+?):(\d+):(\d+)\)$/);
  if (match) {
    return {
      function: match[1],
      file: extractFileName(match[2]),
      fullPath: match[2],
      line: parseInt(match[3]),
      column: parseInt(match[4]),
      unparsed: ''
    };
  }

  // Chrome/Edge: "    at file:line:column"
  match = line.match(/^\s*at\s+(.+?):(\d+):(\d+)$/);
  if (match) {
    return {
      function: 'anonymous',
      file: extractFileName(match[1]),
      fullPath: match[1],
      line: parseInt(match[2]),
      column: parseInt(match[3]),
      unparsed: ''
    };
  }

  // Firefox: "functionName@file:line:column"
  match = line.match(/^(.+?)@(.+?):(\d+):(\d+)$/);
  if (match) {
    return {
      function: match[1] || 'anonymous',
      file: extractFileName(match[2]),
      fullPath: match[2],
      line: parseInt(match[3]),
      column: parseInt(match[4]),
      unparsed: ''
    };
  }

  return {
    function: 'unknown',
    file: 'unknown',
    fullPath: 'unknown',
    line: 0,
    column: 0,
    unparsed: line.trim()
  };
}
