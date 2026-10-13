import type { BindGroup, GPUProgram, RenderStateSet } from '@zephyr3d/device';
import { Vector3, Vector4 } from '@zephyr3d/base';
import type { Nullable } from '@zephyr3d/base';
import { getDevice } from '../../app/api';
import type { Camera } from '../../camera/camera';
import type { Scene } from '../../scene/scene';
import { drawFullscreenQuad } from '../fullscreenquad';
import { declareDynamicSDFUniforms, declareGlobalSDFUniforms, sampleSceneSDF } from '../../shaders/sdf';

/** Sphere tracing steps per pixel. */
const MAX_STEPS = 128;

const programs = new Map<number, { program: GPUProgram; bindGroup: BindGroup }>();
let renderStates: Nullable<RenderStateSet> = null;

function getProgram(levels: number) {
  let entry = programs.get(levels);
  if (!entry) {
    const device = getDevice();
    const program = device.buildRenderProgram({
      label: 'SceneSDFView',
      vertex(pb) {
        this.$inputs.pos = pb.vec2().attrib('position');
        this.$outputs.uv = pb.vec2();
        pb.main(function () {
          this.$builtins.position = pb.vec4(this.$inputs.pos, 0, 1);
          this.$outputs.uv = pb.add(pb.mul(this.$inputs.pos.xy, 0.5), pb.vec2(0.5));
        });
      },
      fragment(pb) {
        this.$outputs.color = pb.vec4();
        this.invViewProj = pb.mat4().uniform(0);
        // (camera position, trace distance)
        this.cameraInfo = pb.vec4().uniform(0);
        declareGlobalSDFUniforms(this, 0, levels);
        declareDynamicSDFUniforms(this, 0);
        pb.main(function () {
          // A point on the pixel's ray; clip z 0.5 lies in front on either depth convention
          this.$l.h = pb.mul(
            this.invViewProj,
            pb.vec4(pb.sub(pb.mul(this.$inputs.uv, 2), pb.vec2(1)), 0.5, 1)
          );
          this.$l.dir = pb.normalize(pb.sub(pb.div(this.h.xyz, this.h.w), this.cameraInfo.xyz));
          this.$l.t = pb.float(0);
          this.$l.steps = pb.float(0);
          this.$l.hit = false;
          this.$for(pb.int('i'), 0, MAX_STEPS, function () {
            this.$l.d = sampleSceneSDF(this, pb.add(this.cameraInfo.xyz, pb.mul(this.dir, this.t)), levels);
            this.steps = pb.add(this.steps, 1);
            // Hit tolerance grows with distance, as the voxels do
            this.$if(pb.lessThan(this.d, pb.add(0.01, pb.mul(this.t, 0.002))), function () {
              this.hit = true;
              this.$break();
            });
            this.t = pb.add(this.t, pb.max(this.d, 0.02));
            this.$if(pb.greaterThan(this.t, this.cameraInfo.w), function () {
              this.$break();
            });
          });
          // Brightness from the step count: few steps on surfaces facing the
          // ray, many where rays graze a surface, so silhouettes glow
          this.$l.k = pb.sqrt(pb.div(this.steps, MAX_STEPS));
          this.$outputs.color = this.$choice(
            this.hit,
            pb.vec4(pb.vec3(pb.mix(0.08, 1, this.k)), 1),
            pb.vec4(pb.mix(pb.vec3(0.12, 0.12, 0.55), pb.vec3(0.85), this.k), 1)
          );
        });
      }
    })!;
    program.name = '@SceneSDFView';
    entry = { program, bindGroup: device.createBindGroup(program.bindGroupLayouts[0]) };
    programs.set(levels, entry);
  }
  return entry;
}

/**
 * Draws the scene's signed distance field as seen from a camera, over the
 * current framebuffer inside the camera viewport: every pixel sphere traces
 * the field (global clipmap and dynamic instances) and is shaded by its step
 * count, grey on a hit and blue on a miss, with silhouettes glowing where rays
 * graze surfaces. A debug view; call it after the camera has rendered.
 *
 * Does nothing where the scene has no field (disabled, or WebGL2).
 *
 * @returns Whether it drew.
 * @public
 */
export function renderSceneSDFView(scene: Scene, camera: Camera) {
  const sdf = scene.sdf.enabled ? scene.sdf.global : null;
  if (!sdf) {
    return false;
  }
  const device = getDevice();
  const { program, bindGroup } = getProgram(sdf.levels);
  if (!renderStates) {
    renderStates = device.createRenderStateSet();
    renderStates.useDepthState().enableTest(false).enableWrite(false);
    renderStates.useRasterizerState().setCullMode('none');
  }
  const pos = camera.getWorldPosition(new Vector3());
  bindGroup.setValue('invViewProj', camera.invViewProjectionMatrix);
  // As far as the coarsest level reaches from the camera
  bindGroup.setValue(
    'cameraInfo',
    new Vector4(pos.x, pos.y, pos.z, sdf.resolution * sdf.voxelSize(sdf.levels - 1))
  );
  sdf.applyBindGroup(bindGroup);
  device.pushDeviceStates();
  try {
    const vp = camera.viewport;
    if (vp) {
      device.setViewport(vp as number[]);
      device.setScissor(vp as number[]);
    }
    device.setProgram(program);
    device.setBindGroup(0, bindGroup);
    drawFullscreenQuad(renderStates);
  } finally {
    device.popDeviceStates();
  }
  return true;
}
