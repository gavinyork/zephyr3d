import type { AABB } from '@zephyr3d/base';
import { Vector3 } from '@zephyr3d/base';
import type { Camera } from '../camera/camera';
import type { PrimitiveLod } from './primitive';

const tmpViewOrigin = new Vector3();

/**
 * Squared projected radius of a bounding sphere, UE ComputeBoundsScreenRadiusSquared
 * (SceneManagement.cpp): the radius scaled by the larger projection scale, divided by the view
 * distance, which an orthographic projection ignores.
 *
 * @param center - World space sphere center
 * @param radius - World space sphere radius
 * @param camera - The camera whose view the size is measured in
 * @returns The squared screen radius, in units of the half screen extent
 * @public
 */
export function computeBoundsScreenRadiusSquared(center: Vector3, radius: number, camera: Camera) {
  const proj = camera.getProjectionMatrix();
  // UE clamps the squared distance to 1 cm^2, the same in meters
  const distSq = camera.isPerspective()
    ? Math.max(Vector3.distanceSq(center, camera.getWorldPosition(tmpViewOrigin)), 1e-4)
    : 1;
  const screenMultiple = Math.max(0.5 * Math.abs(proj.m00), 0.5 * Math.abs(proj.m11));
  const screenRadius = screenMultiple * radius;
  return (screenRadius * screenRadius) / distSq;
}

/**
 * Projected size of a bounding sphere, UE ComputeBoundsScreenSize (SceneManagement.cpp): the
 * screen diameter, the measure {@link PrimitiveLod.screenSize} is given in.
 *
 * @param center - World space sphere center
 * @param radius - World space sphere radius
 * @param camera - The camera whose view the size is measured in
 * @public
 */
export function computeBoundsScreenSize(center: Vector3, radius: number, camera: Camera) {
  return 2 * Math.sqrt(computeBoundsScreenRadiusSquared(center, radius, camera));
}

/**
 * Squared projected radius of the sphere enclosing a world space box
 * @internal
 */
export function computeAABBScreenRadiusSquared(aabb: AABB, camera: Camera, out: Vector3) {
  const min = aabb.minPoint;
  const max = aabb.maxPoint;
  out.setXYZ((min.x + max.x) * 0.5, (min.y + max.y) * 0.5, (min.z + max.z) * 0.5);
  const dx = (max.x - min.x) * 0.5;
  const dy = (max.y - min.y) * 0.5;
  const dz = (max.z - min.z) * 0.5;
  return computeBoundsScreenRadiusSquared(out, Math.sqrt(dx * dx + dy * dy + dz * dz), camera);
}

/**
 * Picks the level of detail for a projected size, UE ComputeStaticMeshLOD (SceneManagement.cpp):
 * the coarsest level whose screen size is still larger than the projected size. The current level
 * and the finer ones count with their size plus the hysteresis, so going back to a finer level
 * takes the projected size to grow past it, as for UE skeletal meshes
 * (FSkeletalMeshObject::UpdateMinDesiredLODLevel, SkeletalRender.cpp).
 *
 * @param lods - Levels after the first, finest to coarsest
 * @param screenRadiusSquared - Squared projected radius, see {@link computeBoundsScreenRadiusSquared}
 * @param screenSizeScale - Scale of the level screen sizes, larger switches to coarser levels sooner
 * @param currentLod - Level used so far
 * @param minLod - Finest level allowed
 * @returns The level of detail, 0 being the finest
 * @public
 */
export function selectLod(
  lods: readonly Readonly<PrimitiveLod>[],
  screenRadiusSquared: number,
  screenSizeScale: number,
  currentLod: number,
  minLod: number
) {
  minLod = Math.min(Math.max(minLod, 0), lods.length);
  for (let i = lods.length; i > 0; i--) {
    const lod = lods[i - 1];
    const screenSize = (lod.screenSize + (i <= currentLod ? lod.hysteresis : 0)) * screenSizeScale;
    if (screenSize * screenSize * 0.25 > screenRadiusSquared) {
      return Math.max(i, minLod);
    }
  }
  return minLod;
}
