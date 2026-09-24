import { ProgramBuilder } from '../../../libs/device/src';
import { PBRMetallicRoughnessMaterial } from '@zephyr3d/scene';
import { DepthPass } from '../../../libs/scene/src/render/depthpass';

/**
 * The depth prepass writes a different number of attachments depending on what
 * the frame needs, and a fragment shader that declares a different count than
 * the framebuffer carries is rejected by WebGPU at draw time.
 *
 * Two sites have to agree for that to hold: the output *declarations* in
 * `MeshMaterial._createProgram` and the *writes* in `outputFragmentColor`.
 * Assigning to `$outputs` declares the output implicitly, so a write that is not
 * gated exactly like its declaration silently adds one - which is how the
 * transparent motion-vector pass, whose framebuffer has a single attachment,
 * ended up with a shader that declared two and logged a fragment color output
 * count mismatch for every transparent material in the scene.
 */
function fragmentOutputsOf(configure: (ctx: Record<string, unknown>, pass: DepthPass) => void) {
  const device: any = {
    type: 'webgpu',
    clipSpaceZeroToOne: true,
    getDeviceCaps: () => ({ shaderCaps: { supportShaderF16: false } }),
    createGPUProgram: (o: any) => ({ ...o, fragmentSource: o.params.fs, vertexSource: o.params.vs })
  };
  const pass = new DepthPass();
  const ctx: Record<string, unknown> = {
    device,
    renderPass: pass,
    motionVectors: false,
    skinProfileId: false,
    materialFlags: 0,
    queue: 0,
    renderPassHash: 'test',
    shaderVariantHash: null
  };
  configure(ctx, pass);
  const material = new PBRMetallicRoughnessMaterial() as any;
  const program = material._createProgram(new ProgramBuilder(device), ctx, 0);
  const source = (program?.fragmentSource ?? '') as string;
  return [
    ...new Set(
      [...source.matchAll(/@location\(\d+\)\s+(zFSOutput_\w+)/g)].map((m) => m[1].replace('zFSOutput_', ''))
    )
  ];
}

describe('Depth prepass fragment outputs', () => {
  test('the ordinary prepass writes depth, motion vector and profile id', () => {
    const outputs = fragmentOutputsOf((ctx) => {
      ctx.motionVectors = true;
      ctx.skinProfileId = true;
    });
    // Order is the MRT order the prepass framebuffer is built in, so it is part
    // of the contract rather than an implementation detail.
    expect(outputs).toEqual(['zFragmentOutput', 'zMotionVector', 'zSSSProfileId']);
  });

  test('the transparent motion-vector pass writes the velocity alone', () => {
    const outputs = fragmentOutputsOf((ctx, pass) => {
      ctx.motionVectors = true;
      ctx.skinProfileId = true;
      pass.motionVectorOnly = true;
    });
    // Its framebuffer carries one attachment. The profile id in particular has
    // no business here: it is produced for the diffusion and the thickness pass,
    // both of which only see opaque geometry.
    expect(outputs).toEqual(['zMotionVector']);
  });

  test('a frame without skin scattering leaves the profile id out entirely', () => {
    const outputs = fragmentOutputsOf((ctx) => {
      ctx.motionVectors = true;
    });
    expect(outputs).toEqual(['zFragmentOutput', 'zMotionVector']);
  });
});
