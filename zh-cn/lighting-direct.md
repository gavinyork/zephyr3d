# 直接光照

对于直接光照，我们需要创建光照类型的场景节点。我们可以为光源设置颜色和强度，光源的位置，方向由节点的位置和旋转来决定。

**光源方向是朝向自身坐标系的负Z轴方向**

## 平行光

以下代码示范了平行光的使用方法

```javascript

// 创建平行光对象
const light = new DirectionalLight(scene);
// 平行光方向
light.rotation.fromEulerAngle(Math.PI/4, Math.PI/4, 0, 'ZYX');
// 平行光颜色
light.color = new Vector4(1, 1, 0, 1);

```

<div class="showcase" case="tut-11"></div>

## 点光

以下代码示范了点光的使用方法

```javascript

// 创建点光对象
const light = new PointLight(scene);
// 点光的照射范围
light.range = 30;
// 点光颜色
light.color = new Vector4(1, 1, 1, 1);

```

<div class="showcase" case="tut-12"></div>

## 锥光

以下代码示范了锥形光的使用方法

```javascript

// 创建锥形光对象
const light = new SpotLight(scene);
// 锥形光方向
light.rotation.fromEulerAngle(-Math.PI/4, Math.PI/4, 0, 'ZYX');
// 锥形光颜色
light.color = new Vector4(1, 1, 1, 1);
// 光锥角度余弦
light.cutoff = Math.cos(Math.PI * 0.25);
// 锥形光范围
light.range = 30;
// 锥形光位置
light.position.setXYZ(0, 15, 0);

```

<div class="showcase" case="tut-13"></div>

