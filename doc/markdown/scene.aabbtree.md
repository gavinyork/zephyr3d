<!-- Do not edit this file. It is automatically generated by API Documenter. -->

[Home](doc/markdown/./index.md) &gt; [@zephyr3d/scene](doc/markdown/./scene.md) &gt; [AABBTree](doc/markdown/./scene.aabbtree.md)

## AABBTree class

Axis-Aligned Bounding Box Tree

**Signature:**

```typescript
declare class AABBTree 
```

## Constructors

|  Constructor | Modifiers | Description |
|  --- | --- | --- |
|  [(constructor)()](doc/markdown/./scene.aabbtree._constructor_.md) |  | Creates an empty AABB tree |
|  [(constructor)(rhs)](doc/markdown/./scene.aabbtree._constructor__1.md) |  | Creates an AABB tree by copying from another AABB tree |

## Methods

|  Method | Modifiers | Description |
|  --- | --- | --- |
|  [buildFromPrimitives(vertices, indices, primitiveType)](doc/markdown/./scene.aabbtree.buildfromprimitives.md) |  | Build the AABB tree from a polygon soup |
|  [getTopLevelAABB()](doc/markdown/./scene.aabbtree.gettoplevelaabb.md) |  | Gets the top level bounding box of the tree |
|  [rayIntersectionDistance(ray)](doc/markdown/./scene.aabbtree.rayintersectiondistance.md) |  | Checks for intersection between a ray and the AABB tree |
|  [rayIntersectionTest(ray)](doc/markdown/./scene.aabbtree.rayintersectiontest.md) |  | Checks for intersection between a ray and the AABB tree without calculating the intersection point |
|  [transform(matrix)](doc/markdown/./scene.aabbtree.transform.md) |  | Transform the tree by a matrix |
