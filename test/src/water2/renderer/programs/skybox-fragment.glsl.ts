export default `#version 300 es
precision highp float;

layout( location = 0 ) out vec4 color;	

in vec3 _pos;

uniform samplerCube env;

uniform float exposure;
uniform float gamma;

vec3 gammaCorrection(const vec3 color) {
  return pow(color, vec3(1.0f / gamma));
}

vec3 toneMapping(const vec3 color) {
  return vec3(1.0f) - exp(-color * exposure);
}

vec3 ACESFilm(vec3 x){
    return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

void main()
{
  vec3 background = textureLod(env, normalize(_pos), 0.0f).rgb;
  color = vec4(gammaCorrection(ACESFilm(background)), 1.0f);
}
`;
