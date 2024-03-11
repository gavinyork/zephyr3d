# FXAA

Fast Approximate Anti-Aliasing (FXAA) is a screen-space anti-aliasing technique. It is in the Transparent group.

```javascript

// Create a Compostor instance
const compositor = new Compositor();
// Create a post-processing instance for SAO
const fxaa = new FXAA();
// Adds the effect to Compostor
compositor.appendPostEffect(fxaa);
// ...
// Render the scene
camera.render(scene, compositor);

```

<div class="showcase" case="tut-30" style="width:600px;height:800px;"></div>
