/**
 * Simple test to verify IK system functionality
 *
 * This test creates a basic 3-joint arm and verifies that:
 * 1. FABRIK solver can reach a target position
 * 2. Angle constraints work correctly
 * 3. Pole vector constraints affect joint orientation
 */

import { Scene } from '../../scene/scene';
import { SceneNode } from '../../scene/scene_node';
import { FABRIKSolver } from './fabrik_solver';
import { IKAngleConstraint } from './ik_angle_constraint';
import { IKPoleVectorConstraint } from './ik_pole_constraint';
import { IKChainBuilder } from './ik_chain_builder';
import { Vector3 } from '@zephyr3d/base';

/**
 * Create a simple 3-joint arm for testing
 */
function createTestArm(scene: Scene): SceneNode[] {
  const shoulder = new SceneNode(scene);
  shoulder.position.setXYZ(0, 0, 0);

  const elbow = new SceneNode(scene);
  elbow.position.setXYZ(1, 0, 0);
  elbow.parent = shoulder;

  const hand = new SceneNode(scene);
  hand.position.setXYZ(1, 0, 0);
  hand.parent = elbow;

  return [shoulder, elbow, hand];
}

/**
 * Test 1: Basic FABRIK solver convergence
 */
export function testBasicFABRIK(): boolean {
  console.log('Test 1: Basic FABRIK solver convergence');

  const scene = new Scene();
  const joints = createTestArm(scene);
  const chain = IKChainBuilder.fromNodes(joints);
  const solver = new FABRIKSolver(chain, 20, 0.001);

  // Target within reach (chain length is 2)
  const target = new Vector3(1.5, 0.5, 0);

  const converged = solver.solve(target);
  solver.applyToNodes(1.0);

  // Check end effector position
  const endPos = new Vector3();
  chain.endEffector.node.worldMatrix.decompose(null, null, endPos);

  const distance = Vector3.distance(endPos, target);
  const success = converged && distance < 0.01;

  console.log(`  Converged: ${converged}`);
  console.log(`  End effector position: (${endPos.x.toFixed(3)}, ${endPos.y.toFixed(3)}, ${endPos.z.toFixed(3)})`);
  console.log(`  Target position: (${target.x.toFixed(3)}, ${target.y.toFixed(3)}, ${target.z.toFixed(3)})`);
  console.log(`  Distance to target: ${distance.toFixed(6)}`);
  console.log(`  Result: ${success ? 'PASS ✓' : 'FAIL ✗'}\n`);

  return success;
}

/**
 * Test 2: Unreachable target handling
 */
export function testUnreachableTarget(): boolean {
  console.log('Test 2: Unreachable target handling');

  const scene = new Scene();
  const joints = createTestArm(scene);
  const chain = IKChainBuilder.fromNodes(joints);
  const solver = new FABRIKSolver(chain);

  // Target beyond reach (chain length is 2)
  const target = new Vector3(5, 0, 0);

  const converged = solver.solve(target);
  solver.applyToNodes(1.0);

  // Should not converge, but chain should stretch toward target
  const endPos = new Vector3();
  chain.endEffector.node.worldMatrix.decompose(null, null, endPos);

  // Check that chain is stretched (end effector should be at max distance from root)
  const rootPos = new Vector3();
  chain.root.node.worldMatrix.decompose(null, null, rootPos);
  const stretchDistance = Vector3.distance(rootPos, endPos);

  const success = !converged && Math.abs(stretchDistance - chain.totalLength) < 0.01;

  console.log(`  Converged: ${converged} (should be false)`);
  console.log(`  Chain total length: ${chain.totalLength.toFixed(3)}`);
  console.log(`  Stretched distance: ${stretchDistance.toFixed(3)}`);
  console.log(`  Result: ${success ? 'PASS ✓' : 'FAIL ✗'}\n`);

  return success;
}

/**
 * Test 3: Angle constraint enforcement
 */
export function testAngleConstraint(): boolean {
  console.log('Test 3: Angle constraint enforcement');

  const scene = new Scene();
  const joints = createTestArm(scene);
  const chain = IKChainBuilder.fromNodes(joints);

  // Add strict angle constraint to elbow (0-90 degrees)
  chain.addConstraint(new IKAngleConstraint(1, 0, 90));

  const solver = new FABRIKSolver(chain);

  // Target that would require >90 degree bend without constraint
  const target = new Vector3(0.5, 1.0, 0);

  solver.solve(target);
  solver.applyToNodes(1.0);

  // Calculate actual angle at elbow
  const shoulder = chain.joints[0];
  const elbow = chain.joints[1];
  const hand = chain.joints[2];

  const toShoulder = Vector3.sub(shoulder.position, elbow.position, new Vector3());
  const toHand = Vector3.sub(hand.position, elbow.position, new Vector3());

  toShoulder.inplaceNormalize();
  toHand.inplaceNormalize();

  const dot = Vector3.dot(toShoulder, toHand);
  const angleDeg = Math.acos(Math.max(-1, Math.min(1, dot))) * (180 / Math.PI);

  const success = angleDeg <= 91; // Allow 1 degree tolerance

  console.log(`  Elbow angle: ${angleDeg.toFixed(2)}° (should be ≤90°)`);
  console.log(`  Result: ${success ? 'PASS ✓' : 'FAIL ✗'}\n`);

  return success;
}

/**
 * Test 4: Pole vector constraint
 */
export function testPoleVectorConstraint(): boolean {
  console.log('Test 4: Pole vector constraint');

  const scene = new Scene();
  const joints = createTestArm(scene);
  const chain = IKChainBuilder.fromNodes(joints);

  // Add pole vector pointing upward
  const poleVector = new Vector3(0, 2, 0);
  chain.addConstraint(new IKPoleVectorConstraint(1, poleVector, 1.0));

  const solver = new FABRIKSolver(chain);
  const target = new Vector3(1.5, 0.3, 0);

  solver.solve(target);
  solver.applyToNodes(1.0);

  // Check that elbow is above the shoulder-hand line (pointing toward pole)
  const shoulderPos = chain.joints[0].position;
  const elbowPos = chain.joints[1].position;
  const handPos = chain.joints[2].position;

  // Calculate if elbow is on the positive Y side
  const elbowY = elbowPos.y;
  const lineY = (shoulderPos.y + handPos.y) / 2;

  const success = elbowY > lineY;

  console.log(`  Shoulder Y: ${shoulderPos.y.toFixed(3)}`);
  console.log(`  Elbow Y: ${elbowPos.y.toFixed(3)}`);
  console.log(`  Hand Y: ${handPos.y.toFixed(3)}`);
  console.log(`  Elbow above midline: ${success}`);
  console.log(`  Result: ${success ? 'PASS ✓' : 'FAIL ✗'}\n`);

  return success;
}

/**
 * Test 5: Chain builder from hierarchy
 */
export function testChainBuilder(): boolean {
  console.log('Test 5: Chain builder from hierarchy');

  const scene = new Scene();
  const joints = createTestArm(scene);

  // Build chain from hierarchy
  const chain = IKChainBuilder.fromNodeHierarchy(joints[0], joints[2]);

  const success = chain.length === 3 && chain.root.node === joints[0] && chain.endEffector.node === joints[2];

  console.log(`  Chain length: ${chain.length} (expected: 3)`);
  console.log(`  Root matches: ${chain.root.node === joints[0]}`);
  console.log(`  End effector matches: ${chain.endEffector.node === joints[2]}`);
  console.log(`  Result: ${success ? 'PASS ✓' : 'FAIL ✗'}\n`);

  return success;
}

/**
 * Run all IK tests
 */
export function runAllIKTests(): void {
  console.log('='.repeat(60));
  console.log('IK System Test Suite');
  console.log('='.repeat(60) + '\n');

  const results = [
    testBasicFABRIK(),
    testUnreachableTarget(),
    testAngleConstraint(),
    testPoleVectorConstraint(),
    testChainBuilder()
  ];

  const passed = results.filter((r) => r).length;
  const total = results.length;

  console.log('='.repeat(60));
  console.log(`Test Results: ${passed}/${total} passed`);
  console.log('='.repeat(60));

  if (passed === total) {
    console.log('✓ All tests passed!');
  } else {
    console.log(`✗ ${total - passed} test(s) failed`);
  }
}
