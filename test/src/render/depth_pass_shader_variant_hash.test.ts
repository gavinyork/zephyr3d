import { DepthPass } from '../../../libs/scene/src/render/depthpass';
import { ShaderHelper } from '../../../libs/scene/src/material/shader/helper';

/**
 * `Material.calcGlobalHash` keys the program cache off `ctx.shaderVariantHash ?? ctx.renderPassHash`.
 * DepthPass has no variant hash of its own and relies on the fallback, so it has to clear the field
 * before computing its own key.
 *
 * LightPass clears it on entry but not on exit, so whatever variant it rendered last is still on the
 * context afterwards. The depth prepass never saw this -- it runs before the light pass, while the
 * field is still null -- but the transmission depth pass runs after it, and inherited the light
 * pass's hash. Both passes then hashed to the same key and the transmission pass was handed the
 * light pass's program.
 *
 * That reuse was silent until motion vectors were on: the depth framebuffer then carries a second
 * attachment for velocity, and a light-pass program declares only one fragment output, so WebGPU's
 * draw validation reported a fragment color output count mismatch (1 output, 2 targets). Without
 * TAA the counts happened to agree and the wrong program went unnoticed.
 */
describe('DepthPass does not inherit a stale shader variant hash', () => {
  let setCameraUniforms: jest.SpyInstance;

  beforeEach(() => {
    // Uniform upload needs a real camera and device; this file is only about the two hash fields
    // renderItems assigns before it.
    setCameraUniforms = jest.spyOn(ShaderHelper, 'setCameraUniforms').mockImplementation(() => {});
  });

  afterEach(() => {
    setCameraUniforms.mockRestore();
  });

  function renderItemsWith(shaderVariantHash: string | null) {
    const pass = new DepthPass();
    const ctx = {
      shaderVariantHash,
      renderPassHash: null,
      drawEnvLight: true,
      env: {},
      motionVectors: true,
      renderPass: pass,
      camera: { worldMatrixDet: 1 },
      device: { setBindGroup: () => {}, getFramebuffer: () => null },
      globalBindGroupAllocator: { getGlobalBindGroup: () => ({ setValue: () => {} }) }
    } as Record<string, unknown>;
    // renderItems is protected and returns early unless the queue has an item list; empty lists are
    // enough to reach the hash assignments and draw nothing.
    (pass as unknown as { renderItems(c: unknown, cam: unknown, q: unknown): void }).renderItems(
      ctx,
      { worldMatrixDet: 1 },
      { itemList: { opaque: { lit: [], unlit: [] }, transmission: { lit: [], unlit: [] } } }
    );
    return ctx;
  }

  test('clears a hash left behind by an earlier light pass', () => {
    const ctx = renderItemsWith('LightPass::0:0::none:none:none:0:163:195:0:0:legacy');
    expect(ctx.shaderVariantHash).toBeNull();
  });

  test('still computes its own renderPassHash', () => {
    const ctx = renderItemsWith('LightPass::stale');
    expect(typeof ctx.renderPassHash).toBe('string');
    expect(ctx.renderPassHash).not.toBe('LightPass::stale');
  });
});
