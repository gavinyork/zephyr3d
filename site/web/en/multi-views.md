# Multi-viewport Rendering

Zephyr3d supports rendering multiple viewports on the screen, which can be used to
achieve effects like triple views or picture-in-picture.

You can do this by setting the [Camera.viewport](/doc/markdown/./scene.camera.viewport)
property. When the Camera.render() method is called, the scene will be rendered within
the area indicated by the viewport property.

**Note that in Zephyr3d, the origin of the viewport is located at the bottom left corner.**

The following code demonstrates how to render the scene twice using the same Camera to
achieve a picture-in-picture effect.

<div class="showcase" case="tut-46"></div>