<!-- Do not edit this file. It is automatically generated by API Documenter. -->

[Home](doc/markdown/./index.md) &gt; [@zephyr3d/scene](doc/markdown/./scene.md) &gt; [SceneNode](doc/markdown/./scene.scenenode.md)

## SceneNode class

The base class for any kind of scene objects

**Signature:**

```typescript
declare class SceneNode extends XForm<SceneNode> 
```
**Extends:** [XForm](doc/markdown/./scene.xform.md)<!-- -->&lt;[SceneNode](doc/markdown/./scene.scenenode.md)<!-- -->&gt;

## Remarks

We use a data structure called SceneGraph to store scenes, which consists of a couple of scene objects forming a hierarchical structure. This is the base class for any kind of the scene object, which contains the basic properties such as position, rotation, and scale of the object.

## Constructors

|  Constructor | Modifiers | Description |
|  --- | --- | --- |
|  [(constructor)(scene)](doc/markdown/./scene.scenenode._constructor_.md) |  | Creates a new scene node |

## Properties

|  Property | Modifiers | Type | Description |
|  --- | --- | --- | --- |
|  [attached](doc/markdown/./scene.scenenode.attached.md) | <code>readonly</code> | boolean | true if the node is attached to the scene node, false otherwise |
|  [BBOXDRAW\_DISABLED](doc/markdown/./scene.scenenode.bboxdraw_disabled.md) | <p><code>static</code></p><p><code>readonly</code></p> | (not declared) |  |
|  [BBOXDRAW\_INHERITED](doc/markdown/./scene.scenenode.bboxdraw_inherited.md) | <p><code>static</code></p><p><code>readonly</code></p> | (not declared) |  |
|  [BBOXDRAW\_LOCAL](doc/markdown/./scene.scenenode.bboxdraw_local.md) | <p><code>static</code></p><p><code>readonly</code></p> | (not declared) |  |
|  [BBOXDRAW\_WORLD](doc/markdown/./scene.scenenode.bboxdraw_world.md) | <p><code>static</code></p><p><code>readonly</code></p> | (not declared) |  |
|  [boundingBoxDrawMode](doc/markdown/./scene.scenenode.boundingboxdrawmode.md) |  | number | Bounding box draw mode |
|  [CLIP\_DISABLED](doc/markdown/./scene.scenenode.clip_disabled.md) | <p><code>static</code></p><p><code>readonly</code></p> | (not declared) |  |
|  [CLIP\_ENABLED](doc/markdown/./scene.scenenode.clip_enabled.md) | <p><code>static</code></p><p><code>readonly</code></p> | (not declared) |  |
|  [CLIP\_INHERITED](doc/markdown/./scene.scenenode.clip_inherited.md) | <p><code>static</code></p><p><code>readonly</code></p> | (not declared) |  |
|  [clipMode](doc/markdown/./scene.scenenode.clipmode.md) |  | number | Clip mode |
|  [computedBoundingBoxDrawMode](doc/markdown/./scene.scenenode.computedboundingboxdrawmode.md) | <code>readonly</code> | number | Computed value for bounding box draw mode |
|  [computedClipMode](doc/markdown/./scene.scenenode.computedclipmode.md) | <code>readonly</code> | number | Computed value of clip mode |
|  [hidden](doc/markdown/./scene.scenenode.hidden.md) | <code>readonly</code> | boolean | Computed value of show state |
|  [name](doc/markdown/./scene.scenenode.name.md) |  | string | Name of the scene node |
|  [PICK\_DISABLED](doc/markdown/./scene.scenenode.pick_disabled.md) | <p><code>static</code></p><p><code>readonly</code></p> | (not declared) |  |
|  [PICK\_ENABLED](doc/markdown/./scene.scenenode.pick_enabled.md) | <p><code>static</code></p><p><code>readonly</code></p> | (not declared) |  |
|  [PICK\_INHERITED](doc/markdown/./scene.scenenode.pick_inherited.md) | <p><code>static</code></p><p><code>readonly</code></p> | (not declared) |  |
|  [pickable](doc/markdown/./scene.scenenode.pickable.md) | <code>readonly</code> | boolean | Computed value of pick mode |
|  [pickMode](doc/markdown/./scene.scenenode.pickmode.md) |  | number | Pick mode |
|  [scene](doc/markdown/./scene.scenenode.scene.md) | <code>readonly</code> | [Scene](doc/markdown/./scene.scene.md) | The scene to which the node belongs |
|  [SHOW\_DEFAULT](doc/markdown/./scene.scenenode.show_default.md) | <p><code>static</code></p><p><code>readonly</code></p> | (not declared) |  |
|  [SHOW\_HIDE](doc/markdown/./scene.scenenode.show_hide.md) | <p><code>static</code></p><p><code>readonly</code></p> | (not declared) |  |
|  [SHOW\_INHERITED](doc/markdown/./scene.scenenode.show_inherited.md) | <p><code>static</code></p><p><code>readonly</code></p> | (not declared) |  |
|  [showState](doc/markdown/./scene.scenenode.showstate.md) |  | number | Show state |

## Methods

|  Method | Modifiers | Description |
|  --- | --- | --- |
|  [computeBoundingVolume(bv)](doc/markdown/./scene.scenenode.computeboundingvolume.md) |  | Computes the bounding volume of the node |
|  [dispose()](doc/markdown/./scene.scenenode.dispose.md) |  | Disposes the node |
|  [getBoundingVolume()](doc/markdown/./scene.scenenode.getboundingvolume.md) |  | Gets the bounding volume of the node |
|  [getWorldBoundingVolume()](doc/markdown/./scene.scenenode.getworldboundingvolume.md) |  | Gets the world space bounding volume of the node |
|  [hasChild(child)](doc/markdown/./scene.scenenode.haschild.md) |  | Check if given node is a direct child of the node |
|  [invalidateBoundingVolume()](doc/markdown/./scene.scenenode.invalidateboundingvolume.md) |  | Force the bounding volume to be recalculated |
|  [invalidateWorldBoundingVolume()](doc/markdown/./scene.scenenode.invalidateworldboundingvolume.md) |  | Force the world space bounding volume to be recalculated |
|  [isCamera()](doc/markdown/./scene.scenenode.iscamera.md) |  | true if this is a camera node, false otherwise |
|  [isGraphNode()](doc/markdown/./scene.scenenode.isgraphnode.md) |  | true if this is a graph node, false otherwise |
|  [isLight()](doc/markdown/./scene.scenenode.islight.md) |  | true if this is a light node, false otherwise |
|  [isMesh()](doc/markdown/./scene.scenenode.ismesh.md) |  | true if this is a mesh node, false otherwise |
|  [isParentOf(child)](doc/markdown/./scene.scenenode.isparentof.md) |  | Checks if this node is the direct parent or indirect parent of a given node |
|  [isPunctualLight()](doc/markdown/./scene.scenenode.ispunctuallight.md) |  | true if this is a punctual light node, false otherwise |
|  [isTerrain()](doc/markdown/./scene.scenenode.isterrain.md) |  | true if this is a terrain node, false otherwise |
|  [iterate(callback)](doc/markdown/./scene.scenenode.iterate.md) |  | Iterate self and all of the children |
|  [remove()](doc/markdown/./scene.scenenode.remove.md) |  | Removes this node from it's parent |
|  [removeChildren()](doc/markdown/./scene.scenenode.removechildren.md) |  | Removes all children from this node |
|  [setBoundingVolume(bv)](doc/markdown/./scene.scenenode.setboundingvolume.md) |  | Sets the bounding volume of the node |
|  [traverse(v, inverse)](doc/markdown/./scene.scenenode.traverse.md) |  | Traverse the entire subtree of this node by a visitor |
