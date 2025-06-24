import type { ProgramBuilder } from './programbuilder';

let currentProgramBuilder: ProgramBuilder = null;
/** @internal */
export function setCurrentProgramBuilder(pb: ProgramBuilder) {
  currentProgramBuilder = pb;
}

/** @internal */
export function getCurrentProgramBuilder(): ProgramBuilder {
  return currentProgramBuilder;
}
