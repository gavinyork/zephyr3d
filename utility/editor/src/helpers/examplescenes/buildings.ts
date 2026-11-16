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
import { Quaternion, Vector3, Vector4 } from '@zephyr3d/base';
import {
  applyMaterialTone,
  availableStyles,
  cityBlockGroundParts,
  cityBlockStreetLights,
  generateBuildingParts,
  generateCityBlock,
  getStyle,
  pickMaterialScheme,
  Random,
  randomMaterialTone,
  type MaterialHint
} from '@zephyr3d/procgen';
import {
  BatchGroup,
  DirectionalLight,
  Mesh,
  SceneNode,
  SpotLight,
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
const REALISTIC_GROUND: Record<string, MaterialHint> = {
  road: { albedo: [0.045, 0.045, 0.05], metallic: 0, roughness: 0.9 },
  sidewalk: { albedo: [0.3, 0.29, 0.27], metallic: 0, roughness: 0.85 },
  kerb: { albedo: [0.42, 0.41, 0.39], metallic: 0, roughness: 0.8 },
  marking: { albedo: [0.7, 0.7, 0.68], metallic: 0, roughness: 0.55 },
  // Lawns between the buildings and a park around the block
  ground: { albedo: [0.045, 0.08, 0.025], metallic: 0, roughness: 0.95 },
  margin: { albedo: [0.035, 0.062, 0.02], metallic: 0, roughness: 0.95 },
  plaza: { albedo: [0.32, 0.27, 0.2], metallic: 0, roughness: 0.78 }
};

/** Light neutral ground under the vivid palette, so colour bled from the facades shows on it */
const NEUTRAL_GROUND: Record<string, MaterialHint> = {
  road: { albedo: [0.08, 0.08, 0.08], metallic: 0, roughness: 0.9 },
  sidewalk: { albedo: [0.55, 0.55, 0.55], metallic: 0, roughness: 0.85 },
  kerb: { albedo: [0.6, 0.6, 0.6], metallic: 0, roughness: 0.8 },
  marking: { albedo: [0.8, 0.8, 0.8], metallic: 0, roughness: 0.55 },
  ground: { albedo: [0.45, 0.45, 0.45], metallic: 0, roughness: 0.9 },
  margin: { albedo: [0.3, 0.3, 0.3], metallic: 0, roughness: 0.9 },
  plaza: { albedo: [0.5, 0.5, 0.5], metallic: 0, roughness: 0.8 }
};

/** Palette choices: a scheme set of the style, or the style's single reference palette */
type PaletteMode = 'realistic' | 'vivid' | 'style';

/** A lit window: a pale diffuser glowing in the building's light colour */
const LIT_WINDOW = { albedo: [0.35, 0.3, 0.22] as [number, number, number], metallic: 0, roughness: 0.6 };
/** Incandescent home lighting */
const WARM_LIGHT: [number, number, number] = [1, 0.72, 0.42];
/** Fluorescent office lighting */
const COOL_LIGHT: [number, number, number] = [0.78, 0.88, 1];
/** Shop window lighting */
const SHOP_LIGHT: [number, number, number] = [1, 0.84, 0.62];
/** Sodium-free warm white of the street lamps */
const STREET_LIGHT = new Vector4(1, 0.8, 0.55, 1);
/** Height of a street lamp's head above the pavement */
const LAMP_HEIGHT = 6;
/** Sun elevation at dusk, in degrees */
const DUSK_SUN_ELEVATION = 3;
/** How far a street lamp's arm reaches out over the road */
const LAMP_REACH = 1.5;
/** A street lamp: pole at the origin, arm and head reaching along +X */
const LAMP_SPEC = {
  version: 1,
  nodes: [
    {
      type: 'cylinder',
      radius: 0.08,
      height: LAMP_HEIGHT,
      segments: 12,
      position: [0, LAMP_HEIGHT * 0.5, 0]
    },
    {
      type: 'box',
      size: [LAMP_REACH + 0.1, 0.08, 0.08],
      position: [(LAMP_REACH + 0.1) * 0.5, LAMP_HEIGHT - 0.05, 0]
    },
    { type: 'box', size: [0.6, 0.14, 0.3], position: [LAMP_REACH, LAMP_HEIGHT - 0.12, 0] }
  ]
};

/** Groups far thinner than a field voxel (road paint, balcony railings); they keep out of the distance field */
const PAINT_GROUPS = new Set(['marking', 'railing']);

/** Baker's cap on voxels per axis, less two voxels of padding on each side */
const FIELD_SPAN_VOXELS = 124;
/** Target edge of a building field voxel: fine enough for street canyons and lobbies */
const BUILDING_VOXEL = 0.5;
/** Target edge of a ground field voxel; a chunk of two 20 m cells comes out near 0.33 */
const GROUND_VOXEL = 0.25;
/** Depth of the ground slabs, a few voxels so the field resolves both faces */
const GROUND_DEPTH = 1.5;

/** Style choice that mixes the built-in styles across the block */
const MIXED_STYLE = 'mixed';
const OFFICE_STYLE = 'modern-office';
const RESIDENTIAL_STYLE = 'urban-residential';
/** Tallest residential block the mixed choice builds */
const RESIDENTIAL_MAX_FLOORS = 10;

function styleOptions() {
  const mixed = { value: MIXED_STYLE, label: 'Mixed (offices in the centre)' };
  try {
    return [
      mixed,
      ...availableStyles().map((id) => {
        let label = id;
        try {
          label = (getStyle(id) as { displayName?: string }).displayName ?? id;
        } catch {
          // keep the id
        }
        return { value: id, label };
      })
    ];
  } catch {
    return [mixed, { value: OFFICE_STYLE, label: 'Modern office' }];
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
    'A city block generated by @zephyr3d/procgen: streets from wave function collapse, office towers and apartment blocks with arcades, balconies and courtyards from shape grammars. Built for testing global illumination.',
  writesAssets: true,
  params: [
    {
      type: 'enum',
      key: 'style',
      label: 'Building Style',
      default: MIXED_STYLE,
      options: styleOptions()
    },
    {
      type: 'enum',
      key: 'palette',
      label: 'Palette',
      default: 'realistic',
      options: [
        { value: 'realistic', label: 'Realistic' },
        { value: 'vivid', label: 'Vivid (GI test)' },
        { value: 'style', label: 'Style Default' }
      ],
      tooltip:
        'Realistic dresses each building in a real facade material, from glass towers to brick and render, over lawns and paving. Vivid paints whole facades in strong flat colours over light grey ground, so colour bleeding from global illumination shows plainly. Style Default uses the single reference palette of the building style'
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
      default: 35,
      min: 5,
      max: 90,
      format: '%.1f°',
      tooltip: 'Height of the sun above the horizon; a low sun throws long shadows down the streets'
    },
    {
      type: 'float',
      key: 'sunAzimuth',
      label: 'Sun Azimuth',
      default: 345,
      min: 0,
      max: 360,
      format: '%.1f°',
      tooltip: 'Direction the sunlight comes from, measured from +X towards +Z'
    },
    {
      type: 'enum',
      key: 'timeOfDay',
      label: 'Time of Day',
      default: 'day',
      options: [
        { value: 'day', label: 'Day' },
        { value: 'dusk', label: 'Dusk' }
      ],
      tooltip:
        'Dusk drops the sun to just above the horizon (Sun Elevation is ignored), lights some windows and every shop front, and turns on the street lamps, so emissive surfaces and local lights carry the indirect lighting'
    },
    {
      type: 'float',
      key: 'litWindows',
      label: 'Lit Windows',
      default: 0.35,
      min: 0,
      max: 1,
      format: '%.2f',
      tooltip: 'At dusk, the share of windows lit from inside'
    },
    {
      type: 'float',
      key: 'windowGlow',
      label: 'Window Glow',
      default: 3,
      min: 0,
      max: 50,
      format: '%.2f',
      tooltip: 'At dusk, how brightly lit windows and shop fronts glow'
    },
    {
      type: 'bool',
      key: 'streetLights',
      label: 'Street Lamps',
      default: true,
      tooltip: 'At dusk, a lamp on every straight stretch of road, alternating sides'
    },
    {
      type: 'float',
      key: 'streetLightIntensity',
      label: 'Street Lamp Intensity',
      default: 50,
      min: 0,
      max: 500,
      format: '%.1f',
      tooltip: 'How brightly each street lamp lights the road under it'
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
    const chosenStyle = String(params.style);
    const paletteMode = String(params.palette ?? 'realistic') as PaletteMode;
    const groundSurfaces = paletteMode === 'vivid' ? NEUTRAL_GROUND : REALISTIC_GROUND;
    const width = Math.max(3, Math.round(numParam(params, 'gridWidth')));
    const depth = Math.max(3, Math.round(numParam(params, 'gridDepth')));
    const cellSize = Math.max(1, numParam(params, 'cellSize'));
    // Keeps at least a metre of pavement on each side
    const roadWidth = Math.max(1, Math.min(numParam(params, 'roadWidth'), cellSize - 2));
    const maxFloors = Math.max(3, Math.round(numParam(params, 'maxFloors')));
    const seed = Math.round(numParam(params, 'seed'));
    const dusk = params.timeOfDay === 'dusk';
    const litWindows = dusk ? Math.min(1, Math.max(0, numParam(params, 'litWindows'))) : 0;
    const windowGlow = Math.max(0, numParam(params, 'windowGlow'));

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
      const recordExtent = (mesh: Mesh, voxel: number, field = true) => {
        const box = mesh.primitive?.getBoundingVolume()?.toAABB();
        if (box && field) {
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
            material = await createSurfaceMaterial(groundSurfaces[surface] ?? FALLBACK_HINT);
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
        const radius = Math.min(1, Math.hypot(cx - centreX, cz - centreZ) / halfSpan);
        const falloff = 1 - radius * 0.65;
        // Mixed: offices hold the centre, apartment blocks take over towards the edge
        const styleId =
          chosenStyle !== MIXED_STYLE
            ? chosenStyle
            : rng.chance(Math.min(0.9, Math.max(0.1, 1.1 - radius * 1.6)))
              ? OFFICE_STYLE
              : RESIDENTIAL_STYLE;
        const style = getStyle(styleId);
        const floors =
          styleId === RESIDENTIAL_STYLE
            ? rng.int(Math.min(4, maxFloors), Math.min(RESIDENTIAL_MAX_FLOORS, maxFloors))
            : Math.max(2, Math.round(rng.int(3, maxFloors) * falloff));
        const buildingSeed = rng.int(0, 1 << 30);
        // One scheme and one tone per building: shifting all groups together keeps a building
        // reading as one object; a style without the chosen scheme set keeps its reference palette
        const schemes = paletteMode === 'style' ? [] : (style.schemeSets?.[paletteMode] ?? []);
        const scheme = pickMaterialScheme(schemes, rng);
        const palette = scheme?.palette ?? style.palette ?? {};
        const tone = scheme
          ? randomMaterialTone(rng)
          : { lightness: rng.next() * 2 - 1, hue: 0, saturation: 0 };
        // Lighting colour of the building's windows: mostly warm homes, some cool offices
        const litTint = dusk ? (rng.chance(0.7) ? WARM_LIGHT : COOL_LIGHT) : WARM_LIGHT;
        // Built around its own footprint centre so the node's pivot sits on the building
        const parts = generateBuildingParts({
          style: styleId,
          seed: buildingSeed,
          footprint: [parcel.width, parcel.depth],
          origin: [-parcel.width * 0.5, 0, -parcel.depth * 0.5],
          params: {
            ...scheme?.params,
            floors,
            entranceFaceMask: parcel.frontageMask || 0b1111,
            litWindowChance: litWindows,
            // Taller parts would bake coarser than BUILDING_VOXEL under the baker's cap
            maxPartHeight: FIELD_SPAN_VOXELS * BUILDING_VOXEL
          }
        });
        const building = new SceneNode(scene);
        building.name = scheme
          ? `Building ${index + 1} (${scheme.displayName ?? scheme.id})`
          : `Building ${index + 1}`;
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
              material = await createSurfaceMaterial(
                group === 'glass-lit'
                  ? { ...LIT_WINDOW, emissive: litTint, emissiveStrength: windowGlow }
                  : group === 'storefront' && dusk
                    ? {
                        ...applyMaterialTone(palette[group] ?? FALLBACK_HINT, tone),
                        emissive: SHOP_LIGHT,
                        emissiveStrength: windowGlow * 1.2
                      }
                    : applyMaterialTone(palette[group] ?? FALLBACK_HINT, tone)
              );
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
            const thin = PAINT_GROUPS.has(group);
            if (thin) {
              // Railings are far thinner than a field voxel; the slab under them stands in
              mesh.sdfMode = 'none';
            } else {
              buildingPaths.push(path);
            }
            const box = recordExtent(mesh, BUILDING_VOXEL, !thin);
            if (box) {
              maxHeight = Math.max(maxHeight, box.maxPoint.y);
            }
          }
        }
      }

      if (dusk && params.streetLights) {
        const placements = cityBlockStreetLights(layout, { roadWidth });
        if (placements.length > 0) {
          ctx.progress('Placing street lamps...');
          // One shared lamp mesh with its arm along +X, turned per lamp to face the road
          const { primitive } = await writeGeneratedPrimitive(ctx, runner, LAMP_SPEC, 'street_lamp');
          const poleMaterial = await createSurfaceMaterial({
            albedo: [0.06, 0.065, 0.07],
            metallic: 0.7,
            roughness: 0.45
          });
          const lamps = new SceneNode(scene);
          lamps.name = 'Street Lamps';
          lamps.parent = scene.rootNode;
          const intensity = Math.max(0, numParam(params, 'streetLightIntensity'));
          placements.forEach((placement, i) => {
            const [x, , z] = placement.position;
            const [tx, tz] = placement.toward;
            const lamp = new Mesh(scene, primitive, poleMaterial);
            lamp.name = `Lamp ${i + 1}`;
            lamp.parent = lamps;
            lamp.position = new Vector3(x, 0, z);
            lamp.rotation = Quaternion.fromAxisAngle(Vector3.axisPY(), Math.atan2(-tz, tx));
            // A pole is far thinner than a field voxel
            lamp.sdfMode = 'none';
            lamp.castShadow = false;
            const head = new Vector3(x + tx * LAMP_REACH, LAMP_HEIGHT - 0.2, z + tz * LAMP_REACH);
            const light = new SpotLight(scene);
            light.name = `Lamp Light ${i + 1}`;
            light.parent = lamps;
            light.color = new Vector4(STREET_LIGHT);
            light.intensity = intensity;
            light.range = LAMP_HEIGHT * 2.5;
            light.cutoff = Math.cos((60 * Math.PI) / 180);
            light.castShadow = false;
            // Aimed down and a little out over the road
            light.lookAt(head, new Vector3(head.x + tx * 2, 0, head.z + tz * 2), Vector3.axisPY());
          });
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
      const elevation = ((dusk ? DUSK_SUN_ELEVATION : numParam(params, 'sunElevation')) * Math.PI) / 180;
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
