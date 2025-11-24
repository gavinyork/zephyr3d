
# 间接光照（Indirect Lighting）

在 Zephyr3D 中，场景支持单一的**环境光源（Ambient Light）**，
它用于模拟来自周围环境的间接反射光照。

环境光通过 `scene.env.light` 属性进行设置，
其类型由 `scene.env.light.type` 决定。

目前有效取值为：

| 类型值 | 说明 |
|:--------|:------|
| `'ibl'` | 基于图像的光照（Image-Based Lighting, 适用于 PBR 材质） |
| `'hemisphere'` | 半球形天光（简单环境光近似） |
| `'none'` | 无环境光照 |

默认值为 `'ibl'`。  
若设置为 `'none'`，场景中将完全关闭环境光照，仅保留直接光照（如方向光、点光等）。

---

## IBL（Image-Based Lighting，基于图像的间接光照）

**概念说明：**

IBL 是通过对一张高动态范围（HDR）的环境贴图进行球面积分，
预计算出环境反射（Radiance）与环境漫反射（Irradiance），  
进而在 PBR 材质中实现真实的间接光照和反射效果。

IBL 特点：
- 适用于 PBR 材质；
- 能够准确模拟物体与环境的光能交换；
- 可与天空盒协同工作（基于同一环境贴图）；
- 支持实时或预计算的辐射/辐照纹理更新。

**使用步骤：**

1. 将 `scene.env.light.type` 设置为 `'ibl'`；  
2. 赋予场景一个可用于生成天空盒的**HDR 全景图**；  
3. 通过工具函数将全景图转换为立方体天空贴图；  
4. 设置天空类型，如天空类型为`'skybox'`，指定天空盒贴图。

```javascript
// 加载 HDR 全景图并生成 IBL 环境光
getEngine().resourceManager.fetchTexture('https://cdn.zephyr3d.org/doc/assets/images/Wide_Street.hdr')
  .then(tex => {
    // 创建立方体天空贴图 (512x512, RGBA16F 精度)
    const skyMap = myApp.device.createCubeTexture('rgba16f', 512);

    // 从全景图生成立方体贴图（等距投影 → Cubemap）
    panoramaToCubemap(tex, skyMap);

    // 设置天空模式为天空盒并应用贴图
    scene.env.sky.skyType = 'skybox';
    scene.env.sky.skyboxTexture = skyMap;

    // 启用 IBL 环境光照
    scene.env.light.type = 'ibl';
  });
```

> **注意事项：**
> - IBL 需要一个“天空源”（Sky Source）来计算环境反射，也就是说scene.env.sky.skyType不能为'none'
> - IBL 通常与 **PBRMetallicRoughnessMaterial** 一起使用。
> - 通过动态更换天空贴图即可实现不同场景的环境匹配效果。

<div class="showcase" case="tut-14" style="width:600px;height:800px;"></div>

---

## HemisphericLight（半球形天光）

**概念说明：**

Hemispheric Light（半球环境光）是对真实环境光的一种简化模拟。  
它假设物体上方受到来自天空的蓝色漫射光，下方受到地面的反射光（通常偏灰或棕色），  
并根据物体法线方向在上下两种颜色之间进行插值，从而产生柔和的环境照明效果。

该方式计算简单、实时高效，适用于非 PBR 材质或对性能要求较高的场景。

**使用方式：**

```javascript
// 设置环境光类型为半球形天光
scene.env.light.type = 'hemisphere';

// 定义天空颜色 (ambientUp)：偏蓝，代表来自上方的光
scene.env.light.ambientUp = new Vector4(0.3, 0.6, 1.0, 1.0);

// 定义地面颜色 (ambientDown)：偏灰，代表地面反射光
scene.env.light.ambientDown = new Vector4(0.2, 0.2, 0.2, 1.0);
```

> **提示：**
> - 半球光照不依赖天空盒；
> - 它只影响物体的环境光分量；
> - 对于 PBR Material 来说，效果较为粗糙，如果需要更真实的反射建议使用 IBL。

<div class="showcase" case="tut-15" style="width:600px;height:800px;"></div>

---

## 关闭环境光照

如果希望场景中仅保留直接光源（例如方向光、点光、聚光）而无环境影响，
可直接关闭环境光照：

```javascript
scene.env.light.type = 'none';
```

关闭后：
- PBR 材质将不会接收反射与辐照贡献；
- 非 PBR 材质仅受直接光照影响；
- 场景整体对比将增强，适合表现纯粹的舞台光环境。

---

## 小结

| 环境光类型 | 特征 | 适用材质 | 适合场景 | 性能 |
|-------------|--------|------------|------------|--------|
| **IBL** | 基于 HDR 天空的高精度反射与漫射光 | PBR | 写实、反射性场景 | 较高 |
| **Hemispheric** | 上下半球颜色插值的简化照明 | Lambert / Unlit | 低性能设备或卡通风格 | 高 |
| **None** | 不计算间接光，仅保留直射光 | 任意 | 特效、暗场或特殊视觉风格 | 最高 |

---

通过合理选择环境光模式，你可以在 Zephyr3D 中轻松平衡**视觉真实度**与**性能成本**。
