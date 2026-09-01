import type { Nullable, VFS } from '@zephyr3d/base';
import { Matrix4x4, PathUtils, Vector3, Vector4 } from '@zephyr3d/base';
import type {
  AssetMaterial,
  AssetPBRMaterialMR,
  AssetPrimitiveInfo,
  AssetTextureInfo,
  SharedModel
} from '@zephyr3d/scene';
import { AssetHierarchyNode, AssetScene } from '@zephyr3d/scene';
import type { VertexAttribFormat, VertexSemantic } from '@zephyr3d/device';
import { AbstractModelImporter } from '../importer';
import {
  parseMtl,
  parseObj,
  type ObjDocument,
  type ObjFaceVertex,
  type ObjGroup,
  type ObjMaterial,
  type ObjTextureMap
} from './parser';

type Normal = [number, number, number];

export type ObjUpAxis = 'y' | 'z';

export type OBJImporterOptions = {
  /**
   * Up axis used by the source OBJ.
   *
   * OBJ files do not carry axis metadata. Most editor assets are authored by
   * Z-up tools, so the default converts Z-up coordinates into the engine's
   * Y-up coordinate system.
   */
  upAxis?: ObjUpAxis;
};

type ObjBuildResult = {
  primitive: AssetPrimitiveInfo;
  hasVertexColor: boolean;
  rawPositions: Float32Array;
};

const DEFAULT_SAMPLER = {
  wrapS: 'repeat' as const,
  wrapT: 'repeat' as const,
  magFilter: 'linear' as const,
  minFilter: 'linear' as const,
  mipFilter: 'linear' as const
};

function normalize(value: Normal): Normal {
  const length = Math.hypot(value[0], value[1], value[2]);
  return length > 1e-12
    ? [value[0] / length || 0, value[1] / length || 0, value[2] / length || 0]
    : [0, 0, 1];
}

function subtract(a: [number, number, number], b: [number, number, number]): Normal {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a: Normal, b: Normal): Normal {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function add(a: Normal, b: Normal): Normal {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function convertAxis(value: Normal, upAxis: ObjUpAxis): Normal {
  if (upAxis === 'y') {
    return [value[0], value[1], value[2]];
  }
  return [value[0], value[2], value[1] === 0 ? 0 : -value[1]];
}

function resolveResourcePath(basePath: string, path: string, vfs: VFS) {
  const normalized = path.replace(/\\/g, '/');
  return vfs.parseDataURI(normalized) || vfs.isAbsoluteURL(normalized)
    ? normalized
    : vfs.normalizePath(vfs.join(basePath, normalized));
}

function createTextureInfo(
  basePath: string,
  map: Nullable<ObjTextureMap> | undefined,
  vfs: Nullable<VFS>,
  sRGB: boolean,
  imageCache: Map<string, AssetTextureInfo['image']>
): AssetTextureInfo | undefined {
  if (!map || !vfs) {
    return undefined;
  }
  const uri = resolveResourcePath(basePath, map.path, vfs);
  let image = imageCache.get(uri);
  if (!image) {
    image = { uri };
    imageCache.set(uri, image);
  }
  const transform = new Matrix4x4().identity();
  transform.scaleLeft(new Vector3(map.scale[0], map.scale[1], 1));
  transform.translateLeft(new Vector3(map.offset[0], map.offset[1], 0));
  return {
    name: PathUtils.basename(map.path, PathUtils.extname(map.path)) || undefined,
    image,
    sRGB,
    sampler: {
      ...DEFAULT_SAMPLER,
      ...(map.clamp ? { wrapS: 'clamp' as const, wrapT: 'clamp' as const } : {})
    },
    texCoord: 0,
    transform
  };
}

function registerTextureInfo(
  model: SharedModel,
  image: AssetTextureInfo['image'],
  imageIndices: Map<NonNullable<AssetTextureInfo['image']>, number>
) {
  if (!image || imageIndices.has(image)) {
    return;
  }
  const index = imageIndices.size;
  imageIndices.set(image, index);
  model.setImage(index, image);
}

function createMaterialAsset(
  source: Nullable<ObjMaterial>,
  materialName: Nullable<string>,
  model: SharedModel,
  basePath: string,
  vfs: Nullable<VFS>,
  hasVertexColor: boolean,
  imageCache: Map<string, AssetTextureInfo['image']>,
  imageIndices: Map<NonNullable<AssetTextureInfo['image']>, number>
): AssetMaterial {
  const material = source ?? {
    name: materialName ?? 'default',
    diffuse: [0.8, 0.8, 0.8] as [number, number, number],
    specular: [0, 0, 0] as [number, number, number],
    emissive: [0, 0, 0] as [number, number, number],
    shininess: 0,
    opacity: 1,
    ior: 1.5
  };
  const diffuseMap = createTextureInfo(basePath, material.diffuseMap, vfs, true, imageCache);
  const normalMap = createTextureInfo(basePath, material.normalMap, vfs, false, imageCache);
  const specularColorMap = createTextureInfo(basePath, material.specularColorMap, vfs, true, imageCache);
  const emissiveMap = createTextureInfo(basePath, material.emissiveMap, vfs, true, imageCache);
  const alphaMap = createTextureInfo(basePath, material.alphaMap, vfs, false, imageCache);
  for (const info of [diffuseMap, normalMap, specularColorMap, emissiveMap, alphaMap]) {
    registerTextureInfo(model, info?.image ?? null, imageIndices);
  }
  const alpha = Math.max(0, Math.min(1, material.opacity));
  const assetMaterial: AssetPBRMaterialMR = {
    name: material.name || materialName || undefined,
    type: 'pbrMetallicRoughness',
    common: {
      vertexColor: hasVertexColor,
      vertexNormal: true,
      useTangent: false,
      alphaMode: alpha < 0.999 ? 'blend' : undefined,
      bumpScale: material.normalMap?.bumpScale ?? 1,
      normalMap,
      emissiveMap,
      emissiveColor: new Vector3(...material.emissive),
      emissiveStrength: 1,
      occlusionStrength: 1
    },
    ior: material.ior,
    diffuse: new Vector4(material.diffuse[0], material.diffuse[1], material.diffuse[2], alpha),
    metallic: material.metallic ?? 0,
    roughness: material.roughness ?? Math.max(0.04, 1 - Math.min(material.shininess / 1000, 1)),
    diffuseMap,
    specularColorMap,
    specularFactor: new Vector4(material.specular[0], material.specular[1], material.specular[2], 1),
    metallicIndex: 2,
    roughnessIndex: 1
  };
  if (alphaMap && !diffuseMap) {
    assetMaterial.common.alphaMode = 'blend';
  }
  return assetMaterial;
}

function getTriangleNormal(
  document: ObjDocument,
  vertices: [ObjFaceVertex, ObjFaceVertex, ObjFaceVertex],
  upAxis: ObjUpAxis
) {
  const a = convertAxis(document.positions[vertices[0].position].value, upAxis);
  const b = convertAxis(document.positions[vertices[1].position].value, upAxis);
  const c = convertAxis(document.positions[vertices[2].position].value, upAxis);
  return cross(subtract(b, a), subtract(c, a));
}

function getGeneratedNormal(
  document: ObjDocument,
  triangle: ObjGroup['triangles'][number],
  corner: ObjFaceVertex,
  smoothNormals: Map<string, Normal>,
  triangleNormal: Normal,
  upAxis: ObjUpAxis
) {
  if (corner.normal >= 0) {
    return normalize(convertAxis(document.normals[corner.normal], upAxis));
  }
  if (!triangle.smoothingGroup) {
    return normalize(triangleNormal);
  }
  return normalize(smoothNormals.get(`${corner.position}\0${triangle.smoothingGroup}`) ?? triangleNormal);
}

function createPrimitive(document: ObjDocument, group: ObjGroup, upAxis: ObjUpAxis): ObjBuildResult {
  const hasVertexColor = document.positions.some((position) => !!position.color);
  const hasVertexTexCoord = group.triangles.some((triangle) =>
    triangle.vertices.some((vertex) => vertex.texCoord >= 0)
  );
  const smoothNormals = new Map<string, Normal>();
  const triangleNormals = new Map<number, Normal>();
  for (const triangle of group.triangles) {
    const triangleNormal = getTriangleNormal(document, triangle.vertices, upAxis);
    triangleNormals.set(triangle.faceIndex, triangleNormal);
    if (triangle.smoothingGroup) {
      for (const vertex of triangle.vertices) {
        const key = `${vertex.position}\0${triangle.smoothingGroup}`;
        smoothNormals.set(key, add(smoothNormals.get(key) ?? [0, 0, 0], triangleNormal));
      }
    }
  }

  const positions: number[] = [];
  const normals: number[] = [];
  const texCoords: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const vertexMap = new Map<string, number>();
  for (const triangle of group.triangles) {
    const triangleNormal = triangleNormals.get(triangle.faceIndex) ?? [0, 0, 1];
    for (const vertex of triangle.vertices) {
      const normal = getGeneratedNormal(document, triangle, vertex, smoothNormals, triangleNormal, upAxis);
      const key = [
        vertex.position,
        vertex.texCoord,
        vertex.normal >= 0
          ? `n${vertex.normal}`
          : triangle.smoothingGroup
            ? `s${triangle.smoothingGroup}`
            : `f${triangle.faceIndex}`,
        hasVertexColor ? `c${vertex.position}` : ''
      ].join('/');
      let index = vertexMap.get(key);
      if (index === undefined) {
        index = positions.length / 3;
        vertexMap.set(key, index);
        const position = convertAxis(document.positions[vertex.position].value, upAxis);
        positions.push(position[0], position[1], position[2]);
        normals.push(normal[0], normal[1], normal[2]);
        if (hasVertexTexCoord && vertex.texCoord >= 0) {
          const texCoord = document.texCoords[vertex.texCoord];
          texCoords.push(texCoord[0], texCoord[1]);
        } else if (hasVertexTexCoord) {
          texCoords.push(0, 0);
        }
        if (hasVertexColor) {
          const color = document.positions[vertex.position].color ?? [1, 1, 1, 1];
          colors.push(color[0], color[1], color[2], color[3]);
        }
      }
      indices.push(index);
    }
  }

  const min = new Vector3(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
  const max = new Vector3(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY);
  for (let i = 0; i < positions.length; i += 3) {
    min.x = Math.min(min.x, positions[i]);
    min.y = Math.min(min.y, positions[i + 1]);
    min.z = Math.min(min.z, positions[i + 2]);
    max.x = Math.max(max.x, positions[i]);
    max.y = Math.max(max.y, positions[i + 1]);
    max.z = Math.max(max.z, positions[i + 2]);
  }
  if (!Number.isFinite(min.x)) {
    min.setXYZ(0, 0, 0);
    max.setXYZ(0, 0, 0);
  }
  const positionData = copyFloat32Array(positions);
  const normalData = copyFloat32Array(normals);
  const vertices = {
    position: { format: 'position_f32x3' as VertexAttribFormat, data: positionData },
    normal: { format: 'normal_f32x3' as VertexAttribFormat, data: normalData },
    ...(hasVertexTexCoord
      ? {
          texCoord0: {
            format: 'tex0_f32x2' as VertexAttribFormat,
            data: copyFloat32Array(texCoords)
          }
        }
      : {}),
    ...(hasVertexColor
      ? {
          diffuse: {
            format: 'diffuse_f32x4' as VertexAttribFormat,
            data: copyFloat32Array(colors)
          }
        }
      : {})
  } as unknown as Record<VertexSemantic, { format: VertexAttribFormat; data: Float32Array<ArrayBuffer> }>;
  const primitive: AssetPrimitiveInfo = {
    name: group.name,
    vertices,
    indices: new Uint32Array(indices),
    indexCount: indices.length,
    type: 'triangle-list',
    boxMin: min,
    boxMax: max
  };
  return { primitive, hasVertexColor, rawPositions: positionData };
}

function copyFloat32Array(values: number[]): Float32Array<ArrayBuffer> {
  const data = new Float32Array(new ArrayBuffer(values.length * Float32Array.BYTES_PER_ELEMENT));
  data.set(values);
  return data;
}

async function loadMaterials(
  document: ObjDocument,
  basePath: string,
  vfs: Nullable<VFS>
): Promise<Map<string, ObjMaterial>> {
  const materials = new Map<string, ObjMaterial>();
  if (!vfs) {
    return materials;
  }
  for (const path of document.mtllibs) {
    const resolvedPath = resolveResourcePath(basePath, path, vfs);
    try {
      const value = await vfs.readFile(resolvedPath, { encoding: 'utf8' });
      const source = typeof value === 'string' ? value : new TextDecoder().decode(value);
      for (const [name, material] of parseMtl(source)) {
        materials.set(name, material);
      }
    } catch (err) {
      console.warn(`Could not load OBJ material library "${resolvedPath}": ${err}`);
    }
  }
  return materials;
}

/**
 * OBJ/MTL model importer.
 *
 * The importer supports polygonal OBJ meshes, external MTL libraries, common
 * diffuse/specular/normal/emissive maps, negative indices and generated normals.
 *
 * @public
 */
export class OBJImporter extends AbstractModelImporter {
  private readonly _upAxis: ObjUpAxis;

  constructor(options?: OBJImporterOptions) {
    super();
    this._upAxis = options?.upAxis ?? 'z';
  }

  async import(data: Blob, model: SharedModel, basePath: string, vfs?: VFS) {
    const source = await data.text();
    const document = parseObj(source);
    if (document.positions.length === 0 || document.groups.length === 0) {
      throw new Error('Invalid OBJ: no renderable faces found');
    }
    const materials = await loadMaterials(document, basePath, vfs ?? null);
    const imageCache = new Map<string, AssetTextureInfo['image']>();
    const imageIndices = new Map<NonNullable<AssetTextureInfo['image']>, number>();
    const root = new AssetHierarchyNode('OBJ', model);
    let meshIndex = 0;
    for (const group of document.groups) {
      if (group.triangles.length === 0) {
        continue;
      }
      const built = createPrimitive(document, group, this._upAxis);
      const primitive = built.primitive;
      model.addPrimitive(primitive);
      const nodeName = group.name || `Object_${meshIndex}`;
      const node = new AssetHierarchyNode(nodeName, model, root);
      const materialName = group.materialName;
      const materialHash = `obj_${materialName ?? 'default'}_${built.hasVertexColor ? 'C' : 'N'}`;
      let material = model.getMaterial(materialHash);
      if (!material) {
        material = createMaterialAsset(
          materials.get(materialName ?? '') ?? null,
          materialName,
          model,
          basePath,
          vfs ?? null,
          built.hasVertexColor,
          imageCache,
          imageIndices
        );
        model.setMaterial(materialHash, material);
      }
      node.mesh = {
        subMeshes: [
          {
            primitive,
            material,
            rawPositions: built.rawPositions,
            rawBlendIndices: null,
            rawJointWeights: null,
            name: nodeName,
            numTargets: 0
          }
        ]
      };
      meshIndex++;
    }
    if (root.children.length === 0) {
      throw new Error('Invalid OBJ: no renderable faces found');
    }
    const scene = new AssetScene('Scene');
    scene.rootNodes.push(root);
    model.scenes.push(scene);
    model.activeScene = 0;
    root.computeTransforms(null);
  }
}
