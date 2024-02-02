export const vs = `#version 300 es
layout(location = 0) in vec3 position;
void main() {
  gl_Position = vec4(position, 1.0f);
}
`;

export const fs = `#version 300 es
#define PI 3.141592653f
#define g 9.81f

precision highp float;

layout(location = 0) out vec4 spectrum0;
layout(location = 1) out vec4 spectrum1;
layout(location = 2) out vec4 spectrum2;
layout(location = 3) out vec4 spectrum3;
layout(location = 4) out vec4 spectrum4;
layout(location = 5) out vec4 spectrum5;

uniform uint resolution;  // N
uniform float sizes[3];   // L
uniform float t;
uniform sampler2D h0Texture0;
uniform sampler2D h0Texture1;
uniform sampler2D h0Texture2;

// --
struct complex {
  float re;
  float im;
};

const complex i = complex(0.0f, 1.0f);

complex add(complex a, complex b) {
  return complex(a.re + b.re, a.im + b.im);
}

complex mult(complex a, complex b) {
  return complex(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
}

complex eix(float x) {
  return complex(cos(x), sin(x));
}

complex conj(complex a) {
  return complex(a.re, -a.im);
}

complex scale(complex v, float s) {
  return complex(v.re * s, v.im * s);
}

complex negate(complex v) {
  return complex(-v.re, -v.im);
}

const float RATIO = 0.618033989036f;

// --
struct spectrum {
  complex dx;
  complex hy;
  complex dz;
  complex sx;
  complex sz;
  complex dxdx;
  complex dxdz;
  complex dzdz;
};

spectrum getSpectrum(in sampler2D h0Texture, in vec2 x, float size) {
  complex hy = complex(0.0f, 0.0f);
  complex sx = complex(0.0f, 0.0f);
  complex sz = complex(0.0f, 0.0f);
  complex dx = complex(0.0f, 0.0f);
  complex dz = complex(0.0f, 0.0f);
  complex dxdx = complex(0.0f, 0.0f);
  complex dzdz = complex(0.0f, 0.0f);
  complex dxdz = complex(0.0f, 0.0f);

  if(size <= 1.0e-3) {
    return spectrum(dx, hy, dz, sx, sz, dxdx, dxdz, dzdz); 
  }

  vec2 k = vec2(2.0 * PI * x.x / size, 2.0 * PI * x.y / size);
  float kLen = length(k);


  if(kLen > 1.0e-6f) {
    float w = sqrt(g * kLen);
    vec4 h0Texel = texelFetch(h0Texture, ivec2(gl_FragCoord.xy), 0).rgba;

    complex e = eix(w * t);
    complex h0 = complex(h0Texel.x, h0Texel.y);
    complex h0MinConj = complex(h0Texel.z, h0Texel.w);
    hy = add(mult(h0, e), mult(h0MinConj, conj(e)));

    if(int(gl_FragCoord.x) != 0) {
      sx = mult(complex(0.0f, k.x), hy);
      dx = mult(complex(0.0f, -k.x / kLen), hy);
      dxdx = scale(hy, k.x * k.x / kLen);
    }

    if(int(gl_FragCoord.y) != 0) {
      sz = mult(complex(0.0f, k.y), hy);
      dz = mult(complex(0.0f, -k.y / kLen), hy);
      dzdz = scale(hy, k.y * k.y / kLen);

      if(int(gl_FragCoord.x) != 0) {
        dxdz = scale(hy, k.y * k.x / kLen);
      }
    }
  }

  return spectrum(dx, hy, dz, sx, sz, dxdx, dxdz, dzdz);
}

void compressSpectrum(in spectrum spec, out vec4 part0, out vec4 part1) {
  complex dx_hy = add(spec.dx, mult(i, spec.hy));
  complex dz_dxdz = add(spec.dz, mult(i, spec.dxdz));
  complex sx_sz = add(spec.sx, mult(i, spec.sz));
  complex dxdx_dzdz = add(spec.dxdx, mult(i, spec.dzdz));

  part0 = vec4(dx_hy.re, dx_hy.im, dz_dxdz.re, dz_dxdz.im);
  part1 = vec4(sx_sz.re, sx_sz.im, dxdx_dzdz.re, dxdx_dzdz.im);
}

void main() {
  vec2 x = vec2(ivec2(gl_FragCoord.xy) - ivec2(resolution / 2u)); //  [-N/2, N/2)

  spectrum spec0 = getSpectrum(h0Texture0, x, sizes[0]);
  spectrum spec1 = getSpectrum(h0Texture1, x, sizes[1]);
  spectrum spec2 = getSpectrum(h0Texture2, x, sizes[2]);

  compressSpectrum(spec0, spectrum0, spectrum1);
  compressSpectrum(spec1, spectrum2, spectrum3);
  compressSpectrum(spec2, spectrum4, spectrum5);
}
`;
