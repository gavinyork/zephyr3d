# 自定义动画

除了预定义的轨道之外，也可以添加自定义轨道来实现自定义的动画。

自定义轨道需要继承AnimationTrack类，并实现以下方法：

- [AnimationTrack.calculateState()](/doc/markdown/./scene.animationtrack.calculatestate)

  该方法用于计算并返回某一时刻的动画轨道状态，例如可以返回Vector3类型的位移，或Quaternion类型的旋转或Number类型的透明度等等。
  该state值用于轨道本身，因此可以是轨道的成员。

- [AnimationTrack.mixState()](/doc/markdown/./scene.animationtrack.mixstate)

  该方法用于在两个轨道状态之间插值，主要用于动作融合。该方法必须返回一个新的状态对象。

- [AnimationTrack.applyState()](/doc/markdown/./scene.animationtrack.applystate)

  该方法用于将轨道状态应用于某个节点。

- [AnimationTrack.getBlendId()](/doc/markdown/./scene.animationtrack.getblendid)

  该方法返回一个值(通常是string，也可以为对象)，系统中具有相同BlendID的轨道被认为是可以融合的，另外具有相同BlendID的轨道也不允许添加到同一个AnimationClip中。

```javascript

// 自定义动画轨道用来对节点进行UV动画和透明度动画
class MyAnimationTrack extends AnimationTrack {
  // 轨道状态，是一个长度为2的Float32Array，第一个元素存储UV的位移，第二个元素存储透明度
  _state;
  // 构造函数接受一个存储了关键帧的interpolator对象
  constructor(interpolator) {
    super(interpolator);
    this._state = new Float32Array(2);
  }
  // 利用interpolator插值计算并返回给定时刻的轨道状态
  calculateState(target, currentTime) {
    this._interpolator.interpolate(currentTime, this._state);
    return this._state;
  }
  // 通过插值融合两个轨道并返回融合后的状态
  mixState(stateA, stateB, t) {
    const result = new Float32Array(2);
    result[0] = a[0] + (b[0] - a[0]) * t;
    result[1] = a[1] + (b[1] - a[1]) * t;
    return result;
  }
  // 将轨道状态应用于节点
  applyState(node, state) {
    // 这里我们对节点及其所有孩子中的Mesh节点都应用轨道动画
    node.iterate((child) => {
      if (child.isMesh()) {
        // 设置UV变换矩阵
        mesh.material.albedoTexCoordMatrix = Matrix4x4.translation(new Vector3(state[0], 0, 0));
        // 设置透明度
        mesh.material.opacity = state[1];
      }
    });
  }
  // 此轨道类型的BlendId
  getBlendId() {
    // 返回一个唯一的id，这样所有MyAnimationTrack可以相互融合
    return 'my-animation-track';
  }
}

// 创建动画并使用自定义轨道

// 假定model是一个加载好的模型
const model = await getEngine().resourceManager.fetchModel(MODEL_URL, scene);
// 获取model的动画集
const animationSet = model.group.animationSet;
// 创建一个动画
const animation = new AnimationClip('UserTrackTest');
// 创建一个interpolator存储自定义动画的关键帧
const interpolator = new Interpolator(
  // 线性插值
  'linear',
  // 自动计算每关键帧的元素数量：output.length/input.length
  null,
  // input, 为每个关键帧的时间，单位为秒
  new Float32Array([0, 1, 2]),
  // output, 每个关键帧的数据为两个元素，第一个是UV位移，第二个是透明度
  // 三个关键帧数据为：
  // (0, 0.9), (0.5, 0), (1, 0.9)
  new Float32Array([0, 0.9, 0.5, 0, 1, 0.9])
);
// 使用关键帧数据创建自定义轨道
const track = new MyAnimationTrack(interpolator);
// 添加轨道到动画，并指定该轨道需要控制的节点
animation.addTrack(model.group, track);
// 添加该动画到动画集
animationSet.add(animation);

// 开始播放此动画
animationSet.playAnimation('UserTrackTest', {
  repeat: 0, // 循环次数，0为无限循环。默认值为0
  speedRatio: 1, // 速度因子，绝对值越大速度越快，如果为负值则反向播放。默认值为1
  weight: 1, // 融合权值，当多个动画同时播放时，所有动画通过这个权值做加权平均，默认为1
  fadeIn: 0, // 动画需要多长时间权值从0增长到weight，默认为0，表示无淡入效果，通常和stopAnimation()的fadeOut参数配合用于两个动画无缝切换
});


```

<div class="showcase" case="tut-26"></div>
