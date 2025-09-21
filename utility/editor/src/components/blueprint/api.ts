import type { IGraphNode } from '@zephyr3d/scene';

export type NodeCategory = {
  name: string;
  create?: () => IGraphNode;
  children?: NodeCategory[];
};

export interface GraphEditorApi {
  getNodeCategory(): NodeCategory[];
}
