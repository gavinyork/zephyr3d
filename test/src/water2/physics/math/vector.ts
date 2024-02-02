export type Vector = Float32Array;
export type Matrix = Float32Array;

export const VcV = (out: Vector, from: Vector) => {
  out.set(from, 0);
};

export const VxV = (V1: Vector, V2: Vector): number => {
  let dot = 0.0;
  for (let j = 0; j < V1.length; j++) {
    dot += V1[j] * V2[j];
  }
  return dot;
};

export const VmV = (out: Vector, V1: Vector, V2: Vector) => {
  const n = out.length;
  for (let i = 0; i < n; i++) {
    out[i] = V1[i] * V2[i];
  }
};

export const VpVxS = (out: Vector, V1: Vector, V2: Vector, S: number) => {
  const n = out.length;
  for (let i = 0; i < n; i++) {
    out[i] = V1[i] + V2[i] * S;
  }
};

export const VpV = (out: Vector, V1: Vector, V2: Vector) => {
  const n = out.length;
  for (let i = 0; i < n; i++) {
    out[i] = V1[i] + V2[i];
  }
};

export const MxV = (out: Vector, M: Matrix, V: Vector) => {
  const n = V.length;
  const m = M.length / n;

  for (let i = 0; i < m; i++) {
    out[i] = 0.0;
    for (let j = 0; j < n; j++) {
      out[i] += M[i * n + j] * V[j];
    }
  }
};

export const VxSpVxS = (
  out: Vector,
  V1: Vector,
  S1: number,
  V2: Vector,
  S2: number
) => {
  const n = out.length;
  for (let i = 0; i < n; i++) {
    out[i] = V1[i] * S1 + V2[i] * S2;
  }
};
