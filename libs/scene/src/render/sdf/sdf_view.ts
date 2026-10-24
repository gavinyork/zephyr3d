import type { BindGroup, GPUProgram, RenderStateSet } from '@zephyr3d/device';
import { Vector3, Vector4 } from '@zephyr3d/base';
import type { Nullable } from '@zephyr3d/base';
import { getDevice } from '../../app/api';
import type { Camera } from '../../camera/camera';
import type { Scene } from '../../scene/scene';
import { drawFullscreenQuad } from '../fullscreenquad';
import {
  declareDynamicSDFUniforms,
  declareGlobalSDFUniforms,
  sampleGlobalSDF,
  sampleSceneSDF
} from '../../shaders/sdf';
import {
  declareVoxelSceneUniforms,
  loadVoxelSceneAlbedo,
  loadVoxelSceneEmissive,
  VOXEL_SCENE_ALBEDO,
  VOXEL_SCENE_EMISSIVE,
  voxelSceneTexel
} from '../../shaders/gi';
import { buildSDFProgram } from './sdf_programs';
import { fetchSampler } from '../../utility/misc';

/**
 * What {@link renderSceneSDFView} shows: the field by its step count, or the
 * voxel scene's albedo or emissive at the hit.
 * @public
 */
export type SceneSDFViewMode = 'distance' | 'albedo' | 'emissive';

/** Sphere tracing steps per pixel. */
const MAX_STEPS = 128;

const programs = new Map<string, { program: GPUProgram; bindGroup: BindGroup }>();
let renderStates: Nullable<RenderStateSet> = null;

function getProgram(levels: number, mode: SceneSDFViewMode) {
  const key = `${levels}:${mode}`;
  let entry = programs.get(key);
  if (!entry) {
    const device = getDevice();
    const program = buildSDFProgram({
      label: `SceneSDFView:${mode}`,
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
        if (mode !== 'distance') {
          declareVoxelSceneUniforms(this, 0);
        }
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
          this.$l.miss = pb.vec4(pb.mix(pb.vec3(0.12, 0.12, 0.55), pb.vec3(0.85), this.k), 1);
          if (mode === 'distance') {
            this.$outputs.color = this.$choice(
              this.hit,
              pb.vec4(pb.vec3(pb.mix(0.08, 1, this.k)), 1),
              this.miss
            );
          } else {
            this.$outputs.color = this.miss;
            this.$if(this.hit, function () {
              this.$l.hp = pb.add(this.cameraInfo.xyz, pb.mul(this.dir, this.t));
              this.$l.texel = voxelSceneTexel(this, this.hp, levels);
              if (mode === 'albedo') {
                // Lit by a head light from the field's gradient, so shape reads
                this.$l.e = pb.mul(this.cameraInfo.w, 0.0005);
                this.$l.n = pb.normalize(
                  pb.vec3(
                    pb.sub(
                      sampleSceneSDF(this, pb.add(this.hp, pb.vec3(this.e, 0, 0)), levels),
                      sampleSceneSDF(this, pb.sub(this.hp, pb.vec3(this.e, 0, 0)), levels)
                    ),
                    pb.sub(
                      sampleSceneSDF(this, pb.add(this.hp, pb.vec3(0, this.e, 0)), levels),
                      sampleSceneSDF(this, pb.sub(this.hp, pb.vec3(0, this.e, 0)), levels)
                    ),
                    pb.sub(
                      sampleSceneSDF(this, pb.add(this.hp, pb.vec3(0, 0, this.e)), levels),
                      sampleSceneSDF(this, pb.sub(this.hp, pb.vec3(0, 0, this.e)), levels)
                    )
                  )
                );
                this.$l.a = loadVoxelSceneAlbedo(this, this.texel);
                this.$l.shade = pb.add(0.25, pb.mul(0.75, pb.max(pb.dot(this.n, pb.neg(this.dir)), 0)));
                // Magenta where no level's window holds the hit with a current
                // brick; orange where the hit is a dynamic instance, which the
                // voxel scene leaves out; where it has no material at a static
                // surface, cyan at the finest level, yellow at the next, white beyond
                this.$l.staticD = sampleGlobalSDF(this, this.hp, levels);
                this.$l.dynamicHit = pb.greaterThan(this.staticD, pb.add(0.05, pb.mul(this.t, 0.004)));
                this.$l.flag = this.$choice(
                  pb.lessThan(this.texel.w, 0),
                  pb.vec3(1, 0, 1),
                  this.$choice(
                    this.dynamicHit,
                    pb.vec3(1, 0.5, 0),
                    this.$choice(
                      pb.equal(this.texel.w, 0),
                      pb.vec3(0, 1, 1),
                      this.$choice(pb.equal(this.texel.w, 1), pb.vec3(1, 1, 0), pb.vec3(1))
                    )
                  )
                );
                this.$outputs.color = this.$choice(
                  pb.greaterThan(this.a.a, 0),
                  pb.vec4(pb.mul(this.a.rgb, this.shade), 1),
                  pb.vec4(pb.mul(this.flag, this.shade), 1)
                );
              } else {
                this.$l.em = loadVoxelSceneEmissive(this, this.texel);
                this.$outputs.color = pb.vec4(pb.div(this.em, pb.add(this.em, pb.vec3(1))), 1);
              }
            });
          }
        });
      }
    })!;
    program.name = `@SceneSDFView_${mode}`;
    entry = { program, bindGroup: device.createBindGroup(program.bindGroupLayouts[0]) };
    programs.set(key, entry);
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
 * With a mode of `albedo` or `emissive`, a hit shows the voxel scene's
 * material there instead; the scene's global illumination must be enabled and
 * built, else the view falls back to the field. In `albedo`, a surface without
 * material is flagged: orange for a dynamic instance (the voxel scene holds
 * static meshes only), cyan, yellow or white for a static surface by the
 * clipmap level read, magenta where no level's window holds the point.
 *
 * Does nothing where the scene has no field (disabled, or WebGL2).
 *
 * @returns Whether it drew.
 * @public
 */
export function renderSceneSDFView(scene: Scene, camera: Camera, mode: SceneSDFViewMode = 'distance') {
  const sdf = scene.sdf.enabled ? scene.sdf.global : null;
  if (!sdf) {
    return false;
  }
  const voxels = mode !== 'distance' && scene.gi.enabled ? scene.gi.voxels : null;
  if (!voxels?.ready) {
    mode = 'distance';
  }
  const device = getDevice();
  const { program, bindGroup } = getProgram(sdf.levels, mode);
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
  if (voxels && mode !== 'distance') {
    bindGroup.setTexture(VOXEL_SCENE_ALBEDO, voxels.albedo, fetchSampler('clamp_nearest_nomip'));
    bindGroup.setTexture(VOXEL_SCENE_EMISSIVE, voxels.emissive, fetchSampler('clamp_nearest_nomip'));
  }
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
