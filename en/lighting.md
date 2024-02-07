# Lighting

Currently, we support the following types of light sources:

- Direct lighting
  - Directional light
  - Point light
  - Spot light
- Indirect lighting
  - IBL
  - HemiSpheric
  
## Direct lighting

For direct illumination, we need to create a light source node. This allows us to set the color and intensity of the light source, with its position and direction determined by the node's location and rotation. 

**The direction of the light source is oriented towards the negative Z-axis of its own coordinate system.**

### Directional light

The code below demonstrates how to use a directional light.

```javascript

// Create a directional light object
const light = new DirectionalLight(scene);
// light direction
light.rotation.fromEulerAngle(Math.PI/4, Math.PI/4, 0, 'ZYX');
// light color
light.color = new Vector4(1, 1, 0, 1);

```

<div class="showcase" case="tut-11"></div>

### Point light

The code below demonstrates how to use a point light.

```javascript

// Create a point light object
const light = new PointLight(scene);
// light range
light.range = 30;
// light color
light.color = new Vector4(1, 1, 1, 1);
// light position
light.position.setXYZ(0, 1, 0);

```

<div class="showcase" case="tut-12"></div>

### Spot light

The code below demonstrates how to use a spot light.

```javascript

// Creates a spot light object
const light = new SpotLight(scene);
// light direction
light.rotation.fromEulerAngle(-Math.PI/4, Math.PI/4, 0, 'ZYX');
// light color
light.color = new Vector4(1, 1, 1, 1);
// light cutoff
light.cutoff = Math.cos(Math.PI * 0.25);
// light range
light.range = 30;
// light position
light.position.setXYZ(0, 15, 0);

```

<div class="showcase" case="tut-13"></div>

## Indirect lighting

Image-Based Lighting (IBL) calculates the environmental lighting at each point in a scene by pre-integrating environmental maps in spherical space. IBL is particularly suited for Physically Based Rendering (PBR) materials.

In a scene, we support only one ambient light, which can be set through ```scene.env.light```. The property ```scene.env.light.type``` is used to define the type of ambient light. Currently, this property can be set to 'ibl', 'hemisphere', or 'none', with 'ibl' being the default. Setting it to 'none' will turn off ambient lighting.

### IBL(Image based lighting)

Image-Based Lighting (IBL) calculates the environmental lighting at each point in a scene by pre-integrating environmental maps in spherical space. IBL is particularly suited for Physically Based Rendering (PBR) materials.

To implement IBL environmental lighting, you need to set the scene.env.light.type to "ibl". Additionally, it requires setting up two pre-calculated maps: a Radiance Map and an Irradiance Map. If these maps are not configured, the system will dynamically generate them based on the current sky. However, without a sky, no environmental lighting will be rendered.

Tools like CMFT are commonly used to generate the Radiance and Irradiance maps, but we also offer functionality for dynamic generation of these maps. In the code example below, we use a high dynamic range 360-degree panoramic image to generate both the Radiance and Irradiance maps and produce a cubic sky map.

```javascript

  // Load the panorama
  assetManager.fetchTexture('assets/images/Wide_Street.hdr').then(tex => {
    // Generate a cube sky map from the panorama
    const skyMap = myApp.device.createCubeTexture('rgba16f', 512);
    panoramaToCubemap(tex, skyMap);
    // Generate an radiance map from the cube sky map
    const radianceMap = myApp.device.createCubeTexture('rgba16f', 256);
    prefilterCubemap(skyMap, 'ggx', radianceMap);
    // Generate an irradiance map from the cube sky map
    const irradianceMap = myApp.device.createCubeTexture('rgba16f', 64);
    prefilterCubemap(skyMap, 'lambertian', irradianceMap);
    // Set the sky mode to a skybox and set the skybox map
    scene.env.sky.skyType = 'skybox';
    scene.env.sky.skyboxTexture = skyMap;
    // Set the ambient lighting mode to IBL and set the radiance map and irradiance map
    scene.env.light.type = 'ibl';
    scene.env.light.radianceMap = radianceMap;
    scene.env.light.irradianceMap = irradianceMap;
  });

```

<div class="showcase" case="tut-14" style="width:600px;height:800px;"></div>

### Hemispheric Light

Hemispherical skylight is a basic simulation of ambient light. It involves assigning specific colors to the sky and the ground. The ambient light affecting objects is then determined by interpolating between these two colors based on the orientation of their surfaces.

```javascript

// Hemispheric light
scene.env.light.type = 'hemisphere';
scene.env.light.ambientUp = new Vector4(0.3, 0.6, 1.0, 1.0);
scene.env.light.ambientDown = new Vector4(0.2, 0.2, 0.2);

```

<div class="showcase" case="tut-15" style="width:600px;height:800px;"></div>

## Lighting system

We utilize Clustered Lighting technology, which supports up to 255 lights within the view frustum. For WebGL devices, each pixel can receive illumination from a maximum of 8 lights, while for WebGL2 and WebGPU devices, each pixel can be illuminated by up to 16 lights.
