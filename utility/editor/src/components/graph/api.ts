import type { IGraphNode } from '@zephyr3d/scene';

export type NodeCategory = {
  name: string;
  create?: () => IGraphNode;
  inTypes?: string[];
  outTypes?: string[];
  children?: NodeCategory[];
};

export interface GraphEditorApi {
  getNodeCategory(): NodeCategory[];
  isCompatiblePin(inType: string, outType: string): boolean;
}
