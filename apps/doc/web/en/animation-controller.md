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

The controller does not replace `AnimationSet`. Every playback is still created by the same `AnimationSet`, so fade-in, fade-out, markers, frames, masks, weights, and phase synchronization all use the lower-level animation system.

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
controller.addState('intro', {
  timeline: {
    steps: [
      {
        // The camera branch and character branch run in parallel.
        type: 'parallel',
        steps: [
          {
            // The camera intro plays once and keeps its branch alive until completion.
            type: 'play',
            clip: 'CameraIntro',
            options: { repeat: 1 },
            wait: 'complete'
          },
          {
            // The character branch waits 0.4 seconds, then plays Wave once.
            type: 'sequence',
            steps: [
              { type: 'wait', seconds: 0.4 },
              { type: 'play', clip: 'Wave', options: { repeat: 1 }, wait: 'complete' }
            ]
          }
        ]
      },
      // Notify game code after both branches finish.
      { type: 'emit', event: 'intro-finished' }
    ]
  }
});
```

Result: `CameraIntro` and `Wave` are orchestrated in one cutscene state. `intro-finished` is emitted only after both branches finish.

---

## 5. Emit Events Inside an Action

Hits, muzzle flashes, footsteps, sounds, and cancel windows usually happen inside an animation. Use markers to represent authored animation timing, then wait for them with `waitMarker`.

```typescript
// If the imported asset does not contain this marker, add one at 0.3 seconds.
// Runtime animation uses a continuous timeline; prefer time over frame when authored FPS is not stable.
controller.animationSet.getAnimationClip('Attack')?.addMarker({
  id: 'hit',
  name: 'hit',
  time: 0.3
});

controller.addState('attackWithHit', {
  timeline: {
    steps: [
      {
        // Give the Attack playback a local id so waitMarker can target it.
        type: 'play',
        clip: 'Attack',
        id: 'attack',
        options: { repeat: 1 },
        // Do not block; the following waitMarker observes this playback.
        wait: false
      },
      {
        // Wait until this Attack playback crosses the hit marker.
        type: 'waitMarker',
        marker: 'hit',
        target: 'attack'
      },
      {
        // Convert animation timing into a gameplay event.
        type: 'emit',
        event: 'attack-hit'
      }
    ]
  }
});

controller.on('emit', (event) => {
  if (event === 'attack-hit') {
    spawnHitEffect();
  }
});
```

This minimal example only demonstrates "wait for marker, then emit." Its timeline ends after `attack-hit`. If the state must also wait for the full attack playback before restoring another state, use the `parallel` pattern below.

If the action must still wait for the full playback before restoring, use `parallel`: one branch owns the playback lifetime, and another branch emits a mid-action cue after 0.5 seconds or a marker.

```typescript
steps: [
  {
    // Both branches start together: one owns lifetime, the other emits the cue.
    type: 'parallel',
    steps: [
      {
        // This branch keeps the parallel step alive until ShootUpper completes.
        type: 'play',
        clip: 'ShootUpper',
        id: 'shootUpper',
        options: { repeat: 1, fadeIn: 0.08 },
        wait: 'complete'
      },
      {
        // This branch emits a muzzle event 0.5 seconds after the action starts.
        type: 'sequence',
        steps: [
          { type: 'wait', seconds: 0.5 },
          { type: 'emit', event: 'shoot-fire' }
        ]
      }
    ]
  },
  {
    // This runs only after ShootUpper completes.
    type: 'play',
    clip: 'RunUpper',
    options: { repeat: 0 }
  }
]
```

Result: `shoot-fire` is emitted mid-action, while the timeline still waits for `ShootUpper` to finish before restoring `RunUpper`.

---

## 6. Three Response Dispositions

`onActive` controls what happens to the current flow when a response fires.

| Value | Behavior | Common Use |
|-------|----------|------------|
| omitted or `'stop'` | Stop the active main flow, then run the response steps. | Normal interrupts and action changes. |
| `'keep'` | Keep the active flow and run response steps as a parallel branch. | Flinch overlays, upper-body shooting, footstep effects. |
| `{ fadeOut }` | Fade the active flow out over the given duration, then run the response. | State transitions and full-body inserts. |

```typescript
responses: [
  {
    event: 'flinch',
    target: {
      steps: [
        {
          // Flinch plays once as an overlay and does not replace locomotion.
          type: 'play',
          clip: 'Flinch',
          options: { repeat: 1 },
          wait: false
        }
      ]
    },
    // Keep the current state and play Flinch concurrently.
    onActive: 'keep'
  },
  {
    event: 'reload',
    target: {
      steps: [
        // Reload runs after the current main flow drains.
        { type: 'play', clip: 'Reload', options: { repeat: 1 }, wait: 'complete' },
        { type: 'emit', event: 'reload-finished' }
      ]
    },
    // Queue Reload instead of interrupting immediately.
    enqueue: true
  }
]
```

Result: `flinch` is immediate and concurrent; `reload` is queued. `enqueue` is useful for ordered action queues.

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
        clip: 'RunLower',
        id: 'lowerRun',
        options: { repeat: 0 }
      },
      {
        // Upper-body running starts at the same normalized phase as lowerRun.
        type: 'play',
        clip: 'RunUpper',
        id: 'upperRun',
        options: {
          repeat: 0,
          sync: { target: 'lowerRun', mode: 'normalized' }
        }
      }
    ]
  }
});
```

Result: `RunLower` and `RunUpper` loop together. `sync.target` can refer to a local `id` created by a previous `play`. Use `mode: 'normalized'` when matching clips have different durations; use `mode: 'time'` when their authored timelines match in seconds.

---

## 8. Insert a Half-Body Action While Layered

A common character pattern: keep the lower body running, temporarily replace the upper body with one shooting action, then restore upper-body running at the current lower-body phase.

```typescript
controller.addState('layeredRun', {
  timeline: {
    steps: [
      { type: 'play', clip: 'RunLower', id: 'lowerRun', options: { repeat: 0 } },
      {
        type: 'play',
        clip: 'RunUpper',
        id: 'upperRun',
        options: { repeat: 0, sync: { target: 'lowerRun', mode: 'normalized' } }
      }
    ]
  },
  responses: [
    {
      event: 'shoot',
      target: {
        steps: [
          {
            // Stop only the upper-body loop; lowerRun continues as the phase source.
            type: 'stop',
            target: 'upperRun',
            options: { fadeOut: 0.08 }
          },
          {
            // Play the shooting action once. parallel lets us emit shoot-fire mid-action and still wait for completion.
            type: 'parallel',
            steps: [
              {
                type: 'play',
                clip: 'ShootUpper',
                id: 'shootUpper',
                options: { repeat: 1, fadeIn: 0.08 },
                wait: 'complete'
              },
              {
                type: 'sequence',
                steps: [
                  { type: 'wait', seconds: 0.5 },
                  { type: 'emit', event: 'shoot-fire' }
                ]
              }
            ]
          },
          {
            // Restore upper-body running and synchronize it to the lower-body phase.
            // Reuse upperRun so later shoot events can stop this new upper-body loop.
            type: 'play',
            clip: 'RunUpper',
            id: 'upperRun',
            options: {
              repeat: 0,
              fadeIn: 0.12,
              sync: { target: 'lowerRun', mode: 'normalized' }
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

Result: `shoot` does not restart or stop `RunLower`. It emits `shoot-fire` mid-action, then restores `RunUpper` at the current `RunLower` phase. The easy detail to miss is `id: 'upperRun'` on the restoring play step: without reusing that id, the next `shoot` cannot find the new upper-body loop with `target: 'upperRun'`.

---

## 9. Insert a Full-Body Action and Return to Layering

Full-body rolls, dodges, or knockdowns usually replace both upper and lower layers. Keep the old lower body alive briefly so the full-body action can read its phase, then use `returnTo` to restore the layered state.

```typescript
controller
  .addState('layeredRun', {
    transition: 0.15,
    timeline: {
      steps: [
        {
          // RunLower is the phase reference used when entering the full-body action.
          type: 'play',
          clip: 'RunLower',
          id: 'lowerRun',
          options: { repeat: 0 }
        },
        {
          // RunUpper is synchronized to the lower body.
          type: 'play',
          clip: 'RunUpper',
          id: 'upperRun',
          options: { repeat: 0, sync: { target: 'lowerRun', mode: 'normalized' } }
        }
      ]
    },
    responses: [
      {
        event: 'dodge',
        target: {
          // dodgeFull completes, then returns to the current layeredRun state.
          targetState: 'dodgeFull',
          returnTo: true,
          returnTransition: 0.15
        },
        // Keep the old state for 0.12 seconds so dodgeFull can read RunLower's phase.
        onActive: { fadeOut: 0.12 }
      }
    ]
  })
  .addState('dodgeFull', {
    transition: 0.12,
    timeline: {
      steps: [
        {
          // Start DodgeFull at the same phase as the outgoing lower-body RunLower.
          // This uses the clip name because the source belongs to the old fading state.
          type: 'play',
          clip: 'DodgeFull',
          options: {
            repeat: 1,
            sync: { target: 'RunLower', mode: 'normalized' }
          },
          wait: 'complete'
        }
      ]
    }
  });
```

Result: `dodge` temporarily replaces layered locomotion with a full-body action. `DodgeFull` starts phase-aligned to the old `RunLower`; when it completes, the controller returns to `layeredRun`, fades the return state in, and keeps locomotion phase continuous.

---

## 10. Common Rules

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
