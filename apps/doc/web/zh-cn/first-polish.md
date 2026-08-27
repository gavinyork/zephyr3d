# 加上阴影与后处理

场景里有了物体之后，加阴影和后处理是提升画面质量最直接的两步。本页只讲怎么快速用上，
参数细节和各个效果的取舍在对应的专题页里。

## 开启阴影

阴影由光源和网格两侧共同控制：

<<< @/../src/tut-16/main.js{28-35 js}

- `light.castShadow = true` —— 让该光源投射阴影。平行光、点光、锥光都支持。
- `mesh.castShadow` —— 控制单个网格是否投射阴影，**默认为 true**，通常只在需要排除某些
  物体时才显式设为 false。

`shadow.depthBias` 用来消除自遮挡产生的条纹（shadow acne）。值太小会有条纹，太大会让阴影
和物体脱开（peter-panning），需要按场景尺度调。

<div class="showcase" case="tut-16"></div>

如果场景里有大量静止不动的投影物体，可以把它们登记为静态投射者，引擎会缓存它们的阴影，
避免每帧重算：

```javascript
light.shadow.shadowRegion.addStaticCaster(box);
```

阴影的模式选择（PCF/PCSS/VSM/ESM/CSM 等）、软阴影质量、级联配置见
[阴影反走样](zh-cn/shadow-aa.md)。

## 开启后处理

后处理效果挂在相机上，大多数常用效果直接用属性开关即可：

```javascript
// HDR 渲染 + 色调映射
camera.HDR = true;
camera.toneMap = true;
camera.toneMapExposure = 1.1;

// 泛光
camera.bloom = true;
camera.bloomThreshold = 0.85;
camera.bloomIntensity = 1.2;

// 抗锯齿：FXAA 开销低，TAA 质量更好
camera.FXAA = true;
```

**色调映射几乎总是要开的。** 引擎的光照计算在高动态范围下进行，不做色调映射直接输出会让
亮部大片过曝。大气散射天空尤其明显，因为它算出的天空亮度远超显示范围。

<div class="showcase" case="tut-27"></div>

上面这个示例把屏幕分成上下两半对比开关色调映射的差别。

各个效果的参数含义见[后处理](zh-cn/posteffect-intro.md)专题。需要自定义后处理链时，
可以往 `camera.compositor` 里追加自己的 `AbstractPostEffect` 实例。

## 加环境光

只有直接光源的场景，阴影里会是死黑。环境光（间接光照）负责补上这部分：

```javascript
// 基于图像的光照，需要一张环境立方体贴图
scene.env.light.type = 'ibl';

// 或者用半球形天光，开销更低
scene.env.light.type = 'hemisphere';

// 环境光强度
scene.env.light.strength = 0.6;
```

前面几页的示例为了突出单个光源的效果，大多显式关掉了环境光
（`scene.env.light.type = 'none'`）。**实际项目里通常直接光和环境光都要有。**
详见[间接光照](zh-cn/lighting-indirect.md)。

## 一个合理的起点配置

综合下来，写实风格场景可以从这套配置起步，再按需微调：

```javascript
// 环境
scene.env.sky.skyType = 'scatter';       // 大气散射天空
scene.env.light.type = 'ibl';            // 环境光
scene.env.light.strength = 0.6;

// 主光源 + 阴影
const sun = new DirectionalLight(scene);
sun.lookAt(new Vector3(0, 15, -10), Vector3.zero(), Vector3.axisPY());
sun.castShadow = true;

// 相机后处理
camera.HDR = true;
camera.toneMap = true;
camera.bloom = true;
camera.FXAA = true;
```

## 下一步

入门到这里就完成了。接下来可以按需深入：

- [基本框架](zh-cn/scene-basic.md) —— 应用生命周期、输入中间件、帧事件的完整说明
- [网格及材质](zh-cn/mesh-material.md) —— 手动填充顶点、材质实例化
- [光照](zh-cn/lighting-intro.md) / [阴影](zh-cn/shadow-intro.md) / [后处理](zh-cn/posteffect-intro.md)
- [动画](zh-cn/animation-intro.md) —— 骨骼动画、关键帧、融合与编排
- [使用编辑器](zh-cn/editor/overview.md) —— 可视化工作流，做资产和场景更方便
