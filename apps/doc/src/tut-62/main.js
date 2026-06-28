import { AnimationController } from '@zephyr3d/scene';
import {
  ACTION_URLS,
  createDemoShell,
  createMaskedClip,
  loadRetargetedBot
} from '../tut-animation/shared.js';
import { createControlPanel } from '../tut-animation/ui.js';

const canvas = document.querySelector('#my-canvas');
const ui = createControlPanel('Layer sync');
ui.setStatus('Loading layer sync demo...');

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

const controller = new AnimationController(bot.animationSet);
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
        options: {
          repeat: 0,
          sync: { target: 'lowerLoop', mode: 'normalized' }
        }
      }
    ]
  }
});

controller.on('statechange', (stateName) => {
  ui.setStatus(`State: ${stateName ?? 'stopped'}`);
});

controller.setState('layeredRun');

const restartButton = ui.addButton('Restart phase', () => {
  controller.setState('layeredRun', { force: true });
});

ui.setActive(restartButton, true);
