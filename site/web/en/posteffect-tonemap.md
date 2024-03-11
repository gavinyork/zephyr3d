# Tone mapping

Tone mapping is a process used to convert HDR images to LDR ones, and it's categorized under the Transparent group. Our tone mapping utilizes the ACES encoding system.

```javascript

// Create a Composto instance
const compositor = new Compositor();
// Create a post-processing instance of tone mapping
const tonemap = new Tonemap();
// Exposure, default is 1
tonemap.exposure = 1.5;
// Adds the effect to Compostor
compositor.appendPostEffect(tonemap)
// ...
// Render the scene
camera.render(scene, compositor);

```

<div class="showcase" case="tut-27" style="width:600px;height:800px;"></div>

