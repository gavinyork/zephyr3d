import { AnimationController, AnimationTimeline, Scene, SceneNode } from '@zephyr3d/scene';

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
  test('queued timeline batches are drained until empty', async () => {
    const scene = new Scene();
    const node = new SceneNode(scene);
    createClip(node, 'idle', 1);

    const timeline = new AnimationTimeline({
      steps: [{ type: 'waitEvent', event: 'go' }],
      responses: [
        {
          event: 'queue1',
          policy: 'queue',
          steps: [{ type: 'emit', event: 'first' }]
        },
        {
          event: 'queue2',
          policy: 'queue',
          steps: [{ type: 'emit', event: 'second' }]
        }
      ]
    });
    const runner = timeline.createRunner(node.animationSet);
    const emits: string[] = [];
    runner.on('emit', (event) => {
      emits.push(event);
    });
    const completed = new Promise<void>((resolve) => runner.once('complete', () => resolve()));

    runner.start();
    runner.dispatch('queue1');
    runner.dispatch('queue2');
    runner.dispatch('go');

    await completed;
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
        responses: [{ event: 'hit', policy: 'transition', targetState: 'fall' }]
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

  test('queue responses on the controller enqueue and run later', async () => {
    const scene = new Scene();
    const node = new SceneNode(scene);
    createClip(node, 'idle', 1);

    const controller = new AnimationController(node.animationSet);
    controller.addState('idle', {
      timeline: {
        steps: [{ type: 'waitEvent', event: 'go' }]
      },
      responses: [
        {
          event: 'queue',
          policy: 'queue',
          steps: [{ type: 'emit', event: 'queued' }]
        }
      ]
    });

    controller.setState('idle');
    const emits: string[] = [];
    controller.runner!.on('emit', (event) => {
      emits.push(event);
    });
    const completed = new Promise<void>((resolve) => controller.runner!.once('complete', () => resolve()));

    const result = controller.dispatch('queue');
    expect(result.handled).toBe(true);
    expect(result.policy).toBe('queue');

    controller.dispatch('go');

    await completed;
    expect(emits).toEqual(['queued']);
  });
});
