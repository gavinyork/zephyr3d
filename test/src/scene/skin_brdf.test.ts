import { SSSMaterial } from '../../../libs/scene/src/material/skin';

/**
 * These pin the direct-lighting BRDF against UE5's `SubsurfaceProfileBxDF`.
 *
 * The values are computed here rather than read out of the shader, because the
 * defect this guards against was a *formula* that looked plausible and compiled
 * fine: the previous implementation used a self-invented curvature-driven wrapped
 * diffuse with no counterpart in UE5.
 */
describe('Skin BRDF', () => {
  const pow5 = (x: number) => x * x * x * x * x;

  /** `Diffuse_Burley` from UE5's BRDF.ush, without the albedo factor. */
  const burley = (NoV: number, NoL: number, VoH: number, roughness: number) => {
    const fd90 = 0.5 + 2 * VoH * VoH * roughness;
    const fdV = 1 + (fd90 - 1) * pow5(1 - NoV);
    const fdL = 1 + (fd90 - 1) * pow5(1 - NoL);
    return (1 / Math.PI) * fdV * fdL;
  };

  test('diffuse reduces to Lambert at normal incidence', () => {
    // With NoV = NoL = 1 both Fresnel factors vanish and only 1/PI remains,
    // whatever the roughness. A wrapped-diffuse formulation does not do this.
    for (const roughness of [0, 0.35, 1]) {
      expect(burley(1, 1, 1, roughness)).toBeCloseTo(1 / Math.PI, 9);
    }
  });

  test('diffuse retro-reflection grows with roughness', () => {
    // FD90 rises with roughness, so grazing angles brighten. This is the whole
    // point of Burley over Lambert.
    const grazing = (roughness: number) => burley(0.2, 0.2, 0.9, roughness);
    expect(grazing(1)).toBeGreaterThan(grazing(0.35));
    expect(grazing(0.35)).toBeGreaterThan(grazing(0));
  });

  test('diffuse is symmetric in view and light', () => {
    // Helmholtz reciprocity: swapping NoV and NoL must not change the result.
    expect(burley(0.3, 0.8, 0.5, 0.4)).toBeCloseTo(burley(0.8, 0.3, 0.5, 0.4), 9);
  });

  /**
   * `GetSubsurfaceProfileDualSpecular` from UE5.
   *
   * The profile values are direct multipliers on the material roughness, authored
   * in 0.5..2.0. UE5's `SSSS_MAX_DUAL_SPECULAR_ROUGHNESS` does not appear here:
   * it only undoes the profile texture's encoding, which divides by 2 on pack and
   * multiplies by 2 on read.
   */
  const lobes = (roughness: number, opacity: number, d0: number, d1: number) => {
    const fade = Math.min(1, Math.max(0, (opacity - 0.1) * 10));
    const s0 = 1 + (d0 - 1) * fade;
    const s1 = 1 + (d1 - 1) * fade;
    return [Math.max(Math.min(roughness * s0, 1), 0.02), Math.min(roughness * s1, 1)];
  };

  test('lobe roughness scales the material roughness directly', () => {
    // UE5 defaults: the narrow lobe tightens to 0.75x, the wide one broadens to 1.3x.
    const [narrow, wide] = lobes(0.35, 1, 0.75, 1.3);
    expect(narrow).toBeCloseTo(0.35 * 0.75, 6);
    expect(wide).toBeCloseTo(0.35 * 1.3, 6);
    expect(narrow).toBeLessThan(0.35);
    expect(wide).toBeGreaterThan(0.35);
  });

  test('the dual lobe fades out at low opacity', () => {
    // Below the threshold both lobes collapse onto the material roughness, so a
    // non-skin pixel is shaded like an ordinary surface.
    const [narrow, wide] = lobes(0.35, 0.1, 0.75, 1.3);
    expect(narrow).toBeCloseTo(0.35, 6);
    expect(wide).toBeCloseTo(0.35, 6);
  });

  test('only the narrow lobe is floored', () => {
    // The floor keeps the tight highlight from collapsing into a firefly; the
    // wide lobe has no such risk and UE5 leaves it unclamped at the bottom.
    const [narrow, wide] = lobes(0.005, 1, 0.75, 1.3);
    expect(narrow).toBeCloseTo(0.02, 6);
    expect(wide).toBeLessThan(0.02);
  });

  test('preset lobe values sit in UE5 authored range', () => {
    // Regression guard: applying SSSS_MAX_DUAL_SPECULAR_ROUGHNESS on top of these
    // doubles every lobe and saturates the wide one at moderate roughness, which
    // flattens the highlight away.
    for (const preset of ['skin', 'skin_pale', 'skin_tan', 'skin_dark'] as const) {
      const mat = new SSSMaterial();
      const p = mat.subsurfaceProfile;
      p.preset = preset;
      expect(p.roughness0).toBeGreaterThanOrEqual(0.5);
      expect(p.roughness0).toBeLessThanOrEqual(2);
      expect(p.roughness1).toBeGreaterThanOrEqual(0.5);
      expect(p.roughness1).toBeLessThanOrEqual(2);
      // Narrow must stay tighter than wide, or the two lobes swap roles.
      expect(p.roughness0).toBeLessThan(p.roughness1);
      const [narrow, wide] = lobes(0.35, 1, p.roughness0, p.roughness1);
      expect(narrow).toBeLessThan(wide);
      expect(wide).toBeLessThan(1);
      mat.dispose();
    }
  });

  /**
   * `ComputeFresnelEnergyTerms` over the analytic directional-albedo fit from
   * UE5's `ShadingEnergyConservation.ush` (`USE_ENERGY_CONSERVATION == 2`).
   */
  const energy = (roughness: number, NoV: number, F0: number) => {
    const r = Math.max(roughness, 1e-3);
    const c = Math.max(NoV, 1e-3);
    let E = 1 - Math.min(1, Math.max(0, Math.pow(r, c / r) * ((r * c + 0.0266916) / (0.466495 + c))));
    E = Math.max(E, 1e-4);
    const Ef = pow5(1 - c) * Math.pow(2.36651 * Math.pow(c, 4.7703 * r) + 0.0387332, r);
    const F90 = Math.min(1, Math.max(0, 50 * F0));
    const W = 1 + F0 * ((1 - E) / E);
    const A = Math.min(1, Math.max(0, W * (E * F0 + Ef * (F90 - F0))));
    return { specularGain: W, diffuseAttenuation: 1 - A };
  };

  test('energy compensation never removes energy from specular', () => {
    // W restores what single-scattering GGX dropped, so it can only add.
    for (const r of [0.05, 0.2, 0.5, 0.8, 1]) {
      for (const c of [0.05, 0.3, 0.7, 1]) {
        expect(energy(r, c, 0.04).specularGain).toBeGreaterThanOrEqual(1 - 1e-6);
      }
    }
  });

  test('specular compensation grows with roughness', () => {
    // Smooth surfaces lose almost nothing; rough ones lose enough to matter.
    const smooth = energy(0.05, 1, 0.04).specularGain;
    const rough = energy(1, 1, 0.04).specularGain;
    expect(smooth).toBeCloseTo(1, 3);
    expect(rough).toBeGreaterThan(1.05);
  });

  test('diffuse is attenuated by what the specular layer reflected', () => {
    // At F0 = 0.04 roughly 4% is reflected away head-on, so the diffuse keeps ~96%.
    const { diffuseAttenuation } = energy(0.375, 1, 0.04);
    expect(diffuseAttenuation).toBeLessThan(1);
    expect(diffuseAttenuation).toBeGreaterThan(0.9);
  });

  test('energy terms stay in range over the whole parameter space', () => {
    for (let r = 0.02; r <= 1; r += 0.07) {
      for (let c = 0.02; c <= 1; c += 0.07) {
        const { specularGain, diffuseAttenuation } = energy(r, c, 0.04);
        expect(Number.isFinite(specularGain)).toBe(true);
        expect(diffuseAttenuation).toBeGreaterThanOrEqual(0);
        expect(diffuseAttenuation).toBeLessThanOrEqual(1);
      }
    }
  });

  test('material defaults match UE5', () => {
    const mat = new SSSMaterial();
    // UE5's material defaults: Roughness 0.5, Specular 0.5, and
    // F0 = DielectricSpecularToF0(Specular) = 0.08 * 0.5.
    expect(mat.roughness).toBeCloseTo(0.5, 6);
    expect(mat.specularF0).toBeCloseTo(0.04, 6);
  });

  test('default roughness keeps both lobes off the clamps', () => {
    const mat = new SSSMaterial();
    const p = mat.subsurfaceProfile;
    const [narrow, wide] = lobes(mat.roughness, 1, p.roughness0, p.roughness1);
    expect(narrow).toBeGreaterThan(0.02);
    expect(wide).toBeLessThan(1);
    // And the two stay distinguishable, which is the point of the dual lobe.
    expect(wide - narrow).toBeGreaterThan(0.1);
    mat.dispose();
  });
});
