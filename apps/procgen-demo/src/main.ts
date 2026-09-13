import { Vector3, Vector4 } from '@zephyr3d/base';
import { backendWebGL2 } from '@zephyr3d/backend-webgl';
import type { GeneratedModelSpec } from '@zephyr3d/modelgen';
import {
  cityBlockGroundSpec,
  generateBuilding,
  generateCityBlock,
  modernOffice,
  Random
} from '@zephyr3d/procgen';
import {
  Application,
  BatchGroup,
  createForwardPlusPipeline,
  DirectionalLight,
  getEngine,
  getInput,
  Mesh,
  OrbitCameraController,
  PBRMetallicRoughnessMaterial,
  PerspectiveCamera,
  PlaneShape,
  Scene,
  type Primitive
} from '@zephyr3d/scene';
import { primitiveFromSpec } from './spec-to-primitive';

const app = new Application({
  canvas: document.querySelector<HTMLCanvasElement>('#canvas'),
  backend: backendWebGL2
});
await app.ready();

const scene = new Scene();
const camera = new PerspectiveCamera(scene, Math.PI / 3, 0.5, 1200);
camera.position.setXYZ(120, 85, 120);
camera.controller = new OrbitCameraController({ center: new Vector3(0, 22, 0) });
scene.mainCamera = camera;
getInput().use(camera.handleEvent, camera);

// Physical lighting: the sun defaults to 100000 lux and the camera to f/16, 1/125s,
// ISO 100 — the sunny-16 rule — so a daylight exterior is correctly exposed without
// hand-tuning. This also makes the palette's linear albedo values mean what they
// say; under 'legacy' the exposure controls do nothing.
scene.lightingMode = 'physical';
camera.exposureCompensation = 0.8;

const sun = new DirectionalLight(scene);
sun.lookAt(new Vector3(90, 140, 70), new Vector3(0, 0, 0), Vector3.axisPY());
sun.castShadow = true;
// The default shadow distance is tuned for a single object; a city block needs the
// cascades stretched to cover it, or only the nearest building gets a shadow.
sun.shadow.shadowDistance = 420;
sun.shadow.numShadowCascades = 4;
sun.shadow.shadowMapSize = 2048;

const groundMaterial = new PBRMetallicRoughnessMaterial();
groundMaterial.albedoColor = new Vector4(0.15, 0.16, 0.18, 1);
groundMaterial.metallic = 0;
groundMaterial.roughness = 0.95;
const ground = new Mesh(scene, new PlaneShape({ size: 3000 }), groundMaterial);
// The ground receives shadows but must not cast them, or it swallows the whole
// shadow region in its own bounds.
ground.castShadow = false;

// The grammar tags every node it emits with a material group, and the style ships
// the palette it was designed against — so the demo reads both from the ruleset
// rather than inventing a look of its own.
const MATERIAL_GROUPS = ['glass', 'frame', 'wall', 'trim'] as const;
type MaterialGroup = (typeof MATERIAL_GROUPS)[number];

// Tone variants are pre-built and shared rather than created per building: a fresh
// material per regeneration would leak GPU state, and a handful of buckets gives the
// same "not nine copies" read.
const TONE_VARIANTS = 5;

const materials: Record<MaterialGroup, PBRMetallicRoughnessMaterial[]> = (() => {
  const table = {} as Record<MaterialGroup, PBRMetallicRoughnessMaterial[]>;
  for (const group of MATERIAL_GROUPS) {
    const hint = modernOffice.palette![group];
    const variants: PBRMetallicRoughnessMaterial[] = [];
    for (let i = 0; i < TONE_VARIANTS; i++) {
      const t = i / (TONE_VARIANTS - 1);
      const k = 1 + (hint.variation ?? 0) * (t * 2 - 1);
      const material = new PBRMetallicRoughnessMaterial();
      material.albedoColor = new Vector4(hint.albedo[0] * k, hint.albedo[1] * k, hint.albedo[2] * k, 1);
      material.metallic = hint.metallic;
      material.roughness = hint.roughness;
      variants.push(material);
    }
    table[group] = variants;
  }
  return table;
})();

// Street surfaces are part of the layout, not of any building style, so they get
// their own materials rather than an entry in the ruleset palette.
function flatMaterial(albedo: [number, number, number], roughness: number) {
  const material = new PBRMetallicRoughnessMaterial();
  material.albedoColor = new Vector4(albedo[0], albedo[1], albedo[2], 1);
  material.metallic = 0;
  material.roughness = roughness;
  return material;
}

const groundMaterials: Record<string, PBRMetallicRoughnessMaterial> = {
  road: flatMaterial([0.035, 0.035, 0.04], 0.92),
  plaza: flatMaterial([0.2, 0.195, 0.18], 0.78)
};

// Everything generated lives under one batch group so the whole city instances.
const cityRoot = new BatchGroup(scene);
const liveMeshes: Mesh[] = [];
const livePrimitives: Primitive[] = [];

const CELL_SIZE = 20;

function clearCity(): void {
  // Drop the shadow casters first: the region holds references to the meshes we are
  // about to detach, and a stale region keeps the old skyline shadowed.
  sun.shadow.shadowRegion.clear();
  for (const mesh of liveMeshes) {
    mesh.remove();
  }
  liveMeshes.length = 0;
  // Primitives own GPU buffers, so they must be released explicitly; dropping the
  // mesh alone would leak a vertex buffer per regeneration.
  for (const primitive of livePrimitives) {
    primitive.dispose();
  }
  livePrimitives.length = 0;
}

function subSpec(spec: GeneratedModelSpec, group: string) {
  const nodes = (spec.nodes ?? []).filter((node) => node.id === group);
  return nodes.length > 0 ? { version: 1 as const, nodes } : null;
}

function addMesh(spec: GeneratedModelSpec | null, material: PBRMetallicRoughnessMaterial): number {
  if (!spec) {
    return 0;
  }
  const primitive = primitiveFromSpec(spec);
  livePrimitives.push(primitive);
  const mesh = new Mesh(scene, primitive, material);
  mesh.parent = cityRoot;
  // A generated city never moves, so register as a static caster: the region takes a
  // snapshot of the bounds instead of subscribing to change events.
  sun.shadow.shadowRegion.addStaticCaster(mesh);
  liveMeshes.push(mesh);
  return primitive.indexCount / 3;
}

function generateCity(seed: number, blockSize: number, maxFloors: number): void {
  clearCity();
  let triangles = 0;

  // Wave function collapse lays out the streets; the shape grammar fills the parcels
  // between them. Each algorithm is used where it is actually strong.
  const layout = generateCityBlock({
    width: blockSize * 2 + 1,
    height: blockSize * 2 + 1,
    cellSize: CELL_SIZE,
    seed
  });

  const ground = cityBlockGroundSpec(layout);
  for (const surface of ['road', 'plaza']) {
    triangles += addMesh(subSpec(ground, surface), groundMaterials[surface]);
  }

  const rng = new Random(seed ^ 0x27d4eb2f);
  const centreX = layout.origin[0] + (layout.width * CELL_SIZE) / 2;
  const centreZ = layout.origin[1] + (layout.height * CELL_SIZE) / 2;
  const halfSpan = Math.hypot(layout.width, layout.height) * CELL_SIZE * 0.5;

  for (const parcel of layout.parcels) {
    // Taper the skyline towards the edges of the block; a field of equal-height
    // towers reads as a test scene rather than a city.
    const dx = parcel.x + parcel.width * 0.5 - centreX;
    const dz = parcel.z + parcel.depth * 0.5 - centreZ;
    const falloff = 1 - Math.min(1, Math.hypot(dx, dz) / halfSpan) * 0.65;
    const floors = Math.max(2, Math.round(rng.int(3, Math.max(3, maxFloors)) * falloff));

    const spec = generateBuilding({
      seed: rng.int(0, 1 << 30),
      footprint: [parcel.width, parcel.depth],
      origin: [parcel.x, 0, parcel.z],
      // Point the entrance at a street rather than a rear yard.
      params: { floors, entranceFaceMask: parcel.frontageMask || 0b1111 }
    });

    // One tone bucket per building: shifting every group together keeps a building
    // reading as a single object rather than a pile of tinted parts.
    const tone = rng.int(0, TONE_VARIANTS - 1);
    for (const group of MATERIAL_GROUPS) {
      triangles += addMesh(subSpec(spec, group), materials[group][tone]);
    }
  }

  statsEl.textContent =
    `${layout.parcels.length} buildings · ${layout.width}×${layout.height} cells · ` +
    `${liveMeshes.length} draw calls · ${triangles.toLocaleString()} triangles`;
}

const seedEl = document.querySelector<HTMLInputElement>('#seed')!;
const gridEl = document.querySelector<HTMLInputElement>('#grid')!;
const gridValueEl = document.querySelector<HTMLOutputElement>('#grid-value')!;
const floorsEl = document.querySelector<HTMLInputElement>('#floors')!;
const floorsValueEl = document.querySelector<HTMLOutputElement>('#floors-value')!;
const statsEl = document.querySelector<HTMLDivElement>('#stats')!;

function regenerate(): void {
  gridValueEl.value = gridEl.value;
  floorsValueEl.value = floorsEl.value;
  generateCity(Number(seedEl.value) || 0, Number(gridEl.value), Number(floorsEl.value));
}

document.querySelector<HTMLButtonElement>('#regenerate')!.addEventListener('click', () => {
  seedEl.value = String((Number(seedEl.value) || 0) + 1);
  regenerate();
});
for (const el of [seedEl, gridEl, floorsEl]) {
  el.addEventListener('input', regenerate);
}

camera.renderPipeline = createForwardPlusPipeline();
getEngine().setRenderable(scene);
regenerate();

app.on('tick', () => {
  camera.updateController();
});
app.run();
