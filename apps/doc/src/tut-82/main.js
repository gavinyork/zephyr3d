import { AABB, Quaternion, Vector3, Vector4 } from '@zephyr3d/base';
import {
  Application,
  BoxShape,
  CapsuleShape,
  CharacterController,
  Collider,
  DirectionalLight,
  getEngine,
  getInput,
  Mesh,
  NodePhysics,
  PBRMetallicRoughnessMaterial,
  PerspectiveCamera,
  RigidBody,
  Scene
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

function block(scene, name, size, position, mat) {
  const mesh = new Mesh(scene, new BoxShape({ size: size.x, sizeY: size.y, sizeZ: size.z }), mat);
  mesh.name = name;
  mesh.position.set(position);
  const collider = new Collider();
  collider.size = size;
  mesh.physics = new NodePhysics({ colliders: [collider] });
  return mesh;
}

// Small dynamic props go on their own layer, which the camera probe skips:
// the camera passes through them instead of jumping in whenever one rolls by.
const LAYER_PROPS = 1;

const WALK_SPEED = 4;
const JUMP_SPEED = 5.5;
const GRAVITY = 9.81;

myApp.ready().then(async function () {
  await initPhysics(rapierPhysics);

  const scene = new Scene();
  const sun = new DirectionalLight(scene);
  sun.lookAt(new Vector3(-6, 10, 6), Vector3.zero(), Vector3.axisPY());
  sun.castShadow = true;
  sun.shadow.shadowRegion.setLimit(new AABB(new Vector3(-15, -1, -15), new Vector3(15, 8, 15)));
  const grey = material(0.55, 0.55, 0.55);
  const wallMaterial = material(0.4, 0.45, 0.55);
  block(scene, 'Ground', new Vector3(30, 0.5, 30), new Vector3(0, -0.25, 0), grey);

  // Walls, pillars and a low tunnel: places where a camera that ignored the
  // world would end up inside the geometry.
  const casters = [
    block(scene, 'Long wall', new Vector3(0.4, 3, 10), new Vector3(-3, 1.5, -2), wallMaterial),
    block(scene, 'Back wall', new Vector3(8, 3, 0.4), new Vector3(2, 1.5, -7), wallMaterial),
    // The tunnel: two side walls and a roof 2.2 m up.
    block(scene, 'Tunnel wall', new Vector3(0.4, 2.2, 6), new Vector3(4, 1.1, 2), wallMaterial),
    block(scene, 'Tunnel wall', new Vector3(0.4, 2.2, 6), new Vector3(6.4, 1.1, 2), wallMaterial),
    block(scene, 'Tunnel roof', new Vector3(2.8, 0.3, 6), new Vector3(5.2, 2.35, 2), wallMaterial)
  ];
  for (let i = 0; i < 5; i++) {
    casters.push(
      block(scene, `Pillar ${i + 1}`, new Vector3(0.6, 3, 0.6), new Vector3(-8 + i * 1.6, 1.5, 4), grey)
    );
  }
  for (const c of casters) {
    sun.shadow.shadowRegion.addDynamicCaster(c);
  }

  const crateShape = new BoxShape({ size: 0.7 });
  for (let i = 0; i < 4; i++) {
    const crate = new Mesh(scene, crateShape, material(0.9, 0.6, 0.2));
    crate.position.setXYZ(-0.5 + i * 0.9, 0.35, 5);
    sun.shadow.shadowRegion.addDynamicCaster(crate);
    const body = new RigidBody();
    body.mass = 10;
    const collider = new Collider();
    collider.size = new Vector3(0.7, 0.7, 0.7);
    collider.layer = LAYER_PROPS;
    crate.physics = new NodePhysics({ body, colliders: [collider] });
  }

  const hero = new Mesh(
    scene,
    new CapsuleShape({ radius: 0.3, height: 1.2, anchor: 0 }),
    material(0.3, 0.75, 0.35)
  );
  hero.position.setXYZ(0, 0, 8);
  sun.shadow.shadowRegion.addDynamicCaster(hero);
  const controller = new CharacterController();
  controller.height = 1.8;
  controller.radius = 0.3;
  hero.physics = new NodePhysics({ character: controller });

  // Orbit angles of the camera around the character, and the arm length.
  let yaw = 0;
  let pitch = 0.35;
  let armLength = 5;
  let dragging = false;
  // Looking down: positive. The third person camera stays above the ground.
  function clampPitch(value) {
    const first = viewSelect.value === 'first';
    return Math.min(first ? 1.4 : 1.3, Math.max(first ? -1.4 : -0.6, value));
  }
  const keys = new Set();
  let jump = false;
  getInput().use(function (ev, type) {
    if (type === 'pointerdown' && ev.button === 0) {
      dragging = true;
      return true;
    } else if (type === 'pointerup' && ev.button === 0) {
      dragging = false;
      return true;
    } else if (type === 'pointermove' && dragging) {
      yaw -= ev.movementX * 0.005;
      pitch = clampPitch(pitch + ev.movementY * 0.005);
      return true;
    } else if (type === 'wheel') {
      armLength = Math.min(12, Math.max(1.5, armLength * Math.exp(ev.deltaY * 0.001)));
      return true;
    } else if (type === 'keydown') {
      const key = ev.key.toLowerCase();
      keys.add(key);
      if (key === ' ') {
        jump = true;
      }
      return true;
    } else if (type === 'keyup') {
      keys.delete(ev.key.toLowerCase());
      return true;
    }
    return false;
  });

  // Walking as in the character controller example, but relative to the camera.
  let vy = 0;
  const world = scene.physicsWorld;
  world.on('fixedupdate', (dt) => {
    const right = (keys.has('d') ? 1 : 0) - (keys.has('a') ? 1 : 0);
    const forward = (keys.has('w') ? 1 : 0) - (keys.has('s') ? 1 : 0);
    const len = Math.hypot(right, forward) || 1;
    const sin = Math.sin(yaw);
    const cos = Math.cos(yaw);
    const x = (right * cos - forward * sin) / len;
    const z = (-right * sin - forward * cos) / len;
    if (controller.isGrounded) {
      vy = jump ? JUMP_SPEED : -1;
    } else {
      vy -= GRAVITY * dt;
    }
    jump = false;
    controller.move(new Vector3(x * WALK_SPEED * dt, vy * dt, z * WALK_SPEED * dt));
  });

  const viewSelect = /** @type {HTMLSelectElement} */ (document.querySelector('#view'));
  viewSelect.addEventListener('change', () => {
    pitch = clampPitch(pitch);
  });
  const collisionCheck = /** @type {HTMLInputElement} */ (document.querySelector('#collision'));
  const probeSlider = /** @type {HTMLInputElement} */ (document.querySelector('#probe'));
  const probeValue = document.querySelector('#probe-value');
  const status = document.querySelector('#status');
  probeSlider.addEventListener('input', () => {
    probeValue.textContent = Number(probeSlider.value).toFixed(2);
  });
  const camera = new PerspectiveCamera(scene, Math.PI / 3, 0.05, 200);
  scene.mainCamera = camera;

  const probeMask = ~(1 << LAYER_PROPS);
  const noRotation = Quaternion.identity();
  /**
   * Sweeps the probe sphere from `from` along the unit vector `dir`, skipping
   * the character and the props layer. Returns how far it got and what stopped it.
   */
  function sweep(from, dir, length) {
    if (!collisionCheck.checked || length <= 0) {
      return { distance: length, hit: null };
    }
    const radius = Number(probeSlider.value);
    const hit = world.shapeCast({ type: 'sphere', radius }, from, noRotation, dir, length, {
      exclude: hero.physics,
      layerMask: probeMask
    });
    // `distance` is how far the sphere's centre travelled, so the centre where
    // it touched is `from + dir * distance`; `hit.point` is on the wall's surface.
    return hit ? { distance: hit.distance, hit } : { distance: length, hit: null };
  }
  /** Unit vector pointing back from where the camera looks, for the current yaw and pitch. */
  function backward() {
    return new Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
  }

  // #region springarm
  // A spring arm, as UE's USpringArmComponent::UpdateDesiredArmLocation does it:
  // - the arm's origin is a point on the character, smoothed with VInterpTo so
  //   the camera trails behind when it moves (the lag is on the origin, so
  //   turning the camera is not delayed);
  // - the wanted camera position is the origin moved back along the view
  //   direction by the arm length;
  // - a small sphere is swept from the origin to that position; if it hits,
  //   the camera goes where the sphere stopped, so it is never inside or right
  //   against a wall.
  const LAG_SPEED = 10;
  const origin = new Vector3(hero.position.x, hero.position.y + 1.5, hero.position.z);
  function thirdPerson(dt) {
    // VInterpTo: cover dt * speed of the remaining way, at most all of it.
    const t = Math.min(1, dt * LAG_SPEED);
    origin.setXYZ(
      origin.x + (hero.position.x - origin.x) * t,
      origin.y + (hero.position.y + 1.5 - origin.y) * t,
      origin.z + (hero.position.z - origin.z) * t
    );
    const back = backward();
    const result = sweep(origin, back, armLength);
    const eye = Vector3.add(origin, Vector3.scale(back, result.distance), new Vector3());
    camera.lookAt(eye, origin, Vector3.axisPY());
    return { ...result, length: armLength };
  }
  // #endregion springarm

  // #region firstperson
  // In first person the eye is inside the character's capsule, and the capsule
  // already keeps it a radius (0.3 m) from every wall: far more than the near
  // plane (0.05 m) needs, so walking and looking around need no test.
  // Leaning out (Q / E) moves the eye out of the capsule. That move is swept
  // like the spring arm, from the head sideways, so the eye stops at a wall
  // instead of going into it.
  const EYE_HEIGHT = 1.6;
  const LEAN_DISTANCE = 0.6;
  const LEAN_ROLL = 0.25; // radians of head tilt at a full lean
  const LEAN_SPEED = 8;
  let lean = 0; // -1 (left) to 1 (right), eased towards the keys held
  function firstPerson(dt) {
    const wanted = (keys.has('e') ? 1 : 0) - (keys.has('q') ? 1 : 0);
    lean += (wanted - lean) * Math.min(1, dt * LEAN_SPEED);
    const head = new Vector3(hero.position.x, hero.position.y + EYE_HEIGHT, hero.position.z);
    const side = lean < 0 ? -1 : 1;
    const right = new Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const leanDir = Vector3.scale(right, side, new Vector3());
    const result = sweep(head, leanDir, Math.abs(lean) * LEAN_DISTANCE);
    const eye = Vector3.add(head, Vector3.scale(leanDir, result.distance), new Vector3());
    // Tilt the head with how far it actually leaned.
    const roll = ((side * result.distance) / LEAN_DISTANCE) * LEAN_ROLL;
    const up = Vector3.add(
      Vector3.scale(Vector3.axisPY(), Math.cos(roll)),
      Vector3.scale(right, Math.sin(roll)),
      new Vector3()
    );
    camera.lookAt(eye, Vector3.sub(eye, backward(), new Vector3()), up);
    return { ...result, length: Math.abs(lean) * LEAN_DISTANCE };
  }
  // #endregion firstperson

  myApp.on('tick', () => {
    const dt = Math.min(myApp.device.frameInfo.elapsedFrame * 0.001, 0.1);
    const first = viewSelect.value === 'first';
    // Inside the capsule the character's own mesh is only in the way.
    hero.showState = first ? 'hidden' : 'visible';
    const { distance, hit, length } = first ? firstPerson(dt) : thirdPerson(dt);
    const what = first ? 'Lean' : 'Arm';
    if (hit) {
      const p = hit.point;
      status.textContent = `${what} ${distance.toFixed(2)} m, blocked by ${hit.node.name || '(unnamed)'} at ${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}`;
    } else {
      status.textContent = `${what} free, ${length.toFixed(2)} m`;
    }
  });

  getEngine().setRenderable(scene, 0);
  myApp.run();
});
