import * as twgl from 'twgl.js';

function main() {
  const gl = document.querySelector("canvas").getContext("webgl2");
  if (!gl) {
    return alert("need webgl2");
  }

  const vs = `
  #version 300 es
  flat out uint vs_ch_output_vertex_id;
  void main() {
    // use a point as it's easier
    gl_PointSize = 300.0;   // because the canvas is 300x150
    gl_Position = vec4(0, 0, 0, 1);
    vs_ch_output_vertex_id = uint(gl_VertexID);
  }
  `;

  const uintFS = `
  #version 300 es
  precision highp float;
  flat in uint vs_ch_output_vertex_id;
  out uvec4 color;
  void main() {
    // will fill texture with values from 0 to 30000
    // if the texture is 300x100 and we're rendering
    // to the entire texture
    color = uvec4(gl_FragCoord.xy, vs_ch_output_vertex_id, 300) * 100u;
  }
  `;

  const uintToFloatFS = `
  #version 300 es
  precision highp float;
  uniform highp usampler2D tex;
  out vec4 color;
  void main() {
    uvec4 data = texture(tex, gl_PointCoord.xy);
    color = vec4(data) / 30000.0;
  }
  `;

  // compile shaders
  const renderUintPrg = twgl.createProgram(gl, [vs, uintFS]);
  const uintToFloatPrg = twgl.createProgram(gl, [vs, uintToFloatFS]);

  // make an 300x150 RGBA16UI texture and attach to framebuffer
  const fbi = twgl.createFramebufferInfo(gl, [
    {internalFormat: gl.RGBA16UI, minMag: gl.NEAREST, },
  ], 300, 150);

  function draw() {
    // bind framebuffer
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbi.framebuffer);

    gl.useProgram(renderUintPrg);

    gl.drawArrays(gl.POINTS, 0, 1);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    gl.useProgram(uintToFloatPrg);

    gl.drawArrays(gl.POINTS, 0, 1);

    requestAnimationFrame(draw);
  }

  draw();

}

main();

