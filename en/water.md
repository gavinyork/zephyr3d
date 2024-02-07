# Water

Water surfaces are a common natural scenery, and we have a implementation based on FFT that supports up to three layers of wave superposition. 

Currently, our water surfaces are implemented as a post-processing feature.

```javascript

// Create a water post effect
const water = new PostWater();
// Set the water surface to a rectangular range from (-100, -100) to (100, 100) in the world coordinate system, default is (-1000, -1000) to (1000, 1000)
water.boundary.setXYZW(-100, -100, 100, 100);
// Set the water surface height to the Y axis 20 in the world coordinate system, the default value is 0
water.elevation = 20;
// Set the wind direction (vector in 2D space) to affect the strength and propagation direction of the wave, default is (2, 2)
water.wind.setXY(3, 5);
// Sets the jitter intensity of the reflection refraction, the higher the value, the stronger the jitter, the default value is 16
water.displace = 8;
// Set the water depth scaling factor, the lower the value, the clearer the water, the default value is 0.1
water.depthMulti = 0.2;
// Set the refraction strength, this value is used to modify the Fresnel coefficient, the higher the value, the stronger the refraction, the default is 0
water.refractionStrength = 0.1;
// Set the degree of alignment between the wave propagation direction and the wind direction, the default value is 1
water.alignment = 0.3;
// Set the width of the foam, default is 1.2
water.foamWidth = 0.8;
// Set the contrast of the foam, the smaller the value, the higher the contrast, the default is 7.2
water.foamContrast = 8;
// Set the wavelength of the first wave layer, which is 400 by default
water.waveLength0 = 400;
// Sets the cropiness of the first wave layer, which defaults to -1.5
water.waveCroppiness0 = -1;
// Sets the strength of the first wave layer, which defaults to 0.4
water.waveStrength0 = 0.4;
// Set the wavelength of the second wave layer, which is 100 by default
water.waveLength1 = 100;
// Sets the cropiness of the second wave layer, which defaults to -1.2
water.waveCroppiness1 = -1;
// Sets the strength of the third wave layer, which defaults to 0.2
water.waveStrength1 = 0.2;
// Set the wavelength of the third wave layer, which is 15 by default
water.waveLength2 = 20;
// Sets the cropiness of the second wave layer, which defaults to -0.5
water.waveCroppiness2 = -1;
// Sets the strength of the third wave layer, which defaults to 0.2
water.waveStrength2 = 0.2;

// Adds the water post effect
compositor.appendPostEffect(water);

```

<div class="showcase" case="tut-38"></div>
