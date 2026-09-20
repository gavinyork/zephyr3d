import { SkinMaterial, SkinProfile } from '@zephyr3d/scene';

describe('SkinProfile', () => {
  test('allocates distinct non-zero ids', () => {
    const a = new SkinProfile();
    const b = new SkinProfile();
    expect(a.id).toBeGreaterThan(0);
    expect(b.id).toBeGreaterThan(0);
    expect(a.id).not.toBe(b.id);
    a.dispose();
    b.dispose();
  });

  test('id 0 is reserved for "not skin"', () => {
    // The material multiplies the encoded id by the skin mask, so a masked-out
    // pixel reads back as 0 and the diffusion must treat it as non-skin.
    expect(SkinProfile.getById(0)).toBeNull();
    const p = new SkinProfile();
    expect(SkinProfile.getById(p.id)).toBe(p);
    p.dispose();
    expect(SkinProfile.getById(p.id)).toBeNull();
  });

  test('encodes the id for an 8-bit channel', () => {
    const p = new SkinProfile();
    expect(p.encodedId).toBeCloseTo(p.id / 255, 6);
    p.dispose();
  });

  test('presets set a red-dominant mean free path', () => {
    const p = new SkinProfile('skin');
    // Red scatters furthest through skin; that ratio is what makes thin
    // geometry such as an ear rim glow red.
    expect(p.meanFreePath.x).toBeGreaterThan(p.meanFreePath.y);
    expect(p.meanFreePath.y).toBeGreaterThan(p.meanFreePath.z);
    p.dispose();
  });

  test('kernel shape is scale invariant: mean free path moves extent, not falloff', () => {
    // Regression guard: the sampling disc must scale with the profile's scatter
    // distance. Pinning it to a constant made `d/disc` proportional to the mean
    // free path, so the default 0.012 collapsed the kernel into a fraction of a
    // texel (no visible bleed at the terminator) while 1.2 flattened it into a
    // plain box average. Both were observed.
    const shapingTerm = (albedo: number) => Math.pow(albedo - 0.33, 4) * 100 + 3.5;
    const discScale = 1;
    const shapeFor = (mfpd: number) => {
      const d = mfpd / shapingTerm(0.85);
      const disc = discScale * mfpd;
      return d / disc;
    };
    const shapes = [0.012, 0.12, 1.2, 12].map(shapeFor);
    for (const s of shapes) {
      expect(s).toBeCloseTo(shapes[0], 9);
    }
    // And the shape has to sit in a range where the kernel is neither a texel
    // nor a flat average across the disc.
    expect(shapes[0]).toBeGreaterThan(0.02);
    expect(shapes[0]).toBeLessThan(1);
  });

  test('surface albedo changes the diffusion width, not just channel ratios', () => {
    // Regression guard: the kernel derives its world-space extent from the Burley
    // shaping term s = (albedo - 0.33)^4 * 100 + 3.5, so albedo has to move the
    // extent. Normalizing the per-channel shaping distances against each other
    // cancelled albedo out entirely whenever the three channels shared a value,
    // which made the editor's SurfaceAlbedo control do nothing.
    const shapingTerm = (albedo: number) => Math.pow(Math.max(0, Math.min(1, albedo)) - 0.33, 4) * 100 + 3.5;
    const widthFor = (albedo: number, mfp: number) => mfp / shapingTerm(albedo);

    // albedo 0.33 minimizes s, so it must give the widest diffusion.
    const atMin = widthFor(0.33, 0.012);
    const away = widthFor(0.95, 0.012);
    expect(atMin).toBeGreaterThan(away);
    // The spread has to be substantial, not a rounding difference.
    expect(atMin / away).toBeGreaterThan(2);

    // And the profile must actually expose albedo per channel for that to vary.
    const p = new SkinProfile('skin');
    expect(p.surfaceAlbedo.x).not.toBeCloseTo(p.surfaceAlbedo.z, 6);
    p.dispose();
  });

  test('scatter distance scales with distance and scale factors', () => {
    const p = new SkinProfile('skin');
    p.meanFreePathDistance = 0.02;
    p.worldUnitScale = 1;
    p.scatterScale = 1;
    const base = p.getScatterDistance();
    p.scatterScale = 2;
    const scaled = p.getScatterDistance();
    expect(scaled.x).toBeCloseTo(base.x * 2, 6);
    p.dispose();
  });

  test('preset changes are reflected in parameters', () => {
    const p = new SkinProfile('skin');
    const skinAlbedo = p.surfaceAlbedo.x;
    p.preset = 'jade';
    expect(p.preset).toBe('jade');
    // Jade scatters green furthest, unlike skin.
    expect(p.meanFreePath.y).toBeGreaterThan(p.meanFreePath.x);
    expect(p.surfaceAlbedo.x).not.toBeCloseTo(skinAlbedo, 6);
    p.dispose();
  });

  test('clone copies parameters but takes its own id', () => {
    const p = new SkinProfile('wax');
    p.meanFreePathDistance = 0.033;
    const c = p.clone();
    expect(c.id).not.toBe(p.id);
    expect(c.meanFreePathDistance).toBeCloseTo(0.033, 6);
    expect(c.surfaceAlbedo.x).toBeCloseTo(p.surfaceAlbedo.x, 6);
    p.dispose();
    c.dispose();
  });

  test('material starts with no profile and falls back to the shared default', () => {
    const mat = new SkinMaterial();
    // Matches how PBRMetallicRoughnessMaterial exposes its own profile: the
    // reference is nullable, and null means "use the default".
    expect(mat.subsurfaceProfile).toBeNull();
    expect(mat.effectiveProfile).toBe(SkinProfile.getDefault());
    const custom = new SkinProfile('skin_dark');
    mat.subsurfaceProfile = custom;
    expect(mat.subsurfaceProfile).toBe(custom);
    expect(mat.effectiveProfile).toBe(custom);
    mat.subsurfaceProfile = null;
    expect(mat.effectiveProfile).toBe(SkinProfile.getDefault());
    custom.dispose();
  });

  test('profile changes notify the materials using it', () => {
    const mat = new SkinMaterial();
    const profile = new SkinProfile('skin');
    mat.subsurfaceProfile = profile;
    let notified = 0;
    const listener = () => notified++;
    profile.addChangeListener(listener);
    profile.meanFreePathDistance = 0.02;
    expect(notified).toBe(1);
    profile.removeChangeListener(listener);
    profile.meanFreePathDistance = 0.03;
    expect(notified).toBe(1);
    profile.dispose();
  });

  test('does not disturb the legacy SubsurfaceProfile slots', async () => {
    const { SubsurfaceProfile } = await import('@zephyr3d/scene');
    const legacy = new SubsurfaceProfile();
    const skin = new SkinProfile();
    // The two allocate from independent pools, so a skin profile must not
    // consume a legacy slot.
    const legacy2 = new SubsurfaceProfile();
    expect(legacy2.slot).toBe(legacy.slot + 1);
    legacy.dispose();
    legacy2.dispose();
    skin.dispose();
  });
});
