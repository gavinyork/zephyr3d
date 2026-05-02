export const shapePrimitivePaths = {
  box: '/assets/@builtins/primitives/box.zmsh',
  sphere: '/assets/@builtins/primitives/sphere.zmsh',
  plane: '/assets/@builtins/primitives/plane.zmsh',
  cylinder: '/assets/@builtins/primitives/cylinder.zmsh',
  torus: '/assets/@builtins/primitives/torus.zmsh',
  tetrahedron: '/assets/@builtins/primitives/tetrahedron.zmsh'
} as const;

export type ShapePrimitiveType = keyof typeof shapePrimitivePaths;
