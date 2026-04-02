import type { BindGroup, GPUProgram, Texture2D } from '@zephyr3d/device';
import type { DrawContext } from './drawable';
import { drawFullscreenQuad } from './fullscreenquad';
import { fetchSampler } from '../utility/misc';
import { getGGXLUT } from '../utility/textures/ggxlut';
import { decodeNormalizedFloatFromRGBA } from '../shaders/misc';
import { distributionGGX, fresnelSchlick, visGGX } from '../shaders/pbr';
import { LIGHT_TYPE_POINT, LIGHT_TYPE_RECT, LIGHT_TYPE_SPOT, MAX_CLUSTERED_LIGHTS } from '../values';

/**
 * Deferred lighting pass scaffold.
 *
 * Stage-1 implementation simply resolves GBuffer color to the lighting target.
 * Follow-up will evaluate clustered lights using compact material attributes.
 * @internal
 */
export class DeferredLightPass {
  private static _programs: Record<string, GPUProgram> = {};
  private static _bindGroups: Record<string, BindGroup> = {};

  render(ctx: DrawContext, gbufferColor: Texture2D, gbufferRoughness: Texture2D, gbufferNormal: Texture2D) {
    if (!ctx.clusteredLight?.lightBuffer || !ctx.clusteredLight.lightIndexTexture || !ctx.linearDepthTexture) {
      return;
    }
    const device = ctx.device;
    const envHash = ctx.env?.light?.envLight ? ctx.env.light.getHash() : 'none';
    const hash = `${device.type}:${envHash}:clustered`;
    let program = DeferredLightPass._programs[hash];
    if (!program) {
      const hasEnvLight = !!ctx.env?.light?.envLight;
      const hasEnvRadiance = !!ctx.env?.light?.envLight?.hasRadiance();
      const hasEnvIrradiance = !!ctx.env?.light?.envLight?.hasIrradiance();
      const isWebGL = device.type === 'webgl';
      const builtProgram = device.buildRenderProgram({
        label: 'DeferredLightPass',
        vertex(pb) {
          this.$inputs.pos = pb.vec2().attrib('position');
          this.$outputs.uv = pb.vec2();
          pb.main(function () {
            this.$builtins.position = pb.vec4(this.$inputs.pos, 1, 1);
            this.$outputs.uv = pb.add(pb.mul(this.$inputs.pos.xy, 0.5), pb.vec2(0.5));
            if (device.type === 'webgpu') {
              this.$builtins.position.y = pb.neg(this.$builtins.position.y);
            }
          });
        },
        fragment(pb) {
          this.gbufferColorTex = pb.tex2D().uniform(0);
          this.gbufferRoughnessTex = pb.tex2D().uniform(0);
          this.gbufferNormalTex = pb.tex2D().uniform(0);
          this.linearDepthTex = pb.tex2D().uniform(0);
          this.zGGXLut = pb.tex2D().uniform(0);
          this.lightIndexTex = (isWebGL ? pb.tex2D() : pb.utex2D()).uniform(0);
          this.zLightBuffer = pb.vec4[(MAX_CLUSTERED_LIGHTS + 1) * 4]().uniformBuffer(0);
          this.clusterParams = pb.vec4().uniform(0);
          this.countParams = pb.ivec4().uniform(0);
          this.lightIndexTexSize = pb.ivec2().uniform(0);
          this.cameraPos = pb.vec3().uniform(0);
          this.cameraRight = pb.vec3().uniform(0);
          this.cameraUp = pb.vec3().uniform(0);
          this.cameraForward = pb.vec3().uniform(0);
          this.cameraProj = pb.vec2().uniform(0); // x: tanHalfFovy, y: aspect
          this.cameraNearFar = pb.vec2().uniform(0);
          this.sunDir = pb.vec3().uniform(0);
          this.sunColorIntensity = pb.vec4().uniform(0);
          this.showGBuffer = pb.int().uniform(0);
          this.gbufferViewMode = pb.int().uniform(0);
          this.showCluster = pb.int().uniform(0);
          this.showShadowTerm = pb.int().uniform(0);
          this.showSpecTerm = pb.int().uniform(0);
          if (hasEnvLight) {
            this.envLightStrength = pb.float().uniform(0);
            ctx.env!.light.envLight.initShaderBindings(pb);
          }
          this.$outputs.color = pb.vec4();
          pb.func('zGetClusterIndex', [pb.float('linearDepth')], function () {
            this.$l.zTile = pb.int(
              pb.max(
                pb.add(pb.mul(pb.log2(pb.max(this.linearDepth, 1e-4)), this.clusterParams.z), this.clusterParams.w),
                0
              )
            );
            this.zTile = pb.min(this.zTile, pb.sub(this.countParams.z, 1));
            this.$l.f = pb.vec2(this.$builtins.fragCoord.x, pb.sub(this.clusterParams.y, pb.add(this.$builtins.fragCoord.y, 1)));
            this.$l.xyTile = pb.ivec2(pb.div(this.f, pb.div(this.clusterParams.xy, pb.vec2(this.countParams.xy))));
            this.xyTile = pb.clamp(this.xyTile, pb.ivec2(0), pb.sub(this.countParams.xy, 1));
            this.$return(
              pb.add(
                this.xyTile.x,
                pb.mul(this.xyTile.y, this.countParams.x),
                pb.mul(this.zTile, this.countParams.x, this.countParams.y)
              )
            );
          });
          pb.func('zGetLinearDepth', [], function () {
            this.$l.depthSample = pb.textureSample(this.linearDepthTex, this.$inputs.uv);
            if (isWebGL) {
              this.$return(decodeNormalizedFloatFromRGBA(this, this.depthSample));
            } else {
              this.$return(this.depthSample.r);
            }
          });
          pb.func('zDecodeWebGLLightIndex', [pb.float('packed'), pb.int('slot')], function () {
            this.$if(pb.equal(this.slot, 0), function () {
              this.$return(pb.int(pb.div(this.packed, 256)));
            });
            this.$return(pb.int(pb.mod(this.packed, 256)));
          });
          pb.func('zPointAtten', [pb.float('dist'), pb.float('range')], function () {
            this.$l.falloff = pb.max(0, pb.sub(1, pb.div(this.dist, pb.max(this.range, 1e-4))));
            this.$return(pb.mul(this.falloff, this.falloff));
          });
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
            this.$l.base = pb.textureSample(this.gbufferColorTex, this.$inputs.uv);
            this.$l.rm = pb.textureSample(this.gbufferRoughnessTex, this.$inputs.uv);
            this.$l.n = pb.normalize(
              pb.sub(pb.mul(pb.textureSample(this.gbufferNormalTex, this.$inputs.uv).xyz, 2), pb.vec3(1))
            );
            this.$l.metallic = pb.clamp(this.rm.r, 0, 1);
            this.$l.occlusion = pb.clamp(this.rm.g, 0, 1);
            this.$l.specularStrength = pb.clamp(this.rm.b, 0, 1);
            this.$l.roughness = pb.clamp(this.rm.a, 0.045, 1);
            this.$l.ndc = pb.sub(pb.mul(this.$inputs.uv, 2), pb.vec2(1));
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
            this.$l.rayScale = pb.max(pb.dot(this.camRayDir, this.cameraForward), 1e-4);
            this.$l.worldPos = pb.add(
              this.cameraPos,
              pb.mul(this.camRayDir, pb.div(this.linearDepth, this.rayScale))
            );
            this.$l.viewDir = pb.neg(this.camRayDir);
            this.$l.sunL = pb.normalize(this.sunDir);
            this.$l.sunColor = pb.mul(this.sunColorIntensity.rgb, this.sunColorIntensity.a);
            this.$l.NoL = pb.clamp(pb.dot(this.n, this.sunL), 0, 1);
            this.$l.NoV = pb.clamp(pb.dot(this.n, this.viewDir), 0, 1);
            this.$l.f0 = pb.mix(pb.mul(pb.vec3(0.04), this.specularStrength), this.base.rgb, this.metallic);
            this.$l.fresnelNoV = pb.add(
              this.f0,
              pb.mul(pb.sub(pb.vec3(1), this.f0), pb.pow(pb.sub(1, this.NoV), 5))
            );
            this.$l.kd = pb.mul(pb.sub(pb.vec3(1), this.fresnelNoV), pb.sub(1, this.metallic));
            this.$l.sunDiffuse = pb.vec3(0);
            this.$l.sunSpecular = pb.vec3(0);
            this.$if(pb.greaterThan(this.NoL, 1e-5), function () {
              this.$l.H = pb.normalize(pb.add(this.viewDir, this.sunL));
              this.$l.NoH = pb.clamp(pb.dot(this.n, this.H), 0, 1);
              this.$l.VoH = pb.clamp(pb.dot(this.viewDir, this.H), 0, 1);
              this.$l.F = fresnelSchlick(this, this.VoH, this.f0, pb.vec3(1));
              this.$l.alphaRoughness = pb.mul(this.roughness, this.roughness);
              this.$l.D = distributionGGX(this, this.NoH, this.alphaRoughness);
              this.$l.V = visGGX(this, this.NoV, this.NoL, this.alphaRoughness);
              this.$l.sunPunctualColor = pb.mul(this.sunColor, this.NoL);
              this.$l.diffuseBRDF = pb.mul(
                pb.sub(pb.vec3(1), this.F),
                pb.div(pb.mul(this.base.rgb, pb.sub(1, this.metallic)), Math.PI)
              );
              this.sunDiffuse = pb.mul(this.sunPunctualColor, pb.max(this.diffuseBRDF, pb.vec3(0)));
              this.sunSpecular = pb.mul(this.sunPunctualColor, this.D, this.V, this.F);
            });
            this.$l.diffuse = this.sunDiffuse;
            this.$l.specular = this.sunSpecular;
            this.$l.clusterLightCount = pb.int(0);
            this.$l.clusterIndex = this.zGetClusterIndex(this.linearDepth);
            if (isWebGL) {
              this.$l.texCoordX = pb.div(
                pb.add(pb.mod(pb.float(this.clusterIndex), pb.float(this.lightIndexTexSize.x)), 0.5),
                pb.float(this.lightIndexTexSize.x)
              );
              this.$l.texCoordY = pb.div(
                pb.add(pb.float(pb.div(this.clusterIndex, this.lightIndexTexSize.x)), 0.5),
                pb.float(this.lightIndexTexSize.y)
              );
              this.$l.samp = pb.textureSample(this.lightIndexTex, pb.vec2(this.texCoordX, this.texCoordY));
              this.$for(pb.int('i'), 0, 4, function () {
                this.$l.packed = this.samp.at(this.i);
                this.$for(pb.int('k'), 0, 2, function () {
                  this.$l.lightIndex = this.zDecodeWebGLLightIndex(this.packed, this.k);
                  this.$if(pb.greaterThan(this.lightIndex, 0), function () {
                    this.clusterLightCount = pb.add(this.clusterLightCount, 1);
                    this.$l.positionRange = this.zLightBuffer.at(pb.mul(this.lightIndex, 4));
                    this.$l.directionCutoff = this.zLightBuffer.at(pb.add(pb.mul(this.lightIndex, 4), 1));
                    this.$l.diffuseIntensity = this.zLightBuffer.at(pb.add(pb.mul(this.lightIndex, 4), 2));
                    this.$l.extra = this.zLightBuffer.at(pb.add(pb.mul(this.lightIndex, 4), 3));
                    this.$l.lightType = pb.int(this.extra.w);
                    this.$if(
                      pb.or(
                        pb.equal(this.lightType, LIGHT_TYPE_POINT),
                        pb.equal(this.lightType, LIGHT_TYPE_SPOT),
                        pb.equal(this.lightType, LIGHT_TYPE_RECT)
                      ),
                      function () {
                        this.$l.toLight = pb.sub(this.positionRange.xyz, this.worldPos);
                        this.$l.dist = pb.length(this.toLight);
                        this.$l.L = pb.div(this.toLight, pb.max(this.dist, 1e-4));
                        this.$l.atten = this.zPointAtten(this.dist, this.positionRange.w);
                        this.$if(pb.equal(this.lightType, LIGHT_TYPE_SPOT), function () {
                          this.atten = this.zSpotAtten(
                            this.worldPos,
                            this.positionRange,
                            this.directionCutoff,
                            this.dist
                          );
                        });
                        this.$if(pb.greaterThan(this.atten, 1e-5), function () {
                          this.$l.lightColor = pb.mul(this.diffuseIntensity.rgb, this.diffuseIntensity.a);
                          this.$l.pointNoL = pb.clamp(pb.dot(this.n, this.L), 0, 1);
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
                          this.$l.sourceRadiusFactor = this.$choice(
                            pb.equal(this.lightType, LIGHT_TYPE_POINT),
                            pb.div(this.extra.z, pb.max(this.dist, 1e-4)),
                            pb.float(0)
                          );
                          this.$if(pb.greaterThan(this.pointNoL, 1e-5), function () {
                            this.$l.H = pb.normalize(pb.add(this.viewDir, this.L));
                            this.$l.NoH = pb.clamp(pb.dot(this.n, this.H), 0, 1);
                            this.$l.VoH = pb.clamp(pb.dot(this.viewDir, this.H), 0, 1);
                            this.$l.F = fresnelSchlick(this, this.VoH, this.f0, pb.vec3(1));
                            this.$l.specularRoughness = pb.clamp(
                              pb.add(this.roughness, this.sourceRadiusFactor),
                              0,
                              1
                            );
                            this.$l.alphaRoughness = pb.mul(this.specularRoughness, this.specularRoughness);
                            this.$l.D = distributionGGX(this, this.NoH, this.alphaRoughness);
                            this.$l.V = visGGX(this, this.NoV, this.pointNoL, this.alphaRoughness);
                            this.$l.punctualColor = pb.mul(this.lightColor, this.atten, this.pointNoL);
                            this.$l.diffuseBRDF = pb.mul(
                              pb.sub(pb.vec3(1), this.F),
                              pb.div(pb.mul(this.base.rgb, pb.sub(1, this.metallic)), Math.PI)
                            );
                            this.diffuse = pb.add(
                              this.diffuse,
                              pb.mul(
                                this.punctualColor,
                                pb.max(this.diffuseBRDF, pb.vec3(0)),
                                this.diffScale
                              )
                            );
                            this.specular = pb.add(
                              this.specular,
                              pb.mul(this.punctualColor, this.D, this.V, this.F, this.specScale)
                            );
                          });
                        });
                      }
                    );
                  });
                });
              });
            } else {
              this.$l.texCoordX = pb.mod(this.clusterIndex, this.lightIndexTexSize.x);
              this.$l.texCoordY = pb.div(this.clusterIndex, this.lightIndexTexSize.x);
              this.$l.samp = pb.textureLoad(this.lightIndexTex, pb.ivec2(this.texCoordX, this.texCoordY), 0);
              this.$for(pb.uint('i'), 0, 4, function () {
                this.$for(pb.uint('k'), 0, 4, function () {
                  this.$l.lightIndex = pb.compAnd(pb.sar(this.samp.at(this.i), pb.mul(this.k, 8)), 0xff);
                  this.$if(pb.greaterThan(this.lightIndex, 0), function () {
                    this.clusterLightCount = pb.add(this.clusterLightCount, 1);
                    this.$l.positionRange = this.zLightBuffer.at(pb.mul(this.lightIndex, 4));
                    this.$l.directionCutoff = this.zLightBuffer.at(pb.add(pb.mul(this.lightIndex, 4), 1));
                    this.$l.diffuseIntensity = this.zLightBuffer.at(pb.add(pb.mul(this.lightIndex, 4), 2));
                    this.$l.extra = this.zLightBuffer.at(pb.add(pb.mul(this.lightIndex, 4), 3));
                    this.$l.lightType = pb.int(this.extra.w);
                    this.$if(
                      pb.or(
                        pb.equal(this.lightType, LIGHT_TYPE_POINT),
                        pb.equal(this.lightType, LIGHT_TYPE_SPOT),
                        pb.equal(this.lightType, LIGHT_TYPE_RECT)
                      ),
                      function () {
                        this.$l.toLight = pb.sub(this.positionRange.xyz, this.worldPos);
                        this.$l.dist = pb.length(this.toLight);
                        this.$l.L = pb.div(this.toLight, pb.max(this.dist, 1e-4));
                        this.$l.atten = this.zPointAtten(this.dist, this.positionRange.w);
                        this.$if(pb.equal(this.lightType, LIGHT_TYPE_SPOT), function () {
                          this.atten = this.zSpotAtten(
                            this.worldPos,
                            this.positionRange,
                            this.directionCutoff,
                            this.dist
                          );
                        });
                        this.$if(pb.greaterThan(this.atten, 1e-5), function () {
                          this.$l.lightColor = pb.mul(this.diffuseIntensity.rgb, this.diffuseIntensity.a);
                          this.$l.pointNoL = pb.clamp(pb.dot(this.n, this.L), 0, 1);
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
                          this.$l.sourceRadiusFactor = this.$choice(
                            pb.equal(this.lightType, LIGHT_TYPE_POINT),
                            pb.div(this.extra.z, pb.max(this.dist, 1e-4)),
                            pb.float(0)
                          );
                          this.$if(pb.greaterThan(this.pointNoL, 1e-5), function () {
                            this.$l.H = pb.normalize(pb.add(this.viewDir, this.L));
                            this.$l.NoH = pb.clamp(pb.dot(this.n, this.H), 0, 1);
                            this.$l.VoH = pb.clamp(pb.dot(this.viewDir, this.H), 0, 1);
                            this.$l.F = fresnelSchlick(this, this.VoH, this.f0, pb.vec3(1));
                            this.$l.specularRoughness = pb.clamp(
                              pb.add(this.roughness, this.sourceRadiusFactor),
                              0,
                              1
                            );
                            this.$l.alphaRoughness = pb.mul(this.specularRoughness, this.specularRoughness);
                            this.$l.D = distributionGGX(this, this.NoH, this.alphaRoughness);
                            this.$l.V = visGGX(this, this.NoV, this.pointNoL, this.alphaRoughness);
                            this.$l.punctualColor = pb.mul(this.lightColor, this.atten, this.pointNoL);
                            this.$l.diffuseBRDF = pb.mul(
                              pb.sub(pb.vec3(1), this.F),
                              pb.div(pb.mul(this.base.rgb, pb.sub(1, this.metallic)), Math.PI)
                            );
                            this.diffuse = pb.add(
                              this.diffuse,
                              pb.mul(
                                this.punctualColor,
                                pb.max(this.diffuseBRDF, pb.vec3(0)),
                                this.diffScale
                              )
                            );
                            this.specular = pb.add(
                              this.specular,
                              pb.mul(this.punctualColor, this.D, this.V, this.F, this.specScale)
                            );
                          });
                        });
                      }
                    );
                  });
                });
              });
            }
            this.$l.finalColor = pb.add(this.diffuse, this.specular);
            if (hasEnvIrradiance || hasEnvRadiance) {
              this.$l.ggxLutSample = pb.clamp(
                pb.textureSampleLevel(
                  this.zGGXLut,
                  pb.clamp(pb.vec2(this.NoV, this.roughness), pb.vec2(0), pb.vec2(1)),
                  0
                ),
                pb.vec4(0),
                pb.vec4(1)
              );
              this.$l.f_ab = this.ggxLutSample.rg;
              this.$l.FssEss = pb.add(pb.mul(this.fresnelNoV, this.f_ab.x), pb.vec3(this.f_ab.y));
              this.$l.Ems = pb.sub(1, pb.add(this.f_ab.x, this.f_ab.y));
              this.$l.F_avg = pb.add(this.f0, pb.div(pb.sub(pb.vec3(1), this.f0), 21));
              this.$l.FmsEms = pb.div(
                pb.mul(this.FssEss, this.F_avg, this.Ems),
                pb.max(pb.sub(pb.vec3(1), pb.mul(this.F_avg, this.Ems)), pb.vec3(1e-4))
              );
            }
            if (hasEnvIrradiance) {
              this.$l.envIrr = ctx.env!.light.envLight.getIrradiance(this, this.n).rgb;
              this.finalColor = pb.add(
                this.finalColor,
                pb.mul(
                  pb.add(this.kd, this.FmsEms),
                  this.base.rgb,
                  this.envIrr,
                  this.envLightStrength,
                  this.occlusion,
                  1 / Math.PI
                )
              );
            }
            if (hasEnvRadiance) {
              this.$l.reflectVec = pb.reflect(pb.neg(this.viewDir), this.n);
              this.$l.envRad = ctx.env!.light.envLight.getRadiance(this, this.reflectVec, this.roughness)!.rgb;
              this.finalColor = pb.add(
                this.finalColor,
                pb.mul(
                  this.envRad,
                  this.FssEss,
                  this.envLightStrength,
                  this.occlusion
                )
              );
            }
            // Deferred direct shadowing is aligned in follow-up pass; keep a stable debug channel now.
            this.$l.shadowTerm = pb.float(1);
            this.$l.debugColor = pb.max(this.finalColor, pb.vec3(0));
            this.$if(pb.notEqual(this.showGBuffer, 0), function () {
              this.$if(pb.equal(this.gbufferViewMode, 1), function () {
                this.debugColor = pb.vec3(pb.clamp(this.linearDepthNormalized, 0, 1));
              }).$elseif(pb.equal(this.gbufferViewMode, 2), function () {
                this.debugColor = pb.vec3(this.metallic);
              }).$elseif(pb.equal(this.gbufferViewMode, 3), function () {
                this.debugColor = pb.vec3(this.roughness);
              }).$elseif(pb.equal(this.gbufferViewMode, 4), function () {
                this.$l.rawN = pb.sub(pb.mul(pb.textureSample(this.gbufferNormalTex, this.$inputs.uv).xyz, 2), pb.vec3(1));
                this.debugColor = pb.vec3(pb.clamp(pb.length(this.rawN), 0, 1));
              }).$else(function () {
                // composite
                this.$if(pb.lessThan(this.$inputs.uv.x, 0.5), function () {
                  this.$if(pb.lessThan(this.$inputs.uv.y, 0.5), function () {
                    this.debugColor = this.base.rgb;
                  }).$else(function () {
                    this.debugColor = this.rm.rgb;
                  });
                }).$else(function () {
                  this.$if(pb.lessThan(this.$inputs.uv.y, 0.5), function () {
                    this.debugColor = pb.add(pb.mul(this.n, 0.5), pb.vec3(0.5));
                  }).$else(function () {
                    this.debugColor = pb.vec3(this.roughness);
                  });
                });
              });
            }).$elseif(pb.notEqual(this.showCluster, 0), function () {
              this.$l.clusterT = pb.clamp(pb.div(pb.float(this.clusterLightCount), 16), 0, 1);
              this.debugColor = pb.vec3(this.clusterT, pb.mul(this.clusterT, this.clusterT), pb.sub(1, this.clusterT));
            }).$elseif(pb.notEqual(this.showShadowTerm, 0), function () {
              this.debugColor = pb.vec3(this.shadowTerm);
            }).$elseif(pb.notEqual(this.showSpecTerm, 0), function () {
              this.debugColor = pb.max(this.specular, pb.vec3(0));
            });
            this.$outputs.color = pb.vec4(this.debugColor, this.base.a);
          });
        }
      });
      if (!builtProgram) {
        return;
      }
      program = builtProgram;
      program.name = '@DeferredLightPass';
      DeferredLightPass._programs[hash] = program;
    }
    let bindGroup = DeferredLightPass._bindGroups[hash];
    if (!bindGroup) {
      bindGroup = device.createBindGroup(program.bindGroupLayouts[0]);
      DeferredLightPass._bindGroups[hash] = bindGroup;
    }
    bindGroup.setTexture(
      'gbufferColorTex',
      gbufferColor,
      fetchSampler('clamp_nearest_nomip')
    );
    bindGroup.setTexture(
      'gbufferRoughnessTex',
      gbufferRoughness,
      fetchSampler('clamp_nearest_nomip')
    );
    bindGroup.setTexture(
      'gbufferNormalTex',
      gbufferNormal,
      fetchSampler('clamp_nearest_nomip')
    );
    bindGroup.setTexture('linearDepthTex', ctx.linearDepthTexture, fetchSampler('clamp_nearest_nomip'));
    bindGroup.setTexture('zGGXLut', getGGXLUT(1024), fetchSampler('clamp_nearest_nomip'));
    bindGroup.setTexture('lightIndexTex', ctx.clusteredLight.lightIndexTexture);
    bindGroup.setBuffer('zLightBuffer', ctx.clusteredLight.lightBuffer);
    bindGroup.setValue('clusterParams', ctx.clusteredLight.clusterParam);
    bindGroup.setValue('countParams', ctx.clusteredLight.countParam);
    bindGroup.setValue(
      'lightIndexTexSize',
      new Int32Array([ctx.clusteredLight.lightIndexTexture.width, ctx.clusteredLight.lightIndexTexture.height])
    );
    const sunDirSrc = ctx.sunLight ? ctx.sunLight.directionAndCutoff.xyz().scaleBy(-1) : { x: 0, y: 0, z: 1 };
    const sunShadowed = !!(ctx.sunLight && ctx.shadowMapInfo?.has(ctx.sunLight));
    const sunColorIntensitySrc = ctx.sunLight
      ? sunShadowed
        ? { x: 0, y: 0, z: 0, w: 0 }
        : ctx.sunLight.diffuseAndIntensity
      : { x: 1, y: 1, z: 1, w: 0 };
    const cameraRight = ctx.camera.worldMatrix.getRow(0).xyz().inplaceNormalize();
    const cameraUp = ctx.camera.worldMatrix.getRow(1).xyz().inplaceNormalize();
    const cameraForward = ctx.camera.worldMatrix.getRow(2).xyz().inplaceNormalize().scaleBy(-1);
    const cameraPos = ctx.camera.getWorldPosition();
    bindGroup.setValue('sunDir', new Float32Array([sunDirSrc.x, sunDirSrc.y, sunDirSrc.z]));
    bindGroup.setValue(
      'sunColorIntensity',
      new Float32Array([
        sunColorIntensitySrc.x,
        sunColorIntensitySrc.y,
        sunColorIntensitySrc.z,
        sunColorIntensitySrc.w
      ])
    );
    bindGroup.setValue('cameraRight', new Float32Array([cameraRight.x, cameraRight.y, cameraRight.z]));
    bindGroup.setValue('cameraUp', new Float32Array([cameraUp.x, cameraUp.y, cameraUp.z]));
    bindGroup.setValue('cameraForward', new Float32Array([cameraForward.x, cameraForward.y, cameraForward.z]));
    bindGroup.setValue('cameraPos', new Float32Array([cameraPos.x, cameraPos.y, cameraPos.z]));
    bindGroup.setValue('cameraProj', new Float32Array([ctx.camera.getTanHalfFovy(), ctx.camera.getAspect()]));
    bindGroup.setValue('cameraNearFar', new Float32Array([ctx.camera.getNearPlane(), ctx.camera.getFarPlane()]));
    let gbufferViewMode = 0;
    switch (ctx.camera.deferredGBufferView) {
      case 'depth':
        gbufferViewMode = 1;
        break;
      case 'metallic':
        gbufferViewMode = 2;
        break;
      case 'roughness':
        gbufferViewMode = 3;
        break;
      case 'normal-length':
        gbufferViewMode = 4;
        break;
      default:
        gbufferViewMode = 0;
        break;
    }
    bindGroup.setValue('showGBuffer', ctx.camera.deferredShowGBuffer ? 1 : 0);
    bindGroup.setValue('gbufferViewMode', gbufferViewMode);
    bindGroup.setValue('showCluster', ctx.camera.deferredShowCluster ? 1 : 0);
    bindGroup.setValue('showShadowTerm', ctx.camera.deferredShowShadowTerm ? 1 : 0);
    bindGroup.setValue('showSpecTerm', ctx.camera.deferredShowSpecTerm ? 1 : 0);
    if (ctx.env?.light?.envLight) {
      bindGroup.setValue('envLightStrength', ctx.env.light.strength ?? 0);
      ctx.env.light.envLight.updateBindGroup(bindGroup);
    }
    device.setProgram(program);
    device.setBindGroup(0, bindGroup);
    drawFullscreenQuad();
  }
}
