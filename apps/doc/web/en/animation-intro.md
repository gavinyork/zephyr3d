# Animation

> Code on this page is illustrative and omits imports and application setup. The topic pages
> have complete runnable examples.

All animation in Zephyr3D plays through a node's `AnimationSet`. It covers:

| Kind          | What it animates                                                                          | See                                                       |
| ------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Skeletal      | The bones of a skinned mesh, with masks for part of the skeleton and humanoid retargeting | [Skeletal Animation](en/animation-skeleton.md)            |
| Keyframe      | A node's position, rotation and scale, and properties such as materials                   | [Keyframe Animation](en/animation-keyframe.md)            |
| Morph target  | Vertex deformation (blend shapes), such as facial expressions                             | [Morph Target / BlendShape](en/animation-morph-target.md) |
| Custom tracks | Your own state calculation, application and blending                                      | [Custom Animation](en/animation-custom.md)                |

Procedural animation such as IK and JointDynamics is layered on top of the result; see [IK](en/animation-ik.md) and [JointDynamics](en/animation-joint-dynamics.md).

---

## Overview

| Class                 | Role                                                                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `AnimationSet`        | A node's animations: holds its clips, and plays, blends and updates them. Get it with `node.animationSet`.                            |
| `AnimationClip`       | One named animation, such as "run". Made of tracks, with a duration, a frame rate and markers.                                        |
| `AnimationTrack`      | How one property of one object changes over time.                                                                                     |
| `AnimationPlayback`   | The runtime handle of one playback: progress, pausing, seeking, fading, events.                                                       |
| `AnimationController` | Choreography: clips organised into states, timelines and responses to events. See [Animation Controller](en/animation-controller.md). |

The engine updates animations every frame; there is no `update()` to call.

---

## Playing and Stopping

`play()` starts a clip and returns its `AnimationPlayback`, or `null` if there is no clip of that name.

```javascript
const animSet = model.animationSet;
console.log(animSet.getAnimationNames());

const playback = animSet.play('walk', {
  repeat: 0, // 0 loops forever
  speedRatio: 1, // playback speed; negative plays backwards
  fadeIn: 0.3 // weight goes from 0 to its target over 0.3 s
});

// Stop by name, fading out over 0.2 s
animSet.stopAnimation('walk', { fadeOut: 0.2 });
```

`playAnimation()` does the same as `play()` but returns nothing; it is kept for existing code.

**A clip has one playback at a time.** Playing a clip that is already playing stops the old playback (reason `'replaced'`) and starts again from the beginning.

### Options

| Option                                     | Default           | Effect                                                                                                                                                                 |
| ------------------------------------------ | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `repeat`                                   | 0                 | Number of loops; 0 loops forever                                                                                                                                       |
| `speedRatio`                               | 1                 | Speed multiplier; negative plays backwards, starting from the end                                                                                                      |
| `fadeIn`                                   | 0                 | Fade-in time in seconds                                                                                                                                                |
| `completionFadeOut`                        | 0                 | Fade-out after finishing on its own: `complete` fires at the end, then the playback stays this long while fading out, so the next action can blend from the final pose |
| `weight`                                   | The clip's weight | Blend weight when several animations drive the same property; see [Animation Blending](en/animation-blending.md)                                                       |
| `range`                                    | Whole clip        | Play part of it: `{ start, end }`, in seconds, frames or markers (see below)                                                                                           |
| `sync`                                     | None              | Start at the phase of another playing animation (see below)                                                                                                            |
| `id`, `layer`, `priority`, `interruptible` |                   | Identity, layering and interruption rules for higher-level logic such as the animation controller                                                                      |

---

## The Playback

The handle `play()` returns stays usable for the whole playback:

```javascript
const playback = animSet.play('attack', { repeat: 1 });

playback.pause();
playback.resume();
playback.seek(0.5); // jump to 0.5 s
playback.normalizedTime = 0.5; // or halfway
playback.speedRatio = 0.5; // half speed
playback.fadeTo(0.3, 0.2); // weight down to 0.3 over 0.2 s

// Cross-fade to another clip over 0.3 s; returns the new clip's playback
const idle = playback.crossFadeTo('idle', { duration: 0.3, repeat: 0 });

// A playing clip's playback can be fetched at any time
animSet.getPlayback('idle');
```

| Property                          | Meaning                                                                                                              |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `state`                           | `'scheduled'` (created, not started), `'playing'`, `'paused'`, `'stopping'` (fading out), `'stopped'`, `'completed'` |
| `time` / `normalizedTime`         | Current time in seconds / as a fraction of the clip's duration; writing either seeks                                 |
| `weight`, `speedRatio`            | Current weight and speed, writable                                                                                   |
| `clip`, `id`, `layer`, `priority` | The clip being played and the identity given in the options                                                          |

By default `seek(time, { emitEvents, apply })` neither raises events for markers it jumps over nor applies the pose at once; pass `emitEvents: true` and `apply: true` for that.

---

## Events and Waiting

A playback raises events at key moments:

| Event              | When                                                                                               |
| ------------------ | -------------------------------------------------------------------------------------------------- |
| `start`            | It starts                                                                                          |
| `loop`             | One loop ends and the next begins                                                                  |
| `marker`           | It passes a marker                                                                                 |
| `frame`            | It passes a frame being waited for with `waitForFrame()`                                           |
| `complete`         | All loops are done                                                                                 |
| `stop`             | It stops, with a `reason`: `'manual'`, `'interrupted'`, `'completed'`, `'deleted'` or `'replaced'` |
| `pause` / `resume` | It is paused / resumed                                                                             |

```javascript
playback.on('marker', (ev) => console.log('marker', ev.marker.name, ev.time));
playback.on('stop', (ev) => console.log('stopped:', ev.reason));
```

Or wait with promises, to write the flow in order:

```javascript
const attack = animSet.play('attack', { repeat: 1 });
await attack.waitForMarker('hit'); // reached the hit marker
applyDamage();
await attack.waitForComplete(); // finished
animSet.play('idle');
```

`waitForComplete()` only resolves on `complete`: a playback that is stopped, interrupted or loops forever (`repeat: 0`) never resolves it. Listen for `stop` to handle those. `waitForMarker()` and `waitForFrame()` resolve with `undefined` when the playback stops.

To follow every animation of a node, subscribe on the `AnimationSet`, where the same events have a `playback` prefix: `playbackstart`, `playbackloop`, `playbackcomplete`, `playbackstop`, `playbackpause`, `playbackresume`, plus `marker` and `frame`.

---

## Markers and Time References

Markers are named points on a clip's timeline, for footsteps, hit detection and other game logic:

```javascript
const clip = animSet.getAnimationClip('attack');
clip.addMarker({ name: 'hit', time: 0.42 });
clip.addMarker({ name: 'footstep', frame: 12, payload: { foot: 'left' } }); // converted with the clip's frame rate
```

A playback `range`, and the animation controller wherever it takes a point in time, accept:

```javascript
animSet.play('attack', { range: { start: 0.2, end: { marker: 'hit' } } });
// 0.2               seconds
// { time: 0.2 }     seconds
// { frame: 6 }      a frame, converted with the clip's frameRate, or with fps if given
// { marker: 'hit' } where the marker is
```

Markers are runtime only for now: they are not saved with the scene and cannot be edited in the editor, so add them in code, for example after loading the model.

---

## Phase Synchronisation

When switching between actions such as walking and running, the new one should start at the same point of the stride, or the feet stumble. `sync` starts a playback at the phase of another playing animation:

```javascript
animSet.play('walk', { repeat: 0 });
// ...
// Start run at walk's current phase, then fade walk out
animSet.play('run', {
  repeat: 0,
  fadeIn: 0.3,
  sync: { target: 'walk' } // proportional by default: walk at 40% starts run at 40%
});
animSet.stopAnimation('walk', { fadeOut: 0.3 });
```

`target` is a playing clip's name or a playback's `id`. `mode: 'time'` aligns in seconds instead, `offset` adds a phase offset, and `wrap: false` clamps instead of wrapping when the phase falls outside the clip.

---

## Animation Controller

Chaining `play()` calls and events in code suits simple cases. When a character idles, moves, attacks and gets hit, with interruptions, one-off actions and upper and lower body playing separately, declare those rules as states with `AnimationController`:

```javascript
const controller = new AnimationController(model.animationSet);
controller.addState('idle', {
  timeline: { steps: [{ type: 'play', clip: 'Idle', options: { repeat: 0 } }] }
});
controller.setState('idle');
```

Timelines, responses to events, one-off actions, parallel and layered playback are covered in [Animation Controller](en/animation-controller.md).

---

## Creating Animations

Animations that come with an imported model are added to its `AnimationSet`. Clips can also be created in code:

```javascript
const clip = animSet.createAnimation('bob');
clip.addTrack(node, track); // a built-in or custom AnimationTrack
animSet.play('bob');

animSet.getAnimationClip('bob');
animSet.deleteAnimation('bob');
```

The built-in tracks (translation, rotation, scale, properties and more) and their interpolation are in [Keyframe Animation](en/animation-keyframe.md); writing your own is in [Custom Animation](en/animation-custom.md).

> The Zephyr3D editor is the recommended way to create and edit animations and tracks; see [Animation in the Editor](en/editor/animation-overview.md).
