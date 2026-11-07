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

## Defaults and Bias

A light's shadow settings live on `light.shadow`. The default mode is `'pcf'`, with a 1024 shadow map, a single cascade, and a shadow distance of 2000.

A shadow map has limited resolution, so a surface easily shadows itself and shows stripes (shadow acne). Two bias settings remove it:

| Property | Default | Effect |
| --- | --- | --- |
| `depthBias` | `0.003` | Depth offset. Too small leaves stripes; too large detaches the shadow from the object (peter-panning) |
| `normalBias` | `1.5` | How far the receiver is pushed out along its normal, in shadow map texels. It is what removes acne at grazing angles; 1 to 4 is typical, and too much detaches contact shadows from thin geometry |
| `shadowStrength` | `1` | How dark the shadow is, from 0 (none) to 1 (fully blocked) |

**Limit**: at most 32 shadow-casting lights at once. Lights beyond that cast no shadow, with a warning in the console once.

## Contact Shadows

Shadow maps lack the resolution for the small shadows where objects touch the ground or in crevices. Screen-space contact shadows trace a short distance from each pixel towards the light to add that detail. They are set per light and off by default:

```javascript
light.castShadow = true;            // only lights that cast shadows
light.contactShadowLength = 0.05;   // trace length, a fraction of the screen height by default; 0 turns it off (default)
light.contactShadowLengthInWS = false;   // true measures the length in world units instead
light.contactShadowCastingIntensity = 1; // darkness of contact shadows, 0 to 1
```

Contact shadows are computed in the screen-space shadow mask, so they need both `camera.contactShadows` and `camera.screenSpaceShadowMask` (both on by default). They only see geometry visible on screen; objects that are hidden or off screen cast no contact shadow.

## Shadows of directional light

<div class="showcase" case="tut-16"></div>

## Shadows of point light

<div class="showcase" case="tut-17"></div>

## Shadows of spot light

<div class="showcase" case="tut-18"></div>

## Shadows of rect light

A rect light's shadow map is a cube map, as for a point light. With the `'pcss'` shadow mode the
penumbra follows the size of the rectangle: the larger the light, the softer the shadow, and the
wider it spreads with distance from the object casting it. Other modes keep the same edge
whatever the light's size.

<<< @/../src/tut-84/main.js#shadow

The example sweeps the light over pillars of different heights. Drag the size slider to watch the
penumbra grow, and switch modes to compare.

<div class="showcase" case="tut-84"></div>
