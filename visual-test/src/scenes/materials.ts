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
 * Lit from behind-left as well as front so both the diffuse wrap and the
 * transmission term contribute; a front-only key light would leave transmission
 * untested and its regressions invisible.
 */
export const skinSss: VisualScene = {
  name: 'skin-sss',
  description:
    'SkinMaterial sphere with front key and rim light. Pins diffuse wrap, scatter and transmission.',
  setup({ scene, camera }) {
    bareScene(scene);
    keyLight(scene);
    const rim = keyLight(scene);
    rim.lookAt(new Vector3(-3, 1.5, -5), Vector3.zero(), Vector3.axisPY());
    rim.color = new Vector4(0.9, 0.6, 0.55, 1);

    const material = new SkinMaterial();
    material.albedoColor = new Vector4(0.85, 0.66, 0.58, 1);
    material.scatterColor = new Vector4(0.75, 0.28, 0.2, 1);
    material.scatterStrength = 0.8;
    material.transmissionStrength = 0.6;
    material.diffuseWrap = 0.5;
    const head = new Mesh(scene, new SphereShape({ radius: 1.5 }), material);
    head.position.setXYZ(0, 0, 0);
    placeCamera(camera, new Vector3(0, 0, 5.5));
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
