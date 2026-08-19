import { BoundingBox, HairMaterial, Mesh, Primitive, SharedModel } from '@zephyr3d/scene';
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
