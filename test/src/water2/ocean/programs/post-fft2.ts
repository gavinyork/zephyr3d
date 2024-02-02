export const vs = `#version 300 es
in vec3 position;
void main() {
  gl_Position = vec4(position, 1.0f);
}
`;

export const fs = `#version 300 es
precision highp float;

layout(location = 0) out vec4 dx_hy_dz_dxdz0;
layout(location = 1) out vec4 sx_sz_dxdx_dzdz0;
layout(location = 2) out vec4 dx_hy_dz_dxdz1;
layout(location = 3) out vec4 sx_sz_dxdx_dzdz1; 
layout(location = 4) out vec4 dx_hy_dz_dxdz2; 
layout(location = 5) out vec4 sx_sz_dxdx_dzdz2; 

uniform float N2;
uniform sampler2D ifft0;  // dx_hy_dz_dxdz
uniform sampler2D ifft1;  // sx_sz_dxdx_dzdz
uniform sampler2D ifft2;  // dx_hy_dz_dxdz
uniform sampler2D ifft3;  // sx_sz_dxdx_dzdz
uniform sampler2D ifft4;  // dx_hy_dz_dxdz
uniform sampler2D ifft5;  // sx_sz_dxdx_dzdz

void main() {
  const float sign[] = float[2](1.0f, -1.0f);
  float p = float(int(gl_FragCoord.x) + int(gl_FragCoord.y));
  float s = sign[int(mod(p, 2.0f))];
  float m = s * N2;
  ivec2 uv = ivec2(gl_FragCoord.xy);

  dx_hy_dz_dxdz0 = texelFetch(ifft0, uv, 0).rgba * m;
  sx_sz_dxdx_dzdz0 = texelFetch(ifft1, uv, 0).rgba * m;
  
  dx_hy_dz_dxdz1 = texelFetch(ifft2, uv, 0).rgba * m;
  sx_sz_dxdx_dzdz1 = texelFetch(ifft3, uv, 0).rgba * m;

  dx_hy_dz_dxdz2 = texelFetch(ifft4, uv, 0).rgba * m;
  sx_sz_dxdx_dzdz2 = texelFetch(ifft5, uv, 0).rgba * m;
}
`;
