import { PBArrayTypeInfo, PBPrimitiveType, PBPrimitiveTypeInfo, PBStructTypeInfo } from '@zephyr3d/device';
import { Application } from '../app';
import type { AssetSubMeshData } from '../asset';
import {
  MAX_MORPH_ATTRIBUTES,
  MAX_MORPH_TARGETS,
  MORPH_ATTRIBUTE_VECTOR_COUNT,
  MORPH_WEIGHTS_VECTOR_COUNT
} from '../values';
import { ShaderHelper } from '../material';
import type { AABB } from '@zephyr3d/base';
import { BoundingBox } from '../utility';

export function processMorphData(subMesh: AssetSubMeshData, morphWeights?: number[]) {
  const numTargets = subMesh.numTargets;
  if (numTargets === 0) {
    return;
  }
  const attributes = Object.getOwnPropertyNames(subMesh.targets);
  const numVertices = subMesh.primitive.getNumVertices();
  const weightsAndOffsets = new Float32Array(4 + MAX_MORPH_TARGETS + MAX_MORPH_ATTRIBUTES);
  for (let i = 0; i < numTargets; i++) {
    weightsAndOffsets[4 + i] = morphWeights?.[i] ?? 0;
  }
  const textureSize = Math.ceil(Math.sqrt(numVertices * attributes.length * numTargets));
  if (textureSize > Application.instance.device.getDeviceCaps().textureCaps.maxTextureSize) {
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
    const info = subMesh.targets[attrib];
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
  const morphTexture = Application.instance.device.createTexture2D('rgba32f', textureSize, textureSize, {
    samplerOptions: {
      minFilter: 'nearest',
      magFilter: 'nearest',
      mipFilter: 'none'
    }
  });
  morphTexture.update(textureData, 0, 0, textureSize, textureSize);
  const bufferType = new PBStructTypeInfo('dummy', 'std140', [
    {
      name: ShaderHelper.getMorphInfoUniformName(),
      type: new PBArrayTypeInfo(
        new PBPrimitiveTypeInfo(PBPrimitiveType.F32VEC4),
        1 + MORPH_WEIGHTS_VECTOR_COUNT + MORPH_ATTRIBUTE_VECTOR_COUNT
      )
    }
  ]);
  const morphUniformBuffer = Application.instance.device.createStructuredBuffer(
    bufferType,
    {
      usage: 'uniform'
    },
    weightsAndOffsets
  );
  const morphBoundingBox = new BoundingBox();
  calculateMorphBoundingBox(
    morphBoundingBox,
    subMesh.mesh.getBoundingVolume().toAABB(),
    subMesh.targetBox,
    weightsAndOffsets.subarray(4, 4 + MAX_MORPH_TARGETS),
    numTargets
  );
  subMesh.mesh.setMorphData(morphTexture);
  subMesh.mesh.setMorphInfo(morphUniformBuffer);
  subMesh.mesh.setAnimatedBoundingBox(morphBoundingBox);
}

/** @internal */
export function calculateMorphBoundingBox(
  morphBoundingBox: BoundingBox,
  originBoundingBox: AABB,
  keyframeBoundingBox: BoundingBox[],
  weights: Float32Array,
  numTargets: number
) {
  morphBoundingBox.minPoint.set(originBoundingBox.minPoint);
  morphBoundingBox.maxPoint.set(originBoundingBox.maxPoint);
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
