import { Quaternion, Vector3, Vector4 } from '@zephyr3d/base';
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

const COLORS = [
  [0.9, 0.35, 0.15],
  [0.15, 0.45, 0.9],
  [0.95, 0.8, 0.2],
  [0.3, 0.75, 0.35]
];

myApp.ready().then(async function () {
  // #region init
  // Loads the physics engine (a WebAssembly module). From then on, scenes
  // simulate the physics data of their nodes.
  await initPhysics(rapierPhysics);
  // #endregion init

  const scene = new Scene();
  const sun = new DirectionalLight(scene);
  sun.lookAt(new Vector3(-6, 10, 4), Vector3.zero(), Vector3.axisPY());
  sun.castShadow = true;

  // #region ground
  // The ground: a collider without a rigid body is static. It never moves,
  // and everything else lands on it.
  const ground = new Mesh(scene, new BoxShape({ size: 20, sizeY: 0.5, sizeZ: 20 }), material(0.5, 0.5, 0.5));
  ground.position.setXYZ(0, -0.25, 0);
  const groundCollider = new Collider();
  groundCollider.size = new Vector3(20, 0.5, 20);
  ground.physics = new NodePhysics({ colliders: [groundCollider] });
  // #endregion ground

  // A static ramp: also just a collider, turned with its node.
  const ramp = new Mesh(scene, new BoxShape({ size: 5, sizeY: 0.3, sizeZ: 3 }), material(0.35, 0.4, 0.5));
  ramp.position.setXYZ(-2.5, 1.2, 0);
  ramp.rotation = Quaternion.fromAxisAngle(Vector3.axisPZ(), -0.35);
  const rampCollider = new Collider();
  rampCollider.size = new Vector3(5, 0.3, 3);
  ramp.physics = new NodePhysics({ colliders: [rampCollider] });

  const boxShape = new BoxShape({ size: 0.6 });
  const ballShape = new SphereShape({ radius: 0.3 });
  const bodies = [];
  let count = 0;

  // #region box
  // A dynamic body: a RigidBody gives the node mass and lets the simulation
  // move it; a Collider on the same node gives it its shape.
  function addBox(x, y, z) {
    const c = COLORS[count++ % COLORS.length];
    const mesh = new Mesh(scene, boxShape, material(c[0], c[1], c[2]));
    mesh.position.setXYZ(x, y, z);
    mesh.rotation = Quaternion.fromAxisAngle(new Vector3(1, 1, 0).inplaceNormalize(), count * 0.4);
    const collider = new Collider();
    collider.size = new Vector3(0.6, 0.6, 0.6);
    mesh.physics = new NodePhysics({ body: new RigidBody(), colliders: [collider] });
    bodies.push(mesh);
  }
  // #endregion box

  function addBall(x, y, z) {
    const c = COLORS[count++ % COLORS.length];
    const mesh = new Mesh(scene, ballShape, material(c[0], c[1], c[2]));
    mesh.position.setXYZ(x, y, z);
    const body = new RigidBody();
    body.mass = 2;
    const collider = new Collider();
    collider.shape = 'sphere';
    collider.radius = 0.3;
    // Bouncier than the default.
    collider.restitution = 0.5;
    mesh.physics = new NodePhysics({ body, colliders: [collider] });
    bodies.push(mesh);
  }

  function drop() {
    for (let i = 0; i < 6; i++) {
      addBox(-3 + (i % 3) * 0.7, 3 + Math.floor(i / 3) * 0.9, -0.4 + (i % 2) * 0.8);
    }
    for (let i = 0; i < 4; i++) {
      addBall(1.5 + (i % 2) * 0.5, 2.5 + i * 0.8, -0.5 + i * 0.35);
    }
  }

  // Removing a node takes its physics data out of the simulation.
  function reset() {
    for (const node of bodies) {
      node.remove();
      node.dispose();
    }
    bodies.length = 0;
    drop();
  }

  drop();
  document.querySelector('#drop').addEventListener('click', drop);
  document.querySelector('#reset').addEventListener('click', reset);

  const camera = new PerspectiveCamera(scene, Math.PI / 3, 0.1, 200);
  camera.lookAt(new Vector3(0, 5, 11), new Vector3(0, 0.8, 0), Vector3.axisPY());
  camera.controller = new OrbitCameraController({ center: new Vector3(0, 0.8, 0) });
  scene.mainCamera = camera;

  getEngine().setRenderable(scene, 0);
  getInput().use(camera.handleEvent, camera);
  myApp.run();
});
