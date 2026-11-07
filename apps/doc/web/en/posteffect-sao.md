# SSAO (Screen Space Ambient Occlusion)

**Purpose**: Simulates light occlusion to generate subtle shadowing in object creases and contact areas, enhancing depth perception and spatial realism.

**Property Interface**:

- `camera.SSAO`: `boolean` — Enables or disables the SSAO effect (default `false`).  
- `camera.SSAOOcclusionRadius`: `number` — Occlusion radius in world units (metres), default `0.25`.  
- `camera.SSAOBias`: `number` — Bias value to reduce self‑occlusion artifacts, default `0.05`.  
- `camera.SSAOIntensity`: `number` — Shadow intensity (overall darkness of the ambient occlusion), default `1`.  
- `camera.SSAOBlurDepthCutoff`: `number` — Depth cutoff threshold used when blurring the AO result, default `2`.

**Example**:
```javascript  
camera.SSAO = true;  
camera.SSAOOcclusionRadius = 0.5;  
camera.SSAOIntensity = 2;  
```

<div class="showcase" case="tut-29" style="width:600px;height:500px"></div>

**Tuning and trade-offs**:

- `SSAOOcclusionRadius` is a world-space size, so scale it with the scene: the default 0.25 m suits contact shadows at the scale of people and furniture, while architectural scenes need a larger value (the tut-29 example above uses 3.5). A larger radius lets the occlusion reach further.
- Do not enable it together with SSGI. SSGI's own ambient occlusion (`camera.ssgiAOIntensity`) is also multiplied into the final colour, so running both darkens the image twice.

> `SSAOScale` (a multiple of the far plane) and `SSAORadius` from before 1.0 are removed; `SSAOOcclusionRadius` replaces both.
