import type { GPUProgram, PBComputeOptions, PBRenderOptions } from '@zephyr3d/device';
import type { Nullable } from '@zephyr3d/base';
import { getDevice } from '../../app/api';

/** Programs of the SDF system by label, with the error that stopped one, if any. */
const programs = new Map<string, Nullable<GPUProgram>>();
const buildErrors = new Map<string, string>();

/**
 * Builds a program of the SDF system and records the outcome under its label.
 *
 * A shader builder error (a JS-side failure, before any WGSL exists) makes the
 * device return null with the message only in the builder's `lastError`; a
 * caller dereferencing the null then fails far from the cause, and nothing
 * reaches {@link getSDFProgramErrors}. Here the message is kept and a clear
 * error thrown instead.
 *
 * @internal
 */
export function buildSDFProgram(options: PBComputeOptions | PBRenderOptions): GPUProgram {
  const device = getDevice();
  const label = options.label ?? 'SDF';
  const program =
    'compute' in options
      ? device.buildComputeProgram(options as PBComputeOptions)
      : device.buildRenderProgram(options as PBRenderOptions);
  programs.set(label, program);
  if (!program) {
    const err = device.programBuilder.lastError || 'unknown shader builder error';
    buildErrors.set(label, err);
    throw new Error(`${label}: ${err}`);
  }
  buildErrors.delete(label);
  return program;
}

/**
 * Errors of the SDF system's programs by label: shader builder errors and
 * WGSL compile errors. Empty when everything built.
 * @public
 */
export function getSDFProgramErrors(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [label, err] of buildErrors) {
    out[label] = err;
  }
  for (const [label, program] of programs) {
    const err = program?.getCompileError();
    if (err) {
      out[label] = err;
    }
  }
  return out;
}
