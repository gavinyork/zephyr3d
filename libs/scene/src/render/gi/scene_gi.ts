import type { Nullable } from '@zephyr3d/base';
import { Vector3 } from '@zephyr3d/base';
import type { Scene } from '../../scene/scene';
import type { Camera } from '../../camera/camera';
import { GlobalSDF } from '../sdf/global_sdf';
import { VoxelScene } from './voxel_scene';
import type { VoxelSceneStats } from './voxel_scene';
import type { VoxelLightingOptions } from './voxel_lighting';
import { ProbeVolume } from './probe_volume';
import { PROBE_MAX_LEVELS } from '../../shaders/probes';
import type { ProbeVolumeOptions, ProbeVolumeStats } from './probe_volume';
import { RenderGraphExecutor } from '../rendergraph/executor';

/**
 * Whether the indirect lighting keeps updating, see {@link SceneGI.updateMode}.
 * @public
 */
export type GIUpdateMode = 'continuous' | 'frozen';

/**
 * Counters of a {@link SceneGI}.
 * @public
 */
export interface SceneGIStats {
  enabled: boolean;
  /** False on a device that cannot build it (WebGL2). */
  supported: boolean;
  voxels: Nullable<VoxelSceneStats>;
  probes: Nullable<ProbeVolumeStats>;
}

/**
 * The global illumination of a scene, at `scene.gi`. Off by default.
 *
 * Built on the scene's signed distance field, which it turns on: the static
 * meshes with a baked field are rasterized into a voxel scene
 * ({@link VoxelScene}) that gives the field's surfaces an albedo and an
 * emissive, the first of the pieces the probe-based global illumination
 * needs.
 *
 * WebGPU only; on WebGL2 enabling it changes nothing.
 *
 * @public
 */
export class SceneGI {
  private readonly _scene: Scene;
  private _enabled: boolean;
  private _voxels: Nullable<VoxelScene>;
  private _atlasSize: number;
  private _voxelizeBudget: number;
  private readonly _terrainAlbedo: Vector3;
  private readonly _lighting: VoxelLightingOptions;
  private readonly _probeOptions: ProbeVolumeOptions;
  private _probes: Nullable<ProbeVolume>;
  private _updateMode: GIUpdateMode;
  private _warned: boolean;
  constructor(scene: Scene) {
    this._scene = scene;
    this._enabled = false;
    this._voxels = null;
    this._atlasSize = 256;
    this._voxelizeBudget = 8;
    this._terrainAlbedo = new Vector3(0.3, 0.3, 0.3);
    // The sun's angular size, the cone Unreal traces distance field shadows of a
    // directional light with (LightSourceAngle 0.5357, DirectionalLightComponent.cpp;
    // its tangent is the cone's, DistanceFieldShadowing.cpp). Wider cones close the
    // openings sunlight comes through: at 5 degrees a courtyard floor lit through
    // an opening a few metres up read as shadowed.
    this._lighting = { sunShadowConeAngle: 0.5357, slicesPerFrame: 8 };
    this._probeOptions = {
      grid: [32, 16, 32],
      spacing: 1,
      levels: 3,
      levelScale: 4,
      raysPerProbe: 128,
      budget: 4096,
      hysteresis: 0.97,
      normalBias: 0.1,
      viewBias: 0.3,
      intensity: 1,
      maxRayDistance: 48
    };
    this._probes = null;
    this._updateMode = 'continuous';
    this._warned = false;
  }
  /** True on a device that can build it. */
  static isSupported() {
    return GlobalSDF.isSupported();
  }
  get enabled() {
    return this._enabled;
  }
  set enabled(val: boolean) {
    val = !!val;
    if (val === this._enabled) {
      return;
    }
    this._enabled = val;
    if (val) {
      // The voxel scene extends the field; turning the field off afterwards idles this
      this._scene.sdf.enabled = true;
    } else {
      this._voxels?.detach(this._scene.sdf);
      this._voxels?.dispose();
      this._voxels = null;
      this._probes?.dispose();
      this._probes = null;
    }
  }
  /** The probe volume, once built. */
  get probes() {
    return this._probes;
  }
  /** Distance between probes in world units; applied when the volume is next built. */
  get probeSpacing() {
    return this._probeOptions.spacing;
  }
  set probeSpacing(val: number) {
    val = Math.max(0.1, val);
    if (val !== this._probeOptions.spacing) {
      this._probeOptions.spacing = val;
      this.rebuildProbes();
    }
  }
  /** Probes along x, y and z; applied when the volume is next built. */
  get probeGrid(): [number, number, number] {
    return [...this._probeOptions.grid];
  }
  set probeGrid(val: [number, number, number]) {
    const grid = val.map((v) => Math.max(2, Math.floor(v))) as [number, number, number];
    const cur = this._probeOptions.grid;
    if (grid[0] !== cur[0] || grid[1] !== cur[1] || grid[2] !== cur[2]) {
      this._probeOptions.grid = grid;
      this.rebuildProbes();
    }
  }
  /** Clipmap levels of the probe volume, each four times the spacing of the one inside it; applied when the volume is next built. */
  get probeLevels() {
    return this._probeOptions.levels;
  }
  set probeLevels(val: number) {
    val = Math.max(1, Math.min(PROBE_MAX_LEVELS, Math.floor(val)));
    if (val !== this._probeOptions.levels) {
      this._probeOptions.levels = val;
      this.rebuildProbes();
    }
  }
  /**
   * Whether the indirect lighting keeps updating. `frozen` stops the voxel
   * lighting and the probe updates where they are, which also stops the
   * probe windows following the camera: what was lit stays lit, for a scene
   * whose state was restored with {@link SceneGI.importProbeState} or that
   * has converged and is not going to change.
   */
  get updateMode() {
    return this._updateMode;
  }
  set updateMode(val: GIUpdateMode) {
    this._updateMode = val === 'frozen' ? 'frozen' : 'continuous';
  }
  /** Saves the probe volume's state, see {@link ProbeVolume.exportState}. */
  exportProbeState() {
    if (!this._probes?.ready) {
      throw new Error('SceneGI.exportProbeState(): the probes are not built yet');
    }
    return this._probes.exportState();
  }
  /**
   * Restores a probe state saved by {@link SceneGI.exportProbeState} into a
   * volume built with the current settings, and freezes the lighting.
   */
  importProbeState(buffer: ArrayBuffer) {
    if (!this._probes) {
      this._probes = new ProbeVolume(this._scene, this._probeOptions);
    }
    this._probes.importState(buffer);
    this._updateMode = 'frozen';
  }
  /** Rays traced per probe per update; applied when the volume is next built. */
  get probeRays() {
    return this._probeOptions.raysPerProbe;
  }
  set probeRays(val: number) {
    val = Math.max(16, Math.min(1024, Math.floor(val)));
    if (val !== this._probeOptions.raysPerProbe) {
      this._probeOptions.raysPerProbe = val;
      this.rebuildProbes();
    }
  }
  /** Probes updated per frame; applied when the volume is next built. */
  get probeBudget() {
    return this._probeOptions.budget;
  }
  set probeBudget(val: number) {
    val = Math.max(1, Math.floor(val));
    if (val !== this._probeOptions.budget) {
      this._probeOptions.budget = val;
      this.rebuildProbes();
    }
  }
  /** Share of a probe's previous value kept per update, 0 to 1. */
  get probeHysteresis() {
    return this._probeOptions.hysteresis;
  }
  set probeHysteresis(val: number) {
    this._probeOptions.hysteresis = Math.max(0, Math.min(0.999, val));
  }
  /** Multiplier on the indirect light the probes give. */
  get intensity() {
    return this._probeOptions.intensity;
  }
  set intensity(val: number) {
    this._probeOptions.intensity = Math.max(0, val);
  }
  /** Surface offset along the normal when sampling the probes, in world units. */
  get probeNormalBias() {
    return this._probeOptions.normalBias;
  }
  set probeNormalBias(val: number) {
    this._probeOptions.normalBias = Math.max(0, val);
  }
  /** Surface offset towards the viewer when sampling the probes, in world units. */
  get probeViewBias() {
    return this._probeOptions.viewBias;
  }
  set probeViewBias(val: number) {
    this._probeOptions.viewBias = Math.max(0, val);
  }
  /** @internal */
  private rebuildProbes() {
    this._probes?.dispose();
    this._probes = null;
  }
  /** Meshes voxelized per frame. */
  get voxelizeBudget() {
    return this._voxelizeBudget;
  }
  set voxelizeBudget(val: number) {
    this._voxelizeBudget = Math.max(1, Math.floor(val));
  }
  /** Albedo given to the terrain, until it is read from the terrain itself. */
  get terrainAlbedo(): Vector3 {
    return this._terrainAlbedo;
  }
  set terrainAlbedo(val: Vector3) {
    this._terrainAlbedo.set(val);
  }
  /** Voxels per axis of the material atlas; applied when the voxel scene is next built. */
  get atlasSize() {
    return this._atlasSize;
  }
  set atlasSize(val: number) {
    val = Math.max(16, Math.floor(val));
    if (val !== this._atlasSize) {
      this._atlasSize = val;
      this._voxels?.detach(this._scene.sdf);
      this._voxels?.dispose();
      this._voxels = null;
    }
  }
  /** Half angle of the sun shadow cone in the voxel lighting, in degrees; wider is softer. */
  get sunShadowConeAngle() {
    return this._lighting.sunShadowConeAngle;
  }
  set sunShadowConeAngle(val: number) {
    this._lighting.sunShadowConeAngle = Math.max(0.1, Math.min(45, val));
  }
  /** Z slices of every clipmap level lit per frame; the voxel lighting is refreshed every `64 / slices` frames. */
  get lightingSlicesPerFrame() {
    return this._lighting.slicesPerFrame;
  }
  set lightingSlicesPerFrame(val: number) {
    this._lighting.slicesPerFrame = Math.max(1, Math.floor(val));
  }
  /** The voxel scene, once built. */
  get voxels() {
    return this._voxels;
  }
  getStats(): SceneGIStats {
    return {
      enabled: this._enabled,
      supported: SceneGI.isSupported(),
      voxels: this._voxels?.getStats() ?? null,
      probes: this._probes?.getStats() ?? null
    };
  }
  /** Called by the scene once a frame, before the scene field's update. */
  update(cameraPos: Vector3, deltaSeconds: number) {
    if (!this._enabled || !this._scene.sdf.enabled) {
      return;
    }
    if (!SceneGI.isSupported()) {
      if (!this._warned) {
        this._warned = true;
        console.warn('SceneGI: global illumination needs WebGPU; nothing is built on this device');
      }
      return;
    }
    if (!this._voxels) {
      this._voxels = new VoxelScene(this._scene, this._atlasSize);
    }
    this._voxels.voxelizeBudget = this._voxelizeBudget;
    this._voxels.terrainAlbedo.setXYZW(
      this._terrainAlbedo.x,
      this._terrainAlbedo.y,
      this._terrainAlbedo.z,
      1
    );
    this._voxels.update(this._scene.sdf, cameraPos, deltaSeconds);
  }
  /** Called by the scene once a frame, after the scene field's update. */
  updateLighting(camera: Camera) {
    if (!this._enabled || !this._voxels || !this._scene.sdf.enabled) {
      return;
    }
    // The probes are read at the camera's exposure even while frozen
    this._probes?.setReadExposure(camera);
    if (this._updateMode === 'frozen') {
      return;
    }
    RenderGraphExecutor.profileScope('VoxelLighting', () =>
      this._voxels!.updateLighting(this._scene.sdf, camera, this._lighting)
    );
    if (!this._voxels.lit) {
      return;
    }
    if (!this._probes) {
      this._probes = new ProbeVolume(this._scene, this._probeOptions);
    }
    this._probes.setReadExposure(camera);
    RenderGraphExecutor.profileScope('ProbeUpdate', () =>
      this._probes!.update(this._scene.sdf, this._voxels!, camera)
    );
  }
  dispose() {
    this.enabled = false;
  }
}
