# Shadow

> Code on this page is illustrative and omits imports and application setup. See the embedded
> live demos for complete runnable examples.

Shadows add depth and realism to scenes. Directional, point, spot and rect lights can all cast shadows.

## Enable shadow

Each light source can be individually configured to cast shadows or not, along with settings for shadow mode and quality parameters.

```javascript

const light = new DirectionalLight(scene);
// The castShadow property controls whether the light casts shadows
light.castShadow = true;

```

Meshes can also be configured to cast shadows or not.

```javascript

// Allow this mesh to cast shadows
// Default value is true
mesh.castShadow = true;

```

## Shadows of directional light：

<div class="showcase" case="tut-16"></div>

## Shadows of point light：

<div class="showcase" case="tut-17"></div>

## Shadows of spot light：

<div class="showcase" case="tut-18"></div>

## Shadows of rect light：

A rect light's shadow map is a cube map, as for a point light. With the `'pcss'` shadow mode the
penumbra follows the size of the rectangle: the larger the light, the softer the shadow, and the
wider it spreads with distance from the object casting it. Other modes keep the same edge
whatever the light's size.

<<< @/../src/tut-84/main.js#shadow

The example sweeps the light over pillars of different heights. Drag the size slider to watch the
penumbra grow, and switch modes to compare.

<div class="showcase" case="tut-84"></div>
