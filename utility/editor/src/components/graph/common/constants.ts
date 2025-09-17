import { BaseGraphNode } from '../node';
import type { ImGui } from '@zephyr3d/imgui';
import type { NodeEditor } from '../nodeeditor';
import type { NodeCategory } from '../api';

export class ConstantNode extends BaseGraphNode {
  constructor(editor: NodeEditor, position: ImGui.ImVec2, color: ImGui.ImVec4, type: 'int' | 'float') {
    super(editor, `Constant ${type}`, position, [], [{ id: 1, name: 'value', type }], color);
  }
}

export class ConstantVec2Node extends BaseGraphNode {
  constructor(editor: NodeEditor, position: ImGui.ImVec2, color: ImGui.ImVec4, type: 'int' | 'float') {
    super(
      editor,
      `Constant ${type}2`,
      position,
      [],
      [
        { id: 1, name: 'value', type: type === 'int' ? 'int2' : 'vec2' },
        { id: 2, name: 'x', type },
        { id: 3, name: 'y', type }
      ],
      color
    );
  }
}

export class ConstantVec3Node extends BaseGraphNode {
  constructor(editor: NodeEditor, position: ImGui.ImVec2, color: ImGui.ImVec4, type: 'int' | 'float') {
    super(
      editor,
      `Constant ${type}3`,
      position,
      [],
      [
        { id: 1, name: 'value', type: type === 'int' ? 'int3' : 'vec3' },
        { id: 2, name: 'x', type },
        { id: 3, name: 'y', type },
        { id: 4, name: 'z', type }
      ],
      color
    );
  }
}

export class ConstantVec4Node extends BaseGraphNode {
  constructor(editor: NodeEditor, position: ImGui.ImVec2, color: ImGui.ImVec4, type: 'int' | 'float') {
    super(
      editor,
      `Constant ${type}4`,
      position,
      [],
      [
        { id: 1, name: 'value', type: type === 'int' ? 'int4' : 'vec4' },
        { id: 2, name: 'x', type },
        { id: 3, name: 'y', type },
        { id: 4, name: 'z', type },
        { id: 5, name: 'w', type }
      ],
      color
    );
  }
}

export function getConstantNodeCategories(): NodeCategory[] {
  return [
    {
      name: 'Constants',
      children: [
        {
          name: 'Integer',
          create: (editor, position, color) => new ConstantNode(editor, position, color, 'int')
        },
        {
          name: 'Float',
          create: (editor, position, color) => new ConstantNode(editor, position, color, 'float')
        },
        {
          name: 'Integer2',
          create: (editor, position, color) => new ConstantVec2Node(editor, position, color, 'int')
        },
        {
          name: 'Float2',
          create: (editor, position, color) => new ConstantVec2Node(editor, position, color, 'float')
        },
        {
          name: 'Integer3',
          create: (editor, position, color) => new ConstantVec3Node(editor, position, color, 'int')
        },
        {
          name: 'Float3',
          create: (editor, position, color) => new ConstantVec3Node(editor, position, color, 'float')
        },
        {
          name: 'Integer4',
          create: (editor, position, color) => new ConstantVec4Node(editor, position, color, 'int')
        },
        {
          name: 'Float4',
          create: (editor, position, color) => new ConstantVec4Node(editor, position, color, 'float')
        }
      ]
    }
  ];
}
