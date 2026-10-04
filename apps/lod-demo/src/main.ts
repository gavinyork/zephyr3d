// Levels of detail generated at load time, without the editor:
// - a glTF model loaded through the resource manager with { generateLods: true }
// - a procedural sphere simplified with buildLodChain and given its levels through Primitive.lods
// Move the camera away to see the levels switch; Wireframe and LOD Coloration show them.
import { Vector3, Vector4 } from '@zephyr3d/base';
import { backendWebGPU } from '@zephyr3d/backend-webgpu';
import { backendWebGL2 } from '@zephyr3d/backend-webgl';
import { GLTFImporter, loadMeshoptSimplifier } from '@zephyr3d/loaders';
import {
  Application,
  buildLodChain,
  DirectionalLight,
  getEngine,
  getInput,
  Mesh,
  OrbitCameraController,
  PBRMetallicRoughnessMaterial,
  PerspectiveCamera,
  Primitive,
  Scene,
  BoundingBox
} from '@zephyr3d/scene';
import type { SceneNode } from '@zephyr3d/scene';

const LOCAL_MODEL = 'assets/DamagedHelmet.glb';
const CDN_MODEL = 'https://cdn.zephyr3d.org/doc/assets/models/DamagedHelmet.glb';

const params = new URLSearchParams(location.search);
const app = new Application({
  canvas: document.querySelector<HTMLCanvasElement>('#canvas')!,
  backend: params.has('webgl') ? backendWebGL2 : backendWebGPU
});
await app.ready();

const scene = new Scene();
const camera = new PerspectiveCamera(scene, Math.PI / 3, 0.05, 500);
camera.position.setXYZ(0, 1, 8);
scene.mainCamera = camera;
camera.controller = new OrbitCameraController({ center: new Vector3(0, 0, 0) });
getInput().use(camera.handleEvent, camera);

const light = new DirectionalLight(scene);
light.lookAt(new Vector3(4, 6, 4), Vector3.zero(), Vector3.axisPY());

getEngine().resourceManager.setModelLoader('model/gltf+json', new GLTFImporter());
getEngine().resourceManager.setModelLoader('model/gltf-binary', new GLTFImporter());

/** The model, loaded with levels of detail generated as it loads */
async function loadModel(): Promise<SceneNode> {
  const options = { generateLods: true };
  const url = params.get('model') ?? new URL(LOCAL_MODEL, location.href).href;
  try {
    return await getEngine().resourceManager.fetchModel(url, scene, options);
  } catch (err) {
    if (params.has('model')) {
      throw err;
    }
    console.warn(`${LOCAL_MODEL} not found (${err}), loading from the CDN`);
    return await getEngine().resourceManager.fetchModel(CDN_MODEL, scene, options);
  }
}

/** A UV sphere, simplified into levels of detail with the same builder SharedModel uses */
async function createSphere(radius: number, segments: number, rings: number) {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  for (let r = 0; r <= rings; r++) {
    const phi = (r / rings) * Math.PI;
    for (let s = 0; s <= segments; s++) {
      const theta = (s / segments) * Math.PI * 2;
      const x = Math.sin(phi) * Math.cos(theta);
      const y = Math.cos(phi);
      const z = Math.sin(phi) * Math.sin(theta);
      positions.push(x * radius, y * radius, z * radius);
      normals.push(x, y, z);
    }
  }
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < segments; s++) {
      const a = r * (segments + 1) + s;
      const b = a + segments + 1;
      // Counter-clockwise seen from outside
      indices.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  const positionData = new Float32Array(positions);
  const normalData = new Float32Array(normals);
  const { indices: all, levels } = buildLodChain(
    await loadMeshoptSimplifier(),
    new Uint32Array(indices),
    positionData,
    normalData,
    radius * Math.sqrt(3),
    { lodMinTriangles: 100, lodReduction: 0.5, lodPixelError: 8 }
  );
  const primitive = new Primitive();
  primitive.createAndSetVertexBuffer('position_f32x3', positionData);
  primitive.createAndSetVertexBuffer('normal_f32x3', normalData);
  primitive.createAndSetIndexBuffer(all);
  primitive.primitiveType = 'triangle-list';
  primitive.indexStart = 0;
  primitive.indexCount = levels[0].indexCount;
  primitive.lods = levels.slice(1).map(({ indexStart, indexCount, screenSize, hysteresis }) => ({
    indexStart,
    indexCount,
    screenSize,
    hysteresis
  }));
  primitive.setBoundingVolume(
    new BoundingBox(new Vector3(-radius, -radius, -radius), new Vector3(radius, radius, radius))
  );
  const material = new PBRMetallicRoughnessMaterial();
  material.albedoColor = new Vector4(0.8, 0.55, 0.3, 1);
  material.metallic = 0.2;
  material.roughness = 0.5;
  const mesh = new Mesh(scene, primitive, material);
  mesh.name = 'Sphere';
  return mesh;
}

const model = await loadModel();
model.position.setXYZ(-1.5, 0, 0);
const sphere = await createSphere(1, 64, 32);
sphere.position.setXYZ(1.5, 0, 0);

const meshes: Mesh[] = [sphere];
model.iterate((node) => {
  if (node.isMesh()) {
    meshes.push(node);
  }
  return false;
});

// UI
const btnWire = document.getElementById('btn-wire')!;
const btnColor = document.getElementById('btn-color')!;
const scaleInput = document.getElementById('scale') as HTMLInputElement;
const scaleValue = document.getElementById('scale-value')!;
const status = document.getElementById('status')!;
btnWire.addEventListener('click', () => {
  camera.wireframe = !camera.wireframe;
  btnWire.classList.toggle('active', camera.wireframe);
});
btnColor.addEventListener('click', () => {
  camera.lodColoration = !camera.lodColoration;
  btnColor.classList.toggle('active', camera.lodColoration);
});
scaleInput.addEventListener('input', () => {
  camera.lodDistanceScale = Number(scaleInput.value);
  scaleValue.textContent = camera.lodDistanceScale.toFixed(2);
});

/** Level of each mesh and its triangles, as the CPU selects it for the main camera */
function updateStatus() {
  const lines = [`Backend: ${app.device.type}`];
  for (const mesh of meshes) {
    const primitive = mesh.primitive;
    if (!primitive) {
      continue;
    }
    const lod = mesh.selectLod(camera);
    const count = lod > 0 ? primitive.lods[lod - 1].indexCount : primitive.indexCount;
    lines.push(
      `${(mesh.name || 'mesh').padEnd(16)} LOD ${lod}/${primitive.lodCount - 1}  ${Math.floor(count / 3)} tris`
    );
  }
  status.textContent = lines.join('\n');
}

getEngine().setRenderable(scene);
let frame = 0;
app.on('tick', () => {
  camera.updateController();
  if (frame++ % 10 === 0) {
    updateStatus();
  }
});
app.run();
