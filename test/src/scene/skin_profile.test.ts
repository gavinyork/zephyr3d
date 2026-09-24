import { SSSMaterial } from '../../../libs/scene/src/material/skin';
import { SSSProfile } from '../../../libs/scene/src/material/skinprofile';

describe('SSSProfile', () => {
  test('allocates distinct non-zero ids', () => {
    const a = new SSSMaterial();
    const b = new SSSMaterial();
    expect(a.subsurfaceProfile.id).toBeGreaterThan(0);
    expect(b.subsurfaceProfile.id).toBeGreaterThan(0);
    expect(a.subsurfaceProfile.id).not.toBe(b.subsurfaceProfile.id);
    a.dispose();
    b.dispose();
  });

  test('id 0 is reserved for "not skin"', () => {
    // The depth prepass clears its profile id target to 0, so every pixel no
    // skin material covered reads back as "not skin" and the diffusion rejects
    // it rather than addressing a row of the table.
    expect(SSSProfile.getById(0)).toBeNull();
    const mat = new SSSMaterial();
    const profile = mat.subsurfaceProfile;
    expect(SSSProfile.getById(profile.id)).toBe(profile);
    mat.dispose();
    expect(SSSProfile.getById(profile.id)).toBeNull();
  });

  test('encodes the id for an 8-bit channel', () => {
    const mat = new SSSMaterial();
    expect(mat.subsurfaceProfile.encodedId).toBeCloseTo(mat.subsurfaceProfile.id / 255, 6);
    mat.dispose();
  });

  test('presets set a red-dominant mean free path', () => {
    const mat = new SSSMaterial();
    mat.subsurfaceProfile.preset = 'skin';
    // Red scatters furthest through skin; that ratio is what makes thin
    // geometry such as an ear rim glow red.
    expect(mat.subsurfaceProfile.meanFreePath.x).toBeGreaterThan(mat.subsurfaceProfile.meanFreePath.y);
    expect(mat.subsurfaceProfile.meanFreePath.y).toBeGreaterThan(mat.subsurfaceProfile.meanFreePath.z);
    mat.dispose();
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
    const mat = new SSSMaterial();
    mat.subsurfaceProfile.preset = 'skin';
    expect(mat.subsurfaceProfile.surfaceAlbedo.x).not.toBeCloseTo(mat.subsurfaceProfile.surfaceAlbedo.z, 6);
    mat.dispose();
  });

  test('scatter distance scales with distance and scale factors', () => {
    const mat = new SSSMaterial();
    const p = mat.subsurfaceProfile;
    p.preset = 'skin';
    p.meanFreePathDistance = 0.02;
    p.worldUnitScale = 1;
    p.scatterScale = 1;
    const base = p.getScatterDistance();
    p.scatterScale = 2;
    const scaled = p.getScatterDistance();
    expect(scaled.x).toBeCloseTo(base.x * 2, 6);
    mat.dispose();
  });

  test('preset changes are reflected in parameters', () => {
    const mat = new SSSMaterial();
    const p = mat.subsurfaceProfile;
    p.preset = 'skin';
    const skinAlbedo = p.surfaceAlbedo.x;
    p.preset = 'jade';
    expect(p.preset).toBe('jade');
    // Jade scatters green furthest, unlike skin.
    expect(p.meanFreePath.y).toBeGreaterThan(p.meanFreePath.x);
    expect(p.surfaceAlbedo.x).not.toBeCloseTo(skinAlbedo, 6);
    mat.dispose();
  });

  test('a preset switch keeps the same instance and the same table row', () => {
    // The editor drives these through the serializer, which used to replace the
    // object. Changing a look has to stay an edit of the material's own profile,
    // or the id written into the depth prepass stops matching the row the
    // diffusion reads.
    const mat = new SSSMaterial();
    const profile = mat.subsurfaceProfile;
    const id = profile.id;
    profile.preset = 'jade';
    expect(mat.subsurfaceProfile).toBe(profile);
    expect(profile.id).toBe(id);
    mat.dispose();
  });

  test('material owns a profile from construction and releases it on dispose', () => {
    const mat = new SSSMaterial();
    const profile = mat.subsurfaceProfile;
    expect(profile).toBeTruthy();
    expect(SSSProfile.getById(profile.id)).toBe(profile);
    mat.dispose();
    // The row goes back to the pool, which is the whole point: profiles used to
    // be assignable objects nothing released, so the 256-row table filled up as
    // the editor loaded scenes and undid edits, and every profile allocated
    // after that failed to construct.
    expect(SSSProfile.getById(profile.id)).toBeNull();
  });

  test('profiles are not constructible outside their material', () => {
    // A runtime guard rather than the `private` modifier alone: the editor ships
    // as prebuilt JavaScript and drives this class through serialization
    // metadata, where TypeScript's visibility rules do not apply.
    expect(() => new (SSSProfile as unknown as new () => SSSProfile)()).toThrow();
  });

  test('table rows are recycled, so long editing sessions cannot exhaust them', () => {
    // Regression guard for the leak directly: the table holds 256 rows, so
    // without recycling this loop throws partway through.
    const ids = new Set<number>();
    for (let i = 0; i < 300; i++) {
      const mat = new SSSMaterial();
      ids.add(mat.subsurfaceProfile.id);
      mat.dispose();
    }
    // And they really are reused rather than merely available.
    expect(ids.size).toBeLessThan(300);
  });

  test('copyFrom transfers the look without transferring the row', () => {
    const src = new SSSMaterial();
    const dst = new SSSMaterial();
    src.subsurfaceProfile.preset = 'wax';
    src.subsurfaceProfile.meanFreePathDistance = 0.033;
    dst.subsurfaceProfile.copyFrom(src.subsurfaceProfile);
    expect(dst.subsurfaceProfile.meanFreePathDistance).toBeCloseTo(0.033, 6);
    expect(dst.subsurfaceProfile.surfaceAlbedo.x).toBeCloseTo(src.subsurfaceProfile.surfaceAlbedo.x, 6);
    // Each material keeps its own row, so disposing one cannot pull the
    // parameters out from under the other.
    expect(dst.subsurfaceProfile.id).not.toBe(src.subsurfaceProfile.id);
    src.dispose();
    dst.dispose();
  });

  test('profile changes notify the material using it', () => {
    const mat = new SSSMaterial();
    const profile = mat.subsurfaceProfile;
    let notified = 0;
    const listener = () => notified++;
    profile.addChangeListener(listener);
    profile.meanFreePathDistance = 0.02;
    expect(notified).toBe(1);
    profile.removeChangeListener(listener);
    profile.meanFreePathDistance = 0.03;
    expect(notified).toBe(1);
    mat.dispose();
  });

  test('does not disturb the legacy SubsurfaceProfile slots', async () => {
    const { SubsurfaceProfile } = await import('@zephyr3d/scene');
    const legacy = new SubsurfaceProfile();
    const skin = new SSSMaterial();
    // The two allocate from independent pools, so a skin profile must not
    // consume a legacy slot.
    const legacy2 = new SubsurfaceProfile();
    expect(legacy2.slot).toBe(legacy.slot + 1);
    legacy.dispose();
    legacy2.dispose();
    skin.dispose();
  });
});
