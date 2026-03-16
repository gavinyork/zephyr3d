/**
 * IK (Inverse Kinematics) system for skeletal animation.
 *
 * @remarks
 * This module provides IK solving capabilities for Zephyr3D's animation system.
 * It includes:
 * - FABRIK solver for multi-joint chains
 * - Two Bone IK solver for 2-bone chains (arms, legs)
 * - CCD solver for flexible chains (tentacles, tails)
 * - Constraint system (angle limits, pole vectors, twist constraints)
 * - Integration with AnimationTrack system
 *
 * @packageDocumentation
 */

export type { IKJoint } from './ik_joint';
export { IKChain } from './ik_chain';
export { IKSolver } from './ik_solver';
export { FABRIKSolver, type TwistConstraint as FABRIKTwistConstraint } from './fabrik_solver';
export { TwoBoneIKSolver, type TwistConstraint as TwoBoneTwistConstraint } from './two_bone_ik_solver';
export { CCDSolver, type TwistConstraint as CCDTwistConstraint } from './ccd_solver';
export { IKConstraint } from './ik_constraint';
export { IKAngleConstraint } from './ik_angle_constraint';
export { IKTrack } from './ik_track';
