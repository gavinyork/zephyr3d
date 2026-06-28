import { Vector4 } from '@zephyr3d/base';
import { PointLight, AnimationController } from '@zephyr3d/scene';
import { ACTION_URLS, createDemoShell, loadRetargetedBot } from '../tut-animation/shared.js';
import { createControlPanel } from '../tut-animation/ui.js';

const canvas = document.querySelector('#my-canvas');
const ui = createControlPanel('Marker timing');
ui.setStatus('Loading marker demo...');

const shell = await createDemoShell(canvas);
const { app, scene, keyLight } = shell;
app.run();

const flashLight = new PointLight(scene);
flashLight.parent = scene.rootNode;
flashLight.position.setXYZ(0.08, 1.35, 0.25);
flashLight.setColor(new Vector4(1.0, 0.72, 0.25, 1));
flashLight.range = 3.5;
flashLight.setIntensity(0);

const state = {
  flashTime: 0
};

const bot = await loadRetargetedBot(scene, keyLight, [
  { url: ACTION_URLS.idle, targetName: 'idle' },
  { url: ACTION_URLS.attack, targetName: 'attack' }
]);

const attackClip = bot.animationSet.getAnimationClip('attack');
attackClip?.addMarker({ id: 'hit', name: 'hit', time: 0.3 });
attackClip?.addMarker({ id: 'end', name: 'end', time: attackClip.timeDuration });

const controller = new AnimationController(bot.animationSet);
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
            type: 'play',
            clip: 'attack',
            id: 'attackPlayback',
            options: { repeat: 1, fadeIn: 0.08 },
            wait: false
          },
          {
            type: 'waitMarker',
            marker: 'hit',
            target: 'attackPlayback'
          },
          {
            type: 'emit',
            event: 'attack-hit'
          },
          {
            type: 'waitMarker',
            marker: 'end',
            target: 'attackPlayback'
          },
          {
            type: 'play',
            clip: 'idle',
            options: { repeat: 0 }
          }
        ]
      },
      onActive: 'stop'
    }
  ]
});

controller.on('statechange', (stateName) => {
  ui.setStatus(`State: ${stateName ?? 'stopped'}`);
});
controller.on('statecomplete', (stateName) => {
  if (stateName === 'idle') {
    ui.setStatus('Attack complete, returned to idle.');
  }
});
controller.on('emit', (event) => {
  if (event === 'attack-hit') {
    state.flashTime = 0.15;
    flashLight.setIntensity(22);
    ui.setStatus('Hit marker reached.');
  }
});

controller.setState('idle');

const attackButton = ui.addButton('Attack', () => {
  controller.dispatch('attack');
});
const resetButton = ui.addButton('Reset', () => {
  state.flashTime = 0;
  flashLight.setIntensity(0);
  controller.setState('idle', { force: true });
});

ui.setActive(attackButton, true);
ui.setActive(resetButton, true);

app.on('tick', (dt) => {
  const delta = dt / 1000;
  if (state.flashTime > 0) {
    state.flashTime = Math.max(0, state.flashTime - delta);
    const t = state.flashTime / 0.15;
    flashLight.setIntensity(22 * t);
  } else {
    flashLight.setIntensity(0);
  }
});
