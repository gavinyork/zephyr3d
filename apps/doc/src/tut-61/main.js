import { Vector3 } from '@zephyr3d/base';
import { AnimationController, NodeEulerRotationTrack, NodeTranslationTrack } from '@zephyr3d/scene';
import { ACTION_URLS, createDemoShell, loadRetargetedBot } from '../tut-animation/shared.js';
import { createControlPanel } from '../tut-animation/ui.js';

const canvas = document.querySelector('#my-canvas');
const ui = createControlPanel('Response dispositions');
ui.setStatus('Loading response demo...');

const shell = await createDemoShell(canvas);
const { app, scene, keyLight } = shell;
app.run();

const bot = await loadRetargetedBot(scene, keyLight, [
  { url: ACTION_URLS.idle, targetName: 'idle' },
  { url: ACTION_URLS.walk, targetName: 'walk' },
  { url: ACTION_URLS.attack, targetName: 'attack' }
]);

// Local transform clip used to show concurrent overlay playback.
createFlinchClip(bot, 'tutFlinch', 0.32);

const controller = new AnimationController(bot.animationSet);
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
              type: 'play',
              clip: 'tutFlinch',
              options: { repeat: 1, fadeIn: 0.05 },
              wait: 'complete'
            }
          ]
        },
        onActive: 'keep'
      },
      {
        event: 'queueAttack',
        target: {
          steps: [
            {
              type: 'play',
              clip: 'attack',
              options: { repeat: 1 },
              wait: 'complete'
            },
            {
              type: 'emit',
              event: 'queued-attack-finished'
            }
          ]
        },
        enqueue: true
      }
    ]
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

controller.on('statechange', (stateName) => {
  ui.setStatus(`State: ${stateName ?? 'stopped'}`);
});
controller.on('statecomplete', (stateName) => {
  if (stateName === 'introWalk') {
    controller.setState('idle');
    ui.setStatus('Walk drained, queued work finished, now idle.');
  }
});
controller.on('emit', (event) => {
  if (event === 'queued-attack-finished') {
    ui.setStatus('Queued attack executed after the walk finished.');
  }
});
controller.on('event', (event, _payload, result) => {
  if (result.handled) {
    ui.setStatus(`${event} -> ${result.policy}`);
  }
});

controller.setState('introWalk');

const flinchButton = ui.addButton('Flinch (keep)', () => {
  controller.dispatch('flinch');
});
const queueButton = ui.addButton('Queue attack', () => {
  controller.dispatch('queueAttack');
});
const resetButton = ui.addButton('Reset', () => {
  controller.setState('introWalk', { force: true });
});

ui.setActive(flinchButton, true);
ui.setActive(queueButton, true);
ui.setActive(resetButton, true);

function createFlinchClip(target, name, duration) {
  const clip = target.animationSet.createAnimation(name);
  clip.timeDuration = duration;
  clip.addTrack(
    target,
    new NodeTranslationTrack('linear', [
      { time: 0, value: new Vector3(0, 0, 0) },
      { time: 0.08, value: new Vector3(-0.05, 0.03, 0) },
      { time: 0.18, value: new Vector3(0.04, -0.02, 0) },
      { time: duration, value: new Vector3(0, 0, 0) }
    ])
  );
  clip.addTrack(
    target,
    new NodeEulerRotationTrack('linear', [
      { time: 0, value: new Vector3(0, 0, 0) },
      { time: 0.08, value: new Vector3(0, 0, 0.1) },
      { time: 0.18, value: new Vector3(0, 0, -0.06) },
      { time: duration, value: new Vector3(0, 0, 0) }
    ])
  );
  return clip;
}
