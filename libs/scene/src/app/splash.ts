import type { Nullable } from '@zephyr3d/base';
import type { AssetPreloadTask } from '../asset/asset_preload';
import type { PipelineCompileTask } from './pipelinecache';
import { ENGINE_LOGO_SVG } from './splash_logo';

/** Id of the splash screen element */
export const SPLASH_SCREEN_ELEMENT_ID = 'zephyr-splash';
/** Class fading the splash screen out */
const HIDDEN_CLASS = `${SPLASH_SCREEN_ELEMENT_ID}-hidden`;

/**
 * Options of the splash screen markup
 * @public
 */
export interface SplashScreenHTMLOptions {
  /** CSS color of the background, defaults to `#1f1f1f` */
  background?: string;
}

function parseColor(color: string): [number, number, number] {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join('') : hex[1];
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];
  }
  const rgb = /^rgba?\(([^)]+)\)$/i.exec(color.trim());
  if (rgb) {
    const parts = rgb[1].split(',').map((v) => parseFloat(v) / 255);
    return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
  }
  return [0.12, 0.12, 0.12];
}

/**
 * Markup of the default splash screen: the engine logo, a progress bar and a message
 * line, plus a script showing startup errors on it.
 *
 * @remarks
 * Put `head` in the page's head and `body` first in its body, so the splash screen
 * shows as soon as the page does, before any script loads; {@link SplashScreen.find}
 * then takes it over to show the loading progress.
 *
 * @param options - Background color; the logo text turns dark on light backgrounds
 * @returns The markup for the head and the body
 * @public
 */
export function generateSplashScreenHTML(options?: SplashScreenHTMLOptions) {
  const background = options?.background ?? '#1f1f1f';
  const [r, g, b] = parseColor(background);
  const light = 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.5;
  const foreground = light ? '#333333' : '#ffffff';
  const id = SPLASH_SCREEN_ELEMENT_ID;
  const head = `<style>
      #${id} {
        position: fixed;
        inset: 0;
        z-index: 10;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 28px;
        background: ${background};
        color: ${foreground};
        font: 14px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
        transition: opacity 0.3s ease;
      }
      #${id}.${HIDDEN_CLASS} {
        opacity: 0;
        pointer-events: none;
      }
      #${id}-logo svg {
        display: block;
        width: min(360px, 60vw);
        height: auto;
      }
      #${id}-progress {
        width: min(280px, 50vw);
        height: 3px;
        border-radius: 2px;
        background: color-mix(in srgb, currentColor 18%, transparent);
        overflow: hidden;
      }
      #${id}-progress > div {
        width: 0;
        height: 100%;
        background: #4cb2a7;
      }
      #${id}-message {
        min-height: 1.2em;
        max-width: 80vw;
        text-align: center;
        white-space: pre-wrap;
        opacity: 0.7;
      }
    </style>`;
  const body = `<div id="${id}" role="status" aria-live="polite">
      <div id="${id}-logo">${ENGINE_LOGO_SVG}</div>
      <div id="${id}-progress"><div></div></div>
      <div id="${id}-message"></div>
    </div>
    <script>
      // Failures while starting (module loading, no supported device, startup scene
      // or script) leave the splash screen up showing the error.
      (() => {
        const showStartupError = (message) => {
          const splash = document.getElementById('${id}');
          if (splash) {
            splash.classList.remove('${HIDDEN_CLASS}');
            splash.setAttribute('role', 'alert');
            document.getElementById('${id}-progress')?.remove();
            document.getElementById('${id}-message').textContent = \`Startup failed: \${message}\`;
          }
        };
        window.addEventListener('error', (event) => {
          if (event.message) {
            showStartupError(event.message);
          }
        });
        window.addEventListener('unhandledrejection', (event) => {
          showStartupError(event.reason?.message || String(event.reason || 'Unhandled promise rejection'));
        });
      })();
    </script>`;
  return { head, body };
}

/**
 * A part of the loading shown on a {@link SplashScreen}
 * @public
 */
export interface SplashScreenStage {
  /** Sets how much of the stage is done, in [0, 1] */
  update(fraction: number): void;
  /** Marks the stage done */
  done(): void;
}

type Stage = {
  name: string;
  weight: number;
  fraction: number;
  poll: Nullable<() => Nullable<number>>;
};

/**
 * Shows the loading progress on the splash screen of the page.
 *
 * @remarks
 * The splash screen is markup the page already holds (see {@link generateSplashScreenHTML}),
 * shown before any script loads. Loading is split into stages with weights, such as
 * compiling pipelines, preloading assets and loading the scene; the bar shows their
 * weighted sum, never going back. The engine never drives it by itself: the code
 * starting the application adds the stages and hides the splash screen.
 * @public
 */
export class SplashScreen {
  private static _instance: Nullable<SplashScreen> = null;
  private readonly _element: HTMLElement;
  private readonly _bar: Nullable<HTMLElement>;
  private readonly _message: Nullable<HTMLElement>;
  private readonly _stages: Stage[];
  private _shown: number;
  private _frame: number;
  private _hidden: boolean;
  private constructor(element: HTMLElement) {
    this._element = element;
    this._bar = document.querySelector<HTMLElement>(`#${SPLASH_SCREEN_ELEMENT_ID}-progress > div`);
    this._message = document.getElementById(`${SPLASH_SCREEN_ELEMENT_ID}-message`);
    this._stages = [];
    this._shown = 0;
    this._frame = 0;
    this._hidden = false;
  }
  /**
   * Takes over the splash screen of the page.
   * @returns The splash screen, or null if the page has none
   */
  static find(): Nullable<SplashScreen> {
    if (!this._instance || !this._instance._element.isConnected) {
      const element =
        typeof document !== 'undefined' ? document.getElementById(SPLASH_SCREEN_ELEMENT_ID) : null;
      this._instance = element ? new SplashScreen(element) : null;
    }
    return this._instance;
  }
  /** Overall progress in [0, 1], the weighted sum of the stages */
  get progress() {
    let weight = 0;
    let done = 0;
    for (const stage of this._stages) {
      if (stage.poll) {
        const fraction = stage.poll();
        if (fraction !== null) {
          stage.fraction = fraction;
        }
      }
      weight += stage.weight;
      done += stage.weight * Math.min(Math.max(stage.fraction, 0), 1);
    }
    return weight > 0 ? done / weight : 0;
  }
  /**
   * Adds a stage of the loading.
   * @param name - Name of the stage, for messages
   * @param weight - Share of the stage in the bar, relative to the other stages
   */
  addStage(name: string, weight = 1): SplashScreenStage {
    const stage = this.pushStage(name, weight, null);
    return {
      update: (fraction: number) => {
        stage.fraction = Math.max(stage.fraction, fraction);
      },
      done: () => {
        stage.fraction = 1;
      }
    };
  }
  /** Shows the progress of compiling pipelines as a stage */
  trackPipelines(task: PipelineCompileTask, weight = 1, name = 'Compiling shaders') {
    this.pushStage(name, weight, () => {
      if (task.state === 'done' || task.state === 'cancelled') {
        return 1;
      }
      const p = task.progress;
      return p.total > 0 ? (p.completed + p.failed + p.skipped) / p.total : 0;
    });
  }
  /** Shows the progress of preloading assets as a stage */
  trackPreload(task: AssetPreloadTask, weight = 1, name = 'Loading assets') {
    this.pushStage(name, weight, () =>
      task.state === 'done' || task.state === 'cancelled' ? 1 : task.progress.fraction
    );
  }
  /** Shows a line of text under the bar */
  setMessage(text: string) {
    if (this._message) {
      this._message.textContent = text;
    }
  }
  /** Fades the splash screen out and removes it */
  hide(): Promise<void> {
    if (this._hidden) {
      return Promise.resolve();
    }
    this._hidden = true;
    this.render(true);
    cancelAnimationFrame(this._frame);
    SplashScreen._instance = null;
    const element = this._element;
    return new Promise((resolve) => {
      const remove = () => {
        element.remove();
        resolve();
      };
      element.classList.add(HIDDEN_CLASS);
      element.addEventListener('transitionend', remove, { once: true });
      setTimeout(remove, 1000);
    });
  }
  private pushStage(name: string, weight: number, poll: Stage['poll']) {
    const stage: Stage = { name, weight: Math.max(weight, 0), fraction: 0, poll };
    this._stages.push(stage);
    this.animate();
    return stage;
  }
  private animate() {
    if (!this._frame && !this._hidden) {
      const step = () => {
        this.render(false);
        this._frame = this._hidden ? 0 : requestAnimationFrame(step);
      };
      this._frame = requestAnimationFrame(step);
    }
  }
  private render(final: boolean) {
    const target = final ? 1 : this.progress;
    // Never back, and eased so that jumps read as movement
    this._shown = Math.max(this._shown, final ? 1 : this._shown + (target - this._shown) * 0.25);
    if (this._bar) {
      this._bar.style.width = `${(this._shown * 100).toFixed(1)}%`;
    }
  }
}
