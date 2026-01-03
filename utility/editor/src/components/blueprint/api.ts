import type { IGraphNode } from '@zephyr3d/scene';
import type { NodeEditor } from './nodeeditor';
import type { Nullable } from '@zephyr3d/base';

export type NodeCategory = {
  name: string;
  create?: Nullable<() => IGraphNode>;
  children?: NodeCategory[];
};

export interface GraphEditorApi {
  getNodeCategory(editor: NodeEditor): NodeCategory[];
}
