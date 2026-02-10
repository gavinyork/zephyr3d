import type { AssetSubMeshData } from '../asset';
import { MAX_MORPH_ATTRIBUTES, MAX_MORPH_TARGETS } from '../values';
import { BoundingBox } from '../utility/bounding_volume';
import { getDevice } from '../app/api';

/** @internal */
export function processMorphData(subMesh: AssetSubMeshData, morphWeights: number[]) {
  const device = getDevice();
  const numTargets = subMesh.numTargets;
  if (numTargets === 0) {
    return;
  }
  const attributes = Object.getOwnPropertyNames(subMesh.targets);
  const numVertices = subMesh.primitive.get()!.getNumVertices();
  const weightsAndOffsets = new Float32Array(4 + MAX_MORPH_TARGETS + MAX_MORPH_ATTRIBUTES);
  for (let i = 0; i < numTargets; i++) {
    weightsAndOffsets[4 + i] = morphWeights?.[i] ?? 0;
  }
  const textureSize = Math.ceil(Math.sqrt(numVertices * attributes.length * numTargets));
  if (textureSize > device.getDeviceCaps().textureCaps.maxTextureSize) {
    // TODO: reduce morph attributes
    throw new Error(`Morph target data too large`);
  }
  weightsAndOffsets[0] = textureSize;
  weightsAndOffsets[1] = textureSize;
  weightsAndOffsets[2] = numVertices;
  weightsAndOffsets[3] = numTargets;
  let offset = 0;
  const textureData = new Float32Array(textureSize * textureSize * 4);
  for (let attrib = 0; attrib < MAX_MORPH_ATTRIBUTES; attrib++) {
    const index = attributes.indexOf(String(attrib));
    if (index < 0) {
      weightsAndOffsets[4 + MAX_MORPH_TARGETS + attrib] = -1;
      continue;
    }
    weightsAndOffsets[4 + MAX_MORPH_TARGETS + attrib] = offset >> 2;
    const info = subMesh.targets![attrib]!;
    if (info.data.length !== numTargets) {
      console.error(`Invalid morph target data`);
      return;
    }
    for (let t = 0; t < numTargets; t++) {
      const data = info.data[t];
      for (let i = 0; i < numVertices; i++) {
        for (let j = 0; j < 4; j++) {
          textureData[offset++] = j < info.numComponents ? data[i * info.numComponents + j] : 1;
        }
      }
    }
  }
  const morphBoundingBox = new BoundingBox();
  calculateMorphBoundingBox(
    morphBoundingBox,
    subMesh.targetBox!,
    weightsAndOffsets.subarray(4, 4 + MAX_MORPH_TARGETS),
    numTargets
  );
  const meshAABB = subMesh.mesh!.getBoundingVolume()!.toAABB();
  morphBoundingBox.minPoint.addBy(meshAABB.minPoint);
  morphBoundingBox.maxPoint.addBy(meshAABB.maxPoint);

  const names: Record<string, number> = {};
  for (let i = 0; i < numTargets; i++) {
    const name = `Target${i}`;
    names[name] = i;
  }

  subMesh.mesh!.setMorphData({ width: textureSize, height: textureSize, data: textureData });
  subMesh.mesh!.setMorphInfo({ data: weightsAndOffsets, names });
  subMesh.mesh!.setAnimatedBoundingBox(morphBoundingBox);
}

/** @internal */
export function calculateMorphBoundingBox(
  morphBoundingBox: BoundingBox,
  keyframeBoundingBox: BoundingBox[],
  weights: Float32Array,
  numTargets: number
) {
  morphBoundingBox.minPoint.setXYZ(0, 0, 0);
  morphBoundingBox.maxPoint.setXYZ(0, 0, 0);
  for (let i = 0; i < numTargets; i++) {
    const weight = weights[i];
    const keyframeBox = keyframeBoundingBox[i];
    morphBoundingBox.minPoint.x += keyframeBox.minPoint.x * weight;
    morphBoundingBox.minPoint.y += keyframeBox.minPoint.y * weight;
    morphBoundingBox.minPoint.y += keyframeBox.minPoint.z * weight;
    morphBoundingBox.maxPoint.x += keyframeBox.maxPoint.x * weight;
    morphBoundingBox.maxPoint.y += keyframeBox.maxPoint.y * weight;
    morphBoundingBox.maxPoint.y += keyframeBox.maxPoint.z * weight;
  }
}
