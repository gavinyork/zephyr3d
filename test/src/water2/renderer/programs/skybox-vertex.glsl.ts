export default `#version 300 es
layout(location = 0) in vec3 position;

uniform mat4 viewMat;
uniform mat4 projMat;

out vec3 _pos;

void main()
{
  _pos = normalize(position);
  gl_Position = (projMat * viewMat * vec4(position * 0.5f, 0.0f)).xyww;
}
`;
