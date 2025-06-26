import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping';

let traceMap: TraceMap = null;

export async function initLeakDetector() {
  const jsmap = await (await fetch('js/index.js.map')).text();
  traceMap = new TraceMap(jsmap);
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

export function testSourceMap() {
  console.log(getMappedStack());
}
