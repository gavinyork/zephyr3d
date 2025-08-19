import { ImGui } from '@zephyr3d/imgui';

// LogView.ts
type LogLevel = 'log' | 'info' | 'warn' | 'error' | 'debug' | 'trace';
interface LogItem {
  ts: number;
  level: LogLevel;
  text: string;
}
interface LogOptions {
  maxLines: number;
  autoScroll: boolean;
  lineHeight: number;
  timePrefix: boolean;
  timeFormatter?: (ts: number) => string;
  levelColors?: Partial<Record<LogLevel, [number, number, number, number]>>;
  catchGlobalErrors: boolean;
}

const defaultOptions: LogOptions = {
  maxLines: 5000,
  autoScroll: true,
  lineHeight: 18,
  timePrefix: true,
  timeFormatter: (ts) => {
    const d = new Date(ts);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${String(
      d.getMilliseconds()
    ).padStart(3, '0')}`;
  },
  levelColors: {
    log: [0.9, 0.9, 0.9, 1.0],
    info: [0.5, 0.8, 1.0, 1.0],
    debug: [0.65, 0.65, 1.0, 1.0],
    warn: [1.0, 0.84, 0.4, 1.0],
    error: [1.0, 0.45, 0.45, 1.0],
    trace: [0.75, 0.75, 0.75, 1.0]
  },
  catchGlobalErrors: true
};

class CircularBuffer<T> {
  private data: T[];
  private head = 0;
  private size_ = 0;
  constructor(private capacity: number) {
    this.data = new Array<T>(capacity);
  }
  push(item: T) {
    if (this.capacity === 0) {
      return;
    }
    const idx = (this.head + 1) % this.capacity;
    this.data[idx] = item;
    this.head = idx;
    if (this.size_ < this.capacity) {
      this.size_++;
    }
  }
  get size() {
    return this.size_;
  }
  get(i: number): T | undefined {
    if (i < 0 || i >= this.size_) {
      return undefined;
    }
    const start = (this.head - this.size_ + 1 + this.capacity) % this.capacity;
    const idx = (start + i) % this.capacity;
    return this.data[idx];
  }
  clear() {
    this.head = 0;
    this.size_ = 0;
    this.data = new Array<T>(this.capacity);
  }
  setCapacity(newCap: number) {
    if (newCap === this.capacity) {
      return;
    }
    const items: T[] = [];
    for (let i = Math.max(0, this.size_ - newCap); i < this.size_; i++) {
      const v = this.get(i);
      if (v !== undefined) {
        items.push(v);
      }
    }
    this.capacity = newCap;
    this.data = new Array<T>(newCap);
    this.head = 0;
    this.size_ = 0;
    for (const it of items) {
      this.push(it);
    }
  }
}

function safeStringify(arg: any): string {
  try {
    const t = Object.prototype.toString.call(arg);
    if (arg instanceof Error) {
      return `${arg.name}: ${arg.message}${arg.stack ? '\n' + arg.stack : ''}`;
    }
    if (t === '[object Object]' || t === '[object Array]') {
      const cache = new WeakSet();
      return JSON.stringify(arg, function (key, value) {
        if (typeof value === 'object' && value !== null) {
          if (cache.has(value)) {
            return '[Circular]';
          }
          cache.add(value);
        }
        return value;
      });
    }
    if (typeof arg === 'function') {
      return arg.toString();
    }
    return String(arg);
  } catch {
    return '[Unserializable]';
  }
}
const joinArgs = (args: any[]) => args.map(safeStringify).join(' ');

class LogViewImpl {
  private options: LogOptions = { ...defaultOptions };
  private buffer = new CircularBuffer<LogItem>(this.options.maxLines);
  private originalConsole: Partial<Record<LogLevel, any>> | null = null;
  private isPatched = false;

  private scrollToBottomNextFrame = false;
  private wasAtBottom = true;

  private levelEnabled: Record<LogLevel, boolean> = {
    log: true,
    info: true,
    warn: true,
    error: true,
    debug: true,
    trace: true
  };

  initLogView(partial?: Partial<LogOptions>) {
    this.options = { ...defaultOptions, ...(partial || {}) };
    this.buffer.setCapacity(this.options.maxLines);

    if (!this.isPatched) {
      this.patchConsole();
      if (this.options.catchGlobalErrors && typeof window !== 'undefined') {
        window.addEventListener('error', this.onWindowError, true);
        window.addEventListener('unhandledrejection', this.onUnhandledRejection, true);
      }
      this.isPatched = true;
    }
  }

  closeLogView() {
    if (this.isPatched) {
      this.restoreConsole();
      if (typeof window !== 'undefined') {
        window.removeEventListener('error', this.onWindowError, true);
        window.removeEventListener('unhandledrejection', this.onUnhandledRejection, true);
      }
      this.isPatched = false;
    }
  }

  appendLog(level: LogLevel, text: string) {
    const ts = Date.now();
    const prefix = this.options.timePrefix
      ? `[${this.options.timeFormatter?.(ts)}] ${level.toUpperCase()}: `
      : '';

    // 按行拆分。保留空行（常见于堆栈）
    const lines = (text ?? '').split(/\r\n|\n|\r/);

    for (let li = 0; li < lines.length; li++) {
      const line = li === 0 ? prefix + lines[li] : lines[li]; // 仅首行加前缀
      this.buffer.push({ ts, level, text: line });
    }

    // 自动滚动判断
    if (this.wasAtBottom && this.options.autoScroll) {
      this.scrollToBottomNextFrame = true;
    }
  }

  setMaxLines(n: number) {
    this.options.maxLines = n;
    this.buffer.setCapacity(n);
  }

  setLevelEnabled(level: LogLevel, enabled: boolean) {
    this.levelEnabled[level] = enabled;
  }

  renderLogView() {
    if (ImGui.BeginChild('##LogViewContainer', new ImGui.ImVec2(-1, -1), false, ImGui.WindowFlags.None)) {
      ImGui.BeginChild(
        '##LogViewToolBar',
        new ImGui.ImVec2(-1, 2 * ImGui.GetStyle().WindowPadding.y + ImGui.GetFrameHeight()),
        true,
        ImGui.WindowFlags.NoScrollbar | ImGui.WindowFlags.NoScrollWithMouse
      );
      ImGui.Button('Clear');
      ImGui.SameLine();
      ImGui.Button('Copy');

      ImGui.EndChild();
      if (
        ImGui.BeginChild(
          '##LogViewContent',
          ImGui.GetContentRegionAvail(),
          //new ImGui.ImVec2(-1, -1),
          false,
          ImGui.WindowFlags.HorizontalScrollbar
        )
      ) {
        const total = this.buffer.size;
        if (total === 0) {
          return;
        }

        const lineH = ImGui.GetTextLineHeightWithSpacing();
        const contentRegionH = ImGui.GetContentRegionAvail().y;
        const scrollY = ImGui.GetScrollY();
        const contentHeight = total * lineH + ImGui.GetStyle().ItemSpacing.y;

        const maxScrollY = Math.max(0, contentHeight - contentRegionH);
        const atBottom = scrollY >= maxScrollY - 0.5; // 小容差
        this.wasAtBottom = atBottom;

        const firstLine = Math.max(0, Math.floor(scrollY / lineH) - 3);
        const visibleLines = Math.ceil(contentRegionH / lineH) + 6;
        const lastLine = Math.min(total, firstLine + visibleLines);

        const offsetY = firstLine * lineH;
        if (offsetY > 0) {
          ImGui.Dummy(new ImGui.Vec2(0, offsetY));
        }

        for (let i = firstLine; i < lastLine; i++) {
          const item = this.buffer.get(i)!;
          if (!this.levelEnabled[item.level]) {
            continue;
          }

          const col =
            (this.options.levelColors && this.options.levelColors[item.level]) ||
            defaultOptions.levelColors![item.level]!;
          ImGui.PushStyleColor(ImGui.Col.Text, new ImGui.Vec4(col[0], col[1], col[2], col[3]));
          ImGui.TextUnformatted(item.text.slice(0, 512));
          ImGui.PopStyleColor();
        }

        const renderedHeight = (lastLine - firstLine) * lineH;
        const tailPad = Math.max(0, contentHeight - offsetY - renderedHeight);
        if (tailPad > 0) {
          ImGui.Dummy(new ImGui.Vec2(0, tailPad));
        }

        if (this.scrollToBottomNextFrame) {
          ImGui.SetScrollHereY(1.0);
          //ImGui.SetScrollY(maxScrollY);
          this.scrollToBottomNextFrame = false;
        }
      }
      ImGui.EndChild();
    }
    ImGui.EndChild();
  }
  private onWindowError = (event: ErrorEvent) => {
    const reason = event?.error || event?.message || 'Unknown Error';
    this.appendLog('error', safeStringify(reason));
  };
  private onUnhandledRejection = (event: PromiseRejectionEvent) => {
    this.appendLog('error', `UnhandledPromiseRejection: ${safeStringify(event.reason)}`);
  };
  private patchConsole() {
    if (this.originalConsole) {
      return;
    }
    this.originalConsole = {
      log: console.log?.bind(console),
      info: console.info?.bind(console),
      warn: console.warn?.bind(console),
      error: console.error?.bind(console),
      debug: console.debug ? console.debug.bind(console) : console.log?.bind(console),
      trace: console.trace ? console.trace.bind(console) : undefined
    };

    const makeProxy = (level: LogLevel, includeStack = false) => {
      return (...args: any[]) => {
        let msg = joinArgs(args);
        if (includeStack) {
          try {
            const e = new Error();
            if (e.stack) {
              const lines = e.stack.split('\n').slice(2, 5).join('\n');
              msg += `\n${lines}`;
            }
          } catch {}
        }
        this.appendLog(level, msg);
        try {
          this.originalConsole?.[level]?.(...args);
        } catch {
          this.originalConsole?.log?.(...args);
        }
      };
    };

    console.log = makeProxy('log');
    console.info = makeProxy('info');
    console.warn = makeProxy('warn');
    console.error = makeProxy('error', true);
    console.debug = makeProxy('debug');
    if (this.originalConsole.trace) {
      console.trace = (...args: any[]) => {
        const msg = joinArgs(args);
        this.appendLog('trace', msg);
        this.originalConsole!.trace!(...args);
      };
    }
  }

  private restoreConsole() {
    if (!this.originalConsole) {
      return;
    }
    console.log = this.originalConsole.log || console.log;
    console.info = this.originalConsole.info || console.info;
    console.warn = this.originalConsole.warn || console.warn;
    console.error = this.originalConsole.error || console.error;
    console.debug = (this.originalConsole.debug as any) || console.debug;
    if (this.originalConsole.trace) {
      console.trace = this.originalConsole.trace;
    }
    this.originalConsole = null;
  }
}

export const LogView = new LogViewImpl();
export const initLogView = (opts?: Partial<LogOptions>) => LogView.initLogView(opts);
export const renderLogView = () => LogView.renderLogView();
export const appendLog = (level: LogLevel, text: string) => LogView.appendLog(level, text);
export const closeLogView = () => LogView.closeLogView();
