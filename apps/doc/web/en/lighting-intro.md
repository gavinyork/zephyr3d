# Lighting

Lighting is an essential element in making scenes look more realistic.

## Direct lighting

Direct lighting refers to objects being illuminated by specific light sources. Directional (`DirectionalLight`), point (`PointLight`), spot (`SpotLight`) and rectangular area (`RectLight`) lights are supported; see [Direct Lighting](en/lighting-direct.md).

We utilize Clustered Lighting. The light limits depend on the backend: on WebGPU a scene can have up to 65535 lights and each cluster's light list has no fixed length; on WebGL2 the limits are 255 lights and 16 per cluster. Directional lights do not take cluster slots (up to 4 of them are shaded outside the clusters). See [Backend Support](en/backend-support.md#capacity-differences).

## Indirect lighting

Objects are not illuminated directly by a light source but by light reflected from other objects in the scene. This type of lighting is known as indirect illumination. The source of this illumination is referred to as ambient light.

The ambient light (`scene.env.light.type`) can be image-based lighting (`'ibl'`), a hemispherical skylight (`'hemisphere'`) or a constant colour (`'constant'`). On WebGPU, probe-based global illumination (`scene.gi`) can also be enabled; within the probes' reach it replaces the diffuse part of the ambient light with the light actually bounced around the scene. See [Indirect Lighting](en/lighting-indirect.md).

## Lighting units

The default `legacy` lighting mode uses unitless intensities. In the experimental `physical` mode, lights, ambient light and emission are set in physical units (lux, candela and so on) and paired with camera exposure; see [Physical Lighting](en/lighting-physical.md).
