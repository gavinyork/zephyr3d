# Direct lighting

For direct illumination, we need to create a light source node. This allows us to set the color and intensity of the light source, with its position and direction determined by the node's location and rotation. 

**The direction of the light source is oriented towards the negative Z-axis of its own coordinate system.**

The engine provides four light types: directional, point, spot and rect (area) lights.

> The `color` and `intensity` used on this page belong to the default `legacy` lighting mode, where
> `intensity` is a unitless multiplier. If your scene uses
> [physical lighting mode](en/lighting-physical.md), intensity comes from photometric properties
> instead (`illuminance` / `luminousPower` / `luminance`) and `intensity` no longer applies.

## Directional light

A directional light models a source infinitely far away: it has a direction but no position, which
makes it the usual choice for sunlight.

<<< @/../src/tut-11/main.js{23-32 js}

The direction comes from the node's rotation, set here with `rotation.fromEulerAngle()`. Note that
line 25 turns environment lighting off (`scene.env.light.type = 'none'`) — **scenes have environment
lighting by default**, and leaving it on makes it hard to see what a single light contributes. Real
projects usually want both; see [Indirect lighting](en/lighting-indirect.md).

<div class="showcase" case="tut-11"></div>

## Point light

A point light emits from a position in all directions. Its position comes from the node's
`position`; its orientation is irrelevant.

<<< @/../src/tut-12/main.js{23-31 js}

Point and spot lights both have a `range`. **When `range` stays at its default of 0, the engine
derives a falloff radius from `intensity`**, which is why the example above only sets `intensity`.
Setting `range` explicitly bounds the light's influence — a smaller range means fewer pixels take
part in its lighting computation.

<div class="showcase" case="tut-12"></div>

## Spot light

A spot light has both a position and a direction, with its light confined to a cone.

<<< @/../src/tut-13/main.js{23-36 js}

**`cutoff` is the cosine of the cone half-angle, not the angle itself.** To express a 36-degree half
angle you write `Math.cos(Math.PI * 0.2)`; assigning `Math.PI * 0.2` directly produces a much wider
cone than intended, since a smaller cosine corresponds to a larger angle. This is an easy mistake to
make.

(In physical lighting mode the cone is set with `innerConeAngle` / `outerConeAngle`, which are
real angles in radians.)

<div class="showcase" case="tut-13"></div>

## Rect light

A rect light (`RectLight`) is a rectangular emitting surface. It produces softer, more directional
lighting and highlights than a point light, which suits windows, light boxes and screens.

```javascript
const light = new RectLight(scene);
// Rectangle dimensions in scene units
light.width = 4;
light.height = 2;
// Falloff range
light.range = 10;
light.color = new Vector4(1, 1, 1, 1);
light.intensity = 5;
// Position and orientation come from the node transform; light travels along its -Z axis
light.position.setXYZ(0, 5, 0);
light.lookAt(new Vector3(0, 5, 0), Vector3.zero(), Vector3.axisPY());
```

Rect light highlights use an LTC (Linearly Transformed Cosines) approximation and work on all
backends. Because it integrates over the rectangle area it costs more than the other light types,
so keep their count in check.

