export const vs = `#version 300 es
layout(location = 0) in vec3 position;
layout(location = 1) in vec3 normal;
layout(location = 2) in vec3 color;

uniform mat4 viewMat;
uniform mat4 projMat;
uniform mat4 worldMat;

out vec3 _position;
out vec3 _normal;
out vec3 _color;

void main()
{
  gl_Position = projMat * viewMat * worldMat * vec4(position, 1.0f);
  _position = vec3(worldMat * vec4(position, 1.0f));
  _normal = normalize(mat3(worldMat) * normal);
  _color = color;
}
`;

export const fs = `#version 300 es
precision highp float;

layout( location = 0 ) out vec4 color;	

in vec3 _normal;
in vec3 _position;
in vec3 _color;

uniform vec4 albedo;
uniform vec3 pos;

void main()
{
  if(albedo.w == 0.0f) {
    color = vec4(_color * albedo.rgb, 1.0f);
  } else {
    vec3 n = normalize(_normal);
    vec3 l = normalize(pos - _position);
    float nol = dot(n, l) * 0.7 + 0.3;
    color = albedo * vec4(vec3(nol), 1.0f);   
  }
}
`;
