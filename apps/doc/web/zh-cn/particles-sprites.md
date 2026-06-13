# 粒子与 Sprite

Zephyr3D 提供两类 billboard 系统：

- `Sprite` 渲染单个始终面向摄像机的四边形。
- `ParticleSystem` 渲染大量带运动和生命周期的面向摄像机四边形。

Sprite 适合图标、标记、简单贴花和 3D 空间中的 2D 元素。粒子系统适合烟雾、火花、尘土、萤火、魔法效果等重复且短暂的视觉元素。

## Sprite

创建 Sprite 时需要一个 `SpriteMaterial` 实现。常用的纹理材质是 `StandardSpriteMaterial`。

```ts
import { Sprite, StandardSpriteMaterial } from '@zephyr3d/scene';

const texture = await getEngine().resourceManager.fetchTexture('/textures/marker.png');
const material = new StandardSpriteMaterial();
material.spriteTexture = texture;
material.setUVInfo(0, 0, 1, 1);
material.anchorX = 0.5;
material.anchorY = 0.5;

const sprite = new Sprite(scene, material);
sprite.parent = scene.rootNode;
sprite.position.setXYZ(0, 2, 0);
sprite.scale.setXYZ(0.6, 0.6, 0.6);
```

常用控制项：

| 属性 | 含义 |
| --- | --- |
| `anchorX`, `anchorY` | Sprite 四边形内部的轴心 |
| `uvTopLeft`, `uvBottomRight` | Sprite 节点使用的 UV 矩形 |
| `material.setUVInfo()` | 材质上的 UV 矩形 |
| `material.rotation` | billboard 平面内旋转 |
| `setPickTarget()` | 设置逻辑拾取目标 |

如果需要清晰边缘的 SDF 图标或类似字形的纹理，可以使用 `SDFSpriteMaterial`。

## 粒子系统

`ParticleSystem` 持有发射设置、模拟参数和 `ParticleMaterial`。挂到场景后，场景会自动更新它。

```ts
import { ParticleSystem } from '@zephyr3d/scene';
import { Vector3 } from '@zephyr3d/base';

const particles = new ParticleSystem(scene);
particles.parent = scene.rootNode;
particles.position.setXYZ(0, 1, 0);

particles.maxParticleCount = 512;
particles.emitInterval = 24;
particles.emitCount = 4;

particles.emitterShape = 'sphere';
particles.emitterBehavior = 'volume';
particles.emitterShapeSizeMin = new Vector3(0.2, 0.2, 0.2);
particles.emitterShapeSizeMax = new Vector3(0.5, 0.5, 0.5);

particles.particleLifeMin = 0.8;
particles.particleLifeMax = 1.8;
particles.particleVelocityMin = 1.5;
particles.particleVelocityMax = 3.2;
particles.particleSize1Min = 0.08;
particles.particleSize1Max = 0.18;
particles.particleSize2Min = 0.35;
particles.particleSize2Max = 0.6;

particles.gravity = new Vector3(0, 0.8, 0);
particles.wind = new Vector3(0.4, 0, 0);
particles.airResistence = true;
```

发射器形状：

| 形状 | 用途 |
| --- | --- |
| `point` | 从单点发射 |
| `sphere` | 从球体发射 |
| `box` | 从盒体发射 |
| `cylinder` | 从圆柱体发射 |
| `cone` | 从锥体发射 |

`emitterBehavior` 可以是 `surface` 或 `volume`，分别表示粒子从形状表面或体积内部生成。

## 粒子材质

默认材质是 `ParticleMaterial`。

```ts
const alpha = await getEngine().resourceManager.fetchTexture('/particles/smoke-alpha.png', {
  linearColorSpace: true
});
const ramp = await getEngine().resourceManager.fetchTexture('/particles/smoke-ramp.png');

particles.material.alphaMap = alpha;
particles.material.rampMap = ramp;
particles.material.aspect = 1;
particles.material.jitterPower = 0.2;
particles.material.directional = false;
particles.material.blendMode = 'blend';
```

重要材质参数：

| 属性 | 含义 |
| --- | --- |
| `alphaMap` | 粒子形状和透明度 |
| `rampMap` | 按归一化生命周期取样的颜色 |
| `aspect` | billboard 宽高比 |
| `jitterPower` | 在 shader 中加入动态扰动 |
| `directional` | 是否按速度方向对齐粒子 |
| `blendMode` | 常用值为 `blend` 或 `additive` |

火花、辉光和魔法效果通常使用 additive blending。烟雾、尘土、叶片和柔和粒子通常使用 alpha blending。

## 世界空间和局部空间

`worldSpace` 控制粒子发射后是否继续在世界坐标中运动。

```ts
particles.worldSpace = true;
```

为 true 时，移动发射器不会拖动已经发射的粒子。为 false 时，粒子会保持在发射器节点的局部空间中。

## 手动爆发

系统会按 `emitInterval` 和 `emitCount` 持续发射。对于一次性效果，可以把持续发射频率设低，然后通过 `newParticle()` 触发爆发：

```ts
particles.newParticle(80, particles.worldMatrix);
```

这适合命中、爆炸或交互反馈。

## 拾取与透明度

粒子和 Sprite 都是可绘制场景节点，因此可以提供 pick target。大量透明粒子出现排序问题时，可以在摄像机上启用 OIT：

```ts
scene.mainCamera.oitMode = 'weighted';
```

对于粒子较多的场景，weighted blended OIT 通常是更实用的选择。

## 序列化

`Sprite`、`SpriteMaterial`、`StandardSpriteMaterial`、`ParticleSystem` 和 `ParticleMaterial` 都已注册到序列化系统。编辑器创建的 Sprite 和粒子节点可以保存在场景或预制体中。

Sprite 和粒子材质使用的纹理，应在序列化前拥有 asset id。

## 性能建议

`maxParticleCount` 应接近实际需要的最大数量。多个效果共享行为和材质时，优先使用少量较大的粒子系统，而不是大量很小的粒子系统。避免每帧替换纹理或材质，优先动画参数。
