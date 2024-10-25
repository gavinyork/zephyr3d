# Screen Space Reflections

## Overview

  Screen Space Reflections is a real-time rendering technique that creates dynamic reflections by analyzing the scene's depth buffer and surface normals. Unlike traditional methods such as cubemaps or planar reflections, SSR produces accurate, context-aware reflections that respond to scene changes. This makes it particularly effective for reflective surfaces like polished metals, glass, and water.

## Getting Started

### Basic Configuration

- Enable/Disable Screen Space Reflections [Camera.SSR](/doc/markdown/./scene.camera.ssr)

  ```javascript
  // Enable SSR  
  camera.SSR = true;  

  // Enable HiZ acceleration (WebGL2/WebGPU only)  
  camera.HiZ = true;
  ```
  HiZ acceleration significantly improves performance by optimizing the ray tracing process. When enabled, certain other settings like stride and max distance are automatically optimized.

## Surface Reflection Control

### Roughness Settings

  Control which surfaces show reflections based on their roughness:

  ```javascript

  // Only surfaces with roughness below 0.8 will show reflections  
  camera.ssrMaxRoughness = 0.8;  

  // Optionally adjust scene-wide roughness for testing  
  camera.ssrRoughnessFactor = 1.0;

  ```

### Ray Tracing Quality

  Fine-tune the reflection quality and performance:

  ```javascript
  // Higher iterations = longer reflection distance but slower performance  
  camera.ssrIterations = 120;  

  // Smaller stride = more accurate but more expensive reflections  
  camera.ssrStride = 2;  

  // Maximum reflection distance in world units  
  camera.ssrMaxDistance = 100; 
  ```
  
### Surface Intersection

  Control how rays interact with surfaces:

  ```javascript
  // Adjust surface thickness detection  
  camera.ssrThickness = 0.5;  

  // Enable automatic thickness calculation  
  camera.ssrCalcThickness = true;
  ```

## Reflection Blur

### Blur Configuration

  ```javascript
  // Overall blur strength  
  camera.ssrBlurScale = 0.05;  

  // Edge preservation sensitivity  
  camera.ssrBlurDepthCutoff = 2;  

  // Blur quality (higher = smoother but slower)  
  camera.ssrBlurKernelSize = 17;  
  camera.ssrBlurStdDev = 10;
  ```

## Visual Example

<div class="showcase" case="tut-49"></div>

