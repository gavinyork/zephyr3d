import { AnimationController } from '@zephyr3d/scene';
import {
  ACTION_URLS,
  createDemoShell,
  createRotateClip,
  loadRetargetedBot
} from '../tut-animation/shared.js';
import { createControlPanel } from '../tut-animation/ui.js';

const canvas = document.querySelector('#my-canvas');
const ui = createControlPanel('Parallel intro');
ui.setStatus('Loading parallel intro demo...');

const shell = await createDemoShell(canvas);
const { app, scene, keyLight } = shell;
app.run();

const bot = await loadRetargetedBot(scene, keyLight, [
  { url: ACTION_URLS.idle, targetName: 'idle' },
  { url: ACTION_URLS.wave, targetName: 'wave' }
]);

createRotateClip(bot, 'rotate', 2);

const controller = new AnimationController(bot.animationSet);
controller
  .addState('intro', {
    timeline: {
      steps: [
        {
          type: 'parallel',
          steps: [
            {
              type: 'play',
              clip: 'rotate',
              options: { repeat: 1 },
              wait: 'complete'
            },
            {
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

controller.on('statecomplete', (stateName) => {
  if (stateName === 'intro') {
    controller.setState('idle');
  }
});
controller.on('statechange', (stateName) => {
  ui.setStatus(`State: ${stateName ?? 'stopped'}`);
});

controller.setState('intro');

const resetButton = ui.addButton('Reset', () => {
  controller.setState('intro', { force: true });
});

ui.setActive(resetButton, true);
