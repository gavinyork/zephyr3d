import { Vector3, Vector4 } from '@zephyr3d/base';
import {
  Application,
  BoundingBox,
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
  Primitive,
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

function material(r, g, b, a = 1) {
  const m = new PBRMetallicRoughnessMaterial();
  m.albedoColor = new Vector4(r, g, b, a);
  m.metallic = 0;
  m.roughness = 0.7;
  return m;
}

// Collision layers used in this example.
const LAYER_ROCKS = 1;
const LAYER_GHOSTS = 2;

/** Rolling ground, 16 m square: y = 0.6 sin(0.5 x) cos(0.4 z). */
function rollingGround() {
  const n = 40;
  const size = 16;
  const positions = [];
  const normals = [];
  const indices = [];
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const x = (i / n - 0.5) * size;
      const z = (j / n - 0.5) * size;
      positions.push(x, 0.6 * Math.sin(0.5 * x) * Math.cos(0.4 * z), z);
      const dx = 0.3 * Math.cos(0.5 * x) * Math.cos(0.4 * z);
      const dz = -0.24 * Math.sin(0.5 * x) * Math.sin(0.4 * z);
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
    new BoundingBox(new Vector3(-size / 2, -0.6, -size / 2), new Vector3(size / 2, 0.6, size / 2))
  );
  prim.indexCount = indices.length;
  return prim;
}

myApp.ready().then(async function () {
  await initPhysics(rapierPhysics);

  const scene = new Scene();
  const sun = new DirectionalLight(scene);
  sun.lookAt(new Vector3(-6, 10, 4), Vector3.zero(), Vector3.axisPY());
  sun.castShadow = true;

  // #region mesh
  // A mesh collider uses the mesh's own triangles. Best for static ground and
  // level geometry; on a moving body use 'convex' instead.
  const ground = new Mesh(scene, rollingGround(), material(0.5, 0.55, 0.45));
  const groundCollider = new Collider();
  groundCollider.shape = 'mesh';
  ground.physics = new NodePhysics({ colliders: [groundCollider] });
  // #endregion mesh

  // A trigger: detects what enters it, but nothing bumps into it.
  const zone = new Mesh(scene, new BoxShape({ size: 3, sizeY: 2, sizeZ: 3 }), material(0.2, 0.8, 1, 0.25));
  zone.material.blendMode = 'blend';
  zone.castShadow = false;
  zone.position.setXYZ(2.5, 1, 0);
  // #region trigger
  const trigger = new Collider();
  trigger.size = new Vector3(3, 2, 3);
  trigger.isTrigger = true;
  zone.physics = new NodePhysics({ colliders: [trigger] });
  const highlight = material(1, 0.2, 0.6);
  const original = new Map();
  // Events are raised on the physics data of the nodes involved: both the
  // trigger's and that of what entered it.
  zone.physics.on('triggerenter', (ev) => {
    const node = ev.otherNode;
    if (node instanceof Mesh && !original.has(node)) {
      original.set(node, node.material);
      node.material = highlight;
    }
  });
  zone.physics.on('triggerexit', (ev) => {
    // #endregion trigger
    const node = ev.otherNode;
    if (original.has(node)) {
      node.material = original.get(node);
      original.delete(node);
    }
  });

  const rockShape = new SphereShape({ radius: 0.35, verticalDetail: 5, horizonalDetail: 7 });
  const ghostShape = new BoxShape({ size: 0.5 });
  const bodies = [];
  let count = 0;

  function drop() {
    // #region convex
    // Rocks: convex hulls of a low-poly sphere, squashed by the node's scale.
    // The collider follows the scale, as does the hull.
    for (let i = 0; i < 8; i++) {
      const rock = new Mesh(scene, rockShape, material(0.6, 0.55, 0.5));
      rock.position.setXYZ(-4 + (i % 4) * 2.2, 3 + Math.floor(i / 4), -1.5 + ((count + i) % 3) * 1.4);
      rock.scale.setXYZ(1, 0.7 + (i % 3) * 0.15, 1.3);
      const hull = new Collider();
      hull.shape = 'convex';
      hull.layer = LAYER_ROCKS;
      rock.physics = new NodePhysics({ body: new RigidBody(), colliders: [hull] });
      // #endregion convex
      bodies.push(rock);
    }
    // Ghosts: boxes on their own layer, which may or may not hit the rocks.
    for (let i = 0; i < 4; i++) {
      const ghost = new Mesh(scene, ghostShape, material(0.95, 0.85, 0.3));
      ghost.position.setXYZ(-3 + i * 2, 5.5, -0.5 + (i % 2));
      const box = new Collider();
      box.size = new Vector3(0.5, 0.5, 0.5);
      box.layer = LAYER_GHOSTS;
      ghost.physics = new NodePhysics({ body: new RigidBody(), colliders: [box] });
      bodies.push(ghost);
    }
    count++;
  }

  // #region layers
  const world = scene.physicsWorld;
  const passThrough = document.querySelector('#passthrough');
  passThrough.addEventListener('change', () => {
    world.setLayerCollision(LAYER_ROCKS, LAYER_GHOSTS, !passThrough.checked);
  });
  // #endregion layers

  drop();
  document.querySelector('#drop').addEventListener('click', drop);
  document.querySelector('#reset').addEventListener('click', () => {
    original.clear();
    for (const node of bodies) {
      node.remove();
      node.dispose();
    }
    bodies.length = 0;
    drop();
  });

  const camera = new PerspectiveCamera(scene, Math.PI / 3, 0.1, 200);
  camera.lookAt(new Vector3(0, 7, 13), new Vector3(0, 0.5, 0), Vector3.axisPY());
  camera.controller = new OrbitCameraController({ center: new Vector3(0, 0.5, 0) });
  scene.mainCamera = camera;

  getEngine().setRenderable(scene, 0);
  getInput().use(camera.handleEvent, camera);
  myApp.run();
});
