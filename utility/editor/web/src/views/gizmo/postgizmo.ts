import type {
  BindGroup,
  GPUProgram,
  PBInsideFunctionScope,
  PBShaderExp,
  RenderStateSet,
  Texture2D
} from '@zephyr3d/device';
import type { Camera, DrawContext, Primitive, SceneNode } from '@zephyr3d/scene';
import {
  AbstractPostEffect,
  Application,
  CopyBlitter,
  decodeNormalizedFloatFromRGBA,
  fetchSampler,
  PlaneShape,
  ShaderHelper
} from '@zephyr3d/scene';
import { createTranslationGizmo, createRotationGizmo, createScaleGizmo, createSelectGizmo } from './gizmo';
import type { Ray } from '@zephyr3d/base';
import { AABB, makeEventTarget } from '@zephyr3d/base';
import { Matrix4x4, Quaternion, Vector2, Vector3, Vector4 } from '@zephyr3d/base';

const tmpVecT = new Vector3();
const tmpVecS = new Vector3();
const tmpQuatR = new Quaternion();

export type HitType =
  | 'move_axis'
  | 'move_plane'
  | 'rotate_axis'
  | 'rotate_free'
  | 'scale_axis'
  | 'scale_uniform';
export type GizmoMode = 'none' | 'translation' | 'rotation' | 'scaling' | 'select';
export type GizmoHitInfo = {
  axis: number;
  type?: HitType;
  coord: number;
  distance: number;
  pointWorld: Vector3;
  pointLocal: Vector3;
};

type TranslatePlaneInfo = {
  axis: number;
  planeAxis: number;
  lastPlanePos: Vector3;
  type: HitType;
};

type RotateInfo = {
  startX: number;
  startY: number;
  startPosition: Vector3;
  startRotation: Quaternion;
  axis: number;
  speed: number;
};

type ScaleInfo = {
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  startPosition: number;
  axis: number;
  bindingPosition: Vector3;
  planePosition?: Vector3;
};

/**
 * The post water effect
 * @public
 */
export class PostGizmoRenderer extends makeEventTarget(AbstractPostEffect<'PostGizmoRenderer'>)<{
  begin_translate: [node: SceneNode];
  end_translate: [node: SceneNode];
  begin_rotate: [node: SceneNode];
  end_rotate: [node: SceneNode];
  begin_scale: [node: SceneNode];
  end_scale: [node: SceneNode];
}>() {
  static readonly className = 'PostGizmoRenderer' as const;
  static _blendBlitter: CopyBlitter = new CopyBlitter();
  static _gizmoProgram: GPUProgram = null;
  static _gizmoSelectProgram: GPUProgram = null;
  static _gridProgram: GPUProgram = null;
  static _gizmoRenderState: RenderStateSet = null;
  static _gridRenderState: RenderStateSet = null;
  static _blendRenderState: RenderStateSet = null;
  static _primitives: Partial<Record<GizmoMode, Primitive>> = {};
  static _gridPrimitive: Primitive = null;
  static _rotation: Primitive = null;
  static _mvpMatrix: Matrix4x4 = new Matrix4x4();
  static _texSize: Vector2 = new Vector2();
  static _cameraNearFar: Vector2 = new Vector2();
  static _axises = [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)];
  private _gridSteps: Float32Array;
  private _gridParams: Vector4;
  private _camera: Camera;
  private _node: SceneNode;
  private _bindGroup: BindGroup;
  private _gridBindGroup: BindGroup;
  private _mode: GizmoMode;
  private _axisLength: number;
  private _arrowLength: number;
  private _axisRadius: number;
  private _arrowRadius: number;
  private _boxSize: number;
  private _translatePlaneInfo: TranslatePlaneInfo;
  private _rotateInfo: RotateInfo;
  private _scaleInfo: ScaleInfo;
  private _screenSize: number;
  private _drawGrid: boolean;
  private _scaleBox: AABB;
  /**
   * Creates an instance of PostGizmoRenderer.
   */
  constructor(camera: Camera, binding = null, size = 10) {
    super();
    this._camera = camera;
    this._node = binding;
    this._bindGroup = null;
    this._gridBindGroup = null;
    this._axisLength = size;
    this._arrowLength = size * 0.4;
    this._axisRadius = size * 0.02;
    this._arrowRadius = size * 0.04;
    this._boxSize = size * 0.05;
    this._mode = 'none';
    this._translatePlaneInfo = null;
    this._rotateInfo = null;
    this._scaleInfo = null;
    this._screenSize = 0.3;
    this._gridParams = new Vector4(1000, 500, 0, 0);
    this._gridSteps = new Float32Array([
      1, 1, 0, 0, 10, 10, 0, 0, 100, 100, 0, 0, 1000, 1000, 0, 0, 1000, 1000, 0, 0, 1000, 1000, 0, 0, 1000,
      1000, 0, 0, 1000, 1000, 0, 0
    ]);
    this._drawGrid = true;
    this._scaleBox = new AABB(
      new Vector3(-this._boxSize, -this._boxSize, -this._boxSize),
      new Vector3(this._boxSize, this._boxSize, this._boxSize)
    );
  }
  get mode(): GizmoMode {
    return this._mode;
  }
  set mode(val: GizmoMode) {
    this._mode = val;
  }
  get node(): SceneNode {
    return this._node;
  }
  set node(node: SceneNode) {
    this._node = node;
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
    this.passThrough(ctx, inputColorTexture, srgbOutput);
    if (!this.enabled) {
      return;
    }
    let gridPrimitive: Primitive = null;
    let gridProgram: GPUProgram = null;
    let gridBindGroup: BindGroup = null;
    let gridRenderState: RenderStateSet = null;
    let gizmoRenderState: RenderStateSet = null;
    if (this._drawGrid) {
      if (!PostGizmoRenderer._gridPrimitive) {
        PostGizmoRenderer._gridPrimitive = new PlaneShape({ size: 2, twoSided: true, resolution: 8 });
      }
      gridPrimitive = PostGizmoRenderer._gridPrimitive;
      if (!PostGizmoRenderer._gridProgram) {
        PostGizmoRenderer._gridProgram = this._createGridProgram(ctx);
      }
      gridProgram = PostGizmoRenderer._gridProgram;
      if (!PostGizmoRenderer._gridRenderState) {
        PostGizmoRenderer._gridRenderState = this._createGridRenderStates(ctx);
      }
      gridRenderState = PostGizmoRenderer._gridRenderState;
      if (!this._gridBindGroup) {
        this._gridBindGroup = ctx.device.createBindGroup(gridProgram.bindGroupLayouts[0]);
      }
      gridBindGroup = this._gridBindGroup;
    }
    let gizmoPrimitive = PostGizmoRenderer._primitives[this._mode];
    let gizmoProgram: GPUProgram = null;
    let gizmoBindGroup: BindGroup = null;
    if (!gizmoPrimitive) {
      if (this._mode === 'translation') {
        gizmoPrimitive = createTranslationGizmo(
          this._axisLength,
          this._axisRadius,
          this._arrowLength,
          this._arrowRadius
        );
      } else if (this._mode === 'rotation') {
        gizmoPrimitive = createRotationGizmo(this._axisLength, this._axisRadius);
      } else if (this._mode === 'scaling') {
        gizmoPrimitive = createScaleGizmo(this._axisLength, this._axisRadius, this._boxSize);
      } else if (this._mode === 'select') {
        gizmoPrimitive = createSelectGizmo();
      }
      PostGizmoRenderer._primitives[this._mode] = gizmoPrimitive;
    }
    if (!this._node || (this._mode === 'select' && !this._node.getWorldBoundingVolume())) {
      gizmoPrimitive = null;
    }
    if (gizmoPrimitive) {
      if (this._mode === 'select') {
        if (!PostGizmoRenderer._gizmoSelectProgram) {
          PostGizmoRenderer._gizmoSelectProgram = this._createAxisProgram(ctx, true);
        }
        gizmoProgram = PostGizmoRenderer._gizmoSelectProgram;
      } else {
        if (!PostGizmoRenderer._gizmoProgram) {
          PostGizmoRenderer._gizmoProgram = this._createAxisProgram(ctx, false);
        }
        gizmoProgram = PostGizmoRenderer._gizmoProgram;
      }
      if (!this._bindGroup) {
        this._bindGroup = ctx.device.createBindGroup(gizmoProgram.bindGroupLayouts[0]);
      }
      gizmoBindGroup = this._bindGroup;
    }
    if (!gridPrimitive && !gizmoPrimitive) {
      return;
    }
    if (!PostGizmoRenderer._gizmoRenderState) {
      PostGizmoRenderer._gizmoRenderState = this._createGizmoRenderStates(ctx);
    }
    if (!PostGizmoRenderer._blendRenderState) {
      PostGizmoRenderer._blendRenderState = this._createBlendRenderStates(ctx);
    }
    gizmoRenderState = PostGizmoRenderer._gizmoRenderState;
    const destFramebuffer = ctx.device.getFramebuffer();
    const tmpFramebuffer = ctx.device.pool.fetchTemporalFramebuffer(
      false,
      ctx.device.getDrawingBufferWidth(),
      ctx.device.getDrawingBufferHeight(),
      'rgba8unorm',
      ctx.device.getFramebuffer().getDepthAttachment().format,
      false
    );
    this._calcGizmoMVPMatrix(false, PostGizmoRenderer._mvpMatrix);
    PostGizmoRenderer._texSize.setXY(inputColorTexture.width, inputColorTexture.height);
    PostGizmoRenderer._cameraNearFar.setXY(this._camera.getNearPlane(), this._camera.getFarPlane());
    ctx.device.pushDeviceStates();
    ctx.device.setFramebuffer(tmpFramebuffer);
    ctx.device.clearFrameBuffer(new Vector4(0, 0, 0, 0), 1, 0);
    if (gridPrimitive) {
      ctx.device.setRenderStates(gridRenderState);
      gridBindGroup.setValue('viewMatrix', ctx.camera.worldMatrix);
      gridBindGroup.setValue('cameraPos', ctx.camera.getWorldPosition());
      gridBindGroup.setValue('params', this._gridParams);
      gridBindGroup.setValue('steps', this._gridSteps);
      gridBindGroup.setValue('viewProjMatrix', ctx.camera.viewProjectionMatrix);
      gridBindGroup.setValue('texSize', PostGizmoRenderer._texSize);
      gridBindGroup.setValue('cameraNearFar', PostGizmoRenderer._cameraNearFar);
      gridBindGroup.setTexture('linearDepthTex', sceneDepthTexture, fetchSampler('clamp_nearest_nomip'));
      gridBindGroup.setValue('flip', this.needFlip(ctx.device) ? -1 : 1);
      ctx.device.setProgram(gridProgram);
      ctx.device.setBindGroup(0, gridBindGroup);
      gridPrimitive.draw();
    }
    if (gizmoPrimitive && !(this._mode === 'rotation' && this._rotateInfo && this._rotateInfo.axis < 0)) {
      ctx.device.setRenderStates(gizmoRenderState);
      gizmoBindGroup.setValue('mvpMatrix', PostGizmoRenderer._mvpMatrix);
      gizmoBindGroup.setValue('flip', this.needFlip(ctx.device) ? -1 : 1);
      gizmoBindGroup.setValue('texSize', PostGizmoRenderer._texSize);
      gizmoBindGroup.setValue('cameraNearFar', PostGizmoRenderer._cameraNearFar);
      gizmoBindGroup.setValue('time', (ctx.device.frameInfo.elapsedOverall % 1000) * 0.001);
      gizmoBindGroup.setTexture('linearDepthTex', sceneDepthTexture, fetchSampler('clamp_nearest_nomip'));
      ctx.device.setProgram(gizmoProgram);
      ctx.device.setBindGroup(0, gizmoBindGroup);
      gizmoPrimitive.draw();
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
  /**
   * Handle pointer input events
   * @param ev - Event object
   * @param type - Event type
   * @returns true if event was handled, otherwise false
   */
  handlePointerEvent(type: string, x: number, y: number, button: number): boolean {
    if (!this.enabled || !this._node) {
      this._endRotate();
      this._endTranslation();
      this._endScale();
      return false;
    }
    if (this._mode === 'rotation' || this._mode === 'scaling' || this._mode === 'translation') {
      if (type === 'pointerdown' && button === 0) {
        const ray = this._camera.constructRay(x, y);
        const hitInfo = this.rayIntersection(ray);
        if (hitInfo) {
          if (this._mode === 'translation' && !this._translatePlaneInfo) {
            this._beginTranslate(x, y, hitInfo.axis, hitInfo.type, hitInfo.pointLocal);
            return true;
          }
          if (this._mode === 'rotation' && !this._rotateInfo) {
            this._beginRotate(x, y, hitInfo.axis, hitInfo.pointWorld);
            return true;
          }
          if (this._mode === 'scaling' && !this._scaleInfo) {
            this._beginScale(x, y, hitInfo.axis, hitInfo.coord);
            return true;
          }
        }
      }
      if (type === 'pointermove') {
        if (this._mode === 'translation' && this._translatePlaneInfo) {
          this._updateTranslation(x, y);
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
  rayIntersection(ray: Ray): GizmoHitInfo {
    const worldMatrix = this._calcGizmoWorldMatrix(false);
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
      if (this._mode === 'scaling') {
        const d = rayLocal.bboxIntersectionTestEx(this._scaleBox);
        if (d > 0) {
          return hitInfo;
        }
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
      const distance = rayLocal.intersectionTestSphere(this._axisLength);
      if (distance !== null) {
        for (const t of distance) {
          let axis = -1;
          let minValue = this._axisRadius;
          const d = [
            Math.abs(rayLocal.origin.x + rayLocal.direction.x * t),
            Math.abs(rayLocal.origin.y + rayLocal.direction.y * t),
            Math.abs(rayLocal.origin.z + rayLocal.direction.z * t)
          ];
          for (let i = 0; i < 3; i++) {
            if (d[i] < minValue) {
              axis = i;
              minValue = d[i];
            }
          }
          if (axis >= 0) {
            const pointLocal = Vector3.add(rayLocal.origin, Vector3.scale(rayLocal.direction, t));
            return {
              axis,
              coord: t,
              distance: t,
              pointLocal,
              pointWorld: worldMatrix.transformPointAffine(pointLocal)
            };
          }
        }
        const pointLocal = Vector3.add(rayLocal.origin, Vector3.scale(rayLocal.direction, distance[0]));
        return {
          axis: -1,
          coord: distance[0],
          distance: distance[0],
          pointLocal,
          pointWorld: worldMatrix.transformPointAffine(pointLocal)
        };
      }
    }
    return null;
  }
  private _beginRotate(startX: number, startY: number, axis: number, hitPosition: Vector3) {
    this._endTranslation();
    this._endScale();
    Application.instance.device.canvas.style.cursor = 'grab';
    this._rotateInfo = {
      startX: startX,
      startY: startY,
      startPosition: hitPosition,
      startRotation: new Quaternion(this._node.rotation),
      axis,
      speed: this._measureRotateSpeed()
    };
    this.dispatchEvent('begin_rotate', this._node);
  }
  private _updateRotate(x: number, y: number) {
    if (!this._rotateInfo) {
      return;
    }
    const velocity = new Vector2(x - this._rotateInfo.startX, y - this._rotateInfo.startY);
    const movement = velocity.magnitude;
    velocity.scaleBy(1 / movement).scaleBy(10);
    const ray = this._camera.constructRay(
      this._rotateInfo.startX + velocity.x,
      this._rotateInfo.startY + velocity.y
    );
    const worldMatrix = this._calcGizmoWorldMatrix(false);
    const invWorldMatrix = Matrix4x4.invertAffine(worldMatrix);
    const rayLocal = ray.transform(invWorldMatrix);
    const distance = rayLocal.intersectionTestSphere(this._axisLength);
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
    const center = this._node.getWorldPosition();
    const edge1 = Vector3.sub(this._rotateInfo.startPosition, center).inplaceNormalize();
    const edge2 = Vector3.sub(nearestPoint, center).inplaceNormalize();
    const axis = Vector3.cross(edge1, edge2).inplaceNormalize();
    if (this._rotateInfo.axis === 0) {
      axis.setXYZ(axis.x > 0 ? 1 : -1, 0, 0);
    } else if (this._rotateInfo.axis === 1) {
      axis.setXYZ(0, axis.y > 0 ? 1 : -1, 0);
    } else if (this._rotateInfo.axis === 2) {
      axis.setXYZ(0, 0, axis.y > 0 ? 1 : -1);
    }
    invWorldMatrix.transformVectorAffine(axis, axis);
    axis.inplaceNormalize();
    const deltaRotation = Quaternion.fromAxisAngle(axis, movement / this._rotateInfo.speed);
    this._node.rotation = Quaternion.multiply(deltaRotation, this._rotateInfo.startRotation);
  }
  private _endRotate() {
    Application.instance.device.canvas.style.cursor = 'default';
    this._rotateInfo = null;
    this._node && this.dispatchEvent('end_rotate', this._node);
  }
  private _beginScale(startX: number, startY: number, axis: number, startPosition: number) {
    this._endRotate();
    this._endTranslation();
    Application.instance.device.canvas.style.cursor = 'grab';
    this._scaleInfo = {
      startX,
      startY,
      lastX: startX,
      lastY: startY,
      axis,
      startPosition,
      bindingPosition: this._node ? new Vector3(this._node.position) : Vector3.zero()
    };
    this.dispatchEvent('begin_scale', this._node);
  }
  private _updateScale(x: number, y: number) {
    if (!this._scaleInfo) {
      return;
    }
    const mvpMatrix = this._calcGizmoMVPMatrix(false);
    const width = this._camera.viewport
      ? this._camera.viewport[2]
      : Application.instance.device.getViewport().width;
    const height = this._camera.viewport
      ? this._camera.viewport[3]
      : Application.instance.device.getViewport().height;
    let axisIndex = this._scaleInfo.axis;
    if (axisIndex < 0) {
      const cameraZ = this._camera.worldMatrix.getRow(2);
      let dot = 1;
      for (let i = 0; i < 3; i++) {
        const x = Math.abs(cameraZ[i]);
        if (x < dot) {
          axisIndex = i;
          dot = x;
        }
      }
      console.log(`Uniform scaling at ${axisIndex} axis`);
    }
    const axis = PostGizmoRenderer._axises[axisIndex];
    const axisStart = new Vector4(0, 0, 0, 1);
    const axisEnd = new Vector4(axis.x, axis.y, axis.z, 1);
    const startH = mvpMatrix.transform(axisStart, axisStart);
    const endH = mvpMatrix.transform(axisEnd, axisEnd);
    const axisDirX = (endH.x / endH.w - startH.x / startH.w) * 0.5 * width;
    const axisDirY = (startH.y / startH.w - endH.y / endH.w) * 0.5 * height;
    const axisLength = Math.sqrt(axisDirX * axisDirX + axisDirY * axisDirY);
    const axisDirectionX = axisDirX / axisLength;
    const axisDirectionY = axisDirY / axisLength;
    const movementX = x - this._scaleInfo.lastX;
    const movementY = y - this._scaleInfo.lastY;
    const dot = axisDirectionX * movementX + axisDirectionY * movementY;
    const factor = Math.min(axisLength / 10, 1);
    const increment = (dot * factor) / axisLength;
    const scale = increment / this._axisLength;
    if (this._node) {
      if (this._scaleInfo.axis < 0) {
        const currentScale =
          Math.abs(this._node.scale[axisIndex]) < 1e-6 ? 1e-6 : this._node.scale[axisIndex];
        const s = movementY < 0 ? Math.abs(scale) : -Math.abs(scale);
        const t = Math.abs((currentScale + s) / currentScale);
        this._node.scale.x *= t;
        this._node.scale.y *= t;
        this._node.scale.z *= t;
      } else {
        switch (this._scaleInfo.axis) {
          case 0:
            this._node.scale.x += scale;
            break;
          case 1:
            this._node.scale.y += scale;
            break;
          case 2:
            this._node.scale.z += scale;
            break;
        }
      }
    }
    this._scaleInfo.lastX = x;
    this._scaleInfo.lastY = y;
  }
  private _endScale() {
    Application.instance.device.canvas.style.cursor = 'default';
    this._scaleInfo = null;
    this._node && this.dispatchEvent('end_scale', this._node);
  }
  private _beginTranslate(startX: number, startY: number, axis: number, type: HitType, pointLocal: Vector3) {
    this._endRotate();
    this._endScale();
    Application.instance.device.canvas.style.cursor = 'grab';
    let planeAxis = axis;
    if (type === 'move_axis') {
      const ray = this._camera.constructRay(startX, startY);
      const worldMatrix = this._calcGizmoWorldMatrix(false);
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
    this._calcGizmoWorldMatrix(false).decompose(scale);
    this._translatePlaneInfo = {
      axis,
      planeAxis,
      type,
      lastPlanePos: pointLocal.mulBy(scale)
    };
    this.dispatchEvent('begin_translate', this._node);
  }
  private _updateTranslation(x: number, y: number) {
    if (!this._translatePlaneInfo) {
      return;
    }
    const ray = this._camera.constructRay(x, y);
    const worldMatrix = this._calcGizmoWorldMatrix(true);
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
      this._node.position[c] +=
        p[this._translatePlaneInfo.axis] -
        this._translatePlaneInfo.lastPlanePos[this._translatePlaneInfo.axis];
    } else {
      const dx = p[t[0]] - this._translatePlaneInfo.lastPlanePos[t[0]];
      const dy = p[t[1]] - this._translatePlaneInfo.lastPlanePos[t[1]];
      this._node.position[t[0]] += dx;
      this._node.position[t[1]] += dy;
    }
  }
  private _endTranslation() {
    Application.instance.device.canvas.style.cursor = 'default';
    this._translatePlaneInfo = null;
    this._node && this.dispatchEvent('end_translate', this._node);
  }
  private _measureRotateSpeed() {
    const pos1 = new Vector4(0, 0, this._axisLength, 1);
    const pos2 = Matrix4x4.rotation(PostGizmoRenderer._axises[0], 1).transformAffine(pos1);
    const mvpMatrix = this._calcGizmoMVPMatrix(false);
    const width = this._camera.viewport
      ? this._camera.viewport[2]
      : Application.instance.device.getViewport().width;
    const height = this._camera.viewport
      ? this._camera.viewport[3]
      : Application.instance.device.getViewport().height;
    mvpMatrix.transform(pos1, pos1);
    mvpMatrix.transform(pos2, pos2);
    let dx = pos2.x / pos2.w - pos1.x / pos1.w;
    let dy = pos2.y / pos2.w - pos1.y / pos1.w;
    dx *= 0.5 * width;
    dy *= 0.5 * height;
    return Math.sqrt(dx * dx + dy * dy);
  }
  private _calcGizmoMVPMatrix(noScale: boolean, matrix?: Matrix4x4) {
    matrix = this._calcGizmoWorldMatrix(noScale, matrix);
    return matrix.multiplyLeft(this._camera.viewProjectionMatrix);
  }
  private _calcGizmoWorldMatrix(noScale: boolean, matrix?: Matrix4x4) {
    matrix = matrix ?? new Matrix4x4();
    if (this._node) {
      if (this._mode === 'select') {
        const box = this._node.getWorldBoundingVolume()?.toAABB();
        if (box) {
          const scale = Vector3.sub(box.maxPoint, box.minPoint);
          matrix.scaling(scale).translateLeft(box.minPoint);
        } else {
          matrix.identity();
        }
      } else {
        this._node.worldMatrix.decompose(tmpVecS, tmpQuatR, tmpVecT);
        matrix.translation(tmpVecT);
        const d = Vector3.distance(this._camera.getWorldPosition(), tmpVecT);
        if (!noScale) {
          const scale = (this._screenSize * d * this._camera.getTanHalfFovy()) / (2 * this._axisLength);
          matrix.scaling(new Vector3(scale, scale, scale)).translateLeft(tmpVecT);
        }
      }
    } else {
      matrix.identity();
    }
    return matrix;
  }
  private _createGizmoRenderStates(ctx: DrawContext) {
    const rs = ctx.device.createRenderStateSet();
    rs.useDepthState().enableTest(true).enableWrite(true);
    return rs;
  }
  private _createGridRenderStates(ctx: DrawContext) {
    const rs = ctx.device.createRenderStateSet();
    rs.useDepthState().enableTest(true).enableWrite(false);
    return rs;
  }
  private _createBlendRenderStates(ctx: DrawContext) {
    const rs = ctx.device.createRenderStateSet();
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
    let type: HitType = null;
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
  private _createGridProgram(ctx: DrawContext) {
    return ctx.device.buildRenderProgram({
      vertex(pb) {
        this.$inputs.pos = pb.vec3().attrib('position');
        this.params = pb.vec4().uniform(0);
        this.cameraPos = pb.vec3().uniform(0);
        this.viewProjMatrix = pb.mat4().uniform(0);
        this.flip = pb.float().uniform(0);
        pb.main(function () {
          this.$outputs.worldPos = pb.add(
            pb.vec3(this.cameraPos.x, 0, this.cameraPos.y),
            pb.mul(this.$inputs.pos, this.params.x)
          );
          this.$builtins.position = pb.mul(this.viewProjMatrix, pb.vec4(this.$outputs.worldPos, 1));
          this.$builtins.position = pb.mul(this.$builtins.position, pb.vec4(1, this.flip, 1, 1));
        });
      },
      fragment(pb) {
        this.$outputs.outColor = pb.vec4();
        this.viewMatrix = pb.mat4().uniform(0);
        this.params = pb.vec4().uniform(0);
        this.cameraPos = pb.vec3().uniform(0);
        this.steps = pb.vec4[8]().uniform(0);
        this.linearDepthTex = pb.tex2D().uniform(0);
        this.texSize = pb.vec2().uniform(0);
        this.cameraNearFar = pb.vec2().uniform(0);
        const STEPS_LEN = 8;
        const discRadius = 1.05 / Math.sqrt(Math.PI);
        const gridLineSmoothStart = 0.5 + discRadius;
        const gridLineSmoothEnd = 0.5 - discRadius;
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
            pb.mat4('viewMatrix'),
            pb.float('distance'),
            pb.vec3('colorGrid'),
            pb.vec3('colorGridEmphasis')
          ],
          function () {
            this.$l.dFdxPos = pb.dpdx(this.P);
            this.$l.dFdyPos = pb.dpdy(this.P);
            this.$l.fwidthPos = pb.add(pb.abs(this.dFdxPos), pb.abs(this.dFdyPos));
            this.$l.V = pb.sub(this.cameraPos, this.P);
            this.$l.dist = pb.length(this.V);
            this.V = pb.div(this.V, this.dist);
            this.$l.angle = pb.sub(1, pb.abs(this.V.y));
            this.angle = pb.mul(this.angle, this.angle);
            this.$l.fade = pb.sub(1, pb.mul(this.angle, this.angle));
            this.fade = pb.mul(
              this.fade,
              pb.sub(1, pb.smoothStep(0, this.distance, pb.sub(this.dist, this.distance)))
            );
            this.$l.gridRes = pb.mul(pb.dot(this.dFdxPos, this.viewMatrix[0].xyz), 4);
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
            this.$l.gridPos = this.P.xz;
            this.$l.gridFwidth = this.fwidthPos.xz;
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
            this.$l.planeAxis = pb.vec3(1, 0, 1);
            this.$l.axisDist.x = pb.dot(this.P.yz, this.planeAxis.yz);
            this.$l.axisFwidth.x = pb.dot(this.fwidthPos.yz, this.planeAxis.yz);
            this.$l.axisDist.z = pb.dot(this.P.xy, this.planeAxis.xy);
            this.$l.axisFwidth.z = pb.dot(this.fwidthPos.xy, this.planeAxis.xy);
            this.$l.axes = this.getAxis(this.axisDist, this.axisFwidth, 0.5, 0);
            this.outColor = pb.vec4(
              this.$choice(pb.lessThan(this.axes.x, 1e-8), this.outColor.rgb, pb.vec3(1, 0, 0)),
              pb.max(this.outColor.a, this.axes.x)
            );
            this.outColor = pb.vec4(
              this.$choice(pb.lessThan(this.axes.z, 1e-8), this.outColor.rgb, pb.vec3(0, 0, 1)),
              pb.max(this.outColor.a, this.axes.x)
            );

            this.outAlpha = pb.mul(this.outColor.a, this.fade);
            this.$return(pb.vec4(pb.mul(this.outColor.rgb, this.outAlpha), this.outAlpha));
          }
        );
        pb.main(function () {
          this.$l.color = this.screenSpaceGrid(
            this.$inputs.worldPos,
            this.cameraPos,
            this.viewMatrix,
            this.params.y,
            pb.vec3(0.112, 0.112, 0.112),
            pb.vec3(0.1384, 0.1384, 0.1384)
          );
          this.$l.screenUV = pb.div(pb.vec2(this.$builtins.fragCoord.xy), this.texSize);
          this.$l.depth = ShaderHelper.nonLinearDepthToLinearNormalized(
            this,
            this.$builtins.fragCoord.z,
            this.cameraNearFar
          );
          this.$l.sceneDepthSample = pb.textureSampleLevel(this.linearDepthTex, this.screenUV, 0);
          this.$l.sceneDepth =
            pb.getDevice().type === 'webgl'
              ? decodeNormalizedFloatFromRGBA(this, this.sceneDepthSample)
              : this.sceneDepthSample.r;
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
  private _createAxisProgram(ctx: DrawContext, selectMode: boolean) {
    return ctx.device.buildRenderProgram({
      vertex(pb) {
        this.$inputs.pos = pb.vec3().attrib('position');
        if (selectMode) {
          this.$inputs.uv = pb.vec2().attrib('texCoord0');
        } else {
          this.$inputs.color = pb.vec4().attrib('diffuse');
        }
        this.mvpMatrix = pb.mat4().uniform(0);
        this.flip = pb.float().uniform(0);
        pb.main(function () {
          this.$builtins.position = pb.mul(this.mvpMatrix, pb.vec4(this.$inputs.pos, 1));
          if (!selectMode) {
            this.$outputs.color = this.$inputs.color;
          } else {
            this.$outputs.uv = this.$inputs.uv;
          }
          this.$builtins.position = pb.mul(this.$builtins.position, pb.vec4(1, this.flip, 1, 1));
        });
      },
      fragment(pb) {
        this.$outputs.color = pb.vec4();
        this.linearDepthTex = pb.tex2D().uniform(0);
        this.texSize = pb.vec2().uniform(0);
        this.cameraNearFar = pb.vec2().uniform(0);
        this.time = pb.float().uniform(0);
        if (selectMode) {
          pb.func('edge', [pb.vec2('uv'), pb.float('lineWidth')], function () {
            this.$l.fw = pb.fwidth(this.uv);
            this.$l.d = pb.mul(
              pb.smoothStep(pb.vec2(0), pb.mul(this.fw, this.lineWidth), this.uv),
              pb.smoothStep(pb.vec2(0), pb.mul(this.fw, this.lineWidth), pb.sub(pb.vec2(1), this.uv))
            );
            this.$return(pb.smoothStep(0, 0.5, pb.sub(1, pb.min(this.d.x, this.d.y))));
            //this.$return(pb.sub(1, pb.min(this.d.x, this.d.y)));
          });
          pb.func(
            'dash',
            [
              pb.vec2('uv'),
              pb.float('lineWidth'),
              pb.float('dashLenSS'),
              pb.float('dashGapSS'),
              pb.float('time')
            ],
            function () {
              this.$l.edge = this.edge(this.uv, this.lineWidth);
              this.$l.du = pb.min(this.uv.x, pb.sub(1, this.uv.x));
              this.$l.dv = pb.min(this.uv.y, pb.sub(1, this.uv.y));
              this.$l.alongEdge = this.$choice(pb.greaterThan(this.du, this.dv), this.du, this.dv);
              this.$l.d = pb.fwidth(this.alongEdge);
              this.$l.dashLen = pb.mul(this.dashLenSS, this.d);
              this.$l.dashGap = pb.mul(this.dashGapSS, this.d);
              this.$l.totalLen = pb.add(this.dashLen, this.dashGap);
              this.$l.pattern = pb.mod(pb.add(this.alongEdge, pb.mul(this.time, 0.1)), this.totalLen);
              this.$l.dash = pb.step(this.pattern, this.dashGap);
              this.$return(pb.mul(this.edge, this.dash));
            }
          );
        }
        pb.main(function () {
          this.$l.screenUV = pb.div(pb.vec2(this.$builtins.fragCoord.xy), this.texSize);
          this.$l.depth = ShaderHelper.nonLinearDepthToLinearNormalized(
            this,
            this.$builtins.fragCoord.z,
            this.cameraNearFar
          );
          this.$l.sceneDepthSample = pb.textureSampleLevel(this.linearDepthTex, this.screenUV, 0);
          this.$l.sceneDepth =
            pb.getDevice().type === 'webgl'
              ? decodeNormalizedFloatFromRGBA(this, this.sceneDepthSample)
              : this.sceneDepthSample.r;
          this.$l.alpha = this.$choice(
            pb.greaterThan(this.depth, this.sceneDepth),
            selectMode ? pb.float(0.3) : pb.float(0.5),
            pb.float(1)
          );
          if (selectMode) {
            this.$l.lineWidth = pb.float(1.5);
            this.$l.edgeFactor = this.edge(this.$inputs.uv, this.lineWidth);
            this.alpha = pb.mul(this.alpha, this.edgeFactor);
            this.$if(pb.lessThan(this.alpha, 0.01), function () {
              pb.discard();
            });
          }
          const diffuse = selectMode ? pb.vec3(1) : this.$inputs.color.rgb;
          this.$outputs.color = pb.vec4(pb.mul(diffuse, this.alpha), this.alpha);
        });
      }
    });
  }
}
