import { AABB, Quaternion, Vector3, Vector4 } from '@zephyr3d/base';
import {
  Application,
  BoxShape,
  Collider,
  CylinderShape,
  DirectionalLight,
  getEngine,
  getInput,
  InputActionMap,
  Mesh,
  NodePhysics,
  PBRMetallicRoughnessMaterial,
  PerspectiveCamera,
  PlaneShape,
  RigidBody,
  Scene,
  Vehicle,
  Wheel
} from '@zephyr3d/scene';
import { initPhysics } from '@zephyr3d/physics';
import { rapierPhysics } from '@zephyr3d/physics-rapier';
import { backendWebGL2 } from '@zephyr3d/backend-webgl';
import { backendWebGPU } from '@zephyr3d/backend-webgpu';

const myApp = new Application({
  backend: (await backendWebGPU.supported()) ? backendWebGPU : backendWebGL2,
  canvas: document.querySelector('#my-canvas')
});

function material(r, g, b) {
  const m = new PBRMetallicRoughnessMaterial();
  m.albedoColor = new Vector4(r, g, b, 1);
  m.metallic = 0;
  m.roughness = 0.7;
  return m;
}

// #region maps
// One map per situation. Each binds an action to keys, mouse and gamepad at
// once; the game only reads actions, never devices.
const driving = new InputActionMap('driving', {
  throttle: { type: 'axis', bindings: [{ key: 'KeyW' }, { key: 'ArrowUp' }, { pad: 'RT' }] },
  brake: { type: 'axis', bindings: [{ key: 'KeyS' }, { key: 'ArrowDown' }, { pad: 'LT' }] },
  // Positive steering turns left; the stick's +x is right, hence invert.
  steer: {
    type: 'axis',
    bindings: [
      { keys: ['KeyA', 'KeyD'] },
      { keys: ['ArrowLeft', 'ArrowRight'] },
      { pad: 'LS.x', invert: true }
    ]
  },
  handbrake: { type: 'button', bindings: [{ key: 'Space' }, { pad: 'A' }] },
  boost: { type: 'button', bindings: [{ key: 'ShiftLeft' }, { pad: 'X' }] },
  exit: { type: 'button', bindings: [{ key: 'KeyF' }, { pad: 'Y' }] }
});
const onFoot = new InputActionMap('onfoot', {
  move: {
    type: 'vector2',
    bindings: [{ keys2d: { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD' } }, { pad: 'LS' }]
  },
  // Pointer movement is already an amount per frame; stick deflection is a
  // rate, so it is scaled by the frame time. Both end up in radians.
  look: {
    type: 'vector2',
    unbounded: true,
    bindings: [
      { pointer: 'delta', scale: 0.003 },
      { pad: 'RS', scale: 2.5, perSecond: true }
    ]
  },
  enter: { type: 'button', bindings: [{ key: 'KeyF' }, { pad: 'Y' }] }
});
// While enabled, a blocking map hides every map below it.
const menu = new InputActionMap('menu', {}, { blocking: true });
const system = new InputActionMap('system', {
  pause: { type: 'button', bindings: [{ key: 'KeyP' }, { key: 'Escape' }, { pad: 'Start' }] }
});
onFoot.enabled = false;
menu.enabled = false;
// Later maps sit on top.
getInput().addActionMap(driving).addActionMap(onFoot).addActionMap(menu).addActionMap(system);
// #endregion maps

myApp.ready().then(async function () {
  await initPhysics(rapierPhysics);

  const scene = new Scene();
  const sun = new DirectionalLight(scene);
  sun.lookAt(new Vector3(-6, 10, 4), Vector3.zero(), Vector3.axisPY());
  sun.castShadow = true;
  sun.shadow.shadowRegion.setLimit(new AABB(new Vector3(-60, -2, -60), new Vector3(60, 10, 60)));

  const ground = new Mesh(scene, new PlaneShape({ size: 120 }), material(0.45, 0.5, 0.4));
  const groundCollider = new Collider();
  groundCollider.size = new Vector3(120, 0.2, 120);
  groundCollider.offset = new Vector3(0, -0.1, 0);
  ground.physics = new NodePhysics({ colliders: [groundCollider] });
  const crateMaterial = material(0.9, 0.6, 0.2);
  for (let i = 0; i < 6; i++) {
    const crate = new Mesh(scene, new BoxShape({ size: 0.8 }), crateMaterial);
    crate.position.setXYZ(8, 0.4 + Math.floor(i / 3) * 0.8, -2 + (i % 3) * 0.9);
    sun.shadow.shadowRegion.addDynamicCaster(crate);
    const body = new RigidBody();
    body.mass = 20;
    const collider = new Collider();
    collider.size = new Vector3(0.8, 0.8, 0.8);
    crate.physics = new NodePhysics({ body, colliders: [collider] });
  }

  // The car of the vehicle tutorial.
  const car = new Mesh(scene, new BoxShape({ size: 1.8, sizeY: 0.6, sizeZ: 4 }), material(0.75, 0.08, 0.1));
  car.position.setXYZ(0, 1.2, 0);
  sun.shadow.shadowRegion.addDynamicCaster(car);
  const body = new RigidBody();
  body.mass = 1200;
  body.linearDamping = 0.1;
  const shell = new Collider();
  shell.size = new Vector3(1.8, 0.6, 4);
  const vehicle = new Vehicle();
  vehicle.maxEngineForce = 6000;
  vehicle.maxSteerAngle = 30;
  car.physics = new NodePhysics({ body, colliders: [shell], vehicle });
  const tyre = new CylinderShape({ topRadius: 0.4, bottomRadius: 0.4, height: 0.3, anchor: 0.5 });
  const rubber = material(0.08, 0.08, 0.08);
  for (const front of [true, false]) {
    for (const side of [-1, 1]) {
      const node = new Mesh(scene, tyre, rubber);
      node.parent = car;
      node.position.setXYZ(side * 1.05, -0.4, front ? 1.3 : -1.3);
      node.rotation = Quaternion.fromAxisAngle(Vector3.axisPZ(), Math.PI / 2);
      sun.shadow.shadowRegion.addDynamicCaster(node);
      const wheel = new Wheel();
      wheel.radius = 0.4;
      wheel.suspensionRestLength = 0.3;
      wheel.steer = front ? 1 : 0;
      wheel.handbrake = front ? 0 : 1;
      wheel.drive = front ? 0 : 0.5;
      node.physics = new NodePhysics({ wheel });
    }
  }

  const camera = new PerspectiveCamera(scene, Math.PI / 3, 0.1, 500);
  scene.mainCamera = camera;
  // On foot: a free camera at eye height.
  const walker = { position: new Vector3(), yaw: 0, pitch: 0 };
  let inCar = true;
  let paused = false;

  // #region per-frame
  // Actions are evaluated once at the start of every frame, so any hook can
  // read them and all see the same values.
  myApp.on('tick', (deltaMs) => {
    const dt = Math.min(deltaMs, 100) / 1000;
    if (system.pressed('pause')) {
      paused = !paused;
      menu.enabled = paused;
      scene.physicsWorld.enabled = !paused;
      document.querySelector('#paused').style.display = paused ? 'flex' : 'none';
      if (paused) {
        getInput().exitPointerLock();
      }
    }
    if (inCar) {
      // Holding brake at a standstill reverses; while moving it brakes.
      const brake = driving.value('brake');
      const reversing = brake > 0 && vehicle.speed < 0.5;
      vehicle.throttle = reversing ? -0.5 * brake : driving.value('throttle');
      vehicle.brake = reversing ? 0 : brake;
      vehicle.handbrake = driving.isDown('handbrake');
      vehicle.steering = driving.value('steer');
      if (driving.pressed('exit') && Math.abs(vehicle.speed) < 2) {
        // Step out to the left of the car.
        const p = car.getWorldPosition();
        const left = car.worldMatrix.transformVectorAffine(new Vector3(1, 0, 0), new Vector3());
        walker.position.setXYZ(p.x + left.x * 2.5, 1.7, p.z + left.z * 2.5);
        const fwd = car.worldMatrix.transformVectorAffine(new Vector3(0, 0, 1), new Vector3());
        walker.yaw = Math.atan2(fwd.x, fwd.z);
        walker.pitch = 0;
        vehicle.throttle = vehicle.brake = vehicle.steering = 0;
        vehicle.handbrake = true;
        setMode(false);
      }
    } else {
      const look = onFoot.vector2('look');
      walker.yaw -= look.x;
      walker.pitch = Math.min(Math.max(walker.pitch + look.y, -1.4), 1.4);
      const move = onFoot.vector2('move');
      const sin = Math.sin(walker.yaw);
      const cos = Math.cos(walker.yaw);
      const speed = 5 * dt;
      // Forward is +Z rotated by yaw; right is -X rotated by yaw.
      walker.position.x += (sin * move.y - cos * move.x) * speed;
      walker.position.z += (cos * move.y + sin * move.x) * speed;
      const toCar = Vector3.distance(walker.position, car.getWorldPosition());
      if (onFoot.pressed('enter') && toCar < 4) {
        setMode(true);
      }
    }
  });

  // A one-off push must happen in exactly one physics step. A frame may run
  // several steps or none, so consume the press instead of reading pressed().
  scene.physicsWorld.on('fixedupdate', () => {
    if (driving.consumePressed('boost')) {
      const fwd = car.worldMatrix.transformVectorAffine(new Vector3(0, 0, 1), new Vector3());
      body.applyImpulse(fwd.scaleBy(4000));
    }
  });
  // #endregion per-frame

  function setMode(car) {
    inCar = car;
    driving.enabled = car;
    onFoot.enabled = !car;
    if (car) {
      getInput().exitPointerLock();
      vehicle.handbrake = false;
    }
  }
  // Mouse look needs the pointer locked; that needs a click.
  myApp.on('pointerdown', () => {
    if (!inCar && !paused && !getInput().pointerLocked) {
      getInput().requestPointerLock();
    }
  });

  // #region camera
  // The camera follows a physics body, so it is placed after physics has
  // stepped: in lateupdate, the car's pose is the one rendered this frame.
  const eye = new Vector3(0, 5, -9);
  scene.on('lateupdate', () => {
    const dt = Math.min(myApp.device.frameInfo.elapsedFrame, 100) / 1000;
    if (inCar) {
      const p = car.getWorldPosition();
      const back = car.worldMatrix.transformVectorAffine(new Vector3(0, 0, -1), new Vector3());
      back.y = 0;
      back.inplaceNormalize();
      const target = new Vector3(p.x + back.x * 9, p.y + 4, p.z + back.z * 9);
      const t = paused ? 0 : 1 - Math.exp(-4 * dt);
      eye.setXYZ(
        eye.x + (target.x - eye.x) * t,
        eye.y + (target.y - eye.y) * t,
        eye.z + (target.z - eye.z) * t
      );
      camera.lookAt(eye, new Vector3(p.x, p.y + 1, p.z), Vector3.axisPY());
    } else {
      const w = walker;
      const dir = new Vector3(
        Math.sin(w.yaw) * Math.cos(w.pitch),
        Math.sin(w.pitch),
        Math.cos(w.yaw) * Math.cos(w.pitch)
      );
      camera.lookAt(w.position, Vector3.add(w.position, dir), Vector3.axisPY());
      eye.set(w.position);
    }
  });
  // #endregion camera

  // HUD
  const fmt = (v) => (v >= 0 ? ' ' : '') + v.toFixed(2);
  myApp.on('tick', () => {
    const input = getInput();
    document.querySelector('#device').textContent = input.lastDevice ?? '-';
    document.querySelector('#map').textContent = paused ? 'menu' : inCar ? 'driving' : 'onfoot';
    document.querySelector('#speed').textContent = `${(vehicle.speed * 3.6).toFixed(0)} km/h`;
    const look = onFoot.vector2('look');
    const move = onFoot.vector2('move');
    document.querySelector('#values').textContent = [
      `throttle ${fmt(driving.value('throttle'))}`,
      `brake    ${fmt(driving.value('brake'))}`,
      `steer    ${fmt(driving.value('steer'))}`,
      `move     ${fmt(move.x)} ${fmt(move.y)}`,
      `look     ${fmt(look.x)} ${fmt(look.y)}`
    ].join('\n');
    const pad = input.lastDevice === 'gamepad';
    document.querySelector('#help').textContent = inCar
      ? pad
        ? 'RT/LT drive, LS steer, A handbrake, X boost, Y get out, Start pause.'
        : 'WASD drive, Space handbrake, Shift boost, F get out, P/Esc pause.'
      : pad
        ? 'LS move, RS look, Y get in near the car, Start pause.'
        : 'Click to capture the mouse. WASD move, mouse look, F get in near the car, P pause.';
  });

  getEngine().setRenderable(scene, 0);
  myApp.run();
});
