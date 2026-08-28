# 头发渲染

头发是角色渲染里最特殊的部分：单根发丝比像素还细，光线会穿透它，而且成千上万根堆在一起。
引擎提供两条完全不同的技术路径，先选对路径再谈参数。

## 两条路径怎么选

| | 发卡（hair card） | 发丝（strand） |
| --- | --- | --- |
| 几何 | 带贴图的多边形片 | GPU 展开的真实发丝 |
| 用什么 | `HairMaterial` + 普通 `Mesh` | `HairStrandMaterial` + `HairStrandData`，或 `HairNode` |
| 资产来源 | DCC 建模 + 贴图 | 从 Alembic / `.zhair` 导入的曲线 |
| 开销 | 低 | 高（发丝数量直接决定） |
| 适合 | 移动端、远景角色、风格化 | 特写、写实、需要物理模拟 |
| 物理模拟 | 无 | 有（仅 WebGPU） |

不确定的话从发卡开始——它兼容性和性能都更好，绝大多数项目够用。

## 着色模型：两套独立参数

无论走哪条路径，都要先选着色模型。**这是理解头发参数最关键的一步**，因为两个模型的参数集
几乎不重叠：

```javascript
material.shadingModel = 'kajiya-kay';  // 默认
material.shadingModel = 'marschner';
```

**`kajiya-kay`（默认）** —— 现象学的双 lobe 模型。每一项都是美术旋钮，可预测、开销低，
风格化发卡通常要的就是它。

**`marschner`** —— 纤维模型，把光拆成穿过发丝的三条路径（R / TT / TRT）。开销更高，
直接控制力弱一些，但次级高光会自然带上头发本身的颜色、背光的发梢会自然透光，
因为模型算出来就该如此，不需要有人去调。

::: warning 切换模型会改变外观，不是细化
`marschner` 是需要主动选择的，切过去画面会变。而且两个模型的参数**互相失效**：
`marschner*` 系列在 `kajiya-kay` 下无效，而高光 lobe 那组参数在 `marschner` 下无效。
:::

### 切到 marschner 时要留意的重叠属性

有两个属性在 `marschner` 下应当放着不动：

- **`transmissionIntensity`** —— 它的作用就是伪造背光透光感，而 Marschner 的 TT 路径会
  真实产生这个效果。两个叠加会过量。
- **`strandRoundness`**（仅 `HairStrandMaterial`）—— 它靠弯曲法线影响高光，
  但 Marschner 已经在纤维截面上做了积分，这个法线到不了高光计算里。

## 发卡路径

`HairMaterial` 用于带贴图的多边形发片，配普通 `Mesh` 使用。

光照由这些项构成：

- **环绕漫反射** —— 软化薄发片上的明暗交界。
- **主高光 lobe** —— 通常接近白色、较锐利、偏向发根方向偏移。
- **次高光 lobe** —— 被头发颜色染色、更宽、偏向发梢偏移。
- 可选的**偏移贴图**（`shiftMapScale`）逐根抖动两个 lobe，把"天使环"打散成自然的发丝纹理。
- 可选的**视角相关透射**，用于背光发梢。
- 可选的**烘焙遮蔽贴图**（`occlusionStrength`），做发根压暗。

### 发丝方向

```javascript
material.strandDirection = 'tangent';   // 或 'binormal'
```

各向异性高光需要知道发丝在贴图空间里的走向。这取决于你的 UV 是怎么摆的——**如果高光方向
看起来是错的（沿着发丝而不是横跨发丝），先换这个值**。

### Alpha 处理

头发边缘的处理来自 `MeshMaterial` 基类，推荐的组合是：

- 不透明的主体部分用 `alphaCutoff` + `alphaDither`，配合 TAA 得到收敛的软边；
- 外层飞散的碎发用 `blendMode = 'blend'`。

## 发丝路径

发丝路径把曲线控制点交给 GPU，由 GPU 展开成面向相机的带状几何体。

```javascript
import { HairStrandData, HairStrandMaterial, Mesh, Primitive } from '@zephyr3d/scene';

const material = new HairStrandMaterial();

const strands = new HairStrandData({
  positions,    // 所有控制点，扁平数组
  pointCounts,  // 每根发丝有几个控制点
  widths,       // 发丝宽度
  uv,
  scale: unitScale
});
material.strands = strands;

// 发丝几何在 GPU 上生成，但仍然需要一个 Primitive 才能发起绘制调用
const primitive = new Primitive();
// 顶点属性不会被读取，这个布局只是为了让 draw 能提交
primitive.createAndSetVertexBuffer('position_f32x3', new Float32Array(3));
primitive.indexCount = material.vertexCount;
primitive.primitiveType = 'triangle-list';
primitive.setBoundingVolume(myBounds);

const mesh = new Mesh(scene, primitive, material);
```

::: tip 那个占位 Primitive 是必需的
发丝顶点是 GPU 展开出来的，不来自顶点缓冲区。但绘制调用仍然需要一个 `Primitive`：
`indexCount` 要设成 `material.vertexCount`，顶点缓冲区里放什么无所谓（上例放了一个
三分量的占位）。**包围盒必须自己算并设上**，否则视锥剔除会把头发剔掉。
:::

### 常用参数

| 属性 | 作用 |
| --- | --- |
| `segmentsPerStrand` | 每根发丝细分成几段 |
| `strandWidthScale` | 发丝宽度整体缩放 |
| `minStrandWidth` | 最小世界空间宽度 |
| `minPixelWidth` | 最小屏幕像素宽度，防止远处发丝细到闪烁 |
| `strandLOD` / `minStrandLODRatio` | 按距离减少发丝数量 |
| `strandRoundness` | 用弯曲法线模拟圆柱截面（`marschner` 下无效） |
| `rootOcclusion` / `rootOcclusionRange` | 发根压暗 |
| `strandMotion` / `prevPoints` | 运动矢量，供 TAA 和运动模糊使用 |

`minPixelWidth` 值得特别说：发丝比像素细时会产生严重闪烁，给它设一个下限（配合 alpha 衰减）
是标准做法。

### 用 HairNode 加载资产

如果头发来自 `.zhair` 资产文件，`HairNode` 把加载和绘制都包好了：

```javascript
const hair = new HairNode(scene);
await hair.setHairAsset('/assets/hair.zhair');
```

它也可以直接接受控制点：`hair.setStrands(source)`。`HairNode` 上转发了着色相关的属性
（`shadingModel`、`albedoColor`、`marschner*` 等），所以不必单独持有材质。

**用 `HairNode` 的一个实际好处是它替你处理了上面那些琐事**：上传控制点、设置绘制调用的规模、
**重算包围盒**、释放旧数据、以及重建正在跑的模拟（模拟的静止姿态来自发丝数据）。
手工走 `HairStrandMaterial` + `Mesh` 那条路时，这些都要自己管。

`setHairAsset()` 是异步的，加载失败会打日志并清空发丝，不会抛异常中断你的流程。

## 物理模拟

发丝路径支持 GPU 上的发丝模拟，**仅 WebGPU 可用**：

```javascript
import { isHairSimulationSupported } from '@zephyr3d/scene';

if (isHairSimulationSupported()) {
  // 启用模拟
}
```

在别的后端上这个函数返回 false，需要走静态发型的分支。**不要假定模拟可用**——
它依赖计算着色器，WebGL 完全没有。

## 阴影

头发的自阴影用普通 shadow map 效果很差：发丝比阴影贴图的像素细得多，二值的遮挡测试会产生
噪点而不是柔和的透光感。

引擎为此提供了 **DOM（Deep Opacity Map）** 阴影模式，它记录光线穿过头发时的**部分遮挡**
而不是非黑即白的结果：

```javascript
light.shadow.mode = 'dom';
```

**这个模式仅 WebGPU 可用。** 在其他后端上设置它会回退到 `pcf`，并在控制台打一条警告——
这是有意的：让用 DOM 编排的场景在 WebGL 上仍然能渲染出阴影，而不是干脆没有阴影贴图。
所以调试时**记得看控制台**，否则容易误以为设置生效了。

相关参数：`domLayerDistance`、`domDensity`、`domFilterSize`，都在 `light.shadow` 上。

<div class="showcase" case="tut-71"></div>

## 相关

- [皮肤与次表面散射](zh-cn/material-skin.md) —— 角色渲染的另一部分
- [阴影反走样](zh-cn/shadow-aa.md) —— 阴影模式与质量
- [自定义材质](zh-cn/user-material.md) —— 材质系统通用机制
