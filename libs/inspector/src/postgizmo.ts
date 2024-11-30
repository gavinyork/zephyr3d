import type { BindGroup, GPUProgram, RenderStateSet, Texture2D } from '@zephyr3d/device';
import type { Camera, DrawContext, Primitive, SceneNode } from '@zephyr3d/scene';
import {
  AbstractPostEffect,
  Application,
  decodeNormalizedFloatFromRGBA,
  fetchSampler,
  linearToGamma,
  ShaderHelper
} from '@zephyr3d/scene';
import { createTranslationGizmo, createRotationGizmo, createScaleGizmo } from './gizmo';
import { Matrix4x4, Quaternion, Ray, Vector2, Vector3, Vector4 } from '@zephyr3d/base';

const tmpVecT = new Vector3();
const tmpVecS = new Vector3();
const tmpQuatR = new Quaternion();

export type GizmoMode = 'none' | 'translation' | 'rotation' | 'scaling';
export type GizmoHitInfo = {
  axis: number;
  t: number;
  point: Vector3;
};

type TranslateInfo = {
  startX: number;
  startY: number;
  startPosition: number;
  axis: number;
  bindingPosition: Vector3;
};
/**
 * The post water effect
 * @public
 */
export class PostGizmoRenderer extends AbstractPostEffect<'PostGizmoRenderer'> {
  static readonly className = 'PostGizmoRenderer' as const;
  static _gizmoProgram: GPUProgram = null;
  static _gizmoRenderState: RenderStateSet = null;
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
  private _translateInfo: TranslateInfo;
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
    this._axisRadius = size * 0.01;
    this._arrowRadius = size * 0.02;
    this._boxSize = size * 0.05;
    this._mode = 'none';
    this._translateInfo = null;
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
    if (!PostGizmoRenderer._gizmoProgram) {
      PostGizmoRenderer._gizmoProgram = this._createAxisProgram(ctx);
    }
    if (!PostGizmoRenderer._gizmoRenderState) {
      PostGizmoRenderer._gizmoRenderState = this._createRenderStates(ctx);
    }
    if (!this._bindGroup) {
      this._bindGroup = ctx.device.createBindGroup(PostGizmoRenderer._gizmoProgram.bindGroupLayouts[0]);
    }
    this._calcGizmoMVPMatrix(PostGizmoRenderer._mvpMatrix);
    PostGizmoRenderer._texSize.setXY(inputColorTexture.width, inputColorTexture.height);
    PostGizmoRenderer._cameraNearFar.setXY(this._camera.getNearPlane(), this._camera.getFarPlane());
    this._bindGroup.setValue('mvpMatrix', PostGizmoRenderer._mvpMatrix);
    this._bindGroup.setValue('flip', this.needFlip(ctx.device) ? -1 : 1);
    this._bindGroup.setValue('srgbOut', srgbOutput ? 1 : 0);
    this._bindGroup.setValue('texSize', PostGizmoRenderer._texSize);
    this._bindGroup.setValue('cameraNearFar', PostGizmoRenderer._cameraNearFar);
    this._bindGroup.setTexture('inputColor', inputColorTexture, fetchSampler('clamp_nearest_nomip'));
    this._bindGroup.setTexture('linearDepthTex', sceneDepthTexture, fetchSampler('clamp_nearest_nomip'));
    ctx.device.setProgram(PostGizmoRenderer._gizmoProgram);
    ctx.device.setBindGroup(0, this._bindGroup);
    ctx.device.setRenderStates(PostGizmoRenderer._gizmoRenderState);
    primitive.draw();
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
    if (this._mode === 'translation') {
      if (ev.type === 'pointerdown' && !this._translateInfo) {
        const ray = this._camera.constructRay(x, y);
        const hitInfo = this.rayIntersection(ray);
        if (hitInfo) {
          console.log(`Begin translate: x=${x} y=${y} axis=${hitInfo.axis} pos=${hitInfo.t}`);
          this._beginTranslate(x, y, hitInfo.axis, hitInfo.t);
          return true;
        }
      }
      if (ev.type === 'pointermove' && this._translateInfo) {
        console.log(`Update translate: x=${x} y=${y}`);
        this._updateTranslation(x, y);
        return true;
      }
      if (ev.type === 'pointerup' && this._translateInfo) {
        console.log(`End translate`);
        this._endTranslation();
      }
    }
    return false;
  }
  /** Ray intersection */
  rayIntersection(ray: Ray): GizmoHitInfo {
    const rayLocal = new Ray();
    const invWorldMatrix = this._calcGizmoWorldMatrix().inplaceInvertAffine();
    ray.transform(invWorldMatrix, rayLocal);
    if (this._mode === 'translation' || this._mode === 'scaling') {
      for (let i = 0; i < 3; i++) {
        let coord = this._rayIntersectAxis(rayLocal, i, this._axisLength, this._axisRadius);
        if (coord >= 0) {
          return {
            axis: i,
            t: coord,
            point: Vector3.add(ray.origin, Vector3.scale(ray.direction, coord))
          };
        }
        const length =
          this._axisLength + (this._mode === 'translation' ? this._arrowLength : 2 * this._boxSize);
        const radius = this._mode === 'translation' ? this._arrowRadius : this._boxSize;
        coord = this._rayIntersectAxis(rayLocal, i, length, radius);
        if (coord >= this._axisLength) {
          return {
            axis: i,
            t: coord,
            point: Vector3.add(ray.origin, Vector3.scale(ray.direction, coord))
          };
        }
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
            return {
              axis,
              t,
              point: Vector3.add(ray.origin, Vector3.scale(ray.direction, t))
            };
          }
        }
        return {
          axis: -1,
          t: distance[0],
          point: Vector3.add(ray.origin, Vector3.scale(ray.direction, distance[0]))
        };
      }
    }
    return null;
  }
  private _beginTranslate(startX: number, startY: number, axis: number, startPosition: number) {
    this._translateInfo = {
      startX,
      startY,
      axis,
      startPosition,
      bindingPosition: this._axisBinding ? new Vector3(this._axisBinding.position) : Vector3.zero()
    };
  }
  private _updateTranslation(x: number, y: number) {
    if (!this._translateInfo) {
      return;
    }
    const mvpMatrix = this._calcGizmoMVPMatrix();
    const width = this._camera.viewport
      ? this._camera.viewport[2]
      : Application.instance.device.getViewport().width;
    const height = this._camera.viewport
      ? this._camera.viewport[3]
      : Application.instance.device.getViewport().height;
    const axis = PostGizmoRenderer._axises[this._translateInfo.axis];
    const axisStart = new Vector4(0, 0, 0, 1);
    const axisEnd = new Vector4(axis.x, axis.y, axis.z, 1);
    const startH = mvpMatrix.transform(axisStart, axisStart);
    const endH = mvpMatrix.transform(axisEnd, axisEnd);
    const axisDirX = ((endH.x - startH.x) / startH.w) * 0.5 * width;
    const axisDirY = ((startH.y - endH.y) / startH.w) * 0.5 * height;
    const axisLength = Math.sqrt(axisDirX * axisDirX + axisDirY * axisDirY);
    const axisDirectionX = axisDirX / axisLength;
    const axisDirectionY = axisDirY / axisLength;
    const movementX = x - this._translateInfo.startX;
    const movementY = y - this._translateInfo.startY;
    const dot = axisDirectionX * movementX + axisDirectionY * movementY;
    const translation = dot / axisLength;
    if (this._axisBinding) {
      switch (this._translateInfo.axis) {
        case 0:
          this._axisBinding.position.x = this._translateInfo.bindingPosition.x + translation;
          break;
        case 1:
          this._axisBinding.position.y = this._translateInfo.bindingPosition.y + translation;
          break;
        case 2:
          this._axisBinding.position.z = this._translateInfo.bindingPosition.z + translation;
          break;
      }
    }
    console.log(
      `move=(${movementX},${movementY}) axis=(${axisDirectionX},${axisDirectionY}) dot=${dot} axisLength=${axisLength}, translation=${translation}`
    );
  }
  private _endTranslation() {
    this._translateInfo = null;
  }
  private _calcGizmoMVPMatrix(matrix?: Matrix4x4) {
    matrix = this._calcGizmoWorldMatrix(matrix);
    return matrix.multiplyLeft(this._camera.viewProjectionMatrix);
  }
  private _calcGizmoWorldMatrix(matrix?: Matrix4x4) {
    matrix = matrix ?? new Matrix4x4();
    if (this._axisBinding) {
      this._axisBinding.worldMatrix.decompose(tmpVecS, tmpQuatR, tmpVecT);
      tmpQuatR.toMatrix4x4(matrix).translateLeft(tmpVecT);
    } else {
      matrix.identity();
    }
    return matrix;
  }
  private _createRenderStates(ctx: DrawContext) {
    const rs = ctx.device.createRenderStateSet();
    rs.useDepthState().enableTest(false).enableWrite(false);
    return rs;
  }
  private _rayIntersectAxis(ray: Ray, axis: number, length: number, radius: number): number {
    const coords = [0, 1, 2];
    coords.splice(axis, 1);
    const [i1, i2] = coords;

    const o = ray.origin;
    const d = ray.direction;

    const a = d[i1] * d[i1] + d[i2] * d[i2];
    const b = 2 * (o[i1] * d[i1] + o[i2] * d[i2]);
    const c = o[i1] * o[i1] + o[i2] * o[i2] - radius * radius;

    const discriminant = b * b - 4 * a * c;
    if (discriminant < 0) return -1;

    const sqrtDisc = Math.sqrt(discriminant);
    const t1 = (-b - sqrtDisc) / (2 * a);
    const t2 = (-b + sqrtDisc) / (2 * a);

    for (const t of [t1, t2]) {
      if (t < 0) continue;
      const hit = Vector3.add(ray.origin, Vector3.scale(ray.direction, t));
      const coord = [hit.x, hit.y, hit.z][axis];
      if (coord >= 0 && coord <= length) {
        return coord;
      }
    }
    return -1;
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
        this.inputColor = pb.tex2D().uniform(0);
        this.linearDepthTex = pb.tex2D().uniform(0);
        this.texSize = pb.vec2().uniform(0);
        this.cameraNearFar = pb.vec2().uniform(0);
        this.srgbOut = pb.int().uniform(0);
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
            pb.float(0.2),
            pb.float(1)
          );
          this.$l.sceneColor = pb.textureSampleLevel(this.inputColor, this.screenUV, 0);
          this.$l.outColor = pb.mix(this.sceneColor.rgb, this.$inputs.color.rgb, this.alpha);
          this.$if(pb.equal(this.srgbOut, 0), function () {
            this.$outputs.color = pb.vec4(this.outColor, 1);
          }).$else(function () {
            this.$outputs.outColor = pb.vec4(linearToGamma(this, this.outColor), 1);
          });
        });
      }
    });
  }
}
