/**
 * Example: Basic IK usage with FABRIK solver
 *
 * This example demonstrates how to use the IK system independently
 * (without animation system integration).
 */

import { Scene } from '../../scene/scene';
import { SceneNode } from '../../scene/scene_node';
import { IKChain } from './ik_chain';
import { FABRIKSolver } from './fabrik_solver';
import { IKAngleConstraint } from './ik_angle_constraint';
import { IKPoleVectorConstraint } from './ik_pole_constraint';
import { IKTrack } from './ik_track';
import { IKChainBuilder } from './ik_chain_builder';
import { AnimationSet } from '../animationset';
import { Vector3 } from '@zephyr3d/base';

// Create a simple 3-joint arm (shoulder -> elbow -> hand)
function createArmChain(scene: Scene): SceneNode[] {
  const shoulder = new SceneNode(scene);
  shoulder.position.setXYZ(0, 0, 0);

  const elbow = new SceneNode(scene);
  elbow.position.setXYZ(1, 0, 0); // 1 unit away
  elbow.parent = shoulder;

  const hand = new SceneNode(scene);
  hand.position.setXYZ(1, 0, 0); // 1 unit away from elbow
  hand.parent = elbow;

  return [shoulder, elbow, hand];
}

// Example usage
export function exampleBasicIK() {
  // Setup scene
  const scene = new Scene();
  const joints = createArmChain(scene);

  // Create IK chain
  const chain = new IKChain(joints);
  console.log(`Chain length: ${chain.length} joints`);
  console.log(`Total bone length: ${chain.totalLength}`);

  // Create FABRIK solver
  const solver = new FABRIKSolver(chain);
  solver.setMaxIterations(15);
  solver.setTolerance(0.001);

  // Target position (reachable)
  const target = new Vector3(1.5, 0.5, 0);

  // Solve IK
  const converged = solver.solve(target);
  console.log(`IK converged: ${converged}`);

  // Apply solution to scene nodes
  solver.applyToNodes(1.0); // Full weight

  // Check end effector position
  const endEffectorPos = new Vector3();
  chain.endEffector.node.worldMatrix.decompose(null, null, endEffectorPos);
  console.log(`End effector position: ${endEffectorPos}`);
  console.log(`Distance to target: ${Vector3.distance(endEffectorPos, target)}`);
}

// Example with unreachable target
export function exampleUnreachableTarget() {
  const scene = new Scene();
  const joints = createArmChain(scene);
  const chain = new IKChain(joints);
  const solver = new FABRIKSolver(chain);

  // Target position (unreachable - beyond chain length)
  const target = new Vector3(5, 0, 0); // Chain length is only 2

  const converged = solver.solve(target);
  console.log(`IK converged: ${converged}`); // Should be false

  solver.applyToNodes(1.0);

  // Chain should be stretched toward target
  const endEffectorPos = new Vector3();
  chain.endEffector.node.worldMatrix.decompose(null, null, endEffectorPos);
  console.log(`End effector stretched to: ${endEffectorPos}`);
}

// Example with blending
export function exampleBlending() {
  const scene = new Scene();
  const joints = createArmChain(scene);
  const chain = new IKChain(joints);
  const solver = new FABRIKSolver(chain);

  const target = new Vector3(1.5, 0.5, 0);
  solver.solve(target);

  // Apply with 50% weight (blend between original and IK solution)
  solver.applyToNodes(0.5);

  console.log('Applied IK with 50% blend weight');
}

// Example with angle constraints
export function exampleAngleConstraints() {
  const scene = new Scene();
  const joints = createArmChain(scene);
  const chain = new IKChain(joints);

  // Add elbow constraint: limit bending to 0-150 degrees
  // Joint index 1 is the elbow (middle joint)
  const elbowConstraint = new IKAngleConstraint(1, 0, 150);
  chain.addConstraint(elbowConstraint);

  const solver = new FABRIKSolver(chain);
  const target = new Vector3(1.5, 0.8, 0);

  solver.solve(target);
  solver.applyToNodes(1.0);

  console.log('Applied IK with elbow angle constraint (0-150 degrees)');

  // The elbow will not bend beyond 150 degrees
  const endEffectorPos = new Vector3();
  chain.endEffector.node.worldMatrix.decompose(null, null, endEffectorPos);
  console.log(`End effector position: ${endEffectorPos}`);
}

// Example with multiple constraints
export function exampleMultipleConstraints() {
  const scene = new Scene();

  // Create a 4-joint chain (shoulder -> upper arm -> elbow -> forearm -> hand)
  const shoulder = new SceneNode(scene);
  shoulder.position.setXYZ(0, 0, 0);

  const upperArm = new SceneNode(scene);
  upperArm.position.setXYZ(0.5, 0, 0);
  upperArm.parent = shoulder;

  const elbow = new SceneNode(scene);
  elbow.position.setXYZ(0.5, 0, 0);
  elbow.parent = upperArm;

  const forearm = new SceneNode(scene);
  forearm.position.setXYZ(0.5, 0, 0);
  forearm.parent = elbow;

  const hand = new SceneNode(scene);
  hand.position.setXYZ(0.5, 0, 0);
  hand.parent = forearm;

  const joints = [shoulder, upperArm, elbow, forearm, hand];
  const chain = new IKChain(joints);

  // Add constraints to multiple joints
  chain.addConstraint(new IKAngleConstraint(1, 0, 170)); // Upper arm
  chain.addConstraint(new IKAngleConstraint(2, 0, 150)); // Elbow
  chain.addConstraint(new IKAngleConstraint(3, 0, 160)); // Forearm

  const solver = new FABRIKSolver(chain);
  const target = new Vector3(1.5, 0.5, 0);

  solver.solve(target);
  solver.applyToNodes(1.0);

  console.log('Applied IK with multiple angle constraints');
}

// Example with pole vector constraint
export function examplePoleVector() {
  const scene = new Scene();
  const joints = createArmChain(scene);
  const chain = new IKChain(joints);

  // Add pole vector to control elbow direction
  // Pole vector at (0, 1, 0) will make the elbow point upward
  const poleVector = new Vector3(0, 1, 0);
  const poleConstraint = new IKPoleVectorConstraint(1, poleVector, 1.0);
  chain.addConstraint(poleConstraint);

  const solver = new FABRIKSolver(chain);
  const target = new Vector3(1.5, 0.5, 0);

  solver.solve(target);
  solver.applyToNodes(1.0);

  console.log('Applied IK with pole vector constraint (elbow points up)');
}

// Example combining angle and pole vector constraints
export function exampleCombinedConstraints() {
  const scene = new Scene();
  const joints = createArmChain(scene);
  const chain = new IKChain(joints);

  // Add both angle limit and pole vector
  chain.addConstraint(new IKAngleConstraint(1, 0, 150)); // Limit elbow bending
  chain.addConstraint(new IKPoleVectorConstraint(1, new Vector3(0, 1, 0), 0.8)); // Elbow points up

  const solver = new FABRIKSolver(chain);
  const target = new Vector3(1.5, 0.5, 0);

  solver.solve(target);
  solver.applyToNodes(1.0);

  console.log('Applied IK with combined angle and pole vector constraints');
}

// Example: Animation system integration
export function exampleAnimationIntegration() {
  const scene = new Scene();
  const joints = createArmChain(scene);

  // Create IK chain and solver
  const chain = IKChainBuilder.fromNodes(joints);
  const solver = new FABRIKSolver(chain);

  // Create animation set for the root node
  const animationSet = new AnimationSet(joints[0]);

  // Create IK track
  const ikTrack = new IKTrack(solver, Infinity);

  // Create an animation clip and add the IK track
  const ikAnimation = animationSet.createAnimation('ik-reach');
  if (ikAnimation) {
    ikAnimation.addTrack(joints[0], ikTrack); // Target is the root node
  }

  // Solve IK to a target
  const target = new Vector3(1.5, 0.5, 0);
  solver.solve(target);

  // Play the IK animation
  animationSet.playAnimation('ik-reach');

  // Set weight for blending
  animationSet.setAnimationWeight('ik-reach', 0.8);

  console.log('IK integrated with animation system');
}

// Example: Using IKChainBuilder
export function exampleChainBuilder() {
  const scene = new Scene();

  // Create a hierarchy
  const shoulder = new SceneNode(scene);
  shoulder.position.setXYZ(0, 0, 0);

  const elbow = new SceneNode(scene);
  elbow.position.setXYZ(1, 0, 0);
  elbow.parent = shoulder;

  const hand = new SceneNode(scene);
  hand.position.setXYZ(1, 0, 0);
  hand.parent = elbow;

  // Build chain from hierarchy
  const chain = IKChainBuilder.fromNodeHierarchy(shoulder, hand);

  console.log(`Built chain with ${chain.length} joints from hierarchy`);

  // Or build from node array
  const chain2 = IKChainBuilder.fromNodes([shoulder, elbow, hand]);

  console.log(`Built chain with ${chain2.length} joints from array`);
}
