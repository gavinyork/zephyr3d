import { base64ToUint8Array, Vector3 } from '@zephyr3d/base';
import { FixedGeometryCacheTrack } from '../../../animation/fixed_geometry_cache_track';
import {
  PCAGeometryCacheTrack,
  type PCAGeometryCacheTrackData
} from '../../../animation/pca_geometry_cache_track';
import type { AssetSubMeshData } from '../../model';
import type { VertexBufferInfo } from '@zephyr3d/device';
import { BoundingBox } from '../../../utility/bounding_volume';
import { SceneNode } from '../../../scene/scene_node';
import { Mesh } from '../../../scene/mesh';

type ZABCBinaryBufferRef = {
  offset: number;
  length: number;
  count?: number;
};

type ZABCCacheTrackJSON = {
  codec?: 'fixed' | 'pca';
  node?: number;
  nodePath?: string;
  nodeName?: string;
  subMeshIndex?: number;
  times?: string | ZABCBinaryBufferRef;
  sampleRate?: number;
  positionFrames: Array<string | ZABCBinaryBufferRef>;
  normalFrames?: Array<string | ZABCBinaryBufferRef>;
  bounds: [number, number, number, number, number, number][];
  vectorLength?: number;
  positionReference?: string | ZABCBinaryBufferRef;
  positionComponents?: number;
  positionMean?: string | ZABCBinaryBufferRef;
  positionBases?: string | ZABCBinaryBufferRef;
  positionCoefficients?: string | ZABCBinaryBufferRef;
  normalComponents?: number;
  normalMean?: string | ZABCBinaryBufferRef;
  normalBases?: string | ZABCBinaryBufferRef;
  normalCoefficients?: string | ZABCBinaryBufferRef;
};

type ZABCAnimationJSON = {
  name: string;
  tracks: ZABCCacheTrackJSON[];
};

type ZABCFileJSON = {
  version: number;
  baseModel?: string;
  animations: ZABCAnimationJSON[];
};

export type ParsedZABC = {
  content: ZABCFileJSON;
  binaryPayload: ArrayBuffer | null;
  payloadOffset: number;
};

export async function parseZABCBlob(data: Blob): Promise<ParsedZABC> {
  const arrayBuffer = await data.arrayBuffer();
  if (isBinaryZABC(arrayBuffer)) {
    return parseBinaryZABC(arrayBuffer);
  }
  return parseLegacyZABC(arrayBuffer);
}

export async function attachZABCAnimationsToSceneNode(
  node: SceneNode,
  parsed: ParsedZABC,
  options?: {
    sourcePath?: string;
    autoPlay?: boolean;
    replaceAnimationNames?: string[];
  }
) {
  if (options?.replaceAnimationNames) {
    for (const name of options.replaceAnimationNames) {
      node.animationSet.deleteAnimation(name);
    }
  }
  const addedAnimationNames: string[] = [];
  for (const animation of parsed.content.animations ?? []) {
    const animationName = buildAnimationName(options?.sourcePath, animation.name ?? 'GeometryCache');
    node.animationSet.deleteAnimation(animationName);
    const clip = node.animationSet.createAnimation(animationName, true);
    if (!clip) {
      continue;
    }
    clip.autoPlay = !!options?.autoPlay;
    for (const track of animation.tracks ?? []) {
      const targetNode = findTargetNode(node, track);
      if (!targetNode) {
        console.error(
          `zabc track target not found: node=${track.node}, nodePath=${track.nodePath}, nodeName=${track.nodeName}`
        );
        continue;
      }
      const targetMesh = await getTargetMesh(targetNode, track, parsed);
      if (!targetMesh) {
        const subMeshLabel =
          typeof track.subMeshIndex === 'number' && track.subMeshIndex >= 0 ? `${track.subMeshIndex}` : 'auto';
        console.error(`zabc target mesh not found: node=${targetNode.name}, subMeshIndex=${subMeshLabel}`);
        continue;
      }
      const assetSubMesh = getTargetAssetSubMesh(node, track);
      if (track.codec === 'pca') {
        const remapped = assetSubMesh
          ? remapPCAGeometryCacheData(assetSubMesh, toPCATrackData(track, parsed))
          : await remapPCAGeometryCacheDataForMesh(targetMesh, toPCATrackData(track, parsed));
        clip.addTrack(targetMesh, new PCAGeometryCacheTrack(remapped, true));
      } else {
        const frames = assetSubMesh
          ? remapGeometryCacheFrames(
              assetSubMesh,
              track.positionFrames.map((positionsRef, index) => ({
                positions: decodeFloat32Array(positionsRef, parsed),
                normals: track.normalFrames?.[index]
                  ? decodeFloat32Array(track.normalFrames[index], parsed)
                  : null,
                boundingBox: decodeBoundingBox(track.bounds[index])
              }))
            )
          : await remapGeometryCacheFramesForMesh(
              targetMesh,
              track.positionFrames.map((positionsRef, index) => ({
                positions: decodeFloat32Array(positionsRef, parsed),
                normals: track.normalFrames?.[index]
                  ? decodeFloat32Array(track.normalFrames[index], parsed)
                  : null,
                boundingBox: decodeBoundingBox(track.bounds[index])
              }))
            );
        clip.addTrack(targetMesh, new FixedGeometryCacheTrack(decodeTimes(track, parsed), frames, true));
      }
    }
    if (clip.tracks.size > 0) {
      addedAnimationNames.push(animationName);
    } else {
      node.animationSet.deleteAnimation(animationName);
    }
  }
  if (options?.autoPlay) {
    for (const animationName of addedAnimationNames) {
      node.animationSet.playAnimation(animationName, { repeat: 0 });
    }
  }
  return {
    animationNames: addedAnimationNames
  };
}

function buildAnimationName(sourcePath: string | undefined, animationName: string) {
  const fileName = sourcePath
    ? sourcePath.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? 'cache'
    : 'cache';
  return `Cache:${fileName}:${animationName}`;
}

async function getTargetMesh(node: SceneNode, track: ZABCCacheTrackJSON, parsed: ParsedZABC) {
  const directMeshes = collectMeshChildren(node, false);
  const candidateMeshes = directMeshes.length > 0 ? directMeshes : collectMeshChildren(node, true);
  if (candidateMeshes.length === 0) {
    return null;
  }
  if (typeof track.subMeshIndex === 'number' && track.subMeshIndex >= 0) {
    return candidateMeshes[track.subMeshIndex] ?? null;
  }
  if (candidateMeshes.length === 1) {
    return candidateMeshes[0];
  }
  const sourceVertexCount = getTrackSourceVertexCount(track, parsed);
  if (sourceVertexCount > 0) {
    const matched: Mesh[] = [];
    for (const mesh of candidateMeshes) {
      const rawPositions = await getMeshRawPositions(mesh);
      const targetVertexCount = rawPositions ? (rawPositions.length / 3) >> 0 : -1;
      if (targetVertexCount === sourceVertexCount) {
        matched.push(mesh);
      }
    }
    if (matched.length === 1) {
      return matched[0];
    }
    if (matched.length > 1) {
      console.warn(
        `zabc subMesh auto-match is ambiguous under node=${node.name}, matched=${matched.length}, fallback=first`
      );
    }
  }
  return candidateMeshes[0];
}

function collectMeshChildren(root: SceneNode, recursive: boolean) {
  const meshes: Mesh[] = [];
  if (recursive) {
    root.iterate((child) => {
      if (child !== root && child.isMesh()) {
        meshes.push(child);
      }
      return false;
    });
    return meshes;
  }
  for (const child of root.children) {
    const sceneNode = child.get();
    if (sceneNode?.isMesh()) {
      meshes.push(sceneNode);
    }
  }
  return meshes;
}

function getTrackSourceVertexCount(track: ZABCCacheTrackJSON, parsed: ParsedZABC) {
  try {
    const first = track.positionFrames?.[0];
    if (!first) {
      return -1;
    }
    return (decodeFloat32Array(first, parsed).length / 3) >> 0;
  } catch {
    return -1;
  }
}

function getTargetAssetSubMesh(node: SceneNode, track: ZABCCacheTrackJSON) {
  const sharedModel = node.sharedModel;
  if (!sharedModel) {
    return null;
  }
  if (typeof track.subMeshIndex !== 'number' || track.subMeshIndex < 0) {
    return null;
  }
  const assetNode = findTargetAssetNode(node, track);
  return assetNode?.mesh?.subMeshes?.[track.subMeshIndex] ?? null;
}

function findTargetAssetNode(root: SceneNode, track: ZABCCacheTrackJSON) {
  const sharedModel = root.sharedModel;
  if (!sharedModel) {
    return null;
  }
  if (track.nodePath) {
    for (const candidatePath of getNodePathCandidates(track.nodePath)) {
      for (const scene of sharedModel.scenes) {
        for (const rootNode of scene.rootNodes) {
          const found = findAssetNodeByPath(rootNode, candidatePath);
          if (found) {
            return found;
          }
        }
      }
    }
  }
  if (track.nodeName) {
    for (const candidateName of getNodeNameCandidates(track.nodeName)) {
      const found = sharedModel.nodes.find((item) => item?.name === candidateName);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

function findAssetNodeByPath(node: { name: string; children: any[] }, normalizedTrackPath: string, currentPath = ''): any {
  if (!node) {
    return null;
  }
  const path = currentPath ? `${currentPath}/${node.name || ''}` : node.name || '';
  const normalizedCurrent = normalizeNodePath(path);
  if (normalizedCurrent === normalizedTrackPath) {
    return node;
  }
  for (const child of node.children) {
    const found = findAssetNodeByPath(child, normalizedTrackPath, path);
    if (found) {
      return found;
    }
  }
  return null;
}

function findTargetNode(root: SceneNode, track: ZABCCacheTrackJSON) {
  const hasExplicitTarget = !!track.nodePath || !!track.nodeName;
  if (track.nodePath) {
    for (const candidatePath of getNodePathCandidates(track.nodePath)) {
      for (const child of root.children) {
        const found = findSceneNodeByPath(child.get()!, candidatePath);
        if (found) {
          return found;
        }
      }
    }
  }
  if (track.nodeName) {
    for (const candidateName of getNodeNameCandidates(track.nodeName)) {
      const found = root.findNodeByName(candidateName);
      if (found) {
        return found;
      }
    }
  }
  if (hasExplicitTarget) {
    console.warn(
      `zabc track target fallback to attached node: nodePath=${track.nodePath ?? ''}, nodeName=${track.nodeName ?? ''}`
    );
  }
  return root;
}

function findSceneNodeByPath(node: SceneNode, normalizedTrackPath: string, currentPath = ''): SceneNode | null {
  if (!node || node.isMesh()) {
    return null;
  }
  const path = currentPath ? `${currentPath}/${node.name || ''}` : node.name || '';
  const normalizedCurrent = normalizeNodePath(path);
  if (normalizedCurrent === normalizedTrackPath) {
    return node;
  }
  for (const child of node.children) {
    const found = findSceneNodeByPath(child.get()!, normalizedTrackPath, path);
    if (found) {
      return found;
    }
  }
  return null;
}

function getNodePathCandidates(path: string) {
  const normalized = normalizeNodePath(path);
  const candidates = [normalized];
  if (normalized.endsWith('Shape')) {
    candidates.push(normalized.slice(0, -'Shape'.length));
  }
  const parts = normalized.split('/');
  const last = parts.length > 0 ? parts[parts.length - 1] : '';
  if (last.endsWith('Shape') && parts.length > 1) {
    parts[parts.length - 1] = last.slice(0, -'Shape'.length);
    candidates.push(parts.join('/'));
    parts.pop();
    candidates.push(parts.join('/'));
  }
  return candidates.filter((value, index, array) => !!value && array.indexOf(value) === index);
}

function getNodeNameCandidates(name: string) {
  const candidates = [name];
  if (name.endsWith('Shape')) {
    candidates.push(name.slice(0, -'Shape'.length));
  }
  return candidates.filter((value, index, array) => !!value && array.indexOf(value) === index);
}

function normalizeNodePath(path: string) {
  return path
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .join('/');
}

function decodeFloat32Array(data: string | ZABCBinaryBufferRef, parsed: ParsedZABC) {
  if (typeof data === 'string') {
    const bytes = base64ToUint8Array(data);
    return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  }
  if (!parsed.binaryPayload) {
    throw new Error('Invalid binary zabc file: missing payload');
  }
  const start = parsed.payloadOffset + data.offset;
  const end = start + data.length;
  return new Float32Array(parsed.binaryPayload.slice(start, end));
}

function decodeTimes(track: ZABCCacheTrackJSON, parsed: ParsedZABC) {
  if (track.times) {
    return decodeFloat32Array(track.times, parsed);
  }
  const sampleRate = track.sampleRate && track.sampleRate > 0 ? track.sampleRate : 30;
  const times = new Float32Array(track.positionFrames.length);
  for (let i = 0; i < times.length; i++) {
    times[i] = i / sampleRate;
  }
  return times;
}

function decodeBoundingBox(values: [number, number, number, number, number, number]) {
  return new BoundingBox(
    new Vector3(values[0], values[1], values[2]),
    new Vector3(values[3], values[4], values[5])
  );
}

function decodePCAFrames(data: string | ZABCBinaryBufferRef, rows: number, columns: number, parsed: ParsedZABC) {
  const values = decodeFloat32Array(data, parsed);
  const result: Float32Array[] = [];
  if (rows <= 0 || columns <= 0) {
    return result;
  }
  for (let i = 0; i < rows; i++) {
    result.push(values.slice(i * columns, i * columns + columns));
  }
  return result;
}

function toPCATrackData(track: ZABCCacheTrackJSON, parsed: ParsedZABC): PCAGeometryCacheTrackData {
  return {
    times: decodeTimes(track, parsed),
    bounds: track.bounds ?? [],
    positionReference: track.positionReference ? decodeFloat32Array(track.positionReference, parsed) : null,
    positionMean: decodeFloat32Array(track.positionMean!, parsed),
    positionBases: decodePCAFrames(
      track.positionBases!,
      track.positionComponents ?? 0,
      track.vectorLength ?? 0,
      parsed
    ),
    positionCoefficients: decodePCAFrames(
      track.positionCoefficients!,
      track.bounds?.length ?? 0,
      track.positionComponents ?? 0,
      parsed
    ),
    normalMean: track.normalMean ? decodeFloat32Array(track.normalMean, parsed) : null,
    normalBases:
      track.normalBases && track.normalComponents
        ? decodePCAFrames(track.normalBases, track.normalComponents, track.vectorLength ?? 0, parsed)
        : null,
    normalCoefficients:
      track.normalCoefficients && track.normalComponents
        ? decodePCAFrames(track.normalCoefficients, track.bounds?.length ?? 0, track.normalComponents, parsed)
        : null
  };
}

function parseLegacyZABC(arrayBuffer: ArrayBuffer): ParsedZABC {
  const text = new TextDecoder().decode(arrayBuffer);
  return {
    content: JSON.parse(text) as ZABCFileJSON,
    binaryPayload: null,
    payloadOffset: 0
  };
}

function parseBinaryZABC(arrayBuffer: ArrayBuffer): ParsedZABC {
  const view = new DataView(arrayBuffer);
  const version = view.getUint32(4, true);
  if (version !== 2 && version !== 3) {
    throw new Error(`Unsupported binary zabc version: ${version}`);
  }
  const manifestLength = view.getUint32(8, true);
  const manifestOffset = 12;
  const payloadOffset = manifestOffset + manifestLength;
  const manifestText = new TextDecoder().decode(arrayBuffer.slice(manifestOffset, payloadOffset));
  return {
    content: JSON.parse(manifestText) as ZABCFileJSON,
    binaryPayload: arrayBuffer,
    payloadOffset
  };
}

function isBinaryZABC(arrayBuffer: ArrayBuffer) {
  if (arrayBuffer.byteLength < 12) {
    return false;
  }
  const magic = new Uint8Array(arrayBuffer, 0, 4);
  return magic[0] === 0x5a && magic[1] === 0x41 && magic[2] === 0x42 && magic[3] === 0x43;
}

function remapGeometryCacheFrames(subMesh: AssetSubMeshData, frames: { positions: Float32Array; normals: Float32Array | null; boundingBox: BoundingBox }[]) {
  if (!subMesh.rawPositions || frames.length === 0) {
    return frames;
  }
  const sourcePositions = frames[0].positions;
  const sourceVertexCount = (sourcePositions.length / 3) >> 0;
  const targetVertexCount = (subMesh.rawPositions.length / 3) >> 0;
  if (sourceVertexCount === targetVertexCount) {
    return frames;
  }
  const remap = buildGeometryCacheRemap(subMesh.rawPositions, sourcePositions);
  if (!remap) {
    console.error(
      `Geometry cache vertex layout mismatch: source=${sourceVertexCount}, target=${targetVertexCount}. ` +
        `Export the base glb and zabc from the same final mesh layout.`
    );
    return frames;
  }
  return frames.map((frame) => ({
    positions: expandGeometryCacheData(frame.positions, remap),
    normals:
      frame.normals && ((frame.normals.length / 3) >> 0) === sourceVertexCount
        ? expandGeometryCacheData(frame.normals, remap)
        : null,
    boundingBox: frame.boundingBox
  }));
}

async function remapGeometryCacheFramesForMesh(
  mesh: Mesh,
  frames: { positions: Float32Array; normals: Float32Array | null; boundingBox: BoundingBox }[]
) {
  const rawPositions = await getMeshRawPositions(mesh);
  if (!rawPositions || frames.length === 0) {
    return frames;
  }
  const sourcePositions = frames[0].positions;
  const sourceVertexCount = (sourcePositions.length / 3) >> 0;
  const targetVertexCount = (rawPositions.length / 3) >> 0;
  if (sourceVertexCount === targetVertexCount) {
    return frames;
  }
  const remap = buildGeometryCacheRemap(rawPositions, sourcePositions);
  if (!remap) {
    console.error(
      `Geometry cache vertex layout mismatch: source=${sourceVertexCount}, target=${targetVertexCount}. ` +
        `Export the base glb and zabc from the same final mesh layout.`
    );
    return frames;
  }
  return frames.map((frame) => ({
    positions: expandGeometryCacheData(frame.positions, remap),
    normals:
      frame.normals && ((frame.normals.length / 3) >> 0) === sourceVertexCount
        ? expandGeometryCacheData(frame.normals, remap)
        : null,
    boundingBox: frame.boundingBox
  }));
}

function remapPCAGeometryCacheData(subMesh: AssetSubMeshData, track: PCAGeometryCacheTrackData): PCAGeometryCacheTrackData {
  const remapReference = track.positionReference ?? reconstructPCAGeometryCacheReference(track);
  if (!subMesh.rawPositions || remapReference.length === 0) {
    return track;
  }
  const sourceVertexCount = (remapReference.length / 3) >> 0;
  const targetVertexCount = (subMesh.rawPositions.length / 3) >> 0;
  if (sourceVertexCount === targetVertexCount) {
    return track;
  }
  const remap = buildGeometryCacheRemap(subMesh.rawPositions, remapReference);
  if (!remap) {
    console.error(
      `Geometry cache vertex layout mismatch: source=${sourceVertexCount}, target=${targetVertexCount}. ` +
        `Export the base glb and zabc from the same final mesh layout.`
    );
    return track;
  }
  return {
    times: track.times,
    bounds: track.bounds,
    positionReference: expandGeometryCacheData(remapReference, remap),
    positionMean: expandGeometryCacheData(track.positionMean, remap),
    positionBases: track.positionBases.map((basis) => expandGeometryCacheData(basis, remap)),
    positionCoefficients: track.positionCoefficients,
    normalMean:
      track.normalMean && ((track.normalMean.length / 3) >> 0) === sourceVertexCount
        ? expandGeometryCacheData(track.normalMean, remap)
        : null,
    normalBases:
      track.normalBases?.map((basis) =>
        ((basis.length / 3) >> 0) === sourceVertexCount ? expandGeometryCacheData(basis, remap) : basis
      ) ?? null,
    normalCoefficients: track.normalCoefficients ?? null
  };
}

async function remapPCAGeometryCacheDataForMesh(mesh: Mesh, track: PCAGeometryCacheTrackData): Promise<PCAGeometryCacheTrackData> {
  const rawPositions = await getMeshRawPositions(mesh);
  const remapReference = track.positionReference ?? reconstructPCAGeometryCacheReference(track);
  if (!rawPositions || remapReference.length === 0) {
    return track;
  }
  const sourceVertexCount = (remapReference.length / 3) >> 0;
  const targetVertexCount = (rawPositions.length / 3) >> 0;
  if (sourceVertexCount === targetVertexCount) {
    return track;
  }
  const remap = buildGeometryCacheRemap(rawPositions, remapReference);
  if (!remap) {
    console.error(
      `Geometry cache vertex layout mismatch: source=${sourceVertexCount}, target=${targetVertexCount}. ` +
        `Export the base glb and zabc from the same final mesh layout.`
    );
    return track;
  }
  return {
    times: track.times,
    bounds: track.bounds,
    positionReference: expandGeometryCacheData(remapReference, remap),
    positionMean: expandGeometryCacheData(track.positionMean, remap),
    positionBases: track.positionBases.map((basis) => expandGeometryCacheData(basis, remap)),
    positionCoefficients: track.positionCoefficients,
    normalMean:
      track.normalMean && ((track.normalMean.length / 3) >> 0) === sourceVertexCount
        ? expandGeometryCacheData(track.normalMean, remap)
        : null,
    normalBases:
      track.normalBases?.map((basis) =>
        ((basis.length / 3) >> 0) === sourceVertexCount ? expandGeometryCacheData(basis, remap) : basis
      ) ?? null,
    normalCoefficients: track.normalCoefficients ?? null
  };
}

async function getMeshRawPositions(mesh: Mesh) {
  const primitive = mesh.primitive;
  const info = primitive?.getVertexBufferInfo('position');
  if (!primitive || !info) {
    return null;
  }
  const bytes = await info.buffer.getBufferSubData();
  return extractPositionArray(bytes, info);
}

function extractPositionArray(bytes: Uint8Array<ArrayBuffer>, info: VertexBufferInfo) {
  const componentSize = (((info.type as unknown as { getSize(): number }).getSize?.() ?? 0) / Math.max(1, info.type.cols));
  if (componentSize !== 4) {
    return null;
  }
  const drawOffset = info.drawOffset ?? 0;
  const byteOffset = bytes.byteOffset + drawOffset;
  const byteLength = bytes.byteLength - drawOffset;
  const vertexCount = Math.max(0, Math.floor(byteLength / info.stride));
  const positions = new Float32Array(vertexCount * 3);
  for (let i = 0; i < vertexCount; i++) {
    const base = byteOffset + i * info.stride + info.offset;
    const values = new Float32Array(bytes.buffer, base, Math.max(3, info.type.cols));
    positions[i * 3] = values[0] ?? 0;
    positions[i * 3 + 1] = values[1] ?? 0;
    positions[i * 3 + 2] = values[2] ?? 0;
  }
  return positions;
}

function reconstructPCAGeometryCacheReference(track: PCAGeometryCacheTrackData) {
  const reference = new Float32Array(track.positionMean);
  const coefficients = track.positionCoefficients[0];
  if (!coefficients) {
    return reference;
  }
  const componentCount = Math.min(track.positionBases.length, coefficients.length);
  for (let component = 0; component < componentCount; component++) {
    const basis = track.positionBases[component];
    const coefficient = coefficients[component];
    if (!basis || coefficient === 0) {
      continue;
    }
    const count = Math.min(reference.length, basis.length);
    for (let i = 0; i < count; i++) {
      reference[i] += basis[i] * coefficient;
    }
  }
  return reference;
}

function buildGeometryCacheRemap(targetPositions: Float32Array, sourcePositions: Float32Array) {
  const sourceCount = (sourcePositions.length / 3) >> 0;
  const targetCount = (targetPositions.length / 3) >> 0;
  const buckets = new Map<string, number[]>();
  for (let i = 0; i < sourceCount; i++) {
    const key = geometryCachePositionKey(
      sourcePositions[i * 3],
      sourcePositions[i * 3 + 1],
      sourcePositions[i * 3 + 2]
    );
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.push(i);
    } else {
      buckets.set(key, [i]);
    }
  }
  const remap = new Uint32Array(targetCount);
  for (let i = 0; i < targetCount; i++) {
    const x = targetPositions[i * 3];
    const y = targetPositions[i * 3 + 1];
    const z = targetPositions[i * 3 + 2];
    let sourceIndex = findGeometryCacheSourceIndex(sourcePositions, buckets, x, y, z);
    if (sourceIndex < 0) {
      sourceIndex = findNearestGeometryCacheSourceIndex(sourcePositions, x, y, z);
    }
    if (sourceIndex < 0) {
      return null;
    }
    remap[i] = sourceIndex;
  }
  return remap;
}

function expandGeometryCacheData(source: Float32Array, remap: Uint32Array) {
  const expanded = new Float32Array(remap.length * 3);
  for (let i = 0; i < remap.length; i++) {
    const sourceOffset = remap[i] * 3;
    const targetOffset = i * 3;
    expanded[targetOffset] = source[sourceOffset];
    expanded[targetOffset + 1] = source[sourceOffset + 1];
    expanded[targetOffset + 2] = source[sourceOffset + 2];
  }
  return expanded;
}

function findGeometryCacheSourceIndex(
  sourcePositions: Float32Array,
  buckets: Map<string, number[]>,
  x: number,
  y: number,
  z: number
) {
  const bucket = buckets.get(geometryCachePositionKey(x, y, z));
  if (!bucket) {
    return -1;
  }
  const epsilon = 1e-5;
  for (const index of bucket) {
    const offset = index * 3;
    if (
      Math.abs(sourcePositions[offset] - x) <= epsilon &&
      Math.abs(sourcePositions[offset + 1] - y) <= epsilon &&
      Math.abs(sourcePositions[offset + 2] - z) <= epsilon
    ) {
      return index;
    }
  }
  return -1;
}

function findNearestGeometryCacheSourceIndex(sourcePositions: Float32Array, x: number, y: number, z: number) {
  const epsilonSquared = 1e-8;
  let bestIndex = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < sourcePositions.length; i += 3) {
    const dx = sourcePositions[i] - x;
    const dy = sourcePositions[i + 1] - y;
    const dz = sourcePositions[i + 2] - z;
    const distance = dx * dx + dy * dy + dz * dz;
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = i / 3;
    }
  }
  return bestDistance <= epsilonSquared ? bestIndex : -1;
}

function geometryCachePositionKey(x: number, y: number, z: number) {
  return `${Math.round(x * 100000)}|${Math.round(y * 100000)}|${Math.round(z * 100000)}`;
}
