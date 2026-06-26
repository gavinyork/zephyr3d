import { Observable } from '@zephyr3d/base';
import type {
  AnimationFrameEvent,
  AnimationMarkerEvent,
  AnimationPlayback,
  AnimationSet,
  PlayAnimationOptions,
  StopAnimationOptions
} from './animationset';

/**
 * How a response disposes of the timeline's currently active playbacks/steps.
 * - `'stop'` (default): stop the active steps before running the response.
 * - `'keep'`: leave the active steps running; the response runs concurrently.
 * - `{ fadeOut }`: stop the active steps with a fade-out.
 * @public
 */
export type AnimationTimelineActiveDisposition = 'stop' | 'keep' | { fadeOut: number };

/**
 * What a response does when its event fires. Exactly one variant applies.
 * @public
 */
export type AnimationTimelineEventTarget =
  | { steps: AnimationTimelineStep[]; targetState?: undefined; consume?: undefined; ignore?: undefined }
  | { targetState: string; steps?: undefined; consume?: undefined; ignore?: undefined }
  | { consume: true; steps?: undefined; targetState?: undefined; ignore?: undefined }
  | { ignore: true; steps?: undefined; targetState?: undefined; consume?: undefined };

/**
 * Resolved kind of action a dispatched event produced.
 * @public
 */
export type AnimationTimelineEventPolicy = 'none' | 'ignore' | 'consume' | 'steps' | 'enqueue' | 'transition';

/** @public */
export type AnimationTimelineEventResult = {
  handled: boolean;
  policy: AnimationTimelineEventPolicy;
  event: string;
  payload?: unknown;
};

/**
 * A reaction to a gameplay event, declared on a timeline or a controller state.
 *
 * The model is orthogonal: `target` says *what* to do, `onActive` says what happens to the
 * currently running steps, and `enqueue` defers `steps` instead of running them immediately.
 * @public
 */
export type AnimationTimelineEventResponse = {
  event: string;
  /** What the event does. */
  target: AnimationTimelineEventTarget;
  /**
   * Disposition of the currently active steps. Defaults to `'stop'`.
   * Use `'keep'` with `target.steps` to run the new steps concurrently (true parallel branch).
   * Ignored for `consume`/`ignore` targets.
   */
  onActive?: AnimationTimelineActiveDisposition;
  /**
   * When `true` and `target.steps` is set, the steps are appended to the queue and run after the
   * current steps drain, instead of replacing/joining them. `onActive` is ignored.
   */
  enqueue?: boolean;
};

/** @public */
export type AnimationTimelineStep =
  | {
      type: 'play';
      clip: string;
      id?: string;
      options?: PlayAnimationOptions;
      /**
       * Whether to block the timeline on this playback before advancing to the next step.
       * - `'complete'`: wait until the playback completes or is stopped.
       * - `false` or omitted (default): start the playback and immediately continue.
       *
       * A clip that loops forever (`repeat: 0`) only completes when stopped, so combine
       * `wait: 'complete'` with a finite `repeat`/`range` or an external stop.
       */
      wait?: 'complete' | false;
    }
  | {
      type: 'stop';
      target?: string;
      options?: StopAnimationOptions;
    }
  | {
      type: 'wait';
      seconds: number;
    }
  | {
      type: 'waitEvent';
      event: string;
    }
  | {
      type: 'waitMarker';
      marker: string;
      target?: string;
    }
  | {
      type: 'waitFrame';
      frame: number;
      target?: string;
    }
  | {
      type: 'emit';
      event: string;
      payload?: unknown;
    }
  | {
      type: 'sequence';
      steps: AnimationTimelineStep[];
    }
  | {
      type: 'parallel';
      steps: AnimationTimelineStep[];
    };

/** @public */
export type AnimationTimelineDefinition = {
  steps: AnimationTimelineStep[];
  responses?: AnimationTimelineEventResponse[];
};

/** @public */
export type AnimationTimelineRunnerEventMap = {
  complete: [runner: AnimationTimelineRunner];
  stop: [runner: AnimationTimelineRunner];
  emit: [event: string, payload: unknown];
};

/**
 * Serializable snapshot of a runner's runtime state.
 *
 * References to playbacks are by id; restoring playbacks themselves is the caller's
 * responsibility (replay should re-create the active playbacks before deserializing).
 * @public
 */
export type AnimationTimelineRunnerState = {
  stack: SerializedFrame[];
  concurrent: SerializedFrame[];
  queued: AnimationTimelineStep[][];
  /** Ids of playbacks owned by concurrent (keep-active) branches that have already drained. */
  concurrentPlaybackIds: string[];
  stopped: boolean;
};

/**
 * A scope tracks the "current playback" and named refs for a sequence of steps. Parallel branches
 * each own an isolated scope so their `waitMarker`/`waitFrame` resolve deterministically.
 *
 * `owner` records whether the scope belongs to the main control flow or a concurrent (keep-active)
 * branch, so a main-flow replacement does not stop the independent concurrent tracks.
 */
type FrameScope = {
  currentPlaybackId: string | null;
  refs: Record<string, string>;
  owner: 'main' | 'concurrent';
};

type SeqFrame = {
  kind: 'seq';
  steps: AnimationTimelineStep[];
  index: number;
  scope: FrameScope;
  child: TimelineFrame | null;
};

type ParallelFrame = {
  kind: 'parallel';
  branches: TimelineFrame[];
};

type WaitFrame = { kind: 'wait'; remaining: number };
type WaitEventFrame = { kind: 'waitEvent'; event: string };
type WaitMarkerFrame = { kind: 'waitMarker'; marker: string; playbackId: string | null; satisfied: boolean };
type WaitFrameFrame = { kind: 'waitFrame'; frame: number; playbackId: string | null; satisfied: boolean };
type PlayWaitFrame = { kind: 'playWait'; playbackId: string };

type TimelineFrame =
  | SeqFrame
  | ParallelFrame
  | WaitFrame
  | WaitEventFrame
  | WaitMarkerFrame
  | WaitFrameFrame
  | PlayWaitFrame;

/** Plain-data form of a frame (no live playback references), used by serialize/deserialize. */
type SerializedFrame = TimelineFrame;

/**
 * Outcome of ticking a single frame.
 * - `block`: the frame is still waiting; stop advancing this stack.
 * - `pop`: the frame finished; `leftover` (if any) is unconsumed time to carry to the next step.
 * - `advanced`: the frame moved its cursor or pushed a child; re-tick with zero delta.
 */
type TickResult = { status: 'block' | 'advanced'; leftover?: number } | { status: 'pop'; leftover?: number };

/**
 * Serializable animation timeline definition.
 * @public
 */
export class AnimationTimeline {
  readonly steps: AnimationTimelineStep[];
  readonly responses: AnimationTimelineEventResponse[];

  constructor(definition: AnimationTimelineDefinition | AnimationTimelineStep[]) {
    if (Array.isArray(definition)) {
      this.steps = definition;
      this.responses = [];
    } else {
      this.steps = definition.steps;
      this.responses = definition.responses ?? [];
    }
  }

  createRunner(animationSet: AnimationSet) {
    return new AnimationTimelineRunner(animationSet, this);
  }
}

/**
 * Runtime interpreter for an AnimationTimeline.
 *
 * The interpreter is a synchronous frame-stack state machine advanced by {@link tick}, which is
 * driven by `AnimationSet.update(dt)` on the same logical clock as the animations. There is no
 * `async`/`await` in the control flow, so the runtime state can be serialized and replayed.
 * @public
 */
export class AnimationTimelineRunner extends Observable<AnimationTimelineRunnerEventMap> {
  readonly animationSet: AnimationSet;
  readonly timeline: AnimationTimeline;
  private _stack: TimelineFrame[];
  private _concurrent: TimelineFrame[];
  private readonly _queued: AnimationTimelineStep[][];
  private _pendingEvents: string[];
  private _stopped: boolean;
  private _ticking: boolean;
  private readonly _onTick: (deltaInSeconds: number) => void;
  /** Tracks playbacks created by this runner so `stop()` can tear them down. */
  private readonly _ownedPlaybacks: Map<string, AnimationPlayback>;
  /** Ids of playbacks owned by concurrent (keep-active) branches; preserved across main-flow stops. */
  private readonly _concurrentPlaybackIds: Set<string>;
  /** Marker/frame crossings observed since the last tick, keyed by playback id. */
  private readonly _crossedMarkers: Map<string, Set<string>>;
  private readonly _crossedFrames: Map<string, Set<number>>;

  constructor(animationSet: AnimationSet, timeline: AnimationTimeline) {
    super();
    this.animationSet = animationSet;
    this.timeline = timeline;
    this._stack = [];
    this._concurrent = [];
    this._queued = [];
    this._pendingEvents = [];
    this._stopped = true;
    this._ticking = false;
    this._onTick = (deltaInSeconds) => this.tick(deltaInSeconds);
    this._ownedPlaybacks = new Map();
    this._concurrentPlaybackIds = new Set();
    this._crossedMarkers = new Map();
    this._crossedFrames = new Map();
  }

  get currentPlayback() {
    const scope = this.activeScope();
    if (!scope?.currentPlaybackId) {
      return null;
    }
    return this._ownedPlaybacks.get(scope.currentPlaybackId) ?? null;
  }

  get stopped() {
    return this._stopped;
  }

  start() {
    this._stopped = false;
    this._stack = [this.makeSeqFrame(this.timeline.steps)];
    this._concurrent = [];
    this._queued.length = 0;
    this._pendingEvents = [];
    this.animationSet._registerTimelineTicker(this._onTick);
    // Drain any leading non-blocking steps immediately so e.g. an initial `play` starts now.
    this.flush();
    return this;
  }

  stop(options?: StopAnimationOptions) {
    const wasStopped = this._stopped;
    this._stopped = true;
    this._stack = [];
    this._concurrent = [];
    this._queued.length = 0;
    this._pendingEvents = [];
    this._crossedMarkers.clear();
    this._crossedFrames.clear();
    const stopOptions = options ?? { reason: 'interrupted' };
    // Always tear down owned playbacks, even if the control flow already drained: a state whose
    // script finished may still have a looping clip playing that a transition must stop.
    this._ownedPlaybacks.forEach((playback) => {
      this.detachPlayback(playback);
      playback.stop(stopOptions);
    });
    this._ownedPlaybacks.clear();
    this._concurrentPlaybackIds.clear();
    this.animationSet._unregisterTimelineTicker(this._onTick);
    if (!wasStopped) {
      this.dispatchEvent('stop', this);
    }
    return this;
  }

  enqueue(steps: AnimationTimelineStep[]) {
    if (steps.length === 0) {
      return;
    }
    this._queued.push(steps);
    // Revive a runner that already drained so queued steps are not silently dropped.
    if (this._stopped) {
      this._stopped = false;
      this._stack = [];
      this.animationSet._registerTimelineTicker(this._onTick);
    }
    this.flush();
  }

  /**
   * Run `steps` concurrently with the current control flow (a true parallel branch). Unlike
   * {@link enqueue}, these do not wait for the main stack to drain.
   * @public
   */
  runConcurrent(steps: AnimationTimelineStep[]) {
    if (steps.length === 0) {
      return;
    }
    this._concurrent.push(this.makeSeqFrame(steps, 'concurrent'));
    if (this._stopped) {
      this._stopped = false;
      this.animationSet._registerTimelineTicker(this._onTick);
    } else {
      this.ensureTicking();
    }
    this.flush();
  }

  dispatch(event: string, payload?: unknown): AnimationTimelineEventResult {
    // A waiting `waitEvent` frame consumes the event; flush advances past it synchronously.
    if (this.hasWaiterFor(event)) {
      this._pendingEvents.push(event);
      this.flush();
      return { handled: true, policy: 'consume', event, payload };
    }
    const response = this.timeline.responses.find((item) => item.event === event);
    if (!response || response.target.ignore) {
      return { handled: false, policy: response ? 'ignore' : 'none', event, payload };
    }
    if (response.target.consume) {
      return { handled: true, policy: 'consume', event, payload };
    }
    if (response.target.targetState !== undefined) {
      // Only the controller can switch states; bubble up so it can act on its own table.
      return { handled: false, policy: 'transition', event, payload };
    }
    const steps = response.target.steps;
    if (!steps?.length) {
      return { handled: false, policy: 'none', event, payload };
    }
    if (response.enqueue) {
      this.enqueue(steps);
      return { handled: true, policy: 'enqueue', event, payload };
    }
    const disposition = response.onActive ?? 'stop';
    if (disposition === 'keep') {
      // Run the new steps concurrently with the existing control flow (true parallel branch).
      this.runConcurrent(steps);
    } else {
      const stopOptions =
        typeof disposition === 'object' ? { ...disposition, reason: 'interrupted' as const } : undefined;
      this.stopMainFlow(stopOptions);
      this._stopped = false;
      this._stack = [this.makeSeqFrame(steps)];
      this.ensureTicking();
      this.flush();
    }
    return { handled: true, policy: 'steps', event, payload };
  }

  /**
   * Run pending non-blocking work synchronously (a zero-delta tick), without advancing any
   * time-based waits. Lets `start()`/`dispatch()` take effect immediately while keeping all
   * runtime state in the serializable frame stack.
   * @public
   */
  flush() {
    // Guard against re-entrancy: an `emit` listener firing during a tick may dispatch again.
    if (!this._ticking) {
      this.tick(0);
    }
    return this;
  }

  /**
   * Advance the timeline by `deltaInSeconds`. Called by `AnimationSet.update`.
   * @public
   */
  tick(deltaInSeconds: number) {
    if (this._stopped && this._queued.length === 0) {
      return;
    }
    this._ticking = true;
    // Advance the main control-flow stack.
    if (this._stack.length === 0 && this._queued.length > 0) {
      const next = this._queued.shift()!;
      this._stack = [this.makeSeqFrame(next)];
    }
    if (this._stack.length > 0) {
      this.tickFrames(this._stack, deltaInSeconds);
    }
    // Advance any concurrent (keep-active) branches; drop the ones that finished.
    if (this._concurrent.length > 0) {
      this._concurrent = this._concurrent.filter((frame) => {
        const stack = [frame];
        this.tickFrames(stack, deltaInSeconds);
        return stack.length > 0;
      });
    }
    // Consumed this tick.
    this._pendingEvents = [];
    this._crossedMarkers.clear();
    this._crossedFrames.clear();
    this._ticking = false;
    // Pull queued batches once the stack drains.
    while (this._stack.length === 0 && this._queued.length > 0) {
      const next = this._queued.shift()!;
      this._stack = [this.makeSeqFrame(next)];
      this.tickFrames(this._stack, 0);
    }
    if (
      !this._stopped &&
      this._stack.length === 0 &&
      this._concurrent.length === 0 &&
      this._queued.length === 0
    ) {
      this._stopped = true;
      this.animationSet._unregisterTimelineTicker(this._onTick);
      this.dispatchEvent('complete', this);
    }
  }

  /**
   * Export the runtime state as plain data.
   * @public
   */
  serialize(): AnimationTimelineRunnerState {
    return {
      stack: this._stack.map((frame) => this.cloneFrame(frame)),
      concurrent: this._concurrent.map((frame) => this.cloneFrame(frame)),
      queued: this._queued.map((steps) => steps.slice()),
      concurrentPlaybackIds: [...this._concurrentPlaybackIds],
      stopped: this._stopped
    };
  }

  /**
   * Restore runtime state previously produced by {@link serialize}.
   *
   * Re-create the relevant active playbacks on the AnimationSet before calling this so that
   * playback-bound frames (play-wait, waitMarker, waitFrame) can re-attach by id.
   * @public
   */
  static deserialize(
    animationSet: AnimationSet,
    timeline: AnimationTimeline,
    state: AnimationTimelineRunnerState
  ): AnimationTimelineRunner {
    const runner = new AnimationTimelineRunner(animationSet, timeline);
    runner._stack = state.stack.map((frame) => runner.cloneFrame(frame));
    runner._concurrent = state.concurrent.map((frame) => runner.cloneFrame(frame));
    state.queued.forEach((steps) => runner._queued.push(steps.slice()));
    state.concurrentPlaybackIds?.forEach((id) => runner._concurrentPlaybackIds.add(id));
    runner._stopped = state.stopped;
    // Re-attach to any live playbacks referenced by the restored frames.
    runner.reattachPlaybacks(runner._stack);
    runner._concurrent.forEach((frame) => runner.reattachPlaybacks([frame]));
    // Re-attach drained concurrent playbacks tracked only by id, so they survive future stops.
    runner._concurrentPlaybackIds.forEach((id) => {
      if (!runner._ownedPlaybacks.has(id)) {
        const playback = runner.findLivePlayback(id);
        if (playback) {
          runner.attachPlayback(playback);
        }
      }
    });
    if (!runner._stopped) {
      animationSet._registerTimelineTicker(runner._onTick);
    }
    return runner;
  }

  // --- internals -------------------------------------------------------------

  private ensureTicking() {
    if (!this._ticking) {
      this.animationSet._registerTimelineTicker(this._onTick);
    }
  }

  private makeSeqFrame(steps: AnimationTimelineStep[], owner: 'main' | 'concurrent' = 'main'): SeqFrame {
    return {
      kind: 'seq',
      steps,
      index: 0,
      scope: { currentPlaybackId: null, refs: {}, owner },
      child: null
    };
  }

  /** The scope of the innermost active sequence on the main stack (for currentPlayback). */
  private activeScope(): FrameScope | null {
    for (let i = this._stack.length - 1; i >= 0; i--) {
      const scope = this.deepestScope(this._stack[i]);
      if (scope) {
        return scope;
      }
    }
    return null;
  }

  private deepestScope(frame: TimelineFrame): FrameScope | null {
    if (frame.kind === 'seq') {
      return frame.child ? (this.deepestScope(frame.child) ?? frame.scope) : frame.scope;
    }
    return null;
  }

  /**
   * Advance a frame stack in place. The top frame runs until it blocks or completes; completed
   * frames pop and the parent sequence advances. Returns when the stack blocks or empties.
   */
  private tickFrames(stack: TimelineFrame[], deltaInSeconds: number) {
    this.tickFramesWithLeftover(stack, deltaInSeconds);
  }

  /**
   * Same as {@link tickFrames} but returns the time left unconsumed when the stack drains
   * completely (so a parent sequence can hand it to its next step).
   */
  private tickFramesWithLeftover(stack: TimelineFrame[], deltaInSeconds: number): number {
    let guard = 0;
    while (stack.length > 0) {
      if (++guard > 10000) {
        // Defensive: a malformed timeline should not spin forever.
        break;
      }
      const frame = stack[stack.length - 1];
      const result = this.tickFrame(frame, stack, deltaInSeconds);
      if (result.status === 'block') {
        return 0;
      }
      if (result.status === 'pop') {
        stack.pop();
        // Carry any unused time (e.g. a `wait` that overshot its duration this tick) to the next
        // step so a sequence of waits/actions tracks logical time regardless of frame rate.
        deltaInSeconds = result.leftover ?? 0;
        continue;
      }
      // 'advanced': the frame pushed a child or moved its cursor; loop again with delta 0 so a
      // single tick can drain consecutive non-blocking steps.
      deltaInSeconds = 0;
    }
    return deltaInSeconds;
  }

  private tickFrame(frame: TimelineFrame, stack: TimelineFrame[], deltaInSeconds: number): TickResult {
    switch (frame.kind) {
      case 'seq':
        return this.tickSeq(frame, stack, deltaInSeconds);
      case 'parallel':
        return this.tickParallel(frame, deltaInSeconds);
      case 'wait':
        frame.remaining -= deltaInSeconds;
        // On completion, hand back the overshoot (negative remaining) as leftover time.
        return frame.remaining <= 0 ? { status: 'pop', leftover: -frame.remaining } : { status: 'block' };
      case 'waitEvent':
        return this._pendingEvents.includes(frame.event) ? { status: 'pop' } : { status: 'block' };
      case 'waitMarker':
        return this.tickWaitMarker(frame);
      case 'waitFrame':
        return this.tickWaitFrame(frame);
      case 'playWait':
        return this.tickPlayWait(frame);
    }
  }

  private tickSeq(frame: SeqFrame, _stack: TimelineFrame[], deltaInSeconds: number): TickResult {
    // Drain steps in a loop so unconsumed time (e.g. a `wait` that overshot) flows into the next
    // step within the same tick instead of being dropped.
    let guard = 0;
    for (;;) {
      if (++guard > 10000) {
        return { status: 'block' };
      }
      if (frame.child) {
        const childStack = [frame.child];
        const leftover = this.tickFramesWithLeftover(childStack, deltaInSeconds);
        if (childStack.length > 0) {
          return { status: 'block' };
        }
        frame.child = null;
        frame.index++;
        deltaInSeconds = leftover;
      }
      if (frame.index >= frame.steps.length) {
        return { status: 'pop', leftover: deltaInSeconds };
      }
      const step = frame.steps[frame.index];
      const blocking = this.beginStep(step, frame);
      if (blocking) {
        // Tick the freshly-pushed child immediately with the carried time on the next loop turn.
        frame.child = blocking;
        continue;
      }
      frame.index++;
      // A non-blocking step consumes no time; keep the remaining delta for the following step.
    }
  }

  private tickParallel(frame: ParallelFrame, deltaInSeconds: number): TickResult {
    frame.branches = frame.branches.filter((branch) => {
      const branchStack = [branch];
      this.tickFrames(branchStack, deltaInSeconds);
      return branchStack.length > 0;
    });
    // Parallel branches may finish at different times; we do not attempt to reconcile a single
    // leftover across them, so the join simply consumes the whole tick.
    return frame.branches.length > 0 ? { status: 'block' } : { status: 'pop' };
  }

  /**
   * Execute a non-blocking step immediately and return null, or return a frame to block on.
   */
  private beginStep(step: AnimationTimelineStep, scopeFrame: SeqFrame): TimelineFrame | null {
    const scope = scopeFrame.scope;
    switch (step.type) {
      case 'sequence': {
        const child = this.makeSeqFrame(step.steps);
        // Inherit the parent scope so refs/currentPlayback carry into the nested sequence.
        child.scope = scope;
        return child;
      }
      case 'parallel': {
        // Each branch gets an isolated scope so currentPlayback/refs don't race (#7), but inherits
        // the parent's owner so concurrent branches stay concurrent through nested parallels.
        const branches = step.steps.map((child) => {
          const branchScope: FrameScope = {
            currentPlaybackId: scope.currentPlaybackId,
            refs: { ...scope.refs },
            owner: scope.owner
          };
          const seq = this.makeSeqFrame([child]);
          seq.scope = branchScope;
          return seq as TimelineFrame;
        });
        return { kind: 'parallel', branches };
      }
      case 'play': {
        const playback = this.animationSet.play(step.clip, step.options);
        if (!playback) {
          return null;
        }
        this.attachPlayback(playback);
        if (scope.owner === 'concurrent') {
          // Remember concurrent ownership independently of the frames: a non-blocking keep-active
          // play drains out of `_concurrent` immediately, but its playback must still survive a
          // later main-flow replacement (#2).
          this._concurrentPlaybackIds.add(playback.id);
        }
        scope.currentPlaybackId = playback.id;
        if (step.id) {
          scope.refs[step.id] = playback.id;
        }
        scope.refs[playback.id] = playback.id;
        if (step.wait === 'complete') {
          return { kind: 'playWait', playbackId: playback.id };
        }
        return null;
      }
      case 'stop': {
        const playback = this.resolvePlayback(step.target, scope);
        if (playback) {
          playback.stop(step.options);
        } else if (!step.target) {
          this._ownedPlaybacks.forEach((item) => item.stop(step.options));
        }
        return null;
      }
      case 'wait':
        return step.seconds > 0 ? { kind: 'wait', remaining: step.seconds } : null;
      case 'waitEvent':
        return { kind: 'waitEvent', event: step.event };
      case 'waitMarker': {
        const playback = this.resolvePlayback(step.target, scope) ?? this.scopeCurrentPlayback(scope);
        if (!playback) {
          return null;
        }
        return { kind: 'waitMarker', marker: step.marker, playbackId: playback.id, satisfied: false };
      }
      case 'waitFrame': {
        const playback = this.resolvePlayback(step.target, scope) ?? this.scopeCurrentPlayback(scope);
        if (!playback) {
          return null;
        }
        return { kind: 'waitFrame', frame: step.frame, playbackId: playback.id, satisfied: false };
      }
      case 'emit':
        this.dispatchEvent('emit', step.event, step.payload);
        return null;
    }
  }

  private tickWaitMarker(frame: WaitMarkerFrame): TickResult {
    if (frame.satisfied || !frame.playbackId) {
      return { status: 'pop' };
    }
    const playback = this._ownedPlaybacks.get(frame.playbackId);
    if (!playback || playback.state === 'stopped' || playback.state === 'completed') {
      return { status: 'pop' };
    }
    const crossed = this._crossedMarkers.get(frame.playbackId);
    if (crossed && crossed.has(frame.marker)) {
      return { status: 'pop' };
    }
    return { status: 'block' };
  }

  private tickWaitFrame(frame: WaitFrameFrame): TickResult {
    if (frame.satisfied || frame.playbackId === null) {
      return { status: 'pop' };
    }
    const playback = this._ownedPlaybacks.get(frame.playbackId);
    if (!playback || playback.state === 'stopped' || playback.state === 'completed') {
      return { status: 'pop' };
    }
    const crossed = this._crossedFrames.get(frame.playbackId);
    if (crossed && crossed.has(frame.frame)) {
      return { status: 'pop' };
    }
    return { status: 'block' };
  }

  private tickPlayWait(frame: PlayWaitFrame): TickResult {
    const playback = this._ownedPlaybacks.get(frame.playbackId);
    if (!playback || playback.state === 'stopped' || playback.state === 'completed') {
      return { status: 'pop' };
    }
    return { status: 'block' };
  }

  private attachPlayback(playback: AnimationPlayback) {
    this._ownedPlaybacks.set(playback.id, playback);
    playback.on('marker', this.onPlaybackMarker);
    playback.on('frame', this.onPlaybackFrame);
    playback.on('stop', this.onPlaybackEnd);
    playback.on('complete', this.onPlaybackEnd);
  }

  private detachPlayback(playback: AnimationPlayback) {
    playback.off('marker', this.onPlaybackMarker);
    playback.off('frame', this.onPlaybackFrame);
    playback.off('stop', this.onPlaybackEnd);
    playback.off('complete', this.onPlaybackEnd);
  }

  /**
   * Cleanup when an owned playback ends (externally or naturally). Only touches runner-local
   * bookkeeping, so it is safe to run inside `AnimationSet.update`'s playback loop. Frames blocked
   * on this playback observe its absence on the next tick and unblock.
   */
  private readonly onPlaybackEnd = (event: { playback: AnimationPlayback }) => {
    const playback = this._ownedPlaybacks.get(event.playback.id);
    if (playback) {
      this.detachPlayback(playback);
      this._ownedPlaybacks.delete(playback.id);
      this._concurrentPlaybackIds.delete(playback.id);
    }
  };

  private readonly onPlaybackMarker = (event: AnimationMarkerEvent) => {
    const id = event.playback.id;
    let set = this._crossedMarkers.get(id);
    if (!set) {
      set = new Set();
      this._crossedMarkers.set(id, set);
    }
    if (event.marker.id !== undefined) {
      set.add(event.marker.id);
    }
    set.add(event.marker.name);
  };

  private readonly onPlaybackFrame = (event: AnimationFrameEvent) => {
    const id = event.playback.id;
    let set = this._crossedFrames.get(id);
    if (!set) {
      set = new Set();
      this._crossedFrames.set(id, set);
    }
    set.add(event.frame);
  };

  private resolvePlayback(target: string | undefined, scope: FrameScope): AnimationPlayback | null {
    if (!target) {
      return null;
    }
    const mapped = scope.refs[target];
    if (mapped) {
      const owned = this._ownedPlaybacks.get(mapped);
      if (owned) {
        return owned;
      }
    }
    return this._ownedPlaybacks.get(target) ?? this.animationSet.getPlayback(target);
  }

  private scopeCurrentPlayback(scope: FrameScope): AnimationPlayback | null {
    return scope.currentPlaybackId ? (this._ownedPlaybacks.get(scope.currentPlaybackId) ?? null) : null;
  }

  private hasWaiterFor(event: string): boolean {
    const inFrame = (frame: TimelineFrame): boolean => {
      switch (frame.kind) {
        case 'waitEvent':
          return frame.event === event;
        case 'seq':
          return frame.child ? inFrame(frame.child) : false;
        case 'parallel':
          return frame.branches.some(inFrame);
        default:
          return false;
      }
    };
    return this._stack.some(inFrame) || this._concurrent.some(inFrame);
  }

  /** Stop only the main control flow (used when a response replaces it). */
  private stopMainFlow(options?: StopAnimationOptions) {
    const stopOptions = options ?? { reason: 'interrupted' };
    // Stop every playback owned by the main flow, not just those still referenced by `_stack`:
    // a sequence that already drained may have left a looping clip playing (e.g. `play idle` with
    // `repeat: 0`), and replacing the main flow must stop it. Playbacks owned by concurrent
    // (keep-active) branches are independent parallel tracks and are preserved — tracked by id so
    // they survive even after their branch frames drained.
    this._ownedPlaybacks.forEach((playback, id) => {
      if (this._concurrentPlaybackIds.has(id)) {
        return;
      }
      this.detachPlayback(playback);
      playback.stop(stopOptions);
      this._ownedPlaybacks.delete(id);
    });
    this._stack = [];
  }

  private collectScopePlaybackIds(frames: TimelineFrame[]): Set<string> {
    const ids = new Set<string>();
    const visit = (frame: TimelineFrame) => {
      if (frame.kind === 'seq') {
        Object.values(frame.scope.refs).forEach((id) => ids.add(id));
        if (frame.scope.currentPlaybackId) {
          ids.add(frame.scope.currentPlaybackId);
        }
        if (frame.child) {
          visit(frame.child);
        }
      } else if (frame.kind === 'parallel') {
        frame.branches.forEach(visit);
      }
    };
    frames.forEach(visit);
    return ids;
  }

  private cloneFrame(frame: TimelineFrame): TimelineFrame {
    switch (frame.kind) {
      case 'seq':
        return {
          kind: 'seq',
          steps: frame.steps,
          index: frame.index,
          scope: {
            currentPlaybackId: frame.scope.currentPlaybackId,
            refs: { ...frame.scope.refs },
            owner: frame.scope.owner
          },
          child: frame.child ? this.cloneFrame(frame.child) : null
        };
      case 'parallel':
        return { kind: 'parallel', branches: frame.branches.map((b) => this.cloneFrame(b)) };
      case 'wait':
        return { kind: 'wait', remaining: frame.remaining };
      case 'waitEvent':
        return { kind: 'waitEvent', event: frame.event };
      case 'waitMarker':
        return { ...frame };
      case 'waitFrame':
        return { ...frame };
      case 'playWait':
        return { ...frame };
    }
  }

  private reattachPlaybacks(frames: TimelineFrame[]) {
    const ids = this.collectAllPlaybackIds(frames);
    ids.forEach((id) => {
      if (this._ownedPlaybacks.has(id)) {
        return;
      }
      const playback = this.findLivePlayback(id);
      if (playback) {
        this.attachPlayback(playback);
      }
    });
  }

  private collectAllPlaybackIds(frames: TimelineFrame[]): Set<string> {
    const ids = this.collectScopePlaybackIds(frames);
    const visit = (frame: TimelineFrame) => {
      if (frame.kind === 'playWait') {
        ids.add(frame.playbackId);
      } else if ((frame.kind === 'waitMarker' || frame.kind === 'waitFrame') && frame.playbackId) {
        ids.add(frame.playbackId);
      } else if (frame.kind === 'seq' && frame.child) {
        visit(frame.child);
      } else if (frame.kind === 'parallel') {
        frame.branches.forEach(visit);
      }
    };
    frames.forEach(visit);
    return ids;
  }

  private findLivePlayback(id: string): AnimationPlayback | null {
    return this.animationSet.getPlaybacks().find((playback) => playback.id === id) ?? null;
  }
}
