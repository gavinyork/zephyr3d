/**
 * A procedural city block from `@zephyr3d/procgen`: wave function collapse lays out the streets and
 * a shape grammar fills each parcel with a building, as in the procgen demo.
 *
 * The geometry is written as `.zmsh` assets next to the scene, one per material group of each
 * part of a building, so every building stays a separate node that can be moved or deleted.
 *
 * The scene is built to be traced by global illumination: the ground is solid slabs in chunks
 * rather than a scaled built-in plane (which has no distance field), and tall buildings are split
 * at floor lines, so every mesh's baked field keeps a voxel size near {@link BUILDING_VOXEL} or
 * {@link GROUND_VOXEL} under the baker's cap of 128 voxels per axis.
 */
import { Vector3 } from '@zephyr3d/base';
import {
  availableStyles,
  cityBlockGroundParts,
  generateBuildingParts,
  generateCityBlock,
  getStyle,
  Random,
  type MaterialHint
} from '@zephyr3d/procgen';
import {
  BatchGroup,
  DirectionalLight,
  Mesh,
  SceneNode,
  type MeshMaterial,
  type Scene
} from '@zephyr3d/scene';
import { GeneratedModelRunner } from '../generatedprimitive';
import {
  bakeGeneratedMeshSDFs,
  createSurfaceMaterial,
  ensureAssetDir,
  numParam,
  setupCamera,
  writeGeneratedPrimitive,
  type ExampleSceneBuildContext,
  type ExampleSceneType
} from './common';

/** The procedural model spec type, without depending on @zephyr3d/modelgen directly */
type GeneratedModelSpec = ReturnType<typeof generateBuildingParts>[number]['spec'];

/** Used for a material group the style's palette does not describe */
const FALLBACK_HINT: MaterialHint = { albedo: [0.5, 0.5, 0.5], metallic: 0, roughness: 0.8 };

/** Ground surfaces belong to the layout rather than to a building style */
const GROUND_SURFACES: Record<string, MaterialHint> = {
  road: { albedo: [0.045, 0.045, 0.05], metallic: 0, roughness: 0.9 },
  sidewalk: { albedo: [0.28, 0.27, 0.25], metallic: 0, roughness: 0.85 },
  kerb: { albedo: [0.42, 0.41, 0.39], metallic: 0, roughness: 0.8 },
  marking: { albedo: [0.7, 0.7, 0.68], metallic: 0, roughness: 0.55 },
  ground: { albedo: [0.15, 0.16, 0.18], metallic: 0, roughness: 0.95 },
  plaza: { albedo: [0.2, 0.195, 0.18], metallic: 0, roughness: 0.78 }
};

/** Ground groups too thin for a distance field; they keep out of it and of shadow casting */
const PAINT_GROUPS = new Set(['marking']);

/** Baker's cap on voxels per axis, less two voxels of padding on each side */
const FIELD_SPAN_VOXELS = 124;
/** Target edge of a building field voxel: fine enough for street canyons and lobbies */
const BUILDING_VOXEL = 0.5;
/** Target edge of a ground field voxel; a chunk of two 20 m cells comes out near 0.33 */
const GROUND_VOXEL = 0.25;
/** Depth of the ground slabs, a few voxels so the field resolves both faces */
const GROUND_DEPTH = 1.5;

function styleOptions() {
  try {
    return availableStyles().map((id) => {
      let label = id;
      try {
        label = (getStyle(id) as { displayName?: string }).displayName ?? id;
      } catch {
        // keep the id
      }
      return { value: id, label };
    });
  } catch {
    return [{ value: 'modern-office', label: 'Modern office' }];
  }
}

/** Splits a spec by the material group stored in each node's id, keeping the order of first use */
function splitByGroup(spec: GeneratedModelSpec) {
  const groups = new Map<string, GeneratedModelSpec>();
  for (const node of spec.nodes ?? []) {
    const group = node.id ?? 'default';
    let sub = groups.get(group);
    if (!sub) {
      sub = { ...spec, nodes: [] };
      groups.set(group, sub);
    }
    sub.nodes!.push(node);
  }
  return groups;
}

function safeName(name: string) {
  return name.replace(/[^A-Za-z0-9_-]+/g, '_');
}

/**
 * Field resolution the baker gives a mesh of the given extent, as bakeMeshSDF computes it for a
 * resolution scale below 1 (128 voxels per axis at most, two of padding on each side, eight at least).
 */
function fieldResolution(extent: [number, number, number], voxel: number) {
  const longest = Math.max(extent[0], extent[1], extent[2], 1e-6);
  const size = Math.max(voxel, longest / FIELD_SPAN_VOXELS);
  return extent.map((e) => Math.min(128, Math.max(8, Math.ceil(e / size) + 4)));
}

/**
 * Raises the scene's distance field and GI material atlases to hold every field of the city at
 * once, with some slack for packing: the block fits inside the default stream radius, so all of
 * them stay loaded. Never lowers them, and stops at sizes whose memory stays reasonable.
 */
function sizeFieldAtlases(scene: Scene, fields: { extent: [number, number, number]; voxel: number }[]) {
  const roundUp = (v: number, block: number) => Math.ceil(v / block) * block;
  let sdfDemand = 0;
  let materialDemand = 0;
  for (const { extent, voxel } of fields) {
    const res = fieldResolution(extent, voxel);
    sdfDemand += res.reduce((n, v) => n * roundUp(v, 8), 1);
    // The material field is half the distance field's resolution
    materialDemand += res.reduce((n, v) => n * roundUp(Math.ceil(v / 2), 4), 1);
  }
  const slack = 1.25;
  const sdfSizes: [number, number, number][] = [
    [512, 256, 256],
    [512, 512, 256],
    [1024, 512, 256]
  ];
  const current = scene.sdf.atlasSize;
  const sdfSize =
    sdfSizes.find(([x, y, z]) => x * y * z >= sdfDemand * slack) ?? sdfSizes[sdfSizes.length - 1];
  if (sdfSize[0] * sdfSize[1] * sdfSize[2] > current[0] * current[1] * current[2]) {
    scene.sdf.atlasSize = sdfSize;
  }
  const materialSize = [256, 320, 384].find((s) => s * s * s >= materialDemand * slack) ?? 384;
  if (materialSize > scene.gi.atlasSize) {
    scene.gi.atlasSize = materialSize;
  }
  console.info(
    `Buildings example: ${fields.length} fields need ${(sdfDemand / 1e6).toFixed(1)}M distance voxels ` +
      `(atlas ${scene.sdf.atlasSize.join('×')}) and ${(materialDemand / 1e6).toFixed(1)}M material voxels ` +
      `(atlas ${scene.gi.atlasSize}³)`
  );
}

async function writeMesh(
  ctx: ExampleSceneBuildContext,
  runner: GeneratedModelRunner,
  spec: GeneratedModelSpec,
  fileName: string,
  material: MeshMaterial,
  parent: SceneNode,
  nodeName: string
) {
  const { path, primitive } = await writeGeneratedPrimitive(ctx, runner, spec, fileName);
  const mesh = new Mesh(ctx.scene, primitive, material);
  mesh.name = nodeName;
  mesh.parent = parent;
  return { mesh, path };
}

export const buildingsScene: ExampleSceneType = {
  id: 'buildings',
  label: 'Buildings',
  description:
    'A city block generated by @zephyr3d/procgen: streets from wave function collapse, buildings from a shape grammar.',
  writesAssets: true,
  params: [
    {
      type: 'enum',
      key: 'style',
      label: 'Building Style',
      default: 'modern-office',
      options: styleOptions()
    },
    {
      type: 'int',
      key: 'gridWidth',
      label: 'Block Width',
      default: 9,
      min: 3,
      max: 25,
      tooltip: 'Number of grid cells along X, including the ring road'
    },
    {
      type: 'int',
      key: 'gridDepth',
      label: 'Block Depth',
      default: 9,
      min: 3,
      max: 25,
      tooltip: 'Number of grid cells along Z, including the ring road'
    },
    {
      type: 'float',
      key: 'cellSize',
      label: 'Cell Size',
      default: 20,
      min: 8,
      max: 60,
      format: '%.1f',
      tooltip: 'Width of one grid cell in world units; a road or a part of a parcel fills one cell'
    },
    {
      type: 'float',
      key: 'roadWidth',
      label: 'Road Width',
      default: 9,
      min: 4,
      max: 40,
      format: '%.1f',
      tooltip:
        'Carriageway width between the kerbs; the rest of a road cell is pavement. Narrow roads between tall buildings make deep street canyons'
    },
    {
      type: 'int',
      key: 'maxFloors',
      label: 'Max Floors',
      default: 24,
      min: 3,
      max: 80,
      tooltip: 'Floors of the tallest buildings; the skyline tapers towards the edge of the block'
    },
    {
      type: 'bool',
      key: 'batch',
      label: 'Batch for Rendering',
      default: true,
      tooltip: 'Put the block under a BatchGroup so the whole city draws with few draw calls'
    },
    {
      type: 'bool',
      key: 'bakeSDF',
      label: 'Bake Distance Fields',
      default: true,
      tooltip:
        'Bake a signed distance field for every ground and building mesh and turn on global illumination, so the city takes part in it. Takes longer to create'
    },
    {
      type: 'float',
      key: 'sunElevation',
      label: 'Sun Elevation',
      default: 50,
      min: 5,
      max: 90,
      format: '%.1f°',
      tooltip: 'Height of the sun above the horizon; a low sun throws long shadows down the streets'
    },
    {
      type: 'float',
      key: 'sunAzimuth',
      label: 'Sun Azimuth',
      default: 38,
      min: 0,
      max: 360,
      format: '%.1f°',
      tooltip: 'Direction the sunlight comes from, measured from +X towards +Z'
    },
    {
      type: 'int',
      key: 'seed',
      label: 'Seed',
      default: 1,
      min: 0,
      max: 1000000
    }
  ],
  async build(ctx, params) {
    const scene = ctx.scene;
    const styleId = String(params.style);
    const style = getStyle(styleId);
    const palette = style.palette ?? {};
    const width = Math.max(3, Math.round(numParam(params, 'gridWidth')));
    const depth = Math.max(3, Math.round(numParam(params, 'gridDepth')));
    const cellSize = Math.max(1, numParam(params, 'cellSize'));
    // Keeps at least a metre of pavement on each side
    const roadWidth = Math.max(1, Math.min(numParam(params, 'roadWidth'), cellSize - 2));
    const maxFloors = Math.max(3, Math.round(numParam(params, 'maxFloors')));
    const seed = Math.round(numParam(params, 'seed'));

    await ensureAssetDir(ctx);
    const runner = new GeneratedModelRunner();
    try {
      ctx.progress('Laying out streets...');
      const layout = generateCityBlock({ width, height: depth, cellSize, seed });

      const root = params.batch ? new BatchGroup(scene) : new SceneNode(scene);
      root.name = 'City Block';
      root.parent = scene.rootNode;

      const spanX = layout.width * cellSize;
      const spanZ = layout.height * cellSize;

      /** Generated mesh assets per target voxel size, for the optional distance field bake */
      const groundPaths: string[] = [];
      const buildingPaths: string[] = [];
      /** Local bounds of every generated mesh, to size the field atlases */
      const fieldExtents: { extent: [number, number, number]; voxel: number }[] = [];
      const recordExtent = (mesh: Mesh, voxel: number) => {
        const box = mesh.primitive?.getBoundingVolume()?.toAABB();
        if (box) {
          const e = Vector3.sub(box.maxPoint, box.minPoint);
          fieldExtents.push({ extent: [e.x, e.y, e.z], voxel });
        }
        return box;
      };

      // Solid chunked slabs, the surrounding ground included: a scaled built-in plane has no
      // distance field and would be invisible to global illumination
      ctx.progress('Generating ground...');
      const groundNode = new SceneNode(scene);
      groundNode.name = 'Ground';
      groundNode.parent = root;
      const groundMaterials = new Map<string, MeshMaterial>();
      for (const { part, spec } of cityBlockGroundParts(layout, {
        depth: GROUND_DEPTH,
        roadWidth,
        chunkCells: 2,
        margin: Math.max(spanX, spanZ)
      })) {
        const groups = splitByGroup(spec);
        const parent = groups.size > 1 ? new SceneNode(scene) : groundNode;
        if (parent !== groundNode) {
          parent.name = part;
          parent.parent = groundNode;
        }
        for (const [surface, sub] of groups) {
          let material = groundMaterials.get(surface);
          if (!material) {
            material = await createSurfaceMaterial(GROUND_SURFACES[surface] ?? FALLBACK_HINT);
            groundMaterials.set(surface, material);
          }
          const { mesh, path } = await writeMesh(
            ctx,
            runner,
            sub,
            `ground_${safeName(part)}_${safeName(surface)}`,
            material,
            parent,
            groups.size > 1 ? surface : part
          );
          // The ground only receives shadows: as a caster its bounds would swallow the shadow region
          mesh.castShadow = false;
          if (PAINT_GROUPS.has(surface)) {
            // A centimetre of paint has no usable field; the road under it stands in for it
            mesh.sdfMode = 'none';
            continue;
          }
          groundPaths.push(path);
          recordExtent(mesh, GROUND_VOXEL);
        }
      }

      const rng = new Random(seed ^ 0x27d4eb2f);
      const centreX = layout.origin[0] + spanX * 0.5;
      const centreZ = layout.origin[1] + spanZ * 0.5;
      const halfSpan = Math.hypot(spanX, spanZ) * 0.5;
      let maxHeight = 0;
      for (let index = 0; index < layout.parcels.length; index++) {
        const parcel = layout.parcels[index];
        ctx.progress(`Generating building ${index + 1} / ${layout.parcels.length}...`);
        // Taper the skyline towards the edges of the block
        const cx = parcel.x + parcel.width * 0.5;
        const cz = parcel.z + parcel.depth * 0.5;
        const falloff = 1 - Math.min(1, Math.hypot(cx - centreX, cz - centreZ) / halfSpan) * 0.65;
        const floors = Math.max(2, Math.round(rng.int(3, maxFloors) * falloff));
        const buildingSeed = rng.int(0, 1 << 30);
        // One tone per building: shifting all groups together keeps a building reading as one object
        const tone = rng.next() * 2 - 1;
        // Built around its own footprint centre so the node's pivot sits on the building
        const parts = generateBuildingParts({
          style: styleId,
          seed: buildingSeed,
          footprint: [parcel.width, parcel.depth],
          origin: [-parcel.width * 0.5, 0, -parcel.depth * 0.5],
          params: {
            floors,
            entranceFaceMask: parcel.frontageMask || 0b1111,
            // Taller parts would bake coarser than BUILDING_VOXEL under the baker's cap
            maxPartHeight: FIELD_SPAN_VOXELS * BUILDING_VOXEL
          }
        });
        const building = new SceneNode(scene);
        building.name = `Building ${index + 1}`;
        building.parent = root;
        building.position = new Vector3(cx, 0, cz);
        const materials = new Map<string, MeshMaterial>();
        const fileBase = `building_${String(index + 1).padStart(3, '0')}`;
        for (const { part, spec } of parts) {
          let parent = building;
          if (parts.length > 1) {
            parent = new SceneNode(scene);
            parent.name = part || 'base';
            parent.parent = building;
          }
          for (const [group, sub] of splitByGroup(spec)) {
            let material = materials.get(group);
            if (!material) {
              const hint = palette[group] ?? FALLBACK_HINT;
              const k = 1 + (hint.variation ?? 0) * tone;
              material = await createSurfaceMaterial({
                albedo: [hint.albedo[0] * k, hint.albedo[1] * k, hint.albedo[2] * k],
                metallic: hint.metallic,
                roughness: hint.roughness
              });
              materials.set(group, material);
            }
            const { mesh, path } = await writeMesh(
              ctx,
              runner,
              sub,
              parts.length > 1
                ? `${fileBase}_${safeName(part)}_${safeName(group)}`
                : `${fileBase}_${safeName(group)}`,
              material,
              parent,
              group
            );
            buildingPaths.push(path);
            const box = recordExtent(mesh, BUILDING_VOXEL);
            if (box) {
              maxHeight = Math.max(maxHeight, box.maxPoint.y);
            }
          }
        }
      }

      if (params.bakeSDF) {
        await bakeGeneratedMeshSDFs(ctx, groundPaths, GROUND_VOXEL);
        await bakeGeneratedMeshSDFs(ctx, buildingPaths, BUILDING_VOXEL);
        sizeFieldAtlases(scene, fieldExtents);
        // Turns the scene SDF on as well
        scene.gi.enabled = true;
      }

      const sun = new DirectionalLight(scene);
      sun.name = 'Sun';
      sun.sunLight = true;
      const elevation = (numParam(params, 'sunElevation') * Math.PI) / 180;
      const azimuth = (numParam(params, 'sunAzimuth') * Math.PI) / 180;
      sun.lookAt(
        new Vector3(
          Math.cos(elevation) * Math.cos(azimuth),
          Math.sin(elevation),
          Math.cos(elevation) * Math.sin(azimuth)
        ),
        Vector3.zero(),
        Vector3.axisPY()
      );
      sun.castShadow = true;
      // Stretch the cascades over the whole block, or only the nearest buildings get shadows
      sun.shadow.shadowDistance = Math.max(200, halfSpan * 2.5);
      sun.shadow.numShadowCascades = 4;

      const viewHeight = Math.max(maxHeight, cellSize * 2);
      setupCamera(
        scene,
        new Vector3(centreX + halfSpan * 0.9, viewHeight * 1.1 + halfSpan * 0.25, centreZ + halfSpan * 0.9),
        new Vector3(centreX, viewHeight * 0.25, centreZ),
        0.5,
        Math.max(1500, halfSpan * 8)
      );
    } finally {
      runner.dispose();
    }
  }
};
