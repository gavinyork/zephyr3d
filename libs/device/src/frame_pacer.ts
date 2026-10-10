/**
 * How often the run loop renders a frame.
 *
 * - `'off'`: on every display refresh the browser offers (the default).
 * - `'auto'`: on every refresh while the frames fit in it, every second (or
 *   third, fourth) refresh when they do not, so each frame stays on screen for
 *   the same time.
 * - a number: at most this many frames per second, rounded down to a whole
 *   number of refreshes per frame (30 on a 60Hz display renders every second
 *   refresh, 60 on a 144Hz display every third, giving 48).
 *
 * @remarks
 * A frame that misses a refresh stays on screen twice as long and the next one
 * makes up for it, so motion that is exact in time still stutters on screen.
 * Holding a steady fraction of the refresh rate keeps it even: a steady 30
 * looks smoother than an uneven 50. Only applies to a vsync'ed run loop.
 *
 * @public
 */
export type FramePacing = 'off' | 'auto' | number;

/** Most refreshes a frame is held for. */
const MAX_REFRESHES_PER_FRAME = 4;
/** Auto pacing judges the frames of this many recent milliseconds. */
const STATS_WINDOW = 1500;
/** Fewest frames in the window to judge by. */
const MIN_SAMPLES = 20;
/**
 * Share of frames missing a refresh that makes auto pacing hold frames longer.
 * An occasional miss costs less than halving the frame rate.
 */
const MISS_RATIO_TO_SLOW_DOWN = 0.12;
/**
 * Share of frames done soon enough for a shorter hold needed to try one. Below
 * one minus the miss ratio above, so that a rate it speeds up to is kept.
 */
const HEADROOM_TO_SPEED_UP = 0.94;
/** How long auto pacing first holds a rate before trying to render more often again. */
const INITIAL_PROBE_DELAY = 2000;
const MAX_PROBE_DELAY = 16000;
/** Slowing down this soon after speeding up means the speed up was too early. */
const FAILED_PROBE_TIME = 3000;

/** A recent frame: when, and whether it went the way the sample is about. */
interface Sample {
  time: number;
  value: boolean;
}

function pushSample(samples: Sample[], time: number, value: boolean) {
  samples.push({ time, value });
  while (samples.length > 0 && time - samples[0].time > STATS_WINDOW) {
    samples.shift();
  }
}

function ratio(samples: Sample[]) {
  let n = 0;
  for (const s of samples) {
    if (s.value) {
      n++;
    }
  }
  return samples.length > 0 ? n / samples.length : 0;
}

/**
 * Decides, at each display refresh, whether the run loop renders a frame.
 * @internal
 */
export class FramePacer {
  mode: FramePacing;
  /** Estimated display refresh interval in ms; 0 until measured. */
  private _refresh: number;
  /** Consecutive refreshes clearly shorter than the estimate: the display got faster. */
  private _faster: number;
  private _lastVsync: number;
  private _lastRender: number;
  /** Refreshes per frame chosen by auto pacing. */
  private _autoRefreshes: number;
  /** Refreshes per frame of the last rendered frame. */
  private _refreshes: number;
  /** Per rendered frame: whether the frame before it missed a refresh. */
  private readonly _misses: Sample[];
  /** Per rendered frame: whether it was done soon enough to be held one refresh less. */
  private readonly _headroom: Sample[];
  private _waitingHeadroom: boolean;
  private _stableSince: number;
  private _lastSpeedUp: number;
  private _probeDelay: number;
  constructor() {
    this.mode = 'off';
    this._refresh = 0;
    this._faster = 0;
    this._lastVsync = -1;
    this._lastRender = -1;
    this._autoRefreshes = 1;
    this._refreshes = 1;
    this._misses = [];
    this._headroom = [];
    this._waitingHeadroom = false;
    this._stableSince = 0;
    this._lastSpeedUp = -Infinity;
    this._probeDelay = INITIAL_PROBE_DELAY;
  }
  /** Estimated display refresh interval in milliseconds, 0 until measured. */
  get refreshInterval() {
    return this._refresh;
  }
  /** Display refreshes each frame is currently held for. */
  get refreshesPerFrame() {
    return this._refreshes;
  }
  /** Starts over, for a run loop that starts again. */
  reset() {
    this._lastVsync = -1;
    this._lastRender = -1;
    this._misses.length = 0;
    this._headroom.length = 0;
    this._waitingHeadroom = false;
  }
  /**
   * Called on every display refresh with its requestAnimationFrame timestamp.
   * @returns Whether to render a frame at this refresh.
   */
  shouldRender(time: number): boolean {
    if (this._lastVsync >= 0) {
      this._measureRefresh(time - this._lastVsync);
    }
    this._lastVsync = time;
    const refresh = this._refresh;
    if (this._lastRender < 0 || refresh <= 0) {
      this._lastRender = time;
      this._stableSince = time;
      return true;
    }
    const refreshes = Math.round((time - this._lastRender) / refresh);
    const wanted = this._wantedRefreshes(refresh);
    if (this._waitingHeadroom) {
      // The first refresh offered after a frame comes when the frame is done.
      this._waitingHeadroom = false;
      pushSample(this._headroom, time, refreshes <= wanted - 1);
    }
    if (refreshes < wanted) {
      return false;
    }
    // Later than wanted: the frame before missed a refresh. Far later is a
    // pause (hidden tab, breakpoint), not a slow frame.
    const missed = refreshes > wanted && refreshes <= wanted + MAX_REFRESHES_PER_FRAME;
    this._refreshes = Math.min(refreshes, MAX_REFRESHES_PER_FRAME);
    this._lastRender = time;
    this._waitingHeadroom = wanted > 1;
    if (this.mode === 'auto') {
      this._adapt(time, missed);
    }
    return true;
  }
  private _wantedRefreshes(refresh: number) {
    const mode = this.mode;
    if (mode === 'auto') {
      return this._autoRefreshes;
    }
    if (typeof mode === 'number' && mode > 0) {
      // Whole refreshes per frame, not more frames than asked for
      return Math.min(Math.max(Math.ceil(1000 / mode / refresh - 0.05), 1), MAX_REFRESHES_PER_FRAME);
    }
    return 1;
  }
  private _adapt(time: number, missed: boolean) {
    const misses = this._misses;
    pushSample(misses, time, missed);
    if (
      this._autoRefreshes < MAX_REFRESHES_PER_FRAME &&
      misses.length >= MIN_SAMPLES &&
      ratio(misses) > MISS_RATIO_TO_SLOW_DOWN
    ) {
      // Frames often do not fit: hold each one a refresh longer. Slowing down
      // soon after speeding up means that was too early; wait longer next time.
      this._probeDelay =
        time - this._lastSpeedUp < FAILED_PROBE_TIME
          ? Math.min(this._probeDelay * 2, MAX_PROBE_DELAY)
          : INITIAL_PROBE_DELAY;
      this._setAutoRefreshes(this._autoRefreshes + 1, time);
      return;
    }
    const headroom = this._headroom;
    if (
      this._autoRefreshes > 1 &&
      time - this._stableSince >= this._probeDelay &&
      headroom.length >= MIN_SAMPLES &&
      ratio(headroom) >= HEADROOM_TO_SPEED_UP
    ) {
      // Frames have been done soon enough: try rendering more often.
      this._lastSpeedUp = time;
      this._setAutoRefreshes(this._autoRefreshes - 1, time);
    }
  }
  /** Auto pacing state, for diagnostics. */
  get stats() {
    return {
      autoRefreshes: this._autoRefreshes,
      missRatio: ratio(this._misses),
      headroomRatio: ratio(this._headroom),
      samples: this._headroom.length,
      probeDelay: this._probeDelay,
      stableFor: this._lastVsync - this._stableSince
    };
  }
  private _setAutoRefreshes(value: number, time: number) {
    this._autoRefreshes = value;
    this._stableSince = time;
    this._misses.length = 0;
    this._headroom.length = 0;
  }
  private _measureRefresh(delta: number) {
    if (!(delta > 0) || delta > 250) {
      return;
    }
    if (this._refresh <= 0) {
      this._refresh = delta;
      return;
    }
    if (delta < this._refresh * 0.75) {
      // Shorter refreshes again and again: a faster display, or the first
      // estimate came from a slow frame.
      if (++this._faster >= 8) {
        this._refresh = delta;
        this._faster = 0;
      }
      return;
    }
    this._faster = 0;
    const n = Math.round(delta / this._refresh);
    if (n >= 1 && n <= MAX_REFRESHES_PER_FRAME) {
      const unit = delta / n;
      if (Math.abs(unit - this._refresh) < this._refresh * 0.1) {
        this._refresh += (unit - this._refresh) * 0.05;
      }
    }
  }
}
