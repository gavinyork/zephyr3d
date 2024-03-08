# 光照材质

创建支持光照的材质需要计算物体受到的所有直接光照和间接光照。可以使用引擎已经提供的光照模型，也可以自行编写。

## 系统光照模型

自定义材质可以通过applyMaterialMixins方法混入系统预定义的光照模型，调用其方法来进行光照计算。

系统目前预定义了以下光照模型：

- Lambert光照模型

  需要混入[mixinLambert](/doc/markdown/./scene.mixinlambert)组件，该组件提供[lambertLight](/doc/markdown/./scene.imixinlambert)方法计算光照。

- Blinn-Phong光照模型

  需要混入[mixinBlinnPhong](/doc/markdown/./scene.mixinblinnphong)组件，该组件提供[blinnPhongLight](/doc/markdown/./scene.imixinblinnphong)方法计算光照。

- PBRMetallicRoughness光照模型

  需要混入[mixinPBRMetallicRoughness](/doc/markdown/./scene.mixinpbrmetallicroughness)组件，该组件提供[PBRLight](/doc/markdown/./scene.imixinpbrmetallicroughness)方法计算光照。

- PBRSpecularGlossiness光照模型

  需要混入[mixinPBRSpecularGlossness](/doc/markdown/./scene.mixinpbrspecularglossness)组件，该组件提供[PBRLight](/doc/markdown/./scene.imixinpbrspecularglossiness)方法计算光照。

混入以上任意光照都会默认混入基本光照组件[mixinLight](/doc/markdown/./scene.mixinlight)，这个组件提供了设置法线贴图的接口以及计算片元法线和TBN矩阵等用于光照计算的基本接口。


下面是一个自定义的Blinn-Phong光照材质

```javascript

// 自定义Blinn-phong材质
class MyBlinnMaterial extends applyMaterialMixins(MeshMaterial, mixinBlinnPhong) {
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
    // 定义纹理坐标
    scope.$inputs.texcoord = pb.vec2().attrib('texCoord0');
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
    // 输出纹理坐标到fragmentShader
    scope.$outputs.texcoord = scope.$inputs.texcoord;
    // 输出剪裁空间的顶点坐标
    // ShaderHelper.getViewProjectionMatrix()获取当前的世界空间到剪裁空间的变换矩阵。
    // 注意不要直接给scope.$builtins.position赋值，因为在WebGPU设备下渲染到纹理时需要上下翻转
    // 需要使用ShaderHelper.setClipSpacePosition()方法。
    ShaderHelper.setClipSpacePosition(scope, pb.mul(ShaderHelper.getViewProjectionMatrix(scope), pb.vec4(scope.$outputs.worldPos, 1)));
  }
  // FragmentShader实现
  // scope是fragmentShader的main函数作用域
  fragmentShader(scope) {
    // 必须调用父类的fragmentShader方法
    // 父类fragmentShader负责初始化全局uniform参数
    super.fragmentShader(scope);
    const pb = scope.$builder;
    // MeshMaterial的needFragmentColor()函数返回
    // 当前Shader是否需要计算片元颜色。如果当前的
    // RenderPass是DepthPass或ShadowMapPass且材质
    // alphaCutoff属性等于0(未开启AlphaTest)，则
    // 无需计算片元颜色。
    if (this.needFragmentColor()) {
      // 定义一个vec4类型的uniform用于指定漫反射颜色
      // 注意：用于材质的uniform，对应的BindGroup索引为2。
      scope.diffuseColor = pb.vec4().uniform(2);
      // 定义uniform用于指定漫反射贴图
      scope.diffuseTexture = pb.tex2D().uniform(2);
      // 利用mixinLight提供的calculateNormal方法计算片元法线（如果设置了法线贴图，该方法会采样法线贴图计算片元法线）
      scope.$l.normal = this.calculateNormal(scope, scope.$inputs.worldPos, scope.$inputs.worldNorm);
      // 利用mixinLight提供的calculateViewVector方法计算视线向量（从片元世界坐标指向摄像机世界坐标的单位向量）
      scope.$l.viewVec = pb.normalize(pb.sub(ShaderHelper.getCameraPosition(scope), scope.$inputs.worldPos));
      // 计算漫反射颜色（漫反射贴图颜色乘以漫反射颜色）
      scope.$l.diffuseColor = pb.mul(pb.textureSample(scope.diffuseTexture, scope.$inputs.texcoord), scope.diffuseColor);
      // 计算光照，结果是vec3类型的光照以后的颜色
      scope.$l.litColor = this.blinnPhongLight(scope, scope.$inputs.worldPos, scope.normal, scope.viewVec, scope.diffuseColor);
      // 合并漫反射的alpha通道到最终颜色
      scope.$l.finalColor = pb.vec4(scope.litColor, scope.diffuseColor.a);
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

// 使用自定义材质
const material = new MyBlinnMaterial();
// 设置漫反射颜色
material.color.setXYZW(1, 1, 0, 1)
// 设置漫反射贴图
material.diffuseTexture = texture;
// 通知材质需要重新提交uniform
material.uniformChanged();

// 使用此材质渲染网格。
const mesh = new Mesh(scene, new TorusShape(), material);

```

<div class="showcase" case="tut-40"></div>

## 自定义光照模型

