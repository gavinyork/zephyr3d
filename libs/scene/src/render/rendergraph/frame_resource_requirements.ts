/** Frame resources requested before Forward+ module setup. @public */
export interface FrameResourceRequirements {
  motionVector?: boolean;
  hiZ?: boolean;
  /**
   * The Hi-Z pyramid's nearest-depth channel, for proximity queries.
   *
   * Implies {@link FrameResourceRequirements.hiZ} - it is a second channel of
   * the same pyramid, not a separate resource - and costs that pyramid's
   * bandwidth twice over, so it is requested separately from it.
   */
  hiZNearest?: boolean;
  sceneNormal?: boolean;
  sceneRoughness?: boolean;
  shadowMask?: boolean;
}

/** Merge frame-resource requirements using monotonic OR semantics. @public */
export function mergeFrameResourceRequirements(
  target: FrameResourceRequirements,
  source: FrameResourceRequirements | null | undefined
): FrameResourceRequirements {
  if (!source) {
    return target;
  }
  target.motionVector = !!target.motionVector || !!source.motionVector;
  target.hiZ = !!target.hiZ || !!source.hiZ;
  target.hiZNearest = !!target.hiZNearest || !!source.hiZNearest;
  target.sceneNormal = !!target.sceneNormal || !!source.sceneNormal;
  target.sceneRoughness = !!target.sceneRoughness || !!source.sceneRoughness;
  target.shadowMask = !!target.shadowMask || !!source.shadowMask;
  return target;
}
