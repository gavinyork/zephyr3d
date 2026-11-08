import { Vector3 } from '@zephyr3d/base';

/**
 * Mappings between directions and the frame grid of an octahedral impostor, Y up.
 *
 * @remarks
 * The hemispherical layout keeps only views from above the horizon, gaining more views where trees
 * are seen from. It follows the Godot Octahedral Impostors addon (wojtekpil, MIT,
 * `octahedral_utils.gd` and `ImpostorShader.shader`, `VecToHemiSphereOct` / `OctaHemiSphereEnc`).
 * The full layout is the usual octahedral map (Cigolle et al., "A Survey of Efficient
 * Representations for Independent Unit Vectors", JCGT 2014) with Y as the pole.
 *
 * Grid coordinates are in [0, 1]: frame (i, j) of an N × N grid is captured from the direction at
 * (i / (N - 1), j / (N - 1)), so frame centres lie on the grid points.
 *
 * @internal
 */

/** Direction of grid coordinates, normalized */
export function impostorGridToVector(u: number, v: number, hemi: boolean, out?: Vector3) {
  out = out ?? new Vector3();
  if (hemi) {
    const x = u - v;
    const z = -1 + u + v;
    out.setXYZ(x, 1 - Math.abs(x) - Math.abs(z), z);
  } else {
    const fx = u * 2 - 1;
    const fz = v * 2 - 1;
    const y = 1 - Math.abs(fx) - Math.abs(fz);
    if (y < 0) {
      out.setXYZ((1 - Math.abs(fz)) * Math.sign(fx || 1), y, (1 - Math.abs(fx)) * Math.sign(fz || 1));
    } else {
      out.setXYZ(fx, y, fz);
    }
  }
  return out.inplaceNormalize();
}

/** Grid coordinates of a direction, each in [0, 1] */
export function impostorVectorToGrid(dir: Vector3, hemi: boolean): [number, number] {
  if (hemi) {
    const y = Math.max(dir.y, 0.001);
    const sum = Math.abs(dir.x) + Math.abs(y) + Math.abs(dir.z);
    const ox = dir.x / sum;
    const oz = dir.z / sum;
    return [(ox + oz + 1) * 0.5, (oz - ox + 1) * 0.5];
  }
  const sum = Math.abs(dir.x) + Math.abs(dir.y) + Math.abs(dir.z);
  let ox = dir.x / sum;
  let oz = dir.z / sum;
  if (dir.y < 0) {
    const tx = (1 - Math.abs(oz)) * Math.sign(ox || 1);
    const tz = (1 - Math.abs(ox)) * Math.sign(oz || 1);
    ox = tx;
    oz = tz;
  }
  return [(ox + 1) * 0.5, (oz + 1) * 0.5];
}

/**
 * Basis of the plane a frame is captured on, as the capture camera's: `z` towards the camera,
 * `x` to the right of the image and `y` up it (Matrix4x4.lookAt with Y up, or -Z up when looking
 * straight down or up).
 */
export function impostorFrameBasis(dir: Vector3) {
  const z = new Vector3(dir).inplaceNormalize();
  const up = Math.abs(z.y) > 0.999 ? new Vector3(0, 0, -1) : new Vector3(0, 1, 0);
  const x = Vector3.cross(up, z).inplaceNormalize();
  const y = Vector3.cross(z, x).inplaceNormalize();
  return { x, y, z, up };
}
