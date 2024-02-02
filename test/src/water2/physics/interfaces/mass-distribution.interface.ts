import { mat3 } from 'gl-matrix';

export interface MassDistributionInterface {
  getInertiaTensor(mass: number): mat3;
}
