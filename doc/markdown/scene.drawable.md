<!-- Do not edit this file. It is automatically generated by API Documenter. -->

[Home](doc/markdown/./index.md) &gt; [@zephyr3d/scene](doc/markdown/./scene.md) &gt; [Drawable](doc/markdown/./scene.drawable.md)

## Drawable interface

Base interface for a drawble object

**Signature:**

```typescript
interface Drawable 
```

## Methods

|  Method | Description |
|  --- | --- |
|  [draw(ctx)](doc/markdown/./scene.drawable.draw.md) | Draw the object |
|  [getBoneMatrices()](doc/markdown/./scene.drawable.getbonematrices.md) | Gets the texture that contains the bone matrices of the object |
|  [getInstanceColor()](doc/markdown/./scene.drawable.getinstancecolor.md) | Gets the instance color |
|  [getInvBindMatrix()](doc/markdown/./scene.drawable.getinvbindmatrix.md) | Gets the inversed bind matrix for skeleton animation |
|  [getName()](doc/markdown/./scene.drawable.getname.md) | Gets name of the drawable object |
|  [getPickTarget()](doc/markdown/./scene.drawable.getpicktarget.md) | If set, the pick target will be returned as the pick result |
|  [getSortDistance(camera)](doc/markdown/./scene.drawable.getsortdistance.md) | Gets the distance for object sorting |
|  [getXForm()](doc/markdown/./scene.drawable.getxform.md) | Gets the XForm of the object |
|  [isBatchable()](doc/markdown/./scene.drawable.isbatchable.md) | returns true if the object is batchable |
|  [isTransparency()](doc/markdown/./scene.drawable.istransparency.md) | true if the object is transparency, false otherwise |
|  [isUnlit()](doc/markdown/./scene.drawable.isunlit.md) | true if the shading of this object is independent of lighting |
