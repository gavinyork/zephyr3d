import type { Nullable } from '@zephyr3d/base';
import { Vector2 } from '@zephyr3d/base';
import { AbstractPostEffect, PostEffectLayer } from './posteffect';
import { linearToGamma } from '../shaders/misc';
import type { AbstractDevice, BindGroup, GPUProgram, Texture2D } from '@zephyr3d/device';
import type { DrawContext } from '../render';
import { fetchSampler } from '../utility/misc';

/**
 * FXAA post effect
 * @public
 */
export class FXAA extends AbstractPostEffect {
  private static _program: Nullable<GPUProgram> = null;
  private static _bindgroup: Nullable<BindGroup> = null;
  private readonly _invTexSize: Vector2;
  /**
   * Creates an instance of grayscale post effect
   */
  constructor() {
    super();
    this._layer = PostEffectLayer.transparent;
    this._invTexSize = new Vector2();
  }
  /** {@inheritDoc AbstractPostEffect.requireLinearDepthTexture} */
  requireLinearDepthTexture(): boolean {
    return false;
  }
  /** {@inheritDoc AbstractPostEffect.requireDepthAttachment} */
  requireDepthAttachment(): boolean {
    return false;
  }
  /** {@inheritDoc AbstractPostEffect.apply} */
  apply(ctx: DrawContext, inputColorTexture: Texture2D, sceneDepthTexture: Texture2D, srgbOutput: boolean) {
    const device = ctx.device;
    this._prepare(device);
    this._invTexSize.setXY(1 / inputColorTexture.width, 1 / inputColorTexture.height);
    FXAA._bindgroup!.setTexture('srcTex', inputColorTexture, fetchSampler('clamp_linear_nomip'));
    FXAA._bindgroup!.setValue('flip', this.needFlip(device) ? 1 : 0);
    FXAA._bindgroup!.setValue('srgbOut', srgbOutput ? 1 : 0);
    FXAA._bindgroup!.setValue('invTexSize', this._invTexSize);
    device.setProgram(FXAA._program);
    device.setBindGroup(0, FXAA._bindgroup!);
    this.drawFullscreenQuad();
  }
  /** @internal */
  private _prepare(device: AbstractDevice) {
    if (!FXAA._program) {
      FXAA._program = device.buildRenderProgram({
        vertex(pb) {
          this.flip = pb.int().uniform(0);
          this.$inputs.pos = pb.vec2().attrib('position');
          this.$outputs.uv = pb.vec2();
          pb.main(function () {
            this.$builtins.position = pb.vec4(this.$inputs.pos, 0, 1);
            this.$outputs.uv = pb.add(pb.mul(this.$inputs.pos.xy, 0.5), pb.vec2(0.5));
            this.$if(pb.notEqual(this.flip, 0), function () {
              this.$builtins.position.y = pb.neg(this.$builtins.position.y);
            });
          });
        },
        fragment(pb) {
          this.srcTex = pb.tex2D().uniform(0);
          this.srgbOut = pb.int().uniform(0);
          this.invTexSize = pb.vec2().uniform(0);
          this.$outputs.outColor = pb.vec4();
          pb.func('getLuma', [pb.vec3('vSample')], function () {
            this.$return(pb.dot(this.vSample, pb.vec3(0.299, 0.587, 0.114)));
          });
          pb.func('FXAA', [pb.vec2('uv')], function () {
            this.$l.posM = this.uv;
            this.$l.rgbyM = pb.textureSampleLevel(this.srcTex, this.uv, 0);
            this.$l.lumaM = this.getLuma(this.rgbyM.rgb);
            this.$l.lumaN = this.getLuma(
              pb.textureSampleLevel(this.srcTex, pb.add(this.uv, pb.mul(pb.vec2(0, -1), this.invTexSize)), 0)
                .rgb
            );
            this.$l.lumaW = this.getLuma(
              pb.textureSampleLevel(this.srcTex, pb.add(this.uv, pb.mul(pb.vec2(-1, 0), this.invTexSize)), 0)
                .rgb
            );
            this.$l.lumaE = this.getLuma(
              pb.textureSampleLevel(this.srcTex, pb.add(this.uv, pb.mul(pb.vec2(1, 0), this.invTexSize)), 0)
                .rgb
            );
            this.$l.lumaS = this.getLuma(
              pb.textureSampleLevel(this.srcTex, pb.add(this.uv, pb.mul(pb.vec2(0, 1), this.invTexSize)), 0)
                .rgb
            );
            this.$l.rangeMin = pb.min(
              this.lumaM,
              pb.min(pb.min(this.lumaN, this.lumaW), pb.min(this.lumaS, this.lumaE))
            );
            this.$l.rangeMax = pb.max(
              this.lumaM,
              pb.max(pb.max(this.lumaN, this.lumaW), pb.max(this.lumaS, this.lumaE))
            );
            this.$l.range = pb.sub(this.rangeMax, this.rangeMin);
            this.$if(pb.lessThan(this.range, pb.max(1 / 16, pb.div(this.rangeMax, 8))), function () {
              this.$return(this.rgbyM);
            });
            this.$l.lumaNW = this.getLuma(
              pb.textureSampleLevel(this.srcTex, pb.add(this.uv, pb.mul(pb.vec2(-1, -1), this.invTexSize)), 0)
                .rgb
            );
            this.$l.lumaNE = this.getLuma(
              pb.textureSampleLevel(this.srcTex, pb.add(this.uv, pb.mul(pb.vec2(1, -1), this.invTexSize)), 0)
                .rgb
            );
            this.$l.lumaSW = this.getLuma(
              pb.textureSampleLevel(this.srcTex, pb.add(this.uv, pb.mul(pb.vec2(-1, 1), this.invTexSize)), 0)
                .rgb
            );
            this.$l.lumaSE = this.getLuma(
              pb.textureSampleLevel(this.srcTex, pb.add(this.uv, pb.mul(pb.vec2(1, 1), this.invTexSize)), 0)
                .rgb
            );
            this.$l.lumaNS = pb.add(this.lumaN, this.lumaS);
            this.$l.lumaWE = pb.add(this.lumaW, this.lumaE);
            this.$l.subpixRcpRange = pb.div(1, this.range);
            this.$l.subpixNSWE = pb.add(this.lumaNS, this.lumaWE);
            this.$l.edgeHorz1 = pb.add(pb.mul(-2, this.lumaM), this.lumaNS);
            this.$l.edgeVert1 = pb.add(pb.mul(-2, this.lumaM), this.lumaWE);
            this.$l.lumaNESE = pb.add(this.lumaNE, this.lumaSE);
            this.$l.lumaNWNE = pb.add(this.lumaNW, this.lumaNE);
            this.$l.edgeHorz2 = pb.add(pb.mul(-2, this.lumaE), this.lumaNESE);
            this.$l.edgeVert2 = pb.add(pb.mul(-2, this.lumaN), this.lumaNWNE);
            this.$l.lumaNWSW = pb.add(this.lumaNW, this.lumaSW);
            this.$l.lumaSWSE = pb.add(this.lumaSW, this.lumaSE);
            this.$l.edgeHorz4 = pb.add(pb.mul(pb.abs(this.edgeHorz1), 2), pb.abs(this.edgeHorz2));
            this.$l.edgeVert4 = pb.add(pb.mul(pb.abs(this.edgeVert1), 2), pb.abs(this.edgeVert2));
            this.$l.edgeHorz3 = pb.add(pb.mul(-2, this.lumaW), this.lumaNWSW);
            this.$l.edgeVert3 = pb.add(pb.mul(-2, this.lumaS), this.lumaSWSE);
            this.$l.edgeHorz = pb.add(pb.abs(this.edgeHorz3), this.edgeHorz4);
            this.$l.edgeVert = pb.add(pb.abs(this.edgeVert3), this.edgeVert4);
            this.$l.subpixNWSWNESE = pb.add(this.lumaNWSW, this.lumaNESE);
            this.$l.lengthSign = this.invTexSize.x;
            this.$l.horzSpan = pb.greaterThanEqual(this.edgeHorz, this.edgeVert);
            this.$l.subpixA = pb.add(pb.mul(this.subpixNSWE, 2), this.subpixNWSWNESE);
            this.$if(pb.not(this.horzSpan), function () {
              this.lumaN = this.lumaW;
              this.lumaS = this.lumaE;
            }).$else(function () {
              this.lengthSign = this.invTexSize.y;
            });
            this.$l.subpixB = pb.sub(pb.div(this.subpixA, 12), this.lumaM);
            this.$l.gradientN = pb.sub(this.lumaN, this.lumaM);
            this.$l.gradientS = pb.sub(this.lumaS, this.lumaM);
            this.$l.lumaNN = pb.add(this.lumaN, this.lumaM);
            this.$l.lumaSS = pb.add(this.lumaS, this.lumaM);
            this.$l.pairN = pb.greaterThanEqual(pb.abs(this.gradientN), pb.abs(this.gradientS));
            this.$l.gradient = pb.max(pb.abs(this.gradientN), pb.abs(this.gradientS));
            this.$if(this.pairN, function () {
              this.lengthSign = pb.neg(this.lengthSign);
            });
            this.$l.subpixC = pb.clamp(pb.mul(pb.abs(this.subpixB), this.subpixRcpRange), 0, 1);

            this.$l.posB = this.posM;
            this.$l.offNP = pb.vec2();
            this.$if(pb.not(this.horzSpan), function () {
              this.offNP.x = 0;
              this.offNP.y = this.invTexSize.y;
              this.posB.x = pb.add(this.posB.x, pb.mul(this.lengthSign, 0.5));
            }).$else(function () {
              this.offNP.x = this.invTexSize.x;
              this.offNP.y = 0;
              this.posB.y = pb.add(this.posB.y, pb.mul(this.lengthSign, 0.5));
            });
            this.$l.posN = pb.sub(this.posB, this.offNP);
            this.$l.posP = pb.add(this.posB, this.offNP);
            this.$l.subpixD = pb.add(pb.mul(-2, this.subpixC), 3);
            this.$l.lumaEndN = this.getLuma(pb.textureSampleLevel(this.srcTex, this.posN, 0).rgb);
            this.$l.subpixE = pb.mul(this.subpixC, this.subpixC);
            this.$l.lumaEndP = this.getLuma(pb.textureSampleLevel(this.srcTex, this.posP, 0).rgb);
            this.$if(pb.not(this.pairN), function () {
              this.lumaNN = this.lumaSS;
            });
            this.$l.gradientScaled = pb.div(this.gradient, 4);
            this.$l.lumaMM = pb.sub(this.lumaM, pb.mul(this.lumaNN, 0.5));
            this.$l.subpixF = pb.mul(this.subpixD, this.subpixE);
            this.$l.lumaMLTZero = pb.lessThan(this.lumaMM, 0);

            this.lumaEndN = pb.sub(this.lumaEndN, pb.mul(this.lumaNN, 0.5));
            this.lumaEndP = pb.sub(this.lumaEndP, pb.mul(this.lumaNN, 0.5));
            this.$l.doneN = pb.greaterThanEqual(pb.abs(this.lumaEndN), this.gradientScaled);
            this.$l.doneP = pb.greaterThanEqual(pb.abs(this.lumaEndP), this.gradientScaled);
            this.$if(pb.not(this.doneN), function () {
              this.posN = pb.sub(this.posN, pb.mul(this.offNP, 1.5));
            });
            this.$l.doneNP = pb.or(pb.not(this.doneN), pb.not(this.doneP));
            this.$if(pb.not(this.doneP), function () {
              this.posP = pb.add(this.posP, pb.mul(this.offNP, 1.5));
            });
            this.$if(this.doneNP, function () {
              this.$if(pb.not(this.doneN), function () {
                this.lumaEndN = this.getLuma(pb.textureSampleLevel(this.srcTex, this.posN.xy, 0).rgb);
                this.lumaEndN = pb.sub(this.lumaEndN, pb.mul(this.lumaNN, 0.5));
              });
              this.$if(pb.not(this.doneP), function () {
                this.lumaEndP = this.getLuma(pb.textureSampleLevel(this.srcTex, this.posP.xy, 0).rgb);
                this.lumaEndP = pb.sub(this.lumaEndP, pb.mul(this.lumaNN, 0.5));
              });
              this.doneN = pb.greaterThanEqual(pb.abs(this.lumaEndN), this.gradientScaled);
              this.doneP = pb.greaterThanEqual(pb.abs(this.lumaEndP), this.gradientScaled);
              this.$if(pb.not(this.doneN), function () {
                this.posN = pb.sub(this.posN, pb.mul(this.offNP, 2.0));
              });
              this.doneNP = pb.or(pb.not(this.doneN), pb.not(this.doneP));
              this.$if(pb.not(this.doneP), function () {
                this.posP = pb.add(this.posP, pb.mul(this.offNP, 2.0));
              });
              this.$if(this.doneNP, function () {
                this.$if(pb.not(this.doneN), function () {
                  this.lumaEndN = this.getLuma(pb.textureSampleLevel(this.srcTex, this.posN.xy, 0).rgb);
                  this.lumaEndN = pb.sub(this.lumaEndN, pb.mul(this.lumaNN, 0.5));
                });
                this.$if(pb.not(this.doneP), function () {
                  this.lumaEndP = this.getLuma(pb.textureSampleLevel(this.srcTex, this.posP.xy, 0).rgb);
                  this.lumaEndP = pb.sub(this.lumaEndP, pb.mul(this.lumaNN, 0.5));
                });
                this.doneN = pb.greaterThanEqual(pb.abs(this.lumaEndN), this.gradientScaled);
                this.doneP = pb.greaterThanEqual(pb.abs(this.lumaEndP), this.gradientScaled);
                this.$if(pb.not(this.doneN), function () {
                  this.posN = pb.sub(this.posN, pb.mul(this.offNP, 2.0));
                });
                this.doneNP = pb.or(pb.not(this.doneN), pb.not(this.doneP));
                this.$if(pb.not(this.doneP), function () {
                  this.posP = pb.add(this.posP, pb.mul(this.offNP, 2.0));
                });
                this.$if(this.doneNP, function () {
                  this.$if(pb.not(this.doneN), function () {
                    this.lumaEndN = this.getLuma(pb.textureSampleLevel(this.srcTex, this.posN.xy, 0).rgb);
                    this.lumaEndN = pb.sub(this.lumaEndN, pb.mul(this.lumaNN, 0.5));
                  });
                  this.$if(pb.not(this.doneP), function () {
                    this.lumaEndP = this.getLuma(pb.textureSampleLevel(this.srcTex, this.posP.xy, 0).rgb);
                    this.lumaEndP = pb.sub(this.lumaEndP, pb.mul(this.lumaNN, 0.5));
                  });
                  this.doneN = pb.greaterThanEqual(pb.abs(this.lumaEndN), this.gradientScaled);
                  this.doneP = pb.greaterThanEqual(pb.abs(this.lumaEndP), this.gradientScaled);
                  this.$if(pb.not(this.doneN), function () {
                    this.posN = pb.sub(this.posN, pb.mul(this.offNP, 4.0));
                  });
                  this.doneNP = pb.or(pb.not(this.doneN), pb.not(this.doneP));
                  this.$if(pb.not(this.doneP), function () {
                    this.posP = pb.add(this.posP, pb.mul(this.offNP, 4.0));
                  });
                  this.$if(this.doneNP, function () {
                    this.$if(pb.not(this.doneN), function () {
                      this.lumaEndN = this.getLuma(pb.textureSampleLevel(this.srcTex, this.posN.xy, 0).rgb);
                      this.lumaEndN = pb.sub(this.lumaEndN, pb.mul(this.lumaNN, 0.5));
                    });
                    this.$if(pb.not(this.doneP), function () {
                      this.lumaEndP = this.getLuma(pb.textureSampleLevel(this.srcTex, this.posP.xy, 0).rgb);
                      this.lumaEndP = pb.sub(this.lumaEndP, pb.mul(this.lumaNN, 0.5));
                    });
                    this.doneN = pb.greaterThanEqual(pb.abs(this.lumaEndN), this.gradientScaled);
                    this.doneP = pb.greaterThanEqual(pb.abs(this.lumaEndP), this.gradientScaled);
                    this.$if(pb.not(this.doneN), function () {
                      this.posN = pb.sub(this.posN, pb.mul(this.offNP, 2.0));
                    });
                    this.$if(pb.not(this.doneP), function () {
                      this.posP = pb.add(this.posP, pb.mul(this.offNP, 2.0));
                    });
                  });
                });
              });
            });
            this.$l.dstN = pb.sub(this.posM.x, this.posN.x);
            this.$l.dstP = pb.sub(this.posP.x, this.posM.x);
            this.$if(pb.not(this.horzSpan), function () {
              this.dstN = pb.sub(this.posM.y, this.posN.y);
              this.dstP = pb.sub(this.posP.y, this.posM.y);
            });

            this.$l.goodSpanN = pb.notEqual(pb.lessThan(this.lumaEndN, 0), this.lumaMLTZero);
            this.$l.spanLength = pb.add(this.dstP, this.dstN);
            this.$l.goodSpanP = pb.notEqual(pb.lessThan(this.lumaEndP, 0), this.lumaMLTZero);
            this.$l.spanLengthRcp = pb.div(1, this.spanLength);

            this.$l.directionN = pb.lessThan(this.dstN, this.dstP);
            this.$l.dst = pb.min(this.dstN, this.dstP);
            this.$l.goodSpan = this.$choice(this.directionN, this.goodSpanN, this.goodSpanP);
            this.$l.subpixG = pb.mul(this.subpixF, this.subpixF);
            this.$l.pixelOffset = pb.add(pb.mul(this.dst, pb.neg(this.spanLengthRcp)), 0.5);
            this.$l.subpixH = pb.mul(this.subpixG, 0.75);

            this.$l.pixelOffsetGood = this.$choice(this.goodSpan, this.pixelOffset, 0);
            this.$l.pixelOffsetSubpix = pb.max(this.pixelOffsetGood, this.subpixH);
            this.$if(pb.not(this.horzSpan), function () {
              this.posM.x = pb.add(this.posM.x, pb.mul(this.pixelOffsetSubpix, this.lengthSign));
            }).$else(function () {
              this.posM.y = pb.add(this.posM.y, pb.mul(this.pixelOffsetSubpix, this.lengthSign));
            });
            this.$return(pb.textureSampleLevel(this.srcTex, this.posM, 0).xyzw);
          });
          pb.main(function () {
            this.$l.color = this.FXAA(this.$inputs.uv);
            this.$if(pb.equal(this.srgbOut, 0), function () {
              this.$outputs.outColor = this.color;
            }).$else(function () {
              this.$outputs.outColor = pb.vec4(linearToGamma(this, this.color.rgb), this.color.a);
            });
          });
        }
      })!;
      FXAA._program.name = '@FXAA_program';
      FXAA._bindgroup = device.createBindGroup(FXAA._program.bindGroupLayouts[0]);
    }
  }
}
