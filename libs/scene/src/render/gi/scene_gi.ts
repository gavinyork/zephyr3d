import type { Nullable } from '@zephyr3d/base';
import { Vector3 } from '@zephyr3d/base';
import type { Scene } from '../../scene/scene';
import { GlobalSDF } from '../sdf/global_sdf';
import { VoxelScene } from './voxel_scene';
import type { VoxelSceneStats } from './voxel_scene';

/**
 * Counters of a {@link SceneGI}.
 * @public
 */
export interface SceneGIStats {
  enabled: boolean;
  /** False on a device that cannot build it (WebGL2). */
  supported: boolean;
  voxels: Nullable<VoxelSceneStats>;
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
  private _warned: boolean;
  constructor(scene: Scene) {
    this._scene = scene;
    this._enabled = false;
    this._voxels = null;
    this._atlasSize = 256;
    this._voxelizeBudget = 8;
    this._terrainAlbedo = new Vector3(0.3, 0.3, 0.3);
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
    }
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
  /** The voxel scene, once built. */
  get voxels() {
    return this._voxels;
  }
  getStats(): SceneGIStats {
    return {
      enabled: this._enabled,
      supported: SceneGI.isSupported(),
      voxels: this._voxels?.getStats() ?? null
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
  dispose() {
    this.enabled = false;
  }
}
