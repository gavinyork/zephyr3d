/**
 * Shader-level checks for the water body's directional in-scattering.
 *
 * Nothing here renders. The value is in getting the shader builder to emit
 * source for both backends: the term lives inside the water material's light
 * loop, so a mistake in it surfaces as a shader compile failure at runtime,
 * which no other test would catch. The numeric behaviour of the integral is
 * checked against a reference quadrature separately, in plain arithmetic.
 */

import type { AbstractDevice, PBGlobalScope, PBInsideFunctionScope, PBShaderExp } from '@zephyr3d/device';
import { ProgramBuilder } from '@zephyr3d/device';
import { WaterMaterial } from '../../../libs/scene/src/material/water';

const DEVICE_TYPES = ['webgpu', 'webgl2'] as const;

function createMockDevice(type: (typeof DEVICE_TYPES)[number]): AbstractDevice {
  return {
    type,
    clipSpaceZeroToOne: type === 'webgpu',
    getDeviceCaps() {
      return {
        shaderCaps: {
          supportShaderF16: false
        }
      };
    }
  } as unknown as AbstractDevice;
}

/**
 * Builds a fragment shader calling the in-scattering term.
 *
 * The uniforms the term reads are declared by hand rather than by running the
 * material's own `fragmentShader`, which would drag in the whole lit mixin,
 * the wave generator and a draw context. What is under test is the emitted
 * function body.
 */
function buildScatteringShader(type: (typeof DEVICE_TYPES)[number]) {
  const pb = new ProgramBuilder(createMockDevice(type));
  const material = new (WaterMaterial as unknown as new () => WaterMaterial)();
  return pb.buildRender({
    vertex(pb) {
      this.$inputs.pos = pb.vec3().attrib('position');
      pb.main(function () {
        this.$builtins.position = pb.vec4(this.$inputs.pos, 1);
      });
    },
    fragment(this: PBGlobalScope, pb) {
      this.mediumAlbedo = pb.vec3().uniform(0);
      this.mediumExtinction = pb.vec3().uniform(0);
      this.sunScatterParams = pb.vec4().uniform(0);
      this.lightEnergy = pb.vec3().uniform(0);
      this.lightDir = pb.vec3().uniform(0);
      this.eyeVecNorm = pb.vec3().uniform(0);
      this.geom = pb.vec2().uniform(0);
      this.foam = pb.float().uniform(0);
      this.$outputs.color = pb.vec4();
      pb.main(function (this: PBInsideFunctionScope) {
        const scattered = material.waterSunScattering(
          this,
          this.lightEnergy,
          this.lightDir,
          this.eyeVecNorm,
          this.geom.x,
          this.geom.y,
          this.foam
        ) as PBShaderExp;
        this.$outputs.color = pb.vec4(scattered, 1);
      });
    }
  });
}

describe('water sun in-scattering shader', () => {
  test.each(DEVICE_TYPES)('emits a compilable in-scattering term on %s', (type) => {
    const ret = buildScatteringShader(type);
    expect(ret).not.toBeNull();
    const [, fragmentSource] = ret!;
    // Survives as a real function rather than being folded away.
    expect(fragmentSource).toContain('waterSunScattering');
    // The phase function is a separate callee, so a change to one does not
    // silently inline into the other.
    expect(fragmentSource).toContain('waterScatterPhase');
    // Both directions are refracted before their slopes are taken: using the
    // above-water slope would overstate how much water the light crossed.
    expect(fragmentSource).toContain('refract');
    // The integral's closed form. Without this the term is a ray march.
    expect(fragmentSource).toContain('exp');
  });

  test('the phase function is normalized over the sphere', () => {
    // Each lobe integrates to 1 over 4*pi steradians, so a shader emitting one
    // without the 1/4pi is 4*pi too bright. Checked on the source rather than
    // numerically, since the constant is what regresses.
    const [, fragmentSource] = buildScatteringShader('webgpu')!;
    const phaseBody = fragmentSource.slice(fragmentSource.indexOf('waterScatterPhase'));
    expect(phaseBody).toMatch(/12\.56|4\.0\s*\*|12566/);
  });

  test('the phase function keeps a molecular lobe', () => {
    // The particulate lobe alone returns almost nothing to a camera looking down
    // at water under a high sun, which is the commonest setup there is - the
    // term would be invisible exactly where water most obviously looks blue.
    // The symmetric lobe is what carries that, so its coefficient has to survive
    // into the source.
    const [, fragmentSource] = buildScatteringShader('webgpu')!;
    const phaseBody = fragmentSource.slice(fragmentSource.indexOf('waterScatterPhase'));
    // 3 / (16 pi) = 0.0596831...
    expect(phaseBody).toMatch(/0\.0596/);
  });
});

describe('water refraction blur LOD', () => {
  // Mirrors the constants in the water material.
  const GEOMETRIC = 0.02;
  const DENSITY = 1.5;
  const MAX_LOD = 6;

  /** The LOD the shader selects for a path length and a scattering coefficient. */
  function lod(depth: number, scatterLuminance: number, scale = 1): number {
    const density = scatterLuminance * DENSITY * scale;
    return Math.min(Math.log2(1 + depth * (GEOMETRIC + density)), MAX_LOD);
  }

  test('is zero at the surface', () => {
    // A path of no length must read the background exactly, or the water would
    // blur what it is not in front of.
    expect(lod(0, 0.4)).toBe(0);
  });

  test('rises with depth and with turbidity', () => {
    expect(lod(4, 0.4)).toBeGreaterThan(lod(1, 0.4));
    expect(lod(2, 0.4)).toBeGreaterThan(lod(2, 0.02));
  });

  test('doubles the filter width per level', () => {
    // Log in the path length is the whole point: each mip is twice the footprint
    // of the last, so a linear ramp would blow through the chain in the first
    // metre. Doubling the optical depth must add roughly one level, not many.
    const one = lod(1 / 0.62, 0.4);
    const two = lod(2 / 0.62, 0.4);
    const four = lod(4 / 0.62, 0.4);
    expect(two - one).toBeLessThan(1.2);
    expect(four - two).toBeLessThan(1.2);
  });

  test('clear shallow water stays essentially sharp', () => {
    // The lagoon medium the caustics scenes use, under a couple of metres. If
    // this ever reaches a full level, those scenes have lost their sea bed
    // detail to a blur that should not be visible there.
    expect(lod(2.5, 0.04)).toBeLessThan(0.5);
  });

  test('turbid deep water saturates but never exceeds the chain', () => {
    // The allocation is sized from MAX_LOD, so a LOD past it would sample a
    // level that does not exist.
    expect(lod(60, 0.45)).toBeLessThanOrEqual(MAX_LOD);
    expect(lod(1e6, 10)).toBeLessThanOrEqual(MAX_LOD);
  });

  test('the scale knob can switch it off', () => {
    expect(lod(20, 0.45, 0)).toBeCloseTo(Math.log2(1 + 20 * GEOMETRIC), 12);
  });
});

describe('water scattering phase function', () => {
  const MOLECULAR_FRACTION = 0.12;

  /** The two-lobe phase the shader evaluates, in 1/sr. */
  function phase(cosTheta: number, g: number): number {
    const g2 = g * g;
    const denom = Math.max(1 + g2 - 2 * g * cosTheta, 1e-4);
    const mie = (1 - g2) / (4 * Math.PI * Math.pow(denom, 1.5));
    const rayleigh = (3 / (16 * Math.PI)) * (1 + cosTheta * cosTheta);
    return rayleigh * MOLECULAR_FRACTION + mie * (1 - MOLECULAR_FRACTION);
  }

  test('integrates to one over the sphere', () => {
    // Both lobes are normalized, so any convex mix of them is. An unnormalized
    // phase scales the whole water body by a constant nobody can account for.
    const steps = 200000;
    let sum = 0;
    for (let i = 0; i < steps; i++) {
      const cosTheta = -1 + (2 * (i + 0.5)) / steps;
      // dOmega = 2 pi dcos for an azimuthally symmetric phase.
      sum += phase(cosTheta, 0.7) * 2 * Math.PI * (2 / steps);
    }
    expect(sum).toBeCloseTo(1, 3);
  });

  test('returns a usable amount into the backward hemisphere', () => {
    // Looking down at water under a high sun the light turns nearly 180 degrees.
    // Against a fully isotropic phase - 1/4pi, the value a thick column ends up
    // at anyway - the backscatter must stay within an order of magnitude, or the
    // term contributes nothing in the commonest camera setup. A single g=0.7
    // lobe gives 0.11x here, which is what made this invisible from above.
    const isotropic = 1 / (4 * Math.PI);
    const backward = phase(-0.9, 0.7);
    expect(backward / isotropic).toBeGreaterThan(0.25);
    // And forward scattering still dominates, or the medium is not water.
    expect(phase(0.9, 0.7)).toBeGreaterThan(backward * 5);
  });

  test('concentrates forward as anisotropy rises', () => {
    // Measured at the exact forward direction and the exact backward one, not
    // at some angle in between: a high-g lobe is narrow as well as tall, so by
    // 26 degrees off-axis it has already dropped below a broader low-g lobe.
    // Comparing there says nothing about the knob.
    expect(phase(1, 0.9)).toBeGreaterThan(phase(1, 0.5));
    expect(phase(-1, 0.9)).toBeLessThan(phase(-1, 0.5));
  });

  test('is symmetric at zero anisotropy', () => {
    // g = 0 makes the particulate lobe isotropic, leaving only the Rayleigh
    // shape, which is symmetric about 90 degrees.
    expect(phase(0.6, 0)).toBeCloseTo(phase(-0.6, 0), 12);
  });
});

describe('water sun in-scattering integral', () => {
  /**
   * Range `r = vy / sy` can actually take.
   *
   * Snell maps every direction above the surface into a cone whose edge descends
   * at `cos(asin(1/1.333)) = 0.661`, so both slopes lie in `[0.661, 1]` and their
   * ratio in `[0.661, 1.512]`. Test cases outside that band would be pinning
   * arithmetic the shader can never reach.
   */
  const R_MIN = Math.sqrt(1 - (1 / 1.333) ** 2);
  const R_MAX = 1 / R_MIN;

  /**
   * The closed form the shader evaluates.
   *
   * `S = albedo * phase * E * (1 - exp(-sigma_t * (1 + r) * d)) / (1 + r)`,
   * with `r = vy / sy` the ratio of how fast the view and sun rays descend.
   */
  function closedForm(albedo: number, sigmaT: number, d: number, r: number): number {
    const rr = 1 + r;
    return (albedo * (1 - Math.exp(-sigmaT * rr * d))) / rr;
  }

  /**
   * Numeric single-scattering integral along the view ray, from first
   * principles: at depth `t * vy` the sun has travelled `t * vy / sy` and the
   * scattered light returns over `t`.
   */
  function quadrature(albedo: number, sigmaT: number, d: number, r: number, steps = 200000): number {
    const sigmaS = albedo * sigmaT;
    const dt = d / steps;
    let sum = 0;
    for (let i = 0; i < steps; i++) {
      const t = (i + 0.5) * dt;
      sum += sigmaS * Math.exp(-sigmaT * t * (1 + r)) * dt;
    }
    return sum;
  }

  // Cases spread over the band Snell admits, plus the two ends of it.
  test.each([
    [0.5, 0.8, 3, 1],
    [0.3, 1.4, 0.5, 0.8],
    [0.9, 0.2, 20, 1.4],
    [0.6, 2.0, 8, R_MIN],
    [0.45, 0.6, 6, R_MAX]
  ])('matches quadrature for albedo=%p sigma=%p depth=%p r=%p', (albedo, sigmaT, d, r) => {
    const exact = closedForm(albedo, sigmaT, d, r);
    const numeric = quadrature(albedo, sigmaT, d, r);
    expect(exact).toBeCloseTo(numeric, 5);
  });

  test('converges rather than diverging on an unbounded column', () => {
    // Looking straight down at deep water under an overhead sun: both rays
    // descend at the same rate, so r = 1 and the term settles at albedo / 2
    // however deep the water is. A form that grew with depth would blow out
    // every deep-water scene.
    const albedo = 0.7;
    const deep = closedForm(albedo, 0.5, 1e6, 1);
    expect(deep).toBeCloseTo(albedo / 2, 6);
    // And it is monotone in depth up to that limit, so shallow water is darker.
    const shallow = closedForm(albedo, 0.5, 0.2, 1);
    expect(shallow).toBeLessThan(deep);
  });

  test('is independent of sigma_t only in the limit', () => {
    // sigma_t cancels everywhere but the exponent. A thick medium reaches the
    // saturation value in centimetres, a thin one needs metres - which is what
    // makes clear water read as dark and turbid water as bright at the same
    // depth.
    const albedo = 0.5;
    const turbid = closedForm(albedo, 3, 1, 1);
    const clear = closedForm(albedo, 0.05, 1, 1);
    expect(turbid).toBeGreaterThan(clear * 5);
    expect(turbid).toBeLessThanOrEqual(albedo / 2 + 1e-9);
  });

  test('a lower sun returns less from the column', () => {
    // The sun's path to a given depth lengthens as it drops, so r rises and the
    // returned radiance falls: the light is extinguished before it can scatter
    // back. This is the direction that makes a low sun read as a darker, more
    // saturated body.
    const albedo = 0.6;
    const high = closedForm(albedo, 0.6, 5, R_MIN);
    const low = closedForm(albedo, 0.6, 5, R_MAX);
    expect(low).toBeLessThan(high);
  });

  test('r stays inside the cone Snell admits', () => {
    // Refraction confines every above-water direction to a cone 48.6 degrees
    // wide, so both rays descend at between cos(48.6) and 1 - and r, their
    // ratio, is bounded well away from both 0 and infinity. This is why the term
    // needs no guard beyond the arithmetic one: the divergent case the closed
    // form cannot represent is not reachable from above the surface.
    const eta = 1 / 1.333;
    const slowest = Math.sqrt(1 - eta * eta);
    expect(slowest).toBeCloseTo(0.6612, 4);
    expect(R_MIN).toBeCloseTo(slowest, 6);
    expect(R_MAX).toBeCloseTo(1 / slowest, 6);
    // The shader's floor sits below anything in that range, so it never fires
    // for a sun above the horizon.
    const MIN_SUN_SLOPE = 0.05;
    expect(MIN_SUN_SLOPE).toBeLessThan(slowest);
    // And the integral's denominator stays comfortably above zero throughout.
    expect(1 + R_MIN).toBeGreaterThan(1.6);
    expect(1 + R_MAX).toBeLessThan(2.6);
  });
});
