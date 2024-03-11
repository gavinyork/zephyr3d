# 自定义动画

除了预定义的轨道之外，也可以添加自定义轨道来实现自定义的动画。

```javascript

// UserTrack对象用来自定义轨道
// 第一个参数为插值方式
// 第二个参数指定插值类型，可选值为'number','vec2','vec3','vec4','quat'
// 第三个参数为关键帧数组，数组每个元素的value属性必须和插值类型对应，可以是number,Vector2,Vector3,Vector4和Quaternion
// 第四个参数为回调函数，用于将插值结果应用到调用addTrack()时传递的节点对象。
animationClip.addTrack(node, new UserTrack('linear', 'number', [{
  time: 0,
  value: 0,
}, {
  time: 1,
  value: 1
}], (node, value) => {

}));

```

下面的示例当中，我们通过自定义轨道实现了UV动画和透明度渐变。

<div class="showcase" case="tut-26"></div>
