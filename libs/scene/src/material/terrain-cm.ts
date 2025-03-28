import type { BindGroup, GPUProgram, PBFunctionScope, Texture2D } from '@zephyr3d/device';
import { applyMaterialMixins, MeshMaterial } from './meshmaterial';
import type { DrawContext } from '../render';
import { MaterialVaryingFlags } from '../values';
import { ShaderHelper } from './shader/helper';
import { Matrix4x4, Vector2, Vector3, Vector4 } from '@zephyr3d/base';
import { mixinLight } from './mixins/lit';
import { Application, DRef } from '../app';
import { fetchSampler } from '../utility/misc';
import { mixinPBRMetallicRoughness } from './mixins/lightmodel/pbrmetallicroughness';
import { drawFullscreenQuad } from '../render/fullscreenquad';

export class ClipmapTerrainMaterial extends applyMaterialMixins(
  MeshMaterial,
  mixinLight,
  mixinPBRMetallicRoughness
) {
  private static _normalMapProgram: GPUProgram = null;
  private static _normalMapBindGroup: BindGroup = null;
  private _region: Vector4;
  private _clipmapMatrix: Matrix4x4;
  private _heightMap: DRef<Texture2D>;
  private _normalMap: DRef<Texture2D>;
  private _terrainScale: Vector3;
  constructor(heightMap: Texture2D) {
    super();
    this.metallic = 0;
    this.roughness = 1;
    this._region = new Vector4(-99999, -99999, 99999, 99999);
    this._clipmapMatrix = new Matrix4x4();
    this._heightMap = new DRef(heightMap);
    this._normalMap = new DRef();
    this._terrainScale = Vector3.one();
    this.calculateNormalMap();
  }
  /** @internal */
  get region() {
    return this._region;
  }
  /** @internal */
  set region(val: Vector4) {
    if (!val.equalsTo(this._region)) {
      this._region.set(val);
      this.uniformChanged();
    }
  }
  /** @internal */
  get terrainScale() {
    return this._terrainScale;
  }
  /** @internal */
  set terrainScale(val: Vector3) {
    if (!this._terrainScale.equalsTo(val)) {
      this._terrainScale.set(val);
      this.calculateNormalMap();
      this.uniformChanged();
    }
  }
  get heightMap() {
    return this._heightMap.get();
  }
  set heightMap(val: Texture2D) {
    if (val !== this._heightMap.get()) {
      this._heightMap.set(val);
      this.calculateNormalMap();
      this.uniformChanged();
    }
  }
  get normalMap() {
    return this._normalMap.get();
  }
  set normalMap(val: Texture2D) {
    if (val !== this._normalMap.get()) {
      this._normalMap.set(val);
      this.uniformChanged();
    }
  }
  needSceneColor(): boolean {
    return false;
  }
  needSceneDepth(): boolean {
    return false;
  }
  setClipmapMatrix(mat: Matrix4x4) {
    this._clipmapMatrix.set(mat);
    this.uniformChanged();
  }
  supportInstancing(): boolean {
    return false;
  }
  supportLighting(): boolean {
    return true;
  }
  vertexShader(scope: PBFunctionScope): void {
    super.vertexShader(scope);
    const pb = scope.$builder;
    scope.$inputs.position = pb.vec3().attrib('position');
    scope.clipmapMatrix = pb.mat4().uniform(2);
    scope.heightMap = pb.tex2D().uniform(2);
    scope.region = pb.vec4().uniform(2);
    scope.scaleY = pb.float().uniform(2);
    scope.$l.clipmapPos = pb.mul(scope.clipmapMatrix, pb.vec4(scope.$inputs.position, 1)).xy;
    scope.$l.clipmapWorldPos = pb.mul(
      ShaderHelper.getWorldMatrix(scope),
      pb.vec4(scope.clipmapPos.x, 0, scope.clipmapPos.y, 1)
    ).xyz;
    scope.$outputs.uv = pb.div(
      pb.sub(scope.clipmapWorldPos.xz, scope.region.xy),
      pb.sub(scope.region.zw, scope.region.xy)
    );
    scope.$l.height = pb.textureSampleLevel(scope.heightMap, scope.$outputs.uv, 0).r;
    scope.$outputs.worldPos = pb.add(
      scope.clipmapWorldPos,
      pb.vec3(0, pb.mul(scope.height, scope.scaleY), 0)
    );
    scope.$outputs.clipmapPos = scope.clipmapWorldPos;
    ShaderHelper.setClipSpacePosition(
      scope,
      pb.mul(ShaderHelper.getViewProjectionMatrix(scope), pb.vec4(scope.$outputs.worldPos, 1))
    );
    ShaderHelper.resolveMotionVector(scope, scope.$outputs.worldPos, scope.$outputs.worldPos);
  }
  fragmentShader(scope: PBFunctionScope): void {
    super.fragmentShader(scope);
    const pb = scope.$builder;
    scope.region = pb.vec4().uniform(2);
    scope.$l.discardable = pb.or(
      pb.any(pb.lessThan(scope.$inputs.uv, pb.vec2(0))),
      pb.any(pb.greaterThan(scope.$inputs.uv, pb.vec2(1)))
    );
    scope.$if(scope.discardable, function () {
      pb.discard();
    });
    if (this.needFragmentColor()) {
      scope.normalMap = pb.tex2D().uniform(2);
      scope.$l.albedo = pb.vec4(1);
      scope.$l.worldNormal = pb.sub(
        pb.mul(pb.textureSample(scope.normalMap, scope.$inputs.uv).rgb, 2),
        pb.vec3(1)
      );
      scope.$l.normalInfo = this.calculateNormalAndTBN(
        scope,
        scope.$inputs.worldPos,
        pb.normalize(scope.worldNormal)
      );
      scope.$l.viewVec = this.calculateViewVector(scope, scope.$inputs.worldPos);
      scope.$l.litColor = this.PBRLight(
        scope,
        scope.$inputs.worldPos,
        scope.normalInfo.normal,
        scope.viewVec,
        scope.albedo,
        scope.normalInfo.TBN
      );
      scope.$l.outColor = pb.vec4(scope.litColor, 1);
      if (this.drawContext.materialFlags & MaterialVaryingFlags.SSR_STORE_ROUGHNESS) {
        scope.$l.outRoughness = pb.vec4(1, 1, 1, 0);
        this.outputFragmentColor(
          scope,
          scope.$inputs.worldPos,
          pb.vec4(1),
          scope.outRoughness,
          scope.outColor
        );
      } else {
        this.outputFragmentColor(scope, scope.$inputs.worldPos, scope.outColor);
      }
    } else {
      this.outputFragmentColor(scope, scope.$inputs.worldPos, null);
    }
  }
  applyUniformValues(bindGroup: BindGroup, ctx: DrawContext, pass: number): void {
    super.applyUniformValues(bindGroup, ctx, pass);
    bindGroup.setValue('clipmapMatrix', this._clipmapMatrix);
    bindGroup.setValue('region', this._region);
    bindGroup.setValue('scaleY', this._terrainScale.y);
    bindGroup.setTexture('heightMap', this._heightMap.get(), fetchSampler('clamp_linear_nomip'));
    if (this.needFragmentColor(ctx)) {
      bindGroup.setTexture('normalMap', this._normalMap.get());
    }
  }
  calculateNormalMap() {
    const device = Application.instance.device;
    if (!ClipmapTerrainMaterial._normalMapProgram) {
      ClipmapTerrainMaterial._normalMapProgram = device.buildRenderProgram({
        vertex(pb) {
          this.$inputs.pos = pb.vec2().attrib('position');
          this.$outputs.uv = pb.vec2();
          pb.main(function () {
            this.$builtins.position = pb.vec4(this.$inputs.pos, 0, 1);
            this.$outputs.uv = pb.add(pb.mul(this.$inputs.pos.xy, 0.5), pb.vec2(0.5));
            if (device.type === 'webgpu') {
              this.$builtins.position.y = pb.neg(this.$builtins.position.y);
            }
          });
        },
        fragment(pb) {
          this.heightMap = pb.tex2D().uniform(0);
          this.texelSize = pb.vec2().uniform(0);
          this.terrainScale = pb.vec3().uniform(0);
          this.$outputs.outColor = pb.vec4();
          pb.func('sobel', [pb.vec2('texCoord')], function () {
            this.$l.tl = pb.textureSample(this.heightMap, pb.sub(this.texCoord, this.texelSize)).r;
            this.$l.t = pb.textureSample(
              this.heightMap,
              pb.sub(this.texCoord, pb.vec2(0, this.texelSize.y))
            ).r;
            this.$l.tr = pb.textureSample(
              this.heightMap,
              pb.add(this.texCoord, pb.vec2(this.texelSize.x, pb.neg(this.texelSize.y)))
            ).r;
            this.$l.l = pb.textureSample(
              this.heightMap,
              pb.sub(this.texCoord, pb.vec2(this.texelSize.x, 0))
            ).r;
            this.$l.r = pb.textureSample(
              this.heightMap,
              pb.add(this.texCoord, pb.vec2(this.texelSize.x, 0))
            ).r;
            this.$l.bl = pb.textureSample(
              this.heightMap,
              pb.add(this.texCoord, pb.vec2(pb.neg(this.texelSize.x), this.texelSize.y))
            ).r;
            this.$l.b = pb.textureSample(
              this.heightMap,
              pb.add(this.texCoord, pb.vec2(0, this.texelSize.y))
            ).r;
            this.$l.br = pb.textureSample(this.heightMap, pb.add(this.texCoord, this.texelSize)).r;
            this.$l.dx = pb.sub(
              pb.add(this.tr, pb.mul(this.r, 2), this.br),
              pb.add(this.tl, pb.mul(this.l, 2), this.bl)
            );
            this.$l.dz = pb.sub(
              pb.add(this.bl, pb.mul(this.b, 2), this.br),
              pb.add(this.tl, pb.mul(this.t, 2), this.tr)
            );
            this.$return(pb.vec2(this.dx, this.dz));
          });
          pb.main(function () {
            this.$l.dxdz = this.sobel(this.$inputs.uv);
            this.$l.dhdxdz = pb.div(pb.mul(this.dxdz, this.terrainScale.y), this.terrainScale.xz);
            this.$l.normal = pb.normalize(pb.vec3(pb.neg(this.dhdxdz.x), 1, pb.neg(this.dhdxdz.y)));
            this.$outputs.outColor = pb.vec4(pb.add(pb.mul(this.normal, 0.5), pb.vec3(0.5)), 1);
          });
        }
      });
      ClipmapTerrainMaterial._normalMapBindGroup = device.createBindGroup(
        ClipmapTerrainMaterial._normalMapProgram.bindGroupLayouts[0]
      );
    }
    const heightMap = this.heightMap;
    let normalMap = this.normalMap;
    if (!normalMap || normalMap.width !== heightMap.width || normalMap.height !== heightMap.height) {
      normalMap = device.createTexture2D('rgba8unorm', heightMap.width, heightMap.height);
      normalMap.name = 'TerrainNormal';
    }
    const fb = device.createFrameBuffer([normalMap], null);
    ClipmapTerrainMaterial._normalMapBindGroup.setValue(
      'texelSize',
      new Vector2(1 / heightMap.width, 1 / heightMap.height)
    );
    ClipmapTerrainMaterial._normalMapBindGroup.setValue('terrainScale', this.terrainScale);
    ClipmapTerrainMaterial._normalMapBindGroup.setTexture('heightMap', heightMap);
    device.pushDeviceStates();
    device.setFramebuffer(fb);
    device.setProgram(ClipmapTerrainMaterial._normalMapProgram);
    device.setBindGroup(0, ClipmapTerrainMaterial._normalMapBindGroup);
    drawFullscreenQuad();
    device.popDeviceStates();
    fb.dispose();

    this.normalMap = normalMap;
  }
}
