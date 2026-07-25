/** Frame resources requested before Forward+ module setup. @public */
export interface FrameResourceRequirements {
  motionVector?: boolean;
  hiZ?: boolean;
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
  target.sceneNormal = !!target.sceneNormal || !!source.sceneNormal;
  target.sceneRoughness = !!target.sceneRoughness || !!source.sceneRoughness;
  target.shadowMask = !!target.shadowMask || !!source.shadowMask;
  return target;
}
