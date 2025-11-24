# 虚拟文件系统（Virtual File System, VFS）

## 概述

Zephyr3D 的文件访问系统基于一套高度抽象的 **虚拟文件系统（VFS）架构**。  
通过 VFS，应用与引擎中的资源加载、场景序列化、脚本系统等模块都能以统一的方式访问文件，无需关心文件的实际来源（本地、网络、内存或其他）。  

这种架构使 Zephyr3D 具备了以下优势：

- 文件访问与平台无关；
- 可插拔的文件系统实现；
- 灵活地支持网络加载、本地缓存、离线运行；
- 可由用户扩展实现自定义文件访问策略。

---

## VFS 基本结构

### 抽象基类

在 `vfs.ts` 中定义了抽象基类 `VFS`，它提供了一组标准的异步接口，对文件和目录的操作进行了统一抽象。  

该类继承自 `Observable`，能派发文件变更事件（如创建、删除、修改），并为派生类提供基础的路径管理与挂载机制。

主要 API 包括：

| 方法 | 功能描述 |
|------|-----------|
| `readFile(path, options)` | 读取文件内容，支持 `utf8`、`binary`、`base64` 三种编码 |
| `writeFile(path, data, options)` | 写入文件，支持追加、自动创建 |
| `exists(path)` | 判断文件或目录是否存在 |
| `stat(path)` | 获取文件统计信息（大小、时间、类型等） |
| `makeDirectory(path, recursive)` | 创建目录 |
| `readDirectory(path, options)` | 列出目录内容 |
| `move(source, target)` | 移动/重命名文件或目录 |
| `deleteFile(path)` / `deleteDirectory(path)` | 删除文件或目录 |
| `mount(path, vfs)` / `unmount(path)` | 挂载/卸载子文件系统 |
| `normalizePath(path)` | 规范化路径并解析相对路径 |
| `glob(pattern, options)` | 按通配符模式匹配文件 |
| `copyFile`, `copyFileEx()` | 跨路径/跨 VFS 拷贝文件 |

---

## VFS 在引擎中的使用

### 1. 与 Application 关联

在应用启动时，可将任意 VFS 实例传入 `Application` 创建参数：  
（定义于 `app.ts`）

```typescript
const app = new Application({
  canvas,
  backend,
  runtimeOptions: {
    VFS: new HttpFS('.') // 这是默认文件系统来源，以当前页面路径为根访问文件，可省略
  }
});
```

---

### 2. 资源与场景加载流程

Engine 中的反序列化与加载流程均通过 VFS 进行：

```typescript
const scene = await engine.serializationManager.loadScene('/scenes/demo.json');
const texData = await engine.VFS.readFile('/textures/stone.png');
```

当引擎序列化或保存场景时，`SerializationManager` 会使用当前的 VFS 进行 I/O：

```typescript
await this._vfs.writeFile(filename, JSON.stringify(content), { encoding: 'utf8', create: true });
```

---

## VFS 的可扩展性

Zephyr3D 的 VFS 体系支持用户自定义文件系统。  
只需继承 `VFS` 并实现其抽象方法（`_readFile`, `_writeFile`, `_stat` 等），即可接入引擎的资源读取流程。

自定义文件系统适用的典型场景包括：

| 场景 | 示例 |
|------|------|
| **本地缓存层** | 先查缓存再回退到 HttpFS |
| **加密资源访问** | 在 `_readFile` / `_writeFile` 中集成加密解密 |
| **版本控制** | 使用自定义 urlResolver 实现路径版本映射 |
| **压缩包读取** | 实现 ZipFS 直接读取打包资源 |
| **离线加载** | 使用 MemoryFS 或 IndexedDBFS 实现资源持久化 |

---

## 示例：实现自定义缓存文件系统

```typescript
import { VFS, VFSError } from '@zephyr3d/base';

class CachedHttpFS extends VFS {
  constructor(private httpfs) {
    super();
  }

  private cache = new Map<string, ArrayBuffer>();

  async _readFile(path) {
    if (this.cache.has(path)) {
      return this.cache.get(path);
    }
    const data = await this.httpfs.readFile(path, { encoding: 'binary' });
    this.cache.set(path, data);
    return data;
  }

  async _writeFile() {
    throw new VFSError('Read-only', 'EROFS');
  }

  async _exists(path) {
    return this.cache.has(path) || this.httpfs.exists(path);
  }
  // 其他抽象方法可根据需求重写或抛出异常
}
```

应用此类时：

```typescript
const cachedFS = new CachedHttpFS(new HttpFS('./cdn'));
const app = new Application({ backend, canvas, runtimeOptions: { VFS: cachedFS } });
```

---

## 文件系统挂载与组合

`VFS` 支持在指定路径挂载其他文件系统，实现文件访问的多级结构：

```typescript
const rootFS = new HttpFS('./');
const memoryFS = new MemoryFS();

await rootFS.mount('/assets/@cache', memoryFS);
await rootFS.mount('/assets/@remote', new HttpFS('https://cdn.example.com'));

// 挂载后路径映射结构：
// /assets/@cache -> MemoryFS
// /assets/@remote -> HttpFS(CDN)

// 读取文件时系统会自动寻找对应挂载点
await rootFS.readFile('/assets/@remote/texture.png');
```

---

## 总结

Zephyr3D 的 **VFS 架构** 为引擎提供了可扩展、抽象统一的文件访问体系：

- `VFS` 提供标准的异步文件操作接口；
- 默认使用 `HttpFS` 覆盖网络访问场景；
- 引擎、序列化器、脚本系统均基于 VFS 进行数据读写；
- 文件系统可挂载、组合，实现缓存、镜像、离线等策略；
- 用户可通过继承 `VFS` 自定义文件存储逻辑。

