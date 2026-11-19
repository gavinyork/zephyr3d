# 骨骼动画网格实例化

骨骼动画网格和静态网格一样可以合批。同一角色模型的多个实例共用模型的图元、使用其材质的实例时，会合并成一次实例化绘制；每个实例从所有骨骼网格共用的一张纹理（skin palette atlas）中读取自己的骨骼矩阵。因此一群角色可以各自播放不同的动作，而只需要几次 draw call，WebGL2 和 WebGPU 都是如此。不过实例化不减少动画计算：每个实例仍在 CPU 上逐帧摆放自己的骨骼，除非用 [GPU 动画](#gpu-动画)从烘焙好的姿态播放片段。

> 本页代码取自下方嵌入的可运行示例（`tut-92`），省略了 import 与应用初始化。

## 用代码创建角色群

<div class="showcase" case="tut-92"></div>

示例用一个 Mixamo 角色的多个副本铺满网格，每个角色以各自的速度和相位播放待机、行走或奔跑。下拉框设置人群规模，第一个复选框为所有角色开关 `gpuAnimation`，第二个给每四个角色中的一个戴上帽子（见 [GPU 动画](#gpu-动画)）。面板显示有多少角色正在使用烘焙姿态、整帧的 draw call 数（包括阴影贴图和后处理），后者几乎不随人群规模变化，以及一帧的 CPU 耗时，从中可以看出 `gpuAnimation` 省下了多少。

### 一个模型，多个实例

每个角色都是模型的一个独立实例，加载时开启 `enableInstancing`：

<<< @/../src/tut-92/main.js#actor

`fetchModel` 对同一个模型文件只下载、解析一次，在它还有实例时保留这份数据，因此之后的调用只创建节点，所有实例共用模型的图元和材质。`enableInstancing: true` 让每个网格使用其材质的实例（`createInstance()`）。**不开启时网格直接使用材质本身，完全不参与合批**：每个角色的每个网格在每个 pass 中都各占一次 draw call。

`play()` 返回播放句柄；设置它的 `normalizedTime` 让角色从片段的不同位置开始，再配合 `speedRatio` 选项，人群就不会整齐划一地动作。合批本身不需要别的代码：渲染队列每帧自动把可见网格分组。

`SceneNode.clone()` 也能创建实例。它是异步的：先把节点序列化，再从数据构建副本。对于从模型文件加载的节点，副本会从该模型文件重新构建，再应用有差异的属性，例如变换、材质实例和 `gpuAnimation`；运行时添加到节点上的片段不在其中，所以副本没有这些片段。创建一群角色时，每个实例调用一次 `fetchModel` 开销更小。

### 来自其他文件的片段

模型文件中自带的片段会随每个实例一起创建，所有实例共用它们的关键帧。运行时添加的片段只属于一个 `AnimationSet`。这里的片段来自单独的文件，用 `copyHumanoidAnimationFrom` 重定向到角色上（见[骨骼动画重定向](zh-cn/animation-skeleton.md#骨骼动画重定向)），而且只做一次，目标是一个隐藏的、作为模板的实例：

<<< @/../src/tut-92/main.js#clips

对每个角色分别重定向也可以，但每个角色都会复制一份全部关键帧，每个片段还要花不少时间。示例的做法是给每个角色创建自己的轨道，复用模板轨道的插值器（关键帧就保存在插值器中）：

<<< @/../src/tut-92/main.js#share

这些轨道类来自 `@zephyr3d/scene`。轨道必须是新对象，因为一个轨道只能属于一个片段，而且它们驱动的是这个角色自己的关节；共用的只有关键帧。同一模型的两个实例节点树相同，所以示例按遍历顺序配对节点，按在 `animationSet.rigs` 中的下标配对骨架；`addSkeleton` 传入的是角色自己骨架的 `persistentId`。

## 适用条件与开销

- 合批需要材质实例：加载模型时传 `enableInstancing: true`，代码创建的网格用 `material.createInstance()`，或在编辑器中开启 **Geometry Instance**。
- 共用同一个图元和同一个核心材质的网格合成一个批次。骨骼网格还要求 skin space 相同，即从骨架参考节点到网格的变换，同一模型的所有实例都满足。镜像的实例（负缩放）单独成批。
- 带 Morph Target 的网格，以及每个顶点超过 4 个骨骼影响的网格，不参与合批。
- WebGL2 和 WebGPU 都以实例化 draw call 绘制批次。在 WebGPU 上的 `BatchGroup` 中，`gpuInstanceCulling`（默认开启）还会在 compute pass 中针对每个视图逐实例剔除，批次改为间接绘制；批次很大且只看得到一部分时保持开启。见 [BatchGroup 合批](zh-cn/performance.md#batchgroup-合批)。
- 逐实例数据打包在 64 KB 的 uniform buffer 中，很大的批次会自动拆成几次 draw call，每次几百个实例。
- 实例化减少的是 draw call，不是动画计算：每个实例仍要逐帧摆放骨骼、写入自己的骨骼矩阵。下面的 GPU 动画能把这部分工作的大头从 CPU 上拿走。

## GPU 动画

合批减少了 draw call，但每个实例仍在 CPU 上逐帧求值骨骼动画。角色很多时，可以打开 `AnimationSet.gpuAnimation`（默认关闭）；示例在上面的 `createActor` 中为每个角色设置它。

播放接口和动画事件都不变。某个实例**只有一个片段在播放、且这个片段只驱动关节**时，引擎改用烘焙好的姿态：

- 片段在第一次被某个实例播放时烘焙，按每秒 30 帧采样，采样之间的姿态插值得到。烘焙的那一刻可能有短暂卡顿。
- 烘焙结果由从同一模型文件或预制体创建的所有实例共享，例如示例中的角色都来自同一个 `fetchModel` URL；用代码搭建的模型各自烘焙。共享的片段按名字查找，所以同一模型的实例不要把同一个名字用在不同的片段上。
- 在 WebGPU 上姿态由 compute pass 求值；在 WebGL2 上由 CPU 求值，每个实例一套骨骼矩阵，仍然省掉了摆放关节节点的开销。两种后端上网格都保持合批。

不满足条件的帧会无缝回退到常规路径，包括：片段之间的交叉淡化和其他混合、IK 和 JointDynamics 等骨骼修改器、GPU 布料、挂在关节下的节点（它们需要跟随关节节点）。在编辑器中、非播放模式下，动画总是走常规路径。示例中的帽子演示的就是最后一种情况：

<<< @/../src/tut-92/main.js#hats

烘焙姿态播放期间关节节点不会移动，代码读到的关节变换停留在切换到烘焙姿态的那一刻。可以用 `animationSet.isPlayingOnGpu` 查询当前是否在使用烘焙姿态；在 WebGL2 上同样有效，只是姿态由 CPU 求值。示例统计它并显示在面板上，旁边是这一帧的 draw call 数：

<<< @/../src/tut-92/main.js#stats

`getDevice().frameInfo.drawCalls` 统计的是当前帧的 draw call，所以示例在 `setRenderable` 的 `afterRender` 钩子里、场景绘制完成之后读取它。

**需要控制骨骼的角色不适合用 GPU 动画。**

- 骨骼上挂了 IK、JointDynamics（骨骼物理）等骨骼修改器的实例，会一直走常规路径，在 CPU 上逐帧求值骨骼。它们仍会和其他兼容的实例合并绘制，draw call 不会增加，但骨骼计算省不掉，对它们开 `gpuAnimation` 没有收益。
- 直接在代码里修改关节节点的变换（不经过骨骼修改器）不会被引擎检测到。烘焙姿态播放期间网格不读关节节点，这些修改会**静默失效**。需要在代码里控制关节时，要么对这个实例关闭 `gpuAnimation`，要么把控制逻辑写成 `SkeletonModifier`，用 `rig.modifiers.push()` 挂到骨骼上（见 [IK](zh-cn/animation-ik.md)），引擎会因此自动改走常规路径。

## 与 LOD、SDF 的关系

骨骼网格可以同时使用 Mesh LOD；各 LOD 共享顶点缓冲，但每个实例仍读取自己的 palette。带 skin 或 morph 的网格在 `Mesh.sdfMode = 'auto'` 时会被视为动态 SDF 实例，不能当作静态几何缓存到全局 SDF。

## 排查

若 draw call 没有下降，先确认网格使用的是材质实例（加载时传 `enableInstancing`），再检查实例是否共用图元和核心材质、skin space 是否相同，以及有没有网格带 Morph Target 或每个顶点超过 4 个骨骼影响。在 `BatchGroup` 中，给网格换图元或材质会重建缓存的批次，不要每帧这样做。

若开启 `gpuAnimation` 后 `isPlayingOnGpu` 一直为 false，对照上面的回退条件检查：是否有多个片段在播放、骨架上是否挂了骨骼修改器、是否有 GPU 布料、关节下是否挂了节点。
