# AnimationController 动作编排

`AnimationSet` 负责底层动画片段播放。`AnimationController` 在它之上提供更高层的动作编排能力：命名状态、脚本化时间线、状态切换、事件响应以及淡入淡出过渡。

当角色、摄像机、道具或 UI 对象不再只是播放单个 clip，而是需要“待机 / 移动 / 攻击 / 打断 / 过场”等动作流程时，可以使用 `AnimationController`。

---

## 核心概念

| 概念 | 说明 |
|------|------|
| `AnimationController` | 管理命名状态，并把外部事件分发给当前状态。 |
| 状态 | 一个状态包含一条 timeline、可选事件响应表，以及默认过渡时间。 |
| `AnimationTimeline` | 可序列化的动作步骤列表，例如 play、stop、wait、emit、sequence、parallel。 |
| `AnimationTimelineRunner` | timeline 的运行时解释器，由所属 `AnimationSet` 的更新循环推进。 |
| 事件响应 | 定义某个事件发生时要切换状态、执行步骤、入队、忽略或消费。 |

控制器不会替代 `AnimationSet`。它仍然通过同一个 `AnimationSet` 创建播放实例，因此已有的动画融合、淡入、淡出、marker 和 frame 事件机制都会继续生效。

---

## 基础状态控制器

最常见的用法是注册多个状态，然后通过事件在状态之间切换。下面的示例创建了一个简单的待机 / 奔跑 / 攻击控制器：移动事件让角色在待机和奔跑之间切换，攻击事件播放一次性攻击动作，并通过 `returnTo: true` 在攻击结束后回到被打断的状态。

```typescript
import { AnimationController } from '@zephyr3d/scene';

// 将控制器绑定到模型的 AnimationSet，这样状态可以播放模型中的 clip。
const controller = new AnimationController(model.animationSet);

controller
  // idle 是默认循环状态，可以切换到 run 或 attack。
  .addState('idle', {
    // 进入 idle 时使用 0.2 秒淡入。
    transition: 0.2,
    timeline: {
      steps: [
        {
          // 当前状态激活期间一直循环播放 Idle。
          type: 'play',
          clip: 'Idle',
          options: { repeat: 0 }
        }
      ]
    },
    responses: [
      // 玩法输入 move 进入奔跑状态。
      { event: 'move', target: { targetState: 'run' } },
      // attack 打断 idle；因为 idle 是上一个状态，攻击结束后会回到 idle。
      { event: 'attack', target: { targetState: 'attack', returnTo: true }, onActive: { fadeOut: 0.12 } }
    ]
  })
  // run 也是循环状态，可以回到 idle，也可以被 attack 打断。
  .addState('run', {
    transition: 0.2,
    timeline: {
      steps: [
        {
          // 一直播放 Run，直到其它状态替换当前状态。
          type: 'play',
          clip: 'Run',
          options: { repeat: 0 }
        }
      ]
    },
    responses: [
      // 停止移动后回到 idle。
      { event: 'stopMove', target: { targetState: 'idle' } },
      // attack 打断 run；因为 run 是上一个状态，攻击结束后会回到 run。
      { event: 'attack', target: { targetState: 'attack', returnTo: true }, onActive: { fadeOut: 0.12 } }
    ]
  })
  // attack 是一次性状态。Attack clip 完成后，该状态的 timeline 也完成。
  .addState('attack', {
    transition: 0.12,
    timeline: {
      steps: [
        {
          // Attack 播放一次，并阻塞 timeline 直到该播放实例完成。
          type: 'play',
          clip: 'Attack',
          options: { repeat: 1 },
          wait: 'complete'
        }
      ]
    },
    responses: [
      // 可选的 cancel 输入可以提前打断攻击并回到 idle。
      { event: 'cancel', target: { targetState: 'idle' }, onActive: { fadeOut: 0.1 } }
    ]
  });

// 从 idle 启动状态机。
controller.setState('idle');

// 之后可由输入或玩法逻辑触发这些事件来驱动状态切换。
controller.dispatch('move');
controller.dispatch('attack');
```

`transition` 的单位是秒。进入带有正数过渡时间的状态时，旧状态的 runner 会淡出，新状态 timeline 的入口 play 步骤会淡入。

---

## Timeline 步骤

timeline 是一段可序列化的动作脚本。它运行在动画更新时钟上，不依赖 `async`、`await` 或浏览器定时器。

| Step | 作用 |
|------|------|
| `play` | 播放一个动画片段。设置 `wait: 'complete'` 时，会等待该播放实例完成或停止后再继续。 |
| `stop` | 停止指定 id 的播放实例；不写 `target` 时停止当前 runner 拥有的所有播放实例。 |
| `wait` | 等待固定秒数。 |
| `waitEvent` | 等待 `controller.dispatch(event)` 发来的同名事件。 |
| `waitMarker` | 等待某个播放实例经过指定 marker id 或名称。 |
| `waitFrame` | 等待某个播放实例经过指定帧号。 |
| `emit` | 从 runner 或 controller 向外发出一个事件。 |
| `sequence` | 按顺序执行子步骤。 |
| `parallel` | 把子步骤作为互相隔离的并行分支执行，所有分支结束后再继续。 |

例如，一个类似过场动画的流程可以同时编排摄像机、角色动作、等待和事件通知。下面的示例会并行播放摄像机开场动画，并在短暂延迟后让角色挥手；两个分支都结束后发出 `intro-finished`，再回到待机。

```typescript
// 注册一个短开场流程状态。
controller.addState('intro', {
  timeline: {
    steps: [
      {
        // 摄像机分支和角色分支同时运行。
        type: 'parallel',
        steps: [
          {
            // CameraIntro 播放一次，并让该分支等到 clip 完成。
            type: 'play',
            clip: 'CameraIntro',
            options: { repeat: 1 },
            wait: 'complete'
          },
          {
            // 角色分支先等 0.4 秒，再播放一次 Wave。
            type: 'sequence',
            steps: [
              { type: 'wait', seconds: 0.4 },
              { type: 'play', clip: 'Wave', options: { repeat: 1 }, wait: 'complete' }
            ]
          }
        ]
      },
      // 通知玩法逻辑：开场流程已经完全结束。
      { type: 'emit', event: 'intro-finished' }
    ]
  }
});

// 把 timeline 发出的事件转换成下一个 controller 状态。
controller.on('emit', (event) => {
  if (event === 'intro-finished') {
    controller.setState('idle');
  }
});
```

---

## Marker 与帧驱动的动作

如果后续步骤需要引用某个播放实例，可以在 `play` 步骤上设置 `id`。这适合命中帧、脚步声、音效、特效或可打断窗口。下面的示例启动攻击 clip，在动画到达作者标记的 `hit` marker 时发出 `attack-hit`，并在第 36 帧发出 `attack-recover`。

```typescript
// 注册一个会把动画时机暴露给玩法逻辑的攻击状态。
controller.addState('attackWithHitEvent', {
  transition: 0.1,
  timeline: {
    steps: [
      {
        // Attack 播放一次，并设置本地 id，供 waitMarker/waitFrame 引用。
        type: 'play',
        clip: 'Attack',
        id: 'attack',
        options: { repeat: 1 },
        // 不阻塞当前步骤，让后续 wait 步骤可以观察这个播放实例。
        wait: false
      },
      // 等到 Attack 播放实例经过名为 hit 的 marker。
      { type: 'waitMarker', marker: 'hit', target: 'attack' },
      // 在命中 marker 上精确通知玩法逻辑生成伤害或特效。
      { type: 'emit', event: 'attack-hit' },
      // 再等到作者指定的恢复帧。
      { type: 'waitFrame', frame: 36, target: 'attack' },
      // 通知玩法逻辑：攻击已经进入可恢复阶段。
      { type: 'emit', event: 'attack-recover' }
    ]
  }
});

// 处理攻击 timeline 产生的时机事件。
controller.on('emit', (event) => {
  if (event === 'attack-hit') {
    spawnHitEffect();
  } else if (event === 'attack-recover') {
    controller.setState('idle');
  }
});
```

`waitMarker` 可以使用 marker id 或 marker 名称。`waitFrame` 使用播放实例上报的帧号。

---

## 事件响应

通过 `controller.dispatch(name, payload)` 发送的事件按以下顺序处理：

1. 当前 runner 中匹配的 `waitEvent` 会先消费事件并推进 timeline。
2. 如果没有被 `waitEvent` 消费，会检查当前 timeline 自己的 `responses`。
3. 如果 timeline 仍未处理，会检查当前 controller 状态的 `responses`。
4. 如果没有任何响应处理该事件，结果中的 `handled` 为 `false`。

状态切换应写在 controller 状态的 `responses` 中。下面的片段把移动输入转换为状态切换：

```typescript
responses: [
  // 开始移动时进入奔跑状态。
  { event: 'move', target: { targetState: 'run' } },
  // 停止移动时回到待机状态。
  { event: 'stopMove', target: { targetState: 'idle' } }
]
```

临时一次性状态可以在 state-transition target 上设置 `returnTo: true`。它会记录切换前的状态，并在目标状态 timeline 完成后自动回去：

```typescript
responses: [
  {
    event: 'attack',
    target: {
      // 现在进入 Attack，结束后回到被 Attack 打断的那个状态。
      targetState: 'attack',
      returnTo: true
    },
    // 被打断的状态淡出，同时 Attack 淡入。
    onActive: { fadeOut: 0.12 }
  }
]
```

如果动作结束后总是要回到固定状态，也可以写状态名：

```typescript
responses: [
  {
    event: 'intro',
    target: {
      // 播放 Intro，结束后无论之前是什么状态都回到 Idle。
      targetState: 'intro',
      returnTo: 'idle',
      returnTransition: 0.25
    }
  }
]
```

当 `returnTransition` 大于 0 时，目标状态中已经完成的播放实例会继续保留这段时间并执行 completion fade-out，同时返回状态淡入。这样 `Attack` 这类自然完成的一次性动作不会在返回状态启动前被立即移除，而是会真正交叉淡回移动或待机状态。

响应也可以不切换状态，只临时执行一段动作步骤。下面的片段让受击反应与当前状态并行播放，而换弹动作会排队到当前主流程结束后再执行：

```typescript
responses: [
  {
    event: 'flinch',
    target: {
      steps: [
        {
          // 播放一次短 Flinch 叠加动作，不替换当前移动状态。
          type: 'play',
          clip: 'Flinch',
          options: { repeat: 1 },
          wait: false
        }
      ]
    },
    // 保留当前状态，把 Flinch 作为并行分支播放。
    onActive: 'keep'
  },
  {
    event: 'reload',
    target: {
      steps: [
        // 播放一次 Reload，并等它结束后再发出完成事件。
        { type: 'play', clip: 'Reload', options: { repeat: 1 }, wait: 'complete' },
        { type: 'emit', event: 'reload-finished' }
      ]
    },
    // 将 Reload 入队，让它在当前主流程结束后开始。
    enqueue: true
  }
]
```

`onActive` 用于控制当前正在运行的步骤：

| 值 | 行为 |
|----|------|
| `'stop'` | 先停止当前主流程，再执行响应步骤。默认值。 |
| `'keep'` | 响应步骤与当前流程并行执行。 |
| `{ fadeOut }` | 先用淡出停止当前主流程，再执行响应步骤。 |

`enqueue: true` 会把响应步骤追加到队列中，在当前主流程结束后再运行。

---

## 常见动作编排场景

下面的示例覆盖角色动作图中最常见的几类编排方式。每段代码都刻意保持较小范围，便于直接看出该场景的关键 API 用法。

### 单一动作循环播放

这个状态会一直循环播放一个待机 clip。这是最简单的 controller 状态：显式进入一次，然后保持循环播放，直到其它状态或 `stop()` 替换它。

```typescript
controller.addState('idleLoop', {
  timeline: {
    steps: [
      {
        // repeat: 0 表示 Idle clip 会无限循环。
        type: 'play',
        clip: 'Idle',
        options: { repeat: 0 }
      }
    ]
  }
});

// 需要显式进入循环状态；addState 只注册状态，不会自动激活。
controller.setState('idleLoop');
```

### 单一循环中插播一次性动作

这个控制器会保持 `Run` 循环播放。当收到 `attack` 事件时，插播一次 `Attack`。`returnTo: true` 会记录被打断的状态，因此一次性攻击完成后会自动回到 `runLoop`。

```typescript
controller
  .addState('runLoop', {
    transition: 0.15,
    timeline: {
      steps: [
        {
          // 没有临时动作时，持续播放移动循环。
          type: 'play',
          clip: 'Run',
          options: { repeat: 0 }
        }
      ]
    },
    responses: [
      {
        // 插播一次 Attack，结束后回到被打断的状态。
        event: 'attack',
        target: { targetState: 'attackOnce', returnTo: true, returnTransition: 0.12 },
        // Run 淡出，同时 Attack 淡入。
        onActive: { fadeOut: 0.12 }
      }
    ]
  })
  .addState('attackOnce', {
    transition: 0.12,
    timeline: {
      steps: [
        {
          // Attack 播放一次，并阻塞该状态直到播放完成。
          type: 'play',
          clip: 'Attack',
          options: { repeat: 1 },
          wait: 'complete'
        }
      ]
    }
  });
```

### 上下半身动作并行循环

这个状态会同时启动下半身和上半身循环。`RunUpper` 会同步到 `lowerRun`，因此即使上半身 clip 时长不同，也会从与下半身相同的归一化移动相位开始。

```typescript
controller.addState('layeredRun', {
  timeline: {
    steps: [
      {
        // 下半身奔跑是这个分层状态的相位参考。
        type: 'play',
        clip: 'RunLower',
        id: 'lowerRun',
        options: { repeat: 0 }
      },
      {
        // 上半身奔跑从 lowerRun 的同一归一化相位开始。
        type: 'play',
        clip: 'RunUpper',
        id: 'upperRun',
        options: {
          repeat: 0,
          sync: { target: 'lowerRun', mode: 'normalized' }
        }
      }
    ]
  }
});
```

### 上下半身循环中插播半身动作

这个响应会在 `RunLower` 持续循环时插播一次上半身射击。它先停止上半身循环，播放一次 `ShootUpper`，然后把 `RunUpper` 恢复到 `RunLower` 当前的相位。

```typescript
responses: [
  {
    event: 'shoot',
    target: {
      steps: [
        {
          // 只停止上半身循环；下半身奔跑继续作为相位源。
          type: 'stop',
          target: 'upperRun',
          options: { fadeOut: 0.08 }
        },
        {
          // 上半身射击播放一次。
          type: 'play',
          clip: 'ShootUpper',
          options: { repeat: 1, fadeIn: 0.08 },
          wait: 'complete'
        },
        {
          // 恢复上半身奔跑，但不从步态周期的 0 相位重新开始。
          // 复用 upperRun，后续 shoot 事件才能继续停止这次恢复后的播放。
          type: 'play',
          clip: 'RunUpper',
          id: 'upperRun',
          options: {
            repeat: 0,
            fadeIn: 0.12,
            sync: { target: 'lowerRun', mode: 'normalized' }
          }
        }
      ]
    },
    // 保持下半身分支运行，让上半身插播动作并行执行。
    onActive: 'keep'
  }
]
```

### 上下半身循环中插播全身动作

这个设置会在角色处于分层奔跑状态时插播一次全身闪避。状态切换使用淡出窗口保留 `RunLower`，因此 `DodgeFull` 启动时可以读取下半身的相位。`DodgeFull` 完成后，`returnTo: true` 会恢复之前被打断的分层状态。

```typescript
controller
  .addState('layeredRun', {
    transition: 0.15,
    timeline: {
      steps: [
        // 下半身奔跑是全身插播动作进入时的相位参考。
        { type: 'play', clip: 'RunLower', id: 'lowerRun', options: { repeat: 0 } },
        // 上半身奔跑叠加在下半身循环之上。
        {
          type: 'play',
          clip: 'RunUpper',
          options: { repeat: 0, sync: { target: 'lowerRun' } }
        }
      ]
    },
    responses: [
      {
        // 插播一次全身闪避，然后回到 layeredRun。
        event: 'dodge',
        target: { targetState: 'dodgeFull', returnTo: true, returnTransition: 0.15 },
        // 保留 RunLower 到 DodgeFull 启动时，供它读取相位。
        onActive: { fadeOut: 0.12 }
      }
    ]
  })
  .addState('dodgeFull', {
    transition: 0.12,
    timeline: {
      steps: [
        {
          // 全身动作从旧下半身奔跑的同一移动相位开始。
          type: 'play',
          clip: 'DodgeFull',
          options: {
            repeat: 1,
            sync: { target: 'RunLower', mode: 'normalized' }
          },
          wait: 'complete'
        }
      ]
    }
  });
```

`stop.target` 和 `sync.target` 都可以引用同一个 runner 中之前 `play` 步骤创建的本地 `id`，即使创建它的 frame 已经执行完毕。它们也可以按正在播放的 clip 名称或 playback id 查找目标。当某个响应停止了带名字的播放，并在稍后恢复同一条逻辑轨道时，需要在恢复用的 `play` 步骤上复用同一个 `id`，这样后续响应才会继续指向新的 playback。对应但时长不同的动作通常使用 `mode: 'normalized'`；如果多个 clip 的作者时间轴完全一致，可以使用 `mode: 'time'` 按秒复制时间。`offset` 可以偏移复制到的相位，`wrap: false` 则会把初始时间夹到目标 clip 或 range 内，而不是循环折返。

---

## Controller 事件

下面这些监听器适合调试动作图。它们会记录状态切换、一次性 timeline 完成、timeline 发出的事件，以及每次 dispatch 的最终处理策略。

```typescript
// setState() 改变当前状态或 stop() 清空状态时触发。
controller.on('statechange', (state, previousState) => {
  console.log('state changed', previousState, '->', state);
});

// 当前状态 runner 的所有 timeline 工作结束时触发。
controller.on('statecomplete', (state) => {
  console.log('state complete', state);
});

// timeline 中的 emit 步骤发出玩法事件时触发。
controller.on('emit', (event, payload) => {
  console.log('timeline emitted', event, payload);
});

// 每次 dispatch() 后都会触发，包括被忽略的事件。
controller.on('event', (event, payload, result) => {
  console.log('dispatch result', event, result.policy, result.handled);
});
```

`event` 通知适合调试动作图，因为它会告诉你某个输入事件是被消费、忽略、入队、转为步骤，还是触发了状态切换。

配置了 `returnTo` 时，`statecomplete` 会先于自动返回发出。如果监听器在 `statecomplete` 中切换到了其它状态，自动返回会被跳过，以监听器的状态切换为准。

---

## 实用建议

- 用 `AnimationController` 管理动作层逻辑，用 `AnimationSet` 做底层直接播放。
- timeline 中引用的 clip 名称必须和导入模型或手工创建的动画片段名称一致。
- 一次性动作使用 `repeat: 1`，例如攻击、翻滚、开门；循环状态使用 `repeat: 0`，例如待机、奔跑。
- 临时状态切换可使用 `returnTo: true`，让一次性动作结束后自动回到被打断的循环状态；需要完成动作淡出并淡入返回状态时，设置 `returnTransition`。
- 恢复上/下半身循环动作，或把分层移动切换为全身 clip 时使用 `options.sync`；如果新状态需要读取旧播放的相位，应使用短过渡让同步源保留到新状态启动。
- 常规过渡时间写在状态的 `transition` 上；特殊切换可用 `setState(name, { transition })` 或响应里的 `{ fadeOut }` 覆盖。
- 如果动画资源中有 marker，优先用 `waitMarker` 做命中、脚步、音效等时机；依赖固定帧号的流程可用 `waitFrame`。
- 循环状态通常不会触发 `statecomplete`，因为它们的播放实例不会自然结束，除非被停止或打断。
