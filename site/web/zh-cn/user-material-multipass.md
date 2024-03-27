# 多遍材质

多遍材质允许通过多次渲染同一物体来逐步构建出最终的视觉效果。每一次渲染可以使用不同的Shader。

引擎材质系统支持使用单一材质对物体进行多遍渲染，只需要设置材质的numPasses属性。

在下面的例子中，我们用多遍材质实现一个简单的卡通效果。物体一共渲染两遍：
第一遍：将物体沿法线方向略微扩张，用描边颜色渲染物体的背面，模拟描边效果。
第二遍：正常渲染物体，将连续的光照量化为几个区域，模拟卡通着色效果。

```javascript

// 光照基于Lambert光照模型
class CartoonMaterial extends applyMaterialMixins(MeshMaterial, mixinLambert) {
  constructor() {
    super();
    // 色彩量化级数
    this.bands = 3;
    // 描边的宽度
    this.edgeThickness = 0.3;
    // 物体的颜色
    this.color = new Vector4(1, 1, 1, 1);
    // 物体描边颜色
    this.edgeColor = new Vector4(0, 0, 0, 1);
    // 材质需要进行两遍渲染
    this.numPasses = 2;
  }
  // 重写此方法自定义每个Pass的渲染状态
  updateRenderStates(pass, ctx) {
    // 必须调用默认实现
    super.updateRenderStates(pass, ctx);
    // 第一遍剔除正面，第二遍剔除背面
    this.getRenderStateSet(pass).useRasterizerState().cullMode = pass === 0 ? 'front' : 'back';
  }
  // 提交Uniform常量
  applyUniformValues(bindGroup, ctx, pass) {
    super.applyUniformValues(bindGroup, ctx, pass);
    if (this.needFragmentColor(ctx)){
      if (pass > 0) {
        bindGroup.setValue('albedoColor', this.color);
        bindGroup.setValue('bands', this.bands);
      } else {
        bindGroup.setValue('edge', this.edgeThickness);
        bindGroup.setValue('edgeColor', this.edgeColor);
      }
    }
  }
  // VertexShader实现
  vertexShader(scope) {
    super.vertexShader(scope);
    const pb = scope.$builder;
    // 获取顶点坐标
    scope.$l.oPos = ShaderHelper.resolveVertexPosition(scope);
    // 获取顶点法线
    scope.$l.oNorm = ShaderHelper.resolveVertexNormal(scope);
    // 材质的pass属性指明当前在为哪个pass生成Shader
    // 如果是第一个pass，我们需要沿法线方向将顶点外扩
    if (this.pass === 0) {
      // 声明Uniform，表明外扩的长度（局部坐标系）
      scope.edge = pb.float().uniform(2);
      // 顶点坐标沿法线外扩
      scope.oPos = pb.add(scope.oPos, pb.mul(scope.oNorm, scope.edge));
    }
    // 输出世界坐标系片元位置
    scope.$outputs.worldPos = pb.mul(ShaderHelper.getWorldMatrix(scope), pb.vec4(scope.oPos, 1)).xyz;
    // 输出剪裁空间位置
    ShaderHelper.setClipSpacePosition(scope, pb.mul(ShaderHelper.getViewProjectionMatrix(scope), pb.vec4(scope.$outputs.worldPos, 1)));
    // 输出世界坐标系法线
    scope.$outputs.wNorm = pb.mul(ShaderHelper.getNormalMatrix(scope), pb.vec4(scope.oNorm, 0)).xyz;
  }
  // FragmentShader实现
  fragmentShader(scope) {
    super.fragmentShader(scope);
    const pb = scope.$builder;
    if (this.needFragmentColor()){
      if (this.pass === 0) {
        // 第一个Pass需要输出描边颜色
        // 声明描边颜色Uniform
        scope.edgeColor = pb.vec4().uniform(2);
        // 输出描边颜色
        this.outputFragmentColor(scope, scope.$inputs.worldPos, scope.edgeColor);
      } else {
        // 声明物体的颜色
        scope.albedoColor = pb.vec4().uniform(2);
        // 声明色彩量化级数Uniform
        scope.bands = pb.float().uniform(2);
        // 计算世界空间片元法线
        scope.$l.normal = this.calculateNormal(scope, scope.$inputs.worldPos, scope.$inputs.wNorm);
        // 应用Lambert光照模型
        // 因为可能会有多个光源，所以我们将色彩量化放在全部光照计算之后
        scope.$l.litColor = this.lambertLight(scope, scope.$inputs.worldPos, scope.normal, scope.albedoColor);
        // 简单起见用R+G+B作为亮度
        scope.$l.litIntensity = pb.add(scope.litColor.r, scope.litColor.g, scope.litColor.b, 0.00001);
        scope.$l.albedoIntensity = pb.add(scope.albedoColor.r, scope.albedoColor.g, scope.albedoColor.g, 0.00001);
        // 光照以后的颜色除以漫反射颜色得到光照强度
        scope.$l.intensity = pb.clamp(pb.div(scope.litIntensity, scope.albedoIntensity), 0, 1);
        // 计算量化以后的光照强度
        scope.intensity = pb.div(pb.ceil(pb.mul(scope.intensity, scope.bands)), scope.bands);
        // 计算量化以后的颜色
        scope.litColor = pb.mul(pb.vec3(scope.intensity), scope.albedoColor.rgb);
        // 输出最终的颜色
        this.outputFragmentColor(scope, scope.$inputs.worldPos, pb.vec4(scope.litColor, scope.albedoColor.a));
      }
    } else {
      this.outputFragmentColor(scope, scope.$inputs.worldPos, null);
    }
  }
}

```

<div class="showcase" case="tut-42"></div>
