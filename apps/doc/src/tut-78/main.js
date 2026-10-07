import { AABB, Vector3, Vector4 } from '@zephyr3d/base';
import {
  Application,
  BoxShape,
  Collider,
  DirectionalLight,
  getEngine,
  getInput,
  Mesh,
  NodePhysics,
  OrbitCameraController,
  PBRMetallicRoughnessMaterial,
  PerspectiveCamera,
  RigidBody,
  Scene,
  SphereShape
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
  m.roughness = 0.6;
  return m;
}

const BALL_SPEED = 18;
const WIND = new Vector3(6, 0, 0);

myApp.ready().then(async function () {
  await initPhysics(rapierPhysics);

  const scene = new Scene();
  const sun = new DirectionalLight(scene);
  sun.lookAt(new Vector3(-6, 10, 4), Vector3.zero(), Vector3.axisPY());
  sun.castShadow = true;
  // Keep the shadow region on the 30 x 30 ground: bodies that fall off it would
  // otherwise drag the region down with them and thin out the shadow map.
  sun.shadow.shadowRegion.setLimit(new AABB(new Vector3(-15, -1, -15), new Vector3(15, 12, 15)));

  const ground = new Mesh(scene, new BoxShape({ size: 30, sizeY: 0.5, sizeZ: 30 }), material(0.5, 0.5, 0.5));
  ground.position.setXYZ(0, -0.25, 0);
  ground.castShadow = false;
  const groundCollider = new Collider();
  groundCollider.size = new Vector3(30, 0.5, 30);
  ground.physics = new NodePhysics({ colliders: [groundCollider] });

  const log = document.querySelector('#log');
  const crateShape = new BoxShape({ size: 0.8 });
  const crateMaterials = [material(0.9, 0.35, 0.15), material(0.15, 0.45, 0.9)];
  const crates = [];

  function buildWall() {
    for (const crate of crates) {
      crate.remove();
      crate.dispose();
    }
    crates.length = 0;
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 6; x++) {
        const crate = new Mesh(scene, crateShape, crateMaterials[(x + y) % 2]);
        crate.name = `crate ${x},${y}`;
        crate.position.setXYZ(-2 + x * 0.82, 0.4 + y * 0.81, -2);
        sun.shadow.shadowRegion.addDynamicCaster(crate);
        const collider = new Collider();
        collider.size = new Vector3(0.8, 0.8, 0.8);
        crate.physics = new NodePhysics({ body: new RigidBody(), colliders: [collider] });
        // #region events
        crate.physics.on('collisionenter', (ev) => {
          // Only hard knocks: resting contact has a small impulse.
          if (ev.impulse > 5 && ev.otherNode?.name === 'ball') {
            log.textContent = `${crate.name} hit by the ball, impulse ${ev.impulse.toFixed(1)} N·s`;
          }
        });
        // #endregion events
        crates.push(crate);
      }
    }
  }
  buildWall();

  const ballShape = new SphereShape({ radius: 0.25 });
  const ballMaterial = material(0.95, 0.8, 0.2);
  const balls = [];
  function shoot(ray) {
    const ball = new Mesh(scene, ballShape, ballMaterial);
    ball.name = 'ball';
    ball.position.set(Vector3.add(ray.origin, Vector3.scale(ray.direction, 1)));
    sun.shadow.shadowRegion.addDynamicCaster(ball);
    // #region shoot
    const body = new RigidBody();
    body.mass = 4;
    // Fast and small: keep it from passing through a crate between two steps.
    body.ccd = true;
    body.setLinearVelocity(Vector3.scale(ray.direction, BALL_SPEED));
    // #endregion shoot
    const collider = new Collider();
    collider.shape = 'sphere';
    collider.radius = 0.25;
    ball.physics = new NodePhysics({ body, colliders: [collider] });
    balls.push(ball);
    if (balls.length > 20) {
      const old = balls.shift();
      sun.shadow.shadowRegion.removeCaster(old);
      old.remove();
      old.dispose();
    }
  }

  const world = scene.physicsWorld;

  // #region raycast
  // Shift-click: ask the world what is under the pointer, and push it.
  function push(ray) {
    const hit = world.raycast(ray.origin, ray.direction, 100);
    if (hit?.body?.motionType === 'dynamic') {
      hit.body.applyImpulse(Vector3.scale(ray.direction, 15));
      log.textContent = `Pushed ${hit.node.name} at distance ${hit.distance.toFixed(2)} m`;
    } else if (hit) {
      log.textContent = `${hit.node.name || 'ground'} cannot be pushed`;
    }
  }
  // #endregion raycast

  // #region fixedupdate
  // Forces applied before each simulation step act on that step only, so the
  // wind is the same at any frame rate.
  const wind = /** @type {HTMLInputElement} */ (document.querySelector('#wind'));
  world.on('fixedupdate', () => {
    if (wind.checked) {
      for (const crate of crates) {
        const body = crate.physics.body;
        body.wakeUp();
        body.applyForce(WIND);
      }
    }
  });
  // #endregion fixedupdate
  const resetButton = /** @type {HTMLButtonElement} */ (document.querySelector('#reset'));
  resetButton.addEventListener('click', buildWall);

  const camera = new PerspectiveCamera(scene, Math.PI / 3, 0.1, 200);
  camera.lookAt(new Vector3(0, 3, 9), new Vector3(0, 1.5, -2), Vector3.axisPY());
  camera.controller = new OrbitCameraController({ center: new Vector3(0, 1.5, -2) });
  scene.mainCamera = camera;

  // A click that does not move shoots or pushes; a drag still orbits.
  let pressAt = null;
  getInput().use(function (ev, type) {
    if (type === 'pointerdown' && ev.button === 0) {
      pressAt = { x: ev.offsetX, y: ev.offsetY };
    } else if (type === 'pointerup' && ev.button === 0 && pressAt) {
      const moved = Math.hypot(ev.offsetX - pressAt.x, ev.offsetY - pressAt.y);
      pressAt = null;
      if (moved < 4) {
        const ray = camera.constructRay(ev.offsetX, ev.offsetY);
        if (ev.shiftKey) {
          push(ray);
        } else {
          shoot(ray);
        }
      }
    }
    return false;
  });
  getInput().use(camera.handleEvent, camera);

  getEngine().setRenderable(scene, 0);
  myApp.run();
});
