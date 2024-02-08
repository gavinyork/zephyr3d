<!-- Do not edit this file. It is automatically generated by API Documenter. -->

[Home](doc/markdown/./index.md) &gt; [@zephyr3d/scene](doc/markdown/./scene.md) &gt; [BoundingBox](doc/markdown/./scene.boundingbox.md)

## BoundingBox class

The bounding box class

**Signature:**

```typescript
declare class BoundingBox extends AABB implements BoundingVolume 
```
**Extends:** [AABB](doc/markdown/./base.aabb.md)

**Implements:** [BoundingVolume](doc/markdown/./scene.boundingvolume.md)

## Constructors

|  Constructor | Modifiers | Description |
|  --- | --- | --- |
|  [(constructor)()](doc/markdown/./scene.boundingbox._constructor_.md) |  | Creates an empty bounding box |
|  [(constructor)(box)](doc/markdown/./scene.boundingbox._constructor__1.md) |  | Creates a bounding box from an AABB |
|  [(constructor)(minPoint, maxPoint)](doc/markdown/./scene.boundingbox._constructor__2.md) |  | Creates a bounding box from the min point and the max point |

## Methods

|  Method | Modifiers | Description |
|  --- | --- | --- |
|  [clone()](doc/markdown/./scene.boundingbox.clone.md) |  | Creates a new bounding volume by copying from this bounding volume |
|  [outsideFrustum(frustum)](doc/markdown/./scene.boundingbox.outsidefrustum.md) |  | Check if this bounding volume is outside a frustum |
|  [toAABB()](doc/markdown/./scene.boundingbox.toaabb.md) |  | Gets the minimum AABB that contains the bounding volume |
|  [transform(matrix)](doc/markdown/./scene.boundingbox.transform.md) |  | Creates a new bounding volume by tranforming this bounding volume by a matrix |
