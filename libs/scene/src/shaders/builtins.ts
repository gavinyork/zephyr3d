import type { PBGlobalScope, PBInsideFunctionScope, PBShaderExp } from '@zephyr3d/device';
import type { DrawContext } from '../render';
import { ShaderFramework, encodeColorOutput } from '.';
import { ScatteringLut } from '../render/scatteringlut';

export const MESH_MATERIAL = {
  FRAGMENT_SHADER(scope: PBGlobalScope, ctx: DrawContext) {
    ShaderFramework.prepareFragmentShader(scope.$builder, ctx);
  },
  VERTEX_SHADER(scope: PBGlobalScope, ctx: DrawContext) {
    ShaderFramework.prepareVertexShader(scope.$builder, ctx);
  },
  FTRANSFORM(scope: PBInsideFunctionScope) {
    ShaderFramework.ftransform(scope);
  },
  DEFINE_VERTEX_COLOR(color: PBShaderExp) {
    return color.tag(ShaderFramework.USAGE_VERTEX_COLOR);
  },
  DEFINE_WORLD_NORMAL(normal: PBShaderExp) {
    return normal.tag(ShaderFramework.USAGE_WORLD_NORMAL);
  },
  DEFINE_WORLD_TANGENT(tangent: PBShaderExp) {
    return tangent.tag(ShaderFramework.USAGE_WORLD_TANGENT);
  },
  DEFINE_WORLD_BINORMAL(binormal: PBShaderExp) {
    return binormal.tag(ShaderFramework.USAGE_WORLD_BINORMAL);
  },
  DEFINE_WORLD_POSITION(pos: PBShaderExp) {
    return pos.tag(ShaderFramework.USAGE_WORLD_POSITION);
  },
  FRAGMENT_OUTPUT(scope: PBInsideFunctionScope, color: PBShaderExp) {
    return encodeColorOutput(scope, color);
  },
  GET_WORLD_MATRIX(scope: PBInsideFunctionScope) {
    return ShaderFramework.getWorldMatrix(scope);
  },
  GET_VIEW_PROJ_MATRIX(scope: PBInsideFunctionScope) {
    return ShaderFramework.getViewProjectionMatrix(scope);
  },
  GET_ENVLIGHT_STRENGTH(scope: PBInsideFunctionScope): PBShaderExp {
    return ShaderFramework.getEnvLightStrength(scope);
  },
  GET_CAMERA_POSITION(scope: PBInsideFunctionScope): PBShaderExp {
    return ShaderFramework.getCameraPosition(scope);
  },
  GET_CAMERA_PARAMS(scope: PBInsideFunctionScope): PBShaderExp {
    return ShaderFramework.getCameraParams(scope);
  },
  GET_WORLD_POSITION(scope: PBInsideFunctionScope): PBShaderExp {
    return ShaderFramework.getWorldPosition(scope);
  },
  GET_WORLD_NORMAL(scope: PBInsideFunctionScope): PBShaderExp {
    return ShaderFramework.getWorldNormal(scope);
  },
  GET_WORLD_TANGENT(scope: PBInsideFunctionScope): PBShaderExp {
    return ShaderFramework.getWorldTangent(scope);
  },
  GET_WORLD_BINORMAL(scope: PBInsideFunctionScope): PBShaderExp {
    return ShaderFramework.getWorldBinormal(scope);
  },
  SET_CLIP_SPACE_POSITION(scope: PBInsideFunctionScope, pos: PBShaderExp) {
    ShaderFramework.setClipSpacePosition(scope, pos);
  },
  DISCARD_IF_CLIPPED(scope: PBInsideFunctionScope) {
    ShaderFramework.discardIfClipped(scope);
  },
  APPLY_FOG(scope: PBInsideFunctionScope, color: PBShaderExp, ctx: DrawContext) {
    if (ctx.applyFog) {
      const pb = scope.$builder;
      if (ctx.env.sky.drawScatteredFog(ctx)) {
        const funcName = 'applyAerialPerspective';
        pb.func(funcName, [pb.vec4('color').inout()], function () {
          this.$l.viewDir = pb.sub(
            ShaderFramework.getWorldPosition(this).xyz,
            ShaderFramework.getCameraPosition(this)
          );
          this.viewDir.y = pb.max(this.viewDir.y, 0);
          this.$l.distance = pb.mul(pb.length(this.viewDir), ShaderFramework.getWorldUnit(this));
          this.$l.sliceDist = pb.div(
            pb.mul(ShaderFramework.getCameraParams(this).y, ShaderFramework.getWorldUnit(this)),
            ScatteringLut.aerialPerspectiveSliceZ
          );
          this.$l.slice0 = pb.floor(pb.div(this.distance, this.sliceDist));
          this.$l.slice1 = pb.add(this.slice0, 1);
          this.$l.factor = pb.sub(pb.div(this.distance, this.sliceDist), this.slice0);
          this.$l.viewNormal = pb.normalize(this.viewDir);
          this.$l.zenithAngle = pb.asin(this.viewNormal.y);
          this.$l.horizonAngle = pb.atan2(this.viewNormal.z, this.viewNormal.x);
          this.$l.u0 = pb.div(
            pb.add(this.slice0, pb.div(this.horizonAngle, Math.PI * 2)),
            ScatteringLut.aerialPerspectiveSliceZ
          );
          this.$l.u1 = pb.add(this.u0, 1 / ScatteringLut.aerialPerspectiveSliceZ);
          this.$l.v = pb.div(this.zenithAngle, Math.PI / 2);
          this.$l.t0 = pb.textureSampleLevel(
            ShaderFramework.getAerialPerspectiveLUT(this),
            pb.vec2(this.u0, this.v),
            0
          );
          this.$l.t1 = pb.textureSampleLevel(
            ShaderFramework.getAerialPerspectiveLUT(this),
            pb.vec2(this.u1, this.v),
            0
          );
          this.$l.t = pb.mix(this.t0, this.t1, this.factor);
          this.color = pb.vec4(pb.add(pb.mul(this.color.rgb, this.factor), this.t.rgb), this.color.a);
        });
        scope[funcName](color);
      } else {
        const funcName = 'applyFog';
        pb.func(funcName, [pb.vec4('color').inout()], function () {
          this.$l.viewDir = pb.sub(
            ShaderFramework.getWorldPosition(this).xyz,
            ShaderFramework.getCameraPosition(this)
          );
          this.$l.fogFactor = ShaderFramework.computeFogFactor(
            this,
            this.viewDir,
            ShaderFramework.getFogType(this),
            ShaderFramework.getFogParams(this)
          );
          this.color = pb.vec4(
            pb.mix(
              this.color.rgb,
              ShaderFramework.getFogColor(this).rgb,
              pb.mul(this.fogFactor, this.color.a, this.color.a)
            ),
            this.color.a
          );
        });
        scope[funcName](color);
      }
    }
  }
};
