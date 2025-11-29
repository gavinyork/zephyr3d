import type { AbstractDevice, GPUProgram } from '@zephyr3d/device';
import { ProgramBuilder } from '@zephyr3d/device';
import { backendWebGL1, backendWebGL2 } from '@zephyr3d/backend-webgl';
import { backendWebGPU } from '@zephyr3d/backend-webgpu';

const defaultVS = `this.$inputs.pos = pb.vec3().attrib('position');
this.$inputs.uv = pb.vec2().attrib('texCoord0');
this.$outputs.uv = pb.vec2();
this.xform = pb.defineStruct([pb.mat4('mvpMatrix')])().uniform(0);
pb.main(function(){
  this.$builtins.position = pb.mul(this.xform.mvpMatrix, pb.vec4(this.$inputs.pos, 1));
  this.$outputs.uv = this.$inputs.uv;
});`;
const defaultFS = `this.$outputs.color = pb.vec4();
this.tex = pb.tex2D().uniform(0);
pb.main(function(){
  this.$outputs.color = pb.textureSample(this.tex, this.$inputs.uv);
});`;
const defaultCS = `const structParams = pb.defineStruct([pb.uint('filterDim'), pb.uint('blockDim')]);
const structFlip = pb.defineStruct([pb.uint('value')]);
this.params = structParams().uniform(0);
this.inputTex = pb.tex2D().uniform(1);
this.outputTex = pb.texStorage2D.rgba8unorm().uniform(1);
this.flip = structFlip().uniform(1);
this.tile = pb.vec3[128][4]().workgroup();
pb.main(function(){
  this.filterOffset = pb.div(pb.sub(this.params.filterDim,1),2);
  this.dims = pb.textureDimensions(this.inputTex, 0);
  this.baseIndex = pb.sub(pb.ivec2(pb.add(pb.mul(this.$builtins.workGroupId.xy, pb.uvec2(this.params.blockDim, 4)), pb.mul(this.$builtins.localInvocationId.xy, pb.uvec2(4,1)))), pb.ivec2(pb.int(this.filterOffset), 0));
  this.$for(pb.uint('r'), 0, 4, function(){
    this.$for(pb.uint('c'), 0, 4, function(){
      this.loadIndex = pb.add(this.baseIndex, pb.ivec2(pb.int(this.c), pb.int(this.r)));
      this.$if(pb.notEqual(this.flip.value, 0), function(){
        this.loadIndex = this.loadIndex.yx;
      });
      this.tile.at(this.r).setAt(pb.add(pb.mul(4, this.$builtins.localInvocationId.x), this.c), pb.textureSampleLevel(this.inputTex, pb.div(pb.add(pb.vec2(this.loadIndex), pb.vec2(0.25, 0.25)), pb.vec2(this.dims)), 0).xyz);
    });
  });
  pb.workgroupBarrier();
  this.$for(pb.uint('r'), 0, 4, function(){
    this.$for(pb.uint('c'), 0, 4, function(){
      this.writeIndex = pb.add(this.baseIndex, pb.ivec2(pb.int(this.c), pb.int(this.r)));
      this.$if(pb.notEqual(this.flip.value, 0), function(){
        this.writeIndex = this.writeIndex.yx;
      });
      this.center = pb.add(pb.mul(4, this.$builtins.localInvocationId.x), this.c);
      this.$if(pb.and(pb.and(pb.greaterThanEqual(this.center, this.filterOffset), pb.lessThan(this.center, pb.sub(128, this.filterOffset))), pb.all(pb.lessThan(this.writeIndex, this.dims))), function(){
        this.acc = pb.vec3(0, 0, 0);
        this.$for(pb.uint('f'), 0, this.params.filterDim, function(){
          this.i = pb.sub(pb.add(this.center, this.f), this.filterOffset);
          this.acc = pb.add(this.acc, pb.mul(pb.div(1, pb.float(this.params.filterDim)), this.tile.at(this.r).at(this.i)));
        });
        pb.textureStore(this.outputTex, this.writeIndex, pb.vec4(this.acc, 1));
      });
    });
  });
});`;
(async function () {
  const selectDeviceType = document.querySelector<HTMLSelectElement>('#device-type');
  const buttonReset = document.querySelector<HTMLButtonElement>('#reset-code');
  const buttonRun = document.querySelector<HTMLButtonElement>('#run-code');
  const workgroupSize = document.querySelector<HTMLDivElement>('#workgroup-size');
  const workgroupX = document.querySelector<HTMLInputElement>('#workgroup-x');
  const workgroupY = document.querySelector<HTMLInputElement>('#workgroup-y');
  const workgroupZ = document.querySelector<HTMLInputElement>('#workgroup-z');
  const vscode = document.querySelector<HTMLTextAreaElement>('#vscode');
  const fscode = document.querySelector<HTMLTextAreaElement>('#fscode');
  const vertexId = document.querySelector<HTMLLabelElement>('#vertex-id');
  const fragmentId = document.querySelector<HTMLLabelElement>('#fragment-id');
  const vertexShaderId = document.querySelector<HTMLLabelElement>('#vertexshader-id');
  const fragmentShaderId = document.querySelector<HTMLLabelElement>('#fragmentshader-id');
  const vsgenerated = document.querySelector<HTMLTextAreaElement>('#vertexshader-generated');
  const fsgenerated = document.querySelector<HTMLTextAreaElement>('#fragmentshader-generated');
  const bg = document.querySelector<HTMLTextAreaElement>('#bindgroups');
  const devices: Record<string, AbstractDevice> = {};
  if (backendWebGL1.supported()) {
    const cvs = document.createElement('canvas');
    cvs.style.width = '1px';
    cvs.style.height = '1px';
    //cvs.style.display = 'none';
    document.body.append(cvs);
    devices.webgl = await backendWebGL1.createDevice(cvs);
  }
  if (backendWebGL2.supported()) {
    const cvs = document.createElement('canvas');
    cvs.style.width = '1px';
    cvs.style.height = '1px';
    //cvs.style.display = 'none';
    document.body.append(cvs);
    devices.webgl2 = await backendWebGL2.createDevice(cvs);
  }
  if (backendWebGPU.supported()) {
    const cvs = document.createElement('canvas');
    cvs.style.width = '1px';
    cvs.style.height = '1px';
    //cvs.style.display = 'none';
    document.body.append(cvs);
    devices.webgpu = await backendWebGPU.createDevice(cvs);
  }
  function reset(resetSource: boolean) {
    const isCompute = selectDeviceType.selectedIndex === 3;
    workgroupSize.style.display = isCompute ? '' : 'none';
    if (resetSource) {
      vscode.value = isCompute ? defaultCS : defaultVS;
      fscode.value = isCompute ? '' : defaultFS;
    }
    vertexId.innerText = isCompute ? 'compute:' : 'vertex';
    fragmentId.style.display = isCompute ? 'none' : '';
    fscode.style.display = isCompute ? 'none' : '';
    vertexShaderId.innerText = isCompute ? 'compute shader:' : 'vertex shader:';
    fragmentShaderId.style.display = isCompute ? 'none' : '';
    fsgenerated.style.display = isCompute ? 'none' : '';
    vsgenerated.value = '';
    fsgenerated.value = '';
    bg.value = '';
    workgroupX.value = '1';
    workgroupY.value = '1';
    workgroupZ.value = '1';
  }
  buttonReset.addEventListener('click', function () {
    reset(true);
  });
  selectDeviceType.addEventListener('change', function () {
    reset(false);
  });
  buttonRun.addEventListener('click', function () {
    const deviceType = document.querySelector<HTMLSelectElement>('#device-type').value;
    const pb = new ProgramBuilder(devices[deviceType]);
    pb.emulateDepthClamp = false;
    try {
      const isCompute = selectDeviceType.selectedIndex === 3;
      const src = isCompute
        ? `return pb.buildCompute({workgroupSize:[${workgroupX.value},${workgroupY.value},${workgroupZ.value}],compute(pb){${vscode.value}}});`
        : `return pb.buildRender({vertex(pb){${vscode.value}},fragment(pb){${fscode.value}}});`;
      const fn = new Function('pb', src);
      const ret = fn(pb) as any;
      if (ret) {
        if (isCompute) {
          vsgenerated.value = ret[0];
        } else {
          vsgenerated.value = ret[0];
          fsgenerated.value = ret[1];
        }
        let program: GPUProgram;
        if (isCompute) {
          program = devices[deviceType].createGPUProgram({
            type: 'compute',
            params: {
              source: ret[0],
              bindGroupLayouts: ret[1]
            }
          });
        } else {
          program = devices[deviceType].createGPUProgram({
            type: 'render',
            params: {
              vs: ret[0],
              fs: ret[1],
              bindGroupLayouts: ret[2],
              vertexAttributes: ret[3]
            }
          });
        }
        const error = program.getCompileError();
        if (error) {
          console.error(error);
          alert(error);
        } else {
          bg.value = JSON.stringify(program.bindGroupLayouts, null, 2);
          program.use();
        }
      } else {
        console.error(pb.lastError);
        vsgenerated.value = pb.lastError;
      }
    } catch (err) {
      console.error(err);
      alert(`${err}\n${pb.lastError}`);
    }
  });
  reset(true);
})();
