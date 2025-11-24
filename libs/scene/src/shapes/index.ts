import type { Shape } from './shape';
import type { BoxFrameShape, BoxShape } from './box';
import type { CylinderShape } from './cylinder';
import type { PlaneShape } from './plane';
import type { SphereShape } from './sphere';
import type { TorusShape } from './torus';
import type { TetrahedronFrameShape, TetrahedronShape } from './tetrahedron';

export * from './shape';
export * from './box';
export * from './cylinder';
export * from './torus';
export * from './plane';
export * from './sphere';
export * from './tetrahedron';

/**
 * Shape types
 * @public
 */
export type ShapeType =
  | BoxShape
  | BoxFrameShape
  | SphereShape
  | CylinderShape
  | PlaneShape
  | TorusShape
  | TetrahedronShape
  | TetrahedronFrameShape;
/**
 * Shape option types
 * @public
 */
export type ShapeOptionType<ST extends ShapeType> = ST extends Shape<infer U> ? U : never;
