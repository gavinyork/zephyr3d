# AnimationController and Action Orchestration

`AnimationSet` handles low-level clip playback. `AnimationController` organizes those clips into input-driven action flows: idle, locomotion, attacks, interrupts, inserts, layered playback, cutscenes, and animation timing events.

This guide builds from simple to complex examples. Start with the first few sections to create a basic state machine, then add one-shot actions, marker events, parallel branches, layered animation, and phase synchronization.

---

## Three Concepts First

| Concept | Purpose |
|---------|---------|
| State | A named action mode such as `idle`, `run`, or `attack`. Entering a state runs its timeline. |
| Timeline | The state's step array: play clips, wait, emit events, and run sequential or parallel branches. |
| Response | How the current state reacts to an external event: transition, insert steps, enqueue, consume, or ignore. |

The controller does not replace `AnimationSet`, and it does not orchestrate across multiple animation sets. An `AnimationController` binds to one `AnimationSet` when constructed; every later state, response, `parallel` branch, and `play` step can only play clips from that set. In other words, it is meant to organize the action flow for one node. For a cutscene across separate camera and character nodes, create one controller per node and synchronize them from outer code by starting them together or waiting for completion events. Every playback is still created by the bound `AnimationSet`, so fade-in, fade-out, markers, frames, masks, weights, and phase synchronization all use the lower-level animation system.

```typescript
import { AnimationController } from '@zephyr3d/scene';

// Bind the controller to the model's AnimationSet; states play clips by name from this set.
const controller = new AnimationController(model.animationSet);
```

---

## 1. Play One Loop

The smallest useful state only needs one `play` step. `repeat: 0` means infinite looping. `addState()` only registers the state; call `setState()` to enter it.

```typescript
controller.addState('idle', {
  timeline: {
    steps: [
      {
        // Idle loops until the controller enters another state or stop() is called.
        type: 'play',
        clip: 'Idle',
        options: { repeat: 0 }
      }
    ]
  }
});

// Explicitly enter idle so the Idle clip starts playing.
controller.setState('idle');
```

Result: the character enters `idle` and keeps playing `Idle`. This is the foundation for idle, run, and other looping modes.

<div class="showcase" case="tut-56"></div>

---

## 2. Switch States With Events

States can define `responses`. When external code calls `controller.dispatch('move')`, the current state looks for a matching response and executes it.

```typescript
controller
  .addState('idle', {
    transition: 0.2,
    timeline: {
      steps: [
        {
          // Keep playing Idle while this state is active.
          type: 'play',
          clip: 'Idle',
          options: { repeat: 0 }
        }
      ]
    },
    responses: [
      {
        // Movement input enters run.
        event: 'move',
        target: { targetState: 'run' }
      }
    ]
  })
  .addState('run', {
    transition: 0.2,
    timeline: {
      steps: [
        {
          // Keep playing Run while this state is active.
          type: 'play',
          clip: 'Run',
          options: { repeat: 0 }
        }
      ]
    },
    responses: [
      {
        // Stopping movement returns to idle.
        event: 'stopMove',
        target: { targetState: 'idle' }
      }
    ]
  });

controller.setState('idle');

// Input or gameplay code drives the state machine with events.
controller.dispatch('move');
controller.dispatch('stopMove');
```

Result: `idle` and `run` transition between each other. `transition` is measured in seconds; entering the target state fades the old state out and fades the target state's entry playbacks in.

<div class="showcase" case="tut-57"></div>

---

## 3. Insert a One-Shot and Return

Attacks, rolls, doors, and similar actions usually play once, then return to the loop they interrupted. `returnTo: true` records the current state and returns to it after the target state's timeline completes.

```typescript
controller
  .addState('run', {
    transition: 0.2,
    timeline: {
      steps: [
        {
          // Run is the normal locomotion loop.
          type: 'play',
          clip: 'Run',
          options: { repeat: 0 }
        }
      ]
    },
    responses: [
      {
        // Attack completes, then automatically returns to run.
        event: 'attack',
        target: { targetState: 'attack', returnTo: true, returnTransition: 0.15 },
        // Fade Run out over 0.12 seconds while Attack fades in using the attack state's transition.
        onActive: { fadeOut: 0.12 }
      }
    ]
  })
  .addState('attack', {
    transition: 0.12,
    timeline: {
      steps: [
        {
          // repeat: 1 plays once.
          // wait: 'complete' keeps the attack state alive until Attack finishes.
          type: 'play',
          clip: 'Attack',
          options: { repeat: 1 },
          wait: 'complete'
        }
      ]
    }
  });
```

Result: while running, `attack` switches to the `attack` state. When `Attack` finishes naturally, the controller returns to `run`. `returnTransition` keeps the completed attack playback alive for a short completion fade-out while the return state fades in, avoiding a hard removal at the end pose.

<div class="showcase" case="tut-58"></div>

---

## 4. Serial, Overlapping, and Explicit Parallel Steps

`steps` run in order, but `play` is non-blocking by default. Two consecutive `play` steps start almost immediately, so their playbacks overlap.

```typescript
steps: [
  {
    // A starts and does not wait for completion.
    type: 'play',
    clip: 'A'
  },
  {
    // B starts in the same flush, so A and B overlap.
    type: 'play',
    clip: 'B'
  }
]
```

When `play` has `wait: 'complete'`, following steps wait until that playback completes or stops.

```typescript
steps: [
  {
    // B will not start until A completes.
    type: 'play',
    clip: 'A',
    options: { repeat: 1 },
    wait: 'complete'
  },
  {
    // This starts after A finishes.
    type: 'play',
    clip: 'B'
  }
]
```

Use `parallel` when you need to say "start these branches together and continue only after all branches finish." If a branch needs multiple steps, wrap it in `sequence`.

```typescript
import { Vector3 } from '@zephyr3d/base';
import { NodeEulerRotationTrack } from '@zephyr3d/scene';

// First register the node spin as a clip in the current AnimationSet.
const rotate = model.animationSet.createAnimation('rotate');
rotate.timeDuration = 2;
rotate.addTrack(
  model,
  new NodeEulerRotationTrack('linear', [
    { time: 0, value: new Vector3(0, 0, 0) },
    { time: 2, value: new Vector3(0, Math.PI * 2, 0) }
  ])
);

controller
  .addState('intro', {
    timeline: {
      steps: [
        {
          // Run both intro branches together and wait for both to finish.
          type: 'parallel',
          steps: [
            {
              // Branch 1: rotate the node 360 degrees around Y, then finish this branch.
              type: 'play',
              clip: 'rotate',
              options: { repeat: 1 },
              wait: 'complete'
            },
            {
              // Branch 2: wait 0.4 seconds, then play the wave action.
              type: 'sequence',
              steps: [
                { type: 'wait', seconds: 0.4 },
                { type: 'play', clip: 'wave', options: { repeat: 1 }, wait: 'complete' }
              ]
            }
          ]
        },
        { type: 'emit', event: 'intro-finished' }
      ]
    }
  })
  .addState('idle', {
    transition: 0.2,
    timeline: {
      steps: [
        {
          type: 'play',
          clip: 'idle',
          options: { repeat: 0 }
        }
      ]
    }
  });

controller.on('statecomplete', (state) => {
  if (state === 'intro') {
    controller.setState('idle');
  }
});

controller.setState('intro');

function resetIntro() {
  controller.setState('intro', { force: true });
}
```

Result: when `intro` starts, the node begins spinning with `rotate`; after 0.4 seconds, `wave` starts as well. After both branches finish, `intro-finished` is emitted and the `statecomplete` listener switches the controller to looping `idle`. A Reset button only needs to call `resetIntro()` to force the demo to start from `intro` again.

---

## 5. Emit Events Inside an Action

Hits, muzzle flashes, footsteps, sounds, and cancel windows usually happen inside an animation. Use markers to represent authored animation timing, then wait for them with `waitMarker`.

```typescript
// If the imported asset does not contain this marker, add one at 0.3 seconds.
// Runtime animation uses a continuous timeline; prefer time over frame when authored FPS is not stable.
controller.animationSet.getAnimationClip('attack')?.addMarker({
  id: 'hit',
  name: 'hit',
  time: 0.3
});
controller.animationSet.getAnimationClip('attack').addMarker({
  id: 'end',
  name: 'end',
  time: controller.animationSet.getAnimationClip('attack').timeDuration
});

controller.addState('idle', {
  transition: 0.2,
  timeline: {
    steps: [
      {
        type: 'play',
        clip: 'idle',
        options: { repeat: 0 }
      }
    ]
  },
  responses: [
    {
      event: 'attack',
      target: {
        steps: [
          {
            // Give the attack playback a local id so waitMarker can target it.
            type: 'play',
            clip: 'attack',
            id: 'attackPlayback',
            options: { repeat: 1, fadeIn: 0.08 },
            wait: false
          },
          {
            // Wait until this attack playback crosses the hit marker.
            type: 'waitMarker',
            marker: 'hit',
            target: 'attackPlayback'
          },
          {
            // Convert animation timing into a gameplay event.
            type: 'emit',
            event: 'attack-hit'
          },
          {
            // Wait until this attack playback to be finished
            type: 'waitMarker',
            marker: 'end',
            target: 'attackPlayback'
          },
          {
            // Restore idle playback
            type: 'play',
            clip: 'idle',
            options: { repeat: 0 }
          }
        ]
      },
      // Stop idle runner and switch to attack branch.
      onActive: 'keep'
    }
  ]
});
```

This minimal example only demonstrates "wait for marker, then emit." `tut-60` uses the same pattern and shows the overlay result in a runnable demo.

<div class="showcase" case="tut-60"></div>

---

## 6. Three Response Dispositions

`onActive` controls what happens to the current flow when a response fires.

| Value | Behavior | Common Use |
|-------|----------|------------|
| omitted or `'stop'` | Stop the active main flow, then run the response steps. | Normal interrupts and action changes. |
| `'keep'` | Keep the active flow and run response steps as a parallel branch. | Flinch overlays, upper-body shooting, footstep effects. |
| `{ fadeOut }` | Fade the active flow out over the given duration, then run the response. | State transitions and full-body inserts. |

```typescript
controller
  .addState('introWalk', {
    transition: 0.18,
    timeline: {
      steps: [
        {
          type: 'play',
          clip: 'walk',
          options: { repeat: 1 },
          wait: 'complete'
        }
      ]
    },
    responses: [
      {
        event: 'flinch',
        target: {
          steps: [
            {
              // Flinch plays once as an overlay and does not replace locomotion.
              type: 'play',
              clip: 'flinch',
              options: { repeat: 1, fadeIn: 0.05 },
              wait: 'complete'
            }
          ]
        },
        // Keep the current state and play Flinch concurrently.
        onActive: 'keep'
      },
      {
        event: 'queueAttack',
        target: {
          steps: [
            // Queue attack runs after the current main flow drains.
            { type: 'play', clip: 'attack', options: { repeat: 1 }, wait: 'complete' },
            { type: 'emit', event: 'queued-attack-finished' }
          ]
        },
        enqueue: true
      }
    ]
  });
```

Result: `flinch` is immediate and concurrent; `queueAttack` is queued. `tut-61` uses buttons to show the difference directly.

<div class="showcase" case="tut-61"></div>

---

## 7. Parallel Upper/Lower Body Loops

Layered animation often lets the lower body drive locomotion while the upper body aims, holds a weapon, or performs another action. Play two masked clips together and synchronize the upper body to the lower-body phase.

```typescript
controller.addState('layeredRun', {
  timeline: {
    steps: [
      {
        // Lower-body running is the phase reference.
        type: 'play',
        clip: 'run_lower',
        id: 'lowerLoop',
        options: { repeat: 0 }
      },
      {
        // Upper-body running starts at the same normalized phase as lowerLoop.
        type: 'play',
        clip: 'pistol_upper',
        id: 'upperLoop',
        options: {
          repeat: 0,
          sync: { target: 'lowerLoop', mode: 'normalized' }
        }
      }
    ]
  }
});
```

Result: `run_lower` and `pistol_upper` loop together. `sync.target` can refer to a local `id` created by a previous `play`. Use `mode: 'normalized'` when matching clips have different durations; use `mode: 'time'` when their authored timelines match in seconds.

<div class="showcase" case="tut-62"></div>

---

## 8. Insert a Half-Body Action While Layered

A common character pattern: keep the lower body running, temporarily replace the upper body with one shooting action, then restore upper-body running at the current lower-body phase.

```typescript
controller.addState('layeredRun', {
  timeline: {
    steps: [
      { 
        type: 'play',
        clip: 'run_lower',
        id: 'lowerLoop',
        options: { repeat: 0 }
      },
      {
        type: 'play',
        clip: 'pistol_upper',
        id: 'upperLoop',
        options: { repeat: 0, sync: { target: 'lowerLoop', mode: 'time' } }
      }
    ]
  },
  responses: [
    {
      event: 'shoot',
      target: {
        steps: [
          {
            // Stop only the upper-body loop; lowerLoop continues as the phase source.
            type: 'stop',
            target: 'upperLoop',
            options: { fadeOut: 0.08 }
          },
          {
            // Play the shooting action once. parallel lets us emit shoot-fire mid-action and still wait for completion.
            type: 'parallel',
            steps: [
              {
                type: 'play',
                clip: 'shoot_upper',
                id: 'shootUpper',
                options: { repeat: 1, fadeIn: 0.08 },
                wait: 'complete'
              },
              {
                type: 'sequence',
                steps: [
                  { type: 'wait', seconds: 0.35 },
                  { type: 'emit', event: 'shoot-fire' }
                ]
              }
            ]
          },
          {
            // Restore upper-body running and synchronize it to the lower-body phase.
            // Reuse upperLoop so later shoot events can stop this new upper-body loop.
            type: 'play',
            clip: 'run_upper',
            id: 'upperLoop',
            options: {
              repeat: 0,
              fadeIn: 0.12,
              sync: { target: 'lowerLoop', mode: 'time' }
            }
          }
        ]
      },
      // Keep the lower-body branch alive; the response replaces only the upper body.
      onActive: 'keep'
    }
  ]
});
```

Result: `shoot` does not restart or stop `run_lower`. It emits `shoot-fire` mid-action, then restores `pistol_upper` at the current `run_lower` phase. The easy detail to miss is `id: 'upperLoop'` on the restoring play step: without reusing that id, the next `shoot` cannot find the new upper-body loop with `target: 'upperLoop'`.

<div class="showcase" case="tut-63"></div>

---

## 9. Common Rules

| Scenario | Recommended Pattern |
|----------|---------------------|
| Loop a clip | `play` + `options: { repeat: 0 }` |
| Play a one-shot | `play` + `options: { repeat: 1 }` + `wait: 'complete'` |
| Wait for external input | `waitEvent` plus external `controller.dispatch(event)` |
| Stop a playback | `stop` + `target`, usually targeting a previous `play` id |
| Put several steps in one parallel branch | Wrap those steps in `sequence` |
| Fade into a state | Put `transition` on the state |
| Fade out the interrupted state | Put `onActive: { fadeOut }` on the response |
| Return after a one-shot state | `target: { targetState, returnTo: true }` |
| Cross-fade while returning | Add `returnTransition` |
| Overlay without replacing current flow | Use `onActive: 'keep'` |
| Run after the current flow drains | Use `enqueue: true` |
| Reference a playback later | Put `id` on `play`, then use `target` |
| Keep controlling a replacement by the same name | Reuse the same `id` on the new `play` |
| Restore upper/lower-body phase | `sync: { target: 'lowerRun', mode: 'normalized' }` |
| Trigger animation-internal timing | Prefer `addMarker({ time })` + `waitMarker` |

`waitFrame` converts frame numbers through `clip.frameRate` onto the continuous timeline. If your asset pipeline does not have a stable authored FPS, prefer marker `time`.

---

## Debug Events

These events help you understand what the action graph is doing:

```typescript
// Fires whenever setState() changes the active state or stop() clears it.
controller.on('statechange', (state, previousState) => {
  console.log('state changed', previousState, '->', state);
});

// Fires when the active state's main flow, concurrent branches, and queued work all finish.
controller.on('statecomplete', (state) => {
  console.log('state complete', state);
});

// Timeline emit steps are forwarded through the controller.
controller.on('emit', (event, payload) => {
  console.log('timeline emitted', event, payload);
});

// Fires after every dispatch(), including events that were ignored.
controller.on('event', (event, payload, result) => {
  console.log('dispatch result', event, result.policy, result.handled);
});
```

Looping states usually do not emit `statecomplete`, because `repeat: 0` playbacks do not finish naturally. One-shot states that use `wait: 'complete'` emit `statecomplete` after playback completion; if `returnTo` is configured, the automatic return happens after `statecomplete`.

