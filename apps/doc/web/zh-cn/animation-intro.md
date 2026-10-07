# 动画（Animation）

> 本页代码为片段示意，省略了 import 与应用初始化。各专题页面里有完整可运行的实例。

Zephyr3D 的动画都通过节点的 `AnimationSet` 播放。它支持以下几类动画：

| 类型         | 说明                                             | 参见                                                         |
| ------------ | ------------------------------------------------ | ------------------------------------------------------------ |
| 骨骼动画     | 驱动蒙皮网格的骨骼，支持部分骨骼遮罩与人形重定向 | [骨骼动画](zh-cn/animation-skeleton.md)                      |
| 关键帧动画   | 节点的位置、旋转、缩放，以及材质等属性           | [关键帧动画](zh-cn/animation-keyframe.md)                    |
| Morph Target | 顶点形变（BlendShape），例如表情                 | [Morph Target / BlendShape](zh-cn/animation-morph-target.md) |
| 自定义轨道   | 自己实现状态的计算、应用与混合                   | [自定义动画](zh-cn/animation-custom.md)                      |

IK、JointDynamics 等程序化动画叠加在播放结果之上，见 [IK](zh-cn/animation-ik.md) 和 [JointDynamics](zh-cn/animation-joint-dynamics.md)。

---

## 结构概览

| 类                    | 作用                                                                                        |
| --------------------- | ------------------------------------------------------------------------------------------- |
| `AnimationSet`        | 节点上的动画集合：管理动画片段，播放、混合并更新它们。通过 `node.animationSet` 获取。       |
| `AnimationClip`       | 一段命名动画，例如"跑步"。由若干轨道组成，带有时长、帧率和标记点。                          |
| `AnimationTrack`      | 轨道，控制某个对象的某项属性如何随时间变化。                                                |
| `AnimationPlayback`   | 一次播放的运行时句柄：查询进度、暂停、跳转、淡入淡出、监听事件。                            |
| `AnimationController` | 动作编排：把片段组织成状态、时间线和事件响应。见[动作编排](zh-cn/animation-controller.md)。 |

动画由引擎每帧自动更新，不需要手动调用 `update()`。

---

## 播放与停止

`play()` 开始播放一个片段，并返回它的 `AnimationPlayback`；片段不存在时返回 `null`。

```javascript
const animSet = model.animationSet;
console.log(animSet.getAnimationNames());

const playback = animSet.play('walk', {
  repeat: 0, // 0 表示无限循环
  speedRatio: 1, // 播放速度，负数表示倒放
  fadeIn: 0.3 // 0.3 秒内权重从 0 升到目标值
});

// 按名称停止，0.2 秒淡出
animSet.stopAnimation('walk', { fadeOut: 0.2 });
```

`playAnimation()` 与 `play()` 作用相同，只是没有返回值，保留它是为了兼容旧代码。

**每个片段同一时刻只有一个播放实例。** 再次播放一个正在播放的片段，会先停止原来的实例（停止原因为 `'replaced'`），再从头开始播放。

### 播放选项

| 选项                                       | 默认值     | 作用                                                                                                      |
| ------------------------------------------ | ---------- | --------------------------------------------------------------------------------------------------------- |
| `repeat`                                   | 0          | 循环次数，0 为无限循环                                                                                    |
| `speedRatio`                               | 1          | 播放速度倍率；负数倒放，从片段末尾开始                                                                    |
| `fadeIn`                                   | 0          | 淡入时长（秒）                                                                                            |
| `completionFadeOut`                        | 0          | 自然播放完毕时的淡出时长：到结尾时先发出 `complete`，再保持这段时间淡出，便于下一个动作从结束姿态平滑衔接 |
| `weight`                                   | 片段的权重 | 多个动画同时影响同一属性时的混合权重，见[动画融合](zh-cn/animation-blending.md)                           |
| `range`                                    | 整个片段   | 只播放其中一段：`{ start, end }`，可以用秒、帧或标记点表示（见下文）                                      |
| `sync`                                     | 无         | 从另一个正在播放的动画的相位开始（见下文）                                                                |
| `id`、`layer`、`priority`、`interruptible` |            | 供动作编排等上层逻辑使用的标识、分层与打断规则                                                            |

---

## 播放实例 AnimationPlayback

`play()` 返回的句柄在整个播放期间都可以使用：

```javascript
const playback = animSet.play('attack', { repeat: 1 });

playback.pause();
playback.resume();
playback.seek(0.5); // 跳到 0.5 秒
playback.normalizedTime = 0.5; // 或者跳到一半
playback.speedRatio = 0.5; // 改为半速
playback.fadeTo(0.3, 0.2); // 0.2 秒内把权重降到 0.3

// 0.3 秒内交叉淡化到另一个片段，返回新片段的播放实例
const idle = playback.crossFadeTo('idle', { duration: 0.3, repeat: 0 });

// 正在播放的实例也可以随时取回
animSet.getPlayback('idle');
```

| 属性                              | 说明                                                                                                       |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `state`                           | `'scheduled'`（已创建未开始）、`'playing'`、`'paused'`、`'stopping'`（淡出中）、`'stopped'`、`'completed'` |
| `time` / `normalizedTime`         | 当前时间（秒）/ 占片段时长的比例；都可写，写入相当于跳转                                                   |
| `weight`、`speedRatio`            | 当前权重与速度，可写                                                                                       |
| `clip`、`id`、`layer`、`priority` | 所播放的片段和播放选项里的标识                                                                             |

`seek(time, { emitEvents, apply })` 默认既不发出跨越的标记点事件，也不立即应用姿态；需要时分别传 `emitEvents: true` 和 `apply: true`。

---

## 事件与等待

播放实例在关键时刻发出事件：

| 事件               | 时机                                                                                     |
| ------------------ | ---------------------------------------------------------------------------------------- |
| `start`            | 开始播放                                                                                 |
| `loop`             | 完成一次循环、开始下一次                                                                 |
| `marker`           | 播放经过一个标记点                                                                       |
| `frame`            | 播放经过一个用 `waitForFrame()` 等待的帧                                                 |
| `complete`         | 所有循环播放完毕                                                                         |
| `stop`             | 停止，带 `reason`：`'manual'`、`'interrupted'`、`'completed'`、`'deleted'`、`'replaced'` |
| `pause` / `resume` | 暂停 / 恢复                                                                              |

```javascript
playback.on('marker', (ev) => console.log('marker', ev.marker.name, ev.time));
playback.on('stop', (ev) => console.log('stopped:', ev.reason));
```

也可以用 Promise 等待，写成顺序流程：

```javascript
const attack = animSet.play('attack', { repeat: 1 });
await attack.waitForMarker('hit'); // 到达 hit 标记点
applyDamage();
await attack.waitForComplete(); // 播放完毕
animSet.play('idle');
```

注意 `waitForComplete()` 只在 `complete` 时 resolve：手动停止、被打断，或者 `repeat: 0` 的无限循环，都不会触发它。需要处理这些情况时，改为监听 `stop` 事件。`waitForMarker()` 和 `waitForFrame()` 在播放停止时 resolve 为 `undefined`。

想统一监听节点上所有动画，可以在 `AnimationSet` 上订阅同类事件，名称加了 `playback` 前缀：`playbackstart`、`playbackloop`、`playbackcomplete`、`playbackstop`、`playbackpause`、`playbackresume`，以及 `marker`、`frame`。

---

## 标记点与时间引用

标记点是片段时间轴上的命名位置，用于触发脚步声、命中判定等游戏逻辑：

```javascript
const clip = animSet.getAnimationClip('attack');
clip.addMarker({ name: 'hit', time: 0.42 });
clip.addMarker({ name: 'footstep', frame: 12, payload: { foot: 'left' } }); // 按片段帧率换算成时间
```

播放区间 `range` 以及动作编排里需要时间点的地方，都接受以下几种写法：

```javascript
animSet.play('attack', { range: { start: 0.2, end: { marker: 'hit' } } });
// 0.2             秒
// { time: 0.2 }   秒
// { frame: 6 }    帧，按片段的 frameRate 换算，也可以带 fps
// { marker: 'hit' } 标记点的位置
```

标记点目前只存在于运行时：不会随场景保存，编辑器里也还不能编辑，需要在代码中（例如加载模型之后）添加。

---

## 相位同步

在走路切到跑步这类动作之间切换时，新动画应当从同一步态相位开始，否则脚步会错乱。`sync` 让新的播放实例从另一个正在播放的动画的相位开始：

```javascript
animSet.play('walk', { repeat: 0 });
// ...
// 先按 walk 当前的相位启动 run，再淡出 walk
animSet.play('run', {
  repeat: 0,
  fadeIn: 0.3,
  sync: { target: 'walk' } // 默认按比例：walk 走到 40% 时，run 也从 40% 开始
});
animSet.stopAnimation('walk', { fadeOut: 0.3 });
```

`target` 可以是正在播放的片段名，也可以是播放实例的 `id`。`mode: 'time'` 改为按秒对齐，`offset` 加上相位偏移，`wrap: false` 表示超出范围时截断而不是绕回。

---

## 动作编排

用代码直接串联 `play()` 和事件适合简单场景。角色有待机、移动、攻击、受击，需要处理打断、插播和上下半身分层时，用 `AnimationController` 把这些规则声明成状态：

```javascript
const controller = new AnimationController(model.animationSet);
controller.addState('idle', {
  timeline: { steps: [{ type: 'play', clip: 'Idle', options: { repeat: 0 } }] }
});
controller.setState('idle');
```

状态的时间线、事件响应、插播、并行与分层播放，见[动作编排](zh-cn/animation-controller.md)。

---

## 创建动画

模型导入时自带的动画会自动加入 `AnimationSet`。也可以用代码创建片段并添加轨道：

```javascript
const clip = animSet.createAnimation('bob');
clip.addTrack(node, track); // track 为内置或自定义的 AnimationTrack
animSet.play('bob');

animSet.getAnimationClip('bob');
animSet.deleteAnimation('bob');
```

内置轨道（平移、旋转、缩放、属性等）与插值方式见[关键帧动画](zh-cn/animation-keyframe.md)，自己实现轨道见[自定义动画](zh-cn/animation-custom.md)。

> 推荐使用 Zephyr3D 编辑器来创建和编辑动画及轨道，见[编辑器中的动画](zh-cn/editor/animation-overview.md)。
