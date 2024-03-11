# Direct lighting

For direct illumination, we need to create a light source node. This allows us to set the color and intensity of the light source, with its position and direction determined by the node's location and rotation. 

**The direction of the light source is oriented towards the negative Z-axis of its own coordinate system.**

## Directional light

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

## Point light

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

## Spot light

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

