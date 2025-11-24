import { backendWebGL2 } from '@zephyr3d/backend-webgl';
import { Vector3 } from '@zephyr3d/base';
import {
  Scene,
  Application,
  PerspectiveCamera,
  MeshMaterial,
  ShaderHelper,
  OrbitCameraController,
  Mesh,
  TorusShape,
  getInput,
  getEngine
} from '@zephyr3d/scene';

// 定义边缘光材质
class RimColorMaterial extends MeshMaterial {
  constructor() {
    super();
    // 边缘光的颜色
    this.color = new Vector3(1, 1, 1);
  }
  // 不透明材质
  isTransparentPass() {
    return false;
  }
  // 不受光照影响
  supportLighting() {
    return false;
  }
  // VertexShader实现
  // scope是vertexShader的main函数作用域
  vertexShader(scope) {
    // 必须调用父类的vertexShader方法
    // 父类vertexShader负责初始化全局uniform参数以及在必要的情况下定义骨骼动画相关顶点属性。
    super.vertexShader(scope);
    const pb = scope.$builder;
    // 定义顶点位置输入
    // 如果使用了ShaderHelper.resolveVertexPosition()函数，这一行可以省略。
    scope.$inputs.pos = pb.vec3().attrib('position');
    // 定义顶点法线输入
    // 如果使用了ShaderHelper.resolveVertexNormal()函数，这一行可以省略。
    scope.$inputs.normal = pb.vec3().attrib('normal');
    // ShaderHelper.resolveVertexPosition()函数用于计算局部坐标系的顶点位置。
    // 如果有骨骼动画，该函数计算经过骨骼运算后的顶点位置，否则返回输入的顶点位置。
    scope.$l.oPos = ShaderHelper.resolveVertexPosition(scope);
    // ShaderHelper.resolveVertexNormal()函数用于计算局部坐标系的顶点法线。
    // 如果有骨骼动画，该函数计算经过骨骼运算后的顶点法线，否则返回输入的顶点法线。
    scope.$l.oNorm = ShaderHelper.resolveVertexNormal(scope);
    // 计算世界坐标系的顶点位置并输出到fragmentShader
    // ShaderHelper.getWorldMatrix()函数用于获取当前的局部到世界的位置变换矩阵
    // scope.$outputs作用域用于定义varying变量。
    scope.$outputs.worldPos = pb.mul(ShaderHelper.getWorldMatrix(scope), pb.vec4(scope.oPos, 1)).xyz;
    // 计算世界坐标系的顶点法线向量并输出到fragmentShader
    // ShaderHelper.getNormalMatrix()函数用于获取当前的局部到世界的法线变换矩阵
    scope.$outputs.worldNorm = pb.mul(ShaderHelper.getNormalMatrix(scope), pb.vec4(scope.oNorm, 0)).xyz;
    // 输出剪裁空间的顶点坐标
    // ShaderHelper.getViewProjectionMatrix()获取当前的世界空间到剪裁空间的变换矩阵。
    // 注意不要直接给scope.$builtins.position赋值，因为在WebGPU设备下渲染到纹理时需要上下翻转
    // 需要使用ShaderHelper.setClipSpacePosition()方法。
    ShaderHelper.setClipSpacePosition(
      scope,
      pb.mul(ShaderHelper.getViewProjectionMatrix(scope), pb.vec4(scope.$outputs.worldPos, 1))
    );
  }
  // FragmentShader实现
  // scope是fragmentShader的main函数作用域
  fragmentShader(scope) {
    // 必须调用父类的fragmentShader方法
    // 父类fragmentShader负责初始化全局uniform参数
    super.fragmentShader(scope);
    const pb = scope.$builder;
    // MeshMaterial的needFragmentColor()函数返回当前Shader是否需要计算片元颜色。
    // 如果当前的RenderPass是DepthPass或ShadowMapPass且材质alphaCutoff属性等于0(未开启AlphaTest)，则无需计算片元颜色。
    if (this.needFragmentColor()) {
      // 定义一个vec3类型的uniform用于指定边缘光颜色
      // 注意：用于材质的uniform，对应的BindGroup索引
      // 为2。
      scope.rimColor = pb.vec3().uniform(2);
      // 计算视线向量
      // ShaderHelper.getCameraPosition()函数用于获取当前摄像机的世界坐标系位置。
      // scope.$inputs作用域保存由vertexShader传来的varying变量。
      scope.$l.viewVec = pb.normalize(pb.sub(ShaderHelper.getCameraPosition(scope), scope.$inputs.worldPos));
      // 计算NdotV，值越小边缘光越亮
      scope.$l.NdotV = pb.clamp(pb.dot(pb.normalize(scope.$inputs.worldNorm), scope.viewVec), 0, 1);
      // 计算最终的片元颜色
      scope.$l.finalColor = pb.mul(scope.rimColor, pb.pow(pb.sub(1, scope.NdotV), 4));
      // 输出片元颜色
      // 材质的outputFragmentColor()方法用于输出片元颜色。该方法执行剪裁平面测试(如果定义了剪裁平面),
      // AlphaTest测试(如果材质的alphaCutoff大于0)，根据是否半透明材质处理片元的alpha通道，
      // 在需要的情况下执行sRGB颜色空间转换。
      this.outputFragmentColor(scope, scope.$inputs.worldPos, pb.vec4(scope.finalColor, 1));
    } else {
      // 不需要计算片元颜色则直接输出null
      this.outputFragmentColor(scope, scope.$inputs.worldPos, null);
    }
  }
  // 设置材质的Uniform常量
  applyUniformValues(bindGroup, ctx, pass) {
    // 必须调用父类
    super.applyUniformValues(bindGroup, ctx, pass);
    if (this.needFragmentColor(ctx)) {
      // 需要计算片元颜色时我们才定义此Uniform
      bindGroup.setValue('rimColor', this.color);
    }
  }
}

const myApp = new Application({
  backend: backendWebGL2,
  canvas: document.querySelector('#my-canvas')
});

myApp.ready().then(async () => {
  const scene = new Scene();
  scene.env.sky.skyType = 'scatter';
  const material = new RimColorMaterial();
  material.color.setXYZ(1, 1, 0);
  material.uniformChanged();

  new Mesh(scene, new TorusShape(), material);

  scene.mainCamera = new PerspectiveCamera(scene, Math.PI / 3, 1, 500);
  scene.mainCamera.lookAt(new Vector3(5, 3, 0), new Vector3(0, 0, 0), Vector3.axisPY());
  scene.mainCamera.controller = new OrbitCameraController();
  getInput().use(scene.mainCamera.handleEvent, scene.mainCamera);

  getEngine().setRenderable(scene, 0);

  myApp.run();
});
