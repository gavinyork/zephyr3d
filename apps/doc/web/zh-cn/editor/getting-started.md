
# 快速开始

## 打开编辑器
- 打开在线版本： [https://zephyr3d.org/editor/](https://zephyr3d.org/editor/)  
- 下载桌面版：[GitHub Releases](https://github.com/gavinyork/zephyr3d/releases)，见[桌面编辑器](zh-cn/editor/desktop.md)

> 系统要求（浏览器版）
> - IndexedDB 支持
> - WebGL2 或 WebGPU 支持
> - ES 模块支持

### 创建或打开项目

进入主页后可选择：  
- **Create Project** ：创建项目，项目将存储在 IndexedDB 中；  
- **Open Project** ：打开IndexedDB中已创建的项目；  
- **Open Remote Project** ：通过URL以只读方式打开在线的远程项目（见下文）；  
- **Import Project** ：导入本地硬盘上的项目到IndexedDB；


<img src="https://cdn.zephyr3d.org/doc/assets/images/editor-main.png" width="1024"/>

### 最快的上手方式：示例场景

新建项目后，选择菜单 `Scene > Create Example Scene...`，从 **Cornell Box**、**Buildings**、**Terrain** 中选一个，按需调整参数后确定，编辑器会生成一个完整的示例场景。保存场景后点击工具栏上的运行按钮，就能看到它在浏览器中运行。Cornell Box 演示的全局光照需要 WebGPU。

### 打开远程项目

**Open Remote Project** 读取的是一个发布在静态服务器上的项目目录，该目录下必须有 `filelist.json`。做法是：用 `Project > Export Project` 导出项目，把得到的 zip 解压到静态服务器上，再用 Open Remote Project 输入这个目录的 URL。

也可以直接分享链接：`https://zephyr3d.org/editor/?project=<项目目录URL>&remote&open` 会在编辑器中以只读方式打开该项目。

**项目功能**
打开项目后，您可以：
- 管理项目资产
- 编辑场景内容
- 编写和管理脚本
- 配置项目设置
- 预览和发布项目

