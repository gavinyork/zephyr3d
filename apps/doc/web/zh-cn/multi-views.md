# 多视口渲染

Zephyr3d支持在屏幕上渲染多个视口，可用于实现三视图或画中画等效果。

你可以通过设置[Camera.viewport](/doc/markdown/./scene.camera.viewport)属性。当调用Camera.render()
方法时，场景会被渲染到viewport属性所指示的区域内。

**注意，在zephyr3d中，viewport的原点位于左下角。**

以下代码利用相同的Camera渲染场景两次，实现类似画中画的效果。

<div class="showcase" case="tut-46"></div>