import { Observable } from '@zephyr3d/base';
import type {
  AnimationPlayback,
  AnimationPlaybackStopEvent,
  AnimationSet,
  PlayAnimationOptions,
  StopAnimationOptions
} from './animationset';

/** @public */
export type AnimationTimelineEventPolicy =
  | 'ignore'
  | 'consume'
  | 'interrupt'
  | 'transition'
  | 'branch'
  | 'queue';

/** @public */
export type AnimationTimelineEventResult = {
  handled: boolean;
  policy: AnimationTimelineEventPolicy | 'none';
  event: string;
  payload?: unknown;
};

/** @public */
export type AnimationTimelineEventResponse = {
  event: string;
  policy: AnimationTimelineEventPolicy;
  steps?: AnimationTimelineStep[];
  targetState?: string;
  stopActive?: boolean | StopAnimationOptions;
};

/** @public */
export type AnimationTimelineStep =
  | {
      type: 'play';
      clip: string;
      id?: string;
      options?: PlayAnimationOptions;
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

type TimelineRuntimeContext = {
  animationSet: AnimationSet;
  refs: Map<string, AnimationPlayback>;
  getCurrentPlayback(): AnimationPlayback | null;
  setCurrentPlayback(playback: AnimationPlayback | null): void;
  emit(event: string, payload: unknown): void;
  waitForEvent(event: string): Promise<unknown>;
  isStopped(): boolean;
};

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
 * @public
 */
export class AnimationTimelineRunner extends Observable<AnimationTimelineRunnerEventMap> {
  readonly animationSet: AnimationSet;
  readonly timeline: AnimationTimeline;
  readonly refs: Map<string, AnimationPlayback>;
  private _currentPlayback: AnimationPlayback | null;
  private _stopped: boolean;
  private _runToken: number;
  private readonly _eventWaiters: Map<string, ((payload: unknown) => void)[]>;
  private readonly _queuedSteps: AnimationTimelineStep[][];

  constructor(animationSet: AnimationSet, timeline: AnimationTimeline) {
    super();
    this.animationSet = animationSet;
    this.timeline = timeline;
    this.refs = new Map();
    this._currentPlayback = null;
    this._stopped = true;
    this._runToken = 0;
    this._eventWaiters = new Map();
    this._queuedSteps = [];
  }

  get currentPlayback() {
    return this._currentPlayback;
  }

  get stopped() {
    return this._stopped;
  }

  start() {
    this._stopped = false;
    const token = ++this._runToken;
    void this.runUntilDrained(this.timeline.steps, token);
    return this;
  }

  stop(options?: StopAnimationOptions) {
    if (this._stopped) {
      return this;
    }
    this._stopped = true;
    this._runToken++;
    this.clearWaiters();
    this._queuedSteps.length = 0;
    this.refs.forEach((playback) => playback.stop(options ?? { reason: 'interrupted' }));
    this.refs.clear();
    this._currentPlayback = null;
    this.dispatchEvent('stop', this);
    return this;
  }

  enqueue(steps: AnimationTimelineStep[]) {
    if (steps.length > 0) {
      this._queuedSteps.push(steps);
    }
  }

  dispatch(event: string, payload?: unknown): AnimationTimelineEventResult {
    const waiters = this._eventWaiters.get(event);
    if (waiters?.length) {
      this._eventWaiters.delete(event);
      waiters.forEach((resolve) => resolve(payload));
      return { handled: true, policy: 'consume', event, payload };
    }
    const response = this.timeline.responses.find((item) => item.event === event);
    if (!response || response.policy === 'ignore') {
      return { handled: false, policy: response?.policy ?? 'none', event, payload };
    }
    if (response.policy === 'consume') {
      return { handled: true, policy: 'consume', event, payload };
    }
    if (response.policy === 'queue') {
      if (response.steps?.length) {
        this.enqueue(response.steps);
        return { handled: true, policy: 'queue', event, payload };
      }
      return { handled: false, policy: 'queue', event, payload };
    }
    if (response.policy === 'branch' || response.policy === 'interrupt') {
      if (!response.steps?.length) {
        return { handled: false, policy: response.policy, event, payload };
      }
      if (response.policy === 'interrupt' || response.stopActive !== false) {
        const stopOptions =
          typeof response.stopActive === 'object'
            ? response.stopActive
            : ({ reason: 'interrupted' } as const);
        this.stop(stopOptions);
      }
      this._stopped = false;
      const token = ++this._runToken;
      void this.runUntilDrained(response.steps, token);
      return { handled: true, policy: response.policy, event, payload };
    }
    return { handled: true, policy: response.policy, event, payload };
  }

  private getContext(): TimelineRuntimeContext {
    return {
      animationSet: this.animationSet,
      refs: this.refs,
      getCurrentPlayback: () => this._currentPlayback,
      setCurrentPlayback: (playback) => {
        this._currentPlayback = playback;
      },
      emit: (event, payload) => this.dispatchEvent('emit', event, payload),
      waitForEvent: (event) =>
        new Promise<unknown>((resolve) => {
          const waiters = this._eventWaiters.get(event) ?? [];
          waiters.push(resolve);
          this._eventWaiters.set(event, waiters);
        }),
      isStopped: () => this._stopped
    };
  }

  private async runSteps(steps: AnimationTimelineStep[], token: number) {
    const ctx = this.getContext();
    for (const step of steps) {
      if (this._stopped || token !== this._runToken) {
        return;
      }
      await this.runStep(step, ctx);
    }
  }

  private async runUntilDrained(steps: AnimationTimelineStep[], token: number) {
    await this.runSteps(steps, token);
    while (!this._stopped && token === this._runToken) {
      const queued = this._queuedSteps.shift();
      if (!queued) {
        break;
      }
      await this.runSteps(queued, token);
    }
    if (!this._stopped && token === this._runToken) {
      this._stopped = true;
      this.dispatchEvent('complete', this);
    }
  }

  private clearWaiters() {
    this._eventWaiters.forEach((list) => list.forEach((resolve) => resolve(undefined)));
    this._eventWaiters.clear();
  }

  private async runStep(step: AnimationTimelineStep, ctx: TimelineRuntimeContext): Promise<void> {
    if (ctx.isStopped()) {
      return;
    }
    switch (step.type) {
      case 'sequence':
        await this.runSteps(step.steps, this._runToken);
        return;
      case 'parallel':
        await Promise.all(step.steps.map((child) => this.runStep(child, ctx)));
        return;
      case 'play': {
        const playback = ctx.animationSet.play(step.clip, step.options);
        if (!playback) {
          return;
        }
        ctx.setCurrentPlayback(playback);
        if (step.id) {
          ctx.refs.set(step.id, playback);
        }
        ctx.refs.set(playback.id, playback);
        if (step.wait !== false) {
          await new Promise<void>((resolve) => {
            let settled = false;
            const done = () => {
              if (settled) {
                return;
              }
              settled = true;
              playback.off('complete', done);
              playback.off('stop', stop);
              resolve();
            };
            const stop = (_event: AnimationPlaybackStopEvent) => {
              if (settled) {
                return;
              }
              settled = true;
              playback.off('complete', done);
              playback.off('stop', stop);
              resolve();
            };
            playback.on('complete', done);
            playback.on('stop', stop);
          });
        }
        return;
      }
      case 'stop': {
        const playback = this.resolvePlayback(step.target);
        if (playback) {
          playback.stop(step.options);
        } else if (!step.target) {
          ctx.refs.forEach((item) => item.stop(step.options));
        }
        return;
      }
      case 'wait':
        await this.delay(step.seconds);
        return;
      case 'waitEvent':
        await ctx.waitForEvent(step.event);
        return;
      case 'waitMarker': {
        const playback = this.resolvePlayback(step.target) ?? ctx.getCurrentPlayback();
        if (playback) {
          await playback.waitForMarker(step.marker);
        }
        return;
      }
      case 'waitFrame': {
        const playback = this.resolvePlayback(step.target) ?? ctx.getCurrentPlayback();
        if (playback) {
          await playback.waitForFrame(step.frame);
        }
        return;
      }
      case 'emit':
        ctx.emit(step.event, step.payload);
        return;
    }
  }

  private resolvePlayback(target?: string) {
    if (!target) {
      return null;
    }
    return this.refs.get(target) ?? this.animationSet.getPlayback(target);
  }

  private delay(seconds: number) {
    return new Promise<void>((resolve) => {
      if (seconds <= 0) {
        resolve();
        return;
      }
      setTimeout(resolve, seconds * 1000);
    });
  }
}
