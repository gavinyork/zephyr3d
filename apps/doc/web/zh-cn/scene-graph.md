# 场景图(SceneGraph)

我们使用场景图这种结构来描述需要渲染的对象。在场景图中每个具有空间属性对象称为一个节点，所有节点以树形结构保存。

## 场景节点

场景节点用于描述一个具有空间属性的对象，或者说节点本身代表了一个坐标系。用位置(position)，旋转(rotation)和缩放(scale)三个属性描述节点自身坐标系相对于父节点坐标系的坐标变换。在这种节点的层级关系下，当我们移动了一个父节点，它的所有子节点也会跟随一起移动，旋转和缩放也同理。

网格，地形，光源，摄像机等具有空件属性的类型都继承自场景节点。

下面的代码演示了通过节点的 `rotation` 属性和 `position` 属性控制节点的旋转和位移。

<<< @/../src/tut-7/main.js{55-62 js}

`rotation` 是一个 `Quaternion`（四元数），常用 `Quaternion.fromAxisAngle(轴, 弧度)` 构造。
`position` 是一个 `Vector3`，可以像上面那样只改其中一个分量。

这两个属性都是**相对于父节点**的。上例中球体直接挂在场景根节点下，所以看起来就是世界坐标；
一旦有了父节点，含义就变成相对父节点的局部变换，见下一节。

<div class="showcase" case="tut-7"></div>

## 节点层次关系

在场景中节点以树形结构存储，每个节点的空间变换都是相对于其父节点的，下面的示例演示了节点层次是如何影响它们的空间变换的。

构造三个球体并串成 sphere1 → sphere2 → sphere3 的层级：

<<< @/../src/tut-8/main.js{43-54 js}

然后只旋转前两个：

<<< @/../src/tut-8/main.js{65-72 js}

运行起来会看到 sphere3 从没有被直接赋予任何旋转，却在空间里划出复合轨迹——因为它继承了
sphere2 的旋转，而 sphere2 又继承了 sphere1 的。这就是层级变换的效果：**父节点的变换会累积
作用到所有后代节点上**。

注意 `spherePrimitive` 和 `material` 被三个网格共享（第 44 行）。除了省内存，这还让它们能在
WebGL2 和 WebGPU 上被自动合并为几何体实例渲染，详见[几何体实例化](zh-cn/instancing-intro.md)。

<div class="showcase" case="tut-8"></div>

## 遍历与查找

节点树建立起来以后，常需要在其中查找或批量处理节点。

```javascript
// 按名字查找后代节点，找不到返回 null
const head = model.findNodeByName('Head');

// 自顶向下遍历自身及所有后代
// 回调返回 true 表示"已找到/已处理完"，会中止遍历；iterate() 本身也返回该结果
model.iterate((node) => {
  // castShadow 定义在 Mesh 上而非 SceneNode，所以这里的类型守卫是必要的
  if (node.isMesh()) {
    node.castShadow = false;
  }
});

// 自底向上遍历，需要先处理子节点再处理父节点时用它
model.iterateBottomToTop((node) => { /* ... */ });
```

`iterate()` 的回调里常配合类型守卫方法来区分节点类型，它们同时起到 TypeScript 类型收窄的作用：
`isMesh()`、`isLight()`、`isCamera()`、`isSprite()`、`isParticleSystem()`、`isWater()`、
`isBatchGroup()` 等。

直接的层级关系通过 `parent`、`children`、`hasChild()`、`isParentOf()` 访问。

## 显示与隐藏

节点的可见性由 `showState` 控制，取值为 `'visible'`、`'hidden'` 或 `'inherit'`（默认继承父节点）：

```javascript
// 隐藏该节点及其所有后代
model.showState = 'hidden';
```

只读属性 `hidden` 返回**沿层级解析后**的最终结果：节点自身是 `'inherit'` 时会向上查找，
直到遇到明确设为 `'visible'` 或 `'hidden'` 的祖先。所以判断一个节点实际是否可见要读 `hidden`，
而不是 `showState`。

## 世界变换与包围盒

`position`/`rotation`/`scale` 都是局部变换。需要世界空间的结果时：

```javascript
// 世界空间位置
const worldPos = node.getWorldPosition();

// 世界变换矩阵（只读）
const m = node.worldMatrix;

// 包围盒：局部空间与世界空间
const localBV = node.getBoundingVolume();
const worldBV = node.getWorldBoundingVolume();
```

包围盒由引擎按需计算并缓存，用于视锥剔除和射线拾取。手动改动顶点数据后如果包围盒没有跟着更新，
可以调用 `invalidateBoundingVolume()` 让它重新计算。
