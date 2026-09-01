import { Vector3, Vector4 } from '@zephyr3d/base';
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
