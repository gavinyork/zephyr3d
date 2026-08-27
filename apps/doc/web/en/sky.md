# Sky

We support two sky modes: Skybox and Atmospheric Scattering

## Sky box

A Skybox is a straightforward method for rendering skies, utilizing a single cube map that contains a sky background. It is capable of depicting any sky backdrop, though it is limited to static skies. Skybox textures can be directly loaded as cube maps or generated from panoramic images.

To implement skybox rendering in a scene, simply select the skybox as the sky rendering method and assign the skybox texture.

<<< @/../src/tut-32/main.js{27-37 js}

The skybox texture is a cube map (`TextureCube`). The example above loads a `.dds` cube map directly.

<div class="showcase" case="tut-32"></div>

<br>

If you only have a panoramic image (equirectangular, as most HDRI assets are), the built-in
`panoramaToCubemap()` converts it into a cube map at runtime:

<<< @/../src/tut-33/main.js{28-44 js}

The key step is creating an empty cube map with `device.createCubeTexture()` as the target
(line 35), then rendering the panorama into it. The `rgba16f` format matters here: HDR panoramas
carry luminance beyond [0,1], and an 8-bit format would clip the highlights.

<div class="showcase" case="tut-33"></div>

## Atmospheric scattering

Atmospheric scattering is a method that utilizes the physical model of the atmosphere's scattering of sunlight to calculate and render the sky in real-time. Its advantage lies in its ability to dynamically render the sky at different times of the day, allowing for the transition between day and night. However, it has the drawback of requiring significant computational resources and offering somewhat limited expressive capabilities.

To render the sky using atmospheric scattering, one simply needs to set the sky rendering mode to atmospheric scattering. The sky's appearance will then be calculated in real-time based on the direction of the sunlight.

```javascript
scene.env.sky.skyType = 'scatter';
```

**In any given scene, each directional light can be set to mimic sunlight. However, only one directional light can have this sunlight attribute at a time. When a new directional light is designated as the sun, the previous one loses its sunlight status. By default, the first directional light created in a scene is assigned as the sunlight. If there are no directional lights with the sunlight attribute in the scene, the atmospheric scattering sky will default to a predetermined sunlight direction.**

```javascript
// Set as sunlight
directionalLight.sunLight = true;

// Clear the sunlight attribute
directionalLight.sunLight = false;
```

The sky, as calculated by atmospheric scattering, is often in high dynamic range and requires
post-processing with [Tone mapping](en/posteffect-tonemap.md) to achieve the desired effect.

Here is a complete atmospheric scattering setup:

<<< @/../src/tut-34/main.js{27-37 js}

Note that the directional light on line 28 never sets `sunLight = true` explicitly — **the first
directional light created in a scene automatically becomes the sun**, so orienting it with
`lookAt()` is enough to drive the sky.

<div class="showcase" case="tut-34"></div>

The clouds in the sky are generated from a 2D noise function, with three parameters to tune:

```javascript
// Cloud cover; only effective in atmospheric scattering mode
scene.env.sky.cloudy = 0.5;

// Cloud brightness
scene.env.sky.cloudIntensity = 1.5;

// Wind, which drives cloud movement speed and direction
scene.env.sky.wind = new Vector2(300, 500);
// Or mutate in place to avoid an extra allocation
scene.env.sky.wind.setXY(600, 0);
```
