# Lighting

Lighting is an essential element in making scenes look more realistic.

## Direct lighting

Direct lighting refers to objects being illuminated by specific light sources. Currently, we support directional, point, and spot lights.

We utilize Clustered Lighting technology, supporting up to 255 light sources within the view frustum. For WebGL devices, each pixel can receive illumination from up to 8 lights, while for WebGL2 and WebGPU devices, each pixel can be illuminated by up to 16 lights.

## Indirect lighting

Objects are not illuminated directly by a light source but by light reflected from other objects in the scene. This type of lighting is known as indirect illumination. The source of this illumination is referred to as ambient light.

Currently, we support Image-Based Lighting (IBL) and hemispherical skylight for indirect illumination.
