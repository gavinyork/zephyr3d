import type { BindGroup, PBGlobalScope, PBInsideFunctionScope, PBShaderExp } from '@zephyr3d/device';
import { TerrainHeightBrush } from './height';
import type { Vector3, Vector4 } from '@zephyr3d/base';
import { degree2radian, Vector2 } from '@zephyr3d/base';
import type { TerrainEditTool } from '../terrain';
import { ImGui } from '@zephyr3d/imgui';

export class HydraulicErosionBrush extends TerrainHeightBrush {
  private _talus: number;
  private _pixelWorldSize: Vector2;
  private _carryRate: number;
  private _maxStep: number;
  constructor() {
    super();
    this._talus = 30;
    this._pixelWorldSize = new Vector2(1, 1);
    this._carryRate = 0.2;
    this._maxStep = 0.05;
  }
  getName(): string {
    return 'hydraulic erosion';
  }
  protected brushFragment(
    scope: PBInsideFunctionScope,
    mask: PBShaderExp,
    strength: PBShaderExp,
    heightMapUV: PBShaderExp,
    _centerUV: PBShaderExp
  ) {
    const pb = scope.$builder;

    scope.$l.brushEffect = pb.clamp(pb.mul(strength, mask), 0, 1);
    scope.$if(pb.lessThan(scope.brushEffect, 0.001), function () {
      pb.discard();
    });

    const heightMap = this.getOriginHeightMap(scope);
    scope.$l.texelSize = pb.div(pb.vec2(1), pb.vec2(pb.textureDimensions(heightMap, 0)));
    scope.$l.currentHeight = pb.textureSampleLevel(heightMap, heightMapUV, 0).r;
    scope.currentHeight = pb.mul(scope.currentHeight, scope.heightScale);
    scope.$l.hN = pb.mul(
      pb.textureSampleLevel(heightMap, pb.sub(heightMapUV, pb.vec2(0, scope.texelSize.y)), 0).r,
      scope.heightScale
    );
    scope.$l.hS = pb.mul(
      pb.textureSampleLevel(heightMap, pb.add(heightMapUV, pb.vec2(0, scope.texelSize.y)), 0).r,
      scope.heightScale
    );
    scope.$l.hW = pb.mul(
      pb.textureSampleLevel(heightMap, pb.sub(heightMapUV, pb.vec2(scope.texelSize.x, 0)), 0).r,
      scope.heightScale
    );
    scope.$l.hE = pb.mul(
      pb.textureSampleLevel(heightMap, pb.add(heightMapUV, pb.vec2(scope.texelSize.x, 0)), 0).r,
      scope.heightScale
    );
    scope.$l.gN = pb.max(pb.sub(scope.currentHeight, scope.hN), 0);
    scope.$l.gS = pb.max(pb.sub(scope.currentHeight, scope.hS), 0);
    scope.$l.gW = pb.max(pb.sub(scope.currentHeight, scope.hW), 0);
    scope.$l.gE = pb.max(pb.sub(scope.currentHeight, scope.hE), 0);
    scope.$l.t = pb.tan(scope.talus);
    scope.$l.dx = pb.mul(scope.t, scope.pixelWorldSize.x);
    scope.$l.dz = pb.mul(scope.t, scope.pixelWorldSize.y);
    scope.$l.sN = pb.max(pb.sub(scope.gN, scope.dz), 0);
    scope.$l.sS = pb.max(pb.sub(scope.gS, scope.dz), 0);
    scope.$l.sW = pb.max(pb.sub(scope.gW, scope.dx), 0);
    scope.$l.sE = pb.max(pb.sub(scope.gE, scope.dx), 0);
    scope.$l.sumS = pb.add(scope.sN, scope.sS, scope.sW, scope.sE);
    scope.$l.wN = pb.float(0);
    scope.$l.wS = pb.float(0);
    scope.$l.wW = pb.float(0);
    scope.$l.wE = pb.float(0);
    scope.$if(pb.greaterThan(scope.sumS, 0), function () {
      scope.wN = pb.div(scope.sN, scope.sumS);
      scope.wS = pb.div(scope.sS, scope.sumS);
      scope.wW = pb.div(scope.sW, scope.sumS);
      scope.wE = pb.div(scope.sE, scope.sumS);
    });
    scope.$l.capacityBase = pb.clamp(scope.carryRate, 0, 0.5);
    scope.$l.capacity = pb.mul(scope.capacityBase, scope.brushEffect);
    scope.$l.erosionGain = pb.float(0.8);
    scope.$l.potentialErode = pb.mul(scope.erosionGain, scope.sumS);
    scope.$l.depositionGain = pb.float(0.35);
    scope.$l.potentialDeposit = pb.mul(
      scope.depositionGain,
      pb.max(0, pb.sub(pb.mul(pb.add(scope.dx, scope.dz), 0.5), scope.sumS))
    );
    scope.$l.delta = pb.clamp(
      pb.sub(scope.potentialDeposit, scope.potentialErode),
      pb.mul(pb.neg(scope.capacity), scope.maxStep),
      pb.mul(scope.capacity, scope.maxStep)
    );
    scope.$l.biasToErode = pb.mul(scope.capacityBase, scope.brushEffect, 0.15);
    scope.delta = pb.sub(scope.delta, pb.mul(scope.sumS, scope.biasToErode));
    scope.delta = pb.clamp(scope.delta, pb.neg(scope.maxStep), scope.maxStep);
    scope.$l.hNew = pb.div(pb.add(scope.currentHeight, scope.delta), scope.heightScale);

    return pb.vec4(pb.vec3(scope.hNew), 1);
  }
  renderSettings(_tool: TerrainEditTool): void {
    ImGui.BeginChild(
      'Detail',
      new ImGui.ImVec2(
        0,
        3 * ImGui.GetFrameHeight() + 2 * ImGui.GetStyle().WindowPadding.y + 2 * ImGui.GetStyle().ItemSpacing.y
      ),
      true
    );
    const talus = [this._talus] as [number];
    if (ImGui.DragFloat('Talus', talus, 1, 0, 90)) {
      this._talus = talus[0];
    }
    const carryRate = [this._carryRate] as [number];
    if (ImGui.DragFloat('Carry Rate', carryRate, 0.01, 0, 1)) {
      this._carryRate = carryRate[0];
    }
    const maxStep = [this._maxStep] as [number];
    if (ImGui.DragFloat('Max Step', maxStep, 0.01, 0, 1)) {
      this._maxStep = maxStep[0];
    }
    ImGui.EndChild();
  }
  protected setupBrushUniforms(scope: PBGlobalScope): void {
    super.setupBrushUniforms(scope);
    const pb = scope.$builder;
    if (pb.shaderKind === 'fragment') {
      scope.talus = pb.float().uniform(0);
      scope.pixelWorldSize = pb.vec2().uniform(0);
      scope.carryRate = pb.float().uniform(0);
      scope.diagWeight = pb.float().uniform(0);
      scope.maxStep = pb.float().uniform(0);
      scope.heightScale = pb.float().uniform(0);
    }
  }
  protected applyUniformValues(bindGroup: BindGroup, region: Vector4, scale: Vector3): void {
    super.applyUniformValues(bindGroup, region, scale);
    this._pixelWorldSize.x = (region.z - region.x) / this.sourceHeightMap.width;
    this._pixelWorldSize.y = (region.w - region.y) / this.sourceHeightMap.height;
    bindGroup.setValue('talus', degree2radian(this._talus));
    bindGroup.setValue('pixelWorldSize', this._pixelWorldSize);
    bindGroup.setValue('carryRate', this._carryRate);
    bindGroup.setValue('maxStep', this._maxStep);
    bindGroup.setValue('heightScale', scale.y);
  }
}
