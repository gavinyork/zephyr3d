import { Vector3, Vector4 } from '@zephyr3d/base';
import { backendWebGL1, backendWebGL2 } from '@zephyr3d/backend-webgl';
import { backendWebGPU } from '@zephyr3d/backend-webgpu';
import { GLTFImporter } from '@zephyr3d/loaders';
import {
  AnimationController,
  Application,
  DirectionalLight,
  getEngine,
  getInput,
  LambertMaterial,
  Mesh,
  OrbitCameraController,
  PerspectiveCamera,
  PlaneShape,
  PointLight,
  Scene
} from '@zephyr3d/scene';
import type {
  AnimationClip,
  AnimationTimelineEventResponse,
  AnimationTimelineEventResult,
  AnimationTimelineStep,
  SceneNode,
  SkeletalAnimationMaskOptions
} from '@zephyr3d/scene';
import type { DeviceBackend } from '@zephyr3d/device';

const DEFAULT_ASSETS = {
  model: 'https://cdn.zephyr3d.org/misc/xbot.glb',
  idle: 'https://cdn.zephyr3d.org/misc/idle.glb',
  walk: 'https://cdn.zephyr3d.org/misc/walking.glb',
  run: 'https://cdn.zephyr3d.org/misc/running.glb',
  shoot: 'https://cdn.zephyr3d.org/misc/pistolwalk.glb',
  attack: 'https://cdn.zephyr3d.org/misc/attack.glb'
} as const;

type AssetName = keyof typeof DEFAULT_ASSETS;
type LocomotionState = 'idle' | 'walk' | 'run';

type DemoShell = {
  app: Application;
  scene: Scene;
  camera: PerspectiveCamera;
  keyLight: DirectionalLight;
  muzzleLight: PointLight;
  hitLight: PointLight;
};

function getQueryString(name: string) {
  return new URL(window.location.toString()).searchParams.get(name) || null;
}

async function getBackend(): Promise<DeviceBackend> {
  const type = getQueryString('dev') || 'webgl';
  if (type === 'webgpu') {
    if (await backendWebGPU.supported()) {
      return backendWebGPU;
    } else {
      console.warn('No WebGPU support, fall back to WebGL2');
    }
  }
  if (type === 'webgl2') {
    if (await backendWebGL2.supported()) {
      return backendWebGL2;
    } else {
      console.warn('No WebGL2 support, fall back to WebGL1');
    }
  }
  return backendWebGL1;
}

const canvas = document.querySelector<HTMLCanvasElement>('#canvas');
if (!canvas) {
  throw new Error('Missing canvas element');
}

const ui = createUi();
ui.setEnabled(false);
ui.setState('loading');

try {
  const shell = await createDemoShell(canvas);
  const runtime = {
    controller: null as AnimationController | null,
    desiredState: 'idle' as LocomotionState,
    muzzleFlashTime: 0,
    hitFlashTime: 0
  };

  shell.app.run();
  ui.log('load', 'fetching model and action clips');

  const bot = await loadRetargetedBot(shell.scene, shell.keyLight);
  shell.muzzleLight.parent = bot;
  shell.hitLight.parent = bot;

  createMaskedClips(bot);
  addActionMarkers(bot);

  const controller = createController(bot);
  runtime.controller = controller;
  wireController(controller, runtime, ui, shell);
  wireInput(runtime, ui);

  controller.setState('idle');
  ui.setEnabled(true);
  ui.log('ready', 'controller started');

  shell.app.on('tick', (dt) => {
    const seconds = dt / 1000;
    shell.camera.updateController();
    updateFlashLights(shell, runtime, seconds);
  });
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  ui.setState('error');
  ui.log('error', message);
  console.error(err);
  throw err;
}

async function createDemoShell(canvas: HTMLCanvasElement): Promise<DemoShell> {
  const app = new Application({
    backend: await getBackend(),
    canvas,
    enableMSAA: true
  });

  await app.ready();

  getEngine().resourceManager.setModelLoader('model/gltf+json', new GLTFImporter());
  getEngine().resourceManager.setModelLoader('model/gltf-binary', new GLTFImporter());

  const scene = new Scene();
  scene.env.light.type = 'none';

  const camera = new PerspectiveCamera(scene, Math.PI / 3, 0.05, 120);
  camera.lookAt(new Vector3(0, 1.35, 4.2), new Vector3(0, 1.1, 0), Vector3.axisPY());
  camera.controller = new OrbitCameraController({
    center: new Vector3(0, 1.05, 0)
  });
  scene.mainCamera = camera;

  const keyLight = new DirectionalLight(scene);
  keyLight.setColor(new Vector4(1, 1, 1, 1)).setIntensity(6);
  keyLight.lookAt(new Vector3(3, 4, 4), new Vector3(0, 1, 0), Vector3.axisPY());
  keyLight.castShadow = true;
  keyLight.shadow.depthBias = 0.02;
  keyLight.shadow.mode = 'pcf-opt';

  const fillLight = new DirectionalLight(scene);
  fillLight.setColor(new Vector4(0.45, 0.55, 0.7, 1)).setIntensity(2.2);
  fillLight.lookAt(new Vector3(-4, 2.4, -3), new Vector3(0, 1, 0), Vector3.axisPY());

  const floorMaterial = new LambertMaterial();
  floorMaterial.albedoColor = new Vector4(0.31, 0.33, 0.32, 1);
  const floor = new Mesh(scene, new PlaneShape({ size: 7, resolution: 8 }), floorMaterial);
  floor.castShadow = false;
  floor.position.setXYZ(0, 0, 0);

  const muzzleLight = new PointLight(scene);
  muzzleLight.position.setXYZ(0.22, 1.35, 0.32);
  muzzleLight.setColor(new Vector4(1, 0.78, 0.28, 1));
  muzzleLight.range = 200;
  muzzleLight.setIntensity(0);

  const hitLight = new PointLight(scene);
  hitLight.position.setXYZ(0, 1.05, 0.68);
  hitLight.setColor(new Vector4(1, 0.36, 0.18, 1));
  hitLight.range = 200;
  hitLight.setIntensity(0);

  getInput().use(camera.handleEvent, camera);
  getEngine().setRenderable(scene, 0);

  app.on('resize', (width, height) => {
    camera.aspect = width / height;
  });

  return {
    app,
    scene,
    camera,
    keyLight,
    muzzleLight,
    hitLight
  };
}

async function loadRetargetedBot(scene: Scene, keyLight: DirectionalLight) {
  const bot = await getEngine().resourceManager.fetchModel(getAssetUrl('model'), scene);

  bot.iterate((node) => {
    if (node.isMesh()) {
      node.castShadow = true;
      keyLight.shadow.shadowRegion.addDynamicCaster(node);
    }
  });

  const actions: AssetName[] = ['idle', 'walk', 'run', 'shoot', 'attack'];
  for (const action of actions) {
    const source = await getEngine().resourceManager.fetchModel(getAssetUrl(action), scene);
    source.showState = 'hidden';

    const sourceName = source.animationSet.getAnimationNames()[0];
    if (!sourceName) {
      throw new Error(`Action source "${action}" does not contain an animation clip`);
    }

    const copied = bot.animationSet.copyHumanoidAnimationFrom(source.animationSet, sourceName, action, {
      rootMotion: 'scaled'
    });
    if (!copied) {
      throw new Error(`Failed to retarget "${action}" to the target model`);
    }
  }

  return bot;
}

function createMaskedClips(bot: SceneNode) {
  for (const state of ['idle', 'walk', 'run'] as const) {
    createMaskedClip(bot, state, `${state}_lower`, {
      type: 'humanoid',
      preset: 'lowerBody',
      rootMotion: 'include'
    });
    createMaskedClip(bot, state, `${state}_upper`, {
      type: 'humanoid',
      preset: 'upperBody',
      rootMotion: 'exclude'
    });
  }

  createMaskedClip(bot, 'shoot', 'shoot_upper', {
    type: 'humanoid',
    preset: 'upperBody',
    rootMotion: 'exclude'
  });
}

function createMaskedClip(
  bot: SceneNode,
  sourceName: string,
  targetName: string,
  options: SkeletalAnimationMaskOptions
) {
  const clip = bot.animationSet.createSkeletalMaskedAnimation(sourceName, targetName, options);
  if (!clip) {
    throw new Error(`Failed to create masked clip "${targetName}" from "${sourceName}"`);
  }
  return clip;
}

function addActionMarkers(bot: SceneNode) {
  const shoot = requireClip(bot, 'shoot_upper');
  addMarkerAtRatio(shoot, 'fire', 0.38, 0.12);
  addEndMarker(shoot, 'shoot-end');

  const attack = requireClip(bot, 'attack');
  addMarkerAtRatio(attack, 'hit', 0.42, 0.16);
  addEndMarker(attack, 'attack-end');
}

function createController(bot: SceneNode) {
  const controller = new AnimationController(bot.animationSet);

  for (const state of ['idle', 'walk', 'run'] as const) {
    controller.addState(state, {
      transition: 0.18,
      timeline: {
        steps: locomotionSteps(state)
      },
      responses: locomotionResponses(state)
    });
  }

  controller.addState('attack', {
    transition: 0.12,
    timeline: {
      steps: attackSteps()
    },
    responses: [
      {
        event: 'attack',
        target: {
          steps: attackSteps()
        },
        enqueue: true
      },
      {
        event: 'shoot',
        target: { consume: true }
      },
      {
        event: 'toIdle',
        target: { consume: true }
      },
      {
        event: 'toWalk',
        target: { consume: true }
      },
      {
        event: 'toRun',
        target: { consume: true }
      }
    ]
  });

  return controller;
}

function locomotionSteps(state: LocomotionState): AnimationTimelineStep[] {
  return [
    {
      type: 'play',
      clip: `${state}_lower`,
      id: 'lowerLoop',
      options: {
        repeat: 0
      }
    },
    {
      type: 'play',
      clip: `${state}_upper`,
      id: 'upperLoop',
      options: {
        repeat: 0,
        sync: { target: 'lowerLoop', mode: 'normalized' }
      }
    }
  ];
}

function locomotionResponses(state: LocomotionState): AnimationTimelineEventResponse[] {
  return [
    locomotionTransition('toIdle', 'idle'),
    locomotionTransition('toWalk', 'walk'),
    locomotionTransition('toRun', 'run'),
    {
      event: 'shoot',
      target: {
        steps: shootSteps(state)
      },
      onActive: 'keep'
    },
    {
      event: 'attack',
      target: {
        targetState: 'attack',
        returnTo: true,
        returnTransition: 0.15
      },
      onActive: { fadeOut: 0.12 }
    }
  ];
}

function locomotionTransition(event: string, targetState: LocomotionState): AnimationTimelineEventResponse {
  return {
    event,
    target: {
      targetState
    },
    onActive: { fadeOut: 0.18 }
  };
}

function shootSteps(returnState: LocomotionState): AnimationTimelineStep[] {
  return [
    {
      type: 'stop',
      target: 'upperLoop',
      options: { fadeOut: 0.06 }
    },
    {
      type: 'play',
      clip: 'shoot_upper',
      id: 'shootUpper',
      options: {
        repeat: 1,
        fadeIn: 0.06,
        completionFadeOut: 0.06
      }
    },
    {
      type: 'waitMarker',
      marker: 'fire',
      target: 'shootUpper'
    },
    {
      type: 'emit',
      event: 'shoot-fire',
      payload: { returnState }
    },
    {
      type: 'waitMarker',
      marker: 'shoot-end',
      target: 'shootUpper'
    },
    {
      type: 'play',
      clip: `${returnState}_upper`,
      id: 'upperLoop',
      options: {
        repeat: 0,
        fadeIn: 0.1,
        sync: { target: 'lowerLoop', mode: 'normalized' }
      }
    }
  ];
}

function attackSteps(): AnimationTimelineStep[] {
  return [
    {
      type: 'play',
      clip: 'attack',
      id: 'attackPlayback',
      options: {
        repeat: 1,
        fadeIn: 0.06,
        completionFadeOut: 0.08
      }
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
      marker: 'attack-end',
      target: 'attackPlayback'
    }
  ];
}

function wireController(
  controller: AnimationController,
  runtime: {
    desiredState: LocomotionState;
    muzzleFlashTime: number;
    hitFlashTime: number;
  },
  ui: ReturnType<typeof createUi>,
  shell: DemoShell
) {
  controller.on('statechange', (stateName) => {
    ui.setState(stateName ?? 'stopped');
    ui.setLocomotionActive(isLocomotionState(stateName) ? stateName : null);

    if (isLocomotionState(stateName) && stateName !== runtime.desiredState) {
      queueMicrotask(() => {
        controller.dispatch(eventForLocomotion(runtime.desiredState));
      });
    }
  });

  controller.on('event', (_event, _payload, result) => {
    ui.setEventResult(result);
  });

  controller.on('emit', (event) => {
    if (event === 'shoot-fire') {
      runtime.muzzleFlashTime = 0.16;
      shell.muzzleLight.setIntensity(26);
      ui.log('emit', 'shoot-fire');
    } else if (event === 'attack-hit') {
      runtime.hitFlashTime = 0.2;
      shell.hitLight.setIntensity(20);
      ui.log('emit', 'attack-hit');
    }
  });
}

function wireInput(
  runtime: {
    controller: AnimationController | null;
    desiredState: LocomotionState;
  },
  ui: ReturnType<typeof createUi>
) {
  const keys = {
    forward: false,
    run: false
  };

  const setLocomotion = (state: LocomotionState) => {
    runtime.desiredState = state;
    runtime.controller?.dispatch(eventForLocomotion(state));
  };

  ui.onIdle(() => setLocomotion('idle'));
  ui.onWalk(() => setLocomotion('walk'));
  ui.onRun(() => setLocomotion('run'));
  ui.onShoot(() => runtime.controller?.dispatch('shoot'));
  ui.onAttack(() => runtime.controller?.dispatch('attack'));
  ui.onReset(() => {
    keys.forward = false;
    keys.run = false;
    runtime.desiredState = 'idle';
    runtime.controller?.setState('idle', { force: true, transition: 0.12 });
  });

  window.addEventListener('keydown', (ev) => {
    if (ev.repeat) {
      return;
    }
    if (ev.code === 'KeyW') {
      keys.forward = true;
      setLocomotion(keys.run ? 'run' : 'walk');
    } else if (ev.code === 'ShiftLeft' || ev.code === 'ShiftRight') {
      keys.run = true;
      if (keys.forward) {
        setLocomotion('run');
      }
    } else if (ev.code === 'KeyF') {
      runtime.controller?.dispatch('shoot');
    } else if (ev.code === 'Space') {
      ev.preventDefault();
      runtime.controller?.dispatch('attack');
    }
  });

  window.addEventListener('keyup', (ev) => {
    if (ev.code === 'KeyW') {
      keys.forward = false;
      setLocomotion('idle');
    } else if (ev.code === 'ShiftLeft' || ev.code === 'ShiftRight') {
      keys.run = false;
      if (keys.forward) {
        setLocomotion('walk');
      }
    }
  });
}

function updateFlashLights(
  shell: DemoShell,
  runtime: { muzzleFlashTime: number; hitFlashTime: number },
  seconds: number
) {
  if (runtime.muzzleFlashTime > 0) {
    runtime.muzzleFlashTime = Math.max(0, runtime.muzzleFlashTime - seconds);
    shell.muzzleLight.setIntensity(26 * (runtime.muzzleFlashTime / 0.16));
  } else {
    shell.muzzleLight.setIntensity(0);
  }

  if (runtime.hitFlashTime > 0) {
    runtime.hitFlashTime = Math.max(0, runtime.hitFlashTime - seconds);
    shell.hitLight.setIntensity(20 * (runtime.hitFlashTime / 0.2));
  } else {
    shell.hitLight.setIntensity(0);
  }
}

function createUi() {
  const idleButton = requireElement<HTMLButtonElement>('btn-idle');
  const walkButton = requireElement<HTMLButtonElement>('btn-walk');
  const runButton = requireElement<HTMLButtonElement>('btn-run');
  const shootButton = requireElement<HTMLButtonElement>('btn-shoot');
  const attackButton = requireElement<HTMLButtonElement>('btn-attack');
  const resetButton = requireElement<HTMLButtonElement>('btn-reset');
  const stateValue = requireElement('state-value');
  const eventValue = requireElement('event-value');
  const policyValue = requireElement('policy-value');
  const eventLog = requireElement('event-log');
  const buttons = [idleButton, walkButton, runButton, shootButton, attackButton, resetButton];

  return {
    setEnabled(enabled: boolean) {
      for (const button of buttons) {
        button.disabled = !enabled;
      }
    },
    setState(value: string) {
      stateValue.textContent = value;
    },
    setEventResult(result: AnimationTimelineEventResult) {
      eventValue.textContent = result.event;
      policyValue.textContent = result.policy;
      this.log(result.event, result.handled ? result.policy : 'none');
    },
    setLocomotionActive(state: LocomotionState | null) {
      idleButton.classList.toggle('active', state === 'idle');
      walkButton.classList.toggle('active', state === 'walk');
      runButton.classList.toggle('active', state === 'run');
    },
    log(label: string, message: string) {
      const line = document.createElement('div');
      line.className = 'log-line';
      line.innerHTML = `<strong>${escapeHtml(label)}</strong> ${escapeHtml(message)}`;
      eventLog.prepend(line);
      while (eventLog.childElementCount > 7) {
        eventLog.lastElementChild?.remove();
      }
    },
    onIdle(handler: () => void) {
      idleButton.addEventListener('click', handler);
    },
    onWalk(handler: () => void) {
      walkButton.addEventListener('click', handler);
    },
    onRun(handler: () => void) {
      runButton.addEventListener('click', handler);
    },
    onShoot(handler: () => void) {
      shootButton.addEventListener('click', handler);
    },
    onAttack(handler: () => void) {
      attackButton.addEventListener('click', handler);
    },
    onReset(handler: () => void) {
      resetButton.addEventListener('click', handler);
    }
  };
}

function requireElement<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id) as T | null;
  if (!element) {
    throw new Error(`Missing element #${id}`);
  }
  return element;
}

function getAssetUrl(name: AssetName) {
  return new URLSearchParams(window.location.search).get(name) ?? DEFAULT_ASSETS[name];
}

function requireClip(bot: SceneNode, name: string) {
  const clip = bot.animationSet.getAnimationClip(name);
  if (!clip) {
    throw new Error(`Missing animation clip "${name}"`);
  }
  return clip;
}

function addMarkerAtRatio(clip: AnimationClip, name: string, ratio: number, fallback: number) {
  const duration = Math.max(clip.timeDuration, fallback);
  const time = Math.min(duration - 0.01, Math.max(0.01, duration * ratio));
  clip.addMarker({ id: name, name, time });
}

function addEndMarker(clip: AnimationClip, name: string) {
  clip.addMarker({ id: name, name, time: clip.timeDuration });
}

function eventForLocomotion(state: LocomotionState) {
  return state === 'idle' ? 'toIdle' : state === 'walk' ? 'toWalk' : 'toRun';
}

function isLocomotionState(state: string | null): state is LocomotionState {
  return state === 'idle' || state === 'walk' || state === 'run';
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}
