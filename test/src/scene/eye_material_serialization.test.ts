import { MemoryFS, Vector4 } from '@zephyr3d/base';
import { EyeMaterial, ResourceManager } from '../../../libs/scene/src';

describe('Eye material serialization', () => {
  test('round-trips EyeMaterial properties', async () => {
    const manager = new ResourceManager(new MemoryFS());
    const material = new EyeMaterial();

    material.irisCenter = new Vector4(0.48, 0.52, 0, 0);
    material.irisRadius = 0.19;
    material.irisDepth = 0.072;
    material.ior = 1.41;
    material.pupilRadius = 0.28;
    material.pupilDilation = 0.6;
    material.irisColor = new Vector4(0.85, 0.92, 1, 1);
    material.irisBrightness = 0.22;
    material.limbalRingWidth = 0.041;
    material.limbalRingStrength = 0.85;
    material.scleraColor = new Vector4(0.94, 0.91, 0.87, 1);
    material.scleraWrap = 0.44;
    material.scleraEdgeTint = new Vector4(0.6, 0.25, 0.2, 0.8);
    material.corneaSpecularStrength = 1.4;
    material.corneaRoughness = 0.03;
    material.vertexTangent = true;

    const serialized = await manager.serializeObject(material);
    const restored = (await manager.deserializeObject<EyeMaterial>(null, serialized))!;

    expect(serialized.ClassName).toBe('EyeMaterial');
    const serializedObject = serialized.Object as Record<string, any>;
    expect(serializedObject).toMatchObject({
      IrisRadius: 0.19,
      IOR: 1.41,
      PupilRadius: 0.28,
      PupilDilation: 0.6,
      LimbalRingStrength: 0.85,
      CorneaSpecularStrength: 1.4,
      vertexTangent: true
    });

    expect(restored).toBeInstanceOf(EyeMaterial);
    expect(restored.irisCenter.x).toBeCloseTo(0.48);
    expect(restored.irisCenter.y).toBeCloseTo(0.52);
    expect(restored.irisRadius).toBeCloseTo(0.19);
    expect(restored.irisDepth).toBeCloseTo(0.072);
    expect(restored.ior).toBeCloseTo(1.41);
    expect(restored.pupilRadius).toBeCloseTo(0.28);
    expect(restored.pupilDilation).toBeCloseTo(0.6);
    expect(restored.irisColor.x).toBeCloseTo(0.85);
    expect(restored.irisColor.y).toBeCloseTo(0.92);
    expect(restored.irisColor.z).toBeCloseTo(1);
    expect(restored.irisBrightness).toBeCloseTo(0.22);
    expect(restored.limbalRingWidth).toBeCloseTo(0.041);
    expect(restored.limbalRingStrength).toBeCloseTo(0.85);
    expect(restored.scleraColor.x).toBeCloseTo(0.94);
    expect(restored.scleraWrap).toBeCloseTo(0.44);
    expect(restored.scleraEdgeTint.x).toBeCloseTo(0.6);
    expect(restored.scleraEdgeTint.w).toBeCloseTo(0.8);
    expect(restored.corneaSpecularStrength).toBeCloseTo(1.4);
    expect(restored.corneaRoughness).toBeCloseTo(0.03);
    expect(restored.vertexTangent).toBe(true);
  });

  test('a material left at its defaults round-trips unchanged', async () => {
    // Guards the failure mode that bit doubleSidedLighting: when a property's
    // declared default disagrees with what the constructor sets, the serializer
    // omits the value on save and then restores the *other* one on load. Nothing
    // looks wrong until an existing asset silently changes appearance.
    const manager = new ResourceManager(new MemoryFS());
    const fresh = new EyeMaterial();
    const serialized = await manager.serializeObject(fresh);
    const restored = (await manager.deserializeObject<EyeMaterial>(null, serialized))!;

    expect(restored.irisCenter.x).toBeCloseTo(fresh.irisCenter.x);
    expect(restored.irisCenter.y).toBeCloseTo(fresh.irisCenter.y);
    expect(restored.irisRadius).toBeCloseTo(fresh.irisRadius);
    expect(restored.irisDepth).toBeCloseTo(fresh.irisDepth);
    expect(restored.ior).toBeCloseTo(fresh.ior);
    expect(restored.pupilRadius).toBeCloseTo(fresh.pupilRadius);
    expect(restored.pupilDilation).toBeCloseTo(fresh.pupilDilation);
    expect(restored.irisBrightness).toBeCloseTo(fresh.irisBrightness);
    expect(restored.limbalRingWidth).toBeCloseTo(fresh.limbalRingWidth);
    expect(restored.limbalRingStrength).toBeCloseTo(fresh.limbalRingStrength);
    expect(restored.scleraWrap).toBeCloseTo(fresh.scleraWrap);
    expect(restored.corneaSpecularStrength).toBeCloseTo(fresh.corneaSpecularStrength);
    expect(restored.corneaRoughness).toBeCloseTo(fresh.corneaRoughness);
    expect(restored.vertexTangent).toBe(fresh.vertexTangent);
    expect(restored.scleraColor.x).toBeCloseTo(fresh.scleraColor.x);
    expect(restored.scleraEdgeTint.x).toBeCloseTo(fresh.scleraEdgeTint.x);
    expect(restored.irisColor.x).toBeCloseTo(fresh.irisColor.x);
  });
});
