# Shadow

Shadows add depth and realism to scenes. Currently, we support casting shadows with directional, point, and spotlight sources.

## Enable shadow

Each light source can be individually configured to cast shadows or not, along with settings for shadow mode and quality parameters.

```javascript

const light = new DirectionalLight(scene);
// The castShadow property controls whether the light casts shadows
light.castShadow = true;

```

## Shadows of directional light：

<div class="showcase" case="tut-16"></div>

## Shadows of point light：

<div class="showcase" case="tut-17"></div>

## Shadows of spot light：

<div class="showcase" case="tut-18"></div>

