import type { PrimitiveType, VertexAttribFormat, VertexSemantic } from '@zephyr3d/device';

export type FbxPropertyScalar =
  | boolean
  | number
  | bigint
  | string
  | ArrayBuffer
  | Uint8Array
  | Int16Array
  | Int32Array
  | BigInt64Array
  | Float32Array
  | Float64Array;

export type FbxPropertyValue = FbxPropertyScalar | FbxPropertyScalar[];

export interface FbxNode {
  name: string;
  properties: FbxPropertyValue[];
  propertyListLength: number;
  children: FbxNode[];
}

export interface FbxConnection {
  type: string;
  from: number;
  to: number;
  property?: string;
}

export interface FbxObjectMap {
  [type: string]: Map<number, FbxNode>;
}

export interface FbxGlobalSettings {
  unitScaleFactor?: number;
}

export interface FbxDocument {
  version: number;
  root: FbxNode;
  objects: FbxObjectMap;
  connections: FbxConnection[];
  globalSettings: FbxGlobalSettings;
}

export interface FbxLayerElementData<T extends Float32Array | Int32Array | Uint32Array> {
  name?: string;
  mapping: string;
  reference: string;
  data: T;
  indices?: Int32Array | Uint32Array | null;
}

export interface FbxVideoData {
  id: number;
  name: string;
  relativeFilename?: string;
  filename?: string;
  content?: Uint8Array | null;
}

export interface FbxTextureData {
  id: number;
  name: string;
  fileName?: string;
  relativeFilename?: string;
  video?: FbxVideoData | null;
  uvSet?: string;
  wrapModeU?: number;
  wrapModeV?: number;
  translation?: [number, number];
  scale?: [number, number];
}

export interface FbxMaterialData {
  id: number;
  name: string;
  shadingModel: string;
  diffuseColor?: [number, number, number];
  emissiveColor?: [number, number, number];
  transparentColor?: [number, number, number];
  opacity?: number;
  transparencyFactor?: number;
  shininess?: number;
  bumpFactor?: number;
  textures: Record<string, FbxTextureData>;
}

export interface FbxTransformData {
  translation: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
  preRotation: [number, number, number];
  postRotation: [number, number, number];
  rotationOffset: [number, number, number];
  rotationPivot: [number, number, number];
  scalingOffset: [number, number, number];
  scalingPivot: [number, number, number];
  rotationOrder: number;
  geometricTranslation: [number, number, number];
  geometricRotation: [number, number, number];
  geometricScaling: [number, number, number];
  inheritType: number;
}

export interface FbxClusterData {
  id: number;
  indices: Int32Array;
  weights: Float64Array;
  transform?: Float64Array | null;
  transformLink?: Float64Array | null;
  linkMode?: string;
  boneModelId?: number | null;
}

export interface FbxSkinData {
  id: number;
  clusters: FbxClusterData[];
}

export interface FbxShapeData {
  id: number;
  name: string;
  indices: Int32Array;
  vertices: Float64Array;
  normals?: Float64Array | null;
}

export interface FbxBlendShapeChannelData {
  id: number;
  name: string;
  fullWeights: number[];
  deformPercent: number;
  shape: FbxShapeData | null;
}

export interface FbxModelData {
  id: number;
  name: string;
  type: string;
  parentId: number | null;
  children: number[];
  transform: FbxTransformData;
}

export interface FbxGeometryData {
  id: number;
  name: string;
  vertices: Float64Array;
  polygonVertexIndex: Int32Array;
  normals?: FbxLayerElementData<Float32Array> | null;
  tangents?: FbxLayerElementData<Float32Array> | null;
  colors?: FbxLayerElementData<Float32Array> | null;
  uvLayers: FbxLayerElementData<Float32Array>[];
  materialLayer?: FbxLayerElementData<Int32Array> | null;
  skin?: FbxSkinData | null;
  morphTargets?: FbxBlendShapeChannelData[] | null;
}

export interface FbxPrimitiveBuildData {
  primitiveType: PrimitiveType;
  indices: Uint32Array;
  vertices: Partial<
    Record<VertexSemantic, { format: VertexAttribFormat; data: Float32Array | Uint16Array | Uint32Array }>
  >;
  rawPositions: Float32Array;
  rawBlendIndices?: Uint16Array | null;
  rawJointWeights?: Float32Array | null;
  materialIndex: number;
  name: string;
  numTargets?: number;
  targets?: Partial<Record<number, { numComponents: number; data: Float32Array[]; indices?: Uint32Array[] }>>;
  targetBox?: { min: [number, number, number]; max: [number, number, number] }[];
  morphAttribCount?: number;
}
