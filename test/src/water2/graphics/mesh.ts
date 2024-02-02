// @ts-ignore:
import { vec3 } from 'gl-matrix';

import { Mesh } from './gpu';

declare const vec3: any;

export const createGrid = (expansion: number = 10.0): Mesh => {
  const PRIMARY = [1.0, 1.0, 1.0];
  const SECONDARY = [0.55, 0.55, 0.55];
  const STEP = expansion / 2;
  const UINT = expansion / 10;

  let u = 0;
  let vertices = [];
  let indices = [];

  for (let e = 0.0; e <= expansion; e += UINT) {
    if (u == 0) {
      indices.push(indices.length);
      vertices.push(-expansion, 0.0, 0.0, ...PRIMARY);

      indices.push(indices.length);
      vertices.push(expansion, 0.0, 0.0, ...PRIMARY);

      indices.push(indices.length);
      vertices.push(0.0, 0.0, -expansion, ...PRIMARY);

      indices.push(indices.length);
      vertices.push(0.0, 0.0, expansion, ...PRIMARY);
    } else {
      const color = u % STEP == 0 ? PRIMARY : SECONDARY;
      indices.push(indices.length);
      vertices.push(-expansion, 0.0, e, ...color);
      indices.push(indices.length);
      vertices.push(expansion, 0.0, e, ...color);
      indices.push(indices.length);
      vertices.push(-expansion, 0.0, -e, ...color);
      indices.push(indices.length);
      vertices.push(expansion, 0.0, -e, ...color);

      indices.push(indices.length);
      vertices.push(e, 0.0, -expansion, ...color);
      indices.push(indices.length);
      vertices.push(e, 0.0, expansion, ...color);
      indices.push(indices.length);
      vertices.push(-e, 0.0, -expansion, ...color);
      indices.push(indices.length);
      vertices.push(-e, 0.0, expansion, ...color);
    }
    u++;
  }

  return {
    vertexFormat: [
      {
        semantics: 'position',
        size: 3,
        type: WebGL2RenderingContext.FLOAT,
        slot: 0,
        offset: 0,
        stride: 24,
      },
      {
        semantics: 'color',
        size: 3,
        type: WebGL2RenderingContext.FLOAT,
        slot: 2,
        offset: 12,
        stride: 24,
      },
    ],
    vertexData: Float32Array.from(vertices),
    indexData: Uint32Array.from(indices),
  };
};

export const createQuad = (): Mesh => ({
  vertexFormat: [
    {
      semantics: 'position',
      size: 3,
      type: WebGL2RenderingContext.FLOAT,
      slot: 0,
      offset: 0,
      stride: 20,
    },
    {
      semantics: 'uv',
      size: 2,
      type: WebGL2RenderingContext.FLOAT,
      slot: 1,
      offset: 12,
      stride: 20,
    },
  ],
  vertexData: Float32Array.of(
    -1,
    -1,
    0,
    0.0,
    0.0,
    1,
    -1,
    0,
    1.0,
    0.0,
    1,
    1,
    0,
    1.0,
    1.0,
    -1,
    1,
    0,
    0.0,
    1.0
  ),
  indexData: Uint32Array.of(0, 1, 2, 0, 2, 3),
});

export const createPlane = (resolution: number, wired = false): Mesh => {
  const vertices: vec3[] = [];
  const indices: number[] = [];
  const N = resolution;
  const L = 1.0;
  const delta = L / (N - 1);
  const offset = vec3.fromValues(-L * 0.5, 0.0, -L * 0.5);

  for (let i = 0; i < N - 1; i++) {
    for (let j = 0; j < N - 1; j++) {
      let v0 = vec3.fromValues(j * delta, 0.0, i * delta);
      vec3.add(v0, v0, offset);

      let v1 = vec3.fromValues((j + 1) * delta, 0.0, i * delta);
      vec3.add(v1, v1, offset);

      let v2 = vec3.fromValues((j + 1) * delta, 0.0, (i + 1) * delta);
      vec3.add(v2, v2, offset);

      let v3 = vec3.fromValues(j * delta, 0.0, (i + 1) * delta);
      vec3.add(v3, v3, offset);

      if (wired) {
        indices.push(
          vertices.length,
          vertices.length + 1,
          vertices.length + 1,
          vertices.length + 2
        );
      } else {
        indices.push(vertices.length + 1, vertices.length, vertices.length + 2);
        indices.push(vertices.length + 3, vertices.length + 2, vertices.length);
      }

      vertices.push(v0, v1, v2, v3);
    }
  }

  return {
    vertexFormat: [
      {
        semantics: 'position',
        size: 3,
        type: WebGL2RenderingContext.FLOAT,
        slot: 0,
        offset: 0,
        stride: 12,
      },
    ],

    vertexData: Float32Array.from(vertices.map((v) => [...v]).flat()),
    indexData: Uint32Array.from(indices),
  };
};

export const createNDCGrid = (
  resolutionX: number,
  resolutionY: number,
  marginX = 1.0,
  marginY = 1.0
): Mesh => {
  const vertices: vec3[] = [];
  const indices: number[] = [];

  const Lx = 1.0 + marginX;
  const Ly = 1.0 + marginY;
  const deltaX = (2.0 * Lx) / (resolutionX - 1);
  const deltaY = (2.0 * Ly) / (resolutionY - 1);
  const offset = vec3.fromValues(-Lx, -Ly, -1.0);

  for (let i = 0; i < resolutionY - 1; i++) {
    for (let j = 0; j < resolutionX - 1; j++) {
      let v0 = vec3.fromValues(j * deltaX, i * deltaY, 0.0);
      vec3.add(v0, v0, offset);

      let v1 = vec3.fromValues((j + 1) * deltaX, i * deltaY, 0.0);
      vec3.add(v1, v1, offset);

      let v2 = vec3.fromValues((j + 1) * deltaX, (i + 1) * deltaY, 0.0);
      vec3.add(v2, v2, offset);

      let v3 = vec3.fromValues(j * deltaX, (i + 1) * deltaY, 0.0);
      vec3.add(v3, v3, offset);

      indices.push(vertices.length + 1, vertices.length, vertices.length + 2);
      indices.push(vertices.length + 3, vertices.length + 2, vertices.length);

      vertices.push(v0, v1, v2, v3);
    }
  }

  return {
    vertexFormat: [
      {
        semantics: 'position',
        size: 3,
        type: WebGL2RenderingContext.FLOAT,
        slot: 0,
        offset: 0,
        stride: 12,
      },
    ],

    vertexData: Float32Array.from(vertices.map((v) => [...v]).flat()),
    indexData: Uint32Array.from(indices),
  };
};

export const createDisc = (
  rings: number,
  segments: number,
  delta: number,
  steep: number,
  offset: number
): Mesh => {
  const vertices: vec3[] = [vec3.create()];
  const indices: number[] = [];
  const dphi = (2.0 * Math.PI) / segments;

  let r = delta;
  for (let i = 0; i < rings; i++) {
    let phi = 0.0;
    for (let j = 0; j < segments; j++) {
      vertices.push(vec3.fromValues(Math.sin(phi) * r, 0.0, Math.cos(phi) * r));
      if (i < rings - 1) {
        const i0 = i * segments + j + 1;
        const i1 = (i + 1) * segments + j + 1;
        const i2 = (i + 1) * segments + ((j + 1) % segments) + 1;
        const i3 = i * segments + ((j + 1) % segments) + 1;

        if (i === 0) {
          indices.push(0, i0, i3);
        }

        indices.push(i0, i1, i2, i0, i2, i3);
      }
      phi += dphi;
    }

    r += delta * (Math.pow(i / rings / offset, steep) + 1);
  }

  return {
    vertexFormat: [
      {
        semantics: 'position',
        size: 3,
        type: WebGL2RenderingContext.FLOAT,
        slot: 0,
        offset: 0,
        stride: 12,
      },
    ],

    vertexData: Float32Array.from(vertices.map((v) => [...v]).flat()),
    indexData: Uint32Array.from(indices),
  };
};
