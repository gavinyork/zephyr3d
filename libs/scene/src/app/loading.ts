import type { Nullable } from '@zephyr3d/base';
import type { AssetPreloadTask } from '../asset/asset_preload';
import type { PipelineCompileTask } from './pipelinecache';

/**
 * What a page showing the loading of an application implements, for
 * {@link LoadingProgress} to drive.
 *
 * @remarks
 * The engine has no loading screen of its own: a page wanting one puts it in its
 * markup, so it shows before any script loads, and implements this to show the
 * progress once the engine is up.
 * @public
 */
export interface LoadingScreen {
  /**
   * Shows the overall progress in [0, 1], which never goes back.
   *
   * @remarks
   * Only called once a stage with a share of the progress is added: until then there is
   * no progress to show, so a screen shows its progress bar from the first call on.
   */
  setProgress(fraction: number): void;
  /** Shows the name of the stage being loaded */
  setMessage?(text: string): void;
  /** Shows that starting failed */
  showError?(message: string): void;
  /** Removes the loading screen once the application is on screen; may resolve after a fade */
  hide(): void | Promise<void>;
}

/**
 * A part of the loading tracked by a {@link LoadingProgress}
 * @public
 */
export interface LoadingStage {
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
 * Drives a {@link LoadingScreen} with the progress of the loading.
 *
 * @remarks
 * Loading is split into stages with weights, such as compiling pipelines, preloading
 * assets and loading the scene; the progress is their weighted sum, never going back,
 * and the message is the name of the first stage not done. Without a stage with a share
 * of the progress, the screen is never given one and shows only the message. The engine
 * never creates one by itself: the code starting the application adds the stages and
 * finishes it.
 * @public
 */
export class LoadingProgress {
  private readonly _screen: LoadingScreen;
  private readonly _stages: Stage[];
  private _progress: number;
  private _reported: boolean;
  private _message: string;
  private _frame: number;
  private _finished: boolean;
  /**
   * @param screen - The loading screen to drive
   */
  constructor(screen: LoadingScreen) {
    this._screen = screen;
    this._stages = [];
    this._progress = 0;
    this._reported = false;
    this._message = '';
    this._frame = 0;
    this._finished = false;
  }
  /** The loading screen driven */
  get screen() {
    return this._screen;
  }
  /** Overall progress in [0, 1] last shown */
  get progress() {
    return this._progress;
  }
  /**
   * Adds a stage of the loading.
   * @param name - Name of the stage, shown while it loads
   * @param weight - Share of the stage in the progress, relative to the other stages
   */
  addStage(name: string, weight = 1): LoadingStage {
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
  /** Tracks compiling pipelines as a stage */
  trackPipelines(task: PipelineCompileTask, weight = 1, name = 'Compiling shaders') {
    this.pushStage(name, weight, () => {
      if (task.state === 'done' || task.state === 'cancelled') {
        return 1;
      }
      const p = task.progress;
      return p.total > 0 ? (p.completed + p.failed + p.skipped) / p.total : 0;
    });
  }
  /** Tracks preloading assets as a stage */
  trackPreload(task: AssetPreloadTask, weight = 1, name = 'Loading assets') {
    this.pushStage(name, weight, () =>
      task.state === 'done' || task.state === 'cancelled' ? 1 : task.progress.fraction
    );
  }
  /**
   * Shows that starting failed on the loading screen, which stays up.
   * @param reason - The error
   */
  fail(reason: unknown) {
    this.stop();
    const message = reason instanceof Error ? reason.message : String(reason);
    this._screen.showError?.(message);
  }
  /** Shows the loading done and hides the loading screen */
  finish(): Promise<void> {
    if (this._finished) {
      return Promise.resolve();
    }
    this.stop();
    this._progress = 1;
    if (this._stages.some((stage) => stage.weight > 0)) {
      this._screen.setProgress(1);
    }
    return Promise.resolve(this._screen.hide());
  }
  private stop() {
    this._finished = true;
    cancelAnimationFrame(this._frame);
    this._frame = 0;
  }
  private pushStage(name: string, weight: number, poll: Stage['poll']) {
    const stage: Stage = { name, weight: Math.max(weight, 0), fraction: 0, poll };
    this._stages.push(stage);
    if (!this._frame && !this._finished) {
      const step = () => {
        this.update();
        this._frame = this._finished ? 0 : requestAnimationFrame(step);
      };
      this._frame = requestAnimationFrame(step);
    }
    return stage;
  }
  private update() {
    let weight = 0;
    let done = 0;
    let message = '';
    for (const stage of this._stages) {
      if (stage.poll) {
        const fraction = stage.poll();
        if (fraction !== null) {
          stage.fraction = Math.max(stage.fraction, fraction);
        }
      }
      const fraction = Math.min(Math.max(stage.fraction, 0), 1);
      weight += stage.weight;
      done += stage.weight * fraction;
      if (!message && fraction < 1) {
        message = stage.name;
      }
    }
    const progress = Math.max(this._progress, weight > 0 ? done / weight : 0);
    // Without a stage with a share, there is no bar to fill
    if (weight > 0 && (progress !== this._progress || !this._reported)) {
      this._progress = progress;
      this._reported = true;
      this._screen.setProgress(progress);
    }
    if (message && message !== this._message) {
      this._message = message;
      this._screen.setMessage?.(message);
    }
  }
}
