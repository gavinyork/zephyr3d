import { ProgramBuilder } from '../../../libs/device/src';
import { ShaderHelper } from '../../../libs/scene/src/material/shader/helper';
import { LIGHT_TYPE_DIRECTIONAL, LIGHT_TYPE_SPOT } from '../../../libs/scene/src/values';

/**
 * Shader-level cover for the normal offset.
 *
 * The unit test alongside this one pins the CPU-side packing of
 * `depthBiasValues.y`; this one pins that the shader actually spends it - that
 * the offset is bounded by `sin(theta)` rather than the unbounded `tan(theta)`
 * a depth bias would need, and that the result is added to the receiver
 * position instead of to its depth.
 */
function buildOffsetShader(lightType: number, withCascadeScale: boolean) {
  const device: any = { type: 'webgpu' };
  const builder = new ProgramBuilder(device);
  const result = builder.buildRender({
    vertex(pb) {
      this.$inputs.pos = pb.vec3().attrib('position');
      pb.main(function () {
        this.$builtins.position = pb.vec4(this.$inputs.pos, 1);
      });
    },
    fragment(pb) {
      // Field-for-field the subset of helper.ts's light struct that the offset
      // reads.
      const lightStruct = pb.defineStruct([
        pb.vec4('depthBiasValues'),
        pb.vec4('depthBiasScales'),
        pb.vec4('positionAndRange')
      ]);
      this.light = lightStruct().uniform(0);
      this.$outputs.color = pb.vec4();
      pb.main(function () {
        this.$l.worldPos = pb.vec3(1, 2, 3);
        this.$l.worldNormal = pb.vec3(0, 1, 0);
        this.$l.NoL = pb.float(0.25);
        // The suite builds against libs/device/src while the scene package
        // resolves @zephyr3d/device to libs/device/dist. The scope types are
        // structurally identical but nominally distinct, hence the cast.
        this.$l.biased = ShaderHelper.applyShadowNormalOffset(
          lightType,
          this as any,
          this.worldPos,
          this.worldNormal,
          this.NoL,
          withCascadeScale ? this.light.depthBiasScales.x : undefined
        );
        this.$outputs.color = pb.vec4(this.biased, 1);
      });
    }
  });
  if (!result) {
    throw new Error(builder.lastError ?? 'normal offset shader generation failed');
  }
  return result[1];
}

describe('shadow normal offset shader', () => {
  test('scales the offset by sin(theta) and displaces the position', () => {
    const source = buildOffsetShader(LIGHT_TYPE_DIRECTIONAL, false);
    // sqrt(1 - NoL*NoL) is sin(theta): zero facing the light, one at grazing.
    // A tan(theta) formulation would diverge exactly where the acne is worst.
    expect(source).toContain('sqrt(clamp(1.0 - (NoL * NoL),0.0,1.0))');
    // The offset must displace the position, not the compared depth, and it is
    // spent out of depthBiasValues.y.
    expect(source).toMatch(/biased: vec3<f32> = worldPos \+ /);
    expect(source).toContain('light.depthBiasValues.y');
  });

  test('a degenerate normal cannot produce NaN', () => {
    // normalize() of a zero-length interpolated normal would poison the whole
    // shadow lookup; the guarded reciprocal keeps it finite.
    expect(buildOffsetShader(LIGHT_TYPE_DIRECTIONAL, false)).toContain(
      '1.0 / max(length(worldNormal),0.000001)'
    );
  });

  test('directional lights skip the perspective footprint scaling', () => {
    const directional = buildOffsetShader(LIGHT_TYPE_DIRECTIONAL, false);
    const spot = buildOffsetShader(LIGHT_TYPE_SPOT, false);
    // Only the perspective path needs the light position, to derive a depth
    // proxy for the far/near footprint ratio. Match the access rather than the
    // struct field, which is declared either way.
    expect(directional).not.toContain('light.positionAndRange');
    expect(spot).toContain('light.positionAndRange');
    expect(spot).toContain('light.depthBiasValues.w');
  });

  test('applies a per-cascade scale when one is supplied', () => {
    expect(buildOffsetShader(LIGHT_TYPE_DIRECTIONAL, false)).not.toContain('light.depthBiasScales');
    expect(buildOffsetShader(LIGHT_TYPE_DIRECTIONAL, true)).toContain('light.depthBiasScales.x');
  });
});
