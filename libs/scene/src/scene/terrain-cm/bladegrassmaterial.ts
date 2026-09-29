import type { Clonable, Nullable } from '@zephyr3d/base';
import { Vector2, Vector3, Vector4, DWeakRef, DRef } from '@zephyr3d/base';
import type {
  BindGroup,
  GPUDataBuffer,
  Texture2D,
  PBFunctionScope,
  PBInsideFunctionScope,
  PBShaderExp,
  RenderStateSet
} from '@zephyr3d/device';
import { applyMaterialMixins, MeshMaterial, mixinPBRMetallicRoughness, ShaderHelper } from '../../material';
import type { DrawContext } from '../../render';
import type { Camera } from '../../camera';
import type { WindField } from '../wind';
import { RENDER_PASS_TYPE_LIGHT } from '../../values';
import type { ClipmapTerrain } from './terrain-cm';
import { GRASS_LOD_FADE_BAND, grassDensityLod } from './grass_gpu';
import { fetchSampler } from '../../utility/misc';

/** Vertices of a high detail blade: 7 pairs across the blade and one tip vertex */
export const BLADE_VERTEX_PAIRS = 7;
/** @internal */
export const BLADE_VERTEX_COUNT = BLADE_VERTEX_PAIRS * 2 + 1;
/** Number of vec4 per blade instance, see GrassGpuPlacement */
export const BLADE_INSTANCE_VEC4 = 4;

/**
 * Triangle list of a blade: quads between consecutive vertex pairs, closed by the tip.
 * Vertex 2k is the left side of pair k, 2k + 1 the right side, the last vertex the tip.
 * @internal
 */
export function createBladeIndices(): Uint16Array<ArrayBuffer> {
  const indices: number[] = [];
  for (let k = 0; k < BLADE_VERTEX_PAIRS - 1; k++) {
    const a = 2 * k;
    indices.push(a, a + 1, a + 3, a, a + 3, a + 2);
  }
  const last = 2 * (BLADE_VERTEX_PAIRS - 1);
  indices.push(last, last + 1, BLADE_VERTEX_COUNT - 1);
  return new Uint16Array(indices);
}

/**
 * Terrain grass material for procedural blades.
 *
 * Each blade is a cubic Bezier curve built in the vertex shader from the vertex index and the
 * blade's instance data, following "Procedural Grass in Ghost of Tsushima" (Wohllaib, GDC 2021):
 * the tip is placed from the tilt and the facing, the middle control points are pushed away from
 * the base-tip line by the bend, and the vertex steps sideways by the tapered width. The normal is
 * the cross product of the curve derivative and the width direction.
 *
 * Three tricks from the talk make the blades read better:
 * - rounded normals: the normal tilts outward across the blade's width, so a flat blade shades as
 *   if it were curved;
 * - view-space thickening: a blade seen edge-on spreads its vertices sideways to the view, so it
 *   does not thin out to nothing;
 * - distant normals: farther away the normal blends toward a normal shared by the whole clump and
 *   the surface gets rougher, which keeps distant fields from glittering. The talk does not say
 *   what that normal is; here it is the terrain normal (as in the cainrademan/Unity-Grass
 *   reimplementation) leaned toward the clump's facing by its tilt, so a distant field shades
 *   like a canopy lit from above instead of like blades turned away from a low sun.
 *
 * Color follows the talk too: a gradient along the blade whose column is picked by the blade's
 * clump (a color texture, or root and tip colors with a per-clump brightness), and an ambient
 * occlusion that darkens toward the root, where the other blades hide the sky.
 *
 * Instance data is written by the GPU placement pass (GrassGpuPlacement), four vec4 per blade:
 * - (base position xyz, density LOD hash; +2 when flagged as occluded)
 * - (facing angle, previous facing angle, wind push, previous wind push); the placement pass
 *   samples the scene wind for this frame and the last one and turns the facing downwind
 * - (clump facing angle, clump color, packed terrain normal, per-blade hash)
 * - (height, width, tilt, bend)
 *
 * @internal
 */
export class ClipmapBladeGrassMaterial
  extends applyMaterialMixins(MeshMaterial, mixinPBRMetallicRoughness)
  implements Clonable<ClipmapBladeGrassMaterial>
{
  /** @internal */
  private readonly _terrain: DWeakRef<ClipmapTerrain>;
  /** @internal */
  private readonly _instances: DRef<GPUDataBuffer>;
  /** @internal */
  private readonly _colorMap: DRef<Texture2D>;
  /** (taper, tip detail, clump color variation, root occlusion) @internal */
  private readonly _shape: Vector4;
  /** (roundness, view thickening, far normal start, far normal end) @internal */
  private readonly _look: Vector4;
  /** (far roughness, unused...) @internal */
  private readonly _look2: Vector4;
  /** (wind lean, sway amplitude, sway speed, unused) @internal */
  private readonly _wind: Vector4;
  /** (wind clock, previous wind clock) @internal */
  private readonly _windTime: Vector2;
  /** @internal */
  private readonly _rootColor: Vector4;
  /** @internal */
  private readonly _tipColor: Vector4;
  /** @internal */
  private readonly _distanceFade: Vector2;
  /** @internal */
  private readonly _densityLod: Vector2;
  /** @internal */
  private readonly _prevCameraPos: Vector4;
  /** @internal */
  private _drawDistance: number;
  /** @internal */
  private _farDensity: number;
  /** @internal */
  private static readonly _tmpPos = new Vector3();
  /** @internal */
  private static readonly FEATURE_OCCLUSION_DEBUG = this.defineFeature();
  /** @internal */
  private static readonly FEATURE_COLOR_MAP = this.defineFeature();
  constructor(terrain: ClipmapTerrain) {
    super();
    this.metallic = 0;
    this.roughness = 0.6;
    // Both sides are lit: the fragment shader turns the normal toward the viewer itself, since the
    // generic flip would also turn the rounded normals inward on the back face
    this.doubleSidedLighting = false;
    this.specularFactor = new Vector4(1, 1, 1, 0.3);
    this._terrain = new DWeakRef(terrain);
    this._instances = new DRef();
    this._colorMap = new DRef();
    this._shape = new Vector4(0.7, 1.5, 0.1, 0.5);
    this._look = new Vector4(0.5, 0.5, 15, 60);
    this._look2 = new Vector4(0.9, 0, 0, 0);
    this._wind = new Vector4(0.5, 0.15, 2.5, 0);
    this._windTime = new Vector2(0, 0);
    this._rootColor = new Vector4(0.06, 0.1, 0.02, 1);
    this._tipColor = new Vector4(0.35, 0.45, 0.12, 1);
    this._distanceFade = new Vector2(0, 0);
    this._densityLod = new Vector2(0, 1);
    this._prevCameraPos = new Vector4();
    this._drawDistance = 0;
    this._farDensity = 1;
    this.useFeature(ClipmapBladeGrassMaterial.FEATURE_OCCLUSION_DEBUG, false);
    this.useFeature(ClipmapBladeGrassMaterial.FEATURE_COLOR_MAP, false);
  }
  clone() {
    const other = new ClipmapBladeGrassMaterial(this._terrain.get()!);
    other.copyFrom(this);
    return other;
  }
  copyFrom(other: this) {
    super.copyFrom(other);
    this._shape.set(other._shape);
    this._look.set(other._look);
    this._look2.set(other._look2);
    this._wind.set(other._wind);
    this.colorMap = other.colorMap;
    this._rootColor.set(other._rootColor);
    this._tipColor.set(other._tipColor);
    this._distanceFade.set(other._distanceFade);
    this._densityLod.set(other._densityLod);
    this._drawDistance = other._drawDistance;
    this._farDensity = other._farDensity;
  }
  /**
   * Sets the instance buffer written by the GPU placement pass
   * @internal
   */
  setInstanceBuffer(buffer: Nullable<GPUDataBuffer>) {
    // Bound uniforms are only re-applied after uniformChanged(), and the placement pass
    // reallocates the buffer whenever its placement window grows
    if (buffer !== this._instances.get()) {
      this._instances.set(buffer);
      this.uniformChanged();
    }
  }
  /**
   * Updates the per-frame values before drawing for a camera: the previous camera position the
   * motion vectors are computed against
   * @internal
   */
  prepareDraw(camera: Camera, wind: Nullable<WindField>) {
    const windParams = wind?.shaderParams;
    const windTime = windParams ? windParams[13] : 0;
    const prevWindTime = windParams ? windParams[16 + 13] : 0;
    if (this._windTime.x !== windTime || this._windTime.y !== prevWindTime) {
      this._windTime.setXY(windTime, prevWindTime);
      this.uniformChanged();
    }
    const prev = camera.prevPosition ?? camera.getWorldPosition(ClipmapBladeGrassMaterial._tmpPos);
    const p = this._prevCameraPos;
    if (p.x !== prev.x || p.y !== prev.y || p.z !== prev.z) {
      p.setXYZW(prev.x, prev.y, prev.z, 0);
      this.uniformChanged();
    }
  }
  /** How much the blade narrows toward the tip, 0 keeps it the same width up to the tip vertex */
  get taper() {
    return this._shape.x;
  }
  set taper(val: number) {
    val = Math.min(1, Math.max(0, val));
    if (val !== this._shape.x) {
      this._shape.x = val;
      this.uniformChanged();
    }
  }
  /** Moves the vertices toward the tip, where the blade curves most. 1 spaces them evenly. */
  get tipDetail() {
    return this._shape.y;
  }
  set tipDetail(val: number) {
    val = Math.min(4, Math.max(1, val));
    if (val !== this._shape.y) {
      this._shape.y = val;
      this.uniformChanged();
    }
  }
  /** How much the brightness changes from clump to clump, 0 for none */
  get clumpColorVariation() {
    return this._shape.z;
  }
  set clumpColorVariation(val: number) {
    val = Math.min(1, Math.max(0, val));
    if (val !== this._shape.z) {
      this._shape.z = val;
      this.uniformChanged();
    }
  }
  /** How much the ambient light darkens toward the root, 0 for none, 1 for black at the root */
  get rootOcclusion() {
    return this._shape.w;
  }
  set rootOcclusion(val: number) {
    val = Math.min(1, Math.max(0, val));
    if (val !== this._shape.w) {
      this._shape.w = val;
      this.uniformChanged();
    }
  }
  /**
   * Optional color texture: V from the root (0) to the tip (1), U picked per clump. Replaces the
   * root and tip colors.
   */
  get colorMap(): Nullable<Texture2D> {
    return this._colorMap.get();
  }
  set colorMap(val: Nullable<Texture2D>) {
    if (val !== this._colorMap.get()) {
      this._colorMap.set(val);
      this.useFeature(ClipmapBladeGrassMaterial.FEATURE_COLOR_MAP, !!val);
      this.uniformChanged();
    }
  }
  /**
   * How much the normals tilt outward across the blade, making flat blades shade as if curved.
   * 0 shades them flat.
   */
  get roundness() {
    return this._look.x;
  }
  set roundness(val: number) {
    val = Math.min(2, Math.max(0, val));
    if (val !== this._look.x) {
      this._look.x = val;
      this.uniformChanged();
    }
  }
  /**
   * How much a blade seen edge-on is widened toward the viewer, as a fraction of its width.
   * Keeps fields looking full from low angles. 0 disables it.
   */
  get viewThickening() {
    return this._look.y;
  }
  set viewThickening(val: number) {
    val = Math.min(2, Math.max(0, val));
    if (val !== this._look.y) {
      this._look.y = val;
      this.uniformChanged();
    }
  }
  /** Distance at which the blade normals start blending toward their clump's shared normal */
  get farNormalStart() {
    return this._look.z;
  }
  set farNormalStart(val: number) {
    val = Math.max(0, val);
    if (val !== this._look.z) {
      this._look.z = val;
      this.uniformChanged();
    }
  }
  /** Distance at which the blade normals are fully their clump's shared normal */
  get farNormalEnd() {
    return this._look.w;
  }
  set farNormalEnd(val: number) {
    val = Math.max(0, val);
    if (val !== this._look.w) {
      this._look.w = val;
      this.uniformChanged();
    }
  }
  /** Roughness the blades reach at the far normal end distance, dulling distant highlights */
  get farRoughness() {
    return this._look2.x;
  }
  set farRoughness(val: number) {
    val = Math.min(1, Math.max(0, val));
    if (val !== this._look2.x) {
      this._look2.x = val;
      this.uniformChanged();
    }
  }
  /**
   * How far the wind lays the blades over toward lying flat, per unit of wind push. 0 leaves
   * their lean alone.
   */
  get windLean() {
    return this._wind.x;
  }
  set windLean(val: number) {
    val = Math.min(4, Math.max(0, val));
    if (val !== this._wind.x) {
      this._wind.x = val;
      this.uniformChanged();
    }
  }
  /** How far the blade tips bob in the wind, as a fraction of the blade height per unit of push */
  get swayAmplitude() {
    return this._wind.y;
  }
  set swayAmplitude(val: number) {
    val = Math.min(1, Math.max(0, val));
    if (val !== this._wind.y) {
      this._wind.y = val;
      this.uniformChanged();
    }
  }
  /** How fast the blades bob in the wind, in radians per second */
  get swaySpeed() {
    return this._wind.z;
  }
  set swaySpeed(val: number) {
    val = Math.min(50, Math.max(0, val));
    if (val !== this._wind.z) {
      this._wind.z = val;
      this.uniformChanged();
    }
  }
  /** Color at the root of the blades */
  get rootColor(): Vector4 {
    return this._rootColor;
  }
  set rootColor(val: Vector4) {
    this._rootColor.set(val);
    this.uniformChanged();
  }
  /** Color at the tip of the blades */
  get tipColor(): Vector4 {
    return this._tipColor;
  }
  set tipColor(val: Vector4) {
    this._tipColor.set(val);
    this.uniformChanged();
  }
  /** @internal */
  setDrawDistance(distance: number) {
    this._drawDistance = distance;
    this.updateDistanceParams();
  }
  /** @internal */
  setFarDensity(farDensity: number) {
    this._farDensity = farDensity;
    this.updateDistanceParams();
  }
  /** @internal */
  private updateDistanceParams() {
    const distance = this._drawDistance;
    const lod = grassDensityLod(distance, this._farDensity);
    this._distanceFade.setXY(distance > 0 ? distance * 0.75 : 0, distance > 0 ? distance : 0);
    this._densityLod.setXY(lod[0], lod[1]);
    this.uniformChanged();
  }
  /** @internal */
  get occlusionDebug() {
    return !!this.featureUsed<boolean>(ClipmapBladeGrassMaterial.FEATURE_OCCLUSION_DEBUG);
  }
  set occlusionDebug(val: boolean) {
    this.useFeature(ClipmapBladeGrassMaterial.FEATURE_OCCLUSION_DEBUG, !!val);
  }
  isTransparentPass(_pass: number) {
    return false;
  }
  supportLighting() {
    return true;
  }
  supportInstancing() {
    return false;
  }
  applyUniformValues(bindGroup: BindGroup, ctx: DrawContext, pass: number) {
    super.applyUniformValues(bindGroup, ctx, pass);
    bindGroup.setBuffer('zBladeInstances', this._instances.get()!);
    bindGroup.setValue('zBladeShape', this._shape);
    bindGroup.setValue('zBladeLook', this._look);
    bindGroup.setValue('zBladeLook2', this._look2);
    bindGroup.setValue('zBladeWind', this._wind);
    bindGroup.setValue('zWindTime', this._windTime);
    bindGroup.setValue('zDistanceFade', this._distanceFade);
    bindGroup.setValue('zDensityLod', this._densityLod);
    bindGroup.setValue('zPrevCameraPos', this._prevCameraPos);
    if (this.needFragmentColor(ctx)) {
      bindGroup.setValue('zRootColor', this._rootColor);
      bindGroup.setValue('zTipColor', this._tipColor);
      bindGroup.setValue('zBladeRoundness', this._look.x);
      if (this._colorMap.get()) {
        bindGroup.setTexture('zColorMap', this._colorMap.get()!, fetchSampler('clamp_linear'));
      }
    }
  }
  /**
   * Emits the world position of the current vertex of a blade as seen from a camera position.
   * Only the density LOD depends on the camera; everything else comes from the instance.
   */
  private emitBladeVertex(
    scope: PBInsideFunctionScope,
    cameraPos: PBShaderExp,
    facingAngle: PBShaderExp,
    windPush: PBShaderExp,
    windTime: PBShaderExp,
    suffix: string
  ) {
    const pb = scope.$builder;
    const v = (name: string) => `${name}${suffix}`;
    // Blade frame: facing on the ground plane (already turned downwind by the placement pass),
    // width across it, tip leaning by the tilt, which the wind raises toward lying flat: the
    // "general bias away from the wind" of the Ghost of Tsushima talks
    scope.$l[v('facing')] = pb.vec3(pb.cos(facingAngle), 0, pb.sin(facingAngle));
    scope.$l[v('widthDir')] = pb.vec3(pb.neg(scope[v('facing')].z), 0, scope[v('facing')].x);
    scope.$l[v('tilt')] = pb.add(
      scope.inst3.z,
      pb.mul(pb.sub(1, scope.inst3.z), pb.clamp(pb.mul(windPush, scope.zBladeWind.x), 0, 0.95))
    );
    scope.$l[v('tiltAngle')] = pb.mul(scope[v('tilt')], Math.PI * 0.5);
    scope.$l[v('tipDir')] = pb.add(
      pb.mul(scope[v('facing')], pb.sin(scope[v('tiltAngle')])),
      pb.vec3(0, pb.cos(scope[v('tiltAngle')]), 0)
    );
    scope.$l[v('bendDir')] = pb.add(
      pb.mul(scope[v('facing')], pb.neg(pb.cos(scope[v('tiltAngle')]))),
      pb.vec3(0, pb.sin(scope[v('tiltAngle')]), 0)
    );
    // (width scale, overall scale), see ClipmapGrassMaterial
    scope.$l[v('bladeScale')] = pb.vec2(1);
    scope.$if(pb.greaterThan(scope.zDistanceFade.y, 0), function () {
      this.$l.bladeDist = pb.distance(cameraPos, this.base);
      this.$l.keep = pb.mix(
        1,
        this.zDensityLod.y,
        pb.smoothStep(this.zDensityLod.x, this.zDistanceFade.y, this.bladeDist)
      );
      this[v('bladeScale')] = pb.vec2(
        pb.div(1, this.keep),
        pb.mul(
          pb.sub(1, pb.smoothStep(this.zDistanceFade.x, this.zDistanceFade.y, this.bladeDist)),
          pb.clamp(pb.div(pb.sub(this.keep, this.lodHash), GRASS_LOD_FADE_BAND), 0, 1)
        )
      );
    });
    const s = scope[v('bladeScale')] as PBShaderExp;
    scope.$l[v('h')] = pb.mul(scope.inst3.x, s.y);
    scope.$l[v('halfWidth')] = pb.mul(
      scope.inst3.y,
      s.x,
      s.y,
      0.5,
      pb.mix(1, pb.sub(1, scope.t), scope.zBladeShape.x)
    );
    // Cubic Bezier from the base: tip from tilt and facing, middle points pushed away from the
    // base-tip line by the bend (up and back when the blade leans forward)
    scope.$l[v('p3')] = pb.mul(scope[v('tipDir')], scope[v('h')]);
    scope.$l[v('bendOffset')] = pb.mul(scope[v('bendDir')], pb.mul(scope.inst3.w, scope[v('h')]));
    scope.$l[v('p1')] = pb.add(pb.mul(scope[v('p3')], 1 / 3), scope[v('bendOffset')]);
    scope.$l[v('p2')] = pb.add(pb.mul(scope[v('p3')], 2 / 3), scope[v('bendOffset')]);
    // Sway: a sine bob of the upper control points, whose phase comes from the blade's hash and
    // the position along the blade (Ghost of Tsushima), scaled by the wind push. Applying it to
    // the last two control points with weights 2/3 and 1 follows cainrademan/Unity-Grass.
    scope.$l[v('swayPhase')] = pb.add(
      pb.mul(windTime, scope.zBladeWind.z),
      pb.mul(scope.inst2.w, Math.PI * 2)
    );
    scope.$l[v('swayAmount')] = pb.mul(scope.zBladeWind.y, scope[v('h')], windPush);
    scope[v('p2')] = pb.add(
      scope[v('p2')],
      pb.mul(
        scope[v('bendDir')],
        pb.mul(scope[v('swayAmount')], 2 / 3, pb.sin(pb.add(scope[v('swayPhase')], (Math.PI * 4) / 3)))
      )
    );
    scope[v('p3')] = pb.add(
      scope[v('p3')],
      pb.mul(scope[v('bendDir')], pb.mul(scope[v('swayAmount')], pb.sin(scope[v('swayPhase')])))
    );
    scope.$l[v('curve')] = pb.add(
      pb.mul(scope[v('p1')], pb.mul(3, scope.omt, scope.omt, scope.t)),
      pb.mul(scope[v('p2')], pb.mul(3, scope.omt, scope.t, scope.t)),
      pb.mul(scope[v('p3')], pb.mul(scope.t, scope.t, scope.t))
    );
    scope.$l[v('tangent')] = pb.add(
      pb.mul(scope[v('p1')], pb.mul(3, scope.omt, pb.sub(scope.omt, pb.mul(scope.t, 2)))),
      pb.mul(scope[v('p2')], pb.mul(3, scope.t, pb.sub(pb.mul(scope.omt, 2), scope.t))),
      pb.mul(scope[v('p3')], pb.mul(3, scope.t, scope.t))
    );
    // View-space thickening: when the blade's normal is nearly orthogonal to the view vector the
    // blade is seen edge-on, so its sides also step apart across the view. The response curve is
    // the one of the cainrademan/Unity-Grass reimplementation.
    scope.$l[v('centre')] = pb.add(scope.base, scope[v('curve')]);
    scope.$l[v('toCamera')] = pb.normalize(pb.sub(cameraPos, scope[v('centre')]));
    scope.$l[v('flatNormal')] = pb.normalize(pb.cross(scope[v('widthDir')], scope[v('tangent')]));
    scope.$l[v('edgeOn')] = pb.sub(
      1,
      pb.smoothStep(0, 0.3, pb.abs(pb.dot(scope[v('flatNormal')], scope[v('toCamera')])))
    );
    scope.$l[v('across')] = pb.cross(scope[v('toCamera')], pb.normalize(scope[v('tangent')]));
    // Keep the sides on the same side as the blade's own width, so the blade never folds over
    scope[v('across')] = pb.mul(
      scope[v('across')],
      pb.sub(pb.mul(pb.step(0, pb.dot(scope[v('across')], scope[v('widthDir')])), 2), 1)
    );
    scope.$l[v('worldPos')] = pb.add(
      scope[v('centre')],
      pb.mul(scope[v('widthDir')], pb.mul(scope.side, scope[v('halfWidth')])),
      pb.mul(
        scope[v('across')],
        pb.mul(scope.side, scope[v('halfWidth')], scope.zBladeLook.y, scope[v('edgeOn')])
      )
    );
  }
  vertexShader(scope: PBFunctionScope) {
    super.vertexShader(scope);
    const pb = scope.$builder;
    scope.zBladeInstances = pb.vec4[0]().storageBufferReadonly(2);
    scope.zBladeShape = pb.vec4().uniform(2);
    scope.zBladeLook = pb.vec4().uniform(2);
    scope.zBladeLook2 = pb.vec4().uniform(2);
    scope.zDistanceFade = pb.vec2().uniform(2);
    scope.zDensityLod = pb.vec2().uniform(2);
    scope.zPrevCameraPos = pb.vec4().uniform(2);
    // (wind lean, sway amplitude, sway speed, unused)
    scope.zBladeWind = pb.vec4().uniform(2);
    // (wind clock, previous wind clock)
    scope.zWindTime = pb.vec2().uniform(2);
    scope.$l.vid = pb.uint(scope.$builtins.vertexIndex);
    scope.$l.first = pb.mul(pb.uint(scope.$builtins.instanceIndex), BLADE_INSTANCE_VEC4);
    scope.$l.inst0 = scope.zBladeInstances.at(scope.first);
    scope.$l.inst1 = scope.zBladeInstances.at(pb.add(scope.first, 1));
    scope.$l.inst2 = scope.zBladeInstances.at(pb.add(scope.first, 2));
    scope.$l.inst3 = scope.zBladeInstances.at(pb.add(scope.first, 3));
    scope.$l.base = scope.inst0.xyz;
    // The placement pass adds 2 to the hash of blades it flags as occluded
    scope.$l.occluded = pb.step(1.5, scope.inst0.w);
    if (this.occlusionDebug) {
      scope.$outputs.zOccludedFlag = scope.occluded;
    }
    scope.$l.lodHash = pb.mul(pb.sub(scope.inst0.w, pb.mul(scope.occluded, 2)), 1 - GRASS_LOD_FADE_BAND);
    // Where the vertex lies along the blade and on which side. The pairs are spread toward the tip
    // by the tip detail exponent, the tip vertex sits on the center line.
    scope.$l.isTip = pb.greaterThanEqual(scope.vid, pb.uint(BLADE_VERTEX_COUNT - 1));
    scope.$l.along = pb.div(pb.float(pb.sar(scope.vid, 1)), BLADE_VERTEX_PAIRS);
    scope.along = pb.mix(scope.along, 1, pb.float(scope.isTip));
    scope.$l.t = pb.sub(1, pb.pow(pb.sub(1, scope.along), scope.zBladeShape.y));
    scope.$l.omt = pb.sub(1, scope.t);
    scope.$l.side = pb.mul(
      pb.sub(pb.mul(pb.float(pb.compAnd(scope.vid, pb.uint(1))), 2), 1),
      pb.sub(1, pb.float(scope.isTip))
    );
    // Instance: (facing, previous facing, wind push, previous wind push)
    this.emitBladeVertex(
      scope,
      ShaderHelper.getCameraPosition(scope),
      scope.inst1.x,
      scope.inst1.z,
      scope.zWindTime.x,
      ''
    );
    scope.$outputs.worldPos = scope.worldPos;
    scope.$outputs.worldNorm = scope.flatNormal;
    // For the rounded normals: which way is across the blade, and how far across this vertex is
    scope.$outputs.zBladeWidthDir = scope.widthDir;
    scope.$outputs.zBladeSide = scope.side;
    // Normal shared by the clump: the terrain normal leaned toward the clump's facing by the tilt
    scope.$l.clumpFacing = pb.vec3(pb.cos(scope.inst2.x), 0, pb.sin(scope.inst2.x));
    scope.$l.packedX = pb.floor(pb.div(scope.inst2.z, 4096));
    scope.$l.terrainXZ = pb.sub(
      pb.mul(pb.div(pb.vec2(scope.packedX, pb.sub(scope.inst2.z, pb.mul(scope.packedX, 4096))), 4095), 2),
      pb.vec2(1)
    );
    scope.$l.terrainNormal = pb.vec3(
      scope.terrainXZ.x,
      pb.sqrt(pb.max(0, pb.sub(1, pb.dot(scope.terrainXZ, scope.terrainXZ)))),
      scope.terrainXZ.y
    );
    scope.$outputs.zBladeClumpNormal = pb.normalize(
      pb.add(scope.terrainNormal, pb.mul(scope.clumpFacing, pb.mul(pb.sin(scope.tiltAngle), 0.5)))
    );
    // (blend toward the clump normal and the far roughness, far roughness)
    scope.$outputs.zBladeFar = pb.vec2(
      pb.smoothStep(
        scope.zBladeLook.z,
        pb.max(scope.zBladeLook.w, pb.add(scope.zBladeLook.z, 1e-3)),
        pb.distance(ShaderHelper.getCameraPosition(scope), scope.worldPos)
      ),
      scope.zBladeLook2.x
    );
    scope.$outputs.zBladeT = scope.t;
    scope.$outputs.zBladeClumpColor = scope.inst2.y;
    // Per-clump brightness, and ambient occlusion darkening toward the root
    scope.$outputs.zBladeBrightness = pb.max(
      0,
      pb.add(1, pb.mul(scope.zBladeShape.z, pb.sub(pb.mul(scope.inst2.y, 2), 1)))
    );
    scope.$outputs.zBladeAO = pb.sub(1, pb.mul(scope.zBladeShape.w, pb.sub(1, scope.t)));
    ShaderHelper.setClipSpacePosition(
      scope,
      pb.mul(ShaderHelper.getViewProjectionMatrix(scope), pb.vec4(scope.worldPos, 1))
    );
    if (ShaderHelper.getPrevUnjitteredViewProjectionMatrix(scope)) {
      // Where this vertex was last frame, for the motion vectors: the blade is rebuilt from last
      // frame's wind, wind clock and camera (for the density LOD fade and the thickening)
      this.emitBladeVertex(
        scope,
        scope.zPrevCameraPos.xyz,
        scope.inst1.y,
        scope.inst1.w,
        scope.zWindTime.y,
        'Prev'
      );
      ShaderHelper.resolveMotionVector(scope, scope.worldPos, scope.worldPosPrev);
    }
  }
  fragmentShader(scope: PBFunctionScope) {
    super.fragmentShader(scope);
    const pb = scope.$builder;
    if (this.needFragmentColor()) {
      scope.zRootColor = pb.vec4().uniform(2);
      scope.zTipColor = pb.vec4().uniform(2);
      scope.zBladeRoundness = pb.float().uniform(2);
      if (this.featureUsed<boolean>(ClipmapBladeGrassMaterial.FEATURE_COLOR_MAP)) {
        scope.zColorMap = pb.tex2D().uniform(2);
        scope.$l.albedo = pb.textureSampleLevel(
          scope.zColorMap,
          pb.vec2(scope.$inputs.zBladeClumpColor, scope.$inputs.zBladeT),
          0
        );
      } else {
        scope.$l.albedo = pb.mix(scope.zRootColor, scope.zTipColor, scope.$inputs.zBladeT);
      }
      // Per-clump brightness: splashes of variation across the field
      scope.albedo = pb.vec4(pb.mul(scope.albedo.rgb, scope.$inputs.zBladeBrightness), 1);
      if (this.occlusionDebug) {
        scope.albedo = pb.vec4(
          pb.mix(scope.albedo.rgb, pb.vec3(1, 0, 0), scope.$inputs.zOccludedFlag),
          scope.albedo.a
        );
      }
      scope.$l.litColor = pb.vec3(0);
      if (this.drawContext.renderPass!.type === RENDER_PASS_TYPE_LIGHT) {
        scope.$l.viewVec = this.calculateViewVector(scope, scope.$inputs.worldPos);
        // Both faces are lit from the side facing the viewer, then the normal tilts outward across
        // the blade (rounded normals) and, far away, blends toward the clump's shared normal
        scope.$l.towardViewer = pb.sub(
          pb.mul(pb.step(0, pb.dot(scope.$inputs.worldNorm, scope.viewVec)), 2),
          1
        );
        scope.$l.bladeNormal = pb.normalize(
          pb.add(
            pb.mul(pb.normalize(scope.$inputs.worldNorm), scope.towardViewer),
            pb.mul(scope.$inputs.zBladeWidthDir, pb.mul(scope.$inputs.zBladeSide, scope.zBladeRoundness))
          )
        );
        scope.bladeNormal = pb.normalize(
          pb.mix(scope.bladeNormal, pb.normalize(scope.$inputs.zBladeClumpNormal), scope.$inputs.zBladeFar.x)
        );
        scope.$l.normalInfo = this.calculateNormalAndTBN(scope, scope.$inputs.worldPos, scope.bladeNormal);
        scope.$l.litColor = this.PBRLight(
          scope,
          scope.$inputs.worldPos,
          scope.normalInfo.normal,
          scope.viewVec,
          scope.albedo,
          scope.normalInfo.TBN
        );
      }
      this.outputFragmentColor(scope, scope.$inputs.worldPos, pb.vec4(scope.litColor, 1));
    } else {
      this.outputFragmentColor(scope, scope.$inputs.worldPos, null);
    }
  }
  /** Distant blades get rougher, see farRoughness */
  calculateRoughness(scope: PBInsideFunctionScope, albedo: PBShaderExp, normal: PBShaderExp): PBShaderExp {
    const pb = scope.$builder;
    const roughness = super.calculateRoughness(scope, albedo, normal);
    return pb.mix(roughness, pb.max(roughness, scope.$inputs.zBladeFar.y), scope.$inputs.zBladeFar.x);
  }
  /** Ambient occlusion darkening toward the root, see MeshMaterial.getAmbientOcclusionFactor */
  getAmbientOcclusionFactor(scope: PBInsideFunctionScope): Nullable<PBShaderExp> {
    return scope.$inputs.zBladeAO;
  }
  protected updateRenderStates(pass: number, stateSet: RenderStateSet, ctx: DrawContext) {
    super.updateRenderStates(pass, stateSet, ctx);
    stateSet.useRasterizerState().setCullMode('none');
  }
  protected onDispose() {
    super.onDispose();
    this._instances.dispose();
    this._colorMap.dispose();
    this._terrain.dispose();
  }
}
