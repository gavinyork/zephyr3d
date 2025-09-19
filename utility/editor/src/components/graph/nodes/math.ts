import {
  CompAddNode,
  CompSubtractNode,
  CompMultiplyNode,
  CompDivNode,
  DotProduct2Node,
  DotProduct3Node,
  DotProduct4Node,
  CrossProduct2Node,
  CrossProduct3Node,
  Degrees2RadiansNode,
  Radians2DegreesNode,
  SinNode,
  CosNode,
  TanNode,
  ArcSinNode,
  ArcCosNode,
  ArcTanNode,
  SinHNode,
  CosHNode,
  TanHNode,
  ArcsineHNode,
  ArccosineHNode,
  ArctangentHNode,
  ExpNode,
  Exp2Node,
  LogNode,
  Log2Node,
  SqrtNode,
  InvSqrtNode,
  AbsNode,
  SignNode,
  FloorNode,
  CeilNode,
  FractNode,
  DDXNode,
  DDYNode,
  FWidthNode,
  ModNode,
  MinNode,
  MaxNode,
  StepNode
} from '@zephyr3d/scene';
import type { NodeCategory } from '../api';

export function getMathNodeCategories(): NodeCategory[] {
  return [
    {
      name: 'Math',
      children: [
        {
          name: 'CompAdd',
          create: () => new CompAddNode(),
          inTypes: ['float', 'vec2', 'vec3', 'vec4'],
          outTypes: ['float', 'vec2', 'vec3', 'vec4']
        },
        {
          name: 'CompSubtract',
          create: () => new CompSubtractNode(),
          inTypes: ['float', 'vec2', 'vec3', 'vec4'],
          outTypes: ['float', 'vec2', 'vec3', 'vec4']
        },
        {
          name: 'CompMultiply',
          create: () => new CompMultiplyNode(),
          inTypes: ['float', 'vec2', 'vec3', 'vec4'],
          outTypes: ['float', 'vec2', 'vec3', 'vec4']
        },
        {
          name: 'CompDiv',
          create: () => new CompDivNode(),
          inTypes: ['float', 'vec2', 'vec3', 'vec4'],
          outTypes: ['float', 'vec2', 'vec3', 'vec4']
        },
        {
          name: 'DotProductVec2',
          create: () => new DotProduct2Node(),
          inTypes: ['float', 'vec2', 'vec3', 'vec4'],
          outTypes: ['float']
        },
        {
          name: 'DotProductVec3',
          create: () => new DotProduct3Node(),
          inTypes: ['float', 'vec2', 'vec3', 'vec4'],
          outTypes: ['float']
        },
        {
          name: 'DotProductVec4',
          create: () => new DotProduct4Node(),
          inTypes: ['float', 'vec2', 'vec3', 'vec4'],
          outTypes: ['float']
        },
        {
          name: 'CrossProductVec2',
          create: () => new CrossProduct2Node(),
          inTypes: ['float', 'vec2', 'vec3', 'vec4'],
          outTypes: ['vec2']
        },
        {
          name: 'CrossProductVec3',
          create: () => new CrossProduct3Node(),
          inTypes: ['float', 'vec2', 'vec3', 'vec4'],
          outTypes: ['vec3']
        },
        {
          name: 'DegreesToRadians',
          create: () => new Degrees2RadiansNode(),
          inTypes: ['float', 'vec2', 'vec3', 'vec4'],
          outTypes: ['float', 'vec2', 'vec3', 'vec4']
        },
        {
          name: 'RadiansToDegrees',
          create: () => new Radians2DegreesNode(),
          inTypes: ['float', 'vec2', 'vec3', 'vec4'],
          outTypes: ['float', 'vec2', 'vec3', 'vec4']
        },
        {
          name: 'Sin',
          create: () => new SinNode(),
          inTypes: ['float', 'vec2', 'vec3', 'vec4'],
          outTypes: ['float', 'vec2', 'vec3', 'vec4']
        },
        {
          name: 'Cos',
          create: () => new CosNode(),
          inTypes: ['float', 'vec2', 'vec3', 'vec4'],
          outTypes: ['float', 'vec2', 'vec3', 'vec4']
        },
        {
          name: 'Tan',
          create: () => new TanNode(),
          inTypes: ['float', 'vec2', 'vec3', 'vec4'],
          outTypes: ['float', 'vec2', 'vec3', 'vec4']
        },
        {
          name: 'ArcSin',
          create: () => new ArcSinNode(),
          inTypes: ['float', 'vec2', 'vec3', 'vec4'],
          outTypes: ['float', 'vec2', 'vec3', 'vec4']
        },
        {
          name: 'ArcCos',
          create: () => new ArcCosNode(),
          inTypes: ['float', 'vec2', 'vec3', 'vec4'],
          outTypes: ['float', 'vec2', 'vec3', 'vec4']
        },
        {
          name: 'ArcTan',
          create: () => new ArcTanNode(),
          inTypes: ['float', 'vec2', 'vec3', 'vec4'],
          outTypes: ['float', 'vec2', 'vec3', 'vec4']
        },
        {
          name: 'Sinh',
          create: () => new SinHNode(),
          inTypes: ['float', 'vec2', 'vec3', 'vec4'],
          outTypes: ['float', 'vec2', 'vec3', 'vec4']
        },
        {
          name: 'Cosh',
          create: () => new CosHNode(),
          inTypes: ['float', 'vec2', 'vec3', 'vec4'],
          outTypes: ['float', 'vec2', 'vec3', 'vec4']
        },
        {
          name: 'Tanh',
          create: () => new TanHNode(),
          inTypes: ['float', 'vec2', 'vec3', 'vec4'],
          outTypes: ['float', 'vec2', 'vec3', 'vec4']
        },
        {
          name: 'ArcSinh',
          create: () => new ArcsineHNode(),
          inTypes: ['float', 'vec2', 'vec3', 'vec4'],
          outTypes: ['float', 'vec2', 'vec3', 'vec4']
        },
        {
          name: 'ArcCosh',
          create: () => new ArccosineHNode(),
          inTypes: ['float', 'vec2', 'vec3', 'vec4'],
          outTypes: ['float', 'vec2', 'vec3', 'vec4']
        },
        {
          name: 'ArcTanh',
          create: () => new ArctangentHNode(),
          inTypes: ['float', 'vec2', 'vec3', 'vec4'],
          outTypes: ['float', 'vec2', 'vec3', 'vec4']
        },
        {
          name: 'Exp',
          create: () => new ExpNode(),
          inTypes: ['float', 'vec2', 'vec3', 'vec4'],
          outTypes: ['float', 'vec2', 'vec3', 'vec4']
        },
        {
          name: 'Exp2',
          create: () => new Exp2Node(),
          inTypes: ['float', 'vec2', 'vec3', 'vec4'],
          outTypes: ['float', 'vec2', 'vec3', 'vec4']
        },
        {
          name: 'Log',
          create: () => new LogNode(),
          inTypes: ['float', 'vec2', 'vec3', 'vec4'],
          outTypes: ['float', 'vec2', 'vec3', 'vec4']
        },
        {
          name: 'Log2',
          create: () => new Log2Node(),
          inTypes: ['float', 'vec2', 'vec3', 'vec4'],
          outTypes: ['float', 'vec2', 'vec3', 'vec4']
        },
        {
          name: 'Sqrt',
          create: () => new SqrtNode(),
          inTypes: ['float', 'vec2', 'vec3', 'vec4'],
          outTypes: ['float', 'vec2', 'vec3', 'vec4']
        },
        {
          name: 'InvSqrt',
          create: () => new InvSqrtNode(),
          inTypes: ['float', 'vec2', 'vec3', 'vec4'],
          outTypes: ['float', 'vec2', 'vec3', 'vec4']
        },
        {
          name: 'Abs',
          create: () => new AbsNode(),
          inTypes: ['float', 'vec2', 'vec3', 'vec4'],
          outTypes: ['float', 'vec2', 'vec3', 'vec4']
        },
        {
          name: 'Sign',
          create: () => new SignNode(),
          inTypes: ['float', 'vec2', 'vec3', 'vec4'],
          outTypes: ['float', 'vec2', 'vec3', 'vec4']
        },
        {
          name: 'Floor',
          create: () => new FloorNode(),
          inTypes: ['float', 'vec2', 'vec3', 'vec4'],
          outTypes: ['float', 'vec2', 'vec3', 'vec4']
        },
        {
          name: 'Ceil',
          create: () => new CeilNode(),
          inTypes: ['float', 'vec2', 'vec3', 'vec4'],
          outTypes: ['float', 'vec2', 'vec3', 'vec4']
        },
        {
          name: 'Fract',
          create: () => new FractNode(),
          inTypes: ['float', 'vec2', 'vec3', 'vec4'],
          outTypes: ['float', 'vec2', 'vec3', 'vec4']
        },
        {
          name: 'DDX',
          create: () => new DDXNode(),
          inTypes: ['float', 'vec2', 'vec3', 'vec4'],
          outTypes: ['float', 'vec2', 'vec3', 'vec4']
        },
        {
          name: 'DDY',
          create: () => new DDYNode(),
          inTypes: ['float', 'vec2', 'vec3', 'vec4'],
          outTypes: ['float', 'vec2', 'vec3', 'vec4']
        },
        {
          name: 'FWidth',
          create: () => new FWidthNode(),
          inTypes: ['float', 'vec2', 'vec3', 'vec4'],
          outTypes: ['float', 'vec2', 'vec3', 'vec4']
        },
        {
          name: 'Mod',
          create: () => new ModNode(),
          inTypes: ['float', 'vec2', 'vec3', 'vec4'],
          outTypes: ['float', 'vec2', 'vec3', 'vec4']
        },
        {
          name: 'Min',
          create: () => new MinNode(),
          inTypes: ['float', 'vec2', 'vec3', 'vec4'],
          outTypes: ['float', 'vec2', 'vec3', 'vec4']
        },
        {
          name: 'Max',
          create: () => new MaxNode(),
          inTypes: ['float', 'vec2', 'vec3', 'vec4'],
          outTypes: ['float', 'vec2', 'vec3', 'vec4']
        },
        {
          name: 'Step',
          create: () => new StepNode(),
          inTypes: ['float', 'vec2', 'vec3', 'vec4'],
          outTypes: ['float', 'vec2', 'vec3', 'vec4']
        }
      ]
    }
  ];
}
