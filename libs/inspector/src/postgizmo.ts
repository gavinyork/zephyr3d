import type { BindGroup, GPUProgram, RenderStateSet, Texture2D } from '@zephyr3d/device';
import type { Camera, DrawContext, Primitive, SceneNode } from '@zephyr3d/scene';
import {
  AbstractPostEffect,
  Application,
  copyTexture,
  decodeNormalizedFloatFromRGBA,
  fetchSampler,
  ShaderHelper
} from '@zephyr3d/scene';
import { createTranslationGizmo, createRotationGizmo, createScaleGizmo } from './gizmo';
import type { Ray } from '@zephyr3d/base';
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
export type GizmoMode = 'none' | 'translation' | 'rotation' | 'scaling';
export type GizmoHitInfo = {
  axis: number;
  type?: HitType;
  coord: number;
  distance: number;
  pointWorld: Vector3;
  pointLocal: Vector3;
};

type TranslateAxisInfo = {
  startX: number;
  startY: number;
  startPosition: number;
  axis: number;
  bindingPosition: Vector3;
  planePosition?: Vector3;
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

type ScaleInfo = TranslateAxisInfo;
/**
 * The post water effect
 * @public
 */
export class PostGizmoRenderer extends AbstractPostEffect<'PostGizmoRenderer'> {
  static readonly className = 'PostGizmoRenderer' as const;
  static _gizmoProgram: GPUProgram = null;
  static _gizmoRenderState: RenderStateSet = null;
  static _blendRenderState: RenderStateSet = null;
  static _primitives: Partial<Record<GizmoMode, Primitive>> = {};
  static _rotation: Primitive = null;
  static _mvpMatrix: Matrix4x4 = new Matrix4x4();
  static _texSize: Vector2 = new Vector2();
  static _cameraNearFar: Vector2 = new Vector2();
  static _axises = [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)];
  private _camera: Camera;
  private _axisBinding: SceneNode;
  private _bindGroup: BindGroup;
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
  /**
   * Creates an instance of PostGizmoRenderer.
   */
  constructor(camera: Camera, binding: SceneNode, size = 10) {
    super();
    this._camera = camera;
    this._axisBinding = binding;
    this._bindGroup = null;
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
  }
  get mode(): GizmoMode {
    return this._mode;
  }
  set mode(val: GizmoMode) {
    this._mode = val;
  }
  get axisBinding(): SceneNode {
    return this._axisBinding;
  }
  set axisBinding(node: SceneNode) {
    this._axisBinding = node;
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
    if (this._mode === 'rotation' && this._rotateInfo && this._rotateInfo.axis < 0) {
      return;
    }
    let primitive: Primitive = PostGizmoRenderer._primitives[this._mode];
    if (!primitive) {
      if (this._mode === 'translation') {
        primitive = createTranslationGizmo(
          this._axisLength,
          this._axisRadius,
          this._arrowLength,
          this._arrowRadius
        );
      } else if (this._mode === 'rotation') {
        primitive = createRotationGizmo(this._axisLength, this._axisRadius);
      } else if (this._mode === 'scaling') {
        primitive = createScaleGizmo(this._axisLength, this._axisRadius, this._boxSize);
      }
      PostGizmoRenderer._primitives[this._mode] = primitive;
    }
    if (!primitive) {
      return;
    }
    const destFramebuffer = ctx.device.getFramebuffer();
    const tmpFramebuffer = ctx.device.pool.fetchTemporalFramebuffer(
      false,
      ctx.device.getDrawingBufferWidth(),
      ctx.device.getDrawingBufferHeight(),
      'rgba8unorm',
      ctx.device.getFramebuffer().getDepthAttachment().format,
      false
    );
    ctx.device.pushDeviceStates();
    ctx.device.setFramebuffer(tmpFramebuffer);
    ctx.device.clearFrameBuffer(new Vector4(0, 0, 0, 0), 1, 0);
    if (!PostGizmoRenderer._gizmoProgram) {
      PostGizmoRenderer._gizmoProgram = this._createAxisProgram(ctx);
    }
    if (!PostGizmoRenderer._gizmoRenderState) {
      PostGizmoRenderer._gizmoRenderState = this._createRenderStates(ctx);
    }
    if (!PostGizmoRenderer._blendRenderState) {
      PostGizmoRenderer._blendRenderState = this._createBlendRenderStates(ctx);
    }
    if (!this._bindGroup) {
      this._bindGroup = ctx.device.createBindGroup(PostGizmoRenderer._gizmoProgram.bindGroupLayouts[0]);
    }
    this._calcGizmoMVPMatrix(false, PostGizmoRenderer._mvpMatrix);
    PostGizmoRenderer._texSize.setXY(inputColorTexture.width, inputColorTexture.height);
    PostGizmoRenderer._cameraNearFar.setXY(this._camera.getNearPlane(), this._camera.getFarPlane());
    this._bindGroup.setValue('mvpMatrix', PostGizmoRenderer._mvpMatrix);
    this._bindGroup.setValue('flip', this.needFlip(ctx.device) ? -1 : 1);
    this._bindGroup.setValue('texSize', PostGizmoRenderer._texSize);
    this._bindGroup.setValue('cameraNearFar', PostGizmoRenderer._cameraNearFar);
    this._bindGroup.setTexture('linearDepthTex', sceneDepthTexture, fetchSampler('clamp_nearest_nomip'));
    ctx.device.setProgram(PostGizmoRenderer._gizmoProgram);
    ctx.device.setBindGroup(0, this._bindGroup);
    ctx.device.setRenderStates(PostGizmoRenderer._gizmoRenderState);
    primitive.draw();
    copyTexture(
      tmpFramebuffer.getColorAttachments()[0],
      destFramebuffer,
      fetchSampler('clamp_nearest_nomip'),
      PostGizmoRenderer._blendRenderState,
      0,
      srgbOutput
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
  handleEvent(ev: Event, type?: string): boolean {
    if (!(ev instanceof PointerEvent)) {
      return false;
    }
    const x = ev.offsetX;
    const y = ev.offsetY;
    if (this._mode === 'rotation' || this._mode === 'scaling' || this._mode === 'translation') {
      if (ev.type === 'pointerdown') {
        const ray = this._camera.constructRay(x, y);
        const hitInfo = this.rayIntersection(ray);
        if (hitInfo) {
          if (this._mode === 'translation' && !this._translatePlaneInfo) {
            this._beginTranslate(x, y, hitInfo.axis, hitInfo.coord, hitInfo.type, hitInfo.pointLocal);
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
      if (ev.type === 'pointermove') {
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
      if (ev.type === 'pointerup') {
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
      startRotation: new Quaternion(this._axisBinding.rotation),
      axis,
      speed: this._measureRotateSpeed()
    };
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
    const center = this._axisBinding.getWorldPosition();
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
    this._axisBinding.rotation = Quaternion.multiply(deltaRotation, this._rotateInfo.startRotation);
  }
  private _endRotate() {
    Application.instance.device.canvas.style.cursor = 'default';
    this._rotateInfo = null;
  }
  private _beginScale(startX: number, startY: number, axis: number, startPosition: number) {
    this._endRotate();
    this._endTranslation();
    Application.instance.device.canvas.style.cursor = 'grab';
    this._scaleInfo = {
      startX,
      startY,
      axis,
      startPosition,
      bindingPosition: this._axisBinding ? new Vector3(this._axisBinding.position) : Vector3.zero()
    };
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
    const axis = PostGizmoRenderer._axises[this._scaleInfo.axis];
    const axisStart = new Vector4(0, 0, 0, 1);
    const axisEnd = new Vector4(axis.x, axis.y, axis.z, 1);
    const startH = mvpMatrix.transform(axisStart, axisStart);
    const endH = mvpMatrix.transform(axisEnd, axisEnd);
    const axisDirX = (endH.x / endH.w - startH.x / startH.w) * 0.5 * width;
    const axisDirY = (startH.y / startH.w - endH.y / endH.w) * 0.5 * height;
    const axisLength = Math.sqrt(axisDirX * axisDirX + axisDirY * axisDirY);
    const axisDirectionX = axisDirX / axisLength;
    const axisDirectionY = axisDirY / axisLength;
    const movementX = x - this._scaleInfo.startX;
    const movementY = y - this._scaleInfo.startY;
    const dot = axisDirectionX * movementX + axisDirectionY * movementY;
    const factor = Math.min(axisLength / 10, 1);
    const increment = (dot * factor) / axisLength;
    const scale = increment / this._axisLength;
    if (this._axisBinding) {
      switch (this._scaleInfo.axis) {
        case 0:
          this._axisBinding.scale.x += scale;
          break;
        case 1:
          this._axisBinding.scale.y += scale;
          break;
        case 2:
          this._axisBinding.scale.z += scale;
          break;
      }
    }
    this._scaleInfo.startX = x;
    this._scaleInfo.startY = y;
  }
  private _endScale() {
    Application.instance.device.canvas.style.cursor = 'default';
    this._scaleInfo = null;
  }
  private _beginTranslate(
    startX: number,
    startY: number,
    axis: number,
    startPosition: number,
    type: HitType,
    pointLocal: Vector3
  ) {
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
      this._axisBinding.position[c] +=
        p[this._translatePlaneInfo.axis] -
        this._translatePlaneInfo.lastPlanePos[this._translatePlaneInfo.axis];
    } else {
      const dx = p[t[0]] - this._translatePlaneInfo.lastPlanePos[t[0]];
      const dy = p[t[1]] - this._translatePlaneInfo.lastPlanePos[t[1]];
      this._axisBinding.position[t[0]] += dx;
      this._axisBinding.position[t[1]] += dy;
      console.log(
        `ray: (${rayLocal.origin.x},${rayLocal.origin.y},${rayLocal.origin.z}) (${rayLocal.direction.x},${rayLocal.direction.y},${rayLocal.direction.z})`
      );
      console.log(`mouse: (${x} ${y}) distance: ${d} movement: (${dx} ${dy})`);
    }
  }
  private _endTranslation() {
    Application.instance.device.canvas.style.cursor = 'default';
    this._translatePlaneInfo = null;
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
    if (this._axisBinding) {
      this._axisBinding.worldMatrix.decompose(tmpVecS, tmpQuatR, tmpVecT);
      matrix.translation(tmpVecT);
      const d = Vector3.distance(this._camera.getWorldPosition(), tmpVecT);
      if (!noScale) {
        const scale = (this._screenSize * d * this._camera.getTanHalfFovy()) / (2 * this._axisLength);
        matrix.scaling(new Vector3(scale, scale, scale)).translateLeft(tmpVecT);
      }
    } else {
      matrix.identity();
    }
    return matrix;
  }
  private _createRenderStates(ctx: DrawContext) {
    const rs = ctx.device.createRenderStateSet();
    rs.useDepthState().enableTest(true).enableWrite(true);
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
  private _createAxisProgram(ctx: DrawContext) {
    return ctx.device.buildRenderProgram({
      vertex(pb) {
        this.$inputs.pos = pb.vec3().attrib('position');
        this.$inputs.color = pb.vec4().attrib('diffuse');
        this.mvpMatrix = pb.mat4().uniform(0);
        this.flip = pb.float().uniform(0);
        pb.main(function () {
          this.$builtins.position = pb.mul(this.mvpMatrix, pb.vec4(this.$inputs.pos, 1));
          this.$outputs.color = this.$inputs.color;
          this.$builtins.position = pb.mul(this.$builtins.position, pb.vec4(1, this.flip, 1, 1));
        });
      },
      fragment(pb) {
        this.$outputs.color = pb.vec4();
        this.linearDepthTex = pb.tex2D().uniform(0);
        this.texSize = pb.vec2().uniform(0);
        this.cameraNearFar = pb.vec2().uniform(0);
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
            pb.float(0.5),
            pb.float(1)
          );
          this.$outputs.color = pb.vec4(pb.mul(this.$inputs.color.rgb, this.alpha), this.alpha);
        });
      }
    });
  }
}
