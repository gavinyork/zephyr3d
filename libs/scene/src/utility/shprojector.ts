import type {
  AbstractDevice,
  BindGroup,
  FrameBuffer,
  GPUProgram,
  RenderStateSet,
  TextureCube
} from '@zephyr3d/device';
import { Application, DRef } from '../app';
import { Primitive } from '../render/primitive';
import { Vector4 } from '@zephyr3d/base';
import { fetchSampler } from './misc';

export class CubemapSHProjector {
  private static _program: GPUProgram = null;
  private static _programInst: GPUProgram = null;
  private static _bindGroup: BindGroup[] = [];
  private static _bindGroupInst: BindGroup = null;
  private static _renderStats: RenderStateSet = null;
  private static _windowWeights = [1, 2 / Math.PI, 0];
  private _primitive: DRef<Primitive>;
  private _renderTarget: DRef<FrameBuffer>[];
  private _numSamples: number;
  private _useInstancing: boolean;
  constructor(numSamples = 10000, useInstancing = false) {
    this._numSamples = numSamples;
    this._primitive = new DRef();
    this._renderTarget = [];
    this._useInstancing = useInstancing;
  }
  applyWindow(coeff: Float32Array, windowWeights: ArrayLike<number>) {
    for (let i = 0; i < 9; i++) {
      const weight = i < 1 ? windowWeights[0] : i < 4 ? windowWeights[1] : windowWeights[2];
      coeff[i * 4 + 0] *= weight;
      coeff[i * 4 + 1] *= weight;
      coeff[i * 4 + 2] *= weight;
    }
  }
  async shProject(
    cubemap: TextureCube,
    windowWeights?: ArrayLike<number>,
    outCoeff?: Float32Array
  ): Promise<Float32Array> {
    outCoeff = outCoeff ?? new Float32Array(9 * 4);
    const device = Application.instance.device;
    const clearColor = new Vector4(0, 0, 0, 1);
    this.init(device, this._useInstancing);
    device.pushDeviceStates();
    device.setRenderStates(CubemapSHProjector._renderStats);
    if (!this._useInstancing) {
      device.setProgram(CubemapSHProjector._program);
      for (let i = 0; i < 9; i++) {
        device.setFramebuffer(this._renderTarget[i].get());
        device.clearFrameBuffer(clearColor, null, null);
        const bindGroup = CubemapSHProjector._bindGroup[i];
        bindGroup.setTexture('cubemap', cubemap, fetchSampler('clamp_linear_nomip'));
        bindGroup.setValue('shIndex', i);
        device.setBindGroup(0, bindGroup);
        this._primitive.get().draw();
      }
    } else {
      device.setProgram(CubemapSHProjector._programInst);
      device.setFramebuffer(this._renderTarget[0].get());
      device.clearFrameBuffer(clearColor, null, null);
      const bindGroup = CubemapSHProjector._bindGroupInst;
      bindGroup.setTexture('cubemap', cubemap, fetchSampler('clamp_linear_nomip'));
      device.setBindGroup(0, bindGroup);
      this._primitive.get().drawInstanced(9);
    }
    device.popDeviceStates();
    if (!this._useInstancing) {
      const promises = this._renderTarget.map((fb, i) => {
        const subarray = outCoeff.subarray(i * 4, i * 4 + 4);
        return fb.get().getColorAttachments()[0].readPixels(0, 0, 1, 1, 0, 0, subarray);
      });
      await Promise.all(promises);
    } else {
      await this._renderTarget[0].get().getColorAttachments()[0].readPixels(0, 0, 3, 3, 0, 0, outCoeff);
    }
    this.applyWindow(outCoeff, windowWeights ?? CubemapSHProjector._windowWeights);
    return outCoeff;
  }
  private init(device: AbstractDevice, useInstancing: boolean) {
    if (!this._primitive.get()) {
      const samples = new Float32Array(this._numSamples * 4);
      for (let i = 0; i < this._numSamples; i++) {
        let x1: number, x2: number, s: number;
        do {
          x1 = Math.random() * 2 - 1;
          x2 = Math.random() * 2 - 1;
          s = x1 * x1 + x2 * x2;
        } while (s >= 1);
        const sqrtS = Math.sqrt(1 - s);
        samples[i * 4 + 0] = 2 * x1 * sqrtS;
        samples[i * 4 + 1] = 2 * x2 * sqrtS;
        samples[i * 4 + 2] = 1 - 2 * s;
        samples[i * 4 + 3] = (4 * Math.PI) / this._numSamples;
      }
      const primitive = new Primitive();
      primitive.createAndSetVertexBuffer('position_f32x4', samples);
      primitive.indexCount = this._numSamples;
      primitive.indexStart = 0;
      primitive.primitiveType = 'point-list';
      this._primitive.set(primitive);
    }

    if (this._renderTarget.length === 0) {
      if (!useInstancing) {
        for (let i = 0; i < 9; i++) {
          const texture = device.createTexture2D('rgba32f', 1, 1, {
            samplerOptions: { mipFilter: 'none' }
          });
          this._renderTarget.push(new DRef(device.createFrameBuffer([texture], null)));
        }
      } else {
        const texture = device.createTexture2D('rgba32f', 3, 3, {
          samplerOptions: { mipFilter: 'none' }
        });
        this._renderTarget.push(new DRef(device.createFrameBuffer([texture], null)));
      }
    }

    if (!CubemapSHProjector._renderStats) {
      CubemapSHProjector._renderStats = device.createRenderStateSet();
      CubemapSHProjector._renderStats.useDepthState().enableTest(false).enableWrite(false);
      CubemapSHProjector._renderStats
        .useBlendingState()
        .enable(true)
        .setBlendEquation('add', 'add')
        .setBlendFuncRGB('one', 'one')
        .setBlendFuncAlpha('zero', 'one');
      CubemapSHProjector._renderStats.useRasterizerState().setCullMode('none');
    }

    if (!CubemapSHProjector._program) {
      CubemapSHProjector._program = CubemapSHProjector._createProgram(device, false);
      console.log(CubemapSHProjector._program.getShaderSource('vertex'));
      console.log(CubemapSHProjector._program.getShaderSource('fragment'));
      for (let i = 0; i < 9; i++) {
        CubemapSHProjector._bindGroup.push(
          device.createBindGroup(CubemapSHProjector._program.bindGroupLayouts[0])
        );
      }
    }

    if (!CubemapSHProjector._programInst) {
      CubemapSHProjector._programInst = CubemapSHProjector._createProgram(device, true);
      CubemapSHProjector._bindGroupInst = device.createBindGroup(
        CubemapSHProjector._programInst.bindGroupLayouts[0]
      );
    }
  }
  private static _createProgram(device: AbstractDevice, instancing: boolean) {
    return device.buildRenderProgram({
      vertex(pb) {
        this.$inputs.directionWeight = pb.vec4().attrib('position');
        pb.main(function () {
          this.$outputs.direction = this.$inputs.directionWeight.xyz;
          this.$outputs.weight = this.$inputs.directionWeight.w;
          if (pb.getDevice().type !== 'webgpu') {
            this.$builtins.pointSize = 1;
          }
          if (!instancing) {
            this.$builtins.position = pb.vec4(0, 0, 0, 1);
          } else {
            this.$outputs.shIndex = pb.int(this.$builtins.instanceIndex);
            this.$l.x = pb.mod(this.$builtins.instanceIndex, 3);
            this.$l.y = pb.div(this.$builtins.instanceIndex, 3);
            this.$l.ndcX = pb.sub(pb.div(pb.add(pb.float(this.x), 0.5), 1.5), 1);
            this.$l.ndcY = pb.sub(pb.div(pb.add(pb.float(this.y), 0.5), 1.5), 1);
            this.$l.$builtins.position = pb.vec4(this.ndcX, this.ndcY, 0, 1);
            if (pb.getDevice().type === 'webgpu') {
              this.$builtins.position = pb.mul(this.$builtins.position, pb.vec4(1, -1, 1, 1));
            }
          }
        });
      },
      fragment(pb) {
        this.$outputs.color = pb.vec4();
        this.cubemap = pb.texCube().uniform(0);
        if (!instancing) {
          this.shIndex = pb.int().uniform(0);
        }
        pb.func('Y0', [pb.vec3('v')], function () {
          this.$return(0.282094791773878);
        });
        pb.func('Y1', [pb.vec3('v')], function () {
          this.$return(pb.mul(this.v.y, -0.4886025119));
        });
        pb.func('Y2', [pb.vec3('v')], function () {
          this.$return(pb.mul(this.v.z, 0.4886025119));
        });
        pb.func('Y3', [pb.vec3('v')], function () {
          this.$return(pb.mul(this.v.x, -0.4886025119));
        });
        pb.func('Y4', [pb.vec3('v')], function () {
          this.$return(pb.mul(this.v.x, this.v.y, 1.0925484306));
        });
        pb.func('Y5', [pb.vec3('v')], function () {
          this.$return(pb.mul(this.v.y, this.v.z, -1.0925484306));
        });
        pb.func('Y6', [pb.vec3('v')], function () {
          this.$return(pb.mul(pb.sub(pb.mul(this.v.z, this.v.z, 3), 1), 0.3153915652));
        });
        pb.func('Y7', [pb.vec3('v')], function () {
          this.$return(pb.mul(this.v.x, this.v.z, -1.0925484306));
        });
        pb.func('Y8', [pb.vec3('v')], function () {
          this.$return(pb.mul(pb.sub(pb.mul(this.v.x, this.v.x), pb.mul(this.v.y, this.v.y)), 0.5462742153));
        });
        pb.func('evalBasis', [pb.vec3('dir'), pb.int('c')], function () {
          this.$if(pb.equal(this.c, 0), function () {
            this.$return(this.Y0(this.dir));
          })
            .$elseif(pb.equal(this.c, 1), function () {
              this.$return(this.Y1(this.dir));
            })
            .$elseif(pb.equal(this.c, 2), function () {
              this.$return(this.Y2(this.dir));
            })
            .$elseif(pb.equal(this.c, 3), function () {
              this.$return(this.Y3(this.dir));
            })
            .$elseif(pb.equal(this.c, 4), function () {
              this.$return(this.Y4(this.dir));
            })
            .$elseif(pb.equal(this.c, 5), function () {
              this.$return(this.Y5(this.dir));
            })
            .$elseif(pb.equal(this.c, 6), function () {
              this.$return(this.Y6(this.dir));
            })
            .$elseif(pb.equal(this.c, 7), function () {
              this.$return(this.Y7(this.dir));
            })
            .$elseif(pb.equal(this.c, 8), function () {
              this.$return(this.Y8(this.dir));
            })
            .$else(function () {
              this.$return(0);
            });
        });
        pb.main(function () {
          this.$l.radiance = pb.textureSampleLevel(this.cubemap, this.$inputs.direction, 0).rgb;
          this.$l.sh = this.evalBasis(
            this.$inputs.direction,
            !instancing ? this.shIndex : this.$inputs.shIndex
          );
          this.$outputs.color = pb.vec4(pb.mul(this.radiance, this.sh, this.$inputs.weight), 1);
        });
      }
    });
  }
}
