import type { BindGroup, GPUProgram, Texture2D } from '@zephyr3d/device';
import type { DrawContext, Primitive } from '../render';
import { AbstractPostEffect } from './posteffect';
import { linearToGamma } from '../shaders';
import { fetchSampler } from '../utility/misc';
import { BoxShape } from '../shapes';
import { Vector2 } from '@zephyr3d/base';

const DEBUG_CURRENT_COLOR = 1;
const DEBUG_HISTORY_COLOR = 2;
const DEBUG_VELOCITY = 3;
const DEBUG_EDGE = 4;
const DEBUG_ALAPH = 5;

const FLT_MIN = 0.00000001;
const FLT_MAX = 32767;

export class TAA extends AbstractPostEffect<'TAA'> {
  static readonly className = 'TAA' as const;
  private static _resolveProgram: GPUProgram = null;
  private static _skyMotionVectorProgram: GPUProgram = null;
  private static _box: Primitive;
  private static _texelSize = new Vector2();
  private _bindGroup: BindGroup;
  private _skyMotionVectorBindGroup: BindGroup;
  constructor() {
    super();
    this._bindGroup = null;
    this._skyMotionVectorBindGroup = null;
  }
  renderSkyMotionVectors(ctx: DrawContext) {
    const fb = ctx.device.pool.fetchTemporalFramebuffer(
      false,
      0,
      0,
      ctx.motionVectorTexture,
      ctx.depthTexture
    );
    const program = TAA._getSkyMotionVectorProgram(ctx);
    if (!this._skyMotionVectorBindGroup) {
      this._skyMotionVectorBindGroup = ctx.device.createBindGroup(program.bindGroupLayouts[0]);
    }
    const box = TAA._getBox(ctx);
    this._skyMotionVectorBindGroup.setValue('VPMatrix', ctx.TAA.VPMatrix);
    this._skyMotionVectorBindGroup.setValue('prevVPMatrix', ctx.TAA.prevVPMatrix);
    this._skyMotionVectorBindGroup.setValue('cameraPos', ctx.TAA.position);
    this._skyMotionVectorBindGroup.setValue('prevCameraPos', ctx.TAA.prevPosition);
    ctx.device.pushDeviceStates();
    ctx.device.setProgram(program);
    ctx.device.setBindGroup(0, this._skyMotionVectorBindGroup);
    ctx.device.setRenderStates(AbstractPostEffect.getDefaultRenderState(ctx, 'le'));
    ctx.device.setFramebuffer(fb);
    box.draw();
    ctx.device.popDeviceStates();
    ctx.device.pool.releaseFrameBuffer(fb);
  }
  apply(
    ctx: DrawContext,
    inputColorTexture: Texture2D,
    sceneDepthTexture: Texture2D,
    srgbOutput: boolean
  ): void {
    if (
      !ctx.TAA.prevColorTexture ||
      !ctx.TAA.prevDepthTexture ||
      !ctx.motionVectorTexture ||
      ctx.TAA.prevColorTexture.width !== inputColorTexture.width ||
      ctx.TAA.prevColorTexture.height !== inputColorTexture.height
    ) {
      this.passThrough(ctx, inputColorTexture, srgbOutput);
    } else {
      this.renderSkyMotionVectors(ctx);
      const program = TAA._getResolveProgram(ctx);
      if (!this._bindGroup) {
        this._bindGroup = ctx.device.createBindGroup(program.bindGroupLayouts[0]);
      }
      this._bindGroup.setTexture(
        'historyColorTex',
        ctx.TAA.prevColorTexture,
        fetchSampler('clamp_linear_nomip')
      );
      this._bindGroup.setTexture(
        'historyDepthTex',
        ctx.TAA.prevDepthTexture,
        fetchSampler('clamp_nearest_nomip')
      );
      this._bindGroup.setTexture('currentColorTex', inputColorTexture, fetchSampler('clamp_nearest_nomip'));
      this._bindGroup.setTexture('currentDepthTex', sceneDepthTexture, fetchSampler('clamp_nearest_nomip'));
      this._bindGroup.setTexture(
        'motionVector',
        ctx.motionVectorTexture,
        fetchSampler('clamp_nearest_nomip')
      );
      this._bindGroup.setTexture(
        'prevMotionVector',
        ctx.TAA.prevMotionVectorTexture,
        fetchSampler('clamp_nearest_nomip')
      );
      TAA._texelSize.setXY(1 / sceneDepthTexture.width, 1 / sceneDepthTexture.height);
      this._bindGroup.setValue('texelSize', TAA._texelSize);
      this._bindGroup.setValue('occlusionParams', new Vector2(2.5, 0.01));
      this._bindGroup.setValue('debug', ctx.camera.TAADebug);
      this._bindGroup.setValue('flip', this.needFlip(ctx.device) ? 1 : 0);
      this._bindGroup.setValue('srgbOut', srgbOutput ? 1 : 0);
      //this.passThrough(ctx, inputColorTexture, srgbOutput, AbstractPostEffect.getZTestEqualRenderState(ctx));
      ctx.device.setProgram(program);
      ctx.device.setBindGroup(0, this._bindGroup);
      this.drawFullscreenQuad();
    }
    if (ctx.TAA.prevDepthTexture) {
      ctx.device.pool.releaseTexture(ctx.TAA.prevDepthTexture);
    }
    ctx.device.pool.retainTexture(sceneDepthTexture);
    ctx.TAA.prevDepthTexture = sceneDepthTexture;
    if (ctx.TAA.prevColorTexture) {
      ctx.device.pool.releaseTexture(ctx.TAA.prevColorTexture);
    }
    const currentColorTex = ctx.device.getFramebuffer().getColorAttachments()[0];
    ctx.device.pool.retainTexture(currentColorTex);
    ctx.TAA.prevColorTexture = currentColorTex;
    if (ctx.TAA.prevMotionVectorTexture) {
      ctx.device.pool.releaseTexture(ctx.TAA.prevMotionVectorTexture);
    }
    ctx.device.pool.retainTexture(ctx.motionVectorTexture);
    ctx.TAA.prevMotionVectorTexture = ctx.motionVectorTexture;
  }
  requireLinearDepthTexture(ctx: DrawContext): boolean {
    return true;
  }
  requireDepthAttachment(ctx: DrawContext): boolean {
    return true;
  }
  private static _getSkyMotionVectorProgram(ctx: DrawContext): GPUProgram {
    if (!this._skyMotionVectorProgram) {
      this._skyMotionVectorProgram = ctx.device.buildRenderProgram({
        vertex(pb) {
          this.$inputs.pos = pb.vec3().attrib('position');
          this.VPMatrix = pb.mat4().uniform(0);
          this.prevVPMatrix = pb.mat4().uniform(0);
          this.cameraPos = pb.vec3().uniform(0);
          this.prevCameraPos = pb.vec3().uniform(0);
          pb.main(function () {
            this.$l.worldPos = pb.add(this.$inputs.pos, this.cameraPos);
            this.$l.prevWorldPos = pb.add(this.$inputs.pos, this.prevCameraPos);
            this.$l.clipPos = pb.mul(this.VPMatrix, pb.vec4(this.worldPos, 1));
            this.$l.prevClipPos = pb.mul(this.prevVPMatrix, pb.vec4(this.prevWorldPos, 1));
            this.clipPos.z = this.clipPos.w;
            this.$builtins.position = this.clipPos;
            this.$outputs.currentPos = this.clipPos;
            this.$outputs.prevPos = this.prevClipPos;
          });
        },
        fragment(pb) {
          this.$outputs.color = pb.vec4();
          pb.main(function () {
            this.$l.motionVector = pb.mul(
              pb.sub(
                pb.div(this.$inputs.currentPos.xy, this.$inputs.currentPos.w),
                pb.div(this.$inputs.prevPos.xy, this.$inputs.prevPos.w)
              ),
              0.5
            );
            this.$outputs.color = pb.vec4(this.motionVector, 0, 1);
          });
        }
      });
    }
    return this._skyMotionVectorProgram;
  }
  private static _getBox(ctx: DrawContext) {
    if (!this._box) {
      this._box = new BoxShape({
        size: 2,
        needNormal: false,
        needUV: false,
        needTangent: false
      });
    }
    return this._box;
  }
  private static _getResolveProgram(ctx: DrawContext): GPUProgram {
    if (!this._resolveProgram) {
      this._resolveProgram = ctx.device.buildRenderProgram({
        vertex(pb) {
          this.flip = pb.int().uniform(0);
          this.$inputs.pos = pb.vec2().attrib('position');
          this.$outputs.uv = pb.vec2();
          pb.main(function () {
            this.$builtins.position = pb.vec4(this.$inputs.pos, 1, 1);
            this.$outputs.uv = pb.add(pb.mul(this.$inputs.pos.xy, 0.5), pb.vec2(0.5));
            this.$if(pb.notEqual(this.flip, 0), function () {
              this.$builtins.position.y = pb.neg(this.$builtins.position.y);
            });
          });
        },
        fragment(pb) {
          this.historyColorTex = pb.tex2D().uniform(0);
          this.historyDepthTex = pb.tex2D().uniform(0);
          this.currentColorTex = pb.tex2D().uniform(0);
          this.currentDepthTex = pb.tex2D().uniform(0);
          this.motionVector = pb.tex2D().uniform(0);
          this.prevMotionVector = pb.tex2D().uniform(0);
          this.texelSize = pb.vec2().uniform(0);
          this.occlusionParams = pb.vec2().uniform(0);
          this.debug = pb.int().uniform(0);
          this.srgbOut = pb.int().uniform(0);
          this.$outputs.outColor = pb.vec4();
          pb.func('getClosestVelocity', [pb.vec2('uv')], function () {
            this.$l.minDepth = pb.float(1);
            this.$l.closestUV = this.uv;
            this.$l.tmpDepth = pb.float();
            this.$l.tmpUV = pb.vec2();
            for (let i = -1; i <= 1; i++) {
              for (let j = -1; j <= 1; j++) {
                this.tmpUV = pb.add(this.uv, pb.mul(pb.vec2(i, j), this.texelSize));
                this.tmpDepth = pb.textureSampleLevel(this.currentDepthTex, this.tmpUV, 0).r;
                this.$if(pb.lessThan(this.tmpDepth, this.minDepth), function () {
                  this.minDepth = this.tmpDepth;
                  this.closestUV = this.tmpUV;
                });
              }
            }
            this.$return(pb.textureSampleLevel(this.motionVector, this.closestUV, 0).xy);
          });
          pb.func(
            'clipAABB',
            [pb.vec3('aabbMin'), pb.vec3('aabbMax'), pb.vec3('p'), pb.vec3('q')],
            function () {
              this.$l.r = pb.sub(this.q, this.p);
              this.$l.rMax = pb.sub(this.aabbMax, this.p);
              this.$l.rMin = pb.sub(this.aabbMin, this.p);
              this.$if(pb.greaterThan(this.r.x, pb.add(this.rMax.x, FLT_MIN)), function () {
                this.r = pb.mul(this.r, pb.div(this.rMax.x, this.r.x));
              });
              this.$if(pb.greaterThan(this.r.y, pb.add(this.rMax.y, FLT_MIN)), function () {
                this.r = pb.mul(this.r, pb.div(this.rMax.y, this.r.y));
              });
              this.$if(pb.greaterThan(this.r.z, pb.add(this.rMax.z, FLT_MIN)), function () {
                this.r = pb.mul(this.r, pb.div(this.rMax.z, this.r.z));
              });
              this.$if(pb.lessThan(this.r.x, pb.sub(this.rMin.x, FLT_MIN)), function () {
                this.r = pb.mul(this.r, pb.div(this.rMin.x, this.r.x));
              });
              this.$if(pb.lessThan(this.r.y, pb.sub(this.rMin.y, FLT_MIN)), function () {
                this.r = pb.mul(this.r, pb.div(this.rMin.y, this.r.y));
              });
              this.$if(pb.lessThan(this.r.z, pb.sub(this.rMin.z, FLT_MIN)), function () {
                this.r = pb.mul(this.r, pb.div(this.rMin.z, this.r.z));
              });
              this.$return(pb.add(this.p, this.r));
            }
          );
          pb.func(
            'clipHistoryColor',
            [pb.vec2('uv'), pb.vec3('historyColor'), pb.vec2('closestVelocity')],
            function () {
              let n = 1;
              this.$l.colorAvg = pb.vec3(0);
              this.$l.colorAvg2 = pb.vec3(0);
              for (let i = -1; i <= 1; i++) {
                for (let j = -1; j <= 1; j++) {
                  this.$l[`s${n}`] = pb.textureSampleLevel(
                    this.currentColorTex,
                    pb.add(this.uv, pb.mul(pb.vec2(i, j), this.texelSize)),
                    0
                  ).rgb;
                  this.colorAvg = pb.add(this.colorAvg, this[`s${n}`]);
                  this.colorAvg2 = pb.add(this.colorAvg2, pb.mul(this[`s${n}`], this[`s${n}`]));
                  n++;
                }
              }
              this.colorAvg = pb.div(this.colorAvg, n - 1);
              this.colorAvg2 = pb.div(this.colorAvg2, n - 1);
              this.$l.boxSize = pb.mix(2.5, 0, pb.smoothStep(0, 0.02, pb.length(this.closestVelocity)));
              this.$l.dev = pb.mul(
                pb.sqrt(pb.abs(pb.sub(this.colorAvg2, pb.mul(this.colorAvg, this.colorAvg)))),
                this.boxSize
              );
              this.$l.colorMin = pb.sub(this.colorAvg, this.dev);
              this.$l.colorMax = pb.add(this.colorAvg, this.dev);
              this.$l.color = this.clipAABB(
                this.colorMin,
                this.colorMax,
                pb.clamp(this.colorAvg, this.colorMin, this.colorMax),
                this.historyColor
              );
              this.color = pb.clamp(this.color, pb.vec3(FLT_MIN), pb.vec3(FLT_MAX));
              this.$return(this.color);
            }
          );
          pb.func('reinhard', [pb.vec3('hdr')], function () {
            this.$return(pb.div(this.hdr, pb.add(this.hdr, pb.vec3(1))));
          });
          pb.func('reinhardInv', [pb.vec3('sdr')], function () {
            this.$return(pb.div(this.sdr, pb.sub(pb.vec3(1), this.sdr)));
          });
          pb.func('luminance', [pb.vec3('color')], function () {
            this.$return(pb.max(pb.dot(this.color, pb.vec3(0.299, 0.587, 0.114)), 0.0001));
          });
          pb.func(
            'getDisocclusionFactor',
            [pb.vec2('uv'), pb.vec2('velocity'), pb.vec2('texSize')],
            function () {
              this.$l.prevVelocity = pb.textureSampleLevel(this.prevMotionVector, this.uv, 0).xy;
              this.$l.disocclusion = pb.sub(
                pb.length(pb.mul(pb.sub(this.velocity, this.prevVelocity), this.texSize)),
                this.occlusionParams.x
              );
              this.$return(pb.clamp(pb.mul(this.disocclusion, this.occlusionParams.y), 0, 1));
            }
          );
          pb.main(function () {
            this.$l.texSize = pb.vec2(pb.textureDimensions(this.currentColorTex, 0));
            this.$l.screenUV = pb.div(pb.vec2(this.$builtins.fragCoord.xy), this.texSize);
            this.$l.velocity = pb.textureSampleLevel(this.motionVector, this.screenUV, 0).xy;
            this.$l.reprojectedUV = pb.sub(this.screenUV, pb.mul(this.velocity, pb.vec2(1, 1)));
            this.$l.historyColor = pb.textureSampleLevel(this.historyColorTex, this.reprojectedUV, 0).rgb;
            this.$l.sampleColor = pb.textureSampleLevel(this.currentColorTex, this.screenUV, 0).rgb;
            this.$l.velocityClosest = this.getClosestVelocity(this.screenUV);
            this.prevColor = this.clipHistoryColor(this.screenUV, this.historyColor, this.velocityClosest);
            this.$l.blendFactor = pb.float(1 / 8);
            this.$l.screenFactor = this.$choice(
              pb.or(
                pb.any(pb.lessThan(this.reprojectedUV, pb.vec2(0))),
                pb.any(pb.greaterThan(this.reprojectedUV, pb.vec2(1)))
              ),
              pb.float(1),
              pb.float(0)
            );
            this.$l.disocclusionFactor = this.getDisocclusionFactor(
              this.reprojectedUV,
              this.velocity,
              this.texSize
            );
            this.$l.alpha = pb.clamp(
              pb.add(this.blendFactor, this.screenFactor, this.disocclusionFactor),
              0,
              1
            );
            this.prevColor = this.reinhard(this.prevColor);
            this.currentColor = this.reinhard(this.sampleColor);
            this.$l.currentLum = this.luminance(this.currentColor);
            this.$l.prevLum = this.luminance(this.prevColor);
            this.$l.diff = pb.div(
              pb.abs(pb.sub(this.currentLum, this.prevLum)),
              pb.max(this.currentLum, pb.max(this.prevLum, 1.001))
            );
            this.diff = pb.sub(1, this.diff);
            this.diff = pb.mul(this.diff, this.diff);
            this.alpha = pb.mix(0, this.alpha, this.diff);
            this.$l.resolvedColor = pb.vec3();
            this.$if(pb.equal(this.debug, DEBUG_CURRENT_COLOR), function () {
              this.resolvedColor = this.currentColor.rgb;
              this.resolvedColor = this.reinhardInv(this.resolvedColor);
            })
              .$elseif(pb.equal(this.debug, DEBUG_HISTORY_COLOR), function () {
                this.resolvedColor = this.prevColor.rgb;
                this.resolvedColor = this.reinhardInv(this.resolvedColor);
              })
              .$elseif(pb.equal(this.debug, DEBUG_EDGE), function () {
                this.resolvedColor = pb.vec3(this.screenFactor);
              })
              .$elseif(pb.equal(this.debug, DEBUG_ALAPH), function () {
                this.resolvedColor = pb.vec3(this.alpha);
              })
              .$elseif(pb.equal(this.debug, DEBUG_VELOCITY), function () {
                this.resolvedColor = pb.abs(pb.sub(this.sampleColor, this.historyColor));
              })
              .$else(function () {
                this.resolvedColor = pb.mix(this.prevColor.rgb, this.currentColor.rgb, this.alpha);
                this.resolvedColor = this.reinhardInv(this.resolvedColor);
              });
            //this.$l.resolvedColor = pb.mix(this.prevColor.rgb, this.currentColor.rgb, this.alpha);
            //this.$l.resolvedColor = pb.vec3(pb.add(pb.mul(this.velocity.xy, 0.5), pb.vec2(0.5)), 0);
            //this.$l.resolvedColor = pb.abs(pb.sub(this.prevColor.rgb, this.currentColor.rgb));
            //this.$l.resolvedColor = pb.textureSampleLevel(this.historyColor, this.reprojectedUV, 0).rgb;
            this.$if(pb.equal(this.srgbOut, 0), function () {
              this.$outputs.outColor = pb.vec4(this.resolvedColor, 1);
            }).$else(function () {
              this.$outputs.outColor = pb.vec4(linearToGamma(this, this.resolvedColor), 1);
            });
          });
        }
      });
    }
    return this._resolveProgram;
  }
}
