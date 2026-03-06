/**
 * IK (Inverse Kinematics) system for skeletal animation.
 *
 * @remarks
 * This module provides IK solving capabilities for Zephyr3D's animation system.
 * It includes:
 * - FABRIK solver for multi-joint chains
 * - Constraint system (angle limits, pole vectors)
 * - Integration with AnimationTrack system
 *
 * @packageDocumentation
 */

export type { IKJoint } from './ik_joint';
export { IKChain } from './ik_chain';
export { IKSolver } from './ik_solver';
export { FABRIKSolver } from './fabrik_solver';
export { IKConstraint } from './ik_constraint';
export { IKAngleConstraint } from './ik_angle_constraint';
export { IKPoleVectorConstraint } from './ik_pole_constraint';
export { IKTrack } from './ik_track';
