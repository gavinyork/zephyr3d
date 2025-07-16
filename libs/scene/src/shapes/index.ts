import type { Shape } from './shape';
import type { BoxFrameShape, BoxShape } from './box';
import type { CylinderShape } from './cylinder';
import type { PlaneShape } from './plane';
import type { SphereShape } from './sphere';
import type { TorusShape } from './torus';

export * from './shape';
export * from './box';
export * from './cylinder';
export * from './torus';
export * from './plane';
export * from './sphere';

/**
 * Shape types
 * @public
 */
export type ShapeType = BoxShape | BoxFrameShape | SphereShape | CylinderShape | PlaneShape | TorusShape;
/**
 * Shape option types
 * @public
 */
export type ShapeOptionType<ST extends ShapeType> = ST extends Shape<infer U> ? U : never;
