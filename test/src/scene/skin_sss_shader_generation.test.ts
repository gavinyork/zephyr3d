import { ProgramBuilder } from '../../../libs/device/src';
import { SkinSSS } from '../../../libs/scene/src/posteffect/skinsss';

function createShaderContext(type: 'webgl' | 'webgpu') {
  const device: any = {
    type,
    buildRenderProgram(options: any) {
      const builder = new ProgramBuilder(device);
      const result = builder.buildRender(options);
      if (!result) {
        throw new Error(builder.lastError ?? 'SkinSSS shader generation failed');
      }
      return {
        bindGroupLayouts: result[2],
        name: '',
        vertexSource: result[0],
        fragmentSource: result[1]
      };
    }
  };
  return { device } as any;
}

function buildPrograms(type: 'webgl' | 'webgpu') {
  const ctx = createShaderContext(type);
  const effect = new SkinSSS() as any;
  return {
    burley: effect.createBurleyProgram(ctx).fragmentSource as string,
    bvar: effect.createBVarProgram(ctx).fragmentSource as string,
    recombine: effect.createRecombineProgram(ctx).fragmentSource as string
  };
}

describe('SkinSSS shader generation', () => {
  test.each(['webgpu', 'webgl'] as const)('builds all %s passes', (type) => {
    const { burley, bvar, recombine } = buildPrograms(type);
    expect(burley).toBeTruthy();
    expect(bvar).toBeTruthy();
    expect(recombine).toBeTruthy();
  });

  test('Burley samples radii from the inverse CDF, in world units', () => {
    const { burley } = buildPrograms('webgpu');
    // Radii come straight out of RadiusRootFindByApproximation in world space and
    // are unbounded. There is deliberately no normalized sampling disc: pinning
    // the radii to one couples the kernel shape to the profile scale, which made
    // the bleed vanish at small scales and flatten into a box average at large.
    expect(burley).toContain('radiusRootApprox');
    expect(burley).toContain('radiusMM');
    expect(burley).toContain('burleyPdf');
    expect(burley).not.toContain('maxRadiusPx');
    expect(burley).not.toContain('worldRadius');
  });

  test('Burley converts world radii to UV without shaping the kernel', () => {
    const { burley } = buildPrograms('webgpu');
    // CalculateBurleyScale is pure unit conversion: world unit scale, the user
    // multiplier, the projection and 1/depth. No albedo or mean free path.
    const scaleLine = burley.split('\n').find((line) => line.includes('burleyScale:'));
    expect(scaleLine).toBeDefined();
    expect(scaleLine).toContain('viewScale');
    expect(scaleLine).not.toContain('albedo');
    expect(scaleLine).not.toContain('mfp');
  });

  test('Burley evaluates the per-channel diffusion profile', () => {
    const { burley } = buildPrograms('webgpu');
    // rR(r) per channel from the 3D scaling factor, divided by the sampling PDF.
    expect(burley).toContain('diffusionProfile');
    expect(burley).toContain('scalingFactor3D');
    expect(burley).toContain('radiusSampledMM');
  });

  test('the R2 sequence start is a per-pixel integer, not a fraction', () => {
    const { burley } = buildPrograms('webgpu');
    // Regression guard: R2Sequence is a low-discrepancy sequence over integer
    // indices. Offsetting the index by a per-pixel fraction turns it into a phase
    // sweep correlated with pixel position, which rendered as regular banding —
    // so the rebase has to land on an integer. It does have to be per-pixel
    // though: a constant start makes every pixel draw the identical 64 taps and
    // the sampling error goes fully correlated across the image. UE5 does the
    // same thing with `Rand3DPCG16(int3(pixel, seed)).x`.
    expect(burley).toContain('seedStart');
    const seedLine = burley.split('\n').find((line) => line.includes('seedStart:'));
    expect(seedLine).toBeDefined();
    // i32(...) — an integer rebase, whatever the hash inside it looks like.
    expect(seedLine).toMatch(/\bi32\b|\bint\b/);
    // and it has to actually vary per pixel
    expect(seedLine).toContain('Z_hash21');
  });

  test('centre weight uses each channel own diffusion distance', () => {
    const { burley } = buildPrograms('webgpu');
    // Regression guard: substituting the representative (widest) channel here
    // flattens the channel ratio, and because a smaller `d` concentrates more CDF
    // mass inside one texel it actually inverts it — red ends up holding the most
    // centre weight instead of the least, suppressing the channel that should
    // travel furthest. It has to use the same per-channel `d` as the kernel.
    const dLine = burley.split('\n').find((line) => line.includes('dPerChannel:'));
    expect(dLine).toBeDefined();
    expect(dLine).toContain('mfp.rgb');
    expect(dLine).not.toContain('lForSampling');
  });

  test('the bleed factor averages only over accepted taps', () => {
    const { burley } = buildPrograms('webgpu');
    // Regression guard: dividing the accumulated bleed by the total sample count
    // while the weighted mean is normalized by its own weight sum scales the
    // result by an unrelated factor. Near the silhouette, where most taps miss
    // the skin, that produced bright flickering specks.
    expect(burley).toContain('acceptedCount');
    const bleedLine = burley.split('\n').find((line) => line.includes('bleedAccum /'));
    expect(bleedLine).toBeDefined();
    expect(bleedLine).toContain('acceptedCount');
  });

  test('Burley reweights the centre sample by its CDF mass', () => {
    const { burley } = buildPrograms('webgpu');
    // The centre pixel accounts for the CDF up to a one-texel radius, so sampling
    // covers only [cdf, 1] and the centre is lerped back in afterwards.
    expect(burley).toContain('centerCdf');
    expect(burley).toContain('centerWeight');
    expect(burley).toContain('burleyCdf');
  });

  test('BVar pass is a passthrough (no velocity/shadow inputs yet)', () => {
    const { bvar } = buildPrograms('webgpu');
    expect(bvar).toContain('diffusedTex');
    // Transmission = 0 when velocity buffer and shadow map are unavailable
    expect(bvar).not.toContain('lumVariance');
    expect(bvar).not.toContain('thinness');
  });

  test('Recombine separates specular from diffuse via SceneColor.a', () => {
    const { recombine } = buildPrograms('webgpu');
    // UE5 mechanism: SceneColor.a holds the diffuse luminance, so the diffusible
    // fraction is that over the total luminance. The specular remainder must be
    // carried through unscattered.
    expect(recombine).toContain('diffAmt');
    expect(recombine).toContain('specKeep');
    expect(recombine).toContain('diffused');
  });

  test('scattered color comes from SceneColor, not a color side buffer', () => {
    const { recombine, burley } = buildPrograms('webgpu');
    expect(recombine).not.toContain('skinTex');
    expect(burley).not.toContain('skinTex');
    expect(burley).toContain('sceneTex');
  });

  test('Burley weights taps by normal agreement', () => {
    const { burley } = buildPrograms('webgpu');
    // sqrt(saturate(dot(nTap, nCenter) * 0.5 + 0.5)) — without it scattered light
    // crosses the nose wing, the lip seam and the silhouette.
    expect(burley).toContain('normalWeight');
    expect(burley).toContain('centerNormal');
    expect(burley).toContain('tapNormal');
  });

  test('Burley reads scattering parameters from the per-pixel profile table', () => {
    const { burley } = buildPrograms('webgpu');
    expect(burley).toContain('profileTex');
    expect(burley).toContain('readProfile');
    expect(burley).toContain('centerId');
  });

  test('Burley draws sample radii from the representative channel', () => {
    const { burley } = buildPrograms('webgpu');
    // UE5 keeps one representative albedo and mean free path in the `w` of each
    // row (GetComponentForScalingFactorEstimation / GetDiffuseMeanFreePathForSampling)
    // and evaluates all three channel kernels at those radii.
    expect(burley).toContain('aForSampling');
    expect(burley).toContain('lForSampling');
    expect(burley).toContain('albedo.w');
    expect(burley).toContain('mfp.w');
  });

  test('Burley tints cross-profile taps instead of rejecting them', () => {
    const { burley } = buildPrograms('webgpu');
    // A face/lip or face/ear boundary should soften, not seam.
    expect(burley).toContain('boundaryBleed');
    expect(burley).toContain('sameProfile');
    expect(burley).toContain('bleedAccum');
  });

  test('skin is identified by its own mask channel, never by SceneColor.a', () => {
    const { burley, recombine } = buildPrograms('webgpu');
    // Regression guard: every opaque material writes 1 to SceneColor.a, so
    // gating on it made the diffusion treat the background and the eyes as skin
    // and bleed scattered red onto them. Both passes must read maskTex instead.
    expect(burley).toContain('maskTex');
    expect(recombine).toContain('maskTex');
    expect(recombine).toContain('centerMask');
  });

  test('the profile id comes from the prepass, not from the mask alpha', () => {
    const { burley } = buildPrograms('webgpu');
    // The mask alpha is UE5's subsurface Opacity, a continuous 0..1 scattering
    // weight. It used to be multiplied by the profile id and the product had to
    // serve as both, which meant an opacity of 0.5 addressed a *different*
    // profile's row rather than scattering at half strength. The id now rides in
    // its own r8unorm target written by the depth prepass.
    expect(burley).toContain('profileIdTex');
    expect(burley).toContain('readProfileId');
    // Both ends of the kernel weight by opacity: the tap decides how much the
    // neighbourhood contributes, the centre how much this pixel accepts.
    expect(burley).toContain('tapOpacity');
  });

  test('Recombine does not read the diffusion alpha as a transmission term', () => {
    const { recombine } = buildPrograms('webgpu');
    // Regression guard: the diffusion buffer's alpha carries the profile id.
    // Reading it as transmission added `diffused * id/255` on top of every skin
    // pixel — energy from nothing, scaled by which table slot the profile
    // happened to occupy. UE5 gets transmission from the BxDF (shadow-map
    // optical depth), never from the diffusion passes.
    expect(recombine).not.toContain('transmission');
    expect(recombine).toContain('diffused');
  });

  test('every select() has its branches the right way round', () => {
    const { burley, recombine } = buildPrograms('webgpu');
    // `pb.select(x, y, cond)` follows the WGSL builtin: the **false** value comes
    // first, so it means `cond ? y : x`. It reads like a ternary and is not one,
    // and a type checker cannot tell the two apart — every use of it in this file
    // was inverted until the generated code was read back.
    //
    // What that cost: `tapOpacity` counted only the taps that landed where there
    // was *no* profile, so the diffusion accepted eyes and brows and rejected
    // skin, which zeroed the acceptance rate and quietly turned the whole pass
    // into an identity. `viewScale` made the sampling disc scale *with* camera
    // distance instead of against it. Both are checked here against the emitted
    // text, because that is the only place the argument order is visible.
    expect(burley).toContain('select(0.0,tapSample.a,tapId >');
    expect(burley).toMatch(/select\(centerDepth,1\.0,.*perspective == 0\)/);
    expect(burley).toMatch(/diffAmt: f32 = select\(1\.0,clamp\(scene\.a/);
    expect(recombine).toMatch(/diffAmt: f32 = select\(1\.0,clamp\(baseColor\.a/);
  });

  test('no legacy uniforms remain', () => {
    const { burley, recombine } = buildPrograms('webgpu');
    expect(recombine).not.toContain('smoothness');
    // The post effect exposes no knobs of its own: how far, how strongly and in
    // what colour the light scatters is entirely the SkinProfile's business, as
    // it is in UE5. A second set of multipliers on top of the profile could only
    // let the two disagree — `scatterRadius` in particular duplicated
    // `SkinProfile.worldUnitScale` in the diffusion but not on the transmission
    // LUT's distance axis, so turning it up silently decoupled the two.
    expect(recombine).not.toContain('scatterTint');
    expect(recombine).not.toContain('strength');
    expect(burley).not.toContain('radiusParams');
  });

  test('Recombine clamps against precision undershoot', () => {
    const { recombine } = buildPrograms('webgpu');
    expect(recombine).toMatch(/result = max\(.*vec3<f32>\(0\.0\)\)/);
  });
});
