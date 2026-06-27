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
 * Return target for controller state-transition responses.
 *
 * - `true`: return to the state that was active before the transition.
 * - `string`: return to the named state.
 *
 * Only {@link AnimationController} state responses can perform the return; bare timeline runners
 * report state-transition targets as unhandled so the controller can act on them.
 * @public
 */
export type AnimationTimelineStateReturnTarget = true | string;

/**
 * What a response does when its event fires. Exactly one variant applies.
 * @public
 */
export type AnimationTimelineEventTarget =
  | {
      /** Steps to run when the event is handled. */
      steps: AnimationTimelineStep[];
      /** Not used for step targets; keeps this union variant mutually exclusive. */
      targetState?: undefined;
      /** Not used for step targets; keeps this union variant mutually exclusive. */
      returnTo?: undefined;
      /** Not used for step targets; keeps this union variant mutually exclusive. */
      returnTransition?: undefined;
      /** Not used for step targets; keeps this union variant mutually exclusive. */
      consume?: undefined;
      /** Not used for step targets; keeps this union variant mutually exclusive. */
      ignore?: undefined;
    }
  | {
      /** Controller state name to transition to. */
      targetState: string;
      /**
       * Optional state to enter when `targetState` completes.
       *
       * Use `true` to return to the state active before the transition, or a string to return to
       * a specific named state. This is only applied by {@link AnimationController}.
       */
      returnTo?: AnimationTimelineStateReturnTarget;
      /**
       * Optional transition duration used when returning from `targetState`.
       *
       * If omitted, the return state's own transition setting is used.
       */
      returnTransition?: number;
      /** Not used for state-transition targets; keeps this union variant mutually exclusive. */
      steps?: undefined;
      /** Not used for state-transition targets; keeps this union variant mutually exclusive. */
      consume?: undefined;
      /** Not used for state-transition targets; keeps this union variant mutually exclusive. */
      ignore?: undefined;
    }
  | {
      /** Consume the event without starting steps or changing state. */
      consume: true;
      /** Not used for consume targets; keeps this union variant mutually exclusive. */
      steps?: undefined;
      /** Not used for consume targets; keeps this union variant mutually exclusive. */
      targetState?: undefined;
      /** Not used for consume targets; keeps this union variant mutually exclusive. */
      returnTo?: undefined;
      /** Not used for consume targets; keeps this union variant mutually exclusive. */
      returnTransition?: undefined;
      /** Not used for consume targets; keeps this union variant mutually exclusive. */
      ignore?: undefined;
    }
  | {
      /** Explicitly ignore the event. */
      ignore: true;
      /** Not used for ignore targets; keeps this union variant mutually exclusive. */
      steps?: undefined;
      /** Not used for ignore targets; keeps this union variant mutually exclusive. */
      targetState?: undefined;
      /** Not used for ignore targets; keeps this union variant mutually exclusive. */
      returnTo?: undefined;
      /** Not used for ignore targets; keeps this union variant mutually exclusive. */
      returnTransition?: undefined;
      /** Not used for ignore targets; keeps this union variant mutually exclusive. */
      consume?: undefined;
    };

/**
 * Resolved kind of action a dispatched event produced.
 * @public
 */
export type AnimationTimelineEventPolicy = 'none' | 'ignore' | 'consume' | 'steps' | 'enqueue' | 'transition';

/**
 * Result returned when a timeline or controller dispatches an event.
 * @public
 */
export type AnimationTimelineEventResult = {
  /**
   * Whether the event was consumed, converted into steps, enqueued, or accepted as a transition.
   */
  handled: boolean;
  /**
   * The action selected for the event.
   */
  policy: AnimationTimelineEventPolicy;
  /**
   * Dispatched event name.
   */
  event: string;
  /**
   * Optional payload supplied by the caller.
   */
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
  /**
   * Event name this response handles.
   */
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

/**
 * One executable instruction in an animation timeline.
 * @public
 */
export type AnimationTimelineStep =
  | {
      /** Start an animation clip playback. */
      type: 'play';
      /** Name of the animation clip to play from the owning AnimationSet. */
      clip: string;
      /**
       * Optional local reference id used by later `target` fields in this runner.
       *
       * If a later step replaces the same logical playback and future responses should keep using
       * this name, assign the same id again on the replacement `play` step.
       */
      id?: string;
      /** Playback options passed to `AnimationSet.play`. */
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
      /** Stop a playback owned by this runner. */
      type: 'stop';
      /**
       * Optional playback target id.
       *
       * When omitted, all playbacks owned by the current runner are stopped.
       */
      target?: string;
      /** Stop behavior passed to the matching playback or playbacks. */
      options?: StopAnimationOptions;
    }
  | {
      /** Wait for a fixed duration. */
      type: 'wait';
      /** Number of seconds to wait before continuing. */
      seconds: number;
    }
  | {
      /** Wait until a matching event is dispatched to the runner. */
      type: 'waitEvent';
      /** Event name that releases the wait. */
      event: string;
    }
  | {
      /** Wait until a playback crosses a marker. */
      type: 'waitMarker';
      /** Marker id or name to wait for. */
      marker: string;
      /** Optional playback target id; defaults to the current playback in scope. */
      target?: string;
    }
  | {
      /** Wait until a playback crosses a frame number. */
      type: 'waitFrame';
      /** Frame number to wait for. */
      frame: number;
      /** Optional playback target id; defaults to the current playback in scope. */
      target?: string;
    }
  | {
      /** Emit a timeline event through the runner. */
      type: 'emit';
      /** Event name emitted to runner listeners. */
      event: string;
      /** Optional payload emitted with the event. */
      payload?: unknown;
    }
  | {
      /** Execute child steps sequentially. */
      type: 'sequence';
      /** Child steps run in order. */
      steps: AnimationTimelineStep[];
    }
  | {
      /** Execute child steps as parallel branches. */
      type: 'parallel';
      /** Child steps that become isolated parallel branches. */
      steps: AnimationTimelineStep[];
    };

/**
 * Serializable timeline definition.
 * @public
 */
export type AnimationTimelineDefinition = {
  /**
   * Root sequence of timeline steps.
   */
  steps: AnimationTimelineStep[];
  /**
   * Optional responses evaluated when dispatched events are not consumed by waiters.
   */
  responses?: AnimationTimelineEventResponse[];
};

/**
 * Event map emitted by {@link AnimationTimelineRunner}.
 * @public
 */
export type AnimationTimelineRunnerEventMap = {
  /**
   * Emitted when the runner drains all main, concurrent, and queued work.
   */
  complete: [runner: AnimationTimelineRunner];
  /**
   * Emitted when an active runner is explicitly stopped.
   */
  stop: [runner: AnimationTimelineRunner];
  /**
   * Emitted by an `emit` timeline step.
   */
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
  /**
   * Serialized main control-flow stack.
   */
  stack: SerializedFrame[];
  /**
   * Serialized concurrent branches started with `keep` responses.
   */
  concurrent: SerializedFrame[];
  /**
   * Queued step batches waiting for the main stack to drain.
   */
  queued: AnimationTimelineStep[][];
  /** Ids of playbacks owned by concurrent (keep-active) branches that have already drained. */
  concurrentPlaybackIds: string[];
  /**
   * Runner-level playback references preserved after the frame that created them has drained.
   */
  playbackRefs?: Record<string, string>;
  /**
   * Whether the runner was stopped when the state was captured.
   */
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
  /**
   * Root step sequence executed by runners created from this timeline.
   */
  readonly steps: AnimationTimelineStep[];
  /**
   * Event responses declared on this timeline.
   */
  readonly responses: AnimationTimelineEventResponse[];

  /**
   * Create a timeline from a definition object or a root step array.
   *
   * @param definition - Timeline definition, or a shorthand array used as the root steps.
   */
  constructor(definition: AnimationTimelineDefinition | AnimationTimelineStep[]) {
    if (Array.isArray(definition)) {
      this.steps = definition;
      this.responses = [];
    } else {
      this.steps = definition.steps;
      this.responses = definition.responses ?? [];
    }
  }

  /**
   * Create a runtime runner for this timeline.
   *
   * @param animationSet - Animation set used to create and update playbacks.
   * @returns A new stopped runner bound to this timeline and animation set.
   */
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
  /**
   * Animation set used to start, stop, and query animation playbacks.
   */
  readonly animationSet: AnimationSet;
  /**
   * Timeline definition interpreted by this runner.
   */
  readonly timeline: AnimationTimeline;
  private _stack: TimelineFrame[];
  private _concurrent: TimelineFrame[];
  private readonly _queued: AnimationTimelineStep[][];
  private _pendingEvents: string[];
  private _stopped: boolean;
  private _ticking: boolean;
  private _lastCompletedPlaybackId: string | null;
  private readonly _onTick: (deltaInSeconds: number) => void;
  /** Tracks playbacks created by this runner so `stop()` can tear them down. */
  private readonly _ownedPlaybacks: Map<string, AnimationPlayback>;
  /** Local playback refs that survive after the sequence frame that declared them drains. */
  private readonly _playbackRefs: Map<string, string>;
  /** Ids of playbacks owned by concurrent (keep-active) branches; preserved across main-flow stops. */
  private readonly _concurrentPlaybackIds: Set<string>;
  /** Marker/frame crossings observed since the last tick, keyed by playback id. */
  private readonly _crossedMarkers: Map<string, Set<string>>;
  private readonly _crossedFrames: Map<string, Set<number>>;

  /**
   * Create a stopped runner for a timeline.
   *
   * @param animationSet - Animation set that owns clips and playbacks referenced by the timeline.
   * @param timeline - Timeline definition to interpret.
   */
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
    this._lastCompletedPlaybackId = null;
    this._onTick = (deltaInSeconds) => this.tick(deltaInSeconds);
    this._ownedPlaybacks = new Map();
    this._playbackRefs = new Map();
    this._concurrentPlaybackIds = new Set();
    this._crossedMarkers = new Map();
    this._crossedFrames = new Map();
  }

  /**
   * Playback currently referenced by the active main-flow scope.
   *
   * @returns The current playback, or null when the main flow has no active playback reference.
   */
  get currentPlayback() {
    const scope = this.activeScope();
    if (!scope?.currentPlaybackId) {
      return null;
    }
    return this._ownedPlaybacks.get(scope.currentPlaybackId) ?? null;
  }

  /**
   * Whether this runner is stopped.
   *
   * @returns True when the runner is stopped; otherwise false.
   */
  get stopped() {
    return this._stopped;
  }

  /**
   * Playback id for the most recent playback that completed naturally.
   *
   * @returns The playback id, or null when no owned playback has completed.
   */
  get lastCompletedPlaybackId() {
    return this._lastCompletedPlaybackId;
  }

  /**
   * Start or restart the runner from the beginning of the timeline.
   *
   * @returns This runner for chaining.
   */
  start() {
    this._stopped = false;
    this._stack = [this.makeSeqFrame(this.timeline.steps)];
    this._concurrent = [];
    this._queued.length = 0;
    this._pendingEvents = [];
    this._lastCompletedPlaybackId = null;
    this._playbackRefs.clear();
    this.animationSet._registerTimelineTicker(this._onTick);
    // Drain any leading non-blocking steps immediately so e.g. an initial `play` starts now.
    this.flush();
    return this;
  }

  /**
   * Stop the runner and all playbacks it owns.
   *
   * @param options - Optional stop behavior applied to owned playbacks.
   * @returns This runner for chaining.
   */
  stop(options?: StopAnimationOptions) {
    const wasStopped = this._stopped;
    this._stopped = true;
    this._stack = [];
    this._concurrent = [];
    this._queued.length = 0;
    this._pendingEvents = [];
    this._crossedMarkers.clear();
    this._crossedFrames.clear();
    this._lastCompletedPlaybackId = null;
    const stopOptions = options ?? { reason: 'interrupted' };
    // Always tear down owned playbacks, even if the control flow already drained: a state whose
    // script finished may still have a looping clip playing that a transition must stop.
    this._ownedPlaybacks.forEach((playback) => {
      this.detachPlayback(playback);
      playback.stop(stopOptions);
    });
    this._ownedPlaybacks.clear();
    this._playbackRefs.clear();
    this._concurrentPlaybackIds.clear();
    this.animationSet._unregisterTimelineTicker(this._onTick);
    if (!wasStopped) {
      this.dispatchEvent('stop', this);
    }
    return this;
  }

  /**
   * Append a batch of steps to run after the main stack drains.
   *
   * If the runner has already completed, enqueueing steps revives it and registers it for ticking.
   *
   * @param steps - Steps to run as the next queued batch.
   * @returns void
   */
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
   *
   * @param steps - Steps to run immediately in an independent concurrent branch.
   * @returns void
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

  /**
   * Dispatch an event to this runner.
   *
   * Waiting `waitEvent` frames consume matching events first. If no waiter consumes the event,
   * the timeline response table is evaluated.
   *
   * @param event - Event name to dispatch.
   * @param payload - Optional payload returned in the result.
   * @returns The resolved handling result for the event.
   */
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
   *
   * @returns This runner for chaining.
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
   *
   * @param deltaInSeconds - Elapsed time in seconds for this tick.
   * @returns void
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
   *
   * @returns A serializable snapshot of the runner state.
   * @public
   */
  serialize(): AnimationTimelineRunnerState {
    return {
      stack: this._stack.map((frame) => this.cloneFrame(frame)),
      concurrent: this._concurrent.map((frame) => this.cloneFrame(frame)),
      queued: this._queued.map((steps) => steps.slice()),
      concurrentPlaybackIds: [...this._concurrentPlaybackIds],
      playbackRefs: Object.fromEntries(this._playbackRefs),
      stopped: this._stopped
    };
  }

  /**
   * Restore runtime state previously produced by {@link serialize}.
   *
   * Re-create the relevant active playbacks on the AnimationSet before calling this so that
   * playback-bound frames (play-wait, waitMarker, waitFrame) can re-attach by id.
   *
   * @param animationSet - Animation set containing any live playbacks referenced by the state.
   * @param timeline - Timeline definition to bind to the restored runner.
   * @param state - Serialized state previously returned by {@link serialize}.
   * @returns A runner restored to the supplied runtime state.
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
    Object.entries(state.playbackRefs ?? {}).forEach(([ref, id]) => runner._playbackRefs.set(ref, id));
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
    runner._playbackRefs.forEach((id) => {
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
        const playback = this.animationSet.play(step.clip, this.resolvePlayOptions(step.options, scope));
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
          this._playbackRefs.set(step.id, playback.id);
        }
        scope.refs[playback.id] = playback.id;
        this._playbackRefs.set(playback.id, playback.id);
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

  private resolvePlayOptions(options: PlayAnimationOptions | undefined, scope: FrameScope) {
    const target = options?.sync?.target;
    if (!target) {
      return options;
    }
    const mapped = this.resolvePlaybackRef(target, scope);
    if (!mapped) {
      return options;
    }
    return {
      ...options,
      sync: {
        ...options.sync,
        target: mapped
      }
    };
  }

  private resolvePlaybackRef(target: string, scope: FrameScope): string | null {
    return scope.refs[target] ?? this._playbackRefs.get(target) ?? null;
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
    playback.on('complete', this.onPlaybackComplete);
  }

  private detachPlayback(playback: AnimationPlayback) {
    playback.off('marker', this.onPlaybackMarker);
    playback.off('frame', this.onPlaybackFrame);
    playback.off('stop', this.onPlaybackEnd);
    playback.off('complete', this.onPlaybackComplete);
  }

  private forgetPlayback(playback: AnimationPlayback) {
    this.detachPlayback(playback);
    this._ownedPlaybacks.delete(playback.id);
    this._concurrentPlaybackIds.delete(playback.id);
    this.forgetPlaybackRefs(playback.id);
  }

  /**
   * Cleanup when an owned playback ends (externally or naturally). Only touches runner-local
   * bookkeeping, so it is safe to run inside `AnimationSet.update`'s playback loop. Frames blocked
   * on this playback observe its absence on the next tick and unblock.
   */
  private readonly onPlaybackEnd = (event: { playback: AnimationPlayback }) => {
    const playback = this._ownedPlaybacks.get(event.playback.id);
    if (playback) {
      this.forgetPlayback(playback);
    }
  };

  private readonly onPlaybackComplete = (event: { playback: AnimationPlayback }) => {
    this._lastCompletedPlaybackId = event.playback.id;
    const playback = this._ownedPlaybacks.get(event.playback.id);
    if (playback) {
      this.forgetPlayback(playback);
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
    const mapped = this.resolvePlaybackRef(target, scope);
    if (mapped) {
      const owned = this._ownedPlaybacks.get(mapped);
      if (owned) {
        return owned;
      }
    }
    return this._ownedPlaybacks.get(target) ?? this.animationSet.getPlayback(target);
  }

  private forgetPlaybackRefs(playbackId: string) {
    [...this._playbackRefs.entries()].forEach(([ref, id]) => {
      if (id === playbackId) {
        this._playbackRefs.delete(ref);
      }
    });
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
      this.forgetPlaybackRefs(id);
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
