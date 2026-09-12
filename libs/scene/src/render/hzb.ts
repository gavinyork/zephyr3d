import type {
  AbstractDevice,
  BaseTexture,
  BindGroup,
  FrameBuffer,
  GPUProgram,
  PBInsideFunctionScope,
  PBShaderExp,
  Texture2D,
  TextureFormat
} from '@zephyr3d/device';
import { drawFullscreenQuad } from './fullscreenquad';
import { CopyBlitter, type BlitType } from '../blitter';
import { fetchSampler } from '../utility/misc';
import { getDevice } from '../app/api';
import type { Nullable } from '@zephyr3d/base';
import { DEPTH_FARTHEST, DEPTH_REDUCE_CLOSER, DEPTH_REDUCE_FARTHER, REVERSE_Z } from '@zephyr3d/base';

let hzbProgram: Nullable<GPUProgram>[] = [];
let hzbBindGroupCache: WeakMap<BaseTexture, BindGroup[]> = new WeakMap();
let blitter: Nullable<HiZInitBlitter>[] = [];
const srcSize = new Int32Array(2);

/**
 * Seeds mip 0 of the pyramid from the depth prepass.
 *
 * Both channels start from the same device depth: the pyramid only diverges
 * once the reductions run, one keeping the farthest sample of each 2x2 and the
 * other the nearest. `twoChannel` decides whether the nearest channel exists at
 * all - it is a second full mip chain's worth of bandwidth, so a frame that only
 * needs the occlusion pyramid does not carry it.
 */
class HiZInitBlitter extends CopyBlitter {
  private readonly _twoChannel: boolean;
  constructor(twoChannel: boolean) {
    super();
    this._twoChannel = twoChannel;
  }
  /** @override */
  filter(
    scope: PBInsideFunctionScope,
    type: BlitType,
    srcTex: PBShaderExp,
    srcUV: PBShaderExp,
    srcLayer: PBShaderExp,
    sampleType: 'float' | 'int' | 'uint'
  ) {
    const depth = super.filter(scope, type, srcTex, srcUV, srcLayer, sampleType);
    return scope.$builder.vec4(depth.x, this._twoChannel ? depth.x : 0, 0, 1);
  }
  /** @override */
  protected calcHash(): string {
    return `${super.calcHash()}:${this._twoChannel ? 1 : 0}`;
  }
}

/*
vec3 trace_ray(vec3 ray_start, vec3 ray_dir)
{

    if (ray_dir.z < 0.0) {
        return vec3(0);
    }

    ray_dir = normalize(ray_dir);
    ivec2 work_size = SCREEN_SIZE_INT;

    const int loop_max = 150;
    int mipmap = 0;
    int max_iter = loop_max;

    vec3 pos = ray_start;

    // Move pos by a small bias
    pos += ray_dir * 0.008;

    float hit_bias = 0.0017;

    while (mipmap > -1 && max_iter --> 0)
    {

        // Check if we are out of screen bounds, if so, return
        if (pos.x < 0.0 || pos.y < 0.0 || pos.x > 1.0 || pos.y > 1.0 || pos.z < 0.0 || pos.z > 1.0)
        {
            return vec3(0,0,0);
        }

        // Fetch the current minimum cell plane height
        float cell_z = textureLod(DownscaledDepth, pos.xy, mipmap).x;

        // Compute the fractional part of the coordinate (scaled by the working size)
        // so the values will be between 0.0 and 1.0
        vec2 fract_coord = mod(pos.xy * work_size, 1.0);

        // Modify fract coord based on which direction we are stepping in.
        // Fract coord now contains the percentage how far we moved already in
        // the current cell in each direction.
        fract_coord.x = ray_dir.x > 0.0 ? fract_coord.x : 1.0 - fract_coord.x;
        fract_coord.y = ray_dir.y > 0.0 ? fract_coord.y : 1.0 - fract_coord.y;

        // Compute maximum k and minimum k for which the ray would still be
        // inside of the cell.
        vec2 max_k_v = (1.0 / abs(ray_dir.xy)) / work_size.xy;
        vec2 min_k_v = -max_k_v * fract_coord.xy;

        // Scale the maximum k by the percentage we already processed in the current cell,
        // since e.g. if we already moved 50%, we can only move another 50%.
        max_k_v *= 1.0 - fract_coord.xy;

        // The maximum k is the minimum of the both sub-k's since if one component-maximum
        // is reached, the ray is out of the cell
        float max_k = min(max_k_v.x, max_k_v.y);

        // Same applies to the min_k, but because min_k is negative we have to use max()
        float min_k = max(min_k_v.x, min_k_v.y);

        // Check if the ray intersects with the cell plane. We have the following
        // equation:
        // pos.z + k * ray_dir.z = cell.z
        // So k is:
        float k = (cell_z - pos.z) / ray_dir.z;

        // Optional: Abort when ray didn't exactly intersect:
        // if (k < min_k && mipmap <= 0) {
        //     return vec3(0);
        // }

        // Check if we intersected the cell
        if (k < max_k + hit_bias)
        {
            // Clamp k
            k = max(min_k, k);

            if (mipmap < 1) {
                pos += k * ray_dir;
                return pos;
            }

            // If we hit anything at a higher mipmap, step up to a higher detailed
            // mipmap:
            mipmap -= 2;
            work_size *= 4;
        } else {

            // If we hit nothing, move to the next cell, with a small bias
            pos += max_k * ray_dir * 1.04;
        }

        mipmap += 1;
        work_size /= 2;
    }

    return vec3(0);
}
*/
/*
float2 cell(float2 ray, float2 cell_count, uint camera) {
 return floor(ray.xy * cell_count);
}

float2 cell_count(float level) {
 return input_texture2_size / (level == 0.0 ? 1.0 : exp2(level));
}

float3 intersect_cell_boundary(float3 pos, float3 dir, float2 cell_id, float2 cell_count, float2 cross_step, float2 cross_offset, uint camera) {
 float2 cell_size = 1.0 / cell_count;
 float2 planes = cell_id/cell_count + cell_size * cross_step;

 float2 solutions = (planes - pos)/dir.xy;
 float3 intersection_pos = pos + dir * min(solutions.x, solutions.y);

 intersection_pos.xy += (solutions.x < solutions.y) ? float2(cross_offset.x, 0.0) : float2(0.0, cross_offset.y);

 return intersection_pos;
}

bool crossed_cell_boundary(float2 cell_id_one, float2 cell_id_two) {
 return (int)cell_id_one.x != (int)cell_id_two.x || (int)cell_id_one.y != (int)cell_id_two.y;
}

float minimum_depth_plane(float2 ray, float level, float2 cell_count, uint camera) {
 return input_texture2.Load(int3(vr_stereo_to_mono(ray.xy, camera) * cell_count, level)).r;
}

float3 hi_z_trace(float3 p, float3 v, in uint camera, out uint iterations) {
 float level = HIZ_START_LEVEL;
 float3 v_z = v/v.z;
 float2 hi_z_size = cell_count(level);
 float3 ray = p;

 float2 cross_step = float2(v.x >= 0.0 ? 1.0 : -1.0, v.y >= 0.0 ? 1.0 : -1.0);
 float2 cross_offset = cross_step * 0.00001;
 cross_step = saturate(cross_step);

 float2 ray_cell = cell(ray.xy, hi_z_size.xy, camera);
 ray = intersect_cell_boundary(ray, v, ray_cell, hi_z_size, cross_step, cross_offset, camera);

 iterations = 0;
 while(level >= HIZ_STOP_LEVEL && iterations < MAX_ITERATIONS) {
  // get the cell number of the current ray
  float2 current_cell_count = cell_count(level);
  float2 old_cell_id = cell(ray.xy, current_cell_count, camera);

  // get the minimum depth plane in which the current ray resides
  float min_z = minimum_depth_plane(ray.xy, level, current_cell_count, camera);

  // intersect only if ray depth is below the minimum depth plane
  float3 tmp_ray = ray;
  if(v.z > 0) {
   float min_minus_ray = min_z - ray.z;
   tmp_ray = min_minus_ray > 0 ? ray + v_z*min_minus_ray : tmp_ray;
   float2 new_cell_id = cell(tmp_ray.xy, current_cell_count, camera);
   if(crossed_cell_boundary(old_cell_id, new_cell_id)) {
    tmp_ray = intersect_cell_boundary(ray, v, old_cell_id, current_cell_count, cross_step, cross_offset, camera);
    level = min(HIZ_MAX_LEVEL, level + 2.0f);
   }else{
    if(level == 1 && abs(min_minus_ray) > 0.0001) {
     tmp_ray = intersect_cell_boundary(ray, v, old_cell_id, current_cell_count, cross_step, cross_offset, camera);
     level = 2;
    }
   }
  } else if(ray.z < min_z) {
   tmp_ray = intersect_cell_boundary(ray, v, old_cell_id, current_cell_count, cross_step, cross_offset, camera);
   level = min(HIZ_MAX_LEVEL, level + 2.0f);
  }

  ray.xyz = tmp_ray.xyz;
  --level;

  ++iterations;
 }
 return ray;
}
*/

/**
 * Texture format for the Hi-Z pyramid.
 *
 * Half float under reverse-Z and full float otherwise, because reverse-Z spends
 * float's relative precision where the depth is: a 16-bit mantissa there is
 * worth a few centimetres at a hundred metres, while a linear-Z half float
 * would quantise the near field into steps.
 *
 * `withNearest` adds the nearest-depth channel. It doubles the pyramid's
 * bandwidth, so it is only requested by a frame that has a consumer for it.
 */
export function getHiZFormat(withNearest: boolean): TextureFormat {
  if (withNearest) {
    return REVERSE_Z ? 'rg16f' : 'rg32f';
  }
  return REVERSE_Z ? 'r16f' : 'r32f';
}

/** Whether a Hi-Z texture of this format carries the nearest-depth channel. */
export function hasNearestChannel(format: TextureFormat): boolean {
  return format === 'rg16f' || format === 'rg32f';
}

function buildHZBProgram(device: AbstractDevice, twoChannel: boolean) {
  const program = device.buildRenderProgram({
    label: 'HZBBuilder',
    vertex(pb) {
      this.$inputs.pos = pb.vec2().attrib('position');
      this.$outputs.uv = pb.vec2();
      pb.main(function () {
        this.$builtins.position = pb.vec4(this.$inputs.pos, DEPTH_FARTHEST, 1);
        this.$outputs.uv = pb.add(pb.mul(this.$inputs.pos.xy, 0.5), pb.vec2(0.5));
        if (device.type === 'webgpu') {
          this.$builtins.position.y = pb.neg(this.$builtins.position.y);
        }
      });
    },
    fragment(pb) {
      this.$outputs.color = pb.vec4();
      this.srcTex = pb.tex2D().sampleType('unfilterable-float').uniform(0);
      this.srcSize = pb.ivec2().uniform(0);
      if (device.type !== 'webgpu') {
        this.srcMipLevel = pb.int().uniform(0);
      }
      pb.main(function () {
        this.$l.coord = pb.mul(pb.ivec2(this.$builtins.fragCoord.xy), 2);
        this.$l.minCoord = pb.ivec2(0, 0);
        this.$l.maxCoord = pb.sub(this.srcSize, pb.ivec2(1, 1));
        for (let i = 0; i < 4; i++) {
          this.$l[`d${i}`] = pb.textureLoad(
            this.srcTex,
            pb.clamp(pb.add(this.coord, pb.ivec2(i >> 1, i & 1)), this.minCoord, this.maxCoord),
            device.type === 'webgpu' ? 0 : this.srcMipLevel
          );
        }
        // Furthest-depth reduction (max under standard Z, min under reverse Z).
        // This is the conservative direction for occlusion: a cell reports the
        // depth nothing behind it can be in front of.
        this.$l.maxDepth = pb[DEPTH_REDUCE_FARTHER](
          pb[DEPTH_REDUCE_FARTHER](this.d0.r, this.d1.r),
          pb[DEPTH_REDUCE_FARTHER](this.d2.r, this.d3.r)
        );
        if (twoChannel) {
          // Nearest-depth reduction, from the green channel. The opposite
          // conservative direction, and the one a proximity query needs: a cell
          // reports the closest surface anywhere inside it, so a query that
          // covers the cell cannot miss geometry that is in there.
          this.$l.minDepth = pb[DEPTH_REDUCE_CLOSER](
            pb[DEPTH_REDUCE_CLOSER](this.d0.g, this.d1.g),
            pb[DEPTH_REDUCE_CLOSER](this.d2.g, this.d3.g)
          );
          this.$outputs.color = pb.vec4(this.maxDepth, this.minDepth, 0, 1);
        } else {
          this.$outputs.color = pb.vec4(this.maxDepth, 0, 0, 1);
        }
      });
    }
  })!;
  program.name = `@HZB_Builder${twoChannel ? '_MinMax' : ''}`;
  return program;
}

function getHiZBindGroup(tex: BaseTexture, mip: number, program: GPUProgram) {
  let info = hzbBindGroupCache.get(tex);
  if (!info) {
    info = [];
    hzbBindGroupCache.set(tex, info);
  }
  if (!info[mip]) {
    info[mip] = tex.device.createBindGroup(program.bindGroupLayouts[0]);
    srcSize[0] = Math.max(tex.width >> mip, 1);
    srcSize[1] = Math.max(tex.height >> mip, 1);
    info[mip].setValue('srcSize', srcSize);
    if (tex.device.type === 'webgpu') {
      info[mip].setTextureView('srcTex', tex, mip, 0, 1, fetchSampler('clamp_nearest'));
    } else {
      info[mip].setTexture('srcTex', tex, fetchSampler('clamp_nearest'));
      info[mip].setValue('srcMipLevel', mip);
    }
  }
  return info[mip];
}

function buildHiZLevel(
  device: AbstractDevice,
  miplevel: number,
  srcTexture: Texture2D,
  dstTexture: Texture2D,
  program: GPUProgram
) {
  const framebuffer = device.pool.fetchTemporalFramebuffer(
    false,
    0,
    0,
    [dstTexture],
    null,
    false,
    1,
    true,
    miplevel + 1
  );
  framebuffer.setColorAttachmentGenerateMipmaps(0, false);
  device.setProgram(program);
  device.setBindGroup(0, getHiZBindGroup(srcTexture, miplevel, program));
  device.setFramebuffer(framebuffer);
  drawFullscreenQuad();
  if (srcTexture !== dstTexture) {
    device.copyFramebufferToTexture2D(framebuffer, 0, srcTexture, miplevel + 1);
  }
  device.pool.releaseFrameBuffer(framebuffer);
}

/**
 * Builds the Hi-Z pyramid from the depth prepass.
 *
 * The target's channel count picks the variant: a one-channel target carries
 * only the farthest-depth pyramid the occlusion tests want, a two-channel one
 * adds the nearest-depth pyramid in green for proximity queries. Keyed off the
 * texture rather than a flag so the pyramid and its consumer cannot disagree
 * about what is in green.
 */
export function buildHiZ(sourceTex: Texture2D, HiZFrameBuffer: FrameBuffer) {
  const device = getDevice();
  const dstTex = HiZFrameBuffer.getColorAttachments()[0] as Texture2D;
  const twoChannel = hasNearestChannel(dstTex.format);
  const variant = twoChannel ? 1 : 0;
  if (!hzbProgram[variant]) {
    hzbProgram[variant] = buildHZBProgram(device, twoChannel);
    blitter[variant] = new HiZInitBlitter(twoChannel);
  }
  const program = hzbProgram[variant]!;
  blitter[variant]!.blit(sourceTex, HiZFrameBuffer, fetchSampler('clamp_nearest'));
  device.pushDeviceStates();
  const srcTex = HiZFrameBuffer.getColorAttachments()[0] as Texture2D;
  if (device.type === 'webgpu') {
    for (let i = 0; i < srcTex.mipLevelCount - 1; i++) {
      buildHiZLevel(device, i, srcTex, srcTex, program);
    }
  } else {
    const tmpFramebuffer = device.pool.fetchTemporalFramebuffer(
      false,
      HiZFrameBuffer.getWidth(),
      HiZFrameBuffer.getHeight(),
      HiZFrameBuffer.getColorAttachments()[0].format,
      null,
      true
    );
    const tmpTex = tmpFramebuffer.getColorAttachments()[0] as Texture2D;
    for (let i = 0; i < srcTex.mipLevelCount - 1; i++) {
      buildHiZLevel(device, i, srcTex, tmpTex, program);
    }
    device.pool.releaseFrameBuffer(tmpFramebuffer);
  }
  device.popDeviceStates();
}
