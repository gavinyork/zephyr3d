
# 资产管理

## 资产视图

项目资产存储在IndexedDB中，以文件系统的形式展示，类似 Windows 资源管理器的文件夹视图。

<video src="https://cdn.zephyr3d.org/doc/assets/videos/content-browser-1080p.mp4" controls width="640">
  您的浏览器不支持 video 标签。
</video>

> 注意
> 
> `/assets/@builtins`为只读目录，存储引擎内建资产，不受用户管理

## 资产导入

直接从操作系统拖动文件到资产视图，即可上传资产文件。

<video src="https://cdn.zephyr3d.org/doc/assets/videos/import-asset.mp4" controls width="640">
  您的浏览器不支持 video 标签。
</video>

> 注意：
> 
> 如果上传模型文件(当前仅支持GLTF/GLB)，你需要选择导入为预制体(Prefab)，以便引擎读取。

[图片占位：资产视图界面]

## 第三方库管理

**安装`npm`包**：
1. 在资产视图中点击`📦`按钮安装npm包
2. 输入包名（可包含版本号）
3. 系统通过 esm.sh 自动导入 ESM 模块
4. 在脚本中直接引用使用

<video src="https://cdn.zephyr3d.org/doc/assets/videos/install-package.mp4" controls width="640">
  您的浏览器不支持 video 标签。
</video>

** 删除`npm`包**:
1. 在`Project`菜单中选择`Project Settings`
2. 右键单击`npm`包列表中要删除的项，然后点击`Remove`

<video src="https://cdn.zephyr3d.org/doc/assets/videos/remove-package.mp4" controls width="640">
  您的浏览器不支持 video 标签。
</video>

