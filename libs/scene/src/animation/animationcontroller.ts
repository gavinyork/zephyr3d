import { Observable } from '@zephyr3d/base';
import type { AnimationSet, StopAnimationOptions } from './animationset';
import type {
  AnimationTimelineEventResponse,
  AnimationTimelineEventResult,
  AnimationTimelineRunner,
  AnimationTimelineStateReturnTarget,
  AnimationTimelineStep
} from './animationtimeline';
import { AnimationTimeline, type AnimationTimelineDefinition } from './animationtimeline';

type AnimationControllerReturnTarget = {
  state: string;
  transition?: number;
};

/**
 * Definition of a named animation controller state.
 * @public
 */
export type AnimationControllerStateDefinition = {
  /**
   * Timeline executed when the controller enters this state.
   */
  timeline: AnimationTimelineDefinition;
  /**
   * Optional state-local responses evaluated after the active timeline does not handle a
   * dispatched event.
   */
  responses?: AnimationTimelineEventResponse[];
  /**
   * Default cross-fade duration (seconds) applied when transitioning *into* this state.
   * The outgoing state fades out and this state's first `play` step fades in over this time.
   */
  transition?: number;
};

/**
 * Options used when switching the controller to another state.
 * @public
 */
export type AnimationControllerSetStateOptions = {
  /** Cross-fade duration (seconds). Overrides the target state's own `transition`. */
  transition?: number;
  /** Re-enter the state even if it is already current. Defaults to false (no-op on same state). */
  force?: boolean;
  /** Stop options for the outgoing state when no cross-fade is used. */
  stop?: StopAnimationOptions;
  /**
   * Optional state to enter when the target state completes.
   *
   * Use `true` to return to the state active before this transition, or a string to return to a
   * specific named state.
   */
  returnTo?: AnimationTimelineStateReturnTarget;
  /**
   * Optional transition duration used when returning from the target state.
   *
   * If omitted, the return state's own transition setting is used.
   */
  returnTransition?: number;
};

/**
 * Event map emitted by {@link AnimationController}.
 * @public
 */
export type AnimationControllerEventMap = {
  /**
   * Emitted after the current state changes.
   *
   * The first argument is the new state name, or null when stopped. The second argument is the
   * previous state name, or null when there was no previous state.
   */
  statechange: [state: string | null, previousState: string | null];
  /**
   * Emitted when the active state's timeline runner drains all main, concurrent, and queued work.
   */
  statecomplete: [state: string];
  /** Forwarded from the active state's timeline runner, so listeners need not rebind per state. */
  emit: [event: string, payload: unknown];
  /**
   * Emitted for every call to {@link AnimationController.dispatch} with the resolved event result.
   */
  event: [event: string, payload: unknown, result: AnimationTimelineEventResult];
};

/**
 * Event-driven animation state controller.
 *
 * Each state owns one serializable timeline. External gameplay events are dispatched to the
 * current timeline first, then to the current state's response table, so different states can
 * respond to the same event differently.
 * @public
 */
export class AnimationController extends Observable<AnimationControllerEventMap> {
  /**
   * Animation set used to create playbacks for all state timelines.
   */
  readonly animationSet: AnimationSet;
  private readonly _states: Map<string, AnimationControllerStateDefinition>;
  private _currentState: string | null;
  private _runner: AnimationTimelineRunner | null;
  private _onRunnerComplete: (() => void) | null;
  private _onRunnerEmit: ((event: string, payload: unknown) => void) | null;

  /**
   * Create a controller for an animation set.
   *
   * @param animationSet - Animation set that owns the clips and active playbacks.
   */
  constructor(animationSet: AnimationSet) {
    super();
    this.animationSet = animationSet;
    this._states = new Map();
    this._currentState = null;
    this._runner = null;
    this._onRunnerComplete = null;
    this._onRunnerEmit = null;
  }

  /**
   * Current state name.
   *
   * @returns The active state name, or null when the controller is stopped or has not entered a state.
   */
  get currentState() {
    return this._currentState;
  }

  /**
   * Current timeline runner.
   *
   * @returns The active timeline runner, or null when no state is running.
   */
  get runner() {
    return this._runner;
  }

  /**
   * Register or replace a named state definition.
   *
   * @param name - Unique state name.
   * @param definition - Timeline and event response configuration for the state.
   * @returns This controller for chaining.
   */
  addState(name: string, definition: AnimationControllerStateDefinition) {
    if (this._states.has(name)) {
      console.warn(`AnimationController state ${name} already exists; overwriting`);
    }
    this._states.set(name, definition);
    return this;
  }

  /**
   * Test whether a state has been registered.
   *
   * @param name - State name to look up.
   * @returns True if the controller contains a state with the given name; otherwise false.
   */
  hasState(name: string) {
    return this._states.has(name);
  }

  /**
   * Enter a registered state.
   *
   * If the requested state is already current and `options.force` is not set, this returns the
   * existing runner without restarting the timeline. When a transition duration is provided, the
   * previous runner fades out while the entry plays of the new state fade in.
   *
   * @param name - State name to enter.
   * @param options - Optional transition, re-entry, and stop behavior.
   * @returns The active runner for the entered state, or null if the state does not exist.
   */
  setState(name: string, options?: AnimationControllerSetStateOptions) {
    const definition = this._states.get(name);
    if (!definition) {
      console.error(`AnimationController state ${name} not exists`);
      return null;
    }
    if (!options?.force && this._currentState === name) {
      return this._runner;
    }
    const previousState = this._currentState;
    const transition = Math.max(options?.transition ?? definition.transition ?? 0, 0);
    const returnTarget = this.resolveReturnTarget(
      options?.returnTo,
      previousState,
      options?.returnTransition
    );
    this.detachRunner();
    if (transition > 0) {
      this._runner?.stop({ fadeOut: transition, reason: 'interrupted' });
    } else {
      this._runner?.stop(options?.stop ?? { reason: 'interrupted' });
    }
    const timeline = new AnimationTimeline(
      transition > 0 ? withFadeIn(definition.timeline, transition) : definition.timeline
    );
    this._runner = timeline.createRunner(this.animationSet);
    const runner = this._runner;
    this.attachRunner(runner, name, returnTarget);
    // Enter the new state *before* starting the runner: start() flushes synchronously, so any
    // initial `emit`/`statecomplete` must observe the controller already in `name`. Otherwise a
    // listener calling dispatch() would route against the previous state.
    this._currentState = name;
    this.dispatchEvent('statechange', name, previousState);
    // The statechange listener may have re-entered (stop() or another setState()), swapping out or
    // clearing `_runner`. Only start the runner we created if it is still the active one.
    if (this._runner === runner && this._currentState === name) {
      runner.start();
    }
    // If a reentrant listener superseded us, `_runner` is the now-active runner (or null after a
    // reentrant stop()); return that rather than a runner we never started.
    return this._runner;
  }

  /**
   * Dispatch a gameplay event to the active state.
   *
   * The active timeline receives the event first. If it does not handle the event, the current
   * state's response table may consume it, enqueue or run steps, or transition to another state.
   *
   * @param event - Event name to dispatch.
   * @param payload - Optional event payload passed through result notifications.
   * @returns The resolved handling result for the event.
   */
  dispatch(event: string, payload?: unknown): AnimationTimelineEventResult {
    if (!this._currentState || !this._runner) {
      return this.emitResult({ handled: false, policy: 'none', event, payload });
    }
    const timelineResult = this._runner.dispatch(event, payload);
    if (timelineResult.handled) {
      return this.emitResult(timelineResult);
    }
    const response = this._states.get(this._currentState)?.responses?.find((item) => item.event === event);
    if (!response || response.target.ignore) {
      return this.emitResult({ handled: false, policy: response ? 'ignore' : 'none', event, payload });
    }
    if (response.target.consume) {
      return this.emitResult({ handled: true, policy: 'consume', event, payload });
    }
    if (response.target.targetState !== undefined) {
      const transition = typeof response.onActive === 'object' ? response.onActive.fadeOut : undefined;
      const runner = this.setState(response.target.targetState, {
        transition,
        returnTo: response.target.returnTo,
        returnTransition: response.target.returnTransition
      });
      // setState returns null when the target state is not registered: a config error must not be
      // reported as a successfully handled transition.
      if (!runner) {
        return this.emitResult({ handled: false, policy: 'transition', event, payload });
      }
      return this.emitResult({ handled: true, policy: 'transition', event, payload });
    }
    const steps = response.target.steps;
    if (!steps?.length) {
      return this.emitResult({ handled: false, policy: 'none', event, payload });
    }
    if (response.enqueue) {
      this._runner.enqueue(steps);
      return this.emitResult({ handled: true, policy: 'enqueue', event, payload });
    }
    const disposition = response.onActive ?? 'stop';
    if (disposition === 'keep') {
      this._runner.runConcurrent(steps);
    } else {
      const stopOptions =
        typeof disposition === 'object' ? { ...disposition, reason: 'interrupted' as const } : undefined;
      this.detachRunner();
      this._runner.stop(stopOptions);
      this._runner = new AnimationTimeline(steps).createRunner(this.animationSet);
      this.attachRunner(this._runner, this._currentState);
      this._runner.start();
    }
    return this.emitResult({ handled: true, policy: 'steps', event, payload });
  }

  /**
   * Stop the active state and clear the current state.
   *
   * @param options - Optional stop behavior applied to playbacks owned by the active runner.
   * @returns void
   */
  stop(options?: StopAnimationOptions) {
    const previousState = this._currentState;
    this.detachRunner();
    this._runner?.stop(options);
    this._runner = null;
    this._currentState = null;
    if (previousState !== null) {
      this.dispatchEvent('statechange', null, previousState);
    }
  }

  /**
   * Stop playback and remove all registered states.
   *
   * @returns void
   */
  dispose() {
    this.stop();
    this._states.clear();
  }

  private emitResult(result: AnimationTimelineEventResult): AnimationTimelineEventResult {
    this.dispatchEvent('event', result.event, result.payload, result);
    return result;
  }

  private resolveReturnTarget(
    returnTo: AnimationTimelineStateReturnTarget | undefined,
    previousState: string | null,
    returnTransition: number | undefined
  ): AnimationControllerReturnTarget | null {
    if (returnTo === undefined) {
      return null;
    }
    const state = returnTo === true ? previousState : returnTo;
    if (!state) {
      return null;
    }
    if (!this._states.has(state)) {
      console.error(`AnimationController return state ${state} not exists`);
      return null;
    }
    return { state, transition: returnTransition };
  }

  private attachRunner(
    runner: AnimationTimelineRunner,
    state: string,
    returnTarget?: AnimationControllerReturnTarget | null
  ) {
    this._onRunnerComplete = () => {
      this.dispatchEvent('statecomplete', state);
      if (returnTarget && this._runner === runner && this._currentState === state) {
        this.setState(returnTarget.state, { transition: returnTarget.transition });
      }
    };
    this._onRunnerEmit = (event, payload) => {
      this.dispatchEvent('emit', event, payload);
    };
    runner.on('complete', this._onRunnerComplete);
    runner.on('emit', this._onRunnerEmit);
  }

  private detachRunner() {
    if (this._runner) {
      if (this._onRunnerComplete) {
        this._runner.off('complete', this._onRunnerComplete);
      }
      if (this._onRunnerEmit) {
        this._runner.off('emit', this._onRunnerEmit);
      }
    }
    this._onRunnerComplete = null;
    this._onRunnerEmit = null;
  }
}

/**
 * Return a copy of the timeline definition whose entry plays fade in over `duration`, so a state
 * transition cross-fades against the previous state's fade-out.
 *
 * "Entry plays" are every `play` that starts before the control flow first blocks: plays before a
 * `wait`/`waitEvent`/`waitMarker`/`waitFrame`, before a blocking `play` (`wait: 'complete'`), and
 * every branch of a leading `parallel` (all branches start simultaneously). This covers parallel
 * states whose branches would otherwise snap in at full weight while only the first faded.
 */
function withFadeIn(
  definition: AnimationTimelineDefinition | AnimationTimelineStep[],
  duration: number
): AnimationTimelineDefinition {
  const def: AnimationTimelineDefinition = Array.isArray(definition) ? { steps: definition } : definition;
  return { steps: injectEntryFadeIn(def.steps, duration).steps, responses: def.responses };
}

/**
 * Inject `fadeIn` into every entry play in `steps`. Returns the rewritten steps and whether the
 * flow blocks before reaching the end (so callers stop injecting into later, non-entry steps).
 */
function injectEntryFadeIn(
  steps: AnimationTimelineStep[],
  duration: number
): { steps: AnimationTimelineStep[]; blocked: boolean } {
  let blocked = false;
  const out = steps.map((step) => {
    if (blocked) {
      return step;
    }
    switch (step.type) {
      case 'play':
        if (step.wait === 'complete') {
          blocked = true;
        }
        return { ...step, options: { ...step.options, fadeIn: duration } };
      case 'sequence': {
        const result = injectEntryFadeIn(step.steps, duration);
        blocked = result.blocked;
        return { ...step, steps: result.steps };
      }
      case 'parallel': {
        // Every branch starts simultaneously, so inject into all of them. The parallel join only
        // blocks the steps that follow it if at least one branch blocks; if all branches are
        // non-blocking they drain in the same flush, so the following steps are still entry plays.
        let anyBranchBlocked = false;
        const branches = step.steps.map((branch) => {
          const result = injectEntryFadeIn([branch], duration);
          anyBranchBlocked = anyBranchBlocked || result.blocked;
          return result.steps[0];
        });
        blocked = anyBranchBlocked;
        return { ...step, steps: branches };
      }
      case 'wait':
      case 'waitEvent':
      case 'waitMarker':
      case 'waitFrame':
        blocked = true;
        return step;
      default:
        return step;
    }
  });
  return { steps: out, blocked };
}
