import { backendWebGL2 } from '@zephyr3d/backend-webgl';
import { Vector3, Vector4 } from '@zephyr3d/base';
import {
  Scene,
  Application,
  PerspectiveCamera,
  MeshMaterial,
  ShaderHelper,
  OrbitCameraController,
  Mesh,
  TorusShape,
  Tonemap,
  AssetManager,
  applyMaterialMixins,
  DirectionalLight,
  mixinLambert
} from '@zephyr3d/scene';

// 自定义Lambert材质
// 我们需要混入mixinLight组件
class MyLambertMaterial extends applyMaterialMixins(MeshMaterial, mixinLambert) {
  static featureDiffuseTexture = this.defineFeature();
  constructor() {
    super();
    // 漫反射颜色
    this.color = new Vector4(1, 1, 1, 1);
    // 漫反射贴图，该帖图是否存在会生成两个shader变体
    this.diffuseTexture = null;
  }
  // 每次应用之前更新变体值
  apply(ctx) {
    // 有无diffuseTexture形成两个变体
    this.useFeature(MyLambertMaterial.featureDiffuseTexture, !!this.diffuseTexture);
    // 默认实现必须调用
    return super.apply(ctx);
  }
  // 受光照影响
  supportLighting() {
    return true;
  }
  // VertexShader实现
  // 该实现和上一个例子相同
  vertexShader(scope) {
    super.vertexShader(scope);
    const pb = scope.$builder;
    scope.$inputs.pos = pb.vec3().attrib('position');
    scope.$inputs.normal = pb.vec3().attrib('normal');
    scope.$l.oPos = ShaderHelper.resolveVertexPosition(scope);
    scope.$l.oNorm = ShaderHelper.resolveVertexNormal(scope);
    scope.$outputs.worldPos = pb.mul(ShaderHelper.getWorldMatrix(scope), pb.vec4(scope.oPos, 1)).xyz;
    ShaderHelper.setClipSpacePosition(
      scope,
      pb.mul(ShaderHelper.getViewProjectionMatrix(scope), pb.vec4(scope.$outputs.worldPos, 1))
    );
    scope.$outputs.worldNorm = pb.mul(ShaderHelper.getNormalMatrix(scope), pb.vec4(scope.oNorm, 0)).xyz;
    // 变体判断
    if (this.diffuseTexture) {
      scope.$inputs.texcoord = pb.vec2().attrib('texCoord0');
      scope.$outputs.texcoord = scope.$inputs.texcoord;
    }
  }
  // FragmentShader实现
  fragmentShader(scope) {
    super.fragmentShader(scope);
    const pb = scope.$builder;
    if (this.needFragmentColor()) {
      scope.diffuseColor = pb.vec4().uniform(2);
      // 变体判断
      if (this.diffuseTexture) {
        scope.diffuseTexture = pb.tex2D().uniform(2);
      }
      scope.$l.normal = this.calculateNormal(scope, scope.$inputs.worldPos, scope.$inputs.worldNorm);
      scope.$l.viewVec = pb.normalize(pb.sub(ShaderHelper.getCameraPosition(scope), scope.$inputs.worldPos));
      // 变体判断
      if (this.diffuseTexture) {
        scope.$l.diffuse = pb.mul(
          pb.textureSample(scope.diffuseTexture, scope.$inputs.texcoord),
          scope.diffuseColor
        );
      } else {
        scope.$l.diffuse = scope.diffuseColor;
      }
      // 光照计算
      scope.$l.litColor = this.lambertLight(scope, scope.$inputs.worldPos, scope.normal, scope.diffuse);
      // 输出片元颜色
      this.outputFragmentColor(scope, scope.$inputs.worldPos, pb.vec4(scope.litColor, scope.diffuse.a));
    } else {
      // 不需要计算片元颜色则直接输出null
      this.outputFragmentColor(scope, scope.$inputs.worldPos, null);
    }
  }
  // 设置材质的Uniform常量
  applyUniformValues(bindGroup, ctx, pass) {
    super.applyUniformValues(bindGroup, ctx, pass);
    if (this.needFragmentColor(ctx)) {
      bindGroup.setValue('diffuseColor', this.color);
      // 变体判断
      if (this.diffuseTexture) {
        bindGroup.setTexture('diffuseTexture', this.diffuseTexture);
      }
    }
  }
}

const myApp = new Application({
  backend: backendWebGL2,
  canvas: document.querySelector('#my-canvas')
});

myApp.ready().then(async () => {
  const device = myApp.device;

  const scene = new Scene();

  // Creates a directional light
  const light = new DirectionalLight(scene);
  light.lookAt(Vector3.one(), Vector3.zero(), Vector3.axisPY());

  const assetManager = new AssetManager();
  const tex = await assetManager.loadTexture('./assets/images/layer.jpg');
  const material = new MyLambertMaterial();
  material.color.setXYZW(1, 1, 0, 1);
  material.diffuseTexture = tex;
  material.uniformChanged();

  new Mesh(scene, new TorusShape(), material);

  const camera = new PerspectiveCamera(
    scene,
    Math.PI / 3,
    device.getDrawingBufferWidth() / device.getDrawingBufferHeight(),
    1,
    500
  );
  camera.lookAt(new Vector3(25, 15, 0), new Vector3(0, 0, 0), Vector3.axisPY());
  camera.controller = new OrbitCameraController();
  myApp.inputManager.use(camera.handleEvent.bind(camera));

  camera.compositor.appendPostEffect(new Tonemap());

  myApp.on('resize', (width, height) => {
    camera.aspect = width / height;
  });

  myApp.on('keyup', (ev) => {
    if (ev.code === 'Space') {
      if (material.diffuseTexture) {
        material.diffuseTexture = null;
      } else {
        material.diffuseTexture = tex;
      }
    }
  });
  myApp.on('tick', () => {
    camera.updateController();
    camera.render(scene);
  });

  myApp.run();
});
