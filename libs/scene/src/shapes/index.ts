import type { Shape } from './shape';
import { BoxFrameShape, BoxShape } from './box';
import { CylinderShape } from './cylinder';
import { PlaneShape } from './plane';
import { SphereShape } from './sphere';
import { TorusShape } from './torus';

export * from './shape';
export * from './box';
export * from './cylinder';
export * from './torus';
export * from './plane';
export * from './sphere';

export type ShapeType = BoxShape | BoxFrameShape | SphereShape | CylinderShape | PlaneShape | TorusShape;
export type ShapeOptionType<ST extends ShapeType> = ST extends Shape<infer U> ? U : never;
