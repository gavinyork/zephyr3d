import { IKChain } from './ik_chain';
import type { SceneNode } from '../../scene/scene_node';
import type { Skeleton } from '../skeleton';

/**
 * Helper class for building IK chains from various sources.
 *
 * @public
 */
export class IKChainBuilder {
  /**
   * Create an IK chain from an array of scene nodes.
   *
   * @param nodes - Array of scene nodes from root to end effector
   * @returns The created IK chain
   */
  static fromNodes(nodes: SceneNode[]): IKChain {
    return new IKChain(nodes);
  }

  /**
   * Create an IK chain from a skeleton using joint indices.
   *
   * @param skeleton - The skeleton containing the joints
   * @param jointIndices - Array of joint indices from root to end effector
   * @returns The created IK chain
   */
  static fromSkeleton(skeleton: Skeleton, jointIndices: number[]): IKChain {
    if (jointIndices.length < 2) {
      throw new Error('IK chain must have at least 2 joints');
    }

    const joints = skeleton.joints;
    const nodes: SceneNode[] = [];

    for (const index of jointIndices) {
      if (index < 0 || index >= joints.length) {
        throw new Error(`Invalid joint index: ${index}`);
      }
      nodes.push(joints[index]);
    }

    return new IKChain(nodes);
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
}
