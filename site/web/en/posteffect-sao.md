# SAO

SAO is a screen-space AO algorithm designed to approximate shadows from indirect light, enhancing the realism of rendered scenes. It is part of the Opacity group.

```javascript

// Create a Compostor instance
const compositor = new Compositor();
// Create a post-processing instance for SAO
const ssao = new SAO();
// Depth detection range, default value is 100
ssao.radius = 80;
// Intensity, the higher the value, the stronger the shadow, the default value is 0.05
ssao.intensity = 0.04;
// Blur radius, default is 8
ssao.blurKernelRadius = 10;
// Adds the effect to Compostor
compositor.appendPostEffect(ssao);
// ...
// Render the scene
camera.render(scene, compositor);

```

<div class="showcase" case="tut-29" style="width:600px;height:800px;"></div>

