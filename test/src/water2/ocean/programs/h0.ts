export const vs = `#version 300 es
in vec3 position;
void main() {
  gl_Position = vec4(position, 1.0f);
}
`;

export const fs = `#version 300 es
#define PI 3.141592653f
#define PI2 6.2831853071f
#define g 9.81f

precision highp float;

layout(location = 0) out vec4 spectrum0;
layout(location = 1) out vec4 spectrum1;
layout(location = 2) out vec4 spectrum2;

uniform sampler2D noise;
uniform uint resolution;  // N
uniform vec2 wind;
uniform float alignment;

uniform struct FieldCascade {
  float size;
  float strength;
  float minK;
  float maxK;
} cascades[3];

vec4 gauss() {
  vec2 uv = vec2(ivec2(gl_FragCoord.xy)) / float(resolution);
  vec2 noise0 = texture(noise, uv).rg;
  vec2 noise1 = texture(noise, -uv).rg;

  float u0 = 2.0f * PI * noise0.x;
  float v0 = sqrt(-2.0f * log(noise0.y));

  float u1 = 2.0f * PI * noise1.x;
  float v1 = sqrt(-2.0f * log(noise1.y));

  return vec4(v0 * cos(u0), v0 * sin(u0), v1 * cos(u1), -v1 * sin(u1));
}

vec4 phillips(in vec2 k, float A, float minK, float maxK) {
  float k2 = dot(k, k);

  if(k2 <= minK * minK || k2 >= maxK * maxK) {
    return vec4(0.0f);
  }

  float L = dot(wind, wind) / g;
  float L2 = L * L;
  float h0k = (A / k2 / k2) * exp(-1.0 / (k2 * L2)) * 0.5f, h0mk = h0k;
  if(alignment > 0.0f) {
    h0k *=  pow(max(0.0f, dot(normalize(wind), normalize(k))), alignment);
    h0mk *=  pow(max(0.0f, dot(normalize(wind), normalize(-k))), alignment);
  }
  return sqrt(vec4(h0k, h0k, h0mk, h0mk));
}

void main() {
  vec2 x = vec2(ivec2(gl_FragCoord.xy) - ivec2(resolution / 2u)); //  [-N/2, N/2]
  vec2 k = vec2(PI2) * x;
  vec4 rnd = gauss();
  spectrum0 = phillips(k / cascades[0].size, cascades[0].strength, cascades[0].minK, cascades[0].maxK) * rnd;
  spectrum1 = phillips(k / cascades[1].size, cascades[1].strength, cascades[1].minK, cascades[1].maxK) * rnd;
  spectrum2 = phillips(k / cascades[2].size, cascades[2].strength, cascades[2].minK, cascades[2].maxK) * rnd;
}
`;
