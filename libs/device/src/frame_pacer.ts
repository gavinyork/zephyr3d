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
 * A frame held for two or more refreshes is rendered at the first of them but
 * shown at the last: the browser otherwise shows it as soon as the GPU is done,
 * one refresh earlier or later depending on how long the frame took, which is
 * the same stutter. Frame times are the moments the frames are expected on
 * screen, so motion stays even when the hold changes.
 *
 * @public
 */
export type FramePacing = 'off' | 'auto' | number;

/** Most refreshes a frame is held for: down to 10 frames per second on a 60Hz display. */
const MAX_REFRESHES_PER_FRAME = 6;
/** Auto pacing judges the frames of this many recent milliseconds. */
const STATS_WINDOW = 1500;
/** Fewest frames in the window to judge by. Few enough to be met at 10 frames per second. */
const MIN_SAMPLES = 8;
/** Fewest frames in the window that missed a refresh to slow down for. */
const MIN_MISSES_TO_SLOW_DOWN = 3;
/** Held frames in a row that took more refreshes than their hold, before holding longer at once. */
const OVERRUNS_TO_SLOW_DOWN = 2;
/**
 * Share of frames missing a refresh that makes auto pacing hold frames longer.
 * A miss is a stutter, so few are tolerated; with the fewest misses above, a
 * single one does not halve the frame rate.
 */
const MISS_RATIO_TO_SLOW_DOWN = 0.04;
/**
 * Share of frames done soon enough for a shorter hold needed to try one. Below
 * one minus the miss ratio above, so that a rate it speeds up to is kept.
 */
const HEADROOM_TO_SPEED_UP = 0.97;
/**
 * How long auto pacing first holds a rate before trying to render more often
 * again. Doubled by a failed try, halved by one that holds, never reset: a
 * machine that keeps failing is not asked again every few seconds.
 */
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

function count(samples: Sample[]) {
  let n = 0;
  for (const s of samples) {
    if (s.value) {
      n++;
    }
  }
  return n;
}

function ratio(samples: Sample[]) {
  return samples.length > 0 ? count(samples) / samples.length : 0;
}

/**
 * Decides, at each display refresh, whether the run loop renders a frame.
 * @internal
 */
export class FramePacer {
  mode: FramePacing;
  /**
   * Whether frames are shown at the last refresh they are held for rather than
   * when the GPU is done. The headroom of such frames is reported by the device
   * from GPU completion, see {@link FramePacer.reportFrameDone}, as the refresh
   * after them is offered on time regardless.
   */
  deferredPresent: boolean;
  /** Held frames in a row that took more refreshes than their hold. */
  private _overruns: number;
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
  /** Refreshes the frame rendered last is held for. */
  private _wanted: number;
  /** Refreshes since the last rendered frame, at the last refresh offered. */
  private _sinceRender: number;
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
    this.deferredPresent = false;
    this._overruns = 0;
    this._refresh = 0;
    this._faster = 0;
    this._lastVsync = -1;
    this._lastRender = -1;
    this._autoRefreshes = 1;
    this._refreshes = 1;
    this._wanted = 1;
    this._sinceRender = 0;
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
  /**
   * Refreshes the frame rendered last is held for: the one after
   * {@link FramePacer.shouldRender} returned true. The frame is expected on
   * screen this many refreshes after its vsync time.
   */
  get wantedRefreshes() {
    return this._wanted;
  }
  /** Refreshes since the last rendered frame, as of the last refresh offered. */
  get refreshesSinceRender() {
    return this._sinceRender;
  }
  /** Starts over, for a run loop that starts again. */
  reset() {
    this._lastVsync = -1;
    this._lastRender = -1;
    this._misses.length = 0;
    this._headroom.length = 0;
    this._waitingHeadroom = false;
    this._sinceRender = 0;
    this._overruns = 0;
  }
  /**
   * Reports a frame shown at the last refresh of its hold: whether it was done
   * soon enough to be held one refresh less, and how many refreshes it did
   * take. Frames taking more than their hold again and again get a longer one
   * at once, rather than when the refreshes they miss add up in the statistics,
   * which at a low frame rate they are slow to.
   */
  reportFrameDone(fit: boolean, needed: number) {
    if (!this.deferredPresent) {
      return;
    }
    if (this._waitingHeadroom) {
      this._waitingHeadroom = false;
      pushSample(this._headroom, this._lastVsync, fit);
    }
    if (this.mode !== 'auto') {
      return;
    }
    if (needed > this._autoRefreshes && this._autoRefreshes < MAX_REFRESHES_PER_FRAME) {
      if (++this._overruns >= OVERRUNS_TO_SLOW_DOWN) {
        this._slowDown(this._lastVsync, Math.min(needed, MAX_REFRESHES_PER_FRAME));
      }
    } else {
      this._overruns = 0;
    }
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
      this._sinceRender = 0;
      this._wanted = refresh > 0 ? this._wantedRefreshes(refresh) : 1;
      return true;
    }
    const refreshes = Math.round((time - this._lastRender) / refresh);
    const wanted = this._wantedRefreshes(refresh);
    this._sinceRender = refreshes;
    if (this._waitingHeadroom && !this.deferredPresent) {
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
    this._sinceRender = 0;
    this._waitingHeadroom = wanted > 1;
    if (this.mode === 'auto') {
      this._adapt(time, missed);
    }
    // After adapting: the hold the frame about to render gets.
    this._wanted = this._wantedRefreshes(refresh);
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
    if (this._lastSpeedUp > -Infinity && time - this._lastSpeedUp >= FAILED_PROBE_TIME) {
      // The last speed up held: the next try may come sooner.
      this._lastSpeedUp = -Infinity;
      this._probeDelay = Math.max(INITIAL_PROBE_DELAY, this._probeDelay / 2);
    }
    const misses = this._misses;
    pushSample(misses, time, missed);
    if (
      this._autoRefreshes < MAX_REFRESHES_PER_FRAME &&
      misses.length >= MIN_SAMPLES &&
      count(misses) >= MIN_MISSES_TO_SLOW_DOWN &&
      ratio(misses) > MISS_RATIO_TO_SLOW_DOWN
    ) {
      // Frames often do not fit: hold each one a refresh longer.
      this._slowDown(time, this._autoRefreshes + 1);
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
  private _slowDown(time: number, to: number) {
    // Slowing down soon after speeding up means that was too early: wait
    // longer next time. Otherwise the delay stays as it is.
    if (time - this._lastSpeedUp < FAILED_PROBE_TIME) {
      this._lastSpeedUp = -Infinity;
      this._probeDelay = Math.min(this._probeDelay * 2, MAX_PROBE_DELAY);
    }
    this._setAutoRefreshes(to, time);
  }
  private _setAutoRefreshes(value: number, time: number) {
    this._autoRefreshes = value;
    this._stableSince = time;
    this._overruns = 0;
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
