import { MemoryFS } from '@zephyr3d/base';
import { PBRMetallicRoughnessMaterial, ResourceManager, SubsurfaceProfile } from '@zephyr3d/scene';

type SpecularDetailProfile = SubsurfaceProfile & {
  specularDetailSoftness: number;
  specularDetailRadius: number;
};

describe('Subsurface profile specular detail', () => {
  test('uses a skin-focused specular detail preset by default', () => {
    const profile = new SubsurfaceProfile() as SpecularDetailProfile;

    expect(profile.preset).toBe('skin_default');
    expect(profile.specularDetailSoftness).toBeCloseTo(0.78);
    expect(profile.specularDetailRadius).toBeCloseTo(1.8);

    profile.preset = 'skin_heavy_makeup';
    expect(profile.specularDetailSoftness).toBeCloseTo(0.86);
    expect(profile.specularDetailRadius).toBeCloseTo(2.1);
  });

  test('clamps and preserves authored specular detail controls', async () => {
    const manager = new ResourceManager(new MemoryFS());
    const source = new SubsurfaceProfile() as SpecularDetailProfile;
    source.specularDetailSoftness = 1.5;
    source.specularDetailRadius = 8;

    expect(source.specularDetailSoftness).toBe(1);
    expect(source.specularDetailRadius).toBe(4);

    source.specularDetailSoftness = 0.63;
    source.specularDetailRadius = 2.4;
    const props = await manager.serializeObjectProps(source);
    expect(props.SpecularDetailSoftness).toBeCloseTo(0.63);
    expect(props.SpecularDetailRadius).toBeCloseTo(2.4);

    const restored = new SubsurfaceProfile() as SpecularDetailProfile;
    await manager.deserializeObjectProps(restored, props);
    expect(restored.specularDetailSoftness).toBeCloseTo(0.63);
    expect(restored.specularDetailRadius).toBeCloseTo(2.4);
  });
});

describe('Subsurface transmission authoring', () => {
  test('does not infer thin transmission from a subsurface profile alone', () => {
    const material = new PBRMetallicRoughnessMaterial();
    const profile = buildSubsurfaceProfile(material);

    expect(profile[0]).toBeGreaterThan(0);
    expect(profile[1]).toBeGreaterThan(0);
    expect(profile[2]).toBeGreaterThan(0);
    expect(profile[3]).toBe(0);
  });

  test('treats the thickness texture G channel as thin-to-thick coverage', () => {
    const material = new PBRMetallicRoughnessMaterial();
    material.thicknessTexture = fakeTexture() as any;
    const sample = { g: 0 };
    (material as any).sampleThicknessTexture = () => sample;

    expect(buildSubsurfaceProfile(material)[3]).toBe(1);
    sample.g = 1;
    expect(buildSubsurfaceProfile(material)[3]).toBe(0);
  });

  test('scales an authored transmission texture by the material transmission factor', () => {
    const material = new PBRMetallicRoughnessMaterial();
    material.transmissionTexture = fakeTexture() as any;
    (material as any).sampleTransmissionTexture = () => ({ r: 0.5 });

    expect(buildSubsurfaceProfile(material, 0.4)[3]).toBeCloseTo(0.2);
  });
});

function buildSubsurfaceProfile(material: PBRMetallicRoughnessMaterial, transmissionFactor = 0) {
  const locals: Record<string, unknown> = {};
  const builder = {
    float: (value = 0) => value,
    add: (...values: number[]) => values.reduce((sum, value) => sum + value, 0),
    sub: (left: number, right: number) => left - right,
    mul: (...values: number[]) => values.reduce((product, value) => product * value, 1),
    div: (left: number, right: number) => left / right,
    max: (...values: number[]) => Math.max(...values),
    clamp: (value: number, min: number, max: number) => Math.min(max, Math.max(min, value)),
    vec4: (...values: number[]) => values
  };
  const target: Record<string, any> = {
    $builder: builder,
    $l: locals,
    zSubsurfaceProfileId: 1,
    zSubsurfaceProfileScale: 0.96,
    zSubsurfaceProfileStrength: 0.82,
    zSubsurfaceProfilePreset: 1,
    zTransmissionFactor: transmissionFactor
  };
  const scope = new Proxy(target, {
    get(object, property) {
      return property in object ? object[property as string] : locals[property as string];
    }
  });
  return (material as any).buildSubsurfaceProfile(scope) as number[];
}

function fakeTexture() {
  return { getDefaultSampler: () => null };
}
