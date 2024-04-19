# Order-Independent Transparency

Zephyr3d supports two types of Order-Independent Transparency (OIT) techniques:
Weighted Blended OIT and Per-Pixel Linked List OIT.

## Weighted Blended OIT

Weighted Blended OIT is a weight-based transparency blending technique. It calculates
the color and opacity weights for each fragment in the fragment shader and then blends
these fragments with weighted blending in the final composition stage.

This technique is relatively simple to implement, performs well, and can handle complex
transparent scenes effectively. However, it may not completely solve all transparency
sorting issues and could result in visual artifacts in certain cases.

Weighted Blended OIT is supported on WebGL, WebGL2, and WebGPU devices.

The following code enables rendering of transparent objects using Weighted Blended OIT:

```javascript

// Specify Weighted Blended rendering of transparent objects for the camera
camera.oit = new WeightedBlendedOIT();

```

## Per-Pixel Linked List OIT

Per-Pixel Linked List OIT is a per-pixel linked list transparency rendering technique.
It constructs a linked list for each fragment in the fragment shader, storing color
and depth information for that fragment.

This technique excels in accurately handling the rendering order of transparent objects,
even in complex scenes. However, it requires more memory and computational resources.

Per-Pixel Linked List OIT is only available for WebGPU devices.

The following code enables rendering of transparent objects using Per-Pixel Linked List:

```javascript

// Specify Per-Pixel Linked List rendering of transparent objects for the camera
// The constructor parameter specifies the number of supported transparency levels, default is 16.
camera.oit = new ABufferOIT(20);

```

## Note

After use, the OIT object must be released to prevent resource leakage.

```javascript

// Release the OIT object
camera.oit.dispose();
camera.oit = null;

```

