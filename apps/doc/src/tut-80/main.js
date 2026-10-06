import { Quaternion, Vector3, Vector4 } from '@zephyr3d/base';
import {
  Application,
  BoxShape,
  CapsuleShape,
  DirectionalLight,
  getEngine,
  getInput,
  Mesh,
  PBRMetallicRoughnessMaterial,
  PerspectiveCamera,
  Scene
} from '@zephyr3d/scene';
import { CharacterController, Collider, initPhysics, PhysicsWorld, RigidBody } from '@zephyr3d/physics';
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
  m.roughness = 0.6;
  return m;
}

function block(scene, size, position, mat, rotation) {
  const mesh = new Mesh(scene, new BoxShape({ size: size.x, sizeY: size.y, sizeZ: size.z }), mat);
  mesh.position.set(position);
  if (rotation) {
    mesh.rotation = rotation;
  }
  const collider = new Collider();
  collider.size = size;
  mesh.addComponent(collider);
  return mesh;
}

const WALK_SPEED = 4;
const JUMP_SPEED = 5.5;
const GRAVITY = 9.81;

myApp.ready().then(async function () {
  await initPhysics();

  const scene = new Scene();
  const sun = new DirectionalLight(scene);
  sun.lookAt(new Vector3(-6, 10, 6), Vector3.zero(), Vector3.axisPY());
  sun.castShadow = true;
  const grey = material(0.55, 0.55, 0.55);
  block(scene, new Vector3(30, 0.5, 30), new Vector3(0, -0.25, 0), grey);

  // Steps 0.25 m high: the character walks up them (stepHeight is 0.3).
  for (let i = 0; i < 4; i++) {
    block(scene, new Vector3(1, 0.25 * (i + 1), 3), new Vector3(3 + i, 0.125 * (i + 1), -3), grey);
  }
  // A 0.5 m ledge: too high to step onto, it has to be jumped.
  block(scene, new Vector3(3, 0.5, 3), new Vector3(-4, 0.25, -3), material(0.4, 0.45, 0.55));
  // A 25° ramp it walks up, and a 55° one it slides down.
  block(
    scene,
    new Vector3(4, 0.2, 3),
    new Vector3(3, 0.8, 3),
    grey,
    Quaternion.fromAxisAngle(Vector3.axisPZ(), (25 * Math.PI) / 180)
  );
  block(
    scene,
    new Vector3(3, 0.2, 3),
    new Vector3(-4, 1.1, 3),
    material(0.6, 0.35, 0.3),
    Quaternion.fromAxisAngle(Vector3.axisPZ(), (-55 * Math.PI) / 180)
  );
  // Loose crates to push around.
  const crateShape = new BoxShape({ size: 0.7 });
  for (let i = 0; i < 4; i++) {
    const crate = new Mesh(scene, crateShape, material(0.9, 0.6, 0.2));
    crate.position.setXYZ(-1 + i * 0.9, 0.35, 1.5);
    const body = new RigidBody();
    body.mass = 10;
    crate.addComponent(body);
    const collider = new Collider();
    collider.size = new Vector3(0.7, 0.7, 0.7);
    crate.addComponent(collider);
  }

  // #region controller
  // The character brings its own capsule: no RigidBody or Collider needed. Its
  // node's origin is at the feet.
  const hero = new Mesh(
    scene,
    new CapsuleShape({ radius: 0.3, height: 1.2, anchor: 0 }),
    material(0.3, 0.75, 0.35)
  );
  hero.position.setXYZ(0, 0, 4);
  const controller = new CharacterController();
  controller.height = 1.8;
  controller.radius = 0.3;
  hero.addComponent(controller);
  // #endregion controller

  const keys = new Set();
  let jump = false;
  getInput().use(function (ev, type) {
    if (type === 'keydown') {
      const key = ev.key.toLowerCase();
      keys.add(key);
      if (key === ' ') {
        jump = true;
      }
    } else if (type === 'keyup') {
      keys.delete(ev.key.toLowerCase());
    }
    return false;
  });

  // #region move
  // Moving from the world's fixed update makes the walk the same at any frame
  // rate. Gravity is the game's to apply: the controller only moves where it
  // is told, sliding along walls, climbing steps and slopes, and staying on
  // the ground.
  let vy = 0;
  const world = PhysicsWorld.get(scene);
  world.on('fixedupdate', (dt) => {
    const x =
      (keys.has('d') || keys.has('arrowright') ? 1 : 0) - (keys.has('a') || keys.has('arrowleft') ? 1 : 0);
    const z =
      (keys.has('s') || keys.has('arrowdown') ? 1 : 0) - (keys.has('w') || keys.has('arrowup') ? 1 : 0);
    const len = Math.hypot(x, z) || 1;
    if (controller.isGrounded) {
      // A small downward speed keeps it pressed to the ground, so it slides
      // down slopes that are too steep.
      vy = jump ? JUMP_SPEED : -1;
    } else {
      vy -= GRAVITY * dt;
    }
    jump = false;
    controller.move(new Vector3((x / len) * WALK_SPEED * dt, vy * dt, (z / len) * WALK_SPEED * dt));
  });
  // #endregion move

  const status = document.querySelector('#status');
  const camera = new PerspectiveCamera(scene, Math.PI / 3, 0.1, 200);
  scene.mainCamera = camera;
  myApp.on('tick', () => {
    // Follow from above and behind.
    const p = hero.position;
    camera.lookAt(new Vector3(p.x, p.y + 5, p.z + 8), new Vector3(p.x, p.y + 1, p.z), Vector3.axisPY());
    status.textContent = controller.isGrounded ? 'On the ground' : 'In the air';
  });

  getEngine().setRenderable(scene, 0);
  myApp.run();
});
