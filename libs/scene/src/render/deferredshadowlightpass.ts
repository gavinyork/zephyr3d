import { Vector2, Vector4 } from '@zephyr3d/base';
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
  private static getProgramHash(
    deviceType: string,
    shaderHash: string,
    debugShadowTermOnly: boolean,
    hasSceneColor: boolean,
    hasHiZ: boolean,
    hasLinearDepth: boolean
  ) {
    return `${deviceType}:${shaderHash}:deferred-shadow:${debugShadowTermOnly ? 1 : 0}:scene:${
      hasSceneColor ? 1 : 0
    }:hiz:${hasHiZ ? 1 : 0}:depth:${hasLinearDepth ? 1 : 0}`;
  }

  private static hasTextureUniform(bindGroup: BindGroup, program: GPUProgram, name: string) {
    const bindGroupLayout = (bindGroup as any).getLayout?.() ?? program.bindGroupLayouts[0];
    return !!bindGroupLayout?.entries?.some(
      (entry: any) => entry.name === name && (entry.texture || entry.storageTexture || entry.externalTexture)
    );
  }

  private static bindOptionalSceneTextures(bindGroup: BindGroup, program: GPUProgram, ctx: DrawContext) {
    if (ctx.linearDepthTexture && this.hasTextureUniform(bindGroup, program, 'Z_UniformLinearDepth')) {
      bindGroup.setTexture('Z_UniformLinearDepth', ctx.linearDepthTexture, fetchSampler('clamp_nearest_nomip'));
      bindGroup.setValue(
        'Z_UniformLinearDepthSize',
        new Vector2(ctx.linearDepthTexture.width, ctx.linearDepthTexture.height)
      );
    }
    if (ctx.sceneColorTexture && this.hasTextureUniform(bindGroup, program, 'Z_UniformSceneColor')) {
      bindGroup.setTexture('Z_UniformSceneColor', ctx.sceneColorTexture, fetchSampler('clamp_nearest_nomip'));
      bindGroup.setValue(
        'Z_UniformSceneColorSize',
        new Vector2(ctx.sceneColorTexture.width, ctx.sceneColorTexture.height)
      );
    }
    if (ctx.HiZTexture && this.hasTextureUniform(bindGroup, program, 'Z_UniformHiZDepth')) {
      bindGroup.setTexture('Z_UniformHiZDepth', ctx.HiZTexture, fetchSampler('clamp_nearest'));
      bindGroup.setValue(
        'Z_UniformHiZDepthInfo',
        new Vector4(ctx.HiZTexture.width, ctx.HiZTexture.height, ctx.HiZTexture.mipLevelCount, 0)
      );
    }
  }

  private static getCameraUniforms(ctx: DrawContext) {
    const cameraPos = ctx.camera.getWorldPosition();
    return {
      position: new Vector4(cameraPos.x, cameraPos.y, cameraPos.z, 0),
      renderSize: new Vector2(ctx.renderWidth, ctx.renderHeight),
      viewProjectionMatrix: ctx.camera.viewProjectionMatrix,
      unjitteredVPMatrix: ctx.camera.viewProjectionMatrix,
      jitteredInvVPMatrix: ctx.camera.invViewProjectionMatrix,
      jitterValue: ctx.camera.jitterValue,
      invViewProjectionMatrix: ctx.camera.invViewProjectionMatrix,
      projectionMatrix: ctx.camera.getProjectionMatrix(),
      invProjectionMatrix: ctx.camera.getInvProjectionMatrix(),
      viewMatrix: ctx.camera.viewMatrix,
      worldMatrix: ctx.camera.worldMatrix,
      params: new Vector4(ctx.camera.getNearPlane(), ctx.camera.getFarPlane(), ctx.flip ? -1 : 1, 0),
      roughnessFactor: ctx.camera.SSR ? ctx.camera.ssrRoughnessFactor : 1,
      shadowDebugCascades: ctx.camera.shadowDebugCascades ? 1 : 0,
      frameDeltaTime: ctx.device.frameInfo.elapsedFrame * 0.001,
      elapsedTime: ctx.device.frameInfo.elapsedOverall * 0.001,
      framestamp: ctx.device.frameInfo.frameCounter
    };
  }

  render(
    ctx: DrawContext,
    light: PunctualLight,
    gbufferColor: Texture2D,
    gbufferRoughness: Texture2D,
    gbufferNormal: Texture2D,
    gbufferExtra: Texture2D,
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
    const hash = DeferredShadowLightPass.getProgramHash(
      device.type,
      shadowMapParams.shaderHash,
      debugShadowTermOnly,
      !!ctx.sceneColorTexture,
      !!ctx.HiZTexture,
      !!ctx.linearDepthTexture
    );
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
          this.gbufferExtraTex = pb.tex2D().uniform(0);
          this.linearDepthTex = pb.tex2D().uniform(0);
          this.cameraPos = pb.vec3().uniform(0);
          this.cameraRight = pb.vec3().uniform(0);
          this.cameraUp = pb.vec3().uniform(0);
          this.cameraForward = pb.vec3().uniform(0);
          this.cameraViewProjection = pb.mat4().uniform(0);
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
          pb.func(
            'zAccumulatePunctualShadowedLight',
            [
              pb.vec3('baseColor'),
              pb.float('metallic'),
              pb.float('roughness'),
              pb.float('specularStrength'),
              pb.vec3('n'),
              pb.vec3('viewDir'),
              pb.float('NoV'),
              pb.vec3('f0'),
              pb.vec3('lightColor'),
              pb.vec3('L'),
              pb.float('atten'),
              pb.float('shadow'),
              pb.float('litMask'),
              pb.float('diffScale'),
              pb.float('specScale'),
              pb.vec3('outLight').inout(),
              pb.float('outShadow').inout()
            ],
            function () {
              this.$l.NoL = pb.clamp(pb.dot(this.n, this.L), 0, 1);
              this.$if(pb.greaterThan(this.NoL, 1e-5), function () {
                this.$l.H = pb.normalize(pb.add(this.viewDir, this.L));
                this.$l.NoH = pb.clamp(pb.dot(this.n, this.H), 0, 1);
                this.$l.VoH = pb.clamp(pb.dot(this.viewDir, this.H), 0, 1);
                this.$l.F = fresnelSchlick(this, this.VoH, this.f0, pb.vec3(1));
                this.$l.alphaRoughness = pb.mul(this.roughness, this.roughness);
                this.$l.D = distributionGGX(this, this.NoH, this.alphaRoughness);
                this.$l.V = visGGX(this, this.NoV, this.NoL, this.alphaRoughness);
                this.$l.diffuseBRDF = pb.mul(
                  pb.sub(pb.vec3(1), this.F),
                  pb.div(pb.mul(this.baseColor, pb.sub(1, this.metallic)), Math.PI)
                );
                this.$l.unshadowedColor = pb.mul(this.lightColor, this.atten, this.NoL);
                this.$l.punctualColor = pb.mul(this.unshadowedColor, this.shadow, this.litMask);
                this.$l.diffuse = pb.mul(
                  this.punctualColor,
                  pb.max(this.diffuseBRDF, pb.vec3(0)),
                  this.diffScale
                );
                this.$l.specular = pb.mul(this.punctualColor, this.D, this.V, this.F, this.specScale);
                this.outLight = pb.add(this.outLight, pb.max(pb.add(this.diffuse, this.specular), pb.vec3(0)));
                this.outShadow = pb.add(this.outShadow, pb.mul(this.shadow, this.litMask));
              });
            }
          );
          pb.func(
            'zSampleLinearDepthAtUV',
            [pb.vec2('uv')],
            function () {
              if (isWebGL) {
                this.$l.depthSample = pb.textureSample(this.linearDepthTex, this.uv);
                this.$return(decodeNormalizedFloatFromRGBA(this, this.depthSample));
              } else {
                this.$l.texSize = pb.ivec2(ShaderHelper.getRenderSize(this));
                this.$l.pixelCoord = pb.clamp(
                  pb.ivec2(pb.mul(this.uv, pb.vec2(this.texSize))),
                  pb.ivec2(0),
                  pb.sub(this.texSize, pb.ivec2(1))
                );
                this.$l.depthSample = pb.textureLoad(this.linearDepthTex, this.pixelCoord, 0);
                this.$return(this.depthSample.r);
              }
            }
          );
          pb.func(
            'zContactShadow',
            [pb.vec3('worldPos'), pb.vec3('L'), pb.int('lightType'), pb.vec4('posRange')],
            function () {
              this.$l.steps = pb.int(8);
              this.$l.maxDistance = this.$choice(
                pb.equal(this.lightType, LIGHT_TYPE_POINT),
                pb.clamp(pb.mul(this.posRange.w, 0.2), 0.2, 3),
                this.$choice(
                  pb.equal(this.lightType, LIGHT_TYPE_SPOT),
                  pb.clamp(pb.mul(this.posRange.w, 0.25), 0.25, 3.5),
                  pb.float(1.5)
                )
              );
              this.$l.stepLen = pb.div(this.maxDistance, pb.float(this.steps));
              this.$l.occlusion = pb.float(0);
              this.$for(pb.int('i'), 1, pb.add(this.steps, 1), function () {
                this.$l.samplePos = pb.add(this.worldPos, pb.mul(this.L, pb.mul(pb.float(this.i), this.stepLen)));
                this.$l.clip = pb.mul(this.cameraViewProjection, pb.vec4(this.samplePos, 1));
                this.$if(pb.lessThanEqual(this.clip.w, 1e-6), function () {
                  this.$continue();
                });
                this.$l.ndc = pb.div(this.clip.xy, this.clip.w);
                this.$l.uv = pb.add(pb.mul(this.ndc, 0.5), pb.vec2(0.5));
                this.$if(
                  pb.or(
                    pb.lessThan(this.uv.x, 0),
                    pb.greaterThan(this.uv.x, 1),
                    pb.lessThan(this.uv.y, 0),
                    pb.greaterThan(this.uv.y, 1)
                  ),
                  function () {
                    this.$continue();
                  }
                );
                this.$l.sceneDepth = pb.mul(this.zSampleLinearDepthAtUV(this.uv), this.cameraNearFar.y);
                this.$l.sampleDepth = pb.dot(pb.sub(this.samplePos, this.cameraPos), this.cameraForward);
                this.$if(pb.greaterThan(pb.sub(this.sampleDepth, this.sceneDepth), 0.02), function () {
                  this.occlusion = pb.add(this.occlusion, 1);
                });
              });
              this.$l.visibility = pb.sub(1, pb.mul(pb.div(this.occlusion, pb.float(this.steps)), 0.65));
              this.$return(pb.clamp(this.visibility, 0, 1));
            }
          );
          pb.func(
            'zAccumulateRectShadowedLight',
            [
              pb.vec3('worldPos'),
              pb.vec3('baseColor'),
              pb.float('metallic'),
              pb.float('roughness'),
              pb.float('specularStrength'),
              pb.vec3('n'),
              pb.vec3('viewDir'),
              pb.float('NoV'),
              pb.vec3('f0'),
              pb.vec4('posRange'),
              pb.vec4('axisX'),
              pb.vec4('axisY'),
              pb.vec4('colorIntensity'),
              pb.float('validMask'),
              pb.vec3('outLight').inout(),
              pb.float('outShadow').inout()
            ],
            function () {
              this.$l.center = this.posRange.xyz;
              this.$l.range = this.posRange.w;
              this.$l.ax = this.axisX.xyz;
              this.$l.ay = this.axisY.xyz;
              this.$l.halfWidth = pb.length(this.ax);
              this.$l.halfHeight = pb.length(this.ay);
              this.$l.area = pb.mul(this.halfWidth, this.halfHeight, 4);
              this.$l.lightNormal = pb.neg(pb.normalize(pb.cross(this.ax, this.ay)));
              this.$if(pb.greaterThan(this.area, 0), function () {
                this.$l.baseRectColor = pb.mul(this.colorIntensity.rgb, this.colorIntensity.a, this.area, 0.25);
                this.$l.samplePos = pb.vec3();
                this.$l.Lvec = pb.vec3();
                this.$l.L = pb.vec3();
                this.$l.dist = pb.float();
                this.$l.invDist2 = pb.float();
                this.$l.NoL_light = pb.float();
                this.$l.falloff = pb.float();
                this.$l.lightSampleColor = pb.vec3();
                this.$l.sampleShadow = pb.float();
                this.$l.contactShadow = pb.float();
                this.$l.sampleLitMask = pb.float();
                this.$l.sampleNoL = pb.float();

                const sample = (u: number, v: number) => {
                  this.samplePos = pb.add(
                    this.center,
                    pb.add(
                      pb.mul(this.ax, pb.sub(pb.mul(u, 2), 1)),
                      pb.mul(this.ay, pb.sub(pb.mul(v, 2), 1))
                    )
                  );
                  this.Lvec = pb.sub(this.samplePos, this.worldPos);
                  this.dist = pb.length(this.Lvec);
                  this.invDist2 = pb.div(1, pb.max(pb.mul(this.dist, this.dist), 0.0001));
                  this.L = pb.normalize(this.Lvec);
                  this.sampleNoL = pb.clamp(pb.dot(this.n, this.L), 0, 1);
                  this.NoL_light = pb.clamp(pb.dot(this.lightNormal, pb.neg(this.L)), 0, 1);
                  // Keep PCF/PCF-PD shadow sampling in uniform control flow.
                  this.sampleShadow = ShaderHelper.calculateShadow(
                    this,
                    this.worldPos,
                    pb.max(this.sampleNoL, 1e-5),
                    ctx
                  );
                  this.sampleShadow = pb.mix(1, this.sampleShadow, this.validMask);
                  this.contactShadow = this.zContactShadow(this.worldPos, this.L, LIGHT_TYPE_RECT, this.posRange);
                  this.sampleShadow = pb.mul(this.sampleShadow, this.contactShadow);
                  this.$if(pb.greaterThan(this.NoL_light, 1e-5), function () {
                    this.falloff = pb.float(1);
                    this.$if(pb.greaterThan(this.range, 0), function () {
                      this.falloff = pb.max(0, pb.sub(1, pb.div(this.dist, this.range)));
                      this.falloff = pb.mul(this.falloff, this.falloff);
                    });
                    this.lightSampleColor = pb.mul(this.baseRectColor, this.invDist2, this.NoL_light);
                    this.sampleLitMask = this.validMask;
                    this.zAccumulatePunctualShadowedLight(
                      this.baseColor,
                      this.metallic,
                      this.roughness,
                      this.specularStrength,
                      this.n,
                      this.viewDir,
                      this.NoV,
                      this.f0,
                      this.lightSampleColor,
                      this.L,
                      this.falloff,
                      this.sampleShadow,
                      this.sampleLitMask,
                      1,
                      1,
                      this.outLight,
                      this.outShadow
                    );
                  });
                };

                sample(0.25, 0.25);
                sample(0.75, 0.25);
                sample(0.25, 0.75);
                sample(0.75, 0.75);
                this.outShadow = pb.mul(this.outShadow, 0.25);
              });
            }
          );
          pb.main(function () {
            this.$l.uv = pb.div(pb.vec2(this.$builtins.fragCoord.xy), ShaderHelper.getRenderSize(this));
            this.$l.base = pb.textureSample(this.gbufferColorTex, this.uv);
            this.$l.rm = pb.textureSample(this.gbufferRoughnessTex, this.uv);
            this.$l.extraData = pb.textureSample(this.gbufferExtraTex, this.uv);
            this.$l.litFlag = pb.float(pb.greaterThan(this.extraData.a, 0.5));
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
            this.$l.outLight = pb.vec3(0);
            this.$l.shadowTerm = pb.float(1);
            this.$if(
              pb.or(
                pb.equal(this.lightType, LIGHT_TYPE_POINT),
                pb.equal(this.lightType, LIGHT_TYPE_SPOT)
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
            this.$l.NoV = pb.clamp(pb.dot(this.n, this.viewDir), 0, 1);
            this.$l.f0 = pb.mix(pb.mul(pb.vec3(0.04), this.specularStrength), this.base.rgb, this.metallic);
            this.$if(pb.equal(this.lightType, LIGHT_TYPE_RECT), function () {
              this.shadowTerm = pb.float(0);
              this.zAccumulateRectShadowedLight(
                this.worldPos,
                this.base.rgb,
                this.metallic,
                this.roughness,
                this.specularStrength,
                this.n,
                this.viewDir,
                this.NoV,
                this.f0,
                this.posRange,
                this.dirCutoff,
                this.extra,
                this.light.diffuseAndIntensity,
                pb.mul(this.validMask, this.litFlag),
                this.outLight,
                this.shadowTerm
              );
            }).$else(function () {
              this.$l.NoL = pb.clamp(pb.dot(this.n, this.L), 0, 1);
              this.$l.litMask = pb.mul(this.validMask, pb.float(pb.greaterThan(this.NoL, 1e-5)), this.litFlag);
              // Keep shadow sampling in uniform control flow for WebGPU derivatives (dpdx/ddy in PCF).
              this.$l.shadow = ShaderHelper.calculateShadow(this, this.worldPos, pb.max(this.NoL, 1e-5), ctx);
              this.shadow = pb.mix(1, this.shadow, this.validMask);
              this.$l.contactShadow = this.zContactShadow(this.worldPos, this.L, this.lightType, this.posRange);
              this.shadow = pb.mul(this.shadow, this.contactShadow);
              this.shadowTerm = pb.mul(this.shadow, this.litMask);
              this.zAccumulatePunctualShadowedLight(
                this.base.rgb,
                this.metallic,
                this.roughness,
                this.specularStrength,
                this.n,
                this.viewDir,
                this.NoV,
                this.f0,
                this.lightColor,
                this.L,
                this.atten,
                this.shadow,
                this.litMask,
                this.$choice(pb.equal(this.lightType, LIGHT_TYPE_POINT), this.extra.x, pb.float(1)),
                this.$choice(pb.equal(this.lightType, LIGHT_TYPE_POINT), this.extra.y, pb.float(1)),
                this.outLight,
                this.shadowTerm
              );
            });
            this.$if(pb.notEqual(this.debugShadowTermOnly, 0), function () {
              this.$outputs.color = pb.vec4(pb.vec3(this.shadowTerm), 1);
            }).$else(function () {
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
    bindGroup.setTexture('gbufferExtraTex', gbufferExtra, fetchSampler('clamp_nearest_nomip'));
    bindGroup.setTexture('linearDepthTex', ctx.linearDepthTexture, fetchSampler('clamp_nearest_nomip'));
    DeferredShadowLightPass.bindOptionalSceneTextures(bindGroup, program, ctx);
    const cameraRight = ctx.camera.worldMatrix.getRow(0).xyz().inplaceNormalize();
    const cameraUp = ctx.camera.worldMatrix.getRow(1).xyz().inplaceNormalize();
    const cameraForward = ctx.camera.worldMatrix.getRow(2).xyz().inplaceNormalize().scaleBy(-1);
    const cameraPos = ctx.camera.getWorldPosition();
    bindGroup.setValue('cameraRight', new Float32Array([cameraRight.x, cameraRight.y, cameraRight.z]));
    bindGroup.setValue('cameraUp', new Float32Array([cameraUp.x, cameraUp.y, cameraUp.z]));
    bindGroup.setValue('cameraForward', new Float32Array([cameraForward.x, cameraForward.y, cameraForward.z]));
    bindGroup.setValue('cameraViewProjection', ctx.camera.viewProjectionMatrix);
    bindGroup.setValue('cameraPos', new Float32Array([cameraPos.x, cameraPos.y, cameraPos.z]));
    bindGroup.setValue('cameraProj', new Float32Array([ctx.camera.getTanHalfFovy(), ctx.camera.getAspect()]));
    bindGroup.setValue('cameraNearFar', new Float32Array([ctx.camera.getNearPlane(), ctx.camera.getFarPlane()]));
    bindGroup.setValue('debugShadowTermOnly', debugShadowTermOnly ? 1 : 0);
    bindGroup.setValue('camera', DeferredShadowLightPass.getCameraUniforms(ctx));
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
    const renderStates = debugShadowTermOnly
      ? DeferredShadowLightPass._multiplyRenderStates
      : DeferredShadowLightPass._additiveRenderStates;
    device.setProgram(program);
    device.setBindGroup(0, bindGroup);
    drawFullscreenQuad(renderStates);
    ctx.currentShadowLight = prevLight;
    ctx.renderPass = prevRenderPass;
  }
}
