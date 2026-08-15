import { Vector3, Vector4 } from '@zephyr3d/base';
import { BoundingBox, EyeMaterial, getDevice, Mesh, Primitive } from '@zephyr3d/scene';
import type { Scene } from '@zephyr3d/scene';
import type { Texture2D } from '@zephyr3d/device';
import type { VisualScene } from '../types';
import { bareScene, keyLight, placeCamera } from './common';

/**
 * An eyeball built to the convention EyeMaterial documents, which the stock
 * SphereShape does not satisfy.
 *
 * SphereShape emits equirectangular UVs - u is longitude over the full 360
 * degrees, v is latitude - so UV distance is wildly anisotropic and (0.5, 0.5)
 * lands on the seam rather than the front. The material derives its sclera /
 * limbus / iris split from `length(uv - irisCenter)`, which only means anything
 * when the iris neighbourhood is unwrapped isotropically.
 *
 * Real eye assets are authored exactly that way: the front of the eye is
 * planar-unwrapped to a disc with the pupil at its centre. This builds the same
 * thing - a front-facing dome, UVs projected along +Z, pupil at (0.5, 0.5) -
 * so the scenes exercise the material under its documented contract instead of
 * silently testing a mismatched asset.
 */
function createEyeballPrimitive(radius = 1, rings = 48, segments = 64): Primitive {
  const positions: number[] = [];
  const normals: number[] = [];
  const tangents: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const bbox = new BoundingBox();
  bbox.beginExtend();

  // Front hemisphere plus a little past the equator, so the silhouette is a
  // full circle from the front and there is geometry for the limbus to sit on.
  const maxPolar = Math.PI * 0.55;
  // UV radius consumed by the dome. The iris (radius ~0.16) then sits well
  // inside it, as it would on a real asset.
  const uvScale = 0.5 / maxPolar;

  for (let i = 0; i <= rings; i++) {
    const polar = (i / rings) * maxPolar;
    const sinP = Math.sin(polar);
    const cosP = Math.cos(polar);
    for (let j = 0; j <= segments; j++) {
      const azimuth = (j / segments) * Math.PI * 2;
      const sinA = Math.sin(azimuth);
      const cosA = Math.cos(azimuth);
      // +Z is the gaze direction.
      const nx = sinP * cosA;
      const ny = sinP * sinA;
      const nz = cosP;
      positions.push(nx * radius, ny * radius, nz * radius);
      normals.push(nx, ny, nz);
      // Planar projection along +Z: polar angle maps to UV radius.
      uvs.push(0.5 + polar * uvScale * cosA, 0.5 + polar * uvScale * sinA);
      // Tangent must follow +U, not the azimuth. With a planar projection the
      // +U direction is world +X flattened onto the tangent plane; a tangent
      // that instead spins with the azimuth rotates the refraction offset
      // differently at every point around the iris, which tears the pupil into
      // lobes. (Standard MikkTSpace exports already satisfy this - the mistake
      // is only easy to make when generating geometry by hand.)
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
  prim.createAndSetIndexBuffer(new Uint16Array(indices));
  prim.setBoundingVolume(bbox);
  prim.indexCount = indices.length;
  return prim;
}

/**
 * Procedural iris texture: radial fibres, a dark pupil and a lighter collarette.
 *
 * Generated rather than loaded so the scenes need no binary fixture, and so the
 * texture can never be the reason a baseline moves. The strong angular variation
 * matters: a flat iris colour would make the parallax offset invisible, which is
 * exactly what `eye-angled` is supposed to detect.
 */
function irisTexture(size = 128): Texture2D {
  const data = new Uint8Array(size * size * 4);
  const c = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const dx = (x - c) / c;
      const dy = (y - c) / c;
      const r = Math.min(1, Math.sqrt(dx * dx + dy * dy));
      const angle = Math.atan2(dy, dx);
      // 24 fibres, plus a coarser second harmonic so the pattern is not uniform.
      const fibre = 0.5 + 0.5 * Math.sin(angle * 24) * 0.6 + 0.2 * Math.sin(angle * 7);
      const collarette = Math.exp(-((r - 0.45) * (r - 0.45)) / 0.02);
      const pupil = r < 0.32 ? 0 : 1;
      const base = pupil * (0.35 + 0.45 * fibre * r + 0.3 * collarette);
      data[i] = Math.round(255 * Math.min(1, base * 0.42));
      data[i + 1] = Math.round(255 * Math.min(1, base * 0.62));
      data[i + 2] = Math.round(255 * Math.min(1, base * 0.5));
      data[i + 3] = 255;
    }
  }
  const tex = getDevice().createTexture2D('rgba8unorm', size, size);
  if (!tex) {
    throw new Error('irisTexture: texture creation failed');
  }
  tex.update(data, 0, 0, size, size);
  return tex;
}

function eyeball(scene: Scene, configure?: (m: EyeMaterial) => void) {
  const material = new EyeMaterial();
  material.irisTexture = irisTexture();
  material.vertexTangent = true;
  material.irisRadius = 0.16;
  // irisDepth deliberately left at the engine default. It happens to be the
  // value these scenes want, so inheriting it costs nothing visually and keeps
  // them sensitive to that default drifting - setting it explicitly is exactly
  // what made post-tonemap-bloom blind to its own threshold.
  material.irisColor = new Vector4(1.1, 1, 0.95, 1);
  material.limbalRingWidth = 0.2;
  material.limbalRingStrength = 0.8;
  material.scleraColor = new Vector4(0.92, 0.9, 0.88, 1);
  configure?.(material);
  const mesh = new Mesh(scene, createEyeballPrimitive(), material);
  return { mesh, material };
}

/**
 * Straight-on view. Pins the resting appearance: iris colour, limbal ring,
 * sclera tint and the corneal highlight.
 *
 * This scene does register a parallax regression, contrary to what seems
 * obvious - only the exact centre of a domed eye is viewed along its own
 * normal, so the iris periphery still refracts even head-on. It is a weaker
 * signal than `eye-angled` though, and it was assumed rather than measured
 * until tools/sensitivity.mjs said otherwise.
 */
export const eyeFrontal: VisualScene = {
  name: 'eye-frontal',
  description: 'Eyeball viewed head-on. Pins iris colour, limbal ring, sclera tint and corneal highlight.',
  setup({ scene, camera }) {
    bareScene(scene);
    scene.env.light.type = 'constant';
    scene.env.light.ambientColor = new Vector4(0.16, 0.17, 0.2, 1);
    keyLight(scene);
    eyeball(scene);
    placeCamera(camera, new Vector3(0, 0, 3.2));
  }
};

/**
 * The scene that actually tests refraction.
 *
 * Viewed well off-axis, the refracted ray has to travel a long way across the
 * iris plane, so the iris visibly shifts against the limbal ring and the pupil
 * stops being concentric with the cornea. All three eye scenes notice
 * `irisDepth` going to zero, but this is where the displacement is largest and
 * where a subtly wrong refraction - as opposed to none at all - shows up.
 */
export const eyeAngled: VisualScene = {
  name: 'eye-angled',
  description:
    'Eyeball viewed ~35 degrees off-axis, where corneal refraction displaces the iris against the limbus. The parallax regression detector.',
  setup({ scene, camera }) {
    bareScene(scene);
    scene.env.light.type = 'constant';
    scene.env.light.ambientColor = new Vector4(0.16, 0.17, 0.2, 1);
    keyLight(scene);
    eyeball(scene);
    placeCamera(camera, new Vector3(1.85, 0.7, 2.5));
  }
};

/**
 * Fully dilated pupil, pinning the radial UV remap. Framed head-on so the only
 * difference from `eye-frontal` is the dilation itself.
 */
export const eyePupilDilated: VisualScene = {
  name: 'eye-pupil-dilated',
  description: 'Fully dilated pupil. Pins the radial iris remap independently of refraction.',
  setup({ scene, camera }) {
    bareScene(scene);
    scene.env.light.type = 'constant';
    scene.env.light.ambientColor = new Vector4(0.16, 0.17, 0.2, 1);
    keyLight(scene);
    eyeball(scene, (m) => {
      m.pupilDilation = 1;
    });
    placeCamera(camera, new Vector3(0, 0, 3.2));
  }
};
