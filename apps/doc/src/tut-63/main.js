import { Vector4 } from '@zephyr3d/base';
import { PointLight, AnimationController } from '@zephyr3d/scene';
import {
  ACTION_URLS,
  createDemoShell,
  createMaskedClip,
  loadRetargetedBot
} from '../tut-animation/shared.js';
import { createControlPanel } from '../tut-animation/ui.js';

const canvas = document.querySelector('#my-canvas');
const ui = createControlPanel('Half-body insert');
ui.setStatus('Loading half-body insert demo...');

const shell = await createDemoShell(canvas);
const { app, scene, keyLight } = shell;
app.run();

const flashLight = new PointLight(scene);
flashLight.parent = scene.rootNode;
flashLight.position.setXYZ(0.1, 1.35, 0.25);
flashLight.setColor(new Vector4(1.0, 0.85, 0.32, 1));
flashLight.range = 3.5;
flashLight.setIntensity(0);

const bot = await loadRetargetedBot(scene, keyLight, [
  { url: ACTION_URLS.run, targetName: 'run' },
  { url: ACTION_URLS.pistolwalk, targetName: 'pistolwalk' },
  { url: ACTION_URLS.attack, targetName: 'attack' }
]);

createMaskedClip(bot, 'run', 'run_lower', {
  type: 'humanoid',
  preset: 'lowerBody',
  rootMotion: 'include'
});
createMaskedClip(bot, 'run', 'run_upper', {
  type: 'humanoid',
  preset: 'upperBody',
  rootMotion: 'exclude'
});
createMaskedClip(bot, 'pistolwalk', 'shoot_upper', {
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
        clip: 'run_upper',
        id: 'upperLoop',
        options: {
          repeat: 0,
          sync: { target: 'lowerLoop', mode: 'time' }
        }
      }
    ]
  },
  responses: [
    {
      event: 'shoot',
      target: {
        steps: [
          {
            type: 'stop',
            target: 'upperLoop',
            options: { fadeOut: 0.08 }
          },
          {
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
      onActive: 'keep'
    }
  ]
});

controller.on('statechange', (stateName) => {
  ui.setStatus(`State: ${stateName ?? 'stopped'}`);
});
controller.on('emit', (event) => {
  if (event === 'shoot-fire') {
    flashLight.setIntensity(24);
    ui.setStatus('Upper-body shot inserted, then restored.');
  }
});

controller.setState('layeredRun');

const shootButton = ui.addButton('Shoot', () => {
  flashLight.setIntensity(0);
  controller.dispatch('shoot');
});
const resetButton = ui.addButton('Reset', () => {
  flashLight.setIntensity(0);
  controller.setState('layeredRun', { force: true });
});

ui.setActive(shootButton, true);
ui.setActive(resetButton, true);

app.on('tick', (dt) => {
  flashLight.setIntensity(Math.max(0, flashLight.intensity - (dt / 1000) * 32));
});
