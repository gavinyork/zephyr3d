import type {
  AbstractDevice,
  BindGroup,
  FrameBuffer,
  GPUDataBuffer,
  GPUProgram,
  RenderStateSet,
  TextureCube
} from '@zephyr3d/device';
import { Application } from '../app';
import { Primitive } from '../render/primitive';
import { Disposable, DRef, Vector4 } from '@zephyr3d/base';
import { fetchSampler } from './misc';

/**
 * CubemapSHProjector is responsible for projecting a cubemap texture into spherical harmonics (SH) coefficients.
 * This is commonly used for efficient environment lighting approximation in real-time rendering.
 *
 * The class uses Monte Carlo sampling to compute the first 9 spherical harmonics coefficients (up to order 2)
 * from a cubemap texture, which can then be used for ambient lighting calculations.
 *
 * @example
 * ```typescript
 * const projector = new CubemapSHProjector(10000);
 * const shBuffer = device.createBuffer(4 * 4 * 9, { usage: 'uniform' });
 * projector.projectCubemap(environmentCubemap, shBuffer);
 * // shBuffer now contains the 9 SH coefficients as RGB values
 * projector.dispose();
 * ```
 *
 * @public
 */
export class CubemapSHProjector extends Disposable {
  private static _programInst: GPUProgram = null;
  private static _bindGroupInst: BindGroup = null;
  private static _renderStats: RenderStateSet = null;
  private readonly _primitive: DRef<Primitive>;
  private readonly _renderTarget: DRef<FrameBuffer>;
  private readonly _numSamples: number;
  /**
   * Creates a new CubemapSHProjector instance.
   *
   * @param numSamples - Number of Monte Carlo samples to use for SH projection.
   *                     Higher values provide better accuracy but slower computation.
   *                     Default is 10000.
   */
  constructor(numSamples = 10000) {
    super();
    this._numSamples = numSamples;
    this._primitive = new DRef();
    this._renderTarget = new DRef();
  }
  /**
   * Projects a cubemap texture into spherical harmonics coefficients and stores them in a GPUBuffer.
   *
   * The method performs Monte Carlo integration over the sphere to compute the first 9 SH coefficients.
   * The results are written to a 3x3 render target where each pixel contains RGB values for one SH coefficient.
   * The layout is:
   * - (0,0): Y₀₀  (0,1): Y₁₋₁  (0,2): Y₁₀
   * - (1,0): Y₁₁  (1,1): Y₂₋₂  (1,2): Y₂₋₁
   * - (2,0): Y₂₀  (2,1): Y₂₁   (2,2): Y₂₂
   *
   * @param cubemap - The input cubemap texture to project
   * @param outBuffer - GPU data buffer to receive the computed SH coefficients.
   *                    Must be large enough to hold 9 RGB values (36 floats for RGBA32F format).
   *
   * @example
   * ```typescript
   * const shBuffer = device.createDataBuffer(9 * 4 * 4); // 9 coefficients * 4 components * 4 bytes
   * projector.projectCubemap(environmentMap, shBuffer);
   * ```
   */
  projectCubemap(cubemap: TextureCube, outBuffer: GPUDataBuffer) {
    this.projectCubemapToTexture(cubemap, this._renderTarget.get());
    this._renderTarget.get().getColorAttachments()[0].readPixelsToBuffer(0, 0, 3, 3, 0, 0, outBuffer);
  }
  /**
   * Projects a cubemap texture into spherical harmonics coefficients and stores them in a 3x3 texture.
   *
   * The method performs Monte Carlo integration over the sphere to compute the first 9 SH coefficients.
   * The results are written to a 3x3 render target where each pixel contains RGB values for one SH coefficient.
   * The layout is:
   * - (0,0): Y₀₀  (0,1): Y₁₋₁  (0,2): Y₁₀
   * - (1,0): Y₁₁  (1,1): Y₂₋₂  (1,2): Y₂₋₁
   * - (2,0): Y₂₀  (2,1): Y₂₁   (2,2): Y₂₂
   *
   * @param cubemap - The input cubemap texture to project
   * @param outFramebuffer - Framebuffer that contains the 3x3 texture to receive the computed SH coefficients in color attachment slot 0.
   *
   * @example
   * ```typescript
   * const shTexture = device.createTexture2D('rgba32f', 3, 3); // 9 coefficients * 4 components * 4 bytes
   * const shFramebuffer = device.createFrameBuffer([shTexture], null);
   * projector.projectCubemapToTexture(environmentMap, shFramebuffer);
   * ```
   */
  projectCubemapToTexture(cubemap: TextureCube, framebuffer: FrameBuffer) {
    const device = Application.instance.device;
    const clearColor = new Vector4(0, 0, 0, 1);
    this.init(device);
    device.pushDeviceStates();
    device.setRenderStates(CubemapSHProjector._renderStats);
    device.setProgram(CubemapSHProjector._programInst);
    device.setFramebuffer(framebuffer);
    device.clearFrameBuffer(clearColor, null, null);
    const bindGroup = CubemapSHProjector._bindGroupInst;
    bindGroup.setTexture('cubemap', cubemap, fetchSampler('clamp_linear_nomip'));
    device.setBindGroup(0, bindGroup);
    this._primitive.get().drawInstanced(9);
    device.popDeviceStates();
  }
  /**
   * Disposes of all resources allocated by this projector instance.
   * Should be called when the projector is no longer needed to prevent memory leaks.
   */
  protected onDispose() {
    super.onDispose();
    this._primitive.dispose();
    if (this._renderTarget.get()) {
      this._renderTarget.get().getColorAttachments()[0].dispose();
      this._renderTarget.dispose();
    }
  }
  /**
   * Initializes the GPU resources needed for SH projection.
   * This method is called automatically by projectCubemap() and sets up:
   * - Sample directions primitive (Monte Carlo samples on unit sphere)
   * - Render target (3x3 RGBA32F texture)
   * - Render states (additive blending, no depth test)
   * - GPU program for SH evaluation
   *
   * @param device - The graphics device to create resources with
   * @internal
   */
  private init(device: AbstractDevice) {
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
      if (device.type === 'webgl') {
        primitive.createAndSetVertexBuffer(
          'tex0_f32',
          new Float32Array([0, 1, 2, 3, 4, 5, 6, 7, 8]),
          'instance'
        );
      }
      primitive.indexCount = this._numSamples;
      primitive.indexStart = 0;
      primitive.primitiveType = 'point-list';
      this._primitive.set(primitive);
    }

    if (!this._renderTarget.get()) {
      const texture = device.createTexture2D('rgba32f', 3, 3, {
        samplerOptions: { mipFilter: 'none' }
      });
      this._renderTarget.set(device.createFrameBuffer([texture], null));
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

    if (!CubemapSHProjector._programInst) {
      CubemapSHProjector._programInst = CubemapSHProjector._createProgram(device);
      CubemapSHProjector._bindGroupInst = device.createBindGroup(
        CubemapSHProjector._programInst.bindGroupLayouts[0]
      );
    }
  }
  /**
   * Creates the GPU program for spherical harmonics evaluation.
   *
   * The vertex shader uses instanced rendering to generate 9 instances (one per SH coefficient).
   * Each instance renders all sample points, but the vertex shader maps them to different
   * pixels in the 3x3 output texture based on the instance ID.
   *
   * The fragment shader evaluates the appropriate SH basis function based on the pixel location,
   * samples the cubemap in the sample direction, and multiplies by the integration weight.
   *
   * @param device - The graphics device to create the program with
   * @returns The compiled GPU program
   * @internal
   */
  private static _createProgram(device: AbstractDevice) {
    return device.buildRenderProgram({
      vertex(pb) {
        this.$inputs.directionWeight = pb.vec4().attrib('position');
        if (device.type === 'webgl') {
          this.$inputs.instanceId = pb.float().attrib('texCoord0');
        }
        pb.main(function () {
          this.$outputs.direction = this.$inputs.directionWeight.xyz;
          this.$outputs.weight = this.$inputs.directionWeight.w;
          if (pb.getDevice().type !== 'webgpu') {
            this.$builtins.pointSize = 1;
          }
          this.$outputs.shIndex =
            device.type === 'webgl' ? this.$inputs.instanceId : pb.int(this.$builtins.instanceIndex);
          this.$l.x = pb.mod(this.$outputs.shIndex, 3);
          this.$l.y = pb.div(this.$outputs.shIndex, 3);
          this.$l.ndcX = pb.sub(pb.div(pb.add(pb.float(this.x), 0.5), 1.5), 1);
          this.$l.ndcY = pb.sub(pb.div(pb.add(pb.float(this.y), 0.5), 1.5), 1);
          this.$l.$builtins.position = pb.vec4(this.ndcX, this.ndcY, 0, 1);
          if (pb.getDevice().type === 'webgpu') {
            this.$builtins.position = pb.mul(this.$builtins.position, pb.vec4(1, -1, 1, 1));
          }
        });
      },
      fragment(pb) {
        this.$outputs.color = pb.vec4();
        this.cubemap = pb.texCube().uniform(0);
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
            pb.getDevice().type === 'webgl' ? pb.int(this.$inputs.shIndex) : this.$inputs.shIndex
          );
          this.$outputs.color = pb.vec4(pb.mul(this.radiance, this.sh, this.$inputs.weight), 1);
        });
      }
    });
  }
}
