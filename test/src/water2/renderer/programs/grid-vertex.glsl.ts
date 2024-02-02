export default `#version 300 es
layout(location = 0) in vec3 position;

uniform mat4 viewMat;
uniform mat4 projMat;
uniform float sizes[3];   
uniform float croppinesses[3];   
uniform float scale; 

uniform mat4 invProjView;  
uniform vec3 pos;

uniform sampler2D dx_hy_dz_dxdz0;
uniform sampler2D sx_sz_dxdx_dzdz0;
uniform sampler2D dx_hy_dz_dxdz1;
uniform sampler2D sx_sz_dxdx_dzdz1;
uniform sampler2D dx_hy_dz_dxdz2;
uniform sampler2D sx_sz_dxdx_dzdz2;

out highp vec3 _position;
out highp vec2 _xz;

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
   vec4 homogeneous = invProjView * vec4(position, 1.0f);
   vec3 ray = normalize(homogeneous.xyz / homogeneous.w);

  if(ray.y >= 0.0f) {  // beyond horizon
    gl_Position = vec4(position.x, position.y, 2.0f, 1.0f);
  } else {
    _position = ray * -pos.y / ray.y + pos;
    _xz = _position.xz;
    _position = _position + getDisplacement(_xz);
    gl_Position = projMat * viewMat * vec4(_position, 1.0f);
  }
}
`;
