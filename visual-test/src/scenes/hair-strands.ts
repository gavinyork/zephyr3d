import {
  BoundingBox,
  BoxShape,
  DirectionalLight,
  HairMaterial,
  HairStrandData,
  HairStrandMaterial,
  HairNode,
  SphereShape,
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
import { Quaternion, Vector3, Vector4 } from '@zephyr3d/base';
import { createSphereCollider, getDevice, TAA_DEBUG_MOTION_VECTOR } from '@zephyr3d/scene';
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

/**
 * The same strands drawn three times through {@link HairNode} at different
 * transforms.
 *
 * @remarks
 * Strand control points live in the node's local space and reach world space
 * through its world matrix, which is what lets a groom hang off a head bone.
 * Three instances of one strand set pin that the transform is applied and applied
 * correctly: the left copy is translated, the middle rotated, the right scaled
 * down. A material that ignored the matrix would stack all three on top of each
 * other; one that applied it in the wrong order - expanding the camera-facing
 * quad before transforming rather than after - would shear the scaled copy's
 * ribbons rather than just narrowing them.
 *
 * The scaled copy is the sensitive one: width is a length in the same space as
 * the control points, so it has to scale with them. Left unscaled it would draw
 * at full thickness on a third-size groom, which reads as rope.
 *
 * WebGPU only: the vertex shader reads storage buffers.
 */
export const hairNodeTransform: VisualScene = {
  name: 'hair-node-transform',
  description: 'One strand set drawn by three HairNodes: pins world matrix, rotation and uniform scale.',
  supports: (backend) => backend === 'webgpu',
  setup(ctx) {
    bareScene(ctx.scene);
    keyLight(ctx.scene);
    const source = toStrandSource(helixCurves());
    const place = (position: Vector3, scale: number, rotation?: Quaternion) => {
      const node = new HairNode(ctx.scene);
      node.albedoColor = new Vector4(0.24, 0.14, 0.1, 1);
      node.specular1Color = new Vector3(0.45, 0.45, 0.45);
      node.specular2Color = new Vector3(0.55, 0.4, 0.3);
      node.segmentsPerStrand = 16;
      node.minStrandWidth = 0;
      // Matches hair-strands-gpu-helix: a camera-facing quad always presents its
      // full width, so the fixture widths need scaling down to stay separable.
      node.strandWidthScale = 0.25;
      node.setStrands(source);
      node.position.set(position);
      node.scale.setXYZ(scale, scale, scale);
      if (rotation) {
        node.rotation.set(rotation);
      }
      return node;
    };
    place(new Vector3(-1.1, 0, 0), 1);
    place(new Vector3(0, 0, 0), 1, Quaternion.fromAxisAngle(Vector3.axisPX(), Math.PI * 0.5));
    place(new Vector3(1.0, 0, 0), 0.35);
    placeCamera(ctx.camera, new Vector3(0.2, 1.4, 3.6), new Vector3(0, 0.4, 0));
  }
};

/**
 * Strands falling under gravity onto a sphere.
 *
 * @remarks
 * The one scene that shows the solver actually ran. It is a still of a moving
 * system, which the harness makes reproducible: `device.setFixedFrameTime`
 * replaces the clock with a synthetic 60 Hz one, and the solver's own step is
 * fixed at 1/60, so frame N is the same N steps of simulation every run.
 *
 * The strands start as a vertical curtain and are drawn after 45 frames, by
 * which time gravity has swung them down and the collider has pushed the ones
 * that meet it aside. Three things fail visibly here and nowhere else: a solver
 * that never ran leaves the curtain straight; one that ignores rest lengths lets
 * the strands stretch away or collapse into their roots; one whose contacts are
 * in the wrong space leaves them hanging through the sphere.
 *
 * The first of those is worth its own note, because it is not hypothetical and
 * it is invisible everywhere else: a solver whose WGSL is rejected at pipeline
 * creation fails exactly this way, since the compute pass simply never runs and
 * the strands stay in the pose they were uploaded in. Nothing about the picture
 * says "shader error"; it just looks like hair that was never simulated.
 *
 * WebGPU only: the solver is a compute pass.
 */
export const hairSimulation: VisualScene = {
  name: 'hair-simulation',
  description: 'Strand dynamics after a fixed number of steps: pins the solver, rest lengths and contacts.',
  supports: (backend) => backend === 'webgpu',
  frames: 45,
  setup(ctx) {
    bareScene(ctx.scene);
    keyLight(ctx.scene);
    const node = new HairNode(ctx.scene);
    node.albedoColor = new Vector4(0.24, 0.14, 0.1, 1);
    node.specular1Color = new Vector3(0.45, 0.45, 0.45);
    node.specular2Color = new Vector3(0.55, 0.4, 0.3);
    node.segmentsPerStrand = 12;
    node.minStrandWidth = 0;
    node.strandWidthScale = 0.4;
    node.setStrands(curtainStrands());
    // No velocity damping and no bending resistance, so the strands fall freely
    // and the collider's effect is the only thing shaping them: this scene is
    // about the solver reaching the right place, and a styled groom's shape
    // retention would mask that. The other scenes exercise the defaults.
    node.damping = 0;
    node.localStiffness = 0;
    node.vspCoeff = 0;
    node.gravity = new Vector3(0, -9.8, 0);
    node.simulationEnabled = true;
    // Sits under the middle of the curtain, so the strands that clear it and the
    // strands it deflects appear side by side.
    node.simulation!.colliders = [createSphereCollider(new Vector3(0, 0.15, 0), 0.42)];
    placeCamera(ctx.camera, new Vector3(0, 0.75, 3.1), new Vector3(0, 0.15, 0));
  }
};

/**
 * Strands simulated on a node that moves and turns while the solver runs.
 *
 * @remarks
 * The one scene that pins the motion-response path: the solver works in local
 * space and reproduces node motion through the frame-to-frame relative
 * transform, a path the static {@link hairSimulation} scene never exercises.
 * The node sweeps on X and yaws around Y, and the capture lands mid-swing, so
 * the curtain must show a bounded, trailing bend. Two failures read instantly:
 * a solver that ignores node motion leaves the curtain straight, and a
 * motion-injection with the wrong sign winds node displacement up into strand
 * velocity until the strands stream out to full extension.
 *
 * WebGPU only: the solver is a compute pass.
 */
export const hairSimulationMotion: VisualScene = {
  name: 'hair-simulation-motion',
  description: 'Strands on a moving node: pins the swing produced by the relative transform.',
  supports: (backend) => backend === 'webgpu',
  frames: 90,
  setup(ctx) {
    bareScene(ctx.scene);
    keyLight(ctx.scene);
    const node = new HairNode(ctx.scene);
    node.albedoColor = new Vector4(0.24, 0.14, 0.1, 1);
    node.segmentsPerStrand = 12;
    node.minStrandWidth = 0;
    node.strandWidthScale = 0.4;
    node.setStrands(curtainStrands());
    node.simulationEnabled = true;
    // Driven from the frame counter, not the clock, so frame N is the same
    // pose every run. Gentle editor-drag speeds: the response should be a
    // clean trailing bend, not a whip.
    let frame = 0;
    ctx.scene.on('update', () => {
      frame++;
      node.position.setXYZ(0.25 * Math.sin(frame * 0.12), 0, 0);
      node.rotation.set(Quaternion.fromAxisAngle(Vector3.axisPY(), 0.3 * Math.sin(frame * 0.07)));
    });
    placeCamera(ctx.camera, new Vector3(0, 0.75, 3.1), new Vector3(0, 0.15, 0));
  }
};

/**
 * Long strands on a node driven with jerky motion under frame-time jitter.
 *
 * @remarks
 * Pins the failure mode that only appears off the steady clock: the solver
 * spreads the node's per-frame motion over its substeps by interpolating the
 * world transform, and before it did, a frame-time hitch lumped several frames
 * of motion into a single substep. Each such lump yanked strand roots by more
 * than a segment length, the constraint corrections fed back as velocity, and
 * jerky dragging wound the strands up until the groom burst into a tangle.
 * The drive here reproduces that regime deterministically: the velocity jumps
 * between values every few frames and the frame interval swings between 5 ms
 * and 50 ms, both indexed off the frame counter. The capture must show a
 * hanging, gently trailing curtain; strands streaming sideways or upward mean
 * the injection is being lumped again.
 *
 * The strands match the groom the blow-up was reported on: ~6 m long, 30
 * control points, a curled lower third.
 *
 * That curl is the second thing this pins. It is authored, not held in place by
 * anything, so it survives 600 frames of shaking only if the local shape
 * constraint is doing its job - a solver with no bending resistance combs it
 * straight, and one that holds the authored *pose* rather than the authored
 * *shape* leaves the whole groom rigid instead of hanging.
 *
 * WebGPU only: the solver is a compute pass.
 */
export const hairSimulationJitter: VisualScene = {
  name: 'hair-simulation-jitter',
  description: 'Jerky motion under frame-time jitter: pins substep-distributed motion injection.',
  supports: (backend) => backend === 'webgpu',
  frames: 600,
  setup(ctx) {
    bareScene(ctx.scene);
    keyLight(ctx.scene);
    const node = new HairNode(ctx.scene);
    node.albedoColor = new Vector4(0.45, 0.12, 0.1, 1);
    node.segmentsPerStrand = 16;
    node.minStrandWidth = 0;
    node.strandWidthScale = 0.5;
    // Long strands matching the reported groom: ~6m hanging with a curled
    // lower third (styled rest pose), 30 control points.
    const strandCount = 40;
    const pointsPerStrand = 30;
    const positions = new Float32Array(strandCount * pointsPerStrand * 3);
    const pointCounts = new Uint32Array(strandCount);
    const widths = new Float32Array(strandCount * pointsPerStrand);
    for (let s = 0; s < strandCount; s++) {
      pointCounts[s] = pointsPerStrand;
      const x = (s / (strandCount - 1) - 0.5) * 4;
      for (let i = 0; i < pointsPerStrand; i++) {
        const p = s * pointsPerStrand + i;
        const t = i / (pointsPerStrand - 1);
        // Inward curl over the lower third, like a combed bob.
        const curl = t > 0.66 ? (t - 0.66) * 3 : 0;
        positions[p * 3] = x;
        positions[p * 3 + 1] = 6 - t * 6 + curl * curl * 0.5;
        positions[p * 3 + 2] = curl * 1.2;
        widths[p] = 0.03;
      }
    }
    node.setStrands({ positions, pointCounts, widths, widthPerStrand: false });
    node.simulationEnabled = true;
    // Hand-tremor drive plus frame-time jitter: velocity JUMPS between values
    // and the frame interval swings between 5ms and 50ms, approximating an
    // editor under jerky input. Both patterns are frame-indexed, so the run
    // stays deterministic.
    let frame = 0;
    let x = 0;
    const speeds = [5, -3, 0, 4, -5, 2, -4, 0, 3];
    const frameTimes = [16.7, 8, 33, 16.7, 5, 50, 25, 16.7, 11, 40];
    ctx.scene.on('update', () => {
      frame++;
      const dtMs = frameTimes[frame % frameTimes.length];
      getDevice().setFixedFrameTime(dtMs);
      x += (speeds[Math.floor(frame / 7) % speeds.length] * dtMs) / 1000;
      node.position.setXYZ(x, 0, 0);
    });
    placeCamera(ctx.camera, new Vector3(0, 3.5, 14), new Vector3(0, 3, 0));
  }
};

/**
 * A flat curtain of vertical strands.
 *
 * @remarks
 * Deliberately not the helix the other scenes use: a curtain starts with every
 * strand identical and straight, so any bend in the captured frame is the
 * solver's doing and nothing else's.
 */
function curtainStrands(): HairStrandSource {
  const strandCount = 28;
  const pointsPerStrand = 10;
  const positions = new Float32Array(strandCount * pointsPerStrand * 3);
  const pointCounts = new Uint32Array(strandCount);
  const widths = new Float32Array(strandCount * pointsPerStrand);
  for (let s = 0; s < strandCount; s++) {
    pointCounts[s] = pointsPerStrand;
    const x = (s / (strandCount - 1) - 0.5) * 1.5;
    for (let i = 0; i < pointsPerStrand; i++) {
      const p = s * pointsPerStrand + i;
      positions[p * 3] = x;
      // Roots at the top, hanging straight down.
      positions[p * 3 + 1] = 0.95 - (i / (pointsPerStrand - 1)) * 0.9;
      positions[p * 3 + 2] = 0;
      widths[p] = 0.02;
    }
  }
  return { positions, pointCounts, widths, widthPerStrand: false };
}

/**
 * A groom with an opaque occluder buried in it, lit from behind.
 *
 * @remarks
 * Backlighting is where a groom is least forgiving: the Marschner transmitted
 * lobe is narrow and normalised, so a light opposite the camera fires every
 * strand at once and the whole head clips to white. That is the model behaving
 * correctly - see {@link hairMarschnerStrands} - but it also means a shadow that
 * fails to reach the strands is invisible against everything else being blown
 * out, which is why it needs a scene of its own.
 *
 * The sphere stands in for a head inside the hair. What this pins is that the
 * strands it occludes stay dark: shadow reaching strand geometry is the only
 * thing separating a lit rim from a uniform white blob.
 *
 * WebGPU only: the vertex shader reads storage buffers.
 */
export const hairShadowReceive: VisualScene = {
  name: 'hair-shadow-receive',
  description: 'Backlit groom around an occluder: pins that strand geometry receives shadow.',
  supports: (backend) => backend === 'webgpu',
  setup(ctx) {
    bareScene(ctx.scene);
    // Behind the groom and only slightly above, so the occluder throws its
    // shadow forward through the hair rather than over the top of it.
    const back = shadowKeyLight(ctx.scene, 'pcf');
    back.lookAt(new Vector3(0.4, 1.6, -4), new Vector3(0, 0.4, 0), Vector3.axisPY());
    back.color = new Vector4(1, 0.96, 0.9, 1);
    // The head. Opaque, shadow casting, and large enough to occlude a good part
    // of the groom from the light behind it.
    const occluder = new Mesh(
      ctx.scene,
      new SphereShape({ radius: 0.42 }),
      lambert(new Vector4(0.25, 0.25, 0.27, 1))
    );
    occluder.position.setXYZ(0, 0.55, 0);
    occluder.castShadow = true;

    const node = new HairNode(ctx.scene);
    node.albedoColor = new Vector4(0.82, 0.68, 0.45, 1);
    node.shadingModel = 'marschner';
    node.segmentsPerStrand = 12;
    node.minStrandWidth = 0;
    node.strandWidthScale = 0.3;
    node.setStrands(toStrandSource(helixCurves(28, 20)));
    placeCamera(ctx.camera, new Vector3(0.1, 1.2, 3.2), new Vector3(0, 0.45, 0));
  }
};

/**
 * A backlit groom under a deep opacity map whose layer span is a fraction of the
 * groom's depth.
 *
 * @remarks
 * The regression this pins: a caster deeper than `z0 + domLayerDistance` used to
 * be written to no layer at all, so the map held only the absorption of the thin
 * front slice nearest the light. Every receiver deeper than the span read that
 * slice and nothing else, and wherever the slice happened to be sparse the
 * middle of a dense backlit groom came out fully lit, in blotches. The last
 * layer now extends to the end of the caster volume, so the camera side of this
 * groom must render dark under the light behind it.
 *
 * The span is set to a tenth of the groom's depth on purpose - the failure only
 * exists when casters overflow it, which is why the tuned spans of the other DOM
 * scenes never caught it.
 *
 * WebGPU only: DOM and the strand path both require it.
 */
export const hairShadowDomDeep: VisualScene = {
  name: 'hair-shadow-dom-deep',
  description:
    'Backlit groom overflowing the DOM layer span: pins deep casters clamping into the last layer.',
  supports: (backend) => backend === 'webgpu',
  setup(ctx) {
    bareScene(ctx.scene);
    const back = shadowKeyLight(ctx.scene, 'dom');
    back.lookAt(new Vector3(0.3, 1.2, -4), new Vector3(0, 0.4, 0), Vector3.axisPY());
    back.shadow.shadowDistance = 12;
    // The helix is about a unit deep along this light; a tenth of that leaves
    // ninety percent of the casters beyond the span.
    back.shadow.domLayerDistance = 0.1;

    const node = new HairNode(ctx.scene);
    node.albedoColor = new Vector4(0.85, 0.75, 0.55, 1);
    node.shadingModel = 'marschner';
    node.segmentsPerStrand = 12;
    node.minStrandWidth = 0;
    node.strandWidthScale = 0.35;
    node.setStrands(toStrandSource(helixCurves(32, 20)));
    placeCamera(ctx.camera, new Vector3(0.1, 1.1, 3.0), new Vector3(0, 0.45, 0));
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

/**
 * A dense groom under the Marschner fibre model, lit from behind.
 *
 * @remarks
 * Framed and lit to make the three fibre paths separable on real strand
 * geometry, which is where the model is meant to be used and where the double
 * lobe's shortcomings actually show.
 *
 * The key sits low behind the groom, opposite the camera. That is deliberate and
 * it is the whole scene: it is the configuration the double lobe cannot render
 * at all, because `specFade` in that path exists precisely to suppress specular
 * where `N·L` is negative. Under Marschner the same geometry produces a bright
 * rim - light that entered the far side of each fibre and came out the near one -
 * and the strands nearest the silhouette glow while the interior stays dark.
 *
 * Mid-blonde, because both transmitted paths are tinted by absorbing the hair's
 * own colour over the distance they cross. On the near-black hair the other
 * strand scenes use, they are correct and invisible; the effect is the reason
 * pale hair reads as translucent and dark hair does not.
 *
 * Multiple scattering is off, so the light in the shadowed interior is only what
 * these three paths deliver and nothing is standing in for them.
 *
 * WebGPU only, following the strand expansion path.
 */
export const hairMarschnerStrands: VisualScene = {
  name: 'hair-marschner-strands',
  description:
    'Back-lit blonde groom under the Marschner model: pins the transmitted rim the double lobe cannot produce, plus the tinted secondary highlight.',
  supports: (backend) => backend === 'webgpu',
  setup(ctx) {
    bareScene(ctx.scene);
    // The house key, in its usual place: front-left and above. This is what
    // drives the two reflected paths and casts the deep opacity shadow.
    const key = shadowKeyLight(ctx.scene, 'dom');
    key.shadow.shadowDistance = 12;
    key.shadow.domLayerDistance = 1.1;
    // A second light behind and steeply above, for the transmitted path.
    //
    // Steeply, and that is the whole trick. Light coming from directly opposite
    // the camera makes sin(theta) for the light the negative of the one for the
    // view on *every* strand at once, which is exactly the condition the
    // transmitted lobe peaks at - so the entire groom fires at its maximum
    // together and, with no tone mapping in this harness, clips to flat white.
    // That is not a bug in the model: the lobe is narrow, and its integral over
    // all directions is one. It is what backlit hair genuinely does, and it is
    // why photographs of it are usually exposed for the rim. Raising the light
    // out of the camera's plane leaves only the strands whose direction happens
    // to satisfy the condition lit, which is the rim this scene is here to pin.
    const back = new DirectionalLight(ctx.scene);
    back.lookAt(new Vector3(-1.1, 4.2, -3.4), new Vector3(0, 0.4, 0), Vector3.axisPY());
    back.color = new Vector4(1, 0.95, 0.88, 1);
    // Dimmer than the key. Two lights at full strength drive the floor past
    // white, and the graded shadow across it is half of what this scene shows.
    back.intensity = 0.6;
    const material = new HairStrandMaterial();
    material.shadingModel = 'marschner';
    material.albedoColor = new Vector4(0.62, 0.5, 0.36, 1);
    material.segmentsPerStrand = 16;
    material.minStrandWidth = 0;
    material.strandWidthScale = 0.4;
    material.alphaCutoff = 0.01;
    material.minPixelWidth = 1.3;
    addGPUStrands(ctx, toStrandSource(helixCurves(96, 24)), material);
    shadowFloor(ctx.scene);
    placeCamera(ctx.camera, new Vector3(2.1, 1.3, 2.8), new Vector3(0, 0.05, 0));
    ctx.camera.far = 40;
  }
};

/**
 * Motion vectors of a groom swinging under a still camera and a still node.
 *
 * @remarks
 * The one configuration that isolates the strands' own motion. Node motion
 * reaches a motion vector through the previous world matrix and camera motion
 * through the previous view-projection, so holding both still leaves the solver
 * as the only thing that can move a pixel - and before the material sampled a
 * previous point buffer, that left the motion vector identically zero while the
 * hair visibly swung. TAA then reprojected each strand pixel onto itself and
 * blended a history belonging to whatever was behind it, which on thin dithered
 * geometry the neighbourhood clamp cannot catch: a hair pixel's 3x3 colour box
 * spans strand and background both, so it clips nothing.
 *
 * Rendered through the TAA motion vector debug view, so the capture is the
 * vector field itself rather than its consequences. A regression here reads as
 * the groom going black - vectors collapsing to zero - which is exactly the
 * failure, and is impossible to mistake for a shading change.
 *
 * The groom is released from a pose rotated away from where it hangs, so it is
 * mid-swing at the capture with nothing else in the frame moving.
 *
 * WebGPU only: the solver is a compute pass.
 */
export const hairSimulationMotionVectors: VisualScene = {
  name: 'hair-simulation-motion-vectors',
  description: 'Motion vectors of a swinging groom under a still camera: pins strand-driven velocity.',
  supports: (backend) => backend === 'webgpu',
  frames: 24,
  setup(ctx) {
    bareScene(ctx.scene);
    keyLight(ctx.scene);
    const node = new HairNode(ctx.scene);
    node.segmentsPerStrand = 12;
    node.minStrandWidth = 0;
    node.strandWidthScale = 0.4;
    node.setStrands(curtainStrands());
    // No pose pull and little damping, so the swing is still large at frame 24.
    node.globalStiffness = 0;
    node.damping = 0.02;
    node.localStiffness = 0.9;
    // Carried entirely by the solver rather than by the node: shock propagation
    // would otherwise hide most of the lag this scene exists to measure.
    node.vspCoeff = 0;
    node.gravity = new Vector3(0, -9.8, 0);
    node.simulationEnabled = true;
    // One shove on the first frame, then the node is still for the rest of the
    // run. Everything the capture shows after that is the strands alone.
    let frame = 0;
    ctx.scene.on('update', () => {
      frame++;
      node.rotation.set(Quaternion.fromAxisAngle(Vector3.axisPZ(), frame < 2 ? 0.9 : 0));
    });
    ctx.camera.TAA = true;
    ctx.camera.TAADebug = TAA_DEBUG_MOTION_VECTOR;
    // A debug view emits diagnostic data, not radiance: TAA_DEBUG_MOTION_VECTOR writes
    // abs(velocity * 20), whose z component runs to six figures. The resolve now leads the
    // chain instead of ending it, so tone mapping would get the readout -- and ACES mixes
    // channels through its input matrix before clamping to [0, 1], turning the saturated blue
    // of a correct capture white and making every strand look alike whatever its velocity.
    ctx.camera.toneMap = false;
    placeCamera(ctx.camera, new Vector3(0, 0.75, 3.1), new Vector3(0, 0.15, 0));
  }
};

/**
 * Motion vectors of a groom that is not moving at all.
 *
 * @remarks
 * The other half of {@link hairSimulationMotionVectors}, and the one that
 * catches the failures that scene cannot. Node, camera, gravity and drive are
 * all off, so every control point holds its authored position for the whole run
 * and the strands must report exactly no motion. A moving box shares the frame
 * to prove the pass is alive and writing - without it a capture that is black
 * because the velocity buffer never got written would look like a pass.
 *
 * A previous-frame position that is merely *plausible* passes the swinging
 * scene: any structured field over the strands looks like motion there. Only a
 * scene where the right answer is zero can tell a correct previous position from
 * a wrong one, which is how a stride mismatch between the three-float snapshot
 * and a four-float read went unnoticed - it produced confident, entirely
 * fictional vectors that the swinging capture happily accepted.
 *
 * WebGPU only: the solver is a compute pass.
 */
export const hairSimulationMotionRest: VisualScene = {
  name: 'hair-simulation-motion-rest',
  description: 'Motion vectors of a still groom beside a moving box: strands must report zero.',
  supports: (backend) => backend === 'webgpu',
  frames: 12,
  setup(ctx) {
    bareScene(ctx.scene);
    keyLight(ctx.scene);
    const node = new HairNode(ctx.scene);
    node.segmentsPerStrand = 12;
    node.minStrandWidth = 0;
    node.strandWidthScale = 0.4;
    node.setStrands(curtainStrands());
    // Nothing may disturb the strands: no gravity, and the solver starts them at
    // the pose every constraint is defined against, so each stage is a no-op.
    node.gravity = new Vector3(0, 0, 0);
    node.simulationEnabled = true;
    // The reference. It moves, so its own vectors are large, and any strand
    // colour has to be read against it rather than against an empty frame.
    const box = new Mesh(
      ctx.scene,
      new BoxShape({ sizeX: 0.3, sizeY: 0.3, sizeZ: 0.3 }),
      lambert(new Vector4(0.8, 0.8, 0.8, 1))
    );
    let frame = 0;
    ctx.scene.on('update', () => {
      frame++;
      box.position.setXYZ(-1.4 + frame * 0.05, 0.5, 0);
    });
    ctx.camera.TAA = true;
    ctx.camera.TAADebug = TAA_DEBUG_MOTION_VECTOR;
    // A debug view emits diagnostic data, not radiance: TAA_DEBUG_MOTION_VECTOR writes
    // abs(velocity * 20), whose z component runs to six figures. The resolve now leads the
    // chain instead of ending it, so tone mapping would get the readout -- and ACES mixes
    // channels through its input matrix before clamping to [0, 1], turning the saturated blue
    // of a correct capture white and making every strand look alike whatever its velocity.
    ctx.camera.toneMap = false;
    placeCamera(ctx.camera, new Vector3(0, 0.75, 3.1), new Vector3(0, 0.15, 0));
  }
};

/**
 * Motion vectors of a blended groom, which the prepass does not see.
 *
 * @remarks
 * The alpha-dithered path is opaque, so it reaches the depth prepass and writes
 * velocity like anything else. Alpha blending does not: the transparent queue
 * skips that pass entirely, so a blended groom used to carry the velocity of
 * whatever was behind it - zero, against a still background - and TAA smeared it
 * across the swing. Covering that is what the motion-vector-only pass over the
 * transparent queue exists for.
 *
 * Same drive and same view as {@link hairSimulationMotionVectors}, so the two
 * captures are meant to be read side by side: blending changes which strands
 * survive into the buffer, not whether the field is there at all. A regression
 * reads as the groom going black while the dithered scene stays lit.
 *
 * WebGPU only: the solver is a compute pass.
 */
export const hairSimulationMotionBlended: VisualScene = {
  name: 'hair-simulation-motion-blended',
  description: 'Motion vectors of an alpha-blended swinging groom: pins the transparent-queue pass.',
  supports: (backend) => backend === 'webgpu',
  frames: 24,
  setup(ctx) {
    bareScene(ctx.scene);
    keyLight(ctx.scene);
    const node = new HairNode(ctx.scene);
    node.segmentsPerStrand = 12;
    node.minStrandWidth = 0;
    node.strandWidthScale = 0.4;
    node.setStrands(curtainStrands());
    // The quality path: blended rather than dithered, which is what puts the
    // groom in the transparent queue and out of the prepass.
    node.blendMode = 'blend';
    node.alphaDither = false;
    node.minPixelWidth = 1.3;
    node.globalStiffness = 0;
    node.damping = 0.02;
    node.localStiffness = 0.9;
    node.vspCoeff = 0;
    node.gravity = new Vector3(0, -9.8, 0);
    node.simulationEnabled = true;
    let frame = 0;
    ctx.scene.on('update', () => {
      frame++;
      node.rotation.set(Quaternion.fromAxisAngle(Vector3.axisPZ(), frame < 2 ? 0.9 : 0));
    });
    ctx.camera.TAA = true;
    ctx.camera.TAADebug = TAA_DEBUG_MOTION_VECTOR;
    // A debug view emits diagnostic data, not radiance: TAA_DEBUG_MOTION_VECTOR writes
    // abs(velocity * 20), whose z component runs to six figures. The resolve now leads the
    // chain instead of ending it, so tone mapping would get the readout -- and ACES mixes
    // channels through its input matrix before clamping to [0, 1], turning the saturated blue
    // of a correct capture white and making every strand look alike whatever its velocity.
    ctx.camera.toneMap = false;
    placeCamera(ctx.camera, new Vector3(0, 0.75, 3.1), new Vector3(0, 0.15, 0));
  }
};
