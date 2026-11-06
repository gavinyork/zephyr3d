/**
 * Example scenes the editor can generate from Scene > Create Example Scene.
 *
 * Every scene type describes its creation parameters as data, so the dialog renders them without
 * knowing the type, and builds its content into a fresh {@link Scene} that is not yet shown.
 */
import { Vector3, Vector4, type VFS } from '@zephyr3d/base';
import {
  getEngine,
  PerspectiveCamera,
  readMeshImportSettings,
  SDF_VOXELS_PER_UNIT,
  SharedModel,
  writeMeshImportSettings,
  type MeshMaterial,
  type PBRMetallicRoughnessMaterial,
  type Scene
} from '@zephyr3d/scene';
import type { GeneratedModelRunner } from '../generatedprimitive';
import { MeshSDFBaker } from '../../core/services/sdfbaker';

export type ExampleParamValue = number | boolean | string;

export type ExampleParamDef =
  | {
      type: 'int';
      key: string;
      label: string;
      default: number;
      min: number;
      max: number;
      tooltip?: string;
    }
  | {
      type: 'float';
      key: string;
      label: string;
      default: number;
      min: number;
      max: number;
      format?: string;
      tooltip?: string;
    }
  | { type: 'bool'; key: string; label: string; default: boolean; tooltip?: string }
  | {
      type: 'enum';
      key: string;
      label: string;
      default: string;
      /** Allowed values, with the label shown for each */
      options: { value: string; label: string }[];
      tooltip?: string;
    };

export type ExampleParams = Record<string, ExampleParamValue>;

export interface ExampleSceneBuildContext {
  /** The scene being built, not yet shown in the editor */
  scene: Scene;
  /** Project file system */
  vfs: VFS;
  /** Directory the type may write generated assets into; created on demand by {@link ensureAssetDir} */
  assetDir: string;
  /** Reports progress on the editor status bar */
  progress(text: string): void;
}

export interface ExampleSceneType {
  id: string;
  label: string;
  /** One-line summary shown in the dialog */
  description: string;
  params: ExampleParamDef[];
  /** Whether the type writes files into {@link ExampleSceneBuildContext.assetDir} */
  writesAssets: boolean;
  build(ctx: ExampleSceneBuildContext, params: ExampleParams): Promise<void>;
}

export function defaultParams(type: ExampleSceneType): ExampleParams {
  const params: ExampleParams = {};
  for (const def of type.params) {
    params[def.key] = def.default;
  }
  return params;
}

export function numParam(params: ExampleParams, key: string) {
  return Number(params[key]);
}

export async function ensureAssetDir(ctx: ExampleSceneBuildContext) {
  if (!(await ctx.vfs.exists(ctx.assetDir))) {
    await ctx.vfs.makeDirectory(ctx.assetDir, true);
  }
}

export const BUILTIN_PBR_MATERIAL = '/assets/@builtins/materials/pbr_metallic_roughness.zmtl';
export const BUILTIN_BOX = '/assets/@builtins/primitives/box.zmsh';
export const BUILTIN_PLANE = '/assets/@builtins/primitives/plane.zmsh';

export interface SurfaceDesc {
  albedo: [number, number, number];
  metallic?: number;
  roughness?: number;
  emissive?: [number, number, number];
  emissiveStrength?: number;
}

/**
 * Makes an instance of the built-in PBR material.
 *
 * Instances keep their colours in per-instance uniforms, which the scene file stores with the mesh,
 * so example scenes need no material assets of their own.
 */
export async function createSurfaceMaterial(desc: SurfaceDesc): Promise<MeshMaterial> {
  const core =
    await getEngine().resourceManager.fetchMaterial<PBRMetallicRoughnessMaterial>(BUILTIN_PBR_MATERIAL);
  if (!core) {
    throw new Error(`Cannot load the built-in PBR material: ${BUILTIN_PBR_MATERIAL}`);
  }
  const material = core.createInstance();
  material.albedoColor = new Vector4(desc.albedo[0], desc.albedo[1], desc.albedo[2], 1);
  material.metallic = desc.metallic ?? 0;
  material.roughness = desc.roughness ?? 1;
  if (desc.emissive) {
    material.emissiveColor = new Vector3(desc.emissive[0], desc.emissive[1], desc.emissive[2]);
    material.emissiveStrength = desc.emissiveStrength ?? 1;
  }
  return material;
}

export async function fetchBuiltinPrimitive(path: string) {
  const primitive = await getEngine().resourceManager.fetchPrimitive(path);
  if (!primitive) {
    throw new Error(`Cannot load the built-in primitive: ${path}`);
  }
  return primitive;
}

/** Gives the scene its main camera, looking from `eye` at `target` */
export function setupCamera(scene: Scene, eye: Vector3, target: Vector3, near: number, far: number) {
  const camera = new PerspectiveCamera(scene, Math.PI / 3, near, far);
  camera.name = 'Camera';
  camera.lookAt(eye, target, Vector3.axisPY());
  scene.mainCamera = camera;
  return camera;
}

/**
 * Tessellates a procedural model spec and writes it as `<assetDir>/<fileName>.zmsh`.
 * @returns The asset path and the loaded primitive
 */
export async function writeGeneratedPrimitive(
  ctx: ExampleSceneBuildContext,
  runner: GeneratedModelRunner,
  spec: unknown,
  fileName: string
) {
  await ensureAssetDir(ctx);
  const path = `${ctx.assetDir}/${fileName}.zmsh`;
  await SharedModel.writePrimitive(ctx.vfs, await runner.generate(spec), path);
  const primitive = await getEngine().resourceManager.fetchPrimitive(path);
  if (!primitive) {
    throw new Error(`Generated mesh was written but could not be loaded: ${path}`);
  }
  return { path, primitive };
}

/**
 * Bakes the signed distance fields of generated meshes, which global illumination traces against.
 *
 * The meshes must be used unscaled, so their local units are world units. The voxel size is
 * stored in each mesh's import settings as a resolution scale, so a later rebake from the mesh
 * settings dialog keeps it.
 *
 * @param paths - Mesh asset paths
 * @param voxelSize - Edge of a field voxel in world units
 */
export async function bakeGeneratedMeshSDFs(
  ctx: ExampleSceneBuildContext,
  paths: string[],
  voxelSize: number
) {
  // Rounded so the bake key does not change with float noise
  const resolutionScale = Number((1 / (SDF_VOXELS_PER_UNIT * voxelSize)).toPrecision(4));
  for (const path of paths) {
    const settings = await readMeshImportSettings(ctx.vfs, path);
    await writeMeshImportSettings(ctx.vfs, path, {
      ...settings,
      sdfResolutionScale: resolutionScale,
      sdfUnitScale: 1,
      sdfTwoSided: false
    });
  }
  const results = await MeshSDFBaker.bakeAll(paths, true, (done, total) =>
    ctx.progress(`Baking distance fields... ${done} / ${total}`)
  );
  const failed = results.filter((r) => r.err);
  if (failed.length > 0) {
    throw new Error(`Baking distance fields failed: ${failed.map((r) => `${r.path}: ${r.err}`).join('; ')}`);
  }
}
