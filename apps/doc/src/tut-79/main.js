import { Vector3, Vector4 } from '@zephyr3d/base';
import {
  Application,
  BoxShape,
  Collider,
  CylinderShape,
  DirectionalLight,
  getEngine,
  getInput,
  Joint,
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

/** A mesh with a box collider; dynamic when `dynamic` is set. */
function box(scene, size, position, mat, dynamic) {
  const mesh = new Mesh(scene, new BoxShape({ size: size.x, sizeY: size.y, sizeZ: size.z }), mat);
  mesh.position.set(position);
  const collider = new Collider();
  collider.size = size;
  mesh.physics = new NodePhysics({ body: dynamic ? new RigidBody() : null, colliders: [collider] });
  return mesh;
}

function ball(scene, radius, position, mat) {
  const mesh = new Mesh(scene, new SphereShape({ radius }), mat);
  mesh.position.set(position);
  const collider = new Collider();
  collider.shape = 'sphere';
  collider.radius = radius;
  mesh.physics = new NodePhysics({ body: new RigidBody(), colliders: [collider] });
  return mesh;
}

myApp.ready().then(async function () {
  await initPhysics(rapierPhysics);

  const scene = new Scene();
  const sun = new DirectionalLight(scene);
  sun.lookAt(new Vector3(-6, 10, 6), Vector3.zero(), Vector3.axisPY());
  sun.castShadow = true;
  const grey = material(0.55, 0.55, 0.55);
  box(scene, new Vector3(16, 0.5, 10), new Vector3(0, -0.25, 0), grey, false);

  // --- Hinged door -------------------------------------------------------
  // #region hinge
  // The joint sits on its own node, a child of the door: the node's origin is
  // the pivot and its Y axis the hinge axis. Moving that node in the editor
  // moves the hinge. With no connected body, the door hangs on the world.
  const door = box(
    scene,
    new Vector3(1.2, 2, 0.1),
    new Vector3(-3.4, 1.02, 0),
    material(0.6, 0.4, 0.25),
    true
  );
  const hingeNode = new Mesh(
    scene,
    new CylinderShape({ topRadius: 0.04, bottomRadius: 0.04, height: 2.1, anchor: 0.5 }),
    grey
  );
  hingeNode.parent = door;
  hingeNode.position.setXYZ(-0.62, 0, 0);
  const hinge = new Joint();
  hinge.type = 'hinge';
  hinge.limitsEnabled = true;
  hinge.lowerLimit = -110;
  hinge.upperLimit = 110;
  hingeNode.physics = new NodePhysics({ joint: hinge });
  // #endregion hinge

  const motor = document.querySelector('#motor');
  motor.addEventListener('change', () => {
    // #region motor
    switch (motor.value) {
      case 'spin':
        // Turn at 60 degrees a second, with a limited torque.
        hinge.motorMode = 'velocity';
        hinge.motorTarget = 60;
        hinge.motorMaxForce = 200;
        break;
      case 'close':
        // Spring back to the angle it was built at.
        hinge.motorMode = 'position';
        hinge.motorTarget = 0;
        hinge.motorStiffness = 300;
        hinge.motorDamping = 40;
        hinge.motorMaxForce = 0;
        break;
      default:
        hinge.motorMode = 'off';
    }
  });
  // #endregion motor

  // --- Chain on ball joints ------------------------------------------------
  // #region chain
  // Each bead joins the previous one at its left side; the first joins the world.
  const beadMaterial = material(0.15, 0.45, 0.9);
  let prev = null;
  for (let i = 0; i < 10; i++) {
    const bead = ball(scene, 0.12, new Vector3(-0.5 + (i + 1) * 0.3, 3.5, 0), beadMaterial);
    const link = new Joint();
    link.type = 'ball';
    link.anchor = new Vector3(-0.15, 0, 0);
    link.connectedBody = prev;
    bead.physics.joint = link;
    prev = bead;
  }
  // #endregion chain

  // --- Rope and spring ---------------------------------------------------
  // #region rope
  // Two-point joints: one end on the body, the other (connectedAnchor) in world
  // space when there is no connected body.
  const lamp = ball(scene, 0.25, new Vector3(4.5, 2.2, 0), material(0.95, 0.8, 0.2));
  const rope = new Joint();
  rope.type = 'rope';
  rope.connectedAnchor = new Vector3(3.5, 4, 0);
  rope.length = 2;
  lamp.physics.joint = rope;

  const weight = box(
    scene,
    new Vector3(0.5, 0.5, 0.5),
    new Vector3(6.5, 2, 0),
    material(0.9, 0.35, 0.15),
    true
  );
  const spring = new Joint();
  spring.type = 'spring';
  spring.anchor = new Vector3(0, 0.25, 0);
  spring.connectedAnchor = new Vector3(6.5, 4.2, 0);
  spring.length = 1.2;
  spring.stiffness = 40;
  spring.damping = 0.5;
  weight.physics.joint = spring;
  // #endregion rope

  // --- A ball to knock things with -----------------------------------------
  const throwMaterial = material(0.3, 0.75, 0.35);
  const thrown = [];
  document.querySelector('#throw').addEventListener('click', () => {
    const b = ball(scene, 0.3, new Vector3(-3.2, 0.3, 5), throwMaterial);
    const body = b.physics.body;
    body.mass = 8;
    body.setLinearVelocity(new Vector3(0, 0, -7));
    thrown.push(b);
    if (thrown.length > 5) {
      const old = thrown.shift();
      old.remove();
      old.dispose();
    }
  });
  document.querySelector('#nudge').addEventListener('click', () => {
    lamp.physics.body.applyImpulse(new Vector3(0, 0, 2));
    weight.physics.body.applyImpulse(new Vector3(0, -3, 0));
  });

  const angle = document.querySelector('#angle');
  myApp.on('tick', () => {
    angle.textContent = `${hinge.angle.toFixed(0)}°`;
  });

  const camera = new PerspectiveCamera(scene, Math.PI / 3, 0.1, 200);
  camera.lookAt(new Vector3(0, 4, 11), new Vector3(1, 1.5, 0), Vector3.axisPY());
  camera.controller = new OrbitCameraController({ center: new Vector3(1, 1.5, 0) });
  scene.mainCamera = camera;

  getEngine().setRenderable(scene, 0);
  getInput().use(camera.handleEvent, camera);
  myApp.run();
});
