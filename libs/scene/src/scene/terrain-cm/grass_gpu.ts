import type {
  BindGroup,
  GPUDataBuffer,
  GPUProgram,
  IndexBuffer,
  PBInsideFunctionScope,
  StructuredBuffer,
  Texture2D
} from '@zephyr3d/device';
import type { Nullable } from '@zephyr3d/base';
import { Disposable, DRef, nextPowerOf2, Vector3, Vector4 } from '@zephyr3d/base';
import type { Camera } from '../../camera';
import { Primitive } from '../../render';
import { getDevice } from '../../app/api';
import { fetchSampler } from '../../utility/misc';
import type { ClipmapTerrain } from './terrain-cm';

const WORKGROUP_SIZE = 8;
/**
 * Largest placement window side, in cells. Bounds the per-frame work and the instance buffer
 * when the draw distance is unlimited or the cells are tiny.
 */
const MAX_WINDOW_CELLS = 2048;

/**
 * Grass blade placement hash, shared by the CPU and GPU paths.
 *
 * Returns a value in [0, 1) with 24 bits of precision: that is all a float32 can hold, so
 * keeping the CPU side to the same bits makes both paths place exactly the same blades.
 *
 * @internal
 */
export function grassHash(x: number, z: number, seed: number): number {
  let h = (Math.imul(x, 0x27d4eb2d) ^ Math.imul(z, 0x165667b1) ^ Math.imul(seed, 0x9e3779b9)) | 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 8) / 16777216;
}

/**
 * GPU placement and culling of the blades of one grass layer (WebGPU with indirect draw only).
 *
 * Blade placement is procedural - a hash per placement cell and a bilinear density lookup - so
 * instead of keeping instances for the whole terrain, a compute pass evaluates the cells around
 * the camera every frame, keeps the blades inside the frustum and the draw distance, and appends
 * them to an instance buffer whose count lands in an indirect draw argument buffer.
 *
 * The output uses the instance format of the CPU path (u, v, sin, cos), so the grass material
 * is shared. Each dispatched thread emits at most one blade and the instance buffer holds one
 * per thread, so the output can never overflow.
 *
 * @internal
 */
export class GrassGpuPlacement extends Disposable {
  private static _program: Nullable<GPUProgram> = null;
  private static readonly _cameraPos = new Vector3();
  private static readonly _planes = new Float32Array(24);
  private readonly _densityTexture: DRef<Texture2D>;
  private readonly _instanceBuffer: DRef<StructuredBuffer>;
  private readonly _argsBuffer: DRef<GPUDataBuffer>;
  private readonly _bindGroup: DRef<BindGroup>;
  private readonly _primitive: DRef<Primitive>;
  private readonly _baseVertexBuffer: DRef<StructuredBuffer>;
  private readonly _indexBuffer: DRef<IndexBuffer>;
  private readonly _args: Uint32Array<ArrayBuffer>;
  private readonly _window: Vector4;
  private readonly _cells: Vector4;
  private readonly _params: Vector4;
  private readonly _posScale: Vector4;
  private readonly _camera: Vector4;
  private _capacity: number;
  /**
   * Whether the current device can run the GPU path
   */
  static isSupported() {
    const device = getDevice();
    return device.type === 'webgpu' && device.getDeviceCaps().miscCaps.supportDrawIndirect;
  }
  constructor(baseVertexBuffer: StructuredBuffer, indexBuffer: IndexBuffer) {
    super();
    this._densityTexture = new DRef();
    this._instanceBuffer = new DRef();
    this._argsBuffer = new DRef(getDevice().createBuffer(5 * 4, { usage: 'indirect', storage: true }));
    this._bindGroup = new DRef();
    this._primitive = new DRef();
    this._baseVertexBuffer = new DRef(baseVertexBuffer);
    this._indexBuffer = new DRef(indexBuffer);
    this._args = new Uint32Array(5);
    this._window = new Vector4();
    this._cells = new Vector4();
    this._params = new Vector4();
    this._posScale = new Vector4();
    this._camera = new Vector4();
    this._capacity = 0;
  }
  setBaseVertexBuffer(baseVertexBuffer: StructuredBuffer) {
    if (baseVertexBuffer !== this._baseVertexBuffer.get()) {
      this._baseVertexBuffer.set(baseVertexBuffer);
      this._primitive.dispose();
    }
  }
  /**
   * Uploads the whole density map, recreating the texture when its size changed
   * @param width - Density map width in texels
   * @param height - Density map height in texels
   * @param data - Density data, one byte per texel
   */
  setDensity(width: number, height: number, data: Uint8Array) {
    let tex = this._densityTexture.get();
    if (!tex || tex.width !== width || tex.height !== height) {
      tex = getDevice().createTexture2D('r8unorm', width, height, { mipmapping: false })!;
      tex.name = 'GrassDensity';
      this._densityTexture.set(tex);
      this._bindGroup.dispose();
    }
    // Texture uploads take views of plain array buffers only
    const bytes =
      data.buffer instanceof ArrayBuffer ? (data as Uint8Array<ArrayBuffer>) : new Uint8Array(data);
    tex.update(bytes, 0, 0, width, height);
  }
  /**
   * Uploads a rectangle of the density map
   * @param data - The whole density map, one byte per texel
   * @param width - Density map width in texels
   * @param x0 - Minimum x texel (inclusive)
   * @param z0 - Minimum z texel (inclusive)
   * @param x1 - Maximum x texel (exclusive)
   * @param z1 - Maximum z texel (exclusive)
   */
  updateDensityRegion(data: Uint8Array, width: number, x0: number, z0: number, x1: number, z1: number) {
    const tex = this._densityTexture.get();
    if (!tex || x1 <= x0 || z1 <= z0) {
      return;
    }
    const w = x1 - x0;
    const h = z1 - z0;
    const rect = new Uint8Array(w * h);
    for (let z = 0; z < h; z++) {
      rect.set(data.subarray((z0 + z) * width + x0, (z0 + z) * width + x1), z * w);
    }
    tex.update(rect, x0, z0, w, h);
  }
  /**
   * Places and culls the blades seen from a camera. Runs a compute pass, so it must be called
   * outside of render passes, before the draws that consume the result.
   */
  generate(
    camera: Camera,
    terrain: ClipmapTerrain,
    seed: number,
    cellsPerTexel: number,
    drawDistance: number,
    bladeWidth: number,
    bladeHeight: number
  ) {
    const density = this._densityTexture.get();
    const heightMap = terrain.heightMap;
    const indexCount = this._indexBuffer.get()?.length ?? 0;
    this._args.set([indexCount, 0, 0, 0, 0]);
    this._argsBuffer.get()!.bufferSubData(0, this._args);
    if (!density || !heightMap) {
      return;
    }
    const region = terrain.worldRegion;
    const cellsW = density.width * cellsPerTexel;
    const cellsH = density.height * cellsPerTexel;
    const cellSizeX = (region.z - region.x) / cellsW;
    const cellSizeZ = (region.w - region.y) / cellsH;
    const cameraPos = camera.getWorldPosition(GrassGpuPlacement._cameraPos);
    // Window of cells within the draw distance around the camera
    const centerX = (cameraPos.x - region.x) / cellSizeX;
    const centerZ = (cameraPos.z - region.y) / cellSizeZ;
    const radiusX = drawDistance > 0 ? drawDistance / cellSizeX : Infinity;
    const radiusZ = drawDistance > 0 ? drawDistance / cellSizeZ : Infinity;
    const halfMax = MAX_WINDOW_CELLS / 2;
    const x0 = Math.max(0, Math.floor(centerX - Math.min(radiusX, halfMax)));
    const x1 = Math.min(cellsW, Math.ceil(centerX + Math.min(radiusX, halfMax)));
    const z0 = Math.max(0, Math.floor(centerZ - Math.min(radiusZ, halfMax)));
    const z1 = Math.min(cellsH, Math.ceil(centerZ + Math.min(radiusZ, halfMax)));
    const windowW = x1 - x0;
    const windowH = z1 - z0;
    if (windowW <= 0 || windowH <= 0) {
      return;
    }
    this.ensureCapacity(windowW * windowH);
    const bindGroup = this.getBindGroup();
    this._window.setXYZW(x0, z0, windowW, windowH);
    this._cells.setXYZW(cellsW, cellsH, density.width, density.height);
    // Bounding sphere of a blade, centred halfway up
    const radius = Math.sqrt(bladeWidth * bladeWidth * 0.25 + bladeHeight * bladeHeight * 0.25);
    this._params.setXYZW(seed * 4, drawDistance, radius, bladeHeight * 0.5);
    this._posScale.setXYZW(terrain.scale.x, terrain.scale.y, terrain.scale.z, terrain.worldMatrix.m13);
    this._camera.setXYZW(cameraPos.x, cameraPos.y, cameraPos.z, 0);
    // Planes masked out by the camera become ones everything is inside of
    const planes = GrassGpuPlacement._planes;
    const frustumPlanes = camera.frustum.planes;
    const mask = camera.clipMask || 0x3f;
    for (let i = 0; i < 6; i++) {
      const p = frustumPlanes[i];
      const enabled = !!(mask & (1 << i));
      planes[i * 4 + 0] = enabled ? p.a : 0;
      planes[i * 4 + 1] = enabled ? p.b : 0;
      planes[i * 4 + 2] = enabled ? p.c : 0;
      planes[i * 4 + 3] = enabled ? p.d : 1e30;
    }
    bindGroup.setValue('window', this._window);
    bindGroup.setValue('cells', this._cells);
    bindGroup.setValue('params', this._params);
    bindGroup.setValue('region', region);
    bindGroup.setValue('posScale', this._posScale);
    bindGroup.setValue('cameraPos', this._camera);
    bindGroup.setValue('planes', planes);
    bindGroup.setTexture('density', density);
    bindGroup.setTexture('heightMap', heightMap, fetchSampler('clamp_linear_nomip'));
    const device = getDevice();
    device.setProgram(GrassGpuPlacement.getProgram());
    device.setBindGroup(0, bindGroup);
    device.compute(Math.ceil(windowW / WORKGROUP_SIZE), Math.ceil(windowH / WORKGROUP_SIZE), 1);
  }
  /** Draws the blades of the last generate() call; the material must be bound */
  draw() {
    let primitive = this._primitive.get();
    if (!primitive) {
      const instanceBuffer = this._instanceBuffer.get();
      if (!instanceBuffer) {
        return;
      }
      primitive = new Primitive();
      primitive.setVertexBuffer(this._baseVertexBuffer.get()!);
      primitive.setVertexBuffer(instanceBuffer, 'instance');
      primitive.setIndexBuffer(this._indexBuffer.get());
      primitive.primitiveType = 'triangle-list';
      primitive.indexStart = 0;
      primitive.indexCount = this._indexBuffer.get()!.length;
      this._primitive.set(primitive);
    }
    primitive.drawIndirect(this._argsBuffer.get()!, 0);
  }
  private ensureCapacity(numInstances: number) {
    if (numInstances > this._capacity) {
      this._capacity = nextPowerOf2(numInstances);
      const buffer = getDevice().createVertexBuffer('tex1_f32x4', new Float32Array(this._capacity * 4), {
        storage: true
      })!;
      this._instanceBuffer.set(buffer);
      this._primitive.dispose();
      this._bindGroup.dispose();
    }
  }
  private getBindGroup() {
    let bindGroup = this._bindGroup.get();
    if (!bindGroup) {
      bindGroup = getDevice().createBindGroup(GrassGpuPlacement.getProgram().bindGroupLayouts[0]);
      bindGroup.setBuffer('instances', this._instanceBuffer.get()!);
      bindGroup.setBuffer('args', this._argsBuffer.get()!);
      this._bindGroup.set(bindGroup);
    }
    return bindGroup;
  }
  private static getProgram() {
    if (!this._program) {
      this._program = getDevice().buildComputeProgram({
        label: 'GrassPlacement',
        workgroupSize: [WORKGROUP_SIZE, WORKGROUP_SIZE, 1],
        compute(pb) {
          // (first cell x, first cell z, cells wide, cells high)
          this.window = pb.vec4().uniform(0);
          // (cells x, cells z, density width, density height)
          this.cells = pb.vec4().uniform(0);
          // (seed, draw distance, blade bounding radius, blade centre height)
          this.params = pb.vec4().uniform(0);
          this.region = pb.vec4().uniform(0);
          // (terrain scale xyz, terrain origin y)
          this.posScale = pb.vec4().uniform(0);
          this.cameraPos = pb.vec4().uniform(0);
          this.planes = pb.vec4[6]().uniform(0);
          this.density = pb.tex2D().uniform(0);
          this.heightMap = pb.tex2D().uniform(0);
          this.instances = pb.vec4[0]().storageBuffer(0);
          this.args = pb.atomic_uint[0]().storageBuffer(0);
          // See grassHash(); unsigned integer arithmetic wraps like Math.imul
          pb.func('grassHash', [pb.uint('x'), pb.uint('z'), pb.uint('s')], function () {
            this.$l.h = pb.compXor(
              pb.compXor(pb.mul(this.x, pb.uint(0x27d4eb2d)), pb.mul(this.z, pb.uint(0x165667b1))),
              pb.mul(this.s, pb.uint(0x9e3779b9))
            );
            this.h = pb.mul(pb.compXor(this.h, pb.sar(this.h, 15)), pb.uint(0x85ebca6b));
            this.h = pb.mul(pb.compXor(this.h, pb.sar(this.h, 13)), pb.uint(0xc2b2ae35));
            this.h = pb.compXor(this.h, pb.sar(this.h, 16));
            this.$return(pb.mul(pb.float(pb.sar(this.h, 8)), 1 / 16777216));
          });
          // Bilinear density, the same filtering as GrassLayer.sampleDensity()
          pb.func('sampleDensity', [pb.vec2('uv')], function () {
            this.$l.size = this.cells.zw;
            this.$l.p = pb.sub(pb.mul(this.uv, this.size), pb.vec2(0.5));
            this.$l.i = pb.floor(this.p);
            this.$l.f = pb.sub(this.p, this.i);
            this.$l.maxIndex = pb.sub(this.size, pb.vec2(1));
            this.$l.i0 = pb.ivec2(pb.clamp(this.i, pb.vec2(0), this.maxIndex));
            this.$l.i1 = pb.ivec2(pb.clamp(pb.add(this.i, pb.vec2(1)), pb.vec2(0), this.maxIndex));
            const texel = (scope: PBInsideFunctionScope, x: string, z: string) =>
              pb.textureLoad(scope.density, pb.ivec2(scope[x].x, scope[z].y), 0).r;
            this.$l.a = pb.mix(texel(this, 'i0', 'i0'), texel(this, 'i1', 'i0'), this.f.x);
            this.$l.b = pb.mix(texel(this, 'i0', 'i1'), texel(this, 'i1', 'i1'), this.f.x);
            this.$return(pb.mix(this.a, this.b, this.f.y));
          });
          pb.main(function () {
            this.$l.id = this.$builtins.globalInvocationId.xy;
            this.$if(
              pb.and(
                pb.lessThan(this.id.x, pb.uint(this.window.z)),
                pb.lessThan(this.id.y, pb.uint(this.window.w))
              ),
              function () {
                this.$l.cx = pb.add(pb.uint(this.window.x), this.id.x);
                this.$l.cz = pb.add(pb.uint(this.window.y), this.id.y);
                this.$l.seed = pb.uint(this.params.x);
                this.$l.uv = pb.div(
                  pb.add(
                    pb.vec2(pb.float(this.cx), pb.float(this.cz)),
                    pb.vec2(
                      this.grassHash(this.cx, this.cz, this.seed),
                      this.grassHash(this.cx, this.cz, pb.add(this.seed, 1))
                    )
                  ),
                  this.cells.xy
                );
                this.$if(
                  pb.greaterThan(
                    this.sampleDensity(this.uv),
                    this.grassHash(this.cx, this.cz, pb.add(this.seed, 2))
                  ),
                  function () {
                    this.$l.xz = pb.add(
                      this.region.xy,
                      pb.mul(this.uv, pb.sub(this.region.zw, this.region.xy))
                    );
                    this.$l.height = pb.add(
                      pb.mul(pb.textureSampleLevel(this.heightMap, this.uv, 0).r, this.posScale.y),
                      this.posScale.w
                    );
                    this.$l.base = pb.vec3(this.xz.x, this.height, this.xz.y);
                    this.$l.visible = pb.or(
                      pb.lessThanEqual(this.params.y, 0),
                      pb.lessThanEqual(pb.distance(this.base, this.cameraPos.xyz), this.params.y)
                    );
                    this.$l.center = pb.add(this.base, pb.vec3(0, this.params.w, 0));
                    for (let i = 0; i < 6; i++) {
                      this.visible = pb.and(
                        this.visible,
                        pb.greaterThanEqual(
                          pb.add(pb.dot(this.planes.at(i).xyz, this.center), this.planes.at(i).w),
                          pb.neg(this.params.z)
                        )
                      );
                    }
                    this.$if(this.visible, function () {
                      this.$l.angle = pb.mul(
                        this.grassHash(this.cx, this.cz, pb.add(this.seed, 3)),
                        Math.PI * 2
                      );
                      this.$l.slot = pb.atomicAdd(this.args.at(1), 1);
                      this.instances.setAt(
                        this.slot,
                        pb.vec4(this.uv, pb.sin(this.angle), pb.cos(this.angle))
                      );
                    });
                  }
                );
              }
            );
          });
        }
      })!;
    }
    return this._program;
  }
  protected onDispose() {
    super.onDispose();
    this._densityTexture.dispose();
    this._instanceBuffer.dispose();
    this._argsBuffer.dispose();
    this._bindGroup.dispose();
    this._primitive.dispose();
    this._baseVertexBuffer.dispose();
    this._indexBuffer.dispose();
  }
}
