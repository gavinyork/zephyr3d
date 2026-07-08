import type { EulerAngleOrder, Nullable, VFS } from '@zephyr3d/base';
import { ASSERT, Matrix4x4, PathUtils, Quaternion, Vector3, Vector4 } from '@zephyr3d/base';
import type {
  PrimitiveType,
  TextureAddressMode,
  TextureFilterMode,
  VertexAttribFormat,
  VertexSemantic
} from '@zephyr3d/device';
import {
  AssetHierarchyNode,
  AssetScene,
  AssetSkeleton,
  BoundingBox,
  getEngine,
  MORPH_TARGET_NORMAL,
  MORPH_TARGET_POSITION,
  SharedModel,
  type AssetImageInfo,
  type AssetMaterial,
  type AssetMeshData,
  type AssetPBRMaterialMR,
  type AssetPrimitiveInfo,
  type AssetSubMeshData,
  type AssetTextureInfo
} from '@zephyr3d/scene';
import { AbstractModelImporter } from '../importer';
import { parseFbx } from './parser';
import type {
  FbxBlendShapeChannelData,
  FbxClusterData,
  FbxConnection,
  FbxDocument,
  FbxGeometryData,
  FbxLayerElementData,
  FbxMaterialData,
  FbxModelData,
  FbxNode,
  FbxObjectMap,
  FbxPrimitiveBuildData,
  FbxShapeData,
  FbxSkinData,
  FbxTextureData,
  FbxTransformData,
  FbxVideoData
} from './types';

type FbxImportContext = {
  document: FbxDocument;
  unitScale: number;
  objects: FbxObjectMap;
  connectionChildren: Map<number, FbxConnection[]>;
  connectionParents: Map<number, FbxConnection[]>;
  modelMap: Map<number, FbxModelData>;
  geometryMap: Map<number, FbxGeometryData>;
  materialMap: Map<number, FbxMaterialData>;
  textureMap: Map<number, FbxTextureData>;
  videoMap: Map<number, FbxVideoData>;
  skinMap: Map<number, FbxSkinData>;
  bindWorldMap: Map<number, Matrix4x4>;
  bindWorldCache: Map<number, Matrix4x4>;
  skeletonMap: Map<number, AssetSkeleton>;
  jointBindMatrices: Map<string, Matrix4x4>;
  skeletonJointIds: Set<number>;
  imageSet: Set<AssetImageInfo>;
  nextImageIndex: number;
  nodeMap: Map<number, AssetHierarchyNode>;
  basePath: string;
  vfs: VFS;
};

function toUint8Array(data: Uint8Array<ArrayBufferLike>) {
  return new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer);
}

function toUint16Array(data: Uint16Array<ArrayBufferLike>) {
  return new Uint16Array(
    data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
  );
}

function toUint32Array(data: Uint32Array<ArrayBufferLike>) {
  return new Uint32Array(
    data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
  );
}

function toFloat32Array(data: Float32Array<ArrayBufferLike>) {
  return new Float32Array(
    data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
  );
}

function toVertexRecord(
  vertices: Partial<
    Record<VertexSemantic, { format: VertexAttribFormat; data: Float32Array | Uint16Array | Uint32Array }>
  >
) {
  const record = {} as Record<
    VertexSemantic,
    { format: VertexAttribFormat; data: Float32Array | Uint16Array | Uint32Array }
  >;
  for (const key of Object.keys(vertices) as VertexSemantic[]) {
    record[key] = vertices[key]!;
  }
  return record;
}

const TMP_VEC3 = new Vector3();
const TMP_VEC3_B = new Vector3();
const TMP_VEC4 = new Vector4();

function asNumber(value: unknown, fallback = 0) {
  if (typeof value === 'bigint') {
    return Number(value);
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : fallback;
  }
  return fallback;
}

function asString(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function getChild(node: Nullable<FbxNode>, name: string) {
  return node?.children.find((child) => child.name === name) ?? null;
}

function getChildren(node: Nullable<FbxNode>, name: string) {
  return node?.children.filter((child) => child.name === name) ?? [];
}

function getProperty70(node: Nullable<FbxNode>, name: string) {
  if (!node) {
    return null;
  }
  const props70 = getChild(node, 'Properties70');
  if (!props70) {
    return null;
  }
  for (const prop of getChildren(props70, 'P')) {
    if (asString(prop.properties[0]) === name) {
      return prop;
    }
  }
  return null;
}

function getProperty70Value(
  node: Nullable<FbxNode>,
  name: string,
  fallback: [number, number, number] | number
): [number, number, number] | number {
  const prop = getProperty70(node, name);
  if (!prop) {
    return fallback;
  }
  const values = prop.properties.slice(4);
  if (typeof fallback === 'number') {
    return values.length > 0 ? asNumber(values[0], fallback) : fallback;
  }
  if (values.length >= 3) {
    return [asNumber(values[0]), asNumber(values[1]), asNumber(values[2])];
  }
  return fallback;
}

function getNodeId(node: FbxNode) {
  return asNumber(node.properties[0], Number.NaN);
}

function getObjectName(node: FbxNode) {
  const raw = asString(node.properties[1], '');
  if (!raw) {
    return '';
  }
  const parts = raw.split('\0');
  const sanitized = (parts[0] || raw).replace(/[\u0000-\u001f]+/g, '').trim();
  return sanitized || '';
}

function getPreferredName(...values: Array<Nullable<string>>) {
  for (const value of values) {
    const sanitized = (value ?? '').replace(/[\u0000-\u001f]+/g, '').trim();
    if (sanitized) {
      return sanitized;
    }
  }
  return '';
}

function getFilenameStem(path: string) {
  if (!path) {
    return '';
  }
  const normalized = path.replace(/\\/g, '/');
  return PathUtils.basename(normalized, PathUtils.extname(normalized));
}

function toRadiansTuple(value: [number, number, number]): [number, number, number] {
  return [(value[0] * Math.PI) / 180, (value[1] * Math.PI) / 180, (value[2] * Math.PI) / 180];
}

function scaleTuple3(value: [number, number, number], unitScale: number): [number, number, number] {
  if (unitScale === 1) {
    return value;
  }
  return [value[0] * unitScale, value[1] * unitScale, value[2] * unitScale];
}

function getDocumentUnitScale(document: FbxDocument) {
  const unitScaleFactor = document.globalSettings.unitScaleFactor;
  return Number.isFinite(unitScaleFactor) && unitScaleFactor! > 0 ? unitScaleFactor! * 0.01 : 1;
}

function getEulerOrder(order: number): EulerAngleOrder {
  // FBX stores extrinsic Euler orders; Quaternion.fromEulerAngle expects the equivalent
  // intrinsic order, matching the conversion used by three.js FBXLoader.
  switch (order) {
    case 0:
      return 'ZYX';
    case 1:
      return 'YZX';
    case 2:
      return 'XZY';
    case 3:
      return 'YXZ';
    case 4:
      return 'ZXY';
    case 5:
      return 'XYZ';
    default:
      return 'ZYX';
  }
}

function quaternionFromDegrees(euler: [number, number, number], order: number) {
  const r = toRadiansTuple(euler);
  return Quaternion.fromEulerAngle(r[0], r[1], r[2], getEulerOrder(order));
}

function quaternionFromDegreesXYZ(euler: [number, number, number]) {
  const r = toRadiansTuple(euler);
  return Quaternion.fromEulerAngle(r[0], r[1], r[2], 'XYZ');
}

function matrixFromTRS(
  translation: [number, number, number],
  rotationDegrees: [number, number, number],
  scale: [number, number, number],
  rotationOrder: number
) {
  return new Matrix4x4().compose(
    new Vector3(scale[0], scale[1], scale[2]),
    quaternionFromDegrees(rotationDegrees, rotationOrder),
    new Vector3(translation[0], translation[1], translation[2])
  );
}

function readTransformData(node: FbxNode, unitScale: number): FbxTransformData {
  const lclTranslation = getProperty70Value(node, 'Lcl Translation', [0, 0, 0]) as [number, number, number];
  const lclRotation = getProperty70Value(node, 'Lcl Rotation', [0, 0, 0]) as [number, number, number];
  const lclScaling = getProperty70Value(node, 'Lcl Scaling', [1, 1, 1]) as [number, number, number];
  return {
    translation: scaleTuple3(lclTranslation, unitScale),
    rotation: lclRotation,
    scale: lclScaling,
    preRotation: getProperty70Value(node, 'PreRotation', [0, 0, 0]) as [number, number, number],
    postRotation: getProperty70Value(node, 'PostRotation', [0, 0, 0]) as [number, number, number],
    rotationOffset: scaleTuple3(
      getProperty70Value(node, 'RotationOffset', [0, 0, 0]) as [number, number, number],
      unitScale
    ),
    rotationPivot: scaleTuple3(
      getProperty70Value(node, 'RotationPivot', [0, 0, 0]) as [number, number, number],
      unitScale
    ),
    scalingOffset: scaleTuple3(
      getProperty70Value(node, 'ScalingOffset', [0, 0, 0]) as [number, number, number],
      unitScale
    ),
    scalingPivot: scaleTuple3(
      getProperty70Value(node, 'ScalingPivot', [0, 0, 0]) as [number, number, number],
      unitScale
    ),
    rotationOrder: asNumber(getProperty70Value(node, 'RotationOrder', 0), 0),
    geometricTranslation: scaleTuple3(
      getProperty70Value(node, 'GeometricTranslation', [0, 0, 0]) as [number, number, number],
      unitScale
    ),
    geometricRotation: getProperty70Value(node, 'GeometricRotation', [0, 0, 0]) as [number, number, number],
    geometricScaling: getProperty70Value(node, 'GeometricScaling', [1, 1, 1]) as [number, number, number],
    inheritType: asNumber(getProperty70Value(node, 'InheritType', 0), 0)
  };
}

function readConnections(connections: FbxConnection[]) {
  const children = new Map<number, FbxConnection[]>();
  const parents = new Map<number, FbxConnection[]>();
  for (const connection of connections) {
    const listA = children.get(connection.to);
    if (listA) {
      listA.push(connection);
    } else {
      children.set(connection.to, [connection]);
    }
    const listB = parents.get(connection.from);
    if (listB) {
      listB.push(connection);
    } else {
      parents.set(connection.from, [connection]);
    }
  }
  return { children, parents };
}

function readVideoData(node: FbxNode) {
  const contentNode = getChild(node, 'Content');
  const contentProp = contentNode?.properties[0];
  let content: Uint8Array | null = null;
  if (contentProp instanceof ArrayBuffer) {
    content = new Uint8Array(contentProp);
  } else if (contentProp instanceof Uint8Array) {
    content = contentProp;
  }
  return {
    id: getNodeId(node),
    name: getObjectName(node),
    relativeFilename: asString(getChild(node, 'RelativeFilename')?.properties[0], ''),
    filename: asString(getChild(node, 'Filename')?.properties[0], ''),
    content
  } as FbxVideoData;
}

function readTextureData(node: FbxNode, ctx: FbxImportContext) {
  const id = getNodeId(node);
  const linkedVideoConnection = ctx.connectionChildren
    .get(id)
    ?.find((connection) => ctx.objects.Video?.has(connection.from));
  const video = linkedVideoConnection ? (ctx.videoMap.get(linkedVideoConnection.from) ?? null) : null;
  return {
    id,
    name: getObjectName(node),
    fileName: asString(getChild(node, 'FileName')?.properties[0], ''),
    relativeFilename: asString(getChild(node, 'RelativeFilename')?.properties[0], ''),
    video,
    uvSet: asString(getProperty70(node, 'UVSet')?.properties[4], ''),
    wrapModeU: asNumber(getChild(node, 'WrapModeU')?.properties[0], 0),
    wrapModeV: asNumber(getChild(node, 'WrapModeV')?.properties[0], 0),
    translation: [
      asNumber(getProperty70(node, 'Translation')?.properties[4], 0),
      asNumber(getProperty70(node, 'Translation')?.properties[5], 0)
    ],
    scale: [
      asNumber(getProperty70(node, 'Scaling')?.properties[4], 1),
      asNumber(getProperty70(node, 'Scaling')?.properties[5], 1)
    ]
  } as FbxTextureData;
}

function normalizeTextureSlot(name: string) {
  switch (name) {
    case 'DiffuseColor':
    case 'Maya|baseColor':
      return 'diffuse';
    case 'NormalMap':
    case 'Bump':
    case 'Maya|normalCamera':
      return 'normal';
    case 'TransparentColor':
    case 'TransparencyFactor':
      return 'opacity';
    case 'EmissiveColor':
    case 'Maya|emissionColor':
      return 'emissive';
    default:
      return name;
  }
}

function readMaterialData(node: FbxNode, ctx: FbxImportContext) {
  const id = getNodeId(node);
  const textures: Record<string, FbxTextureData> = {};
  for (const connection of ctx.connectionChildren.get(id) ?? []) {
    const texture = ctx.textureMap.get(connection.from);
    if (texture) {
      textures[normalizeTextureSlot(connection.property ?? '')] = texture;
    }
  }
  return {
    id,
    name: getObjectName(node),
    shadingModel: asString(getChild(node, 'ShadingModel')?.properties[0], 'phong').toLowerCase(),
    diffuseColor: getProperty70Value(node, 'DiffuseColor', [1, 1, 1]) as [number, number, number],
    emissiveColor: getProperty70Value(node, 'EmissiveColor', [0, 0, 0]) as [number, number, number],
    transparentColor: getProperty70Value(node, 'TransparentColor', [0, 0, 0]) as [number, number, number],
    opacity: asNumber(getProperty70Value(node, 'Opacity', 1), 1),
    transparencyFactor: asNumber(getProperty70Value(node, 'TransparencyFactor', 0), 0),
    shininess: asNumber(getProperty70Value(node, 'Shininess', 0), 0),
    bumpFactor: asNumber(getProperty70Value(node, 'BumpFactor', 1), 1),
    textures
  } as FbxMaterialData;
}

function readClusterData(node: FbxNode, ctx: FbxImportContext) {
  const id = getNodeId(node);
  const boneConnection = ctx.connectionChildren
    .get(id)
    ?.find((connection) => ctx.objects.Model?.has(connection.from));
  return {
    id,
    indices: (getChild(node, 'Indexes')?.properties[0] as Int32Array) ?? new Int32Array(),
    weights: (getChild(node, 'Weights')?.properties[0] as Float64Array) ?? new Float64Array(),
    transform: (getChild(node, 'Transform')?.properties[0] as Float64Array) ?? null,
    transformLink: (getChild(node, 'TransformLink')?.properties[0] as Float64Array) ?? null,
    linkMode: asString(getChild(node, 'Mode')?.properties[0], ''),
    boneModelId: boneConnection?.from ?? null
  } as FbxClusterData;
}

function readSkinData(node: FbxNode, ctx: FbxImportContext) {
  const id = getNodeId(node);
  const clusters: FbxClusterData[] = [];
  for (const connection of ctx.connectionChildren.get(id) ?? []) {
    const clusterNode = ctx.objects.Deformer?.get(connection.from);
    if (clusterNode?.properties[2] === 'Cluster') {
      clusters.push(readClusterData(clusterNode, ctx));
    }
  }
  return { id, clusters } as FbxSkinData;
}

function getMorphTargetName(channelName: string, shapeName: string) {
  const channelLeaf = channelName.includes('.') ? channelName.slice(channelName.lastIndexOf('.') + 1) : channelName;
  return getPreferredName(shapeName, channelLeaf, channelName);
}

function readShapeData(node: FbxNode) {
  return {
    id: getNodeId(node),
    name: getObjectName(node),
    indices: (getChild(node, 'Indexes')?.properties[0] as Int32Array) ?? new Int32Array(),
    vertices: (getChild(node, 'Vertices')?.properties[0] as Float64Array) ?? new Float64Array(),
    normals: (getChild(node, 'Normals')?.properties[0] as Float64Array) ?? null
  } as FbxShapeData;
}

function readBlendShapeChannelData(node: FbxNode, ctx: FbxImportContext) {
  const id = getNodeId(node);
  const shapeNode = ctx.connectionChildren
    .get(id)
    ?.map((connection) => ctx.objects.Geometry?.get(connection.from) ?? null)
    .find((geometryNode) => geometryNode?.properties[2] === 'Shape');
  const shape = shapeNode ? readShapeData(shapeNode) : null;
  const fullWeights = Array.from((getChild(node, 'FullWeights')?.properties[0] as Float64Array) ?? []).map((value) =>
    Number(value)
  );
  return {
    id,
    name: getMorphTargetName(getObjectName(node), shape?.name ?? ''),
    fullWeights,
    deformPercent: asNumber(getChild(node, 'DeformPercent')?.properties[0], 0),
    shape
  } as FbxBlendShapeChannelData;
}

function readMorphTargetData(geometryId: number, ctx: FbxImportContext) {
  const morphTargets: FbxBlendShapeChannelData[] = [];
  for (const connection of ctx.connectionChildren.get(geometryId) ?? []) {
    const blendShapeNode = ctx.objects.Deformer?.get(connection.from);
    if (blendShapeNode?.properties[2] !== 'BlendShape') {
      continue;
    }
    for (const channelConnection of ctx.connectionChildren.get(connection.from) ?? []) {
      const channelNode = ctx.objects.Deformer?.get(channelConnection.from);
      if (channelNode?.properties[2] !== 'BlendShapeChannel') {
        continue;
      }
      const channel = readBlendShapeChannelData(channelNode, ctx);
      if (channel.shape && channel.shape.indices.length * 3 <= channel.shape.vertices.length) {
        morphTargets.push(channel);
      }
    }
  }
  return morphTargets;
}

function readLayerElementFloat(node: Nullable<FbxNode>) {
  if (!node) {
    return null;
  }
  const name = asString(getChild(node, 'Name')?.properties[0], '');
  const mapping = asString(getChild(node, 'MappingInformationType')?.properties[0], '');
  const reference = asString(getChild(node, 'ReferenceInformationType')?.properties[0], '');
  const dataNode =
    getChild(node, 'Normals') ??
    getChild(node, 'Tangents') ??
    getChild(node, 'Colors') ??
    getChild(node, 'UV');
  const indexNode =
    getChild(node, 'NormalsIndex') ?? getChild(node, 'ColorIndex') ?? getChild(node, 'UVIndex');
  const source = dataNode?.properties[0];
  let data: Float32Array;
  if (source instanceof Float64Array) {
    data = Float32Array.from(source);
  } else if (source instanceof Float32Array) {
    data = source;
  } else {
    data = new Float32Array();
  }
  const indices = indexNode?.properties[0];
  return {
    name,
    mapping,
    reference,
    data,
    indices: indices instanceof Int32Array || indices instanceof Uint32Array ? indices : null
  } as FbxLayerElementData<Float32Array>;
}

function readLayerElementInt(node: Nullable<FbxNode>) {
  if (!node) {
    return null;
  }
  const mapping = asString(getChild(node, 'MappingInformationType')?.properties[0], '');
  const reference = asString(getChild(node, 'ReferenceInformationType')?.properties[0], '');
  const dataNode = getChild(node, 'Materials');
  const indexNode = getChild(node, 'MaterialsIndex');
  const source = (dataNode?.properties[0] ?? indexNode?.properties[0]) as
    | Int32Array
    | Uint32Array
    | undefined;
  let data: Int32Array;
  if (source instanceof Int32Array) {
    data = source;
  } else if (source instanceof Uint32Array) {
    data = Int32Array.from(source);
  } else {
    data = new Int32Array();
  }
  return {
    mapping,
    reference,
    data
  } as FbxLayerElementData<Int32Array>;
}

function readGeometryData(node: FbxNode, ctx: FbxImportContext) {
  const id = getNodeId(node);
  const skinConnection = ctx.connectionChildren.get(id)?.find((connection) => {
    const deformerNode = ctx.objects.Deformer?.get(connection.from);
    return !!deformerNode && deformerNode.properties[2] === 'Skin';
  });
  const skin = skinConnection ? (ctx.skinMap.get(skinConnection.from) ?? null) : null;
  return {
    id,
    name: getObjectName(node),
    vertices: (getChild(node, 'Vertices')?.properties[0] as Float64Array) ?? new Float64Array(),
    polygonVertexIndex:
      (getChild(node, 'PolygonVertexIndex')?.properties[0] as Int32Array) ?? new Int32Array(),
    normals: readLayerElementFloat(getChild(node, 'LayerElementNormal')),
    tangents: readLayerElementFloat(getChild(node, 'LayerElementTangent')),
    colors: readLayerElementFloat(getChild(node, 'LayerElementColor')),
    uvLayers: getChildren(node, 'LayerElementUV')
      .map((layer) => readLayerElementFloat(layer))
      .filter((layer): layer is FbxLayerElementData<Float32Array> => !!layer),
    materialLayer: readLayerElementInt(getChild(node, 'LayerElementMaterial')),
    skin,
    morphTargets: readMorphTargetData(id, ctx)
  } as FbxGeometryData;
}

function readModelData(node: FbxNode, ctx: FbxImportContext) {
  const id = getNodeId(node);
  const parentConnection = ctx.connectionParents
    .get(id)
    ?.find((connection) => connection.to !== 0 && ctx.objects.Model?.has(connection.to));
  const childConnections =
    ctx.connectionChildren.get(id)?.filter((connection) => ctx.objects.Model?.has(connection.from)) ?? [];
  return {
    id,
    name: getObjectName(node),
    type: asString(node.properties[2], ''),
    parentId: parentConnection?.to ?? null,
    children: childConnections.map((connection) => connection.from),
    transform: readTransformData(node, ctx.unitScale)
  } as FbxModelData;
}

function wrapModeFromFbx(value: number): TextureAddressMode {
  return value === 0 ? 'repeat' : 'clamp';
}

function createSamplerInfo(texture: FbxTextureData) {
  return {
    wrapS: wrapModeFromFbx(texture.wrapModeU ?? 0),
    wrapT: wrapModeFromFbx(texture.wrapModeV ?? 0),
    magFilter: 'linear' as TextureFilterMode,
    minFilter: 'linear' as TextureFilterMode,
    mipFilter: 'linear' as TextureFilterMode
  };
}

function normalizeUVSetName(name: string) {
  return name.trim().toLowerCase();
}

function toEngineUVY(value: number) {
  return 1 - value;
}

function resolveTextureTexCoord(texture: FbxTextureData, uvLayers: FbxLayerElementData<Float32Array>[]) {
  if (!texture.uvSet) {
    return 0;
  }
  const target = normalizeUVSetName(texture.uvSet);
  const exactIndex = uvLayers.findIndex((layer) => !!layer.name && normalizeUVSetName(layer.name) === target);
  if (exactIndex >= 0) {
    return exactIndex;
  }
  if (uvLayers.length === 1) {
    return 0;
  }
  return 0;
}

function resolveTextureImage(basePath: string, texture: FbxTextureData, vfs: VFS): AssetImageInfo | null {
  const video = texture.video;
  const rawPath =
    texture.relativeFilename || texture.fileName || video?.relativeFilename || video?.filename || '';
  const imageName = getPreferredName(
    getFilenameStem(rawPath),
    video?.name ?? '',
    texture.name
  );
  if (video?.content?.byteLength) {
    const filename =
      video.relativeFilename || video.filename || texture.relativeFilename || texture.fileName || '';
    const mimeType = filename ? vfs.guessMIMEType(filename) : '';
    return {
      name: imageName || undefined,
      data: toUint8Array(video.content),
      mimeType
    };
  }
  if (!rawPath) {
    return null;
  }
  const normalized = rawPath.replace(/\\/g, '/');
  const uri =
    vfs.parseDataURI(normalized) || vfs.isAbsoluteURL(normalized)
      ? normalized
      : vfs.normalizePath(vfs.join(basePath, normalized));
  return {
    name: imageName || undefined,
    uri
  };
}

function createTextureInfo(
  basePath: string,
  texture: Nullable<FbxTextureData>,
  vfs: VFS,
  sRGB: boolean,
  uvLayers: FbxLayerElementData<Float32Array>[]
) {
  if (!texture) {
    return null;
  }
  const image = resolveTextureImage(basePath, texture, vfs);
  if (!image) {
    return null;
  }
  const transform = new Matrix4x4().identity();
  const uvScale = texture.scale ?? [1, 1];
  const uvOffset = texture.translation ?? [0, 0];
  const engineUvOffsetY = 1 - uvScale[1] - uvOffset[1];
  transform.scaleLeft(new Vector3(uvScale[0], uvScale[1], 1));
  transform.translateLeft(new Vector3(uvOffset[0], engineUvOffsetY, 0));
  return {
    name:
      getPreferredName(texture.name, image.name ?? null, getFilenameStem(texture.fileName || texture.relativeFilename || '')) ||
      undefined,
    image,
    sRGB,
    sampler: createSamplerInfo(texture),
    texCoord: resolveTextureTexCoord(texture, uvLayers),
    transform
  } as AssetTextureInfo;
}

function registerTextureInfo(
  model: SharedModel,
  ctx: FbxImportContext,
  textureInfo: Nullable<AssetTextureInfo>
) {
  const image = textureInfo?.image;
  if (!image || ctx.imageSet.has(image)) {
    return;
  }
  ctx.imageSet.add(image);
  model.setImage(ctx.nextImageIndex++, image);
}

function registerMaterialImages(model: SharedModel, ctx: FbxImportContext, material: AssetMaterial) {
  if (material.type !== 'pbrMetallicRoughness') {
    return;
  }
  const pbr = material as AssetPBRMaterialMR;
  registerTextureInfo(model, ctx, pbr.diffuseMap ?? null);
  registerTextureInfo(model, ctx, pbr.common.normalMap ?? null);
  registerTextureInfo(model, ctx, pbr.common.emissiveMap ?? null);
  registerTextureInfo(model, ctx, pbr.common.occlusionMap ?? null);
  registerTextureInfo(model, ctx, pbr.metallicMap ?? null);
  registerTextureInfo(model, ctx, pbr.specularMap ?? null);
  registerTextureInfo(model, ctx, pbr.specularColorMap ?? null);
}

function createMaterialAsset(
  material: Nullable<FbxMaterialData>,
  ctx: FbxImportContext,
  uvLayers: FbxLayerElementData<Float32Array>[],
  vertexColor: boolean,
  useTangent: boolean
): AssetMaterial {
  const diffuse = material?.diffuseColor ?? [0.8, 0.8, 0.8];
  const opacity = material?.opacity ?? 1;
  const transparencyFactor = material?.transparencyFactor ?? 0;
  const transparentColor = material?.transparentColor ?? [0, 0, 0];
  const transparentStrength = Math.max(
    0,
    Math.min(1, (transparentColor[0] + transparentColor[1] + transparentColor[2]) / 3)
  );
  const alpha = Math.max(0, Math.min(1, opacity * (1 - transparencyFactor * transparentStrength)));
  const assetMaterial: AssetPBRMaterialMR = {
    name: material?.name || undefined,
    type: 'pbrMetallicRoughness',
    common: {
      vertexColor,
      vertexNormal: true,
      useTangent,
      alphaMode: alpha < 0.999 ? 'blend' : undefined,
      doubleSided: false,
      bumpScale: material?.bumpFactor ?? 1,
      emissiveColor: material?.emissiveColor ? new Vector3(...material.emissiveColor) : Vector3.zero(),
      emissiveStrength: 1,
      occlusionStrength: 1,
      normalMap:
        createTextureInfo(ctx.basePath, material?.textures.normal ?? null, ctx.vfs, false, uvLayers) ?? undefined,
      emissiveMap:
        createTextureInfo(ctx.basePath, material?.textures.emissive ?? null, ctx.vfs, true, uvLayers) ?? undefined
    },
    ior: 1.5,
    diffuse: new Vector4(diffuse[0], diffuse[1], diffuse[2], alpha),
    metallic: 0,
    roughness: material?.shininess ? Math.max(0.04, 1 - Math.min(material.shininess / 100, 1)) : 1,
    diffuseMap:
      createTextureInfo(ctx.basePath, material?.textures.diffuse ?? null, ctx.vfs, true, uvLayers) ?? undefined,
    specularFactor: Vector4.one()
  };
  return assetMaterial;
}

function getMaterialUvBindingKey(
  material: Nullable<FbxMaterialData>,
  uvLayers: FbxLayerElementData<Float32Array>[]
) {
  if (!material) {
    return 'no_uv_binding';
  }
  const entries = Object.entries(material.textures)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([slot, texture]) => `${slot}:${resolveTextureTexCoord(texture, uvLayers)}`);
  return entries.join('|') || 'no_uv_binding';
}

function getElementIndex(
  layer: Nullable<FbxLayerElementData<Float32Array> | FbxLayerElementData<Int32Array>>,
  polygonIndex: number,
  polygonVertexIndex: number,
  controlPointIndex: number
) {
  if (!layer) {
    return -1;
  }
  switch (layer.mapping) {
    case 'ByControlPoint':
    case 'ByVertice':
    case 'ByVertex':
      return controlPointIndex;
    case 'ByPolygonVertex':
      return polygonVertexIndex;
    case 'ByPolygon':
      return polygonIndex;
    case 'AllSame':
      return 0;
    default:
      return polygonVertexIndex;
  }
}

function resolveLayerElement(
  layer: Nullable<FbxLayerElementData<Float32Array>>,
  polygonIndex: number,
  polygonVertexIndex: number,
  controlPointIndex: number,
  componentCount: number,
  out: number[]
) {
  if (!layer) {
    for (let i = 0; i < componentCount; i++) {
      out[i] = 0;
    }
    return;
  }
  let index = getElementIndex(layer, polygonIndex, polygonVertexIndex, controlPointIndex);
  if (index < 0) {
    for (let i = 0; i < componentCount; i++) {
      out[i] = 0;
    }
    return;
  }
  if (layer.reference === 'IndexToDirect' && layer.indices) {
    index = asNumber(layer.indices[index], index);
  }
  const offset = index * componentCount;
  for (let i = 0; i < componentCount; i++) {
    out[i] = layer.data[offset + i] ?? 0;
  }
}

function resolveMaterialIndex(layer: Nullable<FbxLayerElementData<Int32Array>>, polygonIndex: number) {
  if (!layer) {
    return 0;
  }
  const index = getElementIndex(layer, polygonIndex, polygonIndex, polygonIndex);
  return index >= 0 ? asNumber(layer.data[index], 0) : 0;
}

function getGeometryTransform(model: FbxModelData) {
  return matrixFromTRS(
    model.transform.geometricTranslation,
    model.transform.geometricRotation,
    model.transform.geometricScaling,
    model.transform.rotationOrder
  );
}

function buildSkinData(geometry: FbxGeometryData) {
  const clusterList = geometry.skin?.clusters ?? [];
  if (clusterList.length === 0) {
    return null;
  }
  const controlPointCount = (geometry.vertices.length / 3) >> 0;
  const influences = Array.from(
    { length: controlPointCount },
    () => [] as { joint: number; weight: number }[]
  );
  for (let jointIndex = 0; jointIndex < clusterList.length; jointIndex++) {
    const cluster = clusterList[jointIndex];
    const count = Math.min(cluster.indices.length, cluster.weights.length);
    for (let i = 0; i < count; i++) {
      const controlPoint = cluster.indices[i];
      if (controlPoint >= 0 && controlPoint < controlPointCount) {
        influences[controlPoint].push({ joint: jointIndex, weight: Number(cluster.weights[i]) });
      }
    }
  }
  return { clusterList, influences };
}

function buildPrimitives(geometry: FbxGeometryData, model: FbxModelData, unitScale: number): FbxPrimitiveBuildData[] {
  const morphTargets = geometry.morphTargets ?? [];
  const materialBuckets = new Map<
    number,
    {
      positions: number[];
      normals: number[];
      tangents: number[];
      colors: number[];
      texCoords: number[][];
      blendIndices: number[];
      blendWeights: number[];
      indices: number[];
      rawPositions: number[];
      rawBlendIndices: number[];
      rawJointWeights: number[];
      controlPointToVertices: Map<number, number[]>;
    }
  >();
  const geometryTransform = getGeometryTransform(model);
  const normalTransform = new Matrix4x4(geometryTransform).inplaceInvertAffine().transpose();
  const positionScratch = [0, 0, 0];
  const normalScratch = [0, 0, 0];
  const tangentScratch = [0, 0, 0];
  const colorScratch = [1, 1, 1, 1];
  const uvScratch = Array.from({ length: Math.max(1, geometry.uvLayers.length) }, () => [0, 0]);
  const skinData = buildSkinData(geometry);
  let polygon: number[] = [];
  let polygonIndex = 0;
  let polygonVertexStart = 0;

  function getBucket(materialIndex: number) {
    let bucket = materialBuckets.get(materialIndex);
    if (!bucket) {
      bucket = {
        positions: [],
        normals: [],
        tangents: [],
        colors: [],
        texCoords: geometry.uvLayers.map(() => []),
        blendIndices: [],
        blendWeights: [],
        indices: [],
        rawPositions: [],
        rawBlendIndices: [],
        rawJointWeights: [],
        controlPointToVertices: new Map()
      };
      materialBuckets.set(materialIndex, bucket);
    }
    return bucket;
  }

  const controlPoints = geometry.vertices;
  for (let i = 0; i < geometry.polygonVertexIndex.length; i++) {
    const controlPointIndexRaw = geometry.polygonVertexIndex[i];
    const controlPointIndex = controlPointIndexRaw < 0 ? -controlPointIndexRaw - 1 : controlPointIndexRaw;
    polygon.push(controlPointIndex);
    if (controlPointIndexRaw >= 0) {
      continue;
    }
    const materialIndex = resolveMaterialIndex(geometry.materialLayer ?? null, polygonIndex);
    const bucket = getBucket(materialIndex);
    const baseIndex = bucket.positions.length / 3;
    for (let localIndex = 0; localIndex < polygon.length; localIndex++) {
      const cpIndex = polygon[localIndex];
      positionScratch[0] = (controlPoints[cpIndex * 3] ?? 0) * unitScale;
      positionScratch[1] = (controlPoints[cpIndex * 3 + 1] ?? 0) * unitScale;
      positionScratch[2] = (controlPoints[cpIndex * 3 + 2] ?? 0) * unitScale;
      TMP_VEC3.setXYZ(positionScratch[0], positionScratch[1], positionScratch[2]);
      geometryTransform.transformPointAffine(TMP_VEC3, TMP_VEC3_B);
      bucket.positions.push(TMP_VEC3_B.x, TMP_VEC3_B.y, TMP_VEC3_B.z);
      bucket.rawPositions.push(TMP_VEC3_B.x, TMP_VEC3_B.y, TMP_VEC3_B.z);
      const vertexIndex = bucket.positions.length / 3 - 1;
      const vertexRefs = bucket.controlPointToVertices.get(cpIndex);
      if (vertexRefs) {
        vertexRefs.push(vertexIndex);
      } else {
        bucket.controlPointToVertices.set(cpIndex, [vertexIndex]);
      }

      resolveLayerElement(
        geometry.normals ?? null,
        polygonIndex,
        polygonVertexStart + localIndex,
        cpIndex,
        3,
        normalScratch
      );
      TMP_VEC3.setXYZ(normalScratch[0], normalScratch[1], normalScratch[2]);
      normalTransform.transformVector(TMP_VEC3, TMP_VEC4);
      TMP_VEC3.setXYZ(TMP_VEC4.x, TMP_VEC4.y, TMP_VEC4.z).inplaceNormalize();
      bucket.normals.push(TMP_VEC3.x, TMP_VEC3.y, TMP_VEC3.z);

      if (geometry.tangents) {
        resolveLayerElement(
          geometry.tangents ?? null,
          polygonIndex,
          polygonVertexStart + localIndex,
          cpIndex,
          3,
          tangentScratch
        );
        TMP_VEC3.setXYZ(tangentScratch[0], tangentScratch[1], tangentScratch[2]);
        normalTransform.transformVector(TMP_VEC3, TMP_VEC4);
        TMP_VEC3.setXYZ(TMP_VEC4.x, TMP_VEC4.y, TMP_VEC4.z).inplaceNormalize();
        bucket.tangents.push(TMP_VEC3.x, TMP_VEC3.y, TMP_VEC3.z, 1);
      }

      if (geometry.colors) {
        resolveLayerElement(
          geometry.colors ?? null,
          polygonIndex,
          polygonVertexStart + localIndex,
          cpIndex,
          4,
          colorScratch
        );
        bucket.colors.push(colorScratch[0], colorScratch[1], colorScratch[2], colorScratch[3]);
      }

      for (let uvIndex = 0; uvIndex < geometry.uvLayers.length; uvIndex++) {
        resolveLayerElement(
          geometry.uvLayers[uvIndex],
          polygonIndex,
          polygonVertexStart + localIndex,
          cpIndex,
          2,
          uvScratch[uvIndex]
        );
        bucket.texCoords[uvIndex].push(uvScratch[uvIndex][0], toEngineUVY(uvScratch[uvIndex][1]));
      }

      if (skinData) {
        const vertexInfluences = skinData.influences[cpIndex]
          .slice()
          .sort((a, b) => b.weight - a.weight)
          .slice(0, 4);
        while (vertexInfluences.length < 4) {
          vertexInfluences.push({ joint: 0, weight: 0 });
        }
        let total = 0;
        for (const influence of vertexInfluences) {
          total += influence.weight;
        }
        const denom = total > 0 ? total : 1;
        for (const influence of vertexInfluences) {
          bucket.blendIndices.push(influence.joint);
          bucket.blendWeights.push(influence.weight / denom);
          bucket.rawBlendIndices.push(influence.joint);
          bucket.rawJointWeights.push(influence.weight / denom);
        }
      }
    }
    const polygonSize = polygon.length;
    for (let local = 1; local < polygonSize - 1; local++) {
      bucket.indices.push(baseIndex, baseIndex + local, baseIndex + local + 1);
    }
    polygon = [];
    polygonVertexStart += polygonSize;
    polygonIndex++;
  }

  const result: FbxPrimitiveBuildData[] = [];
  const meshBaseName = getPreferredName(model.name, geometry.name, `mesh_${model.id}`);
  for (const [materialIndex, bucket] of materialBuckets) {
    const vertices: Partial<FbxPrimitiveBuildData['vertices']> = {
      position: { format: 'position_f32x3', data: new Float32Array(bucket.positions) },
      normal: { format: 'normal_f32x3', data: new Float32Array(bucket.normals) }
    };
    if (bucket.tangents.length > 0) {
      vertices.tangent = { format: 'tangent_f32x4', data: new Float32Array(bucket.tangents) };
    }
    if (bucket.colors.length > 0) {
      vertices.diffuse = { format: 'diffuse_f32x4', data: new Float32Array(bucket.colors) };
    }
    for (let uvIndex = 0; uvIndex < bucket.texCoords.length; uvIndex++) {
      const uv = bucket.texCoords[uvIndex];
      if (uv.length === 0) {
        continue;
      }
      const semantic = `texCoord${uvIndex}` as VertexSemantic;
      const format = `tex${uvIndex}_f32x2` as VertexAttribFormat;
      vertices[semantic] = { format, data: new Float32Array(uv) };
    }
    let numTargets = 0;
    let targets:
      | Partial<Record<number, { numComponents: number; data: Float32Array[]; indices?: Uint32Array[] }>>
      | undefined;
    let targetBox:
      | {
          min: [number, number, number];
          max: [number, number, number];
        }[]
      | undefined;
    let morphAttribCount = 0;
    if (morphTargets.length > 0) {
      const positionTargets: Float32Array[] = [];
      const positionTargetIndices: Uint32Array[] = [];
      const normalTargets: Float32Array[] = [];
      const normalTargetIndices: Uint32Array[] = [];
      let hasNormalMorph = false;
      targetBox = [];
      for (const morphTarget of morphTargets) {
        const positionIndexData: number[] = [];
        const positionValueData: number[] = [];
        const normalIndexData: number[] = [];
        const normalValueData: number[] = [];
        let minX = 0;
        let minY = 0;
        let minZ = 0;
        let maxX = 0;
        let maxY = 0;
        let maxZ = 0;
        const shape = morphTarget.shape;
        if (shape) {
          const count = Math.min(shape.indices.length, Math.floor(shape.vertices.length / 3));
          const normalCount = shape.normals ? Math.min(shape.indices.length, Math.floor(shape.normals.length / 3)) : 0;
          for (let i = 0; i < count; i++) {
            const cpIndex = shape.indices[i];
            const mappedVertices = bucket.controlPointToVertices.get(cpIndex);
            if (!mappedVertices || mappedVertices.length === 0) {
              continue;
            }
            TMP_VEC3.setXYZ(
              (shape.vertices[i * 3] ?? 0) * unitScale,
              (shape.vertices[i * 3 + 1] ?? 0) * unitScale,
              (shape.vertices[i * 3 + 2] ?? 0) * unitScale
            );
            geometryTransform.transformVectorAffine(TMP_VEC3, TMP_VEC3_B);
            minX = Math.min(minX, TMP_VEC3_B.x);
            minY = Math.min(minY, TMP_VEC3_B.y);
            minZ = Math.min(minZ, TMP_VEC3_B.z);
            maxX = Math.max(maxX, TMP_VEC3_B.x);
            maxY = Math.max(maxY, TMP_VEC3_B.y);
            maxZ = Math.max(maxZ, TMP_VEC3_B.z);
            for (const vertexRef of mappedVertices) {
              positionIndexData.push(vertexRef);
              positionValueData.push(TMP_VEC3_B.x, TMP_VEC3_B.y, TMP_VEC3_B.z);
            }
            if (shape.normals && i < normalCount) {
              TMP_VEC3.setXYZ(shape.normals[i * 3] ?? 0, shape.normals[i * 3 + 1] ?? 0, shape.normals[i * 3 + 2] ?? 0);
              normalTransform.transformVector(TMP_VEC3, TMP_VEC4);
              hasNormalMorph = true;
              for (const vertexRef of mappedVertices) {
                normalIndexData.push(vertexRef);
                normalValueData.push(TMP_VEC4.x, TMP_VEC4.y, TMP_VEC4.z);
              }
            }
          }
        }
        positionTargets.push(new Float32Array(positionValueData));
        positionTargetIndices.push(new Uint32Array(positionIndexData));
        normalTargets.push(new Float32Array(normalValueData));
        normalTargetIndices.push(new Uint32Array(normalIndexData));
        targetBox.push({
          min: [minX, minY, minZ],
          max: [maxX, maxY, maxZ]
        });
      }
      numTargets = morphTargets.length;
      targets = {
        [MORPH_TARGET_POSITION]: {
          numComponents: 3,
          data: positionTargets,
          indices: positionTargetIndices
        }
      };
      morphAttribCount = 1;
      if (hasNormalMorph) {
        targets![MORPH_TARGET_NORMAL] = {
          numComponents: 3,
          data: normalTargets,
          indices: normalTargetIndices
        };
        morphAttribCount++;
      }
    }
    if (bucket.blendIndices.length > 0) {
      vertices.blendIndices = {
        format: 'blendindices_f32x4' as VertexAttribFormat,
        data: new Float32Array(bucket.blendIndices)
      };
      vertices.blendWeights = {
        format: 'blendweights_f32x4' as VertexAttribFormat,
        data: new Float32Array(bucket.blendWeights)
      };
    }
    result.push({
      primitiveType: 'triangle-list',
      indices: toUint32Array(new Uint32Array(bucket.indices)),
      vertices: vertices as FbxPrimitiveBuildData['vertices'],
      rawPositions: toFloat32Array(new Float32Array(bucket.rawPositions)),
      rawBlendIndices:
        bucket.rawBlendIndices.length > 0 ? toUint16Array(new Uint16Array(bucket.rawBlendIndices)) : null,
      rawJointWeights:
        bucket.rawJointWeights.length > 0 ? toFloat32Array(new Float32Array(bucket.rawJointWeights)) : null,
      materialIndex,
      name: materialBuckets.size > 1 ? `${meshBaseName}_${materialIndex}` : meshBaseName,
      numTargets,
      targets,
      targetBox,
      morphAttribCount
    });
  }
  return result;
}

function getBounds(positions: Float32Array) {
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
  return { min, max };
}

function composeFbxLocalMatrix(transform: FbxTransformData, hasParent: boolean) {
  const scale = hasParent && transform.inheritType === 2 ? Vector3.one() : new Vector3(...transform.scale);
  const local = new Matrix4x4().identity();
  local.translateLeft(
    new Vector3(-transform.scalingPivot[0], -transform.scalingPivot[1], -transform.scalingPivot[2])
  );
  local.scaleLeft(scale);
  local.translateLeft(new Vector3(...transform.scalingPivot));
  local.translateLeft(new Vector3(...transform.scalingOffset));
  local.translateLeft(
    new Vector3(-transform.rotationPivot[0], -transform.rotationPivot[1], -transform.rotationPivot[2])
  );
  local.rotateLeft(Quaternion.inverse(quaternionFromDegreesXYZ(transform.postRotation)));
  local.rotateLeft(quaternionFromDegrees(transform.rotation, transform.rotationOrder));
  local.rotateLeft(quaternionFromDegreesXYZ(transform.preRotation));
  local.translateLeft(new Vector3(...transform.rotationPivot));
  local.translateLeft(new Vector3(...transform.rotationOffset));
  local.translateLeft(new Vector3(...transform.translation));
  return local;
}

function matrixFromFloat64Array(array: Nullable<Float64Array | Float32Array>) {
  if (!array || array.length < 16) {
    return Matrix4x4.identity();
  }
  const matrix = new Matrix4x4();
  for (let i = 0; i < 16; i++) {
    matrix[i] = array[i];
  }
  return matrix;
}

function matrixFromFloat64ArrayScaled(array: Nullable<Float64Array | Float32Array>, unitScale: number) {
  const matrix = matrixFromFloat64Array(array);
  if (unitScale !== 1) {
    matrix[12] *= unitScale;
    matrix[13] *= unitScale;
    matrix[14] *= unitScale;
  }
  return matrix;
}

function resolveClusterInverseBind(
  cluster: FbxClusterData,
  jointNode: Nullable<AssetHierarchyNode>,
  unitScale: number
) {
  // FBX cluster Transform is the geometry node bind matrix. We already bake the geometry
  // transform into mesh vertices, so inverse bind should come from the link node only.
  if (cluster.transformLink) {
    return matrixFromFloat64ArrayScaled(cluster.transformLink, unitScale).inplaceInvertAffine();
  }
  if (jointNode?.worldMatrix) {
    return new Matrix4x4(jointNode.worldMatrix).inplaceInvertAffine();
  }
  return Matrix4x4.identity();
}

function computeModelWorldMatrix(
  modelId: number,
  ctx: FbxImportContext,
  cache: Map<number, Matrix4x4>
): Matrix4x4 {
  const cached = cache.get(modelId);
  if (cached) {
    return cached;
  }
  const override = ctx.bindWorldMap.get(modelId);
  if (override) {
    cache.set(modelId, override);
    return override;
  }
  const model = ctx.modelMap.get(modelId);
  if (!model) {
    return Matrix4x4.identity();
  }
  const local = composeFbxLocalMatrix(model.transform, model.parentId != null);
  const world: Matrix4x4 =
    model.parentId != null
      ? Matrix4x4.multiply(computeModelWorldMatrix(model.parentId, ctx, cache), local)
      : local;
  cache.set(modelId, world);
  return world;
}

function applyClusterBindPose(
  cluster: FbxClusterData,
  jointNode: AssetHierarchyNode,
  ctx: FbxImportContext
) {
  if (cluster.boneModelId == null) {
    return;
  }
  const bindWorldOverride = ctx.bindWorldMap.get(cluster.boneModelId);
  if (!bindWorldOverride && !cluster.transformLink) {
    return;
  }
  const bindWorld = bindWorldOverride ?? matrixFromFloat64ArrayScaled(cluster.transformLink ?? null, ctx.unitScale);
  const source = ctx.modelMap.get(cluster.boneModelId);
  const parentWorld =
    source?.parentId != null ? computeModelWorldMatrix(source.parentId, ctx, ctx.bindWorldCache) : null;
  const local = parentWorld
    ? Matrix4x4.multiply(new Matrix4x4(parentWorld).inplaceInvertAffine(), bindWorld)
    : bindWorld;
  local.decompose(jointNode.scaling, jointNode.rotation, jointNode.position);
  ctx.bindWorldCache.set(cluster.boneModelId, bindWorld);
}

function buildBindWorldMap(ctx: FbxImportContext) {
  const setBindWorld = (
    modelId: number,
    matrix: Nullable<Float64Array | Float32Array>,
    overwrite = false
  ) => {
    if (!Number.isFinite(modelId) || !matrix || matrix.length < 16 || !ctx.modelMap.has(modelId)) {
      return;
    }
    if (overwrite || !ctx.bindWorldMap.has(modelId)) {
      ctx.bindWorldMap.set(modelId, matrixFromFloat64ArrayScaled(matrix, ctx.unitScale));
    }
  };

  for (const skin of ctx.skinMap.values()) {
    for (const cluster of skin.clusters) {
      if (cluster.boneModelId != null) {
        setBindWorld(cluster.boneModelId, cluster.transformLink ?? null, true);
      }
    }
  }

  for (const pose of ctx.objects.Pose?.values() ?? []) {
    if (asString(pose.properties[2], '') !== 'BindPose') {
      continue;
    }
    for (const poseNode of getChildren(pose, 'PoseNode')) {
      const modelId = asNumber(getChild(poseNode, 'Node')?.properties[0], Number.NaN);
      const matrix = getChild(poseNode, 'Matrix')?.properties[0] as Float64Array | Float32Array | undefined;
      setBindWorld(modelId, matrix ?? null);
    }
  }
}

function hasAncestorOfType(model: FbxModelData, ctx: FbxImportContext, type: string) {
  let parentId = model.parentId;
  while (parentId != null) {
    const parent = ctx.modelMap.get(parentId);
    if (!parent) {
      break;
    }
    if (parent.type === type) {
      return true;
    }
    parentId = parent.parentId;
  }
  return false;
}

function hasDescendantOfType(model: FbxModelData, ctx: FbxImportContext, type: string) {
  for (const childId of model.children) {
    const child = ctx.modelMap.get(childId);
    if (!child) {
      continue;
    }
    if (child.type === type || hasDescendantOfType(child, ctx, type)) {
      return true;
    }
  }
  return false;
}

function collectDescendantIds(model: FbxModelData, ctx: FbxImportContext, out: number[]) {
  out.push(model.id);
  for (const childId of model.children) {
    const child = ctx.modelMap.get(childId);
    if (child) {
      collectDescendantIds(child, ctx, out);
    }
  }
}

function buildSkeleton(geometry: FbxGeometryData, model: SharedModel, ctx: FbxImportContext) {
  const cached = ctx.skeletonMap.get(geometry.id);
  if (cached) {
    return cached;
  }
  const skin = geometry.skin;
  if (!skin || skin.clusters.length === 0) {
    return null;
  }
  const skeleton = new AssetSkeleton(`${geometry.name}_skeleton`);
  for (const cluster of skin.clusters) {
    if (cluster.boneModelId == null) {
      continue;
    }
    const jointNode =
      ctx.nodeMap.get(cluster.boneModelId) ?? createAssetNode(cluster.boneModelId, model, ctx);
    if (!jointNode) {
      continue;
    }
    applyClusterBindPose(cluster, jointNode, ctx);
    const cacheKey = `${geometry.id}:${cluster.boneModelId}`;
    const inverseBind =
      ctx.jointBindMatrices.get(cacheKey) ?? resolveClusterInverseBind(cluster, jointNode, ctx.unitScale);
    ctx.skeletonJointIds.add(cluster.boneModelId);
    ctx.jointBindMatrices.set(cacheKey, inverseBind);
    skeleton.addJoint(jointNode, inverseBind);
  }
  if (skeleton.joints.length === 0) {
    return null;
  }
  model.addSkeleton(skeleton);
  ctx.skeletonMap.set(geometry.id, skeleton);
  return skeleton;
}

function buildSkeletonFromLimbRoot(root: FbxModelData, model: SharedModel, ctx: FbxImportContext) {
  const cached = ctx.skeletonMap.get(root.id);
  if (cached) {
    return cached;
  }
  const descendantIds: number[] = [];
  collectDescendantIds(root, ctx, descendantIds);
  if (descendantIds.some((id) => ctx.skeletonJointIds.has(id))) {
    return null;
  }
  const skeleton = new AssetSkeleton(`${root.name || `${root.type}_${root.id}`}_skeleton`);
  const visit = (source: FbxModelData) => {
    if (source.type === 'LimbNode') {
      const jointNode = ctx.nodeMap.get(source.id) ?? createAssetNode(source.id, model, ctx);
      if (jointNode) {
        const cacheKey = `${root.id}:${source.id}`;
        const inverseBind =
          ctx.jointBindMatrices.get(cacheKey) ??
          (jointNode.worldMatrix
            ? new Matrix4x4(jointNode.worldMatrix).inplaceInvertAffine()
            : Matrix4x4.identity());
        ctx.jointBindMatrices.set(cacheKey, inverseBind);
        skeleton.addJoint(jointNode, inverseBind);
      }
    }
    for (const childId of source.children) {
      const child = ctx.modelMap.get(childId);
      if (child) {
        visit(child);
      }
    }
  };
  visit(root);
  if (skeleton.joints.length === 0) {
    return null;
  }
  model.addSkeleton(skeleton);
  ctx.skeletonMap.set(root.id, skeleton);
  return skeleton;
}

function buildSkeletonsFromLimbRoots(model: SharedModel, ctx: FbxImportContext) {
  const roots = [...(ctx.objects.Model?.values() ?? [])]
    .map((node) => ctx.modelMap.get(getNodeId(node)))
    .filter(
      (node): node is FbxModelData =>
        !!node && hasDescendantOfType(node, ctx, 'LimbNode') && !hasAncestorOfType(node, ctx, 'LimbNode')
    )
    .sort((a, b) => a.id - b.id);
  for (const root of roots) {
    buildSkeletonFromLimbRoot(root, model, ctx);
  }
}

function createMeshData(
  geometry: FbxGeometryData,
  modelData: FbxModelData,
  model: SharedModel,
  ctx: FbxImportContext
) {
  const primitives = buildPrimitives(geometry, modelData, ctx.unitScale);
  const morphTargets = geometry.morphTargets ?? [];
  const materials = (ctx.connectionChildren.get(modelData.id) ?? [])
    .filter((connection) => ctx.materialMap.has(connection.from))
    .map((connection) => ctx.materialMap.get(connection.from)!)
    .sort((a, b) => a.id - b.id);
  const subMeshes: AssetSubMeshData[] = [];
  for (const primitiveData of primitives) {
    const bounds = getBounds(primitiveData.rawPositions);
    const primitive: AssetPrimitiveInfo = {
      name: primitiveData.name || getPreferredName(modelData.name, geometry.name, `mesh_${modelData.id}`),
      vertices: toVertexRecord(primitiveData.vertices) as AssetPrimitiveInfo['vertices'],
      indices: toUint32Array(primitiveData.indices),
      indexCount: primitiveData.indices.length,
      type: primitiveData.primitiveType as PrimitiveType,
      boxMin: bounds.min,
      boxMax: bounds.max
    };
    model.addPrimitive(primitive);
    const materialSource = materials[primitiveData.materialIndex] ?? materials[0] ?? null;
    const hasVertexColor = !!primitive.vertices.diffuse;
    const hasVertexTangent = !!primitive.vertices.tangent;
    let material: AssetMaterial;
    if (materialSource) {
        const materialHash = `fbx_${materialSource.id}_${hasVertexColor ? 'C' : 'N'}_${hasVertexTangent ? 'T' : 'NT'}`;
        const materialUvBindingKey = getMaterialUvBindingKey(materialSource, geometry.uvLayers);
        const scopedMaterialHash = `${materialHash}_${materialUvBindingKey}`;
        material =
          model.getMaterial(scopedMaterialHash) ??
          createMaterialAsset(materialSource, ctx, geometry.uvLayers, hasVertexColor, hasVertexTangent);
        if (!model.getMaterial(scopedMaterialHash)) {
          registerMaterialImages(model, ctx, material);
          model.setMaterial(scopedMaterialHash, material);
        }
      } else {
        material = createMaterialAsset(null, ctx, geometry.uvLayers, hasVertexColor, hasVertexTangent);
      }
    const subMesh: AssetSubMeshData = {
      primitive,
      material,
      rawPositions: toFloat32Array(primitiveData.rawPositions),
      rawBlendIndices: primitiveData.rawBlendIndices ? toUint16Array(primitiveData.rawBlendIndices) : null,
      rawJointWeights: primitiveData.rawJointWeights ? toFloat32Array(primitiveData.rawJointWeights) : null,
      name: primitiveData.name || geometry.name,
      numTargets: primitiveData.numTargets ?? 0,
      targets: primitiveData.targets,
      targetBox: primitiveData.targetBox?.map(
        (box) =>
          new BoundingBox(
            new Vector3(box.min[0], box.min[1], box.min[2]),
            new Vector3(box.max[0], box.max[1], box.max[2])
          )
      ),
      morphAttribCount: primitiveData.morphAttribCount ?? 0
    };
    subMeshes.push(subMesh);
  }
  return {
    morphWeights: morphTargets.map((target) => {
      const fullWeight = target.fullWeights[0] ?? 100;
      return fullWeight !== 0 ? target.deformPercent / fullWeight : 0;
    }),
    morphNames: morphTargets.map((target) => target.name),
    subMeshes
  } as AssetMeshData;
}

function buildModelMaps(ctx: FbxImportContext) {
  for (const node of ctx.objects.Video?.values() ?? []) {
    const data = readVideoData(node);
    ctx.videoMap.set(data.id, data);
  }
  for (const node of ctx.objects.Texture?.values() ?? []) {
    const data = readTextureData(node, ctx);
    ctx.textureMap.set(data.id, data);
  }
  for (const node of ctx.objects.Material?.values() ?? []) {
    const data = readMaterialData(node, ctx);
    ctx.materialMap.set(data.id, data);
  }
  for (const node of ctx.objects.Deformer?.values() ?? []) {
    if (node.properties[2] === 'Skin') {
      const data = readSkinData(node, ctx);
      ctx.skinMap.set(data.id, data);
    }
  }
  for (const node of ctx.objects.Geometry?.values() ?? []) {
    const data = readGeometryData(node, ctx);
    ctx.geometryMap.set(data.id, data);
  }
  for (const node of ctx.objects.Model?.values() ?? []) {
    const data = readModelData(node, ctx);
    ctx.modelMap.set(data.id, data);
  }
  buildBindWorldMap(ctx);
}

function populateNodeTransforms(modelNode: AssetHierarchyNode, source: FbxModelData, ctx: FbxImportContext) {
  const bindWorld = ctx.bindWorldMap.get(source.id);
  const parentWorld =
    bindWorld && source.parentId != null ? computeModelWorldMatrix(source.parentId, ctx, ctx.bindWorldCache) : null;
  const local = bindWorld
    ? parentWorld
      ? Matrix4x4.multiply(new Matrix4x4(parentWorld).inplaceInvertAffine(), bindWorld)
      : new Matrix4x4(bindWorld)
    : composeFbxLocalMatrix(source.transform, source.parentId != null);
  local.decompose(modelNode.scaling, modelNode.rotation, modelNode.position);
  if (!bindWorld && source.parentId != null && source.transform.inheritType === 2) {
    modelNode.scaling.setXYZ(1, 1, 1);
  }
}

function createAssetNode(modelId: number, model: SharedModel, ctx: FbxImportContext, recurseChildren = true) {
  const source = ctx.modelMap.get(modelId);
  if (!source) {
    return null;
  }
  const existing = ctx.nodeMap.get(modelId);
  if (existing) {
    if (recurseChildren) {
      for (const childId of source.children) {
        createAssetNode(childId, model, ctx, true);
      }
    }
    return existing;
  }
  // When creating a node on-demand from a skin cluster, build only the direct parent chain first.
  // Otherwise an ancestor may eagerly recurse its full subtree before this node is registered,
  // which can instantiate the same source path twice.
  const parent = source.parentId != null ? createAssetNode(source.parentId, model, ctx, false) : null;
  const node: AssetHierarchyNode = new AssetHierarchyNode(
    source.name || `${source.type}_${modelId}`,
    model,
    parent ?? undefined
  );
  ctx.nodeMap.set(modelId, node);
  populateNodeTransforms(node, source, ctx);
  const geometryConnection = (ctx.connectionChildren.get(modelId) ?? []).find((connection) =>
    ctx.geometryMap.has(connection.from)
  );
  if (geometryConnection) {
    const geometry = ctx.geometryMap.get(geometryConnection.from)!;
    node.mesh = createMeshData(geometry, source, model, ctx);
    node.skeleton = buildSkeleton(geometry, model, ctx);
  }
  if (recurseChildren) {
    for (const childId of source.children) {
      createAssetNode(childId, model, ctx, true);
    }
  }
  return node;
}

function createImportContext(document: FbxDocument, basePath: string, vfs: VFS): FbxImportContext {
  const connectionMaps = readConnections(document.connections);
  return {
    document,
    unitScale: getDocumentUnitScale(document),
    objects: document.objects,
    connectionChildren: connectionMaps.children,
    connectionParents: connectionMaps.parents,
    modelMap: new Map(),
    geometryMap: new Map(),
    materialMap: new Map(),
    textureMap: new Map(),
    videoMap: new Map(),
    skinMap: new Map(),
    bindWorldMap: new Map(),
    bindWorldCache: new Map(),
    skeletonMap: new Map(),
    jointBindMatrices: new Map(),
    skeletonJointIds: new Set(),
    imageSet: new Set(),
    nextImageIndex: 0,
    nodeMap: new Map(),
    basePath,
    vfs
  };
}

/**
 * FBX importer that converts common FBX 7.x scene data into SharedModel.
 * Current scope targets hierarchy, mesh, material, embedded/external textures,
 * and basic skinning data. Animation is intentionally not mapped yet.
 * @public
 */
export class FBXImporter extends AbstractModelImporter {
  async import(data: Blob, model: SharedModel, basePath: string, vfs?: VFS) {
    ASSERT(!!vfs, 'FBXImporter requires a VFS');
    const buffer = await data.arrayBuffer();
    const document = await parseFbx(buffer);
    const ctx = createImportContext(document, basePath, vfs!);
    buildModelMaps(ctx);

    const scene = new AssetScene('Scene');
    for (const [modelId, modelData] of ctx.modelMap) {
      if (modelData.parentId != null) {
        continue;
      }
      const node = createAssetNode(modelId, model, ctx);
      if (
        node &&
        (modelData.type === 'Root' ||
          modelData.type === 'Null' ||
          modelData.type === 'Mesh' ||
          modelData.type === 'LimbNode')
      ) {
        scene.rootNodes.push(node);
      }
    }
    if (scene.rootNodes.length === 0) {
      for (const [modelId] of ctx.modelMap) {
        const node = createAssetNode(modelId, model, ctx);
        if (node && !node.parent) {
          scene.rootNodes.push(node);
        }
      }
    }
    for (const node of model.nodes) {
      if (!node.parent) {
        node.computeTransforms(null);
      }
    }
    buildSkeletonsFromLimbRoots(model, ctx);
    model.buildMorphTargetGroupsByName();
    model.scenes.push(scene);
    model.activeScene = 0;
  }

  async loadModel(path: string, vfs?: VFS): Promise<SharedModel> {
    if (!vfs) {
      vfs = getEngine().VFS;
    }

    const mimeType = vfs.guessMIMEType(path);
    const data = (await vfs.readFile(path, { encoding: 'binary' })) as ArrayBuffer;
    const blob = new Blob([data], { type: mimeType });
    const model = new SharedModel();
    await this.import(blob, model, PathUtils.dirname(path), vfs);
    return model;
  }
}
