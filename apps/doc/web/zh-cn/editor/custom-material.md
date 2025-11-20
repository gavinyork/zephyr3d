# 自定义材质

## 创建自定义材质

1. 在资产视图右键菜单中点击 `Create New → Material`；  
2. 在蓝图中添加节点并连接至输出；  
3. 在预览窗口查看效果；  
4. 点击`Save`保存为`.zmtl`材质文件以及`.zbpt`蓝图文件；
5. 场景中选择Mesh对象，将资产视图中的`.zmtl`材质文件拖动到右侧材质属性编辑框内即可为Mesh应用材质；

<video src="https://cdn.zephyr3d.org/doc/assets/videos/create-material.mp4" controls width="640">
  您的浏览器不支持 video 标签。
</video>

## 创建材质实例

资产视图中右键点击一个材质，选择`Create Material Instance`为此材质创建一个新的实例。材质实例之间共享蓝图（如果是通过蓝图创建），但可应用不同的`uniform`参数。

## 编辑自定义材质

资产视图中双击一个`.zmtl`文件便可编辑此材质。如果材质是蓝图材质则会打开蓝图编辑界面，如果材质非蓝图材质(例如通过`@builtins`目录内的内建材质创建的材质实例)，则只能编辑材质属性。

