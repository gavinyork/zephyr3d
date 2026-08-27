import { Vector2, Vector3, Vector4 } from '@zephyr3d/base';
import {
  Scene,
  Application,
  OrbitCameraController,
  PerspectiveCamera,
  Mesh,
  DirectionalLight,
  BoxShape,
  SphereShape,
  TorusShape,
  PlaneShape,
  LambertMaterial,
  FrameResources,
  ForwardPlusModules,
  createForwardPlusPipeline,
  getInput,
  getEngine
} from '@zephyr3d/scene';
import { backendWebGL2 } from '@zephyr3d/backend-webgl';

const myApp = new Application({
  backend: backendWebGL2,
  canvas: document.querySelector('#my-canvas')
});

// ---------------------------------------------------------------------------
// A custom render module that draws depth-discontinuity outlines.
//
// It reads the linear depth buffer produced by the depth prepass, compares each
// pixel against its neighbours, and darkens the scene colour where the depth
// gradient is large. Everything happens inside one graph pass.
// ---------------------------------------------------------------------------

let outlineProgram = null;
let outlineBindGroup = null;
let outlineVertexLayout = null;
let outlineRenderStates = null;

function getOutlineResources() {
  const device = myApp.device;
  if (!outlineProgram) {
    outlineProgram = device.buildRenderProgram({
      vertex(pb) {
        this.$inputs.pos = pb.vec2().attrib('position');
        this.$outputs.uv = pb.vec2();
        pb.main(function () {
          this.$builtins.position = pb.vec4(this.$inputs.pos, 0, 1);
          this.$outputs.uv = pb.add(pb.mul(this.$inputs.pos.xy, 0.5), pb.vec2(0.5));
        });
      },
      fragment(pb) {
        this.sceneColor = pb.tex2D().uniform(0);
        this.linearDepth = pb.tex2D().sampleType('unfilterable-float').uniform(0);
        this.texelSize = pb.vec2().uniform(0);
        this.outlineColor = pb.vec3().uniform(0);
        this.threshold = pb.float().uniform(0);
        this.$outputs.outColor = pb.vec4();
        pb.main(function () {
          this.$l.color = pb.textureSample(this.sceneColor, this.$inputs.uv);
          // Sample linear depth in a plus-shaped neighbourhood.
          this.$l.dc = pb.textureSampleLevel(this.linearDepth, this.$inputs.uv, 0).r;
          this.$l.dl = pb.textureSampleLevel(
            this.linearDepth,
            pb.sub(this.$inputs.uv, pb.vec2(this.texelSize.x, 0)),
            0
          ).r;
          this.$l.dr = pb.textureSampleLevel(
            this.linearDepth,
            pb.add(this.$inputs.uv, pb.vec2(this.texelSize.x, 0)),
            0
          ).r;
          this.$l.du = pb.textureSampleLevel(
            this.linearDepth,
            pb.sub(this.$inputs.uv, pb.vec2(0, this.texelSize.y)),
            0
          ).r;
          this.$l.dd = pb.textureSampleLevel(
            this.linearDepth,
            pb.add(this.$inputs.uv, pb.vec2(0, this.texelSize.y)),
            0
          ).r;
          // Largest relative difference to any neighbour.
          this.$l.diff = pb.max(
            pb.max(pb.abs(pb.sub(this.dc, this.dl)), pb.abs(pb.sub(this.dc, this.dr))),
            pb.max(pb.abs(pb.sub(this.dc, this.du)), pb.abs(pb.sub(this.dc, this.dd)))
          );
          this.$l.rel = pb.div(this.diff, pb.max(this.dc, 0.0001));
          this.$l.edge = pb.clamp(pb.div(this.rel, pb.max(this.threshold, 0.0001)), 0, 1);
          this.$outputs.outColor = pb.vec4(
            pb.mix(this.color.rgb, this.outlineColor, this.edge),
            this.color.a
          );
        });
      }
    });
    outlineProgram.name = 'MyOutlinePass';
    outlineBindGroup = device.createBindGroup(outlineProgram.bindGroupLayouts[0]);
    outlineVertexLayout = device.createVertexLayout({
      vertexBuffers: [
        {
          buffer: device.createVertexBuffer('position_f32x2', new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]))
        }
      ]
    });
    outlineRenderStates = device.createRenderStateSet();
    outlineRenderStates.useDepthState().enableTest(false).enableWrite(false);
    outlineRenderStates.useRasterizerState().setCullMode('none');
  }
  return { outlineProgram, outlineBindGroup, outlineVertexLayout, outlineRenderStates };
}

const outlineModule = {
  // Stable identifier; must be unique within a pipeline.
  type: 'MyOutline',
  // Declare what we touch so the graph can order us correctly.
  reads: [
    { resource: FrameResources.SceneColor, version: 'current' },
    { resource: FrameResources.LinearDepth }
  ],
  writes: [FrameResources.SceneColor],

  // Per-frame feature decision. Module ordering happens before setup(),
  // so the enable/disable test belongs here.
  prepare() {
    return { enabled: true };
  },

  setup(fg) {
    const { graph, ctx, blackboard } = fg;
    const sceneColor = blackboard.expect(FrameResources.SceneColor);
    // LinearDepth is always published by the depth prepass, but read it
    // defensively so the module degrades instead of throwing.
    const linearDepth = blackboard.get(FrameResources.LinearDepth);
    if (!linearDepth) {
      return;
    }

    // addPass returns whatever the build callback returns.
    const out = graph.addPass('MyOutline', (builder) => {
      builder.read(linearDepth);
      builder.read(sceneColor);
      // Allocate a separate destination instead of writing sceneColor in place.
      // A pass cannot sample a texture it is also rendering into: builder.write()
      // yields a new version handle but still aliases the same physical texture,
      // which the driver rejects as a feedback loop.
      const written = builder.createTexture({
        format: ctx.colorFormat,
        label: 'outlineColor',
        allocationKey: 'MyOutline.Color'
      });

      builder.setExecute((rgCtx) => {
        const device = ctx.device;
        const srcColor = rgCtx.getTexture(sceneColor);
        const depthTex = rgCtx.getTexture(linearDepth);
        const dstColor = rgCtx.getTexture(written);
        const res = getOutlineResources();

        // Draw into a temporary framebuffer wrapping our own output texture.
        const fb = rgCtx.createFramebuffer({ colorAttachments: [written] });
        device.pushDeviceStates();
        device.setFramebuffer(fb);
        res.outlineBindGroup.setTexture('sceneColor', srcColor);
        res.outlineBindGroup.setTexture('linearDepth', depthTex);
        res.outlineBindGroup.setValue(
          'texelSize',
          new Vector2(1 / dstColor.width, 1 / dstColor.height)
        );
        res.outlineBindGroup.setValue('outlineColor', new Vector3(0, 0, 0));
        res.outlineBindGroup.setValue('threshold', 0.04);
        device.setProgram(res.outlineProgram);
        device.setBindGroup(0, res.outlineBindGroup);
        device.setVertexLayout(res.outlineVertexLayout);
        device.setRenderStates(res.outlineRenderStates);
        device.draw('triangle-strip', 0, 4);
        device.popDeviceStates();
      });

      return written;
    });

    // Publish the new version so downstream modules see our output.
    blackboard.set(FrameResources.SceneColor, out);
  }
};

myApp.ready().then(function () {
  const scene = new Scene();
  scene.env.light.strength = 0.4;

  const light = new DirectionalLight(scene);
  light.rotation.fromEulerAngle(-Math.PI / 4, Math.PI / 4, 0);

  // Floor
  const floorMaterial = new LambertMaterial();
  floorMaterial.albedoColor = new Vector4(0.7, 0.7, 0.72, 1);
  const floor = new Mesh(scene, new PlaneShape({ size: 60 }), floorMaterial);
  floor.position.setXYZ(-30, -6, -30);

  // A few overlapping shapes so depth edges are easy to see
  const shapeMaterial = new LambertMaterial();
  shapeMaterial.albedoColor = new Vector4(0.85, 0.5, 0.25, 1);
  const box = new Mesh(scene, new BoxShape({ size: 6 }), shapeMaterial);
  box.position.setXYZ(-7, -3, 0);
  const sphere = new Mesh(scene, new SphereShape({ radius: 4 }), shapeMaterial);
  sphere.position.setXYZ(1, -2, 3);
  const torus = new Mesh(scene, new TorusShape(), shapeMaterial);
  torus.scale.setXYZ(3, 3, 3);
  torus.position.setXYZ(8, 0, -2);

  scene.mainCamera = new PerspectiveCamera(scene, Math.PI / 3, 1, 200);
  scene.mainCamera.lookAt(new Vector3(0, 8, 26), Vector3.zero(), Vector3.axisPY());
  scene.mainCamera.controller = new OrbitCameraController();
  getInput().use(scene.mainCamera.handleEvent, scene.mainCamera);

  // Build a pipeline of our own and insert the module right after the main
  // lighting pass, so it runs before sky and fog are composited.
  // Passing the module object (not the string 'LightPass') is the safer form.
  const pipelineWithOutline = createForwardPlusPipeline().insertAfter(
    ForwardPlusModules.LightPass,
    outlineModule
  );

  scene.mainCamera.renderPipeline = pipelineWithOutline;

  const btnOff = document.querySelector('#btn-off');
  const btnOn = document.querySelector('#btn-on');
  function select(on) {
    // null falls back to the shared default pipeline, which has no outline pass.
    scene.mainCamera.renderPipeline = on ? pipelineWithOutline : null;
    btnOn.classList.toggle('active', on);
    btnOff.classList.toggle('active', !on);
  }
  btnOn.addEventListener('click', () => select(true));
  btnOff.addEventListener('click', () => select(false));
  select(true);

  getEngine().setRenderable(scene, 0);

  myApp.run();
});
