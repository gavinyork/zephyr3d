# SSAO (Screen Space Ambient Occlusion)

**Purpose**: Simulates light occlusion to generate subtle shadowing in object creases and contact areas, enhancing depth perception and spatial realism.

**Property Interface**:

- `camera.SSAO`: `boolean` — Enables or disables the SSAO effect.  
- `camera.SSAOScale`: `number` — Sampling scale factor (radius multiplier).  
- `camera.SSAOBias`: `number` — Bias value to reduce self‑occlusion artifacts.  
- `camera.SSAORadius`: `number` — Sampling radius controlling the area of influence.  
- `camera.SSAOIntensity`: `number` — Shadow intensity (overall darkness of the ambient occlusion).  
- `camera.SSAOBlurDepthCutoff`: `number` — Depth cutoff threshold used when blurring the AO result.

**Example**:
```javascript  
camera.SSAO = true;  
camera.SSAOIntensity = 0.05;  
```

<div class="showcase" case="tut-29" style="width:600px;height:800px;"></div>
