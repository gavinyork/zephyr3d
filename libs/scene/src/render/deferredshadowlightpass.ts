import type { BindGroup, GPUProgram, RenderStateSet, Texture2D } from '@zephyr3d/device';
import type { DrawContext } from './drawable';
import { drawFullscreenQuad } from './fullscreenquad';
import { fetchSampler } from '../utility/misc';
import type { PunctualLight } from '../scene';
import { ShaderHelper } from '../material/shader/helper';
import { decodeNormalizedFloatFromRGBA } from '../shaders/misc';
import { distributionGGX, fresnelSchlick, visGGX } from '../shaders/pbr';
import {
  LIGHT_TYPE_POINT,
  LIGHT_TYPE_RECT,
  LIGHT_TYPE_SPOT,
  RENDER_PASS_TYPE_LIGHT
} from '../values';

/**
 * Deferred single shadowed-light accumulation pass.
 *
 * Renders one fullscreen additive pass per shadow-casting light and reuses the
 * existing shadow map sampling pipeline via ShaderHelper/ShadowMapper.
 * @internal
 */
export class DeferredShadowLightPass {
  private static _programs: Record<string, GPUProgram> = {};
  private static _bindGroups: Record<string, BindGroup> = {};
  private static _additiveRenderStates: RenderStateSet | null = null;
  private static _multiplyRenderStates: RenderStateSet | null = null;

  render(
    ctx: DrawContext,
    light: PunctualLight,
    gbufferColor: Texture2D,
    gbufferRoughness: Texture2D,
    gbufferNormal: Texture2D,
    debugShadowTermOnly = false
  ) {
    if (!ctx.shadowMapInfo?.has(light) || !ctx.linearDepthTexture) {
      return;
    }
    const shadowMapParams = ctx.shadowMapInfo.get(light)!;
    const device = ctx.device;
    const prevLight = ctx.currentShadowLight ?? null;
    const prevRenderPass = ctx.renderPass;
    ctx.currentShadowLight = light;
    ctx.renderPass = { type: RENDER_PASS_TYPE_LIGHT } as any;
    const hash = `${device.type}:${shadowMapParams.shaderHash}:deferred-shadow:${debugShadowTermOnly ? 1 : 0}`;
    let program = DeferredShadowLightPass._programs[hash];
    if (!program) {
      const isWebGL = device.type === 'webgl';
      const builtProgram = device.buildRenderProgram({
        label: 'DeferredShadowLightPass',
        vertex(pb) {
          this.$inputs.pos = pb.vec2().attrib('position');
          pb.main(function () {
            this.$builtins.position = pb.vec4(this.$inputs.pos, 1, 1);
            if (device.type === 'webgpu') {
              this.$builtins.position.y = pb.neg(this.$builtins.position.y);
            }
          });
        },
        fragment(pb) {
          ShaderHelper.prepareFragmentShader(pb, ctx);
          this.gbufferColorTex = pb.tex2D().uniform(0);
          this.gbufferRoughnessTex = pb.tex2D().uniform(0);
          this.gbufferNormalTex = pb.tex2D().uniform(0);
          this.linearDepthTex = pb.tex2D().uniform(0);
          this.cameraPos = pb.vec3().uniform(0);
          this.cameraRight = pb.vec3().uniform(0);
          this.cameraUp = pb.vec3().uniform(0);
          this.cameraForward = pb.vec3().uniform(0);
          this.cameraProj = pb.vec2().uniform(0); // x: tanHalfFovy, y: aspect
          this.cameraNearFar = pb.vec2().uniform(0);
          this.debugShadowTermOnly = pb.int().uniform(0);
          this.$outputs.color = pb.vec4();
          pb.func('zGetLinearDepth', [], function () {
            this.$l.uv = pb.div(pb.vec2(this.$builtins.fragCoord.xy), ShaderHelper.getRenderSize(this));
            this.$l.depthSample = pb.textureSample(this.linearDepthTex, this.uv);
            if (isWebGL) {
              this.$return(decodeNormalizedFloatFromRGBA(this, this.depthSample));
            } else {
              this.$return(this.depthSample.r);
            }
          });
          pb.func(
            'zPointAtten',
            [pb.float('dist'), pb.float('range')],
            function () {
              this.$l.falloff = pb.max(0, pb.sub(1, pb.div(this.dist, pb.max(this.range, 1e-4))));
              this.$return(pb.mul(this.falloff, this.falloff));
            }
          );
          pb.func(
            'zSpotAtten',
            [pb.vec3('worldPos'), pb.vec4('posRange'), pb.vec4('dirCutoff'), pb.float('dist')],
            function () {
              this.$l.base = this.zPointAtten(this.dist, this.posRange.w);
              this.$l.spotFactor = pb.dot(pb.normalize(pb.sub(this.worldPos, this.posRange.xyz)), this.dirCutoff.xyz);
              this.spotFactor = pb.smoothStep(
                this.dirCutoff.w,
                pb.mix(this.dirCutoff.w, 1, 0.5),
                this.spotFactor
              );
              this.$return(pb.mul(this.base, this.spotFactor));
            }
          );
          pb.main(function () {
            this.$l.uv = pb.div(pb.vec2(this.$builtins.fragCoord.xy), ShaderHelper.getRenderSize(this));
            this.$l.base = pb.textureSample(this.gbufferColorTex, this.uv);
            this.$l.rm = pb.textureSample(this.gbufferRoughnessTex, this.uv);
            this.$l.n = pb.normalize(
              pb.sub(pb.mul(pb.textureSample(this.gbufferNormalTex, this.uv).xyz, 2), pb.vec3(1))
            );
            this.$l.metallic = pb.clamp(this.rm.r, 0, 1);
            this.$l.specularStrength = pb.clamp(this.rm.b, 0, 1);
            this.$l.roughness = pb.clamp(this.rm.a, 0.045, 1);
            this.$l.ndc = pb.sub(pb.mul(this.uv, 2), pb.vec2(1));
            this.$l.xScale = pb.mul(this.cameraProj.x, this.cameraProj.y);
            this.$l.yScale = this.cameraProj.x;
            this.$l.camRayDir = pb.normalize(
              pb.add(
                this.cameraForward,
                pb.mul(this.cameraRight, pb.mul(this.ndc.x, this.xScale)),
                pb.mul(this.cameraUp, pb.mul(this.ndc.y, this.yScale))
              )
            );
            this.$l.linearDepthNormalized = this.zGetLinearDepth();
            this.$l.linearDepth = pb.mul(
              pb.clamp(this.linearDepthNormalized, 0, 1),
              this.cameraNearFar.y
            );
            this.$l.validMask = pb.float(pb.lessThan(this.linearDepthNormalized, 1));
            this.$l.rayScale = pb.max(pb.dot(this.camRayDir, this.cameraForward), 1e-4);
            this.$l.worldPos = pb.add(
              this.cameraPos,
              pb.mul(this.camRayDir, pb.div(this.linearDepth, this.rayScale))
            );
            this.$l.viewDir = pb.neg(this.camRayDir);
            this.$l.lightType = pb.int(this.light.extraParams.w);
            this.$l.posRange = this.light.positionAndRange;
            this.$l.dirCutoff = this.light.directionAndCutoff;
            this.$l.lightColor = pb.mul(this.light.diffuseAndIntensity.rgb, this.light.diffuseAndIntensity.a);
            this.$l.extra = this.light.extraParams;
            this.$l.L = pb.vec3(0, 0, 1);
            this.$l.atten = pb.float(1);
            this.$if(
              pb.or(
                pb.equal(this.lightType, LIGHT_TYPE_POINT),
                pb.equal(this.lightType, LIGHT_TYPE_SPOT),
                pb.equal(this.lightType, LIGHT_TYPE_RECT)
              ),
              function () {
                this.$l.toLight = pb.sub(this.posRange.xyz, this.worldPos);
                this.$l.dist = pb.length(this.toLight);
                this.L = pb.div(this.toLight, pb.max(this.dist, 1e-4));
                this.atten = this.zPointAtten(this.dist, this.posRange.w);
                this.$if(pb.equal(this.lightType, LIGHT_TYPE_SPOT), function () {
                  this.atten = this.zSpotAtten(this.worldPos, this.posRange, this.dirCutoff, this.dist);
                });
              }
            ).$else(function () {
              // Directional and rect-light directional path.
              this.L = pb.normalize(pb.neg(this.dirCutoff.xyz));
              this.atten = 1;
            });
            this.$l.NoL = pb.clamp(pb.dot(this.n, this.L), 0, 1);
            this.$l.litMask = pb.mul(this.validMask, pb.float(pb.greaterThan(this.NoL, 1e-5)));
            this.$l.NoV = pb.clamp(pb.dot(this.n, this.viewDir), 0, 1);
            this.$l.H = pb.normalize(pb.add(this.viewDir, this.L));
            this.$l.NoH = pb.clamp(pb.dot(this.n, this.H), 0, 1);
            this.$l.VoH = pb.clamp(pb.dot(this.viewDir, this.H), 0, 1);
            this.$l.f0 = pb.mix(pb.mul(pb.vec3(0.04), this.specularStrength), this.base.rgb, this.metallic);
            this.$l.F = fresnelSchlick(this, this.VoH, this.f0, pb.vec3(1));
            this.$l.alphaRoughness = pb.mul(this.roughness, this.roughness);
            this.$l.D = distributionGGX(this, this.NoH, this.alphaRoughness);
            this.$l.V = visGGX(this, this.NoV, this.NoL, this.alphaRoughness);
            this.$l.diffuseBRDF = pb.mul(
              pb.sub(pb.vec3(1), this.F),
              pb.div(pb.mul(this.base.rgb, pb.sub(1, this.metallic)), Math.PI)
            );
            // Keep shadow sampling in uniform control flow for WebGPU derivatives (dpdx/ddy in PCF).
            this.$l.shadow = ShaderHelper.calculateShadow(this, this.worldPos, pb.max(this.NoL, 1e-5), ctx);
            this.shadow = pb.mix(1, this.shadow, this.validMask);
            this.$if(pb.notEqual(this.debugShadowTermOnly, 0), function () {
              this.$outputs.color = pb.vec4(pb.vec3(this.shadow), 1);
            }).$else(function () {
              this.$l.unshadowedColor = pb.mul(this.lightColor, this.atten, this.NoL);
              this.$l.punctualColor = pb.mul(this.unshadowedColor, this.shadow, this.litMask);
              this.$l.diffScale = this.$choice(
                pb.equal(this.lightType, LIGHT_TYPE_POINT),
                this.extra.x,
                pb.float(1)
              );
              this.$l.specScale = this.$choice(
                pb.equal(this.lightType, LIGHT_TYPE_POINT),
                this.extra.y,
                pb.float(1)
              );
              this.$l.diffuse = pb.mul(
                this.punctualColor,
                pb.max(this.diffuseBRDF, pb.vec3(0)),
                this.diffScale
              );
              this.$l.specular = pb.mul(this.punctualColor, this.D, this.V, this.F, this.specScale);
              this.$l.outLight = pb.max(pb.add(this.diffuse, this.specular), pb.vec3(0));
              this.$outputs.color = pb.vec4(this.outLight, 0);
            });
          });
        }
      });
      if (!builtProgram) {
        ctx.currentShadowLight = prevLight;
        ctx.renderPass = prevRenderPass;
        return;
      }
      program = builtProgram;
      program.name = '@DeferredShadowLightPass';
      DeferredShadowLightPass._programs[hash] = program;
    }
    let bindGroup = DeferredShadowLightPass._bindGroups[hash];
    if (!bindGroup) {
      bindGroup = device.createBindGroup(program.bindGroupLayouts[0]);
      DeferredShadowLightPass._bindGroups[hash] = bindGroup;
    }
    bindGroup.setTexture('gbufferColorTex', gbufferColor, fetchSampler('clamp_nearest_nomip'));
    bindGroup.setTexture('gbufferRoughnessTex', gbufferRoughness, fetchSampler('clamp_nearest_nomip'));
    bindGroup.setTexture('gbufferNormalTex', gbufferNormal, fetchSampler('clamp_nearest_nomip'));
    bindGroup.setTexture('linearDepthTex', ctx.linearDepthTexture, fetchSampler('clamp_nearest_nomip'));
    const cameraRight = ctx.camera.worldMatrix.getRow(0).xyz().inplaceNormalize();
    const cameraUp = ctx.camera.worldMatrix.getRow(1).xyz().inplaceNormalize();
    const cameraForward = ctx.camera.worldMatrix.getRow(2).xyz().inplaceNormalize().scaleBy(-1);
    const cameraPos = ctx.camera.getWorldPosition();
    bindGroup.setValue('cameraRight', new Float32Array([cameraRight.x, cameraRight.y, cameraRight.z]));
    bindGroup.setValue('cameraUp', new Float32Array([cameraUp.x, cameraUp.y, cameraUp.z]));
    bindGroup.setValue('cameraForward', new Float32Array([cameraForward.x, cameraForward.y, cameraForward.z]));
    bindGroup.setValue('cameraPos', new Float32Array([cameraPos.x, cameraPos.y, cameraPos.z]));
    bindGroup.setValue('cameraProj', new Float32Array([ctx.camera.getTanHalfFovy(), ctx.camera.getAspect()]));
    bindGroup.setValue('cameraNearFar', new Float32Array([ctx.camera.getNearPlane(), ctx.camera.getFarPlane()]));
    bindGroup.setValue('debugShadowTermOnly', debugShadowTermOnly ? 1 : 0);
    ShaderHelper.setCameraUniforms(bindGroup, ctx, ctx.camera, !!ctx.device.getFramebuffer());
    ShaderHelper.setLightUniformsShadow(bindGroup, ctx, light);
    if (!DeferredShadowLightPass._additiveRenderStates) {
      DeferredShadowLightPass._additiveRenderStates = device.createRenderStateSet();
      DeferredShadowLightPass._additiveRenderStates.useDepthState().enableTest(false).enableWrite(false);
      DeferredShadowLightPass._additiveRenderStates.useRasterizerState().setCullMode('none');
      DeferredShadowLightPass._additiveRenderStates
        .useBlendingState()
        .enable(true)
        .setBlendEquation('add', 'add')
        .setBlendFuncRGB('one', 'one')
        .setBlendFuncAlpha('zero', 'one');
    }
    if (!DeferredShadowLightPass._multiplyRenderStates) {
      DeferredShadowLightPass._multiplyRenderStates = device.createRenderStateSet();
      DeferredShadowLightPass._multiplyRenderStates.useDepthState().enableTest(false).enableWrite(false);
      DeferredShadowLightPass._multiplyRenderStates.useRasterizerState().setCullMode('none');
      DeferredShadowLightPass._multiplyRenderStates
        .useBlendingState()
        .enable(true)
        .setBlendEquation('add', 'add')
        .setBlendFuncRGB('zero', 'src-color')
        .setBlendFuncAlpha('zero', 'one');
    }
    const oldRenderStates = device.getRenderStates();
    device.setRenderStates(
      debugShadowTermOnly
        ? DeferredShadowLightPass._multiplyRenderStates
        : DeferredShadowLightPass._additiveRenderStates
    );
    device.setProgram(program);
    device.setBindGroup(0, bindGroup);
    drawFullscreenQuad();
    device.setRenderStates(oldRenderStates);
    ctx.currentShadowLight = prevLight;
    ctx.renderPass = prevRenderPass;
  }
}
