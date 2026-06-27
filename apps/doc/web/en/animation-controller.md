# AnimationController and Action Orchestration

`AnimationSet` is the low-level playback container for clips. `AnimationController` builds a higher-level action layer on top of it: named states, scripted timelines, state transitions, event responses, and cross-fades.

Use it when a character, camera, prop, or UI object needs action orchestration instead of isolated clip playback. Typical examples include idle/run/attack state machines, cutscene timelines, marker-driven effects, and interruptible actions.

---

## Core Concepts

| Concept | Description |
|---------|-------------|
| `AnimationController` | Owns named states and dispatches gameplay events to the active state. |
| State | A named entry containing one timeline, optional event responses, and a default transition duration. |
| `AnimationTimeline` | Serializable list of steps such as play, stop, wait, emit, sequence, and parallel. |
| `AnimationTimelineRunner` | Runtime interpreter for one timeline. It is advanced by the owning `AnimationSet` update loop. |
| Event response | Declares what to do when a dispatched event is not consumed by a waiting step. |

The controller does not replace `AnimationSet`. It uses the same `AnimationSet` to create playbacks, so all existing blending, fade-in, fade-out, markers, and frame events still apply.

---

## Basic State Controller

The most common pattern is to register several states and transition between them with events. The example below creates a simple idle/run/attack controller: movement events switch between idle and run, the attack event plays a one-shot attack, and `returnTo: true` returns to the state that was interrupted when the attack completes.

```typescript
import { AnimationController } from '@zephyr3d/scene';

// Bind the controller to the model's AnimationSet so states can play the model's clips.
const controller = new AnimationController(model.animationSet);

controller
  // Idle is the default looping state. It can transition to run or attack.
  .addState('idle', {
    // Cross-fade into idle over 0.2 seconds.
    transition: 0.2,
    timeline: {
      steps: [
        {
          // Play the Idle clip forever while this state is active.
          type: 'play',
          clip: 'Idle',
          options: { repeat: 0 }
        }
      ]
    },
    responses: [
      // Gameplay "move" input enters the run state.
      { event: 'move', target: { targetState: 'run' } },
      // Attack interrupts idle, then returns to idle because idle was the previous state.
      { event: 'attack', target: { targetState: 'attack', returnTo: true }, onActive: { fadeOut: 0.12 } }
    ]
  })
  // Run is another looping state. It can return to idle or be interrupted by attack.
  .addState('run', {
    transition: 0.2,
    timeline: {
      steps: [
        {
          // Play the Run clip forever until another state replaces it.
          type: 'play',
          clip: 'Run',
          options: { repeat: 0 }
        }
      ]
    },
    responses: [
      // Stop movement and return to idle.
      { event: 'stopMove', target: { targetState: 'idle' } },
      // Attack interrupts run, then returns to run because run was the previous state.
      { event: 'attack', target: { targetState: 'attack', returnTo: true }, onActive: { fadeOut: 0.12 } }
    ]
  })
  // Attack is a one-shot state. Its timeline completes after the Attack clip finishes.
  .addState('attack', {
    transition: 0.12,
    timeline: {
      steps: [
        {
          // Play Attack once and block this timeline until it completes.
          type: 'play',
          clip: 'Attack',
          options: { repeat: 1 },
          wait: 'complete'
        }
      ]
    },
    responses: [
      // Optional cancel input can cut the attack short and return to idle.
      { event: 'cancel', target: { targetState: 'idle' }, onActive: { fadeOut: 0.1 } }
    ]
  });

// Start the state machine from idle.
controller.setState('idle');

// Later, from input or gameplay code, these events drive state transitions.
controller.dispatch('move');
controller.dispatch('attack');
```

`transition` is measured in seconds. When entering a state with a positive transition duration, the outgoing runner fades out and the entry play steps of the new timeline fade in.

---

## Timeline Steps

A timeline is a serializable action script. It runs synchronously on the animation update clock and does not use `async` or timers.

| Step | Purpose |
|------|---------|
| `play` | Starts an animation clip. Set `wait: 'complete'` to block until that playback completes or stops. |
| `stop` | Stops one playback by id, or all playbacks owned by the runner when `target` is omitted. |
| `wait` | Blocks for a fixed number of seconds. |
| `waitEvent` | Blocks until `controller.dispatch(event)` sends a matching event to the active runner. |
| `waitMarker` | Blocks until a playback crosses a marker id or name. |
| `waitFrame` | Blocks until a playback crosses a frame number. |
| `emit` | Emits a named event from the runner or controller. |
| `sequence` | Runs child steps in order. |
| `parallel` | Runs child steps as isolated parallel branches and joins when all branches finish. |

For example, a cutscene-like action can combine camera movement, character animation, waits, and emitted cues. The example below plays a camera intro and, after a short delay, a character wave in parallel. Once both branches finish, it emits `intro-finished` and returns to idle.

```typescript
// Register a timeline state for a short intro sequence.
controller.addState('intro', {
  timeline: {
    steps: [
      {
        // Run the camera branch and character branch at the same time.
        type: 'parallel',
        steps: [
          {
            // CameraIntro runs once and keeps its branch alive until the clip completes.
            type: 'play',
            clip: 'CameraIntro',
            options: { repeat: 1 },
            wait: 'complete'
          },
          {
            // The character branch waits 0.4 seconds, then plays a Wave clip once.
            type: 'sequence',
            steps: [
              { type: 'wait', seconds: 0.4 },
              { type: 'play', clip: 'Wave', options: { repeat: 1 }, wait: 'complete' }
            ]
          }
        ]
      },
      // Notify game code that the intro sequence has fully drained.
      { type: 'emit', event: 'intro-finished' }
    ]
  }
});

// Convert the emitted timeline cue into the next controller state.
controller.on('emit', (event) => {
  if (event === 'intro-finished') {
    controller.setState('idle');
  }
});
```

---

## Marker and Frame Driven Actions

Use `id` on a `play` step when later steps need to refer to that playback. This is useful for hit frames, footstep effects, sound cues, or gameplay windows. The example below starts an attack clip, emits `attack-hit` when the authored marker is reached, then emits `attack-recover` at frame 36.

```typescript
// Register an attack variant whose timeline exposes animation timing to gameplay code.
controller.addState('attackWithHitEvent', {
  transition: 0.1,
  timeline: {
    steps: [
      {
        // Start Attack once and assign it a local id for waitMarker/waitFrame.
        type: 'play',
        clip: 'Attack',
        id: 'attack',
        options: { repeat: 1 },
        // Continue immediately so the following wait steps can observe this playback.
        wait: false
      },
      // Block until the Attack playback crosses the "hit" marker.
      { type: 'waitMarker', marker: 'hit', target: 'attack' },
      // Let gameplay code spawn damage/effects exactly on the hit marker.
      { type: 'emit', event: 'attack-hit' },
      // Block again until the authored recovery frame.
      { type: 'waitFrame', frame: 36, target: 'attack' },
      // Let gameplay code know the attack can transition out.
      { type: 'emit', event: 'attack-recover' }
    ]
  }
});

// Handle timing cues produced by the attack timeline.
controller.on('emit', (event) => {
  if (event === 'attack-hit') {
    spawnHitEffect();
  } else if (event === 'attack-recover') {
    controller.setState('idle');
  }
});
```

`waitMarker` accepts either the marker id or marker name. `waitFrame` uses frame numbers reported by the playback.

---

## Event Responses

Events sent with `controller.dispatch(name, payload)` are handled in this order:

1. A matching `waitEvent` in the active runner consumes the event and advances the timeline.
2. The active timeline's own `responses` are evaluated.
3. The current controller state's `responses` are evaluated.
4. If nothing handles the event, the result has `handled: false`.

State transitions should be declared on the controller state's `responses`. This fragment turns movement input into state changes:

```typescript
responses: [
  // Enter the running locomotion state when movement begins.
  { event: 'move', target: { targetState: 'run' } },
  // Return to the idle locomotion state when movement stops.
  { event: 'stopMove', target: { targetState: 'idle' } }
]
```

For temporary one-shot states, set `returnTo: true` on the state-transition target. This records the state active before the transition and returns to it after the target state's timeline completes:

```typescript
responses: [
  {
    event: 'attack',
    target: {
      // Enter Attack now, then return to whichever state was interrupted.
      targetState: 'attack',
      returnTo: true
    },
    // Fade out the interrupted state while Attack fades in.
    onActive: { fadeOut: 0.12 }
  }
]
```

Use a string when the action should always return to a specific state:

```typescript
responses: [
  {
    event: 'intro',
    target: {
      // Play Intro, then always return to Idle regardless of the previous state.
      targetState: 'intro',
      returnTo: 'idle',
      returnTransition: 0.25
    }
  }
]
```

When `returnTransition` is greater than 0, the target state's completed playbacks are kept alive
for that duration as a completion fade-out while the return state fades in. This turns a natural
one-shot completion, such as `Attack`, into a real cross-fade back to locomotion instead of removing
the completed clip before the return state starts.

Responses can also run short action snippets without changing state. This fragment keeps a flinch reaction concurrent with the current state, while reload is queued until the active main flow drains:

```typescript
responses: [
  {
    event: 'flinch',
    target: {
      steps: [
        {
          // Play a short Flinch overlay once without replacing locomotion.
          type: 'play',
          clip: 'Flinch',
          options: { repeat: 1 },
          wait: false
        }
      ]
    },
    // Keep the active state running and play Flinch as a concurrent branch.
    onActive: 'keep'
  },
  {
    event: 'reload',
    target: {
      steps: [
        // Play Reload once and wait for it to finish before emitting the completion cue.
        { type: 'play', clip: 'Reload', options: { repeat: 1 }, wait: 'complete' },
        { type: 'emit', event: 'reload-finished' }
      ]
    },
    // Queue Reload so it starts after the current main-flow action finishes.
    enqueue: true
  }
]
```

`onActive` controls the currently running steps:

| Value | Behavior |
|-------|----------|
| `'stop'` | Stops the active main flow before running the response. This is the default. |
| `'keep'` | Runs the response concurrently with the current flow. |
| `{ fadeOut }` | Stops the active main flow with a fade-out before running the response. |

`enqueue: true` appends the response steps and runs them after the current main flow drains.

---

## Common Action Orchestration Scenarios

The following examples cover common character action graphs. They are intentionally small, so each snippet focuses on one orchestration pattern.

### Single Loop

This state plays one idle clip forever. It is the simplest form of a controller state: enter once, keep the looping playback alive until another state or `stop()` replaces it.

```typescript
controller.addState('idleLoop', {
  timeline: {
    steps: [
      {
        // repeat: 0 means the Idle clip loops forever.
        type: 'play',
        clip: 'Idle',
        options: { repeat: 0 }
      }
    ]
  }
});

// Enter the looping state explicitly; adding a state does not make it active.
controller.setState('idleLoop');
```

### Loop With One-Shot Insert

This controller keeps `Run` looping, then inserts `Attack` once when the `attack` event arrives. `returnTo: true` records the interrupted state, so the controller automatically returns to `runLoop` after the one-shot attack completes.

```typescript
controller
  .addState('runLoop', {
    transition: 0.15,
    timeline: {
      steps: [
        {
          // Keep the locomotion loop alive while no temporary action is active.
          type: 'play',
          clip: 'Run',
          options: { repeat: 0 }
        }
      ]
    },
    responses: [
      {
        // Insert Attack once, then return to whichever state was interrupted.
        event: 'attack',
        target: { targetState: 'attackOnce', returnTo: true, returnTransition: 0.12 },
        // Fade Run out while Attack fades in.
        onActive: { fadeOut: 0.12 }
      }
    ]
  })
  .addState('attackOnce', {
    transition: 0.12,
    timeline: {
      steps: [
        {
          // Attack plays once and blocks this state until the playback completes.
          type: 'play',
          clip: 'Attack',
          options: { repeat: 1 },
          wait: 'complete'
        }
      ]
    }
  });
```

### Parallel Upper/Lower Loops

This state starts lower-body and upper-body loops together. `RunUpper` synchronizes to `lowerRun`, so even if the upper clip has a different duration, it starts at the same normalized locomotion phase as the lower body.

```typescript
controller.addState('layeredRun', {
  timeline: {
    steps: [
      {
        // Lower-body running is the phase reference for this layered state.
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

### Parallel Loops With Half-Body Insert

This response inserts a finite upper-body shooting action while `RunLower` keeps looping. It stops the upper loop, plays `ShootUpper` once, then restores `RunUpper` at the current phase of `RunLower`.

```typescript
responses: [
  {
    event: 'shoot',
    target: {
      steps: [
        {
          // Stop only the upper-body loop; the lower-body run continues as the phase source.
          type: 'stop',
          target: 'upperRun',
          options: { fadeOut: 0.08 }
        },
        {
          // Play the upper-body shooting action once.
          type: 'play',
          clip: 'ShootUpper',
          options: { repeat: 1, fadeIn: 0.08 },
          wait: 'complete'
        },
        {
          // Restore upper-body running without restarting the gait cycle from phase 0.
          // Reuse upperRun so later shoot events can stop this replacement playback too.
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
    // Keep the lower-body branch running while the upper-body insert executes.
    onActive: 'keep'
  }
]
```

### Parallel Loops With Full-Body Insert

This setup inserts a finite full-body dodge while the character is in the layered running state. The state transition keeps `RunLower` alive for the fade-out window, so `DodgeFull` can copy its phase before the layered playbacks are replaced. When `DodgeFull` completes, `returnTo: true` restores the previously interrupted layered state.

```typescript
controller
  .addState('layeredRun', {
    transition: 0.15,
    timeline: {
      steps: [
        // Lower-body running is the phase reference for full-body inserts.
        { type: 'play', clip: 'RunLower', id: 'lowerRun', options: { repeat: 0 } },
        // Upper-body running is layered on top of the lower-body loop.
        {
          type: 'play',
          clip: 'RunUpper',
          options: { repeat: 0, sync: { target: 'lowerRun' } }
        }
      ]
    },
    responses: [
      {
        // Insert a finite full-body dodge and then return to layeredRun.
        event: 'dodge',
        target: { targetState: 'dodgeFull', returnTo: true, returnTransition: 0.15 },
        // Keep RunLower alive long enough for DodgeFull to read its phase.
        onActive: { fadeOut: 0.12 }
      }
    ]
  })
  .addState('dodgeFull', {
    transition: 0.12,
    timeline: {
      steps: [
        {
          // Start the full-body action at the same locomotion phase as the outgoing lower body.
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

`stop.target` and `sync.target` can refer to a local `id` created by a previous `play` step in the same runner, even if that step's frame has already drained. They can also resolve an active clip name or playback id. When a response stops a named playback and later restores the same logical track, assign the same `id` on the restoring `play` step so future responses keep targeting the new playback. Use `mode: 'normalized'` for corresponding clips with different durations, and `mode: 'time'` when clips share the same authored timing in seconds. `offset` shifts the copied phase, and `wrap: false` clamps instead of wrapping into the destination clip or range.

---

## Events Exposed by the Controller

The following listeners are useful when debugging an action graph. They log state changes, completed one-shot timelines, emitted timeline cues, and the resolved handling policy for each dispatched event.

```typescript
// Fires whenever setState() changes the active state or stop() clears it.
controller.on('statechange', (state, previousState) => {
  console.log('state changed', previousState, '->', state);
});

// Fires when the active state's runner drains all timeline work.
controller.on('statecomplete', (state) => {
  console.log('state complete', state);
});

// Fires when a timeline step emits a gameplay cue.
controller.on('emit', (event, payload) => {
  console.log('timeline emitted', event, payload);
});

// Fires after every dispatch(), including events that were ignored.
controller.on('event', (event, payload, result) => {
  console.log('dispatch result', event, result.policy, result.handled);
});
```

The `event` notification is useful for debugging action graphs because it reports whether an input was consumed, ignored, enqueued, converted to steps, or used as a transition.

When `returnTo` is configured, `statecomplete` is emitted before the automatic return. If a listener changes state during `statecomplete`, the automatic return is skipped and the listener's state change wins.

---

## Practical Notes

- Use `AnimationController` for action-level orchestration and `AnimationSet` for direct low-level playback.
- Use stable clip names and verify imported models contain the clips referenced by timelines.
- Use `repeat: 1` for one-shot actions that should complete, and `repeat: 0` for looping states such as idle or run.
- Use `returnTo: true` on temporary state transitions when a one-shot action should return to the interrupted looping state. Set `returnTransition` when the completed action should fade out while the return state fades in.
- Use `options.sync` when restoring an upper/lower-body loop or replacing layered locomotion with a full-body clip; keep the source playback alive with a short transition when the new state must read its phase.
- Put default cross-fade durations on state definitions with `transition`; override individual transitions with `setState(name, { transition })` or a response's `{ fadeOut }`.
- Use `waitMarker` for gameplay timing when authored animation markers are available; use `waitFrame` when your pipeline relies on frame numbers.
- Looping states normally do not emit `statecomplete`, because their playbacks never finish unless they are stopped or interrupted.
