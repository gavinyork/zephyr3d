export const vert = `
struct ch_VertexInput {
  @builtin(vertex_index) ch_builtin_vertexIndex: u32
};
struct ch_VertexOutput {
  @builtin(position) ch_builtin_position: vec4<f32>,
  @location(0) vs_ch_output_outUV: vec2<f32>
};
const coords: array<vec2<f32>, 4> = array<vec2<f32>, 4>(vec2<f32>(-1.0,1.0),vec2<f32>(1.0,1.0),vec2<f32>(-1.0,-1.0),vec2<f32>(1.0,-1.0));
var<private> ch_VertexInputCpy: ch_VertexInput;
var<private> ch_VertexOutputCpy: ch_VertexOutput;
fn chMainStub() {
  let uv: array<vec2<f32>, 4> = array<vec2<f32>, 4>(vec2<f32>(0.0,0.0),vec2<f32>(1.0,0.0),vec2<f32>(0.0,1.0),vec2<f32>(1.0,1.0));
  //ch_VertexOutputCpy.ch_builtin_position = vec4<f32>(coords[ch_VertexInputCpy.ch_builtin_vertexIndex],0.0,1.0);
  ch_VertexOutputCpy.ch_builtin_position = vec4<f32>(vec2<f32>(0.0, 0.0),0.0,1.0);
  ch_VertexOutputCpy.vs_ch_output_outUV = uv[0];
}
@vertex fn main(ch_app_input: ch_VertexInput) -> ch_VertexOutput {
  ch_VertexInputCpy = ch_app_input;
  chMainStub();
  ch_VertexOutputCpy.ch_builtin_position.z = (ch_VertexOutputCpy.ch_builtin_position.z + ch_VertexOutputCpy.ch_builtin_position.w) * 0.5;
  return ch_VertexOutputCpy;
}`;

export const frag = `
struct ch_FragInput {
  @location(0) vs_ch_output_uv: vec2<f32>
};
struct ch_FragOutput {
  @location(0) fs_ch_output_color: vec4<f32>
};
struct ch_generated_struct_name0 {
  linearOutput: i32,
  mode: i32,
  miplevel: f32
};
@group(0) @binding(1) var ch_auto_sampler_tex: sampler;
@group(0) @binding(2) var ch_auto_sampler_tex_comparison: sampler_comparison;
@group(0) @binding(0) var tex: texture_depth_2d;
@group(0) @binding(3) var<uniform> ch_fragment_block_0: ch_generated_struct_name0;
var<private> ch_FragInputCpy: ch_FragInput;
var<private> ch_FragOutputCpy: ch_FragOutput;
fn chMainStub() {
  let c: vec4<f32> = vec4<f32>(textureSampleLevel(tex,ch_auto_sampler_tex,ch_FragInputCpy.vs_ch_output_uv,ch_fragment_block_0.miplevel));
  var rgb: vec3<f32> = c.rgb;
  var a: f32 = c.a;
  var t: f32 = a > 0.0 ? 5.0 : 8.0;
  if (ch_fragment_block_0.mode == 1) {
    a = 1.0;
  }
  else if (ch_fragment_block_0.mode == 2) {
    rgb = rgb.rrr;
    a = 1.0;
  }
  else if (ch_fragment_block_0.mode == 3) {
    rgb = rgb.ggg;
    a = 1.0;
  }
  else if (ch_fragment_block_0.mode == 4) {
    rgb = rgb.bbb;
    a = 1.0;
  }
  else if (ch_fragment_block_0.mode == 5) {
    rgb = vec3<f32>(a);
    a = 1.0;
  }
  if (ch_fragment_block_0.linearOutput != 0) {
    ch_FragOutputCpy.fs_ch_output_color = vec4<f32>(rgb * a,a);
  }
  else  {
    ch_FragOutputCpy.fs_ch_output_color = vec4<f32>(pow(rgb,vec3<f32>(0.45454545454545453)) * a,a);
  }
}
@fragment fn main(ch_app_input: ch_FragInput) -> ch_FragOutput {
  ch_FragInputCpy = ch_app_input;
  chMainStub();
  return ch_FragOutputCpy;
}`;
