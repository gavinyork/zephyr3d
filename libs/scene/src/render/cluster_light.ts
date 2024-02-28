import { Matrix4x4, Vector4 } from '@zephyr3d/base';
import { Application } from '../app';
import { MAX_CLUSTERED_LIGHTS } from '../values';
import type {
  AbstractDevice,
  BindGroup,
  FrameBuffer,
  GPUProgram,
  PBStructTypeInfo,
  RenderStateSet,
  StructuredBuffer,
  Texture2D,
  VertexLayout
} from '@zephyr3d/device';
import type { Camera } from '../camera/camera';
import type { RenderQueue } from './render_queue';
import { ShaderHelper } from '../material/shader/helper';

export class ClusteredLight {
  private _tileCountX: number;
  private _tileCountY: number;
  private _tileCountZ: number;
  private _lights: Float32Array;
  private _lightIndexTexture: Texture2D;
  private _lightIndexFramebuffer: FrameBuffer;
  private _lightIndexProgram: GPUProgram;
  private _bindGroup: BindGroup;
  private _lightIndexVertexLayout: VertexLayout;
  private _lightIndexRenderStates: RenderStateSet;
  private _lightBuffer: StructuredBuffer;
  private _sizeParam: Vector4;
  private _countParam: Int32Array;
  private _clusterParam: Vector4;
  constructor() {
    this._tileCountX = 16;
    this._tileCountY = 16;
    this._tileCountZ = 32;
    this._lights = new Float32Array(12 * (MAX_CLUSTERED_LIGHTS + 1));
    this._lightIndexTexture = null;
    this._lightIndexFramebuffer = null;
    this._lightIndexProgram = null;
    this._lightBuffer = null;
    this._bindGroup = null;
    this._lightIndexVertexLayout = null;
    this._lightIndexRenderStates = null;
    this._sizeParam = new Vector4();
    this._countParam = new Int32Array(4);
    this._clusterParam = new Vector4();
  }
  get lightBuffer() {
    return this._lightBuffer;
  }
  get clusterParam() {
    return this._clusterParam;
  }
  get countParam() {
    return this._countParam;
  }
  get lightIndexTexture() {
    return this._lightIndexTexture;
  }
  private createVertexLayout(device: AbstractDevice, textureWidth: number, textureHeight: number) {
    let vb: StructuredBuffer;
    if (device.type === 'webgl') {
      const vertices = new Float32Array(this._tileCountX * this._tileCountY * this._tileCountZ * 3);
      for (let i = 0; i < vertices.length; i++) {
        const ix = i % textureWidth;
        const iy = Math.floor(i / textureWidth);
        vertices[i * 3 + 0] = (2 * (ix + 0.5)) / textureWidth - 1;
        vertices[i * 3 + 1] = (2 * (iy + 0.5)) / textureHeight - 1;
        vertices[i * 3 + 2] = i;
      }
      vb = device.createVertexBuffer('position_f32x3', vertices);
    } else {
      const vertices = new Float32Array(this._tileCountX * this._tileCountY * this._tileCountZ * 2);
      for (let i = 0; i < vertices.length; i++) {
        const ix = i % textureWidth;
        const iy = Math.floor(i / textureWidth);
        vertices[i * 2 + 0] = (2 * (ix + 0.5)) / textureWidth - 1;
        vertices[i * 2 + 1] = (2 * (iy + 0.5)) / textureHeight - 1;
      }
      vb = device.createVertexBuffer('position_f32x2', vertices);
    }
    this._lightIndexVertexLayout = device.createVertexLayout({
      vertexBuffers: [{ buffer: vb }]
    });
  }
  private createRenderState(device: AbstractDevice) {
    this._lightIndexRenderStates = device.createRenderStateSet();
    this._lightIndexRenderStates.useDepthState().enableTest(false).enableWrite(false);
    this._lightIndexRenderStates.useRasterizerState().setCullMode('none');
  }
  private createProgram(device: AbstractDevice) {
    const webgl1 = device.type === 'webgl';
    this._lightIndexProgram = device.buildRenderProgram({
      vertex(pb) {
        this.$inputs.pos = (webgl1 ? pb.vec3() : pb.vec2()).attrib('position');
        this.$outputs.value = webgl1 ? pb.vec4() : pb.uvec4();
        this.invProjMatrix = pb.mat4().uniform(0);
        this.viewMatrix = pb.mat4().uniform(0);
        this.sizeParam = pb.vec4().uniform(0);
        this.countParam = pb.ivec4().uniform(0);
        this[ShaderHelper.getLightBufferUniformName()] = pb.vec4[(MAX_CLUSTERED_LIGHTS + 1) * 3]().uniformBuffer(0);
        pb.func('lineIntersectionToZPlane', [pb.vec3('a'), pb.vec3('b'), pb.float('zDistance')], function () {
          this.$l.normal = pb.vec3(0, 0, 1);
          this.$l.ab = pb.sub(this.b, this.a);
          this.$l.t = pb.div(
            pb.sub(this.zDistance, pb.dot(this.normal, this.a)),
            pb.dot(this.normal, this.ab)
          );
          this.$return(pb.add(this.a, pb.mul(this.t, this.ab)));
        });
        pb.func('clipToView', [pb.vec4('clip')], function () {
          this.$l.view = pb.mul(this.invProjMatrix, this.clip);
          this.$return(pb.div(this.view, this.view.w));
        });
        pb.func('screenToView', [pb.vec4('screen')], function () {
          this.$l.texCoord = pb.div(this.screen.xy, this.sizeParam.xy);
          this.$l.clip = pb.vec4(
            pb.sub(pb.mul(pb.vec2(this.texCoord.x, pb.sub(1, this.texCoord.y)), 2), pb.vec2(1)),
            this.screen.z,
            this.screen.w
          );
          this.$return(this.clipToView(this.clip));
        });
        pb.func(
          'sphereIntersectsAABB',
          [pb.vec4('sphere'), pb.vec3('aabbMin'), pb.vec3('aabbMax')],
          function () {
            this.$l.dmin = pb.float(0);
            this.$if(pb.lessThanEqual(this.sphere.w, 0), function () {
              this.$return(true);
            });
            this.$for(pb.int('i'), 0, 3, function () {
              this.$if(pb.lessThan(this.sphere.at(this.i), this.aabbMin.at(this.i)), function () {
                this.$l.delta = pb.sub(this.sphere.at(this.i), this.aabbMin.at(this.i));
                this.dmin = pb.add(this.dmin, pb.mul(this.delta, this.delta));
              }).$elseif(pb.greaterThan(this.sphere.at(this.i), this.aabbMax.at(this.i)), function () {
                this.$l.delta = pb.sub(this.sphere.at(this.i), this.aabbMax.at(this.i));
                this.dmin = pb.add(this.dmin, pb.mul(this.delta, this.delta));
              });
            });
            this.$if(pb.lessThanEqual(this.dmin, pb.mul(this.sphere.w, this.sphere.w)), function () {
              this.$return(true);
            });
            this.$return(false);
          }
        );
        pb.main(function () {
          if (pb.getDevice().type !== 'webgpu') {
            this.$builtins.pointSize = 1;
          }
          this.$builtins.position = pb.vec4(this.$inputs.pos.xy, 0, 1);
          if (pb.getDevice().type === 'webgpu') {
            this.$builtins.position = pb.mul(this.$builtins.position, pb.vec4(1, -1, 1, 1));
          }
          this.$l.tileIndex = webgl1 ? pb.int(this.$inputs.pos.z) : pb.int(this.$builtins.vertexIndex);
          this.$l.tileSize = pb.div(this.sizeParam.xy, pb.vec2(this.countParam.xy));
          this.$l.zIndex = pb.div(this.tileIndex, pb.mul(this.countParam.x, this.countParam.y));
          this.$l.yIndex = pb.div(
            pb.sub(this.tileIndex, pb.mul(this.zIndex, this.countParam.x, this.countParam.y)),
            this.countParam.x
          );
          this.$l.xIndex = pb.sub(
            this.tileIndex,
            pb.add(
              pb.mul(this.zIndex, this.countParam.x, this.countParam.y),
              pb.mul(this.yIndex, this.countParam.x)
            )
          );
          this.$l.maxPoint_sS = pb.vec4(
            pb.mul(
              pb.vec2(pb.float(pb.add(this.xIndex, 1)), pb.float(pb.add(this.yIndex, 1))),
              this.tileSize
            ),
            0.0,
            1.0
          );
          this.$l.minPoint_sS = pb.vec4(
            pb.mul(pb.vec2(pb.float(this.xIndex), pb.float(this.yIndex)), this.tileSize),
            0.0,
            1.0
          );
          this.$l.maxPoint_vS = this.screenToView(this.maxPoint_sS).xyz;
          this.$l.minPoint_vS = this.screenToView(this.minPoint_sS).xyz;
          this.$l.tileNear = pb.mul(
            pb.neg(this.sizeParam.z),
            pb.pow(
              pb.div(this.sizeParam.w, this.sizeParam.z),
              pb.div(pb.float(this.zIndex), pb.float(this.countParam.z))
            )
          );
          this.$l.tileFar = pb.mul(
            pb.neg(this.sizeParam.z),
            pb.pow(
              pb.div(this.sizeParam.w, this.sizeParam.z),
              pb.div(pb.add(pb.float(this.zIndex), 1), pb.float(this.countParam.z))
            )
          );
          this.$l.eyePos = pb.vec3(0);
          this.$l.minPointNear = this.lineIntersectionToZPlane(this.eyePos, this.minPoint_vS, this.tileNear);
          this.$l.minPointFar = this.lineIntersectionToZPlane(this.eyePos, this.minPoint_vS, this.tileFar);
          this.$l.maxPointNear = this.lineIntersectionToZPlane(this.eyePos, this.maxPoint_vS, this.tileNear);
          this.$l.maxPointFar = this.lineIntersectionToZPlane(this.eyePos, this.maxPoint_vS, this.tileFar);
          this.$l.aabbMin = pb.min(
            pb.min(this.minPointNear, this.minPointFar),
            pb.min(this.maxPointNear, this.maxPointFar)
          );
          this.$l.aabbMax = pb.max(
            pb.max(this.minPointNear, this.minPointFar),
            pb.max(this.maxPointNear, this.maxPointFar)
          );
          this.$l.n = pb.int(0);
          if (webgl1) {
            this.$l.lightIndices = pb.float[8]();
            this.$for(pb.int('i'), 0, 8, function () {
              this.lightIndices.setAt(this.i, 0);
            });
            this.$for(pb.int('i'), 1, 256, function () {
              this.$if(pb.equal(this.i, this.countParam.w), function () {
                this.$break();
              });
              this.$l.light = this[ShaderHelper.getLightBufferUniformName()].at(pb.mul(this.i, 3));
              this.$l.lightPos = pb.mul(this.viewMatrix, pb.vec4(this.light.xyz, 1));
              this.$l.lightPos.w = this.light.w;
              this.$if(this.sphereIntersectsAABB(this.lightPos, this.aabbMin, this.aabbMax), function () {
                this.$for(pb.int('j'), 0, 8, function () {
                  this.$if(pb.equal(this.j, this.n), function () {
                    this.lightIndices.setAt(this.j, pb.float(this.i));
                    this.n = pb.add(this.n, 1);
                    this.$break();
                  });
                });
                this.$if(pb.equal(this.n, 8), function () {
                  this.$break();
                });
              });
            });
            this.$outputs.value.r = pb.add(pb.mul(this.lightIndices[0], 256), this.lightIndices[1]);
            this.$outputs.value.g = pb.add(pb.mul(this.lightIndices[2], 256), this.lightIndices[3]);
            this.$outputs.value.b = pb.add(pb.mul(this.lightIndices[4], 256), this.lightIndices[5]);
            this.$outputs.value.a = pb.add(pb.mul(this.lightIndices[6], 256), this.lightIndices[7]);
          } else {
            this.$l.lightIndex = [
              pb.uint(0),
              pb.uint(0),
              pb.uint(0),
              pb.uint(0),
              pb.uint(0),
              pb.uint(0),
              pb.uint(0),
              pb.uint(0),
              pb.uint(0),
              pb.uint(0),
              pb.uint(0),
              pb.uint(0),
              pb.uint(0),
              pb.uint(0),
              pb.uint(0),
              pb.uint(0)
            ];
            this.$for(pb.uint('i'), 1, pb.uint(this.countParam.w), function () {
              this.$l.light = this[ShaderHelper.getLightBufferUniformName()].at(pb.mul(this.i, 3));
              this.$l.lightPos = pb.mul(this.viewMatrix, pb.vec4(this.light.xyz, 1));
              this.$l.lightPos.w = this.light.w;
              this.$if(this.sphereIntersectsAABB(this.lightPos, this.aabbMin, this.aabbMax), function () {
                this.lightIndex.setAt(this.n, this.i);
                this.n = pb.add(this.n, 1);
                this.$if(pb.equal(this.n, 16), function () {
                  this.$break();
                });
              });
            });
            this.$l.r = pb.add(
              pb.sal(this.lightIndex[0], 24),
              pb.sal(this.lightIndex[1], 16),
              pb.sal(this.lightIndex[2], 8),
              this.lightIndex[3]
            );
            this.$l.g = pb.add(
              pb.sal(this.lightIndex[4], 24),
              pb.sal(this.lightIndex[5], 16),
              pb.sal(this.lightIndex[6], 8),
              this.lightIndex[7]
            );
            this.$l.b = pb.add(
              pb.sal(this.lightIndex[8], 24),
              pb.sal(this.lightIndex[9], 16),
              pb.sal(this.lightIndex[10], 8),
              this.lightIndex[11]
            );
            this.$l.a = pb.add(
              pb.sal(this.lightIndex[12], 24),
              pb.sal(this.lightIndex[13], 16),
              pb.sal(this.lightIndex[14], 8),
              this.lightIndex[15]
            );
            this.$outputs.value = pb.uvec4(this.r, this.g, this.b, this.a);
          }
        });
      },
      fragment(pb) {
        this.$outputs.color = webgl1 ? pb.vec4() : pb.uvec4();
        pb.main(function () {
          this.$outputs.color = this.$inputs.value;
        });
      }
    });
    this._bindGroup = device.createBindGroup(this._lightIndexProgram.bindGroupLayouts[0]);
    this._lightBuffer?.dispose();
    const lightBufferType = this._lightIndexProgram.getBindingInfo(ShaderHelper.getLightBufferUniformName()).type;
    this._lightBuffer = device.createStructuredBuffer(lightBufferType as PBStructTypeInfo, {
      usage: 'uniform'
    });
  }
  private createLightIndexTexture(device: AbstractDevice) {
    const exp = Math.log2(this._tileCountX * this._tileCountY * this._tileCountZ);
    const a = (exp + 1) >>> 1;
    const b = exp - a;
    const textureWidth = 2 << (a - 1);
    const textureHeight = 2 << (b - 1);
    if (textureWidth * textureHeight !== this._tileCountX * this._tileCountY * this._tileCountZ) {
      throw new Error('Internal error');
    }
    this._lightIndexTexture = device.createTexture2D(
      device.type === 'webgl' ? 'rgba32f' : 'rgba32ui',
      textureWidth,
      textureHeight,
      { samplerOptions: { mipFilter: 'none' } }
    );
    this._lightIndexTexture.name = 'ClusterLightIndex';
    this._lightIndexFramebuffer?.dispose();
    this._lightIndexFramebuffer = device.createFrameBuffer([this._lightIndexTexture], null);
  }
  calculateLightIndex(camera: Camera, renderQueue: RenderQueue) {
    const numLights = this.getVisibleLights(renderQueue, this._lights);
    const device = Application.instance.device;
    if (!this._lightIndexTexture) {
      this.createLightIndexTexture(device);
    }
    if (!this._lightIndexProgram) {
      this.createProgram(device);
    }
    if (!this._lightIndexVertexLayout) {
      this.createVertexLayout(device, this._lightIndexTexture.width, this._lightIndexTexture.height);
    }
    if (!this._lightIndexRenderStates) {
      this.createRenderState(device);
    }
    const viewport = device.getViewport();
    const vw = device.screenToDevice(viewport.width);
    const vh = device.screenToDevice(viewport.height);
    const scale = this._tileCountZ / Math.log2(camera.getFarPlane() / camera.getNearPlane());
    const bias = -(
      (this._tileCountZ * Math.log2(camera.getNearPlane())) /
      Math.log2(camera.getFarPlane() / camera.getNearPlane())
    );
    this._clusterParam.setXYZW(vw, vh, scale, bias);
    device.pushDeviceStates();
    device.setFramebuffer(this._lightIndexFramebuffer);
    if (numLights > 0) {
      this._lightBuffer.bufferSubData(0, this._lights);
      this._sizeParam.setXYZW(vw, vh, camera.getNearPlane(), camera.getFarPlane());
      this._countParam[0] = this._tileCountX;
      this._countParam[1] = this._tileCountY;
      this._countParam[2] = this._tileCountZ;
      this._countParam[3] = numLights + 1;
      this._bindGroup.setValue('invProjMatrix', Matrix4x4.invert(camera.getProjectionMatrix()));
      this._bindGroup.setValue('viewMatrix', camera.viewMatrix);
      this._bindGroup.setValue('sizeParam', this._sizeParam);
      this._bindGroup.setValue('countParam', this._countParam);
      this._bindGroup.setBuffer(ShaderHelper.getLightBufferUniformName(), this._lightBuffer);
      device.setProgram(this._lightIndexProgram);
      device.setVertexLayout(this._lightIndexVertexLayout);
      device.setBindGroup(0, this._bindGroup);
      const savedRS = device.getRenderStates();
      device.setRenderStates(this._lightIndexRenderStates);
      device.draw('point-list', 0, this._tileCountX * this._tileCountY * this._tileCountZ);
      device.setRenderStates(savedRS);
    } else {
      device.clearFrameBuffer(new Vector4(0, 0, 0, 0), 1, 0);
    }
    device.popDeviceStates();
  }
  private getVisibleLights(renderQueue: RenderQueue, lights: Float32Array): number {
    const numLights = Math.min(renderQueue.unshadowedLights.length, MAX_CLUSTERED_LIGHTS);
    for (let i = 1; i <= numLights; i++) {
      const light = renderQueue.unshadowedLights[i - 1];
      lights.set(light.positionAndRange, i * 12);
      lights.set(light.directionAndCutoff, i * 12 + 4);
      lights.set(light.diffuseAndIntensity, i * 12 + 8);
    }
    return numLights;
  }
}
