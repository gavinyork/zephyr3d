import { Vector3 } from '@zephyr3d/base';
import { BoundingBox, Primitive } from '@zephyr3d/scene';

/**
 * Reference eyeball geometry, built to the convention EyeMaterial documents.
 *
 * This doubles as the executable version of the asset spec: a front-facing
 * dome, UVs planar-projected along +Z with the pupil at (0.5, 0.5), and
 * tangents following +U. An artist can match this in a DCC tool and the
 * material will behave identically.
 *
 * Two details are easy to get wrong and both break the illusion rather than
 * merely degrading it:
 *
 * - UVs must be isotropic around the iris. A stock UV sphere is
 *   equirectangular, so a circular iris in 3D becomes a stretched band in UV
 *   space and the analytic region split falls apart.
 * - Tangents must follow +U, not the azimuth. An azimuth-aligned tangent
 *   rotates the refraction offset differently at every point around the iris,
 *   which tears the pupil into lobes. Standard MikkTSpace exports are already
 *   correct; this is only a hazard when generating geometry by hand.
 */
export function createEyeballPrimitive(radius = 1, rings = 64, segments = 96): Primitive {
  const positions: number[] = [];
  const normals: number[] = [];
  const tangents: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const bbox = new BoundingBox();
  bbox.beginExtend();

  // Slightly past the equator, so the silhouette is a full circle head-on.
  const maxPolar = Math.PI * 0.55;
  const uvScale = 0.5 / maxPolar;

  for (let i = 0; i <= rings; i++) {
    const polar = (i / rings) * maxPolar;
    const sinP = Math.sin(polar);
    const cosP = Math.cos(polar);
    for (let j = 0; j <= segments; j++) {
      const azimuth = (j / segments) * Math.PI * 2;
      const sinA = Math.sin(azimuth);
      const cosA = Math.cos(azimuth);
      const nx = sinP * cosA;
      const ny = sinP * sinA;
      const nz = cosP;
      positions.push(nx * radius, ny * radius, nz * radius);
      normals.push(nx, ny, nz);
      uvs.push(0.5 + polar * uvScale * cosA, 0.5 + polar * uvScale * sinA);
      // +X flattened onto the tangent plane, i.e. the +U direction of a planar
      // projection along +Z.
      const dot = nx;
      let tx = 1 - nx * dot;
      let ty = -ny * dot;
      let tz = -nz * dot;
      const len = Math.hypot(tx, ty, tz) || 1;
      tx /= len;
      ty /= len;
      tz /= len;
      tangents.push(tx, ty, tz, 1);
      bbox.extend(new Vector3(nx * radius, ny * radius, nz * radius));
    }
  }

  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < segments; j++) {
      const a = i * (segments + 1) + j;
      const b = a + segments + 1;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }

  const prim = new Primitive();
  prim.createAndSetVertexBuffer('position_f32x3', new Float32Array(positions));
  prim.createAndSetVertexBuffer('normal_f32x3', new Float32Array(normals));
  prim.createAndSetVertexBuffer('tangent_f32x4', new Float32Array(tangents));
  prim.createAndSetVertexBuffer('tex0_f32x2', new Float32Array(uvs));
  prim.createAndSetIndexBuffer(new Uint32Array(indices));
  prim.setBoundingVolume(bbox);
  prim.indexCount = indices.length;
  return prim;
}
