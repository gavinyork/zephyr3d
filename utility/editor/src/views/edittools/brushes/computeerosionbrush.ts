import type { PBInsideFunctionScope, PBShaderExp } from '@zephyr3d/device';
import { getDevice } from '@zephyr3d/scene';
import type { Texture2D } from '@zephyr3d/device';
import type { Vector2, Vector3, Vector4 } from '@zephyr3d/base';
import { ImGui } from '@zephyr3d/imgui';
import { TerrainHeightBrush } from './height';
import {
  TerrainErosionCompute,
  type TerrainErosionApplyParams,
  type TerrainErosionMode,
  type TerrainErosionOptions
} from './erosioncompute';
import type { TerrainEditTool } from '../terrain';

/** Keep dispatch overhead bounded while water advances continuously between batches. */
const ITERATIONS_PER_BATCH = 8;

/** Editor controls and fixed batch pacing for erosion with continuous state during a stroke. */
export abstract class TerrainComputeErosionBrush extends TerrainHeightBrush {
  readonly computeMode: TerrainErosionMode;
  protected readonly computeSettings: Partial<TerrainErosionOptions>;
  private _compute: TerrainErosionCompute;
  private _lastStampTime: number;
  private _stampAccumulator: number;
  private _strokeActive: boolean;
  private _stepsPerSecond: number;
  private _firstStamp: boolean;

  protected constructor(mode: TerrainErosionMode, settings: Partial<TerrainErosionOptions>) {
    super();
    this.computeMode = mode;
    this.computeSettings = settings;
    this._compute = null;
    this._lastStampTime = -1;
    this._stampAccumulator = 0;
    this._strokeActive = false;
    this._stepsPerSecond = 240;
    this._firstStamp = true;
  }

  /** Compute brushes are deliberately disabled on WebGL devices. */
  get computeSupported() {
    return TerrainErosionCompute.isSupported(getDevice());
  }

  beginStroke() {
    if (this._strokeActive) {
      return;
    }
    this._strokeActive = true;
    this._lastStampTime = -1;
    this._stampAccumulator = 0;
    this._firstStamp = true;
    this._compute?.invalidate();
  }

  endStroke() {
    if (!this._strokeActive) {
      return;
    }
    this._strokeActive = false;
    this._lastStampTime = -1;
    this._stampAccumulator = 0;
    this._firstStamp = true;
    this._compute?.invalidate();
  }

  /** Ends the stroke and releases cached simulation textures. */
  resetCompute() {
    this.endStroke();
    this._compute?.reset();
  }

  private _getCompute() {
    if (!this._compute && this.computeSupported) {
      this._compute = new TerrainErosionCompute(getDevice());
    }
    return this._compute;
  }

  /** Advances fixed-size simulation batches at the configured step rate. */
  applyCompute(
    heightMap: Texture2D,
    mask: Texture2D,
    region: Vector4,
    scale: Vector3,
    brushCenter: Vector2,
    brushSize: number,
    brushStrength: number,
    brushRotation: number
  ) {
    if (
      !this.computeSupported ||
      !Number.isFinite(brushStrength) ||
      !Number.isFinite(brushSize) ||
      brushStrength <= 0 ||
      brushSize <= 0
    ) {
      return false;
    }
    const compute = this._getCompute();
    if (!compute) {
      return false;
    }
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (!this._strokeActive) {
      this.beginStroke();
    }
    if (this._lastStampTime < 0) {
      this._lastStampTime = now;
    }
    const elapsed = Math.min(Math.max(now - this._lastStampTime, 0), 100);
    this._lastStampTime = now;
    this._stampAccumulator = Math.min(24, this._stampAccumulator + (elapsed / 1000) * this._stepsPerSecond);
    // Retain water and suspended sediment between these batches throughout the stroke.
    const stampCount = this._firstStamp
      ? 1
      : Math.min(2, Math.floor(this._stampAccumulator / ITERATIONS_PER_BATCH));
    this._firstStamp = false;
    if (stampCount === 0) {
      return false;
    }
    this._stampAccumulator = Math.max(0, this._stampAccumulator - stampCount * ITERATIONS_PER_BATCH);
    const params: TerrainErosionApplyParams = {
      mode: this.computeMode,
      heightMap,
      mask,
      region,
      scale,
      brushCenter,
      brushSize,
      brushStrength,
      brushRotation,
      iterations: ITERATIONS_PER_BATCH,
      options: this.computeSettings
    };
    let applied = false;
    for (let i = 0; i < stampCount; i++) {
      applied = compute.apply(params) || applied;
    }
    return applied;
  }

  protected override brushFragment(
    scope: PBInsideFunctionScope,
    _mask: PBShaderExp,
    _strength: PBShaderExp,
    heightMapUV: PBShaderExp,
    _centerUV: PBShaderExp
  ) {
    // TerrainEditTool uses applyCompute. Preserve the source if the render path
    // is called directly through TerrainHeightBrush's interface.
    const pb = scope.$builder;
    return pb.vec4(pb.vec3(pb.textureSampleLevel(scope.sourceHeightMap, heightMapUV, 0).r), 1);
  }

  renderSettings(tool: TerrainEditTool): void {
    const rows = this.computeMode === 'hydraulic' ? 10 : this.computeMode === 'wind' ? 6 : 5;
    ImGui.BeginChild(
      'ErosionComputeDetail',
      new ImGui.ImVec2(
        0,
        rows * ImGui.GetFrameHeight() +
          2 * ImGui.GetStyle().WindowPadding.y +
          (rows - 1) * ImGui.GetStyle().ItemSpacing.y
      ),
      true
    );
    ImGui.Text(this.computeSupported ? 'GPU Compute (WebGPU)' : 'GPU Compute unavailable');
    if (!this.computeSupported) {
      ImGui.TextDisabled('This erosion tool requires a WebGPU device.');
      ImGui.EndChild();
      return;
    }
    const speed = [this._stepsPerSecond] as [number];
    if (ImGui.DragFloat('Simulation Speed', speed, 10, 30, 600, '%.0f steps/s')) {
      this._stepsPerSecond = Number.isFinite(speed[0]) ? Math.min(600, Math.max(30, speed[0])) : 240;
    }
    const terrain = tool.terrain;
    const region = terrain.worldRegion;
    const cell = Math.min(
      (region.z - region.x) / terrain.heightMap.width,
      (region.w - region.y) / terrain.heightMap.height
    );
    const hydraulic = this.computeMode === 'hydraulic';
    const maxErosion = [this.computeSettings.maxErosion ?? cell * (hydraulic ? 0.035 : 0.05)] as [number];
    if (
      ImGui.DragFloat(
        'Max Erosion/Step',
        maxErosion,
        cell * 0.001,
        0,
        cell * (hydraulic ? 0.25 : 0.5),
        '%.4f'
      )
    ) {
      this.computeSettings.maxErosion = maxErosion[0];
    }
    if (this.computeMode === 'hydraulic') {
      const rain = [this.computeSettings.rainRate ?? 0.18] as [number];
      if (ImGui.DragFloat('Rain Rate', rain, 0.01, 0, 2)) {
        this.computeSettings.rainRate = rain[0];
      }
      const evaporation = [this.computeSettings.evaporation ?? 0.002] as [number];
      if (ImGui.DragFloat('Evaporation', evaporation, 0.0005, 0, 0.5, '%.4f')) {
        this.computeSettings.evaporation = evaporation[0];
      }
      const persistence = [this.computeSettings.flowPersistence ?? 0.8] as [number];
      if (ImGui.SliderFloat('Catchment Persistence', persistence, 0, 0.98)) {
        this.computeSettings.flowPersistence = persistence[0];
      }
      const channeling = [this.computeSettings.channeling ?? 4] as [number];
      if (ImGui.SliderFloat('Channeling', channeling, 1, 4)) {
        this.computeSettings.channeling = channeling[0];
      }
      const capacity = [this.computeSettings.capacity ?? 0.7] as [number];
      if (ImGui.DragFloat('Sediment Capacity', capacity, 0.01, 0, 10)) {
        this.computeSettings.capacity = capacity[0];
      }
      const erosion = [this.computeSettings.erosionRate ?? 0.45] as [number];
      if (ImGui.DragFloat('Erosion Rate', erosion, 0.01, 0, 1)) {
        this.computeSettings.erosionRate = erosion[0];
      }
      const deposition = [this.computeSettings.depositionRate ?? 0.12] as [number];
      if (ImGui.DragFloat('Deposition Rate', deposition, 0.01, 0, 1)) {
        this.computeSettings.depositionRate = deposition[0];
      }
    } else if (this.computeMode === 'thermal') {
      const talus = [this.computeSettings.talus ?? 30] as [number];
      if (ImGui.DragFloat('Talus', talus, 1, 0, 85)) {
        this.computeSettings.talus = talus[0];
      }
      const rate = [this.computeSettings.thermalRate ?? 0.35] as [number];
      if (ImGui.DragFloat('Thermal Rate', rate, 0.01, 0, 1)) {
        this.computeSettings.thermalRate = rate[0];
      }
    } else {
      const direction = [this.computeSettings.windDirection ?? 0] as [number];
      if (ImGui.SliderFloat('Wind Direction', direction, 0, 360, '%.0f deg')) {
        this.computeSettings.windDirection = direction[0];
      }
      const windSpeed = [this.computeSettings.windSpeed ?? 0.5] as [number];
      if (ImGui.DragFloat('Wind Speed', windSpeed, 0.01, 0, 4)) {
        this.computeSettings.windSpeed = windSpeed[0];
      }
      const transport = [this.computeSettings.transportRate ?? 0.35] as [number];
      if (ImGui.DragFloat('Transport Rate', transport, 0.01, 0, 1)) {
        this.computeSettings.transportRate = transport[0];
      }
    }
    ImGui.EndChild();
  }

  override dispose() {
    this.endStroke();
    this._compute?.dispose();
    this._compute = null;
    super.dispose();
  }
}
