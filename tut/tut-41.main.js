import { backendWebGL2 } from '@zephyr3d/backend-webgl';
import { Vector3, Vector4 } from '@zephyr3d/base';
import { Scene, Application, PerspectiveCamera, MeshMaterial, ShaderHelper, OrbitCameraController, Mesh, TorusShape, Compositor, Tonemap, AssetManager, applyMaterialMixins, DirectionalLight, mixinLight } from '@zephyr3d/scene';

// 自定义Lambert材质
// 我们需要混入mixinLight组件
class MyLambertMaterial extends applyMaterialMixins(MeshMaterial, mixinLight) {
  constructor() {
    super();
    // 漫反射颜色
    this.color = new Vector4(1, 1, 1, 1);
    // 漫反射贴图
    this.diffuseTexture = null;
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
    scope.$inputs.texcoord = pb.vec2().attrib('texCoord0');
    scope.$l.oPos = ShaderHelper.resolveVertexPosition(scope);
    scope.$l.oNorm = ShaderHelper.resolveVertexNormal(scope);
    scope.$outputs.worldPos = pb.mul(ShaderHelper.getWorldMatrix(scope), pb.vec4(scope.oPos, 1)).xyz;
    scope.$outputs.worldNorm = pb.mul(ShaderHelper.getNormalMatrix(scope), pb.vec4(scope.oNorm, 0)).xyz;
    scope.$outputs.texcoord = scope.$inputs.texcoord;
    ShaderHelper.setClipSpacePosition(scope, pb.mul(ShaderHelper.getViewProjectionMatrix(scope), pb.vec4(scope.$outputs.worldPos, 1)));
  }
  // FragmentShader实现
  fragmentShader(scope) {
    super.fragmentShader(scope);
    const pb = scope.$builder;
    if (this.needFragmentColor()) {
      scope.diffuseColor = pb.vec4().uniform(2);
      scope.diffuseTexture = pb.tex2D().uniform(2);
      scope.$l.normal = this.calculateNormal(scope, scope.$inputs.worldPos, scope.$inputs.worldNorm);
      scope.$l.viewVec = pb.normalize(pb.sub(ShaderHelper.getCameraPosition(scope), scope.$inputs.worldPos));
      scope.$l.diffuseColor = pb.mul(pb.textureSample(scope.diffuseTexture, scope.$inputs.texcoord), scope.diffuseColor);

      //////// 此处与上一个例子不同，这里需要自行计算光照

      // 定义变量存储光照贡献
      scope.$l.litColor = pb.vec3(0);
      // needCalculateEnvLight()是mixinLight组件引入的方法，用于查询当前是否需要渲染间接光照。
      // 如果有光源投射阴影，那么光照需要渲染多个Pass，我们只在第一个Pass渲染环境光。
      if (this.needCalculateEnvLight()) {
        // 需要渲染间接光照
        // 利用mixinLight组件提供的getEnvLightIrradiance()方法获取环境光辐照度(irradiance)
        // 在此我们忽略环境光的辐射度(radiance)
        scope.litColor = this.getEnvLightIrradiance(scope, scope.normal);
      }
      // 调用mixinLight组件提供的forEachLight()方法遍历影响本片元的所有光源
      // 第二个参数是一个回调函数，this指向当前的shader作用域。参数如下：
      // type(int): 光源类型，取值为LIGHT_TYPE_DIRECTIONAL, LIGHT_TYPE_POINT或LIGHT_TYPE_SPOT
      // posRange(vec4): xyz分量光源世界坐标，w分量光源范围(vec4)
      // dirCutoff(vec4): xyz分量光源照射方向，w分量锥光衰减系数(vec4)
      // colorIntensity(vec4): xyz分量光源颜色，w分量光的强度
      // shadow(bool): 此光源是否投射阴影
      const that = this;
      this.forEachLight(scope, function(type, posRange, dirCutoff, colorIntensity, shadow){
        // 计算光线衰减
        this.$l.lightAtten = that.calculateLightAttenuation(this, type, this.$inputs.worldPos, posRange, dirCutoff);
        // 计算片元到光源的方向
        this.$l.lightDir = that.calculateLightDirection(this, type, this.$inputs.worldPos, posRange, dirCutoff);
        // 经过衰减的光源颜色
        this.$l.lightColor = pb.mul(colorIntensity.rgb, colorIntensity.a, this.lightAtten);
        // Lambert光照模型
        this.$l.NoL = pb.clamp(pb.dot(this.normal, this.lightDir), 0, 1);
        this.$l.diffuse = pb.mul(this.lightColor, this.NoL);
        // 如果光线投射阴影则需要计算阴影
        if (shadow) {
          this.$l.shadow = pb.vec3(that.calculateShadow(this, this.$inputs.worldPos, this.NoL));
          this.diffuse = pb.mul(this.diffuse, this.shadow);
        }
        // 累积该光源的贡献
        this.litColor = pb.add(this.litColor, this.diffuse);
      });
      // 计算最终的光照颜色
      scope.$l.finalColor = pb.mul(pb.vec4(scope.litColor, 1), scope.diffuseColor);
      // 输出片元颜色
      this.outputFragmentColor(scope, scope.$inputs.worldPos, scope.finalColor);
    } else {
      // 不需要计算片元颜色则直接输出null
      this.outputFragmentColor(scope, scope.$inputs.worldPos, null);
    }
  }
  // 设置材质的Uniform常量
  applyUniformValues(bindGroup, ctx, pass){
    // 必须调用父类
    super.applyUniformValues(bindGroup, ctx, pass);
    if (this.needFragmentColor(ctx)){
      // 漫反射颜色
      bindGroup.setValue('diffuseColor', this.color);
      // 漫反射贴图（不可以是null）
      bindGroup.setTexture('diffuseTexture', this.diffuseTexture)
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
  const material = new MyLambertMaterial();
  material.color.setXYZW(1, 1, 0, 1);
  material.diffuseTexture = await assetManager.loadTexture('./assets/images/layer.jpg');
  material.uniformChanged();

  new Mesh(scene, new TorusShape(), material);

  const camera = new PerspectiveCamera(scene, Math.PI/3, device.getDrawingBufferWidth() / device.getDrawingBufferHeight(), 1, 500);
  camera.lookAt(new Vector3(25, 15, 0), new Vector3(0, 0, 0), Vector3.axisPY());
  camera.controller = new OrbitCameraController();
  myApp.inputManager.use(camera.handleEvent.bind(camera));

  const compositor = new Compositor();
  compositor.appendPostEffect(new Tonemap());

  myApp.on('resize', ev => {
    camera.aspect = ev.width / ev.height;
  });

  myApp.on('tick', ev => {
    camera.updateController();
    camera.render(scene, compositor);
  });

  myApp.run();
});
