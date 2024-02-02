# Shadow

Shadows add depth and realism to scenes. Currently, we support casting shadows with directional, point, and spotlight sources.

## Enable shadow

Each light source can be individually configured to cast shadows or not, along with settings for shadow mode and quality parameters.

```javascript

const light = new DirectionalLight(scene);
// The castShadow property controls whether the light casts shadows
light.castShadow = true;

```

### Shadows of directional light：

<div class="showcase" case="tut-16"></div>

### Shadows of point light：

<div class="showcase" case="tut-17"></div>

### Shadows of spot light：

<div class="showcase" case="tut-18"></div>

## Shadow anti-aliasing

Using ShadowMap to create shadows may result in jagged edges due to the precision limitations of ShadowMap textures. To soften the shadow edges, we can either increase the size of the ShadowMap texture or employ techniques such as PCF, VSM, or ESM.

### Increased shadow map resolution

The resolution of the ShadowMap texture can be adjusted using the ```light.shadow.shadowMapSize``` property.

In the example below, the shadow texture resolution on the top half of the screen is set to 512 pixels, while the resolution on the bottom half is set to 1024 pixels.

<div class="showcase" case="tut-19" style="width:600px;height:800px"></div>

### PCF

PCF is an anti-aliasing technique that works by sampling shadow maps multiple times. 

```javascript

// use ptimized PCF
light.shadow.mode = 'pcf-opt';
// use PoissonDisc PCF
light.shadow.mode = 'pcf-pd';

```

In the example below, the top half of the screen uses PCF sampling, while the bottom half uses regular sampling.

<div class="showcase" case="tut-20" style="width:600px;height:800px"></div>

### VSM

 VSM employs statistical principles for its anti-aliasing technique. 

```javascript

light.shadow.mode = 'vsm';

```

In the following example, the top half of the screen utilizes VSM, and the bottom half uses regular sampling.

<div class="showcase" case="tut-21" style="width:600px;height:800px;"></div>

### ESM

Exponential Shadow Maps (ESM) is an anti-aliasing technique that processes shadow edges using exponential functions. 

```javascript

light.shadow.mode = 'esm';

```

In the example below, the top half of the screen utilizes ESM, while the bottom half employs standard sampling.

<div class="showcase" case="tut-22" style="width:600px;height:800px;"></div>

### CSM

Cascaded Shadow Map (CSM) is a technique that improves shadow aliasing by dividing the view frustum into multiple sections and applying a ShadowMap to each separately.

Below is an example of CSM.

<div class="showcase" case="tut-23"></div>

### Limit the range of shadows

When the shadow range is too extensive, even using Cascaded Shadow Maps (CSM) may not enhance the shadow's precision. We can restrict the shadows to a certain distance from the camera, allowing for a smooth transition to a shadowless state at the boundary of this range.

```javascript

light.shadow.shadowDistance = 500;

```
