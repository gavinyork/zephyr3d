export default `#version 300 es
precision highp float;

layout(location = 0) out vec4 color;

in vec3 _position;
in vec2 _xz;

uniform vec3 pos;
uniform float foamSpreading;
uniform float foamContrast;
uniform float sizes[3];
uniform float croppinesses[3];
uniform samplerCube env;

uniform sampler2D dx_hy_dz_dxdz0;
uniform sampler2D sx_sz_dxdx_dzdz0;
uniform sampler2D dx_hy_dz_dxdz1;
uniform sampler2D sx_sz_dxdx_dzdz1;
uniform sampler2D dx_hy_dz_dxdz2;
uniform sampler2D sx_sz_dxdx_dzdz2;

vec4 jacobian(float dxdx, float dxdz, float dzdz) {
  float Jxx = 1.0f + dxdx;
  float Jxz = dxdz;
  float Jzz = 1.0f + dzdz;
  return vec4(Jxx, Jxz, Jxz, Jzz);
}

float det(vec4 jacobian) {
  return jacobian.x * jacobian.w - jacobian.y * jacobian.z;
}

vec3 getNormal(in vec2 xz) {
  vec2 uv0 = xz / sizes[0];
  vec2 uv1 = xz / sizes[1];
  vec2 uv2 = xz / sizes[2];

  vec4 _sx_sz_dxdx_dzdz0 = texture(sx_sz_dxdx_dzdz0, uv0).xyzw;
  vec4 _sx_sz_dxdx_dzdz1 = texture(sx_sz_dxdx_dzdz1, uv1).xyzw;
  vec4 _sx_sz_dxdx_dzdz2 = texture(sx_sz_dxdx_dzdz2, uv2).xyzw;

  float sx = _sx_sz_dxdx_dzdz0.x + _sx_sz_dxdx_dzdz1.x +_sx_sz_dxdx_dzdz2.x;
  float sz = _sx_sz_dxdx_dzdz0.y + _sx_sz_dxdx_dzdz1.y +_sx_sz_dxdx_dzdz2.y;
  float dxdx = _sx_sz_dxdx_dzdz0.z * croppinesses[0] + _sx_sz_dxdx_dzdz1.z * croppinesses[1] + _sx_sz_dxdx_dzdz2.z * croppinesses[2];
  float dzdz = _sx_sz_dxdx_dzdz0.w * croppinesses[0] + _sx_sz_dxdx_dzdz1.w * croppinesses[1] + _sx_sz_dxdx_dzdz2.w * croppinesses[2];

  vec2 slope = vec2(sx / (1.0f + dxdx), sz / (1.0f + dzdz));

  return normalize(vec3(-slope.x, 1.0f, -slope.y));
}

float getFoam(in vec2 xz) {
  vec2 uv0 = xz / sizes[0];
  vec2 uv1 = xz / sizes[1];
  vec2 uv2 = xz / sizes[2];

  vec2 dxdx_dzdz0 = texture(sx_sz_dxdx_dzdz0, uv0).zw;
  vec2 dxdx_dzdz1 = texture(sx_sz_dxdx_dzdz1, uv1).zw;
  vec2 dxdx_dzdz2 = texture(sx_sz_dxdx_dzdz2, uv2).zw;

  float dxdz0 = texture(dx_hy_dz_dxdz0, uv0).w;
  float dxdz1 = texture(dx_hy_dz_dxdz1, uv1).w;
  float dxdz2 = texture(dx_hy_dz_dxdz2, uv2).w;

  vec2 dxdx_dzdz = dxdx_dzdz0 * croppinesses[0] + dxdx_dzdz1 * croppinesses[1] + dxdx_dzdz2 * croppinesses[2];
  float dxdz = dxdz0 * croppinesses[0] + dxdz1 * croppinesses[1] + dxdz2 * croppinesses[2];

  float val = det(jacobian(dxdx_dzdz.x, dxdz, dxdx_dzdz.y));
  return abs(pow(-min(0.0f, val - foamSpreading), foamContrast));
}


vec3 gammaCorrection(const vec3 color) {
  return pow(color, vec3(1.0f / 2.2f));
}

vec3 ACESFilm(vec3 x){
    return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

float fresnelSchlick(vec3 view, vec3 normal){
    float cosTheta = dot(normal, normalize(view));
	float F0 = 0.02;
    return F0 + (1.0 - F0) * pow(1.0 - cosTheta, 5.0);
}

vec3 surface(in vec3 normal, in vec3 view) {
  const vec3 upwelling = vec3(0.0, 0.2, 0.3);
  const vec3 mist = vec3(0.34, 0.42, 0.5);
  const float nShell = 1.34f;
  const float kDiffuse = 1.0f;
  const vec3 sunIndensity = vec3(0.42f, 0.39f, 0.19f) * 1.0e2;
  vec3 sunDir = normalize(vec3(1.0f, 1.0f, 10.0f));

  vec3 ref = reflect(-view, normal);
  ref.y = max(ref.y, 1.0e-0);
  ref = normalize(ref);

  vec3 sky = ACESFilm(textureLod(env, ref, 0.0f).rgb) + pow(max(dot(ref, sunDir), 0.0f), 500.0f) * sunIndensity;
  sky = gammaCorrection(sky);
  //sky = vec3(0.69, 0.84, 1.0);

  float reflectivity;
  float costhetai = abs(dot(normal, normalize(view)));
  float thetai = acos(costhetai);
  float sinthetat = sin(thetai) / nShell;
  float thetat = asin(sinthetat);

  if(thetai == 0.0)
  {
    reflectivity = (nShell - 1.0f) / (nShell + 1.0f);
    reflectivity = reflectivity * reflectivity;
  }
  else
  {
    float fs = sin(thetat - thetai)  / sin(thetat + thetai);
    float ts = tan(thetat - thetai)  / tan(thetat + thetai);
    reflectivity = 0.5 * (fs * fs + ts * ts );
  }

  // reflectivity = fresnelSchlick(view,normal);

  float falloff = 1.0f; // min(exp(-(length(view) - 1000.0f) * 1.0e-2), 1.0f) * kDiffuse;
  vec3 surf =  reflectivity * sky + (1.0f - reflectivity) * upwelling;
  return falloff * surf  + (1.0f - falloff) * mist;
}

void main()
{
  float f = getFoam(_xz) ;
  vec3 n = getNormal(_xz);
  const vec3 foam = vec3(1.0f);
  vec3 water = surface(n, pos - _position);
  color = vec4(mix(water, foam, f), 1.0f);
  //color = vec4(n * 0.5 + vec3(0.5), 1.0f);
  //color = textureLod(env, n, 0.0f);
}
`;
