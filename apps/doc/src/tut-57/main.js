import { AnimationController } from '@zephyr3d/scene';
import { ACTION_URLS, createDemoShell, loadRetargetedBot } from '../tut-animation/shared.js';
import { createControlPanel } from '../tut-animation/ui.js';

const canvas = document.querySelector('#my-canvas');
const ui = createControlPanel('State switch');
ui.setStatus('Loading state switch demo...');

const shell = await createDemoShell(canvas);
const { app, scene, keyLight } = shell;
app.run();

const bot = await loadRetargetedBot(scene, keyLight, [
  { url: ACTION_URLS.idle, targetName: 'idle' },
  { url: ACTION_URLS.run, targetName: 'run' }
]);

const controller = new AnimationController(bot.animationSet);
controller
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
    },
    responses: [
      {
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
          type: 'play',
          clip: 'run',
          options: { repeat: 0 }
        }
      ]
    },
    responses: [
      {
        event: 'stopMove',
        target: { targetState: 'idle' }
      }
    ]
  });

controller.on('statechange', (stateName) => {
  ui.setStatus(`State: ${stateName ?? 'stopped'}`);
});

controller.setState('idle');

const moveButton = ui.addButton('Move', () => {
  controller.dispatch('move');
});
const stopButton = ui.addButton('Stop', () => {
  controller.dispatch('stopMove');
});
const resetButton = ui.addButton('Reset', () => {
  controller.setState('idle', { force: true });
});

ui.setActive(moveButton, true);
ui.setActive(stopButton, true);
ui.setActive(resetButton, true);
