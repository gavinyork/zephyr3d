
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
> 上传的模型文件（glTF/GLB、VRM/VRMA、FBX、OBJ）需要选择 **Import as Prefab** 导入为预制体，引擎才能读取；选 **Copy to project** 则只把原文件复制进项目。导入为预制体时还有三个选项：**Rebuild prefab**、**Rebuild material** 重新生成已有的预制体或材质，**Source Reference** 只对带 Morph Target 的单文件模型（GLB/VRM/FBX）生效：源文件会一并复制进项目，Morph Target 数据在需要时从它重新读取，而不是存进生成的网格资产。
>
> 发丝曲线（Alembic `.abc`、`.hair`）拖入资产窗口时会打开单独的头发导入对话框，转换成 `.zhair` 资产，供 `HairNode` 使用。

导入模型的对话框中还有 **Compress Textures**、**Compress Vertices** 和 **Generate LODs** 三个选项，默认不勾选。勾选后，导入的纹理和网格会以压缩形式发布或生成 LOD，详见[资产压缩](zh-cn/editor/asset-compression.md)。项目中已有资产的压缩设置，可以通过右键菜单中的 **Texture Settings...** 和 **Mesh Settings...** 修改。

## 第三方库管理

**安装`npm`包**：
1. 在资产视图中点击`📦`按钮安装npm包
2. 输入包名（可包含版本号）
3. 系统通过 esm.sh 自动导入 ESM 模块
4. 在脚本中直接引用使用

<video src="https://cdn.zephyr3d.org/doc/assets/videos/install-package.mp4" controls width="640">
  您的浏览器不支持 video 标签。
</video>

**删除`npm`包**：
1. 在`Project`菜单中选择`Project Settings`
2. 右键单击`npm`包列表中要删除的项，然后点击`Remove`

<video src="https://cdn.zephyr3d.org/doc/assets/videos/remove-package.mp4" controls width="640">
  您的浏览器不支持 video 标签。
</video>

