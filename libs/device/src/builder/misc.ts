import type { Nullable } from '@zephyr3d/base';
import type { ProgramBuilder } from './programbuilder';

let currentProgramBuilder: Nullable<ProgramBuilder>;

/** @internal */
export function setCurrentProgramBuilder(pb: Nullable<ProgramBuilder>) {
  currentProgramBuilder = pb;
}

/** @internal */
export function getCurrentProgramBuilder() {
  return currentProgramBuilder;
}
