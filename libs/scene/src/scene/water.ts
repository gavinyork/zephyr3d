import { Vector4 } from '@zephyr3d/base';
import type { Matrix4x4 } from '@zephyr3d/base';
import { applyMixins, Vector3, DRef } from '@zephyr3d/base';
import type { Scene } from './scene';
import { GraphNode } from './graph_node';
import { mixinDrawable } from '../render/drawable_mixin';
import type {
  Drawable,
  DrawContext,
  MorphData,
  MorphInfo,
  PickTarget,
  PrimitiveInstanceInfo,
  WaveGenerator
} from '../render';
import { Primitive } from '../render';
import { Clipmap, FBMWaveGenerator } from '../render';
import { WaterMaterial } from '../material/water';
import type { AbstractDevice, BindGroup, FrameBuffer, GPUProgram, RenderStateSet } from '@zephyr3d/device';
import { QUEUE_OPAQUE } from '../values';
import type { MeshMaterial } from '../material';
import type { BoundingVolume } from '../utility/bounding_volume';
import { BoundingBox } from '../utility/bounding_volume';
import type { Camera } from '../camera';
import { getDevice } from '../app/api';

/**
 * Water scene node
 * @public
 */
export class Water extends applyMixins(GraphNode, mixinDrawable) implements Drawable {
  private readonly _pickTarget: PickTarget;
  private _clipmap: Clipmap;
  private _renderData: PrimitiveInstanceInfo[];
  private _gridScale: number;
  private _animationSpeed: number;
  private _timeStart: number;
  private _feedbackProgram: DRef<GPUProgram>;
  private _feedbackBindGroup: DRef<BindGroup>;
  private _feedbackPrimitive: DRef<Primitive>;
  private _feedbackRenderTarget: DRef<FrameBuffer>;
  private _feedbackRenderStates: RenderStateSet;
  private readonly _material: DRef<WaterMaterial>;
  /**
   * Creates an instance of Water node
   * @param scene - Scene object
   */
  constructor(scene: Scene) {
    super(scene);
    this._pickTarget = { node: this };
    this._clipmap = new Clipmap(32, []);
    this._renderData = null;
    this._gridScale = 1;
    this._animationSpeed = 1;
    this._timeStart = 0;
    this._material = new DRef(new WaterMaterial());
    this._material.get().region = new Vector4(-1, -1, 1, 1);
    this._material.get().TAAStrength = 0.4;
    this.waveGenerator = new FBMWaveGenerator();
    this._feedbackProgram = new DRef();
    this._feedbackBindGroup = new DRef();
    this._feedbackPrimitive = new DRef();
    this._feedbackRenderTarget = new DRef();
    this._feedbackRenderStates = null;
    scene.queuePerCameraUpdateNode(this);
  }
  /** Disposes the water node */
  protected onDispose(): void {
    super.onDispose();
    this._clipmap.dispose();
    this._clipmap = null;
    this._renderData = null;
    this._feedbackBindGroup.dispose();
    this._feedbackPrimitive.dispose();
    this._feedbackProgram.dispose();
    this._feedbackRenderStates = null;
    if (this._feedbackRenderTarget.get()) {
      this._feedbackRenderTarget.get().getColorAttachment(0).dispose();
      this._feedbackRenderTarget.get().getColorAttachment(1).dispose();
      this._feedbackRenderTarget.dispose();
    }
    this._material.dispose();
  }
  /** Whether water should be drawn with lines */
  get wireframe() {
    return this._clipmap.wireframe;
  }
  set wireframe(val: boolean) {
    this._clipmap.wireframe = !!val;
  }
  /** Material of the water */
  get material(): WaterMaterial {
    return this._material.get();
  }
  /** Wave generator object of the water */
  get waveGenerator(): WaveGenerator {
    return this.material.waveGenerator;
  }
  set waveGenerator(waveGenerator: WaveGenerator) {
    this.material.waveGenerator = waveGenerator;
    if (this.material.needUpdate()) {
      this.scene.queueUpdateNode(this);
    }
  }
  /** Animation speed of the water */
  get animationSpeed() {
    return this._animationSpeed;
  }
  set animationSpeed(val: number) {
    this._animationSpeed = val;
  }
  /** TAA strength of the water */
  get TAAStrength() {
    return this.material.TAAStrength;
  }
  set TAAStrength(val: number) {
    this.material.TAAStrength = val;
  }
  /** {@inheritDoc SceneNode.update} */
  update(frameId: number, elapsedInSeconds: number) {
    if (this.material.needUpdate()) {
      this.scene.queueUpdateNode(this);
      if (this._timeStart === 0) {
        this._timeStart = elapsedInSeconds;
      }
      this.material.update(frameId, (elapsedInSeconds - this._timeStart) * this._animationSpeed);
      this.invalidateWorldBoundingVolume(false);
    }
  }
  /** {@inheritDoc SceneNode.updatePerCamera} */
  updatePerCamera(camera: Camera, _elapsedInSeconds: number, _deltaInSeconds: number): void {
    const mat = this._material.get();
    const that = this;
    this._renderData = this._clipmap.gather({
      camera,
      minMaxWorldPos: mat.region,
      gridScale: Math.max(0.01, this._gridScale),
      userData: this,
      frustumCulling: true,
      calcAABB(userData: unknown, minX, maxX, minZ, maxZ, outAABB) {
        const p = that.worldMatrix.transformPointAffine(Vector3.zero());
        if (that.waveGenerator) {
          that.waveGenerator.calcClipmapTileAABB(minX, maxX, minZ, maxZ, p.y, outAABB);
        } else {
          outAABB.minPoint.setXYZ(minX, p.y, minZ);
          outAABB.maxPoint.setXYZ(maxX, p.y + 1, maxZ);
        }
      }
    });
    this.scene.queuePerCameraUpdateNode(this);
  }
  /**
   * {@inheritDoc Drawable.getPickTarget }
   */
  getPickTarget(): PickTarget {
    return this._pickTarget;
  }
  /**
   * {@inheritDoc Drawable.getMorphData}
   */
  getMorphData(): MorphData {
    return null;
  }
  /**
   * {@inheritDoc Drawable.getMorphInfo}
   */
  getMorphInfo(): MorphInfo {
    return null;
  }
  /**
   * {@inheritDoc Drawable.getQueueType}
   */
  getQueueType(): number {
    return this._material.get()?.getQueueType() ?? QUEUE_OPAQUE;
  }
  /**
   * {@inheritDoc Drawable.isUnlit}
   */
  isUnlit(): boolean {
    return !this._material.get()?.supportLighting();
  }
  /**
   * {@inheritDoc Drawable.needSceneColor}
   */
  needSceneColor(): boolean {
    return this._material.get()?.needSceneColor();
  }
  /**
   * {@inheritDoc Drawable.needSceneDepth}
   */
  needSceneDepth(): boolean {
    return this._material.get()?.needSceneDepth();
  }
  /**
   * {@inheritDoc Drawable.getMaterial}
   */
  getMaterial(): MeshMaterial {
    return this._material.get();
  }
  /**
   * {@inheritDoc Drawable.getPrimitive}
   */
  getPrimitive(): Primitive {
    return null;
  }
  /**
   * {@inheritDoc SceneNode.isWater}
   */
  isWater(): this is Water {
    return true;
  }
  /**
   * {@inheritDoc SceneNode.computeBoundingVolume}
   */
  computeBoundingVolume(): BoundingVolume {
    return null;
  }
  /**
   * {@inheritDoc SceneNode.computeWorldBoundingVolume}
   */
  computeWorldBoundingVolume(): BoundingVolume {
    const p = this.worldMatrix.transformPointAffine(Vector3.zero());
    const mat = this._material?.get();
    if (mat) {
      const boundingBox = new BoundingBox();
      if (mat.waveGenerator) {
        mat.waveGenerator.calcClipmapTileAABB(
          mat.region.x,
          mat.region.z,
          mat.region.y,
          mat.region.w,
          p.y,
          boundingBox
        );
      } else {
        boundingBox.minPoint.setXYZ(mat.region.x, p.y, mat.region.y);
        boundingBox.maxPoint.setXYZ(mat.region.z, p.y + 1, mat.region.w);
      }
      return boundingBox;
    }
    return null;
  }
  /**
   * Grid scale
   */
  get gridScale() {
    return this._gridScale;
  }
  set gridScale(val: number) {
    this._gridScale = val;
  }
  calculateLocalTransform(outMatrix: Matrix4x4): void {
    outMatrix.translation(this._position);
  }
  calculateWorldTransform(outMatrix: Matrix4x4): void {
    outMatrix.set(this.localMatrix);
    if (this.parent) {
      outMatrix.m03 += this.parent.worldMatrix.m03;
      outMatrix.m13 += this.parent.worldMatrix.m13;
      outMatrix.m23 += this.parent.worldMatrix.m23;
    }
  }
  protected _onTransformChanged(invalidateLocal: boolean): void {
    super._onTransformChanged(invalidateLocal);
    const material = this._material?.get();
    if (material) {
      const x = Math.abs(this.scale.x);
      const z = Math.abs(this.scale.z);
      const px = this.position.x;
      const pz = this.position.z;
      material.region = new Vector4(px - x, pz - z, px + x, pz + z);
    }
  }
  /**
   * {@inheritDoc Drawable.draw}
   */
  draw(ctx: DrawContext) {
    const mat = this._material?.get();
    this.bind(ctx);
    mat.setClipmapGridInfo(this._gridScale, this.worldMatrix.m03, this.worldMatrix.m23);
    mat.apply(ctx);
    for (const info of this._renderData) {
      mat.draw(info.primitive, ctx, info.numInstances);
    }
  }
  /**
   * Retreive the disturbed world position and normal at water surface
   */
  async getSurfacePoint(points: Vector3[], outPos?: Vector3[], outNorm?: Vector3[]) {
    const device = getDevice();
    if (!points || points.length === 0) {
      return;
    }
    points = points.map((v) => v.clone());
    await device.runNextFrameAsync(async () => {
      if (!this._feedbackProgram.get()) {
        this._feedbackProgram.set(this._createFeedbackProgram(device));
        this._feedbackBindGroup.set(device.createBindGroup(this._feedbackProgram.get().bindGroupLayouts[0]));
      }
      if (!this._feedbackPrimitive.get()) {
        this._feedbackPrimitive.set(new Primitive());
        this._feedbackPrimitive.get().primitiveType = 'point-list';
      }
      if (!this._feedbackRenderStates) {
        this._feedbackRenderStates = device.createRenderStateSet();
        this._feedbackRenderStates.useDepthState().enableTest(false).enableWrite(false);
        this._feedbackRenderStates.useRasterizerState().setCullMode('none');
      }
      const primitive = this._feedbackPrimitive.get();
      const vertices = new Float32Array(points.length * 4);
      for (let i = 0; i < points.length; i++) {
        vertices[i * 4 + 0] = points[i].x;
        vertices[i * 4 + 1] = points[i].y;
        vertices[i * 4 + 2] = points[i].z;
        vertices[i * 4 + 3] = i;
      }
      let vb = primitive.getVertexBuffer('position');
      if (!vb || vb.byteLength !== vertices.byteLength) {
        vb = device.createVertexBuffer('position_f32x4', vertices, { dynamic: true });
        primitive.setVertexBuffer(vb);
      } else {
        vb.bufferSubData(0, vertices);
      }
      const fb = this._feedbackRenderTarget.get();
      if (!fb || fb.getColorAttachment(0).width < points.length) {
        const rt0 = device.createTexture2D('rgba32f', points.length, 1, {
          mipmapping: false
        });
        const rt1 = device.createTexture2D('rgba32f', points.length, 1, {
          mipmapping: false
        });
        if (fb) {
          fb.getColorAttachment(0).dispose();
          fb.getColorAttachment(1).dispose();
          this._feedbackRenderTarget.dispose();
        }
        this._feedbackRenderTarget.set(device.createFrameBuffer([rt0, rt1], null));
      }
      primitive.indexCount = points.length;
      const bindGroup = this._feedbackBindGroup.get();
      bindGroup.setValue('textureWidth', this._feedbackRenderTarget.get().getWidth());
      this.waveGenerator.applyWaterBindGroup(bindGroup);
      device.pushDeviceStates();
      device.setProgram(this._feedbackProgram.get());
      device.setBindGroup(0, this._feedbackBindGroup.get());
      device.setFramebuffer(this._feedbackRenderTarget.get());
      this._feedbackPrimitive.get().draw();
      device.popDeviceStates();
      const pos = new Float32Array(points.length * 4);
      const norm = new Float32Array(points.length * 4);
      await Promise.all([
        this._feedbackRenderTarget.get().getColorAttachment(0).readPixels(0, 0, points.length, 1, 0, 0, pos),
        this._feedbackRenderTarget.get().getColorAttachment(1).readPixels(0, 0, points.length, 1, 0, 0, norm)
      ]);
      for (let i = 0; i < points.length; i++) {
        if (outPos) {
          outPos[i].setXYZ(pos[i * 4 + 0], pos[i * 4 + 1], pos[i * 4 + 2]);
        }
        if (outNorm) {
          outNorm[i].setXYZ(norm[i * 4 + 0], norm[i * 4 + 1], norm[i * 4 + 2]);
        }
      }
    });
  }
  /** @internal */
  private _createFeedbackProgram(device: AbstractDevice) {
    const that = this;
    const program = device.buildRenderProgram({
      vertex(pb) {
        this.$inputs.position = pb.vec4().attrib('position');
        this.textureWidth = pb.float().uniform(0);
        that.waveGenerator.setupUniforms(this, 0);
        pb.main(function () {
          this.$l.worldPos = pb.vec3();
          this.$l.worldNorm = pb.vec3();
          that.waveGenerator.calcVertexPositionAndNormal(
            this,
            this.$inputs.position.xyz,
            this.worldPos,
            this.worldNorm
          );
          this.$outputs.worldPos = this.worldPos;
          this.$outputs.worldNorm = this.worldNorm;
          this.$outputs.xz = this.$inputs.position.xz;
          this.$l.ndcX = pb.sub(
            pb.mul(pb.div(pb.add(this.$inputs.position.w, 0.5), this.textureWidth), 2),
            1
          );
          if (pb.getDevice().type !== 'webgpu') {
            this.$builtins.pointSize = 1;
          }
          this.$l.$builtins.position = pb.vec4(this.ndcX, 0, 0, 1);
        });
      },
      fragment(pb) {
        this.$outputs.worldPos = pb.vec4();
        this.$outputs.worldNorm = pb.vec4();
        that.waveGenerator.setupUniforms(this, 0);
        pb.main(function () {
          this.$outputs.worldPos = pb.vec4(this.$inputs.worldPos, 1);
          this.$outputs.worldNorm = pb.vec4(
            that.waveGenerator.calcFragmentNormal(this, this.$inputs.xz, this.$inputs.worldNorm),
            1
          );
        });
      }
    });
    program.name = '@Water_Feedback';
    return program;
  }
}
