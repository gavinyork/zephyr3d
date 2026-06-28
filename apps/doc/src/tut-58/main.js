import { AnimationController } from '@zephyr3d/scene';
import { ACTION_URLS, createDemoShell, loadRetargetedBot } from '../tut-animation/shared.js';
import { createControlPanel } from '../tut-animation/ui.js';

const canvas = document.querySelector('#my-canvas');
const ui = createControlPanel('One-shot return');
ui.setStatus('Loading one-shot return demo...');

const shell = await createDemoShell(canvas);
const { app, scene, keyLight } = shell;
app.run();

const bot = await loadRetargetedBot(scene, keyLight, [
  { url: ACTION_URLS.run, targetName: 'run' },
  { url: ACTION_URLS.attack, targetName: 'attack' }
]);

const controller = new AnimationController(bot.animationSet);
controller
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
        event: 'attack',
        target: { targetState: 'attack', returnTo: true, returnTransition: 0.15 },
        onActive: { fadeOut: 0.12 }
      }
    ]
  })
  .addState('attack', {
    transition: 0.12,
    timeline: {
      steps: [
        {
          type: 'play',
          clip: 'attack',
          options: { repeat: 1 },
          wait: 'complete'
        }
      ]
    }
  });

controller.on('statechange', (stateName) => {
  ui.setStatus(`State: ${stateName ?? 'stopped'}`);
});

controller.setState('run');

const attackButton = ui.addButton('Attack', () => {
  controller.dispatch('attack');
});
const resetButton = ui.addButton('Reset', () => {
  controller.setState('run', { force: true });
});

ui.setActive(attackButton, true);
ui.setActive(resetButton, true);
