import { Vector3 } from '@zephyr3d/base';
import type {
  Texture2D,
  BindGroup,
  GPUProgram,
  RenderStateSet,
  TextureCube,
  VertexLayout
} from '@zephyr3d/device';
import { gammaToLinear } from '../shaders/misc';
import { getDevice } from '../app/api';

let vertexLayout: VertexLayout = null;
let renderStates: RenderStateSet = null;
let panoramaToCubemapProgram: GPUProgram = null;
let panoramaToCubemapBindGroup: BindGroup = null;
let panoramaToCubemapProgramRGBM: GPUProgram = null;
let panoramaToCubemapBindGroupRGBM: BindGroup = null;
const faceDirections = [
  [new Vector3(0, 0, -1), new Vector3(0, -1, 0), new Vector3(1, 0, 0)],
  [new Vector3(0, 0, 1), new Vector3(0, -1, 0), new Vector3(-1, 0, 0)],
  [new Vector3(1, 0, 0), new Vector3(0, 0, 1), new Vector3(0, 1, 0)],
  [new Vector3(1, 0, 0), new Vector3(0, 0, -1), new Vector3(0, -1, 0)],
  [new Vector3(1, 0, 0), new Vector3(0, -1, 0), new Vector3(0, 0, 1)],
  [new Vector3(-1, 0, 0), new Vector3(0, -1, 0), new Vector3(0, 0, -1)]
];

function init() {
  const device = getDevice();
  const vertices = new Float32Array([1, 1, -1, 1, -1, -1, 1, -1]);
  const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);
  vertexLayout = device.createVertexLayout({
    vertexBuffers: [
      {
        buffer: device.createVertexBuffer('position_f32x2', vertices)
      }
    ],
    indexBuffer: device.createIndexBuffer(indices)
  });
  renderStates = device.createRenderStateSet();
  renderStates.useRasterizerState().setCullMode('none');
  renderStates.useDepthState().enableTest(false).enableWrite(false);
  panoramaToCubemapProgram = createPanoramaToCubemapProgram(false);
  panoramaToCubemapBindGroup = device.createBindGroup(panoramaToCubemapProgram.bindGroupLayouts[0]);
  panoramaToCubemapProgramRGBM = createPanoramaToCubemapProgram(true);
  panoramaToCubemapBindGroupRGBM = device.createBindGroup(panoramaToCubemapProgramRGBM.bindGroupLayouts[0]);
}

function createPanoramaToCubemapProgram(rgbm: boolean): GPUProgram {
  const device = getDevice();
  const pb = device;
  const program = pb.buildRenderProgram({
    vertex(pb) {
      this.$inputs.pos = pb.vec2().attrib('position');
      this.up = pb.vec3().uniform(0);
      this.right = pb.vec3().uniform(0);
      this.front = pb.vec3().uniform(0);
      pb.main(function () {
        this.$builtins.position = pb.vec4(this.$inputs.pos, 0, 1);
        this.$outputs.direction = pb.mul(
          pb.mat3(this.up, this.right, this.front),
          pb.vec3(this.$inputs.pos, 1)
        );
        if (pb.getDevice().type === 'webgpu') {
          this.$builtins.position.y = pb.neg(this.$builtins.position.y);
        }
      });
    },
    fragment(pb) {
      this.u_panoramaTexture = pb.tex2D().uniform(0);
      this.$outputs.outcolor = pb.vec4();
      pb.func('dirToUV', [pb.vec3('dir')], function () {
        this.$l.x = pb.add(0.5, pb.div(pb.atan2(this.dir.z, this.dir.x), 2 * Math.PI));
        this.$l.y = pb.div(pb.acos(this.dir.y), Math.PI);
        this.$return(pb.vec2(this.x, this.y));
      });
      pb.main(function () {
        this.$l.uv = this.dirToUV(pb.normalize(this.$inputs.direction));
        this.$l.color = pb.textureSampleLevel(this.u_panoramaTexture, this.uv, 0);
        if (rgbm) {
          this.$l.rgb = pb.mul(this.color.rgb, this.color.a, 6);
          this.rgb = gammaToLinear(this, this.rgb);
          this.$outputs.outcolor = pb.vec4(this.rgb, 1);
        } else {
          this.$outputs.outcolor = pb.vec4(this.color.rgb, 1);
        }
      });
    }
  });
  program.name = rgbm ? '@PanoramaToCubemap_RGBM' : '@PanoramaToCubemap';
  return program;
}

function doConvertPanoramaToCubemap(srcTexture: Texture2D, dstTexture: TextureCube) {
  const device = getDevice();
  const rgbm = srcTexture.format === 'rgba8unorm';
  const program = rgbm ? panoramaToCubemapProgramRGBM : panoramaToCubemapProgram;
  const bindgroup = rgbm ? panoramaToCubemapBindGroupRGBM : panoramaToCubemapBindGroup;
  const framebuffer = device.createFrameBuffer([dstTexture], null);
  device.pushDeviceStates();
  device.setFramebuffer(framebuffer);
  for (let i = 0; i < 6; i++) {
    framebuffer.setColorAttachmentCubeFace(0, i);
    device.setVertexLayout(vertexLayout);
    device.setRenderStates(renderStates);
    device.setProgram(program);
    device.setBindGroup(0, bindgroup);
    bindgroup.setValue('up', faceDirections[i][0]);
    bindgroup.setValue('right', faceDirections[i][1]);
    bindgroup.setValue('front', faceDirections[i][2]);
    bindgroup.setTexture('u_panoramaTexture', srcTexture);
    device.draw('triangle-list', 0, 6);
  }
  device.popDeviceStates();
}

/**
 * Converts an equirectangular image to cubemap
 *
 * @param tex - The equirectangular image to be converted
 * @param textureSize - cubemap size
 * @returns The converted cubemap
 *
 * @public
 */
export function panoramaToCubemap(tex: Texture2D, outputCubeMap: TextureCube): void {
  const device = getDevice();
  if (!vertexLayout) {
    init();
  }
  device.pushDeviceStates();
  doConvertPanoramaToCubemap(tex, outputCubeMap);
  device.popDeviceStates();
}
