import { Quaternion, Vector3, Vector4 } from '@zephyr3d/base';
import {
  Application,
  BoundingBox,
  BoxShape,
  CylinderShape,
  DirectionalLight,
  getEngine,
  getInput,
  Mesh,
  PBRMetallicRoughnessMaterial,
  PerspectiveCamera,
  Primitive,
  Scene
} from '@zephyr3d/scene';
import { Collider, initPhysics, RigidBody, Vehicle, Wheel } from '@zephyr3d/physics';
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

/** Bumpy ground, 120 m square, flat in the middle. */
function bumpyGround() {
  const n = 120;
  const size = 120;
  const positions = [];
  const normals = [];
  const indices = [];
  const h = (x, z) => {
    const r = Math.hypot(x, z);
    const amount = Math.min(1, Math.max(0, (r - 12) / 10));
    return amount * (0.35 * Math.sin(0.45 * x) * Math.cos(0.38 * z) + 0.15 * Math.sin(1.3 * x + 0.7 * z));
  };
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const x = (i / n - 0.5) * size;
      const z = (j / n - 0.5) * size;
      positions.push(x, h(x, z), z);
      const e = 0.05;
      const dx = (h(x + e, z) - h(x - e, z)) / (2 * e);
      const dz = (h(x, z + e) - h(x, z - e)) / (2 * e);
      const len = Math.hypot(dx, 1, dz);
      normals.push(-dx / len, 1 / len, -dz / len);
    }
  }
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * (n + 1) + i;
      indices.push(a, a + n + 1, a + 1, a + 1, a + n + 1, a + n + 2);
    }
  }
  const prim = new Primitive();
  prim.createAndSetVertexBuffer('position_f32x3', new Float32Array(positions));
  prim.createAndSetVertexBuffer('normal_f32x3', new Float32Array(normals));
  prim.createAndSetIndexBuffer(new Uint16Array(indices));
  prim.setBoundingVolume(
    new BoundingBox(new Vector3(-size / 2, -1, -size / 2), new Vector3(size / 2, 1, size / 2))
  );
  prim.indexCount = indices.length;
  return prim;
}

myApp.ready().then(async function () {
  await initPhysics();

  const scene = new Scene();
  const sun = new DirectionalLight(scene);
  sun.lookAt(new Vector3(-6, 10, 4), Vector3.zero(), Vector3.axisPY());
  sun.castShadow = true;

  const ground = new Mesh(scene, bumpyGround(), material(0.45, 0.5, 0.4));
  const groundCollider = new Collider();
  groundCollider.shape = 'mesh';
  ground.addComponent(groundCollider);

  // Ramps and a row of crates to knock over.
  const rampMaterial = material(0.4, 0.45, 0.55);
  for (const [x, z, angle] of [
    [0, 14, -0.18],
    [-8, -6, -0.25]
  ]) {
    const ramp = new Mesh(scene, new BoxShape({ size: 4, sizeY: 0.4, sizeZ: 8 }), rampMaterial);
    ramp.position.setXYZ(x, 0.6, z);
    ramp.rotation = Quaternion.fromAxisAngle(Vector3.axisPX(), angle);
    const collider = new Collider();
    collider.size = new Vector3(4, 0.4, 8);
    ramp.addComponent(collider);
  }
  const crateShape = new BoxShape({ size: 0.8 });
  const crateMaterial = material(0.9, 0.6, 0.2);
  for (let i = 0; i < 6; i++) {
    const crate = new Mesh(scene, crateShape, crateMaterial);
    crate.position.setXYZ(8, 0.4 + Math.floor(i / 3) * 0.8, -2 + (i % 3) * 0.9);
    const body = new RigidBody();
    body.mass = 20;
    crate.addComponent(body);
    const collider = new Collider();
    collider.size = new Vector3(0.8, 0.8, 0.8);
    crate.addComponent(collider);
  }

  // #region car
  // The car body: a dynamic rigid body with a box collider, and the Vehicle
  // that drives it. Its front is +Z, its up +Y.
  const car = new Mesh(scene, new BoxShape({ size: 1.8, sizeY: 0.6, sizeZ: 4 }), material(0.75, 0.08, 0.1));
  car.position.setXYZ(0, 1.2, 0);
  const body = new RigidBody();
  body.mass = 1200;
  body.linearDamping = 0.1;
  car.addComponent(body);
  const shell = new Collider();
  shell.size = new Vector3(1.8, 0.6, 4);
  car.addComponent(shell);
  const vehicle = new Vehicle();
  vehicle.maxEngineForce = 6000;
  vehicle.maxSteerAngle = 30;
  car.addComponent(vehicle);
  // #endregion car

  // #region wheels
  // Each wheel is a child node placed where the wheel's centre is with the
  // suspension at rest. The vehicle moves it with the suspension, steering and
  // roll; a cylinder lies on its side, so its axis is the axle.
  const tyre = new CylinderShape({ topRadius: 0.4, bottomRadius: 0.4, height: 0.3, anchor: 0.5 });
  const rubber = material(0.08, 0.08, 0.08);
  const wheels = [];
  for (const front of [true, false]) {
    for (const side of [-1, 1]) {
      const node = new Mesh(scene, tyre, rubber);
      node.parent = car;
      node.position.setXYZ(side * 1.05, -0.4, front ? 1.3 : -1.3);
      node.rotation = Quaternion.fromAxisAngle(Vector3.axisPZ(), Math.PI / 2);
      const wheel = new Wheel();
      wheel.radius = 0.4;
      wheel.suspensionRestLength = 0.3;
      wheel.steer = front ? 1 : 0;
      wheel.handbrake = front ? 0 : 1;
      node.addComponent(wheel);
      wheels.push({ wheel, front });
    }
  }
  // #endregion wheels

  // #region drive
  // Which wheels push: shares of the engine force.
  function setDrive(mode) {
    for (const { wheel, front } of wheels) {
      wheel.drive = mode === 'all' ? 0.25 : (mode === 'front') === front ? 0.5 : 0;
    }
  }
  // #endregion drive
  const driveSelect = document.querySelector('#drive');
  setDrive(driveSelect.value);
  driveSelect.addEventListener('change', () => setDrive(driveSelect.value));

  // #region input
  const keys = new Set();
  getInput().use(function (ev, type) {
    if (type === 'keydown') {
      keys.add(ev.code);
    } else if (type === 'keyup') {
      keys.delete(ev.code);
    }
    return false;
  });
  myApp.on('tick', () => {
    const forward = keys.has('KeyW') || keys.has('ArrowUp');
    const back = keys.has('KeyS') || keys.has('ArrowDown');
    // Holding back at a standstill reverses; while moving it brakes.
    const reversing = back && vehicle.speed < 0.5;
    vehicle.throttle = forward ? 1 : reversing ? -0.5 : 0;
    vehicle.brake = back && !reversing ? 1 : 0;
    vehicle.handbrake = keys.has('Space');
    // Positive steering turns left.
    vehicle.steering =
      (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0) -
      (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0);
  });
  // #endregion input

  document.querySelector('#reset').addEventListener('click', () => {
    // Moving the node teleports the body; clear its motion too.
    car.position.setXYZ(0, 1.2, 0);
    car.rotation = Quaternion.identity();
    body.setLinearVelocity(Vector3.zero());
    body.setAngularVelocity(Vector3.zero());
  });

  // Chase camera: behind and above the car, smoothed.
  const camera = new PerspectiveCamera(scene, Math.PI / 3, 0.1, 500);
  scene.mainCamera = camera;
  const eye = new Vector3(0, 5, -9);
  const speedLabel = document.querySelector('#speed');
  const contactLabel = document.querySelector('#contact');
  myApp.on('tick', (deltaMs) => {
    const dt = Math.min(deltaMs, 100) / 1000;
    const p = car.getWorldPosition();
    const back = car.worldMatrix.transformVectorAffine(new Vector3(0, 0, -1), new Vector3());
    back.y = 0;
    back.inplaceNormalize();
    const target = new Vector3(p.x + back.x * 9, p.y + 4, p.z + back.z * 9);
    const t = 1 - Math.exp(-4 * dt);
    eye.setXYZ(
      eye.x + (target.x - eye.x) * t,
      eye.y + (target.y - eye.y) * t,
      eye.z + (target.z - eye.z) * t
    );
    camera.lookAt(eye, new Vector3(p.x, p.y + 1, p.z), Vector3.axisPY());
    speedLabel.textContent = `${(vehicle.speed * 3.6).toFixed(0)} km/h`;
    contactLabel.textContent = wheels.map(({ wheel }) => (wheel.inContact ? '●' : '○')).join(' ');
  });

  getEngine().setRenderable(scene, 0);
  myApp.run();
});
