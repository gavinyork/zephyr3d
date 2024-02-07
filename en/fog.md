# Fog

Fog effects are used to simulate the natural phenomenon where objects become increasingly blurry with distance, enhancing the realism of rendered scenes. We support fog effects based on true atmospheric scattering algorithms, as well as traditional linear and exponential fog algorithms.

## Atmospheric scattering

```javascript

// Set to atmospheric scattering fog effect (usually required in conjunction with atmospheric scattering sky rendering mode)
scene.env.sky.fogType = 'scatter';
// When using the Atmospheric Scatter Fog effect, this property adjusts the concentration of the fog effect, the smaller the value, the smaller the fog concentration
scene.worldUnit = 100;

```

<div class="showcase" case="tut-35"></div>

## Linear fog

```javascript

// Set to linear fog
scene.env.sky.fogType = 'linear';
// Starting distance
scene.env.sky.fogStart = 10;
// End distance
scene.env.sky.fogEnd = 400;
// Fog height
scene.env.sky.fogTop = 120;

```

<div class="showcase" case="tut-36"></div>

## Exp/Exp2 fog

```javascript

// Set to exp fog
scene.env.sky.fogType = 'exp';
// Set to exp2 fog
scene.env.sky.fogType = 'exp2';

// Fog density
scene.env.sky.fogDensity = 0.006;

```

<div class="showcase" case="tut-37"></div>
