export default `#version 300 es
layout(location = 0) in vec3 position;

uniform mat4 viewMat;
uniform mat4 projMat;
uniform float sizes[3];   
uniform float croppinesses[3];   
uniform float scale;   

uniform mat4 worldMat;

uniform sampler2D dx_hy_dz_dxdz0;
uniform sampler2D sx_sz_dxdx_dzdz0;
uniform sampler2D dx_hy_dz_dxdz1;
uniform sampler2D sx_sz_dxdx_dzdz1;
uniform sampler2D dx_hy_dz_dxdz2;
uniform sampler2D sx_sz_dxdx_dzdz2;

out vec3 _position;
out vec2 _xz;

vec3 getDisplacement(in vec2 xz) {
  vec2 uv0 = xz / sizes[0];
  vec2 uv1 = xz / sizes[1];
  vec2 uv2 = xz / sizes[2];

  return 
    texture(dx_hy_dz_dxdz0, uv0).xyz * vec3(croppinesses[0], 1.0f, croppinesses[0]) + 
    texture(dx_hy_dz_dxdz1, uv1).xyz * vec3(croppinesses[1], 1.0f, croppinesses[1]) + 
    texture(dx_hy_dz_dxdz2, uv2).xyz * vec3(croppinesses[2], 1.0f, croppinesses[2]);
}

void main()
{
  vec2 xz = vec3(worldMat * vec4(position * scale, 1.0f)).xz;
  _position = position * scale + getDisplacement(xz);
  _position = vec3(worldMat * vec4(_position, 1.0f));
  _xz = xz;
  gl_Position = projMat * viewMat * vec4(_position, 1.0f);
}
`;
