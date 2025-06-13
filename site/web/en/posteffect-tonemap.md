# Tone mapping

Tone mapping is a process used to convert HDR images to LDR ones, and it's categorized under the Transparent group. Our tone mapping utilizes the ACES encoding system.

```javascript

// Enable tonemap
camera.toneMap = true;
// ...
// Render the scene
camera.render(scene, compositor);

```

<div class="showcase" case="tut-27" style="width:600px;height:800px;"></div>

