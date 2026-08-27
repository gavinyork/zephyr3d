# Morph Target / BlendShape

Morph target，也常称为 BlendShape，用于通过多个顶点偏移目标来混合出网格变形。它常用于面部表情、口型、肌肉隆起、修正形变，以及骨骼不容易精确控制的局部变形。

Morph target 不会改变网格拓扑。每个 target 都对应基础网格上的同一批顶点，运行时根据当前权重在 GPU 上计算最终顶点数据。

---

## 主要类

| 类 / 函数 | 作用 |
|-----------|------|
| `Mesh` | 保存 morph target 数据和每个 target 的权重 |
| `SceneNode` | 提供面向子树的 morph target 和表情组辅助接口 |
| `SceneMorphTargetGroup` | 运行时模型实例上的表情 / 分组绑定 |
| `AssetMorphTargetGroup` | 模型级表情 / 分组数据，通常来自 VRM |
| `MorphTargetTrack` | glTF `weights` 动画通道对应的动画轨道 |

---

## 加载 Morph Target

包含 primitive `targets` 的 glTF / GLB 模型会在加载时自动导入 morph target 数据。

```javascript
const model = await getEngine().resourceManager.fetchModel(
  '/assets/character.glb',
  scene
);

model.parent = scene.rootNode;
```

加载器也会读取 glTF mesh `weights` 和 node `weights` 作为初始权重。target 名称来自 `extras.targetNames`；如果 target 没有名称，Zephyr3D 会使用 `Target0`、`Target1` 这样的默认名。

可以从模型根节点查看导入结果：

```javascript
const targetNames = model.collectMorphTargetNames();
const groupNames = model.collectMorphTargetGroupNames();

console.log(targetNames);
console.log(groupNames);
```

对于 VRM 模型，VRM 0.x 的 BlendShape 组和 VRM 1.0 的 expressions 会被导入为 morph target group。常见 group 名包括 `happy`、`angry`、`blink` 等表情名，或 `aa` 这样的口型名。

加载 Zephyr3D 预制体时，也会自动恢复 Morph Target：

```javascript
const model = await getEngine().resourceManager.instantiatePrefab(
  scene.rootNode,
  '/assets/character.zprefab'
);
```

对于 `.zprefab`，序列化的 morph target 数据、target 名称、当前权重、包围盒信息和 morph target group 都会作为 prefab 内容恢复。这一点和直接加载模型不同：模型资源会从源文件导入 morph target，但模型的 Morph Target 设置不会作为模型资源数据序列化。如果需要持久化编辑后的 Morph Target 设置，应保存为预制体。

---

## 设置 Target 权重

如果希望按名称驱动模型下所有同名 target，可以使用 `SceneNode.setMorphTargetWeight()`：

```javascript
model.setMorphTargetWeight('Smile', 0.8);
model.setMorphTargetWeight('Blink_L', 1);
```

如果已经拿到了具体的 mesh 节点，可以直接控制该 mesh 上的 target：

```javascript
if (faceMesh.isMesh()) {
  const smileIndex = faceMesh.getMorphTargetIndexByName('Smile');

  if (smileIndex >= 0) {
    faceMesh.setMorphWeightByIndex(smileIndex, 0.75);
  }

  faceMesh.setMorphWeight('Blink_L', 1);
  const currentSmile = faceMesh.getMorphWeight('Smile');
}
```

如果要一次设置同一 mesh 上的多个权重，可以使用 `updateMorphWeights()`：

```javascript
if (faceMesh.isMesh()) {
  faceMesh.updateMorphWeights([
    0.8, // Target0
    0.0, // Target1
    1.0  // Target2
  ]);
}
```

传入数组的长度不能超过该 mesh 的 morph target 数量。

---

## Morph Target Group

Morph target group 适合把一个完整表情映射到多个 target，甚至多个 mesh。例如 `happy` 表情可以同时驱动嘴角、脸颊和眼部 target。

导入的 VRM 表情可以直接从模型根节点控制：

```javascript
const expressions = model.collectMorphTargetGroupNames();

model.setMorphTargetGroupWeight('happy', 1);
model.setMorphTargetGroupWeight('blink', 0);
```

`setMorphTargetGroupWeight()` 会先查找运行时或模型级 group。如果找不到同名 group，会退回到 `setMorphTargetWeight()`，把权重应用到同名 mesh target 上。

也可以手动创建运行时 group：

```javascript
model.morphTargetGroups = [
  {
    name: 'smileLeft',
    bindings: [
      {
        mesh: faceMesh,
        targetName: 'Smile_L',
        weight: 1
      },
      {
        mesh: faceMesh,
        targetName: 'Cheek_L',
        weight: 0.5
      }
    ],
    weight: 0
  }
];

model.setMorphTargetGroupWeight('smileLeft', 0.6);
```

如果是开关型 group，可设置 `isBinary: true`。这类 group 会以 `0.5` 为阈值，把输入权重转换为 `0` 或 `1`。

---

## Morph Target 动画

glTF 中 target path 为 `weights` 的动画通道会自动转换为 `MorphTargetTrack`。播放方式和骨骼动画、关键帧动画一致，都通过模型的 `animationSet` 控制：

```javascript
const animationNames = model.animationSet.getAnimationNames();

if (animationNames.length > 0) {
  model.animationSet.playAnimation(animationNames[0], {
    repeat: 0
  });
}
```

`MorphTargetTrack` 会一次驱动某个 mesh 的全部 morph 权重，并参与普通动画融合流程。

---

## 材质和渲染

标准网格材质会自动处理 morph target 的位置、法线和切线偏移。基于 `MeshMaterial` 的自定义材质也会在基类顶点着色流程中获得通用的 skinning 和 morphing 设置。

如果自定义顶点着色器绕过了通用辅助流程，可使用 `ShaderHelper.hasMorphing()` 和 `ShaderHelper.calculateMorphDelta()` 自行应用需要的 morph 属性。

---

## 注意事项

- 单个 mesh 最多支持 `256` 个 morph target。
- glTF 导入器支持的 morph 属性包括 `POSITION`、`NORMAL`、`TANGENT`、`TEXCOORD_0` 到 `TEXCOORD_3`，以及 `COLOR_0`。
- target 名称是 mesh 级别的；不确定导入名称时，可先调用 `collectMorphTargetNames()` 查看。
- 直接加载的模型资源不会序列化 Morph Target 设置。如果需要保存并恢复当前 target 权重、group 绑定或导入后的 target 数据，请使用 `.zprefab`。
- `setMorphWeight()` 和 `setMorphTargetGroupWeight()` 不会强制截断权重。大多数表情工作流使用 `[0, 1]` 范围，但如果资源本身按修正或夸张形变制作，也可以使用范围外的数值。
- Morph target 可以和骨骼动画同时使用。网格材质管线会同时应用 skinning 和 morphing。
