# Post Processing

Post-processing allows you to add 2D effects to images after the scene has been rendered.

We manage post-processing effects using the [Compositor](/doc/markdown/./scene.compositor) object. The Compositor can add multiple post-processing effects, each taking the rendering result of the previous one as input, forming a chain of calls. During rendering, simply use the Compositor object as the second argument in the Camera.render() function.

Our post-processing effects are divided into two groups: Opaque and Transparent. The Opaque group is called after rendering opaque objects but before rendering transparent objects. The Transparent group is called after both transparent and opaque objects have been rendered. Each post-processing effect is defaulted to either the Opaque or Transparent group based on its application. Within each group, the order of effect calls follows the order in which they were added.

## Tone mapping

Tone mapping is a process used to convert HDR (High Dynamic Range) images to LDR (Low Dynamic Range) ones, and it's categorized under the Transparent group. Our tone mapping utilizes the ACES encoding system.

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

## Bloom

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

## SAO

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

## FXAA

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
