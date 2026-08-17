import { Vector3, Vector4 } from '@zephyr3d/base';
import { HairMaterial, Mesh, PlaneShape, SkinMaterial, SphereShape, UnlitMaterial } from '@zephyr3d/scene';
import type { VisualScene } from '../types';
import { bareScene, keyLight, pbr, placeCamera, proceduralTexture } from './common';

/**
 * Texture sampling in isolation: unlit, so nothing about the lighting model can
 * mask a UV, filtering, wrap-mode or channel-order regression. The plane is
 * tilted so the same texture is sampled across a wide range of minification.
 */
export const unlitTextured: VisualScene = {
  name: 'unlit-textured',
  description: 'Unlit textured plane at a grazing angle. Pins UV mapping, filtering and channel order.',
  setup({ scene, camera }) {
    bareScene(scene);
    const material = new UnlitMaterial();
    material.albedoTexture = proceduralTexture();
    // PlaneShape is an XZ ground plane already centred on the origin.
    new Mesh(scene, new PlaneShape({ size: 12 }), material);
    placeCamera(camera, new Vector3(0, 1.4, 5.5), new Vector3(0, 0, -3));
  }
};

/**
 * The canonical PBR sweep: metallic on one axis, roughness on the other.
 *
 * A single sphere would pin only one point of the BRDF. The grid means a change
 * to the distribution, geometry or Fresnel term shows up as a gradient across
 * the frame rather than as one ambiguous shade.
 */
export const pbrMetalRoughGrid: VisualScene = {
  name: 'pbr-metalrough-grid',
  description: 'A 5x5 metallic-by-roughness sphere sweep under one directional light.',
  setup({ scene, camera }) {
    bareScene(scene);
    keyLight(scene);
    const N = 5;
    for (let m = 0; m < N; m++) {
      for (let r = 0; r < N; r++) {
        const sphere = new Mesh(
          scene,
          new SphereShape({ radius: 0.42 }),
          pbr(new Vector4(0.85, 0.72, 0.55, 1), m / (N - 1), Math.max(0.04, r / (N - 1)))
        );
        sphere.position.setXYZ((r - (N - 1) / 2) * 1.05, (m - (N - 1) / 2) * 1.05, 0);
      }
    }
    placeCamera(camera, new Vector3(0, 0, 8.4));
  }
};

/**
 * Subsurface skin, the material the digital-human work leans on hardest.
 *
 * `camera.skinSSS` has to be switched on explicitly - it defaults to false, and
 * without it this scene renders SkinMaterial's direct lighting only and the
 * entire SkinSSS pass is a no-op. That is what the scene did for its whole
 * history despite its name, so the diffusion went unpinned.
 *
 * Back-lit transmission is *not* covered here, and the scene should not claim to
 * be: the term is gated on `subsurfaceTexture`, whose B channel carries the
 * thickness it needs, and this scene sets no such texture. `transmissionStrength`
 * is left at a nonzero value only so a regression that ungates the term shows up
 * as a diff rather than silently doing nothing.
 */
export const skinSss: VisualScene = {
  name: 'skin-sss',
  description:
    'SkinMaterial sphere under a grazing key with SkinSSS enabled. Pins the diffuse wrap and the channel-dependent diffusion across a wide terminator.',
  setup({ scene, camera }) {
    bareScene(scene);
    // Grazing key from the left, so the terminator runs down the middle of the
    // sphere and is wide enough to read. The original pair of near-frontal
    // lights left almost no terminator at all - the diffusion had nothing to
    // act on and the scene could not see it working.
    const key = keyLight(scene);
    key.lookAt(new Vector3(-5, 0.8, 1.6), Vector3.zero(), Vector3.axisPY());
    // Dim warm rim from behind, to keep the unlit side from crushing to black
    // so that light diffusing into it stays measurable.
    const rim = keyLight(scene);
    rim.lookAt(new Vector3(1.5, 1, -5), Vector3.zero(), Vector3.axisPY());
    rim.color = new Vector4(0.35, 0.22, 0.2, 1);

    const material = new SkinMaterial();
    material.albedoColor = new Vector4(0.85, 0.66, 0.58, 1);
    material.transmissionStrength = 0.6;
    material.diffuseWrap = 0.5;
    const head = new Mesh(scene, new SphereShape({ radius: 1.5 }), material);
    head.position.setXYZ(0, 0, 0);
    placeCamera(camera, new Vector3(0, 0, 5.5));

    camera.skinSSS = true;
    // Tap spacing has to keep up with the projected radius or the kernel is
    // clamped short and the scene silently stops testing the far tail.
    camera.skinSSSSampleStep = 5;
    // The sphere is 1.5 units across on screen, so a human-scale 2 cm radius
    // would be invisible here; this is scaled to the stand-in geometry.
    camera.skinSSSScatterRadius = 0.35;
  }
};

/**
 * The stylization range of the diffusion, and the evidence that grounding it in
 * a physical model did not cost any.
 *
 * Identical to `skin-sss` in geometry and lighting; the only difference is the
 * subsurface profile driving the per-channel scatter radii. Jade is the furthest
 * thing from skin the presets offer - green travels furthest instead of red - so
 * a diff against `skin-sss` isolates exactly what the channel ratios contribute.
 *
 * The profile is a property of the pass rather than of a material, so the
 * contrast has to live across two scenes instead of across three spheres in one.
 * Per-material profiles are the profile-slot path used by `SSS`.
 *
 * This is the scene that fails if the channels ever collapse back to a shared
 * radius: it would converge on `skin-sss` and both would read as flat haze.
 */
export const skinDiffusionJade: VisualScene = {
  name: 'skin-diffusion-jade',
  description:
    'The skin-sss setup diffused with the jade profile instead of skin. Pins the per-channel scatter radii and the stylization range the presets provide.',
  setup({ scene, camera }) {
    bareScene(scene);
    // Grazing key from the left, so the terminator runs down the middle of the
    // sphere and is wide enough to read. The original pair of near-frontal
    // lights left almost no terminator at all - the diffusion had nothing to
    // act on and the scene could not see it working.
    const key = keyLight(scene);
    key.lookAt(new Vector3(-5, 0.8, 1.6), Vector3.zero(), Vector3.axisPY());
    // Dim warm rim from behind, to keep the unlit side from crushing to black
    // so that light diffusing into it stays measurable.
    const rim = keyLight(scene);
    rim.lookAt(new Vector3(1.5, 1, -5), Vector3.zero(), Vector3.axisPY());
    rim.color = new Vector4(0.35, 0.22, 0.2, 1);

    const material = new SkinMaterial();
    material.albedoColor = new Vector4(0.85, 0.66, 0.58, 1);
    material.transmissionStrength = 0.6;
    material.diffuseWrap = 0.5;
    const head = new Mesh(scene, new SphereShape({ radius: 1.5 }), material);
    head.position.setXYZ(0, 0, 0);
    placeCamera(camera, new Vector3(0, 0, 5.5));

    camera.skinSSS = true;
    // Tap spacing has to keep up with the projected radius or the kernel is
    // clamped short and the scene silently stops testing the far tail.
    camera.skinSSSSampleStep = 5;
    camera.skinSSSScatterRadius = 0.35;
    camera.skinSSSProfilePreset = 'jade_soft';
  }
};

/**
 * Skin under a shadow-casting light, which `skin-sss` deliberately is not.
 *
 * That scene lights its sphere with `keyLight`, whose `castShadow` defaults to
 * false, so every shadow-dependent line in SkinMaterial is dead code there -
 * the material's whole shadow path went untested until this scene existed.
 *
 * The terminator is where skin shows shadow bugs that other materials hide.
 * SkinMaterial mixes a wrapped diffuse into the visible lighting, so the band
 * around NdotL = 0 still receives roughly 10% of full diffuse; a Lambert surface
 * multiplies the same band by a vanishing NdotL and swallows the evidence.
 * Grazing-angle self-shadow acne is therefore plainly visible here and nearly
 * invisible elsewhere, which is the whole reason for the scene.
 *
 * Two deliberate choices:
 *
 * 1. **The light is low and to the side** (~65 deg off vertical). Angle is what
 *    sets the depth slope per shadow texel, and the acne it produces grows
 *    without bound as the surface turns away from the light. A high key light
 *    makes a prettier frame that pins nothing.
 *
 * 2. **The occluder is a sphere, not a box.** A cube casts a genuinely angular
 *    hexagonal shadow, and its straight edges and sharp corners are impossible
 *    to tell apart from the torn, stair-stepped boundary that a broken shadow
 *    bias produces - measured, not assumed: the first version of this scene used
 *    a box and the "artifact" turned out to be the cube's own silhouette. A
 *    sphere casts a smooth ellipse, so any angularity in this baseline is a
 *    defect by construction.
 */
export const skinShadow: VisualScene = {
  name: 'skin-shadow',
  description:
    'SkinMaterial sphere under a grazing shadow-casting light, with a spherical occluder casting across its lit side. Pins the self-shadow terminator and a cast shadow whose edge must stay elliptical; skin-sss cannot see either, since its light casts no shadow.',
  setup({ scene, camera }) {
    bareScene(scene);
    // A little ambient, so the shadowed side is readable rather than pure black
    // and a shadow that leaks or detaches still shows up.
    scene.env.light.type = 'constant';
    scene.env.light.ambientColor = new Vector4(0.1, 0.1, 0.12, 1);

    const light = keyLight(scene, true);
    light.lookAt(new Vector3(-5, 2.4, 3), Vector3.zero(), Vector3.axisPY());
    light.shadow.applyQualityPreset('character-small');
    light.shadow.mode = 'pcf';
    light.shadow.numShadowCascades = 1;

    const material = new SkinMaterial();
    material.albedoColor = new Vector4(0.85, 0.66, 0.58, 1);
    material.scatterColor = new Vector4(0.75, 0.28, 0.2, 1);
    material.scatterStrength = 0.8;
    material.diffuseWrap = 0.5;
    const head = new Mesh(scene, new SphereShape({ radius: 1.5 }), material);
    head.position.setXYZ(0, 0, 0);

    // Between the light and the head, so the shadow lands across the lit side
    // rather than where the surface is already dark and nothing could be seen.
    const occluder = new Mesh(
      scene,
      new SphereShape({ radius: 0.6 }),
      pbr(new Vector4(0.4, 0.42, 0.5, 1), 0, 0.8)
    );
    occluder.position.setXYZ(-2.4, 1.5, 1.6);

    placeCamera(camera, new Vector3(0, 0, 5.5));
  }
};

/**
 * Kajiya-Kay hair. Anisotropic highlights are strongly view- and
 * tangent-dependent, so the camera sits off-axis: head-on, both specular lobes
 * collapse onto each other and the scene stops testing the thing it is named for.
 */
export const hair: VisualScene = {
  name: 'hair',
  description: 'HairMaterial sphere off-axis, so both anisotropic specular lobes are separated and pinned.',
  setup({ scene, camera }) {
    bareScene(scene);
    keyLight(scene);
    const material = new HairMaterial();
    material.albedoColor = new Vector4(0.22, 0.13, 0.09, 1);
    material.transmissionColor = new Vector3(0.5, 0.22, 0.12);
    material.transmissionIntensity = 0.7;
    const mesh = new Mesh(scene, new SphereShape({ radius: 1.5 }), material);
    mesh.position.setXYZ(0, 0, 0);
    placeCamera(camera, new Vector3(2.6, 1.4, 4.6));
  }
};
