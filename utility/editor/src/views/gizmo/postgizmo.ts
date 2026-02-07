import type {
  BaseTexture,
  BindGroup,
  GPUProgram,
  PBInsideFunctionScope,
  PBShaderExp,
  RenderStateSet,
  Texture2D
} from '@zephyr3d/device';
import type { BaseSprite, Camera, DrawContext, PickResult, SceneNode, Sprite } from '@zephyr3d/scene';
import { Primitive } from '@zephyr3d/scene';
import { BoxShape, getDevice, Mesh, UnlitMaterial } from '@zephyr3d/scene';
import { AbstractPostEffect, CopyBlitter, fetchSampler, PlaneShape } from '@zephyr3d/scene';
import {
  createTranslationGizmo,
  createRotationGizmo,
  createScaleGizmo,
  createSelectGizmo,
  axisList,
  createScaleWithHandleGizmo,
  createEditAABBGizmo
} from './gizmo';
import type { Nullable, Ray } from '@zephyr3d/base';
import { CubeFace } from '@zephyr3d/base';
import { DRef } from '@zephyr3d/base';
import { AABB, makeObservable } from '@zephyr3d/base';
import { Matrix4x4, Quaternion, Vector2, Vector3, Vector4 } from '@zephyr3d/base';
import { calcHierarchyBoundingBoxWorld } from '../../helpers/misc';
import { eventBus } from '../../core/eventbus';

const tmpVecT = new Vector3();
const tmpVecS = new Vector3();
const tmpVecR = new Vector3();
const tmpVecQ = new Vector3();
const tmpVecU = new Vector3();
const tmpVecV = new Vector3();
const tmpVecW = new Vector3();
const tmpQuatR = new Quaternion();

const discRadius = 1.05 / Math.sqrt(Math.PI);
const gridLineSmoothStart = 0.5 + discRadius;
const gridLineSmoothEnd = 0.5 - discRadius;

const selectLineColor3D = new Vector4(0, 1, 1, 1);
const selectLineWidth3D = 1;
const selectLineColor2D = new Vector4(0, 1, 1, 1);
const selectLineWidth2D = 2;

export type HitType =
  | 'move_axis'
  | 'move_plane'
  | 'move_free'
  | 'rotate_axis'
  | 'rotate_free'
  | 'scale_axis'
  | 'scale_uniform'
  | 'sprite_handle'
  | 'sprite_anchor';
export type GizmoMode =
  | 'none'
  | 'translation'
  | 'rotation'
  | 'scaling'
  | 'edit-aabb'
  | 'edit-rect'
  | 'select';
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

type AABBInfo = {
  axis: CubeFace;
  pointOnPlane: Vector3;
  planeNormal: Vector3;
};

type RectInfo = {
  type: HitType;
  coord: number;
  anchorPos: Vector3;
  xAxis: Vector3;
  yAxis: Vector3;
  width: number;
  height: number;
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
}>() {
  static _aabbMesh: DRef<Mesh> = new DRef();
  static _blendBlitter: CopyBlitter = new CopyBlitter();
  static _gizmoProgram: Nullable<GPUProgram> = null;
  static _gizmoSelectProgram: Nullable<GPUProgram> = null;
  static _gridProgram: Nullable<GPUProgram> = null;
  static _aalineProgram: Nullable<GPUProgram> = null;
  static _aalineBindGroup: Nullable<BindGroup> = null;
  static _gizmoRenderState: Nullable<RenderStateSet> = null;
  static _gridRenderState: Nullable<RenderStateSet> = null;
  static _blendRenderState: Nullable<RenderStateSet> = null;
  static _aabbRenderState: Nullable<RenderStateSet> = null;
  static _gridPrimitive: Nullable<Primitive> = null;
  static _gridPrimitiveOrtho: Nullable<Primitive> = null;
  static _bindGroup: Nullable<BindGroup> = null;
  static _gridBindGroup: Nullable<BindGroup> = null;
  static _rotation: Nullable<Primitive> = null;
  static _mvpMatrix: Matrix4x4 = new Matrix4x4();
  static _texSize: Vector2 = new Vector2();
  static _cameraNearFar: Vector2 = new Vector2();
  static _axises = [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)];
  static _primitives: Nullable<Partial<Record<GizmoMode, Primitive[]>>> = null;
  static _aalinePrimitive: Nullable<Primitive> = null;
  static _aalinePositions: Float32Array<ArrayBuffer> = new Float32Array(4 * 4);
  static _aalineAB: Float32Array<ArrayBuffer> = new Float32Array(4 * 4);
  private _aabbForEdit: Nullable<AABB>;
  private _snapping: number;
  private _allowTranslate: boolean;
  private _allowRotate: boolean;
  private _allowScale: boolean;
  private _gridSteps: Float32Array<ArrayBuffer>;
  private readonly _gridParams: Vector4;
  private _camera: Camera;
  private _orthoDirection: Nullable<CubeFace>;
  private _orthoAxis: number;
  private _node: Nullable<SceneNode>;
  private _mode: GizmoMode;
  private readonly _axisLength: number;
  private readonly _arrowLength: number;
  private readonly _axisRadius: number;
  private readonly _arrowRadius: number;
  private readonly _boxSize: number;
  private readonly _rectHandleSize: number;
  private _translatePlaneInfo: Nullable<TranslatePlaneInfo>;
  private _rotateInfo: Nullable<RotateInfo>;
  private _scaleInfo: Nullable<ScaleInfo>;
  private _aabbInfo: Nullable<AABBInfo>;
  private _rectInfo: Nullable<RectInfo>;
  private _hitInfo: Nullable<GizmoHitInfo>;
  private readonly _screenSize: number;
  private _drawGrid: boolean;
  private readonly _scaleBox: AABB;
  private readonly _nodeBox: AABB;
  private readonly _rectHandles: number[][];
  private readonly _rectHandlePositions: Vector3[];
  /**
   * Creates an instance of PostGizmoRenderer.
   */
  constructor(camera: Camera, binding = null, size = 15) {
    super();
    this._camera = camera;
    this._orthoDirection = this.determinOrthoDirection(camera);
    this._orthoAxis =
      this._orthoDirection === null
        ? -1
        : this._orthoDirection === CubeFace.PX || this._orthoDirection === CubeFace.NX
          ? 0
          : this._orthoDirection === CubeFace.PY || this._orthoDirection === CubeFace.NY
            ? 1
            : 2;
    this._node = binding;
    this._snapping = 0;
    this._aabbForEdit = null;
    this._allowRotate = true;
    this._allowScale = true;
    this._allowTranslate = true;
    this._axisLength = size;
    this._arrowLength = size * 0.8;
    this._axisRadius = size * 0.02;
    this._arrowRadius = size * 0.06;
    this._boxSize = size * 0.1;
    this._mode = 'none';
    this._translatePlaneInfo = null;
    this._rotateInfo = null;
    this._scaleInfo = null;
    this._aabbInfo = null;
    this._rectInfo = null;
    this._hitInfo = null;
    this._screenSize = 0.4;
    this._gridParams = new Vector4(10000, 500, 0, 0);
    this._rectHandles = [
      [0, 0],
      [0.5, 0],
      [1, 0],
      [0, 0.5],
      [0, 0],
      [1, 0.5],
      [0, 1],
      [0.5, 1],
      [1, 1]
    ];
    this._rectHandlePositions = this._rectHandles.map(() => new Vector3());
    this._rectHandleSize = 12;
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
  get snapping() {
    return this._snapping;
  }
  set snapping(val) {
    this._snapping = val;
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
      (val === 'scaling' && !this._allowScale) ||
      (val === 'edit-rect' && !this._node?.isSprite())
    ) {
      return;
    }
    if (this._mode !== val) {
      this._endTranslation();
      this._endScale();
      this._endRotate();
      this._endAABB();
      this._endRect();
      this._mode = val;
    }
    if (this._mode !== 'edit-aabb' && this._node && this._node === PostGizmoRenderer._aabbMesh.get()) {
      this.node = null;
    }
  }
  get node() {
    return this._node;
  }
  set node(node) {
    if (node !== this._node) {
      if (this._node === PostGizmoRenderer._aabbMesh.get()) {
        this.endEditAABB(this._aabbForEdit);
      }
      this._node = node;
      if (!this._node?.isSprite() && this._mode === 'edit-rect') {
        this.mode = 'select';
      }
    }
  }
  get camera(): Camera {
    return this._camera;
  }
  set camera(camera: Camera) {
    this._camera = camera;
    this._orthoDirection = this.determinOrthoDirection(camera);
    this._orthoAxis =
      this._orthoDirection === null
        ? -1
        : this._orthoDirection === CubeFace.PX || this._orthoDirection === CubeFace.NX
          ? 0
          : this._orthoDirection === CubeFace.PY || this._orthoDirection === CubeFace.NY
            ? 1
            : 2;
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
  endEditAABB(aabb: AABB) {
    if (aabb && aabb === this._aabbForEdit) {
      PostGizmoRenderer._aabbMesh.get()?.off('transformchanged', this.applyAABBChange, this);
      this._aabbForEdit = null;
      this.node = null;
      this.mode = 'select';
      eventBus.dispatchEvent('scene_changed');
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
      PostGizmoRenderer._aabbMesh.get()!.on('transformchanged', this.applyAABBChange, this);
    }
    const pos = value.minPoint.clone();
    const scale = Vector3.sub(value.maxPoint, value.minPoint);
    PostGizmoRenderer._aabbMesh.get()!.position.set(pos);
    PostGizmoRenderer._aabbMesh.get()!.scale.set(scale);
    this._aabbForEdit = value;
    this.node = PostGizmoRenderer._aabbMesh.get();
    this.mode = 'edit-aabb';
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
    return true;
  }
  /** {@inheritDoc AbstractPostEffect.requireDepthAttachment} */
  requireDepthAttachment(): boolean {
    return true;
  }
  /** {@inheritDoc AbstractPostEffect.apply} */
  apply(ctx: DrawContext, inputColorTexture: Texture2D, sceneDepthTexture: Texture2D, srgbOutput: boolean) {
    this.prepare(ctx.device.type === 'webgpu');
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
      this.renderGrid(ctx, destFramebuffer!.getDepthAttachment()!);
    }
    if (
      this._node &&
      this._mode !== 'none' &&
      !(this._mode === 'rotation' && this._rotateInfo && this._rotateInfo.axis < 0) &&
      !(this._mode === 'edit-aabb' && this._node !== PostGizmoRenderer._aabbMesh.get()) &&
      !(this._mode === 'edit-rect' && !this._node?.isSprite())
    ) {
      if (this._mode === 'edit-aabb') {
        this.renderAABBGizmo(ctx, destFramebuffer!.getDepthAttachment()!);
      } else if (this._mode === 'edit-rect') {
        this.renderSelectSpriteGizmo(ctx, destFramebuffer!.getDepthAttachment()!, 0.5);
        this.renderRectGizmo(ctx, destFramebuffer!.getDepthAttachment()!);
      } else if (this._mode === 'select') {
        if (this._node.isSprite()) {
          this.renderSelectSpriteGizmo(ctx, destFramebuffer!.getDepthAttachment()!);
        } else {
          this.renderSelectGizmo(ctx, destFramebuffer!.getDepthAttachment()!);
        }
      } else {
        this.renderTransformGizmo(ctx, destFramebuffer!.getDepthAttachment()!);
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
    if (this._translatePlaneInfo || this._scaleInfo || this._rotateInfo || this._aabbInfo || this._rectInfo) {
      return;
    }
    if (
      this._mode === 'rotation' ||
      this._mode === 'scaling' ||
      this._mode === 'translation' ||
      this._mode === 'edit-aabb'
    ) {
      const ray = this._camera.constructRay(x, y);
      if (this._mode === 'edit-aabb') {
        this._hitInfo = PostGizmoRenderer._aabbMesh.get()
          ? this.rayIntersectionAABB(ray, PostGizmoRenderer._aabbMesh.get().getWorldBoundingVolume().toAABB())
          : null;
      } else {
        this._hitInfo = this.rayIntersection(ray);
      }
    } else if (this._mode === 'edit-rect') {
      const ndcPos = new Vector3();
      this._hitInfo = null;
      for (let i = 0; i < this._rectHandlePositions.length; i++) {
        this._camera.viewProjectionMatrix.transformPointP(this._rectHandlePositions[i], ndcPos);
        const screenX = (ndcPos.x * 0.5 + 0.5) * this._camera.viewport![2];
        const screenY = (1 - (ndcPos.y * 0.5 + 0.5)) * this._camera.viewport![3];
        const size = this._rectHandleSize >> 1;
        if (Math.abs(x - screenX) <= size && Math.abs(y - screenY) <= size) {
          this._hitInfo = {
            axis: 0,
            coord: i,
            distance: 0,
            type: i === 4 ? 'sprite_anchor' : 'sprite_handle',
            pointLocal: null,
            pointWorld: null
          };
        }
      }
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
      this._endAABB();
      this._endRect();
      return false;
    }
    if (
      this._mode === 'rotation' ||
      this._mode === 'scaling' ||
      this._mode === 'translation' ||
      (this._mode === 'edit-aabb' && this._aabbForEdit) ||
      (this._mode === 'edit-rect' && this._node?.isSprite())
    ) {
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
          if (this._mode === 'edit-aabb' && !this._aabbInfo) {
            this._beginAABB(x, y, this._hitInfo.axis as CubeFace, this._hitInfo.pointLocal);
            return true;
          }
          if (this._mode === 'edit-rect' && !this._rectInfo) {
            this._beginRect(x, y, this._hitInfo.type!, this._hitInfo.coord);
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
        if (this._mode === 'edit-aabb' && this._aabbInfo) {
          this._updateAABB(x, y);
          return true;
        }
        if (this._mode === 'edit-rect' && this._rectInfo) {
          this._updateRect(x, y);
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
        if (this._mode === 'edit-aabb' && this._aabbInfo) {
          this._endAABB();
          return true;
        }
        if (this._mode === 'edit-rect' && this._rectInfo) {
          this._endRect();
          return true;
        }
      }
    }
    return false;
  }
  /** Ray intersection with AABB */
  rayIntersectionAABB(ray: Ray, aabb: AABB): Nullable<GizmoHitInfo> {
    const axisInfo = { axis: undefined };
    const distance = ray.bboxIntersectionTestEx(aabb, axisInfo);
    if (distance !== null) {
      const point = Vector3.add(ray.origin, Vector3.scale(ray.direction, distance));
      const axis = axisInfo.axis;
      const coord = distance;
      return {
        axis,
        coord,
        distance,
        pointLocal: point,
        pointWorld: point
      };
    }
    return null;
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
      const d =
        this._orthoAxis < 0 || this._mode === 'scaling'
          ? rayLocal.bboxIntersectionTestEx(this._scaleBox)
          : null;
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
        if (this._orthoAxis < 0 || axis === this._orthoAxis) {
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
    return { intersectedPoint: Vector3.add(Q, Vector3.scale(V, t)), distance: t };
  }
  private _beginRotate(startX: number, startY: number, axis: number, hitPosition: Vector3) {
    this._endTranslation();
    this._endScale();
    this._endAABB();
    this._endRect();
    getDevice().canvas.style.cursor = 'grab';
    const center = new Vector3();
    this._node!.worldMatrix.decompose(null, null, center);
    this._camera.viewProjectionMatrix.transformPointP(center, center);
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
  private _beginRect(startX: number, startY: number, type: HitType, coord: number) {
    this._endRotate();
    this._endTranslation();
    this._endScale();
    this._endAABB();
    getDevice().canvas.style.cursor = 'grab';
    const sprite = this._node as Sprite;
    const anchorPosW = new Vector3();
    const ltPosW = new Vector3();
    const rtPosW = new Vector3();
    const lbPosW = new Vector3();
    const rbPosW = new Vector3();
    this.calcSpriteVertexPosition(sprite, this._rectHandles[4][0], this._rectHandles[4][1], anchorPosW);
    this.calcSpriteVertexPosition(sprite, 0, 0, ltPosW);
    this.calcSpriteVertexPosition(sprite, 1, 0, rtPosW);
    this.calcSpriteVertexPosition(sprite, 0, 1, lbPosW);
    this.calcSpriteVertexPosition(sprite, 1, 1, rbPosW);
    const vx = Vector3.sub(rtPosW, ltPosW);
    const width = vx.magnitude;
    const xAxis = vx.scaleBy(1 / width);
    const vy = Vector3.sub(lbPosW, ltPosW);
    const height = vy.magnitude;
    const yAxis = vy.scaleBy(1 / height);
    this._rectInfo = {
      type,
      coord,
      anchorPos: anchorPosW,
      xAxis,
      yAxis,
      width,
      height
    };
  }
  private _updateRect(_x: number, _y: number) {
    const sprite = this._node as Sprite;
    const handle = this._rectHandles[this._rectInfo.coord];

    const ndcX = (_x / this._camera.viewport![2]) * 2 - 1;
    const ndcY = 1 - (_y / this._camera.viewport![3]) * 2;
    const worldPos = this._camera.invViewProjectionMatrix.transformPointP(new Vector3(ndcX, ndcY, 0));

    if (this._rectInfo.coord === 4) {
      const lt = this.calcSpriteVertexPosition(sprite, 0, 0);
      const rt = this.calcSpriteVertexPosition(sprite, 1, 0);
      const lb = this.calcSpriteVertexPosition(sprite, 0, 1);
      const width = Vector3.distance(lt, rt);
      const height = Vector3.distance(lt, lb);
      const deltaX = Vector3.dot(Vector3.sub(worldPos, lt), this._rectInfo.xAxis);
      const deltaY = Vector3.dot(Vector3.sub(worldPos, lt), this._rectInfo.yAxis);
      sprite.anchorX = deltaX / width;
      sprite.anchorY = deltaY / height;
      sprite.position.x = worldPos.x - sprite.parent.getWorldPosition().x;
      sprite.position.y = worldPos.y - sprite.parent.getWorldPosition().y;
      return;
    }

    const resizeX = handle[0] !== 0.5 && this._rectInfo.coord !== 4;
    const resizeY = handle[1] !== 0.5 && this._rectInfo.coord !== 4;
    if (resizeX) {
      const wPositions = this._rectHandles.map((p) => this.calcSpriteVertexPosition(sprite, p[0], p[1]));
      const delta = Vector3.dot(
        Vector3.sub(worldPos, wPositions[this._rectInfo.coord]),
        this._rectInfo.xAxis
      );
      const left =
        handle[0] === 0
          ? Vector3.add(wPositions[0], Vector3.scale(this._rectInfo.xAxis, delta))
          : wPositions[0];
      const right =
        handle[0] === 1
          ? Vector3.add(wPositions[2], Vector3.scale(this._rectInfo.xAxis, delta))
          : wPositions[2];
      const width = Vector3.distance(wPositions[0], wPositions[2]);
      const newWidth = Vector3.distance(left, right);
      const height = Vector3.distance(wPositions[0], wPositions[6]);
      const scaleX = width > 1e-6 ? newWidth / width : 1;
      sprite.scale.x *= scaleX;

      const anchor = Vector3.add(
        Vector3.add(left, Vector3.scale(this._rectInfo.xAxis, newWidth * sprite.anchorX)),
        Vector3.scale(this._rectInfo.yAxis, height * sprite.anchorY)
      );
      sprite.position.x = anchor.x - sprite.parent.getWorldPosition().x;
      sprite.position.y = anchor.y - sprite.parent.getWorldPosition().y;
    }
    if (resizeY) {
      const wPositions = this._rectHandles.map((p) => this.calcSpriteVertexPosition(sprite, p[0], p[1]));
      const delta = Vector3.dot(
        Vector3.sub(worldPos, wPositions[this._rectInfo.coord]),
        this._rectInfo.yAxis
      );
      const top =
        handle[1] === 0
          ? Vector3.add(wPositions[0], Vector3.scale(this._rectInfo.yAxis, delta))
          : wPositions[0];
      const bottom =
        handle[1] === 1
          ? Vector3.add(wPositions[6], Vector3.scale(this._rectInfo.yAxis, delta))
          : wPositions[6];
      const width = Vector3.distance(wPositions[0], wPositions[2]);
      const height = Vector3.distance(wPositions[0], wPositions[6]);
      const newHeight = Vector3.distance(top, bottom);
      const scaleY = height > 1e-6 ? newHeight / height : 1;
      sprite.scale.y *= scaleY;

      const anchor = Vector3.add(
        Vector3.add(top, Vector3.scale(this._rectInfo.xAxis, width * sprite.anchorX)),
        Vector3.scale(this._rectInfo.yAxis, newHeight * sprite.anchorY)
      );
      sprite.position.x = anchor.x - sprite.parent.getWorldPosition().x;
      sprite.position.y = anchor.y - sprite.parent.getWorldPosition().y;
    }
  }
  private _endRect() {
    getDevice().canvas.style.cursor = 'default';
    this._rectInfo = null;
  }
  private _beginAABB(startX: number, startY: number, axis: CubeFace, pointLocal: Vector3) {
    this._endTranslation();
    this._endRotate();
    this._endScale();
    this._endRect();
    getDevice().canvas.style.cursor = 'grab';
    const ray = this._camera.constructRay(startX, startY);
    const v = Vector3.abs(Vector3.sub(pointLocal, ray.origin));
    const n =
      axis === CubeFace.PX || axis === CubeFace.NX
        ? [1, 2]
        : axis === CubeFace.PY || axis === CubeFace.NY
          ? [0, 2]
          : [0, 1];
    const t = v[n[0]] > v[n[1]] ? n[0] : n[1];
    const normal = new Vector3(t === 0 ? 1 : 0, t === 1 ? 1 : 0, t === 2 ? 1 : 0);
    this._aabbInfo = {
      axis: axis,
      pointOnPlane: pointLocal,
      planeNormal: normal
    };
  }
  private _updateAABB(x: number, y: number) {
    const ray = this._camera.constructRay(x, y);
    const hit = this.rayPlaneIntersection(
      this._aabbInfo.pointOnPlane,
      this._aabbInfo.planeNormal,
      ray.origin,
      ray.direction
    );
    const aabbMesh = PostGizmoRenderer._aabbMesh.get();
    if (aabbMesh) {
      const aabb = aabbMesh.getWorldBoundingVolume().toAABB();
      switch (this._aabbInfo.axis) {
        case CubeFace.PX: {
          aabbMesh.scale.x = Math.max(0, hit.intersectedPoint.x - aabb.minPoint.x);
          break;
        }
        case CubeFace.NX: {
          aabbMesh.scale.x = Math.max(0, aabb.maxPoint.x - hit.intersectedPoint.x);
          aabbMesh.position.x = Math.min(aabb.maxPoint.x, hit.intersectedPoint.x);
          break;
        }
        case CubeFace.PY: {
          aabbMesh.scale.y = Math.max(0, hit.intersectedPoint.y - aabb.minPoint.y);
          break;
        }
        case CubeFace.NY: {
          aabbMesh.scale.y = Math.max(0, aabb.maxPoint.y - hit.intersectedPoint.y);
          aabbMesh.position.y = Math.min(aabb.maxPoint.y, hit.intersectedPoint.y);
          break;
        }
        case CubeFace.PZ: {
          aabbMesh.scale.z = Math.max(0, hit.intersectedPoint.z - aabb.minPoint.z);
          break;
        }
        case CubeFace.NZ: {
          aabbMesh.scale.z = Math.max(0, aabb.maxPoint.z - hit.intersectedPoint.z);
          aabbMesh.position.z = Math.min(aabb.maxPoint.z, hit.intersectedPoint.z);
          break;
        }
      }
    }
  }
  private _endAABB() {
    getDevice().canvas.style.cursor = 'default';
    this._aabbInfo = null;
  }
  private _beginScale(startX: number, startY: number, axis: number, type: HitType, pointLocal: Vector3) {
    this._endRotate();
    this._endTranslation();
    this._endAABB();
    this._endRect();
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
    this._endAABB();
    this._endRect();
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
    } else {
      const ray = this._camera.constructRay(x, y);
      const worldMatrix = this._calcGizmoWorldMatrix(this._mode, true);
      const invWorldMatrix = Matrix4x4.invertAffine(worldMatrix);
      const rayLocal = ray.transform(invWorldMatrix);
      if (Math.abs(rayLocal.direction[this._translatePlaneInfo.planeAxis]) > 0.0001) {
        const t = ['x', 'y', 'z'];
        const c = t[this._translatePlaneInfo.axis];
        t.splice(this._translatePlaneInfo.planeAxis, 1);
        const d =
          (0 - rayLocal.origin[this._translatePlaneInfo.planeAxis]) /
          rayLocal.direction[this._translatePlaneInfo.planeAxis];
        const p = Vector3.add(rayLocal.origin, Vector3.scale(rayLocal.direction, d));
        if (this._translatePlaneInfo.type === 'move_axis') {
          const delta =
            p[this._translatePlaneInfo.axis] -
            this._translatePlaneInfo.lastPlanePos[this._translatePlaneInfo.axis];
          this._node!.position[c] += delta;
        } else {
          const dx = p[t[0]] - this._translatePlaneInfo.lastPlanePos[t[0]];
          const dy = p[t[1]] - this._translatePlaneInfo.lastPlanePos[t[1]];
          this._node!.position[t[0]] += dx;
          this._node!.position[t[1]] += dy;
        }
      }
    }
    this.snapToGrid(this._node!, this._snapping);
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
    matrix = this._calcGizmoWorldMatrix(mode, noScale || this._mode === 'edit-aabb', matrix);
    return matrix.multiplyLeft(this._camera.viewProjectionMatrix);
  }
  private _calcGizmoWorldMatrix(mode: GizmoMode, noScale: boolean, matrix?: Matrix4x4) {
    matrix = matrix ?? new Matrix4x4();
    if (this._node) {
      if (mode === 'select') {
        calcHierarchyBoundingBoxWorld(this._node, this._nodeBox);
        const scale = Vector3.sub(this._nodeBox.maxPoint, this._nodeBox.minPoint);
        matrix.scaling(scale).translateLeft(this._nodeBox.minPoint);
      } else {
        if (this._mode === 'edit-aabb') {
          matrix.set(this._node.worldMatrix);
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
              const projWidth = Math.abs(projMatrix.getRightPlane() - projMatrix.getLeftPlane());
              const projHeight = Math.abs(projMatrix.getBottomPlane() - projMatrix.getTopPlane());
              const scaleY = (this._screenSize * projHeight) / (2 * this._axisLength);
              const vpWidth = this._camera.viewport
                ? this._camera.viewport[2]
                : getDevice().getDrawingBufferWidth();
              const vpHeight = this._camera.viewport
                ? this._camera.viewport[3]
                : getDevice().getDrawingBufferHeight();
              const scaleX = scaleY * (vpHeight / vpWidth) * (projWidth / projHeight);
              matrix.scaling(new Vector3(scaleX, scaleY, scaleY)).translateLeft(tmpVecT);
            }
          }
        }
      }
    } else {
      matrix.identity();
    }
    return matrix;
  }
  private _createGizmoRenderStates(flip: boolean) {
    const rs = getDevice().createRenderStateSet();
    rs.useDepthState().enableTest(true).enableWrite(true);
    if (flip) {
      rs.useRasterizerState().setCullMode('front');
    }
    return rs;
  }
  private _createGridRenderStates() {
    const rs = getDevice().createRenderStateSet();
    rs.useDepthState().enableTest(true).enableWrite(false).setCompareFunc('le');
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
  private _createAABBRenderStates(flip: boolean) {
    const rs = getDevice().createRenderStateSet();
    rs.useDepthState().enableTest(true).enableWrite(true);
    if (flip) {
      rs.useRasterizerState().setCullMode('front');
    }
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
        this.viewMatrix = pb.mat4().uniform(0);
        this.viewProjMatrix = pb.mat4().uniform(0);
        this.invViewProjMatrix = pb.mat4().uniform(0);
        this.projMatrix = pb.mat4().uniform(0);
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
            this.$l.vertexId = this.$inputs.pos.x;
            this.$l.origin = pb.mul(this.invViewProjMatrix, pb.vec4(0, 0, 1, 1));
            this.$l.forward = pb.vec3(this.viewMatrix[0].z, this.viewMatrix[1].z, this.viewMatrix[2].z);
            this.$l.axis = this.$choice(
              pb.lessThan(pb.abs(this.forward.y), 0.999),
              pb.vec3(0, 1, 0),
              pb.vec3(1, 0, 0)
            );
            this.$l.right = pb.normalize(pb.cross(this.axis, this.forward));
            this.$l.up = pb.normalize(pb.cross(this.forward, this.right));
            this.$l.viewSize = pb.max(
              pb.abs(pb.div(2, this.projMatrix[0].x)),
              pb.abs(pb.div(2, this.projMatrix[1].y))
            );
            this.$l.v = pb.vec2();
            this.$if(pb.equal(this.vertexId, 0), function () {
              this.v = pb.vec2(-0.5, -0.5);
            })
              .$elseif(pb.equal(this.vertexId, 1), function () {
                this.v = pb.vec2(0.5, -0.5);
              })
              .$elseif(pb.equal(this.vertexId, 2), function () {
                this.v = pb.vec2(-0.5, 0.5);
              })
              .$else(function () {
                this.v = pb.vec2(0.5, 0.5);
              });
            this.v = pb.mul(this.v, this.viewSize);
            this.worldPos = pb.add(
              pb.div(this.origin.xyz, this.origin.w),
              pb.mul(this.right, this.v.x),
              pb.mul(this.up, this.v.y)
            );
            this.$outputs.worldPos = this.worldPos;
          });
          this.$builtins.position = pb.mul(this.viewProjMatrix, pb.vec4(this.$outputs.worldPos, 1));
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
              this.fade = 1;
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
            if (!selectMode) {
              this.alpha = pb.mul(this.alpha, this.$inputs.color.a);
            }
          }
          const diffuse = selectMode ? pb.vec3(0, 255, 204) : this.$inputs.color.rgb;
          this.$outputs.color = pb.vec4(pb.mul(diffuse, this.alpha), this.alpha);
        });
      }
    });
  }
  private snapToGrid(node: SceneNode, gridSize: number) {
    if (gridSize > 0) {
      const pos = node.getWorldPosition();
      pos.x = Math.round(pos.x / gridSize) * gridSize;
      pos.y = Math.round(pos.y / gridSize) * gridSize;
      pos.z = Math.round(pos.z / gridSize) * gridSize;
      node.parent.worldToThis(pos, pos);
      node.position.set(pos);
    }
  }
  private determinOrthoDirection(camera: Camera): Nullable<CubeFace> {
    if (!camera.isOrtho()) {
      return null;
    }
    const viewMatrix = camera.viewMatrix;
    const forwardX = viewMatrix[2];
    const forwardY = viewMatrix[6];
    const forwardZ = viewMatrix[10];
    if (forwardX === 0 && forwardY === 0) {
      return forwardZ > 0 ? CubeFace.PZ : CubeFace.NZ;
    }
    if (forwardX === 0 && forwardZ === 0) {
      return forwardY > 0 ? CubeFace.PY : CubeFace.NY;
    }
    if (forwardY === 0 && forwardZ === 0) {
      return forwardX > 0 ? CubeFace.PX : CubeFace.NX;
    }
    return null;
  }
  private prepare(flip: boolean) {
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
    if (!PostGizmoRenderer._gridPrimitiveOrtho) {
      PostGizmoRenderer._gridPrimitiveOrtho = new Primitive();
      PostGizmoRenderer._gridPrimitiveOrtho.createAndSetVertexBuffer(
        'position_f32x3',
        new Float32Array([0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3])
      );
      PostGizmoRenderer._gridPrimitiveOrtho.createAndSetIndexBuffer(new Uint16Array([0, 1, 2, 3]));
      PostGizmoRenderer._gridPrimitiveOrtho.primitiveType = 'triangle-strip';
    }
    if (!PostGizmoRenderer._gizmoSelectProgram) {
      PostGizmoRenderer._gizmoSelectProgram = this._createAxisProgram(true);
    }
    if (!PostGizmoRenderer._gizmoProgram) {
      PostGizmoRenderer._gizmoProgram = this._createAxisProgram(false);
      PostGizmoRenderer._gizmoRenderState = this._createGizmoRenderStates(flip);
      PostGizmoRenderer._blendRenderState = this._createBlendRenderStates();
      PostGizmoRenderer._aabbRenderState = this._createAABBRenderStates(flip);
      PostGizmoRenderer._bindGroup = getDevice().createBindGroup(
        PostGizmoRenderer._gizmoProgram.bindGroupLayouts[0]
      );
    }
    if (!PostGizmoRenderer._primitives) {
      PostGizmoRenderer._primitives = {
        translation: [
          createTranslationGizmo(
            this._axisLength,
            this._axisRadius,
            this._arrowLength,
            this._arrowRadius,
            this._boxSize,
            null
          ),
          ...[CubeFace.PX, CubeFace.NX, CubeFace.PY, CubeFace.NY, CubeFace.PZ, CubeFace.NZ].map((direction) =>
            createTranslationGizmo(
              this._axisLength,
              this._axisRadius,
              this._arrowLength,
              this._arrowRadius,
              this._boxSize,
              direction
            )
          )
        ],
        rotation: [
          createRotationGizmo(this._axisLength, this._axisRadius, null),
          ...[CubeFace.PX, CubeFace.NX, CubeFace.PY, CubeFace.NY, CubeFace.PZ, CubeFace.NZ].map((direction) =>
            createRotationGizmo(this._axisLength, this._axisRadius, direction)
          )
        ],
        scaling: [
          createScaleGizmo(this._axisLength, this._axisRadius, this._boxSize, null),
          ...[CubeFace.PX, CubeFace.NX, CubeFace.PY, CubeFace.NY, CubeFace.PZ, CubeFace.NZ].map((direction) =>
            createScaleGizmo(this._axisLength, this._axisRadius, this._boxSize, direction)
          )
        ],
        'edit-aabb': [createEditAABBGizmo()],
        'edit-rect': [createScaleWithHandleGizmo(1)],
        select: [createSelectGizmo()]
      };
    }
  }
  private applyAABBChange() {
    const aabbMesh = PostGizmoRenderer._aabbMesh.get();
    if (aabbMesh) {
      const aabb = aabbMesh.getWorldBoundingVolume().toAABB();
      if (this._aabbForEdit) {
        this._aabbForEdit.minPoint.set(aabb.minPoint);
        this._aabbForEdit.maxPoint.set(aabb.maxPoint);
      }
    }
  }
  private renderGrid(ctx: DrawContext, depthTex: BaseTexture) {
    this._gridParams.z = ctx.camera.isPerspective() ? 1 : 0;
    ctx.device.setRenderStates(PostGizmoRenderer._gridRenderState);
    PostGizmoRenderer._gridBindGroup!.setValue('viewMatrixInv', ctx.camera.worldMatrix);
    PostGizmoRenderer._gridBindGroup!.setValue('viewMatrix', ctx.camera.viewMatrix);
    PostGizmoRenderer._gridBindGroup!.setValue('invViewProjMatrix', ctx.camera.invViewProjectionMatrix);
    PostGizmoRenderer._gridBindGroup!.setValue('projMatrix', ctx.camera.getProjectionMatrix());
    PostGizmoRenderer._gridBindGroup!.setValue('cameraPos', ctx.camera.getWorldPosition());
    PostGizmoRenderer._gridBindGroup!.setValue('params', this._gridParams);
    PostGizmoRenderer._gridBindGroup!.setValue('steps', this._gridSteps);
    PostGizmoRenderer._gridBindGroup!.setValue('viewProjMatrix', ctx.camera.viewProjectionMatrix);
    PostGizmoRenderer._gridBindGroup!.setValue('texSize', PostGizmoRenderer._texSize);
    PostGizmoRenderer._gridBindGroup.setTexture('depthTex', depthTex, fetchSampler('clamp_nearest_nomip'));
    PostGizmoRenderer._gridBindGroup!.setValue('cameraNearFar', PostGizmoRenderer._cameraNearFar);
    PostGizmoRenderer._gridBindGroup!.setValue('flip', this.needFlip(ctx.device) ? -1 : 1);
    ctx.device.setProgram(PostGizmoRenderer._gridProgram);
    ctx.device.setBindGroup(0, PostGizmoRenderer._gridBindGroup!);
    const gridPrimitive = ctx.camera.isOrtho()
      ? PostGizmoRenderer._gridPrimitiveOrtho!
      : PostGizmoRenderer._gridPrimitive!;
    gridPrimitive.draw();
    if (ctx.camera.isOrtho()) {
      this.renderOrthoCoords(ctx);
    }
  }
  private renderOrthoCoords(ctx: DrawContext) {
    const projMatrix = ctx.camera.getProjectionMatrix();
    const vpMatrix = ctx.camera.viewProjectionMatrix;
    const cameraPos = ctx.camera.getWorldPosition();
    const left = projMatrix.getLeftPlane() + cameraPos.x;
    const right = projMatrix.getRightPlane() + cameraPos.x;
    const bottom = projMatrix.getBottomPlane() + cameraPos.y;
    const top = projMatrix.getTopPlane() + cameraPos.y;

    const planeNormal = ctx.camera.worldMatrix.getRow(2).xyz().inplaceNormalize();
    const planeD = -Vector3.dot(planeNormal, cameraPos);
    const origin = Vector3.scale(planeNormal, -planeD);
    const rightAxis = ctx.camera.worldMatrix.getRow(0).xyz().inplaceNormalize();
    const upAxis = ctx.camera.worldMatrix.getRow(1).xyz().inplaceNormalize();

    const minX = left < right ? left : right;
    const maxX = left < right ? right : left;
    const sizeX = Math.pow(
      10,
      Math.max(0, Math.round(Math.log10(((maxX - minX) * 100) / ctx.camera.viewport[2])))
    );
    const startX = Math.floor(minX / sizeX) * sizeX;
    const stopX = Math.ceil(maxX / sizeX) * sizeX;
    for (let x = startX; x < stopX; x += sizeX) {
      const v = Vector3.add(origin, Vector3.scale(rightAxis, x));
      const ndc = vpMatrix.transformPointP(v /*new Vector3(x, top, 0)*/);
      const screenX = (ndc.x * 0.5 + 0.5) * ctx.renderWidth + 2;
      const screenY = 2;
      ctx.device.drawText(String(x), screenX, screenY, '#ffa0a0');
    }

    const minY = bottom < top ? bottom : top;
    const maxY = bottom < top ? top : bottom;
    const sizeY = Math.pow(
      10,
      Math.max(0, Math.round(Math.log10(((maxY - minY) * 100) / ctx.camera.viewport[3])))
    );
    const startY = Math.floor(minY / sizeY) * sizeY;
    const stopY = Math.ceil(maxY / sizeY) * sizeY;
    for (let y = startY; y < stopY; y += sizeY) {
      const v = Vector3.add(origin, Vector3.scale(upAxis, y));
      const ndc = vpMatrix.transformPointP(v /*new Vector3(left, y, 0)*/);
      const screenX = 2;
      const screenY = (0.5 - ndc.y * 0.5) * ctx.renderHeight + 2;
      ctx.device.drawText(String(y), screenX, screenY, '#a0a0ff');
    }
  }
  private renderRectGizmo(ctx: DrawContext, depthTex: BaseTexture) {
    ctx.device.setRenderStates(PostGizmoRenderer._gizmoRenderState);
    PostGizmoRenderer._bindGroup!.setValue('flip', this.needFlip(ctx.device) ? -1 : 1);
    PostGizmoRenderer._bindGroup!.setValue('texSize', PostGizmoRenderer._texSize);
    PostGizmoRenderer._bindGroup!.setValue('cameraNearFar', PostGizmoRenderer._cameraNearFar);
    PostGizmoRenderer._bindGroup!.setValue('time', (ctx.device.frameInfo.elapsedOverall % 1000) * 0.001);
    PostGizmoRenderer._bindGroup!.setValue('axisMode', 0);
    PostGizmoRenderer._bindGroup!.setTexture('depthTex', depthTex, fetchSampler('clamp_nearest_nomip'));
    ctx.device.setProgram(PostGizmoRenderer._gizmoProgram);
    ctx.device.setBindGroup(0, PostGizmoRenderer._bindGroup!);
    const sprite = this._node as Sprite;
    const viewport = ctx.device.getViewport();
    const projMatrix = this._camera.getProjectionMatrix();
    const projWidth = Math.abs(projMatrix.getRightPlane() - projMatrix.getLeftPlane());
    const projHeight = Math.abs(projMatrix.getBottomPlane() - projMatrix.getTopPlane());
    this._rectHandles[4][0] = sprite.anchorX;
    this._rectHandles[4][1] = sprite.anchorY;
    for (let i = 0; i < this._rectHandles.length; i++) {
      const p = this._rectHandles[i];
      const v = this._rectHandlePositions[i];
      this.calcSpriteVertexPosition(sprite, p[0], p[1], v);
      const scaleY = (this._rectHandleSize / 2 / viewport.height) * projHeight;
      const scaleX = scaleY * (viewport.height / viewport.width) * (projWidth / projHeight);
      PostGizmoRenderer._mvpMatrix
        .scalingXYZ(scaleX, scaleY, 0)
        .translateLeft(v)
        .multiplyLeft(this._camera.viewProjectionMatrix);
      PostGizmoRenderer._bindGroup!.setValue('mvpMatrix', PostGizmoRenderer._mvpMatrix);
      PostGizmoRenderer._primitives!['edit-rect'][0]!.draw();
    }
  }
  private renderTransformGizmo(ctx: DrawContext, depthTex: BaseTexture) {
    ctx.device.setRenderStates(PostGizmoRenderer._gizmoRenderState);
    PostGizmoRenderer._bindGroup!.setValue('mvpMatrix', PostGizmoRenderer._mvpMatrix);
    PostGizmoRenderer._bindGroup!.setValue('flip', this.needFlip(ctx.device) ? -1 : 1);
    PostGizmoRenderer._bindGroup!.setValue('texSize', PostGizmoRenderer._texSize);
    PostGizmoRenderer._bindGroup!.setValue('cameraNearFar', PostGizmoRenderer._cameraNearFar);
    PostGizmoRenderer._bindGroup!.setValue('time', (ctx.device.frameInfo.elapsedOverall % 1000) * 0.001);
    PostGizmoRenderer._bindGroup!.setValue('axisMode', 0);
    PostGizmoRenderer._bindGroup!.setTexture('depthTex', depthTex, fetchSampler('clamp_nearest_nomip'));
    if (this._hitInfo) {
      if (
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
      }
    }
    ctx.device.setProgram(PostGizmoRenderer._gizmoProgram);
    ctx.device.setBindGroup(0, PostGizmoRenderer._bindGroup!);
    (this._orthoDirection === null
      ? PostGizmoRenderer._primitives![this._mode][0]!
      : PostGizmoRenderer._primitives![this._mode][this._orthoDirection + 1]!
    ).draw();
  }
  private renderSelectSpriteGizmo(ctx: DrawContext, depthTex: BaseTexture, lineWidth?: number) {
    ctx.device.setRenderStates(PostGizmoRenderer._blendRenderState);
    const points: number[][] = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1]
    ];
    const viewport = ctx.device.getViewport();
    const sprite = this._node as Sprite;
    const vpMatrix = this._camera.viewProjectionMatrix;
    const ndcPoints = points.map((point) => {
      const v = new Vector3();
      this.calcSpriteVertexPosition(sprite, point[0], point[1], v);
      return vpMatrix.transformPoint(v);
    });
    for (let i = 0; i < 4; i++) {
      const A = ndcPoints[i];
      const B = ndcPoints[(i + 1) % 4];
      this.renderAALine(
        A.x,
        A.y,
        A.z,
        A.w,
        B.x,
        B.y,
        B.z,
        B.w,
        lineWidth ?? selectLineWidth2D,
        selectLineColor2D,
        ctx.device.screenXToDevice(viewport.width),
        ctx.device.screenYToDevice(viewport.height),
        depthTex
      );
    }
  }
  private renderSelectGizmo(ctx: DrawContext, depthTex: BaseTexture) {
    ctx.device.setRenderStates(PostGizmoRenderer._blendRenderState);
    const points: number[][] = [
      [0, 0, 0],
      [1, 0, 0],
      [1, 0, 1],
      [0, 0, 1],
      [0, 1, 0],
      [1, 1, 0],
      [1, 1, 1],
      [0, 1, 1]
    ];
    const lines: number[][] = [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 0],
      [4, 5],
      [5, 6],
      [6, 7],
      [7, 4],
      [0, 4],
      [1, 5],
      [2, 6],
      [3, 7]
    ];
    const viewport = ctx.device.getViewport();
    const ndcPoints = points.map((point) => {
      const v = new Vector3(point[0], point[1], point[2]);
      return PostGizmoRenderer._mvpMatrix.transformPoint(v);
    });
    for (const line of lines) {
      const A = ndcPoints[line[0]];
      const B = ndcPoints[line[1]];
      this.renderAALine(
        A.x,
        A.y,
        A.z,
        A.w,
        B.x,
        B.y,
        B.z,
        B.w,
        selectLineWidth3D,
        selectLineColor3D,
        ctx.device.screenXToDevice(viewport.width),
        ctx.device.screenYToDevice(viewport.height),
        depthTex
      );
    }
    /*
    ctx.device.setRenderStates(PostGizmoRenderer._blendRenderState);
    PostGizmoRenderer._bindGroup!.setValue('mvpMatrix', PostGizmoRenderer._mvpMatrix);
    PostGizmoRenderer._bindGroup!.setValue('flip', this.needFlip(ctx.device) ? -1 : 1);
    PostGizmoRenderer._bindGroup!.setValue('texSize', PostGizmoRenderer._texSize);
    PostGizmoRenderer._bindGroup!.setValue('cameraNearFar', PostGizmoRenderer._cameraNearFar);
    PostGizmoRenderer._bindGroup!.setValue('time', (ctx.device.frameInfo.elapsedOverall % 1000) * 0.001);
    PostGizmoRenderer._bindGroup!.setValue('axisMode', 0);
    PostGizmoRenderer._bindGroup!.setTexture('depthTex', depthTex, fetchSampler('clamp_nearest_nomip'));
    ctx.device.setProgram(PostGizmoRenderer._gizmoSelectProgram);
    ctx.device.setBindGroup(0, PostGizmoRenderer._bindGroup!);
    PostGizmoRenderer._primitives!['select'][0]!.draw();
    */
  }
  private renderAABBGizmo(ctx: DrawContext, depthTex: BaseTexture) {
    ctx.device.setRenderStates(PostGizmoRenderer._aabbRenderState);
    PostGizmoRenderer._bindGroup!.setValue('mvpMatrix', PostGizmoRenderer._mvpMatrix);
    PostGizmoRenderer._bindGroup!.setValue('flip', this.needFlip(ctx.device) ? -1 : 1);
    PostGizmoRenderer._bindGroup!.setValue('texSize', PostGizmoRenderer._texSize);
    PostGizmoRenderer._bindGroup!.setValue('cameraNearFar', PostGizmoRenderer._cameraNearFar);
    PostGizmoRenderer._bindGroup!.setValue('time', (ctx.device.frameInfo.elapsedOverall % 1000) * 0.001);
    PostGizmoRenderer._bindGroup!.setValue('axisMode', 0);
    PostGizmoRenderer._bindGroup!.setTexture('depthTex', depthTex, fetchSampler('clamp_nearest_nomip'));
    if (this._hitInfo) {
      const axis =
        this._hitInfo.axis === CubeFace.PX || this._hitInfo.axis === CubeFace.NX
          ? 0
          : this._hitInfo.axis === CubeFace.PY || this._hitInfo.axis === CubeFace.NY
            ? 1
            : 2;
      PostGizmoRenderer._bindGroup!.setValue('axisMode', axisList[axis]);
    }
    ctx.device.setProgram(PostGizmoRenderer._gizmoProgram);
    ctx.device.setBindGroup(0, PostGizmoRenderer._bindGroup!);
    PostGizmoRenderer._primitives!['edit-aabb'][0]!.draw();
  }
  private calcSpriteVertexPosition(sprite: BaseSprite<any>, x: number, y: number, outWorldPos?: Vector3) {
    outWorldPos = outWorldPos || new Vector3();
    const worldPos = tmpVecS;
    const forward = tmpVecT;
    const axis = tmpVecR;
    const right = tmpVecQ;
    const up = tmpVecU;
    const rightRot = tmpVecV;
    const upRot = tmpVecW;
    const rotateAngle = -sprite.rotation.toEulerAngles().z;
    const worldMatrix = sprite.worldMatrix;
    const viewMatrix = this._camera.viewMatrix;
    worldPos.setXYZ(worldMatrix[12], worldMatrix[13], worldMatrix[14]);
    const width = Math.hypot(worldMatrix[0], worldMatrix[1], worldMatrix[2]);
    const height = Math.hypot(worldMatrix[4], worldMatrix[5], worldMatrix[6]);
    forward.setXYZ(viewMatrix[2], viewMatrix[6], viewMatrix[10]);
    if (Math.abs(forward.y) < 0.999) {
      axis.setXYZ(0, 1, 0);
    } else {
      axis.setXYZ(1, 0, 0);
    }
    Vector3.cross(axis, forward, right).inplaceNormalize();
    Vector3.cross(forward, right, up).inplaceNormalize();
    const c = Math.cos(rotateAngle);
    const s = Math.sin(rotateAngle);
    Vector3.add(Vector3.scale(up, s), Vector3.scale(right, c), rightRot);
    Vector3.sub(Vector3.scale(up, c), Vector3.scale(right, s), upRot);
    const vx = (x - sprite.anchorX) * width;
    const vy = (y - sprite.anchorY) * height;
    Vector3.add(
      Vector3.add(worldPos, Vector3.scale(rightRot, vx), outWorldPos),
      Vector3.scale(upRot, vy),
      outWorldPos
    );
    return outWorldPos;
  }
  protected renderAALine(
    clipX1: number,
    clipY1: number,
    clipZ1: number,
    clipW1: number,
    clipX2: number,
    clipY2: number,
    clipZ2: number,
    clipW2: number,
    pxWidth: number,
    lineColor: Vector4,
    viewportWidth: number,
    viewportHeight: number,
    depthTex: BaseTexture
  ) {
    const device = getDevice();
    const EPS_W = 1e-4;
    function ndc2screen(ndcX: number, ndcY: number, vpWidth: number, vpHeight: number) {
      return [(ndcX + 1) * 0.5 * vpWidth, (ndcY + 1) * 0.5 * vpHeight] as const;
    }
    function screen2ndc(pxX: number, pxY: number, vpWidth: number, vpHeight: number) {
      return [(pxX / vpWidth) * 2 - 1, (pxY / vpHeight) * 2 - 1] as const;
    }

    // Clip to w > EPS_W
    function clipToPositiveW(
      ax: number,
      ay: number,
      az: number,
      aw: number,
      bx: number,
      by: number,
      bz: number,
      bw: number
    ): [number, number, number, number, number, number, number, number] | null {
      const aBad = aw <= EPS_W;
      const bBad = bw <= EPS_W;

      if (aBad && bBad) {
        return null;
      }
      if (!aBad && !bBad) {
        return [ax, ay, az, aw, bx, by, bz, bw];
      }

      const t = (EPS_W - aw) / (bw - aw); // solve aw + t(bw-aw) = EPS_W
      const ix = ax + t * (bx - ax);
      const iy = ay + t * (by - ay);
      const iz = az + t * (bz - az);
      const iw = EPS_W;

      return aBad ? [ix, iy, iz, iw, bx, by, bz, bw] : [ax, ay, az, aw, ix, iy, iz, iw];
    }

    // Clip to -w <= z <= w
    function clipZToClipVolumeGL(
      ax: number,
      ay: number,
      az: number,
      aw: number,
      bx: number,
      by: number,
      bz: number,
      bw: number
    ): [number, number, number, number, number, number, number, number] | null {
      let x0 = ax,
        y0 = ay,
        z0 = az,
        w0 = aw;
      let x1 = bx,
        y1 = by,
        z1 = bz,
        w1 = bw;

      // 线性不等式： z + w >= 0  (near) 以及  w - z >= 0 (far)
      // 用 Liang-Barsky 思路在参数 t 上裁剪
      let t0 = 0;
      let t1p = 1;

      const dx = x1 - x0;
      const dy = y1 - y0;
      const dz = z1 - z0;
      const dw = w1 - w0;

      function clipTest(p: number, q: number) {
        // p * t <= q
        if (Math.abs(p) < 1e-12) {
          return q >= 0;
        }
        const r = q / p;
        if (p < 0) {
          if (r > t1p) {
            return false;
          }
          if (r > t0) {
            t0 = r;
          }
        } else {
          if (r < t0) {
            return false;
          }
          if (r < t1p) {
            t1p = r;
          }
        }
        return true;
      }

      // near: z + w >= 0  => -(dz+dw) * t <= z0 + w0
      if (!clipTest(-(dz + dw), z0 + w0)) {
        return null;
      }
      // far:  w - z >= 0  => -(dw-dz) * t <= w0 - z0
      if (!clipTest(-(dw - dz), w0 - z0)) {
        return null;
      }

      if (t1p < t0) {
        return null;
      }

      const nx0 = x0 + t0 * dx,
        ny0 = y0 + t0 * dy,
        nz0 = z0 + t0 * dz,
        nw0 = w0 + t0 * dw;
      const nx1 = x0 + t1p * dx,
        ny1 = y0 + t1p * dy,
        nz1 = z0 + t1p * dz,
        nw1 = w0 + t1p * dw;
      return [nx0, ny0, nz0, nw0, nx1, ny1, nz1, nw1];
    }

    // ---- clip w ----
    const wClipped = clipToPositiveW(clipX1, clipY1, clipZ1, clipW1, clipX2, clipY2, clipZ2, clipW2);
    if (!wClipped) {
      return;
    }
    [clipX1, clipY1, clipZ1, clipW1, clipX2, clipY2, clipZ2, clipW2] = wClipped;

    // ---- clip z to GL clip volume ----
    const zClipped = clipZToClipVolumeGL(clipX1, clipY1, clipZ1, clipW1, clipX2, clipY2, clipZ2, clipW2);
    if (!zClipped) {
      return;
    }
    [clipX1, clipY1, clipZ1, clipW1, clipX2, clipY2, clipZ2, clipW2] = zClipped;

    // ---- calculate cliped SDF AB ----
    const ndcX1 = clipX1 / clipW1;
    const ndcY1 = clipY1 / clipW1;
    const ndcX2 = clipX2 / clipW2;
    const ndcY2 = clipY2 / clipW2;

    const [pxX1, pxY1] = ndc2screen(ndcX1, ndcY1, viewportWidth, viewportHeight);
    const [pxX2, pxY2] = ndc2screen(ndcX2, ndcY2, viewportWidth, viewportHeight);

    // ---- calculate normal ----
    const pxDX = pxX2 - pxX1;
    const pxDY = pxY2 - pxY1;
    const pxLenD = Math.hypot(pxDX, pxDY) || 1e-6;
    const pxTX = pxDX / pxLenD;
    const pxTY = pxDY / pxLenD;
    const pxNX = -pxTY;
    const pxNY = pxTX;
    const r = pxWidth * 0.5 + 1;

    const pxUpX1 = pxX1 + r * pxNX;
    const pxUpY1 = pxY1 + r * pxNY;
    const pxDownX1 = pxX1 - r * pxNX;
    const pxDownY1 = pxY1 - r * pxNY;

    const pxUpX2 = pxX2 + r * pxNX;
    const pxUpY2 = pxY2 + r * pxNY;
    const pxDownX2 = pxX2 - r * pxNX;
    const pxDownY2 = pxY2 - r * pxNY;

    const [ndcUpX1, ndcUpY1] = screen2ndc(pxUpX1, pxUpY1, viewportWidth, viewportHeight);
    const [ndcDownX1, ndcDownY1] = screen2ndc(pxDownX1, pxDownY1, viewportWidth, viewportHeight);
    const [ndcUpX2, ndcUpY2] = screen2ndc(pxUpX2, pxUpY2, viewportWidth, viewportHeight);
    const [ndcDownX2, ndcDownY2] = screen2ndc(pxDownX2, pxDownY2, viewportWidth, viewportHeight);

    // ndc to clip space
    const clipUpX1 = ndcUpX1 * clipW1;
    const clipUpY1 = ndcUpY1 * clipW1;
    const clipDownX1 = ndcDownX1 * clipW1;
    const clipDownY1 = ndcDownY1 * clipW1;

    const clipUpX2 = ndcUpX2 * clipW2;
    const clipUpY2 = ndcUpY2 * clipW2;
    const clipDownX2 = ndcDownX2 * clipW2;
    const clipDownY2 = ndcDownY2 * clipW2;

    // ---- init resources ----
    if (!PostGizmoRenderer._aalinePrimitive) {
      PostGizmoRenderer._aalinePrimitive = new Primitive();
      PostGizmoRenderer._aalinePrimitive.createAndSetVertexBuffer('position_f32x4', new Float32Array(4 * 4));
      PostGizmoRenderer._aalinePrimitive.createAndSetVertexBuffer('tex0_f32x4', new Float32Array(4 * 4));
      PostGizmoRenderer._aalinePrimitive.createAndSetIndexBuffer(new Uint16Array([0, 1, 2, 3]));
      PostGizmoRenderer._aalinePrimitive.primitiveType = 'triangle-strip';
    }

    if (!PostGizmoRenderer._aalineProgram) {
      PostGizmoRenderer._aalineProgram = device.buildRenderProgram({
        vertex(pb) {
          this.$inputs.pos = pb.vec4().attrib('position');
          this.$inputs.AB = pb.vec4().attrib('texCoord0');
          pb.main(function () {
            this.$outputs.AB = this.$inputs.AB;
            this.$builtins.position = this.$inputs.pos;
            if (pb.getDevice().type === 'webgpu') {
              this.$builtins.position.y = pb.neg(this.$builtins.position.y);
            }
          });
        },
        fragment(pb) {
          this.pxWidth = pb.float().uniform(0);
          this.lineColor = pb.vec4().uniform(0);
          this.depthTex = pb.tex2D().sampleType('unfilterable-float').uniform(0);
          this.texSize = pb.vec2().uniform(0);
          this.$outputs.color = pb.vec4();

          pb.func('sdSegment', [pb.vec2('p'), pb.vec2('a'), pb.vec2('b')], function () {
            this.$l.ab = pb.sub(this.b, this.a);
            this.$l.ap = pb.sub(this.p, this.a);
            this.$l.t = pb.clamp(pb.div(pb.dot(this.ap, this.ab), pb.dot(this.ab, this.ab)), 0, 1);
            this.$l.closest = pb.add(this.a, pb.mul(this.ab, this.t));
            this.$return(pb.length(pb.sub(this.p, this.closest)));
          });

          pb.main(function () {
            this.$l.P = this.$builtins.fragCoord.xy;
            this.$l.dist = this.sdSegment(this.P, this.$inputs.AB.xy, this.$inputs.AB.zw);
            this.$l.w = pb.fwidth(this.dist);
            this.$l.alpha = pb.sub(
              1,
              pb.smoothStep(pb.sub(this.pxWidth, this.w), pb.add(this.pxWidth, this.w), this.dist)
            );

            this.$l.screenUV = pb.div(this.$builtins.fragCoord.xy, this.texSize);
            this.$l.depth = this.$builtins.fragCoord.z;
            this.$l.sceneDepthSample = pb.textureSampleLevel(this.depthTex, this.screenUV, 0);
            this.$l.sceneDepth = this.sceneDepthSample.r;

            this.$if(pb.greaterThan(this.depth, this.sceneDepth), function () {
              this.alpha = pb.mul(this.alpha, 0.5);
            });

            this.$outputs.color = pb.vec4(
              pb.mul(this.lineColor.rgb, this.alpha),
              pb.mul(this.lineColor.a, this.alpha)
            );
          });
        }
      });

      PostGizmoRenderer._aalineBindGroup = device.createBindGroup(
        PostGizmoRenderer._aalineProgram.bindGroupLayouts[0]
      );
    }

    // ---- upload ----
    const positions = PostGizmoRenderer._aalinePrimitive.getVertexBuffer('position')!;
    if (!PostGizmoRenderer._aalinePositions || PostGizmoRenderer._aalinePositions.length !== 16) {
      PostGizmoRenderer._aalinePositions = new Float32Array(16);
    }
    PostGizmoRenderer._aalinePositions.set([
      clipUpX1,
      clipUpY1,
      clipZ1,
      clipW1,
      clipDownX1,
      clipDownY1,
      clipZ1,
      clipW1,
      clipUpX2,
      clipUpY2,
      clipZ2,
      clipW2,
      clipDownX2,
      clipDownY2,
      clipZ2,
      clipW2
    ]);
    positions.bufferSubData(0, PostGizmoRenderer._aalinePositions);

    const pxAB = PostGizmoRenderer._aalinePrimitive.getVertexBuffer('texCoord0');
    if (!PostGizmoRenderer._aalineAB || PostGizmoRenderer._aalineAB.length !== 16) {
      PostGizmoRenderer._aalineAB = new Float32Array(16);
    }
    PostGizmoRenderer._aalineAB.set([
      pxX1,
      pxY1,
      pxX2,
      pxY2,
      pxX1,
      pxY1,
      pxX2,
      pxY2,
      pxX1,
      pxY1,
      pxX2,
      pxY2,
      pxX1,
      pxY1,
      pxX2,
      pxY2
    ]);
    pxAB.bufferSubData(0, PostGizmoRenderer._aalineAB);

    PostGizmoRenderer._aalineBindGroup.setValue('pxWidth', pxWidth * 0.5);
    PostGizmoRenderer._aalineBindGroup.setValue('lineColor', lineColor);
    PostGizmoRenderer._aalineBindGroup.setValue('texSize', PostGizmoRenderer._texSize);
    PostGizmoRenderer._aalineBindGroup.setTexture('depthTex', depthTex, fetchSampler('clamp_nearest_nomip'));

    device.setProgram(PostGizmoRenderer._aalineProgram);
    device.setBindGroup(0, PostGizmoRenderer._aalineBindGroup);
    device.setRenderStates(PostGizmoRenderer._gizmoRenderState);
    PostGizmoRenderer._aalinePrimitive.draw();
  }
  /*
  protected renderAALine(
    ndcX1: number,
    ndcY1: number,
    ndcZ1: number,
    ndcX2: number,
    ndcY2: number,
    ndcZ2: number,
    pxWidth: number,
    lineColor: Vector4,
    viewportWidth: number,
    viewportHeight: number,
    depthTex: BaseTexture
  ) {
    function ndc2screen(ndcX: number, ndcY: number, vpWidth: number, vpHeight: number) {
      return [(ndcX + 1) * 0.5 * vpWidth, (ndcY + 1) * 0.5 * vpHeight];
    }
    function screen2ndc(pxX: number, pxY: number, vpWidth: number, vpHeight: number) {
      return [(pxX / vpWidth) * 2 - 1, (pxY / vpHeight) * 2 - 1];
    }
    const device = getDevice();
    const [pxX1, pxY1] = ndc2screen(ndcX1, ndcY1, viewportWidth, viewportHeight);
    const [pxX2, pxY2] = ndc2screen(ndcX2, ndcY2, viewportWidth, viewportHeight);
    const pxDX = pxX2 - pxX1;
    const pxDY = pxY2 - pxY1;
    const pxLenD = Math.hypot(pxDX, pxDY) || 1e-6;
    const pxTX = pxDX / pxLenD;
    const pxTY = pxDY / pxLenD;
    const pxNX = -pxTY;
    const pxNY = pxTX;
    const r = pxWidth * 0.5 + 1;
    const pxUpX1 = pxX1 + r * pxNX;
    const pxUpY1 = pxY1 + r * pxNY;
    const pxDownX1 = pxX1 - r * pxNX;
    const pxDownY1 = pxY1 - r * pxNY;
    const pxUpX2 = pxX2 + r * pxNX;
    const pxUpY2 = pxY2 + r * pxNY;
    const pxDownX2 = pxX2 - r * pxNX;
    const pxDownY2 = pxY2 - r * pxNY;
    const [ndcUpX1, ndcUpY1] = screen2ndc(pxUpX1, pxUpY1, viewportWidth, viewportHeight);
    const [ndcDownX1, ndcDownY1] = screen2ndc(pxDownX1, pxDownY1, viewportWidth, viewportHeight);
    const [ndcUpX2, ndcUpY2] = screen2ndc(pxUpX2, pxUpY2, viewportWidth, viewportHeight);
    const [ndcDownX2, ndcDownY2] = screen2ndc(pxDownX2, pxDownY2, viewportWidth, viewportHeight);
    if (!PostGizmoRenderer._aalinePrimitive) {
      PostGizmoRenderer._aalinePrimitive = new Primitive();
      PostGizmoRenderer._aalinePrimitive.createAndSetVertexBuffer('position_f32x3', new Float32Array(3 * 4));
      PostGizmoRenderer._aalinePrimitive.createAndSetVertexBuffer('tex0_f32x4', new Float32Array(4 * 4));
      PostGizmoRenderer._aalinePrimitive.createAndSetIndexBuffer(new Uint16Array([0, 1, 2, 3]));
      PostGizmoRenderer._aalinePrimitive.primitiveType = 'triangle-strip';
    }
    if (!PostGizmoRenderer._aalineProgram) {
      PostGizmoRenderer._aalineProgram = device.buildRenderProgram({
        vertex(pb) {
          this.$inputs.pos = pb.vec3().attrib('position');
          this.$inputs.AB = pb.vec4().attrib('texCoord0');
          pb.main(function () {
            this.$outputs.AB = this.$inputs.AB;
            this.$builtins.position = pb.vec4(this.$inputs.pos, 1);
            if (pb.getDevice().type === 'webgpu') {
              this.$builtins.position.y = pb.neg(this.$builtins.position.y);
            }
          });
        },
        fragment(pb) {
          this.pxWidth = pb.float().uniform(0);
          this.pxWidthAA = pb.float().uniform(0);
          this.lineColor = pb.vec4().uniform(0);
          this.depthTex = pb.tex2D().sampleType('unfilterable-float').uniform(0);
          this.texSize = pb.vec2().uniform(0);
          this.$outputs.color = pb.vec4();
          pb.func('sdSegment', [pb.vec2('p'), pb.vec2('a'), pb.vec2('b')], function () {
            this.$l.ab = pb.sub(this.b, this.a);
            this.$l.ap = pb.sub(this.p, this.a);
            this.$l.t = pb.clamp(pb.div(pb.dot(this.ap, this.ab), pb.dot(this.ab, this.ab)), 0, 1);
            this.$l.closest = pb.add(this.a, pb.mul(this.ab, this.t));
            this.$return(pb.length(pb.sub(this.p, this.closest)));
          });
          pb.main(function () {
            this.$l.pxA = this.$inputs.AB.xy;
            this.$l.pxB = this.$inputs.AB.zw;
            this.$l.P = this.$builtins.fragCoord.xy;
            this.$l.dist = this.sdSegment(this.P, this.$inputs.AB.xy, this.$inputs.AB.zw);
            this.$l.w = pb.fwidth(this.dist);
            this.$l.alpha = pb.sub(
              1,
              pb.smoothStep(pb.sub(this.pxWidth, this.w), pb.add(this.pxWidth, this.w), this.dist)
            );
            this.$l.screenUV = pb.div(pb.vec2(this.$builtins.fragCoord.xy), this.texSize);
            this.$l.depth = this.$builtins.fragCoord.z;
            this.$l.sceneDepthSample = pb.textureSampleLevel(this.depthTex, this.screenUV, 0);
            this.$l.sceneDepth = this.sceneDepthSample.r;
            this.$if(pb.greaterThan(this.depth, this.sceneDepth), function () {
              this.alpha = pb.mul(this.alpha, 0.5);
            });
            this.$outputs.color = pb.vec4(
              pb.mul(this.lineColor.rgb, this.alpha),
              pb.mul(this.lineColor.a, this.alpha)
            );
          });
        }
      });
      PostGizmoRenderer._aalineBindGroup = device.createBindGroup(
        PostGizmoRenderer._aalineProgram.bindGroupLayouts[0]
      );
    }
    const positions = PostGizmoRenderer._aalinePrimitive.getVertexBuffer('position')!;
    PostGizmoRenderer._aalinePositions.set([
      ndcUpX1,
      ndcUpY1,
      ndcZ1 - 0.01,
      ndcDownX1,
      ndcDownY1,
      ndcZ1 - 0.01,
      ndcUpX2,
      ndcUpY2,
      ndcZ2 - 0.01,
      ndcDownX2,
      ndcDownY2,
      ndcZ2 - 0.01
    ]);
    positions.bufferSubData(0, PostGizmoRenderer._aalinePositions);
    const pxAB = PostGizmoRenderer._aalinePrimitive.getVertexBuffer('texCoord0');
    PostGizmoRenderer._aalineAB.set([
      pxX1,
      pxY1,
      pxX2,
      pxY2,
      pxX1,
      pxY1,
      pxX2,
      pxY2,
      pxX1,
      pxY1,
      pxX2,
      pxY2,
      pxX1,
      pxY1,
      pxX2,
      pxY2
    ]);
    pxAB.bufferSubData(0, PostGizmoRenderer._aalineAB);

    PostGizmoRenderer._aalineBindGroup.setValue('pxWidth', pxWidth * 0.5);
    PostGizmoRenderer._aalineBindGroup.setValue('lineColor', lineColor);
    PostGizmoRenderer._aalineBindGroup.setValue('texSize', PostGizmoRenderer._texSize);
    PostGizmoRenderer._aalineBindGroup.setTexture('depthTex', depthTex, fetchSampler('clamp_nearest_nomip'));
    device.setProgram(PostGizmoRenderer._aalineProgram);
    device.setBindGroup(0, PostGizmoRenderer._aalineBindGroup);
    device.setRenderStates(PostGizmoRenderer._gizmoRenderState);
    PostGizmoRenderer._aalinePrimitive.draw();
  }
    */
}
