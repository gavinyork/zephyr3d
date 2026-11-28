import type {
  BindGroup,
  FrameBuffer,
  GPUProgram,
  PBGlobalScope,
  PBInsideFunctionScope,
  PBShaderExp,
  ProgramBuilder
} from '@zephyr3d/device';
import { getDevice } from '../../app/api';
import { drawFullscreenQuad } from '../fullscreenquad';

/*
 * The cloud volumes, maps and caches are made one texel per invocation, every texel independent of
 * the others. WebGPU runs them as compute programs writing storage textures; WebGL2, which has
 * neither, draws the same code as a full-screen quad into a render target, one fragment per texel.
 */

/**
 * Whether the cloud passes run as compute programs rather than full-screen draws.
 * @internal
 */
export function cloudPassesUseCompute() {
  return getDevice().type === 'webgpu';
}

/**
 * Writes `value` for the texel `texel`: a store into `dst` on the compute path, the fragment's
 * output on the fragment path, where `texel` is the fragment's own and is not used.
 * @internal
 */
export type TexelEmit = (scope: PBInsideFunctionScope, texel: PBShaderExp, value: PBShaderExp) => void;

/**
 * Builds a program producing one texel per invocation.
 *
 * On the compute path the storage texture `dst` is declared and `main` gets the global invocation
 * id. On the fragment path `main` gets the fragment's texel in x and y and, for a `layered` target
 * (a layer of a 3D texture), the float uniform `zLayer` in z; elsewhere z is 0.
 *
 * @internal
 */
export function buildTexelProgram(options: {
  label: string;
  workgroupSize: [number, number, number];
  /** Declares the storage texture of the compute path */
  storage: (pb: ProgramBuilder) => PBShaderExp;
  layered?: boolean;
  declare: (this: PBGlobalScope, pb: ProgramBuilder) => void;
  main: (this: PBInsideFunctionScope, pb: ProgramBuilder, id: PBShaderExp, emit: TexelEmit) => void;
}): GPUProgram {
  const device = getDevice();
  if (cloudPassesUseCompute()) {
    return device.buildComputeProgram({
      label: options.label,
      workgroupSize: options.workgroupSize,
      compute(pb) {
        options.declare.call(this, pb);
        this.dst = options.storage(pb);
        pb.main(function () {
          options.main.call(this, pb, this.$builtins.globalInvocationId, (scope, texel, value) => {
            pb.textureStore(scope.dst, texel, value);
          });
        });
      }
    })!;
  }
  return buildFullscreenProgram(options.label, function (pb) {
    options.declare.call(this, pb);
    if (options.layered) {
      this.zLayer = pb.float().uniform(0);
    }
    this.$outputs.color = pb.vec4();
    pb.main(function () {
      // A fragment at (x + 0.5, y + 0.5) writes texel (x, y) in memory on every backend
      this.$l.texelId = pb.uvec3(
        pb.uvec2(this.$builtins.fragCoord.xy),
        options.layered ? pb.uint(this.zLayer) : pb.uint(0)
      );
      options.main.call(this, pb, this.texelId, (scope, _texel, value) => {
        scope.$outputs.color = value;
      });
    });
  });
}

/**
 * Builds a full-screen fragment program from `fragment`, which declares its uniforms and the
 * output `color` itself.
 * @internal
 */
export function buildFullscreenProgram(
  label: string,
  fragment: (this: PBGlobalScope, pb: ProgramBuilder) => void
): GPUProgram {
  return getDevice().buildRenderProgram({
    label,
    vertex(pb) {
      this.$inputs.pos = pb.vec2().attrib('position');
      pb.main(function () {
        this.$builtins.position = pb.vec4(this.$inputs.pos, 0, 1);
      });
    },
    fragment
  })!;
}

/**
 * Draws a program of {@link buildTexelProgram} or {@link buildFullscreenProgram} over the whole of
 * `framebuffer`. Leaves the framebuffer bound; callers save and restore the device states.
 * @internal
 */
export function drawTexelPass(program: GPUProgram, bindGroup: BindGroup, framebuffer: FrameBuffer) {
  const device = getDevice();
  device.setFramebuffer(framebuffer);
  device.setProgram(program);
  device.setBindGroup(0, bindGroup);
  drawFullscreenQuad();
}
