import { Quaternion, Vector3, Vector4 } from '@zephyr3d/base';
import { BoxShape, Mesh, PlaneShape, SphereShape, UnlitMaterial } from '@zephyr3d/scene';
import type { VisualScene } from '../types';
import { bareScene, keyLight, lambert, pbr, placeCamera, proceduralTexture, shadowStage } from './common';

/**
 * Bright emissive-ish spheres against black, so the bloom threshold has
 * something unambiguous to select. Tone mapping is on because bloom feeds into
 * it; the pair is what ships together, and pinning them together is what
 * catches an ordering regression between them.
 */
export const postToneMapBloom: VisualScene = {
  name: 'post-tonemap-bloom',
  description:
    'Tone mapping plus bloom over high-intensity highlights. Pins the threshold and the chain order.',
  setup({ scene, camera }) {
    bareScene(scene);
    const light = keyLight(scene);
    // Well above 1.0 so the bloom threshold has real work to do.
    light.color = new Vector4(6, 5.6, 5.2, 1);

    for (let i = 0; i < 4; i++) {
      const sphere = new Mesh(
        scene,
        new SphereShape({ radius: 0.55 }),
        pbr(new Vector4(1, 1, 1, 1), 0.1, 0.12)
      );
      sphere.position.setXYZ((i - 1.5) * 1.5, ((i % 2) - 0.5) * 1.2, 0);
    }

    camera.toneMap = true;
    camera.bloom = true;
    // Threshold deliberately left at the engine default. It happens to be the
    // 0.8 this scene wants anyway, so inheriting it costs nothing visually and
    // buys sensitivity to the default drifting - setting it explicitly made the
    // scene immune to exactly that, which tools/sensitivity.mjs caught.
    camera.bloomIntensity = 1.2;
    placeCamera(camera, new Vector3(0, 0, 7));
  }
};

/**
 * FXAA needs high-contrast near-diagonal edges to do anything at all; a
 * axis-aligned scene would leave the filter with nothing to find and the
 * baseline would pass with FXAA entirely broken.
 */
export const postFxaa: VisualScene = {
  name: 'post-fxaa',
  description: 'FXAA over deliberately near-diagonal high-contrast edges.',
  setup({ scene, camera }) {
    bareScene(scene);
    keyLight(scene);
    const stage = shadowStage(scene);
    stage.box.rotation.fromEulerAngle(0.3, 0.62, 0.15, 'ZYX');
    camera.FXAA = true;
    placeCamera(camera, new Vector3(1.0, 4.4, 9.5), new Vector3(0.3, 0.9, 0));
  }
};

/**
 * TAA across eight frames.
 *
 * This is the harness's own integrity test as much as a TAA test: jitter comes
 * from `Camera._halton23[frameCounter % n]` and the resolve reads the previous
 * frame's colour and motion vectors out of the history manager, so a stable
 * baseline here proves that `stepFrame()` really is advancing per-frame state
 * exactly once and that history ping-pong is not leaking between scenes.
 *
 * Eight frames rather than two, so the Halton sequence actually cycles.
 *
 * Runs on the default tolerance, deliberately. It originally carried a loosened
 * one, on the plausible-sounding assumption that temporal accumulation would
 * compound per-frame floating-point differences into flakiness. That assumption
 * was never measured, and it was wrong twice over: the scene is byte-stable
 * across repeated runs on both backends, and the loosened per-pixel threshold
 * was silently swallowing real regressions - a 1.5x change to the TAA jitter
 * amplitude registered as 4.0% of pixels at the default threshold but only 0.15%
 * at the loosened one, which slipped under the budget and passed.
 *
 * The general lesson, since it will come up again: loosen a tolerance only after
 * observing flakiness, never in anticipation of it, and re-run
 * tools/sensitivity.mjs afterwards to see what the slack cost.
 */
export const taaMultiframe: VisualScene = {
  name: 'taa-multiframe',
  description: 'TAA resolved over 8 stepped frames. Also proves frame-state advance and history isolation.',
  frames: 8,
  setup({ scene, camera }) {
    bareScene(scene);
    keyLight(scene);
    shadowStage(scene);
    camera.TAA = true;
    placeCamera(camera, new Vector3(1.0, 4.4, 9.5), new Vector3(0.3, 0.9, 0));
  }
};

/**
 * Motion blur of a moving *object* under a completely still camera.
 *
 * This is the case a per-pixel gather cannot reconstruct, and the reason the
 * effect carries a TileMax/NeighborMax velocity dilation. Read the velocity
 * only at the pixel being shaded and every background pixel reports zero, the
 * blur branch is skipped there, and the box keeps a hard silhouette however
 * fast it travels - which looks exactly like "motion blur is off" while a
 * camera-motion capture of the same build looks perfectly correct.
 *
 * So the scene is built to make that failure loud rather than subtle:
 *
 *  - The camera never moves. Any velocity in the frame belongs to the box, so a
 *    capture cannot pass on camera motion smearing everything uniformly.
 *  - The checkerboard backdrop is static and high contrast. The streak the box
 *    is supposed to leave lands on it, so a missing streak is a hard edge
 *    against a pattern rather than a subtle gradient against flat colour.
 *  - The box moves ~32 px per frame (0.5 units at ~63 px per unit here). That is
 *    inside the 40 px the filter can reconstruct but well past the 20 px tile
 *    size, which is the point: clamping the whole-frame velocity to the tile
 *    size rather than to twice it is an easy mistake that halves the longest
 *    streak, and at a speed under 20 px per frame both versions agree and this
 *    scene would not notice.
 *
 * Unlit background and no tone mapping: what is being pinned is the filter's
 * weighting, and an ACES curve compresses exactly the contrast that makes a
 * weighting error visible.
 */
export const postMotionBlurObject: VisualScene = {
  name: 'post-motionblur-object',
  description:
    'A box crossing a static checkerboard under a still camera. Pins object motion blur and its velocity dilation.',
  // Motion vectors need a previous world matrix, which only exists from the
  // second frame on; a few more so the box is clear of its start position.
  frames: 4,
  setup({ scene, camera }) {
    bareScene(scene);
    keyLight(scene);

    const backdropMaterial = new UnlitMaterial();
    backdropMaterial.albedoTexture = proceduralTexture();
    // PlaneShape is an XZ plane; stand it up to act as a wall behind the box.
    const backdrop = new Mesh(scene, new PlaneShape({ size: 14 }), backdropMaterial);
    backdrop.rotation.fromEulerAngle(Math.PI / 2, 0, 0, 'ZYX');
    backdrop.position.setXYZ(0, 0, -4);

    const box = new Mesh(scene, new BoxShape({ size: 1.5 }), lambert(new Vector4(0.92, 0.26, 0.2, 1)));
    // Pure function of the frame index, so the capture is reproducible and does
    // not depend on how many scenes ran before this one.
    let frame = 0;
    scene.on('update', () => {
      box.position.setXYZ(-1.4 + frame * 0.5, 0, 0);
      frame++;
    });

    camera.motionBlur = true;
    camera.motionBlurStrength = 1;
    camera.toneMap = false;
    placeCamera(camera, new Vector3(0, 0, 7));
  }
};

/**
 * The same filter driven by camera motion instead, over the same backdrop.
 *
 * The complement of {@link postMotionBlurObject}: here the velocity field is
 * smooth across the whole frame, which is the one case the old per-pixel gather
 * did handle. Keeping both means a rewrite of the filter cannot fix objects by
 * breaking the camera path, and the pair localises which half moved.
 */
export const postMotionBlurCamera: VisualScene = {
  name: 'post-motionblur-camera',
  description:
    'A static scene under a panning camera. Pins the camera-motion half of the motion blur filter.',
  frames: 4,
  setup({ scene, camera }) {
    bareScene(scene);
    keyLight(scene);

    const backdropMaterial = new UnlitMaterial();
    backdropMaterial.albedoTexture = proceduralTexture();
    const backdrop = new Mesh(scene, new PlaneShape({ size: 14 }), backdropMaterial);
    backdrop.rotation.fromEulerAngle(Math.PI / 2, 0, 0, 'ZYX');
    backdrop.position.setXYZ(0, 0, -4);

    const sphere = new Mesh(scene, new SphereShape({ radius: 1.1 }), lambert(new Vector4(0.9, 0.8, 0.3, 1)));
    sphere.position.setXYZ(0, 0, 0);

    let frame = 0;
    scene.on('update', () => {
      // Sideways truck rather than a yaw: a pan around the camera's own axis
      // leaves the centre of the frame nearly still, so the middle of the image
      // would carry no velocity to pin.
      placeCamera(camera, new Vector3(-1.6 + frame * 0.42, 0, 7), new Vector3(-1.6 + frame * 0.42, 0, 0));
      frame++;
    });

    camera.motionBlur = true;
    camera.motionBlurStrength = 1;
    camera.toneMap = false;
    placeCamera(camera, new Vector3(-1.6, 0, 7), new Vector3(-1.6, 0, 0));
  }
};

/**
 * The same moving box as {@link postMotionBlurObject}, with the shutter pushed
 * fully behind the object instead of centred on it.
 *
 * What this pins is placement, not length. A centred shutter smears the box
 * symmetrically, into ground it has not reached yet as well as ground it has
 * left; biasing it to 0 puts the whole streak behind, which is what a shutter
 * closing on the current frame physically produces. Reading the two baselines
 * side by side, the box's leading edge should be noticeably crisper here and
 * its trailing edge noticeably softer.
 *
 * It also pins the coupling that makes the bias more than a cosmetic dial: a
 * tap may not reach further than one tile, so a fully biased shutter spends
 * that budget in one direction and the longest reconstructible streak halves
 * from 40 px to 20 px. The box moves ~32 px per frame, which is inside the cap
 * when centred and past it here - so this baseline is also the one that catches
 * the clamp failing to follow the bias.
 */
export const postMotionBlurTrailing: VisualScene = {
  name: 'post-motionblur-trailing',
  description:
    'Moving box with the shutter biased fully behind it. Pins streak placement and the reach clamp.',
  frames: 4,
  setup({ scene, camera }) {
    bareScene(scene);
    keyLight(scene);

    const backdropMaterial = new UnlitMaterial();
    backdropMaterial.albedoTexture = proceduralTexture();
    const backdrop = new Mesh(scene, new PlaneShape({ size: 14 }), backdropMaterial);
    backdrop.rotation.fromEulerAngle(Math.PI / 2, 0, 0, 'ZYX');
    backdrop.position.setXYZ(0, 0, -4);

    const box = new Mesh(scene, new BoxShape({ size: 1.5 }), lambert(new Vector4(0.92, 0.26, 0.2, 1)));
    let frame = 0;
    scene.on('update', () => {
      box.position.setXYZ(-1.4 + frame * 0.5, 0, 0);
      frame++;
    });

    camera.motionBlur = true;
    camera.motionBlurStrength = 1;
    camera.motionBlurShutterBias = 0;
    camera.toneMap = false;
    placeCamera(camera, new Vector3(0, 0, 7));
  }
};

/**
 * A cube spinning about its own axis under a still camera, at a strength high
 * enough to saturate the velocity clamp.
 *
 * This is the case that forced the reconstruction to walk the velocity field
 * instead of a straight line, and the scene that measures whether it still
 * does. A self-rotating object is the one motion where the velocity turns
 * across the object, so the locus of points that sweep over a given pixel
 * curves; walk it straight and the streak tears along thin dark cracks
 * parallel to the blur direction. Translation never produces this, which is
 * why the other three scenes stayed clean throughout.
 *
 * Measured here, as the maximum luminance dip across the crack on the scan
 * line through it: 47 for the straight-line walk this replaced, 35 once the
 * walk followed the field, 19 once each direction was walked twice to either
 * side. A regression that reintroduces the straight walk shows up as that dip
 * roughly tripling.
 *
 * Approaches that did NOT work, each measured on this scene - do not
 * re-attempt without new evidence:
 *
 *  - filtering the NeighborMax lookup instead of point-sampling it (dip 48 ->
 *    56; Guertin et al. section 4.2 explains why - the average of two
 *    directions is not a direction anything moves along)
 *  - stochastically offsetting the tile lookup (no change, adds noise)
 *  - jittering tap positions along the streak (47 -> 58, adds noise)
 *  - offsetting the whole tap line perpendicular by a per-pixel random amount
 *    (no change - a single random offset per pixel resamples the profile
 *    rather than averaging over it, so the dip survives intact and only moves)
 *  - splitting taps between the dilated and the per-pixel velocity, per
 *    Guertin et al. (no change here: a background pixel has no velocity of its
 *    own, so both directions collapse to the dilated one)
 *  - quadrupling the tap count to 96 (47 -> 44, so never a sampling rate
 *    problem)
 *
 * Strength 2 rather than 1, because the artifact needs a long streak: it is
 * absent at 0.5 and appears from 1 upwards. Its severity jumps around rather
 * than growing smoothly with strength, which is the signature of a geometric
 * grazing effect - it depends on whether an edge happens to line up, not on
 * how long the streak is.
 *
 * Black background and no backdrop, deliberately: only an empty background
 * shows a hole in the smear as a hole. Over a textured backdrop the same gap
 * fills with backdrop colour and reads as ordinary translucency, which is why
 * the first version of this scene missed the artifact entirely.
 */
export const postMotionBlurRotation: VisualScene = {
  name: 'post-motionblur-rotation',
  description:
    'A spinning cube on black. Pins the curved-path walk that keeps a rotational streak from cracking.',
  frames: 4,
  setup({ scene, camera }) {
    bareScene(scene);
    keyLight(scene);

    // Mid-tone albedo so the lit faces stay well short of clipping: a saturated
    // white object hides exactly the intensity dips this scene is looking for.
    const box = new Mesh(scene, new BoxShape({ size: 1.8 }), lambert(new Vector4(0.55, 0.5, 0.3, 1)));
    let frame = 0;
    scene.on('update', () => {
      // Spin about the view axis, so the whole velocity field lies in the image
      // plane and none of the swing is lost to foreshortening.
      box.rotation.set(Quaternion.fromAxisAngle(Vector3.axisPZ(), frame * 0.3));
      frame++;
    });

    camera.motionBlur = true;
    camera.motionBlurStrength = 2;
    camera.toneMap = false;
    placeCamera(camera, new Vector3(0, 0, 7));
  }
};

/**
 * A fast box on black with the streak ceiling raised well past the default.
 *
 * Pins {@link MotionBlur.maxBlurLength} doing what it says, and the machinery
 * that has to follow it. The velocity tiles, the loop bounds of both TileMax
 * passes and the number of steps each walk takes are all derived from this one
 * number at runtime rather than baked in, so a mistake in any of them shows up
 * here and nowhere else: too small a tile and the streak loses its tail, too
 * few steps and the taps thin out until the box ghosts into copies of itself
 * instead of smearing.
 *
 * Measured when this was added: the smear reaches exactly `maxBlurLength / 2`
 * beyond the geometry at a centred shutter, checked at 40, 80 and 160 against
 * a fixed geometric edge. That is the invariant worth re-deriving if this
 * baseline ever moves.
 *
 * Strength 4 against a box crossing ~32 px per frame asks for a 128 px streak,
 * comfortably past the 80 px this scene allows, so the clamp is what sets the
 * length and the scene measures the ceiling rather than the object's speed.
 */
export const postMotionBlurLong: VisualScene = {
  name: 'post-motionblur-long',
  description:
    'A fast box on black with a raised streak ceiling. Pins maxBlurLength and the sizing derived from it.',
  frames: 4,
  setup({ scene, camera }) {
    bareScene(scene);
    keyLight(scene);

    const box = new Mesh(scene, new BoxShape({ size: 1.4 }), lambert(new Vector4(0.85, 0.5, 0.25, 1)));
    let frame = 0;
    scene.on('update', () => {
      box.position.setXYZ(-1.6 + frame * 0.5, 0, 0);
      frame++;
    });

    camera.motionBlur = true;
    camera.motionBlurStrength = 4;
    camera.motionBlurMaxLength = 160;
    camera.toneMap = false;
    placeCamera(camera, new Vector3(0, 0, 7));
  }
};
