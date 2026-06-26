import { AnimationController, AnimationTimeline, AnimationTimelineRunner, Scene, SceneNode } from '@zephyr3d/scene';

function createAnimationSet() {
  const scene = new Scene();
  const node = new SceneNode(scene);
  return node.animationSet;
}

function createClip(node: SceneNode, name: string, duration = 1) {
  const clip = node.animationSet.createAnimation(name);
  if (!clip) {
    throw new Error(`Failed to create clip ${name}`);
  }
  clip.timeDuration = duration;
  return clip;
}

describe('Animation playback events', () => {
  test('a waiting play step completes when the playback is stopped externally', async () => {
    const scene = new Scene();
    const node = new SceneNode(scene);
    createClip(node, 'attack', 1);

    const timeline = new AnimationTimeline({
      steps: [{ type: 'play', clip: 'attack', wait: 'complete' }]
    });
    const runner = timeline.createRunner(node.animationSet);
    const completed = new Promise<void>((resolve) => runner.once('complete', () => resolve()));

    runner.start();
    expect(runner.currentPlayback).not.toBeNull();

    node.animationSet.update(0);
    runner.currentPlayback?.stop({ reason: 'interrupted' });
    // The frame-stack runner advances on update(); one tick observes the external stop.
    node.animationSet.update(0);

    await completed;
    expect(runner.stopped).toBe(true);
  });

  test('play() returns a playback and dispatches start, marker, complete and stop', () => {
    const scene = new Scene();
    const node = new SceneNode(scene);
    const clip = createClip(node, 'attack', 1);
    clip.addMarker({ id: 'hit-id', name: 'hit', time: 0.5 });

    const events: string[] = [];
    const playback = node.animationSet.play('attack', { repeat: 1 });
    expect(playback).not.toBeNull();

    playback!.on('start', () => {
      events.push('start');
    });
    playback!.on('marker', (event) => {
      events.push(`marker:${event.marker.name}`);
    });
    playback!.on('complete', () => {
      events.push('complete');
    });
    playback!.on('stop', (event) => {
      events.push(`stop:${event.reason}`);
    });

    node.animationSet.update(0);
    node.animationSet.update(0.5);
    node.animationSet.update(0.6);

    expect(events).toEqual(['start', 'marker:hit', 'complete', 'stop:completed']);
    expect(playback!.state).toBe('completed');
    expect(node.animationSet.isPlayingAnimation('attack')).toBe(false);
  });

  test('waitForFrame resolves when the playback crosses the requested frame', async () => {
    const scene = new Scene();
    const node = new SceneNode(scene);
    const clip = createClip(node, 'move', 1);
    clip.frameRate = 10;

    const playback = node.animationSet.play('move', { repeat: 0 });
    const framePromise = playback!.waitForFrame(4);

    node.animationSet.update(0);
    node.animationSet.update(0.41);

    const event = await framePromise;
    expect(event.frame).toBe(4);
    expect(event.playback).toBe(playback);
  });

  test('pause, resume and seek control playback time', () => {
    const animationSet = createAnimationSet();
    const clip = animationSet.createAnimation('move');
    clip!.timeDuration = 1;

    const playback = animationSet.play('move', { repeat: 0 })!;
    animationSet.update(0);

    playback.pause();
    animationSet.update(0.5);
    expect(playback.time).toBe(0);

    playback.resume();
    animationSet.update(0.25);
    expect(playback.time).toBeCloseTo(0.25);

    playback.seek(0.75);
    expect(playback.time).toBeCloseTo(0.75);
  });

  test('marker and frame waiters resolve when playback stops', async () => {
    const scene = new Scene();
    const node = new SceneNode(scene);
    createClip(node, 'move', 1);

    const playback = node.animationSet.play('move', { repeat: 0 })!;
    node.animationSet.update(0);

    const markerPromise = playback.waitForMarker('hit');
    const framePromise = playback.waitForFrame(4);
    playback.stop({ reason: 'interrupted' });

    await expect(markerPromise).resolves.toBeUndefined();
    await expect(framePromise).resolves.toBeUndefined();
  });
});

describe('Animation timeline controller', () => {
  test('queued timeline batches are drained until empty', () => {
    const scene = new Scene();
    const node = new SceneNode(scene);
    createClip(node, 'idle', 1);

    const timeline = new AnimationTimeline({
      steps: [{ type: 'waitEvent', event: 'go' }],
      responses: [
        { event: 'queue1', target: { steps: [{ type: 'emit', event: 'first' }] }, enqueue: true },
        { event: 'queue2', target: { steps: [{ type: 'emit', event: 'second' }] }, enqueue: true }
      ]
    });
    const runner = timeline.createRunner(node.animationSet);
    const emits: string[] = [];
    runner.on('emit', (event) => {
      emits.push(event);
    });

    runner.start();
    runner.dispatch('queue1');
    runner.dispatch('queue2');
    runner.dispatch('go');

    expect(runner.stopped).toBe(true);
    expect(emits).toEqual(['first', 'second']);
  });

  test('current state can handle custom events differently by transitioning to another timeline', () => {
    const scene = new Scene();
    const node = new SceneNode(scene);
    createClip(node, 'attack', 1);
    createClip(node, 'fall', 1);

    const controller = new AnimationController(node.animationSet);
    controller
      .addState('attack', {
        timeline: {
          steps: [{ type: 'play', clip: 'attack', id: 'attack', options: { repeat: 0 }, wait: false }]
        },
        responses: [{ event: 'hit', target: { targetState: 'fall' } }]
      })
      .addState('fall', {
        timeline: {
          steps: [{ type: 'play', clip: 'fall', id: 'fall', options: { repeat: 0 }, wait: false }]
        }
      });

    controller.setState('attack');
    expect(node.animationSet.isPlayingAnimation('attack')).toBe(true);

    const payload = { power: 10 };
    const result = controller.dispatch('hit', payload);

    expect(result.handled).toBe(true);
    expect(result.policy).toBe('transition');
    expect(result.payload).toBe(payload);
    expect(controller.currentState).toBe('fall');
    expect(node.animationSet.isPlayingAnimation('attack')).toBe(false);
    expect(node.animationSet.isPlayingAnimation('fall')).toBe(true);
  });

  test('enqueue responses on the controller run after the current steps drain', () => {
    const scene = new Scene();
    const node = new SceneNode(scene);
    createClip(node, 'idle', 1);

    const controller = new AnimationController(node.animationSet);
    controller.addState('idle', {
      timeline: { steps: [{ type: 'waitEvent', event: 'go' }] },
      responses: [{ event: 'queue', target: { steps: [{ type: 'emit', event: 'queued' }] }, enqueue: true }]
    });

    controller.setState('idle');
    const emits: string[] = [];
    controller.runner!.on('emit', (event) => {
      emits.push(event);
    });

    const result = controller.dispatch('queue');
    expect(result.handled).toBe(true);
    expect(result.policy).toBe('enqueue');

    controller.dispatch('go');
    expect(emits).toEqual(['queued']);
  });

  test('a controller-level consume response marks the event handled', () => {
    const scene = new Scene();
    const node = new SceneNode(scene);
    createClip(node, 'idle', 1);

    const controller = new AnimationController(node.animationSet);
    controller.addState('idle', {
      timeline: { steps: [{ type: 'waitEvent', event: 'never' }] },
      responses: [{ event: 'swallow', target: { consume: true } }]
    });
    controller.setState('idle');

    const result = controller.dispatch('swallow');
    expect(result.handled).toBe(true);
    expect(result.policy).toBe('consume');
  });

  test('a timeline that cannot handle transition lets the controller state respond', () => {
    const scene = new Scene();
    const node = new SceneNode(scene);
    createClip(node, 'idle', 1);
    createClip(node, 'fall', 1);

    const controller = new AnimationController(node.animationSet);
    controller
      .addState('idle', {
        // The timeline declares a transition target, but a timeline runner cannot switch
        // controller states; it returns handled:false so the controller's table acts on it.
        timeline: {
          steps: [{ type: 'waitEvent', event: 'never' }],
          responses: [{ event: 'drop', target: { targetState: 'fall' } }]
        },
        responses: [{ event: 'drop', target: { targetState: 'fall' } }]
      })
      .addState('fall', {
        timeline: { steps: [{ type: 'play', clip: 'fall', options: { repeat: 0 } }] }
      });
    controller.setState('idle');

    const result = controller.dispatch('drop');
    expect(result.handled).toBe(true);
    expect(result.policy).toBe('transition');
    expect(controller.currentState).toBe('fall');
    expect(node.animationSet.isPlayingAnimation('fall')).toBe(true);
  });

  test('setState is a no-op on the same state unless forced', () => {
    const scene = new Scene();
    const node = new SceneNode(scene);
    createClip(node, 'idle', 1);

    const controller = new AnimationController(node.animationSet);
    controller.addState('idle', {
      timeline: { steps: [{ type: 'play', clip: 'idle', options: { repeat: 0 }, wait: false }] }
    });

    const first = controller.setState('idle');
    const same = controller.setState('idle');
    expect(same).toBe(first);

    const forced = controller.setState('idle', { force: true });
    expect(forced).not.toBe(first);
  });

  test('statecomplete fires when a state timeline drains', () => {
    const scene = new Scene();
    const node = new SceneNode(scene);
    createClip(node, 'idle', 1);

    const controller = new AnimationController(node.animationSet);
    controller.addState('idle', {
      timeline: { steps: [{ type: 'emit', event: 'done' }] }
    });

    const completed: string[] = [];
    controller.on('statecomplete', (state) => {
      completed.push(state);
    });
    controller.setState('idle');

    expect(completed).toEqual(['idle']);
  });

  test('dispose stops the active state and clears it', () => {
    const scene = new Scene();
    const node = new SceneNode(scene);
    createClip(node, 'idle', 1);

    const controller = new AnimationController(node.animationSet);
    controller.addState('idle', {
      timeline: { steps: [{ type: 'play', clip: 'idle', options: { repeat: 0 }, wait: false }] }
    });
    controller.setState('idle');
    expect(node.animationSet.isPlayingAnimation('idle')).toBe(true);

    controller.dispose();
    expect(controller.currentState).toBeNull();
    expect(node.animationSet.isPlayingAnimation('idle')).toBe(false);
    expect(controller.hasState('idle')).toBe(false);
  });
});

describe('Animation timeline runtime', () => {
  test('a play step without an explicit wait does not block the timeline', () => {
    const scene = new Scene();
    const node = new SceneNode(scene);
    createClip(node, 'walk', 1);

    // walk loops forever (repeat: 0). With the old default this would block the timeline
    // forever; the default is now non-blocking so `emit` runs immediately.
    const timeline = new AnimationTimeline({
      steps: [
        { type: 'play', clip: 'walk', options: { repeat: 0 } },
        { type: 'emit', event: 'after-play' }
      ]
    });
    const runner = timeline.createRunner(node.animationSet);
    const emits: string[] = [];
    runner.on('emit', (event) => {
      emits.push(event);
    });

    runner.start();

    expect(emits).toEqual(['after-play']);
    expect(runner.stopped).toBe(true);
    expect(node.animationSet.isPlayingAnimation('walk')).toBe(true);
  });

  test('a wait step is driven by the animation logical clock, not wall-clock time', () => {
    const scene = new Scene();
    const node = new SceneNode(scene);
    createClip(node, 'idle', 1);

    const timeline = new AnimationTimeline({
      steps: [
        { type: 'wait', seconds: 1 },
        { type: 'emit', event: 'elapsed' }
      ]
    });
    const runner = timeline.createRunner(node.animationSet);
    const emits: string[] = [];
    runner.on('emit', (event) => {
      emits.push(event);
    });

    runner.start();
    expect(emits).toEqual([]);

    node.animationSet.update(0.4);
    expect(emits).toEqual([]);

    node.animationSet.update(0.6);
    expect(emits).toEqual(['elapsed']);
  });

  test('enqueueing into a drained runner revives it and runs the steps', () => {
    const scene = new Scene();
    const node = new SceneNode(scene);
    createClip(node, 'idle', 1);

    // A timeline with no blocking steps drains immediately on start().
    const timeline = new AnimationTimeline({ steps: [{ type: 'emit', event: 'first' }] });
    const runner = timeline.createRunner(node.animationSet);
    const emits: string[] = [];
    runner.on('emit', (event) => {
      emits.push(event);
    });

    runner.start();
    expect(runner.stopped).toBe(true);
    expect(emits).toEqual(['first']);

    // Enqueueing after the drain must revive the runner rather than silently dropping the steps.
    runner.enqueue([{ type: 'emit', event: 'late' }]);
    expect(emits).toEqual(['first', 'late']);
  });

  test('parallel branches resolve their own current playback for waitMarker (no cross-talk)', () => {
    const scene = new Scene();
    const node = new SceneNode(scene);
    const upper = createClip(node, 'upper', 1);
    const lower = createClip(node, 'lower', 1);
    upper.addMarker({ id: 'u', name: 'u', time: 0.5 });
    lower.addMarker({ id: 'l', name: 'l', time: 0.5 });

    const timeline = new AnimationTimeline({
      steps: [
        {
          type: 'parallel',
          steps: [
            {
              type: 'sequence',
              steps: [
                { type: 'play', clip: 'upper', options: { repeat: 1 } },
                { type: 'waitMarker', marker: 'u' },
                { type: 'emit', event: 'upper-hit' }
              ]
            },
            {
              type: 'sequence',
              steps: [
                { type: 'play', clip: 'lower', options: { repeat: 1 } },
                { type: 'waitMarker', marker: 'l' },
                { type: 'emit', event: 'lower-hit' }
              ]
            }
          ]
        }
      ]
    });
    const runner = timeline.createRunner(node.animationSet);
    const emits: string[] = [];
    runner.on('emit', (event) => {
      emits.push(event);
    });

    runner.start();
    // Cross the 0.5 markers of both clips; each branch's waitMarker must resolve on its own clip.
    node.animationSet.update(0);
    node.animationSet.update(0.6);

    expect(emits.sort()).toEqual(['lower-hit', 'upper-hit']);
  });

  test('a keep-active branch runs concurrently with the existing timeline', () => {
    const scene = new Scene();
    const node = new SceneNode(scene);
    createClip(node, 'base', 1);
    createClip(node, 'overlay', 1);

    const timeline = new AnimationTimeline({
      steps: [
        { type: 'play', clip: 'base', options: { repeat: 0 } },
        { type: 'waitEvent', event: 'never' }
      ],
      responses: [
        {
          event: 'overlay',
          target: { steps: [{ type: 'play', clip: 'overlay', options: { repeat: 0 } }] },
          onActive: 'keep'
        }
      ]
    });
    const runner = timeline.createRunner(node.animationSet);

    runner.start();
    expect(node.animationSet.isPlayingAnimation('base')).toBe(true);

    runner.dispatch('overlay');
    // Both play simultaneously: the base timeline is still blocked on its waitEvent.
    expect(node.animationSet.isPlayingAnimation('base')).toBe(true);
    expect(node.animationSet.isPlayingAnimation('overlay')).toBe(true);
  });

  test('serialize/deserialize preserves a blocked wait and resumes deterministically', () => {
    const scene = new Scene();
    const node = new SceneNode(scene);
    createClip(node, 'idle', 1);

    const definition = {
      steps: [
        { type: 'wait' as const, seconds: 1 },
        { type: 'emit' as const, event: 'elapsed' }
      ]
    };
    const timeline = new AnimationTimeline(definition);
    const runner = timeline.createRunner(node.animationSet);
    runner.start();
    node.animationSet.update(0.4);

    const state = runner.serialize();
    runner.stop();

    // Restore into a fresh runner and continue ticking; the remaining 0.6s must still apply.
    const restored = AnimationTimelineRunner.deserialize(
      node.animationSet,
      new AnimationTimeline(definition),
      state
    );
    const emits: string[] = [];
    restored.on('emit', (event) => {
      emits.push(event);
    });

    node.animationSet.update(0.5);
    expect(emits).toEqual([]);
    node.animationSet.update(0.2);
    expect(emits).toEqual(['elapsed']);
  });
});

