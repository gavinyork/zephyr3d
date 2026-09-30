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
import { RENDER_PASS_TYPE_LIGHT, RENDER_PASS_TYPE_SHADOWMAP } from '../../values';
import type { ClipmapTerrain } from './terrain-cm';
import { GRASS_BLADE_LOD_BAND, grassBladeLodDistance } from './grass_gpu';
import { fetchSampler } from '../../utility/misc';

/**
 * Vertex pairs across a blade at the high and the low detail level, each closed by one tip
 * vertex: 15 and 7 vertices, as in "Procedural Grass in Ghost of Tsushima" (Wohllaib, GDC 2021)
 */
const BLADE_HIGH_PAIRS = 7;
const BLADE_LOW_PAIRS = 3;
/**
 * First vertex index of the low detail level. The vertex index tells the vertex shader which
 * level it draws, so both draws share one program and one set of uniforms.
 */
const BLADE_LOW_VERTEX_BASE = 16;
/** Number of vec4 per blade instance, see GrassGpuPlacement */
export const BLADE_INSTANCE_VEC4 = 4;
/**
 * Index counts of the high and the low detail level, which follow each other in the index buffer
 * @internal
 */
export const BLADE_LOD_INDEX_COUNTS = [BLADE_HIGH_PAIRS, BLADE_LOW_PAIRS].map((pairs) => (pairs - 1) * 6 + 3);

/**
 * Triangle lists of a blade at the high then the low detail level: quads between consecutive
 * vertex pairs, closed by the tip. Vertex base + 2k is the left side of pair k, base + 2k + 1 the
 * right side, base + 2 * pairs the tip.
 * @internal
 */
export function createBladeIndices(): Uint16Array<ArrayBuffer> {
  const indices: number[] = [];
  const level = (base: number, pairs: number) => {
    for (let k = 0; k < pairs - 1; k++) {
      const a = base + 2 * k;
      indices.push(a, a + 1, a + 3, a, a + 3, a + 2);
    }
    const last = base + 2 * (pairs - 1);
    indices.push(last, last + 1, base + 2 * pairs);
  };
  level(0, BLADE_HIGH_PAIRS);
  level(BLADE_LOW_VERTEX_BASE, BLADE_LOW_PAIRS);
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
 * Two detail levels (see GrassGpuPlacement): near the switch distance, the three blades in four
 * that give way shrink away while the fourth widens to four times its width - Outerra's
 * procedural grass (outerra.blogspot.com, 2012) doubles the width for each halving of the blades
 * to keep the ground as covered, and a quarter of the blades is two halvings - and morphs toward
 * its low detail shape - the
 * talk blends the high detail vertices toward the low detail shape; each vertex here moves onto
 * the low detail outline the way CDLOD (Strugar, 2009) morphs terrain vertices onto the coarser
 * grid - so the switch does not pop.
 *
 * Instance data is written by the GPU placement pass (GrassGpuPlacement), four vec4 per blade:
 * - (base position xyz, 1 for a blade that gives way to the low detail level; +2 when flagged as
 *   occluded)
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
  /** Light let through from behind at the tip, see transmissionColor @internal */
  private readonly _transmissionColor: Vector4;
  /** @internal */
  private readonly _distanceFade: Vector2;
  /** (low detail distance, first instance of the low detail list, unused, unused) @internal */
  private readonly _lod: Vector4;
  /** @internal */
  private _lodDistance: number;
  /** @internal */
  private readonly _prevCameraPos: Vector4;
  /**
   * Position of the camera the blades were placed for. A shadow map pass renders from the
   * light, but the blades must take the shape they have in that camera's view to cast the
   * shadows of the blades seen. @internal
   */
  private readonly _viewCameraPos: Vector4;
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
    this._transmissionColor = new Vector4(0.45, 0.55, 0.12, 1);
    this._distanceFade = new Vector2(0, 0);
    this._lod = new Vector4(0, 0, 0, 0);
    this._lodDistance = 0;
    this._prevCameraPos = new Vector4();
    this._viewCameraPos = new Vector4();
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
    this._transmissionColor.set(other._transmissionColor);
    this._distanceFade.set(other._distanceFade);
    this._drawDistance = other._drawDistance;
    this._farDensity = other._farDensity;
    this._lodDistance = other._lodDistance;
    this.updateDistanceParams();
  }
  /**
   * Sets the instance buffer written by the GPU placement pass
   * @internal
   */
  setInstanceBuffer(buffer: Nullable<GPUDataBuffer>, lowListBase: number) {
    // Bound uniforms are only re-applied after uniformChanged(), and the placement pass
    // reallocates the buffer whenever its placement window grows
    if (buffer !== this._instances.get() || lowListBase !== this._lod.y) {
      this._instances.set(buffer);
      this._lod.y = lowListBase;
      this.uniformChanged();
    }
  }
  /**
   * Distance at which the blades switch to the low detail level; 0 keeps them all at high detail
   * @internal
   */
  get lodDistance() {
    return this._lodDistance;
  }
  set lodDistance(val: number) {
    val = Math.max(0, val);
    if (val !== this._lodDistance) {
      this._lodDistance = val;
      this.updateDistanceParams();
    }
  }
  /**
   * Updates the per-frame values before drawing for a camera: the camera position the blades are
   * shaped for, and the previous one the motion vectors are computed against
   * @internal
   */
  prepareDraw(camera: Camera, wind: Nullable<WindField>) {
    const pos = camera.getWorldPosition(ClipmapBladeGrassMaterial._tmpPos);
    const c = this._viewCameraPos;
    if (c.x !== pos.x || c.y !== pos.y || c.z !== pos.z) {
      c.setXYZW(pos.x, pos.y, pos.z, 0);
      this.uniformChanged();
    }
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
  /**
   * Color of the light the blades let through from behind - the subsurface color of UE5's
   * two-sided foliage - at the tip. Black lets none through.
   */
  get transmissionColor(): Vector4 {
    return this._transmissionColor;
  }
  set transmissionColor(val: Vector4) {
    this._transmissionColor.set(val);
    this.uniformChanged();
  }
  /** @internal */
  setDrawDistance(distance: number) {
    this._drawDistance = distance;
    this.updateDistanceParams();
  }
  /**
   * Kept for the interface shared with the card material: blades thin out by their detail levels
   * instead
   * @internal
   */
  setFarDensity(farDensity: number) {
    this._farDensity = farDensity;
  }
  /** @internal */
  private updateDistanceParams() {
    const distance = this._drawDistance;
    this._distanceFade.setXY(distance > 0 ? distance * 0.75 : 0, distance > 0 ? distance : 0);
    // The same switch distance as the placement pass
    this._lod.x = grassBladeLodDistance(this._lodDistance, distance);
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
    bindGroup.setValue('zBladeLod', this._lod);
    bindGroup.setValue('zPrevCameraPos', this._prevCameraPos);
    if (ctx.renderPass!.type === RENDER_PASS_TYPE_SHADOWMAP) {
      bindGroup.setValue('zViewCameraPos', this._viewCameraPos);
    }
    if (this.needFragmentColor(ctx)) {
      bindGroup.setValue('zRootColor', this._rootColor);
      bindGroup.setValue('zTipColor', this._tipColor);
      bindGroup.setValue('zBladeTransmission', this._transmissionColor);
      bindGroup.setValue('zBladeRoundness', this._look.x);
      if (this._colorMap.get()) {
        bindGroup.setTexture('zColorMap', this._colorMap.get()!, fetchSampler('clamp_linear'));
      }
    }
  }
  /**
   * Emits the world position and flat normal of the current vertex of a blade as seen from a
   * camera position, into `worldPos` and `flatNormal` suffixed by `suffix`. The camera position
   * drives the detail level transition, the draw distance fade and the view-space thickening.
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
    // Detail level transition over the last band before the switch distance: 0 before it, 1 at and
    // past it, which is where every blade of the low detail list is
    scope.$l[v('bladeDist')] = pb.distance(cameraPos, scope.base);
    scope.$l[v('lodFade')] = pb.smoothStep(
      pb.mul(scope.zBladeLod.x, 1 - GRASS_BLADE_LOD_BAND),
      scope.zBladeLod.x,
      scope[v('bladeDist')]
    );
    // (width scale, overall scale): the blades that stay widen to four times their width, the others
    // shrink away; everything shrinks into the ground over the last quarter of the draw distance
    scope.$l[v('bladeScale')] = pb.vec2(
      pb.add(1, pb.mul(scope[v('lodFade')], 3)),
      pb.sub(1, pb.mul(scope.extra, scope[v('lodFade')]))
    );
    scope.$if(pb.greaterThan(scope.zDistanceFade.y, 0), function () {
      this[v('bladeScale')] = pb.vec2(
        this[v('bladeScale')].x,
        pb.mul(
          this[v('bladeScale')].y,
          pb.sub(1, pb.smoothStep(this.zDistanceFade.x, this.zDistanceFade.y, this[v('bladeDist')]))
        )
      );
    });
    const s = scope[v('bladeScale')] as PBShaderExp;
    scope.$l[v('h')] = pb.mul(scope.inst3.x, s.y);
    scope.$l[v('widthScale')] = pb.mul(scope.inst3.y, s.x, s.y, 0.5);
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
    // Point of the blade at curve parameter t on side `side` (-1, 1, 0 on the center line), into
    // `${tag}Pos` and `${tag}Normal`
    const point = (sc: PBInsideFunctionScope, t: PBShaderExp, side: PBShaderExp, tag: string) => {
      sc.$l[`${tag}T`] = t;
      sc.$l[`${tag}Omt`] = pb.sub(1, sc[`${tag}T`]);
      const tt = sc[`${tag}T`] as PBShaderExp;
      const omt = sc[`${tag}Omt`] as PBShaderExp;
      sc.$l[`${tag}Curve`] = pb.add(
        pb.mul(sc[v('p1')], pb.mul(3, omt, omt, tt)),
        pb.mul(sc[v('p2')], pb.mul(3, omt, tt, tt)),
        pb.mul(sc[v('p3')], pb.mul(tt, tt, tt))
      );
      sc.$l[`${tag}Tangent`] = pb.add(
        pb.mul(sc[v('p1')], pb.mul(3, omt, pb.sub(omt, pb.mul(tt, 2)))),
        pb.mul(sc[v('p2')], pb.mul(3, tt, pb.sub(pb.mul(omt, 2), tt))),
        pb.mul(sc[v('p3')], pb.mul(3, tt, tt))
      );
      sc.$l[`${tag}HalfWidth`] = pb.mul(sc[v('widthScale')], pb.mix(1, omt, sc.zBladeShape.x));
      // View-space thickening: when the blade's normal is nearly orthogonal to the view vector the
      // blade is seen edge-on, so its sides also step apart across the view. The response curve
      // is the one of the cainrademan/Unity-Grass reimplementation.
      sc.$l[`${tag}Centre`] = pb.add(sc.base, sc[`${tag}Curve`]);
      sc.$l[`${tag}ToCamera`] = pb.normalize(pb.sub(cameraPos, sc[`${tag}Centre`]));
      sc.$l[`${tag}Normal`] = pb.normalize(pb.cross(sc[v('widthDir')], sc[`${tag}Tangent`]));
      sc.$l[`${tag}EdgeOn`] = pb.sub(
        1,
        pb.smoothStep(0, 0.3, pb.abs(pb.dot(sc[`${tag}Normal`], sc[`${tag}ToCamera`])))
      );
      sc.$l[`${tag}Across`] = pb.cross(sc[`${tag}ToCamera`], pb.normalize(sc[`${tag}Tangent`]));
      // Keep the sides on the same side as the blade's own width, so the blade never folds over
      sc[`${tag}Across`] = pb.mul(
        sc[`${tag}Across`],
        pb.sub(pb.mul(pb.step(0, pb.dot(sc[`${tag}Across`], sc[v('widthDir')])), 2), 1)
      );
      sc.$l[`${tag}Pos`] = pb.add(
        sc[`${tag}Centre`],
        pb.mul(sc[v('widthDir')], pb.mul(side, sc[`${tag}HalfWidth`])),
        pb.mul(sc[`${tag}Across`], pb.mul(side, sc[`${tag}HalfWidth`], sc.zBladeLook.y, sc[`${tag}EdgeOn`]))
      );
    };
    point(scope, scope.t, scope.side, v('zv'));
    scope.$l[v('worldPos')] = scope[`${v('zv')}Pos`];
    scope.$l[v('flatNormal')] = scope[`${v('zv')}Normal`];
    // Through the transition band the high detail vertices move onto the low detail outline: a
    // vertex at `along` lands between the two low detail vertices around it, in proportion, as
    // CDLOD (Strugar, 2009) morphs terrain vertices onto the coarser grid. The tip vertex is on
    // both outlines already.
    //
    // Only this frame's vertex is morphed; last frame's takes the same morph offset. Morphing it
    // again from last frame's inputs left the motion vectors NaN across the band with TAA on (the
    // same code runs clean for this frame, the cause was not pinned down), and the offset changes
    // little in a frame: the morph spans the last quarter of the switch distance.
    if (suffix) {
      scope[v('worldPos')] = pb.add(scope[v('worldPos')], scope.zMorphOffset);
      return;
    }
    scope.$l.zMorphOffset = pb.vec3(0);
    scope.$if(pb.and(pb.not(scope.isLow), pb.greaterThan(scope[v('lodFade')], 0)), function () {
      this.$l[v('ma')] = pb.mul(this.along, BLADE_LOW_PAIRS);
      this.$l[v('mj')] = pb.min(pb.floor(this[v('ma')]), BLADE_LOW_PAIRS - 1);
      this.$l[v('mf')] = pb.sub(this[v('ma')], this[v('mj')]);
      // Past the last low detail pair comes the tip, on the center line
      this.$l[v('mSide')] = pb.mul(this.side, pb.step(this[v('mj')], BLADE_LOW_PAIRS - 2));
      point(this, this.zAlongToT(pb.div(this[v('mj')], BLADE_LOW_PAIRS)), this.side, v('zm0'));
      point(
        this,
        this.zAlongToT(pb.div(pb.add(this[v('mj')], 1), BLADE_LOW_PAIRS)),
        this[v('mSide')],
        v('zm1')
      );
      this.zMorphOffset = pb.mul(
        pb.sub(pb.mix(this[`${v('zm0')}Pos`], this[`${v('zm1')}Pos`], this[v('mf')]), this[v('worldPos')]),
        this[v('lodFade')]
      );
      this[v('worldPos')] = pb.add(this[v('worldPos')], this.zMorphOffset);
    });
  }
  vertexShader(scope: PBFunctionScope) {
    super.vertexShader(scope);
    const pb = scope.$builder;
    scope.zBladeInstances = pb.vec4[0]().storageBufferReadonly(2);
    scope.zBladeShape = pb.vec4().uniform(2);
    scope.zBladeLook = pb.vec4().uniform(2);
    scope.zBladeLook2 = pb.vec4().uniform(2);
    scope.zDistanceFade = pb.vec2().uniform(2);
    // (low detail distance, first instance of the low detail list, unused, unused)
    scope.zBladeLod = pb.vec4().uniform(2);
    scope.zPrevCameraPos = pb.vec4().uniform(2);
    // (wind lean, sway amplitude, sway speed, unused)
    scope.zBladeWind = pb.vec4().uniform(2);
    // (wind clock, previous wind clock)
    scope.zWindTime = pb.vec2().uniform(2);
    // Shadow map passes render from the light: the blades are shaped for the camera they were
    // placed for instead, see _viewCameraPos
    const shadowPass = this.drawContext.renderPass!.type === RENDER_PASS_TYPE_SHADOWMAP;
    if (shadowPass) {
      scope.zViewCameraPos = pb.vec4().uniform(2);
    }
    scope.$l.zBladeViewPos = shadowPass ? scope.zViewCameraPos.xyz : ShaderHelper.getCameraPosition(scope);
    // Position along the blade (0 at the root, 1 at the tip) to curve parameter: the vertices are
    // spread toward the tip by the tip detail exponent
    pb.func('zAlongToT', [pb.float('a')], function () {
      this.$return(pb.sub(1, pb.pow(pb.sub(1, this.a), this.zBladeShape.y)));
    });
    // The vertex index tells the detail level: the low detail draw's indices start at
    // BLADE_LOW_VERTEX_BASE, and its instances at the low detail list
    scope.$l.isLow = pb.greaterThanEqual(
      pb.uint(scope.$builtins.vertexIndex),
      pb.uint(BLADE_LOW_VERTEX_BASE)
    );
    scope.$l.vid = pb.sub(
      pb.uint(scope.$builtins.vertexIndex),
      scope.$choice(scope.isLow, pb.uint(BLADE_LOW_VERTEX_BASE), pb.uint(0))
    );
    scope.$l.pairs = scope.$choice(scope.isLow, pb.float(BLADE_LOW_PAIRS), pb.float(BLADE_HIGH_PAIRS));
    scope.$l.first = pb.mul(
      pb.add(
        pb.uint(scope.$builtins.instanceIndex),
        scope.$choice(scope.isLow, pb.uint(scope.zBladeLod.y), pb.uint(0))
      ),
      BLADE_INSTANCE_VEC4
    );
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
    // 1 for a blade that gives way to the low detail level
    scope.$l.extra = pb.sub(scope.inst0.w, pb.mul(scope.occluded, 2));
    // Where the vertex lies along the blade and on which side; the tip vertex sits on the center
    // line
    scope.$l.isTip = pb.greaterThanEqual(scope.vid, pb.uint(pb.mul(scope.pairs, 2)));
    scope.$l.along = pb.div(pb.float(pb.sar(scope.vid, 1)), scope.pairs);
    scope.along = pb.mix(scope.along, 1, pb.float(scope.isTip));
    scope.$l.t = scope.zAlongToT(scope.along);
    scope.$l.side = pb.mul(
      pb.sub(pb.mul(pb.float(pb.compAnd(scope.vid, pb.uint(1))), 2), 1),
      pb.sub(1, pb.float(scope.isTip))
    );
    // Instance: (facing, previous facing, wind push, previous wind push)
    this.emitBladeVertex(scope, scope.zBladeViewPos, scope.inst1.x, scope.inst1.z, scope.zWindTime.x, '');
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
        pb.distance(scope.zBladeViewPos, scope.worldPos)
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
      scope.zBladeTransmission = pb.vec4().uniform(2);
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
  /**
   * Light through the blade from behind, see MeshMaterial.getSubsurfaceColor. Ghost of Tsushima's
   * blades are thick and let little light through at the root and more toward the tip; here it
   * grows linearly along the blade up to the transmission color.
   */
  getSubsurfaceColor(scope: PBInsideFunctionScope): Nullable<PBShaderExp> {
    const pb = scope.$builder;
    return pb.mul(scope.zBladeTransmission.rgb, scope.$inputs.zBladeT);
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
