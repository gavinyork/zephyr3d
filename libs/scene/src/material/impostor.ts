import type {
  BindGroup,
  PBFunctionScope,
  PBInsideFunctionScope,
  PBShaderExp,
  Texture2D
} from '@zephyr3d/device';
import type { Clonable, Nullable } from '@zephyr3d/base';
import { DRef, Vector4 } from '@zephyr3d/base';
import { PBRMetallicRoughnessMaterial } from './pbrmr';
import { ShaderHelper } from './shader/helper';
import type { DrawContext } from '../render';
import { fetchSampler } from '../utility/misc';
import { RENDER_PASS_TYPE_SHADOWMAP } from '../values';

const tmpBounds = new Vector4();
/** Atlas coordinates of the three frames, per fragment shader main scope */
const atlasUVs = new WeakMap<object, PBShaderExp[]>();
const tmpGrid = new Vector4();

/**
 * What an impostor shows instead of its lit colour, to check the baked atlases, see
 * ImpostorMaterial.debugOutput
 * @public
 */
export type ImpostorDebugOutput =
  | 'none'
  | 'albedo'
  | 'normal'
  | 'depth'
  | 'occlusion'
  | 'roughness'
  | 'metallic'
  | 'subsurface';

const DEBUG_OUTPUTS: readonly ImpostorDebugOutput[] = [
  'none',
  'albedo',
  'normal',
  'depth',
  'occlusion',
  'roughness',
  'metallic',
  'subsurface'
];

/**
 * Draws an octahedral impostor baked by ImpostorBaker: a quad facing the view, showing the three
 * captured frames nearest the view direction blended together, lit as the object would be from
 * the surface attributes the frames hold.
 *
 * @remarks
 * The mesh is a quad with corners at (±1, ±1, 0) and the bounding box of the baked object, drawn
 * with the object's transform (uniform scale). Follows the Godot Octahedral Impostors runtime
 * shader (wojtekpil, MIT, `ImpostorShader.shader`):
 *
 * - The quad faces the view and is pushed towards it by the bounding radius, as UE ImpostorBaker's
 *   Camera Push, so the ground the object stands on does not cut it.
 * - The view direction in the object's space picks a cell of the frame grid, cut along its
 *   diagonal; the triangle it falls in gives three frames and their barycentric weights.
 * - Each vertex's view ray is intersected with the plane each frame was captured on, giving the
 *   frame's coordinates there ("virtual plane" coordinates).
 * - Each frame is offset once by its depth along the ray (single sample parallax), then sampled.
 *
 * Only the colour, normal, occlusion, roughness and metallic of the object reach the lighting; it
 * has no emission, clearcoat or sheen.
 *
 * @public
 */
export class ImpostorMaterial extends PBRMetallicRoughnessMaterial implements Clonable<ImpostorMaterial> {
  private readonly _baseTexture: DRef<Texture2D>;
  private readonly _normalDepthTexture: DRef<Texture2D>;
  private readonly _ormTexture: DRef<Texture2D>;
  private readonly _subsurfaceTexture: DRef<Texture2D>;
  private _center: [number, number, number];
  private _radius: number;
  private _frames: number;
  private _hemisphere: boolean;
  private _parallax: number;
  private _debugOutput: ImpostorDebugOutput;
  constructor() {
    super();
    this._baseTexture = new DRef();
    this._normalDepthTexture = new DRef();
    this._ormTexture = new DRef();
    this._subsurfaceTexture = new DRef();
    this._center = [0, 0, 0];
    this._radius = 1;
    this._frames = 12;
    this._hemisphere = true;
    this._parallax = 1;
    this._debugOutput = 'none';
    this.vertexNormal = false;
    this.vertexTangent = false;
    this.cullMode = 'none';
    this.alphaCutoff = 0.3;
  }
  clone(): ImpostorMaterial {
    const other = new ImpostorMaterial();
    other.copyFrom(this);
    return other;
  }
  copyFrom(other: this) {
    super.copyFrom(other);
    if (other instanceof ImpostorMaterial) {
      this.baseTexture = other.baseTexture;
      this.normalDepthTexture = other.normalDepthTexture;
      this.ormTexture = other.ormTexture;
      this.transmissionAtlas = other.transmissionAtlas;
      this.setBounds(other._center, other._radius);
      this.frames = other.frames;
      this.hemisphere = other.hemisphere;
      this.parallax = other.parallax;
    }
  }
  /** Base colour and opacity atlas */
  get baseTexture() {
    return this._baseTexture.get();
  }
  set baseTexture(tex: Nullable<Texture2D>) {
    this._baseTexture.set(tex);
    this.uniformChanged();
  }
  /** Normal in the object's space and depth atlas */
  get normalDepthTexture() {
    return this._normalDepthTexture.get();
  }
  set normalDepthTexture(tex: Nullable<Texture2D>) {
    this._normalDepthTexture.set(tex);
    this.uniformChanged();
  }
  /** Occlusion, roughness and metallic atlas */
  get ormTexture() {
    return this._ormTexture.get();
  }
  set ormTexture(tex: Nullable<Texture2D>) {
    this._ormTexture.set(tex);
    this.uniformChanged();
  }
  /**
   * Colour of the light the object lets through from behind, atlas; null when it lets none
   * through. Lit as the object is, see MeshMaterial.getSubsurfaceColor. Not named
   * subsurfaceTexture, which PBRMetallicRoughnessMaterial's (deprecated) subsurface scattering
   * texture property already is, defined on each instance and so hiding an accessor here.
   */
  get transmissionAtlas() {
    return this._subsurfaceTexture.get();
  }
  set transmissionAtlas(tex: Nullable<Texture2D>) {
    if (tex !== this._subsurfaceTexture.get()) {
      this._subsurfaceTexture.set(tex);
      this.optionChanged(true);
    }
  }
  /** Frames along each side of the grid */
  get frames() {
    return this._frames;
  }
  set frames(val: number) {
    this._frames = Math.max(2, Math.floor(val));
    this.uniformChanged();
  }
  /** Whether the frames only cover views from above the horizon */
  get hemisphere() {
    return this._hemisphere;
  }
  set hemisphere(val: boolean) {
    this._hemisphere = !!val;
    this.uniformChanged();
  }
  /** How far the frames are shifted by their depth along the view, 0 for flat, 1 for as captured */
  get parallax() {
    return this._parallax;
  }
  set parallax(val: number) {
    this._parallax = Math.max(0, val);
    this.uniformChanged();
  }
  /**
   * Shows one baked attribute instead of the lit colour (world space normal), to check the
   * atlases as they are sampled. Not saved.
   */
  get debugOutput() {
    return this._debugOutput;
  }
  set debugOutput(val: ImpostorDebugOutput) {
    this._debugOutput = DEBUG_OUTPUTS.includes(val) ? val : 'none';
    this.uniformChanged();
  }
  /**
   * Sets the bounding sphere the frames were captured around, in the object's space
   * @param center - Centre of the sphere
   * @param radius - Radius of the sphere
   */
  setBounds(center: [number, number, number], radius: number) {
    this._center = [center[0], center[1], center[2]];
    this._radius = Math.max(radius, 1e-6);
    this.uniformChanged();
  }
  vertexShader(scope: PBFunctionScope) {
    // The mixins' vertex work (instancing, skinning flags), without the vertex position and
    // normal PBRMetallicRoughnessMaterial computes for a regular mesh
    (
      Object.getPrototypeOf(PBRMetallicRoughnessMaterial.prototype) as {
        vertexShader(this: unknown, scope: PBFunctionScope): void;
      }
    ).vertexShader.call(this, scope);
    const pb = scope.$builder;
    scope.zImpostorBounds = pb.vec4().uniform(2);
    scope.zImpostorGrid = pb.vec4().uniform(2);
    declareGridFunctions(scope);
    scope.$inputs.zImpostorCorner = pb.vec3().attrib('position');
    scope.$l.worldMatrix = ShaderHelper.getWorldMatrix(scope);
    scope.$l.scale = pb.max(pb.length(scope.worldMatrix[0].xyz), 1e-6);
    scope.$l.rot = pb.mat3(
      pb.div(scope.worldMatrix[0].xyz, scope.scale),
      pb.div(scope.worldMatrix[1].xyz, scope.scale),
      pb.div(scope.worldMatrix[2].xyz, scope.scale)
    );
    scope.$l.invRot = pb.transpose(scope.rot);
    scope.$l.center = scope.zImpostorBounds.xyz;
    scope.$l.radius = scope.zImpostorBounds.w;
    scope.$l.pivot = pb.mul(scope.worldMatrix, pb.vec4(scope.center, 1)).xyz;
    scope.$l.worldRadius = pb.mul(scope.radius, scope.scale);
    // Towards the view: along the camera's back axis for an orthographic view (shadow maps of
    // directional lights), towards its position otherwise
    scope.$l.cameraWorld = ShaderHelper.getInvViewMatrix(scope);
    scope.$l.ortho = pb.greaterThan(ShaderHelper.getProjectionMatrix(scope)[3].w, 0.5);
    scope.$l.cameraPos = ShaderHelper.getCameraPosition(scope);
    scope.$l.toCamera = pb.normalize(
      pb.select(pb.sub(scope.cameraPos, scope.pivot), scope.cameraWorld[2].xyz, scope.ortho)
    );
    // The quad, facing the view and pushed towards it by the radius. Casting shadows it is pushed
    // away from the light instead, as Godot's shadow pass does (negative aabb_max), or it would
    // shadow itself: its pixels then lie behind the depth it casts
    const push = this.drawContext.renderPass!.type === RENDER_PASS_TYPE_SHADOWMAP ? -1 : 1;
    scope.$l.up = pb.select(
      pb.vec3(0, 1, 0),
      pb.vec3(0, 0, -1),
      pb.greaterThan(pb.abs(scope.toCamera.y), 0.999)
    );
    scope.$l.quadX = pb.normalize(pb.cross(scope.up, scope.toCamera));
    scope.$l.quadY = pb.cross(scope.toCamera, scope.quadX);
    scope.$l.worldPos = pb.add(
      scope.pivot,
      pb.mul(
        pb.add(
          pb.mul(scope.quadX, scope.$inputs.zImpostorCorner.x),
          pb.mul(scope.quadY, scope.$inputs.zImpostorCorner.y),
          pb.mul(scope.toCamera, push)
        ),
        scope.worldRadius
      )
    );
    scope.$outputs.worldPos = scope.worldPos;
    // Towards the view and the world radius, to place the surface at its baked depth
    scope.$outputs.zImpostorPush = pb.vec4(scope.toCamera, scope.worldRadius);
    ShaderHelper.resolveMotionVector(scope, scope.worldPos, scope.worldPos);
    scope.$l.csPos = pb.mul(ShaderHelper.getViewProjectionMatrix(scope), pb.vec4(scope.worldPos, 1));
    ShaderHelper.setClipSpacePosition(scope, scope.csPos);
    // In the object's space: the view direction picks the frames, the ray through the vertex
    // finds where it crosses each frame's plane
    scope.$l.dirObj = pb.normalize(pb.mul(scope.invRot, scope.toCamera));
    scope.$l.vertexObj = pb.add(
      scope.center,
      pb.div(pb.mul(scope.invRot, pb.sub(scope.worldPos, scope.pivot)), scope.scale)
    );
    scope.$l.cameraObj = pb.add(
      scope.center,
      pb.div(pb.mul(scope.invRot, pb.sub(scope.cameraPos, scope.pivot)), scope.scale)
    );
    scope.$l.rayObj = pb.select(
      pb.normalize(pb.sub(scope.vertexObj, scope.cameraObj)),
      pb.neg(scope.dirObj),
      scope.ortho
    );
    scope.$l.frames = scope.zImpostorGrid.x;
    scope.$l.grid = pb.mul(scope.Z_impostorVectorToGrid(scope.dirObj), pb.sub(scope.frames, 1));
    scope.$l.cell = pb.clamp(pb.floor(scope.grid), pb.vec2(0), pb.vec2(pb.sub(scope.frames, 2)));
    scope.$l.fr = pb.clamp(pb.sub(scope.grid, scope.cell), pb.vec2(0), pb.vec2(1));
    // Godot's TriangleInterpolator: the cell cut along its diagonal
    scope.$l.second = pb.select(pb.vec2(0, 1), pb.vec2(1, 0), pb.greaterThan(scope.fr.x, scope.fr.y));
    scope.$outputs.zImpostorFrame = pb.vec4(scope.cell, scope.second);
    scope.$outputs.zImpostorWeights = pb.vec3(
      pb.min(pb.sub(1, scope.fr.x), pb.sub(1, scope.fr.y)),
      pb.abs(pb.sub(scope.fr.x, scope.fr.y)),
      pb.min(scope.fr.x, scope.fr.y)
    );
    scope.$l.uvRay0 = scope.Z_impostorFrameUV(scope.cell, scope.vertexObj, scope.rayObj);
    scope.$l.uvRay1 = scope.Z_impostorFrameUV(
      pb.add(scope.cell, scope.second),
      scope.vertexObj,
      scope.rayObj
    );
    scope.$l.uvRay2 = scope.Z_impostorFrameUV(pb.add(scope.cell, pb.vec2(1)), scope.vertexObj, scope.rayObj);
    scope.$outputs.zImpostorUV01 = pb.vec4(scope.uvRay0.xy, scope.uvRay1.xy);
    scope.$outputs.zImpostorUV2Ray2 = pb.vec4(scope.uvRay2.xy, scope.uvRay2.zw);
    scope.$outputs.zImpostorRay01 = pb.vec4(scope.uvRay0.zw, scope.uvRay1.zw);
    scope.$outputs.zImpostorRotX = scope.rot[0];
    scope.$outputs.zImpostorRotY = scope.rot[1];
    scope.$outputs.zImpostorRotZ = scope.rot[2];
  }
  fragmentShader(scope: PBFunctionScope) {
    const pb = scope.$builder;
    const shadowPass = this.drawContext.renderPass!.type === RENDER_PASS_TYPE_SHADOWMAP;
    if (this.needFragmentColorInput()) {
      scope.zImpostorGrid = pb.vec4().uniform(2);
      scope.zImpostorBase = pb.tex2D().uniform(2);
      scope.zImpostorNormalDepth = pb.tex2D().uniform(2);
      scope.zImpostorORM = pb.tex2D().uniform(2);
      scope.zImpostorDebug = pb.float().uniform(2);
      if (this._subsurfaceTexture.get()) {
        scope.zImpostorSubsurface = pb.tex2D().uniform(2);
      }
      if (shadowPass) {
        // Sampled first, in uniform control flow: the alpha test below may discard
        scope.$l.zImpostorShadowDepth = this.blendFrames(
          scope,
          scope.zImpostorNormalDepth,
          this.impostorAtlasUVs(scope)
        ).a;
      }
    }
    super.fragmentShader(scope);
    if (shadowPass && this.needFragmentColorInput()) {
      // Depth derived pixel depth offset (UE ImpostorBaker), for shadows only: the quad lies a
      // radius off the object, and parts of it would sink into the ground and cast nothing
      // there, cutting the shadow along a straight line. The depth of the surface the frames
      // show is written instead, as the object itself would have.
      scope.$l.zImpostorShadowPos = this.impostorSurfacePos(
        scope,
        scope.$inputs.worldPos,
        scope.zImpostorShadowDepth
      );
      scope.$l.zImpostorShadowClip = pb.mul(
        ShaderHelper.getViewProjectionMatrix(scope),
        pb.vec4(scope.zImpostorShadowPos, 1)
      );
      // Clamped as the emulated depth clamp of the shadow pass clamps it (ProgramBuilder)
      scope.$builtins.fragDepth = pb.clamp(
        pb.div(scope.zImpostorShadowClip.z, scope.zImpostorShadowClip.w),
        0,
        1
      );
    }
  }
  /**
   * Where the surface the frames show lies, for a point of the quad: along the view by its baked
   * depth, (depth - 0.5)·2R from the centre of the bounds, depth being 1 at the front. The quad is
   * pushed a radius towards the view, or away from a light it casts shadows of.
   */
  private impostorSurfacePos(scope: PBInsideFunctionScope, quadPos: PBShaderExp, depth: PBShaderExp) {
    const pb = scope.$builder;
    const toView = scope.$inputs.zImpostorPush;
    const push = this.drawContext.renderPass!.type === RENDER_PASS_TYPE_SHADOWMAP ? -1 : 1;
    return pb.add(quadPos, pb.mul(toView.xyz, toView.w, pb.sub(pb.sub(pb.mul(depth, 2), 1), push)));
  }
  /** The three frames' atlas coordinates, each shifted by its depth along the view */
  private impostorAtlasUVs(scope: PBInsideFunctionScope) {
    const pb = scope.$builder;
    const cached = atlasUVs.get(scope);
    if (cached) {
      return cached;
    }
    {
      const frames = scope.zImpostorGrid.x;
      const inputs = scope.$inputs;
      const cell = inputs.zImpostorFrame.xy;
      const second = inputs.zImpostorFrame.zw;
      const atlas = (frame: PBShaderExp, uv: PBShaderExp) => {
        // Half a texel of a frame inside its edges, so sampling stays in the frame
        const margin = pb.div(pb.mul(frames, 0.5), scope.zImpostorGrid.w);
        const local = pb.clamp(uv, pb.vec2(margin), pb.vec2(pb.sub(1, margin)));
        return impostorAtlasCoord(pb, frame, local, frames);
      };
      const shifted = (frame: PBShaderExp, uv: PBShaderExp, ray: PBShaderExp) => {
        const depth = pb.textureSample(scope.zImpostorNormalDepth, atlas(frame, uv)).a;
        return atlas(frame, pb.add(uv, pb.mul(ray, pb.sub(0.5, depth), scope.zImpostorGrid.z)));
      };
      scope.$l.zImpostorAtlasUV0 = shifted(cell, inputs.zImpostorUV01.xy, inputs.zImpostorRay01.xy);
      scope.$l.zImpostorAtlasUV1 = shifted(
        pb.add(cell, second),
        inputs.zImpostorUV01.zw,
        inputs.zImpostorRay01.zw
      );
      scope.$l.zImpostorAtlasUV2 = shifted(
        pb.add(cell, pb.vec2(1)),
        inputs.zImpostorUV2Ray2.xy,
        inputs.zImpostorUV2Ray2.zw
      );
    }
    const uvs = [scope.zImpostorAtlasUV0, scope.zImpostorAtlasUV1, scope.zImpostorAtlasUV2] as PBShaderExp[];
    atlasUVs.set(scope, uvs);
    return uvs;
  }
  /** Blends a texture sampled at the three frames by their weights */
  private blendFrames(scope: PBInsideFunctionScope, tex: PBShaderExp, uvs: PBShaderExp[]) {
    const pb = scope.$builder;
    const w = scope.$inputs.zImpostorWeights;
    return pb.add(
      pb.mul(pb.textureSample(tex, uvs[0]), w.x),
      pb.mul(pb.textureSample(tex, uvs[1]), w.y),
      pb.mul(pb.textureSample(tex, uvs[2]), w.z)
    );
  }
  /**
   * Lit at the surface the frames show rather than on the quad, which lies a radius towards the
   * view: back along the view by (1 - depth)·2R, depth being 1 at the front of the bounds. On the
   * quad, everything seen against the light would sit in the tree's own shadow and lose its
   * transmitted light. Follows UE ImpostorBaker's depth derived pixel depth offset, used here for
   * the lighting only.
   */
  PBRLight(
    scope: PBInsideFunctionScope,
    worldPos: PBShaderExp,
    normal: PBShaderExp,
    viewVec: PBShaderExp,
    albedo: PBShaderExp,
    TBN: PBShaderExp,
    outRoughness?: PBShaderExp,
    outSSSDiffuse?: PBShaderExp,
    outSSSTransmission?: PBShaderExp
  ): PBShaderExp {
    const pb = scope.$builder;
    const that = this;
    scope.$l.zImpostorDepth = this.blendFrames(
      scope,
      scope.zImpostorNormalDepth,
      this.impostorAtlasUVs(scope)
    ).a;
    scope.$l.zImpostorSurfacePos = this.impostorSurfacePos(scope, worldPos, scope.zImpostorDepth);
    scope.$l.zImpostorLit = super.PBRLight(
      scope,
      scope.zImpostorSurfacePos,
      normal,
      viewVec,
      albedo,
      TBN,
      outRoughness,
      outSSSDiffuse,
      outSSSTransmission
    );
    // Debug outputs, picked by a uniform so switching them builds no new program
    scope.$l.zImpostorDebugMode = scope.zImpostorDebug;
    scope.$l.zImpostorORMDebug = this.sampleORM(scope);
    scope.$if(pb.greaterThan(scope.zImpostorDebugMode, 0.5), function () {
      this.zImpostorLit = pb.vec3(0);
      this.$if(pb.lessThan(this.zImpostorDebugMode, 1.5), function () {
        this.zImpostorLit = albedo.rgb;
      })
        .$elseif(pb.lessThan(this.zImpostorDebugMode, 2.5), function () {
          this.zImpostorLit = pb.add(pb.mul(normal, 0.5), pb.vec3(0.5));
        })
        .$elseif(pb.lessThan(this.zImpostorDebugMode, 3.5), function () {
          this.zImpostorLit = pb.vec3(this.zImpostorDepth);
        })
        .$elseif(pb.lessThan(this.zImpostorDebugMode, 4.5), function () {
          this.zImpostorLit = pb.vec3(this.zImpostorORMDebug.x);
        })
        .$elseif(pb.lessThan(this.zImpostorDebugMode, 5.5), function () {
          this.zImpostorLit = pb.vec3(this.zImpostorORMDebug.y);
        })
        .$elseif(pb.lessThan(this.zImpostorDebugMode, 6.5), function () {
          this.zImpostorLit = pb.vec3(this.zImpostorORMDebug.z);
        })
        .$else(function () {
          if (this.zImpostorSubsurface) {
            this.zImpostorLit = that.sampleUnshifted(this, this.zImpostorSubsurface).rgb;
          }
        });
    });
    return scope.zImpostorLit;
  }
  calculateAlbedoColor(scope: PBInsideFunctionScope, _uv?: PBShaderExp): PBShaderExp {
    return this.blendFrames(scope, scope.zImpostorBase, this.impostorAtlasUVs(scope));
  }
  calculateNormalAndTBN(
    scope: PBInsideFunctionScope,
    _worldPos: PBShaderExp,
    _worldNormal?: PBShaderExp,
    _worldTangent?: PBShaderExp,
    _worldBinormal?: PBShaderExp
  ) {
    const pb = scope.$builder;
    const NormalStruct = pb.defineStruct([pb.mat3('TBN'), pb.vec3('normal')]);
    const inputs = scope.$inputs;
    scope.$l.zImpostorNormalObj = pb.sub(
      pb.mul(this.blendFrames(scope, scope.zImpostorNormalDepth, this.impostorAtlasUVs(scope)).xyz, 2),
      pb.vec3(1)
    );
    scope.$l.zImpostorNormalW = pb.mul(
      pb.mat3(inputs.zImpostorRotX, inputs.zImpostorRotY, inputs.zImpostorRotZ),
      scope.zImpostorNormalObj
    );
    // Frames disagreeing can blend the normal to nothing; normalizing that would give NaN, which
    // temporal accumulation then spreads over the screen
    scope.$l.zImpostorNormalLen = pb.length(scope.zImpostorNormalW);
    scope.$l.zImpostorNormal = pb.select(
      pb.vec3(0, 1, 0),
      pb.div(scope.zImpostorNormalW, pb.max(scope.zImpostorNormalLen, 1e-6)),
      pb.greaterThan(scope.zImpostorNormalLen, 1e-4)
    );
    // Any basis around the normal: the impostor has no tangent space
    scope.$l.zImpostorT = pb.normalize(
      pb.cross(
        pb.select(pb.vec3(0, 1, 0), pb.vec3(1, 0, 0), pb.greaterThan(pb.abs(scope.zImpostorNormal.y), 0.99)),
        scope.zImpostorNormal
      )
    );
    scope.$l.zImpostorB = pb.cross(scope.zImpostorNormal, scope.zImpostorT);
    return NormalStruct(
      pb.mat3(scope.zImpostorT, scope.zImpostorB, scope.zImpostorNormal),
      scope.zImpostorNormal
    );
  }
  /** Occlusion, roughness and metallic, without the parallax shift: they are read in lighting functions */
  private sampleORM(scope: PBInsideFunctionScope) {
    return this.sampleUnshifted(scope, scope.zImpostorORM);
  }
  getSubsurfaceColor(scope: PBInsideFunctionScope): Nullable<PBShaderExp> {
    return scope.zImpostorSubsurface ? this.sampleUnshifted(scope, scope.zImpostorSubsurface).rgb : null;
  }
  /** A texture blended over the three frames without the parallax shift */
  /** @internal */
  sampleUnshifted(scope: PBInsideFunctionScope, tex: PBShaderExp) {
    const pb = scope.$builder;
    const inputs = scope.$inputs;
    const frames = scope.zImpostorGrid.x;
    const cell = inputs.zImpostorFrame.xy;
    const second = inputs.zImpostorFrame.zw;
    const atlas = (frame: PBShaderExp, uv: PBShaderExp) =>
      impostorAtlasCoord(pb, frame, pb.clamp(uv, pb.vec2(0), pb.vec2(1)), frames);
    return this.blendFrames(scope, tex, [
      atlas(cell, inputs.zImpostorUV01.xy),
      atlas(pb.add(cell, second), inputs.zImpostorUV01.zw),
      atlas(pb.add(cell, pb.vec2(1)), inputs.zImpostorUV2Ray2.xy)
    ]);
  }
  calculateMetallic(scope: PBInsideFunctionScope, _albedo: PBShaderExp, _normal: PBShaderExp) {
    return this.sampleORM(scope).z;
  }
  calculateRoughness(scope: PBInsideFunctionScope, _albedo: PBShaderExp, _normal: PBShaderExp) {
    return this.sampleORM(scope).y;
  }
  getAmbientOcclusionFactor(scope: PBInsideFunctionScope): Nullable<PBShaderExp> {
    return this.sampleORM(scope).x;
  }
  protected _createHash() {
    return `${super._createHash()}:${this._subsurfaceTexture.get() ? 1 : 0}`;
  }
  supportsSurfaceCapture() {
    return false;
  }
  supportsVoxelization() {
    return false;
  }
  applyUniformValues(bindGroup: BindGroup, ctx: DrawContext, pass: number) {
    super.applyUniformValues(bindGroup, ctx, pass);
    tmpBounds.setXYZW(this._center[0], this._center[1], this._center[2], this._radius);
    tmpGrid.setXYZW(
      this._frames,
      this._hemisphere ? 1 : 0,
      this._parallax,
      Math.max(1, this._baseTexture.get()?.width ?? 1)
    );
    bindGroup.setValue('zImpostorBounds', tmpBounds);
    bindGroup.setValue('zImpostorGrid', tmpGrid);
    if (this.needFragmentColorInput(ctx)) {
      bindGroup.setValue('zImpostorDebug', DEBUG_OUTPUTS.indexOf(this._debugOutput));
    }
    if (this.needFragmentColorInput(ctx)) {
      const sampler = fetchSampler('clamp_linear');
      bindGroup.setTexture('zImpostorBase', this._baseTexture.get()!, sampler);
      bindGroup.setTexture('zImpostorNormalDepth', this._normalDepthTexture.get()!, sampler);
      bindGroup.setTexture('zImpostorORM', this._ormTexture.get()!, sampler);
      if (this._subsurfaceTexture.get()) {
        bindGroup.setTexture('zImpostorSubsurface', this._subsurfaceTexture.get()!, sampler);
      }
    }
  }
  /** @internal */
  isReady() {
    return !!this._baseTexture.get() && !!this._normalDepthTexture.get() && !!this._ormTexture.get();
  }
  protected onDispose() {
    super.onDispose();
    this._baseTexture.dispose();
    this._normalDepthTexture.dispose();
    this._ormTexture.dispose();
    this._subsurfaceTexture.dispose();
  }
}

/**
 * Texture coordinates in an atlas of a point of a frame. The atlases are upright images whose
 * frame rows run from the top (see ImpostorBakeResult.base): frame (i, j) is the cell i from the
 * left and j from the top, and within it the frame's y axis goes up the image.
 *
 * @param frame - Frame grid coordinates (i, j)
 * @param local - Point in the frame, (0, 0) its lower left and (1, 1) its upper right
 * @param frames - Frames along each side
 */
function impostorAtlasCoord(
  pb: PBInsideFunctionScope['$builder'],
  frame: PBShaderExp,
  local: PBShaderExp,
  frames: PBShaderExp
) {
  return pb.div(pb.vec2(pb.add(frame.x, local.x), pb.sub(pb.add(frame.y, 1), local.y)), frames);
}

/**
 * Grid mappings and frame coordinates of the impostor vertex shader, mirroring
 * render/impostor/octahedral.ts
 */
function declareGridFunctions(scope: PBFunctionScope) {
  const pb = scope.$builder;
  pb.func('Z_impostorVectorToGrid', [pb.vec3('dir')], function () {
    this.$if(pb.greaterThan(this.zImpostorGrid.y, 0.5), function () {
      this.$l.y = pb.max(this.dir.y, 0.001);
      this.$l.sum = pb.add(pb.abs(this.dir.x), this.y, pb.abs(this.dir.z));
      this.$l.ox = pb.div(this.dir.x, this.sum);
      this.$l.oz = pb.div(this.dir.z, this.sum);
      this.$return(pb.mul(pb.vec2(pb.add(this.ox, this.oz, 1), pb.add(pb.sub(this.oz, this.ox), 1)), 0.5));
    });
    this.$l.sum = pb.add(pb.abs(this.dir.x), pb.abs(this.dir.y), pb.abs(this.dir.z));
    this.$l.o = pb.div(this.dir.xz, this.sum);
    this.$if(pb.lessThan(this.dir.y, 0), function () {
      this.$l.s = pb.vec2(
        pb.select(pb.float(-1), pb.float(1), pb.greaterThanEqual(this.o.x, 0)),
        pb.select(pb.float(-1), pb.float(1), pb.greaterThanEqual(this.o.y, 0))
      );
      this.o = pb.mul(pb.sub(pb.vec2(1), pb.abs(this.o.yx)), this.s);
    });
    this.$return(pb.mul(pb.add(this.o, pb.vec2(1)), 0.5));
  });
  pb.func('Z_impostorGridToVector', [pb.vec2('c')], function () {
    this.$if(pb.greaterThan(this.zImpostorGrid.y, 0.5), function () {
      this.$l.x = pb.sub(this.c.x, this.c.y);
      this.$l.z = pb.add(-1, this.c.x, this.c.y);
      this.$return(pb.normalize(pb.vec3(this.x, pb.sub(pb.sub(1, pb.abs(this.x)), pb.abs(this.z)), this.z)));
    });
    this.$l.f = pb.sub(pb.mul(this.c, 2), pb.vec2(1));
    this.$l.y = pb.sub(pb.sub(1, pb.abs(this.f.x)), pb.abs(this.f.y));
    this.$if(pb.lessThan(this.y, 0), function () {
      this.$l.s = pb.vec2(
        pb.select(pb.float(-1), pb.float(1), pb.greaterThanEqual(this.f.x, 0)),
        pb.select(pb.float(-1), pb.float(1), pb.greaterThanEqual(this.f.y, 0))
      );
      this.f = pb.mul(pb.sub(pb.vec2(1), pb.abs(this.f.yx)), this.s);
    });
    this.$return(pb.normalize(pb.vec3(this.f.x, this.y, this.f.y)));
  });
  // Frame coordinates where a ray crosses the frame's plane (xy), and the ray in the frame's
  // basis per unit of depth across the bounds (zw), for the parallax shift
  pb.func('Z_impostorFrameUV', [pb.vec2('frame'), pb.vec3('origin'), pb.vec3('ray')], function () {
    this.$l.n = this.Z_impostorGridToVector(pb.div(this.frame, pb.sub(this.zImpostorGrid.x, 1)));
    this.$l.up = pb.select(pb.vec3(0, 1, 0), pb.vec3(0, 0, -1), pb.greaterThan(pb.abs(this.n.y), 0.999));
    this.$l.bx = pb.normalize(pb.cross(this.up, this.n));
    this.$l.by = pb.normalize(pb.cross(this.n, this.bx));
    this.$l.center = this.zImpostorBounds.xyz;
    this.$l.radius = this.zImpostorBounds.w;
    this.$l.rn = pb.dot(this.ray, this.n);
    this.$l.rnSafe = pb.select(pb.float(-1e-4), this.rn, pb.lessThan(this.rn, -1e-4));
    this.$l.t = pb.div(pb.dot(pb.sub(this.center, this.origin), this.n), this.rnSafe);
    this.$l.q = pb.sub(pb.add(this.origin, pb.mul(this.ray, this.t)), this.center);
    this.$l.uv = pb.add(
      pb.div(pb.vec2(pb.dot(this.q, this.bx), pb.dot(this.q, this.by)), pb.mul(this.radius, 2)),
      pb.vec2(0.5)
    );
    // A point of depth d (1 nearest) lies h = (d - 0.5)·2R above the plane, towards the view: the
    // ray reaches it at h / ray.n past the plane (ray.n < 0), shifting the frame coordinates by
    // (0.5 - d) · ray.xy / -ray.n
    this.$l.shift = pb.div(
      pb.vec2(pb.dot(this.ray, this.bx), pb.dot(this.ray, this.by)),
      pb.max(pb.neg(this.rn), 0.05)
    );
    this.$return(pb.vec4(this.uv, this.shift));
  });
}
