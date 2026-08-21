import {
  BoundingBox,
  BoxShape,
  HairMaterial,
  HairStrandData,
  HairStrandMaterial,
  Mesh,
  Primitive,
  SharedModel,
  type HairStrandSource
} from '@zephyr3d/scene';
import {
  AlembicHairImporter,
  HairFileImporter,
  type AlembicHairImportOptions,
  type HairFileImportOptions
} from '@zephyr3d/loaders';
import { Vector3, Vector4 } from '@zephyr3d/base';
import type { PrimitiveType, VertexAttribFormat } from '@zephyr3d/device';
import type { ShadowMode } from '@zephyr3d/scene';
import type { SceneContext, VisualScene } from '../types';
import { bareScene, keyLight, lambert, placeCamera, shadowFloor, shadowKeyLight } from './common';
import { buildAlembicArchive, combCurves, fanCurves, helixCurves } from './alembic-fixture';
import type { SyntheticCurveSet } from './alembic-fixture';
import { buildHairFile } from './hair-fixture';

/**
 * Hair strand import scenes.
 *
 * These pin the curve import paths end to end: fixture bytes go through the real
 * importers - {@link AlembicHairImporter} with its Ogawa container reader and
 * structural property identification, {@link HairFileImporter} with its
 * positional cyHairFile layout - and the ribbon geometry they produce is
 * rendered and compared. A numeric unit test can show that the arrays are
 * self-consistent; only a picture shows that the strands actually run the way the
 * control points said they should.
 *
 * The fixtures fail in different ways on purpose - see the doc comments in
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
  addModelPrimitives(ctx, model, material, sets.length);
}

/**
 * Runs the HAIR importer over synthetic file bytes and adds the result.
 *
 * @remarks
 * A HAIR file is always a single strand set, so this takes one curve set rather
 * than a list.
 */
async function addImportedHairFile(
  ctx: SceneContext,
  set: SyntheticCurveSet,
  options: HairFileImportOptions,
  material: HairMaterial
) {
  const bytes = buildHairFile(set);
  const model = new SharedModel();
  await new HairFileImporter(options).import(new Blob([bytes]), model, '');
  addModelPrimitives(ctx, model, material, 1);
}

/**
 * Turns every primitive an importer produced into a mesh.
 * @internal
 */
function addModelPrimitives(ctx: SceneContext, model: SharedModel, material: HairMaterial, expected: number) {
  if (model.primitives.length !== expected) {
    throw new Error(
      `hair fixture import produced ${model.primitives.length} primitives, expected ${expected}`
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
  // The ribbon tessellator writes the curve direction into the tangent attribute,
  // not the binormal. The material's default suits a hair card, whose atlas runs
  // strands along V - left at it, the anisotropic lobes measure the highlight
  // against the ribbon's width instead of its length and the scenes pin a sheen
  // rather than the band they are here to check.
  material.strandDirection = 'tangent';
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
 * The same helix, delivered as a HAIR file instead of an Alembic archive.
 *
 * @remarks
 * Framed identically to `hair-strands-helix` and fed from the same generator, so
 * the two baselines should be indistinguishable: both formats carry the same
 * control points, the same per-point widths and the same UVs, and both go
 * through the same ribbon tessellator once their container has been read. A
 * difference between the two pictures is a container-reading bug, and it is
 * legible as one - which no single HAIR baseline could tell you.
 *
 * HAIR files record no unit, so no scale is applied here; the fixture is written
 * in the same coordinates the Alembic one is.
 */
export const hairFileHelix: VisualScene = {
  name: 'hair-file-helix',
  description: 'HAIR helix through the real importer: pins the cyHairFile reader against the Alembic one.',
  async setup(ctx) {
    bareScene(ctx.scene);
    keyLight(ctx.scene);
    await addImportedHairFile(ctx, helixCurves(), { widthScale: 1, minWidth: 0.004 }, strandMaterial());
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

/**
 * Dense strands over a floor, once per shadow mode.
 *
 * @remarks
 * Deep opacity maps only differ from a depth-based filter where light passes
 * *through* the caster, so the scene is built to make that the dominant feature:
 * a thick helix lit from above-left, with a floor to catch what gets through and
 * enough strands that the interior is genuinely occluded rather than merely
 * edge-lit.
 *
 * Two things separate the `dom` baseline from the `pcf` one, and both are the
 * point of the technique. The floor under the groom picks up a graded shadow
 * instead of a solid blocked region, because transmittance falls off with how
 * much hair the light actually crossed. And the strands themselves shade from
 * lit at the outside to dark in the middle, where a binary test makes every
 * strand behind the first one equally black.
 *
 * WebGPU only, following the GPU strand path and `dom` itself.
 */
function hairShadowScene(mode: ShadowMode, note: string, scatter?: 'on' | 'off'): VisualScene {
  return {
    name: scatter ? `hair-scatter-${scatter}` : `hair-shadow-${mode}`,
    description: note,
    supports: (backend) => backend === 'webgpu',
    setup(ctx) {
      bareScene(ctx.scene);
      const light = shadowKeyLight(ctx.scene, mode);
      // The preset fits a 2048 map to a 120-unit shadow distance, which over a
      // groom this size leaves the layers far too coarse to resolve anything.
      light.shadow.shadowDistance = 12;
      if (mode === 'dom') {
        // The helix is about 1.1 units across, so the layers span roughly the
        // thickness of hair the light actually has to cross. Density is left at
        // the physically exact 1 so the baseline pins the technique rather than a
        // taste setting layered on top of it.
        light.shadow.domLayerDistance = 1.1;
      }
      const material = new HairStrandMaterial();
      material.albedoColor = new Vector4(0.3, 0.19, 0.13, 1);
      material.specular1Color = new Vector3(0.4, 0.4, 0.4);
      material.specular2Color = new Vector3(0.5, 0.36, 0.27);
      material.segmentsPerStrand = 16;
      material.minStrandWidth = 0;
      material.strandWidthScale = 0.4;
      // Puts real fractional coverage into the shadow pass. Without a cutoff the
      // material reports no fragment colour to a caster, every strand is recorded
      // as fully opaque, and the scene stops exercising the partial absorption
      // that is the entire point of the technique.
      material.alphaCutoff = 0.01;
      material.minPixelWidth = 1.3;
      if (scatter) {
        // Pale hair for both halves of the pair, because multiple scattering is
        // what separates blonde from black: the term is modulated by the hair's
        // own colour, so on the dark brown the other scenes use it would be
        // present and nearly invisible. Only the intensity differs between the
        // two, which is what makes their diff the term itself.
        material.albedoColor = new Vector4(0.62, 0.5, 0.36, 1);
        material.scatterIntensity = scatter === 'on' ? 1 : 0;
      }
      // Many more strands than the expansion scene uses: a sparse groom has no
      // interior to shadow, and this scene is about what happens inside one.
      addGPUStrands(ctx, toStrandSource(helixCurves(96, 24)), material);
      shadowFloor(ctx.scene);
      // A solid caster beside the hair. Deep opacity maps record absorption
      // rather than occlusion, and an implementation that stores raw coverage
      // cannot push a single opaque surface past exp(-1) - a 37% grey. This box
      // is here so that failure is a baseline diff rather than a subtlety nobody
      // looks for; its shadow belongs as black as the one PCF casts.
      const box = new Mesh(
        ctx.scene,
        new BoxShape({ sizeX: 0.4, sizeY: 1.1, sizeZ: 0.4 }),
        lambert(new Vector4(0.75, 0.72, 0.66, 1))
      );
      // Front-left, and tall. The key light throws shadows towards +x and -z, so
      // a short box anywhere further back drops its shadow behind itself or under
      // the groom's - the two places it cannot be read. Here it falls across clean
      // lit floor to the left of the hair.
      box.position.setXYZ(-1.45, -0.3, 0.95);
      placeCamera(ctx.camera, new Vector3(2.1, 1.3, 2.8), new Vector3(0, 0.05, 0));
      ctx.camera.far = 40;
    }
  };
}

export const hairShadowDom = hairShadowScene(
  'dom',
  'Deep opacity map over dense strands: pins graded transmittance through hair, both onto the floor and within the groom itself, and the solid box beside it staying fully shadowed.'
);

export const hairShadowPcf = hairShadowScene(
  'pcf',
  'The same casters under a depth-based filter, as the control for hair-shadow-dom. Its solid black groom interior and hard floor shadow are what the deep opacity map replaces; the box should shadow identically under both.'
);

/**
 * Multiple scattering, on and off over an otherwise identical pale groom.
 *
 * @remarks
 * Absorption alone drives the inside of a groom to black, which is what it
 * physically does and not what hair looks like. These two baselines differ only
 * in `scatterIntensity`, so the diff between them is the light that reaches a
 * point after bouncing off neighbouring fibres - brightest exactly where the
 * direct beam is fully blocked, and tinted by the hair, which is why the pair
 * uses a pale colour where the effect is legible at all.
 */
export const hairScatterOff = hairShadowScene(
  'dom',
  'Pale groom with multiple scattering disabled: the control for hair-scatter-on, showing what absorption alone leaves in the shadowed interior.',
  'off'
);

export const hairScatterOn = hairShadowScene(
  'dom',
  'The same pale groom with multiple scattering enabled: pins the global and local scattering terms filling the interior that absorption empties.',
  'on'
);
