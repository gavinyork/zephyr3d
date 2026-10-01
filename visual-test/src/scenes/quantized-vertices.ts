import { Vector3, Vector4 } from '@zephyr3d/base';
import { getDevice, Mesh, Primitive } from '@zephyr3d/scene';
import type { Texture2D } from '@zephyr3d/device';
import type { VisualScene } from '../types';
import { bareScene, keyLight, pbr, placeCamera } from './common';

interface SphereData {
  positions: Float32Array<ArrayBuffer>;
  normals: Float32Array<ArrayBuffer>;
  tangents: Float32Array<ArrayBuffer>;
  uvs: Float32Array<ArrayBuffer>;
  indices: Uint16Array<ArrayBuffer>;
}

/** UV sphere with analytic normals and tangents, deterministic by construction. */
function sphereData(radius: number, rings: number, segments: number): SphereData {
  const positions: number[] = [];
  const normals: number[] = [];
  const tangents: number[] = [];
  const uvs: number[] = [];
  for (let r = 0; r <= rings; r++) {
    const theta = (r / rings) * Math.PI;
    for (let s = 0; s <= segments; s++) {
      const phi = (s / segments) * Math.PI * 2;
      const nx = Math.sin(theta) * Math.cos(phi);
      const ny = Math.cos(theta);
      const nz = Math.sin(theta) * Math.sin(phi);
      positions.push(nx * radius, ny * radius, nz * radius);
      normals.push(nx, ny, nz);
      // d(position)/d(phi), normalized; w carries the bitangent sign
      tangents.push(-Math.sin(phi), 0, Math.cos(phi), 1);
      uvs.push(s / segments, r / rings);
    }
  }
  const indices: number[] = [];
  const stride = segments + 1;
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < segments; s++) {
      const a = r * stride + s;
      const b = a + stride;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    tangents: new Float32Array(tangents),
    uvs: new Float32Array(uvs),
    indices: new Uint16Array(indices)
  };
}

/** Quantizes 3- or 4-component unit vectors to signed normalized 4-component integers. */
function quantizeSnorm4(src: Float32Array, components: 3 | 4, bits: 8 | 16) {
  const count = src.length / components;
  const out = bits === 8 ? new Int8Array(count * 4) : new Int16Array(count * 4);
  const scale = bits === 8 ? 127 : 32767;
  for (let i = 0; i < count; i++) {
    for (let c = 0; c < 4; c++) {
      const v = c < components ? src[i * components + c] : 0;
      out[i * 4 + c] = Math.round(Math.max(-1, Math.min(1, v)) * scale);
    }
  }
  return out;
}

function makePrimitive(data: SphereData, bits: 0 | 8 | 16) {
  const primitive = new Primitive();
  primitive.createAndSetVertexBuffer('position_f32x3', data.positions);
  primitive.createAndSetVertexBuffer('tex0_f32x2', data.uvs);
  if (bits === 0) {
    primitive.createAndSetVertexBuffer('normal_f32x3', data.normals);
    primitive.createAndSetVertexBuffer('tangent_f32x4', data.tangents);
  } else {
    primitive.createAndSetVertexBuffer(
      bits === 8 ? 'normal_i8normx4' : 'normal_i16normx4',
      quantizeSnorm4(data.normals, 3, bits)
    );
    primitive.createAndSetVertexBuffer(
      bits === 8 ? 'tangent_i8normx4' : 'tangent_i16normx4',
      quantizeSnorm4(data.tangents, 4, bits)
    );
  }
  primitive.createAndSetIndexBuffer(data.indices);
  primitive.primitiveType = 'triangle-list';
  primitive.indexCount = data.indices.length;
  return primitive;
}

/** Tangent-space normal map of round bumps, so the tangent frame shows in the shading. */
function bumpNormalMap(size = 64): Texture2D {
  const data = new Uint8Array(size * size * 4);
  const freq = (Math.PI * 2 * 6) / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = 0.6 * Math.cos(x * freq) * Math.sin(y * freq);
      const dy = 0.6 * Math.sin(x * freq) * Math.cos(y * freq);
      const len = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      data[i] = Math.round(((-dx / len) * 0.5 + 0.5) * 255);
      data[i + 1] = Math.round(((-dy / len) * 0.5 + 0.5) * 255);
      data[i + 2] = Math.round(((1 / len) * 0.5 + 0.5) * 255);
      data[i + 3] = 255;
    }
  }
  const tex = getDevice().createTexture2D('rgba8unorm', size, size);
  if (!tex) {
    throw new Error('bumpNormalMap: texture creation failed');
  }
  tex.update(data, 0, 0, size, size);
  return tex;
}

/**
 * Normals and tangents stored as signed normalized integers, as compressed
 * meshes ship them: float, 16-bit and 8-bit, left to right.
 *
 * The shader declares these inputs as vec3/vec4 floats while the buffers hold
 * four 8- or 16-bit integers, so this pins both the normalized-format decode and
 * the component-count mismatch on each backend. The three spheres should look
 * nearly identical; a broken decode shows as black, flat or inverted shading on
 * the quantized ones, and a broken tangent frame as bumps lit from the wrong side.
 */
export const quantizedVertices: VisualScene = {
  name: 'quantized-vertices',
  description:
    'Float, snorm16 and snorm8 normals and tangents side by side under a normal-mapped PBR material.',
  setup({ scene, camera }) {
    bareScene(scene);
    keyLight(scene);
    const data = sphereData(0.8, 32, 48);
    const normalMap = bumpNormalMap();
    ([0, 16, 8] as const).forEach((bits, i) => {
      const material = pbr(new Vector4(0.8, 0.55, 0.35, 1), 0, 0.35);
      material.normalTexture = normalMap;
      const mesh = new Mesh(scene, makePrimitive(data, bits), material);
      mesh.position.setXYZ((i - 1) * 1.9, 0, 0);
    });
    placeCamera(camera, new Vector3(0, 0.6, 5.2));
  }
};
