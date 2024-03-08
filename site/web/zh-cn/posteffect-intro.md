# 后处理

后处理(PostProcess)允许你在场景渲染以后为图像添加2D效果。

我们使用Compositor对象管理后处理效果。Compositor可以添加多个后处理效果，每个都以前一个效果的渲染结果为输入形成链式调用。
渲染的时候只需要将Compositor对象作为Camera.render()的第二个参数即可。

我们的后处理效果分为Opaque和Transparent两组，Opaque组是在不透明物体渲染完成，不透明物体渲染之前调用，Transparent组在透明和不透明物体都渲染完成调用。
每种后处理效果根据应用不同默认处于Opaque组或Transparent组。后处理效果的调用次序分别在每个组内符合添加次序。
