import { Vector3, Quaternion } from '@zephyr3d/base';
import type { IKJoint } from './ik_joint';
import type { SceneNode } from '../../scene/scene_node';
import type { IKConstraint } from './ik_constraint';
import { IKUtils } from './ik_utils';

/**
 * Represents a chain of joints for IK solving.
 *
 * @public
 */
export class IKChain {
  /** Array of joints in the chain (root to end effector) */
  private _joints: IKJoint[];
  /** Total length of the chain */
  private _totalLength: number;
  /** Constraints applied to joints */
  private _constraints: IKConstraint[];

  /**
   * Create an IK chain from an array of scene nodes.
   *
   * @param nodes - Array of scene nodes from root to end effector
   */
  constructor(nodes: SceneNode[]) {
    if (nodes.length < 2) {
      throw new Error('IK chain must have at least 2 joints');
    }

    this._joints = [];
    this._totalLength = 0;
    this._constraints = [];

    // Create joints from nodes
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const position = new Vector3();
      const rotation = new Quaternion();
      node.worldMatrix.decompose(null, rotation, position);

      let boneLength = 0;
      if (i < nodes.length - 1) {
        const nextPosition = new Vector3();
        nodes[i + 1].worldMatrix.decompose(null, null, nextPosition);
        boneLength = IKUtils.calculateBoneLength(position, nextPosition);
        this._totalLength += boneLength;
      }

      this._joints.push({
        node,
        position: position.clone(),
        originalPosition: position.clone(),
        rotation: rotation.clone(),
        originalRotation: rotation.clone(),
        boneLength
      });
    }
  }

  /**
   * Create an IK chain by traversing from a start node to an end node.
   *
   * @remarks
   * This method walks up the parent chain from the end node until it
   * reaches the start node, building the joint chain in the process.
   *
   * @param startNode - The root joint of the chain
   * @param endNode - The end effector joint
   * @returns The created IK chain
   */
  static fromNodeHierarchy(startNode: SceneNode, endNode: SceneNode): IKChain {
    const nodes: SceneNode[] = [];
    let current: SceneNode | null = endNode;

    // Walk up the hierarchy from end to start
    while (current) {
      nodes.unshift(current); // Add to front

      if (current === startNode) {
        break;
      }

      current = current.parent as SceneNode | null;
    }

    if (nodes[0] !== startNode) {
      throw new Error('End node is not a descendant of start node');
    }

    if (nodes.length < 2) {
      throw new Error('IK chain must have at least 2 joints');
    }

    return new IKChain(nodes);
  }

  /**
   * Get all joints in the chain.
   */
  get joints(): IKJoint[] {
    return this._joints;
  }

  /**
   * Get the root joint (first joint in the chain).
   */
  get root(): IKJoint {
    return this._joints[0];
  }

  /**
   * Get the end effector (last joint in the chain).
   */
  get endEffector(): IKJoint {
    return this._joints[this._joints.length - 1];
  }

  /**
   * Get the total length of the chain.
   */
  get totalLength(): number {
    return this._totalLength;
  }

  /**
   * Get the number of joints in the chain.
   */
  get length(): number {
    return this._joints.length;
  }

  /**
   * Update joint positions from their scene nodes.
   */
  updateFromNodes(): void {
    for (const joint of this._joints) {
      joint.node.worldMatrix.decompose(null, joint.rotation, joint.position);
    }
  }

  /**
   * Store current positions as original positions.
   */
  storeOriginalPositions(): void {
    for (const joint of this._joints) {
      joint.originalPosition.set(joint.position);
      joint.originalRotation.set(joint.rotation);
    }
  }

  /**
   * Restore joints to their original positions.
   */
  restoreOriginalPositions(): void {
    for (const joint of this._joints) {
      joint.position.set(joint.originalPosition);
      joint.rotation.set(joint.originalRotation);
    }
  }

  /**
   * Add a constraint to a specific joint.
   *
   * @param constraint - The constraint to add
   */
  addConstraint(constraint: IKConstraint): void {
    this._constraints.push(constraint);
  }

  /**
   * Remove a constraint from the chain.
   *
   * @param constraint - The constraint to remove
   * @returns True if the constraint was found and removed
   */
  removeConstraint(constraint: IKConstraint): boolean {
    const index = this._constraints.indexOf(constraint);
    if (index >= 0) {
      this._constraints.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Clear all constraints from the chain.
   */
  clearConstraints(): void {
    this._constraints = [];
  }

  /**
   * Get all constraints in the chain.
   */
  get constraints(): readonly IKConstraint[] {
    return this._constraints;
  }

  /**
   * Apply all constraints to the joint chain.
   */
  applyConstraints(): void {
    for (const constraint of this._constraints) {
      constraint.apply(this._joints);
    }
  }
}
