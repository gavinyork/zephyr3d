# 场景图(SceneGraph)

我们使用场景图这种结构来描述需要渲染的对象。在场景图中每个具有空间属性对象称为一个节点，所有节点以树形结构保存。

## 场景节点

场景节点用于描述一个具有空间属性的对象，或者说节点本身代表了一个坐标系。用位置(position)，旋转(rotation)和缩放(scale)三个属性描述节点自身坐标系相对于父节点坐标系的坐标变换。在这种节点的层级关系下，当我们移动了一个父节点，它的所有子节点也会跟随一起移动，旋转和缩放也同理。

网格，地形，光源，摄像机等具有空件属性的类型都继承自场景节点。

下面的代码演示了通过节点的rotation属性和position属性控制节点的旋转和位移。

```javascript

  let x = 0;
  myApp.on('tick', function () {
    // 更新球体旋转角度
    sphere.rotation = Quaternion.fromAxisAngle(new Vector3(0, 1, 0), x);
    // 更新球体位置
    sphere.position.y = Math.sin(x);
    x += 0.04;
  });

```

<div class="showcase" case="tut-7"></div>

## 节点层次关系

在场景中节点以树形结构存储，每个节点的空间变换都是相对于其父节点的，下面的示例演示了节点层次是如何影响它们的空间变换的。

```javascript

  const spherePrimitive = new SphereShape();
  // 创建一个球体网格父节点
  const sphere1 = new Mesh(scene, spherePrimitive, material);
  // 创建一个球体网格作为sphere1的子节点，X轴距离sphere1节点8个单位
  const sphere2 = new Mesh(scene, spherePrimitive, material);
  sphere2.parent = sphere1;
  sphere2.position.x = 8;
  // 创建一个球体网格作为sphere2的子节点，Y轴距离sphere2节点4个单位
  const sphere3 = new Mesh(scene, spherePrimitive, material);
  sphere3.parent = sphere2;
  sphere3.position.y = 4;

  let x = 0;
  myApp.on('tick', function () {
    // sphere1绕z轴旋转
    sphere1.rotation = Quaternion.fromAxisAngle(new Vector3(0, 0, 1), x);
    // sphere2绕x轴旋转
    sphere2.rotation = Quaternion.fromAxisAngle(new Vector3(1, 0, 0), x * 8);
    x += 0.01;
  });

```

<div class="showcase" case="tut-8"></div>
