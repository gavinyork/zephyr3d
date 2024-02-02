export const vs = `#version 300 es
layout(location = 0) in vec2 position;
out vec3 outSample;

const uint NUM_ITERATIONS = 4u;

uniform float sizes[3];   
uniform float croppinesses[3];   
uniform float size;   
uniform vec2 origin;

uniform sampler2D dx_hy_dz_dxdz0;
uniform sampler2D dx_hy_dz_dxdz1;
uniform sampler2D dx_hy_dz_dxdz2;

vec3 getDisplacement(in vec2 xz) {
  vec2 uv0 = xz / sizes[0];
  vec2 uv1 = xz / sizes[1];
  vec2 uv2 = xz / sizes[2];

  return 
    texture(dx_hy_dz_dxdz0, uv0).xyz * vec3(croppinesses[0], 1.0f, croppinesses[0]) + 
    texture(dx_hy_dz_dxdz1, uv1).xyz * vec3(croppinesses[1], 1.0f, croppinesses[1]) + 
    texture(dx_hy_dz_dxdz2, uv2).xyz * vec3(croppinesses[2], 1.0f, croppinesses[2]);
}


float getHeight(in vec2 xz) {
  vec2 _xz = xz;
  float height = 0.0f;

  for(uint i = 0u; i < NUM_ITERATIONS; i++) {
    vec3 p = getDisplacement(_xz);
    _xz = xz - p.xz;
    height = p.y;
  }

  return height;
}

void main()
{
  vec2 xz = position * size + origin;
  outSample = vec3(xz.x, getHeight(xz), xz.y);
}`;

export const fs = `#version 300 es
precision highp float;
void main() {}`;
