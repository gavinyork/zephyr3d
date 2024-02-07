# Sky

We support two sky modes: Skybox and Atmospheric Scattering

## Sky box

A Skybox is a straightforward method for rendering skies, utilizing a single cube map that contains a sky background. It is capable of depicting any sky backdrop, though it is limited to static skies. Skybox textures can be directly loaded as cube maps or generated from panoramic images.

To implement skybox rendering in a scene, simply select the skybox as the sky rendering method and assign the skybox texture.

```javascript

// Set the sky rendering mode to Skybox
scene.env.sky.skyType = 'skybox';
// Set the skybox texture
scene.env.sky.skyboxTexture = skyboxTexture;

```

<div class="showcase" case="tut-32"></div>

<br>

The example below demonstrates how to generate a skybox in real time using a panoramic image.

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

```

The sky, as calculated by atmospheric scattering, is often in high dynamic range and requires post-processing with Tone mapping to achieve the desired effect.

<div class="showcase" case="tut-34"></div>

In the sky, we have created clouds using a 2D noise function, and the coverage of these clouds can be adjusted through code.

```javascript

// Sets the cloud cover, which is only valid when using the Atmospheric Scatter Render mode
scene.env.sky.cloudy = 0.5;

// Sets the cloud brightness
scene.env.sky.cloudIntensity = 1.5

// Set the wind force, the amount of wind affects the speed at which the clouds move
scene.env.sky.wind = new Vector2(300, 500);

```
