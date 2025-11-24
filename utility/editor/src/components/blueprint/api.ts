import type { IGraphNode } from '@zephyr3d/scene';
import type { NodeEditor } from './nodeeditor';

export type NodeCategory = {
  name: string;
  create?: () => IGraphNode;
  children?: NodeCategory[];
};

export interface GraphEditorApi {
  getNodeCategory(editor: NodeEditor): NodeCategory[];
}
