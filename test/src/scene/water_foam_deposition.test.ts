import { createNullDevice } from '@zephyr3d/backend-null';
import type { NullGPUProgram } from '@zephyr3d/backend-null';
import { WaterFoamField } from '../../../libs/scene/src/render/water_foam';
import type { FoamFieldSource } from '../../../libs/scene/src/render/water_foam';
import type { PBShaderExp } from '@zephyr3d/device';

function source(deposition = true, key = 'deposition-test'): FoamFieldSource {
  return {
    foamSourceKey: key,
    supportsFoamDeposition: deposition,
    setupFoamSourceUniforms() {},
    applyFoamSourceBindGroup() {},
    calcFoamStep(scope, _xz, dt, _fade, _prewarm, state, contact) {
      const pb = scope.$builder;
      pb.func(
        'testFoamSource',
        [pb.float('dt'), pb.vec4('state').inout(), pb.vec2('contact').out()],
        function () {
          this.state.x = pb.add(this.state.x, this.dt);
          this.contact = pb.vec2(4, 0);
          this.$return(pb.vec4(2, 0, this.dt, pb.mul(this.dt, 0.5)));
        }
      );
      return scope.testFoamSource(dt, state, contact) as PBShaderExp;
    }
  };
}

/** Execute the scalar arithmetic emitted by the real GLSL builder. This small
 * helper needs no GPU: assertions target exchange invariants rather than a
 * second copy of the deposition formula.
 */
function exchangeFromShader(shader: string) {
  const definition = shader.match(/vec2 ffDeposit\(([^)]*)\)\s*\{([^}]+)\}/);
  if (!definition) {
    throw new Error('No generated deposition exchange function');
  }
  const parameters = definition[1].replace(/\b(float|vec2)\s+/g, '');
  const body = definition[2].replace(/\bfloat\s+/g, 'const ');
  const fn = new Function(
    'min',
    'max',
    'exp',
    'clamp',
    'mix',
    'vec2',
    `return function(${parameters}) { ${body} };`
  )(
    Math.min,
    Math.max,
    Math.exp,
    (x: number, lo: number, hi: number) => Math.min(Math.max(x, lo), hi),
    (a: number, b: number, t: number) => a + (b - a) * t,
    (x: number, y: number) => [x, y]
  ) as (
    mobile: number,
    deposited: number,
    contact: { x: number; y: number },
    dt: number,
    fade: number
  ) => [number, number];
  // contact is (attach rate, dryness of the ground)
  return (mobile: number, deposited: number, rate: number, dt: number, fade: number, dryness = 0) =>
    fn(mobile, deposited, { x: rate, y: dryness }, dt, fade);
}

describe('Foam attachment exchange', () => {
  let exchange: ReturnType<typeof exchangeFromShader>;
  beforeAll(async () => {
    const device = await createNullDevice({ type: 'webgl2' });
    const field = new WaterFoamField();
    const entry = (field as any).getStepProgram(device, source());
    exchange = exchangeFromShader(entry.program.getShaderSource('fragment'));
    field.dispose();
  });

  test('a zero-time grid move neither deposits nor fades foam', () => {
    expect(exchange(0.7, 0.2, 100, 0, 0.8)).toEqual([0.7, 0.2]);
  });

  test('thin water imprints its foam on the ground without draining it', () => {
    const [mobile, deposited] = exchange(0.7, 0.2, 4, 1 / 30, 0);
    expect(mobile).toBe(0.7);
    expect(deposited).toBeGreaterThan(0.2);
    expect(deposited).toBeLessThan(0.7);
  });

  test('the ground never holds more foam than the water over it left', () => {
    const [mobile, deposited] = exchange(0.4, 0.1, 1000, 1, 0);
    expect(mobile).toBe(0.4);
    expect(deposited).toBeCloseTo(0.4, 6);
    // Repeated passes of the same water do not pile up past its density
    let d = 0;
    for (let i = 0; i < 300; i++) {
      d = exchange(0.4, d, 8, 1 / 30, 0)[1];
    }
    expect(d).toBeLessThanOrEqual(0.4 + 1e-9);
    // Denser foam already on the ground is kept, only fading
    expect(exchange(0.2, 0.9, 100, 1, 0)).toEqual([0.2, 0.9]);
  });

  test('deposits on drained ground fade faster than under water', () => {
    const [, wet] = exchange(0, 0.8, 0, 0.5, 0.8, 0);
    const [, dry] = exchange(0, 0.8, 0, 0.5, 0.8, 1);
    expect(dry).toBeLessThan(wet);
    expect(dry).toBeGreaterThan(0);
  });

  test('without ground contact only existing deposits fade', () => {
    const [mobile, deposited] = exchange(0.7, 0.2, -1, 1, 0.8);
    expect(mobile).toBe(0.7);
    expect(deposited).toBeGreaterThan(0);
    expect(deposited).toBeLessThan(0.2);
  });
});

describe.each(['webgl2', 'webgpu'] as const)('Deposited foam shaders on %s', (type) => {
  test('the real field step builds both outputs and forwards contact as out', async () => {
    const device = await createNullDevice({ type });
    const field = new WaterFoamField();
    const entry = (field as any).getStepProgram(device, source());
    const program = entry.program as NullGPUProgram;
    const shader = program.getShaderSource('fragment')!;
    expect(program.getBindingInfo('ffDepositedSrc')).not.toBeNull();
    expect(shader).toContain('outDeposited');
    expect(shader.match(/testFoamSource\([^\n]+/)?.[0]).toMatch(
      type === 'webgpu' ? /contact:\s*ptr<function,\s*vec2<f32>\s*>/ : /out vec2 contact/
    );
    expect(shader).toMatch(
      type === 'webgpu' ? /testFoamSource\(dt,&state,&contact/ : /testFoamSource\(dt,state,contact/
    );
    // Deposits read the fixed cell and its coarser fallback, while mobile foam
    // has a separate upstream lookup. Wall state remains in the main texture.
    expect(shader).toMatch(/ffPrevUV\(xz,/);
    expect(shader).toMatch(/ffPrevUV\(flowed,/);
    expect(shader).toMatch(/ffDepositedSrc[^\n]*stateAt/);
    expect(shader).toMatch(/ffDepositedSrc[^\n]*depositedNext/);
    expect(shader).toMatch(/ffSrc[^\n]*\.ba/);
    field.dispose();
  });

  test('sampling deposits builds without moving their texture coordinates', async () => {
    const device = await createNullDevice({ type });
    const field = new WaterFoamField();
    const program = device.buildRenderProgram({
      vertex(pb) {
        this.$inputs.pos = pb.vec2().attrib('position');
        pb.main(function () {
          this.$builtins.position = pb.vec4(this.$inputs.pos, 0, 1);
        });
      },
      fragment(pb) {
        field.setupUniforms(this, 0);
        this.$outputs.color = pb.vec4();
        pb.main(function () {
          this.$outputs.color = pb.vec4(field.sampleDeposited(this, this.$builtins.fragCoord.xy), 0, 1);
        });
      }
    }) as NullGPUProgram;
    expect(program).not.toBeNull();
    expect(program.getBindingInfo('ffDepositedTex')).not.toBeNull();
    const shader = program.getShaderSource('fragment')!;
    expect(shader).toContain('ffDepositedEnabled');
    expect(shader).not.toContain('.ffClock');
    expect(shader).not.toContain('.ffDrift');
    field.dispose();
  });

  test('sources without deposition keep a single output and legacy source contract', async () => {
    const device = await createNullDevice({ type });
    const field = new WaterFoamField();
    const legacy: FoamFieldSource = {
      foamSourceKey: 'legacy',
      setupFoamSourceUniforms() {},
      applyFoamSourceBindGroup() {},
      calcFoamStep(scope) {
        return scope.$builder.vec4(0);
      }
    };
    const entry = (field as any).getStepProgram(device, legacy);
    expect(entry.program.getBindingInfo('ffDepositedSrc')).toBeNull();
    expect(entry.program.getShaderSource('fragment')).not.toContain('outDeposited');
    field.dispose();
  });
});

test('deposition resources follow their source without erasing mobile foam or wall history', async () => {
  const device = await createNullDevice();
  const field = new WaterFoamField();
  const internal = field as any;
  internal.ensureArrays(device, source(false));
  const mobile = [...internal._arrays];
  expect(internal._depositedArrays).toBeNull();
  internal._current = 1;
  internal._regions[0].setXYZW(10, 20, 0.5, 256);

  internal.ensureArrays(device, source());
  const deposited = [...internal._depositedArrays];
  expect(deposited.map((tex) => tex.format)).toEqual(['r16f', 'r16f']);
  expect(deposited.map((tex) => tex.depth)).toEqual([4, 4]);
  expect(internal._framebuffers[1].getColorAttachments()).toEqual([mobile[1], deposited[1]]);
  expect(internal._current).toBe(1);
  expect(internal._regions[0].x).toBe(10);

  internal.ensureArrays(device, source(false));
  expect(internal._arrays).toEqual(mobile);
  expect(mobile.every((tex) => !tex.disposed)).toBe(true);
  expect(deposited.every((tex) => tex.disposed)).toBe(true);
  expect(internal._depositedArrays).toBeNull();
  expect(internal._framebuffers[1].getColorAttachments()).toEqual([mobile[1]]);

  const clears = device.getCommandCount('clear');
  internal.ensureArrays(device, source());
  expect(internal._depositedArrays[0]).not.toBe(deposited[0]);
  expect(device.getCommandCount('clear') - clears).toBe(8);
  const replacement = [...internal._depositedArrays];
  internal.ensureArrays(device, source(true, 'another-beach'));
  expect(replacement.every((tex) => tex.disposed)).toBe(true);
  expect(internal._arrays).toEqual(mobile);
  field.dispose();
});
