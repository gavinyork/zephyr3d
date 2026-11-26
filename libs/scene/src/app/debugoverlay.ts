/**
 * Debug overlay: frames per second, CPU and GPU frame times, and the render passes taking the
 * most GPU time, longest first, with the largest parts of each.
 *
 * GPU times come from the render graph profiler, which this switches on while shown; they need
 * WebGPU timestamp queries. Times are averaged over half a second.
 */
import { getDevice } from './api';
import { RenderGraphExecutor } from '../render/rendergraph/executor';
import type { RGProfileResult, RGProfileScopeResult } from '../render/rendergraph/types';

const STYLE = `
.gdbg { position: fixed; pointer-events: none; overflow: hidden; z-index: 12; user-select: none;
  font-family: ui-monospace, Consolas, 'Microsoft YaHei', monospace; color: #e8f0f2; }
.gdbg-panel { position: absolute; top: 18px; right: 18px; min-width: 300px; padding: 8px 12px;
  background: rgba(4, 14, 20, .78); border: 1px solid rgba(255,255,255,.16); border-radius: 6px;
  font-size: 12px; line-height: 1.45; }
.gdbg-head { display: flex; justify-content: space-between; gap: 14px; font-variant-numeric: tabular-nums; }
.gdbg-fps { font-size: 22px; font-weight: 700; }
.gdbg-sub { opacity: .8; text-align: right; }
.gdbg table { width: 100%; border-collapse: collapse; margin-top: 6px; font-variant-numeric: tabular-nums; }
.gdbg td { padding: 0 0 0 8px; white-space: nowrap; }
.gdbg td:first-child { padding-left: 0; max-width: 220px; overflow: hidden; text-overflow: ellipsis; }
.gdbg td.num { text-align: right; }
.gdbg tr.child td { opacity: .6; }
.gdbg tr.child td:first-child { padding-left: 14px; }
.gdbg .bar { display: inline-block; height: 6px; background: #f0a040; border-radius: 2px; vertical-align: middle; }
.gdbg-note { opacity: .6; margin-top: 4px; }
`;

const REFRESH_SECONDS = 0.5;
/** Passes listed, longest first */
const TOP_PASSES = 10;
/** Parts listed under each pass, at least this long */
const TOP_CHILDREN = 2;
const MIN_CHILD_MS = 0.15;

interface PassTime {
  ms: number;
  children: Map<string, number>;
}

function escapeHtml(text: string) {
  return text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

export class DebugOverlay {
  private readonly canvas: HTMLCanvasElement;
  private root: HTMLDivElement | null = null;
  private style: HTMLStyleElement | null = null;
  private head: HTMLDivElement | null = null;
  private table: HTMLTableElement | null = null;
  private note: HTMLDivElement | null = null;
  // Sums over the frames since the last refresh
  private readonly passes = new Map<string, PassTime>();
  private gpuTotal = 0;
  private profiles = 0;
  private lastProfile: RGProfileResult | null = null;
  private elapsed = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
  }

  get visible() {
    return !!this.root;
  }
  set visible(val: boolean) {
    if (val === this.visible) {
      return;
    }
    if (val) {
      this.show();
    } else {
      this.hide();
    }
  }

  update(dt: number) {
    if (!this.root) {
      return;
    }
    this.collect();
    this.elapsed += dt;
    if (this.elapsed >= REFRESH_SECONDS) {
      this.elapsed = 0;
      this.fit();
      this.render();
    }
  }

  dispose() {
    this.hide();
  }

  private show() {
    this.style = document.createElement('style');
    this.style.textContent = STYLE;
    document.head.appendChild(this.style);
    this.root = document.createElement('div');
    this.root.className = 'gdbg';
    this.root.innerHTML = `<div class="gdbg-panel"><div class="gdbg-head"></div><table></table>
      <div class="gdbg-note"></div></div>`;
    document.body.appendChild(this.root);
    this.head = this.root.querySelector('.gdbg-head');
    this.table = this.root.querySelector('table');
    this.note = this.root.querySelector('.gdbg-note');
    this.reset();
    this.lastProfile = null;
    this.elapsed = REFRESH_SECONDS;
    this.fit();
    // Every graph built from now on times its passes
    RenderGraphExecutor.setDefaultProfilingOptions({
      enabled: true,
      graph: true,
      pass: true,
      subpass: true,
      includePendingUploads: true,
      maxPendingFrames: 3,
      label: 'RenderGraph'
    });
  }

  private hide() {
    if (!this.root) {
      return;
    }
    RenderGraphExecutor.setDefaultProfilingOptions(false);
    this.root.remove();
    this.style?.remove();
    this.root = null;
    this.style = null;
    this.head = null;
    this.table = null;
    this.note = null;
  }

  private reset() {
    this.passes.clear();
    this.gpuTotal = 0;
    this.profiles = 0;
  }

  /** Adds the latest profile, once, when its timings are all in */
  private collect() {
    const profile = RenderGraphExecutor.getLatestProfileResult();
    if (!profile || profile === this.lastProfile) {
      return;
    }
    this.lastProfile = profile;
    if (profile.status !== 'resolved') {
      return;
    }
    // Scopes outside the graph (scene and water updates) ran before it, outside its duration
    let total = profile.graph.durationMs;
    for (const scope of profile.passes) {
      if (scope.type === 'external') {
        total += scope.durationMs;
      }
      this.addPass(scope);
    }
    this.gpuTotal += total;
    this.profiles++;
  }

  private addPass(scope: RGProfileScopeResult) {
    let pass = this.passes.get(scope.name);
    if (!pass) {
      pass = { ms: 0, children: new Map() };
      this.passes.set(scope.name, pass);
    }
    pass.ms += scope.durationMs;
    for (const child of scope.children) {
      pass.children.set(child.name, (pass.children.get(child.name) ?? 0) + child.durationMs);
    }
  }

  private render() {
    const info = getDevice().frameInfo;
    const n = this.profiles;
    const gpu = n > 0 ? this.gpuTotal / n : 0;
    const fps = info.FPS;
    this.head!.innerHTML = `<div class="gdbg-fps">${fps.toFixed(1)} FPS</div>
      <div class="gdbg-sub">帧 ${fps > 0 ? (1000 / fps).toFixed(1) : '-'} ms<br>
      CPU ${info.elapsedTimeCPU.toFixed(1)} ms · GPU ${n > 0 ? gpu.toFixed(1) : '-'} ms</div>`;
    if (n === 0) {
      this.table!.innerHTML = '';
      this.note!.textContent = '等待 GPU 计时…（需要 WebGPU 时间戳查询）';
      return;
    }
    const rows: string[] = [];
    const sorted = [...this.passes.entries()].sort((a, b) => b[1].ms - a[1].ms).slice(0, TOP_PASSES);
    const longest = sorted[0]?.[1].ms / n || 1;
    for (const [name, pass] of sorted) {
      const ms = pass.ms / n;
      const share = gpu > 0 ? Math.round((ms / gpu) * 100) : 0;
      const bar = Math.max(1, Math.round((ms / longest) * 60));
      rows.push(
        `<tr><td>${escapeHtml(name)}</td><td class="num">${ms.toFixed(2)}</td>` +
          `<td class="num">${share}%</td><td><span class="bar" style="width:${bar}px"></span></td></tr>`
      );
      const children = [...pass.children.entries()]
        .map(([child, sum]) => [child, sum / n] as const)
        .filter(([, childMs]) => childMs >= MIN_CHILD_MS)
        .sort((a, b) => b[1] - a[1])
        .slice(0, TOP_CHILDREN);
      for (const [child, childMs] of children) {
        rows.push(
          `<tr class="child"><td>${escapeHtml(child)}</td><td class="num">${childMs.toFixed(2)}</td>` +
            `<td></td><td></td></tr>`
        );
      }
    }
    this.table!.innerHTML = rows.join('');
    this.note!.textContent = `GPU 时间，${n} 帧平均（ms）`;
    this.reset();
  }

  /** Lays the overlay over the canvas, which need not fill the page (the editor preview) */
  private fit() {
    if (!this.root) {
      return;
    }
    const r = this.canvas.getBoundingClientRect();
    const s = this.root.style;
    s.left = `${r.left}px`;
    s.top = `${r.top}px`;
    s.width = `${r.width}px`;
    s.height = `${r.height}px`;
  }
}
