/**
 * Cornell box, after the Cornell University Program of Computer Graphics reference scene.
 *
 * Proportions and block placement follow the published measurements (a 555 unit room, a 165 unit
 * short cube and a 165 x 330 x 165 tall block); wall colours are the usual linear RGB fit of the
 * measured reflectance spectra (white 0.73, red 0.63/0.065/0.05, green 0.14/0.45/0.091).
 *
 * Every part is its own mesh asset at its real size, used without scaling, with a baked signed
 * distance field so global illumination can trace the room. A shared unit box scaled per node
 * would not do: built-in meshes have no field, and under non-uniform scale a field only gives
 * distances scaled by the smallest axis, far too short along a wall.
 */
import { Quaternion, Vector3 } from '@zephyr3d/base';
import { Mesh, RectLight, SceneNode, type MeshMaterial, type Primitive } from '@zephyr3d/scene';
import { GeneratedModelRunner } from '../generatedprimitive';
import {
  BUILTIN_BOX,
  bakeGeneratedMeshSDFs,
  createSurfaceMaterial,
  fetchBuiltinPrimitive,
  numParam,
  setupCamera,
  writeGeneratedPrimitive,
  type ExampleSceneBuildContext,
  type ExampleSceneType
} from './common';

const WHITE: [number, number, number] = [0.73, 0.73, 0.73];
const RED: [number, number, number] = [0.63, 0.065, 0.05];
const GREEN: [number, number, number] = [0.14, 0.45, 0.091];

/** Reference room size; positions below are in these units */
const REF = 555;

/**
 * Wall thickness in reference units. The reference room has no thickness; the walls are built
 * outward from the interior, so this only shows at the open front. Chosen so a wall spans about
 * four field voxels (see {@link FIELD_VOXELS}) and traced light cannot slip through it.
 */
const WALL = 20;

/**
 * Field voxels across the largest part, the floor or ceiling slab. The baker caps a field at 128
 * voxels per axis including two voxels of padding on each side; filling that cap gives the finest
 * field that is never clamped. Every size in the room is proportional to the room size, so the
 * same voxel counts hold for any room size: walls about 4 voxels thick, the short block 32 wide.
 */
const FIELD_VOXELS = 124;

class PartBuilder {
  readonly paths: string[] = [];
  constructor(
    private readonly ctx: ExampleSceneBuildContext,
    private readonly runner: GeneratedModelRunner,
    private readonly parent: SceneNode
  ) {}
  /** Generates a mesh asset from one procedural node and places it, unscaled */
  async add(
    name: string,
    node: Record<string, unknown>,
    material: MeshMaterial,
    position: Vector3,
    rotationY = 0
  ) {
    const fileName = name.toLowerCase().replace(/\s+/g, '_');
    const { path, primitive } = await writeGeneratedPrimitive(
      this.ctx,
      this.runner,
      { version: 1, nodes: [node] },
      fileName
    );
    this.paths.push(path);
    return this.place(name, primitive, material, position, rotationY);
  }
  place(name: string, primitive: Primitive, material: MeshMaterial, position: Vector3, rotationY = 0) {
    const mesh = new Mesh(this.ctx.scene, primitive, material);
    mesh.name = name;
    mesh.parent = this.parent;
    mesh.position = position;
    if (rotationY) {
      mesh.rotation = Quaternion.fromAxisAngle(Vector3.axisPY(), rotationY);
    }
    return mesh;
  }
}

function box(sx: number, sy: number, sz: number) {
  return { type: 'box', size: [sx, sy, sz] };
}

export const cornellBoxScene: ExampleSceneType = {
  id: 'cornell-box',
  label: 'Cornell Box',
  description:
    'The classic closed room with a red and a green wall, lit by an area light on the ceiling. Its meshes come with baked distance fields for global illumination.',
  writesAssets: true,
  params: [
    {
      type: 'float',
      key: 'size',
      label: 'Room Size',
      default: 5.55,
      min: 0.5,
      max: 100,
      format: '%.2f',
      tooltip: 'Inner width, depth and height of the room in world units'
    },
    {
      type: 'enum',
      key: 'contents',
      label: 'Contents',
      default: 'blocks',
      options: [
        { value: 'blocks', label: 'Two blocks (original)' },
        { value: 'spheres', label: 'Mirror and diffuse spheres' },
        { value: 'empty', label: 'Empty' }
      ]
    },
    {
      type: 'float',
      key: 'lightIntensity',
      label: 'Light Intensity',
      default: 15,
      min: 0,
      max: 1000,
      format: '%.1f',
      tooltip: 'Intensity of the ceiling area light'
    },
    {
      type: 'bool',
      key: 'lightShadow',
      label: 'Light Casts Shadow',
      default: true
    },
    {
      type: 'bool',
      key: 'skyLight',
      label: 'Sky Lighting',
      default: true,
      tooltip: 'Keep the sky as ambient light. Turn off to see only light that comes from the ceiling.'
    }
  ],
  async build(ctx, params) {
    const scene = ctx.scene;
    const size = Math.max(0.01, numParam(params, 'size'));
    const u = size / REF;
    const wall = WALL * u;
    const half = size * 0.5;
    const white = await createSurfaceMaterial({ albedo: WHITE, roughness: 0.9 });
    const red = await createSurfaceMaterial({ albedo: RED, roughness: 0.9 });
    const green = await createSurfaceMaterial({ albedo: GREEN, roughness: 0.9 });

    scene.env.sky.fogType = 'none';
    if (!params.skyLight) {
      scene.env.light.type = 'none';
    }

    const root = new SceneNode(scene);
    root.name = 'Cornell Box';
    root.parent = scene.rootNode;

    const runner = new GeneratedModelRunner();
    const parts = new PartBuilder(ctx, runner, root);
    try {
      ctx.progress('Generating Cornell box meshes...');
      // The room's interior spans [-size/2, size/2] on X and Z and [0, size] on Y, open towards +Z
      const outer = size + 2 * wall;
      await parts.add('Floor', box(outer, wall, outer), white, new Vector3(0, -wall * 0.5, 0));
      await parts.add('Ceiling', box(outer, wall, outer), white, new Vector3(0, size + wall * 0.5, 0));
      await parts.add('Back Wall', box(outer, size, wall), white, new Vector3(0, half, -half - wall * 0.5));
      await parts.add('Left Wall', box(wall, size, size), red, new Vector3(-half - wall * 0.5, half, 0));
      await parts.add('Right Wall', box(wall, size, size), green, new Vector3(half + wall * 0.5, half, 0));

      // Reference coordinates have X running from the red wall at 556 to the green wall at 0 and
      // Z from the open front at 0 to the back at 559; map them into the room
      const toRoom = (x: number, z: number) => [(REF * 0.5 - x) * u, (REF * 0.5 - z) * u] as const;
      const contents = String(params.contents);
      if (contents === 'blocks') {
        const [sx, sz] = toRoom(185.5, 169);
        await parts.add(
          'Short Block',
          box(165 * u, 165 * u, 165 * u),
          white,
          new Vector3(sx, 82.5 * u, sz),
          -0.29
        );
        const [tx, tz] = toRoom(368.5, 351.5);
        await parts.add(
          'Tall Block',
          box(165 * u, 330 * u, 165 * u),
          white,
          new Vector3(tx, 165 * u, tz),
          0.29
        );
      } else if (contents === 'spheres') {
        const mirror = await createSurfaceMaterial({
          albedo: [0.95, 0.95, 0.95],
          metallic: 1,
          roughness: 0.05
        });
        const radius = 100 * u;
        const sphere = { type: 'sphere', radius, widthSegments: 64, heightSegments: 32 };
        const [mx, mz] = toRoom(368.5, 351.5);
        await parts.add('Mirror Sphere', sphere, mirror, new Vector3(mx, radius, mz));
        const [dx, dz] = toRoom(185.5, 169);
        await parts.add('Diffuse Sphere', sphere, white, new Vector3(dx, radius, dz));
      }

      // One voxel size for every part, so the whole room is traced at an even resolution
      await bakeGeneratedMeshSDFs(ctx, parts.paths, outer / FIELD_VOXELS);
    } finally {
      runner.dispose();
    }

    // The reference light is a 130 x 105 opening just below the ceiling
    const lightW = 130 * u;
    const lightD = 105 * u;
    const panelThickness = 2 * u;
    const intensity = Math.max(0, numParam(params, 'lightIntensity'));
    const panel = parts.place(
      'Light Panel',
      await fetchBuiltinPrimitive(BUILTIN_BOX),
      await createSurfaceMaterial({
        albedo: [0.78, 0.78, 0.78],
        roughness: 1,
        emissive: [1, 1, 1],
        emissiveStrength: intensity
      }),
      new Vector3(0, size - panelThickness * 0.5, 0)
    );
    panel.scale = new Vector3(lightW, panelThickness, lightD);
    // The panel sits between the light and the ceiling; it must not shadow its own light
    panel.castShadow = false;
    // The rect light below already carries this light into global illumination; the panel's
    // emission in the traced scene would count it twice
    panel.sdfMode = 'none';
    const light = new RectLight(scene);
    light.name = 'Ceiling Light';
    light.parent = root;
    light.width = lightW;
    light.height = lightD;
    light.intensity = intensity;
    light.range = size * 2;
    // A rect light emits along its local -Z
    const lightPos = new Vector3(0, size - panelThickness - 0.5 * u, 0);
    light.lookAt(lightPos, new Vector3(lightPos.x, lightPos.y - 1, lightPos.z), Vector3.axisPZ());
    light.castShadow = !!params.lightShadow;

    setupCamera(scene, new Vector3(0, half, size * 1.62), new Vector3(0, half, 0), size * 0.01, size * 50);
  }
};
