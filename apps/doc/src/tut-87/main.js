import { AABB, Quaternion, Vector3, Vector4 } from '@zephyr3d/base';
import {
  Application,
  BoxShape,
  CapsuleShape,
  CharacterController,
  Collider,
  CylinderShape,
  DirectionalLight,
  FollowCameraController,
  getEngine,
  getInput,
  InputActionMap,
  Mesh,
  NodePhysics,
  PBRMetallicRoughnessMaterial,
  PerspectiveCamera,
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

function block(scene, size, position, mat) {
  const mesh = new Mesh(scene, new BoxShape({ size: size.x, sizeY: size.y, sizeZ: size.z }), mat);
  mesh.position.set(position);
  const collider = new Collider();
  collider.size = size;
  mesh.physics = new NodePhysics({ colliders: [collider] });
  return mesh;
}

// Small dynamic props go on their own layer, which the camera ignores: it
// passes through them instead of jumping in whenever one rolls by.
const LAYER_PROPS = 1;

// Pointer movement is an amount per frame, stick deflection a rate: scaled by
// the frame time, both end up in radians.
const look = {
  type: 'vector2',
  unbounded: true,
  bindings: [
    { pointer: 'delta', scale: 0.003 },
    { pad: 'RS', scale: 2.5, perSecond: true }
  ]
};
const zoom = {
  type: 'axis',
  unbounded: true,
  bindings: [
    { wheel: 'y', scale: 0.001 },
    { pad: 'DPadDown', scale: 1.5, perSecond: true },
    { pad: 'DPadUp', scale: -1.5, perSecond: true }
  ]
};
const onFoot = new InputActionMap('onfoot', {
  move: {
    type: 'vector2',
    bindings: [{ keys2d: { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD' } }, { pad: 'LS' }]
  },
  jump: { type: 'button', bindings: [{ key: 'Space' }, { pad: 'A' }] },
  enter: { type: 'button', bindings: [{ key: 'KeyF' }, { pad: 'Y' }] },
  look,
  zoom
});
const driving = new InputActionMap('driving', {
  throttle: { type: 'axis', bindings: [{ key: 'KeyW' }, { pad: 'RT' }] },
  brake: { type: 'axis', bindings: [{ key: 'KeyS' }, { pad: 'LT' }] },
  steer: { type: 'axis', bindings: [{ keys: ['KeyA', 'KeyD'] }, { pad: 'LS.x', invert: true }] },
  handbrake: { type: 'button', bindings: [{ key: 'Space' }, { pad: 'A' }] },
  exit: { type: 'button', bindings: [{ key: 'KeyF' }, { pad: 'Y' }] },
  look,
  zoom
});
driving.enabled = false;
getInput().addActionMap(onFoot).addActionMap(driving);

myApp.ready().then(async function () {
  await initPhysics(rapierPhysics);

  const scene = new Scene();
  const sun = new DirectionalLight(scene);
  sun.lookAt(new Vector3(-6, 10, 6), Vector3.zero(), Vector3.axisPY());
  sun.castShadow = true;
  sun.shadow.shadowRegion.setLimit(new AABB(new Vector3(-30, -1, -30), new Vector3(30, 8, 30)));
  const grey = material(0.55, 0.55, 0.55);
  const wallMaterial = material(0.4, 0.45, 0.55);
  block(scene, new Vector3(60, 0.5, 60), new Vector3(0, -0.25, 0), grey);

  // Walls, pillars and a tunnel the car fits through: places where a camera
  // that ignored the world would end up inside the geometry.
  const casters = [
    block(scene, new Vector3(0.4, 3, 10), new Vector3(-3, 1.5, -2), wallMaterial),
    block(scene, new Vector3(8, 3, 0.4), new Vector3(2, 1.5, -7), wallMaterial),
    block(scene, new Vector3(0.4, 2.6, 10), new Vector3(8, 1.3, 6), wallMaterial),
    block(scene, new Vector3(0.4, 2.6, 10), new Vector3(12, 1.3, 6), wallMaterial),
    block(scene, new Vector3(4.4, 0.3, 10), new Vector3(10, 2.75, 6), wallMaterial)
  ];
  for (let i = 0; i < 5; i++) {
    casters.push(block(scene, new Vector3(0.6, 3, 0.6), new Vector3(-8 + i * 1.6, 1.5, 4), grey));
  }
  for (const c of casters) {
    sun.shadow.shadowRegion.addDynamicCaster(c);
  }
  for (let i = 0; i < 4; i++) {
    const crate = new Mesh(scene, new BoxShape({ size: 0.7 }), material(0.9, 0.6, 0.2));
    crate.position.setXYZ(-0.5 + i * 0.9, 0.35, 5);
    sun.shadow.shadowRegion.addDynamicCaster(crate);
    const body = new RigidBody();
    body.mass = 10;
    const collider = new Collider();
    collider.size = new Vector3(0.7, 0.7, 0.7);
    collider.layer = LAYER_PROPS;
    crate.physics = new NodePhysics({ body, colliders: [collider] });
  }

  // The character: a capsule moved by a character controller.
  const hero = new Mesh(
    scene,
    new CapsuleShape({ radius: 0.3, height: 1.2, anchor: 0 }),
    material(0.3, 0.75, 0.35)
  );
  hero.position.setXYZ(0, 0, 10);
  sun.shadow.shadowRegion.addDynamicCaster(hero);
  // Clearing node.physics disposes the controller, so a new one is made each
  // time the character steps out of the car.
  function newCharacter() {
    const c = new CharacterController();
    c.height = 1.8;
    c.radius = 0.3;
    hero.physics = new NodePhysics({ character: c });
    return c;
  }
  let character = newCharacter();

  // The car of the vehicle tutorial.
  const car = new Mesh(scene, new BoxShape({ size: 1.8, sizeY: 0.6, sizeZ: 4 }), material(0.75, 0.08, 0.1));
  car.position.setXYZ(10, 1.2, 16);
  car.rotation = Quaternion.fromAxisAngle(Vector3.axisPY(), Math.PI);
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

  // #region camera
  // Settings per target. On foot the player turns the camera freely; in the
  // car it swings back behind the car once the player stops turning it.
  const walkView = {
    mode: 'free',
    pivotOffset: new Vector3(0, 1.5, 0),
    armLength: 4.5,
    positionLag: 12,
    minPitch: -0.6,
    fovBoost: null
  };
  const driveView = {
    mode: 'chase',
    pivotOffset: new Vector3(0, 1, 0),
    armLength: 7,
    positionLag: 8,
    chasePitch: 0.25,
    minPitch: -0.3,
    fovBoost: { maxBoost: Math.PI / 12, maxSpeed: 30 }
  };
  const camera = new PerspectiveCamera(scene, Math.PI / 3, 0.05, 300);
  scene.mainCamera = camera;
  const follow = new FollowCameraController(hero, { ...walkView, collisionMask: ~(1 << LAYER_PROPS) });
  camera.controller = follow;
  // #endregion camera

  // #region switch
  let inCar = false;
  function setInCar(value) {
    inCar = value;
    onFoot.enabled = !value;
    driving.enabled = value;
    if (value) {
      hero.showState = 'hidden';
      hero.physics = null;
      vehicle.handbrake = false;
    } else {
      // Step out to the car's left.
      const p = car.getWorldPosition();
      const left = car.worldMatrix.transformVectorAffine(new Vector3(1, 0, 0), new Vector3());
      hero.position.setXYZ(p.x + left.x * 2.5, 0.1, p.z + left.z * 2.5);
      hero.showState = 'inherit';
      character = newCharacter();
      vehicle.throttle = vehicle.brake = vehicle.steering = 0;
      vehicle.handbrake = true;
    }
    // Ease from the current view to the new target's.
    follow.setTarget(value ? car : hero, { blendTime: 0.6, options: value ? driveView : walkView });
  }
  // #endregion switch

  // #region input
  let vy = 0;
  let jump = false;
  myApp.on('tick', () => {
    const map = inCar ? driving : onFoot;
    const l = map.vector2('look');
    follow.addLookInput(l.x, l.y);
    follow.addZoomInput(map.value('zoom'));
    if (inCar) {
      const brake = driving.value('brake');
      const reversing = brake > 0 && vehicle.speed < 0.5;
      vehicle.throttle = reversing ? -0.5 * brake : driving.value('throttle');
      vehicle.brake = reversing ? 0 : brake;
      vehicle.handbrake = driving.isDown('handbrake');
      vehicle.steering = driving.value('steer');
      if (driving.pressed('exit') && Math.abs(vehicle.speed) < 2) {
        setInCar(false);
      }
    } else {
      jump ||= onFoot.pressed('jump');
      if (onFoot.pressed('enter') && Vector3.distance(hero.position, car.getWorldPosition()) < 4) {
        setInCar(true);
      }
    }
  });
  // Walking, relative to the direction the camera looks.
  scene.physicsWorld.on('fixedupdate', (dt) => {
    if (inCar) {
      return;
    }
    const move = onFoot.vector2('move');
    const sin = Math.sin(follow.yaw);
    const cos = Math.cos(follow.yaw);
    const x = move.x * cos - move.y * sin;
    const z = -move.x * sin - move.y * cos;
    if (character.isGrounded) {
      vy = jump ? 5.5 : -1;
    } else {
      vy -= 9.81 * dt;
    }
    jump = false;
    character.move(new Vector3(x * 4 * dt, vy * dt, z * 4 * dt));
  });
  // #endregion input

  // Mouse look needs the pointer locked; that needs a click.
  myApp.on('pointerdown', () => {
    if (!getInput().pointerLocked) {
      getInput().requestPointerLock();
    }
  });
  const collisionCheck = document.querySelector('#collision');
  collisionCheck.addEventListener('change', () => {
    follow.options.collisionMask = collisionCheck.checked ? ~(1 << LAYER_PROPS) : 0;
  });
  myApp.on('tick', () => {
    const pad = getInput().lastDevice === 'gamepad';
    document.querySelector('#mode').textContent = inCar ? 'car (chase)' : 'character (free)';
    document.querySelector('#distance').textContent = `${follow.distance.toFixed(2)} m`;
    document.querySelector('#speed').textContent = `${(follow.targetSpeed * 3.6).toFixed(0)} km/h`;
    document.querySelector('#fov').textContent = `${((camera.fovY * 180) / Math.PI).toFixed(1)}°`;
    document.querySelector('#help').textContent = inCar
      ? pad
        ? 'RT/LT drive, LS steer, RS look, D-pad zoom, Y get out.'
        : 'WASD drive, mouse look, wheel zoom, F get out.'
      : pad
        ? 'LS walk, RS look, A jump, D-pad zoom, Y get in near the car.'
        : 'Click to capture the mouse. WASD walk, mouse look, wheel zoom, Space jump, F get in near the car.';
  });

  getEngine().setRenderable(scene, 0);
  myApp.run();
});
