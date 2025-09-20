import type { IGraphNode } from '@zephyr3d/scene';

export interface NodeConnection {
  targetNodeId: number;
  startSlotId: number;
  endSlotId: number;
}

// Adjacency List
export interface GraphStructure {
  // Forward Adjacency List: nodeId -> Output links
  outgoing: Record<number, NodeConnection[]>;
  // Backward Adjacency List: nodeId -> Input links
  incoming: Record<number, NodeConnection[]>;
}

export interface BlueprintDAG {
  nodeMap: Record<number, IGraphNode>;
  roots: number[];
  graph: GraphStructure;
  order: number[];
}
