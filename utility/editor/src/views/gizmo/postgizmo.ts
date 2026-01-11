import type {
  BindGroup,
  GPUProgram,
  PBInsideFunctionScope,
  PBShaderExp,
  RenderStateSet,
  Texture2D
} from '@zephyr3d/device';
import type { Camera, DrawContext, PickResult, Primitive, SceneNode } from '@zephyr3d/scene';
import { BoxShape, getDevice, Mesh, UnlitMaterial } from '@zephyr3d/scene';
import { AbstractPostEffect, CopyBlitter, fetchSampler, PlaneShape } from '@zephyr3d/scene';
import {
  createTranslationGizmo,
  createRotationGizmo,
  createScaleGizmo,
  createSelectGizmo,
  axisList
} from './gizmo';
import type { Nullable, Ray } from '@zephyr3d/base';
import { DRef } from '@zephyr3d/base';
import { AABB, makeObservable } from '@zephyr3d/base';
import { Matrix4x4, Quaternion, Vector2, Vector3, Vector4 } from '@zephyr3d/base';
import { calcHierarchyBoundingBox } from '../../helpers/misc';

const tmpVecT = new Vector3();
const tmpVecS = new Vector3();
const tmpQuatR = new Quaternion();

const discRadius = 1.05 / Math.sqrt(Math.PI);
const gridLineSmoothStart = 0.5 + discRadius;
const gridLineSmoothEnd = 0.5 - discRadius;

export type HitType =
  | 'move_axis'
  | 'move_plane'
  | 'move_free'
  | 'rotate_axis'
  | 'rotate_free'
  | 'scale_axis'
  | 'scale_uniform';
export type GizmoMode = 'none' | 'translation' | 'rotation' | 'scaling' | 'select';
export type GizmoHitInfo = {
  axis: number;
  type?: Nullable<HitType>;
  coord: number;
  distance: number;
  pointWorld: Nullable<Vector3>;
  pointLocal: Nullable<Vector3>;
};

type TranslatePlaneInfo = {
  axis: number;
  planeAxis: number;
  lastPlanePos: Vector3;
  type: HitType;
};

type RotateInfo = {
  centerX: number;
  centerY: number;
  startX: number;
  startY: number;
  startPosition: Vector3;
  startRotation: Quaternion;
  axis: number;
  speed: number;
};

type ScaleInfo = {
  axis: number;
  startY: number;
  planeAxis: number;
  lastPlanePos: Vector3;
  type: HitType;
  scale: Vector3;
};

/**
 * The post water effect
 * @public
 */
export class PostGizmoRenderer extends makeObservable(AbstractPostEffect)<{
  begin_translate: [node: SceneNode];
  end_translate: [node: SceneNode];
  begin_rotate: [node: SceneNode];
  end_rotate: [node: SceneNode];
  begin_scale: [node: SceneNode];
  end_scale: [node: SceneNode];
  aabb_changed: [aabb: AABB];
}>() {
  static _aabbMesh: DRef<Mesh> = new DRef();
  static _blendBlitter: CopyBlitter = new CopyBlitter();
  static _gizmoProgram: Nullable<GPUProgram> = null;
  static _gizmoSelectProgram: Nullable<GPUProgram> = null;
  static _gridProgram: Nullable<GPUProgram> = null;
  static _gizmoRenderState: Nullable<RenderStateSet> = null;
  static _gridRenderState: Nullable<RenderStateSet> = null;
  static _blendRenderState: Nullable<RenderStateSet> = null;
  static _gridPrimitive: Nullable<Primitive> = null;
  static _bindGroup: Nullable<BindGroup> = null;
  static _gridBindGroup: Nullable<BindGroup> = null;
  static _rotation: Nullable<Primitive> = null;
  static _mvpMatrix: Matrix4x4 = new Matrix4x4();
  static _texSize: Vector2 = new Vector2();
  static _cameraNearFar: Vector2 = new Vector2();
  static _axises = [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)];
  static _primitives: Nullable<Partial<Record<GizmoMode, Primitive>>> = null;
  private _allowTranslate: boolean;
  private _allowRotate: boolean;
  private _allowScale: boolean;
  private _alwaysDrawIndicator: boolean;
  private _gridSteps: Float32Array<ArrayBuffer>;
  private readonly _gridParams: Vector4;
  private _camera: Camera;
  private _node: Nullable<SceneNode>;
  private _mode: GizmoMode;
  private readonly _axisLength: number;
  private readonly _arrowLength: number;
  private readonly _axisRadius: number;
  private readonly _arrowRadius: number;
  private readonly _boxSize: number;
  private _translatePlaneInfo: Nullable<TranslatePlaneInfo>;
  private _rotateInfo: Nullable<RotateInfo>;
  private _scaleInfo: Nullable<ScaleInfo>;
  private _hitInfo: Nullable<GizmoHitInfo>;
  private readonly _screenSize: number;
  private _drawGrid: boolean;
  private readonly _scaleBox: AABB;
  private readonly _nodeBox: AABB;
  /**
   * Creates an instance of PostGizmoRenderer.
   */
  constructor(camera: Camera, binding = null, size = 15) {
    super();
    this._camera = camera;
    this._node = binding;
    this._allowRotate = true;
    this._allowScale = true;
    this._allowTranslate = true;
    this._alwaysDrawIndicator = false;
    this._axisLength = size;
    this._arrowLength = size * 0.8;
    this._axisRadius = size * 0.02;
    this._arrowRadius = size * 0.06;
    this._boxSize = size * 0.1;
    this._mode = 'none';
    this._translatePlaneInfo = null;
    this._rotateInfo = null;
    this._scaleInfo = null;
    this._hitInfo = null;
    this._screenSize = 0.6;
    this._gridParams = new Vector4(10000, 500, 0, 0);
    this._gridSteps = new Float32Array([
      1, 1, 0, 0, 10, 10, 0, 0, 100, 100, 0, 0, 1000, 1000, 0, 0, 1000, 1000, 0, 0, 1000, 1000, 0, 0, 1000,
      1000, 0, 0, 1000, 1000, 0, 0
    ]);
    this._drawGrid = true;
    this._scaleBox = new AABB(
      new Vector3(-this._boxSize, -this._boxSize, -this._boxSize),
      new Vector3(this._boxSize, this._boxSize, this._boxSize)
    );
    this._nodeBox = new AABB();
  }
  get allowRotate() {
    return this._allowRotate;
  }
  set allowRotate(val: boolean) {
    this._allowRotate = val;
    if (!this._allowRotate && this._mode === 'rotation') {
      this.mode = 'select';
    }
  }
  get allowTranslate() {
    return this._allowTranslate;
  }
  set allowTranslate(val: boolean) {
    this._allowTranslate = val;
    if (!this._allowTranslate && this._mode === 'translation') {
      this.mode = 'select';
    }
  }
  get allowScale() {
    return this._allowScale;
  }
  set allowScale(val: boolean) {
    this._allowScale = val;
    if (!this._allowScale && this._mode === 'scaling') {
      this.mode = 'select';
    }
  }
  get mode(): GizmoMode {
    return this._mode;
  }
  set mode(val: GizmoMode) {
    if (
      (val === 'rotation' && !this._allowRotate) ||
      (val === 'translation' && !this._allowTranslate) ||
      (val === 'scaling' && !this._allowScale)
    ) {
      return;
    }
    if (this._mode !== val) {
      if (this._mode === 'translation') {
        this._endTranslation();
      } else if (this._mode === 'scaling') {
        this._endScale();
      } else if (this._mode === 'rotation') {
        this._endRotate();
      }
      this._mode = val;
    }
  }
  get node() {
    return this._node;
  }
  set node(node) {
    this._node = node;
    if (this._node !== PostGizmoRenderer._aabbMesh.get()) {
      this._alwaysDrawIndicator = false;
    }
  }
  get camera(): Camera {
    return this._camera;
  }
  set camera(camera: Camera) {
    this._camera = camera;
  }
  get drawGrid(): boolean {
    return this._drawGrid;
  }
  set drawGrid(val: boolean) {
    this._drawGrid = !!val;
  }
  get gridSize(): number {
    return this._gridParams.x;
  }
  set gridSize(val: number) {
    if (val !== this._gridParams.x) {
      this._gridParams.x = val;
      this.calcGridSteps(this._gridParams.x);
    }
  }
  get gridDistance(): number {
    return this._gridParams.y;
  }
  set gridDistance(val: number) {
    this._gridParams.y = val;
  }
  endEditAABB() {
    if (this._node === PostGizmoRenderer._aabbMesh.get()) {
      this.node = null;
    }
  }
  editAABB(value: AABB) {
    if (!PostGizmoRenderer._aabbMesh.get()) {
      PostGizmoRenderer._aabbMesh.set(
        new Mesh(this._camera.scene!, new BoxShape({ anchor: 0, size: 1 }), new UnlitMaterial())
      );
      PostGizmoRenderer._aabbMesh.get()!.sealed = true;
      PostGizmoRenderer._aabbMesh.get()!.showState = 'hidden';
      PostGizmoRenderer._aabbMesh.get()!.remove();
      PostGizmoRenderer._aabbMesh.get()!.on('transformchanged', () => {
        const aabb = PostGizmoRenderer._aabbMesh.get()!.getWorldBoundingVolume()!.toAABB();
        this.dispatchEvent('aabb_changed', aabb);
      });
    }
    const pos = value.minPoint.clone();
    const scale = Vector3.sub(value.maxPoint, value.minPoint);
    PostGizmoRenderer._aabbMesh.get()!.position.set(pos);
    PostGizmoRenderer._aabbMesh.get()!.scale.set(scale);
    this.node = PostGizmoRenderer._aabbMesh.get();
    this._alwaysDrawIndicator = true;
  }
  private calcGridSteps(size: number) {
    for (let i = 0, k = 1; i < 8; i++, k = Math.min(size, k * 10)) {
      this._gridSteps[i * 4] = k;
      this._gridSteps[i * 4 + 1] = k;
      this._gridSteps[i * 4 + 2] = 0;
      this._gridSteps[i * 4 + 3] = 0;
    }
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
    this.prepare();
    this.passThrough(ctx, inputColorTexture, srgbOutput);
    if (!this.enabled) {
      return;
    }
    const destFramebuffer = ctx.device.getFramebuffer();
    const tmpFramebuffer = ctx.device.pool.fetchTemporalFramebuffer(
      false,
      ctx.device.getDrawingBufferWidth(),
      ctx.device.getDrawingBufferHeight(),
      'rgba8unorm',
      ctx.device.getFramebuffer()!.getDepthAttachment()!.format,
      false
    );
    this._calcGizmoMVPMatrix(this._mode, false, PostGizmoRenderer._mvpMatrix);
    PostGizmoRenderer._texSize.setXY(inputColorTexture.width, inputColorTexture.height);
    PostGizmoRenderer._cameraNearFar.setXY(ctx.camera.getNearPlane(), ctx.camera.getFarPlane());
    ctx.device.pushDeviceStates();
    ctx.device.setFramebuffer(tmpFramebuffer);
    ctx.device.clearFrameBuffer(new Vector4(0, 0, 0, 0), 1, 0);
    if (this._drawGrid) {
      this._gridParams.z = ctx.camera.isPerspective() ? 1 : 0;
      ctx.device.setRenderStates(PostGizmoRenderer._gridRenderState);
      PostGizmoRenderer._gridBindGroup!.setValue('viewMatrixInv', ctx.camera.worldMatrix);
      PostGizmoRenderer._gridBindGroup!.setValue('cameraPos', ctx.camera.getWorldPosition());
      PostGizmoRenderer._gridBindGroup!.setValue('params', this._gridParams);
      PostGizmoRenderer._gridBindGroup!.setValue('steps', this._gridSteps);
      PostGizmoRenderer._gridBindGroup!.setValue('viewProjMatrix', ctx.camera.viewProjectionMatrix);
      PostGizmoRenderer._gridBindGroup!.setValue('texSize', PostGizmoRenderer._texSize);
      PostGizmoRenderer._gridBindGroup!.setValue('cameraNearFar', PostGizmoRenderer._cameraNearFar);
      PostGizmoRenderer._gridBindGroup!.setTexture(
        'depthTex',
        destFramebuffer!.getDepthAttachment()!,
        fetchSampler('clamp_nearest_nomip')
      );
      PostGizmoRenderer._gridBindGroup!.setValue('flip', this.needFlip(ctx.device) ? -1 : 1);
      ctx.device.setProgram(PostGizmoRenderer._gridProgram);
      ctx.device.setBindGroup(0, PostGizmoRenderer._gridBindGroup!);
      PostGizmoRenderer._gridPrimitive!.draw();
      if (ctx.camera.isOrtho()) {
        const projMatrix = ctx.camera.getProjectionMatrix();
        const vpMatrix = ctx.camera.viewProjectionMatrix;
        const cameraPos = ctx.camera.getWorldPosition();
        const left = projMatrix.getLeftPlane() + cameraPos.x;
        const right = projMatrix.getRightPlane() + cameraPos.x;
        const bottom = projMatrix.getBottomPlane() + cameraPos.y;
        const top = projMatrix.getTopPlane() + cameraPos.y;
        let sizeX = Math.pow(10, Math.max(0, Math.round(Math.log10(Math.abs(right - left))) - 1));
        const startX = Math.round(left / sizeX) * sizeX;
        const stopX = Math.round(right / sizeX) * sizeX;
        if (stopX < startX) {
          sizeX = -sizeX;
        }
        for (let x = startX; x !== stopX; x += sizeX) {
          const ndc = vpMatrix.transformPointH(new Vector3(x, top, 0));
          const screenX = (ndc.x * 0.5 + 0.5) * ctx.renderWidth + 5;
          const screenY = (0.5 - ndc.y * 0.5) * ctx.renderHeight + 5;
          ctx.device.drawText(String(x), screenX, screenY, '#888888');
        }
        let sizeY = Math.pow(10, Math.max(0, Math.round(Math.log10(Math.abs(top - bottom))) - 1));
        const startY = Math.round(bottom / sizeY) * sizeY;
        const stopY = Math.round(top / sizeY) * sizeY;
        if (stopY < startY) {
          sizeY = -sizeY;
        }
        for (let y = startY; y !== stopY; y += sizeY) {
          const ndc = vpMatrix.transformPointH(new Vector3(left, y, 0));
          const screenX = (ndc.x * 0.5 + 0.5) * ctx.renderWidth + 5;
          const screenY = (0.5 - ndc.y * 0.5) * ctx.renderHeight + 5;
          ctx.device.drawText(String(y), screenX, screenY, '#888888');
        }
      }
    }
    if (
      this._node &&
      this._mode !== 'none' &&
      !(this._mode === 'rotation' && this._rotateInfo && this._rotateInfo.axis < 0)
    ) {
      ctx.device.setRenderStates(PostGizmoRenderer._gizmoRenderState);
      PostGizmoRenderer._bindGroup!.setValue('mvpMatrix', PostGizmoRenderer._mvpMatrix);
      PostGizmoRenderer._bindGroup!.setValue('flip', this.needFlip(ctx.device) ? -1 : 1);
      PostGizmoRenderer._bindGroup!.setValue('texSize', PostGizmoRenderer._texSize);
      PostGizmoRenderer._bindGroup!.setValue('cameraNearFar', PostGizmoRenderer._cameraNearFar);
      PostGizmoRenderer._bindGroup!.setValue('time', (ctx.device.frameInfo.elapsedOverall % 1000) * 0.001);
      PostGizmoRenderer._bindGroup!.setTexture(
        'depthTex',
        destFramebuffer!.getDepthAttachment()!,
        fetchSampler('clamp_nearest_nomip')
      );
      if (!this._hitInfo) {
        PostGizmoRenderer._bindGroup!.setValue('axisMode', 0);
      } else if (
        this._hitInfo.type === 'move_axis' ||
        this._hitInfo.type === 'rotate_axis' ||
        this._hitInfo.type === 'scale_axis'
      ) {
        PostGizmoRenderer._bindGroup!.setValue('axisMode', axisList[this._hitInfo.axis]);
      } else if (this._hitInfo.type === 'move_plane') {
        PostGizmoRenderer._bindGroup!.setValue(
          'axisMode',
          axisList[0] + axisList[1] + axisList[2] - axisList[this._hitInfo.axis]
        );
      } else if (this._hitInfo.type === 'scale_uniform' || this._hitInfo.type === 'move_free') {
        PostGizmoRenderer._bindGroup!.setValue('axisMode', axisList[0] + axisList[1] + axisList[2]);
      } else {
        PostGizmoRenderer._bindGroup!.setValue('axisMode', 0);
      }
      ctx.device.setProgram(
        this._mode === 'select' ? PostGizmoRenderer._gizmoSelectProgram : PostGizmoRenderer._gizmoProgram
      );
      ctx.device.setBindGroup(0, PostGizmoRenderer._bindGroup!);
      if (this._mode === 'select') {
        ctx.device.setRenderStates(PostGizmoRenderer._blendRenderState);
      }
      PostGizmoRenderer._primitives![this._mode]!.draw();
      if (this._alwaysDrawIndicator && this._mode !== 'select') {
        this._calcGizmoMVPMatrix('select', false, PostGizmoRenderer._mvpMatrix);
        PostGizmoRenderer._bindGroup!.setValue('mvpMatrix', PostGizmoRenderer._mvpMatrix);
        ctx.device.setProgram(PostGizmoRenderer._gizmoSelectProgram);
        ctx.device.setRenderStates(PostGizmoRenderer._blendRenderState);
        PostGizmoRenderer._primitives!.select!.draw();
      }
    }
    PostGizmoRenderer._blendBlitter.renderStates = PostGizmoRenderer._blendRenderState;
    PostGizmoRenderer._blendBlitter.srgbOut = srgbOutput;
    PostGizmoRenderer._blendBlitter.blit(
      tmpFramebuffer.getColorAttachments()[0],
      destFramebuffer,
      0,
      fetchSampler('clamp_nearest_nomip')
    );
    ctx.device.popDeviceStates();
    ctx.device.pool.releaseFrameBuffer(tmpFramebuffer);
  }
  updateHitInfo(x: number, y: number) {
    if (this._translatePlaneInfo || this._scaleInfo || this._rotateInfo) {
      return;
    }
    if (this._mode === 'rotation' || this._mode === 'scaling' || this._mode === 'translation') {
      const ray = this._camera.constructRay(x, y);
      this._hitInfo = this.rayIntersection(ray);
    } else {
      this._hitInfo = null;
    }
  }
  /**
   * Handle pointer input events
   * @param ev - Event object
   * @param type - Event type
   * @returns true if event was handled, otherwise false
   */
  handlePointerEvent(type: string, x: number, y: number, button: number, pickResult: PickResult): boolean {
    if (!this.enabled || !this._node) {
      this._endRotate();
      this._endTranslation();
      this._endScale();
      return false;
    }
    if (this._mode === 'rotation' || this._mode === 'scaling' || this._mode === 'translation') {
      if (type === 'pointerdown' && button === 0) {
        if (this._hitInfo) {
          if (this._mode === 'translation' && !this._translatePlaneInfo) {
            this._beginTranslate(x, y, this._hitInfo.axis, this._hitInfo.type!, this._hitInfo.pointLocal!);
            return true;
          }
          if (this._mode === 'rotation' && !this._rotateInfo) {
            this._beginRotate(x, y, this._hitInfo.axis, this._hitInfo.pointWorld!);
            return true;
          }
          if (this._mode === 'scaling' && !this._scaleInfo) {
            this._beginScale(x, y, this._hitInfo.axis, this._hitInfo.type!, this._hitInfo.pointLocal!);
            return true;
          }
        }
      }
      if (type === 'pointermove') {
        if (this._mode === 'translation' && this._translatePlaneInfo) {
          this._updateTranslation(x, y, pickResult);
          return true;
        }
        if (this._mode === 'rotation' && this._rotateInfo) {
          this._updateRotate(x, y);
          return true;
        }
        if (this._mode === 'scaling' && this._scaleInfo) {
          this._updateScale(x, y);
          return true;
        }
      }
      if (type === 'pointerup' && button === 0) {
        if (this._mode === 'translation' && this._translatePlaneInfo) {
          this._endTranslation();
          return true;
        }
        if (this._mode === 'rotation' && this._rotateInfo) {
          this._endRotate();
          return true;
        }
        if (this._mode === 'scaling' && this._scaleInfo) {
          this._endScale();
          return true;
        }
      }
    }
    return false;
  }
  /** Ray intersection */
  rayIntersection(ray: Ray): Nullable<GizmoHitInfo> {
    const worldMatrix = this._calcGizmoWorldMatrix(this._mode, false);
    const invWorldMatrix = Matrix4x4.invertAffine(worldMatrix);
    const rayLocal = ray.transform(invWorldMatrix);
    if (this._mode === 'translation' || this._mode === 'scaling') {
      const hitInfo: GizmoHitInfo = {
        axis: -1,
        coord: 0,
        distance: 0,
        pointWorld: null,
        pointLocal: null
      };
      const d = rayLocal.bboxIntersectionTestEx(this._scaleBox);
      if (d !== null && d > 0) {
        hitInfo.type = this._mode === 'scaling' ? 'scale_uniform' : 'move_free';
        hitInfo.distance = d;
        hitInfo.pointLocal = Vector3.add(
          rayLocal.origin,
          Vector3.scale(rayLocal.direction, hitInfo.distance)
        );
        hitInfo.pointWorld = worldMatrix.transformPointAffine(hitInfo.pointLocal);
        return hitInfo;
      }
      const length =
        this._axisLength + (this._mode === 'translation' ? this._arrowLength : 2 * this._boxSize);
      const radius = this._mode === 'translation' ? this._arrowRadius : this._boxSize;
      this._rayIntersectAxis(rayLocal, length, radius, this._mode === 'translation', hitInfo);
      if (hitInfo.axis >= 0) {
        hitInfo.pointLocal = Vector3.add(
          rayLocal.origin,
          Vector3.scale(rayLocal.direction, hitInfo.distance)
        );
        hitInfo.pointWorld = worldMatrix.transformPointAffine(hitInfo.pointLocal);
        return hitInfo;
      }
    } else if (this._mode === 'rotation') {
      const distance = rayLocal.intersectionTestSphere(
        Vector3.zero(),
        this._axisLength + this._axisRadius * 4
      );
      if (distance !== null) {
        let axis = -1;
        let minValue = this._axisRadius * 4;
        let t = distance[0];
        const normal = new Vector3();
        const center = Vector3.zero();
        const radius = this._axisLength;
        for (let i = 0; i < 3; i++) {
          normal.setXYZ(0, 0, 0);
          normal[i] = 1;
          const d = rayLocal.intersectionTestCircle(center, normal, radius, minValue);
          if (d) {
            minValue = d.epsl;
            t = d.dist;
            axis = i;
          }
        }
        const pointLocal = Vector3.add(rayLocal.origin, Vector3.scale(rayLocal.direction, t));
        return {
          axis,
          type: axis >= 0 ? 'rotate_axis' : 'rotate_free',
          coord: t,
          distance: t,
          pointLocal,
          pointWorld: worldMatrix.transformPointAffine(pointLocal)
        };
      }
    }
    return null;
  }
  rayPlaneIntersection(P: Vector3, N: Vector3, Q: Vector3, V: Vector3) {
    const denominator = Vector3.dot(N, V);
    if (Math.abs(denominator) < 1e-10) {
      return null;
    }
    const PQ = Vector3.sub(P, Q);
    const t = Vector3.dot(N, PQ) / denominator;
    return Vector3.add(Q, Vector3.scale(V, t));
  }
  private _beginRotate(startX: number, startY: number, axis: number, hitPosition: Vector3) {
    this._endTranslation();
    this._endScale();
    getDevice().canvas.style.cursor = 'grab';
    const center = new Vector3();
    this._node!.worldMatrix.decompose(null, null, center);
    this._camera.viewProjectionMatrix.transformPointH(center, center);
    const vpWidth = this._camera.viewport ? this._camera.viewport[2] : getDevice().getViewport().width;
    const vpHeight = this._camera.viewport ? this._camera.viewport[3] : getDevice().getViewport().height;
    const centerX = vpWidth * (center.x * 0.5 + 0.5);
    const centerY = vpHeight - vpHeight * (center.y * 0.5 + 0.5);
    this._rotateInfo = {
      startX: startX,
      startY: startY,
      centerX,
      centerY,
      startPosition: hitPosition,
      startRotation: new Quaternion(this._node!.rotation),
      axis,
      speed: this._measureRotateSpeed()
    };
    this.dispatchEvent('begin_rotate', this._node!);
  }
  private _updateRotate(x: number, y: number) {
    if (!this._rotateInfo) {
      return;
    }
    const deltaX = x - this._rotateInfo.startX;
    const deltaY = y - this._rotateInfo.startY;
    const axis = new Vector3();
    const worldMatrix = this._calcGizmoWorldMatrix(this._mode, false);
    const invWorldMatrix = Matrix4x4.invertAffine(worldMatrix);
    let angle = 0;
    let cameraPos: Vector3;
    if (this._rotateInfo.axis >= 0) {
      const { startX, startY, centerX, centerY } = this._rotateInfo;
      const edgeStart = new Vector2(startX - centerX, startY - centerY).inplaceNormalize();
      const edgeEnd = new Vector2(x - centerX, y - centerY).inplaceNormalize();
      angle = Math.atan2(Vector2.cross(edgeEnd, edgeStart), Vector2.dot(edgeStart, edgeEnd));
      cameraPos = this._camera.getWorldPosition();
    }
    if (this._rotateInfo.axis === 0) {
      axis.setXYZ(1, 0, 0);
      if (cameraPos!.x < worldMatrix.m03) {
        angle *= -1;
      }
      //angle = -(deltaY * 0.5) / this._rotateInfo.speed;
    } else if (this._rotateInfo.axis === 1) {
      axis.setXYZ(0, 1, 0);
      if (cameraPos!.y < worldMatrix.m13) {
        angle *= -1;
      }
      //angle = (deltaX * 0.5) / this._rotateInfo.speed;
    } else if (this._rotateInfo.axis === 2) {
      axis.setXYZ(0, 0, 1);
      if (cameraPos!.z < worldMatrix.m23) {
        angle *= -1;
      }
      //angle = -(deltaY * 0.5) / this._rotateInfo.speed;
    } else {
      const velocity = new Vector2(deltaX, deltaY);
      const movement = velocity.magnitude;
      velocity.scaleBy(1 / movement).scaleBy(10);
      const ray = this._camera.constructRay(
        this._rotateInfo.startX + velocity.x,
        this._rotateInfo.startY + velocity.y
      );
      const rayLocal = ray.transform(invWorldMatrix);
      const distance = rayLocal.intersectionTestSphere(Vector3.zero(), this._axisLength);
      if (!distance) {
        return;
      }
      const nearestPoint = Vector3.add(rayLocal.origin, Vector3.scale(rayLocal.direction, distance[0]));
      worldMatrix.transformPointAffine(nearestPoint, nearestPoint);
      const delta = Vector3.distance(this._rotateInfo.startPosition, nearestPoint);
      if (distance.length > 1) {
        const nearestPoint2 = Vector3.add(rayLocal.origin, Vector3.scale(rayLocal.direction, distance[1]));
        worldMatrix.transformPointAffine(nearestPoint2, nearestPoint2);
        const delta2 = Vector3.distance(this._rotateInfo.startPosition, nearestPoint2);
        if (delta2 < delta) {
          nearestPoint.set(nearestPoint2);
        }
      }
      const center = this._node!.getWorldPosition();
      const edge1 = Vector3.sub(this._rotateInfo.startPosition, center).inplaceNormalize();
      const edge2 = Vector3.sub(nearestPoint, center).inplaceNormalize();
      Vector3.cross(edge1, edge2, axis).inplaceNormalize();
      angle = movement / this._rotateInfo.speed;
    }
    invWorldMatrix.transformVectorAffine(axis, axis);
    axis.inplaceNormalize();
    const deltaRotation = Quaternion.fromAxisAngle(axis, angle);
    this._node!.rotation = Quaternion.multiply(deltaRotation, this._rotateInfo.startRotation);
  }
  private _endRotate() {
    getDevice().canvas.style.cursor = 'default';
    if (this._rotateInfo) {
      this._rotateInfo = null;
      if (this._node) {
        this.dispatchEvent('end_rotate', this._node);
      }
    }
  }
  private _beginScale(startX: number, startY: number, axis: number, type: HitType, pointLocal: Vector3) {
    this._endRotate();
    this._endTranslation();
    getDevice().canvas.style.cursor = 'grab';
    let planeAxis = axis;
    if (type === 'move_axis') {
      const ray = this._camera.constructRay(startX, startY);
      const worldMatrix = this._calcGizmoWorldMatrix(this._mode, false);
      const invWorldMatrix = Matrix4x4.invertAffine(worldMatrix);
      const rayLocal = ray.transform(invWorldMatrix);
      const t = [0, 1, 2];
      t.splice(axis, 1);
      if (Math.abs(rayLocal.direction[t[0]]) > Math.abs(rayLocal.direction[t[1]])) {
        planeAxis = t[0];
      } else {
        planeAxis = t[1];
      }
      const d = (0 - rayLocal.origin[planeAxis]) / rayLocal.direction[planeAxis];
      pointLocal.set(rayLocal.direction);
      pointLocal.scaleBy(d);
      pointLocal.addBy(rayLocal.origin);
    }
    const scale = new Vector3();
    this._calcGizmoWorldMatrix(this._mode, false).decompose(scale);
    this._scaleInfo = {
      axis,
      startY,
      planeAxis,
      type,
      scale: new Vector3(this._node!.scale),
      lastPlanePos: pointLocal.mulBy(scale)
    };
    this.dispatchEvent('begin_scale', this._node!);
  }
  private _calcScaleFactor(d: number) {
    return Math.max(0.0001, 1 + d * 0.2);
  }
  private _updateScale(x: number, y: number) {
    if (!this._scaleInfo) {
      return;
    }
    const ray = this._camera.constructRay(x, y);
    const worldMatrix = this._calcGizmoWorldMatrix(this._mode, true);
    const invWorldMatrix = Matrix4x4.invertAffine(worldMatrix);
    const rayLocal = ray.transform(invWorldMatrix);
    if (Math.abs(rayLocal.direction[this._scaleInfo.planeAxis]) < 0.0001) {
      return;
    }
    const t = ['x', 'y', 'z'];
    if (this._scaleInfo.type === 'move_axis') {
      const c = t[this._scaleInfo.axis];
      const d =
        (0 - rayLocal.origin[this._scaleInfo.planeAxis]) / rayLocal.direction[this._scaleInfo.planeAxis];
      const p = Vector3.add(rayLocal.origin, Vector3.scale(rayLocal.direction, d));
      this._node!.scale[c] =
        this._scaleInfo.scale[c] *
        this._calcScaleFactor(p[this._scaleInfo.axis] - this._scaleInfo.lastPlanePos[this._scaleInfo.axis]);
    } else if (this._scaleInfo.type === 'scale_uniform') {
      const d = this._scaleInfo.startY - y;
      const factor = this._calcScaleFactor(d / 20);
      this._node!.scale.x = this._node!.scale.x * factor;
      this._node!.scale.y = this._node!.scale.y * factor;
      this._node!.scale.z = this._node!.scale.z * factor;
      this._scaleInfo.startY = y;
    }
  }
  private _endScale() {
    getDevice().canvas.style.cursor = 'default';
    if (this._scaleInfo) {
      this._scaleInfo = null;
      if (this._node) {
        this.dispatchEvent('end_scale', this._node);
      }
    }
  }
  private _beginTranslate(startX: number, startY: number, axis: number, type: HitType, pointLocal: Vector3) {
    this._endRotate();
    this._endScale();
    getDevice().canvas.style.cursor = 'grab';
    let planeAxis = axis;
    if (type === 'move_axis') {
      const ray = this._camera.constructRay(startX, startY);
      const worldMatrix = this._calcGizmoWorldMatrix(this._mode, false);
      const invWorldMatrix = Matrix4x4.invertAffine(worldMatrix);
      const rayLocal = ray.transform(invWorldMatrix);
      const t = [0, 1, 2];
      t.splice(axis, 1);
      if (Math.abs(rayLocal.direction[t[0]]) > Math.abs(rayLocal.direction[t[1]])) {
        planeAxis = t[0];
      } else {
        planeAxis = t[1];
      }
      const d = (0 - rayLocal.origin[planeAxis]) / rayLocal.direction[planeAxis];
      pointLocal.set(rayLocal.direction);
      pointLocal.scaleBy(d);
      pointLocal.addBy(rayLocal.origin);
    }
    const scale = new Vector3();
    this._calcGizmoWorldMatrix(this._mode, false).decompose(scale);
    this._translatePlaneInfo = {
      axis,
      planeAxis,
      type,
      lastPlanePos: pointLocal.mulBy(scale)
    };
    this.dispatchEvent('begin_translate', this._node!);
  }
  private _updateTranslation(x: number, y: number, pickResult: PickResult) {
    if (!this._translatePlaneInfo) {
      return;
    }
    if (this._translatePlaneInfo.type === 'move_free') {
      const hitPos = pickResult?.intersectedPoint ?? null;
      if (hitPos) {
        const parentPos = this._node!.parent!.getWorldPosition();
        this._node!.position.set(Vector3.sub(hitPos, parentPos, parentPos));
      } else {
        const ray = this.camera.constructRay(x, y);
        let hitDistance = -ray.origin.y / ray.direction.y;
        if (Number.isNaN(hitDistance) || hitDistance < 0) {
          hitDistance = 10;
        }
        const px = ray.origin.x + ray.direction.x * hitDistance;
        const py = ray.origin.y + ray.direction.y * hitDistance;
        const pz = ray.origin.z + ray.direction.z * hitDistance;
        this._node!.position.setXYZ(px, py, pz);
      }
      return;
    }
    const ray = this._camera.constructRay(x, y);
    const worldMatrix = this._calcGizmoWorldMatrix(this._mode, true);
    const invWorldMatrix = Matrix4x4.invertAffine(worldMatrix);
    const rayLocal = ray.transform(invWorldMatrix);
    if (Math.abs(rayLocal.direction[this._translatePlaneInfo.planeAxis]) < 0.0001) {
      return;
    }
    const t = ['x', 'y', 'z'];
    const c = t[this._translatePlaneInfo.axis];
    t.splice(this._translatePlaneInfo.planeAxis, 1);
    const d =
      (0 - rayLocal.origin[this._translatePlaneInfo.planeAxis]) /
      rayLocal.direction[this._translatePlaneInfo.planeAxis];
    const p = Vector3.add(rayLocal.origin, Vector3.scale(rayLocal.direction, d));
    if (this._translatePlaneInfo.type === 'move_axis') {
      this._node!.position[c] +=
        p[this._translatePlaneInfo.axis] -
        this._translatePlaneInfo.lastPlanePos[this._translatePlaneInfo.axis];
    } else {
      const dx = p[t[0]] - this._translatePlaneInfo.lastPlanePos[t[0]];
      const dy = p[t[1]] - this._translatePlaneInfo.lastPlanePos[t[1]];
      this._node!.position[t[0]] += dx;
      this._node!.position[t[1]] += dy;
    }
  }
  private _endTranslation() {
    getDevice().canvas.style.cursor = 'default';
    if (this._translatePlaneInfo) {
      this._translatePlaneInfo = null;
      if (this._node) {
        this.dispatchEvent('end_translate', this._node);
      }
    }
  }
  private _measureRotateSpeed() {
    const pos1 = new Vector4(0, 0, this._axisLength, 1);
    const pos2 = Matrix4x4.rotation(PostGizmoRenderer._axises[0], 1).transformAffine(pos1);
    const mvpMatrix = this._calcGizmoMVPMatrix(this._mode, false);
    const width = this._camera.viewport ? this._camera.viewport[2] : getDevice().getViewport().width;
    const height = this._camera.viewport ? this._camera.viewport[3] : getDevice().getViewport().height;
    mvpMatrix.transform(pos1, pos1);
    mvpMatrix.transform(pos2, pos2);
    let dx = pos2.x / pos2.w - pos1.x / pos1.w;
    let dy = pos2.y / pos2.w - pos1.y / pos1.w;
    dx *= 0.5 * width;
    dy *= 0.5 * height;
    return Math.hypot(dx, dy);
  }
  private _calcGizmoMVPMatrix(mode: GizmoMode, noScale: boolean, matrix?: Matrix4x4) {
    matrix = this._calcGizmoWorldMatrix(mode, noScale, matrix);
    return matrix.multiplyLeft(this._camera.viewProjectionMatrix);
  }
  private _calcGizmoWorldMatrix(mode: GizmoMode, noScale: boolean, matrix?: Matrix4x4) {
    matrix = matrix ?? new Matrix4x4();
    if (this._node) {
      if (mode === 'select') {
        calcHierarchyBoundingBox(this._node, this._nodeBox);
        const scale = Vector3.sub(this._nodeBox.maxPoint, this._nodeBox.minPoint);
        matrix.scaling(scale).translateLeft(this._nodeBox.minPoint);
      } else {
        this._node.worldMatrix.decompose(tmpVecS, tmpQuatR, tmpVecT);
        matrix.translation(tmpVecT);
        if (!noScale) {
          if (this._camera.isPerspective()) {
            const d = Vector3.distance(this._camera.getWorldPosition(), tmpVecT);
            const scale = (this._screenSize * d * this._camera.getTanHalfFovy()) / (2 * this._axisLength);
            matrix.scaling(new Vector3(scale, scale, scale)).translateLeft(tmpVecT);
          } else {
            const projMatrix = this._camera.getProjectionMatrix();
            const scaleY =
              (this._screenSize * Math.abs(projMatrix.getBottomPlane() - projMatrix.getTopPlane())) /
              (2 * this._axisLength);
            const vpWidth = this._camera.viewport
              ? this._camera.viewport[2]
              : getDevice().getDrawingBufferWidth();
            const vpHeight = this._camera.viewport
              ? this._camera.viewport[3]
              : getDevice().getDrawingBufferHeight();
            const scaleX = scaleY * (vpHeight / vpWidth);
            matrix.scaling(new Vector3(scaleX, scaleY, scaleY)).translateLeft(tmpVecT);
          }
        }
      }
    } else {
      matrix.identity();
    }
    return matrix;
  }
  private _createGizmoRenderStates() {
    const rs = getDevice().createRenderStateSet();
    rs.useDepthState().enableTest(true).enableWrite(true).setDepthBias(0).setDepthBiasSlopeScale(0);
    return rs;
  }
  private _createGridRenderStates() {
    const rs = getDevice().createRenderStateSet();
    rs.useDepthState().enableTest(true).enableWrite(false);
    return rs;
  }
  private _createBlendRenderStates() {
    const rs = getDevice().createRenderStateSet();
    rs.useDepthState().enableTest(false).enableWrite(false);
    rs.useRasterizerState().setCullMode('none');
    rs.useBlendingState()
      .enable(true)
      .setBlendFuncRGB('one', 'inv-src-alpha')
      .setBlendFuncAlpha('zero', 'one');
    return rs;
  }
  private _rayIntersectAxis(
    ray: Ray,
    length: number,
    radius: number,
    intersectWithPlane: boolean,
    info: GizmoHitInfo
  ) {
    let type: Nullable<HitType> = null;
    let intersectedAxis = -1;
    let minDistance = Infinity;
    let intersectedCoord = 0;
    for (let axis = 0; axis < 3; axis++) {
      const coords = [0, 1, 2];
      coords.splice(axis, 1);
      const [i1, i2] = coords;

      // intersection test for plane
      if (intersectWithPlane && Math.abs(ray.direction[axis]) > 0.001) {
        const d = (0 - ray.origin[axis]) / ray.direction[axis];
        if (d > 0 && d < minDistance) {
          const a = ray.origin[i1] + d * ray.direction[i1];
          const b = ray.origin[i2] + d * ray.direction[i2];
          if (
            a > this._axisLength * 0.25 &&
            a < this._axisLength * 0.75 &&
            b > this._axisLength * 0.25 &&
            b < this._axisLength * 0.75
          ) {
            type = 'move_plane';
            minDistance = d;
            intersectedAxis = axis;
          }
        }
      }
      // intersection test for axis

      const o = ray.origin;
      const d = ray.direction;

      const a = d[i1] * d[i1] + d[i2] * d[i2];
      const b = 2 * (o[i1] * d[i1] + o[i2] * d[i2]);
      const c = o[i1] * o[i1] + o[i2] * o[i2] - radius * radius;

      const discriminant = b * b - 4 * a * c;
      if (discriminant < 0) {
        continue;
      }
      const sqrtDisc = Math.sqrt(discriminant);
      const t1 = (-b - sqrtDisc) / (2 * a);
      const t2 = (-b + sqrtDisc) / (2 * a);
      for (const t of [t1, t2]) {
        if (t < 0) {
          continue;
        }
        if (t < minDistance) {
          const hit = Vector3.add(ray.origin, Vector3.scale(ray.direction, t));
          const coord = [hit.x, hit.y, hit.z][axis];
          if (coord >= 0 && coord <= length) {
            type = 'move_axis';
            intersectedAxis = axis;
            minDistance = t;
            intersectedCoord = coord;
          }
        }
      }
    }
    info.type = type;
    info.axis = intersectedAxis;
    info.coord = intersectedCoord;
    info.distance = minDistance;
  }
  private _createGridProgram() {
    return getDevice().buildRenderProgram({
      vertex(pb) {
        this.$inputs.pos = pb.vec3().attrib('position');
        this.params = pb.vec4().uniform(0);
        this.cameraPos = pb.vec3().uniform(0);
        this.viewMatrixInv = pb.mat4().uniform(0);
        this.viewProjMatrix = pb.mat4().uniform(0);
        this.flip = pb.float().uniform(0);
        pb.main(function () {
          this.$l.worldPos = pb.vec3();
          this.$if(pb.notEqual(this.params.z, 0), function () {
            this.worldPos = pb.add(
              pb.vec3(this.cameraPos.x, 0, this.cameraPos.y),
              pb.mul(this.$inputs.pos, pb.vec3(this.params.x, 1, this.params.x))
            );
            this.$outputs.worldPos = this.worldPos;
          }).$else(function () {
            this.$l.right = this.viewMatrixInv[0].xyz;
            this.$l.up = this.viewMatrixInv[1].xyz;
            this.$l.scale = pb.mul(this.$inputs.pos.xz, this.params.x);
            this.$l.planeNormal = this.viewMatrixInv[2].xyz;
            this.$l.planeD = pb.neg(pb.dot(this.cameraPos, this.planeNormal));
            this.$l.origin = pb.sub(pb.vec3(0), pb.mul(this.planeNormal, this.planeD));
            this.$outputs.worldPos = pb.vec3(this.scale, 0);
            this.worldPos = pb.add(
              this.origin,
              pb.mul(this.right, this.scale.x),
              pb.mul(this.up, this.scale.y)
            );
          });
          /*
          this.$outputs.worldPos = pb.add(
            pb.vec3(this.cameraPos.x, 0, this.cameraPos.y),
            pb.mul(this.$inputs.pos, pb.vec3(this.params.x, 1, this.params.x))
          );
          */
          this.$builtins.position = pb.mul(this.viewProjMatrix, pb.vec4(this.worldPos, 1));
          this.$builtins.position = pb.mul(this.$builtins.position, pb.vec4(1, this.flip, 1, 1));
        });
      },
      fragment(pb) {
        this.$outputs.outColor = pb.vec4();
        this.viewMatrixInv = pb.mat4().uniform(0);
        this.params = pb.vec4().uniform(0);
        this.cameraPos = pb.vec3().uniform(0);
        this.steps = pb.vec4[8]().uniform(0);
        this.depthTex = pb.tex2D().sampleType('unfilterable-float').uniform(0);
        this.texSize = pb.vec2().uniform(0);
        this.cameraNearFar = pb.vec2().uniform(0);
        const STEPS_LEN = 8;
        function minInt(scope: PBInsideFunctionScope, a: PBShaderExp | number, b: PBShaderExp | number) {
          if (pb.getDevice().type === 'webgl' && (typeof a !== 'number' || typeof b !== 'number')) {
            pb.func('minInt', [pb.int('a'), pb.int('b')], function () {
              this.$return(this.$choice(pb.lessThan(this.a, this.b), this.a, this.b));
            });
            return scope.minInt(a, b);
          } else {
            return pb.min(a, b);
          }
        }
        function getStep(scope: PBInsideFunctionScope, i: PBShaderExp | number) {
          if (pb.getDevice().type === 'webgl' && typeof i !== 'number') {
            pb.func('getStep', [pb.int('i')], function () {
              this.$for(pb.int('k'), 0, STEPS_LEN, function () {
                this.$if(pb.equal(this.k, this.i), function () {
                  this.$return(this.steps.at(this.k));
                });
              });
              this.$return(pb.vec4(0));
            });
            return scope.getStep(i);
          } else {
            return scope.steps.at(i);
          }
        }
        pb.func('linearStep', [pb.float('p0'), pb.float('p1'), pb.float('v')], function () {
          this.$return(pb.clamp(pb.div(pb.sub(this.v, this.p0), pb.abs(pb.sub(this.p1, this.p0))), 0, 1));
        });
        pb.func(
          'getAxis',
          [pb.vec3('co'), pb.vec3('fwidthCos'), pb.float('lineSize'), pb.float('gridLineSize')],
          function () {
            this.$l.axisDomain = pb.div(pb.abs(this.co), this.fwidthCos);
            this.$return(
              pb.sub(
                pb.vec3(1),
                pb.smoothStep(
                  pb.vec3(gridLineSmoothEnd),
                  pb.vec3(gridLineSmoothStart),
                  pb.sub(this.axisDomain, pb.vec3(pb.add(this.lineSize, this.gridLineSize)))
                )
              )
            );
          }
        );
        pb.func(
          'getGrid',
          [pb.vec2('co'), pb.vec2('fwidthCos'), pb.vec2('gridScale'), pb.float('lineSize')],
          function () {
            this.$l.halfSize = pb.mul(this.gridScale, 0.5);
            this.$l.x = pb.add(this.co, this.halfSize);
            if (pb.getDevice().type === 'webgpu') {
              this.$l.gridDomain = pb.abs(
                pb.sub(
                  pb.sub(this.x, pb.mul(this.gridScale, pb.floor(pb.div(this.x, this.gridScale)))),
                  this.halfSize
                )
              );
            } else {
              this.$l.gridDomain = pb.abs(pb.sub(pb.mod(this.x, this.gridScale), this.halfSize));
            }
            this.gridDomain = pb.div(this.gridDomain, this.fwidthCos);
            this.$l.lineDist = pb.min(this.gridDomain.x, this.gridDomain.y);
            this.$return(
              pb.sub(
                1,
                pb.smoothStep(gridLineSmoothEnd, gridLineSmoothStart, pb.sub(this.lineDist, this.lineSize))
              )
            );
          }
        );
        pb.func(
          'screenSpaceGrid',
          [
            pb.vec3('P'),
            pb.vec3('cameraPos'),
            pb.mat4('viewMatrixInv'),
            pb.float('distance'),
            pb.vec3('colorGrid'),
            pb.vec3('colorGridEmphasis'),
            pb.float('persp')
          ],
          function () {
            this.$l.dFdxPos = pb.dpdx(this.P);
            this.$l.dFdyPos = pb.dpdy(this.P);
            this.$l.fwidthPos = pb.add(pb.abs(this.dFdxPos), pb.abs(this.dFdyPos));
            this.$l.dist = pb.float();
            this.$l.fade = pb.float();
            this.$if(pb.notEqual(this.persp, 0), function () {
              this.$l.V = pb.sub(this.cameraPos, this.P);
              this.dist = pb.length(this.V);
              this.V = pb.div(this.V, this.dist);
              this.$l.angle = pb.sub(1, pb.abs(this.V.y));
              this.angle = pb.mul(this.angle, this.angle);
              this.fade = pb.sub(1, pb.mul(this.angle, this.angle));
              this.fade = pb.mul(
                this.fade,
                pb.sub(1, pb.smoothStep(0, this.distance, pb.sub(this.dist, this.distance)))
              );
            }).$else(function () {
              this.dist = pb.sub(pb.mul(this.$builtins.fragCoord.z, 2), 1);
              this.dist = pb.clamp(this.dist, 0, 1);
              this.fade = pb.sub(1, pb.smoothStep(0, 0.5, pb.sub(this.dist, 0.5)));
              this.dist = 1;
            });
            this.$l.gridRes = pb.mul(
              pb.dot(
                this.dFdxPos,
                this.$choice(pb.notEqual(this.persp, 0), this.viewMatrixInv[0].xyz, pb.vec3(1, 0, 0))
              ),
              4
            );
            this.$l.step_id_x = pb.int(STEPS_LEN - 1);
            this.$l.step_id_y = pb.int(STEPS_LEN - 1);
            this.$for(pb.int('i'), STEPS_LEN - 2, 0, false, true, function () {
              this.step_id_x = this.$choice(
                pb.lessThan(this.gridRes, this.steps.at(this.i).x),
                this.i,
                this.step_id_x
              );
              this.step_id_y = this.$choice(
                pb.lessThan(this.gridRes, this.steps.at(this.i).y),
                this.i,
                this.step_id_y
              );
            });
            this.$l.scale0x = this.$choice(
              pb.greaterThan(this.step_id_x, 0),
              getStep(this, pb.sub(this.step_id_x, 1)).x,
              0
            );
            this.$l.scaleAx = getStep(this, this.step_id_x).x;
            this.$l.scaleBx = getStep(this, minInt(this, pb.add(this.step_id_x, 1), STEPS_LEN - 1)).x;
            this.$l.scaleCx = getStep(this, minInt(this, pb.add(this.step_id_x, 2), STEPS_LEN - 1)).x;
            this.$l.scale0y = this.$choice(
              pb.greaterThan(this.step_id_y, 0),
              getStep(this, pb.sub(this.step_id_y, 1)).y,
              0
            );
            this.$l.scaleAy = getStep(this, this.step_id_y).y;
            this.$l.scaleBy = getStep(this, minInt(this, pb.add(this.step_id_y, 1), STEPS_LEN - 1)).y;
            this.$l.scaleCy = getStep(this, minInt(this, pb.add(this.step_id_y, 2), STEPS_LEN - 1)).y;

            this.$l.blend = pb.sub(
              1,
              this.linearStep(
                pb.add(this.scale0x, this.scale0y),
                pb.add(this.scaleAx, this.scaleAy),
                pb.add(this.gridRes, this.gridRes)
              )
            );
            this.blend = pb.mul(this.blend, this.blend, this.blend);
            this.$l.gridPos = this.$choice(pb.notEqual(this.persp, 0), this.P.xz, this.P.xy);
            this.$l.gridFwidth = this.$choice(
              pb.notEqual(this.persp, 0),
              this.fwidthPos.xz,
              this.fwidthPos.xy
            );
            this.$l.lineSize = pb.float(0);
            this.$l.gridA = this.getGrid(
              this.gridPos,
              this.gridFwidth,
              pb.vec2(this.scaleAx, this.scaleAy),
              this.lineSize
            );
            this.$l.gridB = this.getGrid(
              this.gridPos,
              this.gridFwidth,
              pb.vec2(this.scaleBx, this.scaleBy),
              this.lineSize
            );
            this.$l.gridC = this.getGrid(
              this.gridPos,
              this.gridFwidth,
              pb.vec2(this.scaleCx, this.scaleCy),
              this.lineSize
            );
            this.$l.color = pb.vec4(this.colorGrid, 1);
            this.$l.colorEmphasis = pb.vec4(this.colorGridEmphasis, 1);
            this.$l.outColor = pb.vec4(this.color.rgb, pb.mul(this.gridA, this.blend));
            this.outColor = pb.mix(
              this.outColor,
              pb.mix(this.color, this.colorEmphasis, this.blend),
              this.gridB
            );
            this.outColor = pb.mix(this.outColor, this.colorEmphasis, this.gridC);

            // Axis
            this.$l.axisDist = pb.vec3();
            this.$l.axisFwidth = pb.vec3();
            this.$if(pb.notEqual(this.persp, 0), function () {
              this.$l.planeAxis = pb.vec3(1, 0, 1);
              this.axisDist.x = pb.dot(this.P.yz, this.planeAxis.yz);
              this.axisFwidth.x = pb.dot(this.fwidthPos.yz, this.planeAxis.yz);
              this.axisDist.z = pb.dot(this.P.xy, this.planeAxis.xy);
              this.axisFwidth.z = pb.dot(this.fwidthPos.xy, this.planeAxis.xy);
            }).$else(function () {
              this.axisDist.x = this.P.y;
              this.axisFwidth.x = this.fwidthPos.y;
              this.axisDist.z = this.P.x;
              this.axisFwidth.z = this.fwidthPos.x;
            });
            this.$l.axes = this.getAxis(this.axisDist, this.axisFwidth, 0.5, 0);
            this.outColor = pb.vec4(
              this.$choice(pb.lessThan(this.axes.x, 1e-8), this.outColor.rgb, pb.vec3(1, 0, 0)),
              pb.max(this.outColor.a, this.axes.x)
            );
            this.outColor = pb.vec4(
              this.$choice(pb.lessThan(this.axes.z, 1e-8), this.outColor.rgb, pb.vec3(0, 0, 1)),
              pb.max(this.outColor.a, this.axes.z)
            );
            this.outAlpha = pb.mul(this.outColor.a, this.fade);
            this.$return(pb.vec4(pb.mul(this.outColor.rgb, this.outAlpha), this.outAlpha));
          }
        );
        pb.main(function () {
          this.$l.color = this.screenSpaceGrid(
            this.$inputs.worldPos,
            this.cameraPos,
            this.viewMatrixInv,
            this.params.y,
            pb.vec3(0.112, 0.112, 0.112),
            pb.vec3(0.1384, 0.1384, 0.1384),
            this.params.z
          );
          this.$l.screenUV = pb.div(pb.vec2(this.$builtins.fragCoord.xy), this.texSize);
          this.$l.depth = this.$builtins.fragCoord.z;
          this.$l.sceneDepthSample = pb.textureSampleLevel(this.depthTex, this.screenUV, 0);
          this.$l.sceneDepth = this.sceneDepthSample.r;
          this.$l.alpha = this.$choice(
            pb.greaterThan(this.depth, this.sceneDepth),
            pb.float(0),
            this.color.a
          );
          this.$outputs.outColor = pb.vec4(pb.mul(this.color.rgb, this.alpha), this.alpha);
        });
      }
    });
  }
  private _createAxisProgram(selectMode: boolean) {
    return getDevice().buildRenderProgram({
      vertex(pb) {
        this.$inputs.pos = pb.vec3().attrib('position');
        if (selectMode) {
          this.$inputs.uv = pb.vec2().attrib('texCoord0');
          this.$inputs.axis = pb.float().attrib('texCoord1');
          this.$inputs.barycentric = pb.vec3().attrib('texCoord2');
        } else {
          this.$inputs.axis = pb.float().attrib('texCoord0');
          this.$inputs.color = pb.vec4().attrib('diffuse');
        }
        this.axisMode = pb.float().uniform(0);
        this.mvpMatrix = pb.mat4().uniform(0);
        this.flip = pb.float().uniform(0);
        pb.main(function () {
          this.$builtins.position = pb.mul(this.mvpMatrix, pb.vec4(this.$inputs.pos, 1));
          if (!selectMode) {
            this.colorScale = this.$choice(
              pb.equal(this.axisMode, this.$inputs.axis),
              pb.float(1),
              pb.float(0.5)
            );
            this.$outputs.color = pb.mul(this.$inputs.color, this.colorScale);
          } else {
            this.$outputs.uv = this.$inputs.uv;
            this.$outputs.barycentric = this.$inputs.barycentric;
          }
          this.$builtins.position = pb.mul(this.$builtins.position, pb.vec4(1, this.flip, 1, 1));
        });
      },
      fragment(pb) {
        this.$outputs.color = pb.vec4();
        this.depthTex = pb.tex2D().sampleType('unfilterable-float').uniform(0);
        this.texSize = pb.vec2().uniform(0);
        this.cameraNearFar = pb.vec2().uniform(0);
        this.time = pb.float().uniform(0);
        pb.main(function () {
          this.$l.screenUV = pb.div(pb.vec2(this.$builtins.fragCoord.xy), this.texSize);
          this.$l.depth = this.$builtins.fragCoord.z;
          this.$l.sceneDepthSample = pb.textureSampleLevel(this.depthTex, this.screenUV, 0);
          this.$l.sceneDepth = this.sceneDepthSample.r;
          this.$l.alpha = this.$choice(
            pb.greaterThan(this.depth, this.sceneDepth),
            selectMode ? pb.float(0.3) : pb.float(0.5),
            pb.float(1)
          );
          if (selectMode) {
            this.$l.lineWidth = pb.float(1);
            this.$l.dBdx = pb.dpdx(this.$inputs.barycentric);
            this.$l.dBdy = pb.dpdy(this.$inputs.barycentric);
            this.$l.gradLen = pb.max(
              pb.sqrt(pb.add(pb.mul(this.dBdx, this.dBdx), pb.mul(this.dBdy, this.dBdy))),
              pb.vec3(1e-5)
            );
            this.$l.threshold = pb.mul(this.lineWidth, this.gradLen);
            this.$l.edgeMask = pb.smoothStep(
              pb.sub(this.threshold, this.gradLen),
              pb.add(this.threshold, this.gradLen),
              this.$inputs.barycentric
            );
            this.alpha = pb.sub(1, pb.min(pb.min(this.edgeMask.x, this.edgeMask.y), this.edgeMask.z));
            this.alpha = pb.clamp(this.alpha, 0, 1);
          }
          const diffuse = selectMode ? pb.vec3(0, 255, 204) : this.$inputs.color.rgb;
          this.$outputs.color = pb.vec4(pb.mul(diffuse, this.alpha), this.alpha);
        });
      }
    });
  }
  private prepare() {
    if (!PostGizmoRenderer._gridPrimitive) {
      PostGizmoRenderer._gridPrimitive = new PlaneShape({
        size: 2,
        twoSided: true,
        resolution: 8,
        transform: Matrix4x4.translation(new Vector3(0, -0.01, 0))
      });
      PostGizmoRenderer._gridProgram = this._createGridProgram();
      PostGizmoRenderer._gridRenderState = this._createGridRenderStates();
      PostGizmoRenderer._gridBindGroup = getDevice().createBindGroup(
        PostGizmoRenderer._gridProgram.bindGroupLayouts[0]
      );
    }
    if (!PostGizmoRenderer._gizmoSelectProgram) {
      PostGizmoRenderer._gizmoSelectProgram = this._createAxisProgram(true);
    }
    if (!PostGizmoRenderer._gizmoProgram) {
      PostGizmoRenderer._gizmoProgram = this._createAxisProgram(false);
      PostGizmoRenderer._gizmoRenderState = this._createGizmoRenderStates();
      PostGizmoRenderer._blendRenderState = this._createBlendRenderStates();
      PostGizmoRenderer._bindGroup = getDevice().createBindGroup(
        PostGizmoRenderer._gizmoProgram.bindGroupLayouts[0]
      );
    }
    if (!PostGizmoRenderer._primitives) {
      PostGizmoRenderer._primitives = {
        translation: createTranslationGizmo(
          this._axisLength,
          this._axisRadius,
          this._arrowLength,
          this._arrowRadius,
          this._boxSize
        ),
        rotation: createRotationGizmo(this._axisLength, this._axisRadius),
        scaling: createScaleGizmo(this._axisLength, this._axisRadius, this._boxSize),
        select: createSelectGizmo()
      };
    }
  }
}
