import { Quaternion, Vector3 } from '@zephyr3d/base';

export function createCylinder(
  center: Vector3,
  withCaps: boolean,
  smoothLevel: number,
  axis: Vector3,
  radius: number,
  height: number,
  vertexbuffer: Float32Array,
  indexbuffer: Uint16Array,
  indexOffset: number
): { numVertices: number; numIndices: number } {
  if (smoothLevel < 3) {
    smoothLevel = 3;
  }
  const numVerts = smoothLevel * 2;
  let numTris = smoothLevel * 2;
  if (withCaps) {
    numTris += 2 * (smoothLevel - 2);
  }
  const numVertices = numVerts;
  const numIndices = numTris * 3;

  if (!vertexbuffer && !indexbuffer) {
    return { numVertices, numIndices };
  }

  const theta = (Math.PI * 2) / smoothLevel;

  const axisY = new Vector3(axis);
  axisY.inplaceNormalize();

  const temp = new Vector3(0, 0, 0);
  let idx = 0;
  if (Math.abs(axisY[1]) < Math.abs(axisY[idx])) {
    idx = 1;
  }
  if (Math.abs(axisY[2]) < Math.abs(axisY[idx])) {
    idx = 2;
  }
  temp[idx] = 1;

  const axisX = Vector3.cross(axisY, temp);
  let vIndex = 0;
  let iIndex = 0;

  if (vertexbuffer) {
    for (let i = 0; i < smoothLevel; ++i) {
      const rotMatrix = Quaternion.fromAxisAngle(axisY, -i * theta).toMatrix4x4();
      const point = rotMatrix.transformVectorAffine(axisX).scaleBy(radius);
      vertexbuffer.set(Vector3.add(center, point), vIndex);
      vIndex += 3;
      vertexbuffer.set(Vector3.add(Vector3.add(center, point), Vector3.scale(axisY, height)), vIndex);
      vIndex += 3;
    }
  }

  if (indexbuffer) {
    for (let i = 0; i < smoothLevel * 2; ++i) {
      indexbuffer[iIndex++] = ((((i + 1) / 2) * 2) % (smoothLevel * 2)) + indexOffset;
      indexbuffer[iIndex++] = (i / 2) * 2 + 1 + indexOffset;
      indexbuffer[iIndex++] = ((i + 2) % (smoothLevel * 2)) + indexOffset;
    }

    if (withCaps) {
      for (let i = 0; i < smoothLevel - 2; ++i) {
        indexbuffer[iIndex++] = 0 + indexOffset;
        indexbuffer[iIndex++] = (i + 1) * 2 + indexOffset;
        indexbuffer[iIndex++] = (i + 2) * 2 + indexOffset;
      }
      for (let i = 0; i < smoothLevel - 2; ++i) {
        indexbuffer[iIndex++] = (i + 1) * 2 + 1 + indexOffset;
        indexbuffer[iIndex++] = 1 + indexOffset;
        indexbuffer[iIndex++] = (i + 2) * 2 + 1 + indexOffset;
      }
    }
  }
  return { numVertices, numIndices };
}

export function createCone(
  center: Vector3,
  withCap: boolean,
  smoothLevel: number,
  axis: Vector3,
  radius: number,
  height: number,
  vertexbuffer: Float32Array,
  indexbuffer: Uint16Array,
  indexOffset: number
): { numVertices: number; numIndices: number } {
  if (smoothLevel < 3) {
    smoothLevel = 3;
  }
  const numVerts = smoothLevel + 1;
  let numTris = smoothLevel;
  if (withCap) {
    numTris += smoothLevel - 2;
  }
  const numVertices = numVerts;
  const numIndices = 3 * numTris;

  if (!vertexbuffer && !indexbuffer) {
    return { numVertices, numIndices };
  }

  const theta = (Math.PI * 2) / smoothLevel;

  const axisY = new Vector3(axis);
  axisY.inplaceNormalize();

  const temp = new Vector3(0, 0, 0);
  let idx = 0;
  if (Math.abs(axisY[1]) < Math.abs(axisY[idx])) {
    idx = 1;
  }
  if (Math.abs(axisY[2]) < Math.abs(axisY[idx])) {
    idx = 2;
  }
  temp[idx] = 1;

  const axisX = Vector3.cross(axisY, temp);
  let vIndex = 0;
  let iIndex = 0;

  if (vertexbuffer) {
    for (let i = 0; i < smoothLevel; ++i) {
      const rotMatrix = Quaternion.fromAxisAngle(axisY, i * theta).toMatrix4x4();
      const point = rotMatrix.transformVectorAffine(axisX);
      point.scaleBy(radius);
      vertexbuffer.set(Vector3.add(center, point), vIndex);
      vIndex += 3;
    }
    vertexbuffer.set(Vector3.add(center, Vector3.scale(axisY, height)), vIndex);
    vIndex += 3;
  }

  if (indexbuffer) {
    for (let i = 0; i < smoothLevel; ++i) {
      indexbuffer[iIndex++] = smoothLevel + indexOffset;
      indexbuffer[iIndex++] = i + indexOffset;
      indexbuffer[iIndex++] = ((i + 1) % smoothLevel) + indexOffset;
    }

    if (withCap) {
      for (let i = 0; i < smoothLevel - 2; ++i) {
        indexbuffer[iIndex++] = i + 1 + indexOffset;
        indexbuffer[iIndex++] = 0 + indexOffset;
        indexbuffer[iIndex++] = ((i + 2) % smoothLevel) + indexOffset;
      }
    }
  }

  return { numVertices, numIndices };
}
