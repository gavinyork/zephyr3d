<!-- Do not edit this file. It is automatically generated by API Documenter. -->

[Home](doc/markdown/./index.md) &gt; [@zephyr3d/scene](doc/markdown/./scene.md) &gt; [RenderPass](doc/markdown/./scene.renderpass.md) &gt; [cullScene](doc/markdown/./scene.renderpass.cullscene.md)

## RenderPass.cullScene() method

Culls a scene by a given camera

**Signature:**

```typescript
cullScene(ctx: DrawContext, cullCamera: Camera): RenderQueue;
```

## Parameters

|  Parameter | Type | Description |
|  --- | --- | --- |
|  ctx | [DrawContext](doc/markdown/./scene.drawcontext.md) | The draw context |
|  cullCamera | [Camera](doc/markdown/./scene.camera.md) | The camera that will be used to cull the scene |

**Returns:**

[RenderQueue](doc/markdown/./scene.renderqueue.md)

The cull result
