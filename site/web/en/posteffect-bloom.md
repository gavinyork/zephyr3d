# Bloom

The bloom effect is designed to create a soft, glowing effect from the bright areas in rendered images and is also placed in the Transparent group.

Applying the bloom effect to HDR images can result in noticeable highlight flickering. It is recommended to apply it after tone mapping.

```javascript

// Create a Compostor instance
const compositor = new Compositor();
// Create a post-processing instance for Bloom
const bloom = new Bloom();
// The brightness threshold, the part below this value will not produce glow, default value is 0.8
bloom.threshold = 0.85;
// Intensity, the higher the value, the stronger the glow effect, the default value is 1
bloom.intensity = 2;
// Minimum texture size of the downsample, default value is 32
bloom.downsampleLimit = 64;
// Adds the effect to Compostor
compositor.appendPostEffect(bloom);
// ...
// Render the scene
camera.render(scene, compositor);

```

<div class="showcase" case="tut-28" style="width:600px;height:800px;"></div>

