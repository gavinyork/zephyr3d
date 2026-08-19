import {
  BoundingBox,
  HairMaterial,
  HairStrandData,
  HairStrandMaterial,
  Mesh,
  Primitive,
  SharedModel,
  type HairStrandSource
} from '@zephyr3d/scene';
import { AlembicHairImporter, type AlembicHairImportOptions } from '@zephyr3d/loaders';
import { Vector3, Vector4 } from '@zephyr3d/base';
import type { PrimitiveType, VertexAttribFormat } from '@zephyr3d/device';
import type { SceneContext, VisualScene } from '../types';
import { bareScene, keyLight, placeCamera } from './common';
import { buildAlembicArchive, combCurves, fanCurves, helixCurves } from './alembic-fixture';
import type { SyntheticCurveSet } from './alembic-fixture';

/**
 * Hair strand import scenes.
 *
 * These pin the Alembic curve path end to end: fixture bytes go through the real
 * {@link AlembicHairImporter}, including the Ogawa container reader and the
 * structural property identification, and the ribbon geometry it produces is
 * rendered and compared. A numeric unit test can show that the arrays are
 * self-consistent; only a picture shows that the strands actually run the way the
 * control points said they should.
 *
 * The three fixtures fail in different ways on purpose - see the doc comments in
 * `alembic-fixture.ts` for what each one is sensitive to.
 */

/**
 * Runs the importer over synthetic archive bytes and adds the resulting ribbons
 * to the scene.
 *
 * @remarks
 * The importer's public entry point is `import()`, which fills a
 * {@link SharedModel} with `AssetPrimitiveInfo`. Turning those into meshes
 * directly, rather than via `SharedModel.createSceneNode`, keeps the scene clear
 * of the resource manager and the VFS: neither is what these scenes are testing,
 * and both would need stubbing in the harness page.
 */
async function addImportedStrands(
  ctx: SceneContext,
  sets: SyntheticCurveSet[],
  options: AlembicHairImportOptions,
  material: HairMaterial
) {
  const bytes = buildAlembicArchive(sets);
  const model = new SharedModel();
  await new AlembicHairImporter(options).import(new Blob([bytes]), model, '');
  if (model.primitives.length !== sets.length) {
    throw new Error(
      `hair fixture import produced ${model.primitives.length} primitives, expected ${sets.length}`
    );
  }
  for (const info of model.primitives) {
    const primitive = new Primitive();
    // Each attribute becomes its own vertex buffer; the semantic is carried by
    // the format, so the record key is not needed here.
    for (const attrib of Object.values(info.vertices)) {
      primitive.createAndSetVertexBuffer(attrib.format as VertexAttribFormat, attrib.data);
    }
    if (info.indices) {
      primitive.createAndSetIndexBuffer(info.indices);
    }
    primitive.indexCount = info.indexCount;
    primitive.primitiveType = info.type as PrimitiveType;
    primitive.setBoundingVolume(new BoundingBox(info.boxMin, info.boxMax));
    new Mesh(ctx.scene, primitive, material);
  }
}

/**
 * Adds strands rendered by the GPU expansion path.
 *
 * @remarks
 * Unlike the CPU path there is no per-vertex data at all: the primitive carries a
 * one-element placeholder vertex buffer purely so a vertex layout exists, and the
 * draw range comes from the material's own vertex count. Everything the vertex
 * shader needs is in the two storage buffers.
 */
function addGPUStrands(ctx: SceneContext, source: HairStrandSource, material: HairStrandMaterial) {
  const strands = new HairStrandData(source);
  material.strands = strands;
  const primitive = new Primitive();
  // A vertex layout is required to issue a draw, but no attribute is read; one
  // float is the smallest buffer that establishes one.
  primitive.createAndSetVertexBuffer('position_f32x3' as VertexAttribFormat, new Float32Array(3));
  primitive.indexCount = material.vertexCount;
  primitive.primitiveType = 'triangle-list';
  // Derived on the CPU from the same control points the shader reads, since the
  // expansion happens too late for the engine to compute bounds itself.
  primitive.setBoundingVolume(new BoundingBox(...strandBounds(source)));
  new Mesh(ctx.scene, primitive, material);
  return strands;
}

/** World-space bounds of a strand source, padded by the widest strand. */
function strandBounds(source: HairStrandSource): [Vector3, Vector3] {
  const scale = source.scale ?? 1;
  const p = source.positions;
  const min = new Vector3(Infinity, Infinity, Infinity);
  const max = new Vector3(-Infinity, -Infinity, -Infinity);
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i] * scale;
    const y = p[i + 1] * scale;
    const z = p[i + 2] * scale;
    if (x < min.x) {
      min.x = x;
    }
    if (y < min.y) {
      min.y = y;
    }
    if (z < min.z) {
      min.z = z;
    }
    if (x > max.x) {
      max.x = x;
    }
    if (y > max.y) {
      max.y = y;
    }
    if (z > max.z) {
      max.z = z;
    }
  }
  let pad = source.defaultWidth ?? 0.0001;
  if (source.widths) {
    for (let i = 0; i < source.widths.length; i++) {
      if (source.widths[i] > pad) {
        pad = source.widths[i];
      }
    }
  }
  pad *= scale;
  min.setXYZ(min.x - pad, min.y - pad, min.z - pad);
  max.setXYZ(max.x + pad, max.y + pad, max.z + pad);
  return [min, max];
}

/** Turns a fixture curve set into the source format the GPU path consumes. */
function toStrandSource(set: SyntheticCurveSet): HairStrandSource {
  return {
    positions: set.positions,
    pointCounts: set.numVertices,
    widths: set.width,
    widthPerStrand: false,
    uv: set.uv
  };
}

/** Dark hair, with both specular lobes active so strand tangents are legible. */
function strandMaterial() {
  const material = new HairMaterial();
  material.albedoColor = new Vector4(0.24, 0.14, 0.1, 1);
  material.vertexTangent = true;
  material.specular1Color = new Vector3(0.45, 0.45, 0.45);
  material.specular2Color = new Vector3(0.55, 0.4, 0.3);
  return material;
}

/**
 * Helix strands: the frame-correctness scene.
 *
 * Camera is off-axis so the spiral reads as a spiral rather than as a ring, and
 * so the anisotropic highlight sweeps along the strands instead of sitting still.
 */
export const hairStrandsHelix: VisualScene = {
  name: 'hair-strands-helix',
  description: 'Alembic helix curves through the real importer: pins strand frames, winding and width taper.',
  async setup(ctx) {
    bareScene(ctx.scene);
    keyLight(ctx.scene);
    await addImportedStrands(ctx, [helixCurves()], { widthScale: 1, minWidth: 0.004 }, strandMaterial());
    placeCamera(ctx.camera, new Vector3(1.9, 1.1, 2.5));
  }
};

/**
 * Planar fan: the ribbon-orientation scene.
 *
 * Viewed face-on, correctly oriented ribbons all have similar apparent width. A
 * side vector that drifts toward the view direction shows up here as strands
 * thinning to slivers, which the helix scene cannot reveal.
 */
export const hairStrandsFan: VisualScene = {
  name: 'hair-strands-fan',
  description: 'Alembic planar fan: pins ribbon side vectors, which collapse to slivers if misaligned.',
  async setup(ctx) {
    bareScene(ctx.scene);
    keyLight(ctx.scene);
    await addImportedStrands(ctx, [fanCurves()], { widthScale: 1, minWidth: 0.004 }, strandMaterial());
    placeCamera(ctx.camera, new Vector3(0, 0.1, 3.4));
  }
};

/**
 * Straight bars with graded width, plus a second curve object in the same
 * archive.
 *
 * Two things are pinned here that the other scenes do not cover: the width path
 * in isolation, because straight strands make the silhouette a direct readout of
 * the width values, and multi-object archives, because an archive with two
 * objects is where the name table and the per-object property scan can go wrong.
 */
/**
 * The same helix through the GPU expansion path.
 *
 * @remarks
 * Deliberately framed identically to `hair-strands-helix`, so the two baselines
 * can be compared by eye: the geometry is generated from the same control points
 * and shaded by the same inherited lighting, so they should agree in silhouette
 * and in where the highlight sits. They are not expected to match pixel for
 * pixel, because the CPU path orients ribbons by a world reference axis while
 * this one orients them toward the camera.
 *
 * WebGPU only: the vertex shader reads storage buffers.
 */
export const hairStrandsGpuHelix: VisualScene = {
  name: 'hair-strands-gpu-helix',
  description:
    'GPU strand expansion of the helix fixture: pins vertex-index expansion and camera-facing quads.',
  supports: (backend) => backend === 'webgpu',
  setup(ctx) {
    bareScene(ctx.scene);
    keyLight(ctx.scene);
    const material = new HairStrandMaterial();
    material.albedoColor = new Vector4(0.24, 0.14, 0.1, 1);
    material.specular1Color = new Vector3(0.45, 0.45, 0.45);
    material.specular2Color = new Vector3(0.55, 0.4, 0.3);
    material.segmentsPerStrand = 16;
    material.minStrandWidth = 0;
    // The fixture widths are sized for the CPU path, where a ribbon oriented by a
    // world axis is often seen obliquely and so reads narrower than it is. A
    // camera-facing quad always presents its full width, so the same numbers merge
    // the strands into a solid mass; scaling down restores separable strands.
    material.strandWidthScale = 0.25;
    const source = toStrandSource(helixCurves());
    addGPUStrands(ctx, source, material);
    placeCamera(ctx.camera, new Vector3(1.9, 1.1, 2.5));
  }
};

export const hairStrandsWidth: VisualScene = {
  name: 'hair-strands-width',
  description: 'Alembic comb plus a second object: pins width taper, quad winding and multi-object parsing.',
  async setup(ctx) {
    bareScene(ctx.scene);
    keyLight(ctx.scene);
    const second = fanCurves(7, 10);
    second.name = 'SecondObject';
    // Push the fan behind the bars so both objects are visible at once.
    for (let i = 2; i < second.positions.length; i += 3) {
      second.positions[i] -= 0.9;
    }
    await addImportedStrands(
      ctx,
      [combCurves(), second],
      { widthScale: 1, minWidth: 0.002 },
      strandMaterial()
    );
    placeCamera(ctx.camera, new Vector3(0.35, 0.15, 3.1));
  }
};
