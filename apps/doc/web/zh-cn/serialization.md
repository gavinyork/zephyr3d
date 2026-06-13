# 序列化、场景与预制体

Zephyr3D 可以将引擎对象序列化为 JSON，并在之后恢复。序列化系统由 `ResourceManager` 管理，场景文件、预制体、编辑器资源、地形/水面数据、材质、动画片段、脚本以及大量场景节点都会使用这一套机制。

需要保存引擎运行时状态时使用序列化。只需要重新读取源模型时使用模型导入。

## 可以序列化的内容

内置注册表已经覆盖常见运行时对象：

- Scene 和场景节点
- 摄像机、灯光、网格、Sprite、文本、地形、水面和粒子系统
- 内置材质和材质蓝图数据
- 图元形状和 Mesh primitive
- 动画片段、关键帧轨道、Morph 轨道、Geometry Cache 轨道、骨骼和蒙皮绑定
- 脚本挂载信息

只有已注册的类和已注册的属性会被序列化。普通 JavaScript 字段如果没有序列化元数据，会被忽略。

## 加载和保存场景

场景文件以 JSON 形式保存在当前 VFS 中。

```ts
import { getEngine } from '@zephyr3d/scene';

const resources = getEngine().resourceManager;

const scene = await resources.loadScene('/scenes/level-01.json');

if (scene) {
  getEngine().setRenderable(scene, 0);
}
```

保存场景：

```ts
await getEngine().resourceManager.saveScene(scene, '/scenes/level-01.json');
```

目标 VFS 必须支持写入。例如 `MemFS` 和 `IDBFS` 适合编辑器类工作流；普通只读 HTTP 文件系统通常不能把文件写回服务器。

## 预制体

预制体是序列化后的 `SceneNode` 树。它适合复用导入后改过材质的模型、带脚本的交互物体、场景道具、UI 标记、粒子效果、水面区域或地形块。

```ts
const node = await getEngine().resourceManager.instantiatePrefab(scene.rootNode, '/prefabs/tree.zprefab');

if (node) {
  node.position.setXYZ(5, 0, -3);
}
```

预制体文件使用一个简单外壳：

```json
{
  "type": "SceneNode",
  "data": {
    "ClassName": "SceneNode",
    "Object": {}
  }
}
```

`data` 字段就是普通序列化对象。`instantiatePrefab()` 会检查外壳格式，创建节点，设置 `prefabId`，挂到指定父节点下，并为实例生成新的 persistent id。

## 序列化对象

使用 `serializeObject()` 可以对单个已注册对象做底层序列化。可选的 `asyncTasks` 数组会收集嵌入资源导出产生的异步写入任务。

```ts
const asyncTasks: Promise<unknown>[] = [];
const data = await getEngine().resourceManager.serializeObject(node, null, asyncTasks);

await Promise.all(asyncTasks);

const prefab = {
  type: 'SceneNode',
  data
};

await getEngine().VFS.writeFile('/prefabs/box.zprefab', JSON.stringify(prefab, null, 2), {
  encoding: 'utf8',
  create: true
});
```

使用 `deserializeObject()` 可以从 JSON 恢复一个已注册对象：

```ts
const restored = await getEngine().resourceManager.deserializeObject(scene.rootNode, prefab.data);

if (restored) {
  restored.parent = scene.rootNode;
}
```

普通场景文件和预制体文件优先使用 `loadScene()`、`saveScene()` 和 `instantiatePrefab()`。

## 资源身份

`ResourceManager` 会记录已加载资源的 asset id。序列化时可以写入已有资源引用，而不是把所有数据重新嵌入一份。

```ts
const texture = await resources.fetchTexture('/textures/albedo.png');

console.log(resources.getAssetId(texture)); // /textures/albedo.png
```

也可以手动关联 id：

```ts
resources.setAssetId(customTexture, '/generated/custom-texture.png');
```

这对编辑器工具很有用：先生成资源，再序列化引用这些资源的场景节点。

## 注册自定义可序列化类

自定义类必须先注册，才能被序列化。注册信息需要描述类名、构造函数、可选父类和属性访问器。

```ts
import type { SerializableClass } from '@zephyr3d/scene';

class GameSettings {
  speed = 1;
}

const gameSettingsClass: SerializableClass = {
  name: 'GameSettings',
  ctor: GameSettings,
  getProps() {
    return [
      {
        name: 'speed',
        type: 'float',
        get(this: GameSettings, value) {
          value.num[0] = this.speed;
        },
        set(this: GameSettings, value) {
          this.speed = value.num[0];
        }
      }
    ];
  }
};

getEngine().resourceManager.registerClass(gameSettingsClass);
```

注册后，这个对象就可以像内置类一样传给 `serializeObject()` 和 `deserializeObject()`。

## 实践建议

`.glb`、`.gltf`、`.fbx`、`.vrm` 这类只读源资产适合直接模型加载。

如果运行时对象包含源模型之外的引擎侧编辑，例如替换材质、脚本、修改后的变换、Morph Target 权重、导入后的 Joint Dynamics 设置、自定义元数据或编辑器添加的子节点，应使用预制体。

完整关卡状态适合使用场景序列化。场景文件会保存场景图，并通过 VFS 引用资源；移动项目时，需要把场景文件和它引用的资源一起移动。
