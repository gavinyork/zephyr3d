# Shader变体

一种很常见的情况是，我们设置材质的不同属性以后，材质需要生成不相同的代码，也就是说同一材质的Shader可能会有不同的变体。

你可以调用材质的静态方法[defineFeature()](/doc/markdown/./scene.meshmaterial.definefeature)来为材质声明变体。

```javascript

class MyMaterial extends MeshMaterial {
  // 定义了一个Feature，该feature可以拥有若干变体
  static featureA = this.defineFeature();
  // 另一个Feature
  static featureB = this.defineFeature();

  foo() {
    // useFeature()方法可以用来激活一个变体
    // value参数可以是任何值，每个不同的值各代表一个变体
    // 未调用useFeature()，变体值默认为undefined
    this.useFeature(MyMaterial.featureA, value);
    // 获取当前的变体
    const value = this.featureUsed(MyMaterial.featureA);
  }
  bar() {
    // 如果是简单的开关，可以使用布尔值做变体
    this.useFeature(MyMaterial.featureB, true);
  }
}

```

在Shader的实现中要注意根据变体做不同的实现。


下面的例子中，我们定义了一个Lambert材质，该材质你可以设置一个可选的纹理，从而生成两个Shader变体。

```javascript

// 自定义Lambert材质
// 材质的diffuseTexture属性是否为空个代表一个变体
class MyLambertMaterial extends applyMaterialMixins(MeshMaterial, mixinLambert) {
  static featureDiffuseTexture = this.defineFeature();
  constructor() {
    super();
    // 漫反射颜色
    this.color = new Vector4(1, 1, 1, 1);
    // 漫反射贴图，默认为空
    this.diffuseTexture = null;
  }
  // 每次渲染之前更新变体值
  beginDraw(pass, ctx) {
    // 有无diffuseTexture形成两个变体
    this.useFeature(MyLambertMaterial.featureDiffuseTexture, !!this.diffuseTexture);
    // 默认实现必须调用
    return super.beginDraw(pass, ctx);
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
    ShaderHelper.setClipSpacePosition(scope, pb.mul(ShaderHelper.getViewProjectionMatrix(scope), pb.vec4(scope.$outputs.worldPos, 1)));
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
        scope.$l.diffuse = pb.mul(pb.textureSample(scope.diffuseTexture, scope.$inputs.texcoord), scope.diffuseColor);
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
  applyUniformValues(bindGroup, ctx, pass){
    super.applyUniformValues(bindGroup, ctx, pass);
    if (this.needFragmentColor(ctx)){
      bindGroup.setValue('diffuseColor', this.color);
      // 变体判断
      if (this.diffuseTexture) {
        bindGroup.setTexture('diffuseTexture', this.diffuseTexture)
      }
    }
  }
}

```

下面的例子中，按下空格键可以切换有无贴图两个变体。

<div class="showcase" case="tut-43"></div>

