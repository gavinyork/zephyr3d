import type { Nullable, Vector3 } from '@zephyr3d/base';
import { DEPTH_CLEAR_VALUE, Vector4 } from '@zephyr3d/base';
import { MAX_SHADOW_MASK_LIGHTS } from '../values';
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
import type { PunctualLight } from '../scene/light';
import { ShaderHelper } from '../material/shader/helper';
import { getDevice } from '../app/api';

export class ClusteredLight {
  /** Emit the shadow-mask overflow warning only once per session. */
  private static _warnedShadowMaskOverflow = false;
  /** Instances returned by {@link ClusteredLight.release}, reused to keep their GPU resources. */
  private static readonly _pool: ClusteredLight[] = [];
  /**
   * Fetches an instance from the pool, creating one if it is empty.
   *
   * @remarks
   * The GPU work reading an instance's buffers may still be pending when the render
   * code is done with it, so release it only after the render graph has executed.
   */
  static acquire(): ClusteredLight {
    return this._pool.pop() ?? new ClusteredLight();
  }
  /** Returns an instance obtained from {@link ClusteredLight.acquire} to the pool. */
  static release(cl: ClusteredLight) {
    this._pool.push(cl);
  }
  private readonly _tileCountX: number;
  private readonly _tileCountY: number;
  private readonly _tileCountZ: number;
  private readonly _lights: Float32Array<ArrayBuffer>;
  private _lightIndexTexture: Nullable<Texture2D>;
  private _lightIndexFramebuffer: Nullable<FrameBuffer>;
  private _lightIndexProgram: Nullable<GPUProgram>;
  private _bindGroup: Nullable<BindGroup>;
  private _lightIndexVertexLayout: Nullable<VertexLayout>;
  private _lightIndexRenderStates: Nullable<RenderStateSet>;
  private _lightBuffer: Nullable<StructuredBuffer>;
  private readonly _sizeParam: Vector4;
  private _countParam: Int32Array<ArrayBuffer>;
  private readonly _clusterParam: Vector4;
  private _numShadowLights: number;
  private _orthographic: boolean;
  /** Scratch list of the lights competing for the slots after the mask-backed ones. */
  private readonly _rest: PunctualLight[];
  constructor() {
    this._tileCountX = 16;
    this._tileCountY = 16;
    this._tileCountZ = 32;
    this._lights = new Float32Array(16 * (ShaderHelper.getMaxClusterLights() + 1));
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
    this._numShadowLights = 0;
    this._orthographic = false;
    this._rest = [];
  }
  get lightBuffer() {
    return this._lightBuffer;
  }
  /**
   * Number of shadow-casting lights placed at the head of the clustered light
   * buffer (indices `1..N`), each backed by a screen-space shadow mask slot.
   * Zero unless the screen-space shadow mask path is active.
   */
  get numShadowLights() {
    return this._numShadowLights;
  }
  /**
   * Whether the clusters were built for an orthographic camera, which slices depth linearly
   * rather than exponentially. The lit shader reads it to compute the matching slice.
   */
  get orthographic() {
    return this._orthographic;
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
      vb = device.createVertexBuffer('position_f32x3', vertices)!;
    } else {
      const vertices = new Float32Array(this._tileCountX * this._tileCountY * this._tileCountZ * 2);
      for (let i = 0; i < vertices.length; i++) {
        const ix = i % textureWidth;
        const iy = Math.floor(i / textureWidth);
        vertices[i * 2 + 0] = (2 * (ix + 0.5)) / textureWidth - 1;
        vertices[i * 2 + 1] = (2 * (iy + 0.5)) / textureHeight - 1;
      }
      vb = device.createVertexBuffer('position_f32x2', vertices)!;
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
        this.orthoProj = pb.int().uniform(0);
        this[ShaderHelper.getLightBufferUniformName()] =
          pb.vec4[(ShaderHelper.getMaxClusterLights() + 1) * 4]().uniformBuffer(0);
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
          this.$l.sliceNear = pb.div(pb.float(this.zIndex), pb.float(this.countParam.z));
          this.$l.sliceFar = pb.div(pb.add(pb.float(this.zIndex), 1), pb.float(this.countParam.z));
          this.$l.aabbMin = pb.vec3();
          this.$l.aabbMax = pb.vec3();
          this.$if(pb.notEqual(this.orthoProj, 0), function () {
            // Orthographic: view rays are parallel, so a tile's view-space x/y extent does not
            // depend on depth, and slices are linear because near may be zero or negative.
            this.$l.tileNear = pb.neg(pb.mix(this.sizeParam.z, this.sizeParam.w, this.sliceNear));
            this.$l.tileFar = pb.neg(pb.mix(this.sizeParam.z, this.sizeParam.w, this.sliceFar));
            this.aabbMin = pb.vec3(pb.min(this.minPoint_vS.xy, this.maxPoint_vS.xy), this.tileFar);
            this.aabbMax = pb.vec3(pb.max(this.minPoint_vS.xy, this.maxPoint_vS.xy), this.tileNear);
          }).$else(function () {
            this.$l.tileNear = pb.mul(
              pb.neg(this.sizeParam.z),
              pb.pow(pb.div(this.sizeParam.w, this.sizeParam.z), this.sliceNear)
            );
            this.$l.tileFar = pb.mul(
              pb.neg(this.sizeParam.z),
              pb.pow(pb.div(this.sizeParam.w, this.sizeParam.z), this.sliceFar)
            );
            this.$l.eyePos = pb.vec3(0);
            this.$l.minPointNear = this.lineIntersectionToZPlane(
              this.eyePos,
              this.minPoint_vS,
              this.tileNear
            );
            this.$l.minPointFar = this.lineIntersectionToZPlane(this.eyePos, this.minPoint_vS, this.tileFar);
            this.$l.maxPointNear = this.lineIntersectionToZPlane(
              this.eyePos,
              this.maxPoint_vS,
              this.tileNear
            );
            this.$l.maxPointFar = this.lineIntersectionToZPlane(this.eyePos, this.maxPoint_vS, this.tileFar);
            this.aabbMin = pb.min(
              pb.min(this.minPointNear, this.minPointFar),
              pb.min(this.maxPointNear, this.maxPointFar)
            );
            this.aabbMax = pb.max(
              pb.max(this.minPointNear, this.minPointFar),
              pb.max(this.maxPointNear, this.maxPointFar)
            );
          });
          this.$l.n = pb.int(0);
          if (webgl1) {
            this.$l.lightIndices = pb.float[8]();
            this.$for(pb.int('i'), 0, 8, function () {
              this.lightIndices.setAt(this.i, 0);
            });
            this.$for(pb.int('i'), 1, ShaderHelper.getMaxClusterLights() + 1, function () {
              this.$if(pb.equal(this.i, this.countParam.w), function () {
                this.$break();
              });
              this.$l.light = this[ShaderHelper.getLightBufferUniformName()].at(pb.mul(this.i, 4));
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
              this.$l.light = this[ShaderHelper.getLightBufferUniformName()].at(pb.mul(this.i, 4));
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
    })!;
    this._lightIndexProgram.name = '@ClusteredLight_Index';
    this._bindGroup = device.createBindGroup(this._lightIndexProgram.bindGroupLayouts[0]);
    this._lightBuffer?.dispose();
    const lightBufferType = this._lightIndexProgram.getBindingInfo(
      ShaderHelper.getLightBufferUniformName()!
    )!.type;
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
      { mipmapping: false }
    )!;
    this._lightIndexTexture.name = 'ClusterLightIndex';
    this._lightIndexFramebuffer?.dispose();
    this._lightIndexFramebuffer = device.createFrameBuffer([this._lightIndexTexture], null);
  }
  /**
   * Builds the per-cluster light lists for a camera.
   *
   * @param width - Width in device pixels of the target the lit pass will draw into.
   * @param height - Height in device pixels of that target.
   *
   * @remarks
   * The lit shader maps `fragCoord` to a tile with `width`/`height`, so they must be the
   * size of the target it actually renders to, not whatever viewport is current here.
   */
  calculateLightIndex(
    camera: Camera,
    renderQueue: RenderQueue,
    width: number,
    height: number,
    screenSpaceShadowMask = camera.screenSpaceShadowMask,
    preExposure = 1
  ) {
    const numLights = this.getVisibleLights(
      camera,
      renderQueue,
      this._lights,
      screenSpaceShadowMask,
      preExposure
    );
    const device = getDevice();
    if (!this._lightIndexTexture) {
      this.createLightIndexTexture(device);
    }
    if (!this._lightIndexProgram) {
      this.createProgram(device);
    }
    if (!this._lightIndexVertexLayout) {
      this.createVertexLayout(device, this._lightIndexTexture!.width, this._lightIndexTexture!.height);
    }
    if (!this._lightIndexRenderStates) {
      this.createRenderState(device);
    }
    const vw = width;
    const vh = height;
    const near = camera.getNearPlane();
    const far = camera.getFarPlane();
    // The lit shader computes slice = t * scale + bias, where t is log2(view depth) for
    // perspective (exponential slices) and the view depth itself for orthographic (linear
    // slices: an orthographic near plane may be zero or negative, where log2 is undefined).
    this._orthographic = !camera.isPerspective();
    let scale: number;
    let bias: number;
    if (this._orthographic) {
      scale = this._tileCountZ / (far - near);
      bias = -near * scale;
    } else {
      scale = this._tileCountZ / Math.log2(far / near);
      bias = -Math.log2(near) * scale;
    }
    this._clusterParam.setXYZW(vw, vh, scale, bias);
    this._sizeParam.setXYZW(vw, vh, near, far);
    this._countParam[0] = this._tileCountX;
    this._countParam[1] = this._tileCountY;
    this._countParam[2] = this._tileCountZ;
    // countParam.w stores light count + 1 because clustered indices start from 1.
    // Keep it valid even when there are no unshadowed punctual lights so clustered
    // shading math stays well-defined for emissive and environment lighting paths.
    this._countParam[3] = numLights + 1;
    device.pushDeviceStates();
    device.setFramebuffer(this._lightIndexFramebuffer);
    if (numLights > 0) {
      if (this._lightBuffer!.disposed) {
        this._lightBuffer!.reload();
      }
      this._lightBuffer!.bufferSubData(0, this._lights);
      this._bindGroup!.setValue('invProjMatrix', camera.getInvProjectionMatrix());
      this._bindGroup!.setValue('viewMatrix', camera.viewMatrix);
      this._bindGroup!.setValue('sizeParam', this._sizeParam);
      this._bindGroup!.setValue('countParam', this._countParam);
      this._bindGroup!.setValue('orthoProj', this._orthographic ? 1 : 0);
      this._bindGroup!.setBuffer(ShaderHelper.getLightBufferUniformName(), this._lightBuffer!);
      device.setProgram(this._lightIndexProgram);
      device.setVertexLayout(this._lightIndexVertexLayout);
      device.setBindGroup(0, this._bindGroup!);
      const savedRS = device.getRenderStates();
      device.setRenderStates(this._lightIndexRenderStates);
      device.draw('point-list', 0, this._tileCountX * this._tileCountY * this._tileCountZ);
      device.setRenderStates(savedRS);
    } else {
      device.clearFrameBuffer(new Vector4(0, 0, 0, 0), DEPTH_CLEAR_VALUE, 0);
    }
    device.popDeviceStates();
  }
  /**
   * Orders `lights` by estimated contribution at the camera, most important first.
   *
   * @remarks
   * Both caps drop lights by buffer index - the global one truncates the tail, and
   * a full cluster keeps its lowest 16 indices - so without this whichever lights the
   * scene traversal happened to reach last are the ones that vanish. The score is
   * `luminance * range^2 / (range^2 + d^2)`, with `d` the camera's distance to the
   * light's sphere of influence: 0 from anywhere inside it, falling off with distance
   * beyond it, and larger for lights that reach further. Directional lights have no
   * range and light everything, so they always rank first.
   */
  private prioritize(lights: PunctualLight[], eye: Vector3) {
    if (lights.length < 2) {
      return;
    }
    const candidates = lights.map((light) => {
      const posRange = light.positionAndRange;
      const range = posRange.w;
      let score: number;
      if (light.isDirectionLight() || range <= 0) {
        score = Infinity;
      } else {
        const color = light.diffuseAndIntensity;
        const dx = posRange.x - eye.x;
        const dy = posRange.y - eye.y;
        const dz = posRange.z - eye.z;
        const d = Math.max(Math.sqrt(dx * dx + dy * dy + dz * dz) - range, 0);
        const range2 = range * range;
        score = (Math.max(color.x, color.y, color.z) * color.w * range2) / (range2 + d * d);
      }
      return { light, score };
    });
    // Stable, so equally important lights keep their traversal order frame to frame.
    // Compared rather than subtracted: two directional lights would give Infinity - Infinity.
    candidates.sort((a, b) => (a.score > b.score ? -1 : a.score < b.score ? 1 : 0));
    for (let i = 0; i < lights.length; i++) {
      lights[i] = candidates[i].light;
    }
  }
  private getVisibleLights(
    camera: Camera,
    renderQueue: RenderQueue,
    lights: Float32Array,
    useShadowMask: boolean,
    preExposure: number
  ) {
    const writeLight = (light: PunctualLight, slot: number) => {
      const offset = slot * 16;
      const colorIntensity = light.diffuseAndIntensity;
      lights.set(light.positionAndRange, offset);
      lights.set(light.directionAndCutoff, offset + 4);
      // Only the intensity carries the camera pre-exposure; the color stays as authored. The
      // light's own cached vector must not be mutated because it is shared across cameras.
      lights[offset + 8] = colorIntensity.x;
      lights[offset + 9] = colorIntensity.y;
      lights[offset + 10] = colorIntensity.z;
      lights[offset + 11] = colorIntensity.w * preExposure;
      lights.set(light.extraParams, offset + 12);
    };
    // When the screen-space shadow mask is active, shadow-casting lights occupy
    // the head of the buffer (slots 1..N) in the exact order of
    // renderQueue.shadowedLights. The mask pass must assign layers/channels from
    // the SAME list in the SAME order so that a light's buffer index maps to its
    // mask slot without storing a per-light index. Keep these two in lockstep.
    let numShadow = 0;
    let slot = 0;
    if (useShadowMask) {
      numShadow = Math.min(
        renderQueue.shadowedLights.length,
        MAX_SHADOW_MASK_LIGHTS,
        ShaderHelper.getMaxClusterLights()
      );
      for (let i = 1; i <= numShadow; i++) {
        writeLight(renderQueue.shadowedLights[i - 1], i);
      }
      slot = numShadow;
    }
    // Everything without a mask slot fills the region after the mask-backed shadow
    // lights: the unshadowed lights, plus shadow-casting lights beyond the mask
    // capacity (MAX_SHADOW_MASK_LIGHTS). Rather than dropping the latter silently they
    // are still lit here - without a mask sample, i.e. degraded to no shadow. Both
    // compete for the remaining slots on equal terms, most important first.
    const rest = this._rest;
    rest.length = 0;
    for (const light of renderQueue.unshadowedLights) {
      rest.push(light);
    }
    const overflow = useShadowMask ? renderQueue.shadowedLights.length - numShadow : 0;
    for (let k = 0; k < overflow; k++) {
      rest.push(renderQueue.shadowedLights[numShadow + k]);
    }
    this.prioritize(rest, camera.getWorldPosition());
    const numRest = Math.min(rest.length, ShaderHelper.getMaxClusterLights() - slot);
    for (let j = 0; j < numRest; j++) {
      writeLight(rest[j], slot + j + 1);
    }
    slot += numRest;
    if (overflow > 0 && !ClusteredLight._warnedShadowMaskOverflow) {
      ClusteredLight._warnedShadowMaskOverflow = true;
      const dropped = rest.length - numRest;
      console.warn(
        `ClusteredLight: ${renderQueue.shadowedLights.length} shadow-casting lights exceed the ` +
          `screen-space shadow mask capacity (${MAX_SHADOW_MASK_LIGHTS}); ${overflow} light(s) are ` +
          `lit without shadows${dropped > 0 ? `, and the ${dropped} least important light(s) dropped` : ''}.`
      );
    }
    rest.length = 0;
    this._numShadowLights = numShadow;
    return slot;
  }
}
