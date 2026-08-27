# 直接光照

对于直接光照，我们需要创建光照类型的场景节点。我们可以为光源设置颜色和强度，光源的位置，方向由节点的位置和旋转来决定。

**光源方向是朝向自身坐标系的负Z轴方向**

引擎提供四种光源：平行光、点光、锥光和面光源。

> 本页的 `color` 和 `intensity` 属于默认的 `legacy` 光照模式，`intensity` 是一个无单位的倍数。
> 如果场景使用[物理光照模式](zh-cn/lighting-physical.md)，强度改用光度单位的属性
> （`illuminance` / `luminousPower` / `luminance`），本页的 `intensity` 不再生效。

## 平行光

平行光模拟无限远处的光源，只有方向没有位置，常用来当太阳光。

<<< @/../src/tut-11/main.js{23-32 js}

方向由节点旋转决定，这里用 `rotation.fromEulerAngle()` 设置。注意第 25 行关掉了环境光
（`scene.env.light.type = 'none'`）——**默认场景是有环境光的**，不关掉的话很难看清单个光源的
贡献。实际项目里通常两者都要，见[间接光照](zh-cn/lighting-indirect.md)。

<div class="showcase" case="tut-11"></div>

## 点光

点光从一个位置向各方向发光，位置由节点的 `position` 决定，方向无意义。

<<< @/../src/tut-12/main.js{23-31 js}

点光和锥光都有 `range`（照射半径）。**`range` 保持默认的 0 时，引擎会依据 `intensity`
自动推算一个衰减范围**，所以上例只设了 `intensity` 也能正常工作。手动指定 `range` 可以
控制光源的影响范围，范围越小参与计算的像素越少。

<div class="showcase" case="tut-12"></div>

## 锥光

锥光有位置也有方向，光线约束在一个圆锥内。

<<< @/../src/tut-13/main.js{23-36 js}

**`cutoff` 是圆锥半角的余弦值，不是角度本身。** 所以要表达"半角 36 度"应写
`Math.cos(Math.PI * 0.2)`，直接赋值 `Math.PI * 0.2` 会得到一个远大于预期的光锥
（余弦值越小对应的锥角越大）。这一点很容易搞错。

（在物理光照模式下，锥角改用 `innerConeAngle` / `outerConeAngle`，是真实的弧度值。）

<div class="showcase" case="tut-13"></div>

## 面光源

面光源（`RectLight`）是一个矩形发光面，能产生比点光更柔和、有方向性的照明和高光，
适合表现窗户、灯箱、屏幕这类光源。

```javascript
const light = new RectLight(scene);
// 矩形的宽高（场景单位）
light.width = 4;
light.height = 2;
// 照射范围
light.range = 10;
light.color = new Vector4(1, 1, 1, 1);
light.intensity = 5;
// 位置和朝向同样由节点变换决定，光线朝自身 -Z 方向
light.position.setXYZ(0, 5, 0);
light.lookAt(new Vector3(0, 5, 0), Vector3.zero(), Vector3.axisPY());
```

面光源的高光使用 LTC（Linearly Transformed Cosines）近似，各后端都支持。
由于要计算矩形面积上的积分，它比其他光源开销更高，数量上要控制。

