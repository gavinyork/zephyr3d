import type { BindGroup, PBGlobalScope, PBInsideFunctionScope, PBShaderExp } from '@zephyr3d/device';
import { TerrainHeightBrush } from './height';
import type { Vector4 } from '@zephyr3d/base';
import { degree2radian, Vector2 } from '@zephyr3d/base';
import type { TerrainEditTool } from '../terrain';
import { ImGui } from '@zephyr3d/imgui';

export class ThermalErosionBrush extends TerrainHeightBrush {
  private _talus: number;
  private _pixelWorldSize: Vector2;
  private _carryRate: number;
  private _diagWeight: number;
  constructor() {
    super();
    this._talus = 30;
    this._pixelWorldSize = new Vector2(1, 1);
    this._carryRate = 0.2;
    this._diagWeight = 1 / Math.sqrt(2);
  }
  getName(): string {
    return 'thermal erosion';
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
    scope.$l.outgoing = pb.float(0);
    scope.$l.incoming = pb.float(0);
    scope.$l.hn = pb.float[8]();
    scope.$l.dir = pb.float[8]();
    scope.$l.index = pb.int(0);
    scope.$for(pb.int('i'), -1, 2, function () {
      this.$for(pb.int('j'), -1, 2, function () {
        this.$if(pb.and(pb.equal(this.i, 0), pb.equal(this.j, 0)), function () {
          this.$continue();
        });
        this.$l.coord = pb.add(
          heightMapUV,
          pb.mul(this.texelSize, pb.vec2(pb.float(this.j), pb.float(this.i)))
        );
        this.hn.setAt(this.index, pb.textureSampleLevel(heightMap, this.coord, 0).r);
        this.index = pb.add(this.index, 1);
      });
    });
    scope.$l.t = pb.tan(scope.talus);
    scope.$l.r = pb.mul(scope.t, pb.length(scope.pixelWorldSize));
    scope.$l.dx = pb.mul(scope.t, scope.pixelWorldSize.x);
    scope.$l.dz = pb.mul(scope.t, scope.pixelWorldSize.y);
    scope.$l.eps = pb.float(0.05);

    scope.dir[0] = pb.add(scope.r, scope.eps);
    scope.dir[1] = pb.add(scope.dz, scope.eps);
    scope.dir[2] = pb.add(scope.r, scope.eps);
    scope.dir[3] = pb.add(scope.dx, scope.eps);
    scope.dir[4] = pb.add(scope.dx, scope.eps);
    scope.dir[5] = pb.add(scope.r, scope.eps);
    scope.dir[6] = pb.add(scope.dz, scope.eps);
    scope.dir[7] = pb.add(scope.r, scope.eps);

    scope.$for(pb.int('i'), 0, 8, function () {
      this.$l.diffOut = pb.sub(pb.sub(this.currentHeight, this.hn.at(this.i)), this.dir.at(this.i));
      this.$l.diffIn = pb.sub(pb.sub(this.hn.at(this.i), this.currentHeight), this.dir.at(this.i));
      this.$if(pb.greaterThan(this.diffOut, 0), function () {
        this.outgoing = pb.add(this.outgoing, this.diffOut);
      });
      this.$if(pb.greaterThan(this.diffIn, 0), function () {
        this.incoming = pb.add(this.incoming, this.diffIn);
      });
    });

    scope.$l.rate = pb.mul(pb.min(scope.carryRate, 0.5), pb.clamp(scope.brushEffect, 0, 1));
    scope.$l.incomingFactor = pb.float(0.4);
    scope.$l.maxStep = pb.float(0.2);
    scope.$l.delta = pb.float(0);

    scope.$if(pb.greaterThan(scope.outgoing, 0), function () {
      this.delta = pb.sub(this.delta, pb.mul(this.rate, this.outgoing));
    });
    scope.$if(pb.greaterThan(scope.incoming, 0), function () {
      this.delta = pb.add(this.delta, pb.mul(this.rate, this.incoming, scope.incomingFactor));
    });
    scope.delta = pb.clamp(scope.delta, pb.neg(scope.maxStep), scope.maxStep);
    scope.$l.hNew = pb.add(scope.currentHeight, scope.delta);

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
    const diagWeight = [this._diagWeight] as [number];
    if (ImGui.DragFloat('Diagnal Weight', diagWeight, 0.01, 0, 1)) {
      this._diagWeight = diagWeight[0];
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
    }
  }
  protected applyUniformValues(bindGroup: BindGroup, region: Vector4): void {
    super.applyUniformValues(bindGroup, region);
    this._pixelWorldSize.x = (region.z - region.x) / this.sourceHeightMap.width;
    this._pixelWorldSize.y = (region.w - region.y) / this.sourceHeightMap.height;
    bindGroup.setValue('talus', degree2radian(this._talus));
    bindGroup.setValue('pixelWorldSize', this._pixelWorldSize);
    bindGroup.setValue('carryRate', this._carryRate);
    bindGroup.setValue('diagWeight', this._diagWeight);
  }
}
