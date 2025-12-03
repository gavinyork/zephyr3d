import {
  CompAddNode,
  CompSubNode,
  CompMulNode,
  CompDivNode,
  DotProductNode,
  CrossProductNode,
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
  StepNode,
  MakeVectorNode,
  MixNode,
  NormalizeNode,
  FaceForwardNode,
  ReflectNode,
  RefractNode,
  LengthNode,
  DistanceNode,
  PowNode,
  FmaNode,
  ClampNode,
  SaturateNode,
  TransformNode,
  SimplexNoise2DNode,
  PerlinNoise2DNode,
  Hash1Node,
  Hash2Node,
  Hash3Node,
  SwizzleNode,
  CompComparisonNode,
  AnyConditionNode,
  AllConditionNode,
  SelectionNode,
  EqualNode,
  NotEqualNode,
  LogicallyAndNode,
  LogicallyOrNode
} from '@zephyr3d/scene';
import type { NodeCategory } from '../api';

export function getMathNodeCategories(): NodeCategory[] {
  return [
    {
      name: 'Math',
      children: [
        {
          name: 'MakeVector',
          create: () => new MakeVectorNode()
        },
        {
          name: 'Swizzle',
          create: () => new SwizzleNode()
        },
        {
          name: 'LogicallyAnd',
          create: () => new LogicallyAndNode()
        },
        {
          name: 'LogicallyOr',
          create: () => new LogicallyOrNode()
        },
        {
          name: 'Equal',
          create: () => new EqualNode()
        },
        {
          name: 'NotEqual',
          create: () => new NotEqualNode()
        },
        {
          name: 'Comparison',
          create: () => new CompComparisonNode()
        },
        {
          name: 'Any',
          create: () => new AnyConditionNode()
        },
        {
          name: 'All',
          create: () => new AllConditionNode()
        },
        {
          name: 'Select',
          create: () => new SelectionNode()
        },
        {
          name: 'Transform',
          create: () => new TransformNode()
        },
        {
          name: 'CompAdd',
          create: () => new CompAddNode()
        },
        {
          name: 'CompSubtract',
          create: () => new CompSubNode()
        },
        {
          name: 'CompMultiply',
          create: () => new CompMulNode()
        },
        {
          name: 'CompDiv',
          create: () => new CompDivNode()
        },
        {
          name: 'DotProduct',
          create: () => new DotProductNode()
        },
        {
          name: 'CrossProduct',
          create: () => new CrossProductNode()
        },
        {
          name: 'DegreesToRadians',
          create: () => new Degrees2RadiansNode()
        },
        {
          name: 'RadiansToDegrees',
          create: () => new Radians2DegreesNode()
        },
        {
          name: 'Sin',
          create: () => new SinNode()
        },
        {
          name: 'Cos',
          create: () => new CosNode()
        },
        {
          name: 'Tan',
          create: () => new TanNode()
        },
        {
          name: 'ArcSin',
          create: () => new ArcSinNode()
        },
        {
          name: 'ArcCos',
          create: () => new ArcCosNode()
        },
        {
          name: 'ArcTan',
          create: () => new ArcTanNode()
        },
        {
          name: 'Sinh',
          create: () => new SinHNode()
        },
        {
          name: 'Cosh',
          create: () => new CosHNode()
        },
        {
          name: 'Tanh',
          create: () => new TanHNode()
        },
        {
          name: 'ArcSinh',
          create: () => new ArcsineHNode()
        },
        {
          name: 'ArcCosh',
          create: () => new ArccosineHNode()
        },
        {
          name: 'ArcTanh',
          create: () => new ArctangentHNode()
        },
        {
          name: 'Exp',
          create: () => new ExpNode()
        },
        {
          name: 'Exp2',
          create: () => new Exp2Node()
        },
        {
          name: 'Log',
          create: () => new LogNode()
        },
        {
          name: 'Log2',
          create: () => new Log2Node()
        },
        {
          name: 'Sqrt',
          create: () => new SqrtNode()
        },
        {
          name: 'InvSqrt',
          create: () => new InvSqrtNode()
        },
        {
          name: 'Abs',
          create: () => new AbsNode()
        },
        {
          name: 'Sign',
          create: () => new SignNode()
        },
        {
          name: 'Floor',
          create: () => new FloorNode()
        },
        {
          name: 'Ceil',
          create: () => new CeilNode()
        },
        {
          name: 'Fract',
          create: () => new FractNode()
        },
        {
          name: 'DDX',
          create: () => new DDXNode()
        },
        {
          name: 'DDY',
          create: () => new DDYNode()
        },
        {
          name: 'FWidth',
          create: () => new FWidthNode()
        },
        {
          name: 'Mod',
          create: () => new ModNode()
        },
        {
          name: 'Min',
          create: () => new MinNode()
        },
        {
          name: 'Max',
          create: () => new MaxNode()
        },
        {
          name: 'Mix',
          create: () => new MixNode()
        },
        {
          name: 'NormalizeVector',
          create: () => new NormalizeNode()
        },
        {
          name: 'FaceForward',
          create: () => new FaceForwardNode()
        },
        {
          name: 'Reflect',
          create: () => new ReflectNode()
        },
        {
          name: 'Refract',
          create: () => new RefractNode()
        },
        {
          name: 'VectorLength',
          create: () => new LengthNode()
        },
        {
          name: 'Distance',
          create: () => new DistanceNode()
        },
        {
          name: 'Power',
          create: () => new PowNode()
        },
        {
          name: 'MultiplyAdd',
          create: () => new FmaNode()
        },
        {
          name: 'Clamp',
          create: () => new ClampNode()
        },
        {
          name: 'Saturate',
          create: () => new SaturateNode()
        },
        {
          name: 'Step',
          create: () => new StepNode()
        },
        {
          name: 'Hash1',
          create: () => new Hash1Node()
        },
        {
          name: 'Hash2',
          create: () => new Hash2Node()
        },
        {
          name: 'Hash3',
          create: () => new Hash3Node()
        },
        {
          name: 'SimplexNoise2D',
          create: () => new SimplexNoise2DNode()
        },
        {
          name: 'PerlinNoise2D',
          create: () => new PerlinNoise2DNode()
        }
      ]
    }
  ];
}
