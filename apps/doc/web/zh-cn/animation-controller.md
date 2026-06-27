# AnimationController 动作编排

`AnimationSet` 负责底层 clip 播放，`AnimationController` 负责把这些 clip 组织成可响应输入的动作流程：待机、移动、攻击、打断、插播、分层播放、过场和动画事件。

这篇文档按从简单到复杂的顺序展开。你可以先照着前几个例子搭出一个基础状态机，再逐步加入一次性动作、marker 事件、并行动作和相位同步。

---

## 先理解三个概念

| 概念 | 用途 |
|------|------|
| 状态 | 一个命名动作模式，例如 `idle`、`run`、`attack`。进入状态时会运行它的 timeline。 |
| timeline | 状态内执行的步骤数组，例如播放 clip、等待、发事件、并行执行分支。 |
| response | 当前状态收到外部事件时的反应，例如切换状态、插播动作、入队或忽略。 |

控制器不会替代 `AnimationSet`。所有播放实例仍由同一个 `AnimationSet` 创建，因此淡入淡出、marker、frame、mask、权重和相位同步都沿用底层动画系统。

```typescript
import { AnimationController } from '@zephyr3d/scene';

// 控制器绑定到模型的 AnimationSet；后续状态会按 clip 名称播放这里面的动画。
const controller = new AnimationController(model.animationSet);
```

---

## 1. 播放一个循环动作

最小可用的状态只需要一个 `play` 步骤。`repeat: 0` 表示无限循环。`addState()` 只注册状态，不会自动播放；需要调用 `setState()` 进入状态。

```typescript
controller.addState('idle', {
  timeline: {
    steps: [
      {
        // Idle 会一直循环，直到 controller 切换到其它状态或 stop()。
        type: 'play',
        clip: 'Idle',
        options: { repeat: 0 }
      }
    ]
  }
});

// 显式进入 idle，Idle 才会开始播放。
controller.setState('idle');
```

效果：角色进入 `idle` 状态后持续播放 `Idle`，适合作为待机、奔跑这类基础循环。

<div class="showcase" case="tut-56"></div>

---

## 2. 用事件切换状态

状态可以定义 `responses`。外部代码调用 `controller.dispatch('move')` 时，当前状态会查找同名 response 并执行它。

```typescript
controller
  .addState('idle', {
    transition: 0.2,
    timeline: {
      steps: [
        {
          // 待机状态持续播放 Idle。
          type: 'play',
          clip: 'Idle',
          options: { repeat: 0 }
        }
      ]
    },
    responses: [
      {
        // 收到 move 输入时切换到 run。
        event: 'move',
        target: { targetState: 'run' }
      }
    ]
  })
  .addState('run', {
    transition: 0.2,
    timeline: {
      steps: [
        {
          // 奔跑状态持续播放 Run。
          type: 'play',
          clip: 'Run',
          options: { repeat: 0 }
        }
      ]
    },
    responses: [
      {
        // 停止移动时回到 idle。
        event: 'stopMove',
        target: { targetState: 'idle' }
      }
    ]
  });

controller.setState('idle');

// 输入系统或玩法逻辑可以用事件驱动状态机。
controller.dispatch('move');
controller.dispatch('stopMove');
```

效果：`idle` 和 `run` 互相切换。`transition` 单位是秒，进入目标状态时会让旧状态淡出、目标状态入口播放淡入。

<div class="showcase" case="tut-57"></div>

---

## 3. 插播一次性动作并自动返回

攻击、翻滚、开门这类动作通常播放一次，然后回到被打断的循环状态。用 `returnTo: true` 可以让控制器记录当前状态，并在目标状态 timeline 完成后自动返回。

```typescript
controller
  .addState('run', {
    transition: 0.2,
    timeline: {
      steps: [
        {
          // 平时一直播放 Run。
          type: 'play',
          clip: 'Run',
          options: { repeat: 0 }
        }
      ]
    },
    responses: [
      {
        // Attack 播放完成后会自动回到 run。
        event: 'attack',
        target: { targetState: 'attack', returnTo: true, returnTransition: 0.15 },
        // Run 用 0.12 秒淡出，Attack 用 attack 状态的 transition 淡入。
        onActive: { fadeOut: 0.12 }
      }
    ]
  })
  .addState('attack', {
    transition: 0.12,
    timeline: {
      steps: [
        {
          // repeat: 1 表示播放一次。
          // wait: 'complete' 会让 attack 状态等到 Attack 播放完成才结束。
          type: 'play',
          clip: 'Attack',
          options: { repeat: 1 },
          wait: 'complete'
        }
      ]
    }
  });
```

效果：奔跑中收到 `attack` 后切到 `attack` 状态。`Attack` 自然完成后，控制器自动回到 `run`。`returnTransition` 会让完成的攻击动作保留一小段 completion fade-out，同时返回状态淡入，避免动作结束瞬间被硬切掉。

<div class="showcase" case="tut-58"></div>

---

## 4. 串行、重叠播放与显式并行

`steps` 是顺序执行的，但 `play` 默认不阻塞。因此连续写两个 `play` 会让两个 clip 几乎同时启动。

```typescript
steps: [
  {
    // A 启动后不等待完成。
    type: 'play',
    clip: 'A'
  },
  {
    // B 会在同一次 flush 中接着启动，因此 A 和 B 会重叠播放。
    type: 'play',
    clip: 'B'
  }
]
```

如果 `play` 写了 `wait: 'complete'`，后面的步骤会等它完成后再执行。

```typescript
steps: [
  {
    // A 播放完成前，B 不会开始。
    type: 'play',
    clip: 'A',
    options: { repeat: 1 },
    wait: 'complete'
  },
  {
    // A 完成后才播放 B。
    type: 'play',
    clip: 'B'
  }
]
```

当你需要表达“多个分支同时开始，并等所有分支结束后再继续”时，用 `parallel`。分支里需要多个步骤时，用 `sequence` 包起来。

```typescript
controller.addState('intro', {
  timeline: {
    steps: [
      {
        // 摄像机分支和角色分支并行运行。
        type: 'parallel',
        steps: [
          {
            // 摄像机开场动画播放一次，完成后该分支结束。
            type: 'play',
            clip: 'CameraIntro',
            options: { repeat: 1 },
            wait: 'complete'
          },
          {
            // 角色分支先等 0.4 秒，再挥手一次。
            type: 'sequence',
            steps: [
              { type: 'wait', seconds: 0.4 },
              { type: 'play', clip: 'Wave', options: { repeat: 1 }, wait: 'complete' }
            ]
          }
        ]
      },
      // 两个分支都结束后通知外部逻辑。
      { type: 'emit', event: 'intro-finished' }
    ]
  }
});
```

效果：`CameraIntro` 和角色 `Wave` 编排在同一个过场状态中。`intro-finished` 只会在两个分支都结束后发出。

---

## 5. 在动作中途发出事件

命中、开火、脚步声、可取消窗口通常需要发生在动画内部某个时间点。推荐用 marker 表达动画时间点，再用 `waitMarker` 等它。

```typescript
// 如果导入资源里没有 marker，可以手动把 0.3 秒处注册为 hit。
// 动画使用连续时间轴；没有稳定作者帧率时，优先用 time 而不是 frame。
controller.animationSet.getAnimationClip('Attack')?.addMarker({
  id: 'hit',
  name: 'hit',
  time: 0.3
});

controller.addState('attackWithHit', {
  timeline: {
    steps: [
      {
        // 给 Attack 播放实例设置本地 id，后续 waitMarker 才能指定目标。
        type: 'play',
        clip: 'Attack',
        id: 'attack',
        options: { repeat: 1 },
        // 不阻塞，让后续 waitMarker 可以观察同一个播放实例。
        wait: false
      },
      {
        // 等 Attack 播放实例经过 hit marker。
        type: 'waitMarker',
        marker: 'hit',
        target: 'attack'
      },
      {
        // 把动画时机转换成玩法事件。
        type: 'emit',
        event: 'attack-hit'
      }
    ]
  }
});

controller.on('emit', (event) => {
  if (event === 'attack-hit') {
    spawnHitEffect();
  }
});
```

这个最小示例只演示“等 marker 后发事件”，timeline 会在 `attack-hit` 后结束。如果这个状态还需要等完整攻击动作结束，再恢复其它状态，请使用下一段 `parallel` 写法。

如果还要等动作完整结束，再恢复状态，可以用 `parallel`：一个分支播放动作并等待完成，另一个分支等待 0.5 秒或 marker 后发事件。

```typescript
steps: [
  {
    // 两个分支同时开始：一个负责动作生命周期，一个负责中途事件。
    type: 'parallel',
    steps: [
      {
        // 这个分支让 parallel 一直等到 ShootUpper 播放完成。
        type: 'play',
        clip: 'ShootUpper',
        id: 'shootUpper',
        options: { repeat: 1, fadeIn: 0.08 },
        wait: 'complete'
      },
      {
        // 这个分支在动作开始 0.5 秒后发出开火事件。
        type: 'sequence',
        steps: [
          { type: 'wait', seconds: 0.5 },
          { type: 'emit', event: 'shoot-fire' }
        ]
      }
    ]
  },
  {
    // ShootUpper 完成后才会执行这里。
    type: 'play',
    clip: 'RunUpper',
    options: { repeat: 0 }
  }
]
```

效果：`shoot-fire` 在动作中途发出，而 timeline 仍会等 `ShootUpper` 完成后再恢复 `RunUpper`。

---

## 6. response 的三种打断方式

response 的 `onActive` 决定事件发生时当前流程如何处理。

| 值 | 行为 | 常见用途 |
|----|------|----------|
| 省略或 `'stop'` | 停止当前主流程，再执行 response 步骤。 | 普通打断、切换动作。 |
| `'keep'` | 保留当前流程，response 步骤作为并行分支运行。 | 受击闪烁、上半身射击、脚步特效。 |
| `{ fadeOut }` | 先用指定秒数淡出当前流程，再执行 response。 | 状态切换、全身动作插播。 |

```typescript
responses: [
  {
    event: 'flinch',
    target: {
      steps: [
        {
          // Flinch 叠加播放一次，不替换当前移动循环。
          type: 'play',
          clip: 'Flinch',
          options: { repeat: 1 },
          wait: false
        }
      ]
    },
    // 保留当前状态，让 Flinch 并行播放。
    onActive: 'keep'
  },
  {
    event: 'reload',
    target: {
      steps: [
        // Reload 会等当前主流程结束后再执行。
        { type: 'play', clip: 'Reload', options: { repeat: 1 }, wait: 'complete' },
        { type: 'emit', event: 'reload-finished' }
      ]
    },
    // 把 Reload 排到队列里，而不是立刻打断当前流程。
    enqueue: true
  }
]
```

效果：`flinch` 是即时叠加，`reload` 是排队执行。`enqueue` 适合需要按顺序播放的动作队列。

---

## 7. 上下半身并行循环

分层动画通常会让下半身负责移动，上半身负责瞄准、持枪或其它动作。可以用两个 masked clip 同时播放，并让上半身同步到下半身的相位。

```typescript
controller.addState('layeredRun', {
  timeline: {
    steps: [
      {
        // 下半身奔跑是相位参考。
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

效果：`RunLower` 和 `RunUpper` 一起循环。`sync.target` 可以引用前面 `play` 的本地 `id`。如果两个 clip 时长不同，用 `mode: 'normalized'`；如果作者时间轴完全一致，用 `mode: 'time'`。

---

## 8. 在分层循环中插播半身动作

常见需求：下半身继续跑，上半身临时播放一次射击，射击完成后上半身恢复奔跑，并且相位仍然对齐下半身。

```typescript
controller.addState('layeredRun', {
  timeline: {
    steps: [
      { type: 'play', clip: 'RunLower', id: 'lowerRun', options: { repeat: 0 } },
      {
        type: 'play',
        clip: 'RunUpper',
        id: 'upperRun',
        options: { repeat: 0, sync: { target: 'lowerRun', mode: 'normalized' } }
      }
    ]
  },
  responses: [
    {
      event: 'shoot',
      target: {
        steps: [
          {
            // 只停止上半身循环，下半身 lowerRun 继续作为相位源。
            type: 'stop',
            target: 'upperRun',
            options: { fadeOut: 0.08 }
          },
          {
            // 射击动作播放一次。parallel 让我们可以中途发 shoot-fire，同时等动作完成。
            type: 'parallel',
            steps: [
              {
                type: 'play',
                clip: 'ShootUpper',
                id: 'shootUpper',
                options: { repeat: 1, fadeIn: 0.08 },
                wait: 'complete'
              },
              {
                type: 'sequence',
                steps: [
                  { type: 'wait', seconds: 0.5 },
                  { type: 'emit', event: 'shoot-fire' }
                ]
              }
            ]
          },
          {
            // 恢复上半身奔跑，并同步到下半身当前相位。
            // 复用 upperRun，后续 shoot 事件才能继续停止新的上半身循环。
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
      // 保留下半身分支，让响应步骤只替换上半身。
      onActive: 'keep'
    }
  ]
});
```

效果：`shoot` 不会重启或停止 `RunLower`。射击中途发出 `shoot-fire`，射击完成后 `RunUpper` 按 `RunLower` 当前相位恢复。这里最容易漏掉的是恢复步骤上的 `id: 'upperRun'`：如果不复用这个 id，下一次 `shoot` 就无法再用 `target: 'upperRun'` 找到新的上半身循环。

---

## 9. 插播全身动作并返回分层循环

全身翻滚、闪避、受击倒地通常会替换上下半身分层播放。进入全身动作时保留旧下半身一小段时间，用来读取相位；全身动作完成后 `returnTo` 回到分层状态。

```typescript
controller
  .addState('layeredRun', {
    transition: 0.15,
    timeline: {
      steps: [
        {
          // RunLower 是进入全身动作时的相位参考。
          type: 'play',
          clip: 'RunLower',
          id: 'lowerRun',
          options: { repeat: 0 }
        },
        {
          // RunUpper 与下半身同步。
          type: 'play',
          clip: 'RunUpper',
          id: 'upperRun',
          options: { repeat: 0, sync: { target: 'lowerRun', mode: 'normalized' } }
        }
      ]
    },
    responses: [
      {
        event: 'dodge',
        target: {
          // dodgeFull 播放完成后自动回到当前 layeredRun。
          targetState: 'dodgeFull',
          returnTo: true,
          returnTransition: 0.15
        },
        // 保留旧状态 0.12 秒，让 dodgeFull 启动时能读取 RunLower 的相位。
        onActive: { fadeOut: 0.12 }
      }
    ]
  })
  .addState('dodgeFull', {
    transition: 0.12,
    timeline: {
      steps: [
        {
          // 使用旧下半身 RunLower 的相位启动全身 DodgeFull。
          // 这里引用 clip 名称，因为它来自即将淡出的旧状态。
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

效果：`dodge` 用全身动作临时替换分层移动。`DodgeFull` 启动时和旧 `RunLower` 相位一致；完成后回到 `layeredRun`，返回状态入口播放会淡入，并保持相位连续。

---

## 10. 常用规则速查

| 场景 | 推荐写法 |
|------|----------|
| 循环播放 | `play` + `options: { repeat: 0 }` |
| 一次性动作 | `play` + `options: { repeat: 1 }` + `wait: 'complete'` |
| 等外部输入继续 | `waitEvent` + 外部 `controller.dispatch(event)` |
| 停止某个播放实例 | `stop` + `target`，目标通常是前面 `play` 的 `id` |
| 一个并行分支里有多步 | 用 `sequence` 包住这些步骤 |
| 进入状态淡入 | 在 state 上写 `transition` |
| 打断当前状态淡出 | 在 response 上写 `onActive: { fadeOut }` |
| 一次性状态完成后回去 | `target: { targetState, returnTo: true }` |
| 回去时也交叉淡入淡出 | 增加 `returnTransition` |
| 不替换当前流程，叠加播放 | response 使用 `onActive: 'keep'` |
| 等当前流程结束后再播放 | response 使用 `enqueue: true` |
| 后续步骤要引用某个播放实例 | 在 `play` 上写 `id`，后续用 `target` 引用 |
| 替换后还想用同一个名字控制 | 在新的 `play` 上复用同一个 `id` |
| 恢复上/下半身动作相位 | `sync: { target: 'lowerRun', mode: 'normalized' }` |
| 动画内部时机 | 优先用 `addMarker({ time })` + `waitMarker` |

`waitFrame` 会按 `clip.frameRate` 把帧号折算成连续时间。如果资源管线没有稳定作者 FPS，优先使用 marker 的 `time`。

---

## 调试事件

这些事件可以帮助你理解状态机实际发生了什么：

```typescript
// setState() 改变当前状态或 stop() 清空状态时触发。
controller.on('statechange', (state, previousState) => {
  console.log('state changed', previousState, '->', state);
});

// 当前状态 runner 的主流程、并行分支和队列全部结束时触发。
controller.on('statecomplete', (state) => {
  console.log('state complete', state);
});

// timeline 的 emit 步骤会转发到 controller。
controller.on('emit', (event, payload) => {
  console.log('timeline emitted', event, payload);
});

// 每次 dispatch() 后都会触发，包含处理策略和是否被处理。
controller.on('event', (event, payload, result) => {
  console.log('dispatch result', event, result.policy, result.handled);
});
```

循环状态通常不会触发 `statecomplete`，因为 `repeat: 0` 的播放不会自然结束。一次性状态如果使用了 `wait: 'complete'`，会在播放完成后触发 `statecomplete`；如果配置了 `returnTo`，自动返回发生在 `statecomplete` 之后。
