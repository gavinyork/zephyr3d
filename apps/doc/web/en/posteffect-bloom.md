# Bloom

**Purpose**: Produces a soft glow around bright areas of the image, enhancing brightness contrast and overall atmosphere.

**Property Interface**:

- `camera.bloom`: `boolean` — Enables or disables the Bloom effect.  
- `camera.bloomIntensity`: `number` — Adjusts the overall intensity of the Bloom glow.  
- `camera.bloomThreshold`: `number` — Luminance threshold; pixels brighter than this value contribute to Bloom.  
- `camera.bloomThresholdKnee`: `number` — Controls the smoothness of the threshold transition.  
- `camera.bloomMaxDownsampleLevels`: `number` — Maximum number of downsampling levels used in the Bloom chain.  
- `camera.bloomDownsampleLimit`: `number` — Minimum resolution limit for downsampling.  

**Example**:
```javascript  
camera.bloom = true;  
camera.bloomIntensity = 1.5;  
camera.bloomThreshold = 0.9;  
```

<div class="showcase" case="tut-28" style="width:600px;height:800px;"></div>
