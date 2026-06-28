import { Vector3 } from '@zephyr3d/base';
import { AnimationController, NodeEulerRotationTrack, NodeTranslationTrack } from '@zephyr3d/scene';
import {
  ACTION_URLS,
  createDemoShell,
  createMaskedClip,
  loadRetargetedBot
} from '../tut-animation/shared.js';
import { createControlPanel } from '../tut-animation/ui.js';

const canvas = document.querySelector('#my-canvas');
const ui = createControlPanel('Full-body insert');
ui.setStatus('Loading full-body insert demo...');

const shell = await createDemoShell(canvas);
const { app, scene, keyLight } = shell;
app.run();

const bot = await loadRetargetedBot(scene, keyLight, [
  { url: ACTION_URLS.run, targetName: 'run' },
  { url: ACTION_URLS.pistolwalk, targetName: 'pistolwalk' }
]);

createMaskedClip(bot, 'run', 'run_lower', {
  type: 'humanoid',
  preset: 'lowerBody',
  rootMotion: 'include'
});
createMaskedClip(bot, 'pistolwalk', 'pistol_upper', {
  type: 'humanoid',
  preset: 'upperBody',
  rootMotion: 'exclude'
});

const dodge = bot.animationSet.createAnimation('dodgeFull');
dodge.timeDuration = 0.55;
dodge.addTrack(
  bot,
  new NodeTranslationTrack('linear', [
    { time: 0, value: new Vector3(0, 0, 0) },
    { time: 0.12, value: new Vector3(0.15, 0, 0.05) },
    { time: 0.25, value: new Vector3(0.38, 0, 0.18) },
    { time: 0.4, value: new Vector3(0.16, 0, 0.06) },
    { time: 0.55, value: new Vector3(0, 0, 0) }
  ])
);
dodge.addTrack(
  bot,
  new NodeEulerRotationTrack('linear', [
    { time: 0, value: new Vector3(0, 0, 0) },
    { time: 0.12, value: new Vector3(0, -0.28, 0) },
    { time: 0.25, value: new Vector3(0, -0.45, 0) },
    { time: 0.4, value: new Vector3(0, -0.18, 0) },
    { time: 0.55, value: new Vector3(0, 0, 0) }
  ])
);

const controller = new AnimationController(bot.animationSet);
controller
  .addState('layeredRun', {
    transition: 0.18,
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
          options: {
            repeat: 0,
            sync: { target: 'lowerLoop', mode: 'normalized' }
          }
        }
      ]
    },
    responses: [
      {
        event: 'dodge',
        target: {
          targetState: 'dodgeFull',
          returnTo: true,
          returnTransition: 0.15
        },
        onActive: { fadeOut: 0.12 }
      }
    ]
  })
  .addState('dodgeFull', {
    transition: 0.12,
    timeline: {
      steps: [
        {
          type: 'play',
          clip: 'dodgeFull',
          options: {
            repeat: 1,
            fadeIn: 0.05,
            sync: { target: 'run_lower', mode: 'normalized' }
          },
          wait: 'complete'
        }
      ]
    }
  });

controller.on('statechange', (stateName) => {
  ui.setStatus(`State: ${stateName ?? 'stopped'}`);
});
controller.on('statecomplete', (stateName) => {
  if (stateName === 'dodgeFull') {
    ui.setStatus('Full-body dodge completed, returned to layered run.');
  }
});

controller.setState('layeredRun');

const dodgeButton = ui.addButton('Dodge', () => {
  controller.dispatch('dodge');
});
const resetButton = ui.addButton('Reset', () => {
  controller.setState('layeredRun', { force: true });
});

ui.setActive(dodgeButton, true);
ui.setActive(resetButton, true);
