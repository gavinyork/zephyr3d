import { BaseGraphNode } from './node';
import type { ImGui } from '@zephyr3d/imgui';
import type { NodeEditor } from './nodeeditor';

export type NodeCategory = {
  name: string;
  create?: (editor: NodeEditor, position: ImGui.ImVec2, color: ImGui.ImVec4) => BaseGraphNode;
  inTypes?: string[];
  outTypes?: string[];
  children?: NodeCategory[];
};

export interface GraphEditorApi {
  getNodeCategory(): NodeCategory[];
  isCompatiblePin(inType: string, outType: string): boolean;
}
