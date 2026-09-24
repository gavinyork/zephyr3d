import { Quaternion, Vector3, Vector4 } from '@zephyr3d/base';
import { BoxShape, DirectionalLight, Mesh, SSSMaterial, SphereShape } from '@zephyr3d/scene';
import type { PerspectiveCamera, Scene } from '@zephyr3d/scene';
import type { VisualScene } from '../types';
import { bareScene, placeCamera } from './common';

/**
 * Scenes for the light-space thickness pass, whose correct answer is arithmetic.
 *
 * Everything else in this harness is pinned by a baseline, which can only say
 * "unchanged" - the wrong instrument for a pass whose errors are all scale
 * errors: a ten-fold unit mistake survived two rounds of review, and a baseline
 * recorded at any point in that history would have been perfectly green.
 *
 * So these scenes are built to be *computed* rather than compared. The geometry
 * is flat slabs of known thickness lit along their normal, which removes every
 * confound the pass has:
 *
 *  - the blocker is the slab's own back face, so nothing else can be measured;
 *  - the surface is flat, so the depth-reconstructed normal is exact and the
 *    Poisson taps all land on the same plane;
 *  - the slab is large compared to a shadow texel, so light-space lateral
 *    resolution never enters into it.
 *
 * What reaches the screen is `camera.skinSSSDebugOutput = 'thickness'`, which
 * renders `1 - encoded` (bright = thick) and calls out "no light wrote this
 * channel" as pure blue so it cannot be mistaken for zero thickness. See
 * verify-transmission-thickness.mjs for the expected values and the arithmetic
 * behind them; the baselines here are only a second line of defence.
 */

/** Slab edge length. Large next to a shadow texel, so nothing is resolution-bound. */
const SLAB_EXTENT = 0.07;
/** Centre-to-centre spacing along X. */
const SLAB_PITCH = 0.095;

/**
 * Slab thicknesses, in metres.
 *
 * Straddles both knees of the encoding: the optical depth is clamped to
 * `[0.15, 5]`, so the floor is reached at 1.45 mm and the ceiling at 48.4 mm and
 * the ladder brackets both. A ladder stopping short of either could not tell a
 * correct scale from one that is merely monotonic.
 */
const LADDER_THICKNESSES = [0.002, 0.005, 0.01, 0.02, 0.035, 0.05];

/**
 * Slab tilts for the slant scene, in radians.
 *
 * The pass measures the distance between blocker and receiver *along the light
 * ray*, so a slab of fixed thickness `t` tilted by `θ` must read `t / cos θ` -
 * the path the light actually takes through the medium. This is the one property
 * that separates the two readings of UE5's `NoL` factor: multiplying by
 * `cos θ` converts that path back into the perpendicular thickness, which would
 * make this whole ladder read a constant instead of a rising curve.
 *
 * Stops at 50 degrees, with the slabs near the view axis: the camera's own
 * off-axis angle adds to the tilt, and past 90 degrees of total incidence the
 * face being measured becomes a backface.
 */
const SLANT_ANGLES = [0, (20 * Math.PI) / 180, (35 * Math.PI) / 180, (50 * Math.PI) / 180];

/**
 * Slab thickness for the slant scene, in metres.
 *
 * The spread the tilt produces is a ratio, so a thicker slab spreads the same
 * angles over more 8-bit levels and the residual is measurable rather than
 * inside quantisation. 10 mm puts the untilted rung near the middle of the
 * encoding and the 50-degree one well short of its ceiling, so the whole rise
 * stays on scale.
 */
const SLANT_THICKNESS = 0.01;

/**
 * Directional light behind the slabs, shining towards the camera.
 *
 * Exactly along +Z, so the slabs of the ladder scene sit perpendicular to it and
 * their shadow-map depth slope is zero - no slope-scaled bias, no interpolation
 * across the blocker, nothing between the stored depth and the arithmetic.
 *
 * `transmission` enrols the light in the pass and requires `castShadow`, since
 * the thickness comes from the shadow map's depth attachment. A short
 * `shadowDistance` keeps the light camera's Z extent near the scene size, which
 * the NDC-to-world conversion divides by.
 *
 * `shadowMapSize` is a parameter because the two scenes depend on it differently,
 * and that difference is worth pinning: a perpendicular slab has no depth slope
 * across a texel and reads the same at any resolution, while a tilted one is
 * bounded by light-space resolution - 0.07 mm thin at 20 degrees on a 1024 map,
 * exact on a 4096. That is the same limit that decides whether a real ear
 * resolves at all.
 */
function backLight(scene: Scene, shadowMapSize: number, scale = 1) {
  const light = new DirectionalLight(scene);
  light.lookAt(new Vector3(0, 0, -2), Vector3.zero(), Vector3.axisPY());
  light.color = new Vector4(1, 1, 1, 1);
  light.castShadow = true;
  light.transmission = true;
  light.shadow.mode = 'pcf';
  light.shadow.numShadowCascades = 1;
  light.shadow.shadowMapSize = shadowMapSize;
  light.shadow.shadowDistance = 2 * scale;
  return light;
}

/**
 * Skin material for the slabs.
 *
 * The pass does not care about the material, but the diffusion only runs where a
 * skin material drew, and the debug channel this scene reads lives inside it. The
 * albedo is irrelevant for the same reason: a debug output replaces the shaded
 * result rather than tinting it.
 */
function slabMaterial(worldUnitScale: number) {
  const material = new SSSMaterial();
  material.albedoColor = new Vector4(0.85, 0.66, 0.58, 1);
  // The pass reads extinction, normal scale and unit scale per pixel from this
  // profile, keyed by the id the depth prepass wrote. Set explicitly so the
  // scene's arithmetic and the pass's agree by construction.
  material.subsurfaceProfile.preset = 'skin';
  material.subsurfaceProfile.worldUnitScale = worldUnitScale;
  return material;
}

/**
 * Front faces coplanar at z = 0, extending backwards by their own thickness.
 *
 * `anchorZ = 1` is what puts the box in `[-sizeZ, 0]`. Coplanar fronts mean the
 * receiver depth is identical for every slab and only the blocker moves, so a
 * difference between two slabs can only be the thickness.
 */
function slab(scene: Scene, x: number, thickness: number, tilt: number, scale = 1) {
  const mesh = new Mesh(
    scene,
    new BoxShape({
      // Widened by 1/cos(tilt) so every slab covers the same pixel count once
      // foreshortened, which is what makes a run's median meaningful. In the
      // geometry rather than a node scale, which does not take effect here.
      sizeX: (SLAB_EXTENT * scale) / Math.cos(tilt),
      sizeY: SLAB_EXTENT * scale,
      sizeZ: thickness * scale,
      anchorZ: 1
    }),
    slabMaterial(scale)
  );
  mesh.position.setXYZ(x, 0, 0);
  if (tilt !== 0) {
    mesh.rotation.set(Quaternion.fromAxisAngle(Vector3.axisPY(), tilt));
  }
  return mesh;
}

/**
 * Selects the thickness debug channel, and takes the tonemapper out of the way.
 *
 * The camera's default chain has `tonemap.enabled = true`, so without this the
 * debug value arrives through a filmic curve that also mixes the channels -
 * measured, linear 0.9 lands at 200 in R but 186 in B. A channel-dependent
 * transfer cannot be inverted from one sample, so a debug channel read through it
 * is a picture rather than a number.
 */
function thicknessDebug(camera: PerspectiveCamera) {
  camera.postSSSDebugOutput = 'thickness';
  camera.toneMap = false;
}

/**
 * The scale and the encoding: six slabs from 0.5 mm to 5 mm, lit along their normal.
 *
 * Expected readout is a straight line of slope 0.2 per millimetre that saturates
 * at the sixth slab. Both the slope and the position of the knee are absolute
 * checks - the knee especially, since it survives whatever transfer curve the
 * final blit applies. The failure this scene exists to catch is every slab
 * reading the same value, which is what a thickness converted to centimetres
 * instead of the profile's millimetres produces: the entire physical range of
 * skin then sits below the clamp floor.
 */
export const transmissionThicknessLadder: VisualScene = {
  name: 'transmission-thickness-ladder',
  description:
    'Six back-lit slabs from 0.5 mm to 5 mm thick, rendered as the light-space thickness debug channel. Pins the world-to-optical-depth scale and the saturation knee.',
  supports: (backend) => backend === 'webgpu',
  setup({ scene, camera }) {
    buildLadder(scene, camera, 1);
  }
};

/**
 * The same ladder, four times the size, with `worldUnitScale` set to match.
 *
 * Every reading must be identical to `transmission-thickness-ladder`. The
 * geometry, the framing and the shadow region all scale together, so a shadow
 * texel covers the same fraction of a slab and nothing is resolution-bound
 * either way - the only thing that can move the numbers is whether the pass
 * divides the measured world distance back down by the profile's unit scale.
 *
 * This scene fails if the conversion goes back to a hard-coded
 * metres-to-millimetres constant: a 4x model then reads 4x thicker, every rung
 * past the first saturates, and the ladder collapses to one value - which is what
 * stops the effect being usable on an asset authored at anything but life size.
 */
export const transmissionThicknessScale: VisualScene = {
  name: 'transmission-thickness-scale',
  description:
    'The thickness ladder at 4x geometry with worldUnitScale 4. Must read identically to the 1x ladder; pins that the pass measures in profile space rather than world units.',
  supports: (backend) => backend === 'webgpu',
  setup({ scene, camera }) {
    buildLadder(scene, camera, 4);
  }
};

/**
 * Builds the ladder at a given asset scale, with the profile told about it.
 *
 * Everything scales: slab size, pitch, thickness and camera distance, so the
 * framing is identical and a pixel covers the same fraction of a slab. The
 * shadow distance scales with it too (see backLight), which keeps the light-space
 * texel footprint proportional.
 */
function buildLadder(scene: Scene, camera: PerspectiveCamera, scale: number) {
  bareScene(scene);
  // Perpendicular to the light, so no depth slope and no resolution dependence.
  backLight(scene, 1024, scale);
  const pitch = SLAB_PITCH * scale;
  const first = -0.5 * (LADDER_THICKNESSES.length - 1) * pitch;
  LADDER_THICKNESSES.forEach((thickness, i) => {
    slab(scene, first + i * pitch, thickness, 0, scale);
  });
  placeCamera(camera, new Vector3(0, 0, 0.6 * scale));
  thicknessDebug(camera);
}

/**
 * The measured quantity: five 1 mm slabs tilted away from the light.
 *
 * A slab of fixed thickness read at increasing tilt must report an increasing
 * value, since the pass measures the path through the medium and that grows as
 * `1 / cos θ`. A flat readout means something converted the path back into the
 * perpendicular thickness - which is what multiplying by `cos θ` does, and is
 * indistinguishable from correct on flat geometry lit head-on.
 */
export const transmissionThicknessSlant: VisualScene = {
  name: 'transmission-thickness-slant',
  description:
    'Five 1 mm back-lit slabs tilted 0-70 degrees off the light, as the thickness debug channel. Pins that the pass measures the path along the light ray rather than the perpendicular thickness.',
  supports: (backend) => backend === 'webgpu',
  setup({ scene, camera }) {
    bareScene(scene);
    // Tilted blockers are resolution-bound by construction; see backLight.
    backLight(scene, 4096);
    const pitch = 0.16;
    const first = -0.5 * (SLANT_ANGLES.length - 1) * pitch;
    SLANT_ANGLES.forEach((tilt, i) => {
      slab(scene, first + i * pitch, SLANT_THICKNESS, tilt);
    });
    placeCamera(camera, new Vector3(0, 0, 0.8));
    thicknessDebug(camera);
  }
};

/**
 * Sphere radius for the curved scenes, in metres.
 *
 * The chord through a sphere is at most `2R`, so this sets the top of the range
 * the pass is asked to resolve. 25 mm puts that at 50 mm, which is where the
 * optical depth saturates at unit extinction - so one sphere sweeps the encoding
 * from its floor to its ceiling, and both knees are in frame.
 */
const SPHERE_RADIUS = 0.025;

/**
 * Light-space thickness over a sphere, where the answer is still arithmetic.
 *
 * The flat-slab scenes cannot see the failure this one exists for: their blocker
 * depth is constant or linear across the shadow map, and a zero-mean filter over
 * a linear gradient returns the value at its centre however wide it is - so every
 * filtering choice measures identically there.
 *
 * A sphere restores the missing dimension at no cost in tractability. For a
 * surface point `P` on a sphere of radius `R` lit along `L`, the light ray
 * `P + sL` meets the sphere again at `s = -2(P.L)`, so the path through the
 * medium is
 *
 * ```
 * t = 2R max(0, -cos(theta)),  cos(theta) = normalize(P).L
 * ```
 *
 * exactly. It falls linearly to zero at the terminator, which makes that
 * neighbourhood the cleanest test bed available: the truth is a straight line, so
 * anything the measurement adds is artifact and separable by frequency alone.
 *
 * Both parameters that govern the artifact are exposed, because the diagnosis
 * turns on how the error responds to them rather than on its size: a
 * resolution-bound error scales with the texel, an algorithmic one does not.
 */
function buildSphere(scene: Scene, camera: PerspectiveCamera, shadowMapSize: number, shadowDistance: number) {
  bareScene(scene);
  const light = new DirectionalLight(scene);
  // Across the view, not along it: the terminator then runs down the middle of
  // the sphere as the camera sees it, so a horizontal scanline crosses it at a
  // right angle and samples the full ramp from lit to saturated.
  light.lookAt(new Vector3(-2, 0, 0), Vector3.zero(), Vector3.axisPY());
  light.color = new Vector4(1, 1, 1, 1);
  light.castShadow = true;
  light.transmission = true;
  light.shadow.mode = 'pcf';
  light.shadow.numShadowCascades = 1;
  light.shadow.shadowMapSize = shadowMapSize;
  light.shadow.shadowDistance = shadowDistance;
  const mesh = new Mesh(
    scene,
    // Dense enough that facet edges are well under a shadow texel at every
    // resolution tested, so tessellation cannot be mistaken for the artifact.
    new SphereShape({ radius: SPHERE_RADIUS, verticalDetail: 128, horizonalDetail: 128 }),
    slabMaterial(1)
  );
  mesh.position.setXYZ(0, 0, 0);
  placeCamera(camera, new Vector3(0, 0, 0.16));
  thicknessDebug(camera);
}

/** The curved case at a coarse shadow map: the artifact at its most visible. */
export const transmissionThicknessSphere: VisualScene = {
  name: 'transmission-thickness-sphere',
  description:
    'A 25 mm back-lit sphere as the light-space thickness debug channel, lit across the view so the terminator runs down the middle. The chord through a sphere is analytic, so the residual is separable from the signal.',
  supports: (backend) => backend === 'webgpu',
  setup({ scene, camera }) {
    buildSphere(scene, camera, 1024, 2);
  }
};

/** The same sphere with four times the light-space resolution. */
export const transmissionThicknessSphereFine: VisualScene = {
  name: 'transmission-thickness-sphere-fine',
  description:
    'The thickness sphere at 4096 rather than 1024. Pairs with transmission-thickness-sphere to separate a resolution-bound error from an algorithmic one: only the former shrinks with the texel.',
  supports: (backend) => backend === 'webgpu',
  setup({ scene, camera }) {
    buildSphere(scene, camera, 4096, 2);
  }
};
