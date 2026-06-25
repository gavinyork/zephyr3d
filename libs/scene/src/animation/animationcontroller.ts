import { Observable } from '@zephyr3d/base';
import type { AnimationSet, StopAnimationOptions } from './animationset';
import type { AnimationTimelineRunner } from './animationtimeline';
import {
  AnimationTimeline,
  type AnimationTimelineDefinition,
  type AnimationTimelineEventResult,
  type AnimationTimelineEventResponse
} from './animationtimeline';

/** @public */
export type AnimationControllerStateDefinition = {
  timeline: AnimationTimelineDefinition;
  responses?: AnimationTimelineEventResponse[];
};

/** @public */
export type AnimationControllerEventMap = {
  statechange: [state: string, previousState: string | null];
  event: [event: string, payload: unknown, result: AnimationTimelineEventResult];
};

/**
 * Event-driven animation state controller.
 *
 * Each state owns one serializable timeline. External gameplay events are
 * dispatched to the current timeline first, then to the current state's response
 * table. This makes different states free to respond to the same event in
 * different ways.
 * @public
 */
export class AnimationController extends Observable<AnimationControllerEventMap> {
  readonly animationSet: AnimationSet;
  private readonly _states: Map<string, AnimationControllerStateDefinition>;
  private _currentState: string | null;
  private _runner: AnimationTimelineRunner | null;

  constructor(animationSet: AnimationSet) {
    super();
    this.animationSet = animationSet;
    this._states = new Map();
    this._currentState = null;
    this._runner = null;
  }

  get currentState() {
    return this._currentState;
  }

  get runner() {
    return this._runner;
  }

  addState(name: string, definition: AnimationControllerStateDefinition) {
    this._states.set(name, definition);
    return this;
  }

  setState(name: string, options?: StopAnimationOptions) {
    const definition = this._states.get(name);
    if (!definition) {
      console.error(`AnimationController state ${name} not exists`);
      return null;
    }
    const previousState = this._currentState;
    this._runner?.stop(options ?? { reason: 'interrupted' });
    const timeline = new AnimationTimeline(definition.timeline);
    this._runner = timeline.createRunner(this.animationSet).start();
    this._currentState = name;
    this.dispatchEvent('statechange', name, previousState);
    return this._runner;
  }

  dispatch(event: string, payload?: unknown): AnimationTimelineEventResult {
    if (!this._currentState || !this._runner) {
      const result: AnimationTimelineEventResult = { handled: false, policy: 'none', event, payload };
      this.dispatchEvent('event', event, payload, result);
      return result;
    }
    const timelineResult = this._runner.dispatch(event, payload);
    if (timelineResult.handled) {
      this.dispatchEvent('event', event, payload, timelineResult);
      return timelineResult;
    }
    const response = this._states.get(this._currentState)?.responses?.find((item) => item.event === event);
    if (!response || response.policy === 'ignore') {
      const result: AnimationTimelineEventResult = {
        handled: false,
        policy: response?.policy ?? 'none',
        event,
        payload
      };
      this.dispatchEvent('event', event, payload, result);
      return result;
    }
    if (response.policy === 'transition' || response.policy === 'interrupt') {
      if (!response.targetState && !response.steps?.length) {
        const result: AnimationTimelineEventResult = {
          handled: false,
          policy: response.policy,
          event,
          payload
        };
        this.dispatchEvent('event', event, payload, result);
        return result;
      }
    }
    if ((response.policy === 'transition' || response.policy === 'interrupt') && response.targetState) {
      const stopOptions =
        typeof response.stopActive === 'object' ? response.stopActive : { reason: 'interrupted' as const };
      this.setState(response.targetState, stopOptions);
      const result: AnimationTimelineEventResult = { handled: true, policy: response.policy, event, payload };
      this.dispatchEvent('event', event, payload, result);
      return result;
    }
    if ((response.policy === 'branch' || response.policy === 'interrupt') && response.steps?.length) {
      if (response.policy === 'interrupt' || response.stopActive !== false) {
        const stopOptions =
          typeof response.stopActive === 'object' ? response.stopActive : { reason: 'interrupted' as const };
        this._runner.stop(stopOptions);
      }
      this._runner = new AnimationTimeline(response.steps).createRunner(this.animationSet).start();
      const result: AnimationTimelineEventResult = { handled: true, policy: response.policy, event, payload };
      this.dispatchEvent('event', event, payload, result);
      return result;
    }
    if (response.policy === 'queue') {
      if (response.steps?.length) {
        this._runner.enqueue(response.steps);
        const result: AnimationTimelineEventResult = { handled: true, policy: 'queue', event, payload };
        this.dispatchEvent('event', event, payload, result);
        return result;
      }
      const result: AnimationTimelineEventResult = { handled: false, policy: 'queue', event, payload };
      this.dispatchEvent('event', event, payload, result);
      return result;
    }
    const result: AnimationTimelineEventResult = { handled: false, policy: response.policy, event, payload };
    this.dispatchEvent('event', event, payload, result);
    return result;
  }

  stop(options?: StopAnimationOptions) {
    this._runner?.stop(options);
    this._runner = null;
    this._currentState = null;
  }
}
